#import <Foundation/Foundation.h>

// 영수증: 이 Mac이 마지막으로 서버에서 받아 쓴 것의 기록. SQLite 파일 하나.
// High Sierra의 SQLite는 3.19라 UPSERT 문법이 없다. INSERT OR REPLACE만 쓴다.
// docs  — 문서 경로마다: 받은 서버 버전, 쓴 바이트 sha, 그때의 크기·수정시각(빠른 변경 감지용),
//         neutral(사용일·사용 횟수를 뺀 sha), replaced(마지막 적용 때 덮인 Mac 바이트 sha)
// nodes — 예배(노드)마다: 받은 서버 노드 sha, 그때 로컬 노드의 순서 지문, replaced(마지막 적용 때 덮인 Mac 순서 지문)
// meta  — 키/값
// ledger·media·pending — 3차(아래 메서드 설명)
@interface YB2Receipt : NSObject
- (instancetype)initWithPath:(NSString *)path;
- (void)close;

- (NSDictionary *)document:(NSString *)path;            // {version, sha, size, mtime, neutral?, replaced?} 또는 nil
- (void)rememberDocument:(NSString *)path version:(NSNumber *)version sha:(NSString *)sha size:(long long)size mtime:(long long)mtime;
- (void)rememberDocument:(NSString *)path version:(NSNumber *)version sha:(NSString *)sha size:(long long)size mtime:(long long)mtime neutral:(NSString *)neutral replaced:(NSString *)replaced;
- (void)forgetDocument:(NSString *)path;
- (void)moveDocument:(NSString *)path to:(NSString *)target;

- (NSDictionary *)node:(NSString *)key;                 // {serverSha, localFingerprint, name, replaced?} 또는 nil
- (void)rememberNode:(NSString *)key serverSha:(NSString *)sha fingerprint:(NSString *)fingerprint name:(NSString *)name;
- (void)rememberNode:(NSString *)key serverSha:(NSString *)sha fingerprint:(NSString *)fingerprint name:(NSString *)name replaced:(NSString *)replaced;
- (void)forgetNode:(NSString *)key;

// 3차: Mac 장부 사본. 서버 문서 경로마다 {id, version, sha, state}. 지운 줄 대신 state(active·archived·trashed·purged·renamed)로 남겨
// "서버에 있었던 경로"를 잊지 않는다. Mac에만 있는 새 문서를 고를 때 쓴다.
- (NSDictionary *)ledger:(NSString *)path;
- (void)setLedger:(NSString *)path id:(NSString *)identifier version:(NSNumber *)version sha:(NSString *)sha state:(NSString *)state;
- (NSUInteger)ledgerCount;
// 서버 이미지 경로표 사본: 경로 → sha
- (NSString *)mediaSha:(NSString *)path;
- (void)setMedia:(NSString *)path sha:(NSString *)sha;
// 일지에서 받은 "뜻이 실린" 동작(문서 휴지통·이름 바꾸기). [적용] 때 실행하고 지운다.
// 각 줄: {kind, entity, action, path, previous?, sha?, version?}
- (NSArray *)pending;
- (void)addPending:(NSDictionary *)item;
- (void)removePending:(NSString *)kind entity:(NSString *)entity action:(NSString *)action;

- (NSString *)value:(NSString *)key;
- (void)setValue:(NSString *)value forKey:(NSString *)key;

- (void)transaction:(void (^)(void))block;              // 블록 안의 기록을 한 번에 커밋
@end
