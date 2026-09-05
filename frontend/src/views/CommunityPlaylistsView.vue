<script setup>
/**
 * 커뮤니티 — 공유 재생목록.
 *
 * 이 커뮤니티의 공유 이미지·동영상을 순서와 시간으로 엮는다. 재료가
 * 공유물뿐인 것은 커뮤니티 울타리다 — 서버도 저장 때 같은 것을 검사한다.
 *
 * 편집 창은 두 칸이다: 왼쪽에서 공유물을 고르고(이미지/동영상 탭),
 * 오른쪽에서 담긴 칸의 시간·전환을 다듬는다. 담은 순서가 재생 순서.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import ModalDialog from '@/components/ModalDialog.vue'
import { useCommunityScope } from '@/composables/useCommunityScope'
import { useToastStore } from '@/stores/toast'
import {
  DEFAULT_TRANSITION_MS,
  MAX_TRANSITION_MS,
  MIN_TRANSITION_MS,
  TRANSITION_GROUPS,
} from '@/utils/transitions'

const toast = useToastStore()
const { t, locale } = useI18n()

const { communities, orgId, context, canPick, init } = useCommunityScope()
const playlists = ref({ items: [], total: 0, page: 1, size: 20 })
const loading = ref(true)

onMounted(async () => {
  try {
    await init()
  } catch (err) {
    toast.error(err.detail ?? t('community.loadFailed'))
  } finally {
    loading.value = false
  }
})

watch(orgId, async () => {
  if (context.value) await load()
})

async function load(page = 1) {
  playlists.value = await api.get('/community/playlists', { org_id: orgId.value, page, size: 20 })
}

// ------------------------------------------------------------------ 편집 창

/** null 이면 닫힘. { id: null } 이면 새로 만들기. */
const editing = ref(null)
const saving = ref(false)

/** 왼쪽 재료 칸. 갈래별로 받아 둔다. */
const materialKind = ref('image')
const materials = reactive({ image: [], video: [] })

async function loadMaterials() {
  for (const kind of ['image', 'video']) {
    const page = await api.get('/community/media', {
      kind,
      org_id: orgId.value,
      page: 1,
      size: 100,
    })
    // 게시판 글에 붙인 파일이 곧 공유 재료다. 서버가 낱개로 편 채 준다.
    materials[kind] = page.items
  }
}

async function openEditor(playlist = null) {
  editing.value = {
    id: playlist?.id ?? null,
    name: playlist?.name ?? '',
    // 화면 편집용 사본. asset_id 로 저장하고, url/title 은 그리기용.
    items: (playlist?.items ?? []).map((item) => ({ ...item })),
  }
  try {
    await loadMaterials()
  } catch (err) {
    toast.error(err.detail ?? t('community.loadFailed'))
  }
}

function addItem(row) {
  editing.value.items.push({
    kind: row.asset.kind,
    asset_id: row.asset.id,
    duration_sec: row.asset.kind === 'video' ? 30 : 8,
    transition: 'none',
    transition_ms: DEFAULT_TRANSITION_MS,
    title: row.title || row.asset.filename,
    url: row.asset.url,
  })
}

function move(index, delta) {
  const items = editing.value.items
  const next = index + delta
  if (next < 0 || next >= items.length) return
  ;[items[index], items[next]] = [items[next], items[index]]
}

function removeItem(index) {
  editing.value.items.splice(index, 1)
}

async function save() {
  const draft = editing.value
  if (!draft.name.trim()) {
    toast.error(t('community.playlistNameRequired'))
    return
  }
  if (draft.items.length === 0) {
    toast.error(t('community.playlistItemsRequired'))
    return
  }
  const payload = {
    name: draft.name.trim(),
    items: draft.items.map((item) => ({
      kind: item.kind,
      asset_id: item.asset_id,
      duration_sec: Math.max(1, Number(item.duration_sec) || 1),
      transition: item.transition ?? 'none',
      transition_ms: item.transition_ms ?? DEFAULT_TRANSITION_MS,
    })),
  }
  saving.value = true
  try {
    if (draft.id === null) {
      await api.post('/community/playlists', payload, { org_id: orgId.value })
    } else {
      await api.put(`/community/playlists/${draft.id}`, payload)
    }
    toast.success(t('community.playlistSaved'))
    editing.value = null
    await load(playlists.value.page)
  } catch (err) {
    toast.error(err.detail ?? t('community.loadFailed'))
  } finally {
    saving.value = false
  }
}

async function remove(playlist) {
  if (!window.confirm(t('community.confirmRemovePlaylist'))) return
  try {
    await api.delete(`/community/playlists/${playlist.id}`)
    await load(playlists.value.page)
  } catch (err) {
    toast.error(err.detail ?? t('community.loadFailed'))
  }
}

const totalPages = computed(() =>
  Math.max(1, Math.ceil(playlists.value.total / playlists.value.size)),
)

function formatDate(value) {
  if (!value) return ''
  return new Date(value).toLocaleDateString(locale.value)
}

function transitionLabel(kind) {
  return t(`transition.${(kind ?? 'none').replaceAll('-', '_')}`)
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <h1>{{ t('community.playlistsTitle') }}</h1>
      <span class="muted">{{ t('community.playlistCount', { count: playlists.total }) }}</span>
      <select v-if="canPick" v-model="orgId" class="select" data-test="community-picker">
        <option v-for="c in communities" :key="c.org_id" :value="c.org_id">{{ c.org_name }}</option>
      </select>
      <div class="spacer" />
      <button
        v-if="context?.can_share"
        class="btn btn-primary"
        data-test="new-playlist"
        @click="openEditor()"
      >
        {{ t('community.newPlaylist') }}
      </button>
    </header>

    <p v-if="loading" class="muted">{{ t('common.loading') }}</p>
    <p v-else-if="playlists.items.length === 0" class="muted">
      {{ t('community.playlistsEmpty') }}
    </p>

    <table v-else class="table playlist-table">
      <colgroup>
        <col />
        <col class="w-strip" />
        <col class="w-author" />
        <col class="w-date" />
        <col class="w-actions" />
      </colgroup>
      <thead>
        <tr>
          <th>{{ t('community.playlistName') }}</th>
          <th>{{ t('community.playPreview') }}</th>
          <th>{{ t('community.author') }}</th>
          <th>{{ t('community.createdAt') }}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="playlist in playlists.items" :key="playlist.id">
          <td>
            <div class="name">{{ playlist.name }}</div>
            <div class="muted small">
              {{ t('community.playlistItems', { count: playlist.items.length }) }} ·
              v{{ playlist.version }}
            </div>
          </td>
          <td class="strip-cell">
            <!-- 칸 미리보기 줄 — 무엇이 어떤 순서로 도는지 한눈에. -->
            <div class="strip">
              <span
                v-for="(item, index) in playlist.items.slice(0, 8)"
                :key="index"
                class="cell"
                :title="item.title"
              >
                <img v-if="item.kind === 'image'" :src="item.url" alt="" loading="lazy" />
                <span v-else class="mark">🎬</span>
              </span>
              <span v-if="playlist.items.length > 8" class="muted small">
                +{{ playlist.items.length - 8 }}
              </span>
            </div>
          </td>
          <td class="muted">{{ playlist.author_name }}</td>
          <td class="muted">{{ formatDate(playlist.created_at) }}</td>
          <td class="actions">
            <button
              v-if="playlist.can_remove"
              class="btn btn-sm"
              @click="openEditor(playlist)"
            >
              {{ t('common.edit') }}
            </button>
            <button v-if="playlist.can_remove" class="btn btn-sm" @click="remove(playlist)">
              {{ t('common.delete') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <nav v-if="totalPages > 1" class="pager">
      <button
        v-for="p in totalPages"
        :key="p"
        class="btn btn-sm"
        :class="{ 'btn-primary': p === playlists.page }"
        @click="load(p)"
      >
        {{ p }}
      </button>
    </nav>

    <ModalDialog
      v-if="editing"
      :title="editing.id === null ? t('community.newPlaylist') : t('community.editPlaylist')"
      width="1120px"
      height="82vh"
      :busy="saving"
      @close="editing = null"
      @confirm="save"
    >
      <label class="field">
        <span class="muted">{{ t('community.playlistName') }}</span>
        <input v-model="editing.name" class="input" data-test="playlist-name" />
      </label>

      <div class="composer">
        <!-- 왼쪽: 이 커뮤니티의 공유물. -->
        <div class="pane">
          <div class="tabs">
            <button
              v-for="kind in ['image', 'video']"
              :key="kind"
              class="tab"
              :class="{ active: materialKind === kind }"
              @click="materialKind = kind"
            >
              {{ t(kind === 'image' ? 'nav.communityImages' : 'nav.communityVideos') }}
            </button>
          </div>
          <div class="grid">
            <button
              v-for="row in materials[materialKind]"
              :key="row.id"
              class="material"
              :title="row.title"
              data-test="material"
              @click="addItem(row)"
            >
              <img v-if="row.asset.kind === 'image'" :src="row.asset.url" alt="" loading="lazy" />
              <span v-else class="mark">🎬</span>
              <span class="label">{{ row.title }}</span>
            </button>
            <p v-if="materials[materialKind].length === 0" class="muted small">
              {{ t('community.empty') }}
            </p>
          </div>
        </div>

        <!-- 오른쪽: 담긴 칸. 순서 = 재생 순서. -->
        <div class="pane">
          <p class="muted small">{{ t('community.playlistHint') }}</p>
          <ol class="slides">
            <li v-for="(item, index) in editing.items" :key="index" class="slide" data-test="slide">
              <span class="cell">
                <img v-if="item.kind === 'image'" :src="item.url" alt="" />
                <span v-else class="mark">🎬</span>
              </span>
              <div class="slide-body">
                <div class="slide-title">{{ item.title }}</div>
                <div class="controls">
                  <label>
                    {{ t('album.holdSec') }}
                    <input
                      v-model.number="item.duration_sec"
                      class="input num"
                      type="number"
                      min="1"
                    />
                  </label>
                  <label>
                    {{ t('transition.label') }}
                    <select v-model="item.transition" class="select">
                      <optgroup
                        v-for="group in TRANSITION_GROUPS"
                        :key="group.key"
                        :label="t(`transition.group.${group.key}`)"
                      >
                        <option v-for="kind in group.kinds" :key="kind" :value="kind">
                          {{ transitionLabel(kind) }}
                        </option>
                      </optgroup>
                    </select>
                  </label>
                  <label v-if="item.transition && item.transition !== 'none'">
                    {{ t('transition.ms') }}
                    <input
                      v-model.number="item.transition_ms"
                      class="input num wide"
                      type="number"
                      :min="MIN_TRANSITION_MS"
                      :max="MAX_TRANSITION_MS"
                      step="100"
                    />
                  </label>
                </div>
              </div>
              <div class="slide-actions">
                <button class="btn btn-sm" :disabled="index === 0" @click="move(index, -1)">↑</button>
                <button
                  class="btn btn-sm"
                  :disabled="index === editing.items.length - 1"
                  @click="move(index, 1)"
                >
                  ↓
                </button>
                <button class="btn btn-sm" @click="removeItem(index)">✕</button>
              </div>
            </li>
          </ol>
          <p v-if="editing.items.length === 0" class="muted small">
            {{ t('community.playlistItemsRequired') }}
          </p>
        </div>
      </div>
    </ModalDialog>
  </section>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

/* 원시 h1 은 브라우저 기본(2em)이라 다른 페이지 제목보다 훌쩍 크다.
   폭은 내용만큼만 갖는다 — flex 안에서 줄어들거나 남는 폭을 먹지 않게
   못 박아야 옆의 개수·버튼이 제자리에 선다. */
.page-head h1 {
  margin: 0;
  font-size: 20px;
  flex: none;
  width: max-content;
  white-space: nowrap;
}

/* 개수 표시도 내용 폭만큼만. */
.page-head > .muted {
  flex: none;
  white-space: nowrap;
}
.spacer {
  flex: 1;
}

.small {
  font-size: 11px;
}

.playlist-table {
  table-layout: fixed;
}

.w-strip {
  width: 420px;
}

.w-author {
  width: 130px;
}

.w-date {
  width: 130px;
}

.w-actions {
  width: 130px;
}

.name {
  font-weight: 600;
}

.strip {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cell {
  width: 44px;
  height: 28px;
  flex: none;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 4px;
  background: rgb(148 163 184 / 20%);
}

.cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mark {
  font-size: 13px;
}

.actions {
  text-align: right;
  white-space: nowrap;
}

.pager {
  display: flex;
  gap: 4px;
  margin-top: 10px;
}

/* 전역 .field 는 세로 쌓기다 — 여기서는 라벨과 입력을 한 줄에 세운다. */
.field {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.field .input {
  flex: 1;
}

.composer {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 14px;
  min-height: 320px;
}

.pane {
  border: 1px solid rgb(148 163 184 / 30%);
  border-radius: 8px;
  padding: 10px;
  overflow: auto;
  max-height: 64vh;
}

.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}

.tab {
  border: none;
  background: none;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 6px;
  color: inherit;
}

.tab.active {
  background: rgb(59 130 246 / 15%);
  font-weight: 600;
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.material {
  border: 1px solid rgb(148 163 184 / 30%);
  border-radius: 6px;
  background: none;
  color: inherit;
  padding: 4px;
  cursor: pointer;
  display: grid;
  gap: 4px;
  justify-items: center;
}

.material img {
  width: 100%;
  height: 56px;
  object-fit: cover;
  border-radius: 4px;
}

.material .label {
  font-size: 11px;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.slides {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}

.slide {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid rgb(148 163 184 / 30%);
  border-radius: 6px;
  padding: 8px 12px;
}

.slide .cell {
  width: 64px;
  height: 40px;
}

/* 제목과 조절 줄을 하나의 덩어리로 세로 가운데에 세운다. */
.slide-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
}

.slide-title {
  font-size: 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.controls {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  flex-wrap: wrap;
}

/* 전역 .select 는 width:100% 라 줄 전체를 밀어내고 오른쪽 단추와 겹친다 —
   여기서는 내용 폭만큼만. */
.controls .select {
  width: auto;
  max-width: 170px;
  padding: 4px 8px;
}

/* '전환' 같은 라벨이 입력 위로 꺾여 올라가지 않게 — 라벨과 입력은 한 덩어리다. */
.controls label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.controls .num {
  width: 56px;
}

.controls .num.wide {
  width: 72px;
}

/* 상하 이동·삭제. 가로 한 줄, 세로 가운데. 왼쪽 내용이 아무리 길어도
   이 단추들은 줄어들지도, 테두리에 겹치지도 않는다. */
.slide-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
  margin-left: auto;
  padding-left: 8px;
}
</style>
