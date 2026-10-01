import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// 백엔드 주소. 기준 백엔드는 .NET(backend-dotnet, 8016)이다. FastAPI(병행
// 구현)에 붙이거나 포트가 점유된 환경에서는 환경변수로 바꾼다.
//   VITE_API_PROXY=http://127.0.0.1:8015 npm run dev
const API_PROXY = process.env.VITE_API_PROXY || 'http://127.0.0.1:8016'

/**
 * 테스트 모드 빌드에 표식을 남긴다.
 *
 * 이 산출물은 모의 서버로 도는 껍데기다. 실제 데이터도, 실제 권한 판정도 없다.
 * 화면에는 테스트 모드 배지가 뜨지만 빌드 로그와 index.html 에도 남겨 둬야
 * 누가 이걸 운영에 올리는 사고를 줄일 수 있다. 그래서 산출물 디렉터리도
 * `dist` 가 아니라 `dist-test` 로 따로 뺀다(package.json 의 build:test).
 */
function testBuildMarker(mode) {
  const isTest = mode === 'test'
  return {
    name: 'signallink-test-build-marker',
    apply: 'build',
    buildStart() {
      if (isTest) {
        this.warn(
          '테스트 모드로 빌드합니다 — 백엔드 없이 도는 모의 데이터 빌드입니다. 운영에 배포하지 마세요.',
        )
      }
    },
    transformIndexHtml(html) {
      if (!isTest) return html
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { name: 'signallink-build', content: 'test-mock' },
            injectTo: 'head',
          },
        ],
      }
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [vue(), testBuildMarker(mode)],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 개발 서버에서 백엔드로 프록시한다. 테스트 모드에서는 요청 자체가
      // 나가지 않으므로(모의 서버가 가로챈다) 이 설정은 무시된다.
      '/api': {
        target: API_PROXY,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // node 26 의 자체 localStorage 스텁과 jsdom 을 잇는다(src/test-setup.js 참조).
    setupFiles: ['./src/test-setup.js'],
  },
}))
