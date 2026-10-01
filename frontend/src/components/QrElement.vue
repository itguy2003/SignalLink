<script setup>
/**
 * QR코드 요소.
 *
 * 문서에는 내용(text)과 색만 저장하고, 그림은 그리는 쪽이 만든다 — QR 은
 * 표준 규격이라 어느 플레이어 스택(JS/.NET/Flutter)에서든 같은 입력이면
 * 같은 코드가 나온다. 브라우저(편집기·미리보기·테스트 플레이어)에서는
 * qrcode 라이브러리로 데이터 URL 을 만들어 이미지로 얹는다.
 *
 * 내용이 비거나 만들기에 실패하면 자리 표시만 남긴다 — 빈 QR 을 그럴듯하게
 * 그려 두면 장치에 올라가서야 스캔이 안 된다는 것을 알게 된다.
 */
import QRCode from 'qrcode'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  /** 스캔하면 열릴 내용 — 주소(URL)나 짧은 글. */
  text: { type: String, default: '' },
  foreground: { type: String, default: '#000000' },
  background: { type: String, default: '#ffffff' },
})

const { t } = useI18n()
const dataUrl = ref(null)

watch(
  () => [props.text, props.foreground, props.background],
  async () => {
    const text = props.text?.trim()
    if (!text) {
      dataUrl.value = null
      return
    }
    try {
      // SVG 로 만든다 — 캔버스가 필요 없고(어느 환경에서든 같은 결과),
      // 확대해도 또렷해 큰 화면(사이니지)에 유리하다.
      const svg = await QRCode.toString(text, {
        type: 'svg',
        margin: 1,
        color: { dark: props.foreground, light: props.background },
      })
      dataUrl.value = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
    } catch {
      dataUrl.value = null
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="qr" :style="{ background }">
    <img v-if="dataUrl" :src="dataUrl" class="qr-img" alt="QR" draggable="false" />
    <div v-else class="qr-empty">
      <span aria-hidden="true">🔳</span>
      <span class="qr-hint">{{ t('canvas.qrEmpty') }}</span>
    </div>
  </div>
</template>

<style scoped>
.qr {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  overflow: hidden;
}

/* QR 은 정사각형이어야 스캔된다 — 상자가 길쭉해도 코드는 안 늘린다. */
.qr-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.qr-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: #666;
  font-size: 12px;
}

.qr-empty span[aria-hidden] {
  font-size: 28px;
}
</style>
