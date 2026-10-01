/**
 * 레이어 끌어 옮기기 — 공용 ModalDialog 로 확인한다(다른 레이어도 같은
 * composable 을 쓴다). 머리글을 잡고 끌면 창이 translate 로 따라오고, 머리글
 * 안의 버튼(✕)에서 시작한 누름은 끌기가 아니다.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { i18n } from '@/i18n'
import ModalDialog from '@/components/ModalDialog.vue'

function mountDialog() {
  return mount(ModalDialog, {
    props: { title: '테스트 창' },
    global: { plugins: [i18n] },
  })
}

function moveMouse(x, y) {
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }))
}

describe('레이어 끌어 옮기기', () => {
  it('머리글을 잡고 끌면 창이 그만큼 옮겨진다', async () => {
    const wrapper = mountDialog()
    const dialog = wrapper.find('.dialog')
    expect(dialog.attributes('style')).toContain('translate(0px, 0px)')

    await wrapper.find('[data-test="drag-handle"]').trigger('mousedown', {
      button: 0,
      clientX: 100,
      clientY: 100,
    })
    moveMouse(140, 160)
    await wrapper.vm.$nextTick()
    expect(dialog.attributes('style')).toContain('translate(40px, 60px)')

    // 놓은 뒤에는 더 움직이지 않는다.
    window.dispatchEvent(new MouseEvent('mouseup'))
    moveMouse(500, 500)
    await wrapper.vm.$nextTick()
    expect(dialog.attributes('style')).toContain('translate(40px, 60px)')
  })

  it('머리글 안의 버튼(✕)에서 시작한 누름은 끌기가 아니다', async () => {
    const wrapper = mountDialog()
    await wrapper.find('.close').trigger('mousedown', { button: 0, clientX: 10, clientY: 10 })
    moveMouse(90, 90)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.dialog').attributes('style')).toContain('translate(0px, 0px)')
  })
})
