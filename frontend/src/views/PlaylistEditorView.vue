<script setup>
/**
 * 위젯 재생목록 편집기.
 *
 * 스케줄 관리의 목록형 편집기(ScheduleGridView 의 목록반복 화면)와 같은
 * 짜임이다 — 위쪽에 제목·메타·저장, 왼쪽에 끌어다 쓸 목록, 오른쪽에 순서.
 * 좁은 모달에서는 위젯을 고르고 순서를 바꾸는 일을 한 화면에서 할 수 없었다.
 *
 * 만들기와 수정이 같은 화면을 쓴다. 채워야 할 것이 완전히 같고, '먼저 만들고
 * 나중에 담는' 흐름을 따로 만들 이유가 없다.
 */
import { computed, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import PlaylistItems from '@/components/PlaylistItems.vue'
import PlaylistPreview from '@/components/PlaylistPreview.vue'
import WidgetLibraryPanel from '@/components/WidgetLibraryPanel.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import {
  DEFAULT_TRANSITION,
  DEFAULT_TRANSITION_MS,
  normalize,
  normalizeMs,
} from '@/utils/transitions'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const toast = useToastStore()
const { t } = useI18n()

/** 새로 만드는 중인가. `/playlists/new` 로 들어오면 id 가 없다. */
const creating = computed(() => !route.params.id)

const loading = ref(true)
const saving = ref(false)
const dirty = ref(false)
const missing = ref(false)
const previewOpen = ref(false)

/** 서버가 준 원본(버전·사용 건수 표시용). 새로 만드는 중이면 null. */
const source = ref(null)

const name = ref('')
const description = ref('')
const items = ref([])
const widgets = ref([])

const widgetName = computed(() => new Map(widgets.value.map((w) => [w.key, w.name])))

function markDirty() {
  dirty.value = true
}

onMounted(async () => {
  widgets.value = await api.get('/widgets').catch(() => [])

  if (creating.value) {
    loading.value = false
    return
  }
  try {
    const playlist = await api.get(`/playlists/${route.params.id}`)
    source.value = playlist
    name.value = playlist.name
    description.value = playlist.description ?? ''
    items.value = playlist.items.map((item) => ({
      widget_key: item.widget_key,
      duration_sec: item.duration_sec,
      options: item.options ?? {},
      // 사라진 효과가 저장돼 있어도 선택 상자가 빈 채로 열리면 안 된다.
      transition: normalize(item.transition),
      transition_ms: normalizeMs(item.transition_ms),
    }))
  } catch (err) {
    missing.value = true
    toast.error(err.detail ?? t('widgetPlaylist.notFound'))
  } finally {
    loading.value = false
  }
})

/** 왼쪽에서 끌어다 놓거나 `+` 를 눌렀을 때. `index` 는 끼워 넣을 자리. */
function addWidget(widgetKey, index = items.value.length) {
  if (!widgetKey) return
  // 기본 표출 시간을 채워 준다. 매번 손으로 적게 하면 0 인 칸이 생긴다.
  // 전환은 '없음'으로 시작한다. 효과가 기본이면 원치 않는 사람이 매번 꺼야 한다.
  items.value.splice(index, 0, {
    widget_key: widgetKey,
    duration_sec: 10,
    options: {},
    transition: DEFAULT_TRANSITION,
    transition_ms: DEFAULT_TRANSITION_MS,
  })
  markDirty()
}

async function save() {
  const trimmed = name.value.trim()
  if (!trimmed) {
    toast.error(t('widgetPlaylist.nameRequired'))
    return
  }

  saving.value = true
  try {
    const body = {
      name: trimmed,
      description: description.value.trim() || null,
      items: items.value.map((item) => ({
        widget_key: item.widget_key,
        duration_sec: Number(item.duration_sec) || 10,
        options: item.options ?? {},
        transition: normalize(item.transition),
        transition_ms: normalizeMs(item.transition_ms),
      })),
    }
    if (creating.value) {
      const created = await api.post('/playlists', { ...body, org_id: auth.user?.org_id })
      toast.success(t('widgetPlaylist.created', { name: trimmed }))
      dirty.value = false
      // 만든 뒤에는 수정 화면으로 갈아탄다. 다시 저장하면 새로 만들어지면 안 된다.
      await router.replace(`/playlists/${created.id}/edit`)
      source.value = created
      return
    }
    source.value = await api.put(`/playlists/${route.params.id}`, body)
    dirty.value = false
    toast.success(t('widgetPlaylist.updated'))
  } catch (err) {
    toast.error(err.detail ?? t('org.saveFailed'))
  } finally {
    saving.value = false
  }
}

// 순서를 다 짜 놓고 저장 없이 나가면 통째로 날아간다.
onBeforeRouteLeave(() => dirty.value === false || confirm(t('widgetPlaylist.confirmLeave')))
</script>

<template>
  <p v-if="loading" class="muted pad">{{ t('common.loading') }}</p>
  <p v-else-if="missing" class="table-empty">{{ t('widgetPlaylist.notFound') }}</p>

  <div v-else class="page">
    <header class="head card">
      <div>
        <input
          v-model="name"
          class="input title-input"
          :placeholder="t('widgetPlaylist.name')"
          @input="markDirty"
        />
        <div class="hint">
          <template v-if="source">
            {{
              t('widgetPlaylist.meta', {
                count: items.length,
                version: source.version,
                usage: source.usage_count ?? 0,
              })
            }}
          </template>
          <template v-else>{{ t('widgetPlaylist.newMeta') }}</template>
          <span v-if="dirty" class="badge badge-warning">{{ t('common.unsaved') }}</span>
        </div>
      </div>

      <div class="spacer" />

      <input
        v-model="description"
        class="input desc-input"
        :placeholder="t('widgetPlaylist.description')"
        @input="markDirty"
      />
      <!-- 저장 전 순서 그대로 재생한다. 저장해야만 볼 수 있으면
           시간을 맞추는 일이 저장-확인-수정의 반복이 된다. -->
      <button class="btn" :disabled="items.length === 0" @click="previewOpen = true">
        {{ t('preview.open') }}
      </button>
      <RouterLink to="/playlists" class="btn">{{ t('common.list') }}</RouterLink>
      <button class="btn btn-primary" :disabled="saving" @click="save">
        {{ saving ? t('common.saving') : t('common.save') }}
      </button>
    </header>

    <p class="page-desc">{{ t('widgetPlaylist.editorDesc') }}</p>

    <div class="with-library">
      <!-- 왼쪽 위젯 목록: 여기서 끌어다 재생 목록에 놓는다. -->
      <WidgetLibraryPanel class="library-panel" @add="addWidget($event.key)" />

      <PlaylistItems
        :items="items"
        :names="widgetName"
        @change="markDirty"
        @add-widget="addWidget($event.key, $event.index)"
      />
    </div>

    <PlaylistPreview
      v-if="previewOpen"
      :items="items"
      :widgets="widgets"
      @close="previewOpen = false"
    />
  </div>
</template>

<style scoped>
.pad {
  padding: 16px;
}

.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  flex-wrap: wrap;
}

.title-input {
  width: 280px;
  font-size: 16px;
  font-weight: 600;
}

.desc-input {
  width: 240px;
}

.spacer {
  flex: 1;
}

.with-library {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.library-panel {
  max-height: 72vh;
}
</style>
