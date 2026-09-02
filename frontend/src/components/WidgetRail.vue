<script setup>
/**
 * 콘텐츠 편집기 왼쪽의 요소·위젯 레일.
 *
 * 이름을 늘어놓는 대신 아이콘만 세운다. 캔버스가 가져갈 가로 공간을 아끼기
 * 위해서다. 이름은 툴팁으로 뜬다. 한 줄에 두 개씩 놓는 이유는 위젯이 계속
 * 늘어나는 영역이라 한 줄로 세우면 아래쪽이 스크롤 밖으로 밀리기 때문이다.
 *
 * 누르면 캔버스 가운데(또는 선택한 분할 영역)에 만들고, 끌어다 놓으면 그
 * 자리에 만든다.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { writeElementDrag } from '@/utils/contentDnd'
import { ELEMENT_ICONS, widgetIcon } from '@/utils/widgetSamples'

const props = defineProps({
  widgets: { type: Array, default: () => [] },
  /** 지금 놓을 자리로 지정된 분할 영역(있으면 안내에 쓴다). */
  targetRegion: { type: Number, default: null },
})

const emit = defineEmits(['add'])

const { t } = useI18n()

// 재생목록은 여기 두지 않는다 — '어느 목록인가' 가 정해져야 의미가 있어
// 아래에 따로 묶는다.
const BASIC = ['text', 'image', 'video', 'web']

const widgetGroups = computed(() => {
  const groups = {}
  for (const spec of props.widgets) {
    ;(groups[spec.category] ??= []).push(spec)
  }
  return groups
})

function basicLabel(type) {
  const map = {
    text: 'canvas.text',
    image: 'canvas.elementImage',
    video: 'canvas.elementVideo',
    web: 'canvas.elementWeb',
  }
  return t(map[type])
}

function onBasicDragStart(event, type) {
  writeElementDrag(event, { type, label: basicLabel(type) })
}

function onWidgetDragStart(event, spec) {
  writeElementDrag(event, { type: 'widget', widgetKey: spec.key, label: spec.name })
}

/**
 * 재생목록은 아이콘만 봐서는 서로 구분되지 않는다(전부 같은 🔁 다). 그래서
 * 여기서는 입구 하나만 두고, 어느 목록인지는 캔버스가 띄우는 고르기 레이어
 * 에서 첫 위젯 화면을 보며 고른다.
 */
function onPlaylistDragStart(event) {
  writeElementDrag(event, { type: 'playlist', label: t('widgetPlaylist.element') })
}
</script>

<template>
  <div class="rail" :class="{ targeting: targetRegion !== null }">
    <div class="rail-group">
      <div class="rail-label">{{ t('rail.basic') }}</div>
      <div class="rail-btns">
        <button
          v-for="type in BASIC"
          :key="type"
          class="rail-btn"
          :title="basicLabel(type)"
          :aria-label="basicLabel(type)"
          draggable="true"
          @click="emit('add', { type })"
          @dragstart="onBasicDragStart($event, type)"
        >
          <span class="icon" :class="{ letter: type === 'text' }">{{ ELEMENT_ICONS[type] }}</span>
        </button>
      </div>
    </div>

    <div v-for="(specs, category) in widgetGroups" :key="category" class="rail-group">
      <div class="rail-label">{{ t(`enums.widgetCategory.${category}`) }}</div>
      <div class="rail-btns">
        <button
          v-for="spec in specs"
          :key="spec.key"
          class="rail-btn"
          :title="`${spec.name} — ${spec.description}`"
          :aria-label="spec.name"
          draggable="true"
          @click="emit('add', { type: 'widget', widgetKey: spec.key })"
          @dragstart="onWidgetDragStart($event, spec)"
        >
          <span class="icon">{{ widgetIcon(spec.key) }}</span>
        </button>
      </div>
    </div>

    <div class="rail-group">
      <div class="rail-label">{{ t('widgetPlaylist.element') }}</div>
      <div class="rail-btns">
        <!-- 누르면 고르기 레이어가 열린다. 끌어다 놓으면 놓은 자리에 만든다. -->
        <button
          class="rail-btn pick"
          :title="t('widgetPlaylist.pick')"
          :aria-label="t('widgetPlaylist.pick')"
          draggable="true"
          @click="emit('add', { type: 'playlist' })"
          @dragstart="onPlaylistDragStart"
        >
          <span class="icon">{{ ELEMENT_ICONS.playlist }}</span>
        </button>
      </div>
    </div>

    <p class="rail-hint" :title="t('rail.hint')">?</p>
  </div>
</template>

<style scoped>
.rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  /* 아이콘 두 줄이 들어갈 폭. 늘어나는 위젯을 한 줄로 세우면 아래쪽이
     스크롤 밖으로 밀려 매번 굴려야 한다. */
  width: 92px;
  padding: 8px 6px;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

/* 한 줄에 두 개. 홀수로 남는 마지막 하나는 왼쪽에 붙는다. */
.rail-btns {
  display: grid;
  grid-template-columns: repeat(2, 38px);
  gap: 2px;
  justify-content: center;
}

/* 분할 영역을 골라 둔 상태면 레일을 강조해, 누르면 그 자리에 들어감을 알린다. */
.rail.targeting {
  border-color: var(--primary);
}

.rail-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 100%;
  padding-bottom: 6px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border);
}

.rail-group:last-of-type {
  border-bottom: 0;
}

.rail-label {
  font-size: 9px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin-bottom: 2px;
  text-align: center;
  line-height: 1.2;
  word-break: keep-all;
}

.rail-btn {
  display: grid;
  place-items: center;
  width: 38px;
  height: 34px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: none;
  cursor: grab;
  font-family: inherit;
}

.rail-btn:hover {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.rail-btn:active {
  cursor: grabbing;
}

.icon {
  font-size: 17px;
  line-height: 1;
}

/* 텍스트는 그림 대신 글자로 나타낸다. */
.icon.letter {
  font-size: 16px;
  font-weight: 800;
  font-family: Georgia, 'Times New Roman', serif;
  color: var(--text);
}

.rail-hint {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin: 4px 0 0;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 11px;
  cursor: help;
}
</style>
