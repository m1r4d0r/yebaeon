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
@property NSURL *playlistFile;
@property BOOL updatingSelection;
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
    NSView *v=[[NSView alloc] initWithFrame:NSMakeRect(0,0,1060,720)];self.view=v;
    self.rootLabel=YBLabel(self.documentsRoot,NSZeroRect,12,NO);self.sessionLabel=YBLabel(@"연결 안 됨",NSZeroRect,12,NO);
    [v addSubview:YBLabel(@"문서",NSMakeRect(24,670,250,28),22,YES)];
    [v addSubview:YBButton(@"서버와 비교",NSMakeRect(876,666,160,34),self,@selector(refresh:))];
    self.direction=[[NSSegmentedControl alloc] initWithFrame:NSMakeRect(24,620,700,32)];self.direction.segmentCount=5;self.direction.trackingMode=NSSegmentSwitchTrackingSelectOne;self.direction.selectedSegment=0;self.direction.target=self;self.direction.action=@selector(directionChanged:);NSArray *labels=@[@"전체",@"받기",@"보내기",@"충돌",@"제외"];for(NSInteger i=0;i<5;i++){[self.direction setLabel:labels[i] forSegment:i];[self.direction setWidth:132 forSegment:i];}[v addSubview:self.direction];
    self.order=[[NSPopUpButton alloc] initWithFrame:NSMakeRect(810,620,226,32) pullsDown:NO];[self.order addItemsWithTitles:@[@"최근 사용순",@"이름순"]];self.order.target=self;self.order.action=@selector(orderChanged:);[v addSubview:self.order];
    self.usedOnly=YBButton(@"재생목록에서 쓰는 문서만",NSMakeRect(24,580,300,28),self,@selector(filterChanged:));self.usedOnly.buttonType=NSSwitchButton;[v addSubview:self.usedOnly];
    self.search=[[NSSearchField alloc] initWithFrame:NSMakeRect(500,580,536,28)];self.search.placeholderString=@"문서 이름이나 폴더 검색";self.search.delegate=self;[v addSubview:self.search];
    self.table=YBTable(v,NSMakeRect(24,155,1012,410),@[@[@"check",@"☐",@38],@[@"status",@"상태",@104],@[@"path",@"문서",@265],@[@"uses",@"쓰는 예배",@75],@[@"lastUsed",@"최근 사용일",@145],@[@"modified",@"Mac 수정",@145],@[@"author",@"서버 저장 · 작업자",@210]],self);
    self.table.allowsMultipleSelection=YES;self.table.target=self;self.table.doubleAction=@selector(preview:);NSMenu *menu=[NSMenu new];NSMenuItem *item=[menu addItemWithTitle:@"문서 내용 비교" action:@selector(preview:) keyEquivalent:@""];item.target=self;self.table.menu=menu;
    for(NSTableColumn *column in self.table.tableColumns)if(![column.identifier isEqual:@"check"]){NSString *key=[@{@"lastUsed":@"lastUsedTime",@"modified":@"modifiedTime",@"author":@"remote.updatedAt"} objectForKey:column.identifier] ?: column.identifier;column.sortDescriptorPrototype=[NSSortDescriptor sortDescriptorWithKey:key ascending:[column.identifier isEqual:@"path"]];}
    self.progress=[[NSProgressIndicator alloc] initWithFrame:NSMakeRect(24,130,1012,12)];self.progress.indeterminate=NO;self.progress.minValue=0;self.progress.maxValue=1;[v addSubview:self.progress];
    self.statusLabel=YBLabel(@"서버와 비교해 받기·보내기 방향을 선택하세요.",NSMakeRect(24,100,1012,25),12,NO);[v addSubview:self.statusLabel];
    [v addSubview:YBButton(@"복구 기록…",NSMakeRect(24,35,140,36),self,@selector(backups:))];
    self.allButton=YBButton(@"전체 선택 ⌘A",NSMakeRect(178,35,156,36),self,@selector(selectVisible:));[v addSubview:self.allButton];[v addSubview:YBButton(@"선택 해제",NSMakeRect(345,35,120,36),self,@selector(clearSelection:))];
    [v addSubview:YBLabel(@"최근 사용순 · 최대 4개 업로드 · 전송 중 잠자기 방지",NSMakeRect(475,41,350,24),11,NO)];
    self.applyButton=YBButton(@"방향을 선택하세요",NSMakeRect(826,35,210,36),self,@selector(applySelected:));self.applyButton.keyEquivalent=@"\r";[v addSubview:self.applyButton];[self updateSelection];
}
- (NSString *)selectedDirection {return self.direction.selectedSegment==1 ? @"download" : self.direction.selectedSegment==2 ? @"upload" : nil;}
- (void)updateSelection {NSString *direction=[self selectedDirection];self.applyButton.title=direction ? [NSString stringWithFormat:@"%@ %lu개",[direction isEqual:@"download"] ? @"받기" : @"보내기",(unsigned long)self.checked.count] : @"방향을 선택하세요";self.applyButton.enabled=direction && self.checked.count && !self.work.busy;self.allButton.enabled=direction && !self.work.busy;}
- (void)directionChanged:(id)sender {[self.checked removeAllObjects];[self filter];}
- (void)filterChanged:(id)sender {[self.checked removeAllObjects];[self filter];}
- (void)applySelected:(id)sender {NSString *direction=[self selectedDirection];if(direction)[self transfer:[direction isEqual:@"download"]];}
- (void)setPlaylistFile:(NSURL *)url {_playlistFile=url;NSMutableDictionary *uses=[NSMutableDictionary dictionary];@try{if(url)for(NSDictionary *node in YBPlaylistNodes(YBReadPlaylist(url))){NSMutableSet *paths=[NSMutableSet set];for(NSDictionary *item in node[@"items"]){NSString *path=YBPlaylistReference(item[@"attrs"][@"filePath"],self.documentsRoot) ?: YBPlaylistReference(item[@"attrs"][@"filePath"],@"~/Documents/ProPresenter6");if(path)[paths addObject:path];}for(NSString *path in paths){NSMutableArray *names=uses[path];if(!names){names=[NSMutableArray array];uses[path]=names;}[names addObject:node[@"name"] ?: @"예배"];}}@catch(NSException *e){self.statusLabel.stringValue=[@"재생목록 참조를 읽지 못했습니다: " stringByAppendingString:e.reason];}self.uses=uses;self.usedOnly.enabled=url!=nil;if(!url)self.usedOnly.state=NSControlStateValueOff;[self filter];}
- (void)tableView:(NSTableView *)table sortDescriptorsDidChange:(NSArray *)oldDescriptors {NSSortDescriptor *sort=table.sortDescriptors.firstObject;if(!sort)return;self.rows=[self.rows sortedArrayUsingComparator:^NSComparisonResult(NSDictionary *a,NSDictionary *b){id x=nil,y=nil;if([sort.key isEqual:@"remote.updatedAt"]){x=[a[@"remote"] isKindOfClass:NSDictionary.class]?a[@"remote"][@"updatedAt"]:nil;y=[b[@"remote"] isKindOfClass:NSDictionary.class]?b[@"remote"][@"updatedAt"]:nil;}else if([sort.key isEqual:@"uses"]){x=@([self.uses[a[@"path"]] count]);y=@([self.uses[b[@"path"]] count]);}else{x=a[sort.key];y=b[sort.key];}if(x==NSNull.null)x=nil;if(y==NSNull.null)y=nil;if(!x&&y)return NSOrderedDescending;if(x&&!y)return NSOrderedAscending;NSComparisonResult order=x&&y?[x compare:y]:NSOrderedSame;return order==NSOrderedSame?[a[@"path"] compare:b[@"path"]]:(sort.ascending?order:-order);}];[self filter];}
- (void)tableView:(NSTableView *)table didClickTableColumn:(NSTableColumn *)column {if([column.identifier isEqual:@"check"])[self selectVisible:nil];}
- (void)tableViewSelectionDidChange:(NSNotification *)note {if(self.updatingSelection||self.work.busy)return;[self.checked removeAllObjects];NSString *direction=[self selectedDirection];[self.table.selectedRowIndexes enumerateIndexesUsingBlock:^(NSUInteger index,BOOL *stop){if(index<self.visibleRows.count){NSDictionary *row=self.visibleRows[index];if([row[@"status"] isEqual:direction] && !row[@"error"])[self.checked addObject:row[@"path"]];}}];self.updatingSelection=YES;[self.table reloadData];self.updatingSelection=NO;[self updateSelection];}
- (YBLibrary *)connectedLibrary {
    if(!self.library)self.library=[[YBLibrary alloc] initWithRoot:self.documentsRoot profile:YBProfilePath(self.documentsRoot,self.server.origin) server:self.server];
    return self.library;
}
- (void)ensureSessionLoaded {if(!self.sessionLoaded){[self.server loadSession];self.sessionLoaded=YES;}}
- (void)acceptRows:(NSArray *)rows {
    self.rows=rows ?: @[];[self.checked removeAllObjects];[self sortRows];[self filter];
    NSMutableDictionary *count=[NSMutableDictionary dictionary];for(NSDictionary *r in self.rows)count[r[@"status"]]=@([count[r[@"status"]] integerValue]+1);
    for(NSInteger i=0;i<5;i++){NSString *key=@[@"all",@"download",@"upload",@"conflict",@"excluded"][i];NSUInteger n=i==0 ? self.rows.count : 0;if(i)for(NSDictionary *r in self.rows)if(i==4 ? [r[@"error"] length]>0 : !r[@"error"] && [r[@"status"] isEqual:key])n++;[self.direction setLabel:[NSString stringWithFormat:@"%@ %lu",@[@"전체",@"받기",@"보내기",@"충돌",@"제외"][i],(unsigned long)n] forSegment:i];}
    self.statusLabel.stringValue=[NSString stringWithFormat:@"전체 %lu · 받기 %@ · 보내기 %@ · 일치 %@ · 충돌 %@",(unsigned long)self.rows.count,count[@"download"] ?: @0,count[@"upload"] ?: @0,count[@"same"] ?: @0,count[@"conflict"] ?: @0];
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
    self.statusLabel.stringValue=@"시작 시 서버 연결과 문서 상태를 확인하고 있습니다…";
    [self.work run:^id {
        [self ensureSessionLoaded];NSDictionary *session=[self.server request:@"/api/session" method:@"GET" body:nil headers:nil];
        if(![session[@"authenticated"] boolValue])return @{@"signedOut":@YES};
        BOOL directory=NO;if(![[NSFileManager defaultManager] fileExistsAtPath:self.documentsRoot isDirectory:&directory] || !directory)return @{@"noFolder":@YES,@"name":session[@"name"] ?: @""};
        YBLibrary *library=[self connectedLibrary];NSArray *rows=[library refresh];
        YBSavePreferences(@"last-server-comparison.json",@{@"at":[NSDate.date description],@"root":self.documentsRoot,@"documents":@(rows.count),@"automatic":@YES});
        return @{@"rows":rows,@"name":session[@"name"] ?: @"",@"pending":@(library.sync.pendingTransactions.count)};
    } completion:^(NSDictionary *result,NSString *error) {
        if(error){if(self.sessionChanged)self.sessionChanged(@"연결 확인 실패");self.statusLabel.stringValue=@"자동 비교하지 못했습니다. 연결 후 ‘서버와 비교’를 눌러 다시 확인하세요.";return;}
        if([result[@"signedOut"] boolValue]){if(self.sessionChanged)self.sessionChanged(@"입장 필요");self.statusLabel.stringValue=@"입장한 뒤 서버와 비교할 수 있습니다.";return;}
        self.sessionLabel.stringValue=[NSString stringWithFormat:@"%@ 연결됨",result[@"name"]];if(self.sessionChanged)self.sessionChanged(self.sessionLabel.stringValue);
        if([result[@"noFolder"] boolValue]){self.statusLabel.stringValue=@"문서 폴더를 선택한 뒤 서버와 비교해 주세요.";return;}
        [self acceptRows:result[@"rows"]];
        if([result[@"pending"] unsignedIntegerValue])self.statusLabel.stringValue=@"중단된 적용이 있습니다. 복구 기록을 먼저 확인하세요.";if(self.comparisonFinished)self.comparisonFinished();
    }];
}
- (void)refresh:(id)sender {
    self.statusLabel.stringValue=@"서버와 문서를 비교하고 있습니다…";
    [self.work run:^id {
        [self ensureSessionLoaded];NSDictionary *session=[self.server request:@"/api/session" method:@"GET" body:nil headers:nil];
        YBRequire([session[@"authenticated"] boolValue],@"먼저 ‘입장 / 이름 변경’에서 공용 비밀번호로 입장해 주세요.");
        YBLibrary *library=[self connectedLibrary];NSArray *rows=[library refresh];YBSavePreferences(@"last-server-comparison.json",@{@"at":[NSDate.date description],@"root":self.documentsRoot,@"documents":@(rows.count),@"automatic":@NO});return @{@"rows":rows,@"name":session[@"name"] ?: @"",@"pending":@(library.sync.pendingTransactions.count)};
    } completion:^(NSDictionary *result,NSString *error) {
        if(error){[self acceptRows:@[]];self.statusLabel.stringValue=@"비교하지 못했습니다. 입장 상태와 폴더를 확인해 주세요.";YBAlert(@"문서 비교",error);return;}
        [self acceptRows:result[@"rows"]];self.sessionLabel.stringValue=[NSString stringWithFormat:@"%@ 연결됨",result[@"name"]];if(self.sessionChanged)self.sessionChanged(self.sessionLabel.stringValue);
        if([result[@"pending"] unsignedIntegerValue])self.statusLabel.stringValue=@"중단된 적용이 있습니다. 복구 기록을 먼저 확인하세요.";if(self.comparisonFinished)self.comparisonFinished();
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
        [self refresh:nil];
    }];
}
- (void)logout:(id)sender {
    [self.work run:^id { [self ensureSessionLoaded];[self.server request:@"/api/session" method:@"DELETE" body:nil headers:nil];[self.server forgetSession];return @YES; } completion:^(id result,NSString *error) {
        if(error){YBAlert(@"로그아웃",error);return;}[self acceptRows:@[]];self.sessionLabel.stringValue=@"로그아웃됨";if(self.sessionChanged)self.sessionChanged(self.sessionLabel.stringValue);
    }];
}
- (void)changeRoot:(NSString *)root {
    if(!root || self.work.busy)return;
    @try {if(self.library)[self.library.sync assertReady];}
    @catch(NSException *error){YBAlert(@"먼저 중단 작업을 복구해 주세요.",error.reason);return;}
    [self.library.sync close];self.library=nil;self.documentsRoot=root.stringByStandardizingPath.stringByResolvingSymlinksInPath;
    self.rootLabel.stringValue=self.documentsRoot;[self acceptRows:@[]];self.statusLabel.stringValue=@"문서 폴더를 변경했습니다. 서버와 다시 비교하세요.";
    YBSavePreferences(@"documents-settings.json",@{@"root":self.documentsRoot});if(self.rootChanged)self.rootChanged(self.documentsRoot);
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
    if([column.identifier isEqual:@"lastUsed"]){NSString *value=@"기록 없음";if(row[@"lastUsedTime"]){NSDateFormatter *format=[NSDateFormatter new];format.dateFormat=@"yyyy-MM-dd HH:mm";value=[format stringFromDate:[NSDate dateWithTimeIntervalSince1970:[row[@"lastUsedTime"] doubleValue]]];}NSTextField *field=YBLabel(value,NSMakeRect(0,2,column.width,24),12,NO);field.toolTip=row[@"lastDateUsed"] ?: row[@"dateWarning"] ?: @"문서에 유효한 lastDateUsed 기록이 없습니다.";return field;}
    if([column.identifier isEqual:@"uses"]){NSArray *names=self.uses[row[@"path"]];NSTextField *field=YBLabel(names.count ? [NSString stringWithFormat:@"%lu곳",(unsigned long)names.count] : @"—",NSMakeRect(0,2,column.width,24),12,NO);field.toolTip=[names componentsJoinedByString:@", "];return field;}
    if([column.identifier isEqual:@"modified"]){NSDateFormatter *f=[NSDateFormatter new];f.dateFormat=@"MM-dd HH:mm";return YBLabel(row[@"modifiedTime"] ? [f stringFromDate:[NSDate dateWithTimeIntervalSince1970:[row[@"modifiedTime"] doubleValue]]] : @"—",NSMakeRect(0,2,column.width,24),12,NO);}
    NSString *text=[column.identifier isEqual:@"status"] ? ([row[@"error"] length] ? @"업로드 제외" : YBStatusName(row[@"status"])) : [column.identifier isEqual:@"path"] ? row[@"path"] : [column.identifier isEqual:@"version"] ? (doc ? [NSString stringWithFormat:@"v%@",doc[@"version"]] : @"—") : doc ? [NSString stringWithFormat:@"%@ · %@",doc[@"updatedAt"] ?: @"—",doc[@"updatedBy"] ?: @"—"] : @"—";
    NSTextField *field=YBLabel(text,NSMakeRect(0,2,column.width,24),13,NO);field.toolTip=row[@"error"] ?: text;if([row[@"status"] isEqual:@"conflict"])field.textColor=[NSColor colorWithCalibratedRed:0.68 green:0.15 blue:0.12 alpha:1];return field;
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
    self.progress.indeterminate=NO;self.progress.maxValue=selected.count;self.progress.doubleValue=0;self.statusLabel.stringValue=@"전송 준비 중 · 완료 0 · 실패 0";
    [self.work run:^id {
        YBLibrary *library=[self connectedLibrary];NSUInteger count=[library transfer:selected receiving:receiving progress:^(NSString *path,NSUInteger done) {
            dispatch_async(dispatch_get_main_queue(),^{self.progress.doubleValue=done;NSDateFormatter *clock=[NSDateFormatter new];clock.dateFormat=@"HH:mm:ss";self.statusLabel.stringValue=[NSString stringWithFormat:@"%@ %lu/%lu · 실패 0 · 마지막 성공 %@ · %@",receiving ? @"받는 중" : @"보내는 중",(unsigned long)done,(unsigned long)selected.count,[clock stringFromDate:NSDate.date],path];});
        }];
        NSString *warning=receiving ? (library.sync.backupWarning ?: @"") : @"";NSArray *rows=@[];@try{rows=[library refresh];}@catch(NSException *e){warning=[warning stringByAppendingFormat:@"\n%@",e.reason];}
        return @{@"count":@(count),@"rows":rows,@"warning":warning};
    } completion:^(NSDictionary *result,NSString *error) {
        [self acceptRows:result[@"rows"] ?: @[]];
        if(error){self.statusLabel.stringValue=[NSString stringWithFormat:@"전송 미완료 · %.0f/%lu 완료 · 오류 있음 · 복구 기록 확인 후 다시 비교",self.progress.doubleValue,(unsigned long)selected.count];YBAlert(@"문서 송수신 중단",error);return;}
        self.statusLabel.stringValue=[NSString stringWithFormat:@"%@개 완료했습니다. %@",result[@"count"],[result[@"warning"] length] ? @"목록을 다시 비교해 주세요." : @"최신 상태를 표시합니다."];
        if([result[@"warning"] length])YBAlert(@"송수신은 완료했습니다.",result[@"warning"]);if(self.comparisonFinished)self.comparisonFinished();
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
        NSMutableString *text=[NSMutableString stringWithFormat:@"%@\n상태: %@\nMac: %@장 · 서버: %@장\n\n",path,YBStatusName(row[@"status"]),old[@"slideCount"] ?: @0,new[@"slideCount"] ?: @0];
        if(old && new) {
            NSDictionary *diff=PP6CompareParsedDocuments(old,new),*counts=diff[@"counts"];
            [text appendFormat:@"추가 %@ · 삭제 %@ · 수정 %@ · 이동 %@ · 기술 차이 %@\n\n",counts[@"added"],counts[@"deleted"],counts[@"modified"],counts[@"moved"],counts[@"technical"]];
            for(NSDictionary *group in diff[@"groups"]) {
                [text appendFormat:@"[%@]\n",group[@"name"]];
                for(NSDictionary *item in group[@"deleted"])[text appendFormat:@"삭제: %@장 · %@\n",item[@"oldIndex"],[item[@"texts"] componentsJoinedByString:@" / "]];
                for(NSDictionary *item in group[@"added"])[text appendFormat:@"추가: %@장 · %@\n",item[@"newIndex"],[item[@"texts"] componentsJoinedByString:@" / "]];
                for(NSDictionary *item in group[@"matched"]) {
                    NSMutableArray *changes=[NSMutableArray array];
                    if([item[@"modified"] boolValue])[changes addObject:@"내용·서식 수정"];
                    if([item[@"moved"] boolValue])[changes addObject:@"순서 이동"];
                    if([item[@"technicalOnly"] boolValue])[changes addObject:@"식별자·경로 차이"];
                    if(changes.count)[text appendFormat:@"Mac %@장 → 서버 %@장: %@\n",item[@"oldIndex"],item[@"newIndex"],[changes componentsJoinedByString:@" · "]];
                }
            }
            [text appendString:@"\n분석은 기존 Core 기준입니다. 원본 바이트가 다르면 화면 차이 집계가 0이어도 동기화 상태가 달라질 수 있습니다.\n"];
        } else [text appendString:local ? @"이 문서는 Mac에만 있습니다.\n" : @"서버에만 있는 문서입니다. 받기를 선택하면 새 파일로 추가합니다.\n"];
        return text;
    } completion:^(NSString *result,NSString *error) {if(error)YBAlert(@"내용 비교",error);else YBShowText(@"문서 내용 비교",result);}];
}
- (void)backups:(id)sender {if(!self.work.busy && self.showRecovery)self.showRecovery();}
@end
