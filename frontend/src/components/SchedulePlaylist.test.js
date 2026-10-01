/**
 * 재생 목록(목록반복 스케줄) 편집기 테스트.
 */
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { i18n } from '@/i18n'
import SchedulePlaylist from './SchedulePlaylist.vue'
import { CONTENT_DND_TYPE, PLAYLIST_ITEM_DND_TYPE } from '@/utils/contentDnd'

function entry(id, name, duration = 15) {
  return {
    id: null,
    day_of_week: -1,
    start_time: null,
    end_time: null,
    sort_order: 0,
    duration_sec: duration,
    content_id: id,
    content_name: name,
    content: {},
  }
}

function mountList(items) {
  return mount(SchedulePlaylist, {
    props: { items },
    global: { plugins: [createPinia(), i18n] },
  })
}

/** 콘텐츠 카드 드래그를 흉내 낸다. */
function dragEvent(payload) {
  return {
    dataTransfer: {
      types: [CONTENT_DND_TYPE],
      getData: () => JSON.stringify(payload),
      dropEffect: '',
    },
    preventDefault: () => {},
  }
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
})

describe('목록 표시', () => {
  it('순서 번호와 이름을 보여 준다', () => {
    const wrapper = mountList([entry(1, '아침 알림판'), entry(2, '오후 화면')])
    expect(wrapper.findAll('.order').map((o) => o.text())).toEqual(['1', '2'])
    expect(wrapper.text()).toContain('아침 알림판')
  })

  it('한 바퀴 도는 데 걸리는 시간을 계산한다', () => {
    const wrapper = mountList([entry(1, 'A', 30), entry(2, 'B', 45)])
    expect(wrapper.find('.total').text()).toContain('1분 15초')
  })

  it('1분 미만이면 초만 보여 준다', () => {
    const wrapper = mountList([entry(1, 'A', 20)])
    expect(wrapper.find('.total').text()).toContain('20초')
  })

  it('비어 있으면 끌어다 놓으라고 안내한다', () => {
    const wrapper = mountList([])
    expect(wrapper.find('.drop-zone').exists()).toBe(true)
  })

  it('콘텐츠가 없는 항목을 경고한다', () => {
    const wrapper = mountList([entry(null, null)])
    expect(wrapper.find('.warn').text()).toContain('1개')
    expect(wrapper.find('.name').classes()).toContain('missing')
  })

  it('요일이 지정된 항목은 표시해 준다', () => {
    // 시간지정에서 넘어온 아이템이 섞여 있을 수 있다.
    const item = { ...entry(1, 'A'), day_of_week: 2 }
    expect(mountList([item]).text()).toContain('요일 지정됨')
  })
})

describe('순서 바꾸기', () => {
  it('위로 옮기면 앞 항목과 자리를 바꾼다', async () => {
    const items = [entry(1, 'A'), entry(2, 'B')]
    const wrapper = mountList(items)

    await wrapper.findAll('.item')[1].findAll('.btn-icon')[0].trigger('click')

    expect(items.map((i) => i.content_name)).toEqual(['B', 'A'])
    expect(wrapper.emitted('change')).toHaveLength(1)
  })

  it('아래로 옮기면 뒤 항목과 자리를 바꾼다', async () => {
    const items = [entry(1, 'A'), entry(2, 'B')]
    const wrapper = mountList(items)

    await wrapper.findAll('.item')[0].findAll('.btn-icon')[1].trigger('click')

    expect(items.map((i) => i.content_name)).toEqual(['B', 'A'])
  })

  it('첫 항목의 위로 버튼과 마지막 항목의 아래로 버튼은 비활성이다', () => {
    const wrapper = mountList([entry(1, 'A'), entry(2, 'B')])
    const first = wrapper.findAll('.item')[0].findAll('.btn-icon')
    const last = wrapper.findAll('.item')[1].findAll('.btn-icon')
    expect(first[0].attributes('disabled')).toBeDefined()
    expect(last[1].attributes('disabled')).toBeDefined()
  })
})

describe('항목 편집', () => {
  it('표출 시간을 바꾼다', async () => {
    const items = [entry(1, 'A', 15)]
    const wrapper = mountList(items)

    await wrapper.find('.duration .input').setValue('30')
    await wrapper.find('.duration .input').trigger('change')

    expect(items[0].duration_sec).toBe(30)
  })

  it('0 이하는 최소 1초로 올린다', async () => {
    const items = [entry(1, 'A', 15)]
    const wrapper = mountList(items)

    await wrapper.find('.duration .input').setValue('0')
    await wrapper.find('.duration .input').trigger('change')

    expect(items[0].duration_sec).toBe(1)
  })

  it('전환 효과를 고르면 항목에 반영되고 변경을 알린다', async () => {
    const items = [entry(1, 'A'), entry(2, 'B')]
    const wrapper = mountList(items)

    await wrapper.findAll('.transition .select')[1].setValue('fade')
    expect(items[1].transition).toBe('fade')
    expect(wrapper.emitted('change')).toBeTruthy()
  })

  it('전환 시간이 표출 시간을 넘으면 경고한다', () => {
    // 3초 칸에 5초 전환 — 효과가 끝나기 전에 다음으로 넘어간다.
    const items = [{ ...entry(1, 'A', 3), transition: 'fade', transition_ms: 5000 }]
    const wrapper = mountList(items)

    expect(wrapper.find('.warn').exists()).toBe(true)
    expect(wrapper.find('.transition').classes()).toContain('bad')
  })

  it('모두 적용을 고르면 전체 항목의 전환이 바뀐다', async () => {
    const items = [entry(1, 'A'), entry(2, 'B')]
    const wrapper = mountList(items)

    await wrapper.find('.apply-all').setValue('dissolve')
    expect(items.map((i) => i.transition)).toEqual(['dissolve', 'dissolve'])
  })

  it('삭제하면 목록에서 빠진다', async () => {
    const items = [entry(1, 'A'), entry(2, 'B')]
    const wrapper = mountList(items)

    await wrapper.findAll('.item')[0].find('.btn-danger').trigger('click')

    expect(items).toHaveLength(1)
    expect(items[0].content_name).toBe('B')
  })

  it('복제하면 바로 뒤에 같은 내용이 생긴다', async () => {
    const items = [entry(1, 'A')]
    const wrapper = mountList(items)

    const buttons = wrapper.findAll('.item .btn')
    const duplicateButton = buttons.find((b) => b.text() === '⧉')
    await duplicateButton.trigger('click')

    expect(items).toHaveLength(2)
    expect(items[1].content_id).toBe(1)
    // 새 항목이므로 서버 id 는 비워 둔다.
    expect(items[1].id).toBeNull()
  })
})

describe('드래그 앤 드롭', () => {
  it('빈 목록에 떨어뜨리면 이벤트를 올린다', async () => {
    const wrapper = mountList([])
    await wrapper.find('.drop-zone').trigger('drop', dragEvent({ id: 7, name: '새 콘텐츠' }))

    const dropped = wrapper.emitted('dropContent')
    expect(dropped).toHaveLength(1)
    expect(dropped[0][0].index).toBe(0)
  })

  it('항목 위에 떨어뜨리면 그 자리 인덱스를 알린다', async () => {
    const wrapper = mountList([entry(1, 'A'), entry(2, 'B')])
    await wrapper.findAll('.item')[1].trigger('drop', dragEvent({ id: 7, name: 'C' }))

    expect(wrapper.emitted('dropContent')[0][0].index).toBe(1)
  })

  it('맨 아래 영역에 떨어뜨리면 끝에 붙인다', async () => {
    const items = [entry(1, 'A')]
    const wrapper = mountList(items)
    await wrapper.find('.tail-drop').trigger('drop', dragEvent({ id: 7, name: 'C' }))

    expect(wrapper.emitted('dropContent')[0][0].index).toBe(items.length)
  })

  it('우리 드래그가 아니면 무시한다', async () => {
    // 파일이나 글자 드래그가 목록에 떨어져도 아무 일이 없어야 한다.
    const wrapper = mountList([entry(1, 'A')])
    await wrapper.findAll('.item')[0].trigger('drop', {
      dataTransfer: { types: ['Files'], getData: () => '' },
      preventDefault: () => {},
    })

    expect(wrapper.emitted('dropContent')).toBeUndefined()
  })

  it('드래그가 지나가면 놓일 자리를 표시한다', async () => {
    const wrapper = mountList([entry(1, 'A'), entry(2, 'B')])
    await wrapper.findAll('.item')[1].trigger('dragover', dragEvent({ id: 7, name: 'C' }))

    expect(wrapper.findAll('.item')[1].classes()).toContain('drop-before')
  })
})


/** 목록 항목 자체를 끄는 드래그를 흉내 낸다. */
function itemDrag(fromIndex) {
  return {
    dataTransfer: {
      types: [PLAYLIST_ITEM_DND_TYPE],
      getData: () => String(fromIndex),
      // dragstart 경로에서 실제로 쓰이므로 스텁이 필요하다.
      setData: () => {},
      dropEffect: '',
      effectAllowed: '',
    },
    preventDefault: () => {},
  }
}

describe('드래그로 순서 바꾸기', () => {
  it('항목을 끌 수 있다', () => {
    const wrapper = mountList([entry(1, 'A'), entry(2, 'B')])
    expect(wrapper.find('.item').attributes('draggable')).toBe('true')
    expect(wrapper.find('.grip').exists()).toBe(true)
  })

  it('아래 항목 위로 끌면 순서가 바뀐다', async () => {
    const items = [entry(1, 'A'), entry(2, 'B'), entry(3, 'C')]
    const wrapper = mountList(items)

    // 3번째(C)를 첫 자리에 떨어뜨린다.
    await wrapper.findAll('.item')[0].trigger('drop', itemDrag(2))

    expect(items.map((i) => i.content_name)).toEqual(['C', 'A', 'B'])
    expect(wrapper.emitted('change')).toHaveLength(1)
  })

  it('아래로 옮길 때 자리 보정이 된다', async () => {
    const items = [entry(1, 'A'), entry(2, 'B'), entry(3, 'C')]
    const wrapper = mountList(items)

    // A 를 C 자리(index 2)에 떨어뜨리면 B 뒤로 간다.
    await wrapper.findAll('.item')[2].trigger('drop', itemDrag(0))

    expect(items.map((i) => i.content_name)).toEqual(['B', 'A', 'C'])
  })

  it('맨 아래 영역에 떨어뜨리면 끝으로 간다', async () => {
    const items = [entry(1, 'A'), entry(2, 'B')]
    const wrapper = mountList(items)

    await wrapper.find('.tail-drop').trigger('drop', itemDrag(0))

    expect(items.map((i) => i.content_name)).toEqual(['B', 'A'])
  })

  it('제자리에 놓으면 아무 일도 없다', async () => {
    const items = [entry(1, 'A'), entry(2, 'B')]
    const wrapper = mountList(items)

    await wrapper.findAll('.item')[0].trigger('drop', itemDrag(0))

    expect(items.map((i) => i.content_name)).toEqual(['A', 'B'])
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('재정렬 드래그는 콘텐츠 추가로 처리하지 않는다', async () => {
    // 같은 타입으로 두면 순서 변경이 새 항목 추가로 오해된다.
    const wrapper = mountList([entry(1, 'A'), entry(2, 'B')])
    await wrapper.findAll('.item')[0].trigger('drop', itemDrag(1))
    expect(wrapper.emitted('dropContent')).toBeUndefined()
  })

  it('라이브러리 카드 드롭은 여전히 추가로 처리한다', async () => {
    const wrapper = mountList([entry(1, 'A')])
    await wrapper.findAll('.item')[0].trigger('drop', dragEvent({ kind: 'content', id: 9, name: 'X' }))
    expect(wrapper.emitted('dropContent')).toHaveLength(1)
  })

  it('끌고 있는 항목을 흐리게 표시한다', async () => {
    const wrapper = mountList([entry(1, 'A'), entry(2, 'B')])
    await wrapper.findAll('.item')[1].trigger('dragstart', itemDrag(1))
    expect(wrapper.findAll('.item')[1].classes()).toContain('dragging')
  })
})
