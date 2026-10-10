# 작업 안내

읽는 순서: [docs/STATUS.md](docs/STATUS.md)(지금 상태) → [docs/BACKLOG.md](docs/BACKLOG.md)(남은 일) → 손대는 영역의 규칙과 설계.

## 지켜야 할 것

- 사용자에게 한국어로 보고한다. 실패·중단·미완료는 증상, 원인(확정/추정 구분), 조치, 재검증 결과를 적는다.
- 사용자 요청 작업은 필요한 검증이 끝나면 추가 승인 대기 없이 바로 main에 병합하고 정상 운영 배포와 반영 확인까지 마친다. 사용자가 다른 곳의 동시 작업 등을 이유로 별도 브랜치 유지, 병합 보류 또는 배포 보류를 명시한 경우에는 그 지시를 따른다.
- 병합 직전 최신 main을 확인하고 다른 작업의 변경을 보존한다. 작업 격리를 위해 임시 브랜치를 만들었다는 이유만으로 병합을 보류하지 않는다. 운영 데이터 변경은 사용자의 명시 승인 뒤에만 한다.
- 자동 검사는 로컬 Worker 모사(Miniflare)만 쓴다. 운영 D1을 치지 않는다.
- 공개 저장소다. 교회 원본(.pro6·.pro6pl·ZIP), 진단 자료, 정리 패키지, 인증 정보를 새로 커밋하지 않는다. 사용자 원본 파일명·경로를 바꾸지 않는다.
- Mac 검사(`Verify Mac Sync 2`)는 main의 `[verify-mac]` 커밋이나 수동 실행에서만 돈다. 최신 macOS CI 결과를 교회 High Sierra 실기로 표현하지 않는다.
- 세션마다 새 인계 파일을 만들지 않는다. STATUS.md를 덮어쓰고, 끝난 일은 CHANGELOG.md에 한 줄, 남은 일은 BACKLOG.md 한 곳에 둔다. 경위는 `docs/archive/`에 둔다.
- 코드 주석은 현재 동작만 설명한다. 지운 코드나 작업 이력을 주석에 남기지 않는다.

## 규칙과 설계

- [작업 규칙](docs/rules/working-rules.md) · [D1 비용](docs/rules/d1-cost.md) · [경로·한글·High Sierra·PP6](docs/rules/cross-platform.md)
- [Sync 규약](docs/design/sync.md) · [서버 저장](docs/design/server-storage.md) · [이미지](docs/design/media.md) · [문서 정리 정책](docs/design/library-policy.md) · [Studio 렌더](docs/design/studio-render.md) · [구성·코드 위치](docs/design/architecture.md)
- [교회 전환](docs/guides/church-migration.md) · [주보·Dropbox](docs/guides/bulletin-dropbox.md) · [PPT 가져오기](docs/guides/ppt-import.md)
