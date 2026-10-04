# mac-sync · Sync 2가 쓰는 엔진 소스

예배온 Sync 2(`mac-sync2/`)가 빌드할 때 함께 컴파일하는 소스다. 단독으로 빌드하거나 실행하지 않는다.

| 파일 | 역할 |
|---|---|
| `YBSync.h`, `YBSync.m` | 문서 폴더 엔진. 경로 규칙(NFC, 끝 공백·대소문자), 안전한 파일 쓰기, 백업 |
| `YBServer.m` | 서버 요청(세션 쿠키, Origin, 재시도) |
| `PP6Core.h`, `PP6Core.m` | PP6 문서 해석. 지금은 0.6.6(`mac-app/`)만 링크한다 |
| `test-server.mjs` | 0.6.6 검사용 로컬 Worker. Sync 2는 `mac-sync2/test-server2.mjs`를 쓴다 |

`mac-app/`를 지울 때 `PP6Core.*`와 `test-server.mjs`도 같이 지운다. Sync 2가 `mac-app/`에서 가져다 쓰는 `YBPlaylistIO.m`·`YBPlaylistFormat.m`·`assets/SyncIcon-1024.png`는 그 전에 `mac-sync2/`로 옮긴다. 옛 Core 도구(색인·비교·썸네일 CLI) 안내는 [archive](../docs/archive/2026-10/MAC-SYNC-CORE-README.md)에 있다.
