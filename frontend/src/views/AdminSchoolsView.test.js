/**
 * 학교 정보 관리(슈퍼관리자) 테스트.
 *
 * 이 화면의 약속: 학교 목록을 보여 주고, 엑셀/CSV 파일을 상위 기관과 함께
 * 올리며(기관타입 기본값 '학교'), 결과(등록/건너뜀/오류)를 그대로 보여 준다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const get = vi.fn()
const post = vi.fn()
const put = vi.fn()
const upload = vi.fn()
const del = vi.fn()

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: (...args) => post(...args),
    put: (...args) => put(...args),
    delete: (...args) => del(...args),
    upload: (...args) => upload(...args),
  },
  TEST_MODE: false,
  getToken: () => null,
  setToken: vi.fn(),
}))

import AdminSchoolsView from './AdminSchoolsView.vue'

let ORGS = []

function org_(over = {}) {
  return { id: 2, name: '서울시교육청', org_type: '기관', parent_id: 1, ...over }
}

async function mountView() {
  setActivePinia(createPinia())
  const wrapper = mount(AdminSchoolsView, {
    global: { plugins: [createPinia(), i18n] },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  ORGS = [
    org_(),
    org_({ id: 3, name: '가온초등학교', org_type: '학교', school_level: '초', parent_id: 2 }),
    org_({ id: 4, name: '나래중학교', org_type: '학교', school_level: '중', parent_id: 2 }),
  ]
  get.mockReset()
  post.mockReset()
  put.mockReset()
  upload.mockReset()
  del.mockReset()
  const orgTypes = [
    { id: 1, name: '기관', category: '기관', usage_count: 1 },
    { id: 2, name: '학교', category: '학교', usage_count: 2 },
  ]
  get.mockImplementation(async (path, params = {}) => {
    // 화면이 기관구분 마스터를 먼저 읽는다 — 분류(category)로 학교/기관을 가른다.
    if (path === '/org-types') return orgTypes
    // 학교 목록은 서버 페이징으로 받는다 — 목업도 같은 모양을 돌려준다.
    if (path === '/organizations/paged') {
      const names = new Set(
        orgTypes.filter((t) => t.category === params.category).map((t) => t.name),
      )
      let items = ORGS.filter((o) => !params.category || names.has(o.org_type))
      if (params.q) items = items.filter((o) => o.name.includes(params.q))
      items = [...items].sort((a, b) => a.name.localeCompare(b.name))
      const page = params.page ?? 1
      const size = params.size ?? 20
      return { items: items.slice((page - 1) * size, page * size), total: items.length, page, size }
    }
    return ORGS
  })
  upload.mockImplementation(async () => ({ created: 2, updated: 3, skipped: 1, errors: ['3행: 기관명이 비어 있습니다.'] }))
})

describe('목록', () => {
  it('학교만 골라 보여 준다(상위 기관 이름 포함)', async () => {
    const wrapper = await mountView()

    const rows = wrapper.findAll('[data-test="school-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('가온초등학교')
    expect(rows[0].text()).toContain('서울시교육청')
    // 상위 기관(교육청)은 목록에 나오지 않는다.
    expect(wrapper.text()).not.toContain('학교 3곳')
    // 한 페이지에 다 들어가면 페이저는 나오지 않는다.
    expect(wrapper.find('[data-test="pager"]').exists()).toBe(false)
  })

  it('20곳이 넘으면 페이지를 나눈다', async () => {
    ORGS = [
      org_(),
      ...Array.from({ length: 21 }, (_, at) =>
        org_({
          id: 10 + at,
          name: `벚꽃${String(at).padStart(2, '0')}초등학교`,
          org_type: '학교',
          parent_id: 2,
        }),
      ),
    ]
    const wrapper = await mountView()

    expect(wrapper.findAll('[data-test="school-row"]')).toHaveLength(20)
    expect(wrapper.find('[data-test="pager"]').text()).toContain('1 / 2')
    expect(wrapper.find('[data-test="prev-page"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-test="next-page"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-test="school-row"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="pager"]').text()).toContain('2 / 2')
    expect(wrapper.find('[data-test="next-page"]').attributes('disabled')).toBeDefined()
  })

  it('검색은 서버로 보내고 첫 페이지부터 다시 받는다', async () => {
    const wrapper = await mountView()

    await wrapper.find('[data-test="search"]').setValue('나래')
    await wrapper.find('[data-test="search"]').trigger('keyup.enter')
    await flushPromises()

    const rows = wrapper.findAll('[data-test="school-row"]')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('나래중학교')
    const lastCall = get.mock.calls.filter(([path]) => path === '/organizations/paged').at(-1)
    expect(lastCall[1]).toMatchObject({ category: '학교', q: '나래', page: 1 })
  })

  it('상위 기관 선택지는 기관 타입만 담는다', async () => {
    const wrapper = await mountView()

    const options = wrapper.find('[data-test="parent-select"]').findAll('option')
    expect(options.map((o) => o.text())).toEqual(['서울시교육청'])
  })
})

describe('일괄 등록', () => {
  it('파일 없이 누르면 올리지 않는다', async () => {
    const wrapper = await mountView()
    await wrapper.find('[data-test="upload"]').trigger('click')
    await flushPromises()

    expect(upload).not.toHaveBeenCalled()
  })

  it('파일과 상위 기관, 기본 타입(학교)을 함께 보낸다', async () => {
    const wrapper = await mountView()

    const input = wrapper.find('[data-test="file-input"]')
    Object.defineProperty(input.element, 'files', {
      value: [new File(['기관명\n어느학교\n'], 'schools.csv', { type: 'text/csv' })],
      configurable: true,
    })
    await input.trigger('change')
    await wrapper.find('[data-test="upload"]').trigger('click')
    await flushPromises()

    expect(upload).toHaveBeenCalledTimes(1)
    const [path, body, params] = upload.mock.calls[0]
    expect(path).toBe('/organizations/bulk-upload')
    expect(body.get('file').name).toBe('schools.csv')
    expect(params).toEqual({ parent_id: 2, default_org_type: '학교' })
  })

  it('좌표 파일을 고르면 함께 올린다', async () => {
    // 학교 정보와 위경도가 서로 다른 파일로 오는 경우 — 서버가 합친다.
    const wrapper = await mountView()

    const info = wrapper.find('[data-test="file-input"]')
    Object.defineProperty(info.element, 'files', {
      value: [new File(['x'], 'info.csv', { type: 'text/csv' })],
      configurable: true,
    })
    await info.trigger('change')

    const coords = wrapper.find('[data-test="coords-input"]')
    Object.defineProperty(coords.element, 'files', {
      value: [new File(['y'], 'coords.csv', { type: 'text/csv' })],
      configurable: true,
    })
    await coords.trigger('change')

    await wrapper.find('[data-test="upload"]').trigger('click')
    await flushPromises()

    const [, body] = upload.mock.calls[0]
    expect(body.get('file').name).toBe('info.csv')
    expect(body.get('coords_file').name).toBe('coords.csv')
  })

  it('결과(등록·건너뜀·오류)를 그대로 보여 준다', async () => {
    const wrapper = await mountView()

    const input = wrapper.find('[data-test="file-input"]')
    Object.defineProperty(input.element, 'files', {
      value: [new File(['x'], 'schools.xlsx')],
      configurable: true,
    })
    await input.trigger('change')
    await wrapper.find('[data-test="upload"]').trigger('click')
    await flushPromises()

    const resultBox = wrapper.find('[data-test="result"]')
    expect(resultBox.text()).toContain('등록 2건')
    // 같은 학교는 다시 만들지 않고 변경한다 — 몇 건이 바뀌었는지도 보여 준다.
    expect(resultBox.text()).toContain('변경 3건')
    expect(resultBox.text()).toContain('건너뜀 1건')
    expect(resultBox.text()).toContain('기관명이 비어 있습니다')
  })
})

describe('수정', () => {
  async function openFirstEdit(wrapper) {
    await wrapper.findAll('[data-test="edit"]')[0].trigger('click')
  }

  it('바뀐 칸만 저장한다', async () => {
    // 부분 갱신(PUT exclude_unset) — 안 만진 칸을 보내면 안 된다.
    put.mockResolvedValue({})
    const wrapper = await mountView()
    await openFirstEdit(wrapper)

    await wrapper.find('[data-test="edit-name"]').setValue('가온초등학교(새)')
    await wrapper.find('[data-test="edit-phone"]').setValue('02-777-7777')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(put).toHaveBeenCalledWith('/organizations/3', {
      name: '가온초등학교(새)',
      phone: '02-777-7777',
    })
    // 저장 뒤 목록을 다시 받고 창을 닫는다.
    expect(wrapper.find('[data-test="edit-name"]').exists()).toBe(false)
  })

  it('아무것도 안 바꾸면 보내지 않고 닫는다', async () => {
    const wrapper = await mountView()
    await openFirstEdit(wrapper)

    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(put).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="edit-name"]').exists()).toBe(false)
  })

  it('학교명을 비우면 그 자리에서 알린다', async () => {
    const wrapper = await mountView()
    await openFirstEdit(wrapper)

    await wrapper.find('[data-test="edit-name"]').setValue('')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(put).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="edit-error"]').text()).toContain('학교명')
  })

  it('위도가 숫자가 아니면 거부하고, 숫자면 숫자로 보낸다', async () => {
    put.mockResolvedValue({})
    const wrapper = await mountView()
    await openFirstEdit(wrapper)

    await wrapper.find('[data-test="edit-latitude"]').setValue('삼십칠')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()
    expect(put).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="edit-error"]').text()).toContain('숫자')

    await wrapper.find('[data-test="edit-latitude"]').setValue('37.55')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/organizations/3', { latitude: 37.55 })
  })
})

describe('일괄 삭제', () => {
  it('선택이 없으면 선택 삭제 버튼이 잠긴다', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('[data-test="delete-selected"]').attributes('disabled')).toBeDefined()
  })

  it('페이지 전체 선택 후 선택한 id 들을 보낸다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    post.mockResolvedValue({ deleted: 2, skipped: 0, errors: [] })
    const wrapper = await mountView()

    await wrapper.find('[data-test="select-all"]').trigger('change')
    await wrapper.find('[data-test="delete-selected"]').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/organizations/bulk-delete', { ids: [3, 4] })
  })

  it('검색 결과 전체 삭제는 검색 조건을 보낸다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    post.mockResolvedValue({ deleted: 1, skipped: 0, errors: [] })
    const wrapper = await mountView()

    await wrapper.find('[data-test="search"]').setValue('나래')
    await wrapper.find('[data-test="search"]').trigger('keyup.enter')
    await flushPromises()
    await wrapper.find('[data-test="delete-all"]').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/organizations/bulk-delete', {
      category: '학교',
      q: '나래',
    })
  })

  it('확인을 취소하면 지우지 않는다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = await mountView()

    await wrapper.find('[data-test="select-all"]').trigger('change')
    await wrapper.find('[data-test="delete-selected"]').trigger('click')
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
  })
})

describe('삭제', () => {
  it('확인 후 학교를 지우고 목록을 다시 받는다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    del.mockImplementation(async () => ({ detail: '기관이 삭제되었습니다.' }))
    const wrapper = await mountView()

    await wrapper.find('[data-test="school-row"] [data-test="remove"]').trigger('click')
    await flushPromises()

    expect(del).toHaveBeenCalledWith('/organizations/3')
  })
})
