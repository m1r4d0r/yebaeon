#import "YBPlaylistFormat.h"
#import "YBPlaylistIO.h"
#import "YBCore.h"
static NSData *UTF8(NSString *s){return [s dataUsingEncoding:NSUTF8StringEncoding];}
static NSArray *Children(NSDictionary *node) {
    for(NSDictionary *child in node[@"children"])if([child[@"tag"] isEqual:@"array"] && [@[@"children",@"items"] containsObject:child[@"attrs"][@"rvXMLIvarName"]])return child[@"children"];
    return node[@"children"];
}
NSDictionary *YBPlaylistTree(NSData *data) {
    YBValidatePlaylist(data);NSString *xml=[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    NSRegularExpression *tokens=[NSRegularExpression regularExpressionWithPattern:@"<!--[\\s\\S]*?-->|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|<\\?[\\s\\S]*?\\?>|</?[A-Za-z_][\\w:.-]*(?:[^<>\"']|\"[^\"]*\"|'[^']*')*>" options:0 error:NULL];
    NSMutableArray *stack=[NSMutableArray array];NSMutableDictionary *root=nil;NSUInteger count=0;
    for(NSTextCheckingResult *match in [tokens matchesInString:xml options:0 range:NSMakeRange(0,xml.length)]) {
        YBRequire(++count<=100000 && stack.count<=64,@"재생목록 구조가 너무 복잡합니다.");NSString *tag=[xml substringWithRange:match.range];
        if([tag hasPrefix:@"<!"] || [tag hasPrefix:@"<?"])continue;
        if([tag hasPrefix:@"</"]) {NSMutableDictionary *node=stack.lastObject;YBRequire(node!=nil,@"재생목록 구조 오류");node[@"end"]=@(NSMaxRange(match.range));node[@"close"]=@(match.range.location);[stack removeLastObject];continue;}
        NSRange space=[tag rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_:.-"] invertedSet] options:0 range:NSMakeRange(1,tag.length-1)];
        NSString *name=[tag substringWithRange:NSMakeRange(1,space.location-1)];BOOL single=[tag hasSuffix:@"/>"];
        NSString *standalone=single ? tag : [tag stringByAppendingFormat:@"</%@>",name];NSXMLElement *element=[[NSXMLDocument alloc] initWithXMLString:standalone options:NSXMLNodeLoadExternalEntitiesNever error:NULL].rootElement;
        YBRequire(element!=nil,@"재생목록 태그를 읽지 못했습니다.");NSMutableDictionary *attrs=[NSMutableDictionary dictionary];for(NSXMLNode *attr in element.attributes)attrs[attr.name]=attr.stringValue;
        NSMutableDictionary *node=[@{@"tag":name,@"attrs":attrs,@"start":@(match.range.location),@"open":@(NSMaxRange(match.range)),@"end":@(NSMaxRange(match.range)),@"close":@(match.range.location),@"single":@(single),@"children":[NSMutableArray array]} mutableCopy];
        if(stack.count)[stack.lastObject[@"children"] addObject:node];else root=node;
        if(!single)[stack addObject:node];
    }
    YBRequire(root && stack.count==0,@"재생목록 구조 오류");root[@"xml"]=xml;return root;
}
static NSDictionary *Container(NSDictionary *tree) {for(NSDictionary *child in tree[@"children"])if([child[@"tag"] isEqual:@"RVPlaylistNode"])return child;YBRequire(NO,@"재생목록 루트가 없습니다.");return nil;}
static NSDictionary *Body(NSDictionary *node) {for(NSDictionary *child in node[@"children"])if([child[@"tag"] isEqual:@"array"] && [@[@"children",@"items"] containsObject:child[@"attrs"][@"rvXMLIvarName"]])return child;return node;}
NSArray *YBPlaylistNodes(NSData *data) {
    NSDictionary *tree=YBPlaylistTree(data);NSString *xml=tree[@"xml"];NSMutableArray *result=[NSMutableArray array];NSMutableSet *seen=[NSMutableSet set];
    for(NSDictionary *node in Children(Container(tree))) {
        if(![node[@"tag"] isEqual:@"RVPlaylistNode"])continue;
        NSString *identifier=[node[@"attrs"][@"UUID"] length] ? node[@"attrs"][@"UUID"] : node[@"attrs"][@"displayName"];
        YBRequire(identifier.length && ![seen containsObject:identifier],@"중복 재생목록을 구분할 수 없습니다.");[seen addObject:identifier];
        NSRange range=NSMakeRange([node[@"start"] unsignedIntegerValue],[node[@"end"] unsignedIntegerValue]-[node[@"start"] unsignedIntegerValue]);
        [result addObject:@{@"id":identifier,@"name":node[@"attrs"][@"displayName"] ?: identifier,@"raw":[xml substringWithRange:range],@"range":[NSValue valueWithRange:range],@"node":node,@"items":Children(node)}];
    }return result;
}
NSDictionary *YBPlaylistNode(NSData *data,NSString *identifier){for(NSDictionary *node in YBPlaylistNodes(data))if([node[@"id"] isEqual:identifier])return node;return nil;}
NSString *YBPlaylistReference(NSString *source,NSString *root) {
    if(![source isKindOfClass:NSString.class] || ![root isKindOfClass:NSString.class])return nil;
    if([source hasPrefix:@"file:"]) {NSURLComponents *url=[NSURLComponents componentsWithString:source];if(url.host.length || url.query.length || url.fragment.length)return nil;source=url.path;}
    source=source.precomposedStringWithCanonicalMapping;root=root.precomposedStringWithCanonicalMapping;
    if([root hasPrefix:@"~/"] && [source hasPrefix:@"/Users/"]) {NSArray *parts=[source componentsSeparatedByString:@"/"];if(parts.count>3)source=[@"~/" stringByAppendingString:[[parts subarrayWithRange:NSMakeRange(3,parts.count-3)] componentsJoinedByString:@"/"]];}
    NSString *prefix=[root hasSuffix:@"/"] ? root : [root stringByAppendingString:@"/"];if(![source hasPrefix:prefix])return nil;
    @try{return YBPath([source substringFromIndex:prefix.length]);}@catch(NSException *e){return nil;}
}
static NSString *Escaped(NSString *value) {return [[[[[value stringByReplacingOccurrencesOfString:@"&" withString:@"&amp;"] stringByReplacingOccurrencesOfString:@"\"" withString:@"&quot;"] stringByReplacingOccurrencesOfString:@"'" withString:@"&apos;"] stringByReplacingOccurrencesOfString:@"<" withString:@"&lt;"] stringByReplacingOccurrencesOfString:@">" withString:@"&gt;"];}
NSString *YBPlaylistLocalXML(NSDictionary *plan,NSString *root) {
    NSString *raw=plan[@"playlist"][@"xml"];YBRequire([raw isKindOfClass:NSString.class] && [YBHash(UTF8(raw)) isEqual:plan[@"playlist"][@"sha256"]],@"재생목록 원본 해시가 다릅니다.");
    NSString *prefix=@"<RVPlaylistDocument><RVPlaylistNode>";NSData *wrapped=UTF8([NSString stringWithFormat:@"%@%@</RVPlaylistNode></RVPlaylistDocument>",prefix,raw]);NSArray *nodes=YBPlaylistNodes(wrapped);
    YBRequire(nodes.count==1 && [nodes[0][@"id"] isEqual:plan[@"playlist"][@"id"]],@"서버 재생목록 식별자가 다릅니다.");NSArray *cues=nodes[0][@"items"],*items=plan[@"items"];YBRequire(cues.count==items.count,@"재생목록 항목 수가 다릅니다.");NSMutableString *out=[raw mutableCopy];
    NSRegularExpression *attr=[NSRegularExpression regularExpressionWithPattern:@"\\bfilePath\\s*=\\s*(\"[^\"]*\"|'[^']*')" options:0 error:NULL];
    for(NSInteger i=(NSInteger)cues.count-1;i>=0;i--) {
        NSDictionary *cue=cues[i],*item=items[i];NSString *identifier=[cue[@"attrs"][@"UUID"] length] ? cue[@"attrs"][@"UUID"] : [NSString stringWithFormat:@"item-%ld",(long)i];
        YBRequire([identifier isEqual:item[@"id"]],@"재생목록 항목 식별자가 다릅니다.");
        if([item[@"kind"] isEqual:@"header"])continue;
        YBRequire([item[@"kind"] isEqual:@"document"] && [cue[@"tag"] isEqual:@"RVDocumentCue"],@"지원하지 않는 재생목록 항목입니다.");NSString *path=YBPath(item[@"path"]);
        NSUInteger start=[cue[@"start"] unsignedIntegerValue]-prefix.length;NSRange opening=NSMakeRange(start,[cue[@"open"] unsignedIntegerValue]-[cue[@"start"] unsignedIntegerValue]);NSString *tag=[raw substringWithRange:opening];NSTextCheckingResult *match=[attr firstMatchInString:tag options:0 range:NSMakeRange(0,tag.length)];YBRequire(match!=nil,@"문서 경로 속성이 없습니다.");
        // PP6 must open the files in the chosen test/operating document folder on this Mac.
        NSString *absolute=[root stringByAppendingPathComponent:path];NSRange value=[match rangeAtIndex:1];[out replaceCharactersInRange:NSMakeRange(start+value.location,value.length) withString:[NSString stringWithFormat:@"\"%@\"",Escaped(absolute)]];
    }return out;
}
NSData *YBPlaylistReplacing(NSData *data,NSString *identifier,NSString *xml) {
    NSString *text=[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];NSDictionary *node=YBPlaylistNode(data,identifier);NSMutableString *out=[text mutableCopy];
    if(node)[out replaceCharactersInRange:[node[@"range"] rangeValue] withString:xml];
    else {NSDictionary *tree=YBPlaylistTree(data),*body=Body(Container(tree));NSUInteger close=[body[@"close"] unsignedIntegerValue];
        if([body[@"single"] boolValue]) {NSUInteger start=[body[@"start"] unsignedIntegerValue],end=[body[@"end"] unsignedIntegerValue];NSString *open=[text substringWithRange:NSMakeRange(start,end-start-2)];[out replaceCharactersInRange:NSMakeRange(start,end-start) withString:[NSString stringWithFormat:@"%@>%@</%@>",open,xml,body[@"tag"]]];}
        else [out insertString:xml atIndex:close];
    }
    NSData *result=UTF8(out);YBRequire([[YBPlaylistNode(result,identifier) objectForKey:@"raw"] isEqual:xml],@"재생목록 적용 내용이 다릅니다.");
    for(NSDictionary *previous in YBPlaylistNodes(data))if(![previous[@"id"] isEqual:identifier])YBRequire([YBPlaylistNode(result,previous[@"id"])[@"raw"] isEqual:previous[@"raw"]],@"선택하지 않은 재생목록이 달라졌습니다.");return result;
}
NSData *YBPlaylistRemoving(NSData *data,NSString *identifier) {
    NSDictionary *node=YBPlaylistNode(data,identifier);YBRequire(node!=nil,@"정리할 목록이 없습니다.");
    NSMutableString *text=[[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] mutableCopy];
    [text deleteCharactersInRange:[node[@"range"] rangeValue]];NSData *result=UTF8(text);
    YBRequire(YBPlaylistNode(result,identifier)==nil,@"재생목록 정리를 확인하지 못했습니다.");
    for(NSDictionary *previous in YBPlaylistNodes(data))if(![previous[@"id"] isEqual:identifier])YBRequire([YBPlaylistNode(result,previous[@"id"])[@"raw"] isEqual:previous[@"raw"]],@"선택하지 않은 목록이 바뀌었습니다.");
    return result;
}
