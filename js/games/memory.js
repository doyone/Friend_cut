// 외워라: 화살표 칸이 하나씩 켜지는 순서를 보고, 다 끝나면 똑같이 ← ↑ → ↓(WASD도)로 친다.
// 3개로 시작해서 라운드마다 하나씩 덧붙는다(앞 순서는 그대로). 틀리거나 시간 안에 못 치면 탈락(그다음부터 구경).
// 끝까지 남은 사람이 이긴다. 같은 라운드에 다 틀리면 그 라운드에서 더 멀리 맞힌 사람이 위.
// 4라운드부터 보여 주는 속도가 빨라지고, 가끔 '🔄 거꾸로!' 라운드(본 순서의 반대로 쳐야 함)가 섞인다.
// 입력은 각자 화면에서 바로 판정하고 다 치거나 틀리는 순간 한 번만 보낸다 (방장이 친 순서를 다시 확인) → 렉 없음.
import { h, isTyping, pick, INTRO_TIME } from '../util.js';
import { avatar, podium } from '../ui.js';

const COUNT_TIME = 2000;
const RESULT_TIME = 2800;
const GRACE = 400;
const START_LEN = 3;
const MAX_LEN = 14;          // 여기까지 다 맞히면 남은 사람 다 같이 우승
export const ARROWS = ['U', 'R', 'D', 'L'];
const KEY = { ArrowUp: 'U', KeyW: 'U', ArrowRight: 'R', KeyD: 'R', ArrowDown: 'D', KeyS: 'D', ArrowLeft: 'L', KeyA: 'L' };
const SIGN = { U: '↑', R: '→', D: '↓', L: '←' };
// 하나 보여 주는 간격: 0.7초에서 라운드마다 0.045초씩 빨라짐 (최소 0.33초). 켜져 있는 건 그중 70%
export const stepOf = round => Math.max(330, 700 - (round - 1) * 45);
export const inputTime = len => 2500 + len * 650;
export const expectedOf = S => (S.reverse ? [...S.seq].reverse() : S.seq);

function startRound(S, now) {
  S.round += 1;
  const seq = S.round === 1 ? Array.from({ length: START_LEN }, () => pick(ARROWS)) : [...S.seq, pick(ARROWS)];
  const step = stepOf(S.round);
  const startAt = now + COUNT_TIME;
  const showEnd = startAt + seq.length * step;
  Object.assign(S, {
    phase: 'count',
    seq,
    step,
    reverse: S.round >= 4 && Math.random() < 0.3,
    startAt,
    showEnd,
    inputEnd: showEnd + inputTime(seq.length),
    done: null,
  });
  return true;
}

// 친 순서를 정답과 비교: 앞에서부터 몇 개 맞혔나
export function judge(expected, keys) {
  let n = 0;
  while (n < expected.length && keys[n] === expected[n]) n++;
  return { n, ok: n === expected.length };
}

function finishRound(ctx, now) {
  const S = ctx.state;
  const done = S.done || {};
  const failed = S.alive.filter(id => !done[id]?.ok);
  S.progress = { ...(S.progress || {}) };
  for (const id of S.alive) S.progress[id] = done[id]?.n || 0;
  S.cleared = { ...(S.cleared || {}) };
  for (const id of S.alive) if (done[id]?.ok) S.cleared[id] = S.round;
  S.outRound = { ...(S.outRound || {}) };
  for (const id of failed) S.outRound[id] = S.round;
  S.alive = S.alive.filter(id => !failed.includes(id));
  S.lastFailed = failed;
  if (failed.length) ctx.announce(`🧠 ${failed.map(ctx.nameOf).join(', ')} 탈락 (${S.seq.length}개째)`);
  Object.assign(S, { phase: 'result', phaseEndsAt: now + RESULT_TIME });
  return true;
}

function finish(ctx) {
  const S = ctx.state;
  // 순위: 끝까지 남음 > 늦게 탈락 > 같은 라운드 탈락이면 그 라운드에서 더 멀리 맞힘
  const standings = Object.fromEntries(S.roster.map(p => [p.id,
    S.alive.includes(p.id) ? (S.cleared?.[p.id] || 0) * 100 + 99 : (S.cleared?.[p.id] || 0) * 100 + (S.progress?.[p.id] || 0)]));
  const titles = {};
  for (const id of S.alive) (titles[id] ||= []).push(`🧠 기억력 왕 (${S.seq.length}개)`);
  Object.assign(S, { standings, titles, phase: 'final', over: true });
  return true;
}

export default {
  id: 'memory',
  title: '외워라',
  emoji: '🧠',
  tag: '심리',
  color: '#7950f2',
  desc: '화살표가 켜지는 순서를 외워서 그대로 치기! 라운드마다 하나씩 길어지고, 틀리면 탈락. 가끔 거꾸로 라운드도',
  minPlayers: 2,
  maxPlayers: 8,

  setup(ctx, prev) {
    return {
      phase: 'intro',
      phaseEndsAt: ctx.now() + INTRO_TIME,
      again: !!prev,
      alive: ctx.roster.map(p => p.id),
      round: 0,
      seq: [],
    };
  },

  onInput(ctx, { pid, type, data = {} }) {
    const S = ctx.state;
    const now = ctx.now();
    if (type !== 'done' || !['show', 'input'].includes(S.phase) || data.round !== S.round) return false;
    if (!S.alive.includes(pid) || S.done?.[pid] || now < S.showEnd - 300) return false;
    const keys = String(data.keys || '').toUpperCase().replace(/[^URDL]/g, '').slice(0, S.seq.length).split('');
    const { n, ok } = judge(expectedOf(S), keys);
    const ms = Math.max(0, Math.round(Number(data.ms) || now - S.showEnd));
    S.done = { ...(S.done || {}), [pid]: { ok, n, ms } };
    return true;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase === 'intro') return now >= S.phaseEndsAt && startRound(S, now);
    if (S.phase === 'count') {
      if (now < S.startAt) return false;
      S.phase = 'show';
      return true;
    }
    if (S.phase === 'show') {
      if (now < S.showEnd) return false;
      S.phase = 'input';
      return true;
    }
    if (S.phase === 'input') {
      const allIn = S.alive.filter(id => ctx.isOnline(id)).every(id => S.done?.[id]);
      return (allIn || now >= S.inputEnd + GRACE) && finishRound(ctx, now);
    }
    if (S.phase === 'result' && now >= S.phaseEndsAt) {
      S.alive ||= []; // 방장이 바뀌어 다시 읽었을 때
      if (S.alive.length <= 1 || S.seq.length >= MAX_LEN) return finish(ctx);
      return startRound(S, now);
    }
    return false;
  },

  // 봇: 길어질수록 잘 틀린다 (3개 거의 다 맞힘 → 12개쯤이면 반도 못 맞힘). 한 칸에 0.26~0.48초
  bot(ctx, id, mem) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase !== 'input' || !S.alive.includes(id) || S.done?.[id]) return null;
    if (mem.round !== S.round) {
      const exp = expectedOf(S);
      const len = exp.length;
      const p = Math.max(0.15, Math.min(0.97, 1.12 - 0.07 * len - (S.reverse ? 0.08 : 0)));
      mem.round = S.round;
      if (Math.random() < p) mem.keys = exp.join('');
      else {
        const i = Math.floor(Math.random() * len);
        mem.keys = exp.slice(0, i).join('') + pick(ARROWS.filter(a => a !== exp[i]));
      }
      mem.at = S.showEnd + 500 + mem.keys.length * (260 + Math.random() * 220);
    }
    if (now < mem.at) return null;
    return { type: 'done', data: { round: S.round, keys: mem.keys, ms: Math.round(mem.at - S.showEnd) } };
  },

  mount(root, api) {
    const me = api.me;
    const head = h('div', { class: 'rx-head' });
    const status = h('div', { class: 'mm-status' });
    const tiles = Object.fromEntries(ARROWS.map(a => [a, h('div', { class: `mm-tile mm-${a}` }, SIGN[a])]));
    const cross = h('div', { class: 'mm-cross' }, h('i'), tiles.U, h('i'), tiles.L, h('i', { class: 'mm-core' }), tiles.R, h('i'), tiles.D, h('i'));
    const dots = h('div', { class: 'mm-dots' });
    const people = h('div', { class: 'mm-row' });
    const hint = h('div', { class: 'rx-sub mm-hint' });
    const board = h('div', { class: 'rx-board' });
    const pad = h('div', { class: 'rx-pad mm-pad' }, h('div', { class: 'mm-main' }, status, cross, dots, people, hint), board);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'rx mm' }, h('div', { class: 'rx-main' }, head, pad), side));
    document.activeElement?.blur?.();

    let S = null;
    let typed = [];
    let typedRound = -1;
    let sent = null;
    let lastText = '';
    let peopleKey = '';
    const flashUntil = {};
    const who = id => S.roster.find(p => p.id === id) || { id, name: '?' };
    const alive = () => S?.alive?.includes(me);

    function onKey(e) {
      if (isTyping(e) || !S) return;
      const a = KEY[e.code];
      if (!a) return;
      if (e.code.startsWith('Arrow')) e.preventDefault(); // 방향키로 페이지가 스크롤되지 않게
      if (e.repeat || !alive() || !['show', 'input'].includes(S.phase)) return;
      const now = api.now();
      if (now < S.showEnd || now >= S.inputEnd || sent?.round === S.round || S.done?.[me]) return;
      if (typedRound !== S.round) {
        typedRound = S.round;
        typed = [];
      }
      typed.push(a);
      const exp = expectedOf(S);
      const right = exp[typed.length - 1] === a;
      flashUntil[a] = { until: performance.now() + 220, right };
      if (!right || typed.length === exp.length) {
        sent = { round: S.round, ok: right };
        api.send('done', { round: S.round, keys: typed.join(''), ms: Math.round(now - S.showEnd) });
      }
      paint();
    }
    window.addEventListener('keydown', onKey);

    function paint() {
      if (!S) return;
      const now = api.now();
      const t = performance.now();
      // 보여 주는 중: 순서대로 한 칸씩 켜짐 (서버 시각 기준이라 모두 같은 때)
      let lit = null;
      if ((S.phase === 'count' || S.phase === 'show') && now >= S.startAt && now < S.showEnd) {
        const k = (now - S.startAt) / S.step;
        const i = Math.floor(k);
        if (k - i < 0.7) lit = S.seq[i];
      }
      for (const a of ARROWS) {
        const f = flashUntil[a];
        const flash = f && f.until > t;
        // 둘째 값이 undefined면 toggle이 '켜고 끄기'로 동작해서 매 프레임 깜빡인다 → 꼭 true/false로
        tiles[a].classList.toggle('on', lit === a || !!(flash && f.right));
        tiles[a].classList.toggle('bad', !!(flash && !f.right));
      }
      let text = '';
      let sub = '';
      if (S.phase === 'intro') {
        text = '🧠 외워라';
        sub = S.again ? '🔁 한 판 더!' : '화살표가 켜지는 순서를 외우세요';
      } else if (['count', 'show', 'input'].includes(S.phase)) {
        const mine = S.done?.[me] || (sent?.round === S.round ? sent : null);
        if (now < S.startAt) {
          text = S.reverse ? '🔄 거꾸로 라운드!' : `${S.seq.length}개 외우기`;
          sub = S.reverse ? '보여 준 순서의 반대로 치세요' : '잘 보세요…';
        } else if (now < S.showEnd) {
          text = S.reverse ? '🔄 외워라 (거꾸로 칠 것)' : '외워라…';
          sub = '';
        } else {
          text = S.reverse ? '🔄 거꾸로 쳐라!' : '쳐라!';
          sub = !S.roster.some(p => p.id === me) ? '👀 관전 중' : !alive() ? '👻 탈락: 구경 중'
            : mine ? (mine.ok ? '✅ 다 맞혔다! 기다리는 중' : '❌ 틀렸다…') : `← ↑ → ↓ (WASD) · ${Math.max(0, Math.ceil((S.inputEnd - now) / 1000))}초`;
        }
      }
      // 내 진행 점
      const len = S.seq?.length || 0;
      const mineN = typedRound === S.round ? typed.length : 0;
      const dotKey = `${S.round}:${len}:${mineN}:${S.phase}`;
      if (dots.dataset.key !== dotKey) {
        dots.dataset.key = dotKey;
        dots.replaceChildren(...(S.phase === 'input' || S.phase === 'show' ? Array.from({ length: len }, (_, i) => h('i', { class: i < mineN ? 'on' : '' })) : []));
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

    function renderPeople() {
      const rows = S.roster.map(p => {
        const d = S.done?.[p.id];
        const out = !S.alive.includes(p.id) && !(S.lastFailed || []).includes(p.id);
        const cls = out ? 'out' : d ? (d.ok ? 'ok' : 'bad') : S.phase === 'input' ? 'typing' : '';
        const mark = out ? '👻' : d ? (d.ok ? '✅' : `❌ ${d.n}개째`) : S.phase === 'input' ? '⌨️' : '';
        return [p.id, cls, mark];
      });
      const key = JSON.stringify([S.round, S.phase, rows]);
      if (key === peopleKey) return;
      peopleKey = key;
      people.replaceChildren(...rows.map(([id, cls, mark]) => h('span', { class: `nc-chip mm-chip ${cls}${id === me ? ' me' : ''}` },
        avatar(who(id)), who(id).name, mark ? h('b', {}, mark) : null)));
    }

    function finalBoard() {
      const winners = S.alive.map(id => who(id).name).join(', ');
      return h('div', { class: 'rx-result' },
        h('h2', { class: 'display' }, winners ? `🧠 ${winners} 기억력 왕!` : '최종 결과'),
        h('p', { class: 'muted' }, `마지막 순서 (${S.seq.length}개): ${S.seq.map(a => SIGN[a]).join(' ')}`),
        podium(S.roster, Object.fromEntries(Object.entries(S.standings || {}).map(([id, v]) => [id, Math.floor(v / 100)])), me));
    }

    return {
      update({ state }) {
        S = state;
        S.alive ||= []; // 다 같이 탈락하면 빈 배열이라 Firebase에서 사라진다
        head.replaceChildren(
          h('span', {}, S.round ? `라운드 ${S.round} · ${S.seq.length}개 · 생존 ${S.alive.length}명` : '곧 시작해요'),
          h('span', {}, alive() ? '순서대로 외우기!' : S.roster.some(p => p.id === me) ? '👻 구경 중' : '👀 관전 중'));
        pad.classList.toggle('board', S.phase === 'final');
        if (S.phase === 'final') board.replaceChildren(finalBoard());
        renderPeople();
        side.replaceChildren(
          h('h3', {}, `생존 ${S.alive.length}명`),
          h('div', { class: 'tc-alive' }, S.alive.map(id => h('span', { class: 'tc-alive-chip' }, avatar(who(id)), who(id).name))),
          h('h3', {}, '규칙'),
          h('ul', { class: 'rules' },
            h('li', {}, '화살표 칸이 켜지는 순서를 외웠다가, 다 끝나면 똑같이 치기 (← ↑ → ↓ 또는 WASD)'),
            h('li', {}, `${START_LEN}개로 시작해서 라운드마다 하나씩 덧붙어요 (앞 순서는 그대로)`),
            h('li', {}, '틀리거나 시간 안에 못 치면 탈락'),
            h('li', {}, '4라운드부터 빨라지고, 가끔 🔄 거꾸로 라운드'),
            h('li', {}, '끝까지 남은 사람 우승')));
        paint();
      },
      unmount() {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
      },
    };
  },
};
