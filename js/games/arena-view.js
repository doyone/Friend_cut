// 투기장 화면. 규칙은 arena-core.js (방장이 돌린다).
// 도트 그림은 art/arena.px.js (pxl)로 그려서 img/arena 에 구운 것, 전부 3배(도트 한 칸 = 3px). 얼굴만 다른 게임과 같은 그림.
import { h, digitOf, isTyping, josa, pick } from '../util.js';
import { avatar, countdown, podium } from '../ui.js';
import {
  CARDS, RELICS, TIERS, HP_MAX, HAND_MAX, DRAW, CROWD, ATTACK_TIME, DEFEND_TIME, PICK_TIME, LOOT_TIME, PICK_EVERY, RAGE,
  ULTS, BEAST, FURY_MAX, BREAK, ULT_ROUND, BEAST_FIRST, WHIMS, WHIM_FIRST, WHIM_EVERY, GRUDGE, GRUDGE_MAX,
  attackOf, energyOf, relicsOf, has, isVuln, isWeak, isStun, isFort, rageOf, furyOf, charging, whimOf, lockOf, handMaxOf,
} from './arena-core.js';
import { createArenaAudio } from './arena-audio.js';

const ART = new URL('../../img/arena/sprites/', import.meta.url).href;
const ANIM = new URL('../../img/arena/anims/', import.meta.url).href;
const PX = 3;
const SIZE = { // 그림 크기 (도트). 여기 없는 건 16×16
  life: [9, 8], life_off: [9, 8], en: [6, 6], en_off: [6, 6], cardback: [7, 9], skull: [9, 9],
  st_bleed: [7, 8], st_vuln: [9, 9], st_weak: [8, 8], st_stun: [7, 7], revenge: [7, 8], mark: [19, 19], splat_a: [14, 8], splat_b: [10, 6], crown: [11, 7],
  st_grudge: [7, 8], wheel_pin: [11, 8],
};
// 관중의 변덕 룰렛판: 시계 방향 한 바퀴를 WHEEL_FRAMES장에 구웠다 (anims/wheel.png 가로 띠, 한 장 WHEEL×WHEEL 도트).
// 칸(WHIMS 순서)마다 WHEEL_STEP장. k번째 칸이 바늘(맨 위) 아래 오는 장 = -k × WHEEL_STEP
const WHIM_KEYS = Object.keys(WHIMS);
const WHEEL = 80;
const WHEEL_FRAMES = 64;
const WHEEL_STEP = WHEEL_FRAMES / WHIM_KEYS.length;
const WHEEL_SPIN = 2300; // 돌다가 멈추기까지 (방장은 WHIM_TIME 뒤에 공격 단계를 연다)
function spr(name, cls = '', scale = PX) {
  const [w, hh] = SIZE[name] || [16, 16];
  return h('img', { class: `ar-spr ${cls}`, src: `${ART}${name}.png`, alt: '', draggable: 'false', width: w * scale, height: hh * scale });
}
const list = v => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);

// 카드에 적는 한마디
function shortOf(d) {
  if (d.type === 'w') return `피해 ${d.dmg}`;
  if (d.block) return `방어 ${d.block}`;
  if (d.undying) return '안 쓰러짐';
  if (d === CARDS.twin) return '한 번 더';
  if (d === CARDS.taunt) return '도발';
  if (d.dodge) return '회피';
  if (d.redirect) return '넘기기';
  if (d.reflect) return '반사';
  if (d.heal) return `체력 +${d.heal}`;
  if (d.energy) return `기력 +${d.energy}`;
  if (d.plus) return `공격 +${d.plus}`;
  return '기습';
}

export default function mount(root, api) {
  const me = api.me;
  const audio = createArenaAudio();
  const head = h('div', { class: 'rx-head' });
  const fx = h('canvas', { class: 'ar-fx' });
  const flashEl = h('div', { class: 'ar-flash' });
  const banner = h('div', { class: 'ar-banner' });
  const sub = h('div', { class: 'ar-sub' });
  const incoming = h('div', { class: 'ar-incoming' });
  const center = h('div', { class: 'ar-center' }, banner, sub, incoming);
  const labels = h('div', { class: 'ar-labels' });
  const wallEl = h('div', { class: 'ar-wall' });
  const stains = h('div', { class: 'ar-stains' }); // 쓰러진 자리에 남는 핏자국 (판이 끝날 때까지)
  const dim = h('div', { class: 'ar-dim' });       // 타격 장면에서 둘만 남기고 어둡게
  // 야수: 모래판 위쪽 한가운데. 체력 막대와 누구를 노리는지
  const beastBody = h('div', { class: 'ar-beast-body', style: `background-image:url(${ANIM}beast.png)` });
  const beastFill = h('i');
  const beastNum = h('b');
  const beastTag = h('span', { class: 'ar-beast-tag' });
  const beastEl = h('div', { class: 'ar-beast' }, beastTag, beastBody, h('div', { class: 'ar-hp' }, beastFill, beastNum), spr('mark', 'ar-mark'));
  const BEAST_AT = { x: 50, y: 43 };
  // 관중의 변덕: 한가운데서 도는 룰렛판, 멈추면 그 턴 내내 위쪽에 작은 표로 남는다
  const disc = h('div', {
    class: 'ar-disc',
    style: `width:${WHEEL * PX}px;height:${WHEEL * PX}px;background-image:url(${ANIM}wheel.png);background-size:${WHEEL * WHEEL_FRAMES * PX}px ${WHEEL * PX}px`,
  });
  const wheelName = h('div', { class: 'ar-wheel-name' });
  const wheelEl = h('div', { class: 'ar-wheel' }, h('div', { class: 'ar-wheel-top' }, '관중의 변덕'), h('div', { class: 'ar-wheel-box' }, disc, spr('wheel_pin', 'ar-pin')), wheelName);
  const whimEl = h('div', { class: 'ar-whim' });
  const field = h('div', { class: 'ar-field' },
    wallEl, h('div', { class: 'ar-glow l' }), h('div', { class: 'ar-glow r' }), h('div', { class: 'ar-torch l' }), h('div', { class: 'ar-torch r' }),
    spr('splat_a', 'ar-splat s1'), spr('splat_b', 'ar-splat s2'), spr('splat_b', 'ar-splat s3'), stains, dim, beastEl,
    center, labels, fx, whimEl, wheelEl, flashEl);
  const prompt = h('div', { class: 'ar-prompt' });
  const stat = h('div', { class: 'ar-stat' });
  const handEl = h('div', { class: 'ar-hand' });
  const timer = h('div', { class: 'ar-timer' });
  const panel = h('div', { class: 'ar-panel' }, prompt, stat, handEl, timer);
  const board = h('div', { class: 'ar-board' });
  const sound = h('button', { class: 'ar-sound', type: 'button', tabindex: '-1' });
  const box = h('div', { class: 'ar-box' }, field, panel, board, sound);
  const side = h('aside', { class: 'side' });
  root.append(h('div', { class: 'ar' }, h('div', { class: 'ar-main' }, head, box), side));
  document.activeElement?.blur?.();
  document.fonts?.load('22px "Galmuri11"', '투기장 공개 쓰러짐').catch(() => {});
  for (const name of [...Object.keys(CARDS).map(k => `c_${k}`), ...Object.keys(RELICS).map(k => `r_${k}`)]) new Image().src = `${ART}${name}.png`;
  new Image().src = `${ANIM}slash.png`;
  for (const k of Object.keys(ULTS)) new Image().src = `${ART}u_${k}.png`;
  for (const k of WHIM_KEYS) new Image().src = `${ART}w_${k}.png`;
  new Image().src = `${ANIM}wheel.png`;

  let S = null;
  let P = null;
  let seatKey = '';
  const seats = new Map(); // pid → { el, face, hpFill, hpNum, lives, meta, relics, tags, badge, x, y, key }
  // 이번 턴에 내가 정한 것 (방장 답을 안 기다리고 내 화면에서 먼저 보인다)
  let local = { round: -1, t: null, load: [], ready: false, def: [], ready2: false, u: false };
  const sent = { pick: -1, loot: '', will: -1 };
  let grudge = null;    // 망령(탈락한 나)이 원한을 건 사람. 그 사람이 살아 있는 동안 이어진다
  let will = { r: 0, to: null }; // 유산: 물려줄 유물(몇 번째) · 받을 사람
  let wheelFrame = 0;   // 룰렛판이 지금 보여 주는 장
  let spin = null;      // 도는 중 { from, total, t0, last, k }
  let seen = null;      // 이미 연출한 것 (중간에 들어와도 지난 장면을 다시 틀지 않게)
  let prev = null;      // 결과가 나오기 전의 체력 · 목숨 · 생존 (결과 연출을 차례대로 보여 주려고)
  let shown = null;     // 결과 연출 중에 보여 주는 체력 · 목숨 · 생존
  let playNo = 0;
  let hint = null;
  let bannerNo = 0;
  let planTimer = null;
  let revealAt = 0;     // 화살표가 준비한 순서대로 하나씩 꽂히게
  let stainNo = 0;
  let defendAt = 0;     // 방어 단계가 열린 때 (공격 단계 막판에 누른 스페이스가 방어를 건너뛰지 않게)
  const keys = { head: '', panel: '', timer: '', side: '', labels: '', incoming: '' };
  const timers = new Set();
  const later = (ms, fn) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };
  const who = id => list(S.roster).find(p => p.id === id) || { id, name: '?' };
  const nameOf = id => (id === BEAST ? '야수' : who(id).name);
  // 자리(%) — 야수도 한 자리로 친다
  const spot = id => (id === BEAST ? (S.beast || shown?.beast ? BEAST_AT : null) : seats.get(id) || null);
  const info = r => RELICS[r] || ULTS[r] || { name: r, tip: '' };
  const iconOf = r => (RELICS[r] ? `r_${r}` : `u_${r}`);
  const lootKey = () => `${S.round}:${list(S.loot).filter(x => x.by === me && x.got).length}`;
  const canCast = () => alive(me) && !!S.ults?.[me] && furyOf(S, me) >= FURY_MAX && !S.charge?.[me];
  const biteOnMe = () => (S.beast?.t === me && alive(me) ? S.beast.dmg || 0 : 0);
  const alive = id => S.alive.includes(id);
  const inGame = () => list(S.roster).some(p => p.id === me);
  const myHand = () => list(P?.hand);
  const cardOf = u => myHand().find(c => c.u === u);
  const atkOf = id => S.atk?.[id] || null;
  const hpOf = id => (shown ? shown.hp[id] : S.hp?.[id]) || 0;
  const livesOf = id => (shown ? shown.lives[id] : S.lives?.[id]) || 0;
  const standing = id => (shown ? shown.alive.includes(id) : alive(id));

  const soundLabel = () => { sound.textContent = audio.enabled ? '소리 켜짐' : '소리 꺼짐'; };
  soundLabel();
  sound.addEventListener('click', () => {
    audio.toggle();
    soundLabel();
    sound.blur();
  });
  const unlock = () => { void audio.unlock(); };
  window.addEventListener('pointerdown', unlock);

  // 탈락한 나: 망령이 되어 원한을 걸고(공격 단계), 탈락한 직후엔 유산을 물려준다(약탈 단계)
  const ghost = () => !!S && inGame() && !alive(me) && !!S.dead?.[me];
  const myWill = () => (S.phase === 'loot' && ghost() ? list(S.loot).find(x => x.kind === 'will' && x.by === me && !x.set) || null : null);
  // 이번 턴에 내가 겨눌 수 있는 한 사람 (도발 · 공개 처형). 없으면 null
  const lock = () => (alive(me) ? lockOf(S, me) : null);
  // 지금 내가 할 수 있는 것: pick(유물) · attack(공격 단계) · defend(방어 단계) · loot(약탈) · ghost(원한) · will(유산) · null
  function modeOf() {
    if (!S || S.over) return null;
    if (ghost()) return S.phase === 'attack' ? 'ghost' : myWill() && sent.will !== S.round ? 'will' : null;
    if (!alive(me)) return null;
    if (S.phase === 'pick') return S.pick && !S.pick.shown && !S.pick.done?.[me] && sent.pick !== S.pick.no && list(S.pick.offers?.[me]).length ? 'pick' : null;
    if (S.phase === 'attack') return !S.ready?.[me] && !local.ready ? 'attack' : null;
    if (S.phase === 'defend') return !S.ready2?.[me] && !local.ready2 ? 'defend' : null;
    if (S.phase === 'loot') return myLoot() && sent.loot !== lootKey() ? 'loot' : null;
    return null;
  }
  const myLoot = () => list(S.loot).find(x => x.kind !== 'will' && x.by === me && !x.got) || null;
  // 고른 카드까지 따진 남은 기력
  function energyNow() {
    const uids = S.phase === 'defend' ? local.def : local.load;
    let e = S.phase === 'defend' ? S.left?.[me] || 0 : energyOf(S, me);
    for (const u of uids) {
      const d = CARDS[cardOf(u)?.k];
      if (d) e += (d.energy || 0) - d.cost;
    }
    return e;
  }
  const loadedKeys = () => local.load.map(u => cardOf(u)?.k).filter(Boolean);
  // 이 단계에 낼 수 있는 카드인가
  function fits(def, mode) {
    if (mode === 'attack') return def.type !== 'd';
    if (mode === 'defend') return def.type === 'd' || (def.type === 't' && def.when !== 'a');
    return false;
  }

  // 내 자리(아래)에서 본 방향: 0 = 맞은편, 음수 = 왼쪽, 양수 = 오른쪽
  function sideAngle(id) {
    const m = seats.get(me);
    const s = seats.get(id);
    return m && s ? Math.atan2(s.x - m.x, m.y - s.y) : 0;
  }
  const others = () => S.alive.filter(id => id !== me && seats.has(id)).sort((a, b) => sideAngle(a) - sideAngle(b));
  const opposite = () => [...others()].sort((a, b) => Math.abs(sideAngle(a)) - Math.abs(sideAngle(b)))[0] || null;
  function stepSide(cur, dir) {
    const all = others();
    if (!all.length) return cur;
    const i = all.indexOf(cur);
    if (i >= 0) return all[Math.max(0, Math.min(all.length - 1, i + dir))];
    const pickd = dir < 0 ? [...all].reverse().find(id => sideAngle(id) < -0.05) : all.find(id => sideAngle(id) > 0.05);
    return pickd || opposite();
  }

  function say(text, cls = 'hint', ms = 1800) {
    hint = { text, cls, until: performance.now() + ms };
    later(ms + 30, paintPanel);
    paintPanel();
  }
  function nope(text) {
    panel.classList.remove('nope');
    void panel.offsetWidth;
    panel.classList.add('nope');
    audio.deny();
    say(text, 'warn');
  }

  // 낼 카드 순서: 기력을 주는 카드 먼저 (방장이 차례대로 따진다)
  const ordered = uids => [...uids].sort((a, b) => (CARDS[cardOf(b)?.k]?.energy || 0) - (CARDS[cardOf(a)?.k]?.energy || 0));
  function sendPlan(ready) {
    clearTimeout(planTimer);
    planTimer = null;
    if (!S || S.phase !== 'attack') return;
    api.send('plan', { round: S.round, t: local.t, c: ordered(local.load), u: local.u, ready, at: api.now() });
  }
  function sendDef(ready) {
    clearTimeout(planTimer);
    planTimer = null;
    if (!S || S.phase !== 'defend') return;
    api.send('def', { round: S.round, c: ordered(local.def), ready });
  }
  // 시간이 끝나도 지금 고른 대로 나가게, 바뀔 때마다 (조금 모아서) 알려 둔다
  function touch() {
    hint = null;
    if (!planTimer) planTimer = setTimeout(() => (S?.phase === 'defend' ? sendDef(false) : sendPlan(false)), 250);
    paint();
  }

  function setAim(id) {
    if (local.t === (id || null)) return;
    local.t = id || null;
    audio.aim();
    touch();
  }

  // 망령의 원한: 고르는 대로 방장에게 알려 둔다 (공개 때 드러난다)
  function setGrudge(id) {
    if (grudge === (id || null)) return;
    grudge = id || null;
    api.send('grudge', { round: S.round, t: grudge });
    audio.aim();
    paint();
  }
  function sendWill() {
    const it = myWill();
    const r = list(it?.opts)[will.r];
    if (!r) return;
    if (!will.to || !alive(will.to)) return nope('← → 로 물려받을 사람을 고르세요');
    sent.will = S.round;
    api.send('will', { relic: r, to: will.to });
    audio.ready();
    paint();
  }

  function toggleCard(i) {
    const mode = modeOf();
    if (mode === 'pick') return choose(i);
    if (mode === 'loot') return loot(i);
    if (mode === 'will') {
      if (!list(myWill()?.opts)[i]) return;
      will.r = i;
      audio.load();
      return paint();
    }
    if (mode !== 'attack' && mode !== 'defend') return;
    const c = myHand()[i];
    if (!c) return;
    const def = CARDS[c.k];
    const bag = mode === 'attack' ? local.load : local.def;
    const at = bag.indexOf(c.u);
    if (at >= 0) {
      if (energyNow() - (def.energy || 0) + def.cost < 0) return nope('이 카드로 번 기력을 쓰고 있어요. 다른 카드를 먼저 빼세요');
      bag.splice(at, 1);
      audio.unload();
      return touch();
    }
    if (mode === 'attack' && local.u && def.type === 'w') return nope('필살기를 준비하는 턴엔 무기를 못 내요');
    if (!fits(def, mode)) return nope(mode === 'attack' ? '방어 카드는 방어 단계에 써요' : def.type === 'w' ? '무기는 공격 단계에 써요' : '공격 단계에만 쓰는 카드예요');
    if (def.cost > energyNow()) return nope(`기력이 모자라요 (남은 기력 ${energyNow()})`);
    bag.push(c.u);
    audio.load();
    touch();
  }

  function readyUp() {
    const mode = modeOf();
    if (mode === 'attack') {
      const armed = loadedKeys().some(k => CARDS[k].type === 'w');
      if (armed && !local.t && !local.u) return nope('← → 로 겨눌 사람을 고르세요');
      local.ready = true;
      sendPlan(true);
      audio.ready();
      hint = null;
      return paint();
    }
    if (mode === 'defend') {
      if (performance.now() - defendAt < 600) return;
      local.ready2 = true;
      sendDef(true);
      audio.ready();
      hint = null;
      paint();
    }
  }

  // R: 필살기 준비 (투지가 가득일 때). 이 턴엔 무기를 못 내고, 다음 턴 끝에 터진다
  function toggleUlt() {
    if (modeOf() !== 'attack') return;
    if (!S.ults?.[me]) return nope(`필살기는 ${ULT_ROUND}턴이 끝나면 골라요`);
    if (S.charge?.[me]) return nope('이미 준비 중이에요. 이번 턴 끝에 터져요');
    if (!canCast()) return nope(`투지가 모자라요 (${furyOf(S, me)}/${FURY_MAX})`);
    local.u = !local.u;
    if (local.u) local.load = local.load.filter(u => CARDS[cardOf(u)?.k]?.type !== 'w');
    audio[local.u ? 'charge' : 'unload']();
    touch();
  }

  function choose(i) {
    const r = list(S.pick?.offers?.[me])[i];
    if (!r) return;
    sent.pick = S.pick.no;
    local.picked = r;
    api.send('pick', { no: S.pick.no, relic: r });
    audio.load();
    paint();
  }
  function loot(i) {
    const it = myLoot();
    const r = list(it?.opts)[i];
    if (!r) return;
    sent.loot = lootKey();
    api.send('loot', { relic: r });
    audio.load();
    paint();
  }

  function onKey(e) {
    if (isTyping(e) || !S) return;
    const c = e.code;
    const d = digitOf(e);
    const dir = c === 'ArrowLeft' || c === 'KeyA' ? -1 : c === 'ArrowRight' || c === 'KeyD' ? 1 : 0;
    const down = c === 'ArrowDown' || c === 'KeyS';
    const up = c === 'ArrowUp' || c === 'KeyW';
    const space = c === 'Space';
    const back = c === 'Backspace';
    const ultKey = c === 'KeyR';
    if (!dir && !down && !up && !space && !d && !back && !ultKey) return;
    if (space || back || c.startsWith('Arrow')) e.preventDefault(); // 페이지가 스크롤되지 않게
    if (e.repeat) return;
    unlock();
    const mode = modeOf();
    if (!mode) return;
    if (d) return toggleCard(d - 1);
    if (mode === 'pick' || mode === 'loot') return;
    if (mode === 'ghost') { // 망령: ← → 로 원한을 걸 사람 (↑ 맞은편, ↓ 거두기)
      if (dir) setGrudge(stepSide(grudge, dir));
      else if (up) setGrudge(opposite());
      else if (down) setGrudge(null);
      return;
    }
    if (mode === 'will') { // 유산: ← → 받을 사람, 스페이스 = 확정
      if (dir || up) {
        will.to = dir ? stepSide(will.to, dir) : opposite();
        audio.aim();
        paint();
      } else if (space) sendWill();
      return;
    }
    if (space) return readyUp();
    if (ultKey) return toggleUlt();
    if (back) { // 고른 카드 다 빼기
      if (mode === 'attack') local.load = [];
      else local.def = [];
      audio.unload();
      return touch();
    }
    if (mode !== 'attack') return;
    const only = lock();
    if (only && (dir || up)) { // 도발당했거나 공개 처형: 그 사람만 겨눌 수 있다
      if (local.t === only) return nope(`이번 턴엔 ${nameOf(only)}만 겨눌 수 있어요`);
      return setAim(only);
    }
    if (dir) setAim(stepSide(local.t, dir));
    else if (down) setAim(null);
    else if (up) setAim(S.beast ? BEAST : opposite()); // 야수가 풀려 있으면 ↑ = 야수
  }
  window.addEventListener('keydown', onKey);

  /* ── 효과 그림판: 3배로 키우는 작은 캔버스에 도트로 그린다 (화살표 · 궤적 · 튀는 조각) ── */
  const g2 = fx.getContext('2d');
  let cw = 0;
  let ch = 0;
  const parts = [];
  const streaks = [];
  function fit() {
    const r = field.getBoundingClientRect();
    const w = Math.ceil(r.width / PX);
    const hh = Math.ceil(r.height / PX);
    if (w === cw && hh === ch) return;
    cw = fx.width = w;
    ch = fx.height = hh;
    fx.style.width = `${w * PX}px`;
    fx.style.height = `${hh * PX}px`;
  }
  function at(el) {
    const t = field.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return [Math.round((r.left + r.width / 2 - t.left) / PX), Math.round((r.top + r.height / 2 - t.top) / PX)];
  }
  const seatPt = id => (id === BEAST ? at(beastBody) : seats.get(id) ? at(seats.get(id).face) : [cw >> 1, ch >> 1]);
  function dots(a, b, color, gap = 1, off = 0, size = 1) {
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    if (!n) return;
    g2.fillStyle = color;
    for (let i = 0; i <= n; i++) {
      if (gap > 1 && (((i + off) % gap) + gap) % gap >= gap / 2) continue;
      g2.fillRect(Math.round(a[0] + ((b[0] - a[0]) * i) / n), Math.round(a[1] + ((b[1] - a[1]) * i) / n), size, size);
    }
  }
  // 자리에서 자리로 가는 화살표 (얼굴을 가리지 않게 조금 떨어져서 시작하고 끝난다)
  function arrow(a, b, color, gap, off, size, grow = 1) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 34 || grow <= 0) return;
    const ux = dx / len;
    const uy = dy / len;
    const s = [a[0] + ux * 13, a[1] + uy * 13];
    const full = [b[0] - ux * 15, b[1] - uy * 15];
    const e = [s[0] + (full[0] - s[0]) * Math.min(1, grow), s[1] + (full[1] - s[1]) * Math.min(1, grow)];
    dots(s, e, color, gap, off, size);
    if (grow < 1) return;
    g2.fillStyle = color;
    for (let k = 0; k < 5; k++) { // 화살촉
      for (let w = -k; w <= k; w++) g2.fillRect(Math.round(e[0] - ux * k - uy * w * 0.8), Math.round(e[1] - uy * k + ux * w * 0.8), size, size);
    }
  }
  function burst(p, colors, n = 16, speed = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.5 + Math.random() * 1.7) * speed;
      parts.push({ x: p[0], y: p[1], vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.5, g: 0.12, life: 9 + Math.random() * 11, c: pick(colors) });
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
    if (S.beast?.t && S.phase !== 'resolve' && S.phase !== 'pick' && seats.has(S.beast.t)) { // 야수가 노리는 사람
      arrow(seatPt(BEAST), seatPt(S.beast.t), '#b13e53', 3, -march, 2);
    }
    if (spin) spinStep(t);
    if (ghost() && seats.has(me)) { // 탈락한 나: 원한을 건 사람(잿빛) · 유산을 받을 사람(금빛) — 나에게만 보인다
      if (S.phase === 'attack' && grudge && seats.has(grudge)) arrow(seatPt(me), seatPt(grudge), '#94b0c2', 4, -march, 1);
      if (S.phase === 'loot' && will.to && seats.has(will.to) && myWill()) arrow(seatPt(me), seatPt(will.to), '#ffcd75', 4, -march, 1);
    }
    if (S.phase === 'attack' && local.t && alive(me) && spot(local.t)) { // 내가 겨눈 사람: 나에게만 보이는 금빛 점선
      arrow(seatPt(me), seatPt(local.t), '#ffcd75', 4, -march, 1);
    } else if (S.phase === 'reveal' || S.phase === 'defend') {     // 공개된 화살표: 나를 노린 건 붉고 굵게
      for (const [id, a] of Object.entries(S.atk || {})) {
        if (!a.t || !seats.has(id) || !spot(a.t)) continue;
        const onMe = a.t === me;
        const grow = (t - revealAt - (a.n - 1) * 140) / 220; // 준비한 순서대로 하나씩 날아와 꽂힌다
        arrow(seatPt(id), seatPt(a.t), onMe ? '#ef7d57' : id === me ? '#ffcd75' : '#7b8fb0', onMe ? 2 : 4, -march * (onMe ? 2 : 1), onMe || id === me ? 2 : 1, grow);
      }
    }
    for (let i = streaks.length - 1; i >= 0; i--) {
      const s = streaks[i];
      const k = (t - s.t0) / 130;
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
  }
  raf = requestAnimationFrame(frame);

  /* ── 관중의 변덕 룰렛 ── */
  function setWheel(f) {
    wheelFrame = ((f % WHEEL_FRAMES) + WHEEL_FRAMES) % WHEEL_FRAMES;
    disc.style.backgroundPosition = `${-wheelFrame * WHEEL * PX}px 0`;
  }
  // 빨리 돌다가 천천히 멈춘다 (칸이 바늘을 지날 때마다 딸깍)
  function spinStep(t) {
    const k = Math.max(0, Math.min(1, (t - spin.t0) / WHEEL_SPIN));
    const f = spin.from + Math.round(spin.total * (1 - (1 - k) ** 3));
    if (f !== spin.last) {
      const half = WHEEL_STEP / 2;
      if (Math.floor((f + half) / WHEEL_STEP) !== Math.floor((spin.last + half) / WHEEL_STEP)) audio.tick(k);
      spin.last = f;
      setWheel(f);
    }
    if (k < 1) return;
    const key = spin.k;
    spin = null;
    onLand(key);
  }
  function onWhim() {
    const k = S.whim?.k;
    const i = WHIM_KEYS.indexOf(k);
    if (i < 0) return;
    setBanner('', '');
    wheelName.replaceChildren('무엇이 나올까…');
    wheelEl.className = 'ar-wheel on';
    const target = (((-i * WHEEL_STEP) % WHEEL_FRAMES) + WHEEL_FRAMES) % WHEEL_FRAMES;
    const total = WHEEL_FRAMES * 3 + ((target - wheelFrame + WHEEL_FRAMES) % WHEEL_FRAMES); // 세 바퀴 돌고 그 칸에
    spin = { from: wheelFrame, total, t0: performance.now(), last: wheelFrame, k };
    audio.round();
    replay(field, 'hush');
  }
  function onLand(k) {
    const W = WHIMS[k];
    if (!W) return;
    wheelEl.classList.add('land');
    wheelName.replaceChildren(spr(`w_${k}`), h('b', {}, W.name), h('span', {}, W.tip));
    audio.whim();
    cheer();
    flash();
    burst([cw >> 1, ch >> 1], ['#ffcd75', '#f4f4f4', '#ef7d57'], 30, 1.7);
  }
  // 그 턴 내내 위쪽에 남는 표 (지금 무슨 변덕이 걸려 있나)
  function paintWhim() {
    const k = S.phase === 'whim' || S.over ? null : whimOf(S);
    if (keys.whim === (k || '')) return;
    keys.whim = k || '';
    whimEl.classList.toggle('on', !!k);
    if (k) whimEl.replaceChildren(spr(`w_${k}`, '', 2), h('b', {}, WHIMS[k].name), h('span', {}, WHIMS[k].tip));
  }

  function floatAt(id, text, cls = '', icon = null, dy = 0) {
    const s = spot(id);
    if (!s) return;
    const el = h('div', { class: `ar-float ${cls}`, style: `left:${s.x.toFixed(2)}%;top:calc(${s.y.toFixed(2)}% + ${dy}px)` }, icon ? spr(icon) : null, text);
    field.append(el);
    later(1300, () => el.remove());
  }
  function slashAt(id) {
    const s = spot(id);
    if (!s) return;
    const el = h('div', { class: 'ar-slash', style: `left:${s.x.toFixed(2)}%;top:${s.y.toFixed(2)}%;background-image:url(${ANIM}slash.png)` });
    if (Math.random() < 0.5) el.classList.add('flip');
    field.append(el);
    later(260, () => el.remove());
  }
  function setBanner(text, cls = '', ms = 0) {
    banner.textContent = text;
    banner.className = `ar-banner ${cls}`;
    const n = (bannerNo += 1);
    if (ms) later(ms, () => { if (bannerNo === n) banner.textContent = ''; });
  }
  function replay(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }
  const shake = id => { const s = seats.get(id); if (id === BEAST) replay(beastBody, 'hit'); else if (s) replay(s.face, 'hit'); };
  const flash = () => replay(flashEl, 'on');
  // 타격 장면: 때리는 사람과 맞는 사람만 밝게, 나머지는 어둡게
  function focus(ids, ms) {
    const n = (focus.no = (focus.no || 0) + 1);
    field.classList.add('focus');
    for (const [id, s] of seats) s.el.classList.toggle('act', ids.includes(id));
    later(ms, () => {
      if (focus.no !== n) return;
      field.classList.remove('focus');
      for (const s of seats.values()) s.el.classList.remove('act');
    });
  }
  // 쓰러진 자리에 핏자국이 남는다
  function stain(id) {
    const s = seats.get(id);
    if (!s || stains.childElementCount >= 14) return;
    const k = (stainNo += 1);
    const el = spr(k % 2 ? 'splat_a' : 'splat_b', 'ar-stain');
    el.style.left = `${(s.x + (50 - s.x) * 0.16 + ((k * 37) % 7) - 3).toFixed(2)}%`;
    el.style.top = `${(s.y + (58 - s.y) * 0.16 + ((k * 53) % 5) + 4).toFixed(2)}%`;
    if (k % 3 === 0) el.classList.add('flip');
    stains.append(el);
  }
  const cheer = () => replay(wallEl, 'cheer'); // 관중이 들썩인다

  /* ── 장면 연출 ── */
  function onPick() {
    const no = S.pick.no;
    setBanner(S.pick.kind === 'ult' ? '필살기!' : no === 0 ? '전투 스타일!' : '유물!', 'gold');
    audio.pick(S.pick.kind === 'ult' ? 3 : 1);
  }
  function onPicked() {
    setBanner(S.pick.kind === 'ult' ? '필살기 공개!' : S.pick.no === 0 ? '투기장 입장!' : '유물 공개!', 'gold', 1600);
    let top = 1;
    Object.entries(S.pick.got || {}).forEach(([id, r]) => {
      if (ULTS[r]) return floatAt(id, ULTS[r].name, 'relic ult', `u_${r}`);
      if (!RELICS[r]) return;
      top = Math.max(top, RELICS[r].tier);
      floatAt(id, RELICS[r].name, `relic t${RELICS[r].tier}`, `r_${r}`);
    });
    audio.pick(top);
  }
  function onRound() {
    audio.round();
    const rage = rageOf(S.round);
    const wasRage = rageOf(S.round - 1);
    const casters = S.alive.filter(id => charging(S, id));
    if (casters.length) { // 누가 필살기를 준비 중이다: 이번 턴에 끊어야 한다
      setBanner(casters.includes(me) ? '내 필살기가 터진다!' : `${nameOf(casters[0])}의 ${ULTS[S.charge[casters[0]].k].name}! 끊어라`, 'blood', 2200);
      audio.rage();
      replay(field, 'hush');
      for (const id of casters) floatAt(id, `${BREAK} 넘게 맞으면 끊긴다`, 'ult', `u_${S.charge[id].k}`);
    } else if (S.beast && S.beast.born === S.round) {
      setBanner('야수가 풀렸다!', 'blood', 2000);
      audio.roar();
      replay(field, 'punch');
    } else if (S.duel && !seen.duel) {
      seen.duel = true;
      setBanner('결투!', 'blood', 1800);
      audio.rage();
    } else if (rage > wasRage) {
      setBanner(`피의 함성 ×${rage}`, 'blood', 1800);
      audio.rage();
    } else if (whimOf(S)) setBanner(`${WHIMS[whimOf(S)].name}!`, 'gold', 1500);
    else setBanner(`${S.round}턴`, '', 900);
    const k = whimOf(S);
    if (k === 'arms') for (const id of S.alive) floatAt(id, '무기 2장', 'tool', 'w_arms');
    if (k === 'execution') for (const id of list(S.whim.pair)) floatAt(id, '처형대!', 'dead-small', 'w_execution');
    const only = lock();
    if (only) later(600, () => say(`이번 턴엔 ${nameOf(only)}만 겨눌 수 있어요`, 'warn', 2600));
  }
  function onReveal() {
    const mine = Object.values(S.atk || {}).filter(a => a.t === me);
    revealAt = performance.now();
    audio.reveal(mine.length > 0 && alive(me));
    replay(field, 'hush');
    const k = whimOf(S);
    setBanner(k === 'blind' ? '눈가리개!' : k === 'bare' ? '맨몸! 못 막는다' : '공개!', (mine.length && alive(me)) || k === 'bare' ? 'blood' : 'gold', 1500);
    for (const [id, n] of Object.entries(S.grudge || {})) { // 망령들의 원한이 드러난다
      later(350, () => floatAt(id, `망령의 원한 +${GRUDGE * Math.min(GRUDGE_MAX, n)}`, 'grudge', 'st_grudge', -34));
    }
    Object.values(S.atk || {}).filter(a => a.t).forEach(a => later((a.n - 1) * 140 + 220, () => { // 꽂힐 때마다 툭
      audio.aim();
      if (a.t === me) replay(box, 'shaking');
    }));
    if (mine.length && alive(me)) flash();
    for (const [id, a] of Object.entries(S.atk || {})) {
      if (a.smoke && !a.bl) floatAt(id, '연막!', 'smoke', 'c_smoke');
      if (a.tt) later(450, () => floatAt(a.tt, `도발당함! 다음 턴엔 ${nameOf(id)}만`, 'smoke', 'c_taunt', -34));
      if (a.cast && ULTS[a.cast]) {
        floatAt(id, `${ULTS[a.cast].name} 준비!`, 'ult', `u_${a.cast}`);
        later(500, () => { setBanner(`${nameOf(id)} 필살기 준비!`, 'gold', 1500); audio.charge(); });
      }
      const tools = list(a.tools).filter(c => c !== 'smoke' && c !== 'hone');
      tools.forEach((k, i) => later(200 + i * 250, () => floatAt(id, CARDS[k].name, 'tool', `c_${k}`, 30)));
    }
  }

  // 결과: 방장이 적어 준 장면(S.rs)을 준비한 순서대로 하나씩 보여 준다
  function onResolve() {
    const no = (playNo += 1);
    const evs = list(S.rs);
    const step = S.rsStep || 800;
    shown = prev ? { hp: { ...prev.hp }, lives: { ...prev.lives }, alive: [...prev.alive], beast: prev.beast ? { ...prev.beast } : null } : null;
    labels.replaceChildren();
    keys.labels = '';
    setBanner('', '');
    const live = () => no === playNo && S && S.phase === 'resolve';
    evs.filter(e => e.k === 'def').forEach((e, i) => later(60 + i * 90, () => {
      if (!live()) return;
      const cards = list(e.cards);
      if (cards.length) floatAt(e.to, e.b ? `방어 ${e.b}` : CARDS[cards[0]]?.name || '', 'block', `c_${cards.find(k => CARDS[k]?.type === 'd') || cards[0]}`);
      else if (e.b) floatAt(e.to, `방어 ${e.b}`, 'block');
    }));
    const scenes = evs.filter(e => e.k !== 'def');
    scenes.forEach((e, i) => later(480 + i * step, () => { if (live()) scene(e); }));
    later(480 + scenes.length * step + 200, () => { if (live()) paint(); });
  }
  const lose = (id, d) => { if (shown) shown.hp[id] = Math.max(0, (shown.hp[id] || 0) - d); };
  // 불사의 약: 쓰러질 걸 체력 1로 버텼다
  function undying(e, id) {
    if (!e.und) return;
    if (shown) shown.hp[id] = 1;
    later(200, () => {
      audio.reflect();
      floatAt(id, '불사의 약! 버텼다', 'relic t3', 'c_elixir', -40);
      burst(seatPt(id), ['#ffcd75', '#f4f4f4'], 22, 1.4);
      cheer();
    });
  }
  function fall(e, id) { // 쓰러짐(dn 1) · 탈락(dn 2)
    if (e.prize && e.by) later(700, () => floatAt(e.by, '관중의 포상!', 'relic t3', 'w_prize'));
    if (!e.dn) return;
    if (shown) {
      shown.hp[id] = 0;
      shown.lives[id] = Math.max(0, (shown.lives[id] || 0) - 1);
      if (e.dn === 2) shown.alive = shown.alive.filter(x => x !== id);
    }
    later(260, () => {
      flash();
      replay(box, 'shaking');
      replay(field, 'punch');
      cheer();
      stain(id);
      if (e.dn === 2) {
        audio.out();
        setBanner(`${nameOf(id)} 탈락!`, 'blood', 1500);
        floatAt(id, '탈락!', 'dead', 'skull');
      } else {
        audio.down();
        setBanner(`${nameOf(id)} 쓰러짐!`, 'blood', 1200);
        floatAt(id, '쓰러짐!', 'dead');
      }
      burst(seatPt(id), ['#b13e53', '#ef7d57', '#f4f4f4'], 34, 1.6);
      paintSeats();
    });
  }
  // 필살기 · 야수 장면
  function special(e) {
    const step = Math.min(S.rsStep || 800, 760);
    if (e.k === 'bhit') { // 야수를 때렸다
      focus([e.by], step);
      audio.swing();
      streak(seatPt(e.by), seatPt(BEAST));
      later(140, () => {
        audio.hit(e.d >= 12);
        slashAt(BEAST);
        shake(BEAST);
        if (shown?.beast) shown.beast.hp = Math.max(0, shown.beast.hp - e.d);
        floatAt(BEAST, `-${e.d}`, e.d >= 12 ? 'hit big' : 'hit');
        burst(seatPt(BEAST), ['#6a5374', '#b13e53', '#f4f4f4'], 14, 1.1);
        if (e.dn === 3) later(240, () => {
          flash();
          cheer();
          replay(field, 'punch');
          audio.out();
          setBanner(`${nameOf(e.by)} 야수 사냥!`, 'gold', 1600);
          burst(seatPt(BEAST), ['#6a5374', '#b13e53', '#ffcd75'], 40, 1.8);
          floatAt(e.by, '전설 전리품!', 'relic t3');
          if (shown) shown.beast = null;
          paintBeast();
        });
        paintBeast();
      });
      return true;
    }
    if (e.k === 'bite') { // 야수가 문다
      focus([e.to], step);
      audio.roar();
      streak(seatPt(BEAST), seatPt(e.to), 0, '#b13e53');
      replay(beastBody, 'lunge');
      later(170, () => {
        if (e.a) { audio.block(); floatAt(e.to, e.d ? `${e.a} 막음` : '막았다!', 'block', null, e.d ? 34 : 0); }
        if (e.d) {
          audio.hit(true);
          slashAt(e.to);
          shake(e.to);
          lose(e.to, e.d);
          floatAt(e.to, `-${e.d} 야수`, 'hit big');
          burst(seatPt(e.to), ['#b13e53', '#ef7d57'], 20, 1.3);
          if (e.to === me) replay(box, 'shaking');
        }
        paintSeats();
      });
      return true;
    }
    if (e.k === 'break') { // 필살기 끊김
      focus([e.to], step);
      audio.block();
      audio.cancel();
      shake(e.to);
      setBanner(`${nameOf(e.to)} 필살기 끊김!`, 'gold', 1400);
      floatAt(e.to, '끊겼다!', 'calm', ULTS[e.u] ? `u_${e.u}` : null);
      cheer();
      paintSeats();
      return true;
    }
    if (e.k === 'gift') {
      floatAt(e.to, RELICS[e.r]?.name || '유물', `relic t${RELICS[e.r]?.tier ?? 2}`, `r_${e.r}`);
      audio.pick(2);
      return true;
    }
    if (e.k === 'perfect') { // 역습 태세: 공격받고도 한 대도 안 맞았다
      audio.reflect();
      floatAt(e.to, '완벽한 방어! 다음 턴 기력 +1', 'block', 'c_parry');
      burst(seatPt(e.to), ['#73eff7', '#f4f4f4'], 16, 1.1);
      return true;
    }
    if (e.k === 'area') { // 번개(양옆) · 화약통(나머지 모두)
      const bolt = e.e === 'bolt';
      const hits = list(e.hits);
      focus([e.by, ...hits.map(x => x.to)], step + 300);
      audio[bolt ? 'zap' : 'boom']();
      if (!bolt) { flash(); replay(field, 'punch'); }
      floatAt(e.by, bolt ? '번개!' : '화약통!', 'tool', bolt ? 'c_bolt' : 'c_keg', 30);
      hits.forEach((x, i) => later(80 + i * 70, () => {
        streak(seatPt(e.by), seatPt(x.to), 0, bolt ? '#73eff7' : '#ef7d57');
        later(130, () => {
          if (x.a) floatAt(x.to, x.d ? `${x.a} 막음` : '막았다!', 'block', null, x.d ? 34 : 0);
          if (x.d) {
            audio.hit(false);
            shake(x.to);
            lose(x.to, x.d);
            floatAt(x.to, `-${x.d}`, 'hit');
            burst(seatPt(x.to), bolt ? ['#73eff7', '#f4f4f4', '#ffcd75'] : ['#ef7d57', '#ffcd75', '#b13e53'], 14, 1.2);
            if (x.to === me) replay(box, 'shaking');
          }
          undying(x, x.to);
          fall(x, x.to);
          paintSeats();
        });
      }));
      return true;
    }
    if (e.k !== 'ult') return false;
    const U = ULTS[e.u] || { name: '필살기' };
    const hits = list(e.hits);
    focus([e.by, ...hits.map(x => x.to), e.to].filter(Boolean), step + 900);
    flash();
    replay(field, 'punch');
    replay(box, 'shaking');
    audio.ult();
    setBanner(`${U.name}!`, 'gold ult', 1700);
    floatAt(e.by, U.name, 'relic ult', `u_${e.u}`);
    burst(seatPt(e.by), ['#ffcd75', '#f4f4f4', '#ef7d57'], 30, 1.6);
    hits.forEach((x, i) => later(260 + i * 110, () => {
      streak(seatPt(e.by), seatPt(x.to), 0, '#ffcd75');
      later(130, () => {
        if (x.a) floatAt(x.to, x.d ? `${x.a} 막음` : '막았다!', 'block', null, x.d ? 34 : 0);
        if (x.d) {
          audio.hit(true);
          slashAt(x.to);
          shake(x.to);
          lose(x.to, x.d);
          floatAt(x.to, `-${x.d}`, 'hit big');
          burst(seatPt(x.to), ['#b13e53', '#ffcd75'], 20, 1.4);
        }
        undying(x, x.to);
        fall({ ...x, by: e.by }, x.to);
        paintSeats();
      });
    }));
    if (e.heal) later(500, () => floatAt(e.by, `+${e.heal}`, 'block'));
    if (e.u === 'fort') later(300, () => floatAt(e.by, '3턴 동안 피해 절반', 'block', null, 34));
    if (e.u === 'warp') later(300, () => floatAt(e.by, '다음 턴 기력 6', 'block', null, 34));
    if (e.r && e.to) later(300, () => {
      streak(seatPt(e.to), seatPt(e.by), 0, '#ffcd75');
      floatAt(e.to, `${RELICS[e.r]?.name || '유물'} 뺏김!`, 'calm', `r_${e.r}`);
      paintSeats();
    });
    return true;
  }

  function scene(e) {
    if (special(e)) return;
    const from = seatPt(e.by);
    const to = seatPt(e.to);
    focus([e.by, e.to, e.fr].filter(Boolean), Math.min(S.rsStep || 800, 760) + (e.dn ? 700 : 0));
    if (e.k === 'hit') {
      const big = e.d >= 12;
      audio.swing();
      if (e.fr) { // 인간 방패: 원래 노린 사람을 거쳐 옆 사람에게
        streak(from, seatPt(e.fr));
        streak(seatPt(e.fr), to, 130);
        floatAt(e.fr, '인간 방패!', 'block', 'c_human');
      } else streak(from, to, 0, e.sm ? '#94b0c2' : '#f4f4f4');
      later(e.fr ? 260 : 140, () => {
        if (e.a) {
          audio.block();
          floatAt(e.to, e.d ? `${e.a} 막음` : '막았다!', 'block', null, e.d ? 34 : 0);
          burst(to, ['#73eff7', '#f4f4f4', '#94b0c2'], 10, 0.9);
        }
        if (e.d) {
          audio.hit(big);
          slashAt(e.to);
          shake(e.to);
          lose(e.to, e.d);
          const tags = list(e.tags);
          floatAt(e.to, `-${e.d}${tags.includes('crit') ? ' 치명타!' : ''}`, big || tags.includes('crit') ? 'hit big' : 'hit');
          burst(to, ['#b13e53', '#ef7d57'], big ? 24 : 12, big ? 1.4 : 1);
          if (big) replay(field, 'punch');
          if (e.to === me || big) replay(box, 'shaking');
        }
        if (e.sm) floatAt(e.by, '기습!', 'smoke', null, 30);
        if (e.st) later(260, () => { // 갈고리: 손패 한 장이 넘어간다
          streak(seatPt(e.to), seatPt(e.by), 0, '#ffcd75');
          floatAt(e.to, '손패 1장 뺏김!', 'calm', 'c_hook', -34);
        });
        if (e.bounty) later(500, () => floatAt(e.by, '폭군 사냥! 현상금', 'relic t3', 'crown'));
        undying(e, e.to);
        fall(e, e.to);
        paintSeats();
      });
      return;
    }
    if (e.k === 'reflect') {
      audio.swing();
      streak(from, to);
      streak(to, from, 150, '#73eff7');
      later(170, () => {
        audio.reflect();
        floatAt(e.to, '반사!', 'block', 'c_mirror');
      });
      later(320, () => {
        audio.hit(e.d >= 12);
        slashAt(e.by);
        shake(e.by);
        lose(e.by, e.d);
        floatAt(e.by, `-${e.d}`, 'hit big');
        undying(e, e.by);
        fall({ ...e, by: e.to }, e.by);
        paintSeats();
      });
      return;
    }
    if (e.k === 'dodge') {
      audio.swing();
      streak(from, to);
      later(150, () => {
        audio.dodge();
        floatAt(e.to, '회피!', 'block', 'c_dodge');
      });
      return;
    }
    if (e.k === 'thorn') {
      streak(from, to, 0, '#a7f070');
      later(120, () => {
        audio.hit(false);
        shake(e.to);
        lose(e.to, e.d);
        floatAt(e.to, `-${e.d} 가시`, 'hit');
        fall(e, e.to);
        paintSeats();
      });
      return;
    }
    if (e.k === 'bleed') {
      audio.bleed();
      shake(e.to);
      lose(e.to, e.d);
      floatAt(e.to, `-${e.d} 출혈`, 'hit', 'st_bleed');
      fall(e, e.to);
      return paintSeats();
    }
    audio.cancel();
    if (e.k === 'cancel') floatAt(e.by, '쓰러져서 공격 취소', 'calm');
    else if (e.k === 'whiff') floatAt(e.by, '헛스윙', 'calm');
    else if (e.k === 'miss') floatAt(e.by, '빗나감!', 'calm');
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
    S.order.forEach((id, i) => { // 둥글게 선다: 나는 항상 아래
      const p = who(id);
      const a = Math.PI / 2 + ((i - mine) * 2 * Math.PI) / n;
      const x = 50 + 40 * Math.cos(a);
      const y = 58 + 30 * Math.sin(a);
      const badge = h('span', { class: 'ar-badge' });
      const face = h('div', { class: 'ar-face' }, avatar(p, 'lg'), spr('crown', 'ar-crown'), spr('mark', 'ar-mark'), spr('skull', 'ar-skull'), badge);
      const furyFill = h('i');
      const hpFill = h('i');
      const hpNum = h('b');
      const lives = h('div', { class: 'ar-lives' });
      const meta = h('div', { class: 'ar-meta' });
      const relics = h('div', { class: 'ar-relics' });
      const tags = h('div', { class: 'ar-tags' });
      const el = h('div', { class: 'ar-seat', style: `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%` },
        face, h('div', { class: 'ar-info' }, h('span', { class: 'ar-name' }, p.name), h('div', { class: 'ar-hp' }, hpFill, hpNum), h('div', { class: 'ar-fury' }, furyFill),
          h('div', { class: 'ar-row' }, lives, meta), relics), tags);
      field.append(el);
      seats.set(id, { el, face, hpFill, hpNum, furyFill, lives, meta, relics, tags, badge, x, y, key: '' });
    });
  }

  function paintSeats() {
    const open = S.phase === 'reveal' || S.phase === 'defend' || S.phase === 'resolve';
    for (const [id, s] of seats) {
      const up = standing(id);
      const hp = hpOf(id);
      const lv = livesOf(id);
      const a = open ? atkOf(id) : null;
      const st = S.status?.[id] || {};
      const ready = S.phase === 'attack' ? !!S.ready?.[id] || (id === me && local.ready)
        : S.phase === 'defend' ? !!S.ready2?.[id] || (id === me && local.ready2)
          : S.phase === 'pick' && !S.pick?.shown ? !!S.pick?.done?.[id] || (id === me && sent.pick === S.pick?.no) : false;
      const tags = [];
      if (up && hp <= 0) tags.push(['쓰러짐', null]);
      if (up && st.bleed?.n) tags.push([`출혈 ${st.bleed.n}`, 'st_bleed']);
      if (up && isVuln(S, id)) tags.push(['취약', 'st_vuln']);
      if (up && isWeak(S, id)) tags.push(['약화', 'st_weak']);
      if (up && isStun(S, id)) tags.push(['기절', 'st_stun']);
      if (up && S.revenge?.[id] && alive(S.revenge[id])) tags.push([`복수→${nameOf(S.revenge[id])}`, 'revenge']);
      if (a?.smoke && S.phase !== 'resolve') tags.push(['연막', null]);
      const ult = S.ults?.[id];
      const cast = up && S.charge?.[id] ? S.charge[id].k : null;
      if (cast) tags.unshift([`${ULTS[cast]?.name || '필살기'} 준비!`, null]);
      if (up && isFort(S, id)) tags.push(['철옹성', null]);
      if (up && S.beast?.t === id && S.phase !== 'resolve') tags.push(['야수의 표적', null]);
      const fury = up ? furyOf(S, id) : 0;
      const cls = ['ar-seat', id === me && 'me', !up && 'dead', up && hp <= 0 && 'down',
        S.phase === 'attack' && local.t === id && alive(me) && 'aimed', ready && 'ready',
        open && S.phase !== 'resolve' && a?.t === me && id !== me && 'foe',
        hp > 0 && hp <= HP_MAX * 0.3 && 'low', cast && 'charging', up && S.tyrant === id && 'tyrant', fury >= FURY_MAX && 'full'].filter(Boolean).join(' ');
      const left = open && up ? S.left?.[id] : null;
      const n = S.cards?.[id] || 0;
      const relics = relicsOf(S, id).filter(r => RELICS[r]);
      const order = open && a && (a.t || a.smoke) ? a.n : 0;
      const key = [cls, hp, lv, left, n, relics.join(), order, JSON.stringify(tags), fury, ult].join('|');
      if (key === s.key) continue;
      s.key = key;
      s.el.className = cls;
      s.hpFill.style.width = `${Math.max(0, Math.min(100, (hp / HP_MAX) * 100))}%`;
      s.hpNum.textContent = up ? String(hp) : '';
      s.furyFill.style.width = `${(fury / FURY_MAX) * 100}%`;
      const maxL = Math.max(2, lv);
      s.lives.replaceChildren(...(up ? Array.from({ length: maxL }, (_, i) => spr(i < lv ? 'life' : 'life_off', '', 2)) : []));
      s.meta.replaceChildren(...(!up ? [] : [
        ...(left == null ? [] : Array.from({ length: Math.max(left, 0) }, () => spr('en', '', 2))),
        left === 0 ? h('span', { class: 'ar-bare' }, '맨몸') : null,
        spr('cardback', '', 2), h('span', { class: 'ar-n' }, `${n}`),
      ].filter(Boolean)));
      const ultImg = up && ULTS[ult] ? spr(`u_${ult}`, 'ar-relic ult', 2) : null;
      if (ultImg) ultImg.title = `필살기 ${ULTS[ult].name}: ${ULTS[ult].tip}`;
      s.relics.replaceChildren(...[ultImg, ...relics.map(r => {
        const img = spr(`r_${r}`, `ar-relic t${RELICS[r].tier}`, 2);
        img.title = `${RELICS[r].name}: ${RELICS[r].tip}`;
        return img;
      })].filter(Boolean));
      s.tags.replaceChildren(...tags.map(([t, icon]) => h('span', {}, icon ? spr(icon, '', 2) : null, t)));
      s.badge.textContent = order ? String(order) : '';
    }
  }

  function paintBeast() {
    const B = shown ? shown.beast : S.beast;
    beastEl.classList.toggle('on', !!B);
    field.classList.toggle('beasty', !!B); // 야수가 있으면 가운데 글자를 아래로 내린다
    if (!B) return;
    beastFill.style.width = `${Math.max(0, (B.hp / B.max) * 100)}%`;
    beastNum.textContent = String(B.hp);
    const prey = S.beast?.t;
    beastTag.textContent = S.phase === 'resolve' || !prey ? '야수' : prey === me ? '야수 → 나!' : `야수 → ${nameOf(prey)}`;
    beastTag.classList.toggle('me', prey === me && S.phase !== 'resolve');
    beastEl.classList.toggle('aimed', S.phase === 'attack' && local.t === BEAST && alive(me));
  }

  // 공개된 공격 중 나를 노린 것
  const onMe = () => Object.entries(S.atk || {}).filter(([, a]) => a.t === me).map(([id, a]) => ({ id, ...a })).sort((a, b) => b.dmg - a.dmg);
  // 지금 고른 방어로 막고 나면 얼마나 맞나 (보이는 공격만 어림)
  function afterDefense() {
    const inc = onMe();
    const defs = local.def.map(u => CARDS[cardOf(u)?.k]).filter(Boolean);
    const rest = [...inc];
    for (const d of defs) if ((d.reflect || d.dodge || d.redirect) && rest.length) rest.shift();
    let block = S.carry?.[me] || 0;
    for (const d of defs) if (d.block) block += d.block + (has(S, me, 'padded') ? 2 : 0) + (has(S, me, 'guard') ? 3 : 0);
    if (has(S, me, 'cloak') && !S.attacked?.[me]) block += 6;
    let taken = 0;
    for (const a of rest.sort((x, y) => x.n - y.n)) {
      const use = Math.min(a.dmg, a.fx?.pierce ? Math.floor(block / 2) : block);
      block -= use;
      taken += a.dmg - use;
    }
    if (taken > 0 && has(S, me, 'callus')) taken = Math.max(0, taken - 3);
    const bite = biteOnMe();
    if (bite) taken += Math.min(Math.max(0, bite - block), Math.max(0, hpOf(me) - 1 - taken)); // 야수는 체력 1은 남긴다
    return taken;
  }

  function paintCenter() {
    const open = S.phase === 'reveal' || S.phase === 'defend';
    // 화살표 옆 피해 숫자
    const lkey = open ? JSON.stringify(S.atk) : '';
    if (lkey !== keys.labels) {
      keys.labels = lkey;
      const els = [];
      if (open) {
        for (const [id, a] of Object.entries(S.atk || {})) {
          const from = seats.get(id);
          const to = spot(a.t);
          if (!a.t || !from || !to) continue;
          const k = 0.62;
          const tags = list(a.tags);
          const text = tags.includes('miss') ? '빗나감' : `${a.dmg}${tags.includes('crit') ? '!!' : ''}`;
          els.push(h('div', {
            class: `ar-dmg${a.t === me ? ' onme' : id === me ? ' mine' : ''}${tags.includes('crowd') ? ' crowd' : ''}`,
            style: `left:${(from.x + (to.x - from.x) * k).toFixed(2)}%;top:${(from.y + (to.y - from.y) * k).toFixed(2)}%`,
          }, text, tags.includes('crowd') ? h('small', {}, '몰림 ½') : null));
        }
      }
      labels.replaceChildren(...els);
    }
    // 가운데 한 줄: 몇 턴 · 무슨 단계
    const phase = { attack: '공격 단계', reveal: '공개', defend: '방어 단계', resolve: '결과', pick: S.pick?.no === 0 ? '전투 스타일 고르기' : '유물 고르기', loot: '약탈' }[S.phase] || '';
    sub.textContent = S.round ? `${S.round}턴 · ${phase}${S.duel ? ' · 결투' : ''}` : phase;
    // 나에게 오는 공격
    let ikey = '';
    let els = [];
    if (open && alive(me)) {
      const inc = onMe();
      const bite = biteOnMe();
      const total = inc.reduce((a, b) => a + (b.dmg || 0), 0) + bite;
      const smoke = Object.entries(S.atk || {}).some(([id, a]) => a.smoke && id !== me);
      const after = S.phase === 'defend' && local.def.length ? afterDefense() : null;
      ikey = JSON.stringify([inc.map(a => [a.id, a.dmg]), smoke, after, S.phase, bite]);
      if (inc.length || bite) {
        els = [
          h('div', { class: 'ar-inc-big' }, `나에게 ${total}`),
          h('div', { class: 'ar-inc-who' }, [...inc.map(a => `${nameOf(a.id)} ${a.dmg}`), bite ? `야수 ${bite}` : null].filter(Boolean).join(' · ') + (smoke ? ' · 연막 ?' : '')),
          after != null ? h('div', { class: 'ar-inc-after' }, after > 0 ? `막고 나면 ${after}` : '다 막는다!') : null,
        ];
      } else els = [h('div', { class: `ar-inc-none${smoke ? ' warn' : ''}` }, smoke ? '연막 속에서 누가 노릴지도…' : '아무도 나를 안 노렸다')];
    }
    if (ikey !== keys.incoming) {
      keys.incoming = ikey;
      incoming.replaceChildren(...els.filter(Boolean));
    }
    const hot = open && alive(me) && (onMe().length > 0 || biteOnMe() > 0);
    field.classList.toggle('danger', hot);
    field.classList.toggle('duel', !!S.duel);
    field.classList.toggle('lowme', alive(me) && hpOf(me) > 0 && hpOf(me) <= HP_MAX * 0.3);
    field.classList.toggle('rage', rageOf(S.round || 0) > 1);
  }

  function promptOf(mode) {
    if (hint && performance.now() < hint.until) return [hint.text, hint.cls];
    if (!inGame()) return ['관전 중', 'calm'];
    if (S.phase === 'intro') return [S.again ? '한 판 더!' : '몰래 겨누고, 한꺼번에 공개, 남은 기력으로 막아라', ''];
    if (!alive(me)) return ['탈락! 채팅(Enter)으로 훈수 두기', 'calm'];
    if (S.phase === 'pick') {
      if (S.pick?.shown) return [S.pick.kind === 'ult' ? '필살기 공개! 맞거나 때리면 투지가 차요' : '유물 공개! 자리 옆 그림에 마우스를 올리면 설명이 보여요', 'hint'];
      if (mode === 'pick') return [S.pick.kind === 'ult' ? '필살기를 고르세요: 숫자키 1~3 (투지가 가득 차면 R)' : S.pick.no === 0 ? '전투 스타일을 고르세요: 숫자키 1~3 (모두 동시에)' : '유물을 고르세요: 숫자키 1~3 (모두 동시에)', 'mine'];
      return ['골랐어요! 다른 사람을 기다리는 중…', 'calm'];
    }
    if (S.phase === 'attack') {
      if (mode !== 'attack') return ['준비 완료! 다른 사람을 기다리는 중…', 'calm'];
      const armed = loadedKeys().some(k => CARDS[k].type === 'w');
      if (local.u) return [`${ULTS[S.ults[me]].name} 준비! 이번 턴엔 공격 못 해요 · 스페이스 = 준비 (R = 취소)`, 'warn'];
      if (charging(S, me)) {
        const U = ULTS[S.charge[me].k];
        return [U.aim ? `${U.name}: ${local.t && local.t !== BEAST ? `${nameOf(local.t)}에게` : '← → 로 겨눈 사람에게'} 이번 턴 끝에 터져요 (${BREAK} 넘게 맞으면 끊김)` : `${U.name}이 이번 턴 끝에 터져요! ${BREAK} 넘게 맞으면 끊겨요`, 'warn'];
      }
      if (canCast() && !local.t && !armed) return ['투지 가득! R = 필살기 준비 · ← → 겨누기 · 숫자키 = 장전', 'mine'];
      if (!local.t) return [armed ? '← → 로 겨눌 사람을 고르세요' : '← → 겨누기 · 숫자키 = 장전 · 스페이스 = 준비 (먼저 누르면 먼저 때려요)', 'mine'];
      if (!armed) return [`${nameOf(local.t)} 겨눔 · 숫자키로 무기를 장전하세요 (↓ = 안 겨눔)`, 'mine'];
      return [`${nameOf(local.t)}에게 · 스페이스 = 준비 (먼저 누르면 먼저 때려요)`, 'mine'];
    }
    if (S.phase === 'reveal') return ['공개! 누가 누굴 노렸나', 'warn'];
    if (S.phase === 'defend') {
      if (mode !== 'defend') return ['결과를 기다리는 중…', 'calm'];
      return onMe().length || biteOnMe() ? ['막아라! 숫자키 = 방어 카드 · 스페이스 = 이대로', 'warn'] : ['숫자키 = 도구 · 스페이스 = 넘어가기', 'mine'];
    }
    if (S.phase === 'resolve') return ['준비한 순서대로 들어갑니다', 'calm'];
    if (S.phase === 'loot') {
      const it = myLoot();
      if (mode === 'loot' && it) return [it.from === BEAST ? '야수의 전리품! 유물 하나: 숫자키' : it.from === '@bounty' ? '폭군의 현상금! 유물 하나: 숫자키' : `약탈! ${nameOf(it.from)}의 유물 하나: 숫자키`, 'mine'];
      const by = list(S.loot).filter(x => !x.got).map(x => nameOf(x.by));
      return [by.length ? `${by.join(', ')} 약탈 중…` : '…', 'calm'];
    }
    return ['', ''];
  }

  const relicCard = (r, i, state) => h('button', {
    class: `ar-card relic ${RELICS[r] ? `t${RELICS[r].tier}` : 'ult'} ${state}`, type: 'button', tabindex: '-1',
    onClick: e => {
      e.currentTarget.blur();
      toggleCard(i);
    },
  },
  h('span', { class: 'ar-key' }, String(i + 1)), spr(iconOf(r)),
  h('span', { class: 'ar-cname' }, info(r).name), h('span', { class: 'ar-ctip' }, info(r).tip),
  h('span', { class: 'ar-tier' }, RELICS[r] ? TIERS[RELICS[r].tier] : '필살기'));

  function paintPanel() {
    if (!S) return;
    const mode = modeOf();
    const hand = myHand();
    const [text, cls] = promptOf(mode);
    const offers = S.phase === 'pick' && S.pick && !S.pick.shown && alive(me) ? list(S.pick.offers?.[me]) : null;
    const lootIt = S.phase === 'loot' ? myLoot() : null;
    const bag = S.phase === 'defend' ? local.def : local.load;
    const energy = alive(me) && (S.phase === 'attack' || S.phase === 'defend') ? energyNow() : null;
    const est = S.phase === 'attack' && local.t ? attackOf(S, me, local.t, loadedKeys()) : null;
    // 다음에 카드를 받으면 넘쳐서 버려질 카드 (가장 오래 든 것부터)
    const keep = hand.filter(c => !local.load.includes(c.u) && !local.def.includes(c.u));
    const over = Math.max(0, keep.length + DRAW - HAND_MAX);
    const drop = keep.slice(0, over).map(c => c.u);
    const fury = alive(me) ? furyOf(S, me) : 0;
    const key = JSON.stringify([mode, hand, bag, offers, lootIt, energy, est?.dmg, text, cls, local.picked, drop, S.phase, local.t, fury, S.ults?.[me], local.u, S.charge?.[me]]);
    if (key !== keys.panel) {
      keys.panel = key;
      prompt.className = `ar-prompt ${cls}`;
      prompt.textContent = text;
      let cards = [];
      if (offers) cards = offers.map((r, i) => relicCard(r, i, mode === 'pick' ? 'can' : r === local.picked ? 'on' : 'dim'));
      else if (lootIt) cards = list(lootIt.opts).map((r, i) => relicCard(r, i, mode === 'loot' ? 'can' : 'dim'));
      else {
        cards = hand.map((c, i) => {
          const def = CARDS[c.k] || { name: c.k, cost: 0, type: 't' };
          const on = bag.includes(c.u);
          const can = !on && mode && fits(def, mode) && def.cost <= (energy ?? 0) && !(local.u && def.type === 'w' && mode === 'attack');
          return h('button', {
            class: `ar-card t-${def.type}${on ? ' on' : can ? ' can' : ' dim'}${def.rare ? ' rare' : ''}${drop.includes(c.u) ? ' drop' : ''}`,
            type: 'button', tabindex: '-1', title: def.tip,
            onClick: e => {
              e.currentTarget.blur(); // 스페이스가 이 버튼을 다시 누르지 않게
              toggleCard(i);
            },
          },
          h('span', { class: 'ar-key' }, String(i + 1)), spr(`c_${c.k}`),
          h('span', { class: 'ar-cname' }, def.name),
          h('span', { class: 'ar-cstat' }, shortOf(def)),
          h('span', { class: 'ar-cost' }, def.cost ? Array.from({ length: def.cost }, () => spr('en', '', 2)) : '공짜'),
          drop.includes(c.u) ? h('span', { class: 'ar-drop' }, '곧 버려짐') : null);
        });
      }
      const idle = !inGame() ? '관전 중' : alive(me) ? '손패 없음' : '탈락';
      handEl.replaceChildren(...(cards.length ? cards : [h('span', { class: 'ar-empty' }, idle)]));
      // 기력 구슬 · 어림 피해
      const bits = [];
      if (energy != null) {
        bits.push(h('span', { class: 'ar-en' }, '기력', ...Array.from({ length: Math.max(energy, 0) }, () => spr('en')), energy <= 0 ? h('em', {}, '0') : null));
        if (est && !local.u) bits.push(h('span', { class: 'ar-est' }, `${nameOf(local.t)}에게 약 ${est.dmg}`));
        const tip = bag.length ? CARDS[cardOf(bag[bag.length - 1])?.k] : null;
        if (tip) bits.push(h('span', { class: 'ar-tip' }, `${tip.name}: ${tip.tip}`));
      }
      const myUlt = alive(me) ? ULTS[S.ults?.[me]] : null;
      if (myUlt) { // 투지 막대 · 필살기
        const state = S.charge?.[me] ? '준비 중' : local.u ? '준비!' : fury >= FURY_MAX ? 'R = 준비' : `${fury}/${FURY_MAX}`;
        bits.push(h('span', { class: `ar-myult${fury >= FURY_MAX ? ' full' : ''}${local.u || S.charge?.[me] ? ' on' : ''}`, title: myUlt.tip },
          spr(`u_${S.ults[me]}`, '', 2), myUlt.name, h('span', { class: 'ar-furybar' }, h('i', { style: `width:${(fury / FURY_MAX) * 100}%` })), state));
      }
      stat.replaceChildren(...bits);
    }
    let tKey = '';
    let make = null;
    if (S.phase === 'pick' && S.pick && !S.pick.shown) {
      tKey = `p${S.pick.no}`;
      make = () => countdown(S.phaseEndsAt, PICK_TIME);
    } else if (S.phase === 'attack') {
      tKey = `a${S.round}`;
      make = () => countdown(S.phaseEndsAt, ATTACK_TIME);
    } else if (S.phase === 'defend') {
      tKey = `d${S.round}`;
      make = () => countdown(S.phaseEndsAt, DEFEND_TIME);
    } else if (S.phase === 'loot') {
      tKey = `l${S.round}`;
      make = () => countdown(S.phaseEndsAt, LOOT_TIME);
    }
    if (tKey !== keys.timer) {
      keys.timer = tKey;
      timer.replaceChildren(...(make ? [make()] : []));
    }
  }

  function paintHead() {
    const rage = rageOf(S.round || 0);
    const left = S.round ? `${S.round}턴 · 생존 ${S.alive.length}명${S.duel ? ' · ⚔️ 결투' : ''}${rage > 1 ? ` · 🔥 피의 함성 ×${rage}` : ''}` : '곧 시작해요';
    const right = alive(me) ? `❤️ ${S.hp?.[me] || 0} · 목숨 ${S.lives?.[me] || 0} · 🃏 ${S.cards?.[me] || 0}장` : inGame() ? '💀 구경 중' : '👀 관전 중';
    if (keys.head === left + right) return;
    keys.head = left + right;
    head.replaceChildren(h('span', {}, left), h('span', {}, right));
  }

  function paintSide() {
    const out = Object.entries(S.outAt || {}).sort((a, b) => a[1] - b[1]).map(([id]) => id);
    const log = list(S.log);
    const key = JSON.stringify([S.alive, out, log, S.relics, S.round >= 1, !!S.ultsGiven, !!S.beast]);
    if (key === keys.side) return;
    keys.side = key;
    const owners = S.order.filter(id => relicsOf(S, id).length);
    const inPlay = [...new Set(owners.flatMap(id => relicsOf(S, id)))].filter(r => RELICS[r]);
    const next = RAGE.map(([r, m]) => `${r}턴부터 ×${m}`).reverse().join(' · ');
    side.replaceChildren(...[
      h('h3', {}, `생존 ${S.alive.length}명`),
      h('div', { class: 'tc-alive' }, S.alive.map(id => h('span', { class: 'tc-alive-chip' }, avatar(who(id)), who(id).name))),
      out.length ? h('h3', {}, '탈락 기록') : null,
      out.length ? h('ul', { class: 'rules' }, out.map(id => {
        const by = S.dead?.[id];
        return h('li', {}, h('b', {}, who(id).name), by && by !== '-' ? ` ← ${who(by).name}` : '');
      })) : null,
      log.length ? h('h3', {}, '방금') : null,
      log.length ? h('ol', { class: 'ar-log' }, log.map(t => h('li', {}, t))) : null,
      owners.length ? h('h3', {}, '유물') : null,
      owners.length ? h('ul', { class: 'ar-owners' }, owners.map(id => h('li', {}, h('b', {}, who(id).name),
        ...relicsOf(S, id).filter(r => RELICS[r]).map(r => h('span', { class: `t${RELICS[r].tier}` }, RELICS[r].name))))) : null,
      inPlay.length ? h('ul', { class: 'ar-cardlist' }, inPlay.map(r => h('li', {},
        spr(`r_${r}`, '', 2), h('span', {}, h('b', {}, RELICS[r].name), ` ${RELICS[r].tip}`)))) : null,
      S.ultsGiven || S.beast ? h('h3', {}, '필살기 · 야수 · 폭군') : null,
      S.ultsGiven || S.beast ? h('ul', { class: 'rules' },
        h('li', {}, h('b', {}, '필살기'), ` 때리거나 맞으면 투지가 차요(금빛 막대). 가득 차면 R로 준비 → 그 턴엔 공격 못 하고, 다음 턴 끝에 터져요. 그 턴에 ${BREAK} 넘게 맞으면 끊겨요`),
        h('li', {}, h('b', {}, '야수'), ` ${BEAST_FIRST}턴부터. ↑ 로 겨눠요. 막타는 전설 유물, 제일 많이 깎은 사람은 희귀 유물. 야수는 체력 1은 남겨요`),
        h('li', {}, h('b', {}, '폭군'), ' 제일 많이 쓰러뜨린 사람(왕관). 쓰러뜨리면 현상금으로 유물 하나')) : null,
      S.ultsGiven ? h('ul', { class: 'ar-cardlist' }, Object.entries(ULTS).map(([k, u]) => h('li', {},
        spr(`u_${k}`, '', 2), h('span', {}, h('b', {}, u.name), ` ${u.tip}`)))) : null,
      h('h3', {}, '한 턴'),
      h('ul', { class: 'rules' },
        h('li', {}, h('b', {}, '공격 단계'), ' 모두 동시에, 몰래 한 명을 겨누고 무기를 장전해요'),
        h('li', {}, h('b', {}, '공개'), ' 화살표가 한꺼번에 떠요'),
        h('li', {}, h('b', {}, '방어 단계'), ' 공격에 쓰고 남은 기력으로 막아요'),
        h('li', {}, h('b', {}, '결과'), ' 준비 완료를 누른 순서대로 들어가요. 먼저 쓰러진 사람의 공격은 안 나가요')),
      h('h3', {}, '조작'),
      h('ul', { class: 'rules' },
        h('li', {}, '← → = 겨누기 (↑ 맞은편, ↓ 안 겨눔)'),
        h('li', {}, '숫자키 = 카드 넣기/빼기 · Backspace = 다 빼기 · R = 필살기 준비'),
        h('li', {}, '스페이스 = 준비 완료 (되돌릴 수 없어요)')),
      h('h3', {}, '규칙'),
      h('ul', { class: 'rules' },
        h('li', {}, '기력 3을 공격과 방어에 나눠 써요. 다 쏟아부으면 맨몸'),
        h('li', {}, `한 명에게 ${CROWD}명 이상 몰리면 전부 절반 피해`),
        h('li', {}, '목숨 2개: 처음 쓰러지면 다음 턴에 일어나고, 쓰러뜨린 사람에게 복수 표식(피해 +25%)'),
        h('li', {}, `유물: 시작할 때와 ${PICK_EVERY}턴마다 3개 중 하나. 탈락시키면 그 사람 유물을 하나 뺏어요`),
        h('li', {}, `카드는 턴마다 ${DRAW}장. ${HAND_MAX}장을 넘으면 오래 든 카드부터 버려져요`),
        h('li', {}, '카드를 한 장도 안 낸 턴엔 숨 고르기: 카드 1장 더, 체력 +2'),
        h('li', {}, `피의 함성: ${next} (모든 피해)`),
        h('li', {}, '둘만 남으면 결투: 기력 4, 피해 1.5배'),
        h('li', {}, '마지막 1명 우승')),
      h('h3', {}, '카드'),
      h('ul', { class: 'ar-cardlist' }, Object.entries(CARDS).map(([k, c]) => h('li', {},
        spr(`c_${k}`, '', 2), h('span', {}, h('b', {}, c.name), ` (${c.cost}) ${c.tip}${c.type === 'd' ? ' · 방어 단계' : ''}`)))),
    ].filter(Boolean));
  }

  function paint() {
    if (!S) return;
    paintHead();
    paintSeats();
    paintBeast();
    paintCenter();
    paintPanel();
    paintSide();
  }

  return {
    update({ state, priv }) {
      S = state;
      P = priv || null;
      S.alive = list(S.alive);
      S.order = list(S.order);
      layoutSeats();
      if (local.round !== (S.round || 0)) local = { round: S.round || 0, t: null, load: [], ready: false, def: [], ready2: false, u: false, picked: local.picked };
      if (local.t && (local.t === BEAST ? !S.beast : !alive(local.t))) local.t = null;
      if (!seen) {
        seen = {
          pick: S.phase === 'pick' ? -1 : S.pick?.no ?? -1, picked: S.pick?.shown ? S.pick.no : -1,
          round: S.phase === 'attack' ? -1 : S.round || 0, reveal: S.phase === 'reveal' ? -1 : S.round || 0,
          rs: S.rsNo || 0, final: false, duel: !!S.duel && S.phase !== 'attack',
        };
        if (S.phase === 'intro') setBanner('투기장', 'gold');
      }
      if (S.phase === 'pick' && S.pick && S.pick.no !== seen.pick) {
        seen.pick = S.pick.no;
        local.picked = null;
        onPick();
      }
      if (S.pick?.shown && S.pick.no !== seen.picked) {
        seen.picked = S.pick.no;
        onPicked();
      }
      if (S.phase === 'attack' && S.round !== seen.round) {
        seen.round = S.round;
        hint = null;
        onRound();
      }
      if (S.phase === 'reveal' && S.round !== seen.reveal) {
        seen.reveal = S.round;
        hint = null;
        onReveal();
      }
      if (S.phase === 'defend' && seen.defend !== S.round) {
        seen.defend = S.round;
        defendAt = performance.now();
        if (onMe().length && alive(me)) setBanner('막아라!', 'blood', 1100);
      }
      if (S.phase === 'resolve' && (S.rsNo || 0) !== seen.rs) {
        seen.rs = S.rsNo || 0;
        onResolve();
      }
      if (S.phase !== 'resolve') { // 결과 연출이 끝났다: 방장이 알려 준 값 그대로
        shown = null;
        prev = { hp: { ...(S.hp || {}) }, lives: { ...(S.lives || {}) }, alive: [...S.alive], beast: S.beast ? { hp: S.beast.hp, max: S.beast.max } : null };
      }
      audio.heart(!S.over && alive(me) && ((S.phase === 'defend' && (onMe().length > 0 || biteOnMe() > 0)) || (S.phase === 'attack' && (!!S.duel || S.alive.some(id => charging(S, id))))));
      box.classList.toggle('final', S.phase === 'final');
      if (S.phase === 'final' && !seen.final) {
        seen.final = true;
        if (S.winner === me) audio.win();
        board.replaceChildren(h('div', { class: 'rx-result' },
          h('h2', { class: 'display' }, S.winner ? `🏟️ ${josa(nameOf(S.winner), '이', '가')} 최후의 검투사!` : '🏟️ 끝!'),
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
