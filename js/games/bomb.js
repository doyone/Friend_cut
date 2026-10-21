// 폭탄 돌리기: 터지는 시간은 방장만 안다. 폭탄을 받으면 방향키 콤보를 다 쳐야 넘길 수 있고,
// 누구한테 던질지는 숫자키로 직접 고른다. 터지면 들고 있던 사람 탈락, 마지막으로 넘긴 사람이 킬.
// 방금 나한테 준 사람한테는 바로 못 돌려준다 (판마다 반사 1번). 6명 이상이면 폭탄 2개.
// 탈락자는 유령이 되어 폭탄 든 사람 콤보에 화살표를 2개 더 얹는다.
import { h, isTyping, pick } from '../util.js';
import { avatar, countdown, keyNav, podium } from '../ui.js';

const INTRO_TIME = 6000;
const FUSE_MIN = 12000;
const FUSE_MAX = 28000;
const RESPAWN = 2500;        // 터지고 다음 폭탄까지
const HAUNT_COOLDOWN = 5000;
const ARROW = { U: '↑', D: '↓', L: '←', R: '→' };
const KEYMAP = { ArrowUp: 'U', KeyW: 'U', ArrowDown: 'D', KeyS: 'D', ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R' };

// 폭탄이 오래 돌수록 콤보가 길어진다 (4개 → 최대 9개)
const comboLength = age => Math.min(9, 4 + Math.floor(age / 6000));
const wantBombs = n => (n >= 6 ? 2 : 1);
const randomArrows = n => Array.from({ length: n }, () => pick(['U', 'D', 'L', 'R']));

function spawn(ctx, now) {
  const S = ctx.state;
  const busy = new Set((S.bombs || []).map(b => b.holder));
  const free = S.alive.filter(id => !busy.has(id));
  const online = free.filter(id => ctx.isOnline(id));
  const pool = online.length ? online : free;
  if (!pool.length) return false;
  S.bombNo = (S.bombNo || 0) + 1;
  const id = `b${S.bombNo}`;
  S.bombs = [...(S.bombs || []), { id, holder: pick(pool), born: now, heat: 0, seq: 0 }];
  ctx.secret.fuses = { ...(ctx.secret.fuses || {}), [id]: now + FUSE_MIN + Math.random() * (FUSE_MAX - FUSE_MIN) };
  return true;
}

function explode(ctx, b, now, away = false) {
  const S = ctx.state;
  const name = ctx.nameOf;
  const victim = b.holder;
  S.bombs = (S.bombs || []).filter(x => x.id !== b.id);
  const fuses = { ...(ctx.secret.fuses || {}) };
  delete fuses[b.id];
  ctx.secret.fuses = fuses;
  S.alive = S.alive.filter(id => id !== victim);
  S.outOrder = [...(S.outOrder || []), victim];
  S.booms = [...(S.booms || []), { pid: victim, at: now }].slice(-8);
  const killer = !away && b.from && b.from !== victim ? b.from : null;
  S.dead = { ...(S.dead || {}), [victim]: killer || '-' };
  if (killer) {
    ctx.kill(killer, victim, '💣 폭탄 배달');
    S.kills = { ...(S.kills || {}), [killer]: (S.kills?.[killer] || 0) + 1 };
  } else {
    ctx.announce(away ? `💤 ${name(victim)} 자리 비움 → 폭사` : `💥 ${name(victim)} 손에서 폭탄이 터졌다!`);
  }
  if (S.alive.length <= 1) {
    finish(ctx);
    return;
  }
  if (S.bombs.length < wantBombs(S.alive.length)) S.respawnAt = now + RESPAWN;
}

function finish(ctx) {
  const S = ctx.state;
  const placement = [...S.alive, ...[...(S.outOrder || [])].reverse()];
  for (const p of S.roster) if (!placement.includes(p.id)) placement.push(p.id);
  S.placement = placement;
  S.standings = Object.fromEntries(placement.map((id, i) => [id, placement.length - i]));
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  if (S.alive[0]) add(S.alive[0], '👑 최후의 생존자');
  const [topKiller, kills] = Object.entries(S.kills || {}).sort((a, b) => b[1] - a[1])[0] || [];
  if (kills >= 1) add(topKiller, `💣 폭탄 배달부 (${kills}킬)`);
  const [topPasser, passes] = Object.entries(S.passes || {}).sort((a, b) => b[1] - a[1])[0] || [];
  if (passes >= 5) add(topPasser, `🏓 폭탄 핑퐁러 (${passes}번 넘김)`);
  S.titles = titles;
  S.bombs = null;
  S.respawnAt = null;
  ctx.secret.fuses = null;
  S.phase = 'final';
  S.over = true;
}

export default {
  id: 'bomb',
  title: '폭탄 돌리기',
  emoji: '💣',
  tag: '우정파괴',
  color: '#e74c3c',
  desc: '폭탄을 받으면 방향키 콤보를 쳐야 넘길 수 있어요. 누구한테 던질지는 숫자키로. 터지면 탈락, 넘긴 사람이 킬!',
  minPlayers: 3,
  maxPlayers: 8,

  setup(ctx) {
    return {
      phase: 'intro',
      phaseEndsAt: ctx.now() + INTRO_TIME,
      alive: ctx.roster.map(p => p.id),
    };
  },

  onInput(ctx, { pid, type, data }) {
    const S = ctx.state;
    if (S.phase !== 'play') return false;
    if (type === 'throw') {
      const b = S.bombs?.find(x => x.id === data.bomb);
      const t = data.target;
      if (!b || b.holder !== pid || data.seq !== b.seq) return false;
      if (!S.alive.includes(t) || t === pid || S.bombs.some(x => x.holder === t)) return false;
      const others = S.alive.filter(id => id !== pid && !S.bombs.some(x => x.holder === id));
      let reflect = false;
      if (t === b.from && others.some(id => id !== b.from)) {
        if (S.reflectUsed?.[pid]) return false;
        S.reflectUsed = { ...(S.reflectUsed || {}), [pid]: true };
        reflect = true;
      }
      S.bombs = S.bombs.map(x => (x.id === b.id ? { ...x, holder: t, from: pid, seq: x.seq + 1 } : x));
      S.passes = { ...(S.passes || {}), [pid]: (S.passes?.[pid] || 0) + 1 };
      if (reflect) ctx.announce(`🔄 ${ctx.nameOf(pid)} 반사! 폭탄이 ${ctx.nameOf(t)}에게 되돌아감`);
      return true;
    }
    if (type === 'haunt') {
      const isGhost = S.roster.some(p => p.id === pid) && !S.alive.includes(pid);
      const now = ctx.now();
      if (!isGhost || !S.bombs?.some(b => b.holder === data.target)) return false;
      if (now - (S.lastHaunt?.[pid] || 0) < HAUNT_COOLDOWN) return false;
      S.lastHaunt = { ...(S.lastHaunt || {}), [pid]: now };
      S.haunts = [...(S.haunts || []), { by: pid, to: data.target, at: now }].slice(-20);
      return true;
    }
    return false;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase === 'intro') {
      if (now < S.phaseEndsAt) return false;
      S.phase = 'play';
      for (let i = 0; i < wantBombs(S.alive.length); i++) spawn(ctx, now);
      return true;
    }
    if (S.phase !== 'play') return false;
    let changed = false;
    for (const b of [...(S.bombs || [])]) {
      if (S.phase !== 'play') break;
      const at = ctx.secret.fuses?.[b.id] || now;
      if (!ctx.isOnline(b.holder)) {
        explode(ctx, b, now, true);
        changed = true;
      } else if (now >= at) {
        explode(ctx, b, now);
        changed = true;
      } else {
        // 남은 시간은 안 알려주고, 얼마나 위험한지만 3단계로
        const heat = at - now < 3500 ? 2 : at - now < 8000 ? 1 : 0;
        if (heat !== b.heat) {
          S.bombs = S.bombs.map(x => (x.id === b.id ? { ...x, heat } : x));
          changed = true;
        }
      }
    }
    if (S.phase === 'play' && S.respawnAt && now >= S.respawnAt) {
      S.respawnAt = null;
      while ((S.bombs || []).length < wantBombs(S.alive.length) && spawn(ctx, now));
      changed = true;
    }
    return changed;
  },

  // 봇: 콤보 치는 시간만큼 기다렸다가 아무한테나 던진다 (가끔 반사). 유령이면 가끔 방해.
  bot(ctx, id, mem) {
    const S = ctx.state;
    if (S.phase !== 'play') return null;
    const now = ctx.now();
    const b = S.bombs?.find(x => x.holder === id);
    if (b) {
      const key = `${b.id}:${b.seq}`;
      if (mem.key !== key) {
        mem.key = key;
        mem.at = now + comboLength(now - b.born) * (220 + Math.random() * 260) + 300 + Math.random() * 1500;
      }
      if (now < mem.at) return null;
      const others = S.alive.filter(x => x !== id && !S.bombs.some(y => y.holder === x));
      const hasOther = others.some(x => x !== b.from);
      const canReflect = !S.reflectUsed?.[id];
      const fresh = others.filter(x => x !== b.from);
      const pool = !hasOther || (canReflect && others.includes(b.from) && Math.random() < 0.2) ? others : fresh;
      if (!pool.length) return null;
      return { type: 'throw', data: { bomb: b.id, seq: b.seq, target: pick(pool) }, say: Math.random() < 0.15 };
    }
    if (!S.alive.includes(id) && S.roster.some(p => p.id === id)) {
      const holders = (S.bombs || []).map(x => x.holder);
      if (holders.length && now - (S.lastHaunt?.[id] || 0) > HAUNT_COOLDOWN + 1500 && Math.random() < 0.02) {
        return { type: 'haunt', data: { target: pick(holders) } };
      }
    }
    return null;
  },

  mount(root, api) {
    const me = api.me;
    const center = h('div', { class: 'bt-center' });
    const table = h('div', { class: 'bt-table' }, h('div', { class: 'bt-oval' }), center);
    const panel = h('div', { class: 'bt-panel' });
    const box = h('div', { class: 'bt-box' }, table, panel);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'bt' }, box, side));
    document.activeElement?.blur?.();

    let S = null;
    let seatKey = '';
    const seats = new Map();    // pid → { el, x, y }
    const bombEls = new Map();  // bombId → el
    let combo = null;           // 내 폭탄 콤보 { key, bomb, seq, arrows, pos, done, thrown }
    let panelKey = '';
    let refs = {};
    let nav = null;
    let seenHaunt = null;
    let seenBoom = null;
    const who = id => S.roster.find(p => p.id === id) || { id, name: '?' };
    const alive = () => S.alive.includes(me);
    const inRoster = () => S.roster.some(p => p.id === me);
    const myBomb = () => S.bombs?.find(b => b.holder === me);

    // 둥근 테이블: 나는 항상 아래쪽 자리
    function layoutSeats() {
      const key = S.roster.map(p => p.id).join();
      if (key === seatKey) return;
      seatKey = key;
      for (const s of seats.values()) s.el.remove();
      seats.clear();
      const n = S.roster.length;
      const mine = Math.max(0, S.roster.findIndex(p => p.id === me));
      S.roster.forEach((p, i) => {
        const a = (Math.PI / 2) + ((i - mine) * 2 * Math.PI) / n;
        const x = 50 + 40 * Math.cos(a);
        const y = 50 + 36 * Math.sin(a);
        const el = h('div', { class: 'bt-seat', style: `left:${x}%;top:${y}%` },
          avatar(p, 'lg'), h('span', { class: 'bt-name' }, p.name));
        table.append(el);
        seats.set(p.id, { el, x, y });
      });
    }

    function paintSeats() {
      for (const [id, s] of seats) {
        s.el.classList.toggle('dead', !S.alive.includes(id));
        s.el.classList.toggle('holding', !!S.bombs?.some(b => b.holder === id));
        s.el.classList.toggle('me', id === me);
      }
      const live = new Set();
      for (const b of S.bombs || []) {
        live.add(b.id);
        let el = bombEls.get(b.id);
        const seat = seats.get(b.holder);
        if (!el) {
          el = h('div', { class: 'bt-bomb' }, '💣');
          bombEls.set(b.id, el);
          table.append(el);
          if (seat) el.style.cssText = `left:${seat.x}%;top:${seat.y}%`;
          void el.offsetWidth;
        }
        if (seat) {
          el.style.left = `${seat.x}%`;
          el.style.top = `${seat.y}%`;
        }
        el.className = `bt-bomb heat${b.heat || 0}`;
      }
      for (const [id, el] of bombEls) {
        if (live.has(id)) continue;
        el.remove();
        bombEls.delete(id);
      }
    }

    function checkBooms() {
      const list = S.booms || [];
      if (seenBoom === null) {
        seenBoom = Math.max(0, ...list.map(x => x.at));
        return;
      }
      for (const x of list) {
        if (x.at <= seenBoom) continue;
        seenBoom = x.at;
        const seat = seats.get(x.pid);
        if (!seat) continue;
        const boom = h('div', { class: 'bt-boom', style: `left:${seat.x}%;top:${seat.y}%` }, '💥');
        table.append(boom);
        box.classList.add('shaking');
        setTimeout(() => box.classList.remove('shaking'), 500);
        setTimeout(() => boom.remove(), 1400);
      }
    }

    // 유령 방해가 나한테 오면: 콤보에 화살표 2개 추가 (던지기 직전이었으면 다시 콤보로)
    function checkHaunts() {
      const list = S.haunts || [];
      if (seenHaunt === null) {
        seenHaunt = Math.max(0, ...list.map(x => x.at));
        return;
      }
      for (const x of list) {
        if (x.at <= seenHaunt) continue;
        seenHaunt = x.at;
        if (x.to !== me || !combo || combo.thrown) continue;
        combo.arrows.push(...randomArrows(2));
        combo.done = false;
        const tag = h('div', { class: 'fx-by' }, `👻 ${who(x.by).name}의 방해! 화살표 +2`);
        box.append(tag);
        setTimeout(() => tag.remove(), 1600);
        panelKey = '';
      }
    }

    function syncCombo() {
      const b = myBomb();
      if (!b || S.phase !== 'play') {
        combo = null;
        return;
      }
      const key = `${b.id}:${b.seq}`;
      if (combo?.key === key) return;
      combo = { key, bomb: b.id, seq: b.seq, arrows: randomArrows(comboLength(api.now() - b.born)), pos: 0, done: false, thrown: false };
    }

    function onKey(e) {
      if (isTyping(e) || !S || S.phase !== 'play') return;
      const dir = KEYMAP[e.code];
      if (!dir) return;
      if (!combo || combo.done) {
        if (e.code.startsWith('Key')) e.preventDefault();
        return; // 던질 사람 고르기는 keyNav가 방향키를 받는다
      }
      e.preventDefault();
      if (e.repeat) return;
      if (combo.arrows[combo.pos] === dir) {
        combo.pos += 1;
        if (combo.pos >= combo.arrows.length) combo.done = true;
      } else {
        combo.pos = 0;
        panel.classList.remove('nope');
        void panel.offsetWidth;
        panel.classList.add('nope');
      }
      render();
    }
    window.addEventListener('keydown', onKey);

    function comboView() {
      refs.arrows = combo.arrows.map((d, i) => h('span', { class: `bt-arrow${i < combo.pos ? ' done' : ''}${i === combo.pos ? ' next' : ''}` }, ARROW[d]));
      return h('div', { class: 'bt-act' },
        h('div', { class: 'bt-act-title hot' }, '💣 폭탄 받음! 빨리 쳐!'),
        h('div', { class: 'bt-arrows' }, refs.arrows),
        h('p', { class: 'muted' }, '방향키 (또는 WASD) · 틀리면 처음부터'));
    }

    function aimView() {
      const b = myBomb();
      const others = S.alive.filter(id => id !== me && !S.bombs.some(x => x.holder === id));
      const hasOther = others.some(id => id !== b.from);
      const canReflect = !S.reflectUsed?.[me];
      const btns = others.map(id => {
        const giver = id === b.from && hasOther;
        const blocked = giver && !canReflect;
        return h('button', {
          class: `vote-btn${giver ? ' giver' : ''}`,
          tabindex: '-1',
          disabled: blocked ? true : null,
          onClick: () => {
            if (combo.thrown) return;
            combo.thrown = true;
            api.send('throw', { bomb: b.id, seq: b.seq, target: id });
            render();
          },
        }, avatar(who(id), 'lg'), h('span', {}, who(id).name),
        giver ? h('em', { class: 'bt-tag' }, blocked ? '🔒 방금 준 사람' : '🔄 반사(1번)') : null);
      });
      nav = keyNav(btns);
      return h('div', { class: 'bt-act' },
        h('div', { class: 'bt-act-title hot' }, '누구한테 던질래? 🎯'),
        h('div', { class: 'vote-grid' }, btns),
        h('p', { class: 'muted' }, '숫자키로 바로 던지기'));
    }

    function ghostView() {
      const holders = (S.bombs || []).map(b => b.holder).filter(id => S.alive.includes(id));
      const ready = api.now() - (S.lastHaunt?.[me] || 0) >= HAUNT_COOLDOWN;
      const btns = holders.map(id => h('button', {
        class: 'vote-btn', tabindex: '-1', disabled: ready ? null : true,
        onClick: () => api.send('haunt', { target: id }),
      }, avatar(who(id), 'lg'), h('span', {}, `${who(id).name} 💣`)));
      if (ready && btns.length) nav = keyNav(btns);
      return h('div', { class: 'bt-act' },
        h('div', { class: 'bt-act-title' }, '👻 유령 모드'),
        h('p', {}, '폭탄 든 사람을 골라 콤보에 화살표 +2 (5초마다)'),
        btns.length ? h('div', { class: 'vote-grid' }, btns) : h('p', { class: 'muted' }, '폭탄 기다리는 중…'),
        ready ? null : h('p', { class: 'muted small' }, '재충전 중…'));
    }

    function panelView() {
      if (S.phase === 'intro') {
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, '💣 폭탄 돌리기'),
          h('ul', { class: 'rules big' },
            h('li', {}, '폭탄을 받으면 화면의 방향키 콤보를 끝까지 쳐야 넘길 수 있어요'),
            h('li', {}, '넘길 사람은 숫자키로 직접 고르기. 방금 준 사람한테는 못 돌려줌 (반사 1번)'),
            h('li', {}, '터지는 시간은 아무도 몰라요. 오래 돌수록 콤보가 길어짐'),
            h('li', {}, `들고 있다 터지면 탈락, 넘긴 사람이 킬${S.alive.length >= 6 ? ' · 지금은 폭탄 2개!' : ''}`),
            h('li', {}, '탈락하면 👻 유령: 폭탄 든 사람 콤보에 화살표 추가')),
          countdown(S.phaseEndsAt, INTRO_TIME));
      }
      if (S.phase === 'final') {
        const winner = who(S.placement?.[0]);
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, `👑 ${winner.name} 최후의 생존자!`),
          podium(S.roster, S.standings, me));
      }
      if (combo && !combo.done) return comboView();
      if (combo && combo.done && !combo.thrown) return aimView();
      if (combo?.thrown) return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, '휙~ 💨'));
      if (alive()) {
        const holders = (S.bombs || []).map(b => who(b.holder).name).join(', ');
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, '😰 폭탄 피하는 중'),
          h('p', {}, holders ? `지금 ${holders} 손에 폭탄!` : '다음 폭탄 준비 중…'),
          h('p', { class: 'muted' }, '받으면 바로 방향키! · Enter로 도발 가능'));
      }
      if (inRoster()) return ghostView();
      return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, '👀 관전 중'));
    }

    function renderPanel() {
      let key = S.phase;
      if (S.phase === 'play') {
        if (combo) key += `:c:${combo.key}:${combo.done}:${combo.thrown}:${combo.arrows.length}`;
        else if (alive()) key += `:a:${(S.bombs || []).map(b => b.holder).join()}`;
        else if (inRoster()) {
          const ready = api.now() - (S.lastHaunt?.[me] || 0) >= HAUNT_COOLDOWN;
          key += `:g:${ready}:${(S.bombs || []).map(b => b.holder).join()}`;
        }
      }
      if (key !== panelKey) {
        panelKey = key;
        nav?.destroy();
        nav = null;
        refs = {};
        panel.replaceChildren(panelView());
      } else if (refs.arrows && combo) {
        refs.arrows.forEach((el, i) => {
          el.classList.toggle('done', i < combo.pos);
          el.classList.toggle('next', i === combo.pos);
        });
      }
      const b = myBomb();
      panel.classList.toggle('heat1', b?.heat === 1);
      panel.classList.toggle('heat2', b?.heat === 2);
    }

    function renderCenter() {
      const n = (S.bombs || []).length;
      center.replaceChildren(
        h('div', { class: 'bt-center-big' }, S.phase === 'final' ? '🏁' : '💣'.repeat(Math.max(1, n))),
        h('div', { class: 'bt-center-sub' }, S.phase === 'play' ? `생존 ${S.alive.length}명` : S.phase === 'intro' ? '곧 시작' : '끝!'));
    }

    function renderSide() {
      const deadList = (S.outOrder || []).map(id => {
        const by = S.dead?.[id];
        return h('li', {}, h('b', {}, who(id).name), by && by !== '-' ? ` ← ${who(by).name} 💣` : ' 💥 자폭');
      });
      const killers = Object.entries(S.kills || {}).sort((a, b) => b[1] - a[1]);
      side.replaceChildren(...[
        h('h3', {}, `생존 ${S.alive.length}명`),
        h('div', { class: 'tc-alive' }, S.alive.map(id => h('span', { class: 'tc-alive-chip' },
          avatar(who(id)), who(id).name, S.bombs?.some(b => b.holder === id) ? ' 💣' : ''))),
        deadList.length ? h('h3', {}, '폭사 기록') : null,
        deadList.length ? h('ul', { class: 'rules' }, deadList) : null,
        killers.length ? h('h3', {}, '킬') : null,
        killers.length ? h('ul', { class: 'rules' }, killers.map(([id, n]) => h('li', {}, `${who(id).name} ${n}킬`))) : null,
        h('h3', {}, '조작'),
        h('ul', { class: 'rules' },
          h('li', {}, '콤보: 방향키 또는 WASD'),
          h('li', {}, '던지기: 숫자키 (또는 ← → 고르고 스페이스)'),
          h('li', {}, '유령: 숫자키로 방해')),
      ].filter(Boolean));
    }

    function render() {
      layoutSeats();
      syncCombo();
      paintSeats();
      renderCenter();
      renderPanel();
      renderSide();
    }

    // 유령 재충전 표시가 풀리도록 가끔 다시 그린다
    const timer = setInterval(() => { if (S && !alive() && S.phase === 'play') renderPanel(); }, 500);

    return {
      update({ state }) {
        S = state;
        layoutSeats();
        checkBooms();
        syncCombo();
        checkHaunts();
        render();
      },
      unmount() {
        clearInterval(timer);
        nav?.destroy();
        window.removeEventListener('keydown', onKey);
      },
    };
  },
};
