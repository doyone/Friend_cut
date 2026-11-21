// 주사위 대장간: 라운드마다 냥으로 주사위를 강화하고, 무작위 상대와 합을 친다. 끝까지 남은 한 명이 이긴다.
// 규칙은 forge-core.js (시제품 proto/forge.html과 같이 씀), 화면은 forge-view.js, 소리는 주사위 합 것(dice-audio.js).
//
// 방장: 판 전체(코어의 game)를 JSON 글자 하나로 ctx.secret.g에 둔다 (Firebase가 빈 배열 · null을 지워도 모양이 안 깨지게).
// 모두에게: S.view(자리 · 보이는 빌드 · 대진 · 이번에 산 것), S.rs(이번 라운드 대결 기록), S.notes(정산 줄) — 전부 JSON 글자.
// 나에게만(ctx.setPrivate): 냥 · 상점 · 지금 빌드. 강화 중엔 남이 이번에 산 게 안 보이고(라운드 시작 모습만), 공개 때 한꺼번에 보인다.
// 단계: intro → weapon(10초) → [shop(25초, 모두 준비하면 바로) → reveal → fight(기록 재생 시간만큼) → settle] × 끝까지 남은 한 명
import { INTRO_TIME, digitOf, isTyping } from '../util.js';
import * as core from './forge-core.js';
import { RULE, GAMBLES, AUGS, TIER_NAME, WEAPON_KEYS } from './forge-core.js';
import { createForgeView } from './forge-view.js';
import { createDiceAudio } from './dice-audio.js';

const GRACE = 300;        // 마감 직전에 보낸 신호가 도착할 시간
const REVEAL_MS = 2200;   // 공개
const SETTLE_MS = 4500;   // 정산
const FIGHT_PAD = 1200;   // 대결 재생 어림에 더 주는 여유
const SLOT_KEYS = [1, 2, 3, 5]; // 상점 칸 숫자키 (4 = 단 올리기, 5 = 🦊 여우 칸)

/* ───────── 방장 ───────── */

let cache = { str: null, g: null };
function G(ctx) {
  const str = ctx.secret.g;
  if (!str) return null;
  if (cache.str !== str) cache = { str, g: JSON.parse(str) };
  return cache.g;
}
function save(ctx, g) {
  const str = JSON.stringify(g);
  ctx.secret.g = str;
  cache = { str, g };
}

// 모두에게 보이는 판. 강화 중엔 남의 빌드 = 라운드 시작 모습(snap). before = 대결 전 체력 · 기세 (대결을 트는 동안 결과가 안 새게)
function publicView(g, phase, before = null) {
  const hide = phase === 'shop';
  return JSON.stringify({
    players: g.players.map(p => {
      const was = before?.[p.id];
      return {
        pid: p.pid, name: p.name, w: p.w, hp: was ? was.hp : p.hp, alive: was ? was.alive : p.alive,
        place: was ? was.place : p.place, mom: was ? was.mom : p.mom, b: p.b ? (hide && p.snap ? p.snap : p.b) : null,
      };
    }),
    pairs: g.pairs.map(pr => ({
      a: g.players[pr.a].pid,
      b: pr.b === null ? null : g.players[pr.b].pid,
      shadow: pr.shadow ? { name: pr.shadow.name, b: pr.shadow.b } : null,
    })),
    bought: hide ? null : Object.fromEntries(g.players.map(p => [p.pid, p.bought])),
  });
}

function sync(ctx, g, i) {
  const p = g.players[i];
  const pr = core.pairOf(g, i);
  let seen = null; // 🧿 꿰뚫어 봄: 상대가 이번에 산 것까지
  if (p.alive && pr && pr.b !== null && core.has(p.b, 'seer')) seen = g.players[pr.a === i ? pr.b : pr.a].b;
  ctx.setPrivate(p.pid, { j: JSON.stringify({ round: g.round, gold: p.gold, income: p.income, shop: p.shop, b: p.b, undo: p.undo.length, curse: p.curse, seen }) });
}
const syncAll = (ctx, g) => g.players.forEach((_, i) => sync(ctx, g, i));
const isBot = (ctx, pid) => !!(ctx.state.roster || ctx.roster || []).find(p => p.id === pid)?.bot;

function startWeapon(ctx, now) {
  Object.assign(ctx.state, { phase: 'weapon', phaseEndsAt: now + RULE.WEAPON_TIME, picks: {} });
  return true;
}

function deal(ctx, now) {
  const g = G(ctx);
  for (const p of g.players) {
    const want = ctx.state.picks?.[p.pid];
    core.pickWeapon(g, p.id, WEAPON_KEYS.includes(want) ? want : WEAPON_KEYS[Math.floor(Math.random() * WEAPON_KEYS.length)]);
  }
  return startRound(ctx, now, g);
}

function startRound(ctx, now, g = G(ctx)) {
  core.beginRound(g);
  save(ctx, g);
  Object.assign(ctx.state, { phase: 'shop', round: g.round, phaseEndsAt: now + RULE.SHOP_TIME, ready: {}, view: publicView(g, 'shop') });
  syncAll(ctx, g);
  return true;
}

function toReveal(ctx, now) {
  const g = G(ctx);
  Object.assign(ctx.state, { phase: 'reveal', phaseEndsAt: now + REVEAL_MS, view: publicView(g, 'reveal') });
  return true;
}

function toFight(ctx, now) {
  const g = G(ctx);
  const before = Object.fromEntries(g.players.map(p => [p.id, { hp: p.hp, alive: p.alive, place: p.place, mom: p.mom }]));
  const res = core.resolveRound(g);
  save(ctx, g);
  // 킬로그: 대결에서 져서 탈락하면 이긴 사람이, 되치기로 쓰러지면 되친 사람이
  for (const f of res.fights) {
    const W = f[f.winner];
    const L = f[core.other(f.winner)];
    if (!L.shadow && !g.players[L.id].alive && before[L.id].alive && !W.shadow) ctx.kill(g.players[W.id].pid, g.players[L.id].pid, '🎲 주사위');
    if (!W.shadow && !L.shadow && f.chase.dmgWinner && !g.players[W.id].alive && before[W.id].alive) ctx.kill(g.players[L.id].pid, g.players[W.id].pid, '🪃 되치기');
  }
  const ms = Math.max(3000, ...res.fights.map(f => Math.max(core.playMs(f), 1250 * f.clashes.length + 600)));
  Object.assign(ctx.state, {
    phase: 'fight', phaseEndsAt: now + ms + FIGHT_PAD, fightNo: (ctx.state.fightNo || 0) + 1,
    rs: JSON.stringify(res.fights), notes: JSON.stringify(res.notes), view: publicView(g, 'fight', before),
  });
  return true;
}

function toSettle(ctx, now) {
  const g = G(ctx);
  Object.assign(ctx.state, { phase: 'settle', phaseEndsAt: now + SETTLE_MS, view: publicView(g, 'settle') });
  syncAll(ctx, g);
  return true;
}

function finish(ctx) {
  const g = G(ctx);
  const n = g.players.length;
  const list = core.titles(g);
  const titles = {};
  for (const t of list) (titles[g.players[t.id].pid] ||= []).push(`${t.icon} ${t.name}`);
  Object.assign(ctx.state, {
    phase: 'final', over: true, view: publicView(g, 'final'), tl: JSON.stringify(list), titles,
    standings: Object.fromEntries(g.players.map(p => [p.pid, n - (p.place || n) + 1])),
    winner: g.players.find(p => p.place === 1)?.pid || null,
  });
  return true;
}

export function setup(ctx, prev) {
  const seed = (Math.floor(Math.random() * 2 ** 31) ^ Date.now()) >>> 0;
  const g = core.newGame({ names: ctx.roster.map(p => p.name), pids: ctx.roster.map(p => p.id), human: -1, seed });
  save(ctx, g);
  return { phase: 'intro', phaseEndsAt: ctx.now() + INTRO_TIME, again: !!prev, round: 0, view: publicView(g, 'intro') };
}

// act = { t: 'slot', i } | { t: 'tier' } | { t: 'reroll' } | { t: 'bet' } | { t: 'undo' }
function cleanAct(a) {
  if (!a || typeof a !== 'object') return null;
  if (a.t === 'slot') { const i = Number(a.i); return Number.isInteger(i) && i >= 0 && i < 4 ? { t: 'slot', i } : null; }
  return ['tier', 'reroll', 'bet', 'undo'].includes(a.t) ? { t: a.t } : null;
}

export function onInput(ctx, { pid, type, data = {} }) {
  const S = ctx.state;
  if (S.over) return false;
  const g = G(ctx);
  if (!g) return false;
  const i = g.players.findIndex(p => p.pid === pid);
  if (i < 0) return false; // 구경하는 사람
  const p = g.players[i];
  if (type === 'weapon') {
    if (S.phase !== 'weapon' || !WEAPON_KEYS.includes(data.w)) return false;
    S.picks = { ...(S.picks || {}), [pid]: data.w };
    return true;
  }
  if (S.phase !== 'shop' || data.round !== g.round) return false;
  if (type === 'auto') { // 봇: 사고 · 걸고 · (유령이면) 저주하고 준비 완료
    if (!isBot(ctx, pid)) return false;
    if (p.alive) {
      core.botShop(g, i, Math.random);
      core.botBet(g, i);
    } else core.botCurse(g, i);
    save(ctx, g);
    S.ready = { ...(S.ready || {}), [pid]: true };
    sync(ctx, g, i);
    return true;
  }
  if (type === 'curse') { // 유령: 살아 있는 사람 하나
    const t = g.players.findIndex(q => q.pid === data.target);
    if (p.alive || t < 0 || !core.curse(g, i, t)) return false;
    save(ctx, g);
    sync(ctx, g, i);
    return true;
  }
  if (!p.alive) return false;
  if (type === 'ready') {
    S.ready = { ...(S.ready || {}), [pid]: !!data.on };
    return true;
  }
  if (type === 'buy') {
    const act = cleanAct(data.act);
    if (!act || !core.buy(g, i, act).ok) return false;
    save(ctx, g);
    sync(ctx, g, i);
    return true;
  }
  return false;
}

export function tick(ctx) {
  const S = ctx.state;
  if (S.over) return false;
  const g = G(ctx);
  if (!g) return false;
  const now = ctx.now();
  const on = pid => ctx.isOnline(pid);
  if (S.phase === 'intro') return now >= S.phaseEndsAt && startWeapon(ctx, now);
  if (S.phase === 'weapon') {
    const waiting = g.players.some(p => !S.picks?.[p.pid] && on(p.pid));
    return (!waiting || now >= S.phaseEndsAt + GRACE) && deal(ctx, now);
  }
  if (S.phase === 'shop') {
    const waiting = g.players.some(p => p.alive && on(p.pid) && !S.ready?.[p.pid]);
    return (!waiting || now >= S.phaseEndsAt + GRACE) && toReveal(ctx, now);
  }
  if (S.phase === 'reveal') return now >= S.phaseEndsAt && toFight(ctx, now);
  if (S.phase === 'fight') return now >= S.phaseEndsAt && toSettle(ctx, now);
  if (S.phase === 'settle') return now >= S.phaseEndsAt && (g.over ? finish(ctx) : startRound(ctx, now, g));
  return false;
}

// 봇: 단계가 바뀌면 사람처럼 조금 있다가. 강화는 코어의 봇 규칙(botShop · botBet · botCurse)을 방장이 대신 돌린다
export function bot(ctx, id, mem) {
  const S = ctx.state;
  if (S.over) return null;
  const now = ctx.now();
  const key = `${S.phase}:${S.round || 0}`;
  if (mem.key !== key) {
    mem.key = key;
    mem.at = now + 900 + Math.random() * (S.phase === 'shop' ? 5000 : 2500);
    mem.done = false;
  }
  if (mem.done || now < mem.at) return null;
  if (S.phase === 'weapon') {
    mem.done = true;
    return { type: 'weapon', data: { w: WEAPON_KEYS[Math.floor(Math.random() * WEAPON_KEYS.length)] } };
  }
  if (S.phase === 'shop') {
    mem.done = true;
    return { type: 'auto', data: { round: S.round } };
  }
  return null;
}

/* ───────── 모두의 화면 ───────── */

export function mount(root, api) {
  const me = api.me;
  const audio = createDiceAudio();
  const view = createForgeView(root, { audio, embed: true });
  let S = null;
  let V = null;
  let P = null;
  let vStr = null;
  let pStr = null;
  let shown = '';      // 지금 그린 화면 (같은 걸 다시 그리지 않게)
  let playing = false; // 대결을 트는 중
  let seenFight = 0;
  let fast = false;
  let msg = '';
  let lastSec = 99;

  const meP = () => V?.players.find(p => p.pid === me) || null;
  const inGame = () => !!meP();
  const idxOf = pid => V.players.findIndex(p => p.pid === pid);
  const pidOf = side => (side.shadow ? null : V.players[side.id]?.pid);
  const totalOf = phase => (phase === 'weapon' ? RULE.WEAPON_TIME : phase === 'shop' ? RULE.SHOP_TIME : 1);
  const left = () => Math.max(0, (S?.phaseEndsAt || 0) - api.now());

  // 화면의 '모두의 자리'가 읽는 모양으로
  function topGame() {
    return { players: V.players.map(p => ({ id: p.pid, name: p.name, hp: p.hp, alive: p.alive, place: p.place, mom: p.mom, w: p.w, b: p.b })) };
  }
  function drawTop(target = null) {
    if (!V) return;
    const shopping = S.phase === 'shop';
    const ready = shopping ? new Set(Object.keys(S.ready || {}).filter(k => S.ready[k])) : null;
    view.top(topGame(), { me, ready, target });
  }
  const sideInfo = (name, b, mom = 0, { bet, shadow = false } = {}) => ({
    name, w: b.w, tier: b.tier, dice: core.diceOf({ ...b, augs: b.augs || [] }), gamble: b.gamble, bet: bet === undefined ? !!b.bet : bet, augs: [...(b.augs || [])], mom, shadow,
  });
  const fighter = (name, b, mom = 0) => ({ name, b: { ...b, augs: [...(b.augs || [])] }, mom, curses: 0 });
  const pairsText = () => V.pairs.map(pr => ({ a: V.players[idxOf(pr.a)]?.name, b: pr.b === null ? pr.shadow?.name : V.players[idxOf(pr.b)]?.name }));

  // 내 상대 (지금 보이는 모습: 라운드 시작 때 빌드, 🧿면 이번에 산 것까지)
  function myOpp() {
    const pr = V.pairs.find(x => x.a === me || x.b === me);
    if (!pr) return null;
    if (pr.b === null) return { f: fighter(pr.shadow.name, pr.shadow.b), info: sideInfo(pr.shadow.name, pr.shadow.b, 0, { shadow: true }), shadow: true };
    const q = V.players[idxOf(pr.a === me ? pr.b : pr.a)];
    const b = P?.seen || q.b;
    return { f: fighter(q.name, b, q.mom), info: sideInfo(q.name, b, q.mom, { bet: P?.seen ? !!b.bet : null }), seen: !!P?.seen };
  }

  function drawShop() {
    const mp = meP();
    if (!P || P.round !== S.round || !P.b) return view.ghost({ watch: true, left: left(), total: RULE.SHOP_TIME, pairs: pairsText() });
    const b = P.b;
    const opp = myOpp();
    const mine = fighter(mp.name, b, mp.mom);
    const pNow = opp ? core.winChance(mine, opp.f) : null;
    const pOf = nb => (opp ? core.winChance(fighter(mp.name, nb, mp.mom), opp.f) : null);
    const items = (P.shop || []).map((s, i) => {
      const inf = core.slotInfo(s);
      const cost = core.slotCost(b, s);
      return {
        key: String(SLOT_KEYS[i]), icon: inf.icon, name: inf.name, text: inf.text, cost, afford: P.gold >= cost, sold: s.sold,
        p: s.sold ? null : pOf(core.applySlotTo(b, s).b), kind: s.t, tier: inf.tier, tierName: s.t === 'aug' ? TIER_NAME[inf.tier] : '',
      };
    });
    const up = core.tierUpOf(b);
    const tier = up ? { text: core.tierUpText(b), cost: RULE.TIER_COST[b.tier + 1], afford: P.gold >= RULE.TIER_COST[b.tier + 1], p: pOf(up) } : { max: true };
    view.shop({
      round: S.round, gold: P.gold, income: P.income, items, tier,
      bet: { has: !!b.gamble, on: !!b.bet, icon: b.gamble ? GAMBLES[b.gamble].icon : '', name: b.gamble ? GAMBLES[b.gamble].name : '' },
      p: pNow, me: sideInfo(mp.name, b, mp.mom), opp: opp?.info || null, oppSeen: !!opp?.seen,
      msg, ready: !!S.ready?.[me], left: left(), total: RULE.SHOP_TIME, pairs: pairsText(),
    });
  }

  function drawGhost() {
    const targets = V.players.map((p, i) => ({ id: p.pid, no: i + 1, name: p.name, hp: p.hp, alive: p.alive })).filter(t => t.alive);
    view.ghost({ targets, target: P?.curse != null ? V.players[P.curse]?.pid : null, left: left(), total: RULE.SHOP_TIME, pairs: pairsText() });
  }

  function boughtText(list) {
    return (list || []).map(x => {
      if (x.k === 'tier') return `⬆️ ${x.to}단`;
      if (x.k === 'whet') return '🔨 숫돌';
      if (x.k === 'gamble') return `${GAMBLES[x.key].icon} ${GAMBLES[x.key].name}`;
      return `${AUGS[x.key].icon} ${AUGS[x.key].name}${x.dropped ? ` (${AUGS[x.dropped].name} 버림)` : ''}`;
    });
  }

  function drawReveal() {
    const rows = V.players.filter(p => p.alive).map(p => ({
      name: p.name, me: p.pid === me, items: boughtText(V.bought?.[p.pid]),
      bet: p.b?.gamble ? `${GAMBLES[p.b.gamble].icon} ${p.b.bet ? '건다' : '안 건다'}` : '',
    }));
    const mp = meP();
    const pr = V.pairs.find(x => x.a === me || x.b === me);
    if (!mp?.alive || !pr) return view.reveal({ rows });
    const q = pr.b === null ? null : V.players[idxOf(pr.a === me ? pr.b : pr.a)];
    const oppB = q ? q.b : pr.shadow.b;
    const oppName = q ? q.name : pr.shadow.name;
    const oppF = fighter(oppName, oppB, q ? q.mom : 0);
    view.reveal({
      rows, me: sideInfo(mp.name, mp.b, mp.mom), opp: sideInfo(oppName, oppB, q ? q.mom : 0, { shadow: !q }),
      p: core.winChance(fighter(mp.name, mp.b, mp.mom), oppF, core.TRIALS.p0),
    });
  }

  function settleRows() {
    const notes = S.notes ? JSON.parse(S.notes) : [];
    const myName = meP()?.name;
    return notes.map(n => {
      if (n.out) return { text: `💀 ${n.out} ${n.place}등`, cls: 'out' };
      if (n.shadow && n.loserHp == null) return { text: `${n.winner} ▶ ${n.loser} +${RULE.SHADOW_WIN}냥`, cls: n.winner === myName ? 'good' : '' };
      const extra = [n.back ? `🪃 −${n.back}` : '', n.heal ? `🧛 +${n.heal}` : '', n.bounty ? `💰 +${n.bounty}냥` : ''].filter(Boolean).join(' ');
      return { text: `${n.winner} ▶ ${n.loser} −${n.dmg}${extra ? ` ${extra}` : ''}`, cls: n.loser === myName ? 'hurt' : n.winner === myName ? 'good' : '' };
    });
  }

  async function playRound() {
    let list = S.rs ? JSON.parse(S.rs) : [];
    if (!list.length) return;
    // 크게 볼 대결: 내 대결 (내가 오른쪽이면 뒤집어서 내 쪽이 왼쪽에), 아니면 대결 전 체력 1등의 대결
    let fi = list.findIndex(f => pidOf(f.a) === me || pidOf(f.b) === me);
    if (fi >= 0 && pidOf(list[fi].b) === me) list = list.map((f, i) => (i === fi ? core.mirrorFight(f) : f));
    if (fi < 0) {
      const hp = f => Math.max(f.a.shadow ? -1 : f.a.hp ?? -1, f.b.shadow ? -1 : f.b.hp ?? -1);
      fi = list.reduce((best, f, i) => (hp(f) > hp(list[best]) ? i : best), 0);
    }
    playing = true;
    view.speed(fast ? 2.2 : 1);
    try {
      await view.fights(list, { featured: fi });
    } finally {
      playing = false;
    }
    shown = '';
    render();
  }

  // 단계마다 그리기. 같은 단계 · 같은 내용이면 다시 안 그린다 (상점은 내 것 · 준비가 바뀔 때)
  function render() {
    if (!S || !V) return;
    if (S.phase === 'fight' || playing) {
      drawTop();
      if (S.phase === 'fight' && (S.fightNo || 0) !== seenFight) {
        seenFight = S.fightNo || 0;
        void playRound();
      }
      return;
    }
    const mp = meP();
    const key = [S.phase, S.round, pStr, JSON.stringify(S.ready || {}), JSON.stringify(S.picks || {}), vStr, msg].join('|');
    if (key === shown) return;
    shown = key;
    drawTop(S.phase === 'shop' && mp && !mp.alive && P?.curse != null ? V.players[P.curse]?.pid : null);
    if (S.phase === 'intro') view.intro({ again: !!S.again });
    else if (S.phase === 'weapon') view.weapon({ left: left(), total: RULE.WEAPON_TIME, pick: S.picks?.[me] || null });
    else if (S.phase === 'shop') {
      if (!mp) view.ghost({ watch: true, left: left(), total: RULE.SHOP_TIME, pairs: pairsText() });
      else if (!mp.alive) drawGhost();
      else drawShop();
    } else if (S.phase === 'reveal') drawReveal();
    else if (S.phase === 'settle') {
      view.settle({ rows: settleRows(), mine: mp ? (mp.alive ? `냥 ${P?.gold ?? 0} · 체력 ${mp.hp}` : `👻 ${mp.place}등`) : '' });
    } else if (S.phase === 'final') {
      const rows = [...V.players].sort((x, y) => (x.place || 99) - (y.place || 99)).map(p => ({
        place: p.place, name: p.name, hp: p.hp, w: p.w, tier: p.b?.tier || 1, augs: p.b?.augs || [], gamble: p.b?.gamble || null, me: p.pid === me,
      }));
      view.over({ rows, titles: S.tl ? JSON.parse(S.tl) : [], quiet: S.winner !== me });
    }
  }

  // 남은 시간 막대 · 마지막 3초 소리 · 무기 고르기 초
  const clock = setInterval(() => {
    if (!S || playing) return;
    const l = left();
    if (S.phase === 'shop' || S.phase === 'weapon') {
      view.tickTimer(l, totalOf(S.phase));
      const sec = Math.ceil(l / 1000);
      if (S.phase === 'shop' && inGame() && sec <= 3 && sec >= 1 && sec < lastSec) audio.count(sec);
      lastSec = sec;
    }
  }, 100);

  function send(act, okMsg) {
    msg = okMsg;
    api.send('buy', { round: S.round, act });
    shown = '';
    render();
  }

  function onKey(e) {
    if (isTyping(e) || !S || S.over) return;
    const c = e.code;
    const d = digitOf(e);
    if (c === 'KeyM') { audio.toggle(); view.toast(audio.enabled ? '소리 켬' : '소리 끔'); return; }
    if (c === 'KeyF') { fast = !fast; view.speed(fast ? 2.2 : 1); view.toast(fast ? '빠르게' : '보통 빠르기'); return; }
    if (playing && c === 'KeyS') { view.skip(); e.preventDefault(); return; }
    if (c === 'Space' || c === 'Backspace') e.preventDefault();
    if (e.repeat || !V) return;
    const mp = meP();
    if (!mp) return; // 구경
    if (S.phase === 'weapon') {
      if (d >= 1 && d <= 4) {
        api.send('weapon', { w: WEAPON_KEYS[d - 1] });
        audio.betLock();
      }
      return;
    }
    if (S.phase !== 'shop') return;
    if (!mp.alive) { // 유령: 숫자키 = 저주할 사람 (위 칸 번호)
      const t = V.players[d - 1];
      if (d >= 1 && t?.alive) {
        api.send('curse', { round: S.round, target: t.pid });
        audio.fizzle();
      }
      return;
    }
    if (!P || P.round !== S.round) return;
    const b = P.b;
    const si = SLOT_KEYS.indexOf(d);
    if (si >= 0 && si < (P.shop || []).length) {
      const s = P.shop[si];
      const cost = core.slotCost(b, s);
      if (s.sold) { msg = '산 것'; audio.thud(); }
      else if (P.gold < cost) { msg = '냥 부족'; audio.thud(); }
      else { audio.chip(3); return send({ t: 'slot', i: si }, core.slotInfo(s).name); }
    } else if (d === 4) {
      const cost = RULE.TIER_COST[b.tier + 1];
      if (b.tier >= 3) { msg = '3단'; audio.thud(); }
      else if (P.gold < cost) { msg = '냥 부족'; audio.thud(); }
      else { audio.chip(3); return send({ t: 'tier' }, `${b.tier + 1}단`); }
    } else if (c === 'KeyR') {
      if (P.gold < RULE.REROLL) { msg = '냥 부족'; audio.thud(); }
      else { audio.tick(); return send({ t: 'reroll' }, ''); }
    } else if (c === 'KeyG') {
      if (!b.gamble) { msg = '도박 없음'; audio.thud(); }
      else { audio.tick(); return send({ t: 'bet' }, ''); }
    } else if (c === 'Backspace') {
      if (!P.undo) { msg = ''; audio.thud(); }
      else { audio.tick(); return send({ t: 'undo' }, ''); }
    } else if (c === 'Space') {
      const on = !S.ready?.[me];
      api.send('ready', { round: S.round, on });
      if (on) audio.betLock(); else audio.tick();
      msg = '';
    } else return;
    shown = '';
    render();
  }
  const unlock = () => void audio.unlock();
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  return {
    update({ state, priv }) {
      const prevPhase = S?.phase;
      const prevRound = S?.round;
      S = state;
      if (S.view !== vStr) { vStr = S.view || null; V = vStr ? JSON.parse(vStr) : null; }
      const pj = priv?.j || null;
      if (pj !== pStr) { pStr = pj; P = pj ? JSON.parse(pj) : null; }
      if (prevPhase !== S.phase || prevRound !== S.round) { msg = ''; lastSec = 99; }
      if (playing && S.phase !== 'fight') view.skip(); // 방장이 다음 단계로 넘어갔다: 남은 재생은 빨리
      render();
    },
    unmount() {
      clearInterval(clock);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      view.destroy();
      audio.dispose();
    },
  };
}

export default {
  id: 'forge',
  title: '주사위 대장간',
  emoji: '⚒️',
  tag: '우정파괴',
  color: '#5d275d',
  desc: '냥으로 주사위를 키우고 아무나와 합을 쳐요. 눈 합이 작으면 주사위가 깨지고, 다 깨지면 체력이 깎여요',
  minPlayers: 2,
  maxPlayers: 8,
  tickMs: 100,
  setup,
  onInput,
  tick,
  bot,
  mount,
};
