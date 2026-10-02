#import <Cocoa/Cocoa.h>
#import <sys/types.h>

FOUNDATION_EXPORT void YBRequire(BOOL condition, NSString *message);
FOUNDATION_EXPORT NSString *YBHash(NSData *data);
FOUNDATION_EXPORT NSString *YBPath(NSString *path);
FOUNDATION_EXPORT void YBValidateDocument(NSData *data);
FOUNDATION_EXPORT void YBValidateMetadata(NSDictionary *document);
FOUNDATION_EXPORT NSString *YBDisposition(NSString *localHash, NSDictionary *remote, NSDictionary *baseline);
FOUNDATION_EXPORT BOOL YBPresenterRunning(void);

// Relative-path file access shared by the native playlist adapter and document engine.
FOUNDATION_EXPORT NSData *YBReadSafeFile(NSString *root, NSString *path, mode_t *mode);
FOUNDATION_EXPORT void YBWriteSafeFile(NSString *root, NSString *path, NSData *data, mode_t mode, void (^guard)(void));

// Errors are YebaeOn exceptions; CLI catches them without printing credentials.
@interface YBServer : NSObject
@property(nonatomic, readonly) NSString *origin;
@property(nonatomic, copy) NSString *cookie;
- (instancetype)initWithOrigin:(NSString *)origin allowLocalTestServer:(BOOL)allow;
- (NSDictionary *)request:(NSString *)route method:(NSString *)method body:(NSData *)body headers:(NSDictionary *)headers;
- (NSDictionary *)request:(NSString *)route method:(NSString *)method body:(NSData *)body headers:(NSDictionary *)headers timeout:(NSTimeInterval)timeout;
- (NSDictionary *)login:(NSString *)name password:(NSString *)password;
- (NSArray *)documents;
- (NSDictionary *)head:(NSDictionary *)document;
- (NSData *)download:(NSDictionary *)document;
- (NSDictionary *)upload:(NSData *)data path:(NSString *)path previous:(NSDictionary *)previous;
- (void)loadSession;
- (void)saveSession;
- (void)forgetSession;
@end

@interface YBSync : NSObject
@property(nonatomic, readonly) NSString *root;
@property(nonatomic, readonly) NSString *profile;
@property(nonatomic, readonly) NSDictionary *entries;
@property(nonatomic, copy) BOOL (^presenterRunning)(void);
// Native tests inject interruption after durable stages. Never exposed as a CLI option.
@property(nonatomic, copy) void (^checkpoint)(NSString *stage);
// Set only by the playlist coordinator while its durable batch journal owns the folder.
@property(nonatomic) BOOL playlistOperationActive;
- (instancetype)initWithRoot:(NSString *)root profile:(NSString *)profile origin:(NSString *)origin;
- (NSArray *)inventory;
- (NSArray *)plan:(NSArray *)remoteDocuments;
- (NSData *)readDocument:(NSString *)path;
- (void)acknowledge:(NSDictionary *)document expectedLocalHash:(NSString *)hash;
- (NSString *)apply:(NSData *)data document:(NSDictionary *)document expectedLocalHash:(NSString *)hash;
// One receive operation is one retention unit, regardless of document count.
@property(nonatomic, readonly) NSString *activeBackupBatch;
@property(nonatomic, readonly) NSString *backupWarning;
- (NSString *)beginBackupBatch:(NSString *)kind playlistJob:(NSString *)job;
- (void)endBackupBatch:(BOOL)completed;
- (NSArray *)backupBatches;
- (void)restoreBackupBatch:(NSString *)identifier;
- (void)pruneBackupBatchesKeeping:(NSUInteger)limit;
- (NSArray *)transactions;
- (NSArray *)pendingTransactions;
- (void)recover:(NSString *)transactionID;
- (void)restore:(NSString *)transactionID;
- (void)assertReady;
// Release the folder lock before switching/reopening a profile. Do not reuse afterwards.
- (void)close;
@end

