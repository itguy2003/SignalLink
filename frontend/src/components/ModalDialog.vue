<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  title: { type: String, required: true },
  width: { type: String, default: '520px' },
  busy: { type: Boolean, default: false },
  /** 비우면 '저장'(번역본)을 쓴다. */
  confirmLabel: { type: String, default: '' },
  hideFooter: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'confirm'])

const { t } = useI18n()
const confirmText = computed(() => props.confirmLabel || t('common.save'))

/**
 * 뒷배경을 눌러 닫기.
 *
 * ``@click.self`` 만으로는 부족하다. click 은 mousedown 과 mouseup 의 공통 조상에서
 * 발생하므로, 입력창 안에서 글자를 끌어 선택하다가 창 밖에서 손을 떼면 그 조상이
 * 뒷배경이 되어 창이 닫히고 편집하던 내용이 사라진다.
 *
 * 그래서 **누르기 시작한 곳도 뒷배경일 때만** 닫는다.
 */
const pressedOnBackdrop = ref(false)

function onBackdropMouseDown(event) {
  pressedOnBackdrop.value = event.target === event.currentTarget
}

function onBackdropClick(event) {
  const shouldClose = pressedOnBackdrop.value && event.target === event.currentTarget
  pressedOnBackdrop.value = false
  if (shouldClose) emit('close')
}
</script>

<template>
  <div class="backdrop" @mousedown="onBackdropMouseDown" @click="onBackdropClick">
    <div class="dialog" :style="{ width }" role="dialog" aria-modal="true">
      <header class="dialog-head">
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

.close {
  border: 0;
  background: none;
  color: var(--text-muted);
  font-size: 15px;
  cursor: pointer;
}

.dialog-body {
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
