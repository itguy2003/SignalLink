/**
 * 무료 스톡 소재 검색 테스트.
 *
 * 이 화면의 핵심은 **고른 것을 우리 자산으로 만든다**는 점이다. 바깥 주소를
 * 그대로 넘기면 폐쇄망 장치에서 표출되지 않는다 — 그래서 저장을 거치는지,
 * 저장이 준 주소를 넘기는지를 본다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

let STATUS = { configured: true, provider: 'pixabay' }
let RESULT = null
let searchError = null
let saveError = null

const get = vi.fn(async (path, params) => {
  if (path === '/stock/status') {
    if (!STATUS) throw new Error('down')
    return STATUS
  }
  if (path === '/stock/search') {
    if (searchError) throw searchError
    return RESULT ?? { items: [], total: 0, page: params?.page ?? 1, per_page: 24 }
  }
  return {}
})

/** 기본 동작. 테스트가 바꿔 쓴 구현은 beforeEach 에서 이것으로 되돌린다. */
async function defaultPost() {
  if (saveError) throw saveError
  return { id: 42, kind: 'image', filename: '바다.jpg', url: '/api/v1/assets/42/key/file' }
}

const post = vi.fn(defaultPost)

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: (...args) => post(...args),
  },
  TEST_MODE: false,
}))

import StockSearch from './StockSearch.vue'

function mountSearch(props = {}) {
  return mount(StockSearch, { props, global: { plugins: [i18n] } })
}

function hit(over = {}) {
  return {
    kind: 'image',
    id: 1,
    preview: 'https://cdn/preview.jpg',
    url: 'https://cdn/large.jpg',
    width: 1600,
    height: 800,
    tags: '바다, 하늘',
    author: '촬영자',
    page: 'https://pixabay.com/photos/1/',
    ...over,
  }
}

async function search(wrapper, keyword = '바다') {
  await wrapper.find('.search').setValue(keyword)
  await wrapper.find('.btn-primary').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  get.mockClear()
  post.mockReset()
  post.mockImplementation(defaultPost)
  STATUS = { configured: true, provider: 'pixabay' }
  RESULT = { items: [hit()], total: 1, page: 1, per_page: 24 }
  searchError = null
  saveError = null
})

describe('쓸 수 있는지 먼저 확인', () => {
  it('키가 없으면 검색창 대신 안내를 띄운다', async () => {
    // 눌러 보고 실패하게 두면 사용자가 검색어를 탓하게 된다.
    STATUS = { configured: false, provider: 'pixabay' }
    const wrapper = mountSearch()
    await flushPromises()

    expect(wrapper.find('.notice-warn').exists()).toBe(true)
    expect(wrapper.find('.search').exists()).toBe(false)
  })

  it('확인 자체가 실패해도 안내로 처리한다', async () => {
    STATUS = null
    const wrapper = mountSearch()
    await flushPromises()

    expect(wrapper.find('.notice-warn').exists()).toBe(true)
  })
})

describe('검색', () => {
  it('검색어가 비면 나가지 않는다', async () => {
    const wrapper = mountSearch()
    await flushPromises()
    get.mockClear()

    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    expect(get).not.toHaveBeenCalled()
  })

  it('찾은 것을 썸네일로 늘어놓는다', async () => {
    // 본 소재를 24개 늘어놓으면 수십 MB 가 오간다.
    const wrapper = mountSearch()
    await flushPromises()
    await search(wrapper)

    expect(wrapper.findAll('.tile')).toHaveLength(1)
    expect(wrapper.find('.tile img').attributes('src')).toBe('https://cdn/preview.jpg')
  })

  it('갈래를 서버에 알린다', async () => {
    const wrapper = mountSearch({ kind: 'video' })
    await flushPromises()
    await search(wrapper)

    expect(get.mock.calls.at(-1)[1]).toMatchObject({ kind: 'video' })
  })

  it('세로 콘텐츠면 세로 소재만 찾는다', async () => {
    // 세로 화면에 가로 사진을 넣으면 위아래가 잘리거나 띠가 남는다.
    const wrapper = mountSearch({ orientation: 'PORTRAIT' })
    await flushPromises()
    await search(wrapper)

    expect(get.mock.calls.at(-1)[1].orientation).toBe('vertical')
  })

  it('동영상에는 방향 조건을 걸지 않는다', async () => {
    // 제공처가 동영상에는 그 조건을 받지 않는다.
    const wrapper = mountSearch({ kind: 'video', orientation: 'PORTRAIT' })
    await flushPromises()
    await search(wrapper)

    expect(get.mock.calls.at(-1)[1].orientation).toBeUndefined()
  })

  it('없으면 없다고 말한다', async () => {
    RESULT = { items: [], total: 0, page: 1, per_page: 24 }
    const wrapper = mountSearch()
    await flushPromises()
    await search(wrapper)

    expect(wrapper.find('.table-empty').exists()).toBe(true)
  })

  it('실패하면 그 자리에서 알려 준다', async () => {
    searchError = { detail: '검색을 쓸 수 없습니다.' }
    const wrapper = mountSearch()
    await flushPromises()
    await search(wrapper)

    expect(wrapper.find('.error-text').text()).toContain('검색을 쓸 수 없습니다')
  })

  it('영상 길이를 분:초로 보여 준다', async () => {
    // 초만 적어 두면 얼마나 긴지 감이 오지 않는다.
    RESULT = { items: [hit({ kind: 'video', duration: 75 })], total: 1, page: 1, per_page: 24 }
    const wrapper = mountSearch({ kind: 'video' })
    await flushPromises()
    await search(wrapper)

    expect(wrapper.find('.meta').text()).toContain('1:15')
  })

  it('다음 쪽으로 넘어간다', async () => {
    RESULT = { items: [hit()], total: 50, page: 1, per_page: 24 }
    const wrapper = mountSearch()
    await flushPromises()
    await search(wrapper)

    await wrapper.findAll('.pager .btn')[1].trigger('click')
    await flushPromises()

    expect(get.mock.calls.at(-1)[1].page).toBe(2)
  })
})

describe('쪽을 넘겨도 창이 그대로 있는다', () => {
  it('찾기 전에도 쪽 이동 줄이 자리를 지킨다', async () => {
    // 없다가 생기면 그만큼 창이 뛰어, 다음 버튼이 눈 아래에서 도망간다.
    const wrapper = mountSearch()
    await flushPromises()

    expect(wrapper.find('.pager').exists()).toBe(true)
    expect(wrapper.find('.pager').classes()).toContain('blank')
  })

  it('찾고 나면 쪽 이동 줄을 드러낸다', async () => {
    const wrapper = mountSearch()
    await flushPromises()
    await search(wrapper)

    expect(wrapper.find('.pager').classes()).not.toContain('blank')
  })

  it('다음 쪽을 받는 동안 앞 쪽 결과를 지우지 않는다', async () => {
    // 지웠다 다시 그리면 그 사이 결과 칸이 비어 화면이 깜빡인다.
    let release
    RESULT = { items: [hit()], total: 50, page: 1, per_page: 24 }
    const wrapper = mountSearch()
    await flushPromises()
    await search(wrapper)

    get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    await wrapper.findAll('.pager .btn')[1].trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.tile')).toHaveLength(1)
    expect(wrapper.find('.results').classes()).toContain('busy')

    release({ items: [hit({ id: 2 })], total: 50, page: 2, per_page: 24 })
    await flushPromises()
    expect(wrapper.find('.results').classes()).not.toContain('busy')
  })

  it('쪽을 넘기면 결과 칸을 맨 위로 되돌린다', async () => {
    // 스크롤이 남아 있으면 새 쪽의 중간부터 보인다.
    const wrapper = mountSearch()
    await flushPromises()
    await search(wrapper)

    wrapper.find('.results').element.scrollTop = 300
    await search(wrapper)

    expect(wrapper.find('.results').element.scrollTop).toBe(0)
  })
})

describe('고르면 우리 것으로 만든다', () => {
  it('서버가 받아 저장하게 한다', async () => {
    const wrapper = mountSearch()
    await flushPromises()
    await search(wrapper)

    await wrapper.find('.tile').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith(
      '/stock/save',
      expect.objectContaining({ url: 'https://cdn/large.jpg', kind: 'image' }),
    )
  })

  it('바깥 주소가 아니라 저장된 주소를 넘긴다', async () => {
    // 이 한 줄이 폐쇄망 표출의 전부다.
    const wrapper = mountSearch()
    await flushPromises()
    await search(wrapper)

    await wrapper.find('.tile').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('select')[0][0].src).toBe('/api/v1/assets/42/key/file')
  })

  it('출처를 함께 넘긴다', async () => {
    const wrapper = mountSearch()
    await flushPromises()
    await search(wrapper)

    await wrapper.find('.tile').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('select')[0][0].credit).toEqual({
      source: 'pixabay',
      source_page: 'https://pixabay.com/photos/1/',
      author: '촬영자',
    })
  })

  it('원본 크기를 함께 넘긴다', async () => {
    // 받는 쪽이 이 비율로 상자를 잡는다.
    const wrapper = mountSearch()
    await flushPromises()
    await search(wrapper)

    await wrapper.find('.tile').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('select')[0][0].size).toEqual({ width: 1600, height: 800 })
  })

  it('라이브러리에서 알아볼 이름을 붙인다', async () => {
    const wrapper = mountSearch()
    await flushPromises()
    await search(wrapper)

    await wrapper.find('.tile').trigger('click')
    await flushPromises()

    expect(post.mock.calls[0][1].filename).toBe('바다.jpg')
  })

  it('기관을 정해 저장한다', async () => {
    const wrapper = mountSearch({ orgId: 3 })
    await flushPromises()
    await search(wrapper)

    await wrapper.find('.tile').trigger('click')
    await flushPromises()

    expect(post.mock.calls[0][1].org_id).toBe(3)
  })

  it('저장하는 동안 두 번 눌리지 않는다', async () => {
    // 큰 영상은 몇 초 걸린다. 그 사이 연타하면 같은 것이 여러 개 쌓인다.
    let release
    post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const wrapper = mountSearch()
    await flushPromises()
    await search(wrapper)

    await wrapper.find('.tile').trigger('click')
    await wrapper.find('.tile').trigger('click')
    expect(wrapper.find('.tile').attributes('disabled')).toBeDefined()

    release({ id: 42, url: '/api/v1/assets/42/key/file' })
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('저장이 실패하면 알리고 고른 것으로 치지 않는다', async () => {
    saveError = { detail: '파일은 20MB 이하여야 합니다.' }
    const wrapper = mountSearch()
    await flushPromises()
    await search(wrapper)

    await wrapper.find('.tile').trigger('click')
    await flushPromises()

    expect(wrapper.find('.error-text').text()).toContain('20MB')
    expect(wrapper.emitted('select')).toBeUndefined()
  })
})

describe('여러 장 고르기', () => {
  // 앨범을 채우려고 창을 스무 번 여닫게 하면 안 된다.

  function multi() {
    RESULT = {
      items: [hit({ id: 1 }), hit({ id: 2, url: 'https://cdn/b.jpg' })],
      total: 2,
      page: 1,
      per_page: 24,
    }
    return mountSearch({ multiple: true })
  }

  it('누르면 담기만 하고 아직 받지 않는다', async () => {
    // 고르는 동안 다 내려받으면, 마음이 바뀌어 뺀 것까지 라이브러리에 쌓인다.
    const wrapper = multi()
    await flushPromises()
    await search(wrapper)

    await wrapper.find('.tile').trigger('click')

    expect(post).not.toHaveBeenCalled()
    expect(wrapper.find('.tile').classes()).toContain('chosen')
  })

  it('다시 누르면 뺀다', async () => {
    const wrapper = multi()
    await flushPromises()
    await search(wrapper)

    await wrapper.find('.tile').trigger('click')
    await wrapper.find('.tile').trigger('click')

    expect(wrapper.find('.tile').classes()).not.toContain('chosen')
  })

  it('누른 순서를 번호로 보여 준다', async () => {
    const wrapper = multi()
    await flushPromises()
    await search(wrapper)

    await wrapper.findAll('.tile')[1].trigger('click')
    await wrapper.findAll('.tile')[0].trigger('click')

    expect(wrapper.findAll('.pick-mark').map((e) => e.text())).toEqual(['2', '1'])
  })

  it('추가를 누르면 담은 것을 모두 받아 저장한다', async () => {
    const wrapper = multi()
    await flushPromises()
    await search(wrapper)

    await wrapper.findAll('.tile')[0].trigger('click')
    await wrapper.findAll('.tile')[1].trigger('click')
    await wrapper.find('.picked-bar .btn-primary').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('select-many')[0][0]).toHaveLength(2)
  })

  it('담은 순서 그대로 올린다', async () => {
    const wrapper = multi()
    await flushPromises()
    await search(wrapper)

    await wrapper.findAll('.tile')[1].trigger('click')
    await wrapper.findAll('.tile')[0].trigger('click')
    await wrapper.find('.picked-bar .btn-primary').trigger('click')
    await flushPromises()

    expect(post.mock.calls.map((c) => c[1].url)).toEqual([
      'https://cdn/b.jpg',
      'https://cdn/large.jpg',
    ])
  })

  it('하나가 막혀도 나머지는 살린다', async () => {
    let call = 0
    post.mockImplementation(async () => {
      call += 1
      if (call === 1) throw { detail: '파일은 20MB 이하여야 합니다.' }
      return { id: 42, url: '/api/v1/assets/42/key/file' }
    })
    const wrapper = multi()
    await flushPromises()
    await search(wrapper)

    await wrapper.findAll('.tile')[0].trigger('click')
    await wrapper.findAll('.tile')[1].trigger('click')
    await wrapper.find('.picked-bar .btn-primary').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('select-many')[0][0]).toHaveLength(1)
    expect(wrapper.find('.error-text').text()).toContain('20MB')
  })

  it('담은 것을 올리고 나면 비운다', async () => {
    const wrapper = multi()
    await flushPromises()
    await search(wrapper)

    await wrapper.find('.tile').trigger('click')
    await wrapper.find('.picked-bar .btn-primary').trigger('click')
    await flushPromises()

    expect(wrapper.find('.tile').classes()).not.toContain('chosen')
  })

  it('쪽을 넘겨도 담은 것은 남는다', async () => {
    // 한 쪽에서만 고르게 하면 스무 장을 모으려고 창을 여러 번 여닫게 된다.
    RESULT = { items: [hit({ id: 1 })], total: 50, page: 1, per_page: 24 }
    const wrapper = mountSearch({ multiple: true })
    await flushPromises()
    await search(wrapper)

    await wrapper.find('.tile').trigger('click')
    RESULT = { items: [hit({ id: 9 })], total: 50, page: 2, per_page: 24 }
    await wrapper.findAll('.pager .btn')[1].trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('1장 선택')
  })

  it('한 장 모드는 예전처럼 누르는 즉시 담는다', async () => {
    const wrapper = mountSearch()
    await flushPromises()
    await search(wrapper)

    await wrapper.find('.tile').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('select')).toHaveLength(1)
    expect(wrapper.emitted('select-many')).toBeUndefined()
  })
})


describe('오래 걸리는 동안 알려 주기', () => {
  // 스무 장이면 서버가 스무 번 바깥에 다녀온다.

  const bar = (wrapper) => wrapper.findComponent({ name: 'ProgressBar' })

  it('한 장을 담는 동안 흐르는 띠를 보여 준다', async () => {
    // 서버가 제공처에서 받아 오는 중이라 얼마나 남았는지는 알 수 없다.
    let release
    post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const wrapper = mountSearch()
    await flushPromises()
    await search(wrapper)

    await wrapper.find('.tile').trigger('click')
    await flushPromises()

    expect(bar(wrapper).exists()).toBe(true)
    expect(bar(wrapper).props('value')).toBeNull()

    release({ id: 42, url: '/api/v1/assets/42/key/file' })
    await flushPromises()
    expect(bar(wrapper).exists()).toBe(false)
  })

  it('여러 장이면 몇 개째인지 센다', async () => {
    let release
    RESULT = {
      items: [hit({ id: 1 }), hit({ id: 2, url: 'https://cdn/b.jpg' })],
      total: 2,
      page: 1,
      per_page: 24,
    }
    const wrapper = mountSearch({ multiple: true })
    await flushPromises()
    await search(wrapper)

    await wrapper.findAll('.tile')[0].trigger('click')
    await wrapper.findAll('.tile')[1].trigger('click')

    post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    await wrapper.find('.picked-bar .btn-primary').trigger('click')
    await flushPromises()

    expect(bar(wrapper).props('detail')).toContain('2')
    expect(bar(wrapper).props('value')).toBe(0)

    release({ id: 42, url: '/api/v1/assets/42/key/file' })
    await flushPromises()
    expect(bar(wrapper).exists()).toBe(false)
  })

  it('실패해도 막대는 걷는다', async () => {
    saveError = { detail: '파일은 20MB 이하여야 합니다.' }
    const wrapper = mountSearch()
    await flushPromises()
    await search(wrapper)

    await wrapper.find('.tile').trigger('click')
    await flushPromises()

    expect(bar(wrapper).exists()).toBe(false)
  })
})
