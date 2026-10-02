# Sync·Studio 자료 생명주기 계약 인계 — 최신 배포 기준
작성: 2026-10-03 KST. 현재 구현과 후속 제안을 구분한다. 기능 변경은 없다.

## 1. 확인 기준과 다음 세션 지시

- 최신 main: 8838f40b1eca0867f09b1ac400e21d924cdfab25.
- PR #23·#22는 병합됐다. 운영 배포 소스 ffc95f16505b6910d7f1f513835728dfa89fa9a1, [배포37078670124](https://github.com/m1r4d0r/yebaeon/actions/runs/37078670124) 성공. 최신 앱 인계는 Sync0.6.3/build16이다.
- [현재 정리·운영 인계](LIBRARY-CLEANUP-NEXT-2026-10-03.md)와 AGENTS.md를 먼저 읽는다. 이전 초안의 ‘생성/복제/보관 미구현’, ‘보관 대상 미선정’, ‘PR #22 미병합’ 설명은 적용하지 않는다.
- 유지7·보관7·삭제5가 이미 승인됐다는 최신 지침을 따른다. 재선정/재확인하지 않는다. 구체적인 자료 식별자·교회 원본은 공개 Git에 추가하지 않는다.
- 사이트 배포와 실제 교회 자료 적용을 구분한다. 교회 문서/템플릿 교체·서버 정본 정리는 최신 인계에서 미실행이다.
- 별도 세션의 새 기능을 되돌리지 않고 기존 API를 확장한다. 이번에는 문서만 추가하며 코드·DB·운영 자료·Actions를 변경/실행하지 않는다.

고정 SHA의 AGENTS·최신 인계·CROSS-PLATFORM-LESSONS와 관련 소스를 별도 폴더에 받아 확인했다. 전체 저장소 clone이나 교회 원본 다운로드를 했다는 뜻은 아니다.
근거: cloudflare/playlist-management.mjs, playlists.mjs, documents.mjs, schema.mjs; mac-app/YBPlaylistSync.m; web-editor/library-actions.js, pp6.js; tests/playlist-management.test.mjs.

## 2. 이미 구현된 계약 — 재구현하지 말 것

| 기능 | 현행 계약 |
|---|---|
| 새 재생목록 | POST /api/playlists/{libraryId}/nodes. 기존 .pro6pl 안에 node 추가. 클라이언트 UUID·이름·파일 If-Match, 같은 ID/이름 재요청은 unchanged |
| 보관 | POST /api/playlists/{id}/archive?node=…. 파일 CAS·선택적 baseNodeHash 확인 후 활성 XML에서 제거하고 controls에 archived 기록 |
| 보관 당시 문서 | node XML·확보된 문서 원본을 독립 R2 playlist-archives 경로에 복사·해시 검증. 찬양의 일반 버전 정리와 독립 |
| 보관함 | GET /api/playlists?scope=archived, GET /api/playlists/{id}/archive?node=… 및 document 쿼리로 당시 문서 받기 |
| 순서 복원 | POST /api/playlists/{id}/restore?node=…. 같은 node를 복원하되 **현재 서버 문서에 연결** |
| 서버 목록 제거 | DELETE /api/playlists/{id}/nodes?node=…. controls에 removed. 보관과 달리 전용 문서 snapshot은 만들지 않음 |
| Mac 구조 반영 | GET /api/playlists/{id}/structure의 fingerprint 검증. ‘웹에서 보관·삭제한 목록 반영…’으로 공통 기준과 같은 로컬 node만 백업·제거 |
| 서버 전용 node 보호 | 0.6.3 일반 업로드가 서버 catalog에는 있고 로컬에 없는 모든 node를 서버 원본에서 보존 |
| 구버전 PUT 보호 | controls의 active node 유실 및 archived/removed node 부활을409로 차단 |
| 문서 생성·복제 | Studio에서 XML 준비 후 기존 documents POST. 새 서버 UUID/경로·동명 덮어쓰기 차단 |
| 복제 내부 정보 | UUID/uuid, 정확히 일치하는 속성·NSString 참조 갱신. 사용일/횟수 초기화. 미저장 편집 내용도 복제 가능 |

카테고리는 최신 확정값을 유지한다: 가사찬양·악보찬양 검색 켬/이력 끔, 예배순서·특별순서 둘 다 켬, 옛날자료 둘 다 끔, 미결 기존 설정 유지. 과거 ‘주간 문서 검색 끔’ 제안을 다시 적용하지 않는다.

## 3. 로컬 삭제 처리: 서버 상태와 장치 의도를 분리

최신0.6.3은 로컬에서 빠진 node를 서버에 보존한다. 예전0.6.2의 전체 PUT 삭제 전파 우려를 최신 앱에서도 똑같이 발생한다고 설명하면 안 된다.

남은 문제는 ‘이 Mac에서만 제외’ 의도가 독립적으로 기록되지 않는다는 점이다. 서버 active/로컬 없음만으로 새 서버 자료와 의도적 제거를 구분할 수 없다.

| 구분 | 상태 | 의미 |
|---|---|---|
| 서버 | active / archived / removed | 현재 controls 개념 유지. removed는 목록 제거이며 문서·미디어 영구 삭제 아님 |
| 장치 의도 | included / excluded | 이 Mac에 둘 것인지. 후속 영속 정책 |
| 실제 관측 | present / absent / unknown | 이번 스캔 결과. 사용자 의도와 별개 |

권장 동작:
- 이전 기준에 있던 node가 완전한 정상 스캔에서 사라짐 → ‘Mac에서 없어짐’. 다시 받기 / 이 Mac에서 제외 / 서버에도 보관 선택 제공.
- 이전 기준이 없으면 미설치로 표시. 다른 target, 읽기·권한·파싱 오류, PP6 저장 중은 삭제가 아니라 unknown.
- excluded는 일반 비교·일괄 받기에서 제외하고 ‘이 Mac에 다시 받기’로 해제.
- 서버 보관 해제만으로 장치 제외를 해제하지 않음. ‘복원하고 이 Mac에 받기’는 명시적 결합 동작.
- 로컬 node 제거는 연결 .pro6/이미지 삭제와 무관. 공유 자료는 유지.
- 정책 키는 deviceId/profileId/libraryId/nodeId, revision·마지막 적용 상태 포함. Mac 영속 저장을 기본으로 서버 복제·장치 교체 정책을 별도 정의.
- 현재 removed baseline은 서버 구조 적용 기록이다. 모든 장치 제외 의도를 대체한다고 간주하지 않는다.

### 구버전 보호에서 남은 범위

protectManagedPlaylists는 controls에 등록된 node만 확인한다. 과거 import된 일반 node 전체를 active controls로 등록하는 것은 아니다. 따라서 **구버전 앱이 미관리 node를 누락한 전체 PUT**까지 전부 방어한다고 단정할 수 없다. 이는 정적 코드 분석이며 이번에 운영 재현하지 않았다.

기존 node의 유한한 관리 등록 또는 전체 PUT의 기존 node 누락 차단을 우선 검토한다. 누락은 명시적 제거 API에서 처리한다. 서버가 몰래 합쳐 성공시키면 구버전의 전체 SHA 검증이 실패하므로 구조화된409/업데이트 안내가 낫다. 최신 Mac의 보존 동작은 유지한다.

## 4. 보관·복원 의미와 실패 처리

현재 보관은 ‘당시 문서 사본 받기’와 ‘현재 문서로 순서 복원’을 제공한다. 복원 버튼을 공유 문서 전체의 과거 내용 덮어쓰기로 바꾸면 다른 예배까지 바뀐다. 당시 내용을 다시 사용해야 한다면 **새 문서로 복제해 새 순서에 연결**하는 별도 기능을 권장한다.

주의점:
1. 서버에 없는 Mac 최신 수정은 보관에 들어가지 않는다. ‘Mac 최신 반영 후 보관’은 비교·업로드·검증을 먼저 해야 한다.
2. snapshot은 문서를 차례로 읽는다. library CAS는 모든 문서의 동시 수정을 고정하지 않는다. manifest의 문서별 id/version/hash를 유지하고 ‘단일 시점 snapshot’인지 ‘보관 중 확보한 각 버전’인지 명시한다.
3. 이력 끔 문서 저장/정리와 snapshot 복사의 경합으로 읽기가 실패할 수 있다. 실패를 완료로 표시하지 않는다. 엄격한 시점 고정이 필요할 때만 버전 pin/짧은 보존 계약을 추가한다.
4. 보관 성공·Mac 제거 실패는 따로 표시한다. 자동 보관 취소 대신 기존 journal/복구·해시 재확인으로 재시도한다.
5. 복원 후 재보관은 controls.snapshot_key를 새 사본으로 바꾼다. 이전 snapshot 보존기간·조회·정리 정책이 필요하다. 최신 링크만으로 전체 보관 이력을 제공한다고 약속하지 않는다.
6. removed는 전용 archive 사본이 없다. ‘삭제도 보관함 복원 가능’으로 안내하지 않는다. 과거 파일 이력 잔존 가능성과 지원되는 복원 기능을 구분한다.
7. missing/unmapped와 media:'references-only'를 유지한다. 문서 사본이 있어도 실제 이미지/영상은 확보된 것이 아니다.
8. 보관 manifest의 참조는 미디어 GC에서 살아 있는 참조다. active XML에서 빠졌다는 이유로 이미지 삭제하지 않는다. 보호 태그·현재 공유 참조·보관 사본을 함께 확인한다.

## 5. 생성·복제 계약 보완

| 동작 | 정체성과 공유 |
|---|---|
| 기존 문서를 순서에 추가/순서 항목 복사 | 같은 documentId를 참조. 문서 수정이 다른 예배에도 반영 |
| 문서 복제 | 새 documentId·경로·PP6 내부 ID. 원본과 독립. 이미지 바이트는 참조 공유 가능 |
| 재생목록 복제(후속) | 새 node/cue, 기본은 기존 문서 공유. ‘문서까지 복제’와 구분 |
| 문서 저장 후 순서 연결 | 저장 성공/연결 실패 분리. 새 문서를 반복 생성하지 않고 기존 결과로 연결 재시도 |
| indexedOnly 원본 미업로드 | 복제할 실제 원본 필요. 제목만으로 빈 문서를 대신 만들지 않음 |
| 파일 rename/이동 | XML 경로 참조 갱신이 필요. 표시 제목 변경과 구분 |

새 node는 libraryId/nodeId로 식별한다. 빈 예배도 유효하고, Mac에서는 연결 문서 준비 후 node를 적용한다. 서버 새 예배를 모든 Mac에 자동 설치하는지, 선택해서 받는지 사용자 정책을 분명히 한다.

현재 node 동일 ID/이름 재요청, 문서 동일 경로/내용 POST, dialog 내 준비 XML 재사용은 기본적인 재시도 보호다. 모든 재시도에 영속 operationId가 제공되는 것은 아니다.

후속 operationId에는 요청 fingerprint와 결과 ID/단계를 저장한다. 같은 작업 재요청은 같은 결과, 같은 키로 다른 내용은409. 새로고침·응답 유실·오프라인·문서 저장 후 순서 연결 실패에도 결과를 찾을 수 있게 한다. 기존 endpoints 확장이 우선이며 별도 document-operations API를 중복 만들 필요는 없다.

refreshIDs와 정확히 일치하는 NSString 참조 갱신을 재사용한다. UUID가 여러 개 묶인 특수 필드/arrangement 등은 실물 fixture로 지원 범위를 확인한다. 미디어 경로·RTF·알 수 없는 원본 필드를 일괄 치환하지 않는다. 새 문서/복제본 High Sierra·PP6 재열기는 별도 실기다. 사용일 초기화와 최신 카테고리 정책을 유지하고, 이력 끔도 CAS 버전은 증가한다.

## 6. 변경할 계약의 최소 범위

1. 기존 /nodes·/archive·/restore·전체 PUT 유지 + 미관리 node 보호 확대.
2. 장치별 included/excluded 정책과 revision 추가. 서버 상태·정책·실제 적용 완료 관측을 분리.
3. session/capability에 write protocol을 포함해 구버전 위험 작업을 안내/차단. 매번 폴링하지 않음.
4. 생성·보관·복원 작업ID 및 결과 조회로 재시도 강화. R2와 D1, 서버와 Mac은 단일 트랜잭션이 아님을 반영.
5. 지금은 구조 변경이 파일 버전 CAS 및 동일 DB batch의 controls 갱신으로 보호된다. 후속 상태 독립 변경 시 stateRevision CAS 추가. 현재 별도 stateRevision 부재 자체를 확정 오류로 쓰지 않음.
6. 장기적으로 documentId 기반 현재 참조 매핑. PP6 경로는 export/import 어댑터. 기존 UUID 없는 node 이름 fallback은 명시적 이관.
7. changes feed는 필요할 때 후속. cursor/high-watermark·보관/removed 전달·cursor 만료/재동기화 계약 정의. 현 규모에서 필수 선행 인프라로 과도하게 확대하지 않음.

장치 제외가 있어도 archived/removed node가 파일 업로드로 되살아나면 안 된다. 오래된 오프라인 장치와 tombstone 유지 정책은 본문 이력 보관 여부와 별개다.

## 7. 초기 로딩과 D1/R2 영향

보관 node는 활성 XML에서 제거되므로 활성 plan 수는 줄어든다. 그러나 enriched 목록은 여전히 파일 원본·node 이력을 읽고 전체 문서 catalog/inventory는 별도로 남는다. 보관7개를 전체 조회비용7/19 감소로 환산하지 않는다.

| 작업 | 영향/제안 |
|---|---|
| 대기 | 새 폴링0 유지 |
| 최초 진입 | 활성 목록 우선. 현재 XML/이력 기반 enriched를 현재 메타 인덱스로 대체하는 것은 후속 |
| 검색1회 | 제목+본문·최근 사용일·카테고리 정책 유지. 전체 보관/참조 재집계 추가 금지 |
| 문서 열기·저장 | 해당 ID/version/색인만. 보관함 전체 조회를 붙이지 않음 |
| 문서 복제 | 새 원본·메타·색인 쓰기 증가. operation 기록은 작은 추가 쓰기 |
| 재생목록 저장 | 기존 관리 행 조회/파일 CAS 유지. 대상 node·참조만 갱신하는 것은 후속 |
| 보관 | 고유 문서 N개 원본 읽기·R2 사본 쓰기·manifest·파일/controls 갱신. 현500개/80MiB 제한 유지 |
| 보관함 | API는100개씩, 현 Studio는 열 때 다음 페이지 끝까지 순회. 증가 시 ‘더 보기’로 요청도 제한 |
| Sync 비교·받기 | 장치 제외를 plan/일괄 받기에서 제외해 반복 작업 감소. 전체 문서 비교 비용은 별개 |

마이그레이션은 한 번의 유한한 checkpoint 작업으로 한다. 실패한 보관 staging·재보관된 옛 snapshot 정리는 참조/보존기간을 확인하는 제한된 유지보수로 한다. 요청 수·반환 수·D1 rows_read/rows_written을 구분한다. 이번 문서 작성의 운영 DB 읽기/쓰기0이며 위 비용은 구조 분석, 운영 실측이 아니다.

## 8. 다음 실행 순서와 검증

실제 자료 적용은 LIBRARY-CLEANUP-NEXT의 승인된7/7/5·최신 Mac 기준 대조 순서를 따른다. 이번 문서로 대상을 바꾸지 않는다.
코드 후속 우선순위:
1. 미관리 기존 node/구버전 PUT 보호.
2. Mac ‘없어짐’과 ‘이 Mac에서 제외’ 영속 정책/해결 UI.
3. 보관 의미·현재 문서 복원·실패 단계·미디어 한계 표시.
4. 생성·복제·순서 연결의 영속 작업ID.
5. 필요에 따른 현재 참조 인덱스·증분 비교.

회귀 검사는 기존 범위에 위험별로 추가한다. 검사 개수 증가가 목표가 아니다.
- 관리/미관리 node 로컬 삭제, 구버전 PUT, archived/removed 부활, 서버 신규 node 보존.
- 잘못된 target·불완전 스캔·기준 없음·장치 제외·재설치.
- 보관과 문서 변경/이력 정리 경합, 보관 성공 후 Mac 실패/복구, 재보관 이전 사본.
- 동일 작업 재시도·다른 payload·동시 경로 충돌·응답 유실·순서 연결만 실패.
- 복제 원본 불변·내부 UUID·미디어 참조·NFC/NFD·대소문자/특수 경로.
- 복원은 현재 문서, 당시 내용 재사용은 별도 복제, 보관 참조 GC 보호.
- PP6 실기 새 문서·복제·빈 목록 재열기. 최신 macOS의10.13 대상 CI와 구분.

## 9. 이번 작업의 경계

최신 배포를 확인하고 관련 파일을 받아 0.6.2 기준 초안을 대체했다. 코드/운영자료 수정, 새로운 검사/배포 실행은 없다. API 조회의 workflow별 경로 오류는 실행 목록 조회로 대체해 성공 배포를 확인했다. 이는 제품 장애가 아니다.
이 문서는 **배포된0.6.3/관리 기능의 남은 계약 보완 인계**다. 구현 완료로 잘못 읽거나 기존 기능을 다시 만들지 않는다.
