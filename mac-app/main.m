#import "YBAppUI.h"
#import "PPSPlaylistController.h"
#import "YBDocumentsController.h"
#import "YBMediaController.h"
#import "YBServerPlaylistsController.h"
@interface YBCanvas : NSView
@end
@implementation YBCanvas
- (BOOL)isFlipped {return YES;}
@end
@interface YBAppDelegate : NSObject <NSApplicationDelegate,NSWindowDelegate>
@property NSWindow *window;
@property NSTabView *tabs;
@property NSTextField *status;
@property YBWork *work;
@property NSMapTable *controlStates;
@property PPSPlaylistController *playlist;
@property YBDocumentsController *documents;
@property YBMediaController *media;
@property YBServerPlaylistsController *serverPlaylists;
@end
@implementation YBAppDelegate
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    NSMenu *menu=[NSMenu new],*application=[NSMenu new],*edit=[NSMenu new];NSMenuItem *appItem=[NSMenuItem new],*editItem=[NSMenuItem new];[menu addItem:appItem];[menu addItem:editItem];appItem.submenu=application;editItem.submenu=edit;edit.title=@"편집";
    [application addItemWithTitle:@"예배온 Sync 종료" action:@selector(terminate:) keyEquivalent:@"q"];
    [edit addItemWithTitle:@"잘라내기" action:@selector(cut:) keyEquivalent:@"x"];[edit addItemWithTitle:@"복사" action:@selector(copy:) keyEquivalent:@"c"];[edit addItemWithTitle:@"붙여넣기" action:@selector(paste:) keyEquivalent:@"v"];[edit addItemWithTitle:@"전체 선택" action:@selector(selectAll:) keyEquivalent:@"a"];NSApp.mainMenu=menu;
    NSRect screen=NSScreen.mainScreen.visibleFrame;NSRect frame=NSMakeRect(0,0,MIN(1120,screen.size.width-40),MIN(825,screen.size.height-60));
    self.window=[[NSWindow alloc] initWithContentRect:frame styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];self.window.title=@"예배온 Sync";self.window.minSize=NSMakeSize(880,620);self.window.delegate=self;[self.window center];
    self.controlStates=[NSMapTable weakToStrongObjectsMapTable];self.work=[YBWork new];self.playlist=[PPSPlaylistController new];self.documents=[[YBDocumentsController alloc] initWithWork:self.work];self.media=[[YBMediaController alloc] initWithWork:self.work documentsRoot:self.documents.documentsRoot];
    self.serverPlaylists=[[YBServerPlaylistsController alloc] initWithWork:self.work documents:self.documents];
    __weak YBAppDelegate *weakSelf=self;self.documents.rootChanged=^(NSString *root){[weakSelf.media setDocumentsRoot:root];[weakSelf.serverPlaylists rootChanged];};
    self.tabs=[[NSTabView alloc] initWithFrame:NSMakeRect(10,34,frame.size.width-20,frame.size.height-44)];self.tabs.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;
    NSArray *labels=@[@"서버 재생목록",@"문서",@"미디어",@"로컬 재생목록 비교"],*views=@[self.serverPlaylists.view,self.documents.view,self.media.view,self.playlist.view];
    for(NSUInteger i=0;i<labels.count;i++) {
        NSTabViewItem *item=[[NSTabViewItem alloc] initWithIdentifier:labels[i]];item.label=labels[i];
        NSScrollView *scroll=[[NSScrollView alloc] initWithFrame:NSMakeRect(0,0,1060,720)];scroll.hasVerticalScroller=YES;scroll.hasHorizontalScroller=YES;scroll.autohidesScrollers=YES;scroll.drawsBackground=YES;
        YBCanvas *canvas=[[YBCanvas alloc] initWithFrame:NSMakeRect(0,0,1060,720)];[canvas addSubview:views[i]];scroll.documentView=canvas;item.view=scroll;[self.tabs addTabViewItem:item];
    }
    [self.window.contentView addSubview:self.tabs];self.status=YBLabel(@"예배온 Studio와 교회 Mac을 연결합니다.",NSMakeRect(22,7,frame.size.width-44,22),12,NO);self.status.autoresizingMask=NSViewWidthSizable;self.status.textColor=NSColor.secondaryLabelColor;[self.window.contentView addSubview:self.status];
    self.work.busyChanged=^(BOOL busy) {
        YBAppDelegate *app=weakSelf;[app enableView:app.serverPlaylists.view enabled:!busy];[app enableView:app.playlist.view enabled:!busy];[app enableView:app.documents.view enabled:!busy];[app enableView:app.media.view enabled:!busy];
        app.status.stringValue=busy ? @"작업 중입니다. 완료될 때까지 앱을 열어 두세요." : @"예배온 Studio와 교회 Mac을 연결합니다.";
    };
    [self.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];
}
- (void)enableView:(NSView *)view enabled:(BOOL)enabled {
    if([view isKindOfClass:NSControl.class]) {NSControl *control=(NSControl *)view;if(!enabled)[self.controlStates setObject:@(control.enabled) forKey:control];NSNumber *previous=[self.controlStates objectForKey:control];control.enabled=enabled ? (previous ? previous.boolValue : YES) : NO;}
    for(NSView *child in view.subviews)[self enableView:child enabled:enabled];
    if(enabled && [view isKindOfClass:NSTableView.class])[(NSTableView *)view reloadData];
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)app {return YES;}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)app {if(self.work.busy){YBAlert(@"작업 중입니다.",@"송수신·점검이 끝난 후 종료해 주세요.");return NSTerminateCancel;}return NSTerminateNow;}
- (BOOL)windowShouldClose:(NSWindow *)window {return [self applicationShouldTerminate:NSApp]==NSTerminateNow;}
@end
int main(int argc,const char *argv[]) {@autoreleasepool {NSApplication *app=NSApplication.sharedApplication;YBAppDelegate *delegate=[YBAppDelegate new];app.delegate=delegate;[app setActivationPolicy:NSApplicationActivationPolicyRegular];[app run];}return 0;}
