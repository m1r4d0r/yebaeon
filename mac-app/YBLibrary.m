#import "YBLibrary.h"
@implementation YBLibrary
- (instancetype)initWithRoot:(NSString *)root profile:(NSString *)profile server:(YBServer *)server {
    if((self=[super init])) {_server=server;_sync=[[YBSync alloc] initWithRoot:root profile:profile origin:server.origin];}return self;
}
- (void)dealloc {[_sync close];}
- (NSArray *)refresh {return [self.sync plan:[self.server documents]];}
- (NSUInteger)transfer:(NSArray *)rows receiving:(BOOL)receiving progress:(void (^)(NSString *,NSUInteger))progress {
    [self.sync assertReady];YBRequire(!self.sync.presenterRunning(),@"ProPresenter를 종료한 후 송수신해 주세요.");
    NSUInteger count=0;
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
            count++;if(progress)progress(path,count);
        }
    } @catch(NSException *error) {YBRequire(NO,[NSString stringWithFormat:@"%lu/%lu개 완료 후 중단했습니다. 완료된 문서는 유지합니다.\n%@",(unsigned long)count,(unsigned long)rows.count,error.reason]);}
    return count;
}
@end
