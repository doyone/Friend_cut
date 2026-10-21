// Firebase는 undefined를 거부하고 null/빈 객체는 저장하지 않는다.
// 두 백엔드가 똑같이 동작하도록 쓰기 전에 값을 정리한다.
export function prune(v) {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number' && !Number.isFinite(v)) return undefined;
  if (Array.isArray(v)) {
    const a = v.map(x => prune(x) ?? null);
    return a.some(x => x !== null) ? a : undefined;
  }
  if (typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      const y = prune(x);
      if (y !== undefined) o[k] = y;
    }
    return Object.keys(o).length ? o : undefined;
  }
  return v;
}
