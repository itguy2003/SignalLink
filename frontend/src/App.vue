<script setup>
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'

import AppLayout from '@/components/AppLayout.vue'
import ToastStack from '@/components/ToastStack.vue'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const auth = useAuthStore()

onMounted(() => {
  // 라우터 가드가 이미 복구를 시도하지만, 첫 진입이 public 라우트면 건너뛴다.
  if (!auth.isAuthenticated && auth.token) auth.restore()
})
</script>

<template>
  <AppLayout v-if="route.meta.layout !== 'blank'">
    <RouterView />
  </AppLayout>
  <RouterView v-else />
  <ToastStack />
</template>
