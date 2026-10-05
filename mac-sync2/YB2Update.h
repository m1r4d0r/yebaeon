#import <Foundation/Foundation.h>
#import "YBCore.h"

// Sync 2 앱 업데이트. 서버의 최신 빌드 번호만 묻고(요청 1번), 사람이 [지금 설치]를 누를 때 받아서 바꾼다.
// 순서: ZIP 받기 → 크기·sha 확인 → 임시 폴더에 풀기 → 번들 식별자·빌드 번호 확인 → 지금 앱을 백업 폴더로 옮김 → 새 앱을 그 자리에 → 다시 켜기.
@interface YB2Update : NSObject
+ (NSInteger)currentBuild;
// {build, sha256, size, notes} 또는 nil(올린 빌드가 없음). 지금보다 새 빌드가 아니어도 돌려준다.
+ (NSDictionary *)latest:(YBServer *)server;
// 받아서 바꾼다. 반환: 새 앱 경로. 실패하면 예외이고 지금 앱은 그대로다.
+ (NSString *)install:(NSDictionary *)release server:(YBServer *)server backupRoot:(NSString *)backupRoot progress:(void (^)(NSString *message))progress;
// 새 앱을 1초 뒤 다시 켠다(지금 앱은 곧 끝난다).
+ (void)relaunch:(NSString *)path;
@end
