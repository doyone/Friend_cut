import { pick, randId, session } from './util.js';

export const MAX_PLAYERS = 8;
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
  }

  path(sub) {
    return sub ? `rooms/${this.code}/${sub}` : `rooms/${this.code}`;
  }

  get ready() {
    return this.got.has('meta') && this.got.has('players');
  }

  async enter() {
    const meta = await this.net.get(this.path('meta'));
    if (!meta) throw new Error(`${this.code} 방을 찾을 수 없어요`);
    const players = (await this.net.get(this.path('players'))) || {};
    const prev = players[this.id];
    if (!prev && Object.keys(players).length >= MAX_PLAYERS) {
      throw new Error(`방이 꽉 찼어요 (최대 ${MAX_PLAYERS}명)`);
    }
    const used = new Set(Object.values(players).map(p => p.color));
    this.me = {
      name: this.name,
      face: this.face,
      color: prev?.color || COLORS.find(c => !used.has(c)) || pick(COLORS),
      joinedAt: prev?.joinedAt || this.net.now(),
    };
    await this.announce();
    // 와이파이가 잠깐 끊겼다 붙으면 서버가 나를 지웠을 수 있으니 다시 등록한다.
    this.unsubs.push(this.net.onConnected(ok => ok && this.announce()));

    const watch = (sub, key) => this.unsubs.push(this.net.on(this.path(sub), v => {
      this.snap[key] = v;
      this.got.add(key);
      this.changed();
    }));
    watch('meta', 'meta');
    watch('players', 'players');
    watch('game/state', 'state');
    watch(`game/private/${this.id}`, 'priv');
    watch('votes', 'votes');
    watch('stats', 'stats');
    watch('game/result', 'result');
    // 채팅은 화면 전체를 다시 그리지 않도록 따로 받는다.
    this.unsubs.push(this.net.on(this.path('chat'), v => this.onChat(v || {})));
  }

  announce() {
    if (this.left) return null;
    const p = this.path(`players/${this.id}`);
    return Promise.all([this.net.onDisconnectRemove(p), this.net.set(p, this.me)]);
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
    this.net.push(this.path('chat'), { pid: this.id, name, color, face, text, t: this.net.now(), ...(taunt ? { taunt: true } : {}) });
  }

  // 혼자 테스트하거나 사람이 모자랄 때: 봇은 방장 컴퓨터가 대신 조작한다.
  // 새로고침해도 방에 남아 있도록 접속 끊김 자동 삭제는 걸지 않는다.
  async addBot() {
    // B를 연타하면 목록이 갱신되기 전에 또 들어오므로, 방금 넣은 봇도 같이 센다
    const now = Date.now();
    this.recentBots = (this.recentBots || []).filter(b => now - b.at < 3000);
    const list = [...Object.values(this.snap.players || {}), ...this.recentBots];
    const ids = new Set([...Object.keys(this.snap.players || {}), ...this.recentBots.map(b => b.id)]);
    if (ids.size >= MAX_PLAYERS) throw new Error(`방이 꽉 찼어요 (최대 ${MAX_PLAYERS}명)`);
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
