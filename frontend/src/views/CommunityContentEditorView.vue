<script setup>
/**
 * 커뮤니티 콘텐츠 편집기.
 *
 * CMS 콘텐츠 편집기와 **같은 캔버스**를 쓴다(`ContentCanvas`). 다른 점은
 * 재료뿐이다 — 레일에는 기본 요소만 서고, 이미지·동영상은 공유물 /
 * 라이브러리 / 외부 링크에서 고른다(`communityMode`). 위젯·재생목록은
 * 서버가 저장에서 막는다.
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

const content = ref(null)
const loading = ref(true)
const saving = ref(false)
const dirty = ref(false)
const previewOpen = ref(false)

/** 고칠 때마다 오른다. 저장하는 사이에 든 편집을 삼키지 않기 위한 번호다. */
const editSeq = ref(0)

function touch() {
  dirty.value = true
  editSeq.value += 1
}

onMounted(async () => {
  try {
    const detail = await api.get(`/community/contents/${route.params.id}`)
    content.value = normalize(detail)
  } catch (err) {
    toast.error(err.detail ?? t('community.loadFailed'))
    router.push('/community/contents')
  } finally {
    loading.value = false
  }
})

/** 서버 문서가 비어 있거나 옛 형식일 수 있어 최소 형태를 보장한다. */
function normalize(detail) {
  detail.audience = detail.audience ?? '전체'
  const document = detail.document ?? {}
  detail.document = {
    version: 1,
    ...document,
    layout: { width: 1920, height: 1080, background: '#000000', ...(document.layout ?? {}) },
    elements: (document.elements ?? []).map((el) => ({
      opacity: 1,
      options: {},
      ...el,
      rect: { x: 0, y: 0, w: 400, h: 200, z: 1, rotation: 0, ...(el.rect ?? {}) },
    })),
  }
  return detail
}

async function save() {
  const seq = editSeq.value
  saving.value = true
  try {
    const updated = await api.put(`/community/contents/${content.value.id}`, {
      title: content.value.title,
      document: content.value.document,
      // 빈 문자열은 '기간 지움'이다. 서버가 그렇게 읽는다.
      start_date: content.value.start_date ?? '',
      end_date: content.value.end_date ?? '',
      audience: content.value.audience ?? '전체',
    })
    content.value.version = updated.version
    if (editSeq.value === seq) dirty.value = false
    toast.success(t('community.contentSaved'))
  } catch (err) {
    toast.error(err.detail ?? t('community.saveFailed'))
  } finally {
    saving.value = false
  }
}

function goBack() {
  if (dirty.value && !confirm(t('content.editor.confirmLeave'))) return
  router.push('/community/contents')
}

function onNotice({ type, text }) {
  if (type === 'success') toast.success(text)
  else if (type === 'warn') toast.error(text)
  else toast.push(text, 'info')
}

const subtitle = computed(() =>
  content.value
    ? `${content.value.document.layout.width}×${content.value.document.layout.height} · v${content.value.version}`
    : '',
)
</script>

<template>
  <div v-if="loading" class="muted">{{ t('common.loading') }}</div>

  <div v-else-if="content" class="page">
    <header class="head card">
      <div>
        <input v-model="content.title" class="input title-input" @input="touch" />
        <div class="hint">
          {{ subtitle }}
          <span v-if="dirty" class="badge badge-warning">{{ t('common.unsaved') }}</span>
        </div>
      </div>
      <div class="spacer" />

      <!-- 사용기간·사용대상. 위젯이 이 값으로 틀지 말지를 정한다. -->
      <label class="meta-field" :title="t('community.periodHint')">
        <span class="muted">{{ t('community.period') }}</span>
        <input v-model="content.start_date" class="input date" type="date" @change="touch" />
        ~
        <input v-model="content.end_date" class="input date" type="date" @change="touch" />
      </label>
      <label class="meta-field" :title="t('community.audienceHint')">
        <span class="muted">{{ t('community.audience') }}</span>
        <select v-model="content.audience" class="select" @change="touch">
          <option v-for="a in ['전체', '초', '중', '고']" :key="a" :value="a">
            {{ t(`community.audience_${a}`) }}
          </option>
        </select>
      </label>

      <button class="btn" @click="previewOpen = true">{{ t('preview.open') }}</button>
      <button class="btn" @click="goBack">{{ t('common.back') }}</button>
      <button class="btn btn-primary" :disabled="saving" @click="save">
        {{ saving ? t('common.saving') : t('common.save') }}
      </button>
    </header>

    <!-- 위젯 목록은 일부러 비운다. 커뮤니티 문서에는 위젯이 없다. -->
    <ContentCanvas
      :document="content.document"
      :widgets="[]"
      community-mode
      class="canvas-fill"
      @change="touch"
      @notice="onNotice"
    />

    <ContentPreview
      v-if="previewOpen"
      :document="content.document"
      :widgets="[]"
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

.canvas-fill {
  flex: 1;
  min-height: 0;
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
</style>
