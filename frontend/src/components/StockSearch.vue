<script setup>
/**
 * 무료 스톡 소재 검색(Pixabay) — 이미지와 동영상.
 *
 * 검색은 **서버를 거친다**. API 키를 브라우저에 두면 번들에 그대로 실려
 * 누구나 꺼내 쓸 수 있기 때문이다(backend `services/pixabay.py`).
 *
 * 고르면 **서버가 받아 우리 라이브러리에 저장한다.** 바깥 주소를 그대로
 * 문서에 넣으면 폐쇄망 장치에서 표출되지 않고, 원본이 사라지면 화면이
 * 깨진다 — 이 시스템에서 가장 흔한 두 가지 사고다. 주소만 쓰고 싶으면
 * '링크' 탭이 따로 있다.
 *
 * 목록에는 썸네일만 그린다. 본 소재를 24개 늘어놓으면 수십 MB 가 오간다.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import ProgressBar from '@/components/ProgressBar.vue'

const props = defineProps({
  /** 'image' | 'video'. 찾을 갈래를 가른다. */
  kind: { type: String, default: 'image' },
  /**
   * 콘텐츠 방향('LANDSCAPE' | 'PORTRAIT'). 주면 그 방향 이미지만 찾는다 —
   * 세로 화면에 가로 사진을 넣으면 위아래가 잘리거나 띠가 남는다.
   * 동영상에는 적용되지 않는다(제공처가 그 조건을 받지 않는다).
   */
  orientation: { type: String, default: null },
  /** 저장할 기관. 없으면 서버가 고르는 사람의 기관으로 잡는다. */
  orgId: { type: Number, default: null },
  /** 여러 장을 한 번에 고를지(이미지앨범). 켜면 `select-many` 로 올린다. */
  multiple: { type: Boolean, default: false },
})

const emit = defineEmits(['select', 'select-many'])

const { t } = useI18n()

const query = ref('')
const items = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const searched = ref(false)
const error = ref('')
/** null = 아직 확인 전. false 면 키가 없어 검색을 쓸 수 없다. */
const configured = ref(null)
/** 저장 중인 소재. 큰 영상은 몇 초 걸리므로 그 사이를 알려 줘야 한다. */
const saving = ref(null)
/** 결과 칸. 쪽을 넘길 때 맨 위로 되돌리려면 필요하다. */
const resultsEl = ref(null)
/**
 * 여러 장 모드에서 고른 것들. **누른 순서**를 그대로 들고 간다 — 앨범은
 * 순서가 곧 내용이라, 찾은 순서로 담기면 다시 정렬해야 한다.
 *
 * 쪽을 넘겨도 남는다. 한 쪽에서만 고르게 하면 스무 장을 모으려고 창을 여러
 * 번 여닫게 된다.
 */
const chosen = ref([])
/**
 * 담은 것을 받아 저장하는 중의 진행률.
 *
 * `{ done, total }` — 몇 개째인지다. 보낸 양(0~1)은 알 수 없다. 우리가
 * 올리는 것이 아니라 **서버가 제공처에서 받아 오는** 일이라, 브라우저는
 * 그 사이 아무것도 보지 못한다. 그래서 건수로만 센다.
 */
const saveProgress = ref(null)

/** 한 건짜리 저장. 얼마나 남았는지 모르니 흐르는 띠만 보여 준다. */
const savingOne = computed(() => Boolean(saving.value) && saving.value !== 'many')

const PER_PAGE = 24

const isImage = computed(() => props.kind === 'image')

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PER_PAGE)))

const apiOrientation = computed(() => {
  if (!isImage.value) return undefined
  if (props.orientation === 'PORTRAIT') return 'vertical'
  if (props.orientation === 'LANDSCAPE') return 'horizontal'
  return undefined
})

onMounted(async () => {
  // 눌러 보기 전에 쓸 수 있는지 알려 준다. 키가 없으면 검색해 봐야 실패한다.
  try {
    configured.value = (await api.get('/stock/status')).configured
  } catch {
    configured.value = false
  }
})

async function search(pageNumber = 1) {
  const keyword = query.value.trim()
  if (!keyword) return

  loading.value = true
  error.value = ''
  try {
    const result = await api.get('/stock/search', {
      q: keyword,
      kind: props.kind,
      page: pageNumber,
      per_page: PER_PAGE,
      orientation: apiOrientation.value,
    })
    items.value = result.items
    total.value = result.total
    page.value = result.page
    if (resultsEl.value) resultsEl.value.scrollTop = 0
  } catch (err) {
    error.value = err.detail ?? t('stock.searchFailed')
    items.value = []
  } finally {
    searched.value = true
    loading.value = false
  }
}

const keyOf = (hit) => hit.id ?? hit.url

const isChosen = (hit) => chosen.value.some((h) => keyOf(h) === keyOf(hit))

/** 누른 순서에서 몇 번째인지. 순서가 곧 내용이라 번호로 보여 준다. */
const chosenOrder = (hit) => chosen.value.findIndex((h) => keyOf(h) === keyOf(hit)) + 1

/** 한 건을 받아 우리 자산으로 저장하고, 편집기가 쓸 모양으로 만든다. */
async function save(hit) {
  const asset = await api.post('/stock/save', {
    url: hit.url,
    kind: props.kind,
    filename: fileNameFor(hit),
    author: hit.author ?? null,
    page: hit.page ?? null,
    org_id: props.orgId ?? undefined,
  })
  return {
    src: asset.url,
    asset,
    // 출처를 콘텐츠에 남긴다. Pixabay 이용 약관이 표시를 권하고, 나중에
    // 어디서 가져온 것인지 추적할 수단이 이것뿐이다.
    credit: { source: 'pixabay', source_page: hit.page ?? null, author: hit.author ?? null },
    // 원본 크기. 받는 쪽이 이 비율로 상자를 잡는다 — 기본 상자에 그대로
    // 넣으면 세로 소재가 눌려 보인다.
    size: hit.width && hit.height ? { width: hit.width, height: hit.height } : null,
    hit,
  }
}

/**
 * 소재를 고른다.
 *
 * 한 장 모드에서는 누르는 즉시 받아서 올린다. 여러 장 모드에서는 담고 빼기만
 * 하고, 실제로 받는 일은 '추가' 를 누를 때 한다 — 고르는 동안 스무 개를
 * 내려받으면 마음이 바뀌어 뺀 것까지 라이브러리에 쌓인다.
 */
async function pick(hit) {
  if (props.multiple) {
    const at = chosen.value.findIndex((h) => keyOf(h) === keyOf(hit))
    if (at >= 0) chosen.value.splice(at, 1)
    else chosen.value.push(hit)
    return
  }

  if (saving.value) return
  saving.value = keyOf(hit)
  error.value = ''
  try {
    emit('select', await save(hit))
  } catch (err) {
    error.value = err.detail ?? t('stock.saveFailed')
  } finally {
    saving.value = null
  }
}

/**
 * 담아 둔 것을 차례로 받아 저장하고 한 번에 올린다.
 *
 * 하나씩 보내는 이유는 스무 개를 동시에 받으면 제공처와 우리 서버가 함께
 * 막히기 때문이다. 중간에 하나가 실패해도 나머지는 살린다.
 */
async function addChosen() {
  if (saving.value || chosen.value.length === 0) return
  saving.value = 'many'
  error.value = ''
  saveProgress.value = { done: 0, total: chosen.value.length }

  const done = []
  let failed = 0
  let lastError = ''
  try {
    for (const hit of chosen.value) {
      try {
        done.push(await save(hit))
      } catch (err) {
        failed += 1
        lastError = err.detail ?? t('stock.saveFailed')
      }
      saveProgress.value.done = done.length + failed
    }
  } finally {
    saving.value = null
    saveProgress.value = null
  }

  if (failed > 0) error.value = t('stock.savePartial', { failed, message: lastError })
  if (done.length > 0) {
    emit('select-many', done)
    chosen.value = []
  }
}

/** 라이브러리에서 알아볼 이름. 검색어와 태그를 섞어 짧게 만든다. */
function fileNameFor(hit) {
  const tag = String(hit.tags ?? '').split(',')[0].trim()
  const base = tag || query.value.trim() || 'pixabay'
  return `${base}.${isImage.value ? 'jpg' : 'mp4'}`
}

/** "17" -> "0:17". 영상 길이는 초로만 오면 감이 오지 않는다. */
function duration(seconds) {
  const value = Number(seconds) || 0
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}
</script>

<template>
  <div class="stock">
    <!-- 키가 없으면 검색창을 띄워 봐야 매번 실패한다. 무엇을 해야 하는지 알린다. -->
    <p v-if="configured === false" class="notice notice-warn">{{ t('stock.notConfigured') }}</p>

    <template v-else>
      <div class="toolbar">
        <input
          v-model="query"
          class="input search"
          type="search"
          :placeholder="isImage ? t('stock.searchImage') : t('stock.searchVideo')"
          @keyup.enter="search(1)"
        />
        <button class="btn btn-primary" :disabled="loading" @click="search(1)">
          {{ loading ? t('common.loading') : t('common.search') }}
        </button>
        <span v-if="isImage && orientation" class="badge badge-primary">
          {{ t(orientation === 'PORTRAIT' ? 'content.portrait' : 'content.landscape') }}
        </span>
      </div>

      <p class="hint">{{ t('stock.hint') }}</p>
      <p class="error-text" :class="{ blank: !error }">{{ error || ' ' }}</p>

      <!-- 높이를 고정한다. 결과 수에 따라 늘었다 줄었다 하면 쪽을 넘길 때마다
           창 크기가 바뀌고, 다음 버튼이 눈 아래에서 도망간다. -->
      <div ref="resultsEl" class="results" :class="{ busy: loading }">
        <!-- 받는 동안에도 앞 쪽 결과를 그대로 둔다. 지웠다 다시 그리면
             그 사이 화면이 비어 깜빡인다. -->
        <div v-if="items.length" class="grid">
          <button
            v-for="hit in items"
            :key="hit.id ?? hit.url"
            class="tile"
            :class="{ chosen: multiple && isChosen(hit) }"
            type="button"
            :disabled="Boolean(saving) || loading"
            :title="hit.tags ?? ''"
            @click="pick(hit)"
          >
            <!-- 누른 순서를 번호로 보여 준다. 앨범은 순서가 곧 내용이다. -->
            <span v-if="multiple && isChosen(hit)" class="pick-mark">{{ chosenOrder(hit) }}</span>
            <img :src="hit.preview" :alt="hit.tags ?? ''" loading="lazy" />
            <span class="meta">
              <template v-if="saving === (hit.id ?? hit.url)">{{ t('stock.saving') }}</template>
              <template v-else-if="isImage">{{ hit.width }}×{{ hit.height }}</template>
              <template v-else>▶ {{ duration(hit.duration) }}</template>
            </span>
          </button>
        </div>
        <p v-else-if="loading" class="muted pad">{{ t('common.loading') }}</p>
        <p v-else-if="searched" class="table-empty">{{ t('stock.noResults') }}</p>
        <p v-else class="muted pad">{{ t('stock.startHint') }}</p>
      </div>

      <!-- 찾기 전에도 자리를 지킨다. 나타났다 사라지면 그만큼 창이 뛴다. -->
      <div class="pager" :class="{ blank: !searched || !items.length }">
        <button class="btn btn-sm" :disabled="page <= 1 || loading" @click="search(page - 1)">
          {{ t('common.prev') }}
        </button>
        <span class="muted">{{ page }} / {{ pageCount }}</span>
        <button
          class="btn btn-sm"
          :disabled="page >= pageCount || loading"
          @click="search(page + 1)"
        >
          {{ t('common.next') }}
        </button>
        <span class="muted">{{ t('stock.totalCount', { count: total }) }}</span>
      </div>

      <!--
        오래 걸리는 일이다. 스무 장이면 서버가 스무 번 바깥에 다녀온다 —
        아무 말 없이 기다리게 하면 멈춘 줄 알고 다시 누른다.
      -->
      <ProgressBar
        v-if="saveProgress"
        class="save-progress"
        :value="saveProgress.done / saveProgress.total"
        :label="t('stock.saving')"
        :detail="t('stock.savingCount', saveProgress)"
      />
      <ProgressBar
        v-else-if="savingOne"
        class="save-progress"
        :label="t('stock.saving')"
      />

      <!-- 다 고른 뒤 한 번에 담는다. 자리는 늘 지킨다. -->
      <div v-if="multiple" class="picked-bar" :class="{ blank: chosen.length === 0 }">
        <span class="muted">{{ t('stock.chosenCount', { count: chosen.length }) }}</span>
        <button class="btn btn-sm" :disabled="Boolean(saving)" @click="chosen = []">
          {{ t('media.clearPicked') }}
        </button>
        <button class="btn btn-primary btn-sm" :disabled="Boolean(saving)" @click="addChosen">
          {{ t('media.addPicked') }}
        </button>
      </div>

      <!-- Pixabay 이용 약관이 출처 표시를 권한다. -->
      <p class="hint credit">{{ t('stock.credit') }}</p>
    </template>
  </div>
</template>

<style scoped>
.stock {
  display: grid;
  gap: 6px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search {
  flex: 1;
  min-width: 0;
}

.pad {
  padding: 12px;
  font-size: 12px;
}

/*
 * 결과 칸의 높이는 내용과 무관하게 늘 같다. 한 쪽에 24개가 오든 3개가 오든,
 * 아직 찾기 전이든 마찬가지다 — 그래야 쪽을 넘겨도 창이 그대로 있는다.
 */
.results {
  height: 44vh;
  min-height: 240px;
  overflow: auto;
  padding: 4px 2px;
}

/* 다음 쪽을 받는 동안. 앞 쪽 결과를 흐리게 두어 기다리는 중임을 알린다. */
.results.busy {
  opacity: 0.55;
  pointer-events: none;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

/* 자리는 지키되 내용만 감춘다. display:none 이면 그만큼 창이 줄어든다. */
.blank {
  visibility: hidden;
}

.tile {
  position: relative;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: #000;
  overflow: hidden;
  cursor: pointer;
}

.tile:hover {
  border-color: var(--primary);
}

.tile.chosen {
  border-color: var(--primary);
  box-shadow: inset 0 0 0 2px var(--primary);
}

.pick-mark {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 1;
  min-width: 18px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

.save-progress {
  padding: 2px 0;
}

.picked-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  font-size: 12px;
}

/* 자리는 지키되 내용만 감춘다. 생겼다 사라지면 그만큼 창이 뛴다. */
.picked-bar.blank {
  visibility: hidden;
}

.tile:disabled {
  cursor: progress;
  opacity: 0.6;
}

.tile img {
  display: block;
  width: 100%;
  /* 무엇을 고르는지 보이는 최소 크기. 이보다 작으면 비슷한 사진이
     다 같아 보여 열어 보고 지우기를 반복하게 된다. */
  height: 132px;
  object-fit: cover;
}

/* 크기·길이는 그림 위에 얹는다. 아래에 두면 타일 높이가 들쭉날쭉해진다. */
.meta {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgb(0 0 0 / 65%);
  color: #fff;
  font-size: 11px;
}

.pager {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.credit {
  margin: 0;
}
</style>
