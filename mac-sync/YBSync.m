#import "YBSync.h"
#import <CommonCrypto/CommonDigest.h>
#import <Security/Security.h>
#import <sys/stat.h>
#import <sys/file.h>
#import <fcntl.h>
#import <unistd.h>
#import <dirent.h>
#import <errno.h>

static const NSUInteger YBMax = 25 * 1024 * 1024;
void YBRequire(BOOL ok, NSString *message) {
    if (!ok) @throw [NSException exceptionWithName:@"YebaeOn" reason:message userInfo:nil];
}
static NSString *YBSystem(NSString *operation) {
    return [NSString stringWithFormat:@"%@: %s", operation, strerror(errno)];
}
NSString *YBHash(NSData *data) {
    if (!data) return nil;
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
    NSMutableString *s = [NSMutableString string];
    for (NSUInteger i=0; i<sizeof(digest); i++) [s appendFormat:@"%02x", digest[i]];
    return s;
}
static BOOL YBMatch(NSString *s, NSString *pattern) {
    return [s isKindOfClass:NSString.class] && [s rangeOfString:pattern options:NSRegularExpressionSearch].location != NSNotFound;
}
NSString *YBPath(NSString *path) {
    YBRequire([path isKindOfClass:NSString.class], @"문서 경로가 없습니다.");
    NSString *p = path.precomposedStringWithCanonicalMapping;
    NSArray *parts = [p componentsSeparatedByString:@"/"];
    YBRequire(p.length <= 600 && parts.count <= 20 && [p.lowercaseString hasSuffix:@".pro6"], @"올바른 .pro6 경로가 아닙니다.");
    for (NSString *part in parts) YBRequire(part.length && part.length<=160 && ![part isEqual:@"."] && ![part isEqual:@".."] && !YBMatch(part,@"[\\\\:\\x00-\\x1f\\x7f]|[. ]$"), @"안전하지 않은 문서 경로입니다.");
    return p;
}
@interface YBXML : NSObject <NSXMLParserDelegate>
@property BOOL seenRoot;
@property BOOL correctRoot;
@end
@implementation YBXML
- (void)parser:(NSXMLParser *)parser didStartElement:(NSString *)name namespaceURI:(NSString *)uri qualifiedName:(NSString *)qualified attributes:(NSDictionary *)attrs {
    if (!self.seenRoot) { self.seenRoot=YES; self.correctRoot=[name isEqual:@"RVPresentationDocument"]; }
}
@end
void YBValidateDocument(NSData *data) {
    YBRequire(data.length && data.length<=YBMax, @"문서는 25 MiB 이하여야 합니다.");
    NSString *xml = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    YBRequire(xml && !YBMatch(xml,@"(?i)<!DOCTYPE|<!ENTITY"), @"UTF-8 PP6 문서가 아니거나 외부 엔터티가 있습니다.");
    YBRequire(!YBMatch(xml,@"(?i)file:///PP6-Package/"), @"새 미디어가 포함된 ZIP용 문서는 아직 동기화할 수 없습니다.");
    YBXML *delegate=[YBXML new]; NSXMLParser *parser=[[NSXMLParser alloc] initWithData:data];
    parser.shouldResolveExternalEntities=NO; parser.delegate=delegate;
    YBRequire([parser parse] && delegate.correctRoot, @"PP6 XML 문서가 올바르지 않습니다.");
}
void YBValidateMetadata(NSDictionary *doc) {
    YBRequire([doc isKindOfClass:NSDictionary.class], @"서버 문서 정보가 올바르지 않습니다.");
    YBRequire([YBPath(doc[@"path"]) isEqual:doc[@"path"]] && YBMatch(doc[@"id"],@"^[0-9a-f-]{36}$") && YBMatch(doc[@"sha256"],@"^[0-9a-f]{64}$"), @"문서 경로 또는 식별자가 올바르지 않습니다.");
    NSNumber *v=doc[@"version"], *s=doc[@"size"];
    YBRequire([v isKindOfClass:NSNumber.class] && v.doubleValue>=1 && v.doubleValue<=9007199254740991.0 && v.doubleValue==v.longLongValue && [s isKindOfClass:NSNumber.class] && s.doubleValue>=1 && s.doubleValue<=YBMax && s.doubleValue==s.longLongValue, @"문서 버전 또는 크기가 올바르지 않습니다.");
}
NSString *YBDisposition(NSString *local, NSDictionary *remote, NSDictionary *base) {
    if (!remote) return base ? @"conflict" : @"upload";
    if (base && ![base[@"id"] isEqual:remote[@"id"]]) return @"conflict";
    if (!local) return @"download";
    if ([local isEqual:remote[@"sha256"]]) return @"same";
    if (!base) return @"conflict";
    BOOL l=[local isEqual:base[@"sha256"]], r=[remote[@"sha256"] isEqual:base[@"sha256"]];
    return l ? @"download" : r ? @"upload" : @"conflict";
}
BOOL YBPresenterRunning(void) {
    for (NSRunningApplication *app in NSWorkspace.sharedWorkspace.runningApplications) {
        if ([app.localizedName.lowercaseString hasPrefix:@"propresenter"] || [app.bundleIdentifier.lowercaseString containsString:@"propresenter"]) return YES;
    }
    return NO;
}

// All document access is relative to directory descriptors; descendants cannot be symlinks.
static void YBSimplePath(NSString *path) {
    YBRequire(path.length && ![path hasPrefix:@"/"] && ![path containsString:@"\\"] && [path rangeOfString:@"\0"].location==NSNotFound, @"잘못된 파일 경로입니다.");
    for (NSString *s in [path componentsSeparatedByString:@"/"]) YBRequire(s.length && ![s isEqual:@"."] && ![s isEqual:@".."], @"잘못된 파일 경로입니다.");
}
static NSString *YBActual(int parent, NSString *part) {
    int copy=openat(parent,".",O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
    YBRequire(copy>=0,YBSystem(@"폴더 읽기"));
    DIR *dir=fdopendir(copy); if (!dir) { close(copy); YBRequire(NO,YBSystem(@"폴더 읽기")); }
    NSString *actual=nil, *nfc=part.precomposedStringWithCanonicalMapping;
    @try {
        struct dirent *ent;
        while ((ent=readdir(dir))) {
            NSString *s=[[NSString alloc] initWithUTF8String:ent->d_name];
            YBRequire(s!=nil,@"UTF-8이 아닌 파일 이름이 있습니다.");
            NSString *n=s.precomposedStringWithCanonicalMapping;
            if ([n caseInsensitiveCompare:nfc]==NSOrderedSame) {
                YBRequire([n isEqual:nfc] && !actual, @"대소문자 또는 유니코드가 겹치는 경로입니다.");
                actual=s;
            }
        }
    } @finally { closedir(dir); }
    return actual ?: part;
}
static int YBParent(NSString *root, NSString *path, BOOL create, NSString **leaf) {
    YBSimplePath(path);
    int fd=open(root.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
    YBRequire(fd>=0,YBSystem(@"작업 폴더 열기"));
    @try {
        NSArray *parts=[path componentsSeparatedByString:@"/"];
        for (NSUInteger i=0;i+1<parts.count;i++) {
            NSString *part=YBActual(fd,parts[i]);
            if (create) {
                int made=mkdirat(fd,part.fileSystemRepresentation,0700);
                YBRequire(made==0 || errno==EEXIST,YBSystem(@"폴더 만들기"));
                if(made==0 && fsync(fd)<0)YBRequire(errno==EINVAL || errno==ENOTSUP,YBSystem(@"새 폴더 저장 확인"));
            }
            int next=openat(fd,part.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
            if (next<0 && errno==ENOENT && !create) { close(fd); return -1; }
            YBRequire(next>=0,YBSystem(@"하위 폴더 열기 (심볼릭 링크는 지원하지 않음)")); close(fd); fd=next;
        }
        *leaf=YBActual(fd,parts.lastObject); return fd;
    } @catch (NSException *e) { close(fd); @throw; }
}
static NSData *YBRead(NSString *root, NSString *path, mode_t *mode) {
    NSString *leaf; int parent=YBParent(root,path,NO,&leaf); if (parent<0) return nil;
    int fd=openat(parent,leaf.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW|O_NONBLOCK); int saved=errno; close(parent); errno=saved;
    if (fd<0 && errno==ENOENT) return nil;
    YBRequire(fd>=0,YBSystem(@"파일 읽기 (심볼릭 링크는 지원하지 않음)"));
    @try {
        struct stat st; YBRequire(fstat(fd,&st)==0 && S_ISREG(st.st_mode) && st.st_size<=YBMax,@"일반 파일이 아니거나 너무 큽니다.");
        if (mode) *mode=st.st_mode & 0777;
        NSMutableData *data=[NSMutableData data]; unsigned char buffer[65536]; ssize_t n;
        while ((n=read(fd,buffer,sizeof(buffer)))!=0) {
            if (n<0 && errno==EINTR) continue;
            YBRequire(n>0,YBSystem(@"파일 읽기")); YBRequire(data.length+(NSUInteger)n<=YBMax,@"파일이 너무 큽니다."); [data appendBytes:buffer length:(NSUInteger)n];
        }
        return data;
    } @finally { close(fd); }
}
static void YBScan(int fd, NSString *relative, void (^document)(NSString *)) {
    int copy=openat(fd,".",O_RDONLY|O_DIRECTORY|O_NOFOLLOW); YBRequire(copy>=0,YBSystem(@"폴더 목록 열기"));
    DIR *dir=fdopendir(copy); if(!dir) { close(copy); YBRequire(NO,YBSystem(@"폴더 목록 열기")); }
    @try {
        struct dirent *ent;
        for(;;) {
            errno=0; ent=readdir(dir); if(!ent) { YBRequire(errno==0,YBSystem(@"폴더 목록 읽기")); break; }
            NSString *name=[[NSString alloc] initWithUTF8String:ent->d_name]; YBRequire(name!=nil,@"UTF-8이 아닌 파일 이름입니다.");
            if([name isEqual:@"."] || [name isEqual:@".."])continue;
            struct stat st; YBRequire(fstatat(fd,ent->d_name,&st,AT_SYMLINK_NOFOLLOW)==0,YBSystem(@"문서 검색"));
            YBRequire(!S_ISLNK(st.st_mode),@"문서 폴더에 심볼릭 링크가 있습니다. 실제 파일 폴더를 사용해 주세요.");
            NSString *path=relative.length ? [relative stringByAppendingFormat:@"/%@",name] : name;
            if(S_ISDIR(st.st_mode)) {
                int child=openat(fd,ent->d_name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW); YBRequire(child>=0,YBSystem(@"하위 폴더 검색"));
                @try { YBScan(child,path,document); } @finally { close(child); }
            } else if([name.pathExtension.lowercaseString isEqual:@"pro6"])document(path);
        }
    } @finally { closedir(dir); }
}
static void YBFlush(int fd) {
    YBRequire(fsync(fd)==0,YBSystem(@"파일 저장 확인"));
    // F_FULLFSYNC also asks the drive to flush its write cache; unsupported volumes use fsync.
    if (fcntl(fd,F_FULLFSYNC)<0) YBRequire(errno==EINVAL || errno==ENOTSUP || errno==ENOTTY,YBSystem(@"디스크 저장 확인"));
}
static void YBDirFlush(int fd) { if (fsync(fd)<0) YBRequire(errno==EINVAL || errno==ENOTSUP,YBSystem(@"폴더 저장 확인")); }
static void YBWrite(NSString *root, NSString *path, NSData *data, mode_t mode, void (^guard)(void)) {
    NSString *leaf; int parent=YBParent(root,path,YES,&leaf);
    NSString *temp=[@".yebaeon-" stringByAppendingString:NSUUID.UUID.UUIDString];
    int fd=openat(parent,temp.fileSystemRepresentation,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);
    @try {
        YBRequire(fd>=0,YBSystem(@"임시 파일 만들기"));
        const unsigned char *p=data.bytes; NSUInteger remaining=data.length;
        while (remaining) { ssize_t n=write(fd,p,remaining); if (n<0 && errno==EINTR) continue; YBRequire(n>0,YBSystem(@"파일 저장")); p+=n; remaining-=n; }
        YBRequire(fchmod(fd,mode)==0,YBSystem(@"파일 권한 유지")); YBFlush(fd); close(fd); fd=-1;
        if (guard) guard();
        YBRequire(renameat(parent,temp.fileSystemRepresentation,parent,leaf.fileSystemRepresentation)==0,YBSystem(@"문서 교체")); YBDirFlush(parent);
    } @finally { if(fd>=0)close(fd); unlinkat(parent,temp.fileSystemRepresentation,0); close(parent); }
}
static void YBRemove(NSString *root, NSString *path, void (^guard)(void)) {
    NSString *leaf; int parent=YBParent(root,path,NO,&leaf); if(parent<0)return;
    @try { if(guard)guard(); YBRequire(unlinkat(parent,leaf.fileSystemRepresentation,0)==0 || errno==ENOENT,YBSystem(@"신규 문서 되돌리기")); YBDirFlush(parent); } @finally { close(parent); }
}
static NSData *YBJSONData(id value) { NSError *e=nil; NSData *d=[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingPrettyPrinted error:&e]; YBRequire(d!=nil,@"상태 기록을 만들 수 없습니다."); return d; }
static NSDictionary *YBJSON(NSData *data) { id obj=data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL] : nil; YBRequire([obj isKindOfClass:NSDictionary.class],@"상태 또는 서버 응답이 올바른 JSON이 아닙니다."); return obj; }
static BOOL YBEqual(id a,id b) { return a==b || [a isEqual:b]; }
static id YBNull(id x) { return x ?: NSNull.null; }
static id YBUnnull(id x) { return x==NSNull.null ? nil : x; }
static NSString *YBNow(void) { return [NSISO8601DateFormatter.new stringFromDate:NSDate.date]; }

@interface YBSync () {
    int _lock;
    NSMutableDictionary *_state;
}
@property(nonatomic, readwrite) NSString *root;
@property(nonatomic, readwrite) NSString *profile;
@end
@implementation YBSync
- (instancetype)initWithRoot:(NSString *)root profile:(NSString *)profile origin:(NSString *)origin {
    if((self=[super init])) {
        _lock=-1;
        NSFileManager *fm=NSFileManager.defaultManager; NSError *error=nil;
        YBRequire([fm createDirectoryAtPath:root withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:&error],@"문서 폴더를 만들 수 없습니다.");
        self.root=root.stringByStandardizingPath.stringByResolvingSymlinksInPath;
        YBRequire([fm createDirectoryAtPath:profile withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:&error],@"Sync 상태 폴더를 만들 수 없습니다.");
        self.profile=profile.stringByStandardizingPath.stringByResolvingSymlinksInPath;
        YBRequire(![self.profile isEqual:self.root] && ![self.profile hasPrefix:[self.root stringByAppendingString:@"/"]],@"백업 폴더는 문서 폴더 밖에 있어야 합니다.");
        NSString *leaf; int parent=YBParent(self.root,@".yebaeon-sync.lock",NO,&leaf);
        _lock=openat(parent,leaf.fileSystemRepresentation,O_RDWR|O_CREAT|O_NOFOLLOW|O_NONBLOCK,0600); close(parent);
        struct stat st;
        YBRequire(_lock>=0 && fstat(_lock,&st)==0 && S_ISREG(st.st_mode) && flock(_lock,LOCK_EX|LOCK_NB)==0,@"이 문서 폴더에서 다른 Sync가 실행 중이거나 잠금 파일을 열 수 없습니다.");
        NSData *data=YBRead(self.profile,@"state.json",NULL);
        if(data) {
            NSDictionary *s=YBJSON(data);
            YBRequire([s[@"schema"] isEqual:@1] && [s[@"root"] isEqual:self.root] && [s[@"origin"] isEqual:origin] && [s[@"entries"] isKindOfClass:NSDictionary.class],@"Sync 상태의 폴더/서버가 다르거나 기록이 손상됐습니다.");
            _state=[s mutableCopy]; _state[@"entries"]=[s[@"entries"] mutableCopy];
            for(NSString *path in _state[@"entries"]) { NSDictionary *doc=_state[@"entries"][path]; YBValidateMetadata(doc); YBRequire([path isEqual:doc[@"path"]],@"기준 경로가 다릅니다."); }
        } else _state=[@{@"schema":@1,@"root":self.root,@"origin":origin,@"entries":[NSMutableDictionary dictionary]} mutableCopy];
        self.presenterRunning=^BOOL { return YBPresenterRunning(); };
    }
    return self;
}
- (void)close { if(_lock>=0) { close(_lock); _lock=-1; } }
- (void)dealloc { if(_lock>=0)close(_lock); }
- (void)open { YBRequire(_lock>=0,@"이미 종료한 Sync입니다."); }
- (NSDictionary *)entries { [self open]; return [_state[@"entries"] copy]; }
- (void)saveState { YBWrite(self.profile,@"state.json",YBJSONData(_state),0600,nil); }
- (void)closed { [self open]; YBRequire(!self.presenterRunning(),@"ProPresenter를 종료한 뒤 다시 실행해 주세요."); }
- (void)assertReady { YBRequire(self.pendingTransactions.count==0,@"중단된 적용이 있습니다. 먼저 ‘중단 작업 복구’를 실행해 주세요."); }
- (NSData *)readDocument:(NSString *)path { [self open]; YBPath(path); NSData *data=YBRead(self.root,path,NULL); if(data)YBValidateDocument(data); return data; }
- (NSArray *)plan:(NSArray *)remoteDocuments {
    NSMutableDictionary *remote=[NSMutableDictionary dictionary], *local=[NSMutableDictionary dictionary], *aliases=[NSMutableDictionary dictionary];
    void (^registerPath)(NSString *)=^(NSString *path) {
        NSString *prefix=@"";
        for(NSString *part in [path componentsSeparatedByString:@"/"]) {
            prefix=prefix.length ? [prefix stringByAppendingFormat:@"/%@",part] : part;
            NSString *key=prefix.lowercaseString; YBRequire(!aliases[key] || [aliases[key] isEqual:prefix],@"대소문자가 겹치는 서버/로컬 경로가 있습니다."); aliases[key]=prefix;
        }
    };
    for(NSDictionary *doc in remoteDocuments) { YBValidateMetadata(doc); NSString *p=doc[@"path"]; YBRequire(!remote[p],@"서버에 겹치는 경로가 있습니다."); registerPath(p); remote[p]=doc; }
    int directory=open(self.root.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
    YBRequire(directory>=0,YBSystem(@"문서 폴더 검색"));
    @try {
        YBScan(directory,@"",^(NSString *relative) {
            NSString *p=YBPath(relative);
            YBRequire(!local[p],@"같은 이름으로 정규화되는 로컬 문서가 있습니다.");
            registerPath(p); NSData *bytes=[self readDocument:p];
            YBRequire(bytes!=nil,@"목록을 읽는 동안 문서가 이동됐습니다. 다시 비교해 주세요."); local[p]=YBHash(bytes);
        });
    } @finally { close(directory); }
    NSMutableSet *paths=[NSMutableSet setWithArray:remote.allKeys]; [paths addObjectsFromArray:local.allKeys]; [paths addObjectsFromArray:self.entries.allKeys];
    NSMutableArray *rows=[NSMutableArray array];
    for(NSString *p in [paths.allObjects sortedArrayUsingSelector:@selector(compare:)]) {
        NSString *status=YBDisposition(local[p],remote[p],self.entries[p]);
        [rows addObject:@{@"path":p,@"status":status,@"localHash":YBNull(local[p]),@"remote":YBNull(remote[p])}];
    }
    return rows;
}
- (void)acknowledge:(NSDictionary *)doc expectedLocalHash:(NSString *)hash {
    [self assertReady]; YBValidateMetadata(doc);
    YBRequire([hash isEqual:doc[@"sha256"]] && [YBHash([self readDocument:doc[@"path"]]) isEqual:hash],@"송수신 중 로컬 문서가 바뀌었습니다. 다시 비교해 주세요.");
    id old=_state[@"entries"][doc[@"path"]]; _state[@"entries"][doc[@"path"]]=doc;
    @try { [self saveState]; } @catch(NSException *e) { if(old)_state[@"entries"][doc[@"path"]]=old; else [_state[@"entries"] removeObjectForKey:doc[@"path"]]; @throw; }
}
- (NSString *)journalPath:(NSString *)identifier { YBRequire(YBMatch(identifier,@"^[0-9A-Fa-f-]{36}$"),@"복원 번호가 올바르지 않습니다."); return [NSString stringWithFormat:@"transactions/%@/transaction.json",identifier]; }
- (void)saveJournal:(NSDictionary *)j { YBWrite(self.profile,[self journalPath:j[@"id"]],YBJSONData(j),0600,nil); }
- (NSArray *)transactions {
    [self open];
    NSString *directory=[self.profile stringByAppendingPathComponent:@"transactions"];
    BOOL isDir; if(![NSFileManager.defaultManager fileExistsAtPath:directory isDirectory:&isDir]) return @[];
    YBRequire(isDir,@"백업 목록이 손상됐습니다."); NSError *error=nil;
    NSArray *names=[NSFileManager.defaultManager contentsOfDirectoryAtPath:directory error:&error]; YBRequire(names!=nil,@"백업 목록을 읽지 못했습니다.");
    NSMutableArray *result=[NSMutableArray array];
    for(NSString *name in names) {
        if([name hasPrefix:@"."])continue;
        NSData *data=YBRead(self.profile,[self journalPath:name],NULL); if(!data)continue; // Interrupted before preparation; no document was touched.
        NSDictionary *j=YBJSON(data);
        YBRequire([j[@"schema"] isEqual:@1] && [j[@"id"] isEqual:name] && [j[@"root"] isEqual:self.root] && [j[@"origin"] isEqual:_state[@"origin"]],@"백업 기록의 서버/폴더가 다릅니다.");
        YBValidateMetadata(j[@"incoming"]); YBRequire([YBPath(j[@"path"]) isEqual:j[@"incoming"][@"path"]],@"백업 문서 경로가 다릅니다.");
        if(YBUnnull(j[@"previous"])) { YBValidateMetadata(j[@"previous"]); YBRequire([j[@"previous"][@"path"] isEqual:j[@"path"]],@"이전 기준의 문서 경로가 다릅니다."); }
        YBRequire([j[@"mode"] isKindOfClass:NSNumber.class] && [j[@"mode"] unsignedIntegerValue]<=0777 && [j[@"createdAt"] isKindOfClass:NSString.class],@"백업 권한 또는 날짜 기록이 올바르지 않습니다.");
        YBRequire([@[@"prepared",@"applied",@"committed",@"restoring",@"restored",@"rolled_back"] containsObject:j[@"status"]],@"백업 단계가 올바르지 않습니다.");
        YBRequire([j[@"beforeHash"] isEqual:NSNull.null] || YBMatch(j[@"beforeHash"],@"^[0-9a-f]{64}$"),@"백업 해시가 손상됐습니다.");
        [result addObject:j];
    }
    return [result sortedArrayUsingDescriptors:@[[NSSortDescriptor sortDescriptorWithKey:@"createdAt" ascending:NO]]];
}
- (NSArray *)pendingTransactions {
    NSMutableArray *pending=[NSMutableArray array];
    for(NSDictionary *j in self.transactions) if([@[@"prepared",@"applied",@"restoring"] containsObject:j[@"status"]])[pending addObject:j];
    return pending;
}
- (NSDictionary *)transaction:(NSString *)identifier {
    [self journalPath:identifier]; for(NSDictionary *j in self.transactions)if([j[@"id"] isEqual:identifier])return j;
    YBRequire(NO,@"복원 기록을 찾지 못했습니다."); return nil;
}
- (NSString *)apply:(NSData *)data document:(NSDictionary *)doc expectedLocalHash:(NSString *)hash {
    [self assertReady]; [self closed]; YBValidateMetadata(doc); YBValidateDocument(data);
    YBRequire(data.length==[doc[@"size"] unsignedIntegerValue] && [YBHash(data) isEqual:doc[@"sha256"]],@"받은 문서의 SHA-256 또는 크기가 다릅니다.");
    NSString *path=doc[@"path"]; mode_t mode=0600; NSData *before=YBRead(self.root,path,&mode);
    YBRequire(YBEqual(YBHash(before),hash),@"받기 전에 로컬 문서가 바뀌었습니다. 다시 비교해 주세요.");
    YBRequire([YBDisposition(hash,doc,self.entries[path]) isEqual:@"download"],@"자동으로 받을 수 없는 문서입니다. 충돌 상태를 확인해 주세요.");
    NSString *identifier=NSUUID.UUID.UUIDString, *dir=[@"transactions/" stringByAppendingString:identifier];
    if(before)YBWrite(self.profile,[dir stringByAppendingString:@"/before.pro6"],before,0600,nil);
    YBWrite(self.profile,[dir stringByAppendingString:@"/after.pro6"],data,0600,nil);
    NSMutableDictionary *j=[@{@"schema":@1,@"id":identifier,@"root":self.root,@"origin":_state[@"origin"],@"path":path,@"incoming":doc,@"previous":YBNull(self.entries[path]),@"beforeHash":YBNull(hash),@"mode":@(mode),@"createdAt":YBNow(),@"status":@"prepared"} mutableCopy];
    [self saveJournal:j];
    // Any interruption after this durable journal is recoverable on the next launch.
    // Do not hide an ambiguous failure by continuing with another document.
    if(self.checkpoint)self.checkpoint(@"prepared");
    YBWrite(self.root,path,data,mode,^{ [self closed]; YBRequire(YBEqual(YBHash(YBRead(self.root,path,NULL)),hash),@"적용 직전에 로컬 파일이 바뀌었습니다."); });
    if(self.checkpoint)self.checkpoint(@"replaced");
    j[@"status"]=@"applied"; [self saveJournal:j];
    _state[@"entries"][path]=doc; [self saveState];
    if(self.checkpoint)self.checkpoint(@"state_saved");
    j[@"status"]=@"committed"; [self saveJournal:j]; return identifier;
}
- (void)undo:(NSString *)identifier restore:(BOOL)restore {
    NSMutableDictionary *j=[[self transaction:identifier] mutableCopy]; NSString *status=j[@"status"], *path=j[@"path"];
    if(restore) {
        [self assertReady]; YBRequire([status isEqual:@"committed"],@"완료한 적용만 복원할 수 있습니다.");
        YBRequire(YBEqual(self.entries[path],j[@"incoming"]),@"이후 동기화한 문서입니다. 오래된 백업으로 덮어쓸 수 없습니다.");
    } else YBRequire([@[@"prepared",@"applied",@"restoring"] containsObject:status],@"복구할 중단 작업이 아닙니다.");
    NSString *beforeHash=YBUnnull(j[@"beforeHash"]), *incomingHash=j[@"incoming"][@"sha256"];
    NSData *before=YBRead(self.profile,[[[self journalPath:identifier] stringByDeletingLastPathComponent] stringByAppendingPathComponent:@"before.pro6"],NULL);
    YBRequire(YBEqual(YBHash(before),beforeHash),@"원본 백업이 손상됐습니다. 문서를 변경하지 않았습니다.");
    NSString *current=YBHash(YBRead(self.root,path,NULL));
    YBRequire([current isEqual:incomingHash] || (!restore && YBEqual(current,beforeHash)),@"적용 후 문서가 다시 바뀌었습니다. 자동 복원하지 않습니다. 백업과 현재 파일을 따로 확인해 주세요.");
    [self closed]; if(restore) { j[@"status"]=@"restoring"; [self saveJournal:j]; }
    if(!YBEqual(current,beforeHash)) {
        void (^guard)(void)=^{ [self closed]; YBRequire(YBEqual(YBHash(YBRead(self.root,path,NULL)),current),@"복원 직전에 파일이 바뀌었습니다."); };
        if(before)YBWrite(self.root,path,before,[j[@"mode"] unsignedShortValue]&0777,guard); else YBRemove(self.root,path,guard);
    }
    if(self.checkpoint)self.checkpoint(@"restored_file");
    id previous=YBUnnull(j[@"previous"]); if(previous)_state[@"entries"][path]=previous; else [_state[@"entries"] removeObjectForKey:path];
    [self saveState]; j[@"status"]=(restore || [status isEqual:@"restoring"]) ? @"restored" : @"rolled_back"; [self saveJournal:j];
}
- (void)recover:(NSString *)identifier { [self undo:identifier restore:NO]; }
- (void)restore:(NSString *)identifier { [self undo:identifier restore:YES]; }
@end
