/**
 * 커뮤니티 메타정보 레이어 테스트.
 *
 * 약속: 선택지는 기관구분 관리(/org-types)의 구분·분류에서 나오고, 값은
 * 레이어 안에서만 고치다가 **확인에만** 실려 나간다 — 취소는 아무 일도
 * 없던 것으로. 제목이 비면 확인이 눌리지 않는다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const get = vi.fn(async (path) => {
  if (path === '/org-types') {
    return [
      { id: 1, name: '기관', classifications: '' },
      { id: 2, name: '학교', classifications: '초,중,고' },
      { id: 3, name: '기타', classifications: '' },
      { id: 4, name: '유치원', classifications: '' },
    ]
  }
  return null
})

vi.mock('@/api/client', () => ({
  api: { get: (...args) => get(...args) },
  TEST_MODE: false,
}))

import CommunityMetaDialog from './CommunityMetaDialog.vue'

async function mountDialog(initial = {}) {
  const wrapper = mount(CommunityMetaDialog, {
    props: { initial },
    global: { plugins: [i18n] },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  get.mockClear()
})

describe('메타정보 레이어', () => {
  it('라벨 ⇒ 입력 2열 폼으로 다섯 항목을 받는다', async () => {
    const wrapper = await mountDialog()
    for (const test of [
      'editor-title',
      'editor-targets',
      'notice-start',
      'notice-end',
      'editor-contact',
      'editor-memo',
    ]) {
      expect(wrapper.find(`[data-test="${test}"]`).exists(), test).toBe(true)
    }
    // 메모는 여러 줄 입력이다.
    expect(wrapper.find('[data-test="editor-memo"]').element.tagName).toBe('TEXTAREA')
  })

  it('공지대상 선택지는 기관구분 관리의 구분과 분류(세부 구분)다', async () => {
    const wrapper = await mountDialog()
    const labels = wrapper
      .findAll('[data-test="editor-targets"] .target-check')
      .map((node) => node.text())
    expect(labels).toEqual(['기관', '학교', '초', '중', '고', '기타', '유치원'])
  })

  it('시작 값을 채워 주고, 확인에 고친 값을 실어 보낸다', async () => {
    const wrapper = await mountDialog({
      title: '가을 축제',
      memo: '메모',
      target_org_types: ['학교'],
      notice_start: '2026-10-01',
      notice_end: '2026-10-14',
      contact: '02-123',
    })
    expect(wrapper.find('[data-test="editor-title"]').element.value).toBe('가을 축제')

    await wrapper.find('input[value="학교:초"]').setValue(true)
    await wrapper.find('[data-test="editor-memo"]').setValue('고친 메모')
    await wrapper.find('[data-test="close-meta"]').trigger('click')

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.emitted('confirm')[0][0]).toEqual({
      title: '가을 축제',
      memo: '고친 메모',
      target_org_types: ['학교', '학교:초'],
      notice_start: '2026-10-01',
      notice_end: '2026-10-14',
      contact: '02-123',
    })
  })

  it('제목이 비면 확인이 눌리지 않는다', async () => {
    const wrapper = await mountDialog()
    expect(wrapper.find('[data-test="close-meta"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[data-test="close-meta"]').trigger('click')
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('취소는 아무 값도 실어 보내지 않는다', async () => {
    const wrapper = await mountDialog({ title: '원래 제목' })
    await wrapper.find('[data-test="editor-title"]').setValue('버릴 제목')
    await wrapper.find('[data-test="cancel-meta"]').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('배경을 눌러도 닫히지 않는다 — 드래그 선택·크기 조절 중 입력을 잃지 않는다', async () => {
    const wrapper = await mountDialog({ title: '쓰던 제목' })
    await wrapper.find('[data-test="editor-title"]').setValue('쓰던 제목 이어서')
    await wrapper.find('[data-test="meta-layer"]').trigger('click')

    expect(wrapper.emitted('cancel')).toBeUndefined()
    expect(wrapper.find('[data-test="editor-title"]').element.value).toBe('쓰던 제목 이어서')
  })
})
