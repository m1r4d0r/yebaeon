#import <Cocoa/Cocoa.h>
FOUNDATION_EXPORT void YBValidatePlaylist(NSData *data);
FOUNDATION_EXPORT NSData *YBReadPlaylist(NSURL *url);
FOUNDATION_EXPORT NSURL *YBReplacePlaylist(NSURL *url, NSData *expected, NSData *replacement, NSString *backupRoot, BOOL (^presenterRunning)(void));
