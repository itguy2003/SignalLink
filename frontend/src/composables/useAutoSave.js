/**
 * 주기적 자동 저장.
 *
 * 편집기는 한 번 열면 오래 머문다. 그 사이에 브라우저가 닫히거나 탭이
 * 날아가면 그동안 한 일이 통째로 사라진다 — 저장 버튼이 있다는 것과 사람이
 * 그것을 제때 누른다는 것은 다른 이야기다.
 *
 * 세 가지를 지킨다.
 *
 *   조용히    자동 저장은 30초마다 일어난다. 그때마다 알림을 띄우면 편집을
 *             방해한다. 결과는 머리말의 상태 한 줄로만 알린다.
 *   덮지 않기 저장하는 동안에도 편집은 이어진다. 보낸 뒤에 바뀐 것이 있으면
 *             '저장됨' 으로 치지 않는다 — 그러면 그 편집이 다음 저장에서
 *             빠진다.
 *   물러서기  서버가 죽었거나 권한이 없어진 상태에서 30초마다 두드리면
 *             오류만 쌓인다. 실패가 이어지면 간격을 벌린다.
 */
import { onBeforeUnmount, ref } from 'vue'

/** 자동 저장 간격. 짧으면 서버를 두드리고, 길면 잃는 양이 늘어난다. */
export const AUTO_SAVE_INTERVAL_MS = 30_000

/** 실패가 이어질 때 건너뛸 수 있는 최대 주기(= 8분). */
const MAX_SKIP = 16

/**
 * @param attempt 저장 시도. 저장했으면 true, 저장할 것이 없으면 false 를
 *                돌려주고, 실패하면 던진다.
 */
export function useAutoSave(attempt, { intervalMs = AUTO_SAVE_INTERVAL_MS } = {}) {
  /** 'idle' | 'saving' | 'saved' | 'error' */
  const status = ref('idle')
  /** 마지막으로 저장된 시각. 머리말이 '몇 분 전' 을 그리는 근거다. */
  const savedAt = ref(null)
  const error = ref('')

  let timer = null
  /** 실패 뒤 건너뛸 주기 수. 성공하면 0 으로 돌아간다. */
  let skip = 0
  let skipped = 0

  async function tick() {
    // 물러서는 중이면 이번 차례는 넘긴다.
    if (skip > 0 && skipped < skip) {
      skipped += 1
      return
    }
    skipped = 0

    if (status.value === 'saving') return

    status.value = 'saving'
    try {
      const saved = await attempt()
      skip = 0
      error.value = ''
      if (saved) {
        savedAt.value = new Date()
        status.value = 'saved'
      } else {
        // 고칠 것이 없었다. 앞서 저장한 적이 있으면 그 표시를 지우지 않는다.
        status.value = savedAt.value ? 'saved' : 'idle'
      }
    } catch (err) {
      skip = skip === 0 ? 1 : Math.min(MAX_SKIP, skip * 2)
      error.value = err?.detail ?? String(err?.message ?? err)
      status.value = 'error'
    }
  }

  function start() {
    stop()
    timer = setInterval(tick, intervalMs)
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  /** 주기를 기다리지 않고 지금 한 번. 화면을 떠나기 직전 등에 쓴다. */
  async function flush() {
    skip = 0
    skipped = 0
    await tick()
  }

  start()
  onBeforeUnmount(stop)

  return { status, savedAt, error, start, stop, flush, tick }
}
