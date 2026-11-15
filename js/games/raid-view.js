// 독박 원정대 화면 — 규칙은 raid-core.js (방장이 돌린다). 그림은 art/raid.px.js 를 구운 img/raid, 소리는 raid-audio.js
// 글은 짧게 ("ㅁㅁ한 대신 ㅁㅁ한다"), 고르기는 클릭 한 번 (숫자키 · ← → · 스페이스도 된다).
import { h, digitOf, isTyping, josa } from '../util.js';
import { avatar, countdown, podium } from '../ui.js';
import { createRaidAudio } from './raid-audio.js';
import {
  CARDS, CLASSES, CLASS_KEYS, TREES, MARKS, POWERS, PASSIVES, FOES, ROOMS, ULTS, BOSSES,
  ENERGY_MAX, ENERGY_GAIN, THINK_TIME, FALL_MIN,
  BOSS, list, obj, isFoeKey, partyOf, upHeroes, liveFoes, cardsOf, cardOfU, treeCount, awakeOf,
  validatePlan, validateBoss, runTurn, publicBossPlan, qDef, qCostOf, qReady, canMark, isHealCard, isDefCard,
  isVuln, isWeak, isStun, bleedOf, isGroggy, stOf, ammoOf, aimOf, faithOf, roundsOf, ammoMax, faithMax, defaultDrop, incomingTo,
} from './raid-core.js';

const SIG = { z: '막아 줘!', x: '차단 간다!', c: '살려 줘!', v: '모았다!' };
const NEXT = { hit: '공격', all: '전원 공격', charge: '필살기 준비', slam: '내려찍기', bury: '생매장', tomb: '묘비', grow: '자라는 중', groggy: '그로기', ghoul: '망자' };
const NEEDS = new Set(['foe', 'ally', 'other', 'down']);
const dots = (n, max) => '●'.repeat(Math.max(0, Math.min(n, max))) + '○'.repeat(Math.max(0, max - Math.max(0, n)));
const treeName = d => (d.tree === 'base' ? '기본기' : d.tree === 'common' ? '공통' : TREES[d.tree]?.name || '');

/* ── 도트 그림: 정수배로 키워서 쓴다 (사람 · 적 2배, 마왕 3배, 아이콘 1배, 작은 표시 2배) ── */
const ART = new URL('../../img/raid/sprites/', import.meta.url).href;
const SIZE = { // 그림 크기 (도트, 테두리 포함). 여기 없는 건 16×16
  h_guard: [20, 26], h_berserk: [20, 26], h_gunner: [20, 26], h_priest: [20, 26],
  f_ghoul: [18, 24], f_golem: [34, 30], f_keeper: [28, 34], f_skel: [16, 20], f_tomb: [14, 16],
  b_guard: [34, 36], b_berserk: [34, 36], b_gunner: [34, 36], b_priest: [34, 36], b_king: [34, 36],
  s_ammo: [5, 8], s_bleed: [7, 7], s_block: [8, 8], s_corrupt: [7, 8], s_dark: [6, 6], s_en: [6, 6], s_faith: [6, 9],
  s_heart: [9, 8], s_stun: [7, 7], s_vuln: [9, 8], s_ward: [9, 9], s_weak: [8, 8],
};
function spr(name, cls = '', scale = 2, title = '') {
  const [w, hh] = SIZE[name] || [16, 16];
  return h('img', { class: `rd-spr ${cls}`, src: `${ART}${name}.png`, alt: title, title: title || null, draggable: 'false', width: w * scale, height: hh * scale });
}
const ico = (name, title = '') => (name ? spr(name, 'rd-ico', name.startsWith('s_') ? 2 : 1, title) : null); // 글줄 속 아이콘
const ic = (name, v, title = '') => h('span', { class: 'rd-ic', title: title || null }, ico(name), v == null ? null : String(v));
// 기술 그림: 효과로 고른다 (위에 있는 것이 먼저). 맞는 게 없으면 직업 무기
const WEAPON = { guard: 'k_blade', berserk: 'k_axe', gunner: 'k_gun', priest: 'k_smite' };
const ART_OF_FX = [
  ['k_revive', 'revive'], ['k_boom', 'hitAllies splash teamDmg'], ['k_aoe', 'dmgAll bleedAll brkAll'],
  ['k_bleed', 'bleed bleedDouble bleedHitPlus dmgFromBleed'], ['k_cost', 'hpCost plusLostHp selfVuln'], ['k_break', 'brk'],
  ['k_aim', 'aim aimDouble aimIfNoShot'], ['k_ammo', 'ammo rounds reload'], ['k_debuff', 'vuln weak deathMark'],
  ['k_thorn', 'thorns dmgFromBlock dmgLastBlocked avenge'],
  ['k_shield', 'block blockSelf blockFromMine blockIfNoAtk intercept taunt ward absorbAll undying'],
  ['k_heal', 'heal healMostHurt regen allyHp cleanse transfer'], ['k_energy', 'energy energyNext handNext'],
  ['k_buff', 'nextAtk atkFirst atkPlus focus shotPlus aura'],
].map(([art, fx]) => [art, new Set(fx.split(' '))]);
function cardArt(d, cls) {
  if (!d) return 'k_blade';
  if (d.dark) return 'k_dark';
  const fx = (d.fx || []).map(f => f[0]);
  return ART_OF_FX.find(([, s]) => fx.some(x => s.has(x)))?.[0] || WEAPON[d.cls || cls] || 'k_blade';
}
const powerArt = p => (!p ? 'k_dark' : p.doom ? 'i_skull' : p.veil ? 'i_q' : p.summon ? 'i_coffin' : p.all ? 'k_aoe' : p.steal ? 'k_bleed'
  : p.later ? 'k_aim' : p.prep ? (p.aim ? 'k_debuff' : 'k_shield') : p.aim && !p.v ? 'k_debuff' : WEAPON[p.cls] || 'k_blade');
const LORDS = new Set(['guard', 'berserk', 'gunner', 'priest']);

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
  const btns = h('div', { class: 'rd-btns' });
  const handEl = h('div', { class: 'rd-hand' });
  const deckEl = h('div', { class: 'rd-deckrow' });
  const foot = h('div', { class: 'rd-foot' });
  const timer = h('div', { class: 'rd-timer' });
  const panel = h('div', { class: 'rd-panel' }, h('div', { class: 'rd-top' }, prompt, btns), handEl, deckEl, foot, timer);
  const overlay = h('div', { class: 'rd-overlay' });
  const board = h('div', { class: 'rd-board' });
  const box = h('div', { class: 'rd-box' }, foesEl, mid, partyEl, panel, overlay, board);
  const sound = h('button', { class: 'rd-btn rd-sound', type: 'button', tabindex: '-1' });
  const sideBody = h('div');
  const side = h('aside', { class: 'side' }, sound, sideBody);
  root.append(h('div', { class: 'rd' }, h('div', { class: 'rd-main' }, head, box), side));
  const audio = createRaidAudio();
  const soundLabel = () => { sound.textContent = audio.enabled ? '소리 켜짐' : '소리 꺼짐'; };
  soundLabel();
  sound.addEventListener('click', () => { audio.toggle(); soundLabel(); sound.blur(); });
  const unlock = () => { void audio.unlock(); };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  document.activeElement?.blur?.();
  document.fonts?.load('28px "Galmuri14"', '독박 원정대 흑화').catch(() => {});

  let S = null;
  let P = null;
  let local = {};
  let localKey = '';
  let seen = null;
  let prev = null;   // 결과가 나오기 전의 체력 (결과를 차례대로 보여 주려고)
  let shown = null;  // 결과 연출 중에 보여 주는 체력
  let flashId = null; // 방금 맞은 쪽 (그림이 흔들린다)
  let lines = [];    // 결과 글줄
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
  function nope(text) {
    audio.deny();
    panel.classList.remove('nope');
    void panel.offsetWidth;
    panel.classList.add('nope');
    hint = { text, until: performance.now() + 2200 };
    later(2230, paint);
    paint();
  }

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

  /* ── 대응: 계획 ── */
  const GIVERS = new Set(['energy', 'ammo']);
  const giver = a => (CARDS[cardOfU(S, me, a.u)?.k]?.fx.some(([op]) => GIVERS.has(op)) ? 1 : 0);
  const ordered = acts => [...acts].sort((a, b) => giver(b) - giver(a)); // 기력 · 탄을 주는 카드 먼저
  const planOf = (acts = local.acts) => ({ turn: S.tn, acts: ordered(acts), q: local.q, drop: local.drop });
  const vpOf = (acts = local.acts) => validatePlan(S, me, planOf(acts), handUs());
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
    audio.pick();
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
  // 지금 고르고 있는 카드의 대상들 (화면에서 눌러서 고를 수 있게 빛난다)
  function pickable() {
    if (!local.sel || !S) return [];
    if (modeOf() === 'boss') return upHeroes(S);
    const to = local.sel === '@q' ? 'ally' : CARDS[cardOfU(S, me, local.sel)?.k]?.to;
    return targetsFor(to, cardOfU(S, me, local.sel)?.k);
  }
  function tryAdd(entry) {
    const before = vpOf();
    const next = [...local.acts, entry];
    if (!vpOf(next).cards.some(c => c.u === entry.u)) {
      const d = CARDS[cardOfU(S, me, entry.u)?.k];
      return nope(d?.ammo && before.ammoLeft < (d.ammo === 'all' ? 1 : d.ammo) ? '탄이 모자라요 (Q 재장전)' : `기력이 모자라요 (남은 ${before.energyLeft})`);
    }
    local.acts = next;
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
    if (local.sel === c.u) {
      local.sel = null;
      return paint();
    }
    if (local.drop === c.u) local.drop = null;
    const d = CARDS[c.k];
    if (NEEDS.has(d.to)) {
      const ts = targetsFor(d.to, c.k);
      if (!ts.length) return nope(d.to === 'down' ? '쓰러진 아군이 없어요' : '대상이 없어요');
      if (ts.length === 1) return tryAdd({ u: c.u, t: ts[0] });
      local.sel = c.u;
      local.cur = defaultTarget(d.to, c.k);
      return paint();
    }
    tryAdd({ u: c.u, t: null });
  }
  function confirmSel(t = local.cur) {
    const u = local.sel;
    local.sel = null;
    if (!t) return paint();
    if (modeOf() === 'boss') return addPower({ u, t });
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
    if (!qReady(S, me)) return nope(`${Q.name}: ${(S.cd?.[me] || 0) - S.tn}턴 뒤에`);
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
    const ts = pickable();
    if (!ts.length) return;
    const i = ts.indexOf(local.cur);
    local.cur = ts[(i + dir + ts.length) % ts.length];
    paint();
  }
  function readyUp() {
    audio.ready();
    local.ready = true;
    local.sel = null;
    sendPlan(true);
    paint();
  }
  function clearPlan() {
    Object.assign(local, { acts: [], q: null, drop: null, sel: null, dropMode: false, bacts: [], veil: null });
    touch();
  }
  function toggleDrop() {
    local.dropMode = !local.dropMode;
    local.sel = null;
    paint();
  }

  /* ── 마왕: 다음 턴 권능 ── */
  const bossVb = (acts = local.bacts) => validateBoss(S, { acts, veil: local.veil }, handUs(), S.dark || 0);
  function pressPower(i) {
    const c = hand()[i];
    if (!c) return;
    const at = local.bacts.findIndex(a => a.u === c.u);
    if (at >= 0) {
      local.bacts.splice(at, 1);
      if (local.veil === c.u || c.k === 'veil') local.veil = null;
      return touch();
    }
    if (POWERS[c.k].aim) {
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
      return nope(k === 'doom' && S.foes?.[BOSS]?.charge ? '종말은 한 번에 하나' : `어둠이 모자라요 (${S.dark || 0})`);
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
  function bossReadyUp() {
    if (local.sel) return;
    audio.ready();
    local.ready = true;
    sendBoss(true);
    paint();
  }

  /* ── 배움 · 각인 · 속삭임 ── */
  const stepU = (cards, u, dir) => {
    if (!cards.length) return null;
    const i = cards.findIndex(c => c.u === u);
    return cards[(i + dir + cards.length) % cards.length].u;
  };
  function pickOffer(mode, i) {
    audio.pick();
    const deck = cardsOf(S, me);
    if (mode === 'learn' && list(P.offers)[i]) {
      local.pick = i;
      local.dropU ??= defaultDrop(S, me);
    }
    if (mode === 'mark') {
      const m = list(P.markOffers)[i];
      if (!m) return;
      local.pick = i;
      const ok = deck.filter(c => canMark(c, m));
      if (!ok.some(c => c.u === local.dropU)) local.dropU = [...ok].sort((a, b) => (b.n || 0) - (a.n || 0))[0]?.u ?? null;
    }
    if (mode === 'whisper') {
      if (i === 0) {
        local.take = true;
        local.dropU ??= defaultDrop(S, me);
      } else return answerWhisper(false);
    }
    paint();
  }
  function pickDeck(u) {
    const mode = modeOf();
    const c = cardOfU(S, me, u);
    if (!c) return;
    audio.pick();
    if (mode === 'mark' && !canMark(c, list(P.markOffers)[local.pick])) return nope('여기엔 못 새겨요');
    if (mode === 'learn' || mode === 'mark' || (mode === 'whisper' && local.take)) local.dropU = u;
    paint();
  }
  function confirmPick() {
    const mode = modeOf();
    if (mode === 'learn') {
      if (local.pick == null) return nope('배울 기술을 고르세요');
      local.sent = true;
      api.send('learn', { no: S.no, i: local.pick, drop: local.dropU ?? defaultDrop(S, me) });
    }
    if (mode === 'mark') {
      if (local.pick == null || local.dropU == null) return nope('각인과 새길 기술을 고르세요');
      local.sent = true;
      api.send('mark', { no: S.no, k: list(P.markOffers)[local.pick], u: local.dropU });
    }
    if (mode === 'whisper') {
      if (!local.take) return nope('받을지 거절할지 고르세요');
      return answerWhisper(true);
    }
    if (local.sent) audio.ready();
    paint();
  }
  function answerWhisper(take) {
    if (take) audio.dark(); else audio.ready();
    local.sent = true;
    api.send('whisper', { no: S.no, take, ...(take ? { drop: local.dropU ?? defaultDrop(S, me) } : {}) });
    paint();
  }
  function skipLearn() {
    if (modeOf() !== 'learn' || S.learnKind !== 'room') return;
    local.sent = true;
    api.send('learn', { no: S.no, skip: true });
    paint();
  }

  /* ── 누르기: 적 · 아군 상자 ── */
  function clickUnit(id) {
    const mode = modeOf();
    if (mode === 'ghost') {
      local.sent = true;
      api.send('ghost', { turn: S.tn, k: isFoeKey(id) ? 'curse' : 'guard', t: id });
      return paint();
    }
    if (!local.sel || !pickable().includes(id)) return;
    confirmSel(id);
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
    if (S.phase === 'act' && inParty() && c === 'KeyV') return api.send('sig', { k: 'v' });
    if (!mode) return;
    if (mode === 'cls') {
      const k = CLASS_KEYS[d - 1];
      if (k) pickClass(k);
      return;
    }
    if (mode === 'learn' || mode === 'mark' || mode === 'whisper') {
      if (d) return pickOffer(mode, d - 1);
      if (dir) {
        const deck = cardsOf(S, me);
        const pool = mode === 'mark' ? deck.filter(x => canMark(x, list(P.markOffers)[local.pick])) : deck;
        if (mode !== 'whisper' || local.take) local.dropU = stepU(pool, local.dropU ?? defaultDrop(S, me), dir);
        return paint();
      }
      if (space) return confirmPick();
      if (back && mode === 'learn') return skipLearn();
      return;
    }
    if (mode === 'ghost') {
      const ts = [...upHeroes(S), ...liveFoes(S)];
      if (dir && ts.length) {
        const i = ts.indexOf(local.cur);
        local.cur = ts[(i + dir + ts.length) % ts.length];
        return paint();
      }
      if (space && local.cur) clickUnit(local.cur);
      return;
    }
    if (mode === 'boss') {
      if (d) return pressPower(d - 1);
      if (dir && local.sel) return moveCursor(dir);
      if (space) return local.sel ? confirmSel() : bossReadyUp();
      if (c === 'KeyV') return toggleVeil();
      if (back) return clearPlan();
      return;
    }
    if (d) return pressCard(d - 1);
    if (dir && local.sel) return moveCursor(dir);
    if (space) return local.sel ? confirmSel() : readyUp();
    if (c === 'KeyQ') return pressQ();
    if (c === 'KeyR') return toggleDrop();
    if (back) clearPlan();
  }
  function onKeyUp(e) {
    if (e.code !== 'Tab') return;
    tabDown = false;
    paintOverlay();
  }
  function pickClass(k) {
    local.cls = k;
    api.send('cls', { k });
    paint();
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);

  /* ── 글로 옮기기 (짧게): [아이콘, 글] ── */
  function intentText(it) {
    const to = list(it.to).map(nameOf).join(' · ');
    switch (it.k) {
      case 'hit': return ['k_blade', `${to} ${it.v}`];
      case 'all': return ['k_aoe', `전원 ${it.v}`];
      case 'charge': return ['i_warn', `${ULTS[it.u]?.name} ${Math.max(0, it.fire - S.tn)}턴 뒤`];
      case 'slam': return ['k_boom', `내려찍기 ${to} ${it.v}`];
      case 'bury': return ['i_coffin', `생매장 전원 ${it.v} + 기절`];
      case 'doom': return ['i_skull', `종말 전원 ${it.v}`];
      case 'tomb': return ['f_tomb', '묘비'];
      case 'grow': return ['f_tomb', `${Math.max(0, it.at - S.tn)}턴 뒤 망자`];
      case 'groggy': return ['s_stun', '그로기'];
      case 'later': return ['k_aim', `${to} ${it.v}`];
      case '?': return ['i_q', '가려진 권능'];
      case 'p': return [powerArt(POWERS[it.p]), powerText(it)];
      default: return [null, ''];
    }
  }
  function powerText(it) {
    const Pw = POWERS[it.p] || { name: it.p };
    const to = [...list(it.to), ...list(it.rand)].map(nameOf).join(' · ');
    return `${Pw.name}${to ? ` ${to}` : ''}${it.v ? ` ${it.v}${Pw.times ? `×${Pw.times}` : ''}` : ''}`;
  }
  const cardName = e => (e.c === '@q' ? qDef(S, e.by)?.name || '고유 기술' : CARDS[e.c]?.name || e.c);
  // 결과 한 줄: [아이콘, 글, 들여쓰기]
  function sceneText(e) {
    const n = nameOf;
    const st = { vuln: ['s_vuln', '취약'], weak: ['s_weak', '약화'], bleed: ['s_bleed', `출혈 +${e.v}`] }[e.s] || ['k_debuff', '저주'];
    switch (e.k) {
      case 'use': return [e.c === '@q' ? cardArt(qDef(S, e.by), S.cls?.[e.by]) : cardArt(CARDS[e.c]), `${n(e.by)} ▸ ${cardName(e)}${e.t ? ` → ${n(e.t)}` : ''}`];
      case 'hit': return [null, `${n(e.to)} -${e.d}${e.a ? ` (방어 ${e.a})` : ''}`, 1];
      case 'hurt': return [e.d ? null : 's_block', `${n(e.to)} ${e.d ? `-${e.d}` : '막음'}${e.a ? ` (방어 ${e.a})` : ''}`, 1];
      case 'blk': return ['s_block', `${n(e.to)} +${e.v}`, 1];
      case 'heal': return ['s_heart', `${n(e.to)} +${e.v}`, 1];
      case 'brk': return ['k_break', `차단 +${e.v} (${e.got}/${e.need})`, 1];
      case 'groggy': return ['s_stun', `${n(e.to)} 그로기!`];
      case 'down': return ['i_skull', `${n(e.to)} 쓰러짐`];
      case 'die': return ['i_skull', n(e.to)];
      case 'corrupt': return e.v ? ['s_corrupt', `${n(e.to)} 타락 +${e.v}`] : [null, ''];
      case 'feed': return ['s_corrupt', `독박! 마왕 +${e.v}`];
      case 'power': return [powerArt(POWERS[e.p]), powerText({ p: e.p, to: e.to })];
      case 'ult': return ['k_boom', `${ULTS[e.u]?.name}!`];
      case 'act': return [e.a === 'all' ? 'k_aoe' : 'k_blade', `${n(e.by)} ▸ ${e.a === 'all' ? '전원 공격' : '공격'}`];
      case 'spawn': return ['i_coffin', n(e.to)];
      case 'st': return [st[0], `${n(e.to)} ${st[1]}`, 1];
      case 'bleed': return ['s_bleed', `${n(e.to)} 출혈 -${e.d}`, 1];
      case 'cost': return ['k_cost', `${n(e.to)} -${e.v}`, 1];
      case 'save': return ['s_ward', `${n(e.to)} 버텼다`];
      case 'rise': return ['k_revive', `${n(e.to)} 일어섰다`];
      case 'bheal': return ['s_heart', `${n(BOSS)} +${e.v}`, 1];
      default: return [null, ''];
    }
  }
  // 장면마다 소리
  function soundOf(e) {
    const big = (e.d || 0) >= 20 || e.dead;
    switch (e.k) {
      case 'use': return CARDS[e.c] && !isHealCard(CARDS[e.c]) && !isDefCard(CARDS[e.c]) ? audio.swing() : null;
      case 'act': return audio.swing();
      case 'hit': return audio.hit(big);
      case 'hurt': return e.d ? audio.hurt(big, e.to === me) : audio.block();
      case 'blk': return audio.block();
      case 'heal': case 'bheal': case 'save': case 'rise': return audio.heal();
      case 'brk': return audio.brk(e.got / Math.max(1, e.need));
      case 'groggy': return audio.groggy();
      case 'down': return audio.down(e.to === me);
      case 'die': return audio.die();
      case 'corrupt': case 'feed': case 'power': return audio.dark();
      case 'ult': return audio.ult();
      case 'spawn': return audio.rise();
      case 'st': case 'bleed': case 'cost': return audio.bleed();
      default: return null;
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
      soundOf(e);
      flashId = ['hit', 'hurt', 'bleed'].includes(e.k) && e.d ? e.to : null;
      const [i, t, sub] = sceneText(e);
      if (t) lines = [...lines, { t, i, sub, k: e.k, me: e.to === me || e.by === me }].slice(-7);
      if (e.k === 'groggy') setBanner(`${nameOf(e.to)} 그로기!`, 'gold', 1300);
      if (e.k === 'down' && e.to === me) setBanner('쓰러졌다', 'blood', 1300);
      if (e.k === 'ult') setBanner(`${ULTS[e.u]?.name}!`, 'blood', 1300);
      if (e.k === 'feed' && e.by === me) setBanner('독박! 마왕이 회복했다', 'blood', 1300);
      paintHead();
      paintFoes();
      paintParty();
      paintTicker();
    }));
  }

  /* ── 그리기 ── */
  function bar(cur, max, cls = '', extra = null) {
    const w = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
    return h('span', { class: `rd-bar ${cls}` }, h('i', { style: `width:${w}%` }), h('b', {}, `${cur}/${max}`), extra);
  }
  function stTags(u) {
    const t = [isVuln(S, u) && ['s_vuln', null, '취약'], isWeak(S, u) && ['s_weak', null, '약화'], isStun(S, u) && ['s_stun', null, '기절'],
      bleedOf(S, u) && ['s_bleed', bleedOf(S, u), '출혈'], stOf(S, u).ward && ['s_ward', null, '가호']].filter(Boolean);
    return t.length ? h('span', { class: 'rd-st' }, t.map(([i, v, name]) => ic(i, v, name))) : null;
  }
  // 마왕: 머리 자리에 그 친구 얼굴을 얹는다 (이름 없는 왕은 해골)
  function lordEl() {
    const b = S.boss && S.boss !== 'king' ? S.boss : null;
    const kind = b && LORDS.has(S.bossCls) ? S.bossCls : 'king';
    return h('span', { class: 'rd-lord' }, spr(`b_${kind}`, 'rd-fspr', 3), kind !== 'king' ? avatar(who(b), 'rd-face') : null);
  }
  function resShort(id) {
    const cls = S.cls?.[id];
    if (cls === 'gunner') {
      const R = roundsOf(S, id);
      return `탄${ammoOf(S, id)}/${ammoMax(S, id)}${aimOf(S, id) ? ` 조준${aimOf(S, id)}` : ''}${R.ap ? ` 철갑${R.ap}` : ''}${R.fire ? ` 소이${R.fire}` : ''}`;
    }
    if (cls === 'priest') return `신앙${faithOf(S, id)}/${faithMax(S, id)}`;
    if (cls === 'berserk') {
      const b = Math.floor(Math.max(0, (S.maxHp[id] || 0) - (S.hp[id] || 0)) / 10) * 2;
      return b ? `공격+${b}` : '';
    }
    return '';
  }

  function paintHead() {
    const room = S.room === 3 ? '최종전' : S.room >= 0 ? `방 ${S.room + 1} · ${ROOMS[S.room]?.name}` : '출발 전';
    const left = `${room}${S.phase === 'act' || S.phase === 'resolve' ? ` · ${S.turn}턴` : ''}`;
    const mine = inParty() && !!S.cls?.[me];
    const k = JSON.stringify([left, mine, hpOf(me), S.energy?.[me], S.corrupt?.[me], me === S.boss, S.dark, inGame()]);
    if (keys.head === k) return;
    keys.head = k;
    const right = mine ? [ic('s_heart', hpOf(me), '체력'), ic('s_en', S.energy?.[me] ?? 0, '기력'), ic('s_corrupt', S.corrupt?.[me] || 0, '타락')]
      : me === S.boss ? [ic('s_dark', `어둠 ${S.dark || 0}`)] : inGame() ? [] : ['관전 중'];
    head.replaceChildren(h('span', {}, left), h('span', { class: 'rd-hstat' }, right));
  }

  function paintFoes() {
    const ks = Object.keys(obj(S.foes)).filter(k => foeHp(k) > 0 || (shown && S.foes[k]));
    const pick = pickable();
    const ghost = modeOf() === 'ghost';
    const key = JSON.stringify([ks.map(k => [k, foeHp(k), S.foes[k].block, S.foes[k].intent, S.foes[k].next, S.foes[k].charge, S.foes[k].groggy, stOf(S, k)]),
      S.pre?.foe, S.pre?.brk, pick, local.cur, S.tn, S.phase, S.dark, ghost, flashId, S.boss, S.bossCls]);
    if (key === keys.foes) return;
    keys.foes = key;
    foesEl.replaceChildren(...ks.map(k => {
      const f = S.foes[k];
      const c = f.charge;
      const moved = S.phase === 'act' ? S.pre?.foe?.[k] || 0 : 0;
      const pb = S.phase === 'act' ? S.pre?.brk?.[k] || 0 : 0;
      const can = pick.includes(k) || (ghost && foeHp(k) > 0);
      return h('div', {
        class: `rd-foe${k === BOSS ? ' boss' : ''}${isGroggy(S, k) ? ' groggy' : ''}${can ? ' pick' : ''}${local.sel && local.cur === k ? ' aim' : ''}${foeHp(k) <= 0 ? ' dead' : ''}${flashId === k ? ' hit' : ''}`,
        onClick: () => clickUnit(k),
      },
      k === BOSS ? lordEl() : spr(`f_${f.k}`, 'rd-fspr', 2),
      h('div', { class: 'rd-finfo' },
        h('div', { class: 'rd-fname' }, h('b', {}, nameOf(k)), f.block ? h('span', { class: 'rd-blk' }, ic('s_block', f.block, '방어')) : null, stTags(k)),
        bar(foeHp(k), f.max, 'foe', moved ? h('em', { class: 'rd-pre' }, `-${moved}`) : null),
        c ? h('div', { class: 'rd-gauge' }, ico('i_warn'), ULTS[c.u]?.name, bar(c.got || 0, c.need, 'brk', pb ? h('em', { class: 'rd-pre' }, `+${pb}`) : null), `${Math.max(0, c.fire - S.tn)}턴`) : null,
        h('ul', { class: 'rd-intent' }, list(f.intent).map(it => {
          const [i, t] = intentText(it);
          return h('li', { class: list(it.to).includes(me) || ['all', 'bury', 'doom'].includes(it.k) ? 'me' : '' }, ico(i), t);
        })),
        list(f.next).length ? h('div', { class: 'rd-next' }, `다음: ${list(f.next).map(x => NEXT[x] || x).join(' · ')}`) : null));
    }));
  }

  function paintParty() {
    const ids = partyOf(S);
    const now = api.now();
    const pick = pickable();
    const ghost = modeOf() === 'ghost';
    const key = JSON.stringify([ids.map(id => [id, hpOf(id), S.maxHp?.[id], S.block?.[id], S.energy?.[id], S.res?.[id], S.corrupt?.[id], S.acts?.[id], S.ready?.[id],
      S.down?.[id], stOf(S, id), S.sig?.[id], S.cls?.[id], S.ghost?.[id]]), S.pre?.ally, S.pre?.threat, pick, local.cur, S.phase, S.tn, ghost,
    Math.floor(now / 1000), Object.keys(obj(S.foes)).map(k => S.foes[k]?.intent), flashId]);
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
      const can = pick.includes(id) || (ghost && !S.down?.[id]);
      const plan = S.down?.[id] ? [ico('i_skull', S.ghost?.[id] ? '원혼' : '쓰러짐')]
        : [a.a && ico('k_blade', '공격'), a.d && ico('k_shield', '방어'), a.h && ico('k_heal', '회복')];
      const st = stTags(id);
      const loud = sig && now - sig.at < 3000;
      return h('div', {
        class: `rd-hero${id === me ? ' me' : ''}${S.down?.[id] ? ' down' : ''}${can ? ' pick' : ''}${local.sel && local.cur === id ? ' aim' : ''}${flashId === id ? ' hit' : ''}`,
        onClick: () => clickUnit(id),
      },
      C ? spr(`h_${S.cls[id]}`, `rd-hspr c${Math.min(3, Math.floor((S.corrupt?.[id] || 0) / 3))}`, 2) : h('span', { class: 'rd-hspr none' }), // 타락 3 · 6 · 9마다 검게
      h('div', { class: 'rd-hinfo' },
        h('div', { class: 'rd-hrow' }, avatar(who(id), 'xs'), h('b', {}, who(id).name), aw ? h('span', { class: 'rd-sub' }, aw) : null,
          h('span', { class: 'rd-acts' }, plan, S.ready?.[id] ? h('em', {}, ' ✓') : null)),
        C ? bar(hpOf(id), S.maxHp?.[id] || 0, 'hp', pre.heal ? h('em', { class: 'rd-pre' }, `+${pre.heal}`) : null) : h('span', { class: 'rd-sub' }, '직업 고르는 중'),
        C ? h('div', { class: 'rd-hrow small' },
          h('span', { class: 'rd-blk' }, ic('s_block', `${S.block?.[id] || 0}${pre.blk ? `+${pre.blk}` : ''}`, '방어')),
          h('span', { class: 'rd-en' }, ic('s_en', S.energy?.[id] || 0, '기력')),
          h('span', { class: 'rd-res' }, resShort(id)),
          h('span', { class: `rd-corrupt${(S.corrupt?.[id] || 0) >= FALL_MIN ? ' hot' : ''}` }, ic('s_corrupt', S.corrupt?.[id] || 0, '타락'))) : null,
        inc || threat.includes(id) || st || loud ? h('div', { class: 'rd-hrow small' },
          inc ? h('span', { class: 'rd-inc' }, ic('k_blade', inc, '받을 피해')) : null,
          threat.includes(id) && S.phase === 'act' ? h('span', { class: 'rd-threat' }, '다음 표적') : null,
          st,
          loud ? h('span', { class: 'rd-sig' }, SIG[sig.k]) : null) : null));
    }));
  }

  function paintTicker() {
    const k = JSON.stringify(lines);
    if (keys.ticker === k) return;
    keys.ticker = k;
    ticker.replaceChildren(...lines.map(l => h('li', { class: `${l.k}${l.me ? ' me' : ''}${l.sub ? ' sub' : ''}` }, ico(l.i), l.t)));
  }

  // 가운데: 단계마다 보여 줄 표 (기여도 · 속삭임 공개 · 흑화)
  function paintInfo() {
    const k = JSON.stringify([S.phase, S.table, S.wshow, S.fall, S.learned, S.marked, S.clsPick, S.no]);
    if (keys.info === k) return;
    keys.info = k;
    let out = [];
    const row = (items, cls = () => '') => h('ul', { class: 'rd-table' }, items.map(([id, t]) => h('li', { class: cls(id) }, h('b', {}, who(id).name), ` ${t}`)));
    if (S.phase === 'clear') {
      out = [h('h3', {}, '기여도'), row(list(S.table).map(r => [r.id, `${r.v}${r.id === S.mvp ? ' · 다음 배움 +1장' : ''}`]), id => (id === S.mvp ? 'mvp' : ''))];
    } else if (S.phase === 'wreveal') {
      out = [h('h3', {}, '속삭임'), row(partyOf(S).map(id => {
        const w = S.wshow?.[id];
        return [id, w?.take ? `${CARDS[w.k]?.name} 받음 · 타락 +${w.v ?? 2}` : '거절'];
      }), id => (S.wshow?.[id]?.take ? 'dark' : ''))];
    } else if (S.phase === 'fall' && S.fall) {
      const b = S.fall.boss;
      out = [h('h3', {}, `타락 1위(${FALL_MIN} 이상)가 마왕`), row(list(S.fall.list).map(r => [r.id, `타락 ${r.c}${r.id === b ? ' → 마왕' : ''}`]), id => (id === b ? 'dark' : '')),
        list(S.fall.tie).length ? h('p', {}, '동률 → 룰렛') : null,
        h('p', {}, b === 'king' ? '아무도 흑화하지 않았다 → 이름 없는 왕' : `${BOSSES[S.cls?.[b]]?.name}: ${BOSSES[S.cls?.[b]]?.passive}`)];
    } else if (S.phase === 'boss') {
      out = [h('p', {}, `${nameOf(BOSS)}: ${BOSSES[S.bossCls]?.passive} · 답: ${BOSSES[S.bossCls]?.answer}`)];
    } else if (S.phase === 'mark' || (S.phase === 'learn' && Object.keys(obj(S.learned)).length)) {
      const L = Object.entries(obj(S.learned));
      out = L.length ? [h('h3', {}, '배운 것'), row(L.map(([id, x]) => [id, x.skip ? '건너뜀' : `${CARDS[x.k]?.name}${x.drop ? ` ← ${CARDS[x.drop]?.name}` : ''}`]))] : [];
    } else if (S.phase === 'whisper' && Object.keys(obj(S.marked)).length) {
      out = [h('h3', {}, '새긴 각인'), row(Object.entries(obj(S.marked)).map(([id, x]) => [id, `${CARDS[x.k]?.name} · ${MARKS[x.m]?.name}`]))];
    } else if (S.phase === 'cls') {
      out = [row(partyOf(S).map(id => [id, CLASSES[S.clsPick?.[id]]?.name || '…']))];
    }
    info.replaceChildren(...out.filter(Boolean));
  }

  // 카드 한 장 (손패 · 배움 · 속삭임)
  function cardEl(c, i, state, note = '', onClick = null) {
    const d = CARDS[c.k] || { name: c.k, cost: 0, tip: '', fx: [] };
    const tag = [d.ult && '오의', d.spd === 'first' && '선제', d.spd === 'last' && '후속', d.dark && '금단', c.m && MARKS[c.m]?.name].filter(Boolean).join(' · ');
    return h('button', {
      class: `rd-card ${state}${d.dark ? ' dark' : ''}${d.ult ? ' ult' : ''}`, type: 'button', tabindex: '-1',
      title: `${d.name} · ${treeName(d)}${c.m ? ` · ${MARKS[c.m]?.name}: ${MARKS[c.m]?.tip}` : ''}`,
      onClick: e => { e.currentTarget.blur(); onClick?.(); },
    },
    i != null ? h('span', { class: 'rd-key' }, String(i + 1)) : null,
    h('span', { class: 'rd-cost' }, `${dots(d.cost, d.cost) || '공짜'}${d.ammo ? ` 탄${d.ammo === 'all' ? '전부' : d.ammo}` : ''}`),
    h('span', { class: 'rd-chead' }, spr(cardArt(d), 'rd-cart', 2), h('b', { class: 'rd-cname' }, d.name)),
    h('span', { class: 'rd-ctip' }, d.tip),
    tag ? h('span', { class: 'rd-tags' }, tag) : null,
    note ? h('span', { class: 'rd-note' }, note) : null);
  }
  const button = (label, onClick, cls = '', key = '') => h('button', {
    class: `rd-btn ${cls}`, type: 'button', tabindex: '-1',
    onClick: e => { e.currentTarget.blur(); onClick(); },
  }, label, key ? h('kbd', {}, key) : null);
  const deckRow = (cur, ok = () => true, onPick = null) => cardsOf(S, me).map(c => {
    const d = CARDS[c.k];
    return h('button', {
      class: `rd-mini${c.u === cur ? ' on' : ''}${ok(c) ? '' : ' off'}${d?.dark ? ' dark' : ''}`, type: 'button', tabindex: '-1', title: d?.tip || '',
      onClick: e => { e.currentTarget.blur(); onPick?.(c.u); },
    }, ico(cardArt(d)), d?.name || c.k, c.m ? h('em', {}, ` ${MARKS[c.m]?.name}`) : null);
  });

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
      let bs = [];
      let ft = [];
      if (mode === 'cls') {
        text = '직업을 고르세요';
        cards = CLASS_KEYS.map((key, i) => {
          const C = CLASSES[key];
          return h('button', { class: `rd-card cls${(local.cls || S.clsPick?.[me]) === key ? ' on' : ' can'}`, type: 'button', tabindex: '-1', onClick: e => { e.currentTarget.blur(); pickClass(key); } },
            h('span', { class: 'rd-key' }, String(i + 1)),
            h('span', { class: 'rd-chead' }, spr(`h_${key}`, 'rd-cart', 3), h('span', { class: 'rd-cwho' }, h('b', { class: 'rd-cname' }, C.name), h('span', { class: 'rd-sub' }, `체력 ${C.hp} · ${C.weapon}`))),
            h('span', { class: 'rd-line' }, C.line), h('span', { class: 'rd-ctip' }, `${C.res}: ${C.resTip}`), h('span', { class: 'rd-ctip' }, `Q ${C.q.name}: ${C.q.tip}`));
        });
      } else if (mode === 'learn') {
        text = '배울 기술 하나 → 바꿀 카드';
        cards = list(P.offers).map((key, i) => {
          const d = CARDS[key];
          const now = d.tree === 'common' ? null : treeCount(S, me, d.tree);
          const note = now == null ? '공통' : `${TREES[d.tree].name} ${now}→${now + 1}${now + 1 === 2 ? ' 숙련!' : now + 1 === 4 ? ' 각성!' : ''}`;
          return cardEl({ k: key }, i, local.pick === i ? 'on' : 'can', note, () => pickOffer('learn', i));
        });
        if (local.pick != null) deck = [h('span', { class: 'rd-deck-label' }, '바꿀 카드'), ...deckRow(local.dropU ?? defaultDrop(S, me), () => true, pickDeck)];
        bs = [S.learnKind === 'room' ? button('건너뛰기 (체력 +6)', skipLearn, '', '⌫') : null, button('배우기', confirmPick, local.pick != null ? 'go' : 'off', '␣')];
      } else if (mode === 'mark') {
        const offers = list(P.markOffers);
        text = '각인 하나 → 새길 기술';
        cards = offers.map((m, i) => h('button', { class: `rd-card mark${local.pick === i ? ' on' : ' can'}`, type: 'button', tabindex: '-1', onClick: e => { e.currentTarget.blur(); pickOffer('mark', i); } },
          h('span', { class: 'rd-key' }, String(i + 1)), h('b', { class: 'rd-cname' }, MARKS[m].name), h('span', { class: 'rd-ctip' }, MARKS[m].tip)));
        const m = offers[local.pick];
        if (m) deck = [h('span', { class: 'rd-deck-label' }, '새길 기술'), ...deckRow(local.dropU, c => canMark(c, m), pickDeck)];
        bs = [button('새기기', confirmPick, m && local.dropU != null ? 'go' : 'off', '␣')];
      } else if (mode === 'whisper') {
        const w = P.whisper;
        text = '금단의 속삭임 — 받으면 세지는 대신 타락 +2';
        cls = 'dark';
        cards = [cardEl({ k: w.k, m: w.m }, 0, local.take ? 'on' : 'can', w.m ? `${MARKS[w.m].name} 새겨짐` : '', () => pickOffer('whisper', 0))];
        if (local.take) deck = [h('span', { class: 'rd-deck-label' }, '바꿀 카드'), ...deckRow(local.dropU, () => true, pickDeck)];
        bs = [button('거절', () => answerWhisper(false), '', '2'), button(local.take ? '받는다' : '받기', () => (local.take ? answerWhisper(true) : pickOffer('whisper', 0)), 'dark', local.take ? '␣' : '1')];
      } else if (mode === 'act' || (S.phase === 'act' && inParty() && !S.down?.[me])) {
        const qd = qDef(S, me);
        const live = mode === 'act';
        const okU = new Set((vp?.cards || []).map(c => c.u));
        text = !live ? (isStun(S, me) ? '기절 — 이번 턴은 쉰다' : '준비 완료 — 기다리는 중')
          : local.dropMode ? '버릴 카드를 누르세요'
            : local.sel ? '대상을 누르세요' : '기술을 누르세요';
        cards = hand().map((c, i) => {
          const planned = local.acts.find(a => a.u === c.u);
          let state = 'can';
          let note = '';
          if (local.drop === c.u) {
            state = 'drop';
            note = '버림';
          } else if (planned) {
            state = okU.has(c.u) ? 'on' : 'bad';
            note = okU.has(c.u) ? (planned.t ? `→ ${nameOf(planned.t)}` : '✓') : '못 냄';
          } else if (local.sel === c.u) state = 'sel';
          else if (!live) state = 'dim';
          else if (!vpOf([...local.acts, { u: c.u, t: defaultTarget(CARDS[c.k].to, c.k) }]).cards.some(x => x.u === c.u)) {
            state = 'off';
            note = CARDS[c.k].ammo ? '탄 부족' : '기력 부족';
          }
          return cardEl(c, i, state, note, () => live && pressCard(i));
        });
        if (live) {
          bs = [qd ? button([ico(cardArt(qd, S.cls?.[me])), `${qd.name}${local.q ? ' ✓' : ''}`], pressQ, local.q ? 'on' : qReady(S, me) ? '' : 'off', 'Q') : null,
            button(local.dropMode ? '버리기 취소' : '버리기', toggleDrop, local.dropMode ? 'on' : '', 'R'),
            button('처음으로', clearPlan, '', '⌫'),
            button('준비 완료', readyUp, 'go', '␣')];
          ft = [h('span', { class: 'rd-en big' }, dots(vp.energyLeft, ENERGY_MAX)), h('span', { class: 'rd-res' }, resShort(me)), previewLine(vp)];
        }
      } else if (mode === 'ghost') {
        text = '원혼 — 아군을 누르면 방어 +3, 적을 누르면 받는 피해 +10%';
      } else if (mode === 'boss') {
        const vb = bossVb();
        text = local.sel ? '지목할 사람을 누르세요' : `${S.phase === 'boss' ? '첫 턴' : '다음 턴'} 권능을 고르세요`;
        cls = 'dark';
        cards = hand().map((c, i) => {
          const Pw = POWERS[c.k];
          const a = local.bacts.find(x => x.u === c.u);
          const state = a ? (vb.cards.some(x => x.u === c.u) ? 'on' : 'bad') : local.sel === c.u ? 'sel' : Pw.cost > vb.left ? 'off' : 'can';
          return h('button', { class: `rd-card power ${state}`, type: 'button', tabindex: '-1', onClick: e => { e.currentTarget.blur(); pressPower(i); } },
            h('span', { class: 'rd-key' }, String(i + 1)), h('span', { class: 'rd-cost' }, dots(Pw.cost, Pw.cost) || '공짜'),
            h('span', { class: 'rd-chead' }, spr(powerArt(Pw), 'rd-cart', 2), h('b', { class: 'rd-cname' }, Pw.name)),
            h('span', { class: 'rd-ctip' }, Pw.tip), a?.t ? h('span', { class: 'rd-note' }, `→ ${nameOf(a.t)}`) : null, local.veil === c.u ? h('span', { class: 'rd-note' }, '?로 가림') : null);
        });
        bs = [button('장막', toggleVeil, local.veil ? 'on' : '', 'V'), button('처음으로', clearPlan, '', '⌫'), button('확정', bossReadyUp, 'go', '␣')];
        ft = [h('span', { class: 'rd-en big' }, dots(vb.left, ENERGY_MAX)), h('span', { class: 'rd-res' }, '어둠')];
      } else if (me === S.boss && (S.phase === 'act' || S.phase === 'boss')) text = '확정 — 원정대를 기다리는 중';
      else if (!inGame()) text = '관전 중';
      else if (inParty() && S.down?.[me] && S.phase === 'act') text = '원혼 — 다음 턴에 또';
      else if (['learn', 'mark', 'whisper', 'cls'].includes(S.phase)) text = '기다리는 중';
      else if (S.phase === 'resolve') text = '결과';
      else if (S.phase === 'intro') text = S.again ? '한 판 더!' : '같이 싸우다가, 제일 타락한 사람이 마지막 보스가 된다';
      if (hint && hint.until > performance.now()) {
        text = hint.text;
        cls = 'warn';
      }
      prompt.className = `rd-prompt ${cls}`;
      prompt.textContent = text;
      btns.replaceChildren(...bs.filter(Boolean));
      handEl.replaceChildren(...cards);
      deckEl.replaceChildren(...deck);
      foot.replaceChildren(...ft.filter(Boolean));
    }
    const tk = ['cls', 'learn', 'mark', 'whisper', 'act', 'boss'].includes(S.phase) ? `${S.phase}:${S.no}:${S.tn}` : '';
    if (tk !== keys.timer) {
      keys.timer = tk;
      timer.replaceChildren(...(tk ? [countdown(S.phaseEndsAt, THINK_TIME)] : []));
    }
  }

  // 미리 보기: 내 계획만 넣고 돌려 본 결과 (남의 계획에 달린 건 빼고 어림)
  function previewLine(vp) {
    try {
      const S2 = structuredClone(S);
      const out = runTurn(S2, [vp], { bossNow: publicBossPlan(S), ghosts: {} });
      const dealt = Object.values(out.sums.foe).reduce((a, b) => a + b, 0);
      const hpAfter = S2.down?.[me] ? 0 : S2.hp?.[me] || 0;
      const next = Math.min(ENERGY_MAX, Math.min(ENERGY_MAX, vp.energyLeft) + ENERGY_GAIN);
      const over = Math.max(0, vp.energyLeft + ENERGY_GAIN - ENERGY_MAX);
      const dark = vp.cards.filter(c => CARDS[c.k]?.dark).length;
      return h('span', { class: `rd-pv${hpAfter <= 0 ? ' danger' : ''}` },
        `→ 피해 ${dealt} · 체력 ${hpAfter}${hpAfter <= 0 ? ' 쓰러짐!' : ''} · 기력 ${vp.energyLeft}→${next}${over ? ` (${over} 넘침)` : ''}${dark ? ` · 타락 +${dark}` : ''}`);
    } catch {
      return null;
    }
  }

  function paintOverlay() {
    overlay.classList.toggle('on', tabDown);
    if (!tabDown || !S) return;
    const C = CLASSES[S.cls?.[me]];
    const trees = C ? C.trees.map(t => {
      const n = treeCount(S, me, t);
      const ps = [2, 4].filter(x => PASSIVES[`${t}${x}`]).map(x => h('li', { class: n >= x ? 'on' : '' }, `${x}장 ${PASSIVES[`${t}${x}`]}`));
      return h('div', { class: 'rd-treebox' }, h('b', {}, `${TREES[t].name} ${n}`), h('ul', {}, ps));
    }) : [];
    overlay.replaceChildren(h('h3', {}, '내 덱'), h('div', { class: 'rd-deckrow' }, ...deckRow(null)),
      list(P?.draw).length ? h('p', {}, `남은 덱: ${list(P.draw).map(k => CARDS[k]?.name).join(' · ')}`) : null,
      h('div', { class: 'rd-trees' }, trees));
  }

  function paintSide() {
    const k = JSON.stringify([S.log, S.cards?.[me], S.cls?.[me]]);
    if (k === keys.side) return;
    keys.side = k;
    const mine = cardsOf(S, me);
    sideBody.replaceChildren(...[
      list(S.log).length ? h('h3', {}, '방금') : null,
      list(S.log).length ? h('ol', { class: 'rd-log' }, list(S.log).slice(-5).map(t => h('li', {}, t))) : null,
      mine.length ? h('h3', {}, '내 덱') : null,
      mine.length ? h('ul', { class: 'rd-cardlist' }, mine.map(c => h('li', { class: CARDS[c.k]?.dark ? 'dark' : '' },
        h('b', {}, CARDS[c.k]?.name), c.m ? ` · ${MARKS[c.m]?.name}` : '', ` — ${CARDS[c.k]?.tip}`))) : null,
      h('h3', {}, '규칙'),
      h('ul', { class: 'rules' },
        h('li', {}, '기력은 안 쓰면 남는다 (최대 6)'),
        h('li', {}, '적은 지난 턴 제일 많이 때린 사람을 노린다'),
        h('li', {}, '필살기는 차단을 채우면 끊긴다 → 그로기'),
        h('li', {}, '금단을 받으면 세지는 대신 타락. 1위가 마왕')),
      h('p', { class: 'rd-legend' }, [['s_block', '방어'], ['s_en', '기력'], ['s_corrupt', '타락'], ['s_vuln', '취약'], ['s_weak', '약화'], ['s_stun', '기절'], ['s_bleed', '출혈'], ['s_ward', '가호']]
        .map(([i, t]) => ic(i, t))),
      h('h3', {}, '키'),
      h('p', { class: 'rules' }, '숫자 기술 · ←→ 대상 · 스페이스 확정 · Q 고유 · R 버리기 · Tab 덱 · Z X C V 신호'),
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
    if (ph === 'cls') setBanner('직업', 'gold', 1400);
    if (ph === 'learn') setBanner(S.learnKind === 'room' ? '배움' : '시작 기술', 'gold', 1400);
    if (ph === 'mark') setBanner('각인', 'gold', 1400);
    if (ph === 'whisper') { setBanner('속삭임…', 'blood', 1600); audio.whisper(); }
    if (ph === 'wreveal') { setBanner('속삭임 공개', 'blood', 1600); audio.reveal(); }
    if (ph === 'enter') { setBanner(`방 ${S.room + 1} · ${ROOMS[S.room]?.name}`, 'gold', 2000); audio.door(); }
    if (ph === 'clear') { setBanner('방 돌파!', 'gold', 2000); audio.clear(); }
    if (ph === 'fall') { setBanner(S.fall?.boss === 'king' ? '이름 없는 왕' : `${who(S.fall?.boss).name} 흑화!`, 'blood'); audio.fall(); }
    if (ph === 'boss') { setBanner('최종전', 'blood', 2000); audio.door(); }
    if (ph === 'act') { // 지난 턴 결과 글줄은 대응하는 동안에도 남겨 둔다
      const charging = liveFoes(S).some(k => S.foes[k].charge);
      setBanner(charging ? '필살기 준비 — 끊어라' : `${S.turn}턴`, charging ? 'blood' : '', 1100);
      if (charging) audio.charge(); else audio.turn();
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
        flashId = null;
        prev = { hp: { ...obj(S.hp) }, fhp: Object.fromEntries(Object.entries(obj(S.foes)).map(([k, f]) => [k, f?.hp || 0])) };
      }
      if (local.sel && !pickable().includes(local.cur)) local.cur = pickable()[0] || null;
      box.classList.toggle('final', S.phase === 'final');
      if (S.phase === 'final' && !seen.final) {
        seen.final = true;
        const pb = S.boss && S.boss !== 'king' ? S.boss : null;
        const title = S.how === 'win' ? '원정대 승리!' : S.how === 'lose' && pb ? `${josa(nameOf(BOSS), '이', '가')} 이겼다` : '원정 실패';
        const art = S.how === 'win' ? partyOf(S).filter(id => S.cls?.[id]).map(id => spr(`h_${S.cls[id]}`, '', 3))
          : S.foes?.[BOSS] ? [lordEl()] : [spr('i_skull', '', 4)];
        if (S.how === 'win') audio.win(); else audio.lose();
        board.replaceChildren(h('div', { class: 'rx-result' },
          h('div', { class: 'rd-finart' }, art),
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
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      audio.dispose();
    },
  };
}
