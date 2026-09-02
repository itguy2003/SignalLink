<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api, TEST_MODE } from '@/api/client'
import ModalDialog from '@/components/ModalDialog.vue'
import OrgTree from '@/components/OrgTree.vue'
import ProgressBar from '@/components/ProgressBar.vue'
import { useToastStore } from '@/stores/toast'
import { branchNodes, filterChildren, findNode, pathTo } from '@/utils/orgTree'

const toast = useToastStore()
const { t } = useI18n()

const tree = ref([])
const selected = ref(null)
const loading = ref(false)
const childQuery = ref('')

/**
 * 트리에는 하위 기관을 가진 기관만 그린다. 잎(학교 등)은 오른쪽 목록이 맡는다.
 * 교육청 하나에 학교가 수백 개씩 달리면 트리로는 찾을 수 없기 때문이다.
 */
const treeNodes = computed(() => branchNodes(tree.value))

/** 지금 어디에 있는지. 트리에 안 보이는 기관을 목록에서 골랐을 때 특히 필요하다. */
const crumbs = computed(() =>
  selected.value ? pathTo(tree.value, selected.value.id) : [],
)

/** 상위 기관. 상세에 '#3' 대신 이름을 보여 주고, 눌러서 올라갈 수 있게 한다. */
const parentOrg = computed(() => (crumbs.value.length > 1 ? crumbs.value.at(-2) : null))

const children = computed(() => selected.value?.children ?? [])
const visibleChildren = computed(() => filterChildren(children.value, childQuery.value))

function select(org) {
  selected.value = org
  // 다른 기관으로 옮겼는데 이전 검색어가 남아 있으면 목록이 빈 것처럼 보인다.
  childQuery.value = ''
}

/**
 * 트리에서 고른 기관.
 *
 * 트리가 넘겨주는 노드는 `branchNodes()` 가 만든 **사본**이라 잎이 잘려 있다.
 * 그대로 고르면 오른쪽 목록이 비거나(교육청) 일부만 나온다(최상위). 원본
 * 트리에서 같은 id 를 다시 찾아 고른다.
 */
function selectById(id) {
  select(findNode(tree.value, id))
}

const dialog = ref(null) // 'create' | 'edit' | 'upload' | null
const busy = ref(false)
const formError = ref('')

const emptyForm = () => ({
  name: '',
  parent_id: null,
  org_type: '기관',
  school_level: null,
  address: '',
  latitude: null,
  longitude: null,
  edu_office_code: '',
  school_code: '',
})
const form = ref(emptyForm())

const uploadFile = ref(null)
const uploadResult = ref(null)
/** 올리는 중의 진행률. 0~1, 서버가 읽는 동안에는 null(흐르는 띠). */
const uploadProgress = ref(0)

const isSchool = computed(() => form.value.org_type === '학교')

// 서버가 저장하는 값은 한국어 코드다. 화면 표시만 번역한다.
const ORG_TYPES = ['기관', '학교', '부설기관', '기타']
const SCHOOL_LEVELS = ['초', '중', '고']

/**
 * 트리를 다시 읽는다.
 *
 * `focusId` 는 다시 읽은 뒤 고를 기관. 기본값은 지금 고른 기관이다 — 트리를
 * 새로 받으면 노드가 새 객체가 되므로, id 로 다시 찾아야 방금 고친 값이
 * 상세와 목록에 반영된다. 그 기관이 사라졌으면 최상위로 물러난다.
 */
async function load(focusId = selected.value?.id ?? null) {
  const script = document.createElement('script')
  script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js' 
  document.head.appendChild(script)
  loading.value = true
  try {
    tree.value = await api.get('/organizations/tree')
    const focused = focusId === null ? null : findNode(tree.value, focusId)
    // 최상위를 미리 골라 둔다. 이제 하위 기관은 목록에만 있으므로,
    // 아무것도 선택되지 않은 화면은 트리를 누르기 전까지 아무것도 못 보여 준다.
    select(focused ?? tree.value[0] ?? null)
  } catch (err) {
    toast.error(err.detail ?? t('org.loadFailed'))
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openCreate() {
  if (!selected.value) {
    toast.error(t('org.selectParentFirst'))
    return
  }
  form.value = { ...emptyForm(), parent_id: selected.value.id }
  formError.value = ''
  dialog.value = 'create'
}

function openEdit() {
  const node = selected.value
  form.value = {
    name: node.name,
    parent_id: node.parent_id,
    org_type: node.org_type,
    school_level: node.school_level,
    address: node.address ?? '',
    latitude: node.latitude,
    longitude: node.longitude,
    edu_office_code: node.edu_office_code ?? '',
    school_code: node.school_code ?? '',
  }
  formError.value = ''
  dialog.value = 'edit'
}

function payload() {
  return {
    name: form.value.name.trim(),
    parent_id: form.value.parent_id,
    org_type: form.value.org_type,
    school_level: isSchool.value ? form.value.school_level : null,
    address: form.value.address.trim() || null,
    latitude: form.value.latitude === '' ? null : form.value.latitude,
    longitude: form.value.longitude === '' ? null : form.value.longitude,
    edu_office_code: form.value.edu_office_code.trim() || null,
    school_code: form.value.school_code.trim() || null,
  }
}

async function save() {
  formError.value = ''
  busy.value = true
  try {
    if (dialog.value === 'create') {
      const created = await api.post('/organizations', payload())
      toast.success(t('org.created', { name: created.name }))
    } else {
      await api.put(`/organizations/${selected.value.id}`, payload())
      toast.success(t('org.updated'))
    }
    dialog.value = null
    await load()
  } catch (err) {
    formError.value = err.detail ?? t('org.saveFailed')
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!confirm(t('org.confirmDelete', { name: selected.value.name }))) return
  const parentId = selected.value.parent_id
  try {
    await api.delete(`/organizations/${selected.value.id}`)
    toast.success(t('org.deleted'))
    // 지운 기관의 상위로 올라간다. 방금 지운 항목이 빠진 목록이 바로 보인다.
    await load(parentId)
  } catch (err) {
    toast.error(err.detail ?? t('org.deleteFailed'))
  }
}

function openUpload() {
  if (!selected.value) {
    toast.error(t('org.selectParentForUpload'))
    return
  }
  uploadFile.value = null
  uploadResult.value = null
  formError.value = ''
  dialog.value = 'upload'
}

async function upload() {
  if (!uploadFile.value) {
    formError.value = t('org.upload.selectFile')
    return
  }
  busy.value = true
  formError.value = ''
  try {
    const data = new FormData()
    data.append('file', uploadFile.value)
    // 수백 줄짜리 엑셀은 보내는 데도, 서버가 읽는 데도 시간이 걸린다.
    // 아무 말 없이 기다리게 하면 멈춘 줄 알고 다시 누른다.
    uploadProgress.value = 0
    uploadResult.value = await api.upload(
      '/organizations/bulk-upload',
      data,
      { parent_id: selected.value.id },
      {
        onProgress: (ratio) => {
          // 다 보낸 뒤에도 서버가 줄을 읽는 시간이 남는다. 그때는 '얼마나'
          // 를 모르므로 흐르는 띠로 바꾼다.
          uploadProgress.value = ratio != null && ratio < 1 ? ratio : null
        },
      },
    )
    await load()
  } catch (err) {
    formError.value = err.detail ?? t('org.upload.failed')
  } finally {
    busy.value = false
    uploadProgress.value = 0
  }
}

/**
 * 주소검색 API 연동 지점(요구사항: 기관주소입력은 주소검색API를 사용한다).
 * 실제 연동 시 다음 스크립트를 index.html 에 넣고 이 함수 본문을 교체한다.
 *   <script src="//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js">
 */
function searchAddress() {
    var width = 500; 
    var height = 772;
    // 모니터 화면 중앙 좌표 계산
  if (typeof window.daum?.Postcode === 'function') {
    new window.daum.Postcode({
      width: width, //생성자에 크기 값을 명시적으로 지정해야 합니다.
      height: height,
      oncomplete: (result) => {
        form.value.address = result.roadAddress || result.jibunAddress
      },
    }).open({
      left: (window.screen.width / 2) - (width / 2),
      top: (window.screen.height / 2) - (height / 2)
    })
    return
  }
  toast.push(t('org.addressApiMissing'), 'info')
}
</script>

<template>
  <div>
    <h1 class="page-title">{{ t('org.title') }}</h1>
    <p class="page-desc">{{ t('org.desc') }}</p>

    <div class="layout">
      <section class="card tree-panel">
        <div class="card-header">
          <h2>{{ t('org.tree') }}</h2>
          <button class="btn btn-sm" :disabled="loading" @click="load()">
            {{ t('common.refresh') }}
          </button>
        </div>
        <div class="tree-body">
          <p v-if="loading" class="muted pad">{{ t('common.loading') }}</p>
          <p v-else-if="treeNodes.length === 0" class="muted pad">{{ t('org.noneVisible') }}</p>
          <OrgTree
            v-else
            :nodes="treeNodes"
            :selected-id="selected?.id ?? null"
            @select="selectById($event.id)"
          />
        </div>
        <p class="hint tree-note">{{ t('org.treeBranchOnly') }}</p>
      </section>

      <section class="card detail-panel">
        <div class="card-header">
          <div class="head-main">
            <!-- 목록에서 고른 기관은 트리에 없다. 지금 어디인지 알려 준다. -->
            <nav v-if="crumbs.length > 1" class="crumbs">
              <template v-for="(crumb, index) in crumbs" :key="crumb.id">
                <button
                  class="crumb"
                  :disabled="crumb.id === selected.id"
                  @click="select(crumb)"
                >
                  {{ crumb.name }}
                </button>
                <span v-if="index < crumbs.length - 1" class="crumb-sep" aria-hidden="true">›</span>
              </template>
            </nav>
            <h2>{{ selected ? selected.name : t('org.select') }}</h2>
          </div>
          <div class="row row-wrap">
            <button class="btn btn-sm" :disabled="!selected" @click="openCreate">
              {{ t('org.addChild') }}
            </button>
            <button class="btn btn-sm" :disabled="!selected" @click="openUpload">
              {{ t('org.bulkUpload') }}
            </button>
            <button class="btn btn-sm" :disabled="!selected" @click="openEdit">
              {{ t('common.edit') }}
            </button>
            <button
              class="btn btn-sm btn-danger"
              :disabled="!selected || selected.parent_id === null"
              :title="selected && selected.parent_id === null ? t('org.rootDeleteBlocked') : null"
              @click="remove"
            >
              {{ t('common.delete') }}
            </button>
          </div>
        </div>

        <div class="card-body">
          <p v-if="!selected" class="muted">{{ t('org.selectFirst') }}</p>
          <details v-else class="detail-fold" open>
            <summary>{{ t('org.detailTitle') }}</summary>
            <dl class="detail">
              <div>
                <dt>{{ t('org.name') }}</dt>
                <dd>{{ selected.name }}</dd>
              </div>
              <div>
                <dt>{{ t('org.orgType') }}</dt>
                <dd>{{ t(`enums.orgType.${selected.org_type}`) }}</dd>
              </div>
              <div v-if="selected.school_level">
                <dt>{{ t('org.schoolLevel') }}</dt>
                <dd>{{ t(`enums.schoolLevel.${selected.school_level}`) }}</dd>
              </div>
              <div>
                <dt>{{ t('org.address') }}</dt>
                <dd>{{ selected.address ?? '-' }}</dd>
              </div>
              <div>
                <dt>{{ t('org.coordinates') }}</dt>
                <dd>
                  <span v-if="selected.latitude != null">
                    {{ selected.latitude }}, {{ selected.longitude }}
                  </span>
                  <span v-else class="muted">{{ t('org.coordinatesMissing') }}</span>
                </dd>
              </div>
              <div>
                <dt>{{ t('org.eduOfficeCode') }}</dt>
                <dd class="mono">{{ selected.edu_office_code ?? '-' }}</dd>
              </div>
              <div>
                <dt>{{ t('org.schoolCode') }}</dt>
                <dd class="mono">{{ selected.school_code ?? '-' }}</dd>
              </div>
              <div>
                <dt>{{ t('org.parent') }}</dt>
                <dd>
                  <span v-if="selected.parent_id === null" class="badge badge-primary">
                    {{ t('org.rootBadge') }}
                  </span>
                  <span v-if="selected.parent_id === null" class="hint root-note">
                    {{ t('org.rootEditable') }}
                  </span>
                  <button v-else-if="parentOrg" class="crumb" @click="select(parentOrg)">
                    {{ parentOrg.name }}
                  </button>
                  <span v-else>#{{ selected.parent_id }}</span>
                </dd>
              </div>
              <div>
                <dt>{{ t('org.childCount') }}</dt>
                <dd>{{ children.length }}</dd>
              </div>
            </dl>
          </details>
        </div>

        <!--
          하위 기관 목록. 트리에서 뺀 잎 기관들이 여기로 온다.
          위의 기관 정보를 읽고 그 아래로 내려가는 순서다.
        -->
        <div v-if="selected" class="children">
          <div class="children-head">
            <h3>
              {{ t('org.children') }}
              <span class="muted">{{ children.length }}</span>
            </h3>
            <input
              v-if="children.length > 5"
              v-model="childQuery"
              class="input child-search"
              type="search"
              :placeholder="t('org.searchChildren')"
            />
          </div>

          <p v-if="children.length === 0" class="muted pad">
            {{ t('org.noChildren') }}
          </p>
          <p v-else-if="visibleChildren.length === 0" class="muted pad">
            {{ t('org.searchNoMatch') }}
          </p>
          <div v-else class="child-scroll">
            <table class="table child-table">
              <thead>
                <tr>
                  <th>{{ t('org.name') }}</th>
                  <th>{{ t('org.orgType') }}</th>
                  <th>{{ t('org.address') }}</th>
                  <th class="num">{{ t('org.childCount') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="child in visibleChildren"
                  :key="child.id"
                  class="child-row"
                  @click="select(child)"
                >
                  <td>
                    <button class="child-name" @click.stop="select(child)">{{ child.name }}</button>
                    <span v-if="child.school_level" class="badge badge-muted">
                      {{ t(`enums.schoolLevel.${child.school_level}`) }}
                    </span>
                  </td>
                  <td>{{ t(`enums.orgType.${child.org_type}`) }}</td>
                  <td class="muted">{{ child.address ?? '-' }}</td>
                  <td class="num">{{ child.children.length }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <!-- 기관 등록/수정 -->
    <ModalDialog
      v-if="dialog === 'create' || dialog === 'edit'"
      :title="dialog === 'create' ? t('org.createTitle') : t('org.editTitle')"
      :busy="busy"
      width="560px"
      @close="dialog = null"
      @confirm="save"
    >
      <div class="field">
        <label>{{ t('org.name') }}</label>
        <input v-model="form.name" class="input" required />
      </div>

      <div class="grid-2">
        <div class="field">
          <label>{{ t('org.orgType') }}</label>
          <select v-model="form.org_type" class="select">
            <option v-for="value in ORG_TYPES" :key="value" :value="value">
              {{ t(`enums.orgType.${value}`) }}
            </option>
          </select>
        </div>
        <div class="field">
          <label>{{ t('org.schoolLevel') }}</label>
          <select v-model="form.school_level" class="select" :disabled="!isSchool">
            <option :value="null">{{ t('org.notApplicable') }}</option>
            <option v-for="value in SCHOOL_LEVELS" :key="value" :value="value">
              {{ t(`enums.schoolLevel.${value}`) }}
            </option>
          </select>
        </div>
      </div>

      <div class="field">
        <label>{{ t('org.address') }}</label>
        <div class="row">
          <input v-model="form.address" class="input" />
          <button class="btn" type="button" @click="searchAddress">
            {{ t('org.searchAddress') }}
          </button>
        </div>
      </div>

      <div class="grid-2">
        <div class="field">
          <label>{{ t('org.latitude') }}</label>
          <input v-model.number="form.latitude" class="input" type="number" step="0.000001" />
        </div>
        <div class="field">
          <label>{{ t('org.longitude') }}</label>
          <input v-model.number="form.longitude" class="input" type="number" step="0.000001" />
        </div>
      </div>

      <div class="grid-2">
        <div class="field">
          <label>{{ t('org.eduOfficeCode') }}</label>
          <input v-model="form.edu_office_code" class="input" />
        </div>
        <div class="field">
          <label>{{ t('org.schoolCode') }}</label>
          <input v-model="form.school_code" class="input" />
        </div>
      </div>

      <p v-if="formError" class="error-text">{{ formError }}</p>
    </ModalDialog>

    <!-- 엑셀 일괄 등록 -->
    <ModalDialog
      v-if="dialog === 'upload'"
      :title="t('org.upload.title')"
      :busy="busy"
      :confirm-label="t('org.upload.submit')"
      @close="dialog = null"
      @confirm="upload"
    >
      <p class="hint">
        <i18n-t keypath="org.upload.under" tag="span">
          <template #name><strong>{{ selected?.name }}</strong></template>
        </i18n-t>
        <br />
        {{ t('org.upload.headers') }}<br />
        {{ t('org.upload.headersNote') }}
      </p>

      <div class="field">
        <label>{{ t('org.upload.file') }}</label>
        <input
          class="input"
          type="file"
          accept=".xlsx"
          @change="uploadFile = $event.target.files[0] ?? null"
        />
      </div>

      <ProgressBar
        v-if="busy"
        :value="uploadProgress"
        :label="uploadFile?.name ?? t('org.upload.submit')"
      />

      <p v-if="TEST_MODE" class="error-text">{{ t('org.upload.testModeNotice') }}</p>

      <div v-if="uploadResult" class="result">
        <p>
          {{
            t('org.upload.result', {
              created: uploadResult.created,
              skipped: uploadResult.skipped,
              errors: uploadResult.errors.length,
            })
          }}
        </p>
        <ul v-if="uploadResult.errors.length" class="errors">
          <li v-for="(message, index) in uploadResult.errors" :key="index">{{ message }}</li>
        </ul>
      </div>

      <p v-if="formError" class="error-text">{{ formError }}</p>
    </ModalDialog>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 18px;
  align-items: start;
}

@media (width <= 900px) {
  .layout {
    grid-template-columns: 1fr;
  }
}

.card-header h2 {
  font-size: 14px;
}

.tree-body {
  padding: 8px;
  max-height: 62vh;
  overflow: auto;
}

.tree-note {
  margin: 0;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
}

.pad {
  padding: 12px;
}

/* ------------------------------------------------- 헤더(빵부스러기 + 이름) */
.head-main {
  min-width: 0;
}

.crumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 3px;
}

.crumb {
  padding: 0;
  border: 0;
  background: none;
  color: var(--primary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.crumb:hover:not(:disabled) {
  text-decoration: underline;
}

.crumb:disabled {
  color: var(--text-muted);
  cursor: default;
}

.crumb-sep {
  color: var(--text-muted);
  font-size: 11px;
}

/* ------------------------------------------------------- 하위 기관 목록 */
.children {
  /* 위쪽 기관 정보와 나누는 선. 카드 안의 두 번째 구역이다. */
  border-top: 1px solid var(--border);
}

.children-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 16px 10px;
}

.children-head h3 {
  margin: 0;
  font-size: 13px;
}

.children-head .muted {
  font-weight: 400;
}

.child-search {
  width: 200px;
  padding: 5px 9px;
  font-size: 12px;
}

/* 학교가 수백 개인 교육청도 있으므로 목록만 따로 스크롤한다. */
.child-scroll {
  max-height: 44vh;
  overflow: auto;
}

.child-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
}

.child-row {
  cursor: pointer;
}

.child-name {
  padding: 0;
  border: 0;
  background: none;
  color: var(--primary);
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.child-name:hover {
  text-decoration: underline;
}

.num {
  text-align: right;
  width: 1%;
  white-space: nowrap;
}

/* --------------------------------------------------------------- 상세 */
.detail-fold > summary {
  cursor: pointer;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  user-select: none;
}

.detail-fold[open] > summary {
  margin-bottom: 6px;
}

.detail {
  margin: 0;
  display: grid;
  gap: 0;
}

.detail > div {
  display: grid;
  grid-template-columns: 150px 1fr;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}

.detail > div:last-child {
  border-bottom: 0;
}

.detail dt {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 600;
}

.detail dd {
  margin: 0;
  font-size: 13px;
}

.root-note {
  display: block;
  margin-top: 3px;
}

.result {
  margin-top: 12px;
  padding: 11px 13px;
  border-radius: var(--radius);
  background: var(--surface-2);
  font-size: 13px;
}

.errors {
  margin: 8px 0 0;
  padding-left: 18px;
  color: var(--danger);
  font-size: 12px;
}
</style>
