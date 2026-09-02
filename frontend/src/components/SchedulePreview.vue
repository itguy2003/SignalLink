<script setup>
/**
 * 스케줄 미리보기.
 *
 * 편집 중인 스케줄이 장치에서 어떻게 나올지 보여 준다.
 *   요일형   요일 탭 → 그 요일의 시간대를 순서대로
 *   목록반복 재생 순서대로
 *
 * 콘텐츠 문서는 필요할 때 받아 캐시한다. 편집기에는 content_id 와 이름만
 * 있으므로, 미리보기를 열어야 비로소 문서가 필요해진다.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import ContentCanvas from '@/components/ContentCanvas.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import PreviewSizeControls from '@/components/PreviewSizeControls.vue'
import { usePreviewStage } from '@/composables/usePreviewStage'
import { groupDuration, slotHasContent, slotSeconds } from '@/utils/schedulePreview'

const props = defineProps({
  /** [{ key, label, slots: [...] }] — utils/schedulePreview 가 만든다. */
  groups: { type: Array, required: true },
  widgets: { type: Array, default: () => [] },
  /** 요일 탭을 보여 줄지(요일형이면 true). */
  showGroups: { type: Boolean, default: true },
})

const emit = defineEmits(['close'])

const { t } = useI18n()
const {
  settings,
  size,
  sizeKeys,
  stageRef,
  isFullscreen,
  canFullscreen,
  toggleFullscreen,
} = usePreviewStage()

const groupIndex = ref(0)
const slotIndex = ref(0)
const playing = ref(true)
const loading = ref(false)
const loadError = ref('')

/** content_id -> 문서. 같은 콘텐츠를 여러 슬롯이 써도 한 번만 받는다. */
const cache = new Map()
const document = ref(null)

const group = computed(() => props.groups[groupIndex.value] ?? null)
const slots = computed(() => group.value?.slots ?? [])
const slot = computed(() => slots.value[slotIndex.value] ?? null)
const total = computed(() => groupDuration(group.value))

const hasContent = computed(() => slotHasContent(slot.value))

/** 첫 번째로 슬롯이 있는 요일. 미리보기를 열자마자 빈 요일을 보지 않게 한다. */
function firstNonEmptyGroup() {
  const index = props.groups.findIndex((entry) => entry.slots.length > 0)
  return index >= 0 ? index : 0
}

async function loadDocument() {
  loadError.value = ''
  const current = slot.value

  if (!current) {
    document.value = null
    return
  }
  if (current.content?.elements?.length) {
    document.value = current.content
    return
  }
  if (!current.contentId) {
    document.value = null
    return
  }
  if (cache.has(current.contentId)) {
    document.value = cache.get(current.contentId)
    return
  }

  loading.value = true
  try {
    const detail = await api.get(`/contents/${current.contentId}`)
    cache.set(current.contentId, detail.document)
    document.value = detail.document
  } catch (err) {
    loadError.value = err.detail ?? t('content.loadFailed')
    document.value = null
  } finally {
    loading.value = false
  }
}

watch([groupIndex, slotIndex], loadDocument, { immediate: true })
watch(groupIndex, () => {
  slotIndex.value = 0
})

// ------------------------------------------------------------------ 자동 재생
//
// 재생목록 미리보기와 같은 방식으로 돈다 — 1초씩 세면서 남은 시간을 보여
// 주고, 0 이 되면 다음 칸으로 넘어간다. 한 번에 통째로 기다리면 얼마나
// 남았는지 알 수 없고, 화면의 숫자와 실제 전환이 어긋난다.

/**
 * 배속. 편성 길이에 비례시키면 3시간짜리 칸이 90초가 되므로, 빨리 훑고
 * 싶을 때 쓸 수단이 있어야 한다. 1배속이 규칙 그대로다.
 */
const speed = ref(1)
const SPEED_CHOICES = [1, 2, 4, 8]

/**
 * 지금 칸을 몇 초 보여 줄 것인가.
 *
 * 규칙은 `utils/schedulePreview` 가 갖고 있다 — 요일형은 편성 길이에 비례
 * (10분 = 5초), 목록반복은 칸마다 정해 둔 표출 시간 그대로.
 */
const currentSeconds = computed(() =>
  Math.max(1, Math.round(slotSeconds(slot.value) / speed.value)),
)

/** 지금 칸의 남은 시간(초). 1초마다 줄어든다. */
const remaining = ref(0)

let timer = null

function clearTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function stop() {
  playing.value = false
  clearTimer()
}

function tick() {
  remaining.value -= 1
  if (remaining.value > 0) return
  slotIndex.value = (slotIndex.value + 1) % slots.value.length
  remaining.value = currentSeconds.value
}

function start() {
  clearTimer()
  if (!playing.value || slots.value.length === 0) return
  remaining.value = currentSeconds.value
  timer = setInterval(tick, 1000)
}

function togglePlay() {
  if (slots.value.length === 0) return
  playing.value = !playing.value
  if (playing.value) start()
  else clearTimer()
}

// 배속을 바꾸면 지금 칸부터 그 속도로 센다.
watch(speed, () => {
  if (playing.value) start()
})

// 요일을 바꾸거나 슬롯이 달라지면 남은 시간도 그 칸의 것으로 되돌린다.
watch([groupIndex, () => slots.value.length], () => {
  remaining.value = currentSeconds.value
  if (playing.value) start()
})

onBeforeUnmount(clearTimer)

function go(offset) {
  stop()
  if (slots.value.length === 0) return
  slotIndex.value = (slotIndex.value + offset + slots.value.length) % slots.value.length
}

function selectGroup(index) {
  stop()
  groupIndex.value = index
}

function selectSlot(index) {
  stop()
  slotIndex.value = index
}

// 열자마자 돈다. 미리보기의 목적이 '실제로 어떻게 흘러가는가' 라, 한 번 더
// 누르게 할 이유가 없다.
groupIndex.value = firstNonEmptyGroup()
remaining.value = currentSeconds.value
playing.value = true
start()
</script>

<template>
  <ModalDialog :title="t('preview.title')" :width="size.width" hide-footer @close="emit('close')">
    <!-- 요일 탭 -->
    <div v-if="showGroups" class="day-tabs">
      <button
        v-for="(entry, index) in groups"
        :key="entry.key"
        class="day-tab"
        :class="{ active: index === groupIndex, empty: entry.slots.length === 0 }"
        @click="selectGroup(index)"
      >
        {{ entry.label }}
        <span class="count">{{ entry.slots.length }}</span>
      </button>
    </div>

    <div class="preview-body">
      <!-- 슬롯 목록 -->
      <aside class="slots">
        <div class="slots-head">
          <span>{{ t('preview.slots') }}</span>
          <span v-if="!showGroups" class="muted">
            {{ t('preview.cycle', { seconds: total }) }}
          </span>
        </div>

        <p v-if="slots.length === 0" class="muted pad">{{ t('preview.emptyDay') }}</p>

        <button
          v-for="(entry, index) in slots"
          v-else
          :key="entry.key"
          class="slot"
          :class="{ active: index === slotIndex }"
          @click="selectSlot(index)"
        >
          <span class="slot-label">{{ entry.label }}</span>
          <span class="slot-name" :class="{ missing: !slotHasContent(entry) }">
            {{ entry.contentName ?? t('preview.noContent') }}
          </span>
        </button>
      </aside>

      <!-- 화면 -->
      <section class="screen">
        <div
          ref="stageRef"
          class="screen-stage"
          :class="{ full: isFullscreen }"
          :style="{ minHeight: isFullscreen ? '100vh' : size.stage }"
        >
          <p v-if="loading" class="muted">{{ t('common.loading') }}</p>
          <p v-else-if="loadError" class="error-text">{{ loadError }}</p>
          <p v-else-if="slots.length === 0" class="muted">{{ t('preview.emptyDay') }}</p>
          <p v-else-if="!hasContent" class="muted">{{ t('preview.blankScreen') }}</p>

          <ContentCanvas
            v-else-if="document"
            :key="slot.key"
            :document="document"
            :widgets="widgets"
            readonly
          />
        </div>

        <!-- 남은 시간을 눈으로도. 숫자만으로는 길이 감이 오지 않는다. -->
        <div v-if="slots.length" class="bar">
          <div class="fill" :style="{ width: `${(remaining / currentSeconds) * 100}%` }" />
        </div>

        <div class="controls">
          <button class="btn btn-sm" :disabled="slots.length < 2" @click="go(-1)">‹</button>
          <button
            class="btn btn-sm btn-primary"
            :disabled="slots.length === 0"
            @click="togglePlay"
          >
            {{ playing ? t('preview.pause') : t('preview.play') }}
          </button>
          <button class="btn btn-sm" :disabled="slots.length < 2" @click="go(1)">›</button>

          <span v-if="slots.length" class="muted position">
            {{ slotIndex + 1 }} / {{ slots.length }}
            <template v-if="slot"> · {{ slot.label }}</template>
            · {{ t('preview.remaining', { seconds: Math.max(0, remaining) }) }}
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

          <!-- 요일형은 한 칸이 몇 시간이라 실제 길이로 기다릴 수 없다. -->
          <label class="step">
            {{ t('preview.speed') }}
            <select v-model.number="speed" class="select tiny">
              <option v-for="value in SPEED_CHOICES" :key="value" :value="value">
                {{ t('preview.speedTimes', { times: value }) }}
              </option>
            </select>
          </label>
          <span class="hint">
            {{ showGroups ? t('preview.stepHint') : t('preview.loopHint') }}
          </span>
        </div>
      </section>
    </div>
  </ModalDialog>
</template>

<style scoped>
/* 남은 시간을 눈으로도 보여 준다. */
.bar {
  width: 100%;
  height: 3px;
  margin-top: 6px;
  border-radius: 2px;
  background: var(--border);
  overflow: hidden;
}

.fill {
  height: 100%;
  background: var(--primary);
  /* 1초마다 줄어드는 값이라, 사이를 채워야 눈에 매끄럽게 보인다. */
  transition: width 1s linear;
}

.step,
.size {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-muted);
}

.day-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.day-tab {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.day-tab:hover {
  border-color: var(--primary);
}

.day-tab.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.day-tab.empty {
  color: var(--text-muted);
}

.count {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 10px;
}

.day-tab.active .count {
  background: rgb(255 255 255 / 25%);
  color: #fff;
}

.preview-body {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
}

@media (width <= 820px) {
  .preview-body {
    grid-template-columns: 1fr;
  }
}

.slots {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 58vh;
  overflow-y: auto;
  padding-right: 2px;
}

.slots-head {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  margin-bottom: 2px;
}

.pad {
  padding: 14px 4px;
  font-size: 12px;
}

.slot {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.slot:hover {
  border-color: var(--primary);
}

.slot.active {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.slot-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 600;
}

.slot-name {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slot-name.missing {
  color: var(--warning);
}

.screen {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

/* 전체화면에서는 무대가 화면 전체다. 검은 바탕이라야 화면 경계가 보인다. */
.screen-stage.full {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: #000;
}

.screen-stage {
  display: grid;
  /*
   * 캔버스를 늘려서 채운다. 가운데 정렬로 두면 자식의 height:100% 가
   * 기댈 높이가 자식 자신이 되어(순환) 영역을 못 채운다. 화면 비율에 맞춘
   * 가운데 정렬은 ContentCanvas 가 제 안에서 한다.
   */
  place-items: stretch;
  min-height: 46vh;
  padding: 6px;
  border-radius: var(--radius);
  background: var(--surface-2);
  border: 1px solid var(--border);
}

/* 미리보기에서는 캔버스가 공간을 가득 채운다.
   칸 나눔은 ContentCanvas 의 .readonly 규칙이 정한다. */
.screen-stage > :deep(.canvas-editor) {
  width: 100%;
  height: 100%;
}

.controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.position {
  font-size: 12px;
}
</style>
