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
@property NSView *connectionBar;
@property NSTextField *documentPath;
@property NSTextField *playlistPath;
@property NSWindow *toolWindow;
@property NSString *connectionText;
@property NSString *lastCompared;
@end
@implementation YBAppDelegate
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    NSMenu *menu=[NSMenu new],*application=[NSMenu new],*edit=[NSMenu new];NSMenuItem *appItem=[NSMenuItem new],*editItem=[NSMenuItem new];[menu addItem:appItem];[menu addItem:editItem];appItem.submenu=application;editItem.submenu=edit;edit.title=@"편집";
    [application addItemWithTitle:@"예배온 Sync 종료" action:@selector(terminate:) keyEquivalent:@"q"];
    [edit addItemWithTitle:@"실행 취소" action:@selector(undo:) keyEquivalent:@"z"];NSMenuItem *redo=[edit addItemWithTitle:@"다시 실행" action:@selector(redo:) keyEquivalent:@"z"];redo.keyEquivalentModifierMask=NSEventModifierFlagCommand|NSEventModifierFlagShift;[edit addItem:NSMenuItem.separatorItem];
    [edit addItemWithTitle:@"잘라내기" action:@selector(cut:) keyEquivalent:@"x"];[edit addItemWithTitle:@"복사" action:@selector(copy:) keyEquivalent:@"c"];[edit addItemWithTitle:@"붙여넣기" action:@selector(paste:) keyEquivalent:@"v"];[edit addItemWithTitle:@"전체 선택" action:@selector(selectAll:) keyEquivalent:@"a"];NSApp.mainMenu=menu;
    NSRect screen=NSScreen.mainScreen.visibleFrame;NSRect frame=NSMakeRect(0,0,MIN(1060,screen.size.width-40),MIN(800,screen.size.height-60));
    self.window=[[NSWindow alloc] initWithContentRect:frame styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];self.window.title=@"예배온 Sync";self.window.minSize=NSMakeSize(880,620);self.window.delegate=self;[self.window center];
    self.controlStates=[NSMapTable weakToStrongObjectsMapTable];self.work=[YBWork new];self.playlist=[PPSPlaylistController new];self.documents=[[YBDocumentsController alloc] initWithWork:self.work];self.media=[[YBMediaController alloc] initWithWork:self.work documentsRoot:self.documents.documentsRoot];
    self.serverPlaylists=[[YBServerPlaylistsController alloc] initWithWork:self.work documents:self.documents];
    __weak YBAppDelegate *weakSelf=self;self.documents.rootChanged=^(NSString *root){[weakSelf.media setDocumentsRoot:root];[weakSelf.serverPlaylists rootChanged];weakSelf.documentPath.stringValue=root;weakSelf.documentPath.toolTip=root;[weakSelf.documents refresh:nil];};
    self.documents.sessionChanged=^(NSString *status){weakSelf.connectionText=status;[weakSelf updateConnection];};
    self.documents.comparisonFinished=^{NSDateFormatter *clock=[NSDateFormatter new];clock.dateFormat=@"HH:mm";weakSelf.lastCompared=[clock stringFromDate:NSDate.date];[weakSelf updateConnection];[weakSelf.serverPlaylists refresh:nil];};
    self.documents.showRecovery=^{[weakSelf.serverPlaylists restore:nil];};
    self.serverPlaylists.targetChanged=^(NSString *path){weakSelf.playlistPath.stringValue=path;weakSelf.playlistPath.toolTip=path;};
    NSMenu *file=[NSMenu new],*tools=[NSMenu new];NSMenuItem *fileItem=[NSMenuItem new],*toolsItem=[NSMenuItem new];[menu addItem:fileItem];[menu addItem:toolsItem];fileItem.submenu=file;toolsItem.submenu=tools;file.title=@"파일";tools.title=@"도구";
    NSMenuItem *login=[application insertItemWithTitle:@"입장 / 이름 변경…" action:@selector(login:) keyEquivalent:@"" atIndex:0];login.target=self.documents;NSMenuItem *logout=[application insertItemWithTitle:@"로그아웃" action:@selector(logout:) keyEquivalent:@"" atIndex:1];logout.target=self.documents;
    NSMenuItem *publish=[file addItemWithTitle:@"원본 재생목록과 문서 등록…" action:@selector(publish:) keyEquivalent:@""];publish.target=self.serverPlaylists;NSMenuItem *recover=[file addItemWithTitle:@"복구 기록…" action:@selector(restore:) keyEquivalent:@""];recover.target=self.serverPlaylists;
    NSMenuItem *legacy=[tools addItemWithTitle:@"로컬 재생목록 비교…" action:@selector(showLocal:) keyEquivalent:@""];legacy.target=self;
    self.connectionBar=[[NSView alloc] initWithFrame:NSMakeRect(12,frame.size.height-70,frame.size.width-24,62)];self.connectionBar.autoresizingMask=NSViewWidthSizable|NSViewMinYMargin;
    self.status=YBLabel(@"서버 연결 확인 중…",NSMakeRect(8,34,310,23),12,YES);[self.connectionBar addSubview:self.status];
    self.documentPath=YBLabel(self.documents.documentsRoot,NSMakeRect(90,4,300,23),11,NO);self.documentPath.toolTip=self.documents.documentsRoot;[self.connectionBar addSubview:YBLabel(@"문서 폴더",NSMakeRect(8,4,80,23),11,YES)];[self.connectionBar addSubview:self.documentPath];[self.connectionBar addSubview:YBButton(@"변경…",NSMakeRect(397,0,78,30),self.documents,@selector(chooseRoot:))];
    self.playlistPath=YBLabel(self.serverPlaylists.targetPath,NSMakeRect(572,4,300,23),11,NO);self.playlistPath.autoresizingMask=NSViewWidthSizable;self.playlistPath.toolTip=self.serverPlaylists.targetPath;[self.connectionBar addSubview:YBLabel(@"재생목록",NSMakeRect(492,4,78,23),11,YES)];[self.connectionBar addSubview:self.playlistPath];NSButton *choose=YBButton(@"변경…",NSMakeRect(frame.size.width-118,0,78,30),self.serverPlaylists,@selector(chooseFile:));choose.autoresizingMask=NSViewMinXMargin;[self.connectionBar addSubview:choose];[self.window.contentView addSubview:self.connectionBar];
    self.tabs=[[NSTabView alloc] initWithFrame:NSMakeRect(10,8,frame.size.width-20,frame.size.height-86)];self.tabs.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;
    NSArray *labels=@[@"재생목록",@"문서",@"미디어"],*views=@[self.serverPlaylists.view,self.documents.view,self.media.view];
    for(NSUInteger i=0;i<labels.count;i++) {
        NSTabViewItem *item=[[NSTabViewItem alloc] initWithIdentifier:labels[i]];item.label=labels[i];
        NSScrollView *scroll=[[NSScrollView alloc] initWithFrame:NSMakeRect(0,0,1060,720)];scroll.hasVerticalScroller=YES;scroll.hasHorizontalScroller=YES;scroll.autohidesScrollers=YES;scroll.drawsBackground=YES;
        YBCanvas *canvas=[[YBCanvas alloc] initWithFrame:NSMakeRect(0,0,1060,720)];[canvas addSubview:views[i]];scroll.documentView=canvas;item.view=scroll;[self.tabs addTabViewItem:item];
    }
    [self.window.contentView addSubview:self.tabs];
    self.work.busyChanged=^(BOOL busy) {
        YBAppDelegate *app=weakSelf;[app enableView:app.serverPlaylists.view enabled:!busy];[app enableView:app.playlist.view enabled:!busy];[app enableView:app.documents.view enabled:!busy];[app enableView:app.media.view enabled:!busy];
        [app enableView:app.connectionBar enabled:!busy];[app updateConnection];
    };
    [self.window makeKeyAndOrderFront:nil];
    [self.documents startupCompare];[NSApp activateIgnoringOtherApps:YES];
}
- (void)updateConnection {self.status.stringValue=[NSString stringWithFormat:@"%@%@%@",self.connectionText ?: @"서버 연결 확인",self.lastCompared ? [@" · 문서 비교 " stringByAppendingString:self.lastCompared] : @"",self.work.busy ? @" · 작업 중" : @""];self.status.toolTip=self.status.stringValue;}
- (void)showLocal:(id)sender {if(self.work.busy)return;if(!self.toolWindow){self.toolWindow=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,1060,720) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];self.toolWindow.releasedWhenClosed=NO;self.toolWindow.title=@"로컬 재생목록 비교";NSScrollView *scroll=[[NSScrollView alloc] initWithFrame:self.toolWindow.contentView.bounds];scroll.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;scroll.hasVerticalScroller=YES;scroll.hasHorizontalScroller=YES;scroll.documentView=self.playlist.view;[self.toolWindow.contentView addSubview:scroll];[self.toolWindow center];}[self.toolWindow makeKeyAndOrderFront:nil];}
- (BOOL)validateMenuItem:(NSMenuItem *)item {return !self.work.busy;}
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

