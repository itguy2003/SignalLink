/**
 * 이미지앨범 표출 테스트.
 *
 * 앨범은 사진 여러 장을 **정한 간격·효과로** 넘긴다. 넘기는 규칙은 재생목록과
 * 같은 것을 쓰므로(`useWidgetCycle`), 여기서는 옵션이 그 규칙에 제대로
 * 전달되는지와 편집 중에는 멈춰 있는지를 본다.
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

import AlbumSlides from './AlbumSlides.vue'

function mountAlbum(options = {}, props = {}) {
  return mount(AlbumSlides, {
    props: { options, ...props },
    global: { plugins: [i18n] },
  })
}

const SOURCES = ['/api/v1/assets/1/k/file', '/api/v1/assets/2/k/file', '/api/v1/assets/3/k/file']

function withImages(over = {}) {
  return { images: SOURCES.map((src) => ({ src })), ...over }
}

/** 표출 시간을 초 단위로 흘린다(넘기는 규칙이 1초마다 센다). */
function advance(seconds) {
  vi.advanceTimersByTime(seconds * 1000)
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  vi.useFakeTimers()
  // 전환은 다음 프레임에 제자리로 보낸다. 없는 환경이면 그 자리에서 부른다.
  vi.stubGlobal('requestAnimationFrame', (fn) => {
    fn()
    return 0
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('사진 목록', () => {
  it('넣은 것이 없으면 안내 자리를 내준다', () => {
    // 검은 칸만 두면 고장인지 빈 것인지 구분되지 않는다.
    const wrapper = mount(AlbumSlides, {
      props: { options: {} },
      slots: { empty: '<span class="ph">넣어 주세요</span>' },
      global: { plugins: [i18n] },
    })

    expect(wrapper.find('.ph').exists()).toBe(true)
    expect(wrapper.find('.slide').exists()).toBe(false)
  })

  it('첫 장부터 그린다', () => {
    const wrapper = mountAlbum(withImages())
    expect(wrapper.find('.slide').attributes('src')).toBe(SOURCES[0])
  })

  it('주소 문자열만 넣은 문서도 읽는다', () => {
    // 손으로 고친 문서나 옛 형식일 수 있다. 안 그리면 화면이 통째로 빈다.
    const wrapper = mountAlbum({ images: SOURCES })
    expect(wrapper.find('.slide').attributes('src')).toBe(SOURCES[0])
  })

  it('주소가 없는 칸은 건너뛴다', () => {
    const wrapper = mountAlbum({ images: [{ src: '' }, null, { src: SOURCES[1] }] })
    expect(wrapper.find('.slide').attributes('src')).toBe(SOURCES[1])
  })

  it('몇 장 중 몇 번째인지 보여 준다', () => {
    // 편집 중에 다 넣었는지 확인하는 근거다.
    const wrapper = mountAlbum(withImages())
    expect(wrapper.find('.count').text()).toBe('1 / 3')
  })

  it('한 장뿐이면 번호를 달지 않는다', () => {
    const wrapper = mountAlbum({ images: [{ src: SOURCES[0] }] })
    expect(wrapper.find('.count').exists()).toBe(false)
  })
})

describe('넘기기', () => {
  it('편집 중에는 넘기지 않는다', () => {
    // 자리를 잡는 동안 사진이 계속 바뀌면 눈이 붙잡힌다.
    const wrapper = mountAlbum(withImages({ interval_sec: 2 }))
    advance(10)

    expect(wrapper.vm.index).toBe(0)
  })

  it('정한 간격마다 다음 장으로 넘어간다', async () => {
    const wrapper = mountAlbum(withImages({ interval_sec: 3 }), { playing: true })

    advance(3)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.slide').attributes('src')).toBe(SOURCES[1])
  })

  it('마지막 장 다음은 처음으로 돌아온다', async () => {
    const wrapper = mountAlbum(withImages({ interval_sec: 1 }), { playing: true })

    advance(3)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.index).toBe(0)
  })

  it('간격을 비워 두면 기본 간격을 쓴다', async () => {
    const wrapper = mountAlbum(withImages(), { playing: true })

    advance(7)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.index).toBe(0)

    advance(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.index).toBe(1)
  })

  it('0초는 안 정한 것으로 본다', async () => {
    // 0 을 그대로 쓰면 한 틱에 목록을 다 돌아 화면이 깜빡인다.
    const wrapper = mountAlbum(withImages({ interval_sec: 0 }), { playing: true })

    advance(7)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.index).toBe(0)

    advance(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.index).toBe(1)
  })

  it('0.5초처럼 짧아도 최소 1초는 머문다', async () => {
    const wrapper = mountAlbum(withImages({ interval_sec: 0.5 }), { playing: true })

    advance(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.index).toBe(1)
  })
})

describe('전환 효과', () => {
  it('효과가 없으면 제자리에서 바뀐다', async () => {
    const wrapper = mountAlbum(withImages({ interval_sec: 1 }), { playing: true })

    advance(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.slide').attributes('style')).toContain('opacity: 1')
  })

  it('정한 전환 시간을 그대로 쓴다', () => {
    const wrapper = mountAlbum(withImages({ transition: 'fade', transition_ms: 1200 }))
    expect(wrapper.find('.slide').attributes('style')).toContain('1200ms')
  })

  it('범위를 벗어난 전환 시간은 끌어다 맞춘다', () => {
    // 서버와 같은 규칙이다. 넘어가면 효과가 끝나기 전에 다음 장이 온다.
    const wrapper = mountAlbum(withImages({ transition: 'fade', transition_ms: 99999 }))
    expect(wrapper.find('.slide').attributes('style')).toContain('5000ms')
  })

  it('모르는 효과는 없음으로 떨어뜨린다', () => {
    // 저장된 효과가 나중에 사라질 수 있다. 빈 화면보다 낫다.
    const wrapper = mountAlbum(withImages({ transition: '없는효과' }))
    expect(wrapper.find('.slide').attributes('style')).toContain('opacity: 1')
  })

  it('밀기는 앞 장을 밀어낸다', async () => {
    // 들어오는 쪽만 움직이면 새 사진이 가장자리에서 나타날 뿐이다.
    const wrapper = mountAlbum(
      withImages({ interval_sec: 1, transition: 'slide-left', transition_ms: 500 }),
      { playing: true },
    )

    advance(1)
    await wrapper.vm.$nextTick()

    const outgoing = wrapper.find('.outgoing')
    expect(outgoing.attributes('src')).toBe(SOURCES[0])
    // 들어오는 쪽과 같은 방향으로 함께 빠져야 두 장이 맞붙어 밀린다.
    expect(outgoing.attributes('style')).toContain('translateX(-100%)')
  })

  it('디졸브는 앞 장을 잠시 겹쳐 둔다', async () => {
    // 들어오는 쪽만 그리면 페이드와 구별되지 않는다.
    const wrapper = mountAlbum(
      withImages({ interval_sec: 1, transition: 'dissolve', transition_ms: 500 }),
      { playing: true },
    )

    advance(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.outgoing').attributes('src')).toBe(SOURCES[0])
  })
})

describe('채우는 방식', () => {
  it('기본은 화면을 채운다', () => {
    const wrapper = mountAlbum(withImages())
    expect(wrapper.find('.slide').attributes('style')).toContain('object-fit: cover')
  })

  it('전체 보이기를 고르면 여백을 남긴다', () => {
    const wrapper = mountAlbum(withImages({ fit: 'contain' }))
    expect(wrapper.find('.slide').attributes('style')).toContain('object-fit: contain')
  })
})

describe('장마다 전환 효과', () => {
  // 장마다 다르게 줄 수 있고, 안 정한 장은 앨범 기본값을 쓴다.

  it('그 장에 정한 효과를 쓴다', () => {
    const wrapper = mountAlbum({
      images: [{ src: SOURCES[0], transition: 'fade', transition_ms: 1200 }],
      transition: 'none',
    })

    expect(wrapper.find('.slide').attributes('style')).toContain('1200ms')
  })

  it('안 정한 장은 앨범 기본값을 쓴다', () => {
    const wrapper = mountAlbum({
      images: [{ src: SOURCES[0] }],
      transition: 'fade',
      transition_ms: 900,
    })

    expect(wrapper.find('.slide').attributes('style')).toContain('900ms')
  })

  it('효과만 정하고 시간을 비우면 앨범 시간을 따른다', () => {
    const wrapper = mountAlbum({
      images: [{ src: SOURCES[0], transition: 'dissolve' }],
      transition_ms: 1500,
    })

    expect(wrapper.find('.slide').attributes('style')).toContain('1500ms')
  })

  it('장마다 다른 효과로 넘어간다', async () => {
    // 두 번째 장은 디졸브라 앞 장을 겹쳐 두고, 세 번째 장은 아니다.
    const wrapper = mountAlbum(
      {
        images: [
          { src: SOURCES[0] },
          { src: SOURCES[1], transition: 'dissolve', transition_ms: 500 },
          { src: SOURCES[2], transition: 'fade' },
        ],
        interval_sec: 1,
      },
      { playing: true },
    )

    advance(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.outgoing').exists()).toBe(true)

    advance(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.outgoing').exists()).toBe(false)
  })

  it('모르는 효과를 넣은 장도 없음으로 떨어뜨린다', () => {
    const wrapper = mountAlbum({ images: [{ src: SOURCES[0], transition: '없는효과' }] })
    expect(wrapper.find('.slide').attributes('style')).toContain('opacity: 1')
  })
})

describe('장마다 유지 시간', () => {
  it('그 장에 정한 시간만큼 머문다', async () => {
    const wrapper = mountAlbum(
      {
        images: [{ src: SOURCES[0], duration_sec: 2 }, { src: SOURCES[1] }],
        interval_sec: 10,
      },
      { playing: true },
    )

    advance(2)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.index).toBe(1)
  })

  it('안 정한 장은 앨범 기본 간격을 쓴다', async () => {
    const wrapper = mountAlbum(
      {
        images: [{ src: SOURCES[0] }, { src: SOURCES[1], duration_sec: 2 }],
        interval_sec: 3,
      },
      { playing: true },
    )

    advance(2)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.index).toBe(0)

    advance(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.index).toBe(1)
  })

  it('0 이나 글자가 들어 있어도 기본 간격으로 떨어진다', async () => {
    const wrapper = mountAlbum(
      { images: [{ src: SOURCES[0], duration_sec: 0 }, { src: SOURCES[1] }], interval_sec: 2 },
      { playing: true },
    )

    advance(2)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.index).toBe(1)
  })
})
