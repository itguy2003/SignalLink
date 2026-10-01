/**
 * 기관구분 관리(슈퍼관리자) 테스트.
 *
 * 약속: 기관구분은 데이터다 — 추가·이름수정(사용 중이어도)이 되고,
 * 사용 중인 구분은 삭제 버튼이 잠긴다(서버도 거절한다).
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const get = vi.fn()
const post = vi.fn()
const put = vi.fn()
const del = vi.fn()

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: (...args) => post(...args),
    put: (...args) => put(...args),
    delete: (...args) => del(...args),
  },
  TEST_MODE: false,
  getToken: () => null,
  setToken: vi.fn(),
}))

import AdminOrgTypesView from './AdminOrgTypesView.vue'

let TYPES = []

async function mountView() {
  setActivePinia(createPinia())
  const wrapper = mount(AdminOrgTypesView, {
    global: { plugins: [createPinia(), i18n] },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  TYPES = [
    { id: 1, name: '기관', category: '기관', classifications: '', usage_count: 3 },
    { id: 2, name: '학교', category: '학교', classifications: '초,중,고', usage_count: 12 },
    { id: 3, name: '기타', category: '기타', classifications: '', usage_count: 0 },
  ]
  get.mockReset()
  post.mockReset()
  put.mockReset()
  del.mockReset()
  get.mockImplementation(async () => TYPES)
})

describe('목록', () => {
  it('구분마다 이름·분류·사용 기관 수를 보여 준다', async () => {
    const wrapper = await mountView()

    const rows = wrapper.findAll('[data-test="type-row"]')
    expect(rows).toHaveLength(3)
    expect(rows[0].find('[data-test="name-input"]').element.value).toBe('기관')
    expect(rows[1].text()).toContain('12곳')
  })
})

describe('수정', () => {
  it('바꾸기 전에는 저장이 잠겨 있다', async () => {
    const wrapper = await mountView()
    expect(
      wrapper.find('[data-test="type-row"] [data-test="save"]').attributes('disabled'),
    ).toBeDefined()
  })

  it('사용 중이어도 이름을 바꿔 저장할 수 있다', async () => {
    // 삭제만 막는다 — 수정은 서버가 사용 중인 기관들도 함께 옮긴다.
    put.mockResolvedValueOnce({})
    const wrapper = await mountView()

    await wrapper.find('[data-test="name-input"]').setValue('교육기관')
    await wrapper.find('[data-test="type-row"] [data-test="save"]').trigger('click')
    await flushPromises()

    expect(put).toHaveBeenCalledWith('/org-types/1', {
      name: '교육기관',
      category: '기관',
      classifications: '',
    })
  })
})

describe('삭제', () => {
  it('사용 중인 구분은 삭제 버튼이 잠기고 이유를 단다', async () => {
    const wrapper = await mountView()

    const rows = wrapper.findAll('[data-test="type-row"]')
    const inUse = rows[0].find('[data-test="remove"]')
    expect(inUse.attributes('disabled')).toBeDefined()
    expect(inUse.attributes('title')).toContain('삭제할 수 없습니다')
  })

  it('사용하지 않는 구분은 지울 수 있다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    del.mockResolvedValueOnce({ detail: '기관구분이 삭제되었습니다.' })
    const wrapper = await mountView()

    const unused = wrapper.findAll('[data-test="type-row"]')[2]
    expect(unused.find('[data-test="remove"]').attributes('disabled')).toBeUndefined()
    await unused.find('[data-test="remove"]').trigger('click')
    await flushPromises()

    expect(del).toHaveBeenCalledWith('/org-types/3')
  })
})

describe('추가', () => {
  it('이름과 분류로 새 구분을 만든다', async () => {
    post.mockResolvedValueOnce({})
    const wrapper = await mountView()

    await wrapper.find('[data-test="new-name"]').setValue('평생교육원')
    await wrapper.find('[data-test="new-category"]').setValue('기타')
    await wrapper.find('[data-test="add"]').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/org-types', {
      name: '평생교육원',
      category: '기타',
      classifications: '',
    })
  })

  it('이름 없이 누르면 보내지 않는다', async () => {
    const wrapper = await mountView()
    await wrapper.find('[data-test="add"]').trigger('click')
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
  })
})

describe('분류(선택지)', () => {
  // 기관구분마다 고를 수 있는 분류가 다르다 — 쉼표로 여러 값을 넣고,
  // 기관 등록 화면이 쪼개어 드롭다운으로 쓴다.
  it('저장된 분류를 입력칸에 보여 준다', async () => {
    const wrapper = await mountView()

    const inputs = wrapper.findAll('[data-test="classifications-input"]')
    expect(inputs[1].element.value).toBe('초,중,고')
    expect(inputs[0].element.value).toBe('')
  })

  it('분류를 고쳐 저장하면 그대로 보낸다', async () => {
    put.mockResolvedValueOnce({})
    const wrapper = await mountView()

    await wrapper.findAll('[data-test="classifications-input"]')[2].setValue('본원,분원')
    await wrapper.findAll('[data-test="type-row"]')[2].find('[data-test="save"]').trigger('click')
    await flushPromises()

    expect(put).toHaveBeenCalledWith('/org-types/3', {
      name: '기타',
      category: '기타',
      classifications: '본원,분원',
    })
  })

  it('새 구분에도 분류를 함께 넣는다', async () => {
    post.mockResolvedValueOnce({})
    const wrapper = await mountView()

    await wrapper.find('[data-test="new-name"]').setValue('지역센터')
    await wrapper.find('[data-test="new-classifications"]').setValue('본원,분원')
    await wrapper.find('[data-test="add"]').trigger('click')
    await flushPromises()

    expect(post.mock.calls[0][1].classifications).toBe('본원,분원')
  })
})
