#import "YB2Receipt.h"
#import "../mac-sync/YBSync.h"
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
    return self;
}
- (void)close { if (_db) { sqlite3_close(_db); _db = NULL; } }
- (void)dealloc { [self close]; }

- (NSDictionary *)document:(NSString *)path {
    sqlite3_stmt *stmt = Prepare(_db, "SELECT version, sha, size, mtime FROM docs WHERE path = ?");
    BindText(stmt, 1, path);
    NSDictionary *result = nil;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        result = @{@"version": @(sqlite3_column_int64(stmt, 0)), @"sha": Column(stmt, 1) ?: @"", @"size": @(sqlite3_column_int64(stmt, 2)), @"mtime": @(sqlite3_column_int64(stmt, 3))};
    }
    sqlite3_finalize(stmt);
    return result;
}
- (void)rememberDocument:(NSString *)path version:(NSNumber *)version sha:(NSString *)sha size:(long long)size mtime:(long long)mtime {
    sqlite3_stmt *stmt = Prepare(_db, "INSERT OR REPLACE INTO docs(path, version, sha, size, mtime) VALUES(?,?,?,?,?)");
    BindText(stmt, 1, path); sqlite3_bind_int64(stmt, 2, version.longLongValue); BindText(stmt, 3, sha); sqlite3_bind_int64(stmt, 4, size); sqlite3_bind_int64(stmt, 5, mtime);
    int rc = sqlite3_step(stmt); sqlite3_finalize(stmt);
    YBRequire(rc == SQLITE_DONE, @"문서 영수증을 기록하지 못했습니다.");
}
- (void)forgetDocument:(NSString *)path {
    sqlite3_stmt *stmt = Prepare(_db, "DELETE FROM docs WHERE path = ?"); BindText(stmt, 1, path);
    int rc = sqlite3_step(stmt); sqlite3_finalize(stmt); YBRequire(rc == SQLITE_DONE, @"문서 영수증을 지우지 못했습니다.");
}
- (NSDictionary *)node:(NSString *)key {
    sqlite3_stmt *stmt = Prepare(_db, "SELECT server_sha, fingerprint, name FROM nodes WHERE key = ?");
    BindText(stmt, 1, key);
    NSDictionary *result = nil;
    if (sqlite3_step(stmt) == SQLITE_ROW) result = @{@"serverSha": Column(stmt, 0) ?: @"", @"localFingerprint": Column(stmt, 1) ?: @"", @"name": Column(stmt, 2) ?: @""};
    sqlite3_finalize(stmt);
    return result;
}
- (void)rememberNode:(NSString *)key serverSha:(NSString *)sha fingerprint:(NSString *)fingerprint name:(NSString *)name {
    sqlite3_stmt *stmt = Prepare(_db, "INSERT OR REPLACE INTO nodes(key, server_sha, fingerprint, name) VALUES(?,?,?,?)");
    BindText(stmt, 1, key); BindText(stmt, 2, sha); BindText(stmt, 3, fingerprint); BindText(stmt, 4, name);
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
