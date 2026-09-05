<script setup>
/**
 * 커뮤니티 — 공유 게시판.
 *
 * 상위기관 단위의 공유 공간이다. 어느 커뮤니티를 보는지는 서버가 소속
 * 기관에서 정한다(학교 구성원은 교육청 커뮤니티를 본다). 글은 커뮤니티
 * 유저와 관리자가 올리고, 같은 커뮤니티 사람은 누구나 읽는다.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import ModalDialog from '@/components/ModalDialog.vue'
import ProgressBar from '@/components/ProgressBar.vue'
import { useCommunityScope } from '@/composables/useCommunityScope'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()
const { t, locale } = useI18n()

/** 지금 보는 커뮤니티. 슈퍼관리자는 목록에서 고른다. */
const { communities, orgId, context, canPick, init } = useCommunityScope()
const posts = ref({ items: [], total: 0, page: 1, size: 20 })
const loading = ref(true)

/** 글쓰기 창. */
const writing = ref(false)
const draft = ref(null)
const saving = ref(false)
const formError = ref('')
/** 첨부를 올리는 중의 진행률. `{ done, total, name, ratio }` */
const uploadProgress = ref(null)

onMounted(async () => {
  try {
    // 목록은 orgId 감시가 받아 온다 — init 이 값을 넣는 순간 한 번 돈다.
    // 여기서 또 부르면 같은 목록을 두 번 받는다.
    await init()
  } catch (err) {
    toast.error(err.detail ?? t('community.loadFailed'))
  } finally {
    loading.value = false
  }
})

// 다른 커뮤니티를 고르면 그 커뮤니티의 글로 갈아 끼운다.
watch(orgId, async () => {
  if (context.value) await load()
})

async function load(page = 1) {
  posts.value = await api.get('/community/posts', { org_id: orgId.value, page, size: 20 })
}

function openWriter() {
  draft.value = { title: '', content: '', files: [] }
  formError.value = ''
  writing.value = true
}

function pickFiles(event) {
  draft.value.files = [...draft.value.files, ...Array.from(event.target.files ?? [])]
  // 같은 파일을 다시 고를 수 있어야 한다(잘못 넣어 뺀 뒤 재시도).
  event.target.value = ''
}

function dropFile(at) {
  draft.value.files = draft.value.files.filter((_, index) => index !== at)
}

/**
 * 글을 만들고 파일을 잇는다. 첨부는 글에 붙는 것이라 붙일 글이 먼저다.
 * 중간에 파일 하나가 막혀도 글과 나머지는 살린다 — 사진 한 장 때문에 쓴
 * 글을 통째로 잃으면 안 된다.
 */
async function submit() {
  const form = draft.value
  if (!form.title.trim()) {
    formError.value = t('community.titleRequired')
    return
  }

  saving.value = true
  formError.value = ''
  try {
    const post = await api.post(
      '/community/posts',
      { title: form.title.trim(), content: form.content.trim() || null },
      { org_id: orgId.value },
    )

    let failed = 0
    if (form.files.length) {
      uploadProgress.value = { done: 0, total: form.files.length, name: '', ratio: 0 }
      for (const file of form.files) {
        uploadProgress.value = { ...uploadProgress.value, name: file.name, ratio: 0 }
        try {
          const body = new FormData()
          body.append('file', file)
          await api.upload(`/community/posts/${post.id}/attachments`, body, undefined, {
            onProgress: (ratio) => {
              if (uploadProgress.value) uploadProgress.value.ratio = ratio
            },
          })
        } catch {
          failed += 1
        }
        uploadProgress.value = { ...uploadProgress.value, done: uploadProgress.value.done + 1 }
      }
    }

    writing.value = false
    toast.success(
      failed ? t('community.savedWithFailures', { count: failed }) : t('community.saved'),
    )
    await load()
  } catch (err) {
    formError.value = err.detail ?? t('community.saveFailed')
  } finally {
    saving.value = false
    uploadProgress.value = null
  }
}

/** 읽기 창에 띄운 글. null 이면 닫힘. */
const reading = ref(null)

function openReader(post) {
  reading.value = post
}

/**
 * 게시 결과를 바꾼다 — 커뮤니티 소유 기관의 관리자만(서버의 can_publish).
 * 작성자는 손대지 못한다. 올리는 사람과 게시를 승인하는 사람을 가른다.
 * 읽기 창에서 바꾸고, 목록의 같은 글에도 바로 반영된다(같은 객체다).
 */
async function setStatus(post, value) {
  try {
    const updated = await api.put(`/community/posts/${post.id}/status`, { status: value })
    post.publish_status = updated.publish_status
  } catch (err) {
    toast.error(err.detail ?? t('community.saveFailed'))
  }
}

async function removePost(post) {
  if (!confirm(t('community.confirmRemovePost'))) return
  try {
    await api.delete(`/community/posts/${post.id}`)
    if (reading.value?.id === post.id) reading.value = null
    await load()
  } catch (err) {
    toast.error(err.detail ?? t('community.removeFailed'))
  }
}

const uploadRatio = computed(() => {
  const at = uploadProgress.value
  if (!at) return null
  return (at.done + (at.ratio ?? 0)) / at.total
})

function formatDate(value) {
  return value
    ? new Date(value).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
    : '-'
}
</script>

<template>
  <div>
    <h1 class="page-title">{{ t('community.boardTitle') }}</h1>
    <p v-if="context" class="page-desc">
      {{ t('community.scope', { org: context.org_name }) }}
    </p>

    <!-- 슈퍼관리자만 여러 개가 온다. 하나뿐이면 고를 것이 없다. -->
    <div v-if="canPick" class="field community-picker">
      <label>{{ t('community.pick') }}</label>
      <select v-model.number="orgId" class="select">
        <option v-for="c in communities" :key="c.org_id" :value="c.org_id">
          {{ c.org_name }}
        </option>
      </select>
    </div>

    <div v-if="loading" class="muted">{{ t('common.loading') }}</div>

    <section v-else-if="context" class="card">
      <div class="card-header">
        <h2>{{ t('community.postCount', { count: posts.total }) }}</h2>
        <button v-if="context.can_share" class="btn btn-primary btn-sm" @click="openWriter">
          {{ t('community.write') }}
        </button>
      </div>

      <!-- 게시판다운 표 목록. 내용은 줄을 눌러 읽기 창에서 본다. -->
      <table v-if="posts.items.length" class="table board-table">
        <!-- 열 폭은 여기 한 곳에서 정한다. 머리글(th)과 자료(td)가 같은
             <col> 을 쓰므로 두 줄의 폭이 어긋나지 않는다. -->
        <colgroup>
          <col />
          <col class="w-status" />
          <col class="w-author" />
          <col class="w-date" />
        </colgroup>
        <thead>
          <tr>
            <th>{{ t('community.postTitle') }}</th>
            <th class="col-status">{{ t('community.status') }}</th>
            <th class="col-author">{{ t('community.author') }}</th>
            <th class="col-date">{{ t('community.createdAt') }}</th>
          </tr>
        </thead>
        <tbody>
          <!-- 이름을 board-row 로 — 전역 유틸리티 .row(display: flex)가
               tr 에 걸리면 자료 행만 표 레이아웃에서 이탈한다. -->
          <tr
            v-for="post in posts.items"
            :key="post.id"
            class="board-row"
            data-test="post-row"
            @click="openReader(post)"
          >
            <td class="cell-title">
              <span class="post-title">{{ post.title }}</span>
              <!-- 첨부가 있다는 표시. 열어 봐야 아는 것보다 낫다. -->
              <span v-if="post.attachments.length" class="muted attach-count">
                📎{{ post.attachments.length }}
              </span>
            </td>
            <td class="col-status">
              <span
                class="badge status-badge"
                :class="`status-${post.publish_status}`"
                data-test="status-badge"
              >
                {{ t(`community.status_${post.publish_status ?? '대기중'}`) }}
              </span>
            </td>
            <td class="muted col-author">{{ post.author_name ?? '-' }}</td>
            <td class="muted col-date">{{ formatDate(post.created_at) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="table-empty">{{ t('community.postsEmpty') }}</p>
    </section>

    <!-- 커뮤니티가 없다(소속 기관 위로 상위기관이 없다). 드물지만 말은 해 줘야 한다. -->
    <p v-else class="table-empty">{{ t('community.none') }}</p>

    <!-- 읽기 창. 관리자는 여기서 게시 결과를 정한다. -->
    <ModalDialog
      v-if="reading"
      :title="reading.title"
      width="920px"
      height="80vh"
      hide-footer
      @close="reading = null"
    >
      <div class="reader-meta">
        <span class="muted">
          {{ reading.author_name ?? '-' }} · {{ formatDate(reading.created_at) }}
        </span>
        <span class="spacer" />

        <!-- 게시 결과. 관리자는 고르고, 나머지는 보기만 한다. -->
        <label v-if="reading.can_publish" class="status-field">
          <span class="muted">{{ t('community.status') }}</span>
          <select
            class="select status-select"
            :class="`status-${reading.publish_status}`"
            :value="reading.publish_status"
            data-test="status-select"
            @change="setStatus(reading, $event.target.value)"
          >
            <option v-for="value in ['대기중', '게시', '게시보류']" :key="value" :value="value">
              {{ t(`community.status_${value}`) }}
            </option>
          </select>
        </label>
        <span
          v-else
          class="badge status-badge"
          :class="`status-${reading.publish_status}`"
          data-test="reader-status"
        >
          {{ t(`community.status_${reading.publish_status ?? '대기중'}`) }}
        </span>

        <button
          v-if="reading.can_remove"
          class="btn btn-sm"
          @click="removePost(reading)"
        >
          {{ t('common.delete') }}
        </button>
      </div>

      <p v-if="reading.content" class="reader-body" data-test="reader-body">
        {{ reading.content }}
      </p>

      <!-- 붙인 사진·영상은 읽기에서 바로 본다. -->
      <div v-if="reading.attachments.length" class="reader-files">
        <template v-for="file in reading.attachments" :key="file.id">
          <img
            v-if="file.kind === 'image'"
            class="reader-media"
            :src="file.url"
            :alt="file.filename"
            loading="lazy"
          />
          <video v-else class="reader-media" :src="file.url" controls playsinline />
        </template>
      </div>
    </ModalDialog>

    <ModalDialog
      v-if="writing"
      :title="t('community.write')"
      width="920px"
      height="80vh"
      :busy="saving"
      :confirm-label="t('common.save')"
      @close="writing = false"
      @confirm="submit"
    >
      <div class="field">
        <label>{{ t('community.postTitle') }} *</label>
        <input v-model="draft.title" class="input" />
      </div>
      <div class="field">
        <label>{{ t('community.content') }}</label>
        <textarea v-model="draft.content" class="textarea" rows="5" />
      </div>

      <div class="field">
        <label>{{ t('community.files') }}</label>
        <label class="btn block">
          {{ t('community.pickFiles') }}
          <input type="file" accept="image/*,video/*" multiple hidden @change="pickFiles" />
        </label>
        <ul v-if="draft.files.length" class="picked">
          <li v-for="(file, at) in draft.files" :key="`${at}-${file.name}`">
            <span class="name">{{ file.name }}</span>
            <button class="drop" :title="t('common.delete')" @click="dropFile(at)">✕</button>
          </li>
        </ul>
      </div>

      <ProgressBar
        v-if="uploadProgress"
        :value="uploadRatio"
        :label="uploadProgress.name"
        :detail="`${uploadProgress.done + 1} / ${uploadProgress.total}`"
      />
      <p v-if="formError" class="error-text">{{ formError }}</p>
    </ModalDialog>
  </div>
</template>

<style scoped>
.community-picker {
  max-width: 280px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.card-header h2 {
  font-size: 14px;
}

.board-table {
  width: 100%;
  table-layout: fixed;
}

/* 줄마다 같은 그림이어야 한다.
   - 행 높이 고정(48px) + 칸의 line-height 를 행 높이로 맞춰 한 줄 내용을
     세로 가운데 세운다. 칸 안 요소(배지·📎)는 vertical-align 으로 그 줄의
     가운데에 맞추고 제 line-height 로 돌아간다.
   - 열 폭은 내용과 무관하게 고정(table-layout: fixed + 폭 지정) — 페이지를
     넘겨도, 값이 짧아도 열이 움직이지 않는다. */
.board-table th,
.board-table td {
  padding: 0 16px;
  vertical-align: middle;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.board-table th {
  height: 40px;
}

.board-table td {
  height: 48px;
  line-height: 48px;
}

.board-table td > * {
  vertical-align: middle;
  line-height: normal;
}

.board-row {
  cursor: pointer;
}

.attach-count {
  margin-left: 8px;
  font-size: 11px;
}

/* 열 폭 고정(colgroup) — 제목만 남는 폭을 다 쓴다. */
.w-status {
  width: 120px;
}

.w-author {
  width: 140px;
}

.w-date {
  width: 190px;
}

/* 머리글 글자도 자료와 같은 자리에 선다. */
.col-status {
  text-align: center;
}

.reader-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.reader-meta .spacer {
  flex: 1;
}

.status-field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.reader-body {
  margin: 10px 0 0;
  font-size: 13px;
  white-space: pre-wrap;
}

.reader-files {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}

.reader-media {
  width: 100%;
  max-height: 48vh;
  object-fit: contain;
  border-radius: 6px;
  background: #000;
}

.post-title {
  font-size: 13px;
  font-weight: 600;
}

.status-select {
  width: auto;
  padding: 1px 6px;
  font-size: 11px;
}

.status-badge {
  display: inline-block;
  width: 72px;
  box-sizing: border-box;
  text-align: center;
  font-size: 11px;
  padding: 4px 0;
  border-radius: 999px;
  background: rgb(148 163 184 / 20%);
}

.status-게시 {
  color: #16a34a;
}

.status-게시보류 {
  color: #dc2626;
}


.drop {
  margin-left: auto;
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  line-height: 1;
}

.drop:hover {
  color: var(--danger);
}

.picked {
  display: grid;
  gap: 2px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
}

.picked li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.picked .name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
