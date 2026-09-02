<script setup>
/**
 * 로그인/회원가입처럼 사이드바가 없는 화면에서 쓰는 테마·언어 전환 바.
 * 로그인 전에도 사용자가 자기 언어와 테마를 고를 수 있어야 한다.
 */
import { useI18n } from 'vue-i18n'

import { SUPPORTED_LOCALES } from '@/i18n'
import { useSettingsStore } from '@/stores/settings'

const settings = useSettingsStore()
const { t } = useI18n()
</script>

<template>
  <div class="bar">
    <button
      class="btn btn-icon"
      :title="`${t('layout.theme')}: ${t(settings.isDark ? 'layout.themeDark' : 'layout.themeLight')}`"
      @click="settings.toggleTheme()"
    >
      <span aria-hidden="true">{{ settings.isDark ? '☀' : '☾' }}</span>
      <span class="sr-only">{{ t('layout.theme') }}</span>
    </button>

    <select
      class="select lang-select"
      :value="settings.locale"
      :aria-label="t('layout.language')"
      @change="settings.setLocale($event.target.value)"
    >
      <option v-for="option in SUPPORTED_LOCALES" :key="option.code" :value="option.code">
        {{ option.label }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.lang-select {
  width: auto;
  padding: 5px 8px;
  font-size: 12px;
}
</style>
