#define YB_DIAGNOSTIC_TEST 1
#import "diagnose-local.m"
#import <unistd.h>
#import <stdlib.h>
#import <limits.h>
static NSUInteger checks;
static void Check(BOOL ok,NSString *message){checks++;YBRequire(ok,message);}
static void Reject(void (^action)(void),NSString *message){BOOL rejected=NO;@try{action();}@catch(NSException *e){rejected=[e.name isEqual:@"YebaeOn"];}Check(rejected,message);}
static void Put(NSString *path,NSData *data){
    YBRequire([NSFileManager.defaultManager createDirectoryAtPath:path.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:NULL],@"fixture folder");
    YBRequire([data writeToFile:path atomically:YES],@"fixture write");
}
static NSData *JSON(id value){return [NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];}
int main(void){@autoreleasepool {
    char resolved[PATH_MAX];
    if(!realpath(NSTemporaryDirectory().fileSystemRepresentation,resolved)){fprintf(stderr,"Cannot resolve synthetic test directory\n");return 1;}
    NSString *area=[[@(resolved) stringByAppendingPathComponent:[@"yebaeon-diagnostic-test-" stringByAppendingString:NSUUID.UUID.UUIDString]] copy];
    @try {
        NSString *root=[area stringByAppendingPathComponent:@"문서 폴더"],*settings=[area stringByAppendingPathComponent:@"settings"],*playlist=[area stringByAppendingPathComponent:@"기본 .pro6pl"];
        NSString *relative=[@"찬양/한글 .pro6" decomposedStringWithCanonicalMapping],*document=[root stringByAppendingPathComponent:relative];
        NSData *content=[@"synthetic content never included in report" dataUsingEncoding:NSUTF8StringEncoding];Put(document,content);
        NSString *node=[NSString stringWithFormat:@"<RVPlaylistNode UUID=\"A\" displayName=\"금요 예배\"><array rvXMLIvarName=\"children\"><RVDocumentCue UUID=\"cue\" filePath=\"%@\"/></array></RVPlaylistNode>",document];
        NSData *xml=[[NSString stringWithFormat:@"<RVPlaylistDocument><RVPlaylistNode UUID=\"ROOT\"><array rvXMLIvarName=\"children\">%@<RVPlaylistNode UUID=\"B\" displayName=\"보관 미선택\"/></array></RVPlaylistNode></RVPlaylistDocument>",node] dataUsingEncoding:NSUTF8StringEncoding];
        Put(playlist,xml);NSString *profile=[settings stringByAppendingPathComponent:YBHash([@"profile" dataUsingEncoding:NSUTF8StringEncoding])];
        NSDictionary *meta=@{@"id":@"document",@"path":relative,@"version":@2,@"sha256":YBHash(content),@"cookie":@"must-not-leak"};
        Put([profile stringByAppendingPathComponent:@"state.json"],JSON(@{@"schema":@1,@"root":root,@"origin":@"https://user:secret@example.test/?token=secret",@"entries":@{relative:meta},@"password":@"must-not-leak"}));
        NSString *baseline=[profile stringByAppendingPathComponent:[NSString stringWithFormat:@"playlist-state-%@.json",YBHash([playlist dataUsingEncoding:NSUTF8StringEncoding])]];
        Put(baseline,JSON(@{@"target":playlist,@"entries":@{@"library/A":@{@"localHash":@"old",@"remoteHash":@"remote",@"cookie":@"must-not-leak"}},@"file":@{@"libraryID":@"library",@"version":@3,@"localHash":@"old",@"remoteHash":@"remote"}}));
        Put([profile stringByAppendingPathComponent:@"playlist-active.json"],JSON(@{@"id":@"pending",@"status":@"active",@"cookie":@"must-not-leak"}));
        Put([profile stringByAppendingPathComponent:@"transactions/11111111-1111-1111-1111-111111111111/transaction.json"],JSON(@{@"id":@"pending-doc",@"status":@"prepared",@"path":relative,@"incoming":@{@"cookie":@"must-not-leak"}}));
        YBDiagnosticReader *reader=[YBDiagnosticReader new];NSDictionary *report=Collect(reader,root,playlist,settings);[reader verify];
        Check([report[@"playlistCount"] isEqual:@2],@"playlist count");
        Check([report[@"playlists"][0][@"sha256"] isEqual:YBHash([node dataUsingEncoding:NSUTF8StringEncoding])],@"exact raw node hash");
        Check([report[@"playlists"][0][@"items"][0][@"filePath"] isEqual:document],@"NFD and spaces preserved in source reference");
        Check([report[@"referencedDocuments"][0][@"sha256"] isEqual:YBHash(content)],@"referenced document found on Mac filesystem");
        Check([report[@"profiles"][0][@"activePlaylist"][@"status"] isEqual:@"active"],@"pending playlist reported");
        Check([report[@"profiles"][0][@"jobs"][0][@"status"] isEqual:@"prepared"],@"pending document reported");
        Check([report[@"profiles"][0][@"origin"] isEqual:@"https://example.test"],@"origin excludes credentials");
        NSString *text=[[NSString alloc] initWithData:JSON(report) encoding:NSUTF8StringEncoding];
        Check(![text containsString:@"must-not-leak"] && ![text containsString:@"synthetic content never"],@"allowlist excludes credentials and document contents");
        Check([[NSData dataWithContentsOfFile:playlist] isEqual:xml] && [[NSData dataWithContentsOfFile:document] isEqual:content],@"original bytes unchanged");
        Check(![NSFileManager.defaultManager fileExistsAtPath:[root stringByAppendingPathComponent:@".yebaeon-sync.lock"]],@"no sync lock or engine startup");
        NSDictionary *noBaseline=Collect([YBDiagnosticReader new],root,playlist,[area stringByAppendingPathComponent:@"missing-settings"]);
        Check([noBaseline[@"profiles"] count]==0,@"missing baseline stays missing");
        Put(playlist,[xml subdataWithRange:NSMakeRange(0,xml.length-1)]);
        Reject(^{[reader verify];},@"changed file invalidates snapshot");Put(playlist,xml);
        NSString *absent=[area stringByAppendingPathComponent:@"absent.json"];YBDiagnosticReader *missing=[YBDiagnosticReader new];[missing read:absent];Put(absent,JSON(@{}));
        Reject(^{[missing verify];},@"new baseline invalidates snapshot");
        YBDiagnosticReader *directory=[YBDiagnosticReader new];[directory names:settings];Put([settings stringByAppendingPathComponent:@"new.json"],JSON(@{}));
        Reject(^{[directory verify];},@"changed directory invalidates snapshot");
        Reject(^{[[YBDiagnosticReader new] read:[area stringByAppendingString:@"/../escape.json"]];},@"parent traversal rejected before filesystem access");
        NSString *link=[area stringByAppendingPathComponent:@"link.pro6pl"];Check(symlink(playlist.fileSystemRepresentation,link.fileSystemRepresentation)==0,@"symlink fixture");
        Reject(^{[[YBDiagnosticReader new] read:link];},@"leaf symlink rejected");
        NSString *parent=[area stringByAppendingPathComponent:@"linked-documents"];Check(symlink(root.fileSystemRepresentation,parent.fileSystemRepresentation)==0,@"parent symlink fixture");
        Reject(^{[[YBDiagnosticReader new] read:[parent stringByAppendingPathComponent:relative]];},@"parent symlink rejected");
        Put(playlist,[@"<!DOCTYPE RVPlaylistDocument><RVPlaylistDocument/>" dataUsingEncoding:NSUTF8StringEncoding]);
        Reject(^{Collect([YBDiagnosticReader new],root,playlist,settings);},@"external declaration rejected");
        fprintf(stderr,"Read-only diagnostic checks passed: %lu\n",(unsigned long)checks);
        [NSFileManager.defaultManager removeItemAtPath:area error:NULL];return 0;
    }@catch(NSException *e){fprintf(stderr,"Diagnostic test failed after %lu: %s\n",(unsigned long)checks,e.reason.UTF8String);return 1;}
}}
