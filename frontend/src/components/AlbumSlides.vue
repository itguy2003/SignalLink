<script setup>
/**
 * 이미지앨범 표출.
 *
 * 사진 여러 장을 정한 간격으로 넘긴다. 넘기는 규칙(시간을 세는 일과 전환을
 * 입히는 일)은 재생목록과 **같은 것을 쓴다**(`useWidgetCycle`) — 두 곳에
 * 따로 적으면 "재생목록에서는 맞는데 앨범에서는 다르다"가 된다.
 *
 * 사진 목록은 위젯 옵션 안에 있다(`options.images`). 요소의 `src` 가 아니라
 * 옵션인 이유는 한 요소가 여러 장을 들기 때문이다. 그래서 서버도 이 옵션을
 * 훑어 자산 색인을 건다(`services/assets.option_asset_ids`) — 그러지 않으면
 * 앨범이 쓰는 사진이 '아무도 안 쓰는 파일' 로 보여 지울 수 있게 된다.
 */
import { computed } from 'vue'

import { useWidgetCycle } from '@/composables/useWidgetCycle'
import { DEFAULT_TRANSITION_MS, normalize, normalizeMs } from '@/utils/transitions'

const props = defineProps({
  /** 위젯 옵션 그대로. images / interval_sec / transition / transition_ms / fit */
  options: { type: Object, default: () => ({}) },
  /**
   * 실제로 넘길지. 편집 중인 캔버스에서까지 사진이 계속 바뀌면 자리를 잡는
   * 동안 눈이 붙잡힌다 — 그래서 미리보기·표출에서만 돌린다.
   */
  playing: { type: Boolean, default: false },
})

/** 넘김 간격을 안 정했을 때. 서버 명세의 기본값과 같아야 한다. */
const DEFAULT_INTERVAL_SEC = 8
/** 한 장의 최소 표출 시간. 이보다 짧으면 사진을 알아보기 전에 넘어간다. */
const MIN_INTERVAL_SEC = 1

const images = computed(() => {
  const list = props.options?.images
  if (!Array.isArray(list)) return []
  // 주소 문자열만 넣은 문서도 받는다. 손으로 고친 문서나 옛 형식일 수 있다.
  return list
    .map((entry) => (typeof entry === 'string' ? { src: entry } : entry))
    .filter((entry) => entry?.src)
})

/**
 * 넘김 간격(초). 0·빈칸·글자는 '안 정함' 으로 보고 기본값을 쓴다 — 0 을
 * 그대로 쓰면 한 틱에 목록을 다 돌아 화면이 깜빡인다.
 */
const interval = computed(() => {
  const seconds = Number(props.options?.interval_sec)
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_INTERVAL_SEC
  return Math.max(MIN_INTERVAL_SEC, seconds)
})

/** 앨범 기본 효과. 장마다 정하지 않았으면 이것이 쓰인다. */
const transition = computed(() => normalize(props.options?.transition))

const transitionMs = computed(() =>
  normalizeMs(props.options?.transition_ms ?? DEFAULT_TRANSITION_MS),
)

/** 'cover' 는 화면을 채우고(잘릴 수 있음) 'contain' 은 전부 보여 준다(여백). */
const fit = computed(() => (props.options?.fit === 'contain' ? 'contain' : 'cover'))

/**
 * 넘기는 규칙에 넘길 목록.
 *
 * 머무는 시간과 전환을 **장마다** 따로 줄 수 있고, 안 정한 장은 앨범
 * 기본값을 쓴다. 이때 `transition` 은 '이 장으로 넘어올 때' 를 뜻한다
 * (재생목록의 칸과 같다).
 */
const slides = computed(() =>
  images.value.map((image) => ({
    ...image,
    duration_sec: Number(image.duration_sec) > 0 ? Number(image.duration_sec) : interval.value,
    transition: image.transition ? normalize(image.transition) : transition.value,
    transition_ms: image.transition
      ? normalizeMs(image.transition_ms ?? transitionMs.value)
      : transitionMs.value,
  })),
)

const { current, outgoing, stageStyle, outgoingStyle, index, tick } = useWidgetCycle(
  () => slides.value,
  { autoplay: props.playing },
)

defineExpose({ tick, index })
</script>

<template>
  <div class="album" :class="{ empty: images.length === 0 }">
    <!-- 아직 아무것도 안 넣었을 때. 빈 검정 칸만 두면 고장인지 빈 것인지 모른다. -->
    <slot v-if="images.length === 0" name="empty" />

    <template v-else>
      <!-- 디졸브에서만 앞 장을 잠시 남긴다(전환 시간 동안). -->
      <img
        v-if="outgoing"
        class="slide outgoing"
        :src="outgoing.src"
        :style="{ ...outgoingStyle, objectFit: fit }"
        alt=""
      />
      <img
        v-if="current"
        :key="current.src"
        class="slide"
        :src="current.src"
        :style="{ ...stageStyle, objectFit: fit }"
        alt=""
      />

      <!-- 몇 장 중 몇 번째인지. 편집 중에 다 넣었는지 확인하는 근거다. -->
      <span v-if="images.length > 1" class="count">{{ index + 1 }} / {{ images.length }}</span>
    </template>
  </div>
</template>

<style scoped>
.album {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
}

.album.empty {
  background: linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%);
  display: grid;
  place-items: center;
}

.slide {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* 전환 시간은 인라인으로 온다 — 장마다 다를 수 있기 때문이다. */
  transition-property: opacity, transform, filter, clip-path;
  transition-timing-function: ease;
}

.outgoing {
  z-index: 0;
}

.count {
  position: absolute;
  right: 0.5em;
  bottom: 0.5em;
  z-index: 2;
  padding: 0.15em 0.6em;
  border-radius: 999px;
  background: rgb(0 0 0 / 60%);
  color: #fff;
  font-size: 0.75em;
}
</style>
