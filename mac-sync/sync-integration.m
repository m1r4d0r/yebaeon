#import "YBSync.h"
static int checks=0;
static void Check(BOOL ok,NSString *message) { checks++; YBRequire(ok,message); }
static NSData *XML(NSString *text) { return [[NSString stringWithFormat:@"<?xml version=\"1.0\" encoding=\"UTF-8\"?><RVPresentationDocument versionNumber=\"600\"><text>%@</text></RVPresentationDocument>",text] dataUsingEncoding:NSUTF8StringEncoding]; }
int main(int argc,const char *argv[]) { @autoreleasepool {
    NSString *area=[NSTemporaryDirectory() stringByAppendingPathComponent:[@"yebaeon-integration-" stringByAppendingString:NSUUID.UUID.UUIDString]];
    @try {
        Check(argc==2,@"local Worker URL required"); NSString *origin=[NSString stringWithUTF8String:argv[1]];
        YBServer *mac=[[YBServer alloc] initWithOrigin:origin allowLocalTestServer:YES], *web=[[YBServer alloc] initWithOrigin:origin allowLocalTestServer:YES];
        [mac login:@"Mac 시험" password:@"native-integration-only"]; [web login:@"웹 시험" password:@"native-integration-only"];
        YBSync *s=[[YBSync alloc] initWithRoot:[area stringByAppendingPathComponent:@"documents"] profile:[area stringByAppendingPathComponent:@"profile"] origin:mac.origin]; s.presenterRunning=^BOOL{return NO;};
        NSString *path=@"예배/말씀 : \"은혜\" & %3A.pro6", *actual=[s.root stringByAppendingPathComponent:path.decomposedStringWithCanonicalMapping];
        NSData *a=XML(@"원본\r\nfile:///Users/church/Media/a.jpg"), *b=XML(@"웹 수정"), *c=XML(@"Mac 수정"), *d=XML(@"다른 웹 수정");
        Check([NSFileManager.defaultManager createDirectoryAtPath:actual.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:NULL],@"local folder");
        Check([a writeToFile:actual atomically:YES],@"local original");
        NSDictionary *v1=[mac upload:a path:path previous:nil]; [s acknowledge:v1 expectedLocalHash:YBHash(a)];
        Check([v1[@"version"] isEqual:@1] && [v1[@"updatedBy"] isEqual:@"Mac 시험"],@"Mac upload author/version");
        Check([[s plan:[mac documents]][0][@"status"] isEqual:@"same"],@"initial sync");
        NSDictionary *v2=[web upload:b path:path previous:v1];
        Check([[s plan:[mac documents]][0][@"status"] isEqual:@"download"],@"server change detected");
        [s apply:[mac download:v2] document:v2 expectedLocalHash:YBHash(a)]; Check([[NSData dataWithContentsOfFile:actual] isEqual:b],@"server -> Mac exact bytes, NFD path");
        Check([c writeToFile:actual atomically:YES],@"Mac edit"); Check([[s plan:[mac documents]][0][@"status"] isEqual:@"upload"],@"Mac change detected");
        NSDictionary *v3=[mac upload:[s readDocument:path] path:path previous:v2]; [s acknowledge:v3 expectedLocalHash:YBHash(c)]; Check([v3[@"version"] isEqual:@3],@"Mac -> server version 3");
        NSDictionary *v4=[web upload:d path:path previous:v3];
        BOOL rejected=NO; @try { [mac upload:a path:path previous:v3]; } @catch(NSException *e) { rejected=[e.reason hasPrefix:@"HTTP 409:"]; }
        Check(rejected,@"stale upload returns 409"); Check([s.entries[path][@"version"] isEqual:@3] && [[s readDocument:path] isEqual:c],@"conflict preserves file and baseline");
        Check([[mac download:v1] isEqual:a] && [[mac download:v4] isEqual:d],@"exact historical versions");
        NSDictionary *history=[mac request:[NSString stringWithFormat:@"/api/documents/%@/versions",v1[@"id"]] method:@"GET" body:nil headers:nil]; Check([history[@"versions"] count]==4,@"four immutable versions");
        Check([a writeToFile:actual atomically:YES],@"local divergent edit"); Check([[s plan:[mac documents]][0][@"status"] isEqual:@"conflict"],@"real two-sided conflict");
        // Node fixture seeds 101 additional documents to exercise the real API cursor.
        Check([mac documents].count==102,@"all document pages loaded");
        [mac request:@"/api/session" method:@"DELETE" body:nil headers:nil];
        Check(![[mac request:@"/api/session" method:@"GET" body:nil headers:nil][@"authenticated"] boolValue],@"logout invalidates session");
        printf("Native Worker integration checks passed: %d\n",checks);
        Check([area hasPrefix:[NSTemporaryDirectory() stringByAppendingPathComponent:@"yebaeon-integration-"]],@"cleanup boundary"); [NSFileManager.defaultManager removeItemAtPath:area error:NULL]; return 0;
    } @catch(NSException *e) { fprintf(stderr,"INTEGRATION FAIL: %s\n",e.reason.UTF8String); return 1; }
} }
