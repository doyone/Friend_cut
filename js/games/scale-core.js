// 피의 저울 규칙 (방장이 돌린다). 화면은 scale-view.js, 게임 등록은 scale.js
// 원탁에 둘러앉아 양옆 이웃과 각각 '전선'을 맞댄다. 내 칸 4개 = 왼쪽 전선 2칸(0 · 1) + 오른쪽 전선 2칸(2 · 3).
// 내 칸 i의 맞은편은 그쪽 이웃의 칸 3 - i (마주 앉은 것처럼 좌우가 뒤집힌다). 둘만 남으면 4줄이 그대로 맞댄다.
// 한 턴: 선공 놓기 → 공개 → 후공 놓기 → 공개 → 타격(선공 쪽이 한꺼번에 → 살아남은 후공 쪽이 한꺼번에) → 질주 · 성장.
// 홀수 턴엔 모두 왼쪽 전선에서 선공, 짝수 턴엔 오른쪽 전선에서 선공 (그래서 한 전선에 선공 · 후공이 한 명씩 맞는다).
// 카드는 판 위 내 생물을 제물로 바쳐서(피) 또는 생물이 죽을 때 모은 뼈로 낸다. 닭 더미는 공짜.
// 맞은편이 비면 직격 → 그 전선의 저울이 기운다. SCALE_MAX만큼 기울면 진 쪽 촛불이 꺼지고, 촛불이 다 꺼지면 탈락.
// 2차: ROAD_EVERY턴마다 길목(새 패 · 모닥불 · 제단 · 도구 상자 중 하나) · 도구(놓기 단계에 바로 쓴다) · 넋패(탈락한 사람이 카드가 된다).
// 손패 · 덱 · 무덤 · 도구와 놓는 중인 계획은 방장만 안다(ctx.secret). 내 것은 나에게만(ctx.setPrivate).
// 저울을 미는 건 언제나 누군가의 생물이다 (붉은 달 · 엽전도 촛불을 끄지는 못한다).
import { shuffle, INTRO_TIME } from '../util.js';

export const LANES = 2;              // 전선 하나의 줄 수
export const SLOTS = LANES * 2;      // 내 칸 (왼쪽 전선 + 오른쪽 전선)
export const SCALE_MAX = 5;          // 저울이 이만큼 기울면 촛불이 꺼진다
export const CANDLES = 2;
export const SMOKE_TURNS = 1;        // 촛불이 꺼진 뒤 그 전선에서 직격을 안 받는 턴 (꺼진 턴은 끝까지 + 이만큼)
export const DECK_TIME = 60000;      // 시작 덱 고르기 (모두 고르면 바로)
export const PLACE_TIME = 60000;     // 놓기 단계 하나 (모두 준비 완료를 누르면 바로)
export const REVEAL_TIME = 1500;     // 놓은 것을 보여 주는 시간
export const START_HAND = 3;         // 처음 손패: 덱에서 이만큼 + 닭
export const START_HEN = 1;
export const HAND_MAX = 9;           // 손패가 이만큼이면 못 뽑는다
export const MOON = [[14, 2], [10, 1]]; // 붉은 달: [이 턴부터, 직격 +n]
export const BEAT_MS = 560;          // 타격 장면 한 박자
// 2차
export const ROAD_EVERY = 3;         // 이 턴마다 (타격이 끝난 뒤) 길목
export const ROAD_TIME = 60000;      // 길목 (모두 고르면 바로)
export const TOOL_MAX = 2;           // 도구는 이만큼까지 든다
export const SOUL_TIME = 60000;      // 탈락한 사람이 넋패를 고르는 시간 (판은 그동안에도 흐른다)
export const SOUL_COST = 4;          // 넋패는 뼈 4
export const BURN = [0, 0.4, 0.7];   // 모닥불: 같은 카드를 n번째로 달굴 때 타 버릴 확률 (첫 번째는 안전)
export const NINE = 3;               // 아홉 목숨: 제물로 바쳐도 안 죽는 횟수
export const SIG_MAX = 2;            // 카드 한 장의 문양은 이만큼까지 (제단 · 넋패)
const GRACE = 300;                   // 마감 직전에 보낸 신호가 도착할 시간
const LOG_KEEP = 7;

// 문양: 카드에 새겨진 능력
export const SIGILS = {
  wing: { name: '날개', tip: '막혀도 넘어가서 직격' },
  leap: { name: '올려치기', tip: '날개를 막는다' },
  venom: { name: '독니', tip: '물린 생물은 죽는다' },
  thorn: { name: '가시', tip: '때린 놈에게 1' },
  fork: { name: '두 갈래', tip: '정면 대신 양옆 대각선을 친다' },
  sprint: { name: '질주', tip: '턴이 끝나면 옆 칸으로 간다' },
  fat: { name: '살진 제물', tip: '바치면 피 3' },
  boneyard: { name: '뼈무덤', tip: '죽으면 뼈 3' },
  back: { name: '귀환', tip: '죽으면 손으로 돌아온다' },
  squeeze: { name: '조이기', tip: '맞은편 공격 -1' },
  nine: { name: '아홉 목숨', tip: `바쳐도 ${NINE}번까지 안 죽는다` },
  breed: { name: '번식', tip: '내면 손에 한 장 더 생긴다' },
  dive: { name: '잠수', tip: '후공일 땐 안 맞는 대신 막지도 못한다' },
  leader: { name: '우두머리', tip: '양옆 내 생물 공격 +1' },
  grow: { name: '성장', tip: '한 턴 버티면 자란다' },
  trample: { name: '돌진', tip: '죽이고 남은 피해는 직격' },
};

// 카드. blood = 피(제물 수) · bone = 뼈 · 둘 다 없으면 공짜. tok = 닭 · 잿불처럼 죽으면 사라지는 것
// grow = 다 자라면 되는 카드 · grown = 자라서만 나오는 카드 (새 패에 안 나온다) · soul = 넋패 (탈락한 사람)
export const CARDS = {
  hen: { name: '닭', atk: 0, hp: 1, sig: [], tok: true },
  ember: { name: '잿불', atk: 0, hp: 3, sig: ['boneyard'], tok: true },
  lynx: { name: '살쾡이', atk: 1, hp: 2, sig: [], blood: 1 },
  crow: { name: '까마귀', atk: 1, hp: 1, sig: ['wing'], blood: 1 },
  toad: { name: '두꺼비', atk: 1, hp: 3, sig: ['leap'], blood: 1 },
  hedgehog: { name: '고슴도치', atk: 1, hp: 2, sig: ['thorn'], blood: 1 },
  viper: { name: '살모사', atk: 1, hp: 1, sig: ['venom'], blood: 1 },
  hound: { name: '들개', atk: 2, hp: 1, sig: ['sprint'], blood: 1 },
  totem: { name: '장승', atk: 0, hp: 5, sig: [], blood: 1 },
  pig: { name: '살진 돼지', atk: 0, hp: 2, sig: ['fat'], blood: 1 },
  jackal: { name: '승냥이', atk: 3, hp: 2, sig: [], blood: 2 },
  boar: { name: '멧돼지', atk: 2, hp: 4, sig: ['trample'], blood: 2 },
  owl: { name: '부엉이', atk: 2, hp: 2, sig: ['wing'], blood: 2 },
  centipede: { name: '지네', atk: 1, hp: 2, sig: ['fork'], blood: 2 },
  python: { name: '구렁이', atk: 1, hp: 4, sig: ['squeeze'], blood: 2 },
  bear: { name: '반달곰', atk: 4, hp: 5, sig: [], blood: 3 },
  tiger: { name: '범', atk: 5, hp: 3, sig: [], blood: 3 },
  wisp: { name: '도깨비불', atk: 1, hp: 1, sig: ['back'], bone: 2 },
  rats: { name: '들쥐 떼', atk: 2, hp: 2, sig: ['breed'], bone: 3 },
  reaper: { name: '저승까마귀', atk: 3, hp: 2, sig: ['wing'], bone: 5 },
  imugi: { name: '이무기', atk: 5, hp: 5, sig: ['squeeze'], bone: 8 },
  // 2차: 길목의 새 패로만 들어온다
  cat: { name: '검은고양이', atk: 0, hp: 1, sig: ['nine'], blood: 1 },
  spider: { name: '거미', atk: 1, hp: 1, sig: ['breed'], blood: 1 },
  otter: { name: '수달', atk: 1, hp: 2, sig: ['dive'], blood: 1 },
  catfish: { name: '메기', atk: 2, hp: 3, sig: ['dive'], blood: 2 },
  cub: { name: '새끼 늑대', atk: 1, hp: 1, sig: ['grow'], blood: 1, grow: 'wolf' },
  wolf: { name: '늑대', atk: 3, hp: 2, sig: [], blood: 2, grown: true },
  alpha: { name: '대장 늑대', atk: 3, hp: 3, sig: ['leader'], blood: 3 },
  egg: { name: '구렁이 알', atk: 0, hp: 2, sig: ['grow'], bone: 1, grow: 'python' },
  stag: { name: '수사슴', atk: 2, hp: 3, sig: ['trample'], blood: 2 },
  bat: { name: '박쥐', atk: 2, hp: 1, sig: ['wing'], bone: 4 },
  mantis: { name: '사마귀', atk: 1, hp: 1, sig: ['fork'], blood: 1 },
  elk: { name: '고라니', atk: 1, hp: 2, sig: ['sprint'], blood: 1 },
  soul: { name: '넋', atk: 0, hp: 1, sig: [], bone: SOUL_COST, soul: true },
};
// 새 패에 나올 수 있는 카드 (센 것은 덜 나온다)
export const PACK = Object.keys(CARDS).filter(k => !CARDS[k].tok && !CARDS[k].grown && !CARDS[k].soul);
const packWeight = k => (CARDS[k].blood >= 3 || CARDS[k].bone >= 5 ? 2 : 4);

// 시작 덱: 시작할 때 넷 중 하나를 고른다 (겹쳐 골라도 된다)
export const DECKS = {
  hunter: { name: '사냥꾼', tip: '닭을 바쳐 큰 놈을 세운다 (처음이면 이것)', cards: ['lynx', 'lynx', 'hound', 'hedgehog', 'jackal', 'boar', 'bear'] },
  grave: { name: '무덤지기', tip: '싸게 죽이고 뼈로 다시 낸다', cards: ['lynx', 'pig', 'viper', 'wisp', 'wisp', 'rats', 'reaper'] },
  falcon: { name: '매잡이', tip: '날개로 막혀도 직격한다', cards: ['crow', 'crow', 'toad', 'lynx', 'owl', 'owl', 'centipede'] },
  snake: { name: '땅꾼', tip: '독으로 큰 놈을 잡고 버틴다', cards: ['viper', 'viper', 'totem', 'python', 'hedgehog', 'toad', 'lynx'] },
};

// 도구: 놓기 단계에 바로 쓴다 (모두에게 보인다). aim = 고를 것: foe 맞은편 생물 · front 전선 · mine 내 생물
export const TOOLS = {
  sickle: { name: '낫', tip: '상대 생물 하나를 벤다', aim: 'foe' },
  coin: { name: '엽전', tip: `저울 1칸 당긴다 (${SCALE_MAX - 1}칸까지)`, aim: 'front' },
  moktak: { name: '목탁', tip: '이번 턴 한 전선의 상대가 못 친다', aim: 'front' },
  coop: { name: '닭장', tip: '닭 2마리' },
  fan: { name: '부채', tip: '이번 턴 내 생물 모두 날개' },
  sack: { name: '뼈 자루', tip: '뼈 +4' },
  charm: { name: '부적', tip: '내 생물 하나가 이번 턴 안 죽는다', aim: 'mine' },
};
// 길목: ROAD_EVERY턴마다 넷 중 셋이 뜨고, 하나를 고른다
export const ROADS = {
  pack: { name: '새 패', tip: '카드 3장 중 1장' },
  fire: { name: '모닥불', tip: '카드 하나를 세게. 또 달구면 탈 수도' },
  altar: { name: '제단', tip: '카드 하나를 바쳐 그 문양을 옮긴다' },
  tools: { name: '도구 상자', tip: '도구 2개 중 1개' },
};

const list = v => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
const inc = (S, key, id, n = 1) => { S[key] = { ...(S[key] || {}), [id]: (S[key]?.[id] || 0) + n }; };

/* ───────── 자리 · 칸 · 전선 ───────── */

export const across = s => SLOTS - 1 - s;               // 맞은편 칸 번호
// 왼쪽 이웃 = 살아 있는 사람 중 앉은 순서로 다음 사람, 오른쪽 이웃 = 그 앞 사람 (둘만 남으면 같은 사람)
export function leftOf(S, id) {
  const a = list(S.alive);
  const i = a.indexOf(id);
  return i < 0 ? null : a[(i + 1) % a.length];
}
export function rightOf(S, id) {
  const a = list(S.alive);
  const i = a.indexOf(id);
  return i < 0 ? null : a[(i - 1 + a.length) % a.length];
}
export const foeOf = (S, id, s) => (s < LANES ? leftOf(S, id) : rightOf(S, id)); // 그 칸이 맞댄 사람
// 전선의 이름 = 그 전선을 '왼쪽 전선'으로 가진 사람. 저울 S.scale[f]는 양수면 f가 미는 중
export const frontOf = (S, id, s) => (s < LANES ? id : rightOf(S, id));
export const leadOf = (S, f) => (S.round % 2 === 1 ? f : leftOf(S, f));      // 이번 턴 그 전선의 선공
export const scaleFor = (S, id, f) => (f === id ? 1 : -1) * (S.scale?.[f] || 0); // id 쪽에서 본 저울 (양수 = 내가 미는 중)
export const smoked = (S, id, f) => (S.smoke?.[id]?.[f] || 0) >= (S.round || 0); // 촛불이 꺼진 뒤 연기가 가리는 중
export const moonOf = round => (MOON.find(([r]) => round >= r) || [0, 0])[1];
const leftSlots = Array.from({ length: LANES }, (_, i) => i);
const rightSlots = leftSlots.map(i => i + LANES);
// 이번 단계에 놓을 수 있는 칸. step 1 = 선공 놓기, 2 = 후공 놓기 (홀수 턴엔 왼쪽 전선이 선공)
export function stepSlots(S, id, step) {
  return (step === 1) === ((S.round || 0) % 2 === 1) ? leftSlots : rightSlots;
}
const fxOf = (S, id) => S.fx?.[id] || {};               // 이번 턴 도구 효과 (부채 · 목탁 · 부적)

/* ───────── 카드 ───────── */

// 손패 · 덱 · 무덤의 카드 = { u, k, da?, dh?, sig?, t?, pid?, nm? }: da · dh = 모닥불로 오른 공격 · 체력, sig = 바뀐 문양,
// t = 번식으로 생긴 복제(죽으면 사라짐), pid · nm = 넋패의 주인. 판 위 생물 = { u, k, atk, hp, max, src: 처음 카드, ... }
export const sigOf = c => (!c ? [] : c.sig ? list(c.sig) : list(CARDS[c.k]?.sig));
export const has = (c, k) => sigOf(c).includes(k);
export const bloodOf = c => (has(c, 'fat') ? 3 : 1);   // 제물로 바쳤을 때 피
export const bonesOf = c => (has(c, 'boneyard') ? 3 : 1); // 죽었을 때 뼈
export const isTok = c => !!(c && (CARDS[c.k]?.tok || c.t)); // 죽으면 사라지는 카드
export const cardName = c => (c?.k === 'soul' ? c.nm || CARDS.soul.name : CARDS[c?.k]?.name || '?');
// 공격 · 체력 (판 위 생물이면 지금 값, 손패 카드면 본래 값 + 강화)
export function statsOf(c) {
  if (!c) return { atk: 0, hp: 0, max: 0 };
  if (c.max != null) return { atk: c.atk, hp: c.hp, max: c.max };
  const d = CARDS[c.k] || { atk: 0, hp: 1 };
  const hp = d.hp + (c.dh || 0);
  return { atk: d.atk + (c.da || 0), hp, max: hp };
}
export const valueOf = c => { // 봇이 보는 값어치
  if (!c) return 0;
  const { atk, hp } = statsOf(c);
  return atk * 2 + Math.max(0, hp) + sigOf(c).length * 1.5;
};
export function rowOf(S, id) {
  const r = S.board?.[id];
  return Array.from({ length: SLOTS }, (_, s) => (r && r[s]) || null);
}
export const cardAt = (S, id, s) => (S.board?.[id]?.[s]) || null;
const MODS = ['da', 'dh', 'sig', 't', 'pid', 'nm'];
// 손패 카드 → 판 위 생물. round = 놓은 턴 (성장)
export function spawn(card, s, round = 0) {
  const st = statsOf(card);
  const b = { u: card.u, k: card.k, atk: st.atk, hp: st.hp, max: st.hp, r: round, src: { ...card } };
  for (const f of MODS) if (card[f] != null) b[f] = card[f];
  if (has(b, 'sprint')) b.dir = s < SLOTS / 2 ? 1 : -1; // 질주는 처음엔 판 안쪽으로
  if (has(b, 'nine')) b.lv = NINE;
  return b;
}
// 판 위 생물 → 손패 · 무덤 카드 (처음 카드 그대로. 자랐어도 알로 돌아간다)
export const toHand = b => (b.src ? { ...b.src } : { u: b.u, k: b.k });
// 다 자란 모습: 강화와 따로 붙은 문양은 그대로
function grownOf(c, to) {
  const d = CARDS[to];
  const extra = c.sig ? list(c.sig).filter(g => g !== 'grow' && !d.sig.includes(g)) : [];
  const b = { u: c.u, k: to, atk: d.atk + (c.da || 0), hp: d.hp + (c.dh || 0), r: c.r, src: c.src };
  b.max = b.hp;
  for (const f of ['da', 'dh', 't', 'pid', 'nm']) if (c[f] != null) b[f] = c[f];
  if (extra.length) b.sig = [...d.sig, ...extra].slice(0, SIG_MAX + 1);
  if (has(b, 'sprint')) b.dir = c.dir || 1;
  if (has(b, 'nine')) b.lv = NINE;
  return b;
}

// 계획(acts)을 내 판에 차례로 적용해 본다. 안 되는 수를 만나면 거기서 멈춘다. (방장 · 화면의 미리 보기 · 봇이 같이 쓴다)
// acts: [{ u: 손패 카드 번호, sac: [제물로 바칠 칸], slot: 놓을 칸 }]. slots = 이번 단계에 놓을 수 있는 칸
// 돌려주는 것: { board, hand, bones, done: 적용한 수, log: [{ k: 'sac' | 'put', s, card, nine? }], why: 멈춘 까닭 }
export function applyActs(board0, hand0, bones0, acts, slots, round = 0) {
  let board = Array.from({ length: SLOTS }, (_, s) => board0[s] || null);
  let hand = [...list(hand0)];
  let bones = bones0 || 0;
  const log = [];
  let done = 0;
  let why = null;
  for (const a of list(acts)) {
    const card = hand.find(c => c.u === a?.u);
    const d = card && CARDS[card.k];
    if (!d) { why = 'card'; break; }
    const slot = Number(a.slot);
    const sac = [...new Set(list(a.sac).map(Number))];
    if (!slots.includes(slot)) { why = 'slot'; break; }
    if (d.blood) {
      if (sac.some(s => !(s >= 0 && s < SLOTS) || !board[s])) { why = 'sac'; break; }
      if (sac.reduce((t, s) => t + bloodOf(board[s]), 0) < d.blood) { why = 'blood'; break; }
    } else if (sac.length) { why = 'sac'; break; }
    if (d.bone && bones < d.bone) { why = 'bone'; break; }
    // 이 수를 따로 해 보고, 되면 받아들인다 (안 되는 수는 반쯤 적용되지 않게)
    const B = [...board];
    let H = [...hand];
    let N = bones;
    const L = [];
    for (const s of sac) { // 제물: 그 자리에서 죽는다 → 뼈. 귀환은 바로 손으로. 아홉 목숨은 피만 주고 남는다
      const c = B[s];
      if (has(c, 'nine') && (c.lv ?? NINE) > 0) {
        B[s] = { ...c, lv: (c.lv ?? NINE) - 1 };
        L.push({ k: 'sac', s, card: c, nine: B[s].lv });
        continue;
      }
      B[s] = null;
      N += bonesOf(c);
      L.push({ k: 'sac', s, card: c });
      if (has(c, 'back')) H.push(toHand(c));
    }
    if (B[slot]) { why = 'full'; break; }
    N -= d.bone || 0;
    H = H.filter(c => c !== card);
    B[slot] = spawn(card, slot, round);
    L.push({ k: 'put', s: slot, card: B[slot] });
    board = B;
    hand = H;
    bones = N;
    log.push(...L);
    done += 1;
  }
  return { board, hand, bones, done, log, why };
}

/* ───────── 타격 (순수: 판 · 저울 · 촛불 · 뼈 · 연기만 고친다) ───────── */

// 미리 보기 · 봇이 돌려 볼 수 있게 상태에서 타격에 필요한 것만 베낀다
export function simState(S) {
  const alive = list(S.alive);
  return {
    round: S.round || 0, moon: S.moon || 0, alive,
    board: Object.fromEntries(alive.map(id => [id, rowOf(S, id).map(c => (c ? { ...c } : 0))])),
    scale: { ...(S.scale || {}) }, candles: { ...(S.candles || {}) }, bones: { ...(S.bones || {}) },
    smoke: Object.fromEntries(Object.entries(S.smoke || {}).map(([id, v]) => [id, { ...(v || {}) }])),
    fx: S.fx || {},
  };
}
// 잠수 중인가: 그 전선에서 주인이 후공인 턴
export const sunk = (S, id, s, c) => has(c, 'dive') && leadOf(S, frontOf(S, id, s)) !== id;
const leaders = (row, s) => [s - 1, s + 1].filter(t => t >= 0 && t < SLOTS && row[t] && has(row[t], 'leader')).length;

// 한 턴의 타격. 장면 목록(ev)과 죽은 생물 · 꺼진 촛불 · 탈락을 돌려준다. 장면의 b = 박자(같은 박자는 동시에)
// 박자: 선공 타격 (줄마다 하나씩) → 선공 정리(죽음 · 촛불) → 후공 타격 → 후공 정리 → 질주 · 성장
export function runFight(S, rand = Math.random) {
  const ev = [];
  const deaths = [];     // { id, card } 판에서 죽은 생물 (방장이 무덤 · 손으로 보낸다)
  const lost = [];       // 꺼진 촛불 { to, by, f, over }
  const outs = [];       // 탈락 { to, by, over, cards: 그때 판 위에 있던 카드 }
  const gone = new Set();// 이번 턴에 탈락한 사람: 판이 비고, 남은 타격은 그쪽으로 가면 허공
  const alive = list(S.alive);
  const odd = (S.round || 0) % 2 === 1;
  const moon = S.moon || 0;
  const row = id => S.board[id] || (S.board[id] = Array(SLOTS).fill(0));
  S.scale ||= {};
  S.candles ||= {};
  S.bones ||= {};
  S.smoke ||= {};
  const per = LANES + 1;
  // 직격: 그 전선의 저울을 친 쪽으로 (촛불이 꺼진 쪽은 연기가 가린다)
  const direct = (h, dmg, b, extra = {}) => {
    if (smoked(S, h.foe, h.f)) { ev.push({ k: 'smoke', b, by: h.who, s: h.s, to: h.foe, f: h.f }); return; }
    S.scale[h.f] = (S.scale[h.f] || 0) + (h.who === h.f ? dmg : -dmg);
    ev.push({ k: 'direct', b, by: h.who, s: h.s, to: h.foe, f: h.f, d: dmg, v: S.scale[h.f], ...extra });
  };
  for (let step = 1; step <= 2; step++) {
    const base = (step - 1) * per;
    // 1) 이 단계에 치는 생물들의 공격을 지금 판으로 정한다 (같은 단계의 공격은 동시에 들어간다)
    const hits = [];
    for (const f of alive) {               // 전선 f: f의 칸 0..LANES-1 대 왼쪽 이웃의 칸 SLOTS-1..LANES
      const o = leftOf(S, f);
      const lead = odd ? f : o;
      const who = step === 1 ? lead : lead === f ? o : f;
      if (gone.has(who)) continue;
      for (let col = 0; col < LANES; col++) {
        const s = who === f ? col : across(col);
        const c = row(who)[s];
        if (!c) continue;
        const front = foeOf(S, who, s);
        if (list(fxOf(S, front).mok).includes(frontOf(S, who, s))) { // 목탁: 이번 턴 이 전선에선 못 친다
          if (c.atk > 0) ev.push({ k: 'mute', b: base + col, by: who, s });
          continue;
        }
        let facing = gone.has(front) ? null : row(front)[across(s)];
        if (facing && sunk(S, front, across(s), facing)) facing = null;
        const pow = Math.max(0, c.atk + leaders(row(who), s) - (has(facing, 'squeeze') ? 1 : 0));
        if (pow <= 0) continue;              // 공격력 0은 안 친다
        const wing = has(c, 'wing') || !!fxOf(S, who).fan;
        const lanes = has(c, 'fork') ? [s - 1, s + 1].filter(t => t >= 0 && t < SLOTS) : [s];
        for (const t of lanes) {
          const foe = foeOf(S, who, t);
          if (gone.has(foe)) continue;
          const ts = across(t);
          let d = row(foe)[ts];
          if (d && sunk(S, foe, ts, d)) d = null; // 잠수: 없는 셈 (막지도 맞지도 않는다)
          const fly = wing && !has(d, 'leap');
          hits.push({ col, who, s, c, foe, ts, d: d && !fly ? d : null, pow, f: frontOf(S, who, t) });
        }
      }
    }
    hits.sort((a, b) => a.col - b.col);
    for (const h of hits) {
      const b = base + h.col;
      if (h.d) {
        const before = h.d.hp;
        h.d.hp -= h.pow;
        const e = { k: 'hit', b, by: h.who, s: h.s, to: h.foe, ts: h.ts, d: h.pow, hp: h.d.hp };
        if (has(h.c, 'venom')) { h.d.vn = 1; e.vn = 1; }
        ev.push(e);
        if (has(h.c, 'trample') && h.pow > Math.max(0, before)) direct(h, h.pow - Math.max(0, before) + moon, b, { tr: 1 }); // 돌진: 남은 피해는 직격
        if (has(h.d, 'thorn')) {
          h.c.hp -= 1;
          ev.push({ k: 'thorn', b, by: h.foe, ts: h.ts, to: h.who, s: h.s, hp: h.c.hp });
        }
        continue;
      }
      direct(h, h.pow + moon, b);
    }
    const end = base + LANES;
    // 2) 죽은 생물을 치운다 (주인은 뼈를 얻는다). 부적이 붙은 생물은 이번 턴엔 체력 1로 버틴다
    for (const id of alive) {
      if (gone.has(id)) continue;
      const r = row(id);
      for (let s = 0; s < SLOTS; s++) {
        const c = r[s];
        if (!c || (c.hp > 0 && !c.vn)) continue;
        if (list(fxOf(S, id).charm).includes(c.u)) {
          c.hp = Math.max(1, c.hp);
          delete c.vn;
          ev.push({ k: 'charm', b: end, by: id, s });
          continue;
        }
        r[s] = 0;
        const bn = bonesOf(c);
        S.bones[id] = (S.bones[id] || 0) + bn;
        deaths.push({ id, card: c });
        ev.push({ k: 'die', b: end, by: id, s, c: c.k, bn });
      }
    }
    // 3) 저울: SCALE_MAX만큼 기운 전선은 진 쪽 촛불이 꺼지고 0으로. 넘친 만큼은 이긴 쪽의 뼈
    const snuff = [];
    for (const f of alive) {
      const o = leftOf(S, f);
      if (gone.has(f) || gone.has(o)) continue;
      const v = S.scale[f] || 0;
      if (Math.abs(v) < SCALE_MAX) continue;
      const [by, to] = v > 0 ? [f, o] : [o, f];
      snuff.push({ to, by, f, over: Math.abs(v) - SCALE_MAX });
      S.scale[f] = 0;
    }
    const dying = [];
    for (const to of alive) {
      const mine = snuff.filter(x => x.to === to);
      if (!mine.length) continue;
      const had = S.candles[to] || 0;
      const left = Math.max(0, had - mine.length);
      S.candles[to] = left;
      mine.forEach((x, i) => {
        S.bones[x.by] = (S.bones[x.by] || 0) + x.over;
        lost.push(x);
        ev.push({ k: 'candle', b: end, to, by: x.by, f: x.f, left: Math.max(0, had - i - 1), over: x.over });
        if (left > 0) S.smoke[to] = { ...(S.smoke[to] || {}), [x.f]: S.round + SMOKE_TURNS };
      });
      if (left > 0) continue;
      const top = Math.max(...mine.map(x => x.over));      // 둘이 같이 끝냈으면 더 크게 넘긴 쪽이 꺼뜨린 것
      const best = mine.filter(x => x.over === top);
      dying.push({ to, by: best[Math.floor(rand() * best.length)].by, over: top });
    }
    // 남은 사람이 모두 같은 순간에 끝났다: 더 크게 넘긴 쪽이 촛불 하나로 산다 (같으면 다 같이)
    const standing = alive.filter(id => !gone.has(id));
    if (dying.length && dying.length === standing.length) {
      const score = id => Math.max(0, ...snuff.filter(x => x.by === id).map(x => x.over + 1));
      const top = Math.max(...dying.map(x => score(x.to)));
      for (const x of dying.filter(y => score(y.to) === top)) {
        S.candles[x.to] = 1;
        ev.push({ k: 'revive', b: end, to: x.to });
      }
      for (let i = dying.length - 1; i >= 0; i--) if (S.candles[dying[i].to] > 0) dying.splice(i, 1);
    }
    for (const x of dying) {
      gone.add(x.to);
      outs.push({ ...x, cards: row(x.to).filter(Boolean).map(toHand) });
      S.board[x.to] = Array(SLOTS).fill(0);
      ev.push({ k: 'out', b: end, to: x.to, by: x.by });
    }
  }
  // 4) 질주: 턴이 끝나면 옆 칸으로 (막혔거나 끝이면 돌아서서, 그쪽도 막혔으면 그대로) · 성장: 버텼으면 다 자란다
  const mb = 2 * per;
  for (const id of alive) {
    if (gone.has(id)) continue;
    const r = row(id);
    const moved = new Set();
    for (let s = 0; s < SLOTS; s++) {
      const c = r[s];
      if (!c || moved.has(c) || !has(c, 'sprint')) continue;
      let dir = c.dir || (s < SLOTS / 2 ? 1 : -1);
      let t = s + dir;
      if (t < 0 || t >= SLOTS || r[t]) { dir = -dir; t = s + dir; }
      c.dir = dir;
      if (t < 0 || t >= SLOTS || r[t]) continue;
      r[t] = c;
      r[s] = 0;
      moved.add(c);
      ev.push({ k: 'move', b: mb, by: id, from: s, to: t });
    }
    for (let s = 0; s < SLOTS; s++) {
      const c = r[s];
      const to = c && has(c, 'grow') ? CARDS[c.k]?.grow : null;
      if (!to || !CARDS[to]) continue;
      r[s] = grownOf(c, to);
      ev.push({ k: 'grow', b: mb, by: id, s, from: c.k, card: r[s] });
    }
  }
  ev.sort((a, b) => a.b - b.b);
  return { ev, deaths, lost, outs, gone: [...gone] };
}

/* ───────── 방장: 손패 · 덱 · 무덤 · 도구 ───────── */

const handOf = (ctx, id) => list(ctx.secret.hands?.[id]);
const deckOf = (ctx, id) => list(ctx.secret.decks?.[id]);
const graveOf = (ctx, id) => list(ctx.secret.graves?.[id]);
const toolsOf = (ctx, id) => list(ctx.secret.tools?.[id]);
const keep = (ctx, key, id, v) => { ctx.secret[key] = { ...(ctx.secret[key] || {}), [id]: v }; };
function make(ctx, k) {
  ctx.secret.uid = (ctx.secret.uid || 0) + 1;
  return { u: ctx.secret.uid, k };
}
// 내 카드 전부 (손패 · 덱 · 무덤. 판 위 생물과 닭 · 잿불 · 복제는 빼고). 덱 순서가 새지 않게 정렬한다
export function collectionOf(ctx, id) {
  return [...handOf(ctx, id), ...deckOf(ctx, id), ...graveOf(ctx, id)].filter(c => !isTok(c))
    .sort((a, b) => PACK.indexOf(a.k) - PACK.indexOf(b.k) || a.u - b.u);
}
function findCard(ctx, id, u) {
  for (const key of ['hands', 'decks', 'graves']) {
    const arr = list(ctx.secret[key]?.[id]);
    const i = arr.findIndex(c => c.u === u && !isTok(c));
    if (i >= 0) return { key, arr, i, card: arr[i] };
  }
  return null;
}
// 장수는 모두에게, 손패 · 무덤 · 내 카드 전부 · 도구는 본인에게만
function sync(ctx, id) {
  const S = ctx.state;
  const hand = handOf(ctx, id);
  S.hands = { ...(S.hands || {}), [id]: hand.length };
  S.deckN = { ...(S.deckN || {}), [id]: deckOf(ctx, id).length };
  S.graveN = { ...(S.graveN || {}), [id]: graveOf(ctx, id).length };
  S.toolsN = { ...(S.toolsN || {}), [id]: toolsOf(ctx, id).length };
  const soul = list(S.souls).some(e => e.from === id && !e.done) ? list(ctx.secret.soulsrc?.[id]) : null; // 탈락한 나: 넋패 재료
  ctx.setPrivate(id, { hand, grave: graveOf(ctx, id).map(c => c.k), cards: collectionOf(ctx, id), tools: toolsOf(ctx, id), ...(soul ? { soul } : {}) });
}
// 판에서 죽은 생물: 귀환은 손으로, 닭 · 잿불 · 복제는 사라지고, 나머지는 무덤으로
function bury(ctx, id, b) {
  const c = toHand(b);
  if (has(b, 'back')) keep(ctx, 'hands', id, [...handOf(ctx, id), c]);
  else if (!isTok(b)) keep(ctx, 'graves', id, [...graveOf(ctx, id), c]);
}
// 한 장 뽑기: from 'deck' | 'hen'. 덱이 떨어지면 무덤을 섞어 다시 덱으로, 그것도 없으면 닭
function draw(ctx, id, from) {
  const hand = handOf(ctx, id);
  if (hand.length >= HAND_MAX) return null;
  let card = null;
  if (from === 'deck') {
    let deck = deckOf(ctx, id);
    if (!deck.length && graveOf(ctx, id).length) {
      deck = shuffle(graveOf(ctx, id));
      keep(ctx, 'graves', id, []);
      note(ctx.state, `${ctx.nameOf(id)}: 무덤을 섞어 덱으로`);
    }
    card = deck.shift() || null;
    keep(ctx, 'decks', id, deck);
  }
  card ||= make(ctx, 'hen');
  keep(ctx, 'hands', id, [...hand, card]);
  return card;
}
function giveTool(ctx, id, t) {
  const tools = toolsOf(ctx, id);
  if (tools.length >= TOOL_MAX || !TOOLS[t]) return false;
  keep(ctx, 'tools', id, [...tools, t]);
  return true;
}
// 새 패: 서로 다른 카드 n장 (센 것은 덜 나온다)
export function packOffer(rand = Math.random, n = 3) {
  const pool = [...PACK];
  const out = [];
  while (out.length < n && pool.length) {
    let r = rand() * pool.reduce((t, k) => t + packWeight(k), 0);
    const i = Math.max(0, pool.findIndex(k => (r -= packWeight(k)) < 0));
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

function note(S, text) {
  S.log = [...list(S.log), text].slice(-LOG_KEEP);
}

// 방장이 다시 읽은 상태(빈 값이 지워져 있음)도 똑같이 다룰 수 있게 모양을 맞춘다
function fix(S) {
  S.alive = list(S.alive);
  S.order = list(S.order);
  S.board ||= {};
  for (const id of S.alive) S.board[id] = Array.from({ length: SLOTS }, (_, s) => S.board[id]?.[s] || 0);
  S.scale ||= {};
  S.candles ||= {};
  S.bones ||= {};
  S.smoke ||= {};
}

/* ───────── 도구 (놓기 단계에 바로 쓴다) ───────── */

// 쓰면 장면 하나를 돌려준다 (못 쓰면 null). s = 고른 칸 (낫: 그 칸의 맞은편 · 엽전 · 목탁: 그 칸의 전선 · 부적: 내 생물)
function useTool(ctx, pid, t, s) {
  const S = ctx.state;
  const ev = { by: pid, t };
  const okSlot = s >= 0 && s < SLOTS;
  const fx = { ...fxOf(S, pid) };
  if (t === 'sickle') {
    if (!okSlot) return null;
    const foe = foeOf(S, pid, s);
    const ts = across(s);
    const c = cardAt(S, foe, ts);
    if (!c || foe === pid) return null;
    S.board[foe][ts] = 0;
    S.bones[foe] = (S.bones[foe] || 0) + bonesOf(c);
    bury(ctx, foe, c);
    sync(ctx, foe);
    Object.assign(ev, { to: foe, s: ts, c: c.k });
  } else if (t === 'coin') {
    if (!okSlot) return null;
    const f = frontOf(S, pid, s);
    if (scaleFor(S, pid, f) >= SCALE_MAX - 1) return null; // 끝까지는 못 민다: 촛불은 생물만 끈다
    S.scale[f] = (S.scale[f] || 0) + (f === pid ? 1 : -1);
    Object.assign(ev, { f, v: S.scale[f] });
  } else if (t === 'moktak') {
    if (!okSlot) return null;
    const f = frontOf(S, pid, s);
    if (list(fx.mok).includes(f)) return null;
    fx.mok = [...list(fx.mok), f];
    ev.f = f;
  } else if (t === 'coop') {
    keep(ctx, 'hands', pid, [...handOf(ctx, pid), make(ctx, 'hen'), make(ctx, 'hen')]);
  } else if (t === 'fan') {
    if (fx.fan) return null;
    fx.fan = 1;
  } else if (t === 'sack') {
    S.bones[pid] = (S.bones[pid] || 0) + 4;
  } else if (t === 'charm') {
    const c = okSlot ? cardAt(S, pid, s) : null;
    if (!c || list(fx.charm).includes(c.u)) return null;
    fx.charm = [...list(fx.charm), c.u];
    Object.assign(ev, { s, c: c.k });
  } else return null;
  S.fx = { ...(S.fx || {}), [pid]: fx };
  return ev;
}

/* ───────── 길목 ───────── */

function roadOffers(ctx, id) {
  const cards = collectionOf(ctx, id);
  const kinds = ['pack'];
  if (cards.length) kinds.push('fire');
  if (cards.length >= 2 && cards.some(c => sigOf(c).length)) kinds.push('altar');
  if (toolsOf(ctx, id).length < TOOL_MAX) kinds.push('tools');
  return shuffle(kinds).slice(0, 3);
}
function startRoad(ctx, now) {
  const S = ctx.state;
  S.road = { no: (S.road?.no || 0) + 1, offers: Object.fromEntries(S.alive.map(id => [id, roadOffers(ctx, id)])), st: {} };
  Object.assign(S, { phase: 'road', phaseEndsAt: now + ROAD_TIME, ready: {}, rs: null });
  for (const id of S.alive) sync(ctx, id);
  return true;
}
const roadSt = (S, id) => S.road?.st?.[id] || null;
function setRoad(S, id, st) {
  S.road = { ...S.road, st: { ...(S.road.st || {}), [id]: st } };
}
function chooseRoad(ctx, id, kind) {
  const S = ctx.state;
  if (roadSt(S, id) || !list(S.road?.offers?.[id]).includes(kind)) return false;
  const st = { kind };
  if (kind === 'pack') st.cards = packOffer();
  if (kind === 'tools') st.tools = shuffle(Object.keys(TOOLS)).slice(0, 2);
  if (kind === 'fire') st.n = 0;
  setRoad(S, id, st);
  return true;
}
function roadPick(ctx, id, i) { // 새 패 · 도구 상자: 하나 고르기
  const S = ctx.state;
  const st = roadSt(S, id);
  if (!st || st.done) return false;
  if (st.kind === 'pack') {
    const k = list(st.cards)[i];
    if (!k) return false;
    keep(ctx, 'hands', id, [...handOf(ctx, id), make(ctx, k)]);
    setRoad(S, id, { ...st, got: k, done: true });
    note(S, `${ctx.nameOf(id)}: ${CARDS[k].name} 얻음`);
  } else if (st.kind === 'tools') {
    const t = list(st.tools)[i];
    if (!t || !giveTool(ctx, id, t)) return false;
    setRoad(S, id, { ...st, got: t, done: true });
    note(S, `${ctx.nameOf(id)}: 도구 얻음`);
  } else return false;
  sync(ctx, id);
  return true;
}
// 모닥불: 같은 카드만 거듭 달굴 수 있다. 두 번째부터는 탈 수 있다 (BURN)
function fireCard(ctx, id, u, stat, rand = Math.random) {
  const S = ctx.state;
  const st = roadSt(S, id);
  if (!st || st.kind !== 'fire' || st.done || (st.u && st.u !== u) || st.n >= BURN.length) return false;
  const f = findCard(ctx, id, u);
  if (!f || (stat !== 'atk' && stat !== 'hp')) return false;
  const name = cardName(f.card);
  if (rand() < BURN[st.n]) { // 타 버렸다: 카드가 영영 사라진다
    f.arr.splice(f.i, 1);
    keep(ctx, f.key, id, f.arr);
    inc(S, 'burnt', id);
    setRoad(S, id, { ...st, u, k: f.card.k, nm: name, burnt: 1, done: true });
    note(S, `${ctx.nameOf(id)}의 ${name} 타 버림!`);
  } else {
    f.arr[f.i] = { ...f.card, [stat === 'atk' ? 'da' : 'dh']: (f.card[stat === 'atk' ? 'da' : 'dh'] || 0) + (stat === 'atk' ? 1 : 2) };
    keep(ctx, f.key, id, f.arr);
    const n = st.n + 1;
    setRoad(S, id, { ...st, u, k: f.card.k, nm: name, n, last: stat, done: n >= BURN.length });
    if (n === 1) note(S, `${ctx.nameOf(id)}: ${name} ${stat === 'atk' ? '공격 +1' : '체력 +2'}`);
  }
  sync(ctx, id);
  return true;
}
// 제단: from을 바치고 그 문양을 to에 새긴다 (문양은 SIG_MAX개까지)
function altarCards(ctx, id, from, to) {
  const S = ctx.state;
  const st = roadSt(S, id);
  if (!st || st.kind !== 'altar' || st.done || from === to) return false;
  const a = findCard(ctx, id, from);
  const b = findCard(ctx, id, to);
  if (!a || !b) return false;
  const sig = [...sigOf(b.card)];
  const gave = [];
  for (const g of sigOf(a.card)) if (!sig.includes(g) && sig.length < SIG_MAX) { sig.push(g); gave.push(g); }
  if (!gave.length) return false;
  b.arr[b.i] = { ...b.card, sig };
  keep(ctx, b.key, id, b.arr);
  const c = findCard(ctx, id, from); // 같은 묶음이면 위치가 그대로다
  c.arr.splice(c.i, 1);
  keep(ctx, c.key, id, c.arr);
  setRoad(S, id, { ...st, from: cardName(a.card), to: cardName(b.card), gave, done: true });
  note(S, `${ctx.nameOf(id)}: ${cardName(a.card)}의 ${gave.map(g => SIGILS[g].name).join(' · ')} → ${cardName(b.card)}`);
  sync(ctx, id);
  return true;
}
// 시간이 끝났다: 안 고른 사람은 대신 골라 준다 (새 패를 먼저, 모닥불은 안전한 첫 번째만)
function finishRoad(ctx, now) {
  const S = ctx.state;
  for (const id of S.alive) {
    if (!roadSt(S, id)) {
      const offers = list(S.road?.offers?.[id]);
      chooseRoad(ctx, id, offers.includes('pack') ? 'pack' : offers[0]);
    }
    const st = roadSt(S, id);
    if (!st || st.done) continue;
    if (st.kind === 'pack' || st.kind === 'tools') roadPick(ctx, id, Math.floor(Math.random() * list(st.cards || st.tools).length));
    else if (st.kind === 'fire' && !st.n) {
      const best = [...collectionOf(ctx, id)].sort((x, y) => valueOf(y) - valueOf(x))[0];
      if (best) fireCard(ctx, id, best.u, 'atk');
    }
    const after = roadSt(S, id);
    if (after && !after.done) setRoad(S, id, { ...after, done: true });
  }
  S.road = { ...S.road, over: true };
  return startRound(ctx, now);
}

/* ───────── 넋패: 탈락한 사람이 고른 두 장(능력치 · 문양)으로 카드가 되어 꺼뜨린 사람 손에 ───────── */

function makeSoul(ctx, i, statU, sigU) {
  const S = ctx.state;
  const e = list(S.souls)[i];
  if (!e || e.done) return false;
  const src = list(ctx.secret.soulsrc?.[e.from]);
  const best = [...src].sort((x, y) => (statsOf(y).atk * 2 + statsOf(y).hp) - (statsOf(x).atk * 2 + statsOf(x).hp))[0];
  const a = src.find(c => c.u === statU) || best;
  const b = sigU === 0 ? null : src.find(c => c.u === sigU) || (sigU == null ? [...src].sort((x, y) => sigOf(y).length - sigOf(x).length)[0] : null);
  const st = statsOf(a || { k: 'hen' });
  const sig = b ? sigOf(b).slice(0, SIG_MAX) : [];
  const card = make(ctx, 'soul');
  Object.assign(card, { da: st.atk, dh: st.hp - 1, pid: e.from, nm: ctx.nameOf(e.from) });
  if (sig.length) card.sig = sig;
  const gotIt = list(S.alive).includes(e.to);
  if (gotIt) {
    keep(ctx, 'hands', e.to, [...handOf(ctx, e.to), card]);
    inc(S, 'soulsGot', e.to);
    sync(ctx, e.to);
    note(S, `${ctx.nameOf(e.from)}의 넋패 → ${ctx.nameOf(e.to)} (${st.atk}/${st.hp}${sig.length ? ` · ${sig.map(g => SIGILS[g].name).join(' · ')}` : ''})`);
  }
  S.souls = list(S.souls).map((x, k) => (k === i ? { ...x, done: true, atk: st.atk, hp: st.hp, sig: sig.length ? sig : null, got: gotIt } : x));
  sync(ctx, e.from);
  return true;
}

/* ───────── 단계 ───────── */

function startDeck(ctx, now) {
  Object.assign(ctx.state, { phase: 'deck', phaseEndsAt: now + DECK_TIME, deckDone: {} });
  ctx.secret.deckPick = {};
  return true;
}

function deal(ctx, now) {
  const S = ctx.state;
  const keys = Object.keys(DECKS);
  const picked = {};
  Object.assign(ctx.secret, { decks: {}, hands: {}, graves: {}, tools: {} });
  for (const id of S.alive) {
    const want = ctx.secret.deckPick?.[id];
    const k = DECKS[want] ? want : keys[Math.floor(Math.random() * keys.length)];
    picked[id] = k;
    const deck = shuffle(DECKS[k].cards.map(c => make(ctx, c)));
    keep(ctx, 'decks', id, deck.slice(START_HAND));
    keep(ctx, 'hands', id, [...deck.slice(0, START_HAND), ...Array.from({ length: START_HEN }, () => make(ctx, 'hen'))]);
    keep(ctx, 'graves', id, []);
    sync(ctx, id);
  }
  S.picked = picked;
  return startRound(ctx, now);
}

function startRound(ctx, now) {
  const S = ctx.state;
  S.round = (S.round || 0) + 1;
  const m = moonOf(S.round);
  if (m > (S.moon || 0)) note(S, m === 1 ? '붉은 달이 떴다: 직격 +1' : `붉은 달이 짙어진다: 직격 +${m}`);
  Object.assign(S, { moon: m, phase: 'place1', phaseAt: now, phaseEndsAt: now + PLACE_TIME, ready: {}, drew: {}, rs: null, fx: null });
  ctx.secret.plans = {};
  return true;
}

// 놓기 단계가 끝났다: 모두의 계획을 한꺼번에 판에 적용하고 공개한다
function reveal(ctx, now, step) {
  const S = ctx.state;
  const ev = [];
  for (const id of S.alive) {
    const p = ctx.secret.plans?.[id];
    const acts = p && p.step === step && p.round === S.round ? list(p.acts) : [];
    if (acts.length) {
      const r = applyActs(rowOf(S, id), handOf(ctx, id), S.bones[id] || 0, acts, stepSlots(S, id, step), S.round);
      S.board[id] = r.board.map(c => c || 0);
      S.bones[id] = r.bones;
      let hand = r.hand;
      for (const x of r.log) {
        if (x.k === 'sac') {
          inc(S, 'sacs', id);
          if (x.nine != null) { // 아홉 목숨: 피만 주고 그 자리에 남는다
            ev.push({ k: 'sac', by: id, s: x.s, c: x.card.k, nine: x.nine });
            continue;
          }
          if (!has(x.card, 'back') && !isTok(x.card)) keep(ctx, 'graves', id, [...graveOf(ctx, id), toHand(x.card)]);
          inc(S, 'bonesGot', id, bonesOf(x.card));
          ev.push({ k: 'sac', by: id, s: x.s, c: x.card.k, bn: bonesOf(x.card) });
        } else {
          ev.push({ k: 'put', by: id, s: x.s, card: x.card });
          if (has(x.card, 'breed')) { // 번식: 똑같은 카드가 손에 (죽으면 사라지는 복제)
            const copy = { ...toHand(x.card), ...make(ctx, x.card.src?.k || x.card.k), t: 1 };
            hand = [...hand, copy];
            ev.push({ k: 'breed', by: id, s: x.s });
          }
        }
      }
      keep(ctx, 'hands', id, hand);
    }
    if (step === 1 && !S.drew?.[id]) S.drew = { ...(S.drew || {}), [id]: draw(ctx, id, 'deck') ? 'auto' : 'full' }; // 안 뽑았으면 덱에서
    sync(ctx, id);
  }
  Object.assign(S, { rs: ev, rsNo: (S.rsNo || 0) + 1, phase: `reveal${step}`, phaseEndsAt: now + (ev.length ? REVEAL_TIME : 600) });
  ctx.secret.plans = {};
  return true;
}

function startPlace2(ctx, now) {
  Object.assign(ctx.state, { phase: 'place2', phaseAt: now, phaseEndsAt: now + PLACE_TIME, ready: {} });
  ctx.secret.plans = {};
  return true;
}

// 탈락한 사람을 빼고 자리를 메운다: 양옆이 새로 맞대고, 새로 생긴 전선의 저울은 0
export function settle(S, gone) {
  if (!gone.length) return;
  const before = list(S.alive);
  const was = Object.fromEntries(before.map(id => [id, leftOf(S, id)]));
  S.alive = before.filter(id => !gone.includes(id));
  const clearFront = f => { for (const p of Object.keys(S.smoke || {})) if (S.smoke[p]) delete S.smoke[p][f]; };
  for (const x of gone) {
    delete S.scale[x];
    delete S.board[x];
    if (S.smoke) delete S.smoke[x];
    clearFront(x);
  }
  for (const id of S.alive) {
    if (leftOf(S, id) === was[id]) continue;
    S.scale[id] = 0;
    clearFront(id);
  }
}

function fight(ctx, now) {
  const S = ctx.state;
  const res = runFight(S);
  for (const { id, card } of res.deaths) if (!res.gone.includes(id)) bury(ctx, id, card);
  for (const e of res.ev) if (e.k === 'direct') inc(S, 'directs', e.by, e.d);
  for (const e of res.ev) if (e.k === 'die') inc(S, 'bonesGot', e.by, e.bn);
  for (const x of res.lost) {
    inc(S, 'snuffed', x.by);
    if (!res.gone.includes(x.to)) keep(ctx, 'hands', x.to, [...handOf(ctx, x.to), make(ctx, 'ember')]); // 촛불이 꺼진 사람: 잿불 한 장
    note(S, `${ctx.nameOf(x.to)}의 촛불이 꺼졌다 ← ${ctx.nameOf(x.by)}`);
  }
  if (res.outs.length) {
    S.outSeq = (S.outSeq || 0) + 1;
    for (const x of res.outs) {
      S.outAt = { ...(S.outAt || {}), [x.to]: S.outSeq };
      S.dead = { ...(S.dead || {}), [x.to]: x.by };
      ctx.kill(x.by, x.to, '🕯️ 촛불');
      // 넋패 재료: 그 사람이 가진 카드 전부 (판 위에 있던 것까지)
      keep(ctx, 'soulsrc', x.to, [...collectionOf(ctx, x.to), ...list(x.cards).filter(c => !isTok(c))]);
      for (const key of ['hands', 'decks', 'graves', 'tools']) keep(ctx, key, x.to, []);
      note(S, `${ctx.nameOf(x.to)} 탈락 ← ${ctx.nameOf(x.by)}`);
    }
  }
  settle(S, res.gone);
  for (const x of res.outs) { // 넋패: 꺼뜨린 사람이 살아 있으면 받는다
    if (S.alive.includes(x.by) && list(ctx.secret.soulsrc?.[x.to]).length) S.souls = [...list(S.souls), { from: x.to, to: x.by, until: now + SOUL_TIME }];
  }
  // 촛불을 꺼뜨린 사람: 도구 하나 (자리가 있으면)
  const toolKeys = Object.keys(TOOLS);
  for (const x of res.lost) {
    if (!S.alive.includes(x.by) || !giveTool(ctx, x.by, toolKeys[Math.floor(Math.random() * toolKeys.length)])) continue;
    const c = res.ev.find(e => e.k === 'candle' && e.by === x.by && e.f === x.f);
    res.ev.push({ k: 'gift', b: c ? c.b : 0, to: x.by });
  }
  for (const id of [...S.alive, ...res.gone]) sync(ctx, id);
  res.ev.sort((a, b) => a.b - b.b);
  const beats = new Set(res.ev.map(e => e.b)).size;
  const big = res.ev.some(e => e.k === 'candle' || e.k === 'out') ? 1100 : 0;
  Object.assign(S, { rs: res.ev, rsNo: (S.rsNo || 0) + 1, rsStep: BEAT_MS, phase: 'fight', phaseEndsAt: now + 500 + beats * BEAT_MS + big });
  return true;
}

function finish(ctx) {
  const S = ctx.state;
  const ids = list(S.roster || ctx.roster).map(p => p.id);
  const at = id => (S.alive.includes(id) ? Infinity : S.outAt?.[id] ?? -1);
  const standings = Object.fromEntries(ids.map(id => [id, ids.length - ids.filter(o => at(o) > at(id)).length]));
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  const top = obj => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])[0] || [];
  const win = S.alive[0] || null;
  if (win) add(win, (S.candles?.[win] || 0) === 1 ? '🕯️ 촛불 하나로 우승' : '🏆 마지막 촛불');
  const [hunter, n] = top(S.snuffed);
  if (n >= 2) add(hunter, `🔥 촛불 사냥꾼 (${n}개)`);
  const [priest, sacs] = top(S.sacs);
  if (sacs >= 6) add(priest, `🩸 제물 왕 (${sacs}마리)`);
  const [striker, d] = top(S.directs);
  if (d >= 10) add(striker, `🗡️ 직격 왕 (${d})`);
  const [rich, b] = top(S.bonesGot);
  if (b >= 10) add(rich, `🦴 뼈 부자 (${b}개)`);
  const [farmer, hens] = top(S.hens);
  if (hens >= 5) add(farmer, `🐔 닭 장수 (${hens}마리)`);
  const [burner, burnt] = top(S.burnt);
  if (burnt >= 1) add(burner, `🔥 태워 먹음 (${burnt}장)`);
  const [reaper, souls] = top(S.soulsGot);
  if (souls >= 2) add(reaper, `👻 넋 사냥꾼 (${souls}장)`);
  Object.assign(S, { standings, titles, winner: win, phase: 'final', over: true, rs: null });
  return true;
}

/* ───────── 게임 모듈 (scale.js가 묶어서 내보낸다) ───────── */

export function setup(ctx, prev) {
  const ids = shuffle(ctx.roster.map(p => p.id));
  return {
    phase: 'intro',
    phaseEndsAt: ctx.now() + INTRO_TIME,
    again: !!prev,
    round: 0,
    moon: 0,
    order: ids,
    alive: [...ids],
    candles: Object.fromEntries(ids.map(id => [id, CANDLES])),
    bones: Object.fromEntries(ids.map(id => [id, 0])),
    board: Object.fromEntries(ids.map(id => [id, Array(SLOTS).fill(0)])),
    scale: Object.fromEntries(ids.map(id => [id, 0])),
  };
}

export function onInput(ctx, { pid, type, data = {} }) {
  const S = ctx.state;
  if (S.over) return false;
  fix(S);
  if (type === 'soul') { // 탈락한 사람: 넋패로 남길 두 장 (능력치 · 문양. sig 0 = 문양 없이)
    const i = list(S.souls).findIndex(e => e.from === pid && !e.done);
    return i >= 0 && makeSoul(ctx, i, Number(data.stat), data.sig === 0 ? 0 : Number(data.sig) || null);
  }
  if (!S.alive.includes(pid)) return false;
  if (type === 'deck') { // 시작 덱 고르기 (공개는 다 같이)
    if (S.phase !== 'deck' || !DECKS[data.k]) return false;
    keep(ctx, 'deckPick', pid, data.k);
    S.deckDone = { ...(S.deckDone || {}), [pid]: true };
    return true;
  }
  const step = S.phase === 'place1' ? 1 : S.phase === 'place2' ? 2 : 0;
  if (type === 'draw') { // 턴마다 한 번: 내 덱 또는 닭 더미
    if (step !== 1 || data.round !== S.round || S.drew?.[pid] || S.ready?.[pid]) return false;
    const from = data.from === 'hen' ? 'hen' : 'deck';
    const card = draw(ctx, pid, from);
    if (card && from === 'hen') inc(S, 'hens', pid);
    S.drew = { ...(S.drew || {}), [pid]: card ? from : 'full' };
    sync(ctx, pid);
    return true;
  }
  if (type === 'plan') { // 이번 단계의 계획을 통째로 덮어쓴다. ready면 종을 친 것 (되돌릴 수 없다)
    if (!step || data.round !== S.round || data.step !== step || S.ready?.[pid]) return false;
    const acts = list(data.acts).slice(0, 8).map(a => ({ u: Number(a?.u), slot: Number(a?.slot), sac: list(a?.sac).map(Number).slice(0, SLOTS) }));
    keep(ctx, 'plans', pid, { step, round: S.round, acts });
    if (!data.ready) return false;
    S.ready = { ...(S.ready || {}), [pid]: true };
    return true;
  }
  if (type === 'tool') { // 도구: 놓기 단계에 바로 (종을 치기 전)
    if (!step || data.round !== S.round || S.ready?.[pid]) return false;
    const tools = toolsOf(ctx, pid);
    const i = Number(data.i);
    const t = tools[i];
    const ev = t ? useTool(ctx, pid, t, Number(data.s)) : null;
    if (!ev) return false;
    keep(ctx, 'tools', pid, tools.filter((_, k) => k !== i));
    S.tlogNo = (S.tlogNo || 0) + 1;
    S.tlog = [...list(S.tlog), { n: S.tlogNo, ...ev }].slice(-6);
    note(S, `${ctx.nameOf(pid)} ${TOOLS[t].name}!`);
    sync(ctx, pid);
    return true;
  }
  if (S.phase !== 'road' || data.no !== S.road?.no) return false;
  if (type === 'road') return chooseRoad(ctx, pid, data.kind);
  if (type === 'roadpick') return roadPick(ctx, pid, Number(data.i));
  if (type === 'fire') return fireCard(ctx, pid, Number(data.u), data.stat);
  if (type === 'altar') return altarCards(ctx, pid, Number(data.from), Number(data.to));
  if (type === 'roaddone') { // 모닥불 그만 · 제단 건너뛰기
    const st = roadSt(S, pid);
    if (!st || st.done || st.kind === 'pack' || st.kind === 'tools' || (st.kind === 'fire' && !st.n)) return false;
    setRoad(S, pid, { ...st, done: true, skip: st.kind === 'altar' ? 1 : undefined });
    return true;
  }
  return false;
}

export function tick(ctx) {
  const S = ctx.state;
  const now = ctx.now();
  const on = id => ctx.isOnline(id);
  if (S.over) return false;
  fix(S);
  let changed = false;
  list(S.souls).forEach((e, i) => { // 넋패를 안 고른 채로 시간이 끝났다: 대신 고른다
    if (!e.done && (now >= e.until || !on(e.from))) changed = makeSoul(ctx, i, null, null) || changed;
  });
  if (S.phase === 'intro') return (now >= S.phaseEndsAt && startDeck(ctx, now)) || changed;
  if (S.phase === 'deck') {
    const waiting = S.alive.some(id => !S.deckDone?.[id] && on(id));
    return ((!waiting || now >= S.phaseEndsAt + GRACE) && deal(ctx, now)) || changed;
  }
  if (S.phase === 'place1' || S.phase === 'place2') {
    const waiting = S.alive.some(id => !S.ready?.[id] && on(id));
    return ((!waiting || now >= S.phaseEndsAt + GRACE) && reveal(ctx, now, S.phase === 'place1' ? 1 : 2)) || changed;
  }
  if (S.phase === 'reveal1') return (now >= S.phaseEndsAt && startPlace2(ctx, now)) || changed;
  if (S.phase === 'reveal2') return (now >= S.phaseEndsAt && fight(ctx, now)) || changed;
  if (S.phase === 'fight') {
    if (now < S.phaseEndsAt) return changed;
    if (S.alive.length <= 1) return finish(ctx);
    return S.round % ROAD_EVERY === 0 ? startRoad(ctx, now) : startRound(ctx, now);
  }
  if (S.phase === 'road') {
    const waiting = S.alive.some(id => !roadSt(S, id)?.done && on(id));
    return ((!waiting || now >= S.phaseEndsAt + GRACE) && finishRoad(ctx, now)) || changed;
  }
  return changed;
}

/* ───────── 봇: 자기 손패와 모두에게 보이는 판만 쓴다 ───────── */

// 피가 need만큼 되는 제물 조합 (군더더기 없는 것만)
function sacSets(board, need) {
  const own = board.map((c, s) => (c ? s : -1)).filter(s => s >= 0);
  const out = [];
  for (let m = 1; m < 1 << own.length; m++) {
    const set = own.filter((_, i) => m & (1 << i));
    const blood = set.reduce((t, s) => t + bloodOf(board[s]), 0);
    if (blood >= need && !set.some(s => blood - bloodOf(board[s]) >= need)) out.push(set);
  }
  return out;
}

// 이 판으로 이번 턴을 싸워 보면 나에게 얼마나 좋은가 (저울 · 촛불 · 남는 생물 · 뼈)
function botScore(S, id, board, bones) {
  const T = simState(S);
  T.board[id] = board.map(c => (c ? { ...c } : 0));
  T.bones[id] = bones;
  const res = runFight(T, () => 0.5);
  const L = leftOf(S, id);
  const R = rightOf(S, id);
  let sc = 0;
  for (const f of new Set([id, R])) sc += scaleFor(T, id, f) * 1.6;
  for (const x of res.lost) sc += (x.by === id ? 11 : 0) - (x.to === id ? 14 : 0);
  for (const x of res.outs) sc += (x.by === id ? 40 : 0) - (x.to === id ? 200 : 0);
  sc += list(T.board[id]).reduce((t, c) => t + valueOf(c || null), 0) * 0.45;
  const facing = new Set(); // 나와 맞댄 적 생물
  if (L && L !== id) for (const s of rightSlots) if (T.board[L]?.[s]) facing.add(T.board[L][s]);
  if (R && R !== id) for (const s of leftSlots) if (T.board[R]?.[s]) facing.add(T.board[R][s]);
  for (const c of facing) sc -= valueOf(c) * 0.35;
  return sc + (T.bones[id] || 0) * 0.2;
}

// 이번 단계에 낼 것: 좋아지는 수를 하나씩 골라 붙인다 (최대 3수)
function botActs(ctx, id, step) {
  const S = ctx.state;
  const slots = stepSlots(S, id, step);
  let board = rowOf(S, id);
  let hand = handOf(ctx, id);
  let bones = S.bones?.[id] || 0;
  let cur = botScore(S, id, board, bones);
  const acts = [];
  for (let n = 0; n < 3; n++) {
    let best = null;
    for (const card of hand) {
      const d = CARDS[card.k];
      if (!d || (d.bone && bones < d.bone)) continue;
      for (const sac of d.blood ? sacSets(board, d.blood) : [[]]) {
        for (const slot of slots) {
          if (board[slot] && !sac.includes(slot)) continue;
          const act = { u: card.u, sac, slot };
          const r = applyActs(board, hand, bones, [act], slots, S.round);
          if (!r.done) continue;
          const sc = botScore(S, id, r.board, r.bones) - (d.blood || 0) * 0.3 + (has(card, 'grow') || has(card, 'breed') ? 1 : 0) + (Math.random() - 0.5) * 0.6;
          if (!best || sc > best.sc) best = { sc, act, r };
        }
      }
    }
    if (!best || best.sc <= cur + 0.2) break;
    acts.push(best.act);
    ({ board, hand, bones } = best.r);
    cur = best.sc;
  }
  return acts;
}

// 뽑기: 낼 수 있는 몸(제물감)이 모자라면 닭, 아니면 대개 덱
function botDraw(ctx, id) {
  const S = ctx.state;
  const hand = handOf(ctx, id);
  const bodies = rowOf(S, id).filter(Boolean).length + hand.filter(c => !CARDS[c.k]?.blood && !CARDS[c.k]?.bone).length;
  const need = Math.min(99, ...hand.map(c => CARDS[c.k]?.blood || 99));
  if (bodies === 0 || (need < 99 && bodies < need)) return 'hen';
  if (!(S.deckN?.[id] > 0) && !(S.graveN?.[id] > 0)) return 'hen';
  return Math.random() < 0.25 ? 'hen' : 'deck';
}

// 도구: 쓸 만할 때 하나 ({ i, s } 또는 null)
function botTool(ctx, id) {
  const S = ctx.state;
  const tools = toolsOf(ctx, id);
  if (!tools.length || Math.random() < 0.3) return null;
  const row = rowOf(S, id);
  const ends = [0, SLOTS - 1]; // 왼쪽 전선 · 오른쪽 전선을 가리키는 칸
  for (let i = 0; i < tools.length; i++) {
    const t = tools[i];
    if (t === 'sack' || t === 'coop') return { i };
    if (t === 'sickle') { // 맞은편에서 제일 값진 생물
      let best = null;
      for (let s = 0; s < SLOTS; s++) {
        const c = cardAt(S, foeOf(S, id, s), across(s));
        if (c && valueOf(c) >= 6 && (!best || valueOf(c) > best.v)) best = { s, v: valueOf(c) };
      }
      if (best) return { i, s: best.s };
    }
    if (t === 'coin') for (const s of ends) { const v = scaleFor(S, id, frontOf(S, id, s)); if (v >= 1 && v < SCALE_MAX - 1) return { i, s }; }
    if (t === 'moktak') for (const s of ends) if (scaleFor(S, id, frontOf(S, id, s)) <= -2) return { i, s };
    if (t === 'charm') { const s = row.findIndex(c => c && valueOf(c) >= 7); if (s >= 0) return { i, s }; }
    if (t === 'fan' && row.filter(c => c && c.atk > 0).length >= 2) return { i };
  }
  return null;
}

// 길목: 새 패를 즐겨 고르고, 모닥불은 한두 번, 제단은 가끔
function botRoad(ctx, id) {
  const S = ctx.state;
  const R = S.road;
  const st = roadSt(S, id);
  const no = R.no;
  if (!st) {
    const offers = list(R.offers?.[id]);
    const roll = Math.random();
    const kind = offers.includes('tools') && roll < 0.25 ? 'tools' : offers.includes('fire') && roll < 0.5 ? 'fire'
      : offers.includes('altar') && roll < 0.6 ? 'altar' : offers.includes('pack') ? 'pack' : offers[0];
    return { type: 'road', data: { no, kind } };
  }
  if (st.done) return null;
  if (st.kind === 'pack') {
    const score = k => valueOf({ k }) - (CARDS[k].blood || 0) * 1.5 - (CARDS[k].bone || 0) * 0.6 + Math.random();
    const cards = list(st.cards);
    const i = cards.indexOf([...cards].sort((a, b) => score(b) - score(a))[0]);
    return { type: 'roadpick', data: { no, i: Math.max(0, i) } };
  }
  if (st.kind === 'tools') return { type: 'roadpick', data: { no, i: Math.floor(Math.random() * list(st.tools).length) } };
  const cards = collectionOf(ctx, id);
  if (st.kind === 'fire') {
    if (st.n >= 2 || (st.n >= 1 && Math.random() < 0.6)) return { type: 'roaddone', data: { no } };
    const u = st.u || [...cards].sort((a, b) => valueOf(b) - valueOf(a))[0]?.u;
    return u ? { type: 'fire', data: { no, u, stat: Math.random() < 0.5 ? 'atk' : 'hp' } } : { type: 'roaddone', data: { no } };
  }
  // 제단: 문양 있는 값싼 카드를 바쳐, 값진 카드에 새긴다
  const from = [...cards].filter(c => sigOf(c).length).sort((a, b) => valueOf(a) - valueOf(b))[0];
  const to = from && [...cards].filter(c => c !== from && sigOf(c).length < SIG_MAX && sigOf(from).some(g => !sigOf(c).includes(g)))
    .sort((a, b) => valueOf(b) - valueOf(a))[0];
  return from && to ? { type: 'altar', data: { no, from: from.u, to: to.u } } : { type: 'roaddone', data: { no } };
}

// 탈락한 봇: 넋패는 제일 센 카드의 능력치 + 문양이 제일 많은 카드
function ghostBot(ctx, id) {
  const S = ctx.state;
  if (!list(S.souls).some(e => e.from === id && !e.done)) return null;
  return { type: 'soul', data: { stat: null, sig: null } };
}

export function bot(ctx, id, mem) {
  const S = ctx.state;
  const now = ctx.now();
  if (S.over) return null;
  if (!list(S.alive).includes(id)) return ghostBot(ctx, id);
  const key = `${S.phase}:${S.round}`;
  if (mem.key !== key) { // 단계가 바뀌면 사람처럼 조금 있다가
    mem.key = key;
    mem.at = now + (S.phase === 'deck' || S.phase === 'road' ? 800 + Math.random() * 2000 : 1200 + Math.random() * 3500);
    mem.drawn = false;
    mem.tooled = false;
    mem.done = false;
  }
  if (mem.done || now < mem.at) return null;
  if (S.phase === 'deck') {
    mem.done = true;
    if (S.deckDone?.[id]) return null;
    const keys = Object.keys(DECKS);
    return { type: 'deck', data: { k: keys[Math.floor(Math.random() * keys.length)] } };
  }
  if (S.phase === 'road') {
    mem.at = now + 500 + Math.random() * 900; // 다음 고르기까지
    return botRoad(ctx, id);
  }
  if (S.phase !== 'place1' && S.phase !== 'place2') return null;
  if (S.ready?.[id]) { mem.done = true; return null; }
  if (S.phase === 'place1' && !S.drew?.[id] && !mem.drawn) {
    mem.drawn = true;
    mem.at = now + 700 + Math.random() * 1500;
    return { type: 'draw', data: { round: S.round, from: botDraw(ctx, id) } };
  }
  if (!mem.tooled) {
    mem.tooled = true;
    const use = botTool(ctx, id);
    if (use) {
      mem.at = now + 600 + Math.random() * 900;
      return { type: 'tool', data: { round: S.round, i: use.i, s: use.s ?? 0 } };
    }
  }
  mem.done = true;
  const step = S.phase === 'place1' ? 1 : 2;
  return { type: 'plan', data: { round: S.round, step, acts: botActs(ctx, id, step), ready: true } };
}
