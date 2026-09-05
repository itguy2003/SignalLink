/**
 * 문서 축소판 테스트.
 *
 * 편집 캔버스를 목록 줄마다 세우면 스무 줄에 스무 개의 편집기가 돌아간다.
 * 축소판은 "무엇이 어디쯤 있는지"만 — 자리·비율·갈래가 맞는지를 본다.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DocumentThumb from './DocumentThumb.vue'

function doc(elements = [], layout = {}) {
  return {
    version: 1,
    layout: { width: 1920, height: 1080, background: '#123456', ...layout },
    elements,
  }
}

const mountThumb = (document, width = 120) => mount(DocumentThumb, { props: { document, width } })

describe('틀', () => {
  it('문서 비율을 그대로 줄인다', () => {
    const wrapper = mountThumb(doc(), 120)
    const style = wrapper.attributes('style')

    expect(style).toContain('width: 120px')
    expect(style).toContain('height: 67.5px') // 120 × (1080/1920)
    expect(style).toContain('background: rgb(18, 52, 86)')
  })

  it('세로형은 세로로 길다', () => {
    const wrapper = mountThumb(doc([], { width: 1080, height: 1920 }), 60)
    expect(wrapper.attributes('style')).toContain('height: 106.666')
  })
})

describe('요소', () => {
  it('자리를 배율에 맞춰 놓는다', () => {
    const wrapper = mountThumb(
      doc([{ id: 'e1', type: 'text', rect: { x: 960, y: 540, w: 192, h: 108, z: 3 }, options: {} }]),
      120, // 배율 1/16
    )
    const style = wrapper.find('.el').attributes('style')

    expect(style).toContain('left: 60px')
    expect(style).toContain('top: 33.75px')
    expect(style).toContain('width: 12px')
    expect(style).toContain('z-index: 3')
  })

  it('이미지는 실제 그림을 줄여 보여 준다', () => {
    const wrapper = mountThumb(
      doc([{ id: 'i', type: 'image', rect: { x: 0, y: 0, w: 800, h: 600, z: 1 }, src: '/f/1' }]),
    )
    expect(wrapper.find('img.fill').attributes('src')).toBe('/f/1')
  })

  it('글자는 내용과 색을 지켜 줄인다', () => {
    const wrapper = mountThumb(
      doc([
        {
          id: 't',
          type: 'text',
          rect: { x: 0, y: 0, w: 800, h: 200, z: 1 },
          options: { text: '가을 소식', color: '#ff0000', fontSize: 96 },
        },
      ]),
      120,
    )
    const text = wrapper.find('.text')

    expect(text.text()).toBe('가을 소식')
    expect(text.attributes('style')).toContain('color: rgb(255, 0, 0)')
    expect(text.attributes('style')).toContain('font-size: 6px') // 96/16
  })

  it('동영상과 웹은 표식으로 갈음한다', () => {
    const wrapper = mountThumb(
      doc([
        { id: 'v', type: 'video', rect: { x: 0, y: 0, w: 100, h: 100, z: 1 }, src: '/v' },
        { id: 'w', type: 'web', rect: { x: 200, y: 0, w: 100, h: 100, z: 1 }, src: 'https://x' },
      ]),
    )
    expect(wrapper.findAll('.mark')).toHaveLength(2)
  })

  it('모르는 요소도 자리는 남긴다', () => {
    const wrapper = mountThumb(
      doc([{ id: 'x', type: '미래요소', rect: { x: 0, y: 0, w: 100, h: 100, z: 1 } }]),
    )
    expect(wrapper.find('.ghost').exists()).toBe(true)
  })
})
