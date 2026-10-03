#import "YBDocumentComparison.h"
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
#import <signal.h>
#import <execinfo.h>
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
- (void)updateReceiveAll;
- (NSView *)comparisonView:(NSDictionary *)comparison;
- (NSArray *)recoveryRecordsForSync:(YBSync *)sync jobs:(NSArray *)jobs;
- (NSView *)recoveryView;
@end
@interface YBMediaController (Tests)
- (void)filter;
@end

@interface YBProgressLibrary : YBLibrary
@property NSUInteger calls;
@property(nonatomic,strong) dispatch_semaphore_t gate;
@property NSArray *syntheticRows;
@end
@implementation YBProgressLibrary
- (NSArray *)refreshChecking:(void (^)(void))check {
    self.calls++;if(self.rowsCompared)self.rowsCompared(@[self.syntheticRows[0]]);
    if(self.calls==1){dispatch_semaphore_wait(self.gate,dispatch_time(DISPATCH_TIME_NOW,3*NSEC_PER_SEC));if(check)check();}
    return self.syntheticRows;
}
@end
@interface YBProgressController : YBDocumentsController
@property YBProgressLibrary *fake;
@end
@implementation YBProgressController
- (YBLibrary *)connectedLibrary {return self.fake;}
@end
static int checks=0;
static void Crash(int code){void *frames[64];int n=backtrace(frames,64);fprintf(stderr,"APP CRASH signal=%d after check=%d\n",code,checks);backtrace_symbols_fd(frames,n,STDERR_FILENO);_exit(128+code);}
static void Check(BOOL ok,NSString *message) {checks++;fprintf(stderr,"APP CHECK %d: %s\n",checks,message.UTF8String);YBRequire(ok,message);}
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
static void CheckButtons(NSView *view) {
    for(NSView *v in view.subviews){if(v.hidden)continue;if([v isKindOfClass:NSButton.class]){NSButton *b=(id)v;if(b.title.length)Check(b.cell.cellSize.width<=b.frame.size.width+2,[@"button title fits: " stringByAppendingString:b.title]);else {NSRect imageRect=[b.cell imageRectForBounds:b.bounds];Check(b.image && imageRect.size.width>0 && imageRect.size.height>0 && NSContainsRect(b.bounds,imageRect),@"icon button image fits");}}if(![v isKindOfClass:NSScrollView.class])[v layoutSubtreeIfNeeded];}
}
static void PumpUntil(BOOL (^condition)(void),NSTimeInterval seconds) {NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:seconds];while(!condition() && deadline.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.01]];Check(condition(),@"async condition completed before deadline");}
int main(void) {@autoreleasepool {
    signal(SIGSEGV,Crash);signal(SIGABRT,Crash);setbuf(stderr,NULL);
    NSString *area=[NSTemporaryDirectory() stringByAppendingPathComponent:[@"yebaeon-app-tests-" stringByAppendingString:NSUUID.UUID.UUIDString]];
    @try {
        [NSApplication sharedApplication];YBSetTestPreferencesDirectory([area stringByAppendingPathComponent:@"settings"]);
        YBSavePreferences(@"documents-settings.json",@{@"root":[area stringByAppendingPathComponent:@"ui-documents"]});
        YBSavePreferences(@"media-settings.json",@{@"roots":@[[area stringByAppendingPathComponent:@"ui-media"]]});
        {
            NSString *root=[area stringByAppendingPathComponent:@"reset-documents"],*origin=@"https://example.test",*profile=YBProfilePath(root,origin);
            YBSync *sync=[[YBSync alloc] initWithRoot:root profile:profile origin:origin];sync.presenterRunning=^BOOL{return NO;};
            NSData *bytes=Document(@[]);Put([root stringByAppendingPathComponent:@"현재.pro6"],bytes);
            NSDictionary *metadata=@{@"id":@"11111111-1111-4111-a111-111111111111",@"path":@"현재.pro6",@"sha256":YBHash(bytes),@"version":@1,@"size":@(bytes.length)};
            [sync acknowledge:metadata expectedLocalHash:YBHash(bytes)];YBWriteSafeFile(profile,@"playlist-state-fixture.json",[@"{}" dataUsingEncoding:NSUTF8StringEncoding],0600,nil);
            sync.presenterRunning=^BOOL{return YES;};Reject(^{YBStartFreshProfile(sync,origin);},@"reset refuses running presenter");Check([YBProfilePath(root,origin) isEqual:profile],@"failed reset keeps active generation");sync.presenterRunning=^BOOL{return NO;};
            YBWriteSafeFile(profile,@"playlist-active.json",[@"{\"status\":\"applying\"}" dataUsingEncoding:NSUTF8StringEncoding],0600,nil);Reject(^{YBStartFreshProfile(sync,origin);},@"reset cannot hide interrupted apply");
            YBWriteSafeFile(profile,@"playlist-active.json",[@"{\"status\":\"complete\"}" dataUsingEncoding:NSUTF8StringEncoding],0600,nil);
            Check([YBStartFreshProfile(sync,origin) isEqual:profile],@"reset reports isolated old profile");[sync close];
            NSString *fresh=YBProfilePath(root,origin);Check(![fresh isEqual:profile] && [YBProfilePath(root,@"https://other.test") rangeOfString: fresh.lastPathComponent].location==NSNotFound,@"reset is scoped to folder and server");
            YBSync *again=[[YBSync alloc] initWithRoot:root profile:fresh origin:origin];again.presenterRunning=^BOOL{return NO;};NSArray *rows=[again plan:@[]];
            Check(again.entries.count==0 && rows.count==1 && [rows[0][@"status"] isEqual:@"upload"],@"fresh state sends actual local document to empty server");
            Check([[again readDocument:@"현재.pro6"] isEqual:bytes] && YBReadSafeFile(profile,@"state.json",NULL)!=nil && YBReadSafeFile(fresh,@"playlist-state-fixture.json",NULL)==nil,@"reset preserves originals and isolates playlist history");[again close];
        }
        {
            NSMutableParagraphStyle *paragraph=[NSMutableParagraphStyle new];paragraph.alignment=NSTextAlignmentCenter;
            NSAttributedString *(^words)(NSString *)=^NSAttributedString *(NSString *s){return [[NSAttributedString alloc] initWithString:s attributes:@{NSFontAttributeName:[NSFont boldSystemFontOfSize:52],NSForegroundColorAttributeName:NSColor.whiteColor,NSParagraphStyleAttributeName:paragraph}];};
            NSDictionary *(^parse)(NSString *,NSString *)=^NSDictionary *(NSString *wordsText,NSString *extra){NSAttributedString *rtf=words(wordsText);NSString *b64=[[rtf RTFFromRange:NSMakeRange(0,rtf.length) documentAttributes:@{}] base64EncodedStringWithOptions:0];NSString *xml=[NSString stringWithFormat:@"<RVPresentationDocument width='1280' height='720'><RVSlideGrouping uuid='g' name='찬양'><RVDisplaySlide UUID='a'><RVTextElement><RVRect3D rvXMLIvarName='position'>{80 180 0 1120 420}</RVRect3D><NSString rvXMLIvarName='RTFData'>%@</NSString></RVTextElement></RVDisplaySlide>%@</RVSlideGrouping></RVPresentationDocument>",b64,extra];return PP6ParseDocumentData([xml dataUsingEncoding:NSUTF8StringEncoding],@"합성.pro6",@[],@{},@[],@{},YES);};
            NSDictionary *a=parse(@"주님의 사랑\n우리를 지키시네",@"<RVDisplaySlide UUID='old' label='Mac 전용'/>");
            NSDictionary *b=parse(@"주님의 은혜\n우리를 지키시네\n함께 찬양해",@"<RVDisplaySlide UUID='new' label='서버 추가' enabled='false'/>");
            NSArray *rows=YBComparisonRows(a,b);Check(rows.count>=2 && [rows[0][@"changed"] boolValue],@"visual comparison matches changed slides");
            Check(YBComparisonRows(a,@{}).count==2 && YBComparisonRows(@{},b).count==2,@"visual comparison includes entirely missing groups");
            NSAttributedString *marked=YBHighlightedLines(@"같음\n추가",@"같음",YES);Check([marked.string containsString:@"+ 추가"] && [marked attribute:NSBackgroundColorAttributeName atIndex:marked.length-2 effectiveRange:NULL]!=nil,@"added lines have visible sign and highlight");
            Check([YBHighlightedLines(@"삭제\n같음",@"같음",NO).string containsString:@"− 삭제"],@"deleted lines visibly marked");
            Render([[YBDocumentComparison alloc] initWithLocal:a remote:b],@"05-document-conflict");
            Render([[YBDocumentComparison alloc] initWithLocal:a remote:@{}],@"06-document-server-empty");
        }
        YBServer *offline=[[YBServer alloc] initWithOrigin:@"https://example.test" allowLocalTestServer:NO];
        Reject(^{[offline request:@"/api/session" method:@"GET" body:nil headers:nil];},@"GUI network guard");
        Reject(^{[offline loadSession];},@"GUI keychain read guard");
        offline.cookie=@"synthetic";
        Reject(^{[offline saveSession];},@"GUI keychain write guard");
        Reject(^{[offline forgetSession];},@"GUI keychain delete guard");
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
        NSString *imageDocs=[area stringByAppendingPathComponent:@"image-preparation"],*literal=[media stringByAppendingPathComponent:@"literal%3A.png"],*different=[media stringByAppendingPathComponent:@"different/exact.jpg"];
        Put(literal,image);Put(different,[@"different-image" dataUsingEncoding:NSUTF8StringEncoding]);
        Put([imageDocs stringByAppendingPathComponent:@"one.pro6"],Document(@[sources[0],literal,[NSURL fileURLWithPath:literal].absoluteString,@"file:///missing/one-time.mov"]));
        NSString *videoElementImages=[[NSString alloc] initWithData:Document(@[sources[0],[NSURL fileURLWithPath:different].absoluteString]) encoding:NSUTF8StringEncoding];
        Put([imageDocs stringByAppendingPathComponent:@"two.pro6"],[[videoElementImages stringByReplacingOccurrencesOfString:@"RVImageElement" withString:@"RVVideoElement"] dataUsingEncoding:NSUTF8StringEncoding]);
        NSDictionary *imagePlan=YBImagePreparationReport(imageDocs,@[media],nil);
        Check([imagePlan[@"prepared"] boolValue] && [imagePlan[@"documents"] isEqual:@2] && [imagePlan[@"assets"] isEqual:@2] && [imagePlan[@"sourceFiles"] isEqual:@3] && [imagePlan[@"duplicateBytes"] unsignedIntegerValue]==image.length && ![imagePlan[@"serverVerified"] boolValue],@"all document images deduplicate exact content, preserve different same-name images and decode percent paths once");
        Check([imagePlan[@"excludedVideos"] isEqual:@1] && ![imagePlan[@"unresolved"] unsignedIntegerValue],@"missing one-time video is excluded without blocking image readiness");
        Put([imageDocs stringByAppendingPathComponent:@"missing.pro6"],Document(@[sources[1]]));
        imagePlan=YBImagePreparationReport(imageDocs,@[media],nil);Check(![imagePlan[@"prepared"] boolValue] && [imagePlan[@"unresolved"] isEqual:@1],@"same-name relocation is not silently promoted to upload identity");
        NSString *changingDocs=[area stringByAppendingPathComponent:@"changing-image-docs"],*changing=[media stringByAppendingPathComponent:@"changing.png"];
        Put(changing,image);Put([changingDocs stringByAppendingPathComponent:@"change.pro6"],Document(@[[NSURL fileURLWithPath:changing].absoluteString]));__block NSUInteger mediaChecks=0;
        NSDictionary *changingPlan=YBImagePreparationReport(changingDocs,@[media],^{if(++mediaChecks==2)[@"changed during read" writeToFile:changing atomically:YES encoding:NSUTF8StringEncoding error:NULL];});
        Check(![changingPlan[@"prepared"] boolValue] && [changingPlan[@"unresolved"] isEqual:@1],@"changed image during hashing never becomes prepared");
        Put([changingDocs stringByAppendingPathComponent:@"outside-slide.pro6"],[@"<RVPresentationDocument><RVImageElement source=\"file:///missing/outside.png\"/></RVPresentationDocument>" dataUsingEncoding:NSUTF8StringEncoding]);
        Check([YBImagePreparationReport(changingDocs,@[media],nil)[@"errors"] count]>0,@"unrecognized image coverage stays incomplete");
        NSDictionary *parsed=PP6ParseDocumentData(doc,@"말씀.pro6",@[media],PP6BuildMediaIndex(@[media]),@[],@{},YES);Check([parsed[@"slideCount"] isEqual:@4],@"Core data preview");
        NSDictionary *changed=PP6ParseDocumentData(Document(@[sources[0],sources[1]]),@"말씀.pro6",@[],@{},@[],@{},YES);NSDictionary *diff=PP6CompareParsedDocuments(parsed,changed);Check([diff[@"counts"][@"deleted"] isEqual:@2],@"Core slide comparison integrated");
        Check([PP6ParseDocumentData([@"<!DOCTYPE RVPresentationDocument><RVPresentationDocument/>" dataUsingEncoding:NSUTF8StringEncoding],@"bad.pro6",@[],@{},@[],@{},NO)[@"parseError"] length]>0,@"Core rejects external entities");
        YBWork *work=[YBWork new];YBDocumentsController *controller=[[YBDocumentsController alloc] initWithWork:work];NSMutableArray *rows=[NSMutableArray array];
        NSArray *statuses=@[@"download",@"upload",@"same",@"conflict"],*paths=@[@"주일예배/말씀.pro6",@"찬양/찬송.pro6",@"예배순서/안내.pro6",@"수요예배/기도.pro6"];
        for(NSUInteger i=0;i<statuses.count;i++)[rows addObject:@{@"path":paths[i],@"status":statuses[i],@"localHash":NSNull.null,@"remote":i==1 ? (id)NSNull.null : @{@"version":@(i+1),@"updatedBy":@"예배 준비팀"}}];
        [controller acceptRows:rows];Check([[controller valueForKey:@"visibleRows"] count]==4,@"document UI row binding");[controller setValue:@"말씀" forKeyPath:@"search.stringValue"];[controller performSelector:@selector(filter)];Check([[controller valueForKey:@"visibleRows"] count]==1,@"document search");[controller setValue:@"" forKeyPath:@"search.stringValue"];[controller performSelector:@selector(filter)];Render(controller.view,@"documents");
        [controller acceptRows:@[rows[1]]];NSButton *all=[controller valueForKey:@"allButton"];Check(all.enabled,@"all tab allows selecting local-only uploads");[all performClick:nil];Check([[controller valueForKey:@"checked"] count]==1 && [[controller valueForKey:@"applyButton"] isEnabled],@"actual select-all click enables upload without changing tab");Render(controller.view,@"06-all-tab-upload");
        [controller setValue:@3 forKeyPath:@"direction.selectedSegment"];[controller acceptRows:@[rows[3]]];NSTableView *conflictTable=[controller valueForKey:@"table"];[conflictTable selectRowIndexes:[NSIndexSet indexSetWithIndex:0] byExtendingSelection:NO];Check([[controller valueForKey:@"applyButton"] isEnabled],@"selecting conflict row enables comparison action");NSView *conflictAction=[conflictTable viewAtColumn:1 row:0 makeIfNecessary:YES];Check([conflictAction isKindOfClass:NSButton.class] && [(NSButton *)conflictAction isEnabled],@"conflict status has a clickable resolution button");Check(![(NSTextField *)[conflictTable viewAtColumn:2 row:0 makeIfNecessary:YES] isSelectable],@"document name cannot intercept row selection");Render(controller.view,@"07-document-resolve-action");[controller setValue:@0 forKeyPath:@"direction.selectedSegment"];[controller acceptRows:rows];
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
        YBMediaController *mediaUI=[[YBMediaController alloc] initWithWork:work documentsRoot:documents];[mediaUI setValue:report forKey:@"report"];[mediaUI filter];Check([[mediaUI valueForKey:@"visibleRows"] count]==4,@"media UI binding");[mediaUI setValue:@1 forKeyPath:@"problemsOnly.state"];[mediaUI filter];Check([[mediaUI valueForKey:@"visibleRows"] count]==3,@"media problem filter");[mediaUI setValue:@0 forKeyPath:@"problemsOnly.state"];[mediaUI setValue:imagePlan forKey:@"report"];[mediaUI filter];Render(mediaUI.view,@"media");
        YBServerPlaylistsController *serverUI=[[YBServerPlaylistsController alloc] initWithWork:work documents:controller];
        [serverUI setValue:@{@"ready":@YES,@"orderChanged":@YES,@"rows":@[@{@"path":@"찬양/공유 찬양.pro6",@"status":@"download"}],@"manifest":@{@"playlist":@{@"name":@"주일 1부 예배"},@"items":@[@{@"name":@"공유 찬양",@"kind":@"document",@"path":@"찬양/공유 찬양.pro6",@"sharedWith":@[@"주일 2부 예배"]}]}} forKey:@"comparison"];
        NSDictionary *uiComparison=[serverUI valueForKey:@"comparison"];[serverUI setValue:[@{@"lib/order":uiComparison} mutableCopy] forKey:@"comparisons"];[serverUI acceptLibraries:@[@{@"id":@"lib",@"path":@"기본 .pro6pl",@"updatedAt":@"2026-10-01",@"playlists":@[@{@"id":@"order",@"name":@"주일 1부 예배"}]}]];[serverUI acceptComparison:uiComparison];
        Check([[serverUI valueForKey:@"receiveAllButton"] isEnabled],@"ready changed playlist enables receive all without recursion");
        [serverUI setValue:[NSMutableDictionary dictionary] forKey:@"comparisons"];[serverUI acceptComparison:uiComparison];
        Check(![[serverUI valueForKey:@"receiveAllButton"] isEnabled],@"acceptComparison refreshes receive all after results cleared");
        [serverUI setValue:[@{@"blocked":@{@"ready":@NO,@"orderChanged":@YES},@"same":@{@"ready":@YES,@"rows":@[],@"orderChanged":@NO}} mutableCopy] forKey:@"comparisons"];[serverUI updateReceiveAll];
        Check(![[serverUI valueForKey:@"receiveAllButton"] isEnabled],@"blocked and unchanged playlists cannot enable receive all");
        [serverUI setValue:[@{@"lib/order":uiComparison} mutableCopy] forKey:@"comparisons"];[serverUI acceptComparison:uiComparison];
        NSArray *twoLists=@[@{@"id":@"lib",@"path":@"기본 .pro6pl",@"playlists":@[@{@"id":@"one",@"name":@"첫 예배"},@{@"id":@"order",@"name":@"선택 예배"}]}];
        [serverUI acceptLibraries:twoLists];NSTableView *choices=[serverUI valueForKey:@"listTable"];[choices selectRowIndexes:[NSIndexSet indexSetWithIndex:1] byExtendingSelection:NO];[serverUI acceptLibraries:twoLists];Check(choices.selectedRow==1,@"selected playlist ID survives list refresh");
        NSTextField *choiceText=(id)[choices viewAtColumn:0 row:1 makeIfNecessary:YES];Check(!choiceText.selectable,@"playlist text cannot steal row selection clicks");
        NSMutableDictionary *blocked=[uiComparison mutableCopy];blocked[@"ready"]=@NO;blocked[@"issues"]=@[@"Mac도 바뀜"];[serverUI acceptComparison:blocked];Check([[serverUI valueForKey:@"receiveButton"] isEnabled] && [[[serverUI valueForKey:@"receiveButton"] title] containsString:@"해결"],@"conflict offers an enabled resolution action");[serverUI acceptComparison:uiComparison];
        NSDictionary *sideBySide=@{@"localNode":@{@"items":@[@{@"attrs":@{@"UUID":@"a",@"displayName":@"첫 화면"}},@{@"attrs":@{@"UUID":@"b",@"displayName":@"Mac 찬양"}}]},@"manifest":@{@"playlist":@{@"name":@"합성 예배"},@"items":@[@{@"id":@"a",@"name":@"첫 화면",@"path":@"first.pro6",@"issue":@"missing"},@{@"id":@"c",@"name":@"서버 찬양",@"path":@"song.pro6",@"issue":NSNull.null}]},@"rows":@[@{@"path":@"first.pro6",@"status":@"upload",@"remote":NSNull.null,@"localHash":@"test"}]};
        NSView *sideView=[serverUI comparisonView:sideBySide];Check([[serverUI valueForKey:@"comparisonRows"] count]==2,@"playlist comparison binds parallel order rows");Render(sideView,@"08-playlist-parallel-comparison");[controller setValue:@"hidden search" forKeyPath:@"search.stringValue"];[controller showComparisonDocuments:sideBySide];Check([[controller valueForKey:@"visibleRows"] count]==1 && [[controller valueForKey:@"allButton"] isEnabled],@"playlist document navigation clears stale filters and exposes upload");
        [controller acceptRows:@[]];[controller acceptPriorityComparisons:@[@{@"rows":rows}]];Check([[controller valueForKey:@"rows"] count]==4,@"priority documents are available before full comparison");[controller selectAllUploads:nil];[controller mergeComparedRows:@[@{@"path":@"later.pro6",@"status":@"same",@"localHash":NSNull.null,@"remote":NSNull.null}]];Check([[controller valueForKey:@"rows"] count]==5 && [[controller valueForKey:@"checked"] containsObject:paths[1]],@"incremental results preserve checked upload");
        [[serverUI valueForKey:@"table"] reloadData];Check([[serverUI valueForKey:@"table"] numberOfRows]==1,@"server playlist UI row binding");Render(serverUI.view,@"server-playlists");
        YBSync *recoverySync=[[YBSync alloc] initWithRoot:[area stringByAppendingPathComponent:@"recovery-docs"] profile:[area stringByAppendingPathComponent:@"recovery-profile"] origin:@"https://example.test"];recoverySync.presenterRunning=^BOOL{return NO;};[recoverySync beginBackupBatch:@"documents" playlistJob:nil];for(NSString *path in @[@"찬양.pro6",@"말씀.pro6"])[recoverySync apply:doc document:@{@"id":NSUUID.UUID.UUIDString.lowercaseString,@"path":path,@"version":@1,@"sha256":YBHash(doc),@"size":@(doc.length),@"updatedBy":@"테스트",@"updatedAt":@"2026-10-01"} expectedLocalHash:nil];[recoverySync endBackupBatch:YES];NSArray *records=[serverUI recoveryRecordsForSync:recoverySync jobs:@[]];Check(records.count==1 && [records[0][@"members"] count]==2,@"recovery list groups documents by operation without duplicate rows");[serverUI setValue:records forKey:@"recoveryRecords"];NSView *recovery=[serverUI recoveryView];[[serverUI valueForKey:@"recoveryTable"] selectRowIndexes:[NSIndexSet indexSetWithIndex:0] byExtendingSelection:NO];NSTableView *recoveryTable=[serverUI valueForKey:@"recoveryTable"];NSTextField *targetCell=(NSTextField *)[recoveryTable viewAtColumn:1 row:0 makeIfNecessary:YES];Check([targetCell.stringValue isEqual:@"문서 받기"],@"recovery cells render the selected batch, not playlist preview data");Render(recovery,@"recovery");[recoverySync close];
        // Actual window: compare before / playlist / document / settings, including minimum size.
        YBAppDelegate *app=[YBAppDelegate new];[app applicationDidFinishLaunching:[NSNotification notificationWithName:NSApplicationDidFinishLaunchingNotification object:NSApp]];app.window.appearance=[NSAppearance appearanceNamed:NSAppearanceNameAqua];app.connectionText=@"지은 연결됨";[app updateConnection];
        Check([app.navigation isKindOfClass:NSSegmentedControl.class] && app.navigation.segmentCount==3 && app.navigation.trackingMode==NSSegmentSwitchTrackingSelectOne,@"navigation is one native segmented control");
        Check([app.compareButton.keyEquivalent isEqual:@"\r"],@"compare is the default before comparison");
        Check(![[app.serverPlaylists valueForKey:@"receiveButton"] isEnabled] && ![[app.serverPlaylists valueForKey:@"receiveAllButton"] isEnabled],@"receiving disabled before comparison");CaptureWindow(app.window,@"03-before-comparison");
        NSMutableDictionary *rich=[uiComparison mutableCopy];rich[@"manifest"]=@{@"playlist":@{@"name":@"금요예배",@"version":@8,@"updatedBy":@"지은",@"updatedAt":@"2026-10-02T12:40:00Z"},@"library":@{@"updatedAt":@"2026-10-02T12:40:00Z"},@"items":@[@{@"id":@"header",@"name":@"찬양",@"kind":@"header"},@{@"id":@"song",@"name":@"공유 찬양",@"kind":@"document",@"path":@"찬양/공유 찬양.pro6",@"sharedWith":@[@"주일 2부 예배"]},@{@"id":@"header2",@"name":@"말씀",@"kind":@"header"}]};
        rich[@"rows"]=@[@{@"path":@"찬양/공유 찬양.pro6",@"status":@"download",@"localHash":@"old",@"remote":@{@"updatedAt":@"2026-10-02T12:32:00Z",@"updatedBy":@"지은"}}];
        [app.serverPlaylists setValue:[@{@"lib/order":rich} mutableCopy] forKey:@"comparisons"];[app.serverPlaylists acceptLibraries:@[@{@"id":@"lib",@"path":@"기본 .pro6pl",@"playlists":@[@{@"id":@"order",@"name":@"금요예배",@"updatedAt":@"2026-10-02T12:40:00Z"}]}]];[app.serverPlaylists acceptComparison:rich];app.lastCompared=@"21:52";app.documents.checkStateChanged(@"전체 문서 점검",1204,3107,YES);
        Check([[[app.serverPlaylists valueForKey:@"receiveButton"] keyEquivalent] isEqual:@"\r"] && !app.compareButton.keyEquivalent.length,@"ready playlist moves default to receive");
        [app.documents acceptRows:rows];[app.documents selectAllUploads:nil];
        for(NSValue *size in @[[NSValue valueWithSize:NSMakeSize(1440,900)],[NSValue valueWithSize:NSMakeSize(1060,800)],[NSValue valueWithSize:NSMakeSize(880,620)]]){
            [app.window setFrame:NSMakeRect(app.window.frame.origin.x,app.window.frame.origin.y,size.sizeValue.width,size.sizeValue.height) display:YES];[app.window.contentView layoutSubtreeIfNeeded];
            for(NSTabViewItem *tab in app.tabs.tabViewItems){app.navigation.selectedSegment=[app.tabs.tabViewItems indexOfObject:tab];[app selectTab:app.navigation];[app.window.contentView layoutSubtreeIfNeeded];NSView *panel=tab.view;
                for(NSView *control in panel.subviews)if(!control.hidden){Check(NSContainsRect(NSInsetRect(panel.bounds,-1,-1),control.frame),[@"visible control within viewport: " stringByAppendingString:[control isKindOfClass:NSButton.class] ? [(NSButton *)control title] : control.className]);if([control isKindOfClass:NSScrollView.class])Check(control.frame.size.height>=80,@"table retains usable height");}
                CheckButtons(panel);CheckButtons(app.tabBar);CheckButtons(app.connectionBar);
                NSMutableArray *bottom=[NSMutableArray array];for(NSView *v in panel.subviews)if(!v.hidden && v.frame.origin.y<50 && [v isKindOfClass:NSButton.class])[bottom addObject:v];for(NSUInteger i=0;i<bottom.count;i++)for(NSUInteger j=i+1;j<bottom.count;j++)Check(!NSIntersectsRect([bottom[i] frame],[bottom[j] frame]),@"bottom decisions do not overlap");
                if([tab.label isEqual:@"재생목록"]){NSTableView *list=[app.serverPlaylists valueForKey:@"listTable"];CGFloat columns=0;for(NSTableColumn *col in list.tableColumns)columns+=col.width+list.intercellSpacing.width;Check(columns<=list.enclosingScrollView.contentSize.width+1,@"playlist changed-date column fits without horizontal clipping");}
                if([tab.label isEqual:@"문서"]){NSArray *filters=@[[app.documents valueForKey:@"direction"],[app.documents valueForKey:@"usedOnly"],[app.documents valueForKey:@"search"],[app.documents valueForKey:@"order"]];for(NSUInteger i=0;i<filters.count;i++)for(NSUInteger j=i+1;j<filters.count;j++)Check(!NSIntersectsRect([filters[i] frame],[filters[j] frame]),@"document filters do not overlap");Check([[[app.documents valueForKey:@"applyButton"] keyEquivalent] isEqual:@"\r"] && !app.compareButton.keyEquivalent.length,@"document selection owns default");}
                CaptureWindow(app.window,[NSString stringWithFormat:@"window-%@-%d",tab.label,(int)size.sizeValue.width]);
                if(size.sizeValue.width==1440 && [tab.label isEqual:@"재생목록"])CaptureWindow(app.window,@"01-playlists");
                if(size.sizeValue.width==1440 && [tab.label isEqual:@"문서"])CaptureWindow(app.window,@"02-documents");
            }
        }
        [app.documents setValue:@0 forKeyPath:@"direction.selectedSegment"];[app.documents performSelector:@selector(directionChanged:) withObject:nil];app.navigation.selectedSegment=1;[app selectTab:app.navigation];
        Check([app.compareButton.keyEquivalent isEqual:@"\r"] && ![[app.documents valueForKey:@"applyButton"] isEnabled],@"all filter keeps transfer disabled and compare default");
        [app showSettings:nil];Check(app.settingsSheet.sheetParent==app.window,@"settings is attached sheet");Check(app.window.defaultButtonCell==nil,@"parent has no default while sheet is open");Check(app.settingsSheet.defaultButtonCell==app.settingsClose.cell,@"sheet default cell is close");Check([app.settingsClose.keyEquivalent isEqual:@"\r"],[NSString stringWithFormat:@"sheet close owns Return (key=%@)",app.settingsClose.keyEquivalent]);CheckButtons(app.settingsSheet.contentView);
        Check([app.documentPath.stringValue isEqual:app.documents.documentsRoot],@"settings path is actual current path");
        BOOL sawPlaylist=NO,sawRoot=NO,sawLogin=NO,sawLogout=NO,sawMedia=NO,sawBackup=NO;
        for(NSView *v in app.settingsSheet.contentView.subviews)if([v isKindOfClass:NSButton.class]){NSButton *button=(id)v;if(button.action==@selector(chooseFile:))sawPlaylist=button.target==app.serverPlaylists;if(button.action==@selector(chooseRoot:))sawRoot=button.target==app.documents;if(button.action==@selector(login:))sawLogin=button.target==app.documents;if(button.action==@selector(logout:))sawLogout=button.target==app.documents;if(button.action==@selector(addRoot:))sawMedia=button.target==app.media;if(button.action==@selector(openBackupFolder:))sawBackup=button.target==app.serverPlaylists;}
        Check(sawPlaylist && sawRoot && sawLogin && sawLogout && sawMedia && sawBackup,@"settings calls existing actions");CaptureWindow(app.settingsSheet,@"04-settings");
        __block BOOL heldDone=NO;dispatch_semaphore_t held=dispatch_semaphore_create(0);
        [app.work runPausable:YES task:^id{dispatch_semaphore_wait(held,dispatch_time(DISPATCH_TIME_NOW,4*NSEC_PER_SEC));[app.work checkpoint];return @YES;} completion:^(id result,NSString *error){heldDone=YES;}];
        Check(!app.settingsButton.enabled && !app.compareButton.enabled && app.pauseButton.enabled,@"busy locks relocated settings/compare while pause stays usable");
        for(NSView *v in app.settingsSheet.contentView.subviews)if([v isKindOfClass:NSButton.class] && v!=app.settingsClose)Check(![(NSButton *)v isEnabled],@"busy locks all setting mutations");
        [app.work togglePause:nil];dispatch_semaphore_signal(held);PumpUntil(^BOOL{return app.work.paused;},3);[app updateConnection];Check(!heldDone && [app.pauseButton.title isEqual:@"재개"],@"pause waits at safe boundary and offers resume");
        [app.work togglePause:nil];PumpUntil(^BOOL{return heldDone;},3);Check(app.settingsButton.enabled && !app.work.pauseRequested,@"resume completes and restores controls");[app closeSettings:nil];PumpUntil(^BOOL{return !app.settingsSheet.sheetParent;},3);[app updateDefaultButton];
        Check(!app.settingsSheet.sheetParent && [app.compareButton.keyEquivalent isEqual:@"\r"],@"closing sheet restores correct default");
        Check([YBDisplayDate(@"2026-10-01T23:43:12.456Z") containsString:@"8:43"],@"server date is converted to Seoul without milliseconds");

        YBWork *progressWork=[YBWork new];YBProgressController *progressUI=[[YBProgressController alloc] initWithWork:progressWork];YBProgressLibrary *fake=[YBProgressLibrary new];fake.gate=dispatch_semaphore_create(0);fake.syntheticRows=rows;progressUI.fake=fake;
        __weak YBProgressController *weakProgress=progressUI;progressWork.idle=^{[weakProgress resumeBackgroundIfNeeded];};[progressUI backgroundCompare];
        PumpUntil(^BOOL{return [[progressUI valueForKey:@"rows"] count]>0;},3);Check([[progressUI valueForKey:@"rows"] count]==1,@"background publishes usable partial results");
        __block BOOL foregroundFinished=NO;[progressWork run:^id{return @YES;} completion:^(id value,NSString *error){foregroundFinished=YES;}];dispatch_semaphore_signal(fake.gate);
        PumpUntil(^BOOL{return foregroundFinished && fake.calls==2 && !progressWork.backgroundActive;},3);Check([[progressUI valueForKey:@"rows"] count]==rows.count,@"foreground completion automatically resumes remaining comparison without button press");
        [app.window orderOut:nil];
        [serverUI setValue:@{@"localNode":@{@"items":@[@{@"attrs":@{@"UUID":@"old",@"displayName":@"기존"}}]},@"manifest":@{@"items":@[@{@"id":@"new",@"name":@"추가"},@{@"id":@"old",@"name":@"기존"}]}} forKey:@"comparison"];
        NSArray *preview=[serverUI performSelector:@selector(previewItems)];Check([preview[0][@"composition"] isEqual:@"순서에 추가"] && [preview[1][@"composition"] isEqual:@""],@"adding a cue is independent of content, insertion alone does not mark old cue as moved");
        dispatch_semaphore_t entered=dispatch_semaphore_create(0),resume=dispatch_semaphore_create(0);__block BOOL backgroundExited=NO,foregroundDone=NO,cancelNotified=NO;
        [work runBackground:^id(BOOL (^cancelled)(void)){dispatch_semaphore_signal(entered);dispatch_semaphore_wait(resume,dispatch_time(DISPATCH_TIME_NOW,3*NSEC_PER_SEC));backgroundExited=YES;return @(cancelled());} completion:^(id result,NSString *error){cancelNotified=error.length>0;}];
        Check(dispatch_semaphore_wait(entered,dispatch_time(DISPATCH_TIME_NOW,3*NSEC_PER_SEC))==0 && !work.busy,@"background comparison leaves foreground controls available");
        [work run:^id{Check(backgroundExited,@"foreground transfer waits for comparison checkpoint");return @YES;} completion:^(id result,NSString *error){foregroundDone=YES;}];dispatch_semaphore_signal(resume);
        NSDate *priorityDeadline=[NSDate dateWithTimeIntervalSinceNow:3];while(!foregroundDone && priorityDeadline.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
        Check(foregroundDone && cancelNotified && !work.busy,@"user work cancels background and releases busy without stale result");
        __block BOOL pausedBackgroundEnded=NO,replacementDone=NO;
        dispatch_semaphore_t backgroundGate=dispatch_semaphore_create(0);
        [work runBackground:^id(BOOL (^cancelled)(void)){dispatch_semaphore_wait(backgroundGate,dispatch_time(DISPATCH_TIME_NOW,3*NSEC_PER_SEC));[work checkpoint];return @(cancelled());} completion:^(id result,NSString *error){pausedBackgroundEnded=error.length>0;}];
        [work togglePause:nil];dispatch_semaphore_signal(backgroundGate);PumpUntil(^BOOL{return work.paused;},3);
        [work run:^id{return @YES;} completion:^(id result,NSString *error){replacementDone=YES;}];PumpUntil(^BOOL{return replacementDone && pausedBackgroundEnded;},3);Check(!work.paused && !work.pauseRequested && !work.busy,@"foreground action wakes cancelled paused background without deadlock");
        __block BOOL finished=NO;__block NSString *failure=nil;
        [work run:^id {YBRequire(!NSThread.isMainThread,@"background worker");dispatch_async(dispatch_get_main_queue(),^{work.message=@"전송 완료 · 상태 확인 마무리";});return @42;} completion:^(id result,NSString *error){Check(NSThread.isMainThread && [result isEqual:@42] && !error && !work.busy && !work.message,@"UI completion releases busy and phase on main thread");finished=YES;}];
        NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:3];while(!finished && deadline.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];Check(finished && !work.busy,@"async UI work completes");
        finished=NO;[work run:^id {YBRequire(NO,@"test failure");return nil;} completion:^(id result,NSString *error){failure=error;finished=YES;}];deadline=[NSDate dateWithTimeIntervalSinceNow:3];while(!finished && deadline.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];Check([failure isEqual:@"test failure"] && !work.busy,@"async errors return safely");
        printf("Integrated app checks passed: %d\n",checks);Check([area hasPrefix:[NSTemporaryDirectory() stringByAppendingPathComponent:@"yebaeon-app-tests-"]],@"cleanup scope");[NSFileManager.defaultManager removeItemAtPath:area error:NULL];return 0;
    }@catch(NSException *e){fprintf(stderr,"APP FAIL after %d: %s\n",checks,e.reason.UTF8String);return 1;}
}}

