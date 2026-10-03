#import "YBMediaController.h"
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
        NSArray *saved=YBPreferences(@"media-settings.json")[@"roots"];self.roots=[NSMutableArray array];
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
    self.table=YBTable(v,NSMakeRect(24,143,1012,383),@[@[@"status",@"연결 상태",@172],@[@"basename",@"사용한 미디어",@315],@[@"document",@"문서",@331],@[@"slide",@"슬라이드",@90],@[@"background",@"배경",@60]],self);self.table.allowsMultipleSelection=NO;
    self.statusLabel=YBLabel(@"문서 탭과 같은 문서 폴더를 점검합니다.",NSMakeRect(24,108,1012,25),13,NO);[v addSubview:self.statusLabel];
    NSTextField *note=YBLabel(@"전체 문서의 참조 이미지 · 같은 내용은 한 번 계산 · 영상 제외 · 아직 서버에 전송하지 않습니다.",NSMakeRect(24,78,1012,24),12,NO);note.textColor=NSColor.secondaryLabelColor;[v addSubview:note];
    NSButton *details=YBButton(@"선택 항목 자세히",NSZeroRect,self,@selector(details:));[v addSubview:details];
    NSButton *reveal=YBButton(@"Finder에서 보기",NSZeroRect,self,@selector(reveal:));[v addSubview:reveal];
    NSButton *export=YBButton(@"점검 결과 저장",NSZeroRect,self,@selector(exportReport:));[v addSubview:export];
    NSButton *connections=YBButton(@"이동한 파일 찾기",NSZeroRect,self,@selector(scanConnections:));[v addSubview:connections];
    __weak YBMediaController *weakSelf=self;
    v.frameLayout=^(NSSize size){YBMediaController *c=weakSelf;CGFloat w=size.width,h=size.height,m=14;
        c.search.frame=NSMakeRect(m,h-36,w-500,26);c.problemsOnly.frame=NSMakeRect(w-474,h-38,260,28);scan.frame=NSMakeRect(w-204,h-40,190,32);
        c.table.enclosingScrollView.frame=NSMakeRect(m,112,w-2*m,MAX(80,h-160));c.statusLabel.frame=NSMakeRect(m,82,w-2*m,24);note.frame=NSMakeRect(m,55,w-2*m,24);
        details.frame=NSMakeRect(m,14,166,32);reveal.frame=NSMakeRect(m+176,14,150,32);connections.frame=NSMakeRect(m+336,14,166,32);export.frame=NSMakeRect(w-m-170,14,170,32);
    };v.frameLayout(v.bounds.size);
}
- (void)setDocumentsRoot:(NSString *)root {_documentsRoot=root;self.rootLabel.stringValue=[@"문서 폴더: " stringByAppendingString:root];self.report=nil;[self filter];self.statusLabel.stringValue=@"문서 폴더가 바뀌었습니다. 다시 점검하세요.";}
- (void)changedRoots {self.mediaLabel.stringValue=[self.roots componentsJoinedByString:@"  ·  "];self.report=nil;[self filter];self.statusLabel.stringValue=@"검색 폴더가 바뀌었습니다. 다시 점검하세요.";YBSavePreferences(@"media-settings.json",@{@"roots":self.roots});}
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

