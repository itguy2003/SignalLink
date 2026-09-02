<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import ModalDialog from '@/components/ModalDialog.vue'
import OrgPicker from '@/components/OrgPicker.vue'
import { ASSIGNABLE_ROLES, ROLES, useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

const auth = useAuthStore()
const toast = useToastStore()
const { t } = useI18n()

// 서버가 저장하는 상태 값은 한국어 코드다. 표시만 번역한다.
const STATUSES = ['승인', '미승인']

const page = ref({ items: [], total: 0, page: 1, size: 20 })
const loading = ref(false)
const filters = ref({ q: '', status: '', role: '' })

const dialog = ref(null) // 'create' | 'edit' | null
const busy = ref(false)
const formError = ref('')
const editing = ref(null)
const form = ref({ org_id: '', user_id: '', password: '', name: '', phone: '', email: '', roles: [] })

async function load(pageNumber = page.value.page) {
  loading.value = true
  try {
    page.value = await api.get('/users', {
      q: filters.value.q || undefined,
      status: filters.value.status || undefined,
      role: filters.value.role || undefined,
      page: pageNumber,
      size: page.value.size,
    })
  } catch (err) {
    toast.error(err.detail ?? t('user.loadFailed'))
  } finally {
    loading.value = false
  }
}

onMounted(() => load(1))

function openCreate() {
  editing.value = null
  form.value = {
    org_id: auth.user.org_id,
    user_id: '',
    password: '',
    name: '',
    phone: '',
    email: '',
    // 새 계정은 MEMBER 로만 시작한다. 역할은 등록한 뒤 수정에서 준다.
    roles: [],
  }
  formError.value = ''
  dialog.value = 'create'
}

function openEdit(user) {
  editing.value = user
  form.value = {
    org_id: user.org_id,
    user_id: user.user_id,
    password: '',
    name: user.name,
    phone: user.phone ?? '',
    email: user.email ?? '',
    roles: user.roles.filter((role) => role !== 'MEMBER'),
  }
  formError.value = ''
  dialog.value = 'edit'
}

async function save() {
  busy.value = true
  formError.value = ''
  try {
    if (dialog.value === 'create') {
      await api.post('/users', {
        org_id: Number(form.value.org_id),
        user_id: form.value.user_id.trim(),
        password: form.value.password,
        name: form.value.name.trim(),
        phone: form.value.phone.trim() || null,
        email: form.value.email.trim() || null,
        // 역할은 보내지 않는다. 서버도 등록 시에는 무시한다.
      })
      toast.success(t('user.created'))
    } else {
      const body = {
        name: form.value.name.trim(),
        phone: form.value.phone.trim() || null,
        email: form.value.email.trim() || null,
        org_id: Number(form.value.org_id),
        roles: form.value.roles,
      }
      // 비밀번호는 입력했을 때만 재설정한다.
      if (form.value.password) body.password = form.value.password
      await api.put(`/users/${editing.value.id}`, body)
      toast.success(t('user.updated'))
    }
    dialog.value = null
    await load()
  } catch (err) {
    formError.value = err.detail ?? t('org.saveFailed')
  } finally {
    busy.value = false
  }
}

async function approve(user) {
  try {
    await api.post(`/users/${user.id}/approve`)
    toast.success(t('user.approved', { name: user.name }))
    await load()
  } catch (err) {
    toast.error(err.detail ?? t('user.approveFailed'))
  }
}

async function reject(user) {
  try {
    await api.post(`/users/${user.id}/reject`)
    toast.success(t('user.revoked', { name: user.name }))
    await load()
  } catch (err) {
    toast.error(err.detail ?? t('user.revokeFailed'))
  }
}

async function remove(user) {
  if (!confirm(t('user.confirmDelete', { name: user.name, userId: user.user_id }))) return
  try {
    await api.delete(`/users/${user.id}`)
    toast.success(t('user.deleted'))
    await load()
  } catch (err) {
    toast.error(err.detail ?? t('org.deleteFailed'))
  }
}

function toggleRole(role) {
  const list = form.value.roles
  form.value.roles = list.includes(role) ? list.filter((r) => r !== role) : [...list, role]
}
</script>

<template>
  <div>
    <h1 class="page-title">{{ t('user.title') }}</h1>
    <p class="page-desc">{{ t('user.desc') }}</p>

    <section class="card">
      <div class="card-header">
        <div class="row row-wrap">
          <input
            v-model="filters.q"
            class="input filter-input"
            :placeholder="t('user.searchPlaceholder')"
            @keyup.enter="load(1)"
          />
          <select v-model="filters.status" class="select filter-select" @change="load(1)">
            <option value="">{{ t('user.allStatus') }}</option>
            <option v-for="value in STATUSES" :key="value" :value="value">
              {{ t(`enums.userStatus.${value}`) }}
            </option>
          </select>
          <select v-model="filters.role" class="select filter-select" @change="load(1)">
            <option value="">{{ t('user.allRoles') }}</option>
            <option v-for="role in ROLES" :key="role" :value="role">
              {{ t(`enums.role.${role}`) }}
            </option>
          </select>
          <button class="btn" @click="load(1)">{{ t('common.search') }}</button>
        </div>
        <button class="btn btn-primary" @click="openCreate">{{ t('user.createButton') }}</button>
      </div>

      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('auth.userId') }}</th>
              <th>{{ t('auth.name') }}</th>
              <th>{{ t('auth.org') }}</th>
              <th>{{ t('user.roles') }}</th>
              <th>{{ t('auth.phone') }}</th>
              <th>{{ t('user.status') }}</th>
              <th class="right">{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in page.items" :key="user.id">
              <td class="mono">{{ user.user_id }}</td>
              <td>{{ user.name }}</td>
              <td>{{ user.org_name }}</td>
              <td>
                <span v-for="role in user.roles" :key="role" class="badge role-badge">
                  {{ t(`enums.role.${role}`) }}
                </span>
              </td>
              <td class="muted">{{ user.phone ?? '-' }}</td>
              <td>
                <span class="badge" :class="user.status === '승인' ? 'badge-success' : 'badge-warning'">
                  {{ t(`enums.userStatus.${user.status}`) }}
                </span>
              </td>
              <td class="right">
                <div class="row right-align">
                  <button
                    v-if="user.status === '미승인'"
                    class="btn btn-sm btn-primary"
                    @click="approve(user)"
                  >
                    {{ t('user.approve') }}
                  </button>
                  <button v-else class="btn btn-sm" @click="reject(user)">
                    {{ t('user.revoke') }}
                  </button>
                  <button class="btn btn-sm" @click="openEdit(user)">{{ t('common.edit') }}</button>
                  <button
                    class="btn btn-sm btn-danger"
                    :disabled="user.id === auth.user?.id"
                    @click="remove(user)"
                  >
                    {{ t('common.delete') }}
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="!loading && page.items.length === 0">
              <td colspan="7" class="table-empty">{{ t('user.empty') }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="pager">
        <button class="btn btn-sm" :disabled="page.page <= 1" @click="load(page.page - 1)">
          {{ t('common.prev') }}
        </button>
        <span class="muted">{{ page.page }} / {{ Math.max(1, Math.ceil(page.total / page.size)) }}</span>
        <button
          class="btn btn-sm"
          :disabled="page.page * page.size >= page.total"
          @click="load(page.page + 1)"
        >
          {{ t('common.next') }}
        </button>
        <span class="muted">{{ t('common.totalPeople', { count: page.total }) }}</span>
      </div>
    </section>

    <ModalDialog
      v-if="dialog"
      :title="dialog === 'create' ? t('user.createTitle') : t('user.editTitle')"
      :busy="busy"
      width="540px"
      @close="dialog = null"
      @confirm="save"
    >
      <div class="grid-2">
        <div class="field">
          <label>{{ t('auth.userId') }}</label>
          <input v-model="form.user_id" class="input" :disabled="dialog === 'edit'" />
        </div>
        <div class="field">
          <label>{{ t('auth.name') }}</label>
          <input v-model="form.name" class="input" />
        </div>
      </div>

      <div class="field">
        <label>{{ t('auth.org') }}</label>
        <!-- 기관이 300개를 넘을 수 있어 선택 상자에 다 채우지 않는다. -->
        <OrgPicker v-model="form.org_id" />
      </div>

      <div class="field">
        <label>{{ dialog === 'create' ? t('auth.password') : t('user.resetPassword') }}</label>
        <input
          v-model="form.password"
          class="input"
          type="password"
          :placeholder="t('auth.passwordHint')"
        />
      </div>

      <div class="grid-2">
        <div class="field">
          <label>{{ t('auth.phone') }}</label>
          <input v-model="form.phone" class="input" />
        </div>
        <div class="field">
          <label>{{ t('auth.email') }}</label>
          <input v-model="form.email" class="input" type="email" />
        </div>
      </div>

      <!--
        역할은 수정에서만 준다. 등록과 권한 부여를 한 번에 처리하면 계정을
        만드는 김에 권한까지 딸려 나가기 쉽다.
      -->
      <p v-if="dialog === 'create'" class="hint">{{ t('user.rolesAfterCreate') }}</p>

      <div v-else class="field">
        <label>{{ t('user.rolesHint') }}</label>
        <div class="roles">
          <label v-for="role in ASSIGNABLE_ROLES" :key="role" class="role-check">
            <input type="checkbox" :checked="form.roles.includes(role)" @change="toggleRole(role)" />
            {{ t(`enums.role.${role}`) }}
          </label>
          <label v-if="auth.isSuperAdmin" class="role-check">
            <input
              type="checkbox"
              :checked="form.roles.includes('SUPER_ADMIN')"
              @change="toggleRole('SUPER_ADMIN')"
            />
            {{ t('enums.role.SUPER_ADMIN') }}
          </label>
        </div>
      </div>

      <p v-if="formError" class="error-text">{{ formError }}</p>
    </ModalDialog>
  </div>
</template>

<style scoped>
.filter-input {
  width: 200px;
}

.filter-select {
  width: 150px;
}

.table-scroll {
  overflow-x: auto;
}

.right {
  text-align: right;
}

.right-align {
  justify-content: flex-end;
}

.role-badge {
  margin-right: 3px;
}

.pager {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}

.roles {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.role-check {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
}
</style>
