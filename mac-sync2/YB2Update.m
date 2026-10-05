#import "YB2Update.h"

@interface YBServer (YB2UpdateTransfer)
- (id)transfer:(NSString *)route method:(NSString *)method body:(NSData *)body headers:(NSDictionary *)headers timeout:(NSTimeInterval)timeout;
@end

@implementation YB2Update
+ (NSInteger)currentBuild { return [[NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleVersion"] integerValue]; }

+ (NSDictionary *)latest:(YBServer *)server {
    @try {
        NSDictionary *release = [server request:@"/api/sync/app" method:@"GET" body:nil headers:@{@"X-YebaeOn-Sync": @"2"} timeout:20];
        YBRequire([release[@"build"] isKindOfClass:NSNumber.class] && [release[@"sha256"] isKindOfClass:NSString.class] && [release[@"size"] isKindOfClass:NSNumber.class], @"서버의 업데이트 정보가 올바르지 않습니다.");
        return release;
    } @catch (NSException *e) {
        if ([e.reason hasPrefix:@"HTTP 404"]) return nil;   // 아직 올린 빌드가 없다(또는 업데이트를 모르는 서버)
        @throw;
    }
}

static NSString *Run(NSString *tool, NSArray *arguments) {
    NSTask *task = [NSTask new]; task.launchPath = tool; task.arguments = arguments;
    NSPipe *pipe = [NSPipe pipe]; task.standardError = pipe; task.standardOutput = pipe;
    [task launch]; NSData *output = [pipe.fileHandleForReading readDataToEndOfFile]; [task waitUntilExit];
    YBRequire(task.terminationStatus == 0, [NSString stringWithFormat:@"%@ 실패: %@", tool.lastPathComponent, [[NSString alloc] initWithData:output encoding:NSUTF8StringEncoding] ?: @""]);
    return [[NSString alloc] initWithData:output encoding:NSUTF8StringEncoding];
}
// ZIP 안에서 .app 하나를 찾는다(CI ZIP 안에 ZIP이 한 번 더 있으면 그것도 푼다).
static NSString *FindApp(NSString *folder, int depth) {
    for (NSString *name in [NSFileManager.defaultManager contentsOfDirectoryAtPath:folder error:NULL]) {
        NSString *path = [folder stringByAppendingPathComponent:name];
        if ([name.pathExtension isEqual:@"app"]) return path;
        if (depth < 2 && [name.pathExtension.lowercaseString isEqual:@"zip"]) {
            NSString *inner = [folder stringByAppendingPathComponent:[@"inner-" stringByAppendingString:name.stringByDeletingPathExtension]];
            Run(@"/usr/bin/ditto", @[@"-x", @"-k", path, inner]);
            NSString *found = FindApp(inner, depth + 1); if (found) return found;
        }
    }
    return nil;
}

+ (NSString *)install:(NSDictionary *)release server:(YBServer *)server backupRoot:(NSString *)backupRoot progress:(void (^)(NSString *))progress {
    NSString *current = NSBundle.mainBundle.bundlePath;
    YBRequire([current.pathExtension isEqual:@"app"], @"앱 위치를 확인하지 못했습니다.");
    YBRequire([NSFileManager.defaultManager isWritableFileAtPath:current.stringByDeletingLastPathComponent], [NSString stringWithFormat:@"%@ 폴더에 쓸 수 없습니다. 관리자 계정으로 앱을 옮긴 뒤 다시 해 주세요.", current.stringByDeletingLastPathComponent]);
    if (progress) progress(@"새 버전 받는 중");
    id transfer = [server transfer:@"/api/sync/app/download" method:@"GET" body:nil headers:@{@"X-YebaeOn-Sync": @"2"} timeout:300];
    NSData *zip = [transfer valueForKey:@"data"];
    YBRequire(zip.length == [release[@"size"] unsignedLongLongValue] && [YBHash(zip) isEqual:release[@"sha256"]], @"받은 업데이트 파일이 서버 정보와 다릅니다. 설치하지 않았습니다.");
    NSString *work = [NSTemporaryDirectory() stringByAppendingPathComponent:[@"yebaeon-sync2-update-" stringByAppendingString:NSUUID.UUID.UUIDString]];
    YBRequire([NSFileManager.defaultManager createDirectoryAtPath:work withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:NULL], @"임시 폴더를 만들지 못했습니다.");
    @try {
        NSString *zipPath = [work stringByAppendingPathComponent:@"update.zip"];
        YBRequire([zip writeToFile:zipPath atomically:YES], @"업데이트 파일을 저장하지 못했습니다.");
        if (progress) progress(@"새 버전 푸는 중");
        NSString *unpacked = [work stringByAppendingPathComponent:@"unpacked"];
        Run(@"/usr/bin/ditto", @[@"-x", @"-k", zipPath, unpacked]);
        NSString *app = FindApp(unpacked, 0);
        YBRequire(app != nil, @"업데이트 파일 안에 앱이 없습니다.");
        NSDictionary *info = [NSDictionary dictionaryWithContentsOfFile:[app stringByAppendingPathComponent:@"Contents/Info.plist"]];
        YBRequire([info[@"CFBundleIdentifier"] isEqual:NSBundle.mainBundle.bundleIdentifier], @"다른 앱이 들어 있습니다. 설치하지 않았습니다.");
        YBRequire([info[@"CFBundleVersion"] integerValue] == [release[@"build"] integerValue], @"업데이트 앱의 빌드 번호가 서버 정보와 다릅니다.");
        // 지금 앱은 지우지 않고 백업 폴더로 옮긴다(최근 3개만 남김). 실행 중인 앱의 파일은 옮겨도 끝날 때까지 그대로 동작한다.
        if (progress) progress(@"앱 바꾸는 중");
        [NSFileManager.defaultManager createDirectoryAtPath:backupRoot withIntermediateDirectories:YES attributes:nil error:NULL];
        NSString *backup = [backupRoot stringByAppendingPathComponent:[NSString stringWithFormat:@"빌드 %ld · %@.app", (long)[self currentBuild], [NSUUID.UUID.UUIDString substringToIndex:8]]];
        NSError *error = nil;
        YBRequire([NSFileManager.defaultManager moveItemAtPath:current toPath:backup error:&error], [@"지금 앱을 옮기지 못했습니다: " stringByAppendingString:error.localizedDescription ?: @""]);
        if (![NSFileManager.defaultManager moveItemAtPath:app toPath:current error:&error]) {
            [NSFileManager.defaultManager moveItemAtPath:backup toPath:current error:NULL];   // 원래 앱을 제자리에
            YBRequire(NO, [@"새 앱을 놓지 못했습니다(원래 앱 그대로): " stringByAppendingString:error.localizedDescription ?: @""]);
        }
        NSArray *old = [[NSFileManager.defaultManager contentsOfDirectoryAtPath:backupRoot error:NULL] sortedArrayUsingComparator:^NSComparisonResult(NSString *a, NSString *b) {
            NSDate *x = [NSFileManager.defaultManager attributesOfItemAtPath:[backupRoot stringByAppendingPathComponent:a] error:NULL].fileModificationDate, *y = [NSFileManager.defaultManager attributesOfItemAtPath:[backupRoot stringByAppendingPathComponent:b] error:NULL].fileModificationDate;
            return [x compare:y]; }];
        for (NSUInteger i = 0; i + 3 < old.count; i++) [NSFileManager.defaultManager removeItemAtPath:[backupRoot stringByAppendingPathComponent:old[i]] error:NULL];
        return current;
    } @finally {
        [NSFileManager.defaultManager removeItemAtPath:work error:NULL];
    }
}

+ (void)relaunch:(NSString *)path {
    NSTask *task = [NSTask new]; task.launchPath = @"/bin/sh";
    task.arguments = @[@"-c", @"sleep 1; /usr/bin/open -n \"$0\"", path];
    [task launch];
}
@end
