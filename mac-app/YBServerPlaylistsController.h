#import "YBDocumentsController.h"
@interface YBServerPlaylistsController : NSObject
@property(nonatomic,readonly) NSView *view;
- (instancetype)initWithWork:(YBWork *)work documents:(YBDocumentsController *)documents;
@property(nonatomic,copy) void (^targetChanged)(NSString *path);
@property(nonatomic,copy) void (^priorityFinished)(void);
@property(nonatomic,copy) void (^comparisonFinished)(void);
- (void)openBackupFolder:(id)sender;
- (NSString *)targetPath;
- (void)chooseFile:(id)sender;
- (void)refresh:(id)sender;
- (void)publish:(id)sender;
- (void)restore:(id)sender;
- (void)rootChanged;
@end


