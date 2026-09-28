#import <Cocoa/Cocoa.h>
#import "PP6Core.h"

static void Usage(void){
    printf("PP6 Document Comparator v0.1\n");
    printf("Usage:\n");
    printf("  pp6-doc-compare --local-documents PATH --update PATH [--media PATH ...] [--output FILE]\n");
    printf("\nUpdate folder layout:\n  update/documents/*.pro6\n  update/assets/** (optional)\n");
}

static NSDictionary *MapByNormalizedRelative(NSArray<NSString *> *paths, NSString *root) {
    NSMutableDictionary *map=[NSMutableDictionary dictionary];
    for(NSString *p in paths){NSString *rel=PP6RelativePath(p,root),*key=PP6NFC(rel);NSMutableArray *a=map[key];if(!a){a=[NSMutableArray array];map[key]=a;}[a addObject:p];}
    return map;
}

static NSDictionary *DependencySummary(NSDictionary *doc){
    NSMutableDictionary *c=[NSMutableDictionary dictionary];
    for(NSDictionary *r in doc[@"mediaRefs"] ?: @[]){NSString *s=r[@"resolution"][@"status"] ?: @"unknown";c[s]=@([c[s] integerValue]+1);}
    return c;
}

int main(int argc,const char *argv[]){
    @autoreleasepool {
        NSString *local=PP6ExpandPath(@"~/Documents/ProPresenter6"),*update=nil,*output=PP6ExpandPath(@"~/Desktop/pp6-document-diff.json");
        NSMutableArray *mediaRoots=[NSMutableArray arrayWithArray:@[@"/Users/Shared/Renewed Vision Media",@"/Users/Shared/ProCG Content"]];BOOL customMedia=NO;
        for(int i=1;i<argc;i++){
            NSString *a=[NSString stringWithUTF8String:argv[i]];
            if([a isEqualToString:@"--help"]||[a isEqualToString:@"-h"]){Usage();return 0;}
            if([a isEqualToString:@"--local-documents"]&&i+1<argc){local=PP6ExpandPath([NSString stringWithUTF8String:argv[++i]]);continue;}
            if([a isEqualToString:@"--update"]&&i+1<argc){update=PP6ExpandPath([NSString stringWithUTF8String:argv[++i]]);continue;}
            if([a isEqualToString:@"--media"]&&i+1<argc){if(!customMedia){[mediaRoots removeAllObjects];customMedia=YES;}[mediaRoots addObject:PP6ExpandPath([NSString stringWithUTF8String:argv[++i]])];continue;}
            if([a isEqualToString:@"--output"]&&i+1<argc){output=PP6ExpandPath([NSString stringWithUTF8String:argv[++i]]);continue;}
            fprintf(stderr,"Unknown/incomplete argument: %s\n",a.UTF8String);Usage();return 2;
        }
        if(!update.length){fprintf(stderr,"--update is required\n");Usage();return 2;}
        NSString *incomingDocs=[update stringByAppendingPathComponent:@"documents"],*assetsRoot=[update stringByAppendingPathComponent:@"assets"];
        NSFileManager *fm=[NSFileManager defaultManager];BOOL d=NO;
        if(![fm fileExistsAtPath:local isDirectory:&d]||!d){fprintf(stderr,"Local Documents not found: %s\n",local.UTF8String);return 3;}
        d=NO;if(![fm fileExistsAtPath:incomingDocs isDirectory:&d]||!d){fprintf(stderr,"Update documents folder not found: %s\n",incomingDocs.UTF8String);return 3;}
        NSMutableArray *validMedia=[NSMutableArray array];for(NSString*r in mediaRoots){BOOL x=NO;if([fm fileExistsAtPath:r isDirectory:&x]&&x)[validMedia addObject:r];}
        NSArray *packageRoots=@[];BOOL ad=NO;if([fm fileExistsAtPath:assetsRoot isDirectory:&ad]&&ad)packageRoots=@[assetsRoot];
        printf("[1/4] Media index...\n");NSDictionary *managedIndex=PP6BuildMediaIndex(validMedia),*packageIndex=PP6BuildMediaIndex(packageRoots);
        printf("[2/4] File maps...\n");NSArray *localPaths=PP6ScanFiles(local,YES),*incomingPaths=PP6ScanFiles(incomingDocs,YES);NSDictionary *localMap=MapByNormalizedRelative(localPaths,local);
        NSMutableArray *results=[NSMutableArray array];NSInteger added=0,modified=0,same=0,conflict=0;
        printf("[3/4] Comparing %lu incoming documents...\n",(unsigned long)incomingPaths.count);NSInteger n=0;
        for(NSString *ip in incomingPaths){
            @autoreleasepool {
                NSString *rel=PP6RelativePath(ip,incomingDocs),*key=PP6NFC(rel);NSArray *locals=localMap[key] ?: @[];
                NSDictionary *newDoc=PP6ParseDocument(ip,validMedia,managedIndex,packageRoots,packageIndex,YES);
                NSMutableDictionary *row=[@{ @"relativePath":rel,@"normalizedRelativePath":key,@"incomingPath":ip,@"dependencySummary":DependencySummary(newDoc),@"incomingSemanticFingerprint":newDoc[@"semanticFingerprint"] ?: @"" } mutableCopy];
                if(locals.count==0){row[@"status"]=@"added";row[@"newSlideCount"]=newDoc[@"slideCount"] ?: @0;added++;}
                else if(locals.count>1){row[@"status"]=@"conflict";row[@"localCandidates"]=locals;conflict++;}
                else {
                    NSString *lp=locals.firstObject;NSDictionary *oldDoc=PP6ParseDocument(lp,validMedia,managedIndex,@[],@{},YES);row[@"localPath"]=lp;row[@"localSemanticFingerprint"]=oldDoc[@"semanticFingerprint"] ?: @"";
                    if([oldDoc[@"semanticFingerprint"] isEqualToString:newDoc[@"semanticFingerprint"]]){row[@"status"]=@"same";same++;}
                    else {row[@"status"]=@"modified";row[@"diff"]=PP6CompareParsedDocuments(oldDoc,newDoc);modified++;}
                }
                [results addObject:row];
            }
            n++;if(n%20==0||n==incomingPaths.count){printf("\r  %ld / %lu",(long)n,(unsigned long)incomingPaths.count);fflush(stdout);}
        }
        printf("\n[4/4] Writing JSON...\n");
        NSDictionary *report=@{ @"schema":@"pp6-document-diff-v0.1",@"coreSchema":PP6CoreSchemaVersion,@"createdAt":@((long long)[[NSDate date] timeIntervalSince1970]),
                                @"localDocumentsRoot":local,@"updateRoot":update,@"incomingDocumentsRoot":incomingDocs,@"packageAssetsRoot":packageRoots.count?assetsRoot:@"",
                                @"summary":@{ @"added":@(added),@"modified":@(modified),@"same":@(same),@"conflict":@(conflict) },@"documents":results,
                                @"notes":@[@"Read-only comparator. No file is overwritten.",@"Documents are matched by NFC-normalized relative path, while actual paths are preserved.",@"Slide matching: group UUID -> slide UUID -> LCS of semantic identity tokens -> unique semantic fallback."] };
        NSError *err=nil;NSData *json=[NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingPrettyPrinted error:&err];if(!json){fprintf(stderr,"JSON error: %s\n",err.localizedDescription.UTF8String);return 4;}[fm createDirectoryAtPath:[output stringByDeletingLastPathComponent] withIntermediateDirectories:YES attributes:nil error:nil];if(![json writeToFile:output options:NSDataWritingAtomic error:&err]){fprintf(stderr,"Write error: %s\n",err.localizedDescription.UTF8String);return 5;}
        printf("Done: %s\nSummary: added %ld / modified %ld / same %ld / conflict %ld\n",output.UTF8String,(long)added,(long)modified,(long)same,(long)conflict);
    }
    return 0;
}
