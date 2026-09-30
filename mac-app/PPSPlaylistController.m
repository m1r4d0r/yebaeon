#import "PPSPlaylistController.h"
#import "YBAppUI.h"
#import "YBPlaylistIO.h"
#import "../mac-sync/YBSync.h"

@interface PPSRowView : NSTableCellView
@end
@implementation PPSRowView
@end

@interface PPSPlaylistController () <NSTableViewDataSource, NSTableViewDelegate>
@property(nonatomic, readwrite) NSView *view;
@property NSWindow *window;
@property NSTextField *localPathLabel;
@property NSTextField *incomingPathLabel;
@property NSTextField *statusLabel;
@property NSTextField *summaryLabel;
@property NSTableView *playlistTable;
@property NSTableView *itemTable;
@property NSTableView *deletedTable;
@property NSButton *applyButton;
@property NSMutableArray<NSMutableDictionary *> *reviews;
@property NSInteger selectedReviewIndex;
@property NSURL *localURL;
@property NSURL *incomingURL;
@property NSString *localXML;
@property NSString *incomingXML;
@property NSString *settingsPath;
@property BOOL suppressNoChangeAlert;
@end

@implementation PPSPlaylistController

#pragma mark - App lifecycle

- (instancetype)init {
    if((self=[super init])) {
        self.reviews=[NSMutableArray array]; self.selectedReviewIndex=-1;
        [self buildWindow]; [self loadSettings];
    }
    return self;
}

#pragma mark - UI helpers

- (NSTextField *)label:(NSString *)text frame:(NSRect)frame fontSize:(CGFloat)size bold:(BOOL)bold {
    NSTextField *label = [[NSTextField alloc] initWithFrame:frame];
    label.bezeled = NO;
    label.drawsBackground = NO;
    label.editable = NO;
    label.selectable = NO;
    label.stringValue = text ?: @"";
    label.font = bold ? [NSFont boldSystemFontOfSize:size] : [NSFont systemFontOfSize:size];
    label.lineBreakMode = NSLineBreakByTruncatingMiddle;
    return label;
}

- (NSButton *)button:(NSString *)title frame:(NSRect)frame action:(SEL)action {
    NSButton *b = [[NSButton alloc] initWithFrame:frame];
    b.title = title;
    b.bezelStyle = NSBezelStyleRounded;
    b.target = self;
    b.action = action;
    return b;
}

- (NSScrollView *)scrollWithTable:(NSTableView *)table frame:(NSRect)frame {
    NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:frame];
    scroll.borderType = NSBezelBorder;
    scroll.hasVerticalScroller = YES;
    scroll.hasHorizontalScroller = NO;
    scroll.autohidesScrollers = YES;
    scroll.documentView = table;
    return scroll;
}

- (NSTableColumn *)column:(NSString *)identifier title:(NSString *)title width:(CGFloat)width {
    NSTableColumn *col = [[NSTableColumn alloc] initWithIdentifier:identifier];
    col.title = title;
    col.width = width;
    col.minWidth = 40;
    return col;
}

- (void)buildWindow {
    NSView *c=[[NSView alloc] initWithFrame:NSMakeRect(0,0,1060,720)]; self.view=c;
    NSTextField *title = [self label:@"재생목록 비교 · 적용" frame:NSMakeRect(24, 670, 260, 26) fontSize:22 bold:YES];
    [c addSubview:title];

    NSButton *chooseLocal = [self button:@"운영 파일 선택" frame:NSMakeRect(24, 626, 120, 32) action:@selector(chooseLocal:)];
    [c addSubview:chooseLocal];
    self.localPathLabel = [self label:@"운영 파일이 아직 지정되지 않았습니다." frame:NSMakeRect(154, 630, 640, 24) fontSize:13 bold:NO];
    [c addSubview:self.localPathLabel];

    NSButton *chooseIncoming = [self button:@"최신 파일 선택" frame:NSMakeRect(24, 586, 120, 32) action:@selector(chooseIncoming:)];
    [c addSubview:chooseIncoming];
    self.incomingPathLabel = [self label:@"비교할 새 .pro6pl 파일을 선택하세요." frame:NSMakeRect(154, 590, 640, 24) fontSize:13 bold:NO];
    [c addSubview:self.incomingPathLabel];

    NSButton *restore = [self button:@"백업 복원" frame:NSMakeRect(820, 626, 100, 32) action:@selector(restoreBackup:)];
    [c addSubview:restore];
    NSButton *refresh = [self button:@"다시 비교" frame:NSMakeRect(930, 626, 100, 32) action:@selector(refreshCompare:)];
    [c addSubview:refresh];

    self.statusLabel = [self label:@"운영 파일과 새 파일을 선택하면 변경된 재생목록을 비교합니다." frame:NSMakeRect(24, 552, 1006, 22) fontSize:12 bold:NO];
    self.statusLabel.textColor = [NSColor secondaryLabelColor];
    [c addSubview:self.statusLabel];

    NSTextField *leftHeader = [self label:@"변경된 재생목록" frame:NSMakeRect(24, 520, 220, 20) fontSize:14 bold:YES];
    [c addSubview:leftHeader];

    self.playlistTable = [[NSTableView alloc] initWithFrame:NSMakeRect(0, 0, 250, 446)];
    [self.playlistTable addTableColumn:[self column:@"apply" title:@"적용" width:56]];
    [self.playlistTable addTableColumn:[self column:@"name" title:@"재생목록" width:186]];
    self.playlistTable.headerView = [[NSTableHeaderView alloc] initWithFrame:NSMakeRect(0, 0, 250, 20)];
    self.playlistTable.delegate = self;
    self.playlistTable.dataSource = self;
    self.playlistTable.allowsMultipleSelection = NO;
    self.playlistTable.rowHeight = 34;
    [self.playlistTable setTarget:self];
    [self.playlistTable setAction:@selector(playlistSelectionChanged:)];
    [c addSubview:[self scrollWithTable:self.playlistTable frame:NSMakeRect(24, 76, 258, 438)]];

    self.summaryLabel = [self label:@"추가 0  ·  수정 0  ·  삭제 0  ·  이동 0" frame:NSMakeRect(304, 520, 726, 20) fontSize:14 bold:YES];
    [c addSubview:self.summaryLabel];

    self.itemTable = [[NSTableView alloc] initWithFrame:NSMakeRect(0, 0, 720, 310)];
    [self.itemTable addTableColumn:[self column:@"index" title:@"순서" width:60]];
    [self.itemTable addTableColumn:[self column:@"name" title:@"항목명" width:430]];
    [self.itemTable addTableColumn:[self column:@"change" title:@"변경" width:210]];
    self.itemTable.delegate = self;
    self.itemTable.dataSource = self;
    self.itemTable.rowHeight = 28;
    [c addSubview:[self scrollWithTable:self.itemTable frame:NSMakeRect(304, 204, 726, 310)]];

    NSTextField *deletedHeader = [self label:@"삭제된 항목" frame:NSMakeRect(304, 176, 160, 20) fontSize:14 bold:YES];
    deletedHeader.textColor = [NSColor colorWithCalibratedRed:0.65 green:0.08 blue:0.08 alpha:1.0];
    [c addSubview:deletedHeader];

    self.deletedTable = [[NSTableView alloc] initWithFrame:NSMakeRect(0, 0, 720, 92)];
    [self.deletedTable addTableColumn:[self column:@"oldIndex" title:@"이전 순서" width:90]];
    [self.deletedTable addTableColumn:[self column:@"name" title:@"항목명" width:610]];
    self.deletedTable.delegate = self;
    self.deletedTable.dataSource = self;
    self.deletedTable.rowHeight = 28;
    [c addSubview:[self scrollWithTable:self.deletedTable frame:NSMakeRect(304, 76, 726, 96)]];

    NSButton *cancel = [self button:@"예제로 비교" frame:NSMakeRect(24, 24, 130, 34) action:@selector(loadDemo:)];
    [c addSubview:cancel];
    self.applyButton = [self button:@"선택한 재생목록 적용" frame:NSMakeRect(870, 24, 160, 34) action:@selector(applySelected:)];
    self.applyButton.enabled = NO;
    [c addSubview:self.applyButton];
}

#pragma mark - Settings

- (NSString *)appSupportDir {return YBPreferencesDirectory();}

- (void)loadSettings {
    NSString *dir = [self appSupportDir];
    self.settingsPath = [dir stringByAppendingPathComponent:@"playlist-settings.json"];
    NSData *data = [NSData dataWithContentsOfFile:self.settingsPath];
    if(!data) data=[NSData dataWithContentsOfFile:YBLegacySettingsPath()];
    if (!data) return;
    NSDictionary *json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    NSString *path = [json isKindOfClass:[NSDictionary class]] ? json[@"localPath"] : nil;
    if (path.length && [[NSFileManager defaultManager] fileExistsAtPath:path]) {
        self.localURL = [NSURL fileURLWithPath:path];
        self.localPathLabel.stringValue = path;
        [self reloadLocalXML];
        [self saveSettings];
    }
}

- (void)saveSettings {
    if (!self.localURL) return;
    NSString *dir = [self appSupportDir];
    [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
    NSDictionary *json = @{ @"localPath": self.localURL.path ?: @"" };
    NSData *data = [NSJSONSerialization dataWithJSONObject:json options:NSJSONWritingPrettyPrinted error:nil];
    [data writeToFile:self.settingsPath atomically:YES];
}

#pragma mark - File actions

- (NSURL *)choosePro6plWithPrompt:(NSString *)prompt directory:(NSURL *)directory {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.title = prompt;
    panel.canChooseFiles = YES;
    panel.canChooseDirectories = NO;
    panel.allowsMultipleSelection = NO;
    panel.allowedFileTypes = @[@"pro6pl"];
    if (directory) panel.directoryURL = directory;
    return ([panel runModal] == NSModalResponseOK) ? panel.URL : nil;
}

- (void)chooseLocal:(id)sender {
    NSURL *url = [self choosePro6plWithPrompt:@"실제 운영 중인 .pro6pl 파일을 선택하세요" directory:self.localURL.URLByDeletingLastPathComponent];
    if (!url) return;
    self.localURL = url;
    self.localPathLabel.stringValue = url.path;
    [self saveSettings];
    if (![self reloadLocalXML]) return;
    [self compareIfReady];
}

- (void)chooseIncoming:(id)sender {
    NSURL *url = [self choosePro6plWithPrompt:@"새 버전 .pro6pl 파일을 선택하세요" directory:self.incomingURL.URLByDeletingLastPathComponent];
    if (!url) return;
    self.incomingURL = url;
    self.incomingPathLabel.stringValue = url.path;
    NSError *error = nil;
    self.incomingXML = [NSString stringWithContentsOfURL:url encoding:NSUTF8StringEncoding error:&error];
    if (!self.incomingXML) {
        [self showError:@"새 파일을 읽지 못했습니다." detail:error.localizedDescription];
        return;
    }
    [self compareIfReady];
}

- (BOOL)reloadLocalXML {
    if (!self.localURL) return NO;
    NSError *error = nil;
    self.localXML = [NSString stringWithContentsOfURL:self.localURL encoding:NSUTF8StringEncoding error:&error];
    if (!self.localXML) {
        [self showError:@"운영 파일을 읽지 못했습니다." detail:error.localizedDescription];
        return NO;
    }
    return YES;
}

- (void)refreshCompare:(id)sender {
    if (![self reloadLocalXML]) return;
    if (self.incomingURL) {
        self.incomingXML = [NSString stringWithContentsOfURL:self.incomingURL encoding:NSUTF8StringEncoding error:nil];
    }
    [self compareIfReady];
}

#pragma mark - XML parsing

- (NSString *)attribute:(NSString *)name inTag:(NSString *)tag {
    NSString *pattern = [NSString stringWithFormat:@"\\b%@=\"([^\"]*)\"", [NSRegularExpression escapedPatternForString:name]];
    NSRegularExpression *re = [NSRegularExpression regularExpressionWithPattern:pattern options:0 error:nil];
    NSTextCheckingResult *m = [re firstMatchInString:tag options:0 range:NSMakeRange(0, tag.length)];
    if (!m || m.numberOfRanges < 2) return @"";
    NSString *s = [tag substringWithRange:[m rangeAtIndex:1]];
    s = [s stringByReplacingOccurrencesOfString:@"&amp;" withString:@"&"];
    s = [s stringByReplacingOccurrencesOfString:@"&quot;" withString:@"\""];
    s = [s stringByReplacingOccurrencesOfString:@"&lt;" withString:@"<"];
    s = [s stringByReplacingOccurrencesOfString:@"&gt;" withString:@">"];
    s = [s stringByReplacingOccurrencesOfString:@"&apos;" withString:@"'"];
    return s;
}

- (NSArray<NSDictionary *> *)topPlaylists:(NSString *)xml {
    if (!xml.length) return @[];
    NSRegularExpression *re = [NSRegularExpression regularExpressionWithPattern:@"<RVPlaylistNode\\b[^>]*>|</RVPlaylistNode>" options:0 error:nil];
    NSArray<NSTextCheckingResult *> *matches = [re matchesInString:xml options:0 range:NSMakeRange(0, xml.length)];
    NSMutableArray *out = [NSMutableArray array];
    NSInteger depth = 0;
    BOOL rootSeen = NO;
    NSRange startRange = NSMakeRange(NSNotFound, 0);
    NSString *startTag = nil;

    for (NSTextCheckingResult *m in matches) {
        NSString *token = [xml substringWithRange:m.range];
        BOOL closing = [token hasPrefix:@"</"];
        BOOL selfClosing = [token hasSuffix:@"/>"];
        if (closing) {
            if (rootSeen && depth == 2 && startRange.location != NSNotFound) {
                NSUInteger end = NSMaxRange(m.range);
                NSRange rawRange = NSMakeRange(startRange.location, end - startRange.location);
                NSString *raw = [xml substringWithRange:rawRange];
                [out addObject:@{
                    @"uuid": [self attribute:@"UUID" inTag:startTag ?: @""] ?: @"",
                    @"name": [self attribute:@"displayName" inTag:startTag ?: @""] ?: @"",
                    @"raw": raw,
                    @"range": [NSValue valueWithRange:rawRange]
                }];
                startRange = NSMakeRange(NSNotFound, 0);
                startTag = nil;
            }
            depth--;
            if (rootSeen && depth <= 0) break;
        } else {
            if (!rootSeen) {
                rootSeen = YES;
                if (!selfClosing) depth = 1;
                continue;
            }
            if (depth == 1 && !selfClosing) {
                startRange = m.range;
                startTag = token;
            }
            if (!selfClosing) depth++;
        }
    }
    return out;
}

- (NSString *)semanticPlaylist:(NSString *)raw {
    NSString *s = raw ?: @"";
    NSRegularExpression *r1 = [NSRegularExpression regularExpressionWithPattern:@"\\smodifiedDate=\"[^\"]*\"" options:0 error:nil];
    s = [r1 stringByReplacingMatchesInString:s options:0 range:NSMakeRange(0, s.length) withTemplate:@""];
    NSRegularExpression *r2 = [NSRegularExpression regularExpressionWithPattern:@"\\sisExpanded=\"[^\"]*\"" options:0 error:nil];
    s = [r2 stringByReplacingMatchesInString:s options:0 range:NSMakeRange(0, s.length) withTemplate:@""];
    return s;
}

- (NSArray<NSDictionary *> *)parseCues:(NSString *)raw {
    NSRegularExpression *re = [NSRegularExpression regularExpressionWithPattern:@"<(RVDocumentCue|RVHeaderCue)\\b[^>]*/>" options:0 error:nil];
    NSArray *matches = [re matchesInString:raw options:0 range:NSMakeRange(0, raw.length)];
    NSMutableDictionary<NSString *, NSNumber *> *occ = [NSMutableDictionary dictionary];
    NSMutableArray *out = [NSMutableArray array];
    for (NSTextCheckingResult *m in matches) {
        NSString *tag = [raw substringWithRange:m.range];
        NSString *kind = [raw substringWithRange:[m rangeAtIndex:1]];
        NSString *name = [self attribute:@"displayName" inTag:tag];
        NSString *filePath = [self attribute:@"filePath" inTag:tag];
        NSString *uuid = [self attribute:@"UUID" inTag:tag];
        NSString *contentHash = [self attribute:@"contentHash" inTag:tag];
        NSString *base = filePath.length ? filePath : (uuid.length ? uuid : name);
        NSString *baseKey = [NSString stringWithFormat:@"%@|%@", kind ?: @"", base ?: @""];
        NSInteger n = [occ[baseKey] integerValue] + 1;
        occ[baseKey] = @(n);
        NSString *key = [NSString stringWithFormat:@"%@#%ld", baseKey, (long)n];
        [out addObject:@{
            @"key": key,
            @"name": name.length ? name : @"(이름 없음)",
            @"filePath": filePath ?: @"",
            @"uuid": uuid ?: @"",
            @"contentHash": contentHash ?: @"",
            @"raw": tag
        }];
    }
    return out;
}

- (NSSet<NSString *> *)lcsKeepSetOld:(NSArray<NSString *> *)a new:(NSArray<NSString *> *)b {
    NSInteger m = a.count, n = b.count;
    if (m == 0 || n == 0) return [NSSet set];
    NSInteger cols = n + 1;
    NSInteger *dp = calloc((m + 1) * (n + 1), sizeof(NSInteger));
    #define DP(i,j) dp[(i) * cols + (j)]
    for (NSInteger i = m - 1; i >= 0; i--) {
        for (NSInteger j = n - 1; j >= 0; j--) {
            if ([a[i] isEqualToString:b[j]]) DP(i,j) = DP(i+1,j+1) + 1;
            else DP(i,j) = MAX(DP(i+1,j), DP(i,j+1));
        }
    }
    NSMutableSet *keep = [NSMutableSet set];
    NSInteger i = 0, j = 0;
    while (i < m && j < n) {
        if ([a[i] isEqualToString:b[j]]) {
            [keep addObject:a[i]];
            i++; j++;
        } else if (DP(i+1,j) >= DP(i,j+1)) {
            i++;
        } else {
            j++;
        }
    }
    free(dp);
    return keep;
}

- (NSMutableDictionary *)reviewOld:(NSDictionary *)oldPl new:(NSDictionary *)newPl {
    NSArray *oldItems = [self parseCues:oldPl[@"raw"]];
    NSArray *newItems = [self parseCues:newPl[@"raw"]];

    NSMutableDictionary *oldMap = [NSMutableDictionary dictionary];
    NSMutableDictionary *newMap = [NSMutableDictionary dictionary];
    for (NSInteger i = 0; i < oldItems.count; i++) {
        NSMutableDictionary *x = [oldItems[i] mutableCopy]; x[@"oldIndex"] = @(i+1); oldMap[x[@"key"]] = x;
    }
    for (NSInteger i = 0; i < newItems.count; i++) {
        NSMutableDictionary *x = [newItems[i] mutableCopy]; x[@"newIndex"] = @(i+1); newMap[x[@"key"]] = x;
    }

    NSMutableArray *deleted = [NSMutableArray array];
    NSMutableSet *added = [NSMutableSet set];
    for (NSDictionary *x in oldItems) {
        if (!newMap[x[@"key"]]) [deleted addObject:@{ @"oldIndex": oldMap[x[@"key"]][@"oldIndex"], @"name": x[@"name"] }];
    }
    for (NSDictionary *x in newItems) if (!oldMap[x[@"key"]]) [added addObject:x[@"key"]];

    NSMutableArray *oldCommon = [NSMutableArray array], *newCommon = [NSMutableArray array];
    for (NSDictionary *x in oldItems) if (newMap[x[@"key"]]) [oldCommon addObject:x[@"key"]];
    for (NSDictionary *x in newItems) if (oldMap[x[@"key"]]) [newCommon addObject:x[@"key"]];
    NSSet *stationary = [self lcsKeepSetOld:oldCommon new:newCommon];

    NSMutableArray *rendered = [NSMutableArray array];
    NSInteger addedCount = 0, modifiedCount = 0, movedCount = 0;

    for (NSInteger i = 0; i < newItems.count; i++) {
        NSDictionary *x = newItems[i];
        NSString *key = x[@"key"];
        NSInteger newIndex = i + 1;
        NSMutableDictionary *row = [@{ @"index": @(newIndex), @"name": x[@"name"], @"change": @"", @"type": @"same" } mutableCopy];
        if ([added containsObject:key]) {
            row[@"change"] = @"추가"; row[@"type"] = @"added"; addedCount++;
        } else {
            NSDictionary *old = oldMap[key];
            BOOL modified = ![old[@"contentHash"] isEqualToString:x[@"contentHash"]];
            BOOL moved = ![stationary containsObject:key];
            NSMutableArray *parts = [NSMutableArray array];
            if (modified) { [parts addObject:@"수정"]; modifiedCount++; }
            if (moved) {
                [parts addObject:[NSString stringWithFormat:@"이동 (%@→%ld)", old[@"oldIndex"], (long)newIndex]];
                movedCount++;
                row[@"from"] = old[@"oldIndex"]; row[@"to"] = @(newIndex);
            }
            row[@"change"] = [parts componentsJoinedByString:@" · "];
            row[@"type"] = modified ? @"modified" : (moved ? @"moved" : @"same");
        }
        [rendered addObject:row];
    }

    return [@{
        @"uuid": newPl[@"uuid"] ?: @"",
        @"name": newPl[@"name"] ?: @"",
        @"oldRaw": oldPl[@"raw"] ?: @"",
        @"newRaw": newPl[@"raw"] ?: @"",
        @"items": rendered,
        @"deleted": deleted,
        @"added": @(addedCount),
        @"modified": @(modifiedCount),
        @"deletedCount": @(deleted.count),
        @"moved": @(movedCount),
        @"selected": @YES
    } mutableCopy];
}

#pragma mark - Compare

- (void)compareIfReady {
    if (!self.localXML.length || !self.incomingXML.length) {
        self.statusLabel.stringValue = @"운영 파일과 새 파일을 모두 선택하면 비교합니다.";
        return;
    }

    @try { YBValidatePlaylist([self.localXML dataUsingEncoding:NSUTF8StringEncoding]); YBValidatePlaylist([self.incomingXML dataUsingEncoding:NSUTF8StringEncoding]); }
    @catch(NSException *error) { [self.reviews removeAllObjects]; self.applyButton.enabled=NO; [self.playlistTable reloadData]; [self showError:@"재생목록을 비교하지 못했습니다." detail:error.reason]; return; }
    NSArray *oldList = [self topPlaylists:self.localXML];
    NSArray *newList = [self topPlaylists:self.incomingXML];
    NSMutableDictionary *oldMap = [NSMutableDictionary dictionary];
    for (NSDictionary *p in oldList) {
        NSString *key = [p[@"uuid"] length] ? p[@"uuid"] : p[@"name"];
        if (key) oldMap[key] = p;
    }

    [self.reviews removeAllObjects];
    NSInteger sameCount = 0, newPlaylistCount = 0;
    for (NSDictionary *np in newList) {
        NSString *key = [np[@"uuid"] length] ? np[@"uuid"] : np[@"name"];
        NSDictionary *op = oldMap[key];
        if (!op) { newPlaylistCount++; continue; }
        if ([[self semanticPlaylist:op[@"raw"]] isEqualToString:[self semanticPlaylist:np[@"raw"]]]) {
            sameCount++; continue;
        }
        NSMutableDictionary *review = [self reviewOld:op new:np];
        NSInteger total = [review[@"added"] integerValue] + [review[@"modified"] integerValue] + [review[@"deletedCount"] integerValue] + [review[@"moved"] integerValue];
        if(total==0) { review[@"modified"]=@1; review[@"items"]=@[@{@"index":@0,@"name":@"재생목록 이름·설정 또는 기타 XML 변경",@"change":@"수정",@"type":@"modified"}]; }
        [self.reviews addObject:review];
    }

    self.selectedReviewIndex = self.reviews.count ? 0 : -1;
    [self.playlistTable reloadData];
    [self.itemTable reloadData];
    [self.deletedTable reloadData];
    if (self.selectedReviewIndex >= 0) [self.playlistTable selectRowIndexes:[NSIndexSet indexSetWithIndex:0] byExtendingSelection:NO];
    [self updateReviewHeader];
    self.applyButton.enabled = self.reviews.count > 0;
    self.statusLabel.stringValue = [NSString stringWithFormat:@"비교 완료 · 변경 %ld개 · 동일 %ld개 · 신규 재생목록 %ld개 (신규 재생목록 자동 추가는 아직 지원하지 않음)", (long)self.reviews.count, (long)sameCount, (long)newPlaylistCount];

    if (self.reviews.count == 0 && !self.suppressNoChangeAlert) {
        NSAlert *none = [[NSAlert alloc] init];
        none.alertStyle = NSAlertStyleInformational;
        if (newPlaylistCount > 0) {
            none.messageText = @"적용 가능한 변경 사항이 없습니다.";
            none.informativeText = [NSString stringWithFormat:@"기존 재생목록의 변경 사항은 없습니다. 신규 재생목록 %ld개는 아직 자동 추가하지 않습니다.", (long)newPlaylistCount];
        } else {
            none.messageText = @"변경 사항이 없습니다.";
            none.informativeText = @"운영 파일과 최신 파일의 재생목록이 동일합니다.";
        }
        [none addButtonWithTitle:@"확인"];
        [none runModal];
    }
}

- (void)updateReviewHeader {
    if (self.selectedReviewIndex < 0 || self.selectedReviewIndex >= self.reviews.count) {
        self.summaryLabel.stringValue = @"추가 0  ·  수정 0  ·  삭제 0  ·  이동 0";
        return;
    }
    NSDictionary *r = self.reviews[self.selectedReviewIndex];
    self.summaryLabel.stringValue = [NSString stringWithFormat:@"%@  ·  추가 %@  ·  수정 %@  ·  삭제 %@  ·  이동 %@", r[@"name"], r[@"added"], r[@"modified"], r[@"deletedCount"], r[@"moved"]];
}

#pragma mark - Table data source

- (NSInteger)numberOfRowsInTableView:(NSTableView *)tableView {
    if (tableView == self.playlistTable) return self.reviews.count;
    if (self.selectedReviewIndex < 0 || self.selectedReviewIndex >= self.reviews.count) return 0;
    NSDictionary *r = self.reviews[self.selectedReviewIndex];
    if (tableView == self.itemTable) return [r[@"items"] count];
    if (tableView == self.deletedTable) return [r[@"deleted"] count];
    return 0;
}

- (NSView *)tableView:(NSTableView *)tableView viewForTableColumn:(NSTableColumn *)tableColumn row:(NSInteger)row {
    NSString *identifier = tableColumn.identifier;
    if (tableView == self.playlistTable) {
        NSMutableDictionary *r = self.reviews[row];
        if ([identifier isEqualToString:@"apply"]) {
            NSButton *b = [[NSButton alloc] initWithFrame:NSMakeRect(0, 0, 52, 24)];
            b.buttonType = NSSwitchButton;
            b.title = @"";
            b.state = [r[@"selected"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
            b.tag = row;
            b.target = self;
            b.action = @selector(toggleReview:);
            return b;
        }
        NSTextField *t = [self label:r[@"name"] frame:NSMakeRect(0,0,180,26) fontSize:13 bold:YES];
        return t;
    }

    if (self.selectedReviewIndex < 0 || self.selectedReviewIndex >= self.reviews.count) return nil;
    NSDictionary *review = self.reviews[self.selectedReviewIndex];

    if (tableView == self.itemTable) {
        NSDictionary *item = review[@"items"][row];
        NSString *text = @"";
        if ([identifier isEqualToString:@"index"]) text = [NSString stringWithFormat:@"%02ld", (long)[item[@"index"] integerValue]];
        else if ([identifier isEqualToString:@"name"]) text = item[@"name"];
        else text = [item[@"change"] length] ? item[@"change"] : @"-";
        NSTextField *cell = [self label:text frame:NSMakeRect(0,0,tableColumn.width,26) fontSize:13 bold:NO];
        cell.wantsLayer = YES;
        NSString *type = item[@"type"];
        NSColor *bg = [NSColor whiteColor];
        if ([type isEqualToString:@"added"]) bg = [NSColor colorWithCalibratedRed:0.91 green:0.98 blue:0.91 alpha:1];
        else if ([type isEqualToString:@"modified"]) bg = [NSColor colorWithCalibratedRed:1.0 green:0.96 blue:0.84 alpha:1];
        else if ([type isEqualToString:@"moved"]) bg = [NSColor colorWithCalibratedRed:0.93 green:0.96 blue:1.0 alpha:1];
        cell.layer.backgroundColor = bg.CGColor;
        return cell;
    }

    NSDictionary *item = review[@"deleted"][row];
    NSString *text = [identifier isEqualToString:@"oldIndex"] ? [NSString stringWithFormat:@"%02ld", (long)[item[@"oldIndex"] integerValue]] : item[@"name"];
    NSTextField *cell = [self label:text frame:NSMakeRect(0,0,tableColumn.width,26) fontSize:13 bold:NO];
    cell.wantsLayer = YES;
    cell.layer.backgroundColor = [NSColor colorWithCalibratedRed:1.0 green:0.94 blue:0.94 alpha:1].CGColor;
    if ([identifier isEqualToString:@"name"]) cell.textColor = [NSColor colorWithCalibratedRed:0.65 green:0.08 blue:0.08 alpha:1];
    return cell;
}

- (void)playlistSelectionChanged:(id)sender {
    NSInteger row = self.playlistTable.selectedRow;
    if (row < 0 || row >= self.reviews.count) return;
    self.selectedReviewIndex = row;
    [self.itemTable reloadData];
    [self.deletedTable reloadData];
    [self updateReviewHeader];
}

- (void)toggleReview:(NSButton *)sender {
    if (sender.tag < 0 || sender.tag >= self.reviews.count) return;
    self.reviews[sender.tag][@"selected"] = @(sender.state == NSControlStateValueOn);
}

#pragma mark - Apply / backup / restore

- (BOOL)isProPresenterRunning { return YBPresenterRunning(); }

- (NSString *)backupRoot {
    NSArray *dirs = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES);
    NSString *docs = dirs.count ? dirs[0] : [NSHomeDirectory() stringByAppendingPathComponent:@"Documents"];
    return [docs stringByAppendingPathComponent:@"PP6-Playlist-Backups"];
}

- (NSString *)replacingSelectedNodesIn:(NSString *)localXML {
    NSArray *localList = [self topPlaylists:localXML];
    NSMutableDictionary *localMap = [NSMutableDictionary dictionary];
    for (NSDictionary *p in localList) {
        NSString *key = [p[@"uuid"] length] ? p[@"uuid"] : p[@"name"];
        if (key) localMap[key] = p;
    }

    NSMutableArray *ops = [NSMutableArray array];
    for (NSDictionary *r in self.reviews) {
        if (![r[@"selected"] boolValue]) continue;
        NSString *key = [r[@"uuid"] length] ? r[@"uuid"] : r[@"name"];
        NSDictionary *target = localMap[key];
        if (!target) continue;
        [ops addObject:@{ @"range": target[@"range"], @"newRaw": r[@"newRaw"] }];
    }
    [ops sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
        NSRange ra = [a[@"range"] rangeValue], rb = [b[@"range"] rangeValue];
        if (ra.location > rb.location) return NSOrderedAscending;
        if (ra.location < rb.location) return NSOrderedDescending;
        return NSOrderedSame;
    }];

    NSMutableString *out = [localXML mutableCopy];
    for (NSDictionary *op in ops) [out replaceCharactersInRange:[op[@"range"] rangeValue] withString:op[@"newRaw"]];
    return out;
}

- (BOOL)verifyXML:(NSString *)xml {
    NSArray *list = [self topPlaylists:xml];
    NSMutableDictionary *map = [NSMutableDictionary dictionary];
    for (NSDictionary *p in list) {
        NSString *key = [p[@"uuid"] length] ? p[@"uuid"] : p[@"name"];
        if (key) map[key] = p;
    }
    for (NSDictionary *r in self.reviews) {
        if (![r[@"selected"] boolValue]) continue;
        NSString *key = [r[@"uuid"] length] ? r[@"uuid"] : r[@"name"];
        NSDictionary *p = map[key];
        if (!p) return NO;
        if (![[self semanticPlaylist:p[@"raw"]] isEqualToString:[self semanticPlaylist:r[@"newRaw"]]]) return NO;
    }
    return YES;
}

- (void)applySelected:(id)sender {
    if (!self.localURL || !self.localXML.length || !self.incomingXML.length) return;
    BOOL any = NO;
    for (NSDictionary *r in self.reviews) if ([r[@"selected"] boolValue]) { any = YES; break; }
    if (!any) { [self showError:@"적용할 재생목록이 선택되지 않았습니다." detail:@"왼쪽 목록에서 적용할 재생목록을 체크하세요."]; return; }
    if ([self isProPresenterRunning]) { [self showError:@"ProPresenter가 실행 중입니다." detail:@"ProPresenter 6을 완전히 종료한 뒤 다시 적용하세요."]; return; }

    NSAlert *confirm = [[NSAlert alloc] init];
    confirm.messageText = @"선택한 재생목록을 운영 파일에 적용할까요?";
    confirm.informativeText = @"적용 전에 현재 운영 파일을 자동 백업합니다. 선택하지 않은 재생목록은 그대로 유지됩니다.";
    [confirm addButtonWithTitle:@"적용"];
    [confirm addButtonWithTitle:@"취소"];
    if ([confirm runModal] != NSAlertFirstButtonReturn) return;

    NSString *newXML=[self replacingSelectedNodesIn:self.localXML];
    if(![self verifyXML:newXML]) { [self showError:@"적용 전 검증에 실패했습니다." detail:@"운영 파일은 변경하지 않았습니다."]; return; }
    NSURL *backup=nil; NSString *written=nil;
    @try {
        backup=YBReplacePlaylist(self.localURL,[self.localXML dataUsingEncoding:NSUTF8StringEncoding],[newXML dataUsingEncoding:NSUTF8StringEncoding],[self backupRoot],^BOOL{ return [self isProPresenterRunning]; });
        written=newXML;
    } @catch(NSException *error) { [self showError:@"재생목록을 적용하지 못했습니다." detail:error.reason]; return; }

    self.localXML = written;

    NSAlert *done = [[NSAlert alloc] init];
    done.alertStyle = NSAlertStyleInformational;
    done.messageText = @"적용 완료";
    done.informativeText = [NSString stringWithFormat:@"선택한 재생목록을 적용했습니다. 선택하지 않은 재생목록은 유지했습니다.\n\n기존 파일 백업 위치:\n%@", backup.path];
    [done addButtonWithTitle:@"확인"];
    [done runModal];

    self.suppressNoChangeAlert = YES;
    [self compareIfReady];
    self.suppressNoChangeAlert = NO;
}

- (void)restoreBackup:(id)sender {
    if (!self.localURL) { [self showError:@"운영 파일이 지정되지 않았습니다." detail:@"먼저 운영 파일을 선택하세요."]; return; }
    if ([self isProPresenterRunning]) { [self showError:@"ProPresenter가 실행 중입니다." detail:@"ProPresenter 6을 완전히 종료한 뒤 복원하세요."]; return; }
    NSURL *root = [NSURL fileURLWithPath:[self backupRoot]];
    NSURL *backup = [self choosePro6plWithPrompt:@"복원할 백업 .pro6pl 파일을 선택하세요" directory:root];
    if (!backup) return;

    NSAlert *confirm = [[NSAlert alloc] init];
    confirm.messageText = @"선택한 백업으로 운영 파일을 복원할까요?";
    confirm.informativeText = @"현재 운영 파일도 복원 직전에 한 번 더 백업합니다.";
    [confirm addButtonWithTitle:@"복원"];
    [confirm addButtonWithTitle:@"취소"];
    if ([confirm runModal] != NSAlertFirstButtonReturn) return;

    NSURL *preRestore=nil;
    @try {
        NSData *before=YBReadPlaylist(self.localURL), *replacement=YBReadPlaylist(backup);
        preRestore=YBReplacePlaylist(self.localURL,before,replacement,[self backupRoot],^BOOL{ return [self isProPresenterRunning]; });
    } @catch(NSException *error) { [self showError:@"백업 복원에 실패했습니다." detail:error.reason]; return; }
    [self reloadLocalXML];
    [self compareIfReady];
    NSAlert *done = [[NSAlert alloc] init];
    done.messageText = @"복원 완료";
    done.informativeText = [NSString stringWithFormat:@"백업을 복원했습니다. 복원 직전 파일도 다음 위치에 보관했습니다.\n%@", preRestore.path];
    [done addButtonWithTitle:@"확인"];
    [done runModal];
}

#pragma mark - Misc

- (void)showError:(NSString *)message detail:(NSString *)detail {
    NSAlert *a = [[NSAlert alloc] init];
    a.alertStyle = NSAlertStyleWarning;
    a.messageText = message ?: @"오류";
    a.informativeText = detail ?: @"";
    [a addButtonWithTitle:@"확인"];
    [a runModal];
}

- (void)loadDemo:(id)sender {
    @try {
        NSString *dir=[[self appSupportDir] stringByAppendingPathComponent:[@"Examples/" stringByAppendingString:NSUUID.UUID.UUIDString]];
        YBRequire([NSFileManager.defaultManager createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:NULL],@"예제 폴더를 만들지 못했습니다.");
        for(NSString *name in @[@"dummy_old",@"dummy_new"]) {
            NSString *source=[NSBundle.mainBundle pathForResource:name ofType:@"pro6pl"];
            YBRequire(source && [NSFileManager.defaultManager copyItemAtPath:source toPath:[dir stringByAppendingPathComponent:[name stringByAppendingString:@".pro6pl"]] error:NULL],@"예제 파일을 복사하지 못했습니다.");
        }
        self.localURL=[NSURL fileURLWithPath:[dir stringByAppendingPathComponent:@"dummy_old.pro6pl"]];
        self.incomingURL=[NSURL fileURLWithPath:[dir stringByAppendingPathComponent:@"dummy_new.pro6pl"]];
        self.localPathLabel.stringValue=self.localURL.path; self.incomingPathLabel.stringValue=self.incomingURL.path;
        [self refreshCompare:nil];
    } @catch(NSException *error) { [self showError:@"예제를 열지 못했습니다." detail:error.reason]; }
}

@end
