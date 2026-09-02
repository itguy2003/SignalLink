<script setup>
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()
</script>

<template>
  <div class="toasts">
    <div v-for="item in toast.items" :key="item.id" class="toast" :class="`toast-${item.type}`" @click="toast.dismiss(item.id)">
      {{ item.message }}
    </div>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  right: 20px;
  bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 100;
}

.toast {
  max-width: 380px;
  padding: 11px 15px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  box-shadow: var(--shadow-toast);
  font-size: 13px;
  white-space: pre-line;
  cursor: pointer;
}

.toast-success {
  border-color: var(--success-border);
  background: var(--success-soft);
  color: var(--success);
}

.toast-error {
  border-color: var(--danger-border);
  background: var(--danger-soft);
  color: var(--danger);
}
</style>
