#import "YBAppUI.h"
@class YBLibrary;
FOUNDATION_EXPORT NSDictionary *YBMediaReport(NSString *documentsRoot, NSArray *mediaRoots);
FOUNDATION_EXPORT NSDictionary *YBImagePreparationReport(NSString *documentsRoot, NSArray *mediaRoots, void (^check)(void));
FOUNDATION_EXPORT NSData *YBReadPreparedImage(NSString *path, NSString *expectedHash, unsigned long long expectedSize, void (^check)(void));
@interface YBMediaController : NSObject
@property(nonatomic,readonly) NSView *view;
@property(nonatomic,copy) YBLibrary *(^libraryProvider)(void);
- (instancetype)initWithWork:(YBWork *)work documentsRoot:(NSString *)root;
- (void)setDocumentsRoot:(NSString *)root;
- (void)addRoot:(id)sender;
- (void)defaultRoots:(id)sender;
@end
