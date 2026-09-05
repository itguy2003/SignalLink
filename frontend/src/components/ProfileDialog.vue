<script setup>
/**
 * 내 정보 변경 창 — 이름·연락처·이메일과 비밀번호.
 *
 * 상단 바에서 연다. 누구에게나 있어야 하는 기능이라 `/auth/me` 를 쓴다 —
 * 커뮤니티 유저는 `/users` 경로가 울타리 밖이라 닿지 못한다.
 *
 * 비밀번호는 **현재 비밀번호를 확인**하고 바꾼다(`/auth/change-password`).
 * 로그인된 자리라는 것만 믿으면, 자리를 비운 사이 누구든 비밀번호를 갈아
 * 끼울 수 있다.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import ModalDialog from '@/components/ModalDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

const emit = defineEmits(['close'])

const auth = useAuthStore()
const toast = useToastStore()
const { t } = useI18n()

const form = ref({
  name: auth.user?.name ?? '',
  phone: auth.user?.phone ?? '',
  email: auth.user?.email ?? '',
})

const password = ref({ current: '', next: '', confirm: '' })

const saving = ref(false)
const formError = ref('')

/** 비밀번호 칸을 하나라도 건드렸는가. 건드렸으면 셋 다 맞아야 한다. */
const changingPassword = computed(
  () => password.value.current || password.value.next || password.value.confirm,
)

async function save() {
  formError.value = ''

  if (!form.value.name.trim()) {
    formError.value = t('profile.nameRequired')
    return
  }
  if (changingPassword.value) {
    if (!password.value.current) {
      formError.value = t('profile.currentRequired')
      return
    }
    if (password.value.next.length < 8) {
      formError.value = t('profile.passwordTooShort')
      return
    }
    if (password.value.next !== password.value.confirm) {
      formError.value = t('profile.passwordMismatch')
      return
    }
  }

  saving.value = true
  try {
    // 프로필 먼저, 비밀번호는 그다음. 비밀번호가 틀려도 이름 변경은 살린다.
    const me = await api.put('/auth/me', {
      name: form.value.name.trim(),
      phone: form.value.phone.trim() || null,
      email: form.value.email.trim() || null,
    })
    auth.user = me

    if (changingPassword.value) {
      await api.post('/auth/change-password', {
        current_password: password.value.current,
        new_password: password.value.next,
        new_password_confirm: password.value.confirm,
      })
    }

    toast.success(t('profile.saved'))
    emit('close')
  } catch (err) {
    formError.value = err.detail ?? t('profile.saveFailed')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ModalDialog
    :title="t('profile.title')"
    width="440px"
    :busy="saving"
    :confirm-label="t('common.save')"
    @close="emit('close')"
    @confirm="save"
  >
    <!-- 아이디와 소속은 보여만 준다. 그건 관리자의 일이다. -->
    <p class="hint who">
      {{ auth.user?.user_id }} · {{ auth.user?.org_name ?? '-' }}
    </p>

    <div class="field">
      <label>{{ t('profile.name') }} *</label>
      <input v-model="form.name" class="input" />
    </div>
    <div class="field">
      <label>{{ t('profile.phone') }}</label>
      <input v-model="form.phone" class="input" />
    </div>
    <div class="field">
      <label>{{ t('profile.email') }}</label>
      <input v-model="form.email" class="input" type="email" />
    </div>

    <h4 class="section">{{ t('profile.passwordSection') }}</h4>
    <p class="hint">{{ t('profile.passwordHint') }}</p>

    <div class="field">
      <label>{{ t('profile.currentPassword') }}</label>
      <input v-model="password.current" class="input" type="password" autocomplete="current-password" />
    </div>
    <div class="row">
      <div class="field">
        <label>{{ t('profile.newPassword') }}</label>
        <input v-model="password.next" class="input" type="password" autocomplete="new-password" />
      </div>
      <div class="field">
        <label>{{ t('profile.confirmPassword') }}</label>
        <input v-model="password.confirm" class="input" type="password" autocomplete="new-password" />
      </div>
    </div>

    <p v-if="formError" class="error-text">{{ formError }}</p>
  </ModalDialog>
</template>

<style scoped>
.who {
  margin: 0 0 10px;
}

.section {
  margin: 14px 0 2px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
}

.row {
  display: flex;
  gap: 10px;
}

.row .field {
  flex: 1;
}
</style>
