// 눈치 게임: '시작!' 뒤에 아무 때나 스페이스 = 다음 숫자 외치기. 꺼져 있던 전구(1, 2, 3…)가 하나씩 켜진다.
// 먼저 외친 사람 기준 0.3초 안에 둘 이상이 같이 외치면 💥 겹침 → 겹친 사람 전부 독박 (그 전구는 꺼진 채로 남는다).
// 끝까지 남은 한 명(제일 늦게 외쳤거나 못 외친 사람)도 독박. 시간(8초) 안에 못 외친 사람이 여럿이면 전부 🐔 겁쟁이 독박.
// 독박이면 ❤️ 하나 잃고, 다 잃으면 탈락. 남은 사람끼리 다음 라운드.
// 2명만 남으면 끝: 하트가 많은 쪽 우승, 같으면 공동 우승 (둘이서는 먼저 누른 사람이 바로 이겨서 눈치 싸움이 안 된다).
// 남은 사람이 한꺼번에 다 탈락하게 되면(전원 겹침 등) 무효, 다시.
// 지연: 누른 시각은 각자 노트북이 서버 시각으로 재서 보내고, 방장은 도착 순서가 아니라 그 시각으로 겹침을 본다.
//       전구는 겹침 창(0.3초)이 닫히고 GRACE만큼 더 기다렸다가 켠다 → 와이파이가 조금 느린 친구의 '같이 누름'도 제때 도착한다.
//       이미 확정된 뒤에야 도착한 신호는 확정 시각에 누른 걸로 친다 (켜진 전구가 도로 꺼지는 일 없게).
// 탈락하면 👻 유령: 라운드마다 한 번 스페이스로 꺼진 전구 하나를 깜빡이게 해서 낚기 (판정엔 영향 없음).
import { h, isTyping, josa, pick, shuffle, INTRO_TIME } from '../util.js';
import { avatar, countdown, podium } from '../ui.js';

const READY_TIME = 1600;     // '준비…' 뒤 '시작!'
const TIME_LIMIT = 8000;     // 시작부터 이만큼 지나도 못 외친 사람은 겁쟁이
const COLLIDE_MS = 300;      // 먼저 외친 사람 기준 이 안에 같이 외치면 겹침
const GRACE = 400;           // 겹침 창이 닫힌 뒤 늦게 오는 신호를 이만큼 더 기다렸다가 전구를 켠다
const MAX_LAG = 1500;        // 도착보다 이만큼 넘게 이르다는 시각은 그만큼까지만 믿는다
const RESULT_TIME = 2800;
const FLICK_TIME = 450;      // 유령이 전구를 깜빡이는 시간
const MAX_VOIDS = 3;         // 무효(다 같이 탈락)가 이만큼 이어지면 그다음엔 그냥 다 같이 탈락 (끝없이 다시 하지 않게)
// 목숨: 처음엔 한 번 독박 = 바로 탈락이었는데, 봇 시험에서 첫 라운드에 4명 중 3명이 한꺼번에 떨어져서 판이 16초 만에 끝남
// → 하트 2개 (운 나쁜 겹침 한 번에 끝나지 않게)
const LIVES = 2;
const END_AT = 2;            // 이만큼 남으면 판이 끝난다

/* ───────── 진행 (방장) ───────── */

function startRound(S, now, replay = false) {
  if (!replay) S.round = (S.round || 0) + 1;
  Object.assign(S, {
    phase: 'ready',
    startAt: now + READY_TIME,
    endAt: now + READY_TIME + TIME_LIMIT,
    seats: shuffle(S.alive),   // 이번 라운드 사람들 (화면 줄 순서)
    lamps: [],                 // 켜진 전구 [{ by, t }]
    bangs: [],                 // 겹침 [{ ids, t, lamp }]
    presses: null,             // { pid: { t, done } } t = 시작부터 ms
    finalT: 0,                 // 이 시각(시작부터 ms)까지는 확정
    flicks: [],
    ghostUsed: null,
    replay,
    last: null,
  });
  return true;
}

// 확정할 때가 된 외침 묶음을 시각 순으로 확정: 맨 앞 외침의 겹침 창이 닫히고 GRACE가 지나면
function settleGroups(S, rel) {
  let changed = false;
  for (;;) {
    const pend = Object.entries(S.presses || {}).filter(([, p]) => !p.done).sort((a, b) => a[1].t - b[1].t);
    if (!pend.length) break;
    const t0 = pend[0][1].t;
    if (rel < t0 + COLLIDE_MS + GRACE) break;
    const group = pend.filter(([, p]) => p.t < t0 + COLLIDE_MS).map(([id]) => id);
    S.presses = { ...S.presses };
    for (const id of group) S.presses[id] = { ...S.presses[id], done: true };
    if (group.length === 1) S.lamps = [...(S.lamps || []), { by: group[0], t: t0 }];
    else S.bangs = [...(S.bangs || []), { ids: group, t: t0, lamp: (S.lamps || []).length }];
    S.finalT = t0 + COLLIDE_MS;
    changed = true;
  }
  return changed;
}

function endRound(ctx, now, notPressed) {
  const S = ctx.state;
  const name = ctx.nameOf;
  const why = {};
  for (const b of S.bangs || []) for (const id of b.ids) why[id] = 'bang';
  // 끝까지 남은 사람: 못 외친 사람이 있으면 그 사람들, 다 외쳤으면 제일 늦게 외친 사람
  if (notPressed.length) for (const id of notPressed) why[id] = 'coward';
  else if (S.lamps?.length) why[S.lamps[S.lamps.length - 1].by] = 'last';
  const losers = Object.keys(why);
  const lives = S.lives || {};
  const dying = losers.filter(id => (lives[id] ?? LIVES) <= 1);
  // 남은 사람이 한꺼번에 다 탈락하게 되면 무효 (하트도 안 깎음)
  const isVoid = dying.length >= S.alive.length && (S.voids || 0) < MAX_VOIDS;
  S.bangCount = { ...(S.bangCount || {}) };
  for (const b of S.bangs || []) for (const id of b.ids) S.bangCount[id] = (S.bangCount[id] || 0) + 1;
  if (S.lamps?.[0]) S.firsts = { ...(S.firsts || {}), [S.lamps[0].by]: (S.firsts?.[S.lamps[0].by] || 0) + 1 };
  if (isVoid) {
    S.voids = (S.voids || 0) + 1;
    ctx.announce('💥 다 같이 걸림! 이번 판은 무효, 다시');
  } else {
    S.voids = 0;
    S.lives = { ...lives };
    for (const id of losers) S.lives[id] = (lives[id] ?? LIVES) - 1;
    S.alive = S.alive.filter(id => !dying.includes(id));
    S.outRound = { ...(S.outRound || {}) };
    for (const id of dying) S.outRound[id] = S.round;
    S.outOrder = [...(S.outOrder || []), ...dying];
    // 겹침 킬(탈락시켰을 때만): 같이 걸린 사람 중 시각이 제일 가까운 사람이 서로의 킬
    for (const b of S.bangs || []) {
      for (const id of b.ids) {
        if (!dying.includes(id)) continue;
        const mine = S.presses[id].t;
        const near = b.ids.filter(o => o !== id).sort((x, y) => Math.abs(S.presses[x].t - mine) - Math.abs(S.presses[y].t - mine))[0];
        if (near) ctx.kill(near, id, '💥 눈치 겹침');
      }
    }
    const cowards = losers.filter(id => why[id] === 'coward');
    const lastOne = losers.find(id => why[id] === 'last');
    if (cowards.length) ctx.announce(`🐔 ${cowards.map(name).join(', ')} 끝까지 못 외쳐서 독박`);
    if (lastOne) ctx.announce(`🐢 ${josa(name(lastOne), '이', '가')} 마지막에 외쳐서 독박`);
  }
  S.last = { why, void: isVoid, out: isVoid ? [] : dying };
  S.phase = 'result';
  S.phaseEndsAt = now + RESULT_TIME;
  return true;
}

function finish(ctx) {
  const S = ctx.state;
  // 순위: 끝까지 산 사람(하트 많은 쪽이 위) > 늦게 탈락한 사람. 같은 라운드에 같이 탈락하면 같은 등수 (점수판엔 버틴 라운드 수로 보임)
  const standings = Object.fromEntries((S.roster || ctx.roster).map(p => [p.id, S.alive.includes(p.id) ? S.round + (S.lives?.[p.id] || 0) : (S.outRound?.[p.id] || 0)]));
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  const top = obj => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])[0] || [];
  const bestLife = Math.max(0, ...S.alive.map(id => S.lives?.[id] || 0));
  const winners = S.alive.filter(id => (S.lives?.[id] || 0) === bestLife);
  for (const id of winners) add(id, '🙋 눈치 9단');
  const [crash, n] = top(S.bangCount);
  if (n >= 2) add(crash, `💥 충돌왕 (${n}번)`);
  const [fast, f] = top(S.firsts);
  if (f >= 2) add(fast, `💡 1번 전구 장인 (${f}번)`);
  Object.assign(S, { standings, titles, winners, phase: 'final', over: true });
  return true;
}

export default {
  id: 'nunchi',
  title: '눈치 게임',
  emoji: '🙋',
  tag: '심리',
  color: '#f59f00',
  desc: '시작! 뒤에 아무 때나 스페이스로 숫자 외치기. 꺼진 전구가 하나씩 켜져요. 0.3초 안에 같이 외치면 💥 둘 다 독박, 끝까지 남아도 독박! ❤️ 2개',
  minPlayers: 3,
  maxPlayers: 8,
  tickMs: 50, // 전구가 제때 켜지게 자주 본다 (보내는 건 바뀔 때만)

  setup(ctx, prev) {
    return {
      phase: 'intro',
      phaseEndsAt: ctx.now() + INTRO_TIME,
      again: !!prev,
      alive: ctx.roster.map(p => p.id),
      lives: Object.fromEntries(ctx.roster.map(p => [p.id, LIVES])),
      round: 0,
    };
  },

  onInput(ctx, { pid, type, data = {} }) {
    const S = ctx.state;
    const now = ctx.now();
    if (!['ready', 'play'].includes(S.phase) || data.at !== S.startAt) return false;
    const rel = now - S.startAt;
    if (type === 'shout') {
      if (!S.alive.includes(pid) || S.presses?.[pid] || rel < -300) return false; // 시계가 조금 빠른 노트북은 봐준다
      let t = Math.round(Number(data.t));
      if (!Number.isFinite(t)) return false;
      t = Math.min(rel + 100, Math.max(t, 0, rel - MAX_LAG, S.finalT || 0));
      if (t >= TIME_LIMIT) return false; // 시간 끝난 뒤에 누른 건 못 외친 것 (겁쟁이)
      S.presses = { ...(S.presses || {}), [pid]: { t } };
      return true;
    }
    if (type === 'flick') {
      if (S.phase !== 'play' || S.alive.includes(pid) || !S.roster.some(p => p.id === pid) || S.ghostUsed?.[pid]) return false;
      const off = Array.from({ length: S.seats.length }, (_, i) => i).filter(i => i >= (S.lamps || []).length);
      if (!off.length) return false;
      S.ghostUsed = { ...(S.ghostUsed || {}), [pid]: 1 };
      S.flicks = [...(S.flicks || []), { by: pid, lamp: pick(off), at: now }].slice(-6);
      return true;
    }
    return false;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    S.alive ||= []; // 방장이 바뀌어 다시 읽었을 때
    if (S.phase === 'intro') return now >= S.phaseEndsAt && startRound(S, now);
    if (S.phase === 'ready') {
      if (now < S.startAt) return false;
      S.phase = 'play';
      return true;
    }
    if (S.phase === 'play') {
      const rel = now - S.startAt;
      const changed = settleGroups(S, rel);
      // 아직 확정 안 된 외침이 있으면 기다린다 (그사이 들어오는 '같이 누름'을 놓치지 않게)
      if (Object.values(S.presses || {}).some(p => !p.done)) return changed;
      const notPressed = S.alive.filter(id => !S.presses?.[id]);
      if (notPressed.length <= 1 || rel >= TIME_LIMIT) return endRound(ctx, now, notPressed);
      return changed;
    }
    if (S.phase === 'result') {
      if (now < S.phaseEndsAt) return false;
      if (S.alive.length <= END_AT) return finish(ctx);
      return startRound(S, now, !!S.last?.void);
    }
    return false;
  },

  // 봇: 시작하고 아무 때나 외치는데, 남이 방금 외친 걸 보면(0.3초쯤 뒤에 알아챔) 조금 미룬다.
  // 안 외친 사람이 둘만 남으면 겁쟁이가 안 되려고 서두른다. 유령이면 가끔 전구를 깜빡인다
  bot(ctx, id, mem) {
    const S = ctx.state;
    const now = ctx.now();
    if (!['ready', 'play'].includes(S.phase)) return null;
    const key = `${S.round}:${S.startAt}`;
    if (!S.alive.includes(id)) {
      if (S.phase !== 'play' || S.ghostUsed?.[id]) return null;
      if (mem.flickKey !== key) {
        mem.flickKey = key;
        mem.flickAt = Math.random() < 0.5 ? S.startAt + 800 + Math.random() * 5000 : Infinity;
      }
      return now >= mem.flickAt ? { type: 'flick', data: { at: S.startAt } } : null;
    }
    if (S.presses?.[id]) return null;
    if (mem.key !== key) Object.assign(mem, { key, at: S.startAt + 300 + Math.random() * 6500, seen: 0, hurry: false });
    const others = Object.entries(S.presses || {}).filter(([pid]) => pid !== id).map(([, p]) => S.startAt + p.t);
    const latest = others.length ? Math.max(...others) : -Infinity;
    if (others.length > mem.seen && now - latest >= 300) {
      mem.seen = others.length;
      if (mem.at - latest < 700) mem.at = latest + 700 + Math.random() * 900;
    }
    const left = S.alive.filter(pid => !S.presses?.[pid]);
    if (left.length <= 2 && !mem.hurry) {
      mem.hurry = true;
      // '시작!' 기준으로 서두른다 (준비 중에 정하면 둘 다 시작하자마자 눌러서 매번 겹쳤다)
      mem.at = Math.min(mem.at, Math.max(now, S.startAt) + 200 + Math.random() * 1400);
    }
    if (now < Math.max(S.startAt, mem.at)) return null;
    return { type: 'shout', data: { at: S.startAt, t: now - S.startAt }, say: Math.random() < 0.08 };
  },

  mount(root, api) {
    const me = api.me;
    const head = h('div', { class: 'rx-head' });
    const status = h('div', { class: 'nc-status' });
    const bulbs = h('div', { class: 'nc-bulbs' });
    const timer = h('div', { class: 'nc-timer' });
    const people = h('div', { class: 'nc-row' });
    const hint = h('div', { class: 'nc-hint' });
    const board = h('div', { class: 'rx-board' });
    const pad = h('div', { class: 'rx-pad nc-pad' }, h('div', { class: 'nc-main' }, status, bulbs, timer, people, hint), board);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'rx nc' }, h('div', { class: 'rx-main' }, head, pad), side));
    document.activeElement?.blur?.();

    let S = null;
    let sent = null;          // 내가 보낸 외침 { at }
    let flicked = null;       // 유령 깜빡임 보낸 라운드
    let bulbKey = '';
    let peopleKey = '';
    let lastText = '';
    let seenBang = null;
    let seenFlick = null;
    const els = [];           // 전구 요소들
    const who = id => S.roster.find(p => p.id === id) || { id, name: '?' };
    const alive = () => S.alive?.includes(me);
    const inRoster = () => S.roster?.some(p => p.id === me);
    const hearts = id => (S.alive?.includes(id) ? '❤️'.repeat(Math.max(0, S.lives?.[id] ?? LIVES)) : '☠️');

    function onKey(e) {
      if (isTyping(e) || !S || e.code !== 'Space') return;
      e.preventDefault(); // 스페이스로 페이지가 스크롤되지 않게
      if (e.repeat || !['ready', 'play'].includes(S.phase) || api.now() < S.startAt || api.now() >= S.endAt) return;
      if (alive()) {
        if (sent?.at === S.startAt || S.presses?.[me]) return;
        sent = { at: S.startAt };
        api.send('shout', { at: S.startAt, t: Math.round(api.now() - S.startAt) });
      } else if (inRoster()) {
        if (flicked === S.startAt || S.ghostUsed?.[me]) return;
        flicked = S.startAt;
        api.send('flick', { at: S.startAt });
      }
      paint();
    }
    window.addEventListener('keydown', onKey);

    // 전구 한 개: 유리알 + 꼭지 + 숫자. 켜지면 노랗게 빛난다 (꺼져 있다가 깜빡이며 켜지는 연출은 css)
    function bulb(n) {
      const wrap = h('div', { class: 'nc-bulb' });
      wrap.innerHTML = `<svg viewBox="-32 -38 64 78" aria-hidden="true">
        <path class="nc-glass" d="M -20 8 A 26 26 0 1 1 20 8 Q 13 15 13 22 L -13 22 Q -13 15 -20 8 Z"/>
        <rect class="nc-base" x="-13" y="22" width="26" height="13" rx="3"/>
        <path class="nc-thread" d="M -11 27 H 11 M -11 31 H 11"/>
        <text class="nc-num" x="0" y="-6">${n}</text></svg>`;
      const tag = h('div', { class: 'nc-who' });
      wrap.append(tag);
      return { wrap, tag };
    }

    function renderBulbs() {
      const n = (S.seats || []).length;
      const key = `${S.startAt}:${n}:${(S.lamps || []).map(l => l.by).join(',')}:${S.phase === 'result' ? JSON.stringify(S.last?.why) : ''}`;
      if (key === bulbKey) return;
      const fresh = !bulbKey.startsWith(`${S.startAt}:`);
      bulbKey = key;
      if (fresh || els.length !== n) {
        els.length = 0;
        bulbs.replaceChildren(...Array.from({ length: n }, (_, i) => {
          const b = bulb(i + 1);
          els.push(b);
          return b.wrap;
        }));
      }
      const lastBy = S.phase === 'result' ? Object.entries(S.last?.why || {}).find(([, w]) => w === 'last')?.[0] : null;
      els.forEach((b, i) => {
        const lamp = S.lamps?.[i];
        b.wrap.classList.toggle('on', !!lamp);
        b.wrap.classList.toggle('last', !!lamp && lamp.by === lastBy);
        b.tag.replaceChildren(...(lamp ? [avatar(who(lamp.by)), who(lamp.by).name] : []));
      });
    }

    function renderPeople() {
      const why = S.phase === 'result' ? S.last?.why || {} : {};
      const state = id => {
        if (why[id] === 'bang') return ['bang', '💥'];
        if (why[id] === 'coward') return ['lose', '🐔'];
        if (why[id] === 'last') return ['lose', '🐢'];
        const p = S.presses?.[id];
        if (p?.done) {
          const i = (S.lamps || []).findIndex(l => l.by === id);
          if (i >= 0) return ['lit', `💡${i + 1}`];
          return ['bang', '💥'];
        }
        if (p) return ['pending', '📣'];
        if (id === me && sent?.at === S.startAt) return ['pending', '📣'];
        return ['', ''];
      };
      const rows = (S.seats || []).map(id => [id, ...state(id), hearts(id)]);
      const key = JSON.stringify([S.startAt, rows]);
      if (key === peopleKey) return;
      peopleKey = key;
      people.replaceChildren(...rows.map(([id, cls, mark, life]) => h('span', { class: `nc-chip ${cls}${id === me ? ' me' : ''}` },
        avatar(who(id)), who(id).name, h('i', { class: 'nc-life' }, life), mark ? h('b', {}, mark) : null)));
    }

    function events() {
      const bangs = S.bangs || [];
      const flicks = S.flicks || [];
      if (seenBang?.at !== S.startAt) seenBang = { at: S.startAt, n: 0 };
      if (seenFlick === null) seenFlick = Math.max(0, ...flicks.map(f => f.at));
      for (const b of bangs.slice(seenBang.n)) {
        const el = els[b.lamp]?.wrap;
        if (el) {
          el.classList.remove('bang');
          void el.offsetWidth;
          el.classList.add('bang');
          setTimeout(() => el.classList.remove('bang'), 700);
        }
        pad.classList.remove('shaking');
        void pad.offsetWidth;
        pad.classList.add('shaking');
        setTimeout(() => pad.classList.remove('shaking'), 450);
      }
      seenBang.n = bangs.length;
      for (const f of flicks) {
        if (f.at <= seenFlick) continue;
        seenFlick = f.at;
        const el = els[f.lamp]?.wrap;
        if (!el || el.classList.contains('on')) continue;
        el.classList.add('flick');
        setTimeout(() => el.classList.remove('flick'), FLICK_TIME);
      }
    }

    function paint() {
      if (!S) return;
      const now = api.now();
      let text = '';
      let sub = '';
      if (S.phase === 'intro') {
        text = '🙋 눈치 게임';
        sub = S.again ? '🔁 한 판 더!' : '시작하면 아무 때나 스페이스, 겹치면 독박!';
      } else if (S.phase === 'ready' || S.phase === 'play') {
        const before = now < S.startAt;
        text = before ? (S.replay ? '💥 다시! 준비…' : '준비…') : '눈치 게임 시작!';
        if (!inRoster()) sub = '👀 관전 중';
        else if (!alive()) sub = flicked === S.startAt || S.ghostUsed?.[me] ? '👻 깜빡임 썼어요' : '👻 스페이스 = 꺼진 전구 깜빡이기 (낚시)';
        else if (S.presses?.[me]?.done) {
          const i = (S.lamps || []).findIndex(l => l.by === me);
          sub = i >= 0 ? `💡 ${i + 1}번! 끝까지 남지만 마세요` : '💥 겹쳤다…';
        } else if (S.presses?.[me] || sent?.at === S.startAt) sub = '📣 외쳤다! 겹치지 마라…';
        else sub = before ? '시작하면 아무 때나 스페이스' : '스페이스 = 다음 숫자 외치기';
      } else if (S.phase === 'result') {
        const why = S.last?.why || {};
        const ids = Object.keys(why);
        const out = S.last?.out || [];
        text = S.last?.void ? '💥 다 같이 걸림! 무효' : ids.length ? `독박: ${ids.map(id => who(id).name).join(', ')}` : '휴…';
        sub = S.last?.void ? '이번 판은 다시 해요'
          : out.length ? `☠️ ${out.map(id => who(id).name).join(', ')} 탈락 · 생존 ${S.alive.length}명` : `💔 하트 하나씩 · 생존 ${S.alive.length}명`;
      }
      const key = `${text}|${sub}`;
      if (key !== lastText) {
        lastText = key;
        status.textContent = text;
        hint.textContent = sub;
      }
    }

    let raf = requestAnimationFrame(function loop() {
      paint();
      raf = requestAnimationFrame(loop);
    });

    function finalBoard() {
      const winners = (S.winners || []).map(id => who(id).name).join(', ');
      return h('div', { class: 'rx-result' },
        h('h2', { class: 'display' }, winners ? `🙋 ${winners} 눈치 9단!` : '최종 결과'),
        podium(S.roster, S.standings, me));
    }

    return {
      update({ state }) {
        S = state;
        S.alive ||= []; // 다 같이 탈락하면 빈 배열이라 Firebase에서 사라진다
        head.replaceChildren(
          h('span', {}, S.round ? `라운드 ${S.round} · 생존 ${S.alive.length}명` : '곧 시작해요'),
          h('span', {}, alive() ? '겹치지 말고, 꼴찌도 되지 말고!' : inRoster() ? '👻 유령' : '👀 관전 중'));
        const playing = ['ready', 'play', 'result'].includes(S.phase);
        pad.classList.toggle('board', S.phase === 'final');
        if (S.phase === 'final') board.replaceChildren(finalBoard());
        if (playing) {
          renderBulbs();
          renderPeople();
          events();
        } else {
          bulbs.replaceChildren();
          people.replaceChildren();
          bulbKey = '';
          peopleKey = '';
        }
        timer.replaceChildren(...(S.phase === 'play' || S.phase === 'ready' ? [countdown(S.endAt, TIME_LIMIT + READY_TIME)] : []));
        const out = S.outOrder || [];
        side.replaceChildren(...[
          h('h3', {}, `생존 ${S.alive.length}명`),
          h('div', { class: 'tc-alive' }, S.alive.map(id => h('span', { class: 'tc-alive-chip' }, avatar(who(id)), who(id).name, ` ${hearts(id)}`))),
          out.length ? h('h3', {}, '독박 기록') : null,
          out.length ? h('ul', { class: 'rules' }, out.map(id => h('li', {}, `${who(id).name} · ${S.outRound?.[id] || '?'}라운드`))) : null,
          h('h3', {}, '규칙'),
          h('ul', { class: 'rules' },
            h('li', {}, "'시작!' 뒤에 아무 때나 스페이스 = 다음 숫자 외치기 (전구가 하나씩 켜짐)"),
            h('li', {}, '0.3초 안에 같이 외치면 💥 겹침, 겹친 사람 전부 독박'),
            h('li', {}, '끝까지 남은 사람(제일 늦게 외침)도 독박'),
            h('li', {}, `${TIME_LIMIT / 1000}초 안에 못 외치면 🐔 겁쟁이 독박`),
            h('li', {}, `❤️ ${LIVES}개: 독박이면 하나 잃고, 다 잃으면 탈락`),
            h('li', {}, '남은 사람이 한꺼번에 다 탈락하게 되면 무효, 다시'),
            h('li', {}, '2명만 남으면 끝: 하트 많은 쪽 우승, 같으면 공동 우승'),
            h('li', {}, '👻 탈락하면 라운드마다 한 번 스페이스로 꺼진 전구 깜빡이기 (낚시)')),
        ].filter(Boolean));
        paint();
      },
      unmount() {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
      },
    };
  },
};
