<script setup>
/**
 * 관리자 — 기관구분 관리 (슈퍼관리자 전용).
 *
 * 기관구분은 고정 3종이 아니라 여기서 관리하는 데이터다. 이름을 바꾸면
 * 그 구분을 쓰는 기관들의 기관구분도 함께 바뀌고, 사용 중인 구분은
 * 삭제할 수 없다(수정만 가능). 시스템 동작(커뮤니티 소유·학교급)은
 * 이름이 아니라 분류(category)를 따른다.
 */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()
const { t } = useI18n()

const CATEGORIES = ['기관', '학교', '기타']

const rows = ref([])
const loading = ref(true)
/** 편집 중인 값. {id: {name, category}} — 저장 전에는 목록 값과 분리해 둔다. */
const drafts = ref({})
const busyId = ref(null)

const newForm = ref({ name: '', category: '기타', classifications: '' })
const adding = ref(false)

async function load() {
  rows.value = await api.get('/org-types')
  drafts.value = Object.fromEntries(
    rows.value.map((row) => [
      row.id,
      { name: row.name, category: row.category, classifications: row.classifications ?? '' },
    ]),
  )
}

onMounted(async () => {
  try {
    await load()
  } catch (err) {
    toast.error(err.detail ?? t('admin.loadFailed'))
  } finally {
    loading.value = false
  }
})

function dirty(row) {
  const draft = drafts.value[row.id]
  return (
    draft &&
    (draft.name !== row.name ||
      draft.category !== row.category ||
      draft.classifications !== (row.classifications ?? ''))
  )
}

async function save(row) {
  const draft = drafts.value[row.id]
  busyId.value = row.id
  try {
    await api.put(`/org-types/${row.id}`, {
      name: draft.name.trim(),
      category: draft.category,
      classifications: draft.classifications,
    })
    toast.success(t('admin.orgTypeSaved'))
    await load()
  } catch (err) {
    toast.error(err.detail ?? t('admin.orgTypeSaveFailed'))
  } finally {
    busyId.value = null
  }
}

async function remove(row) {
  // 사용 중이면 서버가 사용 기관 수와 함께 거절한다 — 그 이유를 그대로 보여 준다.
  if (!confirm(t('admin.confirmRemoveOrgType', { name: row.name }))) return
  try {
    await api.delete(`/org-types/${row.id}`)
    toast.success(t('admin.orgTypeRemoved'))
    await load()
  } catch (err) {
    toast.error(err.detail ?? t('admin.removeFailed'))
  }
}

async function add() {
  const name = newForm.value.name.trim()
  if (!name) {
    toast.error(t('admin.orgTypeNameRequired'))
    return
  }
  adding.value = true
  try {
    await api.post('/org-types', {
      name,
      category: newForm.value.category,
      classifications: newForm.value.classifications,
    })
    toast.success(t('admin.orgTypeAdded'))
    newForm.value = { name: '', category: '기타', classifications: '' }
    await load()
  } catch (err) {
    toast.error(err.detail ?? t('admin.orgTypeAddFailed'))
  } finally {
    adding.value = false
  }
}
</script>

<template>
  <div>
    <h1 class="page-title">{{ t('admin.orgTypesTitle') }}</h1>
    <p class="page-desc">{{ t('admin.orgTypesDesc') }}</p>

    <section class="card">
      <div class="card-header">
        <h2>{{ t('admin.orgTypeCount', { count: rows.length }) }}</h2>
        <!-- 새 구분 추가 -->
        <div class="row">
          <input
            v-model="newForm.name"
            class="input new-name"
            :placeholder="t('admin.orgTypeNamePlaceholder')"
            data-test="new-name"
            @keyup.enter="add"
          />
          <select v-model="newForm.category" class="select" data-test="new-category">
            <option v-for="category in CATEGORIES" :key="category" :value="category">
              {{ t(`admin.orgTypeCategory.${category}`) }}
            </option>
          </select>
          <input
            v-model="newForm.classifications"
            class="input new-classifications"
            :placeholder="t('admin.orgTypeClassificationsPlaceholder')"
            data-test="new-classifications"
          />
          <button class="btn btn-primary" :disabled="adding" data-test="add" @click="add">
            {{ t('admin.orgTypeAdd') }}
          </button>
        </div>
      </div>

      <p v-if="loading" class="muted pad">{{ t('common.loading') }}</p>
      <table v-else class="table">
        <colgroup>
          <col class="w-name" />
          <col class="w-category" />
          <col />
          <col class="w-usage" />
          <col class="w-actions" />
        </colgroup>
        <thead>
          <tr>
            <th>{{ t('admin.orgTypeName') }}</th>
            <th>{{ t('admin.orgTypeCategoryLabel') }}</th>
            <th>{{ t('admin.orgTypeClassifications') }}</th>
            <th class="num">{{ t('admin.orgTypeUsage') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id" data-test="type-row">
            <td>
              <input
                v-model="drafts[row.id].name"
                class="input row-name"
                data-test="name-input"
              />
            </td>
            <td>
              <select v-model="drafts[row.id].category" class="select" data-test="category-select">
                <option v-for="category in CATEGORIES" :key="category" :value="category">
                  {{ t(`admin.orgTypeCategory.${category}`) }}
                </option>
              </select>
            </td>
            <td>
              <!-- 분류 선택지 — 쉼표로 여러 값. 기관 등록 화면이 쪼개어 드롭다운으로 쓴다. -->
              <input
                v-model="drafts[row.id].classifications"
                class="input row-classifications"
                :placeholder="t('admin.orgTypeClassificationsPlaceholder')"
                data-test="classifications-input"
              />
            </td>
            <td class="num">
              <span :class="{ muted: row.usage_count === 0 }">
                {{ t('admin.orgTypeUsedBy', { count: row.usage_count }) }}
              </span>
            </td>
            <td class="actions">
              <button
                class="btn btn-sm btn-primary"
                :disabled="!dirty(row) || busyId === row.id"
                data-test="save"
                @click="save(row)"
              >
                {{ t('common.save') }}
              </button>
              <!-- 사용 중이면 삭제 불가(수정만 가능) — 버튼을 잠그고 이유를 단다. -->
              <button
                class="btn btn-sm btn-danger"
                :disabled="row.usage_count > 0"
                :title="row.usage_count > 0 ? t('admin.orgTypeInUse', { count: row.usage_count }) : null"
                data-test="remove"
                @click="remove(row)"
              >
                {{ t('common.delete') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="hint pad">{{ t('admin.orgTypeHint') }}</p>
    </section>
  </div>
</template>

<style scoped>
.new-name {
  width: 160px;
}

.w-name {
  width: 170px;
}

.w-category {
  width: 150px;
}

.new-classifications {
  width: 180px;
}

.row-classifications {
  width: 100%;
  padding: 5px 9px;
}

.w-usage {
  width: 130px;
}

.w-actions {
  width: 140px;
}

.row-name {
  max-width: 240px;
  padding: 5px 9px;
}

.num {
  text-align: right;
  white-space: nowrap;
}

.actions {
  white-space: nowrap;
}

.actions .btn + .btn {
  margin-left: 6px;
}

.pad {
  padding: 10px 16px;
}

.hint {
  border-top: 1px solid var(--border);
  margin: 0;
}
</style>
