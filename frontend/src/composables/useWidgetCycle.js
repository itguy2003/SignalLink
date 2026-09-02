/**
 * 위젯 재생목록을 실제 시간·전환 그대로 돌린다.
 *
 * 재생목록 미리보기(PlaylistPreview)와 콘텐츠 미리보기(캔버스의 재생목록
 * 요소)가 **같은 규칙**으로 돌아야 한다. 두 곳에 따로 적으면 한쪽만 고쳐져
 * "재생목록 화면에서는 맞는데 콘텐츠에서는 다르다"가 된다. 그래서 시간을
 * 세는 일과 전환을 입히는 일을 여기 한 곳에 둔다.
 *
 * 화면에 무엇을 그릴지는 여기서 정하지 않는다 — 부르는 쪽이 `current` 와
 * `stageStyle` 로 제 무대에 그린다.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import {
  crossfades,
  enterStyle,
  exitStyle,
  normalize,
  normalizeMs,
  restStyle,
} from '@/utils/transitions'

/**
 * @param items 항목 배열을 돌려주는 함수(ref 를 그대로 받지 않는 이유는
 *              props 든 계산값이든 같은 방식으로 받기 위해서다).
 * @param options.autoplay 만들자마자 돌릴지. 편집 중 미리보기는 늘 true 다.
 */
export function useWidgetCycle(items, { autoplay = true } = {}) {
  const list = computed(() => items() ?? [])

  const index = ref(0)
  const playing = ref(autoplay)

  /** 지금 칸의 남은 시간(초). 1초마다 줄어든다. */
  const remaining = ref(0)

  const current = computed(() => list.value[index.value] ?? null)

  /** 항목의 표출 시간. 0 이나 음수는 타이머가 폭주하므로 1초로 끌어올린다. */
  function seconds(item) {
    return Math.max(1, Number(item?.duration_sec) || 1)
  }

  /** 한 바퀴 도는 데 걸리는 시간. 얼마마다 같은 화면이 돌아오는지가 관심사다. */
  const cycleSeconds = computed(() =>
    list.value.reduce((sum, item) => sum + seconds(item), 0),
  )

  /**
   * 전환 중인가. 들어오는 화면을 시작 모습에 놓았다가 다음 프레임에 제자리로
   * 보내야 브라우저가 사이를 채운다 — 처음부터 제자리에 그리면 아무 일도
   * 일어나지 않는다.
   */
  const entering = ref(false)

  /** 지금 칸의 전환 효과. 저장된 이름이 사라졌어도 '없음'으로 떨어진다. */
  const transition = computed(() => normalize(current.value?.transition))

  /** 지금 칸의 전환 시간. 칸마다 다르므로 무대의 transition-duration 도 따라간다. */
  const transitionMs = computed(() => normalizeMs(current.value?.transition_ms))

  const stageStyle = computed(() => ({
    ...(entering.value ? enterStyle(transition.value) : restStyle()),
    transitionDuration: `${transitionMs.value}ms`,
  }))

  /**
   * 디졸브에서 뒤에 남겨 두는 앞 화면. 겹치지 않는 효과에서는 언제나 null.
   *
   * 앞 화면이 사라지면서 뒤 화면이 드러나는 것이 디졸브의 전부라, 들어오는
   * 쪽만 그리면 페이드와 구별되지 않는다.
   */
  const outgoing = ref(null)

  const outgoingStyle = computed(() => ({
    ...(entering.value ? restStyle() : exitStyle(transition.value)),
    transitionDuration: `${transitionMs.value}ms`,
  }))

  let timer = null
  let outgoingTimer = null

  function clearTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function clearOutgoing() {
    if (outgoingTimer) {
      clearTimeout(outgoingTimer)
      outgoingTimer = null
    }
    outgoing.value = null
  }

  /**
   * 다음 칸을 시작 모습에 놓고 곧바로 제자리로 보낸다.
   *
   * 손으로 넘길 때도 같은 효과를 준다 — 효과를 고르는 목적이 '어떻게
   * 보이는지' 확인하는 것이라, 자동 재생을 기다려야 볼 수 있으면 쓸모가 없다.
   */
  function playTransition(previous = null) {
    clearOutgoing()
    if (transition.value === 'none') {
      entering.value = false
      return
    }
    // 겹쳐 그리는 효과는 앞 화면을 전환이 끝날 때까지만 들고 있는다. 남겨 두면
    // 살아 있는 위젯이 두 벌 계속 돌아간다.
    if (previous && crossfades(transition.value)) {
      outgoing.value = previous
      outgoingTimer = setTimeout(clearOutgoing, transitionMs.value)
    }
    entering.value = true
    requestAnimationFrame(() => {
      entering.value = false
    })
  }

  /**
   * 1초 간격으로 남은 시간을 줄이다가 0 이 되면 다음 칸으로.
   *
   * 칸 길이만큼 한 번에 기다리지 않는 이유는 남은 시간을 보여 주기 위해서다.
   * 초 단위로 세면 화면의 숫자와 실제 전환이 어긋나지 않는다.
   */
  function tick() {
    remaining.value -= 1
    if (remaining.value > 0) return
    const previous = current.value
    index.value = (index.value + 1) % list.value.length
    remaining.value = seconds(current.value)
    playTransition(previous)
  }

  function start() {
    clearTimer()
    if (!playing.value || list.value.length === 0) return
    timer = setInterval(tick, 1000)
  }

  function stop() {
    playing.value = false
    clearTimer()
  }

  function togglePlay() {
    if (list.value.length === 0) return
    playing.value = !playing.value
    if (playing.value) {
      // 멈춘 자리에서 이어서 센다. 처음부터 다시 세면 확인하던 자리를 잃는다.
      if (remaining.value <= 0) remaining.value = seconds(current.value)
      start()
    } else {
      clearTimer()
    }
  }

  /** 손으로 넘기면 재생은 멈춘다 — 한 칸을 들여다보려는 조작이다. */
  function go(offset) {
    if (list.value.length === 0) return
    stop()
    const previous = current.value
    index.value = (index.value + offset + list.value.length) % list.value.length
    remaining.value = seconds(current.value)
    playTransition(previous)
  }

  function select(at) {
    stop()
    const previous = current.value
    index.value = at
    remaining.value = seconds(current.value)
    playTransition(previous)
  }

  // 칸이 지워져 자리가 비면 처음으로 되돌린다. 늘어난 경우에도 다시 돌린다
  // (편집 중에 담으면 그 자리에서 바로 돌아야 한다).
  watch(
    () => list.value.length,
    (length) => {
      if (index.value >= length) index.value = 0
      remaining.value = seconds(current.value)
      start()
    },
  )

  remaining.value = seconds(current.value)
  start()

  onBeforeUnmount(() => {
    clearTimer()
    clearOutgoing()
  })

  return {
    index,
    playing,
    remaining,
    current,
    outgoing,
    entering,
    transition,
    transitionMs,
    stageStyle,
    outgoingStyle,
    cycleSeconds,
    seconds,
    tick,
    start,
    stop,
    togglePlay,
    go,
    select,
  }
}
