/**
 * 테스트 모드용 시드 데이터.
 *
 * 백엔드의 부트스트랩(최상위 기관 + 슈퍼관리자)과 같은 상태에서 출발해,
 * 화면을 둘러보기 충분한 만큼의 기관/사용자/장치/스케줄을 얹었다.
 */

/**
 * 로그인 화면의 빠른 채우기 버튼용 계정.
 *
 * 라벨은 역할 코드로 두어 화면에서 번역한다. 기관명은 시드 데이터의 고유명사라
 * 번역하지 않는다.
 */
export const TEST_ACCOUNTS = [
  { user_id: 'admin', password: 'admin1234', role: 'SUPER_ADMIN', orgLabel: null },
  { user_id: 'edu_admin', password: 'test1234', role: 'ORG_ADMIN', orgLabel: '서울특별시교육청' },
  { user_id: 'school_admin', password: 'test1234', role: 'ORG_ADMIN', orgLabel: '가나초등학교' },
  { user_id: 'device_mgr', password: 'test1234', role: 'DEVICE_MANAGER', orgLabel: null },
  { user_id: 'teacher', password: 'test1234', role: 'HOMEROOM_TEACHER', orgLabel: null },
]

export function createSeed() {
  const organizations = [
    { id: 1, name: '최상위 기관', parent_id: null, org_type: '기관', school_level: null, address: null, latitude: null, longitude: null, edu_office_code: null, school_code: null },
    { id: 2, name: '서울특별시교육청', parent_id: 1, org_type: '기관', school_level: null, address: '서울특별시 종로구 송월길 48', latitude: 37.5709, longitude: 126.9633, edu_office_code: 'B10', school_code: null },
    { id: 3, name: '가나초등학교', parent_id: 2, org_type: '학교', school_level: '초', address: '서울특별시 종로구 자하문로 100', latitude: 37.58, longitude: 126.97, edu_office_code: 'B10', school_code: '7010001' },
    { id: 4, name: '다라중학교', parent_id: 2, org_type: '학교', school_level: '중', address: '서울특별시 중구 세종대로 110', latitude: 37.5665, longitude: 126.978, edu_office_code: 'B10', school_code: '7010002' },
    { id: 5, name: '부산광역시교육청', parent_id: 1, org_type: '기관', school_level: null, address: '부산광역시 부산진구 화지로 12', latitude: 35.1631, longitude: 129.0567, edu_office_code: 'C10', school_code: null },
  ]

  const users = [
    { id: 1, user_id: 'admin', password: 'admin1234', name: '시스템 관리자', org_id: 1, phone: null, email: null, status: '승인', roles: ['MEMBER', 'SUPER_ADMIN'] },
    { id: 2, user_id: 'edu_admin', password: 'test1234', name: '박교육', org_id: 2, phone: '010-1111-2222', email: 'edu@example.kr', status: '승인', roles: ['MEMBER', 'ORG_ADMIN'] },
    { id: 3, user_id: 'school_admin', password: 'test1234', name: '김교장', org_id: 3, phone: '010-3333-4444', email: 'principal@example.kr', status: '승인', roles: ['MEMBER', 'ORG_ADMIN'] },
    { id: 4, user_id: 'device_mgr', password: 'test1234', name: '이기사', org_id: 3, phone: '010-5555-6666', email: null, status: '승인', roles: ['MEMBER', 'DEVICE_MANAGER'] },
    { id: 5, user_id: 'teacher', password: 'test1234', name: '최담임', org_id: 3, phone: null, email: null, status: '승인', roles: ['MEMBER', 'HOMEROOM_TEACHER'] },
    { id: 6, user_id: 'newbie', password: 'test1234', name: '신규가입자', org_id: 3, phone: null, email: null, status: '미승인', roles: ['MEMBER'] },
    { id: 7, user_id: 'waiting', password: 'test1234', name: '승인대기', org_id: 4, phone: null, email: null, status: '미승인', roles: ['MEMBER'] },
  ]

  const contents = [
    {
      id: 1,
      name: '아침 알림판',
      description: '등교 시간대 공지 + 급식',
      org_id: 3,
      created_by: 3,
      width: 1920,
      height: 1080,
      version: 4,
      created_at: '2026-03-02T09:00:00Z',
      updated_at: '2026-08-20T11:20:00Z',
      document: {
        version: 1,
        layout: { width: 1920, height: 1080, background: '#0f172a' },
        elements: [
          { id: 'e1', type: 'text', rect: { x: 120, y: 100, w: 1680, h: 140, z: 1 }, opacity: 1, options: { text: '가나초등학교 알림판', fontSize: 96, color: '#ffffff', align: 'center', bold: true } },
          { id: 'e2', type: 'widget', widget_key: 'notice', rect: { x: 120, y: 300, w: 820, h: 600, z: 1 }, opacity: 1, options: { count: 5, title: '공지사항' } },
          { id: 'e3', type: 'widget', widget_key: 'meal', rect: { x: 980, y: 300, w: 820, h: 600, z: 1 }, opacity: 1, options: {} },
        ],
      },
    },
    {
      id: 2,
      name: '학사일정 화면',
      description: '오후 시간대',
      org_id: 3,
      created_by: 3,
      width: 1920,
      height: 1080,
      version: 2,
      created_at: '2026-03-02T09:10:00Z',
      updated_at: '2026-06-11T04:00:00Z',
      document: {
        version: 1,
        layout: { width: 1920, height: 1080, background: '#111827' },
        elements: [
          { id: 'e4', type: 'widget', widget_key: 'school_calendar', rect: { x: 160, y: 200, w: 1600, h: 700, z: 1 }, opacity: 1, options: {} },
        ],
      },
    },
    {
      id: 3,
      name: '가을 운동회 안내 (세로)',
      description: '키오스크용 세로 화면',
      org_id: 3,
      created_by: 3,
      width: 1080,
      height: 1920,
      version: 1,
      created_at: '2026-05-11T02:00:00Z',
      updated_at: '2026-05-11T02:00:00Z',
      document: {
        version: 1,
        layout: { width: 1080, height: 1920, background: '#1e1b4b' },
        elements: [
          { id: 'e5', type: 'text', rect: { x: 90, y: 700, w: 900, h: 200, z: 1 }, opacity: 1, options: { text: '가을 운동회', fontSize: 110, color: '#fde68a', align: 'center', bold: true } },
          { id: 'e6', type: 'widget', widget_key: 'dday', rect: { x: 240, y: 950, w: 600, h: 220, z: 1 }, opacity: 1, options: { label: '운동회', target_date: '2026-10-15' } },
        ],
      },
    },
    {
      id: 4,
      name: '점심시간 명언',
      description: null,
      org_id: 3,
      created_by: 4,
      width: 1920,
      height: 1080,
      version: 1,
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T00:00:00Z',
      document: {
        version: 1,
        layout: { width: 1920, height: 1080, background: '#052e16' },
        elements: [
          { id: 'e7', type: 'widget', widget_key: 'quote', rect: { x: 260, y: 420, w: 1400, h: 240, z: 1 }, opacity: 1, options: {} },
        ],
      },
    },
  ]

  const schedules = [
    {
      id: 1,
      name: '평일 기본 스케줄',
      kind: '시간지정',
      // 참조하는 콘텐츠(1, 2, 4)가 전부 1920×1080 이라 가로형이어야 한다.
      orientation: 'LANDSCAPE',
      // 기간 제한 없음 — 평상시 스케줄이다.
      start_at: null,
      end_at: null,
      org_id: 3,
      created_by: 3,
      version: 3,
      created_at: '2026-03-02T09:00:00Z',
      updated_at: '2026-08-20T11:20:00Z',
      // 주간 편집기가 그리는 형태: 요일 × 시간 블록이 콘텐츠를 참조한다.
      items: [
        { id: 1, schedule_id: 1, day_of_week: 0, start_time: '08:00:00', end_time: '12:00:00', sort_order: 0, duration_sec: 20, content_id: 1, content: {} },
        { id: 2, schedule_id: 1, day_of_week: 0, start_time: '12:00:00', end_time: '17:00:00', sort_order: 1, duration_sec: 20, content_id: 2, content: {} },
        { id: 3, schedule_id: 1, day_of_week: 1, start_time: '08:00:00', end_time: '12:00:00', sort_order: 2, duration_sec: 20, content_id: 1, content: {} },
        { id: 4, schedule_id: 1, day_of_week: 1, start_time: '12:00:00', end_time: '13:00:00', sort_order: 3, duration_sec: 20, content_id: 4, content: {} },
        { id: 5, schedule_id: 1, day_of_week: 2, start_time: '08:00:00', end_time: '12:00:00', sort_order: 4, duration_sec: 20, content_id: 1, content: {} },
        { id: 6, schedule_id: 1, day_of_week: 3, start_time: '09:00:00', end_time: '15:00:00', sort_order: 5, duration_sec: 20, content_id: 2, content: {} },
        { id: 7, schedule_id: 1, day_of_week: 4, start_time: '08:00:00', end_time: '12:00:00', sort_order: 6, duration_sec: 20, content_id: 1, content: {} },
      ],
    },
    {
      id: 2,
      name: '행사 안내 (목록반복)',
      kind: '목록반복',
      // 세로 콘텐츠(3)를 쓰고, 이 스케줄이 배정된 장치도 세로 키오스크다.
      orientation: 'PORTRAIT',
      // 행사 기간에만 나가는 스케줄. 기간이 지나면 배정돼 있어도 표출되지 않는다.
      // '지금은 기간 밖' 전제를 테스트가 쓰므로, 달력이 지나도 썩지 않게
      // 언제나 미래가 되는 상대 날짜로 만든다.
      start_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      end_at: new Date(Date.now() + 60 * 86_400_000).toISOString(),
      org_id: 3,
      created_by: 3,
      version: 1,
      created_at: '2026-05-11T02:00:00Z',
      updated_at: '2026-05-11T02:00:00Z',
      // 요일 미지정(-1) 아이템. 주간 편집기 표에는 놓을 수 없어 별도로 안내된다.
      items: [
        { id: 8, schedule_id: 2, day_of_week: -1, start_time: null, end_time: null, sort_order: 0, duration_sec: 15, content_id: 3, content: {} },
      ],
    },
  ]

  const devices = [
    { id: 1, org_id: 3, device_code: 'K7QM-3RT-9XZ', name: '본관 1층 로비', os: 'Windows', form_factor: 'DID형', panel_type: 'LANDSCAPE', width: 1920, height: 1080, place_name: '본관 로비', place_kind: '기타', device_kind: '일반', grade: null, class_no: null, class_name: null, track: null, is_master: true, cpu: 'Intel N100', memory: '8GB', storage: '256GB', storage_total_bytes: 256000000000, storage_free_bytes: 40000000000, storage_reported_at: '2026-08-30T01:12:00Z', screenshot_at: '2026-08-30T01:12:00Z', schedule_ids: [1], version: 3, last_seen_at: '2026-08-30T01:12:00Z', app_version: '1.2.0', online: true },
    { id: 2, org_id: 3, device_code: 'P4WD-8HN-2KB', name: '3학년 2반 교실', os: 'Android', form_factor: 'DID형', panel_type: 'LANDSCAPE', width: 1920, height: 1080, place_name: '3학년 2반', place_kind: '교실', device_kind: '전자칠판', grade: 3, class_no: 2, class_name: '3학년 2반', track: null, is_master: false, cpu: 'RK3588', memory: '4GB', storage: '64GB', storage_total_bytes: 64000000000, storage_free_bytes: 30000000000, storage_reported_at: '2026-08-30T01:12:00Z', screenshot_at: '2026-08-30T01:10:00Z', schedule_ids: [1], version: 3, last_seen_at: '2026-08-30T01:10:00Z', app_version: '1.2.0', online: true },
    { id: 3, org_id: 3, device_code: 'T2JX-5FQ-7MD', name: '급식실 입구 키오스크', os: 'Windows', form_factor: '키오스크형', panel_type: 'PORTRAIT', width: 1080, height: 1920, place_name: '급식실', place_kind: '기타', device_kind: '일반', grade: null, class_no: null, class_name: null, track: null, is_master: false, cpu: 'Intel N95', memory: '8GB', storage: '128GB', storage_total_bytes: 128000000000, storage_free_bytes: 60000000000, storage_reported_at: '2026-08-30T01:12:00Z', screenshot_at: null, schedule_ids: [2], version: 1, last_seen_at: '2026-08-29T22:41:00Z', app_version: '1.1.4', online: false },
    { id: 4, org_id: 3, device_code: 'W9BC-6VL-4NH', name: '체육관 대형 DID', os: 'Android', form_factor: 'DID형', panel_type: 'LANDSCAPE', width: 3840, height: 2160, place_name: '체육관', place_kind: '기타', device_kind: '일반', grade: null, class_no: null, class_name: null, track: null, is_master: false, cpu: 'RK3588', memory: '8GB', storage: '128GB', storage_total_bytes: null, storage_free_bytes: null, storage_reported_at: null, screenshot_at: null, schedule_ids: [], version: 0, last_seen_at: null, app_version: null, online: false },
    { id: 5, org_id: 4, device_code: 'M3ZP-9DK-8TR', name: '다라중 현관 DID', os: 'Windows', form_factor: 'DID형', panel_type: 'LANDSCAPE', width: 1920, height: 1080, place_name: '현관', place_kind: '기타', device_kind: '일반', grade: null, class_no: null, class_name: null, track: null, is_master: true, cpu: 'Intel N100', memory: '8GB', storage: '256GB', storage_total_bytes: 256000000000, storage_free_bytes: 200000000000, storage_reported_at: '2026-08-30T01:12:00Z', screenshot_at: '2026-08-30T00:55:00Z', schedule_ids: [], version: 0, last_seen_at: '2026-08-30T00:55:00Z', app_version: '1.2.0', online: true },
    ...generateClassroomDevices(),
  ]

  // 장치 관리 위임: 이기사(4)에게 1번, 2번 장치를 위임했다.
  const deviceManagers = [
    { device_id: 1, user_id: 4 },
    { device_id: 2, user_id: 4 },
  ]

  const boards = [
    { id: 1, org_id: 3, kind: '게시판', url: 'https://gana.sen.es.kr/notice', scrape_method: 'html:table', scrape_result: '성공', scrape_count: 42, last_scraped_at: '2026-08-30T00:00:00Z' },
    { id: 2, org_id: 3, kind: '급식메뉴', url: 'https://open.neis.go.kr/mealServiceDietInfo', scrape_method: 'neis-api', scrape_result: '성공', scrape_count: 180, last_scraped_at: '2026-08-30T00:00:00Z' },
    { id: 3, org_id: 3, kind: '일정', url: 'https://open.neis.go.kr/SchoolSchedule', scrape_method: 'neis-api', scrape_result: '실패', scrape_count: 0, last_scraped_at: '2026-08-29T00:00:00Z' },
  ]

  const posts = [
    { id: 1, board_id: 1, title: '2학기 학부모 상담 주간 안내', author: '교무부', posted_on: '2026-08-28', year: 2026, month: 8, day: 28, term: 2, content: '9월 8일부터 12일까지 진행합니다.' },
    { id: 2, board_id: 1, title: '가을 운동회 개최 안내', author: '체육부', posted_on: '2026-08-25', year: 2026, month: 8, day: 25, term: 2, content: '10월 15일 운동장에서 진행합니다.' },
    { id: 3, board_id: 1, title: '독서 골든벨 참가 신청', author: '도서부', posted_on: '2026-08-20', year: 2026, month: 8, day: 20, term: 2, content: null },
  ]

  // 위젯 재생목록. 콘텐츠 편집기에서 한 요소로 놓으면 위젯들이 차례로 바뀐다.
  const playlists = [
    {
      id: 1,
      name: '현관 순환',
      description: '공지 → 급식 → 시간표',
      org_id: 3,
      created_by: 3,
      version: 2,
      created_at: '2026-03-02T09:00:00Z',
      updated_at: '2026-08-20T11:20:00Z',
      items: [
        // 전환 효과를 섞어 둔다. 하나라도 걸려 있어야 미리보기에서 바로 보인다.
        { id: 1, sort_order: 0, widget_key: 'notice', duration_sec: 15, options: { count: 5 }, transition: 'fade', transition_ms: 600 },
        { id: 2, sort_order: 1, widget_key: 'meal', duration_sec: 10, options: {}, transition: 'slide-left', transition_ms: 900 },
        { id: 3, sort_order: 2, widget_key: 'timetable', duration_sec: 10, options: {}, transition: 'none', transition_ms: 600 },
      ],
    },
  ]

  // 장치그룹은 사용자 개인의 묶음이다. 관리자 계정(id=1) 것만 하나 넣어 둔다.
  const deviceGroups = [
    { id: 1, name: '본관 1층', user_id: 1, device_ids: [1, 3] },
  ]

  // 올린 파일. 테스트 모드에서는 실제 바이너리가 없어 비워 둔다 —
  // 화면에서 '올린 뒤 바로 쓰는' 흐름만 확인할 수 있으면 된다.
  const assets = []

  return {
    assets,
    organizations,
    users,
    contents,
    schedules,
    devices,
    deviceManagers,
    deviceGroups,
    playlists,
    boards,
    posts,
  }
}

/**
 * 테스트 모드용 가짜 화면 캡처.
 *
 * 실제 장치가 없으므로 장치명과 배정된 스케줄을 그린 SVG 를 데이터 URL 로
 * 만들어 준다. 카드 가운데 자리가 비어 보이지 않아야 배치를 확인할 수 있다.
 */
/**
 * 교실 장치 45대.
 *
 * 손으로 적은 5대만으로는 장치가 많을 때의 화면을 확인할 수 없다. 실제 학교
 * 규모(학년 6 x 반 8 안팎)를 흉내 내되, 화면이 다뤄야 하는 상태가 골고루
 * 섞이도록 만든다 — 오프라인, 세로 장치, 캡처 없음, 저장공간 경고, 스케줄
 * 미배정. 한 가지 상태만 잔뜩 있으면 그 상태에서만 멀쩡한 화면이 된다.
 *
 * 값은 id 로부터 결정되므로 새로고침해도 같은 화면이 나온다. 무작위로 만들면
 * 화면이 이상할 때 그 상태를 다시 만들 수 없다.
 */
function generateClassroomDevices() {
  const GB = 1000 ** 3
  const devices = []

  for (let index = 0; index < 45; index += 1) {
    const id = 100 + index
    const grade = Math.floor(index / 8) + 1
    const classNo = (index % 8) + 1
    // 7대 중 2대꼴로 오프라인. 온라인만 있으면 잠긴 제어 버튼을 볼 수 없다.
    const online = index % 7 > 1
    const portrait = index % 9 === 4
    // 5대 중 1대는 저장공간 경고(85%), 11대 중 1대는 아직 보고 없음.
    const unreported = index % 11 === 3
    const nearlyFull = index % 5 === 2
    const total = portrait ? 128 * GB : 256 * GB

    devices.push({
      id,
      org_id: 3,
      device_code: `C${String(grade)}${String(classNo).padStart(2, '0')}-${String(id)}-DID`,
      name: `${grade}학년 ${classNo}반`,
      os: index % 3 === 0 ? 'Windows' : 'Android',
      form_factor: portrait ? '키오스크형' : 'DID형',
      panel_type: portrait ? 'PORTRAIT' : 'LANDSCAPE',
      width: portrait ? 1080 : 1920,
      height: portrait ? 1920 : 1080,
      place_name: `${grade}학년 ${classNo}반`,
      place_kind: '교실',
      device_kind: index % 4 === 0 ? '전자칠판' : '일반',
      grade,
      class_no: classNo,
      class_name: `${grade}학년 ${classNo}반`,
      track: null,
      is_master: false,
      cpu: index % 3 === 0 ? 'Intel N100' : 'RK3588',
      memory: index % 2 === 0 ? '8GB' : '4GB',
      storage: portrait ? '128GB' : '256GB',
      storage_total_bytes: unreported ? null : total,
      storage_free_bytes: unreported ? null : Math.round(total * (nearlyFull ? 0.15 : 0.55)),
      storage_reported_at: unreported ? null : '2026-08-30T01:12:00Z',
      // 캡처가 없는 장치도 섞는다. 카드 가운데가 비었을 때의 배치를 봐야 한다.
      screenshot_at: online && index % 6 !== 5 ? '2026-08-30T01:12:00Z' : null,
      schedule_ids: index % 13 === 6 ? [] : [1],
      version: 3,
      last_seen_at: online ? '2026-08-30T01:12:00Z' : '2026-08-29T20:00:00Z',
      app_version: index % 10 === 7 ? '1.1.4' : '1.2.0',
      online,
    })
  }
  return devices
}

export function mockScreenshot(device, scheduleName) {
  const portrait = device.panel_type === 'PORTRAIT'
  const [w, h] = portrait ? [270, 480] : [480, 270]
  const title = device.name ?? ''
  const subtitle = scheduleName ?? '데모 화면'

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="100%" height="100%" fill="#0f172a"/>
    <text x="50%" y="44%" fill="#e2e8f0" font-family="sans-serif" font-size="${portrait ? 20 : 26}"
          font-weight="700" text-anchor="middle">${escapeXml(title)}</text>
    <text x="50%" y="56%" fill="#64748b" font-family="sans-serif" font-size="${portrait ? 13 : 15}"
          text-anchor="middle">${escapeXml(subtitle)}</text>
  </svg>`

  // 한글이 들어가므로 encodeURIComponent 로 감싼다. base64 로 만들면 btoa 가 터진다.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function escapeXml(value) {
  return String(value).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])
}

/**
 * 테스트 모드용 가짜 사진.
 *
 * 실제 Pixabay 를 부르지 않는다 — 키도 없고 폐쇄망일 수도 있다. 검색어를
 * 적어 넣은 SVG 를 돌려주어, 편집기가 결과를 어떻게 배치하는지는 볼 수 있게 한다.
 */
export function mockPhoto(label, portrait, size) {
  const [w, h] = portrait ? [Math.round(size * 0.66), size] : [size, Math.round(size * 0.66)]
  // 검색어마다 다른 색이라야 여러 장을 늘어놓았을 때 구분된다.
  const hue = [...String(label)].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="100%" height="100%" fill="hsl(${hue} 45% 55%)"/>
    <text x="50%" y="52%" fill="#ffffff" font-family="sans-serif" font-size="${Math.round(w / 12)}"
          text-anchor="middle">${escapeXml(label)}</text>
  </svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
