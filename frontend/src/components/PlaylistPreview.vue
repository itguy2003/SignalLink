<script setup>
/**
 * 위젯 재생목록 미리보기.
 *
 * 편집 중인 순서가 장치에서 어떻게 돌아갈지 **실제 시간 그대로** 보여 준다.
 * 항목마다 정한 표출 시간(`duration_sec`)만큼 머무르고 다음으로 넘어가며,
 * 끝나면 처음으로 돌아간다 — 플레이어가 하는 일과 같다.
 *
 * 시간을 눈금 없이 숫자로만 정하면 15초가 긴지 짧은지 감이 오지 않는다.
 * 그래서 남은 시간을 1초 간격으로 세어 보여 주고, 진행 막대도 함께 둔다.
 *
 * 저장 여부와 무관하게 **지금 화면의 순서**를 재생한다. 저장해야만 확인할 수
 * 있으면 시간을 맞춰 보는 일이 저장-확인-수정의 반복이 된다.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ModalDialog from '@/components/ModalDialog.vue'
import PreviewSizeControls from '@/components/PreviewSizeControls.vue'
import WidgetPreview from '@/components/WidgetPreview.vue'
import { usePreviewStage } from '@/composables/usePreviewStage'
import { useWidgetCycle } from '@/composables/useWidgetCycle'
import { labelKey, normalize, normalizeMs } from '@/utils/transitions'

/** 미리보기 무대의 문서 좌표. 실제 표출 해상도와 같아야 글자 크기가 맞는다. */
const STAGE_WIDTH = 1920
const STAGE_HEIGHT = 1080

/**
 * 무대를 실제로 놓인 폭에 맞춘다.
 *
 * 배율을 상수로 박아 두면 그 값이 맞는 창 크기가 하나뿐이다. 모달 폭에서
 * 안쪽 여백·왼쪽 목록·스크롤바를 빼고 남는 폭은 창 크기와 언어에 따라
 * 달라지므로, 조금이라도 모자라면 무대가 칸 밖으로 밀려 목록 위에 겹친다.
 * 그래서 **놓인 뒤에 재서** 배율을 정한다.
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
const stageWidth = ref(0)

/** 아직 재기 전(또는 jsdom)에 쓸 폭. 화면이 없어도 비율은 맞는다. */
const FALLBACK_WIDTH = 640

const scale = computed(() => (stageWidth.value || FALLBACK_WIDTH) / STAGE_WIDTH)

let observer = null

function measure() {
  stageWidth.value = stageRef.value?.clientWidth ?? 0
}

onMounted(() => {
  measure()
  // 창 크기가 바뀌면 따라가야 한다. 없는 환경(jsdom)에서는 한 번 잰 값을 쓴다.
  if (typeof ResizeObserver === 'undefined' || !stageRef.value) return
  observer = new ResizeObserver(measure)
  observer.observe(stageRef.value)
})

const props = defineProps({
  /** 편집 중인 항목 배열. [{ widget_key, duration_sec, options }] */
  items: { type: Array, required: true },
  /** 서버 위젯 명세. 이름과 옵션 기본값이 여기서 온다. */
  widgets: { type: Array, default: () => [] },
})

const emit = defineEmits(['close'])

const { t } = useI18n()

const {
  index,
  playing,
  remaining,
  current,
  outgoing,
  entering,
  stageStyle,
  outgoingStyle,
  cycleSeconds,
  seconds,
  tick,
  togglePlay,
  go,
  select,
} = useWidgetCycle(() => props.items)

const specs = computed(() => new Map(props.widgets.map((w) => [w.key, w])))

const spec = computed(() => (current.value ? specs.value.get(current.value.widget_key) : null))

const outgoingSpec = computed(() =>
  outgoing.value ? specs.value.get(outgoing.value.widget_key) : null,
)

function label(item, at) {
  return specs.value.get(item.widget_key)?.name ?? item.widget_key ?? String(at + 1)
}

defineExpose({ tick, remeasure: measure })
</script>

<template>
  <ModalDialog :title="t('preview.title')" :width="size.width" hide-footer @close="emit('close')">
    <div class="preview-body">
      <!-- 재생 순서. 지금 어디를 보고 있는지가 목록에서 보여야 한다. -->
      <aside class="slots">
        <div class="slots-head">
          <span>{{ t('preview.slots') }}</span>
          <span class="muted">{{ t('preview.cycle', { seconds: cycleSeconds }) }}</span>
        </div>

        <p v-if="items.length === 0" class="muted pad">{{ t('widgetPlaylist.previewEmpty') }}</p>

        <button
          v-for="(item, at) in items"
          v-else
          :key="at"
          class="slot"
          :class="{ active: at === index }"
          @click="select(at)"
        >
          <span class="slot-label">{{ at + 1 }}</span>
          <span class="slot-name">{{ label(item, at) }}</span>
          <span class="muted slot-sec">{{ seconds(item) }}s</span>
          <span v-if="normalize(item.transition) !== 'none'" class="badge badge-muted slot-fx">
            {{ t(labelKey(item.transition)) }} {{ normalizeMs(item.transition_ms) }}ms
          </span>
        </button>
      </aside>

      <section ref="frameRef" class="screen" :class="{ full: isFullscreen }">
        <div class="screen-stage" :style="{ minHeight: isFullscreen ? '82vh' : size.stage }">
          <p v-if="items.length === 0" class="muted">{{ t('widgetPlaylist.previewEmpty') }}</p>

          <!-- 폭은 CSS 가 정하고 높이는 16:9 로 따라간다. 배율은 잰 폭에서 나온다. -->
          <div v-else ref="stageRef" class="stage-wrap">
            <div class="stage" :class="{ entering }" :style="stageStyle">
              <WidgetPreview
                playing
                :key="index"
                :widget-key="current.widget_key"
                :options="current.options ?? {}"
                :name="spec?.name ?? current.widget_key"
                :width="STAGE_WIDTH"
                :height="STAGE_HEIGHT"
                :scale="scale"
              />
            </div>

            <!-- 디졸브에서만 남겨 두는 앞 화면. 아래에 깔려 사라진다. -->
            <div
              v-if="outgoing"
              class="stage-out"
              :class="{ entering }"
              :style="outgoingStyle"
            >
              <WidgetPreview
                playing
                :widget-key="outgoing.widget_key"
                :options="outgoing.options ?? {}"
                :name="outgoingSpec?.name ?? outgoing.widget_key"
                :width="STAGE_WIDTH"
                :height="STAGE_HEIGHT"
                :scale="scale"
              />
            </div>
          </div>

          <!-- 남은 시간을 눈으로도. 숫자만으로는 길이 감이 오지 않는다. -->
          <div v-if="items.length" class="bar">
            <div
              class="fill"
              :style="{ width: `${(remaining / seconds(current)) * 100}%` }"
            />
          </div>
        </div>

        <div class="controls">
          <button class="btn btn-sm" :disabled="items.length < 2" @click="go(-1)">‹</button>
          <button
            class="btn btn-sm btn-primary"
            :disabled="items.length === 0"
            @click="togglePlay"
          >
            {{ playing ? t('preview.pause') : t('preview.play') }}
          </button>
          <button class="btn btn-sm" :disabled="items.length < 2" @click="go(1)">›</button>

          <span v-if="items.length" class="muted position">
            {{ index + 1 }} / {{ items.length }} ·
            {{ t('widgetPlaylist.remaining', { seconds: Math.max(0, remaining) }) }}
          </span>

          <div class="spacer" />

          <PreviewSizeControls
            :value="settings.previewSize"
            :size-keys="sizeKeys"
            :can-fullscreen="canFullscreen"
            :is-fullscreen="isFullscreen"
            @update="settings.setPreviewSize($event)"
            @toggle-fullscreen="toggleFullscreen"
          />

          <span class="hint">{{ t('preview.loopHint') }}</span>
        </div>
      </section>
    </div>
  </ModalDialog>
</template>

<style scoped>
.preview-body {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 12px;
}

/* 좁은 창에서는 목록을 위로 올린다. 나란히 두면 무대가 볼 수 없을 만큼 작아진다. */
@media (max-width: 720px) {
  .preview-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .slots {
    max-height: 200px;
  }
}

.slots {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  align-self: start;
  max-height: 460px;
  overflow-y: auto;
}

.slots-head {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  font-weight: 700;
}

.pad {
  padding: 12px;
  font-size: 12px;
}

.slot {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.slot:last-child {
  border-bottom: 0;
}

.slot.active {
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 700;
}

.slot-label {
  flex: none;
  width: 16px;
  text-align: right;
}

.slot-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slot-sec {
  flex: none;
  font-size: 11px;
}

.screen {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

/* 전체화면에서는 이 상자가 화면 전체다. 조작 줄은 아래에 남겨 둔다 —
   빠져나갈 버튼이 사라지면 Esc 를 아는 사람만 나올 수 있다. */
.screen.full {
  padding: 12px;
  background: var(--surface);
}

.screen-stage {
  display: grid;
  /* 무대가 칸 폭을 그대로 쓰도록 늘린다(가운데 정렬하면 넘칠 때 밖으로 샌다). */
  justify-items: stretch;
  align-content: center;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: #000;
  min-height: 300px;
}

.stage-wrap {
  position: relative;
  /* 칸이 주는 만큼만 쓴다. 고정 폭으로 두면 좁은 창에서 목록 위로 넘친다. */
  width: 100%;
  max-width: 960px;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: #000;
}

/* 두 겹이 정확히 포개져야 디졸브가 자리 이동 없이 녹아든다. */
.stage,
.stage-out {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #000;
  /* 시작 모습에서 제자리로 오는 사이를 브라우저가 채운다. */
  transition-property: opacity, transform, filter, clip-path;
  transition-timing-function: ease;
}

/* 들어오는 순간에는 사이를 채우지 않는다 — 시작 모습에 '놓는' 것이라
   여기에도 시간을 주면 앞뒤로 두 번 움직인다. */
.stage.entering,
.stage-out.entering {
  transition-duration: 0ms !important;
}

/* 들어오는 화면이 위에 온다. 아래 깔린 앞 화면이 그대로 비쳐 디졸브가 된다. */
.stage {
  z-index: 1;
}

.slot-fx {
  flex: none;
  font-size: 10px;
}

.bar {
  width: 100%;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.18);
  overflow: hidden;
}

.fill {
  height: 100%;
  background: var(--primary);
  /* 1초마다 줄어드는 값이라, 사이를 채워야 눈에 매끄럽게 보인다. */
  transition: width 1s linear;
}

.controls {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}

.position {
  font-size: 12px;
}

.spacer {
  flex: 1;
}

.hint {
  font-size: 11px;
}
</style>
