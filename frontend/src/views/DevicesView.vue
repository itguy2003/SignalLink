<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import DeviceCollection from '@/components/DeviceCollection.vue'
import DeviceGroupPanel from '@/components/DeviceGroupPanel.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import ViewModeToggle from '@/components/ViewModeToggle.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

const auth = useAuthStore()
const toast = useToastStore()
const { t } = useI18n()

// 서버가 저장하는 값은 한국어/영문 코드다. 표시만 번역한다.
const OS_LIST = ['Windows', 'Android', 'IOS']
const FORM_FACTORS = ['DID형', '키오스크형']
const PANEL_TYPES = ['LANDSCAPE', 'PORTRAIT']
const PLACE_KINDS = ['교실', '기타']
const DEVICE_KINDS = ['일반', '전자칠판']

const page = ref({ items: [], total: 0, page: 1, size: 20 })
const orgs = ref([])
const schedules = ref([])
const loading = ref(false)
const filters = ref({ q: '', org_id: '', unassigned: false })

/** 'devices' | 'groups' */
const tab = ref('devices')

/**
 * 카드/리스트 보기. 두 탭이 함께 쓴다 — 탭을 옮겼다고 보기 방식이 되돌아가면
 * 리스트로 훑던 흐름이 매번 끊긴다. 처음에는 카드다.
 */
const viewMode = ref('card')

/**
 * 통째로 받아 온 목록(그룹 필터·그룹 탭)을 한 번에 그릴 개수.
 *
 * 서버 페이지 크기와 같게 둔다 — 그룹을 걸었다고 한 화면에 담기는 장치 수가
 * 달라지면 같은 화면으로 보이지 않는다.
 */
const CLIENT_PAGE_SIZE = 20
const groupPanelRef = ref(null)

/**
 * 그룹 편집기가 고를 수 있는 후보 장치 전부.
 *
 * 카드 목록은 페이지 단위라 다음 장이 안 보인다. 그룹은 페이지를 넘나들며
 * 묶는 것이므로 후보는 따로 한 번에 읽는다.
 */
const allDevices = ref([])

/** 내가 만든 장치그룹. 필터 콤보와 그룹 탭이 같은 목록을 본다. */
const groups = ref([])

/**
 * 콤보에서 고른 그룹 id. '' 이면 그룹 필터 없음.
 *
 * 화면에 남는 값은 이 id 하나뿐이다. 그룹 객체를 들고 있으면 그룹을 고친 뒤
 * 옛 구성원으로 계속 거르게 된다.
 */
const groupFilterId = ref('')

const groupFilter = computed(
  () => groups.value.find((g) => g.id === groupFilterId.value) ?? null,
)

/**
 * 지금 보여 줄 장치.
 *
 * 그룹을 고르면 그 묶음만 보여 준다. 그룹은 사용자가 직접 고른 유한한
 * 집합이라 서버 페이지네이션을 다시 태우지 않고 `allDevices` 에서 걸러 낸다.
 */
const visibleDevices = computed(() => {
  if (!groupFilter.value) return page.value.items
  const ids = new Set(groupFilter.value.device_ids)
  return allDevices.value.filter((device) => ids.has(device.id))
})

const dialog = ref(null) // 'create' | 'edit' | 'delegate' | null
const busy = ref(false)
const formError = ref('')
const editing = ref(null)
const selectedIds = ref([])
const bulkScheduleIds = ref([])

const emptyForm = () => ({
  org_id: auth.user?.org_id ?? '',
  name: '',
  os: 'Windows',
  form_factor: 'DID형',
  panel_type: 'LANDSCAPE',
  width: 1920,
  height: 1080,
  place_name: '',
  place_kind: '기타',
  device_kind: '일반',
  grade: null,
  class_no: null,
  class_name: '',
  track: '',
  is_master: false,
  cpu: '',
  memory: '',
  storage: '',
  schedule_ids: [],
})
const form = ref(emptyForm())
const delegateTarget = ref(null)
const delegateUserIds = ref([])
const candidateManagers = ref([])

const allSelected = computed(
  () => visibleDevices.value.length > 0 && selectedIds.value.length === visibleDevices.value.length,
)

async function load(pageNumber = page.value.page) {
  loading.value = true
  selectedIds.value = []
  try {
    page.value = await api.get('/devices', {
      q: filters.value.q || undefined,
      org_id: filters.value.org_id || undefined,
      unassigned: filters.value.unassigned || undefined,
      page: pageNumber,
      size: page.value.size,
    })
  } catch (err) {
    toast.error(err.detail ?? t('device.loadFailed'))
  } finally {
    loading.value = false
  }
}

/** 그룹 편집기의 후보 목록. 장치가 늘거나 줄 때만 다시 읽는다. */
async function loadAllDevices() {
  const result = await api.get('/devices', { size: 200 }).catch(() => null)
  if (result) allDevices.value = result.items
}

async function loadGroups() {
  const result = await api.get('/device-groups').catch(() => null)
  if (result) groups.value = result
  // 방금 지운 그룹으로 계속 거르고 있으면 빈 화면만 남는다.
  if (groupFilterId.value && !groups.value.some((g) => g.id === groupFilterId.value)) {
    clearGroupFilter()
  }
}

onMounted(async () => {
  const [orgList, schedulePage] = await Promise.all([
    api.get('/organizations').catch(() => []),
    api.get('/schedules', { size: 200 }).catch(() => ({ items: [] })),
  ])
  orgs.value = orgList
  schedules.value = schedulePage.items
  await load(1)
  await loadAllDevices()
  await loadGroups()
})

function clearGroupFilter() {
  groupFilterId.value = ''
  selectedIds.value = []
}

/** 콤보로 그룹을 바꾸면 이전 선택은 의미가 없다. */
function onGroupFilterChange() {
  selectedIds.value = []
}

/** 지금 고른 장치로 새 그룹을 만든다. 카드에서 이미 골라 둔 것을 그대로 쓴다. */
async function createGroupFromSelection() {
  const ids = [...selectedIds.value]
  tab.value = 'groups'
  await nextTick()
  groupPanelRef.value?.openCreate(ids)
}

function openCreate() {
  editing.value = null
  form.value = emptyForm()
  formError.value = ''
  dialog.value = 'create'
}

function openEdit(device) {
  editing.value = device
  form.value = { ...emptyForm(), ...device }
  formError.value = ''
  dialog.value = 'edit'
}

function payload() {
  const data = { ...form.value }
  data.org_id = Number(data.org_id)
  for (const key of ['place_name', 'class_name', 'track', 'cpu', 'memory', 'storage']) {
    data[key] = (data[key] ?? '').toString().trim() || null
  }
  // 서버가 자동 생성하는 값이므로 보내지 않는다.
  delete data.device_code
  delete data.id
  delete data.version
  delete data.last_seen_at
  delete data.app_version
  delete data.online
  delete data.org_name
  delete data.schedules
  return data
}

async function save() {
  busy.value = true
  formError.value = ''
  try {
    if (dialog.value === 'create') {
      const created = await api.post('/devices', payload())
      toast.success(t('device.created', { code: created.device_code }))
    } else {
      const data = payload()
      delete data.org_id // 소속기관 변경은 지원하지 않는다.
      await api.put(`/devices/${editing.value.id}`, data)
      toast.success(t('device.updated'))
    }
    dialog.value = null
    await load()
    await loadAllDevices()
  } catch (err) {
    formError.value = err.detail ?? t('org.saveFailed')
  } finally {
    busy.value = false
  }
}

async function remove(device) {
  if (!confirm(t('device.confirmDelete', { name: device.name }))) return
  try {
    await api.delete(`/devices/${device.id}`)
    toast.success(t('device.deleted'))
    await load()
    await loadAllDevices()
  } catch (err) {
    toast.error(err.detail ?? t('org.deleteFailed'))
  }
}

async function assignSchedule(device, scheduleIds) {
  try {
    await api.put(`/devices/${device.id}/schedules`, { schedule_ids: scheduleIds })
    toast.success(
      scheduleIds.length === 0 ? t('device.scheduleCleared') : t('device.scheduleAssigned'),
    )
    // 그룹 탭도 같은 장치를 그리므로 두 목록을 함께 갱신한다.
    await load()
    await loadAllDevices()
  } catch (err) {
    toast.error(err.detail ?? t('device.assignFailed'))
  }
}

async function bulkAssign() {
  if (selectedIds.value.length === 0) {
    toast.error(t('device.selectDevicesFirst'))
    return
  }
  try {
    const result = await api.post('/devices/schedule/bulk', {
      device_ids: selectedIds.value,
      schedule_ids: bulkScheduleIds.value.map(Number),
    })
    toast.success(result.detail)
    await load()
  } catch (err) {
    toast.error(err.detail ?? t('device.bulkFailed'))
  }
}

async function openDelegate(device) {
  delegateTarget.value = device
  formError.value = ''
  try {
    const [current, users] = await Promise.all([
      api.get(`/devices/${device.id}/managers`),
      api.get('/users', { role: 'DEVICE_MANAGER', size: 200 }),
    ])
    delegateUserIds.value = current.map((u) => u.id)
    candidateManagers.value = users.items
    dialog.value = 'delegate'
  } catch (err) {
    toast.error(err.detail ?? t('device.delegateLoadFailed'))
  }
}

async function saveDelegate() {
  busy.value = true
  formError.value = ''
  try {
    const result = await api.put(`/devices/${delegateTarget.value.id}/managers`, {
      user_ids: delegateUserIds.value,
    })
    toast.success(result.detail)
    dialog.value = null
  } catch (err) {
    formError.value = err.detail ?? t('device.delegateFailed')
  } finally {
    busy.value = false
  }
}

async function sendCommand(device, command) {
  try {
    const result = await api.post(`/devices/${device.id}/command`, undefined, { command })
    toast.success(result.detail)
    return true
  } catch (err) {
    toast.error(err.detail ?? t('device.commandFailed'))
    return false
  }
}

/**
 * 카드가 요청한 제어 명령.
 *
 * 카드는 성공 여부를 알아야 다음 단계를 정한다(미리보기는 보낸 뒤 캡처를
 * 기다린다). 그래서 결과를 resolve 로 돌려준다.
 */
async function onCardCommand({ device, command, resolve }) {
  resolve(await sendCommand(device, command))
}

/**
 * 카드가 요청한 한 장치 새로고침.
 *
 * 목록 전체를 다시 읽으면 다른 카드의 이미지까지 전부 새로 받는다.
 * 바뀐 장치 한 건만 갈아 끼운다.
 */
async function onCardRefresh({ device, resolve }) {
  try {
    const fresh = await api.get(`/devices/${device.id}`)
    // 두 목록 모두에 반영한다. 장치 탭은 page, 그룹 탭은 allDevices 를 그린다.
    replaceDevice(page.value.items, fresh)
    replaceDevice(allDevices.value, fresh)
    resolve(fresh)
  } catch {
    resolve(null)
  }
}

function replaceDevice(list, fresh) {
  const index = list.findIndex((d) => d.id === fresh.id)
  if (index >= 0) list[index] = fresh
}

function toggleAll(event) {
  selectedIds.value = event.target.checked ? visibleDevices.value.map((d) => d.id) : []
}

function toggleOne(id) {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((x) => x !== id)
    : [...selectedIds.value, id]
}

function toggleDelegateUser(id) {
  delegateUserIds.value = delegateUserIds.value.includes(id)
    ? delegateUserIds.value.filter((x) => x !== id)
    : [...delegateUserIds.value, id]
}
</script>

<template>
  <div>
    <h1 class="page-title">{{ t('device.title') }}</h1>
    <p class="page-desc">{{ t('device.desc') }}</p>

    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'devices' }" @click="tab = 'devices'">
        {{ t('device.tabDevices') }}
      </button>
      <button class="tab" :class="{ active: tab === 'groups' }" @click="tab = 'groups'">
        {{ t('device.tabGroups') }}
      </button>
    </div>

    <!--
      그룹 탭도 장치 탭과 같은 카드를 그린다. 스케줄 배정·제어 명령·삭제를
      여기서 따로 구현하지 않고 같은 처리기로 보내야, 같은 버튼이 탭마다
      다르게 동작하는 일이 생기지 않는다.
    -->
    <DeviceGroupPanel
      v-if="tab === 'groups'"
      ref="groupPanelRef"
      v-model:mode="viewMode"
      :groups="groups"
      :devices="allDevices"
      :schedules="schedules"
      :page-size="CLIENT_PAGE_SIZE"
      :can-manage="auth.can.manageDevices"
      :can-create="auth.can.createDevices"
      @changed="loadGroups"
      @edit="openEdit"
      @delegate="openDelegate"
      @remove="remove"
      @assign="assignSchedule($event.device, $event.scheduleIds)"
      @command="onCardCommand"
      @refresh="onCardRefresh"
    />

    <section v-else class="card">
      <div class="card-header">
        <div class="row row-wrap">
          <input
            v-model="filters.q"
            class="input filter-input"
            :placeholder="t('device.searchPlaceholder')"
            @keyup.enter="load(1)"
          />
          <select v-model="filters.org_id" class="select filter-select" @change="load(1)">
            <option value="">{{ t('device.allOrgs') }}</option>
            <option v-for="org in orgs" :key="org.id" :value="org.id">{{ org.name }}</option>
          </select>
          <!-- 고른 그룹의 장치만 보여 준다. 서버 조회가 아니라 이미 읽어 둔 목록에서 거른다. -->
          <select
            v-model="groupFilterId"
            class="select filter-select"
            @change="onGroupFilterChange"
          >
            <option value="">{{ t('group.allGroups') }}</option>
            <option v-for="group in groups" :key="group.id" :value="group.id">
              {{ group.name }}
            </option>
          </select>
          <label class="check">
            <input v-model="filters.unassigned" type="checkbox" @change="load(1)" />
            {{ t('device.unassignedOnly') }}
          </label>
          <button class="btn" @click="load(1)">{{ t('common.search') }}</button>
        </div>
        <div class="row">
          <ViewModeToggle v-model="viewMode" />
          <button v-if="auth.can.createDevices" class="btn btn-primary" @click="openCreate">
            {{ t('device.createButton') }}
          </button>
        </div>
      </div>

      <div v-if="selectedIds.length" class="bulkbar">
        <strong>{{ t('device.selectedCount', { count: selectedIds.length }) }}</strong>
        <!-- 여러 개를 고르면 그 순서가 우선순위가 된다. 아무것도 안 고르면 해제. -->
        <select v-model="bulkScheduleIds" class="select filter-select" multiple size="3">
          <option v-for="schedule in schedules" :key="schedule.id" :value="schedule.id">
            {{ schedule.name }}
          </option>
        </select>
        <button class="btn btn-sm btn-primary" @click="bulkAssign">
          {{ t('device.bulkAssign') }}
        </button>
        <!-- 이미 골라 둔 것을 그대로 쓴다. 그룹 편집기에서 다시 고르게 하면 헛일이다. -->
        <button class="btn btn-sm" @click="createGroupFromSelection">
          {{ t('group.createFromSelection') }}
        </button>
      </div>

      <!-- 그룹 탭에서 넘어온 상태. 어떤 묶음을 보고 있는지 알려 주고 빠져나갈 길을 둔다. -->
      <div v-if="groupFilter" class="groupbar">
        <strong>{{ t('group.filtering', { name: groupFilter.name }) }}</strong>
        <div class="spacer" />
        <button class="btn btn-sm" @click="clearGroupFilter">{{ t('group.clearFilter') }}</button>
      </div>

      <div class="select-all">
        <label class="check">
          <input type="checkbox" :checked="allSelected" @change="toggleAll" />
          {{ t('device.selectAll') }}
        </label>
      </div>

      <p v-if="loading" class="muted pad">{{ t('common.loading') }}</p>
      <p v-else-if="visibleDevices.length === 0" class="table-empty">{{ t('device.empty') }}</p>

      <!-- 장치그룹 탭과 같은 컴포넌트다. 그리는 곳이 하나뿐이면 정보가 어긋날 수 없다. -->
      <DeviceCollection
        v-else
        :devices="visibleDevices"
        :schedules="schedules"
        :mode="viewMode"
        :selected-ids="selectedIds"
        :page-size="groupFilter ? CLIENT_PAGE_SIZE : 0"
        :can-manage="auth.can.manageDevices"
        :can-create="auth.can.createDevices"
        @toggle="toggleOne"
        @edit="openEdit"
        @delegate="openDelegate"
        @remove="remove"
        @assign="assignSchedule($event.device, $event.scheduleIds)"
        @command="onCardCommand"
        @refresh="onCardRefresh"
      />

      <div v-if="!groupFilter" class="pager">
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
        <span class="muted">{{ t('common.totalDevices', { count: page.total }) }}</span>
      </div>
    </section>

    <!-- 장치 등록/수정 -->
    <ModalDialog
      v-if="dialog === 'create' || dialog === 'edit'"
      :title="dialog === 'create' ? t('device.createTitle') : t('device.editTitle')"
      :busy="busy"
      width="620px"
      @close="dialog = null"
      @confirm="save"
    >
      <div v-if="dialog === 'edit'" class="code-box">
        {{ t('device.codeNotice') }} <strong class="mono">{{ editing.device_code }}</strong>
        <span class="hint">{{ t('device.codeReadonly') }}</span>
      </div>

      <div class="grid-2">
        <div class="field">
          <label>{{ t('device.name') }}</label>
          <input v-model="form.name" class="input" />
        </div>
        <div class="field">
          <label>{{ t('device.installOrg') }}</label>
          <select v-model="form.org_id" class="select" :disabled="dialog === 'edit'">
            <option v-for="org in orgs" :key="org.id" :value="org.id">{{ org.name }}</option>
          </select>
        </div>
      </div>

      <div class="grid-2">
        <div class="field">
          <label>{{ t('device.os') }}</label>
          <select v-model="form.os" class="select">
            <option v-for="value in OS_LIST" :key="value" :value="value">
              {{ t(`enums.os.${value}`) }}
            </option>
          </select>
        </div>
        <div class="field">
          <label>{{ t('device.formFactor') }}</label>
          <select v-model="form.form_factor" class="select">
            <option v-for="value in FORM_FACTORS" :key="value" :value="value">
              {{ t(`enums.formFactor.${value}`) }}
            </option>
          </select>
        </div>
      </div>

      <div class="grid-2">
        <div class="field">
          <label>{{ t('device.orientation') }}</label>
          <select v-model="form.panel_type" class="select">
            <option v-for="value in PANEL_TYPES" :key="value" :value="value">
              {{ t(`enums.panelType.${value}`) }}
            </option>
          </select>
        </div>
        <div class="field">
          <label>{{ t('device.deviceKind') }}</label>
          <select v-model="form.device_kind" class="select">
            <option v-for="value in DEVICE_KINDS" :key="value" :value="value">
              {{ t(`enums.deviceKind.${value}`) }}
            </option>
          </select>
        </div>
      </div>

      <div class="grid-2">
        <div class="field">
          <label>{{ t('device.widthRes') }}</label>
          <input v-model.number="form.width" class="input" type="number" />
        </div>
        <div class="field">
          <label>{{ t('device.heightRes') }}</label>
          <input v-model.number="form.height" class="input" type="number" />
        </div>
      </div>

      <div class="grid-2">
        <div class="field">
          <label>{{ t('device.placeName') }}</label>
          <input v-model="form.place_name" class="input" />
        </div>
        <div class="field">
          <label>{{ t('device.placeKind') }}</label>
          <select v-model="form.place_kind" class="select">
            <option v-for="value in PLACE_KINDS" :key="value" :value="value">
              {{ t(`enums.placeKind.${value}`) }}
            </option>
          </select>
        </div>
      </div>

      <div class="grid-3">
        <div class="field">
          <label>{{ t('device.grade') }}</label>
          <input v-model.number="form.grade" class="input" type="number" min="1" max="12" />
        </div>
        <div class="field">
          <label>{{ t('device.classNo') }}</label>
          <input v-model.number="form.class_no" class="input" type="number" min="1" max="99" />
        </div>
        <div class="field">
          <label>{{ t('device.className') }}</label>
          <input v-model="form.class_name" class="input" />
        </div>
      </div>

      <div class="grid-3">
        <div class="field">
          <label>{{ t('device.cpu') }}</label>
          <input v-model="form.cpu" class="input" />
        </div>
        <div class="field">
          <label>{{ t('device.memory') }}</label>
          <input v-model="form.memory" class="input" placeholder="8GB" />
        </div>
        <div class="field">
          <label>{{ t('device.storage') }}</label>
          <input v-model="form.storage" class="input" placeholder="256GB" />
        </div>
      </div>

      <div class="field">
        <label class="check">
          <input v-model="form.is_master" type="checkbox" />
          {{ t('device.isMaster') }}
        </label>
      </div>

      <p v-if="formError" class="error-text">{{ formError }}</p>
    </ModalDialog>

    <!-- 장치 관리 위임 -->
    <ModalDialog
      v-if="dialog === 'delegate'"
      :title="t('device.delegateTitle')"
      :busy="busy"
      :confirm-label="t('device.delegateSave')"
      @close="dialog = null"
      @confirm="saveDelegate"
    >
      <p class="hint">
        <i18n-t keypath="device.delegateDesc" tag="span">
          <template #name><strong>{{ delegateTarget?.name }}</strong></template>
        </i18n-t>
      </p>

      <p v-if="candidateManagers.length === 0" class="muted">{{ t('device.delegateEmpty') }}</p>

      <ul v-else class="managers">
        <li v-for="user in candidateManagers" :key="user.id">
          <label class="check">
            <input
              type="checkbox"
              :checked="delegateUserIds.includes(user.id)"
              @change="toggleDelegateUser(user.id)"
            />
            {{ user.name }} <span class="muted mono">({{ user.user_id }})</span>
            <span class="muted"> · {{ user.org_name }}</span>
          </label>
        </li>
      </ul>

      <p v-if="formError" class="error-text">{{ formError }}</p>
    </ModalDialog>
  </div>
</template>

<style scoped>
.filter-input {
  width: 220px;
}

.filter-select {
  width: 170px;
}

.check {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  white-space: nowrap;
}

/* 카드 폭 하한을 300px 로 둔다. 이보다 좁으면 제어 버튼 네 개가 두 줄로 접힌다. */
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
  padding: 14px 16px;
}

.select-all {
  padding: 10px 16px 0;
  font-size: 12px;
}

.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--border);
}

.tab {
  padding: 8px 16px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.tab:hover {
  color: var(--text);
}

.tab.active {
  border-bottom-color: var(--primary);
  color: var(--primary);
}

/* 벌크바와 같은 자리에 오지만 성격이 다르다(선택이 아니라 걸린 필터). */
.groupbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 16px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}

.pad {
  padding: 16px;
}

.bulkbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: var(--primary-soft);
  border-bottom: 1px solid var(--primary-border);
  font-size: 13px;
}

.pager {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}

.grid-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0 14px;
}

.code-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 16px;
  border-radius: var(--radius);
  background: var(--surface-2);
  font-size: 13px;
}

.managers {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
