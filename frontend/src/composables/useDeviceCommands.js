/**
 * 장치 원격 제어 버튼의 동작.
 *
 * 카드 보기와 리스트 보기가 **같은 버튼을 같은 방식으로** 다뤄야 한다.
 * 두 벌로 두면 한쪽만 고쳐져 보기 방식에 따라 동작이 갈린다.
 *
 * 실제 요청은 부모(장치 관리 화면)가 보낸다. 여기서는 무엇을 보낼지와
 * 보낸 뒤 무엇을 기다릴지만 정한다.
 */
import { onBeforeUnmount, ref } from 'vue'

/**
 * 지원하는 명령과 화면에 쓸 번역 키. 순서가 곧 버튼 순서다.
 * 명령 문자열은 백엔드 `api/v1/devices.py` 의 DEVICE_COMMANDS 와 같아야 한다.
 */
export const DEVICE_COMMANDS = [
  { key: 'shutdown', labelKey: 'device.cmdShutdown', danger: true },
  { key: 'restart', labelKey: 'device.cmdRestart' },
  { key: 'reload', labelKey: 'device.cmdReload' },
  { key: 'screenshot', labelKey: 'device.cmdPreview' },
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 미리보기를 요청한 뒤 캡처가 올라왔는지 확인할 시점(ms). */
const PREVIEW_CHECKS = [900, 2000, 4000]

export function useDeviceCommands(getDevice, emit) {
  /** 미리보기 요청 후 캡처를 기다리는 중인가. */
  const requesting = ref(false)

  /** 언마운트 뒤에 늦게 도착한 응답으로 상태를 건드리지 않기 위한 표시. */
  let alive = true
  onBeforeUnmount(() => {
    alive = false
  })

  /** 부모가 실제 요청을 보낸다. 성공 여부를 돌려받아야 다음 단계를 정할 수 있다. */
  function send(command) {
    return new Promise((resolve) =>
      emit('command', { device: getDevice(), command, resolve }),
    )
  }

  function refresh() {
    return new Promise((resolve) => emit('refresh', { device: getDevice(), resolve }))
  }

  /**
   * 미리보기 요청.
   *
   * 명령을 보낸 뒤 장치가 찍어 올리기까지 잠깐 걸린다. 몇 번 나눠 확인하고
   * 캡처 시각이 바뀌면 멈춘다. 한 번만 확인하면 대개 옛 화면이 그대로다.
   */
  async function requestPreview() {
    requesting.value = true
    const before = getDevice().screenshot_at
    try {
      if (!(await send('screenshot'))) return

      for (const delay of PREVIEW_CHECKS) {
        await sleep(delay)
        if (!alive) return
        const fresh = await refresh()
        if (fresh?.screenshot_at && fresh.screenshot_at !== before) return
      }
    } finally {
      if (alive) requesting.value = false
    }
  }

  function run(command) {
    if (command === 'screenshot') {
      requestPreview()
      return
    }
    send(command)
  }

  /**
   * 이 버튼을 지금 누를 수 있는가.
   *
   * 명령은 WebSocket 으로만 나가므로 접속 중인 장치에만 보낼 수 있다.
   * 누르게 두면 눌러 본 뒤에야 실패를 알게 된다.
   */
  function disabled(command, canManage) {
    const device = getDevice()
    return !device.online || !canManage || (command.key === 'screenshot' && requesting.value)
  }

  return { commands: DEVICE_COMMANDS, requesting, run, disabled }
}
