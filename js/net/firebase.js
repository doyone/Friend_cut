import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getDatabase, ref, get, set, update, remove, push, onValue, onDisconnect, runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { prune } from './prune.js';

export function createFirebaseNet(config) {
  const db = getDatabase(initializeApp(config));
  const r = path => ref(db, path);

  // 노트북마다 시계가 조금씩 달라서, 시간 판정은 전부 Firebase 서버 시각 기준으로 한다.
  let offset = 0;
  onValue(r('.info/serverTimeOffset'), s => { offset = s.val() || 0; });

  return {
    mode: 'firebase',
    now: () => Date.now() + offset,
    get: async path => (await get(r(path))).val(),
    set: (path, value) => set(r(path), prune(value) ?? null),
    update: (path, obj) => update(r(path), Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, prune(v) ?? null]),
    )),
    remove: path => remove(r(path)),
    push: (path, value) => push(r(path), prune(value)).key,
    on: (path, cb) => onValue(r(path), s => cb(s.val())),
    onConnected: cb => onValue(r('.info/connected'), s => cb(!!s.val())),
    onDisconnectRemove: path => onDisconnect(r(path)).remove(),
    async transaction(path, fn) {
      const res = await runTransaction(r(path), cur => {
        const next = fn(cur);
        return next === undefined ? undefined : prune(next);
      });
      return { committed: res.committed, value: res.snapshot.val() };
    },
  };
}
