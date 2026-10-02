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
NSString *YBProfilePath(NSString *root,NSString *origin) {NSString *identity=[NSString stringWithFormat:@"%@\n%@",origin,root.stringByStandardizingPath.stringByResolvingSymlinksInPath];return [YBPreferencesDirectory() stringByAppendingPathComponent:YBHash([identity dataUsingEncoding:NSUTF8StringEncoding])];}
@interface YBWork ()
@property(nonatomic,readwrite) BOOL busy;
@property(nonatomic,strong) dispatch_queue_t queue;
@end
@implementation YBWork
- (void)setMessage:(NSString *)message {_message=[message copy];if(self.messageChanged)self.messageChanged();}
- (instancetype)init {if((self=[super init]))self.queue=dispatch_queue_create("org.yebaeon.sync.work",DISPATCH_QUEUE_SERIAL);return self;}
- (void)run:(id (^)(void))task completion:(void (^)(id,NSString *))completion {
    if(self.busy) {YBAlert(@"작업 중입니다.",@"현재 작업이 끝난 후 다시 시도해 주세요.");return;}
    self.message=@"작업 준비 중";self.busy=YES;if(self.busyChanged)self.busyChanged(YES);
    dispatch_async(self.queue,^{@autoreleasepool {
        id result=nil;NSString *error=nil;@try {result=task();}@catch(NSException *e){error=e.reason ?: @"작업을 완료하지 못했습니다.";}
        dispatch_async(dispatch_get_main_queue(),^{self.busy=NO;self.message=nil;if(self.busyChanged)self.busyChanged(NO);completion(result,error);});
    }});
}
@end

