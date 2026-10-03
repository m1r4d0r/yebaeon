#import "YBMediaController.h"
#import "../mac-sync/PP6Core.h"
#import "../mac-sync/YBSync.h"
#import <CommonCrypto/CommonDigest.h>
#import <errno.h>
#import <fcntl.h>
#import <sys/stat.h>
#import <unistd.h>

// Read-only preparation. This report is not proof that any bytes are on the
// server, nor permission to remove a local file. Transfers must revalidate it.
static NSArray *DocumentPaths(NSString *root) {
    NSFileManager *manager=NSFileManager.defaultManager;NSMutableArray *paths=[NSMutableArray array];
    NSDirectoryEnumerator *enumerator=[manager enumeratorAtURL:[NSURL fileURLWithPath:root] includingPropertiesForKeys:nil options:0 errorHandler:^BOOL(NSURL *url,NSError *error){YBRequire(NO,[@"문서 폴더를 끝까지 읽지 못했습니다: " stringByAppendingString:error.localizedDescription]);return NO;}];
    YBRequire(enumerator!=nil,@"문서 폴더 목록을 읽지 못했습니다.");
    for(NSURL *url in enumerator){struct stat st;YBRequire(lstat(url.path.fileSystemRepresentation,&st)==0 && !S_ISLNK(st.st_mode),@"문서 폴더의 링크 또는 읽기 오류를 확인하세요.");if([url.path.pathExtension.lowercaseString isEqual:@"pro6"]){YBRequire(S_ISREG(st.st_mode),@"일반 문서 파일이 아닙니다.");[paths addObject:url.path];}}
    return [paths sortedArrayUsingSelector:@selector(compare:)];
}
static NSString *ImageSourcePath(NSString *source) {
    if([source hasPrefix:@"file:"]){NSURLComponents *url=[NSURLComponents componentsWithString:source];if(!url || url.host.length || url.query.length || url.fragment.length)return nil;source=url.path;}
    else if([source containsString:@"://"])return nil;
    source=source.stringByExpandingTildeInPath;
    if(!source.isAbsolutePath)return nil;
    for(NSString *part in source.pathComponents)if([part isEqual:@".."] || [part isEqual:@"."])return nil;
    return source;
}
static NSDictionary *MediaIdentity(NSString *path, void (^check)(void)) {
    YBRequire(path.isAbsolutePath,@"절대 미디어 경로가 필요합니다.");
    int fd=open(path.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW|O_NONBLOCK);
    YBRequire(fd>=0,@"원본 미디어를 열지 못했습니다. 링크·권한·경로를 확인하세요.");
    @try {
        struct stat before,after;
        YBRequire(fstat(fd,&before)==0 && S_ISREG(before.st_mode) && before.st_size>0,@"비어 있거나 일반 파일이 아닌 미디어입니다.");
        CC_SHA256_CTX context;CC_SHA256_Init(&context);unsigned char buffer[1024*256];off_t size=0;
        for(;;){if(check)check();ssize_t n=read(fd,buffer,sizeof(buffer));if(n<0 && errno==EINTR)continue;YBRequire(n>=0,@"미디어를 읽는 중 오류가 발생했습니다.");if(!n)break;CC_SHA256_Update(&context,buffer,(CC_LONG)n);size+=n;}
        struct stat named;
        YBRequire(fstat(fd,&after)==0 && lstat(path.fileSystemRepresentation,&named)==0 && S_ISREG(named.st_mode) && named.st_ino==before.st_ino && named.st_dev==before.st_dev && size==before.st_size && after.st_size==before.st_size && after.st_mtimespec.tv_sec==before.st_mtimespec.tv_sec && after.st_mtimespec.tv_nsec==before.st_mtimespec.tv_nsec && after.st_ctimespec.tv_sec==before.st_ctimespec.tv_sec && after.st_ctimespec.tv_nsec==before.st_ctimespec.tv_nsec,@"확인 중 미디어가 바뀌었습니다. 다시 점검하세요.");
        unsigned char digest[CC_SHA256_DIGEST_LENGTH];CC_SHA256_Final(digest,&context);NSMutableString *hash=[NSMutableString string];for(NSUInteger i=0;i<sizeof(digest);i++)[hash appendFormat:@"%02x",digest[i]];
        return @{@"sha256":hash,@"size":@(size),@"path":path,@"device":@(before.st_dev),@"inode":@(before.st_ino),@"mtime":@[@(before.st_mtimespec.tv_sec),@(before.st_mtimespec.tv_nsec)],@"ctime":@[@(before.st_ctimespec.tv_sec),@(before.st_ctimespec.tv_nsec)]};
    }@finally{close(fd);}
}

static BOOL StillCurrent(NSDictionary *identity) {
    struct stat st;if(lstat([identity[@"path"] fileSystemRepresentation],&st)!=0 || !S_ISREG(st.st_mode))return NO;
    return st.st_size==[identity[@"size"] longLongValue] && st.st_dev==[identity[@"device"] longLongValue] && st.st_ino==[identity[@"inode"] unsignedLongLongValue] && st.st_mtimespec.tv_sec==[identity[@"mtime"][0] longLongValue] && st.st_mtimespec.tv_nsec==[identity[@"mtime"][1] longLongValue] && st.st_ctimespec.tv_sec==[identity[@"ctime"][0] longLongValue] && st.st_ctimespec.tv_nsec==[identity[@"ctime"][1] longLongValue];
}

NSData *YBReadPreparedImage(NSString *path,NSString *expectedHash,unsigned long long expectedSize,void (^check)(void)) {
    YBRequire(expectedSize>0 && expectedSize<=32ULL*1024*1024, @"이미지는 32 MiB 이하만 전송할 수 있습니다.");
    int fd=open(path.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW|O_NONBLOCK);YBRequire(fd>=0,@"원본 이미지를 안전하게 열지 못했습니다.");
    @try{struct stat before,after,named;YBRequire(fstat(fd,&before)==0&&S_ISREG(before.st_mode)&&before.st_size==expectedSize,@"점검 후 이미지가 바뀌었거나 일반 파일이 아닙니다.");
        CC_SHA256_CTX context;CC_SHA256_Init(&context);NSMutableData *data=[NSMutableData dataWithCapacity:(NSUInteger)expectedSize];unsigned char buffer[1024*256];
        for(;;){if(check)check();ssize_t n=read(fd,buffer,sizeof(buffer));if(n<0&&errno==EINTR)continue;YBRequire(n>=0,@"이미지를 읽는 중 오류가 발생했습니다.");if(!n)break;[data appendBytes:buffer length:(NSUInteger)n];CC_SHA256_Update(&context,buffer,(CC_LONG)n);}
        YBRequire(fstat(fd,&after)==0&&lstat(path.fileSystemRepresentation,&named)==0&&S_ISREG(named.st_mode)&&named.st_dev==before.st_dev&&named.st_ino==before.st_ino&&after.st_size==before.st_size&&after.st_mtimespec.tv_sec==before.st_mtimespec.tv_sec&&after.st_mtimespec.tv_nsec==before.st_mtimespec.tv_nsec&&after.st_ctimespec.tv_sec==before.st_ctimespec.tv_sec&&after.st_ctimespec.tv_nsec==before.st_ctimespec.tv_nsec,@"전송 중 이미지 원본이 바뀌었습니다.");
        unsigned char digest[CC_SHA256_DIGEST_LENGTH];CC_SHA256_Final(digest,&context);NSMutableString *actual=[NSMutableString string];for(NSUInteger i=0;i<sizeof(digest);i++)[actual appendFormat:@"%02x",digest[i]];YBRequire([actual isEqual:expectedHash]&&data.length==expectedSize,@"점검 후 이미지 내용이 달라졌습니다. 다시 확인하세요.");return data;
    }@finally{close(fd);}
}

NSDictionary *YBImagePreparationReport(NSString *root,NSArray *mediaRoots,void (^check)(void)) {
    BOOL directory=NO;YBRequire([NSFileManager.defaultManager fileExistsAtPath:root isDirectory:&directory] && directory,@"설정에서 문서 폴더를 선택하세요.");
    NSArray *allPaths=DocumentPaths(root);
    NSMutableDictionary *uses=[NSMutableDictionary dictionary],*files=[NSMutableDictionary dictionary],*documents=[NSMutableDictionary dictionary],*assets=[NSMutableDictionary dictionary];
    NSMutableArray *rows=[NSMutableArray array],*errors=[NSMutableArray array];NSMutableDictionary *counts=[NSMutableDictionary dictionary];
    for(NSString *path in allPaths)uses[PP6RelativePath(path,root)]=@YES;
    NSUInteger excludedVideos=0;
    for(NSString *path in [uses.allKeys sortedArrayUsingSelector:@selector(compare:)]){@autoreleasepool{
        if(check)check();
        @try{
            NSData *data=YBReadSafeFile(root,path,NULL);YBRequire(data!=nil,@"연결된 문서 원본을 찾지 못했습니다.");YBValidateDocument(data);documents[path]=YBHash(data);
            // Only exact original paths are eligible. A unique basename is not
            // evidence of identity; do not scan all media folders to guess it.
            NSDictionary *parsed=PP6ParseDocumentData(data,path,mediaRoots,@{},@[],@{},NO);YBRequire(![parsed[@"parseError"] length],parsed[@"parseError"] ?: @"문서 분석 실패");
            NSXMLDocument *xml=[[NSXMLDocument alloc] initWithData:data options:NSXMLNodeLoadExternalEntitiesNever error:NULL];
            NSArray *sourceNodes=[xml nodesForXPath:@"//*[@source and string-length(@source)>0]" error:NULL];
            NSUInteger counted=0;for(NSDictionary *reference in parsed[@"mediaRefs"])if([reference[@"source"] length])counted++;
            if(sourceNodes.count!=counted)[errors addObject:@{@"path":path,@"message":@"슬라이드 밖 또는 지원하지 않는 미디어 참조가 있습니다. 누락 없이 별도 확인해야 합니다."}];
            for(NSDictionary *reference in parsed[@"mediaRefs"]){
                NSMutableDictionary *row=[reference mutableCopy];row[@"document"]=path;
                NSString *source=ImageSourcePath(reference[@"source"]),*status=@"missing";
                BOOL exists=source.length && [NSFileManager.defaultManager fileExistsAtPath:source];
                if(exists){status=@"exact-external";for(NSString *folder in mediaRoots)if([source hasPrefix:[folder stringByAppendingString:@"/"]])status=@"exact-managed";}
                row[@"sourcePath"]=source ?: reference[@"source"] ?: @"";row[@"resolution"]=exists ? @{@"status":status,@"resolvedPath":source} : @{@"status":status};
                if(source)row[@"basename"]=source.lastPathComponent;
                // PP6 may store a still image in RVVideoElement. Classify by
                // the referenced filename first; unknown types stay unresolved.
                NSString *sourceName=source ?: reference[@"source"] ?: @"";
                NSString *extension=sourceName.pathExtension.lowercaseString;
                BOOL stillImage=[@[@"jpg",@"jpeg",@"png",@"gif",@"bmp",@"tif",@"tiff",@"heic",@"heif",@"webp",@"psd",@"pdf"] containsObject:extension];
                BOOL video=[@[@"mov",@"mp4",@"m4v",@"avi",@"mkv",@"wmv",@"webm",@"mpg",@"mpeg"] containsObject:extension];
                if(video){row[@"status"]=@"video-local-only";row[@"transferState"]=@"영상 제외";[rows addObject:row];excludedVideos++;continue;}
                row[@"status"]=status;row[@"transferState"]=@"확인 필요";
                if(!stillImage){row[@"error"]=@"이미지 형식을 확인해야 합니다. 알 수 없는 형식은 전송 대상으로 확정하지 않습니다.";[rows addObject:row];continue;}
                if([@[@"exact-managed",@"exact-external",@"exact-package"] containsObject:status]){
                    @try{YBRequire([reference[@"source"] length]<=4096,@"문서의 원본 경로가 참조 API 최대 길이 4096자를 넘습니다.");NSDictionary *identity=files[source];if(!identity){identity=MediaIdentity(source,check);files[source]=identity;}YBRequire([identity[@"size"] unsignedLongLongValue]<=32ULL*1024*1024,@"이미지가 32 MiB를 넘어 현재 단일 업로드 범위 밖입니다.");YBRequire(StillCurrent(identity),@"확인 중 미디어가 바뀌었습니다.");row[@"sha256"]=identity[@"sha256"];row[@"size"]=identity[@"size"];row[@"transferState"]=@"원본 확인";
                        NSMutableDictionary *asset=assets[identity[@"sha256"]];if(!asset){asset=[@{@"sha256":identity[@"sha256"],@"size":identity[@"size"],@"paths":[NSMutableSet set],@"documents":[NSMutableSet set],@"references":@0} mutableCopy];assets[identity[@"sha256"]]=asset;}[asset[@"paths"] addObject:source];[asset[@"documents"] addObject:path];asset[@"references"]=@([asset[@"references"] unsignedIntegerValue]+1);
                    }@catch(NSException *e){row[@"transferState"]=@"읽기 실패";row[@"error"]=e.reason ?: @"미디어 확인 실패";}
                }
                counts[status]=@([counts[status] unsignedIntegerValue]+1);[rows addObject:row];
            }
        }@catch(NSException *e){[errors addObject:@{@"path":path,@"message":e.reason ?: @"문서 확인 실패"}];}
    }}
    // A late change invalidates the preparation; no stale hash becomes ready.
    for(NSString *path in documents){if(check)check();if(![YBHash(YBReadSafeFile(root,path,NULL)) isEqual:documents[path]])[errors addObject:@{@"path":path,@"message":@"점검 중 문서가 바뀌었습니다."}];}
    for(NSDictionary *identity in files.allValues)if(!StillCurrent(identity))[errors addObject:@{@"path":identity[@"path"],@"message":@"점검 중 미디어가 바뀌었습니다."}];
    if(![DocumentPaths(root) isEqual:allPaths])[errors addObject:@{@"path":root,@"message":@"점검 중 문서 목록이 바뀌었습니다."}];
    unsigned long long uniqueBytes=0,sourceBytes=0;NSMutableArray *list=[NSMutableArray array];
    for(NSDictionary *file in files.allValues)sourceBytes+=[file[@"size"] unsignedLongLongValue];
    for(NSString *hash in [assets.allKeys sortedArrayUsingSelector:@selector(compare:)]){NSMutableDictionary *asset=[assets[hash] mutableCopy];asset[@"paths"]=[[asset[@"paths"] allObjects] sortedArrayUsingSelector:@selector(compare:)];asset[@"documents"]=[[asset[@"documents"] allObjects] sortedArrayUsingSelector:@selector(compare:)];uniqueBytes+=[asset[@"size"] unsignedLongLongValue];[list addObject:asset];}
    NSUInteger unresolved=0;for(NSDictionary *row in rows)if(![@[@"원본 확인",@"영상 제외"] containsObject:row[@"transferState"]])unresolved++;
    return @{@"schema":@"yebaeon-image-preparation-v1",@"scope":@"all-documents",@"documentsRoot":root,@"mediaRoots":mediaRoots,@"documents":@(uses.count),@"documentHashes":documents,@"assets":@(assets.count),@"sourceFiles":@(files.count),@"uniqueBytes":@(uniqueBytes),@"duplicateBytes":@(sourceBytes-uniqueBytes),@"unresolved":@(unresolved),@"excludedVideos":@(excludedVideos),@"counts":counts,@"rows":rows,@"errors":errors,@"uniqueAssets":list,@"prepared":@(errors.count==0 && unresolved==0),@"serverVerified":@NO};
}
