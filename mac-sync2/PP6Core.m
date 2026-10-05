#import "PP6Core.h"
#import <CommonCrypto/CommonDigest.h>

NSString * const PP6CoreSchemaVersion = @"pp6-core-v0.2";

#pragma mark - Basic helpers

NSString *PP6NFC(NSString *s) {
    return s ? [s precomposedStringWithCanonicalMapping] : @"";
}

NSString *PP6ExpandPath(NSString *s) {
    if (!s) return @"";
    return [[s stringByExpandingTildeInPath] stringByStandardizingPath];
}

NSString *PP6SHA256String(NSString *s) {
    NSData *data = [(s ?: @"") dataUsingEncoding:NSUTF8StringEncoding];
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
    NSMutableString *out = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
    for (NSInteger i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) [out appendFormat:@"%02x", digest[i]];
    return out;
}

static NSDictionary *PP6FileStat(NSString *path) {
    NSDictionary *a = [[NSFileManager defaultManager] attributesOfItemAtPath:path error:nil];
    if (!a) return @{};
    NSDate *d = a[NSFileModificationDate];
    return @{ @"size": a[NSFileSize] ?: @0,
              @"mtime": @((long long)(d ? [d timeIntervalSince1970] : 0)) };
}

NSString *PP6RelativePath(NSString *path, NSString *root) {
    NSString *p = PP6ExpandPath(path), *r = PP6ExpandPath(root);
    if ([p isEqualToString:r]) return @"";
    NSString *prefix = [r stringByAppendingString:@"/"];
    return [p hasPrefix:prefix] ? [p substringFromIndex:prefix.length] : p;
}

static BOOL PP6PathUnderRoot(NSString *path, NSString *root) {
    NSString *p = PP6ExpandPath(path), *r = PP6ExpandPath(root);
    return [p isEqualToString:r] || [p hasPrefix:[r stringByAppendingString:@"/"]];
}

static NSString *PP6MediaType(NSString *path) {
    NSString *e = [[path pathExtension] lowercaseString];
    static NSSet *images, *videos, *audio;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        images = [NSSet setWithArray:@[@"jpg",@"jpeg",@"png",@"gif",@"bmp",@"tif",@"tiff",@"webp",@"psd"]];
        videos = [NSSet setWithArray:@[@"mov",@"mp4",@"m4v",@"avi",@"mpg",@"mpeg"]];
        audio = [NSSet setWithArray:@[@"wav",@"mp3",@"m4a",@"aif",@"aiff",@"aac"]];
    });
    if ([images containsObject:e]) return @"image";
    if ([videos containsObject:e]) return @"video";
    if ([audio containsObject:e]) return @"audio";
    return @"other";
}

static NSString *PP6SourcePath(NSString *source) {
    if (!source.length) return @"";
    if ([source hasPrefix:@"file://"]) {
        NSURL *u = [NSURL URLWithString:source];
        if (u.path.length) return [u.path stringByStandardizingPath];
        NSString *stripped = [source substringFromIndex:7];
        return [[[stripped stringByRemovingPercentEncoding] ?: stripped stringByExpandingTildeInPath] stringByStandardizingPath];
    }
    NSString *decoded = [source stringByRemovingPercentEncoding] ?: source;
    return PP6ExpandPath(decoded);
}

static NSString *PP6Attr(NSXMLElement *e, NSString *name) {
    return [[e attributeForName:name] stringValue] ?: @"";
}

static NSString *PP6SortedAttributes(NSXMLElement *e, NSSet<NSString *> *exclude) {
    NSArray *attrs = [[e attributes] sortedArrayUsingComparator:^NSComparisonResult(NSXMLNode *a, NSXMLNode *b) {
        return [[a name] compare:[b name]];
    }];
    NSMutableArray *parts = [NSMutableArray array];
    for (NSXMLNode *a in attrs) {
        if ([exclude containsObject:a.name]) continue;
        [parts addObject:[NSString stringWithFormat:@"%@=%@", a.name ?: @"", a.stringValue ?: @""]];
    }
    return [parts componentsJoinedByString:@"|"];
}

// 요소 찾기는 XPath 대신 자식을 직접 훑는다. PP6가 저장한 문서에서 상대 XPath(.//)가 문서 전체를 훑어
// 한 장에 모든 장의 요소가 모이는 일이 있었다(10-05 실기).
static void PP6CollectDescendants(NSXMLElement *e, NSString *name, NSString *ivar, NSMutableArray *out) {
    for (NSXMLNode *child in e.children) {
        if (child.kind != NSXMLElementKind) continue;
        NSXMLElement *element = (NSXMLElement *)child;
        if ([element.name isEqualToString:name] && (!ivar || [[element attributeForName:@"rvXMLIvarName"].stringValue isEqualToString:ivar])) [out addObject:element];
        PP6CollectDescendants(element, name, ivar, out);
    }
}
static NSArray *PP6Descendants(NSXMLElement *e, NSString *name, NSString *ivar) {
    NSMutableArray *out = [NSMutableArray array]; PP6CollectDescendants(e, name, ivar, out); return out;
}
static NSArray *PP6Children(NSXMLElement *e, NSString *name, NSString *ivar) {
    NSMutableArray *out = [NSMutableArray array];
    for (NSXMLNode *child in e.children) {
        if (child.kind != NSXMLElementKind) continue;
        NSXMLElement *element = (NSXMLElement *)child;
        if ([element.name isEqualToString:name] && (!ivar || [[element attributeForName:@"rvXMLIvarName"].stringValue isEqualToString:ivar])) [out addObject:element];
    }
    return out;
}
static NSString *PP6ChildText(NSXMLElement *e, NSString *name, NSString *ivar) {
    NSXMLNode *n = PP6Children(e, name, ivar).firstObject;
    return [[n stringValue] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] ?: @"";
}

static NSString *PP6CollapseWhitespace(NSString *s) {
    NSArray *parts = [(s ?: @"") componentsSeparatedByCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    NSMutableArray *clean = [NSMutableArray array];
    for (NSString *p in parts) if (p.length) [clean addObject:p];
    return [clean componentsJoinedByString:@" "];
}

static NSString *PP6RTFPlainText(NSString *base64) {
    if (!base64.length) return @"";
    NSData *data = [[NSData alloc] initWithBase64EncodedString:base64 options:NSDataBase64DecodingIgnoreUnknownCharacters];
    if (!data) return @"";
    NSDictionary *attrs = nil;
    NSAttributedString *a = [[NSAttributedString alloc] initWithRTF:data documentAttributes:&attrs];
    NSString *s = a.string ?: @"";
    s = [s stringByReplacingOccurrencesOfString:@"\r\n" withString:@"\n"];
    s = [s stringByReplacingOccurrencesOfString:@"\r" withString:@"\n"];
    return [s stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
}

NSArray<NSString *> *PP6ScanFiles(NSString *root, BOOL pro6Only) {
    NSFileManager *fm = [NSFileManager defaultManager];
    BOOL dir = NO;
    if (![fm fileExistsAtPath:root isDirectory:&dir] || !dir) return @[];
    NSMutableArray *out = [NSMutableArray array];
    NSDirectoryEnumerator *en = [fm enumeratorAtPath:root];
    NSString *rel;
    while ((rel = [en nextObject])) {
        NSString *full = [root stringByAppendingPathComponent:rel];
        BOOL isDir = NO;
        if (![fm fileExistsAtPath:full isDirectory:&isDir] || isDir) continue;
        if (pro6Only) {
            if (![[[full pathExtension] lowercaseString] isEqualToString:@"pro6"]) continue;
        } else {
            if ([[PP6MediaType(full) lowercaseString] isEqualToString:@"other"]) continue;
        }
        [out addObject:full];
    }
    return out;
}

#pragma mark - Media index / resolver

NSDictionary *PP6BuildMediaIndex(NSArray<NSString *> *roots) {
    NSMutableArray *assets = [NSMutableArray array];
    NSMutableDictionary *byBase = [NSMutableDictionary dictionary];
    NSFileManager *fm = [NSFileManager defaultManager];
    NSMutableArray *existingRoots = [NSMutableArray array];
    for (NSString *raw in roots ?: @[]) {
        NSString *root = PP6ExpandPath(raw); BOOL dir = NO;
        if (![fm fileExistsAtPath:root isDirectory:&dir] || !dir) continue;
        [existingRoots addObject:root];
        for (NSString *path in PP6ScanFiles(root, NO)) {
            NSDictionary *st = PP6FileStat(path);
            NSString *base = path.lastPathComponent ?: @"", *key = PP6NFC(base);
            NSDictionary *a = @{ @"path": path, @"root": root,
                                  @"relativePath": PP6RelativePath(path, root),
                                  @"basename": base, @"normalizedBasename": key,
                                  @"mediaType": PP6MediaType(path),
                                  @"size": st[@"size"] ?: @0, @"mtime": st[@"mtime"] ?: @0 };
            [assets addObject:a];
            NSMutableArray *arr = byBase[key];
            if (!arr) { arr = [NSMutableArray array]; byBase[key] = arr; }
            [arr addObject:a];
        }
    }
    return @{ @"roots": existingRoots, @"assets": assets, @"byBasename": byBase };
}

static NSDictionary *PP6ResolveMedia(NSString *sourcePath, NSString *basename,
                                     NSArray *managedRoots, NSDictionary *managedIndex,
                                     NSArray *packageRoots, NSDictionary *packageIndex) {
    NSFileManager *fm = [NSFileManager defaultManager];
    if (sourcePath.length && [fm fileExistsAtPath:sourcePath]) {
        BOOL managed = NO, package = NO;
        for (NSString *r in managedRoots ?: @[]) if (PP6PathUnderRoot(sourcePath, r)) { managed = YES; break; }
        for (NSString *r in packageRoots ?: @[]) if (PP6PathUnderRoot(sourcePath, r)) { package = YES; break; }
        NSDictionary *st = PP6FileStat(sourcePath);
        NSString *status = managed ? @"exact-managed" : (package ? @"exact-package" : @"exact-external");
        return @{ @"status": status, @"resolvedPath": sourcePath, @"candidateCount": @1,
                  @"size": st[@"size"] ?: @0, @"mtime": st[@"mtime"] ?: @0 };
    }
    NSString *key = PP6NFC(basename ?: @"");
    NSMutableArray *cands = [NSMutableArray array];
    NSDictionary *managedBy = managedIndex[@"byBasename"] ?: @{};
    NSDictionary *packageBy = packageIndex[@"byBasename"] ?: @{};
    NSArray *managedCandidates = managedBy[key] ?: @[];
    NSArray *packageCandidates = packageBy[key] ?: @[];
    for (NSDictionary *a in managedCandidates) {
        [cands addObject:@{ @"origin": @"managed", @"asset": a }];
    }
    for (NSDictionary *a in packageCandidates) {
        [cands addObject:@{ @"origin": @"package", @"asset": a }];
    }
    if (cands.count == 1) {
        NSDictionary *c = cands.firstObject, *a = c[@"asset"];
        NSString *status = [c[@"origin"] isEqualToString:@"package"] ? @"package-asset" : @"relocated-unique";
        return @{ @"status": status, @"resolvedPath": a[@"path"] ?: @"", @"candidateCount": @1,
                  @"size": a[@"size"] ?: @0, @"mtime": a[@"mtime"] ?: @0 };
    }
    if (cands.count > 1) {
        NSMutableArray *paths = [NSMutableArray array];
        for (NSDictionary *c in cands) if (c[@"asset"][@"path"]) [paths addObject:c[@"asset"][@"path"]];
        return @{ @"status": @"ambiguous", @"resolvedPath": @"", @"candidateCount": @(cands.count), @"candidates": paths };
    }
    return @{ @"status": @"missing", @"resolvedPath": @"", @"candidateCount": @0 };
}

#pragma mark - Parse document

static NSDictionary *PP6ParseTextElement(NSXMLElement *te) {
    NSArray *rtfNodes = PP6Descendants(te, @"NSString", @"RTFData");
    NSString *b64 = [rtfNodes.firstObject stringValue] ?: @"";
    NSString *text = PP6RTFPlainText(b64);
    NSString *position = PP6ChildText(te, @"RVRect3D", @"position");
    NSString *shadow = PP6ChildText(te, @"shadow", @"shadow");
    NSArray *strokeNodes = PP6Children(te, @"dictionary", @"stroke");
    NSString *stroke = strokeNodes.count ? [strokeNodes.firstObject XMLStringWithOptions:NSXMLNodeCompactEmptyElement] : @"";
    NSString *attrs = PP6SortedAttributes(te, [NSSet setWithArray:@[@"UUID",@"source"]]);
    NSString *style = [@[attrs, position, shadow, stroke] componentsJoinedByString:@"||"];
    return @{ @"displayName": PP6Attr(te,@"displayName"), @"text": text,
              @"normalizedText": PP6CollapseWhitespace(text), @"position": position,
              @"styleSignature": style, @"rtfBase64": b64 };
}

static NSDictionary *PP6ParseMediaElement(NSXMLElement *me) {
    NSString *source = PP6Attr(me,@"source"), *path = PP6SourcePath(source);
    NSString *base = PP6NFC(path.lastPathComponent ?: @"");
    NSXMLNode *parent = me.parent;
    BOOL background = [[parent name] isEqualToString:@"RVMediaCue"] &&
                      [PP6Attr((NSXMLElement *)parent,@"rvXMLIvarName") isEqualToString:@"backgroundMediaCue"];
    NSString *position = PP6ChildText(me, @"RVRect3D", @"position");
    NSString *attrs = PP6SortedAttributes(me, [NSSet setWithArray:@[@"UUID",@"source",@"manufactureURL",@"manufactureName"]]);
    return @{ @"kind": me.name ?: @"", @"basename": base, @"source": source,
              @"sourcePath": path, @"background": @(background), @"position": position,
              @"styleSignature": attrs, @"uuid": PP6Attr(me,@"UUID") };
}

static NSDictionary *PP6ParseSlide(NSXMLElement *slide,
                                   NSInteger globalIndex, NSInteger groupIndex, NSInteger groupSlide,
                                   NSString *groupUUID, NSString *groupName,
                                   NSArray *managedRoots, NSDictionary *managedIndex,
                                   NSArray *packageRoots, NSDictionary *packageIndex) {
    NSMutableArray *texts = [NSMutableArray array];
    for (NSXMLElement *te in PP6Descendants(slide, @"RVTextElement", nil)) [texts addObject:PP6ParseTextElement(te)];
    NSMutableArray *media = [NSMutableArray array];
    NSArray *mediaNodes = [PP6Descendants(slide, @"RVImageElement", nil) arrayByAddingObjectsFromArray:PP6Descendants(slide, @"RVVideoElement", nil)];
    for (NSXMLElement *me in mediaNodes) {
        NSMutableDictionary *m = [PP6ParseMediaElement(me) mutableCopy];
        m[@"resolution"] = PP6ResolveMedia(m[@"sourcePath"], m[@"basename"], managedRoots, managedIndex, packageRoots, packageIndex);
        [media addObject:m];
    }

    NSString *slideAttrs = PP6SortedAttributes(slide, [NSSet setWithArray:@[@"UUID",@"label",@"notes",@"hotKey",@"socialItemCount"]]);
    NSMutableArray *sem = [NSMutableArray arrayWithObject:slideAttrs];
    NSMutableArray *layout = [NSMutableArray arrayWithObject:slideAttrs];
    NSMutableArray *identityTexts = [NSMutableArray array];
    for (NSDictionary *t in texts) {
        [sem addObjectsFromArray:@[@"T",t[@"displayName"],t[@"text"],t[@"styleSignature"]]];
        [layout addObjectsFromArray:@[@"T",t[@"displayName"],t[@"position"],t[@"styleSignature"]]];
        if ([t[@"normalizedText"] length]) [identityTexts addObject:t[@"normalizedText"]];
    }
    for (NSDictionary *m in media) {
        [sem addObjectsFromArray:@[@"M",m[@"kind"],m[@"basename"],[m[@"background"] stringValue],m[@"position"],m[@"styleSignature"]]];
        [layout addObjectsFromArray:@[@"M",m[@"kind"],[m[@"background"] stringValue],m[@"position"],m[@"styleSignature"]]];
    }
    NSString *semantic = PP6SHA256String([sem componentsJoinedByString:@"\x1e"]);
    NSString *layoutHash = PP6SHA256String([layout componentsJoinedByString:@"\x1e"]);
    NSMutableArray *tech = [sem mutableCopy];
    [tech addObject:[NSString stringWithFormat:@"UUID=%@",PP6Attr(slide,@"UUID")]];
    for (NSDictionary *m in media) [tech addObject:m[@"sourcePath"] ?: @""];
    NSString *technical = PP6SHA256String([tech componentsJoinedByString:@"\x1e"]);

    NSString *label = PP6NFC(PP6Attr(slide,@"label"));
    NSMutableArray *identity = [NSMutableArray arrayWithArray:@[label,
        [identityTexts componentsJoinedByString:@"\x1f"],
        [NSString stringWithFormat:@"%lu",(unsigned long)texts.count],
        [NSString stringWithFormat:@"%lu",(unsigned long)media.count]]];
    if (!label.length && !identityTexts.count) {
        NSMutableArray *names = [NSMutableArray array];
        for (NSDictionary *m in media) [names addObject:m[@"basename"] ?: @""];
        [identity addObject:[names componentsJoinedByString:@"\x1f"]];
    }

    return @{ @"index": @(globalIndex), @"groupIndex": @(groupIndex), @"groupSlide": @(groupSlide),
              @"groupUUID": groupUUID ?: @"", @"groupName": groupName ?: @"",
              @"uuid": PP6Attr(slide,@"UUID"), @"label": PP6Attr(slide,@"label"),
              @"texts": texts, @"media": media,
              @"identityFingerprint": PP6SHA256String([identity componentsJoinedByString:@"\x1e"]),
              @"semanticFingerprint": semantic, @"layoutFingerprint": layoutHash,
              @"technicalFingerprint": technical };
}

NSDictionary *PP6ParseDocument(NSString *path,
                               NSArray *managedMediaRoots, NSDictionary *managedMediaIndex,
                               NSArray *packageAssetRoots, NSDictionary *packageAssetIndex,
                               BOOL includeSlides) {
    NSError *err = nil;
    NSData *data = [NSData dataWithContentsOfFile:path options:0 error:&err];
    if (!data) return @{ @"path": path ?: @"", @"parseError": err.localizedDescription ?: @"read-failed" };
    return PP6ParseDocumentData(data,path,managedMediaRoots,managedMediaIndex,packageAssetRoots,packageAssetIndex,includeSlides);
}

NSDictionary *PP6ParseDocumentData(NSData *data, NSString *path,
                                  NSArray *managedMediaRoots, NSDictionary *managedMediaIndex,
                                  NSArray *packageAssetRoots, NSDictionary *packageAssetIndex, BOOL includeSlides) {
    NSError *err=nil; NSString *text=[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if(!text || data.length>25*1024*1024 || [text rangeOfString:@"(?i)<!DOCTYPE|<!ENTITY" options:NSRegularExpressionSearch].location!=NSNotFound)
        return @{ @"path":path ?: @"", @"parseError":@"문서 인코딩·크기 또는 외부 엔터티를 확인하세요." };
    NSXMLDocument *xml = [[NSXMLDocument alloc] initWithData:data options:NSXMLNodePreserveWhitespace | NSXMLNodeLoadExternalEntitiesNever error:&err];
    if (!xml) return @{ @"path": path ?: @"", @"parseError": err.localizedDescription ?: @"xml-parse-failed" };
    NSXMLElement *root = xml.rootElement;
    if(![root.name isEqualToString:@"RVPresentationDocument"]) return @{ @"path":path ?: @"", @"parseError":@"PP6 문서가 아닙니다." };

    NSMutableArray *groups = [NSMutableArray array], *allSlides = [NSMutableArray array], *allRefs = [NSMutableArray array];
    NSInteger gi = 0, global = 0;
    for (NSXMLElement *g in PP6Descendants(root, @"RVSlideGrouping", nil)) {
        gi++; NSInteger gsi = 0;
        NSString *guuid = PP6Attr(g,@"uuid"), *gname = PP6Attr(g,@"name");
        NSMutableArray *slides = [NSMutableArray array];
        for (NSXMLElement *s in PP6Descendants(g, @"RVDisplaySlide", nil)) {
            global++; gsi++;
            NSDictionary *sd = PP6ParseSlide(s, global, gi, gsi, guuid, gname,
                                             managedMediaRoots, managedMediaIndex,
                                             packageAssetRoots, packageAssetIndex);
            [slides addObject:sd]; [allSlides addObject:sd];
            for (NSDictionary *m in sd[@"media"]) {
                [allRefs addObject:@{ @"slide": @(global), @"groupIndex": @(gi), @"groupSlide": @(gsi),
                                      @"groupName": gname ?: @"", @"kind": m[@"kind"] ?: @"",
                                      @"basename": m[@"basename"] ?: @"", @"source": m[@"source"] ?: @"",
                                      @"sourcePath": m[@"sourcePath"] ?: @"", @"background": m[@"background"] ?: @NO,
                                      @"resolution": m[@"resolution"] ?: @{} }];
            }
        }
        NSMutableArray *slideHashes = [NSMutableArray array];
        for (NSDictionary *s in slides) [slideHashes addObject:s[@"semanticFingerprint"] ?: @""];
        [groups addObject:@{ @"index": @(gi), @"uuid": guuid ?: @"", @"name": gname ?: @"",
                             @"color": PP6Attr(g,@"color"), @"slideCount": @(slides.count),
                             @"slides": includeSlides ? slides : @[], @"semanticSequence": slideHashes }];
    }

    NSString *rootAttrs = PP6SortedAttributes(root, [NSSet setWithArray:@[@"uuid",@"lastDateUsed",@"usedCount",@"buildNumber"]]);
    NSMutableArray *docSem = [NSMutableArray arrayWithObject:rootAttrs];
    for (NSDictionary *g in groups) {
        [docSem addObjectsFromArray:@[g[@"name"] ?: @"", g[@"color"] ?: @""]];
        [docSem addObjectsFromArray:g[@"semanticSequence"] ?: @[]];
    }
    NSDictionary *st = PP6FileStat(path);
    return @{ @"schema": PP6CoreSchemaVersion, @"path": path ?: @"", @"basename": path.lastPathComponent ?: @"",
              @"size": st[@"size"] ?: @0, @"mtime": st[@"mtime"] ?: @0,
              @"rootUUID": PP6Attr(root,@"uuid"), @"width": PP6Attr(root,@"width"), @"height": PP6Attr(root,@"height"),
              @"category": PP6Attr(root,@"category"), @"docType": PP6Attr(root,@"docType"),
              @"groupCount": @(groups.count), @"slideCount": @(global),
              @"semanticFingerprint": PP6SHA256String([docSem componentsJoinedByString:@"\x1d"]),
              @"groups": groups, @"slides": includeSlides ? allSlides : @[], @"mediaRefs": allRefs,
              @"parseError": @"" };
}

#pragma mark - Diff helpers

static NSArray *PP6LCSPairs(NSArray<NSString *> *a, NSArray<NSString *> *b) {
    NSInteger m=a.count,n=b.count, cols=n+1;
    NSInteger *dp = calloc((m+1)*(n+1), sizeof(NSInteger));
    #define DP(i,j) dp[(i)*cols+(j)]
    for (NSInteger i=m-1;i>=0;i--) for (NSInteger j=n-1;j>=0;j--)
        DP(i,j) = [a[i] isEqualToString:b[j]] ? DP(i+1,j+1)+1 : MAX(DP(i+1,j),DP(i,j+1));
    NSMutableArray *pairs=[NSMutableArray array]; NSInteger i=0,j=0;
    while(i<m && j<n) {
        if([a[i] isEqualToString:b[j]]) { [pairs addObject:@[@(i),@(j)]]; i++; j++; }
        else if(DP(i+1,j)>=DP(i,j+1)) i++; else j++;
    }
    free(dp); return pairs;
    #undef DP
}

static NSSet *PP6LISStationary(NSArray<NSArray *> *pairs) {
    NSArray *seq=[pairs sortedArrayUsingComparator:^NSComparisonResult(NSArray *a, NSArray *b){ return [a[1] compare:b[1]]; }];
    NSInteger n=seq.count; if(!n) return [NSSet set];
    NSInteger *dp=calloc(n,sizeof(NSInteger)), *prev=calloc(n,sizeof(NSInteger)); NSInteger best=0;
    for(NSInteger i=0;i<n;i++){ dp[i]=1; prev[i]=-1; for(NSInteger j=0;j<i;j++) if([seq[j][0] integerValue]<[seq[i][0] integerValue] && dp[j]+1>dp[i]){dp[i]=dp[j]+1;prev[i]=j;} if(dp[i]>dp[best])best=i; }
    NSMutableSet *out=[NSMutableSet set]; for(NSInteger k=best;k!=-1;k=prev[k]) [out addObject:[NSString stringWithFormat:@"%@:%@",seq[k][0],seq[k][1]]];
    free(dp); free(prev); return out;
}

static NSString *PP6BackgroundName(NSDictionary *slide) {
    for (NSDictionary *m in slide[@"media"] ?: @[]) if ([m[@"background"] boolValue]) return m[@"basename"] ?: @"";
    return @"";
}

static NSDictionary *PP6SlideDetail(NSDictionary *o, NSDictionary *n) {
    NSArray *ot=o[@"texts"] ?: @[], *nt=n[@"texts"] ?: @[];
    NSMutableArray *textChanges=[NSMutableArray array];
    NSInteger max=MAX(ot.count,nt.count);
    for(NSInteger i=0;i<max;i++){
        NSDictionary *a=i<ot.count?ot[i]:nil,*b=i<nt.count?nt[i]:nil;
        NSString *as=a? a[@"text"]:@"", *bs=b? b[@"text"]:@"";
        if(!a || !b || ![as isEqualToString:bs]) [textChanges addObject:@{ @"index":@(i+1), @"old":a?as:[NSNull null], @"new":b?bs:[NSNull null] }];
    }
    NSMutableArray *oldNon=[NSMutableArray array],*newNon=[NSMutableArray array],*pathChanges=[NSMutableArray array];
    for(NSDictionary *m in o[@"media"] ?: @[]) if(![m[@"background"] boolValue]) [oldNon addObject:[NSString stringWithFormat:@"%@|%@",m[@"kind"],m[@"basename"]]];
    for(NSDictionary *m in n[@"media"] ?: @[]) if(![m[@"background"] boolValue]) [newNon addObject:[NSString stringWithFormat:@"%@|%@",m[@"kind"],m[@"basename"]]];
    for(NSDictionary *a in o[@"media"] ?: @[]) for(NSDictionary *b in n[@"media"] ?: @[]) {
        if([a[@"kind"] isEqualToString:b[@"kind"]] && [a[@"basename"] isEqualToString:b[@"basename"]] && ![a[@"sourcePath"] isEqualToString:b[@"sourcePath"]]) {
            [pathChanges addObject:@{ @"basename":a[@"basename"] ?: @"", @"old":a[@"sourcePath"] ?: @"", @"new":b[@"sourcePath"] ?: @"" }]; break;
        }
    }
    NSString *ob=PP6BackgroundName(o),*nb=PP6BackgroundName(n);
    return @{ @"backgroundChanged":@(![ob isEqualToString:nb]), @"oldBackground":ob, @"newBackground":nb,
              @"textChanges":textChanges, @"mediaChanged":@(![oldNon isEqualToArray:newNon]),
              @"layoutChanged":@(![o[@"layoutFingerprint"] isEqualToString:n[@"layoutFingerprint"]]), @"pathChanges":pathChanges };
}

static NSDictionary *PP6CompareGroups(NSDictionary *og, NSDictionary *ng) {
    NSArray *old=og[@"slides"] ?: @[], *new=ng[@"slides"] ?: @[];
    NSMutableDictionary *matched=[NSMutableDictionary dictionary]; NSMutableSet *usedO=[NSMutableSet set],*usedN=[NSMutableSet set];
    NSMutableDictionary *om=[NSMutableDictionary dictionary],*nm=[NSMutableDictionary dictionary];
    for(NSInteger i=0;i<old.count;i++){NSString *u=old[i][@"uuid"]; if(!u.length)continue; NSMutableArray *a=om[u];if(!a){a=[NSMutableArray array];om[u]=a;}[a addObject:@(i)];}
    for(NSInteger j=0;j<new.count;j++){NSString *u=new[j][@"uuid"]; if(!u.length)continue; NSMutableArray *a=nm[u];if(!a){a=[NSMutableArray array];nm[u]=a;}[a addObject:@(j)];}
    for(NSString *u in om){NSArray *a=om[u],*b=nm[u];if(a.count==1&&b.count==1){matched[a[0]]=b[0];[usedO addObject:a[0]];[usedN addObject:b[0]];}}
    NSMutableArray *ou=[NSMutableArray array],*nu=[NSMutableArray array],*ok=[NSMutableArray array],*nk=[NSMutableArray array];
    for(NSInteger i=0;i<old.count;i++)if(![usedO containsObject:@(i)]){[ou addObject:@(i)];[ok addObject:old[i][@"identityFingerprint"]];}
    for(NSInteger j=0;j<new.count;j++)if(![usedN containsObject:@(j)]){[nu addObject:@(j)];[nk addObject:new[j][@"identityFingerprint"]];}
    for(NSArray *p in PP6LCSPairs(ok,nk)){NSNumber *oi=ou[[p[0] integerValue]],*nj=nu[[p[1] integerValue]];matched[oi]=nj;[usedO addObject:oi];[usedN addObject:nj];}
    om=[NSMutableDictionary dictionary];nm=[NSMutableDictionary dictionary];
    for(NSInteger i=0;i<old.count;i++)if(![usedO containsObject:@(i)]){NSString *h=old[i][@"semanticFingerprint"];NSMutableArray*a=om[h];if(!a){a=[NSMutableArray array];om[h]=a;}[a addObject:@(i)];}
    for(NSInteger j=0;j<new.count;j++)if(![usedN containsObject:@(j)]){NSString *h=new[j][@"semanticFingerprint"];NSMutableArray*a=nm[h];if(!a){a=[NSMutableArray array];nm[h]=a;}[a addObject:@(j)];}
    for(NSString *h in om){NSArray*a=om[h],*b=nm[h];if(a.count==1&&b.count==1){matched[a[0]]=b[0];[usedO addObject:a[0]];[usedN addObject:b[0]];}}
    NSMutableArray *deleted=[NSMutableArray array],*added=[NSMutableArray array],*pairList=[NSMutableArray array];
    for(NSInteger i=0;i<old.count;i++)if(![usedO containsObject:@(i)])[deleted addObject:@(i)];
    for(NSInteger j=0;j<new.count;j++)if(![usedN containsObject:@(j)])[added addObject:@(j)];
    for(NSNumber *oi in matched)[pairList addObject:@[oi,matched[oi]]];
    NSSet *stationary=PP6LISStationary(pairList);
    NSMutableArray *matchedRows=[NSMutableArray array]; NSInteger modified=0,moved=0,technical=0;
    NSArray *sortedPairs=[pairList sortedArrayUsingComparator:^NSComparisonResult(NSArray*a,NSArray*b){return [a[1] compare:b[1]];}];
    for(NSArray *p in sortedPairs){NSInteger i=[p[0] integerValue],j=[p[1] integerValue];NSDictionary *o=old[i],*n=new[j];BOOL mod=![o[@"semanticFingerprint"] isEqualToString:n[@"semanticFingerprint"]];NSString *pk=[NSString stringWithFormat:@"%ld:%ld",(long)i,(long)j];BOOL mov=![stationary containsObject:pk];BOOL tech=!mod && ![o[@"technicalFingerprint"] isEqualToString:n[@"technicalFingerprint"]];if(mod)modified++;if(mov)moved++;if(tech)technical++;
        NSMutableDictionary *r=[@{ @"oldIndex":o[@"index"],@"newIndex":n[@"index"],@"oldGroupSlide":@(i+1),@"newGroupSlide":@(j+1),@"label":[n[@"label"] length]?n[@"label"]:o[@"label"],@"modified":@(mod),@"moved":@(mov),@"technicalOnly":@(tech),@"uuidChanged":@(![o[@"uuid"] isEqualToString:n[@"uuid"]]) } mutableCopy];
        if(mod||tech)r[@"detail"]=PP6SlideDetail(o,n);[matchedRows addObject:r];}
    NSMutableArray *delRows=[NSMutableArray array],*addRows=[NSMutableArray array];
    for(NSNumber *x in deleted){NSDictionary*s=old[x.integerValue];NSMutableArray*tx=[NSMutableArray array];for(NSDictionary*t in s[@"texts"])[tx addObject:t[@"text"]?:@""];[delRows addObject:@{ @"oldIndex":s[@"index"],@"groupSlide":@(x.integerValue+1),@"label":s[@"label"]?:@"",@"texts":tx }];}
    for(NSNumber *x in added){NSDictionary*s=new[x.integerValue];NSMutableArray*tx=[NSMutableArray array];for(NSDictionary*t in s[@"texts"])[tx addObject:t[@"text"]?:@""];[addRows addObject:@{ @"newIndex":s[@"index"],@"groupSlide":@(x.integerValue+1),@"label":s[@"label"]?:@"",@"texts":tx }];}
    return @{ @"counts":@{ @"added":@(added.count),@"deleted":@(deleted.count),@"modified":@(modified),@"moved":@(moved),@"technical":@(technical) },@"deleted":delRows,@"added":addRows,@"matched":matchedRows };
}

NSDictionary *PP6CompareParsedDocuments(NSDictionary *oldDoc, NSDictionary *newDoc) {
    NSArray *og=oldDoc[@"groups"]?:@[],*ng=newDoc[@"groups"]?:@[];NSMutableArray *groupPairs=[NSMutableArray array];NSMutableSet *usedO=[NSMutableSet set],*usedN=[NSMutableSet set];NSMutableDictionary *om=[NSMutableDictionary dictionary],*nm=[NSMutableDictionary dictionary];
    for(NSInteger i=0;i<og.count;i++){NSString*u=og[i][@"uuid"];if(!u.length)continue;NSMutableArray*a=om[u];if(!a){a=[NSMutableArray array];om[u]=a;}[a addObject:@(i)];}
    for(NSInteger j=0;j<ng.count;j++){NSString*u=ng[j][@"uuid"];if(!u.length)continue;NSMutableArray*a=nm[u];if(!a){a=[NSMutableArray array];nm[u]=a;}[a addObject:@(j)];}
    for(NSString*u in om){NSArray*a=om[u],*b=nm[u];if(a.count==1&&b.count==1){[groupPairs addObject:@[a[0],b[0]]];[usedO addObject:a[0]];[usedN addObject:b[0]];}}
    for(NSInteger i=0;i<MIN(og.count,ng.count);i++)if(![usedO containsObject:@(i)]&&![usedN containsObject:@(i)]&&[og[i][@"name"] isEqualToString:ng[i][@"name"]]){[groupPairs addObject:@[@(i),@(i)]];[usedO addObject:@(i)];[usedN addObject:@(i)];}
    groupPairs = [[groupPairs sortedArrayUsingComparator:^NSComparisonResult(NSArray*a,NSArray*b){ return [a[1] compare:b[1]]; }] mutableCopy];
    NSMutableArray *groups=[NSMutableArray array];NSInteger ca=0,cd=0,cm=0,cv=0,ct=0;
    for(NSArray*p in groupPairs){NSInteger i=[p[0] integerValue],j=[p[1] integerValue];NSDictionary*d=PP6CompareGroups(og[i],ng[j]);NSDictionary*c=d[@"counts"];ca+=[c[@"added"] integerValue];cd+=[c[@"deleted"] integerValue];cm+=[c[@"modified"] integerValue];cv+=[c[@"moved"] integerValue];ct+=[c[@"technical"] integerValue];[groups addObject:@{ @"oldGroup":@(i+1),@"newGroup":@(j+1),@"uuid":ng[j][@"uuid"]?:@"",@"name":ng[j][@"name"]?:@"",@"counts":c,@"deleted":d[@"deleted"],@"added":d[@"added"],@"matched":d[@"matched"] }];}
    for(NSInteger i=0;i<og.count;i++)if(![usedO containsObject:@(i)])cd+=[og[i][@"slideCount"] integerValue];
    for(NSInteger j=0;j<ng.count;j++)if(![usedN containsObject:@(j)])ca+=[ng[j][@"slideCount"] integerValue];
    return @{ @"oldSlides":oldDoc[@"slideCount"]?:@0,@"newSlides":newDoc[@"slideCount"]?:@0,@"counts":@{ @"added":@(ca),@"deleted":@(cd),@"modified":@(cm),@"moved":@(cv),@"technical":@(ct) },@"groups":groups };
}
