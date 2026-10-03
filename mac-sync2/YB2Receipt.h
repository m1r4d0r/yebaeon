#import <Foundation/Foundation.h>

// 영수증: 이 Mac이 마지막으로 서버에서 받아 쓴 것의 기록. SQLite 파일 하나.
// High Sierra의 SQLite는 3.19라 UPSERT 문법이 없다. INSERT OR REPLACE만 쓴다.
// docs  — 문서 경로마다: 받은 서버 버전, 쓴 바이트 sha, 그때의 크기·수정시각(빠른 변경 감지용)
// nodes — 예배(노드)마다: 받은 서버 노드 sha, 그때 로컬 노드의 순서 지문
// meta  — 키/값
@interface YB2Receipt : NSObject
- (instancetype)initWithPath:(NSString *)path;
- (void)close;

- (NSDictionary *)document:(NSString *)path;            // {version, sha, size, mtime} 또는 nil
- (void)rememberDocument:(NSString *)path version:(NSNumber *)version sha:(NSString *)sha size:(long long)size mtime:(long long)mtime;
- (void)forgetDocument:(NSString *)path;

- (NSDictionary *)node:(NSString *)key;                 // {serverSha, localFingerprint, name} 또는 nil
- (void)rememberNode:(NSString *)key serverSha:(NSString *)sha fingerprint:(NSString *)fingerprint name:(NSString *)name;

- (NSString *)value:(NSString *)key;
- (void)setValue:(NSString *)value forKey:(NSString *)key;

- (void)transaction:(void (^)(void))block;              // 블록 안의 기록을 한 번에 커밋
@end
