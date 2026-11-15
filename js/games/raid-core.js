// 독박 원정대 규칙 (방장이 돌린다). 표와 값은 raid-data.js, 화면은 raid-view.js, 게임 등록은 raid.js
// 한 판: 직업 → 시작 기술 2번 → [방(전투) → 배움 → 각인 → 속삭임] × 3 → 흑화 → 최종전(마왕 대 원정대)
// 전투 한 턴: 예고 → 대응(모두 동시에) → 결과(준비 → 선제 → 공격 → 후속 → 회복 → 적 행동 → 턴 끝)
// 덱 · 손패 · 계획 · 마왕의 다음 권능 · 속삭임 답은 방장만 안다(ctx.secret). 내 손패는 나에게만(ctx.setPrivate).
// validatePlan · runTurn 은 상태만 받아 고친다 → 화면의 미리 보기 · 실시간 합계 · 봇이 복사본에 대고 그대로 쓴다.
// 대원을 쓰러뜨리는 건 언제나 예고된 적의 공격이거나 누군가(마왕 · 아군)의 기술이다.
import { INTRO_TIME } from '../util.js';
import {
  ENERGY_START, ENERGY_GAIN, ENERGY_MAX, HAND, ACT_TIME, BOSS_FIRST_TIME, CLS_TIME, LEARN_TIME, START_LEARN_TIME, MARK_TIME,
  WHISPER_TIME, ENTER_TIME, CLEAR_TIME, WHISPER_SHOW, FALL_TIME, BONUS, WEAK_MULT, KEEN_MULT, LEECH, SKIP_HEAL, CLEAR_HEAL,
  WHISPER_CORRUPT, USE_CORRUPT, KILL_ALLY_CORRUPT, FALL_MIN, BAPTISM, BOSS_HP, BOSS_DMG_PER_CORRUPT, BOSS_ENERGY, SCAPEGOAT_HEAL,
  GHOST_BLOCK, BREAK_PER_HERO, BLEED_MAX, BOSS_FEW, PRE_THROTTLE, ENRAGE, ULT_WIND, RS_CAP,
  MARKS, CARDS, TREES, CLASSES, CLASS_KEYS, AMMO, FAITH, ROOMS, FOES, GHOULS, ULTS, POWERS, POWER_DECK,
} from './raid-data.js';

export * from './raid-data.js';

const GRACE = 300;      // 마감 직전에 누른 신호가 도착할 시간
const LOG_KEEP = 8;
export const BOSS = '@boss';

export const list = v => (Array.isArray(v) ? v.filter(x => x != null) : v && typeof v === 'object' ? Object.values(v).filter(x => x != null) : []);
export const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
export const isFoeKey = k => typeof k === 'string' && k[0] === '@';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const bump = (o, k, v) => { if (k != null) o[k] = (o[k] || 0) + v; };
const pickR = (arr, rand = Math.random) => (arr.length ? arr[Math.floor(rand() * arr.length)] : undefined);
function shuffleR(arr, rand = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Firebase는 빈 배열 · 빈 객체 · null을 지운다. 방장이 바뀌어 상태를 다시 읽어도 모양이 맞게 고쳐 둔다
const OBJ_KEYS = ['hp', 'maxHp', 'block', 'blkBy', 'energy', 'res', 'cls', 'cd', 'corrupt', 'baptism', 'down', 'downAt', 'downedIn', 'st',
  'nxt', 'contrib', 'rcon', 'foes', 'acts', 'ready', 'sig', 'once', 'lastBlk', 'threat', 'regen', 'clsPick', 'done', 'cards', 'shelf',
  'lastHits', 'learned', 'marked', 'wshow', 'ghost'];
export function norm(S) {
  for (const k of OBJ_KEYS) S[k] = obj(S[k]);
  for (const k of ['party', 'order', 'auras', 'later', 'log', 'flow', 'bcards']) S[k] = list(S[k]);
  for (const id of Object.keys(S.cards)) S.cards[id] = list(S.cards[id]);
  for (const k of Object.keys(S.foes)) {
    const f = S.foes[k];
    if (!f) { delete S.foes[k]; continue; }
    f.intent = list(f.intent);
    f.next = list(f.next);
  }
  return S;
}

function note(S, text) {
  S.log = [...list(S.log), text].slice(-LOG_KEEP);
}

/* ───────── 사람 · 적 · 상태 ───────── */

export const partyOf = S => list(S.party);
export const isUp = (S, id) => !!id && partyOf(S).includes(id) && !S.down?.[id];
export const upHeroes = S => partyOf(S).filter(id => !S.down?.[id]);
export const liveFoes = S => Object.keys(obj(S.foes)).filter(k => (S.foes[k]?.hp || 0) > 0);
export const foeOf = (S, k) => ((S.foes?.[k]?.hp || 0) > 0 ? S.foes[k] : null);
export const isFinal = S => S.room === 3;
const lowestFoe = S => liveFoes(S).sort((a, b) => S.foes[a].hp - S.foes[b].hp || (a < b ? -1 : 1))[0] || null;
export const lowestHero = (S, not = null) => upHeroes(S).filter(x => x !== not).sort((a, b) => (S.hp[a] || 0) - (S.hp[b] || 0))[0] || null;

export const stOf = (S, u) => obj(S.st?.[u]);
function setSt(S, u, k, v) {
  const cur = { ...stOf(S, u) };
  if (v == null || v === false || v === 0) delete cur[k];
  else cur[k] = v;
  S.st = { ...obj(S.st), [u]: cur };
}
const extend = (S, u, k, until) => setSt(S, u, k, Math.max(stOf(S, u)[k] || 0, until));
// 상태이상은 '몇 턴(전체 턴 번호 tn)까지'로 적어 둔다
const lasts = (v, S) => (v || 0) > 0 && v >= (S.tn || 0); // 그 턴까지 걸려 있나 (0은 안 걸린 것)
export const isVuln = (S, u) => lasts(stOf(S, u).vuln, S);
export const isWeak = (S, u) => lasts(stOf(S, u).weak, S);
export const isStun = (S, u) => lasts(stOf(S, u).stun, S);
export const bleedOf = (S, u) => stOf(S, u).bleed || 0;
export const isGroggy = (S, k) => lasts(S.foes?.[k]?.groggy, S);

/* ───────── 카드 ───────── */

export const cardsOf = (S, id) => list(S.cards?.[id]);
export const cardOfU = (S, id, u) => cardsOf(S, id).find(c => c.u === u) || null;
export const treeCount = (S, id, tree) => cardsOf(S, id).filter(c => CARDS[c.k]?.tree === tree).length;
// 계열 패시브: 'wall2' = 철벽 기술 2장 이상, 'wall4' = 4장
export function hasP(S, id, key) {
  const tree = key.slice(0, -1);
  const need = Number(key.slice(-1));
  return !!TREES[tree] && S.cls?.[id] === TREES[tree].cls && treeCount(S, id, tree) >= need;
}
export const ammoMax = (S, id) => (hasP(S, id, 'n_dark2') ? AMMO.dark : AMMO.base);
export const faithMax = (S, id) => (hasP(S, id, 'judge4') ? FAITH.maxAwake : FAITH.max);
function resOf(S, id) {
  S.res = obj(S.res);
  S.res[id] = obj(S.res[id]);
  return S.res[id];
}
export const ammoOf = (S, id) => S.res?.[id]?.ammo || 0;
export const aimOf = (S, id) => S.res?.[id]?.aim || 0;
export const faithOf = (S, id) => S.res?.[id]?.faith || 0;
export const roundsOf = (S, id) => obj(S.res?.[id]?.rounds);
const nxt = (S, id) => {
  S.nxt = obj(S.nxt);
  S.nxt[id] = { e: 0, h: 0, ...obj(S.nxt[id]) };
  return S.nxt[id];
};

const DMG = new Set(['dmg', 'dmgAll', 'splash', 'dmgPerAmmo', 'dmgFromBlock', 'dmgLastBlocked', 'dmgFromBleed', 'bleedDouble', 'dmgFaith']);
const ATK = new Set([...DMG, 'brk', 'brkAll', 'vuln', 'weak', 'bleed', 'bleedAll', 'hitLowestAlly', 'hitAllies', 'bleedAllies']);
const HEAL = new Set(['heal', 'healMostHurt', 'cleanse', 'revive', 'transfer']);
const DEF_OPS = new Set(['block', 'blockSelf', 'blockIfNoAtk', 'blockFromMine', 'taunt', 'intercept', 'absorbAll', 'ward', 'undying', 'thorns']);
// 날카로움이 키우는 수치: 효과 이름 → 몇 번째 값인가
const KEEN = { dmg: 1, dmgAll: 1, splash: 1, dmgPerAmmo: 1, dmgFaith: 1, block: 1, blockSelf: 1, heal: 1, healMostHurt: 1, nextAtk: 1, aim: 1,
  ammo: 1, atkPlus: 1, atkFirst: 1, focus: 1, thorns: 1, bleed: 1, bleedAll: 1, shotPlus: 1, bleedHitPlus: 1, regen: 1, energyNext: 1,
  aura: 2, transfer: 2, rounds: 2 };
export const isAttack = def => !!def && def.fx.some(([op]) => DMG.has(op));
export const isAtkPhase = def => !!def && def.fx.some(([op]) => ATK.has(op));
export const isHealCard = def => !!def && def.fx.some(([op]) => HEAL.has(op) || op === 'regen');
export const isDefCard = def => !!def && def.fx.some(([op]) => DEF_OPS.has(op));
export function keenAt(def) {
  for (let i = 0; i < def.fx.length; i++) {
    const j = KEEN[def.fx[i][0]];
    if (j && typeof def.fx[i][j] === 'number' && def.fx[i][j] > 0) return i;
  }
  return -1;
}
// 카드 한 장의 실제 효과 (날카로움 반영)
export function fxOf(c) {
  const def = CARDS[c?.k];
  if (!def) return [];
  const fx = def.fx.map(x => [...x]);
  if (c.m === 'keen') {
    const i = keenAt(def);
    if (i >= 0) {
      const j = KEEN[fx[i][0]];
      fx[i][j] = Math.ceil(fx[i][j] * KEEN_MULT);
    }
  }
  return fx;
}
export function canMark(c, m) {
  const def = CARDS[c?.k];
  if (!def || c.m || !MARKS[m]) return false;
  if (m === 'light') return def.cost >= 1;
  if (m === 'leech' || m === 'crush') return isAttack(def);
  if (m === 'swift') return isAttack(def) && def.spd !== 'last';
  if (m === 'keen') return keenAt(def) >= 0;
  if (m === 'echo') return !def.aura;
  if (m === 'alone') return !def.ult;
  return true;
}
const BLESS4 = new Set(['blessing', 'hymn', 'ward']);
// 이번에 낼 때 드는 기력. firstAtk = 이번 턴 아직 공격 기술을 안 냈다
export function costOf(S, id, c, firstAtk = false) {
  const def = CARDS[c?.k];
  if (!def) return 99;
  let cost = def.cost;
  if (c.m === 'light') cost -= 1;
  if (BLESS4.has(c.k) && hasP(S, id, 'bless4')) cost -= 1;
  if (firstAtk && isAttack(def) && hasP(S, id, 'frenzy2') && (S.hp?.[id] || 0) * 2 <= (S.maxHp?.[id] || 0)) cost -= 1;
  return Math.max(0, cost);
}
export const qDef = (S, id) => CLASSES[S.cls?.[id]]?.q || null;
export const qCostOf = (S, id) => (S.cls?.[id] === 'gunner' && hasP(S, id, 'rapid4') ? 0 : qDef(S, id)?.cost || 0);
export const qReady = (S, id) => (S.cd?.[id] || 0) <= S.tn;
export const qCdOf = (S, id) => (S.cls?.[id] === 'guard' && hasP(S, id, 'venge4') ? 1 : qDef(S, id)?.cd || 0);
export const isDarkKey = k => !!CARDS[k]?.dark;
// 계열 각성 칭호 (4장)
export function awakeOf(S, id) {
  const C = CLASSES[S.cls?.[id]];
  if (!C) return null;
  const t = C.trees.find(x => !TREES[x].dark && treeCount(S, id, x) >= 4);
  return t ? TREES[t].title : null;
}

/* ───────── 계획 따지기 (방장 · 화면 · 봇이 같이 쓴다) ───────── */

// 대상 고르기: 안 맞으면 알맞은 대상으로 바꾸고, 낼 수 없으면 undefined
function aimFor(S, id, to, t, all = false) {
  switch (to) {
    case 'foe':
      if (all && t === '@all') return '@all';
      return foeOf(S, t) ? t : lowestFoe(S) ?? undefined;
    case 'ally': return isUp(S, t) ? t : id;
    case 'other': return isUp(S, t) && t !== id ? t : lowestHero(S, id) ?? undefined;
    case 'down': {
      const ds = partyOf(S).filter(x => S.down?.[x]);
      return ds.includes(t) ? t : ds[0] ?? undefined;
    }
    default: return null;
  }
}

// data = { turn, acts: [{ u, t }], q: { t } | null, drop }. hand = 내 손패의 카드 번호들
// 차례대로 하나씩 따져서 기력 · 탄이 모자라거나 손에 없는 카드는 건너뛴다. 기력 · 탄의 최종값은 여기서 정해진다
export function validatePlan(S, id, data, hand) {
  const out = { id, cards: [], drop: null, energyLeft: S.energy?.[id] || 0, ammoLeft: ammoOf(S, id), shots: 0 };
  if (!isUp(S, id) || !data || data.turn !== S.tn || isStun(S, id)) return out;
  const C = CLASSES[S.cls?.[id]];
  if (!C) return out;
  const inHand = new Set(list(hand));
  let e = out.energyLeft;
  let ammo = out.ammoLeft;
  const amax = ammoMax(S, id);
  let faith = faithOf(S, id);
  if (data.q && qReady(S, id)) {
    const cost = qCostOf(S, id);
    if (cost <= e) {
      e -= cost;
      for (const [op, v] of C.q.fx) {
        if (op === 'energy') e += v;
        if (op === 'reload') ammo = amax;
      }
      out.cards.push({ q: true, k: '@q', t: aimFor(S, id, C.q.to, data.q.t) ?? id, cost, spent: 0 });
    }
  }
  let firstAtk = true;
  const used = new Set();
  for (const a of list(data.acts)) {
    const u = a?.u;
    if (!inHand.has(u) || used.has(u)) continue;
    const c = cardOfU(S, id, u);
    const def = c && CARDS[c.k];
    if (!def) continue;
    const cost = costOf(S, id, c, firstAtk);
    if (cost > e) continue;
    if (def.ammo && (def.ammo === 'all' ? ammo < 1 : ammo < def.ammo)) continue;
    const t = aimFor(S, id, def.to, a.t, !!def.faithAll && faith >= def.faithAll);
    if (t === undefined) continue;
    const spent = def.ammo === 'all' ? ammo : def.ammo || 0;
    used.add(u);
    e -= cost;
    ammo -= spent;
    out.shots += spent;
    if (isAttack(def)) firstAtk = false;
    for (const [op, v] of fxOf(c)) {
      if (op === 'energy') e += v;
      if (op === 'ammo') ammo = Math.min(amax, ammo + v);
      if (op === 'faith') faith += v;
      if (op === 'rounds' && hasP(S, id, 'bomb4')) ammo = Math.min(amax, ammo + 1);
    }
    if (t === '@all') faith -= def.faithAll;
    out.cards.push({ u, k: c.k, ...(c.m ? { m: c.m } : {}), t, cost, spent });
  }
  if (inHand.has(data.drop) && !used.has(data.drop)) out.drop = data.drop;
  out.energyLeft = Math.max(0, e);
  out.ammoLeft = Math.max(0, ammo);
  return out;
}

// 마왕의 권능 계획. hand = 마왕 손패의 카드 번호들, dark = 쓸 수 있는 어둠
export function validateBoss(S, data, hand, dark = S.dark || 0) {
  const inHand = new Set(list(hand));
  const keyOf = u => list(S.bcards).find(c => c.u === u)?.k;
  const cards = [];
  let left = dark;
  const used = new Set();
  for (const a of list(data?.acts)) {
    const u = a?.u;
    const k = keyOf(u);
    const P = POWERS[k];
    if (!inHand.has(u) || used.has(u) || !P || P.cost > left) continue;
    if (P.doom && (S.foes?.[BOSS]?.charge || cards.some(c => POWERS[c.k].doom))) continue; // 종말은 한 번에 하나
    used.add(u);
    left -= P.cost;
    cards.push({ u, k, t: a.t ?? null });
  }
  let veil = null;
  if (cards.some(c => c.k === 'veil')) {
    const v = cards.find(c => c.u === data?.veil && c.k !== 'veil' && c.k !== 'doom');
    if (v) veil = v.u;
  }
  return { cards, left, veil };
}

/* ───────── 한 턴의 결과 ───────── */

function newWork() {
  return {
    taunt: null, icpt: {}, absorb: null, undying: {}, thorns: {}, thorned: {}, avenge: {}, avFrom: {}, blockedOn: {},
    atkPlus: {}, atkFirst: [], nextAtk: {}, shotPlus: {}, bleedPlus: {}, focus: {}, team: [], dmark: {}, curse: {},
    jail: {}, fbless: {}, armor: false, spikes: 0, spiked: {}, shot: {}, aimEnd: {}, cancel: {}, blessed: {}, blessFaith: {},
    leadFirst: {}, threat: {}, planned: {}, killed: {}, groggyBoss: false,
  };
}
const workOf = S => ({ S, W: newWork(), rs: [], sums: { foe: {}, ally: {}, brk: {}, hurt: {} }, downs: [] });
const sumAlly = (X, id) => (X.sums.ally[id] ||= { blk: 0, heal: 0 });

// 기여도 = 준 피해 + 막아 낸 피해 + 회복시킨 양 + 차단 × 3 (이번 방 기여도 rcon도 같이 센다)
function credit(X, id, kind, v) {
  if (!id || isFoeKey(id) || !v) return;
  const S = X.S;
  const c = { dmg: 0, blk: 0, heal: 0, brk: 0, ...obj(S.contrib[id]) };
  c[kind] += v;
  S.contrib[id] = c;
  bump(S.rcon, id, kind === 'brk' ? v * 3 : v);
}
export const contribOf = (S, id) => {
  const c = obj(S.contrib?.[id]);
  return (c.dmg || 0) + (c.blk || 0) + (c.heal || 0) + (c.brk || 0) * 3;
};

// 타락 올리기 (세례: 지난 판 마왕은 처음 얻는 타락 BAPTISM만큼이 무효)
export function addCorrupt(S, id, n, rs = null) {
  if (!id || isFoeKey(id) || n <= 0) return 0;
  const b = S.baptism?.[id] || 0;
  const eat = Math.min(b, n);
  if (eat) S.baptism = { ...obj(S.baptism), [id]: b - eat };
  const add = n - eat;
  if (add) S.corrupt = { ...obj(S.corrupt), [id]: (S.corrupt?.[id] || 0) + add };
  rs?.push({ k: 'corrupt', to: id, v: add, ...(eat ? { eat } : {}) });
  return add;
}

function blk(X, by, to, v, raw = false) {
  const { S, W } = X;
  if (W.jail[by] && to !== by) to = by; // 가두기: 남에게 주는 방어도 자기에게만
  if (!isUp(S, to) || v <= 0) return 0;
  let b = v;
  if (!raw) {
    if (hasP(S, by, 'wall2')) b += 2;
    if (to !== by && hasP(S, by, 'lead2')) b += 3;
  }
  S.block[to] = (S.block[to] || 0) + b;
  const m = { ...obj(S.blkBy[to]) };
  m[by] = (m[by] || 0) + b;
  S.blkBy[to] = m;
  if (!raw && to !== by && hasP(S, by, 'lead4') && !W.leadFirst[by]) {
    W.leadFirst[by] = true;
    nxt(S, to).e += 1;
  }
  X.rs.push({ k: 'blk', by, to, v: b });
  sumAlly(X, to).blk += b;
  return b;
}

// 방어도로 막기: 막아 낸 만큼 방어도를 준 사람의 기여도
function soak(X, to, dmg, usable) {
  const S = X.S;
  const have = S.block[to] || 0;
  const can = Math.max(0, Math.min(dmg, usable, have));
  if (!can) return 0;
  S.block[to] = have - can;
  let left = can;
  const m = { ...obj(S.blkBy[to]) };
  for (const g of Object.keys(m)) {
    if (left <= 0) break;
    const take = Math.min(m[g], left);
    m[g] -= take;
    left -= take;
    credit(X, g, 'blk', take);
    if (m[g] <= 0) delete m[g];
  }
  if (left > 0) credit(X, to, 'blk', left);
  S.blkBy[to] = m;
  return can;
}

function faithUp(S, id, got) {
  if (S.cls?.[id] !== 'priest' || got <= 0) return;
  const r = resOf(S, id);
  r.fp = (r.fp || 0) + got;
  while (r.fp >= FAITH.per) {
    r.fp -= FAITH.per;
    r.faith = Math.min(faithMax(S, id), (r.faith || 0) + 1);
  }
}

function heal(X, by, to, v, raw = false) {
  const { S, W } = X;
  if (W.jail[by] && to !== by) to = by;
  if (!isUp(S, to) || v <= 0) return 0;
  let h = v;
  if (!raw && hasP(S, by, 'grace4')) h = Math.ceil(h * 1.3);
  if (W.fbless[to]) { // 거짓 축복: 받는 회복이 피해가 된다 (마왕의 짓)
    hurt(X, to, h, BOSS, { raw: true, src: BOSS, how: '거짓 축복' });
    return 0;
  }
  const got = Math.min(h, Math.max(0, (S.maxHp[to] || 0) - (S.hp[to] || 0)));
  if (got > 0) {
    S.hp[to] += got;
    credit(X, by, 'heal', got);
    faithUp(S, by, got);
    X.rs.push({ k: 'heal', by, to, v: got });
    sumAlly(X, to).heal += got;
  }
  if (h > got && !raw && hasP(S, by, 'grace2')) blk(X, by, to, h - got, true); // 넘친 회복은 방어도로
  return got;
}

function addBleed(X, u, n, by) {
  const S = X.S;
  if (n <= 0 || (isFoeKey(u) ? !foeOf(S, u) : !isUp(S, u))) return;
  setSt(S, u, 'bleed', Math.min(BLEED_MAX, bleedOf(S, u) + n));
  setSt(S, u, 'bleedBy', by);
  X.rs.push({ k: 'st', to: u, s: 'bleed', v: n, by });
}

// 대원이 맞는다. o = { single: 단일 공격(도발 · 가로막기가 받는다), src: 때린 쪽, friendly: 아군의 기술, raw: 출혈처럼 그대로,
//   pierce, aimed: 지목 공격, weak: 때린 쪽이 약화, stun, how }
function hurt(X, to, v, by, o = {}) {
  const { S, W } = X;
  if (o.single && !o.friendly) {
    if (W.taunt && isUp(S, W.taunt)) to = W.taunt;
    if (W.icpt[to] && isUp(S, W.icpt[to])) to = W.icpt[to];
  }
  let ratio = 1;
  if (!o.friendly && !o.raw && W.absorb && to !== W.absorb.by && isUp(S, W.absorb.by)) { // 대속: 내가 대신, 절반으로
    to = W.absorb.by;
    ratio = W.absorb.r;
  }
  if (!isUp(S, to) || v <= 0) return 0;
  let dmg = v;
  if (!o.raw) {
    const bonus = !o.friendly && isVuln(S, to) ? BONUS.vuln : 0;
    let red = ratio * (o.weak ? WEAK_MULT : 1);
    if (stOf(S, to).ward) { // 가호: 다음에 받는 피해 한 번을 절반으로
      red *= 0.5;
      setSt(S, to, 'ward', null);
    }
    dmg = Math.floor(v * (1 + bonus) * red);
  }
  if (dmg <= 0) return 0;
  let usable = S.block[to] || 0;
  if (o.pierce || o.raw) usable = 0;
  else if (o.aimed && S.bossCls === 'gunner' && o.src === BOSS) usable = Math.floor(usable / 2); // 마탄의 사수: 방어도 절반 무시
  const a = soak(X, to, dmg, usable);
  const d = dmg - a;
  if (a > 0) {
    bump(W.blockedOn, to, a);
    if (o.src && isFoeKey(o.src)) {
      bump((W.avFrom[to] ||= {}), o.src, a);
      if (hasP(S, to, 'venge2') && a >= 5) brk(X, o.src, Math.floor(a / 5), to); // 응징 숙련: 막아 낸 만큼 끊는다
    }
  }
  if (d > 0) {
    S.hp[to] -= d;
    if (S.cls[to] === 'gunner' && !hasP(S, to, 'snipe4')) { // 맞으면 조준이 절반으로
      const r = resOf(S, to);
      if (r.aim) r.aim = Math.floor(r.aim / 2);
    }
    if (o.stun) setSt(S, to, 'stun', S.tn + 1);
  }
  X.rs.push({ k: 'hurt', to, by: o.src || by, d, a, ...(o.how ? { how: o.how } : {}) });
  bump(X.sums.hurt, to, dmg);
  if (!o.raw && o.src && isFoeKey(o.src) && W.thorns[to] && !(W.thorned[to] ||= {})[o.src] && isUp(S, to)) { // 가시 방패
    W.thorned[to][o.src] = true;
    hit(X, to, o.src, W.thorns[to], { raw: true, how: '가시 방패' });
  }
  if (S.hp[to] <= 0) down(X, to, by, o.how);
  return d;
}

function down(X, to, by, how) {
  const { S, W } = X;
  if (W.undying[to]) {
    S.hp[to] = 1;
    X.rs.push({ k: 'save', to, why: 'undying' });
    return;
  }
  const once = (S.once[to] = obj(S.once[to]));
  if (hasP(S, to, 'frenzy4') && !once.frenzy) {
    once.frenzy = 1;
    S.hp[to] = 1;
    nxt(S, to).e += 2;
    X.rs.push({ k: 'save', to, why: 'frenzy' });
    return;
  }
  if (hasP(S, to, 'g_dark2') && !once.gdark) {
    once.gdark = 1;
    S.hp[to] = Math.floor(S.maxHp[to] / 2);
    X.rs.push({ k: 'rise', to, why: 'gdark' });
    return;
  }
  S.hp[to] = 0;
  S.down[to] = true;
  S.block[to] = 0;
  S.blkBy[to] = {};
  S.energy[to] = 0;
  for (const s of ['bleed', 'bleedBy', 'ward', 'vuln', 'weak', 'stun']) setSt(S, to, s, null);
  S.downSeq = (S.downSeq || 0) + 1;
  S.downAt[to] = S.downSeq;
  S.downedIn[to] = S.room;
  X.downs.push({ to, by: by || null, how: how || '' });
  X.rs.push({ k: 'down', to, by: by || null });
  if (by && !isFoeKey(by) && by !== to) addCorrupt(S, by, KILL_ALLY_CORRUPT, X.rs); // 아군을 쓰러뜨렸다
  for (const p of upHeroes(S)) {
    if (!hasP(S, p, 'p_dark2')) continue;
    const r = resOf(S, p);
    r.faith = Math.min(faithMax(S, p), (r.faith || 0) + 4);
    const g = Math.min(10, S.maxHp[p] - S.hp[p]);
    if (g > 0) {
      S.hp[p] += g;
      X.rs.push({ k: 'heal', by: p, to: p, v: g });
    }
  }
}

function foeDie(X, fk, by) {
  const { S, W } = X;
  const f = S.foes[fk];
  f.hp = 0;
  f.block = 0;
  f.charge = null;
  W.cancel[fk] = true;
  if (by && !isFoeKey(by)) {
    bump(S.lastHits, by, 1);
    bump(W.killed, by, 1);
    if (hasP(S, by, 'b_dark2') && isUp(S, by)) {
      S.maxHp[by] += 4;
      S.hp[by] += 4;
    }
  }
  X.rs.push({ k: 'die', to: fk, by: by || null });
  for (const k of liveFoes(S)) { // 무덤지기 · 마왕이 쓰러지면 부른 것들도 무너진다
    if (S.foes[k].spawn !== fk) continue;
    S.foes[k].hp = 0;
    W.cancel[k] = true;
    X.rs.push({ k: 'die', to: k });
  }
  if (fk === BOSS) X.downs.push({ to: BOSS, by: by || null });
}

function groggy(X, fk, by) {
  const { S, W } = X;
  const f = S.foes[fk];
  const until = S.tn + 1 + (hasP(S, by, 'smash4') ? 1 : 0);
  f.groggy = until;
  f.charge = null;
  f.i = 0;
  W.cancel[fk] = true;
  if (fk === BOSS) W.groggyBoss = true;
  X.rs.push({ k: 'groggy', to: fk, by, until });
  note(S, `${FOE_NAME(S, fk)} 그로기!`);
}

function brk(X, fk, n, by) {
  const { S, W } = X;
  const f = foeOf(S, fk);
  if (!f?.charge || n <= 0) return 0;
  const c = f.charge;
  const add = Math.min(n, Math.max(0, c.need - (c.got || 0)));
  if (add <= 0) return 0;
  c.got = (c.got || 0) + add;
  bump(W.threat, by, add * 3);
  credit(X, by, 'brk', add);
  bump(X.sums.brk, fk, add);
  X.rs.push({ k: 'brk', by, to: fk, v: add, got: c.got, need: c.need });
  if (c.got >= c.need) groggy(X, fk, by);
  return add;
}

// 대원이 적을 때린다. o = { raw: 되돌려 주는 피해(가시 · 앙갚음), first: 그 기술의 첫 타, firstOn: 그 적에게 첫 타, shooting,
//   alone, pierce, adds: [{ by, v }], how }
function hit(X, by, fk, base, o = {}) {
  const { S, W } = X;
  const f = foeOf(S, fk);
  if (!f) return null;
  const adds = [...(o.adds || [])];
  const bonus = [];
  let red = 1;
  if (!o.raw) {
    if (S.cls[by] === 'berserk') { // 피 끓음
      const boil = Math.floor(Math.max(0, S.maxHp[by] - S.hp[by]) / 10) * 2;
      if (boil) adds.push({ by, v: boil });
    }
    for (const a of list(S.auras)) if (a.k === 'banner') adds.push({ by: a.by, v: 1 });
    if (hasP(S, by, 'judge2') && faithOf(S, by) >= 5) adds.push({ by, v: 3 });
    for (const x of list(W.atkPlus[by])) adds.push(x);
    if (W.bleedPlus[by] && bleedOf(S, fk) > 0) adds.push({ by, v: W.bleedPlus[by] });
    if (o.shooting) {
      if (W.shotPlus[by]) adds.push({ by, v: W.shotPlus[by] });
      if (hasP(S, by, 'rapid2') && (W.planned[by] || 0) >= 4) adds.push({ by, v: 1 });
    }
    if (o.first) {
      for (const x of W.atkFirst) adds.push(x);
      const q = W.nextAtk[by];
      if (q?.length) adds.push({ by, v: q.shift() });
    }
    if (o.firstOn) for (const x of list(W.focus[fk])) adds.push(x);
    if (isVuln(S, fk)) bonus.push({ by: null, v: BONUS.vuln });
    if (isGroggy(S, fk)) bonus.push({ by: null, v: BONUS.groggy });
    for (const x of list(W.dmark[fk])) bonus.push(x);
    if (W.curse[fk]) bonus.push({ by: null, v: BONUS.ghostCurse * W.curse[fk] });
    for (const x of W.team) bonus.push(x);
    if (o.alone) bonus.push({ by, v: BONUS.alone });
    if (isWeak(S, by)) red *= WEAK_MULT;
    if (fk === BOSS && W.armor) red *= 0.5;
  }
  const addSum = adds.reduce((s, x) => s + x.v, 0);
  const bonSum = bonus.reduce((s, x) => s + x.v, 0);
  const dmg = Math.max(0, Math.floor((base + addSum) * (1 + bonSum) * red));
  if (dmg <= 0) return { d: 0, a: 0, dealt: 0, dead: false };
  const a = o.pierce ? 0 : Math.min(dmg, f.block || 0);
  f.block = (f.block || 0) - a;
  const d = Math.min(dmg - a, f.hp);
  f.hp -= d;
  const dealt = a + d;
  // 남이 준 강화로 늘어난 만큼은 강화를 준 사람의 기여도
  const shares = {};
  for (const x of adds) if (x.by && x.by !== by) bump(shares, x.by, x.v * (1 + bonSum) * red);
  for (const x of bonus) if (x.by && x.by !== by) bump(shares, x.by, (base + addSum) * x.v * red);
  const tot = Object.values(shares).reduce((s, v) => s + v, 0);
  const scale = tot > dmg ? dmg / tot : 1;
  let given = 0;
  for (const [g, v] of Object.entries(shares)) {
    const c = Math.floor((v * scale * dealt) / dmg);
    given += c;
    credit(X, g, 'dmg', c);
  }
  credit(X, by, 'dmg', dealt - given);
  bump(W.threat, by, dealt);
  bump(X.sums.foe, fk, dealt);
  const bp = W.blessed[by]; // 축복 숙련: 내가 강화한 아군이 적을 때리면 신앙 +1 (턴마다 2까지)
  if (bp && !o.raw && hasP(S, bp, 'bless2') && (W.blessFaith[bp] || 0) < 2) {
    W.blessFaith[bp] = (W.blessFaith[bp] || 0) + 1;
    const r = resOf(S, bp);
    r.faith = Math.min(faithMax(S, bp), (r.faith || 0) + 1);
  }
  const ev = { k: 'hit', by, to: fk, d, a, ...(o.how ? { how: o.how } : {}) };
  X.rs.push(ev);
  if (fk === BOSS && W.spikes && !o.raw && !W.spiked[by] && isUp(S, by)) { // 마왕의 가시
    W.spiked[by] = true;
    hurt(X, by, W.spikes, BOSS, { src: BOSS, how: '가시' });
  }
  if (f.hp <= 0) {
    ev.dead = 1;
    foeDie(X, fk, by);
  }
  return { d, a, dealt, dead: f.hp <= 0 };
}

// 기술이 영향을 주는 아군들
function allyTargets(S, id, to, t) {
  switch (to) {
    case 'self': return [id];
    case 'ally': case 'other': case 'down': return t && !isFoeKey(t) ? [t] : [];
    case 'allies': return upHeroes(S);
    case 'others': return upHeroes(S).filter(x => x !== id);
    default: return [id];
  }
}
const phaseOf = def => (isAtkPhase(def) ? 'atk' : def.fx.some(([op]) => HEAL.has(op)) ? 'heal' : 'prep');

// 기술을 썼다 (금단이면 타락 +1, 최종전이면 마왕이 회복한다)
function use(X, e) {
  const { S } = X;
  X.rs.push({ k: 'use', by: e.id, c: e.k, ...(e.m ? { m: e.m } : {}), ...(e.t ? { t: e.t } : {}), ...(e.def.dark ? { dark: 1 } : {}) });
  if (!e.def.dark) return;
  addCorrupt(S, e.id, USE_CORRUPT, X.rs);
  const b = foeOf(S, BOSS);
  if (b) { // 독박: 최종전에서 금단을 쓰면 마왕이 회복한다
    const v = Math.min(SCAPEGOAT_HEAL, b.max - b.hp);
    if (v > 0) {
      b.hp += v;
      X.rs.push({ k: 'feed', by: e.id, v });
    }
  }
}

function prep(X, e) {
  const { S, W } = X;
  const id = e.id;
  const def = e.def;
  const tg = allyTargets(S, id, def.to, e.t);
  const nv = v => (e.alone ? Math.ceil(v * 1.5) : v); // 홀로: 방어 · 회복 같은 수치 +50%
  for (const [op, a1, a2, a3] of e.fx) {
    switch (op) {
      case 'hpCost':
        S.hp[id] = Math.max(1, S.hp[id] - a1);
        X.rs.push({ k: 'cost', to: id, v: a1 });
        break;
      case 'allyHp':
        for (const t of tg) {
          if (!isUp(S, t)) continue;
          S.hp[t] -= a1;
          X.rs.push({ k: 'hurt', to: t, by: id, d: a1, a: 0, how: def.name });
          if (S.hp[t] <= 0) down(X, t, id, def.name);
        }
        break;
      case 'energyNext': for (const t of tg) if (isUp(S, t)) nxt(S, t).e += a1; break;
      case 'handNext': nxt(S, id).h += a1; break;
      case 'rounds': {
        const r = resOf(S, id);
        const R = { ...obj(r.rounds) };
        R[a1] = (R[a1] || 0) + a2 + (hasP(S, id, 'bomb2') ? 1 : 0);
        r.rounds = R;
        break;
      }
      case 'aim': resOf(S, id).aim = aimOf(S, id) + nv(a1); break;
      case 'block': for (const t of tg) blk(X, id, t, nv(a1)); break;
      case 'blockSelf': blk(X, id, id, nv(a1)); break;
      case 'blockIfNoAtk': if (!e.planHasAtk) blk(X, id, id, nv(a1)); break;
      case 'blockFromMine': {
        const v = Math.floor((S.block[id] || 0) * a1);
        if (v > 0) for (const t of tg) blk(X, id, t, nv(v));
        break;
      }
      case 'taunt': if (!W.taunt) W.taunt = id; break;
      case 'intercept': for (const t of tg) W.icpt[t] = id; break;
      case 'absorbAll': W.absorb = { by: id, r: a1 }; break;
      case 'undying': W.undying[id] = true; break;
      case 'thorns': bump(W.thorns, id, nv(a1)); break;
      case 'avenge': W.avenge[id] = true; break;
      case 'selfVuln': extend(S, id, 'vuln', S.tn); break;
      case 'atkPlus':
        for (const t of tg) {
          (W.atkPlus[t] ||= []).push({ by: id, v: nv(a1) });
          W.blessed[t] = id;
        }
        break;
      case 'atkFirst': W.atkFirst.push({ by: id, v: nv(a1) }); break;
      case 'nextAtk': (W.nextAtk[id] ||= []).push(nv(a1)); break;
      case 'shotPlus': bump(W.shotPlus, id, nv(a1)); break;
      case 'bleedHitPlus': bump(W.bleedPlus, id, nv(a1)); break;
      case 'focus': if (foeOf(S, e.t)) (W.focus[e.t] ||= []).push({ by: id, v: nv(a1) }); break;
      case 'teamDmg':
        W.team.push({ by: id, v: a1 * (e.alone ? 1.5 : 1) });
        for (const t of upHeroes(S)) W.blessed[t] ||= id;
        break;
      case 'deathMark': if (foeOf(S, e.t)) (W.dmark[e.t] ||= []).push({ by: id, v: a1 }); break;
      case 'aura': S.auras = [...list(S.auras), { by: id, k: a1, v: nv(a2) }]; break;
      case 'regen':
        for (const t of tg) if (isUp(S, t)) S.regen = { ...obj(S.regen), [t]: [...list(S.regen?.[t]), { by: id, h: nv(a1), b: a2, left: a3 }] };
        break;
      case 'ward': for (const t of tg) if (isUp(S, t)) setSt(S, t, 'ward', 1); break;
      case 'faith': resOf(S, id).faith = Math.min(faithMax(S, id), faithOf(S, id) + a1); break;
      case 'aimIfNoShot': bump(W.aimEnd, id, nv(a1)); break;
      default: break;
    }
  }
  if (e.m === 'shield') blk(X, id, id, 4, true);
}

function attack(X, e) {
  const { S, W } = X;
  const id = e.id;
  const def = e.def;
  if (!isUp(S, id)) return; // 앞에서 쓰러졌으면 안 나간다
  use(X, e);
  const fx = e.fx;
  const opv = op => fx.find(x => x[0] === op);
  const has = op => !!opv(op);
  let t = e.t;
  if (t === '@all' && def.faithAll) {
    const r = resOf(S, id);
    if ((r.faith || 0) >= def.faithAll) r.faith -= def.faithAll;
    else t = lowestFoe(S);
  }
  const target = () => {
    if (t === '@all') return t;
    if (!foeOf(S, t)) t = lowestFoe(S); // 노린 적이 이미 쓰러졌으면 체력이 제일 낮은 적에게
    return t;
  };
  const shooting = !!def.ammo;
  const rnd = { ap: 0, fire: 0 };
  if (shooting && e.spent > 0) { // 특수탄: 쏜 발수만큼 쓴다
    const r = resOf(S, id);
    const R = { ...obj(r.rounds) };
    for (const ty of ['ap', 'fire']) {
      const n = Math.min(R[ty] || 0, e.spent);
      rnd[ty] = n;
      R[ty] = (R[ty] || 0) - n;
      if (R[ty] <= 0) delete R[ty];
    }
    r.rounds = R;
    W.shot[id] = (W.shot[id] || 0) + e.spent;
  }
  let hitNo = 0;
  let first = true;
  const firstOn = {};
  let dealtSum = 0;
  let hpSum = 0;
  let killed = false;
  const strike = (fk, base) => {
    if (!foeOf(S, fk)) return null;
    const ap = hitNo < rnd.ap;
    const fire = hitNo < rnd.fire;
    const adds = [];
    if (first && shooting && aimOf(S, id)) { // 조준: 다음에 쏘는 한 발
      adds.push({ by: id, v: aimOf(S, id) * 4 * (has('aimDouble') ? 2 : 1) });
      resOf(S, id).aim = 0;
    }
    const res = hit(X, id, fk, base, { first, firstOn: !firstOn[fk], shooting, alone: e.alone, pierce: has('pierce') || ap, adds, how: def.name });
    first = false;
    firstOn[fk] = true;
    hitNo += 1;
    if (res) {
      dealtSum += res.dealt;
      hpSum += res.d;
      if (res.dead) killed = true;
    }
    if (ap) brk(X, fk, 1, id);
    if (fire) addBleed(X, fk, 1, id);
    return res;
  };
  const smash = hasP(S, id, 'smash2') ? 2 : 0;
  for (const [op, a1, a2] of fx) {
    switch (op) {
      case 'dmg': {
        const times = (a2 || 1) * (has('againIfLow') && S.hp[id] * 2 <= S.maxHp[id] ? 2 : 1);
        for (let i = 0; i < times; i++) {
          const fk = target();
          if (!fk) break;
          let base = a1;
          if (has('plusLostHp')) base += Math.max(0, S.maxHp[id] - S.hp[id]);
          const F = S.foes[fk];
          if (has('x2LowOrGroggy') && (isGroggy(S, fk) || F.hp * 10 <= F.max * 3)) base *= 2;
          strike(fk, base);
        }
        break;
      }
      case 'dmgAll': for (const fk of liveFoes(S)) strike(fk, a1); break;
      case 'splash': for (const fk of liveFoes(S)) if (fk !== t) strike(fk, a1); break;
      case 'dmgPerAmmo':
        for (let i = 0; i < e.spent; i++) {
          const fk = target();
          if (!fk) break;
          strike(fk, a1);
        }
        break;
      case 'dmgFromBlock': {
        const fk = target();
        const v = Math.min(a2, Math.floor((S.block[id] || 0) * a1));
        if (fk && v > 0) strike(fk, v);
        break;
      }
      case 'dmgLastBlocked': {
        const fk = target();
        const v = Math.min(a1, S.lastBlk?.[id] || 0);
        if (fk && v > 0) strike(fk, v);
        break;
      }
      case 'dmgFromBleed': {
        const fk = target();
        if (fk && bleedOf(S, fk) > 0) strike(fk, bleedOf(S, fk));
        break;
      }
      case 'bleedDouble': {
        const fk = target();
        if (!fk) break;
        const b = Math.min(BLEED_MAX, bleedOf(S, fk) * 2);
        if (b <= 0) break;
        setSt(S, fk, 'bleed', b);
        setSt(S, fk, 'bleedBy', id);
        strike(fk, b);
        break;
      }
      case 'dmgFaith': {
        const fk = target();
        if (!fk) break;
        const r = resOf(S, id);
        const f = r.faith || 0;
        r.faith = 0;
        strike(fk, a1 + f * a2);
        break;
      }
      case 'brk': { const fk = target(); if (fk && fk !== '@all') brk(X, fk, a1 + smash, id); break; }
      case 'brkAll': for (const fk of liveFoes(S)) brk(X, fk, a1 + smash, id); break;
      case 'vuln': case 'weak': {
        const fks = t === '@all' ? liveFoes(S) : [target()].filter(Boolean);
        for (const fk of fks) {
          if (!foeOf(S, fk)) continue;
          extend(S, fk, op, S.tn + a1 - 1);
          X.rs.push({ k: 'st', to: fk, s: op, by: id });
        }
        break;
      }
      case 'bleed': { const fk = target(); if (fk && fk !== '@all') addBleed(X, fk, a1, id); break; }
      case 'bleedAll': for (const fk of liveFoes(S)) addBleed(X, fk, a1, id); break;
      case 'hitLowestAlly': {
        const o = lowestHero(S, id);
        if (o) hurt(X, o, a1, id, { friendly: true, src: id, how: def.name });
        break;
      }
      case 'hitAllies': for (const o of upHeroes(S).filter(x => x !== id)) hurt(X, o, a1, id, { friendly: true, src: id, how: def.name }); break;
      case 'bleedAllies': for (const o of upHeroes(S).filter(x => x !== id)) addBleed(X, o, a1, id); break;
      default: break;
    }
  }
  if (e.m === 'crush') { // 파쇄: 차단 +3
    if (def.to === 'foes' || t === '@all') for (const fk of liveFoes(S)) brk(X, fk, 3, id);
    else { const fk = target(); if (fk) brk(X, fk, 3, id); }
  }
  if (has('lifesteal') && dealtSum > 0) heal(X, id, id, dealtSum, true);
  if (e.m === 'leech' && hpSum > 0) heal(X, id, id, Math.floor(hpSum * LEECH), true);
  if (has('onKillEnergy') && killed) nxt(S, id).e += opv('onKillEnergy')[1] || 0;
}

function healStep(X, e) {
  const { S } = X;
  const id = e.id;
  const def = e.def;
  if (!isUp(S, id)) return;
  if (e.phase === 'heal') use(X, e);
  const tg = allyTargets(S, id, def.to, e.t);
  const nv = v => (e.alone ? Math.ceil(v * 1.5) : v);
  for (const [op, a1, a2] of e.fx) {
    switch (op) {
      case 'heal': for (const t of tg) heal(X, id, t, nv(a1)); break;
      case 'healMostHurt': {
        const t = upHeroes(S).sort((a, b) => (S.maxHp[b] - S.hp[b]) - (S.maxHp[a] - S.hp[a]) || S.hp[a] - S.hp[b])[0];
        if (t) heal(X, id, t, nv(a1));
        break;
      }
      case 'cleanse':
        for (const t of tg) {
          if (!isUp(S, t)) continue;
          for (const s of ['vuln', 'weak', 'stun', 'bleed', 'bleedBy']) setSt(S, t, s, null);
          X.rs.push({ k: 'cleanse', by: id, to: t });
        }
        break;
      case 'revive': {
        const t = e.t;
        if (!partyOf(S).includes(t) || !S.down[t]) break;
        delete S.down[t];
        S.hp[t] = Math.floor(S.maxHp[t] / 2);
        S.energy[t] = 0;
        credit(X, id, 'heal', S.hp[t]);
        X.rs.push({ k: 'rise', to: t, by: id });
        note(S, `${e.t} 부활`);
        break;
      }
      case 'transfer': {
        const t = tg[0];
        if (!isUp(S, t)) break;
        const donor = upHeroes(S).filter(x => x !== t).sort((a, b) => S.hp[b] - S.hp[a])[0];
        if (!donor) break;
        const take = Math.max(0, Math.min(a1, S.hp[donor] - 1));
        if (take) {
          S.hp[donor] -= take;
          X.rs.push({ k: 'hurt', to: donor, by: id, d: take, a: 0, how: def.name });
        }
        heal(X, id, t, nv(a2));
        break;
      }
      default: break;
    }
  }
}

/* ── 적의 행동 ── */

const FOE_NAME = (S, fk) => (fk === BOSS ? (S.boss && S.boss !== 'king' ? '마왕' : '이름 없는 왕') : FOES[S.foes?.[fk]?.k]?.name || '적');

function bossPrep(X, plan) {
  const { S, W } = X;
  const b = foeOf(S, BOSS);
  if (!b || isGroggy(S, BOSS)) return;
  for (const it of plan) {
    const P = POWERS[it.p];
    if (!P?.prep) continue;
    X.rs.push({ k: 'power', by: BOSS, p: it.p, ...(it.to ? { to: it.to } : {}) });
    if (it.p === 'armor') W.armor = true;
    if (it.p === 'rampart') b.block = (b.block || 0) + (it.v || 0);
    if (it.p === 'jail') for (const t of list(it.to)) W.jail[t] = true;
    if (it.p === 'spikes') W.spikes = 5;
    if (it.p === 'roar') for (const t of upHeroes(S)) extend(S, t, 'vuln', S.tn);
    if (it.p === 'falseBless') for (const t of list(it.to)) W.fbless[t] = true;
  }
}

function bossAct(X, plan) {
  const { S, W } = X;
  for (const it of plan) {
    const b = foeOf(S, BOSS);
    if (!b || W.cancel[BOSS]) return;
    const P = POWERS[it.p];
    if (!P || P.prep || P.veil || P.doom) continue;
    X.rs.push({ k: 'power', by: BOSS, p: it.p, ...(it.to ? { to: it.to } : {}) });
    const weak = isWeak(S, BOSS);
    const atk = (to, v, single = true) => hurt(X, to, v, BOSS, { single, aimed: single, src: BOSS, weak, how: P.name });
    const steal = d => {
      if (d > 0 && foeOf(S, BOSS)) {
        const g = Math.min(d, b.max - b.hp);
        b.hp += g;
        if (g) X.rs.push({ k: 'bheal', to: BOSS, v: g });
      }
    };
    switch (it.p) {
      case 'smite': case 'butcher': for (const t of list(it.to)) atk(t, it.v); break;
      case 'double': for (const t of [...list(it.to), ...list(it.rand)]) atk(t, it.v); break;
      case 'sweep': for (const t of upHeroes(S)) atk(t, it.v, false); break;
      case 'curse':
        for (const t of list(it.to)) {
          if (!isUp(S, t)) continue;
          extend(S, t, 'weak', S.tn + 1);
          extend(S, t, 'vuln', S.tn + 1);
          X.rs.push({ k: 'st', to: t, s: 'curse', by: BOSS });
        }
        break;
      case 'drain': case 'feast': case 'siphon': for (const t of list(it.to)) steal(atk(t, it.v)); break;
      case 'shieldBreak': for (const t of list(it.to)) atk(t, b.block || 0); break;
      case 'rampage': for (const t of list(it.rand)) atk(t, it.v); break;
      case 'markShot': for (const t of list(it.to)) S.later = [...list(S.later), { to: t, v: it.v, at: S.tn + 1 }]; break;
      case 'rapidFire': for (const t of list(it.to)) for (let i = 0; i < (P.times || 4); i++) atk(t, it.v); break;
      case 'legShot':
        for (const t of list(it.to)) {
          atk(t, it.v);
          if (isUp(S, t)) nxt(S, t).e -= P.sap || 1;
        }
        break;
      case 'ricochet':
        for (const t of list(it.to)) atk(t, it.v);
        for (const t of list(it.rand)) atk(t, it.v2);
        break;
      case 'plagueB': for (const t of upHeroes(S)) addBleed(X, t, P.bleed || 3, BOSS); break;
      case 'raise': for (let i = 0; i < (P.summon || 2); i++) spawn(S, 'skel', BOSS); break;
      default: break;
    }
  }
}

function spawn(S, k, from) {
  S.spawnNo = (S.spawnNo || 0) + 1;
  const key = `@${k[0]}${S.spawnNo}`;
  const F = FOES[k];
  S.foes[key] = { k, hp: F.hp, max: F.hp, block: 0, spawn: from, intent: [], next: [], ...(k === 'tomb' ? { grow: S.tn + F.grow } : {}) };
  return key;
}

function foeAct(X, fk) {
  const { S, W } = X;
  const f = foeOf(S, fk);
  if (!f || W.cancel[fk] || isGroggy(S, fk) || isStun(S, fk)) return;
  const weak = isWeak(S, fk);
  const name = FOE_NAME(S, fk);
  for (const it of list(f.intent)) {
    if (!foeOf(S, fk) || W.cancel[fk]) return;
    switch (it.k) {
      case 'hit':
        X.rs.push({ k: 'act', by: fk, a: 'hit' });
        for (const t of list(it.to)) if (foeOf(S, fk)) hurt(X, t, it.v, fk, { single: true, src: fk, weak, how: name });
        break;
      case 'all':
        X.rs.push({ k: 'act', by: fk, a: 'all' });
        for (const t of upHeroes(S)) if (foeOf(S, fk)) hurt(X, t, it.v, fk, { src: fk, weak, how: name });
        break;
      case 'slam': {
        f.charge = null;
        X.rs.push({ k: 'ult', by: fk, u: 'slam' });
        const order = threatOrder(S);
        const tos = list(it.to).map(t => (isUp(S, t) ? t : order.find(x => !list(it.to).includes(x)) || order[0])).filter(Boolean);
        for (const t of tos) hurt(X, t, it.v, fk, { single: true, src: fk, weak, how: ULTS.slam.name });
        break;
      }
      case 'bury':
        f.charge = null;
        X.rs.push({ k: 'ult', by: fk, u: 'bury' });
        for (const t of upHeroes(S)) hurt(X, t, it.v, fk, { src: fk, weak, stun: true, how: ULTS.bury.name });
        break;
      case 'tomb': {
        const key = spawn(S, 'tomb', fk);
        X.rs.push({ k: 'spawn', by: fk, to: key });
        break;
      }
      default: break;
    }
  }
}

function foePhase(X, bossNow) {
  const { S, W } = X;
  if (foeOf(S, BOSS) && !W.cancel[BOSS] && !isGroggy(S, BOSS)) {
    bossAct(X, list(bossNow));
    const b = foeOf(S, BOSS);
    const c = b?.charge;
    if (b && !W.cancel[BOSS] && c?.u === 'doom' && c.fire <= S.tn) { // 종말
      b.charge = null;
      X.rs.push({ k: 'ult', by: BOSS, u: 'doom' });
      for (const t of upHeroes(S)) hurt(X, t, c.v, BOSS, { src: BOSS, weak: isWeak(S, BOSS), how: ULTS.doom.name });
    }
    for (const l of list(S.later)) { // 표적 지정: 지난 턴에 표식을 찍은 사람에게
      if (l.at !== S.tn || !foeOf(S, BOSS) || W.cancel[BOSS]) continue;
      X.rs.push({ k: 'power', by: BOSS, p: 'markShot', to: [l.to], fire: 1 });
      hurt(X, l.to, l.v, BOSS, { single: true, aimed: true, src: BOSS, weak: isWeak(S, BOSS), how: '표적 지정' });
    }
  }
  for (const fk of liveFoes(S)) if (fk !== BOSS) foeAct(X, fk);
}

function endTurn(X) {
  const { S, W } = X;
  // 출혈
  const gore2 = upHeroes(S).some(p => hasP(S, p, 'gore2'));
  for (const u of [...upHeroes(S), ...liveFoes(S)]) {
    const b = bleedOf(S, u);
    if (b <= 0) continue;
    const by = stOf(S, u).bleedBy || null;
    if (isFoeKey(u)) {
      const f = S.foes[u];
      const d = Math.min(b, f.hp);
      f.hp -= d;
      credit(X, by, 'dmg', d);
      bump(W.threat, by, d);
      bump(X.sums.foe, u, d);
      X.rs.push({ k: 'bleed', to: u, d, by });
      for (const p of upHeroes(S)) if (hasP(S, p, 'gore4')) heal(X, p, p, 2, true);
      if (f.hp <= 0) foeDie(X, u, by);
      else if (!gore2) setSt(S, u, 'bleed', b - 1);
    } else {
      setSt(S, u, 'bleed', b - 1);
      hurt(X, u, b, by, { raw: true, src: by, how: '출혈' });
    }
  }
  // 앙갚음: 이번 턴 내가 막아 낸 피해를 때린 적들에게
  for (const id of Object.keys(W.avenge)) {
    if (!isUp(S, id)) continue;
    for (const [fk, v] of Object.entries(W.avFrom[id] || {})) if (v > 0 && foeOf(S, fk)) hit(X, id, fk, v, { raw: true, how: '앙갚음' });
  }
  // 조준: 한 발도 안 쏜 턴
  for (const id of upHeroes(S)) {
    if (S.cls[id] !== 'gunner' || W.shot[id] > 0) continue;
    const add = (W.aimEnd[id] || 0) + (hasP(S, id, 'snipe2') ? 1 : 0);
    if (add) resOf(S, id).aim = aimOf(S, id) + add;
  }
  // 역병의 성자: 턴 끝마다 회복
  const b = foeOf(S, BOSS);
  if (b && S.bossCls === 'priest' && !isGroggy(S, BOSS)) {
    const g = Math.min((S.nHero || 1) * 2, b.max - b.hp);
    if (g > 0) {
      b.hp += g;
      X.rs.push({ k: 'bheal', to: BOSS, v: g });
    }
  }
  // 방어도: 수호자만 절반(성벽 각성이면 전부, 최대 30)이 다음 턴으로
  for (const id of partyOf(S)) {
    let keep = 0;
    if (S.cls[id] === 'guard' && isUp(S, id)) keep = hasP(S, id, 'wall4') ? Math.min(30, S.block[id] || 0) : Math.floor((S.block[id] || 0) / 2);
    S.block[id] = keep;
    S.blkBy[id] = keep ? { [id]: keep } : {};
  }
  for (const fk of liveFoes(S)) {
    const f = S.foes[fk];
    f.block = fk === BOSS && S.bossCls === 'guard' ? Math.floor((f.block || 0) / 2) : 0;
  }
  for (const id of partyOf(S)) S.energy[id] = Math.min(ENERGY_MAX, S.energy[id] || 0); // 6을 넘는 기력은 사라진다
  S.lastBlk = { ...W.blockedOn };
  S.later = list(S.later).filter(l => l.at > S.tn);
}

// 위협도가 높은 순 (같으면 rand)
export function threatOrder(S, rand = null) {
  const hs = upHeroes(S);
  const r = new Map(hs.map((h, i) => [h, rand ? rand() : i]));
  return hs.sort((a, b) => (S.threat?.[b] || 0) - (S.threat?.[a] || 0) || r.get(a) - r.get(b));
}

// 한 턴 전체. vplans = validatePlan 결과들(준비 완료 순), opt = { bossNow: 이번 턴 마왕의 권능, ghosts: 원혼의 손길 }
// S를 고친다 (미리 보기는 복사본에). 돌려주는 것: 장면(rs) · 합계 · 쓰러진 사람 · 결과
export function runTurn(S, vplans, opt = {}) {
  norm(S);
  const X = workOf(S);
  const { W } = X;
  const entries = [];
  for (const vp of vplans) {
    const id = vp.id;
    if (!isUp(S, id)) continue;
    S.energy[id] = vp.energyLeft;
    if (S.cls[id] === 'gunner') resOf(S, id).ammo = vp.ammoLeft;
    W.planned[id] = vp.shots || 0;
    const real = vp.cards.filter(c => !c.q);
    const planHasAtk = real.some(c => isAttack(CARDS[c.k]));
    for (const c of vp.cards) {
      const def = c.q ? qDef(S, id) : CARDS[c.k];
      if (!def) continue;
      if (c.q) S.cd[id] = S.tn + qCdOf(S, id);
      entries.push({ ...c, id, def, fx: c.q ? def.fx.map(x => [...x]) : fxOf(c), phase: phaseOf(def), planHasAtk, alone: !c.q && real.length === 1 && c.m === 'alone' });
    }
  }
  const bossNow = list(opt.bossNow);
  bossPrep(X, bossNow);
  for (const [g, a] of Object.entries(obj(opt.ghosts))) { // 원혼: 살아 있는 한 명에게 방어 +3, 또는 적 하나가 받는 피해 +10%
    if (!partyOf(S).includes(g) || !S.down[g]) continue;
    if (a?.k === 'guard' && isUp(S, a.t)) blk(X, g, a.t, GHOST_BLOCK, true);
    if (a?.k === 'curse' && foeOf(S, a.t)) bump(W.curse, a.t, 1);
  }
  for (const e of entries) {
    if (!isUp(S, e.id)) continue;
    if (e.phase === 'prep') use(X, e);
    prep(X, e);
  }
  const speed = e => (e.def.spd === 'first' || e.m === 'swift' ? 0 : e.def.spd === 'last' ? 2 : 1);
  for (const g of [0, 1, 2]) for (const e of entries) if (e.phase === 'atk' && speed(e) === g) attack(X, e);
  for (const e of entries) if (e.def.fx.some(([op]) => HEAL.has(op))) healStep(X, e);
  foePhase(X, bossNow);
  endTurn(X);
  let result = null;
  if (isFinal(S)) result = !foeOf(S, BOSS) ? 'win' : !upHeroes(S).length ? 'lose' : null;
  else result = !liveFoes(S).length ? 'clear' : !upHeroes(S).length ? 'fail' : null;
  S.threat = { ...W.threat };
  return { rs: X.rs, sums: X.sums, downs: X.downs, result, groggyBoss: W.groggyBoss, threat: W.threat };
}

/* ───────── 예고 ───────── */

const enrageOf = (S, tier) => (S.turn >= ENRAGE[tier] ? ENRAGE.add * (S.turn - ENRAGE[tier] + 1) : 0);
export const targetCount = n => Math.max(1, Math.ceil(n / 3));

function makeIntents(S, rand) {
  const order = threatOrder(S, rand);
  const n = order.length;
  if (!n) return;
  const tops = order.slice(0, targetCount(n));
  const E = enrageOf(S, S.tier || 'mob');
  let gi = 0;
  for (const fk of liveFoes(S)) {
    if (fk === BOSS) continue;
    const f = S.foes[fk];
    if (isGroggy(S, fk)) {
      f.intent = [{ k: 'groggy', until: f.groggy }];
      f.next = f.groggy > S.tn ? ['groggy'] : [];
      continue;
    }
    switch (f.k) {
      case 'ghoul':
        f.intent = [{ k: 'hit', to: [order[gi++ % n]], v: FOES.ghoul.hit + E }];
        f.next = ['hit'];
        break;
      case 'skel':
        f.intent = [{ k: 'hit', to: [pickR(order, rand)], v: FOES.skel.hit + E }];
        f.next = ['hit'];
        break;
      case 'tomb':
        f.intent = [{ k: 'grow', at: f.grow }];
        f.next = f.grow <= S.tn + 1 ? ['hit'] : ['grow'];
        break;
      case 'golem': {
        const s = (f.i || 0) % 3;
        f.i = (f.i || 0) + 1;
        if (s === 0) {
          f.charge = { u: 'slam', fire: S.tn + ULT_WIND, need: n * BREAK_PER_HERO.elite, got: 0, to: tops };
          f.intent = [{ k: 'hit', to: tops, v: 10 + E }, { k: 'charge', u: 'slam', fire: f.charge.fire, to: tops }];
          f.next = ['all'];
        } else if (s === 1) {
          f.intent = [{ k: 'all', v: 6 + E }];
          f.next = ['slam'];
        } else {
          const to = list(f.charge?.to).map(t => (isUp(S, t) ? t : order.find(x => !list(f.charge?.to).includes(x)) || order[0]));
          f.intent = [{ k: 'slam', to: to.length ? to : tops, v: ULTS.slam.v + E }];
          f.next = ['hit', 'charge'];
        }
        break;
      }
      case 'keeper': {
        const s = (f.i || 0) % 6;
        f.i = (f.i || 0) + 1;
        if (s === 0) { f.intent = [{ k: 'hit', to: tops, v: 14 + E }]; f.next = ['tomb', 'all']; }
        if (s === 1) { f.intent = [{ k: 'tomb' }, { k: 'all', v: 6 + E }]; f.next = ['hit']; }
        if (s === 2) { f.intent = [{ k: 'hit', to: tops, v: 14 + E }]; f.next = ['charge', 'hit']; }
        if (s === 3) {
          f.charge = { u: 'bury', fire: S.tn + ULT_WIND, need: n * BREAK_PER_HERO.boss, got: 0 };
          f.intent = [{ k: 'charge', u: 'bury', fire: f.charge.fire }, { k: 'hit', to: tops, v: 10 + E }];
          f.next = ['all'];
        }
        if (s === 4) { f.intent = [{ k: 'all', v: 6 + E }]; f.next = ['bury']; }
        if (s === 5) { f.intent = [{ k: 'bury', v: ULTS.bury.v + E }]; f.next = ['hit']; }
        break;
      }
      default:
        f.intent = [];
        f.next = [];
    }
  }
}

// 마왕 쪽 배율: 타락 1마다 +3% · 피에 미친 것(잃은 체력 20%마다 +10%) · 원정대가 적으면 줄인다
export function bossMult(S) {
  const b = S.foes?.[BOSS];
  const corrupt = S.boss && S.boss !== 'king' ? S.corrupt?.[S.boss] || 0 : 0;
  let bonus = corrupt * BOSS_DMG_PER_CORRUPT;
  if (S.bossCls === 'berserk' && b) bonus += 0.1 * Math.floor(((b.max - b.hp) / b.max) / 0.2);
  return (1 + bonus) * (BOSS_FEW[S.nHero] || 1);
}

// 낸 권능 → 이번 턴에 실제로 할 일 (지목 대상 · 무작위 대상 · 수치를 여기서 정한다)
function buildBossPlan(S, vb, rand) {
  const seat = upHeroes(S);
  const n = seat.length;
  if (!n) return [];
  const kk = targetCount(n);
  const mult = bossMult(S);
  const E = enrageOf(S, 'boss');
  const val = v => Math.floor((v + E) * mult);
  const aimed = t => {
    const t0 = isUp(S, t) ? t : lowestHero(S);
    const i = seat.indexOf(t0);
    const out = [t0];
    for (let j = 1; out.length < kk && j < n; j++) out.push(seat[(i + j) % n]);
    return out;
  };
  const plan = [];
  for (const c of vb.cards) {
    const P = POWERS[c.k];
    const it = { k: 'p', p: c.k, u: c.u };
    if (P.aim) it.to = aimed(c.t);
    if (P.v) it.v = val(P.v);
    if (c.k === 'double') it.rand = [pickR(seat.filter(x => !it.to.includes(x)), rand) || pickR(seat, rand)];
    if (c.k === 'rampage') it.rand = Array.from({ length: P.hits || 3 }, () => pickR(seat, rand));
    if (c.k === 'ricochet') {
      it.rand = shuffleR(seat.filter(x => !it.to.includes(x)), rand).slice(0, 2);
      it.v2 = val(P.others || 6);
    }
    if (c.k === 'rampart') it.v = (S.nHero || n) * 6;
    if (c.k === 'doom') {
      S.foes[BOSS].charge = { u: 'doom', fire: S.tn + ULT_WIND, need: (S.nHero || n) * BREAK_PER_HERO.boss, got: 0, v: val(ULTS.doom.v) };
      it.fire = S.foes[BOSS].charge.fire;
    }
    plan.push(it);
  }
  return plan;
}

// 공개용 예고: 장막에 가린 건 '?'
function publicIntent(plan, veil) {
  return plan.filter(it => it.p !== 'veil').map(it => {
    if (veil && it.u === veil) return { k: '?' };
    if (it.p === 'doom') return { k: 'charge', u: 'doom', fire: it.fire };
    const { u, ...rest } = it;
    return rest;
  });
}

/* ───────── 방장: 덱 · 손패 ───────── */

function piles(ctx, id) {
  ctx.secret.piles = obj(ctx.secret.piles);
  const p = obj(ctx.secret.piles[id]);
  ctx.secret.piles[id] = { draw: list(p.draw), hand: list(p.hand), disc: list(p.disc), away: list(p.away) };
  return ctx.secret.piles[id];
}
export const handOf = (ctx, id) => piles(ctx, id).hand;

function drawTo(ctx, id, n) {
  const p = piles(ctx, id);
  while (p.hand.length < n) {
    if (!p.draw.length) {
      if (!p.disc.length) break;
      p.draw = shuffleR(p.disc);
      p.disc = [];
    }
    p.hand.push(p.draw.shift());
  }
}

function countPiles(ctx) {
  const S = ctx.state;
  const hand = {};
  const draw = {};
  const disc = {};
  for (const id of partyOf(S)) {
    const p = piles(ctx, id);
    hand[id] = p.hand.length;
    draw[id] = p.draw.length;
    disc[id] = p.disc.length;
  }
  Object.assign(S, { handN: hand, drawN: draw, discN: disc });
  if (foeOf(S, BOSS) && S.boss !== 'king') {
    const p = piles(ctx, BOSS);
    S.bossN = { hand: p.hand.length, draw: p.draw.length, disc: p.disc.length };
  }
}

function sendPriv(ctx, id) {
  const S = ctx.state;
  if (id === S.boss && foeOf(S, BOSS)) {
    const p = piles(ctx, BOSS);
    const keyOf = u => list(S.bcards).find(c => c.u === u)?.k;
    ctx.setPrivate(id, { boss: 1, hand: p.hand.map(u => ({ u, k: keyOf(u) })), draw: p.draw.map(keyOf).sort(), no: S.no || 0 });
    return;
  }
  const p = piles(ctx, id);
  const card = u => {
    const c = cardOfU(S, id, u);
    return c ? { u, k: c.k, ...(c.m ? { m: c.m } : {}) } : null;
  };
  ctx.setPrivate(id, {
    hand: p.hand.map(card).filter(Boolean),
    draw: p.draw.map(u => cardOfU(S, id, u)?.k).filter(Boolean).sort(),
    offers: list(ctx.secret.offers?.[id]),
    markOffers: list(ctx.secret.markOffers?.[id]),
    whisper: ctx.secret.whispers?.[id] || null,
    no: S.no || 0,
  });
}
const sendAll = ctx => {
  for (const id of list(ctx.state.order)) sendPriv(ctx, id);
  countPiles(ctx);
};

/* ───────── 방장: 단계 ───────── */

function initHero(S, id, k) {
  const C = CLASSES[k];
  S.cls[id] = k;
  S.maxHp[id] = C.hp;
  S.hp[id] = C.hp;
  S.block[id] = 0;
  S.energy[id] = 0;
  S.cards[id] = C.deck.map(key => ({ u: (S.uid = (S.uid || 0) + 1), k: key, n: 0 }));
  S.res[id] = { ammo: k === 'gunner' ? AMMO.base : 0, aim: 0, faith: 0, fp: 0 };
  S.contrib[id] = { dmg: 0, blk: 0, heal: 0, brk: 0 };
}

// 기본기 중 장수가 제일 많은 것 (같으면 덱 앞쪽). keepDef = 방어 기본기 한 장은 남긴다
export function defaultDrop(S, id, keepDef = false) {
  const cs = cardsOf(S, id);
  const base = cs.filter(c => CARDS[c.k]?.tree === 'base');
  const count = k => base.filter(c => c.k === k).length;
  let pool = base;
  if (keepDef) {
    const defs = base.filter(c => isDefCard(CARDS[c.k]));
    if (defs.length <= 1) pool = base.filter(c => !isDefCard(CARDS[c.k]));
  }
  if (!pool.length) pool = base.length ? base : cs;
  const best = [...pool].sort((a, b) => count(b.k) - count(a.k) || cs.indexOf(a) - cs.indexOf(b))[0];
  return best?.u ?? cs[0]?.u;
}

function replaceCard(S, id, dropU, k, m = null) {
  const cs = [...cardsOf(S, id)];
  let i = cs.findIndex(c => c.u === dropU);
  if (i < 0) i = cs.findIndex(c => c.u === defaultDrop(S, id));
  if (i < 0) return null;
  const old = cs[i];
  S.shelf[id] = [...list(S.shelf[id]), { k: old.k, ...(old.m ? { m: old.m } : {}) }];
  S.learnSeq = (S.learnSeq || 0) + 1;
  cs[i] = { u: (S.uid = (S.uid || 0) + 1), k, n: S.learnSeq, ...(m ? { m } : {}) };
  S.cards[id] = cs;
  return old;
}

// 배움 선택지: 주력 계열 1 + 다른 정도 계열 1 + 공통 1 (+ 기여도 1위는 직업 기술 1장 더, 쓰러졌던 사람은 1장 빼기)
export function makeOffers(S, id, kind, rand = Math.random) {
  const C = CLASSES[S.cls?.[id]];
  if (!C) return [];
  const owned = new Set(cardsOf(S, id).map(c => c.k));
  const trees = C.trees.filter(t => !TREES[t].dark);
  const pool = tree => Object.keys(CARDS).filter(k => CARDS[k].tree === tree && !owned.has(k) && (!CARDS[k].ult || treeCount(S, id, tree) >= 2));
  if (kind === 'start1') {
    return trees.map(t => pickR(Object.keys(CARDS).filter(k => CARDS[k].tree === t && !CARDS[k].ult && !owned.has(k)), rand)).filter(Boolean);
  }
  const counts = trees.map(t => [t, treeCount(S, id, t)]);
  const top = Math.max(...counts.map(c => c[1]));
  const main = pickR(counts.filter(c => c[1] === top).map(c => c[0]), rand);
  const others = trees.filter(t => t !== main);
  const out = [];
  const takeFrom = arr => {
    const a = arr.filter(k => !out.includes(k));
    if (a.length) out.push(pickR(a, rand));
    return a.length > 0;
  };
  if (!takeFrom(pool(main))) takeFrom(others.flatMap(pool));
  if (!takeFrom(others.flatMap(pool))) takeFrom(pool(main));
  const commons = Object.keys(CARDS).filter(k => CARDS[k].tree === 'common' && !owned.has(k));
  if (!takeFrom(commons)) takeFrom(trees.flatMap(pool));
  if (kind === 'room' && S.mvp === id) takeFrom(trees.flatMap(pool));
  if (kind === 'room' && S.downedIn?.[id] === S.room && out.length > 2) out.pop();
  return out;
}

function phase(S, name, now, ms) {
  S.phase = name;
  S.phaseAt = now;
  S.phaseEndsAt = now + ms;
}

function startCls(ctx, now) {
  const S = ctx.state;
  S.clsPick = {};
  phase(S, 'cls', now, CLS_TIME);
  return true;
}

function applyCls(ctx, now) {
  const S = ctx.state;
  const taken = new Set();
  for (const id of partyOf(S)) {
    let k = S.clsPick[id];
    if (!CLASSES[k]) k = CLASS_KEYS.find(c => !taken.has(c)) || CLASS_KEYS[Math.floor(Math.random() * CLASS_KEYS.length)];
    taken.add(k);
    initHero(S, id, k);
  }
  S.flow = ['learn:start1', 'learn:start2', 'enter:0'];
  return go(ctx, now);
}

function go(ctx, now) {
  const S = ctx.state;
  const flow = list(S.flow);
  const step = flow[0];
  S.flow = flow.slice(1);
  if (!step) return startFall(ctx, now);
  const [kind, arg] = step.split(':');
  if (kind === 'learn') return startLearn(ctx, now, arg || 'room');
  if (kind === 'mark') return startMark(ctx, now);
  if (kind === 'whisper') return startWhisper(ctx, now);
  if (kind === 'enter') return startRoom(ctx, now, Number(arg));
  return startFall(ctx, now);
}

function startLearn(ctx, now, kind) {
  const S = ctx.state;
  S.no = (S.no || 0) + 1;
  S.learnKind = kind;
  S.done = {};
  S.learned = {};
  ctx.secret.offers = {};
  ctx.secret.picks = {};
  for (const id of partyOf(S)) {
    const offers = makeOffers(S, id, kind);
    ctx.secret.offers[id] = offers;
    if (!offers.length) S.done[id] = true;
  }
  phase(S, 'learn', now, kind.startsWith('start') ? START_LEARN_TIME : LEARN_TIME);
  sendAll(ctx);
  return true;
}

function applyLearn(ctx) {
  const S = ctx.state;
  for (const id of partyOf(S)) {
    const offers = list(ctx.secret.offers?.[id]);
    if (!offers.length) continue;
    let p = ctx.secret.picks?.[id];
    if (!p && S.learnKind.startsWith('start')) p = { i: 0 }; // 시작 기술은 안 고르면 첫 번째
    if (!p || p.skip) {
      S.hp[id] = Math.min(S.maxHp[id], S.hp[id] + SKIP_HEAL);
      S.learned[id] = { skip: 1 };
      continue;
    }
    const k = offers[p.i] ?? offers[0];
    const dropU = cardOfU(S, id, p.drop) ? p.drop : defaultDrop(S, id);
    const old = replaceCard(S, id, dropU, k);
    S.learned[id] = { k, ...(old ? { drop: old.k } : {}) };
  }
  ctx.secret.offers = {};
  ctx.secret.picks = {};
}

function startMark(ctx, now) {
  const S = ctx.state;
  S.no = (S.no || 0) + 1;
  S.done = {};
  S.marked = {};
  ctx.secret.markOffers = {};
  ctx.secret.markPicks = {};
  for (const id of partyOf(S)) {
    const offers = shuffleR(Object.keys(MARKS)).filter(m => cardsOf(S, id).some(c => canMark(c, m))).slice(0, 3);
    ctx.secret.markOffers[id] = offers;
    if (!offers.length) S.done[id] = true;
  }
  phase(S, 'mark', now, MARK_TIME);
  sendAll(ctx);
  return true;
}

function applyMark(ctx) {
  const S = ctx.state;
  for (const id of partyOf(S)) {
    const offers = list(ctx.secret.markOffers?.[id]);
    if (!offers.length) continue;
    const p = obj(ctx.secret.markPicks?.[id]);
    const m = offers.includes(p.k) ? p.k : offers[0];
    let c = cardOfU(S, id, p.u);
    if (!c || !canMark(c, m)) c = [...cardsOf(S, id)].filter(x => canMark(x, m)).sort((a, b) => (b.n || 0) - (a.n || 0) || CARDS[b.k].cost - CARDS[a.k].cost)[0];
    if (!c) continue;
    S.cards[id] = cardsOf(S, id).map(x => (x.u === c.u ? { ...x, m } : x));
    S.marked[id] = { k: c.k, m };
  }
  ctx.secret.markOffers = {};
  ctx.secret.markPicks = {};
}

function startWhisper(ctx, now) {
  const S = ctx.state;
  S.no = (S.no || 0) + 1;
  S.done = {};
  ctx.secret.whispers = {};
  ctx.secret.whisperAns = {};
  const ids = partyOf(S);
  const low = Math.min(...ids.map(id => S.corrupt?.[id] || 0));
  for (const id of ids) {
    const C = CLASSES[S.cls[id]];
    const dark = C?.trees.find(t => TREES[t].dark);
    const owned = new Set(cardsOf(S, id).map(c => c.k));
    const k = pickR(Object.keys(CARDS).filter(x => CARDS[x].tree === dark && !owned.has(x)));
    if (!k) { S.done[id] = true; continue; }
    let m = null;
    if ((S.corrupt?.[id] || 0) === low) { // 마왕은 깨끗한 손을 더 탐낸다
      m = canMark({ k }, 'keen') ? 'keen' : canMark({ k }, 'light') ? 'light' : null;
    }
    ctx.secret.whispers[id] = { k, ...(m ? { m } : {}) };
  }
  phase(S, 'whisper', now, WHISPER_TIME);
  sendAll(ctx);
  return true;
}

function applyWhisper(ctx, now) {
  const S = ctx.state;
  S.wshow = {};
  for (const id of partyOf(S)) {
    const w = ctx.secret.whispers?.[id];
    if (!w) continue;
    const a = obj(ctx.secret.whisperAns?.[id]);
    if (a.take) {
      const dropU = cardOfU(S, id, a.drop) ? a.drop : defaultDrop(S, id);
      replaceCard(S, id, dropU, w.k, w.m || null);
      const add = addCorrupt(S, id, WHISPER_CORRUPT);
      S.wshow[id] = { take: 1, k: w.k, ...(w.m ? { m: w.m } : {}), v: add };
      note(S, `${ctx.nameOf(id)} 속삭임을 받아들임`);
    } else S.wshow[id] = { take: 0 };
  }
  ctx.secret.whispers = {};
  ctx.secret.whisperAns = {};
  S.no = (S.no || 0) + 1;
  phase(S, 'wreveal', now, WHISPER_SHOW);
  sendAll(ctx);
  return true;
}

function startRoom(ctx, now, r) {
  const S = ctx.state;
  const R = ROOMS[r];
  S.room = r;
  S.tier = R.tier;
  S.foes = {};
  S.rcon = {};
  S.mvp = null;
  const n = partyOf(S).length;
  if (R.k === 'ghouls') {
    const cnt = Math.min(GHOULS.max, Math.ceil(n * GHOULS.mult));
    const hp = Math.ceil((GHOULS.pool * n) / cnt);
    for (let i = 1; i <= cnt; i++) S.foes[`@g${i}`] = { k: 'ghoul', hp, max: hp, block: 0, intent: [], next: [] };
  }
  if (R.k === 'golem') S.foes['@golem'] = { k: 'golem', hp: FOES.golem.per * n, max: FOES.golem.per * n, block: 0, i: 0, intent: [], next: [] };
  if (R.k === 'keeper') S.foes['@keeper'] = { k: 'keeper', hp: FOES.keeper.per * n, max: FOES.keeper.per * n, block: 0, i: 0, intent: [], next: [] };
  note(S, `방 ${r + 1} · ${R.name}`);
  phase(S, 'enter', now, ENTER_TIME);
  return true;
}

function startCombat(ctx) {
  const S = ctx.state;
  Object.assign(S, { turn: 0, auras: [], regen: {}, st: {}, block: {}, blkBy: {}, once: {}, lastBlk: {}, threat: {}, later: [], nxt: {} });
  for (const id of partyOf(S)) {
    S.energy[id] = ENERGY_START;
    const r = resOf(S, id);
    r.ammo = S.cls[id] === 'gunner' ? ammoMax(S, id) : 0;
    r.aim = 0;
    r.rounds = {};
    if (hasP(S, id, 'judge4')) r.faith = Math.max(r.faith || 0, FAITH.start);
    ctx.secret.piles = obj(ctx.secret.piles);
    ctx.secret.piles[id] = { draw: shuffleR(cardsOf(S, id).map(c => c.u)), hand: [], disc: [], away: [] };
  }
}

function startTurn(ctx, now) {
  const S = ctx.state;
  S.turn = (S.turn || 0) + 1;
  S.tn = (S.tn || 0) + 1;
  for (const id of partyOf(S)) {
    if (!isUp(S, id)) continue;
    const n = obj(S.nxt?.[id]);
    if (S.turn > 1) S.energy[id] = clamp((S.energy[id] || 0) + ENERGY_GAIN + (n.e || 0), 0, ENERGY_MAX);
    else S.energy[id] = clamp((S.energy[id] || 0) + (n.e || 0), 0, ENERGY_MAX);
    drawTo(ctx, id, HAND + Math.max(0, n.h || 0));
  }
  S.nxt = {};
  // 턴 시작: 군기 · 무너지지 않는 벽 · 보호의 기도 · 무너지지 않는 성
  const X = workOf(S);
  for (const a of list(S.auras)) {
    if (a.k === 'wall' && isUp(S, a.by)) blk(X, a.by, a.by, a.v, true);
    if (a.k === 'banner') for (const t of upHeroes(S)) blk(X, a.by, t, a.v, true);
  }
  const regen = {};
  for (const [t, arr] of Object.entries(obj(S.regen))) {
    const keep = [];
    for (const g of list(arr)) {
      if (!isUp(S, t)) continue;
      heal(X, g.by, t, g.h, true);
      blk(X, g.by, t, g.b, true);
      if (g.left > 1) keep.push({ ...g, left: g.left - 1 });
    }
    if (keep.length) regen[t] = keep;
  }
  S.regen = regen;
  const b = foeOf(S, BOSS);
  if (b && S.bossCls === 'guard' && !isGroggy(S, BOSS)) b.block = (b.block || 0) + (S.nHero || 1) * 4;
  for (const fk of liveFoes(S)) { // 묘비가 망자가 된다
    const f = S.foes[fk];
    if (f.k === 'tomb' && f.grow <= S.tn) Object.assign(f, { k: 'ghoul', hp: FOES.ghoul.hp, max: FOES.ghoul.hp });
  }
  makeIntents(S, Math.random);
  if (b) revealBoss(ctx);
  S.threat = {};
  Object.assign(S, { acts: {}, ready: {}, readyN: 0, pre: null, preDirty: true, preAt: 0, bossReady: false, sig: {}, ghost: {}, rs: null });
  Object.assign(ctx.secret, { plans: {}, readyAt: {}, ghosts: {} });
  phase(S, 'act', now, ACT_TIME);
  sendAll(ctx);
  return true;
}

// 최종전: 마왕이 내 둔 권능을 이번 턴의 예고로 공개한다 (공개하면 권능은 버림 더미로, 어둠이 빠진다 → 손패를 채우고 어둠 +3)
function revealBoss(ctx) {
  const S = ctx.state;
  const b = foeOf(S, BOSS);
  if (!b) return;
  const p = piles(ctx, BOSS);
  let data = ctx.secret.bossNext;
  ctx.secret.bossNext = null;
  if (S.boss === 'king') data = { turn: S.tn, ...bossChoose(S, p.hand, S.dark || 0, Math.random) };
  let plan = [];
  let veil = null;
  if (data && data.turn === S.tn) {
    const vb = validateBoss(S, data, p.hand);
    const used = new Set(vb.cards.map(c => c.u));
    p.hand = p.hand.filter(u => !used.has(u));
    p.disc.push(...used);
    S.dark = vb.left;
    if (!isGroggy(S, BOSS)) { // 그로기면 내 둔 계획은 날아간다
      plan = buildBossPlan(S, vb, Math.random);
      veil = vb.veil;
    }
  }
  let intent = publicIntent(plan, veil);
  if (b.charge?.u === 'doom' && b.charge.fire === S.tn) intent.push({ k: 'doom', v: b.charge.v });
  for (const l of list(S.later)) if (l.at === S.tn) intent.push({ k: 'later', to: [l.to], v: l.v });
  if (isGroggy(S, BOSS)) intent = [{ k: 'groggy', until: b.groggy }];
  b.intent = intent;
  b.next = [];
  ctx.secret.bossNow = plan.map(({ u, ...rest }) => rest);
  drawTo(ctx, BOSS, HAND);
  S.dark = Math.min(ENERGY_MAX, (S.dark || 0) + BOSS_ENERGY);
}

// 계획들을 준비 완료 순서대로 (안 누른 사람은 그 뒤에 자리 순)
function planList(ctx) {
  const S = ctx.state;
  const at = obj(ctx.secret.readyAt);
  const seat = id => list(S.order).indexOf(id);
  const ids = upHeroes(S).sort((a, b) => (at[a] ?? Infinity) - (at[b] ?? Infinity) || seat(a) - seat(b));
  return ids.map(id => validatePlan(S, id, ctx.secret.plans?.[id], handOf(ctx, id)));
}

// 낸 카드 옮기기: 버림 더미로 (잔상은 덱 맨 위로, 전투 동안 이어지는 건 전투에서 빠진다)
function movePlayed(ctx, vp) {
  const S = ctx.state;
  const p = piles(ctx, vp.id);
  for (const c of vp.cards) {
    if (c.q) continue;
    p.hand = p.hand.filter(u => u !== c.u);
    if (CARDS[c.k]?.aura) p.away.push(c.u);
    else if (cardOfU(S, vp.id, c.u)?.m === 'echo') p.draw.unshift(c.u);
    else p.disc.push(c.u);
  }
  if (vp.drop != null && p.hand.includes(vp.drop)) {
    p.hand = p.hand.filter(u => u !== vp.drop);
    p.disc.push(vp.drop);
  }
}

function resolve(ctx, now) {
  const S = ctx.state;
  const vplans = planList(ctx);
  const out = runTurn(S, vplans, { bossNow: ctx.secret.bossNow, ghosts: ctx.secret.ghosts });
  for (const vp of vplans) movePlayed(ctx, vp);
  const pboss = S.boss && S.boss !== 'king' ? S.boss : null;
  for (const d of out.downs) {
    if (d.to === BOSS) {
      S.slayer = d.by && !isFoeKey(d.by) ? d.by : null;
      if (pboss && S.slayer) ctx.kill(S.slayer, pboss, '👑 마왕 토벌');
      continue;
    }
    note(S, `${ctx.nameOf(d.to)} 쓰러짐`);
    if (d.by === BOSS && pboss) ctx.kill(pboss, d.to, '😈 마왕');
    else if (d.by && !isFoeKey(d.by) && d.by !== d.to) ctx.kill(d.by, d.to, `🩸 ${d.how || '아군의 손'}`);
  }
  const scenes = out.rs.length;
  const step = clamp(Math.floor(RS_CAP / Math.max(1, scenes)), 220, 650);
  const big = out.rs.some(e => e.k === 'down' || e.k === 'groggy' || e.k === 'ult') ? 800 : 0;
  S.rs = out.rs;
  S.rsNo = (S.rsNo || 0) + 1;
  S.rsStep = step;
  S.result = out.result;
  S.pre = null;
  phase(S, 'resolve', now, 600 + scenes * step + big);
  sendAll(ctx);
  return true;
}

function afterResolve(ctx, now) {
  const S = ctx.state;
  if (S.result === 'clear') return startClear(ctx, now);
  if (S.result) return finish(ctx, S.result);
  return startTurn(ctx, now);
}

function startClear(ctx, now) {
  const S = ctx.state;
  const r = S.room;
  for (const id of partyOf(S)) { // 쓰러졌던 사람은 절반 체력으로 일어나고, 전원 +10
    if (S.down[id]) {
      delete S.down[id];
      S.hp[id] = Math.floor(S.maxHp[id] / 2);
    }
    S.hp[id] = Math.min(S.maxHp[id], S.hp[id] + CLEAR_HEAL);
    const res = resOf(S, id);
    res.faith = Math.floor((res.faith || 0) / 2);
    res.aim = 0;
    res.rounds = {};
  }
  Object.assign(S, { auras: [], regen: {}, st: {}, block: {}, blkBy: {}, foes: {} });
  const table = partyOf(S).map(id => [id, S.rcon?.[id] || 0]).sort((a, b) => b[1] - a[1]);
  S.table = table.map(([id, v]) => ({ id, v }));
  S.mvp = table[0]?.[1] > 0 ? table[0][0] : null;
  S.cleared = r;
  note(S, `방 ${r + 1} 돌파!`);
  S.flow = ['learn', ...(ROOMS[r].tier === 'boss' ? ['learn'] : []), 'mark', 'whisper', r < ROOMS.length - 1 ? `enter:${r + 1}` : 'fall'];
  phase(S, 'clear', now, CLEAR_TIME);
  return true;
}

function startFall(ctx, now) {
  const S = ctx.state;
  const ranked = partyOf(S).map(id => ({ id, c: S.corrupt?.[id] || 0 })).sort((a, b) => b.c - a.c);
  const top = ranked[0]?.c || 0;
  let boss = 'king';
  let tie = [];
  if (top >= FALL_MIN) {
    tie = ranked.filter(x => x.c === top).map(x => x.id);
    let pool = tie.filter(id => id !== S.baptized); // 세례받은 사람은 동률 룰렛에서 빠진다
    if (!pool.length) pool = tie;
    boss = pickR(pool);
  }
  S.fall = { list: ranked, boss, tie: tie.length > 1 ? tie : [] };
  note(S, boss === 'king' ? '아무도 흑화하지 않았다. 이름 없는 왕이 깨어난다' : `${ctx.nameOf(boss)} 흑화!`);
  phase(S, 'fall', now, FALL_TIME);
  return true;
}

function startFinal(ctx, now) {
  const S = ctx.state;
  const b = S.fall?.boss || 'king';
  S.room = 3;
  S.tier = 'boss';
  if (b !== 'king') {
    S.boss = b;
    S.bossCls = S.cls[b];
    S.party = partyOf(S).filter(x => x !== b);
  } else {
    S.boss = 'king';
    S.bossCls = 'king';
  }
  S.nHero = partyOf(S).length;
  if (!S.nHero) return finish(ctx, 'lose');
  for (const id of partyOf(S)) {
    delete S.down[id];
    S.hp[id] = S.maxHp[id];
  }
  const corrupt = b !== 'king' ? S.corrupt?.[b] || 0 : 0;
  const hp = BOSS_HP[0] + BOSS_HP[1] * S.nHero + BOSS_HP[2] * corrupt;
  S.foes = { [BOSS]: { k: 'boss', hp, max: hp, block: 0, i: 0, intent: [], next: [] } };
  S.rcon = {};
  const keys = [...POWER_DECK.common, ...(POWER_DECK[S.bossCls] || [])];
  S.bcards = keys.map(k => ({ u: (S.uid = (S.uid || 0) + 1), k }));
  ctx.secret.piles = obj(ctx.secret.piles);
  ctx.secret.piles[BOSS] = { draw: shuffleR(S.bcards.map(c => c.u)), hand: [], disc: [], away: [] };
  drawTo(ctx, BOSS, HAND);
  S.dark = BOSS_ENERGY;
  startCombat(ctx);
  note(S, '최종전!');
  if (b !== 'king') {
    S.bossReady = false;
    phase(S, 'boss', now, BOSS_FIRST_TIME);
    sendAll(ctx);
    return true;
  }
  return startTurn(ctx, now);
}

function finish(ctx, how) {
  const S = ctx.state;
  const ids = list(S.roster || ctx.roster).map(p => p.id);
  const byContrib = (a, b) => contribOf(S, b) - contribOf(S, a);
  const later = (a, b) => (S.downAt?.[b] || 0) - (S.downAt?.[a] || 0);
  const heroes = partyOf(S);
  const pboss = S.boss && S.boss !== 'king' ? S.boss : null;
  let rank;
  if (pboss && how === 'win') rank = [...heroes.filter(id => !S.down[id]).sort(byContrib), pboss, ...heroes.filter(id => S.down[id]).sort(later)];
  else if (pboss && how === 'lose') rank = [pboss, ...[...heroes].sort(later)];
  else rank = [...heroes].sort(byContrib);
  for (const id of [...ids].sort(byContrib)) if (!rank.includes(id)) rank.push(id);
  rank = rank.filter(id => ids.includes(id));
  const standings = Object.fromEntries(rank.map((id, i) => [id, i + 1]));
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  if (pboss && how === 'win' && S.slayer) add(S.slayer, '👑 마왕 토벌');
  if (pboss && how === 'lose') add(pboss, '😈 마왕 강림');
  const top = kind => [...ids].map(id => [id, obj(S.contrib?.[id])[kind] || 0]).sort((a, b) => b[1] - a[1])[0] || [];
  const [w, wv] = top('blk');
  if (wv >= 20) add(w, `🛡️ 철벽 (${wv} 막음)`);
  const [l, lv] = top('heal');
  if (lv >= 20) add(l, `✚ 생명줄 (${lv} 회복)`);
  const [m, mv] = top('dmg');
  if (mv > 0) add(m, `⚔️ 딜 미터기 (${mv})`);
  for (const id of ids) {
    if ((S.lastHits?.[id] || 0) >= 3) add(id, `🗡️ 막타 도둑 (${S.lastHits[id]}번)`);
    const aw = awakeOf(S, id);
    if (aw) add(id, `🎓 각성: ${aw}`);
    const c = S.corrupt?.[id] || 0;
    if (c >= FALL_MIN && id !== pboss) add(id, '🩸 손이 검다');
    if (c === 0 && how === 'win' && heroes.includes(id)) add(id, '🕊️ 깨끗한 손');
  }
  const winner = pboss && how === 'lose' ? pboss : rank[0] || null;
  Object.assign(S, { standings, titles, winner, how, phase: 'final', over: true });
  note(S, how === 'win' ? '원정대 승리!' : how === 'lose' ? (pboss ? '마왕 승리!' : '원정 실패') : '원정 실패');
  return true;
}

/* ───────── 실시간 합계: 들어온 계획을 다 모아서 돌려 본 합 (누가 무엇을 냈는지는 안 싣는다) ───────── */

export const publicBossPlan = S => list(S.foes?.[BOSS]?.intent).filter(it => it.k === 'p');

function computePre(ctx) {
  const S = ctx.state;
  const S2 = structuredClone(S);
  const vplans = planList(ctx);
  const out = runTurn(S2, vplans, { bossNow: publicBossPlan(S), ghosts: ctx.secret.ghosts });
  const order = Object.keys(out.threat).filter(id => isUp(S, id)).sort((a, b) => out.threat[b] - out.threat[a]);
  const pre = {
    foe: out.sums.foe,
    ally: Object.fromEntries(Object.entries(out.sums.ally).map(([id, v]) => [id, { blk: v.blk || 0, heal: v.heal || 0 }])),
    brk: out.sums.brk,
    threat: order.slice(0, targetCount(upHeroes(S).length)),
  };
  const same = JSON.stringify(pre) === JSON.stringify(S.pre || null);
  S.pre = pre;
  return !same;
}

/* ───────── 게임 모듈 (raid.js가 묶어서 내보낸다) ───────── */

export function setup(ctx, prev) {
  const ids = shuffleR(ctx.roster.map(p => p.id));
  const pb = prev?.state?.boss;
  const baptized = pb && pb !== 'king' && ids.includes(pb) ? pb : null;
  return {
    phase: 'intro', phaseEndsAt: ctx.now() + INTRO_TIME, again: !!prev,
    order: ids, party: [...ids], room: -1, tn: 0, turn: 0, no: 0, uid: 0, learnSeq: 0,
    baptized, baptism: baptized ? { [baptized]: BAPTISM } : {},
    corrupt: Object.fromEntries(ids.map(id => [id, 0])),
    log: [],
  };
}

function kindsOf(S, id, data) {
  const out = {};
  const add = def => {
    if (!def) return;
    if (isAtkPhase(def)) out.a = 1;
    if (isDefCard(def)) out.d = 1;
    if (isHealCard(def)) out.h = 1;
  };
  if (data.q) add(qDef(S, id));
  for (const a of list(data.acts)) add(CARDS[cardOfU(S, id, a?.u)?.k]);
  return out;
}

export function onInput(ctx, { pid, type, data = {} }) {
  const S = norm(ctx.state);
  const now = ctx.now();
  if (S.over) return false;
  const inParty = partyOf(S).includes(pid);
  if (type === 'cls') {
    if (S.phase !== 'cls' || !inParty || !CLASSES[data.k]) return false;
    S.clsPick = { ...S.clsPick, [pid]: data.k };
    return true;
  }
  if (type === 'learn') {
    if (S.phase !== 'learn' || !inParty || data.no !== S.no || S.done[pid]) return false;
    ctx.secret.picks = { ...obj(ctx.secret.picks), [pid]: data.skip ? { skip: 1 } : { i: Number(data.i) || 0, drop: data.drop ?? null } };
    S.done = { ...S.done, [pid]: true };
    return true;
  }
  if (type === 'mark') {
    if (S.phase !== 'mark' || !inParty || data.no !== S.no || S.done[pid]) return false;
    ctx.secret.markPicks = { ...obj(ctx.secret.markPicks), [pid]: { k: data.k, u: data.u } };
    S.done = { ...S.done, [pid]: true };
    return true;
  }
  if (type === 'whisper') {
    if (S.phase !== 'whisper' || !inParty || data.no !== S.no || S.done[pid]) return false;
    ctx.secret.whisperAns = { ...obj(ctx.secret.whisperAns), [pid]: { take: !!data.take, drop: data.drop ?? null } };
    S.done = { ...S.done, [pid]: true };
    return true;
  }
  if (type === 'plan') {
    if (S.phase !== 'act' || !isUp(S, pid) || data.turn !== S.tn || S.ready[pid]) return false;
    const plan = {
      turn: data.turn,
      acts: list(data.acts).slice(0, 12).map(a => ({ u: a?.u, t: a?.t ?? null })),
      q: data.q ? { t: data.q.t ?? null } : null,
      drop: data.drop ?? null,
    };
    ctx.secret.plans = { ...obj(ctx.secret.plans), [pid]: plan };
    S.acts = { ...S.acts, [pid]: kindsOf(S, pid, plan) };
    S.preDirty = true;
    if (data.ready) {
      S.readyN = (S.readyN || 0) + 1;
      S.ready = { ...S.ready, [pid]: S.readyN };
      const at = clamp(Number(data.at) || now, S.phaseAt || 0, now);
      ctx.secret.readyAt = { ...obj(ctx.secret.readyAt), [pid]: at };
    }
    return true;
  }
  if (type === 'ghost') {
    if (S.phase !== 'act' || !inParty || !S.down[pid] || data.turn !== S.tn) return false;
    const k = data.k === 'curse' ? 'curse' : 'guard';
    const t = k === 'guard' ? (isUp(S, data.t) ? data.t : null) : (foeOf(S, data.t) ? data.t : null);
    if (!t) return false;
    ctx.secret.ghosts = { ...obj(ctx.secret.ghosts), [pid]: { k, t } };
    S.ghost = { ...S.ghost, [pid]: 1 };
    S.preDirty = true;
    return true;
  }
  if (type === 'sig') {
    if (S.phase !== 'act' || !inParty || !['z', 'x', 'c', 'v'].includes(data.k)) return false;
    S.sig = { ...S.sig, [pid]: { k: data.k, at: now } };
    return true;
  }
  if (type === 'boss') {
    if (pid !== S.boss || !foeOf(S, BOSS) || (S.phase !== 'boss' && S.phase !== 'act') || data.turn !== S.tn + 1 || S.bossReady) return false;
    ctx.secret.bossNext = {
      turn: data.turn,
      acts: list(data.acts).slice(0, 8).map(a => ({ u: a?.u, t: a?.t ?? null })),
      veil: data.veil ?? null,
    };
    if (data.ready) S.bossReady = true;
    return true;
  }
  return false;
}

export function tick(ctx) {
  const S = norm(ctx.state);
  const now = ctx.now();
  const on = id => ctx.isOnline(id);
  const waiting = () => partyOf(S).some(id => !S.done?.[id] && on(id));
  const due = () => now >= S.phaseEndsAt + GRACE;
  switch (S.phase) {
    case 'intro': return now >= S.phaseEndsAt && startCls(ctx, now);
    case 'cls': {
      const wait = partyOf(S).some(id => !S.clsPick?.[id] && on(id));
      return (!wait || due()) && applyCls(ctx, now);
    }
    case 'learn':
      if (waiting() && !due()) return false;
      applyLearn(ctx);
      return go(ctx, now);
    case 'mark':
      if (waiting() && !due()) return false;
      applyMark(ctx);
      return go(ctx, now);
    case 'whisper':
      if (waiting() && !due()) return false;
      return applyWhisper(ctx, now);
    case 'wreveal': return now >= S.phaseEndsAt && go(ctx, now);
    case 'enter':
      if (now < S.phaseEndsAt) return false;
      startCombat(ctx);
      return startTurn(ctx, now);
    case 'act': {
      const heroWait = upHeroes(S).some(id => !S.ready?.[id] && on(id) && !isStun(S, id));
      const bossWait = !!S.boss && S.boss !== 'king' && !!foeOf(S, BOSS) && !S.bossReady && on(S.boss);
      if ((heroWait || bossWait) && !due()) {
        if (S.preDirty && now - (S.preAt || 0) >= PRE_THROTTLE) {
          S.preDirty = false;
          S.preAt = now;
          return computePre(ctx);
        }
        return false;
      }
      return resolve(ctx, now);
    }
    case 'resolve': return now >= S.phaseEndsAt && afterResolve(ctx, now);
    case 'clear': return now >= S.phaseEndsAt && go(ctx, now);
    case 'fall': return now >= S.phaseEndsAt && startFinal(ctx, now);
    case 'boss':
      if (!S.bossReady && on(S.boss) && !due()) return false;
      return startTurn(ctx, now);
    default: return false;
  }
}

/* ───────── 봇: 자기 손패와 모두에게 보이는 것만 쓴다 ───────── */

// 나에게 들어올 피해 (예고 기준)
export function incomingTo(S, id) {
  let sum = 0;
  for (const fk of liveFoes(S)) {
    for (const it of list(S.foes[fk].intent)) {
      if ((it.k === 'hit' || it.k === 'slam' || it.k === 'later' || (it.k === 'p' && it.to)) && list(it.to).includes(id)) sum += (it.v || 0) * (POWERS[it.p]?.times || 1);
      if (it.k === 'all' || it.k === 'bury' || it.k === 'doom' || (it.k === 'p' && POWERS[it.p]?.all && it.v)) sum += it.v || 0;
    }
  }
  return sum;
}

function botClass(S, id) {
  const taken = Object.entries(obj(S.clsPick)).filter(([p]) => p !== id).map(([, k]) => k);
  if (!taken.includes('guard')) return 'guard';
  if (!taken.includes('priest')) return 'priest';
  const free = CLASS_KEYS.filter(k => !taken.includes(k));
  return pickR(free.length ? free : CLASS_KEYS);
}

function botLearn(ctx, id) {
  const S = ctx.state;
  const offers = list(ctx.secret.offers?.[id]);
  if (!offers.length) return { skip: true };
  const i = Math.random() < 0.7 ? 0 : Math.floor(Math.random() * offers.length);
  return { i, drop: defaultDrop(S, id, true) };
}

function botMark(ctx, id) {
  const S = ctx.state;
  const offers = list(ctx.secret.markOffers?.[id]);
  const k = offers[0];
  const c = [...cardsOf(S, id)].filter(x => canMark(x, k)).sort((a, b) => (b.n || 0) - (a.n || 0) || CARDS[b.k].cost - CARDS[a.k].cost)[0];
  return { k, u: c?.u ?? null };
}

function botPlan(ctx, id, mem) {
  const S = ctx.state;
  const cls = S.cls[id];
  const hand = handOf(ctx, id).map(u => cardOfU(S, id, u)).filter(Boolean).map(c => ({ ...c, def: CARDS[c.k] }));
  let e = S.energy[id] || 0;
  let ammo = ammoOf(S, id);
  const acts = [];
  const used = new Set();
  let firstAtk = true;
  let q = null;
  const hpFrac = x => (S.hp[x] || 0) / (S.maxHp[x] || 1);
  const can = c => {
    if (used.has(c.u)) return false;
    if (c.def.dark && Math.random() > mem.greed) return false; // 금단은 욕심만큼만
    if (costOf(S, id, c, firstAtk) > e) return false;
    if (c.def.ammo && (c.def.ammo === 'all' ? ammo < 1 : ammo < c.def.ammo)) return false;
    return true;
  };
  const take = (c, t = null) => {
    used.add(c.u);
    e -= costOf(S, id, c, firstAtk);
    ammo -= c.def.ammo === 'all' ? ammo : c.def.ammo || 0;
    if (isAttack(c.def)) firstAtk = false;
    for (const [op, v] of fxOf(c)) {
      if (op === 'energy') e += v;
      if (op === 'ammo') ammo = Math.min(ammoMax(S, id), ammo + v);
    }
    acts.push({ u: c.u, t });
  };
  const qOk = qReady(S, id) && qCostOf(S, id) <= e;
  if (cls === 'gunner' && qOk && ammo < 2 && hand.some(c => c.def.ammo)) {
    q = {};
    e -= qCostOf(S, id);
    ammo = ammoMax(S, id);
  }
  if (cls === 'berserk' && qOk && S.hp[id] > 22 && Math.random() < 0.5) {
    q = {};
    e += 1;
  }
  const bigOnOther = liveFoes(S).some(fk => list(S.foes[fk].intent).some(it => (it.k === 'hit' || it.k === 'slam' || it.k === 'p') && (it.v || 0) >= 12 && list(it.to).some(t => t !== id)));
  if (cls === 'guard' && qOk && bigOnOther) q = {};
  if (cls === 'priest' && qOk) {
    const t = upHeroes(S).filter(x => hpFrac(x) <= 0.6).sort((a, b) => hpFrac(a) - hpFrac(b))[0];
    if (t) q = { t };
  }
  // 1) 막기
  let need = incomingTo(S, id) - (S.block[id] || 0) - (cls === 'guard' && q ? 8 : 0);
  if (need >= 5) {
    const blocks = hand.filter(c => c.def.fx.some(([op]) => op === 'block' || op === 'blockSelf') && ['self', 'ally'].includes(c.def.to)).sort((a, b) => a.def.cost - b.def.cost);
    for (const c of blocks) {
      if (need <= 0 || !can(c)) continue;
      take(c, id);
      need -= c.def.fx.find(([op]) => op === 'block' || op === 'blockSelf')?.[1] || 0;
    }
  }
  // 2) 차단: 필살기를 준비 중인 적
  const charging = liveFoes(S).find(fk => S.foes[fk].charge && (S.foes[fk].charge.got || 0) < S.foes[fk].charge.need);
  if (charging) for (const c of hand.filter(x => x.def.fx.some(([op]) => op === 'brk' || op === 'brkAll'))) if (can(c)) take(c, charging);
  // 3) 회복
  for (const c of hand.filter(x => isHealCard(x.def) && x.def.to !== 'down')) {
    const t = c.def.to === 'self' ? id : upHeroes(S).filter(x => S.maxHp[x] - S.hp[x] >= 8).sort((a, b) => hpFrac(a) - hpFrac(b))[0];
    if (t && (c.def.to !== 'self' || S.maxHp[id] - S.hp[id] >= 8) && can(c)) take(c, t);
  }
  const downed = partyOf(S).find(x => S.down?.[x]);
  for (const c of hand.filter(x => x.def.to === 'down')) if (downed && can(c)) take(c, downed);
  // 4) 공격 (오의가 손에 있는데 기력이 모자라면 모은다)
  const groggyFoe = liveFoes(S).find(fk => isGroggy(S, fk));
  const foeT = groggyFoe || lowestFoe(S);
  const ult = hand.find(c => c.def.ult && !used.has(c.u) && isAttack(c.def));
  const ultCost = ult ? costOf(S, id, ult, firstAtk) : 0;
  const save = ult && ultCost > e && e + ENERGY_GAIN >= ultCost && !groggyFoe && e + ENERGY_GAIN <= ENERGY_MAX + 1;
  if (ult && can(ult)) take(ult, foeT);
  if (!save) {
    const attacks = hand.filter(c => isAttack(c.def) || c.def.fx.some(([op]) => op === 'vuln' || op === 'focus' || op === 'nextAtk' || op === 'atkPlus'));
    attacks.sort((a, b) => (a.def.spd === 'first' ? -1 : 0) - (b.def.spd === 'first' ? -1 : 0) || b.def.cost - a.def.cost);
    for (const c of attacks) if (can(c)) take(c, c.def.to === 'ally' ? id : foeT);
    for (const c of hand.filter(x => x.def.fx.some(([op]) => op === 'aim' || op === 'rounds'))) if (can(c)) take(c, id);
  }
  // 못 쓰는 카드 하나는 버린다 (부활인데 쓰러진 아군이 없음 등)
  const junk = hand.find(c => !used.has(c.u) && ((c.def.to === 'down' && !downed) || (c.def.ammo && ammoMax(S, id) < (c.def.ammo === 'all' ? 1 : c.def.ammo))));
  return { acts, q, drop: junk?.u ?? null };
}

// 마왕 · 이름 없는 왕의 권능 고르기 (봇도 같이 쓴다)
export function bossChoose(S, hand, dark, rand = Math.random) {
  const cards = list(hand).map(u => ({ u, k: list(S.bcards).find(c => c.u === u)?.k })).filter(c => POWERS[c.k]);
  const heroes = upHeroes(S);
  if (!heroes.length) return { acts: [], veil: null };
  const weakest = lowestHero(S);
  const pickT = () => (rand() < 0.6 ? weakest : pickR(heroes, rand));
  const b = S.foes?.[BOSS];
  let left = dark;
  const acts = [];
  const doom = cards.find(c => c.k === 'doom');
  if (doom && !b?.charge) {
    if (left >= POWERS.doom.cost) {
      acts.push({ u: doom.u });
      left -= POWERS.doom.cost;
    } else left = Math.max(0, left - Math.max(0, POWERS.doom.cost - ENERGY_GAIN)); // 다음 턴에 종말을 낼 만큼 남긴다
  }
  const val = c => (POWERS[c.k].v || 0) * (POWERS[c.k].times || 1) + (POWERS[c.k].all ? heroes.length * 4 : 0) + (c.k === 'curse' ? 9 : 0) + (c.k === 'raise' ? 12 : 0) + (c.k === 'markShot' ? 14 : 0);
  const rest = cards.filter(c => c.k !== 'doom' && c.k !== 'veil').sort((x, y) => val(y) - val(x));
  for (const c of rest) {
    const P = POWERS[c.k];
    if (P.cost > left) continue;
    if (c.k === 'armor' && b && b.hp > b.max * 0.6) continue;
    if (c.k === 'raise' && liveFoes(S).some(k => S.foes[k].k === 'skel')) continue;
    if (c.k === 'shieldBreak' && (b?.block || 0) < 10) continue;
    acts.push({ u: c.u, t: P.aim ? pickT() : null });
    left -= P.cost;
  }
  let veil = null;
  const v = cards.find(c => c.k === 'veil');
  const hide = acts.find(a => { const k = list(S.bcards).find(c => c.u === a.u)?.k; return k && k !== 'doom' && POWERS[k].v; });
  if (v && hide) {
    acts.push({ u: v.u });
    veil = hide.u;
  }
  return { acts, veil };
}

export function bot(ctx, id, mem) {
  const S = norm(ctx.state);
  const now = ctx.now();
  if (S.over) return null;
  const key = `${S.phase}:${S.no || 0}:${S.tn || 0}`;
  if (mem.key !== key) { // 단계가 바뀌면 사람처럼 조금 있다가 누른다
    mem.key = key;
    mem.at = now + (S.phase === 'act' ? 1500 + Math.random() * 4500 : 900 + Math.random() * 1800);
    mem.done = false;
  }
  mem.greed ??= 0.2 + Math.random() * 0.6; // 욕심: 속삭임을 받고 금단을 쓸 확률
  if (mem.done || now < mem.at) return null;
  const inParty = partyOf(S).includes(id);
  if (S.phase === 'cls' && inParty && !S.clsPick?.[id]) {
    mem.done = true;
    return { type: 'cls', data: { k: botClass(S, id) } };
  }
  if (S.phase === 'learn' && inParty && !S.done?.[id]) {
    mem.done = true;
    return { type: 'learn', data: { no: S.no, ...botLearn(ctx, id) } };
  }
  if (S.phase === 'mark' && inParty && !S.done?.[id]) {
    mem.done = true;
    return { type: 'mark', data: { no: S.no, ...botMark(ctx, id) } };
  }
  if (S.phase === 'whisper' && inParty && !S.done?.[id]) {
    mem.done = true;
    return { type: 'whisper', data: { no: S.no, take: Math.random() < mem.greed, drop: defaultDrop(S, id, true) } };
  }
  if ((S.phase === 'boss' || S.phase === 'act') && id === S.boss && foeOf(S, BOSS) && !S.bossReady) {
    mem.done = true;
    return { type: 'boss', data: { turn: S.tn + 1, ...bossChoose(S, handOf(ctx, BOSS), S.dark || 0), ready: true } };
  }
  if (S.phase === 'act' && isUp(S, id) && !S.ready?.[id]) {
    mem.done = true;
    return { type: 'plan', data: { turn: S.tn, ...botPlan(ctx, id, mem), ready: true, at: now } };
  }
  if (S.phase === 'act' && inParty && S.down?.[id] && !S.ghost?.[id]) {
    mem.done = true;
    const t = lowestHero(S);
    return t ? { type: 'ghost', data: { turn: S.tn, k: 'guard', t } } : null;
  }
  return null;
}

// 시험용: 규칙 테스트가 단계를 건너뛰어 부른다
export const _t = { startFall, startFinal, startRoom, startCombat, startTurn, makeIntents, startClear, startWhisper, applyWhisper, finish, resolve, drawTo, piles };
