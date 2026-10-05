#import <Foundation/Foundation.h>
#import "YBCore.h"
#import "YB2Receipt.h"

// Sync 2 엔진.
//
// 규칙
// - 서버가 정본이다. "서버가 바뀌었나"는 서버 노드 sha와 문서 버전·sha로 판단하고, "Mac이 바뀌었나"는 영수증과 지금 파일로 판단한다.
// - 단위는 예배(노드)다. 재생목록 파일 전체 기준은 없다. 다른 노드의 바이트는 건드리지 않는다.
// - 서버에 원본이 없는 참조(장부 이름만 있는 곡)는 적용을 막지 않는다. Mac은 자기 파일을 그대로 쓴다.
// - 양쪽이 바뀐 문서·순서는 서버 것을 적용하고 Mac 것은 백업 폴더에 남긴다. 사람에게 고르게 하지 않는다.
// - Mac 파일을 바꾸는 일(받기·휴지통·이름 바꾸기·노드 빼기)은 apply로만 한다. 상주 확인은 비교해 보여 주기까지만 한다.
// - 없어진 것을 보고 추측해서 지우지 않는다. 서버 일지의 trashed·renamed와 서버 휴지통 상태만 따른다.
// - 실패는 항목(예배)별로 남기고 나머지는 계속한다. 전역 잠금은 없다. 중단된 적용은 다음 실행에서 끝까지 마무리한다.
@interface YB2Engine : NSObject
@property(nonatomic, readonly) YBServer *server;
@property(nonatomic, readonly) NSString *root;          // Mac 문서 폴더(절대경로)
@property(nonatomic, readonly) NSURL *playlistURL;      // 기본 .pro6pl
@property(nonatomic, readonly) NSString *profile;       // 영수증·백업·준비 파일 폴더
@property(nonatomic, readonly) YB2Receipt *receipt;
@property(nonatomic, copy) BOOL (^presenterRunning)(void);
@property(nonatomic, copy) void (^progress)(NSString *message);
// 문서를 macOS 휴지통으로 옮긴다(진짜 삭제는 없다). 검사에서는 바꿔 끼운다. 반환: 옮겨진 곳(없으면 nil = 실패)
@property(nonatomic, copy) NSString *(^trashItem)(NSString *absolutePath);

- (instancetype)initWithServer:(YBServer *)server root:(NSString *)root playlist:(NSURL *)playlist profile:(NSString *)profile;

// 예배별 비교 결과. 각 항목:
//   key, nodeID, name, status("same" | "receive" | "mac" | "hold"), reason(hold일 때),  mac = Mac에서만 바뀜(올리기 대상)
//   usageOnly(사용 기록만 바뀐 문서), revertedDocuments·revertedOrder(PP6가 옛 내용을 다시 씀 → 다시 적용), macChangedReasons, localXML
//   orderChanged(BOOL), macOrderChanged(BOOL), macOnlyOrder(BOOL), documents(받을 서버 문서 목록), macChangedDocuments(백업될 경로 목록), macOnlyDocuments(건드리지 않는 Mac 수정 문서),
//   missingServer(원본 없는 참조 수), missingLocal(Mac에도 없는 참조 경로 목록), updatedBy, updatedAt, plan, localFingerprint
// 3차 status: "trash"(서버 휴지통에 넣은 예배 → [적용] 때 Mac에서 뺌), "archived"(서버에서 보관됨 · 표시만),
//   "macNew"(Mac에만 있는 새 예배 → 서버에 없을 때만 추가), "actions"(서버 일지의 문서 이름 바꾸기·휴지통 → [적용] 때 실행)
//   serverNew(서버에 새로 생긴 예배 · 기본 체크), macDeleted(Mac에서 지운 예배 · 기본 체크 꺼짐, 되살리지 않음),
//   macDeletedDocuments(받을 문서 중 Mac에서 지운 것), macRenamed(Mac에서 바꾼 예배 이름 → 올리기), renamedFrom(서버 이름으로 바뀔 Mac 이름)
//   actions 줄: renames[{id, from, to}], trashes[{id, path}], actionHolds[{path, reason}]
- (NSArray *)compare;
@property(nonatomic, readonly) NSString *comparedPlaylistHash;

// 선택한 예배를 적용한다. 덮일 Mac 수정본은 먼저 서버 보관본으로 올린다.
// 반환: {applied:[name…], failed:{name:reason…}, backup:폴더, revisions:올린 보관본 수, revisionFailed:[…]}
- (NSDictionary *)apply:(NSArray *)rows;

// 시작할 때 호출. 중단된 적용이 있으면 끝까지 마무리한다. 마무리한 것이 있으면 설명을 돌려준다.
- (NSString *)finishInterruptedApply;

// ── 2차 ──
// Mac에서만 바뀐 것을 올린다: 문서(서버 새 버전), 예배 순서(노드 교체), 사용일(버전 없이 usage).
// 3차: Mac에만 있는 새 예배(macNew)는 서버에 "없을 때만 추가"한다.
// 반환: {uploaded:[name…], usage:보고한 문서 수, failed:{name:reason…}}. PP6가 켜져 있어도 된다(Mac 파일을 바꾸지 않는다).
- (NSDictionary *)upload:(NSArray *)rows;
// 변경 일지 확인(요청 1번). 반환: {relevant:BOOL, head:번호}. relevant면 compare를 돌린다.
- (NSDictionary *)checkChanges;
- (void)markSeen:(NSNumber *)head;
// 장치 열쇠로 들어왔을 때만: "어디까지 적용했나 + 보류 예배"를 서버에 한 줄로 보고한다.
- (void)reportApplied:(NSNumber *)seq rows:(NSArray *)rows;

// ── 3차 ──
// Mac 장부 사본이 없으면 R2 장부 파일로 한 번 만든다. checkChanges가 부른다. 그 뒤로는 일지로만 고친다.
- (void)syncLedger;
// PP6를 닫을 때: 서버 장부에 없는 Mac 새 문서와, 올린 문서가 가리키는 허용 폴더 안의 새 이미지를 올린다. Mac 파일은 바꾸지 않는다.
// 반환: {created:[경로…], collisions:[경로…](서버에 같은 이름이 있음 → 정리 창), media:올린 이미지 수, failed:{경로:이유}}
- (NSDictionary *)uploadNew;
// 문서 바이트가 가리키는 이미지 중 허용 폴더 안의 것을 서버에 올리고 경로표에 등록한다. 반환: 올리거나 등록한 수
- (NSUInteger)uploadMediaFor:(NSData *)document;
// 여러 문서의 이미지를 한꺼번에(서버 확인 100개씩, 올리기 4개씩, 경로 등록 200개씩). 반환: {uploaded, registered, skipped}
- (NSDictionary *)uploadMediaForDocuments:(NSArray *)documents;
// 전체 확인(7일 규칙). Mac 디스크와 장부 사본·영수증만 본다(서버 요청 없음). Mac 파일을 바꾸지 않는다.
// 반환·저장: {at, macDeleted:[{path,id}], collisions:[{path,id}], external:[{path,references}], imageFill:[{path,sha}]}
- (NSDictionary *)fullCheck;
// 나눠 부르기: scan은 읽기만(다른 작업과 함께 돌 수 있음), save는 영수증 쓰기(작업 큐에서)
- (NSDictionary *)scanFullCheck;
- (NSDictionary *)saveFullCheck:(NSDictionary *)scan;
- (NSDictionary *)lastFullCheck;
- (BOOL)fullCheckDue;
// 정리 창 버튼. 모두 사용자가 누를 때만 돈다.
- (void)trashOnServer:(NSString *)path;          // Mac에서 지운 문서를 서버 휴지통으로
- (void)trashOnMac:(NSString *)path;             // 강제 동작: Mac 파일을 macOS 휴지통으로(백업 사본)
- (void)takeServer:(NSString *)path;             // 같은 이름 다른 내용: 서버 것으로(Mac 것은 백업·서버 보관본)
- (void)takeMac:(NSString *)path;                // 같은 이름 다른 내용: Mac 것을 서버 새 버전으로
- (NSString *)keepBothNumbered:(NSString *)path; // 같은 이름 다른 내용: Mac 파일에 번호를 붙여 둘 다 둔다. 반환: 새 경로
- (NSArray *)numberedLog;                        // 번호 붙인 기록 [{path, target, at}]
- (void)fetchImage:(NSDictionary *)item;         // 이미지 보충 {path, sha}
- (NSDictionary *)importExternal:(NSDictionary *)item;   // 외부 참조 {path, references} → 그림 복사·경로 바꿈·올리기 {copied, missing, uploaded}
- (void)removeNumbered:(NSDictionary *)item;     // 번호 붙임 {path, target} → Mac 휴지통·서버 휴지통·기록 정리
- (NSString *)webLink:(NSString *)path;
- (BOOL)hasLocalDocument:(NSString *)path;       // 문서 폴더에 그 파일이 있나(NFC·NFD 모두)          // Studio에서 그 문서 열기
- (NSData *)serverBytes:(NSString *)path;        // 차이 창용 서버 바이트
+ (NSData *)comparableBytes:(NSData *)data;      // 차이 창용: Sync가 같은지 판단할 때 쓰는 비교용 글(4판)
// 마지막 적용 기록({id, at, applied:[…]}) 또는 nil. 되돌리면 그 다음 것이 아니라 nil이 된다(한 단계만).
- (NSDictionary *)lastApply;
// 마지막 적용을 되돌린다. 적용 뒤 바뀐 파일은 건너뛴다. PP6가 꺼져 있어야 한다. 반환: {restored:[…], skipped:[…]}
- (NSDictionary *)undoLastApply;
@end
