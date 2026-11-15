import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS, CLASSES, TREES, MARKS, POWERS, POWER_DECK, PASSIVES, DECK, HAND, ENERGY_START, ENERGY_MAX, BOSS, BOSS_HP, BAPTISM,
  WHISPER_CORRUPT, SCAPEGOAT_HEAL,
  setup, onInput, tick, bot, validatePlan, runTurn, norm, makeOffers, canMark, fxOf, costOf, cardsOf, addCorrupt, stOf, _t,
} from '../js/games/raid-core.js';

/* ── 손으로 짠 전투 상태 (규칙만 볼 때) ── */
function rig(heroes, foes = {}, { room = 1, tier = 'elite' } = {}) {
  const ids = heroes.map(h => h[0]);
  const S = norm({ tn: 10, turn: 2, room, tier, party: ids, order: ids, uid: 0 });
  for (const [id, cls] of heroes) {
    const C = CLASSES[cls];
    Object.assign(S.cls, { [id]: cls });
    S.hp[id] = C.hp;
    S.maxHp[id] = C.hp;
    S.block[id] = 0;
    S.energy[id] = 3;
    S.cards[id] = [];
    S.res[id] = { ammo: cls === 'gunner' ? 6 : 0, aim: 0, faith: 0, fp: 0 };
  }
  for (const [k, f] of Object.entries(foes)) S.foes[k] = { block: 0, intent: [], next: [], max: f.hp, ...f };
  return S;
}
// 카드를 준다 (marks = { 몇 번째: 각인 }). 돌려주는 건 카드 번호들
function give(S, id, keys, marks = {}) {
  return keys.map((k, i) => {
    const u = (S.uid += 1);
    S.cards[id] = [...cardsOf(S, id), { u, k, ...(marks[i] ? { m: marks[i] } : {}) }];
    return u;
  });
}
// 낸 차례대로 [[카드, 대상], …] → 따진 계획
const play = (S, id, acts, extra = {}) => validatePlan(S, id, { turn: S.tn, acts: acts.map(([u, t]) => ({ u, t })), ...extra }, acts.map(a => a[0]));

/* ── 실제 단계 흐름 ── */
function newGame(n = 4, prev = null) {
  let clock = 1_000_000;
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const kills = [];
  const priv = {};
  const ctx = {
    roster, now: () => clock, secret: {}, isOnline: () => true, nameOf: id => id,
    setPrivate: (id, d) => { priv[id] = d; }, announce: () => {}, kill: (a, b) => kills.push(`${a}>${b}`),
  };
  ctx.state = { ...setup(ctx, prev), roster };
  const g = {
    ctx, kills, priv,
    get S() { return ctx.state; },
    now: () => clock,
    tick: (ms = 50) => { clock += ms; return tick(ctx); },
    until(fn, max = 40000) {
      for (let i = 0; i < max && !fn(ctx.state); i++) g.tick();
      assert.ok(fn(ctx.state), `기다리던 상태가 안 옴 (지금 ${ctx.state.phase})`);
    },
    input: (pid, type, data) => onInput(ctx, { pid, type, data }),
    // 직업을 정하고 시작 기술은 첫 번째로, 첫 전투의 첫 턴까지
    start(classes = ['guard', 'berserk', 'gunner', 'priest']) {
      g.until(S => S.phase === 'cls');
      roster.forEach((p, i) => g.input(p.id, 'cls', { k: classes[i % classes.length] }));
      for (let k = 0; k < 2; k++) {
        g.until(S => S.phase === 'learn');
        const no = ctx.state.no;
        for (const p of roster) g.input(p.id, 'learn', { no, i: 0 });
        g.until(S => S.no !== no || S.phase !== 'learn');
      }
      g.until(S => S.phase === 'act');
      return g;
    },
    // 손패에 카드 한 장을 넣는다
    cardTo(id, k) {
      const S = ctx.state;
      const u = (S.uid += 1);
      S.cards[id] = [...S.cards[id], { u, k }];
      ctx.secret.piles[id].hand.push(u);
      return u;
    },
    // 이번 턴을 끝까지. plans = { id: [[카드, 대상], …] }
    endTurn(plans = {}, extra = {}) {
      const S = ctx.state;
      const tn = S.tn;
      for (const id of S.party) {
        if (S.down?.[id] || S.ready?.[id]) continue;
        g.input(id, 'plan', { turn: tn, acts: (plans[id] || []).map(([u, t]) => ({ u, t })), ...(extra[id] || {}), ready: true, at: clock });
      }
      g.until(s => s.phase === 'resolve');
      const rs = ctx.state.rs;
      g.until(s => s.phase !== 'resolve');
      return rs;
    },
    // 지금 방의 적을 모두 출혈로 쓰러뜨린다 (턴 끝에)
    clearRoom() {
      for (const k of Object.keys(ctx.state.foes)) ctx.state.st[k] = { bleed: 999 };
      return g.endTurn();
    },
  };
  return g;
}

test('표: 직업 · 계열 · 기술 · 권능이 서로 맞는다', () => {
  for (const [k, C] of Object.entries(CLASSES)) {
    assert.equal(C.deck.length, DECK, `${k} 시작 덱`);
    for (const c of C.deck) assert.ok(CARDS[c]?.cls === k && CARDS[c].tree === 'base', c);
    assert.equal(C.trees.length, 4);
    assert.equal(C.trees.filter(t => TREES[t].dark).length, 1, '금단 계열 하나');
    for (const t of C.trees) {
      const cs = Object.keys(CARDS).filter(x => CARDS[x].tree === t);
      assert.equal(TREES[t].cls, k);
      assert.ok(PASSIVES[`${t}2`], `${t} 숙련`);
      if (TREES[t].dark) {
        assert.equal(cs.length, 3);
        assert.ok(cs.every(x => CARDS[x].dark));
        continue;
      }
      assert.equal(cs.length, 4, t);
      const ults = cs.filter(x => CARDS[x].ult);
      assert.equal(ults.length, 1, `${t} 오의 하나`);
      assert.ok(CARDS[ults[0]].cost >= 4, `${t} 오의는 4 이상`);
      assert.ok(PASSIVES[`${t}4`] && TREES[t].title, `${t} 각성`);
    }
  }
  assert.equal(Object.keys(CARDS).filter(k => CARDS[k].tree === 'common').length, 8);
  assert.equal(Object.keys(MARKS).length, 8);
  assert.equal(POWER_DECK.common.length, 10);
  for (const k of ['guard', 'berserk', 'gunner', 'priest']) assert.equal(POWER_DECK[k].length, 4);
  for (const k of Object.values(POWER_DECK).flat()) assert.ok(POWERS[k], k);
});

test('기력: 시작 3 · 턴마다 +3 · 안 쓰면 남고 6에서 잘린다', () => {
  const g = newGame(4).start();
  const id = g.S.party[0];
  assert.equal(g.S.energy[id], ENERGY_START);
  g.endTurn();
  assert.equal(g.S.energy[id], 6, '안 쓴 3 + 3');
  g.endTurn();
  assert.equal(g.S.energy[id], ENERGY_MAX, '6을 넘는 건 사라진다');
});

test('기력: 모아야 오의가 나간다 · 각성제는 이번 턴 6을 넘겨도 된다 · 격려는 다음 턴', () => {
  const S = rig([['a', 'berserk'], ['b', 'guard']], { '@x': { k: 'golem', hp: 500 } });
  const [ex] = give(S, 'a', ['execute']);
  assert.equal(play(S, 'a', [[ex, '@x']]).cards.length, 0, '기력 3으로는 처형(5)을 못 낸다');
  S.energy.a = 6;
  assert.equal(play(S, 'a', [[ex, '@x']]).cards.length, 1);
  const us = give(S, 'b', ['stim', 'slash', 'slash', 'slash', 'slash']);
  const vp = play(S, 'b', us.map((u, i) => [u, i ? '@x' : null]));
  assert.equal(vp.cards.length, 5, '각성제: 이번 턴 기력 5');
  assert.equal(vp.energyLeft, 1);
  runTurn(S, [vp]);
  assert.equal(S.nxt.b.e, -2, '각성제: 다음 턴 -2');
  const [cheer] = give(S, 'b', ['cheer']);
  S.energy.b = 3;
  runTurn(S, [play(S, 'b', [[cheer, 'a']])]);
  assert.equal(S.nxt.a.e, 2, '격려: 받은 사람의 다음 턴 기력 +2');
});

test('덱: 늘 8장 · 손패 5장 · 쓴 기술은 한 턴 쉬고 돌아온다 · 잔상은 바로', () => {
  const g = newGame(2).start(['guard', 'priest']);
  const S = g.S;
  const id = S.party.find(x => S.cls[x] === 'guard');
  const P = () => g.ctx.secret.piles[id];
  const total = () => P().hand.length + P().draw.length + P().disc.length + P().away.length;
  assert.equal(cardsOf(S, id).length, DECK);
  assert.equal(cardsOf(S, id).filter(c => c.n > 0).length, 2, '시작 기술 2장이 기본기와 바뀌었다');
  assert.equal(g.priv[id].hand.length, HAND);
  assert.equal(total(), DECK);
  const cheap = g.priv[id].hand.filter(c => CARDS[c.k].cost === 1 && CARDS[c.k].to !== 'other').slice(0, 3);
  const rs = g.endTurn({ [id]: cheap.map(c => [c.u, null]) });
  const played = rs.filter(e => e.k === 'use' && e.by === id).length;
  assert.equal(played, cheap.length);
  const hand2 = P().hand;
  assert.equal(hand2.length, HAND);
  assert.ok(cheap.every(c => !hand2.includes(c.u)), '방금 쓴 카드는 다음 턴에 안 온다');
  assert.equal(total(), DECK);
  // 잔상: 쓰면 덱 맨 위로 → 다음 턴에 또 온다
  const echo = hand2.find(u => CARDS[cardsOf(S, id).find(c => c.u === u).k].cost <= 1);
  S.cards[id] = cardsOf(S, id).map(c => (c.u === echo ? { ...c, m: 'echo' } : c));
  g.endTurn({ [id]: [[echo, null]] });
  assert.ok(P().hand.includes(echo), '잔상');
  assert.equal(total(), DECK);
});

test('계획: 기력 · 탄이 모자라거나 손에 없는 카드는 건너뛴다 · 빠른 장전 · 재장전', () => {
  const S = rig([['g', 'gunner']], { '@x': { k: 'golem', hp: 500 } });
  S.res.g.ammo = 1;
  const [s1, s2, ql, s3] = give(S, 'g', ['shot', 'shot', 'quickLoad', 'shot']);
  assert.deepEqual(play(S, 'g', [[s1, '@x'], [s2, '@x']]).cards.map(c => c.u), [s1], '탄 1발');
  const vp = play(S, 'g', [[s1, '@x'], [ql], [s2, '@x'], [s3, '@x']]);
  assert.deepEqual(vp.cards.map(c => c.u), [s1, ql, s2, s3], '빠른 장전 뒤로 두 발 더');
  assert.equal(vp.ammoLeft, 1);
  assert.equal(validatePlan(S, 'g', { turn: S.tn, acts: [{ u: s1, t: '@x' }] }, []).cards.length, 0, '손에 없는 카드');
  S.energy.g = 1;
  S.res.g.ammo = 6;
  assert.equal(play(S, 'g', [[s1, '@x'], [s2, '@x']]).cards.length, 1, '기력 1');
  S.energy.g = 3;
  S.res.g.ammo = 0;
  const r = play(S, 'g', [[s1, '@x'], [s2, '@x']], { q: {} });
  assert.equal(r.cards.filter(c => !c.q).length, 2, '재장전(기력 1) 뒤로 두 발');
  assert.equal(r.ammoLeft, 4);
  assert.equal(r.energyLeft, 0);
});

test('순서: 선제 → 보통(준비 순) → 후속 · 잡힌 적은 안 때린다 · 회복은 적 행동 앞', () => {
  let S = rig([['a', 'berserk'], ['b', 'gunner']], { '@x': { k: 'golem', hp: 500 } });
  const [sun] = give(S, 'a', ['sunder']);
  const [shot] = give(S, 'b', ['shot']);
  runTurn(S, [play(S, 'b', [[shot, '@x']]), play(S, 'a', [[sun, '@x']])]);
  assert.equal(S.foes['@x'].hp, 500 - 5 - 12, '먼저 준비한 b의 사격도 a의 선제 취약을 받는다');
  S = rig([['a', 'berserk'], ['b', 'gunner']], { '@x': { k: 'golem', hp: 35, max: 100 } });
  S.energy.a = 5;
  const [ex] = give(S, 'a', ['execute']);
  const [sh] = give(S, 'b', ['shot']);
  const out = runTurn(S, [play(S, 'a', [[ex, '@x']]), play(S, 'b', [[sh, '@x']])]);
  assert.equal(S.foes['@x'].hp, 0, '늦게 준비한 사격(8)이 먼저 들어가 30% 아래 → 처형 2배');
  assert.deepEqual(out.rs.filter(e => e.k === 'use').map(e => e.by), ['b', 'a']);
  S = rig([['a', 'guard'], ['p', 'priest']], {
    '@g1': { k: 'ghoul', hp: 5, intent: [{ k: 'hit', to: ['a'], v: 6 }] },
    '@g2': { k: 'ghoul', hp: 50, intent: [{ k: 'hit', to: ['p'], v: 12 }] },
  }, { room: 0, tier: 'mob' });
  S.hp.p = 10;
  const [sl] = give(S, 'a', ['slash']);
  const [lh] = give(S, 'p', ['lightHeal']);
  runTurn(S, [play(S, 'a', [[sl, '@g1']]), play(S, 'p', [[lh, 'p']])]);
  assert.equal(S.hp.a, 60, '잡힌 망자는 안 때렸다');
  assert.equal(S.hp.p, 10 + 8 - 12, '회복을 먼저 받고 맞았다');
});

test('피해: 취약 + 그로기 + 강림은 더해서 곱하고, 약화는 따로 곱한다 · 강화로 늘어난 몫은 강화한 사람 기여도', () => {
  let S = rig([['a', 'guard'], ['p', 'priest']], { '@x': { k: 'golem', hp: 500, groggy: 10 } });
  S.st['@x'] = { vuln: 10 };
  S.energy.p = 5;
  const [ds] = give(S, 'p', ['descent']);
  const [sl] = give(S, 'a', ['slash']);
  runTurn(S, [play(S, 'p', [[ds, null]]), play(S, 'a', [[sl, '@x']])]);
  assert.equal(S.foes['@x'].hp, 500 - 15, '6 × (1 + 0.5 + 0.5 + 0.5)');
  assert.equal(S.contrib.p.dmg, 3);
  assert.equal(S.contrib.a.dmg, 12);
  S = rig([['a', 'guard']], { '@x': { k: 'golem', hp: 500 } });
  S.st.a = { weak: 10 };
  const [sl2] = give(S, 'a', ['slash']);
  runTurn(S, [play(S, 'a', [[sl2, '@x']])]);
  assert.equal(S.foes['@x'].hp, 500 - 4, '6 × 0.75');
});

test('표적: 지난 턴 위협도 1위를 노린다 · 버티기 · 가로막기 · 막아 낸 피해', () => {
  let S = rig([['a', 'guard'], ['b', 'gunner']], { '@x': { k: 'golem', hp: 500, i: 0 } });
  S.threat = { b: 30, a: 5 };
  _t.makeIntents(S, () => 0.5);
  assert.deepEqual(S.foes['@x'].intent[0].to, ['b']);
  assert.ok(S.foes['@x'].charge, '골렘: 내려찍기 준비');
  assert.deepEqual(S.foes['@x'].next, ['all'], '다음 턴 행동의 종류');
  const hitB = () => rig([['a', 'guard'], ['b', 'gunner']], { '@x': { k: 'golem', hp: 500, intent: [{ k: 'hit', to: ['b'], v: 14 }] } });
  S = hitB();
  runTurn(S, [validatePlan(S, 'a', { turn: S.tn, acts: [], q: {} }, [])]);
  assert.equal(S.hp.b, 38, '버티기: 단일 공격은 수호자에게');
  assert.equal(S.hp.a, 60 - (14 - 8));
  assert.equal(S.lastBlk.a, 8, '막아 낸 피해 (응수의 재료)');
  assert.equal(S.contrib.a.blk, 8);
  S = hitB();
  const [ic] = give(S, 'a', ['intercept']);
  runTurn(S, [play(S, 'a', [[ic, 'b']])]);
  assert.equal(S.hp.b, 38, '가로막기');
  assert.equal(S.hp.a, 60 - (14 - 6));
});

test('차단: 채우면 필살기가 끊기고 그로기 · 못 채우면 터진다 · 다 막은 사람은 기절 안 함', () => {
  const mk = () => rig([['a', 'berserk'], ['b', 'gunner']], {
    '@x': { k: 'golem', hp: 500, charge: { u: 'slam', fire: 10, need: 8, got: 0, to: ['b'] }, intent: [{ k: 'slam', to: ['b'], v: 24 }] },
  });
  let S = mk();
  S.energy.a = 4;
  const [qk, cl] = give(S, 'a', ['quake', 'cleave']);
  const [sh] = give(S, 'b', ['shot']);
  const out = runTurn(S, [play(S, 'a', [[qk, '@x'], [cl, '@x']]), play(S, 'b', [[sh, '@x']])]);
  assert.ok(out.rs.some(e => e.k === 'groggy'));
  assert.equal(S.hp.b, 38, '내려찍기가 안 나왔다');
  assert.equal(S.foes['@x'].groggy, 11, '이번 턴과 다음 턴');
  assert.equal(S.foes['@x'].hp, 500 - 8 - 11 - 12, '끊긴 뒤에 들어간 사격은 +50%');
  S = mk();
  const [sh2] = give(S, 'b', ['shot']);
  runTurn(S, [play(S, 'b', [[sh2, '@x']])]);
  assert.equal(S.hp.b, 38 - 24, '못 끊으면 터진다');
  S = rig([['a', 'guard'], ['b', 'gunner']], { '@k': { k: 'keeper', hp: 500, intent: [{ k: 'bury', v: 20 }] } }, { room: 2, tier: 'boss' });
  const [fo, pd] = give(S, 'a', ['fortress', 'padded']);
  runTurn(S, [play(S, 'a', [[fo, null], [pd, null]])]);
  assert.equal(S.hp.a, 60, '방어 24로 다 막았다');
  assert.equal(stOf(S, 'a').stun, undefined, '다 막으면 기절 안 함');
  assert.equal(stOf(S, 'b').stun, 11, '맞은 사람은 다음 턴 기절');
});

test('직업 자원: 굳건함 · 피 끓음 · 조준 · 특수탄 · 신앙', () => {
  let S = rig([['a', 'guard']], { '@x': { k: 'golem', hp: 500 } });
  const [fo] = give(S, 'a', ['fortress']);
  runTurn(S, [play(S, 'a', [[fo, null]])]);
  assert.equal(S.block.a, 8, '굳건함: 남은 방어도 16의 절반');
  S = rig([['a', 'berserk']], { '@x': { k: 'golem', hp: 500 } });
  S.hp.a = 32;
  const [ch] = give(S, 'a', ['chop']);
  runTurn(S, [play(S, 'a', [[ch, '@x']])]);
  assert.equal(S.foes['@x'].hp, 500 - (7 + 4), '피 끓음: 잃은 체력 20 → +4');
  S = rig([['g', 'gunner']], { '@x': { k: 'golem', hp: 500 } });
  S.res.g.aim = 3;
  const [s1, s2] = give(S, 'g', ['shot', 'shot']);
  runTurn(S, [play(S, 'g', [[s1, '@x'], [s2, '@x']])]);
  assert.equal(S.foes['@x'].hp, 500 - (8 + 12) - 8, '조준은 다음 한 발에만');
  assert.equal(S.res.g.aim, 0);
  S = rig([['g', 'gunner']], { '@x': { k: 'golem', hp: 500, intent: [{ k: 'hit', to: ['g'], v: 10 }] } });
  S.res.g.aim = 4;
  runTurn(S, []);
  assert.equal(S.res.g.aim, 2, '맞으면 조준이 절반');
  S.res.g.aim = 4;
  S.block.g = 20;
  runTurn(S, []);
  assert.equal(S.res.g.aim, 4, '다 막으면 그대로');
  S = rig([['g', 'gunner']], { '@x': { k: 'golem', hp: 500, block: 10, charge: { u: 'slam', fire: 12, need: 20, got: 0, to: ['g'] } } });
  const [ap, sh] = give(S, 'g', ['apRound', 'shot']);
  runTurn(S, [play(S, 'g', [[ap, null], [sh, '@x']])]);
  assert.equal(S.foes['@x'].hp, 492, '철갑탄: 방어 무시');
  assert.equal(S.foes['@x'].charge.got, 1, '철갑탄: 발마다 차단 1');
  assert.equal(S.res.g.rounds.ap, 2);
  S = rig([['p', 'priest'], ['a', 'guard']], { '@x': { k: 'golem', hp: 500 } });
  S.hp.a = 48;
  const [gh] = give(S, 'p', ['greatHeal']);
  runTurn(S, [play(S, 'p', [[gh, 'a']])]);
  assert.equal(S.hp.a, 60);
  assert.equal(S.res.p.faith, 2, '실제로 회복시킨 12 → 신앙 2 (넘친 6은 안 센다)');
});

test('기술: 방패 강타 · 응수 · 난사 · 저격 · 심판 · 부활 · 가호 · 대속 · 불사 · 생명 전이 · 마탄', () => {
  let S = rig([['a', 'guard']], { '@x': { k: 'golem', hp: 500 } });
  const [fo, ss] = give(S, 'a', ['fortress', 'shieldSlam']);
  runTurn(S, [play(S, 'a', [[fo, null], [ss, '@x']])]);
  assert.equal(S.foes['@x'].hp, 500 - 9, '방패 강타: 방어도 18(성채 16 + 철벽 숙련 2)의 절반');
  S.lastBlk = { a: 13 };
  const [rp] = give(S, 'a', ['riposte']);
  S.energy.a = 3;
  runTurn(S, [play(S, 'a', [[rp, '@x']])]);
  assert.equal(S.foes['@x'].hp, 491 - 13, '응수');
  S = rig([['g', 'gunner']], { '@x': { k: 'golem', hp: 500 } });
  S.energy.g = 4;
  S.res.g.ammo = 5;
  const [sp] = give(S, 'g', ['spray']);
  runTurn(S, [play(S, 'g', [[sp, '@x']])]);
  assert.equal(S.foes['@x'].hp, 500 - 30, '난사: 5발 × 6');
  assert.equal(S.res.g.ammo, 0);
  S = rig([['g', 'gunner']], { '@x': { k: 'golem', hp: 500 } });
  S.energy.g = 4;
  S.res.g.aim = 2;
  const [sn] = give(S, 'g', ['snipe']);
  runTurn(S, [play(S, 'g', [[sn, '@x']])]);
  assert.equal(S.foes['@x'].hp, 500 - (20 + 16), '저격: 조준 보너스 두 배');
  S = rig([['p', 'priest']], { '@x': { k: 'golem', hp: 500 } });
  S.energy.p = 4;
  S.res.p.faith = 5;
  const [jd] = give(S, 'p', ['judgment']);
  runTurn(S, [play(S, 'p', [[jd, '@x']])]);
  assert.equal(S.foes['@x'].hp, 500 - 30, '심판: 10 + 신앙 5 × 4');
  assert.equal(S.res.p.faith, 0);
  S = rig([['p', 'priest'], ['a', 'guard']], { '@x': { k: 'golem', hp: 500 } });
  S.down.a = true;
  S.hp.a = 0;
  S.energy.p = 4;
  const [rv] = give(S, 'p', ['revive']);
  runTurn(S, [play(S, 'p', [[rv, 'a']])]);
  assert.equal(S.down.a, undefined, '부활');
  assert.equal(S.hp.a, 30);
  S = rig([['p', 'priest'], ['a', 'guard']], { '@x': { k: 'golem', hp: 500, intent: [{ k: 'hit', to: ['a'], v: 20 }] } });
  const [wd] = give(S, 'p', ['ward']);
  runTurn(S, [play(S, 'p', [[wd, 'a']])]);
  assert.equal(S.hp.a, 50, '가호: 절반');
  S = rig([['a', 'guard'], ['b', 'gunner']], { '@x': { k: 'golem', hp: 500, intent: [{ k: 'hit', to: ['b'], v: 20 }, { k: 'all', v: 10 }] } });
  const [at] = give(S, 'a', ['atone']);
  runTurn(S, [play(S, 'a', [[at, null]])]);
  assert.equal(S.hp.b, 38, '대속: 다른 아군은 안 맞는다');
  assert.equal(S.hp.a, 60 - 10 - 10 - 5, '대신, 절반으로');
  assert.equal(S.corrupt.a, 1, '금단을 쓰면 타락 +1');
  S = rig([['a', 'guard']], { '@x': { k: 'golem', hp: 500, intent: [{ k: 'hit', to: ['a'], v: 20 }] } });
  S.hp.a = 5;
  const [ud] = give(S, 'a', ['undying']);
  runTurn(S, [play(S, 'a', [[ud, null]])]);
  assert.equal(S.hp.a, 1, '불사');
  S = rig([['p', 'priest'], ['a', 'guard'], ['b', 'gunner']], {});
  S.foes['@x'] = { k: 'golem', hp: 500, max: 500, block: 0, intent: [], next: [] };
  S.hp.b = 10;
  const [tr] = give(S, 'p', ['transfer']);
  runTurn(S, [play(S, 'p', [[tr, 'b']])]);
  assert.equal(S.hp.a, 52, '생명 전이: 체력이 제일 많은 아군에게서 8');
  assert.equal(S.hp.b, 26);
  S = rig([['g', 'gunner'], ['a', 'guard']], { '@x': { k: 'golem', hp: 500, block: 10 } });
  S.hp.a = 20;
  const [cs] = give(S, 'g', ['cursedShot']);
  runTurn(S, [play(S, 'g', [[cs, '@x']])]);
  assert.equal(S.foes['@x'].hp, 482, '마탄: 방어 무시');
  assert.equal(S.hp.a, 15, '체력이 가장 낮은 다른 아군도 5');
});

test('배움: 주력 1 + 다른 계열 1 + 공통 1 · 오의는 2장부터 · 가진 기술은 안 나온다 · 막타 보상은 없다', () => {
  const S = rig([['g', 'gunner']]);
  S.cards.g = CLASSES.gunner.deck.map(k => ({ u: (S.uid += 1), k }));
  const start = makeOffers(S, 'g', 'start1');
  assert.deepEqual(start.map(k => CARDS[k].tree).sort(), ['bomb', 'rapid', 'snipe']);
  assert.ok(start.every(k => !CARDS[k].ult));
  give(S, 'g', ['aim', 'spot']);
  let ult = false;
  for (let i = 0; i < 40; i++) {
    const o = makeOffers(S, 'g', 'room');
    assert.equal(o.length, 3);
    assert.equal(CARDS[o[0]].tree, 'snipe', '주력 계열');
    assert.ok(['rapid', 'bomb'].includes(CARDS[o[1]].tree));
    assert.equal(CARDS[o[2]].tree, 'common');
    assert.ok(!o.includes('aim') && !o.includes('spot'), '가진 기술은 안 나온다');
    assert.ok(!o.some(k => CARDS[k].ult && CARDS[k].tree !== 'snipe'), '오의는 2장 가진 계열만');
    if (o.includes('snipe')) ult = true;
  }
  assert.ok(ult, '저격 2장 → 오의 저격이 나온다');
  S.lastHits = { g: 9 };
  assert.equal(makeOffers(S, 'g', 'room').length, 3, '막타는 상관없다');
  S.mvp = 'g';
  assert.equal(makeOffers(S, 'g', 'room').length, 4, '기여도 1위는 한 장 더');
  S.mvp = null;
  S.downedIn = { g: S.room };
  assert.equal(makeOffers(S, 'g', 'room').length, 2, '쓰러졌던 사람은 한 장 빼기');
});

test('배움 · 각인 · 속삭임: 한 장과 바꾸고, 숙련이 바뀌고, 금단을 받으면 타락 +2', () => {
  const g = newGame(4).start();
  const S = g.S;
  const [a, b] = S.party;
  g.clearRoom();
  assert.equal(S.phase, 'clear');
  g.until(s => s.phase === 'learn');
  const offers = g.priv[a].offers;
  assert.ok(offers.length >= 2);
  const before = cardsOf(S, a).map(c => c.k);
  const drop = cardsOf(S, a).find(c => c.n === 0).u;
  const dropK = cardsOf(S, a).find(c => c.u === drop).k;
  g.input(a, 'learn', { no: S.no, i: 1, drop });
  for (const id of S.party.slice(1)) g.input(id, 'learn', { no: S.no, skip: true });
  g.until(s => s.phase === 'mark');
  assert.equal(cardsOf(S, a).length, DECK, '덱은 8장 그대로');
  assert.ok(cardsOf(S, a).some(c => c.k === offers[1]));
  assert.equal(cardsOf(S, a).filter(c => c.k === dropK).length, before.filter(k => k === dropK).length - 1);
  // 각인: 고른 기술에 새긴다
  const mo = g.priv[a].markOffers;
  const target = cardsOf(S, a).find(c => canMark(c, mo[0]));
  g.input(a, 'mark', { no: S.no, k: mo[0], u: target.u });
  for (const id of S.party.slice(1)) g.input(id, 'mark', { no: S.no, k: g.priv[id].markOffers[0], u: null });
  g.until(s => s.phase === 'whisper');
  assert.equal(cardsOf(S, a).find(c => c.u === target.u).m, mo[0]);
  // 속삭임: a는 받고 나머지는 거절. 다들 타락 0이라 '날카로움'이나 '가벼움'이 새겨진 채로 온다
  const w = g.priv[a].whisper;
  assert.ok(CARDS[w.k].dark && CARDS[w.k].cls === S.cls[a]);
  assert.ok(['keen', 'light'].includes(w.m));
  assert.equal(S.wshow?.[a], undefined, '답은 공개 전까지 상태에 없다');
  g.input(a, 'whisper', { no: S.no, take: true });
  for (const id of S.party.slice(1)) g.input(id, 'whisper', { no: S.no, take: false });
  g.until(s => s.phase === 'wreveal');
  assert.equal(S.corrupt[a], WHISPER_CORRUPT);
  assert.equal(S.corrupt[b], 0);
  assert.ok(cardsOf(S, a).some(c => c.k === w.k && c.m === w.m));
  assert.deepEqual(S.wshow[b], { take: 0 });
  g.until(s => s.phase === 'act' && s.room === 1);
  assert.ok(S.foes['@golem'], '방 2: 살점 골렘');
});

test('타락: 막타 · 딜과 상관없다 · 아군을 쓰러뜨리면 +2 · 세례', () => {
  let S = rig([['a', 'berserk'], ['b', 'gunner']], { '@x': { k: 'golem', hp: 5 } });
  const [ch] = give(S, 'a', ['chop']);
  runTurn(S, [play(S, 'a', [[ch, '@x']])]);
  assert.equal(S.corrupt?.a || 0, 0, '막타로는 타락이 안 오른다');
  S = rig([['a', 'berserk'], ['b', 'gunner']], { '@x': { k: 'golem', hp: 500 } });
  S.hp.b = 4;
  const [ab] = give(S, 'a', ['allyBlood']);
  const out = runTurn(S, [play(S, 'a', [[ab, 'b']])]);
  assert.equal(S.down.b, true);
  assert.equal(S.corrupt.a, 1 + 2, '금단 사용 +1 · 아군을 쓰러뜨림 +2');
  assert.deepEqual(out.downs.map(d => [d.to, d.by]), [['b', 'a']]);
  const g = newGame(3, { state: { boss: 'p1' } });
  assert.equal(g.S.baptism.p1, BAPTISM);
  assert.equal(addCorrupt(g.S, 'p1', 2), 0);
  assert.equal(addCorrupt(g.S, 'p1', 2), 1, '처음 얻는 타락 3은 무효');
});

test('흑화: 타락 1위(6 이상)가 마왕 · 아무도 없으면 이름 없는 왕 · 세례받은 사람은 동률 룰렛에서 빠진다', () => {
  const g = newGame(4).start();
  const S = g.S;
  const [a, b, c, d] = S.party;
  S.corrupt = { [a]: 7, [b]: 3, [c]: 0, [d]: 0 };
  _t.startFall(g.ctx, g.now());
  assert.equal(S.fall.boss, a);
  S.corrupt = { [a]: 5, [b]: 5 };
  _t.startFall(g.ctx, g.now());
  assert.equal(S.fall.boss, 'king');
  S.corrupt = { [a]: 6, [b]: 6 };
  S.baptized = a;
  for (let i = 0; i < 20; i++) {
    _t.startFall(g.ctx, g.now());
    assert.equal(S.fall.boss, b);
  }
});

test('최종전: 계획이 다음 턴 예고가 되고 장막은 ? · 종말을 끊으면 내 둔 계획도 날아간다 · 독박 · 사제도 마왕이 된다', () => {
  const g = newGame(4).start();
  const S = g.S;
  const pr = S.party.find(id => S.cls[id] === 'priest');
  const br = S.party.find(id => S.cls[id] === 'berserk');
  S.corrupt = { [pr]: 8 };
  _t.startFall(g.ctx, g.now());
  _t.startFinal(g.ctx, g.now());
  assert.equal(S.phase, 'boss');
  assert.equal(S.boss, pr);
  assert.equal(S.bossCls, 'priest');
  assert.equal(S.party.length, 3);
  assert.equal(S.foes[BOSS].hp, BOSS_HP[0] + BOSS_HP[1] * 3 + BOSS_HP[2] * 8);
  assert.ok(S.bcards.some(c => c.k === 'plagueB'), '역병의 성자의 권능');
  const U = k => S.bcards.find(c => c.k === k).u;
  const bp = () => g.ctx.secret.piles[BOSS]; // 방장이 손패 묶음을 새로 만들 수 있어서 늘 다시 읽는다
  bp().hand = [U('smite'), U('veil'), U('sweep')];
  S.dark = 3;
  const victim = S.party[0];
  g.input(pr, 'boss', { turn: S.tn + 1, acts: [{ u: U('smite'), t: victim }, { u: U('veil') }], veil: U('smite'), ready: true });
  g.until(s => s.phase === 'act');
  assert.deepEqual(S.foes[BOSS].intent, [{ k: '?' }], '장막에 가린 강타');
  assert.equal(S.dark, 3 - 1 + 3);
  // 원정대가 대응하는 동안 마왕은 다음 턴 계획을 낸다: 종말
  bp().hand = [U('doom'), U('curse')];
  S.dark = 5;
  g.input(pr, 'boss', { turn: S.tn + 1, acts: [{ u: U('doom') }], ready: true });
  const hp0 = S.hp[victim];
  g.endTurn();
  const mult = 1 + 8 * 0.03;
  assert.equal(hp0 - S.hp[victim], Math.floor(16 * mult), '가려졌던 강타가 실제로 나왔다');
  assert.equal(S.foes[BOSS].charge?.u, 'doom', '종말 준비');
  assert.ok(S.foes[BOSS].intent.some(it => it.k === 'charge' && it.u === 'doom'));
  // 다음 턴 계획(휩쓸기)을 내 둔 채, 이번 턴에 종말을 끊는다
  bp().hand = [U('sweep')];
  S.dark = 4;
  g.input(pr, 'boss', { turn: S.tn + 1, acts: [{ u: U('sweep') }], ready: true });
  S.foes[BOSS].charge.got = S.foes[BOSS].charge.need - 2;
  const qk = g.cardTo(br, 'quake');
  S.foes[BOSS].hp = S.foes[BOSS].max - 30;
  const before = S.foes[BOSS].hp;
  const dv = g.cardTo(br, 'devour');
  S.energy[br] = 3;
  const rs = g.endTurn({ [br]: [[dv, BOSS], [qk, BOSS]] });
  assert.ok(rs.some(e => e.k === 'feed' && e.by === br), '독박: 금단을 쓰면 마왕이 회복');
  assert.ok(rs.some(e => e.k === 'groggy' && e.to === BOSS));
  assert.ok(S.foes[BOSS].hp < before);
  assert.deepEqual(S.foes[BOSS].intent, [{ k: 'groggy', until: S.tn }], '내 둔 휩쓸기는 날아갔다');
  assert.ok(S.corrupt[br] >= 1);
});

test('순위: 원정대가 이기면 산 사람 > 마왕 > 쓰러진 사람 · 마왕이 이기면 마왕 1등', () => {
  for (const win of [true, false]) {
    const g = newGame(3).start(['guard', 'berserk', 'gunner']);
    const S = g.S;
    const boss = S.party[2];
    S.corrupt = { [boss]: 9 };
    _t.startFall(g.ctx, g.now());
    _t.startFinal(g.ctx, g.now());
    g.input(boss, 'boss', { turn: S.tn + 1, acts: [], ready: true });
    g.until(s => s.phase === 'act');
    const [h1, h2] = S.party;
    if (win) {
      S.foes[BOSS].hp = 3;
      S.foes[BOSS].block = 0; // 무너지지 않는 성(수호자 마왕)은 턴 시작마다 방어도를 얻는다
      S.hp[h2] = 1;
      S.down[h2] = true;
      g.input(boss, 'boss', { turn: S.tn + 1, acts: [], ready: true });
      const u = g.cardTo(h1, 'mallet');
      g.endTurn({ [h1]: [[u, BOSS]] });
      assert.equal(S.how, 'win');
      assert.deepEqual([h1, boss, h2].map(id => S.standings[id]), [1, 2, 3]);
      assert.ok(S.titles[h1].includes('👑 마왕 토벌'));
      assert.ok(g.kills.includes(`${h1}>${boss}`));
    } else {
      for (const id of S.party) S.hp[id] = 2;
      g.ctx.secret.bossNow = [{ k: 'p', p: 'sweep', v: 30 }];
      g.input(boss, 'boss', { turn: S.tn + 1, acts: [], ready: true });
      g.endTurn();
      assert.equal(S.how, 'lose');
      assert.equal(S.standings[boss], 1);
      assert.ok(S.titles[boss].includes('😈 마왕 강림'));
      assert.ok(g.kills.includes(`${boss}>${h1}`));
    }
    assert.equal(S.over, true);
  }
});

test('판 읽기: 다음 턴 행동의 종류 · 실시간 합계(누가 냈는지는 안 싣는다)', () => {
  const g = newGame(4).start();
  const S = g.S;
  for (const k of Object.keys(S.foes)) assert.deepEqual(S.foes[k].next, ['hit'], '망자는 다음 턴에도 때린다');
  const id = S.party.find(x => S.cls[x] === 'berserk');
  const u = g.cardTo(id, 'chop');
  const fk = Object.keys(S.foes)[0];
  g.input(id, 'plan', { turn: S.tn, acts: [{ u, t: fk }], ready: false });
  for (let i = 0; i < 20; i++) g.tick();
  assert.equal(S.pre.foe[fk], 7);
  assert.equal(JSON.stringify(S.pre).includes('chop'), false);
  assert.deepEqual(S.acts[id], { a: 1 }, '남에게는 때린다는 것만');
});

test('봇끼리 끝까지: 2 · 4 · 8명', () => {
  for (const n of [2, 4, 8]) {
    const g = newGame(n);
    const mem = new Map(g.ctx.roster.map(p => [p.id, {}]));
    let i = 0;
    while (!g.S.over && i++ < 300000) {
      for (const p of g.ctx.roster) {
        const act = bot(g.ctx, p.id, mem.get(p.id));
        if (act) onInput(g.ctx, { pid: p.id, type: act.type, data: act.data });
      }
      g.tick(50);
      if (i % 500 === 0) for (const id of g.S.party || []) assert.equal(cardsOf(g.S, id).length, DECK, '덱은 늘 8장');
    }
    assert.ok(g.S.over, `${n}명 판이 안 끝남 (${g.S.phase}, 방 ${g.S.room}, ${g.S.turn}턴)`);
    assert.equal(Object.keys(g.S.standings).length, n);
  }
});
