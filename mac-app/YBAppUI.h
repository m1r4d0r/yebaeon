#import <Cocoa/Cocoa.h>
FOUNDATION_EXPORT NSTextField *YBLabel(NSString *text, NSRect frame, CGFloat size, BOOL bold);
FOUNDATION_EXPORT NSButton *YBButton(NSString *title, NSRect frame, id target, SEL action);
FOUNDATION_EXPORT NSTableView *YBTable(NSView *parent, NSRect frame, NSArray *columns, id delegate);
FOUNDATION_EXPORT void YBAlert(NSString *title, NSString *message);
FOUNDATION_EXPORT BOOL YBConfirm(NSString *title, NSString *message, NSString *action);
FOUNDATION_EXPORT NSString *YBChooseFolder(NSString *title, NSString *current);
FOUNDATION_EXPORT void YBShowText(NSString *title, NSString *text);
FOUNDATION_EXPORT NSString *YBPreferencesDirectory(void);
FOUNDATION_EXPORT NSString *YBLegacySettingsPath(void);
#ifdef YB_TESTING
FOUNDATION_EXPORT void YBSetTestPreferencesDirectory(NSString *directory);
#endif
FOUNDATION_EXPORT NSDictionary *YBPreferences(NSString *name);
FOUNDATION_EXPORT void YBSavePreferences(NSString *name, NSDictionary *value);
FOUNDATION_EXPORT NSString *YBStatusName(NSString *status);
FOUNDATION_EXPORT NSString *YBProfilePath(NSString *root, NSString *origin);

@interface YBWork : NSObject
@property(nonatomic, readonly) BOOL busy;
@property(atomic, readonly) BOOL backgroundActive;
@property(atomic, readonly) BOOL pauseRequested;
@property(atomic, readonly) BOOL paused;
@property(atomic, readonly) BOOL pausable;
@property(nonatomic, copy) void (^pauseChanged)(void);
- (void)togglePause:(id)sender;
- (void)checkpoint;
- (void)runPausable:(BOOL)pausable task:(id (^)(void))task completion:(void (^)(id result, NSString *error))completion;
@property(nonatomic, copy) NSString *message;
@property(nonatomic, copy) void (^messageChanged)(void);
@property(nonatomic, copy) void (^busyChanged)(BOOL busy);
@property(nonatomic, copy) void (^idle)(void);
- (void)runBackground:(id (^)(BOOL (^cancelled)(void)))task completion:(void (^)(id result, NSString *error))completion;
- (void)run:(id (^)(void))task completion:(void (^)(id result, NSString *error))completion;
@end


@interface YBPanel : NSView
@property(nonatomic,copy) void (^frameLayout)(NSSize size);
@end
FOUNDATION_EXPORT NSString *YBDisplayDate(id value);

