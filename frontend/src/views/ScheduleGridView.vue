<script setup>
/**
 * 주간 스케줄 편집기.
 *
 * 요일 × 시간 표에 블록을 만들고, 각 블록에 표출할 콘텐츠를 붙인다.
 * 목록반복 스케줄은 요일 축이 의미가 없어 재생 목록(SchedulePlaylist)으로
 * 대신 그린다.
 *
 * 좌표 계산과 겹침 판정은 `utils/scheduleGrid` 가 순수 함수로 갖고 있다.
 * 여기서는 그것을 마우스 이벤트와 이어 붙이는 일만 한다.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import ContentBrowser from '@/components/ContentBrowser.vue'
import ContentLibraryPanel from '@/components/ContentLibraryPanel.vue'
import SchedulePlaylist from '@/components/SchedulePlaylist.vue'
import SchedulePreview from '@/components/SchedulePreview.vue'
import { useSettingsStore } from '@/stores/settings'
import { useToastStore } from '@/stores/toast'
import {
  isContentDrag,
  readContentDrag,
  wrapPlaylistAsDocument,
  wrapWidgetAsDocument,
} from '@/utils/contentDnd'
import { LANDSCAPE, defaultSize, labelKey, ofSize } from '@/utils/orientation'
import { slotsByDay, slotsFromPlaylist } from '@/utils/schedulePreview'
import {
  DEFAULT_GRID,
  SLOT_CHOICES,
  blockHasContent,
  blocksToItems,
  clampToGrid,
  createBlock,
  findConflict,
  hourMarks,
  itemsToBlocks,
  minutesToY,
  slotCount,
  slotHeightFor,
  snap,
  toLabel,
  yToMinutes,
} from '@/utils/scheduleGrid'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const settings = useSettingsStore()
const { t } = useI18n()

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const dayLabels = computed(() => DAY_KEYS.map((key) => t(`days.${key}`)))

/**
 * 표의 축. 시간 분할은 편집 취향이라 설정에 저장해 두고 따라간다 —
 * 매번 다시 고르게 하면 쓰던 사람이 번거롭다.
 */
const grid = ref({
  ...DEFAULT_GRID,
  slotMinutes: settings.slotMinutes,
  slotHeight: slotHeightFor(settings.slotMinutes),
})

/**
 * 분할을 바꿔도 이미 놓인 블록은 움직이지 않는다.
 *
 * 30분 칸에서 09:00–09:30 으로 잡아 둔 것을 10분 칸으로 바꿨다고 옮기면,
 * 잘게 보려던 것뿐인데 편성이 달라진다. 표의 눈금과 새로 잡을 때의 스냅만
 * 달라진다.
 */
function setSlotMinutes(value) {
  settings.setSlotMinutes(value)
  grid.value = {
    ...grid.value,
    slotMinutes: settings.slotMinutes,
    slotHeight: slotHeightFor(settings.slotMinutes),
  }
}

const schedule = ref(null)
const blocks = ref([])
/** 요일이 지정되지 않은 아이템(목록반복에서 만든 것). 저장 때 그대로 보존한다. */
const looseItems = ref([])
const playlist = ref([])
const loading = ref(true)
const saving = ref(false)
const dirty = ref(false)
const selectedKey = ref(null)
const previewOpen = ref(false)
const widgets = ref([])
const browserOpen = ref(false)
const browserTargetKey = ref(null)
const columnRefs = ref([])
const draft = ref(null)

const isLoop = computed(() => schedule.value?.kind === '목록반복')

/**
 * 스케줄의 화면 방향. 어떤 콘텐츠를 붙일 수 있는지가 이 값으로 정해지므로
 * 목록 패널과 드롭 검사가 함께 본다.
 */
const orientation = computed(() => schedule.value?.orientation ?? LANDSCAPE)

const selected = computed(() => blocks.value.find((b) => b.key === selectedKey.value) ?? null)

// 분할이 잘면 한 칸 높이가 소수점이 된다(5분 = 4.33px). 표 전체 높이는
// 반올림해 정수 픽셀로 둔다 — 분할을 바꿀 때마다 표가 1px 씩 흔들린다.
const gridHeight = computed(() => Math.round(slotCount(grid.value) * grid.value.slotHeight))

/**
 * 분할 눈금. 고른 간격이 눈에 보여야 그 값을 고른 의미가 있다.
 *
 * 칸마다 요소를 두지 않고 배경 그라디언트로 그린다 — 5분 분할이면 하루에
 * 216줄이라, 요소로 그리면 요일 일곱 열에 1500개가 넘게 생긴다.
 */
const slotLines = computed(() => ({
  backgroundImage: `repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent ${grid.value.slotHeight - 1}px,
    var(--slot-line) ${grid.value.slotHeight - 1}px,
    var(--slot-line) ${grid.value.slotHeight}px
  )`,
}))

const marks = computed(() => hourMarks(grid.value))

const blocksByDay = computed(() => {
  const byDay = Array.from({ length: 7 }, () => [])
  for (const block of blocks.value) byDay[block.day].push(block)
  return byDay
})

const emptyBlockCount = computed(() => blocks.value.filter((b) => !blockHasContent(b)).length)

onMounted(async () => {
  try {
    const [detail, specs] = await Promise.all([
      api.get(`/schedules/${route.params.id}`),
      api.get('/widgets').catch(() => []),
    ])
    schedule.value = detail
    widgets.value = specs
    loadItems(detail.items)
  } catch (err) {
    toast.error(err.detail ?? t('grid.loadFailed'))
    router.push('/schedules')
  } finally {
    loading.value = false
  }
})

function loadItems(items) {
  if (isLoop.value) {
    // 순서를 그대로 유지한다. 요일/시간 값은 건드리지 않고 보존한다.
    playlist.value = [...(items ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    blocks.value = []
    looseItems.value = []
    return
  }
  const converted = itemsToBlocks(items)
  blocks.value = converted.blocks.map((b) => clampToGrid(b, grid.value))
  looseItems.value = converted.loose
  playlist.value = []
}

/**
 * 미리보기에 넘길 슬롯 묶음.
 *
 * 저장하지 않은 편집 상태를 그대로 보여 준다 — 저장해야만 볼 수 있으면
 * 매번 저장해야 한다.
 */
const previewGroups = computed(() => {
  if (!schedule.value) return []
  return isLoop.value
    ? slotsFromPlaylist(playlist.value, schedule.value.name)
    : slotsByDay(blocks.value, dayLabels.value)
})

function markDirty() {
  dirty.value = true
}

// ------------------------------------------------------------------ 드래그로 블록 만들기
let creating = null

function onColumnMouseDown(event, day) {
  // 블록 위에서 시작한 드래그는 블록 이동이다. 새 블록을 만들지 않는다.
  if (event.target.closest('.block')) return

  const rect = event.currentTarget.getBoundingClientRect()
  const startMinutes = snap(
    yToMinutes(event.clientY - rect.top, grid.value),
    grid.value.slotMinutes,
  )
  creating = { day, anchor: startMinutes, rect }
  draft.value = { day, start: startMinutes, end: startMinutes + grid.value.slotMinutes }
  window.addEventListener('mousemove', onCreateMove)
  window.addEventListener('mouseup', onCreateUp)
}

function onCreateMove(event) {
  if (!creating) return
  const current = snap(
    yToMinutes(event.clientY - creating.rect.top, grid.value),
    grid.value.slotMinutes,
  )
  const start = Math.min(creating.anchor, current)
  const end = Math.max(creating.anchor + grid.value.slotMinutes, current)
  draft.value = { day: creating.day, start, end }
}

function onCreateUp() {
  window.removeEventListener('mousemove', onCreateMove)
  window.removeEventListener('mouseup', onCreateUp)
  if (!creating || !draft.value) {
    creating = null
    draft.value = null
    return
  }

  const block = createBlock({ ...draft.value, grid: grid.value })
  creating = null
  draft.value = null

  const conflict = findConflict(blocks.value, block)
  if (conflict) {
    toast.error(
      t('grid.overlapCreate', {
        day: dayLabels.value[conflict.day],
        start: toLabel(conflict.start),
        end: toLabel(conflict.end),
      }),
    )
    return
  }

  blocks.value.push(block)
  selectedKey.value = block.key
  markDirty()
  openBrowser(block.key)
}

// ------------------------------------------------------------------ 블록 이동·크기
let moving = null

function startDrag(event, block, mode) {
  event.preventDefault()
  event.stopPropagation()
  selectedKey.value = block.key
  moving = {
    mode,
    block,
    startX: event.clientX,
    startY: event.clientY,
    origin: { day: block.day, start: block.start, end: block.end },
  }
  window.addEventListener('mousemove', onMoveDrag)
  window.addEventListener('mouseup', onMoveUp)
}

/** 마우스가 어느 요일 열 위에 있는가. 열을 넘나드는 이동에 쓴다. */
function dayAt(clientX) {
  for (let index = 0; index < columnRefs.value.length; index += 1) {
    const column = columnRefs.value[index]
    if (!column) continue
    const rect = column.getBoundingClientRect()
    if (clientX >= rect.left && clientX <= rect.right) return index
  }
  return null
}

function onMoveDrag(event) {
  if (!moving) return
  const { block, origin, mode } = moving
  const deltaMinutes = snap(
    ((event.clientY - moving.startY) / grid.value.slotHeight) * grid.value.slotMinutes,
    grid.value.slotMinutes,
  )

  if (mode === 'move') {
    const length = origin.end - origin.start
    const day = dayAt(event.clientX) ?? origin.day
    const next = clampToGrid(
      {
        ...block,
        day,
        start: origin.start + deltaMinutes,
        end: origin.start + deltaMinutes + length,
      },
      grid.value,
    )
    block.day = next.day
    block.start = next.start
    block.end = next.end
  } else {
    const next = clampToGrid(
      {
        ...block,
        start: origin.start,
        end: Math.max(origin.start + grid.value.slotMinutes, origin.end + deltaMinutes),
      },
      grid.value,
    )
    block.end = next.end
  }
}

function onMoveUp() {
  window.removeEventListener('mousemove', onMoveDrag)
  window.removeEventListener('mouseup', onMoveUp)
  if (!moving) return

  const { block, origin } = moving
  moving = null

  if (findConflict(blocks.value, block)) {
    block.day = origin.day
    block.start = origin.start
    block.end = origin.end
    toast.error(t('grid.overlapMove'))
    return
  }
  markDirty()
}

// ------------------------------------------------------------------ 콘텐츠 붙이기
function openBrowser(key) {
  browserTargetKey.value = key
  browserOpen.value = true
}

/** 목록반복에서 어느 자리를 고르는 중인가. null 이면 맨 뒤에 붙인다. */
const playlistTarget = ref(null)

function openPlaylistBrowser(index) {
  playlistTarget.value = index
  browserOpen.value = true
}

function closeBrowser() {
  browserOpen.value = false
  playlistTarget.value = null
}

function applyToPlaylist(content) {
  if (playlistTarget.value === null) {
    playlist.value.push({
      id: null,
      schedule_id: schedule.value.id,
      day_of_week: -1,
      start_time: null,
      end_time: null,
      sort_order: playlist.value.length,
      duration_sec: 15,
      content_id: content.id,
      content_name: content.name,
      content: {},
    })
  } else {
    const item = playlist.value[playlistTarget.value]
    if (item) {
      item.content_id = content.id
      item.content_name = content.name
      item.content = {}
    }
  }
  playlistTarget.value = null
  markDirty()
}

function applyContent(content) {
  if (isLoop.value) {
    applyToPlaylist(content)
    browserOpen.value = false
    return
  }
  const block = blocks.value.find((b) => b.key === browserTargetKey.value)
  if (block) {
    block.contentId = content.id
    block.contentName = content.name
    block.inlineContent = null
    block.hasInline = false
    markDirty()
  }
  browserOpen.value = false
}

function applyAndEdit(content) {
  applyContent(content)
  openContentEditor(content.id)
}

function openContentEditor(contentId) {
  if (dirty.value && !confirm(t('grid.confirmLeave'))) return
  router.push({
    name: 'content-editor',
    params: { id: contentId },
    query: { from: route.fullPath },
  })
}

function clearContent(block) {
  block.contentId = null
  block.contentName = null
  markDirty()
}

// ------------------------------------------------------------------ 키보드
/**
 * 글자를 치는 중인가. 입력칸에서 Delete 를 눌렀는데 블록이 사라지면
 * 그보다 나쁜 일이 없다.
 */
function isTyping(target) {
  if (!target) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * Delete / Backspace 로 고른 블록을 지운다.
 *
 * 콘텐츠 편집기의 요소 삭제와 같은 손놀림이다 — 한 화면에서는 되고 다른
 * 화면에서는 안 되면 매번 버튼을 찾게 된다. Escape 로 선택을 푸는 것도 같다.
 */
function onKeyDown(event) {
  if (isTyping(event.target)) return

  if (event.key === 'Escape') {
    selectedKey.value = null
    return
  }

  if (event.key !== 'Delete' && event.key !== 'Backspace') return
  if (!selected.value) return

  event.preventDefault()
  removeBlock(selected.value)
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))

// ------------------------------------------------------------------ 블록 조작
function removeBlock(block) {
  blocks.value = blocks.value.filter((b) => b.key !== block.key)
  if (selectedKey.value === block.key) selectedKey.value = null
  markDirty()
}

function copyToAllDays(block) {
  let added = 0
  const skipped = []
  for (let day = 0; day < 7; day += 1) {
    if (day === block.day) continue
    const candidate = { ...block, key: `tmp-${day}`, day }
    if (findConflict(blocks.value, candidate)) {
      skipped.push(dayLabels.value[day])
      continue
    }
    const copy = createBlock({ day, start: block.start, end: block.end, grid: grid.value })
    copy.contentId = block.contentId
    copy.contentName = block.contentName
    copy.durationSec = block.durationSec
    blocks.value.push(copy)
    added += 1
  }
  markDirty()
  if (skipped.length) {
    toast.push(t('grid.copiedPartial', { count: added, skipped: skipped.join(', ') }), 'info')
  } else {
    toast.success(t('grid.copiedAll', { count: added }))
  }
}

/**
 * 시각 입력의 오류. 어느 칸이 잘못됐는지까지 들고 있어야 그 칸을 짚어 줄 수
 * 있다. `{ field: 'start' | 'end', message }`.
 *
 * 토스트로만 알리면 창이 사라진 뒤에는 무엇이 잘못됐는지 남지 않는다.
 * 시각은 고쳐 가며 맞추는 값이라, 틀린 이유가 칸 옆에 붙어 있어야 한다.
 */
const timeError = ref(null)

// 다른 블록을 고르면 앞 블록의 오류는 더 이상 의미가 없다.
watch(selectedKey, () => {
  timeError.value = null
})

/** "09:30" -> 570. 형식이 아니면 null. */
function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * 시작·종료를 고친다.
 *
 * 실패하면 값을 되돌리고 그 자리에 이유를 남긴다. 예전에는 토스트만 띄우고
 * 입력칸은 그대로 두어, 저장되지 않은 값이 칸에 남아 있었다 — 화면과 실제가
 * 다른 상태다.
 */
function updateTime(block, field, value) {
  const parsed = parseTime(value)
  if (parsed === null) {
    timeError.value = { field, message: t('grid.invalidTime') }
    return
  }

  const next = { ...block, [field]: parsed }
  if (next.end <= next.start) {
    timeError.value = { field, message: t('grid.invalidTimeRange') }
    return
  }

  // 표에 보이지 않는 시간대로 밀어 넣으면 블록이 사라진 것처럼 보인다.
  const clamped = clampToGrid(next, grid.value)
  if (clamped.start !== next.start || clamped.end !== next.end) {
    timeError.value = {
      field,
      message: t('grid.outOfRange', {
        start: t('grid.hourSuffix', { hour: grid.value.startHour }),
        end: t('grid.hourSuffix', { hour: grid.value.endHour }),
      }),
    }
    return
  }

  if (findConflict(blocks.value, clamped)) {
    timeError.value = { field, message: t('grid.overlapTime') }
    return
  }

  timeError.value = null
  block.start = clamped.start
  block.end = clamped.end
  markDirty()
}

function moveToDay(block, day) {
  const candidate = { ...block, day: Number(day) }
  if (findConflict(blocks.value, candidate)) {
    toast.error(t('grid.overlapDay'))
    return
  }
  block.day = Number(day)
  markDirty()
}

// ------------------------------------------------------------------ 목록에서 끌어다 놓기
const dropDay = ref(null)
const libraryRef = ref(null)

/**
 * 감싼 콘텐츠를 찾는 열쇠. 방향까지 넣는 이유는 가로형과 세로형이 서로 다른
 * 콘텐츠이기 때문이다.
 */
function wrapKey(payload) {
  const what = payload.kind === 'playlist' ? `playlist:${payload.id}` : `widget:${payload.key}`
  return `${what}:${orientation.value}`
}

/** 이번 편집 중에 만든 것. 한 번 만들면 그 세션 안에서는 다시 묻지 않는다. */
const wrapCache = new Map()

/** 문서가 '이것 하나로 꽉 찬' 모양인가. */
function wrapsExactly(document, payload) {
  const elements = document?.elements ?? []
  if (elements.length !== 1) return false
  const element = elements[0]
  return payload.kind === 'playlist'
    ? element.type === 'playlist' && element.options?.playlist_id === payload.id
    : element.type === 'widget' && element.widget_key === payload.key
}

/**
 * 이미 만들어 둔 감싼 콘텐츠 찾기.
 *
 * 이름이 같고 요소가 하나뿐인 후보만 골라 문서를 확인한다 — 목록 응답에는
 * 문서가 없어서 확인하려면 한 건씩 받아야 하고, 후보를 좁히지 않으면 드롭
 * 한 번에 수십 건을 받게 된다.
 */
async function findWrapped(payload, size) {
  const cached = wrapCache.get(wrapKey(payload))
  if (cached) return cached

  try {
    const page = await api.get('/contents', {
      q: payload.name,
      org_id: schedule.value.org_id,
      size: 20,
    })
    const candidates = (page?.items ?? []).filter(
      (item) =>
        item.name === payload.name &&
        item.element_count === 1 &&
        item.width === size.width &&
        item.height === size.height,
    )

    for (const candidate of candidates.slice(0, 5)) {
      const detail = await api.get(`/contents/${candidate.id}`)
      if (wrapsExactly(detail.document, payload)) {
        const found = { id: candidate.id, name: candidate.name }
        wrapCache.set(wrapKey(payload), found)
        return found
      }
    }
  } catch {
    // 못 찾으면 새로 만든다. 재사용은 편의일 뿐, 실패해도 흐름은 이어진다.
  }
  return null
}

/**
 * 떨어뜨린 카드를 '붙일 수 있는 콘텐츠' 로 바꾼다.
 *
 * 콘텐츠 카드는 그대로 쓰고, 위젯·재생목록 카드는 그것 하나가 화면을 꽉
 * 채우는 콘텐츠로 바꿔 돌려준다. 스케줄 아이템은 언제나 콘텐츠를 가리키므로,
 * 이 지점에서 형태를 맞춰 두면 이후 편집·재사용 경로가 완전히 같아진다.
 *
 * **같은 것을 다시 놓으면 이미 만들어 둔 콘텐츠를 다시 쓴다.** 놓을 때마다
 * 새로 만들면 똑같은 콘텐츠가 라이브러리에 쌓이고, 나중에 그 위젯의 설정을
 * 고치려면 몇 벌인지도 모르는 사본을 전부 찾아 고쳐야 한다.
 */
async function resolveDropped(payload) {
  const wrapping = payload.kind === 'widget' || payload.kind === 'playlist'
  if (!wrapping) {
    // 방향이 다른 콘텐츠는 서버가 거부한다. 여기서 먼저 막아야 왜 안 되는지 알 수 있다.
    if (typeof payload.width === 'number' && typeof payload.height === 'number') {
      const actual = ofSize(payload.width, payload.height)
      if (actual !== orientation.value) {
        toast.error(
          t('grid.orientationMismatch', {
            name: payload.name,
            schedule: t(labelKey(orientation.value)),
            content: t(labelKey(actual)),
          }),
        )
        return null
      }
    }
    return payload
  }

  // 스케줄 방향에 맞춰 감싼다. 카드가 실어 온 크기를 그대로 믿지 않는 이유는,
  // 방향이 어긋난 콘텐츠를 만들어 두면 쓰이지 못한 채 남기 때문이다.
  const size = defaultSize(orientation.value)

  const reused = await findWrapped(payload, size)
  if (reused) return reused

  try {
    const created = await api.post('/contents', {
      name: payload.name,
      org_id: schedule.value.org_id,
      ...size,
      document:
        payload.kind === 'playlist'
          ? wrapPlaylistAsDocument(payload, size)
          : wrapWidgetAsDocument(payload.key, size),
    })
    wrapCache.set(wrapKey(payload), { id: created.id, name: created.name })
    // 새로 만든 콘텐츠가 왼쪽 목록에도 바로 보이게 한다.
    libraryRef.value?.reload?.()
    toast.push(
      t(payload.kind === 'playlist' ? 'library.playlistWrapped' : 'library.widgetWrapped', {
        name: created.name,
      }),
      'info',
    )
    return { id: created.id, name: created.name }
  } catch (err) {
    toast.error(err.detail ?? t('content.createFailed'))
    return null
  }
}

function onColumnDragOver(event, day) {
  if (!isContentDrag(event)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  dropDay.value = day
}

function onColumnDragLeave(day) {
  if (dropDay.value === day) dropDay.value = null
}

async function onColumnDrop(event, day) {
  dropDay.value = null
  if (!isContentDrag(event)) return
  event.preventDefault()

  const payload = readContentDrag(event)
  if (!payload) return

  const rect = event.currentTarget.getBoundingClientRect()
  const start = snap(yToMinutes(event.clientY - rect.top, grid.value), grid.value.slotMinutes)
  // 놓은 자리에서 한 시간짜리 블록을 만든다. 길이는 뒤에서 조절하면 된다.
  const block = createBlock({ day, start, end: start + 60, grid: grid.value })

  const conflict = findConflict(blocks.value, block)
  if (conflict) {
    toast.error(
      t('grid.overlapCreate', {
        day: dayLabels.value[conflict.day],
        start: toLabel(conflict.start),
        end: toLabel(conflict.end),
      }),
    )
    return
  }

  const content = await resolveDropped(payload)
  if (!content) return

  block.contentId = content.id
  block.contentName = content.name
  blocks.value.push(block)
  selectedKey.value = block.key
  markDirty()
  toast.success(
    t('library.dropped', {
      name: content.name,
      day: dayLabels.value[day],
      start: toLabel(block.start),
    }),
  )
}

/** 목록반복의 재생 목록에 떨어뜨렸을 때. */
async function onPlaylistDrop({ event, index }) {
  if (!isContentDrag(event)) return
  const payload = readContentDrag(event)
  if (!payload) return

  const content = await resolveDropped(payload)
  if (!content) return

  const item = {
    id: null,
    schedule_id: schedule.value.id,
    day_of_week: -1,
    start_time: null,
    end_time: null,
    sort_order: 0,
    duration_sec: 15,
    content_id: content.id,
    content_name: content.name,
    content: {},
  }
  if (index === null || index >= playlist.value.length) playlist.value.push(item)
  else playlist.value.splice(index, 0, item)

  markDirty()
  toast.success(t('library.droppedList', { name: content.name }))
}

function openContentCreate() {
  if (dirty.value && !confirm(t('grid.confirmLeave'))) return
  router.push({ name: 'contents', query: { from: route.fullPath } })
}

/** 목록반복 아이템을 서버 모델로. 요일은 언제나 -1 이다. */
function playlistToItems() {
  return playlist.value.map((item, index) => ({
    day_of_week: item.day_of_week ?? -1,
    start_time: item.start_time ?? null,
    end_time: item.end_time ?? null,
    sort_order: index,
    duration_sec: item.duration_sec ?? 10,
    content_id: item.content_id ?? null,
    content: item.content_id ? {} : (item.content ?? {}),
  }))
}

async function save() {
  const empty = isLoop.value
    ? playlist.value.filter((item) => !item.content_id).length
    : emptyBlockCount.value
  if (empty && !confirm(t('grid.confirmEmptyBlocks', { count: empty }))) {
    return
  }

  saving.value = true
  try {
    const updated = await api.put(`/schedules/${schedule.value.id}`, {
      name: schedule.value.name,
      kind: schedule.value.kind,
      items: isLoop.value ? playlistToItems() : blocksToItems(blocks.value, looseItems.value),
    })
    schedule.value = updated
    loadItems(updated.items)
    selectedKey.value = null
    dirty.value = false
    toast.success(t('grid.saved', { version: updated.version }))
  } catch (err) {
    toast.error(err.detail ?? t('grid.saveFailed'))
  } finally {
    saving.value = false
  }
}

function blockStyle(block) {
  return {
    top: `${minutesToY(block.start, grid.value)}px`,
    height: `${minutesToY(block.end, grid.value) - minutesToY(block.start, grid.value)}px`,
  }
}

function draftStyle() {
  return {
    top: `${minutesToY(draft.value.start, grid.value)}px`,
    height: `${minutesToY(draft.value.end, grid.value) - minutesToY(draft.value.start, grid.value)}px`,
  }
}
</script>

<template>
  <div v-if="loading" class="muted">{{ t('common.loading') }}</div>

  <div v-else-if="schedule" class="page">
    <header class="head card">
      <div>
        <input v-model="schedule.name" class="input title-input" @input="markDirty" />
        <div class="hint">
          <!-- 방향은 어떤 콘텐츠를 붙일 수 있는지를 정하므로 늘 보이게 둔다. -->
          <span class="badge badge-primary">{{ t(labelKey(orientation)) }}</span>
          {{
            t('grid.meta', {
              kind: t(`enums.scheduleKind.${schedule.kind}`),
              version: schedule.version,
              devices: schedule.device_count,
            })
          }}
          <span v-if="dirty" class="badge badge-warning">{{ t('common.unsaved') }}</span>
        </div>
      </div>
      <div class="spacer" />
      <div v-if="!isLoop" class="row">
        <label class="check">
          {{ t('grid.startHour') }}
          <select v-model.number="grid.startHour" class="select tiny">
            <option v-for="hour in 13" :key="hour" :value="hour - 1">
              {{ t('grid.hourSuffix', { hour: hour - 1 }) }}
            </option>
          </select>
        </label>
        <label class="check">
          {{ t('grid.endHour') }}
          <select v-model.number="grid.endHour" class="select tiny">
            <option v-for="hour in 12" :key="hour" :value="hour + 12">
              {{ t('grid.hourSuffix', { hour: hour + 12 }) }}
            </option>
          </select>
        </label>
        <!-- 잘게 나눌수록 짧은 편성을 잡을 수 있다. 표 높이는 그대로다. -->
        <label class="check" :title="t('grid.slotHint')">
          {{ t('grid.slot') }}
          <select
            class="select tiny"
            :value="grid.slotMinutes"
            @change="setSlotMinutes($event.target.value)"
          >
            <option v-for="minutes in SLOT_CHOICES" :key="minutes" :value="minutes">
              {{ t('grid.slotMinutes', { minutes }) }}
            </option>
          </select>
        </label>
      </div>
      <button class="btn" @click="previewOpen = true">{{ t('preview.open') }}</button>
      <RouterLink to="/schedules" class="btn">{{ t('common.list') }}</RouterLink>
      <button class="btn btn-primary" :disabled="saving" @click="save">
        {{ saving ? t('common.saving') : t('common.save') }}
      </button>
    </header>

    <p class="page-desc">{{ isLoop ? t('playlist.desc') : t('grid.desc') }}</p>

    <div class="with-library">
      <!-- 왼쪽 콘텐츠 목록: 여기서 끌어다 일정에 놓는다. -->
      <ContentLibraryPanel
        ref="libraryRef"
        class="library-panel"
        :org-id="schedule.org_id"
        :orientation="orientation"
        @edit="openContentEditor($event.id)"
        @create="openContentCreate"
      />

      <!-- 목록반복: 순서가 전부다. 요일 표 대신 재생 목록을 쓴다. -->
      <SchedulePlaylist
        v-if="isLoop"
        :items="playlist"
        @change="markDirty"
        @pick="openPlaylistBrowser"
        @edit="openContentEditor"
        @drop-content="onPlaylistDrop"
      />

      <div v-else class="board">
        <section class="card grid-card">
          <div class="grid-head">
            <div class="corner" />
            <div
              v-for="(day, index) in dayLabels"
              :key="day"
              class="day-head"
              :class="{ weekend: index >= 5 }"
            >
              {{ day }}
            </div>
          </div>

          <div class="grid-body" :style="{ height: `${gridHeight}px` }">
            <div class="time-col">
              <div
                v-for="mark in marks"
                :key="mark.hour"
                class="time-label"
                :style="{ top: `${mark.y}px` }"
              >
                {{ String(mark.hour).padStart(2, '0') }}:00
              </div>
            </div>

            <div
              v-for="(day, index) in dayLabels"
              :key="day"
              :ref="(el) => (columnRefs[index] = el)"
              class="day-col"
              :class="{ weekend: index >= 5, 'drop-target': dropDay === index }"
              :style="slotLines"
              @mousedown="onColumnMouseDown($event, index)"
              @dragover="onColumnDragOver($event, index)"
              @dragleave="onColumnDragLeave(index)"
              @drop="onColumnDrop($event, index)"
            >
              <div
                v-for="mark in marks"
                :key="mark.hour"
                class="hour-line"
                :style="{ top: `${mark.y}px` }"
              />

              <div
                v-for="block in blocksByDay[index]"
                :key="block.key"
                class="block"
                :class="{ selected: block.key === selectedKey, empty: !blockHasContent(block) }"
                :style="blockStyle(block)"
                @mousedown="startDrag($event, block, 'move')"
                @dblclick.stop="openBrowser(block.key)"
              >
                <div class="block-time">{{ toLabel(block.start) }}–{{ toLabel(block.end) }}</div>
                <div class="block-name">
                  {{
                    block.contentName ??
                    (block.hasInline ? t('grid.inlineContent') : t('grid.noContent'))
                  }}
                </div>
                <span class="block-handle" @mousedown.stop="startDrag($event, block, 'resize')" />
              </div>

              <div v-if="draft && draft.day === index" class="draft" :style="draftStyle()">
                {{ toLabel(draft.start) }}–{{ toLabel(draft.end) }}
              </div>
            </div>
          </div>
        </section>

        <aside class="card side">
          <div class="card-header">
            <h2>{{ selected ? t('grid.blockSettings') : t('grid.guide') }}</h2>
          </div>

          <div class="side-body">
            <template v-if="selected">
              <div class="field">
                <label>{{ t('grid.content') }}</label>
                <div class="content-box">
                  <span v-if="selected.contentName" class="name">{{ selected.contentName }}</span>
                  <span v-else class="muted">{{ t('grid.notAssigned') }}</span>
                </div>
                <div class="row">
                  <button class="btn btn-sm btn-primary" @click="openBrowser(selected.key)">
                    {{ t('grid.pickFromBrowser') }}
                  </button>
                  <button
                    v-if="selected.contentId"
                    class="btn btn-sm"
                    @click="openContentEditor(selected.contentId)"
                  >
                    {{ t('grid.openEditor') }}
                  </button>
                  <button
                    v-if="selected.contentId"
                    class="btn btn-sm"
                    @click="clearContent(selected)"
                  >
                    {{ t('grid.clear') }}
                  </button>
                </div>
              </div>

              <div class="field">
                <label>{{ t('grid.dayOfWeek') }}</label>
                <select
                  class="select"
                  :value="selected.day"
                  @change="moveToDay(selected, $event.target.value)"
                >
                  <option v-for="(day, index) in dayLabels" :key="day" :value="index">
                    {{ t('days.dayOfWeek', { day }) }}
                  </option>
                </select>
              </div>

              <div class="grid-2">
                <div class="field">
                  <label>{{ t('grid.start') }}</label>
                  <input
                    class="input"
                    :class="{ bad: timeError?.field === 'start' }"
                    type="time"
                    :step="grid.slotMinutes * 60"
                    :value="toLabel(selected.start)"
                    @change="updateTime(selected, 'start', $event.target.value)"
                  />
                </div>
                <div class="field">
                  <label>{{ t('grid.end') }}</label>
                  <input
                    class="input"
                    :class="{ bad: timeError?.field === 'end' }"
                    type="time"
                    :step="grid.slotMinutes * 60"
                    :value="toLabel(selected.end)"
                    @change="updateTime(selected, 'end', $event.target.value)"
                  />
                </div>
              </div>

              <!-- 틀린 이유는 칸 옆에 남는다. 토스트는 창이 사라지면 끝이다. -->
              <p v-if="timeError" class="error-text">{{ timeError.message }}</p>

              <div class="field">
                <label>{{ t('grid.durationSec') }}</label>
                <input
                  v-model.number="selected.durationSec"
                  class="input"
                  type="number"
                  min="1"
                  @change="markDirty"
                />
                <span class="hint">{{ t('grid.durationHint') }}</span>
              </div>

              <button class="btn block-btn" @click="copyToAllDays(selected)">
                {{ t('grid.copyToAllDays') }}
              </button>
              <button
                class="btn btn-danger block-btn"
                :title="t('grid.deleteBlockHint')"
                @click="removeBlock(selected)"
              >
                {{ t('grid.deleteBlock') }}
              </button>
            </template>

            <template v-else>
              <ul class="guide">
                <li>{{ t('grid.guide1') }}</li>
                <li>{{ t('grid.guide2') }}</li>
                <li>{{ t('grid.guide3') }}</li>
                <li>{{ t('grid.guide4') }}</li>
              </ul>

              <div v-if="emptyBlockCount" class="warn">
                {{ t('grid.emptyBlocksWarn', { count: emptyBlockCount }) }}
              </div>
              <div v-if="looseItems.length" class="warn">
                {{ t('grid.looseItemsWarn', { count: looseItems.length }) }}
              </div>
            </template>
          </div>
        </aside>
      </div>
    </div>

    <SchedulePreview
      v-if="previewOpen"
      :groups="previewGroups"
      :widgets="widgets"
      :show-groups="!isLoop"
      @close="previewOpen = false"
    />

    <ContentBrowser
      v-if="browserOpen"
      :selected-id="selected?.contentId ?? null"
      :org-id="schedule.org_id"
      :orientation="orientation"
      @close="closeBrowser"
      @select="applyContent"
      @create="applyAndEdit"
      @edit="openContentEditor($event.id)"
    />
  </div>
</template>
<style scoped>
/*
 * 표는 '요일 = 열, 시간 = 세로 위치' 다. 블록은 열 안에서 절대 위치로 놓고,
 * 분 단위 값을 픽셀로 바꾸는 일은 `utils/scheduleGrid` 가 한다.
 */
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  flex-wrap: wrap;
}

.title-input {
  width: 280px;
  font-size: 16px;
  font-weight: 600;
}

.check {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted);
}

.tiny {
  width: 78px;
  padding: 4px 6px;
  font-size: 12px;
}

.with-library {
  display: grid;
  grid-template-columns: 240px minmax(0,1fr);
  gap: 14px;
  align-items: start;
}

.library-panel {
  max-height: 72vh;
}

.board {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 14px;
  align-items: start;
  min-width: 0;
}

@media (max-width: 1400px) {
  .board {
  grid-template-columns: 1fr;
}
}

@media (max-width: 1000px) {
  .with-library {
  grid-template-columns: 1fr;
}

.library-panel {
  max-height: 320px;
}
}

.day-col.drop-target {
  background: var(--primary-soft);
  box-shadow: inset 0 0 0 2px var(--primary);
}

.grid-card {
  overflow: hidden;
}

.grid-head {
  display: grid;
  grid-template-columns: 56px repeat(7,1fr);
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}

.corner {
  border-right: 1px solid var(--border);
}

.day-head {
  padding: 8px 0;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  border-right: 1px solid var(--border);
}

.day-head:last-child {
  border-right: 0;
}

.day-head.weekend {
  color: var(--danger);
}

.grid-body {
  display: grid;
  grid-template-columns: 56px repeat(7,1fr);
  position: relative;
}

.time-col {
  position: relative;
  border-right: 1px solid var(--border);
}

.time-label {
  position: absolute;
  right: 6px;
  transform: translateY(-50%);
  font-size: 11px;
  color: var(--text-muted);
}

.day-col {
  position: relative;
  border-right: 1px solid var(--border);
  cursor: crosshair;
  --slot-line: color-mix(in srgb, var(--border) 55%, transparent);
}

.day-col:last-child {
  border-right: 0;
}

.day-col.weekend {
  background: var(--weekend-bg);
}

.hour-line {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px solid var(--border);
  pointer-events: none;
}

.block {
  position: absolute;
  left: 3px;
  right: 3px;
  padding: 3px 6px;
  border-radius: 5px;
  background: var(--primary);
  color: #fff;
  font-size: 11px;
  line-height: 1.3;
  overflow: hidden;
  cursor: move;
  border: 1px solid rgb(255 255 255 / 40%);
}

.block.empty {
  background: repeating-linear-gradient(45deg,#94a3b8,#94a3b8 6px,#cbd5e1 6px,#cbd5e1 12px);
  color: #1e293b;
}

.block.selected {
  outline: 2px solid #0ea5e9;
  outline-offset: 1px;
}

.block-time {
  font-weight: 600;
  opacity: .9;
}

.block-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.block-handle {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 6px;
  cursor: ns-resize;
  background: #ffffff59;
}

.draft {
  position: absolute;
  left: 3px;
  right: 3px;
  border: 2px dashed var(--primary);
  border-radius: 5px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 11px;
  padding: 2px 5px;
  pointer-events: none;
}

.side {
  overflow: hidden;
}

.card-header h2 {
  font-size: 13px;
}

.side-body {
  padding: 13px;
  max-height: 70vh;
  overflow-y: auto;
}

.content-box {
  padding: 8px 10px;
  margin-bottom: 7px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  font-size: 13px;
}

.content-box .name {
  font-weight: 600;
}

.block-btn {
  width: 100%;
  justify-content: center;
  margin-top: 8px;
}

.guide {
  margin: 0;
  padding-left: 17px;
  font-size: 12px;
  line-height: 1.9;
  color: var(--text-muted);
}

.warn {
  margin-top: 13px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--warning-soft);
  border: 1px solid var(--warning-border);
  color: var(--warning);
  font-size: 12px;
  line-height: 1.6;
}

/* 잘못된 값이 들어간 칸. 어느 칸을 고쳐야 하는지 눈으로 짚어 준다. */
.input.bad {
  border-color: var(--danger);
}
</style>
