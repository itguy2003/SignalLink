/**
 * 위젯 재생목록 편집기 테스트.
 *
 * 스케줄 관리의 목록형 편집기와 같은 짜임이다 — 왼쪽에서 끌어다 오른쪽에
 * 놓고, 순서를 바꾸고, 저장한다. 확인할 것도 그 흐름에 몰려 있다:
 * 끌어다 놓은 것이 그 자리에 들어가는가, 순서가 그대로 저장되는가,
 * 저장 없이 나갈 때 붙잡는가.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'
import { CONTENT_DND_TYPE, PLAYLIST_ITEM_DND_TYPE } from '@/utils/contentDnd'

const WIDGETS = [
  { key: 'notice', name: '공지사항', category: '기능형', description: '학교 공지', options: [] },
  { key: 'meal', name: '급식메뉴', category: '기능형', description: '오늘 급식', options: [] },
  { key: 'photo', name: '앨범', category: '콘텐츠형', description: '사진', options: [] },
]

let playlist = null

const post = vi.fn(async () => ({ id: 9, name: '새 목록', version: 1, usage_count: 0, items: [] }))
const put = vi.fn(async (path, body) => ({ id: 1, version: 3, usage_count: 0, ...body }))
const get = vi.fn(async (path) => {
  if (path === '/widgets') return WIDGETS
  if (path.startsWith('/playlists/')) {
    if (!playlist) throw { detail: '재생목록을 찾을 수 없습니다.' }
    return playlist
  }
  return {}
})

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: (...args) => post(...args),
    put: (...args) => put(...args),
  },
  TEST_MODE: false,
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: { org_id: 3 } }),
}))

const replace = vi.fn(async () => {})
let routeParams = { id: '1' }

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: routeParams }),
  useRouter: () => ({ replace: (...args) => replace(...args) }),
  onBeforeRouteLeave: (fn) => {
    leaveGuard = fn
  },
}))

let leaveGuard = null

import PlaylistEditorView from './PlaylistEditorView.vue'

async function mountView() {
  setActivePinia(createPinia())
  const wrapper = mount(PlaylistEditorView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  })
  await flushPromises()
  return wrapper
}

/** 왼쪽 위젯 카드를 끄는 드래그. 콘텐츠 목록과 같은 MIME 을 쓴다. */
function widgetDrag(key, name = key) {
  return {
    dataTransfer: {
      types: [CONTENT_DND_TYPE],
      getData: () => JSON.stringify({ kind: 'widget', key, name, width: 1920, height: 1080 }),
      setData: () => {},
      dropEffect: '',
      effectAllowed: '',
    },
    preventDefault: () => {},
  }
}

/** 목록 항목 자체를 끄는 드래그(순서 바꾸기). */
function itemDrag(fromIndex) {
  return {
    dataTransfer: {
      types: [PLAYLIST_ITEM_DND_TYPE],
      getData: () => String(fromIndex),
      setData: () => {},
      dropEffect: '',
      effectAllowed: '',
    },
    preventDefault: () => {},
  }
}

const names = (wrapper) => wrapper.findAll('.playlist .item .name').map((n) => n.text())

const saveButton = (wrapper) => wrapper.find('.head .btn-primary')

beforeEach(() => {
  routeParams = { id: '1' }
  leaveGuard = null
  playlist = {
    id: 1,
    name: '현관 순환',
    description: '공지 → 급식',
    version: 2,
    usage_count: 1,
    total_duration_sec: 25,
    items: [
      { id: 1, sort_order: 0, widget_key: 'notice', duration_sec: 15, options: {} },
      { id: 2, sort_order: 1, widget_key: 'meal', duration_sec: 10, options: {} },
    ],
  }
  get.mockClear()
  post.mockClear()
  put.mockClear()
  replace.mockClear()
  i18n.global.locale.value = 'ko'
})

describe('짜임', () => {
  it('왼쪽에 위젯 목록, 오른쪽에 재생 순서를 둔다', async () => {
    // 스케줄 목록형 편집기와 같은 자리다.
    const wrapper = await mountView()
    expect(wrapper.find('.with-library .library').exists()).toBe(true)
    expect(wrapper.find('.with-library .playlist').exists()).toBe(true)
  })

  it('제목을 그 자리에서 고친다', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('.title-input').element.value).toBe('현관 순환')
  })

  it('버전과 사용 건수를 보여 준다', async () => {
    // 고쳐도 되는지 판단하려면 어디서 쓰는지 알아야 한다.
    const wrapper = await mountView()
    expect(wrapper.find('.head').text()).toContain('v2')
    expect(wrapper.find('.head').text()).toContain('1건')
  })

  it('위젯을 카테고리로 묶어 보여 준다', async () => {
    const wrapper = await mountView()
    expect(wrapper.findAll('.library .group-title').length).toBe(2)
  })

  it('현재 순서를 채워 연다', async () => {
    const wrapper = await mountView()
    expect(names(wrapper)).toEqual(['공지사항', '급식메뉴'])
  })

  it('없는 재생목록이면 그렇게 말한다', async () => {
    playlist = null
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('찾을 수 없습니다')
  })
})

describe('위젯 담기', () => {
  it('끌어다 놓으면 그 자리에 들어간다', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('.playlist .item')[0].trigger('drop', widgetDrag('photo', '앨범'))

    expect(names(wrapper)).toEqual(['앨범', '공지사항', '급식메뉴'])
  })

  it('맨 아래 영역에 놓으면 끝에 붙는다', async () => {
    const wrapper = await mountView()
    await wrapper.find('.playlist .tail-drop').trigger('drop', widgetDrag('photo', '앨범'))

    expect(names(wrapper)).toEqual(['공지사항', '급식메뉴', '앨범'])
  })

  it('눌러서도 담을 수 있다', async () => {
    // 끌어 놓기가 어려운 환경도 있다.
    const wrapper = await mountView()
    await wrapper.findAll('.library .card-item .btn')[0].trigger('click')

    expect(names(wrapper)).toHaveLength(3)
  })

  it('기본 표출 시간을 채워 준다', async () => {
    const wrapper = await mountView()
    await wrapper.find('.playlist .tail-drop').trigger('drop', widgetDrag('photo'))

    const inputs = wrapper.findAll('.playlist .duration input')
    expect(inputs[inputs.length - 1].element.value).toBe('10')
  })

  it('콘텐츠 카드는 받지 않는다', async () => {
    // 재생목록에는 위젯만 담긴다. 스케줄 편집기에서 끌어와도 무시한다.
    const wrapper = await mountView()
    await wrapper.find('.playlist .tail-drop').trigger('drop', {
      dataTransfer: {
        types: [CONTENT_DND_TYPE],
        getData: () => JSON.stringify({ kind: 'content', id: 5, name: '안내' }),
      },
      preventDefault: () => {},
    })

    expect(names(wrapper)).toEqual(['공지사항', '급식메뉴'])
  })

  it('비어 있으면 놓을 자리를 보여 준다', async () => {
    playlist.items = []
    const wrapper = await mountView()
    expect(wrapper.find('.playlist .drop-zone').exists()).toBe(true)

    await wrapper.find('.playlist .drop-zone').trigger('drop', widgetDrag('notice', '공지사항'))
    expect(names(wrapper)).toEqual(['공지사항'])
  })
})

describe('순서 바꾸기', () => {
  it('끌어서 앞으로 옮긴다', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('.playlist .item')[0].trigger('drop', itemDrag(1))

    expect(names(wrapper)).toEqual(['급식메뉴', '공지사항'])
  })

  it('끼어들 자리를 표시한다', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('.playlist .item')[1].trigger('dragover', itemDrag(0))

    expect(wrapper.findAll('.playlist .item')[1].classes()).toContain('drop-before')
  })

  it('버튼으로도 옮긴다', async () => {
    const wrapper = await mountView()
    const buttons = wrapper.findAll('.playlist .item')[0].findAll('.actions .btn')
    await buttons[1].trigger('click') // ↓

    expect(names(wrapper)).toEqual(['급식메뉴', '공지사항'])
  })

  it('맨 위는 더 올릴 수 없다', async () => {
    const wrapper = await mountView()
    const buttons = wrapper.findAll('.playlist .item')[0].findAll('.actions .btn')
    expect(buttons[0].attributes('disabled')).toBeDefined()
  })

  it('빼면 목록에서 사라진다', async () => {
    const wrapper = await mountView()
    const buttons = wrapper.findAll('.playlist .item')[0].findAll('.actions .btn')
    await buttons[3].trigger('click') // ✕

    expect(names(wrapper)).toEqual(['급식메뉴'])
  })

  it('같은 위젯을 한 번 더 담는다', async () => {
    // 앞뒤로 같은 것을 끼우는 편성이 흔하다.
    const wrapper = await mountView()
    const buttons = wrapper.findAll('.playlist .item')[0].findAll('.actions .btn')
    await buttons[2].trigger('click') // ⧉

    expect(names(wrapper)).toEqual(['공지사항', '공지사항', '급식메뉴'])
  })
})

describe('전환 효과', () => {
  const fxSelect = (wrapper, at) =>
    wrapper.findAll('.playlist .item')[at].find('.transition select')

  const msInput = (wrapper, at) =>
    wrapper.findAll('.playlist .item')[at].find('.transition .ms')

  it('칸마다 고를 수 있다', async () => {
    // 공지에서 급식으로는 부드럽게, 사진은 확 바뀌게 — 내용에 따라 다르다.
    const wrapper = await mountView()
    expect(wrapper.findAll('.playlist .transition select')).toHaveLength(2)
  })

  it('저장된 효과를 채워 연다', async () => {
    playlist.items[0].transition = 'fade'
    const wrapper = await mountView()
    expect(fxSelect(wrapper, 0).element.value).toBe('fade')
  })

  it('새로 담은 칸은 없음으로 시작한다', async () => {
    // 효과가 기본이면 원치 않는 사람이 매번 꺼야 한다.
    const wrapper = await mountView()
    await wrapper.find('.playlist .tail-drop').trigger('drop', widgetDrag('photo'))

    expect(fxSelect(wrapper, 2).element.value).toBe('none')
  })

  it('고른 효과를 저장한다', async () => {
    const wrapper = await mountView()
    await fxSelect(wrapper, 1).setValue('slide-left')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(put.mock.calls[0][1].items.map((i) => i.transition)).toEqual(['none', 'slide-left'])
  })

  it('사라진 효과가 저장돼 있으면 없음으로 떨어뜨린다', async () => {
    // 선택 상자가 빈 채로 열리면 무엇이 걸려 있는지 알 수 없다.
    playlist.items[0].transition = '사라진효과'
    const wrapper = await mountView()
    expect(fxSelect(wrapper, 0).element.value).toBe('none')
  })

  it('한 번에 모두 적용할 수 있다', async () => {
    // 칸이 많으면 하나씩 고르는 일이 고역이다.
    const wrapper = await mountView()
    await wrapper.find('.playlist .apply-all').setValue('zoom')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(put.mock.calls[0][1].items.map((i) => i.transition)).toEqual(['zoom', 'zoom'])
  })

  it('안내 문구를 되고르면 아무 일도 없다', async () => {
    const wrapper = await mountView()
    await fxSelect(wrapper, 0).setValue('fade')
    await wrapper.find('.playlist .apply-all').setValue('')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(put.mock.calls[0][1].items[0].transition).toBe('fade')
  })

  it('칸이 하나면 모두 적용을 내놓지 않는다', async () => {
    playlist.items = [playlist.items[0]]
    const wrapper = await mountView()
    expect(wrapper.find('.playlist .apply-all').exists()).toBe(false)
  })

  it('묶어서 보여 준다', async () => {
    // 열몇 개를 한 줄로 늘어놓으면 원하는 것을 찾는 데 시간이 걸린다.
    const wrapper = await mountView()
    const groups = fxSelect(wrapper, 0).findAll('optgroup')
    expect(groups.map((g) => g.attributes('label'))).toEqual(['기본', '밀기', '닦기', '확대·회전'])
  })

  it('늘어난 효과를 모두 고를 수 있다', async () => {
    const wrapper = await mountView()
    const values = fxSelect(wrapper, 0)
      .findAll('option')
      .map((o) => o.element.value)
    expect(values).toContain('dissolve')
    expect(values).toContain('blur')
    expect(values).toContain('wipe-left')
    expect(values).toContain('flip')
    expect(values).toHaveLength(14)
  })

  it('전환 시간을 칸마다 정한다', async () => {
    const wrapper = await mountView()
    await fxSelect(wrapper, 0).setValue('fade')
    await msInput(wrapper, 0).setValue('1200')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(put.mock.calls[0][1].items[0].transition_ms).toBe(1200)
  })

  it('기본 전환 시간은 600ms 다', async () => {
    // 지금까지 모든 전환이 쓰던 값. 기존 재생목록의 표출이 달라지면 안 된다.
    const wrapper = await mountView()
    expect(msInput(wrapper, 0).element.value).toBe('600')
  })

  it('효과가 없으면 시간 칸을 잠근다', async () => {
    // 쓰이지 않는 값을 고치게 두면 헛일이다.
    const wrapper = await mountView()
    expect(msInput(wrapper, 0).attributes('disabled')).toBeDefined()

    await fxSelect(wrapper, 0).setValue('fade')
    expect(msInput(wrapper, 0).attributes('disabled')).toBeUndefined()
  })

  it('범위를 벗어난 시간은 끌어다 맞춘다', async () => {
    const wrapper = await mountView()
    await fxSelect(wrapper, 0).setValue('fade')
    await msInput(wrapper, 0).setValue('99999')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(put.mock.calls[0][1].items[0].transition_ms).toBe(5000)
  })

  it('표출 시간보다 길면 그 자리에서 알려 준다', async () => {
    // 효과가 끝나기 전에 넘어가면 화면이 영영 제자리에 놓이지 않는다.
    playlist.items[0].duration_sec = 3
    const wrapper = await mountView()
    await fxSelect(wrapper, 0).setValue('fade')
    await msInput(wrapper, 0).setValue('5000')

    expect(wrapper.findAll('.playlist .item')[0].text()).toContain('길 수 없습니다')
  })

  it('효과가 없으면 길이를 따지지 않는다', async () => {
    // 쓰이지 않는 값으로 경고를 띄우면 고칠 수 없는 경고가 된다.
    const wrapper = await mountView()
    expect(wrapper.findAll('.playlist .item')[0].text()).not.toContain('길 수 없습니다')
  })

  it('효과를 고치면 미저장으로 표시한다', async () => {
    const wrapper = await mountView()
    await fxSelect(wrapper, 0).setValue('fade')
    expect(wrapper.find('.head').text()).toContain('저장 안 됨')
  })
})

describe('저장', () => {
  it('바뀐 순서 그대로 저장한다', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('.playlist .item')[0].trigger('drop', itemDrag(1))
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(put.mock.calls[0][0]).toBe('/playlists/1')
    expect(put.mock.calls[0][1].items.map((i) => i.widget_key)).toEqual(['meal', 'notice'])
  })

  it('표출 시간을 함께 보낸다', async () => {
    const wrapper = await mountView()
    await wrapper.find('.playlist .duration input').setValue('30')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(put.mock.calls[0][1].items[0].duration_sec).toBe(30)
  })

  it('이름이 비면 저장하지 않는다', async () => {
    const wrapper = await mountView()
    await wrapper.find('.title-input').setValue('   ')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(put).not.toHaveBeenCalled()
  })

  it('저장하면 미저장 표시가 사라진다', async () => {
    const wrapper = await mountView()
    await wrapper.find('.title-input').setValue('새 이름')
    expect(wrapper.find('.head').text()).toContain('저장 안 됨')

    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.find('.head').text()).not.toContain('저장 안 됨')
  })
})

describe('새로 만들기', () => {
  beforeEach(() => {
    routeParams = {}
  })

  it('빈 목록으로 연다', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('.playlist .drop-zone').exists()).toBe(true)
    expect(wrapper.find('.title-input').element.value).toBe('')
  })

  it('아직 저장 전이라고 말한다', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('.head').text()).toContain('저장하지 않은')
  })

  it('만들고 나면 수정 화면으로 갈아탄다', async () => {
    // 다시 저장했을 때 또 만들어지면 안 된다.
    const wrapper = await mountView()
    await wrapper.find('.title-input').setValue('아침 순환')
    await wrapper.find('.playlist .drop-zone').trigger('drop', widgetDrag('notice', '공지사항'))
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(post.mock.calls[0][1].items.map((i) => i.widget_key)).toEqual(['notice'])
    expect(replace).toHaveBeenCalledWith('/playlists/9/edit')
  })

  it('위젯 없이도 만들 수 있다', async () => {
    // 먼저 만들어 두고 나중에 담는 흐름을 막을 이유가 없다.
    const wrapper = await mountView()
    await wrapper.find('.title-input').setValue('빈 목록')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(post.mock.calls[0][1].items).toEqual([])
  })
})

describe('미리보기', () => {
  const previewButton = (wrapper) =>
    wrapper.findAll('.head .btn').find((b) => b.text() === '미리보기')

  it('지금 순서 그대로 재생한다', async () => {
    // 저장해야만 볼 수 있으면 시간 맞추기가 저장-확인-수정의 반복이 된다.
    const wrapper = await mountView()
    await wrapper.findAll('.playlist .item')[0].trigger('drop', itemDrag(1))
    await previewButton(wrapper).trigger('click')

    const preview = wrapper.findComponent({ name: 'PlaylistPreview' })
    expect(preview.props('items').map((i) => i.widget_key)).toEqual(['meal', 'notice'])
  })

  it('위젯 명세를 넘겨 이름과 내용을 그린다', async () => {
    const wrapper = await mountView()
    await previewButton(wrapper).trigger('click')

    const preview = wrapper.findComponent({ name: 'PlaylistPreview' })
    expect(preview.props('widgets')).toHaveLength(WIDGETS.length)
  })

  it('담긴 위젯이 없으면 열 수 없다', async () => {
    // 볼 것이 없는 창을 여는 것은 막다른 길이다.
    playlist.items = []
    const wrapper = await mountView()
    expect(previewButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('닫으면 사라진다', async () => {
    const wrapper = await mountView()
    await previewButton(wrapper).trigger('click')
    wrapper.findComponent({ name: 'PlaylistPreview' }).vm.$emit('close')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'PlaylistPreview' }).exists()).toBe(false)
  })
})

describe('나가기', () => {
  it('안 고쳤으면 그냥 보낸다', async () => {
    await mountView()
    expect(leaveGuard()).toBe(true)
  })

  it('고쳤으면 붙잡는다', async () => {
    // 순서를 다 짜 놓고 저장 없이 나가면 통째로 날아간다.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = await mountView()
    await wrapper.find('.title-input').setValue('바뀜')

    expect(leaveGuard()).toBe(false)
    confirmSpy.mockRestore()
  })
})
