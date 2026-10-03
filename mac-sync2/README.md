# 예배온 Sync 2 (1차 · 받기)

서버가 정본이고 이 Mac은 사본이다. 1차는 **서버 → Mac 받기**만 한다. 올리기·이미지·상주 모드는 다음 판이다.

## 규칙

- "서버가 바뀌었나"는 서버 노드 sha와 문서 버전·sha로, "Mac이 바뀌었나"는 영수증(`receipt.sqlite`)과 지금 파일로 판단한다. 서버 바이트와 Mac 바이트를 직접 맞대지 않는다.
- 단위는 예배(노드)다. 다른 예배의 바이트는 건드리지 않는다. 재생목록 파일 전체 기준·자동 전체 PUT은 없다.
- 서버에 원본이 없는 참조(장부 이름만 있는 곡)는 받기를 막지 않는다. Mac 파일을 그대로 쓴다.
- 양쪽이 바뀐 문서·순서는 서버 것을 적용하고 Mac 것은 백업 폴더에 남긴다. Mac에서만 바뀐 것은 건드리지 않는다(올리기는 2차).
- 실패는 예배별로 남기고 나머지는 계속한다. 전역 잠금이 없다. 적용 도중 꺼지면 다음 실행에서 끝까지 마무리한다.
- 부팅 직후 네트워크가 없으면 간격을 늘리며 조용히 기다린다. PP6가 켜져 있으면 적용 버튼이 꺼진다.

## 파일

| 파일 | 역할 |
|---|---|
| `YB2Receipt.*` | 영수증(SQLite). High Sierra의 SQLite 3.19에 맞춰 UPSERT를 쓰지 않는다 |
| `YB2Engine.*` | 비교·적용·중단 복구 |
| `YB2App.m` | 창 하나짜리 앱 |
| `YB2Test.m`, `test-server2.mjs` | 로컬 Worker를 띄워 실제 API로 돌리는 통합 검사 |
| `build.command`, `test.command` | 빌드·검사. 기존 `mac-sync/YBSync.m`, `YBServer.m`, `mac-app/YBPlaylistIO.m`, `YBPlaylistFormat.m`을 재사용한다 |

프로필: `~/Library/Application Support/YebaeOn Sync 2/<id>/` 아래 `receipt.sqlite`, `backups/<적용회차>/`, `stage/`, `apply-journal.json`. 백업은 최근 10회만 남긴다. 입장 정보는 기존 Sync와 같은 키체인 항목을 쓴다.

## 서버 쪽 변경

- `plan`에 `applicable`(지원하지 않는 항목·폴더 밖 경로가 없음)과 `missing`(원본 없는 참조 수)을 더했다. `ready`는 그대로다.
- 재생목록 파일 전체 PUT은 `X-YebaeOn-Sync: 2` 머리글이 없으면 426으로 거절한다. Sync 0.6.6의 자동 전체 PUT이 웹 편집본을 덮지 못하게 하는 안전장치다.

## 검사

```
npm test
bash mac-sync2/test.command     # 로컬 Worker + 엔진 통합 검사 (macOS)
bash mac-sync2/build.command    # 앱 빌드 (10.13 대상)
```

GitHub Actions `Verify Mac Sync 2`는 `sync2` 브랜치의 `[verify-mac]` 커밋이나 수동 실행에서만 돈다. 최신 macOS에서 10.13 대상으로 빌드한 결과이며 교회 High Sierra 실기와는 구분한다.

## 1차 범위 밖

올리기(Mac 수정분·사용일), 이미지 받기, 상주 모드·자동 적용, 서버 보관본, Studio 상태 표시. 기존 0.6.6 앱은 지우지 않고 두되 재생목록 비교에 쓰지 않는다.
