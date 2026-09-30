#import "YBAppUI.h"
FOUNDATION_EXPORT NSDictionary *YBMediaReport(NSString *documentsRoot, NSArray *mediaRoots);
@interface YBMediaController : NSObject
@property(nonatomic,readonly) NSView *view;
- (instancetype)initWithWork:(YBWork *)work documentsRoot:(NSString *)root;
- (void)setDocumentsRoot:(NSString *)root;
@end
