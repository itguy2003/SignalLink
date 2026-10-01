<script setup>
/**
 * 장치 스케줄 배정 창 — 화면을 둘로 나눈다.
 *
 *   왼쪽   스케줄 목록. 위에는 배정된 것(순서가 곧 우선순위 — ↑↓·해제),
 *          아래에는 배정할 수 있는 것([배정]).
 *   오른쪽 왼쪽에서 고른 스케줄의 구성 — 시간지정은 **주간(요일별 시간대)**,
 *          목록반복은 **재생 목록** 으로 보여 준다. 이름만 보고 걸면 무엇이
 *          나가는지 모른 채 배정하게 된다.
 *
 * 저장을 눌러야 서버에 반영된다(아이디 목록 전체 교체).
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import ModalDialog from '@/components/ModalDialog.vue'

const props = defineProps({
  device: { type: Object, required: true },
  /** 고를 수 있는 전체 스케줄(요약). */
  schedules: { type: Array, default: () => [] },
})

const emit = defineEmits(['close', 'save'])

const { t, locale } = useI18n()

/** 배정 목록(순서 유지). 서버가 준 요약을 그대로 복사해 시작한다. */
const assigned = ref((props.device.schedules ?? []).map((schedule) => ({ ...schedule })))
const selectedId = ref(assigned.value[0]?.id ?? null)

const assignedIds = computed(() => assigned.value.map((schedule) => schedule.id))
const candidates = computed(() =>
  props.schedules.filter((schedule) => !assignedIds.value.includes(schedule.id)),
)

const selectedSchedule = computed(
  () =>
    assigned.value.find((schedule) => schedule.id === selectedId.value) ??
    props.schedules.find((schedule) => schedule.id === selectedId.value) ??
    null,
)

// ------------------------------------------------------------ 배정 조작
function assign(schedule) {
  assigned.value.push({ ...schedule })
  select(schedule.id)
}

function unassign(id) {
  assigned.value = assigned.value.filter((schedule) => schedule.id !== id)
}

function move(index, delta) {
  const target = index + delta
  if (target < 0 || target >= assigned.value.length) return
  const [row] = assigned.value.splice(index, 1)
  assigned.value.splice(target, 0, row)
}

// ------------------------------------------------------------ 오른쪽 표시
/** 스케줄 상세(아이템 포함) 캐시 — 고를 때마다 다시 받지 않는다. */
const details = ref({})
const detailLoading = ref(false)

async function select(id) {
  selectedId.value = id
  if (details.value[id]) return
  detailLoading.value = true
  try {
    details.value = { ...details.value, [id]: await api.get(`/schedules/${id}`) }
  } catch {
    details.value = { ...details.value, [id]: null }
  } finally {
    detailLoading.value = false
  }
}

// 처음 열릴 때 첫 배정 스케줄의 구성을 바로 보여 준다.
if (selectedId.value) select(selectedId.value)

const detail = computed(() =>
  selectedId.value ? (details.value[selectedId.value] ?? null) : null,
)

const isWeekly = computed(() => detail.value?.kind === '시간지정')

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** 주간 표시: 요일별로 시간대를 시각순으로. */
const weekly = computed(() => {
  const items = detail.value?.items ?? []
  return DAY_KEYS.map((key, day) => ({
    key,
    slots: items
      .filter((item) => item.day_of_week === day && item.start_time && item.end_time)
      .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time))),
  }))
})

/** 목록 표시: 재생 순서대로. */
const rotation = computed(() =>
  [...(detail.value?.items ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
)

function itemLabel(item) {
  return item.content_name ?? t('device.inlineContent')
}

function shortTime(value) {
  return String(value ?? '').slice(0, 5)
}

function periodLabel(schedule) {
  if (!schedule?.start_at && !schedule?.end_at) return null
  const fmt = (value) =>
    value ? new Date(value).toLocaleDateString(locale.value, { dateStyle: 'short' }) : ''
  if (schedule.start_at && schedule.end_at) return `${fmt(schedule.start_at)} ~ ${fmt(schedule.end_at)}`
  return schedule.start_at
    ? t('schedule.fromDate', { date: fmt(schedule.start_at) })
    : t('schedule.untilDate', { date: fmt(schedule.end_at) })
}
</script>

<template>
  <ModalDialog
    :title="t('device.scheduleDialogTitle', { name: device.name })"
    width="1080px"
    height="80vh"
    @close="emit('close')"
    @confirm="emit('save', assignedIds)"
  >
    <div class="split">
      <!-- ------------------------------------------------ 왼쪽: 스케줄 목록 -->
      <div class="lists">
        <h3>
          {{ t('device.assignedSchedules') }}
          <span class="muted">{{ assigned.length }}</span>
        </h3>
        <p v-if="assigned.length === 0" class="muted small">{{ t('device.demoOption') }}</p>
        <ol v-else class="assigned">
          <li
            v-for="(schedule, index) in assigned"
            :key="schedule.id"
            class="row"
            :class="{ selected: schedule.id === selectedId }"
            data-test="assigned-row"
            @click="select(schedule.id)"
          >
            <span class="order">{{ index + 1 }}</span>
            <span class="name">{{ schedule.name }}</span>
            <span v-if="schedule.active === false" class="badge badge-muted">
              {{ t('schedule.inactive') }}
            </span>
            <span class="spacer" />
            <span class="row-btns" @click.stop>
              <button
                class="btn btn-sm btn-icon"
                :disabled="index === 0"
                :title="t('schedule.raisePriority')"
                data-test="move-up"
                @click="move(index, -1)"
              >
                ↑
              </button>
              <button
                class="btn btn-sm btn-icon"
                :disabled="index === assigned.length - 1"
                :title="t('schedule.lowerPriority')"
                data-test="move-down"
                @click="move(index, 1)"
              >
                ↓
              </button>
              <button
                class="btn btn-sm btn-icon"
                :title="t('common.delete')"
                data-test="unassign"
                @click="unassign(schedule.id)"
              >
                ✕
              </button>
            </span>
          </li>
        </ol>
        <p v-if="assigned.length > 1" class="hint">{{ t('schedule.priorityHint') }}</p>

        <h3 class="second">{{ t('device.scheduleCandidates') }}</h3>
        <p v-if="candidates.length === 0" class="muted small">{{ t('schedule.allAssigned') }}</p>
        <ul class="candidates">
          <li
            v-for="schedule in candidates"
            :key="schedule.id"
            class="row"
            :class="{ selected: schedule.id === selectedId }"
            data-test="candidate-row"
            @click="select(schedule.id)"
          >
            <span class="name">{{ schedule.name }}</span>
            <span class="badge badge-muted kind">{{ t(`enums.scheduleKind.${schedule.kind}`) }}</span>
            <span class="spacer" />
            <button class="btn btn-sm" data-test="assign" @click.stop="assign(schedule)">
              {{ t('device.assignThis') }}
            </button>
          </li>
        </ul>
      </div>

      <!-- ------------------------------- 오른쪽: 주간(시간지정) / 목록(목록반복) -->
      <div class="detail">
        <p v-if="!selectedSchedule" class="muted pad">{{ t('device.schedulePreviewEmpty') }}</p>
        <template v-else>
          <div class="detail-head">
            <strong>{{ selectedSchedule.name }}</strong>
            <span class="badge badge-primary">
              {{ t(`enums.scheduleKind.${(detail ?? selectedSchedule).kind}`) }}
            </span>
            <span v-if="periodLabel(selectedSchedule)" class="muted small">
              {{ periodLabel(selectedSchedule) }}
            </span>
          </div>

          <p v-if="detailLoading && !detail" class="muted pad">{{ t('common.loading') }}</p>
          <p v-else-if="detail && detail.items.length === 0" class="muted pad">
            {{ t('device.scheduleNoItems') }}
          </p>

          <!-- 주간: 요일 일곱 칸, 각 칸에 시간대를 시각순으로. -->
          <div v-else-if="detail && isWeekly" class="week" data-test="weekly-view">
            <div v-for="day in weekly" :key="day.key" class="day">
              <div class="day-name">{{ t(`days.${day.key}`) }}</div>
              <div v-if="day.slots.length === 0" class="muted tiny">-</div>
              <div v-for="slot in day.slots" :key="slot.id" class="slot">
                <div class="slot-time">{{ shortTime(slot.start_time) }}~{{ shortTime(slot.end_time) }}</div>
                <div class="slot-name">{{ itemLabel(slot) }}</div>
              </div>
            </div>
          </div>

          <!-- 목록반복: 재생 순서 그대로. -->
          <ol v-else-if="detail" class="rotation" data-test="list-view">
            <li v-for="(item, index) in rotation" :key="item.id" class="rot-row">
              <span class="order">{{ index + 1 }}</span>
              <span class="name">{{ itemLabel(item) }}</span>
              <span class="muted small">{{ item.duration_sec }}s</span>
            </li>
          </ol>
        </template>
      </div>
    </div>
  </ModalDialog>
</template>

<style scoped>
.split {
  display: flex;
  gap: 16px;
  height: 100%;
  min-height: 0;
}

/* ------------------------------------------------------------ 왼쪽 */
.lists {
  width: 340px;
  flex-shrink: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.lists h3 {
  margin: 0 0 6px;
  font-size: 13px;
}

.lists h3.second {
  margin-top: 16px;
}

.assigned,
.candidates {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-2);
  font-size: 13px;
  cursor: pointer;
}

.row.selected {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.order {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}

.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kind {
  flex: none;
}

.spacer {
  flex: 1;
}

.row-btns {
  display: flex;
  gap: 3px;
  flex: none;
}

.small {
  font-size: 12px;
}

.tiny {
  font-size: 11px;
}

/* ------------------------------------------------------------ 오른쪽 */
.detail {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  border-left: 1px solid var(--border);
  padding-left: 16px;
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.pad {
  padding: 14px 0;
}

/* 주간 — 요일 일곱 칸. */
.week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}

.day {
  min-width: 0;
}

.day-name {
  padding: 4px 0;
  text-align: center;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  margin-bottom: 5px;
}

.slot {
  padding: 5px 6px;
  margin-bottom: 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-2);
}

.slot-time {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
}

.slot-name {
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 목록반복. */
.rotation {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 5px;
}

.rot-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-2);
  font-size: 13px;
}
</style>
