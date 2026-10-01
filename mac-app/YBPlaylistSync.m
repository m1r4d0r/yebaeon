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
    for(;;){NSDictionary *page=[self.library.server request:[@"/api/playlists?after=" stringByAppendingString:Query(after)] method:@"GET" body:nil headers:nil];YBRequire([page[@"libraries"] isKindOfClass:NSArray.class],@"재생목록 목록이 올바르지 않습니다.");[all addObjectsFromArray:page[@"libraries"]];id next=page[@"next"];if(!next || next==NSNull.null)break;YBRequire([next isKindOfClass:NSString.class] && ![seen containsObject:next],@"재생목록 다음 페이지 오류");[seen addObject:next];after=next;}return all;
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
    NSMutableDictionary *remote=[NSMutableDictionary dictionary];for(NSDictionary *doc in [self.library.server documents])remote[doc[@"path"]]=doc;
    NSUInteger done=0;for(NSString *path in [paths.allObjects sortedArrayUsingSelector:@selector(compare:)]) {
        if(progress)progress([NSString stringWithFormat:@"문서 등록 %lu/%lu · %@",(unsigned long)done+1,(unsigned long)paths.count,path]);
        @try {YBRequire(!sync.presenterRunning(),@"ProPresenter가 실행됐습니다.");NSData *data=[sync readDocument:path];YBRequire(data!=nil,@"Mac 문서 폴더에서 찾지 못했습니다.");NSDictionary *existing=remote[path],*saved=nil;
            if(existing){YBRequire([existing[@"sha256"] isEqual:YBHash(data)],@"서버 문서와 다릅니다. 문서 탭에서 비교해 주세요.");saved=[self.library.server head:existing];YBRequire([saved[@"sha256"] isEqual:YBHash(data)],@"서버 문서가 변경됐습니다.");}
            else saved=[self.library.server upload:data path:path previous:nil];
            [sync acknowledge:saved expectedLocalHash:YBHash(data)];done++;
        }@catch(NSException *e){[failures addObject:[NSString stringWithFormat:@"%@: %@",path,e.reason]];if(sync.presenterRunning())break;}
    }
    YBRequire([YBReadPlaylist(self.target) isEqual:before],@"등록 도중 로컬 재생목록이 변경됐습니다. 파일은 유지했으며 다시 비교해야 합니다.");NSMutableDictionary *state=self.state,*entries=[state[@"entries"] mutableCopy];
    for(NSDictionary *node in nodes){NSString *key=[NSString stringWithFormat:@"%@/%@",library[@"id"],node[@"id"]];entries[key]=@{@"localHash":YBHash(Data(node[@"raw"])),@"remoteHash":YBHash(Data(node[@"raw"]))};}
    state[@"entries"]=entries;[self writeJSON:state path:self.statePath];return @{@"library":library,@"count":@(done),@"issues":failures};
}
- (NSDictionary *)compare:(NSString *)libraryID node:(NSString *)nodeID {return [self compare:libraryID node:nodeID hashCache:[NSMutableDictionary dictionary]];}
- (NSDictionary *)compare:(NSString *)libraryID node:(NSString *)nodeID hashCache:(NSMutableDictionary *)hashCache {
    YBSync *sync=self.library.sync;(void)sync.entries;NSDictionary *p=[self manifest:libraryID node:nodeID];NSData *before=YBReadPlaylist(self.target);
    NSMutableArray *rows=[NSMutableArray array],*issues=[NSMutableArray array];NSMutableSet *paths=[NSMutableSet set];
    for(NSDictionary *item in p[@"items"])if(Value(item[@"issue"]))[issues addObject:[NSString stringWithFormat:@"%@ · %@",item[@"name"],item[@"issue"]]];
    for(NSDictionary *doc in p[@"documents"]){NSString *path=doc[@"path"];YBRequire(![paths containsObject:path],@"중복 문서 계획");[paths addObject:path];id cached=hashCache[path];if(!cached){cached=Null(YBHash([sync readDocument:path]));hashCache[path]=cached;}NSString *hash=Value(cached),*status=YBDisposition(hash,doc,sync.entries[path]);[rows addObject:@{@"path":path,@"status":status,@"localHash":Null(hash),@"remote":doc}];if(![@[@"download",@"same"] containsObject:status])[issues addObject:[NSString stringWithFormat:@"%@ · Mac 수정/충돌: 문서 탭에서 비교해 주세요.",path]];}
    NSDictionary *node=YBPlaylistNode(before,nodeID),*base=self.state[@"entries"][[self key:p]];NSString *localHash=YBHash(Data(node[@"raw"])),*xml=nil;BOOL orderChanged=NO;
    if([p[@"ready"] boolValue]){xml=YBPlaylistLocalXML(p,sync.root);NSString *desiredHash=YBHash(Data(xml));orderChanged=!Equal(localHash,desiredHash);
        BOOL safe=Equal(localHash,desiredHash) || (base && Equal(localHash,base[@"localHash"])) || (!base && (!node || Equal(localHash,p[@"playlist"][@"sha256"])));
        if(!safe)[issues addObject:@"Mac 재생목록도 수정됐거나 최초 기준이 없습니다. 원본 파일을 등록한 Mac에서 비교해 주세요."];
    }
    NSDictionary *active=[self readJSON:@"playlist-active.json"];if(active && ![active[@"status"] isEqual:@"complete"])[issues addObject:@"중단된 플레이리스트 작업을 먼저 복구해 주세요."];
    return @{@"localNode":node ?: @{},@"manifest":p,@"rows":rows,@"issues":issues,@"ready":@(issues.count==0 && [p[@"ready"] boolValue]),@"beforeHash":YBHash(before),@"nodeXML":xml ?: @"",@"orderChanged":@(orderChanged),@"target":self.target.path};
}
- (NSString *)jobPath:(NSString *)identifier {YBRequire([identifier isKindOfClass:NSString.class] && [identifier rangeOfString:@"^[0-9A-Fa-f-]{36}$" options:NSRegularExpressionSearch].location!=NSNotFound,@"작업 번호 오류");return [NSString stringWithFormat:@"playlist-batches/%@/job.json",identifier];}
- (NSArray *)jobs {
    (void)self.library.sync.entries;NSString *dir=[self.library.sync.profile stringByAppendingPathComponent:@"playlist-batches"];NSArray *names=[NSFileManager.defaultManager contentsOfDirectoryAtPath:dir error:NULL] ?: @[];NSMutableArray *result=[NSMutableArray array];for(NSString *name in names){NSDictionary *j=[self readJSON:[self jobPath:name]];if(j)[result addObject:j];}return [result sortedArrayUsingComparator:^NSComparisonResult(NSDictionary *a,NSDictionary *b){return [b[@"createdAt"] compare:a[@"createdAt"]];}];
}
- (void)guardPlan:(NSDictionary *)p {NSDictionary *latest=[self manifest:p[@"library"][@"id"] node:p[@"playlist"][@"id"]];YBRequire([latest[@"fingerprint"] isEqual:p[@"fingerprint"]],@"비교 후 서버의 순서 또는 문서가 변경됐습니다. 중단 기록을 복구한 뒤 다시 비교해 주세요.");}
- (NSString *)receive:(NSDictionary *)comparison progress:(void (^)(NSString *))progress {
    YBSync *sync=self.library.sync;[sync assertReady];YBRequire(!sync.presenterRunning(),@"ProPresenter를 종료한 후 동기화해 주세요.");YBRequire([comparison[@"target"] isEqual:self.target.path] && [comparison[@"ready"] boolValue],@"누락/충돌을 먼저 해결해 주세요.");NSDictionary *p=comparison[@"manifest"];[self guardPlan:p];NSData *before=YBReadPlaylist(self.target);YBRequire([YBHash(before) isEqual:comparison[@"beforeHash"]],@"비교 후 Mac 재생목록이 변경됐습니다.");
    NSDictionary *fresh=[self compare:p[@"library"][@"id"] node:p[@"playlist"][@"id"]];YBRequire([fresh[@"ready"] boolValue] && [fresh[@"rows"] isEqual:comparison[@"rows"]] && [fresh[@"nodeXML"] isEqual:comparison[@"nodeXML"]],@"비교 후 Mac 문서 또는 기준이 변경됐습니다.");
    NSData *after=YBPlaylistReplacing(before,p[@"playlist"][@"id"],comparison[@"nodeXML"]);NSString *identifier=NSUUID.UUID.UUIDString,*folder=[@"playlist-batches/" stringByAppendingString:identifier];NSArray *rows=comparison[@"rows"];
    for(NSUInteger i=0;i<rows.count;i++){NSDictionary *r=rows[i];if([r[@"status"] isEqual:@"download"]){if(progress)progress([@"원본 준비 · " stringByAppendingString:r[@"path"]]);NSData *data=[self.library.server download:r[@"remote"]];YBWriteSafeFile(sync.profile,[NSString stringWithFormat:@"%@/document-%lu.pro6",folder,(unsigned long)i],data,0600,nil);}}
    [self guardPlan:p];YBRequire([YBReadPlaylist(self.target) isEqual:before],@"준비 중 Mac 재생목록이 변경됐습니다.");
    YBWriteSafeFile(sync.profile,[folder stringByAppendingString:@"/before.pro6pl"],before,0600,nil);YBWriteSafeFile(sync.profile,[folder stringByAppendingString:@"/after.pro6pl"],after,0600,nil);
    NSMutableArray *initial=[NSMutableArray array];for(NSDictionary *t in sync.transactions)[initial addObject:t[@"id"]];NSMutableDictionary *state=self.state;NSString *key=[self key:p];
    NSDictionary *incoming=@{@"localHash":YBHash(Data(comparison[@"nodeXML"])),@"remoteHash":p[@"playlist"][@"sha256"],@"fingerprint":p[@"fingerprint"]};
    NSMutableDictionary *job=[@{@"id":identifier,@"createdAt":@([NSDate.date timeIntervalSince1970]),@"status":@"prepared",@"target":self.target.path,@"root":sync.root,@"origin":self.library.server.origin,@"name":p[@"playlist"][@"name"],@"key":key,@"previous":Null(state[@"entries"][key]),@"incoming":incoming,@"beforeHash":YBHash(before),@"afterHash":YBHash(after),@"rows":rows,@"initialTransactions":initial} mutableCopy];
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
        state=self.state;NSMutableDictionary *entries=[state[@"entries"] mutableCopy];entries[key]=incoming;state[@"entries"]=entries;[self writeJSON:state path:self.statePath];
        NSMutableArray *transactionIDs=[NSMutableArray array];for(NSDictionary *t in sync.transactions)if(![initial containsObject:t[@"id"]])[transactionIDs addObject:t[@"id"]];job[@"transactionIDs"]=transactionIDs;
        job[@"status"]=@"committed";[self writeJSON:job path:[self jobPath:identifier]];[self writeJSON:@{@"id":identifier,@"status":@"complete"} path:@"playlist-active.json"];completed=YES;return identifier;
    }@catch(NSException *e){YBRequire(NO,[@"플레이리스트 동기화를 중단했습니다. ‘백업 · 중단 복구’에서 복구한 뒤 다시 비교하세요.\n" stringByAppendingString:e.reason]);return nil;}
    @finally {sync.playlistOperationActive=NO;[sync endBackupBatch:completed];}
}
- (void)restoreJob:(NSString *)identifier {
    YBSync *sync=self.library.sync;(void)sync.entries;NSString *path=[self jobPath:identifier];NSMutableDictionary *job=[[self readJSON:path] mutableCopy];YBRequire(job && [job[@"root"] isEqual:sync.root] && [job[@"target"] isEqual:self.target.path] && [job[@"origin"] isEqual:self.library.server.origin],@"다른 폴더/서버의 작업입니다. 해당 파일과 문서 폴더를 먼저 선택하세요.");YBRequire([@[@"prepared",@"applied",@"committed",@"restoring"] containsObject:job[@"status"]],@"이미 복구한 작업입니다.");
    NSDictionary *active=[self readJSON:@"playlist-active.json"];YBRequire(!active || [active[@"status"] isEqual:@"complete"] || [active[@"id"] isEqual:identifier],@"다른 중단 작업을 먼저 복구하세요.");YBRequire(!sync.presenterRunning(),@"ProPresenter를 종료한 후 복구하세요.");
    NSString *folder=[@"playlist-batches/" stringByAppendingString:identifier];NSData *before=YBReadSafeFile(sync.profile,[folder stringByAppendingString:@"/before.pro6pl"],NULL),*after=YBReadSafeFile(sync.profile,[folder stringByAppendingString:@"/after.pro6pl"],NULL),*current=YBReadPlaylist(self.target);
    YBRequire([YBHash(before) isEqual:job[@"beforeHash"]] && [YBHash(after) isEqual:job[@"afterHash"]],@"재생목록 백업이 손상됐습니다.");YBRequire([current isEqual:before] || [current isEqual:after],@"이후 재생목록을 수정했습니다. 현재 파일은 유지하며 자동 복구하지 않습니다.");
    NSMutableDictionary *state=self.state,*entries=[state[@"entries"] mutableCopy];id old=Value(job[@"previous"]),now=entries[job[@"key"]];YBRequire(Equal(now,old) || Equal(now,job[@"incoming"]),@"이후 재생목록을 동기화했습니다. 오래된 기록으로 덮어쓸 수 없습니다.");
    if(!job[@"transactionIDs"]) {NSMutableArray *owned=[NSMutableArray array];for(NSDictionary *t in sync.transactions)if(![job[@"initialTransactions"] containsObject:t[@"id"]])[owned addObject:t[@"id"]];job[@"transactionIDs"]=owned;}
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
        if(old)entries[job[@"key"]]=old;else [entries removeObjectForKey:job[@"key"]];state[@"entries"]=entries;[self writeJSON:state path:self.statePath];
        job[@"status"]=@"restored";[self writeJSON:job path:path];[self writeJSON:@{@"id":identifier,@"status":@"complete"} path:@"playlist-active.json"];
    }@finally{sync.playlistOperationActive=NO;}
}
@end

