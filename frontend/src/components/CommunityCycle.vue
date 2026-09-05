<script setup>
/**
 * 커뮤니티 위젯 표출 — 커뮤니티 콘텐츠를 재생목록처럼 돌린다.
 *
 * 슬라이드는 서버가 준다(`/widgets/community/data`). 화면이 직접 콘텐츠를
 * 읽지 않는 이유는 울타리와 사용기간 판정이 **주는 쪽**에 있기 때문이다 —
 * 기간 밖이면 서버가 `active=false` 만 주고, 여기는 그 말대로 아무것도
 * 틀지 않는다.
 *
 * 넘기는 규칙(시간 세기·전환)은 재생목록·앨범과 같은 것을 쓴다
 * (`useWidgetCycle`) — "재생목록과 같은 기능" 이 말 그대로가 되게.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import ContentCanvas from '@/components/ContentCanvas.vue'

const props = defineProps({
  /** 위젯 옵션 그대로. content_id / start_date / end_date */
  options: { type: Object, default: () => ({}) },
  /** 기준 기관(콘텐츠의 org). 미리보기는 편집 중인 콘텐츠의 기관을 넘긴다. */
  orgId: { type: Number, default: null },
})

const { t } = useI18n()

const data = ref(null)
const loaded = ref(false)

onMounted(async () => {
  try {
    // 옵션이 없다. 무엇을 틀지는 서버가 고른다(콘텐츠의 사용기간·사용대상).
    data.value = await api.get('/widgets/community/data', {
      org_id: props.orgId ?? undefined,
      options: '{}',
    })
  } catch {
    data.value = null
  } finally {
    loaded.value = true
  }
})

const payload = computed(() => data.value?.data ?? null)

/** 표출할 문서. CMS 콘텐츠와 같은 계약이라 캔버스가 그대로 그린다. */
const doc = computed(() => (payload.value?.active ? payload.value.document : null))
</script>

<template>
  <div class="cycle">
    <!-- 기간 밖: 서버가 active=false 를 줬다. 장치라면 아무것도 안 그린다. -->
    <div v-if="loaded && payload && !payload.active" class="state">
      <span class="chip">{{ t('community.inactive') }}</span>
    </div>

    <div v-else-if="loaded && !doc" class="state">
      <span class="chip">{{ t('community.widgetNone') }}</span>
    </div>

    <!-- 문서는 CMS 콘텐츠와 같은 계약 — 캔버스 미리보기가 그대로 그린다. -->
    <ContentCanvas v-else-if="doc" :document="doc" :widgets="[]" readonly class="doc" />
  </div>
</template>

<style scoped>
.cycle {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #000;
}

.state {
  display: grid;
  place-items: center;
  height: 100%;
}

.chip {
  padding: 0.3em 0.9em;
  border-radius: 999px;
  background: rgb(148 163 184 / 25%);
  color: #e2e8f0;
  font-size: 0.8em;
}

.doc {
  position: absolute;
  inset: 0;
}
</style>
