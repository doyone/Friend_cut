import { h, pick } from '../util.js';
import { nameTag, podium, scoreboard } from '../ui.js';

const ROUNDS = 5;
const POINTS = [3, 2, 1];
const EARLY = -2;
const LOCKOUT = 900;      // 라운드 시작 직후엔 클릭을 무시 (이전 라운드 연타 방지)
const ROUND_LIMIT = 3000; // 초록불 뒤 이만큼 지나면 라운드 종료
const RESULT_TIME = 4500;
const GUESS_LIMIT = 90;   // 이보다 빠르면 사람이 아니라 '찍은' 것으로 보고 부정출발 처리

const DECOYS = [
  { kind: 'yellow', text: '지금…?' },
  { kind: 'blue', text: '누를까?' },
  { kind: 'yellow', text: '아직!' },
  { kind: 'blue', text: '초록 아님' },
];

function startRound(S, now) {
  S.round += 1;
  S.phase = 'wait';
  S.taps = null;
  S.deltas = null;
  S.roundStartAt = now;
  S.goAt = now + LOCKOUT + 1500 + Math.random() * 3500;
  S.endAt = S.goAt + ROUND_LIMIT;
  S.decoy = null;
  // 2라운드부터 가짜 신호 😈
  if (S.round >= 2 && Math.random() < 0.55) {
    const from = now + LOCKOUT + 600;
    const to = S.goAt - 1100;
    if (to > from) {
      const at = from + Math.random() * (to - from);
      S.decoy = { ...pick(DECOYS), at, until: at + 550 };
    }
  }
  return true;
}

function finishRound(S, now) {
  const taps = S.taps || {};
  const valid = Object.entries(taps).filter(([, t]) => !t.early).sort((a, b) => a[1].rt - b[1].rt);
  const deltas = {};
  valid.forEach(([id], i) => { if (POINTS[i]) deltas[id] = POINTS[i]; });
  S.earlyCount = S.earlyCount || {};
  for (const [id, t] of Object.entries(taps)) {
    if (!t.early) continue;
    deltas[id] = EARLY;
    S.earlyCount[id] = (S.earlyCount[id] || 0) + 1;
  }
  S.scores = S.scores || {};
  for (const [id, d] of Object.entries(deltas)) S.scores[id] = (S.scores[id] || 0) + d;
  if (valid[0] && (!S.best || valid[0][1].rt < S.best.rt)) S.best = { id: valid[0][0], rt: valid[0][1].rt };
  S.deltas = deltas;
  S.phase = 'result';
  S.phaseEndsAt = now + RESULT_TIME;
  return true;
}

export default {
  id: 'reaction',
  title: '반응속도 대결',
  emoji: '⚡',
  tag: '타이밍',
  color: '#f1c40f',
  desc: '초록불이 켜지면 가장 먼저 클릭! 미리 누르면 감점, 가짜 신호도 조심하세요.',
  minPlayers: 2,
  maxPlayers: 8,

  setup(ctx) {
    const scores = {};
    for (const p of ctx.roster) scores[p.id] = 0;
    return { round: 0, totalRounds: ROUNDS, phase: 'intro', phaseEndsAt: ctx.now() + 4000, scores };
  },

  onInput(ctx, { pid, type, data }) {
    const S = ctx.state;
    if (type !== 'tap' || S.phase !== 'wait' || data.round !== S.round) return false;
    if (!S.roster.some(p => p.id === pid) || S.taps?.[pid]) return false;
    const rt = Number(data.rt);
    const early = !!data.early || !Number.isFinite(rt) || rt < GUESS_LIMIT;
    S.taps = { ...(S.taps || {}), [pid]: early ? { early: true } : { rt: Math.round(rt) } };
    if (data.bait) ctx.announce(`🎣 ${ctx.nameOf(pid)} 가짜 신호에 낚임 ㅋㅋㅋ`);
    return true;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase === 'intro') return now >= S.phaseEndsAt && startRound(S, now);
    if (S.phase === 'wait') {
      const allIn = S.roster.filter(p => ctx.isOnline(p.id)).every(p => S.taps?.[p.id]);
      if (now >= S.endAt || (allIn && now >= S.roundStartAt + LOCKOUT)) return finishRound(S, now);
      return false;
    }
    if (S.phase === 'result' && now >= S.phaseEndsAt) {
      if (S.round >= S.totalRounds) {
        S.phase = 'final';
        S.over = true;
        S.titles = {};
        if (S.best) {
          S.titles[S.best.id] = ['⚡ 번개손'];
          ctx.announce(`⚡ 오늘의 번개손: ${ctx.nameOf(S.best.id)} ${S.best.rt}ms`);
        }
        const [worst, n] = Object.entries(S.earlyCount || {}).sort((a, b) => b[1] - a[1])[0] || [];
        if (n >= 2) (S.titles[worst] ||= []).push(`💥 부정출발왕 (${n}번)`);
        return true;
      }
      return startRound(S, now);
    }
    return false;
  },

  // 봇: 200~450ms에 누르고, 가끔 부정출발하거나 가짜 신호에 낚인다.
  bot(ctx, id, mem) {
    const S = ctx.state;
    if (S.phase !== 'wait' || S.taps?.[id]) return null;
    const now = ctx.now();
    if (mem.round !== S.round) {
      mem.round = S.round;
      mem.rt = 200 + Math.random() * 250;
      mem.jump = Math.random() < 0.08;
      mem.bait = !!S.decoy && Math.random() < 0.3;
    }
    if (mem.bait && now >= S.decoy.at + 150 && now < S.decoy.until + 200) {
      return { type: 'tap', data: { early: true, bait: true, round: S.round } };
    }
    if (mem.jump && now >= S.roundStartAt + LOCKOUT + 300 && now < S.goAt) {
      return { type: 'tap', data: { early: true, round: S.round } };
    }
    if (now >= S.goAt + mem.rt) return { type: 'tap', data: { rt: mem.rt, round: S.round } };
    return null;
  },

  mount(root, api) {
    const big = h('div', { class: 'rx-big' });
    const sub = h('div', { class: 'rx-sub' });
    const board = h('div', { class: 'rx-board' });
    const pad = h('div', { class: 'rx-pad idle' }, h('div', { class: 'rx-signal' }, big, sub), board);
    const head = h('div', { class: 'rx-head' });
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'rx' }, h('div', { class: 'rx-main' }, head, pad), side));
    document.activeElement?.blur?.(); // 스페이스바가 버튼을 누르지 않도록

    let S = null;
    let isPlayer = false;
    let greenRound = -1;
    let greenAt = 0;
    let sent = null;
    let lastPad = '';
    let lastBoard = '';
    const who = id => S.roster.find(p => p.id === id);

    function press(e) {
      if (e && e.button > 0) return;
      if (!S || !isPlayer || S.phase !== 'wait') return;
      if (sent?.round === S.round || S.taps?.[api.me]) return;
      const now = api.now();
      if (now < S.roundStartAt + LOCKOUT) return;
      let data;
      if (greenRound === S.round) data = { rt: performance.now() - greenAt };
      else if (now >= S.goAt) data = { rt: now - S.goAt }; // 초록 화면이 그려지기 직전에 누른 경우
      else {
        data = { early: true };
        if (S.decoy && now >= S.decoy.at && now < S.decoy.until + 400) data.bait = true;
      }
      data.round = S.round;
      sent = { round: S.round, data };
      api.send('tap', data);
      paint();
    }

    function onKey(e) {
      if (e.target.closest?.('input, textarea')) return;
      if (e.code !== 'Space') return; // Enter는 채팅용
      e.preventDefault();
      if (!e.repeat) press();
    }
    pad.addEventListener('pointerdown', press);
    window.addEventListener('keydown', onKey);

    function paint() {
      if (!S) return;
      const now = api.now();
      let mode = 'idle';
      let a = '';
      let b = '';
      if (S.phase === 'intro') {
        a = String(Math.max(1, Math.ceil((S.phaseEndsAt - now) / 1000)));
        b = isPlayer ? '초록색이 되면 스페이스!' : '관전 중';
      } else if (S.phase === 'wait') {
        // 내 판정은 방장 결과를 우선, 아직 안 왔으면 내가 보낸 값으로 먼저 보여준다
        const mine = S.taps?.[api.me] || (sent?.round === S.round ? sent.data : null);
        if (mine) {
          if (mine.early) {
            mode = 'early'; a = '부정출발 💥'; b = `${EARLY}점… 다른 친구들 기다리는 중`;
          } else {
            mode = 'done'; a = `${Math.round(mine.rt)}ms`; b = '기록 완료! 다른 친구들 기다리는 중';
          }
        } else if (now < S.roundStartAt + LOCKOUT) {
          a = `라운드 ${S.round}`;
          b = S.round === S.totalRounds ? '마지막 라운드!' : '준비…';
        } else if (S.decoy && now >= S.decoy.at && now < S.decoy.until) {
          mode = `decoy ${S.decoy.kind}`; a = S.decoy.text;
        } else if (now < S.goAt) {
          mode = 'wait'; a = '기다려…'; b = '초록색이 되면 스페이스!';
        } else {
          if (greenRound !== S.round) {
            greenRound = S.round;
            greenAt = performance.now();
          }
          mode = 'go'; a = '지금!'; b = isPlayer ? '' : '관전 중';
        }
      } else {
        mode = 'board';
      }
      const key = `${mode}|${a}|${b}`;
      if (key === lastPad) return;
      lastPad = key;
      pad.className = `rx-pad ${mode}`;
      big.textContent = a;
      sub.textContent = b;
    }

    let raf = requestAnimationFrame(function loop() {
      paint();
      raf = requestAnimationFrame(loop);
    });

    function roundBoard() {
      const taps = S.taps || {};
      const deltas = S.deltas || {};
      const order = t => (!t ? 1e9 : t.early ? 2e9 : t.rt);
      const rows = [...S.roster].sort((x, y) => order(taps[x.id]) - order(taps[y.id]));
      return h('div', { class: 'rx-result' },
        h('h2', { class: 'display' }, S.round >= S.totalRounds ? '마지막 라운드 결과' : `라운드 ${S.round} 결과`),
        h('ol', { class: 'rank-list' }, rows.map(p => {
          const t = taps[p.id];
          const d = deltas[p.id] || 0;
          return h('li', { class: t?.early ? 'bad' : '' },
            nameTag(p, api.me),
            h('span', { class: 'val' }, !t ? '미입력' : t.early ? '부정출발 💥' : `${t.rt}ms`),
            h('b', { class: `delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}` }, d ? (d > 0 ? `+${d}` : d) : ''));
        })));
    }

    function finalBoard() {
      return h('div', { class: 'rx-result' },
        h('h2', { class: 'display' }, '최종 결과 🏆'),
        podium(S.roster, S.scores, api.me),
        S.best ? h('p', { class: 'muted' }, `최고 반응속도: ${who(S.best.id)?.name || '?'} ${S.best.rt}ms`) : null);
    }

    return {
      update({ state }) {
        S = state;
        isPlayer = S.roster.some(p => p.id === api.me);
        head.replaceChildren(
          h('span', {}, S.round ? `라운드 ${S.round} / ${S.totalRounds}` : '곧 시작해요'),
          h('span', {}, isPlayer ? '초록색에만 클릭!' : '👀 관전 중'));
        if (S.phase === 'result' || S.phase === 'final') {
          const key = `${S.phase}:${S.round}`;
          if (key !== lastBoard) {
            lastBoard = key;
            board.replaceChildren(S.phase === 'final' ? finalBoard() : roundBoard());
          }
        }
        side.replaceChildren(
          h('h3', {}, '점수'),
          scoreboard(S.roster, S.scores, api.me, S.phase === 'result' ? S.deltas : null),
          h('h3', {}, '규칙'),
          h('ul', { class: 'rules' },
            h('li', {}, '초록색 "지금!"이 뜨면 스페이스 (클릭도 됨)'),
            h('li', {}, '1등 +3 · 2등 +2 · 3등 +1'),
            h('li', {}, `미리 누르면 부정출발 ${EARLY}점`),
            h('li', {}, '2라운드부터 가짜 신호가 나와요 😈')));
        paint();
      },
      unmount() {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
      },
    };
  },
};
