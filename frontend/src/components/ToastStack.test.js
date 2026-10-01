/**
 * 알림 더미 테스트.
 *
 * 오류는 화면 가운데에 크게 — 구석의 작은 상자는 작업에 집중한 사람이
 * 놓치고, 놓친 오류는 "됐는 줄 알았다"가 된다. 성공·안내는 우하단에 조용히.
 * 오류의 사라짐 애니메이션은 수명(timeout)과 같아야 눈앞에서 갑자기
 * 사라지는 일이 없다.
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { i18n } from '@/i18n'
import { useToastStore } from '@/stores/toast'

import ToastStack from './ToastStack.vue'

let store

function mountStack() {
  return mount(ToastStack, { global: { plugins: [i18n] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  store = useToastStore()
  i18n.global.locale.value = 'ko'
})

describe('자리 배치', () => {
  it('오류는 가운데, 성공은 우하단으로 갈라 세운다', async () => {
    const wrapper = mountStack()
    store.error('저장에 실패했습니다.')
    store.success('저장했습니다.')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.toasts-center .toast-error').text()).toBe('저장에 실패했습니다.')
    expect(wrapper.find('.toasts .toast-success').text()).toBe('저장했습니다.')
    expect(wrapper.find('.toasts-center .toast-success').exists()).toBe(false)
  })

  it('오류의 사라짐 애니메이션은 수명과 같다', async () => {
    const wrapper = mountStack()
    store.error('오류!')
    await wrapper.vm.$nextTick()

    // 오류 수명은 6초(stores/toast.js) — 애니메이션도 6000ms 로 동기.
    expect(wrapper.find('.toast-error').attributes('style')).toContain('animation-duration: 6000ms')
  })
})

describe('닫기', () => {
  it('누르면 바로 사라진다', async () => {
    const wrapper = mountStack()
    store.error('닫힐 오류')
    await wrapper.vm.$nextTick()

    await wrapper.find('.toast-error').trigger('click')

    expect(wrapper.find('.toast-error').exists()).toBe(false)
  })

  it('수명이 다르면 애니메이션도 따라간다', async () => {
    const wrapper = mountStack()
    store.push('오래 남는 오류', 'error', 10000)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.toast-error').attributes('style')).toContain('animation-duration: 10000ms')
  })
})
