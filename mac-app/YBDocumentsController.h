#import "YBAppUI.h"
#import "YBLibrary.h"
@interface YBDocumentsController : NSObject
@property(nonatomic,readonly) NSView *view;
@property(nonatomic,readonly) NSString *documentsRoot;
@property(nonatomic,copy) void (^rootChanged)(NSString *root);
@property(nonatomic,copy) void (^sessionChanged)(NSString *status);
@property(nonatomic,copy) void (^comparisonFinished)(void);
@property(nonatomic,copy) void (^showRecovery)(void);
- (void)setPlaylistFile:(NSURL *)url;
- (void)refresh:(id)sender;
- (void)logout:(id)sender;
- (YBLibrary *)connectedLibrary;
- (void)ensureSessionLoaded;
- (void)startupCompare;
- (void)login:(id)sender;
- (void)chooseRoot:(id)sender;
- (void)testRoot:(id)sender;
- (instancetype)initWithWork:(YBWork *)work;
@end

