#import "YBDocumentComparison.h"
#import "YBDocumentsController.h"
#import "YBLibrary.h"
#import "YBPlaylistFormat.h"
#import "YBPlaylistIO.h"
#import "../mac-sync/PP6Core.h"
@interface YBDocumentsController () <NSTableViewDataSource,NSTableViewDelegate,NSSearchFieldDelegate>
@property(nonatomic,readwrite) NSView *view;
@property(nonatomic,readwrite) NSString *documentsRoot;
@property YBWork *work;
@property YBLibrary *library;
@property YBServer *server;
@property NSTableView *table;
@property NSSearchField *search;
@property NSTextField *rootLabel;
@property NSTextField *sessionLabel;
@property NSTextField *statusLabel;
@property NSArray *rows;
@property NSArray *visibleRows;
@property NSMutableSet *checked;
@property BOOL sessionLoaded;
@property NSPopUpButton *order;
@property NSSegmentedControl *direction;
@property NSButton *usedOnly;
@property NSButton *applyButton;
@property NSButton *allButton;
@property NSProgressIndicator *progress;
@property NSDictionary *uses;
@property(nonatomic) NSURL *playlistFile;
@property BOOL updatingSelection;
@property BOOL backgroundScheduled;
@property BOOL backgroundRunning;
@property BOOL backgroundNeedsResume;
@property NSUInteger comparisonEpoch;
@property NSTextField *summaryLabel;
@property NSTextField *selectionHint;
@property NSTextField *transferCount;
@property BOOL transferActive;
@end
@implementation YBDocumentsController
- (instancetype)initWithWork:(YBWork *)work {
    if((self=[super init])) {
        self.work=work;self.rows=@[];self.visibleRows=@[];self.checked=[NSMutableSet set];
        id saved=YBPreferences(@"documents-settings.json")[@"root"];
        self.documentsRoot=[saved isKindOfClass:NSString.class] && [saved isAbsolutePath] ? saved : [NSHomeDirectory() stringByAppendingPathComponent:@"Documents/ProPresenter6"];
        self.server=[[YBServer alloc] initWithOrigin:@"https://yebaeon.grace-jean-p.workers.dev" allowLocalTestServer:NO];
        [self buildView];
    }return self;
}
- (void)buildView {
    YBPanel *v=[[YBPanel alloc] initWithFrame:NSMakeRect(0,0,1060,720)];self.view=v;
    self.rootLabel=YBLabel(self.documentsRoot,NSZeroRect,12,NO);self.sessionLabel=YBLabel(@"연결 안 됨",NSZeroRect,12,NO);
    self.direction=[[NSSegmentedControl alloc] initWithFrame:NSMakeRect(24,620,700,32)];self.direction.segmentCount=5;self.direction.trackingMode=NSSegmentSwitchTrackingSelectOne;self.direction.selectedSegment=0;self.direction.target=self;self.direction.action=@selector(directionChanged:);NSArray *labels=@[@"전체",@"받기",@"보내기",@"충돌",@"제외"];for(NSInteger i=0;i<5;i++){[self.direction setLabel:labels[i] forSegment:i];[self.direction setWidth:132 forSegment:i];}[v addSubview:self.direction];
    self.order=[[NSPopUpButton alloc] initWithFrame:NSMakeRect(810,620,226,32) pullsDown:NO];[self.order addItemsWithTitles:@[@"최근 사용순",@"이름순"]];self.order.target=self;self.order.action=@selector(orderChanged:);[v addSubview:self.order];
    self.usedOnly=YBButton(@"재생목록에서 쓰는 문서만",NSMakeRect(24,580,300,28),self,@selector(filterChanged:));self.usedOnly.buttonType=NSSwitchButton;[v addSubview:self.usedOnly];
    self.search=[[NSSearchField alloc] initWithFrame:NSMakeRect(500,580,536,28)];self.search.placeholderString=@"문서 이름이나 폴더 검색";self.search.delegate=self;[v addSubview:self.search];
    self.table=YBTable(v,NSMakeRect(24,155,1012,410),@[@[@"check",@"☐",@38],@[@"status",@"상태",@104],@[@"path",@"문서",@265],@[@"uses",@"쓰는 예배",@75],@[@"lastUsed",@"최근 사용일",@145],@[@"modified",@"Mac 수정",@145],@[@"author",@"서버 저장 · 작업자",@210]],self);
    self.table.allowsMultipleSelection=YES;self.table.target=self;self.table.doubleAction=@selector(preview:);NSMenu *menu=[NSMenu new];NSMenuItem *item=[menu addItemWithTitle:@"문서 내용 비교" action:@selector(preview:) keyEquivalent:@""];item.target=self;self.table.menu=menu;
    for(NSTableColumn *column in self.table.tableColumns)if(![column.identifier isEqual:@"check"]){NSString *key=[@{@"lastUsed":@"lastUsedTime",@"modified":@"modifiedTime",@"author":@"remote.updatedAt"} objectForKey:column.identifier] ?: column.identifier;column.sortDescriptorPrototype=[NSSortDescriptor sortDescriptorWithKey:key ascending:[column.identifier isEqual:@"path"]];}
    self.progress=[[NSProgressIndicator alloc] initWithFrame:NSMakeRect(24,130,1012,12)];self.progress.indeterminate=NO;self.progress.minValue=0;self.progress.maxValue=1;self.progress.hidden=YES;[v addSubview:self.progress];
    self.statusLabel=YBLabel(@"서버와 비교해 받기·보내기 방향을 선택하세요.",NSMakeRect(24,100,1012,25),12,NO);self.statusLabel.hidden=YES;[v addSubview:self.statusLabel];
    self.summaryLabel=YBLabel(self.statusLabel.stringValue,NSZeroRect,12,NO);self.summaryLabel.textColor=[NSColor colorWithCalibratedRed:.42 green:.42 blue:.42 alpha:1];[v addSubview:self.summaryLabel];
    self.selectionHint=YBLabel(@"",NSZeroRect,12,NO);self.selectionHint.textColor=self.summaryLabel.textColor;[v addSubview:self.selectionHint];
    self.transferCount=YBLabel(@"",NSZeroRect,11,NO);self.transferCount.hidden=YES;[v addSubview:self.transferCount];
    NSButton *recovery=YBButton(@"복구 기록…",NSZeroRect,self,@selector(backups:));[v addSubview:recovery];
    self.allButton=YBButton(@"전체 선택 ⌘A",NSMakeRect(178,35,156,36),self,@selector(selectVisible:));[v addSubview:self.allButton];NSButton *clear=YBButton(@"선택 해제",NSZeroRect,self,@selector(clearSelection:));[v addSubview:clear];
    NSTextField *divider=YBLabel(@"│",NSZeroRect,17,NO);divider.textColor=self.summaryLabel.textColor;[v addSubview:divider];

    self.applyButton=YBButton(@"방향을 선택하세요",NSMakeRect(826,35,210,36),self,@selector(applySelected:));self.applyButton.font=[NSFont boldSystemFontOfSize:13];[v addSubview:self.applyButton];[self updateSelection];
    __weak YBDocumentsController *weakSelf=self;
    v.frameLayout=^(NSSize size){YBDocumentsController *c=weakSelf;CGFloat w=size.width,h=size.height,m=14;
        BOOL wide=w>=1280;CGFloat filterWidth=470;CGFloat y=h-36;
        c.direction.frame=NSMakeRect(m,y,filterWidth,30);for(NSInteger i=0;i<5;i++)[c.direction setWidth:(filterWidth-10)/5 forSegment:i];
        c.usedOnly.frame=NSMakeRect(wide ? m+filterWidth+12 : m,wide ? y : y-36,208,28);
        c.order.frame=NSMakeRect(w-m-138,wide ? y : y-36,138,30);
        CGFloat searchX=wide ? m+filterWidth+232 : m+224;
        c.search.frame=NSMakeRect(searchX,wide ? y+1 : y-35,w-m-150-searchX,26);
        CGFloat top=wide ? y-10 : y-46;c.table.enclosingScrollView.frame=NSMakeRect(m,90,w-2*m,MAX(80,top-90));
        c.summaryLabel.frame=NSMakeRect(m,62,w-2*m,22);
        recovery.frame=NSMakeRect(m,14,126,32);divider.frame=NSMakeRect(m+133,17,16,25);
        c.allButton.frame=NSMakeRect(m+156,14,138,32);clear.frame=NSMakeRect(m+302,14,106,32);
        c.applyButton.frame=NSMakeRect(w-m-190,14,190,32);
        c.selectionHint.frame=NSMakeRect(m+422,19,MAX(0,w-2*m-622),22);c.selectionHint.alignment=NSTextAlignmentRight;
        c.progress.frame=NSMakeRect(w-m-320,36,116,8);c.transferCount.frame=NSMakeRect(w-m-320,15,116,18);
    };v.frameLayout(v.bounds.size);
}
- (NSString *)selectedDirection {return self.direction.selectedSegment==1 ? @"download" : self.direction.selectedSegment==2 ? @"upload" : nil;}
- (void)updateSelection {NSString *direction=[self selectedDirection];self.applyButton.title=direction ? [NSString stringWithFormat:@"%@ %lu개",[direction isEqual:@"download"] ? @"받기" : @"보내기",(unsigned long)self.checked.count] : @"방향을 선택하세요";self.applyButton.enabled=direction && self.checked.count && !self.work.busy;self.allButton.enabled=direction && !self.work.busy;self.selectionHint.stringValue=direction && self.checked.count ? [NSString stringWithFormat:@"%lu개 · %@",(unsigned long)self.checked.count,[direction isEqual:@"download"] ? @"서버에서 이 Mac으로" : @"이 Mac에서 서버로"] : @"";self.selectionHint.toolTip=self.selectionHint.stringValue;}
- (void)directionChanged:(id)sender {[self.checked removeAllObjects];[self filter];}
- (void)filterChanged:(id)sender {[self.checked removeAllObjects];[self filter];}
- (void)applySelected:(id)sender {NSString *direction=[self selectedDirection];if(direction)[self transfer:[direction isEqual:@"download"]];}
- (void)setPlaylistFile:(NSURL *)url {_playlistFile=url;NSMutableDictionary *uses=[NSMutableDictionary dictionary];@try{if(url)for(NSDictionary *node in YBPlaylistNodes(YBReadPlaylist(url))){NSMutableSet *paths=[NSMutableSet set];for(NSDictionary *item in node[@"items"]){NSString *path=YBPlaylistReference(item[@"attrs"][@"filePath"],self.documentsRoot) ?: YBPlaylistReference(item[@"attrs"][@"filePath"],@"~/Documents/ProPresenter6");if(path)[paths addObject:path];}for(NSString *path in paths){NSMutableArray *names=uses[path];if(!names){names=[NSMutableArray array];uses[path]=names;}[names addObject:node[@"name"] ?: @"예배"];}}}@catch(NSException *e){self.statusLabel.stringValue=[@"재생목록 참조를 읽지 못했습니다: " stringByAppendingString:e.reason];}self.uses=uses;self.usedOnly.enabled=url!=nil;if(!url)self.usedOnly.state=NSControlStateValueOff;[self filter];}
- (void)tableView:(NSTableView *)table sortDescriptorsDidChange:(NSArray *)oldDescriptors {NSSortDescriptor *sort=table.sortDescriptors.firstObject;if(!sort)return;self.rows=[self.rows sortedArrayUsingComparator:^NSComparisonResult(NSDictionary *a,NSDictionary *b){id x=nil,y=nil;if([sort.key isEqual:@"remote.updatedAt"]){x=[a[@"remote"] isKindOfClass:NSDictionary.class]?a[@"remote"][@"updatedAt"]:nil;y=[b[@"remote"] isKindOfClass:NSDictionary.class]?b[@"remote"][@"updatedAt"]:nil;}else if([sort.key isEqual:@"uses"]){x=@([self.uses[a[@"path"]] count]);y=@([self.uses[b[@"path"]] count]);}else{x=a[sort.key];y=b[sort.key];}if(x==NSNull.null)x=nil;if(y==NSNull.null)y=nil;if(!x&&y)return NSOrderedDescending;if(x&&!y)return NSOrderedAscending;NSComparisonResult order=x&&y?[x compare:y]:NSOrderedSame;return order==NSOrderedSame?[a[@"path"] compare:b[@"path"]]:(sort.ascending?order:-order);}];[self filter];}
- (void)tableView:(NSTableView *)table didClickTableColumn:(NSTableColumn *)column {if([column.identifier isEqual:@"check"])[self selectVisible:nil];}
- (void)tableViewSelectionDidChange:(NSNotification *)note {if(self.updatingSelection||self.work.busy)return;[self.checked removeAllObjects];NSString *direction=[self selectedDirection];[self.table.selectedRowIndexes enumerateIndexesUsingBlock:^(NSUInteger index,BOOL *stop){if(index<self.visibleRows.count){NSDictionary *row=self.visibleRows[index];if([row[@"status"] isEqual:direction] && !row[@"error"])[self.checked addObject:row[@"path"]];}}];self.updatingSelection=YES;[self.table reloadData];self.updatingSelection=NO;[self updateSelection];}
- (YBLibrary *)connectedLibrary {
    if(!self.library){self.library=[[YBLibrary alloc] initWithRoot:self.documentsRoot profile:YBProfilePath(self.documentsRoot,self.server.origin) server:self.server];
        __weak YBWork *work=self.work;self.library.operationCheckpoint=^{[work checkpoint];};self.library.sync.comparisonCheck=self.library.operationCheckpoint;
    }
    self.library.mediaReceiveRoot=YBPreferences(@"media-settings.json")[@"receiveRoot"];return self.library;
}
- (void)ensureSessionLoaded {if(!self.sessionLoaded){[self.server loadSession];self.sessionLoaded=YES;}}
- (void)acceptRows:(NSArray *)rows {
    self.rows=rows ?: @[];[self.checked removeAllObjects];[self sortRows];[self filter];
    NSMutableDictionary *count=[NSMutableDictionary dictionary];for(NSDictionary *r in self.rows)count[r[@"status"]]=@([count[r[@"status"]] integerValue]+1);
    for(NSInteger i=0;i<5;i++){NSString *key=@[@"all",@"download",@"upload",@"conflict",@"excluded"][i];NSUInteger n=i==0 ? self.rows.count : 0;if(i)for(NSDictionary *r in self.rows)if(i==4 ? [r[@"error"] length]>0 : !r[@"error"] && [r[@"status"] isEqual:key])n++;[self.direction setLabel:[NSString stringWithFormat:@"%@ %lu",@[@"전체",@"받기",@"보내기",@"충돌",@"제외"][i],(unsigned long)n] forSegment:i];}
    self.statusLabel.stringValue=[NSString stringWithFormat:@"전체 %lu · 받기 %@ · 보내기 %@ · 일치 %@ · 충돌 %@",(unsigned long)self.rows.count,count[@"download"] ?: @0,count[@"upload"] ?: @0,count[@"same"] ?: @0,count[@"conflict"] ?: @0];self.summaryLabel.stringValue=self.statusLabel.stringValue;
}
- (void)sortRows {
    BOOL recent=self.order.indexOfSelectedItem==0;
    self.rows=[self.rows sortedArrayUsingComparator:^NSComparisonResult(NSDictionary *a,NSDictionary *b){
        if(recent){NSNumber *x=a[@"lastUsedTime"],*y=b[@"lastUsedTime"];if(x && !y)return NSOrderedAscending;if(!x && y)return NSOrderedDescending;if(x && y){NSComparisonResult order=[y compare:x];if(order!=NSOrderedSame)return order;}}
        return [a[@"path"] compare:b[@"path"]];
    }];
}
- (void)orderChanged:(id)sender {[self sortRows];[self filter];}
- (void)filter {
    NSString *query=self.search.stringValue.precomposedStringWithCanonicalMapping;NSMutableArray *visible=[NSMutableArray array];NSInteger segment=self.direction.selectedSegment;
    for(NSDictionary *row in self.rows){BOOL matches=segment==0 || (segment==4 ? [row[@"error"] length]>0 : !row[@"error"] && [row[@"status"] isEqual:@[@"all",@"download",@"upload",@"conflict"][segment]]);if(!matches)continue;if(self.usedOnly.state==NSControlStateValueOn && ![self.uses[row[@"path"]] count])continue;if(!query.length || [row[@"path"] rangeOfString:query options:NSCaseInsensitiveSearch].location!=NSNotFound)[visible addObject:row];}
    self.visibleRows=visible;NSMutableSet *allowed=[NSMutableSet set];for(NSDictionary *r in visible)if([r[@"status"] isEqual:[self selectedDirection]] && !r[@"error"])[allowed addObject:r[@"path"]];[self.checked intersectSet:allowed];self.updatingSelection=YES;[self.table deselectAll:nil];[self.table reloadData];self.updatingSelection=NO;[self updateSelection];
}
- (void)controlTextDidChange:(NSNotification *)note {[self filterChanged:nil];}
- (void)startupCompare {
    self.statusLabel.stringValue=@"재생목록과 연결 문서를 먼저 확인합니다.";
    [self.work runPausable:YES task:^id{
        [self ensureSessionLoaded];NSMutableDictionary *session=[[self.server request:@"/api/session" method:@"GET" body:nil headers:nil] mutableCopy];BOOL directory=NO;session[@"noFolder"]=@(![NSFileManager.defaultManager fileExistsAtPath:self.documentsRoot isDirectory:&directory] || !directory);return session;
    } completion:^(NSDictionary *session,NSString *error){
        if(error || ![session[@"authenticated"] boolValue]){if(self.sessionChanged)self.sessionChanged(@"입장 필요 / 연결 확인");self.statusLabel.stringValue=error ?: @"입장한 뒤 비교할 수 있습니다.";return;}
        self.sessionLabel.stringValue=[NSString stringWithFormat:@"%@ 연결됨",session[@"name"] ?: @""];if(self.sessionChanged)self.sessionChanged(self.sessionLabel.stringValue);
        if([session[@"noFolder"] boolValue]){self.statusLabel.stringValue=@"문서 폴더를 선택한 뒤 비교해 주세요.";return;}if(self.priorityRequested)self.priorityRequested();else [self backgroundCompare];
    }];
}
- (void)attachComparisonProgress:(YBLibrary *)library {
    NSUInteger epoch=self.comparisonEpoch;
    __weak YBDocumentsController *weakSelf=self;
    library.phaseChanged=^(NSString *message){dispatch_async(dispatch_get_main_queue(),^{if(weakSelf.comparisonEpoch!=epoch || (weakSelf.backgroundRunning && weakSelf.work.busy))return;if(weakSelf.checkStateChanged)weakSelf.checkStateChanged(@"전체 문서 점검",0,0,YES);weakSelf.work.message=message;});};
    library.comparisonProgress=^(NSUInteger done,NSUInteger total){dispatch_async(dispatch_get_main_queue(),^{if(weakSelf.comparisonEpoch!=epoch || (weakSelf.backgroundRunning && weakSelf.work.busy))return;if(weakSelf.checkStateChanged)weakSelf.checkStateChanged(@"전체 문서 점검",done,total,YES);});};
}
- (void)endComparisonProgress:(NSString *)error {
    if(self.checkStateChanged)self.checkStateChanged(error ? @"전체 문서 점검 미완료" : @"전체 문서 점검 끝",self.rows.count,self.rows.count,NO);
}
- (void)mergeComparedRows:(NSArray *)rows {
    NSMutableDictionary *map=[NSMutableDictionary dictionary];for(NSDictionary *row in self.rows)map[row[@"path"]]=row;for(NSDictionary *row in rows)map[row[@"path"]]=row;
    NSSet *checked=[self.checked copy];[self acceptRows:map.allValues];[self.checked unionSet:checked];[self filter];
}
- (void)acceptPriorityComparisons:(NSArray *)comparisons {
    self.comparisonEpoch++;NSMutableDictionary *rows=[NSMutableDictionary dictionary];
    for(NSDictionary *c in comparisons)for(NSDictionary *row in c[@"rows"]){NSDictionary *previous=rows[row[@"path"]];if(previous && ![previous isEqual:row]){NSMutableDictionary *conflict=[row mutableCopy];conflict[@"status"]=@"conflict";conflict[@"error"]=@"공유 문서가 비교 도중 바뀌었습니다. 다시 비교하세요.";rows[row[@"path"]]=conflict;}else rows[row[@"path"]]=row;}
    [self mergeComparedRows:rows.allValues];self.statusLabel.stringValue=[NSString stringWithFormat:@"연결 문서 %lu개 확인 · 나머지는 자동 점검",(unsigned long)rows.count];
    self.backgroundScheduled=NO;self.backgroundNeedsResume=YES;
}
- (void)resumeBackgroundIfNeeded {if(self.backgroundNeedsResume && !self.work.busy && !self.backgroundRunning)[self backgroundCompare];}
- (void)backgroundCompare {
    if(self.backgroundRunning || self.work.busy || (self.backgroundScheduled && !self.backgroundNeedsResume))return;
    self.backgroundScheduled=YES;self.backgroundRunning=YES;self.backgroundNeedsResume=NO;NSUInteger epoch=++self.comparisonEpoch;
    self.statusLabel.stringValue=@"확인한 문서는 바로 사용 가능 · 나머지 문서 자동 점검 중";
    __block BOOL yielded=NO;
    [self.work runBackground:^id(BOOL (^cancelled)(void)){
        void (^check)(void)=^{if(cancelled()){yielded=YES;YBRequire(NO,@"사용자 작업에 점검을 양보합니다.");}};check();YBLibrary *library=[self connectedLibrary];[self attachComparisonProgress:library];
        library.rowsCompared=^(NSArray *rows){dispatch_async(dispatch_get_main_queue(),^{if(self.comparisonEpoch==epoch && !self.work.busy)[self mergeComparedRows:rows];});};
        @try{return [library refreshChecking:check];}@finally{yielded=yielded || cancelled();library.rowsCompared=nil;library.phaseChanged=nil;library.comparisonProgress=nil;}
    } completion:^(NSArray *rows,NSString *error){
        self.backgroundRunning=NO;
        if(self.comparisonEpoch!=epoch){[self resumeBackgroundIfNeeded];return;}
        if(yielded || (error && [error hasPrefix:@"사용자 작업"])){
            self.backgroundNeedsResume=YES;if(self.comparisonEpoch==epoch)self.statusLabel.stringValue=@"사용자 작업 후 나머지 문서 자동 점검을 이어갑니다.";[self resumeBackgroundIfNeeded];return;
        }
        if(self.comparisonEpoch!=epoch){[self resumeBackgroundIfNeeded];return;}
        if(error){self.backgroundNeedsResume=NO;self.statusLabel.stringValue=[@"나머지 문서 점검 미완료 · 다시 비교: " stringByAppendingString:error];[self endComparisonProgress:error];return;}
        [self acceptRows:rows];[self endComparisonProgress:nil];if(self.comparisonFinished)self.comparisonFinished();
    }];
}
- (void)refresh:(id)sender {
    self.comparisonEpoch++;self.backgroundNeedsResume=NO;
    self.statusLabel.stringValue=@"서버와 문서를 비교하고 있습니다…";if(self.checkStateChanged)self.checkStateChanged(@"전체 문서 점검",0,0,YES);
    [self.work runPausable:YES task:^id {
        [self ensureSessionLoaded];NSDictionary *session=[self.server request:@"/api/session" method:@"GET" body:nil headers:nil];
        YBRequire([session[@"authenticated"] boolValue],@"먼저 ‘입장 / 이름 변경’에서 공용 비밀번호로 입장해 주세요.");
        YBLibrary *library=[self connectedLibrary];[self attachComparisonProgress:library];NSArray *rows=nil;@try{rows=[library refresh];}@finally{library.phaseChanged=nil;library.comparisonProgress=nil;}YBSavePreferences(@"last-server-comparison.json",@{@"at":[NSDate.date description],@"root":self.documentsRoot,@"documents":@(rows.count),@"automatic":@NO});return @{@"rows":rows,@"name":session[@"name"] ?: @"",@"pending":@(library.sync.pendingTransactions.count)};
    } completion:^(NSDictionary *result,NSString *error) {
        if(error){self.statusLabel.stringValue=@"비교하지 못했습니다. 입장 상태와 폴더를 확인해 주세요.";[self endComparisonProgress:error];YBAlert(@"문서 비교",error);return;}
        [self acceptRows:result[@"rows"]];self.sessionLabel.stringValue=[NSString stringWithFormat:@"%@ 연결됨",result[@"name"]];if(self.sessionChanged)self.sessionChanged(self.sessionLabel.stringValue);
        if([result[@"pending"] unsignedIntegerValue])self.statusLabel.stringValue=@"중단된 적용이 있습니다. 복구 기록을 먼저 확인하세요.";[self endComparisonProgress:nil];if(self.comparisonFinished)self.comparisonFinished();
    }];
}
- (void)login:(id)sender {
    if(self.work.busy)return;
    NSAlert *alert=[NSAlert new];alert.messageText=@"예배온에 입장하기";alert.informativeText=@"작업자 이름은 서버 저장 이력에 남습니다. 입장 정보는 이 Mac의 키체인에 보관합니다.";
    NSView *form=[[NSView alloc] initWithFrame:NSMakeRect(0,0,340,112)];[form addSubview:YBLabel(@"작업자 이름",NSMakeRect(0,78,110,24),13,NO)];
    NSTextField *name=[[NSTextField alloc] initWithFrame:NSMakeRect(113,76,225,27)];[form addSubview:name];
    [form addSubview:YBLabel(@"공용 비밀번호",NSMakeRect(0,32,110,24),13,NO)];NSSecureTextField *password=[[NSSecureTextField alloc] initWithFrame:NSMakeRect(113,30,225,27)];[form addSubview:password];
    alert.accessoryView=form;[alert addButtonWithTitle:@"입장하기"];[alert addButtonWithTitle:@"취소"];
    if([alert runModal]!=NSAlertFirstButtonReturn){password.stringValue=@"";return;}
    NSString *author=name.stringValue,*secret=password.stringValue;password.stringValue=@"";
    [self.work run:^id {
        NSDictionary *session=[self.server login:author password:secret];self.sessionLoaded=YES;
        NSString *warning=@"";@try{[self.server saveSession];}@catch(NSException *e){warning=e.reason;}
        return @{@"name":session[@"name"] ?: author,@"warning":warning};
    } completion:^(NSDictionary *result,NSString *error) {
        if(error){YBAlert(@"입장하지 못했습니다.",error);return;}
        self.sessionLabel.stringValue=[NSString stringWithFormat:@"%@님으로 입장했습니다.",result[@"name"]];
        if([result[@"warning"] length])YBAlert(@"이번 실행에서 입장했습니다.",result[@"warning"]);
        [self startupCompare];
    }];
}
- (void)resetHistory:(id)sender {
    if(self.work.busy)return;
    if(!YBConfirm(@"동기화 기록을 초기화하고 다시 시작할까요?",[NSString stringWithFormat:@"현재 문서 폴더: %@\n\n이 Mac의 문서·재생목록 비교 기준과 이미지 전송 재개 기록을 새로 시작합니다. 현재 파일과 서버 자료는 그대로입니다. 이전 기록은 복구용 폴더에 분리 보관하며 비교에 사용하지 않습니다.\n\n서버가 비어 있으면 현재 문서가 ‘보내기’로 표시됩니다. 서버에도 다른 내용이 있으면 충돌 확인이 필요합니다. PP6를 종료해 주세요.",self.documentsRoot],@"기록 초기화"))return;
    self.comparisonEpoch++;self.backgroundNeedsResume=NO;self.backgroundScheduled=YES;
    [self.work run:^id {
        YBLibrary *library=[self connectedLibrary];NSString *old=YBStartFreshProfile(library.sync,self.server.origin);
        [library.sync close];self.library=nil;return old;
    } completion:^(NSString *old,NSString *error){
        if(error){YBAlert(@"기록 초기화 중단",error);return;}
        [self acceptRows:@[]];if(self.rootChanged)self.rootChanged(self.documentsRoot);
        YBAlert(@"동기화 기록 초기화 완료",[NSString stringWithFormat:@"현재 파일로 다시 비교합니다. 빈 서버에 전체 문서와 재생목록을 올리려면 도구 → ‘이 Mac 기준으로 서버 다시 맞추기…’를 사용하세요.\n\n이전 복구 기록: %@",old]);
    }];
}
- (void)logout:(id)sender {
    self.comparisonEpoch++;self.backgroundNeedsResume=NO;self.backgroundScheduled=YES;
    [self.work run:^id { [self ensureSessionLoaded];[self.server request:@"/api/session" method:@"DELETE" body:nil headers:nil];[self.server forgetSession];return @YES; } completion:^(id result,NSString *error) {
        if(error){YBAlert(@"로그아웃",error);return;}[self acceptRows:@[]];self.sessionLabel.stringValue=@"로그아웃됨";if(self.sessionChanged)self.sessionChanged(self.sessionLabel.stringValue);
    }];
}
- (void)changeRoot:(NSString *)root {
    if(!root || self.work.busy)return;
    [self.work run:^id{if(self.library)[self.library.sync assertReady];[self.library.sync close];self.library=nil;return root.stringByStandardizingPath.stringByResolvingSymlinksInPath;} completion:^(NSString *path,NSString *error){
        if(error){YBAlert(@"먼저 중단 작업을 복구해 주세요.",error);return;}self.documentsRoot=path;self.backgroundScheduled=NO;self.rootLabel.stringValue=path;[self acceptRows:@[]];
        YBSavePreferences(@"documents-settings.json",@{@"root":path});if(self.rootChanged)self.rootChanged(path);
    }];
}
- (void)chooseRoot:(id)sender {[self changeRoot:YBChooseFolder(@"동기화할 .pro6 문서 폴더",self.documentsRoot)];}
- (void)testRoot:(id)sender {[self changeRoot:[NSHomeDirectory() stringByAppendingPathComponent:@"Documents/YebaeOn-Sync-Test"]];}
- (void)openFolder:(id)sender {if(![NSWorkspace.sharedWorkspace openURL:[NSURL fileURLWithPath:self.documentsRoot]])YBAlert(@"문서 폴더",@"폴더가 아직 없습니다. 서버와 비교하면 시험 폴더를 만듭니다.");}
- (void)selectVisible:(id)sender {if(self.work.busy)return;NSString *direction=[self selectedDirection];[self.checked removeAllObjects];if(direction)for(NSDictionary *r in self.visibleRows)if([r[@"status"] isEqual:direction] && !r[@"error"])[self.checked addObject:r[@"path"]];[self.table reloadData];[self updateSelection];}
- (void)selectAllUploads:(id)sender {self.direction.selectedSegment=2;[self directionChanged:nil];[self selectVisible:nil];}
- (void)selectAllDownloads:(id)sender {self.direction.selectedSegment=1;[self directionChanged:nil];[self selectVisible:nil];}
- (void)clearSelection:(id)sender {[self.checked removeAllObjects];self.updatingSelection=YES;[self.table deselectAll:nil];self.updatingSelection=NO;[self.table reloadData];[self updateSelection];}
- (void)toggle:(NSButton *)sender {if(self.work.busy||sender.tag<0 || (NSUInteger)sender.tag>=self.visibleRows.count)return;NSDictionary *row=self.visibleRows[sender.tag];if(![row[@"status"] isEqual:[self selectedDirection]] || row[@"error"])return;NSString *path=row[@"path"];if(sender.state==NSControlStateValueOn)[self.checked addObject:path];else [self.checked removeObject:path];[self updateSelection];}
- (NSInteger)numberOfRowsInTableView:(NSTableView *)table {return self.visibleRows.count;}
- (NSView *)tableView:(NSTableView *)table viewForTableColumn:(NSTableColumn *)column row:(NSInteger)index {
    NSDictionary *row=self.visibleRows[index],*doc=row[@"remote"]==NSNull.null ? nil : row[@"remote"];
    if([column.identifier isEqual:@"check"]) {NSButton *b=[[NSButton alloc] initWithFrame:NSMakeRect(7,2,30,24)];b.buttonType=NSSwitchButton;b.title=@"";b.state=[self.checked containsObject:row[@"path"]] ? NSControlStateValueOn : NSControlStateValueOff;b.target=self;b.action=@selector(toggle:);b.tag=index;b.enabled=!self.work.busy && !row[@"error"] && [row[@"status"] isEqual:[self selectedDirection]];return b;}
    if([column.identifier isEqual:@"lastUsed"]){NSString *value=@"기록 없음";if(row[@"lastUsedTime"]){NSDateFormatter *format=[NSDateFormatter new];format.dateFormat=@"yyyy-MM-dd HH:mm";format.timeZone=[NSTimeZone timeZoneWithName:@"Asia/Seoul"];value=[format stringFromDate:[NSDate dateWithTimeIntervalSince1970:[row[@"lastUsedTime"] doubleValue]]];}NSTextField *field=YBLabel(value,NSMakeRect(0,2,column.width,24),12,NO);field.toolTip=row[@"lastUsedTime"] ? YBDisplayDate(row[@"lastUsedTime"]) : row[@"dateWarning"] ?: @"문서에 유효한 lastDateUsed 기록이 없습니다.";return field;}
    if([column.identifier isEqual:@"uses"]){NSArray *names=self.uses[row[@"path"]];NSTextField *field=YBLabel(names.count ? [NSString stringWithFormat:@"%lu곳",(unsigned long)names.count] : @"—",NSMakeRect(0,2,column.width,24),12,NO);field.toolTip=[names componentsJoinedByString:@", "];return field;}
    if([column.identifier isEqual:@"modified"]){NSDateFormatter *f=[NSDateFormatter new];f.dateFormat=@"MM-dd HH:mm";f.timeZone=[NSTimeZone timeZoneWithName:@"Asia/Seoul"];return YBLabel(row[@"modifiedTime"] ? [f stringFromDate:[NSDate dateWithTimeIntervalSince1970:[row[@"modifiedTime"] doubleValue]]] : @"—",NSMakeRect(0,2,column.width,24),12,NO);}
    NSString *text=[column.identifier isEqual:@"status"] ? ([row[@"error"] length] ? @"업로드 제외" : YBStatusName(row[@"status"])) : [column.identifier isEqual:@"path"] ? row[@"path"] : [column.identifier isEqual:@"version"] ? (doc ? [NSString stringWithFormat:@"v%@",doc[@"version"]] : @"—") : doc ? [NSString stringWithFormat:@"%@ · %@",YBDisplayDate(doc[@"updatedAt"]),doc[@"updatedBy"] ?: @"—"] : @"—";
    NSTextField *field=YBLabel(text,NSMakeRect(0,2,column.width,24),13,NO);field.toolTip=row[@"error"] ?: text;if([row[@"status"] isEqual:@"conflict"])field.textColor=[NSColor colorWithCalibratedRed:0.68 green:0.15 blue:0.12 alpha:1];if([table.selectedRowIndexes containsIndex:index] && table.window.firstResponder==table && table.window.keyWindow && NSApp.active)field.textColor=NSColor.alternateSelectedControlTextColor;return field;
}
- (void)send:(id)sender {[self transfer:NO];}
- (void)receive:(id)sender {[self transfer:YES];}
- (void)transfer:(BOOL)receiving {
    if(self.work.busy)return;
    NSMutableArray *selected=[NSMutableArray array],*names=[NSMutableArray array];
    for(NSDictionary *row in self.rows)if([self.checked containsObject:row[@"path"]]) {
        if(![row[@"status"] isEqual:@"same"] && ![row[@"status"] isEqual:receiving ? @"download" : @"upload"]) {YBAlert(@"선택을 확인해 주세요.",@"받기와 보내기는 따로 선택해 주세요. 충돌 문서는 먼저 내용을 비교해야 합니다.");return;}
        [selected addObject:row];[names addObject:[NSString stringWithFormat:@"%@ · %@",row[@"path"],YBStatusName(row[@"status"])]];
    }
    if(!selected.count){YBAlert(@"문서를 선택해 주세요.",@"목록 왼쪽에서 송수신할 문서를 체크하세요.");return;}
    NSString *details=[[names subarrayWithRange:NSMakeRange(0,MIN(names.count,15))] componentsJoinedByString:@"\n"];
    if(names.count>15)details=[details stringByAppendingFormat:@"\n… 외 %lu개",(unsigned long)names.count-15];
    NSString *message=[NSString stringWithFormat:@"%@\n\n문서 폴더: %@\n%@\n일치하는 문서는 동기화 기준만 기록합니다.",details,self.documentsRoot,receiving ? @"원본 백업 후 적용합니다. PP6를 종료해 주세요." : @"최대 4개씩 병렬 업로드합니다. 선택한 정렬 순서로 처리하고 성공 기록은 순서대로 저장합니다. 업로드 중 자동 잠자기를 방지합니다. PP6를 종료해 주세요."];
    if(!YBConfirm([NSString stringWithFormat:@"%lu개 문서를 %@까요?",(unsigned long)selected.count,receiving ? @"받을" : @"보낼"],message,receiving ? @"백업 후 받기" : @"서버로 보내기"))return;
    self.transferActive=YES;self.progress.hidden=NO;self.transferCount.hidden=NO;self.selectionHint.hidden=YES;self.transferCount.stringValue=[NSString stringWithFormat:@"0 / %lu",(unsigned long)selected.count];self.progress.indeterminate=NO;self.progress.maxValue=selected.count;self.progress.doubleValue=0;self.statusLabel.stringValue=@"전송 준비 중 · 완료 0";
    [self.work runPausable:!receiving task:^id {
        YBLibrary *library=[self connectedLibrary];NSUInteger count=[library transfer:selected receiving:receiving progress:^(NSString *path,NSUInteger done) {
            dispatch_async(dispatch_get_main_queue(),^{self.progress.doubleValue=done;self.transferCount.stringValue=[NSString stringWithFormat:@"%lu / %lu",(unsigned long)done,(unsigned long)selected.count];self.work.message=done==selected.count ? @"전송 완료 · 상태 확인 마무리" : [NSString stringWithFormat:@"문서 %@ %lu/%lu",receiving ? @"받기" : @"보내기",(unsigned long)done,(unsigned long)selected.count];NSDateFormatter *clock=[NSDateFormatter new];clock.dateFormat=@"HH:mm:ss";clock.timeZone=[NSTimeZone timeZoneWithName:@"Asia/Seoul"];self.statusLabel.stringValue=[NSString stringWithFormat:@"%@ %lu/%lu · 마지막 성공 %@ · %@",receiving ? @"받는 중" : @"보내는 중",(unsigned long)done,(unsigned long)selected.count,[clock stringFromDate:NSDate.date],path];});
        }];
        NSString *warning=receiving ? (library.sync.backupWarning ?: @"") : @"";
        NSMutableArray *rows=[NSMutableArray array];NSDictionary *entries=library.sync.entries;NSMutableSet *completed=[NSMutableSet set];for(NSDictionary *row in selected)[completed addObject:row[@"path"]];
        for(NSDictionary *row in self.rows){NSMutableDictionary *copy=[row mutableCopy];NSDictionary *saved=entries[row[@"path"]];if([completed containsObject:row[@"path"]] && saved){copy[@"remote"]=saved;copy[@"localHash"]=saved[@"sha256"];copy[@"status"]=@"same";}[rows addObject:copy];}
        return @{@"count":@(count),@"rows":rows,@"warning":warning};
    } completion:^(NSDictionary *result,NSString *error) {
        self.transferActive=NO;self.progress.hidden=YES;self.transferCount.hidden=YES;self.selectionHint.hidden=NO;if(result)[self acceptRows:result[@"rows"]];
        if(error){self.statusLabel.stringValue=[NSString stringWithFormat:@"전송 미완료 · %.0f/%lu 완료 · 오류 있음 · 복구 기록 확인 후 다시 비교",self.progress.doubleValue,(unsigned long)selected.count];YBAlert(@"문서 송수신 중단",error);return;}
        self.statusLabel.stringValue=[NSString stringWithFormat:@"%@개 완료했습니다. %@",result[@"count"],[result[@"warning"] length] ? @"목록을 다시 비교해 주세요." : @"전송한 문서 상태를 반영했습니다. 다른 변경은 ‘서버와 비교’로 확인하세요."];
        if([result[@"warning"] length])YBAlert(@"송수신은 완료했습니다.",result[@"warning"]);
    }];
}
- (void)preview:(id)sender {
    NSInteger index=self.table.clickedRow>=0 ? self.table.clickedRow : self.table.selectedRow;if(index<0 || (NSUInteger)index>=self.visibleRows.count){YBAlert(@"문서를 선택해 주세요.",@"내용을 비교할 문서 행을 클릭하세요.");return;}
    NSDictionary *row=self.visibleRows[index];NSString *path=row[@"path"];
    if([row[@"error"] length]){YBShowText(@"동기화 제외 사유",[NSString stringWithFormat:@"%@\n%@",path,row[@"error"]]);return;}
    [self.work run:^id {
        YBLibrary *library=[self connectedLibrary];NSData *local=[library.sync readDocument:path];NSDictionary *remote=row[@"remote"]==NSNull.null ? nil : row[@"remote"];
        NSData *incoming=remote ? [self.server download:remote] : nil;
        NSDictionary *old=local ? PP6ParseDocumentData(local,path,@[],@{},@[],@{},YES) : nil;
        NSDictionary *new=incoming ? PP6ParseDocumentData(incoming,path,@[],@{},@[],@{},YES) : nil;
        YBRequire(![old[@"parseError"] length] && ![new[@"parseError"] length],@"문서 내용을 분석하지 못했습니다.");
        return @{@"local":old ?: @{},@"remote":new ?: @{}};
    } completion:^(NSDictionary *result,NSString *error) {
        if(error){YBAlert(@"내용 비교",error);return;}NSAlert *alert=[NSAlert new];alert.messageText=[@"문서 비교 · " stringByAppendingString:path];alert.informativeText=@"슬라이드를 선택해 양쪽 내용을 비교하세요. 선택한 버전의 문서 전체를 적용합니다.";
        alert.accessoryView=[[YBDocumentComparison alloc] initWithLocal:result[@"local"] remote:result[@"remote"]];
        [alert addButtonWithTitle:@"Mac 내용 사용"];[alert addButtonWithTitle:@"서버 내용 사용"];[alert addButtonWithTitle:@"닫기"];alert.buttons[0].enabled=row[@"localHash"]!=NSNull.null;alert.buttons[1].enabled=[row[@"remote"] isKindOfClass:NSDictionary.class];NSModalResponse answer=[alert runModal];if(answer!=NSAlertFirstButtonReturn && answer!=NSAlertSecondButtonReturn)return;BOOL receiving=answer==NSAlertSecondButtonReturn;
        if(!YBConfirm(@"이 문서의 기준을 맞출까요?",[NSString stringWithFormat:@"%@\n양쪽 원본을 백업하고 %@ 내용으로 맞춥니다. PP6를 종료해 주세요.",path,receiving ? @"서버" : @"Mac"],@"백업 후 적용"))return;
        [self.work run:^id{return [[self connectedLibrary] resolveRow:row receiving:receiving];} completion:^(NSDictionary *saved,NSString *failure){if(failure){YBAlert(@"문서 해결 미완료",failure);return;}[self mergeComparedRows:@[saved]];if(self.priorityRequested)self.priorityRequested();}];
    }];
}
- (void)backups:(id)sender {if(!self.work.busy && self.showRecovery)self.showRecovery();}
@end
