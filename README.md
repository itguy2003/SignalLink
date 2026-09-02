# SignalLink Green

DID(디지털 사이니지) 장치 통합 관리 시스템.

기관·사용자·장치·스케줄·콘텐츠를 관리하는 **CMS**와, 배정된 스케줄에 따라 콘텐츠를 표출하는
**플레이어**로 구성된다. 요구사항 정의는 [docs/요구사항.txt](docs/요구사항.txt).

## 구성

| 디렉터리                   | 내용                            | 스택                                         | 상태    |
| ---------------------- | ----------------------------- | ------------------------------------------ | ----- |
| [backend/](backend/)   | CMS API + 플레이어 API + 장치 제어 채널 | FastAPI, SQLAlchemy 2.0, PostgreSQL/SQLite | 구현 완료 |
| [frontend/](frontend/) | CMS 웹 화면                      | Vue 3, Vite, Pinia                         | 구현 완료 |
| —                      | Windows 플레이어                  | .NET, WPF, CommunityToolkit.Mvvm, WebView2 | 미착수   |
| —                      | Android / iOS 플레이어            | Flutter                                    | 미착수   |
| —                      | 브라우저 테스트 플레이어                 | JavaScript                                 | 미착수   |

## 빠르게 띄우기

```bash
# 백엔드
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
cp .env.example .env
.venv/Scripts/python.exe -m uvicorn app.main:app --reload     # http://127.0.0.1:8000/docs

# 프론트엔드 (새 터미널)
cd frontend
npm install
npm run dev                                                   # http://127.0.0.1:5173
```

첫 기동에서 최상위 기관과 슈퍼관리자 계정(`admin` / `admin1234`)이 자동 생성된다.
운영 배포 전에 `.env` 의 `SECRET_KEY` 와 `DEVICE_MASTER_KEY` 를 반드시 교체할 것.

### 백엔드 없이 화면만 보기

```bash
cd frontend && npm run dev:test
```

모의 백엔드가 요청을 처리한다. 로그인 화면의 버튼으로 역할별 테스트 계정을 채울 수 있다
(자세한 내용은 [frontend/README.md](frontend/README.md)).

## 테스트

```bash
cd backend  && .venv/Scripts/python.exe -m pytest   # 69건
cd frontend && npm test                             # 31건
```

## 문서

- [CLAUDE.md](CLAUDE.md) — 아키텍처에서 알아야 할 것, 미구현 항목
- [backend/README.md](backend/README.md) — DB 전환, 장치 통신 규약(플레이어 구현에 필요), 확장 방안
- [frontend/README.md](frontend/README.md) — 화면 목록, 테스트 모드, 콘텐츠 JSON 형식