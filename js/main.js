import { connect } from './net/index.js';
import { MAX_PLAYERS, MAX_WATCHERS, RoomSession, createRoom, roomExists, sortedPlayers, withNick } from './room.js';
import { GameHost, nemesisOf } from './host.js';
import { createChat } from './chat.js';
import { CATEGORIES, COMING, GAMES, TAG_COLORS, getGame } from './games/index.js';
import { digitOf, h, isTyping, josa, randId, session, store, toast } from './util.js';
import {
  FACE_COUNT, NICKS, NICK_MAX, STICKERS, avatar, cleanNick, countdown, icon, keyNav, setStickerSource, startTimerLoop, stickerInfo,
} from './ui.js';

const app = document.getElementById('app');

let net = null;
let room = null;
let runner = null;   // 내가 방장일 때 게임 규칙을 돌리는 GameHost
let view = null;     // 현재 화면에 붙어 있는 게임 화면
let viewRun = null;
let shell = null;
let busy = false;
let starting = false;
let screen = 'home'; // home | lobby | game
let lobbyTab = 'all'; // 로비 카테고리 탭 (내 화면에서만)
let lobbyFocus = null; // 참가자가 방향키로 보고 있는 게임 (내 화면에서만)

const chat = createChat();
setStickerSource(pid => room?.snap.stats?.stickers?.[pid] || []);

// 제목 폰트는 글자 묶음별로 늦게 받아져서, '지금!'이 뜨는 순간 글꼴이 바뀌어 보일 수 있다.
// 게임에서 크게 쓰는 글자를 미리 받아 둔다.
document.fonts?.load('40px "Jua"', '친구컷기다려…지금!라운드준비마지막아직누를까?초록아님부정출발기록완료최종결과카드를몰래확인하세요내차례투표들켰다라이어시민승리반응속도대결게임젠가협동보드').catch(() => {});

boot();

async function boot() {
  app.replaceChildren(h('div', { class: 'center muted' }, '연결 중…'));
  try {
    net = await connect();
  } catch (e) {
    console.error(e);
    app.replaceChildren(h('div', { class: 'center' },
      h('div', {}, h('p', {}, '서버에 연결하지 못했어요 😢'), h('p', { class: 'muted small' }, String(e?.message || e)))));
    return;
  }
  if (net.mode === 'local') {
    // 로컬 테스트용 (개발자 도구에서 확인)
    window.__fcg = { get room() { return room; }, get runner() { return runner; }, net };
  }
  startTimerLoop(() => net.now());
  const code = codeFromHash();
  const name = savedName();
  if (code && name) enterRoom(code, name);
  else renderHome(code);
}

function codeFromHash() {
  const m = location.hash.match(/[A-Za-z]{4}/);
  return m ? m[0].toUpperCase() : '';
}

// 닉네임은 2글자까지 (꼴찌하면 1등이 앞에 별명을 붙이니까: 민준 → 바보같은 민준)
const NAME_MAX = 2;
const shortName = n => Array.from(String(n || '').trim()).slice(0, NAME_MAX).join('');

// 탭별 이름이 우선이라 새로고침해도 그 탭의 이름으로 다시 들어온다.
function savedName() {
  return shortName(session.get('fcg-name') || store.get('fcg-name', ''));
}

function saveName(name) {
  session.set('fcg-name', name);
  store.set('fcg-name', name);
}

function savedFace() {
  let face = session.get('fcg-face') ?? store.get('fcg-face');
  if (!Number.isInteger(face)) face = Math.floor(Math.random() * FACE_COUNT);
  saveFace(face);
  return face;
}

function saveFace(face) {
  session.set('fcg-face', face);
  store.set('fcg-face', face);
}

function setHash(code) {
  history.replaceState(null, '', code ? `#${code}` : location.pathname + location.search);
}

function localBanner() {
  if (net?.mode !== 'local') return null;
  return h('div', { class: 'banner-local' },
    '🧪 로컬 테스트 모드 — 이 컴퓨터의 브라우저 탭끼리만 연결돼요. 친구들과 하려면 README의 Firebase 설정을 해 주세요.');
}

const playerOf = (state, id) => state?.roster?.find(p => p.id === id)
  || room?.snap.players?.[id] && { id, ...room.snap.players[id], name: withNick(room.snap.players[id].name, room.snap.stats?.nicks?.[id]) }
  || { id, name: '?' };

/* ───────────── 홈 ───────────── */

function renderHome(prefill = '') {
  screen = 'home';
  teardownGame();
  const nameIn = h('input', { class: 'input', maxlength: NAME_MAX, placeholder: '닉네임 (2글자)', value: savedName(), autocomplete: 'off' });
  const codeIn = h('input', { class: 'input code-input', maxlength: 4, placeholder: 'ABCD', value: prefill, autocomplete: 'off', spellcheck: 'false' });
  codeIn.addEventListener('input', () => { codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z]/g, ''); });

  const takeName = () => {
    const n = shortName(nameIn.value);
    if (!n) {
      toast('닉네임을 먼저 적어 주세요');
      nameIn.focus();
      return null;
    }
    saveName(n);
    return n;
  };

  const withBusy = btn => async fn => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    try { await fn(); } catch (e) { toast(e?.message || '문제가 생겼어요'); } finally { busy = false; btn.disabled = false; }
  };

  const createBtn = h('button', { class: 'btn primary big', tabindex: '-1' }, '방 만들기');
  createBtn.addEventListener('click', () => withBusy(createBtn)(async () => {
    const name = takeName();
    if (!name) return;
    const code = await createRoom(net, GAMES[0].id);
    await enterRoom(code, name);
  }));

  const joinBtn = h('button', { class: 'btn blue', tabindex: '-1' }, '들어가기');
  const watchBtn = h('button', { class: 'btn', tabindex: '-1', title: '게임엔 안 끼고 구경만 해요 (나중에 참가로 바꿀 수 있어요)' }, '👀 관전');
  const join = (watch = false) => withBusy(watch ? watchBtn : joinBtn)(async () => {
    const name = takeName();
    if (!name) return;
    const code = codeIn.value.trim();
    if (code.length !== 4) {
      toast('방 코드 4글자를 입력해 주세요');
      codeIn.focus();
      return;
    }
    if (!(await roomExists(net, code))) {
      toast(`${code} 방이 없어요. 코드를 확인해 주세요`);
      return;
    }
    await enterRoom(code, name, watch);
  });
  joinBtn.addEventListener('click', () => join());
  watchBtn.addEventListener('click', () => join(true));
  codeIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) join(); });
  // 닉네임 칸: Enter = 방 만들기, Tab으로 코드 칸 이동 (마우스 없이 시작 가능)
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) (prefill ? join() : createBtn.click()); });

  let face = savedFace();
  const faceBox = h('span', {});
  const drawFace = () => faceBox.replaceChildren(avatar({ color: '#ff7ad9', face }, 'xl'));
  drawFace();
  const rerollBtn = h('button', { class: 'btn small', title: '얼굴 바꾸기', tabindex: '-1' }, icon('dice'), '얼굴 바꾸기');
  rerollBtn.addEventListener('click', () => {
    face = (face + 1 + Math.floor(Math.random() * (FACE_COUNT - 1))) % FACE_COUNT;
    saveFace(face);
    drawFace();
  });

  app.replaceChildren(h('main', { class: 'home' },
    h('h1', { class: 'home-title' }, '친구컷'),
    h('p', { class: 'home-sub' }, `${GAMES.length}개의 게임 포함 · 친구랑 같이`),
    h('div', { class: 'card-box home-card' },
      h('div', { class: 'home-me' }, faceBox, rerollBtn),
      h('label', { class: 'label' }, '닉네임 (2글자 · 꼴찌하면 1등이 앞에 별명을 붙여요)'),
      nameIn,
      createBtn,
      h('div', { class: 'or' }, h('span', {}, '친구 방에 들어가기')),
      h('div', { class: 'row' }, codeIn, joinBtn, watchBtn),
      h('p', { class: 'key-hint' }, '닉네임 쓰고 Enter = 방 만들기 · Tab으로 코드 칸 이동')),
    localBanner()));
  (nameIn.value ? (prefill ? codeIn : nameIn) : nameIn).focus();
}

/* ───────────── 방 입장/퇴장 ───────────── */

// watch: true = 관전으로, false = 참가로, 안 주면(새로고침) 이 탭이 하던 대로
async function enterRoom(code, name, watch) {
  const r = new RoomSession(net, code, name, savedFace());
  // 방장이 강퇴하면 바로 홈으로 (다시 들어오려 해도 막힌다)
  r.onKicked = () => {
    toast(`👢 방장이 ${code} 방에서 내보냈어요`);
    if (room === r) exitRoom();
  };
  chat.attach(r);
  try {
    await r.enter({ watch });
  } catch (e) {
    chat.detach();
    toast(e?.message || '들어가지 못했어요');
    setHash('');
    renderHome(code);
    return;
  }
  if (r.kicked) {
    chat.detach();
    setHash('');
    renderHome();
    r.leave();
    return;
  }
  room = r;
  setHash(code);
  room.onChange = render;
  if (r.full) toast(`참가 자리가 꽉 차서(${MAX_PLAYERS}명) 👀 관전으로 들어왔어요`);
  if (room.ready) render();
}

function confirmLeave() {
  if (confirm('방에서 나갈까요?')) exitRoom();
}

async function exitRoom() {
  runner?.stop();
  runner = null;
  chat.detach();
  const r = room;
  room = null;
  setHash('');
  renderHome();
  await r?.leave();
}

function render() {
  if (!room) return;
  const { meta } = room.snap;
  if (!meta) {
    toast('방이 사라졌어요');
    exitRoom();
    return;
  }
  syncHost();
  if (meta.status === 'playing' && meta.run) {
    screen = 'game';
    chat.setMode('game');
    renderGame();
  } else {
    screen = 'lobby';
    chat.setMode('lobby');
    renderLobby();
  }
}

// 내가 방장이고 게임 중이면 규칙 엔진을 돌리고, 아니면 멈춘다.
function syncHost() {
  const { meta, players } = room.snap;
  const want = !starting && meta.status === 'playing' && !!meta.run && meta.hostId === room.id;
  if (runner && (!want || runner.run !== meta.run)) {
    runner.stop();
    runner = null;
  }
  if (want && !runner) {
    runner = new GameHost(net, room, getGame(meta.game), meta.run);
    runner.setOnline(Object.keys(players || {}));
    runner.start();
  }
  runner?.setOnline(Object.keys(players || {}));
}

/* ───────────── 로비 ───────────── */

function inviteUrl() {
  return `${location.origin}${location.pathname}#${room.code}`;
}

async function copyInvite() {
  try {
    await navigator.clipboard.writeText(inviteUrl());
    toast('초대 링크를 복사했어요');
  } catch {
    prompt('이 링크를 친구에게 보내세요', inviteUrl());
  }
}

const lobbyGames = () => GAMES.filter(g => lobbyTab === 'all' || g.tag === lobbyTab);

function gameCard({ game, index, selected, focused, isHost, watching, voters, myVote, onClick }) {
  const soon = !game.id;
  let right;
  if (soon) right = h('span', { class: 'pill right' }, '제작 예정');
  else if (selected) right = h('span', { class: 'pill green right' }, '✓ 선택됨');
  else if (!isHost && myVote) right = h('span', { class: 'pill orange right' }, '✓ 내 투표');
  else if (!isHost && watching) right = null; // 관전 중엔 투표 못 함
  else right = h('span', { class: 'pill right' }, isHost ? '고르기' : '투표하기');
  return h(soon ? 'div' : 'button', {
    class: `gcard${selected ? ' selected' : ''}${focused ? ' kfocus' : ''}${soon ? ' soon' : ''}`,
    tabindex: '-1',
    onClick,
  },
  index ? h('kbd', { class: 'num' }, String(index)) : null,
  h('span', { class: 'gcard-info', 'data-tip': game.desc }, 'i'),
  h('div', { class: 'gcard-logo' },
    h('span', { class: 'gl-emoji' }, game.emoji),
    h('span', { class: 'gl-text', style: `--fill:${game.color || '#f1c40f'}` }, game.title)),
  h('div', { class: 'gcard-foot' },
    h('span', { class: 'pill' }, icon('users'), soon ? '?' : `${game.minPlayers}-${game.maxPlayers}`),
    h('span', { class: `pill ${TAG_COLORS[game.tag] || ''}` }, game.tag),
    voters?.length ? h('span', { class: 'pill orange votes' }, `🗳 ${voters.length}`, voters.map(p => avatar(p))) : null,
    right));
}

function renderLobby() {
  teardownGame();
  const { meta, players, votes, stats } = room.snap;
  const isHost = meta.hostId === room.id;
  const everyone = sortedPlayers(players, stats?.nicks);
  const list = everyone.filter(p => !p.watch);     // 다음 판에 같이 하는 사람
  const watchers = everyone.filter(p => p.watch);  // 👀 관전 (게임엔 안 낌)
  const me = everyone.find(p => p.id === room.id) || { id: room.id, name: room.name };
  const iWatch = room.watching;
  const selected = getGame(meta.game);
  const enough = list.length >= selected.minPlayers;
  const season = stats?.season || {};
  const pts = id => Number(season[id]) || 0;
  const best = Math.max(1, ...everyone.map(p => pts(p.id)));
  const myRank = 1 + everyone.filter(p => pts(p.id) > pts(me.id)).length;
  const nemesis = nemesisOf(stats?.kills, room.id);

  const row = p => h('li', { class: p.bot ? 'bot' : '' },
    avatar(p),
    h('span', { class: 'nm' }, p.name),
    p.bot ? h('em', { class: 'bot-badge' }, '🤖') : null,
    p.id === room.id ? h('em', { class: 'me-badge' }, '나') : null,
    p.id === meta.hostId ? h('span', { title: '방장' }, '👑') : null,
    p.id === nemesis ? h('span', { class: 'nemesis', title: '나를 제일 많이 죽인 사람' }, '🎯 원수') : null,
    h('span', { class: 'side-pts' }, `${pts(p.id)}점`),
    isHost && p.id !== room.id ? hostActs(p) : null);
  const playerItems = list.map(row);
  for (let i = list.length; i < Math.max(4, Math.min(MAX_PLAYERS, list.length + 1)); i++) {
    playerItems.push(isHost && i === list.length
      ? h('li', { class: 'empty add-bot', onClick: addBot }, '＋ 봇 추가', h('kbd', {}, 'B'))
      : h('li', { class: 'empty' }, '빈 자리'));
  }

  const playable = lobbyGames();
  const focusId = isHost ? meta.game : (lobbyFocus || meta.game);
  // 나갔거나 관전으로 바꾼 사람의 투표는 안 센다
  const votersOf = id => Object.entries(votes || {})
    .filter(([pid, g]) => g === id && players?.[pid] && !players[pid].watch)
    .map(([pid]) => playerOf(null, pid));
  const cards = [
    ...playable.map((g, i) => gameCard({
      game: g,
      index: i + 1,
      selected: g.id === selected.id,
      focused: !isHost && g.id === focusId,
      isHost,
      watching: iWatch,
      voters: votersOf(g.id),
      myVote: votes?.[room.id] === g.id,
      onClick: () => {
        if (isHost) net.update(room.path('meta'), { game: g.id });
        else {
          lobbyFocus = g.id;
          if (!iWatch) room.vote(g.id);
          else {
            toast('👀 관전 중이라 투표는 못 해요');
            renderLobby();
          }
        }
      },
    })),
    ...COMING.filter(g => lobbyTab === 'all' || g.tag === lobbyTab).map(g => gameCard({ game: g })),
  ];
  const tabs = CATEGORIES.map(c => h('button', {
    class: `tab${lobbyTab === c.id ? ' on' : ''}`,
    tabindex: '-1',
    onClick: () => { lobbyTab = c.id; renderLobby(); },
  }, h('span', {}, c.emoji), c.label));

  const action = isHost
    ? h('div', { class: 'head-action' },
      h('button', { class: 'btn primary', disabled: !enough, tabindex: '-1', onClick: () => startGame(selected.id) },
        icon('play'), `${selected.title} 시작`, h('kbd', {}, 'Space')),
      h('span', { class: 'head-note' }, enough
        ? `${list.length}명이 같이 해요${iWatch ? ' · 나는 👀 관전' : ''}`
        : `${selected.minPlayers}명 이상 모여야 시작할 수 있어요`))
    : h('div', { class: 'head-action' },
      h('div', { class: 'waiting-box dots' }, `${iWatch ? '👀 관전 중 · ' : ''}방장이 ${josa(selected.title, '을', '를')} 고르는 중`));

  app.replaceChildren(h('div', { class: 'layout' },
    h('aside', { class: 'sidebar' },
      h('div', { class: 'side-scroll' },
        h('div', { class: 'me' },
          avatar(me, 'xl'),
          h('div', { class: 'me-info' },
            h('b', { class: 'me-name' }, me.name),
            h('span', { class: 'me-sub' }, `${isHost ? '👑 방장 · ' : ''}${iWatch ? '👀 관전 · ' : ''}오늘 ${pts(me.id)}점 · ${myRank}위`),
            h('div', { class: 'season-bar' }, h('i', { style: `width:${Math.round((pts(me.id) / best) * 100)}%` })))),
        h('div', { class: 'side-box' },
          h('span', { class: 'side-label' }, '방 코드'),
          h('div', { class: 'room-code' }, room.code),
          h('button', { class: 'side-btn', tabindex: '-1', onClick: copyInvite }, icon('link'), '초대 링크 복사')),
        h('div', {},
          h('span', { class: 'side-label' }, `참가자 ${list.length} / ${MAX_PLAYERS}`),
          h('ul', { class: 'side-players' }, playerItems)),
        watchers.length ? h('div', {},
          h('span', { class: 'side-label' }, `👀 관전 ${watchers.length} / ${MAX_WATCHERS}`),
          h('ul', { class: 'side-players watchers' }, watchers.map(row))) : null),
      h('div', { class: 'side-chat-slot' }),
      h('nav', { class: 'side-foot' },
        h('button', { tabindex: '-1', onClick: copyInvite }, icon('link'), '초대'),
        h('button', { tabindex: '-1', title: iWatch ? '다음 판부터 같이 해요' : '게임엔 안 끼고 구경만 해요', onClick: toggleWatch },
          iWatch ? '🙋 참가' : '👀 관전'),
        h('button', { tabindex: '-1', onClick: confirmLeave }, icon('exit'), '나가기'))),
    h('main', { class: 'main' },
      h('header', { class: 'main-head' },
        h('div', {},
          h('h1', { class: 'title' }, '친구컷'),
          h('p', { class: 'subtitle' }, `${GAMES.length}개의 게임 포함`)),
        action),
      localBanner(),
      h('div', { class: 'tabs' }, tabs),
      h('p', { class: 'key-hint center-hint' }, isHost
        ? '← → / 숫자키 게임 고르기 · 스페이스 시작 · B 봇 추가 · Shift+B 봇 빼기 · Enter 채팅'
        : iWatch ? '👀 관전 중: 게임은 구경만 해요 (투표는 🙋 참가로 바꾸면) · Enter 채팅'
          : '← → 또는 숫자키로 게임 보기 · 스페이스 투표 · Enter 채팅'),
      h('div', { class: 'cards' }, cards))));
}

// 방장: 이름 옆 👀 = 관전으로 보내기, ✕ = 강퇴 (봇은 ✕ = 빼기)
// 강퇴는 ✕를 한 번 더 눌러야 된다. confirm 창은 방장 컴퓨터의 게임 엔진까지 멈춰서 모두의 게임이 얼기 때문
let kickArmed = null; // { id, until } 화면이 다시 그려져도 '강퇴?' 상태 유지
const armedFor = id => kickArmed?.id === id && performance.now() < kickArmed.until;

function hostActs(p) {
  const armed = armedFor(p.id);
  return h('span', { class: 'side-acts' },
    !p.bot && !p.watch ? h('button', { class: 'side-x', tabindex: '-1', title: '관전으로 보내기', onClick: () => sendToWatch(p) }, '👀') : null,
    h('button', {
      class: `side-x${armed ? ' armed' : ''}`, tabindex: '-1', title: p.bot ? '봇 빼기' : armed ? '한 번 더 누르면 강퇴' : '강퇴',
      onClick: () => kickPlayer(p),
    }, armed ? '강퇴?' : '✕'));
}

// 방장 도구를 누른 뒤 목록만 다시 그리기 (로비는 통째로, 게임 중엔 참가자 창만)
function redrawActs() {
  if (screen === 'lobby') renderLobby();
  else if (shell) {
    shell.whoKey = null;
    render();
  }
}

async function kickPlayer(p) {
  if (!room) return;
  if (p.bot) {
    room.removeBot(p.id);
    return;
  }
  if (!armedFor(p.id)) {
    kickArmed = { id: p.id, until: performance.now() + 3000 };
    toast(`✕를 한 번 더 누르면 ${josa(p.name, '을', '를')} 강퇴해요 (이 방에 다시 못 들어와요)`);
    redrawActs();
    setTimeout(() => {
      if (kickArmed?.id !== p.id) return;
      kickArmed = null;
      if (room) redrawActs();
    }, 3000);
    return;
  }
  kickArmed = null;
  try {
    const name = await room.kick(p.id);
    if (name) toast(`👢 ${name} 강퇴`);
  } catch (e) {
    toast(e?.message || '강퇴하지 못했어요');
  }
}

async function sendToWatch(p) {
  try {
    if (await room?.setWatch(true, p.id)) room.sys(`👀 방장이 ${josa(p.name, '을', '를')} 관전으로 보냈어요`);
  } catch (e) {
    toast(e?.message || '관전으로 보내지 못했어요');
  }
}

// 나: 👀 관전 ↔ 🙋 참가 (게임 중에 바꾸면 다음 판부터)
async function toggleWatch() {
  if (!room) return;
  const on = !room.watching;
  const later = screen === 'game' ? (on ? ' · 다음 판부터 구경만 해요' : ' · 다음 판부터 같이 해요') : '';
  try {
    if (await room.setWatch(on)) toast(on ? `👀 관전으로 바꿨어요${later}` : `🙋 참가로 바꿨어요${later}`);
  } catch (e) {
    toast(e?.message || '바꾸지 못했어요');
  }
}

async function addBot() {
  try {
    const name = await room.addBot();
    toast(`🤖 ${name} 입장`);
  } catch (e) {
    toast(e?.message || '봇을 넣지 못했어요');
  }
}

// 로비 키보드: 방장은 방향키로 고르고 스페이스로 시작, 참가자는 방향키로 보고 스페이스로 투표
// 방장은 B로 봇 추가, Shift+B로 봇 빼기 (혼자 테스트할 때)
function lobbyKey(e) {
  const { meta } = room.snap;
  const isHost = meta.hostId === room.id;
  if (isHost && e.code === 'KeyB' && !e.repeat) {
    e.preventDefault();
    if (e.shiftKey) {
      const name = room.removeBot();
      if (name) toast(`🤖 ${name} 퇴장`);
    } else addBot();
    return;
  }
  const ids = lobbyGames().map(g => g.id);
  if (!ids.length) return;
  const cur = isHost ? meta.game : (lobbyFocus || meta.game);
  let i = Math.max(0, ids.indexOf(cur));
  const cards = [...document.querySelectorAll('.gcard:not(.soon)')];
  const perRow = Math.max(1, cards.filter(c => c.offsetTop === cards[0]?.offsetTop).length);
  const d = digitOf(e);
  if (e.code === 'ArrowRight') i = (i + 1) % ids.length;
  else if (e.code === 'ArrowLeft') i = (i - 1 + ids.length) % ids.length;
  else if (e.code === 'ArrowDown') i = Math.min(ids.length - 1, i + perRow);
  else if (e.code === 'ArrowUp') i = Math.max(0, i - perRow);
  else if (d && d <= ids.length) i = d - 1;
  else if (e.code === 'Space') {
    e.preventDefault();
    if (e.repeat) return;
    if (isHost) startGame(meta.game);
    else if (room.watching) toast('👀 관전 중이라 투표는 못 해요');
    else room.vote(cur);
    return;
  } else return;
  e.preventDefault();
  if (isHost) {
    if (ids[i] !== meta.game) net.update(room.path('meta'), { game: ids[i] });
  } else {
    lobbyFocus = ids[i];
    if (d && !room.watching) room.vote(ids[i]); // 숫자키는 바로 투표
    else renderLobby();
  }
}

// 결과 화면 키보드 (방장): R = 한 판 더, L = 다른 게임 고르기
function resultKey(e) {
  const { meta, state } = room.snap;
  if (meta.hostId !== room.id || !state?.over || e.repeat) return;
  if (e.code === 'KeyR') {
    e.preventDefault();
    restartGame();
  } else if (e.code === 'KeyL') {
    e.preventDefault();
    backToLobby();
  }
}

window.addEventListener('keydown', e => {
  if (!room?.snap.meta || isTyping(e)) return;
  if (e.key === 'Escape' && shell?.whoOpen) {
    toggleWho(false);
    return;
  }
  if (screen === 'lobby') lobbyKey(e);
  else if (screen === 'game') resultKey(e);
});

/* ───────────── 게임 시작/종료 (방장만) ───────────── */

async function startGame(gameId, prev = null) {
  if (busy) return;
  const game = getGame(gameId);
  // 게임 안 이름 = 별명까지 붙은 이름 (킬로그·결과·채팅 모두)
  const roster = sortedPlayers(room.snap.players, room.snap.stats?.nicks)
    .filter(p => !p.watch) // 👀 관전하는 사람은 구경만
    .map(({ id, name, color, face, bot }) => ({ id, name, color, face, bot }));
  if (roster.length < game.minPlayers) {
    toast(`${josa(game.title, '은', '는')} ${game.minPlayers}명 이상 필요해요`);
    return;
  }
  if (roster.length > game.maxPlayers) {
    toast(`${josa(game.title, '은', '는')} 최대 ${game.maxPlayers}명까지예요`);
    return;
  }
  busy = true;
  starting = true;
  runner?.stop(); // 이전 판 엔진이 새 판 상태를 덮어쓰지 않게 먼저 멈춘다
  runner = null;
  try {
    const privates = {};
    const ctx = {
      roster,
      now: () => net.now(),
      secret: {},
      isOnline: () => true,
      setPrivate: (id, data) => { privates[id] = data; },
      nameOf: id => roster.find(p => p.id === id)?.name || '?',
      announce: () => {},
      kill: () => {},
    };
    const state = game.setup(ctx, prev);
    const run = randId(8);
    Object.assign(state, { roster, run });
    await net.set(room.path('game'), { state, secret: ctx.secret, private: privates });
    await net.remove(room.path('votes'));
    await net.update(room.path('meta'), { status: 'playing', game: gameId, run });
  } catch (e) {
    console.error(e);
    toast('게임을 시작하지 못했어요');
  } finally {
    busy = false;
    starting = false;
    render();
  }
}

async function restartGame() {
  if (busy) return;
  const { meta, state } = room.snap;
  const secret = await net.get(room.path('game/secret'));
  startGame(meta.game, { state, secret });
}

async function backToLobby() {
  if (busy) return;
  runner?.stop();
  runner = null;
  starting = true;
  try {
    await net.update(room.path('meta'), { status: 'lobby', run: null });
    await net.remove(room.path('game'));
  } finally {
    starting = false;
  }
}

/* ───────────── 게임 화면 ───────────── */

function teardownGame() {
  view?.unmount?.();
  shell?.footerNav?.destroy();
  view = null;
  viewRun = null;
  shell = null;
}

function gameShell(game) {
  const info = h('div', { class: 'shell-info' });
  const hostBtn = h('button', {
    class: 'btn ghost small',
    tabindex: '-1',
    onClick: () => { if (confirm('게임을 중단하고 로비로 갈까요?')) backToLobby(); },
  }, '게임 중단');
  const body = h('div', { class: 'shell-body' }, h('div', { class: 'center muted' }, '불러오는 중…'));
  const footer = h('div', { class: 'shell-footer', hidden: true });
  // 👥 버튼: 누가 하고 누가 구경하는지 보기 · 다음 판 관전/참가 · 방장은 강퇴
  const whoBtn = h('button', { class: 'chip who-btn', tabindex: '-1', title: '참가자 · 관전', onClick: () => toggleWho() });
  const who = h('div', { class: 'who-panel', hidden: true });
  const root = h('div', { class: 'shell' },
    h('header', { class: 'shell-head' },
      h('button', { class: 'btn ghost small', tabindex: '-1', onClick: confirmLeave }, '← 나가기'),
      h('div', { class: 'shell-title' }, h('span', { class: 'emoji' }, game.emoji), h('b', {}, game.title)),
      info,
      hostBtn,
      who),
    body,
    footer);
  return { root, body, footer, info, hostBtn, whoBtn, who, whoOpen: false, footerKey: '', footerNav: null };
}

function toggleWho(open) {
  if (!shell) return;
  shell.whoOpen = open ?? !shell.whoOpen;
  shell.who.hidden = !shell.whoOpen;
  shell.whoBtn.classList.toggle('on', shell.whoOpen);
}

// 참가자 창 바깥을 누르면 닫는다
window.addEventListener('pointerdown', e => {
  if (shell?.whoOpen && !shell.who.contains(e.target) && !shell.whoBtn.contains(e.target)) toggleWho(false);
});

function whoPanel(isHost, state) {
  const { meta, players, stats } = room.snap;
  const everyone = sortedPlayers(players, stats?.nicks);
  const inRun = id => !!state?.roster?.some(p => p.id === id);
  const row = p => h('li', { class: p.bot ? 'bot' : '' },
    avatar(p),
    h('span', { class: 'nm' }, p.name),
    p.bot ? h('em', { class: 'bot-badge' }, '🤖') : null,
    p.id === room.id ? h('em', { class: 'me-badge' }, '나') : null,
    p.id === meta.hostId ? h('span', { title: '방장' }, '👑') : null,
    state && !p.watch && !inRun(p.id) ? h('span', { class: 'who-tag' }, '다음 판부터') : null,
    state && p.watch && inRun(p.id) ? h('span', { class: 'who-tag' }, '이번 판까지') : null,
    isHost && p.id !== room.id ? hostActs(p) : null);
  const list = everyone.filter(p => !p.watch);
  const watchers = everyone.filter(p => p.watch);
  const gone = (state?.roster || []).filter(p => !players?.[p.id]); // 이번 판에 있다가 나간 사람 (강퇴·창 닫음)
  return [
    h('span', { class: 'side-label' }, `참가 ${list.length} / ${MAX_PLAYERS}`),
    h('ul', { class: 'side-players' }, list.map(row)),
    watchers.length ? h('span', { class: 'side-label' }, `👀 관전 ${watchers.length} / ${MAX_WATCHERS}`) : null,
    watchers.length ? h('ul', { class: 'side-players watchers' }, watchers.map(row)) : null,
    gone.length ? h('p', { class: 'who-gone' }, `🚪 나감: ${gone.map(p => p.name).join(', ')}`) : null,
    h('button', { class: 'btn small who-toggle', tabindex: '-1', onClick: toggleWatch },
      room.watching ? '🙋 다음 판부터 참가하기' : '👀 다음 판부터 관전하기'),
    isHost ? h('p', { class: 'who-gone' }, '👀 = 관전으로 보내기 · ✕ = 강퇴') : null,
  ].filter(Boolean);
}

function resultSummary(result, state) {
  const rows = [...(result.rows || [])].sort((a, b) => a.rank - b.rank);
  const titles = Object.entries(result.titles || {}).flatMap(([id, list]) => (list || []).map(t => [id, t]));
  return h('div', { class: 'rb-rows' },
    h('div', { class: 'rb-points' }, rows.map(r => h('span', { class: `rb-chip${r.id === room.id ? ' me' : ''}` },
      h('b', {}, `${r.rank}위`), avatar(playerOf(state, r.id)), playerOf(state, r.id).name,
      h('em', { class: r.pts ? 'up' : '' }, `+${r.pts}`)))),
    titles.length ? h('div', { class: 'rb-titles' }, titles.map(([id, t]) => h('span', { class: 'rb-title' },
      t, ' · ', h('b', {}, playerOf(state, id).name)))) : null);
}

function stickerSection(result, state) {
  if (!result.winners?.length || !result.losers?.length) return null;
  const losers = result.losers.map(id => playerOf(state, id));
  const loserNames = losers.map(p => p.name).join(', ');
  if (result.sticker) {
    const s = stickerInfo(result.sticker.id);
    const by = result.sticker.by ? josa(playerOf(state, result.sticker.by).name, '이', '가') : '시간 초과로';
    return h('div', { class: 'rb-sticker done' },
      losers.map(p => avatar(p, 'lg')),
      h('span', {}, `${s?.emoji || ''} ${by} ${loserNames} 얼굴에 ${s?.label || '스티커'} 붙임!`));
  }
  if (result.winners.includes(room.id)) {
    const target = losers[0];
    const current = room.snap.stats?.stickers?.[target.id] || [];
    const btns = STICKERS.map(s => h('button', {
      class: 'sticker-btn',
      tabindex: '-1',
      onClick: () => {
        btns.forEach(b => { b.disabled = true; });
        room.send('__sticker', { id: s.id });
      },
    }, avatar({ ...target, stickers: [...current, s.id].slice(-3) }, 'lg'), h('span', {}, s.label)));
    shell.footerNav = keyNav(btns);
    return h('div', { class: 'rb-sticker pick' },
      h('b', {}, `👑 ${loserNames} 얼굴에 붙일 스티커를 골라! (숫자키 또는 ← → 스페이스)`),
      h('div', { class: 'sticker-grid' }, btns),
      countdown(result.stickerUntil, 20000));
  }
  const winnerNames = result.winners.map(id => playerOf(state, id).name).join(', ');
  return h('div', { class: 'rb-sticker wait' },
    h('span', { class: 'dots' }, `👑 ${josa(winnerNames, '이', '가')} ${loserNames} 얼굴에 붙일 스티커 고르는 중`),
    countdown(result.stickerUntil, 20000));
}

// 스티커 다음: 1등이 꼴찌 닉네임 앞에 붙일 별명 고르기 (숫자키 1~6 = 보기, 7 = 직접 쓰기 → Enter)
let nickDraft = { run: null, text: '', focus: false }; // 화면이 다시 그려져도 쓰던 글자 유지
const nickChoices = result => {
  const start = Math.abs(Math.floor(result.at || 0)) % NICKS.length;
  return Array.from({ length: 6 }, (_, i) => NICKS[(start + i * 7) % NICKS.length]);
};

function nickSection(result, state) {
  if (!result.sticker || !result.nickUntil || !result.winners?.length || !result.losers?.length) return null;
  const baseOf = id => room.snap.players?.[id]?.name || playerOf(state, id).name;
  const loserNames = result.losers.map(id => playerOf(state, id).name).join(', ');
  const total = result.nickUntil - (result.nickAt || result.nickUntil - 20000);
  if (result.nick) {
    const by = result.nick.by ? `${josa(playerOf(state, result.nick.by).name, '이', '가')} 지어 준 별명` : '시간 초과! 랜덤 별명';
    return h('div', { class: 'rb-sticker done' },
      h('span', {}, `🏷️ ${by} → `), h('b', {}, result.losers.map(id => withNick(baseOf(id), result.nick.text)).join(', ')));
  }
  const winnerNames = result.winners.map(id => playerOf(state, id).name).join(', ');
  if (!result.winners.includes(room.id)) {
    return h('div', { class: 'rb-sticker wait' },
      h('span', { class: 'dots' }, result.losers.includes(room.id)
        ? `😭 ${josa(winnerNames, '이', '가')} 내 별명 짓는 중`
        : `🏷️ ${josa(winnerNames, '이', '가')} ${loserNames} 별명 짓는 중`),
      countdown(result.nickUntil, total));
  }
  const target = baseOf(result.losers[0]);
  if (nickDraft.run !== result.run) nickDraft = { run: result.run, text: '', focus: false };
  const input = h('input', {
    class: 'input nick-input', maxlength: NICK_MAX, value: nickDraft.text, autocomplete: 'off', spellcheck: 'false',
    placeholder: `직접 쓰기 (${NICK_MAX}글자까지) · Enter`,
  });
  const preview = h('b', { class: 'nick-preview' }, withNick(target, cleanNick(nickDraft.text) || '???'));
  let sent = false;
  const choose = text => {
    const t = cleanNick(text);
    if (!t || sent) return;
    sent = true;
    for (const b of [...btns, write]) b.disabled = true;
    input.disabled = true;
    room.send('__nick', { text: t });
  };
  const btns = nickChoices(result).map(t => h('button', { class: 'nick-btn', tabindex: '-1', onClick: () => choose(t) }, withNick(target, t)));
  const write = h('button', { class: 'nick-btn write', tabindex: '-1', onClick: () => input.focus() }, '✏️ 직접 쓰기');
  input.addEventListener('input', () => {
    nickDraft.text = input.value;
    preview.textContent = withNick(target, cleanNick(input.value) || '???');
  });
  input.addEventListener('focus', () => { nickDraft.focus = true; });
  input.addEventListener('blur', () => { nickDraft.focus = false; });
  input.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation(); // 채팅이 열리지 않게
      choose(input.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input.blur();
    }
  });
  if (nickDraft.focus) queueMicrotask(() => input.focus());
  shell.footerNav = keyNav([...btns, write]);
  return h('div', { class: 'rb-sticker pick' },
    h('b', {}, `🏷️ 이제 ${loserNames} 별명도 지어 줘! (숫자키 · 7 = 직접 쓰고 Enter)`),
    h('div', { class: 'nick-grid' }, btns, write),
    h('div', { class: 'nick-write' }, input, preview),
    countdown(result.nickUntil, total));
}

function updateShell(isHost, state) {
  const { players, meta, stats } = room.snap;
  const spectating = state && !state.roster.some(p => p.id === room.id);
  shell.hostBtn.hidden = !isHost || !!state?.over;
  // 게임 상태가 초당 여러 번 오니(범퍼카는 20번) 위쪽 칩은 바뀔 때만 다시 만든다
  const infoKey = JSON.stringify([!!spectating, isHost, room.code]);
  if (infoKey !== shell.infoKey) {
    shell.infoKey = infoKey;
    shell.info.replaceChildren(...[
      spectating ? h('span', { class: 'chip warn' }, '👀 관전 중') : null,
      isHost ? h('span', { class: 'chip' }, '👑 방장') : null,
      h('span', { class: 'chip' }, `방 ${room.code}`),
      shell.whoBtn,
    ].filter(Boolean));
  }
  // 👥 버튼 · 참가자 창도 사람·관전·방장·이번 판 명단이 바뀔 때만 (관전하는 사람 얼굴도 여기 있어서 채팅 말풍선이 뜬다)
  const everyone = sortedPlayers(players, stats?.nicks);
  const watchers = everyone.filter(p => p.watch);
  const whoKey = JSON.stringify([isHost, meta.hostId, room.watching, (state?.roster || []).map(p => p.id),
    everyone.map(p => [p.id, p.name, p.color, p.face, !!p.watch]), stats?.stickers]);
  if (whoKey !== shell.whoKey) {
    shell.whoKey = whoKey;
    shell.whoBtn.replaceChildren(...[`👥 ${everyone.length - watchers.length}`, watchers.length
      ? h('span', { class: 'who-eyes' }, `· 👀 ${watchers.length}`, watchers.slice(0, 4).map(p => avatar(p, 'xs')))
      : null].filter(Boolean));
    shell.who.replaceChildren(...whoPanel(isHost, state));
  }

  const result = room.snap.result?.run === meta.run ? room.snap.result : null;
  const key = JSON.stringify([!!state?.over, isHost, result, stats?.stickers, stats?.nicks, room.watching]);
  if (key === shell.footerKey) return;
  shell.footerKey = key;
  shell.footerNav?.destroy();
  shell.footerNav = null;
  shell.footer.hidden = !state?.over;
  shell.body.classList.toggle('with-result', !!state?.over);
  if (!state?.over) {
    shell.footer.replaceChildren();
    return;
  }
  shell.footer.replaceChildren(...[
    result ? resultSummary(result, state) : h('div', { class: 'muted dots' }, '결과 정리 중'),
    result ? stickerSection(result, state) : null,
    result ? nickSection(result, state) : null,
    h('div', { class: 'rb-actions' }, ...(isHost
      ? [h('button', { class: 'btn primary', tabindex: '-1', onClick: restartGame }, '🔁 한 판 더', h('kbd', {}, 'R')),
        h('button', { class: 'btn', tabindex: '-1', onClick: backToLobby }, '🎮 다른 게임 고르기', h('kbd', {}, 'L'))]
      : [h('span', { class: 'dots muted' }, '방장이 다음 판을 고르는 중')]),
    h('button', { class: 'btn small', tabindex: '-1', title: room.watching ? '다음 판부터 같이 해요' : '다음 판은 구경만 해요', onClick: toggleWatch },
      room.watching ? '🙋 다음 판 참가' : '👀 다음 판 관전')),
  ].filter(Boolean));
}

function renderGame() {
  const { meta, players, state, priv } = room.snap;
  const game = getGame(meta.game);
  if (viewRun !== meta.run) {
    teardownGame();
    shell = gameShell(game);
    app.replaceChildren(shell.root);
    viewRun = meta.run;
  }
  const current = state?.run === meta.run ? state : null;
  updateShell(meta.hostId === room.id, current);
  if (!current) return;
  if (!view) {
    shell.body.replaceChildren();
    view = game.mount(shell.body, {
      me: room.id,
      now: () => net.now(),
      send: (type, data) => room.send(type, data),
    });
  }
  view.update({ state: current, priv: priv || null, players: players || {} });
}
