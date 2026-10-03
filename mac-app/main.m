#import "YBAppUI.h"
#import "PPSPlaylistController.h"
#import "YBDocumentsController.h"
#import "YBMediaController.h"
#import "YBServerPlaylistsController.h"
@interface YBCanvas : NSView
@end
@implementation YBCanvas
- (void)drawRect:(NSRect)rect {[NSColor.windowBackgroundColor setFill];NSRectFill(rect);}
@end
@interface YBAppDelegate : NSObject <NSApplicationDelegate,NSWindowDelegate>
@property NSWindow *window;
@property NSTabView *tabs;
@property NSView *tabBar;
@property NSSegmentedControl *navigation;
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
@property NSButton *compareButton;
@property NSButton *settingsButton;
@property NSButton *pauseButton;
@property NSTextField *checkLabel;
@property NSTextField *checkCount;
@property NSProgressIndicator *checkProgress;
@property NSString *checkMessage;
@property NSWindow *settingsSheet;
@property NSTextField *mediaPath;
@property NSTextField *backupPath;
@property NSTextField *entryLabel;
@property NSButton *settingsClose;
@property NSMutableArray *observedControls;
@property BOOL updatingPresentation;
@end
@implementation YBAppDelegate
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    NSMenu *menu=[NSMenu new],*application=[NSMenu new],*edit=[NSMenu new];NSMenuItem *appItem=[NSMenuItem new],*editItem=[NSMenuItem new];[menu addItem:appItem];[menu addItem:editItem];appItem.submenu=application;editItem.submenu=edit;edit.title=@"편집";
    [application addItemWithTitle:@"예배온 Sync 종료" action:@selector(terminate:) keyEquivalent:@"q"];
    [edit addItemWithTitle:@"실행 취소" action:@selector(undo:) keyEquivalent:@"z"];NSMenuItem *redo=[edit addItemWithTitle:@"다시 실행" action:@selector(redo:) keyEquivalent:@"z"];redo.keyEquivalentModifierMask=NSEventModifierFlagCommand|NSEventModifierFlagShift;[edit addItem:NSMenuItem.separatorItem];
    [edit addItemWithTitle:@"잘라내기" action:@selector(cut:) keyEquivalent:@"x"];[edit addItemWithTitle:@"복사" action:@selector(copy:) keyEquivalent:@"c"];[edit addItemWithTitle:@"붙여넣기" action:@selector(paste:) keyEquivalent:@"v"];[edit addItemWithTitle:@"전체 선택" action:@selector(selectAll:) keyEquivalent:@"a"];NSApp.mainMenu=menu;
    NSRect screen=NSScreen.mainScreen.visibleFrame;NSRect frame=NSMakeRect(0,0,MIN(1060,screen.size.width-40),MIN(800,screen.size.height-60));
    self.window=[[NSWindow alloc] initWithContentRect:frame styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];self.window.title=@"예배온 Sync";self.window.minSize=NSMakeSize(880,620);self.window.delegate=self;self.window.contentView=[[YBCanvas alloc] initWithFrame:frame];[self.window center];
    self.controlStates=[NSMapTable weakToStrongObjectsMapTable];self.work=[YBWork new];self.playlist=[PPSPlaylistController new];self.documents=[[YBDocumentsController alloc] initWithWork:self.work];self.media=[[YBMediaController alloc] initWithWork:self.work documentsRoot:self.documents.documentsRoot];
    __weak YBAppDelegate *weakSelf=self;
    self.media.libraryProvider=^YBLibrary *{[weakSelf.documents ensureSessionLoaded];return [weakSelf.documents connectedLibrary];};
    self.serverPlaylists=[[YBServerPlaylistsController alloc] initWithWork:self.work documents:self.documents];
    self.documents.rootChanged=^(NSString *root){[weakSelf.media setDocumentsRoot:root];[weakSelf.serverPlaylists rootChanged];[weakSelf updateSettings];[weakSelf.documents startupCompare];};
    self.documents.sessionChanged=^(NSString *status){weakSelf.connectionText=status;[weakSelf updateConnection];[weakSelf updateSettings];};
    self.documents.checkStateChanged=^(NSString *message,NSUInteger done,NSUInteger total,BOOL active){
        weakSelf.checkMessage=active ? message : [message stringByAppendingFormat:@" %@",[weakSelf clock]];
        weakSelf.checkProgress.hidden=!active;weakSelf.checkCount.hidden=!active || total==0;
        weakSelf.checkProgress.indeterminate=total==0;weakSelf.checkProgress.maxValue=MAX(1,total);weakSelf.checkProgress.doubleValue=done;
        if(active && !total)[weakSelf.checkProgress startAnimation:nil];else [weakSelf.checkProgress stopAnimation:nil];
        weakSelf.checkCount.stringValue=[NSString stringWithFormat:@"%lu / %lu",(unsigned long)done,(unsigned long)total];[weakSelf updateConnection];
    };
    self.documents.priorityRequested=^{[weakSelf.serverPlaylists refresh:nil];};
    self.serverPlaylists.comparisonFinished=^{weakSelf.lastCompared=[weakSelf clock];[weakSelf updateConnection];};
    self.serverPlaylists.priorityFinished=^{[weakSelf.documents backgroundCompare];};
    self.serverPlaylists.showDocuments=^{weakSelf.navigation.selectedSegment=1;[weakSelf selectTab:weakSelf.navigation];};
    self.documents.showRecovery=^{[weakSelf.serverPlaylists restore:nil];};
    self.serverPlaylists.targetChanged=^(NSString *path){[weakSelf updateSettings];};
    NSMenu *file=[NSMenu new],*tools=[NSMenu new];NSMenuItem *fileItem=[NSMenuItem new],*toolsItem=[NSMenuItem new];[menu addItem:fileItem];[menu addItem:toolsItem];fileItem.submenu=file;toolsItem.submenu=tools;file.title=@"파일";tools.title=@"도구";
    NSMenuItem *login=[application insertItemWithTitle:@"입장 / 이름 변경…" action:@selector(login:) keyEquivalent:@"" atIndex:0];login.target=self.documents;NSMenuItem *logout=[application insertItemWithTitle:@"로그아웃" action:@selector(logout:) keyEquivalent:@"" atIndex:1];logout.target=self.documents;
    NSMenuItem *publish=[file addItemWithTitle:@"원본 재생목록과 문서 등록…" action:@selector(publish:) keyEquivalent:@""];publish.target=self.serverPlaylists;NSMenuItem *recover=[file addItemWithTitle:@"복구 기록…" action:@selector(restore:) keyEquivalent:@""];recover.target=self.serverPlaylists;
    NSMenuItem *fresh=[tools addItemWithTitle:@"동기화 기록 초기화…" action:@selector(resetHistory:) keyEquivalent:@""];fresh.target=self.documents;
    NSMenuItem *reset=[tools addItemWithTitle:@"이 Mac 기준으로 서버 다시 맞추기…" action:@selector(resetServer:) keyEquivalent:@""];reset.target=self.serverPlaylists;
    NSMenuItem *archive=[tools addItemWithTitle:@"웹에서 보관·삭제한 목록 반영…" action:@selector(applyManagedRemovals:) keyEquivalent:@""];archive.target=self.serverPlaylists;
    NSMenuItem *legacy=[tools addItemWithTitle:@"로컬 재생목록 비교…" action:@selector(showLocal:) keyEquivalent:@""];legacy.target=self;
    self.connectionBar=[[YBPanel alloc] initWithFrame:NSMakeRect(0,frame.size.height-44,frame.size.width,44)];self.connectionBar.autoresizingMask=NSViewWidthSizable|NSViewMinYMargin;
    self.status=YBLabel(@"서버 연결 확인 중…",NSZeroRect,12,YES);[self.connectionBar addSubview:self.status];
    self.checkLabel=YBLabel(@"전체 문서 비교 전",NSZeroRect,11,NO);[self.connectionBar addSubview:self.checkLabel];
    self.checkProgress=[[NSProgressIndicator alloc] initWithFrame:NSZeroRect];self.checkProgress.hidden=YES;[self.connectionBar addSubview:self.checkProgress];
    self.checkCount=YBLabel(@"",NSZeroRect,11,NO);self.checkCount.hidden=YES;[self.connectionBar addSubview:self.checkCount];
    self.pauseButton=YBButton(@"일시중단",NSZeroRect,self.work,@selector(togglePause:));self.pauseButton.toolTip=@"앱을 켜 둔 채 조회·업로드를 안전한 지점에서 멈추고 재개합니다. 진행 중인 요청과 최대 4개 업로드의 저장 처리가 먼저 끝납니다.";self.pauseButton.enabled=NO;[self.connectionBar addSubview:self.pauseButton];
    self.settingsButton=YBButton(@"",NSZeroRect,self,@selector(showSettings:));self.settingsButton.image=[NSImage imageNamed:NSImageNameActionTemplate];self.settingsButton.toolTip=@"설정";[self.settingsButton setAccessibilityLabel:@"설정"];[self.connectionBar addSubview:self.settingsButton];
    ((YBPanel *)self.connectionBar).frameLayout=^(NSSize size){YBAppDelegate *app=weakSelf;CGFloat w=size.width;app.status.frame=NSMakeRect(16,10,w-554,23);app.checkLabel.frame=NSMakeRect(w-526,10,app.checkProgress.hidden ? 322 : 140,23);app.checkProgress.frame=NSMakeRect(w-378,17,74,9);app.checkCount.frame=NSMakeRect(w-294,10,92,23);app.pauseButton.frame=NSMakeRect(w-194,6,138,32);app.settingsButton.frame=NSMakeRect(w-50,6,34,32);};
    [self.window.contentView addSubview:self.connectionBar];
    self.tabs=[[NSTabView alloc] initWithFrame:NSMakeRect(0,0,frame.size.width,frame.size.height-90)];self.tabs.tabViewType=NSNoTabsNoBorder;self.tabs.drawsBackground=NO;self.tabs.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;
    self.tabBar=[[NSView alloc] initWithFrame:NSMakeRect(14,frame.size.height-84,frame.size.width-28,36)];self.tabBar.autoresizingMask=NSViewWidthSizable|NSViewMinYMargin;[self.window.contentView addSubview:self.tabBar];
    NSArray *labels=@[@"재생목록",@"문서",@"미디어"],*views=@[self.serverPlaylists.view,self.documents.view,self.media.view];
    self.navigation=[[NSSegmentedControl alloc] initWithFrame:NSMakeRect(0,1,312,32)];self.navigation.segmentCount=3;self.navigation.trackingMode=NSSegmentSwitchTrackingSelectOne;self.navigation.segmentStyle=NSSegmentStyleRounded;self.navigation.target=self;self.navigation.action=@selector(selectTab:);
    for(NSInteger i=0;i<3;i++){[self.navigation setLabel:labels[i] forSegment:i];[self.navigation setWidth:100 forSegment:i];}self.navigation.selectedSegment=0;[self.tabBar addSubview:self.navigation];
    for(NSUInteger i=0;i<labels.count;i++) {
        NSTabViewItem *item=[[NSTabViewItem alloc] initWithIdentifier:labels[i]];item.label=labels[i];NSView *panel=views[i];panel.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;item.view=panel;[self.tabs addTabViewItem:item];
    }
    self.compareButton=YBButton(@"서버와 비교",NSMakeRect(self.tabBar.bounds.size.width-210,0,210,32),self,@selector(compare:));self.compareButton.font=[NSFont boldSystemFontOfSize:13];self.compareButton.autoresizingMask=NSViewMinXMargin;self.compareButton.tag=-1;[self.tabBar addSubview:self.compareButton];
    [self.window.contentView addSubview:self.tabs];
    self.observedControls=[NSMutableArray array];
    for(NSArray *spec in @[@[self.documents,@"applyButton.enabled"],@[self.serverPlaylists,@"receiveButton.enabled"],@[self.serverPlaylists,@"receiveAllButton.enabled"],@[self.documents,@"statusLabel.stringValue"],@[self.serverPlaylists,@"status.stringValue"],@[self.media,@"mediaLabel.stringValue"]]){[spec[0] addObserver:self forKeyPath:spec[1] options:0 context:NULL];[self.observedControls addObject:spec];}
    self.work.idle=^{[weakSelf.documents resumeBackgroundIfNeeded];};
    self.work.messageChanged=^{[weakSelf updateConnection];};self.work.pauseChanged=^{[weakSelf updateConnection];};
    self.work.busyChanged=^(BOOL busy) {
        YBAppDelegate *app=weakSelf;[app enableView:app.serverPlaylists.view enabled:!busy];[app enableView:app.playlist.view enabled:!busy];[app enableView:app.documents.view enabled:!busy];[app enableView:app.media.view enabled:!busy];
        app.settingsButton.enabled=!busy;if(app.settingsSheet){[app enableView:app.settingsSheet.contentView enabled:!busy];app.settingsClose.enabled=YES;}[app updateConnection];
    };
    [self updateConnection];
    [self.window makeKeyAndOrderFront:nil];
#ifndef YB_TESTING
    [self.documents startupCompare];[NSApp activateIgnoringOtherApps:YES];
#endif
}
- (NSString *)clock {NSDateFormatter *f=[NSDateFormatter new];f.dateFormat=@"HH:mm";f.timeZone=[NSTimeZone timeZoneWithName:@"Asia/Seoul"];return [f stringFromDate:NSDate.date];}
- (void)selectTab:(NSSegmentedControl *)sender {NSInteger index=sender.selectedSegment;if(index<0 || index>=self.tabs.numberOfTabViewItems)return;[self.tabs selectTabViewItemAtIndex:index];[self updateConnection];}
- (void)compare:(id)sender {if(self.work.busy)return;if([self.tabs.selectedTabViewItem.identifier isEqual:@"재생목록"])[self.serverPlaylists refresh:sender];else [self.documents refresh:sender];}
- (void)observeValueForKeyPath:(NSString *)path ofObject:(id)object change:(NSDictionary *)change context:(void *)context {if(object==self.documents && [path isEqual:@"statusLabel.stringValue"] && !self.work.busy){NSString *message=[self.documents valueForKeyPath:@"statusLabel.stringValue"];if([message containsString:@"미완료"] || [message containsString:@"못"] || [message containsString:@"중단"] || [message containsString:@"완료했습니다"])self.checkMessage=message;}[self updateConnection];if(object==self.media)[self updateSettings];}
- (void)dealloc {for(NSArray *spec in self.observedControls)[spec[0] removeObserver:self forKeyPath:spec[1]];}
- (void)updateDefaultButton {
    NSButton *receive=[self.serverPlaylists valueForKey:@"receiveButton"],*receiveAll=[self.serverPlaylists valueForKey:@"receiveAllButton"],*apply=[self.documents valueForKey:@"applyButton"];
    for(NSButton *button in @[self.compareButton,receive,receiveAll,apply])button.keyEquivalent=@"";
    self.compareButton.enabled=!self.work.busy;
    if(self.settingsSheet.sheetParent){
        self.window.defaultButtonCell=nil;
        self.settingsSheet.defaultButtonCell=self.settingsClose.cell;
        [self.settingsSheet enableKeyEquivalentForDefaultButtonCell];
        return;
    }
    NSButton *primary=[self.tabs.selectedTabViewItem.identifier isEqual:@"재생목록"] ? (receive.enabled ? receive : receiveAll.enabled ? receiveAll : nil) : [self.tabs.selectedTabViewItem.identifier isEqual:@"문서"] && apply.enabled ? apply : nil;
    if(self.work.busy){self.window.defaultButtonCell=nil;return;}
    NSButton *button=primary ?: self.compareButton;button.keyEquivalent=@"\r";self.window.defaultButtonCell=button.cell;
}
- (void)updateConnection {
    if(!self.compareButton || self.updatingPresentation)return;self.updatingPresentation=YES;
    @try {
    self.status.stringValue=[NSString stringWithFormat:@"%@ · %@",self.connectionText ?: @"서버 연결 확인",self.lastCompared ? [@"재생목록 비교 " stringByAppendingString:self.lastCompared] : @"재생목록 비교 전"];
    self.checkLabel.stringValue=self.work.paused ? @"일시중단됨 · 재개 가능" : self.work.pauseRequested ? @"현재 처리 후 중단 대기" : self.work.busy ? self.work.message ?: @"작업 중" : self.checkMessage ?: @"전체 문서 비교 전";
    self.status.toolTip=[NSString stringWithFormat:@"%@\n%@\n%@",self.status.stringValue,[self.documents valueForKeyPath:@"statusLabel.stringValue"],[self.serverPlaylists valueForKeyPath:@"status.stringValue"]];self.checkLabel.toolTip=self.checkLabel.stringValue;
    self.pauseButton.enabled=self.work.pausable && (self.work.busy || self.work.backgroundActive);self.pauseButton.title=self.work.paused ? @"재개" : self.work.pauseRequested ? @"중단 요청 취소" : @"일시중단";
    self.window.title=self.work.busy ? [@"예배온 Sync · " stringByAppendingString:self.checkLabel.stringValue] : @"예배온 Sync";
    ((YBPanel *)self.connectionBar).frameLayout(self.connectionBar.bounds.size);[self updateDefaultButton];
    } @finally {self.updatingPresentation=NO;}
}
- (void)updateSettings {
    if(!self.settingsSheet)return;
    self.documentPath.stringValue=self.documents.documentsRoot;self.playlistPath.stringValue=self.serverPlaylists.targetPath;
    NSArray *roots=[self.media valueForKey:@"roots"];self.mediaPath.stringValue=[roots componentsJoinedByString:@" · "];
    self.backupPath.stringValue=YBProfilePath(self.documents.documentsRoot,@"https://yebaeon.grace-jean-p.workers.dev");self.entryLabel.stringValue=self.connectionText ?: @"입장 상태 확인 전";
    for(NSTextField *label in @[self.documentPath ?: [NSTextField new],self.playlistPath ?: [NSTextField new],self.mediaPath ?: [NSTextField new],self.backupPath ?: [NSTextField new],self.entryLabel ?: [NSTextField new]])label.toolTip=label.stringValue;
}
- (void)showSettings:(id)sender {
    if(self.work.busy)return;
    if(!self.settingsSheet){
        self.settingsSheet=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,800,430) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];self.settingsSheet.title=@"설정";self.settingsSheet.releasedWhenClosed=NO;
        self.settingsSheet.contentView=[[YBCanvas alloc] initWithFrame:self.settingsSheet.contentView.bounds];NSView *v=self.settingsSheet.contentView;[v addSubview:YBLabel(@"설정",NSMakeRect(24,376,300,30),22,YES)];
        NSArray *names=@[@"재생목록 파일",@"문서 폴더",@"미디어 폴더",@"백업 폴더",@"입장"];
        NSMutableArray *values=[NSMutableArray array];for(NSUInteger i=0;i<names.count;i++){CGFloat y=322-i*57;[v addSubview:YBLabel(names[i],NSMakeRect(24,y,128,25),13,YES)];NSTextField *value=YBLabel(@"",NSMakeRect(158,y,i==2 || i==4 ? 330 : 476,25),12,NO);[v addSubview:value];[values addObject:value];}
        self.playlistPath=values[0];self.documentPath=values[1];self.mediaPath=values[2];self.backupPath=values[3];self.entryLabel=values[4];
        [v addSubview:YBButton(@"변경…",NSMakeRect(652,318,124,32),self.serverPlaylists,@selector(chooseFile:))];
        [v addSubview:YBButton(@"변경…",NSMakeRect(652,261,124,32),self.documents,@selector(chooseRoot:))];
        [v addSubview:YBButton(@"추가…",NSMakeRect(510,204,132,32),self.media,@selector(addRoot:))];[v addSubview:YBButton(@"기본값",NSMakeRect(652,204,124,32),self.media,@selector(defaultRoots:))];
        [v addSubview:YBButton(@"열기",NSMakeRect(652,147,124,32),self.serverPlaylists,@selector(openBackupFolder:))];
        [v addSubview:YBButton(@"이름 변경…",NSMakeRect(510,90,132,32),self.documents,@selector(login:))];[v addSubview:YBButton(@"로그아웃",NSMakeRect(652,90,124,32),self.documents,@selector(logout:))];
        self.settingsClose=YBButton(@"닫기",NSMakeRect(626,20,150,32),self,@selector(closeSettings:));self.settingsClose.font=[NSFont boldSystemFontOfSize:13];self.settingsClose.keyEquivalent=@"\r";[v addSubview:self.settingsClose];self.settingsSheet.defaultButtonCell=self.settingsClose.cell;
    }
    [self updateSettings];self.window.defaultButtonCell=nil;if(!self.settingsSheet.sheetParent)[self.window beginSheet:self.settingsSheet completionHandler:^(NSModalResponse response){[self updateDefaultButton];}];[self updateDefaultButton];
}
- (void)closeSettings:(id)sender {[self.window endSheet:self.settingsSheet];[self.settingsSheet orderOut:nil];[self updateDefaultButton];}
- (void)showLocal:(id)sender {if(self.work.busy)return;if(!self.toolWindow){self.toolWindow=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,1060,720) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];self.toolWindow.releasedWhenClosed=NO;self.toolWindow.title=@"로컬 재생목록 비교";NSScrollView *scroll=[[NSScrollView alloc] initWithFrame:self.toolWindow.contentView.bounds];scroll.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;scroll.hasVerticalScroller=YES;scroll.hasHorizontalScroller=YES;scroll.documentView=self.playlist.view;[self.toolWindow.contentView addSubview:scroll];[self.toolWindow center];}[self.toolWindow makeKeyAndOrderFront:nil];}
- (BOOL)validateMenuItem:(NSMenuItem *)item {return !self.work.busy;}
- (void)enableView:(NSView *)view enabled:(BOOL)enabled {
    if([view isKindOfClass:NSControl.class]) {NSControl *control=(NSControl *)view;if(!enabled)[self.controlStates setObject:@(control.enabled) forKey:control];NSNumber *previous=[self.controlStates objectForKey:control];control.enabled=enabled ? (previous ? previous.boolValue : YES) : NO;}
    for(NSView *child in view.subviews)[self enableView:child enabled:enabled];
    if(enabled && [view isKindOfClass:NSTableView.class])[(NSTableView *)view reloadData];
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)app {return YES;}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)app {if(self.work.busy || self.work.backgroundActive){YBAlert(@"작업 중입니다.",@"일시중단 중에는 재개한 뒤 송수신·점검이 끝나면 종료해 주세요.");return NSTerminateCancel;}return NSTerminateNow;}
- (BOOL)windowShouldClose:(NSWindow *)window {return [self applicationShouldTerminate:NSApp]==NSTerminateNow;}
@end
int main(int argc,const char *argv[]) {@autoreleasepool {NSApplication *app=NSApplication.sharedApplication;YBAppDelegate *delegate=[YBAppDelegate new];app.delegate=delegate;[app setActivationPolicy:NSApplicationActivationPolicyRegular];[app run];}return 0;}


