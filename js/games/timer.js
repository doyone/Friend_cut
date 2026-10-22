// 초세기 서바이벌: 1~12초 중 랜덤 목표 시간을 속으로 세다가 스페이스(NOW!).
// 모두 누르거나 시간이 지나면 꼴찌부터 한 명씩 공개되고, 아래쪽은 한꺼번에 탈락.
// 마지막 1명이 우승. 탈락자는 유령이 되어 숫자키로 생존자 화면을 방해한다.
import { h, isTyping, pick } from '../util.js';
import { avatar, countdown, keyNav, podium } from '../ui.js';

const INTRO_TIME = 4500;
// 신호등: 목표 시간 1초 보여 준 뒤 빨강 1초 → 주황 1초 → 초록(= 시작). 초록불 켜지는 순간부터 센다.
// 초록불은 누를 때까지 켜 둔다: 시작 뒤에 화면이 또 바뀌면(불이 꺼지거나 글씨가 바뀌면) 그게 시작 신호처럼 보여서 헷갈린다.
const LIGHT = 1000;
const READY_TIME = LIGHT * 3; // 시작 전: 꺼짐 1초 + 빨강 1초 + 주황 1초

// 시작(초록) 기준으로 지금 켜져 있어야 할 불: -2초~-1초 빨강, -1초~0 주황, 0초부터 계속 초록
function lampAt(msFromStart) {
  if (msFromStart >= -2 * LIGHT && msFromStart < -LIGHT) return 'red';
  if (msFromStart >= -LIGHT && msFromStart < 0) return 'amber';
  if (msFromStart >= 0) return 'green';
  return '';
}
const MIN_T = 1;
const MAX_T = 12;
const PERFECT = 50;       // 이 안으로 맞히면 퍼펙트 (ms)
const HAUNTS = 2;         // 유령 한 명이 라운드마다 쓸 수 있는 방해 횟수
const FX_TIME = 1600;
const FX = ['numbers', 'ink', 'shake'];
const AFTER_REVEAL = 3000;

// 남은 인원 → 이번 라운드 생존자 수. 사람이 많으면 한 번에 많이 떨어진다 (8명이어도 최대 2라운드).
export function keepCount(n) {
  if (n >= 7) return 3;
  if (n >= 4) return 2;
  return 1;
}

const revealStep = n => (n <= 3 ? 1400 : n <= 5 ? 1100 : 850);
// i번째로 공개되는 줄 (0 = 꼴찌). 마지막(1등)은 뜸을 조금 더 들인다.
const revealTime = (S, i) => S.revealAt + i * S.revealStep + (i === S.results.length - 1 ? 700 : 0);
const sec = ms => (ms / 1000).toFixed(2);
// 대충 정규분포 (봇 오차용)
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;
const signed = ms => `${ms >= 0 ? '+' : '−'}${sec(Math.abs(ms))}`;

function startRound(ctx, now) {
  const S = ctx.state;
  S.round += 1;
  S.phase = 'count';
  S.target = MIN_T + Math.floor(Math.random() * (MAX_T - MIN_T + 1));
  S.keep = keepCount(S.alive.length);
  S.startAt = now + READY_TIME;
  S.deadline = S.startAt + S.target * 1000 + Math.max(3000, S.target * 500);
  S.pressed = null;
  S.results = null;
  S.cut = null;
  S.nextAlive = null;
  S.haunts = null;
  S.hauntUsed = null;
  ctx.secret.presses = {};
  return true;
}

function reveal(ctx, now) {
  const S = ctx.state;
  const goal = S.target * 1000;
  const rows = S.alive.map(id => {
    const t = ctx.secret.presses?.[id];
    return t == null ? { id } : { id, t: Math.round(t), err: Math.round(Math.abs(t - goal)) };
  });
  rows.sort((a, b) => (a.err ?? Infinity) - (b.err ?? Infinity));
  const pressedCount = rows.filter(r => r.err != null).length;
  let cut = Math.min(S.keep, pressedCount);
  if (cut === 0) cut = rows.length; // 전원 시간 초과면 아무도 안 떨어지고 다시
  while (cut < rows.length && rows[cut].err != null && rows[cut].err === rows[cut - 1].err) cut++; // 경계 동점은 같이 생존
  S.results = rows;
  S.cut = cut;
  S.nextAlive = rows.slice(0, cut).map(r => r.id);
  S.phase = 'reveal';
  S.revealAt = now + 800;
  S.revealStep = revealStep(rows.length);
  S.revealEnd = revealTime(S, rows.length - 1) + AFTER_REVEAL;

  // 칭호용 기록
  for (const r of rows) {
    if (r.err == null) {
      S.sleepers = { ...(S.sleepers || {}), [r.id]: true };
      continue;
    }
    if (!S.best || r.err < S.best.err) S.best = { id: r.id, err: r.err };
    if (!S.worst || r.err > S.worst.err) S.worst = { id: r.id, err: r.err };
  }
  return true;
}

// 공개 애니메이션이 끝난 뒤에야 탈락을 확정하고 채팅에 알린다 (미리 스포 안 되게)
function settle(ctx, now) {
  const S = ctx.state;
  const name = ctx.nameOf;
  const out = S.results.slice(S.cut);
  for (const r of S.results) {
    if (r.err != null && r.err <= PERFECT) ctx.announce(`🎯 퍼펙트! ${name(r.id)} ${sec(r.t)}초 (목표 ${S.target}초)`);
  }
  if (out.length) {
    ctx.announce(`💀 탈락: ${out.map(r => `${name(r.id)}(${r.err == null ? '시간 초과' : `±${sec(r.err)}초`})`).join(', ')}`);
    S.outRounds = [...(S.outRounds || []), out.map(r => r.id)];
  } else {
    ctx.announce('😴 전원 시간 초과! 이번 라운드는 다시');
  }
  S.history = [...(S.history || []), { round: S.round, target: S.target, out: out.map(r => r.id) }];
  S.alive = S.nextAlive;
  if (S.alive.length > 1) return startRound(ctx, now);
  finish(ctx);
  return true;
}

function finish(ctx) {
  const S = ctx.state;
  const placement = [...S.alive, ...[...(S.outRounds || [])].reverse().flat()];
  for (const p of S.roster) if (!placement.includes(p.id)) placement.push(p.id);
  S.placement = placement;
  S.standings = Object.fromEntries(placement.map((id, i) => [id, placement.length - i]));
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  if (S.alive[0]) add(S.alive[0], '👑 최후의 1인');
  if (S.best && S.best.err <= 300) add(S.best.id, `🎯 인간 시계 (±${sec(S.best.err)}초)`);
  if (S.worst && S.worst.err >= 1500) add(S.worst.id, `🐢 시간 개념 실종 (±${sec(S.worst.err)}초)`);
  for (const id of Object.keys(S.sleepers || {})) add(id, '😴 졸았음');
  S.titles = titles;
  S.phase = 'final';
  S.over = true;
}

export default {
  id: 'timer',
  title: '초세기 서바이벌',
  emoji: '⏱️',
  tag: '타이밍',
  color: '#3498db',
  desc: '1~12초 랜덤 목표를 속으로 세고 스페이스. 꼴찌부터 공개되고 아래쪽은 한 번에 탈락, 마지막 1명이 우승. 탈락하면 유령이 되어 방해!',
  minPlayers: 2,
  maxPlayers: 8,

  setup(ctx) {
    return {
      phase: 'intro',
      phaseEndsAt: ctx.now() + INTRO_TIME,
      round: 0,
      alive: ctx.roster.map(p => p.id),
    };
  },

  onInput(ctx, { pid, type, data }) {
    const S = ctx.state;
    if (S.phase !== 'count') return false;
    if (type === 'now') {
      if (!S.alive.includes(pid) || S.pressed?.[pid] || data.round !== S.round) return false;
      const t = Number(data.t);
      if (!Number.isFinite(t) || t <= 0) return false;
      ctx.secret.presses = { ...(ctx.secret.presses || {}), [pid]: t };
      S.pressed = { ...(S.pressed || {}), [pid]: true };
      return true;
    }
    if (type === 'haunt') {
      const isGhost = S.roster.some(p => p.id === pid) && !S.alive.includes(pid);
      const used = S.hauntUsed?.[pid] || 0;
      if (!isGhost || used >= HAUNTS || !S.alive.includes(data.target) || S.pressed?.[data.target]) return false;
      S.hauntUsed = { ...(S.hauntUsed || {}), [pid]: used + 1 };
      S.haunts = [...(S.haunts || []), { by: pid, to: data.target, kind: pick(FX), at: ctx.now() }].slice(-20);
      return true;
    }
    return false;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase === 'intro') return now >= S.phaseEndsAt && startRound(ctx, now);
    if (S.phase === 'count') {
      const waiting = S.alive.filter(id => ctx.isOnline(id) && !S.pressed?.[id]);
      if (now >= S.deadline || (now >= S.startAt && waiting.length === 0)) return reveal(ctx, now);
      return false;
    }
    if (S.phase === 'reveal' && now >= S.revealEnd) return settle(ctx, now);
    return false;
  },

  // 봇: 목표에서 수백 ms쯤 빗나가게 누른다 (목표가 길수록 더 빗나감). 탈락하면 가끔 유령 방해.
  bot(ctx, id, mem) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase !== 'count') return null;
    if (S.alive.includes(id)) {
      if (S.pressed?.[id]) return null;
      if (mem.round !== S.round) {
        mem.round = S.round;
        mem.t = Math.max(300, S.target * 1000 + gauss() * (250 + S.target * 70));
      }
      if (now >= S.startAt + mem.t) return { type: 'now', data: { t: mem.t, round: S.round } };
      return null;
    }
    const targets = S.alive.filter(x => !S.pressed?.[x]);
    if (targets.length && (S.hauntUsed?.[id] || 0) < HAUNTS && now > S.startAt + 400 && Math.random() < 0.012) {
      return { type: 'haunt', data: { target: pick(targets) } };
    }
    return null;
  },

  mount(root, api) {
    const me = api.me;
    const top = h('div', { class: 'tc-top' });
    const stage = h('div', { class: 'tc-stage' });
    const strip = h('div', { class: 'tc-strip' });
    const fx = h('div', { class: 'tc-fx' });
    const box = h('div', { class: 'tc-box' }, top, stage, strip, fx);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'tc' }, box, side));
    document.activeElement?.blur?.();

    let S = null;
    let stageKey = '';
    let refs = {};
    let nav = null;
    let pressedRound = -1;
    let lampTimers = [];
    let seenHaunt = null;
    const who = id => S.roster.find(p => p.id === id) || { id, name: '?' };
    const inRoster = () => S.roster.some(p => p.id === me);
    const alive = () => S.alive.includes(me);
    const iPressed = () => pressedRound === S.round || !!S.pressed?.[me];

    function press() {
      if (!S || S.phase !== 'count' || !alive() || iPressed()) return;
      const now = api.now();
      if (now < S.startAt) {
        box.classList.remove('nope');
        void box.offsetWidth;
        box.classList.add('nope');
        return;
      }
      // 화면이 버벅여도 공정하도록, 그려진 프레임이 아니라 시계로 '초록불 켜진 순간'부터 잰다
      const t = now - S.startAt;
      pressedRound = S.round;
      api.send('now', { t, round: S.round });
      render();
    }

    function onKey(e) {
      if (isTyping(e) || e.code !== 'Space' || e.repeat) return;
      if (S?.phase === 'count' && alive()) {
        e.preventDefault();
        press();
      }
    }
    window.addEventListener('keydown', onKey);
    box.addEventListener('pointerdown', e => { if (e.button === 0) press(); });

    // 유령의 방해가 내 화면에 떨어졌을 때
    function runFx(x) {
      const by = who(x.by).name;
      const label = h('div', { class: 'fx-by' }, `👻 ${by}의 방해!`);
      let el;
      if (x.kind === 'ink') {
        el = h('div', { class: 'fx-ink' });
      } else if (x.kind === 'numbers') {
        el = h('div', { class: 'fx-numbers' });
        const timer = setInterval(() => {
          const n = h('span', { class: 'fx-num', style: `left:${10 + Math.random() * 70}%;top:${10 + Math.random() * 60}%` },
            String(1 + Math.floor(Math.random() * 12)));
          el.append(n);
          setTimeout(() => n.remove(), 450);
        }, 140);
        setTimeout(() => clearInterval(timer), FX_TIME);
      } else {
        el = h('div', { class: 'fx-tick' }, '째깍 째깍 째깍');
        box.classList.add('shaking');
        setTimeout(() => box.classList.remove('shaking'), FX_TIME);
      }
      fx.append(el, label);
      setTimeout(() => { el.remove(); label.remove(); }, FX_TIME);
    }

    function checkHaunts() {
      const list = S.haunts || [];
      if (seenHaunt === null) {
        seenHaunt = Math.max(0, ...list.map(x => x.at));
        return;
      }
      for (const x of list) {
        if (x.at <= seenHaunt) continue;
        seenHaunt = x.at;
        if (x.to === me && S.phase === 'count' && !iPressed()) runFx(x);
      }
    }

    function countStage() {
      const head = h('div', { class: 'tc-goal' }, '목표');
      if (alive() && iPressed()) {
        return h('div', {}, h('div', { class: 'tc-now' }, 'NOW!'), h('p', { class: 'tc-msg' }, '결과는 다 같이 공개! 숨 참고 기다리는 중'));
      }
      if (inRoster() && !alive()) {
        const used = S.hauntUsed?.[me] || 0;
        const targets = S.alive.filter(id => !S.pressed?.[id]).map(who);
        const btns = targets.map(p => h('button', {
          class: 'vote-btn', tabindex: '-1',
          onClick: () => api.send('haunt', { target: p.id }),
        }, avatar(p, 'lg'), h('span', {}, p.name)));
        if (used < HAUNTS && btns.length) nav = keyNav(btns);
        return h('div', { class: 'tc-ghost' },
          h('div', { class: 'tc-ghost-title' }, '👻 유령 모드'),
          h('p', {}, `목표 ${S.target}초 · 아직 안 누른 친구 화면을 방해하세요 (남은 방해 ${HAUNTS - used}번)`),
          used < HAUNTS && btns.length ? h('div', { class: 'vote-grid' }, btns) : h('p', { class: 'muted' }, used >= HAUNTS ? '방해 다 씀. 구경하세요 ㅋ' : '다들 눌렀어요'));
      }
      refs.lamps = { red: h('i', { class: 'lamp red' }), amber: h('i', { class: 'lamp amber' }), green: h('i', { class: 'lamp green' }) };
      for (const off of [-2 * LIGHT, -LIGHT, 0]) {
        const wait = S.startAt + off - api.now();
        if (wait > 0) lampTimers.push(setTimeout(paint, wait + 1));
      }
      refs.light = h('div', { class: 'tc-light' }, refs.lamps.red, refs.lamps.amber, refs.lamps.green);
      refs.msg = h('p', { class: 'tc-msg' });
      return h('div', {}, head, h('div', { class: 'tc-target' }, `${S.target}초`), refs.light, refs.msg);
    }

    function revealStage() {
      const rows = S.results || [];
      const goal = S.target * 1000;
      const items = [];
      const final = S.nextAlive?.length === 1; // 이번에 1명만 남으면 우승 확정
      rows.forEach((r, k) => {
        if (k === S.cut && S.cut < rows.length) items.push(h('li', { class: 'tc-cut' }, '▲ 생존 · 탈락 ▼'));
        const safe = k < S.cut;
        const row = h('li', { class: `tc-row ${safe ? (final ? 'win' : 'safe') : 'out'}`, 'data-i': rows.length - 1 - k },
          h('span', { class: 'rank' }, `${k + 1}`),
          h('span', { class: 'who' }, avatar(who(r.id)), who(r.id).name),
          h('span', { class: 'time' }, r.t == null ? '시간 초과' : `${sec(r.t)}초`),
          h('span', { class: 'diff' }, r.t == null ? '' : signed(r.t - goal)),
          h('span', { class: 'stamp' }, safe ? (final ? '👑 우승' : '생존') : '탈락'));
        items.push(row);
      });
      refs.rows = items.filter(x => x.classList.contains('tc-row'));
      return h('div', { class: 'tc-reveal' },
        h('div', { class: 'tc-reveal-head' }, `결과 공개 · 목표 ${S.target}초`),
        h('ol', { class: 'tc-list' }, items));
    }

    function finalStage() {
      const winner = who(S.placement?.[0]);
      return h('div', { class: 'tc-final' },
        avatar(winner, 'xl'),
        h('div', { class: 'tc-final-title' }, `${winner.name} 최후의 1인!`),
        podium(S.roster, S.standings, me));
    }

    function introStage() {
      return h('div', { class: 'tc-intro' },
        h('div', { class: 'tc-final-title' }, '⏱️ 초세기 서바이벌'),
        h('ul', { class: 'rules big' },
          h('li', {}, '1~12초 중 목표 시간이 나와요. 🔴→🟠→🟢 신호등이 초록불이 되는 순간부터 속으로 세다가 스페이스 = NOW!'),
          h('li', {}, '다 누르면 꼴찌부터 공개, 선 아래는 한 번에 탈락'),
          h('li', {}, `${S.alive.length}명 → 이번 판은 ${keepCount(S.alive.length)}명만 살아남아요`),
          h('li', {}, '탈락하면 👻 유령: 숫자키로 생존자 화면 방해')),
        countdown(S.phaseEndsAt, INTRO_TIME));
    }

    function renderTop() {
      const last = S.alive.length <= 3 && S.keep === 1;
      top.replaceChildren(
        h('span', {}, S.round ? `라운드 ${S.round}` : '곧 시작'),
        S.phase === 'count' || S.phase === 'reveal'
          ? h('span', { class: last ? 'final' : '' }, last ? `🔥 결승! ${S.alive.length}명 중 1명만 생존` : `${S.alive.length}명 중 ${S.keep}명만 생존`)
          : h('span', {}, `생존 ${S.alive.length}명`));
    }

    function renderStrip() {
      if (S.phase !== 'count') {
        strip.hidden = true;
        return;
      }
      strip.hidden = false;
      const tiles = S.roster.map(p => {
        const isAlive = S.alive.includes(p.id);
        const pressed = S.pressed?.[p.id] || (p.id === me && iPressed());
        return h('div', { class: `tc-tile${isAlive ? '' : ' ghost'}` },
          avatar(p), h('span', {}, p.name),
          isAlive && pressed ? h('span', { class: 'tc-badge' }, 'NOW!') : null,
          isAlive ? null : h('span', { class: 'tc-ghost-mark' }, '👻'));
      });
      strip.replaceChildren(...tiles);
    }

    function renderSide() {
      const history = (S.history || []).map(x => h('li', {},
        h('b', {}, `R${x.round} · ${x.target}초`), ' ',
        x.out.length ? x.out.map(id => who(id).name).join(', ') : '탈락 없음'));
      side.replaceChildren(...[
        h('h3', {}, `생존 ${S.alive.length}명`),
        h('div', { class: 'tc-alive' }, S.alive.map(id => h('span', { class: 'tc-alive-chip' }, avatar(who(id)), who(id).name))),
        history.length ? h('h3', {}, '탈락 기록') : null,
        history.length ? h('ul', { class: 'rules' }, history) : null,
        h('h3', {}, '규칙'),
        h('ul', { class: 'rules' },
          h('li', {}, '스페이스 = NOW! (한 번만)'),
          h('li', {}, '7명 이상 → 3명 생존, 4~6명 → 2명, 3명 이하 → 1명'),
          h('li', {}, '시간 초과는 무조건 탈락'),
          h('li', {}, `유령은 라운드마다 방해 ${HAUNTS}번 (숫자키)`)),
      ].filter(Boolean));
    }

    function render() {
      renderTop();
      let role = '';
      if (S.phase === 'count') {
        if (alive()) role = `alive:${iPressed()}`;
        else if (inRoster()) role = `ghost:${S.hauntUsed?.[me] || 0}:${S.alive.filter(id => !S.pressed?.[id]).join()}`;
        else role = 'spectator';
      }
      const key = [S.phase, S.round, role].join('|');
      if (key !== stageKey) {
        stageKey = key;
        nav?.destroy();
        nav = null;
        refs = {};
        lampTimers.forEach(clearTimeout);
        lampTimers = [];
        const make = { intro: introStage, count: countStage, reveal: revealStage, final: finalStage }[S.phase];
        stage.replaceChildren(make ? make() : '');
      }
      renderStrip();
      renderSide();
      paint();
    }

    // 매 프레임: 신호등, 초록불 순간 기록, 공개 진행
    function paint() {
      if (!S) return;
      const now = api.now();
      if (S.phase === 'count') {
        if (refs.light) {
          const since = now - S.startAt;
          const lamp = lampAt(since);
          for (const [name, el] of Object.entries(refs.lamps)) {
            if (el.classList.contains('on') !== (lamp === name)) el.classList.toggle('on', lamp === name);
          }
          // 글씨는 초록불이 켜지는 순간 한 번만 바뀐다 (그 뒤로는 그대로)
          const go = since >= 0;
          const msg = !go ? '초록불이 켜지는 순간부터 세요!' : alive() ? '🟢 시작! 속으로 세다가 스페이스' : '관전 중';
          if (refs.msg.textContent !== msg) refs.msg.textContent = msg;
          refs.msg.classList.toggle('go', go);
        }
      } else if (S.phase === 'reveal' && refs.rows) {
        for (const row of refs.rows) {
          const shown = now >= revealTime(S, Number(row.dataset.i));
          if (shown !== row.classList.contains('shown')) row.classList.toggle('shown', shown);
        }
      }
    }

    let raf = requestAnimationFrame(function loop() {
      paint();
      raf = requestAnimationFrame(loop);
    });

    return {
      update({ state }) {
        S = state;
        checkHaunts();
        render();
      },
      unmount() {
        cancelAnimationFrame(raf);
        lampTimers.forEach(clearTimeout);
        nav?.destroy();
        window.removeEventListener('keydown', onKey);
      },
    };
  },
};
