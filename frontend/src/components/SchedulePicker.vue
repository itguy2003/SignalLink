<script setup>
/**
 * 장치에 배정할 스케줄 고르기.
 *
 * 한 장치에 **여러 개**를 걸 수 있고, **순서가 곧 우선순위**다 — 같은 시각에
 * 둘 다 유효하면 앞의 것이 먼저 나간다. 그래서 목록형 다중 선택이 아니라
 * 고른 것을 순서대로 늘어놓는 모양이다.
 *
 * 사용 기간이 지난 스케줄은 걸려 있어도 표출되지 않는다. 그 상태를 구분해
 * 보여 주지 않으면 "왜 안 나오지" 를 화면에서 알 수 없다.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  /** 배정된 스케줄(AssignedSchedule[]). 서버가 준 순서 그대로. */
  assigned: { type: Array, default: () => [] },
  /** 고를 수 있는 전체 스케줄. */
  schedules: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['change'])

const { t, locale } = useI18n()

const adding = ref('')

const assignedIds = computed(() => props.assigned.map((s) => s.id))

/** 이미 건 것은 후보에서 뺀다. 같은 스케줄을 두 번 걸 수는 없다. */
const candidates = computed(() =>
  props.schedules.filter((s) => !assignedIds.value.includes(s.id)),
)

function emitIds(ids) {
  emit('change', ids)
}

function add() {
  const id = Number(adding.value)
  if (!id) return
  emitIds([...assignedIds.value, id])
  adding.value = ''
}

function remove(id) {
  emitIds(assignedIds.value.filter((x) => x !== id))
}

/** 우선순위를 한 칸 올린다. 앞의 것이 먼저 나간다. */
function moveUp(index) {
  if (index === 0) return
  const ids = [...assignedIds.value]
  ;[ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
  emitIds(ids)
}

function moveDown(index) {
  if (index >= assignedIds.value.length - 1) return
  const ids = [...assignedIds.value]
  ;[ids[index], ids[index + 1]] = [ids[index + 1], ids[index]]
  emitIds(ids)
}

/** 사용 기간을 사람이 읽는 문구로. 기간이 없으면 null. */
function periodLabel(schedule) {
  if (!schedule.start_at && !schedule.end_at) return null
  const fmt = (value) =>
    value ? new Date(value).toLocaleDateString(locale.value, { dateStyle: 'short' }) : ''
  if (schedule.start_at && schedule.end_at) {
    return `${fmt(schedule.start_at)} ~ ${fmt(schedule.end_at)}`
  }
  return schedule.start_at
    ? t('schedule.fromDate', { date: fmt(schedule.start_at) })
    : t('schedule.untilDate', { date: fmt(schedule.end_at) })
}
</script>

<template>
  <div class="schedule-picker">
    <p v-if="assigned.length === 0" class="muted empty">{{ t('device.demoOption') }}</p>

    <ol v-else class="assigned">
      <li v-for="(schedule, index) in assigned" :key="schedule.id" class="row">
        <span class="order">{{ index + 1 }}</span>
        <span class="name">{{ schedule.name }}</span>

        <!-- 걸려 있지만 지금은 안 나가는 상태를 구분해 준다. -->
        <span v-if="!schedule.active" class="badge badge-muted">{{ t('schedule.inactive') }}</span>
        <span v-if="periodLabel(schedule)" class="muted period">{{ periodLabel(schedule) }}</span>

        <span class="spacer" />
        <button
          class="btn btn-sm btn-icon"
          :disabled="disabled || index === 0"
          :title="t('schedule.raisePriority')"
          @click="moveUp(index)"
        >
          ↑
        </button>
        <button
          class="btn btn-sm btn-icon"
          :disabled="disabled || index === assigned.length - 1"
          :title="t('schedule.lowerPriority')"
          @click="moveDown(index)"
        >
          ↓
        </button>
        <button
          class="btn btn-sm btn-icon"
          :disabled="disabled"
          :title="t('common.delete')"
          @click="remove(schedule.id)"
        >
          ✕
        </button>
      </li>
    </ol>

    <div class="add">
      <select
        v-model="adding"
        class="select"
        :disabled="disabled || candidates.length === 0"
        @change="add"
      >
        <option value="">
          {{ candidates.length ? t('schedule.addToDevice') : t('schedule.allAssigned') }}
        </option>
        <option v-for="schedule in candidates" :key="schedule.id" :value="schedule.id">
          {{ schedule.name }}
        </option>
      </select>
    </div>

    <p v-if="assigned.length > 1" class="hint">{{ t('schedule.priorityHint') }}</p>
  </div>
</template>

<style scoped>
.schedule-picker {
  display: grid;
  gap: 5px;
  font-size: 12px;
}

.empty {
  margin: 0;
}

.assigned {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 3px;
}

.row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 5px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface-2);
}

/* 우선순위를 숫자로 못 박아 둔다. 순서가 곧 규칙이라 눈으로 확인돼야 한다. */
.order {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}

.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.period {
  font-size: 10px;
  white-space: nowrap;
}

.add .select {
  width: 100%;
  padding: 3px 6px;
  font-size: 12px;
}
</style>
