<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { api } from '@/api/client'
import LocaleThemeBar from '@/components/LocaleThemeBar.vue'
import OrgPicker from '@/components/OrgPicker.vue'

const router = useRouter()
const { t } = useI18n()

const form = ref({
  org_id: '',
  user_id: '',
  password: '',
  password_confirm: '',
  name: '',
  phone: '',
  email: '',
})

// 요구사항: 회원가입을 하려면 사용자ID 중복검사를 통과해야 한다.
const idCheck = ref({ state: 'idle', message: '' })
const error = ref('')
const submitting = ref(false)
const done = ref(false)

// 사용자ID 를 고치면 이전 중복검사 결과는 무효가 된다.
watch(
  () => form.value.user_id,
  () => {
    idCheck.value = { state: 'idle', message: '' }
  },
)

const passwordMismatch = computed(
  () => form.value.password_confirm.length > 0 && form.value.password !== form.value.password_confirm,
)

const canSubmit = computed(
  () =>
    form.value.org_id &&
    form.value.name.trim() &&
    form.value.password.length >= 8 &&
    !passwordMismatch.value &&
    idCheck.value.state === 'available',
)

const idCheckFailed = computed(() =>
  ['taken', 'invalid'].includes(idCheck.value.state),
)

async function checkUserId() {
  const value = form.value.user_id.trim()
  if (value.length < 4) {
    idCheck.value = { state: 'invalid', message: t('auth.idTooShort') }
    return
  }
  idCheck.value = { state: 'checking', message: t('auth.checking') }
  try {
    const result = await api.get('/auth/check-user-id', { user_id: value })
    idCheck.value = result.available
      ? { state: 'available', message: t('auth.idAvailable') }
      : { state: 'taken', message: t('auth.idTaken') }
  } catch (err) {
    idCheck.value = { state: 'invalid', message: err.detail ?? t('auth.idCheckFailed') }
  }
}

async function submit() {
  error.value = ''
  submitting.value = true
  try {
    await api.post('/auth/register', {
      org_id: Number(form.value.org_id),
      user_id: form.value.user_id.trim(),
      password: form.value.password,
      password_confirm: form.value.password_confirm,
      name: form.value.name.trim(),
      phone: form.value.phone.trim() || null,
      email: form.value.email.trim() || null,
    })
    done.value = true
  } catch (err) {
    error.value = err.detail ?? t('auth.registerFailed')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <LocaleThemeBar class="corner-bar" />

    <div class="auth-card card">
      <template v-if="done">
        <h1 class="page-title">{{ t('auth.registerDone') }}</h1>
        <p class="muted">{{ t('auth.registerDoneDesc') }}</p>
        <button class="btn btn-primary btn-block" @click="router.push('/login')">
          {{ t('auth.toLogin') }}
        </button>
      </template>

      <template v-else>
        <h1 class="page-title">{{ t('auth.register') }}</h1>
        <p class="page-desc">{{ t('auth.registerDesc') }}</p>

        <form @submit.prevent="submit">
          <div class="field">
            <label for="org">{{ t('auth.org') }}</label>
            <!--
              기관이 300개를 넘을 수 있다. 가입자가 스크롤로 자기 학교를 찾게
              두지 않고, 이름으로 검색해 고르게 한다. 로그인 전이라 공개
              경로를 쓴다.
            -->
            <OrgPicker
              id="org"
              v-model="form.org_id"
              endpoint="/organizations/public"
            />
          </div>

          <div class="field">
            <label for="uid">{{ t('auth.userId') }}</label>
            <div class="row">
              <input
                id="uid"
                v-model="form.user_id"
                class="input"
                :placeholder="t('auth.idPlaceholder')"
                required
              />
              <button class="btn" type="button" @click="checkUserId">
                {{ t('auth.checkDuplicate') }}
              </button>
            </div>
            <span v-if="idCheck.message" class="hint" :class="{ 'error-text': idCheckFailed }">
              {{ idCheck.message }}
            </span>
          </div>

          <div class="field">
            <label for="name">{{ t('auth.name') }}</label>
            <input id="name" v-model="form.name" class="input" required />
          </div>

          <div class="field">
            <label for="pw">{{ t('auth.password') }}</label>
            <input id="pw" v-model="form.password" class="input" type="password" minlength="8" required />
            <span class="hint">{{ t('auth.passwordHint') }}</span>
          </div>

          <div class="field">
            <label for="pw2">{{ t('auth.passwordConfirm') }}</label>
            <input id="pw2" v-model="form.password_confirm" class="input" type="password" required />
            <span v-if="passwordMismatch" class="error-text">{{ t('auth.passwordMismatch') }}</span>
          </div>

          <div class="grid-2">
            <div class="field">
              <label for="phone">{{ t('auth.phone') }}</label>
              <input id="phone" v-model="form.phone" class="input" placeholder="010-0000-0000" />
            </div>
            <div class="field">
              <label for="email">{{ t('auth.email') }}</label>
              <input id="email" v-model="form.email" class="input" type="email" />
            </div>
          </div>

          <p v-if="error" class="error-text">{{ error }}</p>

          <button class="btn btn-primary btn-block" type="submit" :disabled="!canSubmit || submitting">
            {{ submitting ? t('common.processing') : t('auth.registerSubmit') }}
          </button>
        </form>

        <div class="auth-foot">
          <RouterLink to="/login">{{ t('auth.backToLogin') }}</RouterLink>
        </div>
      </template>
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
  max-width: 460px;
  padding: 30px;
}

.btn-block {
  width: 100%;
  justify-content: center;
  padding: 10px;
  margin-top: 6px;
}

.auth-foot {
  margin-top: 16px;
  text-align: center;
  font-size: 13px;
}
</style>
