<script setup>
/**
 * 장치 화면 캡처 한 장.
 *
 * `<img src>` 는 Authorization 헤더를 보낼 수 없어서 직접 받아 objectURL 로
 * 바꿔야 하고, 다 쓰면 해제해야 한다. 그 수명 관리를 이 컴포넌트가 혼자
 * 책임진다 — 장치 카드와 리스트 행이 같은 일을 두 벌 하지 않도록.
 *
 * **화면에 들어올 때까지 받지 않는다.** 장치가 50대만 돼도 마운트하자마자
 * 수십 장(장당 수백 KB)을 동시에 요청하게 되는데, 브라우저 동시 연결은 6개
 * 안팎이라 나머지가 줄줄이 밀린다. 정작 맨 위 카드조차 늦게 뜬다.
 *
 * 크기는 부모가 정한다. 여기서는 상자를 채우는 방법만 안다.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { imageUrl, revokeImageUrl } from '@/api/client'

const props = defineProps({
  device: { type: Object, required: true },
})

const { t } = useI18n()

const shot = ref(null)
const loading = ref(false)
const root = ref(null)

/** 언마운트 뒤에 늦게 도착한 응답으로 상태를 건드리지 않기 위한 표시. */
let alive = true

/** 한 번이라도 화면에 들어왔는가. 들어오기 전에는 받지 않는다. */
let seen = false
let observer = null

/**
 * 화면에 들어오는 순간을 기다린다.
 *
 * IntersectionObserver 가 없는 환경(구형 브라우저, 테스트용 jsdom)에서는
 * 곧바로 받는다 — 게으른 로딩은 성능 최적화이지 동작 조건이 아니다.
 * 없다고 캡처가 영영 안 뜨면 그게 더 나쁘다.
 */
function watchVisibility() {
  if (typeof IntersectionObserver !== 'function' || !root.value) {
    seen = true
    load()
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      seen = true
      stopObserving()
      load()
    },
    // 조금 못 미쳐도 미리 받아 둔다. 스크롤을 멈춘 뒤에야 뜨면 비어 보인다.
    { rootMargin: '200px' },
  )
  observer.observe(root.value)
}

function stopObserving() {
  observer?.disconnect()
  observer = null
}

async function load() {
  // 올라온 캡처가 없으면 받을 것도 없다. 실제 서버에서도 404 다.
  if (!props.device.screenshot_at) {
    clear()
    return
  }
  loading.value = true
  try {
    const url = await imageUrl(`/devices/${props.device.id}/screenshot`)
    if (!alive) {
      revokeImageUrl(url)
      return
    }
    clear()
    shot.value = url
  } finally {
    if (alive) loading.value = false
  }
}

function clear() {
  revokeImageUrl(shot.value)
  shot.value = null
}

onMounted(watchVisibility)

// 캡처 시각이 바뀌었다는 것은 새 화면이 올라왔다는 뜻이다.
// 아직 화면에 들어온 적 없는 카드는 그때 받으면 되므로 건드리지 않는다.
watch(
  () => props.device.screenshot_at,
  () => {
    if (seen) load()
  },
)

onBeforeUnmount(() => {
  alive = false
  stopObserving()
  // 해제하지 않으면 목록을 다시 그릴 때마다 blob 이 쌓인다.
  clear()
})
</script>

<template>
  <div ref="root" class="screen-thumb">
    <img v-if="shot" :src="shot" :alt="t('device.screenshotAlt', { name: device.name })" />
    <div v-else class="thumb-empty muted">
      <slot name="empty">
        <span v-if="loading">{{ t('common.loading') }}</span>
        <span v-else>{{ t('device.noScreenshot') }}</span>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.screen-thumb {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: #0b1120;
  overflow: hidden;
}

.screen-thumb img {
  width: 100%;
  height: 100%;
  /* contain: 비율을 유지한다. 늘어난 화면을 보여 주면 배치를 잘못 판단하게 된다. */
  object-fit: contain;
}

.thumb-empty {
  padding: 0 10px;
  font-size: 12px;
  text-align: center;
}
</style>
