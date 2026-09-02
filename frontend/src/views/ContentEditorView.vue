<script setup>
/**
 * 콘텐츠 편집기.
 *
 * 라이브러리의 콘텐츠 하나를 편집한다. 저장하면 이 콘텐츠를 사용하는 모든
 * 스케줄의 버전이 서버에서 함께 올라가, 장치가 다음 하트비트에 새 화면을 받아간다.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { api } from '@/api/client'
import ContentCanvas from '@/components/ContentCanvas.vue'
import ContentPreview from '@/components/ContentPreview.vue'
import { useAutoSave } from '@/composables/useAutoSave'
import { useSettingsStore } from '@/stores/settings'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const settings = useSettingsStore()
const { t } = useI18n()

const content = ref(null)
const widgets = ref([])
const loading = ref(true)
const saving = ref(false)
const dirty = ref(false)
const previewOpen = ref(false)

/**
 * 고칠 때마다 하나씩 오른다.
 *
 * 저장하는 동안에도 편집은 이어진다. 보낼 때의 번호와 응답이 온 뒤의 번호가
 * 다르면 그 사이에 뭔가 바뀐 것이므로 '저장됨' 으로 치지 않는다 — 그렇게
 * 치면 그 편집이 다음 저장에서 빠진다.
 */
const editSeq = ref(0)

function touch() {
  dirty.value = true
  editSeq.value += 1
}

/** 주간 편집기에서 넘어왔으면 그 화면으로 돌아간다. */
const backTo = computed(() => route.query.from ?? '/contents')

onMounted(async () => {
  try {
    const [detail, widgetList] = await Promise.all([
      api.get(`/contents/${route.params.id}`),
      api.get('/widgets').catch(() => []),
    ])
    content.value = normalize(detail)
    widgets.value = widgetList
  } catch (err) {
    toast.error(err.detail ?? t('content.editor.loadFailed'))
    router.push('/contents')
  } finally {
    loading.value = false
  }
})

/** 서버 문서가 비어 있거나 옛 형식일 수 있어 최소 형태를 보장한다. */
function normalize(detail) {
  const document = detail.document ?? {}
  detail.document = {
    version: document.version ?? 1,
    layout: {
      width: detail.width,
      height: detail.height,
      background: '#000000',
      ...(document.layout ?? {}),
    },
    elements: (document.elements ?? []).map((el) => ({
      opacity: 1,
      options: {},
      ...el,
      rect: { x: 0, y: 0, w: 400, h: 200, z: 1, rotation: 0, ...(el.rect ?? {}) },
    })),
  }
  return detail
}

/**
 * 서버에 보낸다. 알림은 부르는 쪽이 정한다 — 자동 저장은 조용해야 한다.
 *
 * 응답으로 문서를 통째로 갈아 끼우지 않는다. 저장하는 동안에도 편집은
 * 이어지므로, 응답이 늦게 오면 그 사이의 편집을 되돌려 버린다. 서버만 아는
 * 값(버전·사용처)만 받아 적는다.
 */
async function persist() {
  const seq = editSeq.value
  saving.value = true
  try {
    const updated = await api.put(`/contents/${content.value.id}`, {
      name: content.value.name,
      description: content.value.description,
      // 캔버스에서 방향을 바꿨을 수 있으므로 레이아웃 크기를 함께 반영한다.
      width: content.value.document.layout.width,
      height: content.value.document.layout.height,
      document: content.value.document,
    })
    content.value.version = updated.version
    content.value.usage_count = updated.usage_count
    if (editSeq.value === seq) dirty.value = false
    return updated
  } finally {
    saving.value = false
  }
}

/** 손으로 누른 저장. 결과를 알림으로 알린다. */
async function save() {
  try {
    const updated = await persist()
    autoSave.savedAt.value = new Date()
    autoSave.status.value = 'saved'
    const used = updated.usage_count
    toast.success(
      used
        ? t('content.editor.savedWithUsage', { count: used })
        : t('content.editor.saved'),
    )
  } catch (err) {
    toast.error(err.detail ?? t('content.editor.saveFailed'))
  }
}

/**
 * 자동 저장 한 번.
 *
 * 고친 것이 없으면 보내지 않는다 — 아무것도 안 바뀌었는데 30초마다 저장하면
 * 이 콘텐츠를 쓰는 스케줄의 버전이 계속 올라가 장치가 헛되이 다시 받아 간다.
 */
const autoSave = useAutoSave(async () => {
  if (!content.value || !dirty.value || saving.value) return false
  await persist()
  return true
})

/** 끄면 주기를 멈춘다. 켜면 그 자리에서 다시 센다. */
watch(
  () => settings.autoSave,
  (on) => {
    if (on) autoSave.start()
    else autoSave.stop()
  },
  { immediate: true },
)

/** '방금' / '3분 전'. 초 단위까지 적으면 눈만 바빠진다. */
const savedAgo = computed(() => {
  const at = autoSave.savedAt.value
  if (!at) return ''
  const minutes = Math.floor((now.value - at.getTime()) / 60000)
  return minutes < 1 ? t('content.editor.justNow') : t('content.editor.minutesAgo', { minutes })
})

/** '몇 분 전' 이 저절로 흐르게 하는 시계. */
const now = ref(Date.now())
let clock = null
onMounted(() => {
  clock = setInterval(() => {
    now.value = Date.now()
  }, 30_000)
})
onBeforeUnmount(() => clearInterval(clock))

async function goBack() {
  // 자동 저장을 켜 뒀으면 나가기 전에 한 번 더 보낸다 — 마지막 30초를
  // 잃지 않기 위해서다. 실패하면 예전처럼 물어본다.
  if (dirty.value && settings.autoSave) {
    await autoSave.flush()
  }
  if (dirty.value && !confirm(t('content.editor.confirmLeave'))) return
  router.push(backTo.value)
}

/** 캔버스가 알려 주는 안내(분할 변경, 영역 채우기 등)를 토스트로 띄운다. */
function onNotice({ type, text }) {
  if (type === 'success') toast.success(text)
  else if (type === 'warn') toast.error(text)
  else toast.push(text, 'info')
}
</script>

<template>
  <div v-if="loading" class="muted">{{ t('common.loading') }}</div>

  <div v-else-if="content" class="page">
    <header class="head card">
      <div>
        <input v-model="content.name" class="input title-input" @input="touch" />
        <div class="hint">
          {{ content.document.layout.width }}×{{ content.document.layout.height }} · v{{ content.version }}
          <span v-if="content.usage_count">
            · {{ t('content.editor.usedInBlocks', { count: content.usage_count }) }}
          </span>
          <span v-else> · {{ t('content.editor.notAssigned') }}</span>
          <span v-if="dirty" class="badge badge-warning">{{ t('common.unsaved') }}</span>

          <!-- 자동 저장 결과는 여기서만 알린다. 30초마다 알림을 띄우면
               편집을 방해한다. -->
          <span v-if="autoSave.status.value === 'saving'" class="auto-state">
            {{ t('content.editor.autoSaving') }}
          </span>
          <span v-else-if="autoSave.status.value === 'error'" class="auto-state bad">
            {{ t('content.editor.autoSaveFailed') }}
          </span>
          <span v-else-if="savedAgo" class="auto-state">
            {{ t('content.editor.autoSavedAt', { ago: savedAgo }) }}
          </span>
        </div>
      </div>
      <div class="spacer" />
      <!-- 저장이 곧 배포다. 다 만들기 전까지 내보내고 싶지 않을 때가 있다. -->
      <label class="check" :title="t('content.editor.autoSaveHint')">
        <input
          type="checkbox"
          :checked="settings.autoSave"
          @change="settings.setAutoSave($event.target.checked)"
        />
        {{ t('content.editor.autoSave') }}
      </label>
      <!-- 저장 전 문서 그대로 그린다. 저장해야만 볼 수 있으면 확인이
           저장-확인-수정의 반복이 된다. -->
      <button class="btn" @click="previewOpen = true">{{ t('preview.open') }}</button>
      <button class="btn" @click="goBack">{{ t('common.back') }}</button>
      <button class="btn btn-primary" :disabled="saving" @click="save">
        {{ saving ? t('common.saving') : t('common.save') }}
      </button>
    </header>

    <div v-if="content.usage_count" class="notice">
      {{ t('content.editor.notice', { count: content.usage_count }) }}
    </div>

    <ContentCanvas
      :document="content.document"
      :widgets="widgets"
      :org-id="content.org_id"
      class="canvas-fill"
      @change="touch"
      @notice="onNotice"
    />

    <ContentPreview
      v-if="previewOpen"
      :document="content.document"
      :widgets="widgets"
      @close="previewOpen = false"
    />
  </div>
</template>

<style scoped>
.check {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}

.auto-state {
  margin-left: 6px;
}

.auto-state.bad {
  color: var(--danger);
}

/* 편집기는 스크롤 없이 화면을 가득 채운다. 상단 바와 본문 여백을 뺀 만큼이
   실제로 쓸 수 있는 높이다(main.css 의 --topbar-height / --content-pad). */
.page {
  display: flex;
  flex-direction: column;
  gap: 13px;
  height: calc(100vh - var(--topbar-height) - var(--content-pad) * 2);
  min-height: 480px;
}

.canvas-fill {
  flex: 1;
  min-height: 0;
}

.head,
.notice {
  flex-shrink: 0;
}

.head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}

.title-input {
  width: 320px;
  font-size: 16px;
  font-weight: 600;
}

.notice {
  padding: 10px 14px;
  border-radius: var(--radius);
  background: var(--primary-soft);
  border: 1px solid var(--primary-border);
  color: var(--primary);
  font-size: 12px;
}
</style>
