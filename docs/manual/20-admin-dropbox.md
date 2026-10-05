---
title: 드롭박스 연결
group: 관리자
lede: 한 번만 하면 모든 작업자가 주보·PPT를 드롭박스에서 고를 수 있어요.
admin: true
---

1. Dropbox 개발자 페이지에서 Scoped access · Full Dropbox 앱을 만들고, 권한은 `files.metadata.read`와 `files.content.read`만 켜요.
2. 저장소를 받은 컴퓨터에서 `node scripts/connect-dropbox.mjs`를 실행해 App key, 폴더 경로, App secret을 넣고 한 번 승인해요.
3. 스크립트가 값을 서버 비밀값으로 직접 넣어요. 토큰을 채팅이나 GitHub에 올리지 않아요.

> [!NOTE]
> 읽기 전용이에요. 예배온은 드롭박스 원본을 바꾸지 않아요. 다른 저장소로 옮길 계획이면 이 페이지가 바뀝니다.
