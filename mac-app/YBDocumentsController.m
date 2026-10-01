#import "YBDocumentsController.h"
#import "YBLibrary.h"
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
@end
@implementation YBDocumentsController
- (instancetype)initWithWork:(YBWork *)work {
    if((self=[super init])) {
        self.work=work;self.rows=@[];self.visibleRows=@[];self.checked=[NSMutableSet set];
        id saved=YBPreferences(@"documents-settings.json")[@"root"];
        self.documentsRoot=[saved isKindOfClass:NSString.class] && [saved isAbsolutePath] ? saved : [NSHomeDirectory() stringByAppendingPathComponent:@"Documents/YebaeOn-Sync-Test"];
        self.server=[[YBServer alloc] initWithOrigin:@"https://yebaeon.grace-jean-p.workers.dev" allowLocalTestServer:NO];
        [self buildView];
    }return self;
}
- (void)buildView {
    NSView *v=[[NSView alloc] initWithFrame:NSMakeRect(0,0,1060,720)];self.view=v;
    [v addSubview:YBLabel(@"문서 동기화",NSMakeRect(24,670,340,28),22,YES)];
    self.sessionLabel=YBLabel(@"공용 비밀번호와 이름으로 입장하세요.",NSMakeRect(400,672,465,24),13,NO);[v addSubview:self.sessionLabel];
    [v addSubview:YBButton(@"입장 / 이름 변경",NSMakeRect(858,666,178,34),self,@selector(login:))];
    [v addSubview:YBButton(@"문서 폴더 선택",NSMakeRect(24,624,138,34),self,@selector(chooseRoot:))];
    self.rootLabel=YBLabel(self.documentsRoot,NSMakeRect(172,630,704,23),13,NO);[v addSubview:self.rootLabel];
    [v addSubview:YBButton(@"시험 폴더",NSMakeRect(908,624,128,34),self,@selector(testRoot:))];
    self.search=[[NSSearchField alloc] initWithFrame:NSMakeRect(24,579,376,28)];self.search.placeholderString=@"문서 이름이나 폴더 검색";self.search.delegate=self;[v addSubview:self.search];
    [v addSubview:YBButton(@"서버와 비교",NSMakeRect(410,575,128,34),self,@selector(refresh:))];
    [v addSubview:YBButton(@"보이는 항목 선택",NSMakeRect(548,575,152,34),self,@selector(selectVisible:))];
    [v addSubview:YBButton(@"선택 해제",NSMakeRect(708,575,105,34),self,@selector(clearSelection:))];
    [v addSubview:YBButton(@"선택 문서 내용 비교",NSMakeRect(827,575,209,34),self,@selector(preview:))];
    [v addSubview:YBButton(@"보내기 전체 선택",NSMakeRect(24,535,166,34),self,@selector(selectAllUploads:))];
    [v addSubview:YBButton(@"받기 전체 선택",NSMakeRect(199,535,166,34),self,@selector(selectAllDownloads:))];
    self.order=[[NSPopUpButton alloc] initWithFrame:NSMakeRect(380,535,180,32) pullsDown:NO];[self.order addItemsWithTitles:@[@"최근 사용순",@"이름순"]];self.order.target=self;self.order.action=@selector(orderChanged:);[v addSubview:self.order];
    [v addSubview:YBLabel(@"선택한 순서로 최대 4개씩 업로드 · 충돌·제외 항목은 선택하지 않습니다.",NSMakeRect(570,541,466,23),12,NO)];
    self.table=YBTable(v,NSMakeRect(24,151,1012,366),@[@[@"check",@"선택",@46],@[@"status",@"상태",@138],@[@"path",@"문서 / 폴더",@325],@[@"lastUsed",@"최근 사용일",@146],@[@"version",@"서버 버전",@76],@[@"author",@"작업자",@155]],self);
    self.table.allowsMultipleSelection=NO;
    self.statusLabel=YBLabel(@"‘서버와 비교’를 눌러 받기·보내기·충돌 상태를 확인하세요.",NSMakeRect(24,119,1012,24),13,NO);[v addSubview:self.statusLabel];
    NSTextField *note=YBLabel(@"송수신 전 PP6를 종료하세요. 받기는 원본을 백업하며, 양쪽에서 수정된 문서는 자동으로 덮어쓰지 않습니다.",NSMakeRect(24,91,1012,22),12,NO);note.textColor=NSColor.secondaryLabelColor;[v addSubview:note];
    [v addSubview:YBButton(@"백업 · 중단 복구",NSMakeRect(24,38,166,38),self,@selector(backups:))];
    [v addSubview:YBButton(@"문서 폴더 열기",NSMakeRect(199,38,148,38),self,@selector(openFolder:))];
    [v addSubview:YBButton(@"로그아웃",NSMakeRect(357,38,110,38),self,@selector(logout:))];
    [v addSubview:YBButton(@"선택 문서 보내기",NSMakeRect(675,38,173,38),self,@selector(send:))];
    [v addSubview:YBButton(@"선택 문서 받기",NSMakeRect(860,38,176,38),self,@selector(receive:))];
}
- (YBLibrary *)connectedLibrary {
    if(!self.library)self.library=[[YBLibrary alloc] initWithRoot:self.documentsRoot profile:YBProfilePath(self.documentsRoot,self.server.origin) server:self.server];
    return self.library;
}
- (void)ensureSessionLoaded {if(!self.sessionLoaded){[self.server loadSession];self.sessionLoaded=YES;}}
- (void)acceptRows:(NSArray *)rows {
    self.rows=rows ?: @[];[self.checked removeAllObjects];[self sortRows];[self filter];
    NSMutableDictionary *count=[NSMutableDictionary dictionary];for(NSDictionary *r in self.rows)count[r[@"status"]]=@([count[r[@"status"]] integerValue]+1);
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
    NSString *query=self.search.stringValue;NSMutableArray *visible=[NSMutableArray array];
    for(NSDictionary *row in self.rows)if(!query.length || [row[@"path"] rangeOfString:query options:NSCaseInsensitiveSearch].location!=NSNotFound)[visible addObject:row];
    self.visibleRows=visible;[self.table reloadData];
}
- (void)controlTextDidChange:(NSNotification *)note {[self filter];}
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
        if(error){self.statusLabel.stringValue=@"자동 비교하지 못했습니다. 연결 후 ‘서버와 비교’를 눌러 다시 확인하세요.";return;}
        if([result[@"signedOut"] boolValue]){self.statusLabel.stringValue=@"입장한 뒤 서버와 비교할 수 있습니다.";return;}
        self.sessionLabel.stringValue=[NSString stringWithFormat:@"%@님 · 예배온 서버 연결됨",result[@"name"]];
        if([result[@"noFolder"] boolValue]){self.statusLabel.stringValue=@"문서 폴더를 선택한 뒤 서버와 비교해 주세요.";return;}
        [self acceptRows:result[@"rows"]];
        if([result[@"pending"] unsignedIntegerValue])self.statusLabel.stringValue=@"중단된 적용이 있습니다. ‘백업 · 중단 복구’에서 먼저 복구하세요.";
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
        [self acceptRows:result[@"rows"]];self.sessionLabel.stringValue=[NSString stringWithFormat:@"%@님 · 예배온 서버 연결됨",result[@"name"]];
        if([result[@"pending"] unsignedIntegerValue]) {self.statusLabel.stringValue=@"중단된 적용이 있습니다. ‘백업 · 중단 복구’에서 먼저 복구하세요.";}
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
        if(error){YBAlert(@"로그아웃",error);return;}[self acceptRows:@[]];self.sessionLabel.stringValue=@"로그아웃했습니다.";
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
- (void)selectVisible:(id)sender {for(NSDictionary *r in self.visibleRows)if(![r[@"status"] isEqual:@"conflict"])[self.checked addObject:r[@"path"]];[self.table reloadData];}
- (void)selectAllForStatus:(NSString *)status {
    if(self.work.busy)return;
    [self.checked removeAllObjects];
    for(NSDictionary *row in self.rows)if([row[@"status"] isEqual:status])[self.checked addObject:row[@"path"]];
    [self.table reloadData];
    self.statusLabel.stringValue=[NSString stringWithFormat:@"%@ %lu개 선택 · 충돌·제외 항목은 유지합니다.",YBStatusName(status),(unsigned long)self.checked.count];
}
- (void)selectAllUploads:(id)sender {[self selectAllForStatus:@"upload"];}
- (void)selectAllDownloads:(id)sender {[self selectAllForStatus:@"download"];}
- (void)clearSelection:(id)sender {[self.checked removeAllObjects];[self.table reloadData];}
- (void)toggle:(NSButton *)sender {if(sender.tag<0 || (NSUInteger)sender.tag>=self.visibleRows.count)return;NSString *path=self.visibleRows[sender.tag][@"path"];if(sender.state==NSControlStateValueOn)[self.checked addObject:path];else [self.checked removeObject:path];}
- (NSInteger)numberOfRowsInTableView:(NSTableView *)table {return self.visibleRows.count;}
- (NSView *)tableView:(NSTableView *)table viewForTableColumn:(NSTableColumn *)column row:(NSInteger)index {
    NSDictionary *row=self.visibleRows[index],*doc=row[@"remote"]==NSNull.null ? nil : row[@"remote"];
    if([column.identifier isEqual:@"check"]) {NSButton *b=[[NSButton alloc] initWithFrame:NSMakeRect(7,2,30,24)];b.buttonType=NSSwitchButton;b.title=@"";b.state=[self.checked containsObject:row[@"path"]] ? NSControlStateValueOn : NSControlStateValueOff;b.target=self;b.action=@selector(toggle:);b.tag=index;b.enabled=!self.work.busy && ![row[@"status"] isEqual:@"conflict"];return b;}
    if([column.identifier isEqual:@"lastUsed"]){NSString *value=@"기록 없음";if(row[@"lastUsedTime"]){NSDateFormatter *format=[NSDateFormatter new];format.dateFormat=@"yyyy-MM-dd HH:mm";value=[format stringFromDate:[NSDate dateWithTimeIntervalSince1970:[row[@"lastUsedTime"] doubleValue]]];}NSTextField *field=YBLabel(value,NSMakeRect(0,2,column.width,24),12,NO);field.toolTip=row[@"lastDateUsed"] ?: row[@"dateWarning"] ?: @"문서에 유효한 lastDateUsed 기록이 없습니다.";return field;}
    NSString *text=[column.identifier isEqual:@"status"] ? ([row[@"error"] length] ? @"업로드 제외" : YBStatusName(row[@"status"])) : [column.identifier isEqual:@"path"] ? row[@"path"] : [column.identifier isEqual:@"version"] ? (doc ? [NSString stringWithFormat:@"v%@",doc[@"version"]] : @"—") : doc[@"updatedBy"] ?: @"—";
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
    self.statusLabel.stringValue=@"선택한 문서를 처리하고 있습니다…";
    [self.work run:^id {
        YBLibrary *library=[self connectedLibrary];NSUInteger count=[library transfer:selected receiving:receiving progress:^(NSString *path,NSUInteger done) {
            dispatch_async(dispatch_get_main_queue(),^{self.statusLabel.stringValue=[NSString stringWithFormat:@"%lu/%lu 완료 · %@",(unsigned long)done,(unsigned long)selected.count,path];});
        }];
        NSString *warning=@"";NSArray *rows=@[];@try{rows=[library refresh];}@catch(NSException *e){warning=e.reason;}
        return @{@"count":@(count),@"rows":rows,@"warning":warning};
    } completion:^(NSDictionary *result,NSString *error) {
        [self acceptRows:result[@"rows"] ?: @[]];
        if(error){self.statusLabel.stringValue=@"작업을 중단했습니다. 중단 기록을 확인한 뒤 다시 비교하세요.";YBAlert(@"문서 송수신 중단",error);return;}
        self.statusLabel.stringValue=[NSString stringWithFormat:@"%@개 완료했습니다. %@",result[@"count"],[result[@"warning"] length] ? @"목록을 다시 비교해 주세요." : @"최신 상태를 표시합니다."];
        if([result[@"warning"] length])YBAlert(@"송수신은 완료했습니다.",result[@"warning"]);
    }];
}
- (void)preview:(id)sender {
    NSInteger index=self.table.selectedRow;if(index<0 || (NSUInteger)index>=self.visibleRows.count){YBAlert(@"문서를 선택해 주세요.",@"내용을 비교할 문서 행을 클릭하세요.");return;}
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
- (void)backups:(id)sender {
    [self.work run:^id {return [self connectedLibrary].sync.transactions;} completion:^(NSArray *items,NSString *error) {
        if(error){YBAlert(@"백업 목록",error);return;}
        NSMutableArray *available=[NSMutableArray array];for(NSDictionary *j in items)if([@[@"prepared",@"applied",@"committed",@"restoring"] containsObject:j[@"status"]])[available addObject:j];
        if(!available.count){YBAlert(@"백업 · 중단 복구",@"복원하거나 복구할 문서 기록이 없습니다.");return;}
        NSAlert *alert=[NSAlert new];alert.messageText=@"복원할 문서 기록을 선택하세요.";alert.informativeText=@"서버 이력은 유지하고 이 Mac의 문서만 적용 전으로 되돌립니다. 적용 이후 수정한 파일은 자동으로 덮어쓰지 않습니다.";
        NSPopUpButton *menu=[[NSPopUpButton alloc] initWithFrame:NSMakeRect(0,0,760,32) pullsDown:NO];
        for(NSUInteger i=0;i<available.count;i++){NSDictionary *j=available[i];[menu addItemWithTitle:[NSString stringWithFormat:@"%lu · %@ · %@ · %@%@",(unsigned long)i+1,j[@"createdAt"],j[@"path"],[j[@"status"] isEqual:@"committed"] ? @"백업 복원" : @"중단 복구",j[@"beforeHash"]==NSNull.null ? @" (신규 파일 제거)" : @""]];}
        alert.accessoryView=menu;[alert addButtonWithTitle:@"복원 / 복구"];[alert addButtonWithTitle:@"백업 폴더 열기"];[alert addButtonWithTitle:@"취소"];
        NSModalResponse choice=[alert runModal];
        if(choice==NSAlertSecondButtonReturn){[NSWorkspace.sharedWorkspace openURL:[NSURL fileURLWithPath:self.library.sync.profile]];return;}
        if(choice!=NSAlertFirstButtonReturn)return;
        NSDictionary *j=available[menu.indexOfSelectedItem];BOOL restore=[j[@"status"] isEqual:@"committed"];
        if(!YBConfirm(@"이 Mac의 문서를 되돌릴까요?",[NSString stringWithFormat:@"%@\n%@",j[@"path"],j[@"beforeHash"]==NSNull.null ? @"이 수신으로 새로 만든 파일을 제거합니다." : @"적용 전 원본으로 복원합니다."],@"복원하기"))return;
        [self.work run:^id {if(restore)[self.library.sync restore:j[@"id"]];else [self.library.sync recover:j[@"id"]];return @YES;} completion:^(id result,NSString *failure) {
            [self acceptRows:@[]];self.statusLabel.stringValue=failure ? @"복원하지 못했습니다. 현재 파일과 백업을 확인하세요." : @"복원했습니다. 서버와 다시 비교하세요.";if(failure)YBAlert(@"복원 · 복구",failure);
        }];
    }];
}
@end
