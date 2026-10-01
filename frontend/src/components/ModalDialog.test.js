/**
 * 모달 창 테스트.
 *
 * 핵심은 "멋대로 닫히지 않는 것"이다. 편집하던 내용이 경고 없이 사라지기 때문이다.
 */
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { i18n } from '@/i18n'
import ModalDialog from './ModalDialog.vue'

function mountDialog(props = {}, slots = {}) {
  return mount(ModalDialog, {
    props: { title: '기관 수정', ...props },
    slots: { default: '<input class="name" /><textarea class="memo"></textarea>', ...slots },
    global: { plugins: [i18n] },
    attachTo: window.document.body,
  })
}

/** mousedown 을 한 곳에서, click 을 다른 곳에서 일으킨다. */
function pressThenClick(wrapper, pressSelector, clickSelector) {
  wrapper.find(pressSelector).element.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true }),
  )
  wrapper.find(clickSelector).element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
})

describe('닫기', () => {
  it('닫기(✕) 버튼으로 닫는다', async () => {
    const wrapper = mountDialog()
    await wrapper.find('.close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('취소 버튼으로 닫는다', async () => {
    const wrapper = mountDialog()
    await wrapper.find('.dialog-foot .btn').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('창 안을 눌러도 닫히지 않는다', () => {
    const wrapper = mountDialog()
    pressThenClick(wrapper, '.dialog-body', '.dialog-body')
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})

describe('멋대로 닫히지 않는다', () => {
  // 생성·수정 폼이 이 창으로 뜬다. 닫기는 언제나 명시적인 행동(✕/취소)으로만
  // 한다 — 무심코 바깥을 누른 순간 적던 내용이 사라지는 사고가 반복됐다.
  it('뒷배경을 눌러도 닫히지 않는다', () => {
    const wrapper = mountDialog()
    pressThenClick(wrapper, '.backdrop', '.backdrop')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('입력창에서 끌어 선택하다 창 밖에서 손을 떼도 닫히지 않는다', () => {
    // click 은 mousedown 과 mouseup 의 공통 조상(뒷배경)에서 발생한다 — 그래도
    // 닫히면 안 된다.
    const wrapper = mountDialog()
    pressThenClick(wrapper, '.name', '.backdrop')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('여러 줄 입력에서 끌어도 닫히지 않는다', () => {
    const wrapper = mountDialog()
    pressThenClick(wrapper, '.memo', '.backdrop')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('뒷배경에서 눌러 창 안에서 떼도 닫히지 않는다', () => {
    const wrapper = mountDialog()
    pressThenClick(wrapper, '.backdrop', '.dialog-body')
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})

describe('버튼 상태', () => {
  it('처리 중에는 확인과 취소를 막는다', () => {
    const wrapper = mountDialog({ busy: true })
    const buttons = wrapper.findAll('.dialog-foot .btn')
    expect(buttons[0].attributes('disabled')).toBeDefined()
    expect(buttons[1].attributes('disabled')).toBeDefined()
    expect(buttons[1].text()).toBe('처리 중…')
  })

  it('확인 버튼 이름을 바꿀 수 있다', () => {
    const wrapper = mountDialog({ confirmLabel: '업로드' })
    expect(wrapper.find('.dialog-foot .btn-primary').text()).toBe('업로드')
  })

  it('이름을 주지 않으면 저장으로 둔다', () => {
    expect(mountDialog().find('.dialog-foot .btn-primary').text()).toBe('저장')
  })

  it('높이를 주면 창 크기가 내용에 따라 변하지 않는다', () => {
    // 내용에 따라 창이 커졌다 작아졌다 하면 단추 위치가 흔들린다.
    // 넘치는 내용은 본문 스크롤의 몫이다.
    const fixed = mountDialog({ height: '80vh' })
    expect(fixed.find('.dialog').attributes('style')).toContain('height: 80vh')

    const auto = mountDialog()
    expect(auto.find('.dialog').attributes('style') ?? '').not.toContain('height')
  })

  it('바닥글을 숨길 수 있다', () => {
    expect(mountDialog({ hideFooter: true }).find('.dialog-foot').exists()).toBe(false)
  })
})
