#import <Foundation/Foundation.h>
#import "../mac-sync/YBSync.h"
#import "YB2Receipt.h"

// Sync 2 엔진 · 1차: 서버 → Mac 받기만.
//
// 규칙
// - 서버가 정본이다. "서버가 바뀌었나"는 서버 노드 sha와 문서 버전·sha로 판단하고, "Mac이 바뀌었나"는 영수증과 지금 파일로 판단한다.
// - 단위는 예배(노드)다. 재생목록 파일 전체 기준은 없다. 다른 노드의 바이트는 건드리지 않는다.
// - 서버에 원본이 없는 참조(장부 이름만 있는 곡)는 적용을 막지 않는다. Mac은 자기 파일을 그대로 쓴다.
// - 양쪽이 바뀐 문서·순서는 서버 것을 적용하고 Mac 것은 백업 폴더에 남긴다. 사람에게 고르게 하지 않는다.
// - 실패는 항목(예배)별로 남기고 나머지는 계속한다. 전역 잠금은 없다. 중단된 적용은 다음 실행에서 끝까지 마무리한다.
@interface YB2Engine : NSObject
@property(nonatomic, readonly) YBServer *server;
@property(nonatomic, readonly) NSString *root;          // Mac 문서 폴더(절대경로)
@property(nonatomic, readonly) NSURL *playlistURL;      // 기본 .pro6pl
@property(nonatomic, readonly) NSString *profile;       // 영수증·백업·준비 파일 폴더
@property(nonatomic, readonly) YB2Receipt *receipt;
@property(nonatomic, copy) BOOL (^presenterRunning)(void);
@property(nonatomic, copy) void (^progress)(NSString *message);

- (instancetype)initWithServer:(YBServer *)server root:(NSString *)root playlist:(NSURL *)playlist profile:(NSString *)profile;

// 예배별 비교 결과. 각 항목:
//   key, nodeID, name, status("same" | "receive" | "mac" | "hold"), reason(hold일 때),  mac = Mac에서만 바뀜(건드리지 않음, 올리기는 2차)
//   orderChanged(BOOL), macOrderChanged(BOOL), macOnlyOrder(BOOL), documents(받을 서버 문서 목록), macChangedDocuments(백업될 경로 목록), macOnlyDocuments(건드리지 않는 Mac 수정 문서),
//   missingServer(원본 없는 참조 수), missingLocal(Mac에도 없는 참조 경로 목록), updatedBy, updatedAt, plan, localFingerprint
- (NSArray *)compare;
@property(nonatomic, readonly) NSString *comparedPlaylistHash;

// 선택한 예배를 적용한다. 반환: {applied:[name…], failed:{name:reason…}, backup:폴더}
- (NSDictionary *)apply:(NSArray *)rows;

// 시작할 때 호출. 중단된 적용이 있으면 끝까지 마무리한다. 마무리한 것이 있으면 설명을 돌려준다.
- (NSString *)finishInterruptedApply;
@end
