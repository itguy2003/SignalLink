<script setup>
/**
 * 기관게시판.
 *
 * 두 종류의 사람이 함께 쓴다. 관리자는 **수집원**(어디서 긁어 올지)을 다루고,
 * 커뮤니티 유저는 **글**을 올린다 — 게시판이 그 사람에게 열려 있는 유일한
 * 창구다. 그래서 수집원 칸과 글 칸의 권한이 서로 다르다.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import ModalDialog from '@/components/ModalDialog.vue'
import ProgressBar from '@/components/ProgressBar.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

const auth = useAuthStore()
const toast = useToastStore()
const { t, locale } = useI18n()

const orgs = ref([])
const orgId = ref(null)
const boards = ref([])
const selectedBoard = ref(null)
const posts = ref({ items: [], total: 0, page: 1, size: 20 })
const loading = ref(false)

/** 글쓰기 창. */
const writing = ref(false)
const draft = ref(null)
const saving = ref(false)
const formError = ref('')
/** 올리는 중의 진행률. `{ done, total, name, ratio }` */
const uploadProgress = ref(null)

/**
 * 기관 고르기는 여러 기관을 보는 사람에게만 뜻이 있다.
 *
 * 커뮤니티 유저는 기관 목록 자체를 받아 오지 못한다(서버가 막는다) — 자기
 * 기관 하나뿐인데 빈 선택 상자를 두면 고장으로 보인다.
 */
const canPickOrg = computed(() => orgs.value.length > 0)

onMounted(async () => {
  orgs.value = await api.get('/organizations').catch(() => [])
  orgId.value = auth.user?.org_id ?? orgs.value[0]?.id ?? null
  await loadBoards()
})

watch(orgId, loadBoards)

async function loadBoards() {
  if (!orgId.value) return
  loading.value = true
  selectedBoard.value = null
  posts.value = { items: [], total: 0, page: 1, size: 20 }
  try {
    boards.value = await api.get('/boards', { org_id: orgId.value })
  } catch (err) {
    toast.error(err.detail ?? t('board.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function selectBoard(board) {
  selectedBoard.value = board
  try {
    posts.value = await api.get(`/boards/${board.id}/posts`, { size: 20 })
  } catch (err) {
    toast.error(err.detail ?? t('board.postsLoadFailed'))
  }
}

function formatDate(value) {
  return value
    ? new Date(value).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
    : '-'
}

/** 글쓰기 창을 연다. 오늘 날짜를 미리 채워 둔다 — 대부분 오늘 쓴 글이다. */
function openWriter() {
  draft.value = {
    title: '',
    author: auth.user?.name ?? '',
    posted_on: new Date().toISOString().slice(0, 10),
    content: '',
    files: [],
  }
  formError.value = ''
  writing.value = true
}

/** 고른 파일을 담아 둔다. 실제로 올리는 것은 글을 만든 뒤다. */
function pickFiles(event) {
  draft.value.files = [...draft.value.files, ...Array.from(event.target.files ?? [])]
  // 같은 파일을 다시 고를 수 있어야 한다(잘못 넣어 뺀 뒤 재시도).
  event.target.value = ''
}

function dropFile(at) {
  draft.value.files = draft.value.files.filter((_, index) => index !== at)
}

/**
 * 글을 만들고 파일을 잇는다.
 *
 * 파일을 먼저 올릴 수는 없다 — 첨부는 글에 붙는 것이라 붙일 글이 있어야 한다.
 * 그래서 글을 만든 뒤 하나씩 올린다. 중간에 하나가 막혀도 글과 나머지 파일은
 * 살린다.
 */
async function submit() {
  const form = draft.value
  if (!form.title.trim()) {
    formError.value = t('board.titleRequired')
    return
  }

  saving.value = true
  formError.value = ''
  try {
    const post = await api.post(`/boards/${selectedBoard.value.id}/posts`, {
      title: form.title.trim(),
      author: form.author.trim() || null,
      posted_on: form.posted_on || null,
      content: form.content.trim() || null,
    })
    const failed = await uploadFiles(post.id, form.files)

    writing.value = false
    toast.success(failed ? t('board.savedWithFailures', { count: failed }) : t('board.saved'))
    await selectBoard(selectedBoard.value)
  } catch (err) {
    formError.value = err.detail ?? t('board.saveFailed')
  } finally {
    saving.value = false
    uploadProgress.value = null
  }
}

/** 파일을 차례로 올린다. 실패한 개수를 돌려준다. */
async function uploadFiles(postId, files) {
  if (files.length === 0) return 0

  let failed = 0
  uploadProgress.value = { done: 0, total: files.length, name: '', ratio: 0 }
  for (const file of files) {
    uploadProgress.value = { ...uploadProgress.value, name: file.name, ratio: 0 }
    try {
      const body = new FormData()
      body.append('file', file)
      await api.upload(
        `/boards/${selectedBoard.value.id}/posts/${postId}/attachments`,
        body,
        undefined,
        {
          onProgress: (ratio) => {
            if (uploadProgress.value) uploadProgress.value.ratio = ratio
          },
        },
      )
    } catch {
      failed += 1
    }
    uploadProgress.value = { ...uploadProgress.value, done: uploadProgress.value.done + 1 }
  }
  return failed
}

/** 전체에서 어디까지 왔는가. 파일 크기가 제각각이라 정확하지는 않다. */
const uploadRatio = computed(() => {
  const at = uploadProgress.value
  if (!at) return null
  return (at.done + (at.ratio ?? 0)) / at.total
})

/** 이미 올린 글에 파일을 더 붙인다. */
async function attachMore(post, event) {
  const files = Array.from(event.target.files ?? [])
  event.target.value = ''
  if (files.length === 0) return

  const failed = await uploadFiles(post.id, files)
  uploadProgress.value = null
  if (failed) toast.error(t('board.attachFailed', { count: failed }))
  await selectBoard(selectedBoard.value)
}

async function detach(post, asset) {
  try {
    await api.delete(
      `/boards/${selectedBoard.value.id}/posts/${post.id}/attachments/${asset.id}`,
    )
    await selectBoard(selectedBoard.value)
  } catch (err) {
    toast.error(err.detail ?? t('board.detachFailed'))
  }
}
</script>

<template>
  <div>
    <h1 class="page-title">{{ t('board.title') }}</h1>
    <p class="page-desc">{{ t('board.desc') }}</p>

    <div v-if="canPickOrg" class="field org-picker">
      <label>{{ t('board.org') }}</label>
      <select v-model.number="orgId" class="select">
        <option v-for="org in orgs" :key="org.id" :value="org.id">{{ org.name }}</option>
      </select>
    </div>

    <div class="layout">
      <section class="card">
        <div class="card-header"><h2>{{ t('board.sources') }}</h2></div>
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('board.kind') }}</th>
              <th>{{ t('board.url') }}</th>
              <th>{{ t('board.method') }}</th>
              <th>{{ t('board.result') }}</th>
              <th>{{ t('board.count') }}</th>
              <th>{{ t('board.lastScraped') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="board in boards"
              :key="board.id"
              class="clickable"
              :class="{ selected: selectedBoard?.id === board.id }"
              @click="selectBoard(board)"
            >
              <td>
                <span class="badge badge-primary">{{ t(`enums.boardKind.${board.kind}`) }}</span>
              </td>
              <td class="url">{{ board.url }}</td>
              <td class="mono muted">{{ board.scrape_method ?? '-' }}</td>
              <td>
                <span
                  class="badge"
                  :class="board.scrape_result === '성공' ? 'badge-success' : board.scrape_result === '실패' ? 'badge-warning' : 'badge-muted'"
                >
                  {{ board.scrape_result ? t(`enums.scrapeResult.${board.scrape_result}`) : t('board.notScraped') }}
                </span>
              </td>
              <td>{{ board.scrape_count }}</td>
              <td class="muted">{{ formatDate(board.last_scraped_at) }}</td>
            </tr>
            <tr v-if="!loading && boards.length === 0">
              <td colspan="6" class="table-empty">{{ t('board.empty') }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="selectedBoard" class="card">
        <div class="card-header">
          <h2>
            {{
              t('board.collected', {
                kind: t(`enums.boardKind.${selectedBoard.kind}`),
                count: posts.total,
              })
            }}
          </h2>
          <button v-if="auth.can.writePosts" class="btn btn-primary btn-sm" @click="openWriter">
            {{ t('board.write') }}
          </button>
        </div>

        <!-- 창 밖에서 파일을 더 붙일 때의 진행률. -->
        <ProgressBar
          v-if="uploadProgress && !writing"
          class="pad"
          :value="uploadRatio"
          :label="uploadProgress.name"
          :detail="`${uploadProgress.done + 1} / ${uploadProgress.total}`"
        />
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('board.postTitle') }}</th>
              <th>{{ t('board.author') }}</th>
              <th>{{ t('board.date') }}</th>
              <th>{{ t('board.term') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="post in posts.items" :key="post.id">
              <td>
                {{ post.title }}

                <!-- 붙인 사진·영상. 글자만으로는 무엇이 붙었는지 알 수 없다. -->
                <div v-if="post.attachments.length || auth.can.writePosts" class="files">
                  <span v-for="file in post.attachments" :key="file.id" class="file">
                    <img
                      v-if="file.kind === 'image'"
                      class="thumb"
                      :src="file.url"
                      :alt="file.filename"
                      :title="file.filename"
                    />
                    <span v-else class="thumb video" :title="file.filename">🎬</span>
                    <button
                      v-if="auth.can.writePosts"
                      class="drop"
                      :title="t('board.detach')"
                      @click="detach(post, file)"
                    >
                      ✕
                    </button>
                  </span>

                  <label v-if="auth.can.writePosts" class="btn btn-sm add-file">
                    {{ t('board.attach') }}
                    <input
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      hidden
                      @change="attachMore(post, $event)"
                    />
                  </label>
                </div>
              </td>
              <td class="muted">{{ post.author ?? '-' }}</td>
              <td class="muted">{{ post.posted_on ?? '-' }}</td>
              <td class="muted">{{ post.term ?? '-' }}</td>
            </tr>
            <tr v-if="posts.items.length === 0">
              <td colspan="4" class="table-empty">{{ t('board.postsEmpty') }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- 글쓰기. 첨부는 글을 만든 뒤에 붙는다 — 붙일 글이 있어야 한다. -->
    <ModalDialog
      v-if="writing"
      :title="t('board.write')"
      :busy="saving"
      :confirm-label="t('common.save')"
      @close="writing = false"
      @confirm="submit"
    >
      <div class="field">
        <label>{{ t('board.postTitle') }} *</label>
        <input v-model="draft.title" class="input" />
      </div>
      <div class="row">
        <div class="field">
          <label>{{ t('board.author') }}</label>
          <input v-model="draft.author" class="input" />
        </div>
        <div class="field">
          <label>{{ t('board.date') }}</label>
          <input v-model="draft.posted_on" class="input" type="date" />
        </div>
      </div>
      <div class="field">
        <label>{{ t('board.content') }}</label>
        <textarea v-model="draft.content" class="textarea" rows="5" />
      </div>

      <div class="field">
        <label>{{ t('board.files') }}</label>
        <label class="btn block">
          {{ t('board.pickFiles') }}
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
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.pad {
  padding: 10px 14px;
}

.row {
  display: flex;
  gap: 10px;
}

.row .field {
  flex: 1;
}

/* 붙인 파일. 이름만 늘어놓으면 무엇이 붙었는지 열어 봐야 안다. */
.files {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}

.file {
  position: relative;
  display: inline-flex;
}

.thumb {
  display: grid;
  place-items: center;
  width: 44px;
  height: 32px;
  border-radius: 3px;
  object-fit: cover;
  background: #000;
  color: #fff;
  font-size: 14px;
}

.drop {
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

.file .drop {
  position: absolute;
  top: -4px;
  right: -6px;
  border-radius: 999px;
  background: var(--surface);
  font-size: 10px;
}

.add-file {
  padding: 1px 8px;
  font-size: 11px;
  cursor: pointer;
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

.org-picker {
  max-width: 280px;
}

.layout {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.card-header h2 {
  font-size: 14px;
}

.clickable {
  cursor: pointer;
}

.clickable.selected {
  background: var(--primary-soft);
}

.url {
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
</style>
