#import "YBSync.h"
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
    if(![response isKindOfClass:NSHTTPURLResponse.class] || response.expectedContentLength>25*1024*1024) { self.rejected=YES; completion(NSURLSessionResponseCancel); }
    else { self.response=(NSHTTPURLResponse *)response; completion(NSURLSessionResponseAllow); }
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveData:(NSData *)data {
    if(self.data.length+data.length>25*1024*1024) { self.rejected=YES; [task cancel]; } else [self.data appendData:data];
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completion { completion(nil); }
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error { self.error=error; dispatch_semaphore_signal(self.done); }
@end
@interface YBServer ()
@property(nonatomic,readwrite) NSString *origin;
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
    request.HTTPMethod=method; request.HTTPBody=body; request.timeoutInterval=MIN(45,timeout); request.HTTPShouldHandleCookies=NO;
    [request setValue:@"YebaeOn-Sync/0.3 (macOS)" forHTTPHeaderField:@"User-Agent"];
    [request setValue:@"application/json" forHTTPHeaderField:@"Accept"];
    if(self.cookie)[request setValue:self.cookie forHTTPHeaderField:@"Cookie"];
    if(![method isEqual:@"GET"]) [request setValue:self.origin forHTTPHeaderField:@"Origin"];
    for(NSString *key in headers)[request setValue:headers[key] forHTTPHeaderField:key];
    NSURLSessionConfiguration *configuration=NSURLSessionConfiguration.ephemeralSessionConfiguration;
    configuration.HTTPShouldSetCookies=NO; configuration.HTTPCookieStorage=nil; configuration.URLCache=nil; configuration.timeoutIntervalForResource=timeout;
    YBTransfer *transfer=[YBTransfer new]; NSOperationQueue *queue=[NSOperationQueue new]; queue.maxConcurrentOperationCount=1;
    NSURLSession *session=[NSURLSession sessionWithConfiguration:configuration delegate:transfer delegateQueue:queue];
    NSURLSessionDataTask *task=[session dataTaskWithRequest:request]; [task resume];
    BOOL timedOut=dispatch_semaphore_wait(transfer.done,dispatch_time(DISPATCH_TIME_NOW,(int64_t)((timeout+5)*NSEC_PER_SEC)))!=0;
    if(timedOut)[task cancel]; [session invalidateAndCancel];
    YBRequire(!timedOut,@"서버 응답 시간이 초과됐습니다. 다시 비교한 후 시도해 주세요.");
    YBRequire(!transfer.rejected,@"서버 응답이 너무 크거나 올바르지 않습니다.");
    YBRequire(!transfer.error,@"서버에 연결하지 못했습니다. 인터넷과 서버 주소를 확인해 주세요.");
    NSInteger status=transfer.response.statusCode;
    if(status<200 || status>=300) {
        id json=[NSJSONSerialization JSONObjectWithData:transfer.data options:0 error:NULL];
        NSString *message=[json isKindOfClass:NSDictionary.class] && [json[@"message"] isKindOfClass:NSString.class] ? json[@"message"] : @"서버 요청을 완료하지 못했습니다.";
        if(status==401)message=@"로그인이 필요하거나 비밀번호가 다릅니다. 다시 입장해 주세요.";
        if(status==409)message=@"서버에서 문서가 먼저 변경됐습니다. 로컬 문서는 유지했습니다. 다시 비교해 주세요.";
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


