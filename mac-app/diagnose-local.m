// Read-only local snapshot. Deliberately does not construct YBSync/YBLibrary/YBServer:
// their normal startup paths can create locks/state or contact the server.
#import "../mac-sync/YBSync.h"
#import "YBPlaylistFormat.h"
#import <sys/stat.h>
#import <errno.h>

static NSDictionary *Object(id value) {
    YBRequire([value isKindOfClass:NSDictionary.class],@"진단 대상 JSON 구조가 올바르지 않습니다.");
    return value;
}
static NSDictionary *Fields(NSDictionary *value,NSArray *keys) {
    NSMutableDictionary *out=[NSMutableDictionary dictionary];
    for(NSString *key in keys) {
        id item=value[key];
        if([item isKindOfClass:NSString.class] || [item isKindOfClass:NSNumber.class] || item==NSNull.null)out[key]=item;
    }
    return out;
}
static NSDictionary *Entries(id value,NSArray *keys) {
    if(!value)return @{};
    NSMutableDictionary *out=[NSMutableDictionary dictionary];
    for(NSString *key in Object(value))out[key]=Fields(Object(value[key]),keys);
    return out;
}
static BOOL Match(NSString *value,NSString *pattern) {
    return [value rangeOfString:pattern options:NSRegularExpressionSearch].location!=NSNotFound;
}
// Do not resolve/rename user paths or follow symlinks, including parent directories.
static BOOL Exists(NSString *path) {
    YBRequire(path.isAbsolutePath && [path isEqual:path.stringByStandardizingPath],@"진단 경로는 절대 경로여야 하며 . 또는 .. 를 포함할 수 없습니다.");
    NSString *current=@"/";
    for(NSString *part in path.pathComponents) {
        if([part isEqual:@"/"])continue;
        current=[current stringByAppendingPathComponent:part];struct stat st;
        if(lstat(current.fileSystemRepresentation,&st)<0) {
            YBRequire(errno==ENOENT,@"진단 경로에 접근할 수 없습니다.");return NO;
        }
        YBRequire(!S_ISLNK(st.st_mode),@"심볼릭 링크 경로는 진단하지 않습니다. 실제 경로를 확인하세요.");
        if(![current isEqual:path])YBRequire(S_ISDIR(st.st_mode),@"진단 상위 경로가 폴더가 아닙니다.");
    }
    return YES;
}
@interface YBDiagnosticReader : NSObject
@property NSMutableDictionary *files;
@property NSMutableDictionary *directories;
- (NSData *)read:(NSString *)path;
- (NSDictionary *)json:(NSString *)path;
- (NSArray *)names:(NSString *)path;
- (void)verify;
@end
@implementation YBDiagnosticReader
- (instancetype)init {if((self=[super init])){_files=[NSMutableDictionary dictionary];_directories=[NSMutableDictionary dictionary];}return self;}
- (NSData *)read:(NSString *)path {
    NSData *data=Exists(path) ? YBReadSafeFile(path.stringByDeletingLastPathComponent,path.lastPathComponent,NULL) : nil;
    id hash=YBHash(data) ?: (id)NSNull.null;
    if(self.files[path])YBRequire([self.files[path] isEqual:hash],@"진단 중 파일이 변경됐습니다. PP6와 Sync를 종료하고 다시 실행하세요.");
    self.files[path]=hash;return data;
}
- (NSDictionary *)json:(NSString *)path {
    NSData *data=[self read:path];if(!data)return nil;
    return Object([NSJSONSerialization JSONObjectWithData:data options:0 error:NULL]);
}
- (NSArray *)names:(NSString *)path {
    NSArray *names=@[];
    if(Exists(path)) {
        NSError *error=nil;names=[NSFileManager.defaultManager contentsOfDirectoryAtPath:path error:&error];
        YBRequire(names!=nil,@"진단 폴더 목록을 읽지 못했습니다.");names=[names sortedArrayUsingSelector:@selector(compare:)];
    }
    if(self.directories[path])YBRequire([self.directories[path] isEqual:names],@"진단 중 폴더 목록이 변경됐습니다. 다시 실행하세요.");
    self.directories[path]=names;return names;
}
- (void)verify {
    for(NSString *path in self.files.allKeys)[self read:path];
    for(NSString *path in self.directories.allKeys)[self names:path];
}
@end

static void RequireStopped(void) {
    YBRequire(!YBPresenterRunning(),@"ProPresenter 6를 종료한 뒤 진단해 주세요.");
    for(NSRunningApplication *app in NSWorkspace.sharedWorkspace.runningApplications)
        YBRequire(![app.bundleIdentifier isEqual:@"org.yebaeon.sync"] && ![app.executableURL.lastPathComponent isEqual:@"YebaeOnSync"],@"예배온 Sync를 종료한 뒤 진단해 주세요.");
}
static NSDictionary *Collect(YBDiagnosticReader *reader,NSString *documents,NSString *playlist,NSString *settings) {
    YBRequire(Exists(documents),@"선택한 문서 폴더가 없습니다.");
    NSData *bytes=[reader read:playlist];YBRequire(bytes!=nil,@"선택한 재생목록 파일이 없습니다.");
    NSMutableArray *nodes=[NSMutableArray array];NSMutableSet *references=[NSMutableSet set];
    for(NSDictionary *node in YBPlaylistNodes(bytes)) {
        NSMutableArray *items=[NSMutableArray array];
        for(NSDictionary *item in node[@"items"]) {
            NSDictionary *attrs=item[@"attrs"];NSMutableDictionary *summary=[Fields(attrs,@[@"UUID",@"displayName",@"filePath",@"selectedArrangementID"]) mutableCopy];
            summary[@"kind"]=item[@"tag"];
            NSString *relative=YBPlaylistReference(attrs[@"filePath"],documents);
            if(relative){summary[@"documentPath"]=relative;[references addObject:relative];}
            [items addObject:summary];
        }
        [nodes addObject:@{@"id":node[@"id"],@"name":node[@"name"],@"sha256":YBHash([node[@"raw"] dataUsingEncoding:NSUTF8StringEncoding]),@"items":items}];
    }
    NSMutableArray *docs=[NSMutableArray array];
    for(NSString *relative in [[references allObjects] sortedArrayUsingSelector:@selector(compare:)]) {
        NSData *data=[reader read:[documents stringByAppendingPathComponent:relative]];
        [docs addObject:@{@"path":relative,@"exists":@(data!=nil),@"sha256":YBHash(data) ?: (id)NSNull.null,@"size":@(data.length)}];
    }
    NSMutableArray *profiles=[NSMutableArray array];
    for(NSString *name in [reader names:settings]) {
        if(!Match(name,@"^[a-fA-F0-9]{64}$"))continue;
        NSString *dir=[settings stringByAppendingPathComponent:name];NSArray *names=[reader names:dir];
        NSDictionary *state=[reader json:[dir stringByAppendingPathComponent:@"state.json"]];
        NSMutableDictionary *profile=[@{@"directory":name,@"stateExists":@(state!=nil)} mutableCopy];
        if(state) {
            profile[@"state"]=Fields(state,@[@"schema",@"root"]);
            // Only the origin host/scheme, never user info, query, fragment, or session.
            NSURLComponents *origin=[NSURLComponents componentsWithString:state[@"origin"]];
            if(origin.host.length && origin.scheme.length)profile[@"origin"]=[NSString stringWithFormat:@"%@://%@%@",origin.scheme,origin.host,origin.port ? [@":" stringByAppendingString:origin.port.stringValue] : @""];
            profile[@"documents"]=Entries(state[@"entries"],@[@"id",@"path",@"sha256",@"version",@"size"]);
        }
        NSMutableArray *baselines=[NSMutableArray array];
        for(NSString *file in names)if(Match(file,@"^playlist-state-[a-fA-F0-9]{64}\\.json$")) {
            NSDictionary *s=[reader json:[dir stringByAppendingPathComponent:file]];
            [baselines addObject:@{@"file":file,@"target":Fields(s,@[@"target"]),@"entries":Entries(s[@"entries"],@[@"localHash",@"remoteHash"]),@"wholeFile":s[@"file"] ? Fields(Object(s[@"file"]),@[@"libraryID",@"localHash",@"remoteHash",@"version"]) : @{}}];
        }
        profile[@"playlists"]=baselines;
        profile[@"activePlaylist"]=Fields([reader json:[dir stringByAppendingPathComponent:@"playlist-active.json"]],@[@"id",@"status"]);
        NSMutableArray *jobs=[NSMutableArray array];
        for(NSArray *kind in @[@[@"transactions",@"transaction.json"],@[@"playlist-batches",@"job.json"],@[@"backup-batches",@"batch.json"]]) {
            NSString *folder=[dir stringByAppendingPathComponent:kind[0]];
            for(NSString *identifier in [reader names:folder]) {
                if(!Match(identifier,@"^[a-fA-F0-9-]{36}$"))continue;
                NSString *path=[[folder stringByAppendingPathComponent:identifier] stringByAppendingPathComponent:kind[1]];
                NSDictionary *j=[reader json:path];if(!j)continue;
                NSMutableDictionary *summary=[Fields(j,@[@"id",@"status",@"path",@"target",@"batchID",@"playlistJob",@"createdAt"]) mutableCopy];
                summary[@"kind"]=kind[0];[jobs addObject:summary];
            }
        }
        profile[@"jobs"]=jobs;[profiles addObject:profile];
    }
    return @{@"schema":@"yebaeon-local-diagnostic-v1",@"readOnly":@YES,@"serverContacted":@NO,
        @"documentsRoot":documents,@"playlistPath":playlist,@"playlistSHA256":YBHash(bytes),
        @"playlistCount":@(nodes.count),@"playlists":nodes,@"referencedDocuments":docs,@"profiles":profiles};
}

#ifndef YB_DIAGNOSTIC_TEST
int main(int argc,const char *argv[]) {@autoreleasepool {
    @try {
        YBRequire(argc==1 || argc==3,@"사용법: diagnose-local [문서 절대경로 재생목록 절대경로]");
        RequireStopped();YBDiagnosticReader *reader=[YBDiagnosticReader new];
        NSString *home=NSHomeDirectory(),*settings=[home stringByAppendingPathComponent:@"Library/Application Support/YebaeOn Sync"];
        NSDictionary *docSettings=[reader json:[settings stringByAppendingPathComponent:@"documents-settings.json"]];
        NSDictionary *serverSettings=[reader json:[settings stringByAppendingPathComponent:@"server-playlists.json"]];
        NSDictionary *oldSettings=[reader json:[settings stringByAppendingPathComponent:@"playlist-settings.json"]];
        NSString *documents=argc==3 ? @(argv[1]) : docSettings[@"root"] ?: [home stringByAppendingPathComponent:@"Documents/ProPresenter6"];
        NSString *playlist=argc==3 ? @(argv[2]) : serverSettings[@"target"] ?: oldSettings[@"localPath"] ?: [home stringByAppendingPathComponent:@"Library/Application Support/RenewedVision/ProPresenter6/Playlists/기본 .pro6pl"];
        YBRequire([documents isKindOfClass:NSString.class] && [playlist isKindOfClass:NSString.class],@"설정 경로가 올바르지 않습니다.");
        NSDictionary *report=Collect(reader,documents,playlist,settings);
        RequireStopped();[reader verify];RequireStopped();
        NSData *json=[NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingPrettyPrinted error:NULL];YBRequire(json!=nil,@"진단 결과를 만들 수 없습니다.");
        YBRequire(fwrite(json.bytes,1,json.length,stdout)==json.length && fflush(stdout)==0,@"진단 결과를 기록할 수 없습니다.");return 0;
    }@catch(NSException *e){fprintf(stderr,"진단 중단: %s\n",e.reason.UTF8String);return 1;}
}}
#endif
