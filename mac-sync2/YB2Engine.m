#import "YB2Engine.h"
#import "YB2Server.h"
#import "YBPlaylistFormat.h"
#import "YBPlaylistIO.h"
#import <sys/stat.h>
#import <stdio.h>

@interface YB2Engine ()
@property(nonatomic, readwrite) YBServer *server;
@property(nonatomic, readwrite) NSString *root;
@property(nonatomic, readwrite) NSURL *playlistURL;
@property(nonatomic, readwrite) NSString *profile;
@property(nonatomic, readwrite) YB2Receipt *receipt;
@property(nonatomic, readwrite) NSString *comparedPlaylistHash;
@property(nonatomic) NSDictionary *library;             // 서버 재생목록 파일 메타데이터
@property(nonatomic) NSSet *knownDocumentIDs;           // 마지막 비교의 예배들이 쓰는 서버 문서 id(변경 일지 거르기용)
@property(nonatomic) NSString *sourceRoot;              // 서버 재생목록이 아는 문서 폴더 표기(~/… 또는 /Users/…)
@property(nonatomic) NSMutableDictionary *imageCache;   // 문서 sha → 그 문서가 가리키는 허용 폴더 이미지 경로
@property(nonatomic) NSSet *knownImagePaths;            // 마지막 비교의 예배 문서들이 가리키는 이미지 경로(변경 일지 거르기용)
@end

static NSArray *MediaPaths(NSData *document);
static BOOL AllowedMedia(NSString *path);

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
// 1판(접두사 없음): 사용일·사용 횟수만 뺀 sha. 영수증에 남아 있는 옛 값과 비교할 때만 쓴다.
static NSString *LegacyNeutral(NSData *data) { return data ? YBHash(UsageNeutral(data)) : nil; }
// 파일 참조 표기 맞추기: 같은 파일을 `file:///Users/Shared/Renewed%20Vision%20Media/…`(PP6가 다시 저장한 꼴)와
// `/Users/Shared/Renewed Vision Media/…`(평문 경로)로 적은 두 문서를 같은 글로 만든다.
static NSString *PlainFileReferences(NSString *xml) {
    static NSRegularExpression *pattern; static dispatch_once_t once;
    dispatch_once(&once, ^{ pattern = [NSRegularExpression regularExpressionWithPattern:@"(=\\s*[\"'])file://(?:localhost)?(/[^\"'<>]*)" options:0 error:NULL]; });
    NSMutableString *out = [xml mutableCopy];
    for (NSTextCheckingResult *match in [[pattern matchesInString:xml options:0 range:NSMakeRange(0, xml.length)] reverseObjectEnumerator]) {
        NSString *path = [xml substringWithRange:[match rangeAtIndex:2]];
        NSString *decoded = path.stringByRemovingPercentEncoding ?: path;
        [out replaceCharactersInRange:match.range withString:[[xml substringWithRange:[match rangeAtIndex:1]] stringByAppendingString:decoded.precomposedStringWithCanonicalMapping]];
    }
    return out;
}
// 2판("v2:"): 사용 기록을 빼고 파일 참조 표기를 맞춘 sha. 영수증에 남아 있는 2판 값과 비교할 때만 쓴다.
static NSString *NeutralHashV2(NSData *data) {
    NSData *neutral = UsageNeutral(data); if (!neutral) return nil;
    NSString *xml = Text(neutral);
    if (xml) neutral = [PlainFileReferences(xml) dataUsingEncoding:NSUTF8StringEncoding];
    return [@"v2:" stringByAppendingString:YBHash(neutral)];
}
// 3판("v3:"): 사용 기록을 빼고 파일 참조 표기를 맞춘 뒤 전체를 NFC로 맞춘 sha. 영수증에 남아 있는 3판 값과 비교할 때만 쓴다.
static NSString *NeutralHashV3(NSData *data) {
    NSData *neutral = UsageNeutral(data); if (!neutral) return nil;
    NSString *xml = Text(neutral);
    NSData *comparable = xml ? [PlainFileReferences(xml).precomposedStringWithCanonicalMapping dataUsingEncoding:NSUTF8StringEncoding] : neutral;
    return [@"v3:" stringByAppendingString:YBHash(comparable)];
}
// 비교용 글(4판): 사용 기록을 빼고, 파일 참조 표기를 맞추고, XML을 정규형(C14N: XML 선언 없음·속성 순서·따옴표·빈 요소 표기 통일)으로 쓰고,
// 글상자 RTF는 글자와 서식 목록(YBRTFSignature)으로 바꾸고, 한글 자모 조합을 NFC로 맞춘다.
// PP6가 다시 저장하며 바꾸는 RTF 표기(\uc1 유무, 글자 없는 글상자의 서식)와 macOS 파일 이름의 NFD 경로는 같은 글이 된다.
static NSData *ComparableBytes(NSData *data) {
    NSData *neutral = UsageNeutral(data); if (!neutral) return nil;
    NSString *xml = Text(neutral); if (!xml) return neutral;
    xml = PlainFileReferences(xml);
    NSXMLDocument *document = [[NSXMLDocument alloc] initWithXMLString:xml options:0 error:NULL];
    if (document.rootElement) {
        for (NSXMLNode *node in [document nodesForXPath:@"//NSString[@rvXMLIvarName='RTFData']" error:NULL])
            node.stringValue = [@"rtf:" stringByAppendingString:YBRTFSignature(node.stringValue)];
        xml = [document.rootElement canonicalXMLStringPreservingComments:NO];
    } else {
        NSRange declaration = [xml rangeOfString:@"^\\s*<\\?xml[^>]*\\?>\\s*" options:NSRegularExpressionSearch];
        if (declaration.location != NSNotFound) xml = [xml substringFromIndex:NSMaxRange(declaration)];
    }
    return [xml.precomposedStringWithCanonicalMapping dataUsingEncoding:NSUTF8StringEncoding];
}
// 4판("v4:"): 비교용 글의 sha. 새로 적는 영수증 값은 이것이다.
static NSString *NeutralHash(NSData *data) {
    NSData *comparable = ComparableBytes(data);
    return comparable ? [@"v4:" stringByAppendingString:YBHash(comparable)] : nil;
}
// 영수증에 적힌 값(1~4판)과 이 바이트가 같은 내용인가
static BOOL SameNeutral(NSData *data, NSString *stored) {
    if (!data || !stored.length) return NO;
    if ([stored hasPrefix:@"v4:"]) return [NeutralHash(data) isEqual:stored];
    if ([stored hasPrefix:@"v3:"]) return [NeutralHashV3(data) isEqual:stored];
    if ([stored hasPrefix:@"v2:"]) return [NeutralHashV2(data) isEqual:stored];
    return [LegacyNeutral(data) isEqual:stored];
}
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

// 4개씩 동시에 돌린다. 각 항목의 예외는 그 항목의 결과(NSException)로 돌려준다. 영수증 쓰기는 부르는 쪽에서 모아서 한다.
static NSArray *Parallel(NSArray *items, id (^work)(id item)) {
    NSMutableArray *results = [NSMutableArray arrayWithCapacity:items.count];
    for (NSUInteger i = 0; i < items.count; i++) [results addObject:NSNull.null];
    dispatch_semaphore_t slots = dispatch_semaphore_create(4); dispatch_group_t group = dispatch_group_create();
    dispatch_queue_t queue = dispatch_get_global_queue(QOS_CLASS_UTILITY, 0);
    [items enumerateObjectsUsingBlock:^(id item, NSUInteger index, BOOL *stop) {
        dispatch_semaphore_wait(slots, DISPATCH_TIME_FOREVER);
        dispatch_group_async(group, queue, ^{
            id result = nil;
            @try { result = work(item); } @catch (NSException *e) { result = e; }
            @synchronized(results) { results[index] = result ?: NSNull.null; }
            dispatch_semaphore_signal(slots);
        });
    }];
    dispatch_group_wait(group, DISPATCH_TIME_FOREVER);
    return results;
}
- (instancetype)initWithServer:(YBServer *)server root:(NSString *)root playlist:(NSURL *)playlist profile:(NSString *)profile {
    if (!(self = [super init])) return nil;
    _server = server; _root = root.stringByStandardizingPath.stringByResolvingSymlinksInPath; _playlistURL = playlist; _profile = profile.stringByStandardizingPath.stringByResolvingSymlinksInPath;
    [NSFileManager.defaultManager createDirectoryAtPath:_profile withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:NULL];
    _receipt = [[YB2Receipt alloc] initWithPath:[profile stringByAppendingPathComponent:@"receipt.sqlite"]];
    _presenterRunning = ^BOOL { return YBPresenterRunning(); };
    _trashItem = ^NSString *(NSString *absolute) {
        NSURL *result = nil;
        if (![NSFileManager.defaultManager trashItemAtURL:[NSURL fileURLWithPath:absolute] resultingItemURL:&result error:NULL]) return nil;
        return result.path ?: @"";
    };
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
// 디스크의 실제 절대경로(NFC·NFD 중 있는 쪽). 없으면 nil.
- (NSString *)diskPath:(NSString *)path {
    for (NSString *candidate in @[path.precomposedStringWithCanonicalMapping, path.decomposedStringWithCanonicalMapping]) {
        struct stat st; NSString *absolute = [self.root stringByAppendingPathComponent:candidate];
        if (lstat(absolute.fileSystemRepresentation, &st) == 0 && S_ISREG(st.st_mode)) return absolute;
    }
    return nil;
}
// 이미지가 Mac에 있는가(NFC·NFD 두 이름).
static BOOL ImageExists(NSString *path) {
    return [NSFileManager.defaultManager fileExistsAtPath:path] || [NSFileManager.defaultManager fileExistsAtPath:path.decomposedStringWithCanonicalMapping];
}
// 문서가 가리키는 이미지 경로. 같은 바이트는 다시 훑지 않는다.
- (NSArray *)imagePathsIn:(NSData *)document hash:(NSString *)hash {
    if (!self.imageCache) self.imageCache = [NSMutableDictionary dictionary];
    NSArray *paths = hash ? self.imageCache[hash] : nil;
    if (!paths) { paths = MediaPaths(document); if (hash) self.imageCache[hash] = paths; }
    return paths;
}

// 서버가 알던 내용 그대로인가: 서버 sha와 같거나, 영수증대로(받은 뒤 Mac에서 고치지 않음)다.
- (BOOL)unchangedSinceServer:(NSString *)path sha:(NSString *)sha {
    NSString *hash = [self localHash:path];
    if (!hash) return NO;
    if ([hash isEqual:sha]) return YES;
    NSDictionary *known = [self.receipt document:path];
    return known && [known[@"sha"] isEqual:hash];
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

// 번호 붙임을 되돌린 뒤 원래 이름에 `이름 2`의 영수증이 남은 경우를 고친다(10-04 실기). 한 번만 돈다.
- (void)repairUndoneNumbering {
    if ([self.receipt value:@"repairNumbered1"].length) return;
    [self.receipt transaction:^{
        for (NSDictionary *item in [self numberedLog]) {
            NSDictionary *known = [self.receipt document:item[@"path"]], *copy = [self.receipt ledger:item[@"target"]];
            if (known && copy && [known[@"sha"] isEqual:copy[@"sha"]] && ![self diskPath:item[@"target"]]) [self.receipt forgetDocument:item[@"path"]];
        }
        [self.receipt setValue:@"1" forKey:@"repairNumbered1"];
    }];
}
- (NSArray *)compare {
    [self repairUndoneNumbering];
    [self report:@"서버 재생목록 확인 중"];
    self.library = [self findLibrary];
    NSString *sourceRoot = [self.library[@"sourceRoot"] isKindOfClass:NSString.class] ? self.library[@"sourceRoot"] : @"~/Documents/ProPresenter6";
    self.sourceRoot = sourceRoot;
    NSData *local = YBReadPlaylist(self.playlistURL);
    self.comparedPlaylistHash = YBHash(local);
    NSMutableDictionary *localNodes = [NSMutableDictionary dictionary];
    for (NSDictionary *node in YBPlaylistNodes(local)) localNodes[node[@"id"]] = node;

    [self.receipt setValue:self.library[@"id"] forKey:@"libraryID"];
    NSMutableSet *documentIDs = [NSMutableSet set], *imagePaths = [NSMutableSet set];
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
            // Mac에서 노드를 지운 것은 순서 수정이 아니다(빈 순서를 올리지 않는다).
            BOOL macOrderChanged = orderChanged && localNode != nil && known != nil && ![known[@"localFingerprint"] isEqual:localFP];
            // PP6가 마지막 적용 때 덮인 옛 순서를 다시 썼다: Mac 수정이 아니다. 올리지 않고 서버 순서를 다시 적용한다.
            BOOL revertedOrder = macOrderChanged && [known[@"replaced"] isEqual:localFP];
            if (revertedOrder) macOrderChanged = NO;
            // Mac에 없는 서버 예배: 영수증이 본 적 있으면 Mac에서 지운 것(되살리지 않음 · 기본 체크 꺼짐), 아니면 서버에 새로 생긴 것.
            if (!localNode) { row[@"serverNew"] = @(known == nil); row[@"macDeleted"] = @(known != nil); }
            // 예배 이름. 순서 지문에는 이름이 없으므로 따로 본다. 서버가 바뀌었으면 서버 이름을 받고, Mac에서만 바꿨으면 올린다.
            BOOL macRenamed = NO;
            if (localNode && ![localNode[@"name"] isEqual:name]) {
                BOOL serverMoved = !known || ![known[@"serverSha"] isEqual:plan[@"playlist"][@"sha256"]];
                if (!serverMoved && ![known[@"name"] isEqual:localNode[@"name"]]) { macRenamed = YES; row[@"localName"] = localNode[@"name"]; }
                else { orderChanged = YES; row[@"renamedFrom"] = localNode[@"name"]; }
            }
            row[@"localFingerprint"] = localFP; row[@"serverFingerprint"] = serverFP;
            if (localNode[@"raw"]) row[@"localXML"] = localNode[@"raw"];
            if (known[@"serverSha"]) row[@"knownServerSha"] = known[@"serverSha"];

            NSMutableArray *documents = [NSMutableArray array], *macChanged = [NSMutableArray array], *macOnly = [NSMutableArray array], *usageOnly = [NSMutableArray array], *reverted = [NSMutableArray array];
            NSMutableDictionary *reasons = [NSMutableDictionary dictionary];
            NSMutableArray *macDeletedDocs = [NSMutableArray array], *keptDocs = [NSMutableArray array];
            for (NSDictionary *doc in plan[@"documents"]) {
                [documentIDs addObject:doc[@"id"]];
                NSString *path = doc[@"path"], *localHash = [self localHash:path];
                NSDictionary *knownDoc = [self.receipt document:path];
                if (!localHash && knownDoc) [macDeletedDocs addObject:path];   // 받은 적 있는데 지금 없음: Mac에서 지움. 적용하면 다시 받는다
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
                    NSString *neutral = NeutralHash(bytes), *base = knownDoc[@"neutral"];   // base는 1~4판 중 하나
                    // 1차 영수증에는 neutral이 없다. 서버가 그대로면 그 버전 바이트로 한 번 계산한다.
                    if (!base && serverSame) { @try { base = NeutralHash([self.server download:doc]); } @catch (NSException *e) {} }
                    if (neutral && SameNeutral(bytes, base)) {
                        // 사용 기록만 바뀜: 그대로 취급하고 사용일만 서버에 알린다. 서버가 바뀌었으면 받되 백업·보관본은 만들지 않는다.
                        NSMutableDictionary *entry = [@{@"path": path, @"id": doc[@"id"], @"sha": localHash, @"neutral": neutral, @"size": @(size), @"mtime": @(mtime), @"version": knownDoc[@"version"], @"serverSame": @(serverSame)} mutableCopy];
                        [entry addEntriesFromDictionary:UsageOf(bytes)];
                        [usageOnly addObject:entry];
                        if (!serverSame) [documents addObject:doc];
                        continue;
                    }
                    if (neutral && SameNeutral(bytes, knownDoc[@"replaced"])) { [documents addObject:doc]; [reverted addObject:path]; continue; }   // PP6가 옛 내용을 다시 씀
                    if (serverSame) { [macOnly addObject:path]; continue; }   // Mac에서만 고침: 올리기
                }
                [documents addObject:doc];
                // 영수증이 없거나 영수증과 다른 바이트: 서버 것을 적용하되 Mac 것은 서버 보관본(+ Mac 백업)으로 남긴다.
                if (localHash && (!knownDoc || macEdited)) { [macChanged addObject:path]; reasons[path] = macEdited ? @"both-changed" : @"technical"; }
            }
            // 적용 뒤에도 Mac 파일 그대로인 문서가 가리키는 이미지 중, 서버 경로표에 있는데 Mac에 없는 것. 받을 문서의 이미지는 [적용] 때 받은 바이트로 본다.
            NSMutableArray *images = [NSMutableArray array]; NSMutableSet *rowImages = [NSMutableSet set];
            NSSet *receiving = [NSSet setWithArray:[documents valueForKey:@"path"]];
            for (NSDictionary *doc in plan[@"documents"]) if (![receiving containsObject:doc[@"path"]]) [keptDocs addObject:doc[@"path"]];
            for (NSString *path in keptDocs) {
                NSString *hash = [self localHash:path]; if (!hash) continue;
                NSArray *paths = self.imageCache[hash] ?: [self imagePathsIn:YBReadSafeFile(self.root, path, NULL) hash:hash];
                [imagePaths addObjectsFromArray:paths];
                for (NSString *image in paths) {
                    NSString *sha = [self.receipt mediaSha:image];
                    if (!sha || [rowImages containsObject:image] || ImageExists(image)) continue;
                    [rowImages addObject:image]; [images addObject:@{@"path": image, @"sha": sha}];
                }
            }
            row[@"images"] = images;
            BOOL macOnlyOrder = NO;
            if (orderChanged && macOrderChanged && [known[@"serverSha"] isEqual:plan[@"playlist"][@"sha256"]]) { orderChanged = NO; macOnlyOrder = YES; }   // 순서를 Mac에서만 바꿈: 올리기
            if (macRenamed && !orderChanged) macOnlyOrder = YES;   // 이름만 Mac에서 바꿈: 노드 교체로 올린다
            row[@"macRenamed"] = @(macRenamed); row[@"macDeletedDocuments"] = macDeletedDocs;
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
            else if (images.count) { row[@"status"] = @"receive"; row[@"imagesOnly"] = @YES; }
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
    // Mac에만 있는 예배: 서버 휴지통(→ 적용 때 뺌) · 보관(표시만) · 비움(표시만) · 새로 만듦(→ 서버에 없을 때만 추가).
    NSSet *serverIDs = [NSSet setWithArray:[serverNodes valueForKey:@"id"]];
    NSMutableArray *extra = [NSMutableArray array];
    for (NSDictionary *node in YBPlaylistNodes(local)) if (![serverIDs containsObject:node[@"id"]]) [extra addObject:node];
    NSMutableDictionary *states = [NSMutableDictionary dictionary];
    if (extra.count) {
        @try {
            NSDictionary *structure = [self.server request:[NSString stringWithFormat:@"/api/playlists/%@/structure", Query(self.library[@"id"])] method:@"GET" body:nil headers:Headers()];
            for (NSDictionary *item in structure[@"removals"]) if ([item[@"id"] isKindOfClass:NSString.class]) states[item[@"id"]] = item[@"state"] ?: @"";
        } @catch (NSException *e) { states = nil; }
    }
    NSMutableSet *activeReferences = [NSMutableSet set];   // 이 적용 뒤에도 Mac에 남는 예배가 가리키는 문서
    for (NSDictionary *node in YBPlaylistNodes(local)) {
        if (![serverIDs containsObject:node[@"id"]] && [states[node[@"id"]] isEqual:@"trashed"]) continue;
        for (NSDictionary *cue in node[@"items"]) {
            NSString *reference = YBPlaylistReference(cue[@"attrs"][@"filePath"], sourceRoot) ?: YBPlaylistReference(cue[@"attrs"][@"filePath"], self.root);
            if (reference) [activeReferences addObject:reference];
        }
    }
    for (NSDictionary *node in extra) {
        NSString *nodeID = node[@"id"], *key = [NSString stringWithFormat:@"%@/%@", self.library[@"id"], nodeID];
        NSString *localFP = [self localFingerprint:node sourceRoot:sourceRoot];
        NSDictionary *known = [self.receipt node:key];
        NSMutableDictionary *row = [@{@"key": key, @"nodeID": nodeID, @"name": node[@"name"] ?: nodeID, @"localXML": node[@"raw"] ?: @"", @"localFingerprint": localFP} mutableCopy];
        NSString *state = states[nodeID];
        if (!states) { row[@"status"] = @"hold"; row[@"reason"] = @"서버의 예배 상태를 읽지 못함"; }
        else if ([state isEqual:@"trashed"]) {
            // Mac에서 그 뒤 순서를 고쳤으면 빼지 않는다(정리 창에서 고른다).
            if (!known || [known[@"localFingerprint"] isEqual:localFP]) row[@"status"] = @"trash";
            else { row[@"status"] = @"hold"; row[@"reason"] = @"서버 휴지통에 있음 · Mac에서 고침(정리 창)"; }
        }
        else if ([state isEqual:@"archived"]) { row[@"status"] = @"archived"; row[@"reason"] = @"서버에서 보관됨"; }
        else if (state) { row[@"status"] = @"archived"; row[@"reason"] = @"서버 휴지통을 비움 · Mac에만 남음"; }
        else if (known) { row[@"status"] = @"archived"; row[@"reason"] = @"서버에 없음"; }
        else row[@"status"] = @"macNew";
        [rows addObject:row];
    }
    // 서버 일지의 문서 이름 바꾸기·휴지통. 서버가 알던 내용 그대로인 파일만 대상이다. 다르면 두고 정리 창으로.
    NSMutableArray *renames = [NSMutableArray array], *trashes = [NSMutableArray array], *holds = [NSMutableArray array];
    for (NSDictionary *item in [self.receipt pending]) {
        if (![item[@"kind"] isEqual:@"doc"]) continue;
        NSString *action = item[@"action"], *path = item[@"path"];
        if ([action isEqual:@"renamed"]) {
            NSString *from = item[@"previous"]; BOOL old = [self diskPath:from] != nil, now = [self diskPath:path] != nil;
            if (!old) { [self.receipt removePending:@"doc" entity:item[@"entity"] action:action]; continue; }   // 이미 바뀜 또는 Mac에 없음
            if (now) [holds addObject:@{@"path": from, @"reason": [NSString stringWithFormat:@"새 이름 ‘%@’의 파일이 이미 있음", path]}];
            else if (![self unchangedSinceServer:from sha:item[@"sha"]]) [holds addObject:@{@"path": from, @"reason": @"이름이 바뀐 문서 · Mac에서 고침"}];
            else [renames addObject:@{@"id": item[@"entity"], @"from": from, @"to": path, @"sha": item[@"sha"] ?: @""}];
        } else if ([action isEqual:@"trashed"]) {
            if (![self diskPath:path]) { [self.receipt removePending:@"doc" entity:item[@"entity"] action:action]; continue; }
            if ([activeReferences containsObject:path]) [holds addObject:@{@"path": path, @"reason": @"서버 휴지통에 있음 · Mac 예배가 아직 씀"}];
            else if (![self unchangedSinceServer:path sha:item[@"sha"]]) [holds addObject:@{@"path": path, @"reason": @"서버 휴지통에 있음 · Mac에서 고침"}];
            else [trashes addObject:@{@"id": item[@"entity"], @"path": path, @"sha": item[@"sha"] ?: @""}];
        }
    }
    if (renames.count || trashes.count || holds.count)
        [rows addObject:@{@"key": @"doc-actions", @"nodeID": @"", @"name": @"문서 정리(서버)", @"status": renames.count || trashes.count ? @"actions" : @"hold",
                          @"reason": holds.count ? [NSString stringWithFormat:@"확인 필요 %lu", (unsigned long)holds.count] : @"", @"renames": renames, @"trashes": trashes, @"actionHolds": holds}];
    self.knownDocumentIDs = documentIDs; self.knownImagePaths = imagePaths;
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
    NSMutableArray *moves = [NSMutableArray array], *trashFiles = [NSMutableArray array], *pendingDone = [NSMutableArray array];
    NSMutableSet *heldPaths = [NSMutableSet set]; NSMutableArray *held = [NSMutableArray array]; NSMutableDictionary *prefetched = [NSMutableDictionary dictionary];
    NSMutableDictionary *wantedImages = [NSMutableDictionary dictionary];   // 경로 → 서버 경로표 sha(모르면 NSNull)
    for (NSDictionary *row in rows) {
        for (NSDictionary *image in [row[@"images"] isKindOfClass:NSArray.class] ? row[@"images"] : @[]) if (image[@"path"]) wantedImages[image[@"path"]] = image[@"sha"] ?: NSNull.null;
        // 서버 휴지통에 넣은 예배: 이 노드만 뺀다. 다른 노드 바이트는 그대로다.
        if ([row[@"status"] isEqual:@"trash"]) {
            @try {
                after = YBPlaylistRemoving(after, row[@"nodeID"]);
                [nodeRecords addObject:@{@"key": row[@"key"], @"name": row[@"name"], @"forget": @(YES)}];
                [applied addObject:row[@"name"]];
            } @catch (NSException *e) { failed[row[@"name"]] = e.reason ?: @"예배 빼기 실패"; }
            continue;
        }
        if ([row[@"status"] isEqual:@"actions"]) {
            for (NSDictionary *rename in row[@"renames"]) {
                @try {
                    after = [self rewriteReferences:after from:rename[@"from"] to:rename[@"to"]];
                    [moves addObject:@{@"from": rename[@"from"], @"to": rename[@"to"]}];
                    [pendingDone addObject:@{@"entity": rename[@"id"], @"action": @"renamed", @"path": rename[@"to"], @"previous": rename[@"from"], @"sha": rename[@"sha"] ?: @""}];
                    [applied addObject:[NSString stringWithFormat:@"이름 바꾸기 %@ → %@", rename[@"from"], rename[@"to"]]];
                } @catch (NSException *e) { failed[rename[@"from"]] = e.reason ?: @"이름 바꾸기 실패"; }
            }
            for (NSDictionary *trash in row[@"trashes"]) {
                [trashFiles addObject:trash[@"path"]];
                [pendingDone addObject:@{@"entity": trash[@"id"], @"action": @"trashed", @"path": trash[@"path"], @"sha": trash[@"sha"] ?: @""}];
                [applied addObject:[@"휴지통으로 " stringByAppendingString:trash[@"path"]]];
            }
            continue;
        }
        if (![row[@"status"] isEqual:@"receive"]) continue;
        NSDictionary *plan = row[@"plan"]; NSString *name = row[@"name"];
        // 예배 하나의 준비가 중간에 실패하면 그 예배의 것은 하나도 journal에 넣지 않는다.
        NSMutableArray *rowDocs = [NSMutableArray array]; NSMutableDictionary *rowSeen = [NSMutableDictionary dictionary]; NSData *rowAfter = after;
        @try {
            // 0. 덮일 Mac 수정본을 먼저 서버 보관본으로 올린다(재설계안 5.1). 실패해도 Mac 백업 폴더에는 남으므로 적용은 계속한다.
            //    영수증이 본 적 없는 문서(이력 없음)는 Mac과 서버 중 어느 쪽이 나중인지 모른다. 사용일만 다르면 서버 것을 받되(Mac 사용일 유지),
            //    내용이 다르면 받지도 덮지도 않고 Mac 파일을 그대로 둔 채 정리 창 "같은 이름, 다른 내용"으로 보낸다.
            for (NSString *path in row[@"macChangedDocuments"]) {
                NSDictionary *doc = DocumentForPath(plan, path), *knownDoc = [self.receipt document:path];
                if (!knownDoc && doc && [row[@"macChangedReasons"][path] isEqual:@"technical"]) {
                    @try {
                        NSData *bytes = YBReadSafeFile(self.root, path, NULL), *server = [self.server download:doc];
                        prefetched[path] = server;
                        if (bytes && ![NeutralHash(bytes) isEqual:NeutralHash(server)]) { [heldPaths addObject:path]; [held addObject:path]; }
                    } @catch (NSException *e) { [heldPaths addObject:path]; [held addObject:path]; }
                    continue;
                }
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
                if ([heldPaths containsObject:path]) continue;   // 이력 없는 다른 내용: Mac 파일을 그대로 둔다
                [self report:[NSString stringWithFormat:@"%@ · 문서 받는 중 · %@", name, path]];
                NSData *data = prefetched[path] ?: [self.server download:doc];
                NSString *staged = [NSString stringWithFormat:@"%lu.pro6", (unsigned long)(stagedDocs.count + rowDocs.count)];
                YBWriteSafeFile(stageRoot, staged, data, 0600, nil);
                NSDictionary *record = @{@"path": path, @"staged": staged, @"sha": doc[@"sha256"], @"version": doc[@"version"]};
                [rowDocs addObject:record]; rowSeen[path] = record;
                for (NSString *image in [self imagePathsIn:data hash:doc[@"sha256"]]) if (!wantedImages[image] && !ImageExists(image)) wantedImages[image] = [self.receipt mediaSha:image] ?: NSNull.null;
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
    // 이미지: 서버 경로표에 있고 Mac에 없는 것만 받아 둔다. 이미지 때문에 문서·순서 적용을 막지 않는다(sync.md 5.4).
    NSMutableArray *stagedImages = [NSMutableArray array], *imageFailed = [NSMutableArray array];
    [self stageImages:wantedImages into:stageRoot staged:stagedImages failed:imageFailed];
    [self addCollisions:held];
    if (!stagedDocs.count && [after isEqual:before] && !nodeRecords.count && !moves.count && !trashFiles.count && !stagedImages.count) { [NSFileManager.defaultManager removeItemAtPath:stageRoot error:NULL]; return @{@"applied": @[], @"held": held, @"failed": failed, @"backup": @"", @"revisions": @(revisions), @"revisionFailed": revisionFailed, @"images": @0, @"imageFailed": imageFailed}; }

    NSString *afterStaged = nil;
    if (![after isEqual:before]) { afterStaged = @"after.pro6pl"; YBWriteSafeFile(stageRoot, afterStaged, after, 0600, nil); }
    // 되돌리기용: 적용 전 영수증. 되돌리면 이 값으로 돌려 다음 비교가 "받을 것"으로 다시 보이게 한다(Mac 수정으로 올리지 않는다).
    NSMutableDictionary *beforeDocs = [NSMutableDictionary dictionary], *beforeNodes = [NSMutableDictionary dictionary];
    for (NSDictionary *record in stagedDocs) beforeDocs[record[@"path"]] = [self.receipt document:record[@"path"]] ?: NSNull.null;
    for (NSDictionary *record in nodeRecords) beforeNodes[record[@"key"]] = [self.receipt node:record[@"key"]] ?: NSNull.null;
    NSDictionary *journal = @{@"id": applyID, @"status": @"prepared", @"root": self.root, @"playlist": self.playlistURL.path,
                              @"receiptBefore": @{@"documents": beforeDocs, @"nodes": beforeNodes},
                              @"beforeSha": YBHash(before), @"afterSha": YBHash(after), @"afterStaged": afterStaged ?: @"",
                              @"documents": stagedDocs, @"images": stagedImages, @"nodes": nodeRecords, @"applied": applied,
                              @"moves": moves, @"trash": trashFiles, @"pendingDone": pendingDone};
    [self writeJournal:journal];
    // 이 시점부터는 중단되어도 다음 실행이 같은 내용으로 끝까지 마무리한다.
    [self performJournal:journal stageRoot:stageRoot backupRoot:backupRoot];
    [self pruneBackupsKeeping:10];
    return @{@"applied": applied, @"held": held, @"failed": failed, @"backup": backupRoot, @"revisions": @(revisions), @"revisionFailed": revisionFailed, @"images": @(stagedImages.count), @"imageFailed": imageFailed};
}
// 받을 이미지를 준비 폴더에 둔다. 영수증 경로표 사본에 없는 경로는 서버 경로표에 50개씩 묻는다(새로 가져온 이미지).
// 경로표에도 없으면 받지 않는다(Mac에만 있던 이미지이거나 이미 깨진 참조).
- (void)stageImages:(NSDictionary *)wanted into:(NSString *)stageRoot staged:(NSMutableArray *)staged failed:(NSMutableArray *)failed {
    NSMutableDictionary *known = [NSMutableDictionary dictionary]; NSMutableArray *ask = [NSMutableArray array];
    for (NSString *path in wanted) { if (!AllowedMedia(path) || ImageExists(path)) continue; if ([wanted[path] isKindOfClass:NSString.class]) known[path] = wanted[path]; else [ask addObject:path]; }
    [ask sortUsingSelector:@selector(compare:)];
    for (NSUInteger offset = 0; offset < ask.count; offset += 50) {
        NSArray *chunk = [ask subarrayWithRange:NSMakeRange(offset, MIN(50, ask.count - offset))];
        NSMutableArray *query = [NSMutableArray array];
        for (NSString *path in chunk) [query addObject:[@"path=" stringByAppendingString:Query(path)]];
        @try {
            NSDictionary *result = [self.server request:[@"/api/media/paths?" stringByAppendingString:[query componentsJoinedByString:@"&"]] method:@"GET" body:nil headers:Headers()];
            for (NSDictionary *item in [result[@"paths"] isKindOfClass:NSArray.class] ? result[@"paths"] : @[])
                if ([item[@"state"] isEqual:@"active"] && [item[@"path"] isKindOfClass:NSString.class] && [item[@"sha256"] isKindOfClass:NSString.class]) {
                    known[item[@"path"]] = item[@"sha256"];
                    [self.receipt setMedia:item[@"path"] sha:item[@"sha256"]];
                }
        } @catch (NSException *e) { [failed addObject:[NSString stringWithFormat:@"이미지 경로 확인: %@", e.reason]]; }
    }
    for (NSString *path in [known.allKeys sortedArrayUsingSelector:@selector(compare:)]) {
        @try {
            [self report:[@"이미지 받는 중 · " stringByAppendingString:path.lastPathComponent]];
            NSDictionary *asset = [self.server mediaAssets:@[known[path]]].firstObject;
            YBRequire([asset[@"size"] isKindOfClass:NSNumber.class], @"서버에 이미지 원본이 없습니다.");
            NSData *data = [self.server downloadMedia:known[path] size:[asset[@"size"] unsignedLongLongValue]];
            YBRequire([YBHash(data) isEqual:known[path]], @"받은 이미지가 다릅니다.");
            NSString *name = [NSString stringWithFormat:@"image-%lu", (unsigned long)staged.count];
            YBWriteSafeFile(stageRoot, name, data, 0600, nil);
            [staged addObject:@{@"path": path, @"staged": name, @"sha": known[path]}];
        } @catch (NSException *e) { [failed addObject:[NSString stringWithFormat:@"%@: %@", path.lastPathComponent, e.reason]]; }
    }
}
// 준비한 이미지를 제자리에 둔다. 폴더가 없으면 만들고(`YebaeOn/` 포함), 이미 있으면 건드리지 않는다. 임시 이름으로 쓴 뒤 바꾼다.
- (NSUInteger)placeImages:(NSArray *)images stageRoot:(NSString *)stageRoot {
    NSUInteger placed = 0;
    for (NSDictionary *image in images) {
        NSString *path = image[@"path"];
        if (!AllowedMedia(path) || ImageExists(path)) continue;
        NSData *data = YBReadSafeFile(stageRoot, image[@"staged"], NULL);
        if (!data || ![YBHash(data) isEqual:image[@"sha"]]) continue;   // 준비본이 없으면 다음 비교에서 다시 받는다
        [self report:[@"이미지 두는 중 · " stringByAppendingString:path.lastPathComponent]];
        [NSFileManager.defaultManager createDirectoryAtPath:path.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:NULL];
        NSString *temporary = [path.stringByDeletingLastPathComponent stringByAppendingPathComponent:[NSString stringWithFormat:@".yebaeon-%@.tmp", NSUUID.UUID.UUIDString]];
        if (![data writeToFile:temporary options:NSDataWritingWithoutOverwriting error:NULL]) continue;
        chmod(temporary.fileSystemRepresentation, 0644);
        if (renamex_np(temporary.fileSystemRepresentation, path.fileSystemRepresentation, RENAME_EXCL) == 0) placed++;
        else [NSFileManager.defaultManager removeItemAtPath:temporary error:NULL];
    }
    return placed;
}

// 준비된 내용을 운영 파일에 넣는다. 같은 내용으로 몇 번을 실행해도 결과가 같다.
- (void)performJournal:(NSDictionary *)journal stageRoot:(NSString *)stageRoot backupRoot:(NSString *)backupRoot {
    YBRequire(!self.presenterRunning(), @"ProPresenter를 종료한 뒤 적용해 주세요.");
    NSString *docsBackup = [backupRoot stringByAppendingPathComponent:@"documents"];
    YBRequire([NSFileManager.defaultManager createDirectoryAtPath:docsBackup withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:NULL], @"백업 폴더를 만들지 못했습니다.");
    NSMutableDictionary *written = [NSMutableDictionary dictionary];   // 경로 → {sha, neutral, replaced?}: 실제로 디스크에 둔 바이트 기준
    // 이름 바꾸기. 옛 이름만 있으면 옮기고, 새 이름만 있으면 이미 끝난 것이다(중단 뒤 다시 돌아도 같다).
    for (NSDictionary *move in journal[@"moves"]) {
        NSString *from = [self diskPath:move[@"from"]], *to = [self diskPath:move[@"to"]];
        if (!from) continue;
        YBRequire(!to, [NSString stringWithFormat:@"새 이름의 파일이 이미 있습니다: %@", move[@"to"]]);
        YBRequire(!self.presenterRunning(), @"ProPresenter가 실행됐습니다. 적용을 중단했습니다.");
        [self report:[NSString stringWithFormat:@"이름 바꾸기 · %@", move[@"to"]]];
        NSString *target = [self.root stringByAppendingPathComponent:move[@"to"]];
        YBRequire(renamex_np(from.fileSystemRepresentation, target.fileSystemRepresentation, RENAME_EXCL) == 0, [NSString stringWithFormat:@"이름을 바꾸지 못했습니다: %@", move[@"from"]]);
    }
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
    [self placeImages:journal[@"images"] stageRoot:stageRoot];
    NSString *playlistBackup = nil;
    if ([journal[@"afterStaged"] length]) {
        NSData *after = YBReadSafeFile(stageRoot, journal[@"afterStaged"], NULL);
        YBRequire(after && [YBHash(after) isEqual:journal[@"afterSha"]], @"준비한 재생목록이 손상됐습니다. 다시 비교해 주세요.");
        NSData *current = YBReadPlaylist(self.playlistURL);
        if (![current isEqual:after]) {
            YBRequire([YBHash(current) isEqual:journal[@"beforeSha"]], @"적용 전에 재생목록 파일이 바뀌었습니다. 다시 비교해 주세요.");
            [self report:@"재생목록 적용"];
            playlistBackup = YBReplacePlaylist(self.playlistURL, current, after, [backupRoot stringByAppendingPathComponent:@"playlist"], self.presenterRunning).path;
        }
    }
    // 서버 휴지통에 넣은 문서는 macOS 휴지통으로 옮긴다. 이미 없으면 끝난 것이다.
    NSMutableArray *trashed = [NSMutableArray array], *trashLocations = [NSMutableArray array];
    for (NSString *path in journal[@"trash"]) {
        NSString *absolute = [self diskPath:path];
        if (!absolute) { [trashed addObject:path]; continue; }
        YBRequire(!self.presenterRunning(), @"ProPresenter가 실행됐습니다. 적용을 중단했습니다.");
        [self report:[@"휴지통으로 · " stringByAppendingString:path]];
        NSString *location = self.trashItem(absolute);
        YBRequire(location != nil, [NSString stringWithFormat:@"휴지통으로 옮기지 못했습니다: %@", path]);
        [trashed addObject:path]; [trashLocations addObject:@{@"path": path, @"location": location}];
    }
    // 되돌리기 기록: 이번 적용이 쓴 것과 원래 것이 있는 곳. [마지막 적용 되돌리기]가 읽는다.
    NSMutableArray *undoDocuments = [NSMutableArray array];
    for (NSDictionary *record in journal[@"documents"]) {
        NSString *path = record[@"path"];
        [undoDocuments addObject:@{@"path": path, @"sha": written[path][@"sha"] ?: @"", @"backup": @(YBReadSafeFile(docsBackup, path, NULL) != nil)}];
    }
    NSDictionary *undo = @{@"id": journal[@"id"], @"at": [[NSISO8601DateFormatter new] stringFromDate:NSDate.date], @"applied": journal[@"applied"] ?: @[],
                           @"documents": undoDocuments, @"moves": journal[@"moves"] ?: @[], @"trash": trashLocations, @"pendingDone": journal[@"pendingDone"] ?: @[],
                           @"playlistBackup": playlistBackup ?: @"", @"playlistAfterSha": journal[@"afterSha"] ?: @"", @"receiptBefore": journal[@"receiptBefore"] ?: @{}};
    YBWriteSafeFile(backupRoot, @"undo.json", JSONData(undo), 0600, nil);
    // 2. 영수증: 실제로 쓴 것만 기록한다.
    [self.receipt transaction:^{
        for (NSDictionary *move in journal[@"moves"]) {
            if ([move[@"numbered"] boolValue]) {   // 번호 붙인 Mac 파일은 서버에 새 문서로 올라가 있다
                long long size = 0, mtime = 0;
                if ([self statPath:move[@"to"] size:&size mtime:&mtime]) [self.receipt rememberDocument:move[@"to"] version:move[@"version"] sha:move[@"sha"] size:size mtime:mtime];
                [self.receipt setLedger:move[@"to"] id:move[@"id"] version:move[@"version"] sha:move[@"sha"] state:@"active"];
                [self logNumbered:move[@"from"] target:move[@"to"]];
            } else if ([self.receipt document:move[@"from"]]) [self.receipt moveDocument:move[@"from"] to:move[@"to"]];
        }
        for (NSString *path in trashed) [self.receipt forgetDocument:path];
        for (NSDictionary *done in journal[@"pendingDone"]) [self.receipt removePending:@"doc" entity:done[@"entity"] action:done[@"action"]];
        for (NSDictionary *record in journal[@"documents"]) {
            long long size = 0, mtime = 0; NSDictionary *result = written[record[@"path"]];
            if ([self statPath:record[@"path"] size:&size mtime:&mtime]) [self.receipt rememberDocument:record[@"path"] version:record[@"version"] sha:result[@"sha"] size:size mtime:mtime neutral:result[@"neutral"] replaced:result[@"replaced"]];
        }
        for (NSDictionary *node in journal[@"nodes"]) {
            if ([node[@"forget"] boolValue]) [self.receipt forgetNode:node[@"key"]];
            else [self.receipt rememberNode:node[@"key"] serverSha:node[@"serverSha"] fingerprint:node[@"fingerprint"] name:node[@"name"] replaced:node[@"replaced"]];
        }
        [self.receipt setValue:[[NSISO8601DateFormatter new] stringFromDate:NSDate.date] forKey:@"lastApplied"];
        [self.receipt setValue:journal[@"id"] forKey:@"lastApplyID"];
    }];
    [NSFileManager.defaultManager removeItemAtPath:self.journalPath error:NULL];
    [NSFileManager.defaultManager removeItemAtPath:stageRoot error:NULL];
}

#pragma mark - 전체 확인·정리 창 (3차)

// 문서가 가리키는 외부 파일 중 허용 폴더·문서 폴더 밖의 것(외부 참조). 이미지·영상 모두 본다.
static NSArray *ExternalReferences(NSData *document, NSString *root) {
    NSString *xml = Text(document); if (!xml) return @[];
    NSMutableOrderedSet *found = [NSMutableOrderedSet orderedSet];
    NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"(file://(?:localhost)?/[^\"'<>]+|/(?:Users|Volumes|Applications|Library)/[^\"'<>]+\\.[A-Za-z0-9]{2,5})" options:0 error:NULL];
    for (NSTextCheckingResult *match in [pattern matchesInString:xml options:0 range:NSMakeRange(0, xml.length)]) {
        NSString *value = [[xml substringWithRange:match.range] stringByReplacingOccurrencesOfString:@"&amp;" withString:@"&"];
        if ([value hasPrefix:@"file:"]) value = [NSURL URLWithString:value].path ?: [value substringFromIndex:7].stringByRemovingPercentEncoding ?: value;
        value = value.precomposedStringWithCanonicalMapping;
        NSString *extension = value.pathExtension.lowercaseString;
        if (!extension.length || [extension isEqual:@"pro6"]) continue;
        NSString *rest = [value hasPrefix:kMediaRoot] ? [value substringFromIndex:kMediaRoot.length] : nil;
        if (rest && ([rest hasPrefix:@"Images/"] || [rest hasPrefix:@"ImportedImages/"] || [rest hasPrefix:@"YebaeOn/"])) continue;
        if ([value hasPrefix:[root stringByAppendingString:@"/"]]) continue;
        [found addObject:value];
    }
    return found.array;
}
- (NSDictionary *)lastFullCheck {
    NSDictionary *saved = JSON([[self.receipt value:@"fullCheck"] dataUsingEncoding:NSUTF8StringEncoding]);
    return [saved isKindOfClass:NSDictionary.class] ? saved : nil;
}
- (BOOL)fullCheckDue {
    NSString *at = [self.receipt value:@"fullCheckAt"];
    NSDate *date = at.length ? [[NSISO8601DateFormatter new] dateFromString:at] : nil;
    return !date || -date.timeIntervalSinceNow > 7 * 24 * 3600;
}
// Mac 디스크와 장부 사본·영수증을 맞춰 본다. 서버 요청 없음(D1 0). Mac 파일을 바꾸지 않는다.
// 디스크·장부 사본·영수증을 읽기만 한다(영수증에 쓰지 않음). 데일리 창 작업과 함께 돌 수 있다. 저장은 saveFullCheck:로.
- (NSDictionary *)scanFullCheck {
    YBRequire([self.receipt value:@"ledgerSeq"].length > 0, @"서버 장부 사본이 아직 없습니다. 서버 확인 뒤 다시 해 주세요.");
    [self report:@"전체 확인 · Mac 문서 폴더 읽는 중"];
    NSMutableArray *macDeleted = [NSMutableArray array], *collisions = [NSMutableArray array], *external = [NSMutableArray array], *imageFill = [NSMutableArray array], *remember = [NSMutableArray array];
    NSMutableSet *disk = [NSMutableSet set];
    for (NSString *name in [NSFileManager.defaultManager contentsOfDirectoryAtPath:self.root error:NULL])
        if (![name hasPrefix:@"."] && [name.pathExtension.lowercaseString isEqual:@"pro6"]) [disk addObject:name.precomposedStringWithCanonicalMapping];
    NSMutableSet *waitingRename = [NSMutableSet set];
    for (NSDictionary *item in [self.receipt pending]) if (item[@"previous"]) [waitingRename addObject:item[@"previous"]];
    // Mac에서 지움: 영수증이 본 문서가 디스크에 없고 서버에서는 사용 중이다. 추측해서 서버를 지우지 않고 목록만 만든다.
    for (NSString *path in [self.receipt documentPaths]) {
        if ([disk containsObject:path] || [waitingRename containsObject:path]) continue;
        NSDictionary *entry = [self.receipt ledger:path];
        if ([entry[@"state"] isEqual:@"active"]) [macDeleted addObject:@{@"path": path, @"id": entry[@"id"]}];
    }
    // 같은 이름: 장부에 있고 영수증은 본 적 없는 Mac 파일(처음 대조). 바이트가 같으면 영수증에 적고,
    // 다르면 서버 바이트를 받아 사용일을 뺀 내용을 비교한다. 같으면 적고, 다를 때만 목록에 올린다.
    NSArray *unknown = [[disk.allObjects sortedArrayUsingSelector:@selector(compare:)] filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSString *path, NSDictionary *b) {
        return ![self.receipt document:path] && [[self.receipt ledger:path][@"state"] isEqual:@"active"]; }]];
    NSMutableArray *differs = [NSMutableArray array]; NSUInteger index = 0;
    for (NSString *path in unknown) {
        if (++index % 50 == 0) [self report:[NSString stringWithFormat:@"전체 확인 · 처음 대조 %lu/%lu", (unsigned long)index, (unsigned long)unknown.count]];
        NSDictionary *entry = [self.receipt ledger:path]; NSData *bytes = YBReadSafeFile(self.root, path, NULL); if (!bytes) continue;
        long long size = 0, mtime = 0; [self statPath:path size:&size mtime:&mtime];
        NSString *hash = YBHash(bytes);
        NSDictionary *record = @{@"path": path, @"id": entry[@"id"], @"version": entry[@"version"], @"sha": hash, @"size": @(size), @"mtime": @(mtime), @"neutral": NeutralHash(bytes)};
        if ([hash isEqual:entry[@"sha"]]) [remember addObject:record]; else [differs addObject:record];
    }
    __block NSUInteger done = 0;
    NSArray *compared = Parallel(differs, ^id(NSDictionary *record) {
        NSDictionary *doc = [self serverDocument:record[@"id"]];
        NSString *serverNeutral = NeutralHash([self.server download:doc]);
        @synchronized(self) { done++; [self report:[NSString stringWithFormat:@"전체 확인 · 서버와 내용 대조 %lu/%lu", (unsigned long)done, (unsigned long)differs.count]]; }
        return [serverNeutral isEqual:record[@"neutral"]] ? doc : @NO;
    });
    for (NSUInteger i = 0; i < differs.count; i++) {
        id result = compared[i]; NSDictionary *record = differs[i];
        if ([result isKindOfClass:NSDictionary.class]) { NSMutableDictionary *same = [record mutableCopy]; same[@"version"] = result[@"version"]; [remember addObject:same]; }   // 사용일만 다름
        else [collisions addObject:@{@"path": record[@"path"], @"id": record[@"id"]}];
    }
    // 외부 참조: 지난 점검 뒤 수정시각이 바뀐 문서만 읽는다.
    long long since = [self.receipt value:@"externalCheckAt"].longLongValue, newest = since;
    NSMutableDictionary *externalByPath = [NSMutableDictionary dictionary];
    for (NSDictionary *item in [self lastFullCheck][@"external"] ?: @[]) if ([disk containsObject:item[@"path"]]) externalByPath[item[@"path"]] = item;
    index = 0;
    for (NSString *path in disk) {
        if (++index % 100 == 0) [self report:[NSString stringWithFormat:@"전체 확인 · 외부 참조 %lu/%lu", (unsigned long)index, (unsigned long)disk.count]];
        long long mtime = 0; if (![self statPath:path size:NULL mtime:&mtime] || mtime <= since) continue;
        newest = MAX(newest, mtime);
        NSArray *refs = ExternalReferences(YBReadSafeFile(self.root, path, NULL), self.root);
        if (refs.count) externalByPath[path] = @{@"path": path, @"references": refs}; else [externalByPath removeObjectForKey:path];
    }
    for (NSString *path in [externalByPath.allKeys sortedArrayUsingSelector:@selector(compare:)]) [external addObject:externalByPath[path]];
    // 이미지 보충 후보: 서버 경로표에 있는데 Mac에 없는 것(받기는 정리 창 버튼으로).
    [self report:@"전체 확인 · 이미지"];
    for (NSDictionary *item in [self.receipt mediaPaths]) {
        NSString *path = item[@"path"];
        if (![NSFileManager.defaultManager fileExistsAtPath:path] && ![NSFileManager.defaultManager fileExistsAtPath:path.decomposedStringWithCanonicalMapping]) [imageFill addObject:item];
        if (imageFill.count >= 1000) break;
    }
    NSString *at = [[NSISO8601DateFormatter new] stringFromDate:NSDate.date];
    return @{@"result": @{@"at": at, @"remembered": @(remember.count), @"macDeleted": macDeleted, @"collisions": collisions, @"external": external, @"imageFill": imageFill}, @"remember": remember, @"newest": @(newest)};
}
// 전체 확인 결과와 처음 대조로 같다고 본 문서의 영수증을 한 번에 적는다. 그 사이 영수증이 생긴 문서는 건드리지 않는다.
- (NSDictionary *)saveFullCheck:(NSDictionary *)scan {
    NSDictionary *result = scan[@"result"];
    [self.receipt transaction:^{
        for (NSDictionary *r in scan[@"remember"]) if (![self.receipt document:r[@"path"]])
            [self.receipt rememberDocument:r[@"path"] version:r[@"version"] sha:r[@"sha"] size:[r[@"size"] longLongValue] mtime:[r[@"mtime"] longLongValue] neutral:r[@"neutral"] replaced:nil];
        [self.receipt setValue:[[NSString alloc] initWithData:JSONData(result) encoding:NSUTF8StringEncoding] forKey:@"fullCheck"];
        [self.receipt setValue:result[@"at"] forKey:@"fullCheckAt"];
        [self.receipt setValue:[scan[@"newest"] stringValue] forKey:@"externalCheckAt"];
    }];
    [self report:[NSString stringWithFormat:@"전체 확인 완료 · 처음 대조로 같음 %lu · 확인 필요 %lu", (unsigned long)[scan[@"remember"] count], (unsigned long)[result[@"collisions"] count] + [result[@"macDeleted"] count]]];
    return result;
}
- (NSDictionary *)fullCheck { return [self saveFullCheck:[self scanFullCheck]]; }
- (void)dropFromFullCheck:(NSString *)list path:(NSString *)path {
    NSMutableDictionary *saved = [[self lastFullCheck] mutableCopy]; if (!saved) return;
    saved[list] = [saved[list] filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"path != %@", path]];
    [self.receipt setValue:[[NSString alloc] initWithData:JSONData(saved) encoding:NSUTF8StringEncoding] forKey:@"fullCheck"];
}
- (NSDictionary *)serverDocument:(NSString *)identifier {
    NSDictionary *doc = [self.server request:[@"/api/documents/" stringByAppendingString:Query(identifier)] method:@"GET" body:nil headers:Headers()][@"document"];
    YBValidateMetadata(doc); return doc;
}
// Mac에서 지운 문서를 서버 휴지통으로(누구나 할 수 있고 웹에서 꺼낼 수 있다).
- (void)trashOnServer:(NSString *)path {
    NSDictionary *entry = [self.receipt ledger:path]; YBRequire([entry[@"id"] length] > 0, @"서버 장부에 없는 문서입니다.");
    NSDictionary *result = [self.server request:[NSString stringWithFormat:@"/api/documents/%@/state", Query(entry[@"id"])] method:@"POST" body:JSONData(@{@"action": @"trash"}) headers:JSONHeaders()];
    YBRequire([result[@"document"] isKindOfClass:NSDictionary.class], @"서버 휴지통으로 옮기지 못했습니다.");
    [self.receipt transaction:^{ [self.receipt setLedger:path id:entry[@"id"] version:entry[@"version"] sha:entry[@"sha"] state:@"trashed"]; [self.receipt forgetDocument:path]; }];
    [self dropFromFullCheck:@"macDeleted" path:path];
}
- (NSString *)backupFolder:(NSString *)kind {
    NSDateFormatter *stamp = [NSDateFormatter new]; stamp.dateFormat = @"yyyyMMdd-HHmmss"; stamp.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
    NSString *folder = [self backupRoot:[NSString stringWithFormat:@"%@-%@", [stamp stringFromDate:NSDate.date], kind]];
    [NSFileManager.defaultManager createDirectoryAtPath:folder withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:NULL];
    return folder;
}
// 서버 문서를 받아 그 경로에 쓴다. 덮이는 Mac 파일은 백업 폴더와 서버 보관본으로 남긴다.
- (void)receiveServer:(NSDictionary *)doc into:(NSString *)path backup:(NSString *)folder {
    NSData *data = [self.server download:doc];
    mode_t mode = 0644; NSData *current = YBReadSafeFile(self.root, path, &mode);
    if (current) {
        YBWriteSafeFile([folder stringByAppendingPathComponent:@"documents"], path, current, 0600, nil);
        @try { [self.server request:[NSString stringWithFormat:@"/api/sync/revisions?kind=doc&id=%@&baseVersion=0&reason=technical", Query(doc[@"id"])] method:@"POST" body:current headers:@{@"X-YebaeOn-Sync": @"2", @"Content-Type": @"application/xml; charset=utf-8"}]; } @catch (NSException *e) {}
    }
    YBWriteSafeFile(self.root, path, data, current ? mode : 0644, ^{ YBRequire(!self.presenterRunning(), @"ProPresenter가 실행됐습니다. 중단했습니다."); });
    long long size = 0, mtime = 0; [self statPath:path size:&size mtime:&mtime];
    [self.receipt rememberDocument:path version:doc[@"version"] sha:doc[@"sha256"] size:size mtime:mtime neutral:NeutralHash(data) replaced:current ? NeutralHash(current) : nil];
}
// 같은 이름, 다른 내용: [서버 것으로]
- (void)takeServer:(NSString *)path {
    YBRequire(!self.presenterRunning(), @"ProPresenter를 종료한 뒤 해 주세요.");
    NSDictionary *entry = [self.receipt ledger:path]; YBRequire([entry[@"id"] length] > 0, @"서버 장부에 없는 문서입니다.");
    [self receiveServer:[self serverDocument:entry[@"id"]] into:path backup:[self backupFolder:@"server"]];
    [self dropFromFullCheck:@"collisions" path:path]; [self dropFromFullCheck:@"macDeleted" path:path];
}
// 같은 이름, 다른 내용: [Mac 것 올리기]. 서버의 그전 내용은 이력에 남는다.
- (void)takeMac:(NSString *)path {
    NSDictionary *entry = [self.receipt ledger:path]; YBRequire([entry[@"id"] length] > 0, @"서버 장부에 없는 문서입니다.");
    NSData *bytes = YBReadSafeFile(self.root, path, NULL); YBRequire(bytes != nil, @"Mac 파일을 읽지 못했습니다.");
    NSDictionary *saved = [self.server upload:bytes path:path previous:[self serverDocument:entry[@"id"]]];
    long long size = 0, mtime = 0; [self statPath:path size:&size mtime:&mtime];
    [self.receipt transaction:^{
        [self.receipt rememberDocument:path version:saved[@"version"] sha:saved[@"sha256"] size:size mtime:mtime neutral:NeutralHash(bytes) replaced:nil];
        [self.receipt setLedger:path id:saved[@"id"] version:saved[@"version"] sha:saved[@"sha256"] state:@"active"];
    }];
    @try { [self uploadMediaFor:bytes]; } @catch (NSException *e) {}
    [self dropFromFullCheck:@"collisions" path:path];
}
// 같은 이름, 다른 내용: [번호 붙여 둘 다 두기]. Mac 파일을 `이름 2.pro6`로 바꾸고 재생목록 참조를 고친 뒤 서버에 새 문서로 올리고, 원래 이름에는 서버 것을 받는다.
- (NSString *)keepBothNumbered:(NSString *)path {
    YBRequire(!self.presenterRunning(), @"ProPresenter를 종료한 뒤 해 주세요.");
    NSDictionary *entry = [self.receipt ledger:path]; YBRequire([entry[@"id"] length] > 0, @"서버 장부에 없는 문서입니다.");
    NSString *stem = path.stringByDeletingPathExtension, *target = nil;
    for (int n = 2; n < 100 && !target; n++) {
        NSString *candidate = [NSString stringWithFormat:@"%@ %d.pro6", stem, n];
        if (![self.receipt ledger:candidate] && ![self diskPath:candidate]) target = candidate;
    }
    YBRequire(target != nil, @"붙일 번호를 찾지 못했습니다.");
    NSString *folder = [self backupFolder:@"numbered"], *from = [self diskPath:path];
    YBRequire(from != nil, @"Mac 파일이 없습니다.");
    NSData *bytes = YBReadSafeFile(self.root, path, NULL);
    // 1. 서버에 새 이름으로 먼저 올린다(실패하면 Mac은 그대로).
    NSDictionary *saved = [self.server upload:bytes path:target previous:nil];
    // 2. Mac 파일 이름과 재생목록 참조
    self.sourceRoot = self.sourceRoot ?: ([self.library[@"sourceRoot"] isKindOfClass:NSString.class] ? self.library[@"sourceRoot"] : nil);
    NSData *before = YBReadPlaylist(self.playlistURL), *after = [self rewriteReferences:before from:path to:target];
    YBRequire(renamex_np(from.fileSystemRepresentation, [self.root stringByAppendingPathComponent:target].fileSystemRepresentation, RENAME_EXCL) == 0, @"Mac 파일 이름을 바꾸지 못했습니다.");
    if (![after isEqual:before]) YBReplacePlaylist(self.playlistURL, before, after, [folder stringByAppendingPathComponent:@"playlist"], self.presenterRunning);
    long long size = 0, mtime = 0; [self statPath:target size:&size mtime:&mtime];
    [self.receipt transaction:^{
        [self.receipt rememberDocument:target version:saved[@"version"] sha:saved[@"sha256"] size:size mtime:mtime neutral:NeutralHash(bytes) replaced:nil];
        [self.receipt setLedger:target id:saved[@"id"] version:saved[@"version"] sha:saved[@"sha256"] state:@"active"];
    }];
    // 3. 원래 이름에는 서버 것
    [self receiveServer:[self serverDocument:entry[@"id"]] into:path backup:folder];
    [self dropFromFullCheck:@"collisions" path:path];
    [self logNumbered:path target:target];
    return target;
}
- (void)logNumbered:(NSString *)path target:(NSString *)target {
    NSMutableArray *log = [JSON([[self.receipt value:@"numbered"] dataUsingEncoding:NSUTF8StringEncoding]) mutableCopy] ?: [NSMutableArray array];
    [log addObject:@{@"path": path, @"target": target, @"at": [[NSISO8601DateFormatter new] stringFromDate:NSDate.date]}];
    while (log.count > 200) [log removeObjectAtIndex:0];
    [self.receipt setValue:[[NSString alloc] initWithData:JSONData(log) encoding:NSUTF8StringEncoding] forKey:@"numbered"];
}
- (NSArray *)numberedLog {
    NSArray *log = JSON([[self.receipt value:@"numbered"] dataUsingEncoding:NSUTF8StringEncoding]);
    return [log isKindOfClass:NSArray.class] ? log : @[];
}
// 서버 경로표의 이미지를 Mac 그 경로에 받는다. 이미 있으면 건드리지 않는다.
- (void)fetchImage:(NSDictionary *)item {
    NSString *path = item[@"path"];
    YBRequire(AllowedMedia(path), @"허용 폴더 밖의 경로입니다.");
    if ([NSFileManager.defaultManager fileExistsAtPath:path] || [NSFileManager.defaultManager fileExistsAtPath:path.decomposedStringWithCanonicalMapping]) { [self dropFromFullCheck:@"imageFill" path:path]; return; }
    NSDictionary *asset = [self.server mediaAssets:@[item[@"sha"]]].firstObject;
    YBRequire([asset[@"size"] isKindOfClass:NSNumber.class], @"서버에 이미지 원본이 없습니다.");
    NSData *data = [self.server downloadMedia:item[@"sha"] size:[asset[@"size"] unsignedLongLongValue]];
    YBRequire([YBHash(data) isEqual:item[@"sha"]], @"받은 이미지가 다릅니다.");
    [NSFileManager.defaultManager createDirectoryAtPath:path.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:NULL];
    YBRequire([data writeToFile:path options:NSDataWritingWithoutOverwriting error:NULL], @"이미지를 쓰지 못했습니다.");
    [self dropFromFullCheck:@"imageFill" path:path];
}
+ (NSData *)comparableBytes:(NSData *)data { return ComparableBytes(data); }
- (NSData *)serverBytes:(NSString *)path {
    NSDictionary *entry = [self.receipt ledger:path]; YBRequire([entry[@"id"] length] > 0, @"서버 장부에 없는 문서입니다.");
    return [self.server download:[self serverDocument:entry[@"id"]]];
}
- (BOOL)hasLocalDocument:(NSString *)path { return [self diskPath:path] != nil; }
- (NSString *)webLink:(NSString *)path {
    NSDictionary *entry = [self.receipt ledger:path];
    return [entry[@"id"] length] ? [NSString stringWithFormat:@"%@/?doc=%@", self.server.origin, entry[@"id"]] : nil;
}

#pragma mark - 마지막 적용 되돌리기 (3차)

// 가장 최근 적용 하나만 되돌린다(영수증의 마지막 적용 번호). 이미 되돌렸으면 없음.
- (NSString *)lastUndoFolder {
    NSString *last = [self.receipt value:@"lastApplyID"];
    if (!last.length) return nil;
    NSString *folder = [self backupRoot:last];
    if (![NSFileManager.defaultManager fileExistsAtPath:[folder stringByAppendingPathComponent:@"undo.json"]]) return nil;
    return [NSFileManager.defaultManager fileExistsAtPath:[folder stringByAppendingPathComponent:@"undone.json"]] ? nil : folder;
}
- (NSDictionary *)lastApply {
    NSString *folder = [self lastUndoFolder];
    NSDictionary *undo = folder ? JSON([NSData dataWithContentsOfFile:[folder stringByAppendingPathComponent:@"undo.json"]]) : nil;
    return [undo isKindOfClass:NSDictionary.class] ? undo : nil;
}
// 적용 뒤 바뀌지 않은 것만 원래대로 돌린다. 원래 없던 문서는 macOS 휴지통으로 옮긴다(지우지 않는다).
// 영수증은 "적용 때 덮인 내용"을 기억하므로 다음 비교에서 받을 것으로 다시 보인다(올리지 않는다).
- (NSDictionary *)undoLastApply {
    YBRequire(!self.presenterRunning(), @"ProPresenter를 종료한 뒤 되돌려 주세요.");
    YBRequire(![NSFileManager.defaultManager fileExistsAtPath:self.journalPath], @"끝나지 않은 적용이 있습니다. 앱을 다시 열어 마무리한 뒤 되돌려 주세요.");
    NSString *folder = [self lastUndoFolder];
    YBRequire(folder != nil, @"되돌릴 적용이 없습니다.");
    NSDictionary *undo = JSON([NSData dataWithContentsOfFile:[folder stringByAppendingPathComponent:@"undo.json"]]);
    YBRequire([undo isKindOfClass:NSDictionary.class], @"되돌리기 기록을 읽지 못했습니다.");
    NSMutableArray *restored = [NSMutableArray array], *skipped = [NSMutableArray array];
    NSString *docsBackup = [folder stringByAppendingPathComponent:@"documents"];
    // 1. 재생목록: 적용 뒤 그대로일 때만 백업으로 바꾼다.
    NSString *playlistBackup = undo[@"playlistBackup"];
    if (![playlistBackup length] && [undo[@"playlistAfterSha"] length]) {
        NSString *dir = [folder stringByAppendingPathComponent:@"playlist"];
        for (NSString *name in [NSFileManager.defaultManager contentsOfDirectoryAtPath:dir error:NULL]) {
            NSString *candidate = [[dir stringByAppendingPathComponent:name] stringByAppendingPathComponent:self.playlistURL.lastPathComponent];
            if ([NSFileManager.defaultManager fileExistsAtPath:candidate]) playlistBackup = candidate;
        }
    }
    if ([playlistBackup length]) {
        NSData *current = YBReadPlaylist(self.playlistURL), *previous = [NSData dataWithContentsOfFile:playlistBackup];
        if (previous && [YBHash(current) isEqual:undo[@"playlistAfterSha"]]) {
            YBReplacePlaylist(self.playlistURL, current, previous, [folder stringByAppendingPathComponent:@"undo-playlist"], self.presenterRunning);
            [restored addObject:@"재생목록"];
        } else [skipped addObject:@"재생목록(적용 뒤 바뀜)"];
    }
    // 2. 문서
    for (NSDictionary *doc in undo[@"documents"]) {
        NSString *path = doc[@"path"], *absolute = [self diskPath:path];
        if (!absolute) continue;
        if (![YBHash([NSData dataWithContentsOfFile:absolute]) isEqual:doc[@"sha"]]) { [skipped addObject:[path stringByAppendingString:@"(적용 뒤 바뀜)"]]; continue; }
        if ([doc[@"backup"] boolValue]) {
            mode_t mode = 0644; YBReadSafeFile(self.root, path, &mode);
            YBWriteSafeFile(self.root, path, YBReadSafeFile(docsBackup, path, NULL), mode, ^{ YBRequire(!self.presenterRunning(), @"ProPresenter가 실행됐습니다. 되돌리기를 중단했습니다."); });
        } else YBRequire(self.trashItem(absolute) != nil, [NSString stringWithFormat:@"휴지통으로 옮기지 못했습니다: %@", path]);
        NSDictionary *previous = undo[@"receiptBefore"][@"documents"][path];
        long long size = 0, mtime = 0;
        if ([previous isKindOfClass:NSDictionary.class] && [self statPath:path size:&size mtime:&mtime])
            [self.receipt rememberDocument:path version:previous[@"version"] sha:previous[@"sha"] size:size mtime:mtime neutral:previous[@"neutral"] replaced:previous[@"replaced"]];
        else [self.receipt forgetDocument:path];
        [restored addObject:path];
    }
    // 3. 이름 바꾸기와 휴지통을 거꾸로. 기다리던 서버 동작으로 다시 둔다.
    for (NSDictionary *move in [undo[@"moves"] reverseObjectEnumerator]) {
        NSString *to = [self diskPath:move[@"to"]];
        if (!to || [self diskPath:move[@"from"]]) { [skipped addObject:[move[@"to"] stringByAppendingString:@"(이름 되돌리기 불가)"]]; continue; }
        YBRequire(renamex_np(to.fileSystemRepresentation, [self.root stringByAppendingPathComponent:move[@"from"]].fileSystemRepresentation, RENAME_EXCL) == 0, [NSString stringWithFormat:@"이름을 되돌리지 못했습니다: %@", move[@"to"]]);
        // 번호 붙인 사본의 영수증은 서버의 다른 문서(`이름 2`) 것이라 옮기지 않고 지운다. 원래 이름은 "이력 없음"으로 돌아간다.
        if ([move[@"numbered"] boolValue]) [self.receipt forgetDocument:move[@"to"]];
        else if ([self.receipt document:move[@"to"]]) [self.receipt moveDocument:move[@"to"] to:move[@"from"]];
        [restored addObject:move[@"from"]];
    }
    for (NSDictionary *item in undo[@"trash"]) {
        if ([self diskPath:item[@"path"]] || ![NSFileManager.defaultManager fileExistsAtPath:item[@"location"]]) { [skipped addObject:[item[@"path"] stringByAppendingString:@"(휴지통에서 찾지 못함)"]]; continue; }
        YBRequire([NSFileManager.defaultManager moveItemAtPath:item[@"location"] toPath:[self.root stringByAppendingPathComponent:item[@"path"]] error:NULL], [NSString stringWithFormat:@"휴지통에서 꺼내지 못했습니다: %@", item[@"path"]]);
        [restored addObject:item[@"path"]];
    }
    [self.receipt transaction:^{
        for (NSDictionary *done in undo[@"pendingDone"]) {
            NSMutableDictionary *item = [done mutableCopy]; item[@"kind"] = @"doc";
            [self.receipt addPending:item];
        }
        NSDictionary *nodes = undo[@"receiptBefore"][@"nodes"];
        for (NSString *key in nodes) {
            NSDictionary *previous = nodes[key];
            if ([previous isKindOfClass:NSDictionary.class]) [self.receipt rememberNode:key serverSha:previous[@"serverSha"] fingerprint:previous[@"localFingerprint"] name:previous[@"name"] replaced:previous[@"replaced"]];
            else [self.receipt forgetNode:key];
        }
    }];
    YBWriteSafeFile(folder, @"undone.json", JSONData(@{@"at": [[NSISO8601DateFormatter new] stringFromDate:NSDate.date], @"restored": restored, @"skipped": skipped}), 0600, nil);
    return @{@"restored": restored, @"skipped": skipped};
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

#pragma mark - 참조 고침 (3차)

static NSString *Escaped(NSString *value) {
    return [[[[[value stringByReplacingOccurrencesOfString:@"&" withString:@"&amp;"] stringByReplacingOccurrencesOfString:@"\"" withString:@"&quot;"] stringByReplacingOccurrencesOfString:@"'" withString:@"&apos;"] stringByReplacingOccurrencesOfString:@"<" withString:@"&lt;"] stringByReplacingOccurrencesOfString:@">" withString:@"&gt;"];
}
// 그 노드 여는 태그의 속성 하나를 바꾼다(없으면 그대로).
static NSString *WithAttribute(NSString *tag, NSString *name, NSString *value) {
    NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:[NSString stringWithFormat:@"\\b%@\\s*=\\s*(\"[^\"]*\"|'[^']*')", name] options:0 error:NULL];
    NSTextCheckingResult *match = [pattern firstMatchInString:tag options:0 range:NSMakeRange(0, tag.length)];
    if (!match) return tag;
    return [tag stringByReplacingCharactersInRange:[match rangeAtIndex:1] withString:[NSString stringWithFormat:@"\"%@\"", Escaped(value)]];
}
// 문서 이름이 바뀌었을 때 모든 예배의 그 문서 cue를 새 경로로 고친다. cue 이름이 옛 문서 이름이면 그것도 바꾼다(서버와 같은 규칙).
- (NSData *)rewriteReferences:(NSData *)data from:(NSString *)from to:(NSString *)to {
    NSString *oldName = from.lastPathComponent.stringByDeletingPathExtension, *newName = to.lastPathComponent.stringByDeletingPathExtension;
    for (NSDictionary *node in YBPlaylistNodes(data)) {
        NSUInteger base = [node[@"range"] rangeValue].location;
        NSMutableString *raw = [node[@"raw"] mutableCopy]; BOOL changed = NO;
        for (NSDictionary *cue in [node[@"items"] reverseObjectEnumerator]) {
            if (![cue[@"tag"] isEqual:@"RVDocumentCue"]) continue;
            NSString *source = cue[@"attrs"][@"filePath"];
            NSString *reference = YBPlaylistReference(source, self.sourceRoot ?: self.root) ?: YBPlaylistReference(source, self.root);
            if (![reference isEqual:from]) continue;
            NSRange opening = NSMakeRange([cue[@"start"] unsignedIntegerValue] - base, [cue[@"open"] unsignedIntegerValue] - [cue[@"start"] unsignedIntegerValue]);
            NSString *tag = WithAttribute([raw substringWithRange:opening], @"filePath", [self.root stringByAppendingPathComponent:to]);
            if ([cue[@"attrs"][@"displayName"] isEqual:oldName]) tag = WithAttribute(tag, @"displayName", newName);
            [raw replaceCharactersInRange:opening withString:tag]; changed = YES;
        }
        if (changed) data = YBPlaylistReplacing(data, node[@"id"], raw);
    }
    return data;
}

#pragma mark - 장부 사본·새 문서·이미지 (3차)

- (void)syncLedger {
    if ([self.receipt value:@"ledgerSeq"].length) return;
    [self report:@"서버 장부 받는 중"];
    NSDictionary *ledger = [self.server request:@"/api/sync/ledger" method:@"GET" body:nil headers:Headers() timeout:120];
    YBRequire([ledger[@"documents"] isKindOfClass:NSArray.class] && [ledger[@"seq"] isKindOfClass:NSNumber.class], @"서버 장부가 올바르지 않습니다.");
    [self.receipt transaction:^{
        for (NSDictionary *doc in ledger[@"documents"]) if ([doc[@"path"] isKindOfClass:NSString.class])
            [self.receipt setLedger:doc[@"path"] id:doc[@"id"] version:doc[@"version"] sha:doc[@"sha256"] state:doc[@"state"] ?: @"active"];
        for (NSDictionary *media in [ledger[@"media"] isKindOfClass:NSArray.class] ? ledger[@"media"] : @[]) if ([media[@"path"] isKindOfClass:NSString.class] && [media[@"sha256"] isKindOfClass:NSString.class])
            [self.receipt setMedia:media[@"path"] sha:media[@"sha256"]];
        [self.receipt setValue:[ledger[@"seq"] stringValue] forKey:@"ledgerSeq"];
    }];
}
// 일지 한 줄을 장부 사본에 반영한다. 줄을 지우지 않고 상태로 남긴다.
- (void)applyToLedger:(NSDictionary *)change {
    NSString *kind = change[@"kind"], *action = change[@"action"], *path = change[@"path"];
    if ([kind isEqual:@"media"]) { if (([action isEqual:@"created"] || [action isEqual:@"updated"]) && [change[@"sha256"] isKindOfClass:NSString.class]) [self.receipt setMedia:change[@"entity"] sha:change[@"sha256"]]; return; }
    if (![kind isEqual:@"doc"] || ![path isKindOfClass:NSString.class]) return;
    NSDictionary *states = @{@"created": @"active", @"updated": @"active", @"unarchived": @"active", @"untrashed": @"active", @"renamed": @"active", @"archived": @"archived", @"trashed": @"trashed", @"purged": @"purged"};
    NSString *state = states[action] ?: @"active";
    [self.receipt setLedger:path id:change[@"entity"] version:change[@"version"] ?: @0 sha:change[@"sha256"] state:state];
    if ([action isEqual:@"renamed"] && [change[@"previous"] isKindOfClass:NSString.class]) {
        NSDictionary *old = [self.receipt ledger:change[@"previous"]];
        [self.receipt setLedger:change[@"previous"] id:change[@"entity"] version:old[@"version"] ?: change[@"version"] ?: @0 sha:old[@"sha"] ?: change[@"sha256"] state:@"renamed"];
    }
}
// 일지 한 줄이 [적용]을 기다리는 동작이면 기록한다.
- (void)recordPending:(NSDictionary *)change {
    if (![change[@"kind"] isEqual:@"doc"] || ![change[@"path"] isKindOfClass:NSString.class]) return;
    NSString *action = change[@"action"], *entity = change[@"entity"];
    if ([action isEqual:@"trashed"]) [self.receipt addPending:@{@"kind": @"doc", @"entity": entity, @"action": @"trashed", @"path": change[@"path"], @"sha": change[@"sha256"] ?: @"", @"version": change[@"version"] ?: @0}];
    else if ([action isEqual:@"untrashed"]) [self.receipt removePending:@"doc" entity:entity action:@"trashed"];
    else if ([action isEqual:@"renamed"] && [change[@"previous"] isKindOfClass:NSString.class]) {
        // 앞서 기다리던 이름 바꾸기가 있으면 그 시작 이름을 이어 받는다(가→나→다는 가→다).
        NSString *from = change[@"previous"];
        for (NSDictionary *item in [self.receipt pending]) if ([item[@"entity"] isEqual:entity] && [item[@"action"] isEqual:@"renamed"]) from = item[@"previous"] ?: from;
        if ([from isEqual:change[@"path"]]) [self.receipt removePending:@"doc" entity:entity action:@"renamed"];
        else [self.receipt addPending:@{@"kind": @"doc", @"entity": entity, @"action": @"renamed", @"path": change[@"path"], @"previous": from, @"sha": change[@"sha256"] ?: @"", @"version": change[@"version"] ?: @0}];
        // 휴지통 대기 중인 문서의 경로도 따라간다.
        for (NSDictionary *item in [self.receipt pending]) if ([item[@"entity"] isEqual:entity] && [item[@"action"] isEqual:@"trashed"]) {
            NSMutableDictionary *moved = [item mutableCopy]; moved[@"path"] = change[@"path"]; [self.receipt addPending:moved];
        }
    }
}

// 허용 폴더 3개(sync.md 5.4). 영상은 보내지 않는다.
static NSString *const kMediaRoot = @"/Users/Shared/Renewed Vision Media/";
static BOOL AllowedMedia(NSString *path) {
    if (![path hasPrefix:kMediaRoot] || [path containsString:@"/../"] || [path containsString:@"/./"]) return NO;
    NSString *rest = [path substringFromIndex:kMediaRoot.length];
    BOOL folder = [rest hasPrefix:@"Images/"] || [rest hasPrefix:@"ImportedImages/"] || [rest hasPrefix:@"YebaeOn/"];
    NSSet *images = [NSSet setWithArray:@[@"jpg", @"jpeg", @"png", @"gif", @"tif", @"tiff", @"bmp", @"heic", @"psd", @"pdf"]];
    return folder && [images containsObject:path.pathExtension.lowercaseString];
}
// 문서 XML 안의 이미지 절대경로(file:// URL과 /Users/Shared/… 표기 둘 다). NFC로 맞춘다.
static NSArray *MediaPaths(NSData *document) {
    NSString *xml = Text(document); if (!xml) return @[];
    NSMutableOrderedSet *paths = [NSMutableOrderedSet orderedSet];
    NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"(file://(?:localhost)?/Users/Shared/Renewed(?:%20| )Vision(?:%20| )Media/[^\"'<>]+|/Users/Shared/Renewed Vision Media/[^\"'<>]+)" options:0 error:NULL];
    for (NSTextCheckingResult *match in [pattern matchesInString:xml options:0 range:NSMakeRange(0, xml.length)]) {
        NSString *value = [[[[xml substringWithRange:match.range] stringByReplacingOccurrencesOfString:@"&amp;" withString:@"&"] stringByReplacingOccurrencesOfString:@"&apos;" withString:@"'"] stringByReplacingOccurrencesOfString:@"&quot;" withString:@"\""];
        if ([value hasPrefix:@"file:"]) { NSURL *url = [NSURL URLWithString:value] ?: [NSURL URLWithString:[value stringByAddingPercentEncodingWithAllowedCharacters:NSCharacterSet.URLPathAllowedCharacterSet]]; value = url.path; }
        else value = value.stringByRemovingPercentEncoding ?: value;
        value = value.precomposedStringWithCanonicalMapping;
        if (value && AllowedMedia(value)) [paths addObject:value];
    }
    return paths.array;
}
- (NSUInteger)uploadMediaFor:(NSData *)document { return [[self uploadMediaForDocuments:document ? @[document] : @[]][@"registered"] unsignedIntegerValue]; }
// 여러 문서의 이미지를 한꺼번에: Mac 안에서 목록·sha를 먼저 만들고, 서버에 있는지는 100개씩 묻고, 없는 것만 4개씩 올리고, 경로표는 200개씩 등록한다.
// 반환: {uploaded, registered, skipped}
- (NSDictionary *)uploadMediaForDocuments:(NSArray *)documents {
    NSMutableOrderedSet *paths = [NSMutableOrderedSet orderedSet];
    for (NSData *document in documents) [paths addObjectsFromArray:MediaPaths(document)];
    NSMutableArray *items = [NSMutableArray array]; NSMutableDictionary *files = [NSMutableDictionary dictionary]; NSUInteger skipped = 0, index = 0;
    for (NSString *path in paths) {
        index++;
        if (index % 20 == 0) [self report:[NSString stringWithFormat:@"이미지 확인 %lu/%lu", (unsigned long)index, (unsigned long)paths.count]];
        NSString *disk = nil;
        for (NSString *candidate in @[path, path.decomposedStringWithCanonicalMapping]) if ([NSFileManager.defaultManager fileExistsAtPath:candidate]) { disk = candidate; break; }
        if (!disk) continue;   // Mac에도 없는 이미지는 건너뛴다(외부 참조 점검이 보여 준다)
        NSData *bytes = [NSData dataWithContentsOfFile:disk options:NSDataReadingMappedIfSafe error:NULL];
        if (!bytes.length || bytes.length > 32 * 1024 * 1024) continue;
        NSString *hash = YBHash(bytes);
        if ([[self.receipt mediaSha:path] isEqual:hash]) { skipped++; continue; }   // 서버 경로표와 같다
        [items addObject:@{@"path": path, @"sha256": hash, @"size": @(bytes.length)}];
        files[hash] = disk;
    }
    NSArray *hashes = files.allKeys; NSMutableSet *known = [NSMutableSet set];
    for (NSUInteger offset = 0; offset < hashes.count; offset += 100)
        for (NSDictionary *asset in [self.server mediaAssets:[hashes subarrayWithRange:NSMakeRange(offset, MIN(100, hashes.count - offset))]]) if (asset[@"sha256"]) [known addObject:asset[@"sha256"]];
    NSMutableArray *missing = [NSMutableArray array];
    for (NSString *hash in hashes) if (![known containsObject:hash]) [missing addObject:hash];
    __block NSUInteger done = 0;
    NSArray *results = Parallel(missing, ^id(NSString *hash) {
        NSData *bytes = [NSData dataWithContentsOfFile:files[hash] options:NSDataReadingMappedIfSafe error:NULL];
        YBRequire([YBHash(bytes) isEqual:hash], @"이미지가 올리는 중에 바뀌었습니다.");
        [self.server uploadMedia:bytes sha256:hash];
        @synchronized(self) { done++; [self report:[NSString stringWithFormat:@"이미지 올리는 중 %lu/%lu", (unsigned long)done, (unsigned long)missing.count]]; }
        return @YES;
    });
    NSMutableSet *failedHashes = [NSMutableSet set];
    for (NSUInteger i = 0; i < results.count; i++) if ([results[i] isKindOfClass:NSException.class]) [failedHashes addObject:missing[i]];
    NSArray *ready = [items filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSDictionary *item, NSDictionary *bindings) { return ![failedHashes containsObject:item[@"sha256"]]; }]];
    for (NSUInteger offset = 0; offset < ready.count; offset += 200) {
        NSArray *chunk = [ready subarrayWithRange:NSMakeRange(offset, MIN(200, ready.count - offset))];
        [self report:[NSString stringWithFormat:@"이미지 경로 등록 %lu/%lu", (unsigned long)MIN(offset + 200, ready.count), (unsigned long)ready.count]];
        [self.server request:@"/api/media/paths" method:@"PUT" body:JSONData(@{@"items": chunk}) headers:JSONHeaders()];
        [self.receipt transaction:^{ for (NSDictionary *item in chunk) [self.receipt setMedia:item[@"path"] sha:item[@"sha256"]]; }];
    }
    YBRequire(failedHashes.count == 0, [NSString stringWithFormat:@"이미지 %lu개를 올리지 못했습니다. 다음 올리기 때 다시 시도합니다.", (unsigned long)failedHashes.count]);
    return @{@"uploaded": @(missing.count), @"registered": @(ready.count), @"skipped": @(skipped)};
}
- (void)addCollisions:(NSArray *)paths {
    if (!paths.count) return;
    NSMutableDictionary *saved = [[self lastFullCheck] mutableCopy] ?: [@{@"macDeleted": @[], @"collisions": @[], @"external": @[], @"imageFill": @[]} mutableCopy];
    NSMutableArray *list = [saved[@"collisions"] mutableCopy] ?: [NSMutableArray array];
    for (NSString *path in paths) if (![[list valueForKey:@"path"] containsObject:path]) [list addObject:@{@"path": path, @"id": [self.receipt ledger:path][@"id"] ?: @""}];
    saved[@"collisions"] = list;
    [self.receipt setValue:[[NSString alloc] initWithData:JSONData(saved) encoding:NSUTF8StringEncoding] forKey:@"fullCheck"];
}
- (NSDictionary *)uploadNew {
    NSMutableArray *created = [NSMutableArray array], *collisions = [NSMutableArray array]; NSMutableDictionary *failed = [NSMutableDictionary dictionary];
    if (![self.receipt value:@"ledgerSeq"].length) return @{@"created": created, @"collisions": collisions, @"media": @0, @"failed": failed};   // 장부 사본이 없으면 새 문서를 가릴 수 없다
    // 1. Mac 안에서 올릴 문서를 먼저 모은다. Mac 문서 폴더는 평평하다. 맨 위의 .pro6만 본다.
    [self report:@"새 문서 찾는 중"];
    NSMutableArray *candidates = [NSMutableArray array];
    for (NSString *name in [[NSFileManager.defaultManager contentsOfDirectoryAtPath:self.root error:NULL] sortedArrayUsingSelector:@selector(compare:)]) {
        if ([name hasPrefix:@"."] || ![name.pathExtension.lowercaseString isEqual:@"pro6"]) continue;
        NSString *path = name.precomposedStringWithCanonicalMapping;
        if ([self.receipt ledger:path] || [self.receipt document:path]) continue;   // 서버에 있었던 경로(휴지통·이름 바뀜 포함)는 새 문서가 아니다
        NSData *bytes = YBReadSafeFile(self.root, path, NULL);
        if (bytes) [candidates addObject:@{@"path": path, @"bytes": bytes}];
    }
    // 2. 문서는 문서끼리 4개씩
    __block NSUInteger done = 0;
    NSArray *results = Parallel(candidates, ^id(NSDictionary *item) {
        id result = nil;
        @try { result = [self.server upload:item[@"bytes"] path:item[@"path"] previous:nil]; }
        @catch (NSException *e) { result = [e.reason hasPrefix:@"HTTP 409"] ? @"exists" : e; }
        @synchronized(self) { done++; [self report:[NSString stringWithFormat:@"새 문서 올리는 중 %lu/%lu", (unsigned long)done, (unsigned long)candidates.count]]; }
        return result;
    });
    NSMutableArray *uploadedBytes = [NSMutableArray array];
    [self.receipt transaction:^{
        for (NSUInteger i = 0; i < candidates.count; i++) {
            NSString *path = candidates[i][@"path"]; id result = results[i];
            if ([result isEqual:@"exists"]) { [collisions addObject:path]; continue; }   // 서버에 같은 이름이 있다(이름 겹침 → 정리 창)
            if ([result isKindOfClass:NSException.class]) { failed[path] = [result reason] ?: @"올리기 실패"; continue; }
            NSDictionary *saved = result; long long size = 0, mtime = 0; [self statPath:path size:&size mtime:&mtime];
            [self.receipt rememberDocument:path version:saved[@"version"] sha:saved[@"sha256"] size:size mtime:mtime neutral:NeutralHash(candidates[i][@"bytes"]) replaced:nil];
            [self.receipt setLedger:path id:saved[@"id"] version:saved[@"version"] sha:saved[@"sha256"] state:@"active"];
            [created addObject:path]; [uploadedBytes addObject:candidates[i][@"bytes"]];
        }
    }];
    // 3. 이미지는 이미지끼리
    NSUInteger media = 0;
    @try { media = [[self uploadMediaForDocuments:uploadedBytes][@"uploaded"] unsignedIntegerValue]; } @catch (NSException *e) { failed[@"이미지"] = e.reason ?: @"이미지 올리기 실패"; }
    [self addCollisions:collisions];
    return @{@"created": created, @"collisions": collisions, @"media": @(media), @"failed": failed};
}

#pragma mark - 올리기 (2차)

- (NSDictionary *)upload:(NSArray *)rows {
    YBRequire(self.library != nil, @"먼저 비교해 주세요.");
    NSMutableArray *uploaded = [NSMutableArray array]; NSMutableDictionary *failed = [NSMutableDictionary dictionary];
    NSMutableDictionary *usage = [NSMutableDictionary dictionary];   // 경로 → 항목. 여러 예배가 같은 문서를 써도 한 번만
    NSMutableSet *sent = [NSMutableSet set]; NSMutableArray *sentBytes = [NSMutableArray array];
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
                [sent addObject:path]; any = YES; [sentBytes addObject:bytes];
            }
            // Mac에서만 바꾼 순서: 이 예배 노드 하나만 교체한다. 기준은 영수증의 서버 노드 sha(= 지금 서버 노드 sha)다.
            if ([row[@"macOnlyOrder"] boolValue]) {
                YBRequire([row[@"localXML"] length] > 0, @"Mac 예배 순서를 읽지 못했습니다.");
                [self report:[NSString stringWithFormat:@"%@ · 순서 올리는 중", name]];
                NSData *body = [NSJSONSerialization dataWithJSONObject:@{@"baseNodeHash": plan[@"playlist"][@"sha256"], @"xml": row[@"localXML"]} options:0 error:NULL];
                NSDictionary *result = [self.server request:[NSString stringWithFormat:@"/api/playlists/%@/nodes?node=%@", Query(self.library[@"id"]), Query(row[@"nodeID"])] method:@"PUT" body:body headers:JSONHeaders()];
                YBRequire([result[@"playlist"][@"sha256"] isKindOfClass:NSString.class], @"서버가 예배 순서 저장 결과를 돌려주지 않았습니다.");
                [self.receipt rememberNode:row[@"key"] serverSha:result[@"playlist"][@"sha256"] fingerprint:row[@"localFingerprint"] name:row[@"localName"] ?: name];
                any = YES;
            }
            // Mac에서 만든 예배: 서버에 없을 때만 더한다. 서버가 보관·휴지통에 넣은 번호면 되살리지 않는다(409).
            if ([row[@"status"] isEqual:@"macNew"]) {
                YBRequire([row[@"localXML"] length] > 0, @"Mac 예배 순서를 읽지 못했습니다.");
                [self report:[NSString stringWithFormat:@"%@ · 새 예배 올리는 중", name]];
                NSData *body = [NSJSONSerialization dataWithJSONObject:@{@"xml": row[@"localXML"]} options:0 error:NULL];
                NSDictionary *result = [self.server request:[NSString stringWithFormat:@"/api/playlists/%@/nodes?node=%@", Query(self.library[@"id"]), Query(row[@"nodeID"])] method:@"POST" body:body headers:JSONHeaders()];
                YBRequire([result[@"playlist"][@"sha256"] isKindOfClass:NSString.class], @"서버가 새 예배 저장 결과를 돌려주지 않았습니다.");
                [self.receipt rememberNode:row[@"key"] serverSha:result[@"playlist"][@"sha256"] fingerprint:row[@"localFingerprint"] name:name];
                any = YES;
            }
            if (any) [uploaded addObject:name];
        } @catch (NSException *e) { failed[name] = e.reason ?: @"올리기 실패"; }
    }
    // 올린 문서들의 이미지는 한꺼번에
    @try { [self uploadMediaForDocuments:sentBytes]; } @catch (NSException *e) { failed[@"이미지"] = e.reason ?: @"이미지 올리기 실패"; }
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
    @try { [self syncLedger]; } @catch (NSException *e) { if ([e.reason hasPrefix:@"HTTP 401"] || ![e.reason hasPrefix:@"HTTP "]) @throw; }   // 장부 API가 없는 서버(3차 배포 전)는 건너뛴다
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
        long long ledgerSeq = [self.receipt value:@"ledgerSeq"].longLongValue;
        [self.receipt transaction:^{
            for (NSDictionary *change in result[@"changes"]) {
                if ([change[@"seq"] longLongValue] > ledgerSeq && [self.receipt value:@"ledgerSeq"].length) [self applyToLedger:change];
                [self recordPending:change];
            }
            if (ledgerSeq && [result[@"next"] longLongValue] > ledgerSeq) [self.receipt setValue:[result[@"next"] stringValue] forKey:@"ledgerSeq"];
        }];
        for (NSDictionary *change in result[@"changes"]) {
            NSString *kind = change[@"kind"], *entity = change[@"entity"], *action = change[@"action"];
            if ([kind hasPrefix:@"node"]) { if (!prefix || [entity hasPrefix:prefix]) relevant = YES; }
            else if ([kind isEqual:@"doc"]) {
                if ([@[@"trashed", @"untrashed", @"renamed"] containsObject:action]) relevant = YES;   // [적용]을 기다릴 동작
                else if (!self.knownDocumentIDs || [self.knownDocumentIDs containsObject:entity]) relevant = YES;
            }
            else if ([kind isEqual:@"media"]) {   // 활성 예배 문서가 가리키는 이미지가 경로표에 생기거나 바뀌면 다시 비교한다
                if (!self.knownImagePaths || [self.knownImagePaths containsObject:entity]) relevant = YES;
            }
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
        // 보관 표시·Mac에서 지운 예배·문서 정리 줄은 "기다림"이 아니다.
        if ([@[@"same", @"archived", @"actions"] containsObject:row[@"status"] ?: @""] || ![row[@"nodeID"] length] || [row[@"macDeleted"] boolValue] || pending.count >= 200) continue;
        NSMutableDictionary *item = [@{@"kind": @"node", @"entity": [NSString stringWithFormat:@"%@:%@", self.library[@"id"], row[@"nodeID"]]} mutableCopy];
        NSString *status = row[@"status"];
        NSString *reason = [status isEqual:@"hold"] ? row[@"reason"] : [status isEqual:@"mac"] || [status isEqual:@"macNew"] ? @"Mac 수정 올리기 대기" : [status isEqual:@"trash"] ? @"Mac에서 빼기 대기" : [row[@"imagesOnly"] boolValue] ? @"이미지 받기 대기" : @"적용 대기";
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
    NSString *last = [self.receipt value:@"lastApplyID"];
    for (NSString *name in [names subarrayWithRange:NSMakeRange(0, names.count - limit)]) if (![name isEqual:last]) [NSFileManager.defaultManager removeItemAtPath:[root stringByAppendingPathComponent:name] error:NULL];
}
@end
