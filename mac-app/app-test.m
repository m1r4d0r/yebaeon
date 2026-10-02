#define main YBApplicationMain
#import "main.m"
#undef main
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
- (void)orderChanged:(id)sender;
- (void)selectAllUploads:(id)sender;
- (void)selectAllDownloads:(id)sender;
@end
@interface YBServerPlaylistsController (Tests)
- (void)acceptLibraries:(NSArray *)libraries;
- (void)acceptComparison:(NSDictionary *)comparison;
- (NSArray *)recoveryRecordsForSync:(YBSync *)sync jobs:(NSArray *)jobs;
- (NSView *)recoveryView;
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
    NSWindow *window=[[NSWindow alloc] initWithContentRect:content.bounds styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];window.releasedWhenClosed=NO;window.appearance=[NSAppearance appearanceNamed:NSAppearanceNameAqua];window.contentView=view;[window makeKeyAndOrderFront:nil];[view layoutSubtreeIfNeeded];
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.15]];
    NSBitmapImageRep *bitmap=[view bitmapImageRepForCachingDisplayInRect:view.bounds];[view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];NSData *png=[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    Check(png.length>1000,@"rendered panel pixels");Put([@"mac-app/test-output" stringByAppendingPathComponent:[name stringByAppendingString:@".png"]],png);[window orderOut:nil];
}
static void CaptureWindow(NSWindow *window,NSString *name) {
    [window makeKeyAndOrderFront:nil];[window.contentView layoutSubtreeIfNeeded];
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.15]];
    NSView *view=window.contentView;NSBitmapImageRep *bitmap=[view bitmapImageRepForCachingDisplayInRect:view.bounds];[view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];NSData *png=[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    Check(png.length>1000,@"actual window pixels");Put([@"mac-app/test-output" stringByAppendingPathComponent:[name stringByAppendingString:@".png"]],png);
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
        Check(selected.count==0,@"bulk upload respects current search");
        [controller setValue:@"" forKeyPath:@"search.stringValue"];[controller selectAllUploads:nil];selected=[controller valueForKey:@"checked"];Check(selected.count==3108 && ![selected containsObject:@"bad : name.pro6"],@"bulk upload selects visible direction without conflicts");
        [controller setValue:@"말씀" forKeyPath:@"search.stringValue"];
        [controller selectAllDownloads:nil];selected=[controller valueForKey:@"checked"];
        Check(selected.count==1 && [selected containsObject:paths[0]],@"bulk download replaces upload selection");
        [controller acceptRows:rows];[controller setValue:@"" forKeyPath:@"search.stringValue"];[controller performSelector:@selector(filter)];
        [controller acceptRows:@[@{@"path":@"a.pro6",@"status":@"upload"},@{@"path":@"b.pro6",@"status":@"upload",@"lastUsedTime":@100},@{@"path":@"c.pro6",@"status":@"upload",@"lastUsedTime":@200}]];
        NSArray *ordered=[controller valueForKey:@"rows"];Check([ordered[0][@"path"] isEqual:@"c.pro6"] && [ordered[2][@"path"] isEqual:@"a.pro6"],@"recent order and missing date last");
        NSPopUpButton *order=[controller valueForKey:@"order"];[order selectItemAtIndex:1];[controller orderChanged:nil];ordered=[controller valueForKey:@"rows"];Check([ordered[0][@"path"] isEqual:@"a.pro6"],@"name order selectable");[order selectItemAtIndex:0];[controller acceptRows:rows];
        NSTableView *docTable=[controller valueForKey:@"table"];docTable.sortDescriptors=@[[NSSortDescriptor sortDescriptorWithKey:@"remote.updatedAt" ascending:NO]];Check([[controller valueForKey:@"rows"] count]==4,@"server-date sorting handles documents not yet on server");
        NSString *usedFile=[area stringByAppendingPathComponent:@"used.pro6pl"];Put(usedFile,[[wrapped stringByReplacingOccurrencesOfString:@"/Library/PP6/sermon.pro6" withString:@"/Users/procg/Documents/ProPresenter6/찬양/찬송.pro6"] dataUsingEncoding:NSUTF8StringEncoding]);[controller setPlaylistFile:[NSURL fileURLWithPath:usedFile]];[controller setValue:@1 forKeyPath:@"usedOnly.state"];[controller selectAllUploads:nil];Check([[controller valueForKey:@"visibleRows"] count]==1 && [[controller valueForKey:@"checked"] containsObject:paths[1]],@"playlist usage filter and selection use exact relative reference");
        [controller setValue:@0 forKeyPath:@"usedOnly.state"];[controller selectAllUploads:nil];[docTable selectAll:nil];Check([[controller valueForKey:@"checked"] count]==1,@"Cmd A responder selects current transfer direction");
        YBMediaController *mediaUI=[[YBMediaController alloc] initWithWork:work documentsRoot:documents];[mediaUI setValue:report forKey:@"report"];[mediaUI filter];Check([[mediaUI valueForKey:@"visibleRows"] count]==4,@"media UI binding");[mediaUI setValue:@1 forKeyPath:@"problemsOnly.state"];[mediaUI filter];Check([[mediaUI valueForKey:@"visibleRows"] count]==3,@"media problem filter");[mediaUI setValue:@0 forKeyPath:@"problemsOnly.state"];[mediaUI filter];Render(mediaUI.view,@"media");
        YBServerPlaylistsController *serverUI=[[YBServerPlaylistsController alloc] initWithWork:work documents:controller];
        [serverUI setValue:@{@"ready":@YES,@"orderChanged":@YES,@"rows":@[@{@"path":@"찬양/공유 찬양.pro6",@"status":@"download"}],@"manifest":@{@"playlist":@{@"name":@"주일 1부 예배"},@"items":@[@{@"name":@"공유 찬양",@"kind":@"document",@"path":@"찬양/공유 찬양.pro6",@"sharedWith":@[@"주일 2부 예배"]}]}} forKey:@"comparison"];
        NSDictionary *uiComparison=[serverUI valueForKey:@"comparison"];[serverUI setValue:[@{@"lib/order":uiComparison} mutableCopy] forKey:@"comparisons"];[serverUI acceptLibraries:@[@{@"id":@"lib",@"path":@"기본 .pro6pl",@"updatedAt":@"2026-10-01",@"playlists":@[@{@"id":@"order",@"name":@"주일 1부 예배"}]}]];[serverUI acceptComparison:uiComparison];
        [[serverUI valueForKey:@"table"] reloadData];Check([[serverUI valueForKey:@"table"] numberOfRows]==1,@"server playlist UI row binding");Render(serverUI.view,@"server-playlists");
        YBSync *recoverySync=[[YBSync alloc] initWithRoot:[area stringByAppendingPathComponent:@"recovery-docs"] profile:[area stringByAppendingPathComponent:@"recovery-profile"] origin:@"https://example.test"];recoverySync.presenterRunning=^BOOL{return NO;};[recoverySync beginBackupBatch:@"documents" playlistJob:nil];for(NSString *path in @[@"찬양.pro6",@"말씀.pro6"])[recoverySync apply:doc document:@{@"id":NSUUID.UUID.UUIDString.lowercaseString,@"path":path,@"version":@1,@"sha256":YBHash(doc),@"size":@(doc.length),@"updatedBy":@"테스트",@"updatedAt":@"2026-10-01"} expectedLocalHash:nil];[recoverySync endBackupBatch:YES];NSArray *records=[serverUI recoveryRecordsForSync:recoverySync jobs:@[]];Check(records.count==1 && [records[0][@"members"] count]==2,@"recovery list groups documents by operation without duplicate rows");[serverUI setValue:records forKey:@"recoveryRecords"];NSView *recovery=[serverUI recoveryView];[[serverUI valueForKey:@"recoveryTable"] selectRowIndexes:[NSIndexSet indexSetWithIndex:0] byExtendingSelection:NO];NSTableView *recoveryTable=[serverUI valueForKey:@"recoveryTable"];NSTextField *targetCell=(NSTextField *)[recoveryTable viewAtColumn:1 row:0 makeIfNecessary:YES];Check([targetCell.stringValue isEqual:@"문서 받기"],@"recovery cells render the selected batch, not playlist preview data");Render(recovery,@"recovery");[recoverySync close];
        // Exercise actual connection bar + NSTabView, not isolated fixed-size controllers.
        YBAppDelegate *app=[YBAppDelegate new];[app applicationDidFinishLaunching:[NSNotification notificationWithName:NSApplicationDidFinishLaunchingNotification object:NSApp]];app.window.appearance=[NSAppearance appearanceNamed:NSAppearanceNameAqua];
        [app.documents acceptRows:rows];[app.serverPlaylists setValue:[@{@"lib/order":uiComparison} mutableCopy] forKey:@"comparisons"];[app.serverPlaylists acceptLibraries:@[@{@"id":@"lib",@"path":@"기본 .pro6pl",@"playlists":@[@{@"id":@"order",@"name":@"주일 1부 예배 아주 긴 이름"}]}]];[app.serverPlaylists acceptComparison:uiComparison];app.documentPath.stringValue=@"/Users/교회/아주 긴 문서 폴더/ProPresenter6/찬양과 말씀";app.playlistPath.stringValue=@"/Users/교회/아주 긴 재생목록 폴더/기본 .pro6pl";
        for(NSValue *size in @[[NSValue valueWithSize:NSMakeSize(1060,800)],[NSValue valueWithSize:NSMakeSize(880,620)],[NSValue valueWithSize:NSMakeSize(960,680)]]){
            [app.window setFrame:NSMakeRect(app.window.frame.origin.x,app.window.frame.origin.y,size.sizeValue.width,size.sizeValue.height) display:YES];[app.window.contentView layoutSubtreeIfNeeded];
            for(NSTabViewItem *tab in app.tabs.tabViewItems){[app.tabs selectTabViewItem:tab];[app.window.contentView layoutSubtreeIfNeeded];NSView *panel=tab.view;
                Check(panel.bounds.size.width<1060 && panel.bounds.size.height<720,@"tab uses actual top-level viewport");
                for(NSView *control in panel.subviews)if(!control.hidden){Check(NSContainsRect(NSInsetRect(panel.bounds,-1,-1),control.frame),[@"visible control within viewport: " stringByAppendingString:[control isKindOfClass:NSButton.class] ? [(NSButton *)control title] : control.className]);if([control isKindOfClass:NSScrollView.class])Check(control.frame.size.height>=80,@"table retains usable height");}
                CaptureWindow(app.window,[NSString stringWithFormat:@"window-%@-%d",tab.label,(int)size.sizeValue.width]);
            }
            Check(!NSIntersectsRect(app.documentPath.frame,app.playlistPath.frame),@"long paths occupy separate rows");
        }
        Check([YBDisplayDate(@"2026-10-01T23:43:12.456Z") containsString:@"8:43"],@"server date is converted to Seoul without milliseconds");
        [app.window orderOut:nil];
        [serverUI setValue:@{@"localNode":@{@"items":@[@{@"attrs":@{@"UUID":@"old",@"displayName":@"기존"}}]},@"manifest":@{@"items":@[@{@"id":@"new",@"name":@"추가"},@{@"id":@"old",@"name":@"기존"}]}} forKey:@"comparison"];
        NSArray *preview=[serverUI performSelector:@selector(previewItems)];Check([preview[0][@"composition"] isEqual:@"순서에 추가"] && [preview[1][@"composition"] isEqual:@""],@"adding a cue is independent of content, insertion alone does not mark old cue as moved");
        dispatch_semaphore_t entered=dispatch_semaphore_create(0),resume=dispatch_semaphore_create(0);__block BOOL backgroundExited=NO,foregroundDone=NO,cancelNotified=NO;
        [work runBackground:^id(BOOL (^cancelled)(void)){dispatch_semaphore_signal(entered);dispatch_semaphore_wait(resume,dispatch_time(DISPATCH_TIME_NOW,3*NSEC_PER_SEC));backgroundExited=YES;return @(cancelled());} completion:^(id result,NSString *error){cancelNotified=error.length>0;}];
        Check(dispatch_semaphore_wait(entered,dispatch_time(DISPATCH_TIME_NOW,3*NSEC_PER_SEC))==0 && !work.busy,@"background comparison leaves foreground controls available");
        [work run:^id{Check(backgroundExited,@"foreground transfer waits for comparison checkpoint");return @YES;} completion:^(id result,NSString *error){foregroundDone=YES;}];dispatch_semaphore_signal(resume);
        NSDate *priorityDeadline=[NSDate dateWithTimeIntervalSinceNow:3];while(!foregroundDone && priorityDeadline.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
        Check(foregroundDone && cancelNotified && !work.busy,@"user work cancels background and releases busy without stale result");
        __block BOOL finished=NO;__block NSString *failure=nil;
        [work run:^id {YBRequire(!NSThread.isMainThread,@"background worker");dispatch_async(dispatch_get_main_queue(),^{work.message=@"전송 완료 · 상태 확인 마무리";});return @42;} completion:^(id result,NSString *error){Check(NSThread.isMainThread && [result isEqual:@42] && !error && !work.busy && !work.message,@"UI completion releases busy and phase on main thread");finished=YES;}];
        NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:3];while(!finished && deadline.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];Check(finished && !work.busy,@"async UI work completes");
        finished=NO;[work run:^id {YBRequire(NO,@"test failure");return nil;} completion:^(id result,NSString *error){failure=error;finished=YES;}];deadline=[NSDate dateWithTimeIntervalSinceNow:3];while(!finished && deadline.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];Check([failure isEqual:@"test failure"] && !work.busy,@"async errors return safely");
        printf("Integrated app checks passed: %d\n",checks);Check([area hasPrefix:[NSTemporaryDirectory() stringByAppendingPathComponent:@"yebaeon-app-tests-"]],@"cleanup scope");[NSFileManager.defaultManager removeItemAtPath:area error:NULL];return 0;
    }@catch(NSException *e){fprintf(stderr,"APP FAIL after %d: %s\n",checks,e.reason.UTF8String);return 1;}
}}

