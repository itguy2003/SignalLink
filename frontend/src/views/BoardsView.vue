<script setup>
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import ModalDialog from '@/components/ModalDialog.vue'
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

// ------------------------------------------------ 등록/수정/삭제
const BOARD_KINDS = ['게시판', '일정', '급식메뉴', '시간표']

const dialog = ref(null) // 'create' | 'edit' | null
const editing = ref(null) // 수정 중인 게시판(원본 행)
const busy = ref(false)
const formError = ref('')
const form = ref({ name: '', kind: '게시판', url: '', scrape_method: '' })

function openCreate() {
  form.value = { name: '', kind: '게시판', url: '', scrape_method: '' }
  editing.value = null
  formError.value = ''
  dialog.value = 'create'
}

function openEdit(board) {
  form.value = {
    name: board.name ?? '',
    kind: board.kind,
    url: board.url,
    scrape_method: board.scrape_method ?? '',
  }
  editing.value = board
  formError.value = ''
  dialog.value = 'edit'
}

async function save() {
  const url = form.value.url.trim()
  if (!url) {
    formError.value = t('board.urlRequired')
    return
  }
  busy.value = true
  formError.value = ''
  try {
    const payload = {
      name: form.value.name.trim(),
      kind: form.value.kind,
      url,
      scrape_method: form.value.scrape_method.trim() || null,
    }
    if (dialog.value === 'create') {
      await api.post('/boards', { ...payload, org_id: orgId.value })
      toast.success(t('board.created'))
    } else {
      await api.put(`/boards/${editing.value.id}`, payload)
      toast.success(t('board.updated'))
    }
    dialog.value = null
    await loadBoards()
  } catch (err) {
    formError.value = err.detail ?? t('board.saveFailed')
  } finally {
    busy.value = false
  }
}

async function removeBoard(board) {
  // 지우면 수집된 데이터도 함께 사라진다 — 그 사실을 물음에 담는다.
  const label = board.name || t(`enums.boardKind.${board.kind}`)
  if (!confirm(t('board.confirmDelete', { kind: label }))) return
  try {
    await api.delete(`/boards/${board.id}`)
    toast.success(t('board.deleted'))
    await loadBoards()
  } catch (err) {
    toast.error(err.detail ?? t('board.deleteFailed'))
  }
}

function formatDate(value) {
  return value
    ? new Date(value).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
    : '-'
}
</script>

<template>
  <div>
    <h1 class="page-title">{{ t('board.title') }}</h1>
    <p class="page-desc">{{ t('board.desc') }}</p>

    <div class="field org-picker">
      <label>{{ t('board.org') }}</label>
      <select v-model.number="orgId" class="select">
        <option v-for="org in orgs" :key="org.id" :value="org.id">{{ org.name }}</option>
      </select>
    </div>

    <div class="layout">
      <section class="card">
        <div class="card-header">
          <h2>{{ t('board.sources') }}</h2>
          <button class="btn btn-primary btn-sm" data-test="add-board" @click="openCreate">
            {{ t('board.addBoard') }}
          </button>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('board.name') }}</th>
              <th>{{ t('board.kind') }}</th>
              <th>{{ t('board.url') }}</th>
              <th>{{ t('board.method') }}</th>
              <th>{{ t('board.result') }}</th>
              <th>{{ t('board.count') }}</th>
              <th>{{ t('board.lastScraped') }}</th>
              <th />
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
              <td class="board-name">{{ board.name || '-' }}</td>
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
              <td class="row-actions">
                <button class="btn btn-sm" data-test="edit-board" @click.stop="openEdit(board)">
                  {{ t('common.edit') }}
                </button>
                <button
                  class="btn btn-sm btn-danger"
                  data-test="remove-board"
                  @click.stop="removeBoard(board)"
                >
                  {{ t('common.delete') }}
                </button>
              </td>
            </tr>
            <tr v-if="!loading && boards.length === 0">
              <td colspan="8" class="table-empty">{{ t('board.empty') }}</td>
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
        </div>
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
              <td>{{ post.title }}</td>
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

    <!-- 게시판 등록/수정 -->
    <ModalDialog
      v-if="dialog"
      :title="dialog === 'create' ? t('board.addBoard') : t('board.editBoard')"
      :busy="busy"
      width="560px"
      @close="dialog = null"
      @confirm="save"
    >
      <div class="field">
        <label>{{ t('board.name') }}</label>
        <input
          v-model="form.name"
          class="input"
          :placeholder="t('board.namePlaceholder')"
          data-test="name-input"
        />
      </div>

      <div class="field">
        <label>{{ t('board.kind') }}</label>
        <select v-model="form.kind" class="select" data-test="kind-select">
          <option v-for="kind in BOARD_KINDS" :key="kind" :value="kind">
            {{ t(`enums.boardKind.${kind}`) }}
          </option>
        </select>
      </div>

      <div class="field">
        <label>{{ t('board.url') }}</label>
        <input
          v-model="form.url"
          class="input"
          :placeholder="t('board.urlPlaceholder')"
          data-test="url-input"
        />
      </div>

      <div class="field">
        <label>{{ t('board.method') }}</label>
        <input
          v-model="form.scrape_method"
          class="input"
          :placeholder="t('board.methodPlaceholder')"
          data-test="method-input"
        />
        <p class="hint">{{ t('board.methodHint') }}</p>
      </div>

      <p v-if="formError" class="error-text">{{ formError }}</p>
    </ModalDialog>
  </div>
</template>

<style scoped>
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

.board-name {
  font-weight: 600;
}

.row-actions {
  white-space: nowrap;
}

.row-actions .btn + .btn {
  margin-left: 6px;
}

.url {
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
</style>
