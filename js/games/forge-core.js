// 주사위 대장간 — 규칙 코어. 화면 · 소리와 상관없는 순수 함수만 둔다 (시제품 · 나중의 방장 · 봇 시험이 같이 쓴다).
// 숫자는 기획서-주사위대장간.md '조절할 값'의 첫 값. 주사위 종류 · 무기 이름은 주사위 합(dice-core.js) 것을 쓴다.
//
// 한 라운드: beginRound(수입 · 상점 · 짝짓기) → buy · curse (사람 · 봇) → resolveRound(대결 기록 + 정산 + 탈락)
// 대결 하나 = duel() 이 돌려주는 기록 하나. 값은 전부 여기서 굴리고, 화면은 기록을 박자대로 틀기만 한다.
import { DICE, WEAPONS, makeRng, labelOf } from './dice-core.js';

export { DICE, WEAPONS, makeRng, labelOf };

// 기술 = 주사위만. 합계는 굴린 눈 그대로이고(+ 증강 보너스), 숨은 '위력' 숫자는 없다 (사용자 요청 2026-11-22: "순전히 주사위 숫자로").
// 단이 오르면 주사위가 늘거나 커진다. 장사는 주사위가 하나인 대신 지는 걸 버틴다(금만 간다: 1단 한 번, 2단부터 두 번).
// 구성은 봇끼리 판으로 맞춤 (2 · 4 · 6 · 8명 무기별 우승률이 공평한 값의 82~119%)
export const TECHS = {
  sw1: { w: 'sw', tier: 1, name: '베기', dice: ['d10', 'd10'] },
  sw2: { w: 'sw', tier: 2, name: '겹베기', dice: ['d10', 'd10', 'd6'] },
  sw3: { w: 'sw', tier: 3, name: '삼단베기', dice: ['d10', 'd10', 'd10'] },
  hm1: { w: 'hm', tier: 1, name: '내려찍기', dice: ['d20'], tough: 1 },
  hm2: { w: 'hm', tier: 2, name: '통짜찍기', dice: ['d20'], tough: 2 },
  hm3: { w: 'hm', tier: 3, name: '산 가르기', dice: ['d20', 'd6'], tough: 2 },
  tw1: { w: 'tw', tier: 1, name: '찌르기', dice: ['d6', 'd6', 'd6'] },
  tw2: { w: 'tw', tier: 2, name: '난도질', dice: ['d6', 'd6', 'd6', 'd6'] },
  tw3: { w: 'tw', tier: 3, name: '칼바람', dice: ['d10', 'd6', 'd6', 'd6'] },
  gb1: { w: 'gb', tier: 1, name: '한 판', dice: ['x6', 'd6', 'd6'] },
  gb2: { w: 'gb', tier: 2, name: '두 판', dice: ['x6', 'd6', 'd6', 'd6'] },
  gb3: { w: 'gb', tier: 3, name: '몰빵', dice: ['x6', 'x6', 'x6', 'd6'] },
};
for (const [k, t] of Object.entries(TECHS)) t.key = k;
export const MAIN_DIE = { sw: 'd10', hm: 'd20', tw: 'd6', gb: 'x6' }; // 🎲 주사위 하나 더
export const TASTE = {
  sw: '무난함. 열면체 둘로 시작해 셋',
  hm: '이십면체 하나. 지는 걸 버틴다 (2단부터 두 번)',
  tw: '육면체 여럿. 오래 버티고 연타',
  gb: '🔥주사위는 6이면 한 번 더. 3단엔 셋',
};

export const RULE = {
  HP: 40,
  INCOME: 5,          // 라운드마다
  INTEREST_PER: 5,    // 남긴 5냥마다 +1
  INTEREST_MAX: 2,
  CONSOLE: 2,         // 지면 위로금
  BOUNTY: 4,          // 🔥3인 사람을 잡으면
  SHADOW_WIN: 2,      // 그림자를 이기면
  COLLECT: 3,         // 💰 수금
  TIER_COST: { 2: 4, 3: 8 },   // 2단은 위력이 조금만 올라서 숫돌보다 손해였다 (6 · 10 → 4 · 8)
  WHET_COST: 3,       // 숫돌 첫 값, 살 때마다 +1 (제일 작은 주사위를 한 단계 크게)
  REROLL: 1,
  AUG_COST: { s: 3, g: 5, p: 8 },
  AUG_MAX: 3,
  SLOTS: 3,
  VENOM: 3,           // 🌀 독기 증강: 이번 대결에서 깨진 내 주사위마다
  FLAME: 0.15,        // 🔥 하나마다 합 한 번에 불꽃 확률
  FLINT: 0.10,
  MOM_MAX: 3,
  FIRST: 3,           // 🎯 선빵
  TWINS: 4,           // 👯 쌍둥이
  EXPLODE_MAX: 3,     // 터지는 주사위가 이어서 터지는 최대 횟수
  TIE_MAX: 5,
  CLASH_MAX: 40,
  ROUND_CAP: 15,
  SLOT_W: [['whet', 25], ['gamble', 30], ['aug', 45]],
  TIER_W: [[3, { s: 70, g: 25, p: 5 }], [6, { s: 45, g: 40, p: 15 }], [Infinity, { s: 25, g: 45, p: 30 }]],
  WEAPON_TIME: 10000,
  SHOP_TIME: 25000,
};

// 몬테카를로 판 수 (승률 표시 · 봇 판단)
export const TRIALS = { p0: 600, mid: 300, preview: 1200, bot: 200 };

export const AUGS = {
  luck: { tier: 's', icon: '🍀', name: '행운', text: '합마다 한 번, 1이 나온 주사위를 다시' },
  heavy: { tier: 's', icon: '🪨', name: '무거운 주사위', text: '1이 나오면 2' },
  twins: { tier: 's', icon: '👯', name: '쌍둥이', text: '같은 눈 둘이면 +4', not: w => w === 'hm' }, // 장사는 주사위가 거의 하나
  taste: { tier: 's', icon: '🩸', name: '피맛', text: '추격 한 대마다 +1' },
  first: { tier: 's', icon: '🎯', name: '선빵', text: '첫 합은 합계 +3' },
  brace: { tier: 's', icon: '🧱', name: '버팀', text: '처음 지는 합 한 번은 금만 간다' },
  powder: { tier: 'g', icon: '💥', name: '화약', text: '주사위 하나가 최대 눈이면 한 번 더', not: w => w === 'gb' },
  flint: { tier: 'g', icon: '🔥', name: '부싯돌', text: '불꽃 확률 +10%' },
  collect: { tier: 'g', icon: '💰', name: '수금', text: '이기면 냥 +3' },
  fox: { tier: 'g', icon: '🦊', name: '여우', text: '상점 칸이 4개' },
  counter: { tier: 'g', icon: '🪃', name: '되치기', text: '지면 상대 추격의 제일 큰 한 대를 돌려줌' },
  venom: { tier: 'g', icon: '🌀', name: '독기', text: '깨질 때마다 합계 +3' },
  crit: { tier: 'p', icon: '👑', name: '일격필살', text: '추격에서 최대 눈은 두 배' },
  extra: { tier: 'p', icon: '🎲', name: '주사위 하나 더', text: '내 무기 주사위가 하나 는다' },
  jackpot: { tier: 'p', icon: '🎰', name: '잭팟', text: '같은 눈 셋이면 상대 주사위가 전부 깨짐', not: w => w === 'hm' },
  curse: { tier: 'p', icon: '☠️', name: '저주', text: '상대의 첫 합, 제일 높은 주사위가 1' },
  seer: { tier: 'p', icon: '🧿', name: '꿰뚫어 봄', text: '상대가 이번에 산 것이 보임' },
  endless: { tier: 'p', icon: '⚡', name: '끝없는 합', text: '동수면 상대 주사위가 하나 깨짐' },
};

// per: clash = 합마다 기술 주사위가 다 나온 뒤에 굴림 · fight = 대결 시작에 한 번
export const GAMBLES = {
  allin: { icon: '🎴', name: '올인', cost: 4, per: 'clash', text: '반은 −6, 반은 +10', faces: [-6, -6, -6, 10, 10, 10] },
  mult: { icon: '✖️', name: '배수', cost: 5, per: 'clash', text: '×0 아니면 ×2', faces: [0, 1, 1, 1, 1, 2] },
  bomb: { icon: '💣', name: '폭탄', cost: 4, per: 'clash', text: '6이면 상대, 1이면 내 주사위가 깨짐' },
  mirror: { icon: '🪞', name: '거울', cost: 4, per: 'clash', text: '반은 상대 큰 눈을 가져오고, 반은 내 걸 준다' },
  stake: { icon: '🪙', name: '판돈', cost: 3, per: 'fight', text: '이번 대결 피해 ×1 · ×2 · ×3' },
  leech: { icon: '🧛', name: '흡혈', cost: 4, per: 'fight', text: '이기면 d6 회복, 지면 d6 더 깎임' },
};

for (const [k, v] of Object.entries(AUGS)) v.key = k;
for (const [k, v] of Object.entries(GAMBLES)) v.key = k;
export const AUG_KEYS = Object.keys(AUGS);
export const GAMBLE_KEYS = Object.keys(GAMBLES);
export const WEAPON_KEYS = ['sw', 'hm', 'tw', 'gb'];
export const TIER_NAME = { s: '실버', g: '골드', p: '프리즘' };

const ri = (rng, n) => 1 + Math.floor(rng() * n);
const sum = arr => arr.reduce((x, y) => x + y, 0);
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export const other = s => (s === 'a' ? 'b' : 'a');
const SIDES = ['a', 'b'];

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ───────── 빌드: 무기 · 단 · 숫돌 · 도박 칸 하나 · 증강 최대 3
export const newBuild = w => ({ w, tier: 1, whet: 0, gamble: null, bet: true, augs: [] });
export const cloneBuild = b => (b ? { ...b, augs: [...b.augs] } : b);
export const techKey = b => `${b.w}${b.tier}`;
export const techOf = b => TECHS[techKey(b)];
export const has = (b, k) => !!b && b.augs.includes(k);
export const sidesOf = die => DICE[die].sides;
const UPGRADE = { d6: 'd10', x6: 'd10', d10: 'd20' }; // 숫돌: 한 단계 크게
const diceCache = new Map();
// 이 빌드가 굴리는 주사위 (자리 순서): 기술 주사위 + 🎲 하나 더, 숫돌 수만큼 제일 작은 것(같으면 뒤쪽)부터 한 단계씩 크게
export function diceOf(b) {
  const key = `${b.w}${b.tier}|${b.whet}|${has(b, 'extra') ? 1 : 0}`;
  const hit = diceCache.get(key);
  if (hit) return hit;
  const d = [...TECHS[techKey(b)].dice, ...(has(b, 'extra') ? [MAIN_DIE[b.w]] : [])];
  for (let i = 0; i < b.whet; i++) {
    let lo = -1;
    for (let j = 0; j < d.length; j++) if (UPGRADE[d[j]] && (lo < 0 || sidesOf(d[j]) <= sidesOf(d[lo]))) lo = j;
    if (lo < 0) break;
    d[lo] = UPGRADE[d[lo]];
  }
  diceCache.set(key, d);
  return d;
}
// 밸런스 맞출 때 TECHS를 바꿨으면 부른다 (브라우저 콘솔에서 __forge.core.TECHS.sw2.dice = [...]; __forge.core.resetDiceCache())
export const resetDiceCache = () => diceCache.clear();
export const canWhet = b => diceOf(b).some(x => UPGRADE[x]);
export const dieAt = (b, slot) => diceOf(b)[slot];
export const explodes = (b, slot) => DICE[dieAt(b, slot)].explode || (slot === 0 && has(b, 'powder'));
export const maxRoll = (b, slot) => sidesOf(dieAt(b, slot)) * (explodes(b, slot) ? RULE.EXPLODE_MAX + 1 : 1);
export const slotsOf = b => diceOf(b).map((_, i) => i);
export const braceCap = b => (has(b, 'brace') ? 1 : 0) + (TECHS[techKey(b)].tough || 0); // 금만 가고 버티는 횟수
export const augAllowed = (b, k) => !b.augs.includes(k) && !(AUGS[k].not && AUGS[k].not(b.w));

// ["d10", "d10", "d6"] → "d10×2 + d6"
export function diceTextOf(dice) {
  const counts = [];
  for (const d of dice) {
    const c = counts.find(x => x.d === d);
    if (c) c.n++;
    else counts.push({ d, n: 1 });
  }
  return counts.map(c => `${DICE[c.d].explode ? '🔥d6' : c.d}${c.n > 1 ? `×${c.n}` : ''}`).join(' + ');
}
// "겹베기 d10×2 + d6"
const toughText = t => (t.tough ? ` · 버팀 ${t.tough}` : '');
export const techLine = b => `${techOf(b).name} ${diceTextOf(diceOf(b))}${toughText(techOf(b))}`;
export function tierUpText(b) {
  if (b.tier >= 3) return null;
  const nb = { ...b, tier: b.tier + 1 };
  return `${nb.tier}단 ${techOf(nb).name} ${diceTextOf(diceOf(nb))}${toughText(techOf(nb))}`;
}

// ───────── 굴리기
function rollFaces(rng, sides, boom, first = 0) {
  const faces = [first || ri(rng, sides)];
  if (boom) while (faces[faces.length - 1] === sides && faces.length <= RULE.EXPLODE_MAX) faces.push(ri(rng, sides));
  return faces;
}

// 기술 주사위 전부: [{ slot, die, faces, v, shown, shownFaces, max, rr?, heavy? }]
//   shown = 떨어진 눈 (행운 · 무거운 주사위까지, 저주 · 불꽃 전). 화면은 shown을 먼저 보여 주고 사건으로 바꾼다
function rollTech(rng, b, slots) {
  const dice = slots.map(slot => {
    const die = dieAt(b, slot);
    return { slot, die, faces: rollFaces(rng, sidesOf(die), explodes(b, slot)) };
  });
  // 행운(1이면 다시)을 먼저, 그다음 무거운 주사위(남은 1은 2). 둘 다 가져도 둘 다 일한다
  if (has(b, 'luck')) {
    const one = dice.find(d => d.faces[0] === 1);
    if (one) { one.rr = one.faces; one.faces = rollFaces(rng, sidesOf(one.die), explodes(b, one.slot)); }
  }
  if (has(b, 'heavy')) for (const d of dice) if (d.faces[0] === 1) { d.faces = [2]; d.heavy = true; }
  for (const d of dice) {
    d.v = sum(d.faces);
    d.max = d.faces[0] === sidesOf(d.die);
    d.shown = d.v;
    d.shownFaces = d.faces;
  }
  return dice;
}

const flameChance = f => Math.min(0.9, (f.mom || 0) * RULE.FLAME + (has(f.b, 'flint') ? RULE.FLINT : 0));

function flameLowest(rng, f, dice) {
  let lo = dice[0];
  for (const d of dice) if (d.v < lo.v) lo = d;
  const sides = sidesOf(lo.die);
  if (lo.faces[0] === sides && lo.ev !== 'curse') return; // 이미 최대 눈 (다시 굴리면 터진 몫이 줄 수 있다)
  lo.ev = lo.ev ? `${lo.ev}+flame` : 'flame';
  lo.faces = rollFaces(rng, sides, explodes(f.b, lo.slot), sides);
  lo.v = sum(lo.faces);
  lo.max = true;
}

// 저주(유령 · ☠️) → 불꽃(기세 · 🔥부싯돌). 저주받은 수를 돌려준다
function applyEvents(rng, F, s, dice, no) {
  const f = F[s];
  let k = (no <= (f.curses || 0) ? 1 : 0) + (no === 1 && has(F[other(s)].b, 'curse') ? 1 : 0);
  let cursed = 0;
  while (k-- > 0) {
    let hi = null;
    for (const d of dice) if (!d.ev && (!hi || d.v > hi.v)) hi = d;
    if (!hi) break;
    hi.ev = 'curse';
    hi.faces = [1];
    hi.v = 1;
    hi.max = false;
    cursed++;
  }
  const q = flameChance(f);
  if (q > 0 && dice.length && rng() < q) flameLowest(rng, f, dice);
  return cursed;
}

const venomOf = b => (has(b, 'venom') ? RULE.VENOM : 0); // 🌀 독기 증강만
const lowest = dice => dice.reduce((lo, d) => (!lo || d.v < lo.v ? d : lo), null);
function hasPair(dice) {
  const seen = new Set();
  for (const d of dice) {
    if (seen.has(d.v)) return true;
    seen.add(d.v);
  }
  return false;
}
function hasTriple(dice) {
  const c = new Map();
  for (const d of dice) {
    const n = (c.get(d.v) || 0) + 1;
    if (n >= 3) return true;
    c.set(d.v, n);
  }
  return false;
}

// 굴린 눈과 도박 주사위 눈(g.r)으로 이번 합을 판정한다. 아무것도 안 바꾼다 (반사실 계산에도 쓴다)
// 순서: 폭탄(A → B) → 거울 · 올인 · 배수 → 합계 → 잭팟 → 비교
function judge(F, dice, g, st, no) {
  const gone = { a: new Set(), b: new Set() };
  const bombs = [];
  for (const s of SIDES) {
    if (g[s]?.key !== 'bomb') continue;
    const r = g[s].r;
    const t = r === 6 ? other(s) : r === 1 ? s : null;
    const lo = t ? lowest(dice[t].filter(d => !gone[t].has(d.slot))) : null;
    if (lo) {
      gone[t].add(lo.slot);
      bombs.push({ by: s, r, side: t, slot: lo.slot });
    } else bombs.push({ by: s, r, side: null, slot: null });
  }
  const live = { a: dice.a.filter(d => !gone.a.has(d.slot)), b: dice.b.filter(d => !gone.b.has(d.slot)) };
  // 올인 · 배수 · 거울 (거울: 1~3이면 상대 제일 큰 눈을 내가 더하고, 4~6이면 내 제일 큰 눈을 상대가 더한다)
  const add = { a: 0, b: 0 };
  const mul = { a: 1, b: 1 };
  const mirror = { a: null, b: null };
  const top = t => Math.max(0, ...live[t].map(d => d.v));
  for (const s of SIDES) {
    const gs = g[s];
    if (gs?.key === 'allin') add[s] += GAMBLES.allin.faces[gs.r - 1];
    else if (gs?.key === 'mult') mul[s] = GAMBLES.mult.faces[gs.r - 1];
    else if (gs?.key === 'mirror') {
      const to = gs.r <= 3 ? s : other(s);
      const v = top(other(to));
      add[to] += v;
      mirror[s] = { to, v };
    }
  }
  const parts = {};
  for (const s of SIDES) {
    const b = F[s].b;
    const p = {
      venom: st.broken[s] * venomOf(b),
      first: no === 1 && has(b, 'first') ? RULE.FIRST : 0,
      twins: has(b, 'twins') && hasPair(live[s]) ? RULE.TWINS : 0,
      add: add[s],
      m: mul[s],
    };
    p.dice = sum(live[s].map(d => d.v));
    p.total = (p.venom + p.first + p.twins + p.add + p.dice) * p.m;
    p.jack = has(b, 'jackpot') && hasTriple(live[s]);
    parts[s] = p;
  }
  let result;
  if (!live.a.length || !live.b.length) {
    // 폭탄으로 한쪽(드물게 둘 다)이 다 깨짐
    if (live.a.length) result = 'a';
    else if (live.b.length) result = 'b';
    else result = parts.a.total > parts.b.total ? 'a' : parts.b.total > parts.a.total ? 'b' : 'tie';
  } else if (parts.a.jack !== parts.b.jack) result = parts.a.jack ? 'a' : 'b';
  else result = parts.a.total > parts.b.total ? 'a' : parts.b.total > parts.a.total ? 'b' : 'tie';
  return { gone, bombs, live, parts, result, mirror };
}

// 보여 주는 순서: 한 걸음에 양쪽 주사위가 하나씩 '동시에' 떨어진다 (사용자 요청 2026-11-22).
// 각자 작은 눈부터, 끝을 맞춰서 마지막 걸음 = 양쪽 제일 큰 눈. 주사위 수가 다르면 많은 쪽의 작은 주사위가 먼저 혼자 떨어진다.
// steps = [{ a: 자리 | null, b: 자리 | null }], lockAt = 몇 번째 걸음에서 (기술 주사위만 보면) 결과가 정해지나,
// slowAt = 느리게 굴릴 걸음: 마지막 걸음이 결과를 가르고, 그 걸음의 눈에 따라 정말 뒤집힐 수 있을 때(15~85%)만. 사건 · 도박이 남았으면 안 함
function revealPlan(F, dice, parts, busy) {
  const sa = [...dice.a].sort((x, y) => x.shown - y.shown);
  const sb = [...dice.b].sort((x, y) => x.shown - y.shown);
  const n = Math.max(sa.length, sb.length);
  const offA = n - sa.length;
  const offB = n - sb.length;
  const steps = [];
  for (let k = 0; k < n; k++) steps.push({ a: k >= offA ? sa[k - offA].slot : null, b: k >= offB ? sb[k - offB].slot : null });
  const by = { a: new Map(dice.a.map(d => [d.slot, d])), b: new Map(dice.b.map(d => [d.slot, d])) };
  const known = { a: parts.a.venom + parts.a.first, b: parts.b.venom + parts.b.first };
  const left = { a: dice.a.map(d => d.slot), b: dice.b.map(d => d.slot) };
  const minL = s => left[s].length * (has(F[s].b, 'heavy') ? 2 : 1);
  const maxL = s => sum(left[s].map(slot => maxRoll(F[s].b, slot)));
  let lockAt = steps.length - 1;
  for (let i = 0; i < steps.length; i++) {
    for (const s of SIDES) {
      const slot = steps[i][s];
      if (slot == null) continue;
      known[s] += by[s].get(slot).shown;
      left[s] = left[s].filter(x => x !== slot);
    }
    const lo = known.a + minL('a') - (known.b + maxL('b'));
    const hi = known.a + maxL('a') - (known.b + minL('b'));
    if (lo > 0 || hi < 0 || (lo === 0 && hi === 0)) { lockAt = i; break; }
  }
  let slowAt = -1;
  if (!busy && steps.length && lockAt === steps.length - 1) {
    // 마지막 걸음 전 합계 + 마지막 주사위(들)의 모든 눈 조합에서, 결과가 실제와 달라지는 비율
    const last = steps[steps.length - 1];
    const dA = last.a != null ? by.a.get(last.a) : null;
    const dB = last.b != null ? by.b.get(last.b) : null;
    const restA = known.a - (dA ? dA.shown : 0);
    const restB = known.b - (dB ? dB.shown : 0);
    const actual = Math.sign(known.a - known.b);
    const facesOf = d => (d ? Array.from({ length: sidesOf(d.die) }, (_, i) => i + 1) : [0]);
    let diff = 0;
    let tot = 0;
    for (const x of facesOf(dA)) {
      for (const y of facesOf(dB)) {
        tot++;
        if (Math.sign(restA + x - (restB + y)) !== actual) diff++;
      }
    }
    const pf = diff / tot;
    if (pf >= 0.15 && pf <= 0.85) slowAt = steps.length - 1;
  }
  return { steps, lockAt, slowAt };
}

function rollStart(rng, F) {
  const stake = { a: null, b: null, mult: 1 };
  const leech = { a: null, b: null };
  for (const s of SIDES) {
    const b = F[s].b;
    if (!b.gamble || !b.bet) continue;
    if (b.gamble === 'stake') {
      const r = ri(rng, 6);
      stake[s] = r;
      stake.mult = Math.max(stake.mult, r <= 2 ? 1 : r <= 4 ? 2 : 3);
    }
    if (b.gamble === 'leech' && !F[s].shadow) leech[s] = ri(rng, 6);
  }
  return { stake, leech };
}

export const stakeMultOf = r => (r <= 2 ? 1 : r <= 4 ? 2 : 3);

function rollChase(rng, F, winner, st, round, start) {
  const W = F[winner];
  const L = F[other(winner)];
  const dice = rollTech(rng, W.b, st.alive[winner]);
  const q = flameChance(W);
  if (q > 0 && dice.length && rng() < q) flameLowest(rng, W, dice);
  for (const d of dice) {
    d.hit = d.v + (has(W.b, 'taste') ? 1 : 0);
    d.crit = has(W.b, 'crit') && d.max;
    if (d.crit) d.hit *= 2;
  }
  const hits = sum(dice.map(d => d.hit));
  const mult = start.stake.mult;
  const counter = !L.shadow && has(L.b, 'counter') && dice.length ? Math.max(...dice.map(d => d.hit)) : 0;
  const heal = W.shadow ? 0 : start.leech[winner] || 0;
  const leechExtra = L.shadow ? 0 : start.leech[other(winner)] || 0;
  let dmgLoser = (hits - counter + round) * mult + leechExtra;
  let dmgWinner = counter * mult;
  if (W.shadow) { dmgLoser = Math.floor(dmgLoser / 2); dmgWinner = 0; }
  if (L.shadow) { dmgLoser = 0; dmgWinner = 0; }
  return {
    dice: dice.map(d => ({ slot: d.slot, die: d.die, faces: d.faces, v: d.v, max: d.max, ev: d.ev || null, hit: d.hit, crit: d.crit, rr: d.rr || null, heavy: !!d.heavy })),
    hits, round, mult, counter, heal, leechExtra, dmgLoser, dmgWinner,
  };
}

function initState(A, B) {
  return { alive: { a: slotsOf(A.b), b: slotsOf(B.b) }, broken: { a: 0, b: 0 }, braced: { a: 0, b: 0 }, no: 0, streak: 0 };
}
const cloneState = st => ({ alive: { a: [...st.alive.a], b: [...st.alive.b] }, broken: { ...st.broken }, braced: { ...st.braced }, no: st.no, streak: st.streak, zeroWin: st.zeroWin || null });

const info = f => ({
  id: f.id ?? null, name: f.name, shadow: !!f.shadow, w: f.b.w, tier: f.b.tier, tech: techKey(f.b), dice: diceOf(f.b), whet: f.b.whet,
  gamble: f.b.gamble, bet: !!(f.b.gamble && f.b.bet), augs: [...f.b.augs], mom: f.mom || 0, curses: f.curses || 0, cursedBy: f.cursedBy || [], hp: f.hp ?? null,
});

// fighter = { id, name, b(빌드), mom(기세), curses(유령 저주 수), cursedBy, hp, shadow? }
// opt = { record, round, fast(승률 계산 생략), state(중간부터 — 승률 계산용) }
// record가 아니면 이긴 쪽('a'|'b')만, record면 화면이 틀 기록 전체를 돌려준다
export function duel(rng, A, B, opt = {}) {
  const F = { a: A, b: B };
  const rec = !!opt.record;
  const st = opt.state ? cloneState(opt.state) : initState(A, B);
  const betOn = s => (F[s].b.gamble && F[s].b.bet ? F[s].b.gamble : null);
  const start = rec ? rollStart(rng, F) : null;
  const p0 = rec && !opt.fast ? probFrom(A, B, st, TRIALS.p0) : null;
  const clashes = [];
  let last = null;
  while (st.alive.a.length && st.alive.b.length && st.no < RULE.CLASH_MAX) {
    st.no++;
    const no = st.no;
    const dice = { a: rollTech(rng, A.b, st.alive.a), b: rollTech(rng, B.b, st.alive.b) };
    const cursed = { a: applyEvents(rng, F, 'a', dice.a, no), b: applyEvents(rng, F, 'b', dice.b, no) };
    const g = { a: null, b: null };
    for (const s of SIDES) {
      const k = betOn(s);
      if (k && GAMBLES[k].per === 'clash') g[s] = { key: k, r: ri(rng, 6) };
    }
    const J = judge(F, dice, g, st, no);
    last = J.result;
    if (rec) {
      // 도박 주사위가 결과를 가를 수 있었나(tense) · 실제로 뒤집었나(flip) — 깨기 전 상태로
      for (const s of SIDES) {
        if (!g[s]) continue;
        const outs = new Set();
        for (let r = 1; r <= 6; r++) outs.add(judge(F, dice, { ...g, [s]: { key: g[s].key, r } }, st, no).result);
        g[s].tense = outs.size > 1;
        g[s].flip = judge(F, dice, { ...g, [s]: null }, st, no).result !== J.result;
      }
    }
    const venomNow = { a: J.parts.a.venom, b: J.parts.b.venom };
    let tieNo = 0;
    const broke = J.bombs.filter(x => x.side).map(x => ({ side: x.side, slot: x.slot, how: 'bomb' }));
    const brace = [];
    const breakLow = (s, how) => {
      const lo = lowest(J.live[s].filter(d => !broke.some(x => x.side === s && x.slot === d.slot)));
      if (!lo) return;
      if (how === 'lose' && st.braced[s] < braceCap(F[s].b)) {
        st.braced[s]++;
        brace.push({ side: s, slot: lo.slot });
        return;
      }
      broke.push({ side: s, slot: lo.slot, how });
    };
    if (J.live.a.length && J.live.b.length) {
      if (J.parts.a.jack !== J.parts.b.jack) {
        const t = J.parts.a.jack ? 'b' : 'a';
        for (const d of J.live[t]) broke.push({ side: t, slot: d.slot, how: 'jackpot' });
        st.streak = 0;
      } else if (J.result === 'tie') {
        st.streak++;
        tieNo = st.streak;
        // 끝없는 합끼리 둘 다 마지막 주사위면 서로 깨지 않는다 (둘 다 0개로 끝나지 않게)
        const lastBoth = has(A.b, 'endless') && has(B.b, 'endless') && J.live.a.length === 1 && J.live.b.length === 1;
        if (has(A.b, 'endless') && !lastBoth) breakLow('b', 'endless');
        if (has(B.b, 'endless') && !lastBoth) breakLow('a', 'endless');
        if (st.streak >= RULE.TIE_MAX && (J.live.a.length > 1 || J.live.b.length > 1)) {
          breakLow('a', 'tie');
          breakLow('b', 'tie');
          st.streak = 0;
        }
      } else {
        breakLow(other(J.result), 'lose');
        st.streak = 0;
      }
    } else st.streak = 0;
    for (const x of broke) {
      st.alive[x.side] = st.alive[x.side].filter(v => v !== x.slot);
      st.broken[x.side]++;
    }
    if (!st.alive.a.length && !st.alive.b.length) st.zeroWin = J.result === 'tie' ? (rng() < 0.5 ? 'a' : 'b') : J.result;
    if (!rec) continue;
    const busy = dice.a.some(d => d.ev) || dice.b.some(d => d.ev) || J.parts.a.twins || J.parts.b.twins
      || J.bombs.length > 0 || J.parts.a.jack || J.parts.b.jack || !!(g.a?.tense || g.b?.tense);
    const plan = revealPlan(F, dice, J.parts, busy);
    const over = !st.alive.a.length || !st.alive.b.length;
    const pA = over
      ? (st.alive.a.length ? 1 : st.alive.b.length ? 0 : st.zeroWin === 'a' ? 1 : 0)
      : (opt.fast ? null : probFrom(A, B, st, TRIALS.mid));
    const sideRec = s => ({
      dice: dice[s].map(d => ({
        slot: d.slot, die: d.die, faces: d.faces, v: d.v, shown: d.shown, shownFaces: d.shownFaces, max: d.max,
        rr: d.rr || null, heavy: !!d.heavy, ev: d.ev || null, gone: J.gone[s].has(d.slot),
      })),
      venom: venomNow[s], first: J.parts[s].first, twins: J.parts[s].twins,
      add: J.parts[s].add, m: J.parts[s].m, total: J.parts[s].total, jack: J.parts[s].jack,
      g: g[s] ? {
        ...g[s],
        v: g[s].key === 'mult' ? J.parts[s].m : g[s].key === 'allin' ? GAMBLES.allin.faces[g[s].r - 1] : g[s].key === 'mirror' ? J.mirror[s].v : g[s].r,
        to: g[s].key === 'mirror' ? J.mirror[s].to : null,
      } : null,
      cursed: cursed[s],
    });
    clashes.push({
      no, a: sideRec('a'), b: sideRec('b'), ...plan, bombs: J.bombs, result: J.result, broke, brace,
      streak: st.streak, tieNo, alive: { a: [...st.alive.a], b: [...st.alive.b] },
      margin: Math.abs(J.parts.a.total - J.parts.b.total), pA,
    });
  }
  let winner;
  if (st.alive.a.length && !st.alive.b.length) winner = 'a';
  else if (st.alive.b.length && !st.alive.a.length) winner = 'b';
  else if (!st.alive.a.length && !st.alive.b.length) winner = st.zeroWin || (last === 'b' ? 'b' : 'a');
  else winner = st.alive.a.length > st.alive.b.length ? 'a' : st.alive.b.length > st.alive.a.length ? 'b' : (rng() < 0.5 ? 'a' : 'b'); // 안전장치
  if (!rec) return winner;
  const chase = rollChase(rng, F, winner, st, opt.round || 1, start);
  return { round: opt.round || 1, a: info(A), b: info(B), start, p0, clashes, winner, chase };
}

// ───────── 승률 (몬테카를로, 상태마다 씨앗이 정해져 있어서 같은 상태 = 같은 숫자)
const probCache = new Map();
const specKey = f => [f.b.w, f.b.tier, f.b.whet, f.b.gamble || '-', f.b.gamble && f.b.bet ? 1 : 0, f.b.augs.join(','), f.mom || 0, f.curses || 0].join('|');
export function probFrom(A, B, st, trials = TRIALS.preview) {
  if (!st.alive.a.length) return 0;
  if (!st.alive.b.length) return 1;
  const key = `${specKey(A)}#${specKey(B)}#${st.alive.a.join(',')}/${st.alive.b.join(',')}/${st.broken.a},${st.broken.b}/${st.braced.a}${st.braced.b}/${st.no}/${st.streak}#${trials}`;
  const hit = probCache.get(key);
  if (hit !== undefined) return hit;
  const rng = makeRng(hashStr(key));
  let w = 0;
  for (let t = 0; t < trials; t++) if (duel(rng, A, B, { state: st }) === 'a') w++;
  const p = w / trials;
  if (probCache.size > 6000) probCache.clear();
  probCache.set(key, p);
  return p;
}
export const winChance = (A, B, trials = TRIALS.preview) => probFrom(A, B, initState(A, B), trials);

// ───────── 판
function roundRng(game, salt) {
  return makeRng((game.seed ^ Math.imul(game.round + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0);
}

// names = 이름들 (번호 = 플레이어 id), pids = 방의 id들 (네트워크 판에서), human = 늘 왼쪽(a)에 둘 사람 (-1이면 없음)
export function newGame({ names, pids = null, human = 0, seed = 1 }) {
  return {
    seed: seed >>> 0,
    round: 0,
    over: false,
    human,
    players: names.map((name, id) => ({
      id, pid: pids ? pids[id] : id, name, bot: id !== human, w: null, b: null, hp: RULE.HP, gold: 0, mom: 0, alive: true, place: 0,
      lastOpp: null, lastShadow: false, shop: [], bought: [], undo: [], snap: null, curse: null, income: null, rerolls: 0,
      stats: { wins: 0, losses: 0, broken: 0, flips: 0, jackpots: 0, stake3: 0, momMax: 0, longest: 0, miracle: 0, curses: 0, dealt: 0 },
    })),
    pairs: [],
  };
}

export function pickWeapon(game, pid, w) {
  const p = game.players[pid];
  p.w = w;
  p.b = newBuild(w);
}

function tierWeights(round) {
  for (const [upTo, w] of RULE.TIER_W) if (round <= upTo) return w;
  return RULE.TIER_W[RULE.TIER_W.length - 1][1];
}
function weighted(rng, pairs) {
  let x = rng() * sum(pairs.map(p => p[1]));
  for (const [k, w] of pairs) if ((x -= w) < 0) return k;
  return pairs[pairs.length - 1][0];
}
function rollSlot(rng, b, round, taken) {
  for (let tries = 0; tries < 8; tries++) {
    const t = weighted(rng, RULE.SLOT_W);
    let s = null;
    if (t === 'whet') s = canWhet(b) ? { t, key: 'whet' } : null;
    else if (t === 'gamble') s = { t, key: pick(rng, GAMBLE_KEYS.filter(k => k !== b.gamble)) };
    else {
      const tw = tierWeights(round);
      const tier = weighted(rng, [['s', tw.s], ['g', tw.g], ['p', tw.p]]);
      let pool = AUG_KEYS.filter(k => AUGS[k].tier === tier && augAllowed(b, k));
      if (!pool.length) pool = AUG_KEYS.filter(k => augAllowed(b, k));
      if (pool.length) s = { t, key: pick(rng, pool) };
    }
    if (s && !taken.has(s.key)) {
      taken.add(s.key);
      return { ...s, sold: false };
    }
  }
  return canWhet(b) ? { t: 'whet', key: 'whet', sold: false } : { t: 'gamble', key: pick(rng, GAMBLE_KEYS.filter(k => k !== b.gamble && !taken.has(k))), sold: false };
}
export const shopSize = b => RULE.SLOTS + (has(b, 'fox') ? 1 : 0);
function makeShop(rng, b, round) {
  const taken = new Set();
  return Array.from({ length: shopSize(b) }, () => rollSlot(rng, b, round, taken));
}

export function slotCost(b, s) {
  if (s.t === 'whet') return RULE.WHET_COST + b.whet;
  if (s.t === 'gamble') return GAMBLES[s.key].cost;
  return RULE.AUG_COST[AUGS[s.key].tier];
}
export function slotInfo(s) {
  if (s.t === 'whet') return { icon: '🔨', name: '숫돌', text: '제일 작은 주사위를 한 단계 크게', tier: 'whet' };
  if (s.t === 'gamble') { const g = GAMBLES[s.key]; return { icon: g.icon, name: `${g.name} 주사위`, text: g.text, tier: 'gamble' }; }
  const a = AUGS[s.key];
  return { icon: a.icon, name: a.name, text: a.text, tier: a.tier };
}
// 이 칸을 사면 빌드가 어떻게 되나 (미리 보기 · 실제 사기에 같이 쓴다)
export function applySlotTo(b, s) {
  const nb = cloneBuild(b);
  let dropped = null;
  if (s.t === 'whet') nb.whet++;
  else if (s.t === 'gamble') { nb.gamble = s.key; nb.bet = true; }
  else {
    if (nb.augs.length >= RULE.AUG_MAX) dropped = nb.augs.shift();
    nb.augs.push(s.key);
  }
  return { b: nb, dropped };
}
export const tierUpOf = b => (b.tier < 3 ? { ...cloneBuild(b), tier: b.tier + 1 } : null);

function shuffled(rng, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// 무작위로 둘씩. 바로 전 상대와 또 붙는 건 되도록 피하고, 홀수면 한 명은 그림자(아무나의 지난 라운드 주사위)와
function pairUp(game, rng) {
  const alive = game.players.filter(p => p.alive);
  const ids = alive.map(p => p.id);
  let best = null;
  let bestBad = Infinity;
  for (let t = 0; t < 40 && bestBad > 0; t++) {
    const o = shuffled(rng, ids);
    const pairs = [];
    let bad = 0;
    for (let i = 0; i + 1 < o.length; i += 2) {
      pairs.push({ a: o[i], b: o[i + 1] });
      if (ids.length > 2 && game.players[o[i]].lastOpp === o[i + 1]) bad++;
    }
    if (o.length % 2) {
      const last = o[o.length - 1];
      pairs.push({ a: last, b: null });
      if (game.players[last].lastShadow) bad += 0.5;
    }
    if (bad < bestBad) { best = pairs; bestBad = bad; }
  }
  for (const pr of best) {
    if (pr.b !== null) continue;
    const src = pick(rng, alive.filter(p => p.id !== pr.a));
    pr.shadow = { of: src.id, name: `${src.name} 그림자`, b: cloneBuild(src.snap) };
  }
  for (const p of game.players) p.lastShadow = false;
  for (const pr of best) if (pr.b === null) game.players[pr.a].lastShadow = true;
  return best;
}

export function beginRound(game) {
  game.round++;
  const rng = roundRng(game, 1);
  for (const p of game.players) {
    p.bought = [];
    p.undo = [];
    p.rerolls = 0;
    if (!p.alive) { p.curse = null; continue; }
    const interest = Math.min(RULE.INTEREST_MAX, Math.floor(p.gold / RULE.INTEREST_PER));
    p.income = { base: RULE.INCOME, interest };
    p.gold += RULE.INCOME + interest;
    p.snap = cloneBuild(p.b);
    p.shop = makeShop(rng, p.b, game.round);
  }
  game.pairs = pairUp(game, rng);
}

const shopRng = (game, p) => roundRng(game, 100 + p.id * 37 + p.rerolls);

// act: { t: 'slot', i } | { t: 'tier' } | { t: 'reroll' } | { t: 'bet' } | { t: 'undo' }
export function buy(game, pid, act) {
  const p = game.players[pid];
  const no = msg => ({ ok: false, msg });
  if (!p?.alive) return no('탈락했다');
  if (act.t === 'undo') {
    const u = p.undo.pop();
    if (!u) return no('되돌릴 게 없다');
    p.b = { ...u.b, bet: u.b.gamble && u.b.gamble === p.b.gamble ? p.b.bet : u.b.bet }; // G는 되돌리기 대상이 아니다
    p.gold = u.gold;
    p.shop = u.shop;
    p.bought = u.bought;
    p.rerolls = u.rerolls;
    return { ok: true, msg: '되돌렸다' };
  }
  if (act.t === 'bet') {
    if (!p.b.gamble) return no('도박 주사위가 없다');
    p.b.bet = !p.b.bet;
    return { ok: true, msg: p.b.bet ? `${GAMBLES[p.b.gamble].name} 주사위를 건다` : `${GAMBLES[p.b.gamble].name} 주사위를 안 건다` };
  }
  const save = () => p.undo.push({ b: cloneBuild(p.b), gold: p.gold, shop: p.shop.map(s => ({ ...s })), bought: [...p.bought], rerolls: p.rerolls });
  if (act.t === 'reroll') {
    if (p.gold < RULE.REROLL) return no('냥이 모자라다');
    save();
    p.gold -= RULE.REROLL;
    p.rerolls++;
    p.shop = makeShop(shopRng(game, p), p.b, game.round);
    return { ok: true, msg: '다시 뽑았다' };
  }
  if (act.t === 'tier') {
    if (p.b.tier >= 3) return no('이미 3단이다');
    const c = RULE.TIER_COST[p.b.tier + 1];
    if (p.gold < c) return no(`냥이 모자라다 (${c}냥)`);
    save();
    p.gold -= c;
    p.b.tier++;
    p.bought.push({ k: 'tier', to: p.b.tier });
    return { ok: true, msg: `${p.b.tier}단 ${techOf(p.b).name}!` };
  }
  if (act.t === 'slot') {
    const s = p.shop[act.i];
    if (!s) return no('빈칸');
    if (s.sold) return no('이미 샀다');
    const c = slotCost(p.b, s);
    if (p.gold < c) return no(`냥이 모자라다 (${c}냥)`);
    save();
    p.gold -= c;
    s.sold = true;
    const { b, dropped } = applySlotTo(p.b, s);
    p.b = b;
    p.bought.push({ k: s.t, key: s.key, dropped });
    const inf = slotInfo(s);
    return { ok: true, msg: dropped ? `${inf.name} — ${AUGS[dropped].name}은(는) 버렸다` : `${inf.name}!` };
  }
  return no('');
}

export function curse(game, gid, tid) {
  const g = game.players[gid];
  const t = game.players[tid];
  if (!g || g.alive || !t || !t.alive) return false;
  g.curse = tid;
  return true;
}

export const cursesOn = (game, pid) => game.players.filter(g => !g.alive && g.curse === pid);
export function fighterOf(game, pid, b = null) {
  const p = game.players[pid];
  const cs = cursesOn(game, pid);
  return { id: p.id, name: p.name, b: b || p.b, mom: p.mom, curses: cs.length, cursedBy: cs.map(g => g.name), hp: p.hp };
}
const shadowFighter = pr => ({ id: null, name: pr.shadow.name, shadow: true, of: pr.shadow.of, b: pr.shadow.b, mom: 0, curses: 0, cursedBy: [], hp: null });

export function pairOf(game, pid) {
  return game.pairs.find(x => x.a === pid || x.b === pid) || null;
}
// 상점에서 보이는 내 상대: 이번 라운드에 산 건 안 보인다 (🧿 꿰뚫어 봄이면 보인다). 도박을 걸었는지도 모른다
export function visibleOpp(game, pid) {
  const pr = pairOf(game, pid);
  if (!pr) return null;
  if (pr.b === null) return shadowFighter(pr);
  const q = game.players[pr.a === pid ? pr.b : pr.a];
  return fighterOf(game, q.id, has(game.players[pid].b, 'seer') ? q.b : q.snap);
}

export function resolveRound(game, opt = {}) {
  const rng = roundRng(game, 2);
  for (const g of game.players) if (!g.alive && g.curse != null) g.stats.curses++;
  const fights = [];
  for (const pr of game.pairs) {
    let A = fighterOf(game, pr.a);
    let B = pr.b !== null ? fighterOf(game, pr.b) : shadowFighter(pr);
    if (!B.shadow && B.id === game.human) [A, B] = [B, A]; // 사람은 늘 왼쪽(a)
    fights.push(duel(rng, A, B, { record: true, round: game.round, fast: opt.fast }));
  }
  const notes = [];
  for (const f of fights) settleFight(game, f, notes);
  eliminate(game, notes);
  return { fights, notes };
}

function settleFight(game, f, notes) {
  const W = f[f.winner];
  const L = f[other(f.winner)];
  const pw = W.shadow ? null : game.players[W.id];
  const pl = L.shadow ? null : game.players[L.id];
  const c = f.chase;
  const pOf = s => (f[s].shadow ? null : game.players[f[s].id]);
  for (const cl of f.clashes) for (const x of cl.broke) { const p = pOf(x.side); if (p) p.stats.broken++; }
  for (const s of SIDES) {
    const p = pOf(s);
    if (!p) continue;
    for (const cl of f.clashes) {
      if (cl[s].g?.flip) p.stats.flips++;
      if (cl[s].jack && !cl[other(s)].jack) p.stats.jackpots++;
    }
    if (f.start.stake.mult === 3) p.stats.stake3++;
    p.stats.longest = Math.max(p.stats.longest, f.clashes.length);
  }
  const note = { winner: W.name, loser: L.name, dmg: c.dmgLoser, back: c.dmgWinner, heal: c.heal, bounty: 0, shadow: !!(W.shadow || L.shadow) };
  if (pl) {
    pl.hp -= c.dmgLoser;
    pl.mom = 0;
    pl.gold += RULE.CONSOLE;
    pl.stats.losses++;
  }
  if (pw) {
    pw.mom = Math.min(RULE.MOM_MAX, pw.mom + 1);
    pw.stats.wins++;
    pw.stats.momMax = Math.max(pw.stats.momMax, pw.mom);
    pw.stats.dealt += c.dmgLoser;
    if (has(pw.b, 'collect')) pw.gold += RULE.COLLECT;
    if (c.heal) pw.hp = Math.min(RULE.HP, pw.hp + c.heal);
    if (c.dmgWinner) pw.hp -= c.dmgWinner;
    if (pl && L.mom >= RULE.MOM_MAX) { pw.gold += RULE.BOUNTY; note.bounty = RULE.BOUNTY; }
    if (!pl) pw.gold += RULE.SHADOW_WIN;
    if (f.p0 != null && (f.winner === 'a' ? f.p0 : 1 - f.p0) < 0.1) pw.stats.miracle++;
  }
  if (pw && pl) { pw.lastOpp = pl.id; pl.lastOpp = pw.id; }
  note.loserHp = pl ? pl.hp : null;
  note.winnerHp = pw ? pw.hp : null;
  notes.push(note);
}

// 체력이 같으면 씨앗 난수로 순서를 정한다 (앞 번호가 늘 이기지 않게)
function byHp(game, list, salt) {
  const rng = roundRng(game, salt);
  return list.map(p => ({ p, r: rng() })).sort((x, y) => y.p.hp - x.p.hp || x.r - y.r).map(x => x.p);
}

function eliminate(game, notes) {
  const alive = game.players.filter(p => p.alive);
  const dead = byHp(game, alive.filter(p => p.hp <= 0), 3);
  let left = alive.length - dead.length;
  if (left === 0 && dead.length) { dead.shift(); left = 1; } // 다 같이 쓰러지면 덜 깎인 사람이 남는다
  dead.forEach((p, i) => {
    p.alive = false;
    p.place = left + 1 + i;
    p.curse = null;
    notes.push({ out: p.name, place: p.place });
  });
  if (left <= 1 || game.round >= RULE.ROUND_CAP) finish(game);
}

function finish(game) {
  const alive = byHp(game, game.players.filter(p => p.alive), 4);
  alive.forEach((p, i) => { p.place = i + 1; });
  game.over = true;
}

export const standings = game => [...game.players].sort((x, y) => x.place - y.place);

export function titles(game) {
  const ps = game.players;
  const out = [];
  const topBy = (fn, min = 1) => {
    let best = null;
    for (const p of ps) if (fn(p) >= min && (!best || fn(p) > fn(best))) best = p;
    return best;
  };
  const add = (p, icon, name, note) => { if (p) out.push({ icon, name, who: p.name, id: p.id, note }); };
  add(ps.find(p => p.place === 1), '🏆', '대장장이', '우승');
  add(topBy(p => p.stats.miracle), '🎲', '기적의 손', '승률 10% 밑에서 이김');
  add(topBy(p => p.stats.flips), '🎴', '도박왕', `도박으로 뒤집은 합 ${topBy(p => p.stats.flips)?.stats.flips}번`);
  add(topBy(p => p.stats.jackpots), '🎰', '잭팟', '같은 눈 셋');
  add(topBy(p => p.stats.momMax, 3), '🔥', '불타는 손', '3연승');
  add(topBy(p => p.stats.broken), '💔', '깨진 주사위 수집가', `${topBy(p => p.stats.broken)?.stats.broken}개`);
  add(topBy(p => p.stats.stake3), '🪙', '판돈 ×3', '피해 세 배 대결');
  add(topBy(p => p.stats.longest, 6), '⚔️', '명승부', `한 대결에 합 ${topBy(p => p.stats.longest, 6)?.stats.longest}번`);
  add(topBy(p => p.stats.curses, 2), '👻', '저주술사', `저주 ${topBy(p => p.stats.curses, 2)?.stats.curses}번`);
  return out;
}

// ───────── 봇
const FIT = {
  sw: ['powder', 'twins', 'crit', 'venom', 'first', 'extra'],
  hm: ['luck', 'heavy', 'crit', 'first', 'flint', 'brace', 'extra'],
  tw: ['twins', 'jackpot', 'taste', 'venom', 'luck'],
  gb: ['luck', 'crit', 'first', 'flint', 'heavy', 'extra'],
};
// 냥이 되면 단 올리기 → 무기에 맞는 증강 → 남으면 숫돌. 다시 뽑기는 7냥 넘게 남을 때만 (라운드에 두 번까지)
export function botShop(game, pid, rng) {
  const p = game.players[pid];
  if (!p.alive) return;
  let rerolls = 0;
  const saving = p.b.tier === 2 && game.round >= 3 && rng() < 0.45; // 3단 모으기
  for (let step = 0; step < 10; step++) {
    const tc = p.b.tier < 3 ? RULE.TIER_COST[p.b.tier + 1] : Infinity;
    if (p.gold >= tc) { buy(game, pid, { t: 'tier' }); continue; }
    let best = -1;
    let bestSc = 0;
    p.shop.forEach((s, i) => {
      if (s.sold) return;
      const c = slotCost(p.b, s);
      if (c > p.gold) return;
      let sc;
      if (s.t === 'aug') sc = { s: 1.3, g: 1.9, p: 2.8 }[AUGS[s.key].tier] + (FIT[p.b.w].includes(s.key) ? 0.8 : 0) - (p.b.augs.length >= RULE.AUG_MAX ? 1.2 : 0);
      else if (s.t === 'whet') sc = 1;
      else sc = p.b.gamble ? 0.2 : 1.5;
      if (saving && p.gold - c < tc - RULE.INCOME - 2) sc *= 0.4;
      if (sc > bestSc) { bestSc = sc; best = i; }
    });
    if (best >= 0 && bestSc >= 0.9) { buy(game, pid, { t: 'slot', i: best }); continue; }
    if (p.gold >= 8 && rerolls < 2 && !saving) { rerolls++; buy(game, pid, { t: 'reroll' }); continue; }
    break;
  }
}

// 도박: 합마다 굴리는 것(올인 · 배수 · 폭탄 · 거울)은 걸 때와 안 걸 때 승률을 비교해 높은 쪽.
// 판돈 · 흡혈은 승률을 안 바꾸니, 셀 때 체력이 넉넉하면 켠다 (흡혈은 벼랑 끝에서도)
export function botBet(game, pid, trials = TRIALS.bot) {
  const p = game.players[pid];
  if (!p.alive || !p.b.gamble) return;
  const opp = visibleOpp(game, pid);
  if (!opp) return;
  const off = winChance(fighterOf(game, pid, { ...cloneBuild(p.b), bet: false }), opp, trials);
  const k = p.b.gamble;
  if (k === 'stake') p.b.bet = off > 0.6 && p.hp > 20;
  else if (k === 'leech') p.b.bet = (off > 0.55 && p.hp > 12) || p.hp <= 8;
  else p.b.bet = winChance(fighterOf(game, pid, { ...cloneBuild(p.b), bet: true }), opp, trials) >= off;
}

// 유령 봇은 체력이 제일 많은 사람을 저주한다
export function botCurse(game, gid) {
  const g = game.players[gid];
  if (g.alive) return;
  const alive = game.players.filter(p => p.alive);
  if (!alive.length) return;
  g.curse = alive.reduce((x, y) => (y.hp > x.hp ? y : x)).id;
}

// ───────── 봇끼리 여러 판 (브라우저 콘솔: __forge.simulate({ games: 200, players: 6 }))
export function simulate({ games = 200, players = 6, seed = 7 } = {}) {
  const t0 = Date.now();
  const rounds = [];
  const winW = Object.fromEntries(WEAPON_KEYS.map(w => [w, 0]));
  const playW = Object.fromEntries(WEAPON_KEYS.map(w => [w, 0]));
  const gambleHeld = Object.fromEntries(GAMBLE_KEYS.map(k => [k, 0]));
  const gambleWin = Object.fromEntries(GAMBLE_KEYS.map(k => [k, 0]));
  let fights = 0;
  let clashes = 0;
  let gClashes = 0;
  let flips = 0;
  let slowCount = 0;
  let close = 0;
  for (let gi = 0; gi < games; gi++) {
    const game = newGame({ names: Array.from({ length: players }, (_, i) => `봇${i + 1}`), human: -1, seed: seed * 1000003 + gi });
    const rng = makeRng((seed * 7919 + gi * 104729) >>> 0);
    for (const p of game.players) {
      const w = pick(rng, WEAPON_KEYS);
      pickWeapon(game, p.id, w);
      playW[w]++;
    }
    while (!game.over) {
      beginRound(game);
      for (const p of game.players) if (p.alive) botShop(game, p.id, rng);
      for (const p of game.players) { if (p.alive) botBet(game, p.id, 60); else botCurse(game, p.id); }
      const res = resolveRound(game, { fast: true });
      for (const f of res.fights) {
        fights++;
        clashes += f.clashes.length;
        for (const c of f.clashes) {
          if (c.slowAt >= 0) slowCount++;
          if (c.margin <= 1) close++;
          for (const s of SIDES) if (c[s].g) { gClashes++; if (c[s].g.flip) flips++; }
        }
      }
    }
    rounds.push(game.round);
    const win = game.players.find(p => p.place === 1);
    if (win) winW[win.w]++;
    for (const p of game.players) if (p.b.gamble) { gambleHeld[p.b.gamble]++; if (p.place === 1) gambleWin[p.b.gamble]++; }
  }
  const pct = x => `${Math.round(x * 1000) / 10}%`;
  const sorted = [...rounds].sort((x, y) => x - y);
  return {
    games, players, ms: Date.now() - t0,
    rounds: { avg: Math.round((sum(rounds) / games) * 10) / 10, p10: sorted[Math.floor(games * 0.1)], p90: sorted[Math.floor(games * 0.9)] },
    // 무기마다 우승률 = 우승 수 / 그 무기를 고른 사람 수 × 인원 (공평하면 100%)
    weaponWin: Object.fromEntries(WEAPON_KEYS.map(w => [WEAPONS[w].name, playW[w] ? pct((winW[w] / playW[w]) * players) : '-'])),
    clashPerFight: Math.round((clashes / fights) * 100) / 100,
    slowRate: pct(slowCount / clashes),
    closeRate: pct(close / clashes),
    gambleFlipRate: gClashes ? pct(flips / gClashes) : '-',
    gambleEnd: Object.fromEntries(GAMBLE_KEYS.map(k => [GAMBLES[k].name, `${gambleHeld[k]}명 · 우승 ${gambleWin[k]}`])),
  };
}

// ───────── 화면이 쓰는 것
// 대결 기록의 왼쪽(a)과 오른쪽(b)을 바꾼다 (내가 b인 대결을 내 쪽이 왼쪽에 오게 볼 때). 값은 그대로
export function mirrorFight(f) {
  const sw = s => (s === 'a' ? 'b' : s === 'b' ? 'a' : s);
  const flipSide = x => ({ ...x, side: sw(x.side) });
  const g = sd => (sd.g ? { ...sd, g: { ...sd.g, to: sw(sd.g.to) } } : sd);
  return {
    ...f,
    a: f.b,
    b: f.a,
    start: { stake: { a: f.start.stake.b, b: f.start.stake.a, mult: f.start.stake.mult }, leech: { a: f.start.leech.b, b: f.start.leech.a } },
    p0: f.p0 == null ? null : 1 - f.p0,
    winner: sw(f.winner),
    clashes: f.clashes.map(c => ({
      ...c,
      a: g(c.b),
      b: g(c.a),
      steps: c.steps.map(x => ({ a: x.b, b: x.a })),
      bombs: c.bombs.map(x => ({ ...x, by: sw(x.by), side: sw(x.side) })),
      broke: c.broke.map(flipSide),
      brace: c.brace.map(flipSide),
      alive: { a: c.alive.b, b: c.alive.a },
      result: sw(c.result),
      pA: c.pA == null ? null : 1 - c.pA,
    })),
  };
}

// 대결 하나를 화면이 틀 때 걸리는 시간 어림 (빠르기 1, 넉넉히). 방장이 대결 단계 길이를 정할 때 쓴다 (forge-view.js 박자와 맞춤)
export function playMs(f) {
  let ms = 650 + 300;
  for (const s of ['a', 'b']) {
    if (f.start.stake[s]) ms += 1300;
    if (f.start.leech[s]) ms += 1200;
  }
  for (const c of f.clashes) {
    const e = Math.min(0.4, 0.08 * (c.no - 1));
    const q = x => Math.max(110, x * (1 - e));
    ms += 450 + c.steps.length * 360 + (c.slowAt >= 0 ? 1100 : 0);
    for (const s of ['a', 'b']) {
      for (const d of c[s].dice) {
        if (d.rr) ms += 600;
        if (d.ev) ms += d.ev.includes('+') ? 1120 : 560;
      }
      if (c[s].twins) ms += 380;
      if (c[s].g) ms += (c[s].g.tense ? 1050 : q(320)) + q(420) + 200;
      if (c[s].m !== 1) ms += 380;
    }
    if (c.a.jack !== c.b.jack) ms += 1350;
    ms += q(220) + c.broke.length * (q(160) + 140) + c.brace.length * 420 + q(620) + 150;
  }
  ms += 1000 + 450 + f.chase.dice.length * 420 + 1500;
  return Math.round(ms);
}
