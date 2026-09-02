/**
 * 왼쪽 요소·위젯 레일 테스트.
 */
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'
import WidgetRail from './WidgetRail.vue'
import { ELEMENT_DND_TYPE } from '@/utils/contentDnd'
import { widgetIcon } from '@/utils/widgetSamples'

const WIDGETS = [
  { key: 'notice', name: '공지사항', category: '기능형', description: '수집한 공지', default_size: { w: 700, h: 500 }, options: [] },
  { key: 'clock', name: '시계', category: '기능형', description: '현재 시각', default_size: { w: 400, h: 200 }, options: [] },
  { key: 'video', name: '동영상', category: '콘텐츠형', description: '영상 재생', default_size: { w: 600, h: 400 }, options: [] },
]

function mountRail(props = {}) {
  return mount(WidgetRail, {
    props: { widgets: WIDGETS, ...props },
    global: { plugins: [i18n] },
  })
}

/** dragstart 에서 실제로 쓰이는 최소 스텁. */
function dragStub() {
  const store = {}
  return {
    dataTransfer: {
      effectAllowed: '',
      setData: (type, value) => {
        store[type] = value
      },
      get store() {
        return store
      },
    },
  }
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
})

describe('레일 구성', () => {
  it('기본 요소와 위젯을 아이콘으로 세운다', () => {
    const wrapper = mountRail()
    // 기본 4개(글자·이미지·동영상·웹) + 위젯 3개 + 재생목록 고르기 1개
    expect(wrapper.findAll('.rail-btn')).toHaveLength(8)
  })

  it('이름 대신 아이콘만 보여 준다', () => {
    const wrapper = mountRail()
    const notice = wrapper.findAll('.rail-btn').find((b) => b.attributes('aria-label') === '공지사항')
    expect(notice.text()).toBe(widgetIcon('notice'))
    expect(notice.text()).not.toContain('공지사항')
  })

  it('이름과 설명을 툴팁으로 알려 준다', () => {
    // 아이콘만으로는 무엇인지 알 수 없으므로 툴팁이 유일한 안내다.
    const wrapper = mountRail()
    const clock = wrapper.findAll('.rail-btn').find((b) => b.attributes('aria-label') === '시계')
    expect(clock.attributes('title')).toBe('시계 — 현재 시각')
  })

  it('위젯을 카테고리로 묶는다', () => {
    const wrapper = mountRail()
    const labels = wrapper.findAll('.rail-label').map((l) => l.text())
    expect(labels).toEqual(['기본', '기능형', '콘텐츠형', '재생목록'])
  })

  it('텍스트는 글자 아이콘을 쓴다', () => {
    const wrapper = mountRail()
    expect(wrapper.find('.icon.letter').text()).toBe('T')
  })

  it('위젯이 없어도 기본 요소는 나온다', () => {
    const wrapper = mountRail({ widgets: [] })
    // 기본 4개 + 재생목록 고르기 1개.
    expect(wrapper.findAll('.rail-btn')).toHaveLength(5)
  })

  it('아이콘을 두 개씩 늘어놓는다', () => {
    // 한 줄로 세우면 위젯이 늘어날수록 아래쪽이 스크롤 밖으로 밀린다.
    const wrapper = mountRail()
    expect(wrapper.findAll('.rail-btns').length).toBe(4)
  })

  it('언어를 바꾸면 묶음 이름도 바뀐다', async () => {
    const wrapper = mountRail()
    i18n.global.locale.value = 'en'
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.rail-label')[0].text()).toBe('Basic')
  })
})

describe('누르면 추가', () => {
  it('기본 요소는 종류만 올린다', async () => {
    const wrapper = mountRail()
    await wrapper.findAll('.rail-btn')[0].trigger('click')
    expect(wrapper.emitted('add')[0][0]).toEqual({ type: 'text' })
  })

  it('위젯은 종류와 키를 함께 올린다', async () => {
    const wrapper = mountRail()
    const clock = wrapper.findAll('.rail-btn').find((b) => b.attributes('aria-label') === '시계')
    await clock.trigger('click')
    expect(wrapper.emitted('add')[0][0]).toEqual({ type: 'widget', widgetKey: 'clock' })
  })
})

describe('끌어다 놓기', () => {
  it('아이콘을 끌 수 있다', () => {
    expect(mountRail().find('.rail-btn').attributes('draggable')).toBe('true')
  })

  it('끌기 시작하면 요소 정보를 실어 보낸다', async () => {
    const wrapper = mountRail()
    const stub = dragStub()
    const clock = wrapper.findAll('.rail-btn').find((b) => b.attributes('aria-label') === '시계')

    await clock.trigger('dragstart', stub)

    expect(JSON.parse(stub.dataTransfer.store[ELEMENT_DND_TYPE])).toEqual({
      type: 'widget',
      widgetKey: 'clock',
    })
  })

  it('기본 요소도 같은 형식으로 실어 보낸다', async () => {
    const wrapper = mountRail()
    const stub = dragStub()

    await wrapper.findAll('.rail-btn')[0].trigger('dragstart', stub)

    expect(JSON.parse(stub.dataTransfer.store[ELEMENT_DND_TYPE])).toEqual({
      type: 'text',
      widgetKey: null,
    })
  })

  it('일부 브라우저를 위해 text/plain 도 함께 넣는다', async () => {
    // 이 값이 없으면 드래그가 시작조차 되지 않는 브라우저가 있다.
    const wrapper = mountRail()
    const stub = dragStub()
    await wrapper.findAll('.rail-btn')[0].trigger('dragstart', stub)
    expect(stub.dataTransfer.store['text/plain']).toBe('텍스트')
  })
})

describe('재생목록 묶음', () => {
  it('입구를 하나만 둔다', () => {
    // 아이콘만 봐서는 재생목록끼리 구분되지 않는다(전부 같은 🔁 다).
    // 어느 목록인지는 캔버스가 띄우는 고르기 레이어에서 고른다.
    const wrapper = mountRail()
    expect(wrapper.findAll('.rail-btn.pick')).toHaveLength(1)
  })

  it('누르면 목록을 지정하지 않고 올린다', async () => {
    // 캔버스가 고르기 레이어를 열어야 한다.
    const wrapper = mountRail()
    await wrapper.find('.rail-btn.pick').trigger('click')

    expect(wrapper.emitted('add').at(-1)[0]).toEqual({ type: 'playlist' })
  })

  it('끌어다 놓는 것도 마찬가지다', async () => {
    const wrapper = mountRail()
    const stub = dragStub()
    await wrapper.find('.rail-btn.pick').trigger('dragstart', stub)

    expect(JSON.parse(stub.dataTransfer.store[ELEMENT_DND_TYPE])).toEqual({
      type: 'playlist',
      widgetKey: null,
    })
  })
})

describe('분할 영역 안내', () => {
  it('영역을 골라 두면 레일을 강조한다', () => {
    expect(mountRail({ targetRegion: 1 }).find('.rail').classes()).toContain('targeting')
  })

  it('고른 영역이 없으면 강조하지 않는다', () => {
    expect(mountRail().find('.rail').classes()).not.toContain('targeting')
  })
})

describe('아이콘 표', () => {
  it('요구사항의 위젯들에 서로 다른 아이콘을 준다', () => {
    const keys = ['notice', 'meal', 'timetable', 'dday', 'quote', 'clock', 'weather']
    const icons = keys.map(widgetIcon)
    expect(new Set(icons).size).toBe(keys.length)
  })

  it('모르는 위젯도 자리를 차지한다', () => {
    expect(widgetIcon('없는위젯')).toBeTruthy()
  })
})
