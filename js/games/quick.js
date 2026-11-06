// 순발력 타자: 3 · 2 · 1 카운트다운 뒤 화면에 글자 하나(알파벳·자음·모음)가 뜨면 그 키를 제일 빨리 누르는 사람이 이긴다.
// 알파벳은 대문자로 보여 주지만 그냥 그 키만 누르면 된다(Shift 필요 없음). 자음·모음은 두벌식 자판 자리(ㄱ = R, ㅏ = K).
// 키는 e.code(자판의 물리적인 자리)로 보니까 한/영 상태와 상관없다.
// 글자는 카운트다운이 시작될 때 미리 보내 두고, 화면이 서버 시각(revealAt)에 맞춰 다 같이 보여 준다.
// 누른 시간도 각자 노트북이 재서 보내고 방장은 그 시간으로 순위를 매긴다 → 와이파이가 느려도 공정 (반응속도 대결과 같은 방식).
// 1등 +3 · 2등 +2 · 3등 +1, 틀린 키를 누르면 그 라운드는 끝 -1 (아무 키나 연타하는 걸 막는다). 8라운드 합산.
// 화면은 수업 중 뒷사람 눈에 안 띄게 내내 흰 바탕에 검은 글씨 (css .qk-pad)
import { h, isTyping, pick, AGAIN_INTRO } from '../util.js';
import { nameTag, podium, scoreboard } from '../ui.js';

const ROUNDS = 8;
const POINTS = [3, 2, 1];
const WRONG = -1;
const INTRO_TIME = 5000;
const COUNT_TIME = 3000;   // 3 · 2 · 1
const ROUND_LIMIT = 3000;  // 글자가 뜬 뒤 이만큼 지나면 라운드 끝
const GRACE = 300;         // 시간이 끝난 뒤에 도착하는 신호도 이만큼은 기다린다
const RESULT_TIME = 2800;
const GUESS_LIMIT = 90;    // 이보다 빠르면 보고 누른 게 아니라 찍은 것 → 틀림
const MAX_LAG = 1500;      // 도착하기 이만큼 전보다 더 일찍 눌렀다는 신호는 그만큼까지만 믿는다

// 두벌식 자판: 자음·모음 → 그 자리의 영문 키 (Shift 없이 치는 것만)
const JAMO_KEYS = {
  'ㄱ': 'R', 'ㄴ': 'S', 'ㄷ': 'E', 'ㄹ': 'F', 'ㅁ': 'A', 'ㅂ': 'Q', 'ㅅ': 'T', 'ㅇ': 'D', 'ㅈ': 'W', 'ㅊ': 'C', 'ㅋ': 'Z', 'ㅌ': 'X', 'ㅍ': 'V', 'ㅎ': 'G',
  'ㅏ': 'K', 'ㅑ': 'I', 'ㅓ': 'J', 'ㅕ': 'U', 'ㅗ': 'H', 'ㅛ': 'Y', 'ㅜ': 'N', 'ㅠ': 'B', 'ㅡ': 'M', 'ㅣ': 'L', 'ㅐ': 'O', 'ㅔ': 'P',
};
// 숫자는 안 나온다 (사용자 결정). 알파벳 I·O는 뺀다: 모음 ㅣ·자음 ㅇ과 모양이 거의 같아서 실력이 아니라 운이 된다
export const KINDS = [
  { id: 'letter', label: '알파벳', chars: 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('') },
  { id: 'consonant', label: '자음', chars: 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ'.split('') },
  { id: 'vowel', label: '모음', chars: 'ㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣㅐㅔ'.split('') },
];
const kindLabel = id => KINDS.find(k => k.id === id)?.label || '';

// 글자 → 눌러야 하는 키(e.code)
export function keyOf(ch) {
  if (/^[A-Z]$/.test(ch)) return `Key${ch}`;
  if (/^[0-9]$/.test(ch)) return `Digit${ch}`;
  return JAMO_KEYS[ch] ? `Key${JAMO_KEYS[ch]}` : null;
}
// 숫자는 키패드로 눌러도 같은 키
export const normCode = code => String(code || '').replace(/^Numpad(\d)$/, 'Digit$1');
// 답으로 치는 키: 글자·숫자 키 (숫자는 안 나오니 누르면 틀림. Shift·스페이스·한/영·Enter 같은 건 무시)
export const isAnswerKey = code => /^(Key[A-Z]|Digit\d|Numpad\d)$/.test(String(code || ''));
const keyName = code => normCode(code).replace(/^Key|^Digit/, '');
// '❌ 틀림' 옆 안내: ㄱ = R 키, A 키
const hintOf = ch => (JAMO_KEYS[ch] ? `${ch} = ${JAMO_KEYS[ch]} 키` : `${keyName(keyOf(ch))} 키`);
const ALL_CODES = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(c => `Key${c}`); // 봇이 잘못 누르는 키

// 라운드 글자: 종류(알파벳·자음·모음)를 먼저 고르고 그 안에서. 방금 글자는 다시 안 나온다
export function pickChar(prev) {
  const kind = pick(KINDS);
  return { t: pick(kind.chars.filter(c => c !== prev)), kind: kind.id };
}

const sec = ms => `${(ms / 1000).toFixed(2)}초`;
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;

function startRound(S, now) {
  S.round += 1;
  Object.assign(S, {
    phase: 'count',
    revealAt: now + COUNT_TIME,
    endAt: now + COUNT_TIME + ROUND_LIMIT,
    char: pickChar(S.char?.t),
    answers: null,
    deltas: null,
  });
  return true;
}

function finishRound(ctx, now) {
  const S = ctx.state;
  const answers = S.answers || {};
  const right = Object.entries(answers).filter(([, a]) => a.ok).sort((a, b) => a[1].ms - b[1].ms);
  const deltas = {};
  right.forEach(([id], i) => { if (POINTS[i]) deltas[id] = POINTS[i]; });
  for (const [id, a] of Object.entries(answers)) if (!a.ok) deltas[id] = WRONG;
  S.scores = { ...(S.scores || {}) };
  for (const [id, d] of Object.entries(deltas)) S.scores[id] = (S.scores[id] || 0) + d;
  if (right[0]) S.wins = { ...(S.wins || {}), [right[0][0]]: (S.wins?.[right[0][0]] || 0) + 1 };
  for (const [id, a] of Object.entries(answers)) if (!a.ok) S.wrongs = { ...(S.wrongs || {}), [id]: (S.wrongs?.[id] || 0) + 1 };
  if (right[0] && (!S.best || right[0][1].ms < S.best.ms)) S.best = { id: right[0][0], ms: right[0][1].ms, t: S.char.t };
  Object.assign(S, { deltas, phase: 'result', phaseEndsAt: now + RESULT_TIME });
  return true;
}

function finish(ctx) {
  const S = ctx.state;
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  const top = obj => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])[0] || [];
  const [fast, wins] = top(S.wins);
  if (wins >= 2) add(fast, `⚡ 번개 타자 (1등 ${wins}번)`);
  if (S.best) {
    add(S.best.id, `🎯 최고 기록 ${sec(S.best.ms)}`);
    ctx.announce(`⌨️ 오늘의 최고 기록: ${ctx.nameOf(S.best.id)} ${sec(S.best.ms)} (${S.best.t})`);
  }
  const [typo, n] = top(S.wrongs);
  if (n >= 2) add(typo, `🤦 오타왕 (${n}번)`);
  Object.assign(S, { phase: 'final', over: true, titles });
  return true;
}

export default {
  id: 'quick',
  title: '순발력 타자',
  emoji: '⌨️',
  tag: '타이밍',
  color: '#0ca678',
  desc: '3·2·1 뒤에 뜨는 알파벳·자음·모음을 제일 빨리 누르면 승리! 알파벳은 그냥 그 키, 자음·모음은 두벌식 자리 (ㄱ = R)',
  minPlayers: 2,
  maxPlayers: 8,

  setup(ctx, prev) {
    return {
      phase: 'intro',
      phaseEndsAt: ctx.now() + (prev ? AGAIN_INTRO : INTRO_TIME),
      again: !!prev,
      round: 0,
      totalRounds: ROUNDS,
      scores: Object.fromEntries(ctx.roster.map(p => [p.id, 0])),
    };
  },

  onInput(ctx, { pid, type, data }) {
    const S = ctx.state;
    if (type !== 'press' || !['count', 'show'].includes(S.phase) || data.round !== S.round) return false;
    if (!S.roster.some(p => p.id === pid) || S.answers?.[pid]) return false;
    const now = ctx.now();
    let ms = Math.round(Number(data.ms));
    // 시계가 조금 빠른 노트북은 0.1초쯤 일찍 보낼 수 있으니 조금은 봐주고, 그보다 이른 건 무시
    if (!Number.isFinite(ms) || ms < 0 || now < S.revealAt - 300) return false;
    ms = Math.max(ms, now - S.revealAt - MAX_LAG);
    const code = normCode(data.code);
    const ok = code === keyOf(S.char.t) && ms >= GUESS_LIMIT;
    S.answers = { ...(S.answers || {}), [pid]: ok ? { ok: true, ms } : { ok: false, ms, code, guess: ms < GUESS_LIMIT } };
    return true;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase === 'intro') return now >= S.phaseEndsAt && startRound(S, now);
    if (S.phase === 'count') {
      if (now < S.revealAt) return false;
      S.phase = 'show';
      return true;
    }
    if (S.phase === 'show') {
      const allIn = S.roster.filter(p => ctx.isOnline(p.id)).every(p => S.answers?.[p.id]);
      if (allIn || now >= S.endAt + GRACE) return finishRound(ctx, now);
      return false;
    }
    if (S.phase === 'result' && now >= S.phaseEndsAt) return S.round >= S.totalRounds ? finish(ctx) : startRound(S, now);
    return false;
  },

  // 봇: 0.5초 안팎(자음·모음은 자판 자리를 떠올려야 해서 조금 더 걸림)에 누르고, 가끔 옆 키를 잘못 누른다
  bot(ctx, id, mem) {
    const S = ctx.state;
    if (!['count', 'show'].includes(S.phase) || S.answers?.[id]) return null;
    if (mem.round !== S.round) {
      const jamo = S.char.kind === 'consonant' || S.char.kind === 'vowel';
      mem.round = S.round;
      mem.ms = Math.round(Math.max(260, Math.min(1800, 520 + (jamo ? 110 : 0) + gauss() * 150)));
      mem.wrong = Math.random() < 0.08;
    }
    if (ctx.now() < S.revealAt + mem.ms) return null;
    const right = keyOf(S.char.t);
    const code = mem.wrong ? pick(ALL_CODES.filter(c => c !== right)) : right;
    return { type: 'press', data: { round: S.round, code, ms: mem.ms }, say: Math.random() < 0.05 };
  },

  mount(root, api) {
    const head = h('div', { class: 'rx-head' });
    const tag = h('div', { class: 'qk-tag' });
    const big = h('div', { class: 'qk-big' });
    const sub = h('div', { class: 'rx-sub' });
    const board = h('div', { class: 'rx-board' });
    const pad = h('div', { class: 'rx-pad qk-pad idle' }, h('div', { class: 'rx-signal' }, tag, big, sub), board);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'rx qk' }, h('div', { class: 'rx-main' }, head, pad), side));
    document.activeElement?.blur?.();

    let S = null;
    let isPlayer = false;
    let sent = null;
    let shownRound = -1;
    let shownAt = 0;
    let lastPad = '';
    let lastBoard = '';
    const who = id => S.roster.find(p => p.id === id);

    function onKey(e) {
      if (isTyping(e) || !S || e.repeat || !isAnswerKey(e.code)) return;
      if (!isPlayer || !['count', 'show'].includes(S.phase)) return;
      if (sent?.round === S.round || S.answers?.[api.me]) return;
      const now = api.now();
      if (now < S.revealAt) return; // 아직 안 뜸: 무시 (아무 키나 연타하는 건 '틀리면 끝'이 막아 준다)
      // 글자가 실제로 화면에 그려진 때부터 잰다 (그리기가 늦은 노트북이 손해 보지 않게). 그리기 전이면 서버 시각 기준
      const ms = Math.round(shownRound === S.round ? performance.now() - shownAt : now - S.revealAt);
      const code = normCode(e.code);
      sent = { round: S.round, ok: code === keyOf(S.char.t) && ms >= GUESS_LIMIT, ms, code };
      api.send('press', { round: S.round, code, ms });
      paint();
    }
    window.addEventListener('keydown', onKey);

    function paint() {
      if (!S) return;
      const now = api.now();
      let mode = 'idle';
      let t = '';
      let a = '';
      let b = '';
      if (S.phase === 'intro') {
        a = '⌨️';
        b = !isPlayer ? '관전 중' : S.again ? '🔁 한 판 더!' : '글자가 뜨면 그 키를 제일 빨리!';
      } else if (S.phase === 'count' || S.phase === 'show') {
        if (now < S.revealAt) {
          mode = 'count';
          t = S.round === S.totalRounds ? '마지막 라운드!' : `라운드 ${S.round} / ${S.totalRounds}`;
          a = String(Math.max(1, Math.ceil((S.revealAt - now) / 1000)));
          b = '준비…';
        } else {
          if (shownRound !== S.round) {
            shownRound = S.round;
            shownAt = performance.now();
          }
          // 내 판정은 방장 결과를 우선, 아직 안 왔으면 내가 보낸 값으로 먼저 보여 준다
          const mine = S.answers?.[api.me] || (sent?.round === S.round ? sent : null);
          t = kindLabel(S.char.kind);
          a = S.char.t;
          if (!isPlayer) {
            mode = 'go';
            b = '관전 중';
          } else if (!mine) {
            mode = 'go';
          } else if (mine.ok) {
            mode = 'done';
            b = `✅ ${sec(mine.ms)} · 다른 친구들 기다리는 중`;
          } else {
            mode = 'early';
            b = mine.ms < GUESS_LIMIT ? '❌ 너무 빨라요 (찍기)' : `❌ 틀림 · ${hintOf(S.char.t)}`;
          }
        }
      } else {
        mode = 'board';
      }
      const key = `${mode}|${t}|${a}|${b}`;
      if (key === lastPad) return;
      lastPad = key;
      pad.className = `rx-pad qk-pad ${mode}`;
      tag.textContent = t;
      big.textContent = a;
      sub.textContent = b;
    }

    let raf = requestAnimationFrame(function loop() {
      paint();
      raf = requestAnimationFrame(loop);
    });

    function roundBoard() {
      const answers = S.answers || {};
      const deltas = S.deltas || {};
      const order = x => (!x ? 2e9 : !x.ok ? 1e9 : x.ms);
      const rows = [...S.roster].sort((p, q) => order(answers[p.id]) - order(answers[q.id]));
      return h('div', { class: 'rx-result' },
        h('h2', { class: 'display' }, `${S.round >= S.totalRounds ? '마지막 라운드' : `라운드 ${S.round}`} · ${S.char.t}`),
        h('p', { class: 'muted' }, `${kindLabel(S.char.kind)} · ${hintOf(S.char.t)}`),
        h('ol', { class: 'rank-list' }, rows.map(p => {
          const x = answers[p.id];
          const d = deltas[p.id] || 0;
          return h('li', { class: x && !x.ok ? 'bad' : '' },
            nameTag(p, api.me),
            h('span', { class: 'val' }, !x ? '미입력' : x.ok ? sec(x.ms) : x.guess ? '❌ 찍기' : `❌ ${keyName(x.code)} 누름`),
            h('b', { class: `delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}` }, d ? (d > 0 ? `+${d}` : d) : ''));
        })));
    }

    function finalBoard() {
      return h('div', { class: 'rx-result' },
        h('h2', { class: 'display' }, '최종 결과 🏆'),
        podium(S.roster, S.scores, api.me),
        S.best ? h('p', { class: 'muted' }, `최고 기록: ${who(S.best.id)?.name || '?'} ${sec(S.best.ms)} (${S.best.t})`) : null);
    }

    return {
      update({ state }) {
        S = state;
        isPlayer = S.roster.some(p => p.id === api.me);
        head.replaceChildren(
          h('span', {}, S.round ? `라운드 ${S.round} / ${S.totalRounds}` : '곧 시작해요'),
          h('span', {}, isPlayer ? '뜬 글자 키를 제일 빨리!' : '👀 관전 중'));
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
            h('li', {}, '3 · 2 · 1 뒤에 글자 하나: 알파벳 · 자음 · 모음'),
            h('li', {}, '그 키를 제일 빨리! 1등 +3 · 2등 +2 · 3등 +1'),
            h('li', {}, '알파벳은 대문자로 나와도 그냥 그 키 (Shift 필요 없음)'),
            h('li', {}, '자음·모음은 두벌식 자리 (ㄱ = R, ㅏ = K) · 한/영 상관없음'),
            h('li', {}, `틀린 키를 누르면 그 라운드는 끝 ${WRONG}점`),
            h('li', {}, `${ROUNDS}라운드 합산`)));
        paint();
      },
      unmount() {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
      },
    };
  },
};
