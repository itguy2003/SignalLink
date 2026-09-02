<script setup>
/**
 * 속성 패널의 사진 칸(이미지앨범의 `images` 옵션).
 *
 * 여기서는 **무엇이 담겼는지만** 보여 준다. 실제 편집(넣기·순서·유지 시간·
 * 전환)은 넓은 창에서 한다(`AlbumEditorDialog`) — 스무 장을 이 좁은 칸에서
 * 다루게 하면 한 줄이 세 겹으로 접히고, 왼쪽 캔버스는 그만큼 좁아진다.
 *
 * 그래도 빼기와 순서 바꾸기는 여기서도 된다. 한 장을 빼려고 창을 여는 것은
 * 지나치다.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AlbumEditorDialog from '@/components/AlbumEditorDialog.vue'

const props = defineProps({
  /** [{ src, duration_sec?, transition?, transition_ms? }] 또는 주소 배열(옛 문서). */
  modelValue: { type: Array, default: () => [] },
  /** 업로드·저장할 기관. 편집 창에 그대로 넘긴다. */
  orgId: { type: Number, default: null },
  /** 앨범 기본 전환 효과. 장마다 정하지 않았을 때 무엇이 쓰이는지 알린다. */
  defaultTransition: { type: String, default: 'none' },
  /** 앨범 기본 유지 시간(초). */
  defaultInterval: { type: Number, default: 8 },
})

const emit = defineEmits(['update:modelValue'])

const { t } = useI18n()

const editorOpen = ref(false)

const images = computed(() =>
  (props.modelValue ?? [])
    .map((entry) => (typeof entry === 'string' ? { src: entry } : entry))
    .filter((entry) => entry?.src),
)

/** 장마다 따로 정한 것이 있는지. 있으면 그렇다고 알린다. */
const tuned = computed(() =>
  images.value.some((image) => image.transition || image.duration_sec),
)

function commit(next) {
  emit('update:modelValue', next)
}

function remove(at) {
  commit(images.value.filter((_, index) => index !== at))
}

function move(at, offset) {
  const to = at + offset
  if (to < 0 || to >= images.value.length) return
  const next = [...images.value]
  const [moved] = next.splice(at, 1)
  next.splice(to, 0, moved)
  commit(next)
}
</script>

<template>
  <div class="image-list">
    <p v-if="images.length === 0" class="hint">{{ t('album.noImages') }}</p>

    <ul v-else class="items">
      <li v-for="(image, at) in images" :key="`${at}-${image.src}`" class="item">
        <span class="order">{{ at + 1 }}</span>
        <img class="thumb" :src="image.src" alt="" />
        <span class="moves">
          <button class="btn btn-sm" :disabled="at === 0" @click="move(at, -1)">↑</button>
          <button class="btn btn-sm" :disabled="at === images.length - 1" @click="move(at, 1)">
            ↓
          </button>
        </span>
        <button class="btn btn-sm danger" :title="t('common.delete')" @click="remove(at)">✕</button>
      </li>
    </ul>

    <p v-if="tuned" class="hint">{{ t('album.tuned') }}</p>

    <button class="btn block open" @click="editorOpen = true">
      {{ images.length === 0 ? t('album.add') : t('album.edit') }}
    </button>

    <AlbumEditorDialog
      v-if="editorOpen"
      :model-value="modelValue"
      :org-id="orgId"
      :default-transition="defaultTransition"
      :default-interval="defaultInterval"
      @update:model-value="commit"
      @close="editorOpen = false"
    />
  </div>
</template>

<style scoped>
.image-list {
  display: grid;
  gap: 6px;
}

.items {
  display: grid;
  gap: 4px;
  /* 스무 장을 넣으면 속성 칸이 그만큼 길어져 아래 설정이 화면 밖으로 밀린다. */
  max-height: 220px;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.order {
  width: 1.4em;
  text-align: center;
  font-size: 11px;
  color: var(--muted);
}

.thumb {
  flex: 1;
  min-width: 0;
  height: 42px;
  border-radius: 3px;
  object-fit: cover;
  background: #000;
}

.moves {
  display: grid;
  gap: 2px;
}

.moves .btn {
  padding: 0 5px;
  line-height: 1.2;
}

.danger:hover {
  border-color: var(--danger);
  color: var(--danger);
}

.open {
  margin-top: 2px;
}
</style>
