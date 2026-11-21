// 주사위 대장간 화면 — 주사위 · 숫자 · 승률 막대 · 소리만 쓴다. 사람 · 배경 · 카메라 연출은 없다.
// 값은 forge-core.js 가 정하고, 여기는 대결 기록(duel)을 박자대로 틀기만 한다. 보여 주는 순서만 바꾸고 값은 안 건드린다.
import { h } from '../util.js';
import { dieFace, dieTumble, shard, DIE_SIZE, PX } from './dice-art.js';
import { RULE, AUGS, GAMBLES, WEAPONS, TECHS, TASTE, DICE, WEAPON_KEYS, diceTextOf, sidesOf, labelOf, other, stakeMultOf } from './forge-core.js';

const SILENT = new Proxy({}, { get: () => () => {} });
const SIDES = ['a', 'b'];
const pct = p => `${Math.round(p * 100)}%`;
const tagOf = faces => (faces && faces.length > 1 ? faces.slice(1).map(f => `+${f}`).join('') : '');
function restart(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// embed = 로비 게임 화면 안에 넣을 때 (칸 너비 · 창 높이에 맞춰 줄인다). 아니면 시제품처럼 창 전체
export function createForgeView(root, { audio = SILENT, embed = false } = {}) {
  // ───────── 틀: 위(모두의 자리) · 가운데(대결) + 옆(다른 대결) · 아래(할 일)
  const topEl = h('header', { class: 'fg-top' });
  const arena = h('section', { class: 'fg-arena' });
  const othersEl = h('aside', { class: 'fg-others' });
  const bottom = h('footer', { class: 'fg-bottom' });
  const flashEl = h('div', { class: 'fg-flash' });
  const toastEl = h('div', { class: 'fg-toast' });
  const appEl = h('div', { class: 'fg-app' }, topEl, h('main', { class: 'fg-main' }, arena, othersEl), bottom);
  const hostEl = h('div', { class: `fg-host${embed ? ' embed' : ''}` }, appEl, flashEl, toastEl);
  root.append(hostEl);
  // 1280×760 기준. 창(로비 안이면 게임 칸)이 그보다 작으면 통째로 줄인다 (좁은 창에서 글이 겹치지 않게)
  const BASE_W = 1280;
  const BASE_H = 760;
  function fit() {
    if (embed) {
      const w = hostEl.clientWidth || BASE_W;
      const s = Math.min(1, w / BASE_W, Math.max(420, window.innerHeight - 96) / BASE_H);
      appEl.classList.add('scaled');
      appEl.style.transform = `scale(${s})`;
      appEl.style.left = `${Math.max(0, Math.round((w - BASE_W * s) / 2))}px`;
      hostEl.style.height = `${Math.round(BASE_H * s)}px`;
      return;
    }
    const s = Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H);
    appEl.classList.toggle('scaled', s < 1);
    appEl.style.transform = s < 1 ? `scale(${s})` : '';
  }
  window.addEventListener('resize', fit);
  fit();

  // ───────── 대결 무대 (상점 미리 보기에도 같은 무대를 쓴다)
  function makeSide(s) {
    const o = { s, views: new Map(), g: null };
    o.root = h('div', { class: `fg-side fg-${s}` });
    o.name = h('div', { class: 'fg-name' });
    o.tech = h('div', { class: 'fg-tech' });
    o.augs = h('div', { class: 'fg-augs' });
    o.dice = h('div', { class: 'fg-dice' });
    o.gslot = h('div', { class: 'fg-gslot' });
    o.power = h('div', { class: 'fg-power' });
    o.total = h('div', { class: 'fg-total' });
    o.note = h('div', { class: 'fg-note' });
    o.root.append(o.name, o.tech, o.augs, h('div', { class: 'fg-row' }, o.dice, o.gslot), o.power, o.total, o.note);
    return o;
  }
  const SA = makeSide('a');
  const SB = makeSide('b');
  const sideOf = s => (s === 'a' ? SA : SB);
  const roundEl = h('div', { class: 'fg-roundno' });
  const stakeEl = h('div', { class: 'fg-stake' });
  const callEl = h('div', { class: 'fg-call' });
  const midEl = h('div', { class: 'fg-mid' }, roundEl, h('div', { class: 'fg-vs' }, 'VS'), stakeEl, callEl);
  const barA = h('div', { class: 'fg-bar-a' });
  const barB = h('div', { class: 'fg-bar-b' });
  const barLa = h('span');
  const barMid = h('span', { class: 'fg-bar-mid' });
  const barLb = h('span');
  const barEl = h('div', { class: 'fg-bar' }, h('div', { class: 'fg-bar-track' }, barA, barB), h('div', { class: 'fg-bar-label' }, barLa, barMid, barLb));
  const capEl = h('div', { class: 'fg-caption' });
  const fxEl = h('div', { class: 'fg-fx' });
  const stageEl = h('div', { class: 'fg-stage' }, barEl, h('div', { class: 'fg-duel' }, SA.root, midEl, SB.root), capEl, fxEl);

  // ───────── 박자: 빠르기 · 건너뛰기
  let speed = 1;
  let skipping = false;
  const pending = new Map();
  let pid = 0;
  function wait(ms) {
    if (skipping || ms <= 0) return Promise.resolve();
    return new Promise(res => {
      const id = ++pid;
      const t = setTimeout(() => { pending.delete(id); res(); }, ms / speed);
      pending.set(id, { t, res });
    });
  }
  function skip() {
    skipping = true;
    for (const { t, res } of pending.values()) { clearTimeout(t); res(); }
    pending.clear();
    audio.heart(false);
    audio.duck(false);
    stageEl.classList.remove('tense');
  }
  const sfx = fn => { if (!skipping) { try { fn(audio); } catch { /* 소리가 안 나도 계속 */ } } };

  // ───────── 주사위 그림
  const tumbling = new Set();
  let tick = 0;
  const tumbleTimer = setInterval(() => {
    tick++;
    for (const v of tumbling) {
      if (v.slow && tick % 2) continue;
      v.frame = (v.frame + 1) % 4;
      v.img.src = dieTumble(v.die, v.frame).url;
    }
  }, 70);

  function makeDie(die, powder = false) {
    const [w, hh] = DIE_SIZE[die];
    const img = h('img', { class: 'fg-dimg', alt: '', draggable: 'false', width: w * PX, height: hh * PX });
    const tag = h('span', { class: 'fg-dtag' });
    const el = h('div', { class: `fg-die${powder ? ' powder' : ''}` }, img, tag);
    const v = { el, img, tag, die, frame: Math.floor(Math.random() * 4), slow: false, value: 1, state: 'idle' };
    const sides = DICE[die].sides;
    v.face = (value, state = 'idle', t = '') => {
      tumbling.delete(v);
      el.classList.remove('rolling', 'slow');
      v.value = Math.max(1, Math.min(sides, value));
      v.state = state;
      img.src = dieFace(die, v.value, state).url;
      tag.textContent = t;
      restart(el, 'land');
    };
    v.unknown = () => {
      tumbling.delete(v);
      el.classList.remove('rolling', 'slow', 'land');
      img.src = dieTumble(die, 0).url;
      tag.textContent = '';
    };
    v.roll = (slow = false) => {
      v.slow = slow;
      el.classList.add('rolling');
      el.classList.toggle('slow', slow);
      tag.textContent = '';
      tumbling.add(v);
    };
    v.crack = () => {
      tumbling.delete(v);
      el.classList.remove('rolling', 'slow');
      img.src = dieFace(die, v.value, 'crack').url;
      el.classList.add('cracked');
    };
    v.gone = () => {
      tumbling.delete(v);
      el.classList.remove('rolling', 'slow', 'cracked');
      img.src = dieFace(die, 1, 'ghost').url;
      tag.textContent = '';
      el.classList.add('broken');
    };
    return v;
  }

  function makeGamble(key) {
    const G = GAMBLES[key];
    const val = h('b', { class: 'fg-gval' });
    const el = h('div', { class: 'fg-gdie', title: `${G.name}: ${G.text}` }, h('span', { class: 'fg-gicon' }, G.icon), val);
    const v = { el, key };
    v.setBet = bet => {
      el.classList.remove('rolling', 'slow', 'good', 'bad');
      el.classList.toggle('off', bet === false);
      el.classList.toggle('unknown', bet == null);
      val.textContent = bet === false ? '안 걸음' : bet == null ? '?' : '건다';
    };
    v.roll = (slow = false) => {
      el.classList.remove('good', 'bad', 'off', 'unknown');
      el.classList.add('rolling');
      el.classList.toggle('slow', slow);
      val.textContent = '?';
    };
    v.show = (text, mood = '') => {
      el.classList.remove('rolling', 'slow', 'good', 'bad');
      if (mood) el.classList.add(mood);
      val.textContent = text;
      restart(el, 'land');
    };
    v.rest = () => { el.classList.remove('rolling', 'slow', 'good', 'bad'); val.textContent = '건다'; };
    return v;
  }

  // 조각이 사방으로 튄다 (도트 크기 그대로)
  function shatterAt(v) {
    if (!v) return;
    const r = v.el.getBoundingClientRect();
    const ar = stageEl.getBoundingClientRect();
    const k = ar.width / (stageEl.offsetWidth || ar.width) || 1; // 통째로 줄였을 때
    const cx = (r.left + r.width / 2 - ar.left) / k;
    const cy = (r.top + r.height / 2 - ar.top) / k;
    if (!skipping) {
      for (let i = 0; i < 6; i++) {
        const s = shard(v.die, i);
        const im = h('img', { class: 'fg-shard', src: s.url, alt: '', width: s.w * PX, height: s.h * PX });
        const ang = (i / 6) * Math.PI * 2 + Math.random() * 0.6;
        const dist = 50 + Math.random() * 60;
        im.style.left = `${cx}px`;
        im.style.top = `${cy}px`;
        im.style.setProperty('--dx', `${Math.round(Math.cos(ang) * dist)}px`);
        im.style.setProperty('--dy', `${Math.round(Math.sin(ang) * dist - 30)}px`);
        im.style.setProperty('--rot', `${Math.round((Math.random() * 2 - 1) * 300)}deg`);
        fxEl.append(im);
        setTimeout(() => im.remove(), 900);
      }
    }
    v.gone();
  }

  function floatText(anchor, text, cls = '') {
    if (skipping || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const ar = stageEl.getBoundingClientRect();
    const k = ar.width / (stageEl.offsetWidth || ar.width) || 1;
    const el = h('div', { class: `fg-float ${cls}` }, text);
    el.style.left = `${(r.left + r.width / 2 - ar.left) / k}px`;
    el.style.top = `${(r.top - ar.top) / k}px`;
    fxEl.append(el);
    setTimeout(() => el.remove(), 1000);
  }
  function flash(kind = 'white') {
    if (skipping) return;
    flashEl.className = 'fg-flash';
    void flashEl.offsetWidth;
    flashEl.className = `fg-flash go ${kind}`;
  }
  function shake(el) { if (!skipping) restart(el, 'shake'); }
  function cap(text, cls = '') {
    capEl.textContent = text;
    capEl.className = `fg-caption ${cls}`;
    restart(capEl, 'pop');
  }
  let toastT = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 1400);
  }

  // ───────── 승률 막대 (왼쪽 = a)
  let barP = 0.5;
  function setBar(p, nameA, nameB) {
    if (p == null) { barEl.classList.add('hide'); return; }
    barEl.classList.remove('hide');
    barP = p;
    barA.style.width = `${Math.round(p * 1000) / 10}%`;
    const la = Math.round(p * 100); // 양쪽 합이 늘 100%가 되게
    barLa.textContent = `${nameA} ${la}%`;
    barLb.textContent = `${100 - la}% ${nameB}`;
    barMid.textContent = p >= 0.5 ? `${nameA} ${labelOf(p)}` : `${nameB} ${labelOf(1 - p)}`;
  }

  // ───────── 한쪽 그리기 (기술 · 증강 · 주사위 · 도박 칸)
  const diceOfF = f => f.dice || TECHS[`${f.w}${f.tier}`].dice;
  function techText(f) {
    const t = TECHS[`${f.w}${f.tier}`];
    return `${f.tier}단 ${t.name} ${diceTextOf(diceOfF(f))}${t.tough ? ` · 버팀 ${t.tough}` : ''}`;
  }
  // 합계는 주사위 눈 그대로. 증강으로 더해지는 것만 따로 적는다
  function powerText(f, c = null) {
    const parts = [];
    if (c?.venom) parts.push(`🌀 독기 +${c.venom}`);
    if (c?.first) parts.push(`🎯 선빵 +${c.first}`);
    return parts.join(' · ');
  }
  // f: { name, w, tier, dice, gamble, bet(true · false · null=모름), augs, mom, shadow }
  function setSide(o, f, alive = null) {
    o.root.className = `fg-side fg-${o.s}${f.shadow ? ' shadow' : ''}`;
    o.name.replaceChildren(`${WEAPONS[f.w].icon} ${f.name}`, f.mom > 0 ? h('span', { class: 'fg-mom' }, ' ', '🔥'.repeat(f.mom)) : '');
    o.tech.textContent = techText(f);
    o.augs.replaceChildren(...f.augs.map(k => h('span', { class: `fg-aug t-${AUGS[k].tier}`, title: `${AUGS[k].name}: ${AUGS[k].text}` }, AUGS[k].icon, h('small', null, AUGS[k].name))));
    const dice = diceOfF(f);
    o.dice.replaceChildren();
    o.views.clear();
    for (let slot = 0; slot < dice.length; slot++) {
      const v = makeDie(dice[slot], slot === 0 && f.augs.includes('powder'));
      o.views.set(slot, v);
      o.dice.append(v.el);
      if (alive && !alive.includes(slot)) v.gone();
      else v.unknown();
    }
    o.gslot.replaceChildren();
    o.g = null;
    if (f.gamble) {
      o.g = makeGamble(f.gamble);
      o.gslot.append(o.g.el);
      o.g.setBet(f.bet);
    }
    o.power.textContent = powerText(f);
    o.total.textContent = '';
    o.total.className = 'fg-total';
    o.note.textContent = '';
  }
  const setTotal = (s, v) => { sideOf(s).total.textContent = String(v); };
  function markTotals(run, final = null) {
    for (const s of SIDES) {
      const el = sideOf(s).total;
      el.classList.remove('lead', 'win', 'lose', 'tie');
      if (final === 'tie') el.classList.add('tie');
      else if (final) el.classList.add(final === s ? 'win' : 'lose');
      else if (run[s] > run[other(s)]) el.classList.add('lead');
    }
  }
  const note = (s, text) => { sideOf(s).note.textContent = text; };

  // ───────── 위: 모두의 자리. 번호 = 유령이 저주할 때 누르는 숫자키
  // hide = 강화 중: 남이 이번 라운드에 산 건 공개 전까지 안 보인다 (라운드 시작 때 모습 = snap)
  function top(game, { me = 0, ready = null, target = null, hide = false } = {}) {
    topEl.replaceChildren(...game.players.map((p, i) => {
      const hp = Math.max(0, p.hp);
      const b = hide && p.id !== me && p.snap ? p.snap : p.b;
      const cls = ['fg-chip'];
      if (p.id === me) cls.push('me');
      if (!p.alive) cls.push('dead');
      if (ready?.has(p.id)) cls.push('ready');
      if (target === p.id) cls.push('target');
      if (p.alive && hp <= 12) cls.push('low');
      return h('div', { class: cls.join(' ') },
        h('span', { class: 'fg-chip-no' }, String(i + 1)),
        h('span', { class: 'fg-chip-name' }, p.name),
        p.alive
          ? h('span', { class: 'fg-chip-hp' }, h('i', { style: `width:${Math.round((hp / RULE.HP) * 100)}%` }), h('b', null, String(hp)))
          : h('span', { class: 'fg-chip-ghost' }, `👻 ${p.place}등`),
        b ? h('span', { class: 'fg-chip-w' }, `${WEAPONS[p.w].icon}${b.tier}`) : null,
        p.alive && p.mom > 0 ? h('span', { class: 'fg-chip-mom' }, '🔥'.repeat(p.mom)) : null,
        b?.gamble ? h('span', { class: 'fg-chip-g' }, GAMBLES[b.gamble].icon) : null,
        ready?.has(p.id) ? h('span', { class: 'fg-chip-ok' }, '✓') : null);
    }));
  }

  // ───────── 패널 (제목 · 무기 · 끝)
  function panel(...children) {
    arena.replaceChildren(h('div', { class: 'fg-panel' }, ...children));
  }

  const HELP = ['라운드마다 냥으로 주사위를 강화한다', '무작위 상대와 합을 친다: 둘 다 굴려 진 쪽 주사위가 하나씩 깨진다', '이긴 쪽이 남은 주사위로 추격한 만큼 체력이 깎인다', '체력 40, 끝까지 남은 한 명이 이긴다', '도박 주사위는 라운드마다 G로 건다 · 안 건다'];
  const help = () => othersEl.replaceChildren(h('div', { class: 'fg-others-head' }, '하는 법'), ...HELP.map(t => h('p', { class: 'fg-help' }, t)));

  // 로비 판의 시작 안내 (2초). 한 판 더면 제목과 '곧 시작'만
  function intro({ again = false } = {}) {
    help();
    panel(h('div', { class: 'fg-logo' }, '⚒️ 주사위 대장간'), h('div', { class: again ? 'fg-sub' : 'fg-line' }, again ? '곧 시작' : '강화하고 굴려라. 지면 주사위가 깨진다.'));
    bottom.replaceChildren(h('div', { class: 'fg-hint' }, again ? '' : '라운드마다 냥으로 강화 → 무작위 상대와 합 → 끝까지 남은 한 명'));
  }

  function title({ count }) {
    help();
    panel(
      h('div', { class: 'fg-logo' }, '⚒️ 주사위 대장간'),
      h('div', { class: 'fg-sub' }, '시제품 · 나 + 봇'),
      h('div', { class: 'fg-count' }, h('span', { class: 'fg-key' }, '←'), ` ${count}명 `, h('span', { class: 'fg-key' }, '→')),
      h('div', { class: 'fg-line' }, '강화하고 굴려라. 지면 주사위가 깨진다.'),
      h('div', { class: 'fg-go' }, '스페이스 = 시작'));
    bottom.replaceChildren(h('div', { class: 'fg-hint' }, 'F 빠르게 · M 소리 · A 나도 봇 (자동)'));
    topEl.replaceChildren();
  }

  function weapon({ left, total, pick }) {
    panel(
      h('div', { class: 'fg-sub' }, '무기 고르기 (겹쳐도 된다)'),
      h('div', { class: 'fg-weapons' }, ...WEAPON_KEYS.map((w, i) => {
        const W = WEAPONS[w];
        const t1 = TECHS[`${w}1`];
        const t3 = TECHS[`${w}3`];
        const taste = TASTE[w] || W.taste;
        return h('div', { class: `fg-wcard${pick === w ? ' picked' : ''}` },
          h('span', { class: 'fg-key' }, String(i + 1)),
          h('div', { class: 'fg-wicon' }, W.icon),
          h('b', null, W.name),
          h('small', null, taste),
          h('div', { class: 'fg-wtech' }, `1단 ${t1.name} ${diceTextOf(t1.dice)}${t1.tough ? ` · 버팀 ${t1.tough}` : ''}`),
          h('div', { class: 'fg-wtech dim' }, `→ 3단 ${t3.name} ${diceTextOf(t3.dice)}${t3.tough ? ` · 버팀 ${t3.tough}` : ''}`));
      })));
    bottom.replaceChildren(h('div', { class: 'fg-hint' }, `숫자키 1~4 · ${Math.ceil(left / 1000)}초`), timerBar(left, total));
  }

  const timerFill = h('i');
  const timerEl = h('div', { class: 'fg-timer' }, timerFill);
  function timerBar(left, total) {
    tickTimer(left, total);
    return timerEl;
  }
  function tickTimer(left, total) {
    timerFill.style.width = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
    timerEl.classList.toggle('hurry', left <= 5000);
  }

  // ───────── 상점
  // d: { round, gold, income, items, tier, reroll, bet, p, me(빌드 정보), opp(빌드 정보), msg, ready, left, total, pairs }
  function shop(d) {
    arena.replaceChildren(stageEl);
    roundEl.textContent = `${d.round}라운드`;
    stakeEl.textContent = '';
    callEl.textContent = '강화';
    setSide(SA, d.me);
    if (d.opp) setSide(SB, d.opp);
    SB.root.classList.toggle('hidden', !d.opp);
    setBar(d.p, d.me.name, d.opp?.name || '');
    cap(!d.opp ? '' : d.opp.shadow
      ? `이번 상대: ${d.opp.name} (지난 라운드 주사위를 베낀 것, 지면 피해 절반)`
      : `이번 상대: ${d.opp.name}${d.oppSeen ? ' · 🧿 이번에 산 것까지 보인다' : ' · 이번에 산 건 공개 때 보인다'}`);
    const inc = d.income ? `이번 라운드 +${d.income.base}${d.income.interest ? ` · 이자 +${d.income.interest}` : ''}` : '';
    const item = it => h('div', { class: `fg-item k-${it.kind} t-${it.tier}${it.sold ? ' sold' : ''}${!it.sold && !it.afford ? ' poor' : ''}` },
      h('span', { class: 'fg-key' }, it.key),
      h('span', { class: 'fg-item-icon' }, it.icon),
      h('div', { class: 'fg-item-body' },
        h('b', null, it.name, it.tierName ? h('small', { class: `fg-tier t-${it.tier}` }, it.tierName) : null),
        h('small', null, it.text)),
      h('div', { class: 'fg-item-right' },
        h('span', { class: 'fg-item-cost' }, it.sold ? '삼' : `${it.cost}냥`),
        !it.sold && it.p != null && d.p != null
          ? (Math.abs(it.p - d.p) < 0.02
            ? h('span', { class: 'fg-item-p' }, '승률 그대로')
            : h('span', { class: `fg-item-p ${it.p > d.p ? 'up' : 'down'}` }, `→ ${pct(it.p)}`))
          : null));
    const tierCard = d.tier.max
      ? h('div', { class: 'fg-item k-tier sold' }, h('span', { class: 'fg-key' }, '4'), h('span', { class: 'fg-item-icon' }, '⬆️'), h('div', { class: 'fg-item-body' }, h('b', null, '3단 다 올림')))
      : item({ key: '4', icon: '⬆️', name: '단 올리기', text: d.tier.text, cost: d.tier.cost, afford: d.tier.afford, p: d.tier.p, kind: 'tier', tier: 'tier' });
    bottom.replaceChildren(
      h('div', { class: 'fg-shop-head' },
        h('b', null, `${d.round}라운드 강화`),
        h('span', { class: 'fg-gold' }, `냥 ${d.gold}`),
        h('span', { class: 'fg-dim' }, inc),
        h('span', { class: 'fg-dim' }, `이자: 남긴 ${RULE.INTEREST_PER}냥마다 +1 (최대 +${RULE.INTEREST_MAX})`),
        d.ready ? h('span', { class: 'fg-ready' }, '준비 완료 ✓') : null,
        d.msg ? h('span', { class: 'fg-msg' }, d.msg) : null),
      h('div', { class: 'fg-shop' }, ...d.items.map(item), tierCard),
      h('div', { class: 'fg-shop-foot' },
        h('span', null, h('span', { class: 'fg-key' }, 'R'), ` 다시 뽑기 ${RULE.REROLL}냥`),
        h('span', { class: d.bet.has ? (d.bet.on ? 'fg-bet on' : 'fg-bet') : 'fg-dim' }, h('span', { class: 'fg-key' }, 'G'), d.bet.has ? ` ${d.bet.icon} ${d.bet.name} ${d.bet.on ? '건다 ✓' : '안 건다'}` : ' 도박 주사위 없음'),
        h('span', null, h('span', { class: 'fg-key' }, '⌫'), ' 되돌리기'),
        h('span', null, h('span', { class: 'fg-key' }, '␣'), d.ready ? ' 준비 취소' : ' 준비 완료')),
      timerBar(d.left, d.total));
    pairsList(d.pairs, '이번 라운드 대진');
  }

  function pairsList(pairs, head) {
    if (!pairs) return;
    othersEl.replaceChildren(h('div', { class: 'fg-others-head' }, head),
      ...pairs.map(pr => h('div', { class: 'fg-orow' }, h('div', { class: 'fg-orow-names' }, `${pr.a} vs ${pr.b}`))));
  }

  // ───────── 유령: 저주할 사람 고르기
  function ghost(d) {
    if (d.watch) {
      panel(h('div', { class: 'fg-logo small' }, '👀 구경 중'), h('div', { class: 'fg-line' }, '모두 강화하는 중. 대결이 시작되면 크게 보여 준다.'));
      bottom.replaceChildren(h('div', { class: 'fg-hint' }, ''), timerBar(d.left, d.total));
      pairsList(d.pairs, '이번 라운드 대진');
      return;
    }
    panel(
      h('div', { class: 'fg-logo small' }, '👻 유령'),
      h('div', { class: 'fg-line' }, '살아 있는 사람 하나를 저주한다. 그 사람은 첫 합에서 제일 높게 나온 주사위가 1이 된다.'),
      h('div', { class: 'fg-targets' }, ...d.targets.map(t => h('div', { class: `fg-target${t.id === d.target ? ' picked' : ''}` }, h('span', { class: 'fg-key' }, String(t.no)), ` ${t.name} · 체력 ${t.hp}`))));
    bottom.replaceChildren(h('div', { class: 'fg-hint' }, '숫자키 = 저주할 사람 · 스페이스 = 준비'), timerBar(d.left, d.total));
    pairsList(d.pairs, '이번 라운드 대진');
  }

  // ───────── 공개: 이번 라운드에 산 것이 한꺼번에 뒤집힌다
  function reveal(d) {
    // d: { rows: [{ name, items: [text], bet }], me, opp, p }
    if (d.me) {
      arena.replaceChildren(stageEl);
      setSide(SA, d.me);
      if (d.opp) setSide(SB, d.opp);
      SB.root.classList.toggle('hidden', !d.opp);
      setBar(d.p, d.me.name, d.opp?.name || '');
      callEl.textContent = '공개!';
      cap('공개!', 'gold');
    } else {
      panel(h('div', { class: 'fg-logo small' }, '공개!'));
    }
    flash('white');
    sfx(a => a.slam());
    bottom.replaceChildren(h('div', { class: 'fg-reveal' }, ...d.rows.map(r => h('div', { class: `fg-rrow${r.me ? ' me' : ''}` },
      h('b', null, r.name),
      h('span', null, r.items.length ? r.items.join(' · ') : '안 삼'),
      r.bet ? h('span', { class: 'fg-rbet' }, r.bet) : null))));
  }

  // ───────── 대결 틀기
  let gen = 0;
  function setupDuel(f) {
    arena.replaceChildren(stageEl);
    stageEl.classList.remove('tense');
    setSide(SA, f.a);
    setSide(SB, f.b);
    SB.root.classList.remove('hidden');
    roundEl.textContent = `${f.round}라운드`;
    stakeEl.textContent = '';
    callEl.textContent = '';
    setBar(f.p0, f.a.name, f.b.name);
    for (const s of SIDES) {
      const fs = f[s];
      if (fs.cursedBy?.length) note(s, `👻 ${fs.cursedBy.join(' · ')}의 저주`);
    }
  }

  async function playFight(f) {
    const my = gen;
    setupDuel(f);
    cap(`${f.a.name} vs ${f.b.name}`);
    await wait(650);
    // 대결 시작: 판돈 · 흡혈
    let shownMult = 1;
    for (const s of SIDES) {
      const o = sideOf(s);
      const r = f.start.stake[s];
      if (r) {
        o.g?.roll();
        sfx(a => a.roll(1));
        await wait(500);
        const m = stakeMultOf(r);
        o.g?.show(`×${m}`, m >= 2 ? 'good' : '');
        shownMult = Math.max(shownMult, m);
        stakeEl.textContent = `판돈 ×${shownMult}`;
        cap(m === 3 ? `🪙 판돈 ×3! 진 쪽은 세 배로 맞는다` : m === 2 ? '🪙 판돈 ×2' : '🪙 판돈 ×1 (그대로)', m >= 2 ? 'gold' : '');
        if (m === 3) flash('gold');
        sfx(a => (m === 3 ? a.jackpot() : a.chip(m * 2)));
        await wait(800);
      }
      const l = f.start.leech[s];
      if (l) {
        o.g?.roll();
        sfx(a => a.roll(1));
        await wait(450);
        o.g?.show(`${l}`, 'good');
        cap(`🧛 ${f[s].name} 흡혈 ${l} — 이기면 회복, 지면 더 깎인다`);
        sfx(a => a.ember());
        await wait(750);
      }
    }
    for (const c of f.clashes) {
      if (my !== gen) return;
      await playClash(f, c);
    }
    if (my !== gen) return;
    await playEnd(f);
  }

  async function playClash(f, c) {
    const e = Math.min(0.4, 0.08 * (c.no - 1)); // 합이 거듭될수록 빨라진다 (결정적 순간은 빼고)
    const quick = ms => Math.max(110, ms * (1 - e));
    roundEl.textContent = `제 ${c.no} 합`;
    restart(roundEl, 'pop');
    sfx(a => a.drum(c.no));
    callEl.textContent = '';
    for (const s of SIDES) {
      const o = sideOf(s);
      o.power.textContent = powerText(f[s], c[s]);
      o.total.className = 'fg-total';
      if (!(c.no === 1 && f[s].cursedBy?.length)) o.note.textContent = '';
    }
    // 던짐
    let n = 0;
    for (const s of SIDES) {
      const o = sideOf(s);
      for (const d of c[s].dice) { o.views.get(d.slot)?.roll(); n++; }
      if (o.g && c[s].g) o.g.roll();
    }
    sfx(a => a.roll(Math.min(4, n)));
    const run = { a: c.a.venom + c.a.first, b: c.b.venom + c.b.first };
    setTotal('a', run.a);
    setTotal('b', run.b);
    markTotals(run);
    await wait(quick(450));

    // 공개: 한 걸음에 양쪽 주사위가 하나씩 '동시에' 멈춘다. 각자 작은 눈부터, 마지막 걸음 = 양쪽 제일 큰 눈
    const by = { a: new Map(c.a.dice.map(d => [d.slot, d])), b: new Map(c.b.dice.map(d => [d.slot, d])) };
    let lead = Math.sign(run.a - run.b);
    for (let i = 0; i < c.steps.length; i++) {
      const pair = SIDES.map(side => {
        const slot = c.steps[i][side];
        if (slot == null) return null;
        const d = by[side].get(slot);
        return d ? { side, d, dv: sideOf(side).views.get(slot) } : null;
      }).filter(Boolean);
      const slow = i === c.slowAt;
      if (slow) {
        cap(pair.length > 1 ? '마지막 주사위!' : '마지막 한 개!', 'tense');
        stageEl.classList.add('tense');
        for (const x of pair) x.dv?.roll(true);
        sfx(a => { a.duck(true); a.heart(true, 1.4); a.slow(); });
        await wait(1100);
      }
      const rr = pair.filter(x => x.d.rr);
      if (rr.length) { // 🍀 행운: 1이 나온 주사위는 한 번 더 구른다
        for (const x of rr) { x.dv?.face(x.d.rr[0], 'min', tagOf(x.d.rr)); note(x.side, '🍀 행운: 1이라 다시'); }
        sfx(a => a.minFace());
        await wait(320);
        for (const x of rr) x.dv?.roll();
        sfx(a => a.roll(rr.length));
        await wait(260);
      }
      for (const x of pair) {
        const { d, dv, side } = x;
        const sides = sidesOf(d.die);
        const st = d.shownFaces[0] === sides ? 'max' : d.shownFaces[0] === 1 ? 'min' : 'idle';
        dv?.face(d.shownFaces[0], st, tagOf(d.shownFaces) + (d.heavy ? ' 🪨' : ''));
        run[side] += d.shown;
        setTotal(side, run[side]);
        sfx(a => a.land(d.shown, sides, i));
        if (d.shownFaces.length > 1) {
          sfx(a => a.explode(d.shownFaces.length - 1));
          note(side, `터졌다! ${d.shownFaces.join(' + ')}`);
        } else if (st === 'max') sfx(a => a.maxFace());
        else if (st === 'min') sfx(a => a.minFace());
        if (d.heavy) note(side, '🪨 1이 나와서 2');
      }
      const nl = Math.sign(run.a - run.b);
      if (nl !== 0 && lead !== 0 && nl !== lead) sfx(a => a.lead());
      if (nl !== 0) lead = nl;
      markTotals(run);
      if (slow) {
        stageEl.classList.remove('tense');
        flash(run.a > run.b ? 'red' : run.b > run.a ? 'blue' : 'gold');
        sfx(a => { a.heart(false); a.duck(false); });
      }
      await wait(i >= c.lockAt ? 180 : quick(360));
    }

    // 저주 · 불꽃
    for (const s of SIDES) {
      const ghosts = f[s].cursedBy || [];
      const skull = c.no === 1 && f[other(s)].augs.includes('curse');
      let curseNo = 0;
      for (const d of c[s].dice) {
        if (!d.ev) continue;
        const dv = sideOf(s).views.get(d.slot);
        if (d.ev.startsWith('curse')) {
          run[s] += 1 - d.shown;
          dv?.face(1, 'min');
          const bySkull = skull && curseNo === 0;
          curseNo++;
          cap(bySkull ? `☠️ ${f[other(s)].name}의 저주! ${f[s].name}의 제일 높은 주사위가 1` : `👻 ${ghosts[c.no - 1] || ghosts[0] || '유령'}의 저주! 제일 높은 주사위가 1`, 'tense');
          sfx(a => a.fizzle());
          setTotal(s, run[s]);
          markTotals(run);
          await wait(560);
        }
        if (d.ev.endsWith('flame')) {
          const prev = d.ev.startsWith('curse') ? 1 : d.shown;
          run[s] += d.v - prev;
          dv?.face(d.faces[0], 'max', tagOf(d.faces));
          cap(`🔥 ${f[s].name} 불꽃! 제일 낮은 주사위가 최대 눈`, 'gold');
          sfx(a => a.flame());
          setTotal(s, run[s]);
          markTotals(run);
          await wait(560);
        }
      }
    }
    // 도박 주사위 (금테): 폭탄이 먼저 터지고(판정 순서 A → B), 남은 주사위로 쌍둥이,
    // 나머지 도박은 앞선 쪽 먼저 · 지고 있는 쪽이 마지막
    for (const s of SIDES.filter(x => c[x].g?.key === 'bomb')) await showGamble(s);
    for (const s of SIDES) {
      if (!c[s].twins) continue;
      run[s] += c[s].twins;
      note(s, `👯 같은 눈 둘! +${c[s].twins}`);
      sfx(a => a.chip(3));
      setTotal(s, run[s]);
      markTotals(run);
      await wait(380);
    }
    for (const s of SIDES.filter(x => c[x].g && c[x].g.key !== 'bomb').sort((x, y) => run[y] - run[x])) await showGamble(s);
    async function showGamble(s) {
      const g = c[s].g;
      const o = sideOf(s);
      if (g.tense) {
        cap(`${f[s].name}의 ${GAMBLES[g.key].icon} ${GAMBLES[g.key].name} 주사위…`, 'tense');
        stageEl.classList.add('tense');
        o.g?.roll(true);
        sfx(a => { a.duck(true); a.heart(true, 1.6); a.slow(); });
        await wait(1050);
      } else await wait(quick(320));
      if (g.key === 'allin') {
        o.g?.show(g.v > 0 ? `+${g.v}` : `${g.v}`, g.v > 0 ? 'good' : 'bad');
        run[s] += g.v;
        setTotal(s, run[s]);
        sfx(a => (g.v > 0 ? a.maxFace() : a.minFace()));
      } else if (g.key === 'mirror') {
        const mine = g.to === s;
        o.g?.show(mine ? `+${g.v}` : `→ ${g.v}`, mine ? 'good' : 'bad');
        run[g.to] += g.v;
        setTotal(g.to, run[g.to]);
        cap(mine ? `🪞 ${f[other(s)].name}의 제일 큰 눈 ${g.v}을(를) 가져왔다` : `🪞 거꾸로! ${f[s].name}의 제일 큰 눈 ${g.v}이(가) 넘어갔다`, mine ? 'gold' : 'tense');
        sfx(a => (mine ? a.lead() : a.thud()));
      } else if (g.key === 'mult') {
        o.g?.show(`×${g.v}`, g.v === 2 ? 'good' : g.v === 0 ? 'bad' : '');
        sfx(a => (g.v === 2 ? a.explode(2) : g.v === 0 ? a.fizzle() : a.tick()));
      } else if (g.key === 'bomb') {
        o.g?.show(String(g.r), g.r === 6 ? 'good' : g.r === 1 ? 'bad' : '');
        const bm = c.bombs.find(x => x.by === s);
        if (bm?.side) {
          const tv = sideOf(bm.side).views.get(bm.slot);
          const td = by[bm.side].get(bm.slot);
          cap(bm.side === s ? `💣 1! ${f[s].name} 폭탄이 제 주사위를 터뜨렸다` : `💣 6! ${f[bm.side].name} 주사위가 터졌다`, bm.side === s ? 'tense' : 'gold');
          sfx(a => { a.explode(3); a.shatter(); });
          tv?.crack();
          await wait(150);
          shatterAt(tv);
          shake(sideOf(bm.side).root);
          run[bm.side] -= td ? td.v : 0;
          setTotal(bm.side, run[bm.side]);
        } else sfx(a => a.tick());
      }
      markTotals(run);
      if (g.tense) {
        stageEl.classList.remove('tense');
        sfx(a => { a.heart(false); a.duck(false); });
      }
      if (g.flip && g.key !== 'mult') {
        cap(`${GAMBLES[g.key].icon} 도박이 판을 뒤집었다!`, 'gold');
        flash('gold');
        sfx(a => a.cheer(0.6));
      }
      await wait(quick(420));
    }
    // 배수: 합계에 곱한다 (뒤집었으면 곱한 다음에 알린다)
    for (const s of SIDES) {
      if (c[s].m === 1) continue;
      run[s] = c[s].total;
      note(s, c[s].m === 2 ? '✖️ 두 배!' : '✖️ 0이 됐다');
      setTotal(s, run[s]);
      markTotals(run);
      if (c[s].g?.flip) {
        cap('✖️ 도박이 판을 뒤집었다!', 'gold');
        flash('gold');
        sfx(a => a.cheer(0.6));
      }
      await wait(quick(380));
    }
    // 값 맞추기 (폭탄 · 거울 순서 차이)
    for (const s of SIDES) if (run[s] !== c[s].total) { run[s] = c[s].total; setTotal(s, run[s]); }
    // 잭팟
    if (c.a.jack !== c.b.jack) {
      const s = c.a.jack ? 'a' : 'b';
      const t = other(s);
      cap(`🎰 ${f[s].name} 잭팟! 같은 눈 셋 — ${f[t].name} 주사위가 전부 깨진다`, 'gold');
      flash('gold');
      sfx(a => a.jackpot());
      await wait(650);
      for (const x of c.broke.filter(x => x.how === 'jackpot')) shatterAt(sideOf(t).views.get(x.slot));
      sfx(a => a.shatter());
      shake(sideOf(t).root);
      await wait(700);
    }

    // 부딪힘
    await wait(quick(220));
    const res = c.result;
    sfx(a => a.clash(c.no, c.margin));
    markTotals(run, res);
    if (res === 'tie') {
      const tb = c.broke.find(x => x.how === 'tie' || x.how === 'endless');
      const n = c.tieNo || c.streak || 1;
      cap(tb ? (tb.how === 'tie' ? `동수 ${RULE.TIE_MAX}번! 둘 다 깨진다` : '동수! ⚡ 끝없는 합') : n >= 2 ? `또 동수! (${n}번째)` : '동수! 아무것도 안 깨진다', 'tie');
      sfx(a => a.tie(n));
    } else if (c.margin <= 1 && !c.broke.some(x => x.how === 'jackpot' || x.how === 'bomb')) {
      cap('1 차이!', 'near');
      sfx(a => a.near());
    }
    callEl.textContent = res === 'tie' ? '동수' : `${c.margin} 차이`;
    // 깨짐
    for (const x of c.broke) {
      if (x.how === 'bomb' || x.how === 'jackpot') continue;
      const dv = sideOf(x.side).views.get(x.slot);
      await wait(quick(160));
      dv?.crack();
      await wait(140);
      shatterAt(dv);
      shake(sideOf(x.side).root);
      sfx(a => a.shatter());
      if (x.how === 'endless') note(x.side, '⚡ 끝없는 합: 동수라 깨졌다');
      else if (x.how === 'tie') note(x.side, `동수 ${RULE.TIE_MAX}번: 둘 다 깨진다`);
    }
    for (const x of c.brace) {
      sideOf(x.side).views.get(x.slot)?.crack();
      note(x.side, '버텼다! 금만 갔다');
      sfx(a => a.thud());
      await wait(420);
    }
    const hurt = SIDES.filter(s => c.broke.some(x => x.side === s));
    for (const s of hurt) {
      const k = c.broke.filter(x => x.side === s).length;
      const per = f[s].augs.includes('venom2') ? RULE.VENOM * 2 : RULE.VENOM;
      if (sideOf(s).views.size > 0 && c.alive[s].length) {
        note(s, `${sideOf(s).note.textContent ? `${sideOf(s).note.textContent} · ` : ''}독기 +${k * per}`);
        sfx(a => a.ember());
      }
    }
    // 승률 막대
    if (c.pA != null) {
      const prev = barP;
      setBar(c.pA, f.a.name, f.b.name);
      const dlt = c.pA - prev;
      if (Math.abs(dlt) >= 0.2 && c.alive.a.length && c.alive.b.length) {
        sfx(a => a.swing(dlt));
        cap(dlt > 0 ? `흐름이 ${f.a.name} 쪽으로` : `흐름이 ${f.b.name} 쪽으로`);
      }
    }
    await wait(quick(620));
    // 정리: 남은 주사위는 다음 합에서 다시 던진다
    for (const s of SIDES) {
      for (const [slot, dv] of sideOf(s).views) {
        if (c.alive[s].includes(slot)) dv.unknown();
        else if (!dv.el.classList.contains('broken')) dv.gone();
      }
      if (sideOf(s).g && c[s].g) sideOf(s).g.rest();
    }
  }

  async function playEnd(f) {
    const W = f.winner;
    const Lz = other(W);
    const ch = f.chase;
    const n = f.clashes.length;
    const pW = f.p0 == null ? null : W === 'a' ? f.p0 : 1 - f.p0;
    roundEl.textContent = `${n}합`;
    setBar(W === 'a' ? 1 : 0, f.a.name, f.b.name);
    sideOf(W).root.classList.add('won');
    sideOf(Lz).root.classList.add('lost');
    if (pW != null && pW < 0.1) {
      cap(`기적! 승률 ${pct(pW)}였던 ${f[W].name}이(가) 이겼다`, 'gold');
      flash('gold');
      sfx(a => a.miracle());
    } else if (pW != null && pW < 0.3) {
      cap(`이변! ${n}합 끝에 ${f[W].name} 승`, 'gold');
      sfx(a => a.comeback());
    } else {
      cap(`${n}합 끝에 ${f[W].name} 승!`, 'win');
      sfx(a => a.win());
    }
    await wait(1000);
    // 추격: 이긴 쪽이 남은 주사위를 다시 굴린다. 한 대씩
    const o = sideOf(W);
    for (const d of ch.dice) o.views.get(d.slot)?.roll();
    if (ch.dice.length) {
      sfx(a => a.roll(Math.min(4, ch.dice.length)));
      callEl.textContent = '추격';
      await wait(450);
    }
    let acc = 0;
    for (let k = 0; k < ch.dice.length; k++) {
      const d = ch.dice[k];
      const dv = o.views.get(d.slot);
      const sides = sidesOf(d.die);
      dv?.face(d.faces[0], d.faces[0] === sides ? 'max' : d.faces[0] === 1 ? 'min' : 'idle', tagOf(d.faces));
      acc += d.hit;
      floatText(sideOf(Lz).total, `−${d.hit}${d.crit ? ' 치명!' : ''}`, d.crit ? 'crit' : 'hit');
      note(Lz, `${k + 1}타 · ${acc}`);
      sfx(a => a.hit(k + 1, !!d.crit));
      shake(sideOf(Lz).root);
      await wait(420);
    }
    let line = [`추격 ${ch.hits}`, `라운드 +${ch.round}`, ch.counter ? `🪃 되치기 −${ch.counter}` : null].filter(Boolean).join(' · ');
    if (ch.mult > 1) line = `(${line}) × 판돈 ${ch.mult}`;
    if (ch.leechExtra) line += ` · 🧛 +${ch.leechExtra}`;
    if (f[W].shadow) line += ' · 그림자라 절반';
    if (f[Lz].shadow) {
      cap(`${f[W].name}이(가) 그림자를 이겼다 · 냥 +${RULE.SHADOW_WIN}`, 'win');
      note(Lz, '그림자는 체력이 없다');
    } else {
      cap(`${f[Lz].name} 체력 −${ch.dmgLoser}`, 'hit');
      note(Lz, `${line} = ${ch.dmgLoser}`);
      sfx(a => a.coins(Math.min(20, Math.max(3, Math.ceil(ch.dmgLoser / 2)))));
    }
    if (ch.counter && !f[W].shadow) floatText(sideOf(W).total, `🪃 −${ch.dmgWinner}`, 'hit');
    if (ch.heal) floatText(sideOf(W).total, `🧛 +${ch.heal}`, 'heal');
    await wait(1500);
  }

  // 다른 대결: 옆 칸에서 합마다 남은 주사위만 보여 준다
  function pipsOf(alive, n) {
    return Array.from({ length: n }, (_, i) => (alive.includes(i) ? '●' : '○')).join('');
  }
  function runOthers(list) {
    othersEl.replaceChildren(h('div', { class: 'fg-others-head' }, '다른 대결'));
    return Promise.all(list.map(async f => {
      const nA = diceOfF(f.a).length;
      const nB = diceOfF(f.b).length;
      const da = h('span', { class: 'fg-pa' }, pipsOf([...Array(nA).keys()], nA));
      const db = h('span', { class: 'fg-pb' }, pipsOf([...Array(nB).keys()], nB));
      const no = h('span', { class: 'fg-dim' }, '');
      const res = h('div', { class: 'fg-orow-res' }, '');
      othersEl.append(h('div', { class: 'fg-orow' },
        h('div', { class: 'fg-orow-names' }, h('span', { class: 'fg-pa' }, `${WEAPONS[f.a.w].icon}${f.a.name}`), ' vs ', h('span', { class: 'fg-pb' }, `${WEAPONS[f.b.w].icon}${f.b.name}`)),
        h('div', { class: 'fg-orow-dice' }, da, ' ', no, ' ', db), res));
      for (const c of f.clashes) {
        await wait(1250);
        da.textContent = pipsOf(c.alive.a, nA);
        db.textContent = pipsOf(c.alive.b, nB);
        no.textContent = `${c.no}합`;
      }
      await wait(600);
      const W = f[f.winner];
      const L = f[other(f.winner)];
      res.textContent = L.shadow ? `${W.name} 승 (그림자)` : `${W.name} 승 · ${L.name} −${f.chase.dmgLoser}`;
      res.classList.add(f.winner === 'a' ? 'fg-pa' : 'fg-pb');
    }));
  }

  // list = 이번 라운드 대결 기록 전부, featured = 크게 볼 대결 번호
  async function fights(list, { featured = 0 } = {}) {
    gen++;
    skipping = false;
    const feat = list[featured];
    const rest = list.filter((_, i) => i !== featured);
    bottom.replaceChildren(h('div', { class: 'fg-hint' }, 'S = 건너뛰기 · F = 빠르게'));
    const pOthers = runOthers(rest);
    if (feat) await playFight(feat);
    await pOthers;
    skipping = false;
    audio.heart(false);
    audio.duck(false);
  }

  // ───────── 정산
  function settle(d) {
    // d: { rows: [{ text, cls }], gold, me }
    bottom.replaceChildren(h('div', { class: 'fg-settle' }, ...d.rows.map(r => h('div', { class: `fg-srow ${r.cls || ''}` }, r.text))),
      h('div', { class: 'fg-hint' }, [d.mine, d.hint].filter(Boolean).join(' · ')));
  }

  // ───────── 끝
  function over(d) {
    // d: { rows: [{ place, name, hp, w, tier, augs, gamble, me }], titles, count }
    panel(
      h('div', { class: 'fg-logo' }, d.rows[0] ? `🏆 ${d.rows[0].name} 우승!` : '끝'),
      h('div', { class: 'fg-standings' }, ...d.rows.map(r => h('div', { class: `fg-stand${r.me ? ' me' : ''}` },
        h('b', null, `${r.place}등`), h('span', null, `${WEAPONS[r.w].icon} ${r.name}`), h('span', { class: 'fg-dim' }, `${r.tier}단 · 체력 ${Math.max(0, r.hp)}`),
        h('span', null, [...r.augs.map(k => AUGS[k].icon), r.gamble ? GAMBLES[r.gamble].icon : ''].join(' '))))),
      h('div', { class: 'fg-titles' }, ...d.titles.map(t => h('div', { class: 'fg-title' }, `${t.icon} ${t.name} — ${t.who}`, t.note ? h('small', null, ` (${t.note})`) : null))));
    bottom.replaceChildren(h('div', { class: 'fg-hint' }, d.hint || ''));
    if (!d.quiet) sfx(a => a.win());
  }

  function destroy() {
    window.removeEventListener('resize', fit);
    clearInterval(tumbleTimer);
    skip();
    root.replaceChildren();
  }

  return {
    top, intro, title, weapon, shop, ghost, reveal, fights, settle, over, toast, tickTimer,
    speed(m) { speed = Math.max(0.25, Number(m) || 1); },
    skip, destroy,
    cap,
  };
}
