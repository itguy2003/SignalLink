<script setup>
/**
 * 커뮤니티 — 커뮤니티 콘텐츠 목록.
 *
 * 공유물로 엮은 슬라이드 묶음을 만들고 고치는 곳이다. 여기서 만든 것을
 * CMS 콘텐츠 편집기의 **커뮤니티 위젯**이 골라 재생목록처럼 돌린다.
 */
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useRouter } from 'vue-router'

import { api } from '@/api/client'
import DocumentThumb from '@/components/DocumentThumb.vue'
import { useCommunityScope } from '@/composables/useCommunityScope'
import { useToastStore } from '@/stores/toast'

const router = useRouter()
const toast = useToastStore()
const { t, locale } = useI18n()

const { communities, orgId, context, canPick, init } = useCommunityScope()
const contents = ref({ items: [], total: 0, page: 1, size: 20 })
const loading = ref(true)

const creating = ref(false)

onMounted(async () => {
  try {
    await init()
  } catch (err) {
    toast.error(err.detail ?? t('community.loadFailed'))
  } finally {
    loading.value = false
  }
})

watch(orgId, async () => {
  if (context.value) await load()
})

async function load(page = 1) {
  contents.value = await api.get('/community/contents', { org_id: orgId.value, page, size: 20 })
}

/**
 * 빈 캔버스를 만들고 곧장 편집기로 간다 — CMS 콘텐츠와 같은 흐름이다.
 * 제목은 편집기 머리말에서 바꾼다.
 */
async function create() {
  if (creating.value) return
  creating.value = true
  try {
    const content = await api.post(
      '/community/contents',
      { title: t('community.untitled') },
      { org_id: orgId.value },
    )
    router.push(`/community/contents/${content.id}/editor`)
  } catch (err) {
    toast.error(err.detail ?? t('community.saveFailed'))
  } finally {
    creating.value = false
  }
}

async function remove(content) {
  if (!confirm(t('community.confirmRemoveContent'))) return
  try {
    await api.delete(`/community/contents/${content.id}`)
    await load()
  } catch (err) {
    toast.error(err.detail ?? t('community.removeFailed'))
  }
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString(locale.value) : '-'
}
</script>

<template>
  <div>
    <h1 class="page-title">{{ t('community.contentsTitle') }}</h1>
    <p v-if="context" class="page-desc">
      {{ t('community.scope', { org: context.org_name }) }} ·
      {{ t('community.contentsDesc') }}
    </p>

    <!-- 슈퍼관리자만 여러 개가 온다. 하나뿐이면 고를 것이 없다. -->
    <div v-if="canPick" class="field community-picker">
      <label>{{ t('community.pick') }}</label>
      <select v-model.number="orgId" class="select">
        <option v-for="c in communities" :key="c.org_id" :value="c.org_id">
          {{ c.org_name }}
        </option>
      </select>
    </div>

    <div v-if="loading" class="muted">{{ t('common.loading') }}</div>

    <section v-else-if="context" class="card">
      <div class="card-header">
        <h2>{{ t('community.contentCount', { count: contents.total }) }}</h2>
        <button
          v-if="context.can_share"
          class="btn btn-primary btn-sm"
          :disabled="creating"
          @click="create"
        >
          {{ t('community.newContent') }}
        </button>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th class="thumb-col" />
            <th>{{ t('community.contentTitle') }}</th>
            <th>{{ t('community.composition') }}</th>
            <th>{{ t('board.author') }}</th>
            <th>{{ t('board.date') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="content in contents.items" :key="content.id">
            <td class="thumb-col">
              <!-- 축소판을 누르면 편집기다 — 이름을 읽기 전에 눈이 먼저 닿는 곳이다. -->
              <RouterLink :to="`/community/contents/${content.id}/editor`">
                <DocumentThumb :document="content.document" :width="112" />
              </RouterLink>
            </td>
            <td>{{ content.title }}</td>
            <td class="muted">
              {{ t('community.elementCount', { count: content.element_count }) }} ·
              v{{ content.version }}
              <div class="sub">
                <span class="badge badge-muted">
                  {{ t(`community.audience_${content.audience ?? '전체'}`) }}
                </span>
                <span v-if="content.start_date || content.end_date">
                  {{ content.start_date ?? '' }} ~ {{ content.end_date ?? '' }}
                </span>
              </div>
            </td>
            <td class="muted">{{ content.author_name ?? '-' }}</td>
            <td class="muted">{{ formatDate(content.created_at) }}</td>
            <td class="actions">
              <template v-if="content.can_remove">
                <RouterLink class="btn btn-sm" :to="`/community/contents/${content.id}/editor`">
                  {{ t('common.edit') }}
                </RouterLink>
                <button class="btn btn-sm danger" @click="remove(content)">
                  {{ t('common.delete') }}
                </button>
              </template>
            </td>
          </tr>
          <tr v-if="contents.items.length === 0">
            <td colspan="6" class="table-empty">{{ t('community.contentsEmpty') }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <p v-else class="table-empty">{{ t('community.none') }}</p>

  </div>
</template>

<style scoped>
.thumb-col {
  width: 124px;
}

.thumb-col a {
  display: inline-block;
  line-height: 0;
}

.community-picker {
  max-width: 280px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.card-header h2 {
  font-size: 14px;
}

.sub {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  font-size: 11px;
}

.actions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}

.danger:hover {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
