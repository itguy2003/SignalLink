<script setup>
/**
 * 위젯 재생목록 관리.
 *
 * 위젯 여러 개를 순서와 표출 시간만 정해 묶어 둔다. 콘텐츠 편집기에서 한
 * 요소로 놓으면 그 자리에서 위젯들이 차례로 바뀐다 — 공지·급식·시간표를
 * 한 자리에서 돌려 보여 주는 배치를 매번 손으로 만들지 않아도 된다.
 *
 * 이 화면은 목록만 맡는다. 만들기·수정은 스케줄 관리와 같은 짜임의 편집기
 * 화면(PlaylistEditorView)에서 한다 — 위젯을 고르는 일과 순서를 바꾸는 일을
 * 좁은 모달에서 함께 하기는 어렵다.
 *
 * 고치면 이 재생목록을 쓰는 콘텐츠와 스케줄의 버전이 서버에서 함께 올라가
 * 장치가 변경을 받아 간다. 그래서 저장만 하면 표출까지 반영된다.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()
const { t } = useI18n()

const page = ref({ items: [], total: 0, page: 1, size: 24 })
const widgets = ref([])
const loading = ref(false)
const query = ref('')

const widgetName = computed(() => new Map(widgets.value.map((w) => [w.key, w.name])))

async function load(pageNumber = page.value.page) {
  loading.value = true
  try {
    page.value = await api.get('/playlists', {
      q: query.value || undefined,
      page: pageNumber,
      size: page.value.size,
    })
  } catch (err) {
    toast.error(err.detail ?? t('widgetPlaylist.loadFailed'))
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  widgets.value = await api.get('/widgets').catch(() => [])
  await load(1)
})

async function duplicate(playlist) {
  try {
    await api.post(`/playlists/${playlist.id}/duplicate`)
    toast.success(t('widgetPlaylist.duplicated'))
    await load()
  } catch (err) {
    toast.error(err.detail ?? t('schedule.duplicateFailed'))
  }
}

async function remove(playlist) {
  if (!confirm(t('widgetPlaylist.confirmDelete', { name: playlist.name }))) return
  try {
    await api.delete(`/playlists/${playlist.id}`)
    toast.success(t('widgetPlaylist.deleted'))
    await load()
  } catch (err) {
    // 쓰는 콘텐츠가 있으면 서버가 막는다. 몇 건인지까지 알려 준다.
    toast.error(err.detail ?? t('org.deleteFailed'))
  }
}
</script>

<template>
  <div>
    <h1 class="page-title">{{ t('widgetPlaylist.title') }}</h1>
    <p class="page-desc">{{ t('widgetPlaylist.desc') }}</p>

    <section class="card">
      <div class="card-header">
        <div class="row">
          <input
            v-model="query"
            class="input filter-input"
            :placeholder="t('widgetPlaylist.searchPlaceholder')"
            @keyup.enter="load(1)"
          />
          <button class="btn" @click="load(1)">{{ t('common.search') }}</button>
        </div>
        <RouterLink to="/playlists/new" class="btn btn-primary">
          {{ t('widgetPlaylist.createButton') }}
        </RouterLink>
      </div>

      <p v-if="loading" class="muted pad">{{ t('common.loading') }}</p>
      <p v-else-if="page.items.length === 0" class="table-empty">{{ t('widgetPlaylist.empty') }}</p>

      <ul v-else class="playlists">
        <li v-for="playlist in page.items" :key="playlist.id" class="playlist">
          <div class="head">
            <RouterLink class="name" :to="`/playlists/${playlist.id}/edit`">
              {{ playlist.name }}
            </RouterLink>
            <span class="badge badge-muted">
              {{ t('widgetPlaylist.itemCount', { count: playlist.items.length }) }}
            </span>
            <span class="badge">{{ t('widgetPlaylist.duration', { sec: playlist.total_duration_sec }) }}</span>
            <!-- 어디서 쓰는지 알아야 지워도 되는지 판단할 수 있다. -->
            <span v-if="playlist.usage_count" class="badge badge-primary">
              {{ t('widgetPlaylist.usedBy', { count: playlist.usage_count }) }}
            </span>
            <div class="spacer" />
            <RouterLink class="btn btn-sm" :to="`/playlists/${playlist.id}/edit`">
              {{ t('common.edit') }}
            </RouterLink>
            <button class="btn btn-sm" @click="duplicate(playlist)">
              {{ t('common.duplicate') }}
            </button>
            <button class="btn btn-sm btn-danger" @click="remove(playlist)">
              {{ t('common.delete') }}
            </button>
          </div>

          <p v-if="playlist.description" class="muted small">{{ playlist.description }}</p>

          <div v-if="playlist.items.length" class="chain">
            <span v-for="item in playlist.items" :key="item.id" class="chip">
              {{ widgetName.get(item.widget_key) ?? item.widget_key }}
              <span class="muted">{{ item.duration_sec }}s</span>
            </span>
          </div>
          <p v-else class="muted small">{{ t('widgetPlaylist.noItems') }}</p>
        </li>
      </ul>

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
        <span class="muted">{{ t('common.totalCount', { count: page.total }) }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.filter-input {
  width: 220px;
}

.pad {
  padding: 16px;
}

.playlists {
  list-style: none;
  margin: 0;
  padding: 0 16px 16px;
  display: grid;
  gap: 10px;
}

.playlist {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 11px 13px;
}

.head {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}

.name {
  font-size: 14px;
  font-weight: 600;
}

.small {
  margin: 6px 0 0;
  font-size: 11px;
}

/* 재생 순서를 그대로 늘어놓는다. 순서가 곧 규칙이라 눈으로 보여야 한다. */
.chain {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 9px;
}

.chip {
  display: inline-flex;
  gap: 5px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--surface-2);
  font-size: 11px;
}

.pager {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}
</style>
