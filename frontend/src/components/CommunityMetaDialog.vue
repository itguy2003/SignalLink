<script setup>
/**
 * 커뮤니티 메타정보 레이어 — 제목·공지대상(기관구분·분류)·공지희망기간·
 * 연락처·메모를 "라벨 ⇒ 입력" 2열 폼으로 받는다.
 *
 * 두 자리에서 쓴다. 목록 화면의 **게시요청 등록**(확인하면 등록하고 편집
 * 화면으로, 취소하면 아무 일도 없던 것으로)과 편집기의 **메타정보 수정**.
 * 그래서 값을 밖과 바로 묶지 않고 **제 안에서만** 고친다 — 취소가 "등록
 * 취소"가 되려면 밖의 상태를 건드리지 않아야 한다. 확인(confirm)에만
 * 고친 값을 실어 보낸다.
 */
import { nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import { useDraggableDialog } from '@/composables/useDraggableDialog'

const props = defineProps({
  /** 시작 값 — 편집기는 지금 값, 등록은 빈 값을 준다. */
  initial: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['confirm', 'cancel'])

const { t } = useI18n()

// 머리글을 잡고 끌면 레이어가 옮겨진다.
const { dialogStyle, onHandleMouseDown } = useDraggableDialog()

const title = ref(props.initial.title ?? '')
const memo = ref(props.initial.memo ?? '')
const targetOrgTypes = ref([...(props.initial.target_org_types ?? [])])
const noticeStart = ref(props.initial.notice_start ?? '')
const noticeEnd = ref(props.initial.notice_end ?? '')
const contact = ref(props.initial.contact ?? '')

/** 공지대상 선택지 — 기관구분 마스터(/org-types)의 구분과 분류(세부 구분). */
const orgTypeRows = ref([])
const titleInput = ref(null)

onMounted(async () => {
  // 열리면 곧장 제목부터 — 등록의 첫 입력이다.
  await nextTick()
  titleInput.value?.focus?.()
  try {
    const rows = await api.get('/org-types')
    orgTypeRows.value = (rows ?? []).map((row) => ({
      name: row.name,
      classifications: (row.classifications ?? '')
        .split(',')
        .map((cls) => cls.trim())
        .filter(Boolean),
    }))
  } catch {
    // 선택지를 못 받아도 입력은 계속된다.
  }
})

function confirm() {
  if (!title.value.trim()) return
  emit('confirm', {
    title: title.value.trim(),
    memo: memo.value.trim(),
    target_org_types: [...targetOrgTypes.value],
    notice_start: noticeStart.value,
    notice_end: noticeEnd.value,
    contact: contact.value.trim(),
  })
}
</script>

<template>
  <!-- 배경 클릭으로는 닫지 않는다 — 글자를 드래그 선택하다 배경에서 손을 떼거나
       메모 크기 조절 핸들을 끌다 놓으면 click 이 배경에 떨어져, 입력하던 내용이
       통째로 사라졌다. 닫기는 [취소]/[확인] 버튼만. -->
  <div class="meta-overlay" data-test="meta-layer">
    <div
      class="meta-dialog card"
      :style="dialogStyle"
      role="dialog"
      :aria-label="t('community.metaOpen')"
    >
      <h2 class="meta-title drag-handle" data-test="drag-handle" @mousedown="onHandleMouseDown">
        {{ t('community.metaOpen') }}
      </h2>

      <div class="field">
        <span class="field-label">{{ t('community.playlistTitle') }}</span>
        <div class="field-control">
          <input
            ref="titleInput"
            v-model="title"
            class="input"
            :placeholder="t('community.titleRequired')"
            data-test="editor-title"
          />
        </div>
      </div>

      <div class="field">
        <span class="field-label">{{ t('community.targetOrgTypes') }}</span>
        <div class="field-control">
          <div class="targets" data-test="editor-targets">
            <!-- 구분마다 한 묶음: 구분 전체 체크 + 분류(초·중·고 등) 세부 체크. -->
            <span v-for="type in orgTypeRows" :key="type.name" class="target-group">
              <label class="target-check">
                <input v-model="targetOrgTypes" type="checkbox" :value="type.name" />
                <span>{{ type.name }}</span>
              </label>
              <label
                v-for="cls in type.classifications"
                :key="`${type.name}:${cls}`"
                class="target-check sub"
              >
                <input v-model="targetOrgTypes" type="checkbox" :value="`${type.name}:${cls}`" />
                <span>{{ cls }}</span>
              </label>
            </span>
          </div>
          <span class="hint">{{ t('community.targetHint') }}</span>
        </div>
      </div>

      <div class="field">
        <span class="field-label">{{ t('community.noticePeriod') }}</span>
        <div class="field-control">
          <div class="period" data-test="editor-period">
            <input
              v-model="noticeStart"
              type="date"
              class="input date-input"
              data-test="notice-start"
            />
            <span>~</span>
            <input v-model="noticeEnd" type="date" class="input date-input" data-test="notice-end" />
          </div>
          <span class="hint">{{ t('community.noticePeriodHint') }}</span>
        </div>
      </div>

      <div class="field">
        <span class="field-label">{{ t('community.contact') }}</span>
        <div class="field-control">
          <input
            v-model="contact"
            class="input"
            :placeholder="t('community.contactHint')"
            data-test="editor-contact"
          />
        </div>
      </div>

      <div class="field">
        <span class="field-label">{{ t('community.memo') }}</span>
        <div class="field-control">
          <!-- 메모는 여러 줄 — 안내문처럼 줄바꿈이 필요한 글이 온다. -->
          <textarea
            v-model="memo"
            class="textarea memo-input"
            rows="3"
            :placeholder="t('community.memoHint')"
            data-test="editor-memo"
          />
        </div>
      </div>

      <div class="meta-actions">
        <button class="btn" data-test="cancel-meta" @click="emit('cancel')">
          {{ t('common.cancel') }}
        </button>
        <button
          class="btn btn-primary"
          :disabled="!title.trim()"
          data-test="close-meta"
          @click="confirm"
        >
          {{ t('community.metaDone') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.meta-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: rgb(15 23 42 / 55%);
  padding: 24px;
}

.meta-dialog {
  width: 100%;
  max-width: 620px;
  max-height: 85vh;
  overflow: auto;
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  /* 레이어 안은 전부 왼쪽 정렬 — 가운데 정렬을 물려받지 않는다. */
  text-align: left;
}

.meta-title {
  margin: 0;
  font-size: 16px;
  text-align: left;
}

/* 끌기 손잡이 — 머리글을 잡고 레이어를 옮긴다. */
.drag-handle {
  cursor: move;
  user-select: none;
}

/* 라벨 ⇒ 입력 — 왼쪽 라벨 열, 오른쪽 입력 열의 2열 폼. */
.field {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
}

.field-label {
  padding-top: 7px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-align: left;
}

.field-control {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.field-control > .input,
.field-control > .textarea {
  width: 100%;
}

.targets {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 6px 10px;
}

/* 구분 하나 = 한 알약 묶음. 뒤따르는 작은 체크가 그 구분의 세부(분류)다. */
.target-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
}

.target-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  cursor: pointer;
}

.target-check.sub {
  font-size: 12px;
  color: var(--text-muted);
}

.period {
  display: flex;
  align-items: center;
  gap: 6px;
}

.date-input {
  width: 140px;
}

.memo-input {
  resize: vertical;
}

.meta-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
