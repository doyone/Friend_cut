// 독박 룰렛: 탄창에 실탄·공포탄이 몇 발씩인지만 알고 순서는 모른다 (벅샷룰렛). 내 차례에 카드를 쓰고 한 발을 누군가에게(나 포함) 쏜다.
// 나를 쏴서 공포탄이면 한 번 더, 실탄이면 하트 -1. 남을 쏘면 실탄일 때 그 사람 하트 -1, 어느 쪽이든 차례가 넘어간다.
// 손패는 나만 본다 (갓필드). 남이 나를 쏘면 결과가 나오기 전 3초 동안 🛡️ 방패(막기)·🪞 거울(1칸 되돌리기)로 받아칠 수 있다 → 공포탄이면 카드만 날린다.
// 총구가 누구를 향하는지는 모두에게 보인다 (겨누는 척하기). 하트를 다 잃으면 탈락, 마지막 1명 우승.
// 카드는 아껴서: 처음 3장(카드 2 + 🎰 운명 카드 1) · 탄창 2~3에 1장씩 · 탄창 4부터 막판(안 나오고 실탄이 확 는다). 남을 탈락시키면 1장.
// 🎰 운명 카드: 한 판에 한 장. 쓰면 룰렛이 돌아 총 교체 · 전탄 실탄 · 모두 하트 -1 · … 중 하나가 바로 일어난다.
// ✨ 증강: 시작할 때와 탄창 3을 넣기 전에 모두 동시에 3개 중 1개를 고른다. 등급(실버 · 골드 · 프리즘)은 그 회차에 모두 같고, 고른 증강은 모두에게 보인다.
// 탈락하면 👻 유품: 남은 카드 중 1장을 살아 있는 한 명에게 물려줄 수 있다 (게임은 안 멈춘다).
// 탄 순서와 모두의 손패는 방장만 안다(ctx.secret). 내 손패와 돋보기 · 증강으로 본 탄은 나에게만 온다(ctx.setPrivate). 상태에는 손패 장수만 있다.
// 하트를 깎는 건 언제나 누군가의 한 발이나 선택이다 (쏜 사람 · 거울 쓴 사람 · 나 자신 · 운명 카드를 쓴 사람). 운명 카드로는 아무도 탈락하지 않는다.
import { h, digitOf, isTyping, josa, pick, shuffle, INTRO_TIME } from '../util.js';
import { avatar, countdown, podium } from '../ui.js';
import { createRouletteAudio } from './roulette-audio.js';

export const HAND_MAX = 3;    // 손패 (🎰 운명 카드는 따로)
export const TURN_TIME = 10000;
const CARD_BONUS = 4000;      // 카드를 쓰면 마감이 적어도 이만큼 남는다
const TURN_CAP = 20000;       // 그래도 한 차례는 여기까지
const GRACE = 250;            // 마감 직전에 누른 신호가 도착할 시간
export const REACT_TIME = 3000;
const REACT_GRACE = 300;
const REACT_SHOW = 900;       // 맞을 사람이 다 정한 뒤(카드를 내밀고) 결과가 나올 때까지
const SELF_HUSH = 1300;       // 나에게 쏠 때(또는 아무도 못 막는 발) 두근거리는 시간
const SHOW_TIME = 1700;       // 결과를 보여 주는 시간
const BONUS_TIME = 2300;      // 증강 · 한 발 더가 터지면 조금 더
const DEATH_TIME = 2800;      // 탈락이 나오면 조금 더
export const LOAD_TIME = 3200; // 장전: 앞 절반은 탄을 보여 주고 뒤 절반은 섞어서 숨긴다
const SKIP_TIME = 1300;       // ⛓️ 쉬는 걸 보여 주는 시간
export const WILL_TIME = 8000;
export const PICK_TIME = 10000; // ✨ 증강 고르기
const PICK_SHOW = 1800;       // 다 고르면 모두의 증강을 보여 주는 시간
export const FATE_TIME = 3000; // 🎰 운명 카드: 룰렛이 돌다 멈추고(2.2초) 멈춘 칸을 보여 준 뒤 일어난다
export const QUICK_TIME = 3000; // ⚡ 속사: 차례가 시작되고 이 안에 쏘면
export const FINAL_MAG = 4;   // 이 탄창부터 막판: 카드는 안 나오고 실탄이 확 는다
const PICK2_MAG = 3;          // 두 번째 증강은 이 탄창을 넣기 전에
const LOG_KEEP = 7;

// 카드 8종. w = 뽑힐 비율, when = 내 차례(turn)에 쓰나 맞을 때(react) 쓰나, aim = 겨눈 사람에게 쓰는 카드
export const CARDS = {
  peek: { w: 17, e: '🔍', name: '돋보기', tip: '지금 탄을 나만 봐요', when: 'turn' },
  double: { w: 19, e: '🔥', name: '두 배', tip: '이번 발 피해 2칸', when: 'turn' },
  heal: { w: 6, e: '🩹', name: '반창고', tip: '하트 +1', when: 'turn', rare: true },
  cuff: { w: 14, e: '⛓️', name: '수갑', tip: '겨눈 사람 다음 차례 쉬기', when: 'turn', aim: true },
  steal: { w: 16, e: '🫳', name: '훔치기', tip: '겨눈 사람 카드 1장 뺏기', when: 'turn', aim: true },
  scatter: { w: 6, e: '💥', name: '산탄', tip: '나 빼고 모두에게 한 발', when: 'turn', rare: true },
  shield: { w: 15, e: '🛡️', name: '방패', tip: '나를 쏜 한 발 막기', when: 'react' },
  mirror: { w: 7, e: '🪞', name: '거울', tip: '쏜 사람에게 1칸 되돌리기', when: 'react', rare: true },
};

// ✨ 증강 30종 (등급마다 10). tier 1 실버 · 2 골드 · 3 프리즘. 그림은 a_<이름>
export const AUGS = {
  keen: { tier: 1, e: '👀', name: '눈치 백단', tip: '장전할 때 첫 탄을 나만 봐요' },
  counter: { tier: 1, e: '🥊', name: '빈총 반격', tip: '나를 쏜 탄이 공포탄이면 쏜 사람 카드 1장 뺏기' },
  pouch: { tier: 1, e: '🎒', name: '큰 주머니', tip: '손패 최대 +1 · 바로 카드 1장' },
  revenge: { tier: 1, e: '🗡️', name: '복수심', tip: '나를 맞힌 사람에게 쏘면 피해 +1' },
  hunter: { tier: 1, e: '🎯', name: '사냥꾼', tip: '하트 1개인 사람에겐 방패가 안 통해요' },
  sleuth: { tier: 1, e: '🕵️', name: '탐정', tip: '돋보기로 다음 탄까지 2발을 봐요' },
  thief: { tier: 1, e: '🎭', name: '소매치기', tip: '훔치기로 2장 뺏어요' },
  adren: { tier: 1, e: '💉', name: '아드레날린', tip: '하트가 1개면 내 발 피해 +1' },
  trap: { tier: 1, e: '🪤', name: '덫', tip: '나를 쏜 사람은 다음 차례에 손패를 못 써요' },
  shadow: { tier: 1, e: '🥷', name: '그림자', tip: '내 손패는 안 보이고 훔칠 수도 없어요' },
  vamp: { tier: 2, e: '🩸', name: '흡혈귀', tip: '내 실탄에 남이 맞으면 내 하트 +1' },
  quick: { tier: 2, e: '⚡', name: '속사', tip: '차례 시작 3초 안에 쏘면 피해 +1' },
  fire: { tier: 2, e: '🔥', name: '화력', tip: '두 배 카드가 세 배 · 장전 때 두 배 1장' },
  reflex: { tier: 2, e: '💎', name: '반사 신경', tip: '처음 맞는 실탄 1발은 저절로 되돌려요' },
  sniper: { tier: 2, e: '🔭', name: '저격수', tip: '돋보기 쓴 차례의 발은 아무도 못 막아요' },
  fuse: { tier: 2, e: '💣', name: '도화선', tip: '나를 탈락시킨 사람도 하트 -1' },
  dealer: { tier: 2, e: '🃏', name: '도박사', tip: '운명 카드 1장 더' },
  poison: { tier: 2, e: '🧪', name: '독', tip: '내 실탄에 맞은 사람은 장전 때 하트 -1 (1칸은 남김)' },
  hook: { tier: 2, e: '🪝', name: '갈고리', tip: '내 실탄에 맞은 사람 카드 1장을 가져와요' },
  watcher: { tier: 2, e: '📹', name: '감시자', tip: '남이 돋보기로 본 탄을 나도 봐요' },
  chain: { tier: 3, e: '💀', name: '연쇄 처치', tip: '내 실탄으로 탈락시키면 한 번 더 쏴요' },
  phoenix: { tier: 3, e: '👑', name: '불사조', tip: '처음 탈락할 때 하트 1개로 부활' },
  prophet: { tier: 3, e: '🔮', name: '예언자', tip: '장전할 때 탄 순서를 전부 나만 봐요' },
  devil: { tier: 3, e: '😈', name: '악마의 거래', tip: '하트 1개를 바치고 프리즘 증강 하나 더' },
  dual: { tier: 3, e: '🔫', name: '쌍권총', tip: '남을 쏘면 한 발 더 (차례마다 한 번)' },
  splash: { tier: 3, e: '🧨', name: '폭발탄', tip: '내 실탄이 남을 맞히면 그 옆 사람도 1칸' },
  addict: { tier: 3, e: '🎰', name: '룰렛 중독', tip: '장전할 때마다 운명 카드 +1 (2장까지)' },
  usurp: { tier: 3, e: '🤴', name: '찬탈자', tip: '내가 탈락시킨 사람의 증강을 다 가져와요' },
  mind: { tier: 3, e: '🧠', name: '독심술', tip: '남의 손패가 다 보여요' },
  stun: { tier: 3, e: '💫', name: '기절탄', tip: '내 실탄에 맞은 사람은 다음 차례를 쉬어요' },
};
export const TIERS = { 1: '실버', 2: '골드', 3: '프리즘' };

// 🎰 운명 카드에서 나올 수 있는 일 16가지. w = 나올 비율. 룰렛판에는 이 순서대로 칸이 돈다 (시계 방향, 0번이 처음에 맨 위)
export const FATES = {
  alllive: { w: 6, name: '전탄 실탄!', tip: '남은 탄이 전부 실탄으로' },
  rotate: { w: 6, name: '손패 돌리기', tip: '모두의 카드가 다음 사람에게' },
  tax: { w: 7, name: '세금 징수!', tip: '모두에게서 카드 1장씩 가져와요' },
  myaug: { w: 5, name: '내 증강 바꾸기', tip: '같은 등급의 다른 증강으로' },
  morelive: { w: 7, name: '실탄 +2', tip: '탄창에 실탄 2발을 섞어 넣어요' },
  bleed: { w: 6, name: '모두 하트 -1', tip: '나도 포함 · 마지막 1칸은 안 깎여요' },
  heal: { w: 7, name: '내 하트 +1', tip: '가득이어도 한 칸 더' },
  hpswap: { w: 7, name: '하트 바꾸기', tip: '겨눈 사람과 하트를 바꿔요 (안 겨눴으면 아무나)' },
  power: { w: 7, name: '이번 발 피해 +2', tip: '다음 한 발이 2칸 더 아파요' },
  newaug: { w: 7, name: '증강 하나 더!', tip: '아무 등급 증강 1개를 얻어요' },
  reveal: { w: 7, name: '탄 공개!', tip: '지금 탄을 모두가 봐요' },
  reverse: { w: 5, name: '방향 반대!', tip: '차례가 반대로 돌아요' },
  again: { w: 5, name: '한 번 더 돌려!', tip: '운명 카드 1장 더' },
  allaug: { w: 4, name: '모두 증강 바꾸기', tip: '모두 같은 등급의 다른 증강으로' },
  swap: { w: 7, name: '총 교체!', tip: '남은 탄을 버리고 새 탄창' },
  gift: { w: 7, name: '모두 카드 +1', tip: '살아 있는 모두에게 카드 1장' },
};
export const FATE_ORDER = Object.keys(FATES);

// 하트: 사람이 많으면 적게 (판이 4분을 넘지 않게)
export const livesOf = n => (n <= 2 ? 4 : n <= 5 ? 3 : 2);
// 탄창: 살아 있는 사람 수 ~ +3발 (3~8발). 실탄 비율은 40%에서 탄창마다 7%p씩 올라 최대 75%.
// 막판(탄창 4부터)은 15%p 더 (최대 85%). 실탄·공포탄 모두 적어도 1발
export function magOf(alive, no, rand = Math.random) {
  const lo = Math.max(3, Math.min(8, alive));
  const hi = Math.max(lo, Math.min(8, alive + 3));
  const n = lo + Math.floor(rand() * (hi - lo + 1));
  const base = Math.min(0.75, 0.4 + 0.07 * (no - 1));
  const ratio = no >= FINAL_MAG ? Math.min(0.85, base + 0.15) : base;
  const live = Math.max(1, Math.min(n - 1, Math.round(n * ratio)));
  return { live, blank: n - live };
}
// 장전할 때 받는 카드: 첫 탄창 2장(+ 🎰 운명 카드 1장), 탄창 2~3은 1장, 막판은 없음 (처치로만 번다)
export const dealOf = (alive, no) => (no === 1 ? 2 : no < FINAL_MAG ? 1 : 0);
// 카드 한 장 뽑기 (둘만 남으면 산탄은 그냥 한 발이라 안 나온다)
export function drawCard(alive, rand = Math.random) {
  const keys = Object.keys(CARDS).filter(k => k !== 'scatter' || alive > 2);
  let r = rand() * keys.reduce((a, k) => a + CARDS[k].w, 0);
  for (const k of keys) if ((r -= CARDS[k].w) < 0) return k;
  return 'peek';
}

// 지금 탄을 가리키는 이름: 돋보기로 본 게 '이 탄'인지 확인하는 데 쓴다
export const shellKey = S => `${S.magNo || 0}:${(S.fired || []).length}`;
const inc = (S, key, id, n = 1) => { S[key] = { ...(S[key] || {}), [id]: (S[key]?.[id] || 0) + n }; };
const handOf = (ctx, id) => [...(ctx.secret.hands?.[id] || [])];
const augsOf = (S, id) => S.augs?.[id] || [];
export const hasAug = (S, id, a) => augsOf(S, id).includes(a);
export const handMax = (S, id) => HAND_MAX + (hasAug(S, id, 'pouch') ? 1 : 0);

// 차례는 앉은 순서대로 (화면에서는 시계 방향, 🎰 방향 반대가 나오면 거꾸로)
export function nextAlive(S, id) {
  const n = S.order.length;
  const i = S.order.indexOf(id);
  const d = S.dir === -1 ? -1 : 1;
  for (let k = 1; k <= n; k++) {
    const x = S.order[(((i + d * k) % n) + n) % n];
    if (S.alive.includes(x)) return x;
  }
  return id;
}

// 그 사람에게만 보내는 것: 손패, 돋보기(· 눈치 백단 · 감시자)로 본 지금 탄, 🔮 예언자 · 🕵️ 탐정으로 본 탄 순서,
// 🧠 독심술이면 남의 손패 (🥷 그림자는 빼고)
function tell(ctx, id) {
  const S = ctx.state;
  const peek = ctx.secret.peeks?.[id];
  const vision = ctx.secret.visions?.[id];
  const minds = hasAug(S, id, 'mind') && S.alive.includes(id)
    ? Object.fromEntries(S.alive.filter(x => x !== id && !hasAug(S, x, 'shadow')).map(x => [x, ctx.secret.hands?.[x] || []]))
    : null;
  ctx.setPrivate(id, {
    hand: ctx.secret.hands?.[id] || [],
    peek: peek?.key === shellKey(S) ? peek : null,
    vision: vision?.mag === S.magNo ? seqOf(vision, (S.fired || []).length + (ctx.secret.shells || []).length) : null,
    minds,
  });
}
const tellAll = ctx => { for (const id of ctx.state.alive) tell(ctx, id); };
// 🔮 · 🕵️ 탄 순서 칸을 길이 n의 배열로 (모르는 칸은 null). 방장이 바뀌어 Firebase에서 다시 읽으면
// 빈칸이 빠지고 배열이 객체로 올 수 있어서 읽을 때마다 맞춘다
const seqOf = (v, n) => Array.from({ length: n }, (_, i) => (v?.seq?.[i] === 0 || v?.seq?.[i] === 1 ? v.seq[i] : null));

function setHand(ctx, id, hand) {
  const S = ctx.state;
  ctx.secret.hands = { ...(ctx.secret.hands || {}), [id]: hand };
  S.cards = { ...(S.cards || {}), [id]: hand.length };
  tell(ctx, id);
  for (const m of S.alive) if (m !== id && hasAug(S, m, 'mind')) tell(ctx, m); // 🧠 남의 손패가 바뀌면 다시
}
// 그 사람 손패에서 아무거나 1장을 내 손패로 (훔치기 · 갈고리 · 빈총 반격 · 세금). 옮겼으면 true
function snatch(ctx, from, to) {
  const S = ctx.state;
  const theirs = handOf(ctx, from);
  const mine = handOf(ctx, to);
  if (!theirs.length || mine.length >= handMax(S, to) || hasAug(S, from, 'shadow')) return false;
  mine.push(theirs.splice(Math.floor(Math.random() * theirs.length), 1)[0]);
  setHand(ctx, from, theirs);
  setHand(ctx, to, mine);
  return true;
}

// 카드 n장 주기 (손패가 차면 거기까지). 준 장수를 돌려준다
function give(ctx, id, n, card = null) {
  const S = ctx.state;
  const hand = handOf(ctx, id);
  let c = 0;
  for (; c < n && hand.length < handMax(S, id); c++) hand.push(card || drawCard(S.alive.length));
  if (c) setHand(ctx, id, hand);
  return c;
}

// 남은 탄 (앞이 지금 탄). 방장이 바뀌다가 개수가 어긋났으면 남은 개수대로 다시 섞는다
function shellsOf(ctx) {
  const S = ctx.state;
  const { live = 0, blank = 0 } = S.left || {};
  const cur = ctx.secret.shells || [];
  if (cur.length === live + blank && cur.filter(Boolean).length === live) return [...cur];
  ctx.secret.peeks = {};
  ctx.secret.visions = {};
  S.reveal = null;
  return shuffle([...Array(live).fill(1), ...Array(blank).fill(0)]);
}

function note(ctx, text) {
  const S = ctx.state;
  S.log = [...(S.log || []), text].slice(-LOG_KEEP);
}

function event(S, ev) {
  S.evNo = (S.evNo || 0) + 1;
  S.ev = { no: S.evNo, ...ev };
}

/* ───────── ✨ 증강 고르기 ───────── */

// 등급은 회차마다 모두 같게: 첫 회차 실버 50% · 골드 35% · 프리즘 15%, 두 번째(막판 앞)는 골드 60% · 프리즘 40%
export function tierOf(round, rand = Math.random) {
  const r = rand();
  if (round === 1) return r < 0.5 ? 1 : r < 0.85 ? 2 : 3;
  return r < 0.6 ? 2 : 3;
}
// 그 등급에서 아직 없는 증강 3개 (하트가 1개면 악마의 거래는 바칠 게 없어서 안 나온다)
export function offerOf(S, id, tier) {
  const mine = augsOf(S, id);
  const pool = Object.keys(AUGS).filter(a => AUGS[a].tier === tier && !mine.includes(a) && !(a === 'devil' && (S.hp?.[id] || 0) <= 1));
  return shuffle(pool).slice(0, 3);
}

function startPick(ctx, now, round, after) {
  const S = ctx.state;
  const tier = tierOf(round);
  ctx.secret.picks = {};
  S.pick = { round, tier, offers: Object.fromEntries(S.alive.map(id => [id, offerOf(S, id, tier)])), done: {}, got: null };
  Object.assign(S, { phase: 'pick', phaseEndsAt: now + PICK_TIME, after, turn: null, aim: null });
  note(ctx, `✨ 증강 ${round}회차: ${TIERS[tier]}`);
  return true;
}

// 증강을 얻는다 (바로 생기는 효과까지). 얻은 것들을 돌려준다 (악마의 거래는 고를 때만 하트를 바치고 프리즘 하나가 더 붙는다)
function gain(ctx, id, a, pay = true) {
  const S = ctx.state;
  S.augs = { ...(S.augs || {}), [id]: [...augsOf(S, id), a] };
  const used = { ...(S.used || {}) };
  delete used[`${a}:${id}`];
  S.used = used;
  if (a === 'pouch') give(ctx, id, 1);
  if (a === 'dealer') S.fates = { ...(S.fates || {}), [id]: (S.fates?.[id] || 0) + 1 };
  if (a === 'devil' && pay) {
    S.hp = { ...S.hp, [id]: Math.max(1, (S.hp?.[id] || 0) - 1) };
    const pool = Object.keys(AUGS).filter(x => AUGS[x].tier === 3 && x !== 'devil' && !augsOf(S, id).includes(x));
    if (pool.length) return [a, ...gain(ctx, id, pick(pool))];
  }
  return [a];
}

// 다 골랐거나 시간이 끝나면 한꺼번에 공개 (안 고른 사람은 셋 중 아무거나)
function revealPicks(ctx, now) {
  const S = ctx.state;
  const got = {};
  for (const id of S.alive) {
    const offers = S.pick.offers?.[id] || [];
    const a = offers.includes(ctx.secret.picks?.[id]) ? ctx.secret.picks[id] : pick(offers);
    if (a) got[id] = gain(ctx, id, a);
  }
  tellAll(ctx); // 독심술 · 그림자가 생겼을 수 있다
  S.pick = { ...S.pick, got };
  S.phaseEndsAt = now + PICK_SHOW;
  return true;
}

// 🎰 증강 바꾸기: 가진 증강을 같은 등급의 다른 것으로 (악마의 거래는 다시 안 나온다)
function reroll(ctx, id) {
  const S = ctx.state;
  const before = augsOf(S, id);
  const after = [];
  for (const a of before) {
    const pool = Object.keys(AUGS).filter(x => AUGS[x].tier === AUGS[a].tier && x !== 'devil' && !before.includes(x) && !after.includes(x));
    after.push(pool.length ? pick(pool) : a);
  }
  S.augs = { ...S.augs, [id]: after };
  const used = { ...(S.used || {}) };
  for (const a of after) if (!before.includes(a)) delete used[`${a}:${id}`];
  S.used = used;
  for (const a of after) {
    if (before.includes(a)) continue;
    if (a === 'pouch') give(ctx, id, 1);
    if (a === 'dealer') S.fates = { ...(S.fates || {}), [id]: (S.fates?.[id] || 0) + 1 };
  }
  const hand = handOf(ctx, id); // 큰 주머니가 없어져 손패가 넘치면 넘친 만큼 버린다
  if (hand.length > handMax(S, id)) setHand(ctx, id, hand.slice(0, handMax(S, id)));
  return after;
}

// 🎰 증강 하나 더: 등급은 첫 회차처럼 굴리고, 그 등급에 남은 게 없으면 다른 등급에서 (악마의 거래는 빼고)
function randomAug(S, id) {
  for (const t of [tierOf(1), 1, 2, 3]) {
    const pool = Object.keys(AUGS).filter(a => AUGS[a].tier === t && a !== 'devil' && !hasAug(S, id, a));
    if (pool.length) return pick(pool);
  }
  return null;
}

/* ───────── 장전 · 차례 ───────── */

// 장전: 새 탄창을 보여 주고, 살아 있는 사람은 카드를 받는다. 끝나면 nextId의 차례.
// swap = 🎰 총 교체 (남은 탄을 다 버리고, 카드는 안 준다)
function load(ctx, now, nextId, swap = false) {
  const S = ctx.state;
  const n = S.alive.length;
  const rest = (S.left?.live || 0) + (S.left?.blank || 0);
  const dud = !S.magNo ? 0 : swap ? rest : S.left?.blank || 0; // 버리는 탄
  S.magNo = (S.magNo || 0) + 1;
  const mag = magOf(n, S.magNo);
  const shells = shuffle([...Array(mag.live).fill(1), ...Array(mag.blank).fill(0)]);
  ctx.secret.shells = shells;
  ctx.secret.peeks = {};
  ctx.secret.visions = {};
  S.fired = [];
  S.reveal = null;
  const k = swap ? 0 : dealOf(n, S.magNo);
  const dealt = {};
  const fates = { ...(S.fates || {}) };
  const poisoned = S.alive.filter(id => S.poison?.[id] && (S.hp?.[id] || 0) > 1); // 🧪 독: 마지막 1칸은 남긴다
  if (poisoned.length) S.hp = { ...S.hp, ...Object.fromEntries(poisoned.map(id => [id, S.hp[id] - 1])) };
  S.poison = {};
  for (const id of S.alive) {
    let c = give(ctx, id, k);
    if (!swap && hasAug(S, id, 'fire')) c += give(ctx, id, 1, 'double');
    if (c) dealt[id] = c;
    if (S.magNo === 1) fates[id] = (fates[id] || 0) + 1; // 첫 장전: 카드 2장 + 🎰 운명 카드 1장
    if (!swap && hasAug(S, id, 'addict')) fates[id] = Math.max(fates[id] || 0, Math.min(2, (fates[id] || 0) + 1)); // 🎰 룰렛 중독
    if (hasAug(S, id, 'keen')) ctx.secret.peeks[id] = { key: shellKey(S), live: shells[0] };
    if (hasAug(S, id, 'prophet')) ctx.secret.visions[id] = { mag: S.magNo, seq: [...shells] };
    tell(ctx, id);
  }
  Object.assign(S, {
    fates, poisoned, phase: 'load', phaseEndsAt: now + LOAD_TIME, mag, left: { ...mag }, dealt, dud, swap, after: nextId,
    turn: null, aim: null, double: false, scatter: false, peeked: false,
  });
  const final = !swap && S.magNo === FINAL_MAG ? ' · 🔥 막판' : '';
  note(ctx, `${swap ? '🔄 총 교체' : `🔄 탄창 ${S.magNo}`}: 🔴 실탄 ${mag.live} · ⚪ 공포탄 ${mag.blank}${final}${poisoned.length ? ` · 🧪 ${poisoned.map(ctx.nameOf).join(', ')} -1` : ''}`);
  return true;
}

// 탄이 떨어졌다: 증강 고를 때면 먼저 고르고(시작할 때 · 탄창 3 앞) 장전
function reload(ctx, now, id) {
  const S = ctx.state;
  const no = (S.magNo || 0) + 1;
  const round = !S.rounds ? 1 : S.rounds === 1 && no >= PICK2_MAG ? 2 : 0;
  return round ? startPick(ctx, now, round, id) : load(ctx, now, id);
}

function openTurn(ctx, now, id) {
  const S = ctx.state;
  // 같은 사람이 이어서 쏘면(나를 쏴서 공포탄 · 맞은 사람이 수갑이라 차례가 돌아옴) 총구는 방금 겨눈 곳 그대로.
  // 차례가 돌아온 걸 못 알아채고 시간이 끝나도 엉뚱하게 나에게 나가지 않는다 (repeat = 화면에 '한 번 더').
  // 🎰 총 교체 뒤에는 하던 차례를 그대로 잇는다 (resume: 겨눈 곳 · 두 배 · 산탄)
  const resume = S.resume?.by === id ? S.resume : null;
  const repeat = !resume && S.keepAim?.by === id;
  const kept = resume ? resume.aim : repeat ? S.keepAim.to : null;
  if (S.power && S.power.by !== id) S.power = null;
  Object.assign(S, {
    phase: 'turn', turn: id, turnNo: (S.turnNo || 0) + 1, turnAt: now, turnEndsAt: now + TURN_TIME, turnCap: now + TURN_CAP,
    aim: !resume?.scatter && S.alive.includes(kept) ? kept : null, repeat, keepAim: null, resume: null,
    double: !!resume?.double, scatter: !!resume?.scatter, peeked: false,
  });
  return true;
}

// 차례를 넘긴다. 수갑 찬 사람은 건너뛰고(보여 주고), 실탄이 안 남았으면(다 쐈거나 공포탄뿐) 먼저 장전한다.
// fresh = false면 방금 쏜 사람이 이어서 하는 것 (나를 쏴서 공포탄 · 💀 연쇄 처치 · 🔫 쌍권총)
function enter(ctx, now, id, fresh = true) {
  const S = ctx.state;
  if (fresh) Object.assign(S, { dualUsed: false, sealed: null });
  if (fresh && S.cuffs?.[id]) {
    const stun = S.cuffs[id] === 'stun';
    const cuffs = { ...S.cuffs };
    delete cuffs[id];
    Object.assign(S, { cuffs, phase: 'skip', skip: id, skipBy: stun ? 'stun' : 'cuff', phaseEndsAt: now + SKIP_TIME, turn: null, aim: null });
    note(ctx, `${stun ? '💫' : '⛓️'} ${ctx.nameOf(id)} ${stun ? '기절해서 ' : ''}이번 차례 쉼`);
    return true;
  }
  if (fresh && S.seals?.[id]) {
    const seals = { ...S.seals };
    delete seals[id];
    Object.assign(S, { seals, sealed: id });
  }
  if (!(S.left?.live > 0)) return reload(ctx, now, id);
  return openTurn(ctx, now, id);
}

// 방아쇠: 결과는 바로 안 나온다. 남을 쐈으면 맞을 사람이 받아칠 시간을 준다.
// 피해 = 1 (두 배 2 · 🔥 화력이면 3) + 쌓아 둔 피해(🎰 피해 +2) + ⚡ 속사 + 🗡️ 복수심 + 💉 아드레날린(하트 1개)
function fire(ctx, now, to, auto = false) {
  const S = ctx.state;
  const by = S.turn;
  const others = S.alive.filter(id => id !== by);
  const targets = S.scatter ? others : to === by ? [by] : others.includes(to) ? [to] : null;
  if (!targets?.length) return false;
  const self = targets[0] === by;
  const quick = !auto && hasAug(S, by, 'quick') && now - (S.turnAt || 0) <= QUICK_TIME + GRACE;
  const grudge = !self && !S.scatter && hasAug(S, by, 'revenge') && S.grudges?.[by] === targets[0];
  const adren = hasAug(S, by, 'adren') && (S.hp?.[by] || 0) === 1;
  const dmg = (S.double ? (hasAug(S, by, 'fire') ? 3 : 2) : 1) + (S.power?.by === by ? S.power.n : 0) + (quick ? 1 : 0) + (grudge ? 1 : 0) + (adren ? 1 : 0);
  const pierce = !self && !!S.peeked && hasAug(S, by, 'sniper'); // 🔭 저격수: 받아칠 수 없다
  S.power = null;
  S.shotNo = (S.shotNo || 0) + 1;
  S.shot = {
    no: S.shotNo, by, to: targets, self, auto, dmg, dbl: dmg >= 2, sc: !!S.scatter, peeked: !!S.peeked, pierce, quick, grudge,
    until: now + REACT_TIME,                                 // 받아치기 마감 (화면 막대)
    endsAt: now + (self || pierce ? SELF_HUSH : REACT_TIME), // 결과가 나오는 시각 (다들 정하면 당겨진다)
  };
  if (self && !auto) inc(S, 'selfs', by);
  S.phase = 'hush';
  return true;
}

function closeWill(ctx, id) {
  const S = ctx.state;
  const wills = { ...(S.wills || {}) };
  delete wills[id];
  S.wills = wills;
  setHand(ctx, id, []);
}

function expireWills(ctx, now) {
  let changed = false;
  for (const [id, until] of Object.entries(ctx.state.wills || {})) {
    if (now < until + GRACE && ctx.isOnline(id)) continue;
    closeWill(ctx, id);
    changed = true;
  }
  return changed;
}

const FX_NOTE = {
  hunter: '🎯 관통', reflex: '💎 반사 신경', phoenix: '👑 부활', vamp: '🩸 흡혈', counter: '🥊 빈총 반격', fuse: '💣 도화선', kill: '🎁 처치',
  trap: '🪤 덫', splash: '🧨 폭발', hook: '🪝 갈고리', poison: '🧪 독', stun: '💫 기절', usurp: '🤴 찬탈',
};

// 결과: 지금 탄을 꺼내 보고, 받아치기 · 증강을 반영해서 하트를 깎는다. 처치 보상도 여기서
function resolve(ctx, now) {
  const S = ctx.state;
  const shot = S.shot;
  const by = shot.by;
  const name = ctx.nameOf;
  const shells = shellsOf(ctx);
  const live = shells.shift() ? 1 : 0;
  ctx.secret.shells = shells;
  ctx.secret.peeks = {};
  S.fired = [...(S.fired || []), live];
  S.left = { live: S.left.live - live, blank: S.left.blank - (1 - live) };
  S.reveal = null;

  const dmg = shot.dmg || 1;
  const used = { ...(S.used || {}) };
  const once = (a, id) => hasAug(S, id, a) && !used[`${a}:${id}`] && (used[`${a}:${id}`] = true);
  const hits = {};     // 누가 몇 칸 잃나
  const blame = {};    // 그 사람 하트는 누구 탓인가 (없으면 스스로)
  const blocked = [];
  const mirrored = [];
  const wasted = [];
  const fx = [];       // 증강 · 보상 연출 { k, id, n?, from?, got? }
  for (const id of shot.to) {
    let r = shot.self || shot.pierce ? null : shot.react?.[id];
    if (r !== 'shield' && r !== 'mirror') r = null; // 'pass' = 그냥 맞기
    if (r === 'shield' && live && hasAug(S, by, 'hunter') && (S.hp?.[id] || 0) <= 1) { // 🎯 사냥꾼: 마지막 하트의 방패는 뚫린다
      r = null;
      fx.push({ k: 'hunter', id });
    }
    if (!r && live && !shot.self && !shot.pierce && once('reflex', id)) { // 💎 반사 신경: 저절로 되돌린다 (한 판에 1번)
      r = 'mirror';
      fx.push({ k: 'reflex', id });
    }
    if (r === 'shield' || r === 'mirror') {
      if (!live) { // 공포탄이었다: 카드만 날림
        wasted.push(id);
        inc(S, 'wastes', id);
      } else if (r === 'shield') {
        blocked.push(id);
        inc(S, 'blocks', id);
      } else { // 되돌아가는 건 늘 1칸 (두 배 · 증강이 붙어도)
        mirrored.push(id);
        inc(S, 'mirrors', id);
        hits[by] = (hits[by] || 0) + 1;
        blame[by] ||= id;
      }
      continue;
    }
    if (!live) {
      if (!shot.self && hasAug(S, id, 'counter') && snatch(ctx, by, id)) fx.push({ k: 'counter', id, from: by }); // 🥊 빈총 반격
      continue;
    }
    hits[id] = (hits[id] || 0) + dmg;
    if (id !== by) blame[id] = by;
  }
  const trapper = shot.self ? null : shot.to.find(id => id !== by && hasAug(S, id, 'trap')); // 🪤 덫: 쏜 사람 다음 차례 손패 봉인
  if (trapper) {
    S.seals = { ...(S.seals || {}), [by]: true };
    fx.push({ k: 'trap', id: by, from: trapper });
  }
  const target = shot.to[0];
  if (live && !shot.sc && !shot.self && hasAug(S, by, 'splash') && hits[target] > 0 && blame[target] === by) { // 🧨 폭발탄: 옆 사람도 1칸
    const back = { ...S, dir: S.dir === -1 ? 1 : -1 };
    let nb = nextAlive(S, target);
    if (nb === by) nb = nextAlive(back, target);
    if (nb !== target && nb !== by) {
      hits[nb] = (hits[nb] || 0) + 1;
      blame[nb] ||= by;
      fx.push({ k: 'splash', id: nb, from: target });
    }
  }
  const hp = { ...S.hp };
  const dead = [];
  for (const [id, d] of Object.entries(hits)) {
    hp[id] = Math.max(0, (hp[id] || 0) - d);
    if (hp[id]) continue;
    if (once('phoenix', id)) { // 👑 불사조: 처음 탈락할 때 하트 1개로
      hp[id] = 1;
      fx.push({ k: 'phoenix', id });
    } else dead.push(id);
  }
  for (const [id, who] of Object.entries(blame)) S.grudges = { ...(S.grudges || {}), [id]: who }; // 🗡️ 복수심: 나를 마지막으로 맞힌 사람
  if (live && hasAug(S, by, 'vamp') && hp[by] > 0) { // 🩸 흡혈귀: 내 실탄에 맞은 남 1명마다 +1 (가득까지)
    const n = Math.min(shot.to.filter(id => id !== by && hits[id] > 0).length, Math.max(0, S.maxHp - hp[by]));
    if (n) {
      hp[by] += n;
      fx.push({ k: 'vamp', id: by, n });
    }
  }
  for (const id of dead) { // 💣 도화선: 나를 탈락시킨 사람도 -1 (마지막 1칸은 남긴다)
    const killer = blame[id];
    if (killer && hasAug(S, id, 'fuse') && !dead.includes(killer) && hp[killer] > 1) {
      hp[killer] -= 1;
      fx.push({ k: 'fuse', id: killer, from: id });
    }
  }
  S.hp = hp;
  S.used = used;
  const struck = live ? Object.keys(hits).filter(id => id !== by && blame[id] === by) : []; // 내 실탄에 맞은 사람들
  if (hasAug(S, by, 'hook') && !dead.includes(by)) for (const id of struck) if (snatch(ctx, id, by)) fx.push({ k: 'hook', id: by, from: id }); // 🪝 갈고리
  if (hasAug(S, by, 'poison')) { // 🧪 독: 다음 장전 때 -1
    const alivePoisoned = struck.filter(id => !dead.includes(id));
    if (alivePoisoned.length) {
      S.poison = { ...(S.poison || {}), ...Object.fromEntries(alivePoisoned.map(id => [id, by])) };
      for (const id of alivePoisoned) fx.push({ k: 'poison', id });
    }
  }
  if (hasAug(S, by, 'stun')) { // 💫 기절탄: 다음 차례를 쉰다
    for (const id of struck) {
      if (dead.includes(id) || S.cuffs?.[id]) continue;
      S.cuffs = { ...(S.cuffs || {}), [id]: 'stun' };
      fx.push({ k: 'stun', id });
    }
  }

  // 나를 쏴서 공포탄: 한 번 더. 시간이 끝나 나에게 나간 탄도 쳐 준다 (자리를 비운 사람만 빼고: 혼자 계속 쏘며 판을 끌지 않게).
  // 💀 연쇄 처치 · 🔫 쌍권총도 한 번 더 (more)
  const again = shot.self && !live && (!shot.auto || ctx.isOnline(by));
  let more = null;
  if (!again && !dead.includes(by) && ctx.isOnline(by)) {
    if (hasAug(S, by, 'chain') && dead.some(id => blame[id] === by)) more = 'chain';
    else if (hasAug(S, by, 'dual') && !shot.self && !S.dualUsed) {
      more = 'dual';
      S.dualUsed = true;
    }
  }
  Object.assign(shot, { live, hits, blocked, mirrored, wasted, dead, again: again || !!more, more, fx });
  let line = `${name(by)} → ${shot.sc ? '모두' : shot.self ? '자신' : name(shot.to[0])}: ${live ? `🔴 실탄${dmg > 1 ? ` ×${dmg}` : ''}` : '⚪ 공포탄'}`;
  if (blocked.length) line += ` · 🛡️ ${blocked.map(name).join(', ')}`;
  if (mirrored.length) line += ` · 🪞 ${mirrored.map(name).join(', ')}`;
  if (wasted.length) line += ` · 😅 ${wasted.map(name).join(', ')} 헛카드`;
  if (again) line += ' · 한 번 더';
  if (more) line += more === 'chain' ? ' · 💀 연쇄 처치' : ' · 🔫 한 발 더';
  for (const f of fx) line += ` · ${FX_NOTE[f.k]}`;
  note(ctx, line);

  for (const id of dead) {
    const killer = blame[id] || null;
    S.outAt = { ...(S.outAt || {}), [id]: shot.no };
    S.outOrder = [...(S.outOrder || []), id];
    S.dead = { ...(S.dead || {}), [id]: killer || '-' };
    if (killer) {
      ctx.kill(killer, id, id === by ? '🪞 거울 반사' : shot.sc ? '💥 산탄' : dmg >= 3 ? `🔥 ${dmg}칸 실탄` : dmg === 2 ? '🔥 두 배 실탄' : '🔫 실탄');
      inc(S, 'kills', killer);
    } else {
      ctx.announce(shot.auto ? `⏰ ${name(id)} 시간 초과로 나간 탄에 자폭!` : `💥 ${name(id)} 자폭!`);
      S.boomer ||= id;
    }
  }
  if (dead.length) {
    S.alive = S.alive.filter(id => !dead.includes(id));
    for (const id of dead) { // 🎁 처치 보상: 탈락시킨 사람에게 카드 1장 · 🤴 찬탈자는 증강까지
      const killer = blame[id];
      if (!killer || !S.alive.includes(killer)) continue;
      fx.push({ k: 'kill', id: killer, got: give(ctx, killer, 1) });
      if (!hasAug(S, killer, 'usurp')) continue;
      const taken = augsOf(S, id).filter(a => !hasAug(S, killer, a));
      if (!taken.length) continue;
      S.augs = { ...S.augs, [id]: augsOf(S, id).filter(a => !taken.includes(a)) };
      const left = handOf(ctx, id); // 큰 주머니를 빼앗기면 유품으로 남은 손패도 한도까지만
      if (left.length > handMax(S, id)) setHand(ctx, id, left.slice(0, handMax(S, id)));
      for (const a of taken) gain(ctx, killer, a, false);
      fx.push({ k: 'usurp', id: killer, from: id, augs: taken });
    }
    tellAll(ctx);
    const cuffs = { ...(S.cuffs || {}) };
    const seals = { ...(S.seals || {}) };
    for (const id of dead) {
      delete cuffs[id];
      delete seals[id];
    }
    Object.assign(S, { cuffs, seals });
    for (let i = fx.length - 1; i >= 0; i--) if (fx[i].k === 'trap' && dead.includes(fx[i].id)) fx.splice(i, 1);
    for (const id of dead) {
      // 👻 유품: 판이 안 끝났고 카드가 남았으면 한 장 물려줄 시간을 준다
      if (S.alive.length >= 2 && handOf(ctx, id).length) S.wills = { ...(S.wills || {}), [id]: now + WILL_TIME };
      else setHand(ctx, id, []);
    }
  }
  S.phase = 'shot';
  S.phaseEndsAt = now + (dead.length ? DEATH_TIME : more || fx.length ? BONUS_TIME : SHOW_TIME);
  return true;
}

function finish(ctx) {
  const S = ctx.state;
  const ids = (S.roster || ctx.roster).map(p => p.id);
  // 같은 한 발에 같이 탈락했으면 같은 등수
  const at = id => (S.alive.includes(id) ? Infinity : S.outAt?.[id] ?? -1);
  const standings = Object.fromEntries(ids.map(id => [id, ids.length - ids.filter(o => at(o) > at(id)).length]));
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  const top = obj => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])[0] || [];
  if (S.alive[0]) add(S.alive[0], '🔫 최후의 1인');
  const [killer, kills] = top(S.kills);
  if (kills >= 1) add(killer, `🎯 명사수 (${kills}킬)`);
  const [mir, m] = top(S.mirrors);
  if (m >= 1) add(mir, `🪞 반사왕 (${m}번)`);
  const [wall, b] = top(S.blocks);
  if (b >= 2) add(wall, `🛡️ 철벽 (실탄 ${b}번 막음)`);
  const [bold, s] = top(S.selfs);
  if (s >= 3) add(bold, `🎲 강심장 (나에게 ${s}번)`);
  const [oops, w] = top(S.wastes);
  if (w >= 2) add(oops, `😅 헛방패 (${w}번)`);
  if (S.boomer) add(S.boomer, '🤦 자폭 1호');
  for (const id of Object.keys(S.wills || {})) setHand(ctx, id, []);
  Object.assign(S, { standings, titles, winner: S.alive[0] || null, wills: null, turn: null, aim: null, phase: 'final', over: true });
  return true;
}

// 내 차례에 쓰는 카드. 수갑·훔치기는 to(겨눈 사람)가 있어야 한다
function playCard(ctx, now, pid, card, to) {
  const S = ctx.state;
  const def = CARDS[card];
  const hand = handOf(ctx, pid);
  const i = hand.indexOf(card);
  if (def?.when !== 'turn' || i < 0 || S.sealed === pid) return false; // 🪤 덫에 걸리면 이번 차례엔 손패를 못 쓴다
  const others = S.alive.filter(id => id !== pid);
  const name = ctx.nameOf;
  hand.splice(i, 1);
  if (card === 'peek') {
    if (ctx.secret.peeks?.[pid]?.key === shellKey(S)) return false; // 이미 본 탄
    const shells = shellsOf(ctx);
    ctx.secret.shells = shells;
    const seen = { key: shellKey(S), live: shells[0] ? 1 : 0 };
    ctx.secret.peeks = { ...(ctx.secret.peeks || {}), [pid]: seen };
    S.peeked = true;
    if (hasAug(S, pid, 'sleuth') && shells.length > 1) { // 🕵️ 탐정: 다음 탄까지 (탄창 순서 칸에 적어 둔다)
      const fired = (S.fired || []).length;
      const v = ctx.secret.visions?.[pid];
      const seq = v?.mag === S.magNo ? seqOf(v, fired + shells.length) : Array(fired + shells.length).fill(null);
      seq[fired] = shells[0];
      seq[fired + 1] = shells[1];
      ctx.secret.visions = { ...(ctx.secret.visions || {}), [pid]: { mag: S.magNo, seq } };
    }
    for (const w of S.alive) { // 📹 감시자: 남이 본 탄을 나도 본다
      if (w === pid || !hasAug(S, w, 'watcher')) continue;
      ctx.secret.peeks = { ...ctx.secret.peeks, [w]: seen };
      tell(ctx, w);
    }
  } else if (card === 'double') {
    if (S.double || S.scatter) return false; // 산탄에는 두 배가 안 붙는다
    S.double = true;
  } else if (card === 'scatter') {
    if (S.double || S.scatter) return false;
    S.scatter = true;
    S.aim = null;
  } else if (card === 'heal') {
    if ((S.hp?.[pid] || 0) >= S.maxHp) return false;
    S.hp = { ...S.hp, [pid]: S.hp[pid] + 1 };
  } else if (card === 'cuff') {
    if (!others.includes(to) || S.cuffs?.[to]) return false;
    S.cuffs = { ...(S.cuffs || {}), [to]: true };
  } else if (card === 'steal') {
    const theirs = handOf(ctx, to);
    if (!others.includes(to) || !theirs.length || hasAug(S, to, 'shadow')) return false;
    const n = hasAug(S, pid, 'thief') ? 2 : 1; // 🎭 소매치기
    for (let k = 0; k < n && theirs.length && hand.length < handMax(S, pid); k++) hand.push(theirs.splice(Math.floor(Math.random() * theirs.length), 1)[0]);
    setHand(ctx, to, theirs);
  }
  setHand(ctx, pid, hand);
  event(S, { k: card, by: pid, to: def.aim ? to : null });
  note(ctx, `${def.e} ${name(pid)} ${def.name}${def.aim ? ` → ${name(to)}` : ''}`);
  S.turnEndsAt = Math.min(S.turnCap, Math.max(S.turnEndsAt, now + CARD_BONUS));
  return true;
}

/* ───────── 🎰 운명 카드 ───────── */

// 지금 일어나도 아무 일 없는 건 빼고 고른다
function fatePool(ctx, by) {
  const S = ctx.state;
  const alive = S.alive;
  const ok = {
    alllive: (S.left?.blank || 0) > 0,
    rotate: alive.length >= 2 && alive.some(id => (S.cards?.[id] || 0) > 0),
    power: true,
    myaug: augsOf(S, by).length > 0,
    bleed: alive.some(id => (S.hp?.[id] || 0) > 1),
    heal: (S.hp?.[by] || 0) < S.maxHp + 1,
    reveal: (S.left?.blank || 0) > 0 && (S.left?.live || 0) > 0,
    reverse: alive.length >= 3,
    swap: true,
    allaug: alive.some(id => augsOf(S, id).length > 0),
    gift: alive.some(id => (S.cards?.[id] || 0) < handMax(S, id)),
    tax: (S.cards?.[by] || 0) < handMax(S, by) && alive.some(id => id !== by && !hasAug(S, id, 'shadow') && (S.cards?.[id] || 0) > 0),
    morelive: (S.left?.live || 0) + (S.left?.blank || 0) <= 8,
    hpswap: alive.some(id => id !== by && (S.hp?.[id] || 0) !== (S.hp?.[by] || 0)),
    newaug: Object.keys(AUGS).some(a => a !== 'devil' && !hasAug(S, by, a)),
    again: true,
  };
  return FATE_ORDER.filter(k => ok[k]);
}
export function drawFate(pool, rand = Math.random) {
  let r = rand() * pool.reduce((a, k) => a + FATES[k].w, 0);
  for (const k of pool) if ((r -= FATES[k].w) < 0) return k;
  return pool[pool.length - 1];
}

// 쓰면 바로 정해지지만, 화면에서 룰렛이 돌다 멈출 때까지(FATE_TIME) 차례 시간을 멈추고 기다렸다가 일어난다
function playFate(ctx, now, pid, to) {
  const S = ctx.state;
  if (!(S.fates?.[pid] > 0)) return false;
  if (to !== undefined && !S.scatter) S.aim = S.alive.includes(to) ? to : null; // 화면에서 겨눈 곳 (겨누기 신호보다 먼저 와도)
  const pool = fatePool(ctx, pid);
  const k = pool.includes(ctx.secret.nextFate) ? ctx.secret.nextFate : drawFate(pool); // nextFate: 시험에서 결과를 정해 둘 때
  ctx.secret.nextFate = null;
  S.fates = { ...S.fates, [pid]: S.fates[pid] - 1 };
  S.fateNo = (S.fateNo || 0) + 1;
  S.fate = { no: S.fateNo, by: pid, k, rest: Math.max(0, S.turnEndsAt - now), done: false };
  Object.assign(S, { phase: 'fate', phaseEndsAt: now + FATE_TIME });
  return true;
}

function applyFate(ctx, now) {
  const S = ctx.state;
  const f = S.fate;
  const by = f.by;
  const alive = S.alive;
  const res = {};
  if (f.k === 'alllive') {
    const n = (S.left?.live || 0) + (S.left?.blank || 0);
    ctx.secret.shells = Array(n).fill(1);
    ctx.secret.peeks = {};
    S.left = { live: n, blank: 0 };
    S.reveal = null;
    const fired = (S.fired || []).length;
    const visions = { ...(ctx.secret.visions || {}) };
    for (const [id, v] of Object.entries(visions)) visions[id] = { ...v, seq: seqOf(v, fired + n).map((x, i) => (i < fired ? x : 1)) };
    ctx.secret.visions = visions;
    for (const id of alive) tell(ctx, id);
  } else if (f.k === 'rotate') { // 차례 방향으로 한 칸씩 (받는 사람 손패 최대까지)
    const ring = S.order.filter(id => alive.includes(id));
    const d = S.dir === -1 ? -1 : 1;
    const hands = ring.map(id => handOf(ctx, id));
    ring.forEach((id, i) => setHand(ctx, id, hands[(((i - d) % ring.length) + ring.length) % ring.length].slice(0, handMax(S, id))));
  } else if (f.k === 'power') {
    S.power = { by, n: (S.power?.by === by ? S.power.n : 0) + 2 };
  } else if (f.k === 'myaug') {
    res.augs = { [by]: reroll(ctx, by) };
  } else if (f.k === 'bleed') {
    const hp = { ...S.hp };
    res.ids = alive.filter(id => hp[id] > 1);
    for (const id of res.ids) hp[id] -= 1;
    S.hp = hp;
  } else if (f.k === 'heal') {
    S.hp = { ...S.hp, [by]: Math.min(S.maxHp + 1, (S.hp?.[by] || 0) + 1) };
  } else if (f.k === 'reveal') {
    const shells = shellsOf(ctx);
    ctx.secret.shells = shells;
    S.reveal = { at: shellKey(S), live: shells[0] ? 1 : 0 };
  } else if (f.k === 'reverse') {
    S.dir = S.dir === -1 ? 1 : -1;
  } else if (f.k === 'allaug') {
    res.augs = Object.fromEntries(alive.filter(id => augsOf(S, id).length).map(id => [id, reroll(ctx, id)]));
  } else if (f.k === 'gift') {
    res.ids = alive.filter(id => give(ctx, id, 1));
  } else if (f.k === 'tax') { // 앉은 순서대로 1장씩 (내 손패가 찰 때까지, 그림자는 못 걷는다)
    res.ids = S.order.filter(id => id !== by && alive.includes(id) && snatch(ctx, id, by));
  } else if (f.k === 'again') {
    S.fates = { ...S.fates, [by]: (S.fates?.[by] || 0) + 1 };
  } else if (f.k === 'newaug') {
    const a = randomAug(S, by);
    if (a) res.augs = { [by]: gain(ctx, by, a, false) };
  } else if (f.k === 'morelive') { // 남은 탄 사이 아무 데나 실탄 2발. 본 것들은 무효 (예언자는 새 순서를 다시 본다)
    const shells = shellsOf(ctx);
    for (let k = 0; k < 2; k++) shells.splice(Math.floor(Math.random() * (shells.length + 1)), 0, 1);
    ctx.secret.shells = shells;
    ctx.secret.peeks = {};
    S.left = { live: (S.left?.live || 0) + 2, blank: S.left?.blank || 0 };
    S.reveal = null;
    S.peeked = false;
    const fired = S.fired || [];
    ctx.secret.visions = Object.fromEntries(alive.filter(id => hasAug(S, id, 'prophet')).map(id => [id, { mag: S.magNo, seq: [...fired, ...shells] }]));
  } else if (f.k === 'hpswap') { // 겨눈 사람과 (안 겨눴거나 나를 겨눴으면 하트가 다른 아무나)
    const diff = alive.filter(id => id !== by && (S.hp?.[id] || 0) !== (S.hp?.[by] || 0));
    const to = diff.includes(S.aim) ? S.aim : pick(diff);
    S.hp = { ...S.hp, [by]: S.hp[to], [to]: S.hp[by] };
    res.with = to;
  }
  tellAll(ctx);
  S.fate = { ...f, done: true, res };
  inc(S, 'fated', by);
  note(ctx, `🎰 ${ctx.nameOf(by)} 운명 카드: ${FATES[f.k].name}`);
  if (f.k === 'swap') {
    S.resume = { by, aim: S.aim, double: S.double, scatter: S.scatter };
    return load(ctx, now, by, true);
  }
  S.phase = 'turn';
  S.turnEndsAt = now + Math.max(f.rest, CARD_BONUS);
  S.turnCap = Math.max(S.turnCap || 0, S.turnEndsAt);
  return true;
}

/* ───────── 봇: 자기 손패·자기가 본 탄·모두에게 보이는 것만 쓴다 ───────── */

function botPick(S, id, mem, now) {
  const P = S.pick;
  if (mem.pickRound !== P.round) Object.assign(mem, { pickRound: P.round, pickAt: now + 1200 + Math.random() * 2600 });
  if (now < mem.pickAt) return null;
  mem.pickAt = now + 1500;
  const offers = P.offers?.[id] || [];
  return offers.length ? { type: 'pick', data: { round: P.round, aug: pick(offers) } } : null;
}

function botReact(ctx, id, mem, hand, now) {
  const S = ctx.state;
  const shot = S.shot;
  if (!shot || shot.self || shot.pierce || !shot.to.includes(id) || shot.react?.[id]) return null;
  if (mem.shot !== shot.no) {
    const p = S.left.live / Math.max(1, S.left.live + S.left.blank);
    const dmg = shot.dmg || 1;
    // 겁: 실탄 확률 (쏜 사람이 돋보기를 썼으면 크게), 피해가 크면 더, 이번에 죽을 수 있으면 더
    const fear = (shot.peeked ? Math.max(p, 0.9) : p) + (dmg >= 2 ? 0.15 : 0) + ((S.hp?.[id] || 0) <= dmg ? 0.2 : 0);
    Object.assign(mem, {
      shot: shot.no,
      reactAt: now + 450 + Math.random() * 1100,
      reactWith: hand.includes('mirror') && Math.random() < fear ? 'mirror'
        : hand.includes('shield') && Math.random() < fear * 0.9 ? 'shield' : null,
    });
  }
  if (now < mem.reactAt) return null;
  return { type: 'react', data: { shot: shot.no, card: mem.reactWith } };
}

function botTurn(ctx, id, mem, hand, now) {
  const S = ctx.state;
  if (mem.turn !== S.turnNo) Object.assign(mem, { turn: S.turnNo, at: now + 700 + Math.random() * 900, plan: null, swept: 0, tried: {} });
  if (now < mem.at) return null;
  const wait = (ms = 500) => { mem.at = now + ms + Math.random() * 500; };
  const once = k => !mem.tried[k] && (mem.tried[k] = true); // 카드마다 한 차례에 한 번만 고민
  const data = { turn: S.turnNo };
  const card = (c, to) => { wait(); return { type: 'card', data: { ...data, card: c, to: to || null } }; };
  const others = S.alive.filter(x => x !== id);
  const key = shellKey(S);
  const seen = ctx.secret.peeks?.[id];
  const vision = ctx.secret.visions?.[id];
  const inVision = vision?.mag === S.magNo ? vision.seq[(S.fired || []).length] ?? null : null;
  const known = seen?.key === key ? seen.live : inVision != null ? inVision : S.reveal?.at === key ? S.reveal.live : null;
  const hp = S.hp?.[id] || 0;
  const sealed = S.sealed === id; // 🪤 덫: 이번 차례엔 손패를 못 쓴다

  // 🎰 운명 카드: 하트가 1개면 자주, 아니면 가끔 (먼저 돌려 보고 나서 정한다)
  if ((S.fates?.[id] || 0) > 0 && !mem.plan && once('fate') && Math.random() < (hp <= 1 ? 0.55 : 0.16)) {
    wait(800);
    return { type: 'fate', data };
  }
  if (!sealed && hand.includes('heal') && hp < S.maxHp && once('heal')) return card('heal');
  if (!sealed && known == null && hand.includes('peek') && S.left.blank > 0 && S.left.live > 0 && once('peek') && Math.random() < 0.85) return card('peek');
  if (!sealed && hand.includes('steal') && once('steal') && Math.random() < 0.6) {
    const rich = others.filter(x => S.cards?.[x] > 0 && !hasAug(S, x, 'shadow')).sort((a, b) => S.cards[b] - S.cards[a])[0];
    if (rich) return card('steal', rich);
  }
  if (!sealed && hand.includes('cuff') && once('cuff') && Math.random() < 0.5) {
    const t = nextAlive(S, id);
    if (t !== id && !S.cuffs?.[t]) return card('cuff', t);
  }
  if (!mem.plan) {
    const p = known ?? S.left.live / Math.max(1, S.left.live + S.left.blank);
    if (p < 0.5 && !(p > 0.34 && Math.random() < p)) mem.plan = { to: id }; // 공포탄일 것 같으면 나에게 (한 번 더)
    else {
      const low = Math.min(...others.map(x => S.hp?.[x] || 0));
      const grudge = others.includes(mem.grudge) ? mem.grudge : null;
      const r = Math.random();
      const to = grudge && r < 0.35 ? grudge : r < 0.7 ? pick(others.filter(x => (S.hp?.[x] || 0) === low)) : pick(others);
      mem.plan = { to, sweeps: Math.random() < 0.6 ? 1 + Math.floor(Math.random() * 2) : 0 };
      if (!S.double && !S.scatter && !sealed) {
        if (others.length >= 2 && hand.includes('scatter') && p >= 0.5 && Math.random() < 0.7) mem.plan.card = 'scatter';
        else if (hand.includes('double') && p >= 0.6 && Math.random() < 0.8) mem.plan.card = 'double';
      }
    }
  }
  if (mem.plan.card) {
    const c = mem.plan.card;
    mem.plan.card = null;
    return card(c);
  }
  // 총구를 한두 번 돌리다가(겨누는 척) 쏜다
  if (!S.scatter) {
    if (mem.swept < (mem.plan.sweeps || 0)) {
      mem.swept += 1;
      wait(350);
      return { type: 'aim', data: { ...data, to: pick(others) } };
    }
    if ((S.aim || null) !== mem.plan.to) {
      wait(450);
      return { type: 'aim', data: { ...data, to: mem.plan.to } };
    }
  }
  wait(2000);
  return { type: 'fire', data: { ...data, to: mem.plan.to }, say: Math.random() < 0.08 };
}

/* ───────── 화면: 도트 그림은 art/roulette.px.js (pxl)로 그려서 img/roulette/sprites 에 구운 것 ───────── */

const ART = new URL('../../img/roulette/sprites/', import.meta.url).href;
const ANIM = new URL('../../img/roulette/anims/', import.meta.url).href;
const PX = 3; // 도트 한 칸 = 화면 3px (그림도 효과도 전부 같은 크기)
const SIZE = { // 그림 크기 (도트). 여기 없는 건 16×16
  gun_aim_l: [78, 58], gun_aim_c: [78, 58], gun_aim_r: [78, 58], shell_live: [8, 13], shell_blank: [8, 13], shell_q: [8, 13], heart: [9, 9], heart_off: [9, 9],
  cardback: [7, 9], cross: [17, 17], skull: [9, 9], eye: [11, 7], c_steal: [16, 13], c_shield: [16, 15],
  heart_gold: [9, 9], fate_mark: [9, 9], wheel_pin: [11, 8],
};
// 총: 위에서 내려다본 그림을 15도마다 구워 뒀다. gun_0(위) … gun_6(오른쪽) … gun_12(아래), 왼쪽은 좌우로 뒤집는다
const GUN_STEP = 15;
const MUZZLE = 27; // 그림 가운데에서 총구 끝까지 (도트)
const GUN_PULL = 0.42; // 총 자리: 쏘는 사람 자리에서 테이블 가운데 쪽으로 이만큼 (그 사람 바로 앞)
for (let k = 0; k <= 180 / GUN_STEP; k++) SIZE[`gun_${k}`] = [60, 60];
// 🎰 룰렛판: 시계 방향 한 바퀴를 WHEEL_FRAMES장에 구웠다 (anims/wheel.png 가로 띠, 한 장 WHEEL×WHEEL 도트).
// 칸(FATE_ORDER 순서)마다 WHEEL_STEP장. k번째 칸이 바늘(맨 위) 아래 오는 장 = -k × WHEEL_STEP
const WHEEL = 80;
const WHEEL_FRAMES = 64;
const WHEEL_STEP = WHEEL_FRAMES / FATE_ORDER.length;
const WHEEL_SPIN = 2200; // 돌다가 멈추기까지 (방장은 FATE_TIME 뒤에 일어나게 한다)
function spr(name, cls = '', scale = PX) {
  const [w, hh] = SIZE[name] || [16, 16];
  return h('img', { class: `rl-spr ${cls}`, src: `${ART}${name}.png`, alt: '', draggable: 'false', width: w * scale, height: hh * scale });
}

export default {
  id: 'roulette',
  title: '독박 룰렛',
  emoji: '🔫',
  tag: '심리',
  color: '#d63031',
  desc: '실탄·공포탄이 몇 발인지만 알아요. 카드를 쓰고 누군가에게(나에게도) 한 발! 나를 쏴서 공포탄이면 한 번 더. 🎰 운명 카드와 ✨ 증강으로 판이 뒤집혀요',
  minPlayers: 2,
  maxPlayers: 8,
  tickMs: 50, // 받아치기 마감·결과가 제때 나오게 자주 본다 (보내는 건 바뀔 때만)

  setup(ctx, prev) {
    const ids = shuffle(ctx.roster.map(p => p.id));
    const maxHp = livesOf(ids.length);
    return {
      phase: 'intro',
      phaseEndsAt: ctx.now() + INTRO_TIME,
      again: !!prev,
      order: ids, // 앉은 순서 = 차례 순서
      alive: [...ids],
      maxHp,
      hp: Object.fromEntries(ids.map(id => [id, maxHp])),
      cards: Object.fromEntries(ids.map(id => [id, 0])),
      fates: Object.fromEntries(ids.map(id => [id, 0])),
      augs: {},
      dir: 1,
      magNo: 0,
      turnNo: 0,
      shotNo: 0,
      rounds: 0,
    };
  },

  onInput(ctx, { pid, type, data = {} }) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.over) return false;
    if (type === 'will') { // 👻 유품: 남은 카드 중 한 장을 살아 있는 사람에게 (나머지는 버려진다)
      const until = S.wills?.[pid];
      const to = data.to;
      if (!until || now > until + GRACE || !S.alive.includes(to) || (S.cards?.[to] || 0) >= handMax(S, to)) return false;
      if (!handOf(ctx, pid).includes(data.card)) return false;
      setHand(ctx, to, [...handOf(ctx, to), data.card]);
      closeWill(ctx, pid);
      event(S, { k: 'will', by: pid, to });
      note(ctx, `👻 ${ctx.nameOf(pid)}의 유품 → ${ctx.nameOf(to)}`);
      return true;
    }
    if (type === 'pick') { // ✨ 증강 고르기: 받은 3개 중 하나 (공개는 다 같이)
      const P = S.pick;
      if (S.phase !== 'pick' || !P || P.got || data.round !== P.round || !S.alive.includes(pid) || P.done?.[pid]) return false;
      if (!(P.offers?.[pid] || []).includes(data.aug)) return false;
      ctx.secret.picks = { ...(ctx.secret.picks || {}), [pid]: data.aug };
      S.pick = { ...P, done: { ...(P.done || {}), [pid]: true } };
      return true;
    }
    if (type === 'react') { // 받아치기: 카드 이름(방패·거울) 또는 null(그냥 맞기)
      const shot = S.shot;
      if (S.phase !== 'hush' || !shot || shot.self || shot.pierce || data.shot !== shot.no) return false;
      if (!shot.to.includes(pid) || shot.react?.[pid]) return false;
      let r = 'pass';
      if (data.card) {
        const hand = handOf(ctx, pid);
        const i = hand.indexOf(data.card);
        if (CARDS[data.card]?.when !== 'react' || i < 0) return false;
        hand.splice(i, 1);
        setHand(ctx, pid, hand);
        r = data.card;
      }
      shot.react = { ...(shot.react || {}), [pid]: r };
      return true;
    }
    if (S.phase !== 'turn' || pid !== S.turn || data.turn !== S.turnNo) return false;
    if (type === 'aim') { // 총구 돌리기 (모두에게 보인다)
      const to = S.alive.includes(data.to) && !S.scatter ? data.to : null;
      if ((S.aim || null) === to) return false;
      S.aim = to;
      return true;
    }
    if (type === 'card') return playCard(ctx, now, pid, data.card, data.to);
    if (type === 'fate') return playFate(ctx, now, pid, data.to);
    if (type === 'fire') return fire(ctx, now, data.to);
    return false;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    const willed = expireWills(ctx, now);
    if (S.phase === 'intro') return now >= S.phaseEndsAt && reload(ctx, now, S.order[0]);
    if (S.phase === 'pick') {
      if (!S.pick.got) { // 다들(자리에 있는 사람) 골랐거나 시간이 끝나면 공개
        const waiting = S.alive.some(id => !S.pick.done?.[id] && ctx.isOnline(id));
        return !waiting || now >= S.phaseEndsAt + GRACE ? revealPicks(ctx, now) : willed;
      }
      if (now < S.phaseEndsAt) return willed;
      S.rounds = S.pick.round;
      return load(ctx, now, S.alive.includes(S.after) ? S.after : nextAlive(S, S.after));
    }
    if (S.phase === 'load') {
      if (now < S.phaseEndsAt) return willed;
      return openTurn(ctx, now, S.alive.includes(S.after) ? S.after : nextAlive(S, S.after));
    }
    if (S.phase === 'fate') return now >= S.phaseEndsAt ? applyFate(ctx, now) : willed;
    if (S.phase === 'skip') return now >= S.phaseEndsAt ? enter(ctx, now, nextAlive(S, S.skip)) : willed;
    if (S.phase === 'turn') {
      if (ctx.isOnline(S.turn) && now < S.turnEndsAt + GRACE) return willed;
      // 시간 끝: 총구가 향한 사람에게 (아무도 안 겨눴으면 나에게) 그대로 나간다
      return fire(ctx, now, S.alive.includes(S.aim) ? S.aim : S.turn, true) || willed;
    }
    if (S.phase === 'hush') {
      const shot = S.shot;
      let changed = willed;
      const open = !shot.self && !shot.pierce; // 받아칠 수 있는 발
      if (open && !shot.rushed && !shot.to.some(id => !shot.react?.[id] && ctx.isOnline(id))) {
        shot.rushed = true; // 맞을 사람이 다 정했다: 조금만 보여 주고 결과
        shot.endsAt = now + REACT_SHOW;
        changed = true;
      }
      if (now >= shot.endsAt + (!open || shot.rushed ? 0 : REACT_GRACE)) return resolve(ctx, now);
      return changed;
    }
    if (S.phase === 'shot') {
      if (now < S.phaseEndsAt) return willed;
      if (S.alive.length <= 1) return finish(ctx);
      const { by, again } = S.shot;
      S.keepAim = { by, to: S.shot.self ? by : S.shot.to.length === 1 ? S.shot.to[0] : null };
      return again && S.alive.includes(by) ? enter(ctx, now, by, false) : enter(ctx, now, nextAlive(S, by));
    }
    return willed;
  },

  // 봇: 실탄 확률이 높으면 남에게, 낮으면 나에게(한 번 더). 돋보기 먼저, 하트가 깎였으면 반창고, 총구를 한두 번 돌리다 쏜다.
  // 겨눠지면 확률(쏜 사람이 돋보기를 썼으면 높게 본다)에 따라 받아친다. 탈락하면 나를 죽인 사람만 빼고 아무에게나 유품.
  // 증강은 셋 중 아무거나, 운명 카드는 가끔(하트가 1개면 자주) 돌린다
  bot(ctx, id, mem) {
    const S = ctx.state;
    const now = ctx.now();
    const hand = ctx.secret.hands?.[id] || [];
    const shot = S.shot;
    if (S.phase === 'shot' && shot?.hits?.[id] && mem.hurt !== shot.no) { // 나를 맞힌 사람을 기억한다
      mem.hurt = shot.no;
      mem.grudge = shot.by !== id ? shot.by : shot.mirrored?.[0] || null;
    }
    if (S.wills?.[id]) {
      mem.willAt ||= now + 1200 + Math.random() * 1500;
      if (now < mem.willAt || !hand.length) return null;
      const room = S.alive.filter(x => (S.cards?.[x] || 0) < handMax(S, x));
      const pool = room.filter(x => x !== S.dead?.[id]);
      const to = pick(pool.length ? pool : room);
      mem.willAt = now + 600;
      return to ? { type: 'will', data: { to, card: pick(hand) } } : null;
    }
    if (!S.alive.includes(id)) return null;
    if (S.phase === 'pick' && S.pick && !S.pick.got && !S.pick.done?.[id]) return botPick(S, id, mem, now);
    if (S.phase === 'hush') return botReact(ctx, id, mem, hand, now);
    if (S.phase === 'turn' && S.turn === id) return botTurn(ctx, id, mem, hand, now);
    return null;
  },

  mount(root, api) {
    const me = api.me;
    const audio = createRouletteAudio();
    const head = h('div', { class: 'rx-head' });
    const fx = h('canvas', { class: 'rl-fx' });
    const flashEl = h('div', { class: 'rl-flash' });
    const mag = h('div', { class: 'rl-mag' });
    const count = h('div', { class: 'rl-count' });
    const banner = h('div', { class: 'rl-banner' });
    const gunImg = spr('gun_6', 'rl-top');
    for (const name of [...Array.from({ length: 180 / GUN_STEP + 1 }, (_, k) => `gun_${k}`), 'gun_aim_l', 'gun_aim_c', 'gun_aim_r',
      'c_fate', 'fate_mark', 'heart_gold', 'wheel_pin', ...Object.keys(AUGS).map(a => `a_${a}`)]) {
      new Image().src = `${ART}${name}.png`; // 처음 쓸 때 그림이 늦게 뜨지 않게
    }
    new Image().src = `${ANIM}wheel.png`;
    // 누가 나를 쏘면(결과 전) 다가오는 총: 쏘는 사람이 앉은 쪽(내 왼쪽 · 맞은편 · 내 오른쪽)에 맞춘 원근 그림
    const frontImg = spr('gun_aim_c', 'rl-front');
    const gun = h('div', { class: 'rl-gun' }, gunImg, frontImg);
    // 🎰 운명 카드를 쓰면 가운데에 룰렛판이 떠서(탄창 줄 대신) 돌다가 멈춘다
    const disc = h('div', {
      class: 'rl-disc',
      style: `width:${WHEEL * PX}px;height:${WHEEL * PX}px;background-image:url(${ANIM}wheel.png);background-size:${WHEEL * WHEEL_FRAMES * PX}px ${WHEEL * PX}px`,
    });
    const wheel = h('div', { class: 'rl-wheel' }, disc, spr('wheel_pin', 'rl-pin'));
    const center = h('div', { class: 'rl-center' }, mag, count, wheel, banner);
    const table = h('div', { class: 'rl-table' }, h('div', { class: 'rl-felt' }), center, gun, fx, flashEl);
    const prompt = h('div', { class: 'rl-prompt' });
    const handEl = h('div', { class: 'rl-hand' });
    const timer = h('div', { class: 'rl-timer' });
    const panel = h('div', { class: 'rl-panel' }, prompt, handEl, timer);
    const board = h('div', { class: 'rl-board' });
    const sound = h('button', { class: 'rl-sound', type: 'button', tabindex: '-1' });
    const box = h('div', { class: 'rl-box' }, table, panel, board, sound);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'rl' }, h('div', { class: 'rl-main' }, head, box), side));
    document.activeElement?.blur?.();
    document.fonts?.load('22px "Galmuri11"', '독박 룰렛 철컥 탕 틱').catch(() => {});

    let S = null;
    let P = null;
    let seatKey = '';
    const seats = new Map();   // pid → { el, face, hearts, cards, tags, show, x, y, key }
    let aimLocal = null;       // 내 차례에 내가 겨눈 사람 (방장 답을 안 기다리고 내 화면에서 먼저 움직인다)
    let aimTimer = null;
    let aimSentAt = 0;
    let heir = null;           // 유품 받을 사람 (내 화면에서만)
    const sent = { fire: -1, react: -1, will: false, cardAt: 0, pick: -1 };
    let seen = null;           // 이미 연출한 것 (중간에 들어와도 지난 장면을 다시 틀지 않게)
    let hint = null;           // 잠깐 띄우는 안내 { text, cls, until }
    let gunFront = false;
    let pose = { k: 6, flip: false, deg: 0 }; // 지금 그린 총 방향 (deg = 총구가 향한 화면 각도)
    let lastAimed = null;
    let holder = null;                        // 총을 앞에 둔 사람 (지금 쏘는 사람)
    let spot = { x: 50, y: 50 };              // 총 자리 (테이블의 %)
    let wasAimMe = false;
    let bannerNo = 0;
    let myPick = null;         // 내가 고른 증강 { round, aug } (공개 전엔 나만 안다)
    let wheelFrame = 0;        // 룰렛판이 지금 보여 주는 장
    let spin = null;           // 도는 중 { from, total, t0, last, no }
    let landed = -1;           // 룰렛이 멈춰서 결과를 보여 준 운명 카드 번호
    const keys = { head: '', mag: '', panel: '', timer: '', side: '' };
    const timers = new Set();
    const later = (ms, fn) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };
    const who = id => S.roster.find(p => p.id === id) || { id, name: '?' };
    const nameOf = id => who(id).name;
    const alive = id => S.alive.includes(id);
    const inGame = () => S.roster.some(p => p.id === me);
    const myHand = () => P?.hand || [];
    const myPeek = () => (P?.peek && P.peek.key === shellKey(S) ? P.peek : null);

    const soundLabel = () => { sound.textContent = audio.enabled ? '소리 켜짐' : '소리 꺼짐'; };
    soundLabel();
    sound.addEventListener('click', () => {
      audio.toggle();
      soundLabel();
      sound.blur();
    });
    const unlock = () => { void audio.unlock(); };
    window.addEventListener('pointerdown', unlock);

    // 지금 내가 할 수 있는 것: pick(증강 고르기) · turn(내 차례) · react(받아치기) · will(유품) · null
    function modeOf() {
      if (!S || S.over) return null;
      if (S.wills?.[me]) return sent.will ? null : 'will';
      if (!alive(me)) return null;
      if (S.phase === 'pick') return S.pick && !S.pick.got && !S.pick.done?.[me] && sent.pick !== S.pick.round ? 'pick' : null;
      if (S.phase === 'turn' && S.turn === me && sent.fire !== S.turnNo) return 'turn';
      const shot = S.shot;
      if (S.phase === 'hush' && !shot.self && !shot.pierce && shot.to.includes(me) && !shot.react?.[me] && sent.react !== shot.no) return 'react';
      return null;
    }
    // 내 차례에 걸어 둔 피해 (두 배 · 화력 · 🎰 피해 +2 · 💉 아드레날린). 속사 · 복수심은 쏠 때 붙는다
    const shadowed = id => id !== me && hasAug(S, id, 'shadow'); // 🥷 남의 그림자: 카드 장수 변화도 안 보여 준다
    const dmgOf = id => (S.double ? (hasAug(S, id, 'fire') ? 3 : 2) : 1) + (S.power?.by === id ? S.power.n : 0)
      + (hasAug(S, id, 'adren') && (S.hp?.[id] || 0) === 1 ? 1 : 0);

    function usable(card, mode) {
      const def = CARDS[card];
      if (mode === 'will') return true;
      if (mode === 'react') return def.when === 'react';
      if (mode !== 'turn' || def.when !== 'turn' || S.sealed === me) return false;
      if (card === 'heal') return (S.hp?.[me] || 0) < S.maxHp;
      if (card === 'double' || card === 'scatter') return !S.double && !S.scatter;
      if (card === 'peek') return !myPeek();
      return true;
    }

    // 살아 있는 사람들: 내 자리부터 시계 방향 (유품 받을 사람 처음 고를 때)
    function ring() {
      const i = Math.max(0, S.order.indexOf(me));
      return [...S.order.slice(i), ...S.order.slice(0, i)].filter(alive);
    }
    // 내 자리(아래)에서 본 방향: 0 = 정면(맞은편), 음수 = 왼쪽, 양수 = 오른쪽
    function sideAngle(id) {
      const m = seats.get(me);
      const s = seats.get(id);
      return Math.atan2(s.x - m.x, m.y - s.y);
    }
    const others = () => S.alive.filter(id => id !== me && seats.has(id)).sort((a, b) => sideAngle(a) - sideAngle(b));
    // ← → : 내가 보는 방향 기준 왼쪽 · 오른쪽 사람으로 (끝에서는 멈춘다).
    // 아직 안 겨눴거나 나를 겨누던 중이면 그쪽에 앉은 사람 중 정면에 가장 가까운 사람부터 (그쪽에 아무도 없으면 맞은편)
    function stepSide(cur, dir) {
      const list = others();
      if (!list.length) return cur;
      const i = list.indexOf(cur);
      if (i >= 0) return list[Math.max(0, Math.min(list.length - 1, i + dir))];
      const side = dir < 0 ? [...list].reverse().find(id => sideAngle(id) < -0.05) : list.find(id => sideAngle(id) > 0.05);
      return side || opposite();
    }
    const opposite = () => [...others()].sort((a, b) => Math.abs(sideAngle(a)) - Math.abs(sideAngle(b)))[0] || null;

    function say(text, cls = 'hint', ms = 1800) {
      hint = { text, cls, until: performance.now() + ms };
      later(ms + 30, paintPanel);
      paintPanel();
    }
    function nope(text) {
      panel.classList.remove('nope');
      void panel.offsetWidth;
      panel.classList.add('nope');
      say(text, 'warn');
    }

    function setAim(id) {
      aimLocal = id || null;
      if (!aimTimer) {
        aimTimer = setTimeout(() => { // 방향키를 연타해도 0.12초에 한 번만 보낸다
          aimTimer = null;
          aimSentAt = performance.now();
          if (S?.phase === 'turn' && S.turn === me && sent.fire !== S.turnNo && !S.scatter) api.send('aim', { turn: S.turnNo, to: aimLocal });
        }, Math.max(0, 120 - (performance.now() - aimSentAt)));
      }
      hint = null;
      paint();
    }

    function fireNow() {
      if (!S.scatter && !aimLocal) return nope('먼저 ← → 로 겨누세요 (↓ = 나)');
      sent.fire = S.turnNo;
      api.send('fire', { turn: S.turnNo, to: S.scatter ? null : aimLocal });
      hint = null;
      paint();
    }

    function react(card) {
      sent.react = S.shot.no;
      api.send('react', { shot: S.shot.no, card });
      hint = null;
      paint();
    }

    function useCard(i) {
      const mode = modeOf();
      if (mode === 'pick') return choose(i);
      const card = myHand()[i];
      if (!card || !mode) return;
      const def = CARDS[card];
      if (mode === 'will') {
        if (!heir || !alive(heir)) return nope('← → 로 받을 사람을 고르세요');
        if ((S.cards?.[heir] || 0) >= handMax(S, heir)) return nope(`${nameOf(heir)}의 손패가 꽉 찼어요`);
        sent.will = true;
        api.send('will', { to: heir, card });
        return paint();
      }
      if (mode === 'react') {
        if (def.when !== 'react') return nope('지금은 방패·거울만 쓸 수 있어요');
        return react(card);
      }
      if (def.when !== 'turn') return nope('누가 나를 쐈을 때 쓰는 카드예요');
      if (S.sealed === me) return nope('덫에 걸렸어요! 이번 차례엔 손패를 못 써요');
      if (card === 'heal' && !usable(card, mode)) return nope('하트가 꽉 찼어요');
      if (card === 'peek' && !usable(card, mode)) return nope('이미 본 탄이에요');
      if (!usable(card, mode)) return nope('두 배와 산탄은 같이 못 써요');
      let to = null;
      if (def.aim) {
        to = aimLocal;
        if (!to || to === me) return nope('먼저 ← → 로 상대를 겨누세요');
        if (card === 'cuff' && S.cuffs?.[to]) return nope('이미 수갑을 찼어요');
        if (card === 'steal' && hasAug(S, to, 'shadow')) return nope('그림자라서 훔칠 수 없어요');
        if (card === 'steal' && !(S.cards?.[to] > 0)) return nope('카드가 없는 사람이에요');
      }
      if (performance.now() < sent.cardAt) return; // 연타 방지
      sent.cardAt = performance.now() + 350;
      api.send('card', { turn: S.turnNo, card, to });
    }

    // ✨ 증강 고르기 (숫자키 1~3). 공개는 다 같이
    function choose(i) {
      const a = S.pick?.offers?.[me]?.[i];
      if (!a) return;
      sent.pick = S.pick.round;
      myPick = { round: S.pick.round, aug: a };
      api.send('pick', { round: S.pick.round, aug: a });
      audio.card();
      paint();
    }

    // 🎰 운명 카드 (R): 내 차례에만
    function useFate() {
      if (!alive(me) || !((S.fates?.[me] || 0) > 0)) return;
      if (modeOf() !== 'turn') return nope('운명 카드는 내 차례에 써요');
      if (performance.now() < sent.cardAt) return;
      sent.cardAt = performance.now() + 800;
      api.send('fate', { turn: S.turnNo, to: S.scatter ? null : aimLocal });
    }

    function onKey(e) {
      if (isTyping(e) || !S) return;
      const c = e.code;
      const d = digitOf(e);
      const dir = c === 'ArrowLeft' || c === 'KeyA' ? -1 : c === 'ArrowRight' || c === 'KeyD' ? 1 : 0;
      const down = c === 'ArrowDown' || c === 'KeyS';
      const up = c === 'ArrowUp' || c === 'KeyW';
      const space = c === 'Space';
      const fateKey = c === 'KeyR';
      if (!dir && !down && !up && !space && !d && !fateKey) return;
      if (space || c.startsWith('Arrow')) e.preventDefault(); // 페이지가 스크롤되지 않게
      if (e.repeat) return;
      unlock();
      const mode = modeOf();
      if (!mode) return;
      if (d) return useCard(d - 1);
      if (mode === 'pick') return;
      if (fateKey) return useFate();
      if (mode === 'react') {
        if (space) react(null);
        return;
      }
      if (mode === 'will') {
        if (dir) {
          heir = stepSide(heir, dir);
          paint();
        }
        return;
      }
      if (space) return fireNow();
      if (S.scatter) return; // 산탄은 겨눌 필요가 없다
      if (dir) setAim(stepSide(aimLocal, dir));
      else if (down) setAim(me);
      else if (up) setAim(opposite());
    }
    window.addEventListener('keydown', onKey);

    /* ── 효과 그림판: 3배로 키우는 작은 캔버스에 도트로 그린다 (조준 점선 · 총알 자국 · 튀는 조각) ── */
    const g2 = fx.getContext('2d');
    let cw = 0;
    let ch = 0;
    const parts = [];
    const streaks = [];
    function fit() {
      const r = table.getBoundingClientRect();
      const w = Math.ceil(r.width / PX);
      const hh = Math.ceil(r.height / PX);
      if (w === cw && hh === ch) return;
      cw = fx.width = w;
      ch = fx.height = hh;
      fx.style.width = `${w * PX}px`;
      fx.style.height = `${hh * PX}px`;
      setPose(lastAimed ? poseTo(lastAimed) : poseCenter());
    }
    // 화면 요소의 가운데 → 그림판 좌표
    function at(el, dx = 0) {
      const t = table.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return [Math.round((r.left + r.width / 2 - t.left) / PX + dx), Math.round((r.top + r.height / 2 - t.top) / PX)];
    }
    const seatPt = id => (seats.get(id) ? at(seats.get(id).face) : [cw >> 1, ch >> 1]);
    const gunPt = () => { // 총구 끝 (정면 그림일 땐 가운데)
      const [x, y] = at(gun);
      if (gunFront) return [x, y];
      const a = (pose.deg * Math.PI) / 180;
      return [Math.round(x + Math.cos(a) * MUZZLE), Math.round(y + Math.sin(a) * MUZZLE)];
    };
    function dots(a, b, color, gap = 1, off = 0, size = 1) {
      const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      if (!n) return;
      g2.fillStyle = color;
      for (let i = 0; i <= n; i++) {
        if (gap > 1 && (((i + off) % gap) + gap) % gap >= gap / 2) continue;
        g2.fillRect(Math.round(a[0] + ((b[0] - a[0]) * i) / n), Math.round(a[1] + ((b[1] - a[1]) * i) / n), size, size);
      }
    }
    function burst(p, colors, n = 16, speed = 1) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = (0.5 + Math.random() * 1.7) * speed;
        parts.push({ x: p[0], y: p[1], vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.5, g: 0.12, life: 9 + Math.random() * 11, c: pick(colors) });
      }
    }
    function puff(p) { // 공포탄: 총구에서 연기만
      for (let i = 0; i < 9; i++) {
        parts.push({ x: p[0] + Math.random() * 4 - 2, y: p[1], vx: Math.random() * 0.6 - 0.3, vy: -0.3 - Math.random() * 0.5, g: 0, life: 14 + Math.random() * 12, c: pick(['#94b0c2', '#566c86', '#f4f4f4']) });
      }
    }
    const streak = (a, b, delay = 0, c = '#f4f4f4') => streaks.push({ a, b, t0: performance.now() + delay, c });

    let raf = 0;
    let lastT = 0;
    function frame(t) {
      raf = requestAnimationFrame(frame);
      if (!S || t - lastT < 33) return;
      lastT = t;
      fit();
      g2.clearRect(0, 0, cw, ch);
      const march = Math.floor(t / 90);
      if (S.phase === 'turn') { // 총구가 향한 곳: 노란 점선
        const tos = S.scatter ? S.alive.filter(id => id !== S.turn) : [S.turn === me ? aimLocal : S.aim].filter(Boolean);
        for (const id of tos) dots(gunPt(), seatPt(id), '#ffcd75', 4, -march);
      } else if (S.phase === 'hush' && !gunFront) { // 방아쇠를 당겼다: 빨간 점선
        for (const id of S.shot.to) dots(gunPt(), seatPt(id), '#ef7d57', 2, -march * 2);
      }
      for (let i = streaks.length - 1; i >= 0; i--) {
        const s = streaks[i];
        const k = (t - s.t0) / 110;
        if (k < 0) continue;
        if (k > 1.5) {
          streaks.splice(i, 1);
          continue;
        }
        const lerp = q => [s.a[0] + (s.b[0] - s.a[0]) * q, s.a[1] + (s.b[1] - s.a[1]) * q];
        dots(lerp(Math.max(0, k - 0.5)), lerp(Math.min(1, k)), s.c, 1, 0, 2);
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.g;
        p.life -= 1;
        if (p.life <= 0) {
          parts.splice(i, 1);
          continue;
        }
        g2.fillStyle = p.c;
        const sz = p.life > 6 ? 2 : 1;
        g2.fillRect(Math.round(p.x), Math.round(p.y), sz, sz);
      }
      if (S.phase === 'load') paintCenter(); // 탄을 보여 주다가 섞어서 숨기는 때를 맞춘다
      if (spin) spinStep(t);
    }
    raf = requestAnimationFrame(frame);

    function setWheel(f) {
      wheelFrame = ((f % WHEEL_FRAMES) + WHEEL_FRAMES) % WHEEL_FRAMES;
      disc.style.backgroundPosition = `${-wheelFrame * WHEEL * PX}px 0`;
    }
    // 빨리 돌다가 천천히 멈춘다 (칸이 바늘을 지날 때마다 딸깍)
    function spinStep(t) {
      const k = Math.max(0, Math.min(1, (t - spin.t0) / WHEEL_SPIN));
      const f = spin.from + Math.round(spin.total * (1 - (1 - k) ** 3));
      if (f !== spin.last) {
        if (Math.floor((f + 2) / WHEEL_STEP) !== Math.floor((spin.last + 2) / WHEEL_STEP)) audio.tick(k);
        spin.last = f;
        setWheel(f);
      }
      if (k < 1) return;
      const no = spin.no;
      spin = null;
      onLand(no);
    }
    function hideWheel(no) {
      if (S.fate?.no !== no || S.phase === 'fate') return; // 그새 다음 운명 카드가 돌기 시작했다
      if (spin) return later(300, () => hideWheel(no));
      center.classList.remove('spin');
    }

    function floatAt(id, text, cls = '', icon = null) {
      const s = seats.get(id);
      if (!s) return;
      const el = h('div', { class: `rl-float ${cls}`, style: `left:${s.x.toFixed(2)}%;top:${s.y.toFixed(2)}%` }, icon ? spr(icon) : null, text);
      table.append(el);
      later(1400, () => el.remove());
    }
    function setBanner(text, cls = '', ms = 0) {
      banner.textContent = text;
      banner.className = `rl-banner ${cls}`;
      const n = (bannerNo += 1);
      if (ms) later(ms, () => { if (bannerNo === n) banner.textContent = ''; });
    }
    function replay(el, cls) {
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
    }
    function hitSeat(id) {
      const s = seats.get(id);
      if (s) replay(s.face, 'hit');
    }

    /* ── 장면 연출 ── */
    function onLoad() {
      audio.load();
      const final = !S.swap && S.magNo === FINAL_MAG;
      setBanner(S.swap ? '총 교체!' : final ? '막판!' : '장전!', S.swap ? 'fate land' : final ? 'final' : '', final ? 1900 : 1300);
      if (final) audio.final();
      later(350, () => {
        for (const [id, n] of Object.entries(S.dealt || {})) if (!shadowed(id)) floatAt(id, `카드 +${n}`, 'gain');
      });
      for (const id of S.poisoned || []) {
        later(700, () => {
          hitSeat(id);
          floatAt(id, '독! -1', 'hit', 'a_poison');
        });
      }
      if (S.magNo === 1) later(1150, () => { for (const id of S.alive) floatAt(id, '운명 카드!', 'fate', 'c_fate'); });
    }

    // ✨ 증강 고르기 시작 · 공개
    function onPick() {
      const t = S.pick.tier;
      setBanner(`${TIERS[t]} 증강!`, `tier t${t}`);
      audio.pick(t);
    }
    function onPicked() {
      audio.reveal();
      setBanner('증강 공개!', `tier t${S.pick.tier}`, 1700);
      for (const [id, list] of Object.entries(S.pick.got || {})) {
        list.filter(a => AUGS[a]).forEach((a, i) => later(150 + i * 650, () => floatAt(id, AUGS[a].name, `aug t${AUGS[a].tier}`, `a_${a}`)));
      }
    }

    // 🎰 운명 카드: 룰렛판이 돌다가 방장이 정한 칸에서 멈춘다
    function onFate() {
      const f = S.fate;
      const goal = (((-FATE_ORDER.indexOf(f.k) * WHEEL_STEP) % WHEEL_FRAMES) + WHEEL_FRAMES) % WHEEL_FRAMES;
      const ahead = (((goal - wheelFrame) % WHEEL_FRAMES) + WHEEL_FRAMES) % WHEEL_FRAMES;
      spin = { from: wheelFrame, total: WHEEL_FRAMES * 3 + ahead, t0: performance.now(), last: wheelFrame, no: f.no };
      center.classList.add('spin');
      wheel.classList.remove('land');
      setBanner('운명의 룰렛!', 'fate');
      audio.fate();
      floatAt(f.by, '운명 카드!', 'fate', 'c_fate');
    }
    function onLand(no) {
      if (S.fate?.no !== no) return;
      landed = no;
      replay(wheel, 'land');
      setBanner(FATES[S.fate.k].name, 'fate land', 2200);
      audio.land();
      paintPanel();
    }
    function onFateDone() {
      const f = S.fate;
      const res = f.res || {};
      later(900, () => hideWheel(f.no));
      if (f.k === 'bleed') {
        audio.bang(false);
        replay(box, 'shaking');
        for (const id of res.ids || []) {
          hitSeat(id);
          floatAt(id, '-1', 'hit');
        }
      } else if (f.k === 'heal') floatAt(f.by, '+1', 'gain', 'heart_gold');
      else if (f.k === 'gift') for (const id of res.ids || []) { if (!shadowed(id)) floatAt(id, '카드 +1', 'gain'); }
      else if (f.k === 'rotate') for (const id of S.alive) floatAt(id, '손패 이동!', 'bad');
      else if (f.k === 'power') floatAt(f.by, '피해 +2', 'hit');
      else if (f.k === 'alllive') audio.load();
      else if (f.k === 'reveal' && S.reveal) say(`탄 공개: 지금 탄은 ${S.reveal.live ? '실탄' : '공포탄'}!`, S.reveal.live ? 'warn' : 'hint', 3200);
      else if (f.k === 'myaug' || f.k === 'allaug' || f.k === 'newaug') {
        if (f.k === 'newaug') audio.reveal();
        for (const [id, list] of Object.entries(res.augs || {})) {
          list.filter(a => AUGS[a]).forEach((a, i) => later(i * 650, () => floatAt(id, AUGS[a].name, `aug t${AUGS[a].tier}`, `a_${a}`)));
        }
      } else if (f.k === 'tax') {
        (res.ids || []).forEach((id, i) => later(i * 200, () => floatAt(id, '세금 -1장', 'bad')));
        if (res.ids?.length) later(500, () => floatAt(f.by, `카드 +${res.ids.length}`, 'gain'));
      } else if (f.k === 'again') floatAt(f.by, '운명 카드 +1', 'fate', 'c_fate');
      else if (f.k === 'morelive') audio.load();
      else if (f.k === 'hpswap' && res.with) {
        audio.ping();
        const up = (S.hp?.[f.by] || 0) >= (S.hp?.[res.with] || 0);
        floatAt(f.by, `하트 ${S.hp?.[f.by] || 0}`, up ? 'gain' : 'bad');
        floatAt(res.with, `하트 ${S.hp?.[res.with] || 0}`, up ? 'bad' : 'gain');
      }
    }

    function onHush() {
      const shot = S.shot;
      audio.cock();
      const atMe = !shot.self && shot.to.includes(me) && alive(me);
      if (atMe) audio.alarm();
      setBanner(atMe ? '' : '철컥…', 'hush');
    }

    function onResult() {
      const shot = S.shot;
      const from = gunPt();
      const hits = shot.hits || {};
      const fxs = shot.fx || [];
      const had = (k, id) => fxs.some(f => f.k === k && f.id === id);
      if (shot.live) {
        audio.bang(shot.dbl);
        replay(flashEl, 'on');
        replay(box, 'shaking');
        replay(gun, 'kick');
        setBanner(shot.dmg >= 3 ? '탕! 탕! 탕!' : shot.dbl ? '탕! 탕!' : '탕!', 'live', 1500);
        for (const id of shot.to) {
          const to = seatPt(id);
          streak(from, to, 0, shot.dbl ? '#ffcd75' : '#f4f4f4');
          if (shot.blocked?.includes(id)) {
            later(110, () => {
              audio.clang();
              burst(to, ['#41a6f6', '#73eff7', '#f4f4f4'], 12, 0.8);
              floatAt(id, '깡!', 'block');
            });
          } else if (shot.mirrored?.includes(id)) {
            later(110, () => {
              audio.ping();
              burst(to, ['#73eff7', '#f4f4f4'], 10, 0.7);
              floatAt(id, had('reflex', id) ? '반사 신경!' : '반사!', 'mirror', had('reflex', id) ? 'a_reflex' : null);
              streak(to, seatPt(shot.by), 0, '#73eff7');
            });
          } else {
            later(110, () => burst(to, ['#ef7d57', '#b13e53', '#ffcd75', '#f4f4f4'], shot.dbl ? 26 : 16, shot.dbl ? 1.3 : 1));
            if (had('hunter', id)) later(110, () => floatAt(id, '방패 관통!', 'bad', 'a_hunter'));
          }
        }
        for (const [id, d] of Object.entries(hits)) {
          if (had('splash', id)) continue; // 폭발탄으로 맞은 옆 사람은 '폭발! -1'로 따로
          const back = id === shot.by && !shot.self; // 거울에 맞고 돌아온 탄
          later(back ? 260 : 130, () => {
            if (back) burst(seatPt(id), ['#ef7d57', '#b13e53', '#f4f4f4'], 16);
            hitSeat(id);
            floatAt(id, `-${d}`, 'hit');
          });
        }
        if (shot.dead?.length) later(520, () => audio.dead());
      } else {
        audio.click();
        puff(from);
        setBanner('틱…', 'blank', 1500);
        for (const id of shot.to) floatAt(id, shot.wasted?.includes(id) ? '헛카드…' : '휴…', 'safe');
      }
      for (const f of fxs) { // 증강 · 처치 보상
        if (f.k === 'phoenix') later(650, () => { audio.revive(); floatAt(f.id, '부활!', 'gain', 'a_phoenix'); });
        if (f.k === 'vamp') later(600, () => floatAt(f.id, `흡혈 +${f.n}`, 'gain', 'a_vamp'));
        if (f.k === 'counter') later(450, () => { floatAt(f.id, '빈총 반격!', 'gain', 'a_counter'); floatAt(f.from, '1장 뺏겼다!', 'bad'); });
        if (f.k === 'fuse') later(900, () => { audio.bang(false); hitSeat(f.id); floatAt(f.id, '도화선! -1', 'hit'); });
        if (f.k === 'kill') later(1100, () => { audio.reward(); floatAt(f.id, f.got && !shadowed(f.id) ? '처치! 카드 +1' : '처치!', 'gain'); });
        if (f.k === 'trap') later(700, () => floatAt(f.id, '덫! 다음 차례 봉인', 'bad', 'a_trap'));
        if (f.k === 'splash') {
          later(160, () => {
            streak(seatPt(f.from), seatPt(f.id), 0, '#ffcd75');
            burst(seatPt(f.id), ['#ef7d57', '#ffcd75', '#f4f4f4'], 18, 1.1);
            hitSeat(f.id);
            floatAt(f.id, '폭발! -1', 'hit', 'a_splash');
          });
        }
        if (f.k === 'hook') later(500, () => { floatAt(f.from, '1장 뺏겼다!', 'bad'); floatAt(f.id, '갈고리!', 'gain', 'a_hook'); });
        if (f.k === 'poison') later(800, () => floatAt(f.id, '독!', 'bad', 'a_poison'));
        if (f.k === 'stun') later(800, () => floatAt(f.id, '기절!', 'bad', 'a_stun'));
        if (f.k === 'usurp') {
          f.augs.filter(a => AUGS[a]).forEach((a, i) => later(1500 + i * 600, () => floatAt(f.id, `찬탈! ${AUGS[a].name}`, `aug t${AUGS[a].tier}`, `a_${a}`)));
        }
      }
      if (shot.more) later(shot.dead?.length ? 1300 : 900, () => setBanner(shot.more === 'chain' ? '연쇄 처치!' : '한 발 더!', 'again', 1300));
    }

    function onEvent(ev) {
      if (!ev) return;
      audio.card();
      if (ev.k === 'will') {
        floatAt(ev.to, '유품 +1', 'gain');
        return;
      }
      const def = CARDS[ev.k];
      if (!def) return;
      floatAt(ev.by, `${def.name}!`, '', `c_${ev.k}`);
      if (ev.to) later(250, () => floatAt(ev.to, ev.k === 'cuff' ? '철컹!' : '뺏겼다!', 'bad'));
    }

    /* ── 그리기 ── */
    function layoutSeats() {
      const key = S.order.join();
      if (key === seatKey) return;
      seatKey = key;
      for (const s of seats.values()) s.el.remove();
      seats.clear();
      const n = S.order.length;
      const mine = Math.max(0, S.order.indexOf(me));
      S.order.forEach((id, i) => { // 둥글게 앉는다: 나는 항상 아래, 차례는 시계 방향
        const p = who(id);
        const a = Math.PI / 2 + ((i - mine) * 2 * Math.PI) / n;
        const x = 50 + 41 * Math.cos(a);
        const y = 50 + 37 * Math.sin(a);
        const face = h('div', { class: 'rl-face' }, avatar(p, 'lg'), spr('cross', 'rl-cross'), spr('skull', 'rl-skull'));
        const hearts = h('div', { class: 'rl-hearts' });
        const cards = h('div', { class: 'rl-cards' });
        const tags = h('div', { class: 'rl-tags' });
        const show = h('div', { class: 'rl-show' });
        const augs = h('div', { class: 'rl-augs' });
        const el = h('div', { class: 'rl-seat', style: `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%` },
          face, h('div', { class: 'rl-info' }, h('span', { class: 'rl-name' }, p.name), hearts, h('div', { class: 'rl-row' }, cards, augs)), tags, show);
        table.append(el);
        seats.set(id, { el, face, hearts, cards, augs, tags, show, x, y, key: '' });
      });
    }

    function paintSeats() {
      const shot = S.shot;
      const turn = S.phase === 'turn';
      const hush = S.phase === 'hush';
      const picking = S.phase === 'pick' && S.pick && !S.pick.got;
      const aimNow = !turn ? null : S.turn === me ? aimLocal : S.aim || null;
      const shooter = turn ? S.turn : hush ? shot.by : S.phase === 'fate' ? S.fate?.by : null;
      for (const [id, s] of seats) {
        const hp = S.hp?.[id] || 0;
        const n = S.cards?.[id] || 0;
        const fates = alive(id) ? S.fates?.[id] || 0 : 0;
        const augs = (S.augs?.[id] || []).filter(a => AUGS[a]); // 모르는 증강(다른 버전 방장)은 건너뛴다
        const react = (hush || S.phase === 'shot') && shot && !shot.self ? shot.react?.[id] : null;
        const shown = react === 'shield' || react === 'mirror' ? react : '';
        const tags = [];
        if (picking && alive(id)) tags.push(S.pick.done?.[id] ? '고름' : '고르는 중');
        if (S.cuffs?.[id]) tags.push(S.cuffs[id] === 'stun' ? '기절' : '수갑');
        if (alive(id) && (S.seals?.[id] || S.sealed === id)) tags.push('봉인');
        if (S.poison?.[id] && alive(id)) tags.push('독');
        if (id === shooter && (turn || hush)) {
          if (turn ? S.peeked : shot.peeked) tags.push('봄');
          const dmg = turn ? dmgOf(id) : shot.dmg || 1;
          if (dmg > 1) tags.push(`×${dmg}`);
          if (turn ? S.scatter : shot.sc) tags.push('산탄');
          if (hush && shot.pierce) tags.push('못 막음');
        }
        const cls = ['rl-seat', id === me && 'me', !alive(id) && 'dead', id === shooter && 'turn',
          turn && (aimNow === id || (S.scatter && id !== S.turn && alive(id))) && 'aimed',
          hush && shot.to.includes(id) && 'locked', heir === id && modeOf() === 'will' && 'heir',
          picking && S.pick.done?.[id] && 'picked'].filter(Boolean).join(' ');
        const hidden = id !== me && hasAug(S, id, 'shadow');            // 🥷 그림자: 장수도 안 보인다
        const seen = alive(me) && id !== me && !hidden ? P?.minds?.[id] || null : null; // 🧠 독심술: 남의 손패가 보인다
        const key = [cls, hp, n, fates, augs.join(), shown, tags.join(), hidden, seen?.join()].join('|');
        if (key === s.key) continue;
        s.key = key;
        s.el.className = cls;
        // 하트가 가득을 넘으면(🎰 내 하트 +1) 넘친 칸은 금빛
        s.hearts.replaceChildren(...Array.from({ length: Math.max(S.maxHp, hp) }, (_, i) => spr(i >= S.maxHp ? 'heart_gold' : i < hp ? 'heart' : 'heart_off')));
        const cardEls = hidden ? (alive(id) ? [h('span', { class: 'rl-hidden' }, '?')] : [])
          : seen ? seen.map(c => spr(`c_${c}`, 'rl-mini', 2))
            : Array.from({ length: n }, () => spr('cardback'));
        s.cards.replaceChildren(...cardEls, ...Array.from({ length: fates }, () => spr('fate_mark')));
        s.augs.replaceChildren(...augs.map(a => {
          const img = spr(`a_${a}`, `rl-aug t${AUGS[a].tier}`, 2);
          img.title = `${AUGS[a].name}: ${AUGS[a].tip}`;
          return img;
        }));
        s.tags.replaceChildren(...tags.map(t => h('span', {}, t === '봄' ? spr('eye') : null, t)));
        s.show.replaceChildren(...(shown ? [spr(`c_${shown}`), h('b', {}, `${CARDS[shown].name}!`)] : []));
      }
    }

    const shellEl = (kind, cls, eye = false) => h('span', { class: `rl-shell ${cls}` }, spr(`shell_${kind}`), eye ? spr('eye', 'rl-eye') : null);

    function paintCenter() {
      const shot = S.shot;
      const fired = S.fired || [];
      const left = (S.left?.live || 0) + (S.left?.blank || 0);
      // 장전: 앞 55%는 탄을 다 보여 주고, 그 뒤엔 섞어서 숨긴다
      const stage = S.phase !== 'load' ? '' : api.now() < S.phaseEndsAt - LOAD_TIME * 0.45 ? 'open' : 'mix';
      const peek = myPeek();
      const pub = S.reveal?.at === shellKey(S) ? S.reveal : null; // 🎰 탄 공개: 모두가 본다
      const vision = alive(me) ? P?.vision || null : null;      // 🔮 예언자: 탄창 순서를 나만
      const key = JSON.stringify([S.magNo, fired, S.left, stage, peek?.live ?? -1, pub?.live ?? -1, vision, S.phase === 'shot']);
      if (key !== keys.mag) {
        keys.mag = key;
        let cells = [];
        if (stage === 'open') cells = [...Array(S.mag.live).fill('live'), ...Array(S.mag.blank).fill('blank')].map(k => shellEl(k, ''));
        else if (S.mag) {
          cells = [
            ...fired.map((v, i) => shellEl(v ? 'live' : 'blank', `spent${S.phase === 'shot' && i === fired.length - 1 ? ' now' : ''}`)),
            ...Array.from({ length: left }, (_, i) => {
              const v = vision ? vision[fired.length + i] : null;
              const known = i ? v : peek ? peek.live : pub ? pub.live : v;
              const kind = known == null ? 'q' : known ? 'live' : 'blank';
              return i ? shellEl(kind, known == null ? '' : 'seen') : shellEl(kind, stage ? '' : 'cur', known != null);
            }),
          ];
        }
        mag.className = `rl-mag ${stage}`;
        mag.replaceChildren(...cells);
        count.replaceChildren(...(S.mag ? [
          h('span', { class: 'live' }, `실탄 ${S.left?.live || 0}`), h('span', { class: 'blank' }, `공포탄 ${S.left?.blank || 0}`),
        ] : []));
      }
      // 총: 위에서 내려다본 총이 겨눈 사람 얼굴 쪽으로 돈다. 누가 나를 쏘면(결과 전) 정면 총구가 다가온다
      const front = S.phase === 'hush' && !shot.self && shot.to.includes(me) && alive(me);
      if (front !== gunFront) {
        gunFront = front;
        if (front) {
          const a = sideAngle(shot.by);
          frontImg.src = `${ART}gun_aim_${a < -0.35 ? 'l' : a > 0.35 ? 'r' : 'c'}.png`;
        }
        gun.classList.toggle('front', front);
      }
      // 총은 쏘는 사람 앞에 놓인다: 차례가 시작되면(장전 중엔 다음 사람) 그 사람 앞으로 미끄러져 오고,
      // 겨누기 전엔 테이블 가운데를 본다
      const who = S.phase === 'turn' || S.phase === 'fate' ? S.turn : (S.phase === 'hush' || S.phase === 'shot') ? shot?.by
        : S.phase === 'load' || S.phase === 'pick' ? S.after : holder || S.order?.[0];
      if (who && who !== holder && seats.has(who)) {
        holder = who;
        const s = seats.get(who);
        spot = { x: s.x + (50 - s.x) * GUN_PULL, y: s.y + (50 - s.y) * GUN_PULL };
        gun.style.left = `${spot.x}%`;
        gun.style.top = `${spot.y}%`;
        lastAimed = null;
        setPose(poseCenter());
      }
      const aimed = S.phase === 'turn' ? (S.turn === me ? aimLocal : S.aim)
        : (S.phase === 'hush' || S.phase === 'shot') && shot?.to.length === 1 ? shot.to[0] : null;
      if (aimed && seats.has(aimed)) {
        lastAimed = aimed;
        setPose(poseTo(aimed));
      }
      // 남이 나를 겨누면: 테이블 테두리가 붉게 뛰고, 총구가 나에게 올 때마다 짧게 알린다
      const aimMe = S.phase === 'turn' && S.turn !== me && S.aim === me && alive(me);
      if (aimMe && !wasAimMe) {
        audio.aimed();
        setBanner('나를 겨눔!', 'aimme', 900);
      }
      wasAimMe = aimMe;
      table.classList.toggle('aimme', aimMe);
      table.classList.toggle('hush', S.phase === 'hush');
      table.classList.toggle('danger', front);
    }

    // 총 자리에서 그 지점(화면 px) 쪽 각도 → 15도 간격 그림 중 가까운 것 (왼쪽이면 오른쪽 그림을 좌우로 뒤집는다).
    // 총이 미끄러지는 중이어도 도착할 자리에서 잰다
    function poseAt(x, y) {
      const t = table.getBoundingClientRect();
      const gx = t.left + (t.width * spot.x) / 100;
      const gy = t.top + (t.height * spot.y) / 100;
      const deg = (Math.atan2(y - gy, x - gx) * 180) / Math.PI;
      const flip = Math.abs(deg) > 90;
      let d = flip ? 180 - deg : deg;
      if (d > 180) d -= 360;
      const k = Math.max(0, Math.min(180 / GUN_STEP, Math.round((d + 90) / GUN_STEP)));
      const shown = -90 + k * GUN_STEP;
      return { k, flip, deg: flip ? 180 - shown : shown };
    }
    const poseTo = id => {
      const r = seats.get(id).face.getBoundingClientRect();
      return poseAt(r.left + r.width / 2, r.top + r.height / 2);
    };
    const poseCenter = () => {
      const t = table.getBoundingClientRect();
      return poseAt(t.left + t.width / 2, t.top + t.height / 2);
    };
    function setPose(p) {
      if (p.k === pose.k && p.flip === pose.flip) return;
      pose = p;
      gunImg.src = `${ART}gun_${p.k}.png`;
      gunImg.classList.toggle('flip', p.flip);
      // 쏠 때 총이 뒤로 밀리는 방향 (도트 한 칸 = 3px 단위)
      const a = (p.deg * Math.PI) / 180;
      gun.style.setProperty('--kx', `${-Math.round(Math.cos(a) * 3) * PX}px`);
      gun.style.setProperty('--ky', `${-Math.round(Math.sin(a) * 3) * PX}px`);
    }

    function promptOf(mode) {
      if (hint && performance.now() < hint.until) return [hint.text, hint.cls];
      const shot = S.shot;
      if (mode === 'will') return [heir ? `유품: ${nameOf(heir)}에게 · 숫자키 = 물려줄 카드 (← → 다른 사람)` : '유품: ← → 받을 사람 · 숫자키 = 물려줄 카드', 'hint'];
      if (S.phase === 'intro') return [S.again ? '한 판 더!' : '돌아가며 한 발! 실탄이면 하트 -1 · 나를 쏴서 공포탄이면 한 번 더', ''];
      if (S.phase === 'pick') {
        const P = S.pick;
        if (P?.got) return ['증강 공개! 자리 옆 그림에 마우스를 올리면 설명이 보여요', 'hint'];
        if (mode === 'pick') return [`${TIERS[P.tier]} 증강! 숫자키 1~3으로 하나 고르세요 (모두 동시에)`, 'mine'];
        return [alive(me) && inGame() ? '골랐어요! 다른 사람을 기다리는 중…' : '모두 증강을 고르는 중…', 'calm'];
      }
      if (S.phase === 'fate') {
        const f = S.fate;
        if (landed === f.no) return [`${FATES[f.k].name} ${FATES[f.k].tip}`, 'warn'];
        return [f.by === me ? '운명의 룰렛! 두근두근…' : `${nameOf(f.by)}의 운명 카드! 룰렛이 돈다…`, 'warn'];
      }
      if (S.phase === 'load') {
        const shells = `실탄 ${S.mag.live} · 공포탄 ${S.mag.blank}`;
        if (S.swap) return [`총 교체! 남은 탄 ${S.dud}발을 버리고 새 탄창: ${shells}`, 'warn'];
        if (S.magNo === FINAL_MAG) return [`막판! 이제 카드는 안 나와요 (처치로만) · ${shells}`, 'warn'];
        return [`${S.dud ? `남은 공포탄 ${S.dud}발은 버리고 ` : ''}새 탄창: ${shells}`, ''];
      }
      if (S.phase === 'skip') return [`${nameOf(S.skip)} ${S.skipBy === 'stun' ? '기절해서' : '수갑 때문에'} 이번 차례 쉬어요`, 'calm'];
      if (S.phase === 'turn') {
        if (S.turn === me) {
          if (mode !== 'turn') return ['…', 'calm'];
          const quick = hasAug(S, me, 'quick') && api.now() - (S.turnAt || 0) < QUICK_TIME ? '속사! ' : '';
          const more = `${S.repeat ? '한 번 더! ' : ''}${S.sealed === me ? '봉인! ' : ''}${quick}`;
          if (S.scatter) return [`${more}산탄! 스페이스 = 모두에게 발사`, 'mine'];
          if (!aimLocal) return [`${more || '내 차례! '}← → 겨누기 (↓ = 나) · 스페이스 = 발사 · 숫자키 = 카드`, 'mine'];
          if (aimLocal === me) return [`${more}나에게: 공포탄이면 한 번 더 · 스페이스 = 발사`, 'mine'];
          return [`${more}${nameOf(aimLocal)}에게 · 스페이스 = 발사 (← → 바꾸기)`, 'mine'];
        }
        const t = nameOf(S.turn);
        if (S.scatter) return [`${t} 산탄 장전! 모두 조심`, 'warn'];
        if (S.aim === me) return [`${josa(t, '이', '가')} 나를 겨누는 중!`, 'warn'];
        if (S.aim) return [`${t} 차례 · ${S.aim === S.turn ? '자기 자신을' : `${nameOf(S.aim)} 쪽을`} 겨누는 중`, 'calm'];
        return [`${t} 차례`, 'calm'];
      }
      if (S.phase === 'hush') {
        if (shot.pierce && shot.to.includes(me)) return [`${josa(nameOf(shot.by), '이', '가')} 저격! 막을 수 없어요…`, 'warn'];
        if (mode === 'react') return [`${josa(nameOf(shot.by), '이', '가')} 나를 쐈어요! 숫자키 = 받아치기 · 스페이스 = 그냥 맞기`, 'warn'];
        return ['두근…', 'calm'];
      }
      if (S.phase === 'shot') {
        if (!shot.live) return [shot.more === 'dual' ? '공포탄… 쌍권총! 한 발 더' : shot.again ? '공포탄! 한 번 더' : '공포탄…', 'calm'];
        const lost = Object.entries(shot.hits || {}).map(([id, d]) => `${nameOf(id)} -${d}`).join(' · ');
        const extra = shot.more === 'chain' ? ' · 연쇄 처치! 한 번 더' : shot.more === 'dual' ? ' · 쌍권총! 한 발 더' : '';
        return [`${lost ? `실탄! ${lost}` : '실탄! 하지만 다 막았다'}${extra}`, 'warn'];
      }
      return ['', ''];
    }

    const augCard = (a, i, can, chosen) => h('button', {
      class: `rl-card aug t${AUGS[a].tier}${can ? ' can' : chosen ? ' chosen' : ' dim'}`,
      type: 'button', tabindex: '-1',
      onClick: e => {
        e.currentTarget.blur();
        useCard(i);
      },
    },
    h('span', { class: 'rl-key' }, String(i + 1)), spr(`a_${a}`),
    h('span', { class: 'rl-ctext' }, h('span', { class: 'rl-cname' }, AUGS[a].name), h('span', { class: 'rl-ctip' }, AUGS[a].tip)));
    const fateCard = (n, mode) => h('button', {
      class: `rl-card fate${mode === 'turn' ? ' can' : mode ? ' dim' : ''}`,
      type: 'button', tabindex: '-1',
      onClick: e => {
        e.currentTarget.blur();
        useFate();
      },
    },
    h('span', { class: 'rl-key' }, 'R'), spr('c_fate'),
    h('span', { class: 'rl-ctext' }, h('span', { class: 'rl-cname' }, `운명 카드${n > 1 ? ` ×${n}` : ''}`), h('span', { class: 'rl-ctip' }, '룰렛을 돌려요! 한 판에 한 장')));

    function paintPanel() {
      if (!S) return;
      const mode = modeOf();
      const hand = myHand();
      const [text, cls] = promptOf(mode);
      const offers = S.phase === 'pick' && S.pick && !S.pick.got && alive(me) ? S.pick.offers?.[me] || [] : null;
      const chosen = myPick && myPick.round === S.pick?.round ? myPick.aug : null;
      const fates = alive(me) && !offers ? S.fates?.[me] || 0 : 0;
      const idle = !inGame() ? '관전 중' : alive(me) ? '카드 없음 · 장전 · 처치로 받아요' : '탈락! 채팅(Enter)으로 훈수 두기';
      const key = JSON.stringify([mode, hand, hand.map(c => usable(c, mode)), offers, chosen, fates, text, cls, idle]);
      if (key !== keys.panel) {
        keys.panel = key;
        prompt.className = `rl-prompt ${cls}`;
        prompt.textContent = text;
        const cards = offers ? offers.map((a, i) => augCard(a, i, mode === 'pick', a === chosen)) : hand.map((card, i) => {
          const def = CARDS[card] || { name: card, tip: '' };
          return h('button', {
            class: `rl-card${usable(card, mode) ? ' can' : mode ? ' dim' : ''}${def.rare ? ' rare' : ''}`,
            type: 'button', tabindex: '-1',
            onClick: e => {
              e.currentTarget.blur(); // 스페이스가 이 버튼을 다시 누르지 않게
              useCard(i);
            },
          },
          h('span', { class: 'rl-key' }, String(i + 1)), spr(`c_${card}`),
          h('span', { class: 'rl-ctext' }, h('span', { class: 'rl-cname' }, def.name), h('span', { class: 'rl-ctip' }, def.tip)));
        });
        if (fates) cards.push(fateCard(fates, mode));
        handEl.replaceChildren(...(cards.length ? cards : [h('span', { class: 'rl-empty' }, idle)]));
      }
      let tKey = '';
      let make = null;
      if (mode === 'will') {
        tKey = 'will';
        make = () => countdown(S.wills[me], WILL_TIME);
      } else if (S.phase === 'pick' && S.pick && !S.pick.got) {
        tKey = `p${S.pick.round}`;
        make = () => countdown(S.phaseEndsAt, PICK_TIME);
      } else if (S.phase === 'turn') {
        tKey = `t${S.turnNo}:${S.turnEndsAt}`;
        make = () => countdown(S.turnEndsAt, TURN_TIME);
      } else if (mode === 'react') {
        tKey = `r${S.shot.no}`;
        make = () => countdown(S.shot.until, REACT_TIME);
      }
      if (tKey !== keys.timer) {
        keys.timer = tKey;
        timer.replaceChildren(...(make ? [make()] : []));
      }
    }

    function paintHead() {
      const left = S.magNo ? `탄창 ${S.magNo}${S.magNo >= FINAL_MAG ? ' 🔥막판' : ''} · 생존 ${S.alive.length}명${S.dir === -1 ? ' · ↺ 거꾸로' : ''}` : '곧 시작해요';
      const fates = S.fates?.[me] || 0;
      const right = alive(me) ? `❤️ ${S.hp?.[me] || 0} · 🃏 ${S.cards?.[me] || 0}장${fates ? ` · 🎰 ${fates}` : ''}` : inGame() ? '👻 구경 중' : '👀 관전 중';
      if (keys.head === left + right) return;
      keys.head = left + right;
      head.replaceChildren(h('span', {}, left), h('span', {}, right));
    }

    function paintSide() {
      const out = S.outOrder || [];
      const log = S.log || [];
      const key = JSON.stringify([S.alive, out, S.dead, log, S.augs]);
      if (key === keys.side) return;
      keys.side = key;
      const augsOf = id => (S.augs?.[id] || []).filter(a => AUGS[a]);
      const owners = S.order.filter(id => augsOf(id).length);
      const inPlay = [...new Set(owners.flatMap(augsOf))];
      side.replaceChildren(...[
        h('h3', {}, `생존 ${S.alive.length}명`),
        h('div', { class: 'tc-alive' }, S.alive.map(id => h('span', { class: 'tc-alive-chip' }, avatar(who(id)), who(id).name))),
        out.length ? h('h3', {}, '탈락 기록') : null,
        out.length ? h('ul', { class: 'rules' }, out.map(id => {
          const by = S.dead?.[id];
          return h('li', {}, h('b', {}, who(id).name), by && by !== '-' ? ` ← ${who(by).name}` : ' 💥 자폭');
        })) : null,
        log.length ? h('h3', {}, '방금') : null,
        log.length ? h('ol', { class: 'rl-log' }, log.map(t => h('li', {}, t))) : null,
        owners.length ? h('h3', {}, '증강') : null,
        owners.length ? h('ul', { class: 'rl-auglist' }, owners.map(id => h('li', {}, h('b', {}, who(id).name),
          ...augsOf(id).map(a => h('span', { class: `t${AUGS[a].tier}` }, AUGS[a].name))))) : null,
        inPlay.length ? h('ul', { class: 'rl-cardlist' }, inPlay.map(a => h('li', {},
          spr(`a_${a}`, '', 2), h('span', {}, h('b', {}, AUGS[a].name), ` ${AUGS[a].tip}`)))) : null,
        h('h3', {}, '카드'),
        h('ul', { class: 'rl-cardlist' }, Object.entries(CARDS).map(([k, c]) => h('li', {},
          spr(`c_${k}`, '', 2), h('span', {}, h('b', {}, c.name), ` ${c.tip}${c.when === 'react' ? ' (맞을 때)' : ''}`)))),
        h('h3', {}, '운명 카드 (R)'),
        h('ul', { class: 'rules' },
          h('li', {}, '처음에 한 장(한 판에 한 번)! 내 차례에 쓰면 룰렛이 돌아서 하나가 바로 일어나요'),
          h('li', {}, FATE_ORDER.map(k => FATES[k].name.replace(/!$/, '')).join(' · '))),
        h('h3', {}, '조작'),
        h('ul', { class: 'rules' },
          h('li', {}, '← = 내 왼쪽 사람 · → = 내 오른쪽 사람 겨누기 (↓ = 나, ↑ = 맞은편). 총구는 모두에게 보여요'),
          h('li', {}, '스페이스 = 발사'),
          h('li', {}, '숫자키 = 그 자리 카드 (수갑·훔치기는 겨눈 사람에게) · R = 운명 카드'),
          h('li', {}, '누가 나를 쐈을 때: 숫자키 = 방패·거울, 스페이스 = 그냥 맞기')),
        h('h3', {}, '규칙'),
        h('ul', { class: 'rules' },
          h('li', {}, '탄이 몇 발씩인지만 알고 순서는 몰라요'),
          h('li', {}, '나를 쏴서 공포탄이면 한 번 더'),
          h('li', {}, '🎁 남을 탈락시키면 카드 1장'),
          h('li', {}, `카드는 처음 2장, 탄창 2~3에 1장씩. 탄창 ${FINAL_MAG}부터 막판: 카드는 안 나오고 실탄이 확 늘어요`),
          h('li', {}, '✨ 증강: 시작할 때와 탄창 3 앞에서 모두 동시에 3개 중 하나 (모두에게 보여요)'),
          h('li', {}, '받아치기는 결과가 나오기 전에! 공포탄이면 카드만 날려요'),
          h('li', {}, `${TURN_TIME / 1000}초가 지나면 총구가 향한 사람에게(없으면 나에게) 나가요`),
          h('li', {}, '👻 탈락하면 남은 카드 1장을 누군가에게 물려줄 수 있어요'),
          h('li', {}, '마지막 1명 우승')),
      ].filter(Boolean));
    }

    function paint() {
      if (!S) return;
      paintHead();
      paintSeats();
      paintCenter();
      paintPanel();
      paintSide();
    }

    return {
      update({ state, priv }) {
        S = state;
        P = priv || null;
        S.alive ||= [];
        layoutSeats();
        const shot = S.shot;
        if (!seen) {
          const no = S.shotNo || 0;
          seen = {
            hush: no, result: S.phase === 'hush' ? no - 1 : no, ev: S.evNo || 0, mag: S.phase === 'load' ? (S.magNo || 0) - 1 : S.magNo || 0,
            turn: -1, react: new Set(), peek: '', final: false,
            pick: S.phase === 'pick' ? -1 : S.pick?.round ?? 0, picked: S.pick?.got ? S.pick.round : -1,
            fate: S.phase === 'fate' ? -1 : S.fate?.no ?? 0, fateDone: S.fate?.done ? S.fate.no : -1,
          };
          if (S.phase === 'intro') setBanner('독박 룰렛');
        }
        if (S.phase === 'pick' && S.pick && S.pick.round !== seen.pick) {
          seen.pick = S.pick.round;
          myPick = null;
          onPick();
        }
        if (S.pick?.got && S.pick.round !== seen.picked) {
          seen.picked = S.pick.round;
          onPicked();
        }
        if (S.phase === 'fate' && S.fate && S.fate.no !== seen.fate) {
          seen.fate = S.fate.no;
          onFate();
        }
        if (S.fate?.done && S.fate.no !== seen.fateDone) {
          seen.fateDone = S.fate.no;
          onFateDone();
        }
        if (S.phase === 'load' && S.magNo !== seen.mag) {
          seen.mag = S.magNo;
          onLoad();
        }
        if (S.phase === 'hush' && shot.no !== seen.hush) {
          seen.hush = shot.no;
          onHush();
        }
        if (S.phase === 'hush') {
          for (const [id, r] of Object.entries(shot.react || {})) {
            const k = `${shot.no}:${id}`;
            if (r === 'pass' || seen.react.has(k)) continue;
            seen.react.add(k);
            audio.card();
          }
        }
        if (S.phase !== 'hush' && shot && 'live' in shot && shot.no !== seen.result) {
          seen.result = shot.no;
          paintCenter(); // 총 방향을 먼저 맞추고 쏜다
          onResult();
        }
        if ((S.evNo || 0) !== seen.ev) {
          seen.ev = S.evNo || 0;
          onEvent(S.ev);
        }
        if (S.phase === 'skip' && seen.skip !== `${S.turnNo}:${S.skip}`) {
          seen.skip = `${S.turnNo}:${S.skip}`;
          setBanner(`${S.skipBy === 'stun' ? '기절!' : '수갑!'} ${nameOf(S.skip)} 쉼`, 'skip', 1300); // 도트 글꼴엔 ⛓️ 그림이 없어서 글자로
        }
        if (S.phase === 'turn' && S.turnNo !== seen.turn) {
          seen.turn = S.turnNo;
          aimLocal = S.turn === me ? S.aim || null : null;
          hint = null;
          if (S.turn === me) audio.turn();
          if (S.turn === me && hasAug(S, me, 'quick')) later(QUICK_TIME + 60, paint); // 속사 시간이 끝나면 안내를 바꾼다
          if (S.repeat) setBanner(S.turn === me ? '한 번 더!' : `${nameOf(S.turn)} 한 번 더`, 'again', 1600);
        }
        const peek = myPeek();
        if (!peek) seen.peek = '';
        if (peek && peek.key !== seen.peek) { // 돋보기 결과는 나에게만
          seen.peek = peek.key;
          say(`돋보기: 지금 탄은 ${peek.live ? '실탄' : '공포탄'}!`, peek.live ? 'warn' : 'hint', 3000);
        }
        if (S.wills?.[me] && !sent.will && (!heir || !alive(heir))) heir = ring().find(id => (S.cards?.[id] || 0) < handMax(S, id)) || null;
        audio.heart(S.phase === 'hush');
        box.classList.toggle('final', S.phase === 'final');
        if (S.phase === 'final' && !seen.final) {
          seen.final = true;
          if (S.winner === me) audio.win();
          board.replaceChildren(h('div', { class: 'rx-result' },
            h('h2', { class: 'display' }, S.winner ? `🔫 ${nameOf(S.winner)} 최후의 1인!` : '🔫 끝!'),
            podium(S.roster, S.standings, me)));
        }
        paint();
      },
      unmount() {
        cancelAnimationFrame(raf);
        clearTimeout(aimTimer);
        for (const t of timers) clearTimeout(t);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('pointerdown', unlock);
        audio.dispose();
      },
    };
  },
};
