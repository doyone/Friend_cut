import { josa, pick, randId, session } from './util.js';

export const MAX_PLAYERS = 8;   // 게임에 같이 하는 사람 (봇 포함)
export const MAX_WATCHERS = 8;  // 👀 관전은 따로 8명까지 (참가 자리가 꽉 차도 구경은 할 수 있게)
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ'.split(''); // I, L, O 는 헷갈려서 뺌
const COLORS = ['#ff7ad9', '#f1c40f', '#2ecc71', '#3498db', '#e67e22', '#9b59b6', '#1abc9c', '#e74c3c'];
const ROOM_TTL = 6 * 60 * 60 * 1000;
const EMPTY_TTL = 10 * 60 * 1000;
const BOT_NAMES = ['감자봇', '두부봇', '만두봇', '호떡봇', '찐빵봇', '김밥봇', '라면봇', '순대봇'];

// 탭마다 다른 플레이어. 새로고침해도 같은 사람으로 다시 들어온다.
export function myId() {
  let id = session.get('fcg-pid');
  if (!id) {
    id = randId(12);
    session.set('fcg-pid', id);
  }
  return id;
}

// nicks: 꼴찌 별명 { id: '바보같은' } → 보이는 이름은 '바보같은 민준' (원래 닉네임은 base)
export const withNick = (name, nick) => (nick ? `${nick} ${name}` : name);

// 관전하는 사람(watch)은 게임 참가자(roster)에 안 들어가고 구경만 한다
export const isWatcher = p => !!p?.watch;
export const playingIds = players => Object.keys(players || {}).filter(id => !players[id]?.watch);

export function sortedPlayers(players, nicks = {}) {
  return Object.entries(players || {})
    .map(([id, p]) => ({ id, ...p, base: p.name, name: withNick(p.name, nicks?.[id]) }))
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
}

export async function roomExists(net, code) {
  return !!(await net.get(`rooms/${code}/meta`));
}

// 오래됐거나 아무도 없는 방을 정리한다. 방을 만들 때마다 한 번씩.
async function sweep(net) {
  try {
    const rooms = await net.get('rooms');
    const now = net.now();
    const dead = Object.entries(rooms || {}).filter(([, room]) => {
      const age = now - (room?.meta?.createdAt || 0);
      return !room?.meta || age > ROOM_TTL || (!room.players && age > EMPTY_TTL);
    });
    await Promise.all(dead.map(([code]) => net.remove(`rooms/${code}`)));
  } catch (e) {
    console.warn('방 정리 실패', e);
  }
}

export async function createRoom(net, defaultGame) {
  await sweep(net);
  for (let i = 0; i < 30; i++) {
    const code = Array.from({ length: 4 }, () => pick(CODE_CHARS)).join('');
    const res = await net.transaction(`rooms/${code}/meta`, cur => (cur ? undefined : {
      hostId: myId(), status: 'lobby', game: defaultGame, createdAt: net.now(),
    }));
    if (res.committed) return code;
  }
  throw new Error('방 코드를 만들지 못했어요. 다시 눌러 주세요');
}

export class RoomSession {
  constructor(net, code, name, face = 0) {
    this.net = net;
    this.code = code;
    this.name = name;
    this.face = face;
    this.id = myId();
    this.snap = { meta: null, players: null, state: null, priv: null, votes: null, stats: null, result: null };
    this.got = new Set();
    this.unsubs = [];
    this.onChange = () => {};
    this.onChat = () => {};
    this.onKicked = () => {};
  }

  path(sub) {
    return sub ? `rooms/${this.code}/${sub}` : `rooms/${this.code}`;
  }

  get ready() {
    return this.got.has('meta') && this.got.has('players');
  }

  // watch: true = 관전으로 들어가기, false = 참가로, 안 주면 이 탭이 하던 대로 (새로고침해도 관전은 관전)
  async enter({ watch: wantWatch } = {}) {
    const meta = await this.net.get(this.path('meta'));
    if (!meta) throw new Error(`${this.code} 방을 찾을 수 없어요`);
    if (await this.net.get(this.path(`kicked/${this.id}`))) throw new Error(`${this.code} 방에서 강퇴당해서 다시 들어갈 수 없어요`);
    const players = (await this.net.get(this.path('players'))) || {};
    const prev = players[this.id];
    const others = Object.entries(players).filter(([id]) => id !== this.id).map(([, p]) => p);
    const playing = others.filter(p => !p.watch).length;
    const saved = session.get('fcg-watch');
    let watchMe = wantWatch ?? (prev ? !!prev.watch : saved?.code === this.code && !!saved.watch);
    this.full = false;
    if (!watchMe && playing >= MAX_PLAYERS) {
      watchMe = true; // 참가 자리가 꽉 찼으면 관전으로
      this.full = true;
    }
    if (watchMe && !prev?.watch && others.length - playing >= MAX_WATCHERS) {
      throw new Error(`방이 꽉 찼어요 (참가 ${MAX_PLAYERS}명 · 관전 ${MAX_WATCHERS}명)`);
    }
    session.set('fcg-watch', { code: this.code, watch: watchMe });
    const used = new Set(others.filter(p => !p.watch).map(p => p.color));
    this.me = {
      name: this.name,
      face: this.face,
      color: prev?.color || COLORS.find(c => !used.has(c)) || pick(COLORS),
      joinedAt: prev?.joinedAt || this.net.now(),
      ...(watchMe ? { watch: true } : {}),
    };
    await this.announce();
    // 와이파이가 잠깐 끊겼다 붙으면 서버가 나를 지웠을 수 있으니 다시 등록한다.
    this.unsubs.push(this.net.onConnected(ok => ok && this.announce()));

    const watch = (sub, key) => this.unsubs.push(this.net.on(this.path(sub), v => {
      this.snap[key] = v;
      this.got.add(key);
      if (key === 'players') this.syncMe(v?.[this.id]);
      this.changed();
    }));
    watch('meta', 'meta');
    watch('players', 'players');
    // 강퇴: 방장이 kicked에 내 id를 적으면 바로 나간다 (자동 재접속으로 다시 들어오지도 않게)
    this.unsubs.push(this.net.on(this.path(`kicked/${this.id}`), v => {
      if (v && !this.left && !this.kicked) {
        this.kicked = true;
        this.onKicked();
      }
    }));
    watch('game/state', 'state');
    watch(`game/private/${this.id}`, 'priv');
    watch('votes', 'votes');
    watch('stats', 'stats');
    watch('game/result', 'result');
    // 채팅은 화면 전체를 다시 그리지 않도록 따로 받는다.
    this.unsubs.push(this.net.on(this.path('chat'), v => this.onChat(v || {})));
  }

  async announce() {
    if (this.left || this.kicked) return null;
    // 강퇴당한 뒤 노트북을 다시 열었을 때 슬쩍 다시 들어가지 않게
    if (await this.net.get(this.path(`kicked/${this.id}`))) {
      if (!this.kicked) {
        this.kicked = true;
        this.onKicked();
      }
      return null;
    }
    const p = this.path(`players/${this.id}`);
    return Promise.all([this.net.onDisconnectRemove(p), this.net.set(p, this.me)]);
  }

  // 방장이 나를 관전으로 보냈거나 색을 바꿨으면, 재접속할 때 옛 값으로 덮어쓰지 않게 맞춰 둔다
  syncMe(rec) {
    if (!rec || !this.me) return;
    const watch = !!rec.watch;
    if (watch !== !!this.me.watch || (rec.color && rec.color !== this.me.color)) {
      const { watch: _old, ...rest } = this.me;
      this.me = { ...rest, color: rec.color || this.me.color, ...(watch ? { watch: true } : {}) };
    }
    session.set('fcg-watch', { code: this.code, watch });
  }

  get watching() {
    return !!this.me?.watch;
  }

  changed() {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (!this.ready || this.left) return;
      this.claimHostIfNeeded();
      this.onChange();
    });
  }

  // 방장이 나가면 가장 먼저 들어온 사람이 방장을 물려받는다.
  claimHostIfNeeded() {
    const { meta, players } = this.snap;
    if (!meta || !players || players[meta.hostId] || this.claiming) return;
    const first = sortedPlayers(players).find(p => !p.bot); // 봇은 방장이 될 수 없다
    if (first?.id !== this.id) return;
    this.claiming = true;
    this.net.transaction(this.path('meta/hostId'), cur => (!cur || players[cur] ? undefined : this.id))
      .finally(() => { this.claiming = false; });
  }

  send(type, data) {
    this.net.push(this.path('game/inputs'), { pid: this.id, type, data: data ?? null, t: this.net.now() });
  }

  chat(text, taunt = false) {
    const { color, face } = this.me;
    const name = withNick(this.me.name, this.snap.stats?.nicks?.[this.id]);
    this.net.push(this.path('chat'), {
      pid: this.id, name, color, face, text, t: this.net.now(), ...(taunt ? { taunt: true } : {}), ...(this.watching ? { watch: true } : {}),
    });
  }

  // 혼자 테스트하거나 사람이 모자랄 때: 봇은 방장 컴퓨터가 대신 조작한다.
  // 새로고침해도 방에 남아 있도록 접속 끊김 자동 삭제는 걸지 않는다.
  async addBot() {
    // B를 연타하면 목록이 갱신되기 전에 또 들어오므로, 방금 넣은 봇도 같이 센다
    const now = Date.now();
    this.recentBots = (this.recentBots || []).filter(b => now - b.at < 3000);
    const list = [...Object.values(this.snap.players || {}), ...this.recentBots];
    const ids = new Set([...playingIds(this.snap.players), ...this.recentBots.map(b => b.id)]);
    if (ids.size >= MAX_PLAYERS) throw new Error(`참가 자리가 꽉 찼어요 (최대 ${MAX_PLAYERS}명)`);
    const names = new Set(list.map(p => p.name));
    const colors = new Set(list.map(p => p.color));
    const bot = {
      name: BOT_NAMES.find(n => !names.has(n)) || `봇${randId(3)}`,
      bot: true,
      face: Math.floor(Math.random() * 20),
      color: COLORS.find(c => !colors.has(c)) || pick(COLORS),
      joinedAt: this.net.now(),
    };
    const id = `bot${randId(8)}`;
    this.recentBots.push({ ...bot, id, at: now });
    await this.net.set(this.path(`players/${id}`), bot);
    return bot.name;
  }

  removeBot(id) {
    // 연타 대비: 방금 뺀 봇은 목록에 아직 남아 있어도 건너뛴다
    const now = Date.now();
    this.removedBots = (this.removedBots || []).filter(b => now - b.at < 3000);
    const gone = new Set(this.removedBots.map(b => b.id));
    const bots = sortedPlayers(this.snap.players).filter(p => p.bot && !gone.has(p.id));
    const target = id ? bots.find(p => p.id === id) : bots[bots.length - 1];
    if (!target) return null;
    this.removedBots.push({ id: target.id, at: now });
    this.net.remove(this.path(`players/${target.id}`));
    return target.name;
  }

  // 👀 관전 ↔ 🙋 참가. 관전하는 사람은 다음 판 참가자(roster)에서 빠진다 (하던 판은 끝까지).
  // 방장은 다른 사람을 관전으로 보낼 수 있다 (자리만 차지하고 안 하는 친구)
  async setWatch(on, id = this.id) {
    const players = this.snap.players || {};
    const p = players[id] || (id === this.id ? this.me : null);
    if (!p || p.bot || !!p.watch === on) return false;
    const others = Object.entries(players).filter(([k]) => k !== id).map(([, o]) => o);
    const change = { watch: on ? true : null };
    if (on) {
      if (others.filter(o => o.watch).length >= MAX_WATCHERS) throw new Error(`관전 자리가 꽉 찼어요 (최대 ${MAX_WATCHERS}명)`);
    } else {
      const playing = others.filter(o => !o.watch);
      if (playing.length >= MAX_PLAYERS) throw new Error(`참가 자리가 꽉 찼어요 (최대 ${MAX_PLAYERS}명)`);
      // 관전하는 동안 다른 사람이 같은 색을 가져갔으면 남는 색으로 바꾼다
      const used = new Set(playing.map(o => o.color));
      if (used.has(p.color)) change.color = COLORS.find(c => !used.has(c)) || p.color;
    }
    if (id === this.id) this.syncMe({ ...this.me, ...change });
    // 그 사이 나간 사람이면 아무것도 안 한다 (update는 이름 없는 빈 자리를 만들어 버림)
    await this.net.transaction(this.path(`players/${id}`), cur => (cur ? { ...cur, ...change } : undefined));
    if (on) await this.net.remove(this.path(`votes/${id}`));
    return true;
  }

  // 방장: 강퇴. kicked에 적어 두면 그 사람 화면이 알아서 나가고, 이 방엔 다시 못 들어온다 (봇은 그냥 빼기)
  async kick(id) {
    const p = this.snap.players?.[id];
    if (!p || id === this.id) return null;
    if (p.bot) return this.removeBot(id);
    const name = withNick(p.name, this.snap.stats?.nicks?.[id]);
    await this.net.set(this.path(`kicked/${id}`), true);
    await Promise.all([this.net.remove(this.path(`players/${id}`)), this.net.remove(this.path(`votes/${id}`))]);
    this.sys(`👢 ${josa(name, '이', '가')} 강퇴당했어요`);
    return name;
  }

  sys(text) {
    this.net.push(this.path('chat'), { sys: true, text, t: this.net.now() });
  }

  vote(gameId) {
    const mine = this.snap.votes?.[this.id];
    this.net.set(this.path(`votes/${this.id}`), mine === gameId ? null : gameId);
  }

  async leave() {
    this.left = true;
    for (const u of this.unsubs) u?.();
    this.unsubs = [];
    await this.net.remove(this.path(`players/${this.id}`));
  }
}
