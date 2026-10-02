#import <Foundation/Foundation.h>
FOUNDATION_EXPORT NSDictionary *YBPlaylistTree(NSData *data);
FOUNDATION_EXPORT NSArray *YBPlaylistNodes(NSData *data);
FOUNDATION_EXPORT NSDictionary *YBPlaylistNode(NSData *data, NSString *identifier);
FOUNDATION_EXPORT NSString *YBPlaylistReference(NSString *source, NSString *root);
FOUNDATION_EXPORT NSString *YBPlaylistLocalXML(NSDictionary *plan, NSString *root);
FOUNDATION_EXPORT NSData *YBPlaylistReplacing(NSData *data, NSString *identifier, NSString *xml);
FOUNDATION_EXPORT NSData *YBPlaylistRemoving(NSData *data, NSString *identifier);
