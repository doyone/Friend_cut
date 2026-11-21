// 주사위 대장간 시제품: 나 + 봇으로 한 판을 끝까지 돈다. 방장 · 네트워크 없이 이 페이지 혼자 (proto/forge.html).
// 규칙은 forge-core.js, 화면은 forge-view.js, 소리는 주사위 합 것(dice-audio.js), 주사위 그림은 dice-art.js.
// 흐름: 무기 고르기 → [강화 25초 → 공개 → 대결(모든 쌍이 동시에) → 정산] × 끝까지 남은 한 명
import { digitOf, isTyping } from '../util.js';
import * as core from './forge-core.js';
import { RULE, GAMBLES, AUGS, TIER_NAME, WEAPON_KEYS } from './forge-core.js';
import { createForgeView } from './forge-view.js';

// 소리 모듈이 없거나 깨져도 화면은 돈다
const SILENT = new Proxy({ enabled: false, toggle: () => false }, { get: (t, k) => (k in t ? t[k] : () => {}) });
let createDiceAudio = () => SILENT;
try {
  ({ createDiceAudio } = await import('./dice-audio.js'));
} catch (err) {
  console.warn('dice-audio.js 를 못 불러와 소리 없이 돈다', err);
}

const NAMES = ['나', '지우', '서연', '민준', '하늘', '도윤', '유나', '준호'];
const ME = 0;
const SLOT_KEYS = [1, 2, 3, 5]; // 상점 칸 숫자키 (4 = 단 올리기, 5 = 🦊 여우 칸)

export function boot(root) {
  const audio = createDiceAudio();
  const view = createForgeView(root, { audio });
  let count = 6;
  try { count = Math.max(2, Math.min(8, Number(localStorage.getItem('forge-count')) || 6)); } catch { /* 저장 못 해도 괜찮다 */ }
  let game = null;
  let state = 'title'; // title · weapon · shop · ghost · reveal · fight · settle · over
  let fast = false;
  let auto = false;
  let weaponPick = null;
  let myReady = false;
  let msg = '';
  let ready = new Set();
  let botTimers = [];
  let endPhase = null;
  let phaseLeft = 0;
  let runId = 0;

  const me = () => game.players[ME];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const meReady = () => myReady || (auto && ready.has(ME));

  // 시간이 다 되거나, done()이 참이 되거나, endPhase()가 불리면 끝
  function phase(ms, done, onTick) {
    return new Promise(resolve => {
      const end = performance.now() + ms;
      let lastSec = 99;
      let forced = false;
      const iv = setInterval(step, 100);
      function step() {
        phaseLeft = Math.max(0, end - performance.now());
        onTick?.(phaseLeft);
        const sec = Math.ceil(phaseLeft / 1000);
        if ((state === 'shop' || state === 'ghost') && sec <= 3 && sec >= 1 && sec < lastSec) audio.count(sec);
        lastSec = Math.min(lastSec, sec);
        if (forced || phaseLeft <= 0 || done()) {
          clearInterval(iv);
          endPhase = null;
          resolve();
        }
      }
      endPhase = () => { forced = true; step(); };
      step();
    });
  }

  function refreshTop(target = null) {
    if (!game) return;
    const r = new Set([...ready].filter(id => id !== ME));
    if (meReady()) r.add(ME);
    const shopping = state === 'shop' || state === 'ghost';
    view.top(game, { me: ME, ready: shopping ? r : null, target, hide: shopping });
  }

  // 화면에 넘길 빌드 정보 (bet: true · false · null=모름)
  function sideInfo(f, { bet } = {}) {
    return { name: f.name, w: f.b.w, tier: f.b.tier, dice: core.diceOf(f.b), gamble: f.b.gamble, bet: bet === undefined ? !!f.b.bet : bet, augs: [...f.b.augs], mom: f.mom || 0, shadow: !!f.shadow };
  }

  function pairsText() {
    return game.pairs.map(pr => ({
      a: game.players[pr.a].name,
      b: pr.b === null ? pr.shadow.name : game.players[pr.b].name,
    }));
  }

  function drawShop() {
    const p = me();
    const opp = core.visibleOpp(game, ME);
    const mine = core.fighterOf(game, ME);
    const pNow = opp ? core.winChance(mine, opp) : null;
    const pOf = b => (opp ? core.winChance(core.fighterOf(game, ME, b), opp) : null);
    const items = p.shop.map((s, i) => {
      const inf = core.slotInfo(s);
      const cost = core.slotCost(p.b, s);
      return {
        key: String(SLOT_KEYS[i]), icon: inf.icon, name: inf.name, text: inf.text, cost, afford: p.gold >= cost, sold: s.sold,
        p: s.sold ? null : pOf(core.applySlotTo(p.b, s).b), kind: s.t, tier: inf.tier,
        tierName: s.t === 'aug' ? TIER_NAME[inf.tier] : '',
      };
    });
    const up = core.tierUpOf(p.b);
    const tier = up
      ? { text: core.tierUpText(p.b), cost: RULE.TIER_COST[p.b.tier + 1], afford: p.gold >= RULE.TIER_COST[p.b.tier + 1], p: pOf(up) }
      : { max: true };
    const seen = !!opp && !opp.shadow && core.has(p.b, 'seer');
    view.shop({
      round: game.round, gold: p.gold, income: p.income, items, tier,
      bet: { has: !!p.b.gamble, on: !!p.b.bet, icon: p.b.gamble ? GAMBLES[p.b.gamble].icon : '', name: p.b.gamble ? GAMBLES[p.b.gamble].name : '' },
      p: pNow, me: sideInfo(mine), opp: opp ? sideInfo(opp, { bet: opp.shadow || seen ? !!opp.b.bet : null }) : null, oppSeen: seen,
      msg, ready: myReady, left: phaseLeft || RULE.SHOP_TIME, total: RULE.SHOP_TIME, pairs: pairsText(),
    });
  }

  function drawGhost() {
    const targets = game.players.map((p, i) => ({ id: p.id, no: i + 1, name: p.name, hp: p.hp, alive: p.alive })).filter(t => t.alive);
    view.ghost({ targets, target: me().curse, left: phaseLeft || RULE.SHOP_TIME, total: RULE.SHOP_TIME, pairs: pairsText() });
    refreshTop(me().curse);
  }

  function boughtText(p) {
    return p.bought.map(x => {
      if (x.k === 'tier') return `⬆️ ${x.to}단`;
      if (x.k === 'whet') return '🔨 숫돌';
      if (x.k === 'gamble') return `${GAMBLES[x.key].icon} ${GAMBLES[x.key].name}`;
      return `${AUGS[x.key].icon} ${AUGS[x.key].name}${x.dropped ? ` (${AUGS[x.dropped].name} 버림)` : ''}`;
    });
  }

  function drawReveal() {
    const rows = game.players.filter(p => p.alive).map(p => ({
      name: p.name, me: p.id === ME, items: boughtText(p),
      bet: p.b.gamble ? `${GAMBLES[p.b.gamble].icon} ${p.b.bet ? '건다' : '안 건다'}` : '',
    }));
    const pr = core.pairOf(game, ME);
    let mineInfo = null;
    let oppInfo = null;
    let p = null;
    if (pr && me().alive) {
      const mine = core.fighterOf(game, ME);
      const opp = pr.b === null ? null : core.fighterOf(game, pr.a === ME ? pr.b : pr.a);
      const oppF = opp || core.visibleOpp(game, ME);
      mineInfo = sideInfo(mine);
      oppInfo = sideInfo(oppF);
      p = core.winChance(mine, oppF, core.TRIALS.p0);
    }
    view.reveal({ rows, me: mineInfo, opp: oppInfo, p });
  }

  function settleRows(res) {
    const rows = [];
    for (const n of res.notes) {
      if (n.out) { rows.push({ text: `💀 ${n.out} 탈락 · ${n.place}등`, cls: 'out' }); continue; }
      if (n.shadow && n.loserHp == null) rows.push({ text: `${n.winner} 승 (상대: ${n.loser}) · 냥 +${RULE.SHADOW_WIN}`, cls: n.winner === me().name ? 'good' : '' });
      else {
        const extra = [n.back ? `🪃 ${n.winner} −${n.back}` : '', n.heal ? `🧛 ${n.winner} +${n.heal}` : '', n.bounty ? `💰 현상금 +${n.bounty}` : ''].filter(Boolean).join(' · ');
        rows.push({ text: `${n.winner} 승 → ${n.loser} 체력 −${n.dmg} (남은 ${Math.max(0, n.loserHp)})${extra ? ` · ${extra}` : ''}`, cls: n.loser === me().name ? 'hurt' : n.winner === me().name ? 'good' : '' });
      }
    }
    return rows;
  }

  async function runGame() {
    const my = ++runId;
    const seed = (Date.now() ^ Math.floor(Math.random() * 2 ** 31)) >>> 0;
    game = core.newGame({ names: NAMES.slice(0, count), human: ME, seed });
    window.__forge.game = game;
    const rng = core.makeRng(seed ^ 0x5bd1e995);
    // 무기
    state = 'weapon';
    weaponPick = null;
    view.top(game, { me: ME });
    await phase(RULE.WEAPON_TIME, () => weaponPick != null || auto, left => view.weapon({ left, total: RULE.WEAPON_TIME, pick: weaponPick }));
    if (my !== runId) return;
    view.weapon({ left: 0, total: RULE.WEAPON_TIME, pick: weaponPick });
    for (const p of game.players) {
      const w = p.id === ME && weaponPick ? weaponPick : WEAPON_KEYS[Math.floor(rng() * WEAPON_KEYS.length)];
      core.pickWeapon(game, p.id, w);
    }
    await sleep(fast ? 200 : 500);

    while (!game.over) {
      if (my !== runId) return;
      core.beginRound(game);
      msg = '';
      myReady = false;
      ready = new Set();
      // 봇: 바로 사고 · 걸고 · 저주하고, 준비 완료는 조금 뒤에 (고민하는 척)
      const botIds = game.players.filter(p => p.id !== ME || auto).map(p => p.id);
      for (const id of botIds) if (game.players[id].alive) core.botShop(game, id, rng);
      for (const id of botIds) {
        if (game.players[id].alive) core.botBet(game, id);
        else core.botCurse(game, id);
      }
      for (const id of botIds) {
        const delay = (1200 + rng() * 6000) / (fast ? 3 : 1);
        botTimers.push(setTimeout(() => { ready.add(id); refreshTop(state === 'ghost' ? me().curse : null); }, delay));
      }
      state = me().alive ? 'shop' : 'ghost';
      phaseLeft = RULE.SHOP_TIME;
      refreshTop();
      if (state === 'shop') drawShop();
      else drawGhost();
      const allReady = () => game.players.every(p => (p.id === ME ? meReady() : ready.has(p.id)));
      await phase(RULE.SHOP_TIME, allReady, left => view.tickTimer(left, RULE.SHOP_TIME));
      botTimers.forEach(clearTimeout);
      botTimers = [];
      if (my !== runId) return;
      // 공개
      state = 'reveal';
      refreshTop();
      drawReveal();
      await sleep(fast ? 900 : 2000);
      if (my !== runId) return;
      // 대결
      const res = core.resolveRound(game);
      state = 'fight';
      let featured = res.fights.findIndex(f => f.a.id === ME || f.b.id === ME);
      if (featured < 0) {
        // 유령이면 대결 '전' 체력 1등의 대결을 크게 (정산 뒤 체력으로 고르면 결과가 샌다)
        const hp = f => Math.max(f.a.shadow ? -1 : f.a.hp ?? -1, f.b.shadow ? -1 : f.b.hp ?? -1);
        featured = res.fights.reduce((best, f, i) => (hp(f) > hp(res.fights[best]) ? i : best), 0);
      }
      window.__forge.last = res;
      await view.fights(res.fights, { featured });
      if (my !== runId) return;
      // 정산
      state = 'settle';
      refreshTop();
      const p = me();
      view.settle({ rows: settleRows(res), mine: p.alive ? `내 냥 ${p.gold} · 체력 ${p.hp}` : `👻 ${p.place}등 · 다음 라운드엔 저주를 건다`, hint: '스페이스 = 다음 라운드' });
      await phase(auto || fast ? 1500 : 4000, () => false);
    }
    if (my !== runId) return;
    state = 'over';
    refreshTop();
    drawOver();
  }

  function drawOver(quiet = false) {
    view.over({
      rows: core.standings(game).map(p => ({ place: p.place, name: p.name, hp: p.hp, w: p.w, tier: p.b.tier, augs: p.b.augs, gamble: p.b.gamble, me: p.id === ME })),
      titles: core.titles(game),
      hint: `스페이스 = 다시 하기 · ← → 인원 (${count}명)`,
      quiet,
    });
  }

  function act(a) {
    const r = core.buy(game, ME, a);
    msg = r.msg;
    if (r.ok) {
      if (a.t === 'slot' || a.t === 'tier') audio.chip(3);
      else audio.tick();
    } else audio.thud?.();
    drawShop();
    refreshTop();
  }

  const unlock = () => void audio.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', e => {
    unlock();
    if (isTyping(e) || e.repeat) return;
    const d = digitOf(e);
    if (e.code === 'KeyM') { audio.toggle(); view.toast(audio.enabled ? '소리 켬' : '소리 끔'); e.preventDefault(); return; }
    if (e.code === 'KeyF') { fast = !fast; view.speed(fast ? 2.2 : 1); view.toast(fast ? '빠르게' : '보통 빠르기'); e.preventDefault(); return; }
    if (e.code === 'KeyA' && state !== 'title' && state !== 'over') {
      auto = !auto;
      view.toast(auto ? '나도 봇 (자동)' : '자동 끔');
      if (auto && state === 'shop') { core.botShop(game, ME, Math.random); core.botBet(game, ME); myReady = true; drawShop(); }
      if (auto && state === 'ghost') { core.botCurse(game, ME); myReady = true; drawGhost(); }
      refreshTop(state === 'ghost' ? me().curse : null);
      if (auto && state === 'weapon') endPhase?.();
      e.preventDefault();
      return;
    }
    switch (state) {
      case 'title':
      case 'over':
        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
          count = Math.max(2, Math.min(8, count + (e.code === 'ArrowLeft' ? -1 : 1)));
          try { localStorage.setItem('forge-count', String(count)); } catch { /* 괜찮다 */ }
          audio.tick();
          if (state === 'title') view.title({ count });
          else drawOver(true);
        } else if (e.code === 'Space') void runGame();
        else return;
        break;
      case 'weapon':
        if (game?.players[ME].w) return; // 이미 정해졌다 (넘어가는 중)
        if (d >= 1 && d <= 4) {
          weaponPick = WEAPON_KEYS[d - 1];
          audio.betLock();
          view.weapon({ left: phaseLeft, total: RULE.WEAPON_TIME, pick: weaponPick });
        } else return;
        break;
      case 'shop': {
        const si = SLOT_KEYS.indexOf(d);
        if (si >= 0 && si < me().shop.length) act({ t: 'slot', i: si });
        else if (d === 4) act({ t: 'tier' });
        else if (e.code === 'KeyR') act({ t: 'reroll' });
        else if (e.code === 'KeyG') act({ t: 'bet' });
        else if (e.code === 'Backspace') act({ t: 'undo' });
        else if (e.code === 'Space') {
          myReady = !myReady;
          if (myReady) audio.betLock(); else audio.tick();
          msg = myReady ? '준비 완료 — 다른 사람을 기다린다' : '준비 취소';
          drawShop();
          refreshTop();
        } else return;
        break;
      }
      case 'ghost': {
        const t = game.players[d - 1];
        if (d >= 1 && t && t.alive) {
          core.curse(game, ME, t.id);
          audio.fizzle();
          drawGhost();
        } else if (e.code === 'Space') {
          myReady = !myReady;
          audio.tick();
          refreshTop(me().curse);
        } else return;
        break;
      }
      case 'fight':
        if (e.code === 'KeyS') view.skip();
        else return;
        break;
      case 'settle':
        if (e.code === 'Space') endPhase?.();
        else return;
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  window.__forge = { core, view, audio, game: null, last: null, simulate: core.simulate, get state() { return state; } };
  view.title({ count });
  return { view, audio };
}

boot(document.getElementById('app'));
