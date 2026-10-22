// 교수님 몰래 게임하기 화면: 교실(칠판·교수님·학생 자리) + 내 기록 + 순위.
// 누르는 중이면 0.4초마다 방장에게 다시 알려 주고(끊긴 탭 방지), 누름·뗌에는 내 화면 시계(api.now)를 같이 보낸다.
import { h, isTyping } from '../util.js';
import { avatar } from '../ui.js';
import { canSnitchAt } from './professor.js';

const REFRESH = 400;        // 누르는 중 다시 알려 주는 간격 (방장 쪽 유효시간 1.2초)
const SNITCH_SHOW = 1500;   // 고자질 말풍선 보여 주는 시간

const teacherArt = `<svg viewBox="0 0 160 205" aria-hidden="true">
  <ellipse cx="80" cy="194" rx="51" ry="8" fill="#263a4026"/>
  <path d="M51 178v17h21v-25m17 0v25h22v-17" fill="#263747" stroke="#243541" stroke-width="4"/>
  <path d="M45 91Q80 75 115 91l10 85H35Z" fill="#466780" stroke="#263747" stroke-width="4"/>
  <g class="pr-prof-back">
    <path d="M44 101L22 75l-6-30" fill="none" stroke="#466780" stroke-width="19" stroke-linecap="round"/>
    <circle cx="16" cy="43" r="9" fill="#f2c9a7" stroke="#263747" stroke-width="3"/>
    <path d="M11 36l-7-9" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
    <ellipse cx="80" cy="53" rx="35" ry="39" fill="#3a3537" stroke="#263747" stroke-width="4"/>
    <path d="M52 26q27-19 55 4M54 35q24-12 49-1" fill="none" stroke="#777073" stroke-width="4"/>
    <path d="M111 109l16 42" stroke="#466780" stroke-width="18" stroke-linecap="round"/>
    <circle cx="127" cy="153" r="9" fill="#f2c9a7"/>
    <path d="M56 99q24 9 48 0M80 111v55" fill="none" stroke="#7390a3" stroke-width="3"/>
  </g>
  <g class="pr-prof-front">
    <path d="M62 87l18 31 18-31" fill="#fff" stroke="#263747" stroke-width="3"/>
    <path d="M76 102h8l5 42-9 10-9-10Z" fill="#d95c4c"/>
    <path d="M45 108L27 137m88-29l21 22" stroke="#466780" stroke-width="18" stroke-linecap="round"/>
    <circle cx="27" cy="140" r="9" fill="#f2c9a7"/>
    <path d="M131 129l12-27" stroke="#f2c9a7" stroke-width="12" stroke-linecap="round"/>
    <ellipse cx="80" cy="51" rx="34" ry="38" fill="#f2c9a7" stroke="#263747" stroke-width="4"/>
    <path d="M46 43Q43 4 80 9q37-1 35 35l-13-20q-18 14-43 5l-8 16Z" fill="#3a3537"/>
    <g fill="#fff" stroke="#263747" stroke-width="3"><rect x="51" y="43" width="25" height="20" rx="6"/><rect x="84" y="43" width="25" height="20" rx="6"/><path d="M76 49h8"/></g>
    <circle cx="66" cy="53" r="4" fill="#263747"/><circle cx="94" cy="53" r="4" fill="#263747"/>
    <path d="M54 36l18 4m16 0 18-4M70 76q10-10 20 0" fill="none" stroke="#263747" stroke-width="4" stroke-linecap="round"/>
  </g>
</svg>`;

const sec = ms => `${((ms || 0) / 1000).toFixed(2)}초`;

export function mountProfessor(root, api) {
  const me = api.me;
  const timer = h('strong', { class: 'pr-timer' }, '30.0초');
  const status = h('span', { class: 'pr-status' }, '수업 준비 중');
  const live = h('span', { class: 'pr-live' });
  const board = h('div', { class: 'pr-blackboard' },
    h('b', {}, '컴퓨터 개론'),
    h('span', { class: 'pr-equation' }, '집중력 = 성적²'),
    h('span', { class: 'pr-chalk' }, '오늘의 주제: 멀티태스킹은 가능한가?'));
  const teacher = h('div', { class: 'pr-professor' });
  teacher.innerHTML = teacherArt;
  const speech = h('div', { class: 'pr-speech', role: 'status' });
  const front = h('div', { class: 'pr-front' }, board, h('div', { class: 'pr-wall-clock' }, '◷'), teacher, speech);
  const students = h('div', { class: 'pr-students' });
  const overlay = h('div', { class: 'pr-overlay' });
  const classroom = h('div', { class: 'pr-classroom' }, front, students, overlay);
  const ownScore = h('strong', {}, sec(0));
  const instruction = h('span', {}, '스페이스를 누르는 동안만 기록돼요');
  const holdLabel = h('span', {}, ' 꾹 눌러 몰래 게임');
  const holdButton = h('button', { class: 'pr-hold', type: 'button', tabindex: '-1' }, h('kbd', {}, 'SPACE'), holdLabel);
  const side = h('aside', { class: 'side pr-side' });
  const layout = h('div', { class: 'pr-layout' },
    h('section', { class: 'pr-main' },
      h('div', { class: 'pr-top' }, status, live, timer),
      classroom,
      h('div', { class: 'pr-controls' }, h('div', { class: 'pr-my-score' }, h('small', {}, '내 몰래 게임 기록'), ownScore), holdButton, instruction)),
    side);
  root.append(layout);
  document.activeElement?.blur?.();

  let S = null;
  let held = false;
  let seq = 0;
  let raf = 0;
  let lastSent = 0;
  let overlayKey = '';
  let rosterKey = '';
  let sideKey = '';
  const seats = new Map();
  const scoreRows = new Map();
  const alive = () => (S?.alive || []).includes(me);
  const canPlay = () => S?.phase === 'play' && alive();
  // 걸린 사람: 아직 고자질 안 썼고, 칠판으로 돌아선 지 1.6초가 지났고, 방금 누가 고자질하지 않았으면
  const ghost = () => S?.phase === 'play' && !!S.caught?.[me] && !S.snitched?.[me];
  const canSnitch = () => !!S && canSnitchAt(S, me, api.now());
  const snitching = () => !!S?.snitch && api.now() - S.snitch.at < SNITCH_SHOW;

  function send(down) {
    if (!S) return;
    seq = Math.max(seq, S.seq?.[me] || 0) + 1;
    api.send('hold', { down, seq, run: S.run, t: api.now() });
    lastSent = performance.now();
  }
  function press(e) {
    if (e?.button > 0) return;
    if (canSnitch()) {
      e?.preventDefault();
      api.send('snitch', { run: S.run });
      return;
    }
    if (!canPlay() || held) return;
    e?.preventDefault();
    held = true;
    send(true);
  }
  function release() {
    if (!held) return;
    held = false;
    if (canPlay()) send(false);
  }
  function onKey(e) {
    if (isTyping(e)) {
      release();
      return;
    }
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (e.type === 'keyup') release();
    else if (!e.repeat) press();
  }
  // 다른 창으로 가거나 채팅을 열면 손을 뗀 걸로
  const onVisibility = () => { if (document.hidden) release(); };
  const onFocus = e => { if (isTyping(e)) release(); };
  holdButton.addEventListener('pointerdown', press);
  holdButton.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('focusin', onFocus);

  function makeSeats() {
    const key = S.roster.map(p => `${p.id}:${p.name}`).join('|');
    if (key === rosterKey) return;
    rosterKey = key;
    seats.clear();
    students.replaceChildren();
    students.style.setProperty('--pr-cols', Math.min(4, S.roster.length));
    for (const p of S.roster) {
      const grade = h('div', { class: 'pr-grade', 'aria-label': 'C+ 탈락' }, 'C+');
      const score = h('span', { class: 'pr-seat-time' }, sec(0));
      const screen = h('div', { class: 'pr-screen' }, h('i'), h('i'), h('i'), h('span', {}, '필기 중'));
      const laptop = h('div', { class: 'pr-laptop' }, screen, h('div', { class: 'pr-keyboard' }));
      const bubble = h('div', { class: 'pr-snitch' }, '🙋 교수님! 쟤네 게임해요!');
      const seat = h('div', { class: `pr-seat${p.id === me ? ' me' : ''}` },
        h('div', { class: 'pr-chair' }), h('div', { class: 'pr-student-body' }), h('div', { class: 'pr-face' }, avatar(p, 'lg')),
        h('div', { class: 'pr-desk' }), laptop, grade, bubble,
        h('div', { class: 'pr-name' }, p.name, p.id === me ? ' (나)' : ''), score);
      students.append(seat);
      seats.set(p.id, { seat, screen, score, grade, caughtAt: null });
    }
  }

  function renderSide() {
    const isAlive = id => ((S.alive || []).includes(id) ? 1 : 0);
    const order = [...S.roster].sort((a, b) => isAlive(b.id) - isAlive(a.id) || (S.scores?.[b.id] || 0) - (S.scores?.[a.id] || 0));
    const key = order.map(p => `${p.id}:${!!S.caught?.[p.id]}:${!!S.snitched?.[p.id]}`).join('|');
    if (key === sideKey) return;
    sideKey = key;
    scoreRows.clear();
    const rows = order.map((p, i) => {
      const time = h('b', {}, sec(0));
      scoreRows.set(p.id, time);
      return h('li', { class: S.caught?.[p.id] ? 'caught' : p.id === me ? 'me' : '' },
        h('small', {}, S.caught?.[p.id] ? 'C+' : String(i + 1)), avatar(p), h('span', {}, p.name, S.snitched?.[p.id] ? ' 🙋' : ''), time);
    });
    side.replaceChildren(
      h('h3', {}, '몰래 게임 기록'),
      h('ol', { class: 'pr-ranking' }, rows),
      h('h3', {}, '걸리면 C+'),
      h('ul', { class: 'rules' },
        h('li', {}, '스페이스를 꾹 누르면 시간 누적, 떼면 공부하는 척'),
        h('li', {}, '교수님은 예고 없이 돌아봄 — 그때 누르고 있으면 즉시 C+'),
        h('li', {}, '칠판으로 돌아선 직후 1.6초는 안전'),
        h('li', {}, '걸린 사람은 스페이스 = 🙋 고자질 한 번 (0.7초 뒤 교수님이 돌아봄, 돌아선 직후 1.6초엔 못 씀)'),
        h('li', {}, '30초 뒤 살아남은 사람 중 기록이 가장 긴 사람이 승리')),
      h('p', { class: 'pr-luck-note' }, '🎲 반응속도 싸움이 아니에요. 돌아선 직후에 몰아서 할지, 조금 더 욕심낼지 눈치 싸움!'),
      h('p', { class: 'muted small' }, '전원 C+면 우승자 없이 바로 끝나요'));
  }

  function renderOverlay() {
    const key = `${S.phase}:${S.allCaught}:${JSON.stringify(S.standings || {})}`;
    if (key === overlayKey) return;
    overlayKey = key;
    overlay.replaceChildren();
    if (S.phase === 'intro') {
      overlay.append(h('div', { class: 'pr-rule-card' },
        h('small', {}, '30초 동안 · 눈치 싸움'),
        h('h2', {}, '교수님 몰래\n게임하기'),
        h('p', {}, '교수님이 칠판을 보는 동안'),
        h('strong', {}, 'SPACE 꾹 → 몰래 게임!'),
        h('p', {}, '예고 없이 돌아볼 때 누르고 있으면'),
        h('b', { class: 'pr-rule-grade' }, 'C+ 즉시 탈락'),
        h('p', {}, '걸리면 🙋 고자질 한 번 (스페이스)'),
        h('span', { class: 'pr-intro-count' }, '곧 수업 시작')));
    }
    if (S.phase === 'result' || S.phase === 'final') {
      const best = Math.max(0, ...Object.values(S.standings || {}));
      const winners = S.roster.filter(p => best > 0 && S.standings?.[p.id] === best);
      overlay.append(h('div', { class: 'pr-result-card', role: 'status' },
        h('small', {}, S.allCaught ? '교수님: 자네들, 내 수업 재미없나?' : '딩동댕! 수업 종료'),
        h('h2', {}, S.allCaught ? '전원 C+ 💀' : `${winners.map(p => p.name).join(' · ')} 승리!`),
        h('p', {}, S.allCaught ? '이번 수업은 우승자 없이 끝났어요.' : `끝까지 안 들키고 ${sec(Math.max(0, ...winners.map(p => S.scores[p.id] || 0)))} 게임 성공!`)));
    }
  }

  // 누르는 중 재전송은 화면 그리기와 따로 (브라우저가 그리기를 멈춰도 계속 누른 걸로)
  const refresher = setInterval(() => {
    if (held && canPlay() && performance.now() - lastSent >= REFRESH - 20) send(true);
  }, 100);

  function paint() {
    raf = requestAnimationFrame(paint);
    if (!S) return;
    const t = api.now();
    const active = S.phase === 'play';
    const watching = active && S.look === 'watch';
    const snitch = active && snitching() ? S.snitch : null;
    layout.classList.toggle('watching', watching);
    classroom.classList.toggle('pr-watching', watching);
    timer.textContent = S.phase === 'intro'
      ? `${Math.max(0, Math.ceil((S.introUntil - t) / 1000))}초 후 시작`
      : `${(Math.max(0, (S.endAt || t) - (active ? t : S.endedAt || t)) / 1000).toFixed(1)}초`;
    timer.classList.toggle('urgent', active && S.endAt - t < 5000);
    status.textContent = !active ? (S.phase === 'intro' ? '수업 준비 중' : '수업 종료')
      : watching ? '👀 교수님이 보고 있다!' : snitch ? '🙋 고자질이다! 손 떼!' : '✍️ 교수님 수업 중';
    live.textContent = `생존 ${(S.alive || []).length} / ${S.roster.length}`;
    speech.textContent = watching ? '지금… 뭐 하는 거지?' : snitch ? '응? 누가 게임을 해?' : '이 내용은 시험에 나옵니다.';
    for (const p of S.roster) {
      const v = seats.get(p.id);
      if (!v) continue;
      const dead = !!S.caught?.[p.id];
      const gaming = active && !dead && (p.id === me ? held : (S.holds?.[p.id] || 0) > t);
      v.seat.classList.toggle('gaming', gaming);
      v.seat.classList.toggle('caught', dead);
      v.seat.classList.toggle('snitching', snitch?.by === p.id);
      v.screen.lastElementChild.textContent = dead ? '들켰다…' : gaming ? 'PLAY!' : '필기 중';
      const score = sec(S.scores?.[p.id]);
      v.score.textContent = score;
      const row = scoreRows.get(p.id);
      if (row) row.textContent = score;
      // 방금 걸렸으면 C+ 도장이 쿵
      if (dead && v.caughtAt !== S.caught[p.id]) {
        v.caughtAt = S.caught[p.id];
        if (t - v.caughtAt < 1500) {
          v.grade.style.animation = 'none';
          void v.grade.offsetWidth;
          v.grade.style.animation = '';
          v.seat.classList.add('just-caught');
        }
      }
      if (dead && t - v.caughtAt >= 1200) v.seat.classList.remove('just-caught');
    }
    ownScore.textContent = sec(S.scores?.[me]);
    const snitchable = canSnitch();
    holdButton.disabled = !canPlay() && !snitchable;
    holdButton.classList.toggle('snitch', ghost());
    holdButton.classList.toggle('pressed', held && canPlay());
    holdLabel.textContent = !ghost() ? ' 꾹 눌러 몰래 게임' : snitchable ? ' 🙋 고자질하기 (한 번)' : ' 🙋 고자질은 잠깐 뒤에…';
    instruction.textContent = S.caught?.[me]
      ? (S.snitched?.[me] ? '📉 C+ 확정! 고자질도 썼어요. 친구들이 걸리는지 지켜보세요.' : '📉 C+ 확정! 스페이스 = 🙋 고자질 (욕심부리는 친구를 노려요)')
      : !alive() ? '관전 중'
        : held ? '몰래 게임 중… 언제 돌아볼지 모른다!' : '누르면 게임 · 놓으면 공부하는 척';
    const intro = overlay.querySelector('.pr-intro-count');
    if (intro) intro.textContent = `${Math.max(1, Math.ceil((S.introUntil - t) / 1000))}초 후 수업 시작`;
  }
  raf = requestAnimationFrame(paint);

  return {
    update({ state }) {
      S = state;
      seq = Math.max(seq, S.seq?.[me] || 0);
      if (!canPlay()) held = false;
      makeSeats();
      renderSide();
      renderOverlay();
    },
    unmount() {
      release();
      cancelAnimationFrame(raf);
      clearInterval(refresher);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('focusin', onFocus);
    },
  };
}
