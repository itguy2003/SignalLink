<script setup>
/**
 * 소속기관 공지 목록.
 *
 * 공지는 **기간이 정해진 재생목록**이다 — 슬라이드(편집기 문서)들을 순서와
 * 유지 시간으로 순환한다. 여기서는 목록·만들기·삭제만 하고, 슬라이드
 * 편집은 분할 편집기(OrgNoticeEditorView)가 맡는다.
 */
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { api } from '@/api/client'
import ContentPreview from '@/components/ContentPreview.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

const auth = useAuthStore()
const toast = useToastStore()
const router = useRouter()
const { t, locale } = useI18n()

const orgs = ref([])
const orgId = ref(null)
const notices = ref([])
const loading = ref(false)

onMounted(async () => {
  orgs.value = await api.get('/organizations').catch(() => [])
  orgId.value = auth.user?.org_id ?? orgs.value[0]?.id ?? null
  await load()
})

watch(orgId, load)

async function load() {
  if (!orgId.value) return
  loading.value = true
  try {
    notices.value = await api.get('/org-notices', { org_id: orgId.value })
  } catch (err) {
    toast.error(err.detail ?? t('orgNotice.loadFailed'))
  } finally {
    loading.value = false
  }
}

// ------------------------------------------------------------ 만들기
const dialog = ref(false)
const busy = ref(false)
const formError = ref('')
const form = ref({ name: '', start_date: '', end_date: '' })

function openCreate() {
  form.value = { name: '', start_date: '', end_date: '' }
  formError.value = ''
  dialog.value = true
}

async function create() {
  const name = form.value.name.trim()
  if (!name) {
    formError.value = t('orgNotice.nameRequired')
    return
  }
  busy.value = true
  formError.value = ''
  try {
    const created = await api.post('/org-notices', {
      org_id: orgId.value,
      name,
      start_date: form.value.start_date || null,
      end_date: form.value.end_date || null,
    })
    dialog.value = false
    toast.success(t('orgNotice.created'))
    // 만들자마자 슬라이드를 채우러 간다 — 빈 공지는 아무것도 못 튼다.
    router.push({ name: 'org-notice-editor', params: { id: created.id } })
  } catch (err) {
    formError.value = err.detail ?? t('orgNotice.saveFailed')
  } finally {
    busy.value = false
  }
}

async function remove(notice) {
  if (!confirm(t('orgNotice.confirmDelete', { name: notice.name }))) return
  try {
    await api.delete(`/org-notices/${notice.id}`)
    toast.success(t('orgNotice.deleted'))
    await load()
  } catch (err) {
    toast.error(err.detail ?? t('orgNotice.deleteFailed'))
  }
}

// ------------------------------------------------------------ 미리보기
const preview = ref(null) // { name, items } — 열려 있는 공지의 상세
const previewIndex = ref(0)
const widgets = ref(null) // 위젯 명세 — 미리보기 문서가 위젯을 담을 수 있다.

async function openPreview(notice) {
  try {
    const detail = await api.get(`/org-notices/${notice.id}`)
    if (!detail.items?.length) {
      toast.push(t('orgNotice.emptySlides'), 'info')
      return
    }
    widgets.value ??= await api.get('/widgets').catch(() => [])
    previewIndex.value = 0
    preview.value = detail
  } catch (err) {
    toast.error(err.detail ?? t('orgNotice.loadFailed'))
  }
}

function turnPage(delta) {
  const next = previewIndex.value + delta
  if (next < 0 || next >= preview.value.items.length) return
  previewIndex.value = next
}

function period(notice) {
  if (!notice.start_date && !notice.end_date) return t('orgNotice.always')
  // 저장 형식은 YYYY-MM-DDTHH:MM — 화면에서는 T 를 공백으로 푼다.
  const pretty = (value) => (value ?? '').replace('T', ' ')
  return `${pretty(notice.start_date)} ~ ${pretty(notice.end_date)}`
}

function formatDate(value) {
  return value
    ? new Date(value).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
    : '-'
}
</script>

<template>
  <div>
    <h1 class="page-title">{{ t('orgNotice.title') }}</h1>
    <p class="page-desc">{{ t('orgNotice.desc') }}</p>

    <div class="field org-picker">
      <label>{{ t('board.org') }}</label>
      <select v-model.number="orgId" class="select">
        <option v-for="org in orgs" :key="org.id" :value="org.id">{{ org.name }}</option>
      </select>
    </div>

    <section class="card">
      <div class="card-header">
        <h2>{{ t('orgNotice.listCount', { count: notices.length }) }}</h2>
        <button class="btn btn-primary btn-sm" data-test="add-notice" @click="openCreate">
          {{ t('orgNotice.create') }}
        </button>
      </div>

      <p v-if="loading" class="muted pad">{{ t('common.loading') }}</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>{{ t('orgNotice.name') }}</th>
            <th>{{ t('orgNotice.period') }}</th>
            <th class="num">{{ t('orgNotice.items') }}</th>
            <th class="num">v</th>
            <th>{{ t('common.updatedAt') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="notice in notices" :key="notice.id" data-test="notice-row">
            <td>
              <RouterLink
                class="notice-name"
                :to="{ name: 'org-notice-editor', params: { id: notice.id } }"
              >
                {{ notice.name }}
              </RouterLink>
            </td>
            <td class="muted">{{ period(notice) }}</td>
            <td class="num">{{ t('orgNotice.itemCount', { count: notice.item_count }) }}</td>
            <td class="num muted">{{ notice.version }}</td>
            <td class="muted">{{ formatDate(notice.updated_at) }}</td>
            <td class="row-actions">
              <button
                class="btn btn-sm"
                data-test="preview-notice"
                @click="openPreview(notice)"
              >
                {{ t('preview.open') }}
              </button>
              <RouterLink
                class="btn btn-sm"
                :to="{ name: 'org-notice-editor', params: { id: notice.id } }"
              >
                {{ t('common.edit') }}
              </RouterLink>
              <button
                class="btn btn-sm btn-danger"
                data-test="remove-notice"
                @click="remove(notice)"
              >
                {{ t('common.delete') }}
              </button>
            </td>
          </tr>
          <tr v-if="!loading && notices.length === 0">
            <td colspan="6" class="table-empty">{{ t('orgNotice.empty') }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 공지 만들기 — 이름과 기간만 정하고, 슬라이드는 편집기에서 채운다. -->
    <ModalDialog
      v-if="dialog"
      :title="t('orgNotice.createTitle')"
      :busy="busy"
      :confirm-label="t('orgNotice.create')"
      @close="dialog = false"
      @confirm="create"
    >
      <div class="field">
        <label>{{ t('orgNotice.name') }}</label>
        <input v-model="form.name" class="input" data-test="name-input" />
      </div>

      <div class="field">
        <label>{{ t('orgNotice.period') }}</label>
        <div class="row period-row">
          <input
            v-model="form.start_date"
            class="input"
            type="datetime-local"
            data-test="start-input"
          />
          <span class="muted">~</span>
          <input
            v-model="form.end_date"
            class="input"
            type="datetime-local"
            data-test="end-input"
          />
        </div>
        <p class="hint">{{ t('orgNotice.periodHint') }}</p>
      </div>

      <p v-if="formError" class="error-text">{{ formError }}</p>
    </ModalDialog>

    <!-- 미리보기 — 재생목록형이라 장을 넘겨 본다. -->
    <ContentPreview
      v-if="preview"
      :document="preview.items[previewIndex].document"
      :widgets="widgets ?? []"
      :page-index="previewIndex"
      :page-total="preview.items.length"
      @page="turnPage"
      @close="preview = null"
    />
  </div>
</template>

<style scoped>
.org-picker {
  max-width: 280px;
}

.notice-name {
  color: var(--primary);
  font-weight: 600;
}

.notice-name:hover {
  text-decoration: underline;
}

.num {
  text-align: right;
  white-space: nowrap;
}

.row-actions {
  white-space: nowrap;
  text-align: right;
}

.row-actions .btn + .btn {
  margin-left: 6px;
}

.period-row {
  align-items: center;
}

.pad {
  padding: 12px;
}
</style>
