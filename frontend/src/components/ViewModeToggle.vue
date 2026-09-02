<script setup>
/**
 * 카드 / 리스트 보기 전환.
 *
 * 장치 탭과 장치그룹 탭이 같은 값을 공유한다 — 탭을 옮겼다고 보기 방식이
 * 되돌아가면, 리스트로 훑던 흐름이 매번 끊긴다.
 */
import { useI18n } from 'vue-i18n'

defineProps({
  /** 'card' | 'list' */
  modelValue: { type: String, default: 'card' },
})

const emit = defineEmits(['update:modelValue'])

const { t } = useI18n()

const MODES = [
  { key: 'card', icon: '▦', labelKey: 'device.viewCard' },
  { key: 'list', icon: '☰', labelKey: 'device.viewList' },
]
</script>

<template>
  <div class="view-toggle" role="group" :aria-label="t('device.viewMode')">
    <button
      v-for="mode in MODES"
      :key="mode.key"
      class="view-btn"
      :class="{ active: modelValue === mode.key }"
      :aria-pressed="modelValue === mode.key"
      :title="t(mode.labelKey)"
      @click="emit('update:modelValue', mode.key)"
    >
      <span aria-hidden="true">{{ mode.icon }}</span>
      <span class="label">{{ t(mode.labelKey) }}</span>
    </button>
  </div>
</template>

<style scoped>
.view-toggle {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.view-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 0;
  background: var(--surface);
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.view-btn + .view-btn {
  border-left: 1px solid var(--border);
}

.view-btn:hover {
  background: var(--surface-2);
}

.view-btn.active {
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 600;
}

/* 좁은 화면에서는 아이콘만 남긴다. 필터 줄이 두 줄로 접히는 것을 막는다. */
@media (width <= 720px) {
  .label {
    display: none;
  }
}
</style>
