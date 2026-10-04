// Sync 2 기반: 문서 경로·바이트 검증, 문서 폴더 안전 읽기·쓰기, PP6 실행 확인, 서버 연결(YBServer).
#import "YBCore.h"
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
    for (NSString *part in parts) YBRequire(part.length && part.length<=160 && ![part isEqual:@"."] && ![part isEqual:@".."] && !YBMatch(part,@"[\\\\\\x00-\\x1f\\x7f]|[. ]$"), @"안전하지 않은 문서 경로입니다.");
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
NSData *YBReadSafeFile(NSString *root, NSString *path, mode_t *mode) { return YBRead(root,path,mode); }
void YBWriteSafeFile(NSString *root, NSString *path, NSData *data, mode_t mode, void (^guard)(void)) { YBWrite(root,path,data,mode,guard); }

#import <Security/Security.h>

static NSData *JSONData(id value) {
    NSData *data=[NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
    YBRequire(data!=nil,@"서버 요청을 만들 수 없습니다."); return data;
}
static NSString *Query(NSString *value) {
    return [value stringByAddingPercentEncodingWithAllowedCharacters:[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~"]];
}
@interface YBTransfer : NSObject <NSURLSessionDataDelegate, NSURLSessionTaskDelegate>
@property(nonatomic,strong) NSMutableData *data;
@property(nonatomic,strong) NSHTTPURLResponse *response;
@property(nonatomic,strong) NSError *error;
@property(nonatomic,strong) dispatch_semaphore_t done;
@property(nonatomic) BOOL rejected;
@end
@implementation YBTransfer
- (instancetype)init { if((self=[super init])) { self.data=[NSMutableData data]; self.done=dispatch_semaphore_create(0); } return self; }
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition))completion {
    if(![response isKindOfClass:NSHTTPURLResponse.class] || response.expectedContentLength>40*1024*1024) { self.rejected=YES; completion(NSURLSessionResponseCancel); }
    else { self.response=(NSHTTPURLResponse *)response; completion(NSURLSessionResponseAllow); }
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveData:(NSData *)data {
    if(self.data.length+data.length>40*1024*1024) { self.rejected=YES; [task cancel]; } else [self.data appendData:data];
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completion { completion(nil); }
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error { self.error=error; dispatch_semaphore_signal(self.done); }
@end
// 요청마다 새 연결을 맺지 않도록 서버마다 세션 하나를 쓰고(연결 유지), 응답은 작업 번호로 각 YBTransfer에 나눠 준다.
@interface YBSessionRouter : NSObject <NSURLSessionDataDelegate, NSURLSessionTaskDelegate>
@property(nonatomic,strong) NSMutableDictionary *transfers;
@end
@implementation YBSessionRouter
- (instancetype)init { if((self=[super init])) self.transfers=[NSMutableDictionary dictionary]; return self; }
- (void)add:(YBTransfer *)transfer task:(NSURLSessionTask *)task { @synchronized(self) { self.transfers[@(task.taskIdentifier)]=transfer; } }
- (YBTransfer *)transferFor:(NSURLSessionTask *)task { @synchronized(self) { return self.transfers[@(task.taskIdentifier)]; } }
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition))completion {
    YBTransfer *transfer=[self transferFor:task]; if(!transfer) { completion(NSURLSessionResponseCancel); return; }
    [transfer URLSession:session dataTask:task didReceiveResponse:response completionHandler:completion];
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveData:(NSData *)data { [[self transferFor:task] URLSession:session dataTask:task didReceiveData:data]; }
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completion { completion(nil); }
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
    YBTransfer *transfer=[self transferFor:task];
    @synchronized(self) { [self.transfers removeObjectForKey:@(task.taskIdentifier)]; }
    [transfer URLSession:session task:task didCompleteWithError:error];
}
@end

@interface YBServer ()
@property(nonatomic,readwrite) NSString *origin;
@property(nonatomic,strong) NSURLSession *session;
@property(nonatomic,strong) YBSessionRouter *router;
@end
@implementation YBServer
- (instancetype)initWithOrigin:(NSString *)origin allowLocalTestServer:(BOOL)allow {
    if((self=[super init])) {
        NSURLComponents *parts=[NSURLComponents componentsWithString:origin];
        BOOL loopback=allow && [parts.scheme isEqual:@"http"] && [@[@"127.0.0.1",@"localhost",@"[::1]"] containsObject:parts.host];
        YBRequire(parts.host.length && ([parts.scheme isEqual:@"https"] || loopback) && !parts.user && !parts.password && !parts.query && !parts.fragment && (!parts.path.length || [parts.path isEqual:@"/"]),@"서버는 경로나 계정 정보가 없는 HTTPS 주소여야 합니다.");
        parts.path=@""; self.origin=parts.string;
    }
    return self;
}
- (YBTransfer *)transfer:(NSString *)route method:(NSString *)method body:(NSData *)body headers:(NSDictionary *)headers {
    return [self transfer:route method:method body:body headers:headers timeout:60];
}
- (YBTransfer *)transfer:(NSString *)route method:(NSString *)method body:(NSData *)body headers:(NSDictionary *)headers timeout:(NSTimeInterval)timeout {
#ifdef YB_TESTING
    YBRequire(NO,@"격리 GUI 검사에서는 네트워크 전송을 허용하지 않습니다.");
#endif
    YBRequire([route hasPrefix:@"/api/"] && ![route containsString:@"\r"] && ![route containsString:@"\n"],@"서버 요청 경로가 올바르지 않습니다.");
    NSMutableURLRequest *request=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:[self.origin stringByAppendingString:route]]];
    request.HTTPMethod=method; request.HTTPBody=body; request.timeoutInterval=timeout>60 ? timeout : MIN(45,timeout); request.HTTPShouldHandleCookies=NO;
    [request setValue:@"YebaeOn-Sync/0.3 (macOS)" forHTTPHeaderField:@"User-Agent"];
    [request setValue:@"application/json" forHTTPHeaderField:@"Accept"];
    if(self.cookie)[request setValue:self.cookie forHTTPHeaderField:@"Cookie"];
    if(![method isEqual:@"GET"]) [request setValue:self.origin forHTTPHeaderField:@"Origin"];
    for(NSString *key in headers)[request setValue:headers[key] forHTTPHeaderField:key];
    NSURLSession *session=nil;
    @synchronized(self) {
        if(!self.session) {
            NSURLSessionConfiguration *configuration=NSURLSessionConfiguration.ephemeralSessionConfiguration;
            configuration.HTTPShouldSetCookies=NO; configuration.HTTPCookieStorage=nil; configuration.URLCache=nil;
            configuration.timeoutIntervalForResource=600; configuration.HTTPMaximumConnectionsPerHost=4;
            NSOperationQueue *queue=[NSOperationQueue new]; queue.maxConcurrentOperationCount=4;
            self.router=[YBSessionRouter new];
            self.session=[NSURLSession sessionWithConfiguration:configuration delegate:self.router delegateQueue:queue];
        }
        session=self.session;
    }
    YBTransfer *transfer=[YBTransfer new];
    NSURLSessionDataTask *task=[session dataTaskWithRequest:request]; [self.router add:transfer task:task]; [task resume];
    BOOL timedOut=dispatch_semaphore_wait(transfer.done,dispatch_time(DISPATCH_TIME_NOW,(int64_t)((timeout+5)*NSEC_PER_SEC)))!=0;
    if(timedOut)[task cancel];
    YBRequire(!timedOut,@"서버 응답 시간이 초과됐습니다. 다시 비교한 후 시도해 주세요.");
    YBRequire(!transfer.rejected,@"서버 응답이 너무 크거나 올바르지 않습니다.");
    YBRequire(!transfer.error,@"서버에 연결하지 못했습니다. 인터넷과 서버 주소를 확인해 주세요.");
    NSInteger status=transfer.response.statusCode;
    if(status<200 || status>=300) {
        id json=[NSJSONSerialization JSONObjectWithData:transfer.data options:0 error:NULL];
        NSString *message=[json isKindOfClass:NSDictionary.class] && [json[@"message"] isKindOfClass:NSString.class] ? json[@"message"] : @"서버 요청을 완료하지 못했습니다.";
        if(status==401)message=@"로그인이 필요하거나 비밀번호가 다릅니다. 다시 입장해 주세요.";
        if(status==409 && !([json isKindOfClass:NSDictionary.class] && [json[@"message"] isKindOfClass:NSString.class]))message=@"서버 내용이 변경됐습니다. 로컬 파일은 유지했습니다. 다시 비교해 주세요.";
        YBRequire(NO,[NSString stringWithFormat:@"HTTP %ld: %@",(long)status,message]);
    }
    return transfer;
}
- (NSDictionary *)request:(NSString *)route method:(NSString *)method body:(NSData *)body headers:(NSDictionary *)headers {
    return [self request:route method:method body:body headers:headers timeout:60];
}
- (NSDictionary *)request:(NSString *)route method:(NSString *)method body:(NSData *)body headers:(NSDictionary *)headers timeout:(NSTimeInterval)timeout {
    YBTransfer *result=[self transfer:route method:method body:body headers:headers timeout:timeout];
    id value=[NSJSONSerialization JSONObjectWithData:result.data options:0 error:NULL];
    YBRequire([value isKindOfClass:NSDictionary.class],@"서버에서 올바른 정보를 받지 못했습니다."); return value;
}
- (NSDictionary *)login:(NSString *)name password:(NSString *)password {
    YBTransfer *result=[self transfer:@"/api/session" method:@"POST" body:JSONData(@{@"name":name,@"password":password,@"remember":@YES}) headers:@{@"Content-Type":@"application/json"}];
    NSString *setCookie=nil;
    for(NSString *key in result.response.allHeaderFields)if([key caseInsensitiveCompare:@"Set-Cookie"]==NSOrderedSame)setCookie=result.response.allHeaderFields[key];
    NSString *cookie=[setCookie componentsSeparatedByString:@";"].firstObject;
    YBRequire(cookie && [cookie rangeOfString:@"^__Host-yebaeon=[0-9a-f]{64}\\.[0-9a-f]{64}$" options:NSRegularExpressionSearch].location!=NSNotFound,@"서버 입장 정보를 받지 못했습니다.");
    self.cookie=cookie;
    id value=[NSJSONSerialization JSONObjectWithData:result.data options:0 error:NULL]; YBRequire([value isKindOfClass:NSDictionary.class],@"입장 응답이 올바르지 않습니다."); return value;
}
- (NSArray *)documents {return [self documentsChecking:nil];}
- (NSArray *)documentsChecking:(void (^)(void))check {
    NSMutableArray *all=[NSMutableArray array]; NSMutableSet *seen=[NSMutableSet set]; NSString *after=nil;
    for(;;) {
        if(check)check();NSString *route=after ? [@"/api/documents?after=" stringByAppendingString:Query(after)] : @"/api/documents";
        NSDictionary *page=[self request:route method:@"GET" body:nil headers:nil timeout:10];
        YBRequire([page[@"documents"] isKindOfClass:NSArray.class],@"문서 목록이 올바르지 않습니다.");
        for(NSDictionary *doc in page[@"documents"]) { YBValidateMetadata(doc); YBRequire(![seen containsObject:doc[@"path"]],@"서버 목록에 중복 문서가 있습니다."); [seen addObject:doc[@"path"]]; [all addObject:doc]; }
        id next=page[@"next"]; if(!next || next==NSNull.null)break;
        YBRequire([next isKindOfClass:NSString.class] && [seen containsObject:next] && ![next isEqual:after] && (!after || [next compare:after options:NSLiteralSearch]==NSOrderedDescending),@"서버 목록의 다음 페이지가 올바르지 않습니다."); after=next;
    }
    return all;
}
- (NSDictionary *)head:(NSDictionary *)document {
    YBValidateMetadata(document);
    NSDictionary *doc=[self request:[@"/api/documents/" stringByAppendingString:document[@"id"]] method:@"GET" body:nil headers:nil][@"document"];
    YBValidateMetadata(doc); YBRequire([doc[@"id"] isEqual:document[@"id"]] && [doc[@"path"] isEqual:document[@"path"]],@"서버 문서의 식별자가 달라졌습니다."); return doc;
}
- (NSData *)download:(NSDictionary *)doc {
    YBValidateMetadata(doc);
    NSString *route=[NSString stringWithFormat:@"/api/documents/%@/content?version=%@",doc[@"id"],doc[@"version"]];
    NSData *data=[self transfer:route method:@"GET" body:nil headers:nil].data;
    YBValidateDocument(data); YBRequire(data.length==[doc[@"size"] unsignedIntegerValue] && [YBHash(data) isEqual:doc[@"sha256"]],@"서버에서 받은 원본의 SHA-256이 다릅니다."); return data;
}
- (NSDictionary *)upload:(NSData *)data path:(NSString *)path previous:(NSDictionary *)previous {
    path=YBPath(path); YBValidateDocument(data);
    NSMutableDictionary *headers=[@{@"Content-Type":@"application/xml; charset=utf-8"} mutableCopy];
    if(previous) { YBValidateMetadata(previous); YBRequire([previous[@"path"] isEqual:path],@"다른 문서로 저장할 수 없습니다."); headers[@"If-Match"]=[NSString stringWithFormat:@"\"%@\"",previous[@"version"]]; }
    NSString *route=previous ? [@"/api/documents/" stringByAppendingString:previous[@"id"]] : [@"/api/documents?path=" stringByAppendingString:Query(path)];
    NSDictionary *doc=[self request:route method:previous ? @"PUT" : @"POST" body:data headers:headers][@"document"];
    YBValidateMetadata(doc); YBRequire([doc[@"path"] isEqual:path] && [doc[@"sha256"] isEqual:YBHash(data)] && [doc[@"size"] unsignedIntegerValue]==data.length && (!previous || [previous[@"id"] isEqual:doc[@"id"]]),@"서버 저장 결과와 보낸 문서가 다릅니다. 다시 비교해 주세요."); return doc;
}
- (NSArray *)mediaAssets:(NSArray *)hashes {
    YBRequire(hashes.count<=100, @"이미지 서버 조회는 100개씩 진행해야 합니다.");
    if(!hashes.count)return @[];NSMutableArray *parts=[NSMutableArray array];
    for(NSString *hash in hashes){YBRequire([hash isKindOfClass:NSString.class] && [hash rangeOfString:@"^[a-f0-9]{64}$" options:NSRegularExpressionSearch].location!=NSNotFound,@"이미지 hash가 올바르지 않습니다.");[parts addObject:[@"hash=" stringByAppendingString:Query(hash)]];}
    NSDictionary *response=[self request:[@"/api/media?" stringByAppendingString:[parts componentsJoinedByString:@"&"]] method:@"GET" body:nil headers:nil timeout:20];
    YBRequire([response[@"assets"] isKindOfClass:NSArray.class],@"서버 이미지 목록이 올바르지 않습니다.");return response[@"assets"];
}
- (BOOL)mediaContentExists:(NSString *)hash size:(unsigned long long)size {
    YBTransfer *result=nil;@try{result=[self transfer:[@"/api/media/" stringByAppendingFormat:@"%@/content",hash] method:@"HEAD" body:nil headers:nil timeout:15];}@catch(NSException *error){if([error.reason hasPrefix:@"HTTP 404:"])return NO;@throw;}
    id actual=nil;for(NSString *key in result.response.allHeaderFields)if([key caseInsensitiveCompare:@"X-Yebaeon-SHA256"]==NSOrderedSame)actual=result.response.allHeaderFields[key];
    id length=nil;for(NSString *key in result.response.allHeaderFields)if([key caseInsensitiveCompare:@"Content-Length"]==NSOrderedSame)length=result.response.allHeaderFields[key];
    return [actual isEqual:hash] && [length unsignedLongLongValue]==size;
}
- (NSDictionary *)uploadMedia:(NSData *)data sha256:(NSString *)hash {
    YBRequire(data.length>0 && data.length<=32*1024*1024 && [YBHash(data) isEqual:hash],@"전송할 이미지의 크기 또는 SHA-256이 달라졌습니다.");
    NSString *route=[@"/api/media/" stringByAppendingFormat:@"%@/content",hash];
    YBTransfer *result=[self transfer:route method:@"PUT" body:data headers:@{@"Content-Type":@"application/octet-stream",@"X-Yebaeon-SHA256":hash} timeout:180];
    id value=[NSJSONSerialization JSONObjectWithData:result.data options:0 error:NULL];NSDictionary *asset=[value isKindOfClass:NSDictionary.class]?value[@"asset"]:nil;
    YBRequire([asset isKindOfClass:NSDictionary.class] && [asset[@"sha256"] isEqual:hash] && [asset[@"size"] unsignedIntegerValue]==data.length,@"서버 이미지 저장 결과가 일치하지 않습니다.");return asset;
}
- (NSDictionary *)registerMediaReferences:(NSArray *)references document:(NSDictionary *)document {
    YBValidateMetadata(document);NSData *body=JSONData(@{@"documentId":document[@"id"],@"version":document[@"version"],@"references":references});
    return [self request:@"/api/media/references" method:@"PUT" body:body headers:@{@"Content-Type":@"application/json"} timeout:30];
}
- (NSArray *)mediaReferencesForDocument:(NSDictionary *)document {
    YBValidateMetadata(document);NSString *route=[NSString stringWithFormat:@"/api/media/references?documentId=%@&version=%@",Query(document[@"id"]),document[@"version"]];
    NSDictionary *result=[self request:route method:@"GET" body:nil headers:nil timeout:20];YBRequire([result[@"documentId"] isEqual:document[@"id"]] && [result[@"version"] isEqual:document[@"version"]] && [result[@"references"] isKindOfClass:NSArray.class],@"서버 이미지 참조 목록이 올바르지 않습니다.");return result[@"references"];
}
- (NSData *)downloadMedia:(NSString *)hash size:(unsigned long long)size {
    YBRequire([hash rangeOfString:@"^[a-f0-9]{64}$" options:NSRegularExpressionSearch].location!=NSNotFound && size>0 && size<=32ULL*1024*1024,@"서버 이미지 정보가 올바르지 않습니다.");
    YBTransfer *result=[self transfer:[@"/api/media/" stringByAppendingFormat:@"%@/content",hash] method:@"GET" body:nil headers:nil timeout:120];id actual=nil;for(NSString *key in result.response.allHeaderFields)if([key caseInsensitiveCompare:@"X-Yebaeon-SHA256"]==NSOrderedSame)actual=result.response.allHeaderFields[key];
    YBRequire(result.data.length==size && [YBHash(result.data) isEqual:hash] && [actual isEqual:hash],@"받은 이미지 크기 또는 SHA-256이 다릅니다. 로컬에 설치하지 않았습니다.");return result.data;
}
- (NSMutableDictionary *)keychainQuery {
#ifdef YB_TESTING
    YBRequire(NO,@"격리 GUI 검사에서는 운영 키체인에 접근하지 않습니다.");
#endif
    return [@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"org.yebaeon.sync.session",(__bridge id)kSecAttrAccount:self.origin} mutableCopy];
}
- (void)loadSession {
    NSMutableDictionary *query=[self keychainQuery]; query[(__bridge id)kSecReturnData]=@YES;
    CFTypeRef result=NULL; OSStatus status=SecItemCopyMatching((__bridge CFDictionaryRef)query,&result);
    YBRequire(status==errSecSuccess || status==errSecItemNotFound,@"키체인에서 입장 정보를 읽지 못했습니다.");
    if(status==errSecSuccess)self.cookie=[[NSString alloc] initWithData:CFBridgingRelease(result) encoding:NSUTF8StringEncoding];
}
- (void)saveSession {
    YBRequire(self.cookie!=nil,@"저장할 입장 정보가 없습니다.");
    NSMutableDictionary *query=[self keychainQuery]; NSDictionary *value=@{(__bridge id)kSecValueData:[self.cookie dataUsingEncoding:NSUTF8StringEncoding]};
    OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)query,(__bridge CFDictionaryRef)value);
    if(status==errSecItemNotFound) { [query addEntriesFromDictionary:value]; status=SecItemAdd((__bridge CFDictionaryRef)query,NULL); }
    YBRequire(status==errSecSuccess,@"키체인에 입장 정보를 저장하지 못했습니다. 이번 실행에서는 사용할 수 있습니다.");
}
- (void)forgetSession { OSStatus status=SecItemDelete((__bridge CFDictionaryRef)[self keychainQuery]); YBRequire(status==errSecSuccess || status==errSecItemNotFound,@"키체인 입장 정보를 지우지 못했습니다."); self.cookie=nil; }
- (NSData *)downloadPlaylist:(NSDictionary *)library {
    NSString *identifier=library[@"id"],*hash=library[@"sha256"];NSNumber *version=library[@"version"];
    YBRequire([identifier isKindOfClass:NSString.class] && [identifier rangeOfString:@"^[0-9a-f-]{36}$" options:NSRegularExpressionSearch].location!=NSNotFound && [hash isKindOfClass:NSString.class] && version.integerValue>0,@"재생목록 메타데이터 오류");
    NSData *data=[self transfer:[NSString stringWithFormat:@"/api/playlists/%@/content?version=%@",identifier,version] method:@"GET" body:nil headers:nil].data;
    YBRequire([YBHash(data) isEqual:hash],@"서버 재생목록 백업 해시가 다릅니다.");return data;
}

@end
