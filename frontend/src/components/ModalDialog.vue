<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useDraggableDialog } from '@/composables/useDraggableDialog'

const props = defineProps({
  title: { type: String, required: true },
  width: { type: String, default: '520px' },
  /**
   * 고정 높이(예: '80vh'). 주면 내용이 많든 적든 창 크기가 변하지 않고,
   * 넘치는 내용은 본문 스크롤로 본다. 내용에 따라 창이 커졌다 작아졌다
   * 하면 단추 위치가 흔들려 누르기 어렵다.
   */
  height: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  /** 비우면 '저장'(번역본)을 쓴다. */
  confirmLabel: { type: String, default: '' },
  hideFooter: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'confirm'])

const { t } = useI18n()
const confirmText = computed(() => props.confirmLabel || t('common.save'))

// 머리글을 잡고 끌면 창이 옮겨진다 — 가린 뒤쪽을 볼 때 닫지 않아도 된다.
const { dialogStyle, onHandleMouseDown } = useDraggableDialog()

// 뒷배경을 눌러도 닫지 않는다.
//
// 생성·수정 폼이 이 창으로 뜨는데, 무심코 바깥을 누르는 순간 창이 닫히면
// 적던 내용이 통째로 사라진다 — 실제로 그런 사고가 반복됐다. 닫기는
// 언제나 명시적인 행동(✕ 또는 취소)으로만 한다.
</script>

<template>
  <div class="backdrop">
    <div
      class="dialog"
      :style="{ width, height: height || undefined, ...dialogStyle }"
      role="dialog"
      aria-modal="true"
    >
      <header class="dialog-head drag-handle" data-test="drag-handle" @mousedown="onHandleMouseDown">
        <h2>{{ title }}</h2>
        <button class="close" :aria-label="t('common.close')" @click="emit('close')">✕</button>
      </header>

      <div class="dialog-body">
        <slot />
      </div>

      <footer v-if="!hideFooter" class="dialog-foot">
        <slot name="footer">
          <button class="btn" :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :disabled="busy" @click="emit('confirm')">
            {{ busy ? t('common.processing') : confirmText }}
          </button>
        </slot>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--overlay);
  z-index: 50;
}

.dialog {
  display: flex;
  flex-direction: column;
  max-width: 100%;
  max-height: 90vh;
  background: var(--surface);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
}

.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px 18px;
  border-bottom: 1px solid var(--border);
}

.dialog-head h2 {
  font-size: 15px;
}

/* 끌기 손잡이 — 머리글을 잡고 창을 옮긴다. */
.drag-handle {
  cursor: move;
  user-select: none;
}

.close {
  border: 0;
  background: none;
  color: var(--text-muted);
  font-size: 15px;
  cursor: pointer;
}

.dialog-body {
  flex: 1;
  min-height: 0;
  padding: 18px;
  overflow-y: auto;
}

.dialog-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 13px 18px;
  border-top: 1px solid var(--border);
}
</style>
