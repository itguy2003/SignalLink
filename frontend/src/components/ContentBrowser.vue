<script setup>
/**
 * 콘텐츠 브라우저.
 *
 * 주간 스케줄 편집기에서 시간 블록에 넣을 콘텐츠를 고르는 모달이다.
 * 라이브러리를 검색·필터해서 고르거나, 여기서 바로 새 콘텐츠를 만들 수 있다.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import ModalDialog from '@/components/ModalDialog.vue'
import { useToastStore } from '@/stores/toast'
import { shareLabelKey } from '@/utils/contentShare'
import { defaultSize, labelKey, toQuery } from '@/utils/orientation'

const props = defineProps({
  /** 현재 선택된 콘텐츠 id (있으면 표시) */
  selectedId: { type: Number, default: null },
  /**
   * 스케줄의 화면 방향('LANDSCAPE' | 'PORTRAIT').
   *
   * 주면 그 방향만 보여 주고 **필터를 잠근다**. 다른 방향을 고를 수 있게 두면
   * 고른 뒤 저장에서 서버가 거부한다.
   */
  orientation: { type: String, default: null },
  orgId: { type: Number, default: null },
})

const locked = computed(() => Boolean(props.orientation))

const emit = defineEmits(['close', 'select', 'create', 'edit'])

const toast = useToastStore()
const { t } = useI18n()

const page = ref({ items: [], total: 0, page: 1, size: 24 })
const loading = ref(false)
const query = ref('')
const orientationFilter = ref(toQuery(props.orientation))
/** 공유 필터: '' = 전체(공유 포함) | 'mine' = 내 것만 | 'shared' = 공유받은 것만. */
const shareFilter = ref('')
const creating = ref(false)
const newName = ref('')

const isEmpty = computed(() => !loading.value && page.value.items.length === 0)

async function load(pageNumber = 1) {
  loading.value = true
  try {
    page.value = await api.get('/contents', {
      q: query.value || undefined,
      orientation: orientationFilter.value || undefined,
      // 공유 판정의 기준은 스케줄의 기관(org_id) — 서버가 공유 구분에 따라
      // 관리 범위 밖의 콘텐츠도 함께 내려준다(shared 표식 포함).
      share: shareFilter.value || undefined,
      org_id: props.orgId ?? undefined,
      page: pageNumber,
      size: page.value.size,
    })
  } catch (err) {
    toast.error(err.detail ?? t('content.loadFailed'))
  } finally {
    loading.value = false
  }
}

onMounted(() => load(1))
watch(orientationFilter, () => load(1))
watch(shareFilter, () => load(1))

async function createContent() {
  const name = newName.value.trim()
  if (!name) {
    toast.error(t('content.browser.nameRequired'))
    return
  }
  creating.value = true
  try {
    // 스케줄이 방향을 정해 줬으면 그 크기로 만든다. 필터만 보고 만들면
    // 세로 스케줄에서 만든 콘텐츠가 가로가 되어 곧바로 붙지 않는다.
    const size = defaultSize(
      props.orientation ?? (orientationFilter.value === 'portrait' ? 'PORTRAIT' : 'LANDSCAPE'),
    )
    const created = await api.post('/contents', {
      name,
      org_id: props.orgId ?? undefined,
      ...size,
    })
    toast.success(t('content.created'))
    emit('create', created)
  } catch (err) {
    toast.error(err.detail ?? t('content.createFailed'))
  } finally {
    creating.value = false
  }
}

function formatSize(content) {
  return `${content.width}×${content.height}`
}
</script>

<template>
  <ModalDialog
    :title="t('content.browser.title')"
    width="820px"
    hide-footer
    @close="emit('close')"
  >
    <div class="toolbar">
      <input
        v-model="query"
        class="input search"
        :placeholder="t('content.browser.searchPlaceholder')"
        @keyup.enter="load(1)"
      />
      <span v-if="locked" class="badge badge-primary">
        {{ t(labelKey(props.orientation)) }}
      </span>
      <select v-else v-model="orientationFilter" class="select narrow">
        <option value="">{{ t('content.allOrientations') }}</option>
        <option value="landscape">{{ t('content.landscape') }}</option>
        <option value="portrait">{{ t('content.portrait') }}</option>
      </select>
      <!-- 공유 필터 — 공유 구분에 따라 관리 범위 밖의 콘텐츠도 보인다. -->
      <select v-model="shareFilter" class="select narrow" data-test="share-filter">
        <option value="">{{ t('content.shareFilterAll') }}</option>
        <option value="mine">{{ t('content.shareFilterMine') }}</option>
        <option value="shared">{{ t('content.shareFilterShared') }}</option>
      </select>
      <button class="btn" @click="load(1)">{{ t('common.search') }}</button>
      <div class="spacer" />
      <div class="row">
        <input
          v-model="newName"
          class="input narrow"
          :placeholder="t('content.browser.newName')"
        />
        <button class="btn btn-primary" :disabled="creating" @click="createContent">
          {{ creating ? t('content.browser.creating') : t('content.browser.create') }}
        </button>
      </div>
    </div>

    <p v-if="loading" class="muted pad">{{ t('common.loading') }}</p>

    <p v-else-if="isEmpty" class="muted pad">{{ t('content.browser.empty') }}</p>

    <div v-else class="grid">
      <button
        v-for="content in page.items"
        :key="content.id"
        class="card-item"
        :class="{ selected: content.id === selectedId }"
        @click="emit('select', content)"
      >
        <div
          class="thumb"
          :class="{ portrait: content.height > content.width }"
          :style="{ background: content.background }"
        >
          <span class="thumb-count">
            {{ t('content.elementCount', { count: content.element_count }) }}
          </span>
        </div>
        <div class="meta">
          <div class="name">{{ content.name }}</div>
          <div class="sub muted">
            {{ formatSize(content) }} · v{{ content.version }}
            <span v-if="content.usage_count">
              · {{ t('content.usedIn', { count: content.usage_count }) }}
            </span>
          </div>
          <!-- 공유받은 콘텐츠 — 어느 기관이 어떤 구분으로 열었는지 보여 준다. -->
          <div v-if="content.shared" class="sub">
            <span class="badge badge-primary" data-test="shared-badge">
              {{ t('content.sharedFrom', { org: content.org_name ?? '?' }) }}
              · {{ t(shareLabelKey(content.share_scope)) }}
            </span>
          </div>
        </div>
        <!-- 공유받은 콘텐츠는 남의 것 — 여기서 수정으로 들어가지 않는다. -->
        <span
          v-if="!content.shared"
          class="edit-link"
          role="button"
          @click.stop="emit('edit', content)"
        >
          {{ t('common.edit') }}
        </span>
      </button>
    </div>

    <div v-if="page.total > page.size" class="pager">
      <button class="btn btn-sm" :disabled="page.page <= 1" @click="load(page.page - 1)">
        {{ t('common.prev') }}
      </button>
      <span class="muted">{{ page.page }} / {{ Math.ceil(page.total / page.size) }}</span>
      <button
        class="btn btn-sm"
        :disabled="page.page * page.size >= page.total"
        @click="load(page.page + 1)"
      >
        {{ t('common.next') }}
      </button>
    </div>
  </ModalDialog>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.search {
  width: 200px;
}

.narrow {
  width: 140px;
}

.pad {
  padding: 26px 0;
  text-align: center;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.card-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.card-item:hover {
  border-color: var(--primary);
}

.card-item.selected {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.thumb {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 4px;
  overflow: hidden;
}

.thumb.portrait {
  aspect-ratio: 9 / 16;
  max-height: 150px;
  margin: 0 auto;
}

.thumb-count {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgb(15 23 42 / 60%);
  color: #e2e8f0;
  font-size: 11px;
}

.name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub {
  font-size: 11px;
}

.edit-link {
  position: absolute;
  top: 13px;
  right: 13px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgb(15 23 42 / 75%);
  color: #fff;
  font-size: 11px;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 14px;
  font-size: 12px;
}
</style>
