// 콜라 불어라: 콜라병을 돌아가며 흔든다 (베스킨라빈스31처럼 한 차례에 1~3번). 흔들수록 병 위의 풍선이 부푼다.
// 빨간 구간부터는 어디서 터질지 모른다 (끝까지 가면 무조건 펑). 터뜨린 사람 탈락, 남은 사람끼리 새 병, 마지막 1명 우승.
// 빨간 구간의 차례는 🎰 룰렛으로 시작한다: 자유 · 무조건 3번 · 딱 1번 · 통과 · 거꾸로 · 식히기 · 카드.
// 🔄 떠넘기기 카드(처음 1장, 최대 2장): 내 차례를 건너뛰고 다음 사람이 3번 더 (겹치면 +3, 최대 9번). 빨간 구간에서 3번 버티면 카드 +1.
// 빨간 구간의 흔들기는 0.4초 두근거린 뒤에 결과가 난다 (모두가 같은 순간에 숨죽이게).
// 터지는 곳은 방장만 안다(ctx.secret). 떠넘기기를 받아서 터뜨렸으면 떠넘긴 사람 킬, 끝자리에서 넘겨받아 터뜨려도 넘긴 사람 킬.
import { h, isTyping, josa, pick, shuffle, INTRO_TIME } from '../util.js';
import { avatar, countdown, podium } from '../ui.js';

const TOP = 31;
const FREE_MAX = 3;          // 자유 차례에 흔들 수 있는 최대
const MAX_CARDS = 2;
const DEBT_STEP = 3;         // 떠넘기기 한 번에 다음 사람이 더 흔드는 횟수
export const DEBT_MAX = 9;
const TURN_TIME = 5000;
const PER_FORCED = 450;      // 강제 횟수가 많으면 1번당 시간을 더 준다
const GRACE = 200;           // 마감 직전에 누른 신호가 도착할 시간
const SPIN_TIME = 800;       // 룰렛 도는 시간
const SKIP_SHOW = 900;       // '통과'를 보여 주는 시간
const TENSION = 400;         // 빨간 구간에서 흔든 뒤 결과가 나올 때까지 두근거리는 시간
const BOOM_TIME = 3200;
const SLIP = 0.2;            // 봇이 계산 안 하고 아무렇게나 할 확률

// 이번 병의 끝: 사람이 줄면 병도 작아져서 뒤 라운드가 금방 끝난다 (5명 이상 31, 2명 22)
export const maxOf = alive => Math.min(TOP, 16 + alive * 3);
// 여기까지는 안전, 그다음부터 빨간 구간
export const safeOf = max => Math.floor(max * 0.58);

export const WHEEL = [
  { k: 'free', w: 36, label: '🎰 1~3번 자유' },
  { k: 'must3', w: 20, label: '🔥 무조건 3번!' },
  { k: 'one', w: 14, label: '😇 딱 1번만' },
  { k: 'skip', w: 12, label: '🛌 통과!' },
  { k: 'rev', w: 10, label: '🔃 거꾸로!' },
  { k: 'cool', w: 4, label: '🧊 식히기 -3' },
  { k: 'card', w: 4, label: '🎁 떠넘기기 카드 +1' },
];
const LABEL = Object.fromEntries(WHEEL.map(e => [e.k, e.label]));

// 룰렛 한 번 (둘이 남으면 거꾸로는 의미가 없어서 뺀다)
export function spin(alive, rand = Math.random) {
  const list = WHEEL.filter(e => e.k !== 'rev' || alive > 2);
  let r = rand() * list.reduce((a, e) => a + e.w, 0);
  for (const e of list) if ((r -= e.w) < 0) return e.k;
  return 'free';
}

const nextOf = (S, id) => {
  const n = S.alive.length;
  return S.alive[(S.alive.indexOf(id) + (S.dir || 1) + n) % n];
};

function play(S, now, ev, must, cap) {
  Object.assign(S, { phase: 'turn', ev, must, cap, turnEndsAt: now + (must ? TURN_TIME + Math.max(0, must - 1) * PER_FORCED : SKIP_SHOW) });
  return true;
}

function beginTurn(S, now, id) {
  const debt = S.debt || 0;
  const by = S.debtBy || null;
  Object.assign(S, { turn: id, used: 0, red: 0, turnFrom: S.puffs, turnNo: (S.turnNo || 0) + 1, pending: 0, auto: false, debt: 0, debtBy: null, by });
  if (debt) return play(S, now, 'debt', debt, debt);
  if (S.puffs >= S.safe) { // 다음 흔들기부터 위험: 룰렛
    Object.assign(S, { phase: 'spin', spinEnd: now + SPIN_TIME, ev: null, must: 1, cap: FREE_MAX });
    return true;
  }
  return play(S, now, null, 1, FREE_MAX);
}

// 룰렛 결과는 멈추는 순간에 정한다 (미리 상태에 적으면 다 보이니까)
function reveal(ctx, now) {
  const S = ctx.state;
  const k = spin(S.alive.length);
  if (k === 'skip') return play(S, now, k, 0, 0);
  if (k === 'must3') return play(S, now, k, FREE_MAX, FREE_MAX);
  if (k === 'one') return play(S, now, k, 1, 1);
  if (k === 'rev') S.dir = -(S.dir || 1);
  if (k === 'cool') {
    S.puffs = Math.max(0, S.puffs - 3);
    S.turnFrom = S.puffs;
  }
  if (k === 'card') giveCard(S, S.turn);
  return play(S, now, k, 1, FREE_MAX);
}

const giveCard = (S, id) => {
  S.cards = { ...(S.cards || {}), [id]: Math.min(MAX_CARDS, (S.cards?.[id] || 0) + 1) };
};

function startRound(ctx, now, first) {
  const S = ctx.state;
  S.round += 1;
  const max = maxOf(S.alive.length);
  const safe = safeOf(max);
  ctx.secret.burst = safe + 1 + Math.floor(Math.random() * (max - safe)); // safe+1 ~ max
  Object.assign(S, { puffs: 0, max, safe, dir: 1, prev: null, last: null, debt: 0, debtBy: null });
  return beginTurn(S, now, first);
}

function endTurn(S, now) {
  if (S.red >= FREE_MAX) { // 빨간 구간에서 3번 버팀: 카드 보상
    giveCard(S, S.turn);
    S.gain = { id: S.turn, no: S.turnNo };
  }
  S.prev = S.turn;
  return beginTurn(S, now, nextOf(S, S.turn));
}

function boom(ctx, now) {
  const S = ctx.state;
  const loser = S.turn;
  const next = nextOf(S, loser);
  const forced = S.by && S.by !== loser ? S.by : null;
  const cornered = S.turnFrom >= S.max - 1 && S.prev && S.prev !== loser ? S.prev : null;
  const killer = forced || cornered;
  S.alive = S.alive.filter(id => id !== loser);
  S.outOrder = [...(S.outOrder || []), loser];
  S.dead = { ...(S.dead || {}), [loser]: killer || '-' };
  if (killer) {
    ctx.kill(killer, loser, forced ? '🔄 떠넘기기' : '🥤 끝자리 넘기기');
    S.kills = { ...(S.kills || {}), [killer]: (S.kills?.[killer] || 0) + 1 };
  } else {
    ctx.announce(`💥 ${ctx.nameOf(loser)} 콜라 샤워!`);
  }
  S.first ||= loser;
  Object.assign(S, { phase: 'boom', phaseEndsAt: now + BOOM_TIME, pending: 0, auto: false, last: { loser, next, at: S.puffs } });
  return true;
}

function afterShake(ctx, now) {
  const S = ctx.state;
  if (S.puffs >= (ctx.secret.burst ?? S.max)) return boom(ctx, now);
  return S.used >= S.cap ? endTurn(S, now) : true;
}

function shake(ctx, now) {
  const S = ctx.state;
  S.puffs += 1;
  S.used += 1;
  if (S.puffs > S.safe) {
    S.red += 1;
    S.pending = now + TENSION; // 결과는 두근거린 뒤에
    return true;
  }
  return afterShake(ctx, now);
}

function finish(ctx) {
  const S = ctx.state;
  const placement = [...S.alive, ...[...(S.outOrder || [])].reverse()];
  for (const p of S.roster || ctx.roster) if (!placement.includes(p.id)) placement.push(p.id);
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  const top = obj => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])[0] || [];
  if (placement[0]) add(placement[0], '🥤 최후의 1인');
  const [killer, kills] = top(S.kills);
  if (kills >= 1) add(killer, `🔄 떠넘기기 장인 (${kills}킬)`);
  const [brave, n] = top(S.scares);
  if (n >= 5) add(brave, `🧊 강심장 (빨간 구간 ${n}번)`);
  if (S.first) add(S.first, '🥤 콜라 샤워 1호');
  Object.assign(S, { placement, standings: Object.fromEntries(placement.map((id, i) => [id, placement.length - i])), titles, phase: 'final', over: true });
  return true;
}

// 봇이 이번에 몇 번 흔들까: 안전 구간에선 빨간 구간 바로 앞에서 멈추려 하고, 빨간 구간에선 대개 1번 (가끔 카드 욕심)
export function planShakes(S, rand = Math.random) {
  if (S.must === S.cap) return S.must;
  if (S.puffs < S.safe) {
    const toEdge = S.safe - S.puffs;
    if (toEdge <= S.cap && rand() > SLIP) return toEdge;
    return 1 + Math.floor(rand() * S.cap);
  }
  return rand() < 0.15 ? S.cap : 1;
}

function wantDump(S, id) {
  if (!(S.cards?.[id] > 0) || !S.must) return false;
  if (S.must >= DEBT_STEP) return Math.random() < 0.7;
  if (S.puffs >= S.safe) return Math.random() < (S.puffs / S.max >= 0.85 ? 0.45 : 0.15);
  return false;
}

const BOTTLE = `<svg viewBox="-70 -150 140 235" aria-hidden="true">
  <g class="bl-b">
    <ellipse class="bl-skin" cx="0" cy="-62" rx="30" ry="38"/>
    <ellipse class="bl-shine" cx="-11" cy="-76" rx="6" ry="10"/>
    <path class="bl-skin" d="M -5 -25 L 5 -25 L 0 -18 Z"/>
  </g>
  <path class="bl-bottle" d="M -8 -20 L 8 -20 L 8 -4 C 8 8 26 12 26 30 L 26 70 Q 26 78 18 78 L -18 78 Q -26 78 -26 70 L -26 30 C -26 12 -8 8 -8 -4 Z"/>
  <rect class="bl-foam" x="-7" y="-19" width="14" height="22" rx="2"/>
  <g class="bl-fizzes">
    <circle class="bl-fizz" cx="-14" cy="72" r="2.4" style="animation-delay:0s"/>
    <circle class="bl-fizz" cx="-4" cy="74" r="1.8" style="animation-delay:.25s"/>
    <circle class="bl-fizz" cx="6" cy="72" r="2.6" style="animation-delay:.5s"/>
    <circle class="bl-fizz" cx="15" cy="74" r="2" style="animation-delay:.12s"/>
    <circle class="bl-fizz" cx="1" cy="70" r="1.6" style="animation-delay:.38s"/>
  </g>
  <rect class="bl-label" x="-26" y="40" width="52" height="22"/>
  <text class="bl-label-text" x="0" y="51">콜라</text>
  <rect class="bl-glass" x="-21" y="28" width="6" height="42" rx="3"/>
  <text class="bl-mark" x="0" y="-62"></text>
</svg>`;

export default {
  id: 'balloon',
  title: '콜라 불어라',
  emoji: '🥤',
  tag: '우정파괴',
  color: '#c0392b',
  desc: '콜라를 돌아가며 1~3번씩 흔들어 풍선을 불려요. 어디서 터질지 몰라요! 🔄 떠넘기기로 다음 사람에게 3번 더',
  minPlayers: 2,
  maxPlayers: 8,
  tickMs: 50, // 두근거리는 시간이 제때 끝나게 자주 본다 (보내는 건 바뀔 때만)

  setup(ctx, prev) {
    const ids = shuffle(ctx.roster.map(p => p.id));
    return {
      phase: 'intro',
      phaseEndsAt: ctx.now() + INTRO_TIME,
      again: !!prev,
      alive: ids, // 앉은 순서 = 차례 순서
      cards: Object.fromEntries(ids.map(id => [id, 1])),
      round: 0,
      puffs: 0,
      used: 0,
    };
  },

  onInput(ctx, { pid, type, data = {} }) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase !== 'turn' || pid !== S.turn || data.turn !== S.turnNo || S.pending || S.auto) return false;
    if (type === 'pump') return S.used < S.cap && shake(ctx, now);
    if (type === 'pass') return S.used > 0 && S.used >= S.must && endTurn(S, now);
    if (type === 'dump') {
      if (!S.must || S.used || !(S.cards?.[pid] > 0)) return false;
      S.cards = { ...S.cards, [pid]: S.cards[pid] - 1 };
      S.debt = Math.min(DEBT_MAX, (S.must >= DEBT_STEP ? S.must : 0) + DEBT_STEP);
      S.debtBy = pid;
      S.prev = pid;
      return beginTurn(S, now, nextOf(S, pid));
    }
    return false;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase === 'intro') return now >= S.phaseEndsAt && startRound(ctx, now, S.alive[0]);
    if (S.phase === 'spin') return now >= S.spinEnd && reveal(ctx, now);
    if (S.phase === 'turn') {
      if (S.pending) {
        if (now < S.pending) return false;
        S.pending = 0;
        if (S.puffs < (ctx.secret.burst ?? S.max)) S.scares = { ...(S.scares || {}), [S.turn]: (S.scares?.[S.turn] || 0) + 1 };
        return afterShake(ctx, now);
      }
      if (!S.auto && now < S.turnEndsAt + GRACE && ctx.isOnline(S.turn)) return false;
      if (S.used < S.must) { // 시간 끝: 남은 횟수는 자동으로 흔든다
        S.auto = true;
        return shake(ctx, now);
      }
      return endTurn(S, now);
    }
    if (S.phase === 'boom' && now >= S.phaseEndsAt) return S.alive.length <= 1 ? finish(ctx) : startRound(ctx, now, S.last.next);
    return false;
  },

  // 봇: 0.45~1.15초 고민하고 0.2~0.4초 간격으로 흔든다
  bot(ctx, id, mem) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase !== 'turn' || S.turn !== id || S.pending || S.auto || !S.must) return null;
    if (mem.turn !== S.turnNo) Object.assign(mem, { turn: S.turnNo, n: planShakes(S), dump: wantDump(S, id), at: now + 450 + Math.random() * 700 });
    if (now < mem.at) return null;
    mem.at = now + 200 + Math.random() * 200;
    const data = { turn: S.turnNo };
    if (mem.dump && !S.used) return { type: 'dump', data, say: Math.random() < 0.3 };
    if (S.used < mem.n) return { type: 'pump', data };
    return { type: 'pass', data, say: Math.random() < 0.06 };
  },

  mount(root, api) {
    const me = api.me;
    const head = h('div', { class: 'rx-head' });
    const status = h('div', { class: 'bl-status' });
    const banner = h('div', { class: 'bl-banner' });
    const gaugeRed = h('i', { class: 'bl-gauge-red' });
    const gaugeFill = h('i', { class: 'bl-gauge-fill' });
    const gauge = h('div', { class: 'bl-gauge' }, gaugeRed, gaugeFill);
    const big = h('div', { class: 'bl-big' });
    big.innerHTML = BOTTLE;
    const body = big.querySelector('.bl-b');
    const foam = big.querySelector('.bl-foam');
    const mark = big.querySelector('.bl-mark');
    const pips = h('div', { class: 'bl-pips' });
    const people = h('div', { class: 'bl-row' });
    const timer = h('div', { class: 'bl-timer' });
    const hint = h('div', { class: 'rx-sub bl-hint' });
    const board = h('div', { class: 'rx-board' });
    const pad = h('div', { class: 'rx-pad bl-pad' }, h('div', { class: 'bl-main' }, status, banner, gauge, big, pips, people, timer, hint), board);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'rx bl' }, h('div', { class: 'rx-main' }, head, pad), side));
    document.activeElement?.blur?.();

    let S = null;
    let sent = { turn: -1, n: 0, done: false }; // 이번 차례에 내가 보낸 것 (방장 답이 오기 전에도 바로 보이게)
    let lastText = '';
    let bannerKey = '';
    let peopleKey = '';
    let pipsKey = '';
    let timerKey = '';
    let seenBoom = 0;
    let seenGain = null;
    let wasPending = false;
    let lastBoard = '';
    let reel = -1;
    const who = id => S.roster.find(p => p.id === id) || { id, name: '?' };
    const isPlayer = () => S?.roster.some(p => p.id === me);
    const myCards = () => S?.cards?.[me] || 0;
    const extraOf = () => (S.phase === 'turn' && S.turn === me && sent.turn === S.turnNo ? Math.max(0, sent.n - (S.used || 0)) : 0);
    const shownPuffs = () => Math.min(S.max || TOP, (S.puffs || 0) + extraOf());

    function onKey(e) {
      if (isTyping(e) || !S) return;
      const c = e.code;
      const pump = c === 'Space';
      const pass = c === 'ArrowDown' || c === 'KeyS';
      const dump = c === 'ArrowUp' || c === 'KeyW';
      if (!pump && !pass && !dump) return;
      if (c !== 'KeyS' && c !== 'KeyW') e.preventDefault(); // 스페이스·방향키로 페이지가 스크롤되지 않게
      if (e.repeat || S.phase !== 'turn' || S.turn !== me || S.pending || S.auto) return;
      if (sent.turn !== S.turnNo) sent = { turn: S.turnNo, n: 0, done: false };
      if (sent.done) return;
      const seen = S.used || 0;
      const count = Math.max(sent.n, seen);
      if (pump) {
        if (count >= S.cap) return;
        if (sent.n > seen && shownPuffs() >= S.safe) return; // 빨간 구간은 한 번에 하나씩 (결과를 보고 다음 걸 누른다)
        sent.n = count + 1;
        api.send('pump', { turn: S.turnNo });
        float('+1', 'plus');
      } else if (pass) {
        if (!count || count < S.must) return;
        sent.done = true;
        api.send('pass', { turn: S.turnNo });
      } else {
        if (count || !S.must || !myCards()) return;
        sent.done = true;
        api.send('dump', { turn: S.turnNo });
      }
      draw();
    }
    window.addEventListener('keydown', onKey);

    function float(text, cls = '') {
      const el = h('i', { class: `bl-float ${cls}` }, text);
      big.append(el);
      setTimeout(() => el.remove(), 800);
    }

    function explode() {
      const loser = S.last?.loser;
      pad.classList.remove('shaking');
      void pad.offsetWidth;
      pad.classList.add('shaking');
      setTimeout(() => pad.classList.remove('shaking'), 520);
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 120 + Math.random() * 220;
        const drop = h('i', { class: 'bl-drop', style: `--dx:${Math.round(Math.cos(a) * r)}px;--dy:${Math.round(Math.sin(a) * r - 40)}px;--s:${(0.6 + Math.random() * 1).toFixed(2)}` });
        big.append(drop);
        setTimeout(() => drop.remove(), 900);
      }
      const mine = loser === me;
      const splash = h('div', { class: `bl-splash${mine ? ' me' : ''}` }, mine ? h('b', {}, '콜라 범벅 🥤') : null);
      pad.append(splash);
      setTimeout(() => splash.remove(), mine ? 2600 : 1300);
    }

    function drawPeople() {
      const after = S.phase === 'turn' || S.phase === 'spin' ? nextOf(S, S.turn) : null;
      const rows = [...S.alive, ...(S.outOrder || [])].map(id => {
        const out = !S.alive.includes(id);
        const now = !out && (S.phase === 'turn' || S.phase === 'spin') && S.turn === id;
        return [id, out ? ' out' : now ? ' now' : id === after ? ' next' : '', out ? 0 : S.cards?.[id] || 0];
      });
      const key = JSON.stringify(rows);
      if (key === peopleKey) return;
      peopleKey = key;
      people.replaceChildren(...rows.map(([id, cls, n]) => h('span', { class: `nc-chip bl-chip${cls}${id === me ? ' me' : ''}` },
        avatar(who(id)), who(id).name, n ? h('i', { class: 'bl-card' }, '🔄'.repeat(n)) : null)));
    }

    function drawBanner() {
      let text = '';
      let cls = '';
      if (S.phase === 'turn') {
        if (S.ev === 'debt') {
          text = `🔄 ${josa(who(S.by).name, '이', '가')} 떠넘김! 무조건 ${S.must}번`;
          cls = 'hot';
        } else if (S.ev) {
          text = LABEL[S.ev];
          cls = S.ev === 'must3' ? 'hot' : ['one', 'skip', 'cool', 'card'].includes(S.ev) ? 'calm' : '';
        } else if (!S.puffs) text = '🥤 새 콜라!';
      }
      const key = `${S.turnNo}|${text}`;
      if (key === bannerKey || S.phase === 'spin') return;
      bannerKey = key;
      banner.textContent = text;
      banner.className = `bl-banner ${cls}`;
    }

    function draw() {
      if (!S) return;
      const mine = S.phase === 'turn' && S.turn === me;
      const max = S.max || TOP;
      const n = shownPuffs();
      const used = (S.used || 0) + extraOf();
      const boomed = S.phase === 'boom';
      const f = Math.min(1, n / max);
      const red = !boomed && S.phase !== 'intro' && S.phase !== 'final' && n >= (S.safe ?? max);
      const hot = red && f >= 0.85;
      // 0번 → 0.4배, 끝 → 1.6배(위 막대를 가리지 않는 크기). 빨간 구간부터 떨리고 끝이 가까우면 많이 떨린다
      body.style.transform = `scale(${boomed ? 0.05 : (0.4 + f * 1.2).toFixed(3)})`;
      foam.style.transform = `scaleY(${Math.max(0.05, f).toFixed(3)})`;
      big.style.setProperty('--fizz', (0.2 + f * 0.8).toFixed(2));
      big.classList.toggle('w1', red);
      big.classList.toggle('w2', hot);
      big.classList.toggle('tense', !!S.pending);
      mark.textContent = boomed ? '💥' : '';
      pad.classList.toggle('red', red && !hot);
      pad.classList.toggle('hot', hot);
      const color = S.turn ? who(S.turn).color : '';
      if (/^#[0-9a-f]{6}$/i.test(color || '')) big.style.setProperty('--c', color); // 지금 차례인 사람 색
      gaugeFill.style.width = `${(f * 100).toFixed(1)}%`;
      gaugeRed.style.width = `${(1 - (S.safe ?? max) / max) * 100}%`;
      // 이번 차례에 흔든 횟수 점
      const show = S.phase === 'turn' && S.cap > 0;
      const pk = show ? `${S.turnNo}:${S.cap}:${used}` : '';
      if (pk !== pipsKey) {
        pipsKey = pk;
        pips.replaceChildren(...(show ? Array.from({ length: S.cap }, (_, i) => h('i', { class: i < used ? 'on' : i < S.must ? 'must' : '' })) : []));
      }
      drawBanner();
      let text = '';
      let sub = '';
      if (S.phase === 'intro') {
        text = '🥤 콜라 불어라';
        sub = S.again ? '🔁 한 판 더!' : '돌아가며 1~3번 흔들기. 터뜨리면 탈락!';
      } else if (S.phase === 'spin') {
        text = `${n} / ${max}`;
        sub = S.turn === me ? '🎰 두구두구…' : `${who(S.turn).name} 룰렛 돌리는 중`;
      } else if (S.phase === 'turn') {
        text = `${n} / ${max}`;
        if (S.pending) sub = '두근…';
        else if (!S.must) sub = S.turn === me ? '🛌 이번엔 쉬어요' : `${who(S.turn).name} 통과`;
        else if (mine) {
          const left = S.must - used;
          const card = myCards() && !used ? ' · ↑ (W) 🔄 떠넘기기' : '';
          if (left > 0) sub = S.cap > S.must ? `내 차례! 스페이스 1~${S.cap}번${card}` : `스페이스 ${left}번!${card}`;
          else if (used < S.cap) sub = `↓ (S) = 넘기기 · 스페이스 ${S.cap - used}번 더${red ? ' · 3번 버티면 🔄 +1' : ''}`;
        } else {
          sub = `${who(S.turn).name} 차례${nextOf(S, S.turn) === me ? ' · 😰 다음은 나!' : ''}`;
        }
      } else if (boomed) {
        const { loser, next, at } = S.last || {};
        text = `💥 ${who(loser).name} 콜라 샤워!`;
        sub = `${at}번째에서 터짐 · ☠️ 탈락${S.alive.length > 1 ? ` · 다음은 ${who(next).name}부터` : ''}`;
      }
      const key = `${text}|${sub}`;
      if (key !== lastText) {
        lastText = key;
        status.textContent = text;
        hint.textContent = sub;
      }
    }

    // 룰렛 도는 동안만 글자를 돌린다
    function paint() {
      if (S?.phase !== 'spin') return;
      const i = Math.floor(api.now() / 75) % WHEEL.length;
      if (i === reel) return;
      reel = i;
      banner.textContent = WHEEL[i].label;
      banner.className = 'bl-banner spin';
      bannerKey = '';
    }
    let raf = requestAnimationFrame(function loop() {
      paint();
      raf = requestAnimationFrame(loop);
    });

    function finalBoard() {
      return h('div', { class: 'rx-result' },
        h('h2', { class: 'display' }, `🥤 ${who(S.placement?.[0]).name} 최후의 1인!`),
        podium(S.roster, S.standings, me));
    }

    return {
      update({ state }) {
        S = state;
        const alive = S.alive.includes(me);
        head.replaceChildren(
          h('span', {}, S.round ? `라운드 ${S.round} · 생존 ${S.alive.length}명${S.dir < 0 ? ' · 🔃 거꾸로' : ''}` : '곧 시작해요'),
          h('span', {}, alive ? `🔄 떠넘기기 ${myCards()}장` : isPlayer() ? '👻 구경 중' : '👀 관전 중'));
        pad.classList.toggle('board', S.phase === 'final');
        if (S.phase === 'final' && lastBoard !== 'final') {
          lastBoard = 'final';
          board.replaceChildren(finalBoard());
        }
        if (S.phase === 'boom' && seenBoom !== S.round) {
          seenBoom = S.round;
          explode();
        }
        if (wasPending && !S.pending && S.phase !== 'boom' && S.phase !== 'final') float(pick(['휴…', '살았다!', '아슬아슬!']));
        wasPending = !!S.pending;
        if (seenGain === null) seenGain = S.gain?.no ?? 0;
        if (S.gain && S.gain.no !== seenGain) {
          seenGain = S.gain.no;
          float(`🔄 +1 ${who(S.gain.id).name}`, 'gain');
        }
        const tKey = S.phase === 'turn' && S.must ? `t${S.turnNo}` : '';
        if (tKey !== timerKey) {
          timerKey = tKey;
          timer.replaceChildren(...(tKey ? [countdown(S.turnEndsAt, S.turnEndsAt - api.now())] : []));
        }
        drawPeople();
        const out = S.outOrder || [];
        side.replaceChildren(...[
          h('h3', {}, `생존 ${S.alive.length}명`),
          h('div', { class: 'tc-alive' }, S.alive.map(id => h('span', { class: 'tc-alive-chip' }, avatar(who(id)), who(id).name))),
          out.length ? h('h3', {}, '독박 기록') : null,
          out.length ? h('ul', { class: 'rules' }, out.map(id => {
            const by = S.dead?.[id];
            return h('li', {}, h('b', {}, who(id).name), by && by !== '-' ? ` ← ${josa(who(by).name, '이', '가')} 떠넘김` : ' 💥 콜라 샤워');
          })) : null,
          h('h3', {}, '조작'),
          h('ul', { class: 'rules' },
            h('li', {}, '스페이스 = 흔들기 (1~3번)'),
            h('li', {}, '↓ (S) = 다음 사람에게 넘기기 (3번 흔들면 자동)'),
            h('li', {}, `↑ (W) = 🔄 떠넘기기: 내 차례를 건너뛰고 다음 사람이 ${DEBT_STEP}번 더 (겹치면 +${DEBT_STEP})`)),
          h('h3', {}, '규칙'),
          h('ul', { class: 'rules' },
            h('li', {}, '빨간 구간부터 어디서 터질지 몰라요. 끝까지 가면 무조건 펑'),
            h('li', {}, '빨간 구간의 차례는 🎰 룰렛으로 시작해요'),
            h('li', {}, '빨간 구간에서 3번 버티면 🔄 카드 +1 (최대 2장)'),
            h('li', {}, `${TURN_TIME / 1000}초 안에 안 흔들면 자동으로 흔들어요`),
            h('li', {}, '터뜨리면 탈락, 마지막 1명 우승')),
        ].filter(Boolean));
        draw();
      },
      unmount() {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
      },
    };
  },
};
