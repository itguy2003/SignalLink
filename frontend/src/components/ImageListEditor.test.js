/**
 * 속성 패널의 사진 칸 테스트.
 *
 * 이 칸은 **무엇이 담겼는지만** 보여 준다. 실제 편집은 넓은 창에서 한다 —
 * 스무 장을 좁은 속성 칸에서 다루면 한 줄이 세 겹으로 접히고 캔버스가 그만큼
 * 좁아진다. 그래도 빼기와 순서 바꾸기는 여기서도 되어야 한다(한 장 빼려고
 * 창을 여는 것은 지나치다).
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

import ImageListEditor from './ImageListEditor.vue'

const SOURCES = ['/api/v1/assets/1/k/file', '/api/v1/assets/2/k/file', '/api/v1/assets/3/k/file']

function mountEditor(modelValue = [], props = {}) {
  return mount(ImageListEditor, {
    props: { modelValue, ...props },
    global: { plugins: [i18n] },
  })
}

const entries = (list) => list.map((src) => ({ src }))

/** 마지막으로 올라간 목록. */
function saved(wrapper) {
  const events = wrapper.emitted('update:modelValue')
  return events ? events.at(-1)[0] : null
}

const editor = (wrapper) => wrapper.findComponent({ name: 'AlbumEditorDialog' })

beforeEach(() => {
  i18n.global.locale.value = 'ko'
})

describe('담긴 것 보여 주기', () => {
  it('비어 있으면 그렇게 말한다', () => {
    const wrapper = mountEditor()
    expect(wrapper.text()).toContain('아직 넣은 사진이 없습니다')
  })

  it('넣은 순서대로 번호를 붙여 보여 준다', () => {
    // 몇 번째로 나오는지가 이 칸의 핵심 정보다.
    const wrapper = mountEditor(entries(SOURCES))

    expect(wrapper.findAll('.item')).toHaveLength(3)
    expect(wrapper.findAll('.order').map((e) => e.text())).toEqual(['1', '2', '3'])
  })

  it('주소 문자열만 든 옛 문서도 읽는다', () => {
    const wrapper = mountEditor(SOURCES)
    expect(wrapper.findAll('.item')).toHaveLength(3)
  })

  it('주소가 없는 칸은 세지 않는다', () => {
    const wrapper = mountEditor([{ src: '' }, { src: SOURCES[0] }])
    expect(wrapper.findAll('.item')).toHaveLength(1)
  })

  it('장마다 따로 정한 것이 있으면 알린다', () => {
    // 여기서는 안 보이는 설정이라, 있다는 사실만이라도 알려야 한다.
    const wrapper = mountEditor([{ src: SOURCES[0], transition: 'fade' }])
    expect(wrapper.text()).toContain('장마다 따로 정한 설정')
  })

  it('따로 정한 것이 없으면 조용하다', () => {
    const wrapper = mountEditor(entries(SOURCES))
    expect(wrapper.text()).not.toContain('장마다 따로 정한 설정')
  })
})

describe('편집 창 열기', () => {
  it('비어 있으면 담으라고 하고, 있으면 고치라고 한다', () => {
    expect(mountEditor().find('.open').text()).toBe('사진 추가')
    expect(mountEditor(entries(SOURCES)).find('.open').text()).toBe('사진 편집')
  })

  it('누르면 넓은 편집 창이 열린다', async () => {
    const wrapper = mountEditor()
    expect(editor(wrapper).exists()).toBe(false)

    await wrapper.find('.open').trigger('click')

    expect(editor(wrapper).exists()).toBe(true)
  })

  it('지금 목록과 기관을 창에 넘긴다', async () => {
    const images = entries(SOURCES)
    const wrapper = mountEditor(images, { orgId: 3 })
    await wrapper.find('.open').trigger('click')

    expect(editor(wrapper).props('modelValue')).toEqual(images)
    expect(editor(wrapper).props('orgId')).toBe(3)
  })

  it('앨범 기본값도 함께 넘긴다', async () => {
    // 창에서 '기본값 따름' 이 무엇인지 이름으로 보여 주려면 필요하다.
    const wrapper = mountEditor([], { defaultTransition: 'dissolve', defaultInterval: 12 })
    await wrapper.find('.open').trigger('click')

    expect(editor(wrapper).props('defaultTransition')).toBe('dissolve')
    expect(editor(wrapper).props('defaultInterval')).toBe(12)
  })

  it('창에서 고친 것을 그대로 올린다', async () => {
    const wrapper = mountEditor(entries([SOURCES[0]]))
    await wrapper.find('.open').trigger('click')

    const next = entries(SOURCES)
    editor(wrapper).vm.$emit('update:modelValue', next)

    expect(saved(wrapper)).toEqual(next)
  })

  it('닫으면 창이 사라진다', async () => {
    const wrapper = mountEditor()
    await wrapper.find('.open').trigger('click')

    editor(wrapper).vm.$emit('close')
    await wrapper.vm.$nextTick()

    expect(editor(wrapper).exists()).toBe(false)
  })
})

describe('여기서도 되는 것', () => {
  it('한 장을 뺀다', async () => {
    // 한 장 빼려고 창을 여는 것은 지나치다.
    const wrapper = mountEditor(entries(SOURCES))

    await wrapper.findAll('.danger')[1].trigger('click')

    expect(saved(wrapper).map((e) => e.src)).toEqual([SOURCES[0], SOURCES[2]])
  })

  it('한 칸 위로 옮긴다', async () => {
    const wrapper = mountEditor(entries(SOURCES))

    await wrapper.findAll('.moves .btn')[2].trigger('click') // 두 번째 줄의 ↑

    expect(saved(wrapper).map((e) => e.src)).toEqual([SOURCES[1], SOURCES[0], SOURCES[2]])
  })

  it('한 칸 아래로 옮긴다', async () => {
    const wrapper = mountEditor(entries(SOURCES))

    await wrapper.findAll('.moves .btn')[1].trigger('click') // 첫 줄의 ↓

    expect(saved(wrapper).map((e) => e.src)).toEqual([SOURCES[1], SOURCES[0], SOURCES[2]])
  })

  it('끝에서는 더 못 옮기게 막는다', () => {
    // 눌러도 아무 일 없는 버튼은 고장으로 읽힌다.
    const wrapper = mountEditor(entries(SOURCES))
    const moves = wrapper.findAll('.moves .btn')

    expect(moves[0].attributes('disabled')).toBeDefined() // 첫 줄의 ↑
    expect(moves.at(-1).attributes('disabled')).toBeDefined() // 마지막 줄의 ↓
  })
})
