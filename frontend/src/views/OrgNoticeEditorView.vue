<script setup>
/**
 * 소속기관 공지 편집기 — 화면을 둘로 나눈다.
 *
 *   왼쪽   콘텐츠 편집기(ContentCanvas). 오른쪽에서 고른 슬라이드의 문서를
 *          그 자리에서 편집한다.
 *   오른쪽 재생목록. 슬라이드를 추가하고, 순서를 바꾸고, 유지 시간을 정한다.
 *
 * 슬라이드는 문서를 인라인으로 갖는다(콘텐츠 라이브러리와 무관) — 공지를
 * 지우면 슬라이드도 함께 사라지고, 라이브러리에 부산물이 남지 않는다.
 * 저장은 아이템 전체 교체다.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { api } from '@/api/client'
import ContentCanvas from '@/components/ContentCanvas.vue'
import ContentPreview from '@/components/ContentPreview.vue'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const { t } = useI18n()

const notice = ref(null)
const widgets = ref([])
const loading = ref(true)
const saving = ref(false)
const dirty = ref(false)
const previewOpen = ref(false)
const selectedIndex = ref(0)

/** 고칠 때마다 오른다. 저장하는 사이에 든 편집을 삼키지 않기 위한 번호다. */
const editSeq = ref(0)

function touch() {
  dirty.value = true
  editSeq.value += 1
}

/** 캔버스를 슬라이드 전환 시 다시 세우기 위한 지역 열쇠. */
let keySeq = 0

/** 사용기간 값 정리 — 날짜만 저장된 옛 값은 시작 00:00 / 종료 23:59 로 넓힌다. */
function expandPeriod(value, isEnd) {
  if (!value) return ''
  return value.length === 10 ? `${value}T${isEnd ? '23:59' : '00:00'}` : value
}

function emptyDocument() {
  return {
    version: 1,
    layout: { width: 1920, height: 1080, background: '#000000' },
    elements: [],
  }
}

/** 서버 문서가 비어 있거나 옛 형식일 수 있어 최소 형태를 보장한다. */
function normalizeDocument(document) {
  const base = document ?? {}
  return {
    version: 1,
    ...base,
    layout: { width: 1920, height: 1080, background: '#000000', ...(base.layout ?? {}) },
    elements: (base.elements ?? []).map((el) => ({
      opacity: 1,
      options: {},
      ...el,
      rect: { x: 0, y: 0, w: 400, h: 200, z: 1, rotation: 0, ...(el.rect ?? {}) },
    })),
  }
}

onMounted(async () => {
  try {
    const [detail, specs] = await Promise.all([
      api.get(`/org-notices/${route.params.id}`),
      api.get('/widgets').catch(() => []),
    ])
    widgets.value = specs
    detail.items = (detail.items ?? []).map((item) => ({
      _key: ++keySeq,
      duration_sec: item.duration_sec,
      document: normalizeDocument(item.document),
    }))
    // 날짜만 저장된 옛 값은 datetime-local 입력이 못 읽는다 — 넓혀서 싣는다.
    detail.start_date = expandPeriod(detail.start_date, false)
    detail.end_date = expandPeriod(detail.end_date, true)
    notice.value = detail
    selectedIndex.value = 0
  } catch (err) {
    toast.error(err.detail ?? t('orgNotice.loadFailed'))
    router.push('/org-notices')
  } finally {
    loading.value = false
  }
})

const items = computed(() => notice.value?.items ?? [])
const selected = computed(() => items.value[selectedIndex.value] ?? null)

// ------------------------------------------------------------ 오른쪽 목록
function addSlide() {
  items.value.push({ _key: ++keySeq, duration_sec: 10, document: emptyDocument() })
  selectedIndex.value = items.value.length - 1
  touch()
}

function removeSlide(index) {
  if (!confirm(t('orgNotice.confirmRemoveSlide', { n: index + 1 }))) return
  items.value.splice(index, 1)
  if (selectedIndex.value >= items.value.length) {
    selectedIndex.value = Math.max(0, items.value.length - 1)
  }
  touch()
}

/** 위/아래 이동. 고른 슬라이드가 움직이면 선택도 따라간다. */
function move(index, delta) {
  const target = index + delta
  if (target < 0 || target >= items.value.length) return
  const [row] = items.value.splice(index, 1)
  items.value.splice(target, 0, row)
  if (selectedIndex.value === index) selectedIndex.value = target
  else if (selectedIndex.value === target) selectedIndex.value = index
  touch()
}

function clampDuration(item, raw) {
  const number = Number(raw)
  item.duration_sec = Number.isFinite(number) ? Math.max(1, Math.min(86400, number)) : 10
  touch()
}

// ------------------------------------------------------------ 저장
async function save() {
  const seq = editSeq.value
  saving.value = true
  try {
    const updated = await api.put(`/org-notices/${notice.value.id}`, {
      name: notice.value.name,
      start_date: notice.value.start_date ?? '',
      end_date: notice.value.end_date ?? '',
      items: items.value.map((item) => ({
        duration_sec: item.duration_sec,
        document: item.document,
      })),
    })
    notice.value.version = updated.version
    if (editSeq.value === seq) dirty.value = false
    toast.success(t('orgNotice.saved'))
    // 저장했으면 목록으로 돌아간다(요청 사항) — 이어서 고칠 사람은 다시 연다.
    router.push('/org-notices')
  } catch (err) {
    toast.error(err.detail ?? t('orgNotice.saveFailed'))
  } finally {
    saving.value = false
  }
}

function goBack() {
  if (dirty.value && !confirm(t('content.editor.confirmLeave'))) return
  router.push('/org-notices')
}

function onNotice({ type, text }) {
  if (type === 'success') toast.success(text)
  else if (type === 'warn') toast.error(text)
  else toast.push(text, 'info')
}
</script>

<template>
  <div v-if="loading" class="muted">{{ t('common.loading') }}</div>

  <div v-else-if="notice" class="page">
    <header class="head card">
      <div>
        <input v-model="notice.name" class="input title-input" @input="touch" />
        <div class="hint">
          v{{ notice.version }} · {{ t('orgNotice.itemCount', { count: items.length }) }}
          <span v-if="dirty" class="badge badge-warning">{{ t('common.unsaved') }}</span>
        </div>
      </div>
      <div class="spacer" />

      <label class="meta-field" :title="t('orgNotice.periodHint')">
        <span class="muted">{{ t('orgNotice.period') }}</span>
        <input v-model="notice.start_date" class="input date" type="datetime-local" @change="touch" />
        ~
        <input v-model="notice.end_date" class="input date" type="datetime-local" @change="touch" />
      </label>

      <button class="btn" :disabled="!selected" @click="previewOpen = true">
        {{ t('preview.open') }}
      </button>
      <button class="btn" @click="goBack">{{ t('common.back') }}</button>
      <button class="btn btn-primary" :disabled="saving" data-test="save" @click="save">
        {{ saving ? t('common.saving') : t('common.save') }}
      </button>
    </header>

    <div class="split">
      <!-- 왼쪽: 고른 슬라이드의 콘텐츠 편집기 -->
      <div class="editor-side">
        <ContentCanvas
          v-if="selected"
          :key="selected._key"
          :document="selected.document"
          :widgets="widgets"
          :org-id="notice.org_id"
          class="canvas-fill"
          @change="touch"
          @notice="onNotice"
        />
        <div v-else class="card empty-editor">
          <p class="muted">{{ t('orgNotice.emptySlides') }}</p>
        </div>
      </div>

      <!-- 오른쪽: 재생목록 — 추가·순서 변경·유지 시간 -->
      <aside class="card playlist">
        <div class="playlist-head">
          <h3>{{ t('orgNotice.playlist') }}</h3>
          <button class="btn btn-sm btn-primary" data-test="add-slide" @click="addSlide">
            {{ t('orgNotice.addSlide') }}
          </button>
        </div>

        <p v-if="items.length === 0" class="muted pad">{{ t('orgNotice.emptySlides') }}</p>
        <ol v-else class="slides">
          <li
            v-for="(item, index) in items"
            :key="item._key"
            class="slide"
            :class="{ selected: index === selectedIndex }"
            data-test="slide-row"
            @click="selectedIndex = index"
          >
            <div class="slide-main">
              <div class="slide-title">
                {{ index + 1 }}. {{ t('orgNotice.slide') }}
                <span class="muted small">
                  {{ t('content.elementCount', { count: item.document.elements.length }) }}
                </span>
              </div>
              <label class="duration" @click.stop>
                <span class="muted small">{{ t('orgNotice.duration') }}</span>
                <input
                  class="input duration-input"
                  type="number"
                  min="1"
                  max="86400"
                  :value="item.duration_sec"
                  data-test="duration-input"
                  @change="clampDuration(item, $event.target.value)"
                />
              </label>
            </div>
            <div class="slide-actions" @click.stop>
              <button
                class="btn btn-sm"
                :disabled="index === 0"
                data-test="move-up"
                :title="t('common.moveUp')"
                @click="move(index, -1)"
              >
                ▲
              </button>
              <button
                class="btn btn-sm"
                :disabled="index === items.length - 1"
                data-test="move-down"
                :title="t('common.moveDown')"
                @click="move(index, 1)"
              >
                ▼
              </button>
              <button
                class="btn btn-sm btn-danger"
                data-test="remove-slide"
                @click="removeSlide(index)"
              >
                ✕
              </button>
            </div>
          </li>
        </ol>
      </aside>
    </div>

    <ContentPreview
      v-if="previewOpen && selected"
      :document="selected.document"
      :widgets="widgets"
      @close="previewOpen = false"
    />
  </div>
</template>

<style scoped>
/* CMS 콘텐츠 편집기와 같은 골격(main.css 의 --topbar-height / --content-pad). */
.page {
  display: flex;
  flex-direction: column;
  gap: 13px;
  height: calc(100vh - var(--topbar-height) - var(--content-pad) * 2);
  min-height: 480px;
}

.head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  flex-shrink: 0;
}

.title-input {
  width: 320px;
  font-size: 16px;
  font-weight: 600;
}

.spacer {
  flex: 1;
}

.meta-field {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  white-space: nowrap;
}

.meta-field .date {
  width: 132px;
}

/* ---------------------------------------------- 좌(편집기) / 우(재생목록) */
.split {
  display: flex;
  gap: 13px;
  flex: 1;
  min-height: 0;
}

.editor-side {
  flex: 1;
  min-width: 0;
  display: flex;
}

.canvas-fill {
  flex: 1;
  min-height: 0;
}

.empty-editor {
  flex: 1;
  display: grid;
  place-items: center;
}

.playlist {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.playlist-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 13px;
  border-bottom: 1px solid var(--border);
}

.playlist-head h3 {
  margin: 0;
  font-size: 13px;
}

.slides {
  list-style: none;
  margin: 0;
  padding: 8px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slide {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}

.slide:hover {
  background: var(--surface-2);
}

.slide.selected {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.slide-main {
  flex: 1;
  min-width: 0;
}

.slide-title {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.small {
  font-size: 11px;
  font-weight: 400;
}

.duration {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
}

.duration-input {
  width: 74px;
  padding: 3px 7px;
  font-size: 12px;
}

.slide-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.pad {
  padding: 12px;
}
</style>
