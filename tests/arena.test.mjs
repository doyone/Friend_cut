import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS, RELICS, HP_MAX, REVIVE_HP, LIVES, ENERGY, HAND_START, HAND_MAX, CROWD,
  setup, onInput, tick, bot, attackOf, energyOf, offerOf, drawCard, rageOf,
} from '../js/games/arena-core.js';

function newGame(n = 3) {
  let clock = 1_000_000;
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const kills = [];
  const priv = {};
  const ctx = {
    roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id,
    setPrivate: (id, d) => { priv[id] = d; }, announce: () => {}, kill: (a, b) => kills.push(`${a}>${b}`),
  };
  ctx.state = { ...setup(ctx), roster };
  let uid = 1000;
  const g = {
    ctx, kills, priv,
    get S() { return ctx.state; },
    tick: (ms = 50) => { clock += ms; return tick(ctx); },
    until(fn, max = 6000) {
      for (let i = 0; i < max && !fn(ctx.state); i++) g.tick();
      assert.ok(fn(ctx.state), `기다리던 상태가 안 옴 (지금 ${ctx.state.phase})`);
    },
    // 손패를 직접 정한다. 돌려주는 건 카드 번호(u)들
    hand(id, keys) {
      const hand = keys.map(k => ({ u: ++uid, k }));
      ctx.secret.hands = { ...ctx.secret.hands, [id]: hand };
      ctx.state.cards = { ...ctx.state.cards, [id]: hand.length };
      return hand.map(c => c.u);
    },
    handOf: id => (ctx.secret.hands?.[id] || []).map(c => c.k),
    plan: (pid, t, c = [], ready = true) => onInput(ctx, { pid, type: 'plan', data: { round: ctx.state.round, t, c, ready, at: clock } }),
    def: (pid, c = []) => onInput(ctx, { pid, type: 'def', data: { round: ctx.state.round, c, ready: true } }),
    // 모두 아무 유물이나 고르고 첫 공격 단계까지
    start() {
      g.until(S => S.phase === 'pick');
      for (const p of roster) onInput(ctx, { pid: p.id, type: 'pick', data: { no: 0, relic: ctx.state.pick.offers[p.id][0] } });
      g.until(S => S.phase === 'attack');
      ctx.state.relics = {}; // 시험마다 유물은 직접 정한다
      ctx.state.lives = Object.fromEntries(roster.map(p => [p.id, LIVES]));
      for (const p of roster) g.hand(p.id, []);
      return g;
    },
    // 한 턴을 끝까지 (공격 계획은 이미 넣었다고 보고, 방어는 fn에서)
    resolve(defend = () => {}) {
      g.until(S => S.phase === 'defend' || S.phase === 'resolve');
      if (ctx.state.phase === 'defend') {
        defend();
        for (const p of roster) if (ctx.state.alive.includes(p.id) && !ctx.state.ready2?.[p.id]) g.def(p.id, []);
        g.until(S => S.phase === 'resolve');
      }
      return ctx.state.rs;
    },
  };
  return g;
}

test('구성: 카드·유물·처음 손패', () => {
  for (const [k, c] of Object.entries(CARDS)) assert.ok(['w', 'd', 't'].includes(c.type) && c.cost >= 0 && c.w > 0 && c.name, k);
  assert.equal(Object.values(RELICS).filter(r => r.tier === 0).length, 8);
  for (let i = 0; i < 50; i++) assert.equal(CARDS[drawCard(Math.random, 'd')].type, 'd');
  assert.deepEqual([1, 8, 12, 16].map(rageOf), [1, 1.25, 1.5, 2]);
  const g = newGame(4);
  g.until(S => S.phase === 'pick');
  for (const p of g.ctx.roster) {
    const hand = g.handOf(p.id);
    assert.equal(hand.length, HAND_START);
    assert.ok(hand.some(k => CARDS[k].type === 'w') && hand.some(k => CARDS[k].type === 'd'), '무기와 방어가 하나씩은 있다');
    assert.equal(g.S.pick.offers[p.id].length, 3);
    assert.ok(g.S.pick.offers[p.id].every(r => RELICS[r].tier === 0), '처음은 전투 스타일');
  }
  assert.equal(offerOf({ relics: { a: ['sand'] } }, 'a', 3).includes('sand'), false);
});

test('먼저 준비한 사람이 먼저 때리고, 먼저 쓰러진 사람의 공격은 안 나간다', () => {
  const g = newGame(3).start();
  const S = g.S;
  S.hp.p1 = 10;
  const [axe] = g.hand('p0', ['axe']);
  const [sword] = g.hand('p1', ['sword']);
  g.plan('p0', 'p1', [axe]);
  g.tick(100);
  g.plan('p1', 'p0', [sword]);
  g.plan('p2', null, []);
  const rs = g.resolve();
  assert.deepEqual(rs.filter(e => e.k !== 'def').map(e => e.k), ['hit', 'cancel']);
  assert.equal(S.hp.p0, HP_MAX, '쓰러진 p1의 장검은 안 나갔다');
  assert.equal(S.lives.p1, LIVES - 1);
  assert.equal(S.revenge.p1, 'p0', '복수 표식');
  g.until(s => s.phase === 'attack');
  assert.equal(S.hp.p1, REVIVE_HP, '다음 턴에 일어난다');
  assert.equal(attackOf(S, 'p1', 'p0', ['sword']).dmg, Math.round(7 * 1.25), '복수 표식 +25%');
});

test('기력은 공격에 쓰고 남은 만큼만 방어에 쓴다', () => {
  const g = newGame(3).start();
  const S = g.S;
  const [axe, shield, tower] = g.hand('p0', ['axe', 'shield', 'tower']);
  const [sword] = g.hand('p1', ['sword']);
  g.plan('p0', 'p2', [axe]);       // 기력 2 사용 → 1 남음
  g.plan('p1', 'p0', [sword]);
  g.plan('p2', null, []);
  g.resolve(() => g.def('p0', [tower, shield])); // 탑 방패(2)는 못 내고 철 방패(1)만
  assert.equal(S.left.p0, ENERGY - 2);
  assert.equal(S.hp.p0, HP_MAX - (7 - 6));
  assert.deepEqual(g.handOf('p0'), ['tower']);
  assert.equal(S.hp.p2, HP_MAX - 13);
});

test(`${CROWD}명 이상 몰리면 전부 절반`, () => {
  const g = newGame(4).start();
  const S = g.S;
  for (const id of ['p0', 'p1', 'p2']) g.plan(id, 'p3', g.hand(id, ['sword']));
  g.plan('p3', null, []);
  g.resolve();
  assert.equal(S.hp.p3, HP_MAX - 3 * Math.round(7 * 0.5));
});

test('회피·반사·인간 방패는 제일 센 공격부터', () => {
  const g = newGame(4).start();
  const S = g.S;
  g.plan('p0', 'p3', g.hand('p0', ['axe']));
  g.tick(50);
  g.plan('p1', 'p3', g.hand('p1', ['sword']));
  g.plan('p2', null, []);
  const [mirror, stim] = g.hand('p3', ['mirror', 'stim']);
  g.plan('p3', null, []);
  g.resolve(() => g.def('p3', [mirror]));
  assert.equal(S.hp.p0, HP_MAX - 13, '도끼가 되돌아갔다');
  assert.equal(S.hp.p3, HP_MAX - 7, '장검은 그대로 맞았다');
  assert.ok(stim);
});

test('탈락시키면 유물을 하나 뺏는다', () => {
  const g = newGame(3).start();
  const S = g.S;
  S.relics = { p1: ['sand', 'vamp'] };
  S.lives.p1 = 1;
  S.hp.p1 = 5;
  g.plan('p0', 'p1', g.hand('p0', ['sword']));
  g.plan('p1', null, []);
  g.plan('p2', null, []);
  g.resolve();
  assert.deepEqual(S.alive, ['p0', 'p2'].filter(id => S.order.includes(id)).sort((a, b) => S.order.indexOf(a) - S.order.indexOf(b)));
  assert.deepEqual(g.kills, ['p0>p1']);
  g.until(s => s.phase === 'loot');
  assert.equal(S.loot[0].by, 'p0');
  onInput(g.ctx, { pid: 'p0', type: 'loot', data: { relic: 'sand' } });
  assert.ok(S.relics.p0.includes('sand'));
  S.duel = true;
  assert.equal(energyOf(S, 'p0'), 4 + 1, '둘만 남으면 기력 4 + 시간의 모래');
});

test('봇끼리 끝까지: 2~8명', () => {
  for (const n of [2, 3, 5, 8]) {
    for (let k = 0; k < 4; k++) {
      const g = newGame(n);
      const mem = new Map(g.ctx.roster.map(p => [p.id, {}]));
      let rounds = 0;
      for (let i = 0; i < 60000 && !g.S.over; i++) {
        for (const p of g.ctx.roster) {
          const act = bot(g.ctx, p.id, mem.get(p.id));
          if (act) onInput(g.ctx, { pid: p.id, type: act.type, data: act.data });
        }
        g.tick(50);
        rounds = g.S.round;
        for (const p of g.ctx.roster) {
          assert.ok(g.S.hp[p.id] <= HP_MAX && (g.S.cards[p.id] || 0) <= HAND_MAX + 2);
          assert.ok(g.S.alive.includes(p.id) ? g.S.lives[p.id] >= 1 || g.S.hp[p.id] === 0 : true);
        }
      }
      assert.ok(g.S.over, `${n}명 판이 안 끝남 (${rounds}턴)`);
      assert.ok(g.S.alive.length <= 1);
      assert.equal(Object.keys(g.S.standings).length, n);
      assert.ok(rounds >= 3 && rounds <= 60, `${n}명 ${rounds}턴`);
    }
  }
});

test('필살기: 준비한 다음 턴에 터지고, 그 턴에 많이 맞으면 끊긴다', async () => {
  const { ULTS, BREAK, FURY_MAX, charging, furyOf } = await import('../js/games/arena-core.js');
  for (const cut of [false, true]) {
    const g = newGame(3).start();
    const S = g.S;
    S.ults = { p0: 'meteor' };
    S.fury = { p0: FURY_MAX };
    g.plan('p0', null, [], true);
    onInput(g.ctx, { pid: 'p0', type: 'plan', data: {} }); // 이미 준비함: 무시
    g.ctx.secret.plans.p0.u = true;
    g.plan('p1', null, []);
    g.plan('p2', null, []);
    g.resolve();
    assert.equal(S.atk.p0.cast, 'meteor');
    g.until(s => s.phase === 'attack' && s.round === 2);
    assert.ok(charging(S, 'p0'), '다음 턴 내내 준비 중');
    g.plan('p0', null, []);
    g.plan('p1', cut ? 'p0' : null, cut ? g.hand('p1', ['axe']) : []);
    g.plan('p2', null, []);
    const rs = g.resolve();
    if (cut) {
      assert.ok(13 >= BREAK && rs.some(e => e.k === 'break'), '끊김');
      assert.equal(furyOf(S, 'p0'), FURY_MAX / 2);
      assert.equal(S.hp.p1, HP_MAX);
    } else {
      const ult = rs.find(e => e.k === 'ult');
      assert.equal(ult.u, 'meteor');
      assert.equal(S.hp.p1, HP_MAX - 14);
      assert.equal(S.hp.p2, HP_MAX - 14);
      assert.equal(furyOf(S, 'p0'), 0);
    }
    assert.ok(Object.keys(ULTS).length === 6);
  }
});

test('야수: 표적을 물지만 쓰러뜨리진 않고, 막타를 치면 전리품', async () => {
  const { BEAST } = await import('../js/games/arena-core.js');
  const g = newGame(3).start();
  const S = g.S;
  S.beast = { hp: 6, max: 42, until: 99, t: 'p1', dmg: 12 };
  S.hp.p1 = 5;
  g.plan('p0', BEAST, g.hand('p0', ['dagger']));
  g.plan('p1', null, []);
  g.plan('p2', null, []);
  let rs = g.resolve();
  assert.equal(S.beast.hp, 3);
  assert.equal(S.hp.p1, 1, '체력 1은 남긴다');
  assert.ok(rs.some(e => e.k === 'bite'));
  g.until(s => s.phase === 'attack' && s.round === 2);
  g.plan('p0', BEAST, g.hand('p0', ['sword']));
  g.plan('p1', null, []);
  g.plan('p2', null, []);
  rs = g.resolve();
  assert.ok(rs.some(e => e.k === 'bhit' && e.dn === 3));
  assert.equal(S.beast, null);
  g.until(s => s.phase === 'loot');
  assert.equal(S.loot[0].by, 'p0');
  assert.equal(S.loot[0].from, BEAST);
});

test('폭군: 제일 많이 쓰러뜨린 사람을 쓰러뜨리면 현상금', async () => {
  const { tyrantOf } = await import('../js/games/arena-core.js');
  const g = newGame(3).start();
  const S = g.S;
  S.kills = { p1: 2 };
  assert.equal(tyrantOf(S), 'p1');
  S.tyrant = 'p1';
  S.hp.p1 = 3;
  g.plan('p0', 'p1', g.hand('p0', ['sword']));
  g.plan('p1', null, []);
  g.plan('p2', null, []);
  g.resolve();
  assert.ok(S.loot.some(x => x.by === 'p0' && x.from === '@bounty'));
  assert.equal(tyrantOf(S), null, '현상금을 치르면 왕관이 떨어진다');
});

/* ───────── 3차: 관중의 변덕 · 새 카드 · 망령의 원한과 유산 ───────── */

test('관중의 변덕: 룰렛 턴 · 광란 · 몰매 · 맨몸', async () => {
  const { WHIMS, WHIM_FIRST } = await import('../js/games/arena-core.js');
  assert.equal(Object.keys(WHIMS).length, 8);
  const g = newGame(4).start();
  const S = g.S;
  S.round = WHIM_FIRST - 1;
  S.ultsGiven = true;
  for (const p of g.ctx.roster) g.plan(p.id, null, []);
  g.until(s => s.phase === 'whim');
  assert.equal(S.round, WHIM_FIRST);
  assert.ok(WHIMS[S.whim.k], '룰렛이 하나를 골랐다');
  S.whim = { k: 'frenzy', round: S.round };
  g.until(s => s.phase === 'attack');
  assert.equal(attackOf(S, 'p0', 'p1', ['sword']).dmg, Math.round(7 * 1.5), '광란: 1.5배');
  S.whim = { k: 'mob', round: S.round };
  for (const id of ['p0', 'p1', 'p2']) g.plan(id, 'p3', g.hand(id, ['sword']));
  g.plan('p3', null, []);
  g.resolve();
  assert.equal(S.hp.p3, HP_MAX - 21, '몰매: 몰려도 절반이 안 된다');
  g.until(s => s.phase === 'attack' && s.round === WHIM_FIRST + 1);
  assert.equal(S.whim, null, '다음 턴엔 변덕이 없다');
  S.whim = { k: 'bare', round: S.round };
  S.hp.p1 = HP_MAX;
  g.plan('p0', 'p1', g.hand('p0', ['sword']));
  g.hand('p1', ['shield']);
  for (const id of ['p1', 'p2', 'p3']) g.plan(id, null, []);
  g.until(s => s.phase !== 'attack' && s.phase !== 'reveal');
  assert.equal(S.phase, 'resolve', '맨몸: 방어 단계가 없다');
  assert.equal(S.hp.p1, HP_MAX - 7);
});

test('새 카드: 갈고리 · 사슬 낫 · 번개 · 화약통 · 쌍수 · 불사의 약', () => {
  // 사슬 낫은 반사 거울이 안 통한다 (거울은 그다음으로 센 갈고리를 되돌린다)
  let g = newGame(3).start();
  let S = g.S;
  g.plan('p0', 'p1', g.hand('p0', ['hook']));
  g.plan('p2', 'p1', g.hand('p2', ['chain']));
  const [mirror] = g.hand('p1', ['mirror']);
  g.plan('p1', null, []);
  let rs = g.resolve(() => g.def('p1', [mirror]));
  assert.ok(rs.some(e => e.k === 'reflect' && e.by === 'p0'));
  assert.equal(S.hp.p0, HP_MAX - 4);
  assert.equal(S.hp.p1, HP_MAX - 5);
  // 갈고리: 맞으면 손패 한 장을 뺏긴다
  g = newGame(3).start();
  S = g.S;
  g.plan('p0', 'p1', g.hand('p0', ['hook']));
  g.hand('p1', ['shield', 'axe']);
  g.plan('p1', null, []);
  g.plan('p2', null, []);
  rs = g.resolve();
  assert.ok(rs.some(e => e.k === 'hit' && e.st));
  assert.equal(g.handOf('p1').length, 1);
  assert.equal(g.handOf('p0').length, 1);
  // 번개는 양옆 자리로, 화약통은 나머지 모두에게 튄다
  g = newGame(5).start();
  S = g.S;
  const o = S.order;
  g.plan(o[0], o[2], g.hand(o[0], ['bolt']));
  g.tick(100);
  g.plan(o[4], o[0], g.hand(o[4], ['keg']));
  for (const id of [o[1], o[2], o[3]]) g.plan(id, null, []);
  rs = g.resolve();
  assert.deepEqual(rs.filter(e => e.k === 'area').map(e => [e.e, e.hits.length]), [['bolt', 2], ['keg', 3]]);
  assert.deepEqual(o.map(id => HP_MAX - S.hp[id]), [6, 3 + 4, 9 + 4, 3 + 4, 0]);
  // 쌍수: 제일 센 무기가 한 번 더
  assert.equal(attackOf(S, o[0], o[1], ['axe', 'dagger', 'twin']).dmg, 13 + 3 + 13);
  // 불사의 약: 그 턴엔 체력 1에서 버틴다
  g = newGame(3).start();
  S = g.S;
  S.hp.p1 = 5;
  g.plan('p0', 'p1', g.hand('p0', ['axe']));
  const [elixir] = g.hand('p1', ['elixir']);
  g.plan('p1', null, []);
  g.plan('p2', null, []);
  rs = g.resolve(() => g.def('p1', [elixir]));
  assert.ok(rs.some(e => e.k === 'hit' && e.und));
  assert.equal(S.hp.p1, 1);
  assert.equal(S.lives.p1, LIVES);
});

test('역습 태세로 다 막으면 기력 +1 · 도발당하면 그 사람만 겨눌 수 있다', async () => {
  const { lockOf } = await import('../js/games/arena-core.js');
  const g = newGame(3).start();
  const S = g.S;
  g.plan('p0', 'p1', g.hand('p0', ['dagger', 'taunt']));
  const [parry] = g.hand('p1', ['parry']);
  g.plan('p1', null, []);
  g.plan('p2', null, []);
  const rs = g.resolve(() => g.def('p1', [parry]));
  assert.ok(rs.some(e => e.k === 'perfect' && e.to === 'p1'));
  assert.equal(S.hp.p1, HP_MAX);
  g.until(s => s.phase === 'attack' && s.round === 2);
  assert.equal(energyOf(S, 'p1'), ENERGY + 1);
  assert.equal(lockOf(S, 'p1'), 'p0');
  g.plan('p1', 'p2', g.hand('p1', ['sword']));
  g.plan('p0', null, []);
  g.plan('p2', null, []);
  g.resolve();
  assert.equal(S.atk.p1.t, 'p0', '도발: 다른 사람을 겨눠도 도발한 사람에게 간다');
});

test('탈락한 사람: 유산을 물려주고, 원한을 건 사람은 더 아프게 맞는다', async () => {
  const { GRUDGE } = await import('../js/games/arena-core.js');
  const g = newGame(4).start();
  const S = g.S;
  S.relics = { p1: ['sand', 'vamp', 'thorn'] };
  S.lives.p1 = 1;
  S.hp.p1 = 5;
  g.plan('p0', 'p1', g.hand('p0', ['sword']));
  for (const id of ['p1', 'p2', 'p3']) g.plan(id, null, []);
  g.resolve();
  g.until(s => s.phase === 'loot');
  assert.ok(S.loot.some(x => x.kind === 'will' && x.by === 'p1'));
  onInput(g.ctx, { pid: 'p0', type: 'loot', data: { relic: 'sand' } });
  assert.ok(onInput(g.ctx, { pid: 'p1', type: 'will', data: { relic: 'thorn', to: 'p2' } }));
  g.until(s => s.phase === 'attack' && s.round === 2);
  assert.ok(S.relics.p0.includes('sand'));
  assert.deepEqual(S.relics.p2, ['thorn']);
  assert.deepEqual(S.relics.p1, ['vamp'], '뺏기고 물려준 건 빠진다');
  assert.deepEqual(S.wills, [{ from: 'p1', to: 'p2', r: 'thorn' }]);
  onInput(g.ctx, { pid: 'p1', type: 'grudge', data: { round: 2, t: 'p0' } });
  g.plan('p2', 'p0', g.hand('p2', ['sword']));
  g.plan('p0', null, []);
  g.plan('p3', null, []);
  g.resolve();
  assert.equal(S.grudge.p0, 1);
  assert.equal(S.atk.p2.dmg, 7 + GRUDGE);
});
