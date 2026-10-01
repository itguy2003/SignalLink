/**
 * vitest 공통 셋업.
 *
 * node 26부터 전역에 자체 localStorage **접근자**가 생겼고(파일 저장소 플래그
 * 없이는 undefined 를 돌려준다), vitest 의 jsdom 환경은 "이미 있는 전역은
 * 덮지 않는" 규칙이라 그 접근자가 jsdom 의 저장소를 가린다 — 테스트마다
 * `localStorage.removeItem` 이 undefined 로 터진다.
 *
 * 그래서 여기서 스펙 호환 인메모리 저장소를 명시적으로 세운다. 테스트가
 * 필요로 하는 것은 브라우저와 같은 동작이지 실제 영속성이 아니다.
 * (node 24 이하 + jsdom 조합에서는 이미 저장소가 있어 아무 일도 하지 않는다.)
 */
class MemoryStorage {
  #data = new Map()

  get length() {
    return this.#data.size
  }

  key(index) {
    return [...this.#data.keys()][index] ?? null
  }

  getItem(key) {
    return this.#data.has(String(key)) ? this.#data.get(String(key)) : null
  }

  setItem(key, value) {
    this.#data.set(String(key), String(value))
  }

  removeItem(key) {
    this.#data.delete(String(key))
  }

  clear() {
    this.#data.clear()
  }
}

for (const name of ['localStorage', 'sessionStorage']) {
  let current
  try {
    current = globalThis[name]
  } catch {
    current = undefined
  }
  if (!current) {
    Object.defineProperty(globalThis, name, { value: new MemoryStorage(), configurable: true })
  }
}
