#import <Cocoa/Cocoa.h>
FOUNDATION_EXPORT NSTextField *YBLabel(NSString *text, NSRect frame, CGFloat size, BOOL bold);
FOUNDATION_EXPORT NSButton *YBButton(NSString *title, NSRect frame, id target, SEL action);
FOUNDATION_EXPORT NSTableView *YBTable(NSView *parent, NSRect frame, NSArray *columns, id delegate);
FOUNDATION_EXPORT void YBAlert(NSString *title, NSString *message);
FOUNDATION_EXPORT BOOL YBConfirm(NSString *title, NSString *message, NSString *action);
FOUNDATION_EXPORT NSString *YBChooseFolder(NSString *title, NSString *current);
FOUNDATION_EXPORT void YBShowText(NSString *title, NSString *text);
FOUNDATION_EXPORT NSString *YBPreferencesDirectory(void);
FOUNDATION_EXPORT NSDictionary *YBPreferences(NSString *name);
FOUNDATION_EXPORT void YBSavePreferences(NSString *name, NSDictionary *value);
FOUNDATION_EXPORT NSString *YBStatusName(NSString *status);
FOUNDATION_EXPORT NSString *YBProfilePath(NSString *root, NSString *origin);

@interface YBWork : NSObject
@property(nonatomic, readonly) BOOL busy;
@property(nonatomic, copy) void (^busyChanged)(BOOL busy);
- (void)run:(id (^)(void))task completion:(void (^)(id result, NSString *error))completion;
@end
