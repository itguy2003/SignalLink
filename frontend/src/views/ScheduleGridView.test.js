/**
 * 주간 편집기 렌더링 테스트.
 *
 * 빌드는 통과해도 템플릿이 실제로 그려지지 않는 경우가 있어, 표 구조와
 * 블록 배치가 나오는지 마운트해서 확인한다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'
import { useToastStore } from '@/stores/toast'

const schedule = {
  id: 1,
  name: '평일 기본 스케줄',
  kind: '시간지정',
  orientation: 'LANDSCAPE',
  org_id: 3,
  version: 3,
  device_count: 2,
  created_at: '2026-03-02T09:00:00Z',
  updated_at: '2026-08-20T11:20:00Z',
  items: [
    { id: 1, schedule_id: 1, day_of_week: 0, start_time: '08:00:00', end_time: '12:00:00', duration_sec: 20, content_id: 1, content_name: '아침 알림판', content: {} },
    { id: 2, schedule_id: 1, day_of_week: 0, start_time: '12:00:00', end_time: '17:00:00', duration_sec: 20, content_id: 2, content_name: '오후 화면', content: {} },
    { id: 3, schedule_id: 1, day_of_week: 4, start_time: '09:00:00', end_time: '10:00:00', duration_sec: 20, content_id: null, content: {} },
    { id: 4, schedule_id: 1, day_of_week: -1, start_time: null, end_time: null, duration_sec: 15, content_id: 3, content: {} },
  ],
}

const put = vi.fn(async () => ({ ...loaded.value, version: 4 }))

/** 테스트마다 다른 스케줄을 돌려주기 위한 스위치. */
const loaded = { value: schedule }

const post = vi.fn(async (path, body) => {
  if (path === '/contents') {
    return { id: 99, name: body.name, width: body.width, height: body.height, document: body.document }
  }
  return {}
})

/** 이미 만들어 둔 '감싼 콘텐츠'. 재사용 판정을 흉내 내려면 문서가 필요하다. */
let extraContents = []
let contentDocuments = {}

/** 목록 조회에 어떤 방향이 실려 나갔는지 보려면 이름이 있어야 한다. */
const get = vi.fn(async (path) => {
  if (path.startsWith('/schedules/')) return JSON.parse(JSON.stringify(loaded.value))
  if (path === '/playlists') {
    return {
      items: [
        { id: 4, name: '현관 순환', total_duration_sec: 25, items: [{ id: 1 }, { id: 2 }] },
        { id: 5, name: '급식 안내', total_duration_sec: 10, items: [{ id: 3 }] },
      ],
      total: 2,
      page: 1,
      size: 100,
    }
  }
  if (path === '/widgets') {
    return [
      { key: 'clock', name: '시계', category: '기능형', description: '현재 시각', default_size: { w: 400, h: 200 }, options: [] },
      { key: 'meal', name: '급식메뉴', category: '기능형', description: '오늘의 급식', default_size: { w: 500, h: 600 }, options: [] },
    ]
  }
  if (path.startsWith('/contents/')) {
    return { id: Number(path.split('/')[2]), document: contentDocuments[path.split('/')[2]] ?? {} }
  }
  if (path === '/contents') {
    return {
      items: [
        { id: 7, name: '새 콘텐츠', width: 1920, height: 1080, element_count: 2, background: '#000' },
        ...extraContents,
      ],
      total: 1,
      page: 1,
      size: 60,
    }
  }
  return {}
})

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: (...args) => post(...args),
    put: (...args) => put(...args),
    delete: vi.fn(async () => ({})),
  },
  TEST_MODE: true,
}))

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '1' }, fullPath: '/schedules/1/grid', query: {} }),
  useRouter: () => ({ push }),
  RouterLink: { template: '<a><slot /></a>' },
}))

import ScheduleGridView from './ScheduleGridView.vue'

async function mountView() {
  const wrapper = mount(ScheduleGridView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  extraContents = []
  contentDocuments = {}
  put.mockClear()
  post.mockClear()
  push.mockClear()
  get.mockClear()
  loaded.value = schedule
  // 언어에 따라 라벨이 달라지므로 테스트는 한국어로 고정한다.
  i18n.global.locale.value = 'ko'
})

describe('주간 편집기 렌더링', () => {
  it('가로축에 요일 7개를 그린다', async () => {
    const wrapper = await mountView()
    const heads = wrapper.findAll('.day-head')
    expect(heads).toHaveLength(7)
    expect(heads.map((h) => h.text())).toEqual(['월', '화', '수', '목', '금', '토', '일'])
  })

  it('세로축에 시간 눈금을 그린다', async () => {
    const wrapper = await mountView()
    const labels = wrapper.findAll('.time-label').map((l) => l.text())
    // 기본 06시~24시
    expect(labels[0]).toBe('06:00')
    expect(labels.at(-1)).toBe('24:00')
  })

  it('요일 열이 7개 있고 각각 마우스 이벤트를 받는다', async () => {
    const wrapper = await mountView()
    expect(wrapper.findAll('.day-col')).toHaveLength(7)
  })

  it('시간 블록을 해당 요일 열에 배치한다', async () => {
    const wrapper = await mountView()
    const blocks = wrapper.findAll('.block')
    expect(blocks).toHaveLength(3) // 요일 미지정 아이템은 표에 놓지 않는다

    const texts = blocks.map((b) => b.text())
    expect(texts.some((t) => t.includes('08:00–12:00') && t.includes('아침 알림판'))).toBe(true)
    expect(texts.some((t) => t.includes('12:00–17:00') && t.includes('오후 화면'))).toBe(true)
  })

  it('콘텐츠가 없는 블록은 따로 표시한다', async () => {
    const wrapper = await mountView()
    const empty = wrapper.findAll('.block.empty')
    expect(empty).toHaveLength(1)
    expect(empty[0].text()).toContain('콘텐츠 없음')
  })

  it('블록의 세로 위치가 시각에 비례한다', async () => {
    const wrapper = await mountView()
    const blocks = wrapper.findAll('.block')
    const morning = blocks.find((b) => b.text().includes('08:00–12:00'))
    // 06시 시작 그리드에서 08:00 = 2시간 = 4슬롯 x 26px
    expect(morning.attributes('style')).toContain('top: 104px')
    expect(morning.attributes('style')).toContain('height: 208px')
  })

  it('요일 미지정 아이템이 있으면 사라지지 않는다고 알린다', async () => {
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('요일이 지정되지 않은 아이템이 1개')
  })

  it('콘텐츠 미지정 블록 수를 경고한다', async () => {
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('콘텐츠가 지정되지 않은 블록이 1개')
  })
})

describe('블록 선택과 저장', () => {
  it('블록을 누르면 설정 패널이 열린다', async () => {
    const wrapper = await mountView()
    const morning = wrapper.findAll('.block').find((b) => b.text().includes('아침 알림판'))
    await morning.trigger('mousedown')
    expect(wrapper.text()).toContain('블록 설정')
    expect(wrapper.text()).toContain('브라우저에서 선택')
  })

  it('저장하면 요일과 시각이 아이템으로 변환되어 전송된다', async () => {
    const wrapper = await mountView()
    // 콘텐츠 미지정 블록 확인 창이 뜨므로 승인한 것으로 둔다.
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    expect(put).toHaveBeenCalledTimes(1)
    const [path, body] = put.mock.calls[0]
    expect(path).toBe('/schedules/1')

    const placed = body.items.filter((i) => i.day_of_week >= 0)
    expect(placed).toHaveLength(3)
    expect(placed[0]).toMatchObject({
      day_of_week: 0,
      start_time: '08:00:00',
      end_time: '12:00:00',
      content_id: 1,
    })
    // 표 밖 아이템도 함께 보내 유실되지 않게 한다.
    expect(body.items.some((i) => i.day_of_week === -1)).toBe(true)
  })
})


/** 콘텐츠 카드 드래그를 흉내 낸다. */
function contentDrag(payload = { id: 7, name: '새 콘텐츠' }) {
  return {
    dataTransfer: {
      types: ['application/x-signallink-content'],
      getData: () => JSON.stringify(payload),
      dropEffect: '',
    },
    preventDefault: () => {},
    clientY: 130, // 무대 기준 y. 06시 시작 그리드에서 대략 11시.
  }
}

describe('키보드로 블록 지우기', () => {
  /** 창 전체에 키를 흘려보낸다. 리스너가 window 에 걸려 있다. */
  function press(key, target = document.body) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    Object.defineProperty(event, 'target', { value: target })
    window.dispatchEvent(event)
  }

  async function selectMorning(wrapper) {
    const morning = wrapper.findAll('.block').find((b) => b.text().includes('아침 알림판'))
    await morning.trigger('mousedown')
    await flushPromises()
    return morning
  }

  it('Delete 로 고른 블록을 지운다', async () => {
    // 콘텐츠 편집기와 같은 손놀림이다. 한쪽만 되면 매번 버튼을 찾게 된다.
    const wrapper = await mountView()
    const before = wrapper.findAll('.block').length
    await selectMorning(wrapper)

    press('Delete')
    await flushPromises()

    expect(wrapper.findAll('.block')).toHaveLength(before - 1)
    expect(wrapper.text()).not.toContain('아침 알림판')
  })

  it('Backspace 로도 지운다', async () => {
    const wrapper = await mountView()
    const before = wrapper.findAll('.block').length
    await selectMorning(wrapper)

    press('Backspace')
    await flushPromises()

    expect(wrapper.findAll('.block')).toHaveLength(before - 1)
  })

  it('고른 블록이 없으면 아무 일도 없다', async () => {
    const wrapper = await mountView()
    const before = wrapper.findAll('.block').length

    press('Delete')
    await flushPromises()

    expect(wrapper.findAll('.block')).toHaveLength(before)
  })

  it('입력칸에서 누른 것은 무시한다', async () => {
    // 이름을 고치다 Delete 를 눌렀는데 블록이 사라지면 그보다 나쁜 일이 없다.
    const wrapper = await mountView()
    await selectMorning(wrapper)
    const before = wrapper.findAll('.block').length

    press('Delete', wrapper.find('.title-input').element)
    await flushPromises()

    expect(wrapper.findAll('.block')).toHaveLength(before)
  })

  it('Escape 로 선택을 푼다', async () => {
    const wrapper = await mountView()
    await selectMorning(wrapper)
    expect(wrapper.text()).toContain('블록 설정')

    press('Escape')
    await flushPromises()

    expect(wrapper.text()).not.toContain('블록 설정')
  })

  it('지우면 미저장으로 표시한다', async () => {
    const wrapper = await mountView()
    await selectMorning(wrapper)

    press('Delete')
    await flushPromises()

    expect(wrapper.find('.head').text()).toContain('저장 안 됨')
  })
})

describe('시각 유효성 검사', () => {
  async function selectMorning(wrapper) {
    const morning = wrapper.findAll('.block').find((b) => b.text().includes('아침 알림판'))
    await morning.trigger('mousedown')
    await flushPromises()
  }

  const timeInputs = (wrapper) => wrapper.findAll('.side input[type="time"]')

  /**
   * 시각 칸에 값을 넣고 change 를 보낸다.
   *
   * `setValue` 는 input 이벤트를 함께 보내고, 그 사이 다시 그려지면서
   * 묶인 값이 되돌아온다 — change 가 옛 값을 들고 가 버린다.
   */
  async function typeTime(input, value) {
    input.element.value = value
    await input.trigger('change')
    await flushPromises()
  }

  it('종료가 시작보다 앞서면 그 자리에 알린다', async () => {
    // 토스트로만 알리면 창이 사라진 뒤에는 무엇이 잘못됐는지 남지 않는다.
    const wrapper = await mountView()
    await selectMorning(wrapper)

    await typeTime(timeInputs(wrapper)[1], '07:00')

    expect(wrapper.find('.side .error-text').text()).toContain('뒤여야')
  })

  it('틀린 칸을 짚어 준다', async () => {
    const wrapper = await mountView()
    await selectMorning(wrapper)

    await typeTime(timeInputs(wrapper)[1], '07:00')

    expect(timeInputs(wrapper)[1].classes()).toContain('bad')
    expect(timeInputs(wrapper)[0].classes()).not.toContain('bad')
  })

  it('실패하면 값을 되돌린다', async () => {
    // 저장되지 않은 값이 칸에 남으면 화면과 실제가 다른 상태가 된다.
    const wrapper = await mountView()
    await selectMorning(wrapper)
    const before = timeInputs(wrapper)[1].element.value

    await typeTime(timeInputs(wrapper)[1], '07:00')

    expect(wrapper.findAll('.side input[type="time"]')[1].attributes('value')).toBe(before)
  })

  it('형식이 아니면 알린다', async () => {
    const wrapper = await mountView()
    await selectMorning(wrapper)

    await typeTime(timeInputs(wrapper)[0], '')

    expect(wrapper.find('.side .error-text').text()).toContain('형식')
  })

  it('표에 안 보이는 시간대는 막는다', async () => {
    // 밀어 넣으면 블록이 사라진 것처럼 보인다.
    const wrapper = await mountView()
    await selectMorning(wrapper)

    await typeTime(timeInputs(wrapper)[0], '01:00')

    expect(wrapper.find('.side .error-text').text()).toContain('보이는')
  })

  it('제대로 고치면 오류가 사라진다', async () => {
    const wrapper = await mountView()
    await selectMorning(wrapper)

    await typeTime(timeInputs(wrapper)[1], '07:00')
    expect(wrapper.find('.side .error-text').exists()).toBe(true)

    await typeTime(timeInputs(wrapper)[1], '11:00')

    expect(wrapper.find('.side .error-text').exists()).toBe(false)
  })

  it('다른 블록을 고르면 오류를 지운다', async () => {
    const wrapper = await mountView()
    await selectMorning(wrapper)
    await typeTime(timeInputs(wrapper)[1], '07:00')

    const other = wrapper.findAll('.block').find((b) => !b.text().includes('아침 알림판'))
    await other.trigger('mousedown')
    await flushPromises()

    expect(wrapper.find('.side .error-text').exists()).toBe(false)
  })

  it('입력 간격이 분할을 따라간다', async () => {
    // 5분 분할로 잡아 놓고 10분 단위로만 넣게 하면 왜 안 되는지 알 수 없다.
    const wrapper = await mountView()
    await selectMorning(wrapper)

    expect(timeInputs(wrapper)[0].attributes('step')).toBe('1800')
  })
})

describe('콘텐츠 목록 패널', () => {
  it('편집기 왼쪽에 콘텐츠 목록을 보여 준다', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('.library-panel').exists()).toBe(true)
    expect(wrapper.text()).toContain('새 콘텐츠')
  })

  it('카드를 끌 수 있게 표시한다', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('.library-panel .card-item').attributes('draggable')).toBe('true')
  })
})

describe('머리말 도구', () => {
  it('단일 편집기 링크를 두지 않는다', async () => {
    // 기능을 지웠으므로 들어가는 문이 남아 있으면 안 된다.
    const wrapper = await mountView()
    expect(wrapper.find('.head').text()).not.toContain('단일')
  })

  it('요일 없는 아이템은 보존된다고만 알린다', async () => {
    // 예전에는 '단일 편집기에서 볼 수 있다'고 안내했다. 그 화면이 없어졌으니
    // 남은 것은 '저장해도 사라지지 않는다'는 사실뿐이다.
    loaded.value = {
      ...schedule,
      items: [{ id: 9, schedule_id: 1, day_of_week: -1, start_time: null, end_time: null, duration_sec: 15, content_id: 3, content: {} }],
    }
    const wrapper = await mountView()
    const warn = wrapper.findAll('.warn').find((w) => w.text().includes('요일이 지정되지 않은'))

    expect(warn.text()).toContain('보존됩니다')
    expect(warn.find('a').exists()).toBe(false)
  })
})

describe('시간 분할', () => {
  const slotSelect = (wrapper) =>
    wrapper
      .findAll('.head select')
      .find((sel) => sel.findAll('option').some((o) => o.text() === '10분'))

  it('분할을 고를 수 있다', async () => {
    const wrapper = await mountView()
    expect(slotSelect(wrapper)).toBeTruthy()
  })

  it('5분까지 내려간다', async () => {
    // 쉬는 시간(10분)이나 종례 방송 같은 짧은 편성을 잡으려면 필요하다.
    const wrapper = await mountView()
    const values = slotSelect(wrapper)
      .findAll('option')
      .map((o) => Number(o.element.value))
    expect(values).toEqual([5, 10, 15, 30, 60])
  })

  it('바꿔도 표 전체 높이는 그대로다', async () => {
    // 5분 칸에 30분 칸과 같은 높이를 주면 표가 여섯 배로 길어진다.
    const wrapper = await mountView()
    const before = wrapper.find('.grid-body').attributes('style')

    await slotSelect(wrapper).setValue(5)
    await flushPromises()

    expect(wrapper.find('.grid-body').attributes('style')).toBe(before)
  })

  it('바꿔도 이미 놓인 블록은 움직이지 않는다', async () => {
    // 잘게 보려던 것뿐인데 편성이 달라지면 안 된다.
    const wrapper = await mountView()
    const before = wrapper.findAll('.block').map((b) => b.attributes('style'))

    await slotSelect(wrapper).setValue(10)
    await flushPromises()

    expect(wrapper.findAll('.block').map((b) => b.attributes('style'))).toEqual(before)
  })

  it('고른 간격이 눈금으로 보인다', async () => {
    const wrapper = await mountView()
    await slotSelect(wrapper).setValue(60)
    await flushPromises()

    // 60분 = 한 시간 높이(52px).
    expect(wrapper.find('.day-col').attributes('style')).toContain('52px')
  })
})

describe('화면 방향', () => {
  it('스케줄의 방향을 머리말에 보여 준다', async () => {
    // 어떤 콘텐츠를 붙일 수 있는지가 이 값으로 정해지므로 늘 보여야 한다.
    const wrapper = await mountView()
    expect(wrapper.find('.head .hint').text()).toContain('가로형')
  })

  it('세로형 스케줄이면 세로형으로 보여 준다', async () => {
    loaded.value = { ...schedule, orientation: 'PORTRAIT', items: [] }
    const wrapper = await mountView()
    expect(wrapper.find('.head .hint').text()).toContain('세로형')
  })

  it('콘텐츠 목록을 스케줄 방향으로 잠근다', async () => {
    // 고를 수 있게 두면 다른 방향을 끌어다 놓은 뒤에야 서버가 거부한다.
    const wrapper = await mountView()
    expect(wrapper.find('.library-panel .filters select').exists()).toBe(false)
    expect(wrapper.find('.library-panel .locked-orientation').text()).toBe('가로형')
  })

  it('콘텐츠 목록을 그 방향으로만 조회한다', async () => {
    loaded.value = { ...schedule, orientation: 'PORTRAIT', items: [] }
    await mountView()
    const call = get.mock.calls.find(([path]) => path === '/contents')
    expect(call[1].orientation).toBe('portrait')
  })

  it('방향이 다른 콘텐츠는 떨어뜨려도 붙지 않는다', async () => {
    const wrapper = await mountView()
    const before = wrapper.findAll('.block').length

    await wrapper.findAll('.day-col')[2].trigger('drop', contentDrag({
      id: 8, name: '세로 안내판', width: 1080, height: 1920,
    }))
    await flushPromises()

    expect(wrapper.findAll('.block')).toHaveLength(before)
  })

  it('왜 안 되는지 알려 준다', async () => {
    // 조용히 무시하면 드래그가 실패한 건지 놓친 건지 알 수 없다.
    const wrapper = await mountView()
    await wrapper.findAll('.day-col')[2].trigger('drop', contentDrag({
      id: 8, name: '세로 안내판', width: 1080, height: 1920,
    }))
    await flushPromises()

    const messages = useToastStore().items.map((i) => i.message)
    expect(messages.join('\n')).toContain('세로 안내판')
  })

  it('크기를 모르는 카드는 막지 않는다', async () => {
    // 크기를 안 싣고 오는 예전 경로까지 막으면 멀쩡한 배치가 실패한다.
    const wrapper = await mountView()
    const before = wrapper.findAll('.block').length

    await wrapper.findAll('.day-col')[2].trigger('drop', contentDrag({ id: 7, name: '새 콘텐츠' }))
    await flushPromises()

    expect(wrapper.findAll('.block')).toHaveLength(before + 1)
  })
})

describe('주간 표에 드롭', () => {
  it('요일 열에 떨어뜨리면 그 자리에 블록이 생긴다', async () => {
    const wrapper = await mountView()
    const before = wrapper.findAll('.block').length

    await wrapper.findAll('.day-col')[2].trigger('drop', contentDrag())

    const blocks = wrapper.findAll('.block')
    expect(blocks).toHaveLength(before + 1)
    expect(wrapper.text()).toContain('새 콘텐츠')
  })

  it('드래그가 지나가는 열을 표시한다', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('.day-col')[3].trigger('dragover', contentDrag())
    expect(wrapper.findAll('.day-col')[3].classes()).toContain('drop-target')
  })

  it('겹치는 자리에는 만들지 않는다', async () => {
    const wrapper = await mountView()
    const before = wrapper.findAll('.block').length

    // 월요일 08:00–12:00 자리(무대 y=130 ≈ 11시)에 떨어뜨린다.
    await wrapper.findAll('.day-col')[0].trigger('drop', contentDrag())

    expect(wrapper.findAll('.block')).toHaveLength(before)
  })

  it('우리 드래그가 아니면 무시한다', async () => {
    const wrapper = await mountView()
    const before = wrapper.findAll('.block').length

    await wrapper.findAll('.day-col')[2].trigger('drop', {
      dataTransfer: { types: ['Files'], getData: () => '' },
      preventDefault: () => {},
      clientY: 130,
    })

    expect(wrapper.findAll('.block')).toHaveLength(before)
  })

  it('드롭으로 만든 블록도 저장에 포함된다', async () => {
    const wrapper = await mountView()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    await wrapper.findAll('.day-col')[2].trigger('drop', contentDrag())
    await wrapper.find('.head .btn-primary').trigger('click')
    await flushPromises()

    const [, body] = put.mock.calls[0]
    expect(body.items.some((i) => i.content_id === 7 && i.day_of_week === 2)).toBe(true)
  })
})

describe('목록반복 스케줄', () => {
  const loopSchedule = {
    id: 2,
    name: '행사 안내',
    kind: '목록반복',
    org_id: 3,
    version: 1,
    device_count: 0,
    created_at: '2026-05-11T02:00:00Z',
    updated_at: '2026-05-11T02:00:00Z',
    items: [
      { id: 8, schedule_id: 2, day_of_week: -1, start_time: null, end_time: null, sort_order: 0, duration_sec: 15, content_id: 3, content_name: '운동회 안내', content: {} },
    ],
  }

  it('요일 표 대신 재생 목록을 보여 준다', async () => {
    loaded.value = loopSchedule
    const wrapper = await mountView()

    expect(wrapper.find('.day-head').exists()).toBe(false)
    expect(wrapper.find('.playlist').exists()).toBe(true)
    expect(wrapper.text()).toContain('운동회 안내')
  })

  it('시간지정 스케줄에서는 재생 목록을 쓰지 않는다', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('.playlist').exists()).toBe(false)
    expect(wrapper.findAll('.day-head')).toHaveLength(7)
  })

  it('재생 목록에도 콘텐츠를 끌어다 놓을 수 있다', async () => {
    loaded.value = loopSchedule
    const wrapper = await mountView()

    await wrapper.find('.tail-drop').trigger('drop', contentDrag())

    expect(wrapper.findAll('.playlist .item')).toHaveLength(2)
  })

  it('저장하면 순서대로 sort_order 를 매긴다', async () => {
    loaded.value = loopSchedule
    const wrapper = await mountView()

    await wrapper.find('.tail-drop').trigger('drop', contentDrag())
    await wrapper.find('.head .btn-primary').trigger('click')
    await flushPromises()

    const [, body] = put.mock.calls[0]
    expect(body.items.map((i) => i.sort_order)).toEqual([0, 1])
    expect(body.items.map((i) => i.content_id)).toEqual([3, 7])
    // 재생 목록 항목은 요일이 없다.
    expect(body.items.every((i) => i.day_of_week === -1)).toBe(true)
  })
})


/** 위젯 카드 드래그를 흉내 낸다. */
function widgetDrag(payload = { kind: 'widget', key: 'clock', name: '시계', width: 1920, height: 1080 }) {
  return {
    dataTransfer: {
      types: ['application/x-signallink-content'],
      getData: () => JSON.stringify(payload),
      dropEffect: '',
    },
    preventDefault: () => {},
    clientY: 130,
  }
}

describe('위젯 탭', () => {
  it('콘텐츠·위젯·재생목록을 탭으로 나눈다', async () => {
    const wrapper = await mountView()
    const tabs = wrapper.findAll('.library-panel .tab').map((b) => b.text())
    expect(tabs).toEqual(['콘텐츠', '위젯', '재생목록'])
  })

  it('위젯 탭으로 바꾸면 위젯 목록이 나온다', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('.library-panel .tab')[1].trigger('click')
    await flushPromises()

    const names = wrapper.findAll('.library-panel .widget-item .name').map((n) => n.text())
    expect(names).toEqual(['시계', '급식메뉴'])
  })

  it('위젯 카드도 끌 수 있다', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('.library-panel .tab')[1].trigger('click')
    await flushPromises()
    expect(wrapper.find('.widget-item').attributes('draggable')).toBe('true')
  })

  it('위젯을 카테고리로 묶어 보여 준다', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('.library-panel .tab')[1].trigger('click')
    await flushPromises()
    expect(wrapper.find('.group-title').text()).toBe('기능형')
  })
})

describe('재생목록 탭', () => {
  async function openPlaylistTab(wrapper) {
    await wrapper.findAll('.library-panel .tab')[2].trigger('click')
    await flushPromises()
  }

  it('탭을 열면 재생목록을 받아 온다', async () => {
    // 한 번 받아 두면 다른 화면에서 만든 목록이 여기서는 영영 안 보인다.
    const wrapper = await mountView()
    await openPlaylistTab(wrapper)

    expect(get).toHaveBeenCalledWith('/playlists', { size: 100 })
  })

  it('담긴 개수와 한 바퀴 시간을 알려 준다', async () => {
    const wrapper = await mountView()
    await openPlaylistTab(wrapper)

    expect(wrapper.find('.library-panel .card-item .meta').text()).toContain('위젯 2개')
    expect(wrapper.find('.library-panel .card-item .meta').text()).toContain('25')
  })

  it('이름으로 좁혀 찾는다', async () => {
    const wrapper = await mountView()
    await openPlaylistTab(wrapper)

    await wrapper.find('.library-panel .filters .input').setValue('급식')
    expect(wrapper.findAll('.library-panel .card-item')).toHaveLength(1)
  })

  it('끌 수 있다', async () => {
    const wrapper = await mountView()
    await openPlaylistTab(wrapper)

    expect(wrapper.find('.library-panel .card-item').attributes('draggable')).toBe('true')
  })
})

describe('재생목록을 스케줄에 놓기', () => {
  /** 재생목록 카드 드래그. */
  const playlistDrag = () =>
    widgetDrag({ kind: 'playlist', id: 4, name: '현관 순환' })

  it('그 재생목록이 화면을 꽉 채우는 콘텐츠를 만든다', async () => {
    // 스케줄 아이템은 언제나 콘텐츠를 가리킨다. 위젯과 같은 방식이다.
    const wrapper = await mountView()
    await wrapper.findAll('.day-col')[2].trigger('drop', playlistDrag())
    await flushPromises()

    const [path, body] = post.mock.calls[0]
    expect(path).toBe('/contents')
    expect(body.name).toBe('현관 순환')
    expect(body.document.elements[0].type).toBe('playlist')
    expect(body.document.elements[0].rect).toMatchObject({ x: 0, y: 0, w: 1920, h: 1080 })
  })

  it('문서에는 참조만 남긴다', async () => {
    // 재생목록을 고치면 다시 저장하지 않아도 이 스케줄에 반영돼야 한다.
    const wrapper = await mountView()
    await wrapper.findAll('.day-col')[2].trigger('drop', playlistDrag())
    await flushPromises()

    const options = post.mock.calls[0][1].document.elements[0].options
    expect(options.playlist_id).toBe(4)
    expect(options.items).toBeUndefined()
  })

  it('스케줄 방향에 맞춰 감싼다', async () => {
    // 카드가 실어 온 크기를 믿지 않는다 — 어긋나면 쓰이지 못한 채 남는다.
    loaded.value = { ...schedule, orientation: 'PORTRAIT' }
    const wrapper = await mountView()
    await wrapper.findAll('.day-col')[2].trigger('drop', playlistDrag())
    await flushPromises()

    const body = post.mock.calls[0][1]
    expect(body.width).toBe(1080)
    expect(body.document.elements[0].rect).toMatchObject({ w: 1080, h: 1920 })
  })

  it('만든 콘텐츠가 블록에 붙는다', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('.day-col')[2].trigger('drop', playlistDrag())
    await flushPromises()

    expect(wrapper.text()).toContain('현관 순환')
  })
})

describe('감싼 콘텐츠 재사용', () => {
  const clockDrag = () => widgetDrag()

  it('같은 위젯을 두 번 놓아도 콘텐츠는 하나만 만든다', async () => {
    // 놓을 때마다 새로 만들면 똑같은 콘텐츠가 라이브러리에 쌓인다.
    const wrapper = await mountView()
    await wrapper.findAll('.day-col')[2].trigger('drop', clockDrag())
    await flushPromises()
    await wrapper.findAll('.day-col')[3].trigger('drop', clockDrag())
    await flushPromises()

    expect(post).toHaveBeenCalledTimes(1)
  })

  it('이미 만들어 둔 것이 있으면 그것을 쓴다', async () => {
    // 편집기를 다시 열어도 사본이 늘면 안 된다.
    extraContents = [
      { id: 21, name: '시계', width: 1920, height: 1080, element_count: 1, background: '#000' },
    ]
    contentDocuments['21'] = {
      elements: [{ type: 'widget', widget_key: 'clock' }],
    }
    const wrapper = await mountView()
    await wrapper.findAll('.day-col')[2].trigger('drop', clockDrag())
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('시계')
  })

  it('이름만 같고 내용이 다르면 새로 만든다', async () => {
    extraContents = [
      { id: 22, name: '시계', width: 1920, height: 1080, element_count: 1, background: '#000' },
    ]
    contentDocuments['22'] = { elements: [{ type: 'text' }] }
    const wrapper = await mountView()
    await wrapper.findAll('.day-col')[2].trigger('drop', clockDrag())
    await flushPromises()

    expect(post).toHaveBeenCalledTimes(1)
  })

  it('방향이 다르면 다시 만든다', async () => {
    // 가로형과 세로형은 서로 다른 콘텐츠다.
    extraContents = [
      { id: 23, name: '시계', width: 1080, height: 1920, element_count: 1, background: '#000' },
    ]
    contentDocuments['23'] = { elements: [{ type: 'widget', widget_key: 'clock' }] }
    const wrapper = await mountView()
    await wrapper.findAll('.day-col')[2].trigger('drop', clockDrag())
    await flushPromises()

    expect(post).toHaveBeenCalledTimes(1)
  })

  it('재생목록도 같은 규칙을 따른다', async () => {
    extraContents = [
      { id: 24, name: '현관 순환', width: 1920, height: 1080, element_count: 1, background: '#000' },
    ]
    contentDocuments['24'] = {
      elements: [{ type: 'playlist', options: { playlist_id: 4 } }],
    }
    const wrapper = await mountView()
    await wrapper
      .findAll('.day-col')[2]
      .trigger('drop', widgetDrag({ kind: 'playlist', id: 4, name: '현관 순환' }))
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
  })
})

describe('위젯을 스케줄에 놓기', () => {
  it('위젯을 놓으면 전체 화면을 채우는 콘텐츠를 만든다', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('.day-col')[2].trigger('drop', widgetDrag())
    await flushPromises()

    expect(post).toHaveBeenCalledTimes(1)
    const [path, body] = post.mock.calls[0]
    expect(path).toBe('/contents')
    expect(body.name).toBe('시계')

    // 위젯 하나가 캔버스를 꽉 채운다.
    const element = body.document.elements[0]
    expect(element.widget_key).toBe('clock')
    expect(element.rect).toMatchObject({ x: 0, y: 0, w: 1920, h: 1080 })
  })

  it('만들어진 콘텐츠가 블록에 붙는다', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('.day-col')[2].trigger('drop', widgetDrag())
    await flushPromises()

    expect(wrapper.text()).toContain('시계')
  })

  it('저장하면 감싼 콘텐츠의 id 로 나간다', async () => {
    const wrapper = await mountView()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    await wrapper.findAll('.day-col')[2].trigger('drop', widgetDrag())
    await flushPromises()
    await wrapper.find('.head .btn-primary').trigger('click')
    await flushPromises()

    const [, body] = put.mock.calls[0]
    expect(body.items.some((i) => i.content_id === 99 && i.day_of_week === 2)).toBe(true)
  })

  it('겹치는 자리면 콘텐츠를 만들지 않는다', async () => {
    // 실패할 배치 때문에 쓰이지 않는 콘텐츠가 쌓이면 안 된다.
    const wrapper = await mountView()
    await wrapper.findAll('.day-col')[0].trigger('drop', widgetDrag())
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
  })

  it('세로형 스케줄에서는 세로 크기로 감싼다', async () => {
    loaded.value = { ...schedule, orientation: 'PORTRAIT', items: [] }
    const wrapper = await mountView()
    await wrapper.findAll('.day-col')[2].trigger('drop', widgetDrag({
      kind: 'widget', key: 'meal', name: '급식메뉴', width: 1080, height: 1920,
    }))
    await flushPromises()

    const [, body] = post.mock.calls[0]
    expect(body.width).toBe(1080)
    expect(body.height).toBe(1920)
    expect(body.document.elements[0].rect).toMatchObject({ w: 1080, h: 1920 })
  })

  it('카드가 실어 온 크기가 아니라 스케줄 방향을 따른다', async () => {
    // 세로 크기를 달고 온 위젯이라도 가로 스케줄이면 가로로 감싼다.
    // 카드 값을 그대로 믿으면 쓰이지도 못할 방향 불일치 콘텐츠가 남는다.
    const wrapper = await mountView()
    await wrapper.findAll('.day-col')[2].trigger('drop', widgetDrag({
      kind: 'widget', key: 'meal', name: '급식메뉴', width: 1080, height: 1920,
    }))
    await flushPromises()

    const [, body] = post.mock.calls[0]
    expect(body.width).toBe(1920)
    expect(body.height).toBe(1080)
  })

  it('재생 목록에도 위젯을 놓을 수 있다', async () => {
    loaded.value = {
      id: 2, name: '행사', kind: '목록반복', org_id: 3, version: 1, device_count: 0,
      created_at: '2026-05-11T02:00:00Z', updated_at: '2026-05-11T02:00:00Z', items: [],
    }
    const wrapper = await mountView()

    await wrapper.find('.drop-zone').trigger('drop', widgetDrag())
    await flushPromises()

    expect(post).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('.playlist .item')).toHaveLength(1)
    expect(wrapper.text()).toContain('시계')
  })
})
