#import <Cocoa/Cocoa.h>
#import <sys/types.h>

FOUNDATION_EXPORT void YBRequire(BOOL condition, NSString *message);
FOUNDATION_EXPORT NSString *YBHash(NSData *data);
FOUNDATION_EXPORT NSString *YBPath(NSString *path);
FOUNDATION_EXPORT void YBValidateDocument(NSData *data);
FOUNDATION_EXPORT void YBValidateMetadata(NSDictionary *document);
FOUNDATION_EXPORT BOOL YBPresenterRunning(void);

// 문서 폴더 기준 상대경로 파일 읽기·쓰기. 하위 경로에 심볼릭 링크를 허용하지 않는다.
FOUNDATION_EXPORT NSData *YBReadSafeFile(NSString *root, NSString *path, mode_t *mode);
FOUNDATION_EXPORT void YBWriteSafeFile(NSString *root, NSString *path, NSData *data, mode_t mode, void (^guard)(void));

// 오류는 YebaeOn 예외로 던진다. 인증 정보는 메시지에 넣지 않는다.
@interface YBServer : NSObject
@property(nonatomic, readonly) NSString *origin;
@property(nonatomic, copy) NSString *cookie;
- (instancetype)initWithOrigin:(NSString *)origin allowLocalTestServer:(BOOL)allow;
- (NSDictionary *)request:(NSString *)route method:(NSString *)method body:(NSData *)body headers:(NSDictionary *)headers;
- (NSDictionary *)request:(NSString *)route method:(NSString *)method body:(NSData *)body headers:(NSDictionary *)headers timeout:(NSTimeInterval)timeout;
- (NSDictionary *)login:(NSString *)name password:(NSString *)password;
- (NSArray *)documents;
- (NSArray *)documentsChecking:(void (^)(void))check;
- (NSDictionary *)head:(NSDictionary *)document;
- (NSData *)download:(NSDictionary *)document;
- (NSData *)downloadPlaylist:(NSDictionary *)library;
- (NSDictionary *)upload:(NSData *)data path:(NSString *)path previous:(NSDictionary *)previous;
- (NSArray *)mediaAssets:(NSArray *)hashes;
- (BOOL)mediaContentExists:(NSString *)hash size:(unsigned long long)size;
- (NSDictionary *)uploadMedia:(NSData *)data sha256:(NSString *)hash;
- (NSDictionary *)registerMediaReferences:(NSArray *)references document:(NSDictionary *)document;
- (NSArray *)mediaReferencesForDocument:(NSDictionary *)document;
- (NSData *)downloadMedia:(NSString *)hash size:(unsigned long long)size;
- (void)loadSession;
- (void)saveSession;
- (void)forgetSession;
@end
