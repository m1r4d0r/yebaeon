#import "YBServerPlaylistsController.h"
#import "YBPlaylistSync.h"
#import "YBPlaylistIO.h"
@interface YBServerPlaylistsController () <NSTableViewDataSource,NSTableViewDelegate>
@property(nonatomic,readwrite) NSView *view;
@property YBWork *work;
@property YBDocumentsController *documents;
@property NSURL *target;
@property NSTextField *rootLabel;
@property NSTextField *fileLabel;
@property NSTextField *status;
@property NSPopUpButton *menu;
@property NSTableView *table;
@property NSArray *choices;
@property NSDictionary *comparison;
@end
@implementation YBServerPlaylistsController
- (instancetype)initWithWork:(YBWork *)work documents:(YBDocumentsController *)documents {
    if((self=[super init])){_work=work;_documents=documents;_choices=@[];id path=YBPreferences(@"server-playlists.json")[@"target"] ?: YBPreferences(@"playlist-settings.json")[@"localPath"];if([path isKindOfClass:NSString.class] && [path isAbsolutePath])_target=[NSURL fileURLWithPath:path];[self buildView];}return self;
}
- (void)buildView {
    NSView *v=[[NSView alloc] initWithFrame:NSMakeRect(0,0,1060,720)];self.view=v;
    [v addSubview:YBLabel(@"서버 재생목록",NSMakeRect(24,670,450,28),22,YES)];[v addSubview:YBButton(@"입장 / 이름 변경",NSMakeRect(852,666,184,34),self.documents,@selector(login:))];
    [v addSubview:YBButton(@"문서 폴더 선택",NSMakeRect(24,623,140,34),self.documents,@selector(chooseRoot:))];self.rootLabel=YBLabel(self.documents.documentsRoot,NSMakeRect(174,629,710,24),13,NO);[v addSubview:self.rootLabel];[v addSubview:YBButton(@"시험 폴더",NSMakeRect(901,623,135,34),self.documents,@selector(testRoot:))];
    [v addSubview:YBButton(@"재생목록 파일 선택",NSMakeRect(24,578,173,34),self,@selector(chooseFile:))];self.fileLabel=YBLabel(self.target.path ?: @"PP6의 .pro6pl 파일을 선택하거나 시험 파일을 만드세요.",NSMakeRect(207,584,625,24),13,NO);[v addSubview:self.fileLabel];[v addSubview:YBButton(@"시험 파일 만들기",NSMakeRect(846,578,190,34),self,@selector(testFile:))];
    [v addSubview:YBButton(@"원본 · 문서 서버 등록",NSMakeRect(24,528,190,36),self,@selector(publish:))];[v addSubview:YBButton(@"서버 목록",NSMakeRect(225,528,112,36),self,@selector(refresh:))];
    self.menu=[[NSPopUpButton alloc] initWithFrame:NSMakeRect(349,532,499,30) pullsDown:NO];self.menu.target=self;self.menu.action=@selector(selectionChanged:);[self.menu addItemWithTitle:@"서버 목록에서 예배를 선택하세요."];[v addSubview:self.menu];[v addSubview:YBButton(@"선택 순서 비교",NSMakeRect(860,528,176,36),self,@selector(compare:))];
    self.table=YBTable(v,NSMakeRect(24,174,1012,336),@[@[@"index",@"순서",@46],@[@"name",@"곡 / 말씀",@230],@[@"status",@"상태",@135],@[@"path",@"연결 문서 / 공유",@565]],self);
    self.status=YBLabel(@"웹에서 수정한 플레이리스트를 선택하고 비교한 뒤 받으세요.",NSMakeRect(24,139,1012,28),13,NO);[v addSubview:self.status];
    [v addSubview:YBLabel(@"처음에는 원본 재생목록과 문서 폴더를 서버에 등록하세요. 문서만 바뀌어도 받기 대상에 표시합니다.",NSMakeRect(24,107,1012,23),12,NO)];
    [v addSubview:YBLabel(@"PP6 종료 후 백업·적용합니다. 새 미디어 전송은 아직 지원하지 않습니다.",NSMakeRect(24,79,1012,23),12,NO)];
    [v addSubview:YBButton(@"백업 · 중단 복구",NSMakeRect(24,28,184,38),self,@selector(restore:))];[v addSubview:YBButton(@"예배온 Studio 열기",NSMakeRect(220,28,184,38),self,@selector(openStudio:))];[v addSubview:YBButton(@"이 플레이리스트 받기",NSMakeRect(814,28,222,38),self,@selector(receive:))];
}
- (void)rootChanged {self.rootLabel.stringValue=self.documents.documentsRoot;[self selectionChanged:nil];}
- (void)setTargetFile:(NSURL *)url {if(!url)return;@try{YBReadPlaylist(url);self.target=url;self.fileLabel.stringValue=url.path;YBSavePreferences(@"server-playlists.json",@{@"target":url.path});[self selectionChanged:nil];}@catch(NSException *e){YBAlert(@"재생목록 파일",e.reason);}}
- (void)chooseFile:(id)sender {if(self.work.busy)return;NSOpenPanel *p=[NSOpenPanel openPanel];p.allowedFileTypes=@[@"pro6pl"];p.canChooseDirectories=NO;p.allowsMultipleSelection=NO;p.message=@"동기화할 PP6 재생목록 파일을 선택하세요.";if([p runModal]==NSModalResponseOK)[self setTargetFile:p.URL];}
- (void)testFile:(id)sender {
    if(self.work.busy)return;
    [self.work run:^id {YBSync *sync=[self.documents connectedLibrary].sync;[sync assertReady];NSString *name=@"예배온-시험.pro6pl";NSData *old=YBReadSafeFile(sync.root,name,NULL);if(!old){NSString *xml=@"<RVPlaylistDocument><RVPlaylistNode UUID=\"YEB_TEST_ROOT\" displayName=\"Playlists\"><array rvXMLIvarName=\"children\"/></RVPlaylistNode></RVPlaylistDocument>";YBWriteSafeFile(sync.root,name,[xml dataUsingEncoding:NSUTF8StringEncoding],0600,^{YBRequire(!YBReadSafeFile(sync.root,name,NULL),@"시험 파일이 먼저 생겼습니다.");});}return [NSURL fileURLWithPath:[sync.root stringByAppendingPathComponent:name]];} completion:^(NSURL *url,NSString *error){if(error)YBAlert(@"시험 파일",error);else [self setTargetFile:url];}];
}
- (YBPlaylistSync *)engine {YBRequire(self.target!=nil,@"재생목록 파일을 먼저 선택하세요.");[self.documents ensureSessionLoaded];return [[YBPlaylistSync alloc] initWithLibrary:[self.documents connectedLibrary] target:self.target];}
- (void)acceptLibraries:(NSArray *)libraries {
    NSMutableArray *choices=[NSMutableArray array];[self.menu removeAllItems];
    for(NSDictionary *library in libraries)for(NSDictionary *node in library[@"playlists"]){[choices addObject:@{@"library":library[@"id"],@"node":node[@"id"]}];[self.menu addItemWithTitle:[NSString stringWithFormat:@"%@ · %@",node[@"name"],library[@"path"]]];}
    self.choices=choices;if(!choices.count)[self.menu addItemWithTitle:@"서버에 재생목록이 없습니다. 원본을 먼저 등록하세요."];[self selectionChanged:nil];
}
- (void)refresh:(id)sender {self.status.stringValue=@"서버 재생목록을 불러오고 있습니다…";[self.work run:^id{[self.documents ensureSessionLoaded];YBPlaylistSync *engine=[[YBPlaylistSync alloc] initWithLibrary:[self.documents connectedLibrary] target:self.target];return [engine libraries];} completion:^(NSArray *result,NSString *error){if(error){self.status.stringValue=@"목록을 읽지 못했습니다.";YBAlert(@"서버 목록",error);}else {[self acceptLibraries:result];self.status.stringValue=@"예배를 선택한 뒤 ‘선택 순서 비교’를 누르세요.";}}];}
- (void)selectionChanged:(id)sender {self.comparison=nil;[self.table reloadData];self.status.stringValue=@"선택한 순서와 문서를 다시 비교하세요.";}
- (void)publish:(id)sender {
    if(self.work.busy)return;if(!self.target){YBAlert(@"파일을 선택해 주세요.",@"Mac의 원본 .pro6pl 파일을 먼저 선택하세요.");return;}
    NSAlert *alert=[NSAlert new];alert.messageText=@"원본 재생목록과 연결 문서를 서버에 등록";alert.informativeText=[NSString stringWithFormat:@"%@\n\n아래는 재생목록이 원래 참조하던 문서 폴더입니다. 실제 업로드할 문서는 화면 위에서 선택한 문서 폴더에서 찾습니다. 서버와 다른 내용은 자동으로 덮어쓰지 않습니다.",self.target.path];NSTextField *root=[[NSTextField alloc] initWithFrame:NSMakeRect(0,0,560,30)];root.stringValue=@"~/Documents/ProPresenter6";alert.accessoryView=root;[alert addButtonWithTitle:@"서버에 등록"];[alert addButtonWithTitle:@"취소"];if([alert runModal]!=NSAlertFirstButtonReturn)return;NSString *source=root.stringValue;
    [self.work run:^id{YBPlaylistSync *engine=[self engine];NSDictionary *result=[engine registerFileWithSourceRoot:source progress:^(NSString *message){dispatch_async(dispatch_get_main_queue(),^{self.status.stringValue=message;});}];return @{@"result":result,@"libraries":[engine libraries]};} completion:^(NSDictionary *value,NSString *error){if(error){YBAlert(@"원본 등록",error);self.status.stringValue=@"등록을 마치지 못했습니다. 원본과 서버 이력은 유지합니다.";return;}[self acceptLibraries:value[@"libraries"]];NSDictionary *result=value[@"result"];self.status.stringValue=[NSString stringWithFormat:@"재생목록 등록 · 문서 %@개 확인 · 누락/충돌 %lu개",result[@"count"],(unsigned long)[result[@"issues"] count]];if([result[@"issues"] count])YBShowText(@"아직 연결되지 않은 문서",[result[@"issues"] componentsJoinedByString:@"\n"]);}];
}
- (void)acceptComparison:(NSDictionary *)result {self.comparison=result;[self.table reloadData];NSUInteger count=0;for(NSDictionary *r in result[@"rows"])if([r[@"status"] isEqual:@"download"])count++;self.status.stringValue=[NSString stringWithFormat:@"%@ · 문서 %lu개 받기 · 순서 %@ · %@",result[@"manifest"][@"playlist"][@"name"],(unsigned long)count,[result[@"orderChanged"] boolValue] ? @"변경" : @"일치",[result[@"ready"] boolValue] ? @"동기화 가능" : @"누락/충돌 확인 필요"];}
- (void)compare:(id)sender {
    NSInteger index=self.menu.indexOfSelectedItem;if(index<0 || (NSUInteger)index>=self.choices.count){YBAlert(@"플레이리스트를 선택해 주세요.",@"먼저 서버 목록을 불러오세요.");return;}NSDictionary *choice=self.choices[index];self.comparison=nil;[self.table reloadData];self.status.stringValue=@"순서와 연결 문서를 비교하고 있습니다…";
    [self.work run:^id{return [[self engine] compare:choice[@"library"] node:choice[@"node"]];} completion:^(NSDictionary *result,NSString *error){if(error){self.status.stringValue=@"비교하지 못했습니다.";YBAlert(@"순서 비교",error);}else{[self acceptComparison:result];if([result[@"issues"] count])YBShowText(@"확인이 필요한 항목",[result[@"issues"] componentsJoinedByString:@"\n"]);}}];
}
- (NSInteger)numberOfRowsInTableView:(NSTableView *)table{return [self.comparison[@"manifest"][@"items"] count];}
- (NSView *)tableView:(NSTableView *)table viewForTableColumn:(NSTableColumn *)column row:(NSInteger)index {
    NSDictionary *item=self.comparison[@"manifest"][@"items"][index],*row=nil;for(NSDictionary *r in self.comparison[@"rows"])if([r[@"path"] isEqual:item[@"path"]])row=r;
    NSString *text=@"";if([column.identifier isEqual:@"index"])text=[NSString stringWithFormat:@"%ld",(long)index+1];else if([column.identifier isEqual:@"name"])text=item[@"name"];else if([column.identifier isEqual:@"status"])text=[item[@"kind"] isEqual:@"header"] ? @"구분" : row ? YBStatusName(row[@"status"]) : @"문서 누락";else {text=[item[@"path"] isKindOfClass:NSString.class] ? item[@"path"] : @"";if([item[@"sharedWith"] count])text=[text stringByAppendingFormat:@" · 함께 사용: %@",[item[@"sharedWith"] componentsJoinedByString:@", "]];}
    NSTextField *field=YBLabel(text ?: @"",NSMakeRect(0,2,column.width,24),13,NO);field.toolTip=text;return field;
}
- (void)receive:(id)sender {
    if(![self.comparison[@"ready"] boolValue]){YBAlert(@"먼저 순서를 비교해 주세요.",@"문서 누락/충돌을 해결한 뒤 다시 비교하면 받을 수 있습니다.");return;}NSDictionary *comparison=self.comparison;
    if(!YBConfirm(@"이 플레이리스트를 Mac에 적용할까요?",[NSString stringWithFormat:@"%@\n%@\n\n연결 문서를 먼저 백업·적용하고 선택한 순서를 반영합니다. 공유 문서 변경은 다른 예배에도 반영됩니다. PP6를 종료하세요.",comparison[@"manifest"][@"playlist"][@"name"],self.target.path],@"백업 후 동기화"))return;
    [self.work run:^id{return [[self engine] receive:comparison progress:^(NSString *message){dispatch_async(dispatch_get_main_queue(),^{self.status.stringValue=message;});}];} completion:^(NSString *identifier,NSString *error){self.comparison=nil;[self.table reloadData];if(error){self.status.stringValue=@"미완료 · 백업 / 중단 복구를 확인하세요.";YBAlert(@"플레이리스트 동기화 중단",error);}else{self.status.stringValue=@"플레이리스트와 문서 적용 완료 · PP6에서 같은 순서를 확인하세요.";NSString *warning=[self engine].library.sync.backupWarning;if(warning.length)YBAlert(@"동기화 완료 · 백업 정리 안내",warning);}}];
}
- (void)restore:(id)sender {
    [self.work run:^id{return [[self engine] jobs];} completion:^(NSArray *jobs,NSString *error){if(error){YBAlert(@"백업 목록",error);return;}NSMutableArray *available=[NSMutableArray array];for(NSDictionary *job in jobs)if(![job[@"status"] isEqual:@"restored"])[available addObject:job];if(!available.count){YBAlert(@"백업 · 중단 복구",@"복구할 플레이리스트 기록이 없습니다.");return;}
        NSAlert *alert=[NSAlert new];alert.messageText=@"플레이리스트 작업을 적용 전으로 복구";alert.informativeText=@"선택한 작업의 문서와 재생목록을 함께 되돌립니다. 새 백업은 문서 받기와 합쳐 완료 작업 10회를 보관하며 중단·구버전 기록은 추가 보존합니다. 이후 수정한 파일은 자동으로 덮어쓰지 않습니다. 중단 복구 후 다시 비교·받기를 할 수 있습니다.";NSPopUpButton *menu=[[NSPopUpButton alloc] initWithFrame:NSMakeRect(0,0,710,32) pullsDown:NO];for(NSDictionary *j in available)[menu addItemWithTitle:[NSString stringWithFormat:@"%@ · %@ · %@",j[@"name"],[j[@"status"] isEqual:@"committed"] ? @"완료한 작업 복원" : @"중단 작업 복구",[NSDate dateWithTimeIntervalSince1970:[j[@"createdAt"] doubleValue]]]];alert.accessoryView=menu;[alert addButtonWithTitle:@"복구하기"];[alert addButtonWithTitle:@"취소"];if([alert runModal]!=NSAlertFirstButtonReturn)return;NSDictionary *job=available[menu.indexOfSelectedItem];
        [self.work run:^id{[[self engine] restoreJob:job[@"id"]];return @YES;} completion:^(id result,NSString *failure){[self selectionChanged:nil];self.status.stringValue=failure ? @"복구 미완료 · 이후 변경된 파일을 확인하세요." : @"문서와 재생목록을 복구했습니다. 다시 비교·동기화하세요.";if(failure)YBAlert(@"작업 복구",failure);}];
    }];
}
- (void)openStudio:(id)sender {[NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:@"https://yebaeon.grace-jean-p.workers.dev/"]];}
@end

