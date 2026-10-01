/**
 * 콘텐츠 브라우저 테스트 — 공유 구분 표시.
 *
 * 브라우저는 관리 범위의 콘텐츠에 더해, 공유 구분이 열어 준 다른 기관의
 * 콘텐츠도 보여 준다(shared 표식). 공유받은 것은 출처를 배지로 밝히고,
 * 남의 것이므로 수정으로는 들어가지 않는다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const get = vi.fn()

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  TEST_MODE: false,
  getToken: () => null,
  setToken: vi.fn(),
}))

import ContentBrowser from './ContentBrowser.vue'

function content_(over = {}) {
  return {
    id: 1,
    name: '아침 알림판',
    width: 1920,
    height: 1080,
    version: 1,
    usage_count: 0,
    element_count: 2,
    background: '#000000',
    org_name: '가나초등학교',
    share_scope: '없음',
    shared: false,
    ...over,
  }
}

async function mountBrowser() {
  setActivePinia(createPinia())
  const wrapper = mount(ContentBrowser, {
    props: { orgId: 3 },
    global: { plugins: [createPinia(), i18n] },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  get.mockReset()
  get.mockImplementation(async () => ({
    items: [
      content_(),
      content_({
        id: 2,
        name: '이웃 학교 안내',
        org_name: '다라중학교',
        share_scope: '소속기관',
        shared: true,
      }),
    ],
    total: 2,
    page: 1,
    size: 24,
  }))
})

describe('공유 구분 표시', () => {
  it('공유받은 카드에는 출처 배지가 붙는다', async () => {
    const wrapper = await mountBrowser()

    const badges = wrapper.findAll('[data-test="shared-badge"]')
    expect(badges).toHaveLength(1)
    expect(badges[0].text()).toContain('다라중학교')
    expect(badges[0].text()).toContain('소속기관')
  })

  it('공유받은 카드에는 수정 링크가 없다', async () => {
    const wrapper = await mountBrowser()

    const cards = wrapper.findAll('.card-item')
    expect(cards[0].find('.edit-link').exists()).toBe(true)
    expect(cards[1].find('.edit-link').exists()).toBe(false)
  })

  it('공유받은 콘텐츠도 골라 넣을 수 있다', async () => {
    const wrapper = await mountBrowser()

    await wrapper.findAll('.card-item')[1].trigger('click')

    expect(wrapper.emitted('select')[0][0].id).toBe(2)
  })

  it('공유 필터를 바꾸면 share 파라미터로 다시 불러온다', async () => {
    const wrapper = await mountBrowser()
    get.mockClear()

    await wrapper.find('[data-test="share-filter"]').setValue('shared')
    await flushPromises()

    const [path, params] = get.mock.calls.at(-1)
    expect(path).toBe('/contents')
    expect(params.share).toBe('shared')
    // 스케줄 기관이 공유 판정의 기준이므로 org_id 도 함께 간다.
    expect(params.org_id).toBe(3)
  })

  it('기본 조회는 공유 포함 전체다(share 파라미터 없음)', async () => {
    await mountBrowser()

    const [, params] = get.mock.calls[0]
    expect(params.share).toBeUndefined()
  })
})
