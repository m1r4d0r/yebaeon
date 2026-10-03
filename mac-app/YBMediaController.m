#import "YBMediaController.h"
#import "YBLibrary.h"
#import "../mac-sync/PP6Core.h"
#import "../mac-sync/YBSync.h"
NSDictionary *YBMediaReport(NSString *documentsRoot,NSArray *mediaRoots) {
    BOOL dir=NO;YBRequire([NSFileManager.defaultManager fileExistsAtPath:documentsRoot isDirectory:&dir] && dir,@"문서 폴더가 없습니다. 문서 탭에서 폴더를 먼저 선택해 주세요.");
    NSDictionary *index=PP6BuildMediaIndex(mediaRoots);NSMutableArray *rows=[NSMutableArray array],*errors=[NSMutableArray array];NSMutableDictionary *counts=[NSMutableDictionary dictionary];
    NSArray *paths=PP6ScanFiles(documentsRoot,YES);
    for(NSString *path in paths) {@autoreleasepool {
        NSDictionary *doc=PP6ParseDocument(path,mediaRoots,index,@[],@{},NO);
        if([doc[@"parseError"] length]){[errors addObject:@{@"path":PP6RelativePath(path,documentsRoot),@"message":doc[@"parseError"]}];continue;}
        for(NSDictionary *reference in doc[@"mediaRefs"]) {
            NSMutableDictionary *row=[reference mutableCopy];row[@"document"]=PP6RelativePath(path,documentsRoot);NSString *status=reference[@"resolution"][@"status"] ?: @"unknown";
            row[@"status"]=status;counts[status]=@([counts[status] integerValue]+1);[rows addObject:row];
        }
    }}
    return @{@"schema":@"yebaeon-media-report-v1",@"documentsRoot":documentsRoot,@"mediaRoots":mediaRoots,@"searchedRoots":index[@"roots"],@"documents":@(paths.count),@"assets":@([index[@"assets"] count]),@"counts":counts,@"rows":rows,@"errors":errors};
}
static NSString *MediaStatus(NSString *status) {return @{@"exact-managed":@"연결됨",@"exact-external":@"외부 폴더에 있음",@"exact-package":@"묶음 안에 있음",@"relocated-unique":@"다른 위치에서 발견",@"package-asset":@"묶음에서 발견",@"ambiguous":@"같은 이름 여러 개",@"missing":@"찾지 못함"}[status] ?: status;}
@interface YBMediaController () <NSTableViewDataSource,NSTableViewDelegate,NSSearchFieldDelegate>
@property(nonatomic,readwrite) NSView *view;
@property(nonatomic) NSString *documentsRoot;
@property(nonatomic) NSString *receiveRoot;
@property NSMutableArray *roots;
@property YBWork *work;
@property NSTextField *rootLabel;
@property NSTextField *mediaLabel;
@property NSTextField *statusLabel;
@property NSSearchField *search;
@property NSButton *problemsOnly;
@property NSTableView *table;
@property NSDictionary *report;
@property NSArray *visibleRows;
@end
@implementation YBMediaController
- (instancetype)initWithWork:(YBWork *)work documentsRoot:(NSString *)root {
    if((self=[super init])) {self.work=work;self.documentsRoot=root;self.visibleRows=@[];
        NSDictionary *settings=YBPreferences(@"media-settings.json");NSArray *saved=settings[@"roots"];self.receiveRoot=settings[@"receiveRoot"];self.roots=[NSMutableArray array];
        if([saved isKindOfClass:NSArray.class])for(id path in saved)if([path isKindOfClass:NSString.class] && [path isAbsolutePath])[self.roots addObject:path];
        if(!self.roots.count)[self.roots addObjectsFromArray:@[@"/Users/Shared/Renewed Vision Media",@"/Users/Shared/ProCG Content"]];[self buildView];
    }return self;
}
- (void)buildView {
    YBPanel *v=[[YBPanel alloc] initWithFrame:NSMakeRect(0,0,1060,720)];self.view=v;
    self.rootLabel=YBLabel([@"문서 폴더: " stringByAppendingString:self.documentsRoot],NSZeroRect,13,NO);
    self.mediaLabel=YBLabel([self.roots componentsJoinedByString:@"  ·  "],NSZeroRect,12,NO);
    self.search=[[NSSearchField alloc] initWithFrame:NSMakeRect(24,542,414,28)];self.search.placeholderString=@"배경 파일명 또는 문서 검색";self.search.delegate=self;[v addSubview:self.search];
    self.problemsOnly=[[NSButton alloc] initWithFrame:NSMakeRect(455,542,247,28)];self.problemsOnly.buttonType=NSSwitchButton;self.problemsOnly.title=@"연결 확인이 필요한 항목만";self.problemsOnly.target=self;self.problemsOnly.action=@selector(filterAction:);[v addSubview:self.problemsOnly];
    NSButton *scan=YBButton(@"이미지 전송 대상 확인",NSZeroRect,self,@selector(scan:));[v addSubview:scan];
    NSButton *receiveFolder=YBButton(@"수신 이미지 폴더",NSZeroRect,self,@selector(chooseReceiveRoot:));[v addSubview:receiveFolder];
    self.table=YBTable(v,NSMakeRect(24,143,1012,383),@[@[@"status",@"연결 상태",@172],@[@"basename",@"사용한 미디어",@315],@[@"document",@"문서",@331],@[@"slide",@"슬라이드",@90],@[@"background",@"배경",@60]],self);self.table.allowsMultipleSelection=NO;
    self.statusLabel=YBLabel(@"문서 탭과 같은 문서 폴더를 점검합니다.",NSMakeRect(24,108,1012,25),13,NO);[v addSubview:self.statusLabel];
    NSTextField *note=YBLabel(@"전체 문서의 참조 이미지 · 내용 hash로 중복 제거 · 영상 제외 · 준비 확인 후 전송",NSMakeRect(24,78,1012,24),12,NO);note.textColor=NSColor.secondaryLabelColor;[v addSubview:note];
    NSButton *details=YBButton(@"선택 항목 자세히",NSZeroRect,self,@selector(details:));[v addSubview:details];
    NSButton *reveal=YBButton(@"Finder에서 보기",NSZeroRect,self,@selector(reveal:));[v addSubview:reveal];
    NSButton *export=YBButton(@"점검 결과 저장",NSZeroRect,self,@selector(exportReport:));[v addSubview:export];
    NSButton *send=YBButton(@"이미지 서버 전송",NSZeroRect,self,@selector(uploadToServer:));[v addSubview:send];
    NSButton *connections=YBButton(@"이동한 파일 찾기",NSZeroRect,self,@selector(scanConnections:));[v addSubview:connections];
    __weak YBMediaController *weakSelf=self;
    v.frameLayout=^(NSSize size){YBMediaController *c=weakSelf;CGFloat w=size.width,h=size.height,m=14;
        c.search.frame=NSMakeRect(m,h-36,w-500,26);c.problemsOnly.frame=NSMakeRect(w-474,h-38,260,28);scan.frame=NSMakeRect(w-204,h-40,190,32);
        c.table.enclosingScrollView.frame=NSMakeRect(m,112,w-2*m,MAX(80,h-160));c.statusLabel.frame=NSMakeRect(m,82,w-2*m,24);note.frame=NSMakeRect(m,55,w-2*m,24);
        details.frame=NSMakeRect(m,14,140,32);reveal.frame=NSMakeRect(m+148,14,130,32);connections.frame=NSMakeRect(m+286,14,150,32);receiveFolder.frame=NSMakeRect(m+444,14,126,32);send.frame=NSMakeRect(w-m-274,14,134,32);export.frame=NSMakeRect(w-m-132,14,132,32);
    };v.frameLayout(v.bounds.size);
}
- (NSString *)mediaJournalKeyForReport:(NSDictionary *)report server:(YBServer *)server {
    NSMutableArray *signature=[NSMutableArray array];for(NSDictionary *asset in report[@"uniqueAssets"])[signature addObject:@[asset[@"sha256"],asset[@"size"]]];
    NSData *data=[NSJSONSerialization dataWithJSONObject:@{ @"origin":server.origin,@"root":self.documentsRoot.stringByStandardizingPath,@"profile":YBProfilePath(self.documentsRoot,server.origin),@"assets":signature } options:0 error:NULL];return YBHash(data);
}
- (void)saveMediaJournal:(NSDictionary *)journal {
    NSString *dir=YBPreferencesDirectory();NSError *error=nil;BOOL ok=[NSFileManager.defaultManager createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:&error];
    NSMutableDictionary *jobs=[YBPreferences(@"media-transfer-journal.json") mutableCopy];[jobs addEntriesFromDictionary:journal];NSData *data=[NSJSONSerialization dataWithJSONObject:jobs options:NSJSONWritingPrettyPrinted error:&error];YBRequire(ok&&data&&[data writeToFile:[dir stringByAppendingPathComponent:@"media-transfer-journal.json"] options:NSDataWritingAtomic error:&error],error.localizedDescription ?: @"전송 재개 기록을 저장하지 못했습니다.");
}
- (void)uploadToServer:(id)sender {
    if(!self.report || ![self.report[@"prepared"] boolValue]){YBAlert(@"전송 전에 전체 확인이 필요합니다.",@"‘이미지 전송 대상 확인’을 실행해 누락·미지원 항목이 없는지 확인하세요.");return;}
    if(!self.libraryProvider){YBAlert(@"서버 연결을 사용할 수 없습니다.",@"문서 탭에서 서버에 입장한 뒤 다시 시도하세요.");return;}
    NSDictionary *report=self.report;YBLibrary *library=self.libraryProvider();if(!library)return;
    if(!YBConfirm(@"확인된 이미지 전송",[NSString stringWithFormat:@"전체 문서에서 참조한 고유 이미지 %@개 (%@)를 %@에 전송하고 현재 서버 문서와 참조를 연결합니다. 기존 내용 hash는 재사용합니다.",report[@"assets"],[NSByteCountFormatter stringFromByteCount:[report[@"uniqueBytes"] longLongValue] countStyle:NSByteCountFormatterCountStyleFile],library.server.origin],@"전송 시작"))return;
    self.statusLabel.stringValue=@"서버 이미지 존재 여부를 확인하고 전송을 시작합니다…";
    [self.work runPausable:YES task:^id{
        NSString *journalKey=[self mediaJournalKeyForReport:report server:library.server];NSMutableDictionary *journal=[YBPreferences(@"media-transfer-journal.json")[journalKey] mutableCopy];
        if(!journal)journal=[@{@"jobId":NSUUID.UUID.UUIDString,@"key":journalKey,@"origin":library.server.origin,@"documentsRoot":self.documentsRoot,@"createdAt":NSDate.date.description,@"completedHashes":[NSMutableDictionary dictionary],@"completedReferences":[NSMutableDictionary dictionary]} mutableCopy];
        NSMutableDictionary *completedHashes=[journal[@"completedHashes"] mutableCopy] ?: [NSMutableDictionary dictionary],*completedRefs=[journal[@"completedReferences"] mutableCopy] ?: [NSMutableDictionary dictionary];
        NSMutableArray *hashes=[NSMutableArray array];for(NSDictionary *asset in report[@"uniqueAssets"])[hashes addObject:asset[@"sha256"]];NSMutableDictionary *present=[NSMutableDictionary dictionary];
        for(NSUInteger i=0;i<hashes.count;i+=100){[self.work checkpoint];for(NSDictionary *asset in [library.server mediaAssets:[hashes subarrayWithRange:NSMakeRange(i,MIN((NSUInteger)100,hashes.count-i))]])present[asset[@"sha256"]]=asset;}
        NSMutableDictionary *assetByHash=[NSMutableDictionary dictionary];for(NSDictionary *asset in report[@"uniqueAssets"])assetByHash[asset[@"sha256"]]=asset;
        NSUInteger completed=0;for(NSString *hash in hashes){[self.work checkpoint];NSDictionary *asset=assetByHash[hash];unsigned long long size=[asset[@"size"] unsignedLongLongValue];
            NSDictionary *serverAsset=present[hash];if(serverAsset)YBRequire([serverAsset[@"size"] unsignedLongLongValue]==size,@"같은 SHA-256으로 크기가 다른 서버 이미지가 있습니다. 전송을 중지했습니다.");BOOL verified=NO;if(serverAsset)verified=[completedHashes[hash] boolValue] || [library.server mediaContentExists:hash size:size];
            if(!verified){NSData *bytes=YBReadPreparedImage([asset[@"paths"] firstObject],hash,size,^{[self.work checkpoint];});[library.server uploadMedia:bytes sha256:hash];YBRequire([library.server mediaContentExists:hash size:size],@"전송 응답 뒤 서버 원본을 확인하지 못했습니다. 다시 실행해 이어가세요.");}
            completedHashes[hash]=@YES;journal[@"completedHashes"]=completedHashes;[self saveMediaJournal:@{journalKey:journal}];completed++;
            dispatch_async(dispatch_get_main_queue(),^{self.statusLabel.stringValue=[NSString stringWithFormat:@"이미지 %@/%lu · SHA-256 확인 완료",@(completed),(unsigned long)hashes.count];});
        }
        NSArray *remoteDocs=[library.server documentsChecking:^{[self.work checkpoint];}];NSMutableDictionary *remoteByPath=[NSMutableDictionary dictionary];for(NSDictionary *doc in remoteDocs)remoteByPath[doc[@"path"]]=doc;
        NSMutableDictionary *rowsByDocument=[NSMutableDictionary dictionary];for(NSDictionary *row in report[@"rows"]){NSString *path=row[@"document"],*hash=row[@"sha256"];if(!path||!hash||![row[@"transferState"] isEqual:@"원본 확인"])continue;NSMutableArray *rows=rowsByDocument[path];if(!rows){rows=[NSMutableArray array];rowsByDocument[path]=rows;}[rows addObject:row];}
        NSMutableArray *pending=[NSMutableArray array];NSUInteger linked=0;
        for(NSString *path in [rowsByDocument.allKeys sortedArrayUsingSelector:@selector(compare:)]){[self.work checkpoint];NSDictionary *doc=remoteByPath[path];if(!doc||![doc[@"sha256"] isEqual:report[@"documentHashes"][path]]){[pending addObject:path];continue;}
            NSString *refKey=[NSString stringWithFormat:@"%@/%@",doc[@"id"],doc[@"version"]];if([completedRefs[refKey] boolValue]){linked++;continue;}
            NSMutableDictionary *unique=[NSMutableDictionary dictionary],*identityCounts=[NSMutableDictionary dictionary];for(NSDictionary *row in rowsByDocument[path]){NSString *identity=[NSString stringWithFormat:@"%@\n%@\n%@\n%@\n%@",row[@"slide"],row[@"kind"] ?: @"",row[@"uuid"] ?: @"",row[@"position"] ?: @"",row[@"source"] ?: @""];NSUInteger ordinal=[identityCounts[identity] unsignedIntegerValue];identityCounts[identity]=@(ordinal+1);NSString *identifier=YBHash([[identity stringByAppendingFormat:@"\n%lu",(unsigned long)ordinal] dataUsingEncoding:NSUTF8StringEncoding]);unique[identifier]=@{@"id":identifier,@"sha256":row[@"sha256"],@"source":row[@"source"] ?: @"",@"slide":row[@"slide"] ?: @0};}
            NSArray *references=unique.allValues;[library.server registerMediaReferences:references document:doc];completedRefs[refKey]=@YES;journal[@"completedReferences"]=completedRefs;[self saveMediaJournal:@{journalKey:journal}];linked++;
        }
        return @{@"uploaded":@(completed),@"linked":@(linked),@"pending":pending,@"totalAssets":@(hashes.count),@"journalKey":journalKey};
    } completion:^(NSDictionary *result,NSString *error){
        if(error){self.statusLabel.stringValue=@"이미지 전송이 중단됐습니다. 재개 기록을 보존했습니다.";YBAlert(@"이미지 전송 미완료",error);return;}
        NSMutableDictionary *updated=[self.report mutableCopy];updated[@"serverVerified"]=@([result[@"pending"] count]==0);self.report=updated;
        self.statusLabel.stringValue=[NSString stringWithFormat:@"이미지 %@/%@ 확인 · 문서 참조 %@개 연결 · 서버 미등록/변경 문서 %@개 보류",result[@"uploaded"],result[@"totalAssets"],result[@"linked"],@([result[@"pending"] count])];
        if([result[@"pending"] count])YBShowText(@"문서 참조는 대기 중",[NSString stringWithFormat:@"이미지는 서버에서 확인했지만 다음 문서는 서버에 없거나 현재 원본과 달라 참조를 연결하지 않았습니다. 문서를 서버에 맞춘 뒤 이미지 전송을 다시 실행하세요.\n\n%@",[result[@"pending"] componentsJoinedByString:@"\n"]]);
    }];
}
- (void)setDocumentsRoot:(NSString *)root {_documentsRoot=root;self.rootLabel.stringValue=[@"문서 폴더: " stringByAppendingString:root];self.report=nil;[self filter];self.statusLabel.stringValue=@"문서 폴더가 바뀌었습니다. 다시 점검하세요.";}
- (void)changedRoots {self.mediaLabel.stringValue=[self.roots componentsJoinedByString:@"  ·  "];self.report=nil;[self filter];self.statusLabel.stringValue=@"검색 폴더가 바뀌었습니다. 다시 점검하세요.";NSMutableDictionary *settings=[YBPreferences(@"media-settings.json") mutableCopy];settings[@"roots"]=self.roots;YBSavePreferences(@"media-settings.json",settings);}
- (void)chooseReceiveRoot:(id)sender {NSString *path=YBChooseFolder(@"서버에서 받은 이미지를 설치할 폴더",self.receiveRoot);if(!path)return;self.receiveRoot=path;NSMutableDictionary *settings=[YBPreferences(@"media-settings.json") mutableCopy];settings[@"receiveRoot"]=path;YBSavePreferences(@"media-settings.json",settings);self.statusLabel.stringValue=[@"수신 폴더: " stringByAppendingString:path];}
- (void)addRoot:(id)sender {NSString *path=YBChooseFolder(@"미디어를 찾을 폴더 추가",self.roots.lastObject);if(path && ![self.roots containsObject:path]){[self.roots addObject:path];[self changedRoots];}}
- (void)defaultRoots:(id)sender {self.roots=[@[@"/Users/Shared/Renewed Vision Media",@"/Users/Shared/ProCG Content"] mutableCopy];[self changedRoots];}
- (void)scan:(id)sender {
    self.statusLabel.stringValue=@"전체 문서의 참조 이미지와 내용 중복을 확인하고 있습니다…";NSString *root=self.documentsRoot;NSArray *roots=[self.roots copy];
    [self.work runPausable:YES task:^id{return YBImagePreparationReport(root,roots,^{[self.work checkpoint];});} completion:^(NSDictionary *report,NSString *error){
        if(error){self.report=nil;[self filter];self.statusLabel.stringValue=@"전송 대상을 끝까지 확인하지 못했습니다.";YBAlert(@"이미지 전송 준비",error);return;}
        self.report=report;[self filter];self.statusLabel.stringValue=[NSString stringWithFormat:@"문서 %@ · 고유 이미지 %@ · 중복 절감 %@ · 확인 %@ · 영상 %@ 제외",report[@"documents"],report[@"assets"],[NSByteCountFormatter stringFromByteCount:[report[@"duplicateBytes"] longLongValue] countStyle:NSByteCountFormatterCountStyleFile],@([report[@"unresolved"] unsignedIntegerValue]+[report[@"errors"] count]),report[@"excludedVideos"]];self.statusLabel.toolTip=self.statusLabel.stringValue;
        if([report[@"errors"] count]){NSMutableArray *lines=[NSMutableArray array];for(NSDictionary *e in report[@"errors"])[lines addObject:[NSString stringWithFormat:@"%@: %@",e[@"path"],e[@"message"]]];YBShowText(@"전체 확인을 마치지 못한 항목",[lines componentsJoinedByString:@"\n"]);}
    }];
}
- (void)scanConnections:(id)sender {
    self.statusLabel.stringValue=@"문서와 미디어를 점검하고 있습니다…";NSString *root=self.documentsRoot;NSArray *roots=[self.roots copy];
    [self.work run:^id {return YBMediaReport(root,roots);} completion:^(NSDictionary *report,NSString *error) {
        if(error){self.report=nil;[self filter];self.statusLabel.stringValue=@"점검하지 못했습니다.";YBAlert(@"미디어 점검",error);return;}
        self.report=report;[self filter];NSDictionary *counts=report[@"counts"];
        self.statusLabel.stringValue=[NSString stringWithFormat:@"문서 %@개 · 검색한 미디어 %@개 · 누락 %@ · 다른 위치 %@ · 이름 중복 %@ · 문서 오류 %lu",report[@"documents"],report[@"assets"],counts[@"missing"] ?: @0,counts[@"relocated-unique"] ?: @0,counts[@"ambiguous"] ?: @0,(unsigned long)[report[@"errors"] count]];
        if([report[@"errors"] count]) {NSMutableArray *lines=[NSMutableArray array];for(NSDictionary *e in report[@"errors"])[lines addObject:[NSString stringWithFormat:@"%@: %@",e[@"path"],e[@"message"]]];YBShowText(@"일부 문서를 분석하지 못했습니다.",[lines componentsJoinedByString:@"\n"]);}
    }];
}
- (void)filter {NSMutableArray *visible=[NSMutableArray array];NSString *q=self.search.stringValue;
    for(NSDictionary *r in self.report[@"rows"]) {BOOL issue=r[@"error"] || [@[@"missing",@"ambiguous",@"relocated-unique",@"package-asset"] containsObject:r[@"status"]];if(self.problemsOnly.state==NSControlStateValueOn && !issue)continue;
        NSString *haystack=[NSString stringWithFormat:@"%@ %@",r[@"basename"],r[@"document"]];if(q.length && [haystack rangeOfString:q options:NSCaseInsensitiveSearch].location==NSNotFound)continue;[visible addObject:r];}
    self.visibleRows=visible;[self.table reloadData];
}
- (void)filterAction:(id)sender {[self filter];}
- (void)controlTextDidChange:(NSNotification *)note {[self filter];}
- (NSInteger)numberOfRowsInTableView:(NSTableView *)table {return self.visibleRows.count;}
- (NSView *)tableView:(NSTableView *)table viewForTableColumn:(NSTableColumn *)column row:(NSInteger)index {
    NSDictionary *row=self.visibleRows[index];NSString *text=[column.identifier isEqual:@"status"] ? (row[@"transferState"] ?: MediaStatus(row[@"status"])) : [column.identifier isEqual:@"slide"] ? [NSString stringWithFormat:@"%@장",row[@"slide"]] : [column.identifier isEqual:@"background"] ? ([row[@"background"] boolValue] ? @"배경" : @"요소") : row[column.identifier];
    NSTextField *field=YBLabel(text,NSMakeRect(0,2,column.width,24),13,NO);field.toolTip=text;
    if([row[@"status"] isEqual:@"missing"] || [row[@"status"] isEqual:@"ambiguous"])field.textColor=[NSColor colorWithCalibratedRed:0.68 green:0.15 blue:0.12 alpha:1];return field;
}
- (NSDictionary *)selection {NSInteger i=self.table.selectedRow;if(i<0 || (NSUInteger)i>=self.visibleRows.count){YBAlert(@"항목을 선택해 주세요.",@"목록에서 확인할 미디어 행을 클릭하세요.");return nil;}return self.visibleRows[i];}
- (void)details:(id)sender {NSDictionary *row=[self selection];if(!row)return;NSDictionary *resolution=row[@"resolution"];
    NSMutableString *text=[NSMutableString stringWithFormat:@"%@\n%@ · %@장\n상태: %@\n\n문서에 기록된 위치:\n%@\n\n발견한 위치:\n%@\n",row[@"basename"],row[@"document"],row[@"slide"],row[@"transferState"] ?: MediaStatus(row[@"status"]),row[@"sourcePath"],resolution[@"resolvedPath"] ?: @"없음"];
    for(NSDictionary *candidate in resolution[@"candidates"])[text appendFormat:@"\n후보: %@",candidate[@"path"] ?: candidate[@"asset"][@"path"] ?: @""];
    if(row[@"sha256"])[text appendFormat:@"\n내용 식별값: %@\n크기: %@\n서버 업로드 여부는 아직 확인하지 않았습니다.",row[@"sha256"],[NSByteCountFormatter stringFromByteCount:[row[@"size"] longLongValue] countStyle:NSByteCountFormatterCountStyleFile]];
    if(row[@"error"])[text appendFormat:@"\n확인 필요: %@",row[@"error"]];
    if([row[@"status"] isEqual:@"video-local-only"])[text appendString:@"\n영상은 서버 업로드 대상에서 제외합니다. PP6에서 사용할 영상 원본은 Mac에 유지하세요."];
    if([row[@"status"] isEqual:@"relocated-unique"])[text appendString:@"\n\n같은 이름의 파일을 다른 위치에서 찾았습니다. 원본과 같은 파일인지는 내용을 확인해야 하며, 문서의 연결 경로는 아직 변경하지 않았습니다."];
    YBShowText(@"미디어 연결 정보",text);
}
- (void)reveal:(id)sender {NSDictionary *row=[self selection];if(!row)return;NSString *path=row[@"resolution"][@"resolvedPath"];if(!path.length){YBAlert(@"파일 위치",@"한 파일로 확인된 위치가 없습니다. 자세히 보기에서 후보 또는 원래 경로를 확인해 주세요.");return;}[NSWorkspace.sharedWorkspace activateFileViewerSelectingURLs:@[[NSURL fileURLWithPath:path]]];}
- (void)exportReport:(id)sender {if(!self.report){YBAlert(@"먼저 점검해 주세요.",@"미디어 점검을 실행한 뒤 결과를 저장할 수 있습니다.");return;}NSSavePanel *panel=[NSSavePanel savePanel];panel.nameFieldStringValue=@"예배온-미디어-점검.json";panel.allowedFileTypes=@[@"json"];if([panel runModal]!=NSModalResponseOK)return;
    NSError *error=nil;NSData *data=[NSJSONSerialization dataWithJSONObject:self.report options:NSJSONWritingPrettyPrinted error:&error];if(!data || ![data writeToURL:panel.URL options:NSDataWritingAtomic error:&error])YBAlert(@"저장하지 못했습니다.",error.localizedDescription);
}
@end
