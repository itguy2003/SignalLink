<script setup>
/**
 * 소속기관 고르기.
 *
 * 기관이 300개를 넘을 수 있어 선택 상자에 전부 채울 수 없다. 다 채우면
 * 고르기도 어렵고(스크롤로 이름 하나 찾기), 창을 열 때마다 목록 전체를
 * 받는다.
 *
 * 그래서 **검색으로 좁힌 뒤 고른다**. 서버가 이름으로 걸러 앞쪽 몇 건만
 * 돌려주므로, 기관이 몇 개든 받아 오는 양이 일정하다.
 *
 * 고른 뒤에는 이름을 그대로 보여 준다 — 입력창에 검색어만 남으면 무엇을
 * 골랐는지 확인할 수 없다.
 */
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'

const props = defineProps({
  /** 고른 기관 id. 없으면 null. */
  modelValue: { type: [Number, String], default: null },
  /**
   * 조회 경로. 로그인 전 화면(회원가입)은 `/organizations/public` 을 쓴다.
   */
  endpoint: { type: String, default: '/organizations' },
  /** 조회에 덧붙일 파라미터. 커뮤니티 가입은 { category: '기관' } 으로 좁힌다. */
  params: { type: Object, default: () => ({}) },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

const { t } = useI18n()

/** 한 번에 보여 줄 검색 결과 수. 더 있으면 검색어를 좁히라고 알린다. */
const LIMIT = 20

const query = ref('')
const results = ref([])
const loading = ref(false)
const open = ref(false)
/** 고른 기관의 이름. id 만으로는 화면에 이름을 쓸 수 없다. */
const selectedName = ref('')

async function search() {
  loading.value = true
  try {
    const items = await api.get(props.endpoint, {
      ...props.params,
      q: query.value.trim() || undefined,
      limit: LIMIT + 1,
    })
    results.value = items
  } catch {
    results.value = []
  } finally {
    loading.value = false
  }
}

/** 고른 기관의 이름을 채운다. 수정 창을 열었을 때 id 만 넘어오기 때문이다. */
async function resolveName(id) {
  if (id === null || id === '') {
    selectedName.value = ''
    return
  }
  const known = results.value.find((org) => org.id === Number(id))
  if (known) {
    selectedName.value = known.name
    return
  }
  try {
    selectedName.value = (await api.get(`${props.endpoint}/${id}`)).name
  } catch {
    // 이름을 못 읽어도 고른 상태는 유지한다. 지워 버리면 저장할 때 값이 사라진다.
    selectedName.value = `#${id}`
  }
}

onMounted(async () => {
  await resolveName(props.modelValue)
})

watch(() => props.modelValue, resolveName)

let timer = null
watch(query, () => {
  // 글자마다 요청하면 300개짜리 기관 목록을 몇 번이고 다시 훑게 된다.
  clearTimeout(timer)
  timer = setTimeout(search, 250)
})

function openList() {
  if (props.disabled) return
  open.value = true
  if (results.value.length === 0) search()
}

function pick(org) {
  emit('update:modelValue', org.id)
  selectedName.value = org.name
  open.value = false
  query.value = ''
}

function clear() {
  emit('update:modelValue', null)
  selectedName.value = ''
  open.value = true
}
</script>

<template>
  <div class="org-picker">
    <!-- 고른 상태: 무엇을 골랐는지 이름으로 보여 준다. -->
    <div v-if="modelValue && !open" class="chosen">
      <span class="chosen-name">{{ selectedName || t('common.loading') }}</span>
      <button
        v-if="!disabled"
        class="btn btn-sm"
        type="button"
        @click="clear"
      >
        {{ t('org.change') }}
      </button>
    </div>

    <template v-else>
      <input
        v-model="query"
        class="input"
        type="search"
        :disabled="disabled"
        :placeholder="t('org.searchPlaceholder')"
        @focus="openList"
      />

      <div v-if="open" class="results">
        <p v-if="loading" class="muted pad">{{ t('common.loading') }}</p>
        <p v-else-if="results.length === 0" class="muted pad">{{ t('org.searchNoMatch') }}</p>
        <template v-else>
          <button
            v-for="org in results.slice(0, LIMIT)"
            :key="org.id"
            class="result"
            type="button"
            @click="pick(org)"
          >
            {{ org.name }}
          </button>
          <!-- 더 있는데 안 보여 주면 없는 줄 안다. -->
          <p v-if="results.length > LIMIT" class="hint pad">{{ t('org.narrowSearch') }}</p>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.org-picker {
  position: relative;
}

.chosen {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  font-size: 13px;
}

.chosen-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 목록이 창 안의 다른 입력을 밀어내지 않도록 띄운다. */
.results {
  position: absolute;
  z-index: 5;
  left: 0;
  right: 0;
  margin-top: 3px;
  max-height: 240px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
}

.result {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.result:last-of-type {
  border-bottom: 0;
}

.result:hover {
  background: var(--surface-2);
}

.pad {
  margin: 0;
  padding: 9px 10px;
}
</style>
