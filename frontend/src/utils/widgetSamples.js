/**
 * 편집기 미리보기용 위젯 샘플 데이터.
 *
 * 편집기에서 위젯을 회색 네모로만 보여 주면 배치가 맞는지, 글자가 넘치는지
 * 판단할 수 없다. 그래서 실제 표출과 비슷한 내용을 채워 그린다.
 *
 * **이 데이터는 편집기 화면에만 쓴다.** 실제 표출은 플레이어가
 * ``GET /api/v1/widgets/{key}/data`` 로 받은 진짜 데이터를 그린다.
 * 여기 값을 바꿔도 장치에 나가는 내용은 달라지지 않는다.
 */

import { ref } from 'vue'

const SAMPLES = {
  notice: {
    ko: [
      { title: '2학기 학부모 상담 주간 안내', author: '교무부', date: '08-28' },
      { title: '가을 운동회 개최 안내', author: '체육부', date: '08-25' },
      { title: '독서 골든벨 참가 신청', author: '도서부', date: '08-20' },
      { title: '9월 방과후학교 수강 신청', author: '교육과정부', date: '08-18' },
      { title: '교통안전 교육 실시 안내', author: '생활안전부', date: '08-14' },
    ],
    en: [
      { title: 'Parent–teacher meeting week', author: 'Academic office', date: '08-28' },
      { title: 'Autumn sports day', author: 'PE department', date: '08-25' },
      { title: 'Reading quiz sign-up', author: 'Library', date: '08-20' },
      { title: 'September after-school classes', author: 'Curriculum office', date: '08-18' },
      { title: 'Road safety training', author: 'Student safety', date: '08-14' },
    ],
    ja: [
      { title: '2学期 保護者面談週間のご案内', author: '教務部', date: '08-28' },
      { title: '秋の運動会 開催のお知らせ', author: '体育部', date: '08-25' },
      { title: '読書クイズ大会 参加申込', author: '図書部', date: '08-20' },
      { title: '9月の放課後教室 受講申込', author: '教育課程部', date: '08-18' },
      { title: '交通安全教育 実施のご案内', author: '生活安全部', date: '08-14' },
    ],
    zh: [
      { title: '第二学期家长面谈周通知', author: '教务处', date: '08-28' },
      { title: '秋季运动会举办通知', author: '体育组', date: '08-25' },
      { title: '读书竞赛报名', author: '图书馆', date: '08-20' },
      { title: '九月课后班报名', author: '课程处', date: '08-18' },
      { title: '交通安全教育通知', author: '安全处', date: '08-14' },
    ],
  },
  newsletter: {
    ko: [
      { title: '제12호 가정통신문 - 9월 급식 안내', author: '영양교사', date: '08-30' },
      { title: '제11호 가정통신문 - 학교폭력 예방', author: '상담부', date: '08-22' },
      { title: '제10호 가정통신문 - 여름방학 생활', author: '교무부', date: '07-18' },
      { title: '제9호 가정통신문 - 학부모 총회', author: '교무부', date: '07-05' },
    ],
    en: [
      { title: 'No. 12 — September meal plan', author: 'Nutrition teacher', date: '08-30' },
      { title: 'No. 11 — Bullying prevention', author: 'Counseling', date: '08-22' },
      { title: 'No. 10 — Summer break guide', author: 'Academic office', date: '07-18' },
      { title: 'No. 9 — Parents’ assembly', author: 'Academic office', date: '07-05' },
    ],
    ja: [
      { title: '第12号 おたより — 9月の給食案内', author: '栄養教諭', date: '08-30' },
      { title: '第11号 おたより — いじめ防止', author: '相談室', date: '08-22' },
      { title: '第10号 おたより — 夏休みの過ごし方', author: '教務部', date: '07-18' },
      { title: '第9号 おたより — 保護者総会', author: '教務部', date: '07-05' },
    ],
    zh: [
      { title: '第12期家长信 — 九月配餐安排', author: '营养教师', date: '08-30' },
      { title: '第11期家长信 — 预防校园欺凌', author: '心理咨询室', date: '08-22' },
      { title: '第10期家长信 — 暑假生活指导', author: '教务处', date: '07-18' },
      { title: '第9期家长信 — 家长大会', author: '教务处', date: '07-05' },
    ],
  },
  school_calendar: {
    ko: [
      { day: 2, title: '2학기 개학식' },
      { day: 8, title: '학부모 상담 주간 시작' },
      { day: 15, title: '체육대회 예선' },
      { day: 22, title: '중간고사 (1일차)' },
      { day: 28, title: '현장체험학습' },
    ],
    en: [
      { day: 2, title: 'Second semester begins' },
      { day: 8, title: 'Parent meeting week' },
      { day: 15, title: 'Sports day heats' },
      { day: 22, title: 'Midterm exams (day 1)' },
      { day: 28, title: 'Field trip' },
    ],
    ja: [
      { day: 2, title: '2学期 始業式' },
      { day: 8, title: '保護者面談週間 開始' },
      { day: 15, title: '体育大会 予選' },
      { day: 22, title: '中間試験（1日目）' },
      { day: 28, title: '校外学習' },
    ],
    zh: [
      { day: 2, title: '第二学期开学典礼' },
      { day: 8, title: '家长面谈周开始' },
      { day: 15, title: '运动会预赛' },
      { day: 22, title: '期中考试（第一天）' },
      { day: 28, title: '社会实践' },
    ],
  },
  meal: {
    ko: {
      title: '오늘의 급식',
      dishes: ['찰보리밥', '쇠고기무국', '돈육김치볶음', '가지나물', '배추김치', '요구르트'],
      calories: '682 kcal',
    },
    en: {
      title: "Today's lunch",
      dishes: [
        'Barley rice',
        'Beef radish soup',
        'Stir-fried pork kimchi',
        'Seasoned eggplant',
        'Cabbage kimchi',
        'Yogurt',
      ],
      calories: '682 kcal',
    },
    ja: {
      title: '本日の給食',
      dishes: ['麦ごはん', '牛肉と大根のスープ', '豚キムチ炒め', 'なすのナムル', '白菜キムチ', 'ヨーグルト'],
      calories: '682 kcal',
    },
    zh: {
      title: '今日配餐',
      dishes: ['大麦饭', '牛肉萝卜汤', '辣白菜炒猪肉', '凉拌茄子', '辣白菜', '酸奶'],
      calories: '682 kcal',
    },
  },
  timetable: {
    ko: {
      heading: '3학년 2반 시간표',
      days: ['월', '화', '수', '목', '금'],
      periods: ['1교시', '2교시', '3교시', '4교시', '5교시', '6교시'],
      subjects: ['국어', '수학', '과학', '영어', '체육', '음악', '미술', '사회', '창체'],
    },
    en: {
      heading: 'Grade 3 Class 2',
      days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      periods: ['1st', '2nd', '3rd', '4th', '5th', '6th'],
      subjects: [
        'Korean',
        'Math',
        'Science',
        'English',
        'PE',
        'Music',
        'Art',
        'Social',
        'Activity',
      ],
    },
    ja: {
      heading: '3年2組 時間割',
      days: ['月', '火', '水', '木', '金'],
      periods: ['1限', '2限', '3限', '4限', '5限', '6限'],
      subjects: ['国語', '数学', '理科', '英語', '体育', '音楽', '美術', '社会', '総合'],
    },
    zh: {
      heading: '三年二班课程表',
      days: ['一', '二', '三', '四', '五'],
      periods: ['第1节', '第2节', '第3节', '第4节', '第5节', '第6节'],
      subjects: ['语文', '数学', '科学', '英语', '体育', '音乐', '美术', '社会', '综合'],
    },
  },
  dday: {
    ko: { label: '가을 운동회', days: 46, date: '2026-10-15' },
    en: { label: 'Autumn sports day', days: 46, date: '2026-10-15' },
    ja: { label: '秋の運動会', days: 46, date: '2026-10-15' },
    zh: { label: '秋季运动会', days: 46, date: '2026-10-15' },
  },
  painting: {
    ko: { title: '별이 빛나는 밤', artist: '빈센트 반 고흐', year: '1889' },
    en: { title: 'The Starry Night', artist: 'Vincent van Gogh', year: '1889' },
    ja: { title: '星月夜', artist: 'フィンセント・ファン・ゴッホ', year: '1889' },
    zh: { title: '星月夜', artist: '文森特·梵高', year: '1889' },
  },
  quote: {
    ko: { text: '오늘 걷지 않으면 내일은 뛰어야 한다.', author: '속담' },
    en: { text: 'If you do not walk today, you must run tomorrow.', author: 'Proverb' },
    ja: { text: '今日歩かなければ、明日は走ることになる。', author: 'ことわざ' },
    zh: { text: '今天不走，明天就得跑。', author: '谚语' },
  },
  english_word: {
    ko: {
      word: 'diligent',
      pronunciation: '[ˈdɪlɪdʒənt]',
      meaning: '부지런한, 성실한',
      example: 'She is a diligent student.',
    },
    en: {
      word: 'diligent',
      pronunciation: '[ˈdɪlɪdʒənt]',
      meaning: 'hard-working and careful',
      example: 'She is a diligent student.',
    },
    ja: {
      word: 'diligent',
      pronunciation: '[ˈdɪlɪdʒənt]',
      meaning: '勤勉な、真面目な',
      example: 'She is a diligent student.',
    },
    zh: {
      word: 'diligent',
      pronunciation: '[ˈdɪlɪdʒənt]',
      meaning: '勤奋的，认真的',
      example: 'She is a diligent student.',
    },
  },
  english_idiom: {
    ko: {
      word: 'hit the books',
      meaning: '공부에 열중하다',
      example: 'I need to hit the books tonight.',
    },
    en: {
      word: 'hit the books',
      meaning: 'to study hard',
      example: 'I need to hit the books tonight.',
    },
    ja: {
      word: 'hit the books',
      meaning: '猛勉強する',
      example: 'I need to hit the books tonight.',
    },
    zh: {
      word: 'hit the books',
      meaning: '用功读书',
      example: 'I need to hit the books tonight.',
    },
  },
  weather: {
    ko: {
      place: '서울 종로구', temp: '24°', condition: '맑음', icon: '☀', high: '27°', low: '19°',
      dust: '보통', pm10: 45,
    },
    en: {
      place: 'Jongno, Seoul', temp: '24°', condition: 'Clear', icon: '☀', high: '27°', low: '19°',
      dust: 'Moderate', pm10: 45,
    },
    ja: {
      place: 'ソウル鍾路区', temp: '24°', condition: '晴れ', icon: '☀', high: '27°', low: '19°',
      dust: '普通', pm10: 45,
    },
    zh: {
      place: '首尔钟路区', temp: '24°', condition: '晴', icon: '☀', high: '27°', low: '19°',
      dust: '中等', pm10: 45,
    },
  },
  album: {
    ko: { caption: '가을 운동회 사진 (1/12)' },
    en: { caption: 'Sports day photos (1/12)' },
    ja: { caption: '秋の運動会の写真 (1/12)' },
    zh: { caption: '秋季运动会照片 (1/12)' },
  },
  ai_image: {
    ko: { prompt: '가을 운동장에서 뛰노는 아이들, 수채화풍' },
    en: { prompt: 'Children playing on an autumn field, watercolor' },
    ja: { prompt: '秋のグラウンドで遊ぶ子どもたち、水彩画風' },
    zh: { prompt: '在秋日操场上玩耍的孩子们，水彩画风格' },
  },
}

/** 위젯 샘플. 없는 위젯이면 null(호출부가 기본 자리표시자를 그린다). */
export function widgetSample(key, locale = 'ko') {
  const entry = SAMPLES[key]
  if (!entry) return null
  return entry[locale] ?? entry.ko ?? null
}

/**
 * 시간표 한 주의 과목 배치. 값은 그 언어 `subjects` 의 번호다.
 *
 * 언어마다 배치를 따로 적으면 번역할 때 어긋난다 — 이름만 갈아 끼우고 자리는
 * 하나로 둔다. 줄은 교시, 칸은 요일이다.
 */
const TIMETABLE_LAYOUT = [
  [0, 1, 3, 2, 0],
  [1, 0, 2, 3, 1],
  [3, 2, 0, 1, 7],
  [2, 7, 1, 0, 3],
  [4, 5, 6, 4, 8],
  [6, 4, 5, 8, 4],
]

/**
 * 한 주 시간표를 그릴 수 있는 모양으로 만든다.
 *
 * `[{ period, cells: [과목명 …] }]` — 줄이 교시고 칸이 요일이다. 화면이
 * 이 모양을 그대로 그리면 되도록 여기서 번호를 이름으로 바꿔 둔다.
 */
export function timetableWeek(sample) {
  const days = sample?.days ?? []
  const subjects = sample?.subjects ?? []
  if (days.length === 0 || subjects.length === 0) return []

  return (sample.periods ?? []).map((period, row) => ({
    period,
    cells: days.map((_, column) => {
      const at = TIMETABLE_LAYOUT[row % TIMETABLE_LAYOUT.length][column % days.length]
      return subjects[at % subjects.length]
    }),
  }))
}

/**
 * 오늘이 몇 번째 칸인가. 주말이면 -1.
 *
 * 요일을 이름으로 맞추면 언어마다 다르게 적힌 이름을 다 알아야 한다. 자리로
 * 센다 — 첫 칸이 월요일이라는 것만 지키면 어느 언어에서도 같은 칸을 짚는다.
 */
export function todayColumn(now = new Date(), dayCount = 5) {
  const weekday = now.getDay() // 0 = 일요일
  const at = weekday - 1
  return at >= 0 && at < dayCount ? at : -1
}

export function hasSample(key) {
  return Boolean(SAMPLES[key])
}

/**
 * 미리보기용 공유 시계.
 *
 * 시계 위젯을 여러 개 놓아도 타이머는 하나만 돌린다. 요소마다 setInterval 을
 * 걸면 편집 중에 타이머가 계속 쌓인다.
 */
export const previewNow = ref(new Date())

let timer = null
let subscribers = 0

export function subscribeClock() {
  subscribers += 1
  // 모듈이 로드된 시각이 아니라 '지금'을 먼저 반영한다. 그러지 않으면 시계를
  // 처음 놓을 때 앱을 열어 둔 시간만큼 지난 값이 잠깐 보인다.
  previewNow.value = new Date()
  if (!timer) {
    timer = setInterval(() => {
      previewNow.value = new Date()
    }, 1000)
  }
  return () => {
    subscribers -= 1
    if (subscribers <= 0 && timer) {
      clearInterval(timer)
      timer = null
      subscribers = 0
    }
  }
}

/** 시계 위젯의 형식 옵션(HH:mm 등)을 적용해 문자열로 만든다. */
export function formatClock(date, format = 'HH:mm:ss') {
  const pad = (value) => String(value).padStart(2, '0')
  const map = {
    yyyy: date.getFullYear(),
    MM: pad(date.getMonth() + 1),
    dd: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
  }
  return String(format).replace(/yyyy|MM|dd|HH|mm|ss/g, (token) => map[token])
}

/**
 * 오늘부터 목표 날짜까지 남은 일수.
 *
 * 시각이 아니라 **날짜**로 센다. `new Date(a) - new Date(b)` 로 계산하면
 * "2026-09-11"(UTC 자정)과 로컬 자정이 시간대만큼 어긋나 D-Day 가 하루 밀린다.
 */
export function daysUntil(target, from = new Date()) {
  if (typeof target !== 'string') return null
  const parts = target.split('-').map(Number)
  if (parts.length < 3 || parts.some((value) => !Number.isFinite(value))) return null

  const [year, month, day] = parts
  const targetMidnight = new Date(year, month - 1, day)
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  return Math.round((targetMidnight - fromMidnight) / 86400000)
}

/**
 * 위젯 아이콘.
 *
 * 왼쪽 레일은 이름을 적을 공간이 없어 그림으로 구분한다(이름은 툴팁으로 뜬다).
 * 모르는 위젯도 자리는 차지해야 하므로 기본값을 둔다.
 */
const ICONS = {
  notice: '📢',
  newsletter: '📄',
  school_calendar: '📅',
  meal: '🍚',
  timetable: '🗓',
  dday: '⏳',
  painting: '🖼',
  quote: '💬',
  english_word: '🔤',
  english_idiom: '💡',
  clock: '🕐',
  weather: '☀',
  album: '🎞',
  ai_image: '✨',
}

export function widgetIcon(key) {
  return ICONS[key] ?? '◈'
}

/** 기본 요소(위젯이 아닌 것)의 아이콘. */
export const ELEMENT_ICONS = {
  playlist: '🔁',
  text: 'T',
  image: '🏞',
  video: '▶',
  web: '🌐',
}
