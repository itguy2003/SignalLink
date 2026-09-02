<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import ModalDialog from '@/components/ModalDialog.vue'
import SchedulePreview from '@/components/SchedulePreview.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { LANDSCAPE, PORTRAIT, labelKey } from '@/utils/orientation'
import { itemsToBlocks } from '@/utils/scheduleGrid'
import { slotsByDay, slotsFromPlaylist } from '@/utils/schedulePreview'

const auth = useAuthStore()
const toast = useToastStore()
const { t, locale } = useI18n()

const page = ref({ items: [], total: 0, page: 1, size: 20 })

/**
 * 목록에서 바로 여는 미리보기.
 *
 * 편집기까지 들어가야만 볼 수 있으면, 여러 스케줄을 훑어보는 일이 화면
 * 이동의 반복이 된다. 목록은 이름과 버전만 보여 줄 뿐 **무엇이 나오는지**는
 * 알려 주지 않으므로, 확인하려면 결국 하나씩 들어가야 했다.
 */
const previewOpen = ref(false)
const previewLoading = ref(false)
const previewSchedule = ref(null)
const previewGroups = ref([])
const widgets = ref([])

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const dayLabels = computed(() => DAY_KEYS.map((key) => t(`days.${key}`)))

/** 목록반복이면 요일 탭이 의미가 없다. 재생 순서 하나만 보여 준다. */
const previewShowGroups = computed(() => previewSchedule.value?.kind !== '목록반복')

async function openPreview(schedule) {
  previewSchedule.value = schedule
  previewGroups.value = []
  previewOpen.value = true
  previewLoading.value = true
  try {
    // 목록에는 아이템이 없다. 무엇이 나오는지는 상세를 받아야 안다.
    const detail = await api.get(`/schedules/${schedule.id}`)
    // 위젯 명세는 미리보기가 위젯 이름을 그리는 데 쓴다. 한 번만 받는다.
    if (widgets.value.length === 0) widgets.value = await api.get('/widgets').catch(() => [])

    previewGroups.value =
      detail.kind === '목록반복'
        ? slotsFromPlaylist(
            [...(detail.items ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
            detail.name,
          )
        : slotsByDay(itemsToBlocks(detail.items).blocks, dayLabels.value)
  } catch (err) {
    toast.error(err.detail ?? t('grid.loadFailed'))
    previewOpen.value = false
  } finally {
    previewLoading.value = false
  }
}
const orgs = ref([])
const loading = ref(false)
const query = ref('')

const dialog = ref(false)
const busy = ref(false)
const formError = ref('')

/** 수정 중인 스케줄. null 이면 새로 만드는 중이다. */
const editing = ref(null)
const form = ref({ name: '', kind: '시간지정', orientation: LANDSCAPE, org_id: '', start_at: '', end_at: '' })

async function load(pageNumber = page.value.page) {
  loading.value = true
  try {
    page.value = await api.get('/schedules', {
      q: query.value || undefined,
      page: pageNumber,
      size: page.value.size,
    })
  } catch (err) {
    toast.error(err.detail ?? t('schedule.loadFailed'))
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  orgs.value = await api.get('/organizations').catch(() => [])
  await load(1)
})

function openCreate() {
  editing.value = null
  form.value = {
    name: '',
    kind: '시간지정',
    orientation: LANDSCAPE,
    org_id: auth.user?.org_id ?? '',
    // 비워 두면 기간 제한 없음.
    start_at: '',
    end_at: '',
  }
  formError.value = ''
  dialog.value = true
}

/**
 * 이미 있는 스케줄을 고친다.
 *
 * 사용 기간은 만든 뒤에 바뀌는 일이 더 많다 — 행사가 밀리거나 방학이 늘어난다.
 * 구분(시간지정/목록반복)은 짜 놓은 편성의 축이라 여기서 바꾸지 못하게 잠근다.
 */
function openEdit(schedule) {
  editing.value = schedule
  form.value = {
    name: schedule.name,
    kind: schedule.kind,
    orientation: schedule.orientation,
    org_id: schedule.org_id ?? '',
    start_at: fromIso(schedule.start_at),
    end_at: fromIso(schedule.end_at),
  }
  formError.value = ''
  dialog.value = true
}

/** 만들기와 수정이 같은 창을 쓴다. 채워야 할 칸이 같다. */
function submit() {
  // 서버도 막지만, 여기서 걸러야 무엇이 잘못됐는지 그 자리에서 보인다.
  if (form.value.start_at && form.value.end_at && form.value.start_at >= form.value.end_at) {
    formError.value = t('schedule.periodInvalid')
    return
  }
  return editing.value ? update() : create()
}

async function update() {
  busy.value = true
  formError.value = ''
  try {
    // 사용 기간은 null 을 보내야 '제한 없음' 으로 돌아간다. 서버가 이 두 칸만은
    // null 을 '지움' 으로 읽는다.
    await api.put(`/schedules/${editing.value.id}`, {
      name: form.value.name.trim(),
      orientation: form.value.orientation,
      start_at: toIso(form.value.start_at),
      end_at: toIso(form.value.end_at),
    })
    toast.success(t('schedule.updated'))
    dialog.value = false
    await load()
  } catch (err) {
    formError.value = err.detail ?? t('schedule.updateFailed')
  } finally {
    busy.value = false
  }
}

async function create() {
  busy.value = true
  formError.value = ''
  try {
    await api.post('/schedules', {
      name: form.value.name.trim(),
      kind: form.value.kind,
      orientation: form.value.orientation,
      org_id: Number(form.value.org_id),
      // 빈 문자열은 '제한 없음'이라 null 로 바꿔 보낸다.
      start_at: toIso(form.value.start_at),
      end_at: toIso(form.value.end_at),
      items: [],
    })
    toast.success(t('schedule.created'))
    dialog.value = false
    await load()
  } catch (err) {
    formError.value = err.detail ?? t('schedule.createFailed')
  } finally {
    busy.value = false
  }
}

async function duplicate(schedule) {
  try {
    await api.post(`/schedules/${schedule.id}/duplicate`)
    toast.success(t('schedule.duplicated'))
    await load()
  } catch (err) {
    toast.error(err.detail ?? t('schedule.duplicateFailed'))
  }
}

async function remove(schedule) {
  if (!confirm(t('schedule.confirmDelete', { name: schedule.name }))) return
  try {
    await api.delete(`/schedules/${schedule.id}`)
    toast.success(t('schedule.deleted'))
    await load()
  } catch (err) {
    toast.error(err.detail ?? t('schedule.deleteFailed'))
  }
}

/**
 * `datetime-local` 값을 서버가 받는 ISO 문자열로.
 *
 * 입력은 브라우저 지역 시각이고 저장은 UTC 다. Date 를 거쳐야 그 변환이 된다.
 * 비었으면 null — 기간 제한 없음이라는 뜻이다.
 */
function toIso(value) {
  return value ? new Date(value).toISOString() : null
}

/**
 * 서버의 ISO(UTC) 를 `datetime-local` 이 받는 지역 시각 문자열로.
 *
 * 입력칸은 항상 지역 시각이라 `toISOString()` 을 그대로 넣으면 시차만큼
 * 어긋난 값이 보인다. 분까지만 쓴다 — 초는 입력칸이 다루지 않는다.
 */
function fromIso(value) {
  if (!value) return ''
  const date = new Date(value)
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/**
 * 지금 이 스케줄이 사용 기간 안인가.
 *
 * 배정돼 있어도 기간 밖이면 표출되지 않는다. 목록에서 그 상태가 보이지
 * 않으면 "왜 안 나오지" 를 화면에서 알 수 없다 — 서버 판정과 같은 규칙이다.
 */
function periodState(schedule) {
  const now = Date.now()
  if (schedule.start_at && now < new Date(schedule.start_at).getTime()) return 'notYet'
  if (schedule.end_at && now > new Date(schedule.end_at).getTime()) return 'expired'
  return 'active'
}

/** 사용 기간을 한 줄로. 기간이 없으면 '제한 없음'. */
function periodLabel(schedule) {
  if (!schedule.start_at && !schedule.end_at) return t('schedule.noPeriod')
  const fmt = (v) => new Date(v).toLocaleDateString(locale.value, { dateStyle: 'short' })
  if (schedule.start_at && schedule.end_at) {
    return `${fmt(schedule.start_at)} ~ ${fmt(schedule.end_at)}`
  }
  return schedule.start_at
    ? t('schedule.fromDate', { date: fmt(schedule.start_at) })
    : t('schedule.untilDate', { date: fmt(schedule.end_at) })
}

function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
</script>

<template>
  <div>
    <h1 class="page-title">{{ t('schedule.title') }}</h1>
    <p class="page-desc">{{ t('schedule.desc') }}</p>

    <section class="card">
      <div class="card-header">
        <div class="row">
          <input
            v-model="query"
            class="input filter-input"
            :placeholder="t('schedule.searchPlaceholder')"
            @keyup.enter="load(1)"
          />
          <button class="btn" @click="load(1)">{{ t('common.search') }}</button>
        </div>
        <button v-if="auth.can.manageSchedules" class="btn btn-primary" @click="openCreate">
          {{ t('schedule.createButton') }}
        </button>
      </div>

      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('schedule.name') }}</th>
              <th>{{ t('schedule.kind') }}</th>
              <th>{{ t('schedule.orientation') }}</th>
              <th>{{ t('schedule.period') }}</th>
              <th>{{ t('schedule.version') }}</th>
              <th>{{ t('schedule.usingDevices') }}</th>
              <th>{{ t('schedule.lastModified') }}</th>
              <th class="right">{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="schedule in page.items" :key="schedule.id">
              <td>
                <RouterLink :to="`/schedules/${schedule.id}/grid`">{{ schedule.name }}</RouterLink>
              </td>
              <td>
                <span class="badge">{{ t(`enums.scheduleKind.${schedule.kind}`) }}</span>
              </td>
              <td>
                <span class="badge badge-primary">{{ t(labelKey(schedule.orientation)) }}</span>
              </td>
              <td class="small">
                <span :class="periodState(schedule) === 'active' ? 'muted' : 'off'">
                  {{ periodLabel(schedule) }}
                </span>
                <!-- 기간 밖이면 배정돼 있어도 표출되지 않는다. 그 사실이 보여야 한다. -->
                <span v-if="periodState(schedule) !== 'active'" class="badge badge-warning">
                  {{ t(`schedule.${periodState(schedule)}`) }}
                </span>
              </td>
              <td class="mono">v{{ schedule.version }}</td>
              <td>
                <span :class="{ muted: schedule.device_count === 0 }">
                  {{ t('schedule.deviceCount', { count: schedule.device_count }) }}
                </span>
              </td>
              <td class="muted">{{ formatDate(schedule.updated_at) }}</td>
              <td class="right">
                <div class="row right-align">
                  <RouterLink class="btn btn-sm btn-primary" :to="`/schedules/${schedule.id}/grid`">
                    {{ schedule.kind === '목록반복' ? t('schedule.listEdit') : t('schedule.gridEdit') }}
                  </RouterLink>
                  <button class="btn btn-sm" @click="openPreview(schedule)">
                    {{ t('preview.open') }}
                  </button>
                  <button v-if="auth.can.manageSchedules" class="btn btn-sm" @click="openEdit(schedule)">
                    {{ t('common.edit') }}
                  </button>
                  <button class="btn btn-sm" @click="duplicate(schedule)">
                    {{ t('common.duplicate') }}
                  </button>
                  <button class="btn btn-sm btn-danger" @click="remove(schedule)">
                    {{ t('common.delete') }}
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="!loading && page.items.length === 0">
              <td colspan="8" class="table-empty">{{ t('schedule.empty') }}</td>
            </tr>
          </tbody>
        </table>
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
      :title="editing ? t('schedule.editTitle') : t('schedule.createTitle')"
      :busy="busy"
      :confirm-label="editing ? t('common.save') : t('common.create')"
      @close="dialog = false"
      @confirm="submit"
    >
      <div class="field">
        <label>{{ t('schedule.name') }}</label>
        <input v-model="form.name" class="input" />
      </div>

      <div class="field">
        <label>{{ t('schedule.kind') }}</label>
        <select v-model="form.kind" class="select" :disabled="!!editing">
          <option value="시간지정">{{ t('schedule.kindTimeBased') }}</option>
          <option value="목록반복">{{ t('schedule.kindListLoop') }}</option>
        </select>
        <p v-if="editing" class="hint">{{ t('schedule.kindLocked') }}</p>
      </div>

      <div class="field">
        <label>{{ t('schedule.orientation') }}</label>
        <select v-model="form.orientation" class="select">
          <option :value="LANDSCAPE">{{ t(labelKey(LANDSCAPE)) }}</option>
          <option :value="PORTRAIT">{{ t(labelKey(PORTRAIT)) }}</option>
        </select>
        <p class="hint">{{ t('schedule.orientationHint') }}</p>
      </div>

      <div class="grid-2">
        <div class="field">
          <label>{{ t('schedule.startAt') }}</label>
          <input v-model="form.start_at" class="input" type="datetime-local" />
        </div>
        <div class="field">
          <label>{{ t('schedule.endAt') }}</label>
          <input v-model="form.end_at" class="input" type="datetime-local" />
        </div>
      </div>
      <p class="hint">{{ t('schedule.periodHint') }}</p>

      <div v-if="!editing" class="field">
        <label>{{ t('auth.org') }}</label>
        <select v-model="form.org_id" class="select">
          <option v-for="org in orgs" :key="org.id" :value="org.id">{{ org.name }}</option>
        </select>
      </div>

      <p v-if="formError" class="error-text">{{ formError }}</p>
    </ModalDialog>

    <!-- 상세를 받아 오는 동안에도 창은 열어 둔다. 눌렀는데 한참 아무 일도
         일어나지 않으면 눌린 것인지 알 수 없다. -->
    <ModalDialog
      v-if="previewOpen && previewLoading"
      :title="t('preview.title')"
      width="420px"
      hide-footer
      @close="previewOpen = false"
    >
      <p class="muted">{{ t('common.loading') }}</p>
    </ModalDialog>

    <SchedulePreview
      v-else-if="previewOpen"
      :groups="previewGroups"
      :widgets="widgets"
      :show-groups="previewShowGroups"
      @close="previewOpen = false"
    />
  </div>
</template>

<style scoped>
.filter-input {
  width: 220px;
}

/* 기간 밖인 스케줄. 지운 것은 아니므로 흐리게만 둔다. */
.off {
  color: var(--warning);
}

.table-scroll {
  overflow-x: auto;
}

.right {
  text-align: right;
}

.right-align {
  justify-content: flex-end;
}

.pager {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}
</style>
