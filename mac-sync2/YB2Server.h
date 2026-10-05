#import <Foundation/Foundation.h>
#import "YBCore.h"

// Sync 2 서버 연결. 기존 YBServer(0.6.6과 공유)는 고치지 않고 장치 열쇠만 덧붙인다.
// 장치 열쇠가 있으면 모든 요청에 Authorization: Bearer 를 붙인다. 상주 Mac은 비밀번호·30일 쿠키 없이 계속 들어온다.
@interface YB2Server : YBServer
@property(nonatomic, copy) NSString *deviceToken;
@property(nonatomic, readonly) NSString *deviceID;     // 열쇠 안의 장치 번호. 열쇠가 없으면 nil

// 비밀번호로 들어온 세션에서 이 Mac의 장치 열쇠를 받는다. 열쇠 원문은 이 응답에만 있다.
- (NSString *)registerDevice:(NSString *)name;
// 키체인(일반 암호 항목, 서비스 org.yebaeon.sync2.device, 계정 = 서버 주소)
- (BOOL)loadDeviceToken;
- (void)saveDeviceToken;
- (void)forgetDeviceToken;

// 현황과 원격 지원(sync.md 13.6). 모두 장치 열쇠로만 된다.
- (void)postStatus:(NSDictionary *)status;               // 현황 한 줄 덮어쓰기
- (NSString *)openSupport:(NSInteger)minutes;            // 지원 시간 열기. 반환: 서버가 정한 끝 시각(ISO 8601)
- (void)closeSupport;                                    // 지원 시간 닫기(남은 명령은 서버가 만료시킨다)
- (NSDictionary *)takeCommands;                          // 기다리는 명령 가져가기 {commands:[…], supportUntil: 끝 시각 또는 NSNull(닫힘)}
- (void)finishCommand:(NSString *)commandID state:(NSString *)state message:(NSString *)message;   // state: done · failed · rejected
@end
