# 교회 Mac 진단·격리 검사

PR #22 후속 후보. **High Sierra/Apple LLVM 10 컴파일 및 GUI 성공은 아직 확인하지 않았다.**
GitHub Actions, Node, Python, Wrangler 없이 Mac의 Command Line Tools로 실행한다.
운영 앱을 교체하거나 새 앱으로 운영 폴더를 열기 전에 아래 진단부터 진행한다.

## 1. 소스 준비

GitHub의 `codex/sync-layout-pause` 브랜치에서 Code → Download ZIP으로 소스를 받아
기존 자료와 별도 폴더에 압축을 푼다. 터미널에서 그 저장소 폴더로 이동한다.
기존 작업 폴더에 강제 checkout/reset/pull하거나 운영 앱을 덮어쓰지 않는다.

## 2. 읽기 전용 진단

ProPresenter 6와 예배온 Sync를 모두 종료한 뒤:

```bash
bash mac-app/diagnose-local.command
```

먼저 합성 자료로 진단 도구의 자체 검사를 컴파일·실행하고, 통과하면 실제 자료를 읽는다.
기본 경로는 Sync의 선택된 문서 폴더/재생목록 설정을 사용한다.
설정이 없으면 현재 사용자의 Documents/ProPresenter6 및
RenewedVision/ProPresenter6/Playlists/기본 .pro6pl을 사용한다.
다른 경로가 선택되어 있었다면 다음처럼 원본 경로를 명시할 수 있다.
한글과 `기본 .pro6pl` 이름의 공백을 그대로 유지한다.

```bash
bash mac-app/diagnose-local.command \
  "/Users/procg/Documents/ProPresenter6" \
  "/Users/procg/Library/Application Support/RenewedVision/ProPresenter6/Playlists/기본 .pro6pl"
```

성공하면 출력된 `mac-app/diagnostic-XXXXXX/local-diagnostic.json`만 전달한다.
실패하면 JSON 대신 터미널 오류를 전달한다. 미완성 JSON은 성공 결과로 남기지 않는다.
결과에는 다음 정보가 들어간다.

- 실제 재생목록 이름/ID/순서 항목, 전체 파일 및 노드 원본 SHA-256.
- 연결된 로컬 문서의 경로/존재/크기/SHA-256. 문서 본문·미디어 원본은 제외.
- 발견한 프로필의 문서/재생목록 기준 중 허용한 필드, 중단 작업의 ID/상태.
- 서버와 통신하지 않았다는 표시. 서버본과의 대조 결과는 아직 아니다.

비밀번호·쿠키·키체인은 읽지 않는다. 전체 설정 폴더나 백업 원본을 복사하지 않는다.
프로필 해시는 추정하지 않고 실제 64자리 해시 폴더를 열거한다.
상태 파일이 없는 경우 새로 만들지 않는다. 심볼릭 링크는 거절한다.
읽은 파일 해시와 폴더 목록을 마지막에 다시 확인하고 변경되면 중단한다.
이는 적용용 백업이나 동시 편집에 대한 원자적 스냅샷이 아니다.
실제 덮어쓰기 직전에는 별도 백업과 현재 해시/CAS 재검증이 필요하다.

진단 결과의 19개 목록을 확인한 다음 **사용자가 보관 대상을 선택한다.**
이 도구는 어떤 목록도 보관·삭제·업로드하거나 기준을 재설정하지 않는다.
이름·사용일로 보관 대상을 자동 선정하지 않는다.

## 3. 격리 GUI 검사와 앱 빌드

로그인한 Mac 데스크톱의 터미널에서:

```bash
bash mac-app/test-gui.command
```

Node 기반 Worker 통합 검사를 제외한 합성 GUI 검사다.
임시 설정·문서 경로를 사용하고 시작 자동 비교를 끈다.
`YB_TESTING` 빌드에서는 전송/키체인 호출을 호출 지점에서 거절하며,
이 차단 자체도 검사한다. 운영 빌드의 전송/키체인 동작은 바뀌지 않는다.
무한 재귀 수정과 받기 버튼 상태, 기존 UI 크기/일시중단 검사를 실행한다.
`mac-app/test-output/gui-build.log`, `gui-test.log`, PNG가 생성된다.
검사가 실패하면 과거 PNG를 이번 성공의 근거로 사용하지 않는다.

GUI 검사가 성공한 뒤:

```bash
bash mac-app/build.command
```

결과는 `mac-app/build/예배온 Sync.app`이다. 빌드 스크립트는 앱을 실행하지 않는다.
**새 앱 실행/운영 앱 교체는 진단 검토 뒤에 진행한다.**
실제 앱 시작에는 비교·inventory·조건부 서버 갱신이 있으므로 빌드와 실행을 구분한다.
오류가 나면 해당 명령과 터미널 출력을 전달한다. OS/Xcode 업그레이드를 먼저 요구하지 않는다.

## 검증·비용·남은 작업

- Linux에서 셸 구문, 변경 diff, 재귀 제거·격리 가드·읽기 전용 코드 경로를 정적으로 확인한다.
  이것은 Mac 컴파일·자체 검사·GUI 성공을 의미하지 않는다.
- 기존 CI 37001417118/37001879863의 APP CHECK75 뒤 segfault 원인인
  `updateReceiveAll`의 무조건 자기 호출을 제거하고 `acceptComparison:`에서 상태를 갱신한다.
  원인 수정 코드는 준비됐지만 Mac 재검증 전이므로 실패 해결을 실기 완료로 보고하지 않는다.
- 서버 SQL/API/스키마 변경 없음. 대기/첫 진입/검색/문서 열기·저장/재생목록 저장/
  Sync 비교·다운로드의 운영 호출 구조는 그대로다. 이번 진단과 격리 GUI의 서버 호출은 0회이며
  D1 읽기/쓰기 추가는 0행이다. 기존 전체 비교 비용 절감을 달성한 것은 아니다.
- 서버 로컬 정본 갱신, 보관/복원 및 구버전 전체 PUT 보호, 필요한 작업에 전체 비교 양보,
  의미상 동일 문서 판정, 미디어 자동 동기화는 후속이다.
