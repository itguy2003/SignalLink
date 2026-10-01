/**
 * 장치 제어 채널 암호화 — 서버(app/core/crypto.py · Services/DeviceCrypto.cs)의 짝.
 *
 * 표준 WebCrypto 만 쓴다(요구사항: 모든 클라이언트 스택에서 구현 가능한 방식).
 *   키 유도: HKDF-SHA256(master_key, salt=device_code, info=INFO) -> AES-256-GCM 키
 *   봉투:   base64( VERSION(1) || nonce(12) || ciphertext || tag(16) ), AAD = device_code
 * WebCrypto 의 AES-GCM 출력은 ciphertext||tag 라 서버 형식과 그대로 맞는다.
 */

const ENVELOPE_VERSION = 1
const NONCE_SIZE = 12
const KDF_INFO = 'signallink-device-channel-v1'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class DecryptError extends Error {}

/** 장치 고유번호로부터 대칭키를 유도한다. 서버가 같은 계산을 한다. */
export async function deriveDeviceKey(masterKey, deviceCode) {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(masterKey),
    'HKDF',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(deviceCode),
      info: encoder.encode(KDF_INFO),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function toBase64(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(text) {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** JSON 객체를 암호화해 base64 봉투로. */
export async function encryptForServer(key, deviceCode, payload) {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_SIZE))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: encoder.encode(deviceCode) },
      key,
      encoder.encode(JSON.stringify(payload)),
    ),
  )
  const envelope = new Uint8Array(1 + NONCE_SIZE + ciphertext.length)
  envelope[0] = ENVELOPE_VERSION
  envelope.set(nonce, 1)
  envelope.set(ciphertext, 1 + NONCE_SIZE)
  return toBase64(envelope)
}

/** base64 봉투를 복호화해 JSON 객체로. 실패는 DecryptError 다. */
export async function decryptFromServer(key, deviceCode, token) {
  let envelope
  try {
    envelope = fromBase64(token)
  } catch {
    throw new DecryptError('잘못된 base64 형식')
  }
  if (envelope.length < 1 + NONCE_SIZE + 16) throw new DecryptError('봉투가 너무 짧습니다')
  if (envelope[0] !== ENVELOPE_VERSION) {
    throw new DecryptError(`지원하지 않는 봉투 버전: ${envelope[0]}`)
  }

  const nonce = envelope.slice(1, 1 + NONCE_SIZE)
  const ciphertext = envelope.slice(1 + NONCE_SIZE)
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: encoder.encode(deviceCode) },
      key,
      ciphertext,
    )
    return JSON.parse(decoder.decode(plaintext))
  } catch {
    throw new DecryptError('복호화 실패(키 불일치 또는 변조)')
  }
}
