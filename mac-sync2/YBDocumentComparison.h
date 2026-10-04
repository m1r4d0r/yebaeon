#import "YBAppUI.h"
FOUNDATION_EXPORT NSArray *YBComparisonRows(NSDictionary *local, NSDictionary *remote);
FOUNDATION_EXPORT NSAttributedString *YBHighlightedLines(NSString *text,NSString *other,BOOL server);
@interface YBDocumentComparison : NSView <NSTableViewDataSource,NSTableViewDelegate>
- (instancetype)initWithLocal:(NSDictionary *)local remote:(NSDictionary *)remote;
@end
