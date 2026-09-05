<script setup>
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
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

.url {
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
</style>
