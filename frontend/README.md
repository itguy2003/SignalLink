# SignalLink Green — Frontend (CMS)

Vue 3 + Vite + Pinia + Vue Router 기반 CMS 화면.

## 실행

```bash
npm install

npm run dev        # 백엔드(127.0.0.1:8000)에 연결
npm run dev:test   # 테스트 모드 — 백엔드 없이 단독 실행
```

`npm run dev` 는 `/api` 요청을 Vite 프록시가 `http://127.0.0.1:8000` 으로 넘긴다.
다른 주소를 쓰려면 `.env` 에 `VITE_API_BASE` 를 지정한다.

## 테스트 모드 (요구사항 제한사항 8)

> "CMS 클라이언트 개발시 독립적으로 테스트 가능하도록 테스트 모드 실행을 별도로 구현"

`npm run dev:test` 는 `VITE_TEST_MODE=true` 로 띄우고, 이때 `api` 클라이언트는 네트워크로
나가지 않고 [src/api/mock/server.js](src/api/mock/server.js) 의 모의 백엔드가 요청을 처리한다.
**화면 코드는 어느 쪽인지 알지 못한다** — 같은 `api.get/post/put/delete` 를 호출할 뿐이다.

모의 서버는 실제 백엔드와 같은 경로·응답 형태를 갖고, 기관 트리 기반 권한 규칙도 같은 방식으로
구현했다. 그래야 테스트 모드에서 본 동작이 실서버에서도 성립한다. 이 대응 관계는
[src/api/mock/server.test.js](src/api/mock/server.test.js) 가 검증한다(백엔드의
`tests/test_devices.py`, `tests/test_users.py` 와 같은 시나리오).

로그인 화면에 테스트 계정 버튼이 나온다.

| 계정             | 비밀번호        | 역할                  |
| -------------- | ----------- | ------------------- |
| `admin`        | `admin1234` | 슈퍼관리자               |
| `edu_admin`    | `test1234`  | 기관관리자 (서울특별시교육청)    |
| `school_admin` | `test1234`  | 기관관리자 (가나초등학교)      |
| `device_mgr`   | `test1234`  | 장치관리자 — 위임받은 2대만 보임 |
| `teacher`      | `test1234`  | 담임교사                |

상태는 메모리에만 있으므로 새로고침하면 시드 데이터로 돌아간다.

## 명령

```bash
npm test           # vitest 실행
npm run test:watch
npm run build      # 프로덕션 빌드
```

## 화면

| 경로                      | 화면                                   | 접근 역할                  |
| ----------------------- | ------------------------------------ | ---------------------- |
| `/login`, `/register`   | 로그인 / 회원가입(ID 중복검사 포함)               | 공개                     |
| `/`                     | 대시보드 — 장치 현황, 데모 표출 장치, 승인 대기        | 전체                     |
| `/organizations`        | 기관 트리, 등록/수정/삭제, 엑셀 일괄 등록            | SUPER_ADMIN, ORG_ADMIN |
| `/users`                | 사용자 목록, 승인/취소, 역할 부여                 | SUPER_ADMIN, ORG_ADMIN |
| `/devices`              | 장치 CRUD, 스케줄 배정(개별/일괄), 관리 위임, 원격 명령 | 전체(범위는 역할별)            |
| `/schedules`            | 스케줄 목록, 생성/복제/삭제                     | 전체                     |
| `/schedules/:id/editor` | 콘텐츠 편집기                              | 전체                     |
| `/boards`               | 기관 게시판 수집원과 수집 데이터                   | SUPER_ADMIN, ORG_ADMIN |

## 콘텐츠 편집기

`/schedules/:id/editor` 의 편집 결과는 `ScheduleItem.content` 에 JSON 으로 저장되며,
이 JSON 이 **편집기 · 서버 · 모든 플레이어(JS/.NET/Flutter)가 공유하는 계약**이다.
스키마 정의는 `backend/app/schemas/content.py` 의 `ContentDocument`.

```jsonc
{
  "version": 1,
  "layout": { "width": 1920, "height": 1080, "background": "#0f172a" },
  "elements": [
    {
      "id": "e1",
      "type": "widget",           // widget | text | image | video | web | shape
      "widget_key": "notice",     // type=widget 일 때
      "rect": { "x": 120, "y": 300, "w": 820, "h": 600, "z": 1, "rotation": 0 },
      "opacity": 1,
      "options": { "count": 5 },
      "src": null                 // image/video/web 의 소스
    }
  ]
}
```

좌표는 `layout` 기준 절대 픽셀이고, 플레이어가 장치 해상도에 맞춰 균일 스케일링한다.

위젯 팔레트와 옵션 폼은 서버의 `GET /api/v1/widgets` 응답으로 자동 생성된다
([WidgetOptions.vue](src/components/WidgetOptions.vue)). **백엔드에 위젯을 추가해도
편집기 코드는 고칠 필요가 없다.**

## 권한 처리

화면 노출은 `stores/auth.js` 의 `can` 플래그와 라우터 `meta.roles` 로 제어한다
(요구사항: Backend 와 Frontend 양쪽에서 역할에 따라 기능 사용 가능 여부를 제어).

다만 **최종 판정은 항상 서버**다. 메뉴를 감추는 것은 편의일 뿐이고, 서버가 거부하면
화면은 그 오류 메시지를 그대로 표시한다.

## 미연동 항목

- **주소검색 API**: `OrganizationsView.vue` 의 `searchAddress()` 가 연동 지점이다.

  Daum 우편번호 스크립트를 `index.html` 에 추가하면 바로 동작하고, 없으면 직접 입력으로 폴백한다.
- **엑셀 일괄 등록**: 백엔드 구현은 완료. 테스트 모드에서는 파일 파싱을 하지 않으므로

  실제 백엔드를 띄우고 확인해야 한다.