# 예배온 통합 개발 인수인계 · 2026-10-01

## 패키지를 구분하는 기준

- `PP6-Playlist-Sync-Native-v0.2.zip`: 사용자가 교회에서 빌드한 네이티브 앱 원형. main.m, Info.plist, 빌드 스크립트와 더미 재생목록이 포함된다.
- `PP6-Local-Sync-Core-v0.2.zip`: 문서 인덱서·슬라이드 비교·썸네일 실험을 분리한 개발 패키지. 기존 앱 화면은 이 패키지에 없었다.
- `PP6-Original-Source-Assets.zip`: 사용자가 제공한 PP6/재생목록/미디어 원본과 진단 자료. 프로그램 소스 묶음이 아니다.
- `PP6-Playlist-Sync-Full-Dev-Bundle`: 위 원형들과 현재 예배온 소스·통합 앱·이 문서를 함께 전달하는 로컬 개발 묶음. 실제 원본 자료를 포함하므로 GitHub 소스에는 넣지 않는다.

## 현재 코드의 위치

| 위치 | 역할 |
|---|---|
| mac-app/PPSPlaylistController.m | Native v0.2 main.m에서 이어받은 재생목록 화면·비교·선택 적용 |
| mac-app/YBPlaylistIO.m | 원본 백업, 후속 수정·실행 중 PP6 차단, 재생목록 파일 교체 |
| mac-app/YBDocumentsController.m / YBLibrary.m | 앱의 문서 화면과 서버 송수신 연결 |
| mac-app/YBMediaController.m | Core 미디어 색인·누락 파일 점검 화면 |
| mac-app/main.m | 서버 재생목록·문서·미디어·로컬 비교의 네 탭 앱 |
| mac-app/YBPlaylistFormat.m / YBPlaylistSync.m / YBServerPlaylistsController.m | 서버 재생목록 연결, 선택 노드 편집, 문서 일괄 수신/복구와 화면 |
| mac-sync/PP6Core.m | 문서 분석·슬라이드 비교·미디어 위치 판정 |
| mac-sync/YBSync.m / YBServer.m | 문서 기준 버전, HTTPS 세션, 선택 송수신, 백업·복원·중단 복구 |
| web-editor/ / cloudflare/ | 배포된 예배온 Studio와 공유 자료 서버 |

## 현재 지원과 검증

현재 상태의 기준은 [SESSION-HANDOFF.md](SESSION-HANDOFF.md)이며 교회 실행 순서는 [CHURCH-TEST.md](CHURCH-TEST.md)다.

0.4.0은 **원본 재생목록/연결 문서 등록 → 웹에서 플레이리스트 선택·곡 수정·저장 → Mac에서 같은 플레이리스트 비교·수신 → PP6 확인** 흐름을 연결한다. 문서만 바뀌어도 감지하고, 선택한 노드만 적용한다. 작업 중단 후 문서와 순서를 묶어 복구한 뒤 재시도할 수 있다. 기존 문서 송수신·로컬 재생목록 비교·Core 미디어 점검은 유지한다.

Intel Mac 빌드 `8faa176`의 [검사](https://github.com/m1r4d0r/yebaeon/actions/runs/36847704652)에서 256개가 통과했다. High Sierra 10.13.6의 실행·HTTPS·키체인 및 PP6 열기/화면 확인은 남았다. 미디어 서버 전송·설치·경로 변환과 성경 원본 처리도 후속이다. 0.3.0은 서버 재생목록이 없던 이전 보존본이다.

기존 앱·설정·백업은 삭제하지 않는다. 폰트는 이미 사용자가 복사해 두었으므로 다시 수집하라고 요구하지 않는다.

## 개발과 자료 보관

소스 수정·커밋·푸시는 로컬 GitHub 예배온 저장소에서 한다. 다운로드의 Core 폴더는 이전 소스/원본 자료로 보관한다. GitHub 웹 로그인은 필요 없다. 비밀번호·브라우저 쿠키·Mac 키체인 세션은 개발 묶음이나 저장소에 넣지 않는다.

`mac-app/build-dev-bundle.py`가 Git에 커밋된 현재 소스와 명시한 원본 ZIP·검증 앱 ZIP을 모은다. 파일별 SHA-256과 소스/앱 빌드 커밋을 MANIFEST.json에 기록한다. 각 원본 ZIP은 변경하지 않고 그대로 포함한다.
