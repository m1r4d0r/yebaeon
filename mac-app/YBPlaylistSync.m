#import "YBPlaylistSync.h"
#import "YBPlaylistIO.h"
#import "YBPlaylistFormat.h"
static NSData *Data(NSString *s){return [s dataUsingEncoding:NSUTF8StringEncoding];}
static NSData *JSON(NSDictionary *value){NSData *d=[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingPrettyPrinted error:NULL];YBRequire(d!=nil,@"동기화 기록을 저장하지 못했습니다.");return d;}
static NSString *Query(NSString *s){return [s stringByAddingPercentEncodingWithAllowedCharacters:[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~"]];}
static id Null(id value){return value ?: NSNull.null;}
static id Value(id value){return value==NSNull.null ? nil : value;}
static BOOL Equal(id a,id b){return a==b || [a isEqual:b];}
@interface YBPlaylistSync ()
@property(nonatomic,readwrite) YBLibrary *library;
@property(nonatomic,readwrite) NSURL *target;
@end
@implementation YBPlaylistSync
- (instancetype)initWithLibrary:(YBLibrary *)library target:(NSURL *)target {if((self=[super init])){_library=library;_target=target;}return self;}
- (NSDictionary *)readJSON:(NSString *)path {
    NSData *data=YBReadSafeFile(self.library.sync.profile,path,NULL);if(!data)return nil;
    NSDictionary *value=[NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingMutableContainers error:NULL];YBRequire([value isKindOfClass:NSDictionary.class],@"플레이리스트 기록이 손상됐습니다.");return value;
}
- (void)writeJSON:(NSDictionary *)value path:(NSString *)path {YBWriteSafeFile(self.library.sync.profile,path,JSON(value),0600,nil);}
- (NSString *)statePath {return [NSString stringWithFormat:@"playlist-state-%@.json",YBHash(Data(self.target.path.stringByStandardizingPath))];}
- (NSMutableDictionary *)state { (void)self.library.sync.entries;NSDictionary *s=[self readJSON:self.statePath];if(s)YBRequire([s[@"target"] isEqual:self.target.path] && [s[@"entries"] isKindOfClass:NSDictionary.class],@"재생목록 기준의 경로가 다릅니다.");return s ? [s mutableCopy] : [@{@"target":self.target.path,@"entries":[NSMutableDictionary dictionary]} mutableCopy];}
- (NSString *)key:(NSDictionary *)plan {return [NSString stringWithFormat:@"%@/%@",plan[@"library"][@"id"],plan[@"playlist"][@"id"]];}
- (NSArray *)libraries {
    NSMutableArray *all=[NSMutableArray array];NSString *after=@"";NSMutableSet *seen=[NSMutableSet set];
    for(;;){if(self.library.operationCheckpoint)self.library.operationCheckpoint();NSDictionary *page=[self.library.server request:[@"/api/playlists?after=" stringByAppendingString:Query(after)] method:@"GET" body:nil headers:nil];YBRequire([page[@"libraries"] isKindOfClass:NSArray.class],@"재생목록 목록이 올바르지 않습니다.");[all addObjectsFromArray:page[@"libraries"]];id next=page[@"next"];if(!next || next==NSNull.null)break;YBRequire([next isKindOfClass:NSString.class] && ![seen containsObject:next],@"재생목록 다음 페이지 오류");[seen addObject:next];after=next;}return all;
}
- (void)rememberFile:(NSDictionary *)remote local:(NSData *)local {
    NSMutableDictionary *state=self.state;
    NSMutableDictionary *entries=[state[@"entries"] mutableCopy];
    if([remote[@"sha256"] isEqual:YBHash(local)])for(NSDictionary *node in YBPlaylistNodes(local)){NSString *hash=YBHash(Data(node[@"raw"]));entries[[NSString stringWithFormat:@"%@/%@",remote[@"id"],node[@"id"]]]=@{@"localHash":hash,@"remoteHash":hash};}
    state[@"entries"]=entries;
    NSArray *preserved=[state[@"file"][@"libraryID"] isEqual:remote[@"id"]] ? state[@"file"][@"preservedNodes"] : nil;state[@"file"]=@{@"libraryID":remote[@"id"],@"remoteHash":remote[@"sha256"],@"localHash":YBHash(local),@"version":remote[@"version"],@"preservedNodes":preserved ?: @[]};
    [self writeJSON:state path:self.statePath];
}
- (NSDictionary *)reconcileFileWithLibraries:(NSArray *)libraries {
    if(!self.target)return @{ @"libraries":libraries, @"status":@"Mac 재생목록 경로를 확인하세요." };
    NSData *local=YBReadPlaylist(self.target);NSString *localHash=YBHash(local);
    NSString *name=self.target.lastPathComponent.precomposedStringWithCanonicalMapping;
    NSDictionary *remote=nil;
    for(NSDictionary *candidate in libraries)if([candidate[@"path"] isEqual:name]){remote=candidate;break;}
    if(!remote){
        if(libraries.count)return @{ @"libraries":libraries, @"status":@"Mac 파일 이름과 서버 재생목록이 다릅니다. 연결할 원본을 확인하세요." };
        YBRequire(!self.library.sync.presenterRunning(),@"PP6 실행 중에는 원본 재생목록을 처음 등록하지 않습니다.");
        YBRequire(local.length<=5*1024*1024,@"서버 재생목록은 5MB까지 지원합니다.");
        NSDictionary *result=[self.library.server request:[NSString stringWithFormat:@"/api/playlists?path=%@&root=%@",Query(name),Query(@"~/Documents/ProPresenter6")] method:@"POST" body:local headers:@{@"Content-Type":@"application/xml; charset=utf-8"}];
        remote=result[@"library"];
        YBRequire([remote[@"sha256"] isEqual:localHash],@"등록한 원본의 해시가 달라 다시 비교해야 합니다.");
        [self rememberFile:remote local:local];
        return @{ @"libraries":[self libraries], @"status":@"Mac 원본 재생목록을 서버에 등록했습니다. 연결 문서는 별도로 비교합니다." };
    }
    NSMutableDictionary *state=self.state;NSDictionary *base=state[@"file"];
    // Repair old auto-registration records only with proof the complete local
    // file still equals the previously registered server original.
    if([base[@"libraryID"] isEqual:remote[@"id"]] && Equal(localHash,base[@"localHash"]) && Equal(base[@"localHash"],base[@"remoteHash"])){
        NSMutableDictionary *entries=[state[@"entries"] mutableCopy];BOOL repaired=NO;
        for(NSDictionary *node in YBPlaylistNodes(local)){NSString *key=[NSString stringWithFormat:@"%@/%@",remote[@"id"],node[@"id"]];if(!entries[key]){NSString *hash=YBHash(Data(node[@"raw"]));entries[key]=@{@"localHash":hash,@"remoteHash":hash};repaired=YES;}}
        if(repaired){state[@"entries"]=entries;[self writeJSON:state path:self.statePath];}
    }

    if([localHash isEqual:remote[@"sha256"]]){
        [self rememberFile:remote local:local];
        return @{ @"libraries":libraries, @"status":@"재생목록 파일이 서버와 같습니다." };
    }
    if(![base isKindOfClass:NSDictionary.class] || ![base[@"libraryID"] isEqual:remote[@"id"]])return @{ @"libraries":libraries, @"status":@"Mac·서버 원본이 다르고 공통 기준이 없습니다. 자동 덮어쓰기를 멈췄습니다." };
    BOOL macChanged=![localHash isEqual:base[@"localHash"]], serverChanged=![remote[@"sha256"] isEqual:base[@"remoteHash"]];
    if(!macChanged)return @{ @"libraries":libraries, @"status":serverChanged ? @"서버에 새 순서가 있습니다. 비교 후 백업하며 받으세요." : @"재생목록 파일에 변경이 없습니다." };
    if(serverChanged)return @{ @"libraries":libraries, @"status":@"Mac과 서버가 모두 바뀌었습니다. 순서를 비교해 충돌을 해결하세요." };
    if(self.library.sync.presenterRunning())return @{ @"libraries":libraries, @"status":@"PP6 실행 중이어서 Mac 재생목록 변경을 서버로 보내지 않았습니다." };
    YBRequire([YBReadPlaylist(self.target) isEqual:local],@"Mac 재생목록이 비교 중 바뀌었습니다. 다시 비교하세요.");
    NSData *serverBytes=local;NSMutableSet *paths=[NSMutableSet set];for(NSDictionary *node in YBPlaylistNodes(local))serverBytes=YBPlaylistReplacing(serverBytes,node[@"id"],[self serverXMLForNode:node root:remote[@"sourceRoot"] ?: @"~/Documents/ProPresenter6" paths:paths]);
    if([base[@"preservedNodes"] count]){NSData *currentServer=[self.library.server downloadPlaylist:remote];for(NSString *nodeID in base[@"preservedNodes"]){NSDictionary *node=YBPlaylistNode(currentServer,nodeID);if(node && !YBPlaylistNode(serverBytes,nodeID))serverBytes=YBPlaylistReplacing(serverBytes,nodeID,node[@"raw"]);}}
    NSDictionary *result=[self.library.server request:[NSString stringWithFormat:@"/api/playlists/%@",Query(remote[@"id"])] method:@"PUT" body:serverBytes headers:@{@"Content-Type":@"application/xml; charset=utf-8",@"If-Match":[NSString stringWithFormat:@"\"%@\"",remote[@"version"]]}];
    NSDictionary *saved=result[@"library"];
    YBRequire([saved[@"sha256"] isEqual:YBHash(serverBytes)],@"서버에 저장한 재생목록의 해시가 다릅니다.");
    if([YBReadPlaylist(self.target) isEqual:local]){[self rememberFile:saved local:local];NSMutableDictionary *s=self.state,*entries=[s[@"entries"] mutableCopy];for(NSDictionary *node in YBPlaylistNodes(local)){NSString *key=[NSString stringWithFormat:@"%@/%@",saved[@"id"],node[@"id"]];entries[key]=@{@"localHash":YBHash(Data(node[@"raw"])),@"remoteHash":YBHash(Data(YBPlaylistNode(serverBytes,node[@"id"])[@"raw"]))};}s[@"entries"]=entries;[self writeJSON:s path:self.statePath];}
    else YBRequire(NO,@"서버 저장 중 Mac 파일이 바뀌었습니다. 서버 이력은 보존되며 다시 비교가 필요합니다.");
    return @{ @"libraries":[self libraries], @"status":@"Mac 재생목록 변경을 서버 새 버전으로 저장했습니다." };
}
- (NSDictionary *)manifest:(NSString *)libraryID node:(NSString *)nodeID {
    NSDictionary *p=[self.library.server request:[NSString stringWithFormat:@"/api/playlists/%@/plan?node=%@",Query(libraryID),Query(nodeID)] method:@"GET" body:nil headers:nil];
    YBRequire([p[@"library"][@"id"] isEqual:libraryID] && [p[@"playlist"][@"id"] isEqual:nodeID] && [p[@"documents"] isKindOfClass:NSArray.class] && [p[@"items"] isKindOfClass:NSArray.class] && [p[@"fingerprint"] isKindOfClass:NSString.class],@"재생목록 계획이 올바르지 않습니다.");for(NSDictionary *doc in p[@"documents"])YBValidateMetadata(doc);return p;
}
- (NSDictionary *)registerFileWithSourceRoot:(NSString *)sourceRoot progress:(void (^)(NSString *))progress {
    YBSync *sync=self.library.sync;[sync assertReady];YBRequire(!sync.presenterRunning(),@"ProPresenter를 종료한 후 등록해 주세요.");NSData *before=YBReadPlaylist(self.target);YBRequire(before.length<=5*1024*1024,@"서버 재생목록은 5MB까지 지원합니다.");NSArray *nodes=YBPlaylistNodes(before);
    NSDictionary *result=[self.library.server request:[NSString stringWithFormat:@"/api/playlists?path=%@&root=%@",Query(self.target.lastPathComponent),Query(sourceRoot)] method:@"POST" body:before headers:@{@"Content-Type":@"application/xml; charset=utf-8"}];NSDictionary *library=result[@"library"];
    YBRequire([library[@"sha256"] isEqual:YBHash(before)],@"서버에 등록한 재생목록 원본이 다릅니다.");
    NSMutableSet *paths=[NSMutableSet set];NSMutableArray *failures=[NSMutableArray array];for(NSDictionary *node in nodes)for(NSDictionary *cue in node[@"items"])if([cue[@"tag"] isEqual:@"RVDocumentCue"]) {NSString *path=YBPlaylistReference(cue[@"attrs"][@"filePath"],sourceRoot);if(path)[paths addObject:path];else [failures addObject:[NSString stringWithFormat:@"문서 폴더와 연결되지 않음: %@",cue[@"attrs"][@"filePath"] ?: @""]];}
    NSMutableDictionary *remote=[NSMutableDictionary dictionary];for(NSDictionary *doc in [self.library.server documentsChecking:self.library.operationCheckpoint])remote[doc[@"path"]]=doc;
    NSUInteger done=0;for(NSString *path in [paths.allObjects sortedArrayUsingSelector:@selector(compare:)]) {
        if(self.library.operationCheckpoint)self.library.operationCheckpoint();
        if(progress)progress([NSString stringWithFormat:@"문서 등록 %lu/%lu · %@",(unsigned long)done+1,(unsigned long)paths.count,path]);
        @try {YBRequire(!sync.presenterRunning(),@"ProPresenter가 실행됐습니다.");NSData *data=[sync readDocument:path];YBRequire(data!=nil,@"Mac 문서 폴더에서 찾지 못했습니다.");NSDictionary *existing=remote[path],*saved=nil;
            if(existing){YBRequire([existing[@"sha256"] isEqual:YBHash(data)],@"서버 문서와 다릅니다. 문서 탭에서 비교해 주세요.");saved=[self.library.server head:existing];YBRequire([saved[@"sha256"] isEqual:YBHash(data)],@"서버 문서가 변경됐습니다.");}
            else saved=[self.library.server upload:data path:path previous:nil];
            [sync acknowledge:saved expectedLocalHash:YBHash(data)];done++;
        }@catch(NSException *e){[failures addObject:[NSString stringWithFormat:@"%@: %@",path,e.reason]];if(sync.presenterRunning())break;}
    }
    YBRequire([YBReadPlaylist(self.target) isEqual:before],@"등록 도중 로컬 재생목록이 변경됐습니다. 파일은 유지했으며 다시 비교해야 합니다.");NSMutableDictionary *state=self.state,*entries=[state[@"entries"] mutableCopy];
    for(NSDictionary *node in nodes){NSString *key=[NSString stringWithFormat:@"%@/%@",library[@"id"],node[@"id"]];entries[key]=@{@"localHash":YBHash(Data(node[@"raw"])),@"remoteHash":YBHash(Data(node[@"raw"]))};}
    state[@"entries"]=entries;[self writeJSON:state path:self.statePath];[self rememberFile:library local:before];return @{@"library":library,@"count":@(done),@"issues":failures};
}
- (NSDictionary *)compare:(NSString *)libraryID node:(NSString *)nodeID {return [self compare:libraryID node:nodeID hashCache:[NSMutableDictionary dictionary]];}
- (NSDictionary *)compare:(NSString *)libraryID node:(NSString *)nodeID hashCache:(NSMutableDictionary *)hashCache {
    YBSync *sync=self.library.sync;(void)sync.entries;NSDictionary *p=[self manifest:libraryID node:nodeID];NSData *before=YBReadPlaylist(self.target);
    NSMutableArray *rows=[NSMutableArray array],*issues=[NSMutableArray array];NSMutableSet *paths=[NSMutableSet set];
    for(NSDictionary *item in p[@"items"])if(Value(item[@"issue"]))[issues addObject:[NSString stringWithFormat:@"%@ · %@",item[@"name"],item[@"issue"]]];
    for(NSDictionary *doc in p[@"documents"]){NSString *path=doc[@"path"];YBRequire(![paths containsObject:path],@"중복 문서 계획");[paths addObject:path];id cached=hashCache[path];if(!cached){cached=Null([sync documentSummary:path][@"hash"]);hashCache[path]=cached;}NSString *hash=Value(cached),*status=YBDisposition(hash,doc,sync.entries[path]);[rows addObject:@{@"path":path,@"status":status,@"localHash":Null(hash),@"remote":doc}];if(![@[@"download",@"same"] containsObject:status])[issues addObject:[NSString stringWithFormat:@"%@ · Mac 수정/충돌: 문서 탭에서 비교해 주세요.",path]];}
    NSDictionary *node=YBPlaylistNode(before,nodeID),*base=self.state[@"entries"][[self key:p]];NSString *localHash=YBHash(Data(node[@"raw"])),*xml=nil;BOOL orderChanged=NO;
    if([p[@"ready"] boolValue]){xml=YBPlaylistLocalXML(p,sync.root);NSString *desiredHash=YBHash(Data(xml));orderChanged=!Equal(localHash,desiredHash);
        BOOL safe=Equal(localHash,desiredHash) || (base && Equal(localHash,base[@"localHash"])) || (!base && (!node || Equal(localHash,p[@"playlist"][@"sha256"])));
        if(!safe)[issues addObject:@"Mac 재생목록도 수정됐거나 최초 기준이 없습니다. 원본 파일을 등록한 Mac에서 비교해 주세요."];
    }
    NSDictionary *active=[self readJSON:@"playlist-active.json"];if(active && ![active[@"status"] isEqual:@"complete"])[issues addObject:@"중단된 플레이리스트 작업을 먼저 복구해 주세요."];
    NSString *observedStatus=@"unknown";
    if([p[@"ready"] boolValue]){if(!orderChanged)observedStatus=@"same";else if(base){BOOL lc=!Equal(localHash,base[@"localHash"]),sc=!Equal(p[@"playlist"][@"sha256"],base[@"remoteHash"]);observedStatus=lc?(sc?@"conflict":@"upload"):@"download";}else if(!node || Equal(localHash,p[@"playlist"][@"sha256"]))observedStatus=@"download";}
    if(active && ![active[@"status"] isEqual:@"complete"])observedStatus=@"unknown";
    [self.library reportSyncItems:@[@{@"kind":@"playlist",@"id":libraryID,@"node":nodeID,@"serverHash":p[@"playlist"][@"sha256"],@"status":observedStatus}]];
    return @{@"localNode":node ?: @{},@"manifest":p,@"rows":rows,@"issues":issues,@"ready":@(issues.count==0 && [p[@"ready"] boolValue]),@"beforeHash":YBHash(before),@"nodeXML":xml ?: @"",@"orderChanged":@(orderChanged),@"target":self.target.path};
}
- (NSString *)jobPath:(NSString *)identifier {YBRequire([identifier isKindOfClass:NSString.class] && [identifier rangeOfString:@"^[0-9A-Fa-f-]{36}$" options:NSRegularExpressionSearch].location!=NSNotFound,@"작업 번호 오류");return [NSString stringWithFormat:@"playlist-batches/%@/job.json",identifier];}
- (NSArray *)jobs {
    (void)self.library.sync.entries;NSString *dir=[self.library.sync.profile stringByAppendingPathComponent:@"playlist-batches"];NSArray *names=[NSFileManager.defaultManager contentsOfDirectoryAtPath:dir error:NULL] ?: @[];NSMutableArray *result=[NSMutableArray array];for(NSString *name in names){NSDictionary *j=[self readJSON:[self jobPath:name]];if(j)[result addObject:j];}return [result sortedArrayUsingComparator:^NSComparisonResult(NSDictionary *a,NSDictionary *b){return [b[@"createdAt"] compare:a[@"createdAt"]];}];
}
- (void)guardPlan:(NSDictionary *)p {if(p[@"batchPlans"]){for(NSDictionary *part in p[@"batchPlans"])[self guardPlan:part];return;}NSDictionary *latest=[self manifest:p[@"library"][@"id"] node:p[@"playlist"][@"id"]];YBRequire([latest[@"fingerprint"] isEqual:p[@"fingerprint"]],@"비교 후 서버의 순서 또는 문서가 변경됐습니다. 중단 기록을 복구한 뒤 다시 비교해 주세요.");}
- (NSString *)receiveComparisons:(NSArray *)comparisons progress:(void (^)(NSString *))progress {
    YBRequire(comparisons.count>0,@"받을 예배가 없습니다.");
    NSMutableArray *plans=[NSMutableArray array];NSMutableDictionary *documents=[NSMutableDictionary dictionary];NSMutableSet *keys=[NSMutableSet set];NSDictionary *first=comparisons[0];
    for(NSDictionary *c in comparisons){NSDictionary *p=c[@"manifest"];NSString *key=[self key:p];YBRequire([p[@"library"][@"id"] isEqual:first[@"manifest"][@"library"][@"id"]] && ![keys containsObject:key] && [c[@"beforeHash"] isEqual:first[@"beforeHash"]] && [c[@"target"] isEqual:first[@"target"]] && [c[@"ready"] boolValue],@"선택한 예배의 비교 기준이 다르거나 충돌이 있습니다. 다시 비교하세요.");[keys addObject:key];[plans addObject:p];
        for(NSDictionary *r in c[@"rows"]){NSDictionary *old=documents[r[@"path"]];YBRequire(!old || [old isEqual:r],@"공유 문서가 비교 도중 변경됐습니다. 다시 비교하세요.");documents[r[@"path"]]=r;}}
    NSMutableDictionary *p=[first[@"manifest"] mutableCopy];p[@"batchPlans"]=plans;NSMutableDictionary *node=[p[@"playlist"] mutableCopy];node[@"name"]=[NSString stringWithFormat:@"%lu개 예배",(unsigned long)comparisons.count];p[@"playlist"]=node;
    NSMutableDictionary *combined=[first mutableCopy];combined[@"manifest"]=p;combined[@"batchComparisons"]=comparisons;combined[@"rows"]=[documents.allValues sortedArrayUsingComparator:^NSComparisonResult(NSDictionary *a,NSDictionary *b){return [a[@"path"] compare:b[@"path"]];}];return [self receive:combined progress:progress];
}
- (NSString *)receive:(NSDictionary *)comparison progress:(void (^)(NSString *))progress {return [self receive:comparison choosingServer:NO progress:progress];}
- (NSString *)receiveChoosingServer:(NSDictionary *)comparison progress:(void (^)(NSString *))progress {return [self receive:comparison choosingServer:YES progress:progress];}
- (NSString *)receive:(NSDictionary *)comparison choosingServer:(BOOL)choosingServer progress:(void (^)(NSString *))progress {
    YBSync *sync=self.library.sync;[sync assertReady];YBRequire(!sync.presenterRunning(),@"ProPresenter를 종료한 후 동기화해 주세요.");YBRequire([comparison[@"target"] isEqual:self.target.path] && ([comparison[@"ready"] boolValue] || (choosingServer && [comparison[@"manifest"][@"ready"] boolValue] && !comparison[@"batchComparisons"])),@"누락/충돌을 먼저 해결해 주세요.");NSDictionary *p=comparison[@"manifest"];[self guardPlan:p];NSData *before=YBReadPlaylist(self.target);YBRequire([YBHash(before) isEqual:comparison[@"beforeHash"]],@"비교 후 Mac 재생목록이 변경됐습니다.");
    NSArray *parts=comparison[@"batchComparisons"] ?: @[comparison];NSData *after=before;
    for(NSDictionary *part in parts){NSDictionary *partPlan=part[@"manifest"],*fresh=[self compare:partPlan[@"library"][@"id"] node:partPlan[@"playlist"][@"id"]];YBRequire(([fresh[@"ready"] boolValue] || (choosingServer && [fresh[@"manifest"][@"ready"] boolValue])) && [fresh[@"rows"] isEqual:part[@"rows"]] && [fresh[@"nodeXML"] isEqual:part[@"nodeXML"]],@"비교 후 Mac 문서 또는 기준이 변경됐습니다.");after=YBPlaylistReplacing(after,partPlan[@"playlist"][@"id"],part[@"nodeXML"]);}
    if(choosingServer){NSMutableDictionary *chosen=[comparison mutableCopy];NSMutableArray *rows=[NSMutableArray array];for(NSDictionary *row in comparison[@"rows"]){YBRequire(!row[@"error"] && [row[@"remote"] isKindOfClass:NSDictionary.class],@"누락·경로 오류는 버전 선택으로 해결할 수 없습니다.");NSMutableDictionary *r=[row mutableCopy];r[@"status"]=[row[@"localHash"] isEqual:row[@"remote"][@"sha256"]] ? @"same" : @"download";[rows addObject:r];}chosen[@"rows"]=rows;comparison=chosen;}
    NSString *identifier=NSUUID.UUID.UUIDString,*folder=[@"playlist-batches/" stringByAppendingString:identifier];NSArray *rows=comparison[@"rows"];
    for(NSUInteger i=0;i<rows.count;i++){NSDictionary *r=rows[i];if([r[@"status"] isEqual:@"download"]){if(progress)progress([@"원본 준비 · " stringByAppendingString:r[@"path"]]);NSData *data=[self.library.server download:r[@"remote"]];YBWriteSafeFile(sync.profile,[NSString stringWithFormat:@"%@/document-%lu.pro6",folder,(unsigned long)i],data,0600,nil);}}
    [self guardPlan:p];YBRequire([YBReadPlaylist(self.target) isEqual:before],@"준비 중 Mac 재생목록이 변경됐습니다.");
    YBWriteSafeFile(sync.profile,[folder stringByAppendingString:@"/before.pro6pl"],before,0600,nil);YBWriteSafeFile(sync.profile,[folder stringByAppendingString:@"/after.pro6pl"],after,0600,nil);
    NSMutableArray *initial=[NSMutableArray array];for(NSDictionary *t in sync.transactions)[initial addObject:t[@"id"]];NSMutableDictionary *state=self.state;NSString *key=[self key:p];
    NSDictionary *incoming=@{@"localHash":YBHash(Data(comparison[@"nodeXML"])),@"remoteHash":p[@"playlist"][@"sha256"],@"fingerprint":p[@"fingerprint"]};
    NSMutableDictionary *job=[@{@"id":identifier,@"createdAt":@([NSDate.date timeIntervalSince1970]),@"status":@"prepared",@"target":self.target.path,@"root":sync.root,@"origin":self.library.server.origin,@"name":p[@"playlist"][@"name"],@"key":key,@"previous":Null(state[@"entries"][key]),@"incoming":incoming,@"beforeHash":YBHash(before),@"afterHash":YBHash(after),@"rows":rows,@"initialTransactions":initial} mutableCopy];
    NSMutableDictionary *previousEntries=[NSMutableDictionary dictionary],*incomingEntries=[NSMutableDictionary dictionary];for(NSDictionary *part in parts){NSDictionary *pp=part[@"manifest"];NSString *pk=[self key:pp];previousEntries[pk]=Null(state[@"entries"][pk]);incomingEntries[pk]=@{@"localHash":YBHash(Data(part[@"nodeXML"])),@"remoteHash":pp[@"playlist"][@"sha256"],@"fingerprint":pp[@"fingerprint"]};}job[@"previousEntries"]=previousEntries;job[@"incomingEntries"]=incomingEntries;
    NSMutableDictionary *previousDocuments=[NSMutableDictionary dictionary];for(NSDictionary *row in rows)previousDocuments[row[@"path"]]=Null(sync.entries[row[@"path"]]);job[@"previousDocuments"]=previousDocuments;
    [sync beginBackupBatch:@"playlist" playlistJob:identifier];job[@"batchID"]=sync.activeBackupBatch;BOOL completed=NO;
    @try {
        [self writeJSON:job path:[self jobPath:identifier]];[self writeJSON:@{@"id":identifier,@"status":@"active"} path:@"playlist-active.json"];sync.playlistOperationActive=YES;
        if(self.checkpoint)self.checkpoint(@"prepared");
        for(NSUInteger i=0;i<rows.count;i++) {NSDictionary *r=rows[i],*doc=r[@"remote"];NSString *hash=Value(r[@"localHash"]);YBRequire(!sync.presenterRunning(),@"ProPresenter가 실행됐습니다.");
            if([r[@"status"] isEqual:@"same"])[sync acknowledge:doc expectedLocalHash:hash];
            else {NSData *data=YBReadSafeFile(sync.profile,[NSString stringWithFormat:@"%@/document-%lu.pro6",folder,(unsigned long)i],NULL);[sync apply:data document:doc expectedLocalHash:hash];}
            if(progress)progress([NSString stringWithFormat:@"문서 적용 %lu/%lu · %@",(unsigned long)i+1,(unsigned long)rows.count,r[@"path"]]);if(self.checkpoint)self.checkpoint(@"document");
        }
        [self guardPlan:p];YBRequire(!sync.presenterRunning(),@"ProPresenter가 실행됐습니다.");
        if(![before isEqual:after])YBReplacePlaylist(self.target,before,after,[sync.profile stringByAppendingPathComponent:[folder stringByAppendingPathComponent:@"replacement-backups"]],sync.presenterRunning);
        else YBRequire([YBReadPlaylist(self.target) isEqual:before],@"적용 중 재생목록이 변경됐습니다.");
        if(self.checkpoint)self.checkpoint(@"playlist");job[@"status"]=@"applied";[self writeJSON:job path:[self jobPath:identifier]];
        for(NSDictionary *r in rows)YBRequire([YBHash([sync readDocument:r[@"path"]]) isEqual:r[@"remote"][@"sha256"]],@"적용 직후 문서가 변경됐습니다.");YBRequire([YBReadPlaylist(self.target) isEqual:after],@"적용 직후 재생목록이 변경됐습니다.");[self guardPlan:p];
        state=self.state;NSMutableDictionary *entries=[state[@"entries"] mutableCopy];for(NSString *pk in incomingEntries)entries[pk]=incomingEntries[pk];state[@"entries"]=entries;[self writeJSON:state path:self.statePath];
        if(self.checkpoint)self.checkpoint(@"baselines");
        NSMutableArray *transactionIDs=[NSMutableArray array];for(NSDictionary *t in sync.transactions)if(![initial containsObject:t[@"id"]])[transactionIDs addObject:t[@"id"]];job[@"transactionIDs"]=transactionIDs;
        job[@"status"]=@"committed";[self writeJSON:job path:[self jobPath:identifier]];[self writeJSON:@{@"id":identifier,@"status":@"complete"} path:@"playlist-active.json"];[self rememberFile:p[@"library"] local:after];completed=YES;
        NSMutableArray *reports=[NSMutableArray array];for(NSDictionary *part in parts){NSDictionary *pp=part[@"manifest"];[reports addObject:@{@"kind":@"playlist",@"id":pp[@"library"][@"id"],@"node":pp[@"playlist"][@"id"],@"serverHash":pp[@"playlist"][@"sha256"],@"status":@"same"}];}
        for(NSDictionary *r in rows){NSDictionary *doc=r[@"remote"];[reports addObject:@{@"kind":@"document",@"id":doc[@"id"],@"node":@"",@"serverHash":doc[@"sha256"],@"status":@"same"}];}[self.library noteComparedDocuments:[rows valueForKey:@"remote"]];[self.library reportSyncItems:reports];return identifier;
    }@catch(NSException *e){YBRequire(NO,[@"플레이리스트 동기화를 중단했습니다. ‘백업 · 중단 복구’에서 복구한 뒤 다시 비교하세요.\n" stringByAppendingString:e.reason]);return nil;}
    @finally {sync.playlistOperationActive=NO;[sync endBackupBatch:completed];}
}
- (void)restoreJob:(NSString *)identifier {
    YBSync *sync=self.library.sync;(void)sync.entries;NSString *path=[self jobPath:identifier];NSMutableDictionary *job=[[self readJSON:path] mutableCopy];YBRequire(job && [job[@"root"] isEqual:sync.root] && [job[@"target"] isEqual:self.target.path] && [job[@"origin"] isEqual:self.library.server.origin],@"다른 폴더/서버의 작업입니다. 해당 파일과 문서 폴더를 먼저 선택하세요.");YBRequire([@[@"prepared",@"applied",@"committed",@"restoring"] containsObject:job[@"status"]],@"이미 복구한 작업입니다.");
    NSDictionary *active=[self readJSON:@"playlist-active.json"];YBRequire(!active || [active[@"status"] isEqual:@"complete"] || [active[@"id"] isEqual:identifier],@"다른 중단 작업을 먼저 복구하세요.");YBRequire(!sync.presenterRunning(),@"ProPresenter를 종료한 후 복구하세요.");
    NSString *folder=[@"playlist-batches/" stringByAppendingString:identifier];NSData *before=YBReadSafeFile(sync.profile,[folder stringByAppendingString:@"/before.pro6pl"],NULL),*after=YBReadSafeFile(sync.profile,[folder stringByAppendingString:@"/after.pro6pl"],NULL),*current=YBReadPlaylist(self.target);
    YBRequire([YBHash(before) isEqual:job[@"beforeHash"]] && [YBHash(after) isEqual:job[@"afterHash"]],@"재생목록 백업이 손상됐습니다.");YBRequire([current isEqual:before] || [current isEqual:after],@"이후 재생목록을 수정했습니다. 현재 파일은 유지하며 자동 복구하지 않습니다.");
    NSMutableDictionary *state=self.state,*entries=[state[@"entries"] mutableCopy];id old=Value(job[@"previous"]),now=entries[job[@"key"]];YBRequire(Equal(now,old) || Equal(now,job[@"incoming"]),@"이후 재생목록을 동기화했습니다. 오래된 기록으로 덮어쓸 수 없습니다.");
    NSDictionary *previousEntries=job[@"previousEntries"] ?: @{job[@"key"]:Null(old)},*incomingEntries=job[@"incomingEntries"] ?: @{job[@"key"]:job[@"incoming"]};for(NSString *pk in incomingEntries){id previous=Value(previousEntries[pk]),current=entries[pk];YBRequire(Equal(current,previous)||Equal(current,incomingEntries[pk]),@"이후 재생목록을 동기화했습니다. 오래된 기록으로 덮어쓸 수 없습니다.");}
    if(!job[@"transactionIDs"]) {NSMutableArray *owned=[NSMutableArray array];for(NSDictionary *t in sync.transactions)if(job[@"batchID"] ? [t[@"batchID"] isEqual:job[@"batchID"]] : ![job[@"initialTransactions"] containsObject:t[@"id"]])[owned addObject:t[@"id"]];job[@"transactionIDs"]=owned;}
    // Validate the whole set before modifying the first member. A damaged later
    // backup or a later edit must not leave an otherwise healthy batch half restored.
    NSSet *ownedIDs=[NSSet setWithArray:job[@"transactionIDs"]];
    for(NSDictionary *t in sync.transactions)if([ownedIDs containsObject:t[@"id"]] && [@[@"prepared",@"applied",@"committed",@"restoring"] containsObject:t[@"status"]]){
        NSString *hash=YBHash([sync readDocument:t[@"path"]]);id original=Value(t[@"beforeHash"]);
        YBRequire(Equal(hash,t[@"incoming"][@"sha256"]) || (![t[@"status"] isEqual:@"committed"] && Equal(hash,original)),@"이후 수정한 문서가 있어 묶음 전체 복구를 중지했습니다.");
        NSData *backup=YBReadSafeFile(sync.profile,[NSString stringWithFormat:@"transactions/%@/before.pro6",t[@"id"]],NULL);
        YBRequire(Equal(YBHash(backup),original),@"문서 백업이 손상돼 묶음 전체 복구를 중지했습니다.");
        if([t[@"status"] isEqual:@"committed"])YBRequire(Equal(sync.entries[t[@"path"]],t[@"incoming"]),@"이후 동기화한 문서가 있어 묶음 전체 복구를 중지했습니다.");
    }
    if(job[@"previousDocuments"])for(NSDictionary *row in job[@"rows"])if([row[@"status"] isEqual:@"same"]){id previous=Value(job[@"previousDocuments"][row[@"path"]]),current=sync.entries[row[@"path"]];YBRequire((Equal(current,previous)||Equal(current,row[@"remote"])) && Equal(YBHash([sync readDocument:row[@"path"]]),Value(row[@"localHash"])),@"이후 변경한 문서가 있어 묶음 전체 복구를 중지했습니다.");}
    job[@"status"]=@"restoring";[self writeJSON:job path:path];[self writeJSON:@{@"id":identifier,@"status":@"active"} path:@"playlist-active.json"];sync.playlistOperationActive=YES;
    @try {
        // Recover in-flight per-file journals first, then restore completed members in reverse order.
        NSSet *owned=[NSSet setWithArray:job[@"transactionIDs"]];NSMutableSet *members=[NSMutableSet set];for(NSDictionary *row in job[@"rows"])[members addObject:row[@"path"]];
        for(NSDictionary *t in sync.pendingTransactions){YBRequire([owned containsObject:t[@"id"]] && [members containsObject:t[@"path"]],@"다른 문서의 중단 기록이 있습니다.");[sync recover:t[@"id"]];}
        for(NSDictionary *t in sync.transactions)if([owned containsObject:t[@"id"]] && [members containsObject:t[@"path"]] && [t[@"status"] isEqual:@"committed"]) {
            // A later transfer must never be mistaken for a member of an older batch.
            NSDictionary *row=nil;for(NSDictionary *r in job[@"rows"])if([r[@"path"] isEqual:t[@"path"]])row=r;
            YBRequire([t[@"incoming"] isEqual:row[@"remote"]],@"이후 문서를 동기화했습니다. 오래된 작업으로 되돌릴 수 없습니다.");[sync restore:t[@"id"]];
        }
        if(![current isEqual:before])YBReplacePlaylist(self.target,current,before,[sync.profile stringByAppendingPathComponent:[folder stringByAppendingPathComponent:@"replacement-backups"]],sync.presenterRunning);
        if(job[@"previousDocuments"])for(NSDictionary *row in job[@"rows"])if([row[@"status"] isEqual:@"same"])[sync restoreAcknowledgement:row[@"remote"] previous:Value(job[@"previousDocuments"][row[@"path"]]) expectedLocalHash:Value(row[@"localHash"])];
        for(NSString *pk in previousEntries){id previous=Value(previousEntries[pk]);if(previous)entries[pk]=previous;else [entries removeObjectForKey:pk];}state[@"entries"]=entries;[state removeObjectForKey:@"file"];[self writeJSON:state path:self.statePath];
        job[@"status"]=@"restored";[self writeJSON:job path:path];[self writeJSON:@{@"id":identifier,@"status":@"complete"} path:@"playlist-active.json"];
    }@finally{sync.playlistOperationActive=NO;}
    @try {
        NSMutableArray *reports=[NSMutableArray array];for(NSDictionary *row in job[@"rows"]){NSDictionary *remote=row[@"remote"];NSString *hash=YBHash([sync readDocument:row[@"path"]]);[reports addObject:@{@"kind":@"document",@"id":remote[@"id"],@"node":@"",@"serverHash":remote[@"sha256"],@"status":YBDisposition(hash,remote,sync.entries[row[@"path"]])}];}[self.library reportSyncItems:reports];
        for(NSString *pk in incomingEntries){if(pk.length>37)[self compare:[pk substringToIndex:36] node:[pk substringFromIndex:37]];}
    }@catch(NSException *error){NSLog(@"복구 후 상태 확인 실패: %@",error.reason);}
}

- (NSString *)serverXMLForNode:(NSDictionary *)node root:(NSString *)root paths:(NSMutableSet *)paths {
    NSMutableArray *items=[NSMutableArray array];NSUInteger index=0;
    for(NSDictionary *cue in node[@"items"]){NSString *kind=[cue[@"tag"] isEqual:@"RVHeaderCue"] ? @"header" : [cue[@"tag"] isEqual:@"RVDocumentCue"] ? @"document" : @"unsupported";
        NSString *identifier=[cue[@"attrs"][@"UUID"] length] ? cue[@"attrs"][@"UUID"] : [NSString stringWithFormat:@"item-%lu",(unsigned long)index];index++;
        NSMutableDictionary *item=[@{@"kind":kind,@"id":identifier} mutableCopy];
        if([kind isEqual:@"document"]){NSString *source=cue[@"attrs"][@"filePath"],*path=YBPlaylistReference(source,self.library.sync.root) ?: YBPlaylistReference(source,root);
            YBRequire(path!=nil,[NSString stringWithFormat:@"문서 연결 경로를 확인하세요: %@",source ?: @""]);item[@"path"]=path;[paths addObject:path];}
        [items addObject:item];
    }
    return YBPlaylistLocalXML(@{@"playlist":@{@"id":node[@"id"],@"xml":node[@"raw"],@"sha256":YBHash(Data(node[@"raw"]))},@"items":items},root);
}
- (NSDictionary *)prepareMacReset:(NSDictionary *)comparison progress:(void (^)(NSString *))progress {
    YBSync *sync=self.library.sync;[sync assertReady];YBRequire(!sync.presenterRunning(),@"PP6를 종료한 후 기준 재설정을 준비하세요.");
    NSData *local=YBReadPlaylist(self.target);NSArray *nodes=YBPlaylistNodes(local);NSDictionary *remote=nil;
    if(comparison){YBRequire([comparison[@"target"] isEqual:self.target.path] && [comparison[@"beforeHash"] isEqual:YBHash(local)],@"선택 후 Mac 재생목록이 바뀌었습니다. 다시 비교하세요.");[self guardPlan:comparison[@"manifest"]];remote=comparison[@"manifest"][@"library"];}
    else {NSArray *libraries=[self libraries];for(NSDictionary *candidate in libraries)if([candidate[@"path"] isEqual:self.target.lastPathComponent.precomposedStringWithCanonicalMapping])remote=candidate;YBRequire(remote || libraries.count==0,@"서버와 Mac의 재생목록 파일 이름이 다릅니다. 설정에서 연결할 원본 파일을 확인하세요.");}
    NSData *server=remote ? [self.library.server downloadPlaylist:remote] : nil;NSString *nodeID=comparison[@"manifest"][@"playlist"][@"id"],*sourceRoot=remote[@"sourceRoot"] ?: @"~/Documents/ProPresenter6";
    NSMutableSet *paths=[NSMutableSet set];NSData *desired=nodeID ? server : local;NSMutableArray *selectedIDs=[NSMutableArray array];
    for(NSDictionary *node in nodes)if(!nodeID || [node[@"id"] isEqual:nodeID]){NSString *xml=[self serverXMLForNode:node root:sourceRoot paths:paths];desired=YBPlaylistReplacing(desired,node[@"id"],xml);[selectedIDs addObject:node[@"id"]];}
    NSMutableArray *serverOnlyPlaylists=[NSMutableArray array];if(!nodeID && server)for(NSDictionary *old in YBPlaylistNodes(server))if(![selectedIDs containsObject:old[@"id"]]){desired=YBPlaylistReplacing(desired,old[@"id"],old[@"raw"]);[serverOnlyPlaylists addObject:@{@"id":old[@"id"],@"name":old[@"name"]}];}
    YBRequire(!nodeID || selectedIDs.count==1,@"Mac에 선택한 예배가 없습니다. 서버 내용 받기를 선택하세요.");YBRequire(desired.length<=5*1024*1024,@"재생목록이 서버 제한 5MB를 초과합니다.");
    NSArray *catalog=[self.library.server documentsChecking:self.library.operationCheckpoint];NSMutableDictionary *remotes=[NSMutableDictionary dictionary];for(NSDictionary *doc in catalog)remotes[doc[@"path"]]=doc;
    NSArray *allRows=nodeID ? nil : [sync plan:catalog];if(!nodeID)for(NSDictionary *row in allRows){YBRequire(!row[@"error"],row[@"error"] ?: @"문서 경로 오류");if(Value(row[@"localHash"]))[paths addObject:row[@"path"]];}
    NSString *identifier=NSUUID.UUID.UUIDString,*folder=[@"server-resets/" stringByAppendingString:identifier];
    YBWriteSafeFile(sync.profile,[folder stringByAppendingString:@"/local.pro6pl"],local,0600,nil);YBWriteSafeFile(sync.profile,[folder stringByAppendingString:@"/desired.pro6pl"],desired,0600,nil);
    if(server)YBWriteSafeFile(sync.profile,[folder stringByAppendingString:@"/server.pro6pl"],server,0600,nil);
    [self writeJSON:sync.entries path:[folder stringByAppendingString:@"/document-baselines.json"]];[self writeJSON:self.state path:[folder stringByAppendingString:@"/playlist-baselines.json"]];
    NSMutableArray *rows=[NSMutableArray array],*serverOnly=[NSMutableArray array];NSUInteger index=0,changed=0;
    for(NSString *path in [paths.allObjects sortedArrayUsingSelector:@selector(compare:)]){@autoreleasepool{
        if(self.library.operationCheckpoint)self.library.operationCheckpoint();YBRequire(!sync.presenterRunning(),@"PP6가 실행되어 준비를 중단했습니다.");if(progress)progress([NSString stringWithFormat:@"백업 준비 %lu/%lu · %@",(unsigned long)index+1,(unsigned long)paths.count,path]);
        NSData *bytes=[sync readDocument:path];YBRequire(bytes!=nil,[@"Mac에 연결 문서가 없습니다: " stringByAppendingString:path]);NSString *hash=YBHash(bytes);NSDictionary *doc=remotes[path];
        YBWriteSafeFile(sync.profile,[NSString stringWithFormat:@"%@/local-%lu.pro6",folder,(unsigned long)index],bytes,0600,nil);
        if(doc){NSData *old=[hash isEqual:doc[@"sha256"]] ? bytes : [self.library.server download:doc];YBWriteSafeFile(sync.profile,[NSString stringWithFormat:@"%@/server-%lu.pro6",folder,(unsigned long)index],old,0600,nil);}
        if(![hash isEqual:doc[@"sha256"]])changed++;
        [rows addObject:@{@"path":path,@"localHash":hash,@"remote":Null(doc),@"index":@(index++)}];
    }}
    if(!nodeID)for(NSDictionary *doc in catalog)if(![paths containsObject:doc[@"path"]]){[serverOnly addObject:doc];}
    YBRequire([YBReadPlaylist(self.target) isEqual:local],@"백업 도중 재생목록이 변경됐습니다.");
    NSMutableDictionary *job=[@{@"id":identifier,@"status":@"prepared",@"createdAt":@(NSDate.date.timeIntervalSince1970),@"root":sync.root,@"target":self.target.path,@"origin":self.library.server.origin,@"beforeHash":YBHash(local),@"desiredHash":YBHash(desired),@"library":Null(remote),@"sourceRoot":sourceRoot,@"rows":rows,@"serverOnly":serverOnly,@"serverOnlyPlaylists":serverOnlyPlaylists,@"nodes":selectedIDs,@"all":@(!nodeID),@"changed":@(changed),@"completed":[NSMutableArray array]} mutableCopy];
    [self writeJSON:job path:[folder stringByAppendingString:@"/job.json"]];return job;
}
- (NSDictionary *)applyMacReset:(NSDictionary *)prepared progress:(void (^)(NSString *))progress {
    YBSync *sync=self.library.sync;[sync assertReady];YBRequire(!sync.presenterRunning(),@"PP6를 종료한 후 서버를 맞추세요.");
    NSString *identifier=prepared[@"id"];YBRequire([identifier isKindOfClass:NSString.class] && [identifier rangeOfString:@"^[0-9A-Fa-f-]{36}$" options:NSRegularExpressionSearch].location!=NSNotFound,@"기준 재설정 작업 번호 오류");NSString *folder=[@"server-resets/" stringByAppendingString:identifier],*jobPath=[folder stringByAppendingString:@"/job.json"];
    NSMutableDictionary *job=[[self readJSON:jobPath] mutableCopy];YBRequire([job isEqual:prepared] && [job[@"status"] isEqual:@"prepared"] && [job[@"root"] isEqual:sync.root] && [job[@"target"] isEqual:self.target.path] && [job[@"origin"] isEqual:self.library.server.origin],@"준비한 작업이 현재 폴더·서버와 다릅니다. 다시 준비하세요.");
    NSData *local=YBReadSafeFile(sync.profile,[folder stringByAppendingString:@"/local.pro6pl"],NULL),*desired=YBReadSafeFile(sync.profile,[folder stringByAppendingString:@"/desired.pro6pl"],NULL);YBValidatePlaylist(desired);
    YBRequire([YBHash(local) isEqual:job[@"beforeHash"]] && [YBHash(desired) isEqual:job[@"desiredHash"]] && [YBReadPlaylist(self.target) isEqual:local],@"재생목록 또는 백업이 준비 후 변경됐습니다.");
    NSArray *rows=job[@"rows"];NSMutableSet *planned=[NSMutableSet set];for(NSDictionary *row in rows){[planned addObject:row[@"path"]];YBRequire([YBHash([sync readDocument:row[@"path"]]) isEqual:row[@"localHash"]],@"준비 후 Mac 문서가 변경됐습니다. 다시 준비하세요.");NSData *backup=YBReadSafeFile(sync.profile,[NSString stringWithFormat:@"%@/local-%@.pro6",folder,row[@"index"]],NULL);YBRequire([YBHash(backup) isEqual:row[@"localHash"]],@"로컬 문서 백업이 손상됐습니다.");NSDictionary *old=Value(row[@"remote"]);if(old)YBRequire([YBHash(YBReadSafeFile(sync.profile,[NSString stringWithFormat:@"%@/server-%@.pro6",folder,row[@"index"]],NULL)) isEqual:old[@"sha256"]],@"서버 문서 백업이 손상됐습니다.");}
    if([job[@"all"] boolValue]){NSMutableSet *now=[NSMutableSet set];for(NSDictionary *entry in [sync inventory])[now addObject:YBPath(entry[@"originalPath"])];YBRequire([now isEqual:planned],@"준비 후 Mac 파일 목록이 달라졌습니다.");}
    NSDictionary *remote=Value(job[@"library"]);if(remote){NSDictionary *head=[self.library.server request:[@"/api/playlists/" stringByAppendingString:remote[@"id"]] method:@"GET" body:nil headers:nil][@"library"];YBRequire(Equal(head[@"version"],remote[@"version"]) && Equal(head[@"sha256"],remote[@"sha256"]),@"준비 후 서버 순서가 바뀌었습니다.");YBRequire([YBHash(YBReadSafeFile(sync.profile,[folder stringByAppendingString:@"/server.pro6pl"],NULL)) isEqual:remote[@"sha256"]],@"서버 재생목록 백업이 손상됐습니다.");}
    job[@"status"]=@"applying";[self writeJSON:job path:jobPath];NSMutableArray *completed=[NSMutableArray array];
    @try {
        for(NSDictionary *row in rows){@autoreleasepool{
            if(self.library.operationCheckpoint)self.library.operationCheckpoint();YBRequire(!sync.presenterRunning(),@"PP6가 실행되어 중단했습니다.");YBRequire([YBReadPlaylist(self.target) isEqual:local],@"Mac 재생목록이 변경됐습니다.");
            NSString *path=row[@"path"];NSData *bytes=[sync readDocument:path];YBRequire([YBHash(bytes) isEqual:row[@"localHash"]],@"Mac 문서가 변경됐습니다.");NSDictionary *old=Value(row[@"remote"]),*saved=nil;
            if(old){NSDictionary *head=[self.library.server head:old];YBRequire(Equal(head[@"version"],old[@"version"]) && Equal(head[@"sha256"],old[@"sha256"]),@"서버 문서가 준비 후 바뀌었습니다. 다시 준비하세요.");}
            if(old && [old[@"sha256"] isEqual:row[@"localHash"]])saved=old;else saved=[self.library.server upload:bytes path:path previous:old];
            NSDictionary *verified=[self.library.server head:saved];YBRequire(Equal(verified[@"version"],saved[@"version"]) && [verified[@"sha256"] isEqual:row[@"localHash"]],@"서버 저장 결과가 달라 기준을 기록하지 않았습니다.");
            [sync acknowledge:verified expectedLocalHash:row[@"localHash"]];[self.library noteComparedDocuments:@[verified]];[completed addObject:verified];job[@"completed"]=completed;[self writeJSON:job path:jobPath];if(progress)progress([NSString stringWithFormat:@"서버 문서 확인 %lu/%lu · %@",(unsigned long)completed.count,(unsigned long)rows.count,path]);if(self.checkpoint)self.checkpoint(@"reset-document");
        }}
        YBRequire(!sync.presenterRunning() && [YBReadPlaylist(self.target) isEqual:local],@"Mac 재생목록이 변경됐습니다.");NSDictionary *saved=remote;
        if(![remote[@"sha256"] isEqual:YBHash(desired)]){NSString *route=remote ? [@"/api/playlists/" stringByAppendingString:remote[@"id"]] : [NSString stringWithFormat:@"/api/playlists?path=%@&root=%@",Query(self.target.lastPathComponent),Query(job[@"sourceRoot"])];NSMutableDictionary *headers=[@{@"Content-Type":@"application/xml; charset=utf-8"} mutableCopy];if(remote)headers[@"If-Match"]=[NSString stringWithFormat:@"\"%@\"",remote[@"version"]];saved=[self.library.server request:route method:remote ? @"PUT" : @"POST" body:desired headers:headers][@"library"];}
        YBRequire([saved[@"sha256"] isEqual:YBHash(desired)],@"서버 순서 저장 결과가 다릅니다.");job[@"savedLibrary"]=saved;[self writeJSON:job path:jobPath];if(self.checkpoint)self.checkpoint(@"reset-playlist");
        NSDictionary *head=[self.library.server request:[@"/api/playlists/" stringByAppendingString:saved[@"id"]] method:@"GET" body:nil headers:nil][@"library"];YBRequire(Equal(head[@"version"],saved[@"version"]) && Equal(head[@"sha256"],saved[@"sha256"]),@"저장 후 서버 순서가 다시 변경됐습니다.");
        NSMutableDictionary *finalCatalog=nil;if([job[@"all"] boolValue]){finalCatalog=[NSMutableDictionary dictionary];for(NSDictionary *doc in [self.library.server documentsChecking:self.library.operationCheckpoint])finalCatalog[doc[@"path"]]=doc;}
        for(NSDictionary *doc in completed){NSDictionary *current=finalCatalog ? finalCatalog[doc[@"path"]] : [self.library.server head:doc];YBRequire(Equal(current[@"version"],doc[@"version"]) && Equal(current[@"sha256"],doc[@"sha256"]) && [YBHash([sync readDocument:doc[@"path"]]) isEqual:doc[@"sha256"]],@"검증 중 문서가 다시 변경됐습니다. 재설정 완료로 표시하지 않습니다.");}
        YBRequire([YBReadPlaylist(self.target) isEqual:local],@"검증 중 Mac 순서가 변경됐습니다.");NSMutableDictionary *state=self.state,*entries=[state[@"entries"] mutableCopy];
        for(NSString *nodeID in job[@"nodes"]){NSString *key=[NSString stringWithFormat:@"%@/%@",saved[@"id"],nodeID];entries[key]=@{@"localHash":YBHash(Data(YBPlaylistNode(local,nodeID)[@"raw"])),@"remoteHash":YBHash(Data(YBPlaylistNode(desired,nodeID)[@"raw"]))};}state[@"entries"]=entries;
        if([job[@"all"] boolValue])state[@"file"]=@{@"libraryID":saved[@"id"],@"remoteHash":saved[@"sha256"],@"localHash":YBHash(local),@"version":saved[@"version"],@"preservedNodes":[job[@"serverOnlyPlaylists"] valueForKey:@"id"] ?: @[]};else [state removeObjectForKey:@"file"];
        [self writeJSON:state path:self.statePath];job[@"status"]=@"complete";[self writeJSON:job path:jobPath];return job;
    }@catch(NSException *error){job[@"status"]=@"incomplete";job[@"error"]=error.reason ?: @"중단";[self writeJSON:job path:jobPath];YBRequire(NO,[NSString stringWithFormat:@"%lu/%lu개 문서 확인 후 중단했습니다. 완료분과 백업은 보존됩니다. 다시 준비하면 이미 같은 문서는 재업로드하지 않습니다.\n백업: %@\n%@",(unsigned long)completed.count,(unsigned long)rows.count,[sync.profile stringByAppendingPathComponent:folder],error.reason]);return nil;}
}

@end



