#import <Cocoa/Cocoa.h>
#import "YB2Engine.h"

// 예배온 Sync 2 · 1차: 창 하나. 예배 목록을 서버와 비교하고, 고른 예배를 받는다.
static NSString *const kOrigin = @"https://yebaeon.grace-jean-p.workers.dev";
static NSString *const kRootKey = @"documentsRoot", *const kPlaylistKey = @"playlistPath";

@interface YB2App : NSObject <NSApplicationDelegate, NSTableViewDataSource, NSTableViewDelegate>
@property(nonatomic) NSWindow *window;
@property(nonatomic) NSTextField *connectionLabel, *rootLabel, *playlistLabel, *statusLabel, *presenterLabel;
@property(nonatomic) NSTableView *table;
@property(nonatomic) NSButton *compareButton, *applyButton;
@property(nonatomic) YBServer *server;
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
    NSArray *columns = @[@[@"checked", @"적용", @44], @[@"name", @"예배", @200], @[@"status", @"받을 것", @300], @[@"updated", @"서버 저장", @200]];
    for (NSArray *spec in columns) {
        NSTableColumn *column = [[NSTableColumn alloc] initWithIdentifier:spec[0]];
        column.title = spec[1]; column.width = [spec[2] doubleValue]; column.editable = [spec[0] isEqual:@"checked"];
        if ([spec[0] isEqual:@"checked"]) { NSButtonCell *cell = [NSButtonCell new]; [cell setButtonType:NSButtonTypeSwitch]; cell.title = @""; column.dataCell = cell; }
        [self.table addTableColumn:column];
    }
    scroll.documentView = self.table; [content addSubview:scroll];

    self.statusLabel = Label(@"", NSMakeRect(16, 16, w - 300, 18), 12); self.statusLabel.autoresizingMask = NSViewWidthSizable | NSViewMaxYMargin;
    self.presenterLabel = Label(@"", NSMakeRect(w - 420, 16, 160, 18), 12); self.presenterLabel.autoresizingMask = NSViewMinXMargin | NSViewMaxYMargin; self.presenterLabel.alignment = NSTextAlignmentRight;
    self.compareButton = Button(@"다시 비교", NSMakeRect(w - 250, 10, 110, 28), self, @selector(compareNow:));
    self.applyButton = Button(@"적용", NSMakeRect(w - 130, 10, 114, 28), self, @selector(applyNow:));
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
    toolsItem.submenu = tools;
    NSApp.mainMenu = bar;
}

#pragma mark - 입장

- (BOOL)loginSheet {
    NSAlert *alert = [NSAlert new];
    alert.messageText = @"예배온 입장"; alert.informativeText = @"공용 비밀번호와 작업자 이름을 넣어 주세요.";
    NSView *box = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 300, 56)];
    NSTextField *name = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 30, 300, 24)]; name.placeholderString = @"작업자 이름";
    NSSecureTextField *password = [[NSSecureTextField alloc] initWithFrame:NSMakeRect(0, 0, 300, 24)]; password.placeholderString = @"공용 비밀번호";
    [box addSubview:name]; [box addSubview:password]; alert.accessoryView = box;
    [alert addButtonWithTitle:@"입장"]; [alert addButtonWithTitle:@"취소"];
    alert.window.initialFirstResponder = name;
    if ([alert runModal] != NSAlertFirstButtonReturn) return NO;
    @try {
        [self.server login:name.stringValue password:password.stringValue];
        @try { [self.server saveSession]; } @catch (NSException *e) { NSLog(@"%@", e.reason); }
        self.connectionLabel.stringValue = [NSString stringWithFormat:@"%@ 연결됨 · %@", name.stringValue, kOrigin];
        return YES;
    } @catch (NSException *e) {
        [self alert:@"입장 실패" text:e.reason]; return NO;
    }
}
- (void)logout:(id)sender {
    @try { [self.server request:@"/api/session" method:@"DELETE" body:nil headers:nil]; } @catch (NSException *e) {}
    @try { [self.server forgetSession]; } @catch (NSException *e) {}
    self.connectionLabel.stringValue = @"로그아웃됨";
    if ([self loginSheet]) [self compareNow:nil];
}
- (void)alert:(NSString *)title text:(NSString *)text {
    NSAlert *alert = [NSAlert new]; alert.messageText = title; alert.informativeText = text ?: @""; [alert runModal];
}

#pragma mark - 시작

- (void)applicationDidFinishLaunching:(NSNotification *)note {
    self.work = dispatch_queue_create("org.yebaeon.sync2", DISPATCH_QUEUE_SERIAL);
    self.rows = [NSMutableArray array];
    [self buildMenu]; [self buildWindow];
    [self.window makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES];
    self.server = [[YBServer alloc] initWithOrigin:kOrigin allowLocalTestServer:NO];
    @try { [self.server loadSession]; } @catch (NSException *e) { NSLog(@"%@", e.reason); }
    [self rebuildEngine];
    [NSTimer scheduledTimerWithTimeInterval:3 target:self selector:@selector(refreshPresenterState) userInfo:nil repeats:YES];
    [self refreshPresenterState];
    @try {
        NSString *finished = [self.engine finishInterruptedApply];
        if (finished) [self alert:@"중단된 적용 마무리" text:finished];
    } @catch (NSException *e) { [self alert:@"중단된 적용을 마무리하지 못함" text:e.reason]; }
    if (!self.server.cookie) { if (![self loginSheet]) return; }
    else self.connectionLabel.stringValue = [@"연결 확인 중 · " stringByAppendingString:kOrigin];
    // 구형 Mac은 부팅 뒤 한참 인터넷을 못 잡는다. 바로 돌지 않고 잠시 뒤에 시작하며, 네트워크 오류면 간격을 늘려 조용히 기다린다.
    [self performSelector:@selector(startupCompare) withObject:nil afterDelay:5];
}
- (void)startupCompare {
    if (self.busy) return;
    [self runCompareWithCompletion:^(NSException *error) {
        if (!error) return;
        if ([error.reason hasPrefix:@"HTTP 401"]) { dispatch_async(dispatch_get_main_queue(), ^{ if ([self loginSheet]) [self compareNow:nil]; }); return; }
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

#pragma mark - 비교·적용

- (void)setBusy:(BOOL)busy {
    _busy = busy;
    self.compareButton.enabled = !busy;
    [self refreshApplyButton];
}
- (void)refreshPresenterState {
    BOOL running = YBPresenterRunning();
    self.presenterLabel.stringValue = running ? @"PP6 실행 중 · 닫으면 적용 가능" : @"PP6 꺼져 있음";
    [self refreshApplyButton];
}
- (void)refreshApplyButton {
    NSUInteger checked = 0;
    for (NSDictionary *row in self.rows) if ([row[@"checked"] boolValue]) checked++;
    self.applyButton.enabled = !self.busy && checked > 0 && !YBPresenterRunning();
    self.applyButton.title = checked ? [NSString stringWithFormat:@"%lu개 적용", (unsigned long)checked] : @"적용";
}
- (void)runCompareWithCompletion:(void (^)(NSException *error))completion {
    self.busy = YES; self.statusLabel.stringValue = @"비교 중";
    dispatch_async(self.work, ^{
        NSArray *result = nil; NSException *error = nil;
        @try { result = [self.engine compare]; } @catch (NSException *e) { error = e; }
        dispatch_async(dispatch_get_main_queue(), ^{
            self.busy = NO;
            if (result) {
                [self.rows removeAllObjects];
                for (NSDictionary *row in result) { NSMutableDictionary *m = [row mutableCopy]; m[@"checked"] = @([row[@"status"] isEqual:@"receive"]); [self.rows addObject:m]; }
                [self.table reloadData];
                NSUInteger receive = 0, hold = 0;
                for (NSDictionary *row in self.rows) { if ([row[@"status"] isEqual:@"receive"]) receive++; else if ([row[@"status"] isEqual:@"hold"]) hold++; }
                self.statusLabel.stringValue = receive ? [NSString stringWithFormat:@"받을 예배 %lu개%@", (unsigned long)receive, hold ? [NSString stringWithFormat:@" · 보류 %lu개", (unsigned long)hold] : @""] : (hold ? [NSString stringWithFormat:@"모두 같음 · 보류 %lu개", (unsigned long)hold] : @"모두 같음");
                self.connectionLabel.stringValue = [@"연결됨 · " stringByAppendingString:kOrigin];
                [self refreshApplyButton];
            } else self.statusLabel.stringValue = error.reason ?: @"비교 실패";
            if (completion) completion(error);
        });
    });
}
- (void)compareNow:(id)sender {
    if (self.busy) return;
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(startupCompare) object:nil];
    [self runCompareWithCompletion:^(NSException *error) {
        if ([error.reason hasPrefix:@"HTTP 401"]) dispatch_async(dispatch_get_main_queue(), ^{ if ([self loginSheet]) [self compareNow:nil]; });
    }];
}
- (void)applyNow:(id)sender {
    if (self.busy) return;
    NSMutableArray *selected = [NSMutableArray array];
    for (NSDictionary *row in self.rows) if ([row[@"checked"] boolValue] && [row[@"status"] isEqual:@"receive"]) [selected addObject:row];
    if (!selected.count) return;
    self.busy = YES; self.statusLabel.stringValue = @"적용 준비 중";
    dispatch_async(self.work, ^{
        NSDictionary *result = nil; NSException *error = nil;
        @try { result = [self.engine apply:selected]; } @catch (NSException *e) { error = e; }
        dispatch_async(dispatch_get_main_queue(), ^{
            self.busy = NO;
            if (error) { [self alert:@"적용하지 못함" text:error.reason]; [self compareNow:nil]; return; }
            NSMutableString *text = [NSMutableString string];
            NSArray *applied = result[@"applied"]; NSDictionary *failed = result[@"failed"];
            if (applied.count) [text appendFormat:@"적용함: %@\n", [applied componentsJoinedByString:@", "]];
            for (NSString *name in failed) [text appendFormat:@"실패 · %@: %@\n", name, failed[name]];
            if ([result[@"backup"] length]) [text appendFormat:@"\n바꾸기 전 파일은 백업 폴더에 있습니다.\n%@", result[@"backup"]];
            [self alert:@"적용 완료" text:text];
            [self compareNow:nil];
        });
    });
}

#pragma mark - 설정 변경

- (void)chooseRoot:(id)sender {
    NSOpenPanel *panel = [NSOpenPanel openPanel]; panel.canChooseDirectories = YES; panel.canChooseFiles = NO; panel.allowsMultipleSelection = NO;
    panel.message = @"ProPresenter 문서 폴더를 고르세요"; panel.directoryURL = [NSURL fileURLWithPath:self.root];
    if ([panel runModal] != NSModalResponseOK) return;
    [NSUserDefaults.standardUserDefaults setObject:panel.URL.path forKey:kRootKey];
    [self rebuildEngine]; [self compareNow:nil];
}
- (void)choosePlaylist:(id)sender {
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
    if ([status isEqual:@"mac"]) return @"Mac에서만 바뀜 · 그대로 둠 (올리기는 다음 판)";
    NSMutableArray *parts = [NSMutableArray array];
    if ([row[@"orderChanged"] boolValue]) [parts addObject:[row[@"macOrderChanged"] boolValue] ? @"순서 (Mac 순서는 백업)" : @"순서"];
    NSUInteger docs = [row[@"documents"] count], backup = [row[@"macChangedDocuments"] count], missingServer = [row[@"missingServer"] unsignedIntegerValue], missingLocal = [row[@"missingLocal"] count];
    if (docs) [parts addObject:[NSString stringWithFormat:@"문서 %lu", (unsigned long)docs]];
    if ([row[@"macOnlyDocuments"] count]) [parts addObject:[NSString stringWithFormat:@"Mac에서만 바뀐 문서 %lu은 그대로", (unsigned long)[row[@"macOnlyDocuments"] count]]];
    if ([row[@"macOnlyOrder"] boolValue]) [parts addObject:@"Mac 순서 변경은 그대로"];
    if (backup) [parts addObject:[NSString stringWithFormat:@"Mac 수정본 백업 %lu", (unsigned long)backup]];
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
    if (![column.identifier isEqual:@"checked"]) return;
    NSMutableDictionary *row = self.rows[index];
    if ([row[@"status"] isEqual:@"receive"]) row[@"checked"] = @([value boolValue]);
    [self refreshApplyButton];
}
- (void)tableView:(NSTableView *)table willDisplayCell:(id)cell forTableColumn:(NSTableColumn *)column row:(NSInteger)index {
    NSDictionary *row = self.rows[index];
    if ([column.identifier isEqual:@"checked"]) [cell setEnabled:[row[@"status"] isEqual:@"receive"]];
    if ([column.identifier isEqual:@"status"] && [cell isKindOfClass:NSTextFieldCell.class]) {
        NSString *status = row[@"status"];
        [cell setTextColor:[status isEqual:@"receive"] ? [NSColor colorWithCalibratedRed:0.10 green:0.35 blue:0.75 alpha:1] : [status isEqual:@"hold"] ? [NSColor colorWithCalibratedRed:0.75 green:0.35 blue:0.10 alpha:1] : NSColor.disabledControlTextColor];
    }
}
- (BOOL)tableView:(NSTableView *)table shouldSelectRow:(NSInteger)index { return NO; }

- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)app {
    if (self.busy) { self.statusLabel.stringValue = @"작업이 끝나면 종료합니다"; return NSTerminateCancel; }
    return NSTerminateNow;
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)app { return YES; }
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
