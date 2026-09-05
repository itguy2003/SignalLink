<script setup>
/**
 * 콘텐츠 문서의 축소판.
 *
 * 편집 캔버스(ContentCanvas)를 목록 줄마다 세우면 스무 줄에 스무 개의
 * 편집기가 돌아간다. 목록에 필요한 것은 "무엇이 어디쯤 있는지" 뿐이라,
 * 요소를 자리와 갈래만 맞춰 얇게 그린다 — 이미지는 실제 그림, 글자는
 * 줄인 글자, 동영상·웹은 표식.
 */
import { computed } from 'vue'

const props = defineProps({
  document: { type: Object, required: true },
  /** 축소판의 가로 폭(px). 높이는 문서 비율을 따른다. */
  width: { type: Number, default: 120 },
})

const layout = computed(() => ({
  width: 1920,
  height: 1080,
  background: '#000000',
  ...(props.document?.layout ?? {}),
}))

const scale = computed(() => props.width / layout.value.width)

const elements = computed(() => props.document?.elements ?? [])

function boxStyle(element) {
  const rect = element.rect ?? {}
  return {
    left: `${(rect.x ?? 0) * scale.value}px`,
    top: `${(rect.y ?? 0) * scale.value}px`,
    width: `${(rect.w ?? 0) * scale.value}px`,
    height: `${(rect.h ?? 0) * scale.value}px`,
    zIndex: rect.z ?? 1,
  }
}
</script>

<template>
  <div
    class="thumb"
    :style="{
      width: `${width}px`,
      height: `${layout.height * scale}px`,
      background: layout.background,
    }"
  >
    <div v-for="element in elements" :key="element.id" class="el" :style="boxStyle(element)">
      <img
        v-if="element.type === 'image' && element.src"
        class="fill"
        :src="element.src"
        alt=""
        loading="lazy"
      />
      <span
        v-else-if="element.type === 'text'"
        class="text"
        :style="{
          color: element.options?.color ?? '#fff',
          fontSize: `${Math.max(2, (element.options?.fontSize ?? 48) * scale)}px`,
        }"
      >
        {{ element.options?.text }}
      </span>
      <span v-else-if="element.type === 'video'" class="mark">🎬</span>
      <span v-else-if="element.type === 'web'" class="mark">🌐</span>
      <span v-else class="ghost" />
    </div>
  </div>
</template>

<style scoped>
.thumb {
  position: relative;
  overflow: hidden;
  border-radius: 4px;
  flex: none;
}

.el {
  position: absolute;
  overflow: hidden;
  display: grid;
  place-items: center;
}

.fill {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.text {
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  line-height: 1.2;
}

.mark {
  font-size: 9px;
}

/* 모르는 요소도 자리는 보여 준다. */
.ghost {
  width: 100%;
  height: 100%;
  background: rgb(148 163 184 / 25%);
}
</style>
