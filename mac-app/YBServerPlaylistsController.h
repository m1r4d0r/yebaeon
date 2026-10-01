#import "YBDocumentsController.h"
@interface YBServerPlaylistsController : NSObject
@property(nonatomic,readonly) NSView *view;
- (instancetype)initWithWork:(YBWork *)work documents:(YBDocumentsController *)documents;
- (void)rootChanged;
@end
