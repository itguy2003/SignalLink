<script setup>
/**
 * 관리자 — 학교 정보 관리 (슈퍼관리자 전용).
 *
 * 엑셀(.xlsx)이나 CSV 로 학교를 일괄 등록한다. 헤더 규칙은 기관 일괄
 * 등록과 같고(기관명 필수), 기관타입 컬럼이 없으면 서버가 '학교'로
 * 넣는다(default_org_type=학교). 등록된 학교 목록을 검색·삭제할 수 있다.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import ModalDialog from '@/components/ModalDialog.vue'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()
const { t } = useI18n()

/** 상위 기관 후보 — 학교는 상위기관(교육청 등) 아래에 들어간다. */
const offices = ref([])
const parentId = ref(null)

/** 학교 목록 — 수천 건이 될 수 있어 서버 페이징으로 받는다. */
const schools = ref({ items: [], total: 0, page: 1, size: 20 })
const loading = ref(true)
const query = ref('')

/** 일괄 삭제용 선택 — id 기반이라 페이지를 넘겨도 유지된다. */
const selected = ref(new Set())

/** 고른 파일과 업로드 결과. */
const picked = ref(null)
/** 보조 파일(위도·경도 등). 다른 출처의 좌표 자료를 함께 올려 서버가 합친다. */
const coordsPicked = ref(null)
const uploading = ref(false)
const result = ref(null)

/** 기관구분 마스터 — 이름이 바뀌어도 분류(category)로 학교/기관을 가른다. */
const orgTypes = ref([])
const namesOf = (category) =>
  new Set(orgTypes.value.filter((type) => type.category === category).map((type) => type.name))

onMounted(async () => {
  try {
    orgTypes.value = await api.get('/org-types').catch(() => [])
    const orgs = await api.get('/organizations')
    const officeNamesSet = namesOf('기관')
    offices.value = orgs.filter((org) => officeNamesSet.has(org.org_type))
    parentId.value = offices.value[0]?.id ?? null
    await load()
  } catch (err) {
    toast.error(err.detail ?? t('admin.loadFailed'))
  } finally {
    loading.value = false
  }
})

async function load(page = 1) {
  // 분류(category)로 서버가 거른다 — 구분 이름이 바뀌어도 화면이 계속 맞는다.
  schools.value = await api.get('/organizations/paged', {
    category: '학교',
    page,
    size: schools.value.size,
    ...(query.value ? { q: query.value } : {}),
  })
}

const totalPages = computed(() =>
  Math.max(1, Math.ceil(schools.value.total / schools.value.size)),
)

/** 검색은 선택을 버리고 첫 페이지부터 — 안 보이는 것을 지우는 사고를 막는다. */
async function search() {
  selected.value = new Set()
  await load(1)
}

function toggleSelect(id) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

const allOnPageSelected = computed(
  () =>
    schools.value.items.length > 0 &&
    schools.value.items.every((school) => selected.value.has(school.id)),
)

function toggleSelectAll() {
  const next = new Set(selected.value)
  if (allOnPageSelected.value) schools.value.items.forEach((school) => next.delete(school.id))
  else schools.value.items.forEach((school) => next.add(school.id))
  selected.value = next
}

async function removeSelected() {
  if (!selected.value.size) return
  if (!confirm(t('admin.confirmBulkDelete', { count: selected.value.size }))) return
  await runBulkDelete({ ids: [...selected.value] })
}

/** 지금 검색 조건에 걸리는 학교 전부 — 수천 건을 페이지로 지우게 하지 않는다. */
async function removeAllResults() {
  if (!schools.value.total) return
  if (!confirm(t('admin.confirmDeleteAllResults', { count: schools.value.total }))) return
  await runBulkDelete({ category: '학교', ...(query.value ? { q: query.value } : {}) })
}

async function runBulkDelete(body) {
  try {
    const result = await api.post('/organizations/bulk-delete', body)
    toast.success(t('admin.bulkDeleted', { count: result.deleted }))
    // 사용자·장치가 있는 학교 등은 서버가 건너뛴다 — 이유를 알려 준다.
    if (result.skipped) {
      toast.error(`${t('admin.bulkSkipped', { count: result.skipped })} ${result.errors[0] ?? ''}`)
    }
    selected.value = new Set()
    await load(1)
  } catch (err) {
    toast.error(err.detail ?? t('admin.removeFailed'))
  }
}

const officeNames = computed(() =>
  Object.fromEntries(offices.value.map((org) => [org.id, org.name])),
)

function pickFile(event) {
  picked.value = event.target.files?.[0] ?? null
  event.target.value = ''
  result.value = null
}

function pickCoordsFile(event) {
  coordsPicked.value = event.target.files?.[0] ?? null
  event.target.value = ''
  result.value = null
}

async function upload() {
  if (!picked.value) {
    toast.error(t('admin.fileRequired'))
    return
  }
  if (!parentId.value) {
    toast.error(t('admin.parentRequired'))
    return
  }
  uploading.value = true
  result.value = null
  try {
    const body = new FormData()
    body.append('file', picked.value)
    // 학교 정보와 좌표가 다른 파일이면 함께 올린다 — 서버가 학교코드/이름으로 합친다.
    if (coordsPicked.value) body.append('coords_file', coordsPicked.value)
    // 기관타입 컬럼이 없어도 학교로 들어간다 — 이 화면의 존재 이유다.
    result.value = await api.upload('/organizations/bulk-upload', body, {
      parent_id: parentId.value,
      default_org_type: [...namesOf('학교')][0] ?? '학교',
    })
    picked.value = null
    coordsPicked.value = null
    await load()
    if (result.value.created > 0) {
      toast.success(t('admin.uploaded', { count: result.value.created }))
    }
  } catch (err) {
    toast.error(err.detail ?? t('admin.uploadFailed'))
  } finally {
    uploading.value = false
  }
}

/** 수정 창 — 원본과 폼을 함께 들고, 저장 시 **바뀐 칸만** 보낸다(부분 갱신). */
const editing = ref(null)
const editSaving = ref(false)
const editError = ref('')

const EDIT_FIELDS = [
  'name',
  'school_level',
  'parent_id',
  'address',
  'address_detail',
  'phone',
  'homepage',
  'edu_office_code',
  'edu_office_name',
  'school_code',
  'sido_name',
  'jurisdiction_name',
  'latitude',
  'longitude',
]

function openEdit(school) {
  const form = {}
  for (const field of EDIT_FIELDS) form[field] = school[field] ?? (field === 'parent_id' ? null : '')
  editing.value = { id: school.id, original: { ...form }, form }
  editError.value = ''
}

/** 학교급 선택지 — 기관구분 마스터의 분류. 지금 값이 목록에 없으면(예:
 * 일괄 등록의 '기타') 그대로 고를 수 있게 앞에 끼운다. */
const levelOptions = computed(() => {
  const master = orgTypes.value.find((type) => type.category === '학교')
  const list = (master?.classifications ?? '초,중,고')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const current = editing.value?.original.school_level
  if (current !== undefined && !list.includes(current)) list.unshift(current)
  return list
})

async function saveEdit() {
  const { id, form, original } = editing.value
  if (!String(form.name ?? '').trim()) {
    editError.value = t('admin.schoolNameRequired')
    return
  }
  const body = {}
  for (const [field, value] of Object.entries(form)) {
    if (value === original[field]) continue
    if (field === 'latitude' || field === 'longitude') {
      // 좌표는 지우기 없음 — 새 값을 적었을 때만 숫자로 보낸다.
      if (value === '' || value === null) continue
      const number = Number(value)
      if (Number.isNaN(number)) {
        editError.value = t('admin.coordNumber')
        return
      }
      body[field] = number
    } else {
      body[field] = value
    }
  }
  if (!Object.keys(body).length) {
    editing.value = null
    return
  }
  editSaving.value = true
  editError.value = ''
  try {
    await api.put(`/organizations/${id}`, body)
    toast.success(t('admin.schoolSaved'))
    editing.value = null
    await load(schools.value.page)
  } catch (err) {
    editError.value = err.detail ?? t('admin.saveFailed')
  } finally {
    editSaving.value = false
  }
}

async function removeSchool(school) {
  if (!confirm(t('admin.confirmRemoveSchool', { name: school.name }))) return
  try {
    await api.delete(`/organizations/${school.id}`)
    // 보던 페이지를 유지하되, 마지막 줄을 지워 페이지가 비면 앞장으로.
    await load(schools.value.page)
    if (!schools.value.items.length && schools.value.page > 1) {
      await load(schools.value.page - 1)
    }
  } catch (err) {
    // 소속 사용자·장치가 있으면 서버가 이유를 말해 준다.
    toast.error(err.detail ?? t('admin.removeFailed'))
  }
}
</script>

<template>
  <div>
    <h1 class="page-title">{{ t('admin.schoolsTitle') }}</h1>
    <p class="page-desc">{{ t('admin.schoolsDesc') }}</p>

    <!-- 일괄 등록 -->
    <section class="card upload-card">
      <h2>{{ t('admin.bulkTitle') }}</h2>
      <p class="muted hint">{{ t('admin.bulkHint') }}</p>
      <p class="muted hint mono">
        {{ t('admin.headerHint') }}: 시도교육청코드, 시도교육청명, 행정코드, 학교명(필수),
        학교종류명, 시도명, 관할조직명, 도로명주소, 도로명상세주소, 전화번호, 홈페이지주소
      </p>
      <p class="muted hint">{{ t('admin.coordsHint') }}</p>

      <div class="row controls">
        <label class="field-inline">
          <span class="muted">{{ t('admin.parentOrg') }}</span>
          <select v-model.number="parentId" class="select" data-test="parent-select">
            <option v-for="org in offices" :key="org.id" :value="org.id">{{ org.name }}</option>
          </select>
        </label>

        <label class="btn">
          {{ t('admin.pickFile') }}
          <input
            type="file"
            accept=".xlsx,.csv"
            hidden
            data-test="file-input"
            @change="pickFile"
          />
        </label>
        <span v-if="picked" class="muted file-name">{{ picked.name }}</span>

        <!-- 좌표가 다른 파일로 오는 경우 — 서버가 학교코드/이름으로 합친다. -->
        <label class="btn" :title="t('admin.coordsHint')">
          {{ t('admin.pickCoordsFile') }}
          <input
            type="file"
            accept=".xlsx,.csv"
            hidden
            data-test="coords-input"
            @change="pickCoordsFile"
          />
        </label>
        <span v-if="coordsPicked" class="muted file-name">{{ coordsPicked.name }}</span>

        <button
          class="btn btn-primary"
          :disabled="uploading"
          data-test="upload"
          @click="upload"
        >
          {{ uploading ? t('common.processing') : t('admin.upload') }}
        </button>
      </div>

      <!-- 결과: 몇 건이 들어갔고 무엇이 왜 빠졌는지. 조용히 넘어가면
           빠진 행을 아무도 모른다. -->
      <div v-if="result" class="result" data-test="result">
        <span class="badge badge-success">{{ t('admin.created', { count: result.created }) }}</span>
        <span v-if="result.updated" class="badge badge-success">
          {{ t('admin.updatedCount', { count: result.updated }) }}
        </span>
        <span v-if="result.skipped" class="badge">
          {{ t('admin.skipped', { count: result.skipped }) }}
        </span>
        <ul v-if="result.errors.length" class="errors">
          <li v-for="(error, at) in result.errors" :key="at" class="error-text">{{ error }}</li>
        </ul>
      </div>
    </section>

    <!-- 학교 목록 -->
    <section class="card">
      <div class="card-header">
        <h2>{{ t('admin.schoolCount', { count: schools.total }) }}</h2>
        <input
          v-model="query"
          class="input search"
          :placeholder="t('admin.searchPlaceholder')"
          data-test="search"
          @keyup.enter="search"
        />
      </div>

      <div v-if="!loading && schools.total" class="bulk-bar">
        <button
          class="btn btn-sm"
          :disabled="!selected.size"
          data-test="delete-selected"
          @click="removeSelected"
        >
          {{ t('admin.deleteSelected', { count: selected.size }) }}
        </button>
        <button class="btn btn-sm" data-test="delete-all" @click="removeAllResults">
          {{ t('admin.deleteAllResults') }}
        </button>
      </div>

      <p v-if="loading" class="muted pad">{{ t('common.loading') }}</p>
      <table v-else-if="schools.items.length" class="table school-table">
        <colgroup>
          <col class="w-check" />
          <col />
          <col class="w-level" />
          <col class="w-parent" />
          <col />
          <col class="w-code" />
          <col class="w-actions" />
        </colgroup>
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                :checked="allOnPageSelected"
                data-test="select-all"
                @change="toggleSelectAll"
              />
            </th>
            <th>{{ t('admin.schoolName') }}</th>
            <th>{{ t('admin.schoolLevel') }}</th>
            <th>{{ t('admin.parentOrg') }}</th>
            <th>{{ t('admin.address') }}</th>
            <th>{{ t('admin.schoolCode') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="school in schools.items" :key="school.id" data-test="school-row">
            <td>
              <input
                type="checkbox"
                :checked="selected.has(school.id)"
                data-test="row-check"
                @change="toggleSelect(school.id)"
              />
            </td>
            <td>{{ school.name }}</td>
            <td>{{ school.school_level ?? '-' }}</td>
            <td class="muted">{{ officeNames[school.parent_id] ?? '-' }}</td>
            <td class="muted">{{ school.address ?? '-' }}</td>
            <td class="muted">{{ school.school_code ?? '-' }}</td>
            <td class="actions">
              <button class="btn btn-sm" data-test="edit" @click="openEdit(school)">
                {{ t('common.edit') }}
              </button>
              <button class="btn btn-sm" data-test="remove" @click="removeSchool(school)">
                {{ t('common.delete') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="table-empty">{{ t('admin.schoolsEmpty') }}</p>

      <!-- 학교 정보 수정 — 바뀐 칸만 저장한다. -->
      <ModalDialog
        v-if="editing"
        :title="t('admin.editSchool')"
        width="600px"
        :busy="editSaving"
        @close="editing = null"
        @confirm="saveEdit"
      >
        <div class="edit-grid">
          <label class="field span-2">
            <span>{{ t('admin.schoolName') }}</span>
            <input v-model="editing.form.name" class="input" data-test="edit-name" />
          </label>
          <label class="field">
            <span>{{ t('admin.schoolLevel') }}</span>
            <select v-model="editing.form.school_level" class="select" data-test="edit-level">
              <option v-for="level in levelOptions" :key="level" :value="level">
                {{ level || '—' }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>{{ t('admin.parentOrg') }}</span>
            <select v-model.number="editing.form.parent_id" class="select" data-test="edit-parent">
              <option v-for="org in offices" :key="org.id" :value="org.id">{{ org.name }}</option>
            </select>
          </label>
          <label class="field span-2">
            <span>{{ t('admin.address') }}</span>
            <input v-model="editing.form.address" class="input" data-test="edit-address" />
          </label>
          <label class="field span-2">
            <span>{{ t('admin.addressDetail') }}</span>
            <input v-model="editing.form.address_detail" class="input" />
          </label>
          <label class="field">
            <span>{{ t('admin.phone') }}</span>
            <input v-model="editing.form.phone" class="input" data-test="edit-phone" />
          </label>
          <label class="field">
            <span>{{ t('admin.homepage') }}</span>
            <input v-model="editing.form.homepage" class="input" />
          </label>
          <label class="field">
            <span>{{ t('admin.eduOfficeCode') }}</span>
            <input v-model="editing.form.edu_office_code" class="input" />
          </label>
          <label class="field">
            <span>{{ t('admin.eduOfficeName') }}</span>
            <input v-model="editing.form.edu_office_name" class="input" />
          </label>
          <label class="field">
            <span>{{ t('admin.schoolCode') }}</span>
            <input v-model="editing.form.school_code" class="input" />
          </label>
          <label class="field">
            <span>{{ t('admin.sidoName') }}</span>
            <input v-model="editing.form.sido_name" class="input" />
          </label>
          <label class="field">
            <span>{{ t('admin.jurisdictionName') }}</span>
            <input v-model="editing.form.jurisdiction_name" class="input" />
          </label>
          <label class="field">
            <span>{{ t('admin.latitude') }}</span>
            <input v-model="editing.form.latitude" class="input" data-test="edit-latitude" />
          </label>
          <label class="field">
            <span>{{ t('admin.longitude') }}</span>
            <input v-model="editing.form.longitude" class="input" />
          </label>
        </div>
        <p v-if="editError" class="error-text edit-error" data-test="edit-error">{{ editError }}</p>
      </ModalDialog>

      <div v-if="!loading && schools.total > schools.size" class="pager" data-test="pager">
        <button
          class="btn btn-sm"
          :disabled="schools.page <= 1"
          data-test="prev-page"
          @click="load(schools.page - 1)"
        >
          {{ t('common.prev') }}
        </button>
        <span class="muted">{{ schools.page }} / {{ totalPages }}</span>
        <button
          class="btn btn-sm"
          :disabled="schools.page * schools.size >= schools.total"
          data-test="next-page"
          @click="load(schools.page + 1)"
        >
          {{ t('common.next') }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.upload-card {
  padding: 14px 16px;
  margin-bottom: 14px;
}

.upload-card h2 {
  font-size: 14px;
  margin: 0 0 6px;
}

.hint {
  margin: 2px 0;
  font-size: 12px;
}

.mono {
  font-size: 11px;
}

.controls {
  margin-top: 10px;
  flex-wrap: wrap;
}

.field-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.field-inline .select {
  width: auto;
  min-width: 180px;
}

.file-name {
  font-size: 12px;
  max-width: 240px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.result {
  margin-top: 10px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.errors {
  width: 100%;
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 12px;
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

.search {
  width: 220px;
}

.pad {
  padding: 14px 16px;
}

.school-table {
  table-layout: fixed;
}

.school-table td,
.school-table th {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.w-level {
  width: 80px;
}

.w-parent {
  width: 180px;
}

.w-code {
  width: 110px;
}

.w-actions {
  width: 130px;
}

.actions {
  text-align: right;
}

.pager {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}

.bulk-bar {
  display: flex;
  gap: 8px;
  padding: 0 16px 10px;
}

.w-check {
  width: 34px;
}

.edit-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
}

.edit-grid .field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.edit-grid .span-2 {
  grid-column: span 2;
}

.edit-error {
  margin-top: 10px;
}
</style>
