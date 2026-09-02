/**
 * 이미지앨범 편집 창 테스트.
 *
 * 왼쪽은 어디서 가져올지, 오른쪽은 가져온 것을 어떻게 넘길지다. 확인할 것은
 * "왼쪽에서 고른 것이 오른쪽 끝에 붙는가"와 "오른쪽에서 정한 값이 문서에
 * 어떤 모양으로 남는가" 둘이다. 뒤쪽이 중요한 이유는, 비운 값은 **키를 지워야**
 * 하기 때문이다 — 안 쓰는 값이 남으면 나중에 읽는 사람이 의미 있는 설정이라고
 * 믿게 된다.
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

import AlbumEditorDialog from './AlbumEditorDialog.vue'

const SOURCES = ['/api/v1/assets/1/k/file', '/api/v1/assets/2/k/file', '/api/v1/assets/3/k/file']

function mountDialog(modelValue = [], props = {}) {
  return mount(AlbumEditorDialog, {
    props: { modelValue, ...props },
    global: { plugins: [i18n] },
  })
}

const entries = (list) => list.map((src) => ({ src }))

function saved(wrapper) {
  const events = wrapper.emitted('update:modelValue')
  return events ? events.at(-1)[0] : null
}

const source = (wrapper) => wrapper.findComponent({ name: 'MediaSourcePanel' })
const rows = (wrapper) => wrapper.findAll('.row')
const holdInput = (wrapper, at) => rows(wrapper)[at].findAll('input')[0]
const fxSelect = (wrapper, at) => rows(wrapper)[at].find('select')
const msInput = (wrapper, at) => rows(wrapper)[at].find('.ms')

beforeEach(() => {
  i18n.global.locale.value = 'ko'
})

describe('두 칸으로 나뉜다', () => {
  it('왼쪽은 이미지 넣기와 같은 칸이다', () => {
    // 앨범만 다른 방법으로 넣게 하면 폐쇄망에서 안 나오는 링크를 여기서만 쓴다.
    const wrapper = mountDialog()

    expect(source(wrapper).exists()).toBe(true)
    expect(source(wrapper).props('kind')).toBe('image')
  })

  it('왼쪽은 여러 장을 한 번에 고를 수 있다', () => {
    expect(source(mountDialog()).props('multiple')).toBe(true)
  })

  it('업로드할 기관을 왼쪽 칸에 넘긴다', () => {
    expect(source(mountDialog([], { orgId: 3 })).props('orgId')).toBe(3)
  })

  it('오른쪽은 담긴 것을 줄로 늘어놓는다', () => {
    const wrapper = mountDialog(entries(SOURCES))
    expect(rows(wrapper)).toHaveLength(3)
  })

  it('아직 없으면 왼쪽에서 고르라고 안내한다', () => {
    const wrapper = mountDialog()
    expect(wrapper.find('.table-empty').text()).toContain('왼쪽에서')
  })

  it('한 바퀴 도는 시간을 알려 준다', () => {
    // 얼마마다 같은 사진이 돌아오는지가 관심사다.
    const wrapper = mountDialog(
      [{ src: SOURCES[0], duration_sec: 5 }, { src: SOURCES[1] }],
      { defaultInterval: 10 },
    )

    expect(wrapper.text()).toContain('15')
  })
})

describe('왼쪽에서 담기', () => {
  it('고른 것들이 뒤에 붙는다', () => {
    const wrapper = mountDialog(entries([SOURCES[0]]))

    source(wrapper).vm.$emit('select-many', [{ src: SOURCES[1] }, { src: SOURCES[2] }])

    expect(saved(wrapper).map((e) => e.src)).toEqual(SOURCES)
  })

  it('한 장만 온 경우도 받는다', () => {
    // 링크 탭은 한 번에 하나씩 온다.
    const wrapper = mountDialog()

    source(wrapper).vm.$emit('select', { src: SOURCES[0] })

    expect(saved(wrapper).map((e) => e.src)).toEqual([SOURCES[0]])
  })

  it('출처가 따라오면 함께 적는다', () => {
    const wrapper = mountDialog()

    source(wrapper)
      .vm.$emit('select-many', [
        { src: SOURCES[0], credit: { source: 'pixabay', author: '촬영자' } },
      ])

    expect(saved(wrapper)[0]).toMatchObject({ source: 'pixabay', author: '촬영자' })
  })

  it('빈 목록이 오면 아무것도 바꾸지 않는다', () => {
    // 모두 실패했을 때다. 빈 배열로 덮으면 있던 사진이 사라진다.
    const wrapper = mountDialog(entries([SOURCES[0]]))

    source(wrapper).vm.$emit('select-many', [])

    expect(saved(wrapper)).toBeNull()
  })

  it('창을 닫지 않고 계속 담을 수 있다', () => {
    // 넣고 → 보고 → 또 넣는 반복이 창 왕복이 되면 안 된다.
    const wrapper = mountDialog()

    source(wrapper).vm.$emit('select-many', [{ src: SOURCES[0] }])

    expect(wrapper.emitted('close')).toBeUndefined()
  })
})

describe('유지 시간', () => {
  it('장마다 초를 정한다', async () => {
    const wrapper = mountDialog(entries(SOURCES))

    const input = holdInput(wrapper, 1)
    input.element.value = '15'
    await input.trigger('change')

    expect(saved(wrapper)[1].duration_sec).toBe(15)
    expect(saved(wrapper)[0].duration_sec).toBeUndefined()
  })

  it('비우면 앨범 기본값을 따른다', async () => {
    const wrapper = mountDialog([{ src: SOURCES[0], duration_sec: 15 }])

    const input = holdInput(wrapper, 0)
    input.element.value = ''
    await input.trigger('change')

    expect(saved(wrapper)[0]).toEqual({ src: SOURCES[0] })
  })

  it('0 초는 받지 않는다', async () => {
    // 0 이면 타이머가 한 틱에 목록을 다 돌아 화면이 깜빡인다.
    const wrapper = mountDialog(entries([SOURCES[0]]))

    const input = holdInput(wrapper, 0)
    input.element.value = '0'
    await input.trigger('change')

    expect(saved(wrapper)[0].duration_sec).toBe(1)
  })

  it('비워 둔 칸에는 기본값을 흐리게 보여 준다', () => {
    const wrapper = mountDialog(entries([SOURCES[0]]), { defaultInterval: 12 })
    expect(holdInput(wrapper, 0).attributes('placeholder')).toBe('12')
  })
})

describe('전환 효과', () => {
  it('장마다 효과를 고른다', async () => {
    const wrapper = mountDialog(entries(SOURCES))

    await fxSelect(wrapper, 1).setValue('slide-left')

    expect(saved(wrapper)[1]).toMatchObject({ transition: 'slide-left' })
    expect(saved(wrapper)[0].transition).toBeUndefined()
  })

  it('안 정한 장은 앨범 기본값을 이름으로 알린다', () => {
    // '기본값' 이라고만 두면 그것이 무엇인지 확인하러 나가야 한다.
    const wrapper = mountDialog(entries([SOURCES[0]]), { defaultTransition: 'dissolve' })

    expect(fxSelect(wrapper, 0).element.value).toBe('')
    expect(fxSelect(wrapper, 0).text()).toContain('디졸브')
  })

  it('효과를 고르면 전환 시간도 함께 잡아 준다', async () => {
    const wrapper = mountDialog(entries([SOURCES[0]]))

    await fxSelect(wrapper, 0).setValue('fade')

    expect(saved(wrapper)[0].transition_ms).toBe(600)
  })

  it('기본값으로 되돌리면 남은 설정을 지운다', async () => {
    const wrapper = mountDialog([{ src: SOURCES[0], transition: 'fade', transition_ms: 900 }])

    await fxSelect(wrapper, 0).setValue('')

    expect(saved(wrapper)[0]).toEqual({ src: SOURCES[0] })
  })

  it('효과 없음에는 시간을 남기지 않는다', async () => {
    const wrapper = mountDialog([{ src: SOURCES[0], transition: 'fade', transition_ms: 900 }])

    await fxSelect(wrapper, 0).setValue('none')

    expect(saved(wrapper)[0].transition_ms).toBeUndefined()
  })

  it('전환 시간을 고치고 한계 안으로 맞춘다', async () => {
    const wrapper = mountDialog([{ src: SOURCES[0], transition: 'fade', transition_ms: 600 }])

    const input = msInput(wrapper, 0)
    input.element.value = '99999'
    await input.trigger('change')

    expect(saved(wrapper)[0].transition_ms).toBe(5000)
  })

  it('효과가 없으면 시간 칸을 쓸 수 없다', () => {
    const wrapper = mountDialog([
      { src: SOURCES[0] },
      { src: SOURCES[1], transition: 'none' },
      { src: SOURCES[2], transition: 'fade' },
    ])

    expect(msInput(wrapper, 0).attributes('disabled')).toBeDefined()
    expect(msInput(wrapper, 1).attributes('disabled')).toBeDefined()
    expect(msInput(wrapper, 2).attributes('disabled')).toBeUndefined()
  })
})

describe('모두 적용', () => {
  it('한 번에 같은 효과를 편다', async () => {
    // 스무 장에 같은 효과를 주려고 스무 번 고르게 하면 안 된다.
    const wrapper = mountDialog(entries(SOURCES))

    await wrapper.find('.apply-all select').setValue('dissolve')

    expect(saved(wrapper).map((e) => e.transition)).toEqual([
      'dissolve',
      'dissolve',
      'dissolve',
    ])
  })

  it('한 번에 같은 유지 시간을 편다', async () => {
    const wrapper = mountDialog(entries(SOURCES))

    const input = wrapper.find('.apply-all .sec')
    input.element.value = '20'
    await input.trigger('change')

    expect(saved(wrapper).map((e) => e.duration_sec)).toEqual([20, 20, 20])
  })

  it('모두 기본값으로 되돌린다', async () => {
    const wrapper = mountDialog([
      { src: SOURCES[0], transition: 'fade', transition_ms: 900 },
      { src: SOURCES[1], transition: 'zoom', transition_ms: 400 },
    ])

    await wrapper.find('.apply-all select').setValue('')

    expect(saved(wrapper)).toEqual([{ src: SOURCES[0] }, { src: SOURCES[1] }])
  })
})

describe('순서와 빼기', () => {
  it('한 칸 위로 옮긴다', async () => {
    const wrapper = mountDialog(entries(SOURCES))

    await rows(wrapper)[1].findAll('.moves .btn')[0].trigger('click')

    expect(saved(wrapper).map((e) => e.src)).toEqual([SOURCES[1], SOURCES[0], SOURCES[2]])
  })

  it('한 칸 아래로 옮긴다', async () => {
    const wrapper = mountDialog(entries(SOURCES))

    await rows(wrapper)[0].findAll('.moves .btn')[1].trigger('click')

    expect(saved(wrapper).map((e) => e.src)).toEqual([SOURCES[1], SOURCES[0], SOURCES[2]])
  })

  it('끝에서는 더 못 옮기게 막는다', () => {
    const wrapper = mountDialog(entries(SOURCES))

    expect(rows(wrapper)[0].findAll('.moves .btn')[0].attributes('disabled')).toBeDefined()
    expect(rows(wrapper)[2].findAll('.moves .btn')[1].attributes('disabled')).toBeDefined()
  })

  it('한 장을 뺀다', async () => {
    const wrapper = mountDialog(entries(SOURCES))

    await rows(wrapper)[1].find('.danger').trigger('click')

    expect(saved(wrapper).map((e) => e.src)).toEqual([SOURCES[0], SOURCES[2]])
  })
})
