// 투기장 규칙 (방장이 돌린다). 화면은 arena-view.js, 게임 등록은 arena.js
// 차례 없이 모두 동시에 싸운다. 한 턴 = 공격 단계(몰래 한 명을 겨누고 무기 장전) → 공개 → 방어 단계(보고 남은 기력으로 막기) → 결과.
// - 기력 3을 공격과 방어에 나눠 쓴다. 공격은 '준비 완료'를 누른 순서대로 들어가고, 먼저 쓰러진 사람의 공격은 안 나간다.
// - 한 명에게 셋 이상이 몰리면 전부 절반 피해. 목숨 2개: 처음 쓰러지면 다음 턴에 일어나고 쓰러뜨린 사람에게 복수 표식.
// - 시작할 때와 3턴마다 유물을 고르고, 탈락시키면 그 사람 유물을 하나 뺏는다. 마지막 1명 우승.
// 손패와 장전한 공격은 공개 전까지 방장만 안다(ctx.secret). 내 손패는 나에게만(ctx.setPrivate).
// 체력을 깎는 건 언제나 누군가의 공격이다 (환경이 대신 쓰러뜨리지 않는다).
import { shuffle, INTRO_TIME } from '../util.js';

export const HP_MAX = 50;
export const REVIVE_HP = 30;
export const LIVES = 2;
export const ENERGY = 3;
export const DUEL_ENERGY = 4;      // 둘만 남으면
export const DUEL_MULT = 1.5;
export const HAND_START = 5;
export const HAND_MAX = 7;
export const DRAW = 2;
export const ATTACK_TIME = 12000;
export const DEFEND_TIME = 8000;
export const PICK_TIME = 12000;
export const LOOT_TIME = 8000;
export const REVEAL_TIME = 1800;   // 화살표를 보여 주는 시간
export const PICK_SHOW = 1800;
export const STRIKE_MS = 800;      // 결과 연출: 장면 하나에 이만큼 (많으면 줄인다)
const RESOLVE_CAP = 9000;
const GRACE = 300;                 // 마감 직전에 누른 신호가 도착할 시간
export const PICK_EVERY = 3;       // 이 턴마다 유물
export const CROWD = 3;            // 한 명에게 이만큼 몰리면 전부 절반
const LOG_KEEP = 7;
// 2차: 투지 · 필살기 · 야수 · 폭군
export const BEAST = '@beast';     // 야수를 겨눌 때 쓰는 이름
export const FURY_MAX = 100;       // 투지가 가득 차면 필살기
const FURY_DEAL = 0.8;             // 준 피해 1마다
const FURY_TAKE = 1.2;             // 받은 피해 1마다 (맞는 쪽이 더 빨리 찬다)
export const ULT_ROUND = 4;        // 이 턴이 끝나면 필살기를 고른다
export const BREAK = 10;           // 준비 중에 한 턴에 이만큼 맞으면 끊긴다 (체력의 20%)
export const BEAST_FIRST = 7;      // 야수가 처음 풀리는 턴
export const BEAST_STAY = 4;       // 안 잡히면 이만큼 있다가 물러난다
export const BEAST_GAP = 6;        // 다시 나올 때까지
export const BEAST_HP = 14;        // 살아 있는 사람 1명마다
export const BEAST_DMG = 12;
export const TYRANT_KILLS = 2;     // 이만큼 쓰러뜨리면 폭군 (제일 많이 쓰러뜨린 한 명)
// 3차: 관중의 변덕 · 망령(탈락한 사람)의 원한과 유산
export const WHIM_FIRST = 5;       // 관중의 변덕이 처음 도는 턴
export const WHIM_EVERY = 4;       // 그 뒤로 이 턴마다
export const WHIM_TIME = 3800;     // 룰렛이 돌다 멈추는 걸 보는 시간
export const GRUDGE = 3;           // 망령 하나가 원한을 건 사람은 맞을 때마다 +3
export const GRUDGE_MAX = 3;       // 셋까지만 겹친다

// 카드. type: w 무기(공격 단계) · d 방어(방어 단계) · t 도구(when: a 공격 단계만, 없으면 아무 때나). w = 뽑힐 비율
export const CARDS = {
  dagger: { type: 'w', cost: 0, dmg: 3, w: 8, name: '단검', tip: '피해 3' },
  sword: { type: 'w', cost: 1, dmg: 7, w: 12, name: '장검', tip: '피해 7' },
  saw: { type: 'w', cost: 1, dmg: 4, bleed: 3, w: 7, name: '톱날 검', tip: '피해 4 + 출혈(3턴 동안 3씩)' },
  spear: { type: 'w', cost: 1, dmg: 5, pierce: true, w: 7, name: '창', tip: '피해 5 · 방어를 절반만 받음' },
  fire: { type: 'w', cost: 1, dmg: 5, vuln: true, w: 6, name: '화염병', tip: '피해 5 + 취약(다음 턴 받는 피해 1.5배)' },
  net: { type: 'w', cost: 1, dmg: 4, weak: true, w: 6, name: '그물', tip: '피해 4 + 약화(다음 턴 주는 피해 -25%)' },
  axe: { type: 'w', cost: 2, dmg: 13, w: 8, name: '전투 도끼', tip: '피해 13' },
  hammer: { type: 'w', cost: 2, dmg: 9, stun: true, w: 5, name: '전쟁 망치', tip: '피해 9 + 기절(다음 턴 기력 -1)' },
  ambush: { type: 'w', cost: 2, dmg: 9, ambush: 6, w: 5, name: '암습', tip: '피해 9 · 상대가 나를 안 겨눴으면 +6' },
  exec: { type: 'w', cost: 3, dmg: 18, exec: 8, w: 3, rare: true, name: '처형 도끼', tip: '피해 18 · 상대 체력이 절반 아래면 +8' },
  hook: { type: 'w', cost: 1, dmg: 4, steal: true, w: 5, name: '갈고리', tip: '피해 4 + 상대 손패 1장을 뺏음' },
  chain: { type: 'w', cost: 1, dmg: 5, sure: true, w: 5, name: '사슬 낫', tip: '피해 5 · 회피 · 반사 · 인간 방패가 안 통함' },
  bolt: { type: 'w', cost: 2, dmg: 9, splash: 3, w: 4, name: '번개', tip: '피해 9 + 상대 양옆 자리에 3씩' },
  keg: { type: 'w', cost: 2, dmg: 6, blast: 4, w: 3, name: '화약통', tip: '피해 6 + 나머지 모두에게 4씩' },
  buckler: { type: 'd', cost: 0, block: 3, w: 7, name: '나무 방패', tip: '방어 3' },
  shield: { type: 'd', cost: 1, block: 6, w: 12, name: '철 방패', tip: '방어 6' },
  tower: { type: 'd', cost: 2, block: 13, w: 6, name: '탑 방패', tip: '방어 13' },
  spike: { type: 'd', cost: 1, block: 4, thorns: 3, w: 5, name: '가시 갑옷', tip: '방어 4 · 나를 때린 모두에게 3' },
  riposte: { type: 'd', cost: 1, block: 3, counter: 6, w: 5, name: '받아치기', tip: '방어 3 · 제일 세게 때린 사람에게 6' },
  dodge: { type: 'd', cost: 1, dodge: true, w: 6, name: '회피', tip: '제일 센 공격 하나를 피함' },
  human: { type: 'd', cost: 1, redirect: true, w: 3, name: '인간 방패', tip: '제일 센 공격 하나를 옆자리 사람에게' },
  mirror: { type: 'd', cost: 2, reflect: true, w: 2, rare: true, name: '반사 거울', tip: '제일 센 공격 하나를 되돌림' },
  parry: { type: 'd', cost: 1, block: 5, perfect: true, w: 5, name: '역습 태세', tip: '방어 5 · 공격받고도 한 대도 안 맞으면 다음 턴 기력 +1' },
  elixir: { type: 'd', cost: 2, undying: true, w: 2, rare: true, name: '불사의 약', tip: '이번 턴 체력이 1 아래로 안 내려감' },
  bandage: { type: 't', cost: 1, heal: 6, w: 7, name: '붕대', tip: '체력 +6' },
  stim: { type: 't', cost: 0, energy: 2, w: 4, name: '각성제', tip: '이번 턴 기력 +2 · 다음 턴 -1' },
  hone: { type: 't', when: 'a', cost: 0, plus: 4, w: 5, name: '숫돌', tip: '이번 공격 +4' },
  smoke: { type: 't', when: 'a', cost: 1, w: 4, name: '연막', tip: '이번 턴 내 화살표가 공개 때 안 보임' },
  blood: { type: 't', cost: 0, energy: 2, hp: 5, w: 3, name: '피의 의식', tip: '체력 -5 · 이번 턴 기력 +2' },
  twin: { type: 't', when: 'a', cost: 1, w: 3, rare: true, name: '쌍수', tip: '이번 공격의 제일 센 무기가 한 번 더' },
  taunt: { type: 't', when: 'a', cost: 1, w: 3, name: '도발', tip: '겨눈 사람은 다음 턴에 나만 겨눌 수 있음' },
};

// 유물. tier: 0 전투 스타일(시작할 때) · 1 일반 · 2 희귀 · 3 전설
export const RELICS = {
  berserk: { tier: 0, name: '광전사의 피', tip: '체력이 절반 아래면 공격 +4' },
  guard: { tier: 0, name: '수호자의 맹세', tip: '방어 카드 +3 · 남은 방어의 절반이 다음 턴으로' },
  patience: { tier: 0, name: '암살자의 인내', tip: '공격을 쉰 다음 턴의 공격 +8' },
  vamp: { tier: 0, name: '흡혈귀의 송곳니', tip: '준 피해의 20% 회복' },
  dice: { tier: 0, name: '도박사의 주사위', tip: '공격이 20% 확률로 2배 · 5%는 빗나감' },
  looter: { tier: 0, name: '약탈자의 자루', tip: '피해를 준 턴마다 카드 1장 더' },
  avenger: { tier: 0, name: '복수귀', tip: '지난 턴 나를 때린 사람에게 +5' },
  vanguard: { tier: 0, name: '선봉', tip: '제일 먼저 준비한 턴엔 공격 +3' },
  whet: { tier: 1, name: '숫돌 가죽', tip: '무기 카드마다 피해 +1' },
  padded: { tier: 1, name: '덧댄 갑옷', tip: '방어 카드마다 방어 +2' },
  callus: { tier: 1, name: '굳은살', tip: '턴마다 처음 받는 피해 -3' },
  pack: { tier: 1, name: '큰 배낭', tip: '손패 최대 +2' },
  medic: { tier: 1, name: '응급 주머니', tip: '턴 끝에 체력 +2' },
  thorn: { tier: 2, name: '가시 피부', tip: '나를 때린 사람은 2 피해' },
  opportunist: { tier: 2, name: '기회주의자', tip: '남도 같이 때리는 상대에게 +4' },
  executioner: { tier: 2, name: '처형인', tip: '체력 30% 아래인 상대에게 2배' },
  cloak: { tier: 2, name: '겁쟁이의 망토', tip: '공격을 안 한 턴엔 방어 +6' },
  hunter: { tier: 2, name: '사냥꾼', tip: '야수에게 피해 2배' },
  poison: { tier: 2, name: '독술사', tip: '내가 낸 출혈은 피해 2배' },
  calm: { tier: 2, name: '냉정', tip: '취약 · 약화에 안 걸림' },
  spoils: { tier: 2, name: '전리품 주머니', tip: '쓰러뜨리면 카드 2장 더' },
  challenger: { tier: 2, name: '도전자', tip: '폭군에게 주는 피해 1.5배' },
  sand: { tier: 3, name: '시간의 모래', tip: '기력 +1' },
  phoenix: { tier: 3, name: '불사조의 깃털', tip: '목숨 +1' },
  giant: { tier: 3, name: '거인의 힘', tip: '비용 2 이상인 무기 피해 1.5배' },
  shadow: { tier: 3, name: '그림자 망토', tip: '내 화살표는 공개 때 안 보임' },
  king: { tier: 3, name: '왕의 권위', tip: '내가 폭군이면 피해 +30%' },
};
export const TIERS = ['스타일', '일반', '희귀', '전설'];

// 필살기. 투지가 가득 차면 공격 단계에 R로 준비(그 턴엔 공격 못 함) → 다음 턴 내내 모두에게 보이고,
// 그 턴에 BREAK 이상 맞으면 끊긴다. 안 끊기면 그 턴의 타격이 다 끝난 뒤에 터진다. aim = 겨눈 사람에게 쓰는 것
export const ULTS = {
  meteor: { name: '유성우', tip: '나 빼고 모두에게 14' },
  exec: { aim: true, name: '처형', tip: '겨눈 사람에게 30 · 체력 30% 아래면 바로 쓰러뜨림' },
  feast: { name: '피의 축제', tip: '모두에게서 8씩 빼앗아 회복' },
  fort: { name: '철옹성', tip: '3턴 동안 받는 피해 절반 · 때린 사람에게 30% 되돌림' },
  warp: { name: '시간 왜곡', tip: '다음 턴 기력 6' },
  rob: { aim: true, name: '강탈', tip: '겨눈 사람의 유물 하나를 영영 뺏음' },
};

// 관중의 변덕: WHIM_EVERY턴마다 룰렛이 돌아 그 턴에만 통하는 규칙 하나가 정해진다 (이 순서가 룰렛판의 칸 순서)
// 변덕이 직접 체력을 깎지는 않는다. 판을 흔들 뿐, 쓰러뜨리는 건 여전히 누군가의 공격
export const WHIMS = {
  frenzy: { name: '광란', tip: '이번 턴 모든 피해 1.5배' },
  bare: { name: '맨몸', tip: '이번 턴은 방어 단계가 없다' },
  blind: { name: '눈가리개', tip: '화살표를 안 보여 준 채로 막는다' },
  arms: { name: '무기 배급', tip: '모두 무기 카드 2장' },
  execution: { name: '공개 처형', tip: '체력 1위와 꼴찌는 서로만 겨눌 수 있다' },
  peek: { name: '손패 공개', tip: '이번 턴 모두의 손패가 보인다' },
  prize: { name: '포상', tip: '이번 턴에 누굴 쓰러뜨리면 유물 하나' },
  mob: { name: '몰매', tip: '이번 턴은 몰려도 절반이 안 된다' },
};

// 피의 함성: 판이 늘어지지 않게 뒤로 갈수록 모든 피해가 커진다 (쓰러뜨리는 건 여전히 누군가의 공격)
export const RAGE = [[16, 2], [12, 1.5], [8, 1.25]];
export const rageOf = round => (RAGE.find(([r]) => round >= r) || [0, 1])[1];
const list = v => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
const inc = (S, key, id, n = 1) => { S[key] = { ...(S[key] || {}), [id]: (S[key]?.[id] || 0) + n }; };
export const relicsOf = (S, id) => list(S.relics?.[id]);
export const has = (S, id, r) => relicsOf(S, id).includes(r);
const handOf = (ctx, id) => list(ctx.secret.hands?.[id]);
const alive = (S, id) => list(S.alive).includes(id);
const statusOf = (S, id) => S.status?.[id] || {};
// 상태이상은 '몇 턴까지'로 적어 둔다 (그 턴까지 걸려 있음)
const until = (S, id, k) => statusOf(S, id)[k] > 0 && statusOf(S, id)[k] >= (S.round || 0);
export const isVuln = (S, id) => until(S, id, 'vuln');
export const isWeak = (S, id) => until(S, id, 'weak');
export const isFort = (S, id) => until(S, id, 'fort');
// 필살기를 준비 중인 사람 (지난 턴에 준비해서 이번 턴에 터질 차례)
export const charging = (S, id) => !!S.charge?.[id] && S.charge[id].at < (S.round || 0);
export const furyOf = (S, id) => Math.min(FURY_MAX, Math.floor(S.fury?.[id] || 0));
const addFury = (S, id, n) => { S.fury = { ...(S.fury || {}), [id]: Math.min(FURY_MAX, (S.fury?.[id] || 0) + n) }; };
// 폭군: 제일 많이 쓰러뜨린 한 명 (현상금을 치르고 나면 거기서부터 다시 센다)
export function tyrantOf(S) {
  const score = id => (S.kills?.[id] || 0) - (S.bountyBase?.[id] || 0);
  const rows = list(S.alive).map(id => [id, score(id)]).sort((a, b) => b[1] - a[1]);
  return rows[0] && rows[0][1] >= TYRANT_KILLS && rows[0][1] > (rows[1]?.[1] ?? -1) ? rows[0][0] : null;
}
export const isStun = (S, id) => statusOf(S, id).stun === S.round;
const setStatus = (S, id, k, v) => { S.status = { ...(S.status || {}), [id]: { ...statusOf(S, id), [k]: v } }; };
// 이번 턴에 걸린 관중의 변덕 (없으면 null)
export const whimOf = S => (S.whim && S.whim.round === S.round ? S.whim.k : null);
// 모든 피해에 곱해지는 값: 피의 함성 · 결투 · 광란
const scaleOf = S => rageOf(S.round) * (S.duel ? DUEL_MULT : 1) * (whimOf(S) === 'frenzy' ? 1.5 : 1);
export const handMaxOf = (S, id) => HAND_MAX + (has(S, id, 'pack') ? 2 : 0);
// 이번 턴에 이 사람만 겨눌 수 있다 (도발당했거나, 공개 처형의 두 사람). 없으면 null
export function lockOf(S, id) {
  const tn = statusOf(S, id).taunt;
  if (tn && tn.r === S.round && alive(S, tn.by)) return tn.by;
  const pair = whimOf(S) === 'execution' ? list(S.whim.pair) : [];
  const other = pair.includes(id) ? pair.find(x => x !== id) : null;
  return other && alive(S, other) ? other : null;
}

function note(S, text) {
  S.log = [...list(S.log), text].slice(-LOG_KEEP);
}

export function drawCard(rand = Math.random, type = null) {
  const keys = Object.keys(CARDS).filter(k => !type || CARDS[k].type === type);
  let r = rand() * keys.reduce((a, k) => a + CARDS[k].w, 0);
  for (const k of keys) if ((r -= CARDS[k].w) < 0) return k;
  return keys[0];
}

function setHand(ctx, id, hand) {
  const S = ctx.state;
  ctx.secret.hands = { ...(ctx.secret.hands || {}), [id]: hand };
  S.cards = { ...(S.cards || {}), [id]: hand.length };
  ctx.setPrivate(id, { hand });
}
// 카드 n장 받기. 손패가 넘치면 가장 오래 들고 있던 카드부터 버려진다
// (안 그러면 못 쓰는 카드로 손패가 꽉 차서 아무도 못 때리는 판이 나온다)
function give(ctx, id, n, key = null) {
  if (n <= 0) return 0;
  const hand = [...handOf(ctx, id)];
  for (let c = 0; c < n; c++) {
    ctx.secret.uid = (ctx.secret.uid || 0) + 1;
    hand.push({ u: ctx.secret.uid, k: key || drawCard() });
  }
  setHand(ctx, id, hand.slice(-handMaxOf(ctx.state, id)));
  return n;
}

// 이번 턴 기력: 3 (둘만 남으면 4) · 시간의 모래 +1 · 역습 태세 성공 +1 · 기절 -1 · 지난 턴 각성제 -1
export function energyOf(S, id) {
  let e = (statusOf(S, id).warp === S.round ? 6 : S.duel ? DUEL_ENERGY : ENERGY) + (has(S, id, 'sand') ? 1 : 0);
  if (statusOf(S, id).boost === S.round) e += 1;
  if (isStun(S, id)) e -= 1;
  if (statusOf(S, id).tired === S.round) e -= 1;
  return Math.max(0, e);
}

// 낸다고 한 카드 중에 실제로 낼 수 있는 것만 차례대로 (기력이 모자라면 건너뛴다). phase: 'a' 공격 단계 · 'd' 방어 단계
function affordable(hand, uids, energy, phase, hasTarget = true) {
  const cards = [];
  let left = energy;
  for (const u of list(uids)) {
    const c = hand.find(x => x.u === u);
    const def = c && CARDS[c.k];
    if (!def || cards.includes(c)) continue;
    if (phase === 'a' ? def.type === 'd' : def.type === 'w' || def.when === 'a') continue;
    if (def.type === 'w' && !hasTarget) continue;
    if (def.cost > left) continue;
    left += (def.energy || 0) - def.cost;
    cards.push(c);
  }
  return { cards, left };
}

// 공격 한 번의 피해 (방어 전). known = false면 남의 계획에 달린 것(암습 · 기회주의자 · 몰림 · 선봉 · 주사위)은 빼고 어림만 한다
export function attackOf(S, id, t, cards, known = null, rand = Math.random) {
  const ws = cards.filter(k => CARDS[k]?.type === 'w');
  if (!t || !ws.length) return null;
  let base = 0;
  let best = 0;
  const fx = {};
  for (const k of ws) {
    const d = CARDS[k];
    let v = d.dmg + (has(S, id, 'whet') ? 1 : 0);
    if (d.ambush && known && t !== BEAST && known.plans[t]?.t !== id) v += d.ambush;
    if (d.exec && t !== BEAST && (S.hp?.[t] || 0) <= HP_MAX / 2) v += d.exec;
    if (d.cost >= 2 && has(S, id, 'giant')) v = Math.round(v * 1.5);
    base += v;
    best = Math.max(best, v);
    for (const f of ['bleed', 'vuln', 'weak', 'stun', 'pierce', 'steal', 'sure', 'splash', 'blast']) if (d[f]) fx[f] = d[f];
  }
  if (cards.includes('twin')) base += best; // 쌍수: 제일 센 무기가 한 번 더
  if (cards.includes('hone')) base += CARDS.hone.plus;
  if (has(S, id, 'berserk') && (S.hp?.[id] || 0) <= HP_MAX / 2) base += 4;
  if (has(S, id, 'patience') && S.round > 1 && !S.attacked?.[id]) base += 8;
  if (has(S, id, 'avenger') && list(S.hitBy?.[id]).includes(t)) base += 5;
  if (known && has(S, id, 'vanguard') && known.first === id) base += 3;
  if (known && has(S, id, 'opportunist') && (known.count[t] || 0) >= 2) base += 4;
  let mult = scaleOf(S);
  const tags = [];
  if (t !== BEAST && known?.grudge?.[t]) { base += GRUDGE * Math.min(GRUDGE_MAX, known.grudge[t]); tags.push('grudge'); } // 망령의 원한
  if (t !== BEAST && S.tyrant === t && has(S, id, 'challenger')) mult *= 1.5;
  if (S.tyrant === id && has(S, id, 'king')) mult *= 1.3;
  if (isVuln(S, t)) { mult *= 1.5; tags.push('vuln'); }
  if (isWeak(S, id)) { mult *= 0.75; tags.push('weak'); }
  if (S.revenge?.[id] === t) { mult *= 1.25; tags.push('revenge'); }
  if (t !== BEAST && has(S, id, 'executioner') && (S.hp?.[t] || 0) <= HP_MAX * 0.3) { mult *= 2; tags.push('exec'); }
  if (t !== BEAST && isFort(S, t)) { mult *= 0.5; tags.push('fort'); }
  if (known && t !== BEAST && !charging(S, t) && whimOf(S) !== 'mob' && (known.count[t] || 0) >= CROWD) { mult *= 0.5; tags.push('crowd'); }
  if (known && has(S, id, 'dice')) {
    const r = rand();
    if (r < 0.05) { mult = 0; tags.push('miss'); } else if (r < 0.25) { mult *= 2; tags.push('crit'); }
  }
  return { t, dmg: Math.round(base * mult), cards: ws, fx, tags };
}

/* ───────── 유물 고르기 ───────── */

// 등급: 처음(no 0)은 전투 스타일, 그 뒤로는 갈수록 좋은 게 나온다 (스타일 유물은 희귀로 섞여 나온다)
export function offerOf(S, id, no, rand = Math.random) {
  const mine = relicsOf(S, id);
  const free = Object.keys(RELICS).filter(k => !mine.includes(k));
  if (no === 0) return shuffle(free.filter(k => RELICS[k].tier === 0)).slice(0, 3);
  const odds = no === 1 ? [0.55, 0.93] : no === 2 ? [0.3, 0.8] : [0.15, 0.65];
  const out = [];
  for (let i = 0; i < 3; i++) {
    const r = rand();
    const tier = r < odds[0] ? 1 : r < odds[1] ? 2 : 3;
    const pool = free.filter(k => !out.includes(k) && (RELICS[k].tier === tier || (tier === 2 && RELICS[k].tier === 0)));
    const any = free.filter(k => !out.includes(k));
    const src = pool.length ? pool : any;
    if (src.length) out.push(src[Math.floor(rand() * src.length)]);
  }
  return out;
}

function gain(S, id, relic) {
  if (!RELICS[relic] || has(S, id, relic)) return false;
  S.relics = { ...(S.relics || {}), [id]: [...relicsOf(S, id), relic] };
  if (relic === 'phoenix') inc(S, 'lives', id);
  return true;
}

function startPick(ctx, now, no) {
  const S = ctx.state;
  const offers = Object.fromEntries(list(S.alive).map(id => [id, offerOf(S, id, no)]));
  if (!Object.values(offers).some(o => o.length)) return startRound(ctx, now); // 더 받을 유물이 없다
  S.pick = { no, offers, done: Object.fromEntries(list(S.alive).filter(id => !offers[id].length).map(id => [id, true])) };
  ctx.secret.picks = {};
  S.phase = 'pick';
  S.phaseEndsAt = now + PICK_TIME;
  return true;
}

function startUltPick(ctx, now) {
  const S = ctx.state;
  S.ultsGiven = true;
  S.pick = { no: 100, kind: 'ult', offers: Object.fromEntries(list(S.alive).map(id => [id, shuffle(Object.keys(ULTS)).slice(0, 3)])) };
  ctx.secret.picks = {};
  S.phase = 'pick';
  S.phaseEndsAt = now + PICK_TIME;
  return true;
}

function revealPicks(ctx, now) {
  const S = ctx.state;
  const got = {};
  for (const id of list(S.alive)) {
    const offers = list(S.pick.offers?.[id]);
    const want = ctx.secret.picks?.[id];
    const relic = offers.includes(want) ? want : offers[Math.floor(Math.random() * offers.length)];
    if (S.pick.kind === 'ult') {
      if (relic) { S.ults = { ...(S.ults || {}), [id]: relic }; got[id] = relic; }
    } else if (relic && gain(S, id, relic)) got[id] = relic;
  }
  S.pick = { ...S.pick, got, shown: true };
  S.phaseEndsAt = now + PICK_SHOW;
  return true;
}

/* ───────── 한 턴 ───────── */

function deal(ctx) {
  const S = ctx.state;
  for (const id of list(S.order)) { // 처음 손패: 무기 하나 · 방어 하나는 꼭
    setHand(ctx, id, []);
    give(ctx, id, 1, drawCard(Math.random, 'w'));
    give(ctx, id, 1, drawCard(Math.random, 'd'));
    give(ctx, id, HAND_START - 2);
  }
}

function startRound(ctx, now) {
  const S = ctx.state;
  S.round = (S.round || 0) + 1;
  S.duel = list(S.alive).length === 2;
  S.tyrant = tyrantOf(S);
  // 관중의 변덕: 룰렛이 돌아 이번 턴에만 통하는 규칙이 하나 정해진다 (결투 중엔 안 돈다)
  S.whim = null;
  if (!S.duel && S.round >= WHIM_FIRST && (S.round - WHIM_FIRST) % WHIM_EVERY === 0) {
    const keys = Object.keys(WHIMS).filter(k => k !== S.whimLast);
    const k = keys[Math.floor(Math.random() * keys.length)];
    S.whim = { k, round: S.round };
    S.whimLast = k;
    if (k === 'execution') { // 체력 1위와 꼴찌
      const byHp = [...list(S.alive)].sort((a, b) => (S.hp[b] || 0) - (S.hp[a] || 0));
      S.whim.pair = [byHp[0], byHp[byHp.length - 1]];
    }
    note(S, `관중의 변덕: ${WHIMS[k].name}`);
  }
  // 야수: 풀려 있는 동안 턴마다 폭군(없으면 망령들이 원한을 제일 많이 건 사람, 그도 없으면 체력이 제일 많은 사람)을 노린다. 누굴 노리는지는 미리 보인다
  if (S.beast && (S.round > S.beast.until || S.duel)) {
    note(S, '야수가 물러났다');
    S.beast = null;
    S.beastNext = S.round + BEAST_GAP;
  }
  if (!S.beast && !S.duel && S.round >= (S.beastNext || BEAST_FIRST)) {
    const hp = BEAST_HP * list(S.alive).length;
    S.beast = { hp, max: hp, until: S.round + BEAST_STAY - 1, born: S.round };
    note(S, '야수가 풀렸다!');
  }
  if (S.beast) {
    const prey = S.tyrant || (alive(S, S.grudgeTop) ? S.grudgeTop : null) || [...list(S.alive)].sort((a, b) => (S.hp[b] || 0) - (S.hp[a] || 0))[0];
    S.beast = { ...S.beast, t: prey, dmg: Math.round(BEAST_DMG * rageOf(S.round) * (whimOf(S) === 'frenzy' ? 1.5 : 1)) };
  }
  Object.assign(S, { ready: {}, ready2: {}, atk: null, left: null, rs: null, pick: null, loot: null, grudge: null });
  Object.assign(ctx.secret, { plans: {}, defs: {}, readyAt: {}, atk: {}, played: {} });
  if (S.whim) { // 룰렛이 도는 동안은 아무도 못 움직인다
    Object.assign(S, { phase: 'whim', phaseEndsAt: now + WHIM_TIME });
    return true;
  }
  return beginAttack(ctx, now);
}

function beginAttack(ctx, now) {
  const S = ctx.state;
  const k = whimOf(S);
  if (k === 'arms') for (const id of list(S.alive)) for (let i = 0; i < 2; i++) give(ctx, id, 1, drawCard(Math.random, 'w'));
  if (k === 'peek') S.whim = { ...S.whim, hands: Object.fromEntries(list(S.alive).map(id => [id, handOf(ctx, id).map(c => c.k)])) };
  Object.assign(S, { phase: 'attack', phaseAt: now, phaseEndsAt: now + ATTACK_TIME });
  return true;
}

// 공격 계획 읽기 (방장만 아는 손패와 맞춰 본다)
function readPlan(ctx, id, data) {
  const S = ctx.state;
  let t = data?.t === BEAST ? (S.beast ? BEAST : null) : alive(S, data?.t) && data.t !== id ? data.t : null;
  const lock = lockOf(S, id);
  if (lock && t && t !== lock) t = lock; // 도발 · 공개 처형: 그 사람만 겨눌 수 있다
  const u = !!data?.u && !!S.ults?.[id] && furyOf(S, id) >= FURY_MAX && !S.charge?.[id]; // 필살기 준비: 이 턴엔 무기를 못 낸다
  const { cards, left } = affordable(handOf(ctx, id), data?.c, energyOf(S, id), 'a', !!t && !u);
  return { t, cards, left, u };
}

// 낸 도구가 바로 일으키는 일 (붕대 · 피의 의식 · 각성제)
function useTools(ctx, id, cards) {
  const S = ctx.state;
  for (const c of cards) {
    const d = CARDS[c.k];
    if (d.type !== 't') continue;
    if (d.hp) S.hp[id] = Math.max(1, S.hp[id] - d.hp);
    if (d.heal) S.hp[id] = Math.min(HP_MAX, S.hp[id] + d.heal);
    if (c.k === 'stim') setStatus(S, id, 'tired', S.round + 1);
  }
}

function reveal(ctx, now) {
  const S = ctx.state;
  const at = ctx.secret.readyAt || {};
  const seat = id => list(S.order).indexOf(id);
  // 타격 순서 = 준비 완료를 누른 순서 (안 누른 사람은 그 뒤에 자리 순)
  const order = [...list(S.alive)].sort((a, b) => (at[a] ?? Infinity) - (at[b] ?? Infinity) || seat(a) - seat(b));
  const first = at[order[0]] != null ? order[0] : null;
  const plans = {};
  for (const id of order) plans[id] = readPlan(ctx, id, ctx.secret.plans?.[id]);
  const count = {};
  for (const id of order) if (plans[id].t && plans[id].cards.some(c => CARDS[c.k].type === 'w')) count[plans[id].t] = (count[plans[id].t] || 0) + 1;
  // 망령의 원한: 탈락한 사람들이 지목한 사람은 이번 턴 맞을 때마다 더 아프다 (공개와 함께 드러난다)
  const grudge = {};
  for (const g of list(S.order)) {
    const t = !alive(S, g) && S.dead?.[g] ? ctx.secret.grudges?.[g] : null;
    if (t && alive(S, t)) grudge[t] = (grudge[t] || 0) + 1;
  }
  S.grudge = grudge;
  S.grudgeTop = Object.keys(grudge).sort((a, b) => grudge[b] - grudge[a])[0] || null;
  const blind = whimOf(S) === 'blind';
  const atk = {};
  const hidden = {};
  const left = {};
  const attacked = {};
  const played = {};
  const aims = {};
  for (const id of order) {
    const p = plans[id];
    const keys = p.cards.map(c => c.k);
    const A = attackOf(S, id, p.t, keys, { plans, count, first, grudge });
    setHand(ctx, id, handOf(ctx, id).filter(c => !p.cards.includes(c)));
    useTools(ctx, id, p.cards);
    left[id] = p.left;
    played[id] = p.cards.length;
    const n = order.indexOf(id) + 1;
    const tools = keys.filter(k => CARDS[k].type === 't');
    if (A && !p.u) attacked[id] = true;
    aims[id] = p.t;
    const mine = { n, tools };
    if (keys.includes('taunt') && p.t && p.t !== BEAST) { // 도발: 겨눈 사람은 다음 턴에 나만 겨눌 수 있다
      setStatus(S, p.t, 'taunt', { by: id, r: S.round + 1 });
      mine.tt = p.t;
    }
    if (p.u) {
      S.charge = { ...(S.charge || {}), [id]: { k: S.ults[id], at: S.round } };
      atk[id] = { ...mine, cast: S.ults[id] };
      continue;
    }
    // 가려진 공격: 연막 · 그림자 망토 · 눈가리개(관중의 변덕). 결과 때 드러난다
    const veil = !A ? null : keys.includes('smoke') || has(S, id, 'shadow') ? 'smoke' : blind ? 'blind' : null;
    if (veil) {
      hidden[id] = { ...A, n, veil };
      atk[id] = { ...mine, smoke: true, ...(veil === 'blind' ? { bl: 1 } : {}) };
    } else atk[id] = A ? { ...A, ...mine } : mine;
  }
  if (first) inc(S, 'firsts', first);
  S.attacked = attacked;
  Object.assign(S, { atk, left, phase: 'reveal', phaseEndsAt: now + REVEAL_TIME });
  Object.assign(ctx.secret, { atk: hidden, played, plans: {}, aims });
  return true;
}

// 공개된 공격 중 나를 노린 것이 있는 사람들 (이 사람들이 방어를 정할 때까지 기다린다)
const targeted = S => (whimOf(S) === 'blind' ? list(S.alive) : list(S.alive).filter(id => S.beast?.t === id || Object.values(S.atk || {}).some(a => a.t === id)));

function startDefend(ctx, now) {
  const S = ctx.state;
  if (whimOf(S) === 'bare') return resolve(ctx, now); // 맨몸: 방어 단계가 없다
  const any = !!S.beast || Object.values(S.atk || {}).some(a => a.t || a.smoke || a.cast) || Object.values(S.charge || {}).some(Boolean);
  if (!any) return resolve(ctx, now); // 아무도 안 때렸다
  const smoke = Object.values(S.atk || {}).some(a => a.smoke);
  Object.assign(S, { phase: 'defend', phaseEndsAt: now + DEFEND_TIME, minEndsAt: now + (smoke ? 3500 : 1200), ready2: {} });
  return true;
}

function goDown(ctx, id, by, how, ev) {
  const S = ctx.state;
  S.hp[id] = 0;
  inc(S, 'lives', id, -1);
  if (by && by !== id) {
    inc(S, 'kills', by);
    if (S.revenge?.[by] === id) { // 복수 성공
      inc(S, 'revenges', by);
      S.revenge = { ...S.revenge, [by]: null };
    }
  }
  if (by && by !== id && S.tyrant === id && alive(S, by)) { // 폭군을 쓰러뜨렸다: 현상금으로 유물 하나
    const opts = shuffle(Object.keys(RELICS).filter(r => RELICS[r].tier !== 1 && !has(S, by, r))).slice(0, 3);
    if (opts.length) S.loot = [...list(S.loot), { by, from: '@bounty', opts }];
    S.bountyBase = { ...(S.bountyBase || {}), [id]: S.kills?.[id] || 0 };
    S.tyrant = null;
    note(S, `${ctx.nameOf(by)} 폭군 사냥! 현상금`);
    ev.bounty = 1;
  }
  if (by && by !== id && alive(S, by) && whimOf(S) === 'prize') { // 관중의 포상: 이번 턴에 쓰러뜨리면 유물 하나
    const opts = shuffle(Object.keys(RELICS).filter(r => RELICS[r].tier !== 1 && !has(S, by, r))).slice(0, 3);
    if (opts.length) S.loot = [...list(S.loot), { by, from: '@crowd', opts }];
    ev.prize = 1;
  }
  if ((S.lives[id] || 0) > 0) {
    S.down = { ...(S.down || {}), [id]: true };
    if (by && by !== id) {
      S.revenge = { ...(S.revenge || {}), [id]: by };
      ctx.secret.spoils = { ...(ctx.secret.spoils || {}), [by]: (ctx.secret.spoils?.[by] || 0) + (has(S, by, 'spoils') ? 4 : 2) };
    }
    note(S, `${ctx.nameOf(id)} 쓰러짐${by && by !== id ? ` ← ${ctx.nameOf(by)}` : ''}`);
    ev.dn = 1;
    return;
  }
  S.alive = list(S.alive).filter(x => x !== id);
  S.outSeq = (S.outSeq || 0) + 1;
  S.outAt = { ...(S.outAt || {}), [id]: S.outSeq };
  S.dead = { ...(S.dead || {}), [id]: by && by !== id ? by : '-' };
  if (by && by !== id) {
    ctx.kill(by, id, how);
    const opts = relicsOf(S, id).filter(r => !has(S, by, r) && r !== 'phoenix');
    if (opts.length) S.loot = [...list(S.loot), { by, from: id, opts: shuffle(opts).slice(0, 4) }];
  }
  // 유산: 탈락한 사람은 남은 유물 하나를 살아 있는 아무에게나 물려준다 (약탈이 끝난 뒤에 넘어간다)
  const keep = relicsOf(S, id).filter(r => r !== 'phoenix');
  if (keep.length && list(S.alive).length >= 2) S.loot = [...list(S.loot), { by: id, kind: 'will', from: id, opts: keep.slice(0, 7) }];
  note(S, `${ctx.nameOf(id)} 탈락${by && by !== id ? ` ← ${ctx.nameOf(by)}` : ''}`);
  ev.dn = 2;
}

// 방어 단계에 낸 카드 읽기
function readDef(ctx, id) {
  const S = ctx.state;
  const { cards } = affordable(handOf(ctx, id), ctx.secret.defs?.[id]?.c, S.left?.[id] || 0, 'd');
  return cards;
}

function resolve(ctx, now) {
  const S = ctx.state;
  const rs = [];
  const A = { ...(S.atk || {}) };
  for (const [id, a] of Object.entries(ctx.secret.atk || {})) A[id] = { ...a, tools: A[id]?.tools, smoke: a.veil !== 'blind' }; // 가려졌던 공격도 이제 드러난다
  const downNow = new Set();
  const isUp = id => alive(S, id) && !downNow.has(id);
  const scale = scaleOf(S);
  const faced = {}; // 이번 턴에 공격을 받은 사람 (역습 태세: 공격받고도 안 맞았는가)
  // 1) 방어: 낸 카드를 모은다
  const D = {};
  const hitBy = {};
  const tookNow = {};
  let beastKiller = null;
  for (const id of list(S.alive)) {
    const cards = readDef(ctx, id);
    if (cards.length) {
      setHand(ctx, id, handOf(ctx, id).filter(c => !cards.includes(c)));
      useTools(ctx, id, cards);
      ctx.secret.played = { ...(ctx.secret.played || {}), [id]: (ctx.secret.played?.[id] || 0) + cards.length };
    }
    const d = { block: S.carry?.[id] || 0, dodge: 0, reflect: 0, redirect: 0, thorns: 0, counter: 0, callus: has(S, id, 'callus') };
    for (const c of cards) {
      const def = CARDS[c.k];
      if (def.type !== 'd') continue;
      if (def.block) d.block += def.block + (has(S, id, 'padded') ? 2 : 0) + (has(S, id, 'guard') ? 3 : 0);
      if (def.dodge) d.dodge += 1;
      if (def.reflect) d.reflect += 1;
      if (def.redirect) d.redirect += 1;
      if (def.thorns) d.thorns += def.thorns;
      if (def.counter) d.counter += def.counter;
      if (def.undying) d.undying = true;
      if (def.perfect) d.perfect = true;
    }
    if (has(S, id, 'cloak') && !S.attacked?.[id]) d.block += 6;
    D[id] = d;
    const keys = cards.map(c => c.k);
    if (keys.length || d.block) rs.push({ k: 'def', to: id, cards: keys, b: d.block });
  }
  // 2) 특수 방어 배정: 나를 노린 공격을 센 순으로 → 반사 · 회피 · 인간 방패
  const special = {};
  const top = {};
  for (const id of list(S.alive)) {
    const inc_ = Object.keys(A).filter(a => A[a].t === id && A[a].dmg > 0).sort((a, b) => A[b].dmg - A[a].dmg || A[a].n - A[b].n);
    top[id] = inc_[0] || null;
    const soft = inc_.filter(a => !A[a].fx?.sure); // 사슬 낫은 피하지도 되돌리지도 못한다
    let i = 0;
    for (const kind of ['reflect', 'dodge', 'redirect']) for (let k = 0; k < D[id][kind] && i < soft.length; k++) special[soft[i++]] = kind;
  }
  // 양옆 자리: 서 있는 사람 중 제일 가까운 좌우 한 명씩 (때린 사람 쪽으로는 안 튄다)
  const sides = (id, not) => {
    const o = list(S.order);
    const i = o.indexOf(id);
    const out = [];
    for (const dir of [1, -1]) {
      for (let k = 1; k < o.length; k++) {
        const x = o[(((i + dir * k) % o.length) + o.length) % o.length];
        if (x === id) break;
        if (!isUp(x)) continue;
        if (x !== not && !out.includes(x)) out.push(x);
        break;
      }
    }
    return out;
  };
  // 옆자리 사람 (살아서 서 있는 사람 중에, 때린 사람은 빼고)
  const neighbor = (id, not) => {
    const o = list(S.order);
    const i = o.indexOf(id);
    for (let k = 1; k < o.length; k++) {
      for (const j of [i + k, i - k]) {
        const x = o[((j % o.length) + o.length) % o.length];
        if (x !== id && x !== not && isUp(x)) return x;
      }
    }
    return null;
  };
  // 피해 주기. 쓰러지면 true
  const hurt = (id, dmg, by, how, ev) => {
    if (dmg <= 0 || !isUp(id)) return false;
    S.hp[id] -= dmg;
    inc(S, 'took', id, dmg);
    tookNow[id] = (tookNow[id] || 0) + dmg;
    if (!S.charge?.[id]) addFury(S, id, dmg * FURY_TAKE);
    if (by && by !== id) {
      inc(S, 'dealt', by, dmg);
      if (!S.charge?.[by]) addFury(S, by, dmg * FURY_DEAL);
      hitBy[id] = [...new Set([...(hitBy[id] || []), by])];
    }
    if (S.hp[id] <= 0 && D[id]?.undying) { // 불사의 약: 이번 턴엔 안 쓰러진다
      S.hp[id] = 1;
      ev.und = 1;
    }
    if (S.hp[id] > 0) return false;
    downNow.add(id);
    goDown(ctx, id, by, how, ev);
    return true;
  };
  // 여럿을 한꺼번에 때리는 것(필살기 · 번개 · 화약통): 남은 방어도가 막아 준다
  const blast = (to, raw, by, how, hits, pierce = false) => {
    if (!isUp(to)) return 0;
    const d = D[to];
    const abs = pierce ? 0 : Math.min(raw, d.block);
    d.block -= abs;
    const h = { to, d: raw - abs, a: abs };
    if (abs) inc(S, 'blocked', to, abs);
    if (h.d > 0) hurt(to, h.d, by, how, h);
    hits.push(h);
    return h.d;
  };
  // 3) 준비한 순서대로 타격
  const strikers = Object.keys(A).filter(a => A[a].t).sort((a, b) => A[a].n - A[b].n);
  const dealtNow = {};
  // 번개(양옆) · 화약통(나머지 모두): 본 공격이 들어간 뒤에 튄다
  const spread = (a, t, at) => {
    for (const [e, how] of [['bolt', '⚡ 번개'], ['keg', '💥 화약통']]) {
      const raw = Math.round((e === 'bolt' ? at.fx?.splash || 0 : at.fx?.blast || 0) * scale);
      if (!raw || !isUp(a)) continue;
      const who = e === 'bolt' ? sides(t, a) : list(S.alive).filter(x => x !== a && x !== t && isUp(x));
      if (!who.length) continue;
      const hits = [];
      for (const x of who) {
        faced[x] = true;
        dealtNow[a] = (dealtNow[a] || 0) + blast(x, raw, a, how, hits);
      }
      rs.push({ k: 'area', by: a, e, hits });
    }
  };
  for (const a of strikers) {
    const at = A[a];
    if (!isUp(a)) { rs.push({ k: 'cancel', by: a, to: at.t }); continue; } // 먼저 쓰러졌다: 공격이 안 나간다
    if (at.t === BEAST) { // 야수를 때린다 (막타를 친 사람이 전리품을 고른다)
      const B = S.beast;
      if (!B || B.hp <= 0) { rs.push({ k: 'whiff', by: a, to: BEAST }); continue; }
      if (at.tags?.includes('miss')) { rs.push({ k: 'miss', by: a, to: BEAST }); continue; }
      const d = Math.round(at.dmg * (has(S, a, 'hunter') ? 2 : 1));
      const dealt = Math.min(d, B.hp);
      S.beast = { ...B, hp: B.hp - dealt, dealt: { ...(B.dealt || {}), [a]: (B.dealt?.[a] || 0) + dealt } };
      dealtNow[a] = (dealtNow[a] || 0) + dealt;
      addFury(S, a, dealt * FURY_DEAL);
      const ev = { k: 'bhit', by: a, to: BEAST, d: dealt };
      if (S.beast.hp <= 0) { ev.dn = 3; beastKiller = a; }
      rs.push(ev);
      continue;
    }
    let t = at.t;
    if (!isUp(t)) { rs.push({ k: 'whiff', by: a, to: t }); continue; }     // 이미 쓰러진 상대
    if (at.tags?.includes('miss')) { rs.push({ k: 'miss', by: a, to: t }); continue; }
    faced[t] = true;
    const sp = special[a];
    if (sp === 'dodge') { rs.push({ k: 'dodge', by: a, to: t }); continue; }
    const tags = list(at.tags).filter(x => x === 'crit' || x === 'crowd');
    if (sp === 'reflect') {
      const ev = { k: 'reflect', by: a, to: t, d: at.dmg };
      hurt(a, at.dmg, t, '🪞 반사', ev);
      rs.push(ev);
      continue;
    }
    let from = null;
    if (sp === 'redirect') {
      const n = neighbor(t, a);
      if (n) { from = t; t = n; }
    }
    const d = D[t];
    let dmg = at.dmg;
    let abs = 0;
    if (d.block > 0) {
      abs = Math.min(dmg, at.fx?.pierce ? Math.floor(d.block / 2) : d.block);
      d.block -= abs;
      dmg -= abs;
    }
    if (dmg > 0 && d.callus) {
      d.callus = false;
      const c = Math.min(3, dmg);
      dmg -= c;
      abs += c;
    }
    if (abs) inc(S, 'blocked', t, abs);
    const ev = { k: 'hit', by: a, to: t, d: dmg, a: abs, tags };
    if (from) ev.fr = from;
    if (at.smoke) ev.sm = 1;
    if (dmg > 0) {
      dealtNow[a] = (dealtNow[a] || 0) + dmg;
      if (at.fx?.bleed) setStatus(S, t, 'bleed', { n: at.fx.bleed, by: a });
      if (at.fx?.vuln && !has(S, t, 'calm')) setStatus(S, t, 'vuln', S.round + 1);
      if (at.fx?.weak && !has(S, t, 'calm')) setStatus(S, t, 'weak', S.round + 1);
      if (at.fx?.stun) setStatus(S, t, 'stun', S.round + 1);
      if (at.fx?.steal) { // 갈고리: 손패 한 장을 뺏어 온다
        const theirs = handOf(ctx, t);
        const c = theirs[Math.floor(Math.random() * theirs.length)];
        if (c) {
          setHand(ctx, t, theirs.filter(x => x !== c));
          give(ctx, a, 1, c.k);
          ev.st = 1;
        }
      }
      if (has(S, a, 'vamp')) S.hp[a] = Math.min(HP_MAX, S.hp[a] + Math.ceil(dmg * 0.2));
      hurt(t, dmg, a, at.smoke ? '💨 기습' : '⚔️ 처치', ev);
    }
    rs.push(ev);
    spread(a, t, at);
    // 되받아치는 것: 가시 갑옷 · 가시 피부 · 받아치기 (피했거나 되돌린 공격엔 없다)
    const back = d.thorns + (dmg > 0 && has(S, t, 'thorn') ? 2 : 0) + (d.counter && top[at.t] === a && !from ? d.counter : 0)
      + (dmg > 0 && isFort(S, t) ? Math.round(dmg * 0.3) : 0);
    if (back > 0 && isUp(a)) {
      const ev2 = { k: 'thorn', by: t, to: a, d: back };
      hurt(a, back, t, '🌵 가시', ev2);
      rs.push(ev2);
    }
  }
  // 3.5) 필살기: 지난 턴에 준비한 사람들. 이번 턴에 많이 맞았으면 끊기고, 아니면 여기서 터진다
  for (const id of list(S.order)) {
    const c = S.charge?.[id];
    if (!c || c.at >= S.round) continue;
    S.charge = { ...S.charge, [id]: null };
    if (!isUp(id)) { S.fury = { ...(S.fury || {}), [id]: 0 }; continue; }
    if ((tookNow[id] || 0) >= BREAK) { // 끊겼다: 투지 절반만 남는다
      S.fury = { ...(S.fury || {}), [id]: FURY_MAX / 2 };
      inc(S, 'breaks', id);
      rs.push({ k: 'break', to: id, u: c.k });
      note(S, `${ctx.nameOf(id)}의 ${ULTS[c.k].name} 끊김!`);
      continue;
    }
    S.fury = { ...(S.fury || {}), [id]: 0 };
    inc(S, 'ultsFired', id);
    const foes = list(S.alive).filter(x => x !== id && isUp(x));
    const aim = ctx.secret.aims?.[id];
    const hits = [];
    const ev = { k: 'ult', by: id, u: c.k, hits };
    const how = `💥 ${ULTS[c.k].name}`;
    if (c.k === 'meteor') for (const x of foes) blast(x, Math.round(14 * scale), id, how, hits);
    if (c.k === 'feast') {
      let got = 0;
      for (const x of foes) got += blast(x, Math.round(8 * scale), id, how, hits);
      if (isUp(id)) S.hp[id] = Math.min(HP_MAX, S.hp[id] + got);
      ev.heal = got;
    }
    if (c.k === 'exec') {
      const t = foes.includes(aim) ? aim : [...foes].sort((a, b) => S.hp[a] - S.hp[b])[0];
      if (t) {
        const kill = S.hp[t] <= HP_MAX * 0.3;
        blast(t, kill ? S.hp[t] : Math.round(30 * scale), id, how, hits, kill);
      }
    }
    if (c.k === 'fort') setStatus(S, id, 'fort', S.round + 3);
    if (c.k === 'warp') setStatus(S, id, 'warp', S.round + 1);
    if (c.k === 'rob') {
      const can = x => relicsOf(S, x).filter(r => r !== 'phoenix' && !has(S, id, r));
      const t = foes.includes(aim) && can(aim).length ? aim : [...foes].sort((a, b) => can(b).length - can(a).length)[0];
      const r = t ? shuffle(can(t))[0] : null;
      if (r) {
        S.relics = { ...S.relics, [t]: relicsOf(S, t).filter(x => x !== r) };
        gain(S, id, r);
        ev.to = t;
        ev.r = r;
      }
    }
    S.fury = { ...(S.fury || {}), [id]: 0 }; // 필살기로 준 피해로는 투지가 안 찬다
    rs.push(ev);
    note(S, `${ctx.nameOf(id)}의 ${ULTS[c.k].name}!`);
  }
  // 3.7) 야수: 잡혔으면 전리품, 살아 있으면 표적을 문다 (숨통은 안 끊는다: 체력 1은 남긴다)
  if (beastKiller) {
    const B = S.beast;
    inc(S, 'beasts', beastKiller);
    if (alive(S, beastKiller)) {
      const free = Object.keys(RELICS).filter(r => !has(S, beastKiller, r));
      const best = free.filter(r => RELICS[r].tier === 3);
      const opts = shuffle(best.length ? best : free).slice(0, 3);
      if (opts.length) S.loot = [...list(S.loot), { by: beastKiller, from: BEAST, opts }];
    }
    const [topId] = Object.entries(B.dealt || {}).filter(([id]) => id !== beastKiller && alive(S, id)).sort((a, b) => b[1] - a[1])[0] || [];
    if (topId) { // 제일 많이 깎은 사람은 희귀 유물
      const r = shuffle(Object.keys(RELICS).filter(x => (RELICS[x].tier === 2 || RELICS[x].tier === 0) && !has(S, topId, x)))[0];
      if (r && gain(S, topId, r)) rs.push({ k: 'gift', to: topId, r });
    }
    note(S, `${ctx.nameOf(beastKiller)} 야수 사냥!`);
    S.beast = null;
    S.beastNext = S.round + BEAST_GAP;
  } else if (S.beast && isUp(S.beast.t)) {
    const t = S.beast.t;
    const d = D[t];
    const abs = Math.min(S.beast.dmg, d.block);
    d.block -= abs;
    const dmg = Math.max(0, Math.min(S.beast.dmg - abs, S.hp[t] - 1));
    S.hp[t] -= dmg;
    faced[t] = true;
    if (dmg) {
      addFury(S, t, dmg * FURY_TAKE);
      tookNow[t] = (tookNow[t] || 0) + dmg;
    }
    if (abs) inc(S, 'blocked', t, abs);
    rs.push({ k: 'bite', to: t, d: dmg, a: abs });
  }
  // 4) 출혈 (독술사가 낸 출혈은 2배)
  for (const id of list(S.alive)) {
    const b = statusOf(S, id).bleed;
    if (!b?.n || !isUp(id)) continue;
    setStatus(S, id, 'bleed', b.n > 1 ? { n: b.n - 1, by: b.by } : null);
    const bd = has(S, b.by, 'poison') ? 6 : 3;
    const ev = { k: 'bleed', to: id, d: bd, by: b.by };
    hurt(id, bd, b.by, '🩸 출혈', ev);
    rs.push(ev);
  }
  // 5) 역습 태세: 공격을 받고도 한 대도 안 맞았으면 다음 턴 기력 +1
  for (const id of list(S.alive)) {
    if (!D[id]?.perfect || !isUp(id) || !faced[id] || tookNow[id]) continue;
    setStatus(S, id, 'boost', S.round + 1);
    rs.push({ k: 'perfect', to: id });
  }
  S.hitBy = hitBy;
  ctx.secret.dealt = dealtNow;
  ctx.secret.blockLeft = Object.fromEntries(Object.entries(D).map(([id, d]) => [id, d.block]));
  const scenes = rs.filter(e => e.k !== 'def').length;
  const step = Math.max(350, Math.min(STRIKE_MS, Math.floor(RESOLVE_CAP / Math.max(1, scenes))));
  S.tyrant = tyrantOf(S);
  const big = rs.some(e => e.dn || list(e.hits).some(x => x.dn)) ? 900 : 0;
  Object.assign(S, { rs, rsNo: (S.rsNo || 0) + 1, rsStep: step, phase: 'resolve', phaseEndsAt: now + 700 + scenes * step + big + rs.filter(e => e.k === 'ult').length * 700 + rs.filter(e => e.k === 'area').length * 300 });
  ctx.secret.atk = {};
  return true;
}

// 결과 연출이 끝난 뒤: 일으켜 세우기 · 카드 뽑기 · 다음으로
function afterResolve(ctx, now) {
  const S = ctx.state;
  if (list(S.alive).length <= 1) return finish(ctx);
  for (const id of Object.keys(S.down || {})) { // 목숨이 남은 사람은 일어난다
    if (!alive(S, id)) continue;
    S.hp[id] = REVIVE_HP;
    S.status = { ...(S.status || {}), [id]: {} };
  }
  S.down = {};
  const carry = {};
  for (const id of list(S.alive)) {
    const idle = !(ctx.secret.played?.[id] > 0);
    if (idle) S.hp[id] = Math.min(HP_MAX, S.hp[id] + 2); // 숨 고르기
    if (has(S, id, 'medic')) S.hp[id] = Math.min(HP_MAX, S.hp[id] + 2);
    const more = (idle ? 1 : 0) + (has(S, id, 'looter') && ctx.secret.dealt?.[id] > 0 ? 1 : 0) + (ctx.secret.spoils?.[id] || 0);
    give(ctx, id, DRAW + more);
    if (has(S, id, 'guard')) carry[id] = Math.floor((ctx.secret.blockLeft?.[id] || 0) / 2);
  }
  S.carry = carry;
  ctx.secret.spoils = {};
  if (list(S.loot).length) {
    Object.assign(S, { phase: 'loot', phaseEndsAt: now + LOOT_TIME });
    return true;
  }
  return nextStep(ctx, now);
}

function nextStep(ctx, now) {
  const S = ctx.state;
  S.loot = null;
  if (S.round >= ULT_ROUND && !S.ultsGiven) return startUltPick(ctx, now);
  return S.round % PICK_EVERY === 0 ? startPick(ctx, now, S.round / PICK_EVERY) : startRound(ctx, now);
}

function takeLoot(ctx, i, relic) {
  const S = ctx.state;
  const L = list(S.loot);
  const it = L[i];
  if (!it || it.got) return false;
  const opts = list(it.opts);
  const r = opts.includes(relic) ? relic : opts[Math.floor(Math.random() * opts.length)];
  if (r) gain(S, it.by, r);
  if (r && S.dead?.[it.from]) S.relics = { ...S.relics, [it.from]: relicsOf(S, it.from).filter(x => x !== r) }; // 뺏긴 건 유산으로 못 남긴다
  S.loot = L.map((x, k) => (k === i ? { ...x, got: r || '-' } : x));
  if (r) note(S, `${ctx.nameOf(it.by)} ${it.from === BEAST ? '야수의 전리품' : it.from === '@bounty' ? '현상금' : it.from === '@crowd' ? '포상' : '약탈'}: ${RELICS[r].name}`);
  return true;
}

// 유산 넘기기: 약탈이 다 끝난 뒤, 탈락한 사람이 고른 유물을 고른 사람에게 (안 골랐으면 쓰러뜨린 사람 말고 아무에게나)
function settleWills(ctx) {
  const S = ctx.state;
  const out = [];
  for (const it of list(S.loot).filter(x => x.kind === 'will')) {
    const dead = it.by;
    const w = ctx.secret.wills?.[dead] || {};
    const live = list(S.alive);
    const to = live.includes(w.to) ? w.to : shuffle(live.filter(x => x !== S.dead?.[dead]))[0] || live[0];
    if (!to) continue;
    const can = relicsOf(S, dead).filter(r => r !== 'phoenix' && !has(S, to, r));
    const r = can.includes(w.r) ? w.r : [...can].sort((a, b) => RELICS[b].tier - RELICS[a].tier)[0];
    if (!r) continue;
    S.relics = { ...S.relics, [dead]: relicsOf(S, dead).filter(x => x !== r) };
    gain(S, to, r);
    out.push({ from: dead, to, r });
    note(S, `${ctx.nameOf(dead)}의 유산 → ${ctx.nameOf(to)}: ${RELICS[r].name}`);
  }
  if (out.length) Object.assign(S, { wills: out, willNo: (S.willNo || 0) + 1 });
  ctx.secret.wills = {};
}

function finish(ctx) {
  const S = ctx.state;
  const ids = list(S.roster || ctx.roster).map(p => p.id);
  const at = id => (alive(S, id) ? Infinity : S.outAt?.[id] ?? -1);
  const standings = Object.fromEntries(ids.map(id => [id, ids.length - ids.filter(o => at(o) > at(id)).length]));
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  const top = obj => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])[0] || [];
  const win = list(S.alive)[0] || null;
  if (win) add(win, (S.lives?.[win] || 0) === 1 ? '🔥 한 목숨으로 우승' : '🏆 최후의 검투사');
  const [killer, kills] = top(S.kills);
  if (kills >= 2) add(killer, `💀 학살자 (${kills}번 쓰러뜨림)`);
  const [wall, b] = top(S.blocked);
  if (b >= 25) add(wall, `🛡️ 철벽 (${b} 막음)`);
  const [fast, f] = top(S.firsts);
  if (f >= 3) add(fast, `⚡ 선빵 (${f}번 먼저)`);
  const [rev, r] = top(S.revenges);
  if (r >= 1) add(rev, '🩸 복수 성공');
  const [hunter, bn] = top(S.beasts);
  if (bn >= 1) add(hunter, `🐗 야수 사냥꾼${bn > 1 ? ` (${bn}마리)` : ''}`);
  const [breaker, br] = top(S.breaks);
  if (br >= 1) add(breaker, `😵 필살기 끊김 (${br}번)`);
  const [bag, t] = top(S.took);
  if (t >= HP_MAX && bag !== win) add(bag, `🥊 샌드백 (${t} 맞음)`);
  Object.assign(S, { standings, titles, winner: win, phase: 'final', over: true, loot: null });
  return true;
}

/* ───────── 게임 모듈 (arena.js가 묶어서 내보낸다) ───────── */

export function setup(ctx, prev) {
  const ids = shuffle(ctx.roster.map(p => p.id));
  return {
    phase: 'intro',
    phaseEndsAt: ctx.now() + INTRO_TIME,
    again: !!prev,
    order: ids, // 앉은 순서
    alive: [...ids],
    hp: Object.fromEntries(ids.map(id => [id, HP_MAX])),
    lives: Object.fromEntries(ids.map(id => [id, LIVES])),
    cards: Object.fromEntries(ids.map(id => [id, 0])),
    round: 0,
  };
}

export function onInput(ctx, { pid, type, data = {} }) {
  const S = ctx.state;
  const now = ctx.now();
  if (S.over) return false;
  if (type === 'grudge') { // 망령(탈락한 사람)의 원한: 한 명을 지목해 둔다. 공개 때 드러나고, 그 사람이 살아 있는 동안 이어진다
    if (alive(S, pid) || !S.dead?.[pid]) return false;
    ctx.secret.grudges = { ...(ctx.secret.grudges || {}), [pid]: alive(S, data.t) ? data.t : null };
    return false;
  }
  if (type === 'will') { // 유산: 내 유물 하나를 살아 있는 한 명에게
    if (S.phase !== 'loot' || alive(S, pid)) return false;
    const L = list(S.loot);
    const i = L.findIndex(x => x.kind === 'will' && x.by === pid && !x.set);
    if (i < 0 || !alive(S, data.to) || !list(L[i].opts).includes(data.relic)) return false;
    ctx.secret.wills = { ...(ctx.secret.wills || {}), [pid]: { r: data.relic, to: data.to } };
    S.loot = L.map((x, k) => (k === i ? { ...x, set: true } : x));
    return true;
  }
  if (!alive(S, pid)) return false;
  if (type === 'pick') { // 유물 고르기: 받은 3개 중 하나 (공개는 다 같이)
    const P = S.pick;
    if (S.phase !== 'pick' || !P || P.shown || data.no !== P.no || P.done?.[pid]) return false;
    if (!list(P.offers?.[pid]).includes(data.relic)) return false;
    ctx.secret.picks = { ...(ctx.secret.picks || {}), [pid]: data.relic };
    S.pick = { ...P, done: { ...(P.done || {}), [pid]: true } };
    return true;
  }
  if (type === 'plan') { // 공격 계획: 겨눈 사람 + 낼 카드. ready면 준비 완료 (누른 시각이 타격 순서)
    if (S.phase !== 'attack' || data.round !== S.round || S.ready?.[pid]) return false;
    ctx.secret.plans = { ...(ctx.secret.plans || {}), [pid]: { t: data.t || null, c: list(data.c), u: !!data.u } };
    if (!data.ready) return false;
    const at = Math.max(S.phaseAt || 0, Math.min(now, Number(data.at) || now));
    ctx.secret.readyAt = { ...(ctx.secret.readyAt || {}), [pid]: at };
    S.ready = { ...(S.ready || {}), [pid]: true };
    return true;
  }
  if (type === 'def') { // 방어: 낼 카드. ready면 정했다
    if (S.phase !== 'defend' || data.round !== S.round || S.ready2?.[pid]) return false;
    ctx.secret.defs = { ...(ctx.secret.defs || {}), [pid]: { c: list(data.c) } };
    if (!data.ready) return false;
    S.ready2 = { ...(S.ready2 || {}), [pid]: true };
    return true;
  }
  if (type === 'loot') { // 약탈: 탈락시킨 사람의 유물 하나
    if (S.phase !== 'loot') return false;
    const i = list(S.loot).findIndex(x => x.kind !== 'will' && x.by === pid && !x.got);
    return i >= 0 && takeLoot(ctx, i, data.relic);
  }
  return false;
}

export function tick(ctx) {
  const S = ctx.state;
  const now = ctx.now();
  const on = id => ctx.isOnline(id);
  if (S.phase === 'intro') {
    if (now < S.phaseEndsAt) return false;
    deal(ctx);
    return startPick(ctx, now, 0);
  }
  if (S.phase === 'pick') {
    if (!S.pick?.shown) { // 다들(자리에 있는 사람) 골랐거나 시간이 끝나면 공개
      const waiting = list(S.alive).some(id => !S.pick?.done?.[id] && on(id));
      return (!waiting || now >= S.phaseEndsAt + GRACE) && revealPicks(ctx, now);
    }
    return now >= S.phaseEndsAt && startRound(ctx, now);
  }
  if (S.phase === 'whim') return now >= S.phaseEndsAt && beginAttack(ctx, now);
  if (S.phase === 'attack') {
    const waiting = list(S.alive).some(id => !S.ready?.[id] && on(id));
    return (!waiting || now >= S.phaseEndsAt + GRACE) && reveal(ctx, now);
  }
  if (S.phase === 'reveal') return now >= S.phaseEndsAt && startDefend(ctx, now);
  if (S.phase === 'defend') {
    const waiting = targeted(S).some(id => !S.ready2?.[id] && on(id));
    if (waiting ? now < S.phaseEndsAt + GRACE : now < (S.minEndsAt || 0)) return false;
    return resolve(ctx, now);
  }
  if (S.phase === 'resolve') return now >= S.phaseEndsAt && afterResolve(ctx, now);
  if (S.phase === 'loot') {
    const L = list(S.loot);
    const waiting = L.some(x => (x.kind === 'will' ? !x.set : !x.got) && on(x.by));
    if (waiting && now < S.phaseEndsAt + GRACE) return false;
    L.forEach((x, i) => { if (x.kind !== 'will' && !x.got) takeLoot(ctx, i, null); });
    settleWills(ctx);
    return nextStep(ctx, now);
  }
  return false;
}

/* ───────── 봇: 자기 손패와 모두에게 보이는 것만 쓴다 ───────── */

// 손패 중에서 값(val)이 가장 큰 조합 (기력 안에서). 손패가 7장뿐이라 다 따져 본다
function bestSubset(cards, energy, val) {
  let best = { v: 0, pickd: [] };
  for (let m = 1; m < 1 << cards.length; m++) {
    const sub = cards.filter((_, i) => m & (1 << i));
    if (sub.reduce((a, c) => a + CARDS[c.k].cost, 0) > energy) continue;
    const v = val(sub);
    if (v > best.v) best = { v, pickd: sub };
  }
  return best.pickd;
}

function botPlan(ctx, id, mem) {
  const S = ctx.state;
  const hand = handOf(ctx, id);
  const foes = list(S.alive).filter(x => x !== id);
  mem.bold ??= 0.3 + Math.random() * 0.6; // 배짱: 클수록 기력을 공격에 다 쓴다
  const want = x => {
    let s = 1 + Math.random();
    if (S.revenge?.[id] === x) s += 2.5;
    if (list(S.hitBy?.[id]).includes(x)) s += 1.2;
    s += ((HP_MAX - (S.hp?.[x] || 0)) / HP_MAX) * 1.6;
    if ((S.lives?.[x] || 0) === 1) s += 0.4;
    if ((S.kills?.[x] || 0) >= 2) s += 0.7;
    if (isVuln(S, x)) s += 0.8;
    if (charging(S, x)) s += 3;        // 필살기를 끊으러 간다
    if (S.tyrant === x) s += 0.8;
    return s;
  };
  let t = foes.sort((a, b) => want(b) - want(a))[0] || null;
  if (S.beast && Math.random() < (S.beast.hp <= 18 ? 0.55 : 0.22)) t = BEAST; // 야수: 거의 잡혔으면 막타를 노린다
  t = lockOf(S, id) || t;              // 도발 · 공개 처형: 그 사람만 겨눌 수 있다
  // 투지가 찼으면 필살기 준비 (다 죽어 가면 그냥 싸운다)
  if (S.ults?.[id] && furyOf(S, id) >= FURY_MAX && !S.charge?.[id] && S.hp[id] > 12 && Math.random() < 0.7) {
    return { t: null, u: true, c: hand.filter(c => c.k === 'bandage' && S.hp[id] < HP_MAX - 8).slice(0, 1).map(c => c.u) };
  }
  // 기력 벌이부터 (피의 의식은 체력이 넉넉할 때만)
  const boost = hand.filter(c => c.k === 'stim' || (c.k === 'blood' && S.hp[id] > 25 && Math.random() < 0.6));
  let energy = energyOf(S, id) + boost.length * 2;
  // 겁나는 만큼 방어할 기력을 남긴다
  const danger = list(S.hitBy?.[id]).length + (S.hp[id] < 25 ? 1 : 0) + Object.values(S.revenge || {}).filter(v => v === id).length;
  const hasDef = hand.some(c => CARDS[c.k].type === 'd');
  const keep = !hasDef || whimOf(S) === 'bare' ? 0 : Math.max(0, Math.min(2, Math.round(danger * (1.1 - mem.bold) + (Math.random() < 0.3 ? 1 : 0)))); // 맨몸이면 남겨 봐야 못 쓴다
  energy = Math.max(0, energy - keep);
  // 무기 조합: 여럿을 때리는 것(번개 · 화약통)과 손패 뺏기는 조금 더 쳐 준다
  const worth = sub => (attackOf(S, id, t, sub.map(c => c.k))?.dmg || 0)
    + (t === BEAST ? 0 : sub.reduce((a, c) => a + (CARDS[c.k].blast ? (foes.length - 1) * 3 : CARDS[c.k].splash ? 4 : CARDS[c.k].steal ? 2 : 0), 0));
  const weapons = t ? bestSubset(hand.filter(c => CARDS[c.k].type === 'w'), energy, worth) : [];
  let spent = weapons.reduce((a, c) => a + CARDS[c.k].cost, 0);
  const extra = weapons.length ? hand.filter(c => c.k === 'hone') : [];
  for (const c of hand) { // 기력이 남으면 쌍수(센 무기를 냈을 때) · 도발(되받아칠 방어 카드가 있을 때)
    if (!weapons.length || energy - spent < 1 || extra.some(x => x.k === c.k)) continue;
    const twin = c.k === 'twin' && weapons.some(w => CARDS[w.k].dmg >= 7);
    const taunt = c.k === 'taunt' && t !== BEAST && Math.random() < 0.5 && hand.some(x => CARDS[x.k].reflect || CARDS[x.k].counter || CARDS[x.k].thorns);
    if (!twin && !taunt) continue;
    extra.push(c);
    spent += 1;
  }
  // 다친 데다 기력이 남으면 붕대
  const heal = S.hp[id] <= HP_MAX - 12 && energy - spent >= 1 && Math.random() < 0.5 ? hand.filter(c => c.k === 'bandage').slice(0, 1) : [];
  const cards = [...boost, ...extra, ...weapons, ...heal];
  return { t: weapons.length ? t : null, c: cards.map(c => c.u) };
}

function botDefend(ctx, id) {
  const S = ctx.state;
  const hand = handOf(ctx, id);
  const inc_ = Object.values(S.atk || {}).filter(a => a.t === id).map(a => a.dmg || 0).sort((a, b) => b - a);
  const bite = S.beast?.t === id ? S.beast.dmg : 0; // 야수가 나를 문다 (방어도로만 막는다)
  const total = inc_.reduce((a, b) => a + b, 0) + bite;
  const unknown = Object.values(S.atk || {}).some(a => a.smoke);
  const left = S.left?.[id] || 0;
  if (total <= 3 && !(unknown && S.hp[id] < 30)) return { c: [] };
  const defs = hand.filter(c => CARDS[c.k].type === 'd');
  const guess = total + (unknown ? 6 : 0);
  // 막는 양: 특수 방어는 센 공격부터 지우고, 남은 건 방어도로
  const saved = sub => {
    const rest = [...inc_];
    let v = 0;
    for (const c of sub) {
      const d = CARDS[c.k];
      if ((d.reflect || d.dodge || d.redirect) && rest.length) v += rest.shift() * (d.reflect ? 1.5 : 1);
    }
    const block = sub.reduce((a, c) => a + (CARDS[c.k].block || 0), 0);
    const remain = rest.reduce((a, b) => a + b, 0) + (unknown ? 6 : 0) + bite;
    const saves = sub.some(c => CARDS[c.k].undying) ? (remain - block >= S.hp[id] ? 30 : -4) : 0; // 불사의 약은 죽을 판에만
    return v + Math.min(block, remain) + saves + sub.filter(c => CARDS[c.k].thorns || CARDS[c.k].counter).length * 2 - sub.length * 0.6;
  };
  const use = guess >= S.hp[id] || guess >= 5 ? bestSubset(defs, left, saved) : [];
  return { c: use.map(c => c.u) };
}

// 탈락한 봇(망령): 유산은 제일 좋은 걸 나를 쓰러뜨린 사람 말고 아무에게나, 원한은 나를 쓰러뜨린 사람에게
function ghostBot(ctx, id, mem) {
  const S = ctx.state;
  if (S.over || !S.dead?.[id]) return null;
  const killer = S.dead[id];
  if (S.phase === 'loot') {
    const it = list(S.loot).find(x => x.kind === 'will' && x.by === id && !x.set);
    if (!it) return null;
    const live = list(S.alive);
    const to = shuffle(live.filter(x => x !== killer))[0] || live[0];
    const relic = [...list(it.opts)].sort((a, b) => RELICS[b].tier - RELICS[a].tier)[0];
    return to && relic ? { type: 'will', data: { relic, to } } : null;
  }
  if (S.phase !== 'attack' || mem.gRound === S.round) return null;
  mem.gRound = S.round;
  if (alive(S, mem.g)) return null; // 한번 건 원한은 그 사람이 살아 있는 동안 이어진다
  mem.g = alive(S, killer) ? killer : shuffle(list(S.alive))[0] || null;
  return mem.g ? { type: 'grudge', data: { round: S.round, t: mem.g } } : null;
}

export function bot(ctx, id, mem) {
  const S = ctx.state;
  const now = ctx.now();
  if (!alive(S, id)) return ghostBot(ctx, id, mem);
  const key = `${S.phase}:${S.round}:${S.pick?.no ?? ''}`;
  if (mem.key !== key) { // 단계가 바뀌면 사람처럼 조금 있다가 누른다
    mem.key = key;
    mem.at = now + (S.phase === 'attack' ? 1500 + Math.random() * 4500 : 900 + Math.random() * 1800);
    mem.done = false;
  }
  if (mem.done || now < mem.at) return null;
  if (S.phase === 'pick' && S.pick && !S.pick.shown && !S.pick.done?.[id]) {
    mem.done = true;
    const offers = list(S.pick.offers?.[id]);
    const best = S.pick.kind === 'ult' ? offers[Math.floor(Math.random() * offers.length)]
      : [...offers].sort((a, b) => RELICS[b].tier - RELICS[a].tier + Math.random() - 0.5)[0];
    return best ? { type: 'pick', data: { no: S.pick.no, relic: best } } : null;
  }
  if (S.phase === 'attack' && !S.ready?.[id]) {
    mem.done = true;
    return { type: 'plan', data: { round: S.round, ...botPlan(ctx, id, mem), ready: true, at: now } };
  }
  if (S.phase === 'defend' && !S.ready2?.[id]) {
    mem.done = true;
    return { type: 'def', data: { round: S.round, ...botDefend(ctx, id), ready: true } };
  }
  if (S.phase === 'loot') {
    const it = list(S.loot).find(x => x.by === id && !x.got);
    if (!it) return null;
    mem.at = now + 600; // 받을 게 더 있으면 이어서
    const best = [...list(it.opts)].sort((a, b) => RELICS[b].tier - RELICS[a].tier)[0];
    return { type: 'loot', data: { relic: best } };
  }
  return null;
}
