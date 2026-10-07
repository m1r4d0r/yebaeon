#import "YB2Receipt.h"
#import "YBCore.h"
#import <sqlite3.h>

@interface YB2Receipt ()
@property(nonatomic) sqlite3 *db;
@end

@implementation YB2Receipt
static void Exec(sqlite3 *db, const char *sql) {
    char *error = NULL;
    if (sqlite3_exec(db, sql, NULL, NULL, &error) != SQLITE_OK) {
        NSString *message = [NSString stringWithFormat:@"영수증 기록 오류: %s", error ?: "unknown"];
        sqlite3_free(error);
        YBRequire(NO, message);
    }
}
static sqlite3_stmt *Prepare(sqlite3 *db, const char *sql) {
    sqlite3_stmt *stmt = NULL;
    YBRequire(sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK, [NSString stringWithFormat:@"영수증 조회 오류: %s", sqlite3_errmsg(db)]);
    return stmt;
}
static void BindText(sqlite3_stmt *stmt, int index, NSString *value) {
    if (value) sqlite3_bind_text(stmt, index, value.UTF8String, -1, SQLITE_TRANSIENT); else sqlite3_bind_null(stmt, index);
}
static NSString *Column(sqlite3_stmt *stmt, int index) {
    const unsigned char *text = sqlite3_column_text(stmt, index);
    return text ? [NSString stringWithUTF8String:(const char *)text] : nil;
}

- (instancetype)initWithPath:(NSString *)path {
    if (!(self = [super init])) return nil;
    [NSFileManager.defaultManager createDirectoryAtPath:path.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:NULL];
    sqlite3 *db = NULL;
    YBRequire(sqlite3_open_v2(path.fileSystemRepresentation, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, NULL) == SQLITE_OK, @"영수증 파일을 열지 못했습니다.");
    _db = db;
    Exec(db, "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;"
             "CREATE TABLE IF NOT EXISTS docs(path TEXT PRIMARY KEY, version INTEGER NOT NULL, sha TEXT NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL);"
             "CREATE TABLE IF NOT EXISTS nodes(key TEXT PRIMARY KEY, server_sha TEXT NOT NULL, fingerprint TEXT NOT NULL, name TEXT NOT NULL);"
             "CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);");
    // 2차 열. 1차 영수증이 이미 있는 Mac에서는 열만 더한다(기존 줄은 그대로).
    //   docs.neutral  — 쓴 바이트에서 사용일·사용 횟수를 뺀 sha. "사용 기록만 바뀜" 판정용
    //   docs.replaced — 마지막 적용 때 덮여 백업으로 간 Mac 바이트의 sha. PP6가 옛 내용을 다시 썼는지 판정용
    //   nodes.replaced — 같은 뜻의 노드 순서 지문
    if (![self table:@"docs" has:@"neutral"]) Exec(db, "ALTER TABLE docs ADD COLUMN neutral TEXT");
    if (![self table:@"docs" has:@"replaced"]) Exec(db, "ALTER TABLE docs ADD COLUMN replaced TEXT");
    if (![self table:@"nodes" has:@"replaced"]) Exec(db, "ALTER TABLE nodes ADD COLUMN replaced TEXT");
    // 3차 표. ledger — 서버 문서 장부 사본, media — 서버 이미지 경로표 사본, pending — [적용]을 기다리는 서버 동작
    Exec(db, "CREATE TABLE IF NOT EXISTS ledger(path TEXT PRIMARY KEY, id TEXT NOT NULL, version INTEGER NOT NULL, sha TEXT NOT NULL, state TEXT NOT NULL);"
             "CREATE TABLE IF NOT EXISTS media(path TEXT PRIMARY KEY, sha TEXT NOT NULL);"
             "CREATE TABLE IF NOT EXISTS pending(kind TEXT NOT NULL, entity TEXT NOT NULL, action TEXT NOT NULL, path TEXT NOT NULL, previous TEXT, sha TEXT, version INTEGER, PRIMARY KEY(kind, entity, action));");
    return self;
}
- (BOOL)table:(NSString *)table has:(NSString *)column {
    sqlite3_stmt *stmt = Prepare(_db, [NSString stringWithFormat:@"PRAGMA table_info(%@)", table].UTF8String);
    BOOL found = NO;
    while (sqlite3_step(stmt) == SQLITE_ROW) if ([Column(stmt, 1) isEqual:column]) found = YES;
    sqlite3_finalize(stmt);
    return found;
}
- (void)close { if (_db) { sqlite3_close(_db); _db = NULL; } }
- (void)dealloc { [self close]; }

- (NSDictionary *)document:(NSString *)path {
    sqlite3_stmt *stmt = Prepare(_db, "SELECT version, sha, size, mtime, neutral, replaced FROM docs WHERE path = ?");
    BindText(stmt, 1, path);
    NSDictionary *result = nil;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        NSMutableDictionary *row = [@{@"version": @(sqlite3_column_int64(stmt, 0)), @"sha": Column(stmt, 1) ?: @"", @"size": @(sqlite3_column_int64(stmt, 2)), @"mtime": @(sqlite3_column_int64(stmt, 3))} mutableCopy];
        if (Column(stmt, 4)) row[@"neutral"] = Column(stmt, 4);
        if (Column(stmt, 5)) row[@"replaced"] = Column(stmt, 5);
        result = row;
    }
    sqlite3_finalize(stmt);
    return result;
}
- (void)rememberDocument:(NSString *)path version:(NSNumber *)version sha:(NSString *)sha size:(long long)size mtime:(long long)mtime {
    [self rememberDocument:path version:version sha:sha size:size mtime:mtime neutral:nil replaced:nil];
}
// neutral이 nil이면: 같은 sha면 기존 값을 두고, sha가 바뀌면 비운다(옛 바이트의 값을 남기지 않는다).
// replaced가 nil이면 기존 값을 그대로 둔다.
- (void)rememberDocument:(NSString *)path version:(NSNumber *)version sha:(NSString *)sha size:(long long)size mtime:(long long)mtime neutral:(NSString *)neutral replaced:(NSString *)replaced {
    sqlite3_stmt *stmt = Prepare(_db, "INSERT OR REPLACE INTO docs(path, version, sha, size, mtime, neutral, replaced) VALUES(?1,?2,?3,?4,?5,"
                                      "COALESCE(?6, (SELECT neutral FROM docs WHERE path = ?1 AND sha = ?3)), COALESCE(?7, (SELECT replaced FROM docs WHERE path = ?1)))");
    BindText(stmt, 1, path); sqlite3_bind_int64(stmt, 2, version.longLongValue); BindText(stmt, 3, sha); sqlite3_bind_int64(stmt, 4, size); sqlite3_bind_int64(stmt, 5, mtime);
    BindText(stmt, 6, neutral); BindText(stmt, 7, replaced);
    int rc = sqlite3_step(stmt); sqlite3_finalize(stmt);
    YBRequire(rc == SQLITE_DONE, @"문서 영수증을 기록하지 못했습니다.");
}
- (void)forgetDocument:(NSString *)path {
    sqlite3_stmt *stmt = Prepare(_db, "DELETE FROM docs WHERE path = ?"); BindText(stmt, 1, path);
    int rc = sqlite3_step(stmt); sqlite3_finalize(stmt); YBRequire(rc == SQLITE_DONE, @"문서 영수증을 지우지 못했습니다.");
}
- (void)moveDocument:(NSString *)path to:(NSString *)target {
    sqlite3_stmt *stmt = Prepare(_db, "UPDATE OR REPLACE docs SET path = ?2 WHERE path = ?1"); BindText(stmt, 1, path); BindText(stmt, 2, target);
    int rc = sqlite3_step(stmt); sqlite3_finalize(stmt); YBRequire(rc == SQLITE_DONE, @"문서 영수증을 옮기지 못했습니다.");
}
- (void)forgetNode:(NSString *)key {
    sqlite3_stmt *stmt = Prepare(_db, "DELETE FROM nodes WHERE key = ?"); BindText(stmt, 1, key);
    int rc = sqlite3_step(stmt); sqlite3_finalize(stmt); YBRequire(rc == SQLITE_DONE, @"재생목록 영수증을 지우지 못했습니다.");
}

- (NSDictionary *)ledger:(NSString *)path {
    sqlite3_stmt *stmt = Prepare(_db, "SELECT id, version, sha, state FROM ledger WHERE path = ?"); BindText(stmt, 1, path);
    NSDictionary *result = nil;
    if (sqlite3_step(stmt) == SQLITE_ROW) result = @{@"id": Column(stmt, 0) ?: @"", @"version": @(sqlite3_column_int64(stmt, 1)), @"sha": Column(stmt, 2) ?: @"", @"state": Column(stmt, 3) ?: @""};
    sqlite3_finalize(stmt); return result;
}
- (void)setLedger:(NSString *)path id:(NSString *)identifier version:(NSNumber *)version sha:(NSString *)sha state:(NSString *)state {
    sqlite3_stmt *stmt = Prepare(_db, "INSERT OR REPLACE INTO ledger(path, id, version, sha, state) VALUES(?,?,?,?,?)");
    BindText(stmt, 1, path); BindText(stmt, 2, identifier ?: @""); sqlite3_bind_int64(stmt, 3, version.longLongValue); BindText(stmt, 4, sha ?: @""); BindText(stmt, 5, state ?: @"active");
    int rc = sqlite3_step(stmt); sqlite3_finalize(stmt); YBRequire(rc == SQLITE_DONE, @"장부 사본을 기록하지 못했습니다.");
}
- (NSUInteger)ledgerCount {
    sqlite3_stmt *stmt = Prepare(_db, "SELECT COUNT(*) FROM ledger");
    NSUInteger count = sqlite3_step(stmt) == SQLITE_ROW ? (NSUInteger)sqlite3_column_int64(stmt, 0) : 0;
    sqlite3_finalize(stmt); return count;
}
- (NSArray *)documentPaths {
    sqlite3_stmt *stmt = Prepare(_db, "SELECT path FROM docs ORDER BY path"); NSMutableArray *paths = [NSMutableArray array];
    while (sqlite3_step(stmt) == SQLITE_ROW) if (Column(stmt, 0)) [paths addObject:Column(stmt, 0)];
    sqlite3_finalize(stmt); return paths;
}
- (NSArray *)mediaPaths {
    sqlite3_stmt *stmt = Prepare(_db, "SELECT path, sha FROM media ORDER BY path"); NSMutableArray *items = [NSMutableArray array];
    while (sqlite3_step(stmt) == SQLITE_ROW) if (Column(stmt, 0) && Column(stmt, 1)) [items addObject:@{@"path": Column(stmt, 0), @"sha": Column(stmt, 1)}];
    sqlite3_finalize(stmt); return items;
}
- (NSString *)mediaSha:(NSString *)path {
    sqlite3_stmt *stmt = Prepare(_db, "SELECT sha FROM media WHERE path = ?"); BindText(stmt, 1, path);
    NSString *result = sqlite3_step(stmt) == SQLITE_ROW ? Column(stmt, 0) : nil;
    sqlite3_finalize(stmt); return result;
}
- (void)setMedia:(NSString *)path sha:(NSString *)sha {
    sqlite3_stmt *stmt = Prepare(_db, "INSERT OR REPLACE INTO media(path, sha) VALUES(?,?)"); BindText(stmt, 1, path); BindText(stmt, 2, sha);
    int rc = sqlite3_step(stmt); sqlite3_finalize(stmt); YBRequire(rc == SQLITE_DONE, @"이미지 경로 사본을 기록하지 못했습니다.");
}
- (void)forgetMedia:(NSString *)path {
    sqlite3_stmt *stmt = Prepare(_db, "DELETE FROM media WHERE path = ?"); BindText(stmt, 1, path);
    int rc = sqlite3_step(stmt); sqlite3_finalize(stmt); YBRequire(rc == SQLITE_DONE, @"이미지 경로 사본을 고치지 못했습니다.");
}
- (NSArray *)pending {
    sqlite3_stmt *stmt = Prepare(_db, "SELECT kind, entity, action, path, previous, sha, version FROM pending ORDER BY rowid");
    NSMutableArray *items = [NSMutableArray array];
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        NSMutableDictionary *item = [@{@"kind": Column(stmt, 0) ?: @"", @"entity": Column(stmt, 1) ?: @"", @"action": Column(stmt, 2) ?: @"", @"path": Column(stmt, 3) ?: @""} mutableCopy];
        if (Column(stmt, 4)) item[@"previous"] = Column(stmt, 4);
        if (Column(stmt, 5)) item[@"sha"] = Column(stmt, 5);
        if (sqlite3_column_type(stmt, 6) != SQLITE_NULL) item[@"version"] = @(sqlite3_column_int64(stmt, 6));
        [items addObject:item];
    }
    sqlite3_finalize(stmt); return items;
}
- (void)addPending:(NSDictionary *)item {
    sqlite3_stmt *stmt = Prepare(_db, "INSERT OR REPLACE INTO pending(kind, entity, action, path, previous, sha, version) VALUES(?,?,?,?,?,?,?)");
    BindText(stmt, 1, item[@"kind"]); BindText(stmt, 2, item[@"entity"]); BindText(stmt, 3, item[@"action"]); BindText(stmt, 4, item[@"path"] ?: @""); BindText(stmt, 5, item[@"previous"]); BindText(stmt, 6, item[@"sha"]);
    if ([item[@"version"] isKindOfClass:NSNumber.class]) sqlite3_bind_int64(stmt, 7, [item[@"version"] longLongValue]); else sqlite3_bind_null(stmt, 7);
    int rc = sqlite3_step(stmt); sqlite3_finalize(stmt); YBRequire(rc == SQLITE_DONE, @"대기 동작을 기록하지 못했습니다.");
}
- (void)removePending:(NSString *)kind entity:(NSString *)entity action:(NSString *)action {
    sqlite3_stmt *stmt = Prepare(_db, "DELETE FROM pending WHERE kind = ? AND entity = ? AND action = ?"); BindText(stmt, 1, kind); BindText(stmt, 2, entity); BindText(stmt, 3, action);
    int rc = sqlite3_step(stmt); sqlite3_finalize(stmt); YBRequire(rc == SQLITE_DONE, @"대기 동작을 지우지 못했습니다.");
}

- (NSDictionary *)node:(NSString *)key {
    sqlite3_stmt *stmt = Prepare(_db, "SELECT server_sha, fingerprint, name, replaced FROM nodes WHERE key = ?");
    BindText(stmt, 1, key);
    NSDictionary *result = nil;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        NSMutableDictionary *row = [@{@"serverSha": Column(stmt, 0) ?: @"", @"localFingerprint": Column(stmt, 1) ?: @"", @"name": Column(stmt, 2) ?: @""} mutableCopy];
        if (Column(stmt, 3)) row[@"replaced"] = Column(stmt, 3);
        result = row;
    }
    sqlite3_finalize(stmt);
    return result;
}
- (void)rememberNode:(NSString *)key serverSha:(NSString *)sha fingerprint:(NSString *)fingerprint name:(NSString *)name {
    [self rememberNode:key serverSha:sha fingerprint:fingerprint name:name replaced:nil];
}
- (void)rememberNode:(NSString *)key serverSha:(NSString *)sha fingerprint:(NSString *)fingerprint name:(NSString *)name replaced:(NSString *)replaced {
    sqlite3_stmt *stmt = Prepare(_db, "INSERT OR REPLACE INTO nodes(key, server_sha, fingerprint, name, replaced) VALUES(?1,?2,?3,?4,COALESCE(?5, (SELECT replaced FROM nodes WHERE key = ?1)))");
    BindText(stmt, 1, key); BindText(stmt, 2, sha); BindText(stmt, 3, fingerprint); BindText(stmt, 4, name); BindText(stmt, 5, replaced);
    int rc = sqlite3_step(stmt); sqlite3_finalize(stmt);
    YBRequire(rc == SQLITE_DONE, @"재생목록 영수증을 기록하지 못했습니다.");
}
- (NSString *)value:(NSString *)key {
    sqlite3_stmt *stmt = Prepare(_db, "SELECT value FROM meta WHERE key = ?"); BindText(stmt, 1, key);
    NSString *result = sqlite3_step(stmt) == SQLITE_ROW ? Column(stmt, 0) : nil;
    sqlite3_finalize(stmt); return result;
}
- (void)setValue:(NSString *)value forKey:(NSString *)key {
    sqlite3_stmt *stmt = Prepare(_db, "INSERT OR REPLACE INTO meta(key, value) VALUES(?,?)");
    BindText(stmt, 1, key); BindText(stmt, 2, value);
    int rc = sqlite3_step(stmt); sqlite3_finalize(stmt); YBRequire(rc == SQLITE_DONE, @"영수증 값을 기록하지 못했습니다.");
}
- (void)transaction:(void (^)(void))block {
    Exec(_db, "BEGIN IMMEDIATE");
    @try { block(); Exec(_db, "COMMIT"); }
    @catch (NSException *e) { sqlite3_exec(_db, "ROLLBACK", NULL, NULL, NULL); @throw; }
}
@end
