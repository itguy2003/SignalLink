<script setup>
/**
 * 편집기 캔버스 안의 위젯 미리보기.
 *
 * 회색 네모 대신 실제와 비슷한 내용을 그려, 배치가 맞는지·글자가 넘치는지
 * 편집 중에 바로 보이게 한다.
 *
 * 내부는 **문서 좌표(원본 픽셀)** 로 그리고 바깥에서 한 번만 축소한다.
 * 그래야 글자 크기를 실제 표출 기준으로 정할 수 있다.
 *
 * 여기 데이터는 샘플이다. 실제 표출 내용은 플레이어가 서버에서 받아 그린다
 * (utils/widgetSamples.js 주석 참조).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AlbumSlides from '@/components/AlbumSlides.vue'
import CommunityCycle from '@/components/CommunityCycle.vue'
import {
  daysUntil,
  formatClock,
  hasSample,
  previewNow,
  subscribeClock,
  timetableWeek,
  todayColumn,
  widgetSample,
} from '@/utils/widgetSamples'

const props = defineProps({
  /** 위젯 식별자 (notice, meal, clock …) */
  widgetKey: { type: String, default: null },
  /** 요소에 저장된 위젯 옵션 */
  options: { type: Object, default: () => ({}) },
  /** 표시할 이름(서버 위젯 명세에서 온 것) */
  name: { type: String, default: '' },
  /** 문서 좌표 기준 크기 */
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  /** 캔버스 배율. 안쪽은 원본 크기로 그리고 이 값으로 한 번에 축소한다. */
  scale: { type: Number, default: 1 },
  /**
   * 움직이는 위젯을 실제로 돌릴지(이미지앨범). 편집 중인 캔버스에서까지
   * 사진이 계속 바뀌면 자리를 잡는 동안 눈이 붙잡힌다.
   */
  playing: { type: Boolean, default: false },
})

const { locale } = useI18n()

const sample = computed(() => widgetSample(props.widgetKey, locale.value))
const known = computed(() => hasSample(props.widgetKey))

/** 옵션의 표시 건수를 존중하되 샘플이 모자라면 있는 만큼만. */
const listItems = computed(() => {
  if (!Array.isArray(sample.value)) return []
  const count = Number(props.options?.count) || sample.value.length
  return sample.value.slice(0, Math.max(1, count))
})

const title = computed(() => props.options?.title || props.name)

// 시계는 공유 타이머를 구독한다.
const unsubscribe = ref(null)
onMounted(() => {
  // 시간표도 구독한다 — 자정을 넘기면 '오늘' 칸이 옮겨 가야 한다.
  if (props.widgetKey === 'clock' || props.widgetKey === 'timetable') {
    unsubscribe.value = subscribeClock()
  }
})
onBeforeUnmount(() => unsubscribe.value?.())

const clockText = computed(() =>
  formatClock(previewNow.value, props.options?.format || 'HH:mm:ss'),
)

/**
 * 한 주 시간표. 줄이 교시, 칸이 요일이다.
 *
 * 하루치만 보여 주면 '내일 뭐 하지' 를 알 수 없다 — 복도에 걸린 시간표를
 * 대신하는 위젯이라 한 주가 한눈에 들어와야 한다.
 */
const timetable = computed(() =>
  props.widgetKey === 'timetable' ? timetableWeek(sample.value) : [],
)

/**
 * 오늘이 몇 번째 칸인가. 주말이면 -1 이라 아무 칸도 짚지 않는다.
 *
 * 시계와 같은 공유 시각을 본다. 자정을 넘기면 표시도 따라 옮겨 가야 하는데,
 * 장치는 몇 달씩 켜 둔 채로 돈다.
 */
const today = computed(() => todayColumn(previewNow.value, sample.value?.days?.length ?? 5))

const ddayLabel = computed(() => props.options?.label || sample.value?.label)
const ddayDays = computed(() => {
  const diff = daysUntil(props.options?.target_date)
  return diff ?? sample.value?.days ?? 0
})

/** 내용 글자 크기를 위젯 상자 크기에 맞춘다(작게 놓으면 작게 그린다). */
const unit = computed(() => Math.max(10, Math.min(props.width, props.height) / 14))
</script>

<template>
  <div
    class="preview"
    :style="{
      width: `${width}px`,
      height: `${height}px`,
      transform: `scale(${scale})`,
      fontSize: `${unit}px`,
    }"
  >
    <!-- 목록형: 공지사항 / 가정통신문 -->
    <div v-if="['notice', 'newsletter'].includes(widgetKey)" class="pane">
      <div class="pane-title">{{ title }}</div>
      <ul class="rows">
        <li v-for="(row, index) in listItems" :key="index">
          <span class="row-title">{{ row.title }}</span>
          <span class="row-meta">{{ row.author }} · {{ row.date }}</span>
        </li>
      </ul>
    </div>

    <!-- 학사일정 -->
    <div v-else-if="widgetKey === 'school_calendar'" class="pane">
      <div class="pane-title">{{ title }}</div>
      <ul class="rows">
        <li v-for="(row, index) in listItems" :key="index">
          <span class="cal-day">{{ row.day }}</span>
          <span class="row-title">{{ row.title }}</span>
        </li>
      </ul>
    </div>

    <!-- 급식 -->
    <div v-else-if="widgetKey === 'meal'" class="pane">
      <div class="pane-title">{{ sample.title }}</div>
      <ul class="dishes">
        <li v-for="dish in sample.dishes" :key="dish">{{ dish }}</li>
      </ul>
      <div class="pane-foot">{{ sample.calories }}</div>
    </div>

    <!-- 시간표: 한 주를 한눈에. 오늘 요일은 따로 짚어 준다. -->
    <div v-else-if="widgetKey === 'timetable'" class="pane">
      <div class="pane-title">{{ sample.heading }}</div>
      <table class="timetable">
        <thead>
          <tr>
            <th class="tt-period" />
            <th
              v-for="(day, at) in sample.days"
              :key="day"
              class="tt-day"
              :class="{ today: at === today }"
            >
              {{ day }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in timetable" :key="row.period">
            <th class="tt-period">{{ row.period }}</th>
            <td
              v-for="(subject, at) in row.cells"
              :key="at"
              class="tt-cell"
              :class="{ today: at === today }"
            >
              {{ subject }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- D-Day -->
    <div v-else-if="widgetKey === 'dday'" class="center">
      <div class="dday-label">{{ ddayLabel }}</div>
      <div class="dday-count">D-{{ ddayDays }}</div>
      <div class="dday-date">{{ options?.target_date || sample.date }}</div>
    </div>

    <!-- 시계 -->
    <div v-else-if="widgetKey === 'clock'" class="center">
      <div class="clock">{{ clockText }}</div>
    </div>

    <!-- 명언 -->
    <div v-else-if="widgetKey === 'quote'" class="center quote">
      <div class="quote-text">“{{ sample.text }}”</div>
      <div class="quote-author">— {{ sample.author }}</div>
    </div>

    <!-- 영단어 / 영숙어 -->
    <div v-else-if="['english_word', 'english_idiom'].includes(widgetKey)" class="center word">
      <div class="word-main">{{ sample.word }}</div>
      <div v-if="sample.pronunciation" class="word-pron">{{ sample.pronunciation }}</div>
      <div class="word-meaning">{{ sample.meaning }}</div>
      <div class="word-example">{{ sample.example }}</div>
    </div>

    <!-- 명화 -->
    <div v-else-if="widgetKey === 'painting'" class="painting">
      <div class="painting-art" />
      <div class="painting-caption">
        <strong>{{ sample.title }}</strong>
        <span>{{ sample.artist }} · {{ sample.year }}</span>
      </div>
    </div>

    <!-- 날씨 -->
    <div v-else-if="widgetKey === 'weather'" class="center weather">
      <div class="weather-icon">{{ sample.icon }}</div>
      <div class="weather-temp">{{ sample.temp }}</div>
      <div class="weather-meta">{{ sample.place }} · {{ sample.condition }}</div>
      <div class="weather-meta">{{ sample.high }} / {{ sample.low }}</div>
    </div>

    <!-- 커뮤니티 위젯: 미리보기에서는 서버 데이터로 실제 순환을 그리고,
         편집 중에는 무엇을 트는지만 알려 준다(자리를 잡는 동안 돌면 눈이
         붙잡힌다). -->
    <CommunityCycle v-else-if="widgetKey === 'community' && playing" :options="options" />
    <!-- 편집 중 카드. 무엇을 틀지는 서버가 고른다(기간·대상) — 여기서는
         커뮤니티 위젯이라는 것만 알린다. -->
    <div v-else-if="widgetKey === 'community'" class="center community-card">
      <span class="chip">🤝 {{ name }}</span>
    </div>

    <!-- 이미지앨범: 넣어 둔 사진을 실제 간격·효과로 넘긴다. -->
    <AlbumSlides v-else-if="widgetKey === 'album'" :options="options" :playing="playing">
      <template #empty>
        <span class="chip">{{ $t('album.empty') }}</span>
      </template>
    </AlbumSlides>

    <!-- 나머지 이미지 계열 -->
    <div v-else-if="['image', 'ai_image'].includes(widgetKey)" class="media">
      <div class="media-art" :class="`art-${widgetKey}`" />
      <div class="media-caption">
        {{ widgetKey === 'ai_image' ? options?.prompt || sample.prompt : sample.caption }}
      </div>
    </div>

    <!-- 샘플이 없는 위젯 -->
    <div v-else class="center fallback">
      <span class="chip">{{ name || widgetKey }}</span>
    </div>

    <span v-if="known" class="sample-mark">{{ $t('canvas.sampleMark') }}</span>
  </div>
</template>

<style scoped>
.community-card {
  gap: 0.4em;
}

.community-card .period {
  font-size: 0.6em;
  color: #94a3b8;
}

.preview {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  overflow: hidden;
  color: #f8fafc;
  font-family: inherit;
  line-height: 1.35;
  background: rgb(15 23 42 / 55%);
}

/* 샘플임을 알리는 표식. 실제 표출에는 나오지 않는다. */
.sample-mark {
  position: absolute;
  right: 0.35em;
  bottom: 0.25em;
  padding: 0.05em 0.5em;
  border-radius: 999px;
  background: rgb(15 23 42 / 70%);
  color: #cbd5e1;
  font-size: 0.55em;
  letter-spacing: 0.02em;
}

.pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0.6em 0.8em;
  gap: 0.4em;
}

.pane-title {
  font-size: 1.05em;
  font-weight: 700;
  padding-bottom: 0.3em;
  border-bottom: 0.08em solid rgb(248 250 252 / 35%);
}

.pane-foot {
  margin-top: auto;
  font-size: 0.7em;
  color: #cbd5e1;
  text-align: right;
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.28em;
  overflow: hidden;
}

.rows li {
  display: flex;
  align-items: baseline;
  gap: 0.5em;
  font-size: 0.78em;
  white-space: nowrap;
}

.row-title {
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-meta {
  margin-left: auto;
  color: #94a3b8;
  font-size: 0.85em;
  flex-shrink: 0;
}

.cal-day {
  flex-shrink: 0;
  min-width: 1.8em;
  text-align: center;
  border-radius: 0.25em;
  background: rgb(56 189 248 / 30%);
  color: #e0f2fe;
  font-weight: 700;
}

.dishes {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.22em;
  font-size: 0.82em;
  overflow: hidden;
}

.timetable {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 0.8em;
}

.timetable th,
.timetable td {
  padding: 0.18em 0.3em;
  border: 1px solid rgb(148 163 184 / 25%);
  text-align: center;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tt-day {
  color: #cbd5e1;
  font-weight: 600;
}

/*
 * 오늘 요일. 글자만 굵게 하면 멀리서 안 보인다 — 복도 끝에서 보는 화면이라
 * 칸 전체를 물들여야 한 눈에 짚인다.
 */
.tt-day.today,
.tt-cell.today {
  background: rgb(56 189 248 / 22%);
  color: #f8fafc;
}

.tt-day.today {
  background: rgb(56 189 248 / 40%);
  font-weight: 700;
}

/* 교시 칸은 좁게. 남는 폭은 요일이 나눠 갖는다. */
.tt-period {
  width: 3.6em;
  color: #94a3b8;
  font-weight: 400;
  text-align: right;
}

.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 0.5em;
  text-align: center;
  gap: 0.15em;
}

.dday-label {
  font-size: 0.9em;
  color: #cbd5e1;
}

.dday-count {
  font-size: 2.6em;
  font-weight: 800;
  color: #fde68a;
  line-height: 1;
}

.dday-date {
  font-size: 0.7em;
  color: #94a3b8;
}

.clock {
  font-size: 2.6em;
  font-weight: 700;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
}

.quote-text {
  font-size: 1.05em;
  font-weight: 600;
  word-break: keep-all;
}

.quote-author {
  font-size: 0.75em;
  color: #94a3b8;
}

.word-main {
  font-size: 1.8em;
  font-weight: 800;
}

.word-pron {
  font-size: 0.72em;
  color: #94a3b8;
}

.word-meaning {
  font-size: 0.95em;
  color: #fde68a;
}

.word-example {
  font-size: 0.7em;
  color: #cbd5e1;
  font-style: italic;
}

.painting {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.painting-art {
  flex: 1;
  background:
    radial-gradient(circle at 22% 28%, rgb(253 230 138 / 85%) 0 6%, transparent 7%),
    radial-gradient(circle at 68% 18%, rgb(224 242 254 / 70%) 0 4%, transparent 5%),
    linear-gradient(160deg, #1e3a8a 0%, #312e81 45%, #0f172a 100%);
}

.painting-caption {
  display: flex;
  flex-direction: column;
  padding: 0.35em 0.6em;
  background: rgb(15 23 42 / 80%);
  font-size: 0.72em;
}

.painting-caption span {
  color: #94a3b8;
}

.weather-icon {
  font-size: 2.2em;
  line-height: 1;
}

.weather-temp {
  font-size: 2em;
  font-weight: 700;
}

.weather-meta {
  font-size: 0.72em;
  color: #cbd5e1;
}

.media {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.media-art {
  position: relative;
  flex: 1;
  display: grid;
  place-items: center;
}

.art-album {
  background: linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%);
}

.art-ai_image {
  background: linear-gradient(135deg, #a855f7 0%, #ec4899 60%, #f59e0b 100%);
}

.media-caption {
  padding: 0.3em 0.6em;
  background: rgb(15 23 42 / 80%);
  font-size: 0.7em;
  color: #cbd5e1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fallback {
  background: rgb(148 163 184 / 25%);
}

.chip {
  padding: 0.2em 0.7em;
  border-radius: 999px;
  background: rgb(15 23 42 / 70%);
  color: #e2e8f0;
  font-size: 0.75em;
}
</style>
