#import "YBAppUI.h"
@interface YBDocumentsController : NSObject
@property(nonatomic,readonly) NSView *view;
@property(nonatomic,readonly) NSString *documentsRoot;
@property(nonatomic,copy) void (^rootChanged)(NSString *root);
- (instancetype)initWithWork:(YBWork *)work;
@end
