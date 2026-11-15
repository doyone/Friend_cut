import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PLAYERS, RoomSession, playingIds } from '../js/room.js';
import { prune } from '../js/net/prune.js';

const tick = () => new Promise(r => setTimeout(r, 5));

// 메모리 안의 가짜 Firebase: 경로 트리 + 바뀌면 그 경로를 듣는 사람에게 알림 (null·빈 값은 저장 안 함)
function fakeNet() {
  const root = {};
  const listeners = new Set();
  const keys = p => String(p).split('/').filter(Boolean);
  const read = p => {
    let o = root;
    for (const k of keys(p)) {
      if (o == null || typeof o !== 'object') return null;
      o = o[k];
    }
    return o === undefined ? null : structuredClone(o);
  };
  const write = (p, v) => {
    const ks = keys(p);
    const val = prune(v);
    let o = root;
    const trail = [];
    for (const k of ks.slice(0, -1)) {
      if (o[k] == null || typeof o[k] !== 'object') {
        if (val === undefined) return;
        o[k] = {};
      }
      trail.push([o, k]);
      o = o[k];
    }
    if (val === undefined) delete o[ks.at(-1)];
    else o[ks.at(-1)] = structuredClone(val);
    for (const [parent, k] of trail.reverse()) if (!Object.keys(parent[k]).length) delete parent[k];
  };
  let queued = false;
  const notify = () => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      for (const l of listeners) {
        const v = read(l.path);
        const s = JSON.stringify(v);
        if (s === l.last) continue;
        l.last = s;
        l.cb(v);
      }
    }, 0);
  };
  let seq = 0;
  return {
    peek: read,
    now: () => Date.now(),
    get: async p => read(p),
    async set(p, v) { write(p, v); notify(); },
    async update(p, obj) {
      for (const [k, v] of Object.entries(obj)) write(`${p}/${k}`, v);
      notify();
    },
    async remove(p) { write(p, null); notify(); },
    push(p, v) {
      const k = `k${String(seq++).padStart(6, '0')}`;
      write(`${p}/${k}`, v);
      notify();
      return k;
    },
    on(path, cb) {
      const l = { path, cb, last: undefined };
      listeners.add(l);
      notify();
      return () => listeners.delete(l);
    },
    onConnected(cb) {
      setTimeout(() => cb(true), 0);
      return () => {};
    },
    async onDisconnectRemove() {},
    async transaction(p, fn) {
      const cur = read(p);
      const next = fn(cur);
      if (next === undefined) return { committed: false, value: cur };
      write(p, next);
      notify();
      return { committed: true, value: next };
    },
  };
}

async function makeRoom(net, players = {}) {
  await net.set('rooms/ABCD/meta', { hostId: 'host', status: 'lobby', game: 'timer', createdAt: 1 });
  for (const [id, p] of Object.entries(players)) await net.set(`rooms/ABCD/players/${id}`, p);
}

function session(net, id, name, opts) {
  const s = new RoomSession(net, 'ABCD', name);
  s.id = id; // 탭마다 다른 사람 (테스트에선 직접 정함)
  return s.enter(opts).then(() => s);
}

const filler = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, { name: `p${i}`, color: '#2ecc71', joinedAt: 10 + i }]));

test('강퇴: 방장이 내보내면 그 사람 화면이 바로 나가고, 같은 탭으로는 다시 못 들어온다', async () => {
  const net = fakeNet();
  await makeRoom(net);
  const host = await session(net, 'host', '방장');
  const guest = new RoomSession(net, 'ABCD', '지우');
  guest.id = 'g1';
  let kicked = 0;
  guest.onKicked = () => { kicked++; };
  await guest.enter();
  await tick();
  assert.ok(host.snap.players.g1, '들어와 있다');
  host.vote('timer');
  guest.vote('bomb');
  await tick();

  assert.equal(await host.kick('g1'), '지우');
  await tick();
  assert.equal(kicked, 1, '내 화면이 강퇴를 알아챘다');
  assert.equal(net.peek('rooms/ABCD/players/g1'), null, '방에서 지워졌다');
  assert.equal(net.peek('rooms/ABCD/votes/g1'), null, '투표도 지워졌다');
  assert.ok(Object.values(net.peek('rooms/ABCD/chat')).some(m => m.sys && m.text.includes('강퇴')), '채팅에 알림');

  // 노트북을 다시 열어 재접속 신호가 와도 슬쩍 다시 들어가지 않는다
  await guest.announce();
  await tick();
  assert.equal(net.peek('rooms/ABCD/players/g1'), null);
  assert.equal(kicked, 1, '한 번만 알린다');

  // 같은 탭(같은 id)으로 코드를 다시 쳐도 막힌다
  const again = new RoomSession(net, 'ABCD', '지우');
  again.id = 'g1';
  await assert.rejects(again.enter(), /강퇴/);
  assert.equal(net.peek('rooms/ABCD/players/g1'), null);
});

test('강퇴: 나 자신·없는 사람은 못 내보내고, 봇은 그냥 빠진다', async () => {
  const net = fakeNet();
  await makeRoom(net, { bot1: { name: '감자봇', bot: true, color: '#3498db', joinedAt: 5 } });
  const host = await session(net, 'host', '방장');
  await tick();
  assert.equal(await host.kick('host'), null);
  assert.equal(await host.kick('nobody'), null);
  assert.equal(await host.kick('bot1'), '감자봇');
  await tick();
  assert.equal(net.peek('rooms/ABCD/players/bot1'), null);
  assert.equal(net.peek('rooms/ABCD/kicked'), null, '봇은 강퇴 명단에 안 남는다');
});

test('관전: 참가 자리(8명)가 꽉 차면 관전으로 들어오고, 자리가 나면 참가로 바꿀 수 있다', async () => {
  const net = fakeNet();
  await makeRoom(net, filler(MAX_PLAYERS));
  const late = await session(net, 'late', '늦음');
  await tick();
  assert.equal(late.full, true, '꽉 차서 관전으로');
  assert.equal(late.watching, true);
  assert.equal(net.peek('rooms/ABCD/players/late').watch, true);
  assert.equal(playingIds(net.peek('rooms/ABCD/players')).length, MAX_PLAYERS, '관전하는 사람은 참가자 수에 안 센다');
  await assert.rejects(late.setWatch(false), /참가 자리가 꽉/);

  await net.remove('rooms/ABCD/players/p0');
  await tick();
  assert.equal(await late.setWatch(false), true);
  await tick();
  assert.equal(late.watching, false);
  assert.equal(net.peek('rooms/ABCD/players/late').watch, undefined, '관전 표시가 지워졌다');
  assert.equal(playingIds(net.peek('rooms/ABCD/players')).length, MAX_PLAYERS);
});

test('관전: 처음부터 관전으로 들어올 수 있고, 관전으로 바꾸면 투표가 지워지고 채팅에 👀 표시', async () => {
  const net = fakeNet();
  await makeRoom(net);
  await session(net, 'host', '방장');
  const fan = await session(net, 'fan', '구경', { watch: true });
  await tick();
  assert.equal(fan.watching, true);
  assert.equal(fan.full, false);
  fan.chat('ㅋㅋㅋ');
  await tick();
  assert.ok(Object.values(net.peek('rooms/ABCD/chat')).some(m => m.pid === 'fan' && m.watch), '관전하는 사람 채팅엔 watch 표시');

  const p = await session(net, 'p1', '지우');
  p.vote('bomb');
  await tick();
  assert.equal(await p.setWatch(true), true);
  await tick();
  assert.equal(net.peek('rooms/ABCD/votes/p1'), null, '관전으로 바꾸면 투표는 지운다');
  assert.equal(await p.setWatch(true), false, '이미 관전이면 그대로');
});

test('관전: 방장이 관전으로 보내면 그 사람이 재접속해도 관전으로 남는다', async () => {
  const net = fakeNet();
  await makeRoom(net);
  const host = await session(net, 'host', '방장');
  const afk = await session(net, 'afk', '잠수');
  await tick();
  assert.equal(await host.setWatch(true, 'afk'), true);
  await tick();
  assert.equal(afk.watching, true, '내 정보도 관전으로 맞춰진다');
  await afk.announce(); // 와이파이가 끊겼다 붙어서 다시 등록
  await tick();
  assert.equal(net.peek('rooms/ABCD/players/afk').watch, true, '옛 정보로 덮어써서 참가로 돌아가지 않는다');
});

test('관전: 참가로 돌아올 때 그새 다른 사람이 내 색을 쓰고 있으면 남는 색으로 바꾼다', async () => {
  const net = fakeNet();
  await makeRoom(net, { a: { name: '가', color: '#ff7ad9', joinedAt: 1 } });
  const w = await session(net, 'w', '나', { watch: true });
  await tick();
  // 관전하는 동안 같은 색을 받은 사람이 들어온 상황
  await net.update('rooms/ABCD/players/w', { color: '#ff7ad9' });
  await tick();
  await w.setWatch(false);
  await tick();
  const mine = net.peek('rooms/ABCD/players/w').color;
  assert.notEqual(mine, '#ff7ad9');
  assert.equal(w.me.color, mine, '재접속할 때도 바뀐 색으로');
});

test('봇 추가는 참가 자리만 센다: 관전하는 사람이 있어도 8명까지 채울 수 있다', async () => {
  const net = fakeNet();
  await makeRoom(net, filler(MAX_PLAYERS - 1));
  const host = await session(net, 'host', '방장', { watch: true });
  await session(net, 'w2', '구경', { watch: true });
  await tick();
  assert.equal(playingIds(host.snap.players).length, MAX_PLAYERS - 1);
  await host.addBot();
  await tick();
  assert.equal(playingIds(host.snap.players).length, MAX_PLAYERS);
  await assert.rejects(host.addBot(), /꽉/);
});
