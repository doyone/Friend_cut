// 로컬 테스트용 백엔드: 같은 컴퓨터의 브라우저 탭끼리 localStorage로 통신한다.
// Firebase처럼 값을 '경로 → 끝값' 단위로 쪼개 저장해서, 서로 다른 경로에 쓰는 탭끼리
// 덮어쓰지 않고, 배열/빈 값 처리도 Firebase와 똑같이 맞춘다.
import { prune } from './prune.js';
import { randId } from '../util.js';

const P = 'fcg:';
const HB = 'fcg-hb:';  // 탭 생존 신호
const STALE_MS = 90000;
const norm = path => String(path).split('/').filter(Boolean).join('/');

function storedKeys() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(P)) out.push(k);
  }
  return out;
}

// Firebase 규칙: 키가 전부 0 이상의 정수이고 절반 이상 차 있으면 배열로 돌려준다.
function toArrays(v) {
  if (v === null || typeof v !== 'object') return v;
  for (const k of Object.keys(v)) v[k] = toArrays(v[k]);
  const ks = Object.keys(v);
  if (ks.length && ks.every(k => /^(0|[1-9]\d*)$/.test(k))) {
    const max = Math.max(...ks.map(Number));
    if (max < ks.length * 2) return Array.from({ length: max + 1 }, (_, i) => v[i] ?? null);
  }
  return v;
}

function read(path) {
  path = norm(path);
  if (path) {
    const exact = localStorage.getItem(P + path);
    if (exact != null) return JSON.parse(exact);
  }
  const pre = path ? `${P}${path}/` : P;
  let root = null;
  for (const k of storedKeys()) {
    if (!k.startsWith(pre)) continue;
    const parts = k.slice(pre.length).split('/');
    root ??= {};
    let o = root;
    for (let i = 0; i < parts.length - 1; i++) o = (o[parts[i]] ??= {});
    o[parts[parts.length - 1]] = JSON.parse(localStorage.getItem(k));
  }
  return toArrays(root);
}

function clear(path) {
  write(path, null);
}

function collectLeaves(path, v, out) {
  if (v === undefined) return;
  if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) collectLeaves(`${path}/${k}`, x, out);
  } else {
    out.set(P + path, JSON.stringify(v));
  }
}

// 바뀐 키만 먼저 쓰고, 없어진 키는 마지막에 지운다. 그래서 다른 탭이 쓰는 도중에 읽어도
// 계속 있는 값이 잠깐 사라져 보이는 일이 없다.
function write(path, value) {
  path = norm(path);
  const leaves = new Map();
  collectLeaves(path, prune(value), leaves);
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) localStorage.removeItem(P + parts.slice(0, i).join('/'));
  for (const [k, v] of leaves) if (localStorage.getItem(k) !== v) localStorage.setItem(k, v);
  const pre = `${P}${path}/`;
  for (const k of storedKeys()) {
    if ((k === P + path || k.startsWith(pre)) && !leaves.has(k)) localStorage.removeItem(k);
  }
}

export function createLocalNet() {
  const listeners = new Set();
  let scheduled = false;

  // 여러 키가 연달아 바뀌는 동안 반쯤 바뀐 상태를 읽지 않도록 조금 모아서 알린다.
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(flush, 15);
  }
  function flush() {
    scheduled = false;
    for (const l of listeners) {
      const v = read(l.path);
      const s = JSON.stringify(v);
      if (s === l.last) continue;
      l.last = s;
      try { l.cb(v); } catch (e) { console.error(e); }
    }
  }
  window.addEventListener('storage', e => {
    if (e.key === null || e.key.startsWith(P)) schedule();
  });

  const leaving = new Set();
  window.addEventListener('pagehide', () => {
    for (const path of leaving) clear(norm(path));
    localStorage.removeItem(HB + TAB);
  });

  // 탭이 갑자기 닫히면 pagehide가 안 올 때가 있다. Firebase의 '접속 끊김 자동 삭제'처럼
  // 탭마다 2초마다 살아 있다고 적고, 오래 소식 없는 탭이 맡은 경로는 다른 탭이 지운다.
  // (숨겨진 탭은 브라우저가 타이머를 1분까지 늦추므로 넉넉하게 90초)
  const TAB = randId(8);
  const connected = new Set();
  const beat = () => localStorage.setItem(HB + TAB, JSON.stringify({ t: Date.now(), paths: [...leaving] }));
  function reap() {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(HB) || k === HB + TAB) continue;
      let v = null;
      try { v = JSON.parse(localStorage.getItem(k)); } catch { /* 깨진 값은 지운다 */ }
      if (v && Date.now() - v.t < STALE_MS) continue;
      for (const path of v?.paths || []) clear(norm(path));
      localStorage.removeItem(k);
      schedule();
    }
  }
  setInterval(() => { beat(); reap(); }, 2000);
  // 다시 화면에 나타나면 '재접속'으로 보고 내 정보를 다시 등록하게 한다
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    beat();
    for (const cb of connected) cb(true);
  });

  let pushSeq = 0;
  const locked = fn => (navigator.locks ? navigator.locks.request('fcg-local-db', async () => fn()) : Promise.resolve(fn()));

  return {
    mode: 'local',
    now: () => Date.now(),
    get: async path => read(path),
    async set(path, value) { write(path, value); schedule(); },
    async update(path, obj) {
      for (const [k, v] of Object.entries(obj)) write(`${norm(path)}/${k}`, v);
      schedule();
    },
    async remove(path) { clear(norm(path)); schedule(); },
    push(path, value) {
      const key = Date.now().toString(36).padStart(9, '0') + (pushSeq++ % 1296).toString(36).padStart(2, '0') + randId(4);
      write(`${norm(path)}/${key}`, value);
      schedule();
      return key;
    },
    on(path, cb) {
      const l = { path, cb, last: undefined };
      listeners.add(l);
      schedule();
      return () => listeners.delete(l);
    },
    onConnected(cb) {
      connected.add(cb);
      setTimeout(() => cb(true), 0);
      return () => connected.delete(cb);
    },
    async onDisconnectRemove(path) {
      leaving.add(path);
      beat();
    },
    transaction: (path, fn) => locked(() => {
      const cur = read(path);
      const next = fn(cur);
      if (next === undefined) return { committed: false, value: cur };
      write(path, next);
      schedule();
      return { committed: true, value: next };
    }),
  };
}
