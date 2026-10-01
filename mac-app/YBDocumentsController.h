#import "YBAppUI.h"
#import "YBLibrary.h"
@interface YBDocumentsController : NSObject
@property(nonatomic,readonly) NSView *view;
@property(nonatomic,readonly) NSString *documentsRoot;
@property(nonatomic,copy) void (^rootChanged)(NSString *root);
- (YBLibrary *)connectedLibrary;
- (void)ensureSessionLoaded;
- (void)startupCompare;
- (void)login:(id)sender;
- (void)chooseRoot:(id)sender;
- (void)testRoot:(id)sender;
- (instancetype)initWithWork:(YBWork *)work;
@end

