#import "YBLibrary.h"
@interface YBUploadJob : NSObject
@property NSDictionary *row;
@property NSData *data;
@property NSDictionary *saved;
@property NSString *failure;
@end
@implementation YBUploadJob
@end
@implementation YBLibrary
- (instancetype)initWithRoot:(NSString *)root profile:(NSString *)profile server:(YBServer *)server {
    if((self=[super init])) {_server=server;_sync=[[YBSync alloc] initWithRoot:root profile:profile origin:server.origin];}return self;
}
- (void)dealloc {[_sync close];}
- (NSArray *)refresh {
    NSMutableArray *result=[NSMutableArray array];NSISO8601DateFormatter *dates=[NSISO8601DateFormatter new];
    for(NSDictionary *row in [self.sync plan:[self.server documents]]) {
        NSMutableDictionary *copy=[row mutableCopy];NSDate *modified=[NSFileManager.defaultManager attributesOfItemAtPath:[self.sync.root stringByAppendingPathComponent:row[@"path"]] error:NULL][NSFileModificationDate];if(modified)copy[@"modifiedTime"]=@(modified.timeIntervalSince1970);
        if(row[@"localHash"]!=NSNull.null && !row[@"error"]) {
            @try {NSData *data=[self.sync readDocument:row[@"path"]];NSXMLDocument *xml=[[NSXMLDocument alloc] initWithData:data options:0 error:NULL];NSString *value=[[xml.rootElement attributeForName:@"lastDateUsed"] stringValue];NSDate *date=[dates dateFromString:value ?: @""];
                if(date){copy[@"lastDateUsed"]=value;copy[@"lastUsedTime"]=@(date.timeIntervalSince1970);}
            } @catch(NSException *error) {copy[@"dateWarning"]=@"최근 사용일을 읽지 못했습니다.";}
        }
        [result addObject:copy];
    }
    NSMutableArray *reports=[NSMutableArray array];for(NSDictionary *r in result){id remote=r[@"remote"];if([remote isKindOfClass:NSDictionary.class]) [reports addObject:@{@"kind":@"document",@"id":remote[@"id"],@"node":@"",@"serverHash":remote[@"sha256"],@"status":r[@"status"] ?: @"unknown"}];}
    [self reportSyncItems:reports];return result;
}
- (void)reportSyncItems:(NSArray *)items {
    // Optional telemetry never changes whether a local transfer succeeded.
    @try {
        NSString *identity=[NSString stringWithFormat:@"%@|%@|%@",self.sync.profile,self.sync.root,self.server.origin];
        NSString *device=YBHash([identity dataUsingEncoding:NSUTF8StringEncoding]);
        for(NSUInteger i=0;i<items.count;i+=400){NSArray *slice=[items subarrayWithRange:NSMakeRange(i,MIN((NSUInteger)400,items.count-i))];NSData *body=[NSJSONSerialization dataWithJSONObject:@{@"deviceId":device,@"items":slice} options:0 error:NULL];
            [self.server request:@"/api/sync-observations" method:@"POST" body:body headers:@{@"Content-Type":@"application/json"}];}
    }@catch(NSException *error){NSLog(@"Sync 상태 보고 실패: %@",error.reason);}
}

- (NSUInteger)uploadParallel:(NSArray *)rows progress:(void (^)(NSString *,NSUInteger))progress {
    NSUInteger count=0;NSOperationQueue *queue=[NSOperationQueue new];queue.maxConcurrentOperationCount=4;
    id activity=[NSProcessInfo.processInfo beginActivityWithOptions:NSActivityUserInitiated|NSActivityIdleSystemSleepDisabled reason:@"예배온 문서 업로드"];
    @try {
        for(NSUInteger offset=0;offset<rows.count;offset+=4) {@autoreleasepool {
            [self.sync assertReady];YBRequire(!self.sync.presenterRunning(),@"ProPresenter가 실행됐습니다. 작업을 중단했습니다.");
            NSMutableArray *jobs=[NSMutableArray array],*reports=[NSMutableArray array];
            for(NSUInteger i=offset;i<MIN(offset+4,rows.count);i++) {
                NSDictionary *row=rows[i];NSString *status=row[@"status"],*path=row[@"path"];
                YBRequire([status isEqual:@"same"] || [status isEqual:@"upload"],@"선택에 충돌 문서 또는 다른 방향의 문서가 있습니다. 다시 비교해 주세요.");
                NSString *hash=row[@"localHash"]==NSNull.null ? nil : row[@"localHash"];
                if([status isEqual:@"same"]) {NSDictionary *remote=row[@"remote"];NSDictionary *head=[self.server head:remote];YBRequire([head[@"version"] isEqual:remote[@"version"]] && [head[@"sha256"] isEqual:remote[@"sha256"]],@"서버 문서가 변경됐습니다. 다시 비교해 주세요.");[self.sync acknowledge:remote expectedLocalHash:hash];[reports addObject:@{@"kind":@"document",@"id":remote[@"id"],@"node":@"",@"serverHash":remote[@"sha256"],@"status":@"same"}];count++;if(progress)progress(path,count);continue;}
                NSData *data=[self.sync readDocument:path];YBRequire(hash && [YBHash(data) isEqual:hash],@"선택 후 로컬 문서가 바뀌었습니다. 다시 비교해 주세요.");
                NSDictionary *remote=row[@"remote"]==NSNull.null ? nil : row[@"remote"];
                YBRequire([YBDisposition(hash,remote,self.sync.entries[path]) isEqual:@"upload"],@"문서의 동기화 기준이 달라졌습니다. 다시 비교해 주세요.");
                YBUploadJob *job=[YBUploadJob new];job.row=row;job.data=data;[jobs addObject:job];
            }
            for(YBUploadJob *job in jobs)[queue addOperationWithBlock:^{@autoreleasepool {
                @try {NSDictionary *remote=job.row[@"remote"]==NSNull.null ? nil : job.row[@"remote"];
                    if(remote){NSDictionary *head=[self.server head:remote];YBRequire([head[@"version"] isEqual:remote[@"version"]] && [head[@"sha256"] isEqual:remote[@"sha256"]],@"서버 문서가 변경됐습니다. 다시 비교해 주세요.");}
                    job.saved=[self.server upload:job.data path:job.row[@"path"] previous:remote];
                } @catch(NSException *error){job.failure=error.reason ?: @"업로드 실패";}
            }}];
            [queue waitUntilAllOperationsAreFinished];NSMutableArray *failures=[NSMutableArray array];
            for(YBUploadJob *job in jobs) {
                if(job.failure){[failures addObject:[NSString stringWithFormat:@"%@: %@",job.row[@"path"],job.failure]];continue;}
                @try {[self.sync acknowledge:job.saved expectedLocalHash:job.row[@"localHash"]];[reports addObject:@{@"kind":@"document",@"id":job.saved[@"id"],@"node":@"",@"serverHash":job.saved[@"sha256"],@"status":@"same"}];count++;if(progress)progress(job.row[@"path"],count);}
                @catch(NSException *error){[failures addObject:[NSString stringWithFormat:@"%@: 서버 저장 후 로컬 기록 실패. 다시 비교하세요. %@",job.row[@"path"],error.reason]];}
            }
            [self reportSyncItems:reports];YBRequire(failures.count==0,[failures componentsJoinedByString:@"\n"]);
        }}
    } @catch(NSException *error){YBRequire(NO,[NSString stringWithFormat:@"%lu/%lu개 완료 후 중단했습니다. 완료된 서버 문서는 유지합니다. 다시 비교해 남은 문서를 선택하세요.\n%@",(unsigned long)count,(unsigned long)rows.count,error.reason]);}
    @finally {[queue waitUntilAllOperationsAreFinished];[NSProcessInfo.processInfo endActivity:activity];}
    return count;
}
- (NSUInteger)transfer:(NSArray *)rows receiving:(BOOL)receiving progress:(void (^)(NSString *,NSUInteger))progress {
    [self.sync assertReady];YBRequire(!self.sync.presenterRunning(),@"ProPresenter를 종료한 후 송수신해 주세요.");
    if(!receiving)return [self uploadParallel:rows progress:progress];
    NSMutableArray *reports=[NSMutableArray array];NSUInteger count=0;BOOL completed=NO;[self.sync beginBackupBatch:@"documents" playlistJob:nil];
    @try {
        for(NSDictionary *row in rows) {
            NSString *status=row[@"status"], *path=row[@"path"];
            YBRequire([status isEqual:@"same"] || [status isEqual:receiving ? @"download" : @"upload"],@"선택에 충돌 문서 또는 다른 방향의 문서가 있습니다. 다시 비교해 주세요.");
            [self.sync assertReady];YBRequire(!self.sync.presenterRunning(),@"ProPresenter가 실행됐습니다. 작업을 중단했습니다.");
            NSString *hash=row[@"localHash"]==NSNull.null ? nil : row[@"localHash"];
            NSDictionary *remote=row[@"remote"]==NSNull.null ? nil : row[@"remote"];
            if(remote) {NSDictionary *head=[self.server head:remote];YBRequire([head[@"version"] isEqual:remote[@"version"]] && [head[@"sha256"] isEqual:remote[@"sha256"]],@"선택 후 서버 문서가 변경됐습니다. 다시 비교해 주세요.");}
            if([status isEqual:@"same"]) [self.sync acknowledge:remote expectedLocalHash:hash];
            else if(receiving) {
                NSData *data=[self.server download:remote];NSDictionary *head=[self.server head:remote];YBRequire([head[@"version"] isEqual:remote[@"version"]],@"받는 동안 서버 문서가 변경됐습니다. 다시 비교해 주세요.");
                [self.sync apply:data document:remote expectedLocalHash:hash];
            } else {
                NSData *data=[self.sync readDocument:path];YBRequire(hash && [YBHash(data) isEqual:hash],@"선택 후 로컬 문서가 바뀌었습니다. 다시 비교해 주세요.");
                YBRequire([YBDisposition(hash,remote,self.sync.entries[path]) isEqual:@"upload"],@"문서의 동기화 기준이 달라졌습니다. 다시 비교해 주세요.");
                NSDictionary *saved=[self.server upload:data path:path previous:remote];[self.sync acknowledge:saved expectedLocalHash:hash];
            }
            [reports addObject:@{@"kind":@"document",@"id":remote[@"id"],@"node":@"",@"serverHash":remote[@"sha256"],@"status":@"same"}];count++;if(progress)progress(path,count);
        }
        completed=YES;
    } @catch(NSException *error) {YBRequire(NO,[NSString stringWithFormat:@"%lu/%lu개 완료 후 중단했습니다. 완료된 문서는 유지합니다.\n%@",(unsigned long)count,(unsigned long)rows.count,error.reason]);}
    @finally {[self.sync endBackupBatch:completed];[self reportSyncItems:reports];}
    return count;
}
@end


