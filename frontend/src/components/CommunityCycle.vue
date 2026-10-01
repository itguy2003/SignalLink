<script setup>
/**
 * 커뮤니티 위젯 표출 — '게시'된 커뮤니티 재생목록을 순환한다.
 *
 * 재생목록은 서버가 준다(`/widgets/community/data`). 화면이 직접 목록을
 * 읽지 않는 이유는 울타리와 게시 여부 판정이 **주는 쪽**에 있기 때문이다 —
 * 게시 전이면 서버가 `active=false` 만 주고, 여기는 그 말대로 아무것도
 * 틀지 않는다.
 *
 * 칸(items)은 이미지·동영상이고 duration_sec 만큼 머문 뒤 다음으로 넘어간다.
 * 전체 재생시간은 칸 시간의 합 — 서버가 total_duration_sec 로 함께 준다.
 */
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import QrImage from '@/components/QrImage.vue'

/**
 * 칸은 콘텐츠 문서다(2026-10, 소속기관 공지와 같은 계약) — 플레이어와 같은
 * 캔버스로 그린다. ContentCanvas → WidgetPreview → 이 컴포넌트 → ContentCanvas
 * 로 돌아오는 순환이라 느리게(비동기) 불러온다.
 */
const ContentCanvas = Object.assign(
  defineAsyncComponent(() => import('@/components/ContentCanvas.vue')),
  { name: 'ContentCanvas' },
)

/** 문서 안의 커뮤니티 위젯은 그리지 않는다 — 커뮤니티 안에서 커뮤니티를 틀면 끝없이 파고든다. */
function safeDocument(document) {
  return {
    ...document,
    elements: (document.elements ?? []).filter(
      (el) => !(el?.type === 'widget' && el?.widget_key === 'community'),
    ),
  }
}

const props = defineProps({
  /** 위젯 옵션 그대로. playlist_id (비우면 서버가 자동 선택) */
  options: { type: Object, default: () => ({}) },
  /** 기준 기관(콘텐츠의 org). 미리보기는 편집 중인 콘텐츠의 기관을 넘긴다. */
  orgId: { type: Number, default: null },
})

const { t } = useI18n()

const data = ref(null)
const loaded = ref(false)
const at = ref(0)
let timer = null

/**
 * 브라우저가 소리 있는 자동재생을 막았는가.
 *
 * 장치(WPF 셸)는 자동재생 정책을 풀어 두므로 소리가 그대로 나온다.
 * 브라우저에서 막히면 음소거로 물러난다 — 막힌 채 두면 아예 재생되지 않는다.
 */
const soundBlocked = ref(false)

function registerVideo(el) {
  if (!el || current.value?.muted !== false || soundBlocked.value) return
  el.muted = false
  el.play?.()?.catch?.(() => {
    el.muted = true
    el.play?.()?.catch?.(() => {})
    soundBlocked.value = true
  })
}

const payload = computed(() => data.value?.data ?? null)
const items = computed(() => (payload.value?.active ? (payload.value.items ?? []) : []))
const current = computed(() => items.value[at.value] ?? null)

function arm() {
  clearTimeout(timer)
  slideStart = Date.now()
  elapsedMs.value = 0
  if (items.value.length <= 1) return
  const stay = Math.max(1, Number(current.value?.duration_sec) || 10)
  timer = setTimeout(() => {
    at.value = (at.value + 1) % items.value.length
    arm()
  }, stay * 1000)
}

// ------------------------------------------------------------ 진행률
// 지나간 칸들의 시간 + 현재 칸에서 흐른 시간을 전체 재생시간과 견줘
// 아래에 얇은 막대로 보여 준다 — 어디까지 왔는지 숫자 없이도 보이게.

const elapsedMs = ref(0)
let slideStart = 0
let progressTimer = null

const totalSec = computed(
  () =>
    Number(payload.value?.total_duration_sec) ||
    items.value.reduce((sum, item) => sum + (Number(item.duration_sec) || 0), 0),
)

const progress = computed(() => {
  const total = totalSec.value
  if (!total || !items.value.length) return 0
  const before = items.value
    .slice(0, at.value)
    .reduce((sum, item) => sum + Math.max(1, Number(item.duration_sec) || 1), 0)
  const currentSec = Math.max(1, Number(current.value?.duration_sec) || 1)
  const inSlide = Math.min(elapsedMs.value / 1000, currentSec)
  return Math.min(100, ((before + inSlide) / total) * 100)
})

function startProgress() {
  clearInterval(progressTimer)
  progressTimer = setInterval(() => {
    elapsedMs.value = Date.now() - slideStart
    // 칸이 하나뿐이면 넘김 타이머가 없다 — 다 차면 처음부터 다시 센다.
    const currentSec = Math.max(1, Number(current.value?.duration_sec) || 1)
    if (items.value.length === 1 && elapsedMs.value >= currentSec * 1000) {
      slideStart = Date.now()
    }
  }, 250)
}

onMounted(async () => {
  try {
    // 편집자가 재생목록을 집었으면(playlist_id) 그것을, 아니면 서버가 고른다
    // ('게시' 상태의 최신 것). 판정은 언제나 주는 쪽 몫이다.
    const picked = Number(props.options?.playlist_id) || null
    data.value = await api.get('/widgets/community/data', {
      org_id: props.orgId ?? undefined,
      options: JSON.stringify(picked ? { playlist_id: picked } : {}),
    })
  } catch {
    data.value = null
  } finally {
    loaded.value = true
    arm()
    startProgress()
  }
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  clearInterval(progressTimer)
})
</script>

<template>
  <div class="cycle">
    <!-- 게시 전/무효: 서버가 active=false 를 줬다. 장치라면 아무것도 안 그린다. -->
    <div v-if="loaded && payload && !payload.active" class="state">
      <span class="chip">{{ t('community.inactive') }}</span>
    </div>

    <div v-else-if="loaded && !current" class="state">
      <span class="chip">{{ t('community.widgetNone') }}</span>
    </div>

    <template v-else-if="current">
      <!-- 문서 칸 — 플레이어와 같은 캔버스로 그린다. -->
      <div
        v-if="current.document"
        :key="`doc-${at}`"
        class="doc-stage"
        data-test="slide-document"
      >
        <ContentCanvas :document="safeDocument(current.document)" readonly />
      </div>
      <img
        v-else-if="current.kind === 'image'"
        :key="`img-${at}`"
        :src="current.url"
        alt=""
        class="media"
        data-test="slide-image"
      />
      <!-- QR 은 화면 중앙, 메시지는 그 아래. -->
      <div
        v-else-if="current.kind === 'qr'"
        :key="`qr-${at}`"
        class="qr-stage"
        data-test="slide-qr"
      >
        <QrImage :text="current.qr_text" :cell-size="8" />
        <p v-if="current.message" class="qr-message" data-test="qr-message">
          {{ current.message }}
        </p>
      </div>
      <!-- 소리는 칸의 muted 표시를 따른다(기본 음소거). 켜 달라는 칸은
           소리로 시도하고, 브라우저가 막으면 음소거로 물러난다. -->
      <video
        v-else
        :key="`vid-${at}`"
        :ref="registerVideo"
        :src="current.url"
        class="media"
        autoplay
        :muted="current.muted !== false || soundBlocked"
        loop
        playsinline
        data-test="slide-video"
      />

      <!-- 진행률 — 전체 재생시간 대비 어디까지 왔는지. -->
      <div class="progress">
        <div
          class="progress-bar"
          data-test="cycle-progress"
          :style="{ width: `${progress}%` }"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.cycle {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #000;
}

.state {
  display: grid;
  place-items: center;
  height: 100%;
}

.chip {
  padding: 0.3em 0.9em;
  border-radius: 999px;
  background: rgb(148 163 184 / 25%);
  color: #e2e8f0;
  font-size: 0.8em;
}

.media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 문서 칸의 무대 — 캔버스가 이 상자에 맞춰 축소해 그린다. */
.doc-stage {
  position: absolute;
  inset: 0;
}

/* QR 은 화면 중앙 + 메시지는 그 아래. */
.qr-stage {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 4%;
}

.qr-stage :deep(.qr) {
  width: min(46%, 46vh);
  border-radius: 4%;
  padding: 2%;
}

.qr-message {
  margin: 0;
  color: #f8fafc;
  font-size: 1.4em;
  text-align: center;
  max-width: 82%;
}

/* 진행률 — 맨 아래에 얇게. 표출을 가리지 않는다. */
.progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: rgb(148 163 184 / 25%);
}

.progress-bar {
  height: 100%;
  background: #3b82f6;
  transition: width 0.25s linear;
}
</style>
