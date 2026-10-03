#import "YBDocumentComparison.h"
#import "../mac-sync/PP6Core.h"

NSArray *YBComparisonRows(NSDictionary *local,NSDictionary *remote) {
    NSArray *left=local[@"slides"] ?: @[],*right=remote[@"slides"] ?: @[];
    NSMutableDictionary *pairs=[NSMutableDictionary dictionary];NSMutableSet *used=[NSMutableSet set];
    for(NSDictionary *group in PP6CompareParsedDocuments(local ?: @{},remote ?: @{})[@"groups"])
        for(NSDictionary *match in group[@"matched"]){pairs[match[@"newIndex"]]=match;[used addObject:match[@"oldIndex"]];}
    NSMutableDictionary *leftByID=[NSMutableDictionary dictionary];for(NSDictionary *slide in left)leftByID[slide[@"index"]]=slide;
    NSMutableArray *rows=[NSMutableArray array];
    for(NSDictionary *slide in right){NSDictionary *match=pairs[slide[@"index"]],*old=leftByID[match[@"oldIndex"] ?: @0];NSMutableArray *flags=[NSMutableArray array];
        if(!old)[flags addObject:@"+ 서버에만 있음"];
        else {if(![[old[@"texts"] valueForKey:@"rtfBase64"] isEqual:[slide[@"texts"] valueForKey:@"rtfBase64"]] && ![match[@"modified"] boolValue])[flags addObject:@"글자 서식 변경"];if([match[@"modified"] boolValue])[flags addObject:@"내용·서식 변경"];if([match[@"moved"] boolValue])[flags addObject:@"순서 이동"];if([match[@"technicalOnly"] boolValue])[flags addObject:@"경로·식별자 변경"];}
        [rows addObject:@{@"local":old ?: @{},@"remote":slide,@"status":flags.count ? [flags componentsJoinedByString:@" · "] : @"동일",@"changed":@(flags.count>0)}];
    }
    for(NSDictionary *slide in left)if(![used containsObject:slide[@"index"]])[rows addObject:@{@"local":slide,@"remote":@{},@"status":@"− Mac에만 있음",@"changed":@YES}];
    return rows;
}

NSAttributedString *YBHighlightedLines(NSString *text,NSString *other,BOOL server) {
    NSArray *a=[text componentsSeparatedByString:@"\n"],*b=[other componentsSeparatedByString:@"\n"];
    NSMutableIndexSet *same=[NSMutableIndexSet indexSet];NSUInteger m=a.count,n=b.count;
    // Bounded line alignment; retain exact content even for unusually long documents.
    if(m && n && m<=2000 && n<=2000){NSUInteger cols=n+1;uint32_t *dp=calloc((m+1)*cols,sizeof(uint32_t));
        if(dp){for(NSInteger i=(NSInteger)m-1;i>=0;i--)for(NSInteger j=(NSInteger)n-1;j>=0;j--)dp[i*cols+j]=[a[i] isEqual:b[j]]?dp[(i+1)*cols+j+1]+1:MAX(dp[(i+1)*cols+j],dp[i*cols+j+1]);
            NSUInteger i=0,j=0;while(i<m && j<n){if([a[i] isEqual:b[j]]){[same addIndex:i];i++;j++;}else if(dp[(i+1)*cols+j]>=dp[i*cols+j+1])i++;else j++;}free(dp);}
    }else if([text isEqual:other])[same addIndexesInRange:NSMakeRange(0,m)];
    NSMutableAttributedString *out=[NSMutableAttributedString new];
    for(NSUInteger i=0;i<m;i++){BOOL changed=![same containsIndex:i];NSString *line=[NSString stringWithFormat:@"%@%@\n",changed?(server?@"+ ":@"− "):@"  ",a[i]];
        NSMutableDictionary *attrs=[@{NSFontAttributeName:[NSFont systemFontOfSize:14],NSForegroundColorAttributeName:NSColor.textColor} mutableCopy];
        if(changed){attrs[NSBackgroundColorAttributeName]=server?[NSColor colorWithCalibratedRed:.82 green:.95 blue:.86 alpha:1]:[NSColor colorWithCalibratedRed:1 green:.86 blue:.85 alpha:1];attrs[NSForegroundColorAttributeName]=NSColor.blackColor;}
        [out appendAttributedString:[[NSAttributedString alloc] initWithString:line attributes:attrs]];
    }return out;
}
static NSString *SlideText(NSDictionary *slide) {
    if(!slide.count)return @"이쪽 버전에는 이 슬라이드가 없습니다.";
    NSMutableArray *lines=[NSMutableArray array];NSUInteger i=0;
    for(NSDictionary *t in slide[@"texts"]){[lines addObject:[NSString stringWithFormat:@"글상자 %lu",(unsigned long)++i]];[lines addObject:t[@"text"] ?: @""];}
    if(!i)[lines addObject:@"(텍스트 없음)"];
    [lines addObject:@"\n이미지·영상 참조"];
    for(NSDictionary *m in slide[@"media"]){[lines addObject:[NSString stringWithFormat:@"%@ · %@",[m[@"background"] boolValue]?@"배경":@"요소",m[@"basename"] ?: @""]];[lines addObject:m[@"source"] ?: @""];[lines addObject:[@"위치: " stringByAppendingString:m[@"position"] ?: @""]];}
    if(![slide[@"media"] count])[lines addObject:@"(미디어 없음)"];
    [lines addObject:@"\n서식·배치"];i=0;
    for(NSDictionary *t in slide[@"texts"]){[lines addObject:[NSString stringWithFormat:@"글상자 %lu · 위치 %@",(unsigned long)++i,t[@"position"] ?: @""]];[lines addObject:t[@"styleSignature"] ?: @""];
        NSData *data=[[NSData alloc] initWithBase64EncodedString:t[@"rtfBase64"] ?: @"" options:NSDataBase64DecodingIgnoreUnknownCharacters];NSAttributedString *rtf=data?[[NSAttributedString alloc] initWithRTF:data documentAttributes:NULL]:nil;
        [rtf enumerateAttributesInRange:NSMakeRange(0,rtf.length) options:0 usingBlock:^(NSDictionary *attrs,NSRange range,BOOL *stop){NSFont *font=attrs[NSFontAttributeName];NSParagraphStyle *paragraph=attrs[NSParagraphStyleAttributeName];[lines addObject:[NSString stringWithFormat:@"글자 %lu–%lu · %@ %.1fpt · 정렬 %ld · 줄간격 %.1f · 색 %@",(unsigned long)range.location+1,(unsigned long)NSMaxRange(range),font.fontName ?: @"기본",font.pointSize,(long)paragraph.alignment,paragraph.lineSpacing,attrs[NSForegroundColorAttributeName] ?: @"기본"]];}];
    }
    return [lines componentsJoinedByString:@"\n"];
}
static NSRect SlideRect(NSString *value) {
    NSString *clean=[[value ?: @"" stringByReplacingOccurrencesOfString:@"{" withString:@""] stringByReplacingOccurrencesOfString:@"}" withString:@""];
    NSArray *parts=[[clean stringByReplacingOccurrencesOfString:@"," withString:@" "] componentsSeparatedByCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];NSMutableArray *numbers=[NSMutableArray array];for(NSString *part in parts)if(part.length)[numbers addObject:part];
    return numbers.count>=5?NSMakeRect([numbers[0] doubleValue],[numbers[1] doubleValue],[numbers[3] doubleValue],[numbers[4] doubleValue]):NSZeroRect;
}
static NSImage *SlideImage(NSDictionary *doc,NSDictionary *slide) {
    if(!slide.count)return nil;
    CGFloat w=[doc[@"width"] doubleValue],h=[doc[@"height"] doubleValue];if(w<=0||h<=0){w=1920;h=1080;}
    NSImage *image=[[NSImage alloc] initWithSize:NSMakeSize(640,640*h/w)];[image lockFocus];[NSColor.blackColor setFill];NSRectFill(NSMakeRect(0,0,640,640*h/w));
    NSAffineTransform *transform=[NSAffineTransform transform];[transform scaleBy:640/w];[transform concat];
    for(NSDictionary *m in slide[@"media"]){NSRect r=[m[@"background"] boolValue]?NSMakeRect(0,0,w,h):SlideRect(m[@"position"]);if(![m[@"background"] boolValue])r.origin.y=h-r.origin.y-r.size.height;
        NSString *path=m[@"sourcePath"];NSDictionary *attrs=path.length?[NSFileManager.defaultManager attributesOfItemAtPath:path error:NULL]:nil;
        NSImage *asset=([attrs[NSFileSize] unsignedLongLongValue]<=32ULL*1024*1024 && ![m[@"kind"] isEqual:@"RVVideoElement"])?[[NSImage alloc] initWithContentsOfFile:path ?: @""]:nil;
        if(asset)[asset drawInRect:r fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1];
        else {[[NSColor colorWithCalibratedWhite:.2 alpha:1] setFill];NSRectFill(r);[[NSString stringWithFormat:@"미리보기 없음: %@",m[@"basename"] ?: @""] drawInRect:NSInsetRect(r,12,12) withAttributes:@{NSFontAttributeName:[NSFont systemFontOfSize:28],NSForegroundColorAttributeName:NSColor.whiteColor}];}
    }
    for(NSDictionary *t in slide[@"texts"]){NSRect r=SlideRect(t[@"position"]);r.origin.y=h-r.origin.y-r.size.height;NSData *rtf=[[NSData alloc] initWithBase64EncodedString:t[@"rtfBase64"] ?: @"" options:NSDataBase64DecodingIgnoreUnknownCharacters];NSAttributedString *text=rtf?[[NSAttributedString alloc] initWithRTF:rtf documentAttributes:NULL]:nil;if(text)[text drawInRect:r];}
    [image unlockFocus];return image;
}
@interface YBDocumentComparison ()
@property NSArray *rows;
@property NSDictionary *localDoc;
@property NSDictionary *remoteDoc;
@property NSTableView *table;
@property NSArray *texts;
@property NSArray *images;
@property NSArray *titles;
@end
@implementation YBDocumentComparison
- (instancetype)initWithLocal:(NSDictionary *)local remote:(NSDictionary *)remote {
    if((self=[super initWithFrame:NSMakeRect(0,0,900,510)])){
        self.localDoc=local ?: @{};self.remoteDoc=remote ?: @{};self.rows=YBComparisonRows(local,remote);
        [self addSubview:YBLabel(@"슬라이드별 차이 · + 서버에 추가 / − 서버에 없음 (Mac 기준)",NSMakeRect(0,484,900,24),13,YES)];
        self.table=YBTable(self,NSMakeRect(0,370,900,110),@[@[@"local",@"Mac 슬라이드",@130],@[@"remote",@"서버 슬라이드",@130],@[@"status",@"변경 내용",@620]],self);self.table.allowsMultipleSelection=NO;
        NSMutableArray *texts=[NSMutableArray array],*images=[NSMutableArray array],*titles=[NSMutableArray array];
        for(NSUInteger i=0;i<2;i++){CGFloat x=i*456;NSTextField *title=YBLabel(i?@"서버 버전":@"이 Mac 버전",NSMakeRect(x,338,444,26),15,YES);[self addSubview:title];[titles addObject:title];
            NSImageView *image=[[NSImageView alloc] initWithFrame:NSMakeRect(x,158,444,176)];image.imageScaling=NSImageScaleProportionallyUpOrDown;[self addSubview:image];[images addObject:image];
            NSScrollView *scroll=[[NSScrollView alloc] initWithFrame:NSMakeRect(x,22,444,132)];scroll.hasVerticalScroller=YES;scroll.borderType=NSBezelBorder;
            NSTextView *text=[[NSTextView alloc] initWithFrame:NSMakeRect(0,0,424,132)];text.editable=NO;text.richText=YES;text.verticallyResizable=YES;text.horizontallyResizable=NO;text.autoresizingMask=NSViewWidthSizable;text.textContainer.widthTracksTextView=YES;text.textContainerInset=NSMakeSize(6,6);scroll.documentView=text;[self addSubview:scroll];[texts addObject:text];
        }self.texts=texts;self.images=images;self.titles=titles;
        [self addSubview:YBLabel(@"미리보기는 근사 화면입니다. 아래 본문·경로의 색칠된 줄이 다릅니다. PP6 실제 출력과 차이가 있을 수 있습니다.",NSMakeRect(0,0,900,20),11,NO)];
        NSUInteger selected=[self.rows indexOfObjectPassingTest:^BOOL(NSDictionary *r,NSUInteger i,BOOL *stop){return [r[@"changed"] boolValue];}];if(selected==NSNotFound)selected=0;
        if(self.rows.count)[self.table selectRowIndexes:[NSIndexSet indexSetWithIndex:selected] byExtendingSelection:NO];else for(NSTextView *text in self.texts)text.string=@"양쪽 모두 문서가 없습니다. 이전 비교 기록만 남아 있던 항목입니다.";
    }return self;
}
- (NSInteger)numberOfRowsInTableView:(NSTableView *)table {return self.rows.count;}
- (NSView *)tableView:(NSTableView *)table viewForTableColumn:(NSTableColumn *)column row:(NSInteger)index {
    NSDictionary *row=self.rows[index];NSString *key=column.identifier,*value=row[key];
    if(![key isEqual:@"status"]){NSDictionary *slide=row[key];value=slide.count?[NSString stringWithFormat:@"%@장 · %@",slide[@"index"],slide[@"groupName"] ?: @""]:@"없음";}
    NSTextField *label=YBLabel(value,NSMakeRect(0,0,column.width,24),12,[row[@"changed"] boolValue]);label.toolTip=value;return label;
}
- (void)tableViewSelectionDidChange:(NSNotification *)note {
    NSInteger index=self.table.selectedRow;if(index<0||index>=self.rows.count)return;NSDictionary *row=self.rows[index];NSString *a=SlideText(row[@"local"]),*b=SlideText(row[@"remote"]);
    [[(NSTextView *)self.texts[0] textStorage] setAttributedString:YBHighlightedLines(a,b,NO)];[[(NSTextView *)self.texts[1] textStorage] setAttributedString:YBHighlightedLines(b,a,YES)];
    for(NSTextView *text in self.texts)[text scrollRangeToVisible:NSMakeRange(0,0)];
    [(NSImageView *)self.images[0] setImage:SlideImage(self.localDoc,row[@"local"])];[(NSImageView *)self.images[1] setImage:SlideImage(self.remoteDoc,row[@"remote"])];
    [(NSTextField *)self.titles[0] setStringValue:[NSString stringWithFormat:@"이 Mac · %@",[row[@"local"] count]?[NSString stringWithFormat:@"%@장",row[@"local"][@"index"]]:@"슬라이드 없음"]];
    [(NSTextField *)self.titles[1] setStringValue:[NSString stringWithFormat:@"서버 · %@",[row[@"remote"] count]?[NSString stringWithFormat:@"%@장",row[@"remote"][@"index"]]:@"슬라이드 없음"]];
}
@end
