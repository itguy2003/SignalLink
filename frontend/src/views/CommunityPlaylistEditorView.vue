<script setup>
/**
 * 커뮤니티 게시물 편집기 — 소속기관 공지 편집기와 같은 짜임(2026-10).
 *
 *   머리글   제목(읽기)·[메타정보]·[미리보기]·[목록]·[저장] + 메타 요약.
 *            제목·공지대상·기간·연락처·메모는 메타정보 레이어에서 고친다.
 *   왼쪽     콘텐츠 편집기(ContentCanvas). 오른쪽에서 고른 슬라이드의 문서를
 *            그 자리에서 편집한다.
 *   오른쪽   슬라이드 목록. 추가하고, 순서를 바꾸고, 유지 시간을 정한다.
 *
 * 슬라이드는 문서를 인라인으로 갖는다 — 게시물을 지우면 함께 사라지고
 * 콘텐츠 라이브러리에 부산물이 남지 않는다. 이미지·동영상은 **이 게시물에
 * 올린 파일**만 쓴다(mediaSource) — 기관 자산 라이브러리는 일반 사용자의
 * 권한 밖이고, 게시물의 파일은 게시물과 함께 산다. 저장은 아이템 전체 교체다.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { onBeforeRouteLeave, useRoute } from 'vue-router'

import { api } from '@/api/client'
import CommunityMetaDialog from '@/components/CommunityMetaDialog.vue'
import ContentCanvas from '@/components/ContentCanvas.vue'
import ContentPreview from '@/components/ContentPreview.vue'
import { useToastStore } from '@/stores/toast'
import { formatNoticeTargets } from '@/utils/communityTargets'

const route = useRoute()
const toast = useToastStore()
const { t } = useI18n()

const loading = ref(true)
const saving = ref(false)
const dirty = ref(false)
const missing = ref(false)
const previewOpen = ref(false)

/** 서버가 준 원본(게시 상태·버전·기관 표시용). */
const source = ref(null)

const title = ref('')
const memo = ref('')
const targetOrgTypes = ref([])
const noticeStart = ref('')
const noticeEnd = ref('')
const contact = ref('')

/** 메타정보 레이어 열림 여부. 값은 레이어가 제 안에서 고치고 확인에만 넘어온다. */
const metaOpen = ref(false)

function applyMeta(meta) {
  title.value = meta.title
  memo.value = meta.memo
  targetOrgTypes.value = meta.target_org_types
  noticeStart.value = meta.notice_start
  noticeEnd.value = meta.notice_end
  contact.value = meta.contact
  markDirty()
  metaOpen.value = false
}

/** 슬라이드 — { _key, duration_sec, document }. 순서가 재생 순서다. */
const items = ref([])
/** 이 게시물에 올린 파일 전부 — 캔버스의 이미지·동영상 고르기 출처. */
const assets = ref([])
/** 위젯 명세 — 캔버스가 위젯 이름·크기를 아는 근거. */
const widgets = ref([])
const selectedIndex = ref(0)

/** 캔버스를 슬라이드 전환 시 다시 세우기 위한 지역 열쇠. */
let keySeq = 0

function markDirty() {
  dirty.value = true
}

function emptyDocument() {
  return {
    version: 1,
    layout: { width: 1920, height: 1080, background: '#000000' },
    elements: [],
  }
}

/** 서버 문서가 비어 있거나 옛 형식일 수 있어 최소 형태를 보장한다. */
function normalizeDocument(document) {
  const base = document ?? {}
  return {
    version: 1,
    ...base,
    layout: { width: 1920, height: 1080, background: '#000000', ...(base.layout ?? {}) },
    elements: (base.elements ?? []).map((el) => ({
      opacity: 1,
      options: {},
      ...el,
      rect: { x: 0, y: 0, w: 400, h: 200, z: 1, rotation: 0, ...(el.rect ?? {}) },
    })),
  }
}

function applyPlaylist(playlist) {
  source.value = playlist
  title.value = playlist.title
  memo.value = playlist.memo ?? ''
  targetOrgTypes.value = [...(playlist.target_org_types ?? [])]
  noticeStart.value = playlist.notice_start ?? ''
  noticeEnd.value = playlist.notice_end ?? ''
  contact.value = playlist.contact ?? ''
  // 옛 모양(파일 참조·QR) 칸은 더 이상 편집하지 않는다 — 문서 칸만 싣는다.
  items.value = (playlist.items ?? [])
    .filter((item) => item.document)
    .map((item) => ({
      _key: ++keySeq,
      duration_sec: item.duration_sec,
      document: normalizeDocument(item.document),
    }))
  assets.value = playlist.assets ?? []
  if (selectedIndex.value >= items.value.length) {
    selectedIndex.value = Math.max(0, items.value.length - 1)
  }
}

onMounted(async () => {
  // 등록은 목록 화면의 메타 레이어가 한다 — 여기는 항상 수정이다.
  if (!route.params.id) {
    missing.value = true
    loading.value = false
    return
  }
  try {
    const [playlist, specs] = await Promise.all([
      api.get(`/community/playlists/${route.params.id}`),
      api.get('/widgets').catch(() => []),
    ])
    widgets.value = Array.isArray(specs) ? specs : []
    applyPlaylist(playlist)
    selectedIndex.value = 0
  } catch (err) {
    missing.value = true
    toast.error(err.detail ?? t('community.loadFailed'))
  } finally {
    loading.value = false
  }
})

/**
 * 캔버스의 이미지·동영상 출처 — 이 게시물에 올린 파일.
 * 목록은 올린 파일 중 그 종류만, 업로드는 게시물의 미디어 경로로 보낸다.
 */
const mediaSource = {
  list: async (kind) => assets.value.filter((asset) => asset.kind === kind),
  upload: async (file, onProgress) => {
    const form = new FormData()
    form.append('file', file)
    const asset = await api.upload(
      `/community/playlists/${source.value.id}/media`,
      form,
      undefined,
      { onProgress },
    )
    assets.value.push(asset)
    return asset
  },
}

const selected = computed(() => items.value[selectedIndex.value] ?? null)

// ------------------------------------------------------------ 오른쪽 목록
function addSlide() {
  items.value.push({ _key: ++keySeq, duration_sec: 10, document: emptyDocument() })
  selectedIndex.value = items.value.length - 1
  markDirty()
}

function removeSlide(index) {
  if (!confirm(t('orgNotice.confirmRemoveSlide', { n: index + 1 }))) return
  items.value.splice(index, 1)
  if (selectedIndex.value >= items.value.length) {
    selectedIndex.value = Math.max(0, items.value.length - 1)
  }
  markDirty()
}

/** 위/아래 이동. 고른 슬라이드가 움직이면 선택도 따라간다. */
function move(index, delta) {
  const target = index + delta
  if (target < 0 || target >= items.value.length) return
  const [row] = items.value.splice(index, 1)
  items.value.splice(target, 0, row)
  if (selectedIndex.value === index) selectedIndex.value = target
  else if (selectedIndex.value === target) selectedIndex.value = index
  markDirty()
}

function clampDuration(item, raw) {
  const number = Number(raw)
  item.duration_sec = Number.isFinite(number) ? Math.max(1, Math.min(86400, number)) : 10
  markDirty()
}

/** 전체 재생시간 — 서버 계산과 같은 규칙(칸 시간의 합)로 미리 보여 준다. */
const totalSec = computed(() =>
  items.value.reduce((sum, item) => sum + Math.max(1, Number(item.duration_sec) || 1), 0),
)

// ------------------------------------------------------------ 저장
async function save() {
  if (!title.value.trim()) {
    // 제목은 레이어에서 받는다 — 오류를 띄우는 대신 입력란을 열어 준다.
    metaOpen.value = true
    return
  }
  saving.value = true
  try {
    const updated = await api.put(`/community/playlists/${source.value.id}`, {
      title: title.value.trim(),
      memo: memo.value.trim(),
      target_org_types: targetOrgTypes.value,
      notice_start: noticeStart.value,
      notice_end: noticeEnd.value,
      contact: contact.value.trim(),
      items: items.value.map((item) => ({
        duration_sec: item.duration_sec,
        document: item.document,
      })),
    })
    const keep = selectedIndex.value
    applyPlaylist(updated)
    selectedIndex.value = Math.min(keep, Math.max(0, items.value.length - 1))
    dirty.value = false
    toast.success(t('community.playlistSaved'))
  } catch (err) {
    toast.error(err.detail ?? t('community.loadFailed'))
  } finally {
    saving.value = false
  }
}

// 순서를 다 짜 놓고 저장 없이 나가면 통째로 날아간다.
onBeforeRouteLeave(() => dirty.value === false || confirm(t('community.confirmLeave')))

function onNotice({ type, text }) {
  if (type === 'success') toast.success(text)
  else if (type === 'warn') toast.error(text)
  else toast.push(text, 'info')
}
</script>

<template>
  <p v-if="loading" class="muted pad">{{ t('common.loading') }}</p>
  <p v-else-if="missing" class="table-empty">{{ t('community.notFound') }}</p>

  <div v-else class="page">
    <!-- 머리글: 제목(읽기)·버튼 한 줄 + 메타 요약 한 줄. 입력은 전부 레이어에서. -->
    <header class="head card">
      <button
        class="title-display"
        type="button"
        data-test="editor-title-display"
        :title="t('community.metaOpen')"
        @click="metaOpen = true"
      >
        <span v-if="title.trim()">{{ title }}</span>
        <span v-else class="title-placeholder">{{ t('community.titleRequired') }}</span>
      </button>
      <div class="spacer" />

      <button class="btn" data-test="open-meta" @click="metaOpen = true">
        {{ t('community.metaOpen') }}
      </button>
      <button class="btn" :disabled="!selected" data-test="open-preview" @click="previewOpen = true">
        {{ t('preview.open') }}
      </button>
      <RouterLink to="/community/playlists" class="btn">{{ t('common.list') }}</RouterLink>
      <button class="btn btn-primary" :disabled="saving" data-test="editor-save" @click="save">
        {{ saving ? t('common.saving') : t('common.save') }}
      </button>

      <div class="hint meta-line">
        <template v-if="source">
          <span class="badge status-badge" :class="`status-${source.publish_status}`">
            {{ t(`community.status_${source.publish_status ?? '대기중'}`) }}
          </span>
          {{ t('orgNotice.itemCount', { count: items.length }) }} ·
          {{ t('community.totalDuration') }}
          <span data-test="editor-total">{{ t('community.durationSec', { sec: totalSec }) }}</span>
          · v{{ source.version }}
        </template>
        <!-- 레이어에서 입력한 메타의 요약 — 닫힌 뒤에도 무엇을 골랐는지 보인다. -->
        <span class="meta-summary" data-test="meta-summary">
          · {{ t('community.targetOrgTypes') }}:
          {{ targetOrgTypes.length ? formatNoticeTargets(targetOrgTypes) : t('community.targetAll') }}
          <template v-if="noticeStart || noticeEnd">
            · {{ t('community.noticePeriod') }}: {{ noticeStart || '' }} ~ {{ noticeEnd || '' }}
          </template>
        </span>
        <span v-if="dirty" class="badge badge-warning">{{ t('common.unsaved') }}</span>
      </div>
    </header>

    <CommunityMetaDialog
      v-if="metaOpen"
      :initial="{
        title,
        memo,
        target_org_types: targetOrgTypes,
        notice_start: noticeStart,
        notice_end: noticeEnd,
        contact,
      }"
      @confirm="applyMeta"
      @cancel="metaOpen = false"
    />

    <div class="split">
      <!-- 왼쪽: 고른 슬라이드의 콘텐츠 편집기 -->
      <div class="editor-side">
        <ContentCanvas
          v-if="selected"
          :key="selected._key"
          :document="selected.document"
          :widgets="widgets"
          :org-id="source.org_id"
          :media-source="mediaSource"
          class="canvas-fill"
          @change="markDirty"
          @notice="onNotice"
        />
        <div v-else class="card empty-editor">
          <p class="muted">{{ t('orgNotice.emptySlides') }}</p>
        </div>
      </div>

      <!-- 오른쪽: 슬라이드 목록 — 추가·순서 변경·유지 시간 -->
      <aside class="card playlist" data-test="slides-pane">
        <div class="playlist-head">
          <h3>{{ t('orgNotice.playlist') }}</h3>
          <button class="btn btn-sm btn-primary" data-test="add-slide" @click="addSlide">
            {{ t('orgNotice.addSlide') }}
          </button>
        </div>

        <p v-if="items.length === 0" class="muted pad">{{ t('orgNotice.emptySlides') }}</p>
        <ol v-else class="slides">
          <li
            v-for="(item, index) in items"
            :key="item._key"
            class="slide"
            :class="{ selected: index === selectedIndex }"
            data-test="slide-row"
            @click="selectedIndex = index"
          >
            <div class="slide-main">
              <div class="slide-title">
                {{ index + 1 }}. {{ t('orgNotice.slide') }}
                <span class="muted small">
                  {{ t('content.elementCount', { count: item.document.elements.length }) }}
                </span>
              </div>
              <label class="duration" @click.stop>
                <span class="muted small">{{ t('orgNotice.duration') }}</span>
                <input
                  class="input duration-input"
                  type="number"
                  min="1"
                  max="86400"
                  :value="item.duration_sec"
                  data-test="duration-input"
                  @change="clampDuration(item, $event.target.value)"
                />
              </label>
            </div>
            <div class="slide-actions" @click.stop>
              <button
                class="btn btn-sm"
                :disabled="index === 0"
                data-test="move-up"
                :title="t('common.moveUp')"
                @click="move(index, -1)"
              >
                ▲
              </button>
              <button
                class="btn btn-sm"
                :disabled="index === items.length - 1"
                data-test="move-down"
                :title="t('common.moveDown')"
                @click="move(index, 1)"
              >
                ▼
              </button>
              <button
                class="btn btn-sm btn-danger"
                data-test="remove-slide"
                @click="removeSlide(index)"
              >
                ✕
              </button>
            </div>
          </li>
        </ol>
      </aside>
    </div>

    <ContentPreview
      v-if="previewOpen && selected"
      :document="selected.document"
      :widgets="widgets"
      @close="previewOpen = false"
    />
  </div>
</template>

<style scoped>
/* 소속기관 공지 편집기와 같은 골격(main.css 의 --topbar-height / --content-pad). */
.page {
  display: flex;
  flex-direction: column;
  gap: 13px;
  height: calc(100vh - var(--topbar-height) - var(--content-pad) * 2);
  min-height: 480px;
}

.head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

/* 제목 표시 — 입력은 레이어가 받는다. 누르면 레이어가 열린다. */
.title-display {
  max-width: 40%;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--text);
  font-family: inherit;
  font-size: 16px;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.title-display:hover {
  background: var(--surface-2);
}

.title-placeholder {
  color: var(--text-muted);
  font-weight: 400;
}

.spacer {
  flex: 1;
}

/* 메타는 줄바꿈으로 아랫줄 전체 — 윗줄 입력란·버튼의 세로선이 맞는다. */
.meta-line {
  flex-basis: 100%;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.meta-summary {
  color: var(--text-muted);
}

/* ---------------------------------------------- 좌(편집기) / 우(슬라이드) */
.split {
  display: flex;
  gap: 13px;
  flex: 1;
  min-height: 0;
}

.editor-side {
  flex: 1;
  min-width: 0;
  display: flex;
}

.canvas-fill {
  flex: 1;
  min-height: 0;
}

.empty-editor {
  flex: 1;
  display: grid;
  place-items: center;
}

.playlist {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.playlist-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 13px;
  border-bottom: 1px solid var(--border);
}

.playlist-head h3 {
  margin: 0;
  font-size: 13px;
}

.slides {
  list-style: none;
  margin: 0;
  padding: 8px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slide {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}

.slide:hover {
  background: var(--surface-2);
}

.slide.selected {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.slide-main {
  flex: 1;
  min-width: 0;
}

.slide-title {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.small {
  font-size: 11px;
  font-weight: 400;
}

.duration {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
}

.duration-input {
  width: 74px;
  padding: 3px 7px;
  font-size: 12px;
}

.slide-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.pad {
  padding: 12px;
}
</style>
