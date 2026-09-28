#import <Cocoa/Cocoa.h>

FOUNDATION_EXPORT NSString * const PP6CoreSchemaVersion;

NSString *PP6NFC(NSString *s);
NSString *PP6ExpandPath(NSString *s);
NSString *PP6SHA256String(NSString *s);
NSArray<NSString *> *PP6ScanFiles(NSString *root, BOOL pro6Only);
NSDictionary *PP6BuildMediaIndex(NSArray<NSString *> *roots);
NSDictionary *PP6ParseDocument(NSString *path,
                               NSArray<NSString *> *managedMediaRoots,
                               NSDictionary *managedMediaIndex,
                               NSArray<NSString *> *packageAssetRoots,
                               NSDictionary *packageAssetIndex,
                               BOOL includeSlides);
NSDictionary *PP6CompareParsedDocuments(NSDictionary *oldDoc, NSDictionary *newDoc);
NSString *PP6RelativePath(NSString *path, NSString *root);
