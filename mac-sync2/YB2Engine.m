#import "YB2Engine.h"
#import "YB2Server.h"
#import "../mac-app/YBPlaylistFormat.h"
#import "../mac-app/YBPlaylistIO.h"
#import <sys/stat.h>

@interface YB2Engine ()
@property(nonatomic, readwrite) YBServer *server;
@property(nonatomic, readwrite) NSString *root;
@property(nonatomic, readwrite) NSURL *playlistURL;
@property(nonatomic, readwrite) NSString *profile;
@property(nonatomic, readwrite) YB2Receipt *receipt;
@property(nonatomic, readwrite) NSString *comparedPlaylistHash;
@property(nonatomic) NSDictionary *library;             // 서버 재생목록 파일 메타데이터
@property(nonatomic) NSSet *knownDocumentIDs;           // 마지막 비교의 예배들이 쓰는 서버 문서 id(변경 일지 거르기용)
@end

@implementation YB2Engine

static NSDictionary *Headers(void) { return @{@"X-YebaeOn-Sync": @"2"}; }
static NSString *Query(NSString *value) {
    return [value stringByAddingPercentEncodingWithAllowedCharacters:[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"]];
}
static NSData *JSONData(id value) { return [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingPrettyPrinted error:NULL]; }
static id JSON(NSData *data) { return data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL] : nil; }
static NSDictionary *JSONHeaders(void) { return @{@"X-YebaeOn-Sync": @"2", @"Content-Type": @"application/json"}; }

#pragma mark - 사용 기록 (PP6가 송출하며 바꾸는 루트 속성)

// <RVPresentationDocument …> 여는 태그의 범위. 따옴표 안의 '>'는 건너뛴다.
static NSRange RootTag(NSString *xml) {
    NSRange start = [xml rangeOfString:@"<RVPresentationDocument"];
    if (start.location == NSNotFound) return start;
    unichar quote = 0;
    for (NSUInteger i = NSMaxRange(start); i < xml.length; i++) {
        unichar c = [xml characterAtIndex:i];
        if (quote) { if (c == quote) quote = 0; }
        else if (c == '"' || c == '\'') quote = c;
        else if (c == '>') return NSMakeRange(start.location, i + 1 - start.location);
    }
    return NSMakeRange(NSNotFound, 0);
}
static NSRegularExpression *UsageAttribute(void) {
    static NSRegularExpression *pattern; static dispatch_once_t once;
    dispatch_once(&once, ^{ pattern = [NSRegularExpression regularExpressionWithPattern:@"\\s(lastDateUsed|usedCount)\\s*=\\s*(\"[^\"]*\"|'[^']*')" options:0 error:NULL]; });
    return pattern;
}
static NSString *Text(NSData *data) { return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil; }
// 사용일·사용 횟수를 뺀 바이트. 이 둘만 다른 두 파일은 같은 값이 된다.
static NSData *UsageNeutral(NSData *data) {
    NSString *xml = Text(data); if (!xml) return data;
    NSRange tag = RootTag(xml); if (tag.location == NSNotFound) return data;
    NSString *open = [xml substringWithRange:tag];
    NSString *clean = [UsageAttribute() stringByReplacingMatchesInString:open options:0 range:NSMakeRange(0, open.length) withTemplate:@""];
    return [[xml stringByReplacingCharactersInRange:tag withString:clean] dataUsingEncoding:NSUTF8StringEncoding];
}
static NSString *NeutralHash(NSData *data) { return data ? YBHash(UsageNeutral(data)) : nil; }
// {lastDateUsed, usedCount} (있는 것만)
static NSDictionary *UsageOf(NSData *data) {
    NSString *xml = Text(data); if (!xml) return @{};
    NSRange tag = RootTag(xml); if (tag.location == NSNotFound) return @{};
    NSString *open = [xml substringWithRange:tag]; NSMutableDictionary *usage = [NSMutableDictionary dictionary];
    for (NSTextCheckingResult *match in [UsageAttribute() matchesInString:open options:0 range:NSMakeRange(0, open.length)]) {
        NSString *value = [open substringWithRange:[match rangeAtIndex:2]];
        usage[[open substringWithRange:[match rangeAtIndex:1]]] = [value substringWithRange:NSMakeRange(1, value.length - 2)];
    }
    return usage;
}
// 서버 바이트에 Mac 파일의 사용일·사용 횟수를 옮겨 쓴다(재설계안 7.3, 결정 4). 루트 속성만 바꾼다.
static NSData *WithUsage(NSData *data, NSDictionary *usage) {
    if (!usage.count) return data;
    NSString *xml = Text(data); if (!xml) return data;
    NSRange tag = RootTag(xml); if (tag.location == NSNotFound) return data;
    NSString *open = [xml substringWithRange:tag];
    NSMutableString *clean = [[UsageAttribute() stringByReplacingMatchesInString:open options:0 range:NSMakeRange(0, open.length) withTemplate:@""] mutableCopy];
    NSMutableString *attributes = [NSMutableString string];
    for (NSString *key in @[@"lastDateUsed", @"usedCount"]) {
        NSString *value = usage[key];
        if (value && [value rangeOfString:@"[\"'<>&]" options:NSRegularExpressionSearch].location == NSNotFound) [attributes appendFormat:@" %@=\"%@\"", key, value];
    }
    if (!attributes.length) return data;
    NSUInteger insert = [clean hasSuffix:@"/>"] ? clean.length - 2 : clean.length - 1;
    [clean insertString:attributes atIndex:insert];
    return [[xml stringByReplacingCharactersInRange:tag withString:clean] dataUsingEncoding:NSUTF8StringEncoding];
}
static NSDictionary *DocumentForPath(NSDictionary *plan, NSString *path) {
    for (NSDictionary *doc in plan[@"documents"]) if ([doc[@"path"] isEqual:path]) return doc;
    return nil;
}

- (instancetype)initWithServer:(YBServer *)server root:(NSString *)root playlist:(NSURL *)playlist profile:(NSString *)profile {
    if (!(self = [super init])) return nil;
    _server = server; _root = root.stringByStandardizingPath.stringByResolvingSymlinksInPath; _playlistURL = playlist; _profile = profile.stringByStandardizingPath.stringByResolvingSymlinksInPath;
    [NSFileManager.defaultManager createDirectoryAtPath:_profile withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:NULL];
    _receipt = [[YB2Receipt alloc] initWithPath:[profile stringByAppendingPathComponent:@"receipt.sqlite"]];
    _presenterRunning = ^BOOL { return YBPresenterRunning(); };
    return self;
}
- (void)report:(NSString *)message { if (self.progress) self.progress(message); }

#pragma mark - 파일 정보

// 실제 디스크 이름이 NFD일 수 있으므로 두 표기를 모두 시도한다. 파일이 없으면 NO.
- (BOOL)statPath:(NSString *)path size:(long long *)size mtime:(long long *)mtime {
    for (NSString *candidate in @[path.precomposedStringWithCanonicalMapping, path.decomposedStringWithCanonicalMapping]) {
        struct stat st;
        if (lstat([self.root stringByAppendingPathComponent:candidate].fileSystemRepresentation, &st) == 0 && S_ISREG(st.st_mode)) {
            if (size) *size = st.st_size;
            if (mtime) *mtime = (long long)st.st_mtimespec.tv_sec * 1000000000LL + st.st_mtimespec.tv_nsec;
            return YES;
        }
    }
    return NO;
}
// 영수증의 크기·수정시각과 같으면 해시를 다시 계산하지 않는다.
- (NSString *)localHash:(NSString *)path {
    long long size = 0, mtime = 0;
    if (![self statPath:path size:&size mtime:&mtime]) return nil;
    NSDictionary *known = [self.receipt document:path];
    if (known && [known[@"size"] longLongValue] == size && [known[@"mtime"] longLongValue] == mtime) return known[@"sha"];
    NSData *bytes = YBReadSafeFile(self.root, path, NULL);
    return bytes ? YBHash(bytes) : nil;
}

#pragma mark - 순서 지문

// 예배 순서를 "무엇을 어떤 차례로 가리키나"로 요약한다. 경로 표기(절대/~, NFC/NFD)·cue UUID·modifiedDate는 들어가지 않는다.
- (NSString *)serverFingerprint:(NSDictionary *)plan {
    NSMutableArray *parts = [NSMutableArray array];
    for (NSDictionary *item in plan[@"items"]) {
        NSString *kind = item[@"kind"];
        if ([kind isEqual:@"document"]) [parts addObject:[@"d:" stringByAppendingString:[item[@"path"] isKindOfClass:NSString.class] ? item[@"path"] : [@"?" stringByAppendingString:item[@"sourcePath"] ?: @""]]];
        else if ([kind isEqual:@"header"]) [parts addObject:[@"h:" stringByAppendingString:item[@"name"] ?: @""]];
        else [parts addObject:[@"x:" stringByAppendingString:item[@"name"] ?: @""]];
    }
    return [parts componentsJoinedByString:@"\n"];
}
- (NSString *)localFingerprint:(NSDictionary *)node sourceRoot:(NSString *)sourceRoot {
    if (!node) return @"";
    NSMutableArray *parts = [NSMutableArray array];
    for (NSDictionary *cue in node[@"items"]) {
        NSString *tag = cue[@"tag"]; NSDictionary *attrs = cue[@"attrs"];
        if ([tag isEqual:@"RVDocumentCue"]) {
            // 서버가 아는 폴더 표기(~/…)와 이 Mac의 절대경로 둘 다 같은 문서로 본다.
            NSString *reference = YBPlaylistReference(attrs[@"filePath"], sourceRoot) ?: YBPlaylistReference(attrs[@"filePath"], self.root);
            [parts addObject:[@"d:" stringByAppendingString:reference ?: [@"?" stringByAppendingString:attrs[@"filePath"] ?: @""]]];
        } else if ([tag isEqual:@"RVHeaderCue"]) [parts addObject:[@"h:" stringByAppendingString:[attrs[@"displayName"] length] ? attrs[@"displayName"] : @"구분"]];
        else [parts addObject:[@"x:" stringByAppendingString:[attrs[@"displayName"] length] ? attrs[@"displayName"] : @"이름 없음"]];
    }
    return [parts componentsJoinedByString:@"\n"];
}

#pragma mark - 서버

- (NSDictionary *)findLibrary {
    NSString *name = self.playlistURL.lastPathComponent.precomposedStringWithCanonicalMapping;
    NSString *after = @"";
    for (int page = 0; page < 50; page++) {
        NSDictionary *result = [self.server request:[@"/api/playlists?after=" stringByAppendingString:Query(after)] method:@"GET" body:nil headers:Headers()];
        YBRequire([result[@"libraries"] isKindOfClass:NSArray.class], @"재생목록 목록을 받지 못했습니다.");
        for (NSDictionary *library in result[@"libraries"]) if ([library[@"path"] isEqual:name]) return library;
        id next = result[@"next"];
        if (![next isKindOfClass:NSString.class]) break;
        after = next;
    }
    YBRequire(NO, [NSString stringWithFormat:@"서버에 ‘%@’이(가) 등록되어 있지 않습니다.", name]);
    return nil;
}
- (NSDictionary *)plan:(NSString *)nodeID {
    NSString *route = [NSString stringWithFormat:@"/api/playlists/%@/plan?node=%@", Query(self.library[@"id"]), Query(nodeID)];
    NSDictionary *plan = [self.server request:route method:@"GET" body:nil headers:Headers()];
    YBRequire([plan[@"items"] isKindOfClass:NSArray.class] && [plan[@"documents"] isKindOfClass:NSArray.class] && [plan[@"playlist"] isKindOfClass:NSDictionary.class], @"예배 순서 정보가 올바르지 않습니다.");
    for (NSDictionary *doc in plan[@"documents"]) YBValidateMetadata(doc);
    return plan;
}

#pragma mark - 비교

- (NSArray *)compare {
    [self report:@"서버 재생목록 확인 중"];
    self.library = [self findLibrary];
    NSString *sourceRoot = [self.library[@"sourceRoot"] isKindOfClass:NSString.class] ? self.library[@"sourceRoot"] : @"~/Documents/ProPresenter6";
    NSData *local = YBReadPlaylist(self.playlistURL);
    self.comparedPlaylistHash = YBHash(local);
    NSMutableDictionary *localNodes = [NSMutableDictionary dictionary];
    for (NSDictionary *node in YBPlaylistNodes(local)) localNodes[node[@"id"]] = node;

    [self.receipt setValue:self.library[@"id"] forKey:@"libraryID"];
    NSMutableSet *documentIDs = [NSMutableSet set];
    NSMutableArray *rows = [NSMutableArray array];
    NSArray *serverNodes = [self.library[@"playlists"] isKindOfClass:NSArray.class] ? self.library[@"playlists"] : @[];
    NSUInteger index = 0;
    for (NSDictionary *summary in serverNodes) {
        index++;
        NSString *nodeID = summary[@"id"], *name = summary[@"name"] ?: nodeID;
        NSString *key = [NSString stringWithFormat:@"%@/%@", self.library[@"id"], nodeID];
        [self report:[NSString stringWithFormat:@"예배 비교 %lu/%lu · %@", (unsigned long)index, (unsigned long)serverNodes.count, name]];
        NSMutableDictionary *row = [@{@"key": key, @"nodeID": nodeID, @"name": name} mutableCopy];
        @try {
            NSDictionary *plan = [self plan:nodeID];
            row[@"plan"] = plan;
            row[@"updatedBy"] = plan[@"playlist"][@"updatedBy"] ?: @"";
            row[@"updatedAt"] = plan[@"playlist"][@"updatedAt"] ?: @"";
            if (![plan[@"applicable"] boolValue]) {
                row[@"status"] = @"hold";
                row[@"reason"] = @"지원하지 않는 항목이나 문서 폴더 밖 경로가 있어 보류";
                [rows addObject:row]; continue;
            }
            NSDictionary *localNode = localNodes[nodeID];
            NSString *serverFP = [self serverFingerprint:plan], *localFP = [self localFingerprint:localNode sourceRoot:sourceRoot];
            NSDictionary *known = [self.receipt node:key];
            BOOL orderChanged = localNode == nil || ![serverFP isEqual:localFP];
            BOOL macOrderChanged = orderChanged && known != nil && ![known[@"localFingerprint"] isEqual:localFP];
            // PP6가 마지막 적용 때 덮인 옛 순서를 다시 썼다: Mac 수정이 아니다. 올리지 않고 서버 순서를 다시 적용한다.
            BOOL revertedOrder = macOrderChanged && [known[@"replaced"] isEqual:localFP];
            if (revertedOrder) macOrderChanged = NO;
            row[@"localFingerprint"] = localFP; row[@"serverFingerprint"] = serverFP;
            if (localNode[@"raw"]) row[@"localXML"] = localNode[@"raw"];
            if (known[@"serverSha"]) row[@"knownServerSha"] = known[@"serverSha"];

            NSMutableArray *documents = [NSMutableArray array], *macChanged = [NSMutableArray array], *macOnly = [NSMutableArray array], *usageOnly = [NSMutableArray array], *reverted = [NSMutableArray array];
            NSMutableDictionary *reasons = [NSMutableDictionary dictionary];
            for (NSDictionary *doc in plan[@"documents"]) {
                [documentIDs addObject:doc[@"id"]];
                NSString *path = doc[@"path"], *localHash = [self localHash:path];
                NSDictionary *knownDoc = [self.receipt document:path];
                long long size = 0, mtime = 0; [self statPath:path size:&size mtime:&mtime];
                if (localHash && [localHash isEqual:doc[@"sha256"]]) {
                    BOOL unchanged = knownDoc && [knownDoc[@"version"] isEqual:doc[@"version"]] && [knownDoc[@"sha"] isEqual:localHash] && [knownDoc[@"size"] longLongValue] == size && [knownDoc[@"mtime"] longLongValue] == mtime;
                    if (!unchanged) [self.receipt rememberDocument:path version:doc[@"version"] sha:localHash size:size mtime:mtime neutral:NeutralHash(YBReadSafeFile(self.root, path, NULL)) replaced:nil];
                    continue;
                }
                BOOL macEdited = localHash != nil && knownDoc != nil && ![knownDoc[@"sha"] isEqual:localHash];
                BOOL serverSame = knownDoc != nil && [knownDoc[@"version"] isEqual:doc[@"version"]];
                if (localHash && knownDoc && !macEdited && serverSame) {   // 영수증대로다(사용일을 지켜 쓴 바이트 등). 같음
                    if ([knownDoc[@"size"] longLongValue] != size || [knownDoc[@"mtime"] longLongValue] != mtime) [self.receipt rememberDocument:path version:doc[@"version"] sha:localHash size:size mtime:mtime];
                    continue;
                }
                if (macEdited) {
                    NSData *bytes = YBReadSafeFile(self.root, path, NULL);
                    NSString *neutral = NeutralHash(bytes), *base = knownDoc[@"neutral"];
                    // 1차 영수증에는 neutral이 없다. 서버가 그대로면 그 버전 바이트로 한 번 계산한다.
                    if (!base && serverSame) { @try { base = NeutralHash([self.server download:doc]); } @catch (NSException *e) {} }
                    if (neutral && [neutral isEqual:base]) {
                        // 사용 기록만 바뀜: 그대로 취급하고 사용일만 서버에 알린다. 서버가 바뀌었으면 받되 백업·보관본은 만들지 않는다.
                        NSMutableDictionary *entry = [@{@"path": path, @"id": doc[@"id"], @"sha": localHash, @"neutral": neutral, @"size": @(size), @"mtime": @(mtime), @"version": knownDoc[@"version"], @"serverSame": @(serverSame)} mutableCopy];
                        [entry addEntriesFromDictionary:UsageOf(bytes)];
                        [usageOnly addObject:entry];
                        if (!serverSame) [documents addObject:doc];
                        continue;
                    }
                    if (neutral && [knownDoc[@"replaced"] isEqual:neutral]) { [documents addObject:doc]; [reverted addObject:path]; continue; }   // PP6가 옛 내용을 다시 씀
                    if (serverSame) { [macOnly addObject:path]; continue; }   // Mac에서만 고침: 올리기
                }
                [documents addObject:doc];
                // 영수증이 없거나 영수증과 다른 바이트: 서버 것을 적용하되 Mac 것은 서버 보관본(+ Mac 백업)으로 남긴다.
                if (localHash && (!knownDoc || macEdited)) { [macChanged addObject:path]; reasons[path] = macEdited ? @"both-changed" : @"technical"; }
            }
            BOOL macOnlyOrder = NO;
            if (orderChanged && macOrderChanged && [known[@"serverSha"] isEqual:plan[@"playlist"][@"sha256"]]) { orderChanged = NO; macOnlyOrder = YES; }   // 순서를 Mac에서만 바꿈: 올리기
            row[@"orderChanged"] = @(orderChanged); row[@"macOrderChanged"] = @(macOrderChanged); row[@"macOnlyOrder"] = @(macOnlyOrder); row[@"macOnlyDocuments"] = macOnly;
            row[@"usageOnly"] = usageOnly; row[@"revertedDocuments"] = reverted; row[@"revertedOrder"] = @(revertedOrder && orderChanged); row[@"macChangedReasons"] = reasons;
            NSMutableArray *missingLocal = [NSMutableArray array]; NSUInteger missingServer = 0;
            for (NSDictionary *item in plan[@"items"]) {
                if (![item[@"issue"] isEqual:@"missing"]) continue;
                missingServer++;
                NSString *path = item[@"path"];
                if ([path isKindOfClass:NSString.class] && ![self statPath:path size:NULL mtime:NULL]) [missingLocal addObject:path];
            }
            row[@"documents"] = documents; row[@"macChangedDocuments"] = macChanged;
            row[@"missingServer"] = @(missingServer); row[@"missingLocal"] = missingLocal;
            if (orderChanged || documents.count) row[@"status"] = @"receive";
            else if (macOnlyOrder || macOnly.count || usageOnly.count) row[@"status"] = @"mac";
            else {
                row[@"status"] = @"same";
                [self.receipt rememberNode:key serverSha:plan[@"playlist"][@"sha256"] fingerprint:localFP name:name];
            }
        } @catch (NSException *e) {
            row[@"status"] = @"hold"; row[@"reason"] = e.reason ?: @"비교 실패";
        }
        [rows addObject:row];
    }
    self.knownDocumentIDs = documentIDs;
    [self report:@"비교 완료"];
    return rows;
}

#pragma mark - 적용

- (NSString *)backupRoot:(NSString *)applyID { return [[self.profile stringByAppendingPathComponent:@"backups"] stringByAppendingPathComponent:applyID]; }
- (NSString *)journalPath { return [self.profile stringByAppendingPathComponent:@"apply-journal.json"]; }
- (void)writeJournal:(NSDictionary *)journal { YBWriteSafeFile(self.profile, @"apply-journal.json", JSONData(journal), 0600, nil); }

- (NSDictionary *)apply:(NSArray *)rows {
    YBRequire(!self.presenterRunning(), @"ProPresenter를 종료한 뒤 적용해 주세요.");
    YBRequire(self.library != nil && self.comparedPlaylistHash != nil, @"먼저 비교해 주세요.");
    if ([NSFileManager.defaultManager fileExistsAtPath:self.journalPath]) [self finishInterruptedApply];   // 지난번에 끝내지 못한 것부터 마무리한다.
    NSData *before = YBReadPlaylist(self.playlistURL);
    YBRequire([YBHash(before) isEqual:self.comparedPlaylistHash], @"비교한 뒤 재생목록 파일이 바뀌었습니다. 다시 비교해 주세요.");

    NSDateFormatter *stamp = [NSDateFormatter new]; stamp.dateFormat = @"yyyyMMdd-HHmmss"; stamp.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
    NSString *applyID = [NSString stringWithFormat:@"%@-%@", [stamp stringFromDate:NSDate.date], [NSUUID.UUID.UUIDString substringToIndex:8]];
    NSString *stageRoot = [self.profile stringByAppendingPathComponent:[@"stage/" stringByAppendingString:applyID]];
    NSString *backupRoot = [self backupRoot:applyID];
    YBRequire([NSFileManager.defaultManager createDirectoryAtPath:stageRoot withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:NULL], @"준비 폴더를 만들지 못했습니다.");

    // 1. 준비: 서버 문서를 받아 임시 폴더에 두고, 새 재생목록 바이트를 만든다. 아직 운영 파일은 건드리지 않는다.
    NSMutableArray *stagedDocs = [NSMutableArray array], *nodeRecords = [NSMutableArray array], *applied = [NSMutableArray array], *revisionFailed = [NSMutableArray array];
    NSMutableDictionary *failed = [NSMutableDictionary dictionary], *seenPaths = [NSMutableDictionary dictionary];
    NSUInteger revisions = 0;
    NSData *after = before;
    for (NSDictionary *row in rows) {
        if (![row[@"status"] isEqual:@"receive"]) continue;
        NSDictionary *plan = row[@"plan"]; NSString *name = row[@"name"];
        // 예배 하나의 준비가 중간에 실패하면 그 예배의 것은 하나도 journal에 넣지 않는다.
        NSMutableArray *rowDocs = [NSMutableArray array]; NSMutableDictionary *rowSeen = [NSMutableDictionary dictionary]; NSData *rowAfter = after;
        @try {
            // 0. 덮일 Mac 수정본을 먼저 서버 보관본으로 올린다(재설계안 5.1). 실패해도 Mac 백업 폴더에는 남으므로 적용은 계속한다.
            for (NSString *path in row[@"macChangedDocuments"]) {
                NSDictionary *doc = DocumentForPath(plan, path), *knownDoc = [self.receipt document:path];
                @try {
                    NSData *bytes = YBReadSafeFile(self.root, path, NULL);
                    if (!bytes || !doc) continue;
                    [self report:[NSString stringWithFormat:@"%@ · Mac 수정본 보관 · %@", name, path]];
                    NSString *route = [NSString stringWithFormat:@"/api/sync/revisions?kind=doc&id=%@&baseVersion=%@&reason=%@", Query(doc[@"id"]), knownDoc[@"version"] ?: @0, row[@"macChangedReasons"][path] ?: @"both-changed"];
                    [self.server request:route method:@"POST" body:bytes headers:@{@"X-YebaeOn-Sync": @"2", @"Content-Type": @"application/xml; charset=utf-8"}];
                    revisions++;
                } @catch (NSException *e) { [revisionFailed addObject:[NSString stringWithFormat:@"%@: %@", path, e.reason]]; }
            }
            if ([row[@"orderChanged"] boolValue] && [row[@"macOrderChanged"] boolValue] && [row[@"localXML"] length]) {
                @try {
                    NSString *route = [NSString stringWithFormat:@"/api/sync/revisions?kind=node&library=%@&node=%@&reason=both-changed%@", Query(self.library[@"id"]), Query(row[@"nodeID"]), row[@"knownServerSha"] ? [@"&baseSha=" stringByAppendingString:row[@"knownServerSha"]] : @""];
                    [self.server request:route method:@"POST" body:[row[@"localXML"] dataUsingEncoding:NSUTF8StringEncoding] headers:@{@"X-YebaeOn-Sync": @"2", @"Content-Type": @"application/xml; charset=utf-8"}];
                    revisions++;
                } @catch (NSException *e) { [revisionFailed addObject:[NSString stringWithFormat:@"%@ 순서: %@", name, e.reason]]; }
            }
            for (NSDictionary *doc in row[@"documents"]) {
                NSString *path = doc[@"path"];
                if (seenPaths[path] || rowSeen[path]) continue;   // 여러 예배가 같은 문서를 쓰면 한 번만 받는다.
                [self report:[NSString stringWithFormat:@"%@ · 문서 받는 중 · %@", name, path]];
                NSData *data = [self.server download:doc];
                NSString *staged = [NSString stringWithFormat:@"%lu.pro6", (unsigned long)(stagedDocs.count + rowDocs.count)];
                YBWriteSafeFile(stageRoot, staged, data, 0600, nil);
                NSDictionary *record = @{@"path": path, @"staged": staged, @"sha": doc[@"sha256"], @"version": doc[@"version"]};
                [rowDocs addObject:record]; rowSeen[path] = record;
            }
            if ([row[@"orderChanged"] boolValue]) rowAfter = YBPlaylistReplacing(rowAfter, row[@"nodeID"], YBPlaylistLocalXML(plan, self.root));
            [stagedDocs addObjectsFromArray:rowDocs]; [seenPaths addEntriesFromDictionary:rowSeen]; after = rowAfter;
            NSMutableDictionary *nodeRecord = [@{@"key": row[@"key"], @"name": name, @"serverSha": plan[@"playlist"][@"sha256"], @"fingerprint": row[@"serverFingerprint"]} mutableCopy];
            // 덮이는 Mac 순서를 기억한다. PP6가 나중에 이 순서를 다시 쓰면 Mac 수정이 아니라 되돌림으로 본다.
            if ([row[@"orderChanged"] boolValue] && row[@"localXML"] && ![row[@"revertedOrder"] boolValue]) nodeRecord[@"replaced"] = row[@"localFingerprint"];
            [nodeRecords addObject:nodeRecord];
            [applied addObject:name];
        } @catch (NSException *e) {
            failed[name] = e.reason ?: @"준비 실패";
        }
    }
    if (!stagedDocs.count && [after isEqual:before] && !nodeRecords.count) { [NSFileManager.defaultManager removeItemAtPath:stageRoot error:NULL]; return @{@"applied": @[], @"failed": failed, @"backup": @"", @"revisions": @(revisions), @"revisionFailed": revisionFailed}; }

    NSString *afterStaged = nil;
    if (![after isEqual:before]) { afterStaged = @"after.pro6pl"; YBWriteSafeFile(stageRoot, afterStaged, after, 0600, nil); }
    NSDictionary *journal = @{@"id": applyID, @"status": @"prepared", @"root": self.root, @"playlist": self.playlistURL.path,
                              @"beforeSha": YBHash(before), @"afterSha": YBHash(after), @"afterStaged": afterStaged ?: @"",
                              @"documents": stagedDocs, @"nodes": nodeRecords, @"applied": applied};
    [self writeJournal:journal];
    // 이 시점부터는 중단되어도 다음 실행이 같은 내용으로 끝까지 마무리한다.
    [self performJournal:journal stageRoot:stageRoot backupRoot:backupRoot];
    [self pruneBackupsKeeping:10];
    return @{@"applied": applied, @"failed": failed, @"backup": backupRoot, @"revisions": @(revisions), @"revisionFailed": revisionFailed};
}

// 준비된 내용을 운영 파일에 넣는다. 같은 내용으로 몇 번을 실행해도 결과가 같다.
- (void)performJournal:(NSDictionary *)journal stageRoot:(NSString *)stageRoot backupRoot:(NSString *)backupRoot {
    YBRequire(!self.presenterRunning(), @"ProPresenter를 종료한 뒤 적용해 주세요.");
    NSString *docsBackup = [backupRoot stringByAppendingPathComponent:@"documents"];
    YBRequire([NSFileManager.defaultManager createDirectoryAtPath:docsBackup withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:NULL], @"백업 폴더를 만들지 못했습니다.");
    NSMutableDictionary *written = [NSMutableDictionary dictionary];   // 경로 → {sha, neutral, replaced?}: 실제로 디스크에 둔 바이트 기준
    for (NSDictionary *record in journal[@"documents"]) {
        NSString *path = record[@"path"];
        [self report:[NSString stringWithFormat:@"문서 적용 · %@", path]];
        NSData *data = YBReadSafeFile(stageRoot, record[@"staged"], NULL);
        YBRequire(data && [YBHash(data) isEqual:record[@"sha"]], @"준비한 문서가 손상됐습니다. 다시 비교해 주세요.");
        mode_t mode = 0644;
        NSData *current = YBReadSafeFile(self.root, path, &mode);
        // Mac 파일의 사용일·사용 횟수는 유지한다. 중단 뒤 다시 돌아도 같은 바이트가 나온다.
        NSData *output = current ? WithUsage(data, UsageOf(current)) : data;
        NSMutableDictionary *result = [@{@"sha": YBHash(output), @"neutral": NeutralHash(output)} mutableCopy];
        if (current && ![current isEqual:output]) result[@"replaced"] = NeutralHash(current);
        written[path] = result;
        if ([current isEqual:output]) continue;
        if (current && !YBReadSafeFile(docsBackup, path, NULL)) YBWriteSafeFile(docsBackup, path, current, 0600, nil);
        YBWriteSafeFile(self.root, path, output, current ? mode : 0644, ^{ YBRequire(!self.presenterRunning(), @"ProPresenter가 실행됐습니다. 적용을 중단했습니다."); });
    }
    if ([journal[@"afterStaged"] length]) {
        NSData *after = YBReadSafeFile(stageRoot, journal[@"afterStaged"], NULL);
        YBRequire(after && [YBHash(after) isEqual:journal[@"afterSha"]], @"준비한 재생목록이 손상됐습니다. 다시 비교해 주세요.");
        NSData *current = YBReadPlaylist(self.playlistURL);
        if (![current isEqual:after]) {
            YBRequire([YBHash(current) isEqual:journal[@"beforeSha"]], @"적용 전에 재생목록 파일이 바뀌었습니다. 다시 비교해 주세요.");
            [self report:@"재생목록 적용"];
            YBReplacePlaylist(self.playlistURL, current, after, [backupRoot stringByAppendingPathComponent:@"playlist"], self.presenterRunning);
        }
    }
    // 2. 영수증: 실제로 쓴 것만 기록한다.
    [self.receipt transaction:^{
        for (NSDictionary *record in journal[@"documents"]) {
            long long size = 0, mtime = 0; NSDictionary *result = written[record[@"path"]];
            if ([self statPath:record[@"path"] size:&size mtime:&mtime]) [self.receipt rememberDocument:record[@"path"] version:record[@"version"] sha:result[@"sha"] size:size mtime:mtime neutral:result[@"neutral"] replaced:result[@"replaced"]];
        }
        for (NSDictionary *node in journal[@"nodes"]) [self.receipt rememberNode:node[@"key"] serverSha:node[@"serverSha"] fingerprint:node[@"fingerprint"] name:node[@"name"] replaced:node[@"replaced"]];
        [self.receipt setValue:[[NSISO8601DateFormatter new] stringFromDate:NSDate.date] forKey:@"lastApplied"];
    }];
    [NSFileManager.defaultManager removeItemAtPath:self.journalPath error:NULL];
    [NSFileManager.defaultManager removeItemAtPath:stageRoot error:NULL];
}

- (NSString *)finishInterruptedApply {
    NSDictionary *journal = JSON([NSData dataWithContentsOfFile:self.journalPath]);
    if (![journal isKindOfClass:NSDictionary.class]) return nil;
    YBRequire([journal[@"root"] isEqual:self.root] && [journal[@"playlist"] isEqual:self.playlistURL.path], @"중단된 적용의 폴더가 지금 설정과 다릅니다. 설정을 되돌리거나 apply-journal.json을 확인하세요.");
    NSString *applyID = journal[@"id"];
    NSString *stage = [self.profile stringByAppendingPathComponent:[@"stage/" stringByAppendingString:applyID]];
    if (![NSFileManager.defaultManager fileExistsAtPath:stage]) {   // 준비 파일이 없으면 마무리할 것도 없다. 다음 비교가 다시 받는다.
        [NSFileManager.defaultManager removeItemAtPath:self.journalPath error:NULL]; return nil;
    }
    [self performJournal:journal stageRoot:[self.profile stringByAppendingPathComponent:[@"stage/" stringByAppendingString:applyID]] backupRoot:[self backupRoot:applyID]];
    return [NSString stringWithFormat:@"지난번에 중단된 적용을 마무리했습니다: %@", [journal[@"applied"] componentsJoinedByString:@", "]];
}

#pragma mark - 올리기 (2차)

- (NSDictionary *)upload:(NSArray *)rows {
    YBRequire(self.library != nil, @"먼저 비교해 주세요.");
    NSMutableArray *uploaded = [NSMutableArray array]; NSMutableDictionary *failed = [NSMutableDictionary dictionary];
    NSMutableDictionary *usage = [NSMutableDictionary dictionary];   // 경로 → 항목. 여러 예배가 같은 문서를 써도 한 번만
    NSMutableSet *sent = [NSMutableSet set];
    for (NSDictionary *row in rows) {
        NSString *name = row[@"name"]; NSDictionary *plan = row[@"plan"]; BOOL any = NO;
        for (NSDictionary *entry in row[@"usageOnly"]) usage[entry[@"path"]] = entry;
        @try {
            // Mac에서만 고친 문서: 서버 새 버전으로 저장한다. If-Match는 영수증과 같은 서버 버전이라 그 사이 웹 저장이 있으면 409로 멈춘다.
            for (NSString *path in row[@"macOnlyDocuments"]) {
                if ([sent containsObject:path]) continue;
                NSDictionary *doc = DocumentForPath(plan, path);
                NSData *bytes = YBReadSafeFile(self.root, path, NULL);
                YBRequire(doc && bytes, [NSString stringWithFormat:@"올릴 문서를 읽지 못했습니다: %@", path]);
                [self report:[NSString stringWithFormat:@"%@ · 올리는 중 · %@", name, path]];
                NSDictionary *saved = [self.server upload:bytes path:path previous:doc];
                long long size = 0, mtime = 0; [self statPath:path size:&size mtime:&mtime];
                [self.receipt rememberDocument:path version:saved[@"version"] sha:saved[@"sha256"] size:size mtime:mtime neutral:NeutralHash(bytes) replaced:nil];
                [sent addObject:path]; any = YES;
            }
            // Mac에서만 바꾼 순서: 이 예배 노드 하나만 교체한다. 기준은 영수증의 서버 노드 sha(= 지금 서버 노드 sha)다.
            if ([row[@"macOnlyOrder"] boolValue]) {
                YBRequire([row[@"localXML"] length] > 0, @"Mac 예배 순서를 읽지 못했습니다.");
                [self report:[NSString stringWithFormat:@"%@ · 순서 올리는 중", name]];
                NSData *body = [NSJSONSerialization dataWithJSONObject:@{@"baseNodeHash": plan[@"playlist"][@"sha256"], @"xml": row[@"localXML"]} options:0 error:NULL];
                NSDictionary *result = [self.server request:[NSString stringWithFormat:@"/api/playlists/%@/nodes?node=%@", Query(self.library[@"id"]), Query(row[@"nodeID"])] method:@"PUT" body:body headers:JSONHeaders()];
                YBRequire([result[@"playlist"][@"sha256"] isKindOfClass:NSString.class], @"서버가 예배 순서 저장 결과를 돌려주지 않았습니다.");
                [self.receipt rememberNode:row[@"key"] serverSha:result[@"playlist"][@"sha256"] fingerprint:row[@"localFingerprint"] name:name];
                any = YES;
            }
            if (any) [uploaded addObject:name];
        } @catch (NSException *e) { failed[name] = e.reason ?: @"올리기 실패"; }
    }
    // 사용일: 200개씩 한 번. 성공한 것만 영수증을 지금 파일로 바꾼다. 실패하면 다음 비교에서 다시 보낸다.
    NSArray *entries = usage.allValues; NSUInteger reported = 0;
    NSRegularExpression *date = [NSRegularExpression regularExpressionWithPattern:@"^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$" options:0 error:NULL];
    for (NSUInteger offset = 0; offset < entries.count; offset += 200) {
        NSArray *chunk = [entries subarrayWithRange:NSMakeRange(offset, MIN(200, entries.count - offset))];
        NSMutableArray *items = [NSMutableArray array];
        for (NSDictionary *entry in chunk) {
            NSMutableDictionary *item = [@{@"id": entry[@"id"]} mutableCopy];
            NSString *used = entry[@"lastDateUsed"], *count = entry[@"usedCount"];
            if (used && [date numberOfMatchesInString:used options:0 range:NSMakeRange(0, used.length)]) item[@"lastDateUsed"] = used;
            if (count.length && [count rangeOfString:@"^[0-9]{1,9}$" options:NSRegularExpressionSearch].location != NSNotFound) item[@"usedCount"] = @(count.integerValue);
            if (item.count > 1) [items addObject:item];
        }
        @try {
            if (items.count) { [self report:@"사용일 보고 중"]; [self.server request:@"/api/sync/usage" method:@"POST" body:[NSJSONSerialization dataWithJSONObject:@{@"items": items} options:0 error:NULL] headers:JSONHeaders()]; }
            [self.receipt transaction:^{
                for (NSDictionary *entry in chunk) if ([entry[@"serverSame"] boolValue])
                    [self.receipt rememberDocument:entry[@"path"] version:entry[@"version"] sha:entry[@"sha"] size:[entry[@"size"] longLongValue] mtime:[entry[@"mtime"] longLongValue] neutral:entry[@"neutral"] replaced:nil];
            }];
            reported += chunk.count;
        } @catch (NSException *e) { failed[@"사용일"] = e.reason ?: @"사용일 보고 실패"; }
    }
    return @{@"uploaded": uploaded, @"usage": @(reported), @"failed": failed};
}

#pragma mark - 변경 일지 (상주 확인)

- (NSDictionary *)checkChanges {
    NSString *saved = [self.receipt value:@"logSeq"];
    if (!saved.length) {   // 처음: 지난 일지는 훑지 않고 지금 번호만 받는다. 비교 한 번으로 기준을 잡는다.
        NSDictionary *result = [self.server request:@"/api/sync/changes?since=0&limit=0" method:@"GET" body:nil headers:Headers()];
        YBRequire([result[@"head"] isKindOfClass:NSNumber.class], @"변경 일지를 받지 못했습니다. 서버 업데이트가 필요할 수 있습니다.");
        return @{@"relevant": @YES, @"head": result[@"head"]};
    }
    long long since = saved.longLongValue; BOOL relevant = NO; NSNumber *head = @(since);
    NSString *libraryID = self.library[@"id"] ?: [self.receipt value:@"libraryID"], *prefix = libraryID ? [libraryID stringByAppendingString:@":"] : nil;
    for (int page = 0; page < 20; page++) {
        NSDictionary *result = [self.server request:[NSString stringWithFormat:@"/api/sync/changes?since=%lld&limit=500", since] method:@"GET" body:nil headers:Headers()];
        YBRequire([result[@"changes"] isKindOfClass:NSArray.class] && [result[@"head"] isKindOfClass:NSNumber.class], @"변경 일지가 올바르지 않습니다.");
        head = result[@"head"];
        for (NSDictionary *change in result[@"changes"]) {
            NSString *kind = change[@"kind"], *entity = change[@"entity"];
            if ([kind hasPrefix:@"node"]) { if (!prefix || [entity hasPrefix:prefix]) relevant = YES; }
            else if ([kind isEqual:@"doc"]) { if (!self.knownDocumentIDs || [self.knownDocumentIDs containsObject:entity]) relevant = YES; }
            else relevant = YES;   // 모르는 종류는 비교해서 확인한다
        }
        since = [result[@"next"] longLongValue];
        if (![result[@"more"] boolValue]) break;
        if (page == 19) relevant = YES;
    }
    return @{@"relevant": @(relevant), @"head": head};
}
// 비교·적용이 끝난 뒤 그 전에 받은 head를 기록한다. 그 사이에 생긴 변경은 다음 확인에서 다시 보인다.
- (void)markSeen:(NSNumber *)head { if ([head isKindOfClass:NSNumber.class]) [self.receipt setValue:head.stringValue forKey:@"logSeq"]; }

- (void)reportApplied:(NSNumber *)seq rows:(NSArray *)rows {
    if (![self.server isKindOfClass:YB2Server.class] || !((YB2Server *)self.server).deviceID || ![seq isKindOfClass:NSNumber.class]) return;
    NSMutableArray *pending = [NSMutableArray array];
    for (NSDictionary *row in rows) {
        if ([row[@"status"] isEqual:@"same"] || pending.count >= 200) continue;
        NSMutableDictionary *item = [@{@"kind": @"node", @"entity": [NSString stringWithFormat:@"%@:%@", self.library[@"id"], row[@"nodeID"]]} mutableCopy];
        NSString *reason = [row[@"status"] isEqual:@"hold"] ? row[@"reason"] : [row[@"status"] isEqual:@"mac"] ? @"Mac 수정 올리기 대기" : @"적용 대기";
        if (reason.length) item[@"reason"] = reason.length > 200 ? [reason substringToIndex:200] : reason;
        [pending addObject:item];
    }
    NSData *body = [NSJSONSerialization dataWithJSONObject:@{@"seq": seq, @"pending": pending} options:0 error:NULL];
    [self.server request:[NSString stringWithFormat:@"/api/sync/devices/%@/applied", ((YB2Server *)self.server).deviceID] method:@"POST" body:body headers:JSONHeaders()];
}

- (void)pruneBackupsKeeping:(NSUInteger)limit {
    NSString *root = [self.profile stringByAppendingPathComponent:@"backups"];
    NSArray *names = [[NSFileManager.defaultManager contentsOfDirectoryAtPath:root error:NULL] sortedArrayUsingSelector:@selector(compare:)];
    if (names.count <= limit) return;
    for (NSString *name in [names subarrayWithRange:NSMakeRange(0, names.count - limit)]) [NSFileManager.defaultManager removeItemAtPath:[root stringByAppendingPathComponent:name] error:NULL];
}
@end
