/**
 * 이미지·동영상 고르기 레이어 테스트.
 *
 * 네 방법(업로드 / 라이브러리 / 검색 / 링크)이 모두 **같은 결과**를 내야 한다 —
 * 어느 길로 왔든 요소의 `src` 하나가 정해질 뿐이다. 업로드가 있는 이유는
 * 바깥으로 못 나가는 망 때문이므로, 올린 파일의 주소를 서버가 준 그대로
 * 쓰는지도 함께 본다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

let ASSETS = []
let uploadResult = null
let uploadError = null

const get = vi.fn(async (path) => {
  if (path === '/assets') return { items: ASSETS, total: ASSETS.length, page: 1, size: 100 }
  return {}
})

/** 마지막 업로드에 넘어온 진행률 콜백. 화면이 이것을 받아 막대를 그린다. */
let lastProgress = null

/** 기본 동작. 테스트가 바꿔 쓴 구현은 beforeEach 에서 이것으로 되돌린다 —
    안 되돌리면 앞 테스트의 구현이 뒤 테스트까지 따라온다. */
async function defaultUpload(path, form, params, options) {
  lastProgress = options?.onProgress ?? null
  if (uploadError) throw uploadError
  return uploadResult
}

const upload = vi.fn(defaultUpload)

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    upload: (...args) => upload(...args),
  },
  TEST_MODE: false,
}))

import MediaPicker from './MediaPicker.vue'

function mountPicker(props = {}) {
  return mount(MediaPicker, {
    props: { kind: 'image', ...props },
    global: { plugins: [i18n] },
  })
}

const tabs = (wrapper) => wrapper.findAll('.tab')

async function openTab(wrapper, index) {
  await tabs(wrapper)[index].trigger('click')
  await flushPromises()
}

function pickFile(wrapper, name = 'poster.png', type = 'image/png') {
  const input = wrapper.find('input.file')
  const file = new File(['x'], name, { type })
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  return input.trigger('change')
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  get.mockClear()
  upload.mockReset()
  upload.mockImplementation(defaultUpload)
  uploadError = null
  lastProgress = null
  uploadResult = { id: 7, kind: 'image', filename: 'poster.png', url: '/api/v1/assets/7/file' }
  ASSETS = [
    {
      id: 1,
      kind: 'image',
      filename: '가을 배경.png',
      url: '/api/v1/assets/1/file',
      size_bytes: 2048,
      usage_count: 0,
    },
  ]
})

describe('다섯 가지 방법', () => {
  it('다섯 가지 방법을 한 자리에 둔다', () => {
    const wrapper = mountPicker()
    expect(tabs(wrapper).map((b) => b.text())).toEqual([
      '업로드',
      '라이브러리',
      '검색',
      'Canva',
      '링크',
    ])
  })

  it('업로드부터 연다', () => {
    // 새 파일을 넣으려고 여는 경우가 가장 흔하다.
    const wrapper = mountPicker()
    expect(wrapper.find('.drop').exists()).toBe(true)
  })
})

describe('업로드', () => {
  it('고른 파일을 올리고 바로 쓴다', async () => {
    // 올린 뒤 목록으로 돌려보내면 한 번 더 골라야 한다.
    const wrapper = mountPicker()
    await pickFile(wrapper)
    await flushPromises()

    expect(upload).toHaveBeenCalled()
    expect(wrapper.emitted('select')[0][0].src).toBe('/api/v1/assets/7/file')
  })

  it('끌어다 놓아도 올린다', async () => {
    const wrapper = mountPicker()
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    await wrapper.find('.drop').trigger('drop', { dataTransfer: { files: [file] } })
    await flushPromises()

    expect(upload).toHaveBeenCalled()
  })

  it('기관을 정해 올린다', async () => {
    const wrapper = mountPicker({ orgId: 3 })
    await pickFile(wrapper)
    await flushPromises()

    expect(upload.mock.calls[0][2]).toEqual({ org_id: 3 })
  })

  it('실패하면 그 자리에서 알려 준다', async () => {
    uploadError = { detail: '파일은 20MB 이하여야 합니다.' }
    const wrapper = mountPicker()
    await pickFile(wrapper)
    await flushPromises()

    expect(wrapper.find('.error-text').text()).toContain('20MB')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('동영상이면 동영상만 고르게 한다', () => {
    const wrapper = mountPicker({ kind: 'video' })
    expect(wrapper.find('input.file').attributes('accept')).toBe('video/*')
  })

  it('파일 드래그가 아니면 받지 않는다', async () => {
    // 캔버스 요소를 끌다 지나가도 여기가 반응하면 안 된다.
    const wrapper = mountPicker()
    await wrapper.find('.drop').trigger('dragover', {
      dataTransfer: { types: ['application/x-signallink-element'] },
    })

    expect(wrapper.find('.drop').classes()).not.toContain('over')
  })
})

describe('라이브러리', () => {
  it('올려 둔 파일을 갈래에 맞춰 받아 온다', async () => {
    const wrapper = mountPicker({ kind: 'video' })
    await flushPromises()

    expect(get).toHaveBeenCalledWith('/assets', { kind: 'video', size: 100 })
  })

  it('고르면 그 주소를 올린다', async () => {
    const wrapper = mountPicker()
    await openTab(wrapper, 1)

    await wrapper.find('.asset').trigger('click')
    expect(wrapper.emitted('select')[0][0].src).toBe('/api/v1/assets/1/file')
  })

  it('이름으로 좁혀 찾는다', async () => {
    ASSETS = [
      { id: 1, kind: 'image', filename: '가을.png', url: '/a/1', size_bytes: 1, usage_count: 0 },
      { id: 2, kind: 'image', filename: '겨울.png', url: '/a/2', size_bytes: 1, usage_count: 0 },
    ]
    const wrapper = mountPicker()
    await openTab(wrapper, 1)

    await wrapper.find('.row .input').setValue('겨울')
    expect(wrapper.findAll('.asset')).toHaveLength(1)
  })

  it('비어 있으면 그렇게 말한다', async () => {
    ASSETS = []
    const wrapper = mountPicker()
    await openTab(wrapper, 1)

    expect(wrapper.text()).toContain('올린 파일이 없습니다')
  })

  it('쓰이는 곳을 알려 준다', async () => {
    // 바꾸거나 지워도 되는지 판단하려면 필요하다.
    ASSETS[0].usage_count = 2
    const wrapper = mountPicker()
    await openTab(wrapper, 1)

    expect(wrapper.find('.asset').text()).toContain('2곳 사용')
  })
})

describe('링크', () => {
  it('넣은 주소를 그대로 올린다', async () => {
    const wrapper = mountPicker()
    await openTab(wrapper, 4)

    await wrapper.find('.field .input').setValue('https://cdn.example.com/a.png')
    await wrapper.find('.btn-primary').trigger('click')

    expect(wrapper.emitted('select')[0][0].src).toBe('https://cdn.example.com/a.png')
  })

  it('지금 주소를 채워 연다', async () => {
    // 고치려던 사람이 처음부터 다시 적게 하면 안 된다.
    const wrapper = mountPicker({ current: 'https://old.example.com/a.png' })
    await openTab(wrapper, 4)

    expect(wrapper.find('.field .input').element.value).toBe('https://old.example.com/a.png')
  })

  it('비었으면 쓸 수 없다', async () => {
    const wrapper = mountPicker()
    await openTab(wrapper, 4)

    expect(wrapper.find('.btn-primary').attributes('disabled')).toBeDefined()
  })

  it('폐쇄망 경고를 함께 띄운다', async () => {
    // 링크 방식에서 가장 흔한 사고다.
    const wrapper = mountPicker()
    await openTab(wrapper, 4)

    expect(wrapper.text()).toContain('폐쇄망')
  })
})

describe('검색', () => {
  it('검색 탭에서 스톡 소재를 찾는다', async () => {
    // 바깥에서 찾아 오는 길도 같은 창 안에 있어야 한다.
    const wrapper = mountPicker()
    await openTab(wrapper, 2)

    expect(wrapper.findComponent({ name: 'StockSearch' }).exists()).toBe(true)
  })

  it('찾은 소재의 갈래를 그대로 넘긴다', async () => {
    const wrapper = mountPicker({ kind: 'video' })
    await openTab(wrapper, 2)

    expect(wrapper.findComponent({ name: 'StockSearch' }).props('kind')).toBe('video')
  })

  it('검색에서 고른 것도 같은 결과를 낸다', async () => {
    // 어느 길로 왔든 요소의 src 하나가 정해질 뿐이다.
    const wrapper = mountPicker()
    await openTab(wrapper, 2)

    wrapper
      .findComponent({ name: 'StockSearch' })
      .vm.$emit('select', { src: '/api/v1/assets/9/key/file', asset: { id: 9 } })
    await flushPromises()

    expect(wrapper.emitted('select')[0][0].src).toBe('/api/v1/assets/9/key/file')
  })
})

describe('여러 장 고르기', () => {
  // 창을 열고 한 장 고르고 닫히기를 스무 번 되풀이하는 것이 앨범을 만드는
  // 일의 전부가 되면 안 된다.

  function pickFiles(wrapper, names) {
    const input = wrapper.find('input.file')
    const files = names.map((name) => new File(['x'], name, { type: 'image/png' }))
    Object.defineProperty(input.element, 'files', { value: files, configurable: true })
    return input.trigger('change')
  }

  it('파일 고르기 창에서 여러 장을 고를 수 있게 한다', () => {
    const wrapper = mountPicker({ multiple: true })
    expect(wrapper.find('input.file').attributes('multiple')).toBeDefined()
  })

  it('한 장 모드에서는 여러 장을 못 고르게 둔다', () => {
    const wrapper = mountPicker()
    expect(wrapper.find('input.file').attributes('multiple')).toBeUndefined()
  })

  it('고른 파일을 모두 올린다', async () => {
    const wrapper = mountPicker({ multiple: true })
    await pickFiles(wrapper, ['a.png', 'b.png', 'c.png'])
    await flushPromises()

    expect(upload).toHaveBeenCalledTimes(3)
  })

  it('올린 것을 한 번에 올려 준다', async () => {
    // 한 장씩 여러 번 올리면 받는 쪽이 목록을 그때마다 다시 써서 덮인다.
    const wrapper = mountPicker({ multiple: true })
    await pickFiles(wrapper, ['a.png', 'b.png'])
    await flushPromises()

    expect(wrapper.emitted('select')).toBeUndefined()
    expect(wrapper.emitted('select-many')).toHaveLength(1)
    expect(wrapper.emitted('select-many')[0][0]).toHaveLength(2)
  })

  it('하나가 막혀도 나머지는 살린다', async () => {
    // 스무 장 중 한 장 때문에 열아홉 장을 다시 고르게 하면 안 된다.
    let call = 0
    upload.mockImplementation(async () => {
      call += 1
      if (call === 2) throw { detail: '파일은 20MB 이하여야 합니다.' }
      return uploadResult
    })
    const wrapper = mountPicker({ multiple: true })
    await pickFiles(wrapper, ['a.png', 'b.png', 'c.png'])
    await flushPromises()

    expect(wrapper.emitted('select-many')[0][0]).toHaveLength(2)
    expect(wrapper.find('.error-text').text()).toContain('20MB')
  })

  it('한 장 모드는 예전처럼 한 건만 올린다', async () => {
    const wrapper = mountPicker()
    await pickFile(wrapper)
    await flushPromises()

    expect(wrapper.emitted('select')).toHaveLength(1)
    expect(wrapper.emitted('select-many')).toBeUndefined()
  })

  it('라이브러리에서는 눌러서 담고 뺀다', async () => {
    const wrapper = mountPicker({ multiple: true })
    await openTab(wrapper, 1)

    await wrapper.find('.asset').trigger('click')
    expect(wrapper.find('.asset').classes()).toContain('picked')
    // 고르는 동안에는 아직 아무것도 올리지 않는다.
    expect(wrapper.emitted('select-many')).toBeUndefined()

    await wrapper.find('.asset').trigger('click')
    expect(wrapper.find('.asset').classes()).not.toContain('picked')
  })

  it('누른 순서를 번호로 보여 준다', async () => {
    // 앨범은 순서가 곧 내용이다.
    ASSETS = [
      { id: 1, kind: 'image', filename: 'a.png', url: '/a/1', size_bytes: 1, usage_count: 0 },
      { id: 2, kind: 'image', filename: 'b.png', url: '/a/2', size_bytes: 1, usage_count: 0 },
    ]
    const wrapper = mountPicker({ multiple: true })
    await openTab(wrapper, 1)

    await wrapper.findAll('.asset')[1].trigger('click')
    await wrapper.findAll('.asset')[0].trigger('click')

    expect(wrapper.findAll('.pick-mark').map((e) => e.text())).toEqual(['2', '1'])
  })

  it('담은 순서 그대로 올린다', async () => {
    ASSETS = [
      { id: 1, kind: 'image', filename: 'a.png', url: '/a/1', size_bytes: 1, usage_count: 0 },
      { id: 2, kind: 'image', filename: 'b.png', url: '/a/2', size_bytes: 1, usage_count: 0 },
    ]
    const wrapper = mountPicker({ multiple: true })
    await openTab(wrapper, 1)

    await wrapper.findAll('.asset')[1].trigger('click')
    await wrapper.findAll('.asset')[0].trigger('click')
    await wrapper.find('.picked-bar .btn-primary').trigger('click')

    expect(wrapper.emitted('select-many')[0][0].map((i) => i.src)).toEqual(['/a/2', '/a/1'])
  })

  it('선택 해제는 담은 것을 비운다', async () => {
    const wrapper = mountPicker({ multiple: true })
    await openTab(wrapper, 1)

    await wrapper.find('.asset').trigger('click')
    await wrapper.findAll('.picked-bar .btn')[0].trigger('click')

    expect(wrapper.find('.asset').classes()).not.toContain('picked')
  })

  it('검색 탭에도 여러 장 모드를 넘긴다', async () => {
    const wrapper = mountPicker({ multiple: true })
    await openTab(wrapper, 2)

    expect(wrapper.findComponent({ name: 'StockSearch' }).props('multiple')).toBe(true)
  })
})


describe('오래 걸리는 동안 알려 주기', () => {
  // 아무 말 없이 기다리게 하면 멈춘 줄 알고 다시 누른다 — 그러면 같은 것이
  // 두 벌 쌓인다.

  const bar = (wrapper) => wrapper.findComponent({ name: 'ProgressBar' })

  /** 올리는 도중에 멈춰 세운다. 그 순간의 화면을 봐야 한다. */
  function holdUpload() {
    let release
    upload.mockImplementationOnce((path, form, params, options) => {
      lastProgress = options?.onProgress ?? null
      return new Promise((resolve) => {
        release = () => resolve(uploadResult)
      })
    })
    return () => release()
  }

  it('한 장을 올리는 동안에도 막대를 띄운다', async () => {
    // 500MB 동영상은 한 장이어도 오래 걸린다.
    const release = holdUpload()
    const wrapper = mountPicker()
    await pickFile(wrapper)
    await flushPromises()

    expect(bar(wrapper).exists()).toBe(true)

    release()
    await flushPromises()
    expect(bar(wrapper).exists()).toBe(false)
  })

  it('보낸 양을 알려 달라고 요청한다', async () => {
    // fetch 로는 보낸 양을 알 수 없다. 콜백을 줘야 XHR 로 보낸다.
    const wrapper = mountPicker()
    await pickFile(wrapper)
    await flushPromises()

    expect(typeof upload.mock.calls[0][3]?.onProgress).toBe('function')
  })

  it('보낸 만큼 막대가 찬다', async () => {
    const release = holdUpload()
    const wrapper = mountPicker()
    await pickFile(wrapper)
    await flushPromises()

    lastProgress(0.25)
    await wrapper.vm.$nextTick()
    expect(bar(wrapper).props('value')).toBeCloseTo(0.25, 2)

    release()
    await flushPromises()
  })

  it('지금 올리는 파일 이름을 보여 준다', async () => {
    const release = holdUpload()
    const wrapper = mountPicker()
    await pickFile(wrapper, '가을 운동회.png')
    await flushPromises()

    expect(bar(wrapper).props('label')).toBe('가을 운동회.png')

    release()
    await flushPromises()
  })

  it('여러 장이면 몇 개째인지 함께 센다', async () => {
    const wrapper = mountPicker({ multiple: true })
    const input = wrapper.find('input.file')
    const files = ['a.png', 'b.png', 'c.png'].map(
      (name) => new File(['x'], name, { type: 'image/png' }),
    )
    Object.defineProperty(input.element, 'files', { value: files, configurable: true })

    const release = holdUpload()
    await input.trigger('change')
    await flushPromises()

    expect(bar(wrapper).props('detail')).toContain('3')

    release()
    await flushPromises()
  })

  it('한 장뿐이면 개수는 세지 않는다', async () => {
    const release = holdUpload()
    const wrapper = mountPicker()
    await pickFile(wrapper)
    await flushPromises()

    expect(bar(wrapper).props('detail')).toBe('')

    release()
    await flushPromises()
  })

  it('실패해도 막대는 걷는다', async () => {
    // 남아 있으면 아직 하는 중으로 보여 계속 기다리게 된다.
    uploadError = { detail: '파일은 20MB 이하여야 합니다.' }
    const wrapper = mountPicker()
    await pickFile(wrapper)
    await flushPromises()

    expect(bar(wrapper).exists()).toBe(false)
    expect(wrapper.find('.error-text').exists()).toBe(true)
  })
})
