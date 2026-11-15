// 피의 저울 화면. 규칙은 scale-core.js (방장이 돌린다).
// 도트 그림은 art/scale.px.js (pxl)로 그려서 img/scale 에 구운 것. 판 위 생물은 3배, 손패 · 문양 · 작은 표시는 2배.
// 가운데: 내 두 전선 (아래 줄 = 내 칸 Q W E R, 위 줄 = 맞은편 이웃의 칸). 바깥쪽 세로 막대 = 그 전선의 저울.
// 위: 원탁 전체 (모두의 촛불 · 판 · 전선마다 저울). 아래: 안내 · 내 것(뼈 · 덱 · 도구) · 손패 · 남은 시간.
// 2차: 길목(ROAD_EVERY턴마다) · 도구(Z X) · 넋패(탈락하면 고른다)는 아래 칸에서 숫자키로 고른다.
import { h, digitOf, isTyping, josa } from '../util.js';
import { avatar, countdown, podium } from '../ui.js';
import {
  CARDS, DECKS, SIGILS, TOOLS, ROADS, LANES, SLOTS, SCALE_MAX, CANDLES, HAND_MAX, PLACE_TIME, DECK_TIME, ROAD_TIME, ROAD_EVERY,
  BEAT_MS, MOON, BURN, SIG_MAX, TOOL_MAX, SOUL_TIME,
  applyActs, runFight, simState, stepSlots, leftOf, rightOf, leadOf, across, foeOf, frontOf, rowOf, scaleFor, smoked, sigOf, has,
  bloodOf, statsOf, cardName, valueOf, NINE,
} from './scale-core.js';
import { createScaleAudio } from './scale-audio.js';

const ART = new URL('../../img/scale/sprites/', import.meta.url).href;
const ANIM = new URL('../../img/scale/anims/', import.meta.url).href;
const SIZE = { // 그림 크기 (도트). 여기 없는 건 18×18 (생물 초상 · 길목)
  i_blood: [7, 9], i_bone: [11, 5], i_tooth: [9, 9], i_claw: [9, 9], i_heart: [9, 9], i_lead: [11, 11], i_second: [11, 11],
  i_moon: [11, 11], i_smoke: [11, 8], i_bell: [11, 11], i_deck: [14, 18], i_nest: [14, 10], i_grave: [12, 11], candle_off: [9, 17],
};
for (const k of Object.keys(SIGILS)) SIZE[`g_${k}`] = [11, 11];
for (const k of Object.keys(TOOLS)) SIZE[`t_${k}`] = [16, 16];
function spr(name, cls = '', scale = 3) {
  const [w, hh] = SIZE[name] || [18, 18];
  return h('img', { class: `sc-spr ${cls}`, src: `${ART}${name}.png`, alt: '', draggable: 'false', width: w * scale, height: hh * scale });
}
// 촛불: 켜진 것은 4장짜리 가로 띠를 CSS로 넘긴다
const candle = (on, scale = 2) => (on
  ? h('i', { class: `sc-candle x${scale}`, style: `background-image:url(${ANIM}candle.png)` })
  : spr('candle_off', 'sc-candle-off', scale));
const list = v => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
const SLOT_KEY = 'QWERTY'.slice(0, SLOTS).split('');
const TOOL_KEY = ['Z', 'X', 'C'].slice(0, TOOL_MAX);
const PAGE = 8; // 내 카드 전부를 고를 때 한 쪽에 보이는 장수 (← → 로 넘긴다)
const costOf = d => (d.blood ? `피 ${d.blood}` : d.bone ? `뼈 ${d.bone}` : '공짜');
const AIM = { foe: '벨 상대 생물을 누르세요', front: '전선을 고르세요 (Q W 왼쪽 · E R 오른쪽)', mine: '지킬 내 생물을 누르세요' };

function cardTip(c) {
  const d = CARDS[c.k] || { name: c.k };
  const st = statsOf(c);
  const lines = [`${cardName(c)} · ${costOf(d)} · ${st.atk}/${st.hp}`, ...sigOf(c).map(g => `${SIGILS[g].name}: ${SIGILS[g].tip}`)];
  if (c.k === 'soul') lines.push('넋패 (탈락한 사람의 카드)');
  if (c.t) lines.push('복제: 죽으면 사라짐');
  if ((c.da || c.dh) && c.k !== 'soul') lines.push(`모닥불${c.da ? ` 공격 +${c.da}` : ''}${c.dh ? ` 체력 +${c.dh}` : ''}`);
  return lines.join('\n');
}

export default function mount(root, api) {
  const me = api.me;
  const audio = createScaleAudio();
  const head = h('div', { class: 'rx-head' });
  const ring = h('div', { class: 'sc-ring' });
  const banner = h('div', { class: 'sc-banner' });
  const center = h('div', { class: 'sc-center' }, banner);
  const fronts = [0, 1].map(makeFront);
  const table = h('div', { class: 'sc-table' }, fronts[0].el, h('div', { class: 'sc-mid' }, center), fronts[1].el);
  const fx = h('canvas', { class: 'sc-fx' });
  const floats = h('div', { class: 'sc-floats' });
  const flashEl = h('div', { class: 'sc-flash' });
  const stage = h('div', { class: 'sc-stage' }, ring, table, fx, floats, flashEl);
  const steps = h('div', { class: 'sc-steps' });   // 이번 턴에 할 일: 뽑기 › 놓기 › 준비 완료
  const prompt = h('div', { class: 'sc-prompt' });
  const btns = h('div', { class: 'sc-btns' });     // 준비 완료 · 되돌리기 같은 버튼
  const stat = h('div', { class: 'sc-stat' });
  const handEl = h('div', { class: 'sc-hand' });
  const timer = h('div', { class: 'sc-timer' });
  const panel = h('div', { class: 'sc-panel' }, h('div', { class: 'sc-bar' }, steps, prompt, btns), stat, handEl, timer);
  const board = h('div', { class: 'sc-board' });
  const sound = h('button', { class: 'sc-sound', type: 'button', tabindex: '-1' });
  const box = h('div', { class: 'sc-box' }, stage, panel, board, sound);
  const side = h('aside', { class: 'side' });
  root.append(h('div', { class: 'sc' }, h('div', { class: 'sc-main' }, head, box), side));
  document.activeElement?.blur?.();
  document.fonts?.load('18px "Galmuri9"', '피의 저울 제물 촛불').catch(() => {});
  for (const k of Object.keys(CARDS)) if (k !== 'soul') new Image().src = `${ART}p_${k}.png`;

  let S = null;
  let P = null;
  let last = null;      // 지난번에 받은 상태 (공개 · 타격 장면은 이 모습에서부터 튼다)
  let shown = null;     // 장면을 트는 동안 보여 주는 판 · 저울 · 촛불
  let seen = null;      // 이미 연출한 것 (중간에 들어와도 지난 장면을 다시 틀지 않게)
  let playNo = 0;
  let watch = null;     // 탈락 · 관전: 지금 보고 있는 사람
  // 이번 단계에 내가 정한 것 (방장 답을 안 기다리고 내 화면에 먼저 보인다). tool = 겨누는 중인 도구
  let local = { key: '', acts: [], cur: null, ready: false, tool: null };
  // 길목 · 넋패에서 고르는 중인 것 (fire = 모닥불에 올린 카드 · from = 제단에 바칠 카드 · stat = 넋패 능력치 카드)
  let pick = { key: '', page: 0, fire: null, from: null, stat: null };
  const sent = { deck: null, draw: -1 };
  let hint = null;
  let bannerNo = 0;
  let planTimer = null;
  const keys = { head: '', ring: '', panel: '', timer: '', side: '' };
  const ringEls = new Map(); // 원탁의 사람 칸 (떠오르는 글자를 붙일 자리)
  const timers = new Set();
  const later = (ms, fn) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };
  const who = id => list(S?.roster).find(p => p.id === id) || { id, name: '?' };
  const nameOf = id => who(id).name;
  const V = () => shown || S;                         // 지금 그릴 판
  const alive = id => list(S?.alive).includes(id);
  const inGame = () => list(S?.roster).some(p => p.id === me);
  const myHand = () => list(P?.hand);
  const myCards = () => list(P?.cards);
  const myTools = () => list(P?.tools);
  const stepNo = () => (S?.phase === 'place1' ? 1 : S?.phase === 'place2' ? 2 : 0);
  const myRoad = () => S?.road?.st?.[me] || null;
  const soulTask = () => (S && !alive(me) && list(P?.soul).length ? list(S.souls).find(e => e.from === me && !e.done) || null : null);

  const soundLabel = () => { sound.textContent = audio.enabled ? '소리 켜짐' : '소리 꺼짐'; };
  soundLabel();
  sound.addEventListener('click', () => {
    audio.toggle();
    soundLabel();
    sound.blur();
  });
  const unlock = () => { void audio.unlock(); };
  window.addEventListener('pointerdown', unlock);

  /* ── 카드 한 장. big = 판 위 (초상 3배), 아니면 손패 (2배) ── */
  function cardEl(c, big = true, cls = '') {
    const d = CARDS[c.k] || { name: c.k, atk: 0, hp: 1 };
    const st = statsOf(c);
    const soul = c.k === 'soul';
    const sigs = sigOf(c);
    const cost = d.blood ? h('span', { class: 'sc-cost blood' }, ...(d.blood <= 2 ? Array.from({ length: d.blood }, () => spr('i_blood', '', 2)) : [spr('i_blood', '', 2), h('b', {}, String(d.blood))]))
      : d.bone ? h('span', { class: 'sc-cost bone' }, spr('i_bone', '', 2), h('b', {}, String(d.bone)))
        : h('span', { class: 'sc-cost free' }, '공짜');
    const pic = soul ? h('span', { class: `sc-pic soul ${big ? 'big' : 'small'}` }, avatar(who(c.pid))) : spr(`p_${c.k}`, 'sc-pic', big ? 3 : 2);
    const up = k => !soul && st[k] > d[k];
    return h('div', { class: `sc-card ${big ? 'big' : 'small'} ${d.blood ? 't-blood' : d.bone ? 't-bone' : 't-free'}${soul ? ' soul' : ''}${c.t ? ' copy' : ''} ${cls}`, title: cardTip(c) },
      h('span', { class: 'sc-top' }, cost, h('span', { class: 'sc-sigs' }, ...sigs.map(g => spr(`g_${g}`, '', 2)))),
      pic,
      h('span', { class: 'sc-cname' }, cardName(c)),
      h('span', { class: 'sc-foot' },
        h('span', { class: `sc-atk${up('atk') ? ' up' : ''}` }, spr('i_claw', '', 2), String(st.atk)),
        c.lv != null && has(c, 'nine') ? h('span', { class: 'sc-lv', title: '아홉 목숨: 제물로 바쳐도 안 죽는 횟수' }, `목숨${c.lv}`) : null,
        h('span', { class: `sc-hp${st.hp < st.max ? ' hurt' : up('hp') ? ' up' : ''}` }, spr('i_heart', '', 2), String(Math.max(0, st.hp)))));
  }

  // 지금 내가 보는 사람: 살아 있으면 나, 아니면 고른 사람 (← →)
  function pov() {
    const a = list(V().alive);
    if (a.includes(me)) return me;
    if (!a.includes(watch)) watch = a.includes(S.dead?.[me]) ? S.dead[me] : a[0] || null;
    return watch;
  }
  // 지금 내가 할 수 있는 것: deck · plan(놓기) · road(길목) · soul(넋패) · watch(구경) · null
  function modeOf() {
    if (!S || S.over) return null;
    if (soulTask()) return 'soul';
    if (!inGame() || !alive(me)) return S.phase === 'intro' ? null : 'watch';
    if (S.phase === 'deck') return S.deckDone?.[me] || sent.deck ? null : 'deck';
    if (S.phase === 'road') return myRoad()?.done ? null : 'road';
    if (stepNo() && !S.ready?.[me] && !local.ready && !shown) return 'plan';
    return null;
  }
  const canDraw = () => S?.phase === 'place1' && alive(me) && !S.drew?.[me] && sent.draw !== S.round && !S.ready?.[me] && !local.ready;

  /* ── 계획: 내 손패와 판에 차례로 적용해 본다 (방장과 같은 함수) ── */
  function sim(acts = local.acts) {
    const st = stepNo();
    return applyActs(rowOf(S, me), myHand(), S.bones?.[me] || 0, acts, st ? stepSlots(S, me, st) : [], S.round);
  }
  const mySlots = () => (stepNo() ? stepSlots(S, me, stepNo()) : []);
  const curBlood = (board, cur = local.cur) => (cur ? cur.sac.reduce((t, s) => t + (board[s] ? bloodOf(board[s]) : 0), 0) : 0);
  // 카드를 고른 뒤: 'sac' = 제물을 고르는 중 · 'place' = 놓을 칸을 고르는 중
  // 제물 고르기: 표시한 것 먼저, 모자라면 약한 것부터 (아홉 목숨 · 닭 · 잿불 먼저). 놓을 칸에 내 생물이 있으면 그것부터 바친다
  function autoSac(board, need, slot, marked) {
    const sac = marked.filter(s => board[s]);
    const at = board[slot];
    if (at && !sac.includes(slot)) {
      if (has(at, 'nine') && (at.lv ?? NINE) > 0) return null; // 아홉 목숨은 바쳐도 자리를 안 비킨다
      sac.unshift(slot);
    }
    const blood = () => sac.reduce((t, s) => t + bloodOf(board[s]), 0);
    const cheap = c => (has(c, 'nine') && (c.lv ?? NINE) > 0 ? -10 : 0) + (CARDS[c.k]?.tok || c.t ? -5 : 0) + valueOf(c);
    const rest = board.map((c, s) => (c && !sac.includes(s) && s !== slot ? s : -1)).filter(s => s >= 0).sort((a, b) => cheap(board[a]) - cheap(board[b]) || a - b);
    for (const s of rest) {
      if (blood() >= need) break;
      sac.push(s);
    }
    return blood() >= need ? sac : null;
  }
  // 지금 고른 카드를 그 칸에 놓을 수 있나 (아홉 목숨은 바쳐도 자리를 안 비킨다)
  function planAct(s) { // 고른 카드를 칸 s에 놓는 수 (못 놓으면 null)
    const cur = local.cur;
    if (!cur || !mySlots().includes(s)) return null;
    const R = sim();
    let sac = [];
    if (cur.need) {
      sac = autoSac(R.board, cur.need, s, cur.sac);
      if (!sac) return null;
    } else if (R.board[s]) return null;
    const act = { u: cur.u, sac, slot: s };
    return sim([...local.acts, act]).done === local.acts.length + 1 ? act : null;
  }
  const canPlace = s => !!planAct(s);
  // 이 카드를 지금 낼 수 있나 (안 되면 까닭)
  function whyNot(card, R) {
    const d = CARDS[card.k];
    if (!d) return '모르는 카드';
    const slots = mySlots();
    if (d.bone && R.bones < d.bone) return `뼈가 모자라요 (${R.bones}/${d.bone})`;
    if (d.blood) {
      const blood = R.board.reduce((t, c) => t + (c ? bloodOf(c) : 0), 0);
      if (blood < d.blood) return `제물이 모자라요 (피 ${d.blood}) · 닭부터 놓으세요`;
      return null; // 제물로 비운 칸에 놓을 수 있다
    }
    if (!slots.some(s => !R.board[s])) return '놓을 빈칸이 없어요';
    return null;
  }

  function say(text, cls = 'hint', ms = 2000) {
    hint = { text, cls, until: performance.now() + ms };
    later(ms + 30, paintPanel);
    paintPanel();
  }
  function nope(text) {
    panel.classList.remove('nope');
    void panel.offsetWidth;
    panel.classList.add('nope');
    audio.deny();
    say(text, 'warn', 2400);
  }
  function sendPlan(ready) {
    clearTimeout(planTimer);
    planTimer = null;
    const st = stepNo();
    if (!st) return;
    api.send('plan', { round: S.round, step: st, acts: local.acts, ready });
  }
  // 시간이 끝나도 지금 고른 대로 나가게, 바뀔 때마다 (조금 모아서) 알려 둔다
  function touch() {
    hint = null;
    if (!planTimer) planTimer = setTimeout(() => sendPlan(false), 250);
    paint();
  }

  function pickCard(i) {
    const R = sim();
    const card = R.hand[i];
    if (!card) return;
    local.tool = null;
    if (local.cur?.u === card.u) { // 같은 카드를 또 누르면 취소
      local.cur = null;
      audio.unpick();
      return paint();
    }
    const why = whyNot(card, R);
    if (why) return nope(why);
    local.cur = { u: card.u, k: card.k, nm: card.nm, need: CARDS[card.k].blood || 0, sac: [] };
    audio.pick();
    paint();
  }
  // Q W E R (또는 내 칸을 누름): 도구를 겨누는 중이면 그 칸. 카드를 골랐으면 이번에 놓을 칸 = 놓기, 다른 칸의 내 생물 = 제물로 표시
  function pressSlot(s) {
    if (modeOf() !== 'plan' || s < 0 || s >= SLOTS) return;
    if (local.tool) return aimTool(s);
    const R = sim();
    const slots = mySlots();
    const where = slots.map(x => SLOT_KEY[x]).join(' ');
    if (!local.cur) return say(slots.includes(s) ? '카드부터 고르세요' : `이번엔 ${where}에 놓아요`);
    const cur = local.cur;
    if (!slots.includes(s)) { // 반대쪽 전선의 내 생물: 제물로 쓸지 표시
      if (!cur.need || !R.board[s]) return nope(`이번엔 ${where}에 놓아요`);
      cur.sac = cur.sac.includes(s) ? cur.sac.filter(x => x !== s) : [...cur.sac, s];
      audio.mark();
      return paint();
    }
    const act = planAct(s);
    if (!act) {
      if (!cur.need && R.board[s]) return nope('빈칸에 놓으세요');
      if (R.board[s] && has(R.board[s], 'nine')) return nope('아홉 목숨은 바쳐도 자리를 안 비켜요');
      return nope(`제물이 모자라요 (피 ${cur.need})`);
    }
    local.acts.push(act);
    local.cur = null;
    audio.place();
    if (act.sac.length) audio.sac();
    touch();
  }
  function undo() {
    if (modeOf() !== 'plan') return;
    if (local.tool) local.tool = null;
    else if (local.cur) local.cur = null;
    else if (local.acts.length) local.acts.pop();
    else return;
    audio.unpick();
    touch();
  }
  function ringBell() {
    if (modeOf() !== 'plan') return;
    if (local.cur || local.tool) return nope('고른 것부터 놓거나 취소하세요');
    local.ready = true;
    sendPlan(true);
    audio.bell();
    hint = null;
    paint();
  }
  function drawFrom(from) {
    if (!canDraw()) return;
    sent.draw = S.round;
    api.send('draw', { round: S.round, from });
    audio[from === 'hen' ? 'hen' : 'draw']();
    paint();
  }
  function pickDeck(i) {
    const k = Object.keys(DECKS)[i];
    if (!k || modeOf() !== 'deck') return;
    sent.deck = k;
    api.send('deck', { k });
    audio.pick();
    paint();
  }
  function turnWatch(dir) {
    const a = list(S.alive);
    if (a.length < 2) return;
    const i = Math.max(0, a.indexOf(pov()));
    watch = a[(i + dir + a.length) % a.length];
    audio.pick();
    paint();
  }

  /* ── 도구 (Z X): 바로 쓰거나, 고를 것이 있으면 Q W E R ── */
  function useTool(i) {
    if (modeOf() !== 'plan') return;
    const t = myTools()[i];
    if (!t) return nope('그 자리엔 도구가 없어요');
    if (local.cur) return nope('고른 카드부터 놓거나 취소하세요');
    if (local.tool?.i === i) { // 다시 누르면 취소
      local.tool = null;
      audio.unpick();
      return paint();
    }
    if (!TOOLS[t].aim) return sendTool(i, 0);
    local.tool = { i, t };
    audio.pick();
    paint();
  }
  function aimTool(s) {
    const { i, t } = local.tool;
    const aim = TOOLS[t].aim;
    if (aim === 'foe' && !rowOf(S, foeOf(S, me, s))[across(s)]) return nope('거긴 상대 생물이 없어요');
    if (aim === 'mine' && !rowOf(S, me)[s]) return nope('이미 판에 있는 내 생물만 돼요');
    if (t === 'coin' && scaleFor(S, me, frontOf(S, me, s)) >= SCALE_MAX - 1) return nope(`엽전으론 ${SCALE_MAX - 1}칸까지만`);
    if (t === 'moktak' && list(S.fx?.[me]?.mok).includes(frontOf(S, me, s))) return nope('이미 쳤어요');
    sendTool(i, s);
  }
  function sendTool(i, s) {
    if (myTools()[i] === 'fan' && S.fx?.[me]?.fan) return nope('이미 폈어요');
    api.send('tool', { round: S.round, i, s });
    local.tool = null;
    audio.tool();
    paint();
  }

  /* ── 길목 ── */
  const roadSend = (type, data = {}) => api.send(type, { no: S.road?.no, ...data });
  const pageOf = arr => arr.slice(pick.page * PAGE, pick.page * PAGE + PAGE);
  function roadChoices() { // 지금 숫자키로 고를 것들
    const st = myRoad();
    if (!st) return list(S.road?.offers?.[me]);
    if (st.done) return [];
    if (st.kind === 'pack') return list(st.cards);
    if (st.kind === 'tools') return list(st.tools);
    if (st.kind === 'fire') return st.u || pick.fire ? ['atk', 'hp', ...(st.n ? ['stop'] : [])] : pageOf(myCards());
    if (st.kind === 'altar') {
      if (!pick.from) return pageOf(myCards().filter(c => sigOf(c).length));
      const from = myCards().find(c => c.u === pick.from);
      return pageOf(myCards().filter(c => c.u !== pick.from && from && sigOf(from).some(g => !sigOf(c).includes(g)) && sigOf(c).length < SIG_MAX));
    }
    return [];
  }
  function roadKey(i) {
    const st = myRoad();
    const ch = roadChoices()[i];
    if (ch == null) return;
    audio.pick();
    if (!st) return roadSend('road', { kind: ch });
    if (st.kind === 'pack' || st.kind === 'tools') return roadSend('roadpick', { i });
    if (st.kind === 'fire') {
      if (typeof ch === 'object') { pick.fire = ch.u; return paint(); }
      if (ch === 'stop') return roadSend('roaddone');
      return roadSend('fire', { u: st.u || pick.fire, stat: ch });
    }
    if (st.kind === 'altar') {
      if (!pick.from) { pick.from = ch.u; pick.page = 0; return paint(); }
      return roadSend('altar', { from: pick.from, to: ch.u });
    }
  }
  function roadBack() {
    const st = myRoad();
    if (!st || st.done) return;
    if (st.kind === 'fire' && pick.fire && !st.u) pick.fire = null;
    else if (st.kind === 'altar' && pick.from) pick.from = null;
    else if (st.kind === 'altar') return roadSend('roaddone');
    else return;
    pick.page = 0;
    audio.unpick();
    paint();
  }
  function turnPage(dir, total) {
    const pages = Math.max(1, Math.ceil(total / PAGE));
    pick.page = (pick.page + dir + pages) % pages;
    audio.pick();
    paint();
  }

  /* ── 넋패 (탈락한 나) ── */
  function soulChoices() {
    const src = list(P?.soul);
    return pick.stat == null ? pageOf(src) : pageOf(src.filter(c => sigOf(c).length));
  }
  function soulKey(d) {
    if (d === 0 && pick.stat != null) return api.send('soul', { stat: pick.stat, sig: 0 });
    const c = soulChoices()[d - 1];
    if (!c) return;
    audio.pick();
    if (pick.stat == null) {
      pick.stat = c.u;
      pick.page = 0;
      if (!list(P?.soul).some(x => sigOf(x).length)) return api.send('soul', { stat: c.u, sig: 0 });
      return paint();
    }
    api.send('soul', { stat: pick.stat, sig: c.u });
  }

  function onKey(e) {
    if (isTyping(e) || !S) return;
    const c = e.code;
    const d = digitOf(e) || (c === 'Digit0' || c === 'Numpad0' ? 0 : -1);
    const slot = SLOT_KEY.findIndex(k => c === `Key${k}`);
    const toolKey = TOOL_KEY.findIndex(k => c === `Key${k}`);
    const dir = c === 'ArrowLeft' ? -1 : c === 'ArrowRight' ? 1 : 0;
    const space = c === 'Space';
    const back = c === 'Backspace' || c === 'Escape';
    if (d < 0 && slot < 0 && toolKey < 0 && !dir && !space && !back) return;
    if (space || back || dir) e.preventDefault();
    if (e.repeat) return;
    unlock();
    const mode = modeOf();
    if (mode === 'soul') {
      if (dir) return turnPage(dir, pick.stat == null ? list(P?.soul).length : list(P?.soul).filter(x => sigOf(x).length).length);
      if (back && pick.stat != null) { pick.stat = null; pick.page = 0; return paint(); }
      return d >= 0 ? soulKey(d) : undefined;
    }
    if (mode === 'watch') return dir ? turnWatch(dir) : undefined;
    if (mode === 'deck') return d > 0 ? pickDeck(d - 1) : undefined;
    if (mode === 'road') {
      const st = myRoad();
      const paging = st && ((st.kind === 'fire' && !st.u && !pick.fire) || st.kind === 'altar');
      if (dir && paging) return turnPage(dir, st.kind === 'altar' && !pick.from ? myCards().filter(x => sigOf(x).length).length : myCards().length);
      if (back) return roadBack();
      return d > 0 ? roadKey(d - 1) : undefined;
    }
    if (dir && canDraw()) return drawFrom(dir < 0 ? 'deck' : 'hen');
    if (mode !== 'plan') return;
    if (d > 0) return pickCard(d - 1);
    if (toolKey >= 0) return useTool(toolKey);
    if (slot >= 0) return pressSlot(slot);
    if (back) return undo();
    if (space) return ringBell();
  }
  window.addEventListener('keydown', onKey);

  /* ── 효과 그림판: 3배로 키우는 작은 캔버스에 도트로 튀는 조각 ── */
  const PX = 3;
  const g2 = fx.getContext('2d');
  let cw = 0;
  let ch = 0;
  const parts = [];
  function fit() {
    const r = stage.getBoundingClientRect();
    const w = Math.ceil(r.width / PX);
    const hh = Math.ceil(r.height / PX);
    if (w === cw && hh === ch) return;
    cw = fx.width = w;
    ch = fx.height = hh;
    fx.style.width = `${w * PX}px`;
    fx.style.height = `${hh * PX}px`;
  }
  const centerOf = el => {
    const t = stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2 - t.left, r.top + r.height / 2 - t.top];
  };
  function burst(el, colors, n = 16, speed = 1) {
    if (!el) return;
    const [x, y] = centerOf(el);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.5 + Math.random() * 1.7) * speed;
      parts.push({ x: x / PX, y: y / PX, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, life: 9 + Math.random() * 12, t0: performance.now(), c: colors[i % colors.length] });
    }
  }
  let raf = 0;
  let lastT = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - lastT < 33) return;
    lastT = t;
    if (!parts.length && !g2.dirty) return;
    fit();
    g2.clearRect(0, 0, cw, ch);
    g2.dirty = parts.length > 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.13;
      p.life -= 1;
      if (p.life <= 0 || t - p.t0 > 1000) { // 화면이 멈춰 있었어도 1초 지나면 사라진다
        parts.splice(i, 1);
        continue;
      }
      g2.fillStyle = p.c;
      const sz = p.life > 6 ? 2 : 1;
      g2.fillRect(Math.round(p.x), Math.round(p.y), sz, sz);
    }
  }
  raf = requestAnimationFrame(frame);

  function floatAt(el, text, cls = '', icon = null, dy = 0) {
    if (!el) return;
    const [x, y] = centerOf(el);
    const f = h('div', { class: `sc-float ${cls}`, style: `left:${x.toFixed(0)}px;top:${(y + dy).toFixed(0)}px` }, icon ? spr(icon, '', 2) : null, text);
    floats.append(f);
    later(1300, () => f.remove());
  }
  function setBanner(text, cls = '', ms = 0) {
    banner.textContent = text;
    banner.className = `sc-banner ${cls}`;
    const n = (bannerNo += 1);
    if (ms) later(ms, () => { if (bannerNo === n) banner.textContent = ''; });
  }
  function replay(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }
  const flash = () => replay(flashEl, 'on');

  /* ── 화면의 칸 ── */
  function makeFront(i) {
    const foe = h('div', { class: 'sc-foe' });
    const gauge = h('div', { class: 'sc-gauge' });
    const cols = [];
    for (let c = 0; c < LANES; c++) {
      const s = i * LANES + c;
      const top = h('div', { class: 'sc-cell foe', onClick: () => { unlock(); if (local.tool && TOOLS[local.tool.t].aim === 'foe') pressSlot(s); } });
      const bot = h('div', { class: 'sc-cell mine', onClick: () => { unlock(); pressSlot(s); } });
      cols.push({ s, top, bot, el: h('div', { class: 'sc-col' }, top, h('div', { class: 'sc-botwrap' }, bot, h('span', { class: 'sc-key' }, SLOT_KEY[s]))), tk: '', bk: '' });
    }
    gauge.addEventListener('click', () => { unlock(); if (local.tool && TOOLS[local.tool.t].aim === 'front') pressSlot(i * LANES); });
    const lanes = h('div', { class: 'sc-lanes' }, ...(i === 0 ? [gauge, ...cols.map(x => x.el)] : [...cols.map(x => x.el), gauge]));
    const note = h('div', { class: 'sc-fnote' });
    const el = h('div', { class: `sc-front ${i ? 'right' : 'left'}` }, foe, lanes, note);
    return { i, el, foe, gauge, cols, note, gk: '', fk: '', nk: '' };
  }
  // (사람, 칸)이 지금 화면 어디에 있나. 내 두 전선 밖이면 null (원탁에만 보인다)
  function cellOf(owner, s) {
    const p = pov();
    const X = V();
    if (!p || !owner) return null;
    if (owner === p) return fronts[s < LANES ? 0 : 1].cols[s % LANES].bot;
    if (owner === leftOf(X, p) && s >= LANES) return fronts[0].cols[across(s)].top;
    if (owner === rightOf(X, p) && s < LANES) return fronts[1].cols[across(s) - LANES].top;
    return null;
  }
  // 전선 f의 저울이 화면에 있나
  function gaugeOf(f) {
    const p = pov();
    if (f === p) return fronts[0].gauge;
    if (f === rightOf(V(), p)) return fronts[1].gauge;
    return null;
  }
  // 그 사람 이름이 보이는 곳 (나는 아래 칸, 이웃은 전선 머리글, 나머지는 원탁)
  function tagOf(id) {
    const p = pov();
    const X = V();
    if (id === p) return id === me ? stat : ringEls.get(id);
    if (id === leftOf(X, p)) return fronts[0].foe;
    if (id === rightOf(X, p)) return fronts[1].foe;
    return ringEls.get(id) || null;
  }
  const near = id => { const p = pov(); const X = V(); return id === p || id === leftOf(X, p) || id === rightOf(X, p); };

  /* ── 장면 연출: 공개(놓기 · 제물) · 타격 ── */
  function play(pre) {
    const no = (playNo += 1);
    shown = pre;
    const evs = list(S.rs);
    const live = () => no === playNo && !!shown;
    const end = ms => later(ms, () => {
      if (no !== playNo) return;
      shown = null;
      paint();
    });
    if (S.phase === 'reveal1' || S.phase === 'reveal2') {
      setBanner('공개!', 'gold', 1100);
      audio.reveal();
      const by = {};
      for (const e of evs) (by[e.by] ||= []).push(e);
      let longest = 0;
      for (const es of Object.values(by)) {
        es.forEach((e, i) => {
          const t = 120 + i * 220;
          longest = Math.max(longest, t);
          later(t, () => { if (live()) revealScene(e); });
        });
      }
      end(longest + 420);
      return paint();
    }
    // 타격: 박자마다 (같은 박자는 동시에)
    const beats = [...new Set(evs.map(e => e.b))].sort((a, b) => a - b);
    const step = S.rsStep || BEAT_MS;
    setBanner(beats.length ? '타격!' : '', 'blood', 900);
    beats.forEach((b, i) => later(300 + i * step, () => {
      if (!live()) return;
      for (const e of evs.filter(x => x.b === b)) fightScene(e);
      paint();
    }));
    end(300 + beats.length * step + 200);
    paint();
  }
  const cardIn = (id, s) => shown?.board?.[id]?.[s] || null;
  function revealScene(e) {
    const el = cellOf(e.by, e.s);
    if (e.k === 'put') {
      shown.board[e.by][e.s] = { ...e.card };
      if (el) {
        paint();
        replay(el, 'drop');
        if (near(e.by)) audio.place();
      }
      return;
    }
    if (e.k === 'breed') {
      if (el) floatAt(el, '번식: 한 장 더', 'gold', 'g_breed', -30);
      return;
    }
    if (e.k === 'sac') {
      if (el) {
        replay(el, 'sacking');
        burst(el, ['#b13e53', '#7a2433', '#ef7d57'], 18, 1.2);
        if (e.nine != null) floatAt(el, `목숨 ${e.nine}`, 'gold', 'g_nine', -20);
        else floatAt(el, `+${e.bn}`, 'bone', 'i_bone', -20);
        if (near(e.by)) audio.sac();
      }
      if (e.nine != null) {
        const c = cardIn(e.by, e.s);
        if (c) c.lv = e.nine;
        return;
      }
      later(170, () => {
        if (!shown) return;
        shown.board[e.by][e.s] = 0;
        paint();
      });
    }
  }
  function fightScene(e) {
    if (e.k === 'hit') {
      const a = cellOf(e.by, e.s);
      const t = cellOf(e.to, e.ts);
      replay(a, e.by === pov() ? 'lunge-up' : 'lunge-down');
      const c = cardIn(e.to, e.ts);
      if (c) c.hp = e.hp;
      if (t) {
        later(110, () => {
          replay(t, 'hit');
          floatAt(t, `-${e.d}`, e.d >= 3 ? 'hit big' : 'hit');
          if (e.vn) floatAt(t, '독니!', 'venom', 'g_venom', 30);
          burst(t, ['#b13e53', '#ef7d57', '#f4f4f4'], e.d >= 3 ? 22 : 12, e.d >= 3 ? 1.4 : 1);
          audio.hit(e.d >= 3);
        });
      } else if (a) audio.lunge();
      return;
    }
    if (e.k === 'thorn') {
      const c = cardIn(e.to, e.s);
      if (c) c.hp = e.hp;
      const t = cellOf(e.to, e.s);
      if (t) later(160, () => { replay(t, 'hit'); floatAt(t, '가시 -1', 'hit small', 'g_thorn'); });
      return;
    }
    if (e.k === 'direct') {
      const a = cellOf(e.by, e.s);
      const g = gaugeOf(e.f);
      if (!e.tr) replay(a, e.by === pov() ? 'lunge-up' : 'lunge-down');
      shown.scale[e.f] = e.v;
      if (g) {
        later(e.tr ? 220 : 120, () => {
          const mine = e.to === pov();
          replay(g, mine ? 'pushed-me' : 'pushed');
          floatAt(g, `${e.tr ? '돌진' : '직격'} ${e.d}`, mine ? 'hit big' : 'direct', e.tr ? 'g_trample' : 'i_tooth');
          audio.direct(e.d);
          if (mine) replay(box, 'shaking');
          paint();
        });
      }
      return;
    }
    if (e.k === 'smoke') {
      const g = gaugeOf(e.f);
      if (g) { floatAt(g, '연기', 'calm', 'i_smoke'); audio.smoke(); }
      return;
    }
    if (e.k === 'mute') {
      const a = cellOf(e.by, e.s);
      if (a) floatAt(a, '못 침', 'calm', 't_moktak');
      return;
    }
    if (e.k === 'charm') {
      const el = cellOf(e.by, e.s);
      const c = cardIn(e.by, e.s);
      if (c) c.hp = Math.max(1, c.hp);
      if (el) {
        replay(el, 'saved');
        floatAt(el, '부적', 'gold', 't_charm', -24);
        burst(el, ['#ffcd75', '#f4f4f4'], 18, 1.2);
        audio.tool();
      }
      return;
    }
    if (e.k === 'die') {
      const el = cellOf(e.by, e.s);
      if (el) {
        replay(el, 'dying');
        floatAt(el, `+${e.bn}`, 'bone', 'i_bone', 26);
        audio.die();
        later(200, () => audio.bone());
      }
      later(240, () => {
        if (!shown) return;
        shown.board[e.by][e.s] = 0;
        paint();
      });
      return;
    }
    if (e.k === 'move') {
      const r = shown.board[e.by];
      if (r) {
        r[e.to] = r[e.from];
        r[e.from] = 0;
      }
      const el = cellOf(e.by, e.to);
      if (el) { later(30, () => replay(el, 'slide')); audio.move(); }
      return;
    }
    if (e.k === 'grow') {
      const r = shown.board[e.by];
      if (r) r[e.s] = { ...e.card };
      const el = cellOf(e.by, e.s);
      if (el) {
        later(30, () => replay(el, 'grow'));
        floatAt(el, `자람: ${CARDS[e.card.k]?.name || ''}`, 'gold', 'g_grow', -24);
        burst(el, ['#a7f070', '#38b764', '#f4f4f4'], 18, 1.1);
        audio.grow();
      }
      return;
    }
    if (e.k === 'gift') {
      later(600, () => floatAt(tagOf(e.to), '도구 +1', 'gold', null));
      return;
    }
    if (e.k === 'candle') {
      shown.candles[e.to] = e.left;
      shown.scale[e.f] = 0;
      const mine = e.to === pov();
      setBanner(mine ? '내 촛불이 꺼졌다!' : `${nameOf(e.to)}의 촛불이 꺼졌다!`, mine ? 'blood' : 'gold', 1600);
      flash();
      replay(box, 'shaking');
      replay(stage, mine ? 'dark' : 'punch');
      burst(gaugeOf(e.f), ['#ffcd75', '#ef7d57', '#94b0c2'], 30, 1.6);
      audio.candle(mine);
      if (e.by === pov()) later(500, () => floatAt(gaugeOf(e.f), e.over ? `뼈 +${e.over}` : '촛불을 껐다!', 'gold'));
      return;
    }
    if (e.k === 'revive') {
      shown.candles[e.to] = 1;
      later(700, () => setBanner(`${nameOf(e.to)} 촛불 하나로 버텼다!`, 'gold', 1500));
      return;
    }
    if (e.k === 'out') {
      shown.board[e.to] = Array(SLOTS).fill(0);
      later(800, () => {
        setBanner(e.to === me ? '탈락!' : `${nameOf(e.to)} 탈락!`, 'blood', 1700);
        audio.out();
        replay(box, 'shaking');
      });
    }
  }
  // 도구를 쓴 장면 (모두에게 보인다)
  function toolScene(e) {
    const T = TOOLS[e.t];
    if (!T) return;
    if (e.t === 'sickle') {
      const el = cellOf(e.to, e.s);
      if (el) { replay(el, 'hit'); burst(el, ['#b13e53', '#f4f4f4', '#94b0c2'], 22, 1.4); floatAt(el, '낫', 'hit', 't_sickle'); }
      audio.sac();
    } else if (e.t === 'coin' || e.t === 'moktak') {
      const g = gaugeOf(e.f);
      floatAt(g || tagOf(e.by), `${nameOf(e.by)} ${e.t === 'coin' ? '엽전' : '목탁'}`, 'gold', `t_${e.t}`);
      if (g) replay(g, 'pushed');
      audio.tool();
    } else if (e.t === 'charm') {
      const el = cellOf(e.by, e.s);
      if (el) floatAt(el, '부적', 'gold', 't_charm');
      audio.tool();
    } else {
      floatAt(tagOf(e.by), { coop: '닭 +2', fan: '부채', sack: '뼈 +4' }[e.t] || T.name, 'gold', `t_${e.t}`);
      audio.tool();
    }
  }

  /* ── 미리 보기: 지금 판 + 내 계획대로 싸우면 ── */
  function preview(R) {
    const T = simState(S);
    T.board[me] = R.board.map(c => (c ? { ...c } : 0));
    T.bones[me] = R.bones;
    const res = runFight(T, () => 0.5);
    return { T, res, doom: new Set(res.deaths.map(x => x.card.u)) };
  }

  /* ── 그리기 ── */
  function gaugeHtml(v, pv, danger) {
    const rows = [];
    for (let r = 0; r <= 2 * SCALE_MAX; r++) {
      const val = SCALE_MAX - r; // 맨 위 = +SCALE_MAX (이웃 쪽 끝)
      if (val === 0) { rows.push(h('i', { class: 'mid' })); continue; }
      const on = x => (x > 0 ? val > 0 && val <= x : val < 0 && val >= x);
      const now = on(v);
      const will = pv != null && on(pv);
      const cls = ['cell', Math.abs(val) === SCALE_MAX && 'end', val > 0 ? 'up' : 'down', now && 'on', !now && will && 'ghost', now && pv != null && !will && 'fade'].filter(Boolean).join(' ');
      rows.push(h('i', { class: cls }, now || will ? spr('i_tooth', '', 2) : null));
    }
    return [h('span', { class: 'sc-gend top' }, '▲'), ...rows, h('span', { class: `sc-gend bot${danger ? ' danger' : ''}` }, '▼')];
  }

  function paintFronts() {
    const p = pov();
    if (!p) return;
    const X = V();
    const L = leftOf(X, p);
    const R = rightOf(X, p);
    const planning = p === me && !shown && stepNo() && alive(me);
    const plan = planning ? sim() : null;
    const myRow = plan ? plan.board : rowOf(X, p);
    const orig = rowOf(X, p);
    const pv = plan && !local.ready && !S.ready?.[me] ? preview(plan) : null;
    const slots = planning ? mySlots() : [];
    const aim = planning && local.tool ? TOOLS[local.tool.t].aim : null;
    const st = stepNo();
    const fxMe = S.fx?.[p] || {};
    for (const F of fronts) {
      const here = !!planning && slots.some(s => (s < LANES ? 0 : 1) === F.i); // 지금 놓는 전선
      F.el.classList.toggle('active', here);
      F.el.classList.toggle('idle', !!planning && !here);
      const nb = F.i === 0 ? L : R;
      const f = F.i === 0 ? p : R;          // 이 전선의 이름 (왼쪽 전선 = 나, 오른쪽 전선 = 오른쪽 이웃)
      const lead = leadOf(X, f) === p;
      const fxNb = S.fx?.[nb] || {};
      // 이웃 머리글
      const fk = JSON.stringify([nb, X.candles?.[nb], X.bones?.[nb], S.hands?.[nb], S.toolsN?.[nb], S.ready?.[nb], S.drew?.[nb], lead, S.phase, smoked(X, nb, f), smoked(X, p, f),
        list(fxMe.mok).includes(f), list(fxNb.mok).includes(f), !!fxNb.fan, S.road?.st?.[nb]?.done]);
      if (fk !== F.fk) {
        F.fk = fk;
        const n = who(nb);
        const drew = S.phase === 'place1' && S.drew?.[nb];
        F.foe.replaceChildren(...[
          avatar(n), h('b', { class: 'sc-fname' }, n.name),
          h('span', { class: 'sc-candles' }, ...Array.from({ length: Math.max(CANDLES, X.candles?.[nb] || 0) }, (_, k) => candle(k < (X.candles?.[nb] || 0), 2))),
          h('span', { class: 'sc-chip' }, spr('i_bone', '', 2), String(X.bones?.[nb] || 0)),
          h('span', { class: 'sc-chip' }, `손패 ${S.hands?.[nb] || 0}`),
          S.toolsN?.[nb] ? h('span', { class: 'sc-chip', title: '도구 (무엇인지는 안 보인다)' }, `도구 ${S.toolsN[nb]}`) : null,
          drew ? h('span', { class: `sc-chip ${drew === 'hen' ? 'hen' : ''}` }, drew === 'hen' ? '닭 뽑음' : '덱 뽑음') : null,
          (S.ready?.[nb] && st) || (S.phase === 'road' && S.road?.st?.[nb]?.done) ? h('span', { class: 'sc-chip rang' }, spr('i_bell', '', 2), st ? '준비' : '고름') : null,
          smoked(X, nb, f) ? h('span', { class: 'sc-chip smoke' }, spr('i_smoke', '', 2), '연기') : null,
          list(fxMe.mok).includes(f) ? h('span', { class: 'sc-chip rang' }, spr('t_moktak', '', 1), '목탁 걸음') : null,
          list(fxNb.mok).includes(f) ? h('span', { class: 'sc-chip warn' }, spr('t_moktak', '', 1), '목탁 맞음') : null,
          fxNb.fan ? h('span', { class: 'sc-chip warn' }, spr('t_fan', '', 1), '부채') : null,
          h('span', { class: `sc-turn ${lead ? 'lead' : 'second'}`, title: lead ? '이번 턴 여기선 내가 먼저 놓고 먼저 친다' : '이번 턴 여기선 상대가 놓은 걸 보고 놓는다 (먼저 맞는다)' },
            spr(lead ? 'i_lead' : 'i_second', '', 2), lead ? '선공' : '후공'),
        ].filter(Boolean));
        F.el.classList.toggle('lead', lead);
      }
      // 칸
      for (const C of F.cols) {
        const fc = rowOf(X, nb)[across(C.s)];
        const mc = myRow[C.s];
        const og = orig[C.s];
        const sacked = planning && og && !mc;
        const planned = planning && mc && (!og || og.u !== mc.u);
        const tk = JSON.stringify([fc, pv?.doom.has(fc?.u), aim === 'foe' && !!fc]);
        if (tk !== C.tk) {
          C.tk = tk;
          C.top.className = `sc-cell foe${aim === 'foe' && fc ? ' aim' : ''}`;
          C.top.replaceChildren(fc ? cardEl(fc, true, pv?.doom.has(fc.u) ? 'doom' : '') : h('span', { class: 'sc-empty' }));
        }
        const marks = local.cur?.sac || [];
        const state = [
          slots.includes(C.s) && 'step',
          local.cur && slots.includes(C.s) && canPlace(C.s) && 'can',
          local.cur?.need && mc && !slots.includes(C.s) && !marks.includes(C.s) && 'sacable',
          marks.includes(C.s) && 'marked',
          planned && 'planned',
          aim === 'mine' && og && 'aim',
          list(fxMe.charm).includes(mc?.u) && 'charmed',
        ].filter(Boolean).join(' ');
        const bk = JSON.stringify([mc, sacked ? og : null, pv?.doom.has(mc?.u), state]);
        if (bk !== C.bk) {
          C.bk = bk;
          C.bot.className = `sc-cell mine ${state}`;
          C.bot.replaceChildren(...[
            mc ? cardEl(mc, true, pv?.doom.has(mc.u) ? 'doom' : '') : sacked ? cardEl(og, true, 'gone') : h('span', { class: 'sc-empty' }),
            marks.includes(C.s) ? h('span', { class: 'sc-mark' }, spr('i_blood', '', 3)) : null,
            list(fxMe.charm).includes(mc?.u) ? h('span', { class: 'sc-charm' }, spr('t_charm', '', 2)) : null,
          ].filter(Boolean));
        }
      }
      // 저울
      const v = scaleFor(X, p, f);
      const hit = pv?.res.lost.find(x => x.f === f);
      let pvv = pv ? scaleFor(pv.T, me, f) : null;
      if (hit) pvv = hit.to === me ? -SCALE_MAX : SCALE_MAX;
      const gk = JSON.stringify([v, pvv, aim === 'front']);
      if (gk !== F.gk) {
        F.gk = gk;
        F.gauge.replaceChildren(...gaugeHtml(v, pvv !== v ? pvv : null, v <= -(SCALE_MAX - 2)));
        F.gauge.classList.toggle('hot', v <= -(SCALE_MAX - 2));
        F.gauge.classList.toggle('aim', aim === 'front');
      }
      // 이대로면 …
      let note = '';
      let ncls = '';
      if (pv) {
        const unknown = st === 1 || leadOf(S, f) === me;
        if (hit) [note, ncls] = hit.to === me ? ['이대로면 내 촛불이 꺼진다', 'bad'] : ['이대로면 촛불을 끈다', 'good'];
        else if (pvv > v) [note, ncls] = [`이대로면 ▲${pvv - v}`, 'good'];
        else if (pvv < v) [note, ncls] = [`이대로면 ▼${v - pvv}`, 'bad'];
        else note = '이대로면 그대로';
        if (unknown) note += ' ?';
        F.note.title = unknown ? '상대가 아직 놓을 수 있어요' : '';
      }
      const nk = note + ncls;
      if (nk !== F.nk) {
        F.nk = nk;
        F.note.textContent = note;
        F.note.className = `sc-fnote ${ncls}`;
      }
    }
  }

  // 원탁 전체: 나를 가운데에, 왼쪽 이웃은 왼쪽에. 사람 사이 = 그 둘의 전선 저울
  function paintRing() {
    const X = V();
    const a = list(X.alive);
    const p = pov();
    const i = Math.max(0, a.indexOf(p));
    const n = a.length;
    const k = Math.floor((n - 1) / 2);
    const order = [];
    for (let j = k; j >= -(n - 1 - k); j--) order.push(a[(((i + j) % n) + n) % n]);
    const done = id => (S.phase === 'deck' ? S.deckDone?.[id] : S.phase === 'road' ? S.road?.st?.[id]?.done : stepNo() && S.ready?.[id]);
    const key = JSON.stringify([order, X.board && order.map(id => rowOf(X, id).map(c => c && [c.k, c.hp, c.pid])), X.scale, X.candles, order.map(done), p]);
    if (key === keys.ring) return;
    keys.ring = key;
    ringEls.clear();
    const pill = (x, y) => { // 전선 y (y의 왼쪽 전선 = x를 향함)
      const v = X.scale?.[y] || 0;
      return h('span', { class: `sc-pill${Math.abs(v) >= SCALE_MAX - 2 ? ' hot' : ''}`, title: `${nameOf(x)} ↔ ${nameOf(y)} 저울` },
        v > 0 ? `◀${v}` : v < 0 ? `${-v}▶` : '·');
    };
    const els = [];
    order.forEach((id, j) => {
      const P2 = who(id);
      const c = X.candles?.[id] || 0;
      const cls = ['sc-rchip', id === p && 'me', (id === leftOf(X, p) || id === rightOf(X, p)) && id !== p && 'nb', done(id) && 'rang'].filter(Boolean).join(' ');
      const el = h('div', { class: cls, title: P2.name },
        avatar(P2), h('span', { class: 'sc-rname' }, P2.name),
        h('span', { class: 'sc-rcandles' }, ...Array.from({ length: Math.max(CANDLES, c) }, (_, q) => candle(q < c, 1))),
        h('span', { class: 'sc-rrow' }, ...rowOf(X, id).map(cd => h('i', { class: cd ? 'on' : '' }, cd ? (cd.k === 'soul' ? avatar(who(cd.pid)) : spr(`p_${cd.k}`, '', 1)) : null))));
      ringEls.set(id, el);
      els.push(el);
      if (j < order.length - 1) els.push(pill(order[j], order[j + 1]));
    });
    if (n > 1) els.push(h('span', { class: 'sc-wrap', title: '원탁이라 양 끝도 서로 맞댄다' }, '↺', pill(order[n - 1], order[0])));
    ring.replaceChildren(...els);
  }

  function roadPrompt() {
    const st = myRoad();
    if (!st) return ['길목 · 하나 고르세요', 'mine'];
    if (st.done) return [roadResult(me, st) || '다른 사람 기다리는 중', 'calm'];
    if (st.kind === 'pack') return ['가질 카드를 고르세요', 'mine'];
    if (st.kind === 'tools') return ['가질 도구를 고르세요', 'mine'];
    if (st.kind === 'fire') {
      if (!st.u && !pick.fire) return ['달굴 카드를 고르세요', 'mine'];
      if (!st.n) return ['공격 +1 또는 체력 +2', 'mine'];
      return [`한 번 더 달구면 ${Math.round(BURN[st.n] * 100)}% 확률로 탄다`, 'warn'];
    }
    if (st.kind === 'altar') return pick.from ? ['문양을 받을 카드를 고르세요', 'mine'] : ['바칠 카드를 고르세요 (문양을 넘겨준다)', 'mine'];
    return ['', ''];
  }
  function roadResult(id, st) {
    if (!st?.done) return '';
    const nm = id === me ? '' : `${nameOf(id)}: `;
    if (st.kind === 'pack') return `${nm}${CARDS[st.got]?.name || ''} 얻음`;
    if (st.kind === 'tools') return `${nm}${id === me ? TOOLS[st.got]?.name || '도구' : '도구'} 얻음`;
    if (st.kind === 'fire') return st.burnt ? `${nm}${st.nm} 타 버림!` : st.n ? `${nm}${st.nm} 달굼 ×${st.n}` : `${nm}모닥불 그만`;
    if (st.kind === 'altar') return st.skip ? `${nm}제단 건너뜀` : `${nm}${st.from} → ${st.to}`;
    return '';
  }

  function promptOf(mode) {
    if (hint && performance.now() < hint.until) return [hint.text, hint.cls];
    if (!S) return ['', ''];
    if (S.phase === 'intro') return [S.again ? '한 판 더!' : '죽여야 낼 수 있다. 왼쪽을 밀면 오른쪽이 뚫린다', ''];
    if (S.phase === 'final') return ['', ''];
    if (mode === 'soul') return pick.stat == null ? ['넋패: 공격·체력을 물려줄 카드', 'mine'] : ['넋패: 문양을 물려줄 카드', 'mine'];
    if (!inGame()) return ['관전 중', 'calm'];
    if (!alive(me)) return ['탈락 · 다른 사람 판을 볼 수 있어요', 'calm'];
    if (S.phase === 'deck') return mode === 'deck' ? ['시작 덱을 고르세요', 'mine'] : ['다른 사람 기다리는 중', 'calm'];
    if (S.phase === 'road') return roadPrompt();
    if (S.phase === 'reveal1' || S.phase === 'reveal2') return ['공개!', 'warn'];
    if (S.phase === 'fight') return ['선공이 먼저 치고, 살아남은 후공이 되받아친다', 'calm'];
    if (!stepNo()) return ['', ''];
    if (S.ready?.[me] || local.ready) return ['준비 완료 · 기다리는 중', 'calm'];
    if (local.tool) return [`${TOOLS[local.tool.t].name}: ${AIM[TOOLS[local.tool.t].aim]}`, 'warn'];
    if (canDraw()) return ['한 장 뽑으세요 (덱 또는 닭)', 'mine'];
    if (local.cur) {
      const need = local.cur.need;
      const have = curBlood(sim().board);
      const sac = !need ? '' : have ? ` · 제물 ${have}/${need}` : ` · 제물 ${need}마리는 약한 것부터`;
      return [`${cardName(local.cur)}: 빛나는 칸을 누르세요${sac}`, 'mine'];
    }
    if (!local.acts.length && S.round === 1 && stepNo() === 1) return ['닭을 놓고, 그 닭을 바쳐 센 카드를 내세요', 'mine'];
    return [local.acts.length ? '더 놓거나 준비 완료' : '카드를 고르고 빛나는 칸을 누르세요', 'mine'];
  }

  const btn = (label, onClick, cls = '', key = '') => h('button', {
    class: `sc-btn ${cls}`, type: 'button', tabindex: '-1',
    onClick: e => { e.currentTarget.blur(); unlock(); if (!cls.includes('off')) onClick(); },
  }, label, key ? h('kbd', {}, key) : null);
  // 길목 · 넋패에서 고를 것들을 카드처럼 늘어놓는다
  const choiceBtn = (i, cls, onPick, ...kids) => h('button', {
    class: `sc-choice ${cls}`, type: 'button', tabindex: '-1',
    onClick: e => { e.currentTarget.blur(); unlock(); onPick(); },
  }, h('span', { class: 'sc-hkey' }, String(i)), ...kids);
  const roadCard = (k, i, on) => choiceBtn(i + 1, `road${on ? ' can' : ' dim'}`, () => roadKey(i), spr(`r_${k}`, '', 3), h('b', {}, ROADS[k].name), h('span', { class: 'sc-dtip' }, ROADS[k].tip));
  const toolCard = (t, i, on, onPick) => choiceBtn(i + 1, `tool${on ? ' can' : ' dim'}`, onPick, spr(`t_${t}`, '', 3), h('b', {}, TOOLS[t].name), h('span', { class: 'sc-dtip' }, TOOLS[t].tip));
  const handCard = (c, i, on, onPick, cls = '') => h('button', {
    class: `sc-hcard${on ? ' can' : ' dim'} ${cls}`, type: 'button', tabindex: '-1',
    onClick: e => { e.currentTarget.blur(); unlock(); onPick(); },
  }, h('span', { class: 'sc-hkey' }, String(i + 1)), cardEl(c, false));
  const pager = total => (total > PAGE ? h('span', { class: 'sc-pager' }, `← ${pick.page + 1}/${Math.ceil(total / PAGE)} →`) : null);

  function roadPanel(mode) {
    const st = myRoad();
    const live = mode === 'road';
    if (!st) return list(S.road?.offers?.[me]).map((k, i) => roadCard(k, i, live));
    if (st.done) {
      const els = [];
      if (st.kind === 'pack' && st.got) els.push(cardEl({ k: st.got }, false, 'got'));
      if (st.kind === 'tools' && st.got) els.push(toolCard(st.got, 0, false, () => {}));
      if (st.kind === 'fire' && st.u) { const c = myCards().find(x => x.u === st.u); els.push(c ? cardEl(c, false, 'got') : h('span', { class: 'sc-burnt' }, `${st.nm} 타 버렸다!`)); }
      if (st.kind === 'altar' && !st.skip) els.push(h('span', { class: 'sc-nohand' }, `${st.from}의 ${list(st.gave).map(g => SIGILS[g].name).join(' · ')} → ${st.to}`));
      return els;
    }
    const choices = roadChoices();
    if (st.kind === 'pack') return choices.map((k, i) => handCard({ k }, i, live, () => roadKey(i)));
    if (st.kind === 'tools') return choices.map((t, i) => toolCard(t, i, live, () => roadKey(i)));
    if (st.kind === 'fire') {
      if (typeof choices[0] === 'object') return [...choices.map((c, i) => handCard(c, i, live, () => roadKey(i))), pager(myCards().length)].filter(Boolean);
      const c = myCards().find(x => x.u === (st.u || pick.fire));
      const risk = BURN[st.n || 0];
      return [c ? cardEl(c, false, 'got') : null,
        choiceBtn(1, 'stat can', () => roadKey(0), h('b', {}, '공격 +1'), h('span', { class: 'sc-dtip' }, risk ? `${Math.round(risk * 100)}% 타 버림` : '안전')),
        choiceBtn(2, 'stat can', () => roadKey(1), h('b', {}, '체력 +2'), h('span', { class: 'sc-dtip' }, risk ? `${Math.round(risk * 100)}% 타 버림` : '안전')),
        st.n ? choiceBtn(3, 'stat can', () => roadKey(2), h('b', {}, '그만'), h('span', { class: 'sc-dtip' }, '이대로 가져간다')) : null].filter(Boolean);
    }
    if (st.kind === 'altar') {
      const pool = !pick.from ? myCards().filter(x => sigOf(x).length) : myCards();
      const from = pick.from ? myCards().find(x => x.u === pick.from) : null;
      return [from ? cardEl(from, false, 'gone') : null, ...choices.map((c, i) => handCard(c, i, live, () => roadKey(i))),
        choices.length ? null : h('span', { class: 'sc-nohand' }, '새길 카드가 없어요 (Backspace)'), pager(pool.length)].filter(Boolean);
    }
    return [];
  }
  function soulPanel() {
    const src = list(P?.soul);
    const choices = soulChoices();
    const statCard = pick.stat != null ? src.find(c => c.u === pick.stat) : null;
    return [statCard ? cardEl(statCard, false, 'got') : null, ...choices.map((c, i) => handCard(c, i, true, () => soulKey(i + 1))),
      pager(pick.stat == null ? src.length : src.filter(c => sigOf(c).length).length)].filter(Boolean);
  }

  function paintPanel() {
    if (!S) return;
    const mode = modeOf();
    const [text, cls] = promptOf(mode);
    const planning = alive(me) && stepNo() && !shown;
    const R = planning ? sim() : null;
    const hand = R ? R.hand : myHand();
    const bones = R ? R.bones : S.bones?.[me] || 0;
    const key = JSON.stringify([mode, text, cls, hand.map(c => [c.u, c.da, c.dh, c.sig]), bones, local.cur, local.tool, local.acts.length, S.phase, S.deckDone?.[me], sent.deck, canDraw(),
      S.deckN?.[me], S.graveN?.[me], S.candles?.[me], P?.grave, alive(me), myTools(), S.road?.st?.[me], S.road?.offers?.[me], pick, myCards().length, list(P?.soul).length, S.fx?.[me],
      S.ready?.[me], local.ready, S.drew?.[me], sent.draw, list(S.alive).length]);
    if (key !== keys.panel) {
      keys.panel = key;
      prompt.className = `sc-prompt ${cls}`;
      prompt.textContent = text;
      // 이번 턴에 할 일: 뽑기 › 놓기 › 준비 완료 (지금 할 것이 빛난다)
      const st0 = stepNo();
      const isReady = !!(S.ready?.[me] || local.ready);
      const drewDone = !!S.drew?.[me] || sent.draw === S.round;
      steps.replaceChildren(...(st0 && alive(me) && inGame() ? [
        st0 === 1 ? h('span', { class: `sc-step ${drewDone || isReady ? 'done' : 'now'}` }, '뽑기') : null,
        h('span', { class: `sc-step ${isReady ? 'done' : drewDone || st0 === 2 ? 'now' : ''}` }, '놓기'),
        h('span', { class: `sc-step ${isReady ? 'done' : ''}` }, '준비 완료'),
      ].filter(Boolean) : []));
      const B = [];
      if (mode === 'plan') {
        if (local.cur || local.tool) B.push(btn('취소', undo, '', '⌫'));
        else B.push(btn('되돌리기', undo, local.acts.length ? '' : 'off', '⌫'), btn('준비 완료', ringBell, 'go', '␣'));
      } else if (mode === 'road') {
        const rs = myRoad();
        if (rs?.kind === 'fire' && pick.fire && !rs.u) B.push(btn('다른 카드', roadBack, '', '⌫'));
        if (rs?.kind === 'altar') B.push(btn(pick.from ? '다시' : '건너뛰기', roadBack, '', '⌫'));
      } else if (mode === 'soul' && pick.stat != null) {
        B.push(btn('다시', () => { pick.stat = null; pick.page = 0; paint(); }, '', '⌫'), btn('문양 없이', () => soulKey(0), '', '0'));
      } else if (mode === 'watch' && list(S.alive).length > 1) {
        B.push(btn('◀', () => turnWatch(-1), '', '←'), btn('▶', () => turnWatch(1), '', '→'));
      }
      btns.replaceChildren(...B);
      let cards;
      if (mode === 'soul') cards = soulPanel();
      else if (S.phase === 'deck' && inGame() && alive(me)) {
        cards = Object.entries(DECKS).map(([k, d], i) => h('button', {
          class: `sc-deckpick${sent.deck === k ? ' on' : mode === 'deck' ? ' can' : ' dim'}`, type: 'button', tabindex: '-1',
          onClick: e => { e.currentTarget.blur(); unlock(); pickDeck(i); },
        },
        h('span', { class: 'sc-dkey' }, String(i + 1)), h('b', {}, d.name), h('span', { class: 'sc-dtip' }, d.tip),
        h('span', { class: 'sc-dcards' }, ...d.cards.map(c => spr(`p_${c}`, '', 2)))));
      } else if (S.phase === 'road' && inGame() && alive(me)) cards = roadPanel(mode);
      else {
        const st = stepNo();
        cards = hand.map((c, i) => {
          const can = mode === 'plan' && !local.tool && !whyNot(c, R);
          const on = local.cur?.u === c.u;
          return h('button', {
            class: `sc-hcard${on ? ' on' : can ? ' can' : ' dim'}`, type: 'button', tabindex: '-1',
            onClick: e => { e.currentTarget.blur(); unlock(); if (mode === 'plan') pickCard(i); },
          }, h('span', { class: 'sc-hkey' }, String(i + 1)), cardEl(c, false));
        });
        if (!cards.length) cards = [h('span', { class: 'sc-nohand' }, !inGame() ? '관전 중' : alive(me) ? (st ? '손패 없음' : '') : '탈락')];
      }
      handEl.replaceChildren(...cards);
      // 내 것: 촛불 · 뼈 · 덱 · 무덤 · 도구 · 뽑기
      const bits = [];
      if (inGame() && alive(me) && S.phase !== 'deck' && S.phase !== 'intro') {
        bits.push(h('span', { class: 'sc-mine' }, h('b', {}, '나'), ...Array.from({ length: Math.max(CANDLES, S.candles?.[me] || 0) }, (_, k) => candle(k < (S.candles?.[me] || 0), 2))));
        bits.push(h('span', { class: 'sc-chip big' }, spr('i_bone', '', 2), `뼈 ${bones}`));
        bits.push(h('button', { class: `sc-draw${canDraw() ? ' can' : ''}`, type: 'button', tabindex: '-1', title: '← 내 덱에서 한 장', onClick: e => { e.currentTarget.blur(); unlock(); drawFrom('deck'); } },
          spr('i_deck', '', 2), canDraw() ? h('em', {}, '←') : null, `덱 ${S.deckN?.[me] || 0}`));
        bits.push(h('button', { class: `sc-draw hen${canDraw() ? ' can' : ''}`, type: 'button', tabindex: '-1', title: '→ 닭 더미에서 한 마리 (공짜 0/1)', onClick: e => { e.currentTarget.blur(); unlock(); drawFrom('hen'); } },
          spr('i_nest', '', 2), canDraw() ? h('em', {}, '→') : null, '닭'));
        bits.push(h('span', { class: 'sc-chip', title: list(P?.grave).map(k => CARDS[k]?.name).join(', ') || '비었음' }, spr('i_grave', '', 2), `무덤 ${S.graveN?.[me] || 0}`));
        myTools().forEach((t, i) => bits.push(h('button', {
          class: `sc-tool${mode === 'plan' ? ' can' : ''}${local.tool?.i === i ? ' on' : ''}`, type: 'button', tabindex: '-1', title: `${TOOLS[t].name}: ${TOOLS[t].tip}`,
          onClick: e => { e.currentTarget.blur(); unlock(); useTool(i); },
        }, h('em', {}, TOOL_KEY[i]), spr(`t_${t}`, '', 2), TOOLS[t].name)));
        if (S.fx?.[me]?.fan) bits.push(h('span', { class: 'sc-chip rang' }, spr('t_fan', '', 1), '부채'));
        if (hand.length >= HAND_MAX) bits.push(h('span', { class: 'sc-chip warn' }, '손패 가득'));
      }
      stat.replaceChildren(...bits);
    }
    let tKey = '';
    let make = null;
    const soul = soulTask();
    if (soul) {
      tKey = `soul:${soul.until}`;
      make = () => countdown(soul.until, SOUL_TIME);
    } else if (S.phase === 'deck') {
      tKey = 'deck';
      make = () => countdown(S.phaseEndsAt, DECK_TIME);
    } else if (S.phase === 'road') {
      tKey = `road:${S.road?.no}`;
      make = () => countdown(S.phaseEndsAt, ROAD_TIME);
    } else if (stepNo()) {
      tKey = `${S.phase}:${S.round}`;
      make = () => countdown(S.phaseEndsAt, PLACE_TIME);
    }
    if (tKey !== keys.timer) {
      keys.timer = tKey;
      timer.replaceChildren(...(make ? [make()] : []));
    }
  }

  function paintHead() {
    const moon = S.moon || 0;
    const phase = { place1: '선공 놓기', reveal1: '공개', place2: '후공 놓기', reveal2: '공개', fight: '타격', road: '길목' }[S.phase] || '';
    const leftTxt = S.round ? `${S.round}턴${phase ? ` · ${phase}` : ''} · 생존 ${list(S.alive).length}명${moon ? ` · 🌕 붉은 달 직격 +${moon}` : ''}` : S.phase === 'deck' ? '시작 덱 고르기' : '곧 시작해요';
    const p = pov();
    const rightTxt = alive(me) ? `🕯️ ${S.candles?.[me] || 0} · 🦴 ${S.bones?.[me] || 0} · 🃏 ${S.hands?.[me] || 0}장`
      : `${inGame() ? '💀 구경 중' : '👀 관전 중'}${p ? ` · ${who(p).name}의 판 (← →)` : ''}`;
    if (keys.head === leftTxt + rightTxt) return;
    keys.head = leftTxt + rightTxt;
    head.replaceChildren(h('span', {}, leftTxt), h('span', {}, rightTxt));
  }

  function paintSide() {
    const out = Object.entries(S.outAt || {}).sort((a, b) => a[1] - b[1]).map(([id]) => id);
    const log = list(S.log);
    const key = JSON.stringify([S.alive, out, log, S.candles, S.picked, S.toolsN]);
    if (key === keys.side) return;
    keys.side = key;
    side.replaceChildren(...[
      h('h3', {}, `생존 ${list(S.alive).length}명`),
      h('ul', { class: 'sc-alive' }, list(S.alive).map(id => h('li', {}, avatar(who(id)), h('b', {}, who(id).name),
        h('span', { class: 'sc-candles' }, ...Array.from({ length: Math.max(CANDLES, S.candles?.[id] || 0) }, (_, k) => candle(k < (S.candles?.[id] || 0), 1))),
        S.picked?.[id] ? h('small', {}, DECKS[S.picked[id]]?.name || '') : null,
        S.toolsN?.[id] ? h('small', {}, ` · 도구 ${S.toolsN[id]}`) : null))),
      out.length ? h('h3', {}, '탈락') : null,
      out.length ? h('ul', { class: 'rules' }, out.map(id => h('li', {}, h('b', {}, who(id).name), S.dead?.[id] ? ` ← ${who(S.dead[id]).name}` : ''))) : null,
      log.length ? h('h3', {}, '방금') : null,
      log.length ? h('ol', { class: 'sc-log' }, log.map(t => h('li', {}, t))) : null,
      h('h3', {}, '하는 법'),
      h('ol', { class: 'sc-how' },
        h('li', {}, '한 장 뽑는다 (덱 또는 닭)'),
        h('li', {}, '카드를 골라 빛나는 칸에 놓는다'),
        h('li', {}, '피 카드는 내 생물을 바쳐야 나온다'),
        h('li', {}, '다 놓았으면 준비 완료'),
        h('li', {}, `빈칸을 치면 직격, 저울이 ${SCALE_MAX}칸 기울면 촛불이 꺼진다`),
        h('li', {}, `촛불 ${CANDLES}개가 다 꺼지면 탈락`)),
      h('h3', {}, '알아 두기'),
      h('ul', { class: 'rules' },
        h('li', {}, '홀수 턴은 왼쪽, 짝수 턴은 오른쪽 전선이 선공'),
        h('li', {}, '선공은 먼저 놓고 먼저 친다. 후공은 보고 놓는다'),
        h('li', {}, '생물이 죽으면 뼈 1. 뼈 카드는 뼈로 낸다'),
        h('li', {}, `${ROAD_EVERY}턴마다 길목, 촛불을 끄면 도구 +1`),
        h('li', {}, `${MOON[MOON.length - 1][0]}턴부터 붉은 달: 직격이 세진다`),
        h('li', {}, '탈락하면 넋패가 되어 꺼뜨린 사람 손으로')),
      h('h3', {}, '조작'),
      h('ul', { class: 'rules' },
        h('li', {}, '클릭: 카드 → 칸'),
        h('li', {}, `숫자 카드 · Q W E R 칸 · ${TOOL_KEY.join(' ')} 도구`),
        h('li', {}, '← 덱 · → 닭 · ⌫ 되돌리기 · ␣ 준비 완료')),
      h('h3', {}, '도구'),
      h('ul', { class: 'sc-siglist' }, Object.entries(TOOLS).map(([k, t]) => h('li', {}, spr(`t_${k}`, '', 2), h('span', {}, h('b', {}, t.name), ` ${t.tip}`)))),
      h('h3', {}, '문양'),
      h('ul', { class: 'sc-siglist' }, Object.entries(SIGILS).map(([k, g]) => h('li', {}, spr(`g_${k}`, '', 2), h('span', {}, h('b', {}, g.name), ` ${g.tip}`)))),
      h('h3', {}, '카드'),
      h('ul', { class: 'sc-cardlist' }, Object.entries(CARDS).filter(([k]) => k !== 'soul').map(([k, c]) => h('li', { title: cardTip({ k }) }, spr(`p_${k}`, '', 1),
        h('span', {}, h('b', {}, c.name), ` ${costOf(c)} · ${c.atk}/${c.hp}${c.sig.length ? ` · ${c.sig.map(g => SIGILS[g].name).join(' · ')}` : ''}${c.grown ? ' · 자라야 나옴' : c.grow ? ` → ${CARDS[c.grow].name}` : ''}`)))),
    ].filter(Boolean));
  }

  function paint() {
    if (!S) return;
    paintHead();
    paintRing();
    paintFronts();
    paintPanel();
    paintSide();
    box.classList.toggle('moon', (S.moon || 0) > 0);
    box.classList.toggle('deckphase', S.phase === 'deck' || S.phase === 'intro' || S.phase === 'road');
  }

  const snap = X => ({
    round: X.round, moon: X.moon, alive: [...list(X.alive)],
    board: Object.fromEntries(list(X.alive).map(id => [id, rowOf(X, id).map(c => (c ? { ...c } : 0))])),
    scale: { ...(X.scale || {}) }, candles: { ...(X.candles || {}) }, bones: { ...(X.bones || {}) }, smoke: X.smoke || {},
  });

  return {
    update({ state, priv }) {
      S = state;
      P = priv || null;
      S.alive = list(S.alive);
      S.order = list(S.order);
      const lk = `${S.round}:${stepNo()}`;
      if (local.key !== lk) local = { key: lk, acts: [], cur: null, ready: false, tool: null };
      // 손패에서 사라진 카드를 쓰는 계획은 버린다 (방장이 고친 손패가 기준)
      if (local.acts.length && sim().done !== local.acts.length) { local.acts = []; local.cur = null; }
      if (local.cur && !sim().hand.some(c => c.u === local.cur.u)) local.cur = null;
      if (local.tool && myTools()[local.tool.i] !== local.tool.t) local.tool = null;
      const pk = `${S.phase === 'road' ? `road${S.road?.no}` : ''}:${soulTask()?.from || ''}`;
      if (pick.key !== pk) pick = { key: pk, page: 0, fire: null, from: null, stat: null };
      const pre = last;
      last = snap(S);
      if (!seen) {
        seen = { rs: S.rsNo || 0, round: S.round || 0, final: false, moon: S.moon || 0, deck: S.phase !== 'deck', tl: S.tlogNo || 0, road: S.road?.no || 0, roadDone: {}, souls: list(S.souls).filter(e => e.done).length };
        for (const [id, st] of Object.entries(S.road?.st || {})) if (st.done) seen.roadDone[id] = true;
        if (S.phase === 'intro') setBanner('피의 저울', 'gold');
      }
      if (S.phase === 'deck' && !seen.deck) {
        seen.deck = true;
        setBanner('시작 덱', 'gold', 1400);
        audio.draw();
      }
      if ((S.rsNo || 0) !== seen.rs) {
        seen.rs = S.rsNo || 0;
        if (pre && list(S.rs).length) play(pre);
      }
      for (const e of list(S.tlog)) { // 도구를 쓴 장면
        if (e.n <= seen.tl) continue;
        seen.tl = e.n;
        later(30, () => toolScene(e));
      }
      if (S.phase === 'road' && (S.road?.no || 0) !== seen.road) {
        seen.road = S.road?.no || 0;
        seen.roadDone = {};
        later(shown ? 500 : 0, () => { setBanner('길목', 'gold', 1500); audio.road(); });
      }
      if (S.road) { // 길목에서 고른 것: 이름표 위에 (모닥불에 탔으면 크게)
        for (const [id, st] of Object.entries(S.road.st || {})) {
          if (!st.done || seen.roadDone[id]) continue;
          seen.roadDone[id] = true;
          if (st.burnt) { audio.burn(); if (id !== me) setBanner(`${nameOf(id)}의 ${st.nm} 타 버림!`, 'blood', 1400); }
          if (id === me && st.burnt) setBanner(`${st.nm} 타 버림!`, 'blood', 1600);
          later(80, () => floatAt(tagOf(id), roadResult(id, st).replace(`${nameOf(id)}: `, ''), st.burnt ? 'hit' : 'gold'));
        }
      }
      const souls = list(S.souls);
      const doneSouls = souls.filter(e => e.done).length;
      if (doneSouls > seen.souls) { // 넋패가 만들어졌다
        for (const e of souls.filter(x => x.done).slice(seen.souls)) {
          if (!e.got) continue;
          if (e.to === me) later(200, () => { setBanner(`${nameOf(e.from)}의 넋패를 받았다!`, 'gold', 1800); audio.soul(); });
          else later(200, () => floatAt(tagOf(e.to), `${nameOf(e.from)}의 넋패`, 'calm'));
        }
        seen.souls = doneSouls;
      }
      if (S.phase === 'place1' && S.round !== seen.round) {
        seen.round = S.round;
        hint = null;
        if ((S.moon || 0) > seen.moon) {
          seen.moon = S.moon;
          later(400, () => { setBanner(`붉은 달! 직격 +${S.moon}`, 'blood', 1800); audio.moon(); });
        } else later(shown ? 600 : 0, () => setBanner(`${S.round}턴 · ${S.round % 2 ? '왼쪽' : '오른쪽'}부터`, '', 1300));
        if (S.round > 1 && alive(me)) audio.draw();
      }
      if (S.phase === 'place2' && seen.place2 !== S.round) {
        seen.place2 = S.round;
        later(shown ? 300 : 0, () => setBanner(`이제 ${S.round % 2 ? '오른쪽' : '왼쪽'}`, '', 900));
      }
      // 내 촛불이 하나 남았고 어느 저울이든 끝에 가까우면 두근두근
      const danger = alive(me) && pov() === me && (S.candles?.[me] || 0) === 1
        && [me, rightOf(S, me)].some(f => scaleFor(S, me, f) <= -(SCALE_MAX - 2));
      audio.heart(!S.over && danger && !!stepNo());
      box.classList.toggle('final', S.phase === 'final');
      if (S.phase === 'final' && !seen.final) {
        seen.final = true;
        shown = null;
        if (S.winner === me) audio.win();
        board.replaceChildren(h('div', { class: 'rx-result' },
          h('h2', { class: 'display' }, S.winner ? `🕯️ ${josa(nameOf(S.winner), '이', '가')} 마지막 촛불!` : '🕯️ 끝!'),
          podium(list(S.roster), S.standings, me)));
      }
      paint();
    },
    unmount() {
      cancelAnimationFrame(raf);
      clearTimeout(planTimer);
      for (const t of timers) clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', unlock);
      audio.dispose();
    },
  };
}
