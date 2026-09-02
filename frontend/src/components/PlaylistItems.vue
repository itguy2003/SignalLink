<script setup>
/**
 * 위젯 재생목록 편집기의 오른쪽 — 재생 순서.
 *
 * 목록반복 스케줄 편집기(SchedulePlaylist)와 같은 화면이다. 다른 것은 담기는
 * 것이 콘텐츠가 아니라 **위젯**이라는 점뿐이라, 몸짓(끌어서 순서 바꾸기,
 * 끼어들 자리 표시, 맨 뒤 놓는 자리)은 그대로 맞췄다. 두 화면에서 손이
 * 달라지면 같은 일을 두 번 배워야 한다.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  isContentDrag,
  isPlaylistItemDrag,
  moveItem,
  readContentDrag,
  readPlaylistItemDrag,
  writePlaylistItemDrag,
} from '@/utils/contentDnd'
import {
  DEFAULT_TRANSITION,
  DEFAULT_TRANSITION_MS,
  MAX_TRANSITION_MS,
  MIN_TRANSITION_MS,
  TRANSITION_GROUPS,
  fitsIn,
  groupKey,
  labelKey,
  normalizeMs,
} from '@/utils/transitions'

const props = defineProps({
  /** 항목 배열(부모가 소유). 이 컴포넌트가 직접 순서를 바꾼다. */
  items: { type: Array, required: true },
  /** 위젯 키 → 이름. 목록에는 키가 아니라 사람이 읽는 이름이 보여야 한다. */
  names: { type: Object, default: () => new Map() },
})

const emit = defineEmits(['change', 'addWidget'])

const { t } = useI18n()

/** 끼어들 자리(항목 사이 어디에 낄지). */
const dropIndex = ref(null)

/** 지금 끌고 있는 항목의 원래 위치(있으면 재정렬 중). */
const draggingIndex = ref(null)

const totalSeconds = computed(() =>
  props.items.reduce((sum, item) => sum + (Number(item.duration_sec) || 0), 0),
)

const formattedTotal = computed(() => {
  const total = totalSeconds.value
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0
    ? t('playlist.durationMinSec', { minutes, seconds })
    : t('playlist.durationSec', { seconds })
})

function onItemDragStart(event, index) {
  draggingIndex.value = index
  writePlaylistItemDrag(event, index)
}

function onItemDragEnd() {
  draggingIndex.value = null
  dropIndex.value = null
}

function onDragOver(event, index) {
  // 왼쪽 위젯 카드(추가)와 목록 항목(재정렬) 둘 다 받는다.
  if (isPlaylistItemDrag(event)) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    dropIndex.value = index
    return
  }
  if (!isContentDrag(event)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  dropIndex.value = index
}

function onDragLeave() {
  dropIndex.value = null
}

function onDrop(event, index) {
  if (isPlaylistItemDrag(event)) {
    event.preventDefault()
    dropIndex.value = null
    const from = readPlaylistItemDrag(event)
    draggingIndex.value = null
    if (from === null) return

    const reordered = moveItem(props.items, from, index)
    if (reordered === props.items) return
    // 부모가 배열을 소유하므로 자리에서 바꿔 준다.
    props.items.splice(0, props.items.length, ...reordered)
    emit('change')
    return
  }

  if (!isContentDrag(event)) return
  event.preventDefault()
  dropIndex.value = null
  const payload = readContentDrag(event)
  // 재생목록에는 위젯만 담긴다. 콘텐츠 카드가 넘어와도 무시한다.
  if (payload?.kind !== 'widget') return
  emit('addWidget', { key: payload.key, index })
}

function move(index, offset) {
  const target = index + offset
  if (target < 0 || target >= props.items.length) return
  const [item] = props.items.splice(index, 1)
  props.items.splice(target, 0, item)
  emit('change')
}

function remove(index) {
  props.items.splice(index, 1)
  emit('change')
}

function duplicate(index) {
  props.items.splice(index + 1, 0, { ...props.items[index] })
  emit('change')
}

function setDuration(item, value) {
  item.duration_sec = Math.max(1, Number(value) || 1)
  emit('change')
}

/**
 * 앞 칸에서 이 칸으로 넘어올 때의 효과.
 *
 * 칸마다 따로 정한다 — 공지에서 급식으로는 부드럽게 넘기고 사진은 확 바뀌게
 * 하는 식으로, 넘어가는 방식이 내용에 따라 달라진다.
 */
function setTransition(item, value) {
  item.transition = value
  emit('change')
}

/**
 * 전환에 걸리는 시간. 사진은 느긋하게, 공지는 빠르게 — 내용에 따라 호흡이
 * 다르다. 범위 밖 값은 여기서 끌어다 맞춘다(서버도 같은 범위를 지킨다).
 */
function setTransitionMs(item, value) {
  item.transition_ms = normalizeMs(value)
  emit('change')
}

/** 전환이 그 칸의 표출 시간 안에 끝나는가. 넘치면 저장에서 서버가 막는다. */
function overflows(item) {
  return !fitsIn(item.transition, item.transition_ms ?? DEFAULT_TRANSITION_MS, item.duration_sec)
}

/** 하나 정해 두고 전체에 퍼뜨린다. 칸이 많으면 하나씩 고르는 일이 고역이다. */
function applyToAll(value) {
  // 안내 문구('모두 적용')를 되고를 때는 아무 일도 하지 않는다.
  if (!value) return
  for (const item of props.items) item.transition = value
  emit('change')
}

function label(item, index) {
  return (
    props.names.get?.(item.widget_key) ??
    item.widget_key ??
    t('widgetPlaylist.itemFallback', { index: index + 1 })
  )
}
</script>

<template>
  <div class="playlist card">
    <div class="card-header">
      <h2>{{ t('widgetPlaylist.items') }}</h2>
      <span class="muted total">
        {{ t('playlist.total', { count: items.length, duration: formattedTotal }) }}
      </span>
      <!-- 칸이 많으면 하나씩 고르는 것이 고역이다. -->
      <select
        v-if="items.length > 1"
        class="select apply-all"
        @change="applyToAll($event.target.value); $event.target.value = ''"
      >
        <option value="">{{ t('transition.applyAll') }}</option>
        <optgroup
          v-for="group in TRANSITION_GROUPS"
          :key="group.key"
          :label="t(groupKey(group.key))"
        >
          <option v-for="kind in group.kinds" :key="kind" :value="kind">
            {{ t(labelKey(kind)) }}
          </option>
        </optgroup>
      </select>
    </div>

    <p
      v-if="items.length === 0"
      class="table-empty drop-zone"
      :class="{ over: dropIndex === 0 }"
      @dragover="onDragOver($event, 0)"
      @dragleave="onDragLeave"
      @drop="onDrop($event, 0)"
    >
      {{ t('widgetPlaylist.emptyDrop') }}
    </p>

    <ol v-else class="list" @dragleave="onDragLeave">
      <li
        v-for="(item, index) in items"
        :key="index"
        class="item"
        :class="{ 'drop-before': dropIndex === index, dragging: draggingIndex === index }"
        draggable="true"
        @dragstart="onItemDragStart($event, index)"
        @dragend="onItemDragEnd"
        @dragover="onDragOver($event, index)"
        @drop="onDrop($event, index)"
      >
        <span class="grip" :title="t('widgetPlaylist.dragToReorder')">⠿</span>
        <span class="order">{{ index + 1 }}</span>

        <div class="body">
          <div class="name">{{ label(item, index) }}</div>
          <div class="meta muted">
            {{ item.widget_key }}
            <!-- 효과가 끝나기 전에 넘어가면 화면이 영영 제자리에 놓이지 않는다. -->
            <span v-if="overflows(item)" class="warn">{{ t('transition.tooLong') }}</span>
          </div>
        </div>

        <label class="transition" :class="{ bad: overflows(item) }">
          <span class="muted">{{ t('transition.label') }}</span>
          <select
            class="select"
            :value="item.transition ?? DEFAULT_TRANSITION"
            @change="setTransition(item, $event.target.value)"
          >
            <optgroup
              v-for="group in TRANSITION_GROUPS"
              :key="group.key"
              :label="t(groupKey(group.key))"
            >
              <option v-for="kind in group.kinds" :key="kind" :value="kind">
                {{ t(labelKey(kind)) }}
              </option>
            </optgroup>
          </select>
          <!-- 효과가 없으면 시간은 쓰이지 않는다. 고칠 수 있게 두면 헛일이다. -->
          <input
            class="input ms"
            type="number"
            :min="MIN_TRANSITION_MS"
            :max="MAX_TRANSITION_MS"
            step="100"
            :title="t('transition.msTitle')"
            :disabled="(item.transition ?? DEFAULT_TRANSITION) === 'none'"
            :value="item.transition_ms ?? DEFAULT_TRANSITION_MS"
            @change="setTransitionMs(item, $event.target.value)"
          />
          <span class="muted">{{ t('transition.ms') }}</span>
        </label>

        <label class="duration">
          <input
            class="input"
            type="number"
            min="1"
            max="600"
            :value="item.duration_sec"
            @change="setDuration(item, $event.target.value)"
          />
          <span class="muted">{{ t('widgetPlaylist.seconds') }}</span>
        </label>

        <div class="actions">
          <button
            class="btn btn-sm btn-icon"
            :disabled="index === 0"
            :title="t('widgetPlaylist.moveUp')"
            @click="move(index, -1)"
          >
            ↑
          </button>
          <button
            class="btn btn-sm btn-icon"
            :disabled="index === items.length - 1"
            :title="t('widgetPlaylist.moveDown')"
            @click="move(index, 1)"
          >
            ↓
          </button>
          <button class="btn btn-sm btn-icon" :title="t('common.duplicate')" @click="duplicate(index)">
            ⧉
          </button>
          <button
            class="btn btn-sm btn-icon btn-danger"
            :title="t('widgetPlaylist.removeItem')"
            @click="remove(index)"
          >
            ✕
          </button>
        </div>
      </li>

      <li
        class="tail-drop"
        :class="{ over: dropIndex === items.length }"
        @dragover="onDragOver($event, items.length)"
        @drop="onDrop($event, items.length)"
      >
        {{ t('widgetPlaylist.dropHere') }}
      </li>
    </ol>
  </div>
</template>

<style scoped>
.playlist {
  overflow: hidden;
}

.card-header h2 {
  font-size: 14px;
}

.total {
  font-size: 12px;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  cursor: grab;
}

.item:last-of-type {
  border-bottom: 0;
}

.item.dragging {
  opacity: 0.45;
}

/* 끼어들 자리를 항목 위쪽 선으로 못 박는다. 어디에 놓이는지 미리 보인다. */
.item.drop-before {
  box-shadow: inset 0 2px 0 0 var(--primary);
}

.grip {
  flex: none;
  color: var(--muted);
  line-height: 1;
}

.order {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
}

.body {
  flex: 1;
  min-width: 0;
}

.name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  font-size: 11px;
}

.duration {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
}

.transition {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
}

.transition .select {
  width: 116px;
  padding: 3px 6px;
  font-size: 12px;
}

.transition .ms {
  width: 62px;
  padding: 3px 6px;
  font-size: 12px;
}

.transition.bad .ms {
  border-color: var(--danger);
}

.warn {
  color: var(--danger);
}

.apply-all {
  width: 116px;
  padding: 3px 6px;
  font-size: 11px;
}

.duration .input {
  width: 68px;
  padding: 3px 6px;
  font-size: 12px;
}

.actions {
  display: flex;
  gap: 4px;
}

/* 맨 뒤로 보내려면 마지막 항목 아래에도 받을 자리가 있어야 한다. */
.tail-drop {
  margin: 8px 16px 12px;
  padding: 8px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  color: var(--muted);
  font-size: 11px;
  text-align: center;
}

.drop-zone {
  margin: 12px 16px;
  border: 1px dashed var(--border);
  border-radius: 6px;
}

.tail-drop.over,
.drop-zone.over {
  border-color: var(--primary);
  color: var(--primary);
}
</style>
