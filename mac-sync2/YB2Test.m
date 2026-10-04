#import "YB2Engine.h"
#import "YB2Server.h"
#import "../mac-app/YBPlaylistFormat.h"
#import "../mac-app/YBPlaylistIO.h"

// Sync 2 엔진 통합 검사. 로컬 Worker(test-server2.mjs)가 띄운 주소를 받아 실제 API로 돈다.
static int checks = 0;
static void Check(BOOL ok, NSString *message) { checks++; YBRequire(ok, message); }
static NSData *Doc(NSString *text) { return [[NSString stringWithFormat:@"<?xml version=\"1.0\" encoding=\"UTF-8\"?><RVPresentationDocument versionNumber=\"600\" category=\"예배순서\"><text>%@</text></RVPresentationDocument>", text] dataUsingEncoding:NSUTF8StringEncoding]; }
// PP6가 송출하며 루트에 남기는 사용일·사용 횟수. 나머지 바이트는 Doc()과 같다.
static NSData *DocUsed(NSString *text, NSString *used, int count) { return [[NSString stringWithFormat:@"<?xml version=\"1.0\" encoding=\"UTF-8\"?><RVPresentationDocument versionNumber=\"600\" category=\"예배순서\" lastDateUsed=\"%@\" usedCount=\"%d\"><text>%@</text></RVPresentationDocument>", used, count, text] dataUsingEncoding:NSUTF8StringEncoding]; }
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
static NSString *NodeXML(NSString *root, NSArray *cues) {
    NSMutableString *xml = [NSMutableString stringWithString:@"<RVPlaylistNode UUID=\"N1\" displayName=\"1부 예배\" modifiedDate=\"2026-10-01T00:00:00Z\">\n"];
    for (NSArray *cue in cues) [xml appendString:Cue(cue[0], cue[1], root)];
    [xml appendString:@"    </RVPlaylistNode>"];
    return xml;
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

        YB2Server *mac = [[YB2Server alloc] initWithOrigin:origin allowLocalTestServer:YES]; YBServer *web = [[YBServer alloc] initWithOrigin:origin allowLocalTestServer:YES];
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
        Check([result[@"revisions"] integerValue] == 1 && [result[@"revisionFailed"] count] == 0, @"Mac copy also kept as a server revision");

        // ── 2차: 올리기·되돌림·보관본·사용일·변경 일지·장치 열쇠 ──
        NSString *(^Local)(NSString *) = ^NSString *(NSString *name) { return [docs stringByAppendingPathComponent:[name stringByAppendingString:@".pro6"].decomposedStringWithCanonicalMapping]; };
        NSDictionary *(^Plan)(void) = ^NSDictionary *{ return [web request:[NSString stringWithFormat:@"/api/playlists/%@/plan?node=N1", libraryID] method:@"GET" body:nil headers:nil]; };
        NSDictionary *(^Meta)(NSString *) = ^NSDictionary *(NSString *path) { for (NSDictionary *d in Plan()[@"documents"]) if ([d[@"path"] isEqual:path]) return d; return nil; };
        NSArray *(^Revisions)(NSString *) = ^NSArray *(NSString *entity) { return [web request:[@"/api/sync/revisions?entity=" stringByAppendingString:Query(entity)] method:@"GET" body:nil headers:nil][@"revisions"]; };

        // 8. 사용 기록만 바뀜(PP6 송출): 내용 변경이 아니다. 사용일만 보고하고 서버 버전은 그대로.
        Check([DocUsed(@"첫화면", @"2026-10-05T09:00:00+09:00", 3) writeToFile:Local(@"첫화면") atomically:YES], @"usage edit");
        rows = [engine compare]; n1 = RowNamed(rows, @"1부 예배");
        Check([n1[@"status"] isEqual:@"mac"] && [n1[@"usageOnly"] count] == 1 && [n1[@"macOnlyDocuments"] count] == 0 && [n1[@"documents"] count] == 0, @"usage-only change is not a content change");
        NSDictionary *up = [engine upload:rows];
        Check([up[@"usage"] integerValue] == 1 && [up[@"failed"] count] == 0, @"usage reported once for a document shared by two services");
        NSDictionary *first = [web head:server[@"첫화면"]];
        Check([first[@"version"] isEqual:@1] && [first[@"lastDateUsed"] isEqual:@"2026-10-05T00:00:00.000Z"], @"server usage updated without a version");
        rows = [engine compare];
        Check([RowNamed(rows, @"1부 예배")[@"status"] isEqual:@"same"] && [RowNamed(rows, @"수요예배")[@"status"] isEqual:@"same"], @"same after usage report");

        // 9. Mac에서만 내용 수정: 서버 새 버전, 저장자는 Mac 이름.
        Check([Doc(@"기도 교회 수정") writeToFile:Local(@"1부기도") atomically:YES], @"mac content edit");
        rows = [engine compare]; n1 = RowNamed(rows, @"1부 예배");
        Check([n1[@"status"] isEqual:@"mac"] && [n1[@"macOnlyDocuments"] isEqual:@[@"1부기도.pro6"]], @"mac-only content edit");
        up = [engine upload:rows];
        Check([up[@"uploaded"] isEqual:@[@"1부 예배"]] && [up[@"failed"] count] == 0, @"content uploaded");
        NSDictionary *prayerV3 = [web head:prayerV2];
        Check([prayerV3[@"version"] isEqual:@3] && [prayerV3[@"updatedBy"] isEqual:@"교회 Mac"] && [prayerV3[@"sha256"] isEqual:YBHash(Doc(@"기도 교회 수정"))], @"server holds the Mac version");
        Check([RowNamed([engine compare], @"1부 예배")[@"status"] isEqual:@"same"], @"same after content upload");

        // 10. Mac에서만 순서 변경: 그 예배 노드만 서버에서 교체한다.
        NSArray *macOrder = @[@[@"C-2", @"1부기도"], @[@"C-1", @"첫화면"], @[@"C-3", @"오 신실하신 주"], @[@"C-4", @"새 찬양"]];
        Check([YBPlaylistReplacing(YBReadPlaylist(playlistURL), @"N1", NodeXML(docs, macOrder)) writeToFile:playlistURL.path atomically:YES], @"mac reorder");
        rows = [engine compare]; n1 = RowNamed(rows, @"1부 예배");
        Check([n1[@"status"] isEqual:@"mac"] && [n1[@"macOnlyOrder"] boolValue] && ![n1[@"orderChanged"] boolValue], @"mac-only order change");
        NSData *n2Before = [YBPlaylistNode(YBReadPlaylist(playlistURL), @"N2")[@"raw"] dataUsingEncoding:NSUTF8StringEncoding];
        up = [engine upload:rows];
        Check([up[@"uploaded"] isEqual:@[@"1부 예배"]], @"order uploaded");
        Check([[Plan()[@"items"] valueForKey:@"id"] isEqual:@[@"C-2", @"C-1", @"C-3", @"C-4"]], @"server node replaced");
        Check([[YBPlaylistNode(YBReadPlaylist(playlistURL), @"N2")[@"raw"] dataUsingEncoding:NSUTF8StringEncoding] isEqual:n2Before], @"upload does not touch Mac files");
        Check([RowNamed([engine compare], @"1부 예배")[@"status"] isEqual:@"same"], @"same after order upload");

        // 11. 양쪽에서 순서 변경: 서버 순서를 적용하고 Mac 순서는 서버 보관본으로. 그 뒤 PP6가 옛 순서를 다시 쓰면 되돌림이다.
        NSDictionary *webPlan = Plan();
        NSData *reorder = [NSJSONSerialization dataWithJSONObject:@{@"items": @[@{@"id": @"C-1"}, @{@"id": @"C-2"}, @{@"id": @"C-3"}, @{@"id": @"C-4"}], @"baseNodeHash": webPlan[@"playlist"][@"sha256"]} options:0 error:NULL];
        [web request:[NSString stringWithFormat:@"/api/playlists/%@?node=N1", libraryID] method:@"PATCH" body:reorder headers:@{@"Content-Type": @"application/json", @"If-Match": [NSString stringWithFormat:@"\"%@\"", webPlan[@"library"][@"version"]]}];
        NSString *oldMacOrder = NodeXML(docs, @[@[@"C-3", @"오 신실하신 주"], @[@"C-1", @"첫화면"], @[@"C-2", @"1부기도"], @[@"C-4", @"새 찬양"]]);
        Check([YBPlaylistReplacing(YBReadPlaylist(playlistURL), @"N1", oldMacOrder) writeToFile:playlistURL.path atomically:YES], @"mac reorder again");
        rows = [engine compare]; n1 = RowNamed(rows, @"1부 예배");
        Check([n1[@"status"] isEqual:@"receive"] && [n1[@"orderChanged"] boolValue] && [n1[@"macOrderChanged"] boolValue], @"both-sides order change receives the server order");
        result = [engine apply:@[n1]];
        NSString *nodeEntity = [libraryID stringByAppendingString:@":N1"];
        Check([result[@"revisions"] integerValue] == 1 && [result[@"revisionFailed"] count] == 0 && Revisions(nodeEntity).count == 1, @"Mac order kept as a server revision");
        Check([[[YBPlaylistNode(YBReadPlaylist(playlistURL), @"N1")[@"items"] valueForKeyPath:@"attrs.UUID"] copy] isEqual:@[@"C-1", @"C-2", @"C-3", @"C-4"]], @"server order applied");
        Check([YBPlaylistReplacing(YBReadPlaylist(playlistURL), @"N1", oldMacOrder) writeToFile:playlistURL.path atomically:YES], @"PP6 rewrites the replaced order");
        rows = [engine compare]; n1 = RowNamed(rows, @"1부 예배");
        Check([n1[@"status"] isEqual:@"receive"] && [n1[@"revertedOrder"] boolValue] && ![n1[@"macOrderChanged"] boolValue] && ![n1[@"macOnlyOrder"] boolValue], @"rewritten old order is detected as a revert, not a Mac edit");
        result = [engine apply:@[n1]];
        Check([result[@"revisions"] integerValue] == 0 && Revisions(nodeEntity).count == 1, @"a revert is not uploaded");
        Check([RowNamed([engine compare], @"1부 예배")[@"status"] isEqual:@"same"], @"same after re-applying");

        // 12. 같은 문서를 웹과 Mac에서 고침: 서버 것을 적용하고 Mac 것은 서버 보관본(+ Mac 백업).
        NSDictionary *song = Meta(@"오 신실하신 주.pro6");
        Check([Doc(@"찬양 1 교회 수정") writeToFile:Local(@"오 신실하신 주") atomically:YES], @"mac edit song");
        [web upload:Doc(@"찬양 1 웹 다시") path:@"오 신실하신 주.pro6" previous:song];
        rows = [engine compare]; n1 = RowNamed(rows, @"1부 예배");
        Check([n1[@"status"] isEqual:@"receive"] && [n1[@"macChangedDocuments"] isEqual:@[@"오 신실하신 주.pro6"]] && [n1[@"macChangedReasons"][@"오 신실하신 주.pro6"] isEqual:@"both-changed"], @"both-sides document change");
        result = [engine apply:@[n1]];
        NSArray *songRevisions = Revisions(song[@"id"]);
        // 6번의 양쪽 수정도 보관본을 남겼으므로 이 문서의 보관본은 둘이다.
        NSArray *macCopies = [songRevisions filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"sha256 == %@ AND reason == 'both-changed'", YBHash(Doc(@"찬양 1 교회 수정"))]];
        Check([result[@"revisions"] integerValue] == 1 && songRevisions.count == 2 && macCopies.count == 1, @"Mac copy kept on the server");
        Check([[NSData dataWithContentsOfFile:Local(@"오 신실하신 주")] isEqual:Doc(@"찬양 1 웹 다시")], @"server copy applied");

        // 13. 받아 덮을 때 Mac의 사용일·사용 횟수는 유지한다. 사용일만 다른 Mac 파일은 백업·보관본 대상이 아니다.
        [web upload:Doc(@"첫화면 웹") path:@"첫화면.pro6" previous:first];
        rows = [engine compare]; n1 = RowNamed(rows, @"1부 예배"); NSDictionary *n2 = RowNamed(rows, @"수요예배");
        Check([n1[@"status"] isEqual:@"receive"] && [n1[@"documents"] count] == 1 && [n1[@"macChangedDocuments"] count] == 0, @"Mac copy that only differs in usage is received without a revision");
        result = [engine apply:@[n1, n2]];
        Check([result[@"revisions"] integerValue] == 0 && [[NSData dataWithContentsOfFile:Local(@"첫화면")] isEqual:DocUsed(@"첫화면 웹", @"2026-10-05T09:00:00+09:00", 3)], @"server content with the Mac usage kept");
        rows = [engine compare];
        Check([RowNamed(rows, @"1부 예배")[@"status"] isEqual:@"same"] && [RowNamed(rows, @"수요예배")[@"status"] isEqual:@"same"], @"same after usage-keeping apply");

        // 14. 변경 일지: 처음엔 번호만, 바뀐 것이 없으면 비교하지 않음, 이 예배의 문서가 바뀌면 비교, 무관한 문서는 무시.
        NSDictionary *check = [engine checkChanges];
        Check([check[@"relevant"] boolValue] && [check[@"head"] integerValue] > 0, @"first check takes the head only");
        [engine markSeen:check[@"head"]];
        Check(![[engine checkChanges][@"relevant"] boolValue], @"nothing new since head");
        [web upload:Doc(@"무관한 광고") path:@"광고 보관.pro6" previous:nil];
        check = [engine checkChanges];
        Check(![check[@"relevant"] boolValue], @"a document outside the services is ignored");
        [engine markSeen:check[@"head"]];
        NSDictionary *prayerV4 = [web upload:Doc(@"기도 웹 넷째") path:@"1부기도.pro6" previous:prayerV3];
        check = [engine checkChanges];
        Check([check[@"relevant"] boolValue], @"a used document change triggers a compare");

        // 15. 장치 열쇠: 비밀번호 세션으로 발급, 열쇠만으로 비교·적용 보고.
        NSString *token = [mac registerDevice:@"교회 Mac"];
        Check([token hasPrefix:@"ybd_"] && [mac.deviceID length] == 32, @"device key issued");
        YB2Server *keyOnly = [[YB2Server alloc] initWithOrigin:origin allowLocalTestServer:YES]; keyOnly.deviceToken = token;
        Check(keyOnly.cookie == nil, @"key-only server has no cookie");
        [engine.receipt close];
        YB2Engine *resident = [[YB2Engine alloc] initWithServer:keyOnly root:docs playlist:playlistURL profile:profile];
        resident.presenterRunning = ^BOOL { return NO; };
        rows = [resident compare]; n1 = RowNamed(rows, @"1부 예배");
        Check([n1[@"status"] isEqual:@"receive"] && [n1[@"documents"][0][@"version"] isEqual:prayerV4[@"version"]], @"device key compares");
        [resident reportApplied:check[@"head"] rows:rows];
        NSDictionary *device = [web request:@"/api/sync/devices" method:@"GET" body:nil headers:nil][@"devices"][0];
        Check([device[@"appliedSeq"] isEqual:check[@"head"]] && [device[@"pending"] count] == 1 && [device[@"pending"][0][@"entity"] isEqual:nodeEntity], @"applied report with the waiting service");
        result = [resident apply:@[n1]];
        Check([result[@"applied"] count] == 1, @"device key applies");
        engine = resident;

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
