#import "YBAppUI.h"
FOUNDATION_EXPORT NSArray *YBComparisonRows(NSDictionary *local, NSDictionary *remote);
FOUNDATION_EXPORT NSAttributedString *YBHighlightedLines(NSString *text,NSString *other,BOOL server);
@interface YBDocumentComparison : NSView <NSTableViewDataSource,NSTableViewDelegate>
- (instancetype)initWithLocal:(NSDictionary *)local remote:(NSDictionary *)remote;
@property NSData *localFile, *remoteFile;   // [파일 전체 복사]용 원본 바이트
@end
