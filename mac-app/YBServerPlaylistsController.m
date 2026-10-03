#import "YBServerPlaylistsController.h"
#import "YBPlaylistSync.h"
#import "YBPlaylistIO.h"
#import "YBPlaylistFormat.h"
@interface YBServerPlaylistsController () <NSTableViewDataSource,NSTableViewDelegate,NSSearchFieldDelegate>
@property(nonatomic,readwrite) NSView *view;
@property YBWork *work;
@property YBDocumentsController *documents;
@property NSURL *target;
@property NSTextField *rootLabel;
@property NSTextField *fileLabel;
@property NSTextField *status;
@property NSTableView *listTable;
@property NSSearchField *search;
@property NSArray *visibleChoices;
@property NSMutableDictionary *comparisons;
@property NSButton *receiveButton;
@property NSButton *receiveAllButton;
@property NSButton *registerButton;
@property NSTextField *summary;
@property NSTextField *versionLabel;
@property NSTableView *comparisonTable;
@property NSArray *comparisonRows;
@property NSTableView *recoveryTable;
@property NSArray *recoveryRecords;
@property NSAlert *recoveryAlert;
@property NSTextView *recoveryDetails;
@property NSTableView *table;
@property NSArray *choices;
@property NSDictionary *comparison;
@property NSString *selectedChoiceKey;
@property BOOL updatingChoices;
@end
@implementation YBServerPlaylistsController
- (instancetype)initWithWork:(YBWork *)work documents:(YBDocumentsController *)documents {
    if((self=[super init])){_work=work;_documents=documents;_choices=@[];id path=YBPreferences(@"server-playlists.json")[@"target"] ?: YBPreferences(@"playlist-settings.json")[@"localPath"];if([path isKindOfClass:NSString.class] && [path isAbsolutePath])_target=[NSURL fileURLWithPath:path];[self buildView];}return self;
}
- (void)buildView {
    YBPanel *v=[[YBPanel alloc] initWithFrame:NSMakeRect(0,0,1060,720)];self.view=v;self.comparisons=[NSMutableDictionary dictionary];self.visibleChoices=@[];
    self.rootLabel=YBLabel(@"",NSZeroRect,12,NO);self.fileLabel=YBLabel(@"",NSZeroRect,12,NO);
    self.search=[[NSSearchField alloc] initWithFrame:NSMakeRect(24,623,305,28)];self.search.placeholderString=@"재생목록 검색";self.search.delegate=self;[v addSubview:self.search];
    self.listTable=YBTable(v,NSMakeRect(24,163,305,448),@[@[@"name",@"재생목록",@134],@[@"status",@"상태",@102],@[@"date",@"바뀐 때",@140]],self);self.listTable.allowsMultipleSelection=NO;self.listTable.columnAutoresizingStyle=NSTableViewNoColumnAutoresizing;self.listTable.enclosingScrollView.hasHorizontalScroller=NO;
    self.versionLabel=YBLabel(@"재생목록을 선택하세요.",NSMakeRect(349,625,687,25),13,YES);[v addSubview:self.versionLabel];
    self.table=YBTable(v,NSMakeRect(349,163,687,448),@[@[@"index",@"#",@38],@[@"name",@"곡 / 말씀",@230],@[@"status",@"받으면",@210],@[@"author",@"서버 저장 · 작업자",@245]],self);
    self.registerButton=YBButton(@"원본 재생목록 등록",NSMakeRect(60,385,238,36),self,@selector(publish:));self.registerButton.hidden=YES;[v addSubview:self.registerButton];
    self.summary=YBLabel(@"수정·새 문서를 먼저 적용한 뒤 선택한 예배의 순서만 교체합니다.",NSMakeRect(24,127,1012,26),12,NO);[v addSubview:self.summary];
    self.status=YBLabel(@"서버 연결 후 자동으로 순서와 연결 문서를 비교합니다.",NSMakeRect(24,94,1012,25),12,NO);[v addSubview:self.status];
    NSButton *recovery=YBButton(@"복구 기록…",NSZeroRect,self,@selector(restore:));[v addSubview:recovery];NSButton *studio=YBButton(@"Studio 열기",NSZeroRect,self,@selector(openStudio:));[v addSubview:studio];

    self.receiveAllButton=YBButton(@"변경 예배 모두 받기",NSMakeRect(560,35,235,36),self,@selector(receiveAll:));[v addSubview:self.receiveAllButton];
    self.receiveButton=YBButton(@"선택한 예배 받기",NSMakeRect(805,35,231,36),self,@selector(receive:));self.receiveButton.font=[NSFont boldSystemFontOfSize:13];self.receiveButton.enabled=NO;[v addSubview:self.receiveButton];[self.documents setPlaylistFile:self.target];self.receiveAllButton.enabled=NO;
    __weak YBServerPlaylistsController *weakSelf=self;
    v.frameLayout=^(NSSize size){YBServerPlaylistsController *c=weakSelf;CGFloat w=size.width,h=size.height,m=14;
        CGFloat left=MAX(410,MIN(470,(w-3*m)*.36)),right=m+left+16,rw=w-right-m;
        c.search.frame=NSMakeRect(m,h-36,left,26);c.versionLabel.frame=NSMakeRect(right,h-36,rw,26);
        c.listTable.enclosingScrollView.frame=NSMakeRect(m,64,left,MAX(80,h-110));
        c.table.enclosingScrollView.frame=NSMakeRect(right,122,rw,MAX(80,h-168));
        [c.listTable.enclosingScrollView tile];
        CGFloat listWidth=c.listTable.enclosingScrollView.contentSize.width;
        CGFloat usable=MAX(0,listWidth-c.listTable.intercellSpacing.width*c.listTable.tableColumns.count);
        c.listTable.tableColumns[0].width=MAX(35,usable-230);c.listTable.tableColumns[1].width=90;c.listTable.tableColumns[2].width=140;
        [c.listTable setFrameSize:NSMakeSize(listWidth,c.listTable.frame.size.height)];
        // Narrow windows give the long receiving explanation the full width.
        CGFloat textX=w<1280 ? m : right;c.summary.frame=NSMakeRect(textX,93,w-textX-m,23);c.status.frame=NSMakeRect(textX,66,w-textX-m,23);
        if(w<1280)c.listTable.enclosingScrollView.frame=NSMakeRect(m,122,left,MAX(80,h-168));
        c.registerButton.frame=NSMakeRect(m+20,MAX(142,h-125),left-40,32);
        recovery.frame=NSMakeRect(m,14,126,32);studio.frame=NSMakeRect(m+136,14,126,32);
        c.receiveAllButton.frame=NSMakeRect(w-m-424,14,224,32);c.receiveButton.frame=NSMakeRect(w-m-190,14,190,32);
    };v.frameLayout(v.bounds.size);
}
- (NSString *)targetPath {return self.target.path ?: @"재생목록 파일 선택 필요";}
- (void)rootChanged {self.rootLabel.stringValue=self.documents.documentsRoot;[self.comparisons removeAllObjects];[self selectionChanged:nil];[self.documents setPlaylistFile:self.target];}
- (void)setTargetFile:(NSURL *)url {if(!url)return;@try{YBReadPlaylist(url);self.target=url;self.fileLabel.stringValue=url.path;YBSavePreferences(@"server-playlists.json",@{@"target":url.path});[self.documents setPlaylistFile:url];if(self.targetChanged)self.targetChanged(url.path);[self refresh:nil];}@catch(NSException *e){YBAlert(@"재생목록 파일",e.reason);}}
- (void)chooseFile:(id)sender {if(self.work.busy)return;NSOpenPanel *p=[NSOpenPanel openPanel];p.allowedFileTypes=@[@"pro6pl"];p.canChooseDirectories=NO;p.allowsMultipleSelection=NO;p.message=@"동기화할 PP6 재생목록 파일을 선택하세요.";if([p runModal]==NSModalResponseOK)[self setTargetFile:p.URL];}
- (YBPlaylistSync *)engine {YBRequire(self.target!=nil,@"재생목록 파일을 먼저 선택하세요.");[self.documents ensureSessionLoaded];return [[YBPlaylistSync alloc] initWithLibrary:[self.documents connectedLibrary] target:self.target];}
- (NSString *)choiceKey:(NSDictionary *)choice {return [NSString stringWithFormat:@"%@/%@",choice[@"library"],choice[@"node"]];}
- (NSString *)comparisonStatus:(NSDictionary *)value {if(!value)return @"미확인";if(value[@"error"])return @"확인 필요";if(![value[@"ready"] boolValue]){for(NSDictionary *r in value[@"rows"])if([r[@"status"] isEqual:@"upload"])return @"문서 보내기";else if([r[@"status"] isEqual:@"conflict"])return @"문서 충돌";return @"확인 필요";}if([value[@"orderChanged"] boolValue])return @"서버가 새로움";for(NSDictionary *r in value[@"rows"])if([r[@"status"] isEqual:@"download"])return @"서버가 새로움";return @"같음";}
- (void)acceptLibraries:(NSArray *)libraries {NSMutableArray *choices=[NSMutableArray array];for(NSDictionary *library in libraries)for(NSDictionary *node in library[@"playlists"])[choices addObject:@{@"library":library[@"id"],@"node":node[@"id"],@"name":node[@"name"],@"path":library[@"path"],@"date":node[@"updatedAt"] ?: library[@"updatedAt"] ?: @""}];self.choices=choices;self.registerButton.hidden=choices.count>0;[self filterChoices];}
- (void)filterChoices {
    NSString *query=self.search.stringValue.precomposedStringWithCanonicalMapping;NSMutableArray *visible=[NSMutableArray array];for(NSDictionary *choice in self.choices)if(!query.length || [choice[@"name"] rangeOfString:query options:NSCaseInsensitiveSearch].location!=NSNotFound)[visible addObject:choice];
    self.updatingChoices=YES;self.visibleChoices=visible;[self.listTable reloadData];NSUInteger selected=NSNotFound;for(NSUInteger i=0;i<visible.count;i++)if([[self choiceKey:visible[i]] isEqual:self.selectedChoiceKey])selected=i;
    if(selected==NSNotFound && visible.count)selected=0;if(selected!=NSNotFound)[self.listTable selectRowIndexes:[NSIndexSet indexSetWithIndex:selected] byExtendingSelection:NO];else [self.listTable deselectAll:nil];self.updatingChoices=NO;[self selectionChanged:nil];
}
- (void)controlTextDidChange:(NSNotification *)note {[self filterChoices];}
- (void)refresh:(id)sender {
    if(self.work.busy)return;self.status.stringValue=@"재생목록 전체와 연결 문서 비교 중…";self.receiveButton.enabled=NO;
    [self.work runPausable:YES task:^id{[self.documents ensureSessionLoaded];YBPlaylistSync *engine=[[YBPlaylistSync alloc] initWithLibrary:[self.documents connectedLibrary] target:self.target];NSDictionary *reconciled=[engine reconcileFileWithLibraries:[engine libraries]];NSArray *libraries=reconciled[@"libraries"];NSMutableDictionary *results=[NSMutableDictionary dictionary],*hashes=[NSMutableDictionary dictionary];NSUInteger total=0,done=0;for(NSDictionary *l in libraries)total+=[l[@"playlists"] count];for(NSDictionary *l in libraries)for(NSDictionary *n in l[@"playlists"]){[self.work checkpoint];NSString *key=[NSString stringWithFormat:@"%@/%@",l[@"id"],n[@"id"]];@try{results[key]=self.target ? [engine compare:l[@"id"] node:n[@"id"] hashCache:hashes] : @{@"error":@"Mac 재생목록 파일을 선택하세요."};}@catch(NSException *e){results[key]=@{@"error":e.reason ?: @"비교 실패"};}done++;NSString *message=[NSString stringWithFormat:@"재생목록 %lu/%lu 비교 · %@",(unsigned long)done,(unsigned long)total,n[@"name"]];dispatch_async(dispatch_get_main_queue(),^{self.status.stringValue=message;self.work.message=message;});}NSMutableDictionary *documentReports=[NSMutableDictionary dictionary];for(NSDictionary *comparison in results.allValues)for(NSDictionary *row in comparison[@"rows"]){NSDictionary *doc=row[@"remote"];if(![doc isKindOfClass:NSDictionary.class])continue;NSString *key=doc[@"id"];NSDictionary *old=documentReports[key];NSString *state=row[@"status"] ?: @"unknown";if(old && (![old[@"serverHash"] isEqual:doc[@"sha256"]] || ![old[@"status"] isEqual:state]))state=@"unknown";documentReports[key]=@{@"kind":@"document",@"id":key,@"node":@"",@"serverHash":doc[@"sha256"],@"status":state};}[engine.library reportSyncItems:documentReports.allValues];NSMutableArray *known=[NSMutableArray array];for(NSDictionary *c in results.allValues)for(NSDictionary *r in c[@"rows"])if([r[@"remote"] isKindOfClass:NSDictionary.class])[known addObject:r[@"remote"]];[engine.library noteComparedDocuments:known];return @{@"libraries":libraries,@"comparisons":results,@"syncStatus":reconciled[@"status"]};} completion:^(NSDictionary *result,NSString *error){if(error){self.status.stringValue=[@"비교 실패 · " stringByAppendingString:error];[self.comparisons removeAllObjects];self.comparison=nil;[self updateReceiveAll];[self.table reloadData];if(self.priorityFinished)self.priorityFinished();return;}self.comparisons=[result[@"comparisons"] mutableCopy];[self acceptLibraries:result[@"libraries"]];[self.documents setPlaylistFile:self.target];[self.documents acceptPriorityComparisons:self.comparisons.allValues];self.status.stringValue=[@"재생목록·연결 문서 확인 완료 · " stringByAppendingString:result[@"syncStatus"] ?: @""];if(self.comparisonFinished)self.comparisonFinished();if(self.priorityFinished)self.priorityFinished();}];
}
- (void)tableViewSelectionDidChange:(NSNotification *)note {if(note.object==self.listTable){if(!self.updatingChoices)[self selectionChanged:nil];}else if(note.object==self.recoveryTable){[self recoverySelection];[self.recoveryTable reloadData];}else if(note.object==self.table)[self.table reloadData];}
- (void)selectionChanged:(id)sender {NSInteger index=self.listTable.selectedRow;NSDictionary *choice=index>=0 && (NSUInteger)index<self.visibleChoices.count ? self.visibleChoices[index] : nil;if(choice)self.selectedChoiceKey=[self choiceKey:choice];NSDictionary *result=choice ? self.comparisons[[self choiceKey:choice]] : nil;if(result && !result[@"error"])[self acceptComparison:result];else {self.comparison=nil;[self.table reloadData];self.receiveButton.enabled=choice!=nil && !self.work.busy;self.receiveButton.title=choice ? @"다시 비교" : @"선택한 예배 받기";self.status.stringValue=result[@"error"] ?: @"재생목록을 선택하세요.";self.versionLabel.stringValue=choice[@"name"] ?: @"재생목록을 선택하세요.";}[self updateReceiveAll];}
- (void)publish:(id)sender {
    if(self.work.busy)return;if(!self.target){YBAlert(@"파일을 선택해 주세요.",@"Mac의 원본 .pro6pl 파일을 먼저 선택하세요.");return;}
    NSAlert *alert=[NSAlert new];alert.messageText=@"원본 재생목록과 연결 문서를 서버에 등록";alert.informativeText=[NSString stringWithFormat:@"%@\n\n아래는 재생목록이 원래 참조하던 문서 폴더입니다. 실제 업로드할 문서는 화면 위에서 선택한 문서 폴더에서 찾습니다. 서버와 다른 내용은 자동으로 덮어쓰지 않습니다.",self.target.path];NSTextField *root=[[NSTextField alloc] initWithFrame:NSMakeRect(0,0,560,30)];root.stringValue=@"~/Documents/ProPresenter6";alert.accessoryView=root;[alert addButtonWithTitle:@"서버에 등록"];[alert addButtonWithTitle:@"취소"];if([alert runModal]!=NSAlertFirstButtonReturn)return;NSString *source=root.stringValue;
    [self.work runPausable:YES task:^id{YBPlaylistSync *engine=[self engine];NSDictionary *result=[engine registerFileWithSourceRoot:source progress:^(NSString *message){dispatch_async(dispatch_get_main_queue(),^{self.status.stringValue=message;});}];return @{@"result":result,@"libraries":[engine libraries]};} completion:^(NSDictionary *value,NSString *error){if(error){YBAlert(@"원본 등록",error);self.status.stringValue=@"등록을 마치지 못했습니다. 원본과 서버 이력은 유지합니다.";return;}[self acceptLibraries:value[@"libraries"]];[self refresh:nil];NSDictionary *result=value[@"result"];self.status.stringValue=[NSString stringWithFormat:@"재생목록 등록 · 문서 %@개 확인 · 누락/충돌 %lu개",result[@"count"],(unsigned long)[result[@"issues"] count]];if([result[@"issues"] count])YBShowText(@"아직 연결되지 않은 문서",[result[@"issues"] componentsJoinedByString:@"\n"]);}];
}
- (void)updateReceiveAll {
    NSUInteger count=0;for(NSDictionary *c in self.comparisons.allValues)if([c[@"ready"] boolValue]){BOOL changed=[c[@"orderChanged"] boolValue];for(NSDictionary *r in c[@"rows"])if([r[@"status"] isEqual:@"download"])changed=YES;if(changed)count++;}
    NSUInteger unresolved=0;for(NSDictionary *c in self.comparisons.allValues)if(![c[@"ready"] boolValue])unresolved++;self.receiveAllButton.title=[NSString stringWithFormat:@"받기 %lu · 해결 필요 %lu",(unsigned long)count,(unsigned long)unresolved];self.receiveAllButton.toolTip=@"받을 수 있는 예배만 묶어서 받습니다. 해결 필요 항목은 선택 후 차이 확인·해결을 이용하세요.";self.receiveAllButton.enabled=count>0 && !self.work.busy;
}
- (void)acceptComparison:(NSDictionary *)result {self.comparison=result;[self.table reloadData];NSUInteger changed=0,added=0;for(NSDictionary *r in result[@"rows"])if([r[@"status"] isEqual:@"download"]){if(r[@"localHash"]==NSNull.null)added++;else changed++;}NSDictionary *manifest=result[@"manifest"],*library=manifest[@"library"];self.versionLabel.stringValue=[NSString stringWithFormat:@"%@ · 순서 v%@ · %@",manifest[@"playlist"][@"name"],manifest[@"playlist"][@"version"] ?: @"—",manifest[@"playlist"][@"updatedBy"] ?: library[@"updatedBy"] ?: @"—"];NSString *serverDate=YBDisplayDate(manifest[@"playlist"][@"updatedAt"] ?: library[@"updatedAt"]);
    NSDate *localDate=self.target ? [NSFileManager.defaultManager attributesOfItemAtPath:self.target.path error:NULL][NSFileModificationDate] : nil;
    self.versionLabel.stringValue=[self.versionLabel.stringValue stringByAppendingFormat:@" %@ · 이 Mac 파일 %@",serverDate,YBDisplayDate(localDate)];self.versionLabel.toolTip=self.versionLabel.stringValue;
    self.summary.stringValue=[NSString stringWithFormat:@"받는 순서 ① 수정 %lu개 받기 → ② 새 문서 %lu개 추가 → ③ 선택한 예배 순서 %@ · 다른 순서는 유지",(unsigned long)changed,(unsigned long)added,[result[@"orderChanged"] boolValue] ? @"교체" : @"유지"];
    self.status.stringValue=[result[@"ready"] boolValue] ? ((changed+added || [result[@"orderChanged"] boolValue]) ? @"공유 문서 변경은 함께 쓰는 다른 예배에도 반영됩니다." : @"서버와 같습니다.") : [result[@"issues"] componentsJoinedByString:@" · "];
    self.receiveButton.title=[result[@"ready"] boolValue] ? @"선택한 예배 받기" : @"차이 확인·해결…";self.receiveButton.toolTip=[NSString stringWithFormat:@"%@ 받기",manifest[@"playlist"][@"name"] ?: @"선택한 예배"];self.receiveButton.enabled=(![result[@"ready"] boolValue] || changed+added || [result[@"orderChanged"] boolValue]) && !self.work.busy;
    [self updateReceiveAll];
}
- (NSArray *)previewItems {
    NSMutableArray *items=[NSMutableArray array];NSMutableDictionary *oldByID=[NSMutableDictionary dictionary];NSMutableArray *oldIDs=[NSMutableArray array],*newIDs=[NSMutableArray array];
    NSUInteger index=0;for(NSDictionary *old in self.comparison[@"localNode"][@"items"]){NSString *key=[old[@"attrs"][@"UUID"] length] ? old[@"attrs"][@"UUID"] : [NSString stringWithFormat:@"item-%lu",(unsigned long)index];oldByID[key]=old;[oldIDs addObject:key];index++;}
    for(NSDictionary *item in self.comparison[@"manifest"][@"items"])[newIDs addObject:item[@"id"] ?: @""];
    // Ignore index shifts caused solely by insertion/removal when labelling moves.
    NSMutableArray *oldCommon=[NSMutableArray array],*newCommon=[NSMutableArray array];for(NSString *key in oldIDs)if([newIDs containsObject:key])[oldCommon addObject:key];for(NSString *key in newIDs)if([oldIDs containsObject:key])[newCommon addObject:key];
    for(NSDictionary *item in self.comparison[@"manifest"][@"items"]){NSMutableDictionary *copy=[item mutableCopy];NSString *key=item[@"id"];
        copy[@"composition"]=!oldByID[key ?: @""] ? @"순서에 추가" : [oldCommon indexOfObject:key]!=[newCommon indexOfObject:key] ? @"순서 이동" : @"";[items addObject:copy];}
    for(NSString *key in oldIDs)if(![newIDs containsObject:key]){NSDictionary *old=oldByID[key];[items addObject:@{@"name":old[@"attrs"][@"displayName"] ?: @"항목",@"kind":@"removed",@"path":old[@"attrs"][@"filePath"] ?: @""}];}
    return items;
}

- (NSInteger)numberOfRowsInTableView:(NSTableView *)table {if(table==self.comparisonTable)return self.comparisonRows.count;if(table==self.listTable)return self.visibleChoices.count;if(table==self.recoveryTable)return self.recoveryRecords.count;return self.previewItems.count;}
- (NSView *)tableView:(NSTableView *)table viewForTableColumn:(NSTableColumn *)column row:(NSInteger)index {
    if(table==self.comparisonTable){NSDictionary *row=self.comparisonRows[index];NSTextField *field=YBLabel(row[column.identifier] ?: @"",NSMakeRect(0,2,column.width,28),12,NO);field.selectable=NO;field.toolTip=field.stringValue;if([row[@"changed"] boolValue])field.textColor=[NSColor colorWithCalibratedRed:.65 green:.2 blue:.1 alpha:1];return field;}
    NSString *text=@"",*tip=@"";NSColor *color=NSColor.labelColor;
    if(table==self.listTable){NSDictionary *choice=self.visibleChoices[index];NSString *state=[self comparisonStatus:self.comparisons[[self choiceKey:choice]]];text=[column.identifier isEqual:@"name"] ? choice[@"name"] : [column.identifier isEqual:@"status"] ? state : YBDisplayDate(choice[@"date"]);tip=[NSString stringWithFormat:@"%@ · %@",choice[@"path"],YBDisplayDate(choice[@"date"])];if([state isEqual:@"서버가 새로움"])color=[NSColor colorWithCalibratedRed:.18 green:.32 blue:.7 alpha:1];else if(![state isEqual:@"같음"])color=[NSColor colorWithCalibratedRed:.65 green:.3 blue:.1 alpha:1];}
    else if(table==self.recoveryTable){NSDictionary *record=self.recoveryRecords[index];text=record[column.identifier] ?: @"";tip=record[@"detail"];if([record[@"state"] isEqual:@"복구 필요"])color=[NSColor colorWithCalibratedRed:.7 green:.16 blue:.12 alpha:1];}
    else {NSDictionary *item=self.previewItems[index],*row=nil;for(NSDictionary *r in self.comparison[@"rows"])if([r[@"path"] isEqual:item[@"path"]])row=r;BOOL removed=[item[@"kind"] isEqual:@"removed"];
        if([column.identifier isEqual:@"index"])text=[NSString stringWithFormat:@"%ld",(long)index+1];else if([column.identifier isEqual:@"name"])text=item[@"name"];else if([column.identifier isEqual:@"status"]){text=removed ? @"순서에서 빠짐 · 파일 유지" : [item[@"kind"] isEqual:@"header"] ? @"구분" : [row[@"status"] isEqual:@"same"] ? @"그대로" : [row[@"status"] isEqual:@"download"] ? (row[@"localHash"]==NSNull.null ? @"새 문서 · 폴더에 추가" : @"문서 변경 · 받기") : [row[@"status"] isEqual:@"upload"] ? @"Mac 문서 → 서버로 보내기" : [row[@"status"] isEqual:@"conflict"] ? @"문서 충돌 · 비교 필요" : @"파일 누락 · 참조 확인";if([item[@"composition"] length])text=[NSString stringWithFormat:@"%@ · %@",item[@"composition"],text];if([item[@"sharedWith"] count] && [row[@"status"] isEqual:@"download"])text=[text stringByAppendingFormat:@" · %lu곳",(unsigned long)[item[@"sharedWith"] count]+1];}else {NSDictionary *doc=row[@"remote"];text=[doc isKindOfClass:NSDictionary.class] ? [NSString stringWithFormat:@"%@ · %@",YBDisplayDate(doc[@"updatedAt"]),doc[@"updatedBy"] ?: @"—"] : @"—";}tip=[item[@"path"] isKindOfClass:NSString.class] ? item[@"path"] : @"";if(removed)color=NSColor.secondaryLabelColor;
    }
    NSTextField *field=YBLabel(text ?: @"",NSMakeRect(0,2,column.width,24),12,NO);field.selectable=NO;field.toolTip=tip.length ? tip : text;field.textColor=([table.selectedRowIndexes containsIndex:index] && table.window.firstResponder==table && table.window.keyWindow && NSApp.active) ? NSColor.alternateSelectedControlTextColor : color;return field;
}
- (void)receiveAll:(id)sender {
    if(self.work.busy)return;NSMutableArray *selected=[NSMutableArray array];NSUInteger skipped=0;
    for(NSDictionary *choice in self.choices){NSDictionary *c=self.comparisons[[self choiceKey:choice]];if(![c[@"ready"] boolValue]){skipped++;continue;}BOOL changed=[c[@"orderChanged"] boolValue];for(NSDictionary *r in c[@"rows"])if([r[@"status"] isEqual:@"download"])changed=YES;if(changed)[selected addObject:c];}
    if(!selected.count){YBAlert(@"받을 변경이 없습니다.",@"먼저 비교하고 누락/충돌 상태를 확인하세요.");return;}
    NSAlert *alert=[NSAlert new];alert.messageText=@"변경된 예배를 함께 받을까요?";alert.informativeText=[NSString stringWithFormat:@"%lu개 예배의 순서를 하나의 파일로 합치고 공유 문서는 한 번 받습니다. 누락/충돌 %lu개 예배는 제외합니다.",(unsigned long)selected.count,(unsigned long)skipped];[alert addButtonWithTitle:@"함께 받기"];[alert addButtonWithTitle:@"취소"];if([alert runModal]!=NSAlertFirstButtonReturn)return;
    [self.work run:^id{return [[self engine] receiveComparisons:selected progress:^(NSString *message){dispatch_async(dispatch_get_main_queue(),^{self.status.stringValue=message;});}];} completion:^(id result,NSString *error){if(error){self.status.stringValue=@"미완료 · 중단 복구 후 다시 비교하세요.";YBAlert(@"예배 묶음 동기화 중단",error);}else{[self refresh:nil];}}];
}
- (void)receive:(id)sender {
    if(self.work.busy)return;if(!self.comparison){[self refresh:nil];return;}if(self.comparison && ![self.comparison[@"ready"] boolValue]){[self resolveSelected:nil];return;}if(!self.receiveButton.enabled || ![self.comparison[@"ready"] boolValue]){YBAlert(@"먼저 순서를 비교해 주세요.",@"문서 누락/충돌을 해결한 뒤 다시 비교하면 받을 수 있습니다.");return;}NSDictionary *comparison=self.comparison;
    if(!YBConfirm(@"이 플레이리스트를 Mac에 적용할까요?",[NSString stringWithFormat:@"%@\n%@\n\n연결 문서를 먼저 백업·적용하고 선택한 순서를 반영합니다. 공유 문서 변경은 다른 예배에도 반영됩니다. PP6를 종료하세요.",comparison[@"manifest"][@"playlist"][@"name"],self.target.path],@"백업 후 동기화"))return;
    [self.work run:^id{return [[self engine] receive:comparison progress:^(NSString *message){dispatch_async(dispatch_get_main_queue(),^{self.status.stringValue=message;});}];} completion:^(NSString *identifier,NSString *error){self.comparison=nil;self.receiveButton.enabled=NO;self.receiveAllButton.enabled=NO;[self.table reloadData];if(error){self.status.stringValue=@"미완료 · 백업 / 중단 복구를 확인하세요.";YBAlert(@"플레이리스트 동기화 중단",error);}else{self.status.stringValue=@"플레이리스트와 문서 적용 완료 · PP6에서 같은 순서를 확인하세요.";NSString *warning=[self engine].library.sync.backupWarning;if(warning.length)YBAlert(@"동기화 완료 · 백업 정리 안내",warning);[self refresh:nil];}}];
}
- (NSArray *)recoveryRecordsForSync:(YBSync *)sync jobs:(NSArray *)jobs {
    NSArray *transactions=sync.transactions;NSMutableArray *records=[NSMutableArray array];NSMutableSet *owned=[NSMutableSet set];NSISO8601DateFormatter *iso=[NSISO8601DateFormatter new];NSDateFormatter *date=[NSDateFormatter new];date.dateFormat=@"yyyy.MM.dd HH:mm";date.timeZone=[NSTimeZone timeZoneWithName:@"Asia/Seoul"];
    for(NSDictionary *job in jobs){NSMutableArray *members=[NSMutableArray array];for(NSDictionary *t in transactions)if([t[@"batchID"] isEqual:job[@"batchID"]] || [job[@"transactionIDs"] containsObject:t[@"id"]] || (!job[@"batchID"] && !job[@"transactionIDs"] && job[@"initialTransactions"] && ![job[@"initialTransactions"] containsObject:t[@"id"]])){[members addObject:t];[owned addObject:t[@"id"]];}BOOL preparing=[job[@"status"] isEqual:@"preparing-media"];NSString *state=[job[@"status"] isEqual:@"restored"] ? @"복구 완료" : [job[@"status"] isEqual:@"committed"] ? @"완료" : preparing ? @"미디어 준비 중단 · 다시 비교" : @"복구 필요";BOOL restorable=!preparing&&![job[@"status"] isEqual:@"restored"];[records addObject:@{@"kind":@"playlist",@"data":job,@"members":members,@"at":job[@"createdAt"],@"time":[date stringFromDate:[NSDate dateWithTimeIntervalSince1970:[job[@"createdAt"] doubleValue]]],@"target":job[@"name"],@"summary":[NSString stringWithFormat:@"문서 %lu개와 순서",(unsigned long)members.count],@"state":state,@"detail":[NSString stringWithFormat:@"%@\n%@",job[@"target"] ?: @"",[[members valueForKey:@"path"] componentsJoinedByString:@"\n"]],@"canRestore":@(restorable)}];}
    for(NSDictionary *batch in sync.backupBatches){if(![batch[@"kind"] isEqual:@"documents"] || [@[@"pruned",@"pruning"] containsObject:batch[@"status"]])continue;NSMutableArray *members=[NSMutableArray array],*names=[NSMutableArray array];NSUInteger active=0;for(NSDictionary *t in transactions)if([t[@"batchID"] isEqual:batch[@"id"]]){[members addObject:t];[names addObject:t[@"path"]];[owned addObject:t[@"id"]];if([@[@"prepared",@"applied",@"committed",@"restoring"] containsObject:t[@"status"]])active++;}NSString *state=!members.count ? @"적용 없음" : !active ? @"복구 완료" : [batch[@"status"] isEqual:@"complete"] ? @"완료" : @"복구 필요";[records addObject:@{@"kind":@"documents",@"data":batch,@"members":members,@"at":batch[@"createdAt"],@"time":[date stringFromDate:[NSDate dateWithTimeIntervalSince1970:[batch[@"createdAt"] doubleValue]]],@"target":@"문서 받기",@"summary":[NSString stringWithFormat:@"%lu개 문서",(unsigned long)members.count],@"state":state,@"detail":[names componentsJoinedByString:@"\n"],@"canRestore":@(active>0)}];}
    for(NSDictionary *t in transactions)if(![owned containsObject:t[@"id"]]){NSDate *created=[iso dateFromString:t[@"createdAt"]] ?: [NSDate dateWithTimeIntervalSince1970:0];BOOL active=[@[@"prepared",@"applied",@"committed",@"restoring"] containsObject:t[@"status"]];[records addObject:@{@"kind":@"legacy",@"data":t,@"members":@[t],@"at":@(created.timeIntervalSince1970),@"time":[date stringFromDate:created],@"target":t[@"path"],@"summary":@"개별 문서 · 구버전 기록",@"state":active ? ([t[@"status"] isEqual:@"committed"] ? @"완료" : @"복구 필요") : @"복구 완료",@"detail":t[@"path"],@"canRestore":@(active)}];}
    return [records sortedArrayUsingDescriptors:@[[NSSortDescriptor sortDescriptorWithKey:@"at" ascending:NO]]];
}
- (NSView *)recoveryView {NSView *view=[[NSView alloc] initWithFrame:NSMakeRect(0,0,840,380)];self.recoveryTable=YBTable(view,NSMakeRect(0,115,840,265),@[@[@"time",@"시각",@110],@[@"target",@"대상",@250],@[@"summary",@"한 일",@300],@[@"state",@"상태",@140]],self);self.recoveryTable.allowsMultipleSelection=NO;NSScrollView *details=[[NSScrollView alloc] initWithFrame:NSMakeRect(0,0,840,104)];details.hasVerticalScroller=YES;details.borderType=NSBezelBorder;self.recoveryDetails=[[NSTextView alloc] initWithFrame:details.bounds];self.recoveryDetails.editable=NO;self.recoveryDetails.font=[NSFont systemFontOfSize:12];self.recoveryDetails.verticallyResizable=YES;self.recoveryDetails.textContainer.widthTracksTextView=YES;self.recoveryDetails.autoresizingMask=NSViewWidthSizable;self.recoveryDetails.string=@"기록을 선택하면 포함 문서와 경로를 볼 수 있습니다.";details.documentView=self.recoveryDetails;[view addSubview:details];[self.recoveryTable reloadData];return view;}
- (void)recoverySelection {NSInteger i=self.recoveryTable.selectedRow;NSDictionary *r=i>=0 && (NSUInteger)i<self.recoveryRecords.count ? self.recoveryRecords[i] : nil;self.recoveryDetails.string=r[@"detail"] ?: @"기록을 선택하세요.";if(self.recoveryAlert.buttons.count)self.recoveryAlert.buttons[0].enabled=[r[@"canRestore"] boolValue];}
- (void)restore:(id)sender {
    if(self.work.busy)return;[self.work run:^id{YBLibrary *library=[self.documents connectedLibrary];YBPlaylistSync *engine=[[YBPlaylistSync alloc] initWithLibrary:library target:self.target];return [self recoveryRecordsForSync:library.sync jobs:engine.jobs];} completion:^(NSArray *records,NSString *error){if(error){YBAlert(@"복구 기록",error);return;}self.recoveryRecords=records;NSAlert *alert=[NSAlert new];self.recoveryAlert=alert;alert.messageText=@"이 Mac의 복구 기록";alert.informativeText=@"완료된 받기 작업 10회를 보관합니다. 중단·구버전 기록은 추가 보존합니다. 작업에서 바뀐 문서와 순서를 함께 되돌리며 새 문서는 제거합니다. 이후 따로 고친 파일은 덮어쓰지 않습니다. 서버 이력은 유지합니다.";alert.accessoryView=[self recoveryView];[alert addButtonWithTitle:@"이 작업 전으로 되돌리기"];[alert addButtonWithTitle:@"백업 폴더 열기"];[alert addButtonWithTitle:@"닫기"];alert.buttons[0].enabled=NO;if(records.count)[self.recoveryTable selectRowIndexes:[NSIndexSet indexSetWithIndex:0] byExtendingSelection:NO];NSModalResponse response=[alert runModal];NSInteger index=self.recoveryTable.selectedRow;self.recoveryAlert=nil;if(response==NSAlertSecondButtonReturn){[NSWorkspace.sharedWorkspace openURL:[NSURL fileURLWithPath:[self.documents connectedLibrary].sync.profile]];return;}if(response!=NSAlertFirstButtonReturn || index<0 || (NSUInteger)index>=records.count)return;NSDictionary *record=records[index];if(![record[@"canRestore"] boolValue])return;
        [self.work run:^id{YBLibrary *library=[self.documents connectedLibrary];NSDictionary *data=record[@"data"];if([record[@"kind"] isEqual:@"playlist"])[[[YBPlaylistSync alloc] initWithLibrary:library target:[NSURL fileURLWithPath:data[@"target"]]] restoreJob:data[@"id"]];else if([record[@"kind"] isEqual:@"documents"])[library.sync restoreBackupBatch:data[@"id"]];else if([data[@"status"] isEqual:@"committed"])[library.sync restore:data[@"id"]];else [library.sync recover:data[@"id"]];return @YES;} completion:^(id value,NSString *failure){self.comparison=nil;[self.comparisons removeAllObjects];[self updateReceiveAll];[self.table reloadData];self.receiveButton.enabled=NO;self.status.stringValue=failure ? @"복구 미완료 · 현재 파일 유지 여부와 기록을 확인하세요." : @"작업 전으로 복구했습니다. 다시 비교하세요.";if(failure)YBAlert(@"복구 미완료",failure);else [self.documents refresh:nil];}];
    }];
}
- (void)openBackupFolder:(id)sender {if(self.work.busy)return;@try{[NSWorkspace.sharedWorkspace openURL:[NSURL fileURLWithPath:[self.documents connectedLibrary].sync.profile]];}@catch(NSException *e){YBAlert(@"백업 폴더",e.reason);}}
- (void)openStudio:(id)sender {[NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:@"https://yebaeon.grace-jean-p.workers.dev/"]];}

- (NSView *)comparisonView:(NSDictionary *)comparison {
    NSArray *local=comparison[@"localNode"][@"items"] ?: @[],*remote=comparison[@"manifest"][@"items"] ?: @[];
    NSMutableArray *rows=[NSMutableArray array];
    for(NSUInteger i=0;i<MAX(local.count,remote.count);i++){
        NSDictionary *left=i<local.count ? local[i] : nil,*right=i<remote.count ? remote[i] : nil;
        NSString *leftID=left[@"attrs"][@"UUID"],*rightID=right[@"id"];
        BOOL same=left && right && leftID.length && [leftID isEqual:rightID];
        NSString *state=!left ? @"서버에만 순서 있음" : !right ? @"Mac에만 순서 있음" : same ? @"같은 순서" : @"순서·항목 다름";
        NSDictionary *docRow=nil;for(NSDictionary *r in comparison[@"rows"])if([r[@"path"] isEqual:right[@"path"]]){docRow=r;break;}
        NSString *document=[right[@"kind"] isEqual:@"header"] ? @"구분선" : [docRow[@"status"] isEqual:@"upload"] ? @"Mac에 있음 → 보내기" : [docRow[@"status"] isEqual:@"missing"] ? @"양쪽 파일 없음 · 건너뜀" : docRow ? YBStatusName(docRow[@"status"]) : [right[@"issue"] isEqual:@"missing"] ? @"서버 파일 없음" : right[@"issue"] && right[@"issue"]!=NSNull.null ? @"연결 확인 필요" : @"—";
        [rows addObject:@{@"index":[NSString stringWithFormat:@"%lu",(unsigned long)i+1],@"local":left[@"attrs"][@"displayName"] ?: left[@"tag"] ?: @"—",@"remote":right[@"name"] ?: @"—",@"order":state,@"document":document,@"changed":@(!same)}];
    }
    self.comparisonRows=rows;NSView *view=[[NSView alloc] initWithFrame:NSMakeRect(0,0,880,360)];
    self.comparisonTable=YBTable(view,view.bounds,@[@[@"index",@"순번",@40],@[@"local",@"Mac 순서",@250],@[@"remote",@"서버 순서",@250],@[@"order",@"순서 비교",@130],@[@"document",@"연결 문서",@190]],self);self.comparisonTable.rowHeight=32;[self.comparisonTable reloadData];return view;
}
- (void)resolveSelected:(id)sender {
    if(self.work.busy || !self.comparison)return;NSDictionary *comparison=self.comparison,*manifest=comparison[@"manifest"];
    NSAlert *alert=[NSAlert new];alert.messageText=[@"재생목록 비교 · " stringByAppendingString:manifest[@"playlist"][@"name"] ?: @"예배"];
    alert.informativeText=@"왼쪽은 Mac, 오른쪽은 서버의 현재 순서입니다. 순서 차이와 문서 파일 상태를 따로 표시합니다. 서버에 없는 문서는 Mac 내용 사용으로 보낼 수 있습니다.";
    alert.accessoryView=[self comparisonView:comparison];
    [alert addButtonWithTitle:@"Mac 내용 사용…"];[alert addButtonWithTitle:@"서버 내용 사용…"];[alert addButtonWithTitle:@"문서별 확인"];[alert addButtonWithTitle:@"다시 비교"];[alert addButtonWithTitle:@"닫기"];
    alert.buttons[0].enabled=[comparison[@"localNode"] count]>0;alert.buttons[1].enabled=[manifest[@"ready"] boolValue];
    NSModalResponse answer=[alert runModal];
    if(answer==NSAlertFirstButtonReturn){[self prepareMacReset:comparison];return;}
    if(answer==NSAlertThirdButtonReturn){[self.documents showComparisonDocuments:comparison];if(self.showDocuments)self.showDocuments();return;}
    if(answer==NSAlertFirstButtonReturn+3){[self refresh:nil];return;}
    if(answer!=NSAlertSecondButtonReturn)return;
    if(!YBConfirm(@"서버 내용으로 이 예배를 맞출까요?",[NSString stringWithFormat:@"%@\nMac의 다른 내용은 백업한 후 서버 문서와 순서를 적용합니다. 공유 문서도 바뀝니다. PP6를 종료해 주세요.",manifest[@"playlist"][@"name"]],@"백업 후 서버 내용 받기"))return;
    [self.work run:^id{return [[self engine] receiveChoosingServer:comparison progress:^(NSString *message){dispatch_async(dispatch_get_main_queue(),^{self.status.stringValue=message;});}];} completion:^(id result,NSString *error){if(error){YBAlert(@"해결 작업 미완료",error);self.status.stringValue=@"중단 기록을 확인하고 다시 비교하세요.";}else [self refresh:nil];}];
}
- (void)resetServer:(id)sender {if(!self.work.busy)[self prepareMacReset:nil];}
- (void)applyManagedRemovals:(id)sender {
    if(self.work.busy)return;
    [self.work run:^id{return [[self engine] prepareManagedRemovals];} completion:^(NSDictionary *prepared,NSString *error){
        if(error){YBAlert(@"목록 정리 준비 중단",error);return;}
        if(![prepared[@"removals"] count]){YBAlert(@"목록 정리",@"이 Mac에서 제외할 보관·삭제 목록이 없습니다.");return;}
        NSMutableString *summary=[NSMutableString stringWithString:@"웹에서 보관·삭제한 아래 목록을 이 Mac의 사용 중 목록에서 제외합니다. 문서와 미디어는 그대로 남습니다. 원본은 백업하며 복구 기록에서 되돌릴 수 있습니다.\n"];
        for(NSDictionary *item in prepared[@"removals"])[summary appendFormat:@"\n• %@",item[@"name"]];
        if(!YBConfirm(@"웹의 목록 정리를 이 Mac에 반영할까요?",summary,@"백업하고 반영"))return;
        [self.work run:^id{return [[self engine] applyManagedRemovals:prepared];} completion:^(id result,NSString *failure){if(failure){YBAlert(@"목록 정리 미완료",failure);return;}[self refresh:nil];self.status.stringValue=@"보관·삭제 목록 정리 완료 · 문서와 미디어 유지";}];
    }];
}
- (void)prepareMacReset:(NSDictionary *)comparison {
    [self.work runPausable:YES task:^id{return [[self engine] prepareMacReset:comparison progress:^(NSString *message){dispatch_async(dispatch_get_main_queue(),^{self.status.stringValue=message;self.work.message=message;});}];} completion:^(NSDictionary *prepared,NSString *error){
        if(error){YBAlert(@"서버 맞추기 준비 중단",error);return;}
        NSMutableString *summary=[NSMutableString stringWithFormat:@"Mac 문서 폴더: %@\n재생목록: %@\n\n문서 %lu개 중 변경/신규 %@개를 보냅니다. 선택한 순서 %lu개를 서버에 반영하고 공통 비교 기준을 연결합니다.\n서버에만 있는 문서 %lu개는 유지합니다. 미디어와 과거 이력은 삭제하지 않습니다.\n\n백업: %@/server-resets/%@\n",prepared[@"root"],prepared[@"target"],(unsigned long)[prepared[@"rows"] count],prepared[@"changed"],(unsigned long)[prepared[@"nodes"] count],(unsigned long)[prepared[@"serverOnly"] count],YBProfilePath(self.documents.documentsRoot,@"https://yebaeon.grace-jean-p.workers.dev"),prepared[@"id"]];
        [summary appendFormat:@"\n서버에만 있는 재생목록 %lu개도 유지합니다.\n",(unsigned long)[prepared[@"serverOnlyPlaylists"] count]];for(NSDictionary *node in prepared[@"serverOnlyPlaylists"])[summary appendFormat:@"• %@\n",node[@"name"]];
        if([prepared[@"missingReferences"] count])[summary appendFormat:@"\nMac 파일 누락 %lu개는 건너뛰고 나머지를 보냅니다. 순서의 참조와 기존 서버 문서는 유지합니다.\n%@\n",(unsigned long)[prepared[@"missingReferences"] count],[prepared[@"missingReferences"] componentsJoinedByString:@"\n"]];
        NSUInteger shown=0;for(NSDictionary *row in prepared[@"rows"]){if(shown++>=12){[summary appendString:@"… 나머지 항목은 백업 폴더의 job.json에 기록됩니다.\n"];break;}[summary appendFormat:@"\n%@",row[@"path"]];}
        if(!YBConfirm(comparison ? @"선택한 예배를 Mac 내용으로 맞출까요?" : @"이 Mac 기준으로 서버를 다시 맞출까요?",summary,@"백업 확인 · 서버에 반영"))return;
        [self.work runPausable:YES task:^id{return [[self engine] applyMacReset:prepared progress:^(NSString *message){dispatch_async(dispatch_get_main_queue(),^{self.status.stringValue=message;self.work.message=message;});}];} completion:^(NSDictionary *job,NSString *failure){
            if(failure){self.status.stringValue=@"서버 맞추기 미완료 · 완료분/백업 보존";YBAlert(@"서버 맞추기 미완료",failure);return;}
            self.status.stringValue=@"Mac 기준 서버 저장·내용 검증·공통 기준 연결 완료";[self refresh:nil];
        }];
    }];
}

@end


