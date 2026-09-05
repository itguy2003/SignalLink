<script setup>
/**
 * 콘텐츠 상단 정보 표시줄 — 오늘 날짜·현재 시간·날씨·미세먼지.
 *
 * 문서 설정(`layout.info_bar`)으로 켜고 끈다. 문서에 저장되는 이유는 이것이
 * 편집기 장식이 아니라 **표출 화면의 일부**이기 때문이다 — 장치도 이 깃발을
 * 보고 같은 줄을 그린다.
 *
 * 안쪽은 문서 좌표(원본 픽셀)로 그리고 바깥에서 배율만 받는다(위젯 미리보기와
 * 같은 방식) — 그래야 줄어든 화면에서도 글자 비율이 실제와 같다.
 *
 * 날씨·미세먼지는 서버에 물어보고(`/widgets/weather/data`), 아직 API 가
 * 연동되지 않았거나 실패하면 샘플로 그린다(샘플 표식을 붙인다). 시계는
 * 위젯 미리보기와 같은 공유 타이머를 쓴다 — 화면에 몇 개가 놓여도 타이머는
 * 하나만 돈다.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import { INFO_BAR_HEIGHT } from '@/utils/canvasSplit'
import { formatClock, previewNow, subscribeClock, widgetSample } from '@/utils/widgetSamples'

const props = defineProps({
  /** 캔버스 배율. 안쪽은 문서 좌표로 그리고 이 값으로 줄인다. */
  scale: { type: Number, default: 1 },
  /** 날씨를 물을 기관. 없으면 서버가 보는 사람의 소속으로 잡는다. */
  orgId: { type: Number, default: null },
})

const { t, locale } = useI18n()

/** 서버가 준 날씨. available 이 아니면 샘플로 떨어진다. */
const weather = ref(null)
const usingSample = ref(true)

onMounted(async () => {
  try {
    const response = await api.get('/widgets/weather/data', {
      org_id: props.orgId ?? undefined,
      options: '{}',
    })
    if (response?.data?.available) {
      weather.value = response.data
      usingSample.value = false
    }
  } catch {
    // 샘플로 그린다. 표시줄이 통째로 비는 것보다 낫다.
  }
})

const shown = computed(() => weather.value ?? widgetSample('weather', locale.value))

const unsubscribe = ref(null)
onMounted(() => {
  unsubscribe.value = subscribeClock()
})
onBeforeUnmount(() => unsubscribe.value?.())

const dateText = computed(() =>
  previewNow.value.toLocaleDateString(locale.value, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }),
)

const timeText = computed(() => formatClock(previewNow.value, 'HH:mm:ss'))
</script>

<template>
  <div class="info-bar" :style="{ height: `${INFO_BAR_HEIGHT * scale}px`, fontSize: `${30 * scale}px` }">
    <span class="cell date">{{ dateText }}</span>
    <span class="cell time">{{ timeText }}</span>

    <span class="spacer" />

    <span class="cell weather">
      <span class="icon">{{ shown.icon ?? '☀' }}</span>
      {{ shown.temp }} {{ shown.condition }}
    </span>
    <span class="cell dust">
      {{ t('infoBar.dust') }}
      <strong>{{ shown.dust }}</strong>
      <span v-if="shown.pm10" class="pm">({{ shown.pm10 }}㎍/㎥)</span>
    </span>

    <!-- 실제 데이터가 아니라는 것을 편집자가 알아야 한다. -->
    <span v-if="usingSample" class="sample">{{ t('canvas.sampleMark') }}</span>
  </div>
</template>

<style scoped>
.info-bar {
  position: absolute;
  inset: 0 0 auto;
  /* 요소들 위에 얹힌다. 표출 화면의 지붕이라 내용에 가려지면 안 된다. */
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 0.9em;
  padding: 0 0.8em;
  background: rgb(15 23 42 / 78%);
  color: #f8fafc;
  overflow: hidden;
  white-space: nowrap;
}

.cell {
  display: inline-flex;
  align-items: center;
  gap: 0.28em;
}

.time {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.spacer {
  flex: 1;
}

.icon {
  font-size: 1.1em;
}

.dust .pm {
  font-size: 0.72em;
  color: #cbd5e1;
}

.sample {
  position: absolute;
  right: 0.3em;
  bottom: 0.1em;
  font-size: 0.4em;
  color: rgb(203 213 225 / 70%);
}
</style>
