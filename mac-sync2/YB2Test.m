#import "YB2Engine.h"
#import "PP6Core.h"
#import "YB2Server.h"
#import "YBPlaylistFormat.h"
#import "YBPlaylistIO.h"

// Sync 2 엔진 통합 검사. 로컬 Worker(test-server2.mjs)가 띄운 주소를 받아 실제 API로 돈다.
static int checks = 0;
static void Check(BOOL ok, NSString *message) { checks++; YBRequire(ok, message); }
static NSData *Doc(NSString *text) { return [[NSString stringWithFormat:@"<?xml version=\"1.0\" encoding=\"UTF-8\"?><RVPresentationDocument versionNumber=\"600\" category=\"예배순서\"><text>%@</text></RVPresentationDocument>", text] dataUsingEncoding:NSUTF8StringEncoding]; }
// PP6가 송출하며 루트에 남기는 사용일·사용 횟수. 나머지 바이트는 Doc()과 같다.
static NSData *DocUsed(NSString *text, NSString *used, int count) { return [[NSString stringWithFormat:@"<?xml version=\"1.0\" encoding=\"UTF-8\"?><RVPresentationDocument versionNumber=\"600\" category=\"예배순서\" lastDateUsed=\"%@\" usedCount=\"%d\"><text>%@</text></RVPresentationDocument>", used, count, text] dataUsingEncoding:NSUTF8StringEncoding]; }
// 글상자 RTF가 든 문서. declaration은 앞에 붙일 XML 선언(없으면 @"").
static NSData *RTFDoc(NSString *declaration, NSArray *rtfs) {
    NSMutableString *boxes = [NSMutableString string];
    for (NSString *rtf in rtfs) [boxes appendFormat:@"<RVTextElement displayName=\"Default\"><NSString rvXMLIvarName=\"RTFData\">%@</NSString></RVTextElement>", [[rtf dataUsingEncoding:NSASCIIStringEncoding] base64EncodedStringWithOptions:0]];
    return [[NSString stringWithFormat:@"%@<RVPresentationDocument versionNumber=\"600\" category=\"예배순서\"><RVDisplaySlide UUID=\"S1\">%@</RVDisplaySlide></RVPresentationDocument>", declaration, boxes] dataUsingEncoding:NSUTF8StringEncoding];
}
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

        // 15'. 현황·원격 지원(장치 열쇠만). 명령 보내기는 관리자 몫이라 Worker 검사(remote-support.test.mjs)가 맡는다.
        [keyOnly postStatus:@{@"summary": @"받을 예배 1개", @"presenter": @NO, @"rows": @[@{@"node": n1[@"key"] ?: @"", @"name": @"1부 예배", @"status": @"receive"}]}];
        device = [web request:@"/api/sync/devices" method:@"GET" body:nil headers:nil][@"devices"][0];
        Check([device[@"status"][@"summary"] isEqual:@"받을 예배 1개"] && [device[@"statusAt"] length] > 0, @"status report visible on the web");
        NSDictionary *idle = [keyOnly takeCommands];
        Check([idle[@"commands"] count] == 0 && [idle[@"supportUntil"] isKindOfClass:NSNull.class], @"no commands outside the support window");
        NSString *until = [keyOnly openSupport:30];
        Check(until.length > 0 && [[keyOnly takeCommands][@"supportUntil"] isEqual:until], @"support window opens for the device");
        BOOL closedCommand = NO; @try { [keyOnly finishCommand:NSUUID.UUID.UUIDString.lowercaseString state:@"done" message:@""]; } @catch (NSException *e) { closedCommand = [e.reason hasPrefix:@"HTTP 409"]; }
        Check(closedCommand, @"result for a command never taken is refused");
        [keyOnly closeSupport];
        Check([[keyOnly takeCommands][@"supportUntil"] isKindOfClass:NSNull.class], @"support window closes");

        // ── 3차: 장부 사본·새 문서·서버 휴지통·이름 바꾸기·Mac 새 예배 ──
        NSDictionary *(^Post)(NSString *, id, NSDictionary *) = ^NSDictionary *(NSString *route, id body, NSDictionary *extra) {
            NSMutableDictionary *headers = [@{@"Content-Type": @"application/json"} mutableCopy]; [headers addEntriesFromDictionary:extra ?: @{}];
            return [web request:route method:@"POST" body:[NSJSONSerialization dataWithJSONObject:body options:0 error:NULL] headers:headers];
        };
        NSDictionary *(^LibraryTag)(void) = ^NSDictionary *{ return @{@"If-Match": [NSString stringWithFormat:@"\"%@\"", Plan()[@"library"][@"version"]]}; };
        NSArray *(^Sync)(void) = ^NSArray *{ NSDictionary *c = [engine checkChanges]; NSArray *r = [engine compare]; [engine markSeen:c[@"head"]]; return r; };
        NSString *trashBin = [area stringByAppendingPathComponent:@"Trash"];
        [NSFileManager.defaultManager createDirectoryAtPath:trashBin withIntermediateDirectories:YES attributes:nil error:NULL];
        engine.trashItem = ^NSString *(NSString *absolute) {
            NSString *target = [trashBin stringByAppendingPathComponent:absolute.lastPathComponent];
            return [NSFileManager.defaultManager moveItemAtPath:absolute toPath:target error:NULL] ? target : nil;
        };

        // 16. 장부 사본을 만들고, 서버에 없던 Mac 문서(새 문서·처음부터 원본이 없던 '새 찬양')를 올린다. 그 문서의 허용 폴더 이미지도 올린다.
        rows = Sync();
        Check([engine.receipt ledger:@"1부기도.pro6"] != nil && [[engine.receipt ledger:@"광고 보관.pro6"][@"state"] isEqual:@"active"], @"ledger copy built from the R2 ledger");
        NSString *mediaDir = @"/Users/Shared/Renewed Vision Media/YebaeOn", *imageName = [NSString stringWithFormat:@"sync2-test-%@.png", NSUUID.UUID.UUIDString];
        NSString *imagePath = [mediaDir stringByAppendingPathComponent:imageName];
        unsigned char png[] = {0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0};
        BOOL withImage = [NSFileManager.defaultManager createDirectoryAtPath:mediaDir withIntermediateDirectories:YES attributes:nil error:NULL] && [[NSData dataWithBytes:png length:sizeof png] writeToFile:imagePath atomically:YES];
        NSString *imageXML = withImage ? [NSString stringWithFormat:@"이미지 <RVImageElement source=\"file:///Users/Shared/Renewed%%20Vision%%20Media/YebaeOn/%@\"/>", imageName] : @"이미지 없음";
        Check([Doc(imageXML) writeToFile:Local(@"새 문서") atomically:YES], @"new mac document");
        NSDictionary *created = [engine uploadNew];
        Check([[NSSet setWithArray:created[@"created"]] isEqual:[NSSet setWithArray:@[@"새 문서.pro6", @"새 찬양.pro6"]]] && [created[@"failed"] count] == 0, @"new Mac documents uploaded once");
        Check([[engine uploadNew][@"created"] count] == 0, @"no second upload");
        if (withImage) {
            Check([created[@"media"] integerValue] == 1, @"image referenced by the new document uploaded");
            NSArray *paths = [web request:@"/api/media/paths" method:@"GET" body:nil headers:nil][@"paths"];
            Check([[paths valueForKey:@"path"] containsObject:imagePath], @"image path registered");
            [NSFileManager.defaultManager removeItemAtPath:imagePath error:NULL];
        }
        NSDictionary *(^ServerDoc)(NSString *) = ^NSDictionary *(NSString *path) {
            NSDictionary *found = [web request:[@"/api/documents?checkPath=" stringByAppendingString:Query(path)] method:@"GET" body:nil headers:nil];
            Check(![found[@"available"] boolValue], [@"server has " stringByAppendingString:path]);
            for (NSDictionary *d in [web request:[@"/api/documents?q=" stringByAppendingString:Query([path stringByDeletingPathExtension])] method:@"GET" body:nil headers:nil][@"documents"]) if ([d[@"path"] isEqual:path]) return d;
            return nil;
        };
        NSDictionary *newDoc = ServerDoc(@"새 문서.pro6");
        Check(newDoc && [newDoc[@"updatedBy"] isEqual:@"교회 Mac"], @"new document stored by the Mac");

        // 17. 웹에서 문서 이름 바꾸기 → Mac은 [적용] 때 파일 이름을 바꾸고 모든 예배의 참조를 고친다.
        NSDictionary *prayer = Meta(@"1부기도.pro6");
        Post([NSString stringWithFormat:@"/api/documents/%@/rename", prayer[@"id"]], @{@"path": @"1부 기도문.pro6"}, @{@"If-Match": [NSString stringWithFormat:@"\"%@\"", prayer[@"version"]]});
        rows = Sync(); NSDictionary *actions = RowNamed(rows, @"문서 정리(서버)");
        Check([actions[@"status"] isEqual:@"actions"] && [actions[@"renames"] count] == 1 && [actions[@"renames"][0][@"to"] isEqual:@"1부 기도문.pro6"], @"server rename waits for apply");
        Check([NSFileManager.defaultManager fileExistsAtPath:Local(@"1부기도")], @"compare does not rename");
        result = [engine apply:@[actions]];
        Check([result[@"failed"] count] == 0 && ![NSFileManager.defaultManager fileExistsAtPath:Local(@"1부기도")] && [NSFileManager.defaultManager fileExistsAtPath:Local(@"1부 기도문")], @"file renamed on apply");
        NSString *renamedCue = nil;
        for (NSDictionary *cue in YBPlaylistNode(YBReadPlaylist(playlistURL), @"N1")[@"items"]) if ([cue[@"attrs"][@"filePath"] hasSuffix:@"기도문.pro6"]) renamedCue = cue[@"attrs"][@"displayName"];
        Check([renamedCue isEqual:@"1부 기도문"], @"playlist reference and cue name follow the rename");
        rows = Sync();
        Check(RowNamed(rows, @"문서 정리(서버)") == nil && [RowNamed(rows, @"1부 예배")[@"status"] isEqual:@"same"], @"same after rename");
        Check([engine.receipt document:@"1부 기도문.pro6"] != nil && [engine.receipt document:@"1부기도.pro6"] == nil, @"receipt follows the rename");

        // 17-1. Mac에서 이름만 바꾼 문서: 바이트가 같은 "옛 경로 사라짐 + 새 경로 생김"은 새 문서가 아니라 서버 이름 바꾸기로 올린다(id 유지).
        Check([Doc(@"이름 시험") writeToFile:Local(@"이름 시험") atomically:YES], @"document to rename on the mac");
        Check([[engine uploadNew][@"created"] isEqual:@[@"이름 시험.pro6"]], @"document before the mac rename uploaded");
        NSString *renameID = [engine.receipt ledger:@"이름 시험.pro6"][@"id"];
        Check([NSFileManager.defaultManager moveItemAtPath:Local(@"이름 시험") toPath:Local(@"이름 바꾼 시험") error:NULL], @"mac renames the file");
        NSDictionary *macRename = [engine uploadNew];
        Check([macRename[@"created"] count] == 0 && [macRename[@"renamed"] count] == 1 && [macRename[@"renamed"][0][@"to"] isEqual:@"이름 바꾼 시험.pro6"] && [macRename[@"failed"] count] == 0, @"mac rename sent as a rename, not a new document");
        Check([[web request:[@"/api/documents/" stringByAppendingString:renameID] method:@"GET" body:nil headers:nil][@"document"][@"path"] isEqual:@"이름 바꾼 시험.pro6"], @"server keeps the id under the new name");
        Check([[web request:[@"/api/documents?checkPath=" stringByAppendingString:Query(@"이름 시험.pro6")] method:@"GET" body:nil headers:nil][@"available"] boolValue], @"old name freed on the server");
        Check([engine.receipt document:@"이름 바꾼 시험.pro6"] != nil && [engine.receipt document:@"이름 시험.pro6"] == nil && [[engine.receipt ledger:@"이름 바꾼 시험.pro6"][@"id"] isEqual:renameID], @"receipt and ledger follow the mac rename");
        rows = Sync();
        Check(RowNamed(rows, @"문서 정리(서버)") == nil && [[engine uploadNew][@"created"] count] == 0, @"own rename leaves nothing to apply or upload");

        // 18. 웹에서 휴지통: 예배가 아직 쓰는 문서는 두고, 안 쓰는 문서는 [적용] 때 macOS 휴지통으로.
        NSDictionary *opening = Meta(@"첫화면.pro6");
        Post([NSString stringWithFormat:@"/api/documents/%@/state", opening[@"id"]], @{@"action": @"trash"}, nil);
        Post([NSString stringWithFormat:@"/api/documents/%@/state", newDoc[@"id"]], @{@"action": @"trash"}, nil);
        rows = Sync(); actions = RowNamed(rows, @"문서 정리(서버)");
        Check([actions[@"trashes"] count] == 1 && [actions[@"trashes"][0][@"path"] isEqual:@"새 문서.pro6"] && [actions[@"actionHolds"] count] == 1, @"a document still used by a service is held");
        result = [engine apply:@[actions]];
        Check(![NSFileManager.defaultManager fileExistsAtPath:Local(@"새 문서")] && [NSFileManager.defaultManager fileExistsAtPath:[trashBin stringByAppendingPathComponent:[@"새 문서.pro6" decomposedStringWithCanonicalMapping]]] , @"unused document moved to the trash");
        Post([NSString stringWithFormat:@"/api/documents/%@/state", opening[@"id"]], @{@"action": @"untrash"}, nil);
        rows = Sync();
        Check(RowNamed(rows, @"문서 정리(서버)") == nil, @"untrash cancels the waiting move");
        Check([[engine uploadNew][@"created"] count] == 0, @"a trashed server document is not uploaded again");

        // 18-1. 고아 그림: 관리자가 서버에서 휴지통에 넣으면 [적용] 때 서버가 알던 그대로인 파일만 macOS 휴지통으로 옮긴다. Mac 문서가 아직 쓰는 그림은 둔다.
        NSString *orphanPath = [mediaDir stringByAppendingPathComponent:[NSString stringWithFormat:@"sync2-orphan-%@.png", NSUUID.UUID.UUIDString]];
        NSString *usedPath = [mediaDir stringByAppendingPathComponent:[NSString stringWithFormat:@"sync2-orphan-used-%@.png", NSUUID.UUID.UUIDString]];
        unsigned char orphanBytes[] = {0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, 'o', 'r', 'p', 'h'}, usedBytes[] = {0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, 'u', 's', 'e', 'd'};
        if (withImage && [[NSData dataWithBytes:orphanBytes length:sizeof orphanBytes] writeToFile:orphanPath atomically:YES] && [[NSData dataWithBytes:usedBytes length:sizeof usedBytes] writeToFile:usedPath atomically:YES]) {
            NSString *(^ImageXML)(NSString *) = ^NSString *(NSString *path) { return [NSString stringWithFormat:@"<RVImageElement source=\"file://%@\"/>", [path stringByAddingPercentEncodingWithAllowedCharacters:NSCharacterSet.URLPathAllowedCharacterSet]]; };
            Check([[engine uploadMediaForDocuments:@[Doc([ImageXML(orphanPath) stringByAppendingString:ImageXML(usedPath)])]][@"registered"] integerValue] == 2, @"orphan test images registered");
            NSMutableURLRequest *login = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:[origin stringByAppendingString:@"/api/admin"]]];
            login.HTTPMethod = @"POST"; login.HTTPShouldHandleCookies = NO; login.HTTPBody = [NSJSONSerialization dataWithJSONObject:@{@"password": @"native-integration-only-admin"} options:0 error:NULL];
            [login setValue:web.cookie forHTTPHeaderField:@"Cookie"]; [login setValue:origin forHTTPHeaderField:@"Origin"]; [login setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
            __block NSString *adminCookie = nil; dispatch_semaphore_t loggedIn = dispatch_semaphore_create(0);
            [[NSURLSession.sharedSession dataTaskWithRequest:login completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
                NSDictionary *fields = [(NSHTTPURLResponse *)response allHeaderFields];
                for (NSString *key in fields) if ([key caseInsensitiveCompare:@"Set-Cookie"] == NSOrderedSame) adminCookie = [fields[key] componentsSeparatedByString:@";"].firstObject;
                dispatch_semaphore_signal(loggedIn);
            }] resume];
            dispatch_semaphore_wait(loggedIn, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC));
            Check([adminCookie hasPrefix:@"__Host-yebaeon-admin="], @"admin cookie for the orphan cleanup");
            NSDictionary *admin = @{@"Cookie": [NSString stringWithFormat:@"%@; %@", web.cookie, adminCookie]};
            NSDictionary *orphans = nil;
            for (int round = 0; round < 20; round++) {
                orphans = [web request:@"/api/admin/orphans" method:@"GET" body:nil headers:admin];
                if ([orphans[@"remaining"] integerValue] == 0) break;
                Post(@"/api/admin/orphans", @{@"index": @YES}, admin);
            }
            NSArray *candidatePaths = [orphans[@"candidates"] valueForKey:@"path"];
            Check([candidatePaths containsObject:orphanPath] && [candidatePaths containsObject:usedPath] && ![candidatePaths containsObject:imagePath], @"orphan candidates exclude images any server document uses");
            Check([Post(@"/api/admin/orphans", @{@"trash": @[orphanPath, usedPath]}, admin)[@"trashed"] integerValue] == 2, @"orphans trashed on the server");
            NSData *hymn = [NSData dataWithContentsOfFile:Local(@"오 신실하신 주")];
            Check([Doc([@"찬양 1 " stringByAppendingString:ImageXML(usedPath)]) writeToFile:Local(@"오 신실하신 주") atomically:YES], @"mac document starts using a trashed image");
            rows = Sync(); actions = RowNamed(rows, @"문서·그림 정리(서버)");
            Check([actions[@"status"] isEqual:@"actions"] && [actions[@"imageTrashes"] count] == 1 && [actions[@"imageTrashes"][0][@"path"] isEqual:orphanPath], @"server-trashed image waits for apply");
            Check([[actions[@"actionHolds"] valueForKey:@"path"] containsObject:usedPath], @"image still used on the mac is held");
            Check([NSFileManager.defaultManager fileExistsAtPath:orphanPath], @"compare does not trash images");
            result = [engine apply:@[actions]];
            Check([result[@"failed"] count] == 0 && ![NSFileManager.defaultManager fileExistsAtPath:orphanPath] && [NSFileManager.defaultManager fileExistsAtPath:[trashBin stringByAppendingPathComponent:orphanPath.lastPathComponent]], @"orphan image moved to the trash");
            Check([NSFileManager.defaultManager fileExistsAtPath:usedPath], @"held image stays");
            Check([hymn writeToFile:Local(@"오 신실하신 주") atomically:YES], @"mac document restored");
            [NSFileManager.defaultManager removeItemAtPath:usedPath error:NULL];
            rows = Sync();
            Check(RowNamed(rows, @"문서·그림 정리(서버)") == nil && RowNamed(rows, @"문서 정리(서버)") == nil, @"nothing left once the held image is gone");
        }

        // 19. 웹에서 예배를 휴지통에: [적용] 때 그 노드만 뺀다. 꺼내면 서버에 새로 생긴 예배로 다시 받는다.
        NSData *n1Raw = [YBPlaylistNode(YBReadPlaylist(playlistURL), @"N1")[@"raw"] dataUsingEncoding:NSUTF8StringEncoding];
        Post([NSString stringWithFormat:@"/api/playlists/%@/trash?node=N2", libraryID], @{}, LibraryTag());
        rows = Sync(); n2 = RowNamed(rows, @"수요예배");
        Check([n2[@"status"] isEqual:@"trash"], @"server trash shown, not applied");
        Check(YBPlaylistNode(YBReadPlaylist(playlistURL), @"N2") != nil, @"compare leaves the node");
        result = [engine apply:@[n2]];
        Check(YBPlaylistNode(YBReadPlaylist(playlistURL), @"N2") == nil && [[YBPlaylistNode(YBReadPlaylist(playlistURL), @"N1")[@"raw"] dataUsingEncoding:NSUTF8StringEncoding] isEqual:n1Raw], @"only the trashed node removed");
        Post([NSString stringWithFormat:@"/api/playlists/%@/untrash?node=N2", libraryID], @{}, LibraryTag());
        rows = Sync(); n2 = RowNamed(rows, @"수요예배");
        Check([n2[@"status"] isEqual:@"receive"] && [n2[@"serverNew"] boolValue] && ![n2[@"macDeleted"] boolValue], @"restored service comes back as new");
        result = [engine apply:@[n2]];
        Check(YBPlaylistNode(YBReadPlaylist(playlistURL), @"N2") != nil, @"restored node received");

        // 20. PP6에서 만든 예배는 서버에 없을 때만 더한다. Mac에서 지운 예배는 기본으로 되살리지 않는다.
        NSString *youth = [NSString stringWithFormat:@"<RVPlaylistNode UUID=\"N3\" displayName=\"청년 예배\">\n%@    </RVPlaylistNode>", Cue(@"C-Y1", @"첫화면", docs)];
        Check([YBPlaylistReplacing(YBReadPlaylist(playlistURL), @"N3", youth) writeToFile:playlistURL.path atomically:YES], @"mac creates a service");
        rows = Sync();
        Check([RowNamed(rows, @"청년 예배")[@"status"] isEqual:@"macNew"], @"mac-only service detected");
        up = [engine upload:rows];
        Check([up[@"uploaded"] containsObject:@"청년 예배"] && [up[@"failed"] count] == 0, @"mac service added to the server");
        rows = Sync();
        Check([RowNamed(rows, @"청년 예배")[@"status"] isEqual:@"same"], @"same after adding");
        Check([YBPlaylistRemoving(YBReadPlaylist(playlistURL), @"N3") writeToFile:playlistURL.path atomically:YES], @"mac deletes the service");
        rows = Sync(); NSDictionary *n3 = RowNamed(rows, @"청년 예배");
        Check([n3[@"status"] isEqual:@"receive"] && [n3[@"macDeleted"] boolValue], [NSString stringWithFormat:@"mac-deleted service is marked, not resurrected by default: %@ %@ %@ local=%@", n3[@"status"], n3[@"macDeleted"], n3[@"reason"], [YBPlaylistNodes(YBReadPlaylist(playlistURL)) valueForKey:@"id"]]);

        // 21. 예배 이름: 웹에서 바꾸면 받고, Mac에서 바꾸면 올린다.
        NSDictionary *webN1 = Plan();
        Post([NSString stringWithFormat:@"/api/playlists/%@/rename?node=N1", libraryID], @{@"name": @"주일 1부", @"baseNodeHash": webN1[@"playlist"][@"sha256"]}, nil);
        rows = Sync(); n1 = RowNamed(rows, @"주일 1부");
        Check([n1[@"status"] isEqual:@"receive"] && [n1[@"renamedFrom"] isEqual:@"1부 예배"], @"server service rename received");
        result = [engine apply:@[n1]];
        Check([YBPlaylistNode(YBReadPlaylist(playlistURL), @"N1")[@"name"] isEqual:@"주일 1부"], @"local service renamed");
        // 22. 마지막 적용 되돌리기: 21번의 서버 이름 받기를 되돌리면 Mac 이름이 돌아오고, 다음 비교는 받을 것으로 보인다(올리지 않는다).
        Check([engine lastApply] != nil, @"last apply recorded");
        NSDictionary *undone = [engine undoLastApply];
        Check([undone[@"restored"] containsObject:@"재생목록"] && [undone[@"skipped"] count] == 0, [NSString stringWithFormat:@"undo restored the playlist: %@", undone]);
        Check([YBPlaylistNode(YBReadPlaylist(playlistURL), @"N1")[@"name"] isEqual:@"1부 예배"], @"local name back");
        rows = Sync(); n1 = RowNamed(rows, @"주일 1부");
        Check([n1[@"status"] isEqual:@"receive"] && ![n1[@"macRenamed"] boolValue], [NSString stringWithFormat:@"undone apply shows as receivable again: %@ %@", n1[@"status"], n1[@"macRenamed"]]);
        Check([engine lastApply] == nil, @"only one level of undo");

        NSString *n2Raw = YBPlaylistNode(YBReadPlaylist(playlistURL), @"N2")[@"raw"];
        NSString *renamedN2 = [n2Raw stringByReplacingOccurrencesOfString:@"displayName=\"수요예배\"" withString:@"displayName=\"수요 저녁\""];
        Check(![renamedN2 isEqual:n2Raw] && [YBPlaylistReplacing(YBReadPlaylist(playlistURL), @"N2", renamedN2) writeToFile:playlistURL.path atomically:YES], @"mac renames a service");
        rows = Sync(); n2 = RowNamed(rows, @"수요예배");
        Check([n2[@"status"] isEqual:@"mac"] && [n2[@"macRenamed"] boolValue], @"mac service rename detected");
        up = [engine upload:rows];
        Check([up[@"failed"] count] == 0, @"mac rename uploaded");
        rows = Sync();
        Check([RowNamed(rows, @"수요 저녁")[@"status"] isEqual:@"same"], @"server follows the mac rename");

        // 23. 전체 확인: Mac에서 지운 문서·같은 이름 다른 내용·이미지 보충 후보를 목록으로만 만들고, 정리 창 버튼으로 처리한다.
        Check([NSFileManager.defaultManager removeItemAtPath:Local(@"새 찬양") error:NULL], @"mac deletes a document");
        Check([Doc(@"Mac의 광고") writeToFile:Local(@"광고 보관") atomically:YES], @"same name, different content");
        NSDictionary *full = [engine fullCheck];
        Check([[full[@"macDeleted"] valueForKey:@"path"] containsObject:@"새 찬양.pro6"], [NSString stringWithFormat:@"mac-deleted document listed: %@", full[@"macDeleted"]]);
        Check([[full[@"collisions"] valueForKey:@"path"] isEqual:@[@"광고 보관.pro6"]], [NSString stringWithFormat:@"collision listed: %@", full[@"collisions"]]);
        Check([NSFileManager.defaultManager fileExistsAtPath:Local(@"새 찬양")] == NO && [[NSData dataWithContentsOfFile:Local(@"광고 보관")] isEqual:Doc(@"Mac의 광고")], @"full check changes nothing");
        if (withImage) Check([[full[@"imageFill"] valueForKey:@"path"] containsObject:imagePath], @"missing image listed for fill");
        [engine trashOnServer:@"새 찬양.pro6"];
        NSString *songID = [engine.receipt ledger:@"새 찬양.pro6"][@"id"];
        Check([[web request:[@"/api/documents/" stringByAppendingString:songID] method:@"GET" body:nil headers:nil][@"document"][@"state"] isEqual:@"trashed"] && ![[[engine lastFullCheck][@"macDeleted"] valueForKey:@"path"] containsObject:@"새 찬양.pro6"], @"mac-deleted document sent to the server trash on request");
        NSString *numbered = [engine keepBothNumbered:@"광고 보관.pro6"];
        Check([numbered isEqual:@"광고 보관 2.pro6"] && [[NSData dataWithContentsOfFile:Local(@"광고 보관 2")] isEqual:Doc(@"Mac의 광고")] && [[NSData dataWithContentsOfFile:Local(@"광고 보관")] isEqual:Doc(@"무관한 광고")], @"numbered: both kept");
        Check(ServerDoc(@"광고 보관 2.pro6") != nil && [engine numberedLog].count == 1, @"numbered copy on the server and logged");
        if (withImage) {
            [engine fetchImage:@{@"path": imagePath, @"sha": YBHash([NSData dataWithBytes:png length:sizeof png])}];
            Check([[NSData dataWithContentsOfFile:imagePath] isEqual:[NSData dataWithBytes:png length:sizeof png]], @"image filled from the server");
            [NSFileManager.defaultManager removeItemAtPath:imagePath error:NULL];
        }

        // 24. 받을 예배가 가리키는, 이력 없는 다른 내용: [적용]해도 Mac 파일을 그대로 두고 정리 창으로 보낸다(번호를 붙이거나 덮지 않는다).
        Check([Doc(@"Mac 봉헌") writeToFile:Local(@"봉헌") atomically:YES], @"mac-only offering");
        [web upload:Doc(@"웹 봉헌") path:@"봉헌.pro6" previous:nil];
        NSDictionary *n2Plan = [web request:[NSString stringWithFormat:@"/api/playlists/%@/plan?node=N2", libraryID] method:@"GET" body:nil headers:nil];
        NSString *n2XML = n2Plan[@"playlist"][@"xml"]; NSRange close = [n2XML rangeOfString:@"</RVPlaylistNode>" options:NSBackwardsSearch];
        NSString *withOffering = [n2XML stringByReplacingCharactersInRange:NSMakeRange(close.location, 0) withString:Cue(@"C-W2", @"봉헌", docs)];
        [web request:[NSString stringWithFormat:@"/api/playlists/%@/nodes?node=N2", libraryID] method:@"PUT" body:[NSJSONSerialization dataWithJSONObject:@{@"xml": withOffering, @"baseNodeHash": n2Plan[@"playlist"][@"sha256"]} options:0 error:NULL] headers:@{@"Content-Type": @"application/json", @"X-YebaeOn-Sync": @"2"}];
        rows = Sync(); n2 = RowNamed(rows, @"수요 저녁");
        Check([n2[@"status"] isEqual:@"receive"] && [n2[@"macChangedReasons"][@"봉헌.pro6"] isEqual:@"technical"], [NSString stringWithFormat:@"name collision in a service: %@ %@", n2[@"status"], n2[@"macChangedReasons"]]);
        result = [engine apply:@[n2]];
        Check([result[@"held"] isEqual:@[@"봉헌.pro6"]] && [[NSData dataWithContentsOfFile:Local(@"봉헌")] isEqual:Doc(@"Mac 봉헌")] && ![NSFileManager.defaultManager fileExistsAtPath:Local(@"봉헌 2")], [NSString stringWithFormat:@"no-history difference held: %@", result]);
        Check([[[engine lastFullCheck][@"collisions"] valueForKey:@"path"] containsObject:@"봉헌.pro6"], @"held document listed for the organizer");
        NSString *offeringCue = nil;
        for (NSDictionary *cue in YBPlaylistNode(YBReadPlaylist(playlistURL), @"N2")[@"items"]) if ([cue[@"attrs"][@"filePath"] hasSuffix:@"봉헌.pro6"]) offeringCue = cue[@"attrs"][@"filePath"];
        Check(offeringCue != nil, @"service order still applied");

        // 25. 이미지 참조 표기만 다른 첫 대조: PP6가 다시 저장한 `file://…%20…`과 서버의 평문 경로는 같은 내용이다(정리 창에 올리지 않고 영수증에 적는다).
        //     경로 자체가 다르면 여전히 다른 내용이다.
        NSString *urlForm = @"<media source=\"file:///Users/Shared/Renewed%20Vision%20Media/Images/%EC%B0%AC%EC%96%91%20%EB%B0%B0%EA%B2%BD.jpg\"/>";
        NSString *plainForm = @"<media source=\"/Users/Shared/Renewed Vision Media/Images/찬양 배경.jpg\"/>";
        NSString *otherForm = @"<media source=\"/Users/Shared/Renewed Vision Media/Images/다른 배경.jpg\"/>";
        Check([Doc([@"경로 찬양" stringByAppendingString:urlForm]) writeToFile:Local(@"경로 찬양") atomically:YES], @"mac copy with a file URL image");
        Check([Doc([@"경로 다름" stringByAppendingString:urlForm]) writeToFile:Local(@"경로 다름") atomically:YES], @"mac copy with another image");
        [web upload:Doc([@"경로 찬양" stringByAppendingString:plainForm]) path:@"경로 찬양.pro6" previous:nil];
        [web upload:Doc([@"경로 다름" stringByAppendingString:otherForm]) path:@"경로 다름.pro6" previous:nil];
        //     macOS 파일 이름에서 온 자모가 풀린 경로(NFD)와 조합된 경로(NFC)도 같은 내용이다.
        NSString *nfdForm = [@"<media source=\"/Users/Shared/Renewed Vision Media/Images/찬양 배경.jpg\"/>" decomposedStringWithCanonicalMapping];
        Check([Doc([@"경로 자모" stringByAppendingString:urlForm]) writeToFile:Local(@"경로 자모") atomically:YES], @"mac copy for the NFD case");
        [web upload:Doc([@"경로 자모" stringByAppendingString:nfdForm]) path:@"경로 자모.pro6" previous:nil];
        Sync();
        full = [engine fullCheck];
        Check(![[full[@"collisions"] valueForKey:@"path"] containsObject:@"경로 자모.pro6"] && [full[@"remembered"] integerValue] >= 2, [NSString stringWithFormat:@"NFD and NFC paths are the same content: %@", full]);
        NSArray *collided = [full[@"collisions"] valueForKey:@"path"];
        Check(![collided containsObject:@"경로 찬양.pro6"] && [engine.receipt document:@"경로 찬양.pro6"] != nil, [NSString stringWithFormat:@"file URL and plain path are the same content: %@", collided]);
        Check([collided containsObject:@"경로 다름.pro6"], [NSString stringWithFormat:@"a different image path still differs: %@", collided]);

        // 26. RTF 표기만 다른 첫 대조: PP6가 다시 저장한 꼴(XML 선언 없음, \uc1 없음, 빈 글상자에 서식 없음)과
        //     정리본 도구가 쓴 꼴은 같은 내용이다. 글자 크기를 바꾼 것은 여전히 다른 내용이다.
        NSString *head = @"{\\rtf1\\ansi\\ansicpg949\\cocoartf1561\\cocoasubrtf600\n{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;}\n{\\colortbl;\\red255\\green255\\blue255;}\n{\\*\\expandedcolortbl;;}\n\\pard\\pardeftab720\\slleading460\\qc\\partightenfactor0\n\n";
        NSString *macText = [head stringByAppendingString:@"\\f0\\b\\fs220 \\cf1 \\outl0\\strokewidth-100 \\strokec0 Holy\\\nHoly}"];
        NSString *toolText = [head stringByAppendingString:@"\\f0\\b\\fs220 \\cf1 \\outl0\\strokewidth-100 \\strokec0 \\uc1 Holy\\\nHoly}"];
        NSString *biggerText = [head stringByAppendingString:@"\\f0\\b\\fs240 \\cf1 \\outl0\\strokewidth-100 \\strokec0 \\uc1 Holy\\\nHoly}"];
        NSString *macEmpty = @"{\\rtf1\\ansi\\ansicpg949\\cocoartf1561\\cocoasubrtf600\n{\\fonttbl}\n{\\colortbl;\\red255\\green255\\blue255;}\n{\\*\\expandedcolortbl;;}\n}";
        NSString *toolEmpty = [head stringByAppendingString:@"\\f0\\b\\fs220 \\cf1 \\outl0\\strokewidth-100 \\strokec0 \\uc1 }"];
        Check([RTFDoc(@"", @[macText, macEmpty]) writeToFile:Local(@"서식 찬양") atomically:YES], @"PP6-saved RTF on the mac");
        Check([RTFDoc(@"", @[macText, macEmpty]) writeToFile:Local(@"서식 크기") atomically:YES], @"PP6-saved RTF for the size case");
        [web upload:RTFDoc(@"<?xml version='1.0' encoding='utf-8'?>\n", @[toolText, toolEmpty]) path:@"서식 찬양.pro6" previous:nil];
        [web upload:RTFDoc(@"<?xml version='1.0' encoding='utf-8'?>\n", @[biggerText, toolEmpty]) path:@"서식 크기.pro6" previous:nil];
        Sync();
        full = [engine fullCheck];
        collided = [full[@"collisions"] valueForKey:@"path"];
        Check(![collided containsObject:@"서식 찬양.pro6"] && [engine.receipt document:@"서식 찬양.pro6"] != nil, [NSString stringWithFormat:@"RTF notation differences are the same content: %@", collided]);
        Check([collided containsObject:@"서식 크기.pro6"], [NSString stringWithFormat:@"a font size change still differs: %@", collided]);

        // 27. 차이 창 읽기: PP6가 저장한 그룹 여러 개 문서(XML 선언 없음)도 장마다 자기 요소만 읽는다.
        NSString *(^Box)(NSString *) = ^NSString *(NSString *text) {
            return [NSString stringWithFormat:@"<RVTextElement displayName=\"Default\"><RVRect3D rvXMLIvarName=\"position\">{0 0 0 10 10}</RVRect3D><NSString rvXMLIvarName=\"RTFData\">%@</NSString></RVTextElement>", [[[head stringByAppendingFormat:@"\\f0 %@}", text] dataUsingEncoding:NSASCIIStringEncoding] base64EncodedStringWithOptions:0]]; };
        NSString *(^Slide)(NSString *, BOOL) = ^NSString *(NSString *text, BOOL background) {
            NSString *cue = background ? @"<RVMediaCue rvXMLIvarName=\"backgroundMediaCue\"><RVImageElement source=\"file:///Users/Shared/a.jpg\"><RVRect3D rvXMLIvarName=\"position\">{0 0 0 0 0}</RVRect3D></RVImageElement></RVMediaCue>" : @"";
            return [NSString stringWithFormat:@"<RVDisplaySlide UUID=\"%@\"><array rvXMLIvarName=\"cues\"></array>%@<array rvXMLIvarName=\"displayElements\">%@</array></RVDisplaySlide>", NSUUID.UUID.UUIDString, cue, Box(text)]; };
        NSString *grouped = [NSString stringWithFormat:@"<RVPresentationDocument versionNumber=\"600\" width=\"1920\" height=\"1080\"><array rvXMLIvarName=\"groups\"><RVSlideGrouping name=\"\"><array rvXMLIvarName=\"slides\">%@</array></RVSlideGrouping><RVSlideGrouping name=\"Verse 1\"><array rvXMLIvarName=\"slides\">%@%@</array></RVSlideGrouping></array><array rvXMLIvarName=\"arrangements\"></array></RVPresentationDocument>", Slide(@"One", YES), Slide(@"Two", NO), Slide(@"Three", YES)];
        NSDictionary *parsed = PP6ParseDocumentData([grouped dataUsingEncoding:NSUTF8StringEncoding], @"grouped.pro6", @[], @{}, @[], @{}, YES);
        NSMutableArray *perSlide = [NSMutableArray array];
        for (NSDictionary *group in parsed[@"groups"]) for (NSDictionary *slide in group[@"slides"]) [perSlide addObject:[NSString stringWithFormat:@"%lu/%lu", (unsigned long)[slide[@"texts"] count], (unsigned long)[slide[@"media"] count]]];
        Check([perSlide isEqual:@[@"1/1", @"1/0", @"1/1"]], [NSString stringWithFormat:@"each slide reads only its own elements: %@ %@", perSlide, parsed[@"parseError"] ?: @""]);

        // 28. 외부 참조 그림 가져오기: 그림을 YebaeOn/<문서이름>-1.png로 복사하고 문서 경로를 바꿔 서버에도 올린다. 원래 그림은 그대로.
        if (withImage) {
            NSString *outside = [area stringByAppendingPathComponent:@"바탕화면/포스터.png"];
            [NSFileManager.defaultManager createDirectoryAtPath:outside.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:NULL];
            Check([[NSData dataWithBytes:png length:sizeof png] writeToFile:outside atomically:YES], @"outside image");
            NSString *docName = [NSString stringWithFormat:@"외부 그림 %@", [NSUUID.UUID.UUIDString substringToIndex:6]];
            Check([Doc([NSString stringWithFormat:@"<RVImageElement source=\"%@\"/>", [NSURL fileURLWithPath:outside].absoluteString]) writeToFile:Local(docName) atomically:YES], @"document with an outside image");
            [engine uploadNew];
            NSString *docPath = [docName stringByAppendingString:@".pro6"];
            NSDictionary *imported = [engine importExternal:@{@"path": docPath, @"references": @[outside.precomposedStringWithCanonicalMapping]}];
            NSString *copied = [NSString stringWithFormat:@"/Users/Shared/Renewed Vision Media/YebaeOn/%@-1.png", docName];
            NSString *serverText = [[NSString alloc] initWithData:[engine serverBytes:docPath] encoding:NSUTF8StringEncoding];
            Check([imported[@"copied"] integerValue] == 1 && [imported[@"uploaded"] boolValue] && [NSFileManager.defaultManager fileExistsAtPath:copied] && [NSFileManager.defaultManager fileExistsAtPath:outside], [NSString stringWithFormat:@"outside image copied: %@", imported]);
            Check([serverText containsString:@"YebaeOn/"] && ![serverText containsString:@"%EB%B0%94%ED%83%95"] && ![serverText containsString:outside], [NSString stringWithFormat:@"server copy points at the copied image: %@", serverText]);
            NSArray *paths = [web request:@"/api/media/paths" method:@"GET" body:nil headers:nil][@"paths"];
            Check([[paths valueForKey:@"path"] containsObject:copied.precomposedStringWithCanonicalMapping], @"copied image registered");
            [NSFileManager.defaultManager removeItemAtPath:copied error:NULL];
            [NSFileManager.defaultManager removeItemAtPath:copied.decomposedStringWithCanonicalMapping error:NULL];
        }

        // 29. 번호 사본 지우기: 23번의 `광고 보관 2`를 Mac 휴지통·서버 휴지통으로 보내고 기록을 지운다. 재생목록이 가리키면 하지 않는다.
        NSDictionary *numberedItem = [engine numberedLog].firstObject;
        NSString *playlistText = [[NSString alloc] initWithData:YBReadPlaylist(playlistURL) encoding:NSUTF8StringEncoding] ?: @"";
        BOOL referenced = [playlistText containsString:@"광고 보관 2"] || [playlistText containsString:[@"광고 보관 2" stringByAddingPercentEncodingWithAllowedCharacters:NSCharacterSet.URLPathAllowedCharacterSet]];
        BOOL removeRefused = NO; @try { [engine removeNumbered:numberedItem]; } @catch (NSException *e) { removeRefused = [e.reason containsString:@"재생목록"]; }
        if (referenced) Check(removeRefused && [NSFileManager.defaultManager fileExistsAtPath:Local(@"광고 보관 2")], @"numbered copy still used by the playlist is kept");
        else {
            NSString *numberedID = [engine.receipt ledger:@"광고 보관 2.pro6"][@"id"];
            Check(!removeRefused && ![NSFileManager.defaultManager fileExistsAtPath:Local(@"광고 보관 2")] && [NSFileManager.defaultManager fileExistsAtPath:Local(@"광고 보관")], @"numbered copy moved to the Mac trash, original kept");
            Check([[web request:[@"/api/documents/" stringByAppendingString:numberedID] method:@"GET" body:nil headers:nil][@"document"][@"state"] isEqual:@"trashed"] && [engine numberedLog].count == 0, @"numbered copy trashed on the server and log cleared");
        }

        // 30. 오른쪽 클릭 강제 동작: Mac에서 지우기는 macOS 휴지통으로 옮기고 백업을 남긴다(서버는 그대로).
        Check([Doc(@"강제 지움") writeToFile:Local(@"강제 지움") atomically:YES], @"document to trash on the mac");
        [engine trashOnMac:@"강제 지움.pro6"];
        Check(![NSFileManager.defaultManager fileExistsAtPath:Local(@"강제 지움")] && [NSFileManager.defaultManager fileExistsAtPath:[trashBin stringByAppendingPathComponent:@"강제 지움.pro6"]], @"forced mac trash moves the file to the trash");

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
