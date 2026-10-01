#import "YBSync.h"
#import <sys/stat.h>
#import <unistd.h>
static int checks=0;
static void Check(BOOL condition,NSString *name) { checks++; if(!condition)@throw [NSException exceptionWithName:@"TestFailure" reason:name userInfo:nil]; }
static void Reject(void (^action)(void),NSString *name) { BOOL rejected=NO; @try { action(); } @catch(NSException *e) { if([e.name isEqual:@"YebaeOn"])rejected=YES; else @throw; } Check(rejected,name); }
static NSData *XML(NSString *text) { return [[NSString stringWithFormat:@"<?xml version=\"1.0\" encoding=\"UTF-8\"?><RVPresentationDocument versionNumber=\"600\"><text>%@</text></RVPresentationDocument>",text] dataUsingEncoding:NSUTF8StringEncoding]; }
static NSDictionary *Doc(NSData *data,int version,NSString *path) { return @{@"id":@"11111111-1111-4111-a111-111111111111",@"path":path,@"version":@(version),@"sha256":YBHash(data),@"size":@(data.length),@"updatedBy":@"test",@"updatedAt":@"2026-09-30"}; }
static void Put(NSString *root,NSString *path,NSData *data) { NSString *full=[root stringByAppendingPathComponent:path]; Check([NSFileManager.defaultManager createDirectoryAtPath:full.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:NULL],@"fixture directory"); Check([data writeToFile:full atomically:YES],@"fixture write"); }
static NSString *NewArea(NSString *base) { NSString *area=[base stringByAppendingPathComponent:NSUUID.UUID.UUIDString]; Check([NSFileManager.defaultManager createDirectoryAtPath:area withIntermediateDirectories:YES attributes:nil error:NULL],@"test area"); return area; }
static YBSync *Engine(NSString *area) { YBSync *sync=[[YBSync alloc] initWithRoot:[area stringByAppendingPathComponent:@"documents"] profile:[area stringByAppendingPathComponent:@"profile"] origin:@"https://example.test"]; sync.presenterRunning=^BOOL{return NO;}; return sync; }
int main(void) { @autoreleasepool {
    NSString *base=[NSTemporaryDirectory() stringByAppendingPathComponent:[@"yebaeon-tests-" stringByAppendingString:NSUUID.UUID.UUIDString]];
    @try {
        NSData *a=XML(@"original\r\n한글"), *b=XML(@"server change"), *c=XML(@"local change"); NSString *path=@"예배/말씀.pro6";
        NSDictionary *v1=Doc(a,1,path), *v2=Doc(b,2,path), *v3=Doc(c,3,path);
        Check([YBHash([@"abc" dataUsingEncoding:NSUTF8StringEncoding]) isEqual:@"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],@"SHA256 known vector");
        for(NSString *p in @[@"../bad.pro6",@"/bad.pro6",@"a//b.pro6",@"a./b.pro6",@"a\\b.pro6",@"file.txt"])Reject(^{YBPath(p);},@"unsafe path");
        Reject(^{YBValidateDocument([@"<!DOCTYPE RVPresentationDocument><RVPresentationDocument/>" dataUsingEncoding:NSUTF8StringEncoding]);},@"DOCTYPE blocked");
        Reject(^{YBValidateDocument(XML(@"file:///PP6-Package/media/a.jpg"));},@"package media blocked");
        Reject(^{YBValidateDocument([@"<RVPresentationDocument><x></RVPresentationDocument>" dataUsingEncoding:NSUTF8StringEncoding]);},@"malformed XML blocked");
        Check([YBDisposition(nil,v1,nil) isEqual:@"download"],@"new server");
        Check([YBDisposition(YBHash(a),nil,nil) isEqual:@"upload"],@"new local");
        Check([YBDisposition(YBHash(a),v1,nil) isEqual:@"same"],@"adopt equal");
        Check([YBDisposition(YBHash(a),v2,nil) isEqual:@"conflict"],@"no baseline conflict");
        Check([YBDisposition(YBHash(a),v2,v1) isEqual:@"download"],@"remote changed");
        Check([YBDisposition(YBHash(b),v1,v1) isEqual:@"upload"],@"local changed");
        Check([YBDisposition(YBHash(c),v2,v1) isEqual:@"conflict"],@"both changed");
        Check([YBDisposition(YBHash(a),nil,v1) isEqual:@"conflict"],@"no server recreation");
        Check([YBDisposition(nil,v2,v1) isEqual:@"download"],@"local deletion does not propagate");
        Check([YBDisposition(YBHash(b),v2,v1) isEqual:@"same"],@"converged changes");
        {
            NSString *area=NewArea(base); YBSync *s=Engine(area);
            NSString *nfd=path.decomposedStringWithCanonicalMapping; Put(s.root,nfd,a);
            chmod([s.root stringByAppendingPathComponent:nfd].fileSystemRepresentation,0640);
            Check([s plan:@[v1]].count==1 && [[s plan:@[v1]][0][@"status"] isEqual:@"same"],@"NFD and NFC match with actual local bytes");
            Check([s plan:@[]].count==1 && [[s plan:@[]][0][@"status"] isEqual:@"upload"],@"scan finds unregistered local file");
            [s acknowledge:v1 expectedLocalHash:YBHash(a)];
            Check([s.entries[path][@"version"] isEqual:@1],@"baseline initial");
            NSString *transaction=[s apply:b document:v2 expectedLocalHash:YBHash(a)];
            Check([[s readDocument:path] isEqual:b],@"apply bytes preserved");
            struct stat st; stat([s.root stringByAppendingPathComponent:nfd].fileSystemRepresentation,&st); Check((st.st_mode&0777)==0640,@"mode retained");
            Check([s.entries[path][@"version"] isEqual:@2] && s.pendingTransactions.count==0,@"commit updates baseline");
            [s restore:transaction]; Check([[s readDocument:path] isEqual:a] && [s.entries[path][@"version"] isEqual:@1],@"restore original and baseline");
            Reject(^{YBSync *other=Engine(area); (void)other;},@"same root locked");
            s.presenterRunning=^BOOL{return YES;}; Reject(^{[s apply:b document:v2 expectedLocalHash:YBHash(a)];},@"PP6 running blocks apply");
            s.presenterRunning=^BOOL{return NO;}; Reject(^{[s apply:c document:v2 expectedLocalHash:YBHash(a)];},@"bad download hash");
            Put(s.root,path,c); Reject(^{[s apply:b document:v2 expectedLocalHash:YBHash(a)];},@"stale local file");
            Check([[s readDocument:path] isEqual:c],@"stale file unchanged");
            Put(s.root,path,a); NSString *second=[s apply:b document:v2 expectedLocalHash:YBHash(a)];
            Put(s.root,path,c); Reject(^{[s restore:second];},@"restore refuses later edits");
            Put(s.root,path,b);
            Put(s.profile,[NSString stringWithFormat:@"transactions/%@/before.pro6",second],c);
            Reject(^{[s restore:second];},@"corrupt backup refuses restore"); Check([[s readDocument:path] isEqual:b],@"corrupt backup no write");
        }
        {
            YBSync *s=Engine(NewArea(base)); NSString *transaction=[s apply:a document:v1 expectedLocalHash:nil];
            [s restore:transaction]; Check([s readDocument:path]==nil && s.entries.count==0,@"restore newly created file");
        }
        {
            YBSync *s=Engine(NewArea(base));
            Put(s.root,@"valid.pro6",a);Put(s.root,@"unsupported./예수.pro6",a);
            NSArray *rows=[s plan:@[]];
            Check(rows.count==2,@"unsafe filename does not abort other documents");
            NSDictionary *blocked=nil;NSUInteger uploads=0;
            for(NSDictionary *row in rows){if([row[@"error"] length])blocked=row;if([row[@"status"] isEqual:@"upload"])uploads++;}
            Check(uploads==1 && [blocked[@"status"] isEqual:@"conflict"],@"unsafe path remains visibly excluded from transfers");
            Check([[NSData dataWithContentsOfFile:[s.root stringByAppendingPathComponent:@"unsupported./예수.pro6"]] isEqual:a],@"excluded filename and bytes preserved");
            Reject(^{[s readDocument:blocked[@"path"]];},@"excluded path still cannot bypass path guard");
        }
        {
            YBSync *s=Engine(NewArea(base));NSString *special=@"찬양/원제 : 예수 & \"피\" %3A.pro6";
            Put(s.root,special,a);NSDictionary *doc=Doc(a,1,special);
            Check([YBPath(special) isEqual:special],@"special filename remains metadata, not a storage key");
            Check([[s plan:@[doc]][0][@"status"] isEqual:@"same"],@"special filename matches server without rename");
            [s acknowledge:doc expectedLocalHash:YBHash(a)];
            [s apply:b document:Doc(b,2,special) expectedLocalHash:YBHash(a)];
            Check([[s readDocument:special] isEqual:b],@"special filename receives new version at original path");
        }
        for(NSString *stage in @[@"prepared",@"replaced",@"state_saved"]) { @autoreleasepool {
            NSString *area=NewArea(base); YBSync *s=Engine(area); Put(s.root,path,a); [s acknowledge:v1 expectedLocalHash:YBHash(a)];
            s.checkpoint=^(NSString *point){if([point isEqual:stage])YBRequire(NO,@"simulated interruption");};
            Reject(^{[s apply:b document:v2 expectedLocalHash:YBHash(a)];},@"injected interruption");
            Check(s.pendingTransactions.count==1,@"durable unfinished journal");
            Reject(^{[s acknowledge:v2 expectedLocalHash:YBHash(b)];},@"pending blocks next operation");
            NSString *transaction=s.pendingTransactions[0][@"id"]; [s close]; s=nil;
            YBSync *reopened=Engine(area); [reopened recover:transaction];
            Check([[reopened readDocument:path] isEqual:a] && [reopened.entries[path][@"version"] isEqual:@1] && reopened.pendingTransactions.count==0,@"reopened recovery restores both bytes and baseline");
        } }
        {
            NSString *area=NewArea(base); YBSync *s=Engine(area); NSString *transaction=[s apply:a document:v1 expectedLocalHash:nil];
            s.checkpoint=^(NSString *point){if([point isEqual:@"restored_file"])YBRequire(NO,@"restore interrupted");};
            Reject(^{[s restore:transaction];},@"restore interruption"); [s close]; s=nil;
            YBSync *reopened=Engine(area); [reopened recover:transaction]; Check([reopened readDocument:path]==nil && reopened.entries.count==0,@"recovery of interrupted removal");
        }
        {
            YBSync *s=Engine(NewArea(base)); Put(s.root,path,a); [s acknowledge:v1 expectedLocalHash:YBHash(a)];
            s.checkpoint=^(NSString *point){if([point isEqual:@"replaced"])YBRequire(NO,@"interrupt");};
            Reject(^{[s apply:b document:v2 expectedLocalHash:YBHash(a)];},@"interrupt for concurrent edit");
            Put(s.root,path,c); Reject(^{[s recover:s.pendingTransactions[0][@"id"]];},@"recovery refuses third content"); Check([[s readDocument:path] isEqual:c],@"third content preserved");
        }
        {
            YBSync *s=Engine(NewArea(base)); NSString *outside=[s.profile stringByAppendingPathComponent:@"outside.pro6"]; Put(s.profile,@"outside.pro6",a);
            Check(symlink(outside.fileSystemRepresentation,[s.root stringByAppendingPathComponent:@"link.pro6"].fileSystemRepresentation)==0,@"symlink fixture");
            Reject(^{[s readDocument:@"link.pro6"];},@"symlink file blocked"); Reject(^{[s plan:@[]];},@"scan symlink blocked");
            Check(symlink(s.profile.fileSystemRepresentation,[s.root stringByAppendingPathComponent:@"folder"].fileSystemRepresentation)==0,@"directory symlink fixture");
            Reject(^{[s apply:a document:Doc(a,1,@"folder/outside.pro6") expectedLocalHash:nil];},@"symlink parent blocked");
            Check([[NSData dataWithContentsOfFile:outside] isEqual:a],@"outside remains unchanged");
        }
        {
            YBSync *s=Engine(NewArea(base));
            Reject(^{[s plan:@[Doc(a,1,@"Foo/a.pro6"),Doc(a,1,@"foo/b.pro6")]];},@"remote case alias directories");
            Put(s.root,@"Foo/a.pro6",a); Reject(^{[s plan:@[Doc(a,1,@"foo/b.pro6")]];},@"local remote case alias");
        }
        {
            NSString *area=NewArea(base); YBSync *s=Engine(area); Put(s.root,path,a); [s acknowledge:v1 expectedLocalHash:YBHash(a)]; NSString *root=s.root, *profile=s.profile; [s close]; s=nil;
            Reject(^{YBSync *bad=[[YBSync alloc] initWithRoot:root profile:profile origin:@"https://other.test"]; (void)bad;},@"state origin binding");
        }
        {
            YBSync *s=Engine(NewArea(base));
            NSString *legacy=[s apply:a document:Doc(a,1,@"legacy.pro6") expectedLocalHash:nil];
            [s beginBackupBatch:@"documents" playlistJob:nil];
            for(int i=0;i<12;i++)[s apply:a document:Doc(a,1,[NSString stringWithFormat:@"batch-large/%d.pro6",i]) expectedLocalHash:nil];
            Check(s.transactions.count==13,@"a multi-file operation retains every member until completed");
            [s endBackupBatch:YES];
            for(int i=0;i<10;i++) {
                [s beginBackupBatch:@"documents" playlistJob:nil];
                [s apply:a document:Doc(a,1,[NSString stringWithFormat:@"later/%d.pro6",i]) expectedLocalHash:nil];
                [s endBackupBatch:YES];Check(!s.backupWarning,@"completed batch cleanup succeeds");
            }
            Check(s.transactions.count==11,@"retain ten operations, not ten individual files; retain legacy");
            Check([s.transactions filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"id == %@",legacy]].count==1,@"legacy backup is not automatically deleted");
            Check([[s readDocument:@"batch-large/0.pro6"] isEqual:a],@"retention never deletes live documents");
            [s beginBackupBatch:@"documents" playlistJob:nil];
            [s apply:a document:Doc(a,1,@"failed.pro6") expectedLocalHash:nil];[s endBackupBatch:NO];
            for(int i=10;i<12;i++){[s beginBackupBatch:@"documents" playlistJob:nil];[s apply:a document:Doc(a,1,[NSString stringWithFormat:@"later/%d.pro6",i]) expectedLocalHash:nil];[s endBackupBatch:YES];}
            Check(s.transactions.count==12,@"failed batch is retained in addition to ten complete operations");
        }
        {
            YBSync *s=Engine(NewArea(base));[s beginBackupBatch:@"documents" playlistJob:nil];
            NSString *first=[s apply:a document:Doc(a,1,@"safe.pro6") expectedLocalHash:nil];[s endBackupBatch:YES];
            NSString *outside=[base stringByAppendingPathComponent:@"keep-outside"];Put(base,@"keep-outside",a);
            NSString *link=[s.profile stringByAppendingPathComponent:[NSString stringWithFormat:@"transactions/%@/foreign",first]];
            Check(symlink(outside.fileSystemRepresentation,link.fileSystemRepresentation)==0,@"retention symlink fixture");
            [s beginBackupBatch:@"documents" playlistJob:nil];[s apply:a document:Doc(a,1,@"safe2.pro6") expectedLocalHash:nil];[s endBackupBatch:YES];
            Reject(^{[s pruneBackupBatchesKeeping:1];},@"cleanup refuses symlink contents");
            Check([[NSData dataWithContentsOfFile:outside] isEqual:a],@"cleanup cannot follow a link outside profile");
        }
        (void)v3; printf("Native safety checks passed: %d\n",checks);
        Check([base hasPrefix:[NSTemporaryDirectory() stringByAppendingPathComponent:@"yebaeon-tests-"]],@"cleanup boundary");
        [NSFileManager.defaultManager removeItemAtPath:base error:NULL]; return 0;
    } @catch(NSException *e) { fprintf(stderr,"FAIL after %d checks: %s (%s)\n",checks,e.reason.UTF8String,base.UTF8String); return 1; }
} }
