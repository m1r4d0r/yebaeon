#import "YB2Engine.h"
#import "../mac-app/YBPlaylistFormat.h"
#import "../mac-app/YBPlaylistIO.h"

// Sync 2 엔진 통합 검사. 로컬 Worker(test-server2.mjs)가 띄운 주소를 받아 실제 API로 돈다.
static int checks = 0;
static void Check(BOOL ok, NSString *message) { checks++; YBRequire(ok, message); }
static NSData *Doc(NSString *text) { return [[NSString stringWithFormat:@"<?xml version=\"1.0\" encoding=\"UTF-8\"?><RVPresentationDocument versionNumber=\"600\" category=\"예배순서\"><text>%@</text></RVPresentationDocument>", text] dataUsingEncoding:NSUTF8StringEncoding]; }
static NSString *Cue(NSString *uuid, NSString *name, NSString *root) {
    return [NSString stringWithFormat:@"      <RVDocumentCue UUID=\"%@\" displayName=\"%@\" filePath=\"%@/%@.pro6\" selectedArrangementID=\"\"/>\n", uuid, name, root, name];
}
static NSData *Playlist(NSString *root, NSArray *firstNode) {
    NSMutableString *xml = [NSMutableString stringWithString:@"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<RVPlaylistDocument>\n  <RVPlaylistNode UUID=\"ROOT\" displayName=\"Playlists\">\n    <RVPlaylistNode UUID=\"N1\" displayName=\"1부 예배\" modifiedDate=\"2026-10-01T00:00:00Z\">\n"];
    for (NSArray *cue in firstNode) [xml appendString:Cue(cue[0], cue[1], root)];
    [xml appendString:@"    </RVPlaylistNode>\n    <RVPlaylistNode UUID=\"N2\" displayName=\"수요예배\">\n"];
    [xml appendString:Cue(@"C-W1", @"첫화면", root)];
    [xml appendString:@"    </RVPlaylistNode>\n  </RVPlaylistNode>\n</RVPlaylistDocument>\n"];
    return [xml dataUsingEncoding:NSUTF8StringEncoding];
}
static NSString *Query(NSString *value) { return [value stringByAddingPercentEncodingWithAllowedCharacters:[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"]]; }
static NSDictionary *RowNamed(NSArray *rows, NSString *name) { for (NSDictionary *row in rows) if ([row[@"name"] isEqual:name]) return row; return nil; }

int main(int argc, const char *argv[]) { @autoreleasepool {
    // 서버 sourceRoot는 /Users/… 또는 ~/… 이어야 하므로 홈 아래에 시험 폴더를 둔다.
    NSString *area = [[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Caches/yebaeon-sync2-test"] stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
    @try {
        Check(argc == 2, @"local Worker URL required");
        NSString *origin = [NSString stringWithUTF8String:argv[1]];
        NSString *docs = [area stringByAppendingPathComponent:@"docs"], *playlistDir = [area stringByAppendingPathComponent:@"Playlists"], *profile = [area stringByAppendingPathComponent:@"profile"];
        for (NSString *dir in @[docs, playlistDir, profile]) Check([NSFileManager.defaultManager createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:NULL], @"folders");
        NSURL *playlistURL = [NSURL fileURLWithPath:[playlistDir stringByAppendingPathComponent:@"기본 .pro6pl"]];

        YBServer *mac = [[YBServer alloc] initWithOrigin:origin allowLocalTestServer:YES], *web = [[YBServer alloc] initWithOrigin:origin allowLocalTestServer:YES];
        [mac login:@"교회 Mac" password:@"native-integration-only"]; [web login:@"집 웹" password:@"native-integration-only"];

        // 로컬 문서 4개. 그중 3개만 서버에 원본이 있고, '새 찬양'은 장부에만 있는 셈(서버 원본 없음).
        NSDictionary *bytes = @{@"첫화면": Doc(@"첫화면"), @"1부기도": Doc(@"기도 원본"), @"오 신실하신 주": Doc(@"찬양 1"), @"새 찬양": Doc(@"찬양 2")};
        for (NSString *name in bytes) Check([bytes[name] writeToFile:[docs stringByAppendingPathComponent:[name.decomposedStringWithCanonicalMapping stringByAppendingString:@".pro6"]] atomically:YES], @"local doc");
        NSMutableDictionary *server = [NSMutableDictionary dictionary];
        for (NSString *name in @[@"첫화면", @"1부기도", @"오 신실하신 주"]) server[name] = [mac upload:bytes[name] path:[name stringByAppendingString:@".pro6"] previous:nil];

        NSData *local = Playlist(docs, @[@[@"C-1", @"첫화면"], @[@"C-2", @"1부기도"], @[@"C-3", @"오 신실하신 주"], @[@"C-4", @"새 찬양"]]);
        Check([local writeToFile:playlistURL.path atomically:YES], @"local playlist");
        NSDictionary *registered = [mac request:[NSString stringWithFormat:@"/api/playlists?path=%@&root=%@", Query(@"기본 .pro6pl"), Query(docs)] method:@"POST" body:local headers:@{@"Content-Type": @"application/xml; charset=utf-8"}];
        NSString *libraryID = registered[@"library"][@"id"]; Check(libraryID.length > 0, @"playlist registered");

        YB2Engine *engine = [[YB2Engine alloc] initWithServer:mac root:docs playlist:playlistURL profile:profile];
        engine.presenterRunning = ^BOOL { return NO; };
        Check([engine finishInterruptedApply] == nil, @"no interrupted apply");

        // 1. 처음 연결: 모두 같음. 원본 없는 참조는 막지 않는다.
        NSArray *rows = [engine compare];
        Check(rows.count == 2, @"two nodes");
        NSDictionary *n1 = RowNamed(rows, @"1부 예배");
        Check([n1[@"status"] isEqual:@"same"] && [n1[@"missingServer"] integerValue] == 1 && [n1[@"missingLocal"] count] == 0, @"initial same with one missing original");
        Check([[engine.receipt document:@"1부기도.pro6"][@"version"] isEqual:@1], @"receipt records same documents");

        // 2. 웹에서 기도 내용 수정 + 순서 바꿈(찬양을 기도 앞으로).
        NSDictionary *prayerV2 = [web upload:Doc(@"기도 웹 수정") path:@"1부기도.pro6" previous:server[@"1부기도"]];
        NSDictionary *plan = [web request:[NSString stringWithFormat:@"/api/playlists/%@/plan?node=N1", libraryID] method:@"GET" body:nil headers:nil];
        NSArray *items = plan[@"items"];
        NSData *patch = [NSJSONSerialization dataWithJSONObject:@{@"items": @[@{@"id": items[0][@"id"]}, @{@"id": items[2][@"id"]}, @{@"id": items[1][@"id"]}, @{@"id": items[3][@"id"]}], @"baseNodeHash": plan[@"playlist"][@"sha256"]} options:0 error:NULL];
        [web request:[NSString stringWithFormat:@"/api/playlists/%@?node=N1", libraryID] method:@"PATCH" body:patch headers:@{@"Content-Type": @"application/json", @"If-Match": [NSString stringWithFormat:@"\"%@\"", registered[@"library"][@"version"]]}];

        rows = [engine compare]; n1 = RowNamed(rows, @"1부 예배");
        Check([n1[@"status"] isEqual:@"receive"] && [n1[@"orderChanged"] boolValue] && ![n1[@"macOrderChanged"] boolValue], @"server order change detected");
        Check([n1[@"documents"] count] == 1 && [n1[@"documents"][0][@"path"] isEqual:@"1부기도.pro6"] && [n1[@"macChangedDocuments"] count] == 0, @"only the edited document is received");
        Check([n1[@"missingServer"] integerValue] == 1, @"missing original still not a blocker");
        Check([RowNamed(rows, @"수요예배")[@"status"] isEqual:@"same"], @"other node untouched");

        // 3. 적용: 문서 바이트가 서버 v2가 되고, 순서는 바뀌고, 다른 노드 바이트는 그대로다.
        NSDictionary *result = [engine apply:@[n1]];
        Check([result[@"applied"] count] == 1 && [result[@"failed"] count] == 0, @"applied one node");
        Check([[NSData dataWithContentsOfFile:[docs stringByAppendingPathComponent:@"1부기도.pro6".decomposedStringWithCanonicalMapping]] isEqual:Doc(@"기도 웹 수정")], @"document bytes replaced");
        NSData *after = YBReadPlaylist(playlistURL);
        NSArray *order = [[YBPlaylistNode(after, @"N1")[@"items"] valueForKeyPath:@"attrs.displayName"] copy];
        Check([order isEqual:@[@"첫화면", @"오 신실하신 주", @"1부기도", @"새 찬양"]], @"node order replaced");
        Check([YBPlaylistNode(after, @"N2")[@"raw"] isEqual:YBPlaylistNode(local, @"N2")[@"raw"]], @"other node bytes identical");
        NSString *cuePath = YBPlaylistNode(after, @"N1")[@"items"][3][@"attrs"][@"filePath"];
        Check([cuePath isEqual:[docs stringByAppendingPathComponent:@"새 찬양.pro6"]], @"missing-original cue still points at the Mac file");
        NSString *backup = result[@"backup"];
        Check([[NSData dataWithContentsOfFile:[backup stringByAppendingPathComponent:@"documents/1부기도.pro6"]] isEqual:Doc(@"기도 원본")], @"previous document kept in backup");
        Check(![NSFileManager.defaultManager fileExistsAtPath:[profile stringByAppendingPathComponent:@"apply-journal.json"]], @"journal cleared");
        Check([[engine.receipt document:@"1부기도.pro6"][@"version"] isEqual:prayerV2[@"version"]], @"receipt updated to server version");

        // 4. 다시 비교: 모두 같음. 적용한 노드의 경로 표기(절대경로)가 서버 표기와 달라도 변경으로 보지 않는다.
        rows = [engine compare];
        Check([RowNamed(rows, @"1부 예배")[@"status"] isEqual:@"same"], @"same after apply");

        // 5. Mac에서만 찬양 가사를 고침: 서버는 그대로이므로 건드리지 않는다(올리기는 2차).
        Check([Doc(@"찬양 1 Mac 수정") writeToFile:[docs stringByAppendingPathComponent:@"오 신실하신 주.pro6".decomposedStringWithCanonicalMapping] atomically:YES], @"mac edit");
        rows = [engine compare]; n1 = RowNamed(rows, @"1부 예배");
        Check([n1[@"status"] isEqual:@"mac"] && [n1[@"macOnlyDocuments"] isEqual:@[@"오 신실하신 주.pro6"]] && [n1[@"documents"] count] == 0, @"mac-only edit left alone");

        // 6. 그 사이 웹에서도 같은 문서를 고침: 서버를 적용하고 Mac 것은 백업으로 남긴다.
        [web upload:Doc(@"찬양 1 웹 수정") path:@"오 신실하신 주.pro6" previous:server[@"오 신실하신 주"]];
        rows = [engine compare]; n1 = RowNamed(rows, @"1부 예배");
        Check([n1[@"status"] isEqual:@"receive"] && [n1[@"macChangedDocuments"] isEqual:@[@"오 신실하신 주.pro6"]], @"both-sides change receives server and backs up Mac copy");
        result = [engine apply:@[n1]];
        Check([[NSData dataWithContentsOfFile:[docs stringByAppendingPathComponent:@"오 신실하신 주.pro6".decomposedStringWithCanonicalMapping]] isEqual:Doc(@"찬양 1 웹 수정")], @"server copy applied");
        Check([[NSData dataWithContentsOfFile:[result[@"backup"] stringByAppendingPathComponent:@"documents/오 신실하신 주.pro6"]] isEqual:Doc(@"찬양 1 Mac 수정")], @"Mac copy backed up");

        // 7. PP6가 켜져 있으면 적용하지 않는다.
        engine.presenterRunning = ^BOOL { return YES; };
        BOOL refused = NO; @try { [engine apply:@[n1]]; } @catch (NSException *e) { refused = [e.reason containsString:@"ProPresenter"]; }
        Check(refused, @"apply refused while PP6 runs");

        printf("Sync 2 engine checks passed: %d\n", checks);
        [engine.receipt close];
        [NSFileManager.defaultManager removeItemAtPath:area error:NULL];
        return 0;
    } @catch (NSException *e) {
        fprintf(stderr, "SYNC2 FAIL after %d checks: %s\n", checks, e.reason.UTF8String);
        return 1;
    }
} }
