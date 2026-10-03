#import "YB2Engine.h"
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
@end

@implementation YB2Engine

static NSDictionary *Headers(void) { return @{@"X-YebaeOn-Sync": @"2"}; }
static NSString *Query(NSString *value) {
    return [value stringByAddingPercentEncodingWithAllowedCharacters:[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"]];
}
static NSData *JSONData(id value) { return [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingPrettyPrinted error:NULL]; }
static id JSON(NSData *data) { return data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL] : nil; }

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
            row[@"localFingerprint"] = localFP; row[@"serverFingerprint"] = serverFP;
            row[@"orderChanged"] = @(orderChanged); row[@"macOrderChanged"] = @(macOrderChanged);

            NSMutableArray *documents = [NSMutableArray array], *macChanged = [NSMutableArray array], *macOnly = [NSMutableArray array];
            for (NSDictionary *doc in plan[@"documents"]) {
                NSString *path = doc[@"path"], *localHash = [self localHash:path];
                NSDictionary *knownDoc = [self.receipt document:path];
                if (localHash && [localHash isEqual:doc[@"sha256"]]) {
                    long long size = 0, mtime = 0; [self statPath:path size:&size mtime:&mtime];
                    BOOL unchanged = knownDoc && [knownDoc[@"version"] isEqual:doc[@"version"]] && [knownDoc[@"size"] longLongValue] == size && [knownDoc[@"mtime"] longLongValue] == mtime;
                    if (!unchanged) [self.receipt rememberDocument:path version:doc[@"version"] sha:localHash size:size mtime:mtime];
                    continue;
                }
                BOOL macEdited = localHash != nil && knownDoc != nil && ![knownDoc[@"sha"] isEqual:localHash];
                BOOL serverSame = knownDoc != nil && [knownDoc[@"version"] isEqual:doc[@"version"]];
                if (macEdited && serverSame) { [macOnly addObject:path]; continue; }   // Mac에서만 고침: 건드리지 않는다. 올리기는 다음 판.
                [documents addObject:doc];
                // 영수증이 없거나 영수증과 다른 바이트가 있으면 Mac에서 고친 것일 수 있다. 서버 것을 적용하되 백업한다.
                if (localHash && (!knownDoc || macEdited)) [macChanged addObject:path];
            }
            BOOL macOnlyOrder = NO;
            if (orderChanged && macOrderChanged && [known[@"serverSha"] isEqual:plan[@"playlist"][@"sha256"]]) { orderChanged = NO; macOnlyOrder = YES; }   // 순서를 Mac에서만 바꿈
            row[@"orderChanged"] = @(orderChanged); row[@"macOnlyOrder"] = @(macOnlyOrder); row[@"macOnlyDocuments"] = macOnly;
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
            else if (macOnlyOrder || macOnly.count) row[@"status"] = @"mac";
            else {
                row[@"status"] = @"same";
                [self.receipt rememberNode:key serverSha:plan[@"playlist"][@"sha256"] fingerprint:localFP name:name];
            }
        } @catch (NSException *e) {
            row[@"status"] = @"hold"; row[@"reason"] = e.reason ?: @"비교 실패";
        }
        [rows addObject:row];
    }
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
    NSMutableArray *stagedDocs = [NSMutableArray array], *nodeRecords = [NSMutableArray array], *applied = [NSMutableArray array];
    NSMutableDictionary *failed = [NSMutableDictionary dictionary], *seenPaths = [NSMutableDictionary dictionary];
    NSData *after = before;
    for (NSDictionary *row in rows) {
        if (![row[@"status"] isEqual:@"receive"]) continue;
        NSDictionary *plan = row[@"plan"]; NSString *name = row[@"name"];
        // 예배 하나의 준비가 중간에 실패하면 그 예배의 것은 하나도 journal에 넣지 않는다.
        NSMutableArray *rowDocs = [NSMutableArray array]; NSMutableDictionary *rowSeen = [NSMutableDictionary dictionary]; NSData *rowAfter = after;
        @try {
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
            [nodeRecords addObject:@{@"key": row[@"key"], @"name": name, @"serverSha": plan[@"playlist"][@"sha256"], @"fingerprint": row[@"serverFingerprint"]}];
            [applied addObject:name];
        } @catch (NSException *e) {
            failed[name] = e.reason ?: @"준비 실패";
        }
    }
    if (!stagedDocs.count && [after isEqual:before] && !nodeRecords.count) { [NSFileManager.defaultManager removeItemAtPath:stageRoot error:NULL]; return @{@"applied": @[], @"failed": failed, @"backup": @""}; }

    NSString *afterStaged = nil;
    if (![after isEqual:before]) { afterStaged = @"after.pro6pl"; YBWriteSafeFile(stageRoot, afterStaged, after, 0600, nil); }
    NSDictionary *journal = @{@"id": applyID, @"status": @"prepared", @"root": self.root, @"playlist": self.playlistURL.path,
                              @"beforeSha": YBHash(before), @"afterSha": YBHash(after), @"afterStaged": afterStaged ?: @"",
                              @"documents": stagedDocs, @"nodes": nodeRecords, @"applied": applied};
    [self writeJournal:journal];
    // 이 시점부터는 중단되어도 다음 실행이 같은 내용으로 끝까지 마무리한다.
    [self performJournal:journal stageRoot:stageRoot backupRoot:backupRoot];
    [self pruneBackupsKeeping:10];
    return @{@"applied": applied, @"failed": failed, @"backup": backupRoot};
}

// 준비된 내용을 운영 파일에 넣는다. 같은 내용으로 몇 번을 실행해도 결과가 같다.
- (void)performJournal:(NSDictionary *)journal stageRoot:(NSString *)stageRoot backupRoot:(NSString *)backupRoot {
    YBRequire(!self.presenterRunning(), @"ProPresenter를 종료한 뒤 적용해 주세요.");
    NSString *docsBackup = [backupRoot stringByAppendingPathComponent:@"documents"];
    YBRequire([NSFileManager.defaultManager createDirectoryAtPath:docsBackup withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:NULL], @"백업 폴더를 만들지 못했습니다.");
    for (NSDictionary *record in journal[@"documents"]) {
        NSString *path = record[@"path"];
        [self report:[NSString stringWithFormat:@"문서 적용 · %@", path]];
        NSData *data = YBReadSafeFile(stageRoot, record[@"staged"], NULL);
        YBRequire(data && [YBHash(data) isEqual:record[@"sha"]], @"준비한 문서가 손상됐습니다. 다시 비교해 주세요.");
        mode_t mode = 0644;
        NSData *current = YBReadSafeFile(self.root, path, &mode);
        if ([current isEqual:data]) continue;
        if (current && !YBReadSafeFile(docsBackup, path, NULL)) YBWriteSafeFile(docsBackup, path, current, 0600, nil);
        YBWriteSafeFile(self.root, path, data, current ? mode : 0644, ^{ YBRequire(!self.presenterRunning(), @"ProPresenter가 실행됐습니다. 적용을 중단했습니다."); });
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
            long long size = 0, mtime = 0;
            if ([self statPath:record[@"path"] size:&size mtime:&mtime]) [self.receipt rememberDocument:record[@"path"] version:record[@"version"] sha:record[@"sha"] size:size mtime:mtime];
        }
        for (NSDictionary *node in journal[@"nodes"]) [self.receipt rememberNode:node[@"key"] serverSha:node[@"serverSha"] fingerprint:node[@"fingerprint"] name:node[@"name"]];
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

- (void)pruneBackupsKeeping:(NSUInteger)limit {
    NSString *root = [self.profile stringByAppendingPathComponent:@"backups"];
    NSArray *names = [[NSFileManager.defaultManager contentsOfDirectoryAtPath:root error:NULL] sortedArrayUsingSelector:@selector(compare:)];
    if (names.count <= limit) return;
    for (NSString *name in [names subarrayWithRange:NSMakeRange(0, names.count - limit)]) [NSFileManager.defaultManager removeItemAtPath:[root stringByAppendingPathComponent:name] error:NULL];
}
@end
