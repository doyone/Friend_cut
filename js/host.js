// 방장 컴퓨터가 게임 규칙을 돌린다. 다른 사람들은 입력(input)만 보내고,
// 방장이 판정한 결과(state)를 받아서 화면에 그린다.
// 시간 판정은 전부 state 안의 '서버 시각 마감'으로 하기 때문에, 방장이 바뀌어도
// 새 방장이 state를 읽어서 그대로 이어서 돌릴 수 있다.
//
// 게임이 끝나면(state.over) 방장이 공통 결과를 처리한다:
// 오늘 점수 지급 → 1등 스티커 탈출 → 1등이 꼴찌에게 붙일 스티커 고르기(20초, 안 고르면 랜덤).
import { STICKERS, stickerInfo } from './ui.js';
import { josa, pick } from './util.js';
import { TAUNTS } from './chat.js';

const RANK_POINTS = { 1: 5, 2: 3, 3: 2 }; // 나머지 1점, 꼴찌 0점
const STICKER_TIME = 20000;
const MAX_STICKERS = 3;

// standings(클수록 잘함, 게임이 안 정하면 scores)로 등수와 오늘 점수를 매긴다. 동점은 같은 등수.
export function rankStandings(roster, standings) {
  const rows = roster.map(p => ({ id: p.id, v: Number(standings?.[p.id]) || 0 })).sort((a, b) => b.v - a.v);
  for (const r of rows) r.rank = 1 + rows.filter(o => o.v > r.v).length;
  const tied = rows.every(r => r.v === rows[0]?.v);
  const last = Math.max(...rows.map(r => r.rank));
  for (const r of rows) r.pts = tied ? 1 : r.rank === last ? 0 : (RANK_POINTS[r.rank] || 1);
  return {
    rows,
    winners: tied ? [] : rows.filter(r => r.rank === 1).map(r => r.id),
    losers: tied ? [] : rows.filter(r => r.rank === last).map(r => r.id),
  };
}

// 나를 가장 많이 죽인 사람 = 내 원수
export function nemesisOf(kills, id) {
  let best = null;
  let most = 0;
  for (const [killer, victims] of Object.entries(kills || {})) {
    const n = Number(victims?.[id]) || 0;
    if (n > most) {
      most = n;
      best = killer;
    }
  }
  return best;
}

export class GameHost {
  constructor(net, room, game, run) {
    this.net = net;
    this.room = room;
    this.game = game;
    this.run = run;
    this.online = new Set();
    this.inbox = {};
    this.done = new Set();
    this.priv = {};
    this.outbox = [];
    this.killQueue = [];
    this.result = null;
    this.botMem = new Map(); // 봇마다 기억해 둘 것 (언제 누를지 등)
  }

  p(sub) {
    return this.room.path(`game/${sub}`);
  }

  setOnline(ids) {
    this.online = new Set(ids);
  }

  async start() {
    const [state, secret, result] = await Promise.all([
      this.net.get(this.p('state')), this.net.get(this.p('secret')), this.net.get(this.p('result')),
    ]);
    if (this.stopped || !state || state.run !== this.run) return;
    this.result = result?.run === this.run ? result : null;
    this.ctx = {
      state,
      secret: secret || {},
      roster: state.roster || [],
      now: () => this.net.now(),
      isOnline: id => this.online.has(id),
      setPrivate: (id, data) => { this.priv[id] = data; },
      nameOf: id => state.roster?.find(p => p.id === id)?.name || '?',
      // 채팅에 시스템 메시지 올리기 ("💥 지우 부정출발" 같은 것)
      announce: text => { this.outbox.push(String(text)); },
      // 킬 기록: 원수 기록에 쌓이고, 원수를 잡으면 복수 보너스
      kill: (killer, victim, how = '') => { this.killQueue.push({ killer, victim, how }); },
    };
    this.secretJson = JSON.stringify(this.ctx.secret);
    this.unsub = this.net.on(this.p('inputs'), v => {
      this.inbox = v || {};
      for (const k of this.done) if (!(k in this.inbox)) this.done.delete(k);
      this.step(); // 탭이 백그라운드라 타이머가 느려져도 입력은 바로 처리
    });
    this.timer = setInterval(() => this.step(), this.game.tickMs || 100); // 움직임이 많은 게임은 더 자주
  }

  step() {
    if (this.stopped || !this.ctx) return;
    const { game, ctx } = this;
    let changed = false;
    for (const k of Object.keys(this.inbox).sort()) {
      if (this.done.has(k)) continue;
      this.done.add(k);
      const inp = this.inbox[k] || {};
      const input = { pid: inp.pid, type: inp.type, data: inp.data || {} };
      try {
        if (String(input.type).startsWith('__')) this.commonInput(input);
        else if (game.onInput?.(ctx, input)) changed = true;
      } catch (e) {
        console.error('[host] onInput', e);
      }
      this.net.remove(this.p(`inputs/${k}`));
    }
    if (game.bot && !ctx.state.over) {
      // 봇 차례: 게임의 bot()이 정한 행동을 그 봇이 보낸 입력처럼 처리한다
      for (const p of ctx.state.roster || []) {
        if (!p.bot || !this.online.has(p.id)) continue;
        let mem = this.botMem.get(p.id);
        if (!mem) this.botMem.set(p.id, (mem = {}));
        try {
          const act = game.bot(ctx, p.id, mem);
          if (act && game.onInput?.(ctx, { pid: p.id, type: act.type, data: act.data || {} })) {
            changed = true;
            if (act.say) this.botSay(p, act.say === true ? pick(TAUNTS) : act.say);
          }
        } catch (e) {
          console.error('[host] bot', e);
        }
      }
    }
    try {
      if (!ctx.state.over && game.tick?.(ctx)) changed = true;
    } catch (e) {
      console.error('[host] tick', e);
    }
    if (changed) this.commit();
    this.flush();
    if (ctx.state.over && !this.awardStarted) {
      this.awardStarted = true;
      this.award().catch(e => console.error('[host] award', e));
    }
    const r = this.result;
    if (r?.stickerUntil && !r.sticker) {
      const botWinner = r.winners.every(id => this.isBot(id)) ? r.winners[0] : null;
      if (botWinner && ctx.now() - (r.at || 0) > 2500) this.applySticker(pick(STICKERS).id, botWinner);
      else if (ctx.now() >= r.stickerUntil) this.applySticker(pick(STICKERS).id, null);
    }
  }

  isBot(id) {
    return !!this.ctx?.state.roster?.find(p => p.id === id)?.bot;
  }

  botSay(p, text) {
    this.net.push(this.room.path('chat'), {
      pid: p.id, name: p.name, color: p.color, face: p.face, text, t: this.net.now(), taunt: true,
    });
  }

  commit() {
    const { state, secret } = this.ctx;
    this.net.set(this.p('state'), state);
    const sj = JSON.stringify(secret);
    if (sj !== this.secretJson) {
      this.secretJson = sj;
      this.net.set(this.p('secret'), secret);
    }
    for (const [id, data] of Object.entries(this.priv)) this.net.set(this.p(`private/${id}`), data);
    this.priv = {};
  }

  sys(text) {
    this.net.push(this.room.path('chat'), { sys: true, text, t: this.net.now() });
  }

  flush() {
    for (const text of this.outbox.splice(0)) this.sys(text);
    for (const k of this.killQueue.splice(0)) this.recordKill(k).catch(e => console.error('[host] kill', e));
  }

  async recordKill({ killer, victim, how }) {
    const name = this.ctx.nameOf;
    const revenge = nemesisOf(this.room.snap.stats?.kills, killer) === victim;
    await this.net.transaction(this.room.path(`stats/kills/${killer}/${victim}`), cur => (Number(cur) || 0) + 1);
    this.sys(`💀 ${name(killer)} → ${name(victim)}${how ? ` ${how}` : ''}`);
    if (revenge) {
      await this.addSeason({ [killer]: 1 });
      this.sys(`🔥 ${name(killer)} 복수 성공! 원수 ${name(victim)} 처치 (+1점)`);
    }
  }

  addSeason(gains) {
    return this.net.transaction(this.room.path('stats/season'), cur => {
      const next = { ...(cur || {}) };
      for (const [id, g] of Object.entries(gains)) next[id] = (Number(next[id]) || 0) + g;
      return next;
    });
  }

  async award() {
    const { state, nameOf } = this.ctx;
    // 방장이 바뀌어도 한 판에 딱 한 번만 지급
    const once = await this.net.transaction(this.room.path(`stats/awarded/${this.run}`), cur => (cur ? undefined : true));
    if (!once.committed) {
      this.result = (await this.net.get(this.p('result'))) || null;
      return;
    }
    const { rows, winners, losers } = rankStandings(state.roster, state.standings || state.scores);
    const titles = {};
    const addTitle = (id, t) => { (titles[id] ||= []).push(t); };
    for (const [id, list] of Object.entries(state.titles || {})) for (const t of list || []) addTitle(id, t);
    for (const id of losers) addTitle(id, '🤡 이번 판 호구');

    await this.addSeason(Object.fromEntries(rows.map(r => [r.id, r.pts])));
    const stickers = this.room.snap.stats?.stickers || {};
    for (const id of winners) {
      if (!stickers[id]?.length) continue;
      await this.net.set(this.room.path(`stats/stickers/${id}`), null);
      this.sys(`✨ ${nameOf(id)} 1등 해서 스티커 탈출!`);
    }

    const result = { run: this.run, rows, winners, losers, titles, at: this.net.now() };
    if (winners.length && losers.length) result.stickerUntil = this.net.now() + STICKER_TIME;
    this.result = result;
    await this.net.set(this.p('result'), result);
    if (winners.length) this.sys(`🏆 ${winners.map(nameOf).join(', ')} 승리!`);
    const gloat = state.roster.find(p => p.bot && winners.includes(p.id));
    if (gloat) setTimeout(() => this.botSay(gloat, pick(TAUNTS)), 900);
  }

  commonInput({ pid, type, data }) {
    if (type === '__sticker' && this.result?.winners?.includes(pid)) this.applySticker(data.id, pid);
  }

  async applySticker(id, by) {
    const r = this.result;
    const s = stickerInfo(id);
    if (!r || r.sticker || !s) return;
    r.sticker = by ? { id, by } : { id };
    await this.net.set(this.p('result/sticker'), r.sticker);
    for (const loser of r.losers) {
      await this.net.transaction(this.room.path(`stats/stickers/${loser}`),
        cur => [...(Array.isArray(cur) ? cur : []), id].slice(-MAX_STICKERS));
    }
    const { nameOf } = this.ctx;
    const who = r.losers.map(nameOf).join(', ');
    this.sys(by
      ? `${s.emoji} ${josa(nameOf(by), '이', '가')} ${who} 얼굴에 ${s.label} 붙임 ㅋㅋ`
      : `${s.emoji} 시간 초과! ${who} 얼굴에 ${s.label} 랜덤 부착`);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.unsub?.();
  }
}
