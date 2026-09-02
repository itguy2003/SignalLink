<script setup>
/**
 * 화면 맨 위의 활동 표시 띠.
 *
 * 오래 걸리는 일 중에는 **얼마나 남았는지 알 수 없는** 것이 많다. 서버가 엑셀
 * 수백 줄을 읽거나, 바깥 제공처에서 사진을 받아 오는 동안 브라우저는 아무것도
 * 보지 못한다. 그때 화면이 조용하면 사람은 멈춘 것으로 여기고 다시 누른다 —
 * 그러면 같은 일이 두 벌 벌어진다.
 *
 * 그래서 서버에 나가 있는 요청이 하나라도 있으면 여기서 띠를 흘린다. 화면마다
 * 따로 붙이지 않는 이유는, 붙이는 것을 잊은 화면이 반드시 생기기 때문이다.
 *
 * 다만 **곧바로 띄우지는 않는다.** 목록 하나 받아 오는 데 50ms 걸리는 일까지
 * 번쩍이면 화면이 쉴 새 없이 깜빡인다. 잠깐 기다려 보고, 그래도 안 끝났을
 * 때만 띄운다.
 */
import { onBeforeUnmount, ref, watch } from 'vue'

import { pendingRequests } from '@/api/client'

/** 이 시간 안에 끝나는 일은 없던 것으로 친다. */
const SHOW_AFTER_MS = 300

/**
 * 띄운 뒤 최소한 이만큼은 유지한다. 300ms 를 겨우 넘겨 끝난 일에서 띠가
 * 한 프레임만 번쩍이면 그것대로 눈에 거슬린다.
 */
const MIN_VISIBLE_MS = 400

const visible = ref(false)

let showTimer = null
let shownAt = 0
let hideTimer = null

function clearTimers() {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  showTimer = null
  hideTimer = null
}

watch(
  pendingRequests,
  (count) => {
    if (count > 0) {
      clearTimeout(hideTimer)
      hideTimer = null
      if (visible.value || showTimer) return
      showTimer = setTimeout(() => {
        showTimer = null
        shownAt = Date.now()
        visible.value = true
      }, SHOW_AFTER_MS)
      return
    }

    // 다 끝났다. 아직 안 띄웠으면 띄우지 않고, 띄웠으면 최소 시간을 채운다.
    clearTimeout(showTimer)
    showTimer = null
    if (!visible.value) return
    const left = MIN_VISIBLE_MS - (Date.now() - shownAt)
    if (left <= 0) {
      visible.value = false
      return
    }
    hideTimer = setTimeout(() => {
      hideTimer = null
      visible.value = false
    }, left)
  },
  { immediate: true },
)

onBeforeUnmount(clearTimers)
</script>

<template>
  <div v-if="visible" class="activity" role="status" :aria-label="$t('common.loading')">
    <div class="beam" />
  </div>
</template>

<style scoped>
.activity {
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  overflow: hidden;
  /* 상단 바의 아래 테두리 위에 겹친다. 자리를 차지하면 화면이 2px 밀린다. */
  pointer-events: none;
}

.beam {
  width: 35%;
  height: 100%;
  border-radius: 999px;
  background: var(--primary);
  animation: sweep 1.1s ease-in-out infinite;
}

@keyframes sweep {
  0% {
    transform: translateX(-100%);
  }

  100% {
    transform: translateX(320%);
  }
}

/* 움직임이 불편한 사람에게는 흐르지 않고 은은하게만 알린다. */
@media (prefers-reduced-motion: reduce) {
  .beam {
    width: 100%;
    animation: none;
    opacity: 0.6;
  }
}
</style>
