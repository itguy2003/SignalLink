<script setup>
/**
 * QR 코드 그림 — 주소·문구를 받아 그 자리에서 그린다.
 *
 * `qrcode-generator` 는 순수 JS 라 서버도 외부 API 도 필요 없다(폐쇄망 OK).
 * 플레이어(브라우저·WPF WebView2)와 편집기 미리보기가 같은 코드를 쓴다.
 */
import { computed } from 'vue'
import qrcode from 'qrcode-generator'

const props = defineProps({
  /** QR 에 담을 주소나 문구. */
  text: { type: String, required: true },
  /** 셀 하나의 픽셀 크기 — 클수록 큰 그림. */
  cellSize: { type: Number, default: 8 },
})

const dataUrl = computed(() => {
  try {
    // 타입 0 = 내용 길이에 맞춰 자동. 'M' 은 일반 인쇄물 수준의 오류 복원.
    const qr = qrcode(0, 'M')
    qr.addData(props.text)
    qr.make()
    return qr.createDataURL(props.cellSize, 2)
  } catch {
    // 담을 수 없는 내용(과도한 길이 등)이면 빈 그림 — 표출은 계속돼야 한다.
    return ''
  }
})
</script>

<template>
  <img v-if="dataUrl" :src="dataUrl" alt="QR" class="qr" draggable="false" />
</template>

<style scoped>
.qr {
  image-rendering: pixelated;
  background: #fff;
}
</style>
