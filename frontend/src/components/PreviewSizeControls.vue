<script setup>
/**
 * 미리보기 창의 크기 선택과 전체화면 버튼.
 *
 * 세 미리보기(스케줄·재생목록·콘텐츠)가 같은 자리에 같은 모양으로 둔다.
 * 상태는 `composables/usePreviewStage` 가 갖고 있고, 여기서는 그리기만 한다.
 */
import { useI18n } from 'vue-i18n'

defineProps({
  /** 지금 고른 크기 키('s' | 'm' | 'l' | 'xl'). */
  value: { type: String, required: true },
  sizeKeys: { type: Array, required: true },
  canFullscreen: { type: Boolean, default: false },
  isFullscreen: { type: Boolean, default: false },
})

const emit = defineEmits(['update', 'toggleFullscreen'])

const { t } = useI18n()
</script>

<template>
  <label class="size">
    {{ t('preview.size') }}
    <select class="select tiny" :value="value" @change="emit('update', $event.target.value)">
      <option v-for="key in sizeKeys" :key="key" :value="key">
        {{ t(`preview.size_${key}`) }}
      </option>
    </select>
  </label>

  <button
    v-if="canFullscreen"
    class="btn btn-sm"
    :title="t('preview.fullscreenHint')"
    @click="emit('toggleFullscreen')"
  >
    {{ isFullscreen ? t('preview.exitFullscreen') : t('preview.fullscreen') }}
  </button>
</template>

<style scoped>
.size {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-muted);
}
</style>
