<script setup>
/**
 * 목록반복 스케줄 편집기.
 *
 * 요일·시간이 아니라 **재생 순서**가 전부인 스케줄이다. 콘텐츠를 순서대로
 * 늘어놓고 각각 몇 초 표출할지 정하면, 플레이어가 그 순서대로 돌린다.
 *
 * 시간지정 스케줄의 주간 표(ScheduleGridView)와 대응하는 화면이다. 같은 표에
 * 억지로 끼워 넣으면 요일 축이 의미가 없어 빈 표만 보인다.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  isContentDrag,
  isPlaylistItemDrag,
  moveItem,
  readPlaylistItemDrag,
  writePlaylistItemDrag,
} from '@/utils/contentDnd'

const props = defineProps({
  /** 서버 아이템 배열(부모가 소유). 이 컴포넌트가 직접 순서를 바꾼다. */
  items: { type: Array, required: true },
})

const emit = defineEmits(['change', 'pick', 'edit', 'dropContent'])

/** 드롭 위치 표시(항목 사이 어디에 끼울지). */
const dropIndex = ref(null)

/** 지금 끌고 있는 목록 항목의 원래 위치(있으면 재정렬 중). */
const draggingIndex = ref(null)

function onItemDragStart(event, index) {
  draggingIndex.value = index
  writePlaylistItemDrag(event, index)
}

function onItemDragEnd() {
  draggingIndex.value = null
  dropIndex.value = null
}

function onDragOver(event, index) {
  // 라이브러리 카드(추가)와 목록 항목(재정렬) 둘 다 받는다.
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
  emit('dropContent', { event, index })
}

function onDragLeave() {
  dropIndex.value = null
}

const { t } = useI18n()

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

const emptyCount = computed(() => props.items.filter((item) => !item.content_id).length)

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
  const source = props.items[index]
  props.items.splice(index + 1, 0, { ...source, id: null })
  emit('change')
}

function setDuration(item, value) {
  const seconds = Math.max(1, Number(value) || 1)
  item.duration_sec = seconds
  emit('change')
}

function label(item, index) {
  return item.content_name || t('playlist.itemFallback', { index: index + 1 })
}
</script>

<template>
  <div class="playlist card">
    <div class="card-header">
      <h2>{{ t('playlist.title') }}</h2>
      <div class="row">
        <span class="muted total">
          {{ t('playlist.total', { count: items.length, duration: formattedTotal }) }}
        </span>
        <button class="btn btn-sm btn-primary" @click="emit('pick', null)">
          {{ t('playlist.add') }}
        </button>
      </div>
    </div>

    <p
      v-if="items.length === 0"
      class="table-empty drop-zone"
      :class="{ over: dropIndex === 0 }"
      @dragover="onDragOver($event, 0)"
      @dragleave="onDragLeave"
      @drop="onDrop($event, 0)"
    >
      {{ t('playlist.emptyDrop') }}
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
        <span class="grip" :title="t('playlist.dragToReorder')">⠿</span>
        <span class="order">{{ index + 1 }}</span>

        <div class="body">
          <div class="name" :class="{ missing: !item.content_id }">
            {{ label(item, index) }}
          </div>
          <div class="meta muted">
            <span v-if="item.content_id">#{{ item.content_id }}</span>
            <span v-else>{{ t('playlist.noContent') }}</span>
            <span v-if="item.day_of_week >= 0" class="badge badge-warning">
              {{ t('playlist.hasDay') }}
            </span>
          </div>
        </div>

        <label class="duration">
          <input
            class="input"
            type="number"
            min="1"
            :value="item.duration_sec"
            @change="setDuration(item, $event.target.value)"
          />
          <span class="muted">{{ t('playlist.seconds') }}</span>
        </label>

        <div class="actions">
          <button
            class="btn btn-sm btn-icon"
            :disabled="index === 0"
            :title="t('playlist.moveUp')"
            @click="move(index, -1)"
          >
            ↑
          </button>
          <button
            class="btn btn-sm btn-icon"
            :disabled="index === items.length - 1"
            :title="t('playlist.moveDown')"
            @click="move(index, 1)"
          >
            ↓
          </button>
          <button class="btn btn-sm" @click="emit('pick', index)">
            {{ item.content_id ? t('playlist.change') : t('grid.pickFromBrowser') }}
          </button>
          <button
            v-if="item.content_id"
            class="btn btn-sm"
            @click="emit('edit', item.content_id)"
          >
            {{ t('grid.openEditor') }}
          </button>
          <button class="btn btn-sm" :title="t('common.duplicate')" @click="duplicate(index)">
            ⧉
          </button>
          <button class="btn btn-sm btn-danger" @click="remove(index)">
            {{ t('common.delete') }}
          </button>
        </div>
      </li>
      <li
        class="tail-drop"
        :class="{ over: dropIndex === items.length }"
        @dragover="onDragOver($event, items.length)"
        @drop="onDrop($event, items.length)"
      >
        {{ t('playlist.dropHere') }}
      </li>
    </ol>

    <div v-if="emptyCount" class="warn">
      {{ t('playlist.emptyItemsWarn', { count: emptyCount }) }}
    </div>
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
}

.item:last-child {
  border-bottom: 0;
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

.name.missing {
  color: var(--warning);
}

.meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.duration {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  font-size: 11px;
}

.duration .input {
  width: 68px;
  padding: 4px 6px;
  font-size: 12px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.drop-zone.over {
  background: var(--primary-soft);
  outline: 2px dashed var(--primary);
  outline-offset: -6px;
  color: var(--primary);
}

.item.drop-before {
  box-shadow: inset 0 3px 0 var(--primary);
}

.item.dragging {
  opacity: 0.45;
}

.grip {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 14px;
  cursor: grab;
  user-select: none;
}

.item.dragging .grip {
  cursor: grabbing;
}

.tail-drop {
  padding: 10px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  border: 2px dashed transparent;
}

.tail-drop.over {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
}

.warn {
  margin: 0;
  padding: 10px 16px;
  border-top: 1px solid var(--warning-border);
  background: var(--warning-soft);
  color: var(--warning);
  font-size: 12px;
}

@media (width <= 900px) {
  .item {
    flex-wrap: wrap;
  }

  .actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
