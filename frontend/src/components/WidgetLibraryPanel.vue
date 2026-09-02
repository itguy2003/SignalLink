<script setup>
/**
 * 재생목록 편집기 왼쪽의 위젯 목록.
 *
 * 스케줄 편집기의 콘텐츠 목록(ContentLibraryPanel)과 같은 자리, 같은 몸짓이다.
 * 여기서 카드를 끌어다 오른쪽 재생 목록에 떨어뜨려 순서를 짠다. 모달을 열지
 * 않고도 여러 개를 연달아 담을 수 있다.
 *
 * 끌기 정보는 콘텐츠 목록과 **같은 MIME** 을 쓴다. 위젯 페이로드
 * (`kind: 'widget'`)가 이미 있어서 새 규약을 만들 이유가 없고, 받는 쪽도
 * `isContentDrag` 하나로 판정한다.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import { writeWidgetDrag } from '@/utils/contentDnd'

const emit = defineEmits(['add'])

const { t } = useI18n()

const widgets = ref([])
const loading = ref(false)
const query = ref('')
const draggingKey = ref(null)

/** 카테고리(기능형/콘텐츠형)로 묶는다. 종류가 계속 늘어나 평면 목록은 못 읽는다. */
const grouped = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  const matched = keyword
    ? widgets.value.filter((w) => w.name.toLowerCase().includes(keyword))
    : widgets.value

  const groups = {}
  for (const spec of matched) {
    ;(groups[spec.category] ??= []).push(spec)
  }
  return groups
})

const empty = computed(() => Object.keys(grouped.value).length === 0)

async function load() {
  loading.value = true
  try {
    widgets.value = await api.get('/widgets')
  } catch {
    // 위젯 목록은 서버가 동적으로 만든다. 못 받아도 화면은 살아 있어야 한다.
    widgets.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)

function onDragStart(event, widget) {
  draggingKey.value = widget.key
  writeWidgetDrag(event, widget)
}

function onDragEnd() {
  draggingKey.value = null
}

defineExpose({ reload: load })
</script>

<template>
  <aside class="library card">
    <div class="card-header">
      <h2>{{ t('widgetPlaylist.libraryTitle') }}</h2>
      <button class="btn btn-sm" :disabled="loading" @click="load">
        {{ t('common.refresh') }}
      </button>
    </div>

    <div class="filters">
      <input
        v-model="query"
        class="input"
        :placeholder="t('library.searchWidget')"
      />
    </div>

    <p class="hint drag-hint">{{ t('widgetPlaylist.dragHint') }}</p>

    <div class="list">
      <p v-if="loading" class="muted pad">{{ t('common.loading') }}</p>
      <p v-else-if="empty" class="muted pad">{{ t('widgetPlaylist.noWidget') }}</p>

      <template v-for="(specs, category) in grouped" v-else :key="category">
        <div class="group-title">{{ t(`enums.widgetCategory.${category}`) }}</div>
        <article
          v-for="spec in specs"
          :key="spec.key"
          class="card-item widget-item"
          :class="{ dragging: draggingKey === spec.key }"
          draggable="true"
          :title="spec.description"
          @dragstart="onDragStart($event, spec)"
          @dragend="onDragEnd"
        >
          <span class="thumb widget-thumb">◧</span>
          <div class="info">
            <div class="name">{{ spec.name }}</div>
            <div class="meta muted">{{ spec.description }}</div>
          </div>
          <!-- 끌어 놓기가 어려운 환경도 있다. 누르면 맨 뒤에 붙는다. -->
          <button class="btn btn-sm btn-icon" :title="t('widgetPlaylist.addWidget')" @click="emit('add', spec)">
            +
          </button>
        </article>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.library {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.card-header h2 {
  font-size: 13px;
}

.filters {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.filters .input {
  flex: 1;
  min-width: 0;
}

.drag-hint {
  margin: 0;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
}

.list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: grid;
  gap: 6px;
  align-content: start;
}

.pad {
  padding: 12px;
  font-size: 12px;
}

.group-title {
  padding: 6px 2px 2px;
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
}

.card-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  cursor: grab;
}

.card-item.dragging {
  opacity: 0.45;
}

.thumb {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 22px;
  border-radius: 4px;
  background: var(--surface-2);
  font-size: 12px;
}

.info {
  flex: 1;
  min-width: 0;
}

.name {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
