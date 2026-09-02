/**
 * 미리보기 창의 크기와 전체화면.
 *
 * 스케줄·재생목록·콘텐츠 미리보기가 **같은 규칙**으로 커지고 같은 방식으로
 * 전체화면에 들어가야 한다. 세 곳에 따로 적으면 한쪽만 고쳐져 "어느 화면은
 * 되고 어느 화면은 안 되는" 상태가 된다.
 *
 * 크기는 설정에 남는다(`stores/settings`). 매번 다시 고르게 하면 쓰던 사람이
 * 번거롭다.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { PREVIEW_SIZES, useSettingsStore } from '@/stores/settings'

export function usePreviewStage() {
  const settings = useSettingsStore()

  /** 고른 크기의 모달 폭·무대 높이. 없는 값이면 '보통'. */
  const size = computed(() => PREVIEW_SIZES[settings.previewSize] ?? PREVIEW_SIZES.m)

  const sizeKeys = Object.keys(PREVIEW_SIZES)

  /**
   * 전체화면을 걸 요소. 부르는 쪽이 무대에 붙인다.
   *
   * 모달을 화면 크기로 늘리는 것과 다르다 — 주소창과 작업 표시줄까지
   * 사라져야 실제 장치에서 보이는 크기에 가장 가깝다.
   */
  const stageRef = ref(null)
  const isFullscreen = ref(false)

  /**
   * 쓸 수 있는 기능인가. 지원하지 않는 환경(일부 iOS 브라우저)에서는 버튼을
   * 내놓지 않는다 — 있지도 않은 기능을 눌러 보게 하면 왜 안 되는지 알 수 없다.
   *
   * 이 프로젝트에는 콘텐츠 문서를 담는 `document` ref 를 가진 컴포넌트가 있어,
   * 브라우저의 document 는 언제나 `globalThis` 를 거쳐 쓴다.
   */
  const canFullscreen = Boolean(globalThis.document?.fullscreenEnabled)

  function onFullscreenChange() {
    isFullscreen.value = Boolean(globalThis.document.fullscreenElement)
  }

  async function toggleFullscreen() {
    try {
      if (globalThis.document.fullscreenElement) await globalThis.document.exitFullscreen()
      else await stageRef.value?.requestFullscreen?.()
    } catch {
      // 사용자가 막았거나 브라우저가 거부했다. 창 크기 조절로도 볼 수 있으므로
      // 오류로 떠들지 않는다.
    }
  }

  onMounted(() => globalThis.document.addEventListener('fullscreenchange', onFullscreenChange))
  onBeforeUnmount(() => {
    globalThis.document.removeEventListener('fullscreenchange', onFullscreenChange)
    // 창을 닫는데 화면이 전체화면으로 남아 있으면 빠져나갈 길이 없다.
    if (globalThis.document.fullscreenElement) {
      globalThis.document.exitFullscreen().catch(() => {})
    }
  })

  return {
    settings,
    size,
    sizeKeys,
    stageRef,
    isFullscreen,
    canFullscreen,
    toggleFullscreen,
  }
}
