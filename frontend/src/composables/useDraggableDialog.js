/**
 * 레이어(모달) 끌어 옮기기.
 *
 * 머리글을 잡고 끌면 창이 따라온다 — 레이어가 가린 뒤쪽 화면을 봐야 할 때
 * 닫지 않고 비켜 둘 수 있다. 창은 가운데 정렬된 자리에서 `translate` 로
 * 이동하므로 레이아웃은 건드리지 않고, 다시 열면 가운데로 돌아온다
 * (컴포넌트가 새로 마운트되며 offset 이 0 에서 시작한다).
 *
 * 머리글 안의 버튼·입력란에서 시작한 누름은 끌기로 보지 않는다 — ✕ 를 누르다
 * 창이 끌려가면 안 된다.
 */
import { computed, onBeforeUnmount, ref } from 'vue'

export function useDraggableDialog() {
  const offset = ref({ x: 0, y: 0 })
  let start = null

  function onMove(event) {
    if (!start) return
    offset.value = { x: event.clientX - start.x, y: event.clientY - start.y }
  }

  function onUp() {
    start = null
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  /** 머리글(끌기 손잡이)의 mousedown 에 건다. */
  function onHandleMouseDown(event) {
    if (event.button !== 0) return
    if (event.target?.closest?.('button, input, textarea, select, a, label')) return
    start = { x: event.clientX - offset.value.x, y: event.clientY - offset.value.y }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    // 끌리는 동안 머리글 글자가 드래그 선택되지 않게.
    event.preventDefault()
  }

  const dialogStyle = computed(() => ({
    transform: `translate(${offset.value.x}px, ${offset.value.y}px)`,
  }))

  onBeforeUnmount(onUp)

  return { dialogStyle, onHandleMouseDown, offset }
}
