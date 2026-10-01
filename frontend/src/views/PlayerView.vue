<script setup>
/**
 * 브라우저 기반 DID 플레이어 (테스트용 클라이언트).
 *
 * 장치 고유번호로 서버 인증(프로비전)을 거쳐, 배정된 스케줄을 받아 표출한다.
 *
 *   표출     시간지정: 요일·시간대에 맞는 아이템 / 목록반복·데모: 순환
 *   동기화   암호화 WebSocket(welcome·heartbeat_ack·schedule_changed·command).
 *            채널이 막힌 환경에서는 REST 하트비트로 폴백한다.
 *   암호화   HKDF-SHA256 + AES-256-GCM (WebCrypto) — 서버와 같은 봉투.
 *
 * 마스터 키는 실제 장치라면 앱에 심겨 나온다. 테스트 플레이어는 설정
 * 화면에서 받는다(개발 기본값이 채워져 있다).
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { api, setDeviceToken } from '@/api/client'
import ContentCanvas from '@/components/ContentCanvas.vue'
import {
  DecryptError,
  decryptFromServer,
  deriveDeviceKey,
  encryptForServer,
} from '@/utils/deviceCrypto'
import { currentPlayback } from '@/utils/playerSchedule'
import {
  crossfades,
  enterStyle,
  exitStyle,
  normalize,
  normalizeMs,
  restStyle,
} from '@/utils/transitions'

const { t } = useI18n()

const SETUP_KEY = 'signallink.player'

/**
 * 네이티브 셸(WPF WebView2) 다리.
 *
 * 셸 안에서 돌 때만 있다(window.chrome.webview). 셸은 브라우저가 못 하는
 * 일(화면 캡처 업로드)을 대신 해 준다 — 장치 토큰을 넘겨 두고, 캡처
 * 명령이 오면 셸에게 넘긴다.
 */
function postToHost(message) {
  try {
    window.chrome?.webview?.postMessage?.(message)
  } catch {
    // 셸이 없거나 다리가 막혔다 — 브라우저 단독 실행이다.
  }
}
const APP_VERSION = 'browser-player/0.1'

// ------------------------------------------------------------ 상태
const phase = ref('setup') // 'setup' | 'connecting' | 'playing' | 'off'
const setupError = ref('')
const form = ref({ device_code: '', master_key: 'dev-device-master-key-change-me' })

const device = ref(null) // 프로비전 응답
const payload = ref(null) // 스케줄 페이로드
const rotationIndex = ref(0)
const now = ref(new Date())
const linkState = ref('idle') // 'ws' | 'rest' | 'idle' — 어느 길로 동기화 중인가
const hudOpen = ref(false)

let cryptoKey = null
let socket = null
let heartbeatTimer = null
let rotationTimer = null
let clockTimer = null

// ------------------------------------------------------------ 설정/프로비전
function readSaved() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETUP_KEY) ?? 'null')
    return raw && raw.device_code ? raw : null
  } catch {
    return null
  }
}

onMounted(() => {
  window.addEventListener('resize', measureViewport)
  document.addEventListener('visibilitychange', onVisibility)
  clockTimer = setInterval(() => {
    now.value = new Date()
  }, 1000)

  const saved = readSaved()
  if (saved) {
    form.value = { device_code: saved.device_code, master_key: saved.master_key }
    start()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', measureViewport)
  document.removeEventListener('visibilitychange', onVisibility)
  releaseWakeLock()
  clearTimeout(cursorTimer)
  clearFxOutgoing()
  stopChannels()
  clearInterval(clockTimer)
  setDeviceToken(null)
})

async function start() {
  const code = form.value.device_code.trim().toUpperCase()
  if (!code) {
    setupError.value = t('player.codeRequired')
    return
  }
  // 사이니지는 전체화면이 기본이다. 브라우저가 사용자 제스처 안에서만
  // 허용하므로 [시작] 클릭 시점에 바로 요청한다 — 자동 기동(onMounted)에서
  // 불리면 거부되는데, 그때는 표출 화면 클릭으로 다시 들어간다.
  enterFullscreen()
  phase.value = 'connecting'
  setupError.value = ''
  try {
    const info = await api.post('/player/provision', {
      device_code: code,
      app_version: APP_VERSION,
      width: window.screen?.width ?? null,
      height: window.screen?.height ?? null,
    })
    device.value = info
    setDeviceToken(info.device_token)
    // 네이티브 셸이 캡처 업로드에 쓸 수 있게 토큰을 넘긴다.
    postToHost({ type: 'provisioned', device_token: info.device_token, device_code: info.device_code })
    cryptoKey = await deriveDeviceKey(form.value.master_key, info.device_code)
    try {
      localStorage.setItem(
        SETUP_KEY,
        JSON.stringify({ device_code: code, master_key: form.value.master_key }),
      )
    } catch {
      // 저장이 안 되는 환경이면 새로고침 때 다시 입력한다.
    }

    await fetchSchedule()
    phase.value = 'playing'
    // fetchSchedule 시점에는 아직 'connecting'이라 playback 이 비어 회전이
    // 걸리지 않는다 — 표출로 바뀐 뒤 다시 걸어야 목록반복이 돈다.
    armRotation()
    openChannel(info)
  } catch (err) {
    phase.value = 'setup'
    setupError.value = err.detail ?? t('player.provisionFailed')
    setDeviceToken(null)
  }
}

function resetSetup() {
  stopChannels()
  setDeviceToken(null)
  try {
    localStorage.removeItem(SETUP_KEY)
  } catch {
    // 지워지지 않아도 설정 화면으로는 돌아간다.
  }
  device.value = null
  payload.value = null
  phase.value = 'setup'
}

// ------------------------------------------------------------ 스케줄 수신/표출
async function fetchSchedule() {
  const received = await api.get('/player/schedule')
  payload.value = received
  rotationIndex.value = 0
  armRotation()
}

const playback = computed(() =>
  phase.value === 'playing' && payload.value
    ? currentPlayback(payload.value, now.value, rotationIndex.value)
    : { item: null, rotating: false },
)

const documentToShow = computed(() => playback.value.item?.content ?? null)

// ------------------------------------------------------------ 장 전환 효과
// 아이템마다 '앞 장에서 이 장으로 넘어올 때'의 효과가 붙어 온다(재생목록
// 칸과 같은 규약). 들어오는 장을 시작 모습에 놓았다가 다음 프레임에 제자리로
// 보내면 브라우저가 사이를 채운다. 겹쳐 그리는 효과(디졸브·밀기·닦기)는
// 나가는 장을 전환 시간 동안만 아래에 남긴다.
const fxEntering = ref(false)
const fxOutgoingDoc = ref(null)
let fxOutgoingTimer = null

const fxKind = computed(() => normalize(playback.value.item?.transition))
const fxMs = computed(() => normalizeMs(playback.value.item?.transition_ms))

const fxEnterStyle = computed(() => ({
  ...(fxEntering.value ? enterStyle(fxKind.value) : restStyle()),
  transitionDuration: `${fxMs.value}ms`,
}))

const fxOutgoingStyle = computed(() => ({
  ...(fxEntering.value ? restStyle() : exitStyle(fxKind.value)),
  transitionDuration: `${fxMs.value}ms`,
}))

function clearFxOutgoing() {
  clearTimeout(fxOutgoingTimer)
  fxOutgoingTimer = null
  fxOutgoingDoc.value = null
}

watch(
  () => playback.value.item,
  (item, previous) => {
    if (!item || item === previous) return
    clearFxOutgoing()
    if (fxKind.value === 'none') {
      fxEntering.value = false
      return
    }
    if (previous?.content && crossfades(fxKind.value)) {
      fxOutgoingDoc.value = previous.content
      fxOutgoingTimer = setTimeout(clearFxOutgoing, fxMs.value)
    }
    fxEntering.value = true
    requestAnimationFrame(() => {
      fxEntering.value = false
    })
  },
)

// 시간지정 시간대에 여러 장이 걸려(공지 참조가 펼쳐진 경우) 순환이 새로
// 시작되면 타이머를 걸어야 한다. 순환 중 장이 바뀔 때도 다시 걸리지만
// armRotation 이 기존 타이머를 지우고 시작하므로 이중 예약은 없다.
watch(
  () => `${playback.value.rotating}:${playback.value.item?.id ?? ''}`,
  () => armRotation(),
)

/** 목록반복: 지금 장의 유지 시간이 지나면 다음 장으로. */
function armRotation() {
  clearTimeout(rotationTimer)
  const { item, rotating } = playback.value
  if (!rotating || !item) return
  rotationTimer = setTimeout(() => {
    rotationIndex.value += 1
    armRotation()
  }, Math.max(1, item.duration_sec ?? 10) * 1000)
}

// ------------------------------------------------------------ 동기화 채널
function stopChannels() {
  clearInterval(heartbeatTimer)
  clearTimeout(rotationTimer)
  socket?.close()
  socket = null
  linkState.value = 'idle'
}

function openChannel(info) {
  clearInterval(heartbeatTimer)
  try {
    socket = new WebSocket(`${info.ws_url}?token=${encodeURIComponent(info.device_token)}`)
  } catch {
    startRestFallback(info)
    return
  }

  socket.onopen = () => {
    linkState.value = 'ws'
  }
  socket.onmessage = async (event) => {
    let message
    try {
      message = await decryptFromServer(cryptoKey, info.device_code, event.data)
    } catch (err) {
      if (err instanceof DecryptError) return // 못 읽는 봉투는 버린다.
      throw err
    }
    await handleServerMessage(message)
  }
  socket.onclose = () => {
    // 채널이 닫히면 REST 하트비트로 살아남는다 — 변경 감지는 계속돼야 한다.
    if (phase.value === 'playing') startRestFallback(info)
  }
  socket.onerror = () => socket?.close()

  // 하트비트: 채널이 서면 봉투로, 아니면 폴백이 맡는다.
  heartbeatTimer = setInterval(async () => {
    if (socket?.readyState === WebSocket.OPEN) {
      const envelope = await encryptForServer(cryptoKey, info.device_code, {
        type: 'heartbeat',
        schedule_version: payload.value?.version ?? 0,
        app_version: APP_VERSION,
      })
      socket.send(envelope)
    }
  }, (info.heartbeat_interval_sec ?? 30) * 1000)
}

function startRestFallback(info) {
  linkState.value = 'rest'
  clearInterval(heartbeatTimer)
  heartbeatTimer = setInterval(async () => {
    try {
      const ack = await api.post('/player/heartbeat', {
        schedule_version: payload.value?.version ?? 0,
        app_version: APP_VERSION,
      })
      if (ack.schedule_changed) await fetchSchedule()
    } catch {
      // 다음 주기에 다시 시도한다 — 표출은 멈추지 않는다.
    }
  }, (info.heartbeat_interval_sec ?? 30) * 1000)
}

async function handleServerMessage(message) {
  if (message.type === 'welcome') {
    linkState.value = 'ws'
    return
  }
  if (message.type === 'heartbeat_ack' || message.type === 'schedule_changed') {
    const changed =
      message.type === 'schedule_changed' ||
      (message.schedule_changed ?? message.version !== payload.value?.version)
    if (changed) await fetchSchedule()
    return
  }
  if (message.type === 'command') {
    await handleCommand(message.command)
  }
}

async function handleCommand(command) {
  if (command === 'reload') {
    await fetchSchedule()
  } else if (command === 'restart') {
    window.location.reload()
  } else if (command === 'shutdown') {
    stopChannels()
    phase.value = 'off'
  }
  else if (command === 'screenshot') {
    // 브라우저는 자기 화면을 못 찍는다 — 네이티브 셸(WPF)이 있으면 셸이
    // WebView2 캡처로 대신 올린다. 셸이 없으면 종전처럼 무시된다.
    postToHost({ type: 'screenshot' })
  }
}

// ------------------------------------------------------------ 화면 보조
/** 뷰포트 크기 — 콘텐츠를 화면에 가득 채우는 배율 계산에 쓴다. */
const viewport = ref({ width: window.innerWidth, height: window.innerHeight })

function measureViewport() {
  viewport.value = { width: window.innerWidth, height: window.innerHeight }
}

/**
 * 콘텐츠는 화면에 **가득** 채운다 — 문서를 원본 크기로 그린 뒤 가로/세로를
 * 각각 늘린다. 비율이 어긋나도 레터박스(검은 띠)보다 채우는 쪽을 택한다.
 * 방향(가로/세로)은 저장 단계에서 이미 스케줄과 맞춰져 있어 왜곡은 작다.
 */
const stageStyle = computed(() => {
  const layout = documentToShow.value?.layout
  const width = layout?.width > 0 ? layout.width : 1920
  const height = layout?.height > 0 ? layout.height : 1080
  return {
    width: `${width}px`,
    height: `${height}px`,
    transform: `scale(${viewport.value.width / width}, ${viewport.value.height / height})`,
    transformOrigin: 'top left',
  }
})

function enterFullscreen() {
  if (document.fullscreenElement) return
  // 거부(제스처 밖 호출 등)는 정상 흐름 — 표출은 계속돼야 한다.
  document.documentElement.requestFullscreen?.()?.catch?.(() => {})
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else enterFullscreen()
}

/** 자동 기동 등으로 전체화면을 못 탔을 때 — 표출 중 화면을 누르면 들어간다. */
function reclaimFullscreen() {
  if (phase.value === 'playing') enterFullscreen()
}

// ------------------------------------------------------------ 키오스크
// 사이니지 장치는 무인 운영이다: 화면이 꺼지지 않아야 하고(Wake Lock),
// 커서·우클릭 메뉴·확대 같은 브라우저 흔적이 표출 위에 보이면 안 된다.
const cursorHidden = ref(false)
let cursorTimer = null
let wakeLock = null

/** 마우스가 잠깐 움직일 때만 커서를 보여 주고 3초 뒤 다시 숨긴다. */
function pokeCursor() {
  cursorHidden.value = false
  clearTimeout(cursorTimer)
  if (phase.value !== 'playing') return
  cursorTimer = setTimeout(() => {
    cursorHidden.value = true
  }, 3000)
}

async function acquireWakeLock() {
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null
  } catch {
    wakeLock = null // 지원하지 않거나 거부 — 표출은 계속한다.
  }
}

function releaseWakeLock() {
  wakeLock?.release?.()?.catch?.(() => {})
  wakeLock = null
}

/** 탭이 가려졌다 돌아오면 Wake Lock 이 풀려 있다 — 다시 잡는다. */
function onVisibility() {
  if (!document.hidden && phase.value === 'playing') acquireWakeLock()
}

function blockContextMenu(event) {
  if (phase.value === 'playing') event.preventDefault()
}

/** 표출 중 Ctrl+휠 확대 등 캔버스 조작이 새어 들어가지 않게 막는다. */
function blockWheel(event) {
  event.preventDefault()
  event.stopPropagation()
}

watch(phase, (value) => {
  if (value === 'playing') {
    acquireWakeLock()
    pokeCursor()
  } else {
    releaseWakeLock()
    clearTimeout(cursorTimer)
    cursorHidden.value = false
  }
})

const hudMeta = computed(() => {
  if (!device.value) return ''
  const link = linkState.value === 'ws' ? 'WS' : linkState.value === 'rest' ? 'REST' : '—'
  return `${device.value.device_code} · v${payload.value?.version ?? 0} · ${link}`
})
</script>

<template>
  <div
    class="player"
    :class="{ 'cursor-hidden': cursorHidden }"
    @click="reclaimFullscreen"
    @dblclick="hudOpen = !hudOpen"
    @mousemove="pokeCursor"
    @contextmenu="blockContextMenu"
  >
    <!-- ---------------------------------------------------------- 설정 -->
    <div v-if="phase === 'setup' || phase === 'connecting'" class="setup">
      <div class="setup-card">
        <h1>{{ t('player.title') }}</h1>
        <p class="muted">{{ t('player.desc') }}</p>

        <label class="field">
          <span>{{ t('player.deviceCode') }}</span>
          <input
            v-model="form.device_code"
            class="input code-input"
            placeholder="XXXX-XXX-XXX"
            data-test="code-input"
            @keyup.enter="start"
          />
        </label>

        <label class="field">
          <span>{{ t('player.masterKey') }}</span>
          <input v-model="form.master_key" class="input" data-test="master-input" />
          <span class="hint">{{ t('player.masterKeyHint') }}</span>
        </label>

        <button
          class="btn btn-primary start-btn"
          :disabled="phase === 'connecting'"
          data-test="start"
          @click="start"
        >
          {{ phase === 'connecting' ? t('player.connecting') : t('player.start') }}
        </button>
        <p v-if="setupError" class="error-text">{{ setupError }}</p>
      </div>
    </div>

    <!-- ---------------------------------------------------------- 꺼짐 -->
    <div v-else-if="phase === 'off'" class="off">
      <p>{{ t('player.off') }}</p>
      <button class="btn" @click="resetSetup">{{ t('player.reset') }}</button>
    </div>

    <!-- ---------------------------------------------------------- 표출 -->
    <template v-else>
      <div v-if="documentToShow" class="stage-wrap" @wheel.capture="blockWheel">
        <div class="stage" :style="stageStyle">
          <!-- 들어오는 장. 표출 순간마다 문서가 바뀔 수 있어 키로 갈아 끼운다. -->
          <div class="fx-layer" :style="fxEnterStyle">
            <ContentCanvas
              :key="`${payload?.version}-${playback.item?.id ?? rotationIndex}`"
              :document="documentToShow"
              :widgets="[]"
              readonly
              data-test="stage"
            />
          </div>
          <!-- 겹쳐 그리는 효과에서만 남는 앞 장 — 아래에 깔려 빠져나간다. -->
          <div v-if="fxOutgoingDoc" class="fx-layer out" :style="fxOutgoingStyle" data-test="stage-out">
            <ContentCanvas :document="fxOutgoingDoc" :widgets="[]" readonly />
          </div>
        </div>
      </div>
      <!-- 시간지정인데 지금 맞는 칸이 없으면 검은 화면에 시계만 둔다. -->
      <div v-else class="idle" data-test="idle">
        <div class="clock">
          {{ now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) }}
        </div>
        <p class="muted">{{ t('player.idle') }}</p>
      </div>

      <!-- 상태 HUD — 화면을 더블클릭하면 나타난다(표출을 가리지 않게). -->
      <div v-if="hudOpen" class="hud" data-test="hud">
        <span>{{ device?.name }}</span>
        <span class="muted">{{ hudMeta }}</span>
        <button class="btn btn-sm" @click="toggleFullscreen">{{ t('player.fullscreen') }}</button>
        <button class="btn btn-sm" @click="resetSetup">{{ t('player.reset') }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.player {
  position: fixed;
  inset: 0;
  background: #000;
  color: #eee;
  overflow: hidden;
  /* 키오스크: 표출 화면에서 글자가 드래그로 선택되면 안 된다. */
  user-select: none;
}

/* 키오스크: 가만히 두면 커서를 숨긴다 — 사이니지 위에 화살표가 떠 있으면 안 된다. */
.player.cursor-hidden,
.player.cursor-hidden * {
  cursor: none !important;
}

/* --------------------------------------------------------------- 설정 */
.setup {
  height: 100%;
  display: grid;
  place-items: center;
}

.setup-card {
  width: 380px;
  padding: 28px;
  border-radius: 12px;
  background: #16181d;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.setup-card h1 {
  font-size: 20px;
  margin: 0;
}

.setup-card .field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 13px;
}

.code-input {
  font-size: 18px;
  letter-spacing: 2px;
  text-transform: uppercase;
  text-align: center;
}

.start-btn {
  padding: 11px;
  font-size: 15px;
}

/* --------------------------------------------------------------- 표출 */
.stage-wrap {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

/* 크기·배율은 stageStyle 이 인라인으로 준다 — 문서 원본 크기 + scale(x, y). */
.stage {
  position: absolute;
  left: 0;
  top: 0;
  overflow: hidden;
}

/* 장 전환용 두 겹 — 정확히 포개져야 디졸브가 자리 이동 없이 녹아든다. */
.fx-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  transition-property: opacity, transform, filter, clip-path;
  transition-timing-function: ease;
}

/* 들어오는 장이 위. 아래 깔린 앞 장이 그대로 비쳐 디졸브가 된다. */
.fx-layer:not(.out) {
  z-index: 1;
}

/*
 * ContentCanvas 는 편집기용 프레임(여백 20px/12px·테두리·배경·그림자)을
 * 두르는데, 그 여백만큼 자동 배율이 줄어 캔버스가 가운데 뜬 채 레터박스처럼
 * 보인다. 플레이어에서는 프레임을 전부 걷어 문서가 스테이지에 딱 맞게 한다.
 */
.stage :deep(.canvas-editor) {
  height: 100%;
}

.stage :deep(.canvas-editor .stage) {
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  min-height: 0;
}

.stage :deep(.canvas-editor .stage-inner) {
  overflow: hidden;
}

.stage :deep(.canvas-editor .canvas) {
  margin: 0;
  border-radius: 0;
  box-shadow: none;
}

/* 표출 화면에는 편집기·미리보기 표시가 나오면 안 된다:
   하단 정보줄(크기·배율·"미리보기")과 웹 요소의 가짜 주소창. */
.stage :deep(.canvas-editor .stage-bar),
.stage :deep(.canvas-editor .web-bar) {
  display: none;
}

.idle,
.off {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.clock {
  font-size: 72px;
  font-weight: 200;
  letter-spacing: 3px;
}

.hud {
  position: absolute;
  left: 14px;
  bottom: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgb(0 0 0 / 70%);
  font-size: 12px;
  z-index: 50;
}
</style>
