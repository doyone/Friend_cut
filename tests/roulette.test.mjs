import test from 'node:test';
import assert from 'node:assert/strict';
import game, {
  AUGS, CARDS, FATES, FATE_ORDER, FATE_TIME, FINAL_MAG, HAND_MAX, PICK_TIME, QUICK_TIME, REACT_TIME, TURN_TIME, WILL_TIME,
  dealOf, drawCard, drawFate, handMax, livesOf, magOf, nextAlive, offerOf, shellKey, tierOf,
} from '../js/games/roulette.js';

function newGame(n = 3) {
  let clock = 1_000_000;
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const kills = [];
  const said = [];
  const priv = {};
  const offline = new Set();
  const ctx = {
    roster, now: () => clock, secret: {}, isOnline: id => !offline.has(id), nameOf: id => id,
    setPrivate: (id, d) => { priv[id] = d; }, announce: t => said.push(t), kill: (a, b) => kills.push(`${a}>${b}`),
  };
  ctx.state = { ...game.setup(ctx), roster };
  const tick = (ms = 50) => { clock += ms; return game.tick(ctx); };
  const turnData = () => ({ turn: ctx.state.turnNo });
  const g = {
    ctx, kills, said, priv, offline, tick,
    get S() { return ctx.state; },
    get now() { return clock; },
    until(fn, max = 4000) {
      for (let i = 0; i < max && !fn(ctx.state); i++) tick();
      assert.ok(fn(ctx.state), `기다리던 상태가 안 옴 (지금 ${ctx.state.phase})`);
    },
    // 탄 순서를 정해 둔다 (앞이 지금 탄)
    shells(list) {
      const live = list.filter(Boolean).length;
      ctx.secret.shells = [...list];
      ctx.secret.peeks = {};
      Object.assign(ctx.state, { left: { live, blank: list.length - live }, fired: [] });
    },
    hand(id, cards) {
      ctx.secret.hands = { ...ctx.secret.hands, [id]: [...cards] };
      ctx.state.cards = { ...ctx.state.cards, [id]: cards.length };
    },
    handOf: id => ctx.secret.hands?.[id] || [],
    aim: (to, pid) => game.onInput(ctx, { pid: pid ?? ctx.state.turn, type: 'aim', data: { ...turnData(), to } }),
    fire: (to, pid) => game.onInput(ctx, { pid: pid ?? ctx.state.turn, type: 'fire', data: { ...turnData(), to } }),
    card: (card, to, pid) => game.onInput(ctx, { pid: pid ?? ctx.state.turn, type: 'card', data: { ...turnData(), card, to } }),
    react: (pid, card = null) => game.onInput(ctx, { pid, type: 'react', data: { shot: ctx.state.shot.no, card } }),
    will: (pid, to, card) => game.onInput(ctx, { pid, type: 'will', data: { to, card } }),
    fate: pid => game.onInput(ctx, { pid: pid ?? ctx.state.turn, type: 'fate', data: turnData() }),
    pick: (pid, aug) => game.onInput(ctx, { pid, type: 'pick', data: { round: ctx.state.pick.round, aug } }),
    augs: (id, list) => { ctx.state.augs = { ...ctx.state.augs, [id]: [...list] }; },
    // 그 사람 차례로 바로 (시험에서 순서를 기다리지 않게)
    turnOf: id => Object.assign(ctx.state, { phase: 'turn', turn: id, aim: null, double: false, scatter: false, peeked: false, turnAt: clock, turnEndsAt: clock + TURN_TIME, turnCap: clock + 20000 }),
  };
  g.until(S => S.phase === 'turn');
  // 시험마다 손패 · 증강 · 하트를 직접 정한다 (시작할 때 아무거나 고른 증강과 그 효과는 지운다)
  const S = ctx.state;
  Object.assign(S, { augs: {}, used: {}, power: null, streak: null, grudges: {}, dualUsed: false });
  S.hp = Object.fromEntries(roster.map(p => [p.id, S.maxHp]));
  S.fates = Object.fromEntries(roster.map(p => [p.id, 1]));
  ctx.secret.peeks = {};
  ctx.secret.visions = {};
  for (const p of roster) {
    g.hand(p.id, []);
    priv[p.id] = { hand: [], peek: null, vision: null };
  }
  return g;
}

test('구성: 하트·탄창·카드 받기·뽑기 비율', () => {
  assert.deepEqual([2, 3, 5, 6, 8].map(livesOf), [4, 3, 3, 2, 2]);
  for (let alive = 2; alive <= 8; alive++) {
    for (let no = 1; no <= 10; no++) {
      for (const r of [0, 0.5, 0.999]) {
        const m = magOf(alive, no, () => r);
        assert.ok(m.live >= 1 && m.blank >= 1, '실탄·공포탄 모두 적어도 1발');
        assert.ok(m.live + m.blank >= 3 && m.live + m.blank <= 8, '3~8발');
      }
    }
  }
  assert.deepEqual(magOf(8, 1, () => 0), { live: 3, blank: 5 });
  assert.deepEqual(magOf(8, 3, () => 0), { live: 4, blank: 4 }, '탄창이 바뀔수록 실탄이 많아진다');
  assert.deepEqual(magOf(8, FINAL_MAG, () => 0), { live: 6, blank: 2 }, '막판은 실탄이 확 는다');
  assert.deepEqual(magOf(8, 9, () => 0), { live: 7, blank: 1 });
  assert.deepEqual([dealOf(8, 1), dealOf(8, 2), dealOf(4, 3), dealOf(4, FINAL_MAG), dealOf(2, 9)], [2, 1, 1, 0, 0], '막판엔 카드가 안 나온다');
  assert.equal(HAND_MAX, 3);
  assert.equal(Object.values(CARDS).reduce((a, c) => a + c.w, 0), 100);
  assert.equal(Object.values(FATES).reduce((a, c) => a + c.w, 0), 100);
  assert.deepEqual(FATE_ORDER, Object.keys(FATES));
  assert.equal(drawFate(['heal', 'swap'], () => 0), 'heal');
  assert.equal(drawFate(['heal', 'swap'], () => 0.99), 'swap');
  assert.equal(drawCard(3, () => 0), 'peek');
  for (let i = 0; i < 300; i++) assert.notEqual(drawCard(2), 'scatter', '둘만 남으면 산탄은 안 나온다');
});

test('장전: 탄 개수만 공개, 순서와 손패는 상태에 없다. 처음엔 카드 2장(본인에게만) + 운명 카드 1장', () => {
  let clock = 1_000_000;
  const roster = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const priv = {};
  const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, setPrivate: (id, d) => { priv[id] = d; }, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  const S = ctx.state;
  assert.equal(S.maxHp, 3);
  for (let i = 0; i < 600 && S.phase !== 'turn'; i++) { clock += 50; game.tick(ctx); }
  assert.equal(S.phase, 'turn');
  assert.equal(S.turn, S.order[0]);
  assert.equal(S.magNo, 1);
  assert.equal(S.rounds, 1, '시작할 때 증강을 한 번 골랐다');
  assert.equal(ctx.secret.shells.length, S.left.live + S.left.blank);
  assert.equal(ctx.secret.shells.filter(Boolean).length, S.left.live);
  for (const p of roster) {
    const augs = S.augs[p.id];
    assert.ok(augs.length >= 1);
    assert.equal(S.cards[p.id], 2 + (augs.includes('pouch') ? 1 : 0) + (augs.includes('fire') ? 1 : 0), '큰 주머니 · 화력이면 1장 더');
    assert.equal(S.fates[p.id], 1 + (augs.includes('dealer') ? 1 : 0));
    assert.equal(priv[p.id].hand.length, S.cards[p.id]);
    assert.deepEqual(priv[p.id].hand, ctx.secret.hands[p.id]);
  }
  const shown = JSON.stringify(S);
  assert.ok(!shown.includes('shells') && !shown.includes('hands'), '탄 순서·손패는 방장만');
});

test('나에게 쏘기: 공포탄이면 한 번 더, 실탄이면 하트 -1 하고 다음 사람', () => {
  const g = newGame(3);
  const a = g.S.turn;
  const b = nextAlive(g.S, a);
  g.shells([0, 1, 0]);
  assert.equal(g.fire(a, b), false, '남 차례엔 못 쏨');
  assert.equal(g.fire('nobody'), false);
  const no = g.S.turnNo;
  assert.equal(g.fire(a), true);
  assert.equal(g.S.phase, 'hush');
  assert.equal(g.fire(a), false, '결과가 나올 때까지 또 못 쏨');
  g.until(S => S.phase === 'shot');
  assert.deepEqual([g.S.shot.live, g.S.shot.again], [0, true]);
  assert.equal(g.handOf(a).length, 0, '나를 쏴서 공포탄이어도 카드는 안 준다');
  assert.deepEqual(g.S.left, { live: 1, blank: 1 });
  assert.deepEqual(g.S.fired, [0]);
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, a, '한 번 더');
  assert.ok(g.S.turnNo > no);
  g.fire(a);
  g.until(S => S.phase === 'shot');
  assert.equal(g.S.hp[a], g.S.maxHp - 1);
  assert.equal(g.kills.length, 0);
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, b);
  assert.equal(g.S.selfs[a], 2);
});

test('남에게 쏘기: 실탄이면 하트 -1, 공포탄이면 아무 일 없음. 어느 쪽이든 차례가 넘어가고, 그냥 맞기를 누르면 금방 결과', () => {
  const g = newGame(3);
  const a = g.S.turn;
  const b = nextAlive(g.S, a);
  const c = nextAlive(g.S, b);
  g.shells([1, 0, 1, 1]);
  assert.equal(g.aim(b), true);
  assert.equal(g.S.aim, b, '총구는 모두에게 보인다');
  g.fire(b);
  assert.deepEqual(g.S.shot.to, [b]);
  assert.equal(g.react(c), false, '안 겨눠진 사람은 못 받아침');
  const t0 = g.now;
  assert.equal(g.react(b), true);
  assert.equal(g.react(b), false, '한 번만');
  g.until(S => S.phase === 'shot');
  assert.ok(g.now - t0 < REACT_TIME - 1000, '다 정했으면 3초를 안 기다린다');
  assert.equal(g.S.hp[b], g.S.maxHp - 1);
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, b);
  g.fire(c);
  const t1 = g.now;
  g.until(S => S.phase === 'shot'); // 아무도 안 누르면 3초(+조금) 뒤에 결과
  assert.ok(g.now - t1 >= REACT_TIME);
  assert.equal(g.S.hp[c], g.S.maxHp);
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, c);
});

test('받아치기: 방패는 막고, 거울은 쏜 사람에게 되돌린다(두 배면 2칸). 공포탄이면 카드만 날린다', () => {
  const g = newGame(3);
  const a = g.S.turn;
  const b = nextAlive(g.S, a);
  const c = nextAlive(g.S, b);
  g.shells([1, 1, 0, 1]);
  g.hand(b, ['shield', 'double']);
  g.hand(c, ['mirror', 'shield']);
  g.fire(b);
  assert.equal(g.react(b, 'mirror'), false, '없는 카드');
  assert.equal(g.react(b, 'double'), false, '받아치기 카드가 아님');
  assert.equal(g.react(b, 'shield'), true);
  assert.equal(g.S.shot.react[b], 'shield', '내민 카드는 결과 전에 모두에게 보인다');
  assert.deepEqual(g.handOf(b), ['double']);
  assert.deepEqual(g.priv[b].hand, ['double']);
  g.until(S => S.phase === 'shot');
  assert.equal(g.S.hp[b], g.S.maxHp);
  assert.equal(g.S.blocks[b], 1);
  g.until(S => S.phase === 'turn' && S.turn === b);

  // b가 두 배를 걸고 c를 쐈는데 거울 → b가 2칸
  g.S.hp[b] = 2;
  assert.equal(g.card('shield'), false, '받아치기 카드는 내 차례에 못 씀');
  assert.equal(g.card('double'), true);
  assert.equal(g.S.double, true);
  g.fire(c);
  assert.equal(g.S.shot.dbl, true);
  g.react(c, 'mirror');
  g.until(S => S.phase === 'shot');
  assert.equal(g.S.hp[c], g.S.maxHp);
  assert.equal(g.S.hp[b], 0);
  assert.deepEqual(g.S.shot.dead, [b]);
  assert.deepEqual(g.kills, [`${c}>${b}`], '거울로 탈락시키면 거울 쓴 사람 킬');
  assert.equal(g.S.mirrors[c], 1);
  assert.ok(!g.S.alive.includes(b));

  // 공포탄에 방패: 헛방패
  g.until(S => S.phase === 'turn' && S.turn === c);
  g.fire(a);
  g.until(S => S.phase === 'shot');
  g.until(S => S.phase === 'turn' && S.turn === a);
  g.shells([0, 1]);
  g.fire(c);
  g.react(c, 'shield');
  g.until(S => S.phase === 'shot');
  assert.equal(g.S.wastes[c], 1);
  assert.deepEqual(g.S.shot.wasted, [c]);
  assert.equal(g.handOf(c).length, 1, '거울로 b를 탈락시켜 받은 처치 보상 카드만 남는다');
});

test('이어서 쏘면 총구는 방금 겨눈 곳 그대로 (시간이 끝나도 엉뚱하게 나에게 안 나감). 다음 사람 차례는 빈 총구', () => {
  // 나를 쏴서 공포탄 → 한 번 더: 나를 겨눈 채
  let g = newGame(3);
  const a = g.S.turn;
  const b = nextAlive(g.S, a);
  g.shells([0, 1, 0, 1]);
  g.aim(a);
  g.fire(a);
  g.until(S => S.phase === 'turn');
  assert.deepEqual([g.S.turn, g.S.aim, g.S.repeat], [a, a, true]);
  g.fire(b);
  g.until(S => S.phase === 'turn');
  assert.deepEqual([g.S.turn, g.S.aim, g.S.repeat], [b, null, false], '다음 사람은 새로 겨눈다');

  // 2명: 수갑 찬 상대를 쏘면 상대를 겨눈 채 차례가 돌아오고, 시간이 끝나면 그 상대에게 나간다
  g = newGame(2);
  const x = g.S.turn;
  const y = nextAlive(g.S, x);
  g.shells([0, 0, 1, 1]);
  g.hand(x, ['cuff']);
  g.aim(y);
  assert.equal(g.card('cuff', y), true);
  g.fire(y);
  g.until(S => S.phase === 'skip');
  g.until(S => S.phase === 'turn');
  assert.deepEqual([g.S.turn, g.S.aim, g.S.repeat], [x, y, true]);
  g.tick(TURN_TIME + 400);
  assert.equal(g.S.phase, 'hush');
  assert.deepEqual(g.S.shot.to, [y], '나에게가 아니라 겨눠 둔 상대에게');
});

test('카드: 돋보기는 나만 봄 · 반창고 · 수갑(다음 차례 쉼) · 훔치기 · 두 배와 산탄은 같이 못 씀', () => {
  const g = newGame(3);
  const a = g.S.turn;
  const b = nextAlive(g.S, a);
  const c = nextAlive(g.S, b);
  g.shells([1, 0, 0, 1]);
  g.hand(a, ['peek', 'heal', 'cuff', 'steal']);
  g.hand(b, ['mirror']);
  const ends = g.S.turnEndsAt;
  assert.equal(g.card('peek', null, b), false, '남 차례');
  assert.equal(g.card('peek'), true);
  assert.deepEqual(g.priv[a].peek, { key: shellKey(g.S), live: 1 });
  assert.equal(g.S.peeked, true, '돋보기를 썼다는 건 모두가 안다');
  assert.ok(!JSON.stringify(g.S).includes('"key"') && !g.priv[b]?.peek, '본 내용은 본인에게만');
  assert.ok(g.S.turnEndsAt >= ends && g.S.turnEndsAt <= g.S.turnCap);
  assert.equal(g.card('heal'), false, '하트가 꽉 찼으면 못 씀');
  g.S.hp[a] = 1;
  assert.equal(g.card('heal'), true);
  assert.equal(g.S.hp[a], 2);
  assert.equal(g.card('cuff'), false, '겨눈 사람이 있어야 함');
  assert.equal(g.card('cuff', a), false, '나에게는 못 씀');
  assert.equal(g.card('cuff', b), true);
  assert.equal(g.S.cuffs[b], true);
  assert.equal(g.card('steal', c), false, '카드 없는 사람');
  assert.equal(g.card('steal', b), true);
  assert.deepEqual(g.handOf(a), ['mirror']);
  assert.deepEqual([g.S.cards[a], g.S.cards[b]], [1, 0]);
  assert.equal(g.S.ev.k, 'steal');
  // a가 c를 쏜 뒤: b는 수갑이라 쉬고 다시 c 차례가 아니라… 순서는 a → (b 쉼) → c
  g.fire(c);
  g.until(S => S.phase === 'shot');
  assert.equal(g.S.hp[c], g.S.maxHp - 1);
  g.until(S => S.phase === 'skip');
  assert.equal(g.S.skip, b);
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, c);
  assert.ok(!g.S.cuffs?.[b], '한 번 쉬면 풀린다');
  g.hand(c, ['double', 'scatter']);
  assert.equal(g.card('double'), true);
  assert.equal(g.card('scatter'), false);
});

test('산탄: 나 빼고 모두에게, 각자 받아치기. 거울은 쏜 사람에게 돌아가고 같은 한 발에 탈락하면 같은 등수', () => {
  const g = newGame(4);
  const [a, b, c, d] = [0, 1, 2, 3].map(i => g.S.order[i]);
  assert.equal(g.S.turn, a);
  g.shells([1, 1, 1]);
  g.hand(a, ['scatter']);
  g.hand(b, ['shield']);
  g.hand(c, ['mirror']);
  assert.equal(g.card('scatter'), true);
  assert.equal(g.aim(b), false, '산탄은 겨눌 필요가 없다');
  g.fire(null);
  assert.deepEqual([...g.S.shot.to].sort(), [b, c, d].sort());
  g.react(b, 'shield');
  g.react(c, 'mirror');
  assert.equal(g.S.phase, 'hush');
  g.react(d);
  g.until(S => S.phase === 'shot');
  assert.deepEqual([g.S.hp[a], g.S.hp[b], g.S.hp[c], g.S.hp[d]], [2, 3, 3, 2]);
  assert.equal(g.S.shot.sc, true);

  // d와 a가 하트 1개일 때 b의 산탄 실탄 → 둘이 같이 탈락, 공동 등수
  g.until(S => S.phase === 'turn' && S.turn === b);
  Object.assign(g.S.hp, { [a]: 1, [d]: 1 });
  g.hand(b, ['scatter']);
  g.hand(c, []);
  g.card('scatter');
  g.fire(null);
  for (const id of [a, c, d]) g.react(id);
  g.until(S => S.phase === 'shot');
  assert.deepEqual([...g.S.shot.dead].sort(), [a, d].sort());
  assert.equal(g.kills.filter(k => k.startsWith(`${b}>`)).length, 2);
  assert.equal(g.handOf(b).length, 2, '처치 보상: 한 명에 1장씩');
  g.until(S => S.phase === 'turn');
  g.shells([1]);
  g.S.hp[b] = 1;
  g.S.hp[c] = 1;
  const last = g.S.turn;
  const other = last === b ? c : b;
  g.fire(other);
  g.react(other);
  g.until(S => S.over);
  assert.equal(g.S.winner, last);
  assert.equal(g.S.standings[last], 4);
  assert.equal(g.S.standings[other], 3);
  assert.equal(g.S.standings[a], g.S.standings[d]);
  assert.equal(g.S.standings[a], 2);
  assert.ok(g.S.titles[last].includes('🔫 최후의 1인'));
});

test('시간 초과: 총구가 향한 사람에게(없으면 나에게) 그대로 나간다. 나에게 나간 공포탄도 한 번 더, 자리 비운 사람은 기다리지 않고 한 번 더도 없음', () => {
  const g = newGame(3);
  const a = g.S.turn;
  const b = nextAlive(g.S, a);
  const c = nextAlive(g.S, b);
  g.shells([0, 0, 1, 0, 1, 1]);
  g.tick(TURN_TIME - 200);
  assert.equal(g.S.phase, 'turn');
  g.until(S => S.phase === 'hush');
  assert.deepEqual([g.S.shot.to, g.S.shot.self, g.S.shot.auto], [[a], true, true]);
  g.until(S => S.phase === 'turn');
  assert.deepEqual([g.S.turn, g.S.shot.again], [a, true], '시간이 끝나 나에게 나간 공포탄도 한 번 더');
  g.aim(b);
  g.tick(TURN_TIME + 400);
  assert.equal(g.S.phase, 'hush');
  assert.deepEqual(g.S.shot.to, [b], '겨눠 둔 사람에게 나간다');
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, b);
  g.aim(c);
  g.tick(TURN_TIME + 400);
  g.until(S => S.phase === 'shot');
  assert.equal(g.S.hp[c], g.S.maxHp - 1);
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, c);
  g.offline.add(c);
  g.tick();
  assert.equal(g.S.phase, 'hush', '자리 비운 사람은 기다리지 않는다');
  assert.deepEqual(g.S.shot.to, [c]);
  g.until(S => S.phase === 'shot');
  assert.deepEqual([g.S.shot.live, g.S.shot.again], [0, false], '자리 비운 사람의 공포탄은 한 번 더가 없다 (혼자 판을 끌지 않게)');
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, a);
  assert.equal(g.said.length, 0);
});

test('탈락과 유품: 남은 카드 한 장을 살아 있는 사람에게, 손패가 꽉 찬 사람에겐 못 줌, 안 고르면 사라짐 / 나를 쏴서 죽으면 자폭', () => {
  const g = newGame(4);
  const [a, b, c, d] = [0, 1, 2, 3].map(i => g.S.order[i]);
  g.shells([1, 1, 1, 1, 1]);
  g.S.hp[b] = 1;
  g.hand(b, ['heal', 'peek']);
  g.hand(c, ['shield', 'shield', 'shield', 'shield']);
  g.fire(b);
  g.react(b);
  g.until(S => S.phase === 'shot');
  assert.deepEqual(g.kills, [`${a}>${b}`]);
  assert.ok(g.S.wills[b] > g.now);
  assert.equal(g.will(b, c, 'heal'), false, '꽉 찬 사람');
  assert.equal(g.will(b, b, 'heal'), false, '죽은 사람');
  assert.equal(g.will(b, d, 'shield'), false, '없는 카드');
  assert.equal(g.will(a, d, 'heal'), false, '유품은 탈락한 사람만');
  assert.equal(g.will(b, d, 'heal'), true);
  assert.deepEqual(g.handOf(d), ['heal']);
  assert.deepEqual(g.handOf(b), []);
  assert.equal(g.S.cards[b], 0);
  assert.ok(!g.S.wills?.[b]);
  assert.equal(g.S.ev.k, 'will');

  // c는 유품을 안 고름 → 시간 지나면 사라진다
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, c, '탈락한 사람은 건너뛴다');
  g.S.hp[c] = 1;
  g.fire(c);
  g.until(S => S.phase === 'shot');
  assert.equal(g.S.dead[c], '-');
  assert.ok(g.said.some(t => t.includes('자폭')));
  assert.equal(g.S.boomer, c);
  assert.equal(g.S.cards[c], 4);
  g.tick(WILL_TIME + 400);
  assert.equal(g.S.cards[c], 0);
  assert.equal(g.will(c, a, 'shield'), false, '늦음');
});

test('봇끼리 끝까지: 규칙 안에서만 움직이고, 탄 개수·손패 장수가 늘 맞는다', () => {
  for (const n of [2, 4, 8]) {
    let clock = 1_000_000;
    const roster = Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `봇${i}`, bot: true }));
    const ctx = { roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id, setPrivate() {}, announce() {}, kill() {} };
    ctx.state = { ...game.setup(ctx), roster };
    const S = ctx.state;
    const mem = new Map(roster.map(p => [p.id, {}]));
    let refused = 0;
    while (!S.over && clock < 1_000_000 + 1_200_000) {
      clock += 50;
      for (const p of roster) {
        const act = game.bot(ctx, p.id, mem.get(p.id));
        if (act && !game.onInput(ctx, { pid: p.id, type: act.type, data: act.data || {} }) && act.type !== 'aim') refused += 1;
      }
      game.tick(ctx);
      const shells = ctx.secret.shells || [];
      assert.equal(shells.length, (S.left?.live || 0) + (S.left?.blank || 0));
      for (const p of roster) {
        assert.ok(S.hp[p.id] >= 0 && S.hp[p.id] <= S.maxHp + 1, '가득 + 1칸(운명 카드)까지');
        assert.ok(S.cards[p.id] <= handMax(S, p.id));
        assert.equal((ctx.secret.hands?.[p.id] || []).length, S.cards[p.id]);
        assert.ok((S.fates[p.id] || 0) >= 0);
      }
    }
    assert.ok(S.over, `${n}명 판이 끝남`);
    assert.equal(S.alive.length, 1);
    assert.equal(Object.keys(S.standings).length, n);
    assert.equal(refused, 0, '봇이 안 되는 행동을 시도하지 않는다');
  }
});

test('증강 고르기: 모두 같은 등급에서 3개 중 하나 · 자리에 있는 사람이 다 고르면 바로 공개 · 안 고른 사람은 아무거나 · 탄창 3 앞에서 한 번 더(골드 이상)', () => {
  assert.equal(Object.keys(AUGS).length, 17);
  assert.deepEqual([tierOf(1, () => 0.49), tierOf(1, () => 0.5), tierOf(1, () => 0.9), tierOf(2, () => 0.59), tierOf(2, () => 0.6)], [1, 2, 3, 2, 3]);
  let clock = 1_000_000;
  const roster = [0, 1, 2].map(i => ({ id: `p${i}`, name: `P${i}` }));
  const offline = new Set(['p2']);
  const ctx = { roster, now: () => clock, secret: {}, isOnline: id => !offline.has(id), nameOf: id => id, setPrivate() {}, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  const S = ctx.state;
  const tick = (ms = 50) => { clock += ms; game.tick(ctx); };
  const pick = (pid, aug, round = S.pick.round) => game.onInput(ctx, { pid, type: 'pick', data: { round, aug } });
  while (S.phase === 'intro') tick();
  assert.equal(S.phase, 'pick');
  const { tier, offers } = S.pick;
  for (const p of roster) {
    assert.equal(new Set(offers[p.id]).size, 3);
    assert.ok(offers[p.id].every(a => AUGS[a].tier === tier));
  }
  assert.equal(pick('p0', Object.keys(AUGS).find(a => !offers.p0.includes(a))), false, '받은 3개 중에서만');
  assert.equal(pick('p0', offers.p0[1], 2), false, '다른 회차');
  assert.equal(pick('p0', offers.p0[1]), true);
  assert.equal(pick('p0', offers.p0[2]), false, '한 번만');
  assert.ok(!S.augs.p0 && !JSON.stringify(S).includes('picks'), '고른 건 공개 전엔 방장만');
  tick();
  assert.equal(S.pick.got, null, 'p1을 기다린다');
  assert.equal(pick('p1', offers.p1[0]), true);
  tick();
  assert.ok(S.pick.got, '자리에 있는 사람이 다 골랐으면 바로 공개 (p2는 자리에 없음)');
  assert.equal(S.augs.p0[0], offers.p0[1]);
  assert.equal(S.augs.p1[0], offers.p1[0]);
  assert.ok(offers.p2.includes(S.augs.p2[0]), '안 고른 사람은 셋 중 아무거나');
  while (S.phase !== 'turn') tick();
  assert.equal(S.magNo, 1);

  // 탄창 2를 다 쓰면: 탄창 3을 넣기 전에 두 번째 증강
  Object.assign(S, { magNo: 2, left: { live: 1, blank: 0 } });
  ctx.secret.shells = [1];
  game.onInput(ctx, { pid: S.turn, type: 'fire', data: { turn: S.turnNo, to: S.turn } });
  while (S.phase !== 'pick') tick();
  assert.equal(S.pick.round, 2);
  assert.ok(S.pick.tier >= 2, '두 번째는 골드 이상');
  for (const id of S.alive) assert.ok(S.pick.offers[id].every(a => !S.augs[id].includes(a)), '이미 가진 건 안 나온다');
  clock += PICK_TIME + 400;
  tick();
  assert.ok(S.pick.got, '시간이 끝나면 공개');
  while (S.phase !== 'load') tick();
  assert.equal(S.magNo, 3);
  assert.equal(S.rounds, 2);
  for (const id of S.alive) assert.ok(S.augs[id].length >= 2);
});

test('바로 생기는 증강: 큰 주머니(손패 최대 +1 · 카드 1장) · 도박사(운명 카드 +1) · 악마의 거래(하트 -1 · 프리즘 하나 더, 하트 1개면 안 나옴)', () => {
  const g = newGame(3);
  const [a, b, c] = g.S.order;
  Object.assign(g.S, { phase: 'pick', phaseEndsAt: g.now + PICK_TIME, after: a, pick: { round: 2, tier: 3, offers: { [a]: ['pouch'], [b]: ['dealer'], [c]: ['devil'] }, done: {}, got: null } });
  g.pick(a, 'pouch');
  g.pick(b, 'dealer');
  g.pick(c, 'devil');
  g.tick();
  assert.deepEqual(g.S.pick.got[a], ['pouch']);
  assert.equal(handMax(g.S, a), HAND_MAX + 1);
  assert.equal(g.handOf(a).length, 1);
  assert.equal(g.S.fates[b], 2);
  assert.equal(g.S.hp[c], g.S.maxHp - 1);
  assert.equal(g.S.augs[c][0], 'devil');
  assert.equal(AUGS[g.S.augs[c][1]].tier, 3);
  assert.notEqual(g.S.augs[c][1], 'devil');
  g.S.hp[a] = 1;
  for (let i = 0; i < 40; i++) assert.ok(!offerOf(g.S, a, 3).includes('devil'), '바칠 하트가 없으면 안 나온다');
});

test('처치 보상: 남을 탈락시키면 카드 1장 (손패가 차면 못 받음) · 나를 쏴서 공포탄은 한 번 더뿐', () => {
  const g = newGame(3);
  const [a, b, c] = g.S.order;
  g.shells([0, 1, 1, 0]);
  g.fire(a);
  g.until(S => S.phase === 'shot');
  assert.deepEqual([g.S.shot.again, g.handOf(a).length], [true, 0]);
  g.until(S => S.phase === 'turn');
  g.S.hp[b] = 1;
  g.fire(b);
  g.react(b);
  g.until(S => S.phase === 'shot');
  assert.deepEqual(g.S.shot.dead, [b]);
  assert.ok(g.S.shot.fx.some(f => f.k === 'kill' && f.id === a && f.got === 1));
  assert.equal(g.handOf(a).length, 1, '처치 보상');
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, c);
  g.hand(c, ['peek', 'peek', 'peek']);
  g.S.hp[a] = 1;
  g.fire(a);
  g.react(a);
  g.until(S => S.phase === 'shot');
  assert.ok(g.S.shot.fx.some(f => f.k === 'kill' && f.id === c && f.got === 0), '손패가 가득이면 0장');
  assert.equal(g.handOf(c).length, 3);
});

test('운명 카드: 한 판에 한 장, 쓰면 룰렛이 멈출 때까지 차례 시간이 멈췄다가 일어난다 (전탄 실탄 · 모두 하트 -1 · 내 하트 +1 · 손패 돌리기 · 방향 반대 · 피해 +2 · 탄 공개 · 모두 카드 · 증강 바꾸기 · 총 교체)', () => {
  const g = newGame(4);
  const [a, b, c, d] = g.S.order;
  g.shells([0, 1, 0, 1]);
  g.ctx.secret.nextFate = 'alllive';
  assert.equal(g.fate(b), false, '남 차례엔 못 씀');
  assert.equal(g.fate(), true);
  assert.equal(g.S.phase, 'fate');
  assert.equal(g.S.fates[a], 0);
  assert.equal(g.fate(), false, '룰렛이 도는 동안엔 아무것도 못 함');
  g.tick(FATE_TIME - 200);
  assert.equal(g.S.phase, 'fate');
  g.until(S => S.phase === 'turn');
  assert.deepEqual(g.S.left, { live: 4, blank: 0 });
  assert.deepEqual(g.ctx.secret.shells, [1, 1, 1, 1]);
  assert.ok(g.S.turnEndsAt - g.now >= 3900, '차례 시간은 멈춰 있었다');
  assert.equal(g.fate(), false, '한 장뿐');

  const spin = (k, ok = true) => {
    g.S.fates[g.S.turn] = 1;
    g.ctx.secret.nextFate = k;
    assert.equal(g.fate(), true);
    g.until(S => S.phase !== 'fate');
    if (ok) assert.equal(g.S.fate.k, k);
  };
  Object.assign(g.S.hp, { [a]: 3, [b]: 1, [c]: 2, [d]: 3 });
  spin('bleed');
  assert.deepEqual([a, b, c, d].map(id => g.S.hp[id]), [2, 1, 1, 2], '마지막 1칸은 안 깎인다 · 쓴 사람도 깎인다');
  g.S.hp[a] = 3;
  spin('heal');
  assert.equal(g.S.hp[a], 4, '가득이어도 한 칸 더');
  g.hand(a, ['peek']);
  g.hand(b, ['double', 'heal']);
  g.hand(c, []);
  g.hand(d, ['cuff']);
  spin('rotate');
  assert.deepEqual([a, b, c, d].map(g.handOf), [['cuff'], ['peek'], ['double', 'heal'], []], '차례 방향으로 한 칸씩');
  spin('reverse');
  assert.deepEqual([nextAlive(g.S, a), nextAlive(g.S, d)], [d, c]);
  spin('gift');
  assert.deepEqual([a, b, c, d].map(id => g.handOf(id).length), [2, 2, 3, 1]);
  g.augs(a, ['vamp']);
  g.augs(b, ['keen', 'chain']);
  spin('myaug');
  assert.ok(g.S.augs[a][0] !== 'vamp' && AUGS[g.S.augs[a][0]].tier === 2, '같은 등급의 다른 것');
  spin('allaug');
  assert.deepEqual(g.S.augs[b].map(x => AUGS[x].tier), [1, 3]);
  assert.ok(!g.S.augs[b].includes('keen') && !g.S.augs[b].includes('chain'));
  g.shells([0, 1, 1]);
  spin('reveal');
  assert.deepEqual(g.S.reveal, { at: shellKey(g.S), live: 0 }, '모두가 본다');
  spin('power');
  g.aim(b);
  g.fire(b);
  assert.equal(g.S.shot.dmg, 3);
  g.until(S => S.phase === 'shot');
  assert.equal(g.S.reveal, null, '쏘면 공개도 끝');

  // 총 교체: 남은 탄을 버리고 새 탄창 (카드는 안 준다), 하던 차례를 그대로 (겨눈 곳 · 두 배)
  g.until(S => S.phase === 'turn');
  const t = g.S.turn;
  const mag = g.S.magNo;
  g.shells([1, 0, 1]);
  g.hand(t, ['double']);
  assert.equal(g.card('double'), true);
  const to = g.S.alive.find(x => x !== t);
  g.aim(to);
  const hands = g.S.alive.map(id => g.S.cards[id]);
  spin('swap');
  assert.equal(g.S.phase, 'load');
  assert.deepEqual([g.S.swap, g.S.dud, g.S.magNo, g.S.dealt], [true, 3, mag + 1, {}]);
  g.until(S => S.phase === 'turn');
  assert.deepEqual([g.S.turn, g.S.aim, g.S.double, g.S.repeat], [t, to, true, false]);
  assert.deepEqual(g.S.alive.map(id => g.S.cards[id]), hands);
});

test('증강: 흡혈귀 · 반사 신경(한 번) · 불사조(한 번) · 도화선 · 연쇄 처치 · 쌍권총(차례마다 한 번)', () => {
  const g = newGame(4);
  const [a, b, c, d] = g.S.order;
  g.shells(Array(12).fill(1));
  g.augs(a, ['vamp']);
  g.S.hp[a] = 2;
  g.fire(c);
  g.react(c);
  g.until(S => S.phase === 'shot');
  assert.deepEqual([g.S.hp[c], g.S.hp[a]], [2, 3], '흡혈 +1');

  g.augs(b, ['reflex']);
  g.turnOf(c);
  g.fire(b);
  g.react(b);
  g.until(S => S.phase === 'shot');
  assert.deepEqual([g.S.shot.mirrored, g.S.hp[b], g.S.hp[c]], [[b], 3, 1], '반사 신경: 저절로 되돌린다');
  g.turnOf(c);
  g.fire(b);
  g.react(b);
  g.until(S => S.phase === 'shot');
  assert.equal(g.S.hp[b], 2, '두 번째는 그냥 맞는다');

  g.augs(d, ['phoenix', 'fuse']);
  g.S.hp[d] = 1;
  g.S.hp[a] = 3;
  g.turnOf(a);
  g.fire(d);
  g.react(d);
  g.until(S => S.phase === 'shot');
  assert.deepEqual([g.S.hp[d], g.S.shot.dead], [1, []], '불사조: 하트 1개로');
  assert.ok(!g.kills.length);
  g.augs(a, ['chain', 'dual']);
  g.turnOf(a);
  g.fire(d);
  g.react(d);
  g.until(S => S.phase === 'shot');
  assert.deepEqual(g.S.shot.dead, [d], '두 번째는 탈락');
  assert.equal(g.S.hp[a], 2, '도화선: 탈락시킨 사람 -1');
  assert.equal(g.S.shot.more, 'chain');
  g.until(S => S.phase === 'turn');
  assert.deepEqual([g.S.turn, g.S.repeat], [a, true], '연쇄 처치: 한 번 더');
  g.fire(b);
  g.react(b);
  g.until(S => S.phase === 'shot');
  assert.equal(g.S.shot.more, 'dual', '쌍권총: 남을 쏘면 한 발 더');
  g.until(S => S.phase === 'turn');
  assert.equal(g.S.turn, a);
  g.S.hp[c] = 3;
  g.fire(c);
  g.react(c);
  g.until(S => S.phase === 'shot');
  assert.deepEqual([g.S.shot.more, g.S.shot.again], [null, false], '차례마다 한 번');
  g.until(S => S.phase === 'turn');
  assert.notEqual(g.S.turn, a);
});

test('증강: 사냥꾼(하트 1개면 방패 관통) · 저격수(돋보기 쓴 발은 받아치기 없음) · 빈총 반격 · 속사 · 복수심 · 화력', () => {
  const g = newGame(3);
  const [a, b, c] = g.S.order;
  g.shells([1, 1, 0, 1, 1, 1, 1, 1]);
  g.augs(a, ['hunter']);
  g.hand(b, ['shield']);
  g.S.hp[b] = 1;
  g.fire(b);
  g.react(b, 'shield');
  g.until(S => S.phase === 'shot');
  assert.deepEqual([g.S.shot.dead, g.S.shot.blocked], [[b], []], '마지막 하트의 방패는 뚫린다');

  g.augs(c, ['sniper']);
  g.turnOf(c);
  g.hand(c, ['peek']);
  g.hand(a, ['mirror']);
  g.card('peek');
  g.fire(a);
  assert.equal(g.S.shot.pierce, true);
  assert.equal(g.react(a, 'mirror'), false, '받아칠 수 없다');
  g.until(S => S.phase === 'shot');
  assert.equal(g.S.hp[a], g.S.maxHp - 1);

  g.augs(a, ['counter']);
  g.turnOf(c);
  g.hand(c, ['cuff']);
  g.hand(a, []);
  g.fire(a); // 공포탄
  g.react(a);
  g.until(S => S.phase === 'shot');
  assert.deepEqual([g.handOf(a), g.handOf(c)], [['cuff'], []], '빈총 반격: 쏜 사람 카드 1장');

  g.augs(c, ['quick', 'revenge', 'fire']);
  g.S.grudges = { [c]: a };
  g.S.hp[a] = 9;
  g.turnOf(c);
  g.tick(QUICK_TIME + 500);
  g.fire(a);
  assert.deepEqual([g.S.shot.quick, g.S.shot.grudge, g.S.shot.dmg], [false, true, 2], '속사는 시간이 지났고, 복수심 +1');
  g.until(S => S.phase === 'shot');
  g.turnOf(c);
  g.hand(c, ['double']);
  g.card('double');
  g.fire(a);
  assert.deepEqual([g.S.shot.quick, g.S.shot.dmg], [true, 5], '화력 두 배 = 3 · 속사 +1 · 복수심 +1');
});

test('증강: 눈치 백단은 장전 때 첫 탄을, 예언자는 탄창 순서를 나만 본다 · 화력은 장전 때 두 배 카드', () => {
  const g = newGame(3);
  const [a, b, c] = g.S.order;
  g.augs(a, ['keen']);
  g.augs(b, ['prophet', 'fire']);
  g.shells([1]);
  g.fire(c);
  g.react(c);
  g.until(S => S.phase === 'load');
  const shells = g.ctx.secret.shells;
  assert.deepEqual(g.priv[a].peek, { key: shellKey(g.S), live: shells[0] });
  assert.deepEqual(g.priv[b].vision, shells);
  assert.equal(g.priv[c].peek, null);
  assert.equal(g.priv[c].vision, null);
  assert.ok(g.handOf(b).includes('double'));
  assert.ok(!JSON.stringify(g.S).includes('vision'), '본 건 상태에 없다');
});
