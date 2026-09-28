#import <Cocoa/Cocoa.h>
#import <AVFoundation/AVFoundation.h>
#import "PP6Core.h"

static NSRect ParseRect(NSString *s) {
    NSString *base = s ?: @"";
    NSString *clean = [[[[base stringByReplacingOccurrencesOfString:@"{" withString:@""] stringByReplacingOccurrencesOfString:@"}" withString:@""] stringByReplacingOccurrencesOfString:@"," withString:@" "] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    NSArray *raw=[clean componentsSeparatedByCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];NSMutableArray *v=[NSMutableArray array];for(NSString*x in raw)if(x.length)[v addObject:x];
    if(v.count<5)return NSZeroRect;return NSMakeRect([v[0] doubleValue],[v[1] doubleValue],[v[3] doubleValue],[v[4] doubleValue]);
}

static NSImage *FrameForVideo(NSString *path) {
    NSURL *u=[NSURL fileURLWithPath:path]; AVURLAsset *asset=[AVURLAsset URLAssetWithURL:u options:nil]; AVAssetImageGenerator *g=[[AVAssetImageGenerator alloc] initWithAsset:asset];g.appliesPreferredTrackTransform=YES;
    NSError *err=nil; CGImageRef cg=[g copyCGImageAtTime:CMTimeMakeWithSeconds(0.5,600) actualTime:NULL error:&err]; if(!cg)cg=[g copyCGImageAtTime:kCMTimeZero actualTime:NULL error:&err]; if(!cg)return nil;
    NSImage *img=[[NSImage alloc] initWithCGImage:cg size:NSZeroSize];CGImageRelease(cg);return img;
}

static void DrawImageAspectFill(NSImage *img, NSRect rect) {
    if(!img)return; NSSize sz=img.size;if(sz.width<=0||sz.height<=0)return;CGFloat scale=MAX(rect.size.width/sz.width,rect.size.height/sz.height);NSSize ds=NSMakeSize(sz.width*scale,sz.height*scale);NSRect dst=NSMakeRect(NSMidX(rect)-ds.width/2,NSMidY(rect)-ds.height/2,ds.width,ds.height);[NSGraphicsContext saveGraphicsState];NSBezierPath *clip=[NSBezierPath bezierPathWithRect:rect];[clip addClip];[img drawInRect:dst fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1.0 respectFlipped:NO hints:nil];[NSGraphicsContext restoreGraphicsState];
}

static void DrawMissing(NSString *name, NSRect rect) {
    [[NSColor colorWithCalibratedRed:0.35 green:0.08 blue:0.08 alpha:1] setFill];NSRectFill(rect);NSDictionary *a=@{NSFontAttributeName:[NSFont boldSystemFontOfSize:30],NSForegroundColorAttributeName:[NSColor whiteColor]};NSString *t=[NSString stringWithFormat:@"⚠ missing media\n%@",name ?: @""];[t drawInRect:NSInsetRect(rect,40,40) withAttributes:a];
}

static NSImage *ImageForMedia(NSDictionary *m) {
    NSString *path=m[@"resolution"][@"resolvedPath"] ?: @"";if(!path.length)return nil;NSString *kind=m[@"kind"] ?: @"";if([kind isEqualToString:@"RVVideoElement"])return FrameForVideo(path);return [[NSImage alloc] initWithContentsOfFile:path];
}

static NSAttributedString *RTF(NSString *b64) {
    NSData *d=[[NSData alloc] initWithBase64EncodedString:b64 ?: @"" options:NSDataBase64DecodingIgnoreUnknownCharacters];if(!d)return nil;NSDictionary *attrs=nil;return [[NSAttributedString alloc] initWithRTF:d documentAttributes:&attrs];
}

int main(int argc,const char *argv[]){
    @autoreleasepool {
        NSString *doc=nil,*output=PP6ExpandPath(@"~/Desktop/pp6-slide-preview.png");NSInteger slideNo=1;CGFloat outW=640;NSMutableArray *mediaRoots=[NSMutableArray arrayWithArray:@[@"/Users/Shared/Renewed Vision Media",@"/Users/Shared/ProCG Content"]];BOOL custom=NO;
        for(int i=1;i<argc;i++){NSString*a=[NSString stringWithUTF8String:argv[i]];if([a isEqualToString:@"--document"]&&i+1<argc){doc=PP6ExpandPath([NSString stringWithUTF8String:argv[++i]]);continue;}if([a isEqualToString:@"--slide"]&&i+1<argc){slideNo=atoi(argv[++i]);continue;}if([a isEqualToString:@"--output"]&&i+1<argc){output=PP6ExpandPath([NSString stringWithUTF8String:argv[++i]]);continue;}if([a isEqualToString:@"--width"]&&i+1<argc){outW=atof(argv[++i]);continue;}if([a isEqualToString:@"--media"]&&i+1<argc){if(!custom){[mediaRoots removeAllObjects];custom=YES;}[mediaRoots addObject:PP6ExpandPath([NSString stringWithUTF8String:argv[++i]])];continue;}}
        if(!doc.length){fprintf(stderr,"Usage: pp6-thumbnail --document FILE --slide N [--output PNG] [--width 640] [--media PATH ...]\n");return 2;}
        NSFileManager *fm=[NSFileManager defaultManager];NSMutableArray *valid=[NSMutableArray array];for(NSString*r in mediaRoots){BOOL d=NO;if([fm fileExistsAtPath:r isDirectory:&d]&&d)[valid addObject:r];}
        NSDictionary *idx=PP6BuildMediaIndex(valid);NSDictionary *parsed=PP6ParseDocument(doc,valid,idx,@[],@{},YES);NSArray *slides=parsed[@"slides"] ?: @[];if(slideNo<1||slideNo>slides.count){fprintf(stderr,"Slide out of range (1..%lu)\n",(unsigned long)slides.count);return 3;}NSDictionary *s=slides[slideNo-1];CGFloat docW=[parsed[@"width"] doubleValue] ?: 1920, docH=[parsed[@"height"] doubleValue] ?: 1080, outH=outW*(docH/docW);
        NSImage *canvas=[[NSImage alloc] initWithSize:NSMakeSize(outW,outH)];[canvas lockFocus];[[NSColor blackColor] setFill];NSRectFill(NSMakeRect(0,0,outW,outH));
        NSAffineTransform *tf=[NSAffineTransform transform];[tf scaleXBy:outW/docW yBy:outH/docH];[tf concat];
        NSDictionary *bg=nil;for(NSDictionary*m in s[@"media"] ?: @[])if([m[@"background"] boolValue]){bg=m;break;}if(bg){NSImage *img=ImageForMedia(bg);if(img)DrawImageAspectFill(img,NSMakeRect(0,0,docW,docH));else DrawMissing(bg[@"basename"],NSMakeRect(0,0,docW,docH));}
        for(NSDictionary*m in s[@"media"] ?: @[]){if([m[@"background"] boolValue])continue;NSRect r=ParseRect(m[@"position"]);r.origin.y=docH-r.origin.y-r.size.height;NSImage*img=ImageForMedia(m);if(img)DrawImageAspectFill(img,r);else DrawMissing(m[@"basename"],r);}
        for(NSDictionary*t in s[@"texts"] ?: @[]){NSRect r=ParseRect(t[@"position"]);r.origin.y=docH-r.origin.y-r.size.height;NSAttributedString*a=RTF(t[@"rtfBase64"]);if(a)[a drawInRect:r];}
        [canvas unlockFocus];NSBitmapImageRep *rep=[[NSBitmapImageRep alloc] initWithData:[canvas TIFFRepresentation]];NSData *png=[rep representationUsingType:NSPNGFileType properties:@{}];NSError *err=nil;[fm createDirectoryAtPath:[output stringByDeletingLastPathComponent] withIntermediateDirectories:YES attributes:nil error:nil];if(![png writeToFile:output options:NSDataWritingAtomic error:&err]){fprintf(stderr,"write error: %s\n",err.localizedDescription.UTF8String);return 4;}printf("written: %s\n",output.UTF8String);
    }return 0;
}
