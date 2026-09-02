import { defineStore } from 'pinia'
import { ref } from 'vue'

let counter = 0

export const useToastStore = defineStore('toast', () => {
  const items = ref([])

  function push(message, type = 'info', timeout = 4000) {
    const id = ++counter
    items.value.push({ id, message, type })
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
