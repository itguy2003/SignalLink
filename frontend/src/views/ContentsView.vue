<script setup>
/** 콘텐츠 라이브러리 목록. 주간 편집기의 콘텐츠 브라우저와 같은 자원을 다룬다. */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { api } from '@/api/client'
import ModalDialog from '@/components/ModalDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { SHARE_SCOPES, shareLabelKey } from '@/utils/contentShare'

const auth = useAuthStore()
const toast = useToastStore()
const router = useRouter()
const { t, locale } = useI18n()

const page = ref({ items: [], total: 0, page: 1, size: 24 })
const orgs = ref([])
const loading = ref(false)
const filters = ref({ q: '', orientation: '' })

const dialog = ref(false)
const busy = ref(false)
const formError = ref('')
const form = ref({ name: '', description: '', org_id: '', orientation: 'landscape' })

async function load(pageNumber = page.value.page) {
  loading.value = true
  try {
    // 이 화면은 내 라이브러리 관리다 — 공유받은 콘텐츠는 스케줄 편집기의
    // 콘텐츠 브라우저에서 보이고, 여기서는 내 관리 범위의 것만 다룬다.
    page.value = await api.get('/contents', {
      q: filters.value.q || undefined,
      orientation: filters.value.orientation || undefined,
      share: 'mine',
      page: pageNumber,
      size: page.value.size,
    })
  } catch (err) {
    toast.error(err.detail ?? t('content.loadFailed'))
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  orgs.value = await api.get('/organizations').catch(() => [])
  await load(1)
})

function openCreate() {
  form.value = {
    name: '',
    description: '',
    org_id: auth.user?.org_id ?? '',
    orientation: 'landscape',
    share_scope: '없음',
  }
  formError.value = ''
  dialog.value = true
}

/** 공유 구분 변경 — 저장 즉시 반영한다(별도 저장 버튼 없음). */
async function setShare(content, scope) {
  const before = content.share_scope
  content.share_scope = scope
  try {
    await api.put(`/contents/${content.id}`, { share_scope: scope })
    toast.success(t('content.shareUpdated'))
  } catch (err) {
    content.share_scope = before
    toast.error(err.detail ?? t('content.shareUpdateFailed'))
  }
}

async function create() {
  busy.value = true
  formError.value = ''
  try {
    const portrait = form.value.orientation === 'portrait'
    const created = await api.post('/contents', {
      name: form.value.name.trim(),
      description: form.value.description.trim() || null,
      org_id: Number(form.value.org_id),
      width: portrait ? 1080 : 1920,
      height: portrait ? 1920 : 1080,
      share_scope: form.value.share_scope,
    })
    dialog.value = false
    toast.success(t('content.created'))
    router.push({ name: 'content-editor', params: { id: created.id } })
  } catch (err) {
    formError.value = err.detail ?? t('content.createFailed')
  } finally {
    busy.value = false
  }
}

async function duplicate(content) {
  try {
    await api.post(`/contents/${content.id}/duplicate`)
    toast.success(t('content.duplicated'))
    await load()
  } catch (err) {
    toast.error(err.detail ?? t('content.duplicateFailed'))
  }
}

async function remove(content) {
  if (!confirm(t('content.confirmDelete', { name: content.name }))) return
  try {
    await api.delete(`/contents/${content.id}`)
    toast.success(t('content.deleted'))
    await load()
  } catch (err) {
    toast.error(err.detail ?? t('content.deleteFailed'))
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
    <h1 class="page-title">{{ t('content.title') }}</h1>
    <p class="page-desc">{{ t('content.desc') }}</p>

    <section class="card">
      <div class="card-header">
        <div class="row row-wrap">
          <input
            v-model="filters.q"
            class="input filter-input"
            :placeholder="t('content.searchPlaceholder')"
            @keyup.enter="load(1)"
          />
          <select v-model="filters.orientation" class="select filter-select" @change="load(1)">
            <option value="">{{ t('content.allOrientations') }}</option>
            <option value="landscape">{{ t('content.landscape') }}</option>
            <option value="portrait">{{ t('content.portrait') }}</option>
          </select>
          <button class="btn" @click="load(1)">{{ t('common.search') }}</button>
        </div>
        <button class="btn btn-primary" @click="openCreate">{{ t('content.createButton') }}</button>
      </div>

      <p v-if="loading" class="muted pad">{{ t('common.loading') }}</p>

      <p v-else-if="page.items.length === 0" class="table-empty">{{ t('content.empty') }}</p>

      <div v-else class="grid">
        <article v-for="content in page.items" :key="content.id" class="tile">
          <RouterLink
            :to="{ name: 'content-editor', params: { id: content.id } }"
            class="thumb"
            :class="{ portrait: content.height > content.width }"
            :style="{ background: content.background }"
          >
            <span class="thumb-count">
              {{ t('content.elementCount', { count: content.element_count }) }}
            </span>
          </RouterLink>

          <div class="tile-body">
            <RouterLink :to="{ name: 'content-editor', params: { id: content.id } }" class="name">
              {{ content.name }}
            </RouterLink>
            <div class="sub muted">
              {{ content.width }}×{{ content.height }} · v{{ content.version }}
            </div>
            <div class="sub muted">{{ formatDate(content.updated_at) }}</div>
            <div class="sub">
              <span v-if="content.usage_count" class="badge badge-primary">
                {{ t('content.usedIn', { count: content.usage_count }) }}
              </span>
              <span v-else class="badge badge-muted">{{ t('content.unused') }}</span>
            </div>
            <!-- 공유 구분 — 여기서 바로 바꾼다. 값은 서버 계약(한국어) 그대로. -->
            <label class="sub share-row">
              <span class="muted">{{ t('content.share') }}</span>
              <select
                class="select share-select"
                :value="content.share_scope"
                data-test="share-select"
                @change="setShare(content, $event.target.value)"
              >
                <option v-for="scope in SHARE_SCOPES" :key="scope" :value="scope">
                  {{ t(shareLabelKey(scope)) }}
                </option>
              </select>
            </label>
          </div>

          <div class="tile-actions">
            <button class="btn btn-sm" @click="duplicate(content)">{{ t('common.duplicate') }}</button>
            <button class="btn btn-sm btn-danger" @click="remove(content)">
              {{ t('common.delete') }}
            </button>
          </div>
        </article>
      </div>

      <div class="pager">
        <button class="btn btn-sm" :disabled="page.page <= 1" @click="load(page.page - 1)">
          {{ t('common.prev') }}
        </button>
        <span class="muted">{{ page.page }} / {{ Math.max(1, Math.ceil(page.total / page.size)) }}</span>
        <button
          class="btn btn-sm"
          :disabled="page.page * page.size >= page.total"
          @click="load(page.page + 1)"
        >
          {{ t('common.next') }}
        </button>
        <span class="muted">{{ t('common.totalCount', { count: page.total }) }}</span>
      </div>
    </section>

    <ModalDialog
      v-if="dialog"
      :title="t('content.createTitle')"
      :busy="busy"
      :confirm-label="t('content.createConfirm')"
      @close="dialog = false"
      @confirm="create"
    >
      <div class="field">
        <label>{{ t('content.name') }}</label>
        <input v-model="form.name" class="input" />
      </div>

      <div class="field">
        <label>{{ t('content.description') }}</label>
        <input v-model="form.description" class="input" :placeholder="t('common.optional')" />
      </div>

      <div class="field">
        <label>{{ t('content.orientation') }}</label>
        <select v-model="form.orientation" class="select">
          <option value="landscape">{{ t('content.orientationLandscape') }}</option>
          <option value="portrait">{{ t('content.orientationPortrait') }}</option>
        </select>
      </div>

      <div class="field">
        <label>{{ t('auth.org') }}</label>
        <select v-model="form.org_id" class="select">
          <option v-for="org in orgs" :key="org.id" :value="org.id">{{ org.name }}</option>
        </select>
      </div>

      <div class="field">
        <label>{{ t('content.share') }}</label>
        <select v-model="form.share_scope" class="select" data-test="create-share">
          <option v-for="scope in SHARE_SCOPES" :key="scope" :value="scope">
            {{ t(shareLabelKey(scope)) }}
          </option>
        </select>
      </div>

      <p v-if="formError" class="error-text">{{ formError }}</p>
    </ModalDialog>
  </div>
</template>

<style scoped>
.filter-input {
  width: 200px;
}

.filter-select {
  width: 140px;
}

.pad {
  padding: 30px 16px;
  text-align: center;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 14px;
  padding: 16px;
}

.tile {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface);
}

.thumb {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 16 / 9;
}

.thumb.portrait {
  aspect-ratio: 9 / 16;
  max-height: 190px;
}

.thumb-count {
  padding: 2px 9px;
  border-radius: 999px;
  background: rgb(15 23 42 / 60%);
  color: #e2e8f0;
  font-size: 11px;
}

.tile-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.name:hover {
  color: var(--primary);
}

.sub {
  font-size: 11px;
}

.tile-actions {
  display: flex;
  gap: 6px;
  padding: 0 12px 12px;
}

.pager {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}

.share-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.share-select {
  width: auto;
  max-width: 150px;
  padding: 2px 6px;
  font-size: 12px;
}
</style>
