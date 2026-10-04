#import "YBAppUI.h"
NSTextField *YBLabel(NSString *text,NSRect frame,CGFloat size,BOOL bold) {
    NSTextField *field=[[NSTextField alloc] initWithFrame:frame]; field.bezeled=NO;field.drawsBackground=NO;field.editable=NO;field.selectable=YES;
    field.stringValue=text ?: @"";field.font=bold ? [NSFont boldSystemFontOfSize:size] : [NSFont systemFontOfSize:size];field.lineBreakMode=NSLineBreakByTruncatingMiddle;return field;
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
