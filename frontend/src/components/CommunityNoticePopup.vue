<script setup>
/**
 * 로그인 커뮤니티 알림 팝업.
 *
 * 서버(`/community/popup`)가 판정을 끝낸 목록을 준다 — '게시' 중이고,
 * 공지대상(기관구분)이 비었거나 내 기관을 포함하고, 공지희망기간 안인 글.
 * 화면은 그 목록을 보여 주기만 한다.
 *
 * 로그인마다 한 번만 뜬다: 닫으면 sessionStorage 에 표시를 남기고,
 * 로그인(auth.login)이 그 표시를 지워 다음 로그인에 다시 뜬다.
 */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import { useDraggableDialog } from '@/composables/useDraggableDialog'
import { useAuthStore } from '@/stores/auth'
import { formatNoticeTargets } from '@/utils/communityTargets'

// auth.login 이 같은 키를 지워 다음 로그인에 다시 뜬다(stores/auth.js).
const POPUP_SEEN_KEY = 'signallink.community-popup-seen'

const auth = useAuthStore()
const { t } = useI18n()

const notices = ref([])
const open = ref(false)

// 머리글을 잡고 끌면 팝업이 옮겨진다.
const { dialogStyle, onHandleMouseDown } = useDraggableDialog()

onMounted(async () => {
  if (!auth.isAuthenticated) return
  try {
    if (sessionStorage.getItem(POPUP_SEEN_KEY)) return
  } catch {
    // 저장소를 못 읽는 환경이면 그냥 보여 준다 — 알림이 빠지는 쪽이 더 나쁘다.
  }
  try {
    const items = await api.get('/community/popup')
    if (Array.isArray(items) && items.length > 0) {
      notices.value = items
      open.value = true
    }
  } catch {
    // 팝업은 부가 기능이다 — 실패해도 화면은 계속.
  }
})

function dismiss() {
  open.value = false
  try {
    sessionStorage.setItem(POPUP_SEEN_KEY, '1')
  } catch {
    // 저장 실패면 다음 화면 전환에 또 뜰 수 있다 — 치명적이지 않다.
  }
}

function formatPeriod(notice) {
  if (!notice.notice_start && !notice.notice_end) return ''
  return `${notice.notice_start ?? ''} ~ ${notice.notice_end ?? ''}`
}
</script>

<template>
  <div v-if="open" class="overlay" data-test="community-popup">
    <div class="dialog card" :style="dialogStyle" role="dialog" :aria-label="t('community.popupTitle')">
      <h2 class="title drag-handle" data-test="drag-handle" @mousedown="onHandleMouseDown">
        {{ t('community.popupTitle') }}
      </h2>
      <p class="desc muted">{{ t('community.popupDesc') }}</p>

      <ul class="list">
        <li v-for="notice in notices" :key="notice.id" class="row" data-test="popup-notice">
          <div class="row-title">{{ notice.title }}</div>
          <p v-if="notice.memo" class="row-memo">{{ notice.memo }}</p>
          <div class="row-meta muted">
            <span v-if="notice.target_org_types.length">
              {{ t('community.targetOrgTypes') }}:
              {{ formatNoticeTargets(notice.target_org_types) }}
            </span>
            <span v-else>{{ t('community.targetOrgTypes') }}: {{ t('community.targetAll') }}</span>
            <span v-if="formatPeriod(notice)">
              {{ t('community.noticePeriod') }}: {{ formatPeriod(notice) }}
            </span>
            <span v-if="notice.contact">{{ t('community.contact') }}: {{ notice.contact }}</span>
            <span v-if="notice.author_name">
              {{ t('community.author') }}: {{ notice.author_name }}
            </span>
          </div>
        </li>
      </ul>

      <div class="actions">
        <RouterLink class="btn btn-primary" to="/community/playlists" @click="dismiss">
          {{ t('community.popupOpen') }}
        </RouterLink>
        <button class="btn" data-test="popup-close" @click="dismiss">
          {{ t('community.popupClose') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: rgb(15 23 42 / 55%);
  padding: 24px;
}

.dialog {
  width: 100%;
  max-width: 520px;
  max-height: 80vh;
  overflow: auto;
  padding: 22px;
}

.title {
  margin: 0 0 4px;
  font-size: 17px;
}

/* 끌기 손잡이 — 머리글을 잡고 팝업을 옮긴다. */
.drag-handle {
  cursor: move;
  user-select: none;
}

.desc {
  margin: 0 0 14px;
  font-size: 13px;
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.row {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.row-title {
  font-weight: 600;
  font-size: 14px;
}

.row-memo {
  margin: 4px 0 0;
  font-size: 13px;
  white-space: pre-wrap;
}

.row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 6px;
  font-size: 12px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
