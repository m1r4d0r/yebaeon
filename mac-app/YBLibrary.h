#import "../mac-sync/YBSync.h"
@interface YBLibrary : NSObject
@property(nonatomic,readonly) YBSync *sync;
@property(nonatomic,readonly) YBServer *server;
- (instancetype)initWithRoot:(NSString *)root profile:(NSString *)profile server:(YBServer *)server;
@property(nonatomic,copy) void (^operationCheckpoint)(void);
@property(nonatomic,copy) void (^comparisonProgress)(NSUInteger done, NSUInteger total);
@property(nonatomic,copy) void (^phaseChanged)(NSString *message);
- (NSArray *)refresh;
- (NSArray *)refreshChecking:(void (^)(void))check;
- (void)reportSyncItems:(NSArray *)items;
- (NSUInteger)transfer:(NSArray *)rows receiving:(BOOL)receiving progress:(void (^)(NSString *path, NSUInteger done))progress;
@end


