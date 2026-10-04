#import <Cocoa/Cocoa.h>
#import "YB2Engine.h"
#import "YB2Server.h"

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
@property(nonatomic) NSButton *compareButton, *applyButton;
@property(nonatomic) YB2Server *server;
@property(nonatomic) NSStatusItem *statusItem;
@property(nonatomic) NSDate *lastFullCompare;        // 서버에 변경 일지가 없을 때(배포 전) 1시간에 한 번만 비교하기 위해
@property(nonatomic) YB2Engine *engine;
@property(nonatomic) NSMutableArray *rows;           // compare 결과 + @"checked"
@property(nonatomic) BOOL busy;
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

    self.connectionLabel = Label(@"서버 연결 확인 중", NSMakeRect(16, h - 32, w - 32, 18), 12);
    self.rootLabel = Label(@"", NSMakeRect(16, h - 54, w - 120, 18), 12);
    self.playlistLabel = Label(@"", NSMakeRect(16, h - 76, w - 120, 18), 12);
    NSButton *rootChange = Button(@"변경…", NSMakeRect(w - 96, h - 58, 80, 24), self, @selector(chooseRoot:));
    NSButton *playlistChange = Button(@"변경…", NSMakeRect(w - 96, h - 80, 80, 24), self, @selector(choosePlaylist:));
    rootChange.autoresizingMask = playlistChange.autoresizingMask = NSViewMinXMargin | NSViewMinYMargin;
    [content addSubview:self.connectionLabel]; [content addSubview:self.rootLabel]; [content addSubview:self.playlistLabel];
    [content addSubview:rootChange]; [content addSubview:playlistChange];

    NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:NSMakeRect(16, 52, w - 32, h - 140)];
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
}
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
    [tools addItemWithTitle:@"백업 폴더 열기" action:@selector(openBackups:) keyEquivalent:@""];
    [tools addItem:NSMenuItem.separatorItem];
    [tools addItemWithTitle:@"상주 확인 (15분마다)" action:@selector(toggleResident:) keyEquivalent:@""];
    [tools addItemWithTitle:@"로그인 시 실행" action:@selector(toggleLoginItem:) keyEquivalent:@""];
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
        if (!error) return;
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
static BOOL ChangesMac(NSDictionary *row) { return [@[@"receive", @"trash", @"actions"] containsObject:row[@"status"] ?: @""]; }

- (void)setBusy:(BOOL)busy {
    _busy = busy;
    self.compareButton.enabled = !busy;
    [self.table reloadData];
    [self refreshApplyButton];
    [self refreshStatusItem];
}
- (void)refreshPresenterState {
    BOOL running = YBPresenterRunning();
    self.presenterLabel.stringValue = running ? @"PP6 실행 중 · 닫으면 적용" : @"PP6 꺼져 있음";
    [self refreshApplyButton];
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
    self.statusItem.button.title = title;
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
    [self refreshApplyButton]; [self refreshStatusItem];
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
    for (NSString *name in apply[@"failed"]) [text appendFormat:@"적용 실패 · %@: %@\n", name, apply[@"failed"][name]];
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

#pragma mark - 메뉴 막대·설정

- (void)buildStatusItem {
    self.statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
    self.statusItem.button.title = @"예배온";
    NSMenu *menu = [NSMenu new];
    [menu addItemWithTitle:@"예배온 Sync 2 창 열기" action:@selector(showWindow:) keyEquivalent:@""];
    [menu addItemWithTitle:@"지금 확인" action:@selector(compareNow:) keyEquivalent:@""];
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

- (NSInteger)numberOfRowsInTableView:(NSTableView *)table { return self.rows.count; }
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
        return [@"Mac에서 바뀜 · 올리기: " stringByAppendingString:[up componentsJoinedByString:@" · "]];
    }
    NSMutableArray *parts = [NSMutableArray array];
    if ([row[@"macDeleted"] boolValue]) [parts addObject:@"Mac에서 삭제한 재생목록 · 체크하면 다시 받음"];
    else if ([row[@"serverNew"] boolValue]) [parts addObject:@"서버에 새로 생김"];
    else if ([row[@"orderChanged"] boolValue]) [parts addObject:[row[@"macOrderChanged"] boolValue] ? @"순서 (Mac 순서는 백업)" : @"순서"];
    if (row[@"renamedFrom"]) [parts addObject:[NSString stringWithFormat:@"이름 ‘%@’ → 서버 이름", row[@"renamedFrom"]]];
    if ([row[@"macDeletedDocuments"] count] && ![row[@"macDeleted"] boolValue]) [parts addObject:[NSString stringWithFormat:@"문서 %lu개는 Mac에서 지운 것 · 적용하면 다시 받음", (unsigned long)[row[@"macDeletedDocuments"] count]]];
    NSUInteger docs = [row[@"documents"] count], backup = [row[@"macChangedDocuments"] count], missingServer = [row[@"missingServer"] unsignedIntegerValue], missingLocal = [row[@"missingLocal"] count];
    if (docs) [parts addObject:[NSString stringWithFormat:@"문서 %lu", (unsigned long)docs]];
    if ([row[@"macOnlyDocuments"] count]) [parts addObject:[NSString stringWithFormat:@"Mac에서만 바뀐 문서 %lu 올리기", (unsigned long)[row[@"macOnlyDocuments"] count]]];
    if ([row[@"revertedOrder"] boolValue] || [row[@"revertedDocuments"] count]) [parts addObject:@"PP6가 옛 내용을 다시 씀 · 다시 적용"];
    if (backup) [parts addObject:[NSString stringWithFormat:@"Mac 수정본 %lu은 서버에 보관", (unsigned long)backup]];
    if (missingServer) [parts addObject:[NSString stringWithFormat:@"원본 없음 %lu (Mac 파일 그대로)", (unsigned long)missingServer]];
    if (missingLocal) [parts addObject:[NSString stringWithFormat:@"Mac에도 없음 %lu", (unsigned long)missingLocal]];
    return [parts componentsJoinedByString:@" · "];
}
- (id)tableView:(NSTableView *)table objectValueForTableColumn:(NSTableColumn *)column row:(NSInteger)index {
    NSDictionary *row = self.rows[index]; NSString *identifier = column.identifier;
    if ([identifier isEqual:@"checked"]) return row[@"checked"];
    if ([identifier isEqual:@"name"]) return row[@"name"];
    if ([identifier isEqual:@"status"]) return StatusText(row);
    NSString *at = row[@"updatedAt"], *by = row[@"updatedBy"];
    return at.length ? [NSString stringWithFormat:@"%@ · %@", by ?: @"", [at stringByReplacingOccurrencesOfString:@"T" withString:@" "]] : @"";
}
- (void)tableView:(NSTableView *)table setObjectValue:(id)value forTableColumn:(NSTableColumn *)column row:(NSInteger)index {
    if (self.busy || ![column.identifier isEqual:@"checked"]) return;
    NSMutableDictionary *row = self.rows[index];
    if (Checkable(row)) row[@"checked"] = @([value boolValue]);
    [self refreshApplyButton];
}
- (void)tableView:(NSTableView *)table willDisplayCell:(id)cell forTableColumn:(NSTableColumn *)column row:(NSInteger)index {
    NSDictionary *row = self.rows[index];
    if ([column.identifier isEqual:@"checked"]) [cell setEnabled:!self.busy && Checkable(row)];
    if ([column.identifier isEqual:@"status"] && [cell isKindOfClass:NSTextFieldCell.class]) {
        NSString *status = row[@"status"];
        [cell setTextColor:Checkable(row) ? [NSColor colorWithCalibratedRed:0.10 green:0.35 blue:0.75 alpha:1] : [status isEqual:@"hold"] ? [NSColor colorWithCalibratedRed:0.75 green:0.35 blue:0.10 alpha:1] : NSColor.disabledControlTextColor];
    }
}
- (BOOL)tableView:(NSTableView *)table shouldSelectRow:(NSInteger)index { return NO; }

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
