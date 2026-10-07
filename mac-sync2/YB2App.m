#import <Cocoa/Cocoa.h>
#import "YB2Engine.h"
#import "YB2Server.h"
#import "YB2Receipt.h"
#import "YB2Update.h"
#import "YBDocumentComparison.h"
#import "PP6Core.h"

// 예배온 Sync 2: 데일리 창 하나 + 메뉴 막대 상주.
// - Mac 파일을 바꾸는 일은 모두 [적용]으로만 한다: 받기, 서버 휴지통 예배 빼기, 문서 이름 바꾸기·휴지통.
//   원격 지원 시간(Mac 앞에서 연 60분)에는 관리자가 웹에서 같은 버튼을 누를 수 있다.
// - 올리기(서버에 더하기만 함): Mac에서만 바뀐 문서·순서·사용일, Mac에서 만든 예배·새 문서·그 문서의 새 이미지.
// - 상주: 15분마다 변경 일지만 묻고(요청 1번), 바뀐 것이 있을 때만 비교해 창에 보여 준다. 적용하지 않는다.
//   PP6가 닫히면 Mac 수정분과 새 문서를 올린다. 잠자기에서 깨면 다시 확인한다.
// - 현황: 비교 결과·PP6 상태·마지막 오류를 서버에 올려 Studio에서 본다.
static NSString *const kOrigin = @"https://yebaeon.grace-jean-p.workers.dev";
#ifdef YB2_MANUAL_CAPTURE
// 설명서 그림 전용 빌드(capture.command): 로컬 Worker 주소·시험 폴더·입장 정보를 환경 변수로 받고, 비교가 끝나면 창을 PNG로 저장한 뒤 끝난다. 배포 앱에는 들어가지 않는다.
static NSString *Env(NSString *key) { const char *value = getenv(key.UTF8String); return value ? [NSString stringWithUTF8String:value] : nil; }
#define YB2_ORIGIN Env(@"YB2_CAPTURE_ORIGIN")
#else
#define YB2_ORIGIN kOrigin
#endif
static NSString *const kRootKey = @"documentsRoot", *const kPlaylistKey = @"playlistPath";
static NSString *const kResidentKey = @"residentMode";
static NSString *const kAgentLabel = @"org.yebaeon.sync2";
static const NSTimeInterval kResidentInterval = 15 * 60;

@interface YB2App : NSObject <NSApplicationDelegate, NSTableViewDataSource, NSTableViewDelegate, NSWindowDelegate, NSMenuDelegate>
@property(nonatomic) NSWindow *window;
@property(nonatomic) NSTextField *connectionLabel, *rootLabel, *playlistLabel, *statusLabel, *presenterLabel;
@property(nonatomic) NSTableView *table;
@property(nonatomic) NSTextView *detailLabel;   // 고른 줄의 할 일과 문서 이름(길면 스크롤)
@property(nonatomic) NSButton *compareButton, *applyButton, *reviewButton;
// 정리 창: 전체 확인과 비교가 만든 목록. 아무도 안 눌러도 아무 일도 생기지 않는다.
@property(nonatomic) NSWindow *organizer;
@property(nonatomic) NSTableView *organizerTable;
@property(nonatomic) NSTextField *organizerStatus, *organizerTitle, *organizerHint;
@property(nonatomic) BOOL organizerDirty;   // 정리 창에서 Mac·서버를 바꿨다: 닫을 때 다시 비교
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
@property(nonatomic) NSView *updateBar;
@property(nonatomic) NSTextField *updateLabel;
@property(nonatomic) NSButton *updateButton;
@property(nonatomic) NSDictionary *pendingRelease;           // 서버의 새 빌드(지금보다 새로울 때만)
@property(nonatomic) NSInteger dismissedBuild;        // [나중에]를 누른 빌드(이번 실행 동안 숨김)
@property(nonatomic) NSDate *lastUpdateCheck;
@property(nonatomic) NSMenuItem *statusUpdateItem, *statusLineItem, *appUpdateItem;
@property(nonatomic) NSDate *lastCycleAt;             // 마지막으로 서버를 확인한 때(메뉴 막대 상태 줄)               // 전체 확인이 뒤에서 도는 중(데일리 창은 잠그지 않는다)
@property(nonatomic) NSUInteger startupAttempt;
@property(nonatomic) dispatch_queue_t work;
// 현황·원격 지원
@property(nonatomic, copy) NSString *summary;          // 데일리 창 아래 요약 한 줄
@property(nonatomic, copy) NSString *lastError;
@property(nonatomic) NSMutableArray *recentLog;        // 최근 기록 30줄(현황에 함께 올림)
@property(nonatomic, copy) NSString *statusHash;
@property(nonatomic) NSDate *statusSentAt;
@property(nonatomic) BOOL statusSending;
@property(nonatomic) NSNumber *presenterSeen;
@property(nonatomic) NSDate *supportUntil;             // 원격 지원 끝 시각(nil = 꺼짐)
@property(nonatomic) NSTimer *supportTimer;
@property(nonatomic) BOOL supportPolling, remoteRunning;
@property(nonatomic) NSMutableArray *remoteQueue;      // 가져와서 아직 하지 않은 명령
@property(nonatomic, copy) NSString *supportNote, *supportMessage;
@property(nonatomic) NSView *supportBar;
@property(nonatomic) NSTextField *supportLabel;
@end

@implementation YB2App

#pragma mark - 설정

- (NSString *)root {
#ifdef YB2_MANUAL_CAPTURE
    return Env(@"YB2_CAPTURE_ROOT");
#endif
    NSString *value = [NSUserDefaults.standardUserDefaults stringForKey:kRootKey];
    return value.length ? value : [NSHomeDirectory() stringByAppendingPathComponent:@"Documents/ProPresenter6"];
}
- (NSURL *)playlistURL {
#ifdef YB2_MANUAL_CAPTURE
    return [NSURL fileURLWithPath:Env(@"YB2_CAPTURE_PLAYLIST")];
#endif
    NSString *value = [NSUserDefaults.standardUserDefaults stringForKey:kPlaylistKey];
    if (!value.length) value = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/RenewedVision/ProPresenter6/Playlists/기본 .pro6pl"];
    return [NSURL fileURLWithPath:value];
}
- (BOOL)resident { return [NSUserDefaults.standardUserDefaults objectForKey:kResidentKey] ? [NSUserDefaults.standardUserDefaults boolForKey:kResidentKey] : YES; }
- (NSString *)profile {
#ifdef YB2_MANUAL_CAPTURE
    return Env(@"YB2_CAPTURE_PROFILE");
#endif
    NSString *identity = YBHash([[NSString stringWithFormat:@"%@\n%@", YB2_ORIGIN, self.root] dataUsingEncoding:NSUTF8StringEncoding]);
    return [[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/YebaeOn Sync 2"] stringByAppendingPathComponent:[identity substringToIndex:16]];
}
- (void)rebuildEngine {
    self.engine = [[YB2Engine alloc] initWithServer:self.server root:self.root playlist:self.playlistURL profile:self.profile];
    __weak YB2App *weak = self;
    self.engine.progress = ^(NSString *message) { dispatch_async(dispatch_get_main_queue(), ^{ weak.statusLabel.stringValue = message; if (weak.checking) weak.organizerStatus.stringValue = message; }); };
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

    // 표 아래: 고른 줄의 자세한 설명(문서 이름별로 무엇을 하는지)
    NSScrollView *detailScroll = [[NSScrollView alloc] initWithFrame:NSMakeRect(16, 48, w - 32, 60)];
    detailScroll.autoresizingMask = NSViewWidthSizable | NSViewMaxYMargin; detailScroll.hasVerticalScroller = YES; detailScroll.drawsBackground = NO; detailScroll.borderType = NSNoBorder;
    self.detailLabel = [[NSTextView alloc] initWithFrame:NSMakeRect(0, 0, w - 48, 60)];
    self.detailLabel.editable = NO; self.detailLabel.selectable = YES; self.detailLabel.drawsBackground = NO; self.detailLabel.font = [NSFont systemFontOfSize:11];
    self.detailLabel.textColor = NSColor.secondaryLabelColor; self.detailLabel.verticallyResizable = YES; self.detailLabel.autoresizingMask = NSViewWidthSizable;
    self.detailLabel.textContainer.widthTracksTextView = YES; self.detailLabel.string = @"줄을 누르면 할 일과 문서 이름이 여기에 나옵니다.";
    detailScroll.documentView = self.detailLabel; [content addSubview:detailScroll];
    NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:NSMakeRect(16, 114, w - 32, h - 202)]; self.tableScroll = scroll;
    scroll.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable; scroll.hasVerticalScroller = YES; scroll.borderType = NSBezelBorder;
    self.table = [[NSTableView alloc] initWithFrame:scroll.bounds];
    self.table.dataSource = self; self.table.delegate = self;
    NSMenu *force = [NSMenu new]; force.delegate = self; force.autoenablesItems = NO; self.table.menu = force;   // 오른쪽 클릭: 문서별 강제 동작 self.table.rowHeight = 22; self.table.allowsMultipleSelection = NO;
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
    self.applyButton = Button(@"받기·올리기", NSMakeRect(w - 150, 10, 134, 28), self, @selector(applyNow:));
    self.applyButton.keyEquivalent = @"\r"; self.applyButton.enabled = NO;
    [content addSubview:self.statusLabel]; [content addSubview:self.presenterLabel]; [content addSubview:self.compareButton]; [content addSubview:self.applyButton];
    // "확인 필요 n · 정리 열기" 한 줄. n=0이면 숨긴다.
    self.reviewButton = Button(@"", NSMakeRect(w - 356, h - 34, 244, 24), self, @selector(showOrganizer:));
    self.reviewButton.bezelStyle = NSBezelStyleRecessed; self.reviewButton.autoresizingMask = NSViewMinXMargin | NSViewMinYMargin; self.reviewButton.hidden = YES;
    [content addSubview:self.reviewButton];
    NSButton *studio = Button(@"Studio 열기", NSMakeRect(w - 106, h - 34, 90, 24), self, @selector(openStudio:));
    studio.autoresizingMask = NSViewMinXMargin | NSViewMinYMargin; [content addSubview:studio];
    // 새 버전 줄(표 바로 위). 보일 때만 표를 그만큼 줄인다.
    // 새 버전 줄: 노란 바탕(NSBox)은 뒤에 깔고, 글·버튼은 바탕 밖의 보통 칸에 둔다(NSBox 안에 두면 위아래가 잘린다).
    self.updateBar = [[NSView alloc] initWithFrame:NSMakeRect(16, h - 124, w - 32, 36)];
    self.updateBar.autoresizingMask = NSViewWidthSizable | NSViewMinYMargin; self.updateBar.hidden = YES;
    NSBox *backdrop = [[NSBox alloc] initWithFrame:self.updateBar.bounds];
    backdrop.boxType = NSBoxCustom; backdrop.fillColor = [NSColor colorWithCalibratedRed:1 green:0.965 blue:0.8 alpha:1];
    backdrop.borderColor = [NSColor colorWithCalibratedRed:0.9 green:0.81 blue:0.42 alpha:1]; backdrop.cornerRadius = 4; backdrop.titlePosition = NSNoTitle;
    backdrop.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable; [self.updateBar addSubview:backdrop];
    CGFloat bw = w - 32;
    self.updateLabel = Label(@"", NSMakeRect(10, 9, bw - 230, 18), 12); self.updateLabel.autoresizingMask = NSViewWidthSizable;
    self.updateLabel.lineBreakMode = NSLineBreakByTruncatingTail;
    NSButton *later = Button(@"나중에", NSMakeRect(bw - 210, 4, 86, 28), self, @selector(dismissUpdate:));
    self.updateButton = Button(@"지금 설치", NSMakeRect(bw - 118, 4, 110, 28), self, @selector(installUpdate:));
    later.autoresizingMask = self.updateButton.autoresizingMask = NSViewMinXMargin;
    [self.updateBar addSubview:self.updateLabel]; [self.updateBar addSubview:later]; [self.updateBar addSubview:self.updateButton];
    [content addSubview:self.updateBar];
    // 원격 지원 줄(표 바로 위, 새 버전 줄보다 위). 지원 중에만 보인다.
    self.supportBar = [[NSView alloc] initWithFrame:NSMakeRect(16, h - 124, w - 32, 36)];
    self.supportBar.autoresizingMask = NSViewWidthSizable | NSViewMinYMargin; self.supportBar.hidden = YES;
    NSBox *supportBackdrop = [[NSBox alloc] initWithFrame:self.supportBar.bounds];
    supportBackdrop.boxType = NSBoxCustom; supportBackdrop.fillColor = [NSColor colorWithCalibratedRed:1 green:0.93 blue:0.85 alpha:1];
    supportBackdrop.borderColor = [NSColor colorWithCalibratedRed:0.88 green:0.6 blue:0.3 alpha:1]; supportBackdrop.cornerRadius = 4; supportBackdrop.titlePosition = NSNoTitle;
    supportBackdrop.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable; [self.supportBar addSubview:supportBackdrop];
    self.supportLabel = Label(@"", NSMakeRect(10, 9, bw - 120, 18), 12); self.supportLabel.autoresizingMask = NSViewWidthSizable;
    self.supportLabel.lineBreakMode = NSLineBreakByTruncatingTail;
    NSButton *endSupport = Button(@"끝내기", NSMakeRect(bw - 102, 4, 94, 28), self, @selector(endSupportNow:)); endSupport.autoresizingMask = NSViewMinXMargin;
    [self.supportBar addSubview:self.supportLabel]; [self.supportBar addSubview:endSupport];
    [content addSubview:self.supportBar];
}
// 표 위의 줄(원격 지원·새 버전)을 위에서부터 쌓고, 표 높이를 그만큼 줄인다.
- (void)layoutBars {
    if (!self.supportBar || !self.updateBar) return;
    CGFloat top = NSHeight(self.window.contentView.bounds) - 88;
    for (NSView *bar in @[self.supportBar, self.updateBar]) {
        if (bar.hidden) continue;
        NSRect frame = bar.frame; frame.origin.y = top - 36; bar.frame = frame; top -= 40;
    }
    NSRect frame = self.tableScroll.frame; frame.size.height = MAX(40, top - frame.origin.y); self.tableScroll.frame = frame;
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
            [self refreshUpdateBar]; [self scheduleStatus];
        });
    });
}
- (void)checkUpdateNow:(id)sender { [self checkUpdate:YES]; }
- (void)refreshUpdateBar {
    BOOL show = self.pendingRelease && [self.pendingRelease[@"build"] integerValue] != self.dismissedBuild;
    if (show != !self.updateBar.hidden) { self.updateBar.hidden = !show; [self layoutBars]; }
    NSString *notes = [self.pendingRelease[@"notes"] length] ? [@" · " stringByAppendingString:self.pendingRelease[@"notes"]] : @"";
    self.updateLabel.stringValue = self.pendingRelease ? [NSString stringWithFormat:@"새 버전 있음 · 빌드 %@ (지금 빌드 %ld)%@", self.pendingRelease[@"build"], (long)[YB2Update currentBuild], notes] : @"";
    self.updateLabel.toolTip = self.updateLabel.stringValue;
    NSString *blocked = self.busy ? @"작업 중" : self.checking ? @"전체 확인 중" : YBPresenterRunning() ? @"PP6를 닫은 뒤" : nil;
    self.updateButton.enabled = self.pendingRelease && !blocked;
    self.updateButton.toolTip = blocked ? [blocked stringByAppendingString:@" 설치할 수 있습니다."] : nil;
    for (NSMenuItem *item in @[self.statusUpdateItem ?: [NSMenuItem new], self.appUpdateItem ?: [NSMenuItem new]]) {
        item.hidden = !self.pendingRelease;
        item.title = self.pendingRelease ? [NSString stringWithFormat:@"새 버전 설치… (빌드 %@)", self.pendingRelease[@"build"]] : @"";
    }
    [self refreshStatusItem];
}
- (void)dismissUpdate:(id)sender { self.dismissedBuild = [self.pendingRelease[@"build"] integerValue]; [self refreshUpdateBar]; }
- (void)installUpdate:(id)sender {
    NSDictionary *release = self.pendingRelease;
    if (!release) return;
    if (self.busy || self.checking || YBPresenterRunning()) { [self alert:@"지금은 설치할 수 없습니다" text:@"받기·올리기·전체 확인이 끝나고 PP6를 닫은 뒤 다시 눌러 주세요."]; return; }
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

- (void)openStudio:(id)sender { [NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:YB2_ORIGIN]]; }
- (void)buildMenu {
    NSMenu *bar = [NSMenu new]; NSMenuItem *appItem = [NSMenuItem new]; [bar addItem:appItem];
    // 프로그램 이름 메뉴: 버전·업데이트·Studio는 메뉴 막대 아이콘 메뉴와 같은 것을 여기에도 둔다(아이콘 메뉴는 창이 닫혀 있을 때 쓴다).
    NSMenu *app = [NSMenu new];
    NSMenuItem *version = [app addItemWithTitle:[NSString stringWithFormat:@"버전: 빌드 %ld", (long)[YB2Update currentBuild]] action:nil keyEquivalent:@""]; version.enabled = NO;
    [app addItemWithTitle:@"업데이트 확인" action:@selector(checkUpdateNow:) keyEquivalent:@""];
    self.appUpdateItem = [app addItemWithTitle:@"새 버전 설치…" action:@selector(installUpdate:) keyEquivalent:@""]; self.appUpdateItem.hidden = !self.pendingRelease;
    [app addItem:NSMenuItem.separatorItem];
    [app addItemWithTitle:@"예배온 Studio 열기" action:@selector(openStudio:) keyEquivalent:@""];
    [app addItem:NSMenuItem.separatorItem];
    [app addItemWithTitle:@"로그아웃" action:@selector(logout:) keyEquivalent:@""];
    [app addItem:NSMenuItem.separatorItem];
    [app addItemWithTitle:@"예배온 Sync 2 종료" action:@selector(terminate:) keyEquivalent:@"q"];
    appItem.submenu = app;
    NSMenuItem *toolsItem = [NSMenuItem new]; [bar addItem:toolsItem];
    NSMenu *tools = [NSMenu new]; tools.title = @"도구";
    [tools addItemWithTitle:@"다시 비교" action:@selector(compareNow:) keyEquivalent:@"r"];
    [tools addItemWithTitle:@"정리…" action:@selector(showOrganizer:) keyEquivalent:@"o"];
    [tools addItemWithTitle:@"백업 폴더 열기" action:@selector(openBackups:) keyEquivalent:@""];
    [tools addItemWithTitle:@"마지막 적용 되돌리기…" action:@selector(undoLastApply:) keyEquivalent:@""];
    [tools addItem:NSMenuItem.separatorItem];
    [tools addItemWithTitle:@"원격 지원 시작…" action:@selector(toggleSupport:) keyEquivalent:@""];
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
        self.connectionLabel.stringValue = [NSString stringWithFormat:@"%@ 연결됨%@ · %@", name.stringValue, self.server.deviceToken ? @" (장치 열쇠)" : @"", YB2_ORIGIN];
        return YES;
    } @catch (NSException *e) {
        [self alert:@"입장 실패" text:e.reason]; return NO;
    }
}
- (void)logout:(id)sender {
    [self endSupport:@"로그아웃" notifyServer:YES];
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
#ifndef YB2_MANUAL_CAPTURE
    [self repairLoginAgent];
#endif
    self.work = dispatch_queue_create("org.yebaeon.sync2", DISPATCH_QUEUE_SERIAL);
    self.rows = [NSMutableArray array];
    [self buildMenu]; [self buildWindow]; [self buildStatusItem];
    [self.window makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES];
#ifdef YB2_MANUAL_CAPTURE
    self.server = [[YB2Server alloc] initWithOrigin:YB2_ORIGIN allowLocalTestServer:YES];
    [self.server login:Env(@"YB2_CAPTURE_NAME") password:Env(@"YB2_CAPTURE_PASSWORD")];
#else
    self.server = [[YB2Server alloc] initWithOrigin:YB2_ORIGIN allowLocalTestServer:NO];
    @try { [self.server loadDeviceToken]; } @catch (NSException *e) { NSLog(@"%@", e.reason); }
    @try { [self.server loadSession]; } @catch (NSException *e) { NSLog(@"%@", e.reason); }
#endif
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
    else self.connectionLabel.stringValue = [NSString stringWithFormat:@"연결 확인 중%@ · %@", self.server.deviceToken ? @" (장치 열쇠)" : @"", YB2_ORIGIN];
    // 켜자마자 서버에 연결한다. 네트워크 오류면 startupCompare가 15초마다 다시 시도한다.
    [self performSelector:@selector(startupCompare) withObject:nil afterDelay:0];
}
- (void)startupCompare {
    if (self.busy) return;
    [self runCycleForce:YES upload:NO completion:^(NSException *error) {
#ifdef YB2_MANUAL_CAPTURE
        if (!error) { dispatch_async(dispatch_get_main_queue(), ^{ [self captureForManual]; }); return; }
        NSLog(@"capture compare failed: %@", error.reason); exit(3);
#endif
        if (!error) { [self runFullCheckIfDue]; [self checkUpdate:NO]; return; }
        if ([error.reason hasPrefix:@"HTTP 401"]) { dispatch_async(dispatch_get_main_queue(), ^{ [self handleLoginRequired]; }); return; }
        if ([error.reason hasPrefix:@"HTTP "]) { dispatch_async(dispatch_get_main_queue(), ^{ self.statusLabel.stringValue = error.reason; }); return; }
        // 켜자마자 연결하고, 네트워크가 없으면 15초마다 다시 시도한다(최대 5분).
        NSArray *delays = [@"15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15" componentsSeparatedByString:@" "];
        if (self.startupAttempt >= delays.count) { dispatch_async(dispatch_get_main_queue(), ^{ self.statusLabel.stringValue = [@"서버에 연결하지 못했습니다. 인터넷 연결 뒤 ‘다시 비교’를 눌러 주세요. " stringByAppendingString:error.reason]; }); return; }
        NSTimeInterval delay = [delays[self.startupAttempt++] doubleValue];
        dispatch_async(dispatch_get_main_queue(), ^{
            self.statusLabel.stringValue = [NSString stringWithFormat:@"네트워크를 기다리는 중 · %.0f초 뒤 다시 시도", delay];
            [self performSelector:@selector(startupCompare) withObject:nil afterDelay:delay];
        });
    }];
}

#ifdef YB2_MANUAL_CAPTURE
// 고를 줄(YB2_CAPTURE_SELECT)을 고르고, 제목 줄까지 포함한 창을 2배 해상도 PNG(YB2_CAPTURE_OUT)로 저장한다.
- (void)captureForManual {
    NSString *select = Env(@"YB2_CAPTURE_SELECT");
    for (NSUInteger i = 0; i < self.rows.count; i++) if ([self.rows[i][@"name"] isEqual:select]) [self.table selectRowIndexes:[NSIndexSet indexSetWithIndex:i] byExtendingSelection:NO];
    // 그림에는 로컬 시험 주소·임시 폴더 대신 교회 Mac에서 보이는 주소와 기본 폴더를 보인다.
    self.connectionLabel.stringValue = [NSString stringWithFormat:@"연결됨 (장치 열쇠) · %@", kOrigin];
    self.rootLabel.stringValue = @"문서 폴더  /Users/church/Documents/ProPresenter6";
    self.playlistLabel.stringValue = @"재생목록  /Users/church/Library/Application Support/RenewedVision/ProPresenter6/Playlists/기본 .pro6pl";
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        NSView *frame = self.window.contentView.superview;
        NSSize size = frame.bounds.size;
        NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:(NSInteger)size.width * 2 pixelsHigh:(NSInteger)size.height * 2 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSCalibratedRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
        rep.size = size;
        [frame cacheDisplayInRect:frame.bounds toBitmapImageRep:rep];
        NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
        BOOL ok = [png writeToFile:Env(@"YB2_CAPTURE_OUT") atomically:YES];
        NSLog(@"capture %@ %@", Env(@"YB2_CAPTURE_OUT"), ok ? @"saved" : @"failed");
        exit(ok ? 0 : 4);
    });
}
#endif

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
// 받을 것이 "이력 없음" 문서뿐인 줄: [적용]으로는 아무것도 바뀌지 않는다(Mac 파일을 지키고 정리 창으로 보낸다). 체크를 꺼 두고 정리 창으로 안내한다.
static BOOL NoHistoryOnly(NSDictionary *row) {
    if (![row[@"status"] isEqual:@"receive"] || [row[@"orderChanged"] boolValue] || [row[@"macDeleted"] boolValue] || [row[@"serverNew"] boolValue]) return NO;
    if ([row[@"images"] count] || [row[@"macOnlyDocuments"] count] || [row[@"revertedOrder"] boolValue] || [row[@"revertedDocuments"] count]) return NO;
    NSUInteger unknown = 0;
    for (NSString *path in row[@"macChangedDocuments"]) if ([row[@"macChangedReasons"][path] isEqual:@"technical"]) unknown++;
    return unknown > 0 && unknown == [row[@"documents"] count];
}
static BOOL ChangesMac(NSDictionary *row) { return [@[@"receive", @"trash", @"actions"] containsObject:row[@"status"] ?: @""] || [row[@"images"] count]; }

- (void)setBusy:(BOOL)busy {
    _busy = busy;
    self.compareButton.enabled = !busy;
    [self.table reloadData];
    [self refreshApplyButton];
    [self refreshStatusItem];
    if (self.organizer) [self refreshOrganizerButtons];
    if (self.updateBar) [self refreshUpdateBar];
    if (!busy) [self scheduleStatus];
}
- (void)refreshPresenterState {
    BOOL running = YBPresenterRunning();
    self.presenterLabel.stringValue = running ? @"PP6 실행 중" : @"PP6 꺼져 있음";
    if (self.presenterSeen && self.presenterSeen.boolValue != running) [self scheduleStatus];
    self.presenterSeen = @(running);
    [self refreshApplyButton];
    if (self.pendingRelease) [self refreshUpdateBar];
}
- (void)refreshApplyButton {
    NSUInteger checked = 0, receive = 0;
    for (NSDictionary *row in self.rows) if ([row[@"checked"] boolValue] && !NoHistoryOnly(row)) { checked++; if (ChangesMac(row)) receive++; }
    // 올리기는 PP6가 켜져 있어도 된다(Mac 파일을 바꾸지 않는다). 받기는 PP6를 닫아야 한다.
    self.applyButton.enabled = !self.busy && checked > 0 && (receive == 0 || !YBPresenterRunning());
    // 고른 줄의 방향대로: 받기(Mac이 바뀜)만, 올리기만, 둘 다
    NSUInteger up = checked - receive;
    NSString *verb = receive && up ? @"받기·올리기" : receive ? @"받기" : @"올리기";
    self.applyButton.title = checked ? [NSString stringWithFormat:@"%lu개 %@", (unsigned long)checked, verb] : @"받기·올리기";
}
- (void)refreshStatusItem {
    NSUInteger waiting = 0, hold = 0;
    for (NSDictionary *row in self.rows) { if (Checkable(row) && !([row[@"macDeleted"] boolValue]) && !NoHistoryOnly(row)) waiting++; else if ([row[@"status"] isEqual:@"hold"] || NoHistoryOnly(row)) hold++; }
    NSString *title = self.busy ? @"예배온 확인 중" : waiting ? [NSString stringWithFormat:@"예배온 대기 %lu", (unsigned long)waiting] : hold ? [NSString stringWithFormat:@"예배온 보류 %lu", (unsigned long)hold] : @"예배온 최신";
    if (self.supportUntil) title = [@"원격 지원 · " stringByAppendingString:title];
    self.statusItem.button.title = self.pendingRelease ? [title stringByAppendingString:@" · 새 버전"] : title;
    NSString *state = self.busy ? @"확인 중" : waiting ? [NSString stringWithFormat:@"받을·올릴 것 %lu", (unsigned long)waiting] : hold ? [NSString stringWithFormat:@"보류 %lu", (unsigned long)hold] : @"모두 같음";
    NSString *at = self.lastCycleAt ? [@" · " stringByAppendingString:[NSDateFormatter localizedStringFromDate:self.lastCycleAt dateStyle:NSDateFormatterNoStyle timeStyle:NSDateFormatterShortStyle]] : @"";
    self.statusLineItem.title = [state stringByAppendingString:at];
}
- (void)showRows:(NSArray *)result {
    [self.rows removeAllObjects];
    // Mac에서 지운 예배는 기본 체크 꺼짐(되살리지 않는다). 나머지 고를 수 있는 줄은 켜 둔다.
    for (NSDictionary *row in result) { NSMutableDictionary *m = [row mutableCopy]; m[@"checked"] = @(Checkable(row) && ![row[@"macDeleted"] boolValue] && !NoHistoryOnly(row)); [self.rows addObject:m]; }
    [self.table reloadData];
    NSUInteger receive = 0, mac = 0, hold = 0, trash = 0;
    for (NSDictionary *row in self.rows) {
        NSString *status = row[@"status"];
        if (NoHistoryOnly(row)) hold++;
        else if ([status isEqual:@"receive"] && ![row[@"macDeleted"] boolValue]) receive++;
        else if ([status isEqual:@"mac"] || [status isEqual:@"macNew"]) mac++;
        else if ([status isEqual:@"trash"]) trash++;
        else if ([status isEqual:@"actions"]) trash += [row[@"renames"] count] + [row[@"trashes"] count] + [row[@"imageTrashes"] count];
        else if ([status isEqual:@"hold"]) hold++;
    }
    NSMutableArray *parts = [NSMutableArray array];
    if (receive) [parts addObject:[NSString stringWithFormat:@"받을 예배 %lu개", (unsigned long)receive]];
    if (mac) [parts addObject:[NSString stringWithFormat:@"올릴 예배 %lu개", (unsigned long)mac]];
    if (trash) [parts addObject:[NSString stringWithFormat:@"서버 정리 %lu개", (unsigned long)trash]];
    if (hold) [parts addObject:[NSString stringWithFormat:@"정리 창에서 정할 것 %lu개", (unsigned long)hold]];
    self.statusLabel.stringValue = parts.count ? [parts componentsJoinedByString:@" · "] : @"모두 같음";
    self.summary = self.statusLabel.stringValue;
    self.connectionLabel.stringValue = [NSString stringWithFormat:@"연결됨%@ · %@", self.server.deviceToken ? @" (장치 열쇠)" : @"", YB2_ORIGIN];
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
            self.lastError = error.reason;
            if (error) [self note:[@"확인 실패 · " stringByAppendingString:error.reason ?: @""]];
            self.busy = NO;
            if (rows) [self showRows:rows];
            else if (error) self.statusLabel.stringValue = error.reason ?: @"확인 실패";
            else if (!compared) { self.statusLabel.stringValue = [@"바뀐 것 없음 · " stringByAppendingString:[NSDateFormatter localizedStringFromDate:NSDate.date dateStyle:NSDateFormatterNoStyle timeStyle:NSDateFormatterShortStyle]]; [self refreshStatusItem]; }
            NSString *summary = synced ? Summary(synced) : @"";
            if (summary.length) { self.statusLabel.stringValue = [[summary componentsSeparatedByString:@"\n"].firstObject stringByAppendingString:@" (자동)"]; [self note:[@"자동 올리기 · " stringByAppendingString:summary]]; }
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
    NSMutableArray *organizerOnly = [NSMutableArray array];
    for (NSDictionary *row in self.rows) if ([row[@"checked"] boolValue] && Checkable(row)) [NoHistoryOnly(row) ? organizerOnly : selected addObject:row];
    NSString *organizerNote = organizerOnly.count ? [NSString stringWithFormat:@"%@: 이력 없는 문서뿐이라 [적용]으로는 바뀌지 않습니다. 정리 창에서 서버 것 받기·Mac 것 올리기로 정해 주세요.", [[organizerOnly valueForKey:@"name"] componentsJoinedByString:@", "]] : nil;
    if (!selected.count) {
        if (organizerNote) {
            NSAlert *alert = [NSAlert new]; alert.messageText = @"정리 창에서 정할 것"; alert.informativeText = organizerNote;
            [alert addButtonWithTitle:@"정리 창 열기"]; [alert addButtonWithTitle:@"닫기"];
            if ([alert runModal] == NSAlertFirstButtonReturn) [self showOrganizer:nil];
        }
        return;
    }
    self.busy = YES; self.statusLabel.stringValue = @"올리기·적용 중";
    dispatch_async(self.work, ^{
        NSDictionary *result = nil; NSException *error = nil;
        @try { result = [self syncRows:selected automatic:NO]; } @catch (NSException *e) { error = e; }
        dispatch_async(dispatch_get_main_queue(), ^{
            self.busy = NO;
            if (error) { [self note:[@"적용 실패 · " stringByAppendingString:error.reason ?: @""]]; [self alert:@"적용하지 못함" text:error.reason]; [self compareNow:nil]; return; }
            NSString *text = Summary(result);
            [self note:[@"적용 · " stringByAppendingString:text.length ? text : @"바뀐 것 없음"]];
            if (organizerNote) text = [text stringByAppendingFormat:@"%@%@", text.length ? @"\n" : @"", organizerNote];
            [self alert:@"완료" text:text.length ? text : @"바뀐 것이 없습니다."];
            [self compareNow:nil];
        });
    });
}

#pragma mark - 정리 창

// 파일 바이트에서 처음 다른 곳(앞뒤 60자). 슬라이드 내용이 같은데 다르다고 나올 때 원인을 찾는 데 쓴다.
static NSString *DifferenceText(NSString *label, NSData *local, NSData *remote) {
    NSString *a = local ? [[NSString alloc] initWithData:local encoding:NSUTF8StringEncoding] : @"", *b = remote ? [[NSString alloc] initWithData:remote encoding:NSUTF8StringEncoding] : @"";
    if (!a || !b) return [label stringByAppendingString:@": 글자로 읽을 수 없음"];
    if ([a isEqual:b]) return [label stringByAppendingString:@": 같음"];
    NSUInteger i = 0, n = MIN(a.length, b.length);
    while (i < n && [a characterAtIndex:i] == [b characterAtIndex:i]) i++;
    NSUInteger start = i > 60 ? i - 60 : 0;
    NSString *(^cut)(NSString *) = ^NSString *(NSString *text) { return start >= text.length ? @"(끝)" : [[text substringWithRange:NSMakeRange(start, MIN(140, text.length - start))] stringByReplacingOccurrencesOfString:@"\n" withString:@"⏎"]; };
    return [NSString stringWithFormat:@"%@(%lu번째 글자, 크기 Mac %lu · 서버 %lu)\nMac: …%@\n서버: …%@", label, (unsigned long)i, (unsigned long)local.length, (unsigned long)remote.length, cut(a), cut(b)];
}
// 파일 그대로의 첫 차이와, Sync가 같은지 판단할 때 쓰는 비교용 글의 첫 차이
static NSString *FirstDifference(NSData *local, NSData *remote) {
    if (local && remote && [local isEqual:remote]) return @"파일 바이트가 같습니다.";
    return [NSString stringWithFormat:@"%@\n\n%@", DifferenceText(@"파일 첫 차이", local, remote),
            DifferenceText(@"비교용으로 맞춘 뒤 첫 차이(사용 기록·경로·XML·RTF 표기·자모)", [YB2Engine comparableBytes:local], [YB2Engine comparableBytes:remote])];
}
// 서버·영수증의 UTC 시각(ISO 8601)을 이 Mac의 시간대로: 2026-10-05 18:38
static NSString *LocalTime(NSString *iso) {
    if (!iso.length) return @"";
    static NSDateFormatter *output; static NSISO8601DateFormatter *plain, *fractional; static dispatch_once_t once;
    dispatch_once(&once, ^{
        output = [NSDateFormatter new]; output.dateFormat = @"yyyy-MM-dd HH:mm"; output.timeZone = NSTimeZone.localTimeZone;
        plain = [NSISO8601DateFormatter new];
        fractional = [NSISO8601DateFormatter new]; fractional.formatOptions = NSISO8601DateFormatWithInternetDateTime | NSISO8601DateFormatWithFractionalSeconds;
    });
    NSString *text = [iso stringByReplacingOccurrencesOfString:@" " withString:@"T"];
    if (![text hasSuffix:@"Z"] && [text rangeOfString:@"+"].location == NSNotFound) text = [text stringByAppendingString:@"Z"];
    NSDate *date = [plain dateFromString:text] ?: [fractional dateFromString:text];
    return date ? [output stringFromDate:date] : [iso stringByReplacingOccurrencesOfString:@"T" withString:@" "];
}


static NSString *const kListHold = @"확인 필요", *const kListMacDeleted = @"Mac에서 지움",
                *const kListCollision = @"같은 이름, 다른 내용", *const kListExternal = @"외부 참조", *const kListImage = @"이미지 보충", *const kListNumbered = @"번호 붙임";
- (NSArray *)reviewItems {
    NSMutableArray *items = [NSMutableArray array];
    for (NSDictionary *row in self.rows) {
        NSString *status = row[@"status"];
        if ([status isEqual:@"hold"] && [row[@"nodeID"] length]) [items addObject:@{@"list": kListHold, @"title": row[@"name"] ?: @"", @"detail": row[@"reason"] ?: @""}];
        for (NSDictionary *hold in row[@"actionHolds"]) [items addObject:@{@"list": kListHold, @"title": hold[@"path"], @"path": hold[@"path"], @"detail": hold[@"reason"] ?: @""}];
        if ([row[@"macDeleted"] boolValue]) [items addObject:@{@"list": kListMacDeleted, @"title": row[@"name"] ?: @"", @"detail": @"예배 · 데일리 창에서 체크하면 다시 받습니다"}];
    }
    NSDictionary *check = [self.engine lastFullCheck];
    for (NSDictionary *item in check[@"macDeleted"]) [items addObject:@{@"list": kListMacDeleted, @"title": item[@"path"], @"path": item[@"path"], @"detail": @"문서 · 서버에는 사용 중", @"item": item}];
    for (NSDictionary *item in check[@"collisions"]) [items addObject:@{@"list": kListCollision, @"title": item[@"path"], @"path": item[@"path"], @"detail": @"Mac과 서버의 내용이 다르고 같은 이력이 없음", @"item": item}];
    // 외부 참조: 동영상은 아직 정리하지 않으므로 이미지 등만 보여 준다.
    NSSet *videos = [NSSet setWithArray:@[@"mov", @"mp4", @"m4v", @"avi", @"wmv", @"mpg", @"mpeg", @"mkv", @"flv", @"webm", @"3gp", @"mts", @"m2ts"]];
    for (NSDictionary *item in check[@"external"]) {
        NSArray *references = [item[@"references"] filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSString *reference, NSDictionary *b) {
            return ![videos containsObject:reference.pathExtension.lowercaseString]; }]];
        if (references.count) [items addObject:@{@"list": kListExternal, @"title": item[@"path"], @"path": item[@"path"], @"detail": [references componentsJoinedByString:@", "], @"item": @{@"path": item[@"path"], @"references": references}}];
    }
    for (NSDictionary *item in check[@"imageFill"]) [items addObject:@{@"list": kListImage, @"title": [item[@"path"] lastPathComponent], @"path": item[@"path"], @"detail": @"서버에 있고 이 Mac에 없음", @"item": item}];
    for (NSDictionary *item in [self.engine numberedLog]) [items addObject:@{@"list": kListNumbered, @"title": item[@"path"], @"path": item[@"target"], @"detail": [NSString stringWithFormat:@"Mac 파일 → %@ · %@", item[@"target"], LocalTime(item[@"at"])], @"item": item}];
    return items;
}
- (void)refreshReview {
    NSUInteger count = 0;
    for (NSDictionary *item in [self reviewItems]) if (![item[@"list"] isEqual:kListNumbered]) count++;
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
            [self note:failure ? [@"전체 확인 실패 · " stringByAppendingString:failure.reason ?: @""] : @"전체 확인 끝"];
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
    NSRect frame = NSMakeRect(0, 0, 980, 480);
    self.organizer = [[NSWindow alloc] initWithContentRect:frame styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
    self.organizer.title = @"예배온 Sync 2 · 정리"; self.organizer.delegate = self; self.organizer.releasedWhenClosed = NO; self.organizer.minSize = NSMakeSize(940, 360);
    NSView *content = self.organizer.contentView; CGFloat w = frame.size.width, h = frame.size.height;
    NSTextField *help = Label(@"할 일만 모았습니다. 버튼을 누를 때만 Mac·서버가 바뀝니다.", NSMakeRect(16, h - 30, w - 32, 18), 12);
    help.autoresizingMask = NSViewWidthSizable | NSViewMinYMargin; [content addSubview:help];
    NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:NSMakeRect(16, 152, w - 32, h - 190)];
    scroll.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable; scroll.hasVerticalScroller = YES; scroll.borderType = NSBezelBorder;
    self.organizerTable = [[NSTableView alloc] initWithFrame:scroll.bounds];
    self.organizerTable.dataSource = self; self.organizerTable.delegate = self; self.organizerTable.rowHeight = 22; self.organizerTable.allowsMultipleSelection = YES;
    self.organizerTable.columnAutoresizingStyle = NSTableViewLastColumnOnlyAutoresizingStyle;
    for (NSArray *spec in @[@[@"list", @"구분", @150], @[@"title", @"항목", @300], @[@"detail", @"설명", @440]]) {
        NSTableColumn *column = [[NSTableColumn alloc] initWithIdentifier:spec[0]]; column.title = spec[1]; column.width = [spec[2] doubleValue]; column.editable = NO;
        [self.organizerTable addTableColumn:column];
    }
    scroll.documentView = self.organizerTable; [content addSubview:scroll];
    // 고른 항목 칸: 이름, 그 종류에 맞는 버튼만, 누르면 무엇이 바뀌는지 한 줄
    // 바탕(NSBox)은 뒤에 깔고 이름·버튼은 보통 칸에 둔다(NSBox 안의 버튼은 잘린다).
    NSView *inner = [[NSView alloc] initWithFrame:NSMakeRect(16, 52, w - 32, 92)];
    inner.autoresizingMask = NSViewWidthSizable | NSViewMaxYMargin; [content addSubview:inner];
    NSBox *box = [[NSBox alloc] initWithFrame:inner.bounds];
    box.boxType = NSBoxCustom; box.cornerRadius = 5; box.borderColor = [NSColor colorWithCalibratedWhite:0.78 alpha:1];
    box.fillColor = [NSColor colorWithCalibratedWhite:0.97 alpha:1]; box.titlePosition = NSNoTitle;
    box.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable; [inner addSubview:box];
    CGFloat bw = w - 32;
    self.organizerTitle = Label(@"", NSMakeRect(12, 64, bw - 24, 18), 13); self.organizerTitle.autoresizingMask = NSViewWidthSizable; [inner addSubview:self.organizerTitle];
    self.organizerHint = Label(@"", NSMakeRect(12, 6, bw - 24, 16), 11); self.organizerHint.textColor = NSColor.secondaryLabelColor; self.organizerHint.autoresizingMask = NSViewWidthSizable; [inner addSubview:self.organizerHint];
    NSArray *actions = @[@[@"diff", @"차이 보기"], @[@"server", @"서버 것 받기"], @[@"mac", @"Mac 것 올리기"], @[@"number", @"둘 다 두기"], @[@"trash", @"서버 휴지통으로"], @[@"image", @"이미지 받기"], @[@"import", @"그림 가져오기"], @[@"removeNumbered", @"번호 사본 지우기"], @[@"web", @"웹에서 보기"]];
    NSMutableDictionary *buttons = [NSMutableDictionary dictionary];
    for (NSArray *spec in actions) {
        NSButton *button = Button(spec[1], NSMakeRect(12, 28, 80, 28), self, @selector(organizerAction:));
        button.identifier = spec[0]; button.autoresizingMask = NSViewMaxXMargin; button.hidden = YES;
        [inner addSubview:button]; buttons[spec[0]] = button;
    }
    self.organizerButtons = buttons;
    NSButton *check = Button(@"전체 확인 지금", NSMakeRect(16, 14, 130, 28), self, @selector(fullCheckNow:)); check.autoresizingMask = NSViewMaxXMargin | NSViewMaxYMargin;
    self.organizerStatus = Label(@"", NSMakeRect(156, 20, w - 172, 18), 12); self.organizerStatus.autoresizingMask = NSViewWidthSizable | NSViewMaxYMargin;
    [content addSubview:check]; [content addSubview:self.organizerStatus];
}
#pragma mark - 오른쪽 클릭 강제 동작

// 데일리 창 한 줄이 가리키는 문서 경로. 오른쪽 클릭 강제 동작과 원격 강제 동작이 같이 쓴다.
static NSArray *RowDocumentPaths(NSDictionary *row) {
    NSMutableOrderedSet *paths = [NSMutableOrderedSet orderedSet];
    for (NSString *key in @[@"serviceDocuments", @"macDeletedDocuments", @"missingLocal", @"macOnlyDocuments", @"macChangedDocuments"]) for (id path in row[key]) if ([path isKindOfClass:NSString.class]) [paths addObject:path];
    for (NSDictionary *doc in row[@"documents"]) if ([doc[@"path"] isKindOfClass:NSString.class]) [paths addObject:doc[@"path"]];
    return [paths.array sortedArrayUsingSelector:@selector(localizedStandardCompare:)];
}
// 문서 하나에 할 수 있는 강제 동작. 실제로 불가능한 것(파일이 없음 등)만 NO.
- (NSDictionary *)forceState:(NSString *)path {
    BOOL mac = [self.engine hasLocalDocument:path];
    NSDictionary *entry = [self.engine.receipt ledger:path]; NSString *state = entry[@"state"];
    BOOL server = [entry[@"id"] length] > 0, active = server && ![state isEqual:@"trashed"];
    return @{@"where": [NSString stringWithFormat:@"%@ · %@", mac ? @"Mac 있음" : @"Mac 없음", !server ? @"서버 없음" : active ? @"서버 있음" : @"서버 휴지통"],
             @"diff": @(mac && server), @"server": @(active), @"mac": @(mac && server), @"trashServer": @(active), @"trashMac": @(mac), @"web": @(server)};
}
// 권장과 상관없이 문서 하나에 할 수 있는 동작. 실제로 불가능한 것(파일이 없음 등)만 끈다.
- (void)menuNeedsUpdate:(NSMenu *)menu {
    if (menu != self.table.menu) return;
    [menu removeAllItems];
    NSInteger index = self.table.clickedRow;
    if (index < 0 || index >= (NSInteger)self.rows.count) return;
    NSDictionary *row = self.rows[index];
    NSArray *paths = RowDocumentPaths(row);
    NSMenuItem *head = [menu addItemWithTitle:[NSString stringWithFormat:@"강제 동작 · %@ (권장과 상관없이 실행)", row[@"name"] ?: @""] action:nil keyEquivalent:@""]; head.enabled = NO;
    if (!paths.count) { NSMenuItem *none = [menu addItemWithTitle:@"이 예배에 문서가 없습니다" action:nil keyEquivalent:@""]; none.enabled = NO; return; }
    [menu addItem:NSMenuItem.separatorItem];
    for (NSString *path in paths) {
        NSDictionary *state = [self forceState:path];
        NSMenuItem *docItem = [menu addItemWithTitle:[NSString stringWithFormat:@"%@  (%@)", path.stringByDeletingPathExtension, state[@"where"]] action:nil keyEquivalent:@""];
        NSMenu *actions = [NSMenu new]; actions.autoenablesItems = NO;
        for (NSArray *spec in @[@[@"diff", @"차이 보기"], @[@"server", @"서버 것 받기 (Mac 파일을 서버 것으로)"], @[@"mac", @"Mac 것 올리기 (서버를 Mac 것으로)"],
                                @[@"trashServer", @"서버 휴지통으로"], @[@"trashMac", @"Mac에서 지우기 (macOS 휴지통)"], @[@"web", @"웹에서 보기"]]) {
            NSMenuItem *item = [actions addItemWithTitle:spec[1] action:@selector(forceDocument:) keyEquivalent:@""];
            item.target = self; item.enabled = [state[spec[0]] boolValue] && !self.busy; item.representedObject = @{@"action": spec[0], @"path": path};
        }
        docItem.submenu = actions;
    }
}
- (void)forceDocument:(NSMenuItem *)sender {
    NSString *action = sender.representedObject[@"action"], *path = sender.representedObject[@"path"], *name = path.stringByDeletingPathExtension;
    if ([action isEqual:@"diff"]) { [self showDiffForPath:path]; return; }
    if ([action isEqual:@"web"]) { NSString *link = [self.engine webLink:path]; if (link) [NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:link]]; return; }
    NSDictionary *words = @{@"server": @"Mac 파일을 서버 것으로 바꿉니다. 지금 Mac 파일은 백업 폴더와 서버 보관본에 남습니다.",
                            @"mac": @"Mac 파일을 서버의 새 버전으로 올립니다. 그전 서버 내용은 이력에 남습니다.",
                            @"trashServer": @"서버 문서를 서버 휴지통으로 옮깁니다. 웹 휴지통에서 꺼낼 수 있습니다. 이 문서를 쓰는 서버 예배 순서는 Studio에서 따로 정리해 주세요.",
                            @"trashMac": @"Mac 파일을 macOS 휴지통으로 옮깁니다. 백업 폴더에도 사본을 남깁니다. 서버 것은 그대로입니다."};
    NSAlert *confirm = [NSAlert new]; confirm.messageText = [NSString stringWithFormat:@"강제 동작 · %@", name];
    confirm.informativeText = [words[action] stringByAppendingString:@"\n\nSync가 권하는 동작과 다를 수 있습니다. 진행할까요?"];
    [confirm addButtonWithTitle:@"진행"]; [confirm addButtonWithTitle:@"취소"];
    if ([confirm runModal] != NSAlertFirstButtonReturn) return;
    [self runOrganizer:@"강제 동작 중" task:^id{
        if ([action isEqual:@"server"]) [self.engine takeServer:path];
        else if ([action isEqual:@"mac"]) [self.engine takeMac:path];
        else if ([action isEqual:@"trashServer"]) [self.engine trashOnServer:path];
        else if ([action isEqual:@"trashMac"]) [self.engine trashOnMac:path];
        return @YES;
    } done:^(id result) { [self compareNow:nil]; }];
}

- (void)windowWillClose:(NSNotification *)note {
    if (note.object != self.organizer || !self.organizerDirty) return;
    self.organizerDirty = NO; [self compareNow:nil];
}
- (void)showOrganizer:(id)sender {
    if (!self.organizer) [self buildOrganizer];
    [self reloadOrganizer];
    [self.organizer makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES];
}
- (void)reloadOrganizer {
    NSInteger keep = self.organizerTable.selectedRow;
    self.organizerRows = [[self reviewItems] mutableCopy];
    [self.organizerTable reloadData];
    // 처리한 줄이 빠지면 같은 자리의 다음 줄을 고른다(이어서 처리)
    if (keep >= 0 && self.organizerRows.count) [self.organizerTable selectRowIndexes:[NSIndexSet indexSetWithIndex:MIN((NSUInteger)keep, self.organizerRows.count - 1)] byExtendingSelection:NO];
    NSDictionary *check = [self.engine lastFullCheck], *last = [self.engine lastApply];
    NSString *at = check[@"at"] ? LocalTime(check[@"at"]) : @"아직 없음";
    NSString *counts = check[@"at"] ? [NSString stringWithFormat:@" · 처음 대조로 같음 %@ · 확인 필요 %lu", check[@"remembered"] ?: @"-", (unsigned long)[check[@"collisions"] count] + [check[@"macDeleted"] count]] : @"";
    if (!self.checking) self.organizerStatus.stringValue = [NSString stringWithFormat:@"지난 전체 확인 %@%@%@", at, counts, last ? [NSString stringWithFormat:@" · 되돌릴 수 있는 적용 %@", LocalTime(last[@"at"])] : @""];
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
// 고른 항목 종류에 맞는 버튼만 보이고, 첫 버튼(주로 할 일)이 무엇을 바꾸는지 아래 줄에 적는다. 버튼마다 마우스 설명도 같다.
static NSString *ActionHint(NSString *action, NSString *list) {
    if ([action isEqual:@"server"] && [list isEqual:kListMacDeleted]) return @"다시 받기: 서버 것을 이 Mac에 다시 받습니다.";
    return @{@"diff": @"차이 보기: 슬라이드별로 Mac·서버 내용을 나란히 봅니다. 코드를 복사해 물어볼 수 있습니다.",
             @"server": @"서버 것 받기: Mac 파일을 서버 내용으로 바꾸고, Mac 것은 백업 폴더와 서버 보관본에 남깁니다.",
             @"mac": @"Mac 것 올리기: Mac 내용을 서버의 새 버전으로 올립니다. 그전 서버 내용은 이력에 남습니다.",
             @"number": @"둘 다 두기: Mac 파일을 ‘이름 2’로 바꿔 올리고, 원래 이름에는 서버 것을 받습니다.",
             @"trash": @"서버 휴지통으로: 서버 문서를 휴지통으로 옮깁니다. 웹 휴지통에서 꺼낼 수 있습니다.",
             @"image": @"이미지 받기: 서버에서 이미지를 받아 그 자리에 둡니다.",
             @"import": @"그림 가져오기: 그림을 PP6 미디어 폴더 YebaeOn/으로 복사하고 문서 경로를 바꿔 서버에도 올립니다. 원래 그림은 그대로 둡니다.",
             @"removeNumbered": @"번호 사본 지우기: Mac의 번호 파일은 macOS 휴지통으로(백업 사본 남김), 서버 문서는 서버 휴지통으로 옮깁니다. 원래 문서는 그대로입니다.",
             @"web": @"웹에서 보기: Studio에서 서버 것을 엽니다."}[action] ?: @"";
}
- (void)refreshOrganizerButtons {
    NSArray *items = [self selectedReviews]; NSDictionary *item = items.count == 1 ? items[0] : nil;
    NSSet *lists = [NSSet setWithArray:[items valueForKey:@"list"]]; NSString *list = lists.count == 1 ? lists.anyObject : nil;
    BOOL idle = !self.busy, docs = items.count > 0, single = item != nil;
    for (NSDictionary *each in items) if (![each[@"path"] hasSuffix:@".pro6"]) docs = NO;
    BOOL web = single && docs && [self.engine webLink:item[@"path"]] != nil;
    NSArray *shown = @[]; NSString *note = nil;
    if ([list isEqual:kListCollision]) shown = single ? (web ? @[@"diff", @"server", @"mac", @"number", @"web"] : @[@"diff", @"server", @"mac", @"number"]) : @[@"server", @"mac"];
    else if ([list isEqual:kListHold] && docs) shown = single ? (web ? @[@"diff", @"web"] : @[@"diff"]) : @[];
    else if ([list isEqual:kListMacDeleted] && docs) shown = @[@"server", @"trash"];
    else if ([list isEqual:kListImage]) shown = @[@"image"];
    else if ([list isEqual:kListExternal]) shown = web ? @[@"import", @"web"] : @[@"import"];
    else if ([list isEqual:kListNumbered]) shown = @[@"removeNumbered"];
    if (!items.count) { self.organizerTitle.stringValue = @"목록에서 항목을 고르세요."; note = @""; }
    else if (!list) { self.organizerTitle.stringValue = [NSString stringWithFormat:@"%lu개 고름", (unsigned long)items.count]; note = @"같은 구분끼리만 함께 처리할 수 있습니다."; }
    else self.organizerTitle.stringValue = single ? [NSString stringWithFormat:@"%@ · %@", item[@"title"] ?: @"", list] : [NSString stringWithFormat:@"%lu개 · %@", (unsigned long)items.count, list];
    CGFloat x = 12;
    for (NSString *key in @[@"diff", @"server", @"mac", @"number", @"trash", @"image", @"import", @"removeNumbered", @"web"]) {
        NSButton *button = self.organizerButtons[key]; BOOL visible = [shown containsObject:key];
        button.hidden = !visible; button.enabled = idle && visible;
        if ([key isEqual:@"server"]) button.title = [list isEqual:kListMacDeleted] ? @"다시 받기" : @"서버 것 받기";
        button.toolTip = ActionHint(key, list);
        if (!visible) continue;
        [button sizeToFit]; NSRect fit = button.frame; fit.size.width += 12; fit.origin = NSMakePoint(x, 28); button.frame = fit; x += fit.size.width + 6;
    }
    self.organizerHint.stringValue = note ?: (shown.count ? ActionHint(shown[[shown.firstObject isEqual:@"diff"] && shown.count > 1 ? 1 : 0], list) : @"");
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
            if (error) { [self note:[NSString stringWithFormat:@"%@ 실패 · %@", message, error.reason ?: @""]]; [self alert:@"하지 못함" text:error.reason]; }
            else if (done) done(result);
        });
    });
}
- (void)fullCheckNow:(id)sender { [self startFullCheck]; }
- (void)undoLastApply:(id)sender {
    NSDictionary *last = [self.engine lastApply];
    if (!last) { [self alert:@"되돌릴 적용이 없습니다" text:@"가장 최근 적용 하나만 되돌릴 수 있고, 이미 되돌렸으면 다시 할 수 없습니다."]; return; }
    NSAlert *confirm = [NSAlert new]; confirm.messageText = @"마지막 적용을 되돌릴까요?";
    confirm.informativeText = [NSString stringWithFormat:@"%@\n%@\n\n적용 뒤 다시 바뀐 파일은 건너뜁니다. 적용 때 새로 받은 문서는 macOS 휴지통으로 옮깁니다. PP6를 종료해 주세요.", LocalTime(last[@"at"]), [last[@"applied"] componentsJoinedByString:@", "]];
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
// 문서 차이 창(정리 창 [차이 보기]와 오른쪽 클릭 메뉴)
- (void)showDiffForPath:(NSString *)path {
    [self runOrganizer:@"차이 준비 중" task:^id{
            NSData *local = YBReadSafeFile(self.root, path, NULL), *remote = [self.engine serverBytes:path];
            NSDictionary *a = local ? PP6ParseDocumentData(local, path, @[], @{}, @[], @{}, YES) : nil, *b = remote ? PP6ParseDocumentData(remote, path, @[], @{}, @[], @{}, YES) : nil;
            YBRequire(![a[@"parseError"] length] && ![b[@"parseError"] length], @"문서 내용을 분석하지 못했습니다.");
            return @{@"local": a ?: @{}, @"remote": b ?: @{}, @"bytes": FirstDifference(local, remote), @"localFile": local ?: NSNull.null, @"remoteFile": remote ?: NSNull.null};
        } done:^(NSDictionary *result) {
            NSAlert *alert = [NSAlert new]; alert.messageText = [@"문서 비교 · " stringByAppendingString:path];
            alert.informativeText = [@"슬라이드를 골라 양쪽 내용을 보세요. 정하는 것은 정리 창 버튼으로 합니다.\n\n" stringByAppendingString:result[@"bytes"]];
            YBDocumentComparison *comparison = [[YBDocumentComparison alloc] initWithLocal:result[@"local"] remote:result[@"remote"]];
            comparison.localFile = [result[@"localFile"] isKindOfClass:NSData.class] ? result[@"localFile"] : nil;
            comparison.remoteFile = [result[@"remoteFile"] isKindOfClass:NSData.class] ? result[@"remoteFile"] : nil;
            alert.accessoryView = comparison;
            [alert addButtonWithTitle:@"닫기"]; [alert runModal];
        }];
}
- (void)organizerAction:(NSButton *)sender {
    NSArray *items = [self selectedReviews]; NSDictionary *item = items.firstObject; NSString *path = item[@"path"], *action = sender.identifier;
    if (!item) return;
    if ([action isEqual:@"web"]) { NSString *link = [self.engine webLink:path]; if (link) [NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:link]]; return; }
    if ([action isEqual:@"diff"]) { [self showDiffForPath:path]; return; }
    NSDictionary *words = @{@"server": @"서버 것으로 바꿀까요? Mac 것은 백업 폴더와 서버 보관본에 남습니다.", @"mac": @"Mac 것을 서버의 새 버전으로 올릴까요? 서버의 그전 내용은 이력에 남습니다.",
                            @"number": @"Mac 파일에 번호를 붙여(예: 이름 2) 둘 다 둘까요? 재생목록 참조도 고치고, 원래 이름에는 서버 것을 받습니다.", @"trash": @"서버 휴지통으로 옮길까요? 웹 휴지통에서 꺼낼 수 있습니다.", @"image": @"서버에서 이 이미지를 받아 그 자리에 둘까요?",
                            @"import": @"그림을 PP6 미디어 폴더 YebaeOn/으로 복사하고 문서 안 경로를 바꿀까요? 바꾸기 전 문서는 백업 폴더에 남고, 서버와 맞춰 본 문서는 서버에도 올립니다.",
                            @"removeNumbered": @"번호 붙은 사본을 지울까요? Mac 파일은 macOS 휴지통(백업 폴더에도 사본), 서버 문서는 서버 휴지통으로 옮깁니다. 원래 문서는 그대로 둡니다."};
    NSAlert *confirm = [NSAlert new]; confirm.messageText = items.count == 1 ? (item[@"title"] ?: @"") : [NSString stringWithFormat:@"%lu개 항목", (unsigned long)items.count];
    confirm.informativeText = [action isEqual:@"server"] && [item[@"list"] isEqual:kListMacDeleted] ? @"서버 것을 이 Mac에 다시 받을까요?" : words[action] ?: @"";
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
                else if ([action isEqual:@"removeNumbered"]) [self.engine removeNumbered:each[@"item"]];
                else if ([action isEqual:@"import"]) {
                    NSDictionary *result = [self.engine importExternal:each[@"item"]];
                    if ([result[@"missing"] count]) [failures addObject:[NSString stringWithFormat:@"%@: 원본 그림이 없어 건너뜀 · %@", target.lastPathComponent, [result[@"missing"] componentsJoinedByString:@", "]]];
                    else if ([result[@"copied"] integerValue] && ![result[@"uploaded"] boolValue]) [failures addObject:[NSString stringWithFormat:@"%@: Mac 문서만 바꿨습니다. 서버와 아직 맞춰 보지 않은 문서라 ‘같은 이름, 다른 내용’에서 Mac 것 올리기로 마저 올려 주세요.", target.lastPathComponent]];
                }
            } @catch (NSException *e) { [failures addObject:[NSString stringWithFormat:@"%@: %@", target.lastPathComponent, e.reason]]; }
        }
        return failures;
    } done:^(NSArray *failures) {
        if (failures.count) [self alert:[NSString stringWithFormat:@"확인할 것 %lu개", (unsigned long)failures.count] text:[failures componentsJoinedByString:@"\n"]];
        // 데일리 창 비교는 정리 창을 닫을 때 한 번 한다(정리 중에는 버튼을 잠그지 않는다).
        self.organizerDirty = YES;
    }];
}
- (void)tableViewSelectionDidChange:(NSNotification *)note {
    if (note.object == self.organizerTable) { [self refreshOrganizerButtons]; return; }
    NSInteger index = self.table.selectedRow;
    self.detailLabel.string = index >= 0 && index < (NSInteger)self.rows.count ? DetailText(self.rows[index]) : @"";
    self.detailLabel.textColor = NSColor.secondaryLabelColor; self.detailLabel.font = [NSFont systemFontOfSize:11];
}

#pragma mark - 메뉴 막대·설정

- (void)buildStatusItem {
    self.statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
    self.statusItem.button.title = @"예배온";
    // 메뉴 막대 아이콘: 지금 상태 한 줄, 창 열기, Studio 열기, 업데이트(새 버전이 있을 때만 설치)·버전, 종료. 비교·정리·설정은 창과 「도구」 메뉴에 있다.
    NSMenu *menu = [NSMenu new];
    self.statusLineItem = [menu addItemWithTitle:@"확인 전" action:nil keyEquivalent:@""]; self.statusLineItem.enabled = NO;
    [menu addItem:NSMenuItem.separatorItem];
    [menu addItemWithTitle:@"예배온 Sync 2 창 열기" action:@selector(showWindow:) keyEquivalent:@""];
    [menu addItemWithTitle:@"예배온 Studio 열기" action:@selector(openStudio:) keyEquivalent:@""];
    [menu addItem:NSMenuItem.separatorItem];
    self.statusUpdateItem = [menu addItemWithTitle:@"새 버전 설치…" action:@selector(installUpdate:) keyEquivalent:@""]; self.statusUpdateItem.hidden = YES;
    [menu addItemWithTitle:@"업데이트 확인" action:@selector(checkUpdateNow:) keyEquivalent:@""];
    NSMenuItem *version = [menu addItemWithTitle:[NSString stringWithFormat:@"버전: 빌드 %ld", (long)[YB2Update currentBuild]] action:nil keyEquivalent:@""]; version.enabled = NO;
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
// 다운로드 폴더 등에서 바로 연 앱은 macOS가 임시 위치(AppTranslocation)에서 실행한다. 그 경로는 재부팅하면 사라진다.
static BOOL Translocated(void) { return [NSBundle.mainBundle.bundlePath containsString:@"/AppTranslocation/"]; }
- (BOOL)writeLoginAgent {
    NSDictionary *agent = @{@"Label": kAgentLabel, @"ProgramArguments": @[@"/usr/bin/open", @"-g", NSBundle.mainBundle.bundlePath], @"RunAtLoad": @YES};
    [NSFileManager.defaultManager createDirectoryAtPath:self.agentPath.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:NULL];
    return [agent writeToFile:self.agentPath atomically:YES];
}
- (void)toggleLoginItem:(id)sender {
    NSString *path = self.agentPath;
    if ([NSFileManager.defaultManager fileExistsAtPath:path]) { [NSFileManager.defaultManager removeItemAtPath:path error:NULL]; return; }
    if (Translocated()) { [self alert:@"응용 프로그램 폴더로 옮긴 뒤 켜 주세요" text:@"지금 앱은 macOS가 임시 위치에서 실행하고 있어서, 다음 로그인 때 찾지 못합니다. 앱을 응용 프로그램 폴더로 옮기고 거기서 연 다음 다시 켜 주세요."]; return; }
    if (![self writeLoginAgent]) [self alert:@"로그인 시 실행을 설정하지 못했습니다" text:path];
}
// 켜져 있는데 적힌 앱 경로가 지금 앱과 다르면(앱을 옮겼거나 바꿈) 지금 경로로 고친다.
- (void)repairLoginAgent {
    NSDictionary *agent = [NSDictionary dictionaryWithContentsOfFile:self.agentPath];
    if (!agent || Translocated()) return;
    NSArray *arguments = agent[@"ProgramArguments"];
    if (![arguments.lastObject isEqual:NSBundle.mainBundle.bundlePath]) [self writeLoginAgent];
}
- (BOOL)validateMenuItem:(NSMenuItem *)item {
    if (item.action == @selector(toggleResident:)) item.state = self.resident ? NSControlStateValueOn : NSControlStateValueOff;
    if (item.action == @selector(toggleLoginItem:)) item.state = [NSFileManager.defaultManager fileExistsAtPath:self.agentPath] ? NSControlStateValueOn : NSControlStateValueOff;
    if (item.action == @selector(toggleSupport:)) item.title = self.supportUntil ? @"원격 지원 끝내기" : @"원격 지원 시작…";
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
        if ([row[@"imageTrashes"] count]) [parts addObject:[NSString stringWithFormat:@"그림 휴지통으로 %lu", (unsigned long)[row[@"imageTrashes"] count]]];
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
    // 받을 줄: 짧은 표시. 자세한 설명은 줄을 누르면 표 아래에 나온다(DetailText).
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
    if (unknown) [parts addObject:NoHistoryOnly(row) ? [NSString stringWithFormat:@"이력 없음 %lu · 정리 창에서 정하기", (unsigned long)unknown] : [NSString stringWithFormat:@"이력 없음 %lu", (unsigned long)unknown]];
    if ([row[@"revertedOrder"] boolValue] || [row[@"revertedDocuments"] count]) [parts addObject:@"되돌림 다시 적용"];
    if ([row[@"images"] count]) [parts addObject:[NSString stringWithFormat:@"이미지 %lu", (unsigned long)[row[@"images"] count]]];
    return [parts componentsJoinedByString:@" · "];
}
// 마우스를 올렸을 때 보이는 자세한 설명
// 줄을 고르면 표 아래에 보이는 설명: 할 일마다 한 줄, 문서 이름을 모두 적는다.
static NSString *Names(NSArray *paths) {
    NSMutableArray *names = [NSMutableArray array];
    for (id item in paths) { NSString *path = [item isKindOfClass:NSDictionary.class] ? item[@"path"] : item; if ([path isKindOfClass:NSString.class]) [names addObject:path.stringByDeletingPathExtension]; }
    return [names componentsJoinedByString:@", "];
}
static NSString *ImageNames(NSArray *images) {
    NSMutableArray *names = [NSMutableArray array];
    for (NSDictionary *image in images) [names addObject:[image[@"path"] lastPathComponent] ?: @""];
    return [names componentsJoinedByString:@", "];
}
static NSString *DetailText(NSDictionary *row) {
    NSString *status = row[@"status"];
    NSMutableArray *lines = [NSMutableArray array];
    if ([status isEqual:@"mac"]) {
        if ([row[@"macRenamed"] boolValue]) [lines addObject:[NSString stringWithFormat:@"예배 이름 올리기: ‘%@’", row[@"localName"] ?: row[@"name"]]];
        else if ([row[@"macOnlyOrder"] boolValue]) [lines addObject:@"순서 올리기: Mac에서 바꾼 순서를 서버에 올립니다."];
        if ([row[@"macOnlyDocuments"] count]) [lines addObject:[@"문서 올리기(Mac에서만 고침): " stringByAppendingString:Names(row[@"macOnlyDocuments"])]];
        if ([row[@"usageOnly"] count]) [lines addObject:[@"사용일만 알리기(내용 같음): " stringByAppendingString:Names(row[@"usageOnly"])]];
        if ([row[@"images"] count]) [lines addObject:[@"이미지 받기: " stringByAppendingString:ImageNames(row[@"images"])]];
        return [lines componentsJoinedByString:@"\n"];
    }
    if ([status isEqual:@"actions"]) {
        NSMutableArray *renames = [NSMutableArray array];
        for (NSDictionary *item in row[@"renames"]) [renames addObject:[NSString stringWithFormat:@"%@ → %@", [item[@"from"] stringByDeletingPathExtension], [item[@"to"] stringByDeletingPathExtension]]];
        if (renames.count) [lines addObject:[@"이름 바꾸기: " stringByAppendingString:[renames componentsJoinedByString:@", "]]];
        if ([row[@"trashes"] count]) [lines addObject:[@"macOS 휴지통으로: " stringByAppendingString:Names(row[@"trashes"])]];
        if ([row[@"imageTrashes"] count]) {   // 서버가 고아 이미지로 정리한 그림(파일 이름만)
            NSMutableArray *names = [NSMutableArray array]; for (NSDictionary *item in row[@"imageTrashes"]) [names addObject:[item[@"path"] lastPathComponent]];
            [lines addObject:[@"그림을 macOS 휴지통으로(서버에서 쓰지 않음): " stringByAppendingString:[names componentsJoinedByString:@", "]]];
        }
        if ([row[@"actionHolds"] count]) [lines addObject:[@"확인 필요(정리 창): " stringByAppendingString:Names(row[@"actionHolds"])]];
        return [lines componentsJoinedByString:@"\n"];
    }
    if (![status isEqual:@"receive"]) return StatusText(row);
    if ([row[@"macDeleted"] boolValue]) [lines addObject:@"Mac에서 지운 예배입니다. 체크하면 서버 것을 다시 받습니다."];
    else if ([row[@"serverNew"] boolValue]) [lines addObject:@"서버에 새로 생긴 예배입니다."];
    else if ([row[@"orderChanged"] boolValue]) [lines addObject:[row[@"macOrderChanged"] boolValue] ? @"순서: 서버 것을 받습니다. Mac 순서는 서버 보관본에 남깁니다." : @"순서: 서버 것을 받습니다."];
    if (row[@"renamedFrom"]) [lines addObject:[NSString stringWithFormat:@"이름: ‘%@’ → 서버 이름", row[@"renamedFrom"]]];
    NSMutableArray *receive = [NSMutableArray array], *unknown = [NSMutableArray array], *both = [NSMutableArray array];
    for (NSDictionary *doc in row[@"documents"]) if (![row[@"macChangedDocuments"] containsObject:doc[@"path"]]) [receive addObject:doc[@"path"]];
    for (NSString *path in row[@"macChangedDocuments"]) [[row[@"macChangedReasons"][path] isEqual:@"technical"] ? unknown : both addObject:path];
    if (receive.count) [lines addObject:[@"받기: " stringByAppendingString:Names(receive)]];
    if (both.count) [lines addObject:[@"양쪽 수정(서버 것 받기, Mac 것은 서버 보관본·백업에): " stringByAppendingString:Names(both)]];
    if (unknown.count) [lines addObject:[@"이력 없음(Mac 파일 그대로, 정리 창에서 정하기): " stringByAppendingString:Names(unknown)]];
    if ([row[@"macOnlyDocuments"] count]) [lines addObject:[@"올리기(Mac에서만 고침): " stringByAppendingString:Names(row[@"macOnlyDocuments"])]];
    if ([row[@"macDeletedDocuments"] count]) [lines addObject:[@"Mac에서 지운 문서(적용하면 다시 받음): " stringByAppendingString:Names(row[@"macDeletedDocuments"])]];
    if ([row[@"images"] count]) [lines addObject:[@"이미지 받기: " stringByAppendingString:ImageNames(row[@"images"])]];
    if ([row[@"missingServer"] unsignedIntegerValue]) [lines addObject:[NSString stringWithFormat:@"서버에 원본 없는 문서 %@개는 Mac 파일 그대로", row[@"missingServer"]]];
    if ([row[@"missingLocal"] count]) [lines addObject:[@"Mac에도 없는 문서: " stringByAppendingString:Names(row[@"missingLocal"])]];
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
    return at.length ? [NSString stringWithFormat:@"%@ · %@", by ?: @"", LocalTime(at)] : @"";
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
        // 고른 줄은 파란 바탕이므로 흰 글씨로 읽히게 한다.
        if ([table isRowSelected:index]) { [cell setTextColor:NSColor.alternateSelectedControlTextColor]; return; }
        [cell setTextColor:Checkable(row) && !NoHistoryOnly(row) ? [NSColor colorWithCalibratedRed:0.10 green:0.35 blue:0.75 alpha:1] : [status isEqual:@"hold"] ? [NSColor colorWithCalibratedRed:0.75 green:0.35 blue:0.10 alpha:1] : NSColor.disabledControlTextColor];
    }
}
- (BOOL)tableView:(NSTableView *)table shouldSelectRow:(NSInteger)index { return YES; }
// 체크 칸은 줄을 고르지 않아도 누를 수 있어야 한다.
- (BOOL)tableView:(NSTableView *)table shouldTrackCell:(NSCell *)cell forTableColumn:(NSTableColumn *)column row:(NSInteger)row { return YES; }

#pragma mark - 현황·원격 지원

// 현황: 비교·작업이 끝날 때와 PP6를 켜고 끌 때 서버에 한 줄로 올린다. 내용이 같으면 한 시간에 한 번만 보낸다.
// 원격 지원: Mac 앞에서 도구 메뉴 › [원격 지원 시작…]을 누르면 60분 동안 10초마다 원격 명령을 묻는다. 지원 시간이 아니면 묻지 않는다.
// 명령은 이 창·정리 창·오른쪽 클릭 강제 동작과 같은 동작뿐이고 확인 창 없이 실행해 결과를 보고한다.
// Mac 파일을 바꾸는 명령은 PP6가 켜져 있으면 하지 않는다. 대상은 지금 비교 결과·정리 창 목록에 있는 것만 받는다.
static const NSInteger kSupportMinutes = 60;
static const NSTimeInterval kSupportPoll = 10;

static NSString *ISOText(NSDate *date) {
    static NSISO8601DateFormatter *formatter; static dispatch_once_t once;
    dispatch_once(&once, ^{ formatter = [NSISO8601DateFormatter new]; });
    return date ? [formatter stringFromDate:date] : nil;
}
static NSDate *ISODate(id text) {
    if (![text isKindOfClass:NSString.class]) return nil;
    static NSISO8601DateFormatter *plain, *fractional; static dispatch_once_t once;
    dispatch_once(&once, ^{
        plain = [NSISO8601DateFormatter new];
        fractional = [NSISO8601DateFormatter new]; fractional.formatOptions = NSISO8601DateFormatWithInternetDateTime | NSISO8601DateFormatWithFractionalSeconds;
    });
    return [fractional dateFromString:text] ?: [plain dateFromString:text];
}
static BOOL SamePath(id a, id b) {
    return [a isKindOfClass:NSString.class] && [b isKindOfClass:NSString.class] && [[a precomposedStringWithCanonicalMapping] isEqual:[b precomposedStringWithCanonicalMapping]];
}
// 원격으로 누를 수 있는 정리 창 버튼(차이 보기·웹에서 보기 빼고). 항목 하나를 골랐을 때 정리 창에 보이는 버튼과 같다.
static NSArray *RemoteActions(NSDictionary *item) {
    NSString *list = item[@"list"], *path = item[@"path"];
    if (![path isKindOfClass:NSString.class] || !path.length) return @[];
    if ([list isEqual:kListCollision]) return @[@"server", @"mac", @"number"];
    if ([list isEqual:kListMacDeleted] && [path hasSuffix:@".pro6"]) return @[@"server", @"trash"];
    if ([list isEqual:kListImage]) return @[@"image"];
    if ([list isEqual:kListExternal]) return @[@"import"];
    if ([list isEqual:kListNumbered]) return @[@"removeNumbered"];
    return @[];
}
static NSString *RemoteLabel(NSDictionary *command) {
    NSString *action = command[@"action"]; NSDictionary *args = [command[@"args"] isKindOfClass:NSDictionary.class] ? command[@"args"] : @{};
    NSString *path = [args[@"path"] isKindOfClass:NSString.class] ? [args[@"path"] stringByDeletingPathExtension] : @"";
    if ([action isEqual:@"check"]) return @"다시 비교";
    if ([action isEqual:@"fullCheck"]) return @"전체 확인";
    if ([action isEqual:@"undo"]) return @"마지막 적용 되돌리기";
    if ([action isEqual:@"apply"]) return @"적용";
    if ([action isEqual:@"organizer"]) return [@"정리 · " stringByAppendingString:path];
    if ([action isEqual:@"force"]) return [@"강제 동작 · " stringByAppendingString:path];
    if ([action isEqual:@"message"]) return @"안내";
    return [action isKindOfClass:NSString.class] ? action : @"알 수 없는 명령";
}

- (void)note:(NSString *)text {
    if (!text.length) return;
    if (!self.recentLog) self.recentLog = [NSMutableArray array];
    NSString *time = [NSDateFormatter localizedStringFromDate:NSDate.date dateStyle:NSDateFormatterShortStyle timeStyle:NSDateFormatterShortStyle];
    NSString *line = [[text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] stringByReplacingOccurrencesOfString:@"\n" withString:@" · "];
    [self.recentLog addObject:[NSString stringWithFormat:@"%@ %@", time, line.length > 300 ? [line substringToIndex:300] : line]];
    while (self.recentLog.count > 30) [self.recentLog removeObjectAtIndex:0];
    [self scheduleStatus];
}
// compact: 서버 한도(64KB)를 넘을 때 문서 목록·기록을 줄인다.
- (NSDictionary *)statusReport:(BOOL)compact {
    BOOL support = self.supportUntil != nil && !compact;
    NSMutableArray *rows = [NSMutableArray array];
    for (NSDictionary *row in self.rows) {
        if (rows.count >= 80) break;
        NSString *status = row[@"status"] ?: @"";
        NSMutableDictionary *item = [@{@"node": row[@"key"] ?: @"", @"name": row[@"name"] ?: @"", @"status": status, @"text": StatusText(row) ?: @""} mutableCopy];
        if ([row[@"updatedAt"] length]) { item[@"updatedAt"] = row[@"updatedAt"]; item[@"updatedBy"] = row[@"updatedBy"] ?: @""; }
        if (![status isEqual:@"same"]) {
            if (!compact) item[@"detail"] = DetailText(row) ?: @"";
            item[@"applicable"] = @(Checkable(row) && !NoHistoryOnly(row) && [row[@"key"] length] > 0);
            item[@"changesMac"] = @(ChangesMac(row));
            if (support) {
                NSMutableArray *docs = [NSMutableArray array];
                for (NSString *path in RowDocumentPaths(row)) {
                    if (docs.count >= 40) break;
                    NSDictionary *state = [self forceState:path]; NSMutableArray *actions = [NSMutableArray array];
                    for (NSString *action in @[@"server", @"mac", @"trashServer", @"trashMac"]) if ([state[action] boolValue]) [actions addObject:action];
                    [docs addObject:@{@"path": path, @"where": state[@"where"], @"actions": actions}];
                }
                item[@"docs"] = docs;
            }
        }
        [rows addObject:item];
    }
    NSMutableArray *review = [NSMutableArray array];
    for (NSDictionary *each in [self reviewItems]) {
        if (review.count >= (compact ? 30 : 100)) break;
        [review addObject:@{@"list": each[@"list"] ?: @"", @"title": each[@"title"] ?: @"", @"path": each[@"path"] ?: @"", @"detail": each[@"detail"] ?: @"", @"actions": RemoteActions(each)}];
    }
    NSArray *log = self.recentLog ?: @[];
    if (compact && log.count > 10) log = [log subarrayWithRange:NSMakeRange(log.count - 10, 10)];
    NSMutableDictionary *report = [@{@"build": @([YB2Update currentBuild]), @"presenter": @(YBPresenterRunning()), @"busy": @(self.busy || self.checking),
                                     @"summary": self.summary ?: @"", @"rows": rows, @"review": review, @"log": log} mutableCopy];
    if (self.pendingRelease[@"build"]) report[@"update"] = self.pendingRelease[@"build"];
    if (self.lastError.length) report[@"error"] = self.lastError;
    NSString *fullCheck = [self.engine lastFullCheck][@"at"], *lastApply = [self.engine lastApply][@"at"];
    if ([fullCheck isKindOfClass:NSString.class]) report[@"fullCheckAt"] = fullCheck;
    if ([lastApply isKindOfClass:NSString.class]) report[@"lastApplyAt"] = lastApply;
    return report;
}
- (void)scheduleStatus {
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(sendStatus) object:nil];
    [self performSelector:@selector(sendStatus) withObject:nil afterDelay:2];
}
- (void)sendStatus {
    if (!self.server.deviceID || !self.window) return;
    if (self.statusSending) { [self scheduleStatus]; return; }
    NSDictionary *report = [self statusReport:NO];
    NSData *data = [NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingSortedKeys error:NULL];
    if (data.length > 60000) { report = [self statusReport:YES]; data = [NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingSortedKeys error:NULL]; }
    if (!data) return;
    NSString *hash = YBHash(data);
    if ([hash isEqual:self.statusHash] && self.statusSentAt && -self.statusSentAt.timeIntervalSinceNow < 3600) return;
    NSMutableDictionary *sent = [report mutableCopy];
    if (self.lastCycleAt) sent[@"lastCycleAt"] = ISOText(self.lastCycleAt);
    self.statusSending = YES; YB2Server *server = self.server;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        BOOL ok = NO;
        @try { [server postStatus:sent]; ok = YES; } @catch (NSException *e) { NSLog(@"status: %@", e.reason); }
        dispatch_async(dispatch_get_main_queue(), ^{ self.statusSending = NO; if (ok) { self.statusHash = hash; self.statusSentAt = NSDate.date; } });
    });
}

- (void)toggleSupport:(id)sender { if (self.supportUntil) [self endSupport:@"Mac에서 끝냄" notifyServer:YES]; else [self startSupport]; }
- (void)endSupportNow:(id)sender { [self endSupport:@"Mac에서 끝냄" notifyServer:YES]; }
- (void)startSupport {
    if (!self.server.deviceID) { [self alert:@"원격 지원을 시작할 수 없습니다" text:@"장치 열쇠로 연결된 뒤에 쓸 수 있습니다. [로그아웃] 뒤 다시 입장해 주세요."]; return; }
    NSAlert *confirm = [NSAlert new]; confirm.messageText = @"원격 지원을 시작할까요?";
    confirm.informativeText = [NSString stringWithFormat:@"%ld분 동안 관리자가 예배온 웹에서 이 Mac의 Sync를 조작할 수 있습니다: 다시 비교, 적용, 정리 창 버튼, 강제 동작, 마지막 적용 되돌리기.\n\nMac 파일을 바꾸는 일은 PP6가 켜져 있으면 하지 않습니다. 창 위에 원격 지원 상태가 보이고, 언제든 [끝내기]로 멈출 수 있습니다.", (long)kSupportMinutes];
    [confirm addButtonWithTitle:@"시작"]; [confirm addButtonWithTitle:@"취소"];
    if ([confirm runModal] != NSAlertFirstButtonReturn) return;
    YB2Server *server = self.server;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSString *until = nil; NSException *error = nil;
        @try { until = [server openSupport:kSupportMinutes]; } @catch (NSException *e) { error = e; }
        dispatch_async(dispatch_get_main_queue(), ^{
            if (error) { [self alert:@"원격 지원을 시작하지 못했습니다" text:error.reason]; return; }
            self.supportUntil = ISODate(until) ?: [NSDate dateWithTimeIntervalSinceNow:kSupportMinutes * 60];
            self.supportNote = @"관리자의 명령을 기다리는 중"; self.supportMessage = nil;
            if (!self.remoteQueue) self.remoteQueue = [NSMutableArray array];
            [self.supportTimer invalidate];
            self.supportTimer = [NSTimer timerWithTimeInterval:kSupportPoll target:self selector:@selector(supportTick) userInfo:nil repeats:YES];
            [NSRunLoop.mainRunLoop addTimer:self.supportTimer forMode:NSRunLoopCommonModes];   // 확인 창이 떠 있어도 묻는다
            [self note:@"원격 지원 시작"];
            [self refreshSupport]; [self showWindow:nil];
        });
    });
}
- (void)endSupport:(NSString *)reason notifyServer:(BOOL)notify {
    if (!self.supportUntil) return;
    self.supportUntil = nil; self.supportMessage = nil; [self.supportTimer invalidate]; self.supportTimer = nil;
    // 가져왔지만 아직 하지 않은 명령은 하지 않았다고 알린다.
    for (NSDictionary *command in self.remoteQueue) [self finishRemote:command state:@"rejected" message:@"원격 지원이 끝나 하지 않았습니다."];
    [self.remoteQueue removeAllObjects];
    if (notify && self.server.deviceID) {
        YB2Server *server = self.server;
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{ @try { [server closeSupport]; } @catch (NSException *e) { NSLog(@"support close: %@", e.reason); } });
    }
    [self note:[@"원격 지원 끝 · " stringByAppendingString:reason]];
    [self refreshSupport];
}
- (void)refreshSupport {
    BOOL on = self.supportUntil != nil;
    if (on == self.supportBar.hidden) { self.supportBar.hidden = !on; [self layoutBars]; }
    long left = on ? MAX(0L, (long)ceil(self.supportUntil.timeIntervalSinceNow / 60)) : 0;
    NSString *message = self.supportMessage.length ? [@" · 관리자 안내: " stringByAppendingString:self.supportMessage] : @"";
    self.supportLabel.stringValue = on ? [NSString stringWithFormat:@"원격 지원 중 · %ld분 남음 · %@%@", left, self.supportNote ?: @"", message] : @"";
    self.supportLabel.toolTip = self.supportLabel.stringValue;
    [self refreshStatusItem];
}
- (void)supportTick {
    if (!self.supportUntil) return;
    if (self.supportUntil.timeIntervalSinceNow <= 0) { [self endSupport:@"시간이 다 됨" notifyServer:YES]; return; }
    [self refreshSupport];
    if (self.remoteQueue.count) { [self runNextRemote]; return; }
    if (self.supportPolling || self.remoteRunning || self.busy || self.checking) return;
    self.supportPolling = YES; YB2Server *server = self.server;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        NSDictionary *result = nil; NSException *error = nil;
        @try { result = [server takeCommands]; } @catch (NSException *e) { error = e; }
        dispatch_async(dispatch_get_main_queue(), ^{
            self.supportPolling = NO;
            NSArray *commands = [result[@"commands"] isKindOfClass:NSArray.class] ? result[@"commands"] : @[];
            if (!self.supportUntil) { for (NSDictionary *command in commands) [self finishRemote:command state:@"rejected" message:@"원격 지원이 끝나 하지 않았습니다."]; return; }
            if (error) { self.supportNote = [@"서버 확인 실패 · " stringByAppendingString:error.reason ?: @""]; [self refreshSupport]; return; }
            NSDate *until = ISODate(result[@"supportUntil"]);
            if (!until) { [self endSupport:@"웹에서 끝냄" notifyServer:NO]; return; }
            self.supportUntil = until;
            for (NSDictionary *command in commands) if ([command isKindOfClass:NSDictionary.class]) [self.remoteQueue addObject:command];
            [self runNextRemote];
        });
    });
}
- (void)finishRemote:(NSDictionary *)command state:(NSString *)state message:(NSString *)message {
    NSString *identifier = command[@"id"];
    if (![identifier isKindOfClass:NSString.class] || !self.server.deviceID) return;
    YB2Server *server = self.server;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        @try { [server finishCommand:identifier state:state message:message ?: @""]; } @catch (NSException *e) { NSLog(@"remote result: %@", e.reason); }
    });
}
- (void)runNextRemote {
    if (self.remoteRunning || !self.remoteQueue.count || self.busy || self.checking || !self.supportUntil) return;
    NSDictionary *command = self.remoteQueue.firstObject; [self.remoteQueue removeObjectAtIndex:0];
    NSString *label = RemoteLabel(command);
    self.remoteRunning = YES; self.supportNote = [@"실행 중 · " stringByAppendingString:label]; [self refreshSupport];
    [self runRemote:command done:^(NSString *state, NSString *message) {
        self.remoteRunning = NO;
        NSString *verdict = [state isEqual:@"done"] ? @"완료" : [state isEqual:@"rejected"] ? @"하지 않음" : @"실패";
        NSString *first = [message componentsSeparatedByString:@"\n"].firstObject ?: @"";
        self.supportNote = [NSString stringWithFormat:@"%@ · %@%@", label, verdict, first.length ? [@" · " stringByAppendingString:first] : @""];
        [self note:[@"원격 · " stringByAppendingString:self.supportNote]];
        [self refreshSupport];
        [self finishRemote:command state:state message:message];
        if (self.remoteQueue.count) [self performSelector:@selector(runNextRemote) withObject:nil afterDelay:0.5];
    }];
}
// 작업 큐에서 돌린다. 확인·완료 창을 띄우지 않는다.
- (void)runRemoteTask:(id (^)(void))task done:(void (^)(id result, NSException *error))done {
    self.busy = YES; self.statusLabel.stringValue = @"원격 명령 실행 중";
    dispatch_async(self.work, ^{
        id result = nil; NSException *error = nil;
        @try { result = task(); } @catch (NSException *e) { error = e; }
        dispatch_async(dispatch_get_main_queue(), ^{
            self.busy = NO; self.statusLabel.stringValue = error ? error.reason : @"원격 명령 완료";
            [self refreshReview]; [self reloadOrganizer];
            done(result, error);
        });
    });
}
// 원격 명령 하나. done(state, message): state는 done · failed · rejected.
- (void)runRemote:(NSDictionary *)command done:(void (^)(NSString *state, NSString *message))done {
    NSString *action = command[@"action"]; NSDictionary *args = [command[@"args"] isKindOfClass:NSDictionary.class] ? command[@"args"] : @{};
    BOOL presenter = YBPresenterRunning();
    NSString *pp6 = @"PP6가 켜져 있어 하지 않았습니다. Mac 앞에서 PP6를 닫은 뒤 다시 보내 주세요.";
    if ([action isEqual:@"message"]) {
        NSString *text = [args[@"text"] isKindOfClass:NSString.class] ? args[@"text"] : @"";
        self.supportMessage = text; [self refreshSupport]; [self showWindow:nil]; NSBeep();
        done(@"done", @"Mac 화면에 띄웠습니다."); return;
    }
    if ([action isEqual:@"check"]) {
        [self runCycleForce:YES upload:NO completion:^(NSException *error) { done(error ? @"failed" : @"done", error ? error.reason : self.summary); }];
        return;
    }
    if ([action isEqual:@"fullCheck"]) {
        if (self.checking) { done(@"rejected", @"전체 확인이 이미 돌고 있습니다."); return; }
        [self startFullCheck];
        done(@"done", @"전체 확인을 시작했습니다. 끝나면 현황의 정리 창 목록이 바뀝니다."); return;
    }
    if ([action isEqual:@"undo"]) {
        if (presenter) { done(@"rejected", pp6); return; }
        if (![self.engine lastApply]) { done(@"rejected", @"되돌릴 적용이 없습니다."); return; }
        [self runRemoteTask:^id{ return [self.engine undoLastApply]; } done:^(NSDictionary *result, NSException *error) {
            NSMutableString *text = [NSMutableString string];
            if ([result[@"restored"] count]) [text appendFormat:@"되돌림: %@\n", [result[@"restored"] componentsJoinedByString:@", "]];
            if ([result[@"skipped"] count]) [text appendFormat:@"건너뜀: %@\n", [result[@"skipped"] componentsJoinedByString:@", "]];
            done(error ? @"failed" : @"done", error ? error.reason : text.length ? text : @"되돌렸습니다.");
            [self compareNow:nil];
        }];
        return;
    }
    if ([action isEqual:@"apply"]) {
        NSArray *nodes = [args[@"nodes"] isKindOfClass:NSArray.class] ? args[@"nodes"] : @[];
        NSMutableArray *selected = [NSMutableArray array], *missing = [nodes mutableCopy]; BOOL changesMac = NO;
        for (NSDictionary *row in self.rows) {
            if (![nodes containsObject:row[@"key"] ?: @""] || !Checkable(row) || NoHistoryOnly(row)) continue;
            [selected addObject:row]; [missing removeObject:row[@"key"]]; changesMac = changesMac || ChangesMac(row);
        }
        if (missing.count || !selected.count) { done(@"rejected", @"지금 비교 결과에서 적용할 수 없는 예배입니다(이미 같거나 정리 창에서 정할 것). [다시 비교] 뒤 현황을 새로 고쳐 주세요."); return; }
        if (changesMac && presenter) { done(@"rejected", pp6); return; }
        [self runRemoteTask:^id{ return [self syncRows:selected automatic:NO]; } done:^(NSDictionary *result, NSException *error) {
            NSString *text = error ? error.reason : Summary(result);
            done(error ? @"failed" : @"done", text.length ? text : @"바뀐 것이 없습니다.");
            [self compareNow:nil];
        }];
        return;
    }
    if ([action isEqual:@"organizer"]) {
        NSString *what = args[@"do"]; NSDictionary *item = nil;
        for (NSDictionary *each in [self reviewItems]) if (SamePath(each[@"path"], args[@"path"]) && [RemoteActions(each) containsObject:what ?: @""]) { item = each; break; }
        if (!item) { done(@"rejected", @"정리 창에 그 항목이 없거나 그 동작을 할 수 없습니다. 현황을 새로 고쳐 다시 골라 주세요."); return; }
        if (presenter && ![what isEqual:@"mac"] && ![what isEqual:@"trash"]) { done(@"rejected", pp6); return; }
        NSString *path = item[@"path"];
        [self runRemoteTask:^id{
            if ([what isEqual:@"server"]) [self.engine takeServer:path];
            else if ([what isEqual:@"mac"]) [self.engine takeMac:path];
            else if ([what isEqual:@"number"]) return [self.engine keepBothNumbered:path];
            else if ([what isEqual:@"trash"]) [self.engine trashOnServer:path];
            else if ([what isEqual:@"image"]) [self.engine fetchImage:item[@"item"]];
            else if ([what isEqual:@"removeNumbered"]) [self.engine removeNumbered:item[@"item"]];
            else if ([what isEqual:@"import"]) return [self.engine importExternal:item[@"item"]];
            return @YES;
        } done:^(id result, NSException *error) {
            NSString *text = error ? error.reason : @"했습니다.";
            if (!error && [what isEqual:@"number"]) text = [NSString stringWithFormat:@"Mac 파일을 ‘%@’(으)로 올리고 원래 이름에는 서버 것을 받았습니다.", result];
            if (!error && [what isEqual:@"import"] && [result isKindOfClass:NSDictionary.class]) {
                if ([result[@"missing"] count]) text = [@"원본 그림이 없어 건너뜀: " stringByAppendingString:[result[@"missing"] componentsJoinedByString:@", "]];
                else if ([result[@"copied"] integerValue] && ![result[@"uploaded"] boolValue]) text = @"Mac 문서만 바꿨습니다. 서버와 아직 맞춰 보지 않은 문서입니다.";
            }
            done(error ? @"failed" : @"done", text);
            [self compareNow:nil];
        }];
        return;
    }
    if ([action isEqual:@"force"]) {
        NSString *what = args[@"do"], *path = nil;
        for (NSDictionary *row in self.rows) { for (NSString *each in RowDocumentPaths(row)) if (SamePath(each, args[@"path"])) { path = each; break; } if (path) break; }
        if (!path || ![@[@"server", @"mac", @"trashServer", @"trashMac"] containsObject:what ?: @""] || ![[self forceState:path][what] boolValue]) { done(@"rejected", @"데일리 창 예배에 그 문서가 없거나 그 동작을 할 수 없습니다."); return; }
        if (presenter && ([what isEqual:@"server"] || [what isEqual:@"trashMac"])) { done(@"rejected", pp6); return; }
        [self runRemoteTask:^id{
            if ([what isEqual:@"server"]) [self.engine takeServer:path];
            else if ([what isEqual:@"mac"]) [self.engine takeMac:path];
            else if ([what isEqual:@"trashServer"]) [self.engine trashOnServer:path];
            else if ([what isEqual:@"trashMac"]) [self.engine trashOnMac:path];
            return @YES;
        } done:^(id result, NSException *error) {
            done(error ? @"failed" : @"done", error ? error.reason : @"했습니다.");
            [self compareNow:nil];
        }];
        return;
    }
    done(@"rejected", @"이 버전의 Sync가 모르는 명령입니다. Sync를 업데이트해 주세요.");
}

- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)app {
    if (self.busy) { self.statusLabel.stringValue = @"작업 중에는 종료할 수 없습니다. 끝난 뒤 다시 종료해 주세요."; return NSTerminateCancel; }
    if (self.supportUntil) {   // 앱을 끄면 지원 시간도 닫는다(종료 중이라 기다려서 보낸다)
        for (NSDictionary *command in self.remoteQueue) {
            @try { [self.server finishCommand:command[@"id"] state:@"rejected" message:@"Sync가 종료돼 하지 않았습니다."]; } @catch (NSException *e) { NSLog(@"remote result: %@", e.reason); }
        }
        [self.remoteQueue removeAllObjects]; self.supportUntil = nil;
        @try { [self.server closeSupport]; } @catch (NSException *e) { NSLog(@"support close: %@", e.reason); }
    }
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
