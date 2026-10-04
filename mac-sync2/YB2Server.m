#import "YB2Server.h"
#import <Security/Security.h>

// YBServer의 전송 메서드는 .m 안에만 선언돼 있다. 같은 이름으로 덮어써 머리글만 더한다.
@interface YBServer (YB2Transfer)
- (id)transfer:(NSString *)route method:(NSString *)method body:(NSData *)body headers:(NSDictionary *)headers timeout:(NSTimeInterval)timeout;
@end

static NSString *const kService = @"org.yebaeon.sync2.device";

@implementation YB2Server

- (id)transfer:(NSString *)route method:(NSString *)method body:(NSData *)body headers:(NSDictionary *)headers timeout:(NSTimeInterval)timeout {
    if (!self.deviceToken.length) return [super transfer:route method:method body:body headers:headers timeout:timeout];
    NSMutableDictionary *merged = [headers mutableCopy] ?: [NSMutableDictionary dictionary];
    merged[@"Authorization"] = [@"Bearer " stringByAppendingString:self.deviceToken];
    return [super transfer:route method:method body:body headers:merged timeout:timeout];
}

- (NSString *)deviceID {
    NSArray *parts = [self.deviceToken componentsSeparatedByString:@"_"];
    return parts.count == 3 ? parts[1] : nil;
}

- (NSString *)registerDevice:(NSString *)name {
    NSData *body = [NSJSONSerialization dataWithJSONObject:@{@"name": name} options:0 error:NULL];
    NSString *saved = self.deviceToken; self.deviceToken = nil;   // 발급은 사람 세션(쿠키)으로만 된다.
    NSDictionary *result = nil;
    @try { result = [self request:@"/api/sync/devices" method:@"POST" body:body headers:@{@"Content-Type": @"application/json"}]; }
    @catch (NSException *e) { self.deviceToken = saved; @throw; }
    NSString *token = result[@"token"];
    YBRequire([token isKindOfClass:NSString.class] && [token rangeOfString:@"^ybd_[0-9a-f]{32}_[0-9a-f]{64}$" options:NSRegularExpressionSearch].location != NSNotFound, @"장치 열쇠를 받지 못했습니다.");
    self.deviceToken = token;
    return token;
}

- (NSDictionary *)keychainQuery {
    return @{(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword, (__bridge id)kSecAttrService: kService, (__bridge id)kSecAttrAccount: self.origin};
}
- (BOOL)loadDeviceToken {
    NSMutableDictionary *query = [[self keychainQuery] mutableCopy];
    query[(__bridge id)kSecReturnData] = @YES; query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef found = NULL;
    if (SecItemCopyMatching((__bridge CFDictionaryRef)query, &found) != errSecSuccess || !found) return NO;
    NSData *data = CFBridgingRelease(found);
    NSString *token = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (![token hasPrefix:@"ybd_"]) return NO;
    self.deviceToken = token;
    return YES;
}
- (void)saveDeviceToken {
    YBRequire(self.deviceToken.length > 0, @"저장할 장치 열쇠가 없습니다.");
    SecItemDelete((__bridge CFDictionaryRef)[self keychainQuery]);
    NSMutableDictionary *item = [[self keychainQuery] mutableCopy];
    item[(__bridge id)kSecValueData] = [self.deviceToken dataUsingEncoding:NSUTF8StringEncoding];
    item[(__bridge id)kSecAttrLabel] = @"예배온 Sync 2 장치 열쇠";
    item[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlock;   // 부팅 뒤 자동 로그인 상태에서도 읽는다.
    OSStatus status = SecItemAdd((__bridge CFDictionaryRef)item, NULL);
    YBRequire(status == errSecSuccess, [NSString stringWithFormat:@"장치 열쇠를 키체인에 저장하지 못했습니다 (%d).", (int)status]);
}
- (void)forgetDeviceToken {
    SecItemDelete((__bridge CFDictionaryRef)[self keychainQuery]);
    self.deviceToken = nil;
}
@end
