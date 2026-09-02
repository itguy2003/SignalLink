/**
 * 위젯 미리보기 테스트.
 *
 * 편집기에서 위젯이 회색 네모가 아니라 실제와 비슷한 내용으로 그려지는지 본다.
 */
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'
import WidgetPreview from './WidgetPreview.vue'
import { SUPPORTED_LOCALES } from '@/i18n'
import { formatClock, hasSample, previewNow, widgetSample } from '@/utils/widgetSamples'

function mountPreview(widgetKey, options = {}, props = {}) {
  return mount(WidgetPreview, {
    props: { widgetKey, options, name: widgetKey, width: 700, height: 500, scale: 0.5, ...props },
    global: { plugins: [i18n] },
  })
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
})

describe('샘플 데이터', () => {
  it('요구사항에 나온 위젯들에 샘플이 있다', () => {
    const required = [
      'notice',
      'newsletter',
      'school_calendar',
      'meal',
      'timetable',
      'dday',
      'painting',
      'quote',
      'english_word',
      'english_idiom',
    ]
    for (const key of required) {
      expect(hasSample(key), key).toBe(true)
    }
  })

  it('지원하는 모든 언어의 샘플이 있다', () => {
    // 빠지면 그 언어에서 화면은 번역됐는데 위젯 안만 한국어로 남는다.
    // SUPPORTED_LOCALES 를 그대로 도는 이유는, 언어를 늘렸을 때 이 검사도
    // 함께 늘어나게 하기 위해서다.
    for (const { code } of SUPPORTED_LOCALES) {
      for (const key of ['notice', 'meal', 'timetable', 'weather', 'quote', 'dday']) {
        expect(widgetSample(key, code), `${key}.${code}`).toBeTruthy()
      }
    }
  })

  it('언어마다 다른 문구를 쓴다', () => {
    // 폴백으로 한국어가 그대로 돌아오면 번역한 것이 아니다.
    const titles = SUPPORTED_LOCALES.map(({ code }) => widgetSample('notice', code)[0].title)
    expect(new Set(titles).size).toBe(SUPPORTED_LOCALES.length)
  })

  it('알 수 없는 위젯은 샘플이 없다', () => {
    expect(hasSample('없는위젯')).toBe(false)
    expect(widgetSample('없는위젯')).toBeNull()
  })
})

describe('목록형 위젯', () => {
  it('공지사항을 제목과 작성자로 그린다', () => {
    const wrapper = mountPreview('notice')
    const text = wrapper.text()
    expect(text).toContain('2학기 학부모 상담 주간 안내')
    expect(text).toContain('교무부')
  })

  it('표시 건수 옵션을 따른다', () => {
    const wrapper = mountPreview('notice', { count: 2 })
    expect(wrapper.findAll('.rows li')).toHaveLength(2)
  })

  it('건수가 샘플보다 많아도 있는 만큼만 그린다', () => {
    const wrapper = mountPreview('notice', { count: 99 })
    expect(wrapper.findAll('.rows li').length).toBeLessThanOrEqual(5)
  })

  it('제목 옵션이 있으면 그것을 쓴다', () => {
    const wrapper = mountPreview('notice', { title: '우리 학교 소식' })
    expect(wrapper.find('.pane-title').text()).toBe('우리 학교 소식')
  })
})

describe('내용형 위젯', () => {
  it('급식은 식단과 열량을 보여 준다', () => {
    const wrapper = mountPreview('meal')
    expect(wrapper.findAll('.dishes li').length).toBeGreaterThan(3)
    expect(wrapper.text()).toContain('kcal')
  })

  it('시간표는 한 주를 표로 보여 준다', () => {
    // 하루치만 보여 주면 '내일 뭐 하지' 를 알 수 없다. 복도에 걸린 시간표를
    // 대신하는 위젯이라 한 주가 한눈에 들어와야 한다.
    const wrapper = mountPreview('timetable')

    expect(wrapper.findAll('.tt-day').map((e) => e.text())).toEqual(['월', '화', '수', '목', '금'])
    expect(wrapper.findAll('tbody tr')).toHaveLength(6)
  })

  it('시간표 한 줄에 교시와 요일별 과목이 함께 있다', () => {
    const wrapper = mountPreview('timetable')
    const first = wrapper.findAll('tbody tr')[0]

    expect(first.find('.tt-period').text()).toBe('1교시')
    expect(first.findAll('.tt-cell')).toHaveLength(5)
    expect(first.findAll('.tt-cell')[0].text()).toBe('국어')
  })

  it('학사일정은 날짜와 일정명을 보여 준다', () => {
    const wrapper = mountPreview('school_calendar')
    expect(wrapper.find('.cal-day').text()).toBe('2')
    expect(wrapper.text()).toContain('2학기 개학식')
  })

  it('명언은 인용부호와 출처를 함께 그린다', () => {
    const wrapper = mountPreview('quote')
    expect(wrapper.find('.quote-text').text()).toContain('“')
    expect(wrapper.find('.quote-author').text()).toContain('속담')
  })

  it('영단어는 발음과 뜻, 예문을 보여 준다', () => {
    const wrapper = mountPreview('english_word')
    expect(wrapper.find('.word-main').text()).toBe('diligent')
    expect(wrapper.find('.word-pron').exists()).toBe(true)
    expect(wrapper.find('.word-example').text()).toContain('student')
  })

  it('날씨는 기온과 지역을 보여 준다', () => {
    const wrapper = mountPreview('weather')
    expect(wrapper.find('.weather-temp').text()).toBe('24°')
    expect(wrapper.text()).toContain('서울')
  })
})

describe('D-Day', () => {
  it('샘플 남은 일수를 보여 준다', () => {
    const wrapper = mountPreview('dday')
    expect(wrapper.find('.dday-count').text()).toMatch(/^D-\d+$/)
  })

  it('목표 일자 옵션이 있으면 실제로 계산한다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00'))

    const wrapper = mountPreview('dday', { label: '운동회', target_date: '2026-09-11' })
    expect(wrapper.find('.dday-count').text()).toBe('D-10')
    expect(wrapper.find('.dday-label').text()).toBe('운동회')

    vi.useRealTimers()
  })
})

describe('시계', () => {
  it('형식 옵션대로 시각을 그린다', async () => {
    const wrapper = mountPreview('clock', { format: 'HH:mm' })
    // 공유 시계 값을 직접 세워 렌더링 경로만 확인한다(타이머에 의존하지 않는다).
    previewNow.value = new Date(2026, 7, 30, 14, 5, 9)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.clock').text()).toBe('14:05')
  })

  it('시계를 놓으면 공유 시계가 현재 시각으로 갱신된다', () => {
    // 모듈 로드 시각이 그대로 남아 있으면 처음에 지난 시각이 잠깐 보인다.
    previewNow.value = new Date(2000, 0, 1)
    mountPreview('clock')
    expect(previewNow.value.getFullYear()).toBeGreaterThan(2000)
  })

  it('형식 문자열을 조합할 수 있다', () => {
    const date = new Date('2026-08-30T14:05:09')
    expect(formatClock(date, 'HH:mm:ss')).toBe('14:05:09')
    expect(formatClock(date, 'yyyy-MM-dd HH:mm')).toBe('2026-08-30 14:05')
  })
})

describe('언어와 배율', () => {
  it('언어를 바꾸면 샘플도 바뀐다', async () => {
    const wrapper = mountPreview('notice')
    expect(wrapper.text()).toContain('교무부')

    i18n.global.locale.value = 'en'
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Academic office')
  })

  it('안쪽은 원본 크기로 그리고 바깥에서 한 번만 축소한다', () => {
    // 이렇게 해야 글자 크기를 실제 표출 기준으로 정할 수 있다.
    const wrapper = mountPreview('notice', {}, { width: 700, height: 500, scale: 0.5 })
    const style = wrapper.attributes('style')
    expect(style).toContain('width: 700px')
    expect(style).toContain('scale(0.5)')
  })

  it('샘플이 있는 위젯에는 샘플 표식을 붙인다', () => {
    // 실제 데이터가 아니라는 것을 편집자가 알아야 한다.
    expect(mountPreview('notice').find('.sample-mark').exists()).toBe(true)
  })

  it('샘플이 없는 위젯은 이름만 보여 준다', () => {
    const wrapper = mountPreview('없는위젯', {}, { name: '알 수 없음' })
    expect(wrapper.find('.fallback').exists()).toBe(true)
    expect(wrapper.find('.sample-mark').exists()).toBe(false)
  })
})

describe('이미지앨범', () => {
  const IMAGES = [{ src: '/api/v1/assets/1/k/file' }, { src: '/api/v1/assets/2/k/file' }]

  it('넣어 둔 사진을 실제로 그린다', () => {
    // 회색 네모만 보이면 사진을 제대로 넣었는지 확인할 수 없다.
    const wrapper = mountPreview('album', { images: IMAGES })

    expect(wrapper.findComponent({ name: 'AlbumSlides' }).exists()).toBe(true)
    expect(wrapper.find('.slide').attributes('src')).toBe(IMAGES[0].src)
  })

  it('아직 안 넣었으면 넣으라고 말한다', () => {
    const wrapper = mountPreview('album', {})
    expect(wrapper.text()).toContain('사진을 넣어')
  })

  it('편집 중에는 넘기지 않는다', () => {
    const wrapper = mountPreview('album', { images: IMAGES })
    expect(wrapper.findComponent({ name: 'AlbumSlides' }).props('playing')).toBe(false)
  })

  it('미리보기에서는 넘긴다', () => {
    const wrapper = mountPreview('album', { images: IMAGES }, { playing: true })
    expect(wrapper.findComponent({ name: 'AlbumSlides' }).props('playing')).toBe(true)
  })

  it('설정을 그대로 넘긴다', () => {
    const options = { images: IMAGES, interval_sec: 5, transition: 'dissolve', fit: 'contain' }
    const wrapper = mountPreview('album', options)

    expect(wrapper.findComponent({ name: 'AlbumSlides' }).props('options')).toEqual(options)
  })
})

describe('시간표의 오늘', () => {
  // 한 주가 다 보이면 어느 칸이 오늘인지가 흐려진다. 복도 끝에서 보는
  // 화면이라 글자만 굵게 해서는 안 짚인다 — 칸 전체를 물들인다.

  /** 미리보기가 보는 공유 시각을 그 날짜로 맞춘다. */
  function setToday(iso) {
    previewNow.value = new Date(`${iso}T09:00:00`)
  }

  const marked = (wrapper, selector) =>
    wrapper.findAll(selector).map((e) => e.classes().includes('today'))

  it('오늘 요일 칸을 짚는다', () => {
    setToday('2026-09-02') // 수요일
    const wrapper = mountPreview('timetable')

    expect(marked(wrapper, '.tt-day')).toEqual([false, false, true, false, false])
  })

  it('그 요일의 과목 칸도 함께 짚는다', () => {
    // 머리글만 물들이면 아래로 눈을 내리는 순간 어느 줄인지 놓친다.
    setToday('2026-08-31') // 월요일
    const wrapper = mountPreview('timetable')
    const first = wrapper.findAll('tbody tr')[0]

    expect(first.findAll('.tt-cell')[0].classes()).toContain('today')
    expect(first.findAll('.tt-cell')[1].classes()).not.toContain('today')
  })

  it('주말에는 아무 칸도 짚지 않는다', () => {
    // 토·일은 표에 없는 요일이다. 엉뚱한 칸을 짚느니 비워 둔다.
    setToday('2026-09-05') // 토요일
    const wrapper = mountPreview('timetable')

    expect(marked(wrapper, '.tt-day')).toEqual([false, false, false, false, false])
  })

  it('날짜가 바뀌면 짚는 칸도 옮겨 간다', async () => {
    // 장치는 몇 달씩 켜 둔 채로 돈다. 자정을 넘겨도 어제를 짚고 있으면 안 된다.
    setToday('2026-09-01') // 화요일
    const wrapper = mountPreview('timetable')
    expect(marked(wrapper, '.tt-day')).toEqual([false, true, false, false, false])

    setToday('2026-09-02') // 수요일
    await wrapper.vm.$nextTick()

    expect(marked(wrapper, '.tt-day')).toEqual([false, false, true, false, false])
  })

  it('언어를 바꿔도 같은 칸을 짚는다', () => {
    // 요일 이름으로 맞추면 언어마다 다르게 적힌 이름을 다 알아야 한다.
    setToday('2026-09-03') // 목요일
    i18n.global.locale.value = 'ja'
    const wrapper = mountPreview('timetable')

    expect(wrapper.findAll('.tt-day').map((e) => e.text())).toEqual(['月', '火', '水', '木', '金'])
    expect(marked(wrapper, '.tt-day')).toEqual([false, false, false, true, false])
  })
})
