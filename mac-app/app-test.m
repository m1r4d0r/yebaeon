#import "PPSPlaylistController.h"
#import "YBDocumentsController.h"
#import "YBMediaController.h"
#import "YBServerPlaylistsController.h"
#import "YBPlaylistIO.h"
#import "YBPlaylistFormat.h"
#import "YBLibrary.h"
#import "../mac-sync/PP6Core.h"
#import <sys/stat.h>
#import <unistd.h>
@interface PPSPlaylistController (Tests)
- (NSArray *)topPlaylists:(NSString *)xml;
- (void)compareIfReady;
- (NSString *)replacingSelectedNodesIn:(NSString *)xml;
- (BOOL)verifyXML:(NSString *)xml;
@end
@interface YBDocumentsController (Tests)
- (void)acceptRows:(NSArray *)rows;
- (void)selectAllUploads:(id)sender;
- (void)selectAllDownloads:(id)sender;
@end
@interface YBMediaController (Tests)
- (void)filter;
@end
static int checks=0;
static void Check(BOOL ok,NSString *message) {checks++;YBRequire(ok,message);}
static void Reject(void (^action)(void),NSString *message) {BOOL rejected=NO;@try{action();}@catch(NSException *e){rejected=[e.name isEqual:@"YebaeOn"];}Check(rejected,message);}
static void Put(NSString *path,NSData *data) {Check([NSFileManager.defaultManager createDirectoryAtPath:path.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:NULL],@"fixture folder");Check([data writeToFile:path atomically:YES],@"fixture data");}
static NSData *Document(NSArray *sources) {
    NSMutableString *xml=[NSMutableString stringWithString:@"<RVPresentationDocument versionNumber=\"600\" width=\"1280\" height=\"720\"><RVSlideGrouping uuid=\"group\" name=\"말씀\">"];
    NSUInteger i=0;for(NSString *source in sources)[xml appendFormat:@"<RVDisplaySlide UUID=\"slide-%lu\"><RVMediaCue rvXMLIvarName=\"backgroundMediaCue\"><RVImageElement source=\"%@\"/></RVMediaCue></RVDisplaySlide>",(unsigned long)++i,source];
    [xml appendString:@"</RVSlideGrouping></RVPresentationDocument>"];return [xml dataUsingEncoding:NSUTF8StringEncoding];
}
@interface YBTestPanel : NSView
@end
@implementation YBTestPanel
- (void)drawRect:(NSRect)rect {[NSColor.windowBackgroundColor setFill];NSRectFill(rect);}
@end
static void Render(NSView *content,NSString *name) {
    // A standalone panel is transparent; include the same background supplied by the app window.
    NSView *view=[[YBTestPanel alloc] initWithFrame:content.bounds];[view addSubview:content];
    NSWindow *window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,1060,720) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];window.releasedWhenClosed=NO;window.appearance=[NSAppearance appearanceNamed:NSAppearanceNameAqua];window.contentView=view;[window makeKeyAndOrderFront:nil];[view layoutSubtreeIfNeeded];
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.15]];
    NSBitmapImageRep *bitmap=[view bitmapImageRepForCachingDisplayInRect:view.bounds];[view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];NSData *png=[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    Check(png.length>1000,@"rendered panel pixels");Put([@"mac-app/test-output" stringByAppendingPathComponent:[name stringByAppendingString:@".png"]],png);[window orderOut:nil];
}
int main(void) {@autoreleasepool {
    NSString *area=[NSTemporaryDirectory() stringByAppendingPathComponent:[@"yebaeon-app-tests-" stringByAppendingString:NSUUID.UUID.UUIDString]];
    @try {
        [NSApplication sharedApplication];YBSetTestPreferencesDirectory([area stringByAppendingPathComponent:@"settings"]);
        NSString *old=[NSString stringWithContentsOfFile:@"mac-app/fixtures/dummy_old.xml" encoding:NSUTF8StringEncoding error:NULL],*new=[NSString stringWithContentsOfFile:@"mac-app/fixtures/dummy_new.xml" encoding:NSUTF8StringEncoding error:NULL];Check(old && new,@"original prototype fixtures");
        NSString *legacyDocument=[area stringByAppendingPathComponent:@"legacy-library.pro6pl"];
        Put(legacyDocument,[old dataUsingEncoding:NSUTF8StringEncoding]);
        NSData *legacySettings=[NSJSONSerialization dataWithJSONObject:@{@"localPath":legacyDocument} options:0 error:NULL];Put(YBLegacySettingsPath(),legacySettings);
        PPSPlaylistController *playlist=[PPSPlaylistController new];
        Check([YBPreferences(@"playlist-settings.json")[@"localPath"] isEqual:legacyDocument],@"legacy playlist setting imported");
        Check([[NSData dataWithContentsOfFile:YBLegacySettingsPath()] isEqual:legacySettings],@"legacy settings unchanged");[playlist setValue:old forKey:@"localXML"];[playlist setValue:new forKey:@"incomingXML"];[playlist setValue:@YES forKey:@"suppressNoChangeAlert"];[playlist compareIfReady];
        NSArray *reviews=[playlist valueForKey:@"reviews"];Check(reviews.count==1,@"original playlist comparison preserved; date-only second playlist ignored");
        for(NSString *kind in @[@"added",@"modified",@"deletedCount",@"moved"])Check([reviews[0][kind] isEqual:@1],[@"prototype fixture change " stringByAppendingString:kind]);
        new=[new stringByReplacingOccurrencesOfString:@"third-song-a.pro6\" contentHash=\"v1" withString:@"third-song-a.pro6\" contentHash=\"v2"];
        [playlist setValue:new forKey:@"incomingXML"];[playlist compareIfReady];reviews=[playlist valueForKey:@"reviews"];Check(reviews.count==2,@"two changed playlists fixture");
        reviews[1][@"selected"]=@NO;NSString *partial=[playlist replacingSelectedNodesIn:old];Check([playlist verifyXML:partial],@"selected playlist verification");
        NSArray *before=[playlist topPlaylists:old],*after=[playlist topPlaylists:partial],*incoming=[playlist topPlaylists:new];
        Check([after[0][@"raw"] isEqual:incoming[0][@"raw"]],@"selected node updated");Check([after[1][@"raw"] isEqual:before[1][@"raw"]],@"unselected node preserved byte for byte");
        NSURL *url=[NSURL fileURLWithPath:[area stringByAppendingPathComponent:@"documents/library.pro6pl"]];NSData *a=[old dataUsingEncoding:NSUTF8StringEncoding],*b=[partial dataUsingEncoding:NSUTF8StringEncoding];Put(url.path,a);chmod(url.fileSystemRepresentation,0640);
        NSString *backupRoot=[area stringByAppendingPathComponent:@"backups"];
        NSURL *backup=YBReplacePlaylist(url,a,b,backupRoot,^BOOL{return NO;});Check([YBReadPlaylist(url) isEqual:b],@"playlist applied");Check([YBReadPlaylist(backup) isEqual:a],@"playlist backup exact bytes");
        struct stat st;stat(url.fileSystemRepresentation,&st);Check((st.st_mode&0777)==0640,@"playlist permissions retained");
        Reject(^{YBReplacePlaylist(url,a,a,backupRoot,^BOOL{return NO;});},@"stale comparison protected");
        Reject(^{YBReplacePlaylist(url,b,a,backupRoot,^BOOL{return YES;});},@"PP6 running blocked");
        NSURL *beforeRestore=YBReplacePlaylist(url,b,YBReadPlaylist(backup),backupRoot,^BOOL{return NO;});Check([YBReadPlaylist(url) isEqual:a] && [YBReadPlaylist(beforeRestore) isEqual:b],@"restore also backs up current playlist");
        Reject(^{YBValidatePlaylist([@"<!DOCTYPE RVPlaylistDocument><RVPlaylistDocument/>" dataUsingEncoding:NSUTF8StringEncoding]);},@"playlist external declarations blocked");
        Reject(^{YBValidatePlaylist([@"<RVPlaylistDocument><bad></RVPlaylistDocument>" dataUsingEncoding:NSUTF8StringEncoding]);},@"invalid XML blocked");
        NSString *link=[area stringByAppendingPathComponent:@"documents/link.pro6pl"];Check(symlink(url.fileSystemRepresentation,link.fileSystemRepresentation)==0,@"symlink fixture");Reject(^{YBReadPlaylist([NSURL fileURLWithPath:link]);},@"playlist symlink protected");
        [playlist setValue:@"예제 운영 파일 · dummy_old.pro6pl" forKeyPath:@"localPathLabel.stringValue"];[playlist setValue:@"예제 최신 파일 · dummy_new.pro6pl" forKeyPath:@"incomingPathLabel.stringValue"];Render(playlist.view,@"playlist");
        NSString *wrapped=@"<RVPlaylistDocument><RVPlaylistNode UUID=\"ROOT\"><array rvXMLIvarName=\"children\"><RVPlaylistNode UUID=\"A\" displayName=\"예배 A\"><array rvXMLIvarName=\"children\"><RVDocumentCue UUID=\"C\" displayName=\"말씀\" filePath=\"/Library/PP6/sermon.pro6\" selectedArrangementID=\"first\"/></array></RVPlaylistNode><RVPlaylistNode UUID=\"B\" displayName=\"예배 B\"><array rvXMLIvarName=\"children\"/></RVPlaylistNode></array></RVPlaylistNode><array rvXMLIvarName=\"deletions\"/></RVPlaylistDocument>";
        YBValidatePlaylist([wrapped dataUsingEncoding:NSUTF8StringEncoding]);
        Check([YBPlaylistReference(@"/Users/procg/Documents/ProPresenter6/원제 : 예수.pro6",@"~/Documents/ProPresenter6") isEqual:@"원제 : 예수.pro6"],@"playlist links original colon filename");
        Check([YBPlaylistReference([NSURL fileURLWithPath:@"/Users/procg/Documents/ProPresenter6/원제 : 예수 %3A.pro6"].absoluteString,@"~/Documents/ProPresenter6") isEqual:@"원제 : 예수 %3A.pro6"],@"encoded playlist link decodes once");
        NSString *wrappedNew=[wrapped stringByReplacingOccurrencesOfString:@"selectedArrangementID=\"first\"" withString:@"selectedArrangementID=\"second\""];
        [playlist setValue:wrapped forKey:@"localXML"];[playlist setValue:wrappedNew forKey:@"incomingXML"];[playlist compareIfReady];
        NSArray *wrappedReviews=[playlist valueForKey:@"reviews"];
        Check(wrappedReviews.count==1 && [wrappedReviews[0][@"modified"] isEqual:@1],@"real PP6 array structure and cue settings without contentHash");
        NSString *wrappedApplied=[playlist replacingSelectedNodesIn:wrapped];YBValidatePlaylist([wrappedApplied dataUsingEncoding:NSUTF8StringEncoding]);
        Check([wrappedApplied isEqual:wrappedNew],@"wrapped playlist replacement preserves outer arrays and unselected node");
        NSString *duplicate=[wrapped stringByReplacingOccurrencesOfString:@"UUID=\"B\"" withString:@"UUID=\"A\""];
        Reject(^{YBValidatePlaylist([duplicate dataUsingEncoding:NSUTF8StringEncoding]);},@"duplicate UUID in real PP6 array wrapper blocked");
        NSString *duplicateName=@"<RVPlaylistDocument><RVPlaylistNode><array><RVPlaylistNode displayName=\"same\"/><RVPlaylistNode displayName=\"same\"/></array></RVPlaylistNode></RVPlaylistDocument>";
        Reject(^{YBValidatePlaylist([duplicateName dataUsingEncoding:NSUTF8StringEncoding]);},@"ambiguous fallback name blocked");
        NSString *documents=[area stringByAppendingPathComponent:@"media-documents"],*media=[area stringByAppendingPathComponent:@"media"];
        NSData *image=[@"synthetic-media" dataUsingEncoding:NSUTF8StringEncoding];Put([media stringByAppendingPathComponent:@"exact.jpg"],image);Put([media stringByAppendingPathComponent:@"moved.jpg"],image);Put([media stringByAppendingPathComponent:@"a/duplicate.jpg"],image);Put([media stringByAppendingPathComponent:@"b/duplicate.jpg"],image);
        NSArray *sources=@[[NSURL fileURLWithPath:[media stringByAppendingPathComponent:@"exact.jpg"]].absoluteString,@"file:///missing/moved.jpg",@"file:///missing/duplicate.jpg",@"file:///missing/absent.jpg"];
        NSData *doc=Document(sources);Put([documents stringByAppendingPathComponent:@"예배/말씀.pro6"],doc);
        NSDictionary *report=YBMediaReport(documents,@[media]);Check([report[@"rows"] count]==4,@"Core document media refs integrated");
        for(NSString *status in @[@"exact-managed",@"relocated-unique",@"ambiguous",@"missing"])Check([report[@"counts"][status] isEqual:@1],[@"media resolution " stringByAppendingString:status]);
        NSDictionary *parsed=PP6ParseDocumentData(doc,@"말씀.pro6",@[media],PP6BuildMediaIndex(@[media]),@[],@{},YES);Check([parsed[@"slideCount"] isEqual:@4],@"Core data preview");
        NSDictionary *changed=PP6ParseDocumentData(Document(@[sources[0],sources[1]]),@"말씀.pro6",@[],@{},@[],@{},YES);NSDictionary *diff=PP6CompareParsedDocuments(parsed,changed);Check([diff[@"counts"][@"deleted"] isEqual:@2],@"Core slide comparison integrated");
        Check([PP6ParseDocumentData([@"<!DOCTYPE RVPresentationDocument><RVPresentationDocument/>" dataUsingEncoding:NSUTF8StringEncoding],@"bad.pro6",@[],@{},@[],@{},NO)[@"parseError"] length]>0,@"Core rejects external entities");
        YBWork *work=[YBWork new];YBDocumentsController *controller=[[YBDocumentsController alloc] initWithWork:work];NSMutableArray *rows=[NSMutableArray array];
        NSArray *statuses=@[@"download",@"upload",@"same",@"conflict"],*paths=@[@"주일예배/말씀.pro6",@"찬양/찬송.pro6",@"예배순서/안내.pro6",@"수요예배/기도.pro6"];
        for(NSUInteger i=0;i<statuses.count;i++)[rows addObject:@{@"path":paths[i],@"status":statuses[i],@"localHash":NSNull.null,@"remote":i==1 ? (id)NSNull.null : @{@"version":@(i+1),@"updatedBy":@"예배 준비팀"}}];
        [controller acceptRows:rows];Check([[controller valueForKey:@"visibleRows"] count]==4,@"document UI row binding");[controller setValue:@"말씀" forKeyPath:@"search.stringValue"];[controller performSelector:@selector(filter)];Check([[controller valueForKey:@"visibleRows"] count]==1,@"document search");[controller setValue:@"" forKeyPath:@"search.stringValue"];[controller performSelector:@selector(filter)];Render(controller.view,@"documents");
        NSMutableArray *large=[NSMutableArray arrayWithArray:rows];
        for(NSUInteger i=0;i<3107;i++)[large addObject:@{@"path":[NSString stringWithFormat:@"song-%lu.pro6",(unsigned long)i],@"status":@"upload",@"localHash":NSNull.null,@"remote":NSNull.null}];
        [large addObject:@{@"path":@"bad : name.pro6",@"status":@"conflict",@"error":@"업로드 제외",@"localHash":NSNull.null,@"remote":NSNull.null}];
        [controller acceptRows:large];[controller setValue:@"말씀" forKeyPath:@"search.stringValue"];[controller performSelector:@selector(filter)];
        [controller selectAllUploads:nil];NSSet *selected=[controller valueForKey:@"checked"];
        Check(selected.count==3108 && ![selected containsObject:@"bad : name.pro6"] && ![selected containsObject:paths[0]],@"bulk upload selects all outside filter and excludes other directions/conflicts");
        [controller selectAllDownloads:nil];selected=[controller valueForKey:@"checked"];
        Check(selected.count==1 && [selected containsObject:paths[0]],@"bulk download replaces upload selection");
        [controller acceptRows:rows];[controller setValue:@"" forKeyPath:@"search.stringValue"];[controller performSelector:@selector(filter)];
        YBMediaController *mediaUI=[[YBMediaController alloc] initWithWork:work documentsRoot:documents];[mediaUI setValue:report forKey:@"report"];[mediaUI filter];Check([[mediaUI valueForKey:@"visibleRows"] count]==4,@"media UI binding");[mediaUI setValue:@1 forKeyPath:@"problemsOnly.state"];[mediaUI filter];Check([[mediaUI valueForKey:@"visibleRows"] count]==3,@"media problem filter");[mediaUI setValue:@0 forKeyPath:@"problemsOnly.state"];[mediaUI filter];Render(mediaUI.view,@"media");
        YBServerPlaylistsController *serverUI=[[YBServerPlaylistsController alloc] initWithWork:work documents:controller];
        [serverUI setValue:@{@"ready":@YES,@"orderChanged":@YES,@"rows":@[@{@"path":@"찬양/공유 찬양.pro6",@"status":@"download"}],@"manifest":@{@"playlist":@{@"name":@"주일 1부 예배"},@"items":@[@{@"name":@"공유 찬양",@"kind":@"document",@"path":@"찬양/공유 찬양.pro6",@"sharedWith":@[@"주일 2부 예배"]}]}} forKey:@"comparison"];
        [[serverUI valueForKey:@"table"] reloadData];Check([[serverUI valueForKey:@"table"] numberOfRows]==1,@"server playlist UI row binding");Render(serverUI.view,@"server-playlists");
        __block BOOL finished=NO;__block NSString *failure=nil;
        [work run:^id {YBRequire(!NSThread.isMainThread,@"background worker");return @42;} completion:^(id result,NSString *error){Check(NSThread.isMainThread && [result isEqual:@42] && !error,@"UI completion on main thread");finished=YES;}];
        NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:3];while(!finished && deadline.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];Check(finished && !work.busy,@"async UI work completes");
        finished=NO;[work run:^id {YBRequire(NO,@"test failure");return nil;} completion:^(id result,NSString *error){failure=error;finished=YES;}];deadline=[NSDate dateWithTimeIntervalSinceNow:3];while(!finished && deadline.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];Check([failure isEqual:@"test failure"] && !work.busy,@"async errors return safely");
        printf("Integrated app checks passed: %d\n",checks);Check([area hasPrefix:[NSTemporaryDirectory() stringByAppendingPathComponent:@"yebaeon-app-tests-"]],@"cleanup scope");[NSFileManager.defaultManager removeItemAtPath:area error:NULL];return 0;
    }@catch(NSException *e){fprintf(stderr,"APP FAIL after %d: %s\n",checks,e.reason.UTF8String);return 1;}
}}
