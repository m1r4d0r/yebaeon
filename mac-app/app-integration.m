#import "YBLibrary.h"
#import <unistd.h>
@interface YBParallelTestServer : YBServer
@property NSUInteger active;
@property NSUInteger peak;
@property NSString *failPath;
@end
@implementation YBParallelTestServer
- (NSDictionary *)upload:(NSData *)data path:(NSString *)path previous:(NSDictionary *)previous {
    @synchronized(self){self.active++;self.peak=MAX(self.peak,self.active);}
    @try {usleep(120000);YBRequire(![path isEqual:self.failPath],@"injected upload failure");return [super upload:data path:path previous:previous];}
    @finally {@synchronized(self){self.active--;}}
}
@end
static int checks=0;
static void Check(BOOL ok,NSString *message){checks++;YBRequire(ok,message);}
static NSData *Doc(NSString *text){return [[NSString stringWithFormat:@"<RVPresentationDocument versionNumber=\"600\"><text>%@</text></RVPresentationDocument>",text] dataUsingEncoding:NSUTF8StringEncoding];}
static NSDictionary *Row(NSArray *rows,NSString *path){for(NSDictionary *row in rows)if([row[@"path"] isEqual:path])return row;YBRequire(NO,@"missing UI row");return nil;}
int main(int argc,const char *argv[]){@autoreleasepool{
    NSString *area=[NSTemporaryDirectory() stringByAppendingPathComponent:[@"yebaeon-app-roundtrip-" stringByAppendingString:NSUUID.UUID.UUIDString]];
    @try{
        Check(argc==2,@"Worker address");NSString *origin=[NSString stringWithUTF8String:argv[1]];
        YBParallelTestServer *server=[[YBParallelTestServer alloc] initWithOrigin:origin allowLocalTestServer:YES];YBServer *web=[[YBServer alloc] initWithOrigin:origin allowLocalTestServer:YES];[server login:@"통합 앱" password:@"native-integration-only"];[web login:@"웹 편집자" password:@"native-integration-only"];
        YBLibrary *library=[[YBLibrary alloc] initWithRoot:[area stringByAppendingPathComponent:@"documents"] profile:[area stringByAppendingPathComponent:@"profile"] server:server];library.sync.presenterRunning=^BOOL{return NO;};
        NSString *path=@"통합/문서.pro6",*full=[library.sync.root stringByAppendingPathComponent:path];[NSFileManager.defaultManager createDirectoryAtPath:full.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:NULL];NSData *a=Doc(@"original"),*b=Doc(@"web"),*c=Doc(@"Mac"),*d=Doc(@"concurrent web");Check([a writeToFile:full atomically:YES],@"local document");
        __block NSUInteger progress=0;NSDictionary *row=Row([library refresh],path);Check([row[@"status"] isEqual:@"upload"],@"UI initial upload plan");Check([library transfer:@[row] receiving:NO progress:^(NSString *p,NSUInteger count){progress=count;}]==1 && progress==1,@"UI selected upload and progress");
        row=Row([library refresh],path);NSDictionary *v1=row[@"remote"];Check([v1[@"updatedBy"] isEqual:@"통합 앱"],@"UI author");NSDictionary *v2=[web upload:b path:path previous:v1];
        row=Row([library refresh],path);Check([row[@"status"] isEqual:@"download"],@"UI remote edit plan");[library transfer:@[row] receiving:YES progress:nil];Check([[library.sync readDocument:path] isEqual:b],@"UI download applies exact bytes");
        NSString *transaction=library.sync.transactions[0][@"id"];[library.sync restore:transaction];Check([[library.sync readDocument:path] isEqual:a],@"UI restore uses same engine");[library transfer:@[Row([library refresh],path)] receiving:YES progress:nil];
        Check([c writeToFile:full atomically:YES],@"UI local edit");[library transfer:@[Row([library refresh],path)] receiving:NO progress:nil];NSDictionary *v3=Row([library refresh],path)[@"remote"];Check([v3[@"version"] isEqual:@3],@"UI reupload version");
        Check([a writeToFile:full atomically:YES],@"pending local edit");NSDictionary *stale=Row([library refresh],path);[web upload:d path:path previous:v3];BOOL blocked=NO;@try{[library transfer:@[stale] receiving:NO progress:nil];}@catch(NSException *e){blocked=YES;}Check(blocked && [[library.sync readDocument:path] isEqual:a] && [library.sync.entries[path][@"version"] isEqual:@3],@"UI stale selection does not overwrite server or baseline");
        row=Row([library refresh],path);Check([row[@"status"] isEqual:@"conflict"],@"UI conflict displayed");blocked=NO;@try{[library transfer:@[row] receiving:YES progress:nil];}@catch(NSException *e){blocked=YES;}Check(blocked,@"UI conflict cannot be forced");
        NSMutableArray *batch=[NSMutableArray array];
        for(NSUInteger i=0;i<8;i++){NSString *p=[NSString stringWithFormat:@"parallel-%lu.pro6",(unsigned long)i];NSData *bytes=[[NSString stringWithFormat:@"<RVPresentationDocument versionNumber=\"600\" lastDateUsed=\"2026-10-01T05:34:%02lu+09:00\"><text>parallel</text></RVPresentationDocument>",(unsigned long)i] dataUsingEncoding:NSUTF8StringEncoding];Check([bytes writeToFile:[library.sync.root stringByAppendingPathComponent:p] atomically:YES],@"parallel fixture");}
        NSArray *plan=[library refresh];for(NSUInteger i=0;i<8;i++){NSDictionary *r=Row(plan,[NSString stringWithFormat:@"parallel-%lu.pro6",(unsigned long)i]);Check(r[@"lastUsedTime"]!=nil,@"lastDateUsed extracted");[batch addObject:r];}
        __block NSUInteger previousProgress=0;Check([library transfer:batch receiving:NO progress:^(NSString *p,NSUInteger done){Check(done==previousProgress+1,@"parallel progress serialized");previousProgress=done;}]==8,@"parallel upload complete");Check(server.peak==4,@"four uploads overlap and concurrency bounded");
        plan=[library refresh];for(NSUInteger i=0;i<8;i++)Check([Row(plan,[NSString stringWithFormat:@"parallel-%lu.pro6",(unsigned long)i])[@"status"] isEqual:@"same"],@"parallel baselines retained");
        batch=[NSMutableArray array];for(NSUInteger i=0;i<4;i++){NSString *p=[NSString stringWithFormat:@"retry-%lu.pro6",(unsigned long)i];Check([a writeToFile:[library.sync.root stringByAppendingPathComponent:p] atomically:YES],@"retry fixture");}
        plan=[library refresh];for(NSUInteger i=0;i<4;i++)[batch addObject:Row(plan,[NSString stringWithFormat:@"retry-%lu.pro6",(unsigned long)i])];server.failPath=@"retry-1.pro6";blocked=NO;@try{[library transfer:batch receiving:NO progress:nil];}@catch(NSException *e){blocked=YES;}Check(blocked,@"partial failure reported");server.failPath=nil;
        plan=[library refresh];NSMutableArray *remaining=[NSMutableArray array];for(NSUInteger i=0;i<4;i++){NSDictionary *r=Row(plan,[NSString stringWithFormat:@"retry-%lu.pro6",(unsigned long)i]);if([r[@"status"] isEqual:@"upload"])[remaining addObject:r];else Check([r[@"status"] isEqual:@"same"],@"successful siblings preserved after failure");}Check(remaining.count==1 && [remaining[0][@"path"] isEqual:@"retry-1.pro6"],@"resume selects only failed document");Check([library transfer:remaining receiving:NO progress:nil]==1,@"retry succeeds");
        Check([[server download:v2] isEqual:b],@"earlier server version retained");printf("Integrated app Worker checks passed: %d\n",checks);[library.sync close];Check([area hasPrefix:[NSTemporaryDirectory() stringByAppendingPathComponent:@"yebaeon-app-roundtrip-"]],@"cleanup scope");[NSFileManager.defaultManager removeItemAtPath:area error:NULL];return 0;
    }@catch(NSException *e){fprintf(stderr,"APP INTEGRATION FAIL: %s\n",e.reason.UTF8String);return 1;}
}}

