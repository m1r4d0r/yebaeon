#import <Cocoa/Cocoa.h>
#import "YB2Engine.h"
#import "YB2Server.h"
#import "YB2Update.h"
#import "YBDocumentComparison.h"
#import "PP6Core.h"

// 예배온 Sync 2: 데일리 창 하나 + 메뉴 막대 상주.
// - Mac 파일을 바꾸는 일은 모두 [적용]으로만 한다: 받기, 서버 휴지통 예배 빼기, 문서 이름 바꾸기·휴지통.
// - 올리기(서버에 더하기만 함): Mac에서만 바뀐 문서·순서·사용일, Mac에서 만든 예배·새 문서·그 문서의 새 이미지.
// - 상주: 15분마다 변경 일지만 묻고(요청 1번), 바뀐 것이 있을 때만 비교해 창에 보여 준다. 적용하지 않는다.
//   PP6가 닫히면 Mac 수정분과 새 문서를 올린다. 잠자기에서 깨면 다시 확인한다.
static NSString *const kOrigin = @"https://yebaeon.grace-jean-p.workers.dev";
static NSString *const kRootKey = @"documentsRoot", *const kPlaylistKey = @"playlistPath";
static NSString *const kResidentKey = @"residentMode";
static NSString *const kAgentLabel = @"org.yebaeon.sync2";
static const NSTimeInterval kResidentInterval = 15 * 60;

@interface YB2App : NSObject <NSApplicationDelegate, NSTableViewDataSource, NSTableViewDelegate>
@property(nonatomic) NSWindow *window;
@property(nonatomic) NSTextField *connectionLabel, *rootLabel, *playlistLabel, *statusLabel, *presenterLabel;
@property(nonatomic) NSTableView *table;
@property(nonatomic) NSButton *compareButton, *applyButton, *reviewButton;
// 정리 창: 전체 확인과 비교가 만든 목록. 아무도 안 눌러도 아무 일도 생기지 않는다.
@property(nonatomic) NSWindow *organizer;
@property(nonatomic) NSTableView *organizerTable;
@property(nonatomic) NSTextField *organizerStatus;
@property(nonatomic) NSMutableArray *organizerRows;    // {list, title, path, detail, item}
@property(nonatomic) NSDictionary *organizerButtons;   // 동작 이름 → 버튼
@property(nonatomic) YB2Server *server;
@property(nonatomic) NSStatusItem *statusItem;
@property(nonatomic) NSDate *lastFullCompare;        // 서버에 변경 일지가 없을 때(배포 전) 1시간에 한 번만 비교하기 위해
@property(nonatomic) YB2Engine *engine;
@property(nonatomic) NSMutableArray *rows;           // compare 결과 + @"checked"
@property(nonatomic) BOOL busy;
@property(nonatomic) BOOL checking;
// 업데이트: 새 빌드가 있을 때만 표 위에 노란 줄. [지금 설치]를 눌러야 바뀐다.
@property(nonatomic) NSScrollView *tableScroll;
@property(nonatomic) NSBox *updateBar;
@property(nonatomic) NSTextField *updateLabel;
@property(nonatomic) NSButton *updateButton;
@property(nonatomic) NSDictionary *pendingRelease;           // 서버의 새 빌드(지금보다 새로울 때만)
@property(nonatomic) NSInteger dismissedBuild;        // [나중에]를 누른 빌드(이번 실행 동안 숨김)
@property(nonatomic) NSDate *lastUpdateCheck;
@property(nonatomic) NSMenuItem *statusUpdateItem, *statusLineItem;
@property(nonatomic) NSDate *lastCycleAt;             // 마지막으로 서버를 확인한 때(메뉴 막대 상태 줄)               // 전체 확인이 뒤에서 도는 중(데일리 창은 잠그지 않는다)
@property(nonatomic) NSUInteger startupAttempt;
@property(nonatomic) dispatch_queue_t work;
@end

@implementation YB2App

#pragma mark - 설정

- (NSString *)root {
    NSString *value = [NSUserDefaults.standardUserDefaults stringForKey:kRootKey];
    return value.length ? value : [NSHomeDirectory() stringByAppendingPathComponent:@"Documents/ProPresenter6"];
}
- (NSURL *)playlistURL {
    NSString *value = [NSUserDefaults.standardUserDefaults stringForKey:kPlaylistKey];
    if (!value.length) value = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/RenewedVision/ProPresenter6/Playlists/기본 .pro6pl"];
    return [NSURL fileURLWithPath:value];
}
- (BOOL)resident { return [NSUserDefaults.standardUserDefaults objectForKey:kResidentKey] ? [NSUserDefaults.standardUserDefaults boolForKey:kResidentKey] : YES; }
- (NSString *)profile {
    NSString *identity = YBHash([[NSString stringWithFormat:@"%@\n%@", kOrigin, self.root] dataUsingEncoding:NSUTF8StringEncoding]);
    return [[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/YebaeOn Sync 2"] stringByAppendingPathComponent:[identity substringToIndex:16]];
}
- (void)rebuildEngine {
    self.engine = [[YB2Engine alloc] initWithServer:self.server root:self.root playlist:self.playlistURL profile:self.profile];
    __weak YB2App *weak = self;
    self.engine.progress = ^(NSString *message) { dispatch_async(dispatch_get_main_queue(), ^{ weak.statusLabel.stringValue = message; }); };
    self.rootLabel.stringValue = [@"문서 폴더  " stringByAppendingString:self.root];
    self.playlistLabel.stringValue = [@"재생목록  " stringByAppendingString:self.playlistURL.path];
}

#pragma mark - 화면

static NSTextField *Label(NSString *text, NSRect frame, CGFloat size) {
    NSTextField *label = [[NSTextField alloc] initWithFrame:frame];
    label.stringValue = text; label.editable = NO; label.bordered = NO; label.drawsBackground = NO; label.selectable = NO;
    label.font = [NSFont systemFontOfSize:size]; label.lineBreakMode = NSLineBreakByTruncatingMiddle;
    label.autoresizingMask = NSViewWidthSizable | NSViewMinYMargin;
    return label;
}
static NSButton *Button(NSString *title, NSRect frame, id target, SEL action) {
    NSButton *button = [[NSButton alloc] initWithFrame:frame];
    button.title = title; button.bezelStyle = NSBezelStyleRounded; button.target = target; button.action = action;
    button.autoresizingMask = NSViewMinXMargin | NSViewMaxYMargin;
    return button;
}
- (void)buildWindow {
    NSRect frame = NSMakeRect(0, 0, 820, 520);
    self.window = [[NSWindow alloc] initWithContentRect:frame styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"예배온 Sync 2"; self.window.minSize = NSMakeSize(700, 400);
    self.window.releasedWhenClosed = NO;   // 상주 중에는 창을 닫아도 메뉴 막대에서 다시 연다
    [self.window center];
    NSView *content = self.window.contentView; CGFloat w = frame.size.width, h = frame.size.height;

    self.connectionLabel = Label(@"서버 연결 확인 중", NSMakeRect(16, h - 32, w - 380, 18), 12);
    self.rootLabel = Label(@"", NSMakeRect(16, h - 54, w - 120, 18), 12);
    self.playlistLabel = Label(@"", NSMakeRect(16, h - 76, w - 120, 18), 12);
    NSButton *rootChange = Button(@"변경…", NSMakeRect(w - 96, h - 58, 80, 24), self, @selector(chooseRoot:));
    NSButton *playlistChange = Button(@"변경…", NSMakeRect(w - 96, h - 80, 80, 24), self, @selector(choosePlaylist:));
    rootChange.autoresizingMask = playlistChange.autoresizingMask = NSViewMinXMargin | NSViewMinYMargin;
    [content addSubview:self.connectionLabel]; [content addSubview:self.rootLabel]; [content addSubview:self.playlistLabel];
    [content addSubview:rootChange]; [content addSubview:playlistChange];

    NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:NSMakeRect(16, 52, w - 32, h - 140)]; self.tableScroll = scroll;
    scroll.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable; scroll.hasVerticalScroller = YES; scroll.borderType = NSBezelBorder;
    self.table = [[NSTableView alloc] initWithFrame:scroll.bounds];
    self.table.dataSource = self; self.table.delegate = self; self.table.rowHeight = 22; self.table.allowsMultipleSelection = NO;
    self.table.columnAutoresizingStyle = NSTableViewLastColumnOnlyAutoresizingStyle;
    NSArray *columns = @[@[@"checked", @"적용", @44], @[@"name", @"예배", @200], @[@"status", @"바뀐 것", @300], @[@"updated", @"서버 저장", @200]];
    for (NSArray *spec in columns) {
        NSTableColumn *column = [[NSTableColumn alloc] initWithIdentifier:spec[0]];
        column.title = spec[1]; column.width = [spec[2] doubleValue]; column.editable = [spec[0] isEqual:@"checked"];
        if ([spec[0] isEqual:@"checked"]) { NSButtonCell *cell = [NSButtonCell new]; [cell setButtonType:NSButtonTypeSwitch]; cell.title = @""; column.dataCell = cell; }
        [self.table addTableColumn:column];
    }
    scroll.documentView = self.table; [content addSubview:scroll];

    self.statusLabel = Label(@"", NSMakeRect(16, 16, w - 300, 18), 12); self.statusLabel.autoresizingMask = NSViewWidthSizable | NSViewMaxYMargin;
    self.presenterLabel = Label(@"", NSMakeRect(w - 440, 16, 160, 18), 12); self.presenterLabel.autoresizingMask = NSViewMinXMargin | NSViewMaxYMargin; self.presenterLabel.alignment = NSTextAlignmentRight;
    self.compareButton = Button(@"다시 비교", NSMakeRect(w - 270, 10, 110, 28), self, @selector(compareNow:));
    self.applyButton = Button(@"적용·올리기", NSMakeRect(w - 150, 10, 134, 28), self, @selector(applyNow:));
    self.applyButton.keyEquivalent = @"\r"; self.applyButton.enabled = NO;
    [content addSubview:self.statusLabel]; [content addSubview:self.presenterLabel]; [content addSubview:self.compareButton]; [content addSubview:self.applyButton];
    // "확인 필요 n · 정리 열기" 한 줄. n=0이면 숨긴다.
    self.reviewButton = Button(@"", NSMakeRect(w - 356, h - 34, 244, 24), self, @selector(showOrganizer:));
    self.reviewButton.bezelStyle = NSBezelStyleRecessed; self.reviewButton.autoresizingMask = NSViewMinXMargin | NSViewMinYMargin; self.reviewButton.hidden = YES;
    [content addSubview:self.reviewButton];
    NSButton *studio = Button(@"Studio 열기", NSMakeRect(w - 106, h - 34, 90, 24), self, @selector(openStudio:));
    studio.autoresizingMask = NSViewMinXMargin | NSViewMinYMargin; [content addSubview:studio];
    // 새 버전 줄(표 바로 위). 보일 때만 표를 그만큼 줄인다.
    self.updateBar = [[NSBox alloc] initWithFrame:NSMakeRect(16, h - 120, w - 32, 32)];
    self.updateBar.boxType = NSBoxCustom; self.updateBar.fillColor = [NSColor colorWithCalibratedRed:1 green:0.965 blue:0.8 alpha:1];
    self.updateBar.borderColor = [NSColor colorWithCalibratedRed:0.9 green:0.81 blue:0.42 alpha:1]; self.updateBar.cornerRadius = 4; self.updateBar.titlePosition = NSNoTitle;
    self.updateBar.autoresizingMask = NSViewWidthSizable | NSViewMinYMargin; self.updateBar.hidden = YES;
    NSView *bar = self.updateBar.contentView; CGFloat bw = w - 40;
    self.updateLabel = Label(@"", NSMakeRect(6, 5, bw - 220, 18), 12); self.updateLabel.autoresizingMask = NSViewWidthSizable;
    NSButton *later = Button(@"나중에", NSMakeRect(bw - 206, 0, 80, 26), self, @selector(dismissUpdate:));
    self.updateButton = Button(@"지금 설치", NSMakeRect(bw - 120, 0, 110, 26), self, @selector(installUpdate:));
    later.autoresizingMask = self.updateButton.autoresizingMask = NSViewMinXMargin;
    [bar addSubview:self.updateLabel]; [bar addSubview:later]; [bar addSubview:self.updateButton];
    [content addSubview:self.updateBar];
}
#pragma mark - 업데이트

// 시작 때·상주 확인 때(6시간에 한 번)·메뉴에서 버전만 묻는다. 설치는 [지금 설치]로만.
- (void)checkUpdate:(BOOL)force {
    if (!force && self.lastUpdateCheck && -self.lastUpdateCheck.timeIntervalSinceNow < 6 * 3600) return;
    self.lastUpdateCheck = NSDate.date;
    YB2Server *server = self.server;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        NSDictionary *release = nil; NSException *error = nil;
        @try { release = [YB2Update latest:server]; } @catch (NSException *e) { error = e; }
        dispatch_async(dispatch_get_main_queue(), ^{
            if (error) { if (force) [self alert:@"업데이트 확인 실패" text:error.reason]; return; }
            self.pendingRelease = [release[@"build"] integerValue] > [YB2Update currentBuild] ? release : nil;
            if (force && !self.pendingRelease) [self alert:@"최신 버전입니다" text:[NSString stringWithFormat:@"지금 빌드 %ld", (long)[YB2Update currentBuild]]];
            if (force) self.dismissedBuild = 0;
            [self refreshUpdateBar];
        });
    });
}
- (void)checkUpdateNow:(id)sender { [self checkUpdate:YES]; }
- (void)refreshUpdateBar {
    BOOL show = self.pendingRelease && [self.pendingRelease[@"build"] integerValue] != self.dismissedBuild;
    if (show != !self.updateBar.hidden) {
        NSRect frame = self.tableScroll.frame; frame.size.height += show ? -38 : 38; self.tableScroll.frame = frame;
        self.updateBar.hidden = !show;
    }
    NSString *notes = [self.pendingRelease[@"notes"] length] ? [@" · " stringByAppendingString:self.pendingRelease[@"notes"]] : @"";
    self.updateLabel.stringValue = self.pendingRelease ? [NSString stringWithFormat:@"새 버전 있음 · 빌드 %@ (지금 빌드 %ld)%@", self.pendingRelease[@"build"], (long)[YB2Update currentBuild], notes] : @"";
    NSString *blocked = self.busy ? @"작업 중" : self.checking ? @"전체 확인 중" : YBPresenterRunning() ? @"PP6를 닫은 뒤" : nil;
    self.updateButton.enabled = self.pendingRelease && !blocked;
    self.updateButton.toolTip = blocked ? [blocked stringByAppendingString:@" 설치할 수 있습니다."] : nil;
    self.statusUpdateItem.hidden = !self.pendingRelease;
    self.statusUpdateItem.title = self.pendingRelease ? [NSString stringWithFormat:@"새 버전 설치… (빌드 %@)", self.pendingRelease[@"build"]] : @"";
    [self refreshStatusItem];
}
- (void)dismissUpdate:(id)sender { self.dismissedBuild = [self.pendingRelease[@"build"] integerValue]; [self refreshUpdateBar]; }
- (void)installUpdate:(id)sender {
    NSDictionary *release = self.pendingRelease;
    if (!release) return;
    if (self.busy || self.checking || YBPresenterRunning()) { [self alert:@"지금은 설치할 수 없습니다" text:@"적용·올리기·전체 확인이 끝나고 PP6를 닫은 뒤 다시 눌러 주세요."]; return; }
    [self showWindow:nil];
    NSAlert *confirm = [NSAlert new]; confirm.messageText = [NSString stringWithFormat:@"빌드 %@로 바꿀까요?", release[@"build"]];
    confirm.informativeText = @"새 버전을 받아 앱을 바꾸고 다시 켭니다. 지금 앱은 백업 폴더에 남습니다. 영수증·백업·설정은 그대로입니다.";
    [confirm addButtonWithTitle:@"지금 설치"]; [confirm addButtonWithTitle:@"취소"];
    if ([confirm runModal] != NSAlertFirstButtonReturn) return;
    NSString *backupRoot = [[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/YebaeOn Sync 2"] stringByAppendingPathComponent:@"app-backups"];
    YB2Server *server = self.server;
    [self runOrganizer:@"새 버전 설치 중" task:^id{
        return [YB2Update install:release server:server backupRoot:backupRoot progress:^(NSString *message) { dispatch_async(dispatch_get_main_queue(), ^{ self.statusLabel.stringValue = message; }); }];
    } done:^(NSString *path) {
        [YB2Update relaunch:path];
        [NSApp terminate:nil];
    }];
}

- (void)openStudio:(id)sender { [NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:kOrigin]]; }
- (void)buildMenu {
    NSMenu *bar = [NSMenu new]; NSMenuItem *appItem = [NSMenuItem new]; [bar addItem:appItem];
    NSMenu *app = [NSMenu new];
    [app addItemWithTitle:@"로그아웃" action:@selector(logout:) keyEquivalent:@""];
    [app addItem:NSMenuItem.separatorItem];
    [app addItemWithTitle:@"예배온 Sync 2 종료" action:@selector(terminate:) keyEquivalent:@"q"];
    appItem.submenu = app;
    NSMenuItem *toolsItem = [NSMenuItem new]; [bar addItem:toolsItem];
    NSMenu *tools = [NSMenu new]; tools.title = @"도구";
    [tools addItemWithTitle:@"다시 비교" action:@selector(compareNow:) keyEquivalent:@"r"];
    [tools addItemWithTitle:@"정리…" action:@selector(showOrganizer:) keyEquivalent:@"o"];
    [tools addItemWithTitle:@"예배온 Studio 열기" action:@selector(openStudio:) keyEquivalent:@"s"];
    [tools addItemWithTitle:@"백업 폴더 열기" action:@selector(openBackups:) keyEquivalent:@""];
    [tools addItem:NSMenuItem.separatorItem];
    [tools addItemWithTitle:@"상주 확인 (15분마다)" action:@selector(toggleResident:) keyEquivalent:@""];
    [tools addItemWithTitle:@"로그인 시 실행" action:@selector(toggleLoginItem:) keyEquivalent:@""];
    [tools addItem:NSMenuItem.separatorItem];
    [tools addItemWithTitle:@"업데이트 확인" action:@selector(checkUpdateNow:) keyEquivalent:@""];
    NSMenuItem *version = [tools addItemWithTitle:[NSString stringWithFormat:@"버전: 빌드 %ld", (long)[YB2Update currentBuild]] action:nil keyEquivalent:@""]; version.enabled = NO;
    toolsItem.submenu = tools;
    NSApp.mainMenu = bar;
}

#pragma mark - 입장

- (BOOL)loginSheet {
    NSAlert *alert = [NSAlert new];
    alert.messageText = @"예배온 입장"; alert.informativeText = @"공용 비밀번호와 이 Mac의 이름(예: 교회 Mac)을 넣어 주세요. 이 이름이 서버에 저장자로 남습니다.";
    NSView *box = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 300, 56)];
    NSTextField *name = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 30, 300, 24)]; name.placeholderString = @"이 Mac의 이름";
    NSSecureTextField *password = [[NSSecureTextField alloc] initWithFrame:NSMakeRect(0, 0, 300, 24)]; password.placeholderString = @"공용 비밀번호";
    [box addSubview:name]; [box addSubview:password]; alert.accessoryView = box;
    [alert addButtonWithTitle:@"입장"]; [alert addButtonWithTitle:@"취소"];
    alert.window.initialFirstResponder = name;
    if ([alert runModal] != NSAlertFirstButtonReturn) return NO;
    @try {
        [self.server forgetDeviceToken];
        [self.server login:name.stringValue password:password.stringValue];
        @try { [self.server saveSession]; } @catch (NSException *e) { NSLog(@"%@", e.reason); }
        // 상주용 장치 열쇠를 받는다. 서버가 아직 열쇠를 모르면(배포 전) 쿠키로 계속 쓴다.
        @try { [self.server registerDevice:name.stringValue]; [self.server saveDeviceToken]; }
        @catch (NSException *e) { NSLog(@"device key: %@", e.reason); self.server.deviceToken = nil; }
        self.connectionLabel.stringValue = [NSString stringWithFormat:@"%@ 연결됨%@ · %@", name.stringValue, self.server.deviceToken ? @" (장치 열쇠)" : @"", kOrigin];
        return YES;
    } @catch (NSException *e) {
        [self alert:@"입장 실패" text:e.reason]; return NO;
    }
}
- (void)logout:(id)sender {
    NSString *token = self.server.deviceToken; self.server.deviceToken = nil;
    @try { [self.server request:@"/api/session" method:@"DELETE" body:nil headers:nil]; } @catch (NSException *e) {}
    @try { [self.server forgetSession]; } @catch (NSException *e) {}
    if (token) [self.server forgetDeviceToken];   // 서버의 장치 등록 해제는 웹(Studio)에서 한다
    self.connectionLabel.stringValue = @"로그아웃됨";
    if ([self loginSheet]) [self compareNow:nil];
}
// 401: 장치 열쇠가 해제됐거나 쿠키가 만료됐다. 열쇠를 지우고 다시 입장한다.
- (void)handleLoginRequired {
    if (self.server.deviceToken) [self.server forgetDeviceToken];
    if ([self loginSheet]) [self compareNow:nil];
}
- (void)alert:(NSString *)title text:(NSString *)text {
    NSAlert *alert = [NSAlert new]; alert.messageText = title; alert.informativeText = text ?: @""; [alert runModal];
}

#pragma mark - 시작

- (void)applicationDidFinishLaunching:(NSNotification *)note {
    self.work = dispatch_queue_create("org.yebaeon.sync2", DISPATCH_QUEUE_SERIAL);
    self.rows = [NSMutableArray array];
    [self buildMenu]; [self buildWindow]; [self buildStatusItem];
    [self.window makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES];
    self.server = [[YB2Server alloc] initWithOrigin:kOrigin allowLocalTestServer:NO];
    @try { [self.server loadDeviceToken]; } @catch (NSException *e) { NSLog(@"%@", e.reason); }
    @try { [self.server loadSession]; } @catch (NSException *e) { NSLog(@"%@", e.reason); }
    [self rebuildEngine];
    [NSTimer scheduledTimerWithTimeInterval:3 target:self selector:@selector(refreshPresenterState) userInfo:nil repeats:YES];
    [NSTimer scheduledTimerWithTimeInterval:kResidentInterval target:self selector:@selector(residentTick) userInfo:nil repeats:YES];
    NSNotificationCenter *workspace = NSWorkspace.sharedWorkspace.notificationCenter;
    [workspace addObserver:self selector:@selector(applicationTerminated:) name:NSWorkspaceDidTerminateApplicationNotification object:nil];
    [workspace addObserver:self selector:@selector(didWake:) name:NSWorkspaceDidWakeNotification object:nil];
    [self refreshPresenterState];
    @try {
        NSString *finished = [self.engine finishInterruptedApply];
        if (finished) [self alert:@"중단된 적용 마무리" text:finished];
    } @catch (NSException *e) { [self alert:@"중단된 적용을 마무리하지 못함" text:e.reason]; }
    if (!self.server.cookie && !self.server.deviceToken) { if (![self loginSheet]) return; }
    else self.connectionLabel.stringValue = [NSString stringWithFormat:@"연결 확인 중%@ · %@", self.server.deviceToken ? @" (장치 열쇠)" : @"", kOrigin];
    // 구형 Mac은 부팅 뒤 한참 인터넷을 못 잡는다. 바로 돌지 않고 잠시 뒤에 시작하며, 네트워크 오류면 간격을 늘려 조용히 기다린다.
    [self performSelector:@selector(startupCompare) withObject:nil afterDelay:5];
}
- (void)startupCompare {
    if (self.busy) return;
    [self runCycleForce:YES upload:NO completion:^(NSException *error) {
        if (!error) { [self runFullCheckIfDue]; [self checkUpdate:NO]; return; }
        if ([error.reason hasPrefix:@"HTTP 401"]) { dispatch_async(dispatch_get_main_queue(), ^{ [self handleLoginRequired]; }); return; }
        if ([error.reason hasPrefix:@"HTTP "]) { dispatch_async(dispatch_get_main_queue(), ^{ self.statusLabel.stringValue = error.reason; }); return; }
        NSArray *delays = @[@10, @20, @40, @80, @160, @300];
        if (self.startupAttempt >= delays.count) { dispatch_async(dispatch_get_main_queue(), ^{ self.statusLabel.stringValue = [@"서버에 연결하지 못했습니다. 인터넷 연결 뒤 ‘다시 비교’를 눌러 주세요. " stringByAppendingString:error.reason]; }); return; }
        NSTimeInterval delay = [delays[self.startupAttempt++] doubleValue];
        dispatch_async(dispatch_get_main_queue(), ^{
            self.statusLabel.stringValue = [NSString stringWithFormat:@"네트워크를 기다리는 중 · %.0f초 뒤 다시 시도", delay];
            [self performSelector:@selector(startupCompare) withObject:nil afterDelay:delay];
        });
    }];
}

#pragma mark - 상주

static BOOL IsPresenter(NSRunningApplication *app) {
    return [app.localizedName.lowercaseString hasPrefix:@"propresenter"] || [app.bundleIdentifier.lowercaseString containsString:@"propresenter"];
}
- (void)residentTick {
    [self checkUpdate:NO];
    if (!self.resident || self.busy) return;
    [self runCycleForce:NO upload:NO completion:^(NSException *error) {
        if ([error.reason hasPrefix:@"HTTP 401"]) dispatch_async(dispatch_get_main_queue(), ^{ [self handleLoginRequired]; });
    }];
}
// 예배가 끝나 PP6를 닫았다: Mac에서 고친 것과 새 문서·새 예배를 올린다. 받을 것은 창에 보여 주기만 한다. PP6가 파일을 마저 쓰도록 잠시 기다린다.
- (void)applicationTerminated:(NSNotification *)note {
    if (!self.resident || !IsPresenter(note.userInfo[NSWorkspaceApplicationKey])) return;
    self.statusLabel.stringValue = @"PP6 종료 확인 · 잠시 뒤 올리기";
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(afterPresenterQuit) object:nil];
    [self performSelector:@selector(afterPresenterQuit) withObject:nil afterDelay:10];
}
- (void)afterPresenterQuit {
    if (self.busy) { [self performSelector:@selector(afterPresenterQuit) withObject:nil afterDelay:30]; return; }
    [self runCycleForce:YES upload:YES completion:nil];
}
- (void)didWake:(NSNotification *)note {
    if (!self.resident) return;
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(residentTick) object:nil];
    [self performSelector:@selector(residentTick) withObject:nil afterDelay:30];   // 깬 직후에는 네트워크가 없다
}

#pragma mark - 비교·올리기·적용

// [적용]으로 고를 수 있는 줄. Mac 파일을 바꾸는 줄(받기·빼기·문서 정리)은 PP6가 꺼져 있어야 한다.
static BOOL Checkable(NSDictionary *row) { return [@[@"receive", @"mac", @"trash", @"actions", @"macNew"] containsObject:row[@"status"] ?: @""]; }
static BOOL ChangesMac(NSDictionary *row) { return [@[@"receive", @"trash", @"actions"] containsObject:row[@"status"] ?: @""] || [row[@"images"] count]; }

- (void)setBusy:(BOOL)busy {
    _busy = busy;
    self.compareButton.enabled = !busy;
    [self.table reloadData];
    [self refreshApplyButton];
    [self refreshStatusItem];
    if (self.organizer) [self refreshOrganizerButtons];
    if (self.updateBar) [self refreshUpdateBar];
}
- (void)refreshPresenterState {
    BOOL running = YBPresenterRunning();
    self.presenterLabel.stringValue = running ? @"PP6 실행 중" : @"PP6 꺼져 있음";
    [self refreshApplyButton];
    if (self.pendingRelease) [self refreshUpdateBar];
}
- (void)refreshApplyButton {
    NSUInteger checked = 0, receive = 0;
    for (NSDictionary *row in self.rows) if ([row[@"checked"] boolValue]) { checked++; if (ChangesMac(row)) receive++; }
    // 올리기는 PP6가 켜져 있어도 된다(Mac 파일을 바꾸지 않는다). 받기는 PP6를 닫아야 한다.
    self.applyButton.enabled = !self.busy && checked > 0 && (receive == 0 || !YBPresenterRunning());
    self.applyButton.title = checked ? [NSString stringWithFormat:@"%lu개 적용·올리기", (unsigned long)checked] : @"적용·올리기";
}
- (void)refreshStatusItem {
    NSUInteger waiting = 0, hold = 0;
    for (NSDictionary *row in self.rows) { if (Checkable(row) && !([row[@"macDeleted"] boolValue])) waiting++; else if ([row[@"status"] isEqual:@"hold"]) hold++; }
    NSString *title = self.busy ? @"예배온 확인 중" : waiting ? [NSString stringWithFormat:@"예배온 대기 %lu", (unsigned long)waiting] : hold ? [NSString stringWithFormat:@"예배온 보류 %lu", (unsigned long)hold] : @"예배온 최신";
    self.statusItem.button.title = self.pendingRelease ? [title stringByAppendingString:@" · 새 버전"] : title;
    NSString *state = self.busy ? @"확인 중" : waiting ? [NSString stringWithFormat:@"받을·올릴 것 %lu", (unsigned long)waiting] : hold ? [NSString stringWithFormat:@"보류 %lu", (unsigned long)hold] : @"모두 같음";
    NSString *at = self.lastCycleAt ? [@" · " stringByAppendingString:[NSDateFormatter localizedStringFromDate:self.lastCycleAt dateStyle:NSDateFormatterNoStyle timeStyle:NSDateFormatterShortStyle]] : @"";
    self.statusLineItem.title = [state stringByAppendingString:at];
}
- (void)showRows:(NSArray *)result {
    [self.rows removeAllObjects];
    // Mac에서 지운 예배는 기본 체크 꺼짐(되살리지 않는다). 나머지 고를 수 있는 줄은 켜 둔다.
    for (NSDictionary *row in result) { NSMutableDictionary *m = [row mutableCopy]; m[@"checked"] = @(Checkable(row) && ![row[@"macDeleted"] boolValue]); [self.rows addObject:m]; }
    [self.table reloadData];
    NSUInteger receive = 0, mac = 0, hold = 0, trash = 0;
    for (NSDictionary *row in self.rows) {
        NSString *status = row[@"status"];
        if ([status isEqual:@"receive"] && ![row[@"macDeleted"] boolValue]) receive++;
        else if ([status isEqual:@"mac"] || [status isEqual:@"macNew"]) mac++;
        else if ([status isEqual:@"trash"]) trash++;
        else if ([status isEqual:@"actions"]) trash += [row[@"renames"] count] + [row[@"trashes"] count];
        else if ([status isEqual:@"hold"]) hold++;
    }
    NSMutableArray *parts = [NSMutableArray array];
    if (receive) [parts addObject:[NSString stringWithFormat:@"받을 예배 %lu개", (unsigned long)receive]];
    if (mac) [parts addObject:[NSString stringWithFormat:@"올릴 예배 %lu개", (unsigned long)mac]];
    if (trash) [parts addObject:[NSString stringWithFormat:@"서버 정리 %lu개", (unsigned long)trash]];
    if (hold) [parts addObject:[NSString stringWithFormat:@"보류 %lu개", (unsigned long)hold]];
    self.statusLabel.stringValue = parts.count ? [parts componentsJoinedByString:@" · "] : @"모두 같음";
    self.connectionLabel.stringValue = [NSString stringWithFormat:@"연결됨%@ · %@", self.server.deviceToken ? @" (장치 열쇠)" : @"", kOrigin];
    [self refreshApplyButton]; [self refreshStatusItem]; [self refreshReview];
}
// 올리기와 받기. 자동(PP6 종료 뒤)은 올리기만 한다. 받기·빼기·문서 정리는 [적용]을 누른 줄만 한다.
// 작업 큐에서 돈다. 반환: {upload, created, apply} 결과
- (NSDictionary *)syncRows:(NSArray *)rows automatic:(BOOL)automatic {
    BOOL presenter = YBPresenterRunning();
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    NSMutableArray *uploadRows = [NSMutableArray array], *applyRows = [NSMutableArray array];
    for (NSDictionary *row in rows) {
        if ([row[@"status"] isEqual:@"mac"] || [row[@"status"] isEqual:@"macNew"] || [row[@"macOnlyDocuments"] count] || [row[@"usageOnly"] count]) [uploadRows addObject:row];
        if (!automatic && ChangesMac(row)) [applyRows addObject:row];
    }
    // 올리기를 받기보다 먼저 한다. 받기가 Mac 것을 덮어도 서버에 남게 한다.
    if (automatic) { if (presenter) return result; result[@"created"] = [self.engine uploadNew]; }
    if (uploadRows.count) result[@"upload"] = [self.engine upload:uploadRows];
    if (applyRows.count && !presenter) result[@"apply"] = [self.engine apply:applyRows];
    return result;
}
static NSString *Summary(NSDictionary *result) {
    NSMutableString *text = [NSMutableString string];
    NSDictionary *upload = result[@"upload"], *apply = result[@"apply"], *created = result[@"created"];
    if ([created[@"created"] count]) [text appendFormat:@"새 문서 올림: %@\n", [created[@"created"] componentsJoinedByString:@", "]];
    if ([created[@"media"] integerValue]) [text appendFormat:@"새 이미지 올림: %@개\n", created[@"media"]];
    if ([created[@"collisions"] count]) [text appendFormat:@"서버에 같은 이름이 있어 올리지 않음(정리 창): %@\n", [created[@"collisions"] componentsJoinedByString:@", "]];
    for (NSString *name in created[@"failed"]) [text appendFormat:@"새 문서 올리기 실패 · %@: %@\n", name, created[@"failed"][name]];
    if ([upload[@"uploaded"] count]) [text appendFormat:@"올림: %@\n", [upload[@"uploaded"] componentsJoinedByString:@", "]];
    if ([upload[@"usage"] integerValue]) [text appendFormat:@"사용일 보고: 문서 %@개\n", upload[@"usage"]];
    for (NSString *name in upload[@"failed"]) [text appendFormat:@"올리기 실패 · %@: %@\n", name, upload[@"failed"][name]];
    if ([apply[@"applied"] count]) [text appendFormat:@"적용함: %@\n", [apply[@"applied"] componentsJoinedByString:@", "]];
    if ([apply[@"images"] integerValue]) [text appendFormat:@"이미지 받음: %@개\n", apply[@"images"]];
    for (NSString *line in apply[@"imageFailed"]) [text appendFormat:@"이미지 받기 실패(문서는 적용함) · %@\n", line];
    for (NSString *name in apply[@"failed"]) [text appendFormat:@"적용 실패 · %@: %@\n", name, apply[@"failed"][name]];
    if ([apply[@"held"] count]) [text appendFormat:@"이력 없는 다른 내용이라 Mac 파일을 그대로 둠(정리 창에서 고르기): %@\n", [apply[@"held"] componentsJoinedByString:@", "]];
    if ([apply[@"revisions"] integerValue]) [text appendFormat:@"Mac 수정본 %@개는 서버에 보관했습니다(웹에서 비교).\n", apply[@"revisions"]];
    for (NSString *line in apply[@"revisionFailed"]) [text appendFormat:@"보관본 올리기 실패(Mac 백업에는 있음) · %@\n", line];
    if ([apply[@"backup"] length]) [text appendFormat:@"\n바꾸기 전 파일은 백업 폴더에 있습니다.\n%@", apply[@"backup"]];
    return text;
}
// 한 회차: (강제가 아니면) 변경 일지 확인 → 비교 → (PP6 종료 뒤면) 올리기 → 다시 비교 → 일지 번호·적용 보고. 적용은 하지 않는다.
- (void)runCycleForce:(BOOL)force upload:(BOOL)upload completion:(void (^)(NSException *error))completion {
    if (self.busy) return;
    self.busy = YES; self.statusLabel.stringValue = force ? @"비교 중" : @"서버 변경 확인 중";
    dispatch_async(self.work, ^{
        NSArray *rows = nil; NSDictionary *synced = nil; NSException *error = nil; NSNumber *head = nil; BOOL compared = NO;
        @try {
            BOOL relevant = force;
            @try { NSDictionary *check = [self.engine checkChanges]; head = check[@"head"]; relevant = relevant || [check[@"relevant"] boolValue]; }
            @catch (NSException *e) {
                if ([e.reason hasPrefix:@"HTTP 401"] || ![e.reason hasPrefix:@"HTTP "]) @throw;   // 입장 필요·네트워크 없음
                // 변경 일지가 없는 서버(2단계 배포 전): 15분마다 전체 비교하지 않고 1시간에 한 번만 한다.
                if (!self.lastFullCompare || -self.lastFullCompare.timeIntervalSinceNow > 3600) relevant = YES;
            }
            if (relevant) {
                rows = [self.engine compare]; compared = YES; self.lastFullCompare = NSDate.date;
                if (upload) {
                    synced = [self syncRows:rows automatic:YES];
                    if (synced.count) rows = [self.engine compare];
                }
            }
            if (head) [self.engine markSeen:head];
            if (rows) { @try { [self.engine reportApplied:head rows:rows]; } @catch (NSException *e) { NSLog(@"applied report: %@", e.reason); } }
        } @catch (NSException *e) { error = e; }
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!error) self.lastCycleAt = NSDate.date;
            self.busy = NO;
            if (rows) [self showRows:rows];
            else if (error) self.statusLabel.stringValue = error.reason ?: @"확인 실패";
            else if (!compared) { self.statusLabel.stringValue = [@"바뀐 것 없음 · " stringByAppendingString:[NSDateFormatter localizedStringFromDate:NSDate.date dateStyle:NSDateFormatterNoStyle timeStyle:NSDateFormatterShortStyle]]; [self refreshStatusItem]; }
            NSString *summary = synced ? Summary(synced) : @"";
            if (summary.length) self.statusLabel.stringValue = [[summary componentsSeparatedByString:@"\n"].firstObject stringByAppendingString:@" (자동)"];
            if (completion) completion(error);
        });
    });
}
- (void)runCompareWithCompletion:(void (^)(NSException *error))completion { [self runCycleForce:YES upload:NO completion:completion]; }
- (void)compareNow:(id)sender {
    if (self.busy) return;
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(startupCompare) object:nil];
    [self runCompareWithCompletion:^(NSException *error) {
        if ([error.reason hasPrefix:@"HTTP 401"]) dispatch_async(dispatch_get_main_queue(), ^{ [self handleLoginRequired]; });
    }];
}
- (void)applyNow:(id)sender {
    if (self.busy) return;
    NSMutableArray *selected = [NSMutableArray array];
    for (NSDictionary *row in self.rows) if ([row[@"checked"] boolValue] && Checkable(row)) [selected addObject:row];
    if (!selected.count) return;
    self.busy = YES; self.statusLabel.stringValue = @"올리기·적용 중";
    dispatch_async(self.work, ^{
        NSDictionary *result = nil; NSException *error = nil;
        @try { result = [self syncRows:selected automatic:NO]; } @catch (NSException *e) { error = e; }
        dispatch_async(dispatch_get_main_queue(), ^{
            self.busy = NO;
            if (error) { [self alert:@"적용하지 못함" text:error.reason]; [self compareNow:nil]; return; }
            NSString *text = Summary(result);
            [self alert:@"완료" text:text.length ? text : @"바뀐 것이 없습니다."];
            [self compareNow:nil];
        });
    });
}

#pragma mark - 정리 창

// 파일 바이트에서 처음 다른 곳(앞뒤 60자). 슬라이드 내용이 같은데 다르다고 나올 때 원인을 찾는 데 쓴다.
static NSString *FirstDifference(NSData *local, NSData *remote) {
    NSString *a = local ? [[NSString alloc] initWithData:local encoding:NSUTF8StringEncoding] : @"", *b = remote ? [[NSString alloc] initWithData:remote encoding:NSUTF8StringEncoding] : @"";
    if (!a || !b) return @"파일 첫 차이: 글자로 읽을 수 없음";
    if ([a isEqual:b]) return @"파일 바이트가 같습니다.";
    NSUInteger i = 0, n = MIN(a.length, b.length);
    while (i < n && [a characterAtIndex:i] == [b characterAtIndex:i]) i++;
    NSUInteger start = i > 60 ? i - 60 : 0;
    NSString *(^cut)(NSString *) = ^NSString *(NSString *text) { return start >= text.length ? @"(끝)" : [[text substringWithRange:NSMakeRange(start, MIN(140, text.length - start))] stringByReplacingOccurrencesOfString:@"\n" withString:@"⏎"]; };
    return [NSString stringWithFormat:@"파일 첫 차이(%lu번째 글자, 크기 Mac %lu · 서버 %lu)\nMac: …%@\n서버: …%@", (unsigned long)i, (unsigned long)local.length, (unsigned long)remote.length, cut(a), cut(b)];
}


static NSString *const kListHold = @"확인 필요", *const kListMacDeleted = @"Mac에서 지움", *const kListArchived = @"서버에서 보관됨",
                *const kListCollision = @"같은 이름, 다른 내용", *const kListExternal = @"외부 참조", *const kListImage = @"이미지 보충", *const kListNumbered = @"번호 붙임";
- (NSArray *)reviewItems {
    NSMutableArray *items = [NSMutableArray array];
    for (NSDictionary *row in self.rows) {
        NSString *status = row[@"status"];
        if ([status isEqual:@"hold"] && [row[@"nodeID"] length]) [items addObject:@{@"list": kListHold, @"title": row[@"name"] ?: @"", @"detail": row[@"reason"] ?: @""}];
        for (NSDictionary *hold in row[@"actionHolds"]) [items addObject:@{@"list": kListHold, @"title": hold[@"path"], @"path": hold[@"path"], @"detail": hold[@"reason"] ?: @""}];
        if ([row[@"macDeleted"] boolValue]) [items addObject:@{@"list": kListMacDeleted, @"title": row[@"name"] ?: @"", @"detail": @"예배 · 데일리 창에서 체크하면 다시 받습니다"}];
        if ([status isEqual:@"archived"]) [items addObject:@{@"list": kListArchived, @"title": row[@"name"] ?: @"", @"detail": [row[@"reason"] stringByAppendingString:@" · Mac에 그대로 둡니다"]}];
    }
    NSDictionary *check = [self.engine lastFullCheck];
    for (NSDictionary *item in check[@"macDeleted"]) [items addObject:@{@"list": kListMacDeleted, @"title": item[@"path"], @"path": item[@"path"], @"detail": @"문서 · 서버에는 사용 중", @"item": item}];
    for (NSDictionary *item in check[@"collisions"]) [items addObject:@{@"list": kListCollision, @"title": item[@"path"], @"path": item[@"path"], @"detail": @"Mac과 서버의 내용이 다르고 같은 이력이 없음", @"item": item}];
    for (NSDictionary *item in check[@"external"]) [items addObject:@{@"list": kListExternal, @"title": item[@"path"], @"path": item[@"path"], @"detail": [item[@"references"] componentsJoinedByString:@", "] ?: @"", @"item": item}];
    for (NSDictionary *item in check[@"imageFill"]) [items addObject:@{@"list": kListImage, @"title": [item[@"path"] lastPathComponent], @"path": item[@"path"], @"detail": @"서버에 있고 이 Mac에 없음", @"item": item}];
    for (NSDictionary *item in [self.engine numberedLog]) [items addObject:@{@"list": kListNumbered, @"title": item[@"path"], @"path": item[@"target"], @"detail": [NSString stringWithFormat:@"Mac 파일 → %@ · %@", item[@"target"], item[@"at"]]}];
    return items;
}
- (void)refreshReview {
    NSUInteger count = 0;
    for (NSDictionary *item in [self reviewItems]) if (![item[@"list"] isEqual:kListArchived] && ![item[@"list"] isEqual:kListNumbered]) count++;
    self.reviewButton.hidden = count == 0;
    self.reviewButton.title = [NSString stringWithFormat:@"확인 필요 %lu · 정리 열기", (unsigned long)count];
    if (self.organizer.visible) [self reloadOrganizer];
}
- (void)runFullCheckIfDue { if ([self.engine fullCheckDue]) [self startFullCheck]; }
// 전체 확인은 읽기만 뒤에서 돌리고(데일리 창 버튼을 잠그지 않음), 영수증 쓰기만 작업 큐에 넣는다.
- (void)startFullCheck {
    if (self.checking) return;
    self.checking = YES; self.organizerStatus.stringValue = @"전체 확인 중";
    YB2Engine *engine = self.engine;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        NSDictionary *scan = nil; NSException *error = nil;
        @try { scan = [engine scanFullCheck]; } @catch (NSException *e) { error = e; }
        void (^finish)(NSException *) = ^(NSException *failure) { dispatch_async(dispatch_get_main_queue(), ^{
            self.checking = NO;
            if (failure) self.statusLabel.stringValue = [@"전체 확인 실패 · " stringByAppendingString:failure.reason ?: @""];
            [self refreshReview]; [self reloadOrganizer];
        }); };
        if (error) { finish(error); return; }
        dispatch_async(self.work, ^{
            NSException *failure = nil;
            @try { if (engine == self.engine) [engine saveFullCheck:scan]; } @catch (NSException *e) { failure = e; }
            finish(failure);
        });
    });
}
- (void)buildOrganizer {
    NSRect frame = NSMakeRect(0, 0, 860, 480);
    self.organizer = [[NSWindow alloc] initWithContentRect:frame styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
    self.organizer.title = @"예배온 Sync 2 · 정리"; self.organizer.releasedWhenClosed = NO; self.organizer.minSize = NSMakeSize(760, 360);
    NSView *content = self.organizer.contentView; CGFloat w = frame.size.width, h = frame.size.height;
    NSTextField *help = Label(@"전체 확인과 비교가 찾은 것입니다. 여기 있는 것은 쌓여 있어도 안전하며, 버튼을 누를 때만 Mac·서버가 바뀝니다.", NSMakeRect(16, h - 30, w - 32, 18), 12);
    [content addSubview:help];
    NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:NSMakeRect(16, 92, w - 32, h - 130)];
    scroll.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable; scroll.hasVerticalScroller = YES; scroll.borderType = NSBezelBorder;
    self.organizerTable = [[NSTableView alloc] initWithFrame:scroll.bounds];
    self.organizerTable.dataSource = self; self.organizerTable.delegate = self; self.organizerTable.rowHeight = 22; self.organizerTable.allowsMultipleSelection = YES;
    self.organizerTable.columnAutoresizingStyle = NSTableViewLastColumnOnlyAutoresizingStyle;
    for (NSArray *spec in @[@[@"list", @"구분", @150], @[@"title", @"항목", @260], @[@"detail", @"설명", @380]]) {
        NSTableColumn *column = [[NSTableColumn alloc] initWithIdentifier:spec[0]]; column.title = spec[1]; column.width = [spec[2] doubleValue]; column.editable = NO;
        [self.organizerTable addTableColumn:column];
    }
    scroll.documentView = self.organizerTable; [content addSubview:scroll];
    NSArray *actions = @[@[@"diff", @"차이 보기"], @[@"server", @"서버 것으로"], @[@"mac", @"Mac 것 올리기"], @[@"number", @"번호 붙여 둘 다 두기"], @[@"trash", @"서버 휴지통으로"], @[@"image", @"이미지 받기"], @[@"web", @"웹에서 보기"]];
    NSMutableDictionary *buttons = [NSMutableDictionary dictionary]; CGFloat x = 16;
    for (NSArray *spec in actions) {
        NSButton *button = Button(spec[1], NSMakeRect(x, 50, [spec[1] length] * 13 + 28, 28), self, @selector(organizerAction:));
        button.identifier = spec[0]; button.autoresizingMask = NSViewMaxXMargin | NSViewMaxYMargin; button.enabled = NO;
        [content addSubview:button]; buttons[spec[0]] = button; x += button.frame.size.width + 6;
    }
    self.organizerButtons = buttons;
    NSButton *check = Button(@"전체 확인 지금", NSMakeRect(16, 14, 130, 28), self, @selector(fullCheckNow:)); check.autoresizingMask = NSViewMaxXMargin | NSViewMaxYMargin;
    NSButton *undo = Button(@"마지막 적용 되돌리기", NSMakeRect(152, 14, 170, 28), self, @selector(undoLastApply:)); undo.autoresizingMask = NSViewMaxXMargin | NSViewMaxYMargin;
    NSButton *backups = Button(@"백업 폴더", NSMakeRect(328, 14, 100, 28), self, @selector(openBackups:)); backups.autoresizingMask = NSViewMaxXMargin | NSViewMaxYMargin;
    self.organizerStatus = Label(@"", NSMakeRect(436, 20, w - 452, 18), 12); self.organizerStatus.autoresizingMask = NSViewWidthSizable | NSViewMaxYMargin;
    [content addSubview:check]; [content addSubview:undo]; [content addSubview:backups]; [content addSubview:self.organizerStatus];
}
- (void)showOrganizer:(id)sender {
    if (!self.organizer) [self buildOrganizer];
    [self reloadOrganizer];
    [self.organizer makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES];
}
- (void)reloadOrganizer {
    self.organizerRows = [[self reviewItems] mutableCopy];
    [self.organizerTable reloadData];
    NSDictionary *check = [self.engine lastFullCheck], *last = [self.engine lastApply];
    NSString *at = check[@"at"] ? [check[@"at"] stringByReplacingOccurrencesOfString:@"T" withString:@" "] : @"아직 없음";
    self.organizerStatus.stringValue = [NSString stringWithFormat:@"지난 전체 확인 %@%@", at, last ? [NSString stringWithFormat:@" · 되돌릴 수 있는 적용 %@", [last[@"at"] stringByReplacingOccurrencesOfString:@"T" withString:@" "]] : @""];
    [self refreshOrganizerButtons];
}
- (NSDictionary *)selectedReview {
    NSArray *items = [self selectedReviews];
    return items.count == 1 ? items[0] : nil;
}
- (NSArray *)selectedReviews {
    NSMutableArray *items = [NSMutableArray array];
    [self.organizerTable.selectedRowIndexes enumerateIndexesUsingBlock:^(NSUInteger index, BOOL *stop) { if (index < self.organizerRows.count) [items addObject:self.organizerRows[index]]; }];
    return items;
}
// 여러 줄을 골라도 되는 버튼(서버 것으로·Mac 것 올리기·서버 휴지통으로·이미지 받기)은 고른 줄이 모두 같은 구분일 때 켠다.
- (void)refreshOrganizerButtons {
    NSArray *items = [self selectedReviews]; NSDictionary *item = items.count == 1 ? items[0] : nil;
    NSSet *lists = [NSSet setWithArray:[items valueForKey:@"list"]]; NSString *list = lists.count == 1 ? lists.anyObject : nil;
    BOOL idle = !self.busy, docs = items.count > 0, single = item != nil;
    for (NSDictionary *each in items) if (![each[@"path"] hasSuffix:@".pro6"]) docs = NO;
    BOOL collision = [list isEqual:kListCollision], held = [list isEqual:kListHold] && docs;
    BOOL numberedGone = [list isEqual:kListNumbered];
    for (NSDictionary *each in items) if ([self.engine hasLocalDocument:each[@"path"]]) numberedGone = NO;
    NSDictionary *enabled = @{@"diff": @(single && (collision || held)), @"server": @(collision), @"mac": @(collision), @"number": @(single && collision),
                              @"trash": @((([list isEqual:kListMacDeleted]) || numberedGone) && docs), @"image": @([list isEqual:kListImage]), @"web": @(single && docs && [self.engine webLink:item[@"path"]] != nil)};
    for (NSString *key in self.organizerButtons) [self.organizerButtons[key] setEnabled:idle && [enabled[key] boolValue]];
}
// 작업 큐에서 돌리고 끝나면 목록을 새로 그린다.
- (void)runOrganizer:(NSString *)message task:(id (^)(void))task done:(void (^)(id result))done {
    if (self.busy) return;
    self.busy = YES; self.statusLabel.stringValue = message; self.organizerStatus.stringValue = message;
    dispatch_async(self.work, ^{
        id result = nil; NSException *error = nil;
        @try { result = task(); } @catch (NSException *e) { error = e; }
        dispatch_async(dispatch_get_main_queue(), ^{
            self.busy = NO; self.statusLabel.stringValue = error ? error.reason : @"완료";
            [self refreshReview]; [self reloadOrganizer];
            if (error) [self alert:@"하지 못함" text:error.reason];
            else if (done) done(result);
        });
    });
}
- (void)fullCheckNow:(id)sender { [self startFullCheck]; }
- (void)undoLastApply:(id)sender {
    NSDictionary *last = [self.engine lastApply];
    if (!last) { [self alert:@"되돌릴 적용이 없습니다" text:@"가장 최근 적용 하나만 되돌릴 수 있고, 이미 되돌렸으면 다시 할 수 없습니다."]; return; }
    NSAlert *confirm = [NSAlert new]; confirm.messageText = @"마지막 적용을 되돌릴까요?";
    confirm.informativeText = [NSString stringWithFormat:@"%@\n%@\n\n적용 뒤 다시 바뀐 파일은 건너뜁니다. 적용 때 새로 받은 문서는 macOS 휴지통으로 옮깁니다. PP6를 종료해 주세요.", [last[@"at"] stringByReplacingOccurrencesOfString:@"T" withString:@" "], [last[@"applied"] componentsJoinedByString:@", "]];
    [confirm addButtonWithTitle:@"되돌리기"]; [confirm addButtonWithTitle:@"취소"];
    if ([confirm runModal] != NSAlertFirstButtonReturn) return;
    [self runOrganizer:@"되돌리는 중" task:^id{ return [self.engine undoLastApply]; } done:^(NSDictionary *result) {
        NSMutableString *text = [NSMutableString string];
        if ([result[@"restored"] count]) [text appendFormat:@"되돌림: %@\n", [result[@"restored"] componentsJoinedByString:@", "]];
        if ([result[@"skipped"] count]) [text appendFormat:@"건너뜀: %@\n", [result[@"skipped"] componentsJoinedByString:@", "]];
        [self alert:@"되돌렸습니다" text:[text stringByAppendingString:@"\n데일리 창에서 다시 비교합니다."]];
        [self compareNow:nil];
    }];
}
- (void)organizerAction:(NSButton *)sender {
    NSArray *items = [self selectedReviews]; NSDictionary *item = items.firstObject; NSString *path = item[@"path"], *action = sender.identifier;
    if (!item) return;
    if ([action isEqual:@"web"]) { NSString *link = [self.engine webLink:path]; if (link) [NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:link]]; return; }
    if ([action isEqual:@"diff"]) {
        [self runOrganizer:@"차이 준비 중" task:^id{
            NSData *local = YBReadSafeFile(self.root, path, NULL), *remote = [self.engine serverBytes:path];
            NSDictionary *a = local ? PP6ParseDocumentData(local, path, @[], @{}, @[], @{}, YES) : nil, *b = remote ? PP6ParseDocumentData(remote, path, @[], @{}, @[], @{}, YES) : nil;
            YBRequire(![a[@"parseError"] length] && ![b[@"parseError"] length], @"문서 내용을 분석하지 못했습니다.");
            return @{@"local": a ?: @{}, @"remote": b ?: @{}, @"bytes": FirstDifference(local, remote)};
        } done:^(NSDictionary *result) {
            NSAlert *alert = [NSAlert new]; alert.messageText = [@"문서 비교 · " stringByAppendingString:path];
            alert.informativeText = [@"슬라이드를 골라 양쪽 내용을 보세요. 정하는 것은 정리 창 버튼으로 합니다.\n\n" stringByAppendingString:result[@"bytes"]];
            alert.accessoryView = [[YBDocumentComparison alloc] initWithLocal:result[@"local"] remote:result[@"remote"]];
            [alert addButtonWithTitle:@"닫기"]; [alert runModal];
        }];
        return;
    }
    NSDictionary *words = @{@"server": @"서버 것으로 바꿀까요? Mac 것은 백업 폴더와 서버 보관본에 남습니다.", @"mac": @"Mac 것을 서버의 새 버전으로 올릴까요? 서버의 그전 내용은 이력에 남습니다.",
                            @"number": @"Mac 파일에 번호를 붙여(예: 이름 2) 둘 다 둘까요? 재생목록 참조도 고치고, 원래 이름에는 서버 것을 받습니다.", @"trash": @"서버 휴지통으로 옮길까요? 웹 휴지통에서 꺼낼 수 있습니다.", @"image": @"서버에서 이 이미지를 받아 그 자리에 둘까요?"};
    NSAlert *confirm = [NSAlert new]; confirm.messageText = items.count == 1 ? (item[@"title"] ?: @"") : [NSString stringWithFormat:@"%lu개 항목", (unsigned long)items.count];
    confirm.informativeText = words[action] ?: @"";
    [confirm addButtonWithTitle:@"진행"]; [confirm addButtonWithTitle:@"취소"];
    if ([confirm runModal] != NSAlertFirstButtonReturn) return;
    if ([action isEqual:@"number"]) {
        [self runOrganizer:@"정리 중" task:^id{ return [self.engine keepBothNumbered:path]; } done:^(id result) { [self alert:@"번호를 붙였습니다" text:[NSString stringWithFormat:@"Mac 파일은 ‘%@’(으)로 서버에 올렸고, ‘%@’에는 서버 것을 받았습니다.", result, path]]; }];
        return;
    }
    // 여러 개: 하나씩 처리하고 실패한 것만 모아 보여 준다.
    [self runOrganizer:@"정리 중" task:^id{
        NSMutableArray *failures = [NSMutableArray array]; NSUInteger index = 0;
        for (NSDictionary *each in items) {
            index++; NSString *target = each[@"path"];
            dispatch_async(dispatch_get_main_queue(), ^{ self.organizerStatus.stringValue = [NSString stringWithFormat:@"정리 중 %lu/%lu", (unsigned long)index, (unsigned long)items.count]; });
            @try {
                if ([action isEqual:@"server"]) [self.engine takeServer:target];
                else if ([action isEqual:@"mac"]) [self.engine takeMac:target];
                else if ([action isEqual:@"trash"]) [self.engine trashOnServer:target];
                else if ([action isEqual:@"image"]) [self.engine fetchImage:each[@"item"]];
            } @catch (NSException *e) { [failures addObject:[NSString stringWithFormat:@"%@: %@", target.lastPathComponent, e.reason]]; }
        }
        return failures;
    } done:^(NSArray *failures) {
        if (failures.count) [self alert:[NSString stringWithFormat:@"%lu개는 하지 못함", (unsigned long)failures.count] text:[failures componentsJoinedByString:@"\n"]];
        if ([action isEqual:@"server"] || [action isEqual:@"mac"]) [self compareNow:nil];
    }];
}
- (void)tableViewSelectionDidChange:(NSNotification *)note { if (note.object == self.organizerTable) [self refreshOrganizerButtons]; }

#pragma mark - 메뉴 막대·설정

- (void)buildStatusItem {
    self.statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
    self.statusItem.button.title = @"예배온";
    // 메뉴 막대 아이콘은 상주용으로 짧게: 지금 상태 한 줄, 창 열기, (새 버전이 있을 때만) 설치, 종료. 나머지 동작은 창과 앱 메뉴에 있다.
    NSMenu *menu = [NSMenu new];
    self.statusLineItem = [menu addItemWithTitle:@"확인 전" action:nil keyEquivalent:@""]; self.statusLineItem.enabled = NO;
    [menu addItem:NSMenuItem.separatorItem];
    [menu addItemWithTitle:@"예배온 Sync 2 창 열기" action:@selector(showWindow:) keyEquivalent:@""];
    self.statusUpdateItem = [menu addItemWithTitle:@"새 버전 설치…" action:@selector(installUpdate:) keyEquivalent:@""]; self.statusUpdateItem.hidden = YES;
    [menu addItem:NSMenuItem.separatorItem];
    [menu addItemWithTitle:@"예배온 Sync 2 종료" action:@selector(terminate:) keyEquivalent:@""];
    for (NSMenuItem *item in menu.itemArray) if (item.action != @selector(terminate:)) item.target = self;
    self.statusItem.menu = menu;
}
- (void)showWindow:(id)sender { [self.window makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES]; }
- (void)toggleResident:(id)sender {
    [NSUserDefaults.standardUserDefaults setBool:!self.resident forKey:kResidentKey];
    if (self.resident) [self residentTick];
}
- (NSString *)agentPath { return [NSHomeDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"Library/LaunchAgents/%@.plist", kAgentLabel]]; }
// 로그인 항목: ~/Library/LaunchAgents의 plist. 10.13에서 도우미 앱 없이 된다. 다음 로그인부터 적용된다.
- (void)toggleLoginItem:(id)sender {
    NSString *path = self.agentPath;
    if ([NSFileManager.defaultManager fileExistsAtPath:path]) { [NSFileManager.defaultManager removeItemAtPath:path error:NULL]; return; }
    NSDictionary *agent = @{@"Label": kAgentLabel, @"ProgramArguments": @[@"/usr/bin/open", @"-g", NSBundle.mainBundle.bundlePath], @"RunAtLoad": @YES};
    [NSFileManager.defaultManager createDirectoryAtPath:path.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:NULL];
    if (![agent writeToFile:path atomically:YES]) [self alert:@"로그인 시 실행을 설정하지 못했습니다" text:path];
}
- (BOOL)validateMenuItem:(NSMenuItem *)item {
    if (item.action == @selector(toggleResident:)) item.state = self.resident ? NSControlStateValueOn : NSControlStateValueOff;
    if (item.action == @selector(toggleLoginItem:)) item.state = [NSFileManager.defaultManager fileExistsAtPath:self.agentPath] ? NSControlStateValueOn : NSControlStateValueOff;
    if (item.action == @selector(compareNow:)) return !self.busy;
    return YES;
}

#pragma mark - 설정 변경

- (void)chooseRoot:(id)sender {
    if (self.busy) return;
    NSOpenPanel *panel = [NSOpenPanel openPanel]; panel.canChooseDirectories = YES; panel.canChooseFiles = NO; panel.allowsMultipleSelection = NO;
    panel.message = @"ProPresenter 문서 폴더를 고르세요"; panel.directoryURL = [NSURL fileURLWithPath:self.root];
    if ([panel runModal] != NSModalResponseOK) return;
    [NSUserDefaults.standardUserDefaults setObject:panel.URL.path forKey:kRootKey];
    [self rebuildEngine]; [self compareNow:nil];
}
- (void)choosePlaylist:(id)sender {
    if (self.busy) return;
    NSOpenPanel *panel = [NSOpenPanel openPanel]; panel.canChooseDirectories = NO; panel.canChooseFiles = YES; panel.allowsMultipleSelection = NO;
    panel.allowedFileTypes = @[@"pro6pl"]; panel.message = @"기본 .pro6pl 파일을 고르세요"; panel.directoryURL = self.playlistURL.URLByDeletingLastPathComponent;
    if ([panel runModal] != NSModalResponseOK) return;
    [NSUserDefaults.standardUserDefaults setObject:panel.URL.path forKey:kPlaylistKey];
    [self rebuildEngine]; [self compareNow:nil];
}
- (void)openBackups:(id)sender {
    NSString *path = [self.profile stringByAppendingPathComponent:@"backups"];
    [NSFileManager.defaultManager createDirectoryAtPath:path withIntermediateDirectories:YES attributes:nil error:NULL];
    [NSWorkspace.sharedWorkspace openFile:path];
}

#pragma mark - 표

- (NSInteger)numberOfRowsInTableView:(NSTableView *)table { return table == self.organizerTable ? self.organizerRows.count : self.rows.count; }
static NSString *StatusText(NSDictionary *row) {
    NSString *status = row[@"status"];
    if ([status isEqual:@"hold"]) return [@"보류 · " stringByAppendingString:row[@"reason"] ?: @""];
    if ([status isEqual:@"same"]) return @"같음";
    if ([status isEqual:@"archived"]) return row[@"reason"] ?: @"서버에서 보관됨";
    if ([status isEqual:@"trash"]) return @"서버 휴지통에 넣음 · 적용하면 Mac 재생목록에서 뺌";
    if ([status isEqual:@"macNew"]) return @"Mac에서 만든 예배 · 서버에 추가";
    if ([status isEqual:@"actions"]) {
        NSMutableArray *parts = [NSMutableArray array];
        if ([row[@"renames"] count]) [parts addObject:[NSString stringWithFormat:@"이름 바꾸기 %lu", (unsigned long)[row[@"renames"] count]]];
        if ([row[@"trashes"] count]) [parts addObject:[NSString stringWithFormat:@"휴지통으로 %lu", (unsigned long)[row[@"trashes"] count]]];
        if ([row[@"actionHolds"] count]) [parts addObject:[NSString stringWithFormat:@"확인 필요 %lu(정리 창)", (unsigned long)[row[@"actionHolds"] count]]];
        return [parts componentsJoinedByString:@" · "];
    }
    if ([status isEqual:@"mac"]) {
        NSMutableArray *up = [NSMutableArray array];
        if ([row[@"macRenamed"] boolValue]) [up addObject:@"이름"];
        if ([row[@"macOnlyOrder"] boolValue] && ![row[@"macRenamed"] boolValue]) [up addObject:@"순서"];
        if ([row[@"macOnlyDocuments"] count]) [up addObject:[NSString stringWithFormat:@"문서 %lu", (unsigned long)[row[@"macOnlyDocuments"] count]]];
        if ([row[@"usageOnly"] count]) [up addObject:[NSString stringWithFormat:@"사용일 %lu", (unsigned long)[row[@"usageOnly"] count]]];
        NSString *text = [@"Mac에서 바뀜 · 올리기: " stringByAppendingString:[up componentsJoinedByString:@" · "]];
        return [row[@"images"] count] ? [text stringByAppendingFormat:@" · 이미지 %lu개 받기", (unsigned long)[row[@"images"] count]] : text;
    }
    // 받을 줄: 짧은 표시. 자세한 설명은 마우스를 올리면 나온다(DetailText).
    NSMutableArray *parts = [NSMutableArray array];
    NSUInteger both = 0, unknown = 0;
    for (NSString *path in row[@"macChangedDocuments"]) { if ([row[@"macChangedReasons"][path] isEqual:@"technical"]) unknown++; else both++; }
    NSUInteger plain = [row[@"documents"] count] - MIN([row[@"documents"] count], both + unknown);
    if ([row[@"macDeleted"] boolValue]) [parts addObject:@"Mac에서 지운 예배"];
    else if ([row[@"serverNew"] boolValue]) [parts addObject:@"서버에 새로 생김"];
    else if ([row[@"orderChanged"] boolValue]) [parts addObject:row[@"renamedFrom"] ? @"이름·순서" : @"순서"];
    if (plain) [parts addObject:[NSString stringWithFormat:@"받기 %lu", (unsigned long)plain]];
    if ([row[@"macOnlyDocuments"] count]) [parts addObject:[NSString stringWithFormat:@"올리기 %lu", (unsigned long)[row[@"macOnlyDocuments"] count]]];
    if (both) [parts addObject:[NSString stringWithFormat:@"양쪽 수정 %lu", (unsigned long)both]];
    if (unknown) [parts addObject:[NSString stringWithFormat:@"이력 없음 %lu", (unsigned long)unknown]];
    if ([row[@"revertedOrder"] boolValue] || [row[@"revertedDocuments"] count]) [parts addObject:@"되돌림 다시 적용"];
    if ([row[@"images"] count]) [parts addObject:[NSString stringWithFormat:@"이미지 %lu", (unsigned long)[row[@"images"] count]]];
    return [parts componentsJoinedByString:@" · "];
}
// 마우스를 올렸을 때 보이는 자세한 설명
static NSString *DetailText(NSDictionary *row) {
    if (![row[@"status"] isEqual:@"receive"]) return StatusText(row);
    NSMutableArray *lines = [NSMutableArray array];
    if ([row[@"macDeleted"] boolValue]) [lines addObject:@"Mac에서 지운 예배입니다. 체크하면 서버 것을 다시 받습니다."];
    else if ([row[@"serverNew"] boolValue]) [lines addObject:@"서버에 새로 생긴 예배입니다."];
    else if ([row[@"orderChanged"] boolValue]) [lines addObject:[row[@"macOrderChanged"] boolValue] ? @"순서: 서버 것을 받습니다. Mac 순서는 서버 보관본에 남깁니다." : @"순서: 서버 것을 받습니다."];
    if (row[@"renamedFrom"]) [lines addObject:[NSString stringWithFormat:@"이름: ‘%@’ → 서버 이름", row[@"renamedFrom"]]];
    for (NSString *path in row[@"macOnlyDocuments"]) [lines addObject:[@"올리기(Mac에서만 고침): " stringByAppendingString:path]];
    for (NSString *path in row[@"macChangedDocuments"]) [lines addObject:[row[@"macChangedReasons"][path] isEqual:@"technical"]
        ? [@"이력 없음(Sync가 받은 적 없고 서버와 내용이 다름) · 사용일만 다르면 받고, 아니면 Mac 파일을 그대로 두고 정리 창으로: " stringByAppendingString:path]
        : [@"양쪽 수정 · 서버 것을 받고 Mac 것은 서버 보관본·백업에: " stringByAppendingString:path]];
    for (NSDictionary *doc in row[@"documents"]) if (![row[@"macChangedDocuments"] containsObject:doc[@"path"]]) [lines addObject:[@"받기: " stringByAppendingString:doc[@"path"]]];
    if ([row[@"macDeletedDocuments"] count]) [lines addObject:[NSString stringWithFormat:@"Mac에서 지운 문서 %lu개는 적용하면 다시 받습니다.", (unsigned long)[row[@"macDeletedDocuments"] count]]];
    if ([row[@"missingServer"] unsignedIntegerValue]) [lines addObject:[NSString stringWithFormat:@"서버에 원본 없는 문서 %@개는 Mac 파일 그대로", row[@"missingServer"]]];
    if ([row[@"missingLocal"] count]) [lines addObject:[NSString stringWithFormat:@"Mac에도 없는 문서 %lu개", (unsigned long)[row[@"missingLocal"] count]]];
    return [lines componentsJoinedByString:@"\n"];
}
- (NSString *)tableView:(NSTableView *)table toolTipForCell:(NSCell *)cell rect:(NSRectPointer)rect tableColumn:(NSTableColumn *)column row:(NSInteger)index mouseLocation:(NSPoint)point {
    if (table == self.organizerTable) { NSDictionary *item = self.organizerRows[index]; return [NSString stringWithFormat:@"%@\n%@", item[@"title"] ?: @"", item[@"detail"] ?: @""]; }
    return DetailText(self.rows[index]);
}
- (id)tableView:(NSTableView *)table objectValueForTableColumn:(NSTableColumn *)column row:(NSInteger)index {
    if (table == self.organizerTable) return self.organizerRows[index][column.identifier] ?: @"";
    NSDictionary *row = self.rows[index]; NSString *identifier = column.identifier;
    if ([identifier isEqual:@"checked"]) return row[@"checked"];
    if ([identifier isEqual:@"name"]) return row[@"name"];
    if ([identifier isEqual:@"status"]) return StatusText(row);
    NSString *at = row[@"updatedAt"], *by = row[@"updatedBy"];
    return at.length ? [NSString stringWithFormat:@"%@ · %@", by ?: @"", [at stringByReplacingOccurrencesOfString:@"T" withString:@" "]] : @"";
}
- (void)tableView:(NSTableView *)table setObjectValue:(id)value forTableColumn:(NSTableColumn *)column row:(NSInteger)index {
    if (table == self.organizerTable) return;
    if (self.busy || ![column.identifier isEqual:@"checked"]) return;
    NSMutableDictionary *row = self.rows[index];
    if (Checkable(row)) row[@"checked"] = @([value boolValue]);
    [self refreshApplyButton];
}
- (void)tableView:(NSTableView *)table willDisplayCell:(id)cell forTableColumn:(NSTableColumn *)column row:(NSInteger)index {
    if (table == self.organizerTable) return;
    NSDictionary *row = self.rows[index];
    if ([column.identifier isEqual:@"checked"]) [cell setEnabled:!self.busy && Checkable(row)];
    if ([column.identifier isEqual:@"status"] && [cell isKindOfClass:NSTextFieldCell.class]) {
        NSString *status = row[@"status"];
        [cell setTextColor:Checkable(row) ? [NSColor colorWithCalibratedRed:0.10 green:0.35 blue:0.75 alpha:1] : [status isEqual:@"hold"] ? [NSColor colorWithCalibratedRed:0.75 green:0.35 blue:0.10 alpha:1] : NSColor.disabledControlTextColor];
    }
}
- (BOOL)tableView:(NSTableView *)table shouldSelectRow:(NSInteger)index { return table == self.organizerTable; }

- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)app {
    if (self.busy) { self.statusLabel.stringValue = @"작업 중에는 종료할 수 없습니다. 끝난 뒤 다시 종료해 주세요."; return NSTerminateCancel; }
    return NSTerminateNow;
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)app { return !self.resident; }
- (BOOL)applicationShouldHandleReopen:(NSApplication *)app hasVisibleWindows:(BOOL)visible { [self showWindow:nil]; return YES; }
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = NSApplication.sharedApplication;
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        YB2App *delegate = [YB2App new]; app.delegate = delegate;
        [app run];
    }
    return 0;
}
