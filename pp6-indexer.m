#import <Cocoa/Cocoa.h>
#import "PP6Core.h"

static void Usage(void) {
    printf("PP6 Indexer v0.2\n");
    printf("Usage: pp6-indexer [--documents PATH] [--media PATH ...] [--output FILE]\n");
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSString *documents = PP6ExpandPath(@"~/Documents/ProPresenter6");
        NSMutableArray *mediaRoots = [NSMutableArray arrayWithArray:@[@"/Users/Shared/Renewed Vision Media", @"/Users/Shared/ProCG Content"]];
        NSString *output = PP6ExpandPath(@"~/Desktop/pp6-index-v0.2.json");
        BOOL customMedia = NO;
        for (int i=1;i<argc;i++) {
            NSString *a=[NSString stringWithUTF8String:argv[i]];
            if ([a isEqualToString:@"--help"] || [a isEqualToString:@"-h"]) { Usage(); return 0; }
            if ([a isEqualToString:@"--documents"] && i+1<argc) { documents=PP6ExpandPath([NSString stringWithUTF8String:argv[++i]]); continue; }
            if ([a isEqualToString:@"--media"] && i+1<argc) { if(!customMedia){[mediaRoots removeAllObjects];customMedia=YES;} [mediaRoots addObject:PP6ExpandPath([NSString stringWithUTF8String:argv[++i]])]; continue; }
            if ([a isEqualToString:@"--output"] && i+1<argc) { output=PP6ExpandPath([NSString stringWithUTF8String:argv[++i]]); continue; }
            fprintf(stderr,"Unknown/incomplete argument: %s\n",a.UTF8String); Usage(); return 2;
        }
        NSFileManager *fm=[NSFileManager defaultManager]; BOOL dir=NO;
        if (![fm fileExistsAtPath:documents isDirectory:&dir] || !dir) { fprintf(stderr,"Documents folder not found: %s\n",documents.UTF8String); return 3; }
        NSMutableArray *validMedia=[NSMutableArray array];
        for(NSString *r in mediaRoots){BOOL d=NO;if([fm fileExistsAtPath:r isDirectory:&d]&&d)[validMedia addObject:r];}

        printf("PP6 Indexer v0.2\nDocuments: %s\n",documents.UTF8String);
        printf("[1/3] Building media index...\n");
        NSDictionary *mediaIndex=PP6BuildMediaIndex(validMedia);
        printf("  media files: %lu\n",(unsigned long)[mediaIndex[@"assets"] count]);
        NSArray *paths=PP6ScanFiles(documents,YES);
        printf("[2/3] Parsing %lu documents...\n",(unsigned long)paths.count);
        NSMutableArray *docs=[NSMutableArray array]; NSMutableDictionary *statusCounts=[NSMutableDictionary dictionary];
        NSInteger n=0;
        for(NSString *p in paths){
            @autoreleasepool {
                NSMutableDictionary *d=[PP6ParseDocument(p,validMedia,mediaIndex,@[],@{},NO) mutableCopy];
                d[@"relativePath"]=PP6RelativePath(p,documents); d[@"normalizedRelativePath"]=PP6NFC(d[@"relativePath"]);
                for(NSDictionary *r in d[@"mediaRefs"] ?: @[]){NSString *s=r[@"resolution"][@"status"] ?: @"unknown";statusCounts[s]=@([statusCounts[s] integerValue]+1);} [docs addObject:d];
            }
            n++; if(n%100==0||n==paths.count){printf("\r  %ld / %lu",(long)n,(unsigned long)paths.count);fflush(stdout);}
        }
        printf("\n[3/3] Writing JSON...\n");
        NSDictionary *result=@{ @"schema":@"pp6-local-index-v0.2", @"coreSchema":PP6CoreSchemaVersion,
                                @"createdAt":@((long long)[[NSDate date] timeIntervalSince1970]),
                                @"documentsRoot":documents,@"mediaRoots":validMedia,
                                @"stats":@{ @"documents":@(docs.count), @"mediaAssets":@([mediaIndex[@"assets"] count]), @"mediaResolutionCounts":statusCounts },
                                @"documents":docs,
                                @"notes":@[@"v0.2 adds semanticFingerprint for each .pro6 document.",@"Actual paths are preserved. normalizedRelativePath is matching-only.",@"This tool is read-only."] };
        NSError *err=nil; NSData *json=[NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:&err];
        if(!json){fprintf(stderr,"JSON error: %s\n",err.localizedDescription.UTF8String);return 4;}
        [fm createDirectoryAtPath:[output stringByDeletingLastPathComponent] withIntermediateDirectories:YES attributes:nil error:nil];
        if(![json writeToFile:output options:NSDataWritingAtomic error:&err]){fprintf(stderr,"Write error: %s\n",err.localizedDescription.UTF8String);return 5;}
        printf("Done: %s\n",output.UTF8String);
        printf("Resolution counts:\n"); for(NSString *k in [[statusCounts allKeys] sortedArrayUsingSelector:@selector(compare:)]) printf("  %-18s %ld\n",k.UTF8String,(long)[statusCounts[k] integerValue]);
    }
    return 0;
}
