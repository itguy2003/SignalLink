<script setup>
/**
 * 위젯 옵션 폼.
 *
 * 서버가 내려준 위젯 명세(spec.options)로 입력 필드를 자동 생성한다.
 * 새 위젯을 백엔드에 추가해도 편집기 코드를 고칠 필요가 없다.
 *
 * 글상자·숫자·선택으로 안 되는 값이 둘 있다. `image_list` 는 사진을 여러 장
 * 넣고 순서를 바꾸는 일이고, `transition` 은 효과 이름을 **서버가 가진
 * 목록**에서 고르는 일이다. 이 둘만 전용 칸을 그린다.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import ImageListEditor from '@/components/ImageListEditor.vue'
import { DEFAULT_TRANSITION, TRANSITION_GROUPS, groupKey, labelKey } from '@/utils/transitions'

const props = defineProps({
  element: { type: Object, required: true },
  spec: { type: Object, default: null },
  /** 업로드·저장할 기관. 사진을 넣는 칸이 고르기 창에 그대로 넘긴다. */
  orgId: { type: Number, default: null },
})

const emit = defineEmits(['change'])

const { t } = useI18n()

function value(option) {
  return props.element.options[option.key] ?? option.default ?? ''
}

/** 목록형 값. 없으면 빈 배열 — `?? ''` 로 떨어지면 v-for 가 글자를 훑는다. */
function listValue(option) {
  const current = props.element.options[option.key] ?? option.default
  return Array.isArray(current) ? current : []
}

/**
 * 지금 정해진 기본 전환 효과.
 *
 * 사진 칸이 "안 정하면 무엇이 쓰이는지" 를 보여 주는 데 쓴다 — 이름 없이
 * '기본값' 이라고만 두면 그것이 무엇인지 확인하러 아래로 내려가야 한다.
 */
const albumTransition = computed(() => {
  const spec = props.spec?.options?.find((o) => o.type === 'transition')
  if (!spec) return DEFAULT_TRANSITION
  return props.element.options[spec.key] ?? spec.default ?? DEFAULT_TRANSITION
})

/** 지금 정해진 기본 유지 시간(초). 장마다 비워 둔 칸의 안내에 쓴다. */
const albumInterval = computed(() => {
  const current = Number(props.element.options.interval_sec)
  if (Number.isFinite(current) && current > 0) return current
  const spec = props.spec?.options?.find((o) => o.key === 'interval_sec')
  return Number(spec?.default) || 8
})

function set(option, next) {
  props.element.options[option.key] = next
  emit('change')
}

/**
 * 커뮤니티 재생목록 고르기(`community_playlist` 옵션) — 상위기관 커뮤니티의
 * 재생목록. 편집자가 특정 재생목록을 집어 삽입할 수 있게 한다. 비우면
 * 서버가 '게시' 상태의 최신 것을 자동으로 고른다.
 *
 * 목록은 이 옵션을 가진 위젯을 골랐을 때 한 번만 받아 둔다. 실패(커뮤니티
 * 없음·권한 밖)해도 조용히 자동 선택만 남긴다 — 편집을 막을 일은 아니다.
 */
const communityChoices = ref([])
const communityLoaded = ref(false)

function communityLabel(playlist) {
  // 게시 전 것을 고르면 표출되지 않는다 — 상태를 함께 보여 줘야 안 헷갈린다.
  const status = playlist.publish_status !== '게시' ? ` [${playlist.publish_status}]` : ''
  return `${playlist.title}${status}`
}

watch(
  () => (props.spec?.options ?? []).some((option) => option.type === 'community_playlist'),
  async (needed) => {
    if (!needed || communityLoaded.value) return
    communityLoaded.value = true
    try {
      const page = await api.get('/community/playlists', { size: 100 })
      communityChoices.value = (page.items ?? []).map((playlist) => ({
        value: playlist.id,
        label: communityLabel(playlist),
      }))
    } catch {
      communityChoices.value = []
    }
  },
  { immediate: true },
)

/**
 * 숫자를 명세의 한계 안으로 끌어다 맞춘다.
 *
 * 비우면 기본값으로 되돌린다 — 빈 칸을 0 으로 읽으면, 지우고 다시 적으려던
 * 사람이 그 순간 0 을 저장하게 된다.
 */
function clampNumber(option, raw) {
  const text = String(raw ?? '').trim()
  if (text === '') return option.default ?? null

  const number = Number(text)
  if (!Number.isFinite(number)) return props.element.options[option.key] ?? option.default ?? null

  const low = option.min ?? Number.NEGATIVE_INFINITY
  const high = option.max ?? Number.POSITIVE_INFINITY
  return Math.max(low, Math.min(high, number))
}
</script>

<template>
  <div>
    <p v-if="!spec || spec.options.length === 0" class="hint">{{ t('canvas.noOptions') }}</p>

    <div v-for="option in spec?.options ?? []" :key="option.key" class="field">
      <label>{{ option.label }}<span v-if="option.required"> *</span></label>

      <!-- 사용기간 같은 날짜 옵션. -->
      <input
        v-if="option.type === 'date'"
        class="input"
        type="date"
        :value="element.options[option.key] ?? ''"
        @change="set(option, $event.target.value || null)"
      />

      <ImageListEditor
        v-else-if="option.type === 'image_list'"
        :model-value="listValue(option)"
        :org-id="orgId"
        :default-transition="albumTransition"
        :default-interval="albumInterval"
        @update:model-value="set(option, $event)"
      />

      <!-- 효과 이름은 서버가 정한다. 플레이어 전부가 같은 이름을 그려야
           같은 앨범이 장치마다 다르게 넘어가지 않는다(utils/transitions). -->
      <select
        v-else-if="option.type === 'transition'"
        class="select"
        :value="element.options[option.key] ?? option.default ?? DEFAULT_TRANSITION"
        @change="set(option, $event.target.value)"
      >
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

      <!-- 상위기관 커뮤니티의 재생목록 중 하나를 집어 삽입한다. 비우면
           서버가 '게시' 상태의 최신 것을 고른다. -->
      <select
        v-else-if="option.type === 'community_playlist'"
        class="select"
        data-test="community-playlist"
        :value="element.options[option.key] ?? ''"
        @change="set(option, $event.target.value ? Number($event.target.value) : null)"
      >
        <option value="">{{ t('canvas.communityAuto') }}</option>
        <option v-for="choice in communityChoices" :key="choice.value" :value="choice.value">
          {{ choice.label }}
        </option>
      </select>

      <select
        v-else-if="option.type === 'select'"
        class="select"
        :value="value(option)"
        @change="set(option, $event.target.value)"
      >
        <option v-for="choice in option.choices" :key="choice.value" :value="choice.value">
          {{ choice.label }}
        </option>
      </select>

      <!--
        한계는 서버 명세가 정한다. 입력칸에 걸어 두는 것만으로는 모자란다 —
        붙여넣기나 키보드로 범위를 넘길 수 있어, 넣을 때 한 번 더 맞춘다.
      -->
      <input
        v-else-if="option.type === 'number'"
        class="input"
        type="number"
        :min="option.min ?? undefined"
        :max="option.max ?? undefined"
        :value="value(option)"
        @change="set(option, clampNumber(option, $event.target.value))"
      />

      <input
        v-else-if="option.type === 'boolean'"
        type="checkbox"
        :checked="Boolean(value(option))"
        @change="set(option, $event.target.checked)"
      />

      <input
        v-else
        class="input"
        :value="value(option)"
        @input="set(option, $event.target.value)"
      />
    </div>
  </div>
</template>
