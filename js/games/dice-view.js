// 주사위 합 연출 화면. dice-proto.js 가 createDiceView(stageEl, { audio, names }) 로 부른다.
// 값은 전부 runDuel 기록 그대로 쓴다. 화면이 고르는 건 보여 주는 순서(revealOrder)와 박자뿐.
// 무대는 1280×720 한 장으로 짜서 틀 크기에 맞춰 통째로 키운다. 위치 · 박자 · 카메라 수치는 작업지시-주사위합.md 그대로.
import { TECHS, WEAPONS, DICE, RULE, revealOrder, labelOf, techText, exchangeProb, swingChance, landedOf } from './dice-core.js';
import { PX, sprite, dieFace, dieTumble, fighter, shard, FIGHTER, DIE_SIZE } from './dice-art.js';

const W = 1280;
const H = 720;
const SIDES = ['a', 'b'];
const RIDGE = Math.round(H * 0.72);                          // 용마루 = 발 딛는 줄
// 지시서는 28% · 72%인데, 주사위 4개 줄이 몸을 가려서 바깥으로 뺐다
const FOOT = { a: Math.round(W * 0.22), b: Math.round(W * 0.78) };
// 당길 때 기준 높이: 화면 가운데가 아니라 부딪는 줄 근처라야 아래 구경꾼 이름이 덜 잘린다
const FOCUS_Y = 430;
const DIR = { a: 1, b: -1 };                                  // 가운데를 향하는 쪽
const ROW = { a: W * 0.38, b: W * 0.62 };                     // 주사위 줄 가운데
const ROW_Y = Math.round(H * 0.6);
const SUM_X = { a: Math.round(W * 0.36), b: Math.round(W * 0.64) };
const SUB_Y = Math.round(H * 0.36) + 57;                      // '위력 4 + 독기 3' 줄
// 부딪는 점: 지시서는 (50%, 50%)인데 그 높이면 칼날보다 위에서 터진다. 칼끝이 실제로 만나는 높이로 내렸다
const HIT = { x: W / 2, y: 405 };
// ready 자세의 앞손 (fighter 그림의 hF − 발밑, 3배)
const HAND = { dx: 24, dy: -120 };
const FAN_X = [0.24, 0.37, 0.5, 0.63, 0.76].map(v => Math.round(W * v)); // 가운데가 '나'
const COLOR = { a: '#ef7d57', b: '#41a6f6' };
const CHIP = { a: '#b13e53', b: '#3b5dc9' };
const GOLD = '#ffcd75';
const WHITE = '#f4f4f4';
const SPARK = { colors: ['#ffcd75', '#f4f4f4', '#ef7d57'], speed: 560, g: 1100, life: 0.5 };
const FIRE = { colors: ['#ef7d57', '#ffcd75', '#b13e53'], speed: 240, up: 160, g: 260, life: 0.6 };
const SMOKE = { colors: ['#566c86', '#94b0c2', '#333c57'], speed: 70, up: 90, g: -60, life: 1.0 };
const GLINT = { colors: ['#ffcd75', '#f4f4f4'], speed: 260, g: 600, life: 0.45 };
const CONFETTI = ['#ffcd75', '#ef7d57', '#a7f070', '#41a6f6', '#73eff7', '#f4f4f4', '#b13e53'];
const CANCEL = Symbol('cancel');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sum = arr => arr.reduce((x, y) => x + y, 0);
const other = s => (s === 'a' ? 'b' : 'a');
const lin = p => p;
const easeOut = p => 1 - (1 - p) * (1 - p);
const stepped = n => p => (p >= 1 ? 1 : Math.floor(p * n) / n);
const faceState = (v, sides) => (v === sides ? 'max' : v === 1 ? 'min' : 'idle');
const dieSize = die => [DIE_SIZE[die][0] * PX, DIE_SIZE[die][1] * PX];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function pxImg(spr, scale = PX, cls) {
  const im = el('img', cls);
  im.alt = '';
  im.draggable = false;
  if (spr) {
    im.src = spr.url;
    im.width = spr.w * scale;
    im.height = spr.h * scale;
  }
  return im;
}
// 같은 애니메이션을 다시 걸기
function restart(e, cls) {
  e.classList.remove(cls);
  void e.offsetWidth;
  e.classList.add(cls);
}
const tumbleCache = {};
const tumbleUrls = die => (tumbleCache[die] ||= [0, 1, 2, 3].map(f => dieTumble(die, f).url));

// ───────── 연출 감독: 합마다 어떻게 보여 줄지 고른다 (값은 안 바꾼다). 규칙은 작업지시-주사위합.md '연출 2차'
// 수치는 봇 승부 2000번으로 맞춘 값이라 그대로 둔다.
const SLOW_RANGE = { 접전: [0.15, 0.85], 반격: [0.15, 0.85], 결전: [0.12, 0.88] };
const inRange = (v, [lo, hi]) => v != null && v >= lo && v <= hi;
// 씨앗 + 합 번호로 섞기 (같은 승부를 다시 틀면 같은 연출)
function mix(seed, no, salt = 0) {
  let h = ((seed >>> 0) ^ Math.imul(no + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const maxLandedOf = die => (DICE[die].explode ? DICE[die].sides * (RULE.EXPLODE_MAX + 1) : DICE[die].sides);
const rawTotal = (c, s) => c[s].base + c[s].bonus + sum(c[s].dice.map(landedOf));
// 뒤집힐 확률: order 앞의 k개가 보인 뒤, 지금 지는 쪽이 이기거나 비길 확률
function flipOf(c, order, k) {
  const w = swingChance(c, order, k);
  if (w.shownA === w.shownB) return Math.min(w.a, w.b) + w.t;
  return (w.shownA < w.shownB ? w.a : w.b) + w.t;
}
// 따라잡기 순서: 목표 쪽 전부 → 쫓는 쪽 작은 눈부터
function chaseOrder(c, target) {
  const by = s => [...c[s].dice].sort((x, y) => landedOf(x) - landedOf(y)).map(d => ({ side: s, slot: d.slot }));
  return [...by(target), ...by(other(target))];
}
// 쫓는 쪽이 넘는(pass) · 못 넘게 되는(short) 공개 번호. 끝까지 딱 맞으면 tie
function chaseLock(c, order, target) {
  const ch = other(target);
  const goal = rawTotal(c, target);
  const maxL = maxLandedOf(c[ch].die);
  let shown = c[ch].base + c[ch].bonus;
  let left = c[ch].dice.length;
  const first = c[target].dice.length;
  const judge = i => (shown > goal ? { at: i, kind: 'pass' } : shown + left * maxL < goal ? { at: i, kind: 'short' } : null);
  const pre = judge(first - 1);
  if (pre) return pre;
  for (let i = first; i < order.length; i++) {
    shown += landedOf(c[ch].dice.find(x => x.slot === order[i].slot));
    left--;
    const j = judge(i);
    if (j) return j;
  }
  return { at: order.length - 1, kind: 'tie' };
}

// 합 하나 고르기. st = 이 합 전의 { n: 남은 주사위 수, br: 깨진 수, p: 승부 승률(A) }
function directClash(duel, c, st) {
  const { order, lockAt } = revealOrder(c);
  const last = order.length - 1;
  const flip = flipOf(c, order, last);
  const r = c.result;
  const over = !c.alive.a.length || !c.alive.b.length;
  const P = { no: c.no, mode: '', pattern: null, xw: null, flip, order, lockAt, climax: last, lock: null, cFlip: null, target: null, slow: false, struggle: false };
  if (r === 'tie') return { ...P, mode: '맞물림', pattern: '번갈아' };
  const x = exchangeProb(duel.a, duel.b, duel.momA, duel.momB, st.n.a, st.n.b, st.br.a, st.br.b);
  const xw = x.t < 1 ? x[r] / (1 - x.t) : 0.5;
  const pLoser = r === 'a' ? 1 - st.p : st.p;
  let mode;
  if (xw <= 0.3) mode = '반격';
  // 불꽃 · 꺼짐이 결과를 뒤집은 합을 '상대가 안 된다'로 보여 주면 자막과 화면이 어긋난다
  else if (c.twist) mode = over ? '결전' : '접전';
  else if (over && pLoser >= 0.25) mode = '결전';
  else if (over) mode = '마무리';
  else if ((xw >= 0.75 && (c.margin >= 5 || lockAt <= 1)) || pLoser < 0.12) mode = '압살';
  else if (c.margin <= 2 || (lockAt === last && flip >= 0.2 && flip <= 0.8 && xw <= 0.7)) mode = '접전';
  else mode = '속공';
  Object.assign(P, { mode, xw });
  const range = SLOW_RANGE[mode];
  if (!range) return P;
  // 번갈아 (지금 방식) 은 마지막 주사위가 진짜 아슬아슬할 때만, 아니면 따라잡기
  if (mode !== '반격' && inRange(flip, range) && mix(duel.seed, c.no, 7) < 0.5) {
    return { ...P, pattern: '번갈아', cFlip: flip, slow: lockAt === last };
  }
  // 따라잡기: 떨어진 눈 합이 큰 쪽이 목표 (반격은 센 쪽 = 이 합에 진 쪽)
  const da = sum(c.a.dice.map(landedOf));
  const db = sum(c.b.dice.map(landedOf));
  const target = mode === '반격' ? other(r) : da > db ? 'a' : db > da ? 'b' : other(r);
  const ord = chaseOrder(c, target);
  const lock = chaseLock(c, ord, target);
  const first = c[target].dice.length;
  const cFlip = lock.at >= first ? flipOf(c, ord, lock.at) : null;
  const slow = inRange(cFlip, range);
  const struggle = !slow && mode !== '반격' && lock.at === ord.length - 1 && cFlip != null && cFlip < range[0];
  return { ...P, pattern: '따라잡기', order: ord, climax: lock.at, lock: lock.kind, cFlip, target, slow, struggle };
}

// 승부 하나를 따라가며 합마다 고른다 (상태를 들고 간다)
export function createDirector(duel) {
  const n = { a: TECHS[duel.a].n, b: TECHS[duel.b].n };
  const br = { a: 0, b: 0 };
  let p = duel.p0;
  return c => {
    const plan = directClash(duel, c, { n: { ...n }, br: { ...br }, p });
    for (const b of c.broke) { n[b.side]--; br[b.side]++; }
    p = c.pA;
    return plan;
  };
}
export const directDuel = duel => duel.clashes.map(createDirector(duel));

export function createDiceView(stageEl, { audio = null, names = { a: 'A', b: 'B' } } = {}) {
  const A = audio || {};
  // 한 번 소리: 건너뛰는 중엔 안 낸다. 이어지는 소리(bed · heart · duck)는 늘 맞춘다
  const sfx = (name, ...args) => {
    if (skipping) return;
    try { A[name]?.(...args); } catch (err) { console.warn('dice-view 소리', name, err); }
  };
  const sset = (name, ...args) => {
    try { A[name]?.(...args); } catch (err) { console.warn('dice-view 소리', name, err); }
  };

  // ───────── 무대 뼈대 (뒤에서 앞으로)
  const stage = el('div', 'dz-stage');
  const world = el('div', 'dz-world');

  const sky = el('div', 'dz-sky');
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // 별 자리는 늘 같게
  for (let i = 0; i < 30; i++) {
    const s = el('i', 'dz-star');
    s.style.left = `${Math.floor(rnd() * (W / 3)) * 3}px`;
    s.style.top = `${Math.floor(rnd() * 130) * 3}px`;
    s.style.animationDuration = `${(1.6 + rnd() * 2.4).toFixed(2)}s`;
    s.style.animationDelay = `${(-rnd() * 3).toFixed(2)}s`;
    sky.append(s);
  }
  const moonGlow = el('div', 'dz-moonglow');
  const moon = pxImg(sprite('moon'), PX, 'dz-moon');
  const city = el('div', 'dz-city');
  city.style.backgroundImage = `url(${sprite('city').url})`;
  const lanternUrls = [0, 1, 2].map(i => sprite(`lantern${i}`).url);
  const lanterns = SIDES.map(s => {
    const box = el('div', `dz-lantern ${s}`);
    const im = pxImg(sprite('lantern0'));
    box.append(el('div', 'dz-lglow'), im);
    return { box, im };
  });
  const eave = el('div', 'dz-eave');
  const roof = el('div', 'dz-roof');
  roof.style.backgroundImage = `url(${sprite('roof').url})`;
  const pile = el('img', 'dz-pile off');
  pile.alt = '';

  // 두 사람
  const F = {};
  for (const s of SIDES) {
    const wrap = el('div', `dz-fighter ${s}`);
    wrap.style.left = `${FOOT[s]}px`;
    const body = el('div', 'dz-fbody');
    const im = el('img', 'dz-fimg');
    im.alt = '';
    im.width = FIGHTER.w * PX;
    im.height = FIGHTER.h * PX;
    im.style.left = `${-FIGHTER.footX * PX}px`;
    im.style.top = `${-FIGHTER.ground * PX}px`;
    body.append(im);
    wrap.append(body);
    F[s] = { wrap, im, w: s === 'a' ? 'sw' : 'hm', pose: '', drawn: '', x: 0, y: 0 };
  }

  const diceLayer = el('div', 'dz-dicebox');
  const T = {};
  for (const s of SIDES) {
    const box = el('div', `dz-total ${s} off`);
    box.style.left = `${SUM_X[s]}px`;
    const num = el('div', 'dz-num', '0');
    const sub = el('div', 'dz-sub');
    const near = el('div', 'dz-near');
    const need = el('div', 'dz-need');      // 따라잡기: '7 더!'
    box.append(need, num, sub, near);
    T[s] = { box, num, sub, near, need, v: 0 };
  }
  const roundEl = el('div', 'dz-round');
  const midEl = el('div', 'dz-mid');
  const crowdEl = el('div', 'dz-crowd');
  const cv = el('canvas', 'dz-fx');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const popLayer = el('div', 'dz-pops');
  world.append(sky, moonGlow, moon, city, ...lanterns.map(l => l.box), eave, roof, pile,
    F.a.wrap, F.b.wrap, diceLayer, T.a.box, T.b.box, roundEl, midEl, crowdEl, cv, popLayer);

  // 덮개: 가장자리 어둠 · 레터박스 · 번쩍임
  const vigEl = el('div', 'dz-vig');
  const lbTop = el('div', 'dz-lb top');
  const lbBot = el('div', 'dz-lb bot');
  const flashEl = el('div', 'dz-flash');
  const dimEl = el('div', 'dz-dim');          // 일섬: 화면이 어두워짐
  const rimEl = el('div', 'dz-rim');          // 동수 3번째부터 붉은 테두리
  const impactEl = el('div', 'dz-impact');    // 마무리 임팩트 프레임 (흰 1장 → 검은 1장)

  // 읽혀야 하는 것 (안 흔들림)
  const hud = el('div', 'dz-hud');
  const plates = { a: el('div', 'dz-plate a off'), b: el('div', 'dz-plate b off') };
  const plateMinis = { a: [], b: [] };
  const oddsBox = el('div', 'dz-odds off');
  const oddsFill = el('div', 'dz-odds-fill');
  const oddsPa = el('b', 'pa', '50%');
  const oddsPb = el('b', 'pb', '50%');
  const oddsLab = el('div', 'dz-odds-lab');
  oddsBox.append(oddsFill, oddsPa, oddsPb, oddsLab);
  const bands = { a: el('div', 'dz-band a off'), b: el('div', 'dz-band b off') };
  const cap = el('div', 'dz-cap');
  const bannerEl = el('div', 'dz-banner off');
  const bannerSmall = el('small');
  const bannerBig = el('b');
  bannerEl.append(bannerSmall, bannerBig);
  const settleEl = el('div', 'dz-settle off');
  const idleEl = el('div', 'dz-idle off', '스페이스 = 승부');
  // 합 세기 'N합' (승부 내내 남는다)
  const countEl = el('div', 'dz-count off');
  const countTxt = el('b');
  countEl.append(countTxt);
  // 마무리 컷인: 기술 이름 + 이긴 사람 실루엣
  const cutinEl = el('div', 'dz-cutin off');
  const cutinImg = el('img', 'dz-cutin-fig');
  cutinImg.alt = '';
  cutinImg.width = FIGHTER.w * PX;
  cutinImg.height = FIGHTER.h * PX;
  const cutinTxt = el('b');
  cutinEl.append(cutinImg, cutinTxt);
  hud.append(plates.a, plates.b, oddsBox, countEl, bands.a, bands.b, cap, settleEl, idleEl, cutinEl, bannerEl);

  // 내기 판
  const betEl = el('div', 'dz-panel dz-bet off');
  const pickA = el('div', 'dz-pick a');
  const pickB = el('div', 'dz-pick b');
  const picks = el('div', 'dz-picks');
  picks.append(pickA, pickB);
  const noneEl = el('div', 'dz-none', '↓ 안 건다');
  const amtEls = ['1 10냥', '2 30냥', '3 올인'].map(t => el('span', null, t));
  const amts = el('div', 'dz-amts');
  amtEls.forEach((e, i) => { if (i) amts.append(' · '); amts.append(e); });
  const timeEl = el('div', 'dz-time');
  const timeBar = el('i');
  timeEl.append(timeBar);
  const betPurse = el('div', 'dz-bet-purse');
  betEl.append(el('div', 'dz-bet-q', '누구에게 걸까?'), picks, noneEl, amts, timeEl, betPurse);
  // 결과 카드
  const card = el('div', 'dz-panel dz-card off');

  stage.append(world, dimEl, vigEl, rimEl, lbTop, lbBot, flashEl, impactEl, hud, betEl, card);
  stageEl.append(stage);

  // 틀에 맞춰 키우기: 도트 한 칸이 정수 px이 되는 배율(1/3 단위)이 거의 맞으면 그쪽으로
  function fit() {
    const r = stageEl.getBoundingClientRect();
    if (!r.width || !r.height) return;
    let s = Math.min(r.width / W, r.height / H);
    const snap = Math.floor(s * 3) / 3;
    if (snap > 0 && snap >= s * 0.9) s = snap;
    stage.style.transform = `scale(${s})`;
    stage.style.left = `${Math.round((r.width - W * s) / 2)}px`;
    stage.style.top = `${Math.round((r.height - H * s) / 2)}px`;
  }
  const ro = new ResizeObserver(fit);
  ro.observe(stageEl);
  fit();

  // ───────── 시간: 모든 기다림은 wait 하나로 (빠르기 · 건너뛰기 · 세대 번호)
  let gen = 0;
  let spd = 1;
  let skipping = false;
  let frozen = 0;           // 멈칫이 끝나는 시각
  const waits = new Set();
  const tweens = new Set();
  const cyclers = new Set();
  const parts = [];

  const alive = g => { if (g !== gen) throw CANCEL; };
  function wait(ms) {
    const g = gen;
    if (skipping || !(ms > 0)) return Promise.resolve().then(() => alive(g));
    return new Promise(res => {
      const w = { res, t: setTimeout(() => { waits.delete(w); res(); }, ms / spd) };
      waits.add(w);
    }).then(() => alive(g));
  }
  function addTween(ms, fn, ease, res) {
    const t = { e: 0, ms, fn, ease, res, timer: 0 };
    // rAF가 멈춰도(뒤 탭) 끝은 나게
    t.timer = setTimeout(() => endTween(t), ms / spd + 150);
    tweens.add(t);
    fn(ease(0));
  }
  function endTween(t) {
    if (!tweens.has(t)) return;
    tweens.delete(t);
    clearTimeout(t.timer);
    t.fn(1);
    t.res?.();
  }
  // 기다리는 움직임 (세대가 바뀌면 거기서 멈춘다)
  function tween(ms, fn, ease = lin) {
    const g = gen;
    if (skipping || !(ms > 0)) { fn(1); return Promise.resolve().then(() => alive(g)); }
    return new Promise(res => addTween(ms, fn, ease, res)).then(() => alive(g));
  }
  // 안 기다리는 움직임
  function anim(ms, fn, ease = lin) {
    if (skipping || !(ms > 0)) { fn(1); return; }
    addTween(ms, fn, ease, null);
  }
  function flushWaits() {
    for (const w of waits) { clearTimeout(w.t); w.res(); }
    waits.clear();
  }
  // 새 장면: 앞 장면의 기다림은 전부 풀고(풀린 쪽은 CANCEL로 빠진다) 움직임은 버린다
  function begin() {
    gen++;
    skipping = false;
    unfreeze();
    flushWaits();
    for (const t of tweens) { clearTimeout(t.timer); t.res?.(); }
    tweens.clear();
    clearTimeout(flashTimer);
    impactEl.style.opacity = '0';
    dimEl.style.opacity = '0';
  }
  function freeze(ms) {
    if (skipping) return;
    frozen = performance.now() + ms / spd;
    stage.classList.add('dz-freeze');
  }
  function unfreeze() {
    frozen = 0;
    stage.classList.remove('dz-freeze');
  }
  function cycle(img, urls, period, i = 0) {
    const c = { img, urls, period, i: i % urls.length, acc: 0 };
    img.src = urls[c.i];
    cyclers.add(c);
    return c;
  }

  // ───────── 카메라 (.dz-world 에만)
  const cam = { z: 1, tz: 1, x: W / 2, y: H / 2, tx: W / 2, ty: H / 2, amp: 0, t: 0, dur: 0, acc: 0, ox: 0, oy: 0, last: '' };
  function shake(px, ms) {
    if (skipping) return;
    px = Math.min(14, px);
    const cur = cam.t < cam.dur ? cam.amp * (1 - cam.t / cam.dur) : 0;
    if (px < cur) return;
    cam.amp = px;
    cam.t = 0;
    cam.dur = ms;
    cam.acc = 99;
  }
  function pull(z, x = W / 2, y = FOCUS_Y) {
    cam.tz = z;
    cam.tx = x;
    cam.ty = y;
    if (skipping) { cam.z = z; cam.x = x; cam.y = y; }
  }
  function camStep(dt) {
    const k = dt > 0 ? 1 - Math.exp(-dt / 70) : 0;
    cam.z += (cam.tz - cam.z) * k;
    cam.x += (cam.tx - cam.x) * k;
    cam.y += (cam.ty - cam.y) * k;
    if (Math.abs(cam.tz - cam.z) < 0.0005) cam.z = cam.tz;
    let ox = 0;
    let oy = 0;
    if (cam.t < cam.dur) {
      cam.t += dt;
      cam.acc += dt;
      if (cam.acc >= 33) { // 흔들림은 30fps로 툭툭
        cam.acc = 0;
        const a = cam.amp * Math.max(0, 1 - cam.t / cam.dur);
        cam.ox = Math.round((Math.random() * 2 - 1) * a);
        cam.oy = Math.round((Math.random() * 2 - 1) * a * 0.7);
      }
      ox = cam.ox;
      oy = cam.oy;
    }
    const z = cam.z;
    const tr = `translate(${(ox + cam.x * (1 - z)).toFixed(1)}px, ${(oy + cam.y * (1 - z)).toFixed(1)}px) scale(${z.toFixed(4)})`;
    if (tr !== cam.last) {
      world.style.transform = tr;
      cam.last = tr;
    }
  }

  // ───────── 입자 (캔버스, 3px 네모 + 도트 그림)
  const pics = new Map();
  function pic(url) {
    let im = pics.get(url);
    if (!im) {
      im = new Image();
      im.src = url;
      pics.set(url, im);
    }
    return im;
  }
  for (const n of ['coin', 'coin_s', 'ember']) pic(sprite(n).url);
  function add(p) {
    if (skipping || parts.length > 1200) return;
    parts.push(p);
  }
  function burst(x, y, n, { colors = SPARK.colors, speed = 400, spread = Math.PI * 2, dir = 0, g = 900, life = 0.55, up = 0 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const v = speed * (0.35 + Math.random() * 0.65);
      add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up, g, t: 0, life: life * (0.6 + Math.random() * 0.7), c: colors[(Math.random() * colors.length) | 0] });
    }
  }
  function toss(spr, x, y, vx, vy, { g = 1400, life = 0.9, delay = 0 } = {}) {
    add({ img: pic(spr.url), w: spr.w * PX, h: spr.h * PX, x, y, vx, vy, g, t: -delay, life });
  }
  // 정해진 곳으로 포물선 (도착하면 done)
  function fly(spr, x0, y0, x1, y1, ms, arc, done = null, delay = 0) {
    if (skipping) { done?.(); return; }
    add({ fly: true, img: pic(spr.url), w: spr.w * PX, h: spr.h * PX, x: x0, y: y0, x0, y0, x1, y1, ms, arc, done, g: gen, t: -delay });
  }
  function dust(x, y) {
    burst(x, y - 3, 12, { colors: ['#566c86', '#94b0c2'], speed: 160, dir: -Math.PI / 2, spread: Math.PI * 0.9, g: 300, life: 0.45 });
  }
  function stepParts(dt) {
    const s = dt / 1000;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt;
      if (p.t < 0) continue;
      if (p.fly) {
        const k = Math.min(1, p.t / p.ms);
        p.x = p.x0 + (p.x1 - p.x0) * k;
        p.y = p.y0 + (p.y1 - p.y0) * k - 4 * p.arc * k * (1 - k);
        if (k >= 1) {
          parts.splice(i, 1);
          if (p.done && p.g === gen) p.done();
        }
        continue;
      }
      p.vy += p.g * s;
      p.x += p.vx * s;
      p.y += p.vy * s;
      if (p.t >= p.life * 1000 || p.y > H + 40) parts.splice(i, 1);
    }
  }
  let drewParts = false;
  function drawParts() {
    if (!parts.length && !drewParts) return;
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    for (const p of parts) {
      if (p.t < 0) continue;
      if (p.img) {
        if (p.img.complete) ctx.drawImage(p.img, Math.round(p.x - p.w / 2), Math.round(p.y - p.h / 2), p.w, p.h);
      } else {
        ctx.fillStyle = p.c;
        ctx.fillRect(Math.round(p.x / 3) * 3, Math.round(p.y / 3) * 3, 3, 3);
      }
    }
    drewParts = parts.length > 0;
  }

  // ───────── 한 프레임
  let raf = 0;
  let last = performance.now();
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const real = Math.min(64, Math.max(0, now - last));
    last = now;
    if (frozen && now >= frozen) unfreeze();
    const dt = frozen ? 0 : real * spd;
    if (dt > 0) {
      for (const t of tweens) {
        t.e += dt;
        const p = Math.min(1, t.e / t.ms);
        if (p >= 1) endTween(t);
        else t.fn(t.ease(p));
      }
      for (const c of cyclers) {
        if (!c.img.isConnected) { cyclers.delete(c); continue; }
        c.acc += dt;
        if (c.acc >= c.period) {
          c.acc %= c.period;
          c.i = (c.i + 1) % c.urls.length;
          c.img.src = c.urls[c.i];
        }
      }
      stepParts(dt);
    }
    camStep(dt);
    drawParts();
  }
  raf = requestAnimationFrame(loop);
  lanterns.forEach((l, i) => cycle(l.im, lanternUrls, 150, i));

  // ───────── 장면 조각
  const S = {
    names: { ...names }, duel: null, odds: null, bet: null, fans: [], me: null,
    broken: { a: 0, b: 0 }, lastLead: null, betOpen: false, betIdx: 0, lastCount: 0, betSide: undefined,
    tieRun: 0, // 이어진 동수 수 (붉은 테두리)
  };

  function pose(s, p) {
    const f = F[s];
    const key = `${f.w}:${p}`;
    f.pose = p;
    if (f.drawn !== key) {
      f.im.src = fighter(f.w, p, s).url;
      f.drawn = key;
    }
    f.wrap.classList.toggle('still', p === 'down' || p === 'strike' || p === 'hurt');
  }
  function place(s, x, y = 0) {
    F[s].x = x;
    F[s].y = y;
    F[s].wrap.style.transform = x || y ? `translate(${Math.round(x)}px, ${Math.round(y)}px)` : '';
  }
  function slideHome(s, ms) {
    const x0 = F[s].x;
    const y0 = F[s].y;
    if (!x0 && !y0) return;
    anim(ms, p => place(s, x0 * (1 - p), y0 * (1 - p)), stepped(3));
  }
  // 움찔 (자세는 그대로, 그림만 떨림)
  function flinch(s) {
    if (!skipping) restart(F[s].wrap, 'flinch');
  }

  function say(t) {
    t = t || '';
    if (cap.textContent === t) return;
    cap.textContent = t;
    if (t && !skipping) restart(cap, 'new');
  }
  function banner(text, cls = 'gold', small = '') {
    if (!text) { bannerEl.classList.add('off'); return; }
    bannerEl.className = `dz-banner ${cls}`;
    bannerSmall.textContent = small;
    bannerBig.textContent = text;
    restart(bannerBig, 'slam');
  }
  function settle(text) {
    settleEl.textContent = text || '';
    settleEl.classList.toggle('off', !text);
  }
  function pop(x, y, text, cls = '', size = 0) {
    if (skipping) return null;
    const p = el('div', `dz-pop ${cls}`, text);
    p.style.left = `${Math.round(x)}px`;
    p.style.top = `${Math.round(y)}px`;
    if (size) { p.style.fontSize = `${size}px`; p.style.lineHeight = `${size}px`; }
    p.addEventListener('animationend', () => p.remove());
    popLayer.append(p);
    anim(cls.includes('cash') ? 1500 : 1000, k => { if (k >= 1) p.remove(); }); // animationend가 안 와도 치운다
    return p;
  }
  function slash(s) {
    if (skipping) return;
    const e = el('div', `dz-slash ${s}`);
    e.addEventListener('animationend', () => e.remove());
    popLayer.append(e);
    anim(420, k => { if (k >= 1) e.remove(); });
  }
  // 잠깐 보이고 사라지는 효과 조각 (CSS 애니메이션, 안 끝나도 ms 뒤 치운다)
  function fxEl(cls, x, y, ms) {
    if (skipping) return null;
    const e = el('div', cls);
    e.style.left = `${Math.round(x)}px`;
    e.style.top = `${Math.round(y)}px`;
    popLayer.append(e);
    anim(ms, k => { if (k >= 1) e.remove(); });
    return e;
  }
  // 안 기다리고 조금 뒤에 (세대가 바뀌면 안 한다, 건너뛰면 바로)
  function later(ms, fn) {
    anim(ms, p => { if (p >= 1) fn(); });
  }

  // ───────── 무기 효과 (부딪힐 때 이긴 쪽 무기로)
  function weaponFx(s) {
    const w = F[s].w;
    if (w === 'hm') shockwave(s, FOOT[other(s)], RIDGE - 90);            // 장사: 진 쪽 자리에 충격파
    else if (w === 'tw') [[-48, -30], [36, 6], [-12, 42]].forEach(([dx, dy], i) => later(60 * i, () => xcut(s, HIT.x + dx, HIT.y + dy)));
    else if (w === 'gb') fanArc(s, HIT.x, HIT.y);
    else slash(s);                                                        // 검객: 대각선 칼자국
  }
  // 장사: 세로 충격파 고리 · 기와 들썩 · 먼지 기둥
  function shockwave(s, x, y) {
    fxEl(`dz-ring ${s}`, x, y, 500);
    if (!skipping) restart(roof, 'jolt');
    burst(x, RIDGE, 28, { colors: ['#566c86', '#94b0c2', '#f4f4f4'], speed: 420, dir: -Math.PI / 2, spread: 0.45, g: 500, life: 0.7 });
    dust(x - 45, RIDGE);
    dust(x + 45, RIDGE);
    sfx('quake');
  }
  // 쌍검: 작은 X자 칼자국
  function xcut(s, x, y) {
    fxEl(`dz-x ${s}`, x, y, 320);
    burst(x, y, 6, SPARK);
  }
  // 노름꾼: 부채 휘두르는 호 + 엽전 반짝이 + 짤랑
  function fanArc(s, x, y) {
    fxEl(`dz-fanarc ${s}`, x, y, 450);
    const cs = sprite('coin_s');
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const v = 220 + Math.random() * 200;
      toss(cs, x, y, Math.cos(a) * v, Math.sin(a) * v, { g: 900, life: 0.8 });
    }
    burst(x, y, 12, GLINT);
    sfx('chip', 4);
  }

  // 번쩍임: 0.7 넘게 하얗지 않게, 1초에 3번 넘게 안 깜빡이게. 센 것(strong)은 버리지 않고 조금 미룬다
  let lastFlash = -1e9;
  let flashTimer = 0;
  function flash(color, a, ms, strong = false) {
    if (skipping) return;
    const gap = performance.now() - lastFlash;
    if (gap < 340) {
      if (!strong) return;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => flash(color, a, ms, true), 340 - gap);
      return;
    }
    lastFlash = performance.now();
    flashEl.style.transition = 'none';
    flashEl.style.background = color;
    flashEl.style.opacity = String(Math.min(0.7, a));
    void flashEl.offsetWidth;
    flashEl.style.transition = `opacity ${Math.round(ms / spd)}ms steps(4)`;
    flashEl.style.opacity = '0';
  }
  function vig(v) { vigEl.style.setProperty('--vig', v.toFixed(3)); }
  function letterbox(on) { stage.classList.toggle('cine', on); }

  // 합계
  function showSum(s, v) {
    T[s].v = v;
    T[s].num.textContent = String(v);
  }
  function countTo(s, v, ms = 120) {
    const from = T[s].v;
    if (from === v) return wait(0);
    return tween(ms, p => showSum(s, Math.round(from + (v - from) * p)), stepped(4));
  }
  function setSub(s, base, bonus) {
    T[s].sub.textContent = bonus > 0 ? `위력 ${base} + 독기 ${bonus}` : `위력 ${base}`;
  }
  // 앞선 쪽이 밝고 크게. 앞섬이 바뀌면 lead
  function lead(init = false) {
    const a = T.a.v;
    const b = T.b.v;
    const L = a > b ? 'a' : b > a ? 'b' : null;
    T.a.box.classList.toggle('lead', L === 'a');
    T.b.box.classList.toggle('lead', L === 'b');
    if (!L) return;
    if (!init && S.lastLead && L !== S.lastLead) sfx('lead');
    S.lastLead = L;
  }

  // 승률 막대
  function oddsText(p, withPct = false) {
    const fav = p >= 0.5 ? 'a' : 'b';
    const q = fav === 'a' ? p : 1 - p;
    const lab = labelOf(q);
    if (lab === '팽팽') return withPct ? `팽팽 ${Math.round(q * 100)}%` : '팽팽';
    return withPct ? `${S.names[fav]} ${Math.round(q * 100)}% · ${lab}` : `${S.names[fav]} ${lab}`;
  }
  function setOdds(p, ms, label) {
    if (skipping || !(ms > 0)) oddsFill.style.transition = 'none';
    else oddsFill.style.transition = `width ${Math.round(ms / spd)}ms steps(${Math.max(2, Math.round(ms / 50))})`;
    oddsFill.style.width = `${(p * 100).toFixed(2)}%`;
    const pa = Math.round(p * 100);
    oddsPa.textContent = `${pa}%`;
    oddsPb.textContent = `${100 - pa}%`;
    oddsLab.textContent = label ?? oddsText(p);
  }

  // 판돈 더미 (합마다 한 칸)
  function pileSet(n) {
    if (n <= 0) { pile.classList.add('off'); return; }
    const s = sprite(`pile${Math.min(8, n)}`);
    pile.src = s.url;
    pile.width = s.w * PX;
    pile.height = s.h * PX;
    pile.style.left = `${Math.round(W / 2 - (s.w * PX) / 2)}px`;
    pile.style.top = `${RIDGE + 3 - s.h * PX}px`;
    pile.classList.remove('off');
  }
  const pileTop = n => RIDGE + 3 - (4 + Math.min(8, Math.max(1, n)) * 2 + 2) * PX;

  // ───────── 주사위 (DOM)
  const dice = { a: new Map(), b: new Map(), h: new Map() };
  function rowX(s, i, n, die) {
    const [w] = dieSize(die);
    return Math.round(ROW[s] + (i - (n - 1) / 2) * (w + 9));
  }
  function makeDie(side, slot, die, x, y) {
    const [w, h] = dieSize(die);
    const e = el('div', 'dz-die');
    e.style.left = `${Math.round(x - w / 2)}px`;
    e.style.top = `${Math.round(y - h / 2)}px`;
    const im = pxImg(null);
    im.width = w;
    im.height = h;
    const stack = el('div', 'dz-stack');
    e.append(im, stack);
    diceLayer.append(e);
    const D = { side, slot, die, el: e, im, stack, x, y, w, h, v: 0, st: 'idle', cyc: null };
    D.cyc = cycle(im, tumbleUrls(die), 60, (Math.random() * 4) | 0);
    dice[side].set(slot, D);
    return D;
  }
  function moveDie(D, dx, dy) {
    D.el.style.transform = dx || dy ? `translate(${Math.round(dx)}px, ${Math.round(dy)}px)` : '';
  }
  function stopRoll(D) {
    if (D.cyc) cyclers.delete(D.cyc);
    D.cyc = null;
  }
  function setFace(D, v, st) {
    stopRoll(D);
    D.v = v;
    D.st = st;
    D.im.src = dieFace(D.die, v, st).url;
    if (!skipping) restart(D.el, 'land');
  }
  function fadeDie(D) {
    stopRoll(D);
    dice[D.side].delete(D.slot);
    if (skipping) { D.el.remove(); return; }
    D.el.classList.add('gone');
    anim(220, p => { if (p >= 1) D.el.remove(); });
  }
  function clearDice() {
    for (const m of Object.values(dice)) {
      for (const D of m.values()) stopRoll(D);
      m.clear();
    }
    diceLayer.replaceChildren();
  }
  // 손에서 튀어나와 포물선 → 두 번 통통
  function throwDie(D, fromX, fromY, ms, bounce = true, arc = 150) {
    const sx = fromX - D.x;
    const sy = fromY - D.y;
    const air = bounce ? 0.6 : 1;
    anim(ms, p => {
      let dx = 0;
      let dy = 0;
      if (p < air) {
        const k = p / air;
        dx = sx * (1 - k);
        dy = sy * (1 - k) - arc * 4 * k * (1 - k);
      } else if (p < 0.85) {
        const k = (p - 0.6) / 0.25;
        dy = -27 * 4 * k * (1 - k);
      } else if (p < 1) {
        const k = (p - 0.85) / 0.15;
        dy = -9 * 4 * k * (1 - k);
      }
      moveDie(D, dx, dy);
    });
  }
  function shatterDie(D, n = 6) {
    stopRoll(D);
    D.el.remove();
    dice[D.side].delete(D.slot);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i - (n - 1) / 2) * (3.3 / n) + (Math.random() - 0.5) * 0.3;
      const v = 260 + Math.random() * 220;
      toss(shard(D.die, i % 6), D.x, D.y, Math.cos(a) * v, Math.sin(a) * v, { g: 1600, life: 0.9 });
    }
    dust(D.x, D.y + D.h / 2);
    burst(D.x, D.y, 14, { colors: ['#94b0c2', '#566c86', '#f4f4f4'], speed: 300, g: 900, life: 0.5 });
  }
  const flameUrls = [0, 1, 2, 3].map(i => sprite(`flame${i}`).url);
  function flameOn(D) {
    const box = el('div', 'dz-dfire');
    for (let i = 0; i < 3; i++) {
      const im = pxImg(sprite('flame0'));
      box.append(im);
      cycle(im, flameUrls, 90, i);
    }
    D.el.append(box);
    return box;
  }

  // ───────── 이름표 · 구경꾼
  function buildPlate(s, key, mom) {
    const P = plates[s];
    const t = TECHS[key];
    P.replaceChildren();
    const top = el('div', 'dz-pl-top');
    top.append(el('span', 'dz-pl-icon', WEAPONS[t.w].icon), el('b', 'dz-pl-name', S.names[s]));
    const momRow = el('div', `dz-pl-mom${mom > 0 ? ' hot' : ''}`);
    if (mom > 0) {
      for (let i = 0; i < mom; i++) {
        const im = pxImg(sprite('flame0'));
        momRow.append(im);
        cycle(im, flameUrls, 110, i);
      }
    } else if (mom < 0) {
      for (let i = 0; i < -mom; i++) momRow.append(pxImg(sprite('cloud')));
    }
    momRow.append(el('span', null, `기세 ${mom > 0 ? '+' : ''}${mom}`));
    // 남은 주사위: 네 개가 이름표 폭에 들어가게 이것만 2배
    const diceRow = el('div', 'dz-pl-dice');
    plateMinis[s] = [];
    for (let i = 0; i < t.n; i++) {
      const box = el('span', 'dz-mdie');
      box.append(pxImg(dieFace(t.die, DICE[t.die].sides, 'idle'), 2));
      diceRow.append(box);
      plateMinis[s].push({ box, die: t.die });
    }
    P.append(top, el('div', 'dz-pl-tech', techText(key)), momRow, diceRow);
  }
  function plateBreak(s, slot) {
    const m = plateMinis[s][slot];
    if (!m) return;
    m.box.replaceChildren(pxImg(dieFace(m.die, 1, 'ghost'), 2));
    m.box.classList.add('broke');
  }

  function buildCrowd(list = []) {
    crowdEl.replaceChildren();
    const bots = [0, 1, 2, 3].map(i => list[i] || { name: '', side: null, amount: 0 });
    const order = [bots[0], bots[1], { name: '나', side: null, amount: 0, me: true }, bots[2], bots[3]];
    const heads = ['crowd0', 'crowd1', 'crowd3', 'crowd2', 'crowd0'];
    S.fans = order.map((f, i) => {
      const box = el('div', `dz-fan${f.me ? ' me' : ''}`);
      box.style.left = `${FAN_X[i]}px`;
      const chip = el('span', 'dz-chip');
      box.append(chip, pxImg(sprite(heads[i])), el('span', 'dz-fname', f.name));
      crowdEl.append(box);
      return { ...f, x: FAN_X[i], el: box, chip };
    });
    S.me = S.fans[2];
  }
  function setChip(fan, side, amount) {
    fan.side = side;
    fan.amount = amount;
    fan.chip.textContent = `${amount}냥`;
    fan.chip.style.background = CHIP[side];
    fan.chip.classList.add('on');
    fan.chip.classList.remove('ash');
  }
  function hopFans(side, big = false) {
    if (skipping) return;
    for (const f of S.fans) if (side === '*' || f.side === side) restart(f.el, big ? 'big' : 'hop');
  }

  // 장면 비우기 (새 승부 · 기다림)
  function resetScene() {
    clearDice();
    parts.length = 0;
    ctx.clearRect(0, 0, W, H);
    popLayer.replaceChildren();
    for (const s of SIDES) {
      T[s].box.className = `dz-total ${s} off`;
      T[s].near.textContent = '';
      T[s].need.textContent = '';
      plates[s].classList.add('off');
      bands[s].className = `dz-band ${s} off`;
      place(s, 0);
    }
    oddsBox.classList.add('off');
    say('');
    banner(null);
    settle(null);
    midEl.textContent = '';
    roundEl.textContent = '';
    countEl.classList.add('off');
    cutinEl.className = 'dz-cutin off';
    dimEl.style.opacity = '0';
    impactEl.style.opacity = '0';
    rimEl.classList.remove('on');
    S.tieRun = 0;
    card.classList.add('off');
    betEl.className = 'dz-panel dz-bet off';
    S.betOpen = false;
    idleEl.classList.add('off');
    letterbox(false);
    vig(0.25);
    Object.assign(cam, { z: 1, tz: 1, x: W / 2, y: H / 2, tx: W / 2, ty: H / 2, amp: 0, t: 0, dur: 0 });
    pileSet(0);
    S.broken = { a: 0, b: 0 };
    S.bet = null;
    sset('heart', false);
    sset('duck', false);
  }
  // 대면 없이 play()가 불려도 무대는 갖춘다
  function setStage(duel, crowd) {
    S.duel = duel;
    F.a.w = TECHS[duel.a].w;
    F.b.w = TECHS[duel.b].w;
    buildCrowd(crowd);
    buildPlate('a', duel.a, duel.momA);
    buildPlate('b', duel.b, duel.momB);
  }

  // ───────── B. 대면 (약 2.6초)
  async function doFaceoff(duel, { names: nm, crowd = [], odds = null } = {}) {
    if (nm) S.names = { ...nm };
    S.odds = odds;
    resetScene();
    setStage(duel, crowd);
    for (const s of SIDES) { pose(s, 'idle'); place(s, -DIR[s] * 560); }
    // 0: 화면 밖에서 미끄러져 들어와 착
    sfx('whoosh');
    await tween(350, p => { for (const s of SIDES) place(s, -DIR[s] * 560 * (1 - p)); }, stepped(4));
    for (const s of SIDES) dust(FOOT[s], RIDGE);
    shake(3, 120);
    await wait(50);
    // 400: 이름표가 떨어져 꽂힘
    for (const s of SIDES) { plates[s].classList.remove('off'); restart(plates[s], 'drop'); }
    sfx('slam');
    await wait(300);
    // 700: 기술 띠
    for (const s of SIDES) {
      bands[s].textContent = `${S.names[s]} · ${TECHS[duel[s]].name}`;
      bands[s].className = `dz-band ${s}`;
      restart(bands[s], 'in');
      pose(s, 'ready');
    }
    sfx('slam');
    shake(4, 140);
    say(`${S.names.a}의 ${TECHS[duel.a].name}, ${S.names.b}의 ${TECHS[duel.b].name}`);
    await wait(600);
    // 1300: 승률 막대가 가운데에서 시작 승률까지
    oddsBox.classList.remove('off');
    setOdds(0.5, 0, '');
    void oddsFill.offsetWidth;
    setOdds(duel.p0, 500, oddsText(duel.p0, true));
    sfx('swing', duel.p0 - 0.5);
    await wait(400);
    // 1700: 구경꾼 봇이 하나씩 엽전을 던져 건다
    for (const fan of S.fans) {
      if (fan.me) continue;
      if (fan.side) {
        const side = fan.side;
        fly(sprite('coin'), fan.x, 640, FOOT[side], RIDGE - 90, 460, 120, () => burst(FOOT[side], RIDGE - 90, 6, GLINT));
        setChip(fan, side, fan.amount);
        if (!skipping) restart(fan.el, 'hop');
        sfx('chip', 1);
      }
      await wait(200);
    }
    await wait(100);
  }

  // ───────── C. 내기 판 (그리기만)
  function drawBet(o) {
    const odds = o.odds || { a: 1, b: 1 };
    if (!S.betOpen) {
      S.betOpen = true;
      S.lastCount = 0;
      S.betSide = undefined;
      betEl.className = 'dz-panel dz-bet';
      restart(betEl, 'rise');
      say(''); // 판이 자막 띠에 닿는다
    }
    pickA.textContent = `← ${S.names.a} ×${odds.a}`;
    pickB.textContent = `${S.names.b} ×${odds.b} →`;
    const side = o.side || null;
    if (side !== S.betSide) {
      S.betSide = side;
      pickA.classList.toggle('on', side === 'a');
      pickB.classList.toggle('on', side === 'b');
      noneEl.classList.toggle('on', !side);
    }
    if (side) S.betIdx = o.all ? 2 : o.amount > 10 ? 1 : 0;
    amtEls.forEach((e, i) => e.classList.toggle('on', !!side && i === S.betIdx));
    const left = Math.max(0, o.left ?? 0);
    const total = o.total || 6000;
    timeBar.style.width = `${((left / total) * 100).toFixed(1)}%`;
    timeEl.classList.toggle('hurry', left <= 3000);
    const n = Math.ceil(left / 1000);
    if (n >= 1 && n <= 3 && n !== S.lastCount) {
      S.lastCount = n;
      sfx('count', n);
    }
    betPurse.replaceChildren('내 냥 ', el('b', null, `${o.purse ?? 0}냥`));
  }
  function closeBet(o) {
    if (S.betOpen) {
      S.betOpen = false;
      restart(betEl, 'fold');
      anim(240, p => { if (p >= 1) betEl.classList.add('off'); });
    }
    if (o.side && o.amount > 0 && S.me) {
      S.bet = { side: o.side, amount: o.amount, odds: o.odds?.[o.side] ?? 1 };
      setChip(S.me, o.side, o.amount);
      fly(sprite('coin'), W / 2, 450, FOOT[o.side], RIDGE - 90, 380, 100, () => burst(FOOT[o.side], RIDGE - 90, 8, GLINT));
      if (!skipping) restart(S.me.el, 'hop');
    } else {
      S.bet = null;
    }
    sset('bed', 0.15);
  }

  // ───────── D. 합 한 번: 감독이 고른 연출(P.mode)대로 공용 조각을 엮는다
  // 조각: 시작 · 던짐 · 공개 · 불꽃 · 부딪힘 · 깨짐 · 승률 · 정리. 값은 전부 기록 그대로, 바뀌는 건 순서와 박자뿐
  const QUICK = { 속공: true, 압살: true, 마무리: true };   // '제 N 합' 큰 글자 없이 빠르게
  const QUICK_LINES = ['치고받는다', '몰아친다', '한 합 더!', '빈틈이 없다'];
  const CRUSH_LINES = ['상대가 안 된다', '손도 못 쓴다', '압도한다'];
  const dieOf = (c, o) => c[o.side].dice.find(x => x.slot === o.slot);

  async function oneClash(c, prevP, P) {
    const no = c.no;
    const X = {
      no,
      P,
      f: 1 - Math.min(0.4, 0.08 * (no - 1)),          // 합이 거듭될수록 빨라짐 (결정적 순간은 빼고)
      over: !c.alive.a.length || !c.alive.b.length,
      base: Math.min(1.08, 1 + 0.015 * (no - 1)),
      quick: !!QUICK[P.mode],
      countered: false,
    };
    await opening(c, X, prevP);
    if (P.mode === '압살' || P.mode === '마무리') {
      await crushReveal(c, X);
      await events(c, X);
      settleSums(c);
      await crushStrike(c, X);
    } else {
      const throwMs = (X.quick ? 250 : 400) * X.f;
      throwAll(c, throwMs);
      await wait(throwMs);
      if (P.mode === '속공') await quickReveal(c, X);
      else if (P.pattern === '따라잡기') await chaseReveal(c, X);
      else await altReveal(c, X);
      await events(c, X);
      // 반격인데 불꽃 · 꺼짐으로 뒤집혀 이긴 경우: 여기서 외친다
      if (P.mode === '반격' && !X.countered) await counterCall(c.result, X);
      settleSums(c);
      if (P.mode === '속공') await wait(100 * X.f);
      await strike(c, X);
      await breakDice(c, X);
    }
    if (X.over) {
      setOdds(c.pA, 350);
      await wait(300);
      return true;
    }
    await oddsStep(c, prevP, X);
    await tidy(c, X);
    return false;
  }

  // 합 세기 'N합': 합마다 툭 오르고, 3합부터 커지고, 4합부터 붉게 떤다
  function bumpCount(no) {
    countTxt.textContent = `${no}합`;
    countEl.className = `dz-count${no >= 4 ? ' hot' : no >= 3 ? ' mid' : ''}`;
    if (!skipping) restart(countTxt, 'bump');
  }
  function dim(v) { dimEl.style.opacity = String(v); }
  function rim(on) { rimEl.classList.toggle('on', !!on); }

  // 1. 시작
  async function opening(c, X, prevP) {
    const { no, P } = X;
    clearDice();
    rim(S.tieRun >= 3);                                // 동수가 이어지는 동안은 붉은 테두리 그대로
    dim(0);
    bumpCount(no);
    roundEl.textContent = X.quick ? '' : `제 ${no} 합`;
    if (!X.quick) {
      if (!skipping) restart(roundEl, 'slam');
      later(900, () => { if (roundEl.textContent === `제 ${no} 합`) roundEl.textContent = ''; }); // 알리고 빠진다. 남는 건 'N합'
    }
    midEl.textContent = '';
    for (const s of SIDES) {
      pose(s, 'ready');
      place(s, 0);
      setSub(s, c[s].base, c[s].bonus);
      showSum(s, c[s].base + c[s].bonus);
      T[s].box.classList.remove('win', 'lose', 'off', 'surge');
      T[s].near.textContent = '';
      T[s].need.textContent = '';
    }
    S.lastLead = null;
    lead(true);
    vig(Math.min(0.65, 0.25 + 0.08 * no));
    pull(X.base);
    sfx('drum', no);
    sset('bed', clamp(0.2 + 0.12 * (no - 1) + 0.4 * (1 - Math.abs(prevP - 0.5) * 2), 0, 1));
    const seed = S.duel?.seed ?? 0;
    if (no === 1) say('첫 합!');
    else if (P.mode === '속공' && mix(seed, no, 1) < 0.5) say(QUICK_LINES[Math.floor(mix(seed, no, 2) * QUICK_LINES.length)]);
    await wait((X.quick ? 150 : 350) * X.f);
  }

  // 2. 던짐: 손에서 포물선 (구르는 그림만, 눈은 안 보인다)
  function throwSide(c, s, ms, arc = 150) {
    const list = [...c[s].dice].sort((x, y) => x.slot - y.slot);
    list.forEach((d, i) => {
      const D = makeDie(s, d.slot, c[s].die, rowX(s, i, list.length, c[s].die), ROW_Y);
      throwDie(D, FOOT[s] + DIR[s] * HAND.dx, RIDGE + HAND.dy, ms, true, arc);
    });
  }
  function throwAll(c, ms) {
    for (const s of SIDES) throwSide(c, s, ms);
    sfx('roll', c.a.dice.length + c.b.dice.length);
    shake(2, ms);
  }

  // 착: 진짜 눈으로. 빠른 연출에선 폭발 주사위도 옆에 6+6+3 이 한 번에 붙는다
  function landFace(D, d, k, loud = true) {
    if (!D) return;
    const faces = d.raw || d.faces;
    const sides = DICE[D.die].sides;
    const v = faces[0];
    const st = faceState(v, sides);
    setFace(D, v, st);
    sfx('land', v, sides, k);
    if (st === 'max') {
      if (!skipping) restart(D.el, 'glow');
      burst(D.x, D.y, 8, GLINT);
      if (loud) sfx('maxFace');
    }
    if (faces.length > 1) {
      D.stack.textContent = faces.join('+');
      burst(D.x, D.y - 20, 14, FIRE);
      if (!skipping) restart(D.el, 'hop');
      sfx('explode', faces.length - 1);
    }
  }

  // 3. 공개 — 속공: 양쪽이 거의 한꺼번에 (30ms 간격, A · B 번갈아), 두 합계가 같이 오른다
  async function quickReveal(c, X) {
    const by = s => [...c[s].dice].sort((x, y) => x.slot - y.slot).map(d => ({ s, d }));
    const la = by('a');
    const lb = by('b');
    const list = [];
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
      if (la[i]) list.push(la[i]);
      if (lb[i]) list.push(lb[i]);
    }
    for (let k = 0; k < list.length; k++) {
      const { s, d } = list[k];
      landFace(dice[s].get(d.slot), d, k, k === 0);
      if (k < list.length - 1) await wait(30);
    }
    await Promise.all(SIDES.map(s => countTo(s, rawTotal(c, s), 200)));
    lead();
  }

  // 3. 공개 — 번갈아: 작은 눈부터, 지고 있는 쪽 마지막. 느린 구르기는 감독이 허락할 때만
  async function altReveal(c, X) {
    const { order, lockAt, slow } = X.P;
    const lastI = order.length - 1;
    for (let k = 0; k < order.length; k++) {
      const o = order[k];
      const D = dice[o.side].get(o.slot);
      const big = slow && k === lastI;
      if (big) await slowRoll(D, X.base, '마지막 주사위!');
      await reveal(D, dieOf(c, o), k, big);
      lead();
      if (k < lastI) await wait(k >= lockAt ? 150 : Math.max(150, 260 * X.f)); // 이미 정해졌으면 빨리
    }
  }

  // 3. 공개 — 따라잡기: 목표 쪽이 한꺼번에 서고, 쫓는 쪽이 작은 눈부터 하나씩.
  // 절정은 넘거나 못 넘게 되는 바로 그 공개 (마지막 주사위가 아닐 수도 있다)
  async function chaseReveal(c, X) {
    const P = X.P;
    const tg = P.target;
    const ch = other(tg);
    const order = P.order;
    const first = c[tg].dice.length;
    const goal = rawTotal(c, tg);
    const maxL = maxLandedOf(c[ch].die);
    for (let k = 0; k < first; k++) landFace(dice[tg].get(order[k].slot), dieOf(c, order[k]), k, k === 0);
    shake(4, 160);
    await countTo(tg, goal, 200);
    lead();
    say(`${S.names[tg]} ${goal}! 넘을 수 있나`);
    let shown = c[ch].base + c[ch].bonus;
    let left = c[ch].dice.length;
    const needLabel = () => {
      const e = T[ch].need;
      const best = shown + left * maxL;
      const t = shown > goal ? '' : best > goal ? `${goal - shown + 1} 더!` : best === goal ? `동수까지 ${goal - shown}` : '';
      if (e.textContent === t) return;
      e.textContent = t;
      if (t && !skipping) restart(e, 'tick');
    };
    if (P.climax < first) await chaseCall(ch, P.lock, false, X);
    else needLabel();
    await wait(Math.max(150, 300 * X.f));
    for (let k = first; k < order.length; k++) {
      const o = order[k];
      const D = dice[ch].get(o.slot);
      const d = dieOf(c, o);
      const peak = k === P.climax;
      const extra = k > P.climax;                       // 넘었거나 모자란 뒤엔 '덤'으로 빨리
      if (peak && P.slow) await slowRoll(D, X.base, k === order.length - 1 ? '마지막 주사위!' : '여기서 갈린다');
      else if (peak && P.struggle) await struggle(D);
      await reveal(D, d, k, peak && P.slow);
      shown += landedOf(d);
      left--;
      lead();
      if (peak) await chaseCall(ch, P.lock, P.struggle, X);
      else if (!extra) needLabel();
      if (k < order.length - 1) await wait(extra ? 120 : Math.max(150, 260 * X.f));
    }
    T[ch].need.textContent = '';
  }

  // 따라잡기 절정: 넘었다 · 모자라다 · (발악 끝에) 어림없다. 반격은 크게
  async function chaseCall(ch, kind, struggled, X) {
    T[ch].need.textContent = '';
    const x = SUM_X[ch];
    const y = 176;
    if (kind === 'pass') {
      if (X.P.mode === '반격') { await counterCall(ch, X); return; }
      flash(COLOR[ch], 0.5, 220, true);
      pop(x, y, '넘었다!', 'ok');
      say(struggled ? '끝까지 버텨 넘었다!' : '넘었다!');
      sfx('lead');
      shake(5, 160);
    } else if (kind === 'short') {
      if (struggled) {
        pop(x, y, '어림없다', 'no');
        say('어림없다');
        sfx('thud');
      } else {
        pop(x, y, '모자라다', 'no');
        say(`${S.names[ch]}, 모자라다`);
        sfx('near');
      }
    } else {
      say('딱 맞았다');                                  // 불꽃 · 꺼짐 전엔 동수
    }
  }

  // 반격: 멈칫 → 약한 쪽 색 번쩍 → 가운데 '반격!' → 구경꾼 헉 → 함성
  async function counterCall(s, X) {
    X.countered = true;
    freeze(300);
    await wait(300);
    flash(COLOR[s], 0.6, 300, true);
    midEl.textContent = '반격!';
    if (!skipping) restart(midEl, 'slam');
    sfx('gasp');
    later(300, () => sfx('cheer', 0.8));
    hopFans(s, true);
    shake(8, 220);
    say(`${S.names[s]}의 반격!`);
    await wait(450);
  }

  // 발악: 가망이 거의 없는 마지막 주사위가 부들부들 떨며 한 번 더 튀어 오른다 (레터박스 · 심장 없음)
  async function struggle(D) {
    say('마지막 발악');
    if (D.cyc) D.cyc.period = 90;
    D.el.classList.add('quiver');
    await tween(300, p => moveDie(D, 0, -Math.round(180 * p * (1 - p))), stepped(6));
    D.el.classList.remove('quiver');
    moveDie(D, 0, 0);
  }

  // 결정적 주사위: 레터박스 · 당김 · 심장 · 느린 구르기 → 모서리에서 휘청 (그동안 눈은 하나도 안 보인다)
  async function slowRoll(D, base, line) {
    say(line);
    letterbox(true);
    pull(base * 1.06, D.x, D.y);
    vig(0.85);
    if (!skipping) {                                   // 건너뛰는 중엔 심장을 켜지 않는다 (켜자마자 한 번 쿵 한다)
      sset('duck', true);
      sset('heart', true, 1.4);
    }
    sfx('slow');
    await wait(200);
    if (D.cyc) D.cyc.period = 140;
    await wait(900);
    stopRoll(D);
    const fr = [dieTumble(D.die, 3).url, dieTumble(D.die, 0).url];
    for (const [i, dx] of [[0, 3], [1, -3], [0, 3], [1, -3]]) {
      D.im.src = fr[i];
      moveDie(D, dx, 0);
      await wait(120);
    }
    moveDie(D, 0, 0);
  }

  // 4. 불꽃 · 꺼짐 (공개가 다 끝난 뒤)
  async function events(c, X) {
    for (const s of SIDES) {
      if (!c[s].ev) continue;
      await wait(160 * X.f);
      await sideEvent(s, c[s].ev);
      lead();
    }
    if (c.twist) {
      freeze(180);
      await wait(180);
      const byFlame = c.a.ev?.type === 'flame' || c.b.ev?.type === 'flame';
      say(byFlame ? '불꽃이 판을 뒤집었다!' : '꺼진 기세가 판을 뒤집었다');
      shake(6, 200);
      sfx('near');
      await wait(450 * X.f);
    }
  }
  // 기록 그대로 맞춘다 (보여 준 값과 같다)
  function settleSums(c) {
    for (const s of SIDES) {
      showSum(s, c[s].total);
      T[s].need.textContent = '';
    }
    lead(true);
  }

  // 5. 부딪힘: 돌진 → 멈칫 → 번쩍 · 불똥 · 이긴 쪽 무기 효과
  async function strike(c, X) {
    const { no, P } = X;
    const r = c.result;
    const counter = P.mode === '반격';
    const quick = P.mode === '속공';
    const tempo = counter ? 0.6 : 1;                    // 반격은 느리게, 약한 쪽이 받아친다
    const dash = Math.round(W * 0.06);
    midEl.textContent = '';
    pose('a', 'strike');
    pose('b', 'strike');
    if (counter) {
      const l = other(r);
      await tween(120 / tempo, p => place(l, DIR[l] * dash * p), stepped(3));
      await tween(120, p => place(r, DIR[r] * dash * p), stepped(3));
    } else {
      await tween(quick ? 90 : 120, p => { place('a', dash * p); place('b', -dash * p); }, stepped(3));
    }
    const stop = quick ? 60 : counter ? 150 : 90;
    freeze(stop);                                        // 멈칫 (히트스톱)
    await wait(stop);
    flash(counter ? COLOR[r] : WHITE, counter ? 0.6 : 0.7, 160, true);
    sfx('clash', no, c.margin);
    if (r === 'tie') { await tieFx(c); return; }
    S.tieRun = 0;
    rim(false);
    const w = F[r].w;
    shake(Math.min(14, 4 + no + (c.margin <= 2 ? 6 : 0) + (w === 'hm' ? 4 : 0)), 250);
    burst(HIT.x, HIT.y, Math.round(Math.min(60, 24 + 6 * no) * (w === 'tw' ? 1.5 : 1)), SPARK);
    weaponFx(r);
    T[r].box.classList.add('win');
    T[other(r)].box.classList.add('lose');
    hopFans(r);
    if (c.margin === 1) {
      T[other(r)].near.textContent = '1 차이!';
      restart(T[other(r)].near, 'on');
      sfx('near');
      say('단 1 차이!');
    }
    await wait(((quick ? 200 : 450) * X.f) / tempo);
  }

  // 동수 (맞물림): 연속 수로 키운다
  async function tieFx(c) {
    const st = c.streak;
    S.tieRun = st;
    midEl.textContent = st >= 3 ? '사생결단' : st === 2 ? '또 동수!' : '동수!';
    if (!skipping) restart(midEl, 'slam');
    if (st >= 2) pull(1.08);
    rim(st >= 3);
    sfx('tie', st);
    say(st >= 3 ? '물러설 곳이 없다' : st === 2 ? '또 맞물렸다' : '칼날이 맞물렸다');
    shake(st >= 3 ? 14 : st === 2 ? 8 : 5, 400);
    for (let i = 0; i < 5; i++) {
      burst(HIT.x, HIT.y, st >= 2 ? 18 : 9, SPARK);
      await wait(80);
    }
    midEl.textContent = '';
  }

  // 6. 깨짐: 금 → 산산조각 → 불씨가 진 쪽 위력 글자로
  async function breakDice(c, X) {
    const crackMs = X.P.mode === '속공' ? 80 : 120;
    const shards = X.P.mode === '반격' ? 10 : 6;      // 반격은 센 쪽 주사위가 더 잘게
    for (const b of c.broke) {
      const D = dice[b.side].get(b.slot);
      const fin = X.over && !c.alive[b.side].length;   // 마지막 일격
      if (D) setFace(D, D.v || 1, 'crack');
      await wait(crackMs);
      if (fin) {
        freeze(200);
        await wait(200);
        flash(COLOR[other(b.side)], 0.6, 320, true);
      }
      breakOne(c, b, D, fin, shards);
      shake(fin ? 12 : 7, 220);
    }
  }
  // 주사위 하나 깨기 (기다림 없음): 조각 · 이름표 ✕ · 밀려남 · 불씨
  function breakOne(c, b, D, fin, shards = 6) {
    const win = other(b.side);
    const at = D ? { x: D.x, y: D.y } : { x: SUM_X[b.side], y: ROW_Y };
    if (D) shatterDie(D, shards);
    sfx('shatter');
    S.broken[b.side]++;
    plateBreak(b.side, b.slot);
    pose(b.side, fin ? 'down' : 'hurt');
    const x0 = F[b.side].x;
    const x1 = -DIR[b.side] * Math.round(W * 0.03);
    anim(160, p => place(b.side, x0 + (x1 - x0) * p), stepped(3));
    if (fin) {
      pose(win, 'win');
      return;
    }
    const left = c.alive[b.side].length;
    say(left === 1 ? `${S.names[b.side]}, 이제 하나 남았다` : `${S.names[b.side]} 주사위가 깨졌다`);
    // 불씨가 진 쪽 위력 글자로 날아가 독기가 붙는다
    const side = b.side;
    const bonus = RULE.BRK * S.broken[side];
    const base0 = c[side].base;
    fly(sprite('ember'), at.x, at.y, SUM_X[side], SUB_Y + 12, 420, 90, () => {
      setSub(side, base0, bonus);
      if (!skipping) restart(T[side].sub, 'blink');
      sfx('ember');
    });
  }

  // 3. 공개 — 압살: 센 쪽은 구르지 않고 위에서 쿵 (진짜 눈 그대로), 약한 쪽은 힘없이 굴러 떨어져 조금씩
  async function crushReveal(c, X) {
    const w = c.result;
    const l = other(w);
    const dropMs = 200 * X.f;
    const weakMs = 420 * X.f;
    throwSide(c, l, weakMs, 54);
    sfx('roll', c[l].dice.length);
    const list = [...c[w].dice].sort((x, y) => x.slot - y.slot);
    const Ds = list.map((d, i) => {
      const D = makeDie(w, d.slot, c[w].die, rowX(w, i, list.length, c[w].die), ROW_Y);
      stopRoll(D);
      const v = (d.raw || d.faces)[0];
      D.v = v;
      D.st = faceState(v, DICE[D.die].sides);
      D.im.src = dieFace(D.die, v, D.st).url;
      moveDie(D, 0, -320);
      return [D, d];
    });
    await tween(dropMs, p => { for (const [D] of Ds) moveDie(D, 0, -320 * (1 - p * p)); }, stepped(4));
    Ds.forEach(([D, d], k) => {
      moveDie(D, 0, 0);
      landFace(D, d, k, k === 0);
      dust(D.x - 15, D.y + D.h / 2);
      dust(D.x + 15, D.y + D.h / 2);
    });
    shake(8, 200);
    sfx('slam');
    showSum(w, rawTotal(c, w));
    T[w].box.classList.add('surge');
    lead();
    flinch(l);
    say(CRUSH_LINES[Math.floor(mix(S.duel?.seed ?? 0, X.no, 3) * CRUSH_LINES.length)]);
    await wait(Math.max(0, weakMs - dropMs));
    // 약한 쪽: 하나씩, 합계는 느리게
    const weak = [...c[l].dice].sort((x, y) => landedOf(x) - landedOf(y));
    for (let k = 0; k < weak.length; k++) {
      const d = weak[k];
      landFace(dice[l].get(d.slot), d, k, false);
      await countTo(l, T[l].v + landedOf(d), 220);
      await wait(80 * X.f);
    }
    lead();
  }

  // 5~6. 압살 · 마무리의 한 칼 → 금 · 산산조각이 한꺼번에
  // 검객 · 노름꾼: 일섬 (꿰뚫고 지나감) / 장사: 내리찍기 충격파 / 쌍검: 난도질 연타
  async function crushStrike(c, X) {
    const w = c.result;
    const l = other(w);
    const kind = F[w].w;
    const finale = X.P.mode === '마무리';
    if (finale) await cutIn(w);
    pose(w, 'strike');
    const gap = FOOT[l] - FOOT[w];
    if (kind === 'hm') {
      // 높이 뛰어 진 사람 앞에 내리꽂는다
      const dx = gap - DIR[w] * 170;
      await tween(260, p => place(w, dx * p, -800 * p * (1 - p)), stepped(5));
      freeze(90);
      await wait(90);
      if (!finale) flash(WHITE, 0.7, 160, true);
      sfx('clash', X.no, c.margin);
      shockwave(w, FOOT[l], RIDGE - 90);
      shake(14, 300);
      pose(l, 'hurt');
    } else if (kind === 'tw') {
      // 달려들어 몰아친다
      const dx = gap - DIR[w] * 150;
      await tween(110, p => place(w, dx * p), stepped(3));
      for (let i = 0; i < 5; i++) {
        xcut(w, FOOT[l] + (i % 2 ? 27 : -27), RIDGE - 150 + i * 15);
        sfx('hit', i + 1, false);
        shake(6 + i, 90);
        pose(l, 'hurt');
        await wait(60);
      }
      if (!finale) flash(WHITE, 0.6, 140, true);
      sfx('clash', X.no, c.margin);
    } else {
      // 일섬: 어두워지고 소리가 죽는다 → 꿰뚫고 지나간다 → 흰 선 → 정적 → 한꺼번에
      dim(0.55);
      if (!skipping) sset('duck', true);
      await wait(250);
      sset('duck', false);
      sfx('slice');
      fxEl(`dz-streak ${w}`, (FOOT.a + FOOT.b) / 2, RIDGE - 100, 400);
      await tween(90, p => place(w, (gap + DIR[w] * 110) * p), stepped(2));
      fxEl('dz-cut', ROW[l], ROW_Y, 700);
      pose(l, 'hurt');
      if (!skipping) sset('duck', true);
      await wait(200);                                   // 정적
      sset('duck', false);
      dim(0);
      sfx('clash', X.no, c.margin);
      if (kind === 'gb') fanArc(w, ROW[l], ROW_Y - 30);
    }
    S.tieRun = 0;
    T[w].box.classList.add('win');
    T[l].box.classList.add('lose');
    hopFans(w);
    for (const b of c.broke) {
      const D = dice[b.side].get(b.slot);
      if (D) setFace(D, D.v || 1, 'crack');
    }
    const smash = () => {
      for (const b of c.broke) breakOne(c, b, dice[b.side].get(b.slot), X.over && !c.alive[b.side].length, 8);
      shake(14, 320);
      burst(ROW[l], ROW_Y, 30, SPARK);
    };
    if (finale) {
      await impactFrame(smash);                          // 흰 1장 → (터짐) → 검은 1장
    } else {
      await wait(60);
      smash();
      flash(COLOR[w], 0.45, 240, true);
    }
    await wait((X.over ? 300 : 260) * X.f);           // 이긴 사람은 진 사람 뒤에 선 채로 (정리 때 돌아온다)
  }

  // 마무리 컷인: 이긴 쪽에서 띠가 밀려 들어와 기술 이름 + 실루엣 (400ms)
  async function cutIn(s) {
    cutinTxt.textContent = `${TECHS[S.duel[s]].name}!`;
    cutinImg.src = fighter(F[s].w, 'strike', s).url;
    cutinEl.className = `dz-cutin ${s}`;
    if (!skipping) restart(cutinEl, 'in');
    sfx('whoosh');
    sfx('slam');
    shake(4, 140);
    say(`${S.names[s]}의 ${TECHS[S.duel[s]].name}!`);
    await wait(400);
    cutinEl.classList.remove('in');
    if (!skipping) restart(cutinEl, 'out');
    later(160, () => cutinEl.classList.add('off'));
  }

  // 임팩트 프레임: 흰 화면 50ms → (그 사이 터짐) → 검은 화면 50ms. 마무리에서만, 한 번씩
  async function impactFrame(between) {
    if (skipping) { between(); return; }
    lastFlash = performance.now() + 300;               // 앞뒤로 다른 번쩍임이 붙지 않게
    impactEl.style.background = WHITE;
    impactEl.style.opacity = '0.7';
    await wait(50);
    between();
    impactEl.style.background = '#000';
    impactEl.style.opacity = '0.92';
    await wait(50);
    impactEl.style.opacity = '0';
  }

  // 7. 승률: 막대가 새 승률로 (빠른 연출은 안 기다리고 바로)
  async function oddsStep(c, prevP, X) {
    if (!X.quick) await wait(400 * X.f);
    const dp = c.pA - prevP;
    setOdds(c.pA, 350);
    if (Math.abs(dp) > 0.2) {
      if (!skipping) restart(oddsBox, 'flash');
      sfx('swing', dp);
      // 떨어진 쪽이 앞서던 쪽이면 '흐름' · '다 잡았는데', 원래 밀리던 쪽이면 기운다고만
      const gainer = dp > 0 ? 'a' : 'b';
      const wasFav = (gainer === 'a' ? 1 - prevP : prevP) >= 0.5;
      const flipped = (prevP - 0.5) * (c.pA - 0.5) < 0;
      say(!wasFav ? `${S.names[gainer]} 쪽으로 기운다` : flipped ? '흐름이 넘어갔다' : '다 잡았는데…');
    }
    if (S.bet) {
      const mine = S.bet.side === 'a' ? dp : -dp;
      if (mine < -0.2 && !skipping) {
        for (const fan of S.fans) if (fan.side === S.bet.side) restart(fan.el, 'flinch');
        sfx('gasp');
      }
    }
    const pot = c.pot;
    fly(sprite('coin'), HIT.x, 250, HIT.x, pileTop(pot) + 6, 300, 0, () => { pileSet(pot); sfx('chip', 1); });
    await wait((X.quick ? 200 : 350) * X.f);
  }

  // 8. 정리
  async function tidy(c, X) {
    pileSet(c.pot);
    letterbox(false);
    dim(0);
    pull(X.base);
    for (const s of SIDES) {
      slideHome(s, 180);
      pose(s, 'ready');
      T[s].box.classList.remove('win', 'lose', 'surge');
    }
    for (const m of [dice.a, dice.b]) for (const D of [...m.values()]) fadeDie(D);
    await wait((X.quick ? 200 : 250) * X.f);
  }

  async function reveal(D, d, k, big) {
    const faces = d.raw || d.faces;            // 불꽃 · 꺼짐 전에 처음 떨어진 눈부터
    const sides = DICE[D.die].sides;
    const v = faces[0];
    const st = faceState(v, sides);
    setFace(D, v, st);
    sfx('land', v, sides, k);
    if (big) {
      flash(COLOR[D.side], 0.5, 240, true);
      shake(5, 160);
      burst(D.x, D.y, 22, { ...SPARK, colors: [COLOR[D.side], WHITE] });
      sset('heart', false);
      sset('duck', false);
    }
    if (st === 'max') {
      if (!skipping) restart(D.el, 'glow');
      flash(GOLD, 0.25, 140);
      burst(D.x, D.y, 12, GLINT);
      sfx('maxFace');
    } else if (st === 'min') {
      sfx('minFace');
    }
    await countTo(D.side, T[D.side].v + v, 120);
    if (faces.length > 1) await explode(D, faces, 1);
  }

  // 폭발 주사위: 작은 주사위가 튀어 올라 다음 눈 → 옆에 6+6+3
  async function explode(D, faces, from) {
    const sides = DICE[D.die].sides;
    for (let j = from; j < faces.length; j++) {
      sfx('explode', j);
      say('터졌다! 한 번 더');
      shake(4, 160);
      burst(D.x, D.y - 20, 16, FIRE);
      if (!skipping) restart(D.el, 'hop');
      const m = el('div', 'dz-die');
      m.style.left = D.el.style.left;
      m.style.top = D.el.style.top;
      const im = pxImg(null);
      im.width = D.w;
      im.height = D.h;
      m.append(im);
      diceLayer.append(m);
      const cyc = cycle(im, tumbleUrls(D.die), 60, j);
      await tween(260, p => { m.style.transform = `translateY(${Math.round(-78 * easeOut(p))}px)`; });
      cyclers.delete(cyc);
      const v = faces[j];
      im.src = dieFace(D.die, v, faceState(v, sides)).url;
      if (!skipping) restart(m, 'land');
      sfx('land', v, sides, j);
      D.stack.textContent = faces.slice(0, j + 1).join('+');
      await countTo(D.side, T[D.side].v + v, 120);
      await wait(220);
      anim(140, p => {
        m.style.transform = `translateY(${Math.round(-78 * (1 - p))}px)`;
        m.style.opacity = String(1 - p);
        if (p >= 1) m.remove();
      });
      await wait(100);
    }
  }

  async function sideEvent(s, ev) {
    const D = dice[s].get(ev.slot);
    if (!D) return;
    const fromSum = sum(ev.from);
    if (ev.type === 'flame') {
      say('불꽃! 최대 눈');
      sfx('flame');
      const fire = flameOn(D);
      burst(D.x, D.y, 14, FIRE);
      await wait(400);
      fire.remove();
      D.stack.textContent = '';
      setFace(D, ev.to[0], 'max');
      if (!skipping) restart(D.el, 'glow');
      await countTo(s, T[s].v - fromSum + ev.to[0], 160);
      if (ev.to.length > 1) await explode(D, ev.to, 1);
    } else {
      say('기세가 꺼졌다');
      sfx('fizzle');
      burst(D.x, D.y - 10, 18, SMOKE);
      await wait(300);
      D.stack.textContent = '';
      setFace(D, 1, 'min');
      await countTo(s, T[s].v - fromSum + 1, 160);
    }
  }

  // ───────── E. 끝
  async function ending(duel) {
    const w = duel.winner;
    const l = other(w);
    const n = duel.clashes.length;
    // 1. 마지막 일격 뒤
    pose(w, 'win');
    pose(l, 'down');
    slideHome(w, 200);
    sset('heart', false);
    sset('duck', false);
    sset('bed', 0);
    letterbox(false);
    dim(0);
    rim(false);
    pull(1);
    vig(0.3);
    setOdds(w === 'a' ? 1 : 0, 350, `${S.names[w]} 승`);
    roundEl.textContent = '';
    midEl.textContent = '';
    countEl.classList.add('off');                     // 결과 카드 자리라 비운다 (끝 글자에 'N합 끝에'가 나온다)
    for (const s of SIDES) T[s].box.classList.add('off');
    for (const m of [dice.a, dice.b]) for (const D of [...m.values()]) fadeDie(D);
    banner(`${S.names[w]} 승!`, 'gold', `${n}합 끝에`);
    say(`${S.names[w]} 승리`);
    sfx('win');
    sfx('cheer', 0.6);
    hopFans(w);
    burst(FOOT[w], RIDGE - 150, 24, GLINT);
    await wait(1100);

    // 2. 특별 장면 (하나만)
    const pct = Math.max(1, Math.round(duel.pW0 * 100));
    if (duel.miracle) {
      flash(GOLD, 0.6, 1200, true);
      banner('기적!!', 'gold');
      confetti(120);
      hopFans('*', true);
      sfx('miracle');
      sfx('cheer', 1);
      say(`승률 ${pct}%가 이겼다`);
      await wait(1700);
    } else if (duel.upset) {
      banner('이변!', 'orange');
      hopFans('*');
      sfx('cheer', 0.8);
      say(`승률 ${pct}%가 이겼다`);
      await wait(1200);
    } else if (duel.comeback) {
      banner('역전!', 'lime');
      hopFans(w, true);
      sfx('comeback');
      say('뒤집었다!');
      await wait(1200);
    }
    banner(null);

    // 3. 추격
    await chase(duel, w, l);

    // 4. 정산
    settle(`추격 ${duel.dmg} + 판돈 ${duel.pot} = ${duel.pay}냥`);
    const coins = Math.min(20, duel.pay);
    for (let i = 0; i < coins; i++) {
      const fromPile = duel.pot > 0 && i % 3 === 2;
      const x0 = fromPile ? W / 2 : FOOT[l];
      const y0 = fromPile ? RIDGE - 24 : RIDGE - 60;
      fly(sprite('coin'), x0 + (Math.random() - 0.5) * 30, y0, FOOT[w] + (Math.random() - 0.5) * 30, RIDGE - 130, 420, 110,
        i === coins - 1 ? () => burst(FOOT[w], RIDGE - 130, 10, GLINT) : null, i * 40);
    }
    sfx('coins', coins);
    anim(500, p => { if (p >= 1) pileSet(0); });
    await wait(900);

    // 5. 내기 정산
    for (const fan of S.fans) {
      if (fan.me || !fan.side) continue;
      if (fan.side === w) {
        const o = S.odds?.[fan.side] ?? 1;
        pop(fan.x, 604, `+${Math.round(fan.amount * o) - fan.amount}냥`, 'cash');
        if (!skipping) restart(fan.el, 'hop');
      } else {
        fan.chip.classList.add('ash');
      }
    }
    const b = S.bet;
    if (b) {
      if (b.side === w) {
        const delta = Math.round(b.amount * b.odds) - b.amount;
        banner(`+${delta}냥!`, 'gold');
        flash(GOLD, 0.55, 500, true);
        rain(Math.min(90, Math.round(b.odds * 16)));
        if (!skipping) restart(S.me.el, 'big');
        if (b.odds >= 3) sfx('jackpot');
        else sfx('cheer', 0.7);
      } else {
        banner(`-${b.amount}냥`, 'red');
        S.me.el.classList.add('droop');
        S.me.chip.classList.add('ash');
        sfx('lose');
      }
      await wait(1500);
    } else {
      await wait(600);
    }
  }

  async function chase(duel, w, l) {
    const hits = duel.hits;
    if (!hits?.dice?.length) return;
    if (hits.ev) {
      const fl = hits.ev.type === 'flame';
      say(fl ? '불꽃! 최대 눈' : '기세가 꺼졌다');
      sfx(fl ? 'flame' : 'fizzle');
      burst(FOOT[w], RIDGE - 100, 24, fl ? FIRE : SMOKE);
      await wait(500);
    }
    say(`${S.names[w]}의 추격`);
    const sides = DICE[hits.die].sides;
    const tx = FOOT[l] + DIR[l] * 9;
    const ty = RIDGE - 60;
    const nHit = hits.dice.length;
    for (let k = 0; k < nHit; k++) {
      const d = hits.dice[k];
      const face = d.faces[0];
      const crit = face === sides;
      const D = makeDie('h', k, hits.die, tx, ty);
      throwDie(D, FOOT[w] + DIR[w] * HAND.dx, RIDGE + HAND.dy, 150, false);
      await wait(150);
      setFace(D, face, faceState(face, sides));
      shake(crit ? 12 : 6, 200);
      burst(tx, ty, crit ? 28 : 14, SPARK);
      pop(FOOT[l] + (k % 2 ? 30 : -30), RIDGE - 240, `-${d.v}`, 'dmg');
      pop(FOOT[w] - DIR[w] * 20, RIDGE - 270, `${k + 1}타${k === nHit - 1 ? '!' : ''}`, 'combo', Math.min(44, 22 + 11 * k));
      if (crit) pop(tx, ty - 70, '치명', 'crit');
      pose(l, 'hurt');
      anim(120, p => { if (p >= 1) pose(l, 'down'); });
      sfx('hit', k + 1, crit);
      await wait(230);
      fadeDie(D);
    }
    await wait(200);
  }

  function confetti(n) {
    for (let i = 0; i < n; i++) {
      add({ x: Math.random() * W, y: -10 - Math.random() * 260, vx: (Math.random() - 0.5) * 90, vy: 40 + Math.random() * 90, g: 110, t: 0, life: 3.4, c: CONFETTI[(Math.random() * CONFETTI.length) | 0] });
    }
  }
  function rain(n) {
    const s = sprite('coin_s');
    for (let i = 0; i < n; i++) {
      toss(s, Math.random() * W, -20 - Math.random() * 120, (Math.random() - 0.5) * 60, 60 + Math.random() * 120, { g: 700, life: 1.8, delay: i * 18 });
    }
  }

  async function doPlay(duel, opt) {
    if (opt.names) S.names = { ...opt.names };
    if (S.duel !== duel) {
      resetScene();
      setStage(duel, opt.crowd);
      for (const s of SIDES) { plates[s].classList.remove('off'); pose(s, 'ready'); }
      oddsBox.classList.remove('off');
    }
    S.bet = opt.bet || null;
    if (S.bet && S.me && !S.me.chip.classList.contains('on')) setChip(S.me, S.bet.side, S.bet.amount);
    setOdds(duel.p0, 0, oddsText(duel.p0));
    for (const s of SIDES) if (!bands[s].classList.contains('off')) restart(bands[s], 'out');
    idleEl.classList.add('off');
    card.classList.add('off');
    banner(null);
    settle(null);
    S.broken = { a: 0, b: 0 };
    S.tieRun = 0;
    pileSet(0);
    // 감독: 합마다 남은 주사위 · 깨진 수 · 직전 승률을 들고 가며, 합을 틀기 전에 연출을 고른다
    const direct = createDirector(duel);
    const log = [];
    window.__diceDirector = log;
    let p = duel.p0;
    for (const c of duel.clashes) {
      const P = direct(c);
      log.push({ no: P.no, mode: P.mode, pattern: P.pattern, xw: P.xw, flip: P.flip, slow: P.slow });
      const over = await oneClash(c, p, P);
      p = c.pA;
      if (over) break;
    }
    await ending(duel);
  }

  const quiet = e => { if (e !== CANCEL) throw e; };

  return {
    // A. 기다림
    idle() {
      begin();
      resetScene();
      buildCrowd([]);
      for (const s of SIDES) pose(s, 'idle');
      idleEl.classList.remove('off');
      sset('bed', 0);
    },
    async faceoff(duel, opt = {}) {
      begin();
      try { await doFaceoff(duel, opt); } catch (e) { quiet(e); }
    },
    bet(o) {
      if (!o) return;
      if (o.open) drawBet(o);
      else closeBet(o);
    },
    async play(duel, opt = {}) {
      skipping = false;
      try { await doPlay(duel, opt); } catch (e) { quiet(e); }
    },
    // F. 결과 카드
    result({ duel, bet, won = 0, delta = 0, purse = 0, names: nm } = {}) {
      if (!duel) return;
      const N = nm || S.names;
      banner(null);
      settle(null);
      say('');
      const w = duel.winner;
      const betLine = !bet
        ? el('p', null, '내 내기: 안 걸었다')
        : won > 0
          ? el('p', 'won', `내 내기: ${N[bet.side]} ${bet.amount}냥 → +${delta}냥 (×${bet.odds})`)
          : el('p', 'lost', `내 내기: ${N[bet.side]} ${bet.amount}냥 → 잃음`);
      card.replaceChildren(
        el('h2', null, `${N[w]} 승 · ${duel.clashes.length}합`),
        el('p', null, `추격 ${duel.dmg} + 판돈 ${duel.pot}`),
        betLine,
        el('p', 'purse', `내 냥 ${purse}`),
        el('p', 'hint', '스페이스 다음 · R 같은 승부 다시 · 1~8 시연'));
      card.classList.remove('off');
      restart(card, 'rise');
    },
    speed(mult) {
      spd = Math.max(0.1, Number(mult) || 1);
      stage.style.setProperty('--spd', String(spd));
    },
    // 끝까지 바로: 남은 기다림은 0, 마지막 상태(숫자 · 깨진 주사위 · 자세)는 그대로 맞춘다
    skip() {
      if (skipping) return;
      skipping = true;
      unfreeze();
      flushWaits();
      for (const t of [...tweens]) endTween(t);
      clearTimeout(flashTimer);
      cam.dur = 0;
      sset('heart', false);
      sset('duck', false);
    },
    destroy() {
      begin();
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      cyclers.clear();
      parts.length = 0;
      sset('heart', false);
      sset('duck', false);
      sset('bed', 0);
      stage.remove();
    },
  };
}
