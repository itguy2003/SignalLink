<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { api, TEST_MODE } from '@/api/client'
import LocaleThemeBar from '@/components/LocaleThemeBar.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const { t } = useI18n()

const userId = ref('')
const password = ref('')
const error = ref('')
const health = ref(null)

/**
 * 테스트 계정 버튼.
 *
 * 비밀번호가 들어 있는 목록이라 운영 번들에 넣지 않는다. 모의 서버와 같은
 * 이유로 테스트 모드에서만 동적으로 불러온다([@/api/client]의 loadMockServer 참고).
 */
const testAccounts = ref([])

onMounted(async () => {
  if (TEST_MODE) {
    health.value = 'test'
    testAccounts.value = (await import('@/api/mock/data')).TEST_ACCOUNTS
    return
  }
  // 백엔드가 떠 있는지 미리 확인해, 로그인 실패 원인을 헷갈리지 않게 한다.
  try {
    await api.get('/organizations/public')
    health.value = 'ok'
  } catch {
    health.value = 'down'
  }
})

async function submit() {
  error.value = ''
  try {
    await auth.login(userId.value.trim(), password.value)
    router.push(route.query.redirect ?? '/')
  } catch (err) {
    error.value = err.detail ?? t('auth.loginFailed')
  }
}

function fillTestAccount(account) {
  userId.value = account.user_id
  password.value = account.password
}
</script>

<template>
  <div class="auth-page">
    <LocaleThemeBar class="corner-bar" />

    <div class="auth-card card">
      <div class="auth-head">
        <div class="brand-mark">SL</div>
        <h1>{{ t('app.name') }} {{ t('app.edition') }}</h1>
        <p class="muted">{{ t('app.tagline') }}</p>
      </div>

      <form @submit.prevent="submit">
        <div class="field">
          <label for="userId">{{ t('auth.userId') }}</label>
          <input id="userId" v-model="userId" class="input" autocomplete="username" required />
        </div>

        <div class="field">
          <label for="password">{{ t('auth.password') }}</label>
          <input
            id="password"
            v-model="password"
            class="input"
            type="password"
            autocomplete="current-password"
            required
          />
        </div>

        <p v-if="error" class="error-text">{{ error }}</p>

        <button class="btn btn-primary btn-block" type="submit" :disabled="auth.loading">
          {{ auth.loading ? t('auth.loggingIn') : t('auth.login') }}
        </button>
      </form>

      <div class="auth-foot">
        <RouterLink to="/register">{{ t('auth.register') }}</RouterLink>
      </div>

      <div v-if="health === 'down'" class="notice notice-warn">
        <i18n-t keypath="auth.backendDown">
          <template #command><code>uvicorn app.main:app --reload</code></template>
          <template #testCommand><code>npm run dev:test</code></template>
        </i18n-t>
      </div>

      <div v-if="TEST_MODE" class="notice notice-test">
        <strong>{{ t('layout.testMode') }}</strong> — {{ t('auth.testModeNotice') }}
        <div class="accounts">
          <button
            v-for="account in testAccounts"
            :key="account.user_id"
            class="btn btn-sm"
            type="button"
            @click="fillTestAccount(account)"
          >
            {{ t(`enums.role.${account.role}`) }}
            <span v-if="account.orgLabel" class="muted">· {{ account.orgLabel }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 24px;
  background: var(--auth-bg);
}

.corner-bar {
  position: absolute;
  top: 16px;
  right: 16px;
}

.auth-card {
  width: 100%;
  max-width: 400px;
  padding: 30px;
}

.auth-head {
  text-align: center;
  margin-bottom: 24px;
}

.auth-head h1 {
  font-size: 19px;
  margin: 12px 0 2px;
}

.auth-head p {
  margin: 0;
  font-size: 12px;
}

.brand-mark {
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: var(--primary);
  color: #fff;
  font-weight: 700;
}

.btn-block {
  width: 100%;
  justify-content: center;
  padding: 10px;
}

.auth-foot {
  margin-top: 16px;
  text-align: center;
  font-size: 13px;
}

.notice {
  margin-top: 18px;
  padding: 11px 13px;
  border-radius: var(--radius);
  font-size: 12px;
  line-height: 1.6;
}

.notice code {
  background: var(--surface-2);
  padding: 1px 4px;
  border-radius: 3px;
}

.notice-warn {
  background: var(--warning-soft);
  border: 1px solid var(--warning-border);
  color: var(--warning);
}

.notice-test {
  background: var(--primary-soft);
  border: 1px solid var(--primary-border);
  color: var(--primary);
}

.accounts {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 9px;
}
</style>
