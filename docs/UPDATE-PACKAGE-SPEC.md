# PP6 Offline Update Package — draft v0.1

로컬 Sync와 서버 동기화에서 함께 사용할 오프라인 전달 포맷이다. 서버의 저장 범위는 [전체 문서·성경 자료·사용 미디어 라이브러리](SERVER-PLAN.md)이며, 이 패키지의 변경분만 저장한다는 뜻은 아니다.

## 웹 편집기 실험 export (2026-09-28)

`web-editor`는 이 구조로 ZIP을 생성하며, 교체한 새 미디어만 `assets/Images` 또는 `assets/Video`에 담습니다. 문서 안의 임시 source는 `file:///PP6-Package/assets/...`입니다. 현재 comparator는 basename으로 package 후보를 찾을 수 있으나, 실제 PP6 사용 전에는 Mac 적용 엔진이 파일 설치와 절대경로 rewrite를 해야 합니다. 그 엔진은 아직 미구현입니다.

`WEB-EDITOR-NOTES.txt`에는 한계와 이 PC에서 연결하지 못한 기존 미디어 목록이 포함됩니다. 별도 production manifest/checksum 계약은 아직 확정하지 않았습니다. 새 미디어 이름에는 무작위 고유 접미사를 붙이며, 내용 hash 기반 deduplication을 구현한 것은 아닙니다.

```text
PP6-Update/
├─ documents/
│  ├─ 토요일.pro6
│  └─ 하위폴더/문서.pro6
├─ assets/                  # 선택 사항
│  ├─ Images/
│  ├─ Video/
│  └─ Audio/
└─ playlists/               # 이후 Playlist Sync와 통합할 때 사용
   └─ 기본 .pro6pl
```

## 핵심 원칙

1. 서버 연결과 로컬 적용 엔진은 병행 개발한다. 이 폴더는 USB/클라우드/직접 다운로드 등 어떤 방식으로든 Mac에 전달할 수 있는 오프라인 경로다.
2. `documents/`의 상대경로가 Mac `~/Documents/ProPresenter6` 상대경로와 대응한다.
3. 비교 키는 NFC-normalized 상대경로지만, 실제 파일명을 NFC로 바꾸거나 rename하지 않는다.
4. `assets/`는 이 업데이트에 필요한 미디어를 담는다. 서버는 별도로 사용 미디어를 보관하며, 대상 Mac에 없는 파일을 패키지에 포함하거나 서버에서 내려받도록 한다. 현재 로컬 웹 편집기는 교체한 새 미디어만 ZIP에 포함한다.
5. 로컬 Mac에 이미 동일 미디어가 있다면 `assets/`에 다시 넣지 않아도 된다.
6. 문서 삭제는 초기 Sync에서 자동 반영하지 않는다.
7. 새 미디어 설치 위치는 장기적으로 다음을 기본값으로 한다.
   - Images: `/Users/Shared/Renewed Vision Media/Images/`
   - Video: `/Users/Shared/Renewed Vision Media/Video/`
   - Audio: `/Users/Shared/Renewed Vision Media/Audio/`
8. 같은 파일명이 이미 있지만 내용이 다른 경우 기존 미디어를 조용히 덮어쓰지 않는다. 이후 hash 기반으로 별도 이름을 만들고 `.pro6` 참조를 새 경로로 고친다.

## 적용 순서(향후)

```text
1. PP6 실행 여부 확인
2. 업데이트 폴더 검사
3. 문서 diff / dependency 검사
4. 사용자 승인
5. 문서 원본 백업
6. 필요한 신규 media를 Renewed Vision Media로 복사
7. incoming .pro6의 media path를 실제 설치 경로로 rewrite
8. 신규/수정 .pro6 적용
9. .pro6 재검증
10. playlist 적용
11. playlist 재검증
12. 실패하면 문서/playlist 복원
```

## 미디어 해석 우선순위

```text
A. .pro6 source의 정확한 경로가 현재 존재한다
   ├─ Renewed Vision Media / ProCG Content 내부 → exact-managed
   └─ Downloads/Desktop 등 외부 → exact-external

B. 정확한 경로는 없지만 관리 미디어 폴더에 같은 basename이 하나 있다
   → relocated-unique

C. update/assets에 같은 basename이 하나 있다
   → package-asset

D. 후보가 여러 개
   → ambiguous (자동 결정 금지)

E. 후보 없음
   → missing
```

`relocated-unique`는 현재 환경에서 중요한 케이스다. PP6가 미디어 관리 기능을 통해 과거 Desktop/ProCG Content 파일을 `Renewed Vision Media`로 복사하고 이후 저장 시 참조 경로를 갱신하는 것으로 보이는 사례가 확인됐다.
