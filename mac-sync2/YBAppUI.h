#import <Cocoa/Cocoa.h>
// 차이 창(YBDocumentComparison)이 쓰는 화면 조각.
FOUNDATION_EXPORT NSTextField *YBLabel(NSString *text, NSRect frame, CGFloat size, BOOL bold);
FOUNDATION_EXPORT NSTableView *YBTable(NSView *parent, NSRect frame, NSArray *columns, id delegate);
