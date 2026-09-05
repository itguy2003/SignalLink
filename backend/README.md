# SignalLink Green — Backend

FastAPI + SQLAlchemy 기반 CMS API 와 플레이어(장치) API.

## 실행

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt   # Windows
# source .venv/bin/activate && pip install -r requirements-dev.txt  # Linux/macOS

cp .env.example .env          # 운영에서는 SECRET_KEY / DEVICE_MASTER_KEY 반드시 교체
.venv/Scripts/python.exe -m uvicorn app.main:app --reload
```

- API 문서: http://127.0.0.1:8000/docs
- 기동 시 최상위 기관과 슈퍼관리자(`admin` / `admin1234`)가 자동 생성된다.

## 명령

```bash
.venv/Scripts/python.exe -m pytest                       # 전체 테스트
.venv/Scripts/python.exe -m pytest tests/test_devices.py # 파일 단위
.venv/Scripts/python.exe -m pytest -k "고유번호"          # 이름으로 필터
.venv/Scripts/python.exe -m ruff check app tests --fix   # 린트

.venv/Scripts/python.exe -m alembic revision --autogenerate -m "메시지"
.venv/Scripts/python.exe -m alembic upgrade head
```

## DB 전환

`DATABASE_URL` 이 비어 있으면 개발용 SQLite(`backend/signallink.db`), 값이 있으면 그 DSN 을 쓴다.

```bash
DATABASE_URL=postgresql+psycopg://signallink:password@localhost:5432/signallink
```

SQLite 와 PostgreSQL 모두에서 같은 마이그레이션이 돌아야 하므로:

- 방언 전용 타입(PostgreSQL ENUM 등)을 쓰지 않는다. 열거형은 VARCHAR + `models/enums.py`.
- `alembic/env.py` 가 SQLite 일 때 `render_as_batch=True` 를 켠다(SQLite 의 빈약한 ALTER TABLE 우회).
- NULL 정렬 위치가 다르므로 `nulls_last()` 를 명시한다.
- `alembic.ini` 는 시스템 로캘 인코딩으로 읽히므로 **ASCII 만** 넣는다(한국어 Windows 의 cp949 에서 깨진다).

## 구조

```
app/
  core/       설정, 비밀번호 해싱/JWT, 장치 채널 암호화
  db/         엔진·세션, 선언적 베이스, 부트스트랩
  models/     SQLAlchemy 모델 (요구사항의 Entity 정의)
  schemas/    Pydantic 입출력 스키마 (content.py = 콘텐츠 JSON 계약)
  services/   도메인 로직 — 권한 판정, 기관 트리, 장치 고유번호,
              스케줄 버전, 위젯 레지스트리, WebSocket 허브
  api/v1/     라우터 (auth, organizations, users, devices, schedules,
              boards, widgets, player, ws)
```

## 장치 통신

### 1. 인증 (제한사항 3)

```
POST /api/v1/player/provision  { "device_code": "K7QM-3RT-9XZ" }
  -> { device_token, ws_url, schedule_version, heartbeat_interval_sec, ... }
```

이후 REST 는 `X-Device-Token` 헤더, WebSocket 은 `?token=` 쿼리로 인증한다.

### 2. 암호화 (제한사항 2)

WebSocket 핸드셰이크 이후 **모든 메시지가 암호화**된다. 평문 JSON 을 보내면 서버가
연결을 끊는다(close code 4400).

```
키   HKDF-SHA256(DEVICE_MASTER_KEY, salt=장치고유번호, info="signallink-device-channel-v1") -> 32 byte
암호 AES-256-GCM, AAD = 장치고유번호
형식 base64( VERSION(1) || nonce(12) || ciphertext || tag(16) )
```

클라이언트 구현 대응:

| 스택         | 키 유도                                         | 암복호화                    |
| ---------- | -------------------------------------------- | ----------------------- |
| JavaScript | `crypto.subtle.deriveBits({name:'HKDF'})`    | `crypto.subtle` AES-GCM |
| .NET       | `System.Security.Cryptography.HKDF`          | `AesGcm`                |
| Flutter    | `package:cryptography` `Hkdf(Hmac.sha256())` | `AesGcm.with256bits()`  |

### 3. 하트비트 동기화 (제한사항 5)

장치는 자신이 재생 중인 `schedule_version` 을 하트비트에 실어 보내고, 서버는 현재
버전과 비교해 `schedule_changed` 를 응답한다. `true` 면 장치가
`GET /player/schedule` 로 스케줄을 다시 받는다.

CMS 에서 스케줄을 바꾸면 서버가 접속 중인 장치에 `schedule_changed` 를 즉시 푸시하지만,
이는 지연을 줄이기 위한 보조 수단이고 **정본은 하트비트**다. 푸시가 유실돼도 다음
하트비트에서 복구된다.

### 4. 데모 (제한사항 6)

`Device.schedule_id` 가 NULL 이면 서버가 기본 데모 페이로드를 합성해 내려준다
(`services/schedule_service.build_demo_payload`). 장치는 데모인지 아닌지 신경 쓰지 않고
같은 형식의 페이로드를 렌더링하면 된다.

## 응답 시간 (제한사항 4)

모든 응답에 `X-Process-Time-Ms` 헤더가 붙고, `/player/*` 가 200ms 를 넘으면 경고 로그가 남는다.

현재 `/player/schedule` 은 인덱스 조회 + 직렬화뿐이다(로컬 실측 5ms 내외). 장치 수가 늘어
임계를 넘기 시작하면 다음 순서로 확장한다.

1. 스케줄 페이로드를 `schedule:{id}:{version}` 키로 캐시 — 페이로드가 버전으로 불변이라

   무효화가 단순하다.
2. uvicorn 워커 증설 + 로드밸런서. 이때 `services/ws_hub.py` 가 프로세스 로컬이므로

   서버 푸시를 Redis Pub/Sub 등으로 중계해야 한다(라우터가 `ws_hub` 함수만 호출하도록
   막아 두어 교체 지점이 좁다).
3. 읽기 전용 복제본으로 스케줄 조회 분리.

## 권한 규칙

`services/permissions.py` 한 곳에 모여 있다. 라우터는 역할 문자열을 직접 비교하지 않는다.

| 역할               | 범위                          |
| ---------------- | --------------------------- |
| SUPER_ADMIN      | 전체                          |
| ORG_ADMIN        | 자기 기관 + 모든 하위 기관의 기관/사용자/장치 |
| DEVICE_MANAGER   | 위임받은 장치만 (등록/삭제는 불가)        |
| HOMEROOM_TEACHER | 자기 기관 장치 조회 + 위임받은 장치 관리    |
| MEMBER           | 기본 역할, 본인 정보만               |