import { defineStore } from 'pinia'
import { ref } from 'vue'

let counter = 0

export const useToastStore = defineStore('toast', () => {
  const items = ref([])

  function push(message, type = 'info', timeout = 4000) {
    const id = ++counter
    // timeout 을 함께 실어 화면이 사라짐 애니메이션을 수명과 맞출 수 있게 한다.
    items.value.push({ id, message, type, timeout })
    setTimeout(() => dismiss(id), timeout)
    return id
  }

  function dismiss(id) {
    items.value = items.value.filter((item) => item.id !== id)
  }

  const success = (message) => push(message, 'success')
  const error = (message) => push(message, 'error', 6000)

  return { items, push, dismiss, success, error }
})
