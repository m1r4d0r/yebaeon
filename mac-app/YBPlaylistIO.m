#import "YBPlaylistIO.h"
#import "../mac-sync/YBSync.h"
#import <sys/file.h>
#import <fcntl.h>
#import <unistd.h>
void YBValidatePlaylist(NSData *data) {
    YBRequire(data.length && data.length<=25*1024*1024,@"재생목록은 25 MiB 이하여야 합니다.");
    NSString *text=[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    YBRequire(text && [text rangeOfString:@"(?i)<!DOCTYPE|<!ENTITY" options:NSRegularExpressionSearch].location==NSNotFound,@"UTF-8 재생목록이 아니거나 외부 엔터티가 있습니다.");
    NSXMLDocument *xml=[[NSXMLDocument alloc] initWithData:data options:NSXMLNodeLoadExternalEntitiesNever error:NULL];
    YBRequire([xml.rootElement.name isEqual:@"RVPlaylistDocument"],@"올바른 PP6 재생목록 XML이 아닙니다.");
    NSMutableSet *keys=[NSMutableSet set];
    for(NSXMLElement *node in [xml nodesForXPath:@"/RVPlaylistDocument/RVPlaylistNode/RVPlaylistNode | /RVPlaylistDocument/RVPlaylistNode/array/RVPlaylistNode" error:NULL]) {
        NSString *key=[node attributeForName:@"UUID"].stringValue;
        if(!key.length)key=[node attributeForName:@"displayName"].stringValue;
        YBRequire(key.length && ![keys containsObject:key],@"구분할 수 없는 중복 재생목록이 있습니다."); [keys addObject:key];
    }
}
NSData *YBReadPlaylist(NSURL *url) {
    YBRequire(url.isFileURL && [url.pathExtension.lowercaseString isEqual:@"pro6pl"],@".pro6pl 파일을 선택해 주세요.");
    NSString *root=url.path.stringByDeletingLastPathComponent.stringByResolvingSymlinksInPath;
    NSData *data=YBReadSafeFile(root,url.lastPathComponent,NULL); YBValidatePlaylist(data); return data;
}
NSURL *YBReplacePlaylist(NSURL *url,NSData *expected,NSData *replacement,NSString *backupRoot,BOOL (^presenterRunning)(void)) {
    YBValidatePlaylist(expected); YBValidatePlaylist(replacement);
    YBRequire(url.isFileURL && [url.pathExtension.lowercaseString isEqual:@"pro6pl"],@"재생목록 경로가 올바르지 않습니다.");
    NSString *root=url.path.stringByDeletingLastPathComponent.stringByResolvingSymlinksInPath, *leaf=url.lastPathComponent;
    NSString *lockPath=[root stringByAppendingPathComponent:@".yebaeon-playlist.lock"];
    int lock=open(lockPath.fileSystemRepresentation,O_RDWR|O_CREAT|O_NOFOLLOW,0600);
    YBRequire(lock>=0,@"재생목록 잠금 파일을 만들지 못했습니다.");
    @try {
        YBRequire(flock(lock,LOCK_EX|LOCK_NB)==0,@"다른 예배온 작업이 이 폴더의 재생목록을 수정 중입니다.");
        mode_t mode=0600; NSData *before=YBReadSafeFile(root,leaf,&mode);
        YBRequire([before isEqual:expected],@"비교한 뒤 운영 파일이 바뀌었습니다. ‘다시 비교’ 후 적용해 주세요.");
        YBRequire(!presenterRunning(),@"ProPresenter를 종료한 후 적용해 주세요.");
        YBRequire([NSFileManager.defaultManager createDirectoryAtPath:backupRoot withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:NULL],@"백업 폴더를 만들지 못했습니다.");
        backupRoot=backupRoot.stringByResolvingSymlinksInPath;
        NSString *backup=[NSUUID.UUID.UUIDString stringByAppendingPathComponent:leaf];
        YBWriteSafeFile(backupRoot,backup,before,0600,nil);
        YBRequire([YBReadSafeFile(backupRoot,backup,NULL) isEqual:before],@"백업 원본 검증에 실패했습니다.");
        YBWriteSafeFile(root,leaf,replacement,mode,^{
            YBRequire(!presenterRunning(),@"ProPresenter가 실행됐습니다. 적용을 중단했습니다.");
            YBRequire([YBReadSafeFile(root,leaf,NULL) isEqual:before],@"적용 직전에 운영 파일이 바뀌었습니다.");
        });
        // A concurrent external edit is preserved. The original is available at the reported backup path.
        YBRequire([YBReadSafeFile(root,leaf,NULL) isEqual:replacement],[NSString stringWithFormat:@"적용 직후 파일이 바뀌어 자동 복원하지 않았습니다. 원본 백업: %@",[backupRoot stringByAppendingPathComponent:backup]]);
        return [NSURL fileURLWithPath:[backupRoot stringByAppendingPathComponent:backup]];
    } @finally { close(lock); }
}
