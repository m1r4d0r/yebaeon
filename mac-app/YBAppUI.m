#import "YBAppUI.h"
#import "../mac-sync/YBSync.h"
NSTextField *YBLabel(NSString *text,NSRect frame,CGFloat size,BOOL bold) {
    NSTextField *field=[[NSTextField alloc] initWithFrame:frame]; field.bezeled=NO;field.drawsBackground=NO;field.editable=NO;field.selectable=YES;
    field.stringValue=text ?: @"";field.font=bold ? [NSFont boldSystemFontOfSize:size] : [NSFont systemFontOfSize:size];field.lineBreakMode=NSLineBreakByTruncatingMiddle;return field;
}
NSButton *YBButton(NSString *title,NSRect frame,id target,SEL action) {
    NSButton *button=[[NSButton alloc] initWithFrame:frame];button.title=title;button.bezelStyle=NSBezelStyleRounded;button.target=target;button.action=action;return button;
}
@interface YBActionTable : NSTableView
@end
@implementation YBActionTable
- (void)selectAll:(id)sender {if([(id)self.delegate respondsToSelector:@selector(selectVisible:)])[(id)self.delegate performSelector:@selector(selectVisible:) withObject:sender];else [super selectAll:sender];}
@end
NSTableView *YBTable(NSView *parent,NSRect frame,NSArray *columns,id delegate) {
    NSTableView *table=[[YBActionTable alloc] initWithFrame:NSMakeRect(0,0,frame.size.width,frame.size.height)];table.delegate=delegate;table.dataSource=delegate;table.rowHeight=30;table.allowsMultipleSelection=YES;
    for(NSArray *spec in columns) {NSTableColumn *c=[[NSTableColumn alloc] initWithIdentifier:spec[0]];c.title=spec[1];c.width=[spec[2] doubleValue];c.minWidth=35;[table addTableColumn:c];}
    NSScrollView *scroll=[[NSScrollView alloc] initWithFrame:frame];scroll.borderType=NSBezelBorder;scroll.hasVerticalScroller=YES;scroll.hasHorizontalScroller=YES;scroll.autohidesScrollers=YES;scroll.documentView=table;[parent addSubview:scroll];return table;
}
void YBAlert(NSString *title,NSString *message) {NSAlert *alert=[NSAlert new];alert.messageText=title ?: @"알림";alert.informativeText=message ?: @"";[alert addButtonWithTitle:@"확인"];[alert runModal];}
BOOL YBConfirm(NSString *title,NSString *message,NSString *action) {NSAlert *alert=[NSAlert new];alert.messageText=title;alert.informativeText=message;[alert addButtonWithTitle:action];[alert addButtonWithTitle:@"취소"];return [alert runModal]==NSAlertFirstButtonReturn;}
NSString *YBChooseFolder(NSString *title,NSString *current) {NSOpenPanel *panel=[NSOpenPanel openPanel];panel.title=title;panel.canChooseFiles=NO;panel.canChooseDirectories=YES;panel.allowsMultipleSelection=NO;if(current)panel.directoryURL=[NSURL fileURLWithPath:current];return [panel runModal]==NSModalResponseOK ? panel.URL.path : nil;}
void YBShowText(NSString *title,NSString *text) {
    NSAlert *alert=[NSAlert new];alert.messageText=title;[alert addButtonWithTitle:@"닫기"];
    NSScrollView *scroll=[[NSScrollView alloc] initWithFrame:NSMakeRect(0,0,780,420)];scroll.hasVerticalScroller=YES;scroll.borderType=NSBezelBorder;
    NSTextView *view=[[NSTextView alloc] initWithFrame:scroll.bounds];view.editable=NO;view.font=[NSFont systemFontOfSize:13];view.string=text ?: @"";
    view.textContainer.widthTracksTextView=YES;view.verticallyResizable=YES;view.autoresizingMask=NSViewWidthSizable;scroll.documentView=view;alert.accessoryView=scroll;[alert runModal];
}
#ifdef YB_TESTING
static NSString *testPreferencesDirectory;
void YBSetTestPreferencesDirectory(NSString *directory) {testPreferencesDirectory=directory;}
#endif
NSString *YBPreferencesDirectory(void) {
#ifdef YB_TESTING
    if(testPreferencesDirectory)return testPreferencesDirectory;
#endif
    return [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/YebaeOn Sync"];
}
NSString *YBLegacySettingsPath(void) {
#ifdef YB_TESTING
    if(testPreferencesDirectory)return [testPreferencesDirectory stringByAppendingPathComponent:@"legacy/settings.json"];
#endif
    return [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/PP6 Playlist Sync/settings.json"];
}
NSDictionary *YBPreferences(NSString *name) {NSData *data=[NSData dataWithContentsOfFile:[YBPreferencesDirectory() stringByAppendingPathComponent:name]];id value=data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL] : nil;return [value isKindOfClass:NSDictionary.class] ? value : @{};}
void YBSavePreferences(NSString *name,NSDictionary *value) {
    NSError *error=nil;NSString *dir=YBPreferencesDirectory();BOOL ok=[NSFileManager.defaultManager createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:&error];
    NSData *data=[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingPrettyPrinted error:&error];
    if(!ok || ![data writeToFile:[dir stringByAppendingPathComponent:name] options:NSDataWritingAtomic error:&error])YBAlert(@"설정을 저장하지 못했습니다.",error.localizedDescription);
}
NSString *YBStatusName(NSString *status) {return @{@"same":@"일치",@"download":@"받기",@"upload":@"보내기",@"conflict":@"충돌 · 확인 필요"}[status] ?: status;}
static NSString *ProfileIdentity(NSString *root,NSString *origin) {NSString *identity=[NSString stringWithFormat:@"%@\n%@",origin,root.stringByStandardizingPath.stringByResolvingSymlinksInPath];return YBHash([identity dataUsingEncoding:NSUTF8StringEncoding]);}
NSString *YBProfilePath(NSString *root,NSString *origin) {
    NSString *identity=ProfileIdentity(root,origin),*generation=YBPreferences(@"profile-generations.json")[identity];
    YBRequire(!generation || ([generation isKindOfClass:NSString.class] && [[NSUUID alloc] initWithUUIDString:generation]),@"동기화 초기화 기록을 읽지 못했습니다.");
    return [YBPreferencesDirectory() stringByAppendingPathComponent:generation ? [identity stringByAppendingFormat:@"-%@",generation] : identity];
}
NSString *YBStartFreshProfile(YBSync *sync,NSString *origin) {
    [sync assertReady];YBRequire(!sync.presenterRunning(),@"ProPresenter를 종료한 후 동기화 기록을 초기화하세요.");
    NSString *previous=sync.profile;YBRequire([previous isEqual:YBProfilePath(sync.root,origin)],@"사용 중인 동기화 기준이 바뀌었습니다. 앱을 다시 열어 주세요.");
    NSMutableDictionary *generations=[YBPreferences(@"profile-generations.json") mutableCopy];generations[ProfileIdentity(sync.root,origin)]=NSUUID.UUID.UUIDString;
    NSData *data=[NSJSONSerialization dataWithJSONObject:generations options:NSJSONWritingPrettyPrinted error:NULL];YBRequire(data!=nil,@"초기화 기록 생성 실패");
    // Atomic pointer change: old journals/backups stay isolated; no user files move.
    YBWriteSafeFile(YBPreferencesDirectory(),@"profile-generations.json",data,0600,nil);
    return previous;
}
@interface YBWork ()
@property(nonatomic,readwrite) BOOL busy;
@property(nonatomic,strong) dispatch_queue_t queue;
@property(atomic) NSUInteger generation;
@property(atomic, readwrite) BOOL backgroundActive;
@property(atomic, readwrite) BOOL pauseRequested;
@property(atomic, readwrite) BOOL paused;
@property(atomic, readwrite) BOOL pausable;
@property NSCondition *pauseCondition;
@end
@implementation YBWork
- (void)setMessage:(NSString *)message {_message=[message copy];if(self.messageChanged)self.messageChanged();}
- (instancetype)init {if((self=[super init])){self.queue=dispatch_queue_create("org.yebaeon.sync.work",DISPATCH_QUEUE_SERIAL);self.pauseCondition=[NSCondition new];}return self;}
- (void)notifyPause {dispatch_async(dispatch_get_main_queue(),^{if(self.pauseChanged)self.pauseChanged();});}
- (void)togglePause:(id)sender {
    [self.pauseCondition lock];
    if(self.pausable && (self.busy || self.backgroundActive)) {self.pauseRequested=!self.pauseRequested;[self.pauseCondition broadcast];}
    [self.pauseCondition unlock];if(self.pauseChanged)self.pauseChanged();
}
- (void)checkpoint {
    // Called only between safe units, never between server commit and local acknowledgement.
    [self.pauseCondition lock];
    if(self.pauseRequested && self.pausable){self.paused=YES;[self notifyPause];}
    while(self.pauseRequested && self.pausable)[self.pauseCondition wait];
    BOOL changed=self.paused;self.paused=NO;[self.pauseCondition unlock];if(changed)[self notifyPause];
}
- (void)resumeForNextOperation:(BOOL)pausable {
    [self.pauseCondition lock];self.pauseRequested=NO;self.paused=NO;self.pausable=pausable;[self.pauseCondition broadcast];[self.pauseCondition unlock];[self notifyPause];
}
- (void)runBackground:(id (^)(BOOL (^)(void)))task completion:(void (^)(id,NSString *))completion {
    if(self.busy)return;NSUInteger generation=++self.generation;self.backgroundActive=YES;[self resumeForNextOperation:YES];
    BOOL (^cancelled)(void)=^BOOL{return self.generation!=generation;};
    dispatch_async(self.queue,^{@autoreleasepool {
        id result=nil;NSString *error=nil;@try{if(!cancelled()){[self checkpoint];if(!cancelled())result=task(cancelled);}}@catch(NSException *e){error=e.reason;}
        dispatch_async(dispatch_get_main_queue(),^{if(self.generation==generation){self.backgroundActive=NO;[self resumeForNextOperation:NO];}completion(cancelled() ? nil : result,cancelled() ? @"사용자 작업을 우선합니다. 끝나면 나머지 점검을 자동으로 이어갑니다." : error);});
    }});
}
- (void)run:(id (^)(void))task completion:(void (^)(id,NSString *))completion {[self runPausable:NO task:task completion:completion];}
- (void)runPausable:(BOOL)pausable task:(id (^)(void))task completion:(void (^)(id,NSString *))completion {
    if(self.busy) {YBAlert(@"작업 중입니다.",@"현재 작업이 끝난 후 다시 시도해 주세요.");return;}
    self.generation++;self.backgroundActive=NO;[self resumeForNextOperation:pausable];self.message=@"작업 준비 중";self.busy=YES;if(self.busyChanged)self.busyChanged(YES);
    dispatch_async(self.queue,^{@autoreleasepool {
        id result=nil;NSString *error=nil;@try {[self checkpoint];result=task();}@catch(NSException *e){error=e.reason ?: @"작업을 완료하지 못했습니다.";}
        dispatch_async(dispatch_get_main_queue(),^{self.busy=NO;[self resumeForNextOperation:NO];self.message=nil;if(self.busyChanged)self.busyChanged(NO);completion(result,error);if(!self.busy && self.idle)self.idle();});
    }});
}
@end



@interface YBPanel ()
@property NSMutableDictionary *originalFrames;
@end
@implementation YBPanel
- (void)resizeSubviewsWithOldSize:(NSSize)oldSize {
    if(self.frameLayout){self.frameLayout(self.bounds.size);return;}
    if(!self.originalFrames){self.originalFrames=[NSMutableDictionary dictionary];for(NSView *v in self.subviews)self.originalFrames[[NSValue valueWithNonretainedObject:v]]=[NSValue valueWithRect:v.frame];}
    CGFloat w=self.bounds.size.width,h=self.bounds.size.height,scale=(w-48)/1012.0;
    for(NSView *v in self.subviews){NSRect f=[self.originalFrames[[NSValue valueWithNonretainedObject:v]] rectValue];
        f.origin.x=24+(f.origin.x-24)*scale;f.size.width*=scale;
        if([v isKindOfClass:NSScrollView.class])f.size.height=MAX(80,f.size.height+h-720);
        else if(f.origin.y>300)f.origin.y+=h-720;
        v.frame=f;
        if([v isKindOfClass:NSSegmentedControl.class]){NSSegmentedControl *s=(id)v;for(NSInteger i=0;i<s.segmentCount;i++)[s setWidth:f.size.width/s.segmentCount forSegment:i];}
    }
}
@end
NSString *YBDisplayDate(id value) {
    NSDate *date=nil;
    if([value isKindOfClass:NSDate.class])date=value;
    else if([value isKindOfClass:NSNumber.class])date=[NSDate dateWithTimeIntervalSince1970:[value doubleValue]];
    else if([value isKindOfClass:NSString.class]){NSISO8601DateFormatter *iso=[NSISO8601DateFormatter new];date=[iso dateFromString:value];if(!date){iso.formatOptions=NSISO8601DateFormatWithInternetDateTime|NSISO8601DateFormatWithFractionalSeconds;date=[iso dateFromString:value];}}
    if(!date)return @"—";
    NSTimeZone *zone=[NSTimeZone timeZoneWithName:@"Asia/Seoul"];NSCalendar *cal=[[NSCalendar alloc] initWithCalendarIdentifier:NSCalendarIdentifierGregorian];cal.timeZone=zone;
    NSDateFormatter *f=[NSDateFormatter new];f.locale=[[NSLocale alloc] initWithLocaleIdentifier:@"ko_KR"];f.timeZone=zone;
    NSDate *today=[cal startOfDayForDate:NSDate.date],*yesterday=[cal dateByAddingUnit:NSCalendarUnitDay value:-1 toDate:today options:0];
    NSString *prefix=[cal isDate:date inSameDayAsDate:today] ? @"오늘 " : [cal isDate:date inSameDayAsDate:yesterday] ? @"어제 " : @"";
    f.dateFormat=prefix.length ? @"a h:mm" : @"yyyy.MM.dd a h:mm";return [prefix stringByAppendingString:[f stringFromDate:date]];
}

