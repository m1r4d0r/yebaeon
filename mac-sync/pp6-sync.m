#import "YBSync.h"
#import <unistd.h>
#import <string.h>

static void Print(NSString *text) {
    NSMutableString *safe=[NSMutableString string];
    for(NSUInteger i=0;i<text.length;i++) { unichar c=[text characterAtIndex:i]; if(c=='\n' || c=='\t' || (c>=32 && c!=127)) [safe appendFormat:@"%C",c]; }
    printf("%s\n",safe.UTF8String);
}
static NSString *Ask(NSString *message) {
    Print(message); char *buffer=NULL; size_t size=0;
    ssize_t count=getline(&buffer,&size,stdin);
    NSString *answer=count>0 ? [[NSString alloc] initWithBytes:buffer length:count encoding:NSUTF8StringEncoding] : nil; free(buffer);
    YBRequire(answer!=nil,@"입력이 종료됐습니다."); return [answer stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
}
static NSString *Label(NSString *status) { return @{@"same":@"일치",@"download":@"받기",@"upload":@"보내기",@"conflict":@"충돌·확인 필요"}[status] ?: status; }
static void Show(NSArray *rows) {
    if(!rows.count)Print(@"문서가 없습니다.");
    for(NSUInteger i=0;i<rows.count;i++) {
        NSDictionary *row=rows[i], *doc=row[@"remote"]==NSNull.null ? nil : row[@"remote"];
        Print([NSString stringWithFormat:@"%lu. [%@] %@  %@",(unsigned long)i+1,Label(row[@"status"]),row[@"path"],doc ? [NSString stringWithFormat:@"서버 v%@ · %@",doc[@"version"],doc[@"updatedBy"] ?: @""] : @"로컬에만 있음"]);
    }
}
static NSArray *Selected(NSArray *items) {
    NSString *answer=Ask(@"처리할 번호를 쉼표로 입력하세요. 전체는 all, 취소는 Enter:");
    if(!answer.length)return @[]; if([answer isEqual:@"all"])return items;
    NSMutableIndexSet *indices=[NSMutableIndexSet indexSet];
    for(NSString *part in [answer componentsSeparatedByString:@","]) {
        NSString *trim=[part stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
        YBRequire([trim rangeOfString:@"^[1-9][0-9]*$" options:NSRegularExpressionSearch].location!=NSNotFound,@"목록에 있는 번호를 입력해 주세요.");
        NSInteger n=trim.integerValue; YBRequire(n>0 && (NSUInteger)n<=items.count,@"목록에 없는 번호입니다."); [indices addIndex:n-1];
    }
    return [items objectsAtIndexes:indices];
}
static void Login(YBServer *server) {
    NSString *name=Ask(@"작업자 이름:"); char *secret=getpass("공용 비밀번호 (입력 내용은 표시되지 않습니다): ");
    YBRequire(secret!=NULL,@"비밀번호를 읽지 못했습니다.");
    NSString *password=[NSString stringWithUTF8String:secret]; memset(secret,0,strlen(secret));
    YBRequire(password!=nil,@"비밀번호 문자 형식을 확인해 주세요.");
    NSDictionary *result=[server login:name password:password]; password=nil;
    Print([NSString stringWithFormat:@"%@님으로 입장했습니다.",result[@"name"] ?: name]); [server saveSession];
}
static NSArray *Plans(YBSync *sync,YBServer *server) {
    NSDictionary *session=[server request:@"/api/session" method:@"GET" body:nil headers:nil];
    if(![session[@"authenticated"] boolValue])Login(server);
    return [sync plan:[server documents]];
}
static void Transfer(YBSync *sync,YBServer *server,BOOL pull) {
    [sync assertReady]; YBRequire(!YBPresenterRunning(),@"송수신 전에 ProPresenter를 종료해 주세요.");
    NSArray *rows=Plans(sync,server); NSMutableArray *eligible=[NSMutableArray array];
    for(NSDictionary *row in rows)if([row[@"status"] isEqual:pull ? @"download" : @"upload"] || [row[@"status"] isEqual:@"same"])[eligible addObject:row];
    Print(@"충돌 문서는 이 목록에 포함하지 않습니다. ‘일치’ 문서는 동기화 기준만 기록합니다."); Show(eligible); if(!eligible.count)return;
    NSArray *selected=Selected(eligible); if(!selected.count)return;
    Show(selected);
    Print([NSString stringWithFormat:@"문서 폴더: %@\n서버: %@",sync.root,server.origin]);
    if(![Ask(pull ? @"위 문서를 백업 후 적용하려면 ‘받기’를 입력하세요:" : @"위 문서를 서버에 저장하려면 ‘보내기’를 입력하세요:") isEqual:pull ? @"받기" : @"보내기"]) { Print(@"취소했습니다."); return; }
    NSUInteger done=0;
    @try {
        for(NSDictionary *row in selected) {
            [sync assertReady]; YBRequire(!YBPresenterRunning(),@"ProPresenter가 실행됐습니다. 종료 후 다시 시도해 주세요.");
            NSString *path=row[@"path"], *hash=row[@"localHash"]==NSNull.null ? nil : row[@"localHash"];
            NSDictionary *remote=row[@"remote"]==NSNull.null ? nil : row[@"remote"];
            if(remote) {
                NSDictionary *head=[server head:remote];
                YBRequire([head[@"version"] isEqual:remote[@"version"]] && [head[@"sha256"] isEqual:remote[@"sha256"]],@"선택 후 서버 문서가 변경됐습니다. 다시 비교해 주세요.");
            }
            if([row[@"status"] isEqual:@"same"]) [sync acknowledge:remote expectedLocalHash:hash];
            else if(pull) {
                NSData *data=[server download:remote]; NSDictionary *head=[server head:remote];
                YBRequire([head[@"version"] isEqual:remote[@"version"]],@"받는 동안 서버 문서가 변경됐습니다. 다시 비교해 주세요.");
                NSString *backup=[sync apply:data document:remote expectedLocalHash:hash]; Print([@"백업 번호: " stringByAppendingString:backup]);
            } else {
                NSData *data=[sync readDocument:path]; YBRequire(hash && [YBHash(data) isEqual:hash],@"선택 후 로컬 문서가 변경됐습니다. 다시 비교해 주세요.");
                NSDictionary *saved=[server upload:data path:path previous:remote]; [sync acknowledge:saved expectedLocalHash:hash];
            }
            done++; Print([@"완료: " stringByAppendingString:path]);
        }
    } @finally { Print([NSString stringWithFormat:@"%lu/%lu 문서 완료. 앞서 완료한 문서는 유지합니다.",(unsigned long)done,(unsigned long)selected.count]); }
}
static void UndoMenu(YBSync *sync,BOOL restore) {
    NSArray *all=restore ? sync.transactions : sync.pendingTransactions; NSMutableArray *items=[NSMutableArray array];
    for(NSDictionary *j in all)if(!restore || [j[@"status"] isEqual:@"committed"])[items addObject:j];
    if(!items.count) { Print(@"복원/복구할 기록이 없습니다."); return; }
    for(NSUInteger i=0;i<items.count;i++) { NSDictionary *j=items[i]; Print([NSString stringWithFormat:@"%lu. %@ · %@ · %@%@",(unsigned long)i+1,j[@"createdAt"],j[@"path"],j[@"id"],j[@"beforeHash"]==NSNull.null ? @" (신규로 받은 파일을 제거함)" : @" (적용 전 원본으로 복원)"]); }
    NSArray *selected=Selected(items); if(!selected.count)return;
    Print(@"서버 버전은 유지하며 이 Mac의 문서만 되돌립니다. 이후 수정한 파일은 덮어쓰지 않습니다.");
    if(![Ask(@"계속하려면 ‘복원’을 입력하세요:") isEqual:@"복원"])return;
    for(NSDictionary *j in selected) { if(restore)[sync restore:j[@"id"]]; else [sync recover:j[@"id"]]; Print([@"복원 완료: " stringByAppendingString:j[@"path"]]); }
}
int main(int argc,const char *argv[]) { @autoreleasepool {
    @try {
        NSString *root=[NSHomeDirectory() stringByAppendingPathComponent:@"Documents/YebaeOn-Sync-Test"], *origin=@"https://yebaeon.grace-jean-p.workers.dev"; BOOL statusOnly=NO;
        for(int i=1;i<argc;i++) {
            NSString *arg=[NSString stringWithUTF8String:argv[i]];
            if([arg isEqual:@"--help"]) { Print(@"예배온 Sync\n  --documents /절대/문서폴더  (기본: ~/Documents/YebaeOn-Sync-Test)\n  --server https://서버주소\n  --status  (로그인 없이 저장된 세션으로 목록만 확인)\n실행 중 메뉴에서 문서를 선택하고 송수신·복원을 확인합니다."); return 0; }
            if([arg isEqual:@"--status"]) { statusOnly=YES; continue; }
            YBRequire(([arg isEqual:@"--documents"] || [arg isEqual:@"--server"]) && i+1<argc,@"알 수 없는 실행 옵션입니다. --help를 확인해 주세요.");
            NSString *value=[NSString stringWithUTF8String:argv[++i]]; if([arg isEqual:@"--documents"])root=value.stringByExpandingTildeInPath; else origin=value;
        }
        YBRequire(root.isAbsolutePath,@"문서 폴더는 절대 경로로 지정해 주세요.");
        YBServer *server=[[YBServer alloc] initWithOrigin:origin allowLocalTestServer:NO];
        NSString *identity=[NSString stringWithFormat:@"%@\n%@",server.origin,root.stringByStandardizingPath.stringByResolvingSymlinksInPath];
        NSString *profile=[[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/YebaeOn Sync"] stringByAppendingPathComponent:YBHash([identity dataUsingEncoding:NSUTF8StringEncoding])];
        YBSync *sync=[[YBSync alloc] initWithRoot:root profile:profile origin:server.origin];
        Print([NSString stringWithFormat:@"예배온 Sync · 문서 송수신\n문서: %@\n백업/기록: %@\n서버: %@\n미디어는 아직 송수신하지 않습니다.",sync.root,sync.profile,server.origin]);
        @try { [server loadSession]; } @catch(NSException *e) { Print(e.reason); }
        if(statusOnly) { Show([sync plan:[server documents]]); return 0; }
        for(;;) { @autoreleasepool {
            @try {
                if(sync.pendingTransactions.count)Print(@"중단된 적용이 있습니다. 메뉴 5에서 먼저 복구해 주세요.");
                NSString *action=Ask(@"\n1 비교/입장  2 서버에서 받기  3 서버로 보내기\n4 백업 복원  5 중단 작업 복구  6 이름 변경/다시 입장  7 로그아웃  0 종료");
                if([action isEqual:@"0"])break;
                if([action isEqual:@"1"]) { Show(Plans(sync,server)); Print(@"충돌은 양쪽 수정 또는 아직 기준이 없는 다른 파일입니다. 자동 덮어쓰기는 하지 않습니다."); }
                else if([action isEqual:@"2"])Transfer(sync,server,YES);
                else if([action isEqual:@"3"])Transfer(sync,server,NO);
                else if([action isEqual:@"4"])UndoMenu(sync,YES);
                else if([action isEqual:@"5"])UndoMenu(sync,NO);
                else if([action isEqual:@"6"])Login(server);
                else if([action isEqual:@"7"]) { [server request:@"/api/session" method:@"DELETE" body:nil headers:nil]; [server forgetSession]; Print(@"로그아웃했습니다."); }
            } @catch(NSException *e) { Print([@"중단: " stringByAppendingString:e.reason]); if(feof(stdin))return 1; }
        } }
        return 0;
    } @catch(NSException *e) { Print([@"중단: " stringByAppendingString:e.reason]); return 1; }
} }
