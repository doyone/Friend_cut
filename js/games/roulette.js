// 독박 룰렛: 탄창에 실탄·공포탄이 몇 발씩인지만 알고 순서는 모른다 (벅샷룰렛). 내 차례에 카드를 쓰고 한 발을 누군가에게(나 포함) 쏜다.
// 나를 쏴서 공포탄이면 한 번 더, 실탄이면 하트 -1. 남을 쏘면 실탄일 때 그 사람 하트 -1, 어느 쪽이든 차례가 넘어간다.
// 손패는 나만 본다 (갓필드). 남이 나를 쏘면 결과가 나오기 전 3초 동안 🛡️ 방패(막기)·🪞 거울(되돌리기)로 받아칠 수 있다 → 공포탄이면 카드만 날린다.
// 총구가 누구를 향하는지는 모두에게 보인다 (겨누는 척하기). 하트를 다 잃으면 탈락, 마지막 1명 우승.
// 탈락하면 👻 유품: 남은 카드 중 1장을 살아 있는 한 명에게 물려줄 수 있다 (게임은 안 멈춘다).
// 탄 순서와 모두의 손패는 방장만 안다(ctx.secret). 내 손패와 돋보기로 본 탄은 나에게만 온다(ctx.setPrivate). 상태에는 손패 장수만 있다.
// 하트를 깎는 건 언제나 누군가의 한 발이다 (쏜 사람 · 거울 쓴 사람 · 나 자신). 랜덤 이벤트가 대신 깎는 일은 없다.
import { h, digitOf, isTyping, josa, pick, shuffle, INTRO_TIME } from '../util.js';
import { avatar, countdown, podium } from '../ui.js';
import { createRouletteAudio } from './roulette-audio.js';

export const HAND_MAX = 4;
export const TURN_TIME = 10000;
const CARD_BONUS = 4000;      // 카드를 쓰면 마감이 적어도 이만큼 남는다
const TURN_CAP = 20000;       // 그래도 한 차례는 여기까지
const GRACE = 250;            // 마감 직전에 누른 신호가 도착할 시간
export const REACT_TIME = 3000;
const REACT_GRACE = 300;
const REACT_SHOW = 900;       // 맞을 사람이 다 정한 뒤(카드를 내밀고) 결과가 나올 때까지
const SELF_HUSH = 1300;       // 나에게 쏠 때 두근거리는 시간
const SHOW_TIME = 1700;       // 결과를 보여 주는 시간
const DEATH_TIME = 2800;      // 탈락이 나오면 조금 더
export const LOAD_TIME = 3200; // 장전: 앞 절반은 탄을 보여 주고 뒤 절반은 섞어서 숨긴다
const SKIP_TIME = 1300;       // ⛓️ 쉬는 걸 보여 주는 시간
export const WILL_TIME = 8000;
const LOG_KEEP = 7;

// 카드 8종. w = 뽑힐 비율, when = 내 차례(turn)에 쓰나 맞을 때(react) 쓰나, aim = 겨눈 사람에게 쓰는 카드
export const CARDS = {
  peek: { w: 20, e: '🔍', name: '돋보기', tip: '지금 탄을 나만 봐요', when: 'turn' },
  double: { w: 13, e: '🔥', name: '두 배', tip: '이번 발 피해 2칸', when: 'turn' },
  heal: { w: 13, e: '🩹', name: '반창고', tip: '하트 +1', when: 'turn' },
  cuff: { w: 11, e: '⛓️', name: '수갑', tip: '겨눈 사람 다음 차례 쉬기', when: 'turn', aim: true },
  steal: { w: 11, e: '🫳', name: '훔치기', tip: '겨눈 사람 카드 1장 뺏기', when: 'turn', aim: true },
  scatter: { w: 5, e: '💥', name: '산탄', tip: '나 빼고 모두에게 한 발', when: 'turn', rare: true },
  shield: { w: 18, e: '🛡️', name: '방패', tip: '나를 쏜 한 발 막기', when: 'react' },
  mirror: { w: 9, e: '🪞', name: '거울', tip: '쏜 사람에게 되돌리기', when: 'react', rare: true },
};

// 하트: 사람이 많으면 적게 (판이 4분을 넘지 않게)
export const livesOf = n => (n <= 2 ? 4 : n <= 5 ? 3 : 2);
// 탄창: 살아 있는 사람 수 ~ +3발 (3~8발). 실탄 비율은 40%에서 탄창마다 7%p씩 올라 최대 75%, 실탄·공포탄 모두 적어도 1발
export function magOf(alive, no, rand = Math.random) {
  const lo = Math.max(3, Math.min(8, alive));
  const hi = Math.max(lo, Math.min(8, alive + 3));
  const n = lo + Math.floor(rand() * (hi - lo + 1));
  const live = Math.max(1, Math.min(n - 1, Math.round(n * Math.min(0.75, 0.4 + 0.07 * (no - 1)))));
  return { live, blank: n - live };
}
// 장전할 때 받는 카드: 첫 탄창과 4명 이하는 2장, 5명 이상은 1장
export const dealOf = (alive, no) => (no === 1 || alive <= 4 ? 2 : 1);
// 카드 한 장 뽑기 (둘만 남으면 산탄은 그냥 한 발이라 안 나온다)
export function drawCard(alive, rand = Math.random) {
  const keys = Object.keys(CARDS).filter(k => k !== 'scatter' || alive > 2);
  let r = rand() * keys.reduce((a, k) => a + CARDS[k].w, 0);
  for (const k of keys) if ((r -= CARDS[k].w) < 0) return k;
  return 'peek';
}

// 지금 탄을 가리키는 이름: 돋보기로 본 게 '이 탄'인지 확인하는 데 쓴다
export const shellKey = S => `${S.magNo || 0}:${(S.fired || []).length}`;
const inc = (S, key, id, n = 1) => { S[key] = { ...(S[key] || {}), [id]: (S[key]?.[id] || 0) + n }; };
const handOf = (ctx, id) => [...(ctx.secret.hands?.[id] || [])];

// 차례는 앉은 순서대로 (화면에서는 시계 방향)
export function nextAlive(S, id) {
  const i = S.order.indexOf(id);
  for (let k = 1; k <= S.order.length; k++) {
    const x = S.order[(i + k) % S.order.length];
    if (S.alive.includes(x)) return x;
  }
  return id;
}

// 그 사람에게만 보내는 것: 손패와, 돋보기로 본 지금 탄
function tell(ctx, id) {
  const peek = ctx.secret.peeks?.[id];
  ctx.setPrivate(id, { hand: ctx.secret.hands?.[id] || [], peek: peek?.key === shellKey(ctx.state) ? peek : null });
}

function setHand(ctx, id, hand) {
  const S = ctx.state;
  ctx.secret.hands = { ...(ctx.secret.hands || {}), [id]: hand };
  S.cards = { ...(S.cards || {}), [id]: hand.length };
  tell(ctx, id);
}

// 남은 탄 (앞이 지금 탄). 방장이 바뀌다가 개수가 어긋났으면 남은 개수대로 다시 섞는다
function shellsOf(ctx) {
  const { live = 0, blank = 0 } = ctx.state.left || {};
  const cur = ctx.secret.shells || [];
  if (cur.length === live + blank && cur.filter(Boolean).length === live) return [...cur];
  ctx.secret.peeks = {};
  return shuffle([...Array(live).fill(1), ...Array(blank).fill(0)]);
}

function note(ctx, text) {
  const S = ctx.state;
  S.log = [...(S.log || []), text].slice(-LOG_KEEP);
}

function event(S, ev) {
  S.evNo = (S.evNo || 0) + 1;
  S.ev = { no: S.evNo, ...ev };
}

// 장전: 새 탄창을 보여 주고, 살아 있는 사람은 카드를 받는다. 끝나면 nextId의 차례
function load(ctx, now, nextId) {
  const S = ctx.state;
  const n = S.alive.length;
  const dud = S.magNo ? S.left?.blank || 0 : 0; // 공포탄만 남아서 버리는 탄
  S.magNo = (S.magNo || 0) + 1;
  const mag = magOf(n, S.magNo);
  ctx.secret.shells = shuffle([...Array(mag.live).fill(1), ...Array(mag.blank).fill(0)]);
  ctx.secret.peeks = {};
  S.fired = [];
  const k = dealOf(n, S.magNo);
  const dealt = {};
  for (const id of S.alive) {
    const hand = handOf(ctx, id);
    let c = 0;
    for (; c < k && hand.length < HAND_MAX; c++) hand.push(drawCard(n));
    if (c) dealt[id] = c;
    setHand(ctx, id, hand);
  }
  Object.assign(S, {
    phase: 'load', phaseEndsAt: now + LOAD_TIME, mag, left: { ...mag }, dealt, dud, after: nextId,
    turn: null, aim: null, double: false, scatter: false, peeked: false,
  });
  note(ctx, `🔄 탄창 ${S.magNo}: 🔴 실탄 ${mag.live} · ⚪ 공포탄 ${mag.blank}`);
  return true;
}

function openTurn(ctx, now, id) {
  const S = ctx.state;
  // 같은 사람이 이어서 쏘면(나를 쏴서 공포탄 · 맞은 사람이 수갑이라 차례가 돌아옴) 총구는 방금 겨눈 곳 그대로.
  // 차례가 돌아온 걸 못 알아채고 시간이 끝나도 엉뚱하게 나에게 나가지 않는다 (repeat = 화면에 '한 번 더')
  const repeat = S.keepAim?.by === id;
  const keep = repeat && S.alive.includes(S.keepAim.to) ? S.keepAim.to : null;
  Object.assign(S, {
    phase: 'turn', turn: id, turnNo: (S.turnNo || 0) + 1, turnEndsAt: now + TURN_TIME, turnCap: now + TURN_CAP,
    aim: keep, repeat, keepAim: null, double: false, scatter: false, peeked: false,
  });
  return true;
}

// 차례를 넘긴다. 수갑 찬 사람은 건너뛰고(보여 주고), 실탄이 안 남았으면(다 쐈거나 공포탄뿐) 먼저 장전한다.
// fresh = false면 방금 나를 쏴서 공포탄이 나온 사람이 이어서 하는 것
function enter(ctx, now, id, fresh = true) {
  const S = ctx.state;
  if (fresh && S.cuffs?.[id]) {
    const cuffs = { ...S.cuffs };
    delete cuffs[id];
    Object.assign(S, { cuffs, phase: 'skip', skip: id, phaseEndsAt: now + SKIP_TIME, turn: null, aim: null });
    note(ctx, `⛓️ ${ctx.nameOf(id)} 이번 차례 쉼`);
    return true;
  }
  if (!(S.left?.live > 0)) return load(ctx, now, id);
  return openTurn(ctx, now, id);
}

// 방아쇠: 결과는 바로 안 나온다. 남을 쐈으면 맞을 사람이 받아칠 시간을 준다
function fire(ctx, now, to, auto = false) {
  const S = ctx.state;
  const by = S.turn;
  const others = S.alive.filter(id => id !== by);
  const targets = S.scatter ? others : to === by ? [by] : others.includes(to) ? [to] : null;
  if (!targets?.length) return false;
  const self = targets[0] === by;
  S.shotNo = (S.shotNo || 0) + 1;
  S.shot = {
    no: S.shotNo, by, to: targets, self, auto,
    dbl: !!S.double && !S.scatter, sc: !!S.scatter, peeked: !!S.peeked,
    until: now + REACT_TIME,                       // 받아치기 마감 (화면 막대)
    endsAt: now + (self ? SELF_HUSH : REACT_TIME), // 결과가 나오는 시각 (다들 정하면 당겨진다)
  };
  if (self && !auto) inc(S, 'selfs', by);
  S.phase = 'hush';
  return true;
}

function closeWill(ctx, id) {
  const S = ctx.state;
  const wills = { ...(S.wills || {}) };
  delete wills[id];
  S.wills = wills;
  setHand(ctx, id, []);
}

function expireWills(ctx, now) {
  let changed = false;
  for (const [id, until] of Object.entries(ctx.state.wills || {})) {
    if (now < until + GRACE && ctx.isOnline(id)) continue;
    closeWill(ctx, id);
    changed = true;
  }
  return changed;
}

// 결과: 지금 탄을 꺼내 보고, 받아치기를 반영해서 하트를 깎는다
function resolve(ctx, now) {
  const S = ctx.state;
  const shot = S.shot;
  const name = ctx.nameOf;
  const shells = shellsOf(ctx);
  const live = shells.shift() ? 1 : 0;
  ctx.secret.shells = shells;
  ctx.secret.peeks = {};
  S.fired = [...(S.fired || []), live];
  S.left = { live: S.left.live - live, blank: S.left.blank - (1 - live) };

  const dmg = shot.dbl ? 2 : 1;
  const hits = {};     // 누가 몇 칸 잃나
  const blame = {};    // 그 사람 하트는 누구 탓인가 (없으면 스스로)
  const blocked = [];
  const mirrored = [];
  const wasted = [];
  for (const id of shot.to) {
    const r = shot.self ? null : shot.react?.[id];
    if (r === 'shield' || r === 'mirror') {
      if (!live) { // 공포탄이었다: 카드만 날림
        wasted.push(id);
        inc(S, 'wastes', id);
      } else if (r === 'shield') {
        blocked.push(id);
        inc(S, 'blocks', id);
      } else {
        mirrored.push(id);
        inc(S, 'mirrors', id);
        hits[shot.by] = (hits[shot.by] || 0) + dmg;
        blame[shot.by] ||= id;
      }
      continue;
    }
    if (!live) continue;
    hits[id] = dmg;
    if (id !== shot.by) blame[id] = shot.by;
  }
  const hp = { ...S.hp };
  const dead = [];
  for (const [id, d] of Object.entries(hits)) {
    hp[id] = Math.max(0, (hp[id] || 0) - d);
    if (!hp[id]) dead.push(id);
  }
  S.hp = hp;

  // 나를 쏴서 공포탄: 한 번 더. 시간이 끝나 나에게 나간 탄도 쳐 준다 (자리를 비운 사람만 빼고: 혼자 계속 쏘며 판을 끌지 않게)
  const again = shot.self && !live && (!shot.auto || ctx.isOnline(shot.by));
  Object.assign(shot, { live, hits, blocked, mirrored, wasted, dead, again });
  let line = `${name(shot.by)} → ${shot.sc ? '모두' : shot.self ? '자신' : name(shot.to[0])}: ${live ? `🔴 실탄${shot.dbl ? ' ×2' : ''}` : '⚪ 공포탄'}`;
  if (blocked.length) line += ` · 🛡️ ${blocked.map(name).join(', ')}`;
  if (mirrored.length) line += ` · 🪞 ${mirrored.map(name).join(', ')}`;
  if (wasted.length) line += ` · 😅 ${wasted.map(name).join(', ')} 헛카드`;
  if (again) line += ' · 한 번 더';
  note(ctx, line);

  for (const id of dead) {
    const killer = blame[id] || null;
    S.outAt = { ...(S.outAt || {}), [id]: shot.no };
    S.outOrder = [...(S.outOrder || []), id];
    S.dead = { ...(S.dead || {}), [id]: killer || '-' };
    if (killer) {
      ctx.kill(killer, id, id === shot.by ? '🪞 거울 반사' : shot.sc ? '💥 산탄' : shot.dbl ? '🔥 두 배 실탄' : '🔫 실탄');
      inc(S, 'kills', killer);
    } else {
      ctx.announce(shot.auto ? `⏰ ${name(id)} 시간 초과로 나간 탄에 자폭!` : `💥 ${name(id)} 자폭!`);
      S.boomer ||= id;
    }
  }
  if (dead.length) {
    S.alive = S.alive.filter(id => !dead.includes(id));
    const cuffs = { ...(S.cuffs || {}) };
    for (const id of dead) delete cuffs[id];
    S.cuffs = cuffs;
    for (const id of dead) {
      // 👻 유품: 판이 안 끝났고 카드가 남았으면 한 장 물려줄 시간을 준다
      if (S.alive.length >= 2 && handOf(ctx, id).length) S.wills = { ...(S.wills || {}), [id]: now + WILL_TIME };
      else setHand(ctx, id, []);
    }
  }
  S.phase = 'shot';
  S.phaseEndsAt = now + (dead.length ? DEATH_TIME : SHOW_TIME);
  return true;
}

function finish(ctx) {
  const S = ctx.state;
  const ids = (S.roster || ctx.roster).map(p => p.id);
  // 같은 한 발에 같이 탈락했으면 같은 등수
  const at = id => (S.alive.includes(id) ? Infinity : S.outAt?.[id] ?? -1);
  const standings = Object.fromEntries(ids.map(id => [id, ids.length - ids.filter(o => at(o) > at(id)).length]));
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  const top = obj => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])[0] || [];
  if (S.alive[0]) add(S.alive[0], '🔫 최후의 1인');
  const [killer, kills] = top(S.kills);
  if (kills >= 1) add(killer, `🎯 명사수 (${kills}킬)`);
  const [mir, m] = top(S.mirrors);
  if (m >= 1) add(mir, `🪞 반사왕 (${m}번)`);
  const [wall, b] = top(S.blocks);
  if (b >= 2) add(wall, `🛡️ 철벽 (실탄 ${b}번 막음)`);
  const [brave, s] = top(S.selfs);
  if (s >= 3) add(brave, `🎲 강심장 (나에게 ${s}번)`);
  const [oops, w] = top(S.wastes);
  if (w >= 2) add(oops, `😅 헛방패 (${w}번)`);
  if (S.boomer) add(S.boomer, '🤦 자폭 1호');
  for (const id of Object.keys(S.wills || {})) setHand(ctx, id, []);
  Object.assign(S, { standings, titles, winner: S.alive[0] || null, wills: null, turn: null, aim: null, phase: 'final', over: true });
  return true;
}

// 내 차례에 쓰는 카드. 수갑·훔치기는 to(겨눈 사람)가 있어야 한다
function playCard(ctx, now, pid, card, to) {
  const S = ctx.state;
  const def = CARDS[card];
  const hand = handOf(ctx, pid);
  const i = hand.indexOf(card);
  if (def?.when !== 'turn' || i < 0) return false;
  const others = S.alive.filter(id => id !== pid);
  const name = ctx.nameOf;
  hand.splice(i, 1);
  if (card === 'peek') {
    if (ctx.secret.peeks?.[pid]?.key === shellKey(S)) return false; // 이미 본 탄
    const shells = shellsOf(ctx);
    ctx.secret.shells = shells;
    ctx.secret.peeks = { ...(ctx.secret.peeks || {}), [pid]: { key: shellKey(S), live: shells[0] ? 1 : 0 } };
    S.peeked = true;
  } else if (card === 'double') {
    if (S.double || S.scatter) return false; // 산탄에는 두 배가 안 붙는다
    S.double = true;
  } else if (card === 'scatter') {
    if (S.double || S.scatter) return false;
    S.scatter = true;
    S.aim = null;
  } else if (card === 'heal') {
    if ((S.hp?.[pid] || 0) >= S.maxHp) return false;
    S.hp = { ...S.hp, [pid]: S.hp[pid] + 1 };
  } else if (card === 'cuff') {
    if (!others.includes(to) || S.cuffs?.[to]) return false;
    S.cuffs = { ...(S.cuffs || {}), [to]: true };
  } else if (card === 'steal') {
    const theirs = handOf(ctx, to);
    if (!others.includes(to) || !theirs.length) return false;
    hand.push(theirs.splice(Math.floor(Math.random() * theirs.length), 1)[0]);
    setHand(ctx, to, theirs);
  }
  setHand(ctx, pid, hand);
  event(S, { k: card, by: pid, to: def.aim ? to : null });
  note(ctx, `${def.e} ${name(pid)} ${def.name}${def.aim ? ` → ${name(to)}` : ''}`);
  S.turnEndsAt = Math.min(S.turnCap, Math.max(S.turnEndsAt, now + CARD_BONUS));
  return true;
}

/* ───────── 봇: 자기 손패·자기가 본 탄·모두에게 보이는 것만 쓴다 ───────── */

function botReact(ctx, id, mem, hand, now) {
  const S = ctx.state;
  const shot = S.shot;
  if (!shot || shot.self || !shot.to.includes(id) || shot.react?.[id]) return null;
  if (mem.shot !== shot.no) {
    const p = S.left.live / Math.max(1, S.left.live + S.left.blank);
    const dmg = shot.dbl ? 2 : 1;
    // 겁: 실탄 확률 (쏜 사람이 돋보기를 썼으면 크게), 두 배면 더, 이번에 죽을 수 있으면 더
    const fear = (shot.peeked ? Math.max(p, 0.9) : p) + (shot.dbl ? 0.15 : 0) + ((S.hp?.[id] || 0) <= dmg ? 0.2 : 0);
    Object.assign(mem, {
      shot: shot.no,
      reactAt: now + 450 + Math.random() * 1100,
      reactWith: hand.includes('mirror') && Math.random() < fear ? 'mirror'
        : hand.includes('shield') && Math.random() < fear * 0.9 ? 'shield' : null,
    });
  }
  if (now < mem.reactAt) return null;
  return { type: 'react', data: { shot: shot.no, card: mem.reactWith } };
}

function botTurn(ctx, id, mem, hand, now) {
  const S = ctx.state;
  if (mem.turn !== S.turnNo) Object.assign(mem, { turn: S.turnNo, at: now + 700 + Math.random() * 900, plan: null, swept: 0, tried: {} });
  if (now < mem.at) return null;
  const wait = (ms = 500) => { mem.at = now + ms + Math.random() * 500; };
  const once = k => !mem.tried[k] && (mem.tried[k] = true); // 카드마다 한 차례에 한 번만 고민
  const data = { turn: S.turnNo };
  const card = (c, to) => { wait(); return { type: 'card', data: { ...data, card: c, to: to || null } }; };
  const others = S.alive.filter(x => x !== id);
  const seen = ctx.secret.peeks?.[id];
  const known = seen?.key === shellKey(S) ? seen.live : null;

  if (hand.includes('heal') && (S.hp?.[id] || 0) < S.maxHp && once('heal')) return card('heal');
  if (known == null && hand.includes('peek') && S.left.blank > 0 && once('peek') && Math.random() < 0.85) return card('peek');
  if (hand.includes('steal') && once('steal') && Math.random() < 0.6) {
    const rich = others.filter(x => S.cards?.[x] > 0).sort((a, b) => S.cards[b] - S.cards[a])[0];
    if (rich) return card('steal', rich);
  }
  if (hand.includes('cuff') && once('cuff') && Math.random() < 0.5) {
    const t = nextAlive(S, id);
    if (t !== id && !S.cuffs?.[t]) return card('cuff', t);
  }
  if (!mem.plan) {
    const p = known ?? S.left.live / Math.max(1, S.left.live + S.left.blank);
    if (p < 0.5 && !(p > 0.34 && Math.random() < p)) mem.plan = { to: id }; // 공포탄일 것 같으면 나에게 (한 번 더)
    else {
      const low = Math.min(...others.map(x => S.hp?.[x] || 0));
      const grudge = others.includes(mem.grudge) ? mem.grudge : null;
      const r = Math.random();
      const to = grudge && r < 0.35 ? grudge : r < 0.7 ? pick(others.filter(x => (S.hp?.[x] || 0) === low)) : pick(others);
      mem.plan = { to, sweeps: Math.random() < 0.6 ? 1 + Math.floor(Math.random() * 2) : 0 };
      if (!S.double && !S.scatter) {
        if (others.length >= 2 && hand.includes('scatter') && p >= 0.5 && Math.random() < 0.7) mem.plan.card = 'scatter';
        else if (hand.includes('double') && p >= 0.6 && Math.random() < 0.8) mem.plan.card = 'double';
      }
    }
  }
  if (mem.plan.card) {
    const c = mem.plan.card;
    mem.plan.card = null;
    return card(c);
  }
  // 총구를 한두 번 돌리다가(겨누는 척) 쏜다
  if (!S.scatter) {
    if (mem.swept < (mem.plan.sweeps || 0)) {
      mem.swept += 1;
      wait(350);
      return { type: 'aim', data: { ...data, to: pick(others) } };
    }
    if ((S.aim || null) !== mem.plan.to) {
      wait(450);
      return { type: 'aim', data: { ...data, to: mem.plan.to } };
    }
  }
  wait(2000);
  return { type: 'fire', data: { ...data, to: mem.plan.to }, say: Math.random() < 0.08 };
}

/* ───────── 화면: 도트 그림은 art/roulette.px.js (pxl)로 그려서 img/roulette/sprites 에 구운 것 ───────── */

const ART = new URL('../../img/roulette/sprites/', import.meta.url).href;
const PX = 3; // 도트 한 칸 = 화면 3px (그림도 효과도 전부 같은 크기)
const SIZE = { // 그림 크기 (도트). 여기 없는 건 16×16
  gun_aim_l: [78, 58], gun_aim_c: [78, 58], gun_aim_r: [78, 58], shell_live: [8, 13], shell_blank: [8, 13], shell_q: [8, 13], heart: [9, 9], heart_off: [9, 9],
  cardback: [7, 9], cross: [17, 17], skull: [9, 9], eye: [11, 7], c_steal: [16, 13], c_shield: [16, 15],
};
// 총: 위에서 내려다본 그림을 15도마다 구워 뒀다. gun_0(위) … gun_6(오른쪽) … gun_12(아래), 왼쪽은 좌우로 뒤집는다
const GUN_STEP = 15;
const MUZZLE = 27; // 그림 가운데에서 총구 끝까지 (도트)
const GUN_PULL = 0.42; // 총 자리: 쏘는 사람 자리에서 테이블 가운데 쪽으로 이만큼 (그 사람 바로 앞)
for (let k = 0; k <= 180 / GUN_STEP; k++) SIZE[`gun_${k}`] = [60, 60];
function spr(name, cls = '', scale = PX) {
  const [w, hh] = SIZE[name] || [16, 16];
  return h('img', { class: `rl-spr ${cls}`, src: `${ART}${name}.png`, alt: '', draggable: 'false', width: w * scale, height: hh * scale });
}

export default {
  id: 'roulette',
  title: '독박 룰렛',
  emoji: '🔫',
  tag: '심리',
  color: '#d63031',
  desc: '실탄·공포탄이 몇 발인지만 알아요. 카드를 쓰고 누군가에게(나에게도) 한 발! 맞을 사람은 3초 안에 🛡️ 방패·🪞 거울로 받아치기. 손패는 나만 봐요',
  minPlayers: 2,
  maxPlayers: 8,
  tickMs: 50, // 받아치기 마감·결과가 제때 나오게 자주 본다 (보내는 건 바뀔 때만)

  setup(ctx, prev) {
    const ids = shuffle(ctx.roster.map(p => p.id));
    const maxHp = livesOf(ids.length);
    return {
      phase: 'intro',
      phaseEndsAt: ctx.now() + INTRO_TIME,
      again: !!prev,
      order: ids, // 앉은 순서 = 차례 순서
      alive: [...ids],
      maxHp,
      hp: Object.fromEntries(ids.map(id => [id, maxHp])),
      cards: Object.fromEntries(ids.map(id => [id, 0])),
      magNo: 0,
      turnNo: 0,
      shotNo: 0,
    };
  },

  onInput(ctx, { pid, type, data = {} }) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.over) return false;
    if (type === 'will') { // 👻 유품: 남은 카드 중 한 장을 살아 있는 사람에게 (나머지는 버려진다)
      const until = S.wills?.[pid];
      const to = data.to;
      if (!until || now > until + GRACE || !S.alive.includes(to) || (S.cards?.[to] || 0) >= HAND_MAX) return false;
      if (!handOf(ctx, pid).includes(data.card)) return false;
      setHand(ctx, to, [...handOf(ctx, to), data.card]);
      closeWill(ctx, pid);
      event(S, { k: 'will', by: pid, to });
      note(ctx, `👻 ${ctx.nameOf(pid)}의 유품 → ${ctx.nameOf(to)}`);
      return true;
    }
    if (type === 'react') { // 받아치기: 카드 이름(방패·거울) 또는 null(그냥 맞기)
      const shot = S.shot;
      if (S.phase !== 'hush' || !shot || shot.self || data.shot !== shot.no) return false;
      if (!shot.to.includes(pid) || shot.react?.[pid]) return false;
      let r = 'pass';
      if (data.card) {
        const hand = handOf(ctx, pid);
        const i = hand.indexOf(data.card);
        if (CARDS[data.card]?.when !== 'react' || i < 0) return false;
        hand.splice(i, 1);
        setHand(ctx, pid, hand);
        r = data.card;
      }
      shot.react = { ...(shot.react || {}), [pid]: r };
      return true;
    }
    if (S.phase !== 'turn' || pid !== S.turn || data.turn !== S.turnNo) return false;
    if (type === 'aim') { // 총구 돌리기 (모두에게 보인다)
      const to = S.alive.includes(data.to) && !S.scatter ? data.to : null;
      if ((S.aim || null) === to) return false;
      S.aim = to;
      return true;
    }
    if (type === 'card') return playCard(ctx, now, pid, data.card, data.to);
    if (type === 'fire') return fire(ctx, now, data.to);
    return false;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    const willed = expireWills(ctx, now);
    if (S.phase === 'intro') return now >= S.phaseEndsAt && load(ctx, now, S.order[0]);
    if (S.phase === 'load') {
      if (now < S.phaseEndsAt) return willed;
      return openTurn(ctx, now, S.alive.includes(S.after) ? S.after : nextAlive(S, S.after));
    }
    if (S.phase === 'skip') return now >= S.phaseEndsAt ? enter(ctx, now, nextAlive(S, S.skip)) : willed;
    if (S.phase === 'turn') {
      if (ctx.isOnline(S.turn) && now < S.turnEndsAt + GRACE) return willed;
      // 시간 끝: 총구가 향한 사람에게 (아무도 안 겨눴으면 나에게) 그대로 나간다
      return fire(ctx, now, S.alive.includes(S.aim) ? S.aim : S.turn, true) || willed;
    }
    if (S.phase === 'hush') {
      const shot = S.shot;
      let changed = willed;
      if (!shot.self && !shot.rushed && !shot.to.some(id => !shot.react?.[id] && ctx.isOnline(id))) {
        shot.rushed = true; // 맞을 사람이 다 정했다: 조금만 보여 주고 결과
        shot.endsAt = now + REACT_SHOW;
        changed = true;
      }
      if (now >= shot.endsAt + (shot.self || shot.rushed ? 0 : REACT_GRACE)) return resolve(ctx, now);
      return changed;
    }
    if (S.phase === 'shot') {
      if (now < S.phaseEndsAt) return willed;
      if (S.alive.length <= 1) return finish(ctx);
      const { by, again } = S.shot;
      S.keepAim = { by, to: S.shot.self ? by : S.shot.to.length === 1 ? S.shot.to[0] : null };
      return again && S.alive.includes(by) ? enter(ctx, now, by, false) : enter(ctx, now, nextAlive(S, by));
    }
    return willed;
  },

  // 봇: 실탄 확률이 높으면 남에게, 낮으면 나에게. 돋보기 먼저, 하트가 깎였으면 반창고, 총구를 한두 번 돌리다 쏜다.
  // 겨눠지면 확률(쏜 사람이 돋보기를 썼으면 높게 본다)에 따라 받아친다. 탈락하면 나를 죽인 사람만 빼고 아무에게나 유품
  bot(ctx, id, mem) {
    const S = ctx.state;
    const now = ctx.now();
    const hand = ctx.secret.hands?.[id] || [];
    const shot = S.shot;
    if (S.phase === 'shot' && shot?.hits?.[id] && mem.hurt !== shot.no) { // 나를 맞힌 사람을 기억한다
      mem.hurt = shot.no;
      mem.grudge = shot.by !== id ? shot.by : shot.mirrored?.[0] || null;
    }
    if (S.wills?.[id]) {
      mem.willAt ||= now + 1200 + Math.random() * 1500;
      if (now < mem.willAt || !hand.length) return null;
      const room = S.alive.filter(x => (S.cards?.[x] || 0) < HAND_MAX);
      const pool = room.filter(x => x !== S.dead?.[id]);
      const to = pick(pool.length ? pool : room);
      mem.willAt = now + 600;
      return to ? { type: 'will', data: { to, card: pick(hand) } } : null;
    }
    if (!S.alive.includes(id)) return null;
    if (S.phase === 'hush') return botReact(ctx, id, mem, hand, now);
    if (S.phase === 'turn' && S.turn === id) return botTurn(ctx, id, mem, hand, now);
    return null;
  },

  mount(root, api) {
    const me = api.me;
    const audio = createRouletteAudio();
    const head = h('div', { class: 'rx-head' });
    const fx = h('canvas', { class: 'rl-fx' });
    const flashEl = h('div', { class: 'rl-flash' });
    const mag = h('div', { class: 'rl-mag' });
    const count = h('div', { class: 'rl-count' });
    const banner = h('div', { class: 'rl-banner' });
    const gunImg = spr('gun_6', 'rl-top');
    for (const name of [...Array.from({ length: 180 / GUN_STEP + 1 }, (_, k) => `gun_${k}`), 'gun_aim_l', 'gun_aim_c', 'gun_aim_r']) {
      new Image().src = `${ART}${name}.png`; // 처음 쓸 때 그림이 늦게 뜨지 않게
    }
    // 누가 나를 쏘면(결과 전) 다가오는 총: 쏘는 사람이 앉은 쪽(내 왼쪽 · 맞은편 · 내 오른쪽)에 맞춘 원근 그림
    const frontImg = spr('gun_aim_c', 'rl-front');
    const gun = h('div', { class: 'rl-gun' }, gunImg, frontImg);
    const table = h('div', { class: 'rl-table' },
      h('div', { class: 'rl-felt' }), h('div', { class: 'rl-center' }, mag, count, banner), gun, fx, flashEl);
    const prompt = h('div', { class: 'rl-prompt' });
    const handEl = h('div', { class: 'rl-hand' });
    const timer = h('div', { class: 'rl-timer' });
    const panel = h('div', { class: 'rl-panel' }, prompt, handEl, timer);
    const board = h('div', { class: 'rl-board' });
    const sound = h('button', { class: 'rl-sound', type: 'button', tabindex: '-1' });
    const box = h('div', { class: 'rl-box' }, table, panel, board, sound);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'rl' }, h('div', { class: 'rl-main' }, head, box), side));
    document.activeElement?.blur?.();
    document.fonts?.load('22px "Galmuri11"', '독박 룰렛 철컥 탕 틱').catch(() => {});

    let S = null;
    let P = null;
    let seatKey = '';
    const seats = new Map();   // pid → { el, face, hearts, cards, tags, show, x, y, key }
    let aimLocal = null;       // 내 차례에 내가 겨눈 사람 (방장 답을 안 기다리고 내 화면에서 먼저 움직인다)
    let aimTimer = null;
    let aimSentAt = 0;
    let heir = null;           // 유품 받을 사람 (내 화면에서만)
    const sent = { fire: -1, react: -1, will: false, cardAt: 0 };
    let seen = null;           // 이미 연출한 것 (중간에 들어와도 지난 장면을 다시 틀지 않게)
    let hint = null;           // 잠깐 띄우는 안내 { text, cls, until }
    let gunFront = false;
    let pose = { k: 6, flip: false, deg: 0 }; // 지금 그린 총 방향 (deg = 총구가 향한 화면 각도)
    let lastAimed = null;
    let holder = null;                        // 총을 앞에 둔 사람 (지금 쏘는 사람)
    let spot = { x: 50, y: 50 };              // 총 자리 (테이블의 %)
    let wasAimMe = false;
    let bannerNo = 0;
    const keys = { head: '', mag: '', panel: '', timer: '', side: '' };
    const timers = new Set();
    const later = (ms, fn) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };
    const who = id => S.roster.find(p => p.id === id) || { id, name: '?' };
    const nameOf = id => who(id).name;
    const alive = id => S.alive.includes(id);
    const inGame = () => S.roster.some(p => p.id === me);
    const myHand = () => P?.hand || [];
    const myPeek = () => (P?.peek && P.peek.key === shellKey(S) ? P.peek : null);

    const soundLabel = () => { sound.textContent = audio.enabled ? '소리 켜짐' : '소리 꺼짐'; };
    soundLabel();
    sound.addEventListener('click', () => {
      audio.toggle();
      soundLabel();
      sound.blur();
    });
    const unlock = () => { void audio.unlock(); };
    window.addEventListener('pointerdown', unlock);

    // 지금 내가 할 수 있는 것: turn(내 차례) · react(받아치기) · will(유품) · null
    function modeOf() {
      if (!S || S.over) return null;
      if (S.wills?.[me]) return sent.will ? null : 'will';
      if (!alive(me)) return null;
      if (S.phase === 'turn' && S.turn === me && sent.fire !== S.turnNo) return 'turn';
      const shot = S.shot;
      if (S.phase === 'hush' && !shot.self && shot.to.includes(me) && !shot.react?.[me] && sent.react !== shot.no) return 'react';
      return null;
    }

    function usable(card, mode) {
      const def = CARDS[card];
      if (mode === 'will') return true;
      if (mode === 'react') return def.when === 'react';
      if (mode !== 'turn' || def.when !== 'turn') return false;
      if (card === 'heal') return (S.hp?.[me] || 0) < S.maxHp;
      if (card === 'double' || card === 'scatter') return !S.double && !S.scatter;
      if (card === 'peek') return !myPeek();
      return true;
    }

    // 살아 있는 사람들: 내 자리부터 시계 방향 (유품 받을 사람 처음 고를 때)
    function ring() {
      const i = Math.max(0, S.order.indexOf(me));
      return [...S.order.slice(i), ...S.order.slice(0, i)].filter(alive);
    }
    // 내 자리(아래)에서 본 방향: 0 = 정면(맞은편), 음수 = 왼쪽, 양수 = 오른쪽
    function sideAngle(id) {
      const m = seats.get(me);
      const s = seats.get(id);
      return Math.atan2(s.x - m.x, m.y - s.y);
    }
    const others = () => S.alive.filter(id => id !== me && seats.has(id)).sort((a, b) => sideAngle(a) - sideAngle(b));
    // ← → : 내가 보는 방향 기준 왼쪽 · 오른쪽 사람으로 (끝에서는 멈춘다).
    // 아직 안 겨눴거나 나를 겨누던 중이면 그쪽에 앉은 사람 중 정면에 가장 가까운 사람부터 (그쪽에 아무도 없으면 맞은편)
    function stepSide(cur, dir) {
      const list = others();
      if (!list.length) return cur;
      const i = list.indexOf(cur);
      if (i >= 0) return list[Math.max(0, Math.min(list.length - 1, i + dir))];
      const side = dir < 0 ? [...list].reverse().find(id => sideAngle(id) < -0.05) : list.find(id => sideAngle(id) > 0.05);
      return side || opposite();
    }
    const opposite = () => [...others()].sort((a, b) => Math.abs(sideAngle(a)) - Math.abs(sideAngle(b)))[0] || null;

    function say(text, cls = 'hint', ms = 1800) {
      hint = { text, cls, until: performance.now() + ms };
      later(ms + 30, paintPanel);
      paintPanel();
    }
    function nope(text) {
      panel.classList.remove('nope');
      void panel.offsetWidth;
      panel.classList.add('nope');
      say(text, 'warn');
    }

    function setAim(id) {
      aimLocal = id || null;
      if (!aimTimer) {
        aimTimer = setTimeout(() => { // 방향키를 연타해도 0.12초에 한 번만 보낸다
          aimTimer = null;
          aimSentAt = performance.now();
          if (S?.phase === 'turn' && S.turn === me && sent.fire !== S.turnNo && !S.scatter) api.send('aim', { turn: S.turnNo, to: aimLocal });
        }, Math.max(0, 120 - (performance.now() - aimSentAt)));
      }
      hint = null;
      paint();
    }

    function fireNow() {
      if (!S.scatter && !aimLocal) return nope('먼저 ← → 로 겨누세요 (↓ = 나)');
      sent.fire = S.turnNo;
      api.send('fire', { turn: S.turnNo, to: S.scatter ? null : aimLocal });
      hint = null;
      paint();
    }

    function react(card) {
      sent.react = S.shot.no;
      api.send('react', { shot: S.shot.no, card });
      hint = null;
      paint();
    }

    function useCard(i) {
      const card = myHand()[i];
      const mode = modeOf();
      if (!card || !mode) return;
      const def = CARDS[card];
      if (mode === 'will') {
        if (!heir || !alive(heir)) return nope('← → 로 받을 사람을 고르세요');
        if ((S.cards?.[heir] || 0) >= HAND_MAX) return nope(`${nameOf(heir)}의 손패가 꽉 찼어요`);
        sent.will = true;
        api.send('will', { to: heir, card });
        return paint();
      }
      if (mode === 'react') {
        if (def.when !== 'react') return nope('지금은 방패·거울만 쓸 수 있어요');
        return react(card);
      }
      if (def.when !== 'turn') return nope('누가 나를 쐈을 때 쓰는 카드예요');
      if (card === 'heal' && !usable(card, mode)) return nope('하트가 꽉 찼어요');
      if (card === 'peek' && !usable(card, mode)) return nope('이미 본 탄이에요');
      if (!usable(card, mode)) return nope('두 배와 산탄은 같이 못 써요');
      let to = null;
      if (def.aim) {
        to = aimLocal;
        if (!to || to === me) return nope('먼저 ← → 로 상대를 겨누세요');
        if (card === 'cuff' && S.cuffs?.[to]) return nope('이미 수갑을 찼어요');
        if (card === 'steal' && !(S.cards?.[to] > 0)) return nope('카드가 없는 사람이에요');
      }
      if (performance.now() < sent.cardAt) return; // 연타 방지
      sent.cardAt = performance.now() + 350;
      api.send('card', { turn: S.turnNo, card, to });
    }

    function onKey(e) {
      if (isTyping(e) || !S) return;
      const c = e.code;
      const d = digitOf(e);
      const dir = c === 'ArrowLeft' || c === 'KeyA' ? -1 : c === 'ArrowRight' || c === 'KeyD' ? 1 : 0;
      const down = c === 'ArrowDown' || c === 'KeyS';
      const up = c === 'ArrowUp' || c === 'KeyW';
      const space = c === 'Space';
      if (!dir && !down && !up && !space && !d) return;
      if (space || c.startsWith('Arrow')) e.preventDefault(); // 페이지가 스크롤되지 않게
      if (e.repeat) return;
      unlock();
      const mode = modeOf();
      if (!mode) return;
      if (d) return useCard(d - 1);
      if (mode === 'react') {
        if (space) react(null);
        return;
      }
      if (mode === 'will') {
        if (dir) {
          heir = stepSide(heir, dir);
          paint();
        }
        return;
      }
      if (space) return fireNow();
      if (S.scatter) return; // 산탄은 겨눌 필요가 없다
      if (dir) setAim(stepSide(aimLocal, dir));
      else if (down) setAim(me);
      else if (up) setAim(opposite());
    }
    window.addEventListener('keydown', onKey);

    /* ── 효과 그림판: 3배로 키우는 작은 캔버스에 도트로 그린다 (조준 점선 · 총알 자국 · 튀는 조각) ── */
    const g2 = fx.getContext('2d');
    let cw = 0;
    let ch = 0;
    const parts = [];
    const streaks = [];
    function fit() {
      const r = table.getBoundingClientRect();
      const w = Math.ceil(r.width / PX);
      const hh = Math.ceil(r.height / PX);
      if (w === cw && hh === ch) return;
      cw = fx.width = w;
      ch = fx.height = hh;
      fx.style.width = `${w * PX}px`;
      fx.style.height = `${hh * PX}px`;
      setPose(lastAimed ? poseTo(lastAimed) : poseCenter());
    }
    // 화면 요소의 가운데 → 그림판 좌표
    function at(el, dx = 0) {
      const t = table.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return [Math.round((r.left + r.width / 2 - t.left) / PX + dx), Math.round((r.top + r.height / 2 - t.top) / PX)];
    }
    const seatPt = id => (seats.get(id) ? at(seats.get(id).face) : [cw >> 1, ch >> 1]);
    const gunPt = () => { // 총구 끝 (정면 그림일 땐 가운데)
      const [x, y] = at(gun);
      if (gunFront) return [x, y];
      const a = (pose.deg * Math.PI) / 180;
      return [Math.round(x + Math.cos(a) * MUZZLE), Math.round(y + Math.sin(a) * MUZZLE)];
    };
    function dots(a, b, color, gap = 1, off = 0, size = 1) {
      const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      if (!n) return;
      g2.fillStyle = color;
      for (let i = 0; i <= n; i++) {
        if (gap > 1 && (((i + off) % gap) + gap) % gap >= gap / 2) continue;
        g2.fillRect(Math.round(a[0] + ((b[0] - a[0]) * i) / n), Math.round(a[1] + ((b[1] - a[1]) * i) / n), size, size);
      }
    }
    function burst(p, colors, n = 16, speed = 1) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = (0.5 + Math.random() * 1.7) * speed;
        parts.push({ x: p[0], y: p[1], vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.5, g: 0.12, life: 9 + Math.random() * 11, c: pick(colors) });
      }
    }
    function puff(p) { // 공포탄: 총구에서 연기만
      for (let i = 0; i < 9; i++) {
        parts.push({ x: p[0] + Math.random() * 4 - 2, y: p[1], vx: Math.random() * 0.6 - 0.3, vy: -0.3 - Math.random() * 0.5, g: 0, life: 14 + Math.random() * 12, c: pick(['#94b0c2', '#566c86', '#f4f4f4']) });
      }
    }
    const streak = (a, b, delay = 0, c = '#f4f4f4') => streaks.push({ a, b, t0: performance.now() + delay, c });

    let raf = 0;
    let lastT = 0;
    function frame(t) {
      raf = requestAnimationFrame(frame);
      if (!S || t - lastT < 33) return;
      lastT = t;
      fit();
      g2.clearRect(0, 0, cw, ch);
      const march = Math.floor(t / 90);
      if (S.phase === 'turn') { // 총구가 향한 곳: 노란 점선
        const tos = S.scatter ? S.alive.filter(id => id !== S.turn) : [S.turn === me ? aimLocal : S.aim].filter(Boolean);
        for (const id of tos) dots(gunPt(), seatPt(id), '#ffcd75', 4, -march);
      } else if (S.phase === 'hush' && !gunFront) { // 방아쇠를 당겼다: 빨간 점선
        for (const id of S.shot.to) dots(gunPt(), seatPt(id), '#ef7d57', 2, -march * 2);
      }
      for (let i = streaks.length - 1; i >= 0; i--) {
        const s = streaks[i];
        const k = (t - s.t0) / 110;
        if (k < 0) continue;
        if (k > 1.5) {
          streaks.splice(i, 1);
          continue;
        }
        const lerp = q => [s.a[0] + (s.b[0] - s.a[0]) * q, s.a[1] + (s.b[1] - s.a[1]) * q];
        dots(lerp(Math.max(0, k - 0.5)), lerp(Math.min(1, k)), s.c, 1, 0, 2);
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.g;
        p.life -= 1;
        if (p.life <= 0) {
          parts.splice(i, 1);
          continue;
        }
        g2.fillStyle = p.c;
        const sz = p.life > 6 ? 2 : 1;
        g2.fillRect(Math.round(p.x), Math.round(p.y), sz, sz);
      }
      if (S.phase === 'load') paintCenter(); // 탄을 보여 주다가 섞어서 숨기는 때를 맞춘다
    }
    raf = requestAnimationFrame(frame);

    function floatAt(id, text, cls = '', icon = null) {
      const s = seats.get(id);
      if (!s) return;
      const el = h('div', { class: `rl-float ${cls}`, style: `left:${s.x.toFixed(2)}%;top:${s.y.toFixed(2)}%` }, icon ? spr(icon) : null, text);
      table.append(el);
      later(1400, () => el.remove());
    }
    function setBanner(text, cls = '', ms = 0) {
      banner.textContent = text;
      banner.className = `rl-banner ${cls}`;
      const n = (bannerNo += 1);
      if (ms) later(ms, () => { if (bannerNo === n) banner.textContent = ''; });
    }
    function replay(el, cls) {
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
    }
    function hitSeat(id) {
      const s = seats.get(id);
      if (s) replay(s.face, 'hit');
    }

    /* ── 장면 연출 ── */
    function onLoad() {
      audio.load();
      setBanner('장전!', '', 1300);
      later(350, () => {
        for (const [id, n] of Object.entries(S.dealt || {})) floatAt(id, `카드 +${n}`, 'gain');
      });
    }

    function onHush() {
      const shot = S.shot;
      audio.cock();
      const atMe = !shot.self && shot.to.includes(me) && alive(me);
      if (atMe) audio.alarm();
      setBanner(atMe ? '' : '철컥…', 'hush');
    }

    function onResult() {
      const shot = S.shot;
      const from = gunPt();
      const hits = shot.hits || {};
      if (shot.live) {
        audio.bang(shot.dbl);
        replay(flashEl, 'on');
        replay(box, 'shaking');
        replay(gun, 'kick');
        setBanner(shot.dbl ? '탕! 탕!' : '탕!', 'live', 1500);
        for (const id of shot.to) {
          const to = seatPt(id);
          streak(from, to, 0, shot.dbl ? '#ffcd75' : '#f4f4f4');
          if (shot.blocked?.includes(id)) {
            later(110, () => {
              audio.clang();
              burst(to, ['#41a6f6', '#73eff7', '#f4f4f4'], 12, 0.8);
              floatAt(id, '깡!', 'block');
            });
          } else if (shot.mirrored?.includes(id)) {
            later(110, () => {
              audio.ping();
              burst(to, ['#73eff7', '#f4f4f4'], 10, 0.7);
              floatAt(id, '반사!', 'mirror');
              streak(to, seatPt(shot.by), 0, '#73eff7');
            });
          } else {
            later(110, () => burst(to, ['#ef7d57', '#b13e53', '#ffcd75', '#f4f4f4'], shot.dbl ? 26 : 16, shot.dbl ? 1.3 : 1));
          }
        }
        for (const [id, d] of Object.entries(hits)) {
          const back = id === shot.by && !shot.self; // 거울에 맞고 돌아온 탄
          later(back ? 260 : 130, () => {
            if (back) burst(seatPt(id), ['#ef7d57', '#b13e53', '#f4f4f4'], 16);
            hitSeat(id);
            floatAt(id, `-${d}`, 'hit');
          });
        }
        if (shot.dead?.length) later(520, () => audio.dead());
      } else {
        audio.click();
        puff(from);
        setBanner('틱…', 'blank', 1500);
        for (const id of shot.to) floatAt(id, shot.wasted?.includes(id) ? '헛카드…' : '휴…', 'safe');
      }
    }

    function onEvent(ev) {
      if (!ev) return;
      audio.card();
      if (ev.k === 'will') {
        floatAt(ev.to, '유품 +1', 'gain');
        return;
      }
      const def = CARDS[ev.k];
      if (!def) return;
      floatAt(ev.by, `${def.name}!`, '', `c_${ev.k}`);
      if (ev.to) later(250, () => floatAt(ev.to, ev.k === 'cuff' ? '철컹!' : '뺏겼다!', 'bad'));
    }

    /* ── 그리기 ── */
    function layoutSeats() {
      const key = S.order.join();
      if (key === seatKey) return;
      seatKey = key;
      for (const s of seats.values()) s.el.remove();
      seats.clear();
      const n = S.order.length;
      const mine = Math.max(0, S.order.indexOf(me));
      S.order.forEach((id, i) => { // 둥글게 앉는다: 나는 항상 아래, 차례는 시계 방향
        const p = who(id);
        const a = Math.PI / 2 + ((i - mine) * 2 * Math.PI) / n;
        const x = 50 + 41 * Math.cos(a);
        const y = 50 + 37 * Math.sin(a);
        const face = h('div', { class: 'rl-face' }, avatar(p, 'lg'), spr('cross', 'rl-cross'), spr('skull', 'rl-skull'));
        const hearts = h('div', { class: 'rl-hearts' });
        const cards = h('div', { class: 'rl-cards' });
        const tags = h('div', { class: 'rl-tags' });
        const show = h('div', { class: 'rl-show' });
        const el = h('div', { class: 'rl-seat', style: `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%` },
          face, h('div', { class: 'rl-info' }, h('span', { class: 'rl-name' }, p.name), hearts, cards), tags, show);
        table.append(el);
        seats.set(id, { el, face, hearts, cards, tags, show, x, y, key: '' });
      });
    }

    function paintSeats() {
      const shot = S.shot;
      const turn = S.phase === 'turn';
      const hush = S.phase === 'hush';
      const aimNow = !turn ? null : S.turn === me ? aimLocal : S.aim || null;
      const shooter = turn ? S.turn : hush ? shot.by : null;
      for (const [id, s] of seats) {
        const hp = S.hp?.[id] || 0;
        const n = S.cards?.[id] || 0;
        const react = (hush || S.phase === 'shot') && shot && !shot.self ? shot.react?.[id] : null;
        const shown = react === 'shield' || react === 'mirror' ? react : '';
        const tags = [];
        if (S.cuffs?.[id]) tags.push('수갑');
        if (id === shooter) {
          if (turn ? S.peeked : shot.peeked) tags.push('봄');
          if (turn ? S.double : shot.dbl) tags.push('×2');
          if (turn ? S.scatter : shot.sc) tags.push('산탄');
        }
        const cls = ['rl-seat', id === me && 'me', !alive(id) && 'dead', id === shooter && 'turn',
          turn && (aimNow === id || (S.scatter && id !== S.turn && alive(id))) && 'aimed',
          hush && shot.to.includes(id) && 'locked', heir === id && modeOf() === 'will' && 'heir'].filter(Boolean).join(' ');
        const key = [cls, hp, n, shown, tags.join()].join('|');
        if (key === s.key) continue;
        s.key = key;
        s.el.className = cls;
        s.hearts.replaceChildren(...Array.from({ length: S.maxHp }, (_, i) => spr(i < hp ? 'heart' : 'heart_off')));
        s.cards.replaceChildren(...Array.from({ length: n }, () => spr('cardback')));
        s.tags.replaceChildren(...tags.map(t => h('span', {}, t === '봄' ? spr('eye') : null, t)));
        s.show.replaceChildren(...(shown ? [spr(`c_${shown}`), h('b', {}, `${CARDS[shown].name}!`)] : []));
      }
    }

    const shellEl = (kind, cls, eye = false) => h('span', { class: `rl-shell ${cls}` }, spr(`shell_${kind}`), eye ? spr('eye', 'rl-eye') : null);

    function paintCenter() {
      const shot = S.shot;
      const fired = S.fired || [];
      const left = (S.left?.live || 0) + (S.left?.blank || 0);
      // 장전: 앞 55%는 탄을 다 보여 주고, 그 뒤엔 섞어서 숨긴다
      const stage = S.phase !== 'load' ? '' : api.now() < S.phaseEndsAt - LOAD_TIME * 0.45 ? 'open' : 'mix';
      const peek = myPeek();
      const key = JSON.stringify([S.magNo, fired, left, stage, peek?.live ?? -1, S.phase === 'shot']);
      if (key !== keys.mag) {
        keys.mag = key;
        let cells = [];
        if (stage === 'open') cells = [...Array(S.mag.live).fill('live'), ...Array(S.mag.blank).fill('blank')].map(k => shellEl(k, ''));
        else if (S.mag) {
          cells = [
            ...fired.map((v, i) => shellEl(v ? 'live' : 'blank', `spent${S.phase === 'shot' && i === fired.length - 1 ? ' now' : ''}`)),
            ...Array.from({ length: left }, (_, i) => (i ? shellEl('q', '') : shellEl(peek ? (peek.live ? 'live' : 'blank') : 'q', stage ? '' : 'cur', !!peek))),
          ];
        }
        mag.className = `rl-mag ${stage}`;
        mag.replaceChildren(...cells);
        count.replaceChildren(...(S.mag ? [
          h('span', { class: 'live' }, `실탄 ${S.left?.live || 0}`), h('span', { class: 'blank' }, `공포탄 ${S.left?.blank || 0}`),
        ] : []));
      }
      // 총: 위에서 내려다본 총이 겨눈 사람 얼굴 쪽으로 돈다. 누가 나를 쏘면(결과 전) 정면 총구가 다가온다
      const front = S.phase === 'hush' && !shot.self && shot.to.includes(me) && alive(me);
      if (front !== gunFront) {
        gunFront = front;
        if (front) {
          const a = sideAngle(shot.by);
          frontImg.src = `${ART}gun_aim_${a < -0.35 ? 'l' : a > 0.35 ? 'r' : 'c'}.png`;
        }
        gun.classList.toggle('front', front);
      }
      // 총은 쏘는 사람 앞에 놓인다: 차례가 시작되면(장전 중엔 다음 사람) 그 사람 앞으로 미끄러져 오고,
      // 겨누기 전엔 테이블 가운데를 본다
      const who = S.phase === 'turn' ? S.turn : (S.phase === 'hush' || S.phase === 'shot') ? shot?.by
        : S.phase === 'load' ? S.after : holder || S.order?.[0];
      if (who && who !== holder && seats.has(who)) {
        holder = who;
        const s = seats.get(who);
        spot = { x: s.x + (50 - s.x) * GUN_PULL, y: s.y + (50 - s.y) * GUN_PULL };
        gun.style.left = `${spot.x}%`;
        gun.style.top = `${spot.y}%`;
        lastAimed = null;
        setPose(poseCenter());
      }
      const aimed = S.phase === 'turn' ? (S.turn === me ? aimLocal : S.aim)
        : (S.phase === 'hush' || S.phase === 'shot') && shot?.to.length === 1 ? shot.to[0] : null;
      if (aimed && seats.has(aimed)) {
        lastAimed = aimed;
        setPose(poseTo(aimed));
      }
      // 남이 나를 겨누면: 테이블 테두리가 붉게 뛰고, 총구가 나에게 올 때마다 짧게 알린다
      const aimMe = S.phase === 'turn' && S.turn !== me && S.aim === me && alive(me);
      if (aimMe && !wasAimMe) {
        audio.aimed();
        setBanner('나를 겨눔!', 'aimme', 900);
      }
      wasAimMe = aimMe;
      table.classList.toggle('aimme', aimMe);
      table.classList.toggle('hush', S.phase === 'hush');
      table.classList.toggle('danger', front);
    }

    // 총 자리에서 그 지점(화면 px) 쪽 각도 → 15도 간격 그림 중 가까운 것 (왼쪽이면 오른쪽 그림을 좌우로 뒤집는다).
    // 총이 미끄러지는 중이어도 도착할 자리에서 잰다
    function poseAt(x, y) {
      const t = table.getBoundingClientRect();
      const gx = t.left + (t.width * spot.x) / 100;
      const gy = t.top + (t.height * spot.y) / 100;
      const deg = (Math.atan2(y - gy, x - gx) * 180) / Math.PI;
      const flip = Math.abs(deg) > 90;
      let d = flip ? 180 - deg : deg;
      if (d > 180) d -= 360;
      const k = Math.max(0, Math.min(180 / GUN_STEP, Math.round((d + 90) / GUN_STEP)));
      const shown = -90 + k * GUN_STEP;
      return { k, flip, deg: flip ? 180 - shown : shown };
    }
    const poseTo = id => {
      const r = seats.get(id).face.getBoundingClientRect();
      return poseAt(r.left + r.width / 2, r.top + r.height / 2);
    };
    const poseCenter = () => {
      const t = table.getBoundingClientRect();
      return poseAt(t.left + t.width / 2, t.top + t.height / 2);
    };
    function setPose(p) {
      if (p.k === pose.k && p.flip === pose.flip) return;
      pose = p;
      gunImg.src = `${ART}gun_${p.k}.png`;
      gunImg.classList.toggle('flip', p.flip);
      // 쏠 때 총이 뒤로 밀리는 방향 (도트 한 칸 = 3px 단위)
      const a = (p.deg * Math.PI) / 180;
      gun.style.setProperty('--kx', `${-Math.round(Math.cos(a) * 3) * PX}px`);
      gun.style.setProperty('--ky', `${-Math.round(Math.sin(a) * 3) * PX}px`);
    }

    function promptOf(mode) {
      if (hint && performance.now() < hint.until) return [hint.text, hint.cls];
      const shot = S.shot;
      if (mode === 'will') return [heir ? `유품: ${nameOf(heir)}에게 · 숫자키 = 물려줄 카드 (← → 다른 사람)` : '유품: ← → 받을 사람 · 숫자키 = 물려줄 카드', 'hint'];
      if (S.phase === 'intro') return [S.again ? '한 판 더!' : '돌아가며 한 발! 실탄이면 하트 -1 · 나를 쏴서 공포탄이면 한 번 더', ''];
      if (S.phase === 'load') return [`${S.dud ? `남은 공포탄 ${S.dud}발은 버리고 ` : ''}새 탄창: 실탄 ${S.mag.live} · 공포탄 ${S.mag.blank}`, ''];
      if (S.phase === 'skip') return [`${nameOf(S.skip)} 수갑 때문에 이번 차례 쉬어요`, 'calm'];
      if (S.phase === 'turn') {
        if (S.turn === me) {
          if (mode !== 'turn') return ['…', 'calm'];
          const more = S.repeat ? '한 번 더! ' : '';
          if (S.scatter) return ['산탄! 스페이스 = 모두에게 발사', 'mine'];
          if (!aimLocal) return [`${more || '내 차례! '}← → 겨누기 (↓ = 나) · 스페이스 = 발사 · 숫자키 = 카드`, 'mine'];
          if (aimLocal === me) return [`${more}나에게: 공포탄이면 한 번 더 · 스페이스 = 발사`, 'mine'];
          return [`${more}${nameOf(aimLocal)}에게 · 스페이스 = 발사 (← → 바꾸기)`, 'mine'];
        }
        const t = nameOf(S.turn);
        if (S.scatter) return [`${t} 산탄 장전! 모두 조심`, 'warn'];
        if (S.aim === me) return [`${josa(t, '이', '가')} 나를 겨누는 중!`, 'warn'];
        if (S.aim) return [`${t} 차례 · ${S.aim === S.turn ? '자기 자신을' : `${nameOf(S.aim)} 쪽을`} 겨누는 중`, 'calm'];
        return [`${t} 차례`, 'calm'];
      }
      if (S.phase === 'hush') {
        if (mode === 'react') return [`${josa(nameOf(shot.by), '이', '가')} 나를 쐈어요! 숫자키 = 받아치기 · 스페이스 = 그냥 맞기`, 'warn'];
        return ['두근…', 'calm'];
      }
      if (S.phase === 'shot') {
        if (!shot.live) return [shot.again ? '공포탄! 한 번 더' : '공포탄…', 'calm'];
        const lost = Object.entries(shot.hits || {}).map(([id, d]) => `${nameOf(id)} -${d}`).join(' · ');
        return [lost ? `실탄! ${lost}` : '실탄! 하지만 다 막았다', 'warn'];
      }
      return ['', ''];
    }

    function paintPanel() {
      if (!S) return;
      const mode = modeOf();
      const hand = myHand();
      const [text, cls] = promptOf(mode);
      const idle = !inGame() ? '관전 중' : alive(me) ? '카드 없음 · 장전할 때 받아요' : '탈락! 채팅(Enter)으로 훈수 두기';
      const key = JSON.stringify([mode, hand, hand.map(c => usable(c, mode)), text, cls, idle]);
      if (key !== keys.panel) {
        keys.panel = key;
        prompt.className = `rl-prompt ${cls}`;
        prompt.textContent = text;
        handEl.replaceChildren(...(hand.length ? hand.map((card, i) => {
          const def = CARDS[card] || { name: card, tip: '' };
          return h('button', {
            class: `rl-card${usable(card, mode) ? ' can' : mode ? ' dim' : ''}${def.rare ? ' rare' : ''}`,
            type: 'button', tabindex: '-1',
            onClick: e => {
              e.currentTarget.blur(); // 스페이스가 이 버튼을 다시 누르지 않게
              useCard(i);
            },
          },
          h('span', { class: 'rl-key' }, String(i + 1)), spr(`c_${card}`),
          h('span', { class: 'rl-ctext' }, h('span', { class: 'rl-cname' }, def.name), h('span', { class: 'rl-ctip' }, def.tip)));
        }) : [h('span', { class: 'rl-empty' }, idle)]));
      }
      let tKey = '';
      let make = null;
      if (mode === 'will') {
        tKey = 'will';
        make = () => countdown(S.wills[me], WILL_TIME);
      } else if (S.phase === 'turn') {
        tKey = `t${S.turnNo}:${S.turnEndsAt}`;
        make = () => countdown(S.turnEndsAt, TURN_TIME);
      } else if (mode === 'react') {
        tKey = `r${S.shot.no}`;
        make = () => countdown(S.shot.until, REACT_TIME);
      }
      if (tKey !== keys.timer) {
        keys.timer = tKey;
        timer.replaceChildren(...(make ? [make()] : []));
      }
    }

    function paintHead() {
      const left = S.magNo ? `탄창 ${S.magNo} · 생존 ${S.alive.length}명` : '곧 시작해요';
      const right = alive(me) ? `❤️ ${S.hp?.[me] || 0} · 🃏 ${S.cards?.[me] || 0}장` : inGame() ? '👻 구경 중' : '👀 관전 중';
      if (keys.head === left + right) return;
      keys.head = left + right;
      head.replaceChildren(h('span', {}, left), h('span', {}, right));
    }

    function paintSide() {
      const out = S.outOrder || [];
      const log = S.log || [];
      const key = JSON.stringify([S.alive, out, S.dead, log]);
      if (key === keys.side) return;
      keys.side = key;
      side.replaceChildren(...[
        h('h3', {}, `생존 ${S.alive.length}명`),
        h('div', { class: 'tc-alive' }, S.alive.map(id => h('span', { class: 'tc-alive-chip' }, avatar(who(id)), who(id).name))),
        out.length ? h('h3', {}, '탈락 기록') : null,
        out.length ? h('ul', { class: 'rules' }, out.map(id => {
          const by = S.dead?.[id];
          return h('li', {}, h('b', {}, who(id).name), by && by !== '-' ? ` ← ${who(by).name}` : ' 💥 자폭');
        })) : null,
        log.length ? h('h3', {}, '방금') : null,
        log.length ? h('ol', { class: 'rl-log' }, log.map(t => h('li', {}, t))) : null,
        h('h3', {}, '카드'),
        h('ul', { class: 'rl-cardlist' }, Object.entries(CARDS).map(([k, c]) => h('li', {},
          spr(`c_${k}`, '', 2), h('span', {}, h('b', {}, c.name), ` ${c.tip}${c.when === 'react' ? ' (맞을 때)' : ''}`)))),
        h('h3', {}, '조작'),
        h('ul', { class: 'rules' },
          h('li', {}, '← = 내 왼쪽 사람 · → = 내 오른쪽 사람 겨누기 (↓ = 나, ↑ = 맞은편). 총구는 모두에게 보여요'),
          h('li', {}, '스페이스 = 발사'),
          h('li', {}, '숫자키 = 그 자리 카드 (수갑·훔치기는 겨눈 사람에게)'),
          h('li', {}, '누가 나를 쐈을 때: 숫자키 = 방패·거울, 스페이스 = 그냥 맞기')),
        h('h3', {}, '규칙'),
        h('ul', { class: 'rules' },
          h('li', {}, '탄이 몇 발씩인지만 알고 순서는 몰라요'),
          h('li', {}, '나를 쏴서 공포탄이면 한 번 더'),
          h('li', {}, '받아치기는 결과가 나오기 전에! 공포탄이면 카드만 날려요'),
          h('li', {}, `${TURN_TIME / 1000}초가 지나면 총구가 향한 사람에게(없으면 나에게) 나가요`),
          h('li', {}, '탄창이 바뀔수록 실탄이 많아져요'),
          h('li', {}, '👻 탈락하면 남은 카드 1장을 누군가에게 물려줄 수 있어요'),
          h('li', {}, '마지막 1명 우승')),
      ].filter(Boolean));
    }

    function paint() {
      if (!S) return;
      paintHead();
      paintSeats();
      paintCenter();
      paintPanel();
      paintSide();
    }

    return {
      update({ state, priv }) {
        S = state;
        P = priv || null;
        S.alive ||= [];
        layoutSeats();
        const shot = S.shot;
        if (!seen) {
          const no = S.shotNo || 0;
          seen = { hush: no, result: S.phase === 'hush' ? no - 1 : no, ev: S.evNo || 0, mag: S.phase === 'load' ? (S.magNo || 0) - 1 : S.magNo || 0, turn: -1, react: new Set(), peek: '', final: false };
          if (S.phase === 'intro') setBanner('독박 룰렛');
        }
        if (S.phase === 'load' && S.magNo !== seen.mag) {
          seen.mag = S.magNo;
          onLoad();
        }
        if (S.phase === 'hush' && shot.no !== seen.hush) {
          seen.hush = shot.no;
          onHush();
        }
        if (S.phase === 'hush') {
          for (const [id, r] of Object.entries(shot.react || {})) {
            const k = `${shot.no}:${id}`;
            if (r === 'pass' || seen.react.has(k)) continue;
            seen.react.add(k);
            audio.card();
          }
        }
        if (S.phase !== 'hush' && shot && 'live' in shot && shot.no !== seen.result) {
          seen.result = shot.no;
          paintCenter(); // 총 방향을 먼저 맞추고 쏜다
          onResult();
        }
        if ((S.evNo || 0) !== seen.ev) {
          seen.ev = S.evNo || 0;
          onEvent(S.ev);
        }
        if (S.phase === 'skip' && seen.skip !== `${S.turnNo}:${S.skip}`) {
          seen.skip = `${S.turnNo}:${S.skip}`;
          setBanner(`수갑! ${nameOf(S.skip)} 쉼`, 'skip', 1300); // 도트 글꼴엔 ⛓️ 그림이 없어서 글자로
        }
        if (S.phase === 'turn' && S.turnNo !== seen.turn) {
          seen.turn = S.turnNo;
          aimLocal = S.turn === me ? S.aim || null : null;
          hint = null;
          if (S.turn === me) audio.turn();
          if (S.repeat) setBanner(S.turn === me ? '한 번 더!' : `${nameOf(S.turn)} 한 번 더`, 'again', 1600);
        }
        const peek = myPeek();
        if (peek && peek.key !== seen.peek) { // 돋보기 결과는 나에게만
          seen.peek = peek.key;
          say(`돋보기: 지금 탄은 ${peek.live ? '실탄' : '공포탄'}!`, peek.live ? 'warn' : 'hint', 3000);
        }
        if (S.wills?.[me] && !sent.will && (!heir || !alive(heir))) heir = ring().find(id => (S.cards?.[id] || 0) < HAND_MAX) || null;
        audio.heart(S.phase === 'hush');
        box.classList.toggle('final', S.phase === 'final');
        if (S.phase === 'final' && !seen.final) {
          seen.final = true;
          if (S.winner === me) audio.win();
          board.replaceChildren(h('div', { class: 'rx-result' },
            h('h2', { class: 'display' }, S.winner ? `🔫 ${nameOf(S.winner)} 최후의 1인!` : '🔫 끝!'),
            podium(S.roster, S.standings, me)));
        }
        paint();
      },
      unmount() {
        cancelAnimationFrame(raf);
        clearTimeout(aimTimer);
        for (const t of timers) clearTimeout(t);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('pointerdown', unlock);
        audio.dispose();
      },
    };
  },
};
