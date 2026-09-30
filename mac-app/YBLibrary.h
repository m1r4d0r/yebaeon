#import "../mac-sync/YBSync.h"
@interface YBLibrary : NSObject
@property(nonatomic,readonly) YBSync *sync;
@property(nonatomic,readonly) YBServer *server;
- (instancetype)initWithRoot:(NSString *)root profile:(NSString *)profile server:(YBServer *)server;
- (NSArray *)refresh;
- (NSUInteger)transfer:(NSArray *)rows receiving:(BOOL)receiving progress:(void (^)(NSString *path, NSUInteger done))progress;
@end
