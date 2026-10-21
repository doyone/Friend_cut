import { digitOf, h, isTyping } from './util.js';

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };
const INK = '#2c3e50';
export const FACE_COUNT = 20;

// 다른 사람이 보낸 값이 SVG 문자열에 그대로 들어가지 않도록, 색은 #rrggbb만 허용한다.
const safeColor = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#bdc3c7');
const hashStr = s => [...String(s)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7) >>> 0;

function eye(cx, cy, r, pr, dx = 0, dy = 0) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="${INK}" stroke-width="4"/>`
    + `<circle cx="${cx + dx}" cy="${cy + dy}" r="${pr}" fill="${INK}"/>`;
}
const line = d => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;

const EYES = [
  () => eye(35, 42, 9, 3.5) + eye(65, 42, 9, 3.5),
  () => eye(34, 40, 12, 4, 1, 1) + eye(66, 45, 7, 3, -1, 0),
  () => line('M26 44 q9 -9 18 0') + line('M56 44 q9 -9 18 0'),
  () => eye(35, 42, 9, 3.5, 3.5, 1) + eye(65, 42, 9, 3.5, -3.5, 1),
  () => eye(35, 42, 10, 3, 0, -4) + eye(65, 42, 10, 3, 0, -4) + line('M24 28 l18 6') + line('M76 28 l-18 6'),
];
const MOUTHS = [
  () => line('M34 64 q16 14 32 0'),
  () => line('M38 69 h24'),
  () => `<ellipse cx="50" cy="69" rx="7" ry="9" fill="${INK}"/>`,
  () => `<rect x="31" y="61" width="38" height="14" rx="5" fill="#fff" stroke="${INK}" stroke-width="4"/>`
    + `<path d="M41 61v14M50 61v14M59 61v14" stroke="${INK}" stroke-width="3"/>`,
  () => line('M34 62 q16 12 32 0') + `<path d="M44 67 q6 11 12 0" fill="#e74c3c" stroke="${INK}" stroke-width="3"/>`,
];

// 꼴찌 스티커: 얼굴(100x100 좌표) 위에 덧그린다. 1등을 해야 떨어진다.
export const STICKERS = [
  { id: 'clown', label: '광대 코', emoji: '🤡',
    svg: `<circle cx="50" cy="56" r="9" fill="#e74c3c" stroke="${INK}" stroke-width="3"/><circle cx="47" cy="53" r="2.5" fill="#fff" opacity=".7"/>` },
  { id: 'mustache', label: '콧수염', emoji: '🥸',
    svg: `<path d="M50 60c-6-6-16-6-22 2c6 0 10 4 22 0c12 4 16 0 22 0c-6-8-16-8-22-2z" fill="${INK}"/>` },
  { id: 'blackeye', label: '멍', emoji: '🤕',
    svg: `<circle cx="35" cy="42" r="15" fill="none" stroke="#8e44ad" stroke-width="7" opacity=".7"/>` },
  { id: 'bandage', label: '반창고', emoji: '🩹',
    svg: `<g stroke="${INK}" stroke-width="2.5" fill="#f5cba7"><rect x="58" y="16" width="30" height="11" rx="5" transform="rotate(-30 73 21)"/><rect x="58" y="16" width="30" height="11" rx="5" transform="rotate(30 73 21)"/></g>` },
  { id: 'dunce', label: '바보 모자', emoji: '🎉',
    svg: `<path d="M33 12L50-30L67 12Z" fill="#f1c40f" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><text x="50" y="4" font-size="12" font-weight="900" text-anchor="middle" fill="${INK}">바보</text>` },
  { id: 'poop', label: '똥 머리', emoji: '💩', svg: '<text x="50" y="14" font-size="36" text-anchor="middle">💩</text>' },
  { id: 'snot', label: '콧물', emoji: '🤧',
    svg: `<path d="M46 57q-3 14 3 20q6-6 3-20z" fill="#7fd3f5" stroke="${INK}" stroke-width="2.5"/>` },
  { id: 'hogu', label: '이마에 호구', emoji: '✍️',
    svg: '<text x="50" y="27" font-size="16" font-weight="900" text-anchor="middle" fill="#c0392b" transform="rotate(-10 50 22)">호구</text>' },
];
const STICKER_BY_ID = Object.fromEntries(STICKERS.map(s => [s.id, s]));
export const stickerInfo = id => STICKER_BY_ID[id];

// 누가 어떤 스티커를 달고 있는지는 방 정보에 있다. main.js가 연결해 준다.
let stickerSource = () => [];
export function setStickerSource(fn) {
  stickerSource = fn;
}

export function faceSvg(color, seed, stickers = []) {
  const n = Math.abs(Math.floor(Number(seed) || 0));
  const extra = stickers.map(id => STICKER_BY_ID[id]?.svg || '').join('');
  return `<svg viewBox="0 0 100 100" overflow="visible" aria-hidden="true"><circle cx="50" cy="50" r="45" fill="${safeColor(color)}" stroke="${INK}" stroke-width="6"/>`
    + EYES[n % EYES.length]() + MOUTHS[Math.floor(n / EYES.length) % MOUTHS.length]() + extra + '</svg>';
}

export function avatar(p, cls = '') {
  const el = h('span', { class: `avatar ${cls}`, title: p?.name || '', 'data-pid': p?.id || null });
  let stickers = p?.stickers ?? (p?.id ? stickerSource(p.id) : []);
  if (!Array.isArray(stickers)) stickers = [];
  el.innerHTML = faceSvg(p?.color, p?.face ?? hashStr(p?.id || ''), stickers);
  return el;
}

const ICONS = {
  users: '<path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16.5 11a3 3 0 1 0 0-6M17.5 14c2.4.4 4 2.6 4 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3.6-3.6a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3.6 3.6a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  exit: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 16l-4-4 4-4M5 12h11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  dice: '<rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="8.5" cy="8.5" r="1.6" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>',
};

export function icon(name) {
  const el = h('span', { class: 'ico' });
  el.innerHTML = `<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return el;
}

export function nameTag(p, me) {
  return h('span', { class: 'name-tag' },
    avatar(p),
    h('span', { class: 'nm' }, p?.name || '(나간 사람)'),
    p && p.id === me ? h('em', { class: 'me-badge' }, '나') : null);
}

// 동점이면 같은 등수 (1, 1, 3 ...)
export function ranking(roster, scores = {}) {
  const rows = roster.map(p => ({ p, score: scores[p.id] || 0 })).sort((a, b) => b.score - a.score);
  for (const r of rows) r.rank = 1 + rows.filter(o => o.score > r.score).length;
  return rows;
}

export function scoreboard(roster, scores, me, deltas) {
  return h('ol', { class: 'scoreboard' }, ranking(roster, scores).map(({ p, score, rank }) => {
    const d = deltas?.[p.id] || 0;
    return h('li', { class: p.id === me ? 'me' : '' },
      h('span', { class: 'rank' }, rank),
      nameTag(p, me),
      d ? h('span', { class: `delta ${d > 0 ? 'up' : 'down'}` }, d > 0 ? `+${d}` : d) : null,
      h('b', { class: 'pts' }, score));
  }));
}

export function podium(roster, scores, me) {
  return h('ol', { class: 'podium' }, ranking(roster, scores).map(({ p, score, rank }) =>
    h('li', { class: `r${rank}${p.id === me ? ' me' : ''}` },
      h('span', { class: 'medal' }, MEDALS[rank] || rank),
      nameTag(p, me),
      h('b', {}, `${score}점`))));
}

// data-ends(서버 시각)까지 남은 시간을 전역 타이머가 계속 갱신한다.
// 화면을 다시 그리며 새로 만들어도 꽉 찼다가 줄어드는 깜빡임이 없게, 만들 때부터 지금 값으로 칠한다.
let clock = () => Date.now();

function paintCountdown(el, t) {
  const left = Math.max(0, Number(el.dataset.ends) - t);
  const total = Number(el.dataset.total) || 1;
  el.querySelector('i').style.transform = `scaleX(${Math.min(1, left / total)})`;
  el.querySelector('span').textContent = `${Math.ceil(left / 1000)}초`;
  el.classList.toggle('urgent', left < 5000);
}

export function countdown(endsAt, totalMs) {
  const el = h('div', { class: 'countdown', 'data-ends': endsAt, 'data-total': totalMs },
    h('div', { class: 'track' }, h('i')),
    h('span'));
  paintCountdown(el, clock());
  return el;
}

export function startTimerLoop(now) {
  clock = now;
  setInterval(() => {
    const t = now();
    for (const el of document.querySelectorAll('.countdown[data-ends]')) paintCountdown(el, t);
  }, 100);
}

// 마우스 없이 고르기: 방향키로 옮기고 스페이스로 누른다. 숫자키 1~9로 바로 누를 수도 있다.
// 버튼들이 화면에서 사라지면 다음 키 입력 때 스스로 해제된다.
export function keyNav(buttons, { numbers = true, space = true } = {}) {
  let i = Math.max(0, buttons.findIndex(b => !b.disabled));
  const mark = () => buttons.forEach((b, k) => b.classList.toggle('kfocus', k === i));
  if (numbers) buttons.slice(0, 9).forEach((b, k) => b.prepend(h('kbd', { class: 'num' }, String(k + 1))));
  mark();
  const press = k => {
    const b = buttons[k];
    if (b && !b.disabled) b.click();
  };
  // 한 줄에 몇 개 있는지는 실제 배치를 보고 센다 (위아래 이동용)
  const perRow = () => {
    const top = buttons[0].offsetTop;
    return Math.max(1, buttons.filter(b => b.offsetTop === top).length);
  };
  function onKey(e) {
    if (!buttons[0]?.isConnected) return destroy();
    if (isTyping(e)) return;
    const n = buttons.length;
    const d = numbers ? digitOf(e) : 0;
    if (e.code === 'ArrowRight') i = (i + 1) % n;
    else if (e.code === 'ArrowLeft') i = (i - 1 + n) % n;
    else if (e.code === 'ArrowDown') i = Math.min(n - 1, i + perRow());
    else if (e.code === 'ArrowUp') i = Math.max(0, i - perRow());
    else if (e.code === 'Space') {
      if (!space) return; // 스페이스를 다른 뜻(예: '안 씀')으로 쓰는 화면
      if (!e.repeat) press(i);
    }
    else if (d && d <= n) { i = d - 1; press(i); }
    else return;
    e.preventDefault();
    mark();
  }
  function destroy() {
    window.removeEventListener('keydown', onKey);
  }
  window.addEventListener('keydown', onKey);
  return { destroy };
}
