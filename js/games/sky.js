// 하늘끝까지: 모두 동시에 각자 받침대에 독박 시소 물건을 쌓는다. 하늘 끝(10m)에 먼저 닿아 3초 버티면 우승.
// 1분 30초 안에 아무도 못 닿으면 가장 높은 사람이 우승. 30초·60초에 가장 낮은 사람은 컷 탈락(6명 이상이면 2명).
// 짐은 모두 같은 순서(NEXT 2개가 보임). 3m 오를 때마다 😈 택배 1개: 숫자키로 친구의 다음 짐을 굴러가는/미끌한 짐으로.
// 7m 위는 우주(중력 절반). 아래층은 굳어서 탑 전체가 무너지진 않는다(sky-core.js).
// 각자 노트북이 자기 탑 물리를 계산해서 높이·모양을 방장에게 보내고, 방장은 시간·컷·택배·우승만 본다 (봇 탑은 방장이 계산).
import { h, isTyping, pick, digitOf, AGAIN_INTRO } from '../util.js';
import { avatar, countdown } from '../ui.js';
import { KINDS, objGroup, chuteGroup, extent } from './seesaw.js';
import {
  GOAL, SPACE_Y, PLATFORM_W, X_LIMIT, STEP, KEYS, PARCELS,
  makeSeq, makeTower, stepTower, heightOf, spawnY, dropItem, snapTower, restoreTower, botAim,
} from './sky-core.js';

const PLANCK_URL = '../vendor/planck.mjs';
const INTRO = 5000;
const LIMIT = 90000;             // 1분 30초
const CUTS = [30000, 60000];     // 컷 시각 (시작부터)
const HOLD = 3000;               // 하늘 끝에서 이만큼 버티면 우승
const EARN_EVERY = 3;            // 3m 오를 때마다 택배 1개
const GHOST_GAP = 10000;         // 탈락한 사람(유령)은 10초마다 택배
const INBOX_MAX = 2;             // 한 사람에게 밀린 택배 최대
const COMMIT_EVERY = 250;        // 방장이 모두에게 보내는 간격 (높이 보고만 바뀌었을 때)
const REPORT_EVERY = 250;        // 내 높이를 방장에게
const SNAP_EVERY = 1000;         // 내 탑 모양을 방장에게 (다른 사람 화면의 작은 탑)
const NEXT_DELAY = 400;          // 떨군 뒤 다음 짐까지
const MOVE_SPEED = 3;            // 꾹 눌렀을 때 초당
const LANE = 7;                  // 아래 '모두의 탑' 한 칸 폭 (m)
const r2 = v => Math.round(v * 100) / 100;
const sec = ms => Math.max(0, Math.ceil(ms / 1000));

let planck = null;
let loading = null;
function ensurePlanck() {
  if (planck || loading) return;
  loading = import(PLANCK_URL).then(m => { planck = m; }).catch(e => {
    loading = null;
    console.error('[sky] 물리 엔진을 불러오지 못했어요', e);
  });
}
export function usePlanck(m) { planck = m; } // 테스트용

/* ───────── 심판 (방장) ───────── */

function fx(S, now, e) {
  S.fxNo = (S.fxNo || 0) + 1;
  S.fx = [...(S.fx || []), { n: S.fxNo, at: now, ...e }].slice(-8);
}

// 높이 보고: 순간이동 같은 높이(한 번에 3.5m 넘게)는 무시. 3m마다 택배, 하늘 끝에 닿은 시각 기록
function report(ctx, pid, data, now) {
  const S = ctx.state;
  if (!S.alive.includes(pid)) return false;
  const prev = S.h?.[pid] || 0;
  let hh = Math.max(0, Math.min(40, Number(data.h) || 0));
  if (hh - prev > 3.5) hh = prev;
  const best = Math.max(S.best?.[pid] || 0, hh);
  const earned = Math.floor(best / EARN_EVERY) - Math.floor((S.best?.[pid] || 0) / EARN_EVERY);
  S.h = { ...S.h, [pid]: r2(hh) };
  S.best = { ...S.best, [pid]: r2(best) };
  S.n = { ...S.n, [pid]: Math.max(S.n?.[pid] || 0, Number(data.n) | 0) };
  S.f = { ...S.f, [pid]: Number(data.f) | 0 };
  if (Array.isArray(data.tw)) S.tw = { ...S.tw, [pid]: data.tw.slice(0, 150) };
  if (earned > 0) {
    S.parcels = { ...S.parcels, [pid]: (S.parcels?.[pid] || 0) + earned };
    fx(S, now, { k: 'earn', id: pid });
  }
  const goal = { ...(S.goalAt || {}) };
  if (hh >= GOAL) goal[pid] ??= now;
  else delete goal[pid];
  S.goalAt = goal;
  ctx.dirty = true;
  return earned > 0;
}

// 😈 택배: 친구의 다음 짐을 골치 아픈 짐으로. 살아 있으면 모아 둔 택배로, 탈락했으면 10초마다
function sendParcel(ctx, from, to, now) {
  const S = ctx.state;
  if (to === from || !S.alive.includes(to) || !S.roster.some(p => p.id === from)) return false;
  const ghost = !S.alive.includes(from);
  if (ghost ? now < (S.ghostAt?.[from] || 0) : !((S.parcels?.[from] || 0) > 0)) return false;
  const box = S.inbox?.[to] || [];
  if (box.length >= INBOX_MAX) return false;
  S.parcelNo = (S.parcelNo || 0) + 1;
  const k = pick(PARCELS);
  S.inbox = { ...S.inbox, [to]: [...box, { no: S.parcelNo, k, by: from }] };
  if (ghost) S.ghostAt = { ...S.ghostAt, [from]: now + GHOST_GAP };
  else S.parcels = { ...S.parcels, [from]: S.parcels[from] - 1 };
  S.sent = { ...S.sent, [from]: (S.sent?.[from] || 0) + 1 };
  S.lastBy = { ...S.lastBy, [to]: { by: from, at: now } };
  fx(S, now, { k: 'parcel', from, to, item: k });
  ctx.announce(`😈 ${ctx.nameOf(from)} → ${ctx.nameOf(to)} 택배! (${KINDS[k].name})`);
  return true;
}

function useParcel(S, pid, no) {
  const box = S.inbox?.[pid] || [];
  if (!box.some(p => p.no === no)) return false;
  S.inbox = { ...S.inbox, [pid]: box.filter(p => p.no !== no) };
  return true;
}

// 컷: 지금 가장 낮은 사람 탈락 (6명 이상이면 2명, 두 명은 남긴다). 이번 구간에 택배를 보낸 사람이 있으면 그 사람 킬
function cut(ctx, now) {
  const S = ctx.state;
  const from = S.startAt + (S.cutNo ? CUTS[S.cutNo - 1] : 0);
  S.cutNo = (S.cutNo || 0) + 1;
  const n = S.alive.length;
  const k = Math.min(n - 2, n >= 6 ? 2 : 1);
  if (k <= 0) return;
  const order = [...S.alive].sort((a, b) => (S.h?.[a] || 0) - (S.h?.[b] || 0) || (S.best?.[a] || 0) - (S.best?.[b] || 0) || Math.random() - 0.5);
  const outs = order.slice(0, k);
  for (const id of outs) {
    S.alive = S.alive.filter(x => x !== id);
    S.out = [...(S.out || []), id];
    S.inbox = { ...S.inbox, [id]: [] };
    const goal = { ...(S.goalAt || {}) };
    delete goal[id];
    S.goalAt = goal;
    S.ghostAt = { ...S.ghostAt, [id]: now + 3000 };
    const lb = S.lastBy?.[id];
    if (lb && lb.at >= from && lb.by !== id) {
      ctx.kill(lb.by, id, '😈 택배');
      S.kills = { ...S.kills, [lb.by]: (S.kills?.[lb.by] || 0) + 1 };
    } else {
      ctx.announce(`✂️ ${ctx.nameOf(id)} 컷 탈락 (${(S.h?.[id] || 0).toFixed(1)}m)`);
    }
  }
  fx(S, now, { k: 'cut', ids: outs });
}

function finish(ctx, winner, now) {
  const S = ctx.state;
  const byH = ids => [...ids].sort((a, b) => (S.h?.[b] || 0) - (S.h?.[a] || 0) || (S.best?.[b] || 0) - (S.best?.[a] || 0));
  const alive = byH(S.alive.filter(id => id !== winner));
  const placement = [...(winner ? [winner] : []), ...alive, ...[...(S.out || [])].reverse()];
  for (const p of S.roster) if (!placement.includes(p.id)) placement.push(p.id);
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  if (winner) add(winner, '🏆 하늘 끝 정복');
  else if (placement[0]) add(placement[0], `☁️ 제일 높이 (${(S.h?.[placement[0]] || 0).toFixed(1)}m)`);
  const most = (obj, min) => Object.entries(obj || {}).filter(([, v]) => v >= min).sort((a, b) => b[1] - a[1])[0];
  const best = most(S.best, 0);
  if (best && best[0] !== placement[0]) add(best[0], `📏 최고 기록 ${best[1].toFixed(1)}m`);
  const courier = most(S.sent, 2);
  if (courier) add(courier[0], `😈 택배 기사 (${courier[1]}개)`);
  const clumsy = most(S.f, 5);
  if (clumsy) add(clumsy[0], `💥 와르르 (${clumsy[1]}개 떨굼)`);
  Object.assign(S, {
    phase: 'final', over: true, winner: winner || null, endedAt: now,
    placement, standings: Object.fromEntries(placement.map((id, i) => [id, placement.length - i])), titles,
  });
  return true;
}

// 봇 탑: 방장이 같은 물리로. 가운데 기둥의 움푹한 곳을 채우며 1.3~2초마다 떨군다
function stepBots(ctx, now) {
  const S = ctx.state;
  ctx.bots ||= new Map();
  let changed = false;
  for (const p of S.roster) {
    if (!p.bot) continue;
    let b = ctx.bots.get(p.id);
    if (!b) {
      b = { T: makeTower(planck), at: now, n: 0, nextAt: now + 600 + Math.random() * 900, err: 0.15 + Math.random() * 0.3, gap: 1300 + Math.random() * 700, sendAt: now + 4000 + Math.random() * 6000 };
      restoreTower(b.T, S.tw?.[p.id]);
      b.n = S.n?.[p.id] || 0;
      ctx.bots.set(p.id, b);
    }
    if (!S.alive.includes(p.id)) {
      // 유령 봇: 가끔 1등에게 택배
      if (now >= (S.ghostAt?.[p.id] || 0) + 1500 && Math.random() < 0.05) changed = sendParcel(ctx, p.id, leader(S, p.id), now) || changed;
      continue;
    }
    const stepMs = STEP * 1000;
    const steps = Math.min(30, Math.floor((now - b.at) / stepMs));
    b.at = steps === 30 ? now : b.at + steps * stepMs;
    for (let i = 0; i < steps; i++) stepTower(b.T);
    if (now >= b.nextAt) {
      const parcel = (S.inbox?.[p.id] || [])[0];
      const k = parcel ? parcel.k : S.seq[b.n % S.seq.length];
      const aim = botAim(b.T, k, b.err);
      dropItem(b.T, k, aim.x, aim.a);
      if (parcel) changed = useParcel(S, p.id, parcel.no) || changed;
      else b.n++;
      b.nextAt = now + b.gap * (0.8 + Math.random() * 0.4);
    }
    if (now - (b.repAt || 0) >= REPORT_EVERY) {
      b.repAt = now;
      const snap = now - (b.snapAt || 0) >= SNAP_EVERY;
      if (snap) b.snapAt = now;
      changed = report(ctx, p.id, { h: heightOf(b.T), n: b.n, f: b.T.fell, tw: snap ? snapTower(b.T) : undefined }, now) || changed;
    }
    if ((S.parcels?.[p.id] || 0) > 0 && now >= b.sendAt) {
      b.sendAt = now + 3000 + Math.random() * 6000;
      changed = sendParcel(ctx, p.id, leader(S, p.id), now) || changed;
    }
  }
  return changed;
}

// 나 말고 지금 가장 높은 사람
const leader = (S, not) => [...S.alive].filter(id => id !== not).sort((a, b) => (S.h?.[b] || 0) - (S.h?.[a] || 0))[0];

/* ───────── 화면 ───────── */

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
}
const label = (text, x, y, size, cls) => svg('text', { class: cls, transform: `translate(${x} ${y}) scale(1,-1)`, 'font-size': size }, text);

// 배경 (월드 좌표, 위가 +y): 땅·하늘·구름·우주(별), 1m 눈금, 우주 경계, 하늘 끝 선, 받침대
function backdrop(withRuler = true) {
  const stars = Array.from({ length: 70 }, (_, i) => svg('circle', {
    cx: ((i * 37.7) % 40) - 20, cy: SPACE_Y + 0.4 + ((i * 17.3) % 26), r: 0.03 + (i % 3) * 0.02, fill: '#fff', opacity: 0.5 + (i % 4) * 0.12,
  }));
  const clouds = [[-5.6, 4.6, 1.3], [5.2, 5.4, 1.6], [-4.8, 6.3, 1], [6.3, 3.8, 1.1]].map(([cx, cy, r]) => svg('g', { class: 'sk-cloud' },
    svg('ellipse', { cx, cy, rx: r, ry: r * 0.45 }), svg('ellipse', { cx: cx - r * 0.5, cy: cy - 0.1, rx: r * 0.6, ry: r * 0.35 }), svg('ellipse', { cx: cx + r * 0.55, cy: cy - 0.12, rx: r * 0.55, ry: r * 0.32 })));
  const ruler = [];
  if (withRuler) {
    for (let m = 1; m <= GOAL + 6; m++) {
      ruler.push(svg('line', { class: 'sk-tick', x1: -6.4, x2: m % 2 ? -6.15 : -5.9, y1: m, y2: m }));
      if (m % 2 === 0 && m !== GOAL) ruler.push(label(`${m}m`, -5.75, m - 0.12, 0.34, 'sk-tick-label'));
    }
  }
  return svg('g', {},
    svg('rect', { x: -40, y: -2, width: 80, height: SPACE_Y + 2, fill: 'url(#sk-sky)' }),
    svg('rect', { x: -40, y: SPACE_Y, width: 80, height: 40, fill: '#1b2445' }),
    svg('rect', { x: -40, y: SPACE_Y - 0.6, width: 80, height: 0.6, fill: 'url(#sk-edge)' }),
    ...stars, ...clouds,
    svg('rect', { x: -40, y: -12, width: 80, height: 10.5, fill: '#69db7c' }),
    svg('rect', { x: -0.45, y: -1.6, width: 0.9, height: 1.2, fill: '#495057' }),
    svg('rect', { x: -PLATFORM_W / 2, y: -0.5, width: PLATFORM_W, height: 0.5, rx: 0.08, fill: '#495057', stroke: '#343a40', 'stroke-width': 0.06 }),
    svg('rect', { x: -PLATFORM_W / 2 + 0.06, y: -0.14, width: PLATFORM_W - 0.12, height: 0.1, rx: 0.04, fill: '#868e96' }),
    ...ruler,
    svg('line', { class: 'sk-space-line', x1: -40, x2: 40, y1: SPACE_Y, y2: SPACE_Y }),
    svg('line', { class: 'sk-goal-line', x1: -40, x2: 40, y1: GOAL, y2: GOAL }));
}

function gradients() {
  return svg('defs', {},
    svg('linearGradient', { id: 'sk-sky', x1: 0, y1: 0, x2: 0, y2: 1 },
      svg('stop', { offset: 0, 'stop-color': '#4dabf7' }), svg('stop', { offset: 0.55, 'stop-color': '#a5d8ff' }), svg('stop', { offset: 1, 'stop-color': '#e7f5ff' })),
    svg('linearGradient', { id: 'sk-edge', x1: 0, y1: 0, x2: 0, y2: 1 },
      svg('stop', { offset: 0, 'stop-color': '#1b2445' }), svg('stop', { offset: 1, 'stop-color': '#4dabf7' })));
}

export default {
  id: 'sky',
  title: '하늘끝까지',
  emoji: '☁️',
  tag: '액션',
  color: '#339af0',
  desc: '모두 동시에 각자 물건을 쌓아요. 하늘 끝(10m)에 먼저 닿아 3초 버티면 우승! 30초마다 제일 낮은 사람 컷, 😈 택배로 친구 방해',
  minPlayers: 2,
  maxPlayers: 8,

  setup(ctx, prev) {
    ensurePlanck();
    const now = ctx.now();
    return {
      phase: 'intro',
      phaseEndsAt: now + (prev ? AGAIN_INTRO : INTRO),
      again: !!prev,
      seq: makeSeq(160),
      alive: ctx.roster.map(p => p.id),
      cutNo: 0,
    };
  },

  onInput(ctx, { pid, type, data = {} }) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase !== 'play') return false;
    if (type === 'tower') return report(ctx, pid, data, now);
    if (type === 'parcel') return sendParcel(ctx, pid, String(data.to || ''), now);
    if (type === 'used') return useParcel(S, pid, Number(data.no));
    return false;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    if (!planck) ensurePlanck();
    if (S.phase === 'intro') {
      if (now < S.phaseEndsAt) return false;
      Object.assign(S, { phase: 'play', startAt: now, endAt: now + LIMIT });
      fx(S, now, { k: 'start' });
      return true;
    }
    if (S.phase !== 'play') return false;
    let changed = planck ? stepBots(ctx, now) : false;
    const win = S.alive.find(id => S.goalAt?.[id] != null && now - S.goalAt[id] >= HOLD && (S.h?.[id] || 0) >= GOAL);
    if (win) return finish(ctx, win, now);
    if ((S.cutNo || 0) < CUTS.length && now >= S.startAt + CUTS[S.cutNo || 0]) {
      cut(ctx, now);
      changed = true;
    }
    if (now >= S.endAt) return finish(ctx, null, now);
    // 높이 보고만 바뀐 건 0.25초에 한 번만 모두에게 (짐 모양까지 실려서 크다)
    if (ctx.dirty && now - (ctx.sentAt || 0) >= COMMIT_EVERY) changed = true;
    if (changed) {
      ctx.dirty = false;
      ctx.sentAt = now;
    }
    return changed;
  },

  // 봇은 방장 tick에서 직접 움직인다
  bot() {
    return null;
  },

  mount(root, api) {
    const me = api.me;
    const top = h('div', { class: 'sk-top' });
    const itemsG = svg('g');
    const chutesG = svg('g');
    const guide = svg('line', { class: 'sk-guide', x1: 0, y1: 0, x2: 0, y2: 0 });
    const previewPiece = svg('g');
    const previewChute = chuteGroup();
    const previewG = svg('g', { class: 'sk-preview' }, guide, previewChute, previewPiece);
    const goalLabel = label('☁️ 하늘 끝 10m', 0, GOAL + 0.25, 0.42, 'sk-goal-label');
    const spaceLabel = label('🚀 우주 · 중력 절반', 0, SPACE_Y + 0.2, 0.34, 'sk-space-label');
    goalLabel.setAttribute('text-anchor', 'middle');
    spaceLabel.setAttribute('text-anchor', 'middle');
    const stage = svg('svg', { class: 'sk-svg', preserveAspectRatio: 'xMidYMid meet' }, gradients(),
      svg('g', { transform: 'scale(1,-1)' }, backdrop(), spaceLabel, goalLabel, itemsG, chutesG, previewG));
    const nextBox = h('div', { class: 'sk-next' });
    const holdBox = h('div', { class: 'sk-hold', hidden: true });
    const overlay = h('div', { class: 'sk-overlay' });
    const fxBox = h('div', { class: 'sk-fx' });
    const stageWrap = h('div', { class: 'sk-stage' }, stage, nextBox, holdBox, overlay, fxBox);
    const strip = svg('svg', { class: 'sk-strip', preserveAspectRatio: 'xMidYMax meet' });
    const box = h('div', { class: 'sk-box' }, top, stageWrap, strip);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'sk' }, box, side));
    document.activeElement?.blur?.();

    let S = null;
    let T = null;                 // 내 탑 (내 화면이 계산)
    let P = null;                 // planck
    const shown = new Map();      // 짐 id → { el, chute }
    const aim = { x: 0, a: 0 };
    const held = { left: false, right: false };
    const used = new Set();       // 내가 이미 쓴 택배 번호 (방장이 지우기 전에 또 쓰지 않게)
    let cur = null;               // 지금 들고 있는 짐 { k, no? }
    let n = 0;                    // 지금까지 쓴 순서 짐 수
    let nextAt = 0;
    let acc = 0;
    let last = performance.now();
    let reportAt = 0;
    let snapAt = 0;
    let myH = 0;
    let goalSince = 0;
    let wasSpace = false;
    let cam = 0;                  // 화면 맨 아래 높이 (m)
    let drawnAt = 0;
    let topKey = '';
    let sideKey = '';
    let overlayKey = '';
    let nextKey = '';
    let seenFx = null;
    const laneKeys = new Map();
    const who = id => S?.roster.find(p => p.id === id) || { id, name: '?' };
    const alive = () => !!S?.alive?.includes(me);
    const playing = () => S?.phase === 'play' && alive();
    // 숫자키 = 택배 받을 사람 (방에 들어온 순서, 나 빼고)
    const targets = () => (S?.roster || []).filter(p => p.id !== me);

    import(PLANCK_URL).then(m => {
      P = m;
      ensureTower();
    }).catch(e => console.error('[sky] 물리 엔진을 불러오지 못했어요', e));

    // 시작하면 내 탑을 만든다 (새로 고침했으면 방장이 아는 내 탑 모양에서 이어서)
    function ensureTower() {
      if (T || !P || !S || S.phase === 'intro') return;
      T = makeTower(P);
      restoreTower(T, S.tw?.[me]);
      n = S.n?.[me] || 0;
    }

    // 앞으로 받을 짐: 밀린 택배 먼저, 그다음 순서대로
    function upcoming() {
      const parcels = (S?.inbox?.[me] || []).filter(p => !used.has(p.no) && p.no !== cur?.no).map(p => ({ k: p.k, no: p.no, by: p.by }));
      const from = n + (cur && !cur.no ? 1 : 0);
      const seq = (S?.seq || []).slice(from, from + 3).map(k => ({ k }));
      return [...parcels, ...seq];
    }
    function takeNext() {
      if (cur || !S?.seq) return;
      cur = upcoming()[0] || null;
      aim.a = 0;
    }

    function drop() {
      if (!playing() || !T || !cur || performance.now() < nextAt) return;
      dropItem(T, cur.k, aim.x, aim.a);
      if (cur.no) {
        used.add(cur.no);
        api.send('used', { no: cur.no });
      } else n++;
      cur = null;
      nextAt = performance.now() + NEXT_DELAY;
    }

    function onKey(e) {
      if (isTyping(e) || !S) return;
      const down = e.type === 'keydown';
      const c = e.code;
      if (c === 'ArrowLeft' || c === 'KeyA' || c === 'ArrowRight' || c === 'KeyD') {
        if (!playing()) return;
        e.preventDefault();
        const left = c === 'ArrowLeft' || c === 'KeyA';
        held[left ? 'left' : 'right'] = down;
        if (down && !e.repeat) aim.x = Math.max(-X_LIMIT, Math.min(X_LIMIT, aim.x + (left ? -0.2 : 0.2)));
        return;
      }
      if (!down) return;
      if ((c === 'ArrowUp' || c === 'KeyW' || c === 'ArrowDown' || c === 'KeyS') && playing()) {
        e.preventDefault();
        aim.a += (c === 'ArrowUp' || c === 'KeyW' ? 1 : -1) * (Math.PI / 2);
        return;
      }
      if (c === 'Space' && !e.repeat && playing()) {
        e.preventDefault();
        drop();
        return;
      }
      // 숫자키 = 그 친구에게 택배
      const d = digitOf(e);
      const t = targets()[d - 1];
      if (d >= 1 && t && S.phase === 'play' && !e.repeat) {
        e.preventDefault();
        api.send('parcel', { to: t.id });
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    const onBlur = () => { held.left = held.right = false; };
    window.addEventListener('blur', onBlur);

    function flash(text, cls = '') {
      const el = h('div', { class: `sk-flash ${cls}` }, text);
      fxBox.append(el);
      setTimeout(() => el.remove(), 1800);
    }

    // 물리: 1/60초 고정 걸음 (창이 뒤로 가서 그림이 멈춰도 이걸로 돈다)
    function physics() {
      const now = performance.now();
      const dt = Math.min(0.2, (now - last) / 1000);
      last = now;
      if (!T) ensureTower();
      if (!T || S?.phase !== 'play') return;
      if (!alive()) return; // 탈락하면 내 탑은 그대로 멈춘다
      takeNext();
      const dir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
      if (dir) aim.x = Math.max(-X_LIMIT, Math.min(X_LIMIT, aim.x + dir * MOVE_SPEED * dt));
      acc = Math.min(acc + dt, 0.2);
      while (acc >= STEP) {
        acc -= STEP;
        stepTower(T);
      }
      if (now - reportAt >= REPORT_EVERY) {
        reportAt = now;
        myH = heightOf(T);
        goalSince = myH >= GOAL ? goalSince || now : 0;
        if (myH >= SPACE_Y && !wasSpace) flash('🚀 우주 진입! 중력 절반');
        wasSpace = wasSpace || myH >= SPACE_Y;
        const snap = now - snapAt >= SNAP_EVERY;
        if (snap) snapAt = now;
        api.send('tower', { h: r2(myH), n, f: T.fell, tw: snap ? snapTower(T) : undefined });
      }
      if (now - drawnAt > 200) paint(); // 그림 루프가 멈춘 창에서도 가끔 그린다
    }
    const ticker = setInterval(physics, 16);

    // 내 탑 그리기 (짐마다 그림을 한 번 만들고 자리만 옮긴다)
    function paintTower() {
      if (!T) return;
      for (const [id, it] of T.items) {
        let v = shown.get(id);
        if (!v) {
          v = { el: svg('g', { class: 'sk-item' }, objGroup(it.k)), chute: KINDS[it.k].chute ? chuteGroup() : null };
          itemsG.append(v.el);
          if (v.chute) chutesG.append(v.chute);
          shown.set(id, v);
        }
        const p = it.body.getPosition();
        v.el.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${(it.body.getAngle() * 180) / Math.PI})`);
        v.el.classList.toggle('frozen', !!it.frozen);
        if (v.chute) {
          v.chute.classList.toggle('folded', !T.chutes.has(id));
          v.chute.setAttribute('transform', `translate(${p.x} ${p.y})`);
        }
      }
      for (const [id, v] of shown) {
        if (T.items.has(id)) continue;
        v.el.remove();
        v.chute?.remove();
        shown.delete(id);
      }
    }

    function paint() {
      drawnAt = performance.now();
      if (!S) return;
      paintTower();
      // 조준 미리보기 (떨어질 높이 그대로)
      if (playing() && T && cur) {
        const y = spawnY(T, cur.k, aim.x, aim.a);
        const key = `${cur.k}:${cur.no || ''}`;
        if (previewG.dataset.key !== key) {
          previewG.dataset.key = key;
          previewPiece.replaceChildren(objGroup(cur.k));
          previewG.classList.toggle('parcel', !!cur.no);
        }
        previewChute.style.display = KINDS[cur.k].chute ? '' : 'none';
        previewG.style.display = '';
        previewG.setAttribute('transform', `translate(${aim.x} ${y})`);
        previewPiece.setAttribute('transform', `rotate(${(aim.a * 180) / Math.PI})`);
        guide.setAttribute('y2', -y);
        previewG.style.opacity = performance.now() < nextAt ? 0.25 : '';
      } else {
        previewG.style.display = 'none';
      }
      // 카메라: 폭 13m, 높이는 화면 비율대로. 처음엔 받침대가 보이고, 쌓을수록 꼭대기 위 2.5m가 보이게 올라간다
      const r = stage.getBoundingClientRect();
      const hm = r.width ? Math.min(14, (13 * r.height) / r.width) : 9;
      const want = Math.max(-1.4, myH + 2.5 - hm);
      cam += (want - cam) * 0.08;
      stage.setAttribute('viewBox', `-6.5 ${-(cam + hm).toFixed(3)} 13 ${hm.toFixed(3)}`);
      // 하늘 끝 버티기
      const left = goalSince ? HOLD - (performance.now() - goalSince) : 0;
      holdBox.hidden = !(playing() && goalSince);
      if (goalSince) holdBox.textContent = `☁️ 하늘 끝! ${Math.max(1, Math.ceil(left / 1000))}초만 버텨!`;
    }
    let raf = requestAnimationFrame(function loop() {
      paint();
      raf = requestAnimationFrame(loop);
    });

    function checkEvents() {
      const list = S.fx || [];
      if (seenFx === null) {
        seenFx = Math.max(0, ...list.map(e => e.n));
        return;
      }
      for (const e of list) {
        if (e.n <= seenFx) continue;
        seenFx = e.n;
        if (e.k === 'start') flash('☁️ 시작! 하늘 끝까지!');
        else if (e.k === 'earn' && e.id === me) flash('📦 택배 +1 · 숫자키로 친구에게!');
        else if (e.k === 'parcel' && e.to === me) flash(`😈 ${who(e.from).name}의 택배! 다음 짐: ${KINDS[e.item]?.name}`, 'bad');
        else if (e.k === 'parcel') flash(`😈 ${who(e.from).name} → ${who(e.to).name} 택배`);
        else if (e.k === 'cut') flash(e.ids.includes(me) ? '✂️ 컷 탈락… 👻 유령: 10초마다 택배' : `✂️ 컷! ${e.ids.map(id => who(id).name).join(', ')} 탈락`, 'bad');
      }
    }

    function renderTop() {
      const now = api.now();
      const play = S.phase === 'play';
      const nextCut = play && (S.cutNo || 0) < CUTS.length ? S.startAt + CUTS[S.cutNo || 0] - now : null;
      const rank = [...S.alive].sort((a, b) => (S.h?.[b] || 0) - (S.h?.[a] || 0)).indexOf(me) + 1;
      const lowest = play && alive() && S.alive.length > 2 && rank === S.alive.length;
      const bits = [
        h('span', { class: 'sk-h' }, `${(alive() ? myH : S.h?.[me] || 0).toFixed(1)}m`),
        alive() ? h('span', {}, `${rank}등 / ${S.alive.length}명`) : h('span', {}, '👻 유령'),
        h('span', {}, alive() ? `📦 ${S.parcels?.[me] || 0}` : `📦 ${sec((S.ghostAt?.[me] || 0) - now) ? `${sec((S.ghostAt?.[me] || 0) - now)}초` : '준비!'}`),
        nextCut != null ? h('span', { class: nextCut < 5000 ? 'sk-cut hot' : 'sk-cut' }, `✂️ 컷 ${sec(nextCut)}초${lowest && nextCut < 8000 ? ' · 😱 지금 꼴찌!' : ''}`) : null,
        play ? countdown(S.endAt, LIMIT) : null,
      ].filter(Boolean);
      const key = JSON.stringify([bits.map(b => b.textContent), play && S.endAt]);
      if (key === topKey) return;
      topKey = key;
      top.replaceChildren(...bits);
    }

    function renderNext() {
      const list = playing() ? upcoming().slice(0, 2) : [];
      const key = JSON.stringify([list, cur]);
      if (key === nextKey) return;
      nextKey = key;
      nextBox.hidden = !list.length;
      nextBox.replaceChildren(h('div', { class: 'sk-next-label' }, 'NEXT'),
        ...list.map(it => h('div', { class: `sk-next-item${it.no ? ' parcel' : ''}` }, objIconSmall(it.k),
          h('span', {}, it.no ? `😈 ${who(it.by).name}` : KINDS[it.k].name))));
    }
    function objIconSmall(k) {
      const e = extent(k, 0);
      const pad = 0.1;
      return svg('svg', { class: 'sk-icon', viewBox: `${e.lo[0] - pad} ${-e.hi[1] - pad} ${e.hi[0] - e.lo[0] + pad * 2} ${e.hi[1] - e.lo[1] + pad * 2}` },
        svg('g', { transform: 'scale(1,-1)' }, objGroup(k)));
    }

    function renderOverlay() {
      const key = `${S.phase}`;
      if (key === overlayKey) return;
      overlayKey = key;
      overlay.replaceChildren();
      if (S.phase === 'intro') {
        overlay.append(h('div', { class: 'sk-card' },
          h('h2', {}, '☁️ 하늘끝까지'),
          S.again ? null : h('ul', { class: 'rules big' },
            h('li', {}, '모두 동시에 각자 받침대에 물건을 쌓아요. 하늘 끝(10m)에 먼저 닿아 3초 버티면 우승!'),
            h('li', {}, '← → 위치 · ↑ ↓ 돌리기 · 스페이스 떨구기 (바로 다음 짐이 나와요, NEXT 2개)'),
            h('li', {}, '30초·60초에 제일 낮은 사람 컷! 1분 30초가 끝나면 제일 높은 사람 우승'),
            h('li', {}, '3m 오를 때마다 😈 택배: 숫자키로 친구의 다음 짐을 볼링공·얼음 같은 걸로'),
            h('li', {}, `🚀 ${SPACE_Y}m 위는 우주(중력 절반) · 아래층은 굳어서 꼭대기만 무너져요`)),
          countdown(S.phaseEndsAt, S.again ? AGAIN_INTRO : INTRO)));
      }
      if (S.phase === 'final') {
        const rows = (S.placement || []).map((id, i) => h('li', { class: id === me ? 'me' : '' },
          h('span', { class: 'medal' }, ['🥇', '🥈', '🥉'][i] || i + 1), avatar(who(id)), h('b', {}, who(id).name),
          h('em', {}, `${(S.h?.[id] || 0).toFixed(1)}m${S.out?.includes(id) ? ' ✂️' : ''}`)));
        overlay.append(h('div', { class: 'sk-card' },
          h('h2', {}, S.winner ? `🏆 ${who(S.winner).name} 하늘 끝 정복!` : `☁️ ${who(S.placement?.[0]).name} 제일 높이!`),
          h('ol', { class: 'sk-final' }, rows)));
      }
    }

    // 아래 '모두의 탑': 칸마다 그 사람 탑 (1초에 한 번 오는 모양)
    function renderStrip() {
      const ids = (S.roster || []).map(p => p.id);
      const w = Math.max(2, ids.length) * LANE;
      const vb = `0 ${-(GOAL + 2)} ${w} ${GOAL + 3.6}`;
      if (strip.getAttribute('viewBox') !== vb) {
        strip.setAttribute('viewBox', vb);
        strip.replaceChildren(svg('g', { transform: 'scale(1,-1)', class: 'sk-lanes' }));
        laneKeys.clear();
      }
      const g = strip.firstChild;
      ids.forEach((id, i) => {
        const tw = S.tw?.[id] || [];
        const out = !S.alive.includes(id);
        const key = JSON.stringify([tw, out, S.h?.[id], id === S.winner]);
        if (laneKeys.get(id) === key) return;
        laneKeys.set(id, key);
        const lane = svg('g', { class: `sk-lane${out ? ' out' : ''}${id === me ? ' me' : ''}`, transform: `translate(${LANE * i + LANE / 2} 0)`, 'data-id': id },
          svg('rect', { class: 'sk-lane-bg', x: -LANE / 2 + 0.15, y: -1.5, width: LANE - 0.3, height: GOAL + 3.4, rx: 0.3 }),
          svg('rect', { x: -PLATFORM_W / 2, y: -0.4, width: PLATFORM_W, height: 0.4, fill: '#495057' }),
          ...tw.filter(t => KEYS[t[0]]).map(([ki, x, y, a, f]) => svg('g', { class: `sk-item${f ? ' frozen' : ''}`, transform: `translate(${x} ${y}) rotate(${(a * 180) / Math.PI})` }, objGroup(KEYS[ki]))),
          svg('line', { class: 'sk-goal-line', x1: -LANE / 2 + 0.15, x2: LANE / 2 - 0.15, y1: GOAL, y2: GOAL }),
          label(`${who(id).name}${out ? ' ✂️' : ''}`, 0, -1.25, 0.75, 'sk-lane-name'),
          label(`${(S.h?.[id] || 0).toFixed(1)}m`, 0, GOAL + 0.45, 0.8, 'sk-lane-h'));
        const old = g.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (old) old.replaceWith(lane);
        else g.append(lane);
      });
    }

    function renderSide() {
      const now = api.now();
      const order = [...(S.roster || [])].sort((a, b) => (S.alive.includes(b.id) - S.alive.includes(a.id)) || (S.h?.[b.id] || 0) - (S.h?.[a.id] || 0));
      const keyOf = new Map(targets().map((p, i) => [p.id, i + 1]));
      const canSend = S.phase === 'play' && (alive() ? (S.parcels?.[me] || 0) > 0 : now >= (S.ghostAt?.[me] || 0));
      const key = JSON.stringify([order.map(p => [p.id, S.h?.[p.id], S.parcels?.[p.id]]), S.alive, canSend, S.phase]);
      if (key === sideKey) return;
      sideKey = key;
      side.replaceChildren(
        h('h3', {}, `높이 순위 · 생존 ${S.alive.length}명`),
        h('ol', { class: 'tw-bag sk-rank' }, order.map(p => {
          const out = !S.alive.includes(p.id);
          const k = keyOf.get(p.id);
          return h('li', { class: `${p.id === me ? 'now' : ''}${out ? ' dead' : ''}` },
            k && !out ? h('kbd', { class: canSend ? 'ready' : '' }, String(k)) : h('kbd', { class: 'blank' }, ''),
            avatar(p), h('span', {}, p.name),
            h('em', {}, out ? '✂️ 탈락' : `${(S.h?.[p.id] || 0).toFixed(1)}m${S.parcels?.[p.id] ? ` · 📦${S.parcels[p.id]}` : ''}`));
        })),
        h('h3', {}, '😈 택배'),
        h('p', { class: 'muted small' }, canSend ? '숫자키로 친구를 고르면 그 친구 다음 짐이 볼링공·얼음·라바콘 같은 걸로 바뀌어요' : alive() ? '3m 오를 때마다 1개 생겨요' : '유령은 10초마다 보낼 수 있어요'),
        h('h3', {}, '조작'),
        h('ul', { class: 'rules' },
          h('li', {}, '← → (A D) 위치 · 톡 치면 조금씩'),
          h('li', {}, '↑ ↓ (W S) 90° 돌리기'),
          h('li', {}, '스페이스 떨구기 (바로 다음 짐)'),
          h('li', {}, '숫자키 = 그 친구에게 😈 택배')));
    }

    return {
      update({ state }) {
        S = state;
        ensureTower();
        checkEvents();
        renderTop();
        renderNext();
        renderOverlay();
        renderStrip();
        renderSide();
      },
      unmount() {
        cancelAnimationFrame(raf);
        clearInterval(ticker);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
        window.removeEventListener('blur', onBlur);
      },
    };
  },
};
