// 주사위 합 시제품: 승부 한 번을 끝까지 틀어 준다. 방장 · 네트워크 없이 이 페이지 혼자 돈다 (proto/dice.html).
// 규칙은 dice-core.js, 연출은 dice-view.js, 소리는 dice-audio.js, 도트 그림은 dice-art.js.
// 흐름: 대면(faceoff) → 내기 6초 → 승부(play) → 정산(result). 값은 전부 runDuel 이 굴리고, 화면은 틀기만 한다.
import { h, digitOf, isTyping } from '../util.js';
import * as core from './dice-core.js';
import { TECHS, WEAPONS, RULE, runDuel, findSeed, revealOrder, oddsOf, labelOf, techText, makeRng } from './dice-core.js';
import { createDiceView, directDuel } from './dice-view.js';

// 소리 모듈이 없거나 깨져도 화면은 돈다: 아무 소리도 안 내는 대역으로 바꿔 낀다
const SILENT = new Proxy({ enabled: false, toggle: () => false }, { get: (t, k) => (k in t ? t[k] : () => {}) });
let createDiceAudio = () => SILENT;
try {
  ({ createDiceAudio } = await import('./dice-audio.js'));
} catch (err) {
  console.warn('dice-audio.js 를 못 불러와 소리 없이 돈다', err);
}

const NAMES = { a: '지우', b: '서연' };
const CROWD = ['민준', '하늘', '도윤', '유나'];
const BET_TIME = 6000;
const AMOUNTS = [10, 30, 'all']; // 숫자키 1 · 2 · 3
const START_PURSE = 100;

const lastDecides = c => {
  const r = revealOrder(c);
  return r.lockAt === r.order.length - 1;
};
// 시연용 대진: 조건에 맞는 씨앗을 처음 열 때 찾아 둔다 (값은 그대로 굴린 것, 고른 것뿐)
export const SCENARIOS = [
  { key: 'comeback', name: '역전', setup: { a: 'sw2', b: 'tw2' }, pred: d => d.clashes.length >= 4 && d.low < 0.2 && d.pW0 >= 0.3 && lastDecides(d.clashes.at(-1)) },
  { key: 'miracle', name: '기적', setup: { a: 'tw1', b: 'tw3' }, pred: d => d.winner === 'a' && d.clashes.length >= 4 },
  { key: 'ties', name: '동수', setup: { a: 'tw2', b: 'tw2' }, pred: d => d.clashes.some((c, i) => c.result === 'tie' && d.clashes[i + 1]?.result === 'tie') && d.clashes.length >= 4 },
  { key: 'boom', name: '폭발', setup: { a: 'gb3', b: 'sw3' }, pred: d => d.winner === 'a' && d.clashes.some(c => c.result === 'a' && c.a.dice.some(x => x.faces.length >= 4)) },
  { key: 'oneshot', name: '한 방', setup: { a: 'hm2', b: 'hm3' }, pred: d => d.clashes.length === 1 && d.winner === 'a' && d.clashes[0].margin <= 1 && lastDecides(d.clashes[0]) },
  { key: 'flame', name: '불꽃', setup: { a: 'sw2', b: 'gb2', momA: 3, momB: -1 }, pred: d => d.winner === 'a' && d.clashes.some(c => c.twist && c.result === 'a') && d.clashes.length >= 3 },
  // 7 · 8은 화면의 연출 감독과 같은 규칙으로 고른다
  { key: 'crush', name: '압살', setup: { a: 'sw3', b: 'tw1' }, pred: d => {
    const P = directDuel(d);
    return P.filter(p => p.mode === '압살').length >= 2 && P.at(-1).mode === '마무리';
  } },
  { key: 'counter', name: '반격', setup: { a: 'tw2', b: 'sw2' }, pred: d => d.clashes.length >= 3 && directDuel(d).some((p, i) => p.mode === '반격' && !d.clashes[i].twist) },
];

const TECH_KEYS = Object.keys(TECHS);
const DECK_POOL = TECH_KEYS.flatMap(k => Array({ 1: 3, 2: 2, 3: 1 }[TECHS[k].tier]).fill(k));

function crowdBets(duel) {
  // 구경꾼 봇: 높은 쪽 60% · 낮은 쪽 25% · 안 걸기 15% (씨앗에서 정해져서 다시 보기도 같다)
  const rng = makeRng((duel.seed ^ 0x9e3779b9) >>> 0);
  const fav = duel.p0 >= 0.5 ? 'a' : 'b';
  const dog = fav === 'a' ? 'b' : 'a';
  return CROWD.map(name => {
    const u = rng();
    const side = u < 0.6 ? fav : u < 0.85 ? dog : null;
    const amount = [10, 20, 30][Math.floor(rng() * 3)];
    return { name, side, amount: side ? amount : 0 };
  });
}

function oddsPair(duel) {
  return { a: oddsOf(duel.p0), b: oddsOf(1 - duel.p0) };
}

export function boot(root) {
  const audio = createDiceAudio();
  const stage = h('div', { class: 'dz-stage-wrap' });
  const purseEl = h('b', { class: 'dz-purse' });
  const hintEl = h('div', { class: 'dz-hint' });
  const scBtns = SCENARIOS.map((s, i) => h('button', { class: 'dz-btn', type: 'button', tabindex: '-1', onclick: () => startScenario(i) }, `${i + 1} ${s.name}`));
  const sel = (side, kind) => {
    const opts = kind === 'tech'
      ? TECH_KEYS.map(k => h('option', { value: k }, `${WEAPONS[TECHS[k].w].icon} ${techText(k)}`))
      : [-3, -2, -1, 0, 1, 2, 3].map(m => h('option', { value: String(m) }, `기세 ${m > 0 ? '+' : ''}${m}`));
    return h('select', { class: 'dz-sel', tabindex: '-1', 'data-side': side, 'data-kind': kind }, opts);
  };
  const pick = { aTech: sel('a', 'tech'), aMom: sel('a', 'mom'), bTech: sel('b', 'tech'), bMom: sel('b', 'mom') };
  pick.aTech.value = 'sw2';
  pick.bTech.value = 'hm1';
  pick.aMom.value = '0';
  pick.bMom.value = '0';
  const goBtn = h('button', { class: 'dz-btn go', type: 'button', tabindex: '-1', onclick: () => startCustom() }, '이 대진으로');
  const speedBtn = h('button', { class: 'dz-btn', type: 'button', tabindex: '-1', onclick: () => toggleSpeed() });
  const soundBtn = h('button', { class: 'dz-btn', type: 'button', tabindex: '-1', onclick: () => toggleSound() });
  const resetBtn = h('button', { class: 'dz-btn', type: 'button', tabindex: '-1', onclick: () => { purse = START_PURSE; paint(); } }, '냥 되돌리기');
  const bar = h('header', { class: 'dz-bar' },
    h('div', { class: 'dz-title' }, '🎲 주사위 합', h('small', null, ' 시제품')),
    h('div', { class: 'dz-group' }, ...scBtns),
    h('div', { class: 'dz-group' },
      h('span', { class: 'dz-tag' }, NAMES.a), pick.aTech, pick.aMom,
      h('span', { class: 'dz-vs' }, 'vs'),
      h('span', { class: 'dz-tag' }, NAMES.b), pick.bTech, pick.bMom, goBtn),
    h('div', { class: 'dz-group right' }, h('span', null, '내 냥 '), purseEl, resetBtn, speedBtn, soundBtn));
  root.append(h('div', { class: 'dz-app' }, bar, stage, hintEl));

  const view = createDiceView(stage, { audio, names: NAMES });
  let purse = START_PURSE;
  let state = 'idle'; // idle · faceoff · bet · play · result
  let duel = null;
  let setup = null;
  let crowd = [];
  let bet = null;
  let betTimer = null;
  let betDone = null;
  let fast = false;
  const seeds = new Map();
  let randomNo = 1;

  function paint() {
    purseEl.textContent = `${purse}냥`;
    speedBtn.textContent = fast ? 'F 빠르게 ✓' : 'F 빠르게';
    soundBtn.textContent = audio.enabled ? 'M 소리 켬' : 'M 소리 끔';
    const busy = state === 'faceoff' || state === 'bet' || state === 'play';
    for (const b of [...scBtns, goBtn]) b.disabled = busy;
    hintEl.textContent = {
      idle: '스페이스 = 아무 대진 · 숫자키 1~8 = 시연 대진 · 위에서 직접 고르기',
      faceoff: '',
      bet: '← 지우에게 · → 서연에게 · ↓ 안 건다 · 1 · 2 · 3 = 10냥 · 30냥 · 올인 · 스페이스 = 확정',
      play: 'S = 끝까지 빨리',
      result: '스페이스 = 다음 대진 · R = 같은 승부 다시 · 숫자키 = 시연 대진',
    }[state];
  }

  function amountOf(b) {
    if (!b?.side) return 0;
    const a = AMOUNTS[b.amountIdx];
    return Math.max(0, Math.min(purse, a === 'all' ? purse : a));
  }

  async function run(s) {
    if (state === 'faceoff' || state === 'bet' || state === 'play') return;
    setup = s;
    duel = runDuel(s);
    window.__dice.duel = duel;
    crowd = crowdBets(duel);
    state = 'faceoff';
    paint();
    view.speed(fast ? 2.2 : 1);
    await view.faceoff(duel, { names: NAMES, crowd, odds: oddsPair(duel) });
    // 내기
    state = 'bet';
    bet = { side: null, amountIdx: 0, locked: false, until: performance.now() + BET_TIME };
    paint();
    await new Promise(resolve => {
      betDone = resolve;
      // rAF는 뒤 탭에서 멈춰서, 내기 시계는 보통 타이머로 잰다
      const tick = () => {
        const left = Math.max(0, bet.until - performance.now());
        view.bet({ open: true, side: bet.side, amount: amountOf(bet), all: AMOUNTS[bet.amountIdx] === 'all', odds: oddsPair(duel), purse, left, total: BET_TIME });
        if (left <= 0 || bet.locked) lockBet();
      };
      betTimer = setInterval(tick, 50);
      tick();
    });
    const odds = oddsPair(duel);
    const mine = bet.side && amountOf(bet) > 0 ? { side: bet.side, amount: amountOf(bet), odds: odds[bet.side] } : null;
    view.bet({ open: false, side: mine?.side || null, amount: mine?.amount || 0, odds, purse });
    if (mine) purse -= mine.amount;
    state = 'play';
    paint();
    await view.play(duel, { bet: mine, crowd, names: NAMES });
    let won = 0;
    if (mine && duel.winner === mine.side) won = Math.round(mine.amount * mine.odds);
    purse += won;
    state = 'result';
    paint();
    view.result({ duel, bet: mine, won, delta: mine ? won - mine.amount : 0, purse, names: NAMES });
  }

  function lockBet() {
    if (!bet || !betDone) return;
    clearInterval(betTimer);
    bet.locked = true;
    const done = betDone;
    betDone = null;
    if (bet.side && amountOf(bet) > 0) audio.betLock?.();
    done();
  }

  function startScenario(i) {
    const sc = SCENARIOS[i];
    if (!sc) return;
    if (!seeds.has(sc.key)) seeds.set(sc.key, findSeed(sc.setup, sc.pred, 1, 60000) || 1);
    const s = { momA: 0, momB: 0, ...sc.setup, seed: seeds.get(sc.key) };
    syncPickers(s);
    void run(s);
  }
  function startRandom() {
    // 아무 대진: 덱 비율대로 아무 기술, 기세는 −1 ~ +2
    const rng = makeRng((Date.now() ^ (randomNo++ * 2654435761)) >>> 0);
    const any = () => DECK_POOL[Math.floor(rng() * DECK_POOL.length)];
    const mom = () => [-1, 0, 0, 1, 1, 2][Math.floor(rng() * 6)];
    const s = { a: any(), b: any(), momA: mom(), momB: mom(), seed: 1 + Math.floor(rng() * 2 ** 31) };
    syncPickers(s);
    void run(s);
  }
  function startCustom() {
    const s = { a: pick.aTech.value, b: pick.bTech.value, momA: Number(pick.aMom.value), momB: Number(pick.bMom.value), seed: 1 + Math.floor(Math.random() * 2 ** 31) };
    void run(s);
  }
  function replay() {
    if (setup) void run({ ...setup });
  }
  function syncPickers(s) {
    pick.aTech.value = s.a;
    pick.bTech.value = s.b;
    pick.aMom.value = String(s.momA || 0);
    pick.bMom.value = String(s.momB || 0);
  }
  function toggleSpeed() {
    fast = !fast;
    view.speed(fast ? 2.2 : 1);
    paint();
  }
  function toggleSound() {
    audio.toggle();
    paint();
  }

  const unlock = () => void audio.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', e => {
    unlock();
    if (isTyping(e) || e.repeat) return;
    const d = digitOf(e);
    if (state === 'bet') {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { bet.side = 'a'; audio.tick?.(); }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { bet.side = 'b'; audio.tick?.(); }
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') { bet.side = null; audio.tick?.(); }
      else if (d >= 1 && d <= 3) { bet.amountIdx = d - 1; audio.tick?.(); }
      else if (e.code === 'Space') lockBet();
      else return;
      e.preventDefault();
      return;
    }
    if (state === 'play') {
      if (e.code === 'KeyS') { view.skip(); e.preventDefault(); }
      return;
    }
    if (state === 'faceoff') return;
    if (e.code === 'Space') { startRandom(); e.preventDefault(); }
    else if (e.code === 'KeyR') replay();
    else if (d >= 1 && d <= SCENARIOS.length) startScenario(d - 1);
    else if (e.code === 'KeyF') toggleSpeed();
    else if (e.code === 'KeyM') toggleSound();
  });

  window.__dice = { core, view, audio, duel: null, SCENARIOS };
  paint();
  view.idle?.();
  return { view, audio };
}

boot(document.getElementById('app'));
