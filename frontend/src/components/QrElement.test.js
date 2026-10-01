/**
 * QR코드 요소 테스트.
 *
 * 약속: 내용이 있으면 실제 QR 이미지(데이터 URL)를 만들고, 내용이 비면
 * 그럴듯한 가짜 대신 자리 표시를 남긴다 — 스캔 안 되는 QR 이 장치에
 * 올라가는 사고를 막는다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { i18n } from '@/i18n'

import QrElement from './QrElement.vue'

function mountQr(props = {}) {
  return mount(QrElement, {
    props: { text: 'https://example.kr', ...props },
    global: { plugins: [i18n] },
  })
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
})

describe('QR코드 생성', () => {
  it('내용으로 진짜 QR 이미지를 만든다', async () => {
    const wrapper = mountQr()
    await flushPromises()

    const img = wrapper.find('.qr-img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toMatch(/^data:image\/svg\+xml/)
  })

  it('내용이 비면 이미지 대신 자리 표시를 남긴다', async () => {
    const wrapper = mountQr({ text: '  ' })
    await flushPromises()

    expect(wrapper.find('.qr-img').exists()).toBe(false)
    expect(wrapper.find('.qr-empty').text()).toContain('내용을 입력하면')
  })

  it('내용을 바꾸면 코드도 다시 만든다', async () => {
    const wrapper = mountQr()
    await flushPromises()
    const before = wrapper.find('.qr-img').attributes('src')

    await wrapper.setProps({ text: 'https://example.kr/other' })
    await flushPromises()

    expect(wrapper.find('.qr-img').attributes('src')).not.toBe(before)
  })

  it('색을 바꾸면 그 색으로 다시 그린다', async () => {
    const wrapper = mountQr()
    await flushPromises()
    const before = wrapper.find('.qr-img').attributes('src')

    await wrapper.setProps({ foreground: '#112233' })
    await flushPromises()

    expect(wrapper.find('.qr-img').attributes('src')).not.toBe(before)
  })
})
