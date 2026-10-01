<script setup>
/**
 * 이미지·동영상을 고르는 칸.
 *
 * 콘텐츠 편집기가 그림과 영상을 받는 방법은 셋이다.
 *
 *   업로드    파일을 서버에 올린다. 장치가 이미 말을 트고 있는 서버에서
 *             내려받으므로 **바깥으로 못 나가는 망에서도 나온다**.
 *   라이브러리 이미 올려 둔 파일을 다시 쓴다. 같은 그림을 매번 올리면
 *             용량만 늘고, 바꿀 때 여러 콘텐츠를 따로 손대야 한다.
 *   검색      무료 스톡(Pixabay)에서 찾아 **받아서 라이브러리에 넣는다.**
 *             주소만 쓰지 않는 이유는 아래 '링크' 의 단점 그대로다.
 *   링크      바깥 주소를 그대로 쓴다. 준비가 없지만 폐쇄망에서 안 나오고
 *             원본이 사라지면 화면이 깨진다 — 그래서 경고를 함께 띄운다.
 *
 * AI 생성은 아직 없다. 만들어지면 결과물을 자산으로 올려 '업로드' 와 같은
 * 경로를 타게 하면 되므로, 여기에는 탭 하나만 늘면 된다.
 *
 * `multiple` 이면 한 번에 여러 장을 고른다(이미지앨범). 창을 열고 한 장
 * 고르고 닫히기를 스무 번 되풀이하는 것이 앨범을 만드는 일의 전부가 되면
 * 안 된다. 이때는 `select` 대신 `select-many` 로 **한 번에** 올린다 — 한
 * 장씩 여러 번 올리면 받는 쪽이 목록을 그때마다 다시 쓰게 되고, 그 사이에
 * 들어온 것이 덮여 사라진다.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import ProgressBar from '@/components/ProgressBar.vue'
import StockSearch from '@/components/StockSearch.vue'
import { formatBytes } from '@/utils/bytes'

const props = defineProps({
  /** 'image' | 'video'. 받을 파일과 라이브러리 목록을 가른다. */
  kind: { type: String, default: 'image' },
  /** 올릴 기관. 없으면 서버가 올리는 사람의 기관으로 잡는다. */
  orgId: { type: Number, default: null },
  /** 지금 요소에 들어 있는 주소. '링크' 탭을 열 때 채워 준다. */
  current: { type: String, default: '' },
  /** 콘텐츠 방향. 검색에서 그 방향 이미지만 찾는 데 쓴다. */
  orientation: { type: String, default: null },
  /** 여러 장을 한 번에 고를지. 켜면 `select-many` 로 배열을 올린다. */
  multiple: { type: Boolean, default: false },
  /**
   * 자산 출처를 바꿔 끼운다 — `{ list(kind), upload(file, onProgress) }`.
   * 기본은 기관 자산 라이브러리(/assets)지만, 커뮤니티 게시물처럼 제 파일만
   * 쓰는 곳은 그 게시물에 올린 파일을 목록으로 주고 업로드도 그쪽으로 보낸다.
   */
  source: { type: Object, default: null },
})

const emit = defineEmits(['select', 'select-many'])

const { t } = useI18n()

const tab = ref('upload')

// ------------------------------------------------------------ Canva 연동
// 서버가 토큰을 보관한다(/canva/*). 여기서는 연결 팝업을 열고, 연결되면
// 디자인 목록을 보여 주고, 고르면 서버가 PNG 로 내보내 자산으로 저장한다.
const canvaStatus = ref(null) // null=미조회 | {configured, connected}
const canvaDesigns = ref([])
const canvaContinuation = ref(null)
const canvaQuery = ref('')
const canvaLoading = ref(false)
const canvaError = ref('')
const canvaImporting = ref(null) // 가져오는 중인 디자인 id
let canvaPollTimer = null

async function openCanvaTab() {
  tab.value = 'canva'
  if (canvaStatus.value === null) await refreshCanva()
}

async function refreshCanva() {
  canvaError.value = ''
  try {
    canvaStatus.value = await api.get('/canva/status')
    if (canvaStatus.value.connected && canvaDesigns.value.length === 0) await loadCanvaDesigns()
  } catch (err) {
    canvaError.value = err?.detail ?? t('media.loadFailed')
  }
}

/** 연결 팝업을 열고, 콜백이 끝나 연결될 때까지 상태를 되묻는다. */
async function connectCanva() {
  canvaError.value = ''
  try {
    const { url } = await api.post('/canva/authorize')
    window.open(url, 'canva-auth', 'width=540,height=720')
  } catch (err) {
    canvaError.value = err?.detail ?? t('media.loadFailed')
    return
  }
  clearInterval(canvaPollTimer)
  let tries = 0
  canvaPollTimer = setInterval(async () => {
    tries += 1
    if (tries > 60) {
      clearInterval(canvaPollTimer)
      return
    }
    const status = await api.get('/canva/status').catch(() => null)
    if (status?.connected) {
      clearInterval(canvaPollTimer)
      canvaStatus.value = status
      await loadCanvaDesigns()
    }
  }, 2000)
}

async function loadCanvaDesigns(more = false) {
  canvaLoading.value = true
  canvaError.value = ''
  try {
    const page = await api.get('/canva/designs', {
      query: canvaQuery.value || undefined,
      continuation: more ? (canvaContinuation.value ?? undefined) : undefined,
    })
    canvaDesigns.value = more ? [...canvaDesigns.value, ...page.items] : page.items
    canvaContinuation.value = page.continuation ?? null
  } catch (err) {
    canvaError.value = err?.detail ?? t('media.loadFailed')
  } finally {
    canvaLoading.value = false
  }
}

/** 서버가 PNG 로 내보내 자산으로 저장한다 — 여러 장이면 장마다 하나. */
async function importCanva(design) {
  if (canvaImporting.value) return
  canvaImporting.value = design.id
  canvaError.value = ''
  try {
    const created = await api.post('/canva/import', {
      design_id: design.id,
      org_id: props.orgId ?? undefined,
      title: design.title,
    })
    const items = created.map((asset) => ({ src: asset.url, asset }))
    if (props.multiple && items.length > 1) emit('select-many', items)
    else emit('select', items[0])
  } catch (err) {
    canvaError.value = err?.detail ?? t('media.canvaImportFailed')
  } finally {
    canvaImporting.value = null
  }
}

async function disconnectCanva() {
  if (!confirm(t('media.canvaDisconnectConfirm'))) return
  await api.delete('/canva/connection').catch(() => {})
  canvaStatus.value = { ...(canvaStatus.value ?? {}), connected: false }
  canvaDesigns.value = []
}

const assets = ref([])
const loading = ref(false)
const loadError = ref('')
const query = ref('')

const uploading = ref(false)
const uploadError = ref('')
const dragOver = ref(false)
/**
 * 올리는 중의 진행률.
 *
 * `{ done, total, name, ratio }` — 몇 개째인지(done/total), 지금 무엇을
 * 올리는지(name), 그 파일을 얼마나 보냈는지(ratio, 모르면 null)다. 한 장만
 * 올릴 때도 띄운다 — 500MB 동영상은 한 장이어도 오래 걸린다.
 */
const uploadProgress = ref(null)

/**
 * 전체에서 어디까지 왔는가.
 *
 * 끝난 파일 수에 지금 파일의 진행률을 더해 나눈다. 파일 크기가 제각각이라
 * 정확한 비율은 아니지만, '몇 개째'만 보여 주는 것보다는 훨씬 덜 답답하다.
 */
const uploadRatio = computed(() => {
  const at = uploadProgress.value
  if (!at) return null
  if (at.ratio == null) return at.total > 1 ? at.done / at.total : null
  return (at.done + at.ratio) / at.total
})

/**
 * 라이브러리에서 고른 것들(여러 장 모드). **누른 순서**를 그대로 들고 간다 —
 * 앨범은 순서가 곧 내용이라, 목록에 놓인 순서로 담기면 다시 정렬해야 한다.
 */
const picked = ref([])

const link = ref(props.current ?? '')

const isImage = computed(() => props.kind === 'image')

/** 파일 고르기 창에 걸 필터. 서버가 받는 형식과 같아야 헛수고를 안 한다. */
const accept = computed(() => (isImage.value ? 'image/*' : 'video/*'))

/** 여러 장을 받을 수 있으면 그렇게 말해 준다 — 안 쓰면 한 장씩 스무 번 한다. */
const dropLabel = computed(() => (props.multiple ? t('media.dropHereMany') : t('media.dropHere')))

const visibleAssets = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return assets.value
  return assets.value.filter((a) => a.filename.toLowerCase().includes(keyword))
})

async function loadAssets() {
  loading.value = true
  loadError.value = ''
  try {
    // 열 때마다 다시 받는다. 한 번 받아 두면 다른 탭에서 올린 파일이
    // 이 화면에서는 영영 보이지 않는다.
    if (props.source) {
      assets.value = (await props.source.list(props.kind)) ?? []
    } else {
      const page = await api.get('/assets', { kind: props.kind, size: 100 })
      assets.value = page?.items ?? []
    }
  } catch (err) {
    assets.value = []
    // 실패를 '올린 파일이 없습니다' 로 뭉개면 기능이 없는 것처럼 보인다.
    // 특히 서버가 옛 버전이면 404 가 오는데, 그때 화면은 아무 말이 없었다.
    loadError.value =
      err?.status === 404 ? t('media.serverTooOld') : (err?.detail ?? t('media.loadFailed'))
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadAssets()
})

/**
 * 고른 것을 부르는 쪽에 올린다.
 *
 * 여러 장 모드에서도 `select` 를 한 장씩 여러 번 올리지 않는다 — 받는 쪽이
 * 그때마다 목록을 다시 쓰게 되어, 그 사이에 들어온 것이 덮여 사라진다.
 */
function deliver(items) {
  if (items.length === 0) return
  if (props.multiple) emit('select-many', items)
  else emit('select', items[0])
}

async function uploadOne(file, onProgress) {
  if (props.source) {
    const uploaded = await props.source.upload(file, onProgress)
    return { src: uploaded.url, asset: uploaded }
  }
  const form = new FormData()
  form.append('file', file)
  const asset = await api.upload(
    '/assets',
    form,
    props.orgId ? { org_id: props.orgId } : undefined,
    { onProgress },
  )
  return { src: asset.url, asset }
}

/**
 * 고른 파일을 차례로 올린다.
 *
 * 한꺼번에 보내지 않고 하나씩 보내는 이유는 큰 영상 스무 개가 동시에 나가면
 * 서버와 회선이 모두 막히기 때문이다. 대신 몇 개째인지 보여 준다.
 *
 * 중간에 하나가 실패해도 나머지는 살린다 — 스무 장 중 한 장이 형식 때문에
 * 막혔다고 열아홉 장을 다시 고르게 하면 안 된다.
 */
async function uploadFiles(files) {
  const list = Array.from(files ?? []).slice(0, props.multiple ? Infinity : 1)
  if (list.length === 0 || uploading.value) return

  uploading.value = true
  uploadError.value = ''
  uploadProgress.value = { done: 0, total: list.length, name: list[0]?.name ?? '', ratio: 0 }

  const done = []
  let lastError = ''
  let failed = 0
  try {
    for (const file of list) {
      uploadProgress.value = { ...uploadProgress.value, name: file.name, ratio: 0 }
      try {
        done.push(
          await uploadOne(file, (ratio) => {
            // 창을 닫는 등으로 이미 끝난 뒤에 늦게 오는 알림은 버린다.
            if (uploadProgress.value) uploadProgress.value.ratio = ratio
          }),
        )
      } catch (err) {
        failed += 1
        lastError =
          err?.status === 404 ? t('media.serverTooOld') : (err?.detail ?? t('media.uploadFailed'))
      }
      if (uploadProgress.value) {
        uploadProgress.value = {
          ...uploadProgress.value,
          done: done.length + failed,
          ratio: 0,
        }
      }
    }
  } finally {
    uploading.value = false
    uploadProgress.value = null
  }

  if (failed > 0) {
    // 몇 개가 왜 막혔는지 함께 말한다. 실패만 알리면 나머지가 올라갔는지 모른다.
    uploadError.value =
      list.length > 1 ? t('media.uploadPartial', { failed, message: lastError }) : lastError
  }
  // 올리자마자 쓰는 것이 이 흐름의 목적이다. 목록으로 돌려보내지 않는다.
  deliver(done)
}

function onPick(event) {
  uploadFiles(event.target.files)
  // 같은 파일을 다시 고를 수 있어야 한다(잘못 올려 지운 뒤 재시도).
  event.target.value = ''
}

function onDrop(event) {
  event.preventDefault()
  dragOver.value = false
  uploadFiles(event.dataTransfer?.files)
}

function onDragOver(event) {
  // 파일 드롭만 받는다. 캔버스 요소 드래그가 여기로 들어오면 안 된다.
  if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return
  event.preventDefault()
  dragOver.value = true
}

function chooseAsset(asset) {
  // 여러 장 모드에서는 누를 때마다 담고 뺀다. 다 고른 뒤 한 번에 올린다.
  if (!props.multiple) {
    emit('select', { src: asset.url, asset })
    return
  }
  const at = picked.value.indexOf(asset.id)
  if (at >= 0) picked.value.splice(at, 1)
  else picked.value.push(asset.id)
}

const isPicked = (asset) => picked.value.includes(asset.id)

/** 누른 순서에서 몇 번째인지. 순서가 곧 내용이라 번호로 보여 준다. */
const pickedOrder = (asset) => picked.value.indexOf(asset.id) + 1

function addPicked() {
  const byId = new Map(assets.value.map((a) => [a.id, a]))
  deliver(
    picked.value
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((asset) => ({ src: asset.url, asset })),
  )
  picked.value = []
}

function chooseLink() {
  const src = link.value.trim()
  if (!src) return
  deliver([{ src, asset: null }])
}
</script>

<template>
  <div class="media-source">
    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'upload' }" @click="tab = 'upload'">
        {{ t('media.tabUpload') }}
      </button>
      <button class="tab" :class="{ active: tab === 'library' }" @click="tab = 'library'">
        {{ t('media.tabLibrary') }}
      </button>
      <button class="tab" :class="{ active: tab === 'search' }" @click="tab = 'search'">
        {{ t('media.tabSearch') }}
      </button>
      <button
        v-if="kind === 'image'"
        class="tab"
        :class="{ active: tab === 'canva' }"
        data-test="tab-canva"
        @click="openCanvaTab"
      >
        Canva
      </button>
      <button class="tab" :class="{ active: tab === 'link' }" @click="tab = 'link'">
        {{ t('media.tabLink') }}
      </button>
    </div>

    <!-- 업로드 -->
    <div v-if="tab === 'upload'" class="pane">
      <label
        class="drop"
        :class="{ over: dragOver }"
        @dragover="onDragOver"
        @dragleave="dragOver = false"
        @drop="onDrop"
      >
        <input class="file" type="file" :accept="accept" :multiple="multiple" @change="onPick" />
        <span class="drop-icon">{{ isImage ? '🏞' : '🎬' }}</span>
        <span v-if="!uploadProgress">{{ dropLabel }}</span>
        <span class="muted small">{{ t('media.acceptHint') }}</span>

        <!-- 아무 말 없이 기다리게 하면 멈춘 줄 알고 다시 누른다. -->
        <ProgressBar
          v-if="uploadProgress"
          class="upload-progress"
          :value="uploadRatio"
          :label="uploadProgress.name || t('media.uploading')"
          :detail="
            uploadProgress.total > 1
              ? t('media.uploadingCount', {
                  done: uploadProgress.done + 1,
                  total: uploadProgress.total,
                })
              : ''
          "
        />
      </label>

      <p v-if="uploadError" class="error-text">{{ uploadError }}</p>
      <p class="hint">{{ t('media.uploadWhy') }}</p>
    </div>

    <!-- 라이브러리 -->
    <div v-else-if="tab === 'library'" class="pane">
      <div class="row">
        <input v-model="query" class="input" :placeholder="t('media.searchPlaceholder')" />
        <button class="btn btn-sm" :disabled="loading" @click="loadAssets">
          {{ t('common.refresh') }}
        </button>
      </div>

      <p v-if="loading" class="hint">{{ t('common.loading') }}</p>
      <p v-else-if="loadError" class="error-text">{{ loadError }}</p>
      <p v-else-if="assets.length === 0" class="hint">
        {{ t('media.libraryEmpty') }}
      </p>
      <p v-else-if="visibleAssets.length === 0" class="hint">
        {{ t('org.searchNoMatch') }}
      </p>

      <div v-else class="asset-grid">
        <button
          v-for="asset in visibleAssets"
          :key="asset.id"
          class="asset"
          :class="{ picked: multiple && isPicked(asset) }"
          type="button"
          :title="asset.filename"
          @click="chooseAsset(asset)"
        >
          <!-- 누른 순서를 번호로 보여 준다. 앨범은 순서가 곧 내용이다. -->
          <span v-if="multiple && isPicked(asset)" class="pick-mark">{{ pickedOrder(asset) }}</span>
          <img v-if="asset.kind === 'image'" class="asset-thumb" :src="asset.url" alt="" />
          <span v-else class="asset-thumb video">🎬</span>
          <span class="asset-name">{{ asset.filename }}</span>
          <span class="muted small">
            {{ formatBytes(asset.size_bytes) }}
            <template v-if="asset.usage_count">
              · {{ t('media.usedBy', { count: asset.usage_count }) }}
            </template>
          </span>
        </button>
      </div>

      <!-- 다 고른 뒤 한 번에 담는다. 자리는 늘 지킨다(생겼다 사라지면 창이 뛴다). -->
      <div v-if="multiple" class="picked-bar" :class="{ blank: picked.length === 0 }">
        <span class="muted">{{ t('media.pickedCount', { count: picked.length }) }}</span>
        <button class="btn btn-sm" @click="picked = []">
          {{ t('media.clearPicked') }}
        </button>
        <button class="btn btn-primary btn-sm" @click="addPicked">
          {{ t('media.addPicked') }}
        </button>
      </div>
    </div>

    <!-- 검색: 고르면 서버가 받아 라이브러리에 넣는다. -->
    <div v-else-if="tab === 'search'" class="pane">
      <StockSearch
        :kind="kind"
        :orientation="orientation"
        :org-id="orgId"
        :multiple="multiple"
        @select="emit('select', $event)"
        @select-many="emit('select-many', $event)"
      />
    </div>

    <!-- Canva: 계정을 연결해 내 디자인을 자산으로 가져온다. -->
    <div v-else-if="tab === 'canva'" class="pane">
      <p v-if="canvaError" class="error-text">{{ canvaError }}</p>

      <p v-if="canvaStatus && !canvaStatus.configured" class="hint">
        {{ t('media.canvaNotConfigured') }}
      </p>

      <template v-else-if="canvaStatus && !canvaStatus.connected">
        <p class="hint">{{ t('media.canvaConnectHint') }}</p>
        <button class="btn btn-primary" data-test="canva-connect" @click="connectCanva">
          {{ t('media.canvaConnect') }}
        </button>
      </template>

      <template v-else-if="canvaStatus">
        <div class="canva-bar">
          <input
            v-model="canvaQuery"
            class="input"
            :placeholder="t('media.canvaSearch')"
            @keyup.enter="loadCanvaDesigns()"
          />
          <button class="btn btn-sm" @click="loadCanvaDesigns()">{{ t('common.search') }}</button>
          <button class="btn btn-sm" :title="t('media.canvaDisconnect')" @click="disconnectCanva">
            ✕
          </button>
        </div>

        <p v-if="canvaLoading && canvaDesigns.length === 0" class="hint">
          {{ t('common.loading') }}
        </p>
        <p v-else-if="canvaDesigns.length === 0" class="hint">{{ t('media.canvaEmpty') }}</p>

        <div v-else class="asset-grid">
          <button
            v-for="design in canvaDesigns"
            :key="design.id"
            class="asset"
            type="button"
            :disabled="canvaImporting !== null"
            :title="design.title"
            data-test="canva-design"
            @click="importCanva(design)"
          >
            <img v-if="design.thumbnail_url" class="asset-thumb" :src="design.thumbnail_url" alt="" />
            <span v-else class="asset-thumb">🎨</span>
            <span class="asset-name">{{ design.title }}</span>
            <span v-if="canvaImporting === design.id" class="muted small">
              {{ t('media.canvaImporting') }}
            </span>
          </button>
        </div>

        <button
          v-if="canvaContinuation"
          class="btn btn-sm"
          :disabled="canvaLoading"
          @click="loadCanvaDesigns(true)"
        >
          {{ t('media.canvaMore') }}
        </button>
      </template>
    </div>

    <!-- 링크 -->
    <div v-else class="pane">
      <div class="field">
        <label>{{ t('canvas.sourceUrl') }}</label>
        <input v-model="link" class="input" placeholder="https://…" @keyup.enter="chooseLink" />
      </div>
      <button class="btn btn-primary block" :disabled="!link.trim()" @click="chooseLink">
        {{ t('media.useLink') }}
      </button>

      <!-- 폐쇄망에서 안 나오는 것이 가장 흔한 사고다. -->
      <p class="hint warn">{{ t('media.externalWarning') }}</p>
    </div>
  </div>
</template>

<style scoped>
.media-source {
  display: grid;
  gap: 8px;
  min-height: 0;
}

.upload-progress {
  width: 100%;
  max-width: 320px;
  /* 막대를 누르면 파일 고르기 창이 또 열린다. 올리는 중에는 막는다. */
  pointer-events: none;
}

.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.tab {
  padding: 7px 14px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.tab.active {
  border-bottom-color: var(--primary);
  color: var(--primary);
  font-weight: 700;
}

.pane {
  display: grid;
  gap: 10px;
}

.row {
  display: flex;
  gap: 6px;
}

.row .input {
  flex: 1;
  min-width: 0;
}

/* 파일 고르기와 끌어다 놓기를 한 자리에 둔다. */
.drop {
  display: grid;
  place-items: center;
  gap: 6px;
  padding: 28px 12px;
  border: 2px dashed var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  font-size: 13px;
  text-align: center;
  cursor: pointer;
}

.drop.over {
  border-color: var(--primary);
  color: var(--primary);
}

.drop-icon {
  font-size: 28px;
  line-height: 1;
}

.file {
  display: none;
}

.small {
  font-size: 11px;
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px;
  max-height: 44vh;
  overflow-y: auto;
}

.pick-mark {
  position: absolute;
  top: 3px;
  right: 3px;
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

.asset.picked {
  border-color: var(--primary);
  box-shadow: inset 0 0 0 1px var(--primary);
}

.picked-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 6px;
  font-size: 12px;
}

/* 자리는 지키되 내용만 감춘다. 생겼다 사라지면 그만큼 창이 뛴다. */
.picked-bar.blank {
  visibility: hidden;
}

/* 고른 것은 테두리와 번호로 표시한다. 흐리게만 하면 고른 것인지 못 고르는
   것인지 헷갈린다. */
.asset {
  position: relative;
  display: grid;
  gap: 3px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.asset:hover {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.asset-thumb {
  display: grid;
  place-items: center;
  width: 100%;
  height: 74px;
  border-radius: 4px;
  background: #000;
  object-fit: contain;
  font-size: 26px;
}

.asset-name {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.block {
  width: 100%;
}

.warn {
  color: var(--warning);
}

.canva-bar {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.canva-bar .input {
  flex: 1;
}
</style>
