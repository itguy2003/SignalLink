<script setup>
/**
 * 콘텐츠 캔버스 편집기.
 *
 * 하나의 콘텐츠 문서(ContentDocument)를 편집한다. 캔버스는 남은 공간을 재서
 * 잘리지 않는 최대 크기로 자동으로 채운다(`fitScale`).
 *
 * 화면 분할과 격자는 **편집 보조 장치**다. 요소는 여전히 절대 좌표를 가지므로
 * 이 기능들을 모르는 플레이어도 지금까지와 똑같이 렌더링한다
 * (utils/canvasSplit.js, utils/canvasGrid.js 주석 참조).
 *
 * 문서 객체를 직접 변형한다(부모가 저장 시점을 결정한다). 스키마는
 * backend/app/schemas/content.py 의 ContentDocument.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import AlbumEditorDialog from '@/components/AlbumEditorDialog.vue'
import MediaPicker from '@/components/MediaPicker.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import WidgetOptions from '@/components/WidgetOptions.vue'
import InfoBar from '@/components/InfoBar.vue'
import PlaylistCycle from '@/components/PlaylistCycle.vue'
import QrElement from '@/components/QrElement.vue'
import WidgetPreview from '@/components/WidgetPreview.vue'
import WidgetRail from '@/components/WidgetRail.vue'
import { useSettingsStore } from '@/stores/settings'
import { animationStyle, isLoop as isLoopAnimation } from '@/utils/animations'
import {
  ANIMATION_GROUPS,
  DEFAULT_ANIMATION,
  DEFAULT_DURATION_MS,
  MAX_DELAY_MS,
  MAX_DURATION_MS,
  MIN_DURATION_MS,
  groupKey as animationGroupKey,
  labelKey as animationLabelKey,
} from '@/utils/animations'
import { canvasLineColors } from '@/utils/canvasColor'
import { ofSize } from '@/utils/orientation'
import {
  DEFAULT_FONT,
  FONTS,
  LETTER_SPACING,
  LINE_HEIGHT,
  fontLabelKey,
  isDisplayFont,
  textStyle,
} from '@/utils/textStyle'
import { isElementDrag, readElementDrag } from '@/utils/contentDnd'
import { zoomByWheel, zoomIn, zoomOut, zoomPercent } from '@/utils/canvasZoom'
import { GRID_SIZES, isGridVisible, regionContaining, snapRect } from '@/utils/canvasGrid'
import {
  isLocked,
  isVisible,
  layerLabel,
  layerOrder,
  moveLayer,
  nudgeLayer,
  sendLayerTo,
} from '@/utils/layers'
import {
  INFO_BAR_HEIGHT,
  SPLIT_NONE,
  availableSplits,
  computeDividers,
  computeRegions,
  emptyRegions,
  fitElementToRegion,
  fitScale,
  isSplitAllowed,
  readSplit,
  refitElements,
  reservedTop,
  resizeWeights,
  resolveWeights,
} from '@/utils/canvasSplit'

const props = defineProps({
  document: { type: Object, required: true },
  widgets: { type: Array, default: () => [] },
  readonly: { type: Boolean, default: false },
  /** 원본 크기보다 크게 볼 수 있는 한도. 작은 콘텐츠도 화면을 채우게 한다. */
  maxScale: { type: Number, default: 2 },
  /** 이 콘텐츠가 속한 기관. 편집기에서 재생목록을 새로 만들 때 쓴다. */
  orgId: { type: Number, default: null },
  /**
   * 이미지·동영상 고르기의 자산 출처 — `{ list(kind), upload(file, onProgress) }`.
   * 비우면 기관 자산 라이브러리(/assets). 커뮤니티 게시물은 제 파일만 쓴다.
   */
  mediaSource: { type: Object, default: null },
})

const emit = defineEmits(['change', 'notice'])

const { t } = useI18n()
const settings = useSettingsStore()

const selectedId = ref(null)
const targetRegion = ref(null)

/** 캔버스가 쓸 수 있는 공간. ResizeObserver 로 계속 갱신한다. */
const stageRef = ref(null)
const available = ref({ width: 0, height: 0 })

/**
 * 배율. null 이면 남은 공간에 맞춘다(기본값).
 *
 * 사용자가 값을 고르면 창 크기가 바뀌어도 그대로 둔다. 편집 중에 배율이
 * 저 혼자 바뀌면 보던 자리를 잃기 때문이다.
 */
const manualZoom = ref(null)

const layout = computed(() => props.document.layout ?? { width: 1920, height: 1080 })
const elements = computed(() => props.document.elements ?? [])
const fittedScale = computed(() =>
  fitScale(layout.value, available.value, { max: props.maxScale }),
)
const scale = computed(() => manualZoom.value ?? fittedScale.value)
const isFitted = computed(() => manualZoom.value === null)

const selected = computed(() => elements.value.find((el) => el.id === selectedId.value) ?? null)

const split = computed(() => readSplit(layout.value))
const splitOptions = computed(() => availableSplits(layout.value))
const weights = computed(() => resolveWeights(split.value.key, split.value))
const regions = computed(() =>
  computeRegions(layout.value, split.value.key, split.value.gap, split.value),
)
const dividers = computed(() => computeDividers(layout.value, split.value.key, split.value))
const isSplit = computed(() => split.value.key !== SPLIT_NONE)
const openRegions = computed(() => emptyRegions(regions.value, elements.value))

/**
 * 캔버스 위에 그리는 선 색.
 *
 * 앱 테마가 아니라 **캔버스 배경색**에서 뽑는다. 캔버스 배경은 콘텐츠가 정하므로
 * 테마를 따르면 라이트 테마 + 어두운 배경 같은 조합에서 선이 배경에 묻힌다.
 */
const ink = computed(() => canvasLineColors(layout.value.background))

/** 축소가 심하면 격자가 회색 덩어리로 뭉개진다. 그럴 땐 그리지 않는다. */
const gridVisible = computed(
  () => !props.readonly && settings.gridShow && isGridVisible(settings.gridSize, scale.value),
)

/** 화면 픽셀 기준 격자 간격. 굵은 선은 5칸마다. */
const gridStyle = computed(() => {
  const step = settings.gridSize * scale.value
  const { grid, gridStrong } = ink.value
  return {
    backgroundImage: [
      `linear-gradient(to right, ${gridStrong} 1px, transparent 1px)`,
      `linear-gradient(to bottom, ${gridStrong} 1px, transparent 1px)`,
      `linear-gradient(to right, ${grid} 1px, transparent 1px)`,
      `linear-gradient(to bottom, ${grid} 1px, transparent 1px)`,
    ].join(','),
    backgroundSize: `${step * 5}px ${step * 5}px, ${step * 5}px ${step * 5}px, ${step}px ${step}px, ${step}px ${step}px`,
  }
})

/** 레이어 목록(앞에 보이는 것이 위). */
const layers = computed(() => layerOrder(elements.value))

/** 캔버스에 실제로 그릴 요소. 숨긴 것은 장치에서도 나오지 않는다. */
const drawnElements = computed(() => elements.value.filter(isVisible))

const draggingLayer = ref(null)
const layerDropIndex = ref(null)

const widgetsByCategory = computed(() => {
  const groups = {}
  for (const spec of props.widgets) {
    ;(groups[spec.category] ??= []).push(spec)
  }
  return groups
})

// ------------------------------------------------------------------ 크기 측정
let observer = null

function measure() {
  const el = stageRef.value
  if (!el) return
  available.value = { width: el.clientWidth, height: el.clientHeight }
}

onMounted(() => {
  // 레일이 재생목록을 그리므로 열 때 한 번 받아 둔다. 고르기 창을 열 때
  // 다시 받으므로, 그 사이에 늘어난 것도 창에서는 보인다.
  if (!props.readonly) loadPlaylists()
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    observer.observe(stageRef.value)
  } else {
    // jsdom 이나 오래된 브라우저에는 ResizeObserver 가 없다.
    window.addEventListener('resize', measure)
  }
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  if (observer) observer.disconnect()
  else window.removeEventListener('resize', measure)
  window.removeEventListener('keydown', onKeyDown)
})

// 다른 문서로 갈아끼우면(아이템 전환 등) 선택을 비운다.
watch(
  () => props.document,
  () => {
    selectedId.value = null
    targetRegion.value = null
  },
)

function widgetName(key) {
  return props.widgets.find((w) => w.key === key)?.name ?? key
}

function regionLabel(index) {
  return t('split.regionLabel', { index: index + 1 })
}

/** 영역 배경: 선택 > 비어 있음 > 투명. 색은 캔버스 배경에서 뽑는다. */
function regionBackground(region) {
  if (region.index === targetRegion.value) return ink.value.regionActive
  if (openRegions.value.some((r) => r.index === region.index)) return ink.value.regionFill
  return 'transparent'
}

function newId() {
  return `el-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

function touch() {
  emit('change')
}

// ------------------------------------------------------------------ 분할
function applySplit(key) {
  if (props.readonly || !isSplitAllowed(layout.value, key)) return

  props.document.layout = {
    ...layout.value,
    // 다른 분할로 바꾸면 이전 비율은 칸 수가 맞지 않으므로 균등으로 되돌린다.
    split: key === SPLIT_NONE ? null : { key, gap: split.value.gap, cols: null, rows: null },
  }
  const result = refitElements(elements.value, regions.value)
  targetRegion.value = null
  touch()

  if (key === SPLIT_NONE) return
  emit('notice', { type: 'success', text: t('split.changed', { count: regions.value.length }) })
  if (result.unbound) {
    emit('notice', { type: 'warn', text: t('split.unboundWarn', { count: result.unbound }) })
  }
}

function setGap(value) {
  if (props.readonly) return
  const gap = Math.max(0, Number(value) || 0)
  props.document.layout = { ...layout.value, split: { ...split.value, gap } }
  refitElements(elements.value, regions.value)
  touch()
}

// ------------------------------------------------------------------ 분할 크기
/** 열/행 비율을 저장하고, 영역에 묶인 요소를 새 크기에 다시 맞춘다. */
function writeWeights(cols, rows) {
  props.document.layout = { ...layout.value, split: { ...split.value, cols, rows } }
  refitElements(elements.value, regions.value)
  touch()
}

/** 사이드 패널에서 퍼센트를 직접 입력했을 때. */
function setWeightPercent(axis, index, percent) {
  const value = Number(percent)
  if (!Number.isFinite(value) || value <= 0) return

  const current = axis === 'x' ? [...weights.value.cols] : [...weights.value.rows]
  if (current.length < 2) return

  // 나머지 칸들이 남은 몫을 지금 비율대로 나눠 갖는다.
  const target = Math.min(0.92, Math.max(0.08, value / 100))
  const restTotal = current.reduce((sum, w, i) => (i === index ? sum : sum + w), 0)
  const next = current.map((w, i) =>
    i === index ? target : restTotal > 0 ? (w / restTotal) * (1 - target) : (1 - target) / (current.length - 1),
  )

  if (axis === 'x') writeWeights(next, weights.value.rows)
  else writeWeights(weights.value.cols, next)
}

function resetWeights() {
  writeWeights(null, null)
  emit('notice', { type: 'info', text: t('split.sizeReset') })
}

let dividerDrag = null

function startDividerDrag(event, divider) {
  if (props.readonly) return
  event.preventDefault()
  event.stopPropagation()
  dividerDrag = {
    divider,
    startX: event.clientX,
    startY: event.clientY,
    cols: [...weights.value.cols],
    rows: [...weights.value.rows],
  }
  window.addEventListener('mousemove', onDividerDrag)
  window.addEventListener('mouseup', endDividerDrag)
}

function onDividerDrag(event) {
  if (!dividerDrag) return
  const { divider, startX, startY, cols, rows } = dividerDrag

  if (divider.axis === 'x') {
    // 화면 이동량을 캔버스 폭에 대한 비율로 환산한다.
    const delta = (event.clientX - startX) / scale.value / layout.value.width
    props.document.layout = {
      ...layout.value,
      split: { ...split.value, cols: resizeWeights(cols, divider.index, delta), rows },
    }
  } else {
    // 행 비율은 표시줄을 뺀 높이 위에서 논다 — 전체 높이로 나누면
    // 마우스보다 분할선이 덜 움직인다.
    const usable = layout.value.height - reservedTop(layout.value)
    const delta = (event.clientY - startY) / scale.value / usable
    props.document.layout = {
      ...layout.value,
      split: { ...split.value, cols, rows: resizeWeights(rows, divider.index, delta) },
    }
  }
}

function endDividerDrag() {
  window.removeEventListener('mousemove', onDividerDrag)
  window.removeEventListener('mouseup', endDividerDrag)
  if (!dividerDrag) return
  dividerDrag = null
  refitElements(elements.value, regions.value)
  touch()
}

function pickRegion(region) {
  if (props.readonly) return
  targetRegion.value = targetRegion.value === region.index ? null : region.index
  selectedId.value = null
}

/**
 * 선택한 요소를 영역에 꽉 채운다.
 *
 * 분할이 없으면 캔버스 전체가 하나의 영역이므로 '화면 가득 채우기'가 된다.
 * 이때는 영역에 묶지 않는다. 나중에 분할을 적용했을 때 화면을 채워 둔 요소가
 * 첫 칸으로 쪼그라들면 놀라기 때문이다.
 */
function fillRegion(index = null) {
  if (!selected.value) return
  const region =
    index === null
      ? regionContaining(regions.value, selected.value.rect)
      : regions.value.find((r) => r.index === Number(index))
  if (!region) return

  fitElementToRegion(selected.value, region)
  if (!isSplit.value) delete selected.value.region

  touch()
  emit('notice', {
    type: 'success',
    text: isSplit.value
      ? t('split.filled', { region: regionLabel(region.index) })
      : t('canvas.filledScreen'),
  })
}

function unbindSelected() {
  if (!selected.value) return
  delete selected.value.region
  touch()
}

// ------------------------------------------------------------------ 요소
/**
 * 요소를 만든다.
 *
 * ``at`` 이 있으면 그 자리(캔버스 좌표)를 가운데로 놓고, 없으면 화면 가운데에
 * 놓는다. 분할 영역을 골라 둔 상태면 그 영역을 꽉 채우는 것이 우선이다.
 */
function addElement(type, widgetKey = null, at = null) {
  if (props.readonly) return
  const spec = widgetKey ? props.widgets.find((w) => w.key === widgetKey) : null
  const size = spec?.default_size ?? (type === 'qrcode' ? { w: 400, h: 400 } : { w: 600, h: 400 })

  const centerX = at ? at.x : layout.value.width / 2
  const centerY = at ? at.y : layout.value.height / 2

  const element = {
    id: newId(),
    type,
    widget_key: widgetKey,
    rect: {
      x: Math.round(centerX - size.w / 2),
      // 표시줄이 켜져 있으면 그 밑에서 시작한다 — 그 띠는 배치 영역이 아니다.
      y: Math.max(layoutTop.value, Math.round(centerY - size.h / 2)),
      w: size.w,
      h: size.h,
      z: elements.value.length + 1,
      rotation: 0,
    },
    opacity: 1,
    options:
      type === 'text'
        ? {
            text: t('canvas.blankTemplate'),
            fontSize: 64,
            color: '#ffffff',
            align: 'center',
            bold: false,
          }
        : type === 'qrcode'
          ? { text: '', foreground: '#000000', background: '#ffffff' }
          : {},
    src: null,
  }

  // 영역을 골라 둔 상태면 그 자리를 꽉 채워 만든다.
  const region = regions.value.find((r) => r.index === targetRegion.value)
  if (region) fitElementToRegion(element, region)

  props.document.elements.push(element)
  selectedId.value = element.id
  targetRegion.value = null
  touch()
}

/**
 * 애니메이션 값을 고른 요소에 쓴다.
 *
 * `animation` 은 문서에 없을 수도 있다(예전 콘텐츠). 없으면 만들어 주고,
 * '없음' 으로 되돌리면 통째로 지운다 — 쓰지 않는 값이 문서에 남으면 나중에
 * 문서를 읽는 사람이 그것이 의미 있는 설정이라고 믿게 된다.
 */
/** 동영상 옵션을 고른 요소에 쓴다. */
function setVideoOption(key, value) {
  const element = selected.value
  if (!element) return
  element.options = { ...element.options, [key]: value }
  touch()
}

function setAnimation(key, value) {
  const element = selected.value
  if (!element) return

  const next = { ...(element.animation ?? {}), [key]: value }
  if (key !== 'type') next[key] = Number(value)

  if ((next.type ?? DEFAULT_ANIMATION) === DEFAULT_ANIMATION) {
    delete element.animation
  } else {
    element.animation = {
      type: next.type,
      duration_ms: next.duration_ms ?? DEFAULT_DURATION_MS,
      delay_ms: next.delay_ms ?? 0,
    }
  }
  touch()
}

/** 왼쪽 레일에서 눌렀을 때. */
function addFromRail({ type, widgetKey }) {
  // 이미지·동영상은 '무엇을' 넣을지 먼저 정해야 의미가 있다. 빈 요소를
  // 만들어 두면 캔버스에 아무것도 안 그려진 채 남는다.
  if (type === 'image' || type === 'video') {
    openMediaPicker(type, 'add')
    return
  }
  // 재생목록은 '어느 목록인가' 를 정해야 의미가 있다. 빈 요소를 만들어 두면
  // 캔버스에 아무것도 안 그려진 채 남는다.
  if (type === 'playlist') {
    openPlaylistPicker('add')
    return
  }
  // 이미지앨범도 같다 — 사진이 없으면 캔버스에 빈 칸만 놓인다.
  if (widgetKey === ALBUM_KEY) {
    openAlbumEditor()
    return
  }
  addElement(type, widgetKey ?? null)
}

/**
 * 이미지앨범 만들기.
 *
 * 빈 앨범을 먼저 놓고 나중에 채우게 하면, 캔버스에 아무것도 안 그려진 칸이
 * 남는다 — 채우지 않고 넘어가면 그대로 저장되어 장치에서 빈 화면이 나간다.
 * 그래서 이미지·재생목록과 같은 흐름을 탄다: **고르는 것이 먼저고, 요소는
 * 고른 뒤에 만든다.**
 *
 * 이미 놓인 앨범을 고치는 것은 속성 패널이 맡는다(`ImageListEditor`).
 */
const ALBUM_KEY = 'album'
const albumEditorOpen = ref(false)
/** 창에서 담는 중인 사진들. 창을 닫을 때 이것으로 요소를 만든다. */
const pendingAlbumImages = ref([])

function openAlbumEditor() {
  if (props.readonly) return
  pendingAlbumImages.value = []
  albumEditorOpen.value = true
}

/**
 * 창을 닫는다. 담은 것이 있으면 그때 요소를 만든다.
 *
 * 한 장도 안 담고 닫았다면 만들지 않는다 — 넣으려다 마음을 바꾼 것이지
 * 빈 앨범을 놓아 달라는 뜻이 아니다.
 */
function closeAlbumEditor() {
  albumEditorOpen.value = false
  const images = pendingAlbumImages.value
  const at = pendingDropAt.value
  clearPendingDrop()
  pendingAlbumImages.value = []
  if (images.length === 0) return

  addElement('widget', ALBUM_KEY, at)
  const element = elements.value.at(-1)
  if (!element) return
  element.options = { ...element.options, images }
  touch()
}

/**
 * 이미지·동영상 고르기 창.
 *
 * 넣는 방법이 넷(업로드 / 라이브러리 / 검색 / 링크)이라 창 하나로 모았다.
 * 어느 길로 왔든 결과는 같다 — 요소의 `src` 하나가 정해질 뿐이다.
 */
const mediaPickerOpen = ref(false)
/** 'image' | 'video'. 고를 갈래를 창에 알려 준다. */
const mediaKind = ref('image')
/**
 * 고른 뒤에 할 일. 'add' 는 새 요소를 만들고, 'replace' 는 지금 고른 요소의
 * 주소만 갈아 끼운다 — 바꾸려고 지웠다 다시 만들게 하면 크기와 자리를
 * 다시 잡아야 한다.
 */
const mediaMode = ref('add')

function openMediaPicker(kind, mode = 'add') {
  if (props.readonly) return
  mediaKind.value = kind
  mediaMode.value = mode
  mediaPickerOpen.value = true
}

/**
 * 고른 소재를 캔버스에 놓는다.
 *
 * `credit` 은 스톡 검색에서만 따라온다. `size` 는 원본 크기로, 있으면 그
 * 비율에 맞춰 상자를 잡는다 — 기본 상자(600x400)에 세로 사진을 넣으면
 * 눌려 보인다.
 */
function chooseMedia({ src, credit = null, size = null }) {
  mediaPickerOpen.value = false
  if (mediaMode.value === 'replace') {
    clearPendingDrop()
    if (selected.value) applyMedia(selected.value, src, credit)
    return
  }

  const at = pendingDropAt.value
  clearPendingDrop()
  addElement(mediaKind.value, null, at)
  const element = elements.value.at(-1)
  if (!element) return
  if (size?.width && size?.height) fitRatio(element, size.width / size.height)
  applyMedia(element, src, credit)
}

/**
 * 요소에 주소를 넣는다. 출처가 따라오면 함께 적는다 — 제공처 약관이 표시를
 * 권하고, 나중에 어디서 가져온 것인지 추적할 수단이 이것뿐이다.
 */
function applyMedia(element, src, credit) {
  element.src = src
  if (credit) element.options = { ...element.options, ...credit }
  touch()
}

/** 넓이는 그대로 두고 높이만 비율에 맞춘다. 가운데는 움직이지 않는다. */
function fitRatio(element, ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return
  const rect = element.rect
  const height = Math.round(rect.w / ratio)
  rect.y = Math.round(rect.y + (rect.h - height) / 2)
  rect.h = height
}

/**
 * 끌어다 놓은 자리(캔버스 좌표). 고르기 창을 거치는 요소는 고른 뒤에야
 * 만들어지므로, 그때까지 놓은 자리를 들고 있어야 그 자리에 생긴다.
 * 버튼으로 추가한 경우에는 null 이라 화면 가운데에 놓인다.
 */
const pendingDropAt = ref(null)

/** 고르기 창을 닫을 때 항상 비운다. 남아 있으면 다음 추가가 엉뚱한 자리에 생긴다. */
function clearPendingDrop() {
  pendingDropAt.value = null
}

/** 재생목록 고르기. 레일의 재생목록 버튼과 속성 패널의 '변경'이 연다. */
const playlistPickerOpen = ref(false)
const playlists = ref([])
const playlistsLoading = ref(false)
const playlistQuery = ref('')
const playlistName = ref('')
const playlistCreating = ref(false)

/**
 * 고른 뒤에 할 일. 'add' 는 새 요소를 만들고, 'replace' 는 지금 고른 요소의
 * 재생목록만 갈아 끼운다 — 놓고 나서 다른 목록으로 바꾸려고 지웠다 다시
 * 만들게 하면 크기와 자리를 다시 잡아야 한다.
 */
const playlistPickerMode = ref('add')

/**
 * 고르기 레이어의 미리보기 크기.
 *
 * 안쪽은 실제 표출 해상도로 그리고 바깥에서 한 번 줄인다(위젯 미리보기와
 * 같은 방식). 작은 상자에 그대로 그리면 글자 크기가 실제와 달라져, 줄어든
 * 화면이 아니라 다른 화면이 된다.
 */
const THUMB_DOC_WIDTH = 1920
const THUMB_DOC_HEIGHT = 1080
const THUMB_SCALE = 0.075

/** 재생목록의 첫 칸. 목록이 비어 있으면 null. */
function firstWidget(playlist) {
  return playlist.items?.[0] ?? null
}

const visiblePlaylists = computed(() => {
  const keyword = playlistQuery.value.trim().toLowerCase()
  if (!keyword) return playlists.value
  return playlists.value.filter((p) => p.name.toLowerCase().includes(keyword))
})

async function loadPlaylists() {
  playlistsLoading.value = true
  try {
    // 열 때마다 다시 받는다. 한 번 받아 두면 다른 탭에서 만든 목록이
    // 이 화면에서는 영영 보이지 않는다.
    playlists.value = (await api.get('/playlists', { size: 100 }).catch(() => null))?.items ?? []
  } finally {
    playlistsLoading.value = false
  }
}

async function openPlaylistPicker(mode = 'add') {
  playlistPickerMode.value = mode
  playlistQuery.value = ''
  playlistName.value = ''
  playlistPickerOpen.value = true
  await loadPlaylists()
}

/**
 * 편집기 안에서 재생목록을 새로 만든다.
 *
 * 만든 것이 하나도 없으면 고르기 창이 막다른 길이 된다 — 재생목록 화면으로
 * 나가야 하는데, 편집 중인 내용이 있으면 나가는 것 자체가 대가를 치른다.
 * 빈 목록으로 만들어 자리부터 잡아 두고, 담는 일은 재생목록 편집기에서 한다.
 */
async function createPlaylist() {
  const name = playlistName.value.trim()
  if (!name || playlistCreating.value) return
  playlistCreating.value = true
  try {
    const created = await api.post('/playlists', {
      name,
      org_id: props.orgId ?? undefined,
      items: [],
    })
    emit('notice', { type: 'success', message: t('widgetPlaylist.created', { name }) })
    choosePlaylist(created)
  } catch (err) {
    emit('notice', { type: 'error', message: err.detail ?? t('org.saveFailed') })
  } finally {
    playlistCreating.value = false
  }
}

/**
 * 고른 재생목록을 캔버스에 놓는다.
 *
 * 문서에는 **참조만** 남긴다(`options.playlist_id`). 서버가 플레이어에게
 * 내려줄 때 실제 칸 목록을 채워 주므로, 재생목록을 고치면 다음 표출에
 * 그대로 반영된다 — 콘텐츠를 다시 저장할 필요가 없다.
 */
function choosePlaylist(playlist) {
  playlistPickerOpen.value = false
  if (playlistPickerMode.value === 'replace') {
    replacePlaylist(playlist)
    return
  }

  const at = pendingDropAt.value
  clearPendingDrop()
  addElement('playlist', null, at)

  const element = elements.value.at(-1)
  if (!element) return
  applyPlaylist(element, playlist)
}

/** 이미 놓인 요소의 재생목록만 갈아 끼운다. 크기와 자리는 그대로 둔다. */
function replacePlaylist(playlist) {
  clearPendingDrop()
  const element = selected.value
  if (!element) return
  applyPlaylist(element, playlist)
}

function applyPlaylist(element, playlist) {
  element.options = {
    ...element.options,
    playlist_id: playlist.id,
    // 편집기에서 보여 주기 위한 사본. 표출에는 쓰이지 않는다 —
    // 실제 칸 목록은 서버가 내려줄 때 채운다.
    playlist_name: playlist.name,
    playlist_item_count: playlist.items?.length ?? 0,
  }
  touch()
}

/** 레일에서 캔버스로 끌어다 놓았을 때. 떨어뜨린 자리에 만든다. */
function onCanvasDragOver(event) {
  if (!isElementDrag(event)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
}

function onCanvasDrop(event) {
  if (props.readonly || !isElementDrag(event)) return
  event.preventDefault()

  const payload = readElementDrag(event)
  if (!payload) return

  // 화면 좌표를 캔버스 좌표로 되돌린다.
  const rect = event.currentTarget.getBoundingClientRect()
  const at = {
    x: (event.clientX - rect.left) / scale.value,
    y: (event.clientY - rect.top) / scale.value,
  }
  // 이미지와 재생목록은 '무엇을' 넣을지 먼저 정해야 한다. 빈 요소를 만들어
  // 두면 캔버스에 아무것도 안 그려진 채 남는다. 놓은 자리를 기억해 두고
  // 고르기 창을 연다 — 클릭으로 추가하는 경로와 같은 흐름이다.
  if (payload.type === 'image' || payload.type === 'video' || payload.type === 'playlist') {
    pendingDropAt.value = at
    if (payload.type === 'playlist') openPlaylistPicker('add')
    else openMediaPicker(payload.type, 'add')
    return
  }
  if (payload.widgetKey === ALBUM_KEY) {
    pendingDropAt.value = at
    openAlbumEditor()
    return
  }
  addElement(payload.type, payload.widgetKey ?? null, at)
}

function removeElement(id) {
  props.document.elements = elements.value.filter((el) => el.id !== id)
  if (selectedId.value === id) selectedId.value = null
  touch()
}

// ------------------------------------------------------------------ 줌
function stepZoom(direction) {
  const current = scale.value
  manualZoom.value = direction > 0 ? zoomIn(current) : zoomOut(current)
}

function fitToScreen() {
  manualZoom.value = null
}

function setZoom(value) {
  manualZoom.value = Number(value)
}

/** Ctrl(또는 ⌘) + 휠로 확대/축소. 그냥 굴리면 평소처럼 스크롤한다. */
function onWheel(event) {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  manualZoom.value = zoomByWheel(scale.value, event.deltaY)
}

// ------------------------------------------------------------------ 키보드
/** 입력 중에는 단축키를 막는다. 글자를 지우려던 것이 요소 삭제가 되면 안 된다. */
function isTyping(target) {
  if (!target) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function onKeyDown(event) {
  if (props.readonly || isTyping(event.target)) return

  if (event.key === 'Escape') {
    selectedId.value = null
    targetRegion.value = null
    return
  }

  if (event.key !== 'Delete' && event.key !== 'Backspace') return
  if (!selected.value) return
  // 잠근 요소는 실수로 지우지 못하게 한다(끌 수 없는 것과 같은 이유).
  if (isLocked(selected.value)) return

  event.preventDefault()
  removeElement(selected.value.id)
}

// ------------------------------------------------------------------ 동영상 소리
/**
 * 브라우저가 소리 있는 자동재생을 막았는가.
 *
 * 막히면 아무것도 재생되지 않는다 — 소리를 끄고 트는 편이 낫다. 대신 켤 수
 * 있는 버튼을 띄운다. 사용자가 한 번 누르면 그때부터는 허용된다.
 *
 * 장치(플레이어)에는 이 제약이 없다. 문서에 적힌 `muted: false` 를 그대로
 * 따르면 되고, 이 처리는 브라우저에서 볼 때만 필요하다.
 */
const soundBlocked = ref(false)

/** 지금 이 요소를 소리 없이 틀어야 하는가. */
function isMuted(element) {
  // 편집 중에는 재생하지 않으므로 언제나 끈다. 여러 개를 놓았을 때
  // 소리가 겹쳐 나오면 자리조차 잡을 수 없다.
  if (!props.readonly) return true
  if (element.options?.muted !== false) return true
  return soundBlocked.value
}

/** 화면에 떠 있는 동영상 요소들. 소리를 한꺼번에 켜는 데 쓴다. */
const videoElements = new Map()

function registerVideo(element, el) {
  if (!el) {
    videoElements.delete(element.id)
    return
  }
  videoElements.set(element.id, el)
  if (!props.readonly || element.options?.muted !== false) return

  // 소리를 켜 달라는 요소다. 막히는지는 눌러 봐야 안다.
  el.muted = false
  el.volume = Number(element.options?.volume ?? 1)
  el.play?.().catch(() => {
    el.muted = true
    el.play?.().catch(() => {})
    soundBlocked.value = true
  })
}

/** 사용자가 한 번 눌러 소리를 켠다. 브라우저가 요구하는 '동작' 이 이것이다. */
function enableSound() {
  soundBlocked.value = false
  for (const [id, el] of videoElements) {
    const element = elements.value.find((e) => e.id === id)
    if (element?.options?.muted !== false) continue
    el.muted = false
    el.volume = Number(element.options?.volume ?? 1)
    el.play?.().catch(() => {})
  }
}

// ------------------------------------------------------------------ 레이어
function nameOf(element) {
  return layerLabel(element, {
    widgetName,
    fallback: t(`canvas.element.${element.type}`),
  })
}

function toggleVisible(element) {
  element.visible = !isVisible(element)
  // 숨긴 요소를 선택해 두면 속성 패널만 떠 있고 화면에는 없어 헷갈린다.
  if (!element.visible && selectedId.value === element.id) selectedId.value = null
  touch()
}

function toggleLocked(element) {
  element.locked = !isLocked(element)
  touch()
}

function nudge(element, offset) {
  if (nudgeLayer(elements.value, element.id, offset)) touch()
}

function sendTo(element, position) {
  if (sendLayerTo(elements.value, element.id, position)) touch()
}

function onLayerDragStart(event, index) {
  draggingLayer.value = index
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(index))
}

function onLayerDragOver(event, index) {
  if (draggingLayer.value === null) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  layerDropIndex.value = index
}

function onLayerDrop(index) {
  const from = draggingLayer.value
  draggingLayer.value = null
  layerDropIndex.value = null
  if (from === null) return
  if (moveLayer(elements.value, from, index)) touch()
}

function onLayerDragEnd() {
  draggingLayer.value = null
  layerDropIndex.value = null
}

// ------------------------------------------------------------------ 드래그
let drag = null

function startDrag(event, element, mode) {
  // 잠근 요소는 실수로 옮기지 못하게 막는다. 선택은 레이어 목록에서 한다.
  if (props.readonly || isLocked(element)) return
  event.preventDefault()
  event.stopPropagation()
  selectedId.value = element.id
  targetRegion.value = null
  drag = {
    mode,
    element,
    startX: event.clientX,
    startY: event.clientY,
    origin: { ...element.rect },
  }
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', endDrag)
}

function onDrag(event) {
  if (!drag) return
  // 화면 좌표를 캔버스 좌표계로 되돌린 뒤 격자에 맞춘다.
  const dx = Math.round((event.clientX - drag.startX) / scale.value)
  const dy = Math.round((event.clientY - drag.startY) / scale.value)
  const size = settings.gridSnap ? settings.gridSize : 0

  if (drag.mode === 'move') {
    const next = snapRect(
      { ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy },
      size,
      'move',
    )
    drag.element.rect.x = next.x
    // 표시줄 밑으로는 못 올라간다 — 그 띠는 배치 영역이 아니다.
    drag.element.rect.y = Math.max(layoutTop.value, next.y)
  } else {
    const next = snapRect(
      {
        ...drag.origin,
        w: Math.max(40, drag.origin.w + dx),
        h: Math.max(30, drag.origin.h + dy),
      },
      size,
      'resize',
    )
    drag.element.rect.w = next.w
    drag.element.rect.h = next.h
  }
}

function endDrag() {
  if (drag) {
    // 손으로 옮긴 요소는 더 이상 영역과 일치하지 않는다. 묶음을 풀어 두어야
    // 분할을 바꿀 때 엉뚱한 자리로 되돌아가지 않는다.
    if (drag.element.region !== undefined) delete drag.element.region
    touch()
  }
  drag = null
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', endDrag)
}

/**
 * 배치가 시작되는 y. 표시줄이 켜져 있으면 그 띠(INFO_BAR_HEIGHT)는 배치
 * 영역이 아니다 — 요소를 그 밑에 깔아 두면 표시줄에 가려 보이지 않는 채
 * 저장된다. 꺼져 있으면 제한이 없다 — 요소를 일부러 캔버스 위 밖으로
 * 걸치는 연출은 원래 허용된다.
 */
const layoutTop = computed(() => (layout.value.info_bar ? INFO_BAR_HEIGHT : -Infinity))

/**
 * 상단 정보 표시줄을 켜고 끈다.
 *
 * 끄면 키 자체를 지운다 — 안 쓰는 값이 문서에 남으면 나중에 읽는 사람이
 * 의미 있는 설정이라고 믿게 된다.
 */
function setInfoBar(on) {
  if (on) {
    props.document.layout = { ...layout.value, info_bar: true }
  } else {
    const next = { ...layout.value }
    delete next.info_bar
    props.document.layout = next
  }
  // 분할 영역이 표시줄만큼 줄거나 늘었다 — 영역에 묶인 요소를 새 자리에
  // 다시 맞춘다. 자유 배치 요소는 건드리지 않는다.
  refitElements(elements.value, regions.value)
  if (on) {
    // 표시줄 자리에 깔린 자유 배치 요소는 아래로 내린다. 그대로 두면
    // 표시줄에 가려 보이지 않는 채 저장된다.
    for (const element of elements.value) {
      if (element.rect.y < INFO_BAR_HEIGHT) element.rect.y = INFO_BAR_HEIGHT
    }
  }
  touch()
}

function setOrientation(portrait) {
  const next = portrait
    ? { ...layout.value, width: 1080, height: 1920 }
    : { ...layout.value, width: 1920, height: 1080 }

  // 방향이 바뀌면 기존 분할이 더 이상 유효하지 않을 수 있다.
  if (!isSplitAllowed(next, split.value.key)) {
    next.split = null
    emit('notice', { type: 'info', text: t('split.resetOnOrientation') })
  }

  props.document.layout = next
  const nextSplit = readSplit(next)
  refitElements(
    elements.value,
    computeRegions(next, nextSplit.key, nextSplit.gap, nextSplit),
  )
  touch()
}

defineExpose({ setOrientation, applySplit, fillRegion, resetWeights, fitToScreen })
</script>

<template>
  <div class="canvas-editor" :class="{ readonly }">
    <!-- 왼쪽: 요소·위젯 아이콘 레일 -->
    <WidgetRail
      v-if="!readonly"
      :widgets="widgets"
      :target-region="targetRegion"
      @add="addFromRail"
    />

    <div class="stage-wrap">
      <div class="stage" @wheel="onWheel">
        <div ref="stageRef" class="stage-inner">
          <div
            class="canvas"
          :style="{
            width: `${layout.width * scale}px`,
            height: `${layout.height * scale}px`,
            background: layout.background,
          }"
          @click.self="selectedId = null"
          @dragover="onCanvasDragOver"
          @drop="onCanvasDrop"
        >
          <!-- 상단 정보 표시줄. 문서 설정이라 편집·미리보기·장치가 같은 줄을 그린다. -->
          <InfoBar v-if="layout.info_bar" :scale="scale" :org-id="orgId" />

          <!-- 격자: 테마 색을 쓰고 클릭은 통과시킨다. -->
          <div v-if="gridVisible" class="grid-overlay" :style="gridStyle" />

          <!-- 분할 안내선: 요소보다 아래에 깔고 클릭만 받는다. -->
          <template v-if="isSplit && !readonly">
            <div
              v-for="region in regions"
              :key="`region-${region.index}`"
              class="region"
              :class="{ active: region.index === targetRegion }"
              :style="{
                left: `${region.x * scale}px`,
                top: `${region.y * scale}px`,
                width: `${region.w * scale}px`,
                height: `${region.h * scale}px`,
                borderColor: ink.region,
                background: regionBackground(region),
              }"
              @click.self="pickRegion(region)"
            >
              <span class="region-tag" :style="{ background: ink.chipBg, color: ink.chipText }">
                {{ regionLabel(region.index) }} · {{ region.w }}×{{ region.h }}
              </span>
              <span
                v-if="!readonly && openRegions.some((r) => r.index === region.index)"
                class="region-add"
                :style="{ background: ink.region }"
              >
                + {{ t('split.addHere') }}
              </span>
            </div>

            <!-- 끌어서 영역 크기를 바꾸는 손잡이. 요소보다 위에 두어 항상 잡힌다. -->
            <div
              v-for="divider in dividers"
              v-show="!readonly"
              :key="`divider-${divider.axis}-${divider.index}`"
              class="divider"
              :class="divider.axis === 'x' ? 'vertical' : 'horizontal'"
              :style="
                divider.axis === 'x'
                  ? {
                      left: `${divider.position * scale}px`,
                      top: `${reservedTop(layout) * scale}px`,
                      background: ink.divider,
                    }
                  : { top: `${divider.position * scale}px`, background: ink.divider }
              "
              :title="t('split.dragDivider')"
              @mousedown="startDividerDrag($event, divider)"
            />
          </template>

          <div
            v-for="element in drawnElements"
            :key="element.id"
            class="element"
            :class="{ selected: element.id === selectedId, readonly, locked: isLocked(element) }"
            :style="{
              outlineColor: element.id === selectedId ? ink.region : undefined,
              left: `${element.rect.x * scale}px`,
              top: `${element.rect.y * scale}px`,
              width: `${element.rect.w * scale}px`,
              height: `${element.rect.h * scale}px`,
              zIndex: 10 + element.rect.z,
              opacity: element.opacity,
              // 편집 중에는 돌리지 않는다. 움직이는 요소는 잡을 수가 없다.
              ...(readonly ? animationStyle(element.animation) : {}),
            }"
            @mousedown="startDrag($event, element, 'move')"
          >
            <div
              v-if="element.type === 'text'"
              class="el-text"
              :style="{
                ...textStyle(element.options),
                // 글자 크기만 배율을 곱한다. 나머지는 배율과 무관하다.
                fontSize: `${(element.options.fontSize ?? 48) * scale}px`,
              }"
            >
              {{ element.options.text }}
            </div>

            <QrElement
              v-else-if="element.type === 'qrcode'"
              :text="element.options.text"
              :foreground="element.options.foreground"
              :background="element.options.background"
            />

            <img
              v-else-if="element.type === 'image' && element.src"
              class="el-image"
              :src="element.src"
              alt=""
            />

            <!--
              동영상. 편집 중에는 첫 프레임만 세워 둔다 — 자리와 크기를 잡는
              동안 영상이 돌면 눈이 그쪽으로 끌려가고, 여러 개를 놓으면 그만큼
              무거워진다. 미리보기와 실제 표출에서만 돌린다.

              소리는 끈 채로 튼다. 소리가 있는 자동재생은 브라우저가 막아,
              켜 두면 아예 시작되지 않는다.
            -->
            <video
              v-else-if="element.type === 'video' && element.src"
              :ref="(el) => registerVideo(element, el)"
              class="el-video"
              :src="element.src"
              :autoplay="readonly"
              :loop="element.options?.loop !== false"
              :muted="isMuted(element)"
              playsinline
              preload="metadata"
            />

            <!--
              재생목록: 편집기에서는 무엇이 몇 개 도는지만 보여 준다. 실제
              순환은 플레이어가 한다(서버가 칸 목록을 채워 내려준다).
            -->
            <!-- 미리보기에서는 실제로 돈다. 편집 중에는 자리와 크기를 잡는
                 것이 일이라 이름만 보여 주는 편이 읽기 쉽다. -->
            <PlaylistCycle
              v-else-if="element.type === 'playlist' && readonly"
              :playlist-id="element.options?.playlist_id ?? null"
              :widgets="widgets"
              :width="element.rect.w"
              :height="element.rect.h"
              :scale="scale"
              :name="element.options?.playlist_name ?? t('widgetPlaylist.element')"
            />

            <div v-else-if="element.type === 'playlist'" class="el-playlist">
              <span class="pl-icon">🔁</span>
              <span class="pl-name">{{ element.options?.playlist_name ?? t('widgetPlaylist.element') }}</span>
            </div>

            <!-- 웹페이지: 실제 주소를 불러와 보여 준다. -->
            <div
              v-else-if="element.type === 'web'"
              class="el-web"
              :style="{
                width: `${element.rect.w}px`,
                height: `${element.rect.h}px`,
                transform: `scale(${scale})`,
              }"
            >
              <div class="web-bar">
                <span class="web-dots"><i /><i /><i /></span>
                <span class="web-url">{{ element.src || t('canvas.webNoUrl') }}</span>
              </div>

              <!--
                주소는 사용자가 넣는 값이라 sandbox 로 가둔다. same-origin 을 주지
                않아 그 페이지가 자기 저장소나 쿠키에 접근하지 못한다.
                pointer-events 를 꺼야 요소를 끌 때 iframe 이 마우스를 가로채지 않는다.
              -->
              <iframe
                v-if="element.src"
                :src="element.src"
                class="web-frame"
                sandbox="allow-scripts"
                referrerpolicy="no-referrer"
                loading="lazy"
                title=""
              />
              <div v-else class="web-empty">{{ t('canvas.webEnterUrl') }}</div>
            </div>

            <!-- 위젯은 샘플 데이터로 실제와 비슷하게 그린다. -->
            <WidgetPreview
              v-else-if="element.type === 'widget'"
              :widget-key="element.widget_key"
              :options="element.options"
              :name="widgetName(element.widget_key)"
              :width="element.rect.w"
              :height="element.rect.h"
              :scale="scale"
              :playing="readonly"
            />

            <div v-else class="el-placeholder">
              <span class="el-kind">{{ element.type }}</span>
            </div>

            <span
              v-if="!readonly && !isLocked(element)"
              class="handle"
              :style="{ background: ink.region }"
              @mousedown.stop="startDrag($event, element, 'resize')"
            />
          </div>
          </div>
        </div>
      </div>

      <div class="stage-bar">
        <div v-if="!readonly" class="zoom">
          <button class="btn btn-sm btn-icon" :title="t('zoom.out')" @click="stepZoom(-1)">−</button>
          <select
            class="select tiny"
            :value="isFitted ? '' : String(scale)"
            :aria-label="t('zoom.label')"
            @change="$event.target.value ? setZoom($event.target.value) : fitToScreen()"
          >
            <option value="">{{ t('zoom.fit') }} ({{ zoomPercent(fittedScale) }}%)</option>
            <option v-if="!isFitted" :value="String(scale)">{{ zoomPercent(scale) }}%</option>
            <option v-for="level in [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]" :key="level" :value="String(level)">
              {{ zoomPercent(level) }}%
            </option>
          </select>
          <button class="btn btn-sm btn-icon" :title="t('zoom.in')" @click="stepZoom(1)">+</button>
        </div>

        <span class="hint">
          {{
            t('canvas.previewInfo', {
              width: layout.width,
              height: layout.height,
              scale: Math.round(scale * 100),
            })
          }}
        </span>

        <span v-if="targetRegion !== null" class="badge badge-primary">
          {{ t('split.targetRegion', { region: regionLabel(targetRegion) }) }}
        </span>

        <div v-if="!readonly" class="spacer" />

        <label v-if="!readonly" class="check">
          <input
            type="checkbox"
            :checked="settings.gridShow"
            @change="settings.setGridShow($event.target.checked)"
          />
          {{ t('grid2.show') }}
        </label>
        <label v-if="!readonly" class="check">
          <input
            type="checkbox"
            :checked="settings.gridSnap"
            @change="settings.setGridSnap($event.target.checked)"
          />
          {{ t('grid2.snap') }}
        </label>
        <select
          v-if="!readonly"
          class="select tiny grid-size"
          :value="settings.gridSize"
          :aria-label="t('grid2.size')"
          @change="settings.setGridSize($event.target.value)"
        >
          <option v-for="size in GRID_SIZES" :key="size" :value="size">{{ size }}px</option>
        </select>
      </div>
    </div>

    <aside v-if="!readonly" class="card side">
      <!-- 상단: 캔버스 전체에 걸리는 명령 -->
      <section class="section canvas-section">
        <h3 class="section-title">{{ t('canvas.sectionCanvas') }}</h3>

        <div class="section-body">
          <div class="palette-group">
            <h4>{{ t('infoBar.title') }}</h4>
            <!-- 문서에 저장된다 — 편집기 장식이 아니라 표출 화면의 일부다. -->
            <label class="check info-toggle">
              <input
                type="checkbox"
                :checked="layout.info_bar === true"
                @change="setInfoBar($event.target.checked)"
              />
              {{ t('infoBar.toggle') }}
            </label>
          </div>

          <div class="palette-group">
            <h4>{{ t('canvas.orientation') }}</h4>
            <div class="row">
              <button class="btn btn-sm" @click="setOrientation(false)">
                {{ t('canvas.landscape') }}
              </button>
              <button class="btn btn-sm" @click="setOrientation(true)">
                {{ t('canvas.portrait') }}
              </button>
            </div>
          </div>

          <div class="palette-group">
            <h4>{{ t('split.title') }}</h4>
            <div class="split-list">
              <button
                v-for="preset in splitOptions"
                :key="preset.key"
                class="split-btn"
                :class="{ active: preset.key === split.key }"
                @click="applySplit(preset.key)"
              >
                <span class="split-preview" :class="`sp-${preset.key}`">
                  <i v-for="n in preset.cols * preset.rows" :key="n" />
                </span>
                {{ t(`split.${preset.key}`) }}
              </button>
            </div>

            <template v-if="isSplit">
              <div class="size-block">
                <div class="size-head">
                  <span>{{ t('split.sizes') }}</span>
                  <button class="btn btn-sm" @click="resetWeights">
                    {{ t('split.sizeResetBtn') }}
                  </button>
                </div>

                <div v-if="weights.cols.length > 1" class="size-row">
                  <span class="size-axis">{{ t('split.colWidths') }}</span>
                  <label
                    v-for="(value, index) in weights.cols"
                    :key="`c${index}`"
                    class="size-input"
                  >
                    <input
                      class="input"
                      type="number"
                      min="8"
                      max="92"
                      :value="Math.round(value * 100)"
                      @change="setWeightPercent('x', index, $event.target.value)"
                    />
                    <span>%</span>
                  </label>
                </div>

                <div v-if="weights.rows.length > 1" class="size-row">
                  <span class="size-axis">{{ t('split.rowHeights') }}</span>
                  <label
                    v-for="(value, index) in weights.rows"
                    :key="`r${index}`"
                    class="size-input"
                  >
                    <input
                      class="input"
                      type="number"
                      min="8"
                      max="92"
                      :value="Math.round(value * 100)"
                      @change="setWeightPercent('y', index, $event.target.value)"
                    />
                    <span>%</span>
                  </label>
                </div>
              </div>

              <div class="field gap-field">
                <label>{{ t('split.gap') }}</label>
                <input
                  class="input"
                  type="number"
                  min="0"
                  :value="split.gap"
                  @change="setGap($event.target.value)"
                />
              </div>
              <p class="hint">{{ t('split.pickRegionHint') }}</p>
              <p class="hint">{{ t('split.dragDividerHint') }}</p>
            </template>
          </div>

          <div class="palette-group">
            <h4>{{ t('canvas.background') }}</h4>
            <input v-model="document.layout.background" class="input" type="color" @change="touch" />
          </div>

        </div>
      </section>

      <!-- 가운데: 레이어. 캔버스와 요소를 잇는 자리다. -->
      <section class="section layer-section">
        <h3 class="section-title">
          {{ t('layer.title') }}
          <span class="muted count">{{ layers.length }}</span>
        </h3>

        <div class="section-body layer-list" @dragleave="layerDropIndex = null">
          <p v-if="layers.length === 0" class="hint pad">{{ t('layer.empty') }}</p>

          <div
            v-for="(element, index) in layers"
            :key="element.id"
            class="layer"
            :class="{
              active: element.id === selectedId,
              hidden: !isVisible(element),
              'drop-before': layerDropIndex === index,
              dragging: draggingLayer === index,
            }"
            draggable="true"
            @click="selectedId = element.id"
            @dragstart="onLayerDragStart($event, index)"
            @dragover="onLayerDragOver($event, index)"
            @drop="onLayerDrop(index)"
            @dragend="onLayerDragEnd"
          >
            <span class="layer-grip" :title="t('layer.dragToReorder')">⠿</span>

            <button
              class="icon-btn"
              :title="isVisible(element) ? t('layer.hide') : t('layer.show')"
              @click.stop="toggleVisible(element)"
            >
              {{ isVisible(element) ? '👁' : '🚫' }}
            </button>

            <button
              class="icon-btn"
              :title="isLocked(element) ? t('layer.unlock') : t('layer.lock')"
              @click.stop="toggleLocked(element)"
            >
              {{ isLocked(element) ? '🔒' : '🔓' }}
            </button>

            <span class="layer-name">{{ nameOf(element) }}</span>

            <span class="layer-actions">
              <button
                class="icon-btn"
                :disabled="index === 0"
                :title="t('layer.bringForward')"
                @click.stop="nudge(element, -1)"
              >
                ↑
              </button>
              <button
                class="icon-btn"
                :disabled="index === layers.length - 1"
                :title="t('layer.sendBackward')"
                @click.stop="nudge(element, 1)"
              >
                ↓
              </button>
              <button class="icon-btn danger" :title="t('canvas.deleteElement')" @click.stop="removeElement(element.id)">
                ✕
              </button>
            </span>
          </div>

          <div
            v-if="layers.length"
            class="layer-tail"
            :class="{ over: layerDropIndex === layers.length }"
            @dragover="onLayerDragOver($event, layers.length)"
            @drop="onLayerDrop(layers.length)"
          >
            {{ t('layer.dropBottom') }}
          </div>
        </div>
      </section>

      <!-- 하단: 선택한 요소(위젯) 설정 -->
      <section class="section element-section">
        <h3 class="section-title">
          {{ t('canvas.elementProps') }}
          <span v-if="selected" class="badge badge-primary">
            {{ selected.type === 'widget' ? widgetName(selected.widget_key) : selected.type }}
          </span>
        </h3>

        <div class="section-body">
          <p v-if="!selected" class="hint pad">{{ t('canvas.selectElementHint') }}</p>

          <template v-else>
            <div class="field">
              <label>{{ isSplit ? t('split.fitToRegion') : t('canvas.fitToScreen') }}</label>
              <button class="btn btn-primary block fill-btn" @click="fillRegion()">
                {{ isSplit ? t('split.fillRegion') : t('canvas.fillScreen') }}
              </button>

              <template v-if="isSplit">
                <select
                  class="select"
                  :value="selected.region ?? ''"
                  @change="fillRegion($event.target.value)"
                >
                  <option value="" disabled>{{ t('split.unbound') }}</option>
                  <option v-for="region in regions" :key="region.index" :value="region.index">
                    {{ regionLabel(region.index) }}
                  </option>
                </select>
                <button
                  v-if="selected.region !== undefined"
                  class="btn btn-sm"
                  @click="unbindSelected"
                >
                  {{ t('split.unbind') }}
                </button>
              </template>
            </div>

            <div class="field">
              <label>{{ t('layer.order') }}</label>
              <div class="row">
                <button class="btn btn-sm" @click="sendTo(selected, 'front')">
                  {{ t('layer.toFront') }}
                </button>
                <button class="btn btn-sm" @click="sendTo(selected, 'back')">
                  {{ t('layer.toBack') }}
                </button>
              </div>
            </div>

            <div class="grid-2">
              <div class="field">
                <label>X</label>
                <input v-model.number="selected.rect.x" class="input" type="number" @change="touch" />
              </div>
              <div class="field">
                <label>Y</label>
                <input v-model.number="selected.rect.y" class="input" type="number" @change="touch" />
              </div>
              <div class="field">
                <label>{{ t('device.widthRes') }}</label>
                <input v-model.number="selected.rect.w" class="input" type="number" @change="touch" />
              </div>
              <div class="field">
                <label>{{ t('device.heightRes') }}</label>
                <input v-model.number="selected.rect.h" class="input" type="number" @change="touch" />
              </div>
            </div>

            <template v-if="selected.type === 'qrcode'">
              <div class="field">
                <label>{{ t('canvas.qrText') }}</label>
                <!-- 주소가 길다 — 여러 줄로 받는다. -->
                <textarea
                  v-model="selected.options.text"
                  class="textarea"
                  rows="3"
                  :placeholder="t('canvas.qrPlaceholder')"
                  @input="touch"
                />
              </div>
              <div class="grid-2">
                <div class="field">
                  <label>{{ t('canvas.qrForeground') }}</label>
                  <input
                    v-model="selected.options.foreground"
                    class="input"
                    type="color"
                    @change="touch"
                  />
                </div>
                <div class="field">
                  <label>{{ t('canvas.qrBackground') }}</label>
                  <input
                    v-model="selected.options.background"
                    class="input"
                    type="color"
                    @change="touch"
                  />
                </div>
              </div>
              <p class="hint">{{ t('canvas.qrHint') }}</p>
            </template>

            <template v-if="selected.type === 'text'">
              <div class="field">
                <label>{{ t('canvas.text') }}</label>
                <textarea v-model="selected.options.text" class="textarea" rows="3" @input="touch" />
              </div>
              <div class="grid-2">
                <div class="field">
                  <label>{{ t('canvas.fontSize') }}</label>
                  <input
                    v-model.number="selected.options.fontSize"
                    class="input"
                    type="number"
                    @change="touch"
                  />
                </div>
                <div class="field">
                  <label>{{ t('canvas.color') }}</label>
                  <input
                    v-model="selected.options.color"
                    class="input"
                    type="color"
                    @change="touch"
                  />
                </div>
              </div>
              <div class="field">
                <label>{{ t('canvas.align') }}</label>
                <select v-model="selected.options.align" class="select" @change="touch">
                  <option value="left">{{ t('canvas.alignLeft') }}</option>
                  <option value="center">{{ t('canvas.alignCenter') }}</option>
                  <option value="right">{{ t('canvas.alignRight') }}</option>
                </select>
              </div>
              <div class="field">
                <label>{{ t('text.fontLabel') }}</label>
                <select v-model="selected.options.fontFamily" class="select" @change="touch">
                  <option v-for="font in FONTS" :key="font.key" :value="font.key">
                    {{ t(fontLabelKey(font.key)) }}
                  </option>
                </select>
                <!-- 담아 배포하는 서체라 장치에서도 같게 나온다. 다만
                     '장치 기본' 은 장치에 깔린 서체를 쓴다. -->
                <p v-if="selected.options.fontFamily === 'system'" class="hint">
                  {{ t('text.fontHint') }}
                </p>
                <p v-else-if="isDisplayFont(selected.options.fontFamily)" class="hint">
                  {{ t('text.displayFontHint') }}
                </p>
              </div>

              <div class="grid-2">
                <div class="field">
                  <label>{{ t('text.lineHeight') }}</label>
                  <input
                    v-model.number="selected.options.lineHeight"
                    class="input"
                    type="number"
                    :min="LINE_HEIGHT.min"
                    :max="LINE_HEIGHT.max"
                    :step="LINE_HEIGHT.step"
                    @change="touch"
                  />
                </div>
                <div class="field">
                  <label>{{ t('text.letterSpacing') }}</label>
                  <input
                    v-model.number="selected.options.letterSpacing"
                    class="input"
                    type="number"
                    :min="LETTER_SPACING.min"
                    :max="LETTER_SPACING.max"
                    :step="LETTER_SPACING.step"
                    @change="touch"
                  />
                </div>
              </div>

              <div class="deco">
                <label class="check">
                  <input v-model="selected.options.bold" type="checkbox" @change="touch" />
                  {{ t('canvas.bold') }}
                </label>
                <label class="check">
                  <input v-model="selected.options.italic" type="checkbox" @change="touch" />
                  {{ t('text.italic') }}
                </label>
                <label class="check">
                  <input v-model="selected.options.underline" type="checkbox" @change="touch" />
                  {{ t('text.underline') }}
                </label>
                <label class="check">
                  <input v-model="selected.options.strike" type="checkbox" @change="touch" />
                  {{ t('text.strike') }}
                </label>
                <!-- 밝은 화면에 흰 글자를 올리는 일이 잦다. -->
                <label class="check">
                  <input v-model="selected.options.shadow" type="checkbox" @change="touch" />
                  {{ t('text.shadow') }}
                </label>
              </div>
            </template>

            <template v-else-if="['image', 'video', 'web'].includes(selected.type)">
              <div class="field">
                <label>{{ t('canvas.sourceUrl') }}</label>
                <input v-model="selected.src" class="input" placeholder="https://…" @input="touch" />
              </div>
              <!-- 이미 놓은 것도 갈아 끼울 수 있어야 한다. 없으면 지웠다
                   다시 만들며 크기와 자리를 처음부터 잡게 된다. -->
              <button
                v-if="selected.type !== 'web'"
                class="btn block"
                @click="openMediaPicker(selected.type, 'replace')"
              >
                {{ t('media.change') }}
              </button>

              <!-- 동영상 소리. 장치에서는 그대로 나오고, 브라우저 미리보기는
                   자동재생 제약 때문에 한 번 눌러 줘야 들린다. -->
              <template v-if="selected.type === 'video'">
                <label class="check">
                  <input
                    type="checkbox"
                    :checked="selected.options?.muted === false"
                    @change="setVideoOption('muted', !$event.target.checked)"
                  />
                  {{ t('media.sound') }}
                </label>

                <div v-if="selected.options?.muted === false" class="field">
                  <label>{{ t('media.volume') }}</label>
                  <input
                    class="input"
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    :value="Math.round((selected.options?.volume ?? 1) * 100)"
                    @change="setVideoOption('volume', $event.target.value / 100)"
                  />
                  <p class="hint">{{ t('media.soundHint') }}</p>
                </div>

                <label class="check">
                  <input
                    type="checkbox"
                    :checked="selected.options?.loop !== false"
                    @change="setVideoOption('loop', $event.target.checked)"
                  />
                  {{ t('media.loop') }}
                </label>
              </template>
              <p v-if="selected.type === 'image' && selected.options?.source_page" class="hint">
                <a :href="selected.options.source_page" target="_blank" rel="noopener">
                  {{ t('stock.sourceLink', { author: selected.options.author ?? 'Pixabay' }) }}
                </a>
              </p>
            </template>

            <!--
              놓고 나서도 어느 목록인지 보이고 바꿀 수 있어야 한다. 없으면
              한번 놓은 요소는 지웠다 다시 만드는 수밖에 없다.
            -->
            <template v-else-if="selected.type === 'playlist'">
              <div class="field">
                <label>{{ t('widgetPlaylist.element') }}</label>
                <div class="pl-current">
                  <span class="pl-icon">🔁</span>
                  <span class="pl-current-name">
                    {{ selected.options?.playlist_name ?? t('widgetPlaylist.notFound') }}
                  </span>
                </div>
                <p v-if="selected.options?.playlist_id" class="hint">
                  {{ t('widgetPlaylist.itemCount', { count: selected.options.playlist_item_count ?? 0 }) }}
                  · {{ t('widgetPlaylist.liveHint') }}
                </p>
              </div>

              <button class="btn block" @click="openPlaylistPicker('replace')">
                {{ t('widgetPlaylist.changePick') }}
              </button>
              <RouterLink
                v-if="selected.options?.playlist_id"
                class="btn block"
                :to="`/playlists/${selected.options.playlist_id}/edit`"
              >
                {{ t('widgetPlaylist.openEditor') }}
              </RouterLink>
            </template>

            <template v-else-if="selected.type === 'widget'">
              <WidgetOptions
                :element="selected"
                :spec="widgets.find((w) => w.key === selected.widget_key)"
                :org-id="orgId"
                @change="touch"
              />
            </template>

            <!--
              애니메이션은 종류를 가리지 않는다. 글자만 움직이게 하면 사진과
              위젯은 늘 가만히 있어야 하는데, 그럴 이유가 없다.
            -->
            <div class="field">
              <label>{{ t('animation.label') }}</label>
              <select
                class="select"
                :value="selected.animation?.type ?? DEFAULT_ANIMATION"
                @change="setAnimation('type', $event.target.value)"
              >
                <option :value="DEFAULT_ANIMATION">{{ t('animation.none') }}</option>
                <optgroup
                  v-for="group in ANIMATION_GROUPS"
                  :key="group.key"
                  :label="t(animationGroupKey(group.key))"
                >
                  <option v-for="kind in group.kinds" :key="kind" :value="kind">
                    {{ t(animationLabelKey(kind)) }}
                  </option>
                </optgroup>
              </select>
            </div>

            <div v-if="(selected.animation?.type ?? DEFAULT_ANIMATION) !== DEFAULT_ANIMATION">
              <div class="grid-2">
                <div class="field">
                  <label>{{ t('animation.duration') }}</label>
                  <input
                    class="input"
                    type="number"
                    :min="MIN_DURATION_MS"
                    :max="MAX_DURATION_MS"
                    step="100"
                    :value="selected.animation?.duration_ms ?? DEFAULT_DURATION_MS"
                    @change="setAnimation('duration_ms', $event.target.value)"
                  />
                </div>
                <div class="field">
                  <label>{{ t('animation.delay') }}</label>
                  <input
                    class="input"
                    type="number"
                    min="0"
                    :max="MAX_DELAY_MS"
                    step="100"
                    :value="selected.animation?.delay_ms ?? 0"
                    @change="setAnimation('delay_ms', $event.target.value)"
                  />
                </div>
              </div>
              <p class="hint">
                {{
                  isLoopAnimation(selected.animation?.type)
                    ? t('animation.loopHint')
                    : t('animation.onceHint')
                }}
              </p>
            </div>

            <button class="btn btn-danger block" @click="removeElement(selected.id)">
              {{ t('canvas.deleteElement') }}
            </button>
          </template>
        </div>
      </section>
    </aside>

    <ModalDialog
      v-if="playlistPickerOpen"
      :title="t('widgetPlaylist.pick')"
      width="520px"
      hide-footer
      @close="playlistPickerOpen = false; clearPendingDrop()"
    >
      <div class="pl-filter">
        <input
          v-model="playlistQuery"
          class="input"
          :placeholder="t('widgetPlaylist.searchPlaceholder')"
        />
        <button class="btn btn-sm" :disabled="playlistsLoading" @click="loadPlaylists">
          {{ t('common.refresh') }}
        </button>
      </div>

      <p v-if="playlistsLoading" class="hint">{{ t('common.loading') }}</p>
      <p v-else-if="playlists.length === 0" class="hint">{{ t('widgetPlaylist.none') }}</p>
      <p v-else-if="visiblePlaylists.length === 0" class="hint">{{ t('org.searchNoMatch') }}</p>

      <div v-else class="pl-list">
        <button
          v-for="playlist in visiblePlaylists"
          :key="playlist.id"
          class="pl-row"
          type="button"
          @click="choosePlaylist(playlist)"
        >
          <!--
            첫 위젯의 화면을 그대로 줄여 보여 준다. 이름만으로는 어떤 화면이
            도는 목록인지 알 수 없고, 아이콘은 전부 같아 구분에 쓸모가 없다.
          -->
          <span class="pl-thumb">
            <WidgetPreview
              v-if="firstWidget(playlist)"
              :widget-key="firstWidget(playlist).widget_key"
              :options="firstWidget(playlist).options ?? {}"
              :name="widgetName(firstWidget(playlist).widget_key)"
              :width="THUMB_DOC_WIDTH"
              :height="THUMB_DOC_HEIGHT"
              :scale="THUMB_SCALE"
            />
            <span v-else class="pl-thumb-empty">🔁</span>
          </span>

          <span class="pl-row-body">
            <span class="pl-row-name">{{ playlist.name }}</span>
            <span class="muted">
              {{ t('widgetPlaylist.itemCount', { count: playlist.items.length }) }} ·
              {{ t('widgetPlaylist.duration', { sec: playlist.total_duration_sec }) }}
            </span>
            <span v-if="firstWidget(playlist)" class="muted pl-row-first">
              {{ t('widgetPlaylist.firstWidget', {
                name: widgetName(firstWidget(playlist).widget_key),
              }) }}
            </span>
          </span>
        </button>
      </div>

      <!--
        여기서 바로 만들 수 있어야 한다. 하나도 없을 때 재생목록 화면으로
        나가라고만 하면, 편집 중인 내용을 두고 나가야 하는 막다른 길이 된다.
        빈 목록으로 자리부터 잡고, 담는 일은 재생목록 편집기에서 한다.
      -->
      <div class="pl-create">
        <input
          v-model="playlistName"
          class="input"
          :placeholder="t('widgetPlaylist.newName')"
          @keyup.enter="createPlaylist"
        />
        <button
          class="btn btn-sm btn-primary"
          :disabled="!playlistName.trim() || playlistCreating"
          @click="createPlaylist"
        >
          {{ playlistCreating ? t('content.browser.creating') : t('content.browser.create') }}
        </button>
      </div>
      <p class="hint">{{ t('widgetPlaylist.createHint') }}</p>
    </ModalDialog>

    <!--
      브라우저가 소리 있는 자동재생을 막았을 때만 나온다. 한 번 누르면
      그때부터 허용되므로, 누르고 나면 사라진다.
    -->
    <button v-if="readonly && soundBlocked" class="btn sound-on" @click="enableSound">
      {{ t('media.enableSound') }}
    </button>

    <!-- 앨범은 사진을 고른 뒤에 만든다. 빈 앨범을 놓아 두면 그대로 저장된다. -->
    <AlbumEditorDialog
      v-if="albumEditorOpen"
      v-model="pendingAlbumImages"
      :org-id="orgId"
      @close="closeAlbumEditor"
    />

    <MediaPicker
      v-if="mediaPickerOpen"
      :kind="mediaKind"
      :org-id="orgId"
      :source="mediaSource"
      :current="mediaMode === 'replace' ? (selected?.src ?? '') : ''"
      :orientation="ofSize(layout.width, layout.height)"
      @close="mediaPickerOpen = false; clearPendingDrop()"
      @select="chooseMedia"
    />

  </div>
</template>

<style scoped>
.canvas-editor {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 290px;
  gap: 10px;
  align-items: stretch;
  /* 부모가 준 높이를 그대로 쓴다. 캔버스는 남는 공간을 채운다. */
  min-height: 0;
  height: 100%;
}

/*
 * 미리보기(readonly)에는 레일도 오른쪽 패널도 없다. 한 칸으로 두어야
 * 캔버스가 주어진 영역을 다 쓴다.
 *
 * 예전에는 자식 구조(`:has(> .stage-wrap:first-child)`)로 판단했는데, 그
 * 조건은 '레일만 없는 상태'를 뜻해 오른쪽 패널 자리(290px)를 계속 잡고
 * 있었다 — 미리보기에서 화면이 영역을 못 채운 이유가 이것이다. 판단 근거를
 * 구조가 아니라 `readonly` 그 자체로 바꾼다.
 */
.canvas-editor.readonly {
  grid-template-columns: minmax(0, 1fr);
}

@media (width <= 1180px) {
  .canvas-editor {
    grid-template-columns: auto 1fr;
    height: auto;
  }
}

@media (width <= 820px) {
  .canvas-editor {
    grid-template-columns: 1fr;
  }
}

.stage-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  min-height: 0;
}

/* 바깥 상자. 캔버스가 테두리에 딱 붙지 않도록 상하 여백을 준다. */
.stage {
  flex: 1;
  display: flex;
  min-height: 300px;
  padding: 20px 12px;
  border-radius: var(--radius);
  background: var(--surface-2);
  border: 1px solid var(--border);
  overflow: hidden;
}

/*
 * 실제로 측정하는 요소. 여기 크기에 맞춰 자동 배율이 정해진다.
 * 바깥 상자를 재면 padding 이 clientWidth 에 포함돼 캔버스가 여백만큼
 * 넘쳐 나간다. 그래서 안쪽 상자를 따로 두고 이것을 잰다.
 */
.stage-inner {
  flex: 1;
  display: grid;
  place-items: center;
  min-width: 0;
  min-height: 0;
  /* 확대해서 화면보다 커지면 여기서 스크롤한다. */
  overflow: auto;
}

.canvas {
  position: relative;
  flex-shrink: 0;
  margin: auto;
  overflow: hidden;
  border-radius: 4px;
  box-shadow: var(--shadow-lg);
  user-select: none;
  /*
   * 안쪽 겹침 순서를 캔버스 안에 가둔다.
   *
   * 이게 없으면 격자(0)·영역(1)·요소(10+z)·분할선(200)이 화면 전체와 겨루게
   * 되어, 분할선이 모달(z-index 50)보다 위로 올라온다 — 미리보기를 열어도
   * 편집 캔버스의 분할선이 그 위에 그려진다. 안쪽 순서는 서로에 대해서만
   * 의미가 있으므로 여기서 끊는 것이 맞다.
   */
  isolation: isolate;
}

.grid-overlay {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

/* ---------------------------------------------------------------- 분할 영역 */
.region {
  position: absolute;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 색은 캔버스 배경에서 뽑아 인라인으로 준다(utils/canvasColor.js). */
  border: 1px dashed;
  cursor: pointer;
}

.region.active {
  border-style: solid;
}

.region-tag {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  white-space: nowrap;
  pointer-events: none;
}

.region-add {
  padding: 3px 10px;
  border-radius: 999px;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  pointer-events: none;
}

/* 분할선 손잡이. 요소 위에 떠 있어야 항상 잡을 수 있다. */
.divider {
  position: absolute;
  z-index: 200;
}

.divider.vertical {
  top: 0;
  bottom: 0;
  width: 3px;
  margin-left: -1px;
  cursor: col-resize;
}

.divider.horizontal {
  left: 0;
  right: 0;
  height: 3px;
  margin-top: -1px;
  cursor: row-resize;
}

/* 얇은 선도 쉽게 잡히도록 보이지 않는 여유를 준다. */
.divider::after {
  content: '';
  position: absolute;
  inset: -5px;
}

/* ---------------------------------------------------------------- 요소 */
.element {
  position: absolute;
  outline: 1px dashed rgb(255 255 255 / 35%);
  cursor: move;
  overflow: hidden;
}

.element.readonly {
  cursor: default;
  outline: 0;
}

.element.locked {
  cursor: not-allowed;
}

.element.selected {
  outline: 2px solid;
}

.el-text {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  line-height: 1.2;
  word-break: keep-all;
}

.el-image,
.el-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 편집 중에는 첫 프레임만 서 있다. 검은 바탕이라야 자리가 눈에 잡힌다. */
.el-video {
  background: #000;
}

/* 소리를 켜는 버튼. 화면 위에 떠 있어야 눈에 띈다. */
.sound-on {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 30;
}

/* 웹페이지 미리보기. 안쪽은 문서 크기로 그리고 바깥에서 한 번만 축소한다
   (위젯 미리보기와 같은 방식). 작은 상자에 넣으면 모바일 레이아웃으로
   그려져 실제 표출과 달라지기 때문이다. */
.el-web {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  overflow: hidden;
}

.web-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  height: 26px;
  padding: 0 8px;
  background: #e2e8f0;
  color: #334155;
  font-size: 11px;
}

.web-dots {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
}

.web-dots i {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #94a3b8;
}

.web-url {
  flex: 1;
  min-width: 0;
  padding: 1px 7px;
  border-radius: 999px;
  background: #f8fafc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.web-frame {
  flex: 1;
  width: 100%;
  border: 0;
  background: #fff;
  /* 끌어 옮길 때 iframe 이 마우스를 삼키지 않게 한다. */
  pointer-events: none;
}

.web-empty {
  flex: 1;
  display: grid;
  place-items: center;
  background: #f1f5f9;
  color: #64748b;
  font-size: 13px;
}

.el-placeholder {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  background: rgb(148 163 184 / 25%);
}

.el-kind {
  padding: 3px 9px;
  border-radius: 999px;
  background: rgb(15 23 42 / 65%);
  color: #e2e8f0;
  font-size: 11px;
}

.handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 12px;
  height: 12px;
  cursor: nwse-resize;
}

/* ---------------------------------------------------------------- 하단 바 */
.stage-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 0 2px;
}

.zoom {
  display: flex;
  align-items: center;
  gap: 2px;
}

.zoom .tiny {
  width: 118px;
}

.zoom .btn-icon {
  padding: 3px 7px;
  font-size: 13px;
  line-height: 1;
}

.stage-bar .check {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  margin: 0;
}

.tiny {
  width: 80px;
  padding: 3px 6px;
  font-size: 12px;
}

.info-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
}

/* ---------------------------------------------------------------- 사이드 패널 */
/* 패널은 위에서부터 캔버스 / 레이어 / 요소 순으로 쌓는다.
   레이어만 남는 공간을 가져가고, 위아래 두 단은 내용만큼 차지한다. */
.side {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-bottom: 1px solid var(--border);
}

.section:last-child {
  border-bottom: 0;
}

.section-title {
  /* 단이 눌릴 때 제목까지 납작해지면 어느 단인지 알 수 없게 된다.
     눌리는 몫은 아래 본문이 받고, 본문은 제 안에서 굴러간다. */
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 12px;
  margin: 0;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.section-title .count {
  font-size: 11px;
  font-weight: 600;
}

.section-body {
  padding: 12px;
  overflow-y: auto;
  min-height: 0;
}

/* 캔버스 명령과 요소 설정은 내용이 길어질 수 있어 각자 스크롤한다. */
.canvas-section .section-body {
  max-height: 34vh;
}

/*
 * 요소 설정 단은 남는 공간을 가져간다(`flex: 1`).
 *
 * 그런데 `flex: 1` 은 `flex-basis: 0` 이라, **남는 공간이 없으면 이 단의
 * 높이도 0 이 된다.** 위 두 단이 34vh + 26vh 를 차지하므로 화면이 낮으면
 * 정확히 그 일이 벌어졌다 — 설정 단추가 통째로 사라지는데 패널은
 * `overflow: hidden` 이라 굴려서 닿을 수도 없었다.
 *
 * 최소 높이를 두면 flexbox 가 이만큼을 먼저 떼어 놓고 위 두 단을 더 줄인다.
 * 줄어든 단은 제 본문 안에서 굴러가므로 어느 쪽도 잘리지 않는다.
 */
.element-section {
  flex: 1;
  min-height: 168px;
}

.element-section .section-body {
  flex: 1;
  min-height: 0;
}

.layer-section .section-body {
  max-height: 26vh;
  padding: 6px;
}

.pad {
  padding: 10px 4px;
}

/* ---------------------------------------------------------------- 레이어 */
.layer {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 5px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  cursor: pointer;
}

.layer:hover {
  background: var(--surface-2);
}

.layer.active {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.layer.hidden .layer-name {
  opacity: 0.45;
  text-decoration: line-through;
}

.layer.dragging {
  opacity: 0.45;
}

.layer.drop-before {
  box-shadow: inset 0 2px 0 var(--primary);
}

.layer-grip {
  color: var(--text-muted);
  font-size: 12px;
  cursor: grab;
  user-select: none;
}

.layer-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layer-actions {
  display: flex;
  gap: 1px;
  flex-shrink: 0;
}

.icon-btn {
  padding: 1px 4px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 11px;
  line-height: 1.4;
  cursor: pointer;
}

.icon-btn:hover:not(:disabled) {
  background: var(--border);
  color: var(--text);
}

.icon-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.icon-btn.danger:hover {
  background: var(--danger-soft);
  color: var(--danger);
}

.layer-tail {
  padding: 6px;
  border: 2px dashed transparent;
  border-radius: var(--radius);
  text-align: center;
  font-size: 11px;
  color: var(--text-muted);
}

.layer-tail.over {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
}

.palette-group {
  margin-bottom: 16px;
}

.palette-group h4 {
  margin: 0 0 7px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
}

.palette {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.chip:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-soft);
}

/* 분할 선택 버튼: 작은 도식으로 모양을 미리 보여 준다. */
.split-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.split-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 8px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.split-btn:hover {
  border-color: var(--primary);
}

.split-btn.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 600;
}

.split-preview {
  display: grid;
  gap: 2px;
  width: 34px;
  height: 22px;
}

.split-preview i {
  background: var(--text-muted);
  border-radius: 1px;
  opacity: 0.55;
}

.split-btn.active .split-preview i {
  background: var(--primary);
  opacity: 1;
}

.sp-none {
  grid-template-columns: 1fr;
}

.sp-h2 {
  grid-template-columns: 1fr 1fr;
}

.sp-grid4 {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}

.sp-v2 {
  grid-template-rows: 1fr 1fr;
}

.sp-v3 {
  grid-template-rows: repeat(3, 1fr);
}

.gap-field {
  margin-top: 10px;
  margin-bottom: 8px;
}

.size-block {
  margin-top: 10px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.size-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 600;
  margin-bottom: 8px;
}

.size-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.size-axis {
  width: 34px;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.size-input {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: var(--text-muted);
}

.size-input .input {
  width: 52px;
  padding: 3px 5px;
  font-size: 12px;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin-bottom: 10px;
}

.block {
  width: 100%;
  justify-content: center;
  margin-bottom: 6px;
}

/* ------------------------------------------------------------- 재생목록 */

/* 캔버스 위의 재생목록 요소(편집 중). 무엇이 놓였는지만 알면 된다. */
.el-playlist {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: rgb(15 23 42 / 55%);
  color: #f8fafc;
  font-size: 12px;
  overflow: hidden;
}

.pl-icon {
  font-size: 20px;
  line-height: 1;
}

.pl-name {
  max-width: 90%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 속성 패널에 지금 걸린 목록. */
.pl-current {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-2);
  font-size: 12px;
}

.pl-current-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ------------------------------------------------- 재생목록 고르기 레이어 */
.pl-filter {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.pl-filter .input {
  flex: 1;
  min-width: 0;
}

.pl-list {
  display: grid;
  gap: 6px;
  max-height: 46vh;
  overflow-y: auto;
}

.pl-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.pl-row:hover {
  border-color: var(--primary);
  background: var(--primary-soft);
}

/*
 * 첫 위젯 화면. 안쪽은 실제 해상도로 그리고 이 상자가 잘라 낸다 —
 * 작은 상자에 그대로 그리면 글자 크기가 실제와 달라져 다른 화면이 된다.
 */
.pl-thumb {
  position: relative;
  flex: none;
  width: 144px;
  height: 81px;
  overflow: hidden;
  border-radius: 4px;
  background: #000;
}

.pl-thumb-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 20px;
}

.pl-row-body {
  display: grid;
  gap: 2px;
  min-width: 0;
  font-size: 12px;
}

.pl-row-name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pl-row-first {
  font-size: 11px;
}

.pl-create {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.pl-create .input {
  flex: 1;
  min-width: 0;
}

/* ------------------------------------------------------------- 애니메이션 */
/*
 * 이름은 `utils/animations.js` 가 정한다. 다른 플레이어(.NET/Flutter)는 같은
 * 이름을 제 방식대로 그리면 된다 — 여기 있는 것은 브라우저 쪽 구현이다.
 */
@keyframes sl-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes sl-slide-left {
  from { opacity: 0; transform: translateX(40%); }
  to { opacity: 1; transform: none; }
}

@keyframes sl-slide-right {
  from { opacity: 0; transform: translateX(-40%); }
  to { opacity: 1; transform: none; }
}

@keyframes sl-slide-up {
  from { opacity: 0; transform: translateY(40%); }
  to { opacity: 1; transform: none; }
}

@keyframes sl-slide-down {
  from { opacity: 0; transform: translateY(-40%); }
  to { opacity: 1; transform: none; }
}

@keyframes sl-zoom-in {
  from { opacity: 0; transform: scale(0.7); }
  to { opacity: 1; transform: none; }
}

@keyframes sl-zoom-out {
  from { opacity: 0; transform: scale(1.3); }
  to { opacity: 1; transform: none; }
}

@keyframes sl-rotate-in {
  from { opacity: 0; transform: rotate(-12deg) scale(0.85); }
  to { opacity: 1; transform: none; }
}

@keyframes sl-flip-in {
  from { opacity: 0; transform: perspective(1200px) rotateY(90deg); }
  to { opacity: 1; transform: none; }
}

@keyframes sl-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}

@keyframes sl-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6%); }
}

@keyframes sl-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}

@keyframes sl-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-2%); }
  75% { transform: translateX(2%); }
}

@keyframes sl-swing {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(2deg); }
  75% { transform: rotate(-2deg); }
}

/* 꾸미기 체크상자를 여러 줄로 흐르게 둔다. */
.deco {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}
</style>
