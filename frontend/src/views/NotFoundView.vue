<script setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div class="empty">
    <h1 class="page-title">{{ t('notFound.title') }}</h1>
    <p class="muted">{{ t('notFound.desc') }}</p>
    <RouterLink to="/" class="btn btn-primary">{{ t('notFound.goHome') }}</RouterLink>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 60px 0;
}
</style>
