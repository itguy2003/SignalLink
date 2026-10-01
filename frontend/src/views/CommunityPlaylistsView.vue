<script setup>
/**
 * 커뮤니티 재생목록 — 외부 사용자가 게시를 원하는 것을 등록하는 자리.
 *
 * 이 화면은 목록만 맡는다. 등록·수정은 CMS 재생목록 관리와 같은 짜임의
 * 편집기 화면(CommunityPlaylistEditorView)에서 한다 — 파일을 올리고 순서를
 * 다듬는 일을 좁은 모달에서 함께 하기는 어렵다.
 *
 *   - 재생목록 = 제목 + 설명 + 게시자 + 연락처 + 게시 여부 + 미디어 칸들.
 *   - 게시 여부(대기중·게시·게시보류)는 커뮤니티 소유 기관의 관리자가
 *     정한다 — '게시' 상태만 콘텐츠(커뮤니티 위젯)가 표출한다.
 *   - 게시 정책(auto_publish)이 켜지면 등록 즉시 게시된다(관리자 토글).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { api } from '@/api/client'
import CommunityMetaDialog from '@/components/CommunityMetaDialog.vue'
import ContentPreview from '@/components/ContentPreview.vue'
import { useCommunityScope } from '@/composables/useCommunityScope'
import { useToastStore } from '@/stores/toast'
import { formatNoticeTargets } from '@/utils/communityTargets'

const toast = useToastStore()
const router = useRouter()
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
  // 게시 정책(승인 후/즉시 게시) — 관리자 토글의 근거.
  settings.value = await api
    .get('/community/settings', { org_id: orgId.value })
    .catch(() => ({ auto_publish: false, can_manage: false }))
}

/** 게시 정책. auto_publish 가 켜지면 등록 즉시 '게시'다. */
const settings = ref({ auto_publish: false, can_manage: false })

async function setAutoPublish(checked) {
  try {
    settings.value = await api.put(
      '/community/settings',
      { auto_publish: checked },
      { org_id: orgId.value },
    )
    toast.success(t('community.policySaved'))
  } catch (err) {
    toast.error(err.detail ?? t('community.loadFailed'))
    await load(playlists.value.page)
  }
}

/**
 * 미리보기 — 게시물의 슬라이드(콘텐츠 문서)를 ContentPreview 로 한 장씩
 * 넘겨 본다. 어떤 장을 보여 줄지는 여기서 쥔다(ContentPreview 의 page 이벤트).
 */
const preview = ref({ playlist: null, index: 0 })

function openPreview(playlist) {
  preview.value = { playlist, index: 0 }
}

function stepPreview(delta) {
  const total = preview.value.playlist?.items.length ?? 0
  preview.value.index = Math.max(0, Math.min(total - 1, preview.value.index + delta))
}

/**
 * 게시요청 등록 — [게시요청 등록] 버튼이 메타 레이어를 띄우고,
 * 확인하면 등록한 뒤 편집 화면으로 넘어간다. 취소하면 아무 일도 없다.
 */
const createOpen = ref(false)

async function createPlaylist(meta) {
  try {
    const created = await api.post('/community/playlists', meta, { org_id: orgId.value })
    createOpen.value = false
    toast.success(
      created.publish_status === '게시'
        ? t('community.registeredPublished')
        : t('community.registered'),
    )
    // 파일을 올리고 순서를 다듬는 일은 편집 화면의 몫이다.
    await router.push(`/community/playlists/${created.id}/edit`)
  } catch (err) {
    toast.error(err.detail ?? t('community.loadFailed'))
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

/** 게시 결과 — 커뮤니티 소유 기관의 관리자만. 서버가 can_publish 로 답한다. */
async function setStatus(playlist, status) {
  try {
    await api.put(`/community/playlists/${playlist.id}/status`, { status })
    toast.success(t('community.statusSaved'))
    await load(playlists.value.page)
  } catch (err) {
    toast.error(err.detail ?? t('community.loadFailed'))
    await load(playlists.value.page)
  }
}

const totalPages = computed(() =>
  Math.max(1, Math.ceil(playlists.value.total / playlists.value.size)),
)

function formatDate(value) {
  if (!value) return ''
  return new Date(value).toLocaleDateString(locale.value)
}

function formatDuration(sec) {
  const total = Number(sec) || 0
  if (total < 60) return t('community.durationSec', { sec: total })
  return t('community.durationMinSec', { min: Math.floor(total / 60), sec: total % 60 })
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
        @click="createOpen = true"
      >
        {{ t('community.newPlaylist') }}
      </button>
    </header>

    <!-- 등록 레이어 — 확인하면 등록하고 편집 화면으로, 취소하면 목록 그대로. -->
    <CommunityMetaDialog
      v-if="createOpen"
      @confirm="createPlaylist"
      @cancel="createOpen = false"
    />

    <!-- 미리보기 — 슬라이드를 한 장씩 넘겨 본다. -->
    <ContentPreview
      v-if="preview.playlist"
      :document="preview.playlist.items[preview.index].document"
      :page-index="preview.index"
      :page-total="preview.playlist.items.length"
      @page="stepPreview"
      @close="preview = { playlist: null, index: 0 }"
    />
    <p v-if="context" class="page-desc">{{ t('community.playlistsDesc') }}</p>

    <!-- 게시 정책 — 관리자만 바꾼다. 켜면 승인 없이 등록 즉시 게시된다. -->
    <label v-if="settings.can_manage" class="policy">
      <input
        type="checkbox"
        :checked="settings.auto_publish"
        data-test="auto-publish"
        @change="setAutoPublish($event.target.checked)"
      />
      <span>{{ t('community.autoPublish') }}</span>
      <span class="muted small">{{ t('community.autoPublishDesc') }}</span>
    </label>

    <p v-if="loading" class="muted">{{ t('common.loading') }}</p>
    <p v-else-if="playlists.items.length === 0" class="muted">
      {{ t('community.playlistsEmpty') }}
    </p>

    <table v-else class="table playlist-table">
      <colgroup>
        <col />
        <col class="w-strip" />
        <col class="w-author" />
        <col class="w-status" />
        <col class="w-date" />
        <col class="w-actions" />
      </colgroup>
      <thead>
        <tr>
          <th>{{ t('community.playlistTitle') }}</th>
          <th>{{ t('community.playPreview') }}</th>
          <th>{{ t('community.author') }}</th>
          <th>{{ t('community.status') }}</th>
          <th>{{ t('community.createdAt') }}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="playlist in playlists.items" :key="playlist.id" data-test="playlist-row">
          <td>
            <div class="name">{{ playlist.title }}</div>
            <div v-if="playlist.memo" class="muted small desc" :title="playlist.memo">
              {{ playlist.memo }}
            </div>
            <!-- 공지대상(기관구분)과 공지희망기간 — 팝업 판정의 근거. -->
            <div class="muted small" data-test="notice-meta">
              {{ t('community.targetOrgTypes') }}:
              {{
                (playlist.target_org_types ?? []).length
                  ? formatNoticeTargets(playlist.target_org_types)
                  : t('community.targetAll')
              }}
              <template v-if="playlist.notice_start || playlist.notice_end">
                · {{ t('community.noticePeriod') }}: {{ playlist.notice_start ?? '' }} ~
                {{ playlist.notice_end ?? '' }}
              </template>
            </div>
            <div class="muted small">
              {{ t('community.playlistItems', { count: playlist.items.length }) }} ·
              <span data-test="total-duration">{{
                formatDuration(playlist.total_duration_sec)
              }}</span>
            </div>
          </td>
          <td class="strip-cell">
            <!-- 칸은 콘텐츠 문서다 — 썸네일 대신 미리보기 창에서 장을 넘겨 본다. -->
            <button
              class="btn btn-sm"
              :disabled="playlist.items.length === 0"
              data-test="preview-playlist"
              @click="openPreview(playlist)"
            >
              {{ t('preview.open') }}
            </button>
          </td>
          <td class="muted">
            <div>{{ playlist.author_name ?? '-' }}</div>
            <div v-if="playlist.contact" class="small contact" data-test="contact">
              {{ playlist.contact }}
            </div>
          </td>
          <td>
            <!-- 게시 결과. 관리자는 고르고, 나머지는 보기만 한다. -->
            <select
              v-if="playlist.can_publish"
              class="select status-select"
              :class="`status-${playlist.publish_status}`"
              :value="playlist.publish_status"
              data-test="status-select"
              @change="setStatus(playlist, $event.target.value)"
            >
              <option v-for="value in ['대기중', '게시', '게시보류']" :key="value" :value="value">
                {{ t(`community.status_${value}`) }}
              </option>
            </select>
            <span
              v-else
              class="badge status-badge"
              :class="`status-${playlist.publish_status}`"
              data-test="status-badge"
            >
              {{ t(`community.status_${playlist.publish_status ?? '대기중'}`) }}
            </span>
          </td>
          <td class="muted">{{ formatDate(playlist.created_at) }}</td>
          <td class="actions">
            <RouterLink
              v-if="playlist.can_edit"
              :to="`/community/playlists/${playlist.id}/edit`"
              class="btn btn-sm"
              data-test="edit-playlist"
            >
              {{ t('common.edit') }}
            </RouterLink>
            <button
              v-if="playlist.can_remove"
              class="btn btn-sm"
              data-test="remove-playlist"
              @click="remove(playlist)"
            >
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
  </section>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

/* 원시 h1 은 브라우저 기본(2em)이라 다른 페이지 제목보다 훌쩍 크다. */
.page-head h1 {
  margin: 0;
  font-size: 20px;
}

.spacer {
  flex: 1;
}

.small {
  font-size: 11px;
}

.policy {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 10px;
  font-size: 12px;
}

.playlist-table {
  table-layout: fixed;
}

.w-strip {
  width: 300px;
}

.w-author {
  width: 110px;
}

.w-status {
  width: 120px;
}

.w-date {
  width: 110px;
}

.w-actions {
  width: 130px;
}

.name {
  font-weight: 600;
}

.desc {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.contact {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.actions {
  text-align: right;
  white-space: nowrap;
}

.status-select {
  width: auto;
}

.pager {
  display: flex;
  gap: 4px;
  margin-top: 10px;
}

/* 게시 상태 색 — 종전 규약 그대로. */
.status-게시 {
  color: #34d399;
}

.status-게시보류 {
  color: #f87171;
}

/* 기관(커뮤니티) 고르기 — 전역 .select 의 width:100% 가 머리줄을 통째로
   차지하지 않게, 내용만큼만 차지하고 상한을 둔다. */
.page-head .select {
  width: auto;
  max-width: 220px;
}
</style>
