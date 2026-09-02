/**
 * 위젯 옵션 폼 테스트.
 *
 * 이 폼은 **서버가 내려준 명세대로** 칸을 그린다 — 백엔드에 위젯을 추가해도
 * 편집기를 고칠 필요가 없어야 한다. 그래서 확인할 것은 "명세의 type 에 맞는
 * 칸이 나오는가"와 "고친 값이 요소에 그대로 들어가는가" 둘이다.
 */
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(async () => ({ items: [], total: 0, page: 1, size: 100 })),
    upload: vi.fn(),
    post: vi.fn(),
  },
  TEST_MODE: false,
}))

import WidgetOptions from './WidgetOptions.vue'

function spec(options) {
  return { key: 'album', name: '이미지앨범', category: '콘텐츠형', options }
}

function mountForm(options, elementOptions = {}) {
  const element = { id: 'e1', type: 'widget', widget_key: 'album', options: elementOptions }
  const wrapper = mount(WidgetOptions, {
    props: { element, spec: spec(options) },
    global: { plugins: [i18n] },
  })
  return { wrapper, element }
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
})

describe('명세대로 칸을 그린다', () => {
  it('옵션이 없으면 그렇게 말한다', () => {
    const { wrapper } = mountForm([])
    expect(wrapper.find('.hint').exists()).toBe(true)
  })

  it('숫자 옵션은 숫자 칸으로', () => {
    const { wrapper } = mountForm([{ key: 'interval_sec', label: '간격', type: 'number', default: 8 }])
    expect(wrapper.find('input[type="number"]').element.value).toBe('8')
  })

  it('고른 값은 요소에 그대로 들어간다', async () => {
    const { wrapper, element } = mountForm([
      { key: 'interval_sec', label: '간격', type: 'number', default: 8 },
    ])

    const input = wrapper.find('input[type="number"]')
    input.element.value = '12'
    await input.trigger('change')

    expect(element.options.interval_sec).toBe(12)
    expect(wrapper.emitted('change')).toBeTruthy()
  })
})

describe('숫자 한계', () => {
  // 한계는 서버 명세가 정한다. 그 값의 뜻을 아는 쪽이 서버이기 때문이다 —
  // 유지 시간 0 초는 한 틱에 목록을 다 돌아 화면이 깜빡인다.
  const INTERVAL = {
    key: 'interval_sec',
    label: '넘김 간격(초)',
    type: 'number',
    default: 8,
    min: 1,
    max: 3600,
  }

  const numberInput = (wrapper) => wrapper.find('input[type="number"]')

  async function type(wrapper, text) {
    const input = numberInput(wrapper)
    input.element.value = text
    await input.trigger('change')
  }

  it('입력칸에 한계를 걸어 둔다', () => {
    const { wrapper } = mountForm([INTERVAL])

    expect(numberInput(wrapper).attributes('min')).toBe('1')
    expect(numberInput(wrapper).attributes('max')).toBe('3600')
  })

  it('최솟값보다 작으면 끌어올린다', async () => {
    // 입력칸의 min 만으로는 못 막는다 — 붙여넣기나 키보드로 넘길 수 있다.
    const { wrapper, element } = mountForm([INTERVAL])

    await type(wrapper, '0')

    expect(element.options.interval_sec).toBe(1)
  })

  it('음수도 최솟값으로', async () => {
    const { wrapper, element } = mountForm([INTERVAL])

    await type(wrapper, '-5')

    expect(element.options.interval_sec).toBe(1)
  })

  it('최댓값보다 크면 끌어내린다', async () => {
    const { wrapper, element } = mountForm([INTERVAL])

    await type(wrapper, '99999')

    expect(element.options.interval_sec).toBe(3600)
  })

  it('한계 안의 값은 그대로 둔다', async () => {
    const { wrapper, element } = mountForm([INTERVAL])

    await type(wrapper, '15')

    expect(element.options.interval_sec).toBe(15)
  })

  it('비우면 기본값으로 되돌린다', async () => {
    // 빈 칸을 0 으로 읽으면, 지우고 다시 적으려던 사람이 그 순간 0 을 저장한다.
    const { wrapper, element } = mountForm([INTERVAL])

    await type(wrapper, '')

    expect(element.options.interval_sec).toBe(8)
  })

  it('숫자가 아닌 글자는 기본값으로 떨어진다', async () => {
    // 숫자 칸은 읽을 수 없는 글자를 아예 빈 값으로 만든다. 그래서 '비움' 과
    // 같은 길을 탄다 — 0 이 되어 화면이 깜빡이는 것보다 낫다.
    const { wrapper, element } = mountForm([INTERVAL], { interval_sec: 12 })

    await type(wrapper, '빠르게')

    expect(element.options.interval_sec).toBe(8)
  })

  it('한계가 없는 옵션은 그대로 받는다', async () => {
    const { wrapper, element } = mountForm([
      { key: 'count', label: '표시 건수', type: 'number', default: 5 },
    ])

    await type(wrapper, '99999')

    expect(element.options.count).toBe(99999)
  })
})

describe('이미지 목록 옵션', () => {
  const IMAGES = { key: 'images', label: '이미지', type: 'image_list', default: [] }

  it('전용 편집칸을 그린다', () => {
    // 글상자로는 여러 장을 넣고 순서를 바꿀 수 없다.
    const { wrapper } = mountForm([IMAGES])
    expect(wrapper.findComponent({ name: 'ImageListEditor' }).exists()).toBe(true)
  })

  it('저장된 목록을 그대로 넘긴다', () => {
    const images = [{ src: '/api/v1/assets/1/k/file' }]
    const { wrapper } = mountForm([IMAGES], { images })

    expect(wrapper.findComponent({ name: 'ImageListEditor' }).props('modelValue')).toEqual(images)
  })

  it('값이 목록이 아니면 빈 목록으로 준다', () => {
    // `?? ''` 로 떨어지면 v-for 가 글자를 한 자씩 훑는다.
    const { wrapper } = mountForm([IMAGES], { images: '엉뚱한 값' })
    expect(wrapper.findComponent({ name: 'ImageListEditor' }).props('modelValue')).toEqual([])
  })

  it('고친 목록을 요소에 쓴다', async () => {
    const { wrapper, element } = mountForm([IMAGES])
    const next = [{ src: '/api/v1/assets/2/k/file' }]

    wrapper.findComponent({ name: 'ImageListEditor' }).vm.$emit('update:modelValue', next)
    await wrapper.vm.$nextTick()

    expect(element.options.images).toEqual(next)
    expect(wrapper.emitted('change')).toBeTruthy()
  })
})

describe('전환 효과 옵션', () => {
  const TRANSITION = { key: 'transition', label: '전환 효과', type: 'transition', default: 'none' }

  it('서버가 가진 효과 목록에서 고르게 한다', () => {
    // 플레이어 전부가 같은 이름을 그려야 장치마다 다르게 넘어가지 않는다.
    const { wrapper } = mountForm([TRANSITION])

    expect(wrapper.findAll('optgroup').length).toBeGreaterThan(1)
    expect(wrapper.findAll('option').map((o) => o.attributes('value'))).toContain('dissolve')
  })

  it('저장된 효과를 골라 둔다', () => {
    const { wrapper } = mountForm([TRANSITION], { transition: 'slide-left' })
    expect(wrapper.find('select').element.value).toBe('slide-left')
  })

  it('고른 효과를 요소에 쓴다', async () => {
    const { wrapper, element } = mountForm([TRANSITION])

    await wrapper.find('select').setValue('dissolve')

    expect(element.options.transition).toBe('dissolve')
  })
})
