/**
 * 장치 채널 암호화 테스트.
 *
 * 서버(app/core/crypto.py)와 같은 계약이다: HKDF-SHA256 키 유도 +
 * AES-256-GCM, 봉투 = base64(VERSION||nonce||ct||tag), AAD = 장치 고유번호.
 * 여기서는 왕복과 거부(다른 장치·변조·형식)를 못박는다.
 */
import { describe, expect, it } from 'vitest'

import {
  DecryptError,
  decryptFromServer,
  deriveDeviceKey,
  encryptForServer,
} from './deviceCrypto'

const MASTER = 'test-master-key'
const CODE = 'ABCD-234-EFG'

describe('장치 채널 봉투', () => {
  it('암호화한 봉투를 같은 키로 되돌린다', async () => {
    const key = await deriveDeviceKey(MASTER, CODE)
    const envelope = await encryptForServer(key, CODE, { type: 'heartbeat', n: 5 })

    const opened = await decryptFromServer(key, CODE, envelope)
    expect(opened).toEqual({ type: 'heartbeat', n: 5 })
  })

  it('봉투 형식이 계약대로다 — VERSION(1)+nonce(12)+본문+tag(16)', async () => {
    const key = await deriveDeviceKey(MASTER, CODE)
    const envelope = await encryptForServer(key, CODE, { a: 1 })
    const raw = Uint8Array.from(atob(envelope), (ch) => ch.charCodeAt(0))

    expect(raw[0]).toBe(1)
    // {"a":1} = 7바이트 평문.
    expect(raw.length).toBe(1 + 12 + 7 + 16)
  })

  it('다른 장치 고유번호로는 열리지 않는다', async () => {
    // 키 유도(salt)와 AAD 둘 다 고유번호다 — 봉투를 가로채도 못 쓴다.
    const key = await deriveDeviceKey(MASTER, CODE)
    const other = await deriveDeviceKey(MASTER, 'ZZZZ-999-999')
    const envelope = await encryptForServer(key, CODE, { a: 1 })

    await expect(decryptFromServer(other, 'ZZZZ-999-999', envelope)).rejects.toThrow(DecryptError)
  })

  it('변조된 봉투는 거부한다', async () => {
    const key = await deriveDeviceKey(MASTER, CODE)
    const raw = Uint8Array.from(atob(await encryptForServer(key, CODE, { a: 1 })), (ch) =>
      ch.charCodeAt(0),
    )
    raw[raw.length - 1] ^= 0xff
    const tampered = btoa(String.fromCharCode(...raw))

    await expect(decryptFromServer(key, CODE, tampered)).rejects.toThrow(DecryptError)
  })

  it('깨진 형식은 형식 오류로 거부한다', async () => {
    const key = await deriveDeviceKey(MASTER, CODE)
    await expect(decryptFromServer(key, CODE, '!!not-base64!!')).rejects.toThrow(DecryptError)
    await expect(decryptFromServer(key, CODE, btoa('short'))).rejects.toThrow(DecryptError)
  })
})
