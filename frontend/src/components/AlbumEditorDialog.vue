<script setup>
/**
 * 이미지앨범 편집 창.
 *
 * 왼쪽은 **어디서 가져올지**(업로드 / 라이브러리 / 검색 / 링크), 오른쪽은
 * **가져온 것을 어떻게 넘길지**(순서·유지 시간·전환 효과·전환 시간)다.
 * 둘을 한 화면에 나란히 두는 이유는 앨범을 만드는 일이 '넣고 → 보고 →
 * 순서를 고치고 → 또 넣는' 반복이기 때문이다. 창을 여닫으며 오가면 그
 * 반복이 그대로 왕복이 된다.
 *
 * 왼쪽 칸은 이미지 넣기와 **같은 것**을 쓴다(`MediaSourcePanel`). 앨범만
 * 다른 방법으로 넣게 하면 폐쇄망에서 안 나오는 링크를 여기서만 쓰게 된다.
 *
 * 저장 모양은 `[{ src, duration_sec?, transition?, transition_ms? }]` —
 * 재생목록의 칸과 같은 모양이다. 넘기는 규칙을 그쪽과 공유하기 때문이다
 * (`useWidgetCycle`). 비운 값은 앨범 기본값을 따른다는 뜻이고, 문서에는
 * 아예 넣지 않는다 — 안 쓰는 값이 남으면 나중에 읽는 사람이 의미 있는
 * 설정이라고 믿게 된다.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import MediaSourcePanel from '@/components/MediaSourcePanel.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import {
  DEFAULT_TRANSITION_MS,
  MAX_TRANSITION_MS,
  MIN_TRANSITION_MS,
  TRANSITION_GROUPS,
  groupKey,
  labelKey,
} from '@/utils/transitions'

const props = defineProps({
  /** 지금 담긴 사진들. 창을 여는 쪽이 들고 있는 값이다. */
  modelValue: { type: Array, default: () => [] },
  /** 업로드·저장할 기관. 왼쪽 칸에 그대로 넘긴다. */
  orgId: { type: Number, default: null },
  /** 앨범 기본 유지 시간(초). 장마다 정하지 않았을 때 쓰인다. */
  defaultInterval: { type: Number, default: 8 },
  /** 앨범 기본 전환 효과. */
  defaultTransition: { type: String, default: 'none' },
})

const emit = defineEmits(['close', 'update:modelValue'])

const { t } = useI18n()

/** 장마다 정하지 않았음을 뜻하는 값. 빈 문자열이어야 select 가 비어 보인다. */
const INHERIT = ''

/** 유지 시간의 한계. 0 초는 타이머가 폭주하고, 너무 길면 앨범이 멈춘 듯 보인다. */
const MIN_DURATION_SEC = 1
const MAX_DURATION_SEC = 3600

/**
 * 편집 중인 목록. 창 안에서만 고치고 **닫을 때가 아니라 고칠 때마다** 올린다 —
 * 창을 닫아야 반영되면, 캔버스에서 결과를 보려고 매번 닫았다 열게 된다.
 */
const images = computed(() =>
  (props.modelValue ?? [])
    .map((entry) => (typeof entry === 'string' ? { src: entry } : entry))
    .filter((entry) => entry?.src),
)

/** 오른쪽 목록에서 지금 보고 있는 줄. 왼쪽에서 고른 것이 어디로 갈지 알린다. */
const focused = ref(null)

const defaultLabel = computed(() => t(labelKey(props.defaultTransition)))

function commit(next) {
  emit('update:modelValue', next)
}

function patch(at, changes) {
  const next = [...images.value]
  next[at] = { ...next[at], ...changes }
  commit(next)
}

/** 왼쪽에서 고른 것들을 뒤에 담는다. 온 순서가 곧 재생 순서다. */
function add(items) {
  const added = items.map(({ src, credit = null }) => ({ src, ...(credit ?? {}) }))
  if (added.length > 0) commit([...images.value, ...added])
}

function remove(at) {
  commit(images.value.filter((_, index) => index !== at))
  if (focused.value === at) focused.value = null
}

function move(at, offset) {
  const to = at + offset
  if (to < 0 || to >= images.value.length) return
  const next = [...images.value]
  const [moved] = next.splice(at, 1)
  next.splice(to, 0, moved)
  commit(next)
  focused.value = to
}

/** 유지 시간. 비우면 앨범 기본값을 따른다(문서에서 키를 지운다). */
function setDuration(at, value) {
  const raw = String(value ?? '').trim()
  if (raw === '') {
    const next = [...images.value]
    const entry = { ...next[at] }
    delete entry.duration_sec
    next[at] = entry
    commit(next)
    return
  }
  const seconds = Number(raw)
  if (!Number.isFinite(seconds)) return
  patch(at, {
    duration_sec: Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, Math.round(seconds))),
  })
}

function setTransition(at, value) {
  const next = [...images.value]
  const entry = { ...next[at] }
  if (value === INHERIT) {
    delete entry.transition
    delete entry.transition_ms
  } else {
    entry.transition = value
    if (value === 'none') delete entry.transition_ms
    else entry.transition_ms ??= DEFAULT_TRANSITION_MS
  }
  next[at] = entry
  commit(next)
}

function setTransitionMs(at, value) {
  const ms = Number(value)
  if (!Number.isFinite(ms)) return
  patch(at, {
    transition_ms: Math.max(MIN_TRANSITION_MS, Math.min(MAX_TRANSITION_MS, Math.round(ms))),
  })
}

/**
 * 한 줄에서 정한 값을 모든 줄에 편다.
 *
 * 스무 장에 같은 효과를 주려고 스무 번 고르게 하면 안 된다. 재생목록 편집기가
 * 같은 이유로 같은 것을 두고 있다.
 */
function applyAll(field, value) {
  if (value === INHERIT) {
    commit(
      images.value.map((image) => {
        const entry = { ...image }
        delete entry[field]
        if (field === 'transition') delete entry.transition_ms
        return entry
      }),
    )
    return
  }
  commit(
    images.value.map((image) => {
      const entry = { ...image, [field]: value }
      if (field === 'transition') {
        if (value === 'none') delete entry.transition_ms
        else entry.transition_ms ??= DEFAULT_TRANSITION_MS
      }
      return entry
    }),
  )
}

function applyAllDuration(value) {
  const raw = String(value ?? '').trim()
  if (raw === '') return
  const seconds = Number(raw)
  if (!Number.isFinite(seconds)) return
  applyAll(
    'duration_sec',
    Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, Math.round(seconds))),
  )
}

/** 시간 칸을 쓸 수 있는가. 효과가 없으면 시간은 쓰이지 않는다. */
function timed(image) {
  return (image.transition ?? INHERIT) !== INHERIT && image.transition !== 'none'
}

/** 한 바퀴 도는 데 걸리는 시간. 얼마마다 같은 사진이 돌아오는지가 관심사다. */
const cycleSeconds = computed(() =>
  images.value.reduce(
    (sum, image) => sum + (Number(image.duration_sec) || props.defaultInterval),
    0,
  ),
)
</script>

<template>
  <ModalDialog :title="t('album.editorTitle')" width="1080px" hide-footer @close="emit('close')">
    <div class="album-editor">
      <!-- 왼쪽: 어디서 가져올지. 이미지 넣기와 같은 칸이다. -->
      <section class="source">
        <h4 class="col-title">{{ t('album.sourceTitle') }}</h4>
        <MediaSourcePanel
          kind="image"
          multiple
          :org-id="orgId"
          @select="add([$event])"
          @select-many="add($event)"
        />
      </section>

      <!-- 오른쪽: 가져온 것을 어떻게 넘길지. -->
      <section class="slides">
        <h4 class="col-title">
          {{ t('album.slidesTitle', { count: images.length }) }}
          <span v-if="images.length" class="muted">
            · {{ t('album.cycle', { seconds: cycleSeconds }) }}
          </span>
        </h4>

        <p v-if="images.length === 0" class="table-empty">{{ t('album.dropHint') }}</p>

        <template v-else>
          <!-- 스무 장을 한 줄씩 고치게 하면 안 된다. -->
          <div class="apply-all">
            <span class="muted">{{ t('album.applyAll') }}</span>
            <select class="select" @change="applyAll('transition', $event.target.value)">
              <option value="">{{ t('album.useDefault') }} ({{ defaultLabel }})</option>
              <optgroup
                v-for="group in TRANSITION_GROUPS"
                :key="group.key"
                :label="t(groupKey(group.key))"
              >
                <option v-for="kind in group.kinds" :key="kind" :value="kind">
                  {{ t(labelKey(kind)) }}
                </option>
              </optgroup>
            </select>
            <input
              class="input sec"
              type="number"
              :min="MIN_DURATION_SEC"
              :max="MAX_DURATION_SEC"
              :placeholder="String(defaultInterval)"
              :title="t('album.holdSec')"
              @change="applyAllDuration($event.target.value); $event.target.value = ''"
            />
            <span class="muted">{{ t('album.sec') }}</span>
          </div>

          <ul class="rows">
            <li
              v-for="(image, at) in images"
              :key="`${at}-${image.src}`"
              class="row"
              :class="{ focused: focused === at }"
              @click="focused = at"
            >
              <span class="order">{{ at + 1 }}</span>
              <img class="thumb" :src="image.src" alt="" />

              <div class="fields">
                <label class="field">
                  <span class="muted">{{ t('album.holdSec') }}</span>
                  <input
                    class="input sec"
                    type="number"
                    :min="MIN_DURATION_SEC"
                    :max="MAX_DURATION_SEC"
                    :placeholder="String(defaultInterval)"
                    :value="image.duration_sec ?? ''"
                    @change="setDuration(at, $event.target.value)"
                  />
                </label>

                <label class="field grow">
                  <span class="muted">{{ t('album.slideTransition') }}</span>
                  <select
                    class="select"
                    :value="image.transition ?? INHERIT"
                    @change="setTransition(at, $event.target.value)"
                  >
                    <option :value="INHERIT">
                      {{ t('album.useDefault') }} ({{ defaultLabel }})
                    </option>
                    <optgroup
                      v-for="group in TRANSITION_GROUPS"
                      :key="group.key"
                      :label="t(groupKey(group.key))"
                    >
                      <option v-for="kind in group.kinds" :key="kind" :value="kind">
                        {{ t(labelKey(kind)) }}
                      </option>
                    </optgroup>
                  </select>
                </label>

                <label class="field">
                  <span class="muted">{{ t('transition.label') }} {{ t('transition.ms') }}</span>
                  <input
                    class="input ms"
                    type="number"
                    :min="MIN_TRANSITION_MS"
                    :max="MAX_TRANSITION_MS"
                    step="100"
                    :title="t('transition.msTitle')"
                    :disabled="!timed(image)"
                    :value="image.transition_ms ?? DEFAULT_TRANSITION_MS"
                    @change="setTransitionMs(at, $event.target.value)"
                  />
                </label>
              </div>

              <span class="moves">
                <button class="btn btn-sm" :disabled="at === 0" @click.stop="move(at, -1)">↑</button>
                <button
                  class="btn btn-sm"
                  :disabled="at === images.length - 1"
                  @click.stop="move(at, 1)"
                >
                  ↓
                </button>
              </span>
              <button
                class="btn btn-sm danger"
                :title="t('common.delete')"
                @click.stop="remove(at)"
              >
                ✕
              </button>
            </li>
          </ul>
        </template>
      </section>
    </div>

    <div class="foot">
      <p class="hint">{{ t('album.editorHint') }}</p>
      <button class="btn btn-primary" @click="emit('close')">{{ t('common.close') }}</button>
    </div>
  </ModalDialog>
</template>

<style scoped>
.album-editor {
  display: grid;
  grid-template-columns: minmax(0, 380px) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.col-title {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--muted);
  font-weight: 700;
}

.source,
.slides {
  min-width: 0;
}

.slides {
  border-left: 1px solid var(--border);
  padding-left: 14px;
}

.apply-all {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 6px;
  border-bottom: 1px dashed var(--border);
  font-size: 11px;
}

.rows {
  display: grid;
  gap: 4px;
  /* 스무 장을 넣어도 창이 화면 밖으로 자라면 안 된다. */
  max-height: 54vh;
  overflow-y: auto;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}

.row.focused {
  border-color: var(--primary);
}

.order {
  width: 1.4em;
  text-align: center;
  font-size: 11px;
  color: var(--muted);
}

.thumb {
  width: 72px;
  height: 48px;
  border-radius: 3px;
  object-fit: cover;
  background: #000;
}

.fields {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.field {
  display: grid;
  gap: 1px;
  font-size: 10px;
}

.field.grow {
  flex: 1;
  min-width: 0;
}

.sec {
  width: 58px;
}

.ms {
  width: 68px;
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

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.foot .hint {
  margin: 0;
}

@media (width <= 900px) {
  .album-editor {
    grid-template-columns: minmax(0, 1fr);
  }

  .slides {
    border-left: 0;
    padding-left: 0;
  }
}
</style>
