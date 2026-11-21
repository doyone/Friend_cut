// 주사위 합 — 규칙 코어. 화면 · 소리와 상관없는 순수 함수만 둔다 (방장 · 시제품 · 테스트가 같이 쓴다).
// 숫자는 기획서-주사위합.md '조절할 값' 그대로 (파이썬 봇 시뮬레이션으로 맞춘 첫 값).
//
// 승부 하나 = runDuel() 이 돌려주는 기록 하나. 화면은 이 기록을 박자대로 틀기만 한다.
// 값은 전부 여기서 굴린다. 화면이 바꿀 수 있는 건 '보여 주는 순서'뿐 (revealOrder).

export const RULE = {
  BRK: 3,          // 독기: 이번 승부에서 깨진 내 주사위 하나마다 위력 +3
  FLAME: 0.15,     // 기세 1마다 합 한 번에 불꽃(마이너스면 꺼짐)이 붙을 확률
  MOM_MIN: -3,
  MOM_MAX: 3,
  EXPLODE_MAX: 3,  // 폭발 주사위가 이어서 터지는 최대 횟수 (하나에 최대 6×4 = 24)
  TIE_MAX: 5,      // 동수가 이만큼 이어지면 둘 다 하나씩 깨짐 (끝없이 도는 것만 막는 장치)
  CLASH_MAX: 60,   // 안전장치
  ODDS_MAX: 10,    // 내기 배당 최대
  MIRACLE: 0.10,   // 이보다 낮은 승률로 이기면 '기적'
  UPSET: 0.25,
};

export const DICE = {
  d6: { key: 'd6', sides: 6, explode: false, name: '육면체' },
  d10: { key: 'd10', sides: 10, explode: false, name: '열면체' },
  d20: { key: 'd20', sides: 20, explode: false, name: '이십면체' },
  x6: { key: 'x6', sides: 6, explode: true, name: '폭발 육면체' },
};

export const WEAPONS = {
  sw: { key: 'sw', name: '검객', icon: '🗡️', die: 'd10', taste: '무난함. 3단은 주사위가 하나 는다' },
  hm: { key: 'hm', name: '장사', icon: '🔨', die: 'd20', taste: '한 방. 합 한 번에 끝난다' },
  tw: { key: 'tw', name: '쌍검', icon: '🥢', die: 'd6', taste: '오래 주고받고, 이기면 연타' },
  gb: { key: 'gb', name: '노름꾼', icon: '🎲', die: 'x6', taste: '6이면 한 번 더. 대박 아니면 쪽박' },
};

export const TECHS = {
  sw1: { key: 'sw1', w: 'sw', tier: 1, name: '베기', base: 3, die: 'd10', n: 2 },
  sw2: { key: 'sw2', w: 'sw', tier: 2, name: '겹베기', base: 4, die: 'd10', n: 2 },
  sw3: { key: 'sw3', w: 'sw', tier: 3, name: '삼단베기', base: 0, die: 'd10', n: 3 },
  hm1: { key: 'hm1', w: 'hm', tier: 1, name: '내려찍기', base: 6, die: 'd20', n: 1 },
  hm2: { key: 'hm2', w: 'hm', tier: 2, name: '통짜찍기', base: 8, die: 'd20', n: 1 },
  hm3: { key: 'hm3', w: 'hm', tier: 3, name: '산 가르기', base: 10, die: 'd20', n: 1 },
  tw1: { key: 'tw1', w: 'tw', tier: 1, name: '찌르기', base: 1, die: 'd6', n: 3 },
  tw2: { key: 'tw2', w: 'tw', tier: 2, name: '난도질', base: 3, die: 'd6', n: 3 },
  tw3: { key: 'tw3', w: 'tw', tier: 3, name: '칼바람', base: 0, die: 'd6', n: 4 },
  gb1: { key: 'gb1', w: 'gb', tier: 1, name: '한 판', base: 5, die: 'x6', n: 2 },
  gb2: { key: 'gb2', w: 'gb', tier: 2, name: '두 판', base: 2, die: 'x6', n: 3 },
  gb3: { key: 'gb3', w: 'gb', tier: 3, name: '몰빵', base: 3, die: 'x6', n: 3 },
};

// "베기 3 + d10×2"
export function techText(key) {
  const t = TECHS[key];
  const die = DICE[t.die].explode ? '🔥d6' : t.die;
  return `${t.name} ${t.base} + ${die}${t.n > 1 ? `×${t.n}` : ''}`;
}

// 승률 다섯 칸 (보는 쪽 기준)
export function labelOf(p) {
  if (p >= 0.9) return '필승';
  if (p >= 0.6) return '유리';
  if (p >= 0.4) return '팽팽';
  if (p >= 0.1) return '불리';
  return '기적';
}

// 배당 = 1 ÷ 승률 (소수 첫째 자리, 1.0 ~ ×10)
export function oddsOf(p) {
  if (!(p > 0)) return RULE.ODDS_MAX;
  return Math.min(RULE.ODDS_MAX, Math.max(1, Math.round(10 / p) / 10));
}

export const clampMom = m => Math.max(RULE.MOM_MIN, Math.min(RULE.MOM_MAX, m | 0));

// ───────── 씨앗 있는 난수 (mulberry32). 같은 씨앗 = 같은 승부
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ri = (rng, n) => 1 + Math.floor(rng() * n);
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const sum = arr => arr.reduce((a, b) => a + b, 0);

// 주사위 하나: 눈 목록 (폭발 주사위는 터질 때마다 하나씩 늘어난다: [6, 6, 3] = 15)
function rollFaces(rng, dieKey) {
  const d = DICE[dieKey];
  const faces = [ri(rng, d.sides)];
  if (d.explode) {
    while (faces[faces.length - 1] === d.sides && faces.length <= RULE.EXPLODE_MAX) faces.push(ri(rng, d.sides));
  }
  return faces;
}
// 불꽃: 최대 눈으로 (폭발 주사위면 거기서 터지기 시작)
function maxFaces(rng, dieKey) {
  const d = DICE[dieKey];
  const faces = [d.sides];
  if (d.explode) {
    while (faces[faces.length - 1] === d.sides && faces.length <= RULE.EXPLODE_MAX) faces.push(ri(rng, d.sides));
  }
  return faces;
}

// 한쪽이 합 한 번에 굴리는 것. slots = 아직 안 깨진 주사위 자리 번호들
// 돌려줌: { dice: [{ slot, faces, v, raw? }], ev, base, bonus, total }
//   raw = 불꽃 · 꺼짐 전에 처음 떨어진 눈 (화면은 raw를 먼저 보여 주고 바꾼다)
//   ev  = null | { type: 'flame' | 'fizzle', slot, from: [...], to: [...] }
function rollSide(rng, T, slots, mom, broken) {
  const dice = slots.map(slot => {
    const faces = rollFaces(rng, T.die);
    return { slot, faces, v: sum(faces) };
  });
  let ev = null;
  const q = Math.min(0.9, Math.abs(mom) * RULE.FLAME);
  if (mom !== 0 && dice.length && rng() < q) {
    let i = 0;
    for (let j = 1; j < dice.length; j++) {
      if (mom > 0 ? dice[j].v < dice[i].v : dice[j].v > dice[i].v) i = j;
    }
    const from = dice[i].faces;
    const to = mom > 0 ? maxFaces(rng, T.die) : [1];
    dice[i] = { slot: dice[i].slot, faces: to, v: sum(to), raw: from };
    ev = { type: mom > 0 ? 'flame' : 'fizzle', slot: dice[i].slot, from, to };
  }
  const bonus = RULE.BRK * broken;
  return { die: T.die, dice, ev, base: T.base, bonus, total: T.base + bonus + sum(dice.map(d => d.v)) };
}

function lowestSlot(side) {
  let best = side.dice[0];
  for (const d of side.dice) if (d.v < best.v) best = d;
  return best.slot;
}

// ───────── 승률 (몬테카를로, 상태마다 씨앗이 정해져 있어서 같은 상태 = 같은 숫자)
function quickTotal(rng, T, n, mom, broken) {
  const d = DICE[T.die];
  let s = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    let f = ri(rng, d.sides);
    let v = f;
    if (d.explode) {
      let c = 0;
      while (f === d.sides && c < RULE.EXPLODE_MAX) { f = ri(rng, d.sides); v += f; c++; }
    }
    s += v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (mom !== 0 && n > 0 && rng() < Math.min(0.9, Math.abs(mom) * RULE.FLAME)) {
    if (mom > 0) {
      let f = d.sides;
      let v = f;
      if (d.explode) {
        let c = 0;
        while (f === d.sides && c < RULE.EXPLODE_MAX) { f = ri(rng, d.sides); v += f; c++; }
      }
      s += v - lo;
    } else {
      s += 1 - hi;
    }
  }
  return T.base + RULE.BRK * broken + s;
}

function simFrom(rng, A, B, ma, mb, na, nb, bra, brb) {
  let streak = 0;
  let guard = 0;
  while (na > 0 && nb > 0 && guard++ < RULE.CLASH_MAX) {
    const ta = quickTotal(rng, A, na, ma, bra);
    const tb = quickTotal(rng, B, nb, mb, brb);
    if (ta > tb) { nb--; brb++; streak = 0; }
    else if (tb > ta) { na--; bra++; streak = 0; }
    else if (++streak >= RULE.TIE_MAX && (na > 1 || nb > 1)) { na--; nb--; bra++; brb++; streak = 0; }
  }
  return na > 0;
}

const probCache = new Map();
// A가 이길 확률. 상태 = 남은 주사위 수 · 깨진 수(독기). 기세는 승부 안에서 안 바뀐다
export function winProb(a, b, momA = 0, momB = 0, nA = TECHS[a].n, nB = TECHS[b].n, brA = 0, brB = 0, trials = 2000) {
  if (nA <= 0) return 0;
  if (nB <= 0) return 1;
  const key = `${a}|${b}|${momA}|${momB}|${nA}|${nB}|${brA}|${brB}|${trials}`;
  const hit = probCache.get(key);
  if (hit !== undefined) return hit;
  const rng = makeRng(hashStr(key));
  const A = TECHS[a];
  const B = TECHS[b];
  let w = 0;
  for (let t = 0; t < trials; t++) if (simFrom(rng, A, B, momA, momB, nA, nB, brA, brB)) w++;
  const p = w / trials;
  if (probCache.size > 4000) probCache.clear();
  probCache.set(key, p);
  return p;
}

// ───────── 승부 하나 통째로
// 돌려줌 (화면이 그대로 튼다):
// {
//   seed, a, b, momA, momB, p0,                    // 기술 키 · 기세 · 시작 승률(A 기준)
//   clashes: [{ no, a: side, b: side, result: 'a'|'b'|'tie', broke: [{side, slot}], streak, pot,
//               pA, margin, alive: { a: [...], b: [...] }, preWinner, twist }],
//   winner: 'a'|'b', hits: side(이긴 쪽 추격, base · bonus 빼고 dice만 씀), dmg, pot, pay,
//   pW0, low, miracle, upset, comeback, momAfter: { a, b }
// }
//   preWinner = 불꽃 · 꺼짐 전 눈으로 비교했을 때 이긴 쪽 ('a'|'b'|'tie'), twist = 불꽃 · 꺼짐이 결과를 바꿈
//   low = 이긴 쪽 승률이 승부 중 제일 낮았던 값 (시작 포함)
export function runDuel({ a, b, momA = 0, momB = 0, seed = 1, mult = 1 }) {
  const rng = makeRng(seed);
  const A = TECHS[a];
  const B = TECHS[b];
  momA = clampMom(momA);
  momB = clampMom(momB);
  let aliveA = Array.from({ length: A.n }, (_, i) => i);
  let aliveB = Array.from({ length: B.n }, (_, i) => i);
  let brA = 0;
  let brB = 0;
  let pot = 0;
  let streak = 0;
  const p0 = winProb(a, b, momA, momB);
  const clashes = [];
  const trace = [p0];
  while (aliveA.length && aliveB.length && clashes.length < RULE.CLASH_MAX) {
    const ra = rollSide(rng, A, aliveA, momA, brA);
    const rb = rollSide(rng, B, aliveB, momB, brB);
    pot += 1;
    const broke = [];
    let result;
    if (ra.total > rb.total) {
      result = 'a';
      const s = lowestSlot(rb);
      aliveB = aliveB.filter(x => x !== s);
      brB++;
      broke.push({ side: 'b', slot: s });
      streak = 0;
    } else if (rb.total > ra.total) {
      result = 'b';
      const s = lowestSlot(ra);
      aliveA = aliveA.filter(x => x !== s);
      brA++;
      broke.push({ side: 'a', slot: s });
      streak = 0;
    } else {
      result = 'tie';
      streak++;
      if (streak >= RULE.TIE_MAX && (aliveA.length > 1 || aliveB.length > 1)) {
        const sa = lowestSlot(ra);
        const sb = lowestSlot(rb);
        aliveA = aliveA.filter(x => x !== sa);
        aliveB = aliveB.filter(x => x !== sb);
        brA++;
        brB++;
        broke.push({ side: 'a', slot: sa }, { side: 'b', slot: sb });
        streak = 0;
      }
    }
    const rawA = ra.base + ra.bonus + sum(ra.dice.map(d => (d.raw ? sum(d.raw) : d.v)));
    const rawB = rb.base + rb.bonus + sum(rb.dice.map(d => (d.raw ? sum(d.raw) : d.v)));
    const preWinner = rawA > rawB ? 'a' : rawB > rawA ? 'b' : 'tie';
    const pA = aliveA.length && aliveB.length
      ? winProb(a, b, momA, momB, aliveA.length, aliveB.length, brA, brB)
      : (aliveA.length ? 1 : 0);
    trace.push(pA);
    clashes.push({
      no: clashes.length + 1,
      a: ra,
      b: rb,
      result,
      broke,
      streak: result === 'tie' ? streak : 0,
      pot,
      pA,
      margin: Math.abs(ra.total - rb.total),
      alive: { a: [...aliveA], b: [...aliveB] },
      preWinner,
      twist: !!(ra.ev || rb.ev) && preWinner !== result,
    });
  }
  const winner = aliveA.length ? 'a' : 'b';
  const W = winner === 'a' ? A : B;
  const hits = rollSide(rng, W, winner === 'a' ? aliveA : aliveB, winner === 'a' ? momA : momB, 0);
  const dmg = sum(hits.dice.map(d => d.v));
  const pW0 = winner === 'a' ? p0 : 1 - p0;
  const low = Math.min(...trace.map(p => (winner === 'a' ? p : 1 - p)));
  return {
    seed,
    a,
    b,
    momA,
    momB,
    p0,
    clashes,
    winner,
    hits,
    dmg,
    pot,
    pay: (dmg + pot) * mult,
    pW0,
    low,
    miracle: pW0 < RULE.MIRACLE,
    upset: pW0 < RULE.UPSET,
    comeback: pW0 >= RULE.UPSET && low < 0.35,
    momAfter: winner === 'a'
      ? { a: clampMom(momA + 1), b: clampMom(momB - 1) }
      : { a: clampMom(momA - 1), b: clampMom(momB + 1) },
  };
}

// ───────── 보여 주는 순서: 작은 눈부터 양쪽 번갈아, 각자 제일 큰 눈은 남겨 뒀다가 마지막에 —
// 앞선 쪽의 큰 눈 먼저, 지고 있는 쪽의 큰 눈이 맨 끝. 값은 안 바꾼다.
// 돌려줌: { order: [{ side, slot }], lockAt }
//   lockAt = 몇 번째 공개에서 (불꽃 · 꺼짐 전) 결과가 정해지는지. order.length - 1 이면 마지막 주사위가 갈랐다
const landed = d => (d.raw ? sum(d.raw) : d.v);
export function revealOrder(clash, aFirst = true) {
  const sa = [...clash.a.dice].sort((x, y) => landed(x) - landed(y));
  const sb = [...clash.b.dice].sort((x, y) => landed(x) - landed(y));
  const la = sa.pop();
  const lb = sb.pop();
  const first = aFirst ? ['a', sa, 'b', sb] : ['b', sb, 'a', sa];
  const order = [];
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    if (i < first[1].length) order.push({ side: first[0], slot: first[1][i].slot });
    if (i < first[3].length) order.push({ side: first[2], slot: first[3][i].slot });
  }
  const shownA = clash.a.base + clash.a.bonus + sum(sa.map(landed));
  const shownB = clash.b.base + clash.b.bonus + sum(sb.map(landed));
  const A = { side: 'a', slot: la.slot };
  const B = { side: 'b', slot: lb.slot };
  if (shownA < shownB) order.push(B, A);
  else if (shownB < shownA) order.push(A, B);
  else order.push(...(landed(la) >= landed(lb) ? [B, A] : [A, B]));
  return { order, lockAt: lockIndex(clash, order) };
}

function maxLanded(dieKey) {
  const d = DICE[dieKey];
  return d.explode ? d.sides * (RULE.EXPLODE_MAX + 1) : d.sides;
}

// 공개가 하나씩 될 때, 남은 주사위가 1 ~ 최대 눈 어디로 떨어지든 결과가 같아지는 첫 순간
function lockIndex(clash, order) {
  const dieA = clash.a.die;
  const dieB = clash.b.die;
  const byA = new Map(clash.a.dice.map(d => [d.slot, d]));
  const byB = new Map(clash.b.dice.map(d => [d.slot, d]));
  let knownA = clash.a.base + clash.a.bonus;
  let knownB = clash.b.base + clash.b.bonus;
  let leftA = clash.a.dice.length;
  let leftB = clash.b.dice.length;
  const outcome = (lo, hi) => (lo > 0 ? 1 : hi < 0 ? -1 : lo === 0 && hi === 0 ? 0 : null);
  for (let i = 0; i < order.length; i++) {
    const o = order[i];
    if (o.side === 'a') { knownA += landed(byA.get(o.slot)); leftA--; } else { knownB += landed(byB.get(o.slot)); leftB--; }
    // A − B 가 가질 수 있는 가장 작은 값 · 큰 값
    const lo = (knownA + leftA * 1) - (knownB + leftB * maxLanded(dieB));
    const hi = (knownA + leftA * maxLanded(dieA)) - (knownB + leftB * 1);
    if (outcome(lo, hi) !== null) return i;
  }
  return order.length - 1;
}

// ───────── 연출용 확률: 화면이 '이번 합을 어떻게 보여 줄지' 고를 때만 쓴다. 값은 안 바꾼다.
export const landedOf = landed;

const distCache = new Map();
// 주사위 하나의 눈 분포 [[눈, 확률], …] (폭발 주사위는 이어 터지기까지)
export function dieDist(dieKey) {
  const hit = distCache.get(dieKey);
  if (hit) return hit;
  const d = DICE[dieKey];
  const m = new Map();
  const rec = (acc, p, depth) => {
    for (let f = 1; f <= d.sides; f++) {
      const q = p / d.sides;
      if (d.explode && f === d.sides && depth < RULE.EXPLODE_MAX) rec(acc + f, q, depth + 1);
      else m.set(acc + f, (m.get(acc + f) || 0) + q);
    }
  };
  rec(0, 1, 0);
  const out = [...m.entries()].sort((x, y) => x[0] - y[0]);
  distCache.set(dieKey, out);
  return out;
}
function convDist(a, b) {
  const m = new Map();
  for (const [x, px] of a) for (const [y, py] of b) m.set(x + y, (m.get(x + y) || 0) + px * py);
  return [...m.entries()];
}
function sumDist(dieKey, k) {
  let dist = [[0, 1]];
  for (let i = 0; i < k; i++) dist = convDist(dist, dieDist(dieKey));
  return dist;
}

// 합 한 번을 굴리기 전에 본 승산 { a, t, b } (A가 이김 · 같음 · B가 이김). 기세 · 독기까지 넣은 몬테카를로
const xCache = new Map();
export function exchangeProb(a, b, momA = 0, momB = 0, nA = TECHS[a].n, nB = TECHS[b].n, brA = 0, brB = 0, trials = 2000) {
  const key = `${a}|${b}|${momA}|${momB}|${nA}|${nB}|${brA}|${brB}|${trials}`;
  const hit = xCache.get(key);
  if (hit) return hit;
  const rng = makeRng(hashStr(`x|${key}`));
  const A = TECHS[a];
  const B = TECHS[b];
  let wa = 0;
  let wt = 0;
  for (let t = 0; t < trials; t++) {
    const ta = quickTotal(rng, A, nA, momA, brA);
    const tb = quickTotal(rng, B, nB, momB, brB);
    if (ta > tb) wa++;
    else if (ta === tb) wt++;
  }
  const out = { a: wa / trials, t: wt / trials, b: (trials - wa - wt) / trials };
  if (xCache.size > 4000) xCache.clear();
  xCache.set(key, out);
  return out;
}

// 공개 순서 order 에서 앞의 k개가 보인 뒤, 남은 주사위가 떨어져서 나올 결과의 확률 { a, t, b } (불꽃 · 꺼짐 전 기준)
// k = 0 이면 아무것도 안 보인 상태, k = order.length 면 다 보인 상태 (그땐 0 아니면 1)
export function swingChance(clash, order, k) {
  let A = clash.a.base + clash.a.bonus;
  let B = clash.b.base + clash.b.bonus;
  const byA = new Map(clash.a.dice.map(d => [d.slot, d]));
  const byB = new Map(clash.b.dice.map(d => [d.slot, d]));
  let leftA = clash.a.dice.length;
  let leftB = clash.b.dice.length;
  for (let i = 0; i < k && i < order.length; i++) {
    const o = order[i];
    if (o.side === 'a') { A += landed(byA.get(o.slot)); leftA--; } else { B += landed(byB.get(o.slot)); leftB--; }
  }
  const da = sumDist(clash.a.die, leftA);
  const db = sumDist(clash.b.die, leftB);
  let pa = 0;
  let pt = 0;
  let pb = 0;
  for (const [x, px] of da) {
    for (const [y, py] of db) {
      const d = A + x - (B + y);
      if (d > 0) pa += px * py;
      else if (d < 0) pb += px * py;
      else pt += px * py;
    }
  }
  return { a: pa, t: pt, b: pb, shownA: A, shownB: B };
}

// 시연용: 조건에 맞는 승부가 나오는 씨앗 찾기
export function findSeed(setup, pred, from = 1, tries = 40000) {
  for (let s = from; s < from + tries; s++) {
    const d = runDuel({ ...setup, seed: s });
    if (pred(d)) return s;
  }
  return null;
}
