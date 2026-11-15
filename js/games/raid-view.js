// 독박 원정대 화면 — 1차 임시 화면: 그림 없이 상자와 글자로. 규칙은 raid-core.js (방장이 돌린다)
// 해 보고 규칙이 정해지면 도트 그림(pxl) · 효과음 · 연출을 붙인다 (작업지시-독박원정대.md §3).
import { h, digitOf, isTyping, josa } from '../util.js';
import { avatar, countdown, podium } from '../ui.js';
import {
  CARDS, CLASSES, CLASS_KEYS, TREES, MARKS, POWERS, PASSIVES, FOES, ROOMS, ULTS, BOSSES,
  ENERGY_MAX, ENERGY_GAIN, ACT_TIME, CLS_TIME, LEARN_TIME, START_LEARN_TIME, MARK_TIME, WHISPER_TIME, BOSS_FIRST_TIME, FALL_MIN,
  BOSS, list, obj, isFoeKey, partyOf, upHeroes, liveFoes, cardsOf, cardOfU, treeCount, hasP, awakeOf,
  validatePlan, validateBoss, runTurn, publicBossPlan, qDef, qCostOf, qReady, canMark, isHealCard, isDefCard,
  isVuln, isWeak, isStun, bleedOf, isGroggy, stOf, ammoOf, aimOf, faithOf, roundsOf, ammoMax, faithMax, defaultDrop, incomingTo,
} from './raid-core.js';

const SPD = { first: '선제', last: '후속' };
const SIG = { z: '막아 줘!', x: '차단 간다!', c: '살려 줘!', v: '모았다!' };
const NEXT = { hit: '공격', all: '전원 공격', charge: '필살기 준비', slam: '내려찍기', bury: '생매장', tomb: '묘비', grow: '자라는 중', groggy: '그로기', ghoul: '망자' };
const treeLabel = d => (d.tree === 'base' ? '기본기' : d.tree === 'common' ? '공통' : TREES[d.tree]?.name || '');
const pips = (n, max) => '●'.repeat(Math.max(0, Math.min(n, max))) + '○'.repeat(Math.max(0, max - Math.max(0, n)));

export default function mount(root, api) {
  const me = api.me;
  const head = h('div', { class: 'rx-head' });
  const foesEl = h('div', { class: 'rd-foes' });
  const banner = h('div', { class: 'rd-banner' });
  const info = h('div', { class: 'rd-info' });
  const ticker = h('ol', { class: 'rd-ticker' });
  const mid = h('div', { class: 'rd-mid' }, banner, info, ticker);
  const partyEl = h('div', { class: 'rd-party' });
  const prompt = h('div', { class: 'rd-prompt' });
  const stat = h('div', { class: 'rd-stat' });
  const handEl = h('div', { class: 'rd-hand' });
  const deckEl = h('div', { class: 'rd-deckrow' });
  const preview = h('div', { class: 'rd-preview' });
  const timer = h('div', { class: 'rd-timer' });
  const panel = h('div', { class: 'rd-panel' }, prompt, stat, handEl, deckEl, preview, timer);
  const overlay = h('div', { class: 'rd-overlay' });
  const board = h('div', { class: 'rd-board' });
  const box = h('div', { class: 'rd-box' }, foesEl, mid, partyEl, panel, overlay, board);
  const side = h('aside', { class: 'side' });
  root.append(h('div', { class: 'rd' }, h('div', { class: 'rd-main' }, head, box), side));
  document.activeElement?.blur?.();
  document.fonts?.load('22px "Galmuri11"', '독박 원정대 기력 타락').catch(() => {});

  let S = null;
  let P = null;
  let local = {};
  let localKey = '';
  let seen = null;
  let prev = null;   // 결과가 나오기 전의 체력 (결과를 차례대로 보여 주려고)
  let shown = null;  // 결과 연출 중에 보여 주는 체력
  let lines = [];    // 결과 장면 글줄
  let playNo = 0;
  let hint = null;
  let bannerNo = 0;
  let planTimer = null;
  let tabDown = false;
  const keys = {};
  const timers = new Set();
  const later = (ms, fn) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };

  const who = id => list(S?.roster).find(p => p.id === id) || { id, name: '?' };
  function nameOf(id) {
    if (!id) return '';
    if (id === '@all') return '모든 적';
    if (id === BOSS) return S.boss && S.boss !== 'king' ? `타락한 ${who(S.boss).name}` : '이름 없는 왕';
    if (isFoeKey(id)) {
      const f = S.foes?.[id];
      const base = FOES[f?.k]?.name || '적';
      const same = Object.keys(obj(S.foes)).filter(k => S.foes[k]?.k === f?.k);
      return same.length > 1 ? `${base} ${same.indexOf(id) + 1}` : base;
    }
    return who(id).name;
  }
  const inGame = () => list(S.roster).some(p => p.id === me);
  const inParty = () => partyOf(S).includes(me);
  const hand = () => list(P?.hand).filter(c => (P?.boss ? POWERS[c.k] : CARDS[c.k]));
  const handUs = () => hand().map(c => c.u);
  const hpOf = id => (shown && id in shown.hp ? shown.hp[id] : S.hp?.[id] || 0);
  const foeHp = k => (shown && k in shown.fhp ? shown.fhp[k] : S.foes?.[k]?.hp || 0);

  function setBanner(text, cls = '', ms = 0) {
    banner.textContent = text;
    banner.className = `rd-banner ${cls}`;
    const n = (bannerNo += 1);
    if (ms) later(ms, () => { if (bannerNo === n) banner.textContent = ''; });
  }
  function say(text, cls = 'hint', ms = 2200) {
    hint = { text, cls, until: performance.now() + ms };
    later(ms + 30, paint);
    paint();
  }
  const nope = text => {
    panel.classList.remove('nope');
    void panel.offsetWidth;
    panel.classList.add('nope');
    say(text, 'warn');
  };

  /* ── 지금 내가 할 수 있는 것 ── */
  function modeOf() {
    if (!S || S.over) return null;
    if (S.phase === 'cls') return inParty() ? 'cls' : null;
    const fresh = P?.no === S.no;
    if (S.phase === 'learn') return inParty() && !S.done?.[me] && !local.sent && fresh && list(P?.offers).length ? 'learn' : null;
    if (S.phase === 'mark') return inParty() && !S.done?.[me] && !local.sent && fresh && list(P?.markOffers).length ? 'mark' : null;
    if (S.phase === 'whisper') return inParty() && !S.done?.[me] && !local.sent && fresh && P?.whisper ? 'whisper' : null;
    if ((S.phase === 'boss' || S.phase === 'act') && me === S.boss && S.foes?.[BOSS]) return S.bossReady || local.ready ? null : 'boss';
    if (S.phase === 'act' && inParty()) {
      if (S.down?.[me]) return S.ghost?.[me] || local.sent ? null : 'ghost';
      if (isStun(S, me)) return null;
      return S.ready?.[me] || local.ready ? null : 'act';
    }
    return null;
  }
  // 단계가 바뀌면 내가 고르던 것을 비운다
  function syncLocal() {
    const k = `${S.phase}:${S.no || 0}:${S.tn || 0}`;
    if (k === localKey) return;
    localKey = k;
    local = { acts: [], q: null, drop: null, sel: null, cur: null, ready: false, sent: false, pick: null, dropU: null, take: false, dropMode: false, bacts: [], veil: null, lastFoe: local.lastFoe };
    hint = null;
  }

  /* ── 대응: 계획 만들기 ── */
  const GIVERS = new Set(['energy', 'ammo']);
  const giver = a => (CARDS[cardOfU(S, me, a.u)?.k]?.fx.some(([op]) => GIVERS.has(op)) ? 1 : 0);
  const ordered = acts => [...acts].sort((a, b) => giver(b) - giver(a)); // 기력 · 탄을 주는 카드 먼저
  const planOf = () => ({ turn: S.tn, acts: ordered(local.acts), q: local.q, drop: local.drop });
  const vpOf = () => validatePlan(S, me, planOf(), handUs());
  function sendPlan(ready) {
    clearTimeout(planTimer);
    planTimer = null;
    if (!S || S.phase !== 'act') return;
    api.send('plan', { ...planOf(), ready, at: api.now() });
  }
  function sendBoss(ready) {
    clearTimeout(planTimer);
    planTimer = null;
    if (!S || (S.phase !== 'act' && S.phase !== 'boss')) return;
    api.send('boss', { turn: S.tn + 1, acts: local.bacts, veil: local.veil, ready });
  }
  // 시간이 끝나도 지금 고른 대로 나가게, 바뀔 때마다 (조금 모아서) 알려 둔다
  function touch() {
    hint = null;
    if (!planTimer) planTimer = setTimeout(() => (modeOf() === 'boss' ? sendBoss(false) : sendPlan(false)), 250);
    paint();
  }

  function targetsFor(to, k) {
    if (to === 'foe') {
      const fs = liveFoes(S);
      return CARDS[k]?.faithAll && faithOf(S, me) >= CARDS[k].faithAll ? [...fs, '@all'] : fs;
    }
    if (to === 'ally') return upHeroes(S);
    if (to === 'other') return upHeroes(S).filter(x => x !== me);
    if (to === 'down') return partyOf(S).filter(x => S.down?.[x]);
    return [];
  }
  function defaultTarget(to, k) {
    const ts = targetsFor(to, k);
    if (!ts.length) return null;
    if (to === 'foe') {
      const fs = ts.filter(f => f !== '@all');
      return fs.find(f => isGroggy(S, f)) || (fs.includes(local.lastFoe) ? local.lastFoe : null) || [...fs].sort((a, b) => S.foes[a].hp - S.foes[b].hp)[0];
    }
    const def = CARDS[k] || qDef(S, me);
    if (def && isHealCard(def)) return [...ts].sort((a, b) => S.hp[a] / S.maxHp[a] - S.hp[b] / S.maxHp[b])[0];
    if (def && isDefCard(def)) return [...ts].sort((a, b) => incomingTo(S, b) - incomingTo(S, a))[0];
    return ts.includes(me) ? me : ts[0];
  }
  const NEEDS = new Set(['foe', 'ally', 'other', 'down']);
  // 넣어 보고, 기력 · 탄이 모자라 안 들어가면 빼고 알려 준다
  function tryAdd(entry) {
    const before = vpOf();
    local.acts.push(entry);
    const vp = vpOf();
    if (!vp.cards.some(c => c.u === entry.u)) {
      local.acts.pop();
      const d = CARDS[cardOfU(S, me, entry.u)?.k];
      return nope(d?.ammo && before.ammoLeft < (d.ammo === 'all' ? 1 : d.ammo) ? `탄이 모자라요 (남은 탄 ${before.ammoLeft}) — Q로 재장전` : `기력이 모자라요 (남은 기력 ${before.energyLeft})`);
    }
    if (isFoeKey(entry.t)) local.lastFoe = entry.t;
    touch();
  }
  function pressCard(i) {
    const c = hand()[i];
    if (!c) return;
    if (local.dropMode) {
      local.dropMode = false;
      local.acts = local.acts.filter(a => a.u !== c.u);
      local.drop = local.drop === c.u ? null : c.u;
      return touch();
    }
    const at = local.acts.findIndex(a => a.u === c.u);
    if (at >= 0) { // 이미 넣은 카드: 빼기
      local.acts.splice(at, 1);
      return touch();
    }
    if (local.drop === c.u) local.drop = null;
    const d = CARDS[c.k];
    if (NEEDS.has(d.to)) {
      const ts = targetsFor(d.to, c.k);
      if (!ts.length) return nope(d.to === 'down' ? '쓰러진 아군이 없어요' : '고를 대상이 없어요');
      local.sel = c.u;
      local.cur = defaultTarget(d.to, c.k);
      if (ts.length === 1) return confirmSel();
      return paint();
    }
    tryAdd({ u: c.u, t: null });
  }
  function confirmSel() {
    const u = local.sel;
    const t = local.cur;
    local.sel = null;
    if (u === '@q') {
      local.q = { t };
      if (!vpOf().cards.some(c => c.q)) {
        local.q = null;
        return nope(`기력이 모자라요 (${qDef(S, me).name}: 기력 ${qCostOf(S, me)})`);
      }
      return touch();
    }
    tryAdd({ u, t });
  }
  function pressQ() {
    const Q = qDef(S, me);
    if (!Q) return;
    if (local.q) {
      local.q = null;
      return touch();
    }
    if (!qReady(S, me)) return nope(`${Q.name}: ${(S.cd?.[me] || 0) - S.tn}턴 뒤에 다시 쓸 수 있어요`);
    if (Q.to === 'ally') {
      local.sel = '@q';
      local.cur = defaultTarget('ally', null);
      return paint();
    }
    local.q = {};
    if (!vpOf().cards.some(c => c.q)) {
      local.q = null;
      return nope(`기력이 모자라요 (${Q.name}: 기력 ${qCostOf(S, me)})`);
    }
    touch();
  }
  function moveCursor(dir) {
    const u = local.sel;
    const to = u === '@q' ? 'ally' : CARDS[cardOfU(S, me, u)?.k]?.to;
    const ts = targetsFor(to, cardOfU(S, me, u)?.k);
    if (!ts.length) return;
    const i = ts.indexOf(local.cur);
    local.cur = ts[(i + dir + ts.length) % ts.length];
    paint();
  }
  function readyUp() {
    local.ready = true;
    local.sel = null;
    sendPlan(true);
    paint();
  }

  /* ── 마왕: 다음 턴 권능 ── */
  function bossVb(acts = local.bacts) {
    return validateBoss(S, { acts, veil: local.veil }, handUs(), S.dark || 0);
  }
  function pressPower(i) {
    const c = hand()[i];
    if (!c) return;
    const at = local.bacts.findIndex(a => a.u === c.u);
    if (at >= 0) {
      local.bacts.splice(at, 1);
      if (local.veil === c.u || c.k === 'veil') local.veil = null;
      return touch();
    }
    const Pw = POWERS[c.k];
    if (Pw.aim) {
      local.sel = c.u;
      local.cur = [...upHeroes(S)].sort((a, b) => S.hp[a] - S.hp[b])[0] || null;
      return paint();
    }
    addPower({ u: c.u, t: null });
  }
  function addPower(entry) {
    const next = [...local.bacts, entry];
    if (!bossVb(next).cards.some(c => c.u === entry.u)) {
      const k = hand().find(c => c.u === entry.u)?.k;
      return nope(k === 'doom' && S.foes?.[BOSS]?.charge ? '종말은 한 번에 하나' : `어둠이 모자라요 (어둠 ${S.dark || 0})`);
    }
    local.bacts = next;
    touch();
  }
  function toggleVeil() {
    if (!local.bacts.some(a => hand().find(c => c.u === a.u)?.k === 'veil')) return nope('어둠의 장막을 먼저 넣으세요');
    const can = local.bacts.filter(a => !['veil', 'doom'].includes(hand().find(c => c.u === a.u)?.k)).map(a => a.u);
    if (!can.length) return nope('가릴 권능이 없어요');
    const i = can.indexOf(local.veil);
    local.veil = i < 0 ? can[0] : i + 1 < can.length ? can[i + 1] : null;
    touch();
  }

  /* ── 키보드 ── */
  function onKey(e) {
    if (isTyping(e) || !S) return;
    const c = e.code;
    if (c === 'Tab') {
      e.preventDefault();
      if (!tabDown) {
        tabDown = true;
        paintOverlay();
      }
      return;
    }
    const d = digitOf(e);
    const dir = c === 'ArrowLeft' || c === 'KeyA' ? -1 : c === 'ArrowRight' || c === 'KeyD' ? 1 : 0;
    const space = c === 'Space';
    const back = c === 'Backspace';
    if (space || back || c.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    const mode = modeOf();
    if (S.phase === 'act' && inParty() && ['KeyZ', 'KeyX', 'KeyC'].includes(c)) return api.send('sig', { k: c.slice(3).toLowerCase() });
    if (S.phase === 'act' && inParty() && c === 'KeyV' && mode !== 'boss') return api.send('sig', { k: 'v' });
    if (!mode) return;
    if (mode === 'cls') {
      const k = CLASS_KEYS[d - 1];
      if (!k) return;
      local.cls = k;
      api.send('cls', { k });
      return paint();
    }
    if (mode === 'learn' || mode === 'whisper' || mode === 'mark') return pickKey(mode, d, dir, space, back);
    if (mode === 'ghost') {
      const ts = [...upHeroes(S), ...liveFoes(S)];
      if (dir && ts.length) {
        const i = ts.indexOf(local.cur);
        local.cur = ts[(i + dir + ts.length) % ts.length];
        return paint();
      }
      if (space && local.cur) {
        local.sent = true;
        api.send('ghost', { turn: S.tn, k: isFoeKey(local.cur) ? 'curse' : 'guard', t: local.cur });
        return paint();
      }
      return;
    }
    if (mode === 'boss') {
      if (d) return pressPower(d - 1);
      if (dir && local.sel) {
        const ts = upHeroes(S);
        const i = ts.indexOf(local.cur);
        local.cur = ts[(i + dir + ts.length) % ts.length];
        return paint();
      }
      if (space) {
        if (local.sel) {
          const u = local.sel;
          local.sel = null;
          return addPower({ u, t: local.cur });
        }
        local.ready = true;
        sendBoss(true);
        return paint();
      }
      if (c === 'KeyV') return toggleVeil();
      if (back) {
        Object.assign(local, { bacts: [], veil: null, sel: null });
        return touch();
      }
      return;
    }
    // mode === 'act'
    if (d) return pressCard(d - 1);
    if (dir && local.sel) return moveCursor(dir);
    if (space) return local.sel ? confirmSel() : readyUp();
    if (c === 'KeyQ') return pressQ();
    if (c === 'KeyR') {
      local.dropMode = !local.dropMode;
      local.sel = null;
      return paint();
    }
    if (back) {
      Object.assign(local, { acts: [], q: null, drop: null, sel: null, dropMode: false });
      return touch();
    }
  }
  function onKeyUp(e) {
    if (e.code !== 'Tab') return;
    tabDown = false;
    paintOverlay();
  }
  // 배움 · 각인 · 속삭임: 숫자키로 고르고 ← → 로 바꿀(새길) 카드, 스페이스로 확정
  function pickKey(mode, d, dir, space, back) {
    const deck = cardsOf(S, me);
    if (mode === 'learn') {
      const offers = list(P.offers);
      if (d && offers[d - 1]) {
        local.pick = d - 1;
        local.dropU ??= defaultDrop(S, me);
      }
      if (dir) local.dropU = stepU(deck, local.dropU ?? defaultDrop(S, me), dir);
      if (back && S.learnKind === 'room') {
        local.sent = true;
        api.send('learn', { no: S.no, skip: true });
      }
      if (space) {
        if (local.pick == null) return nope('숫자키로 배울 기술을 고르세요');
        local.sent = true;
        api.send('learn', { no: S.no, i: local.pick, drop: local.dropU ?? defaultDrop(S, me) });
      }
      return paint();
    }
    if (mode === 'mark') {
      const offers = list(P.markOffers);
      if (d && offers[d - 1]) {
        local.pick = d - 1;
        const ok = deck.filter(c => canMark(c, offers[d - 1]));
        if (!ok.some(c => c.u === local.dropU)) local.dropU = [...ok].sort((a, b) => (b.n || 0) - (a.n || 0))[0]?.u ?? null;
      }
      if (dir && local.pick != null) local.dropU = stepU(deck.filter(c => canMark(c, offers[local.pick])), local.dropU, dir);
      if (space) {
        if (local.pick == null || local.dropU == null) return nope('숫자키로 각인을 고르고 ← → 로 새길 기술을 고르세요');
        local.sent = true;
        api.send('mark', { no: S.no, k: offers[local.pick], u: local.dropU });
      }
      return paint();
    }
    // whisper
    if (d === 1) {
      local.take = true;
      local.dropU ??= defaultDrop(S, me);
    }
    if (d === 2) {
      local.sent = true;
      api.send('whisper', { no: S.no, take: false });
      return paint();
    }
    if (dir && local.take) local.dropU = stepU(deck, local.dropU, dir);
    if (space && local.take) {
      local.sent = true;
      api.send('whisper', { no: S.no, take: true, drop: local.dropU ?? defaultDrop(S, me) });
    }
    paint();
  }
  const stepU = (cards, u, dir) => {
    if (!cards.length) return null;
    const i = cards.findIndex(c => c.u === u);
    return cards[(i + dir + cards.length) % cards.length].u;
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);

  /* ── 글자로 옮기기 ── */
  function intentText(it) {
    const to = list(it.to).map(nameOf).join(' · ');
    switch (it.k) {
      case 'hit': return `🗡 ${to}에게 ${it.v}`;
      case 'all': return `🌀 전원 ${it.v}`;
      case 'charge': return `⚠ ${ULTS[it.u]?.name || '필살기'} 준비 · ${Math.max(0, it.fire - S.tn)}턴 뒤에 터진다${it.to ? ` → ${to}` : ''}`;
      case 'slam': return `💥 내려찍기 ${to}에게 ${it.v}`;
      case 'bury': return `💀 생매장 전원 ${it.v} + 기절`;
      case 'doom': return `☠ 종말 전원 ${it.v}`;
      case 'tomb': return '🪦 묘비를 세운다';
      case 'grow': return `🪦 ${Math.max(0, it.at - S.tn)}턴 뒤 망자가 된다`;
      case 'groggy': return '😵 그로기 (못 움직인다 · 받는 피해 +50%)';
      case 'later': return `🎯 표적 지정 ${to}에게 ${it.v}`;
      case '?': return '❓ 가려진 권능';
      case 'p': return `😈 ${powerText(it)}`;
      default: return '';
    }
  }
  function powerText(it) {
    const Pw = POWERS[it.p] || { name: it.p };
    const to = list(it.to).map(nameOf).join(' · ');
    const more = list(it.rand).length ? ` + ${list(it.rand).map(nameOf).join(' · ')}` : '';
    const v = it.v ? ` ${it.v}${Pw.times ? ` × ${Pw.times}` : ''}` : '';
    return `${Pw.name}${to ? ` → ${to}` : ''}${more}${v}${it.v2 ? ` (나머지 ${it.v2})` : ''}`;
  }
  const cardName = e => (e.c === '@q' ? qDef(S, e.by)?.name || '고유 기술' : CARDS[e.c]?.name || e.c) + (e.m ? `·${MARKS[e.m]?.name}` : '');
  function sceneText(e) {
    const n = nameOf;
    switch (e.k) {
      case 'use': return `${n(e.by)}: ${cardName(e)}${e.t ? ` → ${n(e.t)}` : ''}${e.dark ? ' 🩸' : ''}`;
      case 'hit': return `   ${n(e.to)}에게 ${e.d}${e.a ? ` (방어 ${e.a})` : ''}${e.dead ? ' · 쓰러뜨림!' : ''}`;
      case 'hurt': return `   ${e.by && e.by !== e.to ? `${n(e.by)} → ` : ''}${n(e.to)} ${e.d ? `-${e.d}${e.a ? ` (막음 ${e.a})` : ''}` : `막았다 (방어 ${e.a})`}${e.how && !isFoeKey(e.by) ? ` · ${e.how}` : ''}`;
      case 'blk': return `   ${n(e.to)} 방어 +${e.v}`;
      case 'heal': return `   ${n(e.to)} 체력 +${e.v}`;
      case 'brk': return `   차단 +${e.v} (${e.got}/${e.need})`;
      case 'groggy': return `😵 ${n(e.to)} 그로기!`;
      case 'down': return `💀 ${n(e.to)} 쓰러짐!`;
      case 'die': return `☠ ${n(e.to)} 쓰러짐`;
      case 'corrupt': return e.v ? `🩸 ${n(e.to)} 타락 +${e.v}` : `🕊 ${n(e.to)}: 세례가 타락을 막았다`;
      case 'feed': return `🩸 독박! ${n(BOSS)} 체력 +${e.v}`;
      case 'power': return `😈 ${n(BOSS)}: ${powerText({ p: e.p, to: e.to })}`;
      case 'ult': return `💥 ${n(e.by)}: ${ULTS[e.u]?.name || '필살기'}!`;
      case 'act': return `${n(e.by)}: ${e.a === 'all' ? '전원 공격' : '공격'}`;
      case 'spawn': return `🪦 ${josa(n(e.to), '이', '가')} 섰다`;
      case 'st': return `   ${n(e.to)} ${e.s === 'vuln' ? '취약' : e.s === 'weak' ? '약화' : e.s === 'bleed' ? `출혈 +${e.v}` : '저주 (약화 · 취약)'}`;
      case 'bleed': return `🩸 ${n(e.to)} 출혈 -${e.d}`;
      case 'cost': return `   ${n(e.to)} 체력 -${e.v}`;
      case 'save': return `✨ ${n(e.to)}: ${e.why === 'undying' ? '불사! 버텼다' : '광인! 체력 1로 버텼다'}`;
      case 'rise': return `✨ ${josa(n(e.to), '이', '가')} 일어섰다`;
      case 'cleanse': return `   ${n(e.to)} 상태이상 해제`;
      case 'bheal': return `   ${n(BOSS)} 체력 +${e.v}`;
      default: return '';
    }
  }

  /* ── 결과: 방장이 적어 준 장면(S.rs)을 차례로 ── */
  function apply(e) {
    if (!shown) return;
    const hero = id => id && !isFoeKey(id);
    if (e.k === 'hit' || (e.k === 'bleed' && isFoeKey(e.to))) shown.fhp[e.to] = Math.max(0, (shown.fhp[e.to] ?? S.foes?.[e.to]?.hp ?? 0) - (e.d || 0));
    if (e.k === 'die') shown.fhp[e.to] = 0;
    if ((e.k === 'bheal' || e.k === 'feed') && BOSS in shown.fhp) shown.fhp[BOSS] += e.v || 0;
    if (e.k === 'hurt' && hero(e.to)) shown.hp[e.to] = Math.max(0, (shown.hp[e.to] ?? 0) - (e.d || 0));
    if (e.k === 'cost') shown.hp[e.to] = Math.max(1, (shown.hp[e.to] ?? 0) - e.v);
    if (e.k === 'heal' && hero(e.to)) shown.hp[e.to] = Math.min(S.maxHp?.[e.to] || 99, (shown.hp[e.to] ?? 0) + e.v);
    if (e.k === 'down') shown.hp[e.to] = 0;
    if (e.k === 'save') shown.hp[e.to] = 1;
    if (e.k === 'rise') delete shown.hp[e.to];
  }
  function onResolve() {
    const no = (playNo += 1);
    const evs = list(S.rs);
    const step = S.rsStep || 400;
    shown = prev ? { hp: { ...prev.hp }, fhp: { ...prev.fhp } } : null;
    lines = [];
    setBanner('', '');
    const live = () => no === playNo && S && S.phase === 'resolve';
    evs.forEach((e, i) => later(300 + i * step, () => {
      if (!live()) return;
      apply(e);
      const t = sceneText(e);
      if (t) lines = [...lines, { t, k: e.k, me: e.to === me || e.by === me }].slice(-9);
      if (e.k === 'groggy') setBanner(`${nameOf(e.to)} 그로기!`, 'gold', 1300);
      if (e.k === 'down' && e.to === me) setBanner('쓰러졌다', 'blood', 1300);
      if (e.k === 'ult') setBanner(`${ULTS[e.u]?.name || '필살기'}!`, 'blood', 1300);
      if (e.k === 'feed' && e.by === me) setBanner('독박! 마왕이 회복했다', 'blood', 1300);
      paintFoes();
      paintParty();
      paintTicker();
    }));
  }

  /* ── 그리기 ── */
  function paintHead() {
    const room = S.room === 3 ? '최종전' : S.room >= 0 ? `방 ${S.room + 1} · ${ROOMS[S.room]?.name}` : '출발 전';
    const left = `${room}${S.phase === 'act' || S.phase === 'resolve' ? ` · ${S.turn}턴` : ''}`;
    const right = inParty()
      ? `${CLASSES[S.cls?.[me]]?.icon || ''} ❤️ ${S.hp?.[me] ?? '-'} · 기력 ${S.energy?.[me] ?? 0} · 타락 ${S.corrupt?.[me] || 0}`
      : me === S.boss ? `😈 마왕 · 어둠 ${S.dark || 0}` : inGame() ? '' : '👀 관전 중';
    const k = left + right;
    if (keys.head === k) return;
    keys.head = k;
    head.replaceChildren(h('span', {}, left), h('span', {}, right));
  }

  function bar(cur, max, cls = '') {
    const w = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
    return h('span', { class: `rd-bar ${cls}` }, h('i', { style: `width:${w}%` }), h('b', {}, `${cur}/${max}`));
  }
  function stTags(u) {
    const t = [];
    if (isVuln(S, u)) t.push('취약');
    if (isWeak(S, u)) t.push('약화');
    if (isStun(S, u)) t.push('기절');
    if (bleedOf(S, u)) t.push(`출혈 ${bleedOf(S, u)}`);
    if (stOf(S, u).ward) t.push('가호');
    return t.length ? h('span', { class: 'rd-st' }, t.join(' · ')) : null;
  }
  const targetMode = () => (modeOf() === 'act' || modeOf() === 'boss') && !!local.sel;

  function paintFoes() {
    const ks = Object.keys(obj(S.foes)).filter(k => foeHp(k) > 0 || (shown && S.foes[k]));
    const key = JSON.stringify([ks.map(k => [k, foeHp(k), S.foes[k].block, S.foes[k].intent, S.foes[k].next, S.foes[k].charge, S.foes[k].groggy, stOf(S, k)]),
      S.pre, local.sel, local.cur, S.tn, S.phase, S.dark, me === S.boss]);
    if (key === keys.foes) return;
    keys.foes = key;
    foesEl.replaceChildren(...ks.map(k => {
      const f = S.foes[k];
      const c = f.charge;
      const moved = S.pre?.foe?.[k] || 0;
      const pb = S.pre?.brk?.[k] || 0;
      const isB = k === BOSS;
      return h('div', {
        class: `rd-foe${isB ? ' boss' : ''}${isGroggy(S, k) ? ' groggy' : ''}${targetMode() && local.cur === k ? ' aim' : ''}${foeHp(k) <= 0 ? ' dead' : ''}`,
        onClick: () => { if (targetMode() && isFoeKey(local.cur)) { local.cur = k; paint(); } },
      },
      h('div', { class: 'rd-fname' }, h('b', {}, nameOf(k)), isB ? h('span', { class: 'rd-sub' }, BOSSES[S.bossCls]?.name || '') : null,
        f.block ? h('span', { class: 'rd-blk' }, `🛡${f.block}`) : null, stTags(k)),
      bar(foeHp(k), f.max, 'foe'),
      moved && S.phase === 'act' ? h('div', { class: 'rd-pre' }, `모인 피해 ${moved}`) : null,
      c ? h('div', { class: 'rd-gauge' }, `⚠ ${ULTS[c.u]?.name} 차단 `, bar(c.got || 0, c.need, 'brk'), pb ? h('span', { class: 'rd-pre' }, ` +${pb} 모임`) : null,
        h('span', { class: 'rd-sub' }, ` · ${Math.max(0, c.fire - S.tn)}턴 뒤`)) : null,
      h('ul', { class: 'rd-intent' }, list(f.intent).map(it => h('li', { class: list(it.to).includes(me) || ['all', 'bury', 'doom'].includes(it.k) ? 'me' : '' }, intentText(it)))),
      list(f.next).length ? h('div', { class: 'rd-next' }, `다음 턴: ${list(f.next).map(x => NEXT[x] || x).join(' · ')}`) : null,
      isB && me !== S.boss && S.boss !== 'king' ? h('div', { class: 'rd-sub' }, `어둠 ${S.dark || 0} · 다음 턴 권능을 고르는 중`) : null);
    }));
  }

  function resText(id) {
    const cls = S.cls?.[id];
    if (cls === 'gunner') {
      const R = roundsOf(S, id);
      const r = [R.ap ? `철갑 ${R.ap}` : '', R.fire ? `소이 ${R.fire}` : ''].filter(Boolean).join(' ');
      return `탄 ${pips(ammoOf(S, id), ammoMax(S, id))}${aimOf(S, id) ? ` 조준 ${aimOf(S, id)}` : ''}${r ? ` ${r}` : ''}`;
    }
    if (cls === 'priest') return `신앙 ${faithOf(S, id)}/${faithMax(S, id)}`;
    if (cls === 'berserk') return `피 끓음 +${Math.floor(Math.max(0, (S.maxHp[id] || 0) - (S.hp[id] || 0)) / 10) * 2}`;
    if (cls === 'guard') return qReady(S, id) ? '버티기 가능' : `버티기 ${(S.cd?.[id] || 0) - S.tn}턴 뒤`;
    return '';
  }
  function paintParty() {
    const ids = partyOf(S);
    const now = api.now();
    const key = JSON.stringify([ids.map(id => [id, hpOf(id), S.maxHp?.[id], S.block?.[id], S.energy?.[id], S.res?.[id], S.corrupt?.[id], S.acts?.[id], S.ready?.[id],
      S.down?.[id], stOf(S, id), S.sig?.[id], S.cls?.[id], cardsOf(S, id).length, S.ghost?.[id]]), S.pre, local.sel, local.cur, S.phase, S.tn,
      Math.floor(now / 1000), Object.keys(obj(S.foes)).map(k => S.foes[k]?.intent)]);
    if (key === keys.party) return;
    keys.party = key;
    const threat = list(S.pre?.threat);
    partyEl.replaceChildren(...ids.map(id => {
      const C = CLASSES[S.cls?.[id]];
      const a = obj(S.acts?.[id]);
      const pre = obj(S.pre?.ally?.[id]);
      const inc = S.phase === 'act' ? incomingTo(S, id) : 0;
      const sig = S.sig?.[id];
      const aw = awakeOf(S, id);
      const corrupt = S.corrupt?.[id] || 0;
      return h('div', {
        class: `rd-hero${id === me ? ' me' : ''}${S.down?.[id] ? ' down' : ''}${targetMode() && local.cur === id ? ' aim' : ''}`,
        onClick: () => { if (targetMode() && !isFoeKey(local.cur)) { local.cur = id; paint(); } },
      },
      avatar(who(id), 'xs'),
      h('span', { class: 'rd-hname' }, h('b', {}, `${C?.icon || ''} ${who(id).name}`), h('span', { class: 'rd-sub' }, `${aw ? `'${aw}' ` : ''}${C?.name || ''}`)),
      C ? bar(hpOf(id), S.maxHp?.[id] || 0, 'hp') : h('span', { class: 'rd-sub' }, '직업 고르는 중'),
      h('span', { class: 'rd-blk' }, S.block?.[id] ? `🛡${S.block[id]}` : ''),
      h('span', { class: 'rd-en', title: '기력' }, pips(S.energy?.[id] || 0, ENERGY_MAX)),
      h('span', { class: 'rd-res' }, resText(id)),
      h('span', { class: `rd-corrupt${corrupt >= FALL_MIN ? ' hot' : ''}`, title: '타락' }, `타락 ${corrupt}`),
      h('span', { class: 'rd-acts' }, S.down?.[id] ? (S.ghost?.[id] ? '👻 원혼' : '💀') : [a.a ? '⚔' : '', a.d ? '🛡' : '', a.h ? '✚' : ''].join(''),
        S.ready?.[id] ? h('em', {}, ` 준비 ${S.ready[id]}번`) : null),
      inc ? h('span', { class: 'rd-inc' }, `맞을 ${inc}${pre.blk ? ` · 방어 +${pre.blk}` : ''}`) : pre.blk ? h('span', { class: 'rd-pre' }, `방어 +${pre.blk}`) : null,
      pre.heal ? h('span', { class: 'rd-pre' }, `회복 +${pre.heal}`) : null,
      threat.includes(id) && S.phase === 'act' ? h('span', { class: 'rd-threat' }, '다음 표적') : null,
      stTags(id),
      sig && now - sig.at < 3000 ? h('span', { class: 'rd-sig' }, SIG[sig.k]) : null);
    }));
  }

  function paintTicker() {
    const k = JSON.stringify(lines);
    if (keys.ticker === k) return;
    keys.ticker = k;
    ticker.replaceChildren(...lines.map(l => h('li', { class: `${l.k}${l.me ? ' me' : ''}` }, l.t)));
  }

  // 가운데: 단계마다 보여 줄 것 (기여도 표 · 속삭임 공개 · 흑화)
  function paintInfo() {
    const k = JSON.stringify([S.phase, S.table, S.wshow, S.fall, S.learned, S.marked, S.clsPick, S.no]);
    if (keys.info === k) return;
    keys.info = k;
    let out = [];
    if (S.phase === 'clear') {
      out = [h('h3', {}, '이번 방 기여도 (준 피해 + 막아 낸 피해 + 회복 + 차단 × 3)'),
        h('ol', { class: 'rd-table' }, list(S.table).map(r => h('li', { class: r.id === S.mvp ? 'mvp' : '' }, `${who(r.id).name} ${r.v}${r.id === S.mvp ? ' · 다음 배움 한 장 더' : ''}`)))];
    } else if (S.phase === 'wreveal') {
      out = [h('h3', {}, '속삭임 공개'), h('ul', { class: 'rd-table' }, partyOf(S).map(id => {
        const w = S.wshow?.[id];
        return h('li', { class: w?.take ? 'dark' : '' }, w?.take ? `🩸 ${who(id).name}: '${CARDS[w.k]?.name}'${w.m ? `(${MARKS[w.m]?.name})` : ''}을 받아들였다 · 타락 +${w.v ?? 2}` : `${who(id).name}: 거절`);
      }))];
    } else if (S.phase === 'fall' && S.fall) {
      out = [h('h3', {}, `타락 1위(${FALL_MIN} 이상)가 마왕이 된다`), h('ol', { class: 'rd-table' }, list(S.fall.list).map(r => h('li', { class: r.id === S.fall.boss ? 'dark' : '' },
        `${who(r.id).name} ${'●'.repeat(Math.min(r.c, 14))} ${r.c}${r.id === S.fall.boss ? ' → 마왕' : ''}`))),
      list(S.fall.tie).length ? h('p', {}, `🎰 동률 룰렛: ${list(S.fall.tie).map(id => who(id).name).join(' · ')}`) : null,
      S.fall.boss === 'king' ? h('p', {}, '아무도 흑화하지 않았다. 이름 없는 왕이 깨어난다') : h('p', {}, `${BOSSES[S.cls?.[S.fall.boss]]?.name || ''} — ${BOSSES[S.cls?.[S.fall.boss]]?.passive || ''}`)];
    } else if (S.phase === 'boss') {
      out = [h('h3', {}, `${nameOf(BOSS)}가 첫 권능을 고르는 중`), h('p', {}, `${BOSSES[S.bossCls]?.passive || ''} · 원정대의 답: ${BOSSES[S.bossCls]?.answer || ''}`)];
    } else if (S.phase === 'mark' || (S.phase === 'learn' && Object.keys(obj(S.learned)).length)) {
      const L = Object.entries(obj(S.learned));
      out = L.length ? [h('h3', {}, '방금 배운 것'), h('ul', { class: 'rd-table' }, L.map(([id, x]) => h('li', {}, x.skip ? `${who(id).name}: 건너뜀 (체력 +6)` : `${who(id).name}: ${CARDS[x.k]?.name}${x.drop ? ` (${CARDS[x.drop]?.name} 대신)` : ''}`)))] : [];
    } else if (S.phase === 'whisper' && Object.keys(obj(S.marked)).length) {
      out = [h('h3', {}, '방금 새긴 각인'), h('ul', { class: 'rd-table' }, Object.entries(obj(S.marked)).map(([id, x]) => h('li', {}, `${who(id).name}: ${CARDS[x.k]?.name} ← ${MARKS[x.m]?.name}`)))];
    } else if (S.phase === 'cls') {
      out = [h('h3', {}, '고른 직업'), h('ul', { class: 'rd-table' }, partyOf(S).map(id => h('li', {}, `${who(id).name}: ${CLASSES[S.clsPick?.[id]]?.name || '…'}`)))];
    }
    info.replaceChildren(...out.filter(Boolean));
  }

  function cardEl(c, i, state, extra = {}) {
    const d = CARDS[c.k] || { name: c.k, cost: 0, tip: '', fx: [] };
    const cost = extra.cost ?? d.cost;
    const tags = [d.ult ? '오의' : null, d.spd ? SPD[d.spd] : null, c.m ? `각인: ${MARKS[c.m]?.name}` : null, d.dark ? '금단' : null].filter(Boolean);
    return h('button', {
      class: `rd-card ${state}${d.dark ? ' dark' : ''}${d.ult ? ' ult' : ''}`, type: 'button', tabindex: '-1', title: `${d.name}: ${d.tip}${c.m ? ` · ${MARKS[c.m]?.name}: ${MARKS[c.m]?.tip}` : ''}`,
      onClick: e => { e.currentTarget.blur(); extra.onClick?.(); },
    },
    i != null ? h('span', { class: 'rd-key' }, String(i + 1)) : null,
    h('span', { class: 'rd-cost' }, `기력 ${cost}${d.ammo ? ` · 탄 ${d.ammo === 'all' ? '전부' : d.ammo}` : ''}`),
    h('b', { class: 'rd-cname' }, d.name),
    h('span', { class: 'rd-tree' }, treeLabel(d)),
    h('span', { class: 'rd-ctip' }, d.tip),
    tags.length ? h('span', { class: 'rd-tags' }, tags.join(' · ')) : null,
    extra.note ? h('span', { class: 'rd-note' }, extra.note) : null);
  }
  const deckRow = (cards, cur, label, ok = () => true) => [h('span', { class: 'rd-deck-label' }, label), ...cards.map(c => {
    const d = CARDS[c.k];
    return h('span', { class: `rd-mini${c.u === cur ? ' on' : ''}${ok(c) ? '' : ' off'}${d?.dark ? ' dark' : ''}`, title: d?.tip || '' },
      d?.name || c.k, c.m ? h('em', {}, ` ${MARKS[c.m]?.name}`) : null);
  })];

  function paintPanel() {
    const mode = modeOf();
    const vp = mode === 'act' ? vpOf() : null;
    const k = JSON.stringify([mode, P, local, S.phase, S.no, S.tn, S.energy?.[me], S.res?.[me], S.cards?.[me], S.dark, S.bossReady, S.ready?.[me], S.done?.[me],
      hint?.text, S.cd?.[me], S.hp?.[me], S.down?.[me], S.clsPick?.[me], S.ghost?.[me], Object.keys(obj(S.foes)).map(f => [S.foes[f].hp, S.foes[f].intent])]);
    if (k !== keys.panel) {
      keys.panel = k;
      let text = '';
      let cls = '';
      let cards = [];
      let deck = [];
      let bits = [];
      let pv = null;
      if (mode === 'cls') {
        text = '숫자키로 직업을 고르세요 (같은 직업을 여럿이 골라도 돼요)';
        cards = CLASS_KEYS.map((key, i) => {
          const C = CLASSES[key];
          return h('button', { class: `rd-card cls${(local.cls || S.clsPick?.[me]) === key ? ' on' : ' can'}`, type: 'button', tabindex: '-1', onClick: e => { e.currentTarget.blur(); local.cls = key; api.send('cls', { k: key }); paint(); } },
            h('span', { class: 'rd-key' }, String(i + 1)), h('b', { class: 'rd-cname' }, `${C.icon} ${C.name}`), h('span', { class: 'rd-tree' }, `${C.weapon} · 체력 ${C.hp}`),
            h('span', { class: 'rd-ctip' }, `${C.res}: ${C.resTip}`), h('span', { class: 'rd-ctip good' }, `잘함 ${C.good}`), h('span', { class: 'rd-ctip bad' }, `못함 ${C.bad}`),
            h('span', { class: 'rd-tags' }, `Q ${C.q.name}: ${C.q.tip}`), h('span', { class: 'rd-tags' }, `계열 ${C.trees.map(t => TREES[t].name).join(' · ')}`));
        });
      } else if (mode === 'learn') {
        const offers = list(P.offers);
        text = `배움: 숫자키로 기술 → ← → 로 바꿀 카드 → 스페이스${S.learnKind === 'room' ? ' · Backspace 건너뛰기(체력 +6)' : ''}`;
        cards = offers.map((key, i) => {
          const d = CARDS[key];
          const now = d.tree === 'common' ? null : treeCount(S, me, d.tree);
          const note = now == null ? '공통 (숙련 없음)' : `${TREES[d.tree].name} ${now} → ${now + 1}장${now + 1 === 2 ? ' · 숙련!' : now + 1 === 4 ? ' · 각성!' : now + 1 < 2 ? ' · 숙련까지 1장' : ''}`;
          return cardEl({ k: key }, i, local.pick === i ? 'on' : 'can', { note, onClick: () => pickKey('learn', i + 1, 0, false, false) });
        });
        deck = deckRow(cardsOf(S, me), local.pick == null ? null : local.dropU ?? defaultDrop(S, me), '바꿀 카드 ←→');
      } else if (mode === 'mark') {
        const offers = list(P.markOffers);
        text = '각인: 숫자키로 각인 → ← → 로 새길 기술 → 스페이스 (한 장에 하나, 못 바꿔요)';
        cards = offers.map((m, i) => h('button', { class: `rd-card mark${local.pick === i ? ' on' : ' can'}`, type: 'button', tabindex: '-1', onClick: e => { e.currentTarget.blur(); pickKey('mark', i + 1, 0, false, false); } },
          h('span', { class: 'rd-key' }, String(i + 1)), h('b', { class: 'rd-cname' }, MARKS[m].name), h('span', { class: 'rd-ctip' }, MARKS[m].tip)));
        const m = offers[local.pick];
        deck = deckRow(cardsOf(S, me), local.dropU, '새길 기술 ←→', c => !m || canMark(c, m));
      } else if (mode === 'whisper') {
        const w = P.whisper;
        text = '속삭임: 1 받는다(타락 +2) · 2 거절 — 받으면 ← → 로 바꿀 카드 → 스페이스. 답은 다 같이 공개돼요';
        cls = 'dark';
        cards = [cardEl({ k: w.k, m: w.m }, 0, local.take ? 'on' : 'can', { note: w.m ? `깨끗한 손에게: ${MARKS[w.m].name}이 새겨져 있다` : '', onClick: () => pickKey('whisper', 1, 0, false, false) }),
          h('button', { class: 'rd-card can', type: 'button', tabindex: '-1', onClick: e => { e.currentTarget.blur(); pickKey('whisper', 2, 0, false, false); } },
            h('span', { class: 'rd-key' }, '2'), h('b', { class: 'rd-cname' }, '거절'), h('span', { class: 'rd-ctip' }, '깨끗한 손으로 간다'))];
        if (local.take) deck = deckRow(cardsOf(S, me), local.dropU, '바꿀 카드 ←→');
      } else if (mode === 'act' || (S.phase === 'act' && inParty() && !S.down?.[me])) {
        const qd = qDef(S, me);
        const live = mode === 'act';
        const inPlan = u => local.acts.some(a => a.u === u);
        const okU = new Set((vp?.cards || []).map(c => c.u));
        text = !live ? (isStun(S, me) ? '기절: 이번 턴은 못 움직여요' : '준비 완료! 다른 사람을 기다리는 중')
          : local.dropMode ? '버릴 카드의 숫자키 (턴마다 1장, 공짜)'
            : local.sel ? `← → 로 대상 → 스페이스 (지금: ${nameOf(local.cur)})`
              : '숫자키 기술 · Q 고유 기술 · R 버리기 · Backspace 처음으로 · 빈손 스페이스 = 준비 완료 · Tab 내 덱';
        cards = hand().map((c, i) => {
          const on = inPlan(c.u);
          const bad = on && !okU.has(c.u);
          const state = local.drop === c.u ? 'drop' : bad ? 'bad' : on ? 'on' : local.sel === c.u ? 'sel' : live ? 'can' : 'dim';
          const t = local.acts.find(a => a.u === c.u)?.t;
          return cardEl(c, i, state, { note: local.drop === c.u ? '버림' : bad ? '못 냄 (기력 · 탄)' : t ? `→ ${nameOf(t)}` : '', onClick: () => live && pressCard(i) });
        });
        const e = vp ? vp.energyLeft : S.energy?.[me] || 0;
        bits = [h('span', { class: 'rd-en big' }, `기력 ${pips(e, ENERGY_MAX)} ${e}`),
          h('span', { class: 'rd-res' }, resText(me).replace(/탄 [●○]+/, `탄 ${pips(vp ? vp.ammoLeft : ammoOf(S, me), ammoMax(S, me))}`)),
          qd ? h('span', { class: `rd-q${local.q ? ' on' : ''}${qReady(S, me) ? '' : ' off'}`, title: qd.tip }, `Q ${qd.name}${local.q ? ' ✔' : ''}${qReady(S, me) ? '' : ` (${(S.cd?.[me] || 0) - S.tn}턴 뒤)`}`) : null];
        if (live) pv = previewLine(vp);
      } else if (mode === 'ghost') {
        text = `원혼: ← → 로 지킬 아군(방어 +3) 또는 저주할 적(받는 피해 +10%) → 스페이스 (지금: ${nameOf(local.cur) || '없음'})`;
      } else if (mode === 'boss') {
        const live = true;
        const vb = bossVb();
        text = local.sel ? `← → 로 지목 → 스페이스 (지금: ${nameOf(local.cur)})` : `${S.phase === 'boss' ? '첫 턴' : '다음 턴'} 권능: 숫자키 · V 장막으로 가리기 · Backspace 처음으로 · 빈손 스페이스 = 확정`;
        cls = 'dark';
        cards = hand().map((c, i) => {
          const Pw = POWERS[c.k];
          const a = local.bacts.find(x => x.u === c.u);
          const state = a ? (vb.cards.some(x => x.u === c.u) ? 'on' : 'bad') : local.sel === c.u ? 'sel' : live ? 'can' : 'dim';
          return h('button', { class: `rd-card power ${state}`, type: 'button', tabindex: '-1', title: Pw.tip, onClick: e => { e.currentTarget.blur(); pressPower(i); } },
            h('span', { class: 'rd-key' }, String(i + 1)), h('span', { class: 'rd-cost' }, `어둠 ${Pw.cost}`), h('b', { class: 'rd-cname' }, Pw.name),
            h('span', { class: 'rd-ctip' }, Pw.tip), a?.t ? h('span', { class: 'rd-note' }, `→ ${nameOf(a.t)}`) : null, local.veil === c.u ? h('span', { class: 'rd-note' }, '장막에 가림') : null);
        });
        bits = [h('span', { class: 'rd-en big' }, `어둠 ${pips(vb.left, ENERGY_MAX)} ${vb.left}`), h('span', { class: 'rd-res' }, '공개하면 어둠이 빠지고, 손패를 채우고 어둠 +3')];
      } else if (me === S.boss && (S.phase === 'act' || S.phase === 'boss')) {
        text = '권능을 확정했어요. 원정대를 기다리는 중';
      } else if (!inGame()) text = '👀 관전 중';
      else if (inParty() && S.down?.[me] && S.phase === 'act') text = '원혼: 이번 턴 할 일을 했어요';
      else if (S.phase === 'learn' || S.phase === 'mark' || S.phase === 'whisper') text = S.done?.[me] || local.sent ? '골랐어요. 다른 사람을 기다리는 중' : '…';
      else if (S.phase === 'resolve') text = '결과';
      else if (S.phase === 'intro') text = S.again ? '한 판 더!' : '예고를 보고 다 같이 막고 때린다. 금단에 제일 많이 손댄 사람이 마지막 보스.';
      if (hint && hint.until > performance.now()) {
        text = hint.text;
        cls = hint.cls;
      }
      prompt.className = `rd-prompt ${cls}`;
      prompt.textContent = text;
      handEl.replaceChildren(...cards);
      deckEl.replaceChildren(...deck);
      stat.replaceChildren(...bits.filter(Boolean));
      preview.replaceChildren(...(pv ? [pv] : []));
    }
    const TIMES = { cls: CLS_TIME, learn: S.learnKind?.startsWith('start') ? START_LEARN_TIME : LEARN_TIME, mark: MARK_TIME, whisper: WHISPER_TIME, act: ACT_TIME, boss: BOSS_FIRST_TIME };
    const tk = TIMES[S.phase] ? `${S.phase}:${S.no}:${S.tn}` : '';
    if (tk !== keys.timer) {
      keys.timer = tk;
      timer.replaceChildren(...(tk ? [countdown(S.phaseEndsAt, TIMES[S.phase])] : []));
    }
  }

  // 미리 보기: 내 계획만 넣고 돌려 본 결과 (남의 계획에 달린 건 빼고 어림)
  function previewLine(vp) {
    try {
      const S2 = structuredClone(S);
      const out = runTurn(S2, [vp], { bossNow: publicBossPlan(S), ghosts: {} });
      const dealt = Object.values(out.sums.foe).reduce((a, b) => a + b, 0);
      const hurt = out.sums.hurt?.[me] || 0;
      const hpAfter = S2.down?.[me] ? 0 : S2.hp?.[me] || 0;
      const next = Math.min(ENERGY_MAX, Math.min(ENERGY_MAX, vp.energyLeft) + ENERGY_GAIN);
      const over = Math.max(0, vp.energyLeft + ENERGY_GAIN - ENERGY_MAX);
      const dark = vp.cards.filter(c => CARDS[c.k]?.dark).length;
      return h('div', { class: `rd-pv${hpAfter <= 0 ? ' danger' : ''}` },
        `이대로면: 줄 피해 ${dealt} · 맞을 피해 ${hurt} → 남는 체력 ${hpAfter}${hpAfter <= 0 ? ' (쓰러짐!)' : ''} · 남는 기력 ${vp.energyLeft} → 다음 턴 ${next}${over ? ` (${over} 넘침)` : ''}${dark ? ` · 🩸 타락 +${dark}` : ''}`);
    } catch {
      return null;
    }
  }

  function paintOverlay() {
    overlay.classList.toggle('on', tabDown);
    if (!tabDown || !S) return;
    const mine = cardsOf(S, me);
    const C = CLASSES[S.cls?.[me]];
    const trees = C ? C.trees.map(t => {
      const n = treeCount(S, me, t);
      const ps = [2, 4].filter(x => PASSIVES[`${t}${x}`]).map(x => h('li', { class: n >= x ? 'on' : '' }, `${x}장: ${PASSIVES[`${t}${x}`]}`));
      return h('div', { class: 'rd-treebox' }, h('b', {}, `${TREES[t].name} ${n}장${TREES[t].dark ? ' (금단)' : ''}`), h('ul', {}, ps));
    }) : [];
    overlay.replaceChildren(h('h3', {}, '내 덱 8장'), h('div', { class: 'rd-deckrow' }, ...deckRow(mine, null, '')),
      list(P?.draw).length ? h('p', {}, `덱에 남은 것: ${list(P.draw).map(k => CARDS[k]?.name).join(' · ')}`) : null,
      h('div', { class: 'rd-trees' }, trees));
  }

  function paintSide() {
    const k = JSON.stringify([S.log, S.cards?.[me], S.cls?.[me], partyOf(S), S.corrupt, S.boss]);
    if (k === keys.side) return;
    keys.side = k;
    const mine = cardsOf(S, me);
    const C = CLASSES[S.cls?.[me]];
    side.replaceChildren(...[
      h('h3', {}, '원정대'),
      h('ul', { class: 'rules' }, partyOf(S).map(id => h('li', {}, h('b', {}, who(id).name), ` ${CLASSES[S.cls?.[id]]?.name || '-'} · 타락 ${S.corrupt?.[id] || 0}`))),
      S.boss ? h('p', { class: 'rules' }, `😈 ${nameOf(BOSS)}`) : null,
      list(S.log).length ? h('h3', {}, '방금') : null,
      list(S.log).length ? h('ol', { class: 'rd-log' }, list(S.log).map(t => h('li', {}, t))) : null,
      mine.length ? h('h3', {}, `내 덱 (${C?.name || ''})`) : null,
      mine.length ? h('ul', { class: 'rd-cardlist' }, mine.map(c => h('li', { class: CARDS[c.k]?.dark ? 'dark' : '' },
        h('b', {}, CARDS[c.k]?.name), ` (${CARDS[c.k]?.cost}) ${treeLabel(CARDS[c.k])}${c.m ? ` · ${MARKS[c.m]?.name}` : ''} — ${CARDS[c.k]?.tip}`))) : null,
      C ? h('h3', {}, '계열 (Tab으로 자세히)') : null,
      C ? h('ul', { class: 'rules' }, C.trees.map(t => h('li', {}, `${TREES[t].name} ${treeCount(S, me, t)}장${hasP(S, me, `${t}2`) ? ' · 숙련' : ''}${PASSIVES[`${t}4`] && hasP(S, me, `${t}4`) ? ' · 각성' : ''}`))) : null,
      h('h3', {}, '조작'),
      h('ul', { class: 'rules' },
        h('li', {}, '숫자키 기술 → ← → 대상 → 스페이스'),
        h('li', {}, 'Q 고유 기술 · R 버리기(턴마다 1장) · Backspace 처음으로'),
        h('li', {}, '빈손 스페이스 = 준비 완료 · Tab(누르는 동안) 내 덱'),
        h('li', {}, 'Z 막아 줘 · X 차단 간다 · C 살려 줘 · V 모았다')),
      h('h3', {}, '규칙'),
      h('ul', { class: 'rules' },
        h('li', {}, '기력은 턴마다 +3, 안 쓰면 남는다 (최대 6). 오의는 4~5'),
        h('li', {}, '결과: 준비 → 선제 → 공격(준비 순) → 후속 → 회복 → 적 행동'),
        h('li', {}, '적은 지난 턴 제일 많이 때린 사람을 노린다'),
        h('li', {}, '필살기 준비 중엔 차단 게이지를 채우면 그로기 (받는 피해 +50%)'),
        h('li', {}, '덱은 늘 8장. 방을 깨면 배워서 한 장과 바꾸고, 각인을 새긴다'),
        h('li', {}, '속삭임을 받으면 타락 +2, 금단을 쓸 때마다 +1. 마지막에 타락 1위(6 이상)가 마왕'),
        h('li', {}, '최종전에서 금단을 쓰면 마왕 체력 +8 (독박)')),
    ].filter(Boolean));
  }

  function paint() {
    if (!S) return;
    paintHead();
    paintFoes();
    paintInfo();
    paintTicker();
    paintParty();
    paintPanel();
    paintSide();
    paintOverlay();
  }
  const clock = setInterval(() => { if (S && S.phase === 'act') paintParty(); }, 1000); // 신호 말풍선이 사라지게

  // 단계가 바뀔 때 한 번씩
  function onPhase() {
    const ph = S.phase;
    if (ph === 'intro') setBanner('독박 원정대', 'gold');
    if (ph === 'cls') setBanner('직업을 고르세요', 'gold', 1600);
    if (ph === 'learn') setBanner(S.learnKind === 'room' ? '배움' : '시작 기술', 'gold', 1400);
    if (ph === 'mark') setBanner('각인', 'gold', 1400);
    if (ph === 'whisper') setBanner('속삭임…', 'blood', 1600);
    if (ph === 'wreveal') setBanner('속삭임 공개', 'blood', 1600);
    if (ph === 'enter') setBanner(`방 ${S.room + 1} · ${ROOMS[S.room]?.name}`, 'gold', 2000);
    if (ph === 'clear') setBanner('방 돌파!', 'gold', 2000);
    if (ph === 'fall') setBanner(S.fall?.boss === 'king' ? '이름 없는 왕이 깨어난다' : `${who(S.fall?.boss).name} 흑화!`, 'blood');
    if (ph === 'boss') setBanner('최종전: 마왕 대 원정대', 'blood', 2200);
    if (ph === 'act') { // 지난 턴 결과 글줄은 대응하는 동안에도 남겨 둔다 (새 결과가 나올 때 지운다)
      const charging = liveFoes(S).some(k => S.foes[k].charge);
      setBanner(charging ? `${S.turn}턴 · 필살기 준비! 끊어라` : `${S.turn}턴`, charging ? 'blood' : '', 1100);
    }
  }

  return {
    update({ state, priv }) {
      S = state;
      P = priv || null;
      syncLocal();
      const pk = `${S.phase}:${S.no || 0}:${S.tn || 0}`;
      if (!seen) {
        seen = { phase: pk, rs: S.rsNo || 0, final: false };
        onPhase();
      } else if (seen.phase !== pk) {
        seen.phase = pk;
        onPhase();
      }
      if (S.phase === 'resolve' && (S.rsNo || 0) !== seen.rs) {
        seen.rs = S.rsNo || 0;
        onResolve();
      }
      if (S.phase !== 'resolve') { // 결과 연출이 끝났다: 방장이 알려 준 값 그대로
        shown = null;
        prev = { hp: { ...obj(S.hp) }, fhp: Object.fromEntries(Object.entries(obj(S.foes)).map(([k, f]) => [k, f?.hp || 0])) };
      }
      if (local.sel && local.cur && !(isFoeKey(local.cur) ? S.foes?.[local.cur]?.hp > 0 || local.cur === '@all' : partyOf(S).includes(local.cur))) local.cur = null;
      box.classList.toggle('final', S.phase === 'final');
      if (S.phase === 'final' && !seen.final) {
        seen.final = true;
        const pb = S.boss && S.boss !== 'king' ? S.boss : null;
        const title = S.how === 'win' ? '⚔️ 원정대 승리!' : S.how === 'lose' && pb ? `😈 ${josa(nameOf(BOSS), '이', '가')} 이겼다` : '☠ 원정 실패';
        board.replaceChildren(h('div', { class: 'rx-result' },
          h('h2', { class: 'display' }, title),
          podium(list(S.roster), S.standings, me),
          h('ul', { class: 'rd-titles' }, Object.entries(obj(S.titles)).map(([id, ts]) => h('li', {}, h('b', {}, who(id).name), ` ${list(ts).join(' · ')}`)))));
      }
      paint();
    },
    unmount() {
      clearTimeout(planTimer);
      clearInterval(clock);
      for (const t of timers) clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
}
