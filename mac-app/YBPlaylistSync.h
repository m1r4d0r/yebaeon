#import "YBLibrary.h"
@interface YBPlaylistSync : NSObject
@property(nonatomic,readonly) YBLibrary *library;
@property(nonatomic,readonly) NSURL *target;
@property(nonatomic,copy) void (^checkpoint)(NSString *stage);
- (instancetype)initWithLibrary:(YBLibrary *)library target:(NSURL *)target;
- (NSArray *)libraries;
- (NSDictionary *)reconcileFileWithLibraries:(NSArray *)libraries;
- (NSDictionary *)manifest:(NSString *)libraryID node:(NSString *)nodeID;
- (NSDictionary *)registerFileWithSourceRoot:(NSString *)sourceRoot progress:(void (^)(NSString *message))progress;
- (NSDictionary *)compare:(NSString *)libraryID node:(NSString *)nodeID;
- (NSDictionary *)compare:(NSString *)libraryID node:(NSString *)nodeID hashCache:(NSMutableDictionary *)hashCache;
- (NSString *)receiveComparisons:(NSArray *)comparisons progress:(void (^)(NSString *message))progress;
- (NSString *)receive:(NSDictionary *)comparison progress:(void (^)(NSString *message))progress;
// Explicit user decisions. Ordinary receive continues to reject conflicts.
- (NSString *)receiveChoosingServer:(NSDictionary *)comparison progress:(void (^)(NSString *message))progress;
- (NSDictionary *)prepareMacReset:(NSDictionary *)comparison progress:(void (^)(NSString *message))progress;
- (NSDictionary *)applyMacReset:(NSDictionary *)prepared progress:(void (^)(NSString *message))progress;
- (NSArray *)jobs;
- (void)restoreJob:(NSString *)identifier;
@end


