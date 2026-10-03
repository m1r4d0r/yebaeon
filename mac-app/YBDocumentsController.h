#import "YBAppUI.h"
#import "YBLibrary.h"
@interface YBDocumentsController : NSObject
@property(nonatomic,readonly) NSView *view;
@property(nonatomic,readonly) NSString *documentsRoot;
@property(nonatomic,copy) void (^rootChanged)(NSString *root);
@property(nonatomic,copy) void (^sessionChanged)(NSString *status);
@property(nonatomic,copy) void (^comparisonFinished)(void);
@property(nonatomic,copy) void (^checkStateChanged)(NSString *message, NSUInteger done, NSUInteger total, BOOL active);
@property(nonatomic,copy) void (^showRecovery)(void);
- (void)setPlaylistFile:(NSURL *)url;
- (void)refresh:(id)sender;
- (void)resetHistory:(id)sender;
- (void)logout:(id)sender;
- (YBLibrary *)connectedLibrary;
- (void)ensureSessionLoaded;
- (void)startupCompare;
- (void)backgroundCompare;
- (void)resumeBackgroundIfNeeded;
- (void)acceptPriorityComparisons:(NSArray *)comparisons;
- (void)mergeComparedRows:(NSArray *)rows;
@property(nonatomic,copy) void (^priorityRequested)(void);
- (void)login:(id)sender;
- (void)chooseRoot:(id)sender;
- (void)testRoot:(id)sender;
- (instancetype)initWithWork:(YBWork *)work;
@end



