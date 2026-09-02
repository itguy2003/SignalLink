<script setup>
/**
 * 장치그룹 관리.
 *
 * 그룹을 하나 골라 **그 그룹에 담긴 장치만** 보여 준다. 여러 그룹을 한꺼번에
 * 펼치지 않는 이유는, 같은 장치가 여러 그룹에 담길 수 있어 같은 카드가 화면에
 * 여러 번 나오기 때문이다.
 *
 * 장치는 장치 탭과 **같은 컴포넌트**(DeviceCollection)로 그린다. 그리는 곳이
 * 하나뿐이면 두 탭의 정보가 어긋날 수가 없다.
 *
 * 장치그룹은 **사용자 개인의** 묶음이다(서버가 소유자로 걸러 준다). 담을 수
 * 있는 장치는 그 사용자가 볼 수 있는 장치뿐이며, 최종 판정은 서버가 한다.
 */
import { computed, ref, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import DeviceCollection from '@/components/DeviceCollection.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import ViewModeToggle from '@/components/ViewModeToggle.vue'
import { useToastStore } from '@/stores/toast'

const props = defineProps({
  /** 내가 만든 그룹들. 콤보에도 쓰이므로 부모가 들고 있다. */
  groups: { type: Array, default: () => [] },
  /** 그룹에 담을 후보 장치. 부모가 이미 읽어 둔 목록을 그대로 쓴다. */
  devices: { type: Array, default: () => [] },
  schedules: { type: Array, default: () => [] },
  /** 'card' | 'list' — 장치 탭과 공유하는 보기 방식. */
  mode: { type: String, default: 'card' },
  /** 한 번에 그릴 개수. 그룹 하나에 수십 대가 들어 있을 수 있다. */
  pageSize: { type: Number, default: 0 },
  canManage: { type: Boolean, default: false },
  canCreate: { type: Boolean, default: false },
})

/**
 * `changed` 는 그룹이 늘거나 줄거나 바뀌었다는 뜻이다. 부모가 다시 읽어
 * 콤보와 목록을 함께 맞춘다 — 두 곳이 각자 읽으면 어긋난다.
 */
const emit = defineEmits([
  'changed',
  'update:mode',
  // 장치 카드가 올리는 것을 그대로 위로 넘긴다. 처리는 장치 관리 화면이 맡는다.
  'edit',
  'delegate',
  'remove',
  'assign',
  'command',
  'refresh',
])

const toast = useToastStore()
const { t } = useI18n()

const dialog = ref(false)
const busy = ref(false)
const formError = ref('')
const editing = ref(null)
const form = ref({ name: '', device_ids: [] })
const pickerQuery = ref('')

/**
 * 고른 그룹의 id. 그룹 객체가 아니라 id 를 들고 있어야, 그룹을 고친 뒤에도
 * 옛 구성원으로 계속 그리지 않는다.
 */
const selectedId = ref(null)

const selected = computed(
  () => props.groups.find((g) => g.id === selectedId.value) ?? null,
)

// 처음 열었거나 고른 그룹이 사라졌으면 첫 번째 그룹으로 맞춘다.
watchEffect(() => {
  if (props.groups.length === 0) {
    selectedId.value = null
    return
  }
  if (!props.groups.some((g) => g.id === selectedId.value)) {
    selectedId.value = props.groups[0].id
  }
})

const byId = computed(() => new Map(props.devices.map((d) => [d.id, d])))

const pickable = computed(() => {
  const keyword = pickerQuery.value.trim().toLowerCase()
  if (!keyword) return props.devices
  return props.devices.filter(
    (device) =>
      device.name.toLowerCase().includes(keyword) ||
      device.device_code.toLowerCase().includes(keyword) ||
      (device.place_name ?? '').toLowerCase().includes(keyword),
  )
})

function openCreate(deviceIds = []) {
  editing.value = null
  form.value = { name: '', device_ids: [...deviceIds] }
  pickerQuery.value = ''
  formError.value = ''
  dialog.value = true
}

function openEdit(group) {
  editing.value = group
  form.value = { name: group.name, device_ids: [...group.device_ids] }
  pickerQuery.value = ''
  formError.value = ''
  dialog.value = true
}

function toggleDevice(id) {
  form.value.device_ids = form.value.device_ids.includes(id)
    ? form.value.device_ids.filter((x) => x !== id)
    : [...form.value.device_ids, id]
}

async function save() {
  const name = form.value.name.trim()
  if (!name) {
    formError.value = t('group.nameRequired')
    return
  }
  busy.value = true
  formError.value = ''
  try {
    const body = { name, device_ids: form.value.device_ids }
    if (editing.value) {
      await api.put(`/device-groups/${editing.value.id}`, body)
      toast.success(t('group.updated'))
    } else {
      await api.post('/device-groups', body)
      toast.success(t('group.created', { name }))
    }
    dialog.value = false
    emit('changed')
  } catch (err) {
    formError.value = err.detail ?? t('org.saveFailed')
  } finally {
    busy.value = false
  }
}

async function remove(group) {
  // 그룹은 묶음일 뿐이라 지워도 장치는 남는다. 그 점을 확인 문구에 적는다.
  if (!confirm(t('group.confirmDelete', { name: group.name }))) return
  try {
    await api.delete(`/device-groups/${group.id}`)
    toast.success(t('group.deleted'))
    emit('changed')
  } catch (err) {
    toast.error(err.detail ?? t('org.deleteFailed'))
  }
}

/** 그룹에 담긴 장치 중 접속 중인 수. 그룹 단위로 상태를 가늠하는 데 쓴다. */
function onlineCount(group) {
  return group.device_ids.filter((id) => byId.value.get(id)?.online).length
}

/**
 * 그룹에 담긴 실제 장치 객체들.
 *
 * `device_ids` 에는 후보 목록에 없는 id 가 남을 수 있다(다른 페이지의 장치를
 * 아직 못 읽었거나, 방금 지워졌거나). 그런 id 는 그릴 수 없으므로 걸러 낸다.
 */
function members(group) {
  return group.device_ids.map((id) => byId.value.get(id)).filter(Boolean)
}



defineExpose({ openCreate })
</script>

<template>
  <section class="card">
    <div class="card-header">
      <div class="row row-wrap">
        <!-- 한 번에 한 그룹만 본다. 같은 장치가 여러 그룹에 담길 수 있어서다. -->
        <select v-model="selectedId" class="select group-select" :disabled="groups.length === 0">
          <option v-if="groups.length === 0" :value="null">{{ t('group.empty') }}</option>
          <option v-for="group in groups" :key="group.id" :value="group.id">
            {{ group.name }}
          </option>
        </select>

        <template v-if="selected">
          <span class="badge badge-muted">
            {{ t('group.deviceCount', { count: selected.device_ids.length }) }}
          </span>
          <span v-if="onlineCount(selected)" class="badge badge-success">
            {{ t('group.onlineCount', { count: onlineCount(selected) }) }}
          </span>
          <button class="btn btn-sm" @click="openEdit(selected)">{{ t('common.edit') }}</button>
          <button class="btn btn-sm btn-danger" @click="remove(selected)">
            {{ t('common.delete') }}
          </button>
        </template>
      </div>

      <div class="row">
        <ViewModeToggle
          :model-value="mode"
          @update:model-value="emit('update:mode', $event)"
        />
        <button class="btn btn-primary" @click="openCreate()">
          {{ t('group.createButton') }}
        </button>
      </div>
    </div>

    <p class="hint pad">{{ t('group.desc') }}</p>

    <p v-if="groups.length === 0" class="table-empty">{{ t('group.empty') }}</p>
    <p v-else-if="members(selected).length === 0" class="table-empty">
      {{ t('group.noMembers') }}
    </p>

    <!--
      장치 탭과 같은 컴포넌트를 쓴다. 선택 체크박스만 뺀다 — 일괄 배정 도구는
      장치 탭에 있어서, 여기서 고르면 골라 놓고 아무것도 못 하는 상태가 된다.
    -->
    <DeviceCollection
      v-else
      :devices="members(selected)"
      :schedules="schedules"
      :mode="mode"
      :page-size="pageSize"
      :selectable="false"
      :can-manage="canManage"
      :can-create="canCreate"
      @edit="emit('edit', $event)"
      @delegate="emit('delegate', $event)"
      @remove="emit('remove', $event)"
      @assign="emit('assign', $event)"
      @command="emit('command', $event)"
      @refresh="emit('refresh', $event)"
    />

    <ModalDialog
      v-if="dialog"
      :title="editing ? t('group.editTitle') : t('group.createTitle')"
      :busy="busy"
      width="560px"
      @close="dialog = false"
      @confirm="save"
    >
      <div class="field">
        <label>{{ t('group.name') }}</label>
        <input v-model="form.name" class="input" />
      </div>

      <div class="field">
        <label>
          {{ t('group.members') }}
          <span class="muted">{{ t('group.selectedCount', { count: form.device_ids.length }) }}</span>
        </label>
        <input
          v-model="pickerQuery"
          class="input"
          type="search"
          :placeholder="t('device.searchPlaceholder')"
        />

        <p v-if="devices.length === 0" class="hint">{{ t('group.noDevices') }}</p>
        <p v-else-if="pickable.length === 0" class="hint">{{ t('org.searchNoMatch') }}</p>
        <div v-else class="picker">
          <label v-for="device in pickable" :key="device.id" class="pick-row">
            <input
              type="checkbox"
              :checked="form.device_ids.includes(device.id)"
              @change="toggleDevice(device.id)"
            />
            <span class="pick-name">{{ device.name }}</span>
            <span class="mono muted pick-code">{{ device.device_code }}</span>
            <span class="badge" :class="device.online ? 'badge-success' : 'badge-muted'">
              {{ device.online ? t('device.statusOnline') : t('device.statusOffline') }}
            </span>
          </label>
        </div>
      </div>

      <p v-if="formError" class="error-text">{{ formError }}</p>
    </ModalDialog>
  </section>
</template>

<style scoped>
.pad {
  padding: 0 16px 10px;
}

.group-select {
  width: 220px;
}

/* 장치가 수백 대일 수 있어 고르는 목록만 따로 스크롤한다. */
.picker {
  margin-top: 7px;
  max-height: 260px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.pick-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  cursor: pointer;
}

.pick-row:last-child {
  border-bottom: 0;
}

.pick-row:hover {
  background: var(--surface-2);
}

.pick-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pick-code {
  font-size: 11px;
}
</style>
