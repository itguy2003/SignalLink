<script setup>
/**
 * 스케줄 편집기 왼쪽의 콘텐츠 목록.
 *
 * 여기서 카드를 끌어다 주간 표의 시간대나 재생 목록에 떨어뜨려 일정을 만든다.
 * 모달(콘텐츠 브라우저)을 열지 않고도 여러 개를 연달아 배치할 수 있다.
 *
 * 끌기 정보는 dataTransfer 의 커스텀 MIME 로 넘긴다. 텍스트로만 넘기면 다른
 * 드래그(파일, 선택된 글자)와 구분되지 않아 엉뚱한 드롭이 처리된다.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import { useToastStore } from '@/stores/toast'
import {
  writeContentDrag,
  writeOrgNoticeDrag,
  writePlaylistDrag,
  writeWidgetDrag,
} from '@/utils/contentDnd'
import { defaultSize, labelKey, toQuery } from '@/utils/orientation'

const props = defineProps({
  orgId: { type: Number, default: null },
  /**
   * 스케줄의 화면 방향('LANDSCAPE' | 'PORTRAIT').
   *
   * 주면 그 방향의 콘텐츠만 보여 주고 **필터를 잠근다**. 다른 방향은 어차피
   * 서버가 저장을 거부하므로, 고를 수 있게 두면 끌어다 놓은 뒤에야 실패한다.
   * 없으면(콘텐츠 관리 화면 등) 사용자가 직접 고를 수 있다.
   */
  orientation: { type: String, default: null },
})

/** 스케줄이 방향을 정해 준 상태인가. */
const locked = computed(() => Boolean(props.orientation))

const emit = defineEmits(['edit', 'create'])

const { t } = useI18n()
const toast = useToastStore()

/** 'content' | 'widget' | 'playlist' | 'notice' */
const tab = ref('content')

const items = ref([])
const widgets = ref([])
const playlists = ref([])
const loading = ref(false)
const query = ref('')
/** `GET /contents` 의 질의값('landscape' | 'portrait' | ''). */
const orientationFilter = ref(toQuery(props.orientation))
const draggingId = ref(null)

/**
 * 위젯을 감쌀 콘텐츠의 크기.
 *
 * 스케줄이 방향을 정해 줬으면 그 방향을 따른다. 안 그러면 세로 스케줄에
 * 위젯을 놓는 순간 1920×1080 콘텐츠가 만들어져 저장에서 거부된다.
 */
const wrapSize = computed(() =>
  defaultSize(props.orientation ?? (orientationFilter.value === 'portrait' ? 'PORTRAIT' : 'LANDSCAPE')),
)

const visibleWidgets = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  const matched = keyword
    ? widgets.value.filter((w) => w.name.toLowerCase().includes(keyword))
    : widgets.value

  // 카테고리(기능형/콘텐츠형)로 묶어 보여 준다.
  const groups = {}
  for (const spec of matched) {
    ;(groups[spec.category] ??= []).push(spec)
  }
  return groups
})

async function load() {
  loading.value = true
  try {
    const page = await api.get('/contents', {
      q: query.value || undefined,
      orientation: orientationFilter.value || undefined,
      org_id: props.orgId ?? undefined,
      size: 60,
    })
    items.value = page.items
  } catch (err) {
    toast.error(err.detail ?? t('content.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function loadWidgets() {
  if (widgets.value.length) return
  widgets.value = await api.get('/widgets').catch(() => [])
}

/**
 * 재생목록. 탭을 열 때마다 다시 받는다 — 한 번 받아 두면 다른 화면에서 만든
 * 목록이 여기서는 영영 보이지 않는다.
 */
async function loadPlaylists() {
  const page = await api.get('/playlists', { size: 100 }).catch(() => null)
  playlists.value = page?.items ?? []
}

const visiblePlaylists = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return playlists.value
  return playlists.value.filter((p) => p.name.toLowerCase().includes(keyword))
})

/**
 * 소속기관 공지 — 자기 것 + 상위기관이 내린 것(for_org). 공지는 **통째로
 * 참조**로 담는다: 카드를 끌어다 놓으면 스케줄 아이템이 공지 id 를 들고,
 * 표출 시 서버가 슬라이드 전체로 펼친다.
 */
const notices = ref([])

async function loadNotices() {
  if (!props.orgId) return
  notices.value = await api.get('/org-notices', { for_org: props.orgId }).catch(() => [])
}

const visibleNotices = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return notices.value
  return notices.value.filter((n) => n.name.toLowerCase().includes(keyword))
})

function onNoticeDragStart(event, notice) {
  draggingId.value = `n${notice.id}`
  writeOrgNoticeDrag(event, notice)
}

watch(tab, (value) => {
  if (value === 'playlist') loadPlaylists()
  if (value === 'notice') loadNotices()
})

onMounted(async () => {
  await load()
  await loadWidgets()
})
watch(orientationFilter, load)
watch(() => props.orgId, load)
// 스케줄의 방향이 바뀌면(설정 변경) 목록도 따라가야 한다.
watch(
  () => props.orientation,
  (value) => {
    orientationFilter.value = toQuery(value)
  },
)

function onDragStart(event, content) {
  draggingId.value = `c${content.id}`
  writeContentDrag(event, content)
}

function onWidgetDragStart(event, widget) {
  draggingId.value = `w${widget.key}`
  writeWidgetDrag(event, widget, wrapSize.value)
}

function onPlaylistDragStart(event, playlist) {
  draggingId.value = `p${playlist.id}`
  writePlaylistDrag(event, playlist)
}

function onDragEnd() {
  draggingId.value = null
}

defineExpose({ reload: load })
</script>

<template>
  <aside class="library card">
    <div class="card-header">
      <h2>{{ t('library.title') }}</h2>
      <button class="btn btn-sm" :disabled="loading" @click="load">
        {{ t('common.refresh') }}
      </button>
    </div>

    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'content' }" @click="tab = 'content'">
        {{ t('library.tabContent') }}
      </button>
      <button class="tab" :class="{ active: tab === 'widget' }" @click="tab = 'widget'">
        {{ t('library.tabWidget') }}
      </button>
      <button class="tab" :class="{ active: tab === 'playlist' }" @click="tab = 'playlist'">
        {{ t('library.tabPlaylist') }}
      </button>
      <button
        v-if="props.orgId"
        class="tab"
        :class="{ active: tab === 'notice' }"
        data-test="tab-notice"
        @click="tab = 'notice'"
      >
        {{ t('library.tabNotice') }}
      </button>
    </div>

    <div class="filters">
      <input
        v-model="query"
        class="input"
        :placeholder="
          tab === 'widget'
            ? t('library.searchWidget')
            : tab === 'playlist'
              ? t('widgetPlaylist.searchPlaceholder')
              : t('content.searchPlaceholder')
        "
        @keyup.enter="load"
      />
      <!-- 스케줄이 방향을 정해 준 상태면 고를 수 없다. 다른 방향은 서버가 거부한다. -->
      <span v-if="locked" class="badge badge-primary locked-orientation">
        {{ t(labelKey(props.orientation)) }}
      </span>
      <select v-else v-model="orientationFilter" class="select">
        <option value="">{{ t('content.allOrientations') }}</option>
        <option value="landscape">{{ t('content.landscape') }}</option>
        <option value="portrait">{{ t('content.portrait') }}</option>
      </select>
    </div>

    <p class="hint drag-hint">
      <template v-if="locked">
        {{ t('library.orientationLocked', { orientation: t(labelKey(props.orientation)) }) }}
      </template>
      <template v-else-if="tab === 'widget'">{{ t('library.dragWidgetHint') }}</template>
      <template v-else-if="tab === 'playlist'">{{ t('library.dragPlaylistHint') }}</template>
      <template v-else-if="tab === 'notice'">{{ t('library.dragNoticeHint') }}</template>
      <template v-else>{{ t('library.dragHint') }}</template>
    </p>

    <!-- 콘텐츠 탭 -->
    <div v-if="tab === 'content'" class="list">
      <p v-if="loading" class="muted pad">{{ t('common.loading') }}</p>
      <p v-else-if="items.length === 0" class="muted pad">{{ t('library.empty') }}</p>

      <article
        v-for="content in items"
        v-else
        :key="content.id"
        class="card-item"
        :class="{ dragging: draggingId === `c${content.id}` }"
        draggable="true"
        :title="content.name"
        @dragstart="onDragStart($event, content)"
        @dragend="onDragEnd"
      >
        <span
          class="thumb"
          :class="{ portrait: content.height > content.width }"
          :style="{ background: content.background }"
        />
        <div class="info">
          <div class="name">{{ content.name }}</div>
          <div class="meta muted">
            {{ content.width }}×{{ content.height }} ·
            {{ t('content.elementCount', { count: content.element_count }) }}
          </div>
        </div>
        <button class="btn btn-sm btn-icon" :title="t('common.edit')" @click="emit('edit', content)">
          ✎
        </button>
      </article>
    </div>

    <!-- 위젯 탭: 끌어 놓으면 그 위젯이 화면을 꽉 채우는 콘텐츠가 만들어진다. -->
    <div v-else-if="tab === 'widget'" class="list">
      <p v-if="widgets.length === 0" class="muted pad">{{ t('common.loading') }}</p>

      <template v-for="(specs, category) in visibleWidgets" v-else :key="category">
        <div class="group-title">{{ t(`enums.widgetCategory.${category}`) }}</div>
        <article
          v-for="spec in specs"
          :key="spec.key"
          class="card-item widget-item"
          :class="{ dragging: draggingId === `w${spec.key}` }"
          draggable="true"
          :title="spec.description"
          @dragstart="onWidgetDragStart($event, spec)"
          @dragend="onDragEnd"
        >
          <span class="thumb widget-thumb">◧</span>
          <div class="info">
            <div class="name">{{ spec.name }}</div>
            <div class="meta muted">{{ spec.description }}</div>
          </div>
        </article>
      </template>
    </div>

    <!-- 재생목록 탭: 놓으면 그 재생목록이 화면을 꽉 채우는 콘텐츠가 만들어진다. -->
    <div v-if="tab === 'playlist'" class="list">
      <p v-if="playlists.length === 0" class="muted pad">{{ t('widgetPlaylist.empty') }}</p>
      <p v-else-if="visiblePlaylists.length === 0" class="muted pad">
        {{ t('org.searchNoMatch') }}
      </p>

      <article
        v-for="playlist in visiblePlaylists"
        v-else
        :key="playlist.id"
        class="card-item"
        :class="{ dragging: draggingId === `p${playlist.id}` }"
        draggable="true"
        :title="playlist.name"
        @dragstart="onPlaylistDragStart($event, playlist)"
        @dragend="onDragEnd"
      >
        <span class="thumb widget-thumb">🔁</span>
        <div class="info">
          <div class="name">{{ playlist.name }}</div>
          <div class="meta muted">
            {{ t('widgetPlaylist.itemCount', { count: playlist.items?.length ?? 0 }) }} ·
            {{ t('widgetPlaylist.duration', { sec: playlist.total_duration_sec ?? 0 }) }}
          </div>
        </div>
      </article>
    </div>

    <!-- 공지 탭: 카드를 끌어다 놓으면 공지 전체가 참조로 담긴다. -->
    <div v-if="tab === 'notice'" class="list">
      <p v-if="notices.length === 0" class="muted pad">{{ t('orgNotice.empty') }}</p>
      <p v-else-if="visibleNotices.length === 0" class="muted pad">
        {{ t('org.searchNoMatch') }}
      </p>

      <article
        v-for="notice in visibleNotices"
        v-else
        :key="notice.id"
        class="card-item"
        :class="{ dragging: draggingId === `n${notice.id}` }"
        draggable="true"
        data-test="notice-item"
        :title="notice.name"
        @dragstart="onNoticeDragStart($event, notice)"
        @dragend="onDragEnd"
      >
        <span class="thumb widget-thumb">📢</span>
        <div class="info">
          <div class="name">
            {{ notice.name }}
            <span v-if="notice.org_name" class="badge badge-muted">{{ notice.org_name }}</span>
          </div>
          <div class="meta muted">
            {{ t('orgNotice.itemCount', { count: notice.item_count ?? 0 }) }}
            <template v-if="notice.start_date || notice.end_date">
              · {{ (notice.start_date ?? '').replace('T', ' ') }} ~
              {{ (notice.end_date ?? '').replace('T', ' ') }}
            </template>
          </div>
        </div>
      </article>
    </div>

    <div class="foot">
      <button class="btn btn-sm btn-primary wide" @click="emit('create')">
        {{ t('content.createButton') }}
      </button>
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

.tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
}

.tab {
  flex: 1;
  padding: 8px 0;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.tab:hover {
  color: var(--text);
}

.tab.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
  font-weight: 600;
}

.group-title {
  padding: 6px 4px 2px;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
}

.widget-thumb {
  display: grid;
  place-items: center;
  width: 28px;
  height: 24px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 13px;
}

.widget-item .meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filters {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px 6px;
}

.filters .input,
.filters .select {
  padding: 5px 8px;
  font-size: 12px;
}

/* 고를 수 없는 값이라 select 자리에 배지로 둔다. */
.locked-orientation {
  align-self: flex-start;
}

.drag-hint {
  padding: 0 12px 8px;
  line-height: 1.5;
}

.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pad {
  padding: 16px 4px;
  text-align: center;
  font-size: 12px;
}

.card-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: grab;
}

.card-item:hover {
  border-color: var(--primary);
}

.card-item.dragging {
  opacity: 0.45;
  cursor: grabbing;
}

.thumb {
  flex-shrink: 0;
  width: 40px;
  height: 24px;
  border-radius: 3px;
  border: 1px solid var(--border);
}

.thumb.portrait {
  width: 20px;
  height: 34px;
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
  font-size: 10px;
}

.foot {
  padding: 8px 12px 12px;
  border-top: 1px solid var(--border);
}

.wide {
  width: 100%;
  justify-content: center;
}

/* 공지 슬라이드 — 한 단 들여 공지에 딸린 것임을 보인다. */
.slides {
  margin: 2px 0 6px 18px;
  display: grid;
  gap: 4px;
}

.slide-thumb {
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
  background: var(--primary-soft);
}
</style>
