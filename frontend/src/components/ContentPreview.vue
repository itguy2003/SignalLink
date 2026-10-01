<script setup>
/**
 * 콘텐츠 미리보기.
 *
 * 편집 중인 화면이 장치에서 어떻게 보일지 그대로 보여 준다. 편집기의 캔버스와
 * 다른 점은 **편집 장치가 없다**는 것이다 — 점선 테두리, 크기 손잡이, 격자,
 * 분할 안내선이 사라지고, 재생목록은 실제 시간·전환으로 돈다.
 *
 * 편집 캔버스에도 위젯 내용이 그려지므로 겹쳐 보이지만, 그 화면으로는
 * "테두리를 뺀 실제 모습" 과 "재생목록이 낀 자리" 를 확인할 수 없다.
 *
 * 저장 여부와 무관하게 지금 문서를 그린다. 저장해야만 볼 수 있으면 확인이
 * 저장-확인-수정의 반복이 된다.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ContentCanvas from '@/components/ContentCanvas.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import PreviewSizeControls from '@/components/PreviewSizeControls.vue'
import { usePreviewStage } from '@/composables/usePreviewStage'

const props = defineProps({
  document: { type: Object, required: true },
  widgets: { type: Array, default: () => [] },
  /**
   * 여러 장짜리(재생목록형) 미리보기. pageTotal 이 2 이상이면 넘김 줄이
   * 나타나고, ‹ › 는 'page' 이벤트(+1/-1)로 바깥에 알린다 — 어떤 장을
   * 보여 줄지는 문서를 쥔 쪽이 정한다.
   */
  pageIndex: { type: Number, default: 0 },
  pageTotal: { type: Number, default: 0 },
})

const emit = defineEmits(['close', 'page'])

const { t } = useI18n()

/**
 * 무대 폭을 재서 캔버스에 준다.
 *
 * 세로형 콘텐츠는 폭보다 높이가 먼저 모자란다. 폭만 맞추면 아래가 잘리므로
 * 높이도 함께 재서 둘 중 작은 쪽을 따른다.
 */
const {
  settings,
  size,
  sizeKeys,
  stageRef: frameRef,
  isFullscreen,
  canFullscreen,
  toggleFullscreen,
} = usePreviewStage()

const stageRef = ref(null)
const box = ref({ width: 0, height: 0 })

let observer = null

function measure() {
  const el = stageRef.value
  if (!el) return
  box.value = { width: el.clientWidth, height: el.clientHeight }
}

onMounted(() => {
  measure()
  if (typeof ResizeObserver === 'undefined' || !stageRef.value) return
  observer = new ResizeObserver(measure)
  observer.observe(stageRef.value)
})

onBeforeUnmount(() => observer?.disconnect())

const layout = computed(() => props.document?.layout ?? { width: 1920, height: 1080 })

/** 화면 비율. 무대가 콘텐츠 모양을 그대로 따라가야 여백이 생기지 않는다. */
const ratio = computed(() => `${layout.value.width} / ${layout.value.height}`)

const elementCount = computed(() => props.document?.elements?.length ?? 0)

defineExpose({ remeasure: measure })
</script>

<template>
  <ModalDialog :title="t('preview.title')" :width="size.width" hide-footer @close="emit('close')">
    <div ref="frameRef" class="frame" :class="{ full: isFullscreen }">
      <div
        ref="stageRef"
        class="stage"
        :style="{ aspectRatio: ratio, maxHeight: isFullscreen ? '88vh' : size.stage }"
      >
        <ContentCanvas :document="document" :widgets="widgets" readonly />
      </div>

      <div class="controls">
        <div v-if="pageTotal > 1" class="pager">
          <button
            class="btn btn-sm"
            :disabled="pageIndex <= 0"
            :title="t('common.prev')"
            data-test="page-prev"
            @click="emit('page', -1)"
          >
            ‹
          </button>
          <span class="muted page-count">{{ pageIndex + 1 }} / {{ pageTotal }}</span>
          <button
            class="btn btn-sm"
            :disabled="pageIndex >= pageTotal - 1"
            :title="t('common.next')"
            data-test="page-next"
            @click="emit('page', 1)"
          >
            ›
          </button>
        </div>
        <PreviewSizeControls
          :value="settings.previewSize"
          :size-keys="sizeKeys"
          :can-fullscreen="canFullscreen"
          :is-fullscreen="isFullscreen"
          @update="settings.setPreviewSize($event)"
          @toggle-fullscreen="toggleFullscreen"
        />
      </div>
    </div>

    <p class="hint preview-meta">
      {{ layout.width }}×{{ layout.height }} ·
      {{ t('content.elementCount', { count: elementCount }) }} ·
      {{ t('content.editor.previewHint') }}
    </p>
  </ModalDialog>
</template>

<style scoped>
/* 전체화면에서는 이 상자가 화면 전체다. 조작 줄은 아래에 남겨 둔다 —
   빠져나갈 버튼이 사라지면 Esc 를 아는 사람만 나올 수 있다. */
.frame.full {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  height: 100%;
  padding: 12px;
  background: var(--surface);
}

.controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.pager {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-right: auto;
}

.page-count {
  font-size: 12px;
  white-space: nowrap;
}

.stage {
  width: 100%;
  /* 세로형은 높이가 먼저 모자란다. 모달을 넘지 않도록 위에서 잘라 둔다. */
  margin: 0 auto;
  overflow: hidden;
  background: #000;
  border-radius: var(--radius);
}

/* 캔버스가 무대를 꽉 채우게 한다. 편집기에서는 남는 공간에 맞추지만
   여기서는 무대 자체가 콘텐츠 비율이라 그대로 채우면 된다. */
.stage :deep(.canvas-editor) {
  height: 100%;
}

.preview-meta {
  margin: 8px 0 0;
  text-align: center;
}
</style>
