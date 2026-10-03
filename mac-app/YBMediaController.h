#import "YBAppUI.h"
FOUNDATION_EXPORT NSDictionary *YBMediaReport(NSString *documentsRoot, NSArray *mediaRoots);
FOUNDATION_EXPORT NSDictionary *YBImagePreparationReport(NSString *documentsRoot, NSArray *mediaRoots, void (^check)(void));
@interface YBMediaController : NSObject
@property(nonatomic,readonly) NSView *view;
- (instancetype)initWithWork:(YBWork *)work documentsRoot:(NSString *)root;
- (void)setDocumentsRoot:(NSString *)root;
- (void)addRoot:(id)sender;
- (void)defaultRoots:(id)sender;
@end
