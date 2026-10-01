<script setup>
/**
 * 알림 더미.
 *
 * 오류는 **화면 가운데**에 크게 띄우고 수명 끝에서 서서히 사라진다 —
 * 구석의 작은 상자는 작업에 집중한 사람이 놓친다. 놓친 오류는 "됐는 줄
 * 알았다"가 된다. 성공·안내는 흐름을 막을 이유가 없으니 오른쪽 아래에
 * 예전처럼 조용히 선다.
 */
import { computed } from 'vue'

import { useToastStore } from '@/stores/toast'

const toast = useToastStore()

const errors = computed(() => toast.items.filter((item) => item.type === 'error'))
const others = computed(() => toast.items.filter((item) => item.type !== 'error'))

/** 수명에 맞춘 사라짐 — 대부분 보여 주고 마지막 1/3에서 서서히 사라진다. */
function lifeStyle(item) {
  return { animationDuration: `${item.timeout ?? 6000}ms` }
}
</script>

<template>
  <!-- 오류: 화면 가운데. -->
  <div class="toasts-center">
    <TransitionGroup name="toast-pop">
      <div
        v-for="item in errors"
        :key="item.id"
        class="toast toast-error"
        :style="lifeStyle(item)"
        @click="toast.dismiss(item.id)"
      >
        {{ item.message }}
      </div>
    </TransitionGroup>
  </div>

  <!-- 성공·안내: 오른쪽 아래. -->
  <div class="toasts">
    <TransitionGroup name="toast-slide">
      <div
        v-for="item in others"
        :key="item.id"
        class="toast"
        :class="`toast-${item.type}`"
        @click="toast.dismiss(item.id)"
      >
        {{ item.message }}
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  right: 20px;
  bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 100;
}

.toasts-center {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  z-index: 110;
  /* 상자 자체만 클릭을 받는다 — 겹친 화면의 조작을 막지 않는다. */
  pointer-events: none;
}

.toast {
  max-width: 380px;
  padding: 11px 15px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  box-shadow: var(--shadow-toast);
  font-size: 13px;
  white-space: pre-line;
  cursor: pointer;
  pointer-events: auto;
}

.toast-success {
  border-color: var(--success-border);
  background: var(--success-soft);
  color: var(--success);
}

/* 오류는 눈에 띄어야 한다 — 가운데, 더 크게, 수명 끝에서 서서히 사라짐. */
.toast-error {
  min-width: 320px;
  max-width: min(560px, 84vw);
  padding: 16px 22px;
  font-size: 15px;
  font-weight: 600;
  text-align: center;
  border: 1px solid var(--danger-border);
  background: var(--danger-soft);
  color: var(--danger);
  box-shadow: 0 10px 40px rgb(0 0 0 / 25%);
  animation: toast-fade linear forwards;
}

/* 대부분의 시간은 온전히 보이고, 마지막 1/3 동안 서서히 사라진다.
   duration 은 인라인(수명과 동기)으로 들어온다. */
@keyframes toast-fade {
  0% {
    opacity: 1;
  }

  66% {
    opacity: 1;
  }

  100% {
    opacity: 0;
  }
}

/* 나타날 때: 가운데 것은 살짝 커지며, 구석 것은 밀려 들어온다. */
.toast-pop-enter-active,
.toast-pop-leave-active,
.toast-slide-enter-active,
.toast-slide-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.toast-pop-enter-from {
  opacity: 0;
  transform: scale(0.9);
}

.toast-pop-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

.toast-slide-enter-from,
.toast-slide-leave-to {
  opacity: 0;
  transform: translateX(12px);
}
</style>
