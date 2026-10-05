#import "YB2Engine.h"
#import "YB2Server.h"

// 설명서 그림용 시험 자료. 로컬 Worker에 교회 Mac처럼 문서·재생목록을 올리고 맞춘 뒤, 웹에서 몇 문서와 순서를 바꿔 둔다.
// 곡 이름과 내용은 지어낸 예시다. 출력: 앱이 쓸 문서 폴더·재생목록·영수증 폴더(JSON).
static NSData *Doc(NSString *text) { return [[NSString stringWithFormat:@"<?xml version=\"1.0\" encoding=\"UTF-8\"?><RVPresentationDocument versionNumber=\"600\" category=\"예배순서\"><text>%@</text></RVPresentationDocument>", text] dataUsingEncoding:NSUTF8StringEncoding]; }
static NSString *Query(NSString *value) { return [value stringByAddingPercentEncodingWithAllowedCharacters:[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"]]; }

int main(int argc, const char *argv[]) { @autoreleasepool {
    @try {
        YBRequire(argc == 3, @"usage: yb2-capture-seed <origin> <password>");
        NSString *origin = [NSString stringWithUTF8String:argv[1]], *password = [NSString stringWithUTF8String:argv[2]];
        NSString *area = [[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Caches/yebaeon-manual-capture"] stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
        NSString *docs = [area stringByAppendingPathComponent:@"ProPresenter6"], *playlistDir = [area stringByAppendingPathComponent:@"Playlists"], *profile = [area stringByAppendingPathComponent:@"profile"];
        for (NSString *dir in @[docs, playlistDir, profile]) YBRequire([NSFileManager.defaultManager createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:NULL], @"folders");
        NSString *playlistPath = [playlistDir stringByAppendingPathComponent:@"기본 .pro6pl"];
        NSArray *nodes = @[@[@"N1", @"1부 예배(품성)", @[@"첫화면", @"사도신경", @"빛 되신 주", @"1부 기도", @"주일예배말씀", @"엔딩"]],
                           @[@"N2", @"2부 예배", @[@"첫화면", @"사도신경", @"빛 되신 주", @"새 아침의 노래", @"2부 기도", @"주일예배말씀", @"감사의 고백", @"엔딩"]],
                           @[@"N3", @"청년예배", @[@"첫화면", @"평안의 길", @"청년부 기도", @"청년부 말씀", @"엔딩"]],
                           @[@"N4", @"수요예배", @[@"첫화면", @"수요예배", @"엔딩"]]];
        YB2Server *mac = [[YB2Server alloc] initWithOrigin:origin allowLocalTestServer:YES], *web = [[YB2Server alloc] initWithOrigin:origin allowLocalTestServer:YES];
        [mac login:@"교회 Mac" password:password]; [web login:@"김예배" password:password];
        NSMutableDictionary *server = [NSMutableDictionary dictionary];
        NSMutableString *xml = [NSMutableString stringWithString:@"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<RVPlaylistDocument>\n  <RVPlaylistNode UUID=\"ROOT\" displayName=\"Playlists\">\n"];
        int cue = 0;
        for (NSArray *node in nodes) {
            [xml appendFormat:@"    <RVPlaylistNode UUID=\"%@\" displayName=\"%@\" modifiedDate=\"2026-10-04T00:00:00Z\">\n", node[0], node[1]];
            for (NSString *name in node[2]) {
                if (!server[name]) {
                    NSData *bytes = Doc(name);
                    YBRequire([bytes writeToFile:[docs stringByAppendingPathComponent:[name.decomposedStringWithCanonicalMapping stringByAppendingString:@".pro6"]] atomically:YES], @"local doc");
                    server[name] = [mac upload:bytes path:[name stringByAppendingString:@".pro6"] previous:nil];
                }
                [xml appendFormat:@"      <RVDocumentCue UUID=\"C-%d\" displayName=\"%@\" filePath=\"%@/%@.pro6\" selectedArrangementID=\"\"/>\n", ++cue, name, docs, name];
            }
            [xml appendString:@"    </RVPlaylistNode>\n"];
        }
        [xml appendString:@"  </RVPlaylistNode>\n</RVPlaylistDocument>\n"];
        NSData *local = [xml dataUsingEncoding:NSUTF8StringEncoding];
        YBRequire([local writeToFile:playlistPath atomically:YES], @"local playlist");
        NSDictionary *registered = [mac request:[NSString stringWithFormat:@"/api/playlists?path=%@&root=%@", Query(@"기본 .pro6pl"), Query(docs)] method:@"POST" body:local headers:@{@"Content-Type": @"application/xml; charset=utf-8"}];
        NSString *libraryID = registered[@"library"][@"id"];
        // 처음 비교로 영수증을 남긴다(모두 같음).
        YB2Engine *engine = [[YB2Engine alloc] initWithServer:mac root:docs playlist:[NSURL fileURLWithPath:playlistPath] profile:profile];
        engine.presenterRunning = ^BOOL { return NO; };
        [engine compare];
        // 웹에서 고친 것: 찬양 두 곡과 2부 기도, 2부 예배 순서(두 찬양 자리 바꿈).
        for (NSString *name in @[@"빛 되신 주", @"감사의 고백", @"2부 기도"]) [web upload:Doc([name stringByAppendingString:@" 웹 수정"]) path:[name stringByAppendingString:@".pro6"] previous:server[name]];
        NSDictionary *plan = [web request:[NSString stringWithFormat:@"/api/playlists/%@/plan?node=N2", libraryID] method:@"GET" body:nil headers:nil];
        NSMutableArray *items = [NSMutableArray array];
        for (NSDictionary *item in plan[@"items"]) [items addObject:@{@"id": item[@"id"]}];
        [items exchangeObjectAtIndex:2 withObjectAtIndex:3];
        NSData *patch = [NSJSONSerialization dataWithJSONObject:@{@"items": items, @"baseNodeHash": plan[@"playlist"][@"sha256"]} options:0 error:NULL];
        [web request:[NSString stringWithFormat:@"/api/playlists/%@?node=N2", libraryID] method:@"PATCH" body:patch headers:@{@"Content-Type": @"application/json", @"If-Match": [NSString stringWithFormat:@"\"%@\"", registered[@"library"][@"version"]]}];
        NSData *json = [NSJSONSerialization dataWithJSONObject:@{@"root": docs, @"playlist": playlistPath, @"profile": profile} options:0 error:NULL];
        fwrite(json.bytes, 1, json.length, stdout); fputc('\n', stdout);
        return 0;
    } @catch (NSException *e) { fprintf(stderr, "capture seed failed: %s\n", e.reason.UTF8String); return 1; }
}}
