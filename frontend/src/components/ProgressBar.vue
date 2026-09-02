<script setup>
/**
 * 오래 걸리는 일의 진행률.
 *
 * 사진 스무 장을 받아 저장하거나 큰 동영상을 올리는 동안 화면이 아무 말도
 * 안 하면, 사람은 멈춘 것으로 여기고 다시 누른다 — 그러면 같은 것이 두 벌
 * 쌓인다. 그래서 **무엇을 몇 개째 하고 있는지**를 함께 보여 준다.
 *
 * 얼마나 남았는지 모를 때(서버가 바깥에서 받아 오는 중)는 `value` 를 비운다.
 * 그때는 눈금 대신 흐르는 띠를 그린다 — 0% 에 멈춘 막대는 고장으로 읽힌다.
 */
import { computed } from 'vue'

const props = defineProps({
  /** 0~1. null 이면 '얼마나' 를 모르는 상태. */
  value: { type: Number, default: null },
  /** 무엇을 하는 중인지. */
  label: { type: String, default: '' },
  /** 오른쪽에 붙일 짧은 설명(예: "3 / 12"). */
  detail: { type: String, default: '' },
})

const known = computed(() => props.value != null && Number.isFinite(props.value))

const percent = computed(() =>
  known.value ? Math.max(0, Math.min(100, Math.round(props.value * 100))) : 0,
)
</script>

<template>
  <div class="progress" role="status" aria-live="polite">
    <div v-if="label || detail" class="line">
      <span class="label">{{ label }}</span>
      <span class="detail muted">{{ detail }}<template v-if="known"> · {{ percent }}%</template></span>
    </div>

    <div
      class="track"
      role="progressbar"
      :aria-valuenow="known ? percent : undefined"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="label || undefined"
    >
      <div v-if="known" class="fill" :style="{ width: `${percent}%` }" />
      <div v-else class="fill flowing" />
    </div>
  </div>
</template>

<style scoped>
.progress {
  display: grid;
  gap: 3px;
}

.line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
}

.label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail {
  flex: none;
  font-variant-numeric: tabular-nums;
}

.track {
  height: 6px;
  border-radius: 999px;
  background: var(--border);
  overflow: hidden;
}

.fill {
  height: 100%;
  border-radius: 999px;
  background: var(--primary);
  transition: width 0.15s linear;
}

/* 얼마나 남았는지 모를 때. 멈춘 막대와 구별되어야 한다. */
.flowing {
  width: 40%;
  animation: flow 1.1s ease-in-out infinite;
}

@keyframes flow {
  0% {
    transform: translateX(-100%);
  }

  100% {
    transform: translateX(250%);
  }
}

/* 움직임이 불편한 사람에게는 흐르지 않고 은은하게만 알린다. */
@media (prefers-reduced-motion: reduce) {
  .flowing {
    width: 100%;
    animation: none;
    opacity: 0.5;
  }
}
</style>
