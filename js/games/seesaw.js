// 독박 시소: 용암 위 스프링 시소에 돌아가며 짐을 떨군다.
// 짐은 🎰 룰렛(완전 랜덤, 다음 짐은 '?'). 판 양끝 아래 스프링이 있어서 무거운 쪽이 무게 차이만큼 기울고,
// 반대쪽에 올리면 다시 평평해진다 (받침 하나뿐인 진짜 시소는 짐이 정가운데가 아니면 끝까지 넘어가서 균형이란 게 없다).
// 짐이 용암에 떨어지거나 판 끝이 용암에 닿으면 지금 차례 독박(탈락). 판은 그대로 이어가고,
// 떨어진 짐·방금 떨군 짐은 용암으로 퐁당 (그래도 판 끝이 닿아 있으면 낮은 쪽 끝 짐부터 치운다: 다음 사람이 죽은 판을 받지 않게).
// 가운데 둥근 축 위에 떨군 짐은 한쪽으로 굴러가서 정가운데만 노릴 수 없다. 판 양끝엔 작은 턱.
// 😈 악마 카드(1인 1장): 내 차례 동안 숫자키 1~6으로 다음 사람 짐을 금고(무거움)·볼링공(구름)·얼음(미끌)·돌침대(길고 무거움)·닻(한쪽이 무거움) 중 하나로,
//    또는 ⬆️ 꼭대기에서(짐은 랜덤, 떨구는 높이 최대). 그걸로 독박 나면 내 킬.
// 룰렛엔 가끔 레어(✨): 🪂 보급 상자(공중에서 낙하산) · 🎁 악마의 선물(놓고 살면 카드 +1).
// 물리는 방장 컴퓨터만 계산한다(planck.js, js/vendor). 다른 사람은 위치만 받아서 그린다.
import { h, isTyping, josa, pick, shuffle, digitOf, AGAIN_INTRO } from '../util.js';
import { avatar, countdown, podium } from '../ui.js';
import { KINDS as JUNK } from './pullout-art.js';

const PLANCK_URL = '../vendor/planck.mjs';
const INTRO_TIME = 4000;
const DECIDE_TIME = 5000;     // 내 짐이 멈춘 뒤 악마 카드 고민 시간 (고르면 바로 끝)
const RESULT_TIME = 1000;
const SPIN_TIME = 1300;       // 차례 시작할 때 룰렛 도는 시간
const RARE_SPIN = 600;        // 레어가 걸리면 룰렛이 이만큼 더 천천히 멈춘다
const CHUTE_DAMP = 4;         // 낙하산: 공중에서 이만큼 감속 (끝 속도 = 중력 ÷ 이것 = 초당 3m)
const SETTLE_MAX = 5000;      // 떨군 뒤 이만큼 지나면 거의 멈춘 건 그 자리에 세우고 판정
const SETTLE_HARD = 9000;     // 아직 날아다니는 게 있어도 이때는 무조건 판정
const CALM_HOLD = 400;        // 이만큼 계속 멈춰 있어야 멈춘 것 (출렁이는 판이 끝까지 갔다 돌아서는 순간은 멈춘 게 아니다)
const DEVIL_CARDS = 1;
const GRAVITY = 12;
const HALF = 4;               // 판 반 길이 (판 8m)
const THICK = 0.08;           // 판 반 두께
const PIVOT_H = 0.9;          // 받침 높이: 판이 약 12° 기울면 끝이 용암에 닿는다 (짐이 미끄러지기 전에)
const HUB = 0.35;             // 가운데 둥근 축 반지름 (판 위로 튀어나옴)
const LIP = 0.2;              // 양끝 턱 높이
const SPRING = 420;           // 스프링: 1rad 기울면 되돌리는 힘. 너무 세면 안 기울어서 아무 데나 놔도 똑같다 (900에서 시험)
const SPRING_X = 3.3;         // 화면에 그리는 스프링 자리
// 떨구는 높이: 짐 맨 아래가 그 자리 가장 높은 곳보다 이만큼 위. 4차례마다 0.2m씩 높아져서 쿵이 세진다 (출렁 → 반대쪽 짐이 튐)
const DROP_MAX = 2;
export const dropGap = turns => Math.min(DROP_MAX, 0.8 + 0.2 * Math.floor((turns || 0) / 4));
const AIM_START = 1;          // 차례 시작 조준점: 가운데에서 이만큼 왼쪽이나 오른쪽 (그냥 스페이스로 가운데에 놓지 못하게)
const X_LIMIT = 3.7;          // 조준 좌우 한계
const MOVE_SPEED = 3;         // 꾹 눌렀을 때 초당
const KG = 25;                // 화면에 보이는 무게 = 물리 질량 × 이것
const MIRACLE_FROM = (8 * Math.PI) / 180; // 이만큼 기운 판을
const MIRACLE_TO = (3 * Math.PI) / 180;   // 이 안으로 되돌리면 🪄 기적의 복구
export const LIMIT = Math.asin((PIVOT_H - THICK) / HALF); // 판 끝이 용암에 닿는 기울기
const CLEAN_TO = LIMIT * 0.7;  // 독박 뒤 청소: 판이 이만큼(약 8°) 안으로 돌아올 때까지 낮은 쪽 끝 짐을 치운다
const aimTime = lap => Math.max(6000, 10000 - (lap - 1) * 1500);
const r3 = v => Math.round(v * 1000) / 1000;
const deg = r => (r * 180) / Math.PI;
const clampX = x => r3(Math.max(-X_LIMIT, Math.min(X_LIMIT, x)));
const snapA = a => r3(Math.round(a / (Math.PI / 2)) * (Math.PI / 2));

/* ───────── 짐: 독박빼기 잡동사니 + 시소 전용 ───────── */

const EXTRA = {
  feather: {
    name: '깃털 상자', density: 0.05, friction: 0.8,
    parts: [{ box: [0.35, 0.25] }],
    art: [
      ['rect', { x: -0.35, y: -0.25, width: 0.7, height: 0.5, rx: 0.04, fill: '#fdf6e3' }],
      ['path', { d: 'M -0.2 -0.14 Q 0 0.02 0.2 0.16 Q 0.02 0.16 -0.2 -0.14 Z', fill: '#a5d8ff' }],
      ['line', { x1: -0.24, y1: -0.18, x2: 0.12, y2: 0.1 }],
    ],
  },
  melon: {
    name: '수박', density: 2.4, friction: 0.6, rolling: 1.5,
    parts: [{ circle: 0.3 }],
    art: [
      ['circle', { r: 0.3, fill: '#2f9e44' }],
      ['path', { d: 'M -0.13 -0.27 Q -0.24 0 -0.13 0.27', fill: 'none' }],
      ['line', { x1: 0, y1: -0.3, x2: 0, y2: 0.3 }],
      ['path', { d: 'M 0.13 -0.27 Q 0.24 0 0.13 0.27', fill: 'none' }],
    ],
  },
  safe: {
    name: '금고', density: 8, friction: 0.7,
    parts: [{ box: [0.38, 0.38] }],
    art: [
      ['rect', { x: -0.38, y: -0.38, width: 0.76, height: 0.76, rx: 0.05, fill: '#636e72' }],
      ['rect', { x: -0.29, y: -0.29, width: 0.58, height: 0.58, rx: 0.03, fill: '#7f8c8d' }],
      ['circle', { r: 0.13, fill: '#dfe6e9' }],
      ['line', { x1: 0, y1: 0, x2: 0.09, y2: 0.06 }],
    ],
  },
  ice: {
    name: '얼음', density: 2, friction: 0,
    parts: [{ box: [0.45, 0.3] }],
    art: [
      ['rect', { x: -0.45, y: -0.3, width: 0.9, height: 0.6, rx: 0.08, fill: '#c5f0ff' }],
      ['line', { x1: -0.3, y1: 0.12, x2: -0.1, y2: 0.2 }],
      ['line', { x1: -0.33, y1: -0.02, x2: -0.23, y2: 0.02 }],
    ],
  },
  // 원판 사이 봉 아래 틈(0.35)이 가운데 축 돌출(0.27)보다 높아서, 축을 원판 사이에 끼우면 가운데에 걸쳐진다
  barbell: {
    name: '역기', density: 7.4, friction: 0.7,
    parts: [{ box: [0.95, 0.03] }, { box: [0.07, 0.38], at: [-0.85, 0] }, { box: [0.07, 0.38], at: [0.85, 0] }],
    art: [
      ['rect', { x: -0.95, y: -0.03, width: 1.9, height: 0.06, fill: '#ced4da' }],
      ['rect', { x: -0.92, y: -0.38, width: 0.14, height: 0.76, rx: 0.03, fill: '#343a40' }],
      ['rect', { x: 0.78, y: -0.38, width: 0.14, height: 0.76, rx: 0.03, fill: '#343a40' }],
      ['rect', { x: -0.78, y: -0.08, width: 0.05, height: 0.16, fill: '#868e96' }],
      ['rect', { x: 0.73, y: -0.08, width: 0.05, height: 0.16, fill: '#868e96' }],
      ['line', { x1: -0.85, y1: -0.3, x2: -0.85, y2: 0.3, stroke: '#868e96' }],
      ['line', { x1: 0.85, y1: -0.3, x2: 0.85, y2: 0.3, stroke: '#868e96' }],
    ],
  },
  // 무게가 쇠머리에 쏠려 있다: ↑↓로 돌리면 무게 자리가 바뀐다
  hammer: {
    name: '오함마', density: 1.2, friction: 0.7,
    parts: [{ box: [0.59, 0.04], at: [-0.11, 0] }, { box: [0.12, 0.2], at: [0.6, 0], density: 9 }],
    art: [
      ['rect', { x: -0.7, y: -0.04, width: 1.18, height: 0.08, rx: 0.03, fill: '#c8872f' }],
      ['rect', { x: -0.7, y: -0.045, width: 0.26, height: 0.09, rx: 0.03, fill: '#343a40' }],
      ['rect', { x: 0.48, y: -0.2, width: 0.24, height: 0.4, rx: 0.03, fill: '#495057' }],
      ['line', { x1: 0.53, y1: 0.12, x2: 0.67, y2: 0.12, stroke: '#868e96' }],
    ],
  },
  // 바닥에 무거운 추: 둥근데 안 굴러가고 스스로 선다
  roly: {
    name: '오뚝이', density: 0.4, friction: 0.8, rolling: 6,
    parts: [{ circle: 0.34 }, { circle: 0.13, at: [0, -0.19], density: 14 }, { circle: 0.15, at: [0, 0.42] }],
    art: [
      ['circle', { r: 0.34, fill: '#e03131' }],
      ['ellipse', { cx: 0, cy: -0.06, rx: 0.2, ry: 0.17, fill: '#fff5f5', stroke: 'none' }],
      ['circle', { cy: 0.42, r: 0.15, fill: '#ffe8cc' }],
      ['circle', { cx: -0.05, cy: 0.44, r: 0.022, fill: '#212529', stroke: 'none' }],
      ['circle', { cx: 0.05, cy: 0.44, r: 0.022, fill: '#212529', stroke: 'none' }],
      ['path', { d: 'M -0.04 0.37 Q 0 0.34 0.04 0.37', fill: 'none' }],
    ],
  },
  // 바퀴만 마찰 0: 바퀴가 아래면 기운 쪽으로 쭉 굴러가고, 뒤집으면 선다
  cart: {
    name: '마트 카트', density: 4, friction: 0.7, linDamp: 0.25,
    parts: [
      { box: [0.5, 0.04], at: [0, 0.1] }, { box: [0.04, 0.28], at: [-0.46, 0.38] }, { box: [0.04, 0.28], at: [0.46, 0.38] },
      { circle: 0.1, at: [-0.36, -0.04], density: 3, friction: 0 }, { circle: 0.1, at: [0.36, -0.04], density: 3, friction: 0 },
    ],
    art: [
      ['line', { x1: -0.25, y1: 0.14, x2: -0.25, y2: 0.62, stroke: '#74c0fc' }],
      ['line', { x1: 0, y1: 0.14, x2: 0, y2: 0.62, stroke: '#74c0fc' }],
      ['line', { x1: 0.25, y1: 0.14, x2: 0.25, y2: 0.62, stroke: '#74c0fc' }],
      ['line', { x1: -0.42, y1: 0.4, x2: 0.42, y2: 0.4, stroke: '#74c0fc' }],
      ['rect', { x: -0.5, y: 0.06, width: 1, height: 0.08, rx: 0.02, fill: '#1c7ed6' }],
      ['rect', { x: -0.5, y: 0.1, width: 0.08, height: 0.56, rx: 0.02, fill: '#1c7ed6' }],
      ['rect', { x: 0.42, y: 0.1, width: 0.08, height: 0.56, rx: 0.02, fill: '#1c7ed6' }],
      ['circle', { cx: -0.36, cy: -0.04, r: 0.1, fill: '#212529' }],
      ['circle', { cx: 0.36, cy: -0.04, r: 0.1, fill: '#212529' }],
      ['circle', { cx: -0.36, cy: -0.04, r: 0.035, fill: '#adb5bd', stroke: 'none' }],
      ['circle', { cx: 0.36, cy: -0.04, r: 0.035, fill: '#adb5bd', stroke: 'none' }],
    ],
  },
  // 매트리스처럼 생겼는데 58kg
  stonebed: {
    name: '돌침대', density: 3.25, friction: 0.7,
    parts: [{ box: [1, 0.16] }, { box: [0.07, 0.28], at: [-0.93, 0.44] }],
    art: [
      ['rect', { x: -1, y: -0.16, width: 2, height: 0.32, rx: 0.05, fill: '#868e96' }],
      ['rect', { x: -1, y: 0.16, width: 0.14, height: 0.56, rx: 0.04, fill: '#5c4033' }],
      ['line', { x1: -0.86, y1: 0.08, x2: 0.94, y2: 0.08, stroke: '#adb5bd' }],
      ...[-0.55, -0.15, 0.25, 0.65].map(cx => ['circle', { cx, cy: -0.04, r: 0.05, fill: '#63e6be' }]),
    ],
  },
  toilet: {
    name: '변기', density: 3.2, friction: 0.5,
    parts: [{ poly: [[-0.28, -0.32], [0.08, -0.32], [0.36, 0], [0.36, 0.1], [-0.28, 0.1]] }, { box: [0.13, 0.28], at: [-0.29, 0.38] }],
    art: [
      ['polygon', { points: '-0.28,-0.32 0.08,-0.32 0.36,0 0.36,0.1 -0.28,0.1', fill: '#f8f9fa' }],
      ['rect', { x: -0.42, y: 0.1, width: 0.26, height: 0.56, rx: 0.03, fill: '#f1f3f5' }],
      ['rect', { x: -0.16, y: 0.06, width: 0.54, height: 0.06, rx: 0.03, fill: '#dee2e6' }],
      ['rect', { x: -0.33, y: 0.54, width: 0.1, height: 0.04, rx: 0.02, fill: '#adb5bd' }],
      ['path', { d: 'M -0.1 -0.2 Q 0.1 -0.2 0.22 -0.02', fill: 'none', stroke: '#ced4da' }],
    ],
  },
  cement: {
    name: '시멘트 포대', density: 5, friction: 1,
    parts: [{ box: [0.5, 0.16] }],
    art: [
      ['rect', { x: -0.5, y: -0.16, width: 1, height: 0.32, rx: 0.08, fill: '#ced4da' }],
      ['rect', { x: -0.22, y: -0.09, width: 0.44, height: 0.18, rx: 0.02, fill: '#f08c00' }],
      ['line', { x1: -0.42, y1: -0.13, x2: -0.42, y2: 0.13, 'stroke-dasharray': '0.05 0.04' }],
      ['line', { x1: 0.42, y1: -0.13, x2: 0.42, y2: 0.13, 'stroke-dasharray': '0.05 0.04' }],
    ],
  },
  // 크지만 2.8kg, 살짝 통통 튄다
  gymball: {
    name: '짐볼', density: 0.25, friction: 0.9, rolling: 1.5, restitution: 0.3,
    parts: [{ circle: 0.38 }],
    art: [
      ['circle', { r: 0.38, fill: '#74c0fc' }],
      ['path', { d: 'M -0.36 0.1 Q 0 -0.12 0.36 0.1', fill: 'none', stroke: '#1c7ed6' }],
      ['path', { d: 'M -0.3 -0.22 Q 0 -0.38 0.3 -0.22', fill: 'none', stroke: '#1c7ed6' }],
      ['circle', { cx: -0.13, cy: 0.17, r: 0.07, fill: '#fff', opacity: 0.5, stroke: 'none' }],
    ],
  },
  // 놓기는 쉬운데 꼭대기가 뾰족해서 그 위엔 아무것도 못 올린다
  cone: {
    name: '라바콘', density: 0.75, friction: 0.8,
    parts: [{ box: [0.3, 0.03], at: [0, -0.37] }, { poly: [[-0.2, -0.34], [0.2, -0.34], [0.04, 0.38], [-0.04, 0.38]] }],
    art: [
      ['rect', { x: -0.3, y: -0.4, width: 0.6, height: 0.06, rx: 0.02, fill: '#343a40' }],
      ['polygon', { points: '-0.2,-0.34 0.2,-0.34 0.04,0.38 -0.04,0.38', fill: '#ff922b' }],
      ['polygon', { points: '-0.147,-0.1 0.147,-0.1 0.12,0.02 -0.12,0.02', fill: '#fff', stroke: 'none' }],
      ['polygon', { points: '-0.089,0.16 0.089,0.16 0.067,0.26 -0.067,0.26', fill: '#fff', stroke: 'none' }],
    ],
  },
  // 악마 카드 전용: 무게가 아래 크라운에 몰려 있다. 세우면 높고, 눕히면 한쪽 끝이 무겁다
  anchor: {
    name: '닻', density: 2.5, friction: 0.7,
    parts: [
      { circle: 0.12, at: [0, 0.8] }, { box: [0.24, 0.04], at: [0, 0.58] }, { box: [0.06, 0.66], at: [0, 0.02] },
      { box: [0.42, 0.07], at: [0, -0.62], density: 10 },
      { box: [0.07, 0.14], at: [-0.36, -0.46], density: 10 }, { box: [0.07, 0.14], at: [0.36, -0.46], density: 10 },
    ],
    art: [
      ['path', { d: 'M -0.12 0.8 a 0.12 0.12 0 1 0 0.24 0 a 0.12 0.12 0 1 0 -0.24 0 M -0.055 0.8 a 0.055 0.055 0 1 0 0.11 0 a 0.055 0.055 0 1 0 -0.11 0', 'fill-rule': 'evenodd', fill: '#495057' }],
      ['rect', { x: -0.24, y: 0.54, width: 0.48, height: 0.08, rx: 0.03, fill: '#495057' }],
      ['rect', { x: -0.06, y: -0.64, width: 0.12, height: 1.32, rx: 0.03, fill: '#495057' }],
      ['path', { d: 'M -0.43 -0.32 L -0.43 -0.69 L 0.43 -0.69 L 0.43 -0.32 L 0.29 -0.42 L 0.29 -0.55 L -0.29 -0.55 L -0.29 -0.42 Z', fill: '#343a40' }],
    ],
  },
  // 레어: 공중에서만 낙하산이 펴져서 사뿐히 내려온다 (처음 뭔가에 닿으면 접힘)
  airdrop: {
    name: '보급 상자', density: 3.8, friction: 0.8, chute: true,
    parts: [{ box: [0.45, 0.35] }],
    art: [
      ['rect', { x: -0.45, y: -0.35, width: 0.9, height: 0.7, rx: 0.03, fill: '#5c940d' }],
      ['rect', { x: -0.45, y: -0.06, width: 0.9, height: 0.12, fill: '#4c7a0b' }],
      ['line', { x1: -0.45, y1: -0.35, x2: 0.45, y2: 0.35 }],
      ['line', { x1: -0.45, y1: 0.35, x2: 0.45, y2: -0.35 }],
      ['polygon', { points: '0,0.2 0.05,0.06 0.19,0.06 0.08,-0.03 0.12,-0.17 0,-0.08 -0.12,-0.17 -0.08,-0.03 -0.19,0.06 -0.05,0.06', fill: '#ffd43b', stroke: 'none' }],
    ],
  },
  // 레어: 놓고 살아남으면 악마 카드 +1
  gift: {
    name: '악마의 선물', density: 0.3, friction: 0.8,
    parts: [{ box: [0.3, 0.25] }],
    art: [
      ['rect', { x: -0.3, y: -0.25, width: 0.6, height: 0.5, rx: 0.03, fill: '#7048e8' }],
      ['rect', { x: -0.05, y: -0.25, width: 0.1, height: 0.5, fill: '#e03131', stroke: 'none' }],
      ['rect', { x: -0.3, y: -0.05, width: 0.6, height: 0.1, fill: '#e03131', stroke: 'none' }],
      ['ellipse', { cx: -0.1, cy: 0.16, rx: 0.09, ry: 0.05, fill: '#e03131' }],
      ['ellipse', { cx: 0.1, cy: 0.16, rx: 0.09, ry: 0.05, fill: '#e03131' }],
      ['circle', { cy: 0.15, r: 0.05, fill: '#c92a2a' }],
      ['polygon', { points: '-0.045,0.19 -0.03,0.245 -0.015,0.195', fill: '#c92a2a', stroke: 'none' }],
      ['polygon', { points: '0.045,0.19 0.03,0.245 0.015,0.195', fill: '#c92a2a', stroke: 'none' }],
    ],
  },
};
export const KINDS = { ...JUNK, ...EXTRA };
// 룰렛: 가중치 뽑기. 거의 같은 짐인 긴 판 3종(매트리스·사다리·문짝)은 반씩, 레어는 드물게 (합쳐서 약 5%)
export const ROULETTE = [
  ...Object.keys(JUNK).map(k => ({ k, w: ['mattress', 'ladder', 'door'].includes(k) ? 0.5 : 1 })),
  ...['feather', 'melon', 'barbell', 'hammer', 'roly', 'cart', 'stonebed', 'toilet', 'cement', 'gymball', 'cone'].map(k => ({ k, w: 1 })),
  { k: 'airdrop', w: 0.6 },
  { k: 'gift', w: 0.6 },
];
export const RARE = new Set(['airdrop', 'gift']);
const TRICKY = new Set(['roly', 'cart', ...RARE]); // 첫 바퀴엔 안 나옴 (기본 감각부터)
const RARE_GAP = 3;           // 레어가 나오면 이만큼 차례 동안은 레어 없음
const MAX_CARDS = 2;          // 악마의 선물로 늘어나는 카드 상한
// 악마 카드로: 무거운 짐 / 구르는 짐 / 미끌 얼음 / 길고 무거운 돌침대 / 한쪽이 무거운 닻 / 짐은 랜덤인데 꼭대기(2m)에서 떨구기
export const DEVILS = [
  { k: 'safe', tag: '🔒 무거운' },
  { k: 'bowling', tag: '🎳 구르는' },
  { k: 'ice', tag: '🧊 미끌' },
  { k: 'stonebed', tag: '🛏️ 길쭉한' },
  { k: 'anchor', tag: '⚓ 쏠린' },
  { high: true, tag: '⬆️ 꼭대기에서' },
];
const devilName = d => (d.high ? '꼭대기에서 (짐은 랜덤)' : kindOf(d.k).name);
const kindOf = k => KINDS[k] || KINDS.box;

function areaOf(part) {
  if (part.box) return 4 * part.box[0] * part.box[1];
  if (part.circle) return Math.PI * part.circle ** 2;
  let s = 0;
  part.poly.forEach(([x1, y1], i) => {
    const [x2, y2] = part.poly[(i + 1) % part.poly.length];
    s += x1 * y2 - x2 * y1;
  });
  return Math.abs(s) / 2;
}

// 부품 무게 중심 (부품 기준점 at 포함)
function centroidOf(part) {
  const [ax, ay] = part.at || [0, 0];
  if (!part.poly) return [ax, ay];
  let a = 0;
  let cx = 0;
  let cy = 0;
  part.poly.forEach(([x1, y1], i) => {
    const [x2, y2] = part.poly[(i + 1) % part.poly.length];
    const c = x1 * y2 - x2 * y1;
    a += c;
    cx += (x1 + x2) * c;
    cy += (y1 + y2) * c;
  });
  return [ax + cx / (3 * a), ay + cy / (3 * a)];
}

// 짐마다 무게와 무게중심 (부품마다 밀도가 다를 수 있다: 오함마 쇠머리, 오뚝이 바닥 추)
const MASS = {};
const COM = {};
for (const [k, d] of Object.entries(KINDS)) {
  let m = 0;
  let mx = 0;
  let my = 0;
  for (const p of d.parts) {
    const pm = areaOf(p) * (p.density ?? d.density);
    const [cx, cy] = centroidOf(p);
    m += pm;
    mx += pm * cx;
    my += pm * cy;
  }
  MASS[k] = m;
  COM[k] = [mx / m, my / m];
}
export const massOf = k => MASS[k] ?? MASS.box;
// 돌린 짐의 무게중심 (몸 기준점에서)
export function comOf(k, a = 0) {
  const [x, y] = COM[k] || [0, 0];
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

// 룰렛 한 번: 방금 짐은 다시 안 나오고, 첫 바퀴엔 특이한 짐 없음, 레어 뒤엔 잠시 레어 없음.
// 악마의 선물은 결승(2명)이거나 카드가 이미 꽉 찼으면 안 나온다
export function rollPiece(S, id, lap) {
  const pool = ROULETTE.filter(({ k }) => k !== S.piece
    && !(lap <= 1 && TRICKY.has(k))
    && !(RARE.has(k) && (S.rareGap || 0) > 0)
    && !(k === 'gift' && ((S.alive || []).length <= 2 || (S.cards?.[id] || 0) >= MAX_CARDS)));
  let r = Math.random() * pool.reduce((s, p) => s + p.w, 0);
  for (const p of pool) if ((r -= p.w) <= 0) return p.k;
  return pool[pool.length - 1].k;
}
export const kgText = k => {
  const v = massOf(k) * KG;
  return v < 10 ? `${v.toFixed(1)}kg` : `${Math.round(v)}kg`;
};

// 짐 끝점 (모양·회전 반영)
export function extent(k, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  const add = (x, y) => {
    const X = x * c - y * s;
    const Y = x * s + y * c;
    lo = [Math.min(lo[0], X), Math.min(lo[1], Y)];
    hi = [Math.max(hi[0], X), Math.max(hi[1], Y)];
  };
  for (const part of kindOf(k).parts) {
    const [ax, ay] = part.at || [0, 0];
    if (part.circle) {
      for (const [u, v] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(ax + u * part.circle, ay + v * part.circle);
    } else if (part.box) {
      for (const [u, v] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(ax + u * part.box[0], ay + v * part.box[1]);
    } else {
      for (const [x, y] of part.poly) add(x + ax, y + ay);
    }
  }
  return { lo, hi };
}

// 떨굴 때 짐 중심 높이: 짐 맨 아래가 그 자리(짐 폭만큼)의 가장 높은 곳 + dropGap. 방장·화면 미리보기가 같이 쓴다
export function spawnY(S, k, x, a) {
  const e = extent(k, a);
  const l = x + e.lo[0];
  const r = x + e.hi[0];
  const t = S.tilt || 0;
  const surf = u => PIVOT_H + Math.max(-HALF, Math.min(HALF, u)) * Math.tan(t) + THICK / Math.cos(t);
  let top = Math.max(surf(l), surf(r));
  if (l < HUB && r > -HUB) top = Math.max(top, PIVOT_H + HUB);
  if (l < -HALF + 0.15) top = Math.max(top, surf(-HALF) + 2 * LIP);
  if (r > HALF - 0.15) top = Math.max(top, surf(HALF) + 2 * LIP);
  for (const b of S.bodies || []) {
    const be = extent(b.k, b.a);
    if (b.x + be.lo[0] < r + 0.1 && b.x + be.hi[0] > l - 0.1) top = Math.max(top, b.y + be.hi[1]);
  }
  return top + (S.high ? DROP_MAX : dropGap(S.turnsPlayed)) - e.lo[1];
}

/* ───────── 물리 (방장 전용) ───────── */

let planck = null;
let loading = null;
function ensurePlanck() {
  if (planck || loading) return;
  loading = import(PLANCK_URL).then(m => { planck = m; }).catch(e => {
    loading = null;
    console.error('[seesaw] 물리 엔진을 불러오지 못했어요', e);
  });
}
export function usePlanck(m) { planck = m; } // 테스트용

function makeSim(S) {
  const { World, Vec2, Box, Circle, Polygon, RevoluteJoint } = planck;
  const world = new World({ gravity: new Vec2(0, -GRAVITY) });
  const lava = world.createBody();
  lava.createFixture(new Box(40, 0.5, new Vec2(0, -0.5), 0), { friction: 0.8 });
  // 받침은 용암과 다른 몸으로 (관절로 이은 몸끼리는 안 부딪혀서, 같은 몸이면 판이 용암을 뚫고 내려간다)
  const pivot = world.createBody();
  pivot.createFixture(new Polygon([new Vec2(-0.55, 0), new Vec2(0.55, 0), new Vec2(0, PIVOT_H - 0.12)]), { friction: 0.5 });
  const plank = world.createBody({ type: 'dynamic', position: new Vec2(0, PIVOT_H), angle: S.tilt || 0, angularDamping: 0.5, awake: false });
  plank.createFixture(new Box(HALF, THICK), { density: 1, friction: 0.7 });
  plank.createFixture(new Circle(new Vec2(0, 0), HUB), { density: 1, friction: 0.3 });
  for (const s of [-1, 1]) plank.createFixture(new Box(0.06, LIP, new Vec2(s * (HALF - 0.06), THICK + LIP), 0), { density: 1, friction: 0.7 });
  world.createJoint(new RevoluteJoint({}, pivot, plank, new Vec2(0, PIVOT_H)));
  const sim = { world, lava, plank, bodies: new Map(), meta: new Map(), chutes: new Set() };
  for (const b of S.bodies || []) addBody(sim, b, false); // 이어받은 판은 잠든 채로
  return sim;
}

function addBody(sim, b, awake) {
  const { Vec2, Box, Circle, Polygon } = planck;
  const def = kindOf(b.k);
  // 둥근 건 구름 저항(각 감쇠): 데굴데굴 가다가 멈춘다
  // 카트처럼 굴러가는 건 이동 감쇠(linDamp), 낙하산이 펴져 있으면 공중에서 크게 감속
  const body = sim.world.createBody({
    type: 'dynamic', position: new Vec2(b.x, b.y), angle: b.a || 0, awake,
    angularDamping: def.rolling || 0, linearDamping: b.v ? CHUTE_DAMP : def.linDamp || 0,
  });
  // 부품마다 밀도·마찰·반발이 다를 수 있다 (오함마 쇠머리, 카트 바퀴, 짐볼)
  for (const part of def.parts) {
    const [ax, ay] = part.at || [0, 0];
    const shape = part.box ? new Box(part.box[0], part.box[1], new Vec2(ax, ay), 0)
      : part.circle ? new Circle(new Vec2(ax, ay), part.circle)
        : new Polygon(part.poly.map(([x, y]) => new Vec2(x + ax, y + ay)));
    body.createFixture(shape, {
      density: part.density ?? def.density, friction: part.friction ?? def.friction, restitution: part.restitution ?? def.restitution ?? 0,
    });
  }
  if (b.v) sim.chutes.add(b.id);
  body.setUserData(b.id);
  sim.bodies.set(b.id, body);
  sim.meta.set(b.id, { k: b.k, by: b.by });
  return body;
}

function removeBody(sim, id) {
  const body = sim.bodies.get(id);
  if (body) sim.world.destroyBody(body);
  sim.bodies.delete(id);
  sim.meta.delete(id);
  sim.chutes.delete(id);
}

// 낙하산은 처음 뭔가(판·짐·용암)에 닿는 순간 접힌다
function foldChutes(sim) {
  for (const id of sim.chutes) {
    const body = sim.bodies.get(id);
    if (body && !touching(body)) continue;
    if (body) body.setLinearDamping(kindOf(sim.meta.get(id)?.k).linDamp || 0);
    sim.chutes.delete(id);
  }
}

// 스프링: 기운 만큼 되돌리고, 출렁임은 눌러 준다 (잠든 판은 깨우지 않음)
function spring(plank) {
  if (!plank.isAwake()) return;
  plank.applyTorque(-SPRING * plank.getAngle() - SPRING * 0.12 * plank.getAngularVelocity(), false);
}

const pose = body => {
  const p = body.getPosition();
  return [r3(p.x), r3(p.y), r3(body.getAngle())];
};

// 물리를 시간만큼 돌린다. 위치는 0.1초마다 보내니, 꺾이며 움직인 짐(과 판)은 중간 자리(p)도 같이 (독박 타워와 같은 방식)
function stepPhysics(ctx, now) {
  const sim = ctx.sim;
  const dt = Math.min(500, Math.max(0, now - (ctx.simAt || now)));
  ctx.simAt = now;
  const steps = Math.max(1, Math.round(dt / (1000 / 60)));
  const segs = Math.min(6, Math.max(1, Math.round(steps / 2)));
  const marks = new Set(Array.from({ length: segs - 1 }, (_, k) => Math.round((steps * (k + 1)) / segs)));
  const all = [...sim.bodies, ['_plank', sim.plank]];
  const start = new Map(all.map(([id, body]) => [id, pose(body)]));
  const samples = new Map();
  for (let i = 1; i <= steps; i++) {
    spring(sim.plank);
    sim.world.step(1 / 60, 8, 3);
    if (sim.chutes.size) foldChutes(sim);
    if (!marks.has(i)) continue;
    for (const [id, body] of all) {
      if (!samples.has(id)) samples.set(id, []);
      samples.get(id).push(pose(body));
    }
  }
  const trail = new Map();
  for (const [id, body] of all) {
    const a = start.get(id);
    const list = samples.get(id);
    if (!a || list?.length !== segs - 1) continue;
    const z = pose(body);
    const bent = list.some((q, k) => q.some((v, j) => Math.abs(v - (a[j] + ((z[j] - a[j]) * (k + 1)) / segs)) > (j < 2 ? 0.02 : 0.01)));
    if (bent) trail.set(id, list);
  }
  return trail;
}

function snapshot(ctx, trail) {
  const S = ctx.state;
  const sim = ctx.sim;
  let top = PIVOT_H + HUB;
  S.bodies = [...sim.bodies].map(([id, body]) => {
    const [x, y, a] = pose(body);
    const m = sim.meta.get(id);
    top = Math.max(top, y + extent(m.k, a).hi[1]);
    const b = { id, k: m.k, by: m.by, x, y, a };
    if (trail?.has(id)) b.p = trail.get(id);
    if (sim.chutes.has(id)) b.v = 1;
    return b;
  });
  S.top = r3(top);
  S.tilt = r3(sim.plank.getAngle());
  S.tiltP = trail?.get('_plank')?.map(q => q[2]) || null;
}

function fx(S, now, e) {
  S.fxNo = (S.fxNo || 0) + 1;
  S.fx = [...(S.fx || []), { n: S.fxNo, at: now, ...e }].slice(-6);
}

// 용암에 닿은 것: 짐 id들, 판 끝이 닿았으면 'plank'
function lavaHits(sim) {
  const hits = new Set();
  for (let ce = sim.lava.getContactList(); ce; ce = ce.next) {
    if (!ce.contact.isTouching()) continue;
    if (ce.other === sim.plank) hits.add('plank');
    else if (ce.other.getUserData()) hits.add(ce.other.getUserData());
  }
  for (const [id, body] of sim.bodies) {
    const p = body.getPosition();
    if (p.y < -1 || Math.abs(p.x) > 14) hits.add(id);
  }
  return hits;
}
const plankOnLava = sim => lavaHits(sim).has('plank') || Math.abs(sim.plank.getAngle()) >= LIMIT - 0.005;

function touching(body) {
  for (let ce = body.getContactList(); ce; ce = ce.next) if (ce.contact.isTouching()) return true;
  return false;
}
const speedOver = (body, v) => body.isAwake() && (body.getLinearVelocity().length() > v || Math.abs(body.getAngularVelocity()) > v);
const moving = body => speedOver(body, 0.05);
// 다 멈췄나: 모두 느려진 뒤 CALM_HOLD 동안 다시 움직인 게 없어야 한다 (방장 메모리).
// 판은 조금만 돌아도 다시 움직인 것(출렁이다 끝에서 돌아서는 순간에 얼리지 않게), 짐은 접촉 떨림을 무시하고 확실히 움직일 때만
function settled(ctx, now, items) {
  const plank = ctx.sim.plank;
  if (moving(plank) || items.some(b => speedOver(b, 0.12))) ctx.stillAt = 0;
  else if (!ctx.stillAt && !items.some(moving)) ctx.stillAt = now;
  return !!ctx.stillAt && now - ctx.stillAt >= CALM_HOLD;
}
const flying = body => body.isAwake() && (body.getLinearVelocity().length() > 0.3 || !touching(body));

function freeze(sim) {
  for (const body of sim.bodies.values()) body.setAwake(false);
  sim.plank.setAwake(false);
}
function wake(sim) {
  for (const body of sim.bodies.values()) body.setAwake(true);
  sim.plank.setAwake(true);
}

/* ───────── 진행 ───────── */

// 순서는 독박 타워처럼 바퀴마다 섞어서 모두 한 번씩 (방금 둔 사람이 새 바퀴 첫 순서가 되지 않게)
function newBag(S, justPlayed) {
  const bag = shuffle(S.alive);
  if (bag.length > 1 && bag[0] === justPlayed) {
    const k = 1 + Math.floor(Math.random() * (bag.length - 1));
    [bag[0], bag[k]] = [bag[k], bag[0]];
  }
  S.bag = bag;
  S.bagPos = 0;
  S.lap = (S.lap || 0) + 1;
  return bag[0];
}

function nextInBag(S, justPlayed) {
  const bag = S.bag || [];
  for (let i = (S.bagPos ?? -1) + 1; i < bag.length; i++) {
    if (!S.alive.includes(bag[i])) continue;
    S.bagPos = i;
    return bag[i];
  }
  return newBag(S, justPlayed);
}

// 다음 사람은 미리 정하지만 그 사람 짐은 비밀 — 차례가 시작될 때 룰렛으로 뽑는다 (악마 카드를 쓰면 그때 정해져 모두에게 보임)
function rollNext(S, now, after) {
  S.next = { id: nextInBag(S, after), kind: 'random', lap: S.lap, at: now };
}

function startTurn(ctx, now) {
  const S = ctx.state;
  const n = S.next;
  const devil = n.kind === 'devil';
  const fixed = devil && !n.high; // 꼭대기 카드는 짐은 룰렛 그대로
  const piece = fixed ? n.piece : rollPiece(S, n.id, n.lap);
  const rare = !fixed && RARE.has(piece);
  S.rareGap = rare ? RARE_GAP : Math.max(0, (S.rareGap || 0) - 1);
  Object.assign(S, {
    phase: 'spin',
    turn: n.id,
    spinKind: fixed ? 'devil' : 'roulette',
    piece,
    rare,
    high: !!(devil && n.high),
    chooser: devil ? n.by : null,
    turnLap: n.lap,
    spinEnd: now + SPIN_TIME + (rare ? RARE_SPIN : 0),
    aim: { x: (Math.random() < 0.5 ? -1 : 1) * AIM_START, a: 0 },
    fail: null,
    fallen: [],
    pieceId: null,
  });
  rollNext(S, now, S.turn);
  return true;
}

// 지금 차례인 사람만, 내 차례 동안(룰렛·조준·낙하·청소·고민) 다음 사람에게 쓸 수 있다
const canUseCard = (S, pid) => pid === S.turn && ['spin', 'aim', 'fall', 'clean', 'decide'].includes(S.phase)
  && (S.cards?.[pid] || 0) > 0 && !!S.next && S.next.kind !== 'devil';

function useCard(ctx, pid, i, now) {
  const S = ctx.state;
  const d = DEVILS[i];
  if (!d || !canUseCard(S, pid)) return false;
  S.cards = { ...S.cards, [pid]: S.cards[pid] - 1 };
  S.next = { ...S.next, piece: d.k || null, high: !!d.high, kind: 'devil', by: pid, at: now };
  S.cardUses = [...(S.cardUses || []), { by: pid, to: S.next.id, k: d.k || null, high: !!d.high, at: now }].slice(-8);
  ctx.announce(`😈 ${josa(ctx.nameOf(pid), '이', '가')} ${ctx.nameOf(S.next.id)}에게 악마 카드! → ${d.tag} ${devilName(d)}`);
  if (S.phase === 'decide') {
    S.phase = 'result';
    S.phaseEndsAt = now + RESULT_TIME;
  }
  return true;
}

function drop(ctx, now, aim) {
  const S = ctx.state;
  S.bodyNo = (S.bodyNo || 0) + 1;
  const id = `s${S.bodyNo}`;
  // 1cm 안쪽으로 살짝 흔든다: 평평한 판 정가운데(축 꼭대기)나 라바콘 끝 위에 딱 서 버리는 일이 없게
  const x = clampX((Number(aim?.x) || 0) + (Math.random() - 0.5) * 0.02);
  const a = snapA(Number(aim?.a) || 0);
  addBody(ctx.sim, { id, k: S.piece, by: S.turn, x, y: r3(spawnY(S, S.piece, x, a)), a, v: kindOf(S.piece).chute ? 1 : 0 }, true);
  Object.assign(S, { pieceId: id, phase: 'fall', dropAt: now, tiltBefore: Math.abs(S.tilt || 0), fail: null, fallen: [] });
  ctx.simAt = now;
  ctx.stillAt = 0;
  snapshot(ctx);
  return true;
}

// 용암에 처음 닿은 순간 기록 (판정은 다 멈춘 뒤에. 그동안 와르르 무너지는 걸 다 같이 본다)
function markLava(ctx, now) {
  const S = ctx.state;
  const hits = lavaHits(ctx.sim);
  const fresh = [...hits].filter(id => id !== 'plank' && !S.fallen.includes(id));
  const plank = hits.has('plank') && !S.fail?.plank;
  if (!fresh.length && !plank) return;
  S.fallen = [...S.fallen, ...fresh];
  if (!S.fail) {
    const p = fresh.length ? ctx.sim.bodies.get(fresh[0]).getPosition() : null;
    fx(S, now, { k: 'crash', x: r3(p ? p.x : ctx.sim.plank.getAngle() > 0 ? -HALF : HALF), plank });
  }
  S.fail = { plank: !!(S.fail?.plank || plank), n: S.fallen.length };
}

function stepFall(ctx, now) {
  const S = ctx.state;
  const trail = stepPhysics(ctx, now);
  markLava(ctx, now);
  snapshot(ctx, trail);
  const age = now - S.dropAt;
  // 용암에 빠진 건 빼고: 다 멈췄으면 끝. 공중에 뜨거나 빠르게 움직이는 게 있으면 결판날 때까지 기다린다
  const live = [...ctx.sim.bodies].filter(([id]) => !S.fallen.includes(id)).map(([, b]) => b);
  const calm = settled(ctx, now, live);
  if ((calm && age > 800) || (age > SETTLE_MAX && !live.some(flying)) || age > SETTLE_HARD) return settle(ctx, now);
  return true;
}

function settle(ctx, now) {
  const S = ctx.state;
  const active = S.turn;
  const name = ctx.nameOf;
  S.turnsPlayed = (S.turnsPlayed || 0) + 1;
  if (S.fail) {
    const why = S.fail.plank ? '판 끝이 용암에 닿음' : `짐 ${S.fallen.length}개 용암 퐁당`;
    S.lastResult = { id: active, ok: false, why, at: now };
    S.fails = [...(S.fails || []), { id: active, at: now, why }].slice(-8);
    if (S.alive.includes(active)) {
      S.alive = S.alive.filter(id => id !== active);
      S.outOrder = [...(S.outOrder || []), active];
      const killer = S.chooser && S.chooser !== active ? S.chooser : null;
      S.dead = { ...(S.dead || {}), [active]: killer || '-' };
      if (killer) {
        ctx.kill(killer, active, `😈 ${S.high ? '꼭대기에서 ' : ''}${kindOf(S.piece).name}`);
        S.kills = { ...(S.kills || {}), [killer]: (S.kills?.[killer] || 0) + 1 };
      } else {
        ctx.announce(`🌋 ${name(active)} 독박! (${kindOf(S.piece).name} · ${why})`);
      }
    }
    if (S.alive.length <= 1) {
      freeze(ctx.sim);
      snapshot(ctx);
      return finish(ctx);
    }
    return startClean(ctx, now);
  }
  freeze(ctx.sim);
  snapshot(ctx);
  S.lastResult = { id: active, ok: true, at: now };
  // 🎁 악마의 선물: 놓고 살아남으면 카드 +1 (바로 아래 afterTurn에서 고민 시간이 열린다)
  if (S.piece === 'gift' && S.alive.includes(active) && (S.cards?.[active] || 0) < MAX_CARDS) {
    S.cards = { ...S.cards, [active]: (S.cards?.[active] || 0) + 1 };
    fx(S, now, { k: 'gift', id: active });
    ctx.announce(`🎁 ${name(active)} 악마 카드 +1!`);
  }
  if (S.tiltBefore >= MIRACLE_FROM && Math.abs(S.tilt) <= MIRACLE_TO) {
    S.miracles = { ...(S.miracles || {}), [active]: (S.miracles?.[active] || 0) + 1 };
    fx(S, now, { k: 'miracle' });
    ctx.announce(`🪄 ${name(active)} 기적의 복구! (${deg(S.tiltBefore).toFixed(0)}° → ${deg(Math.abs(S.tilt)).toFixed(0)}°)`);
  }
  return afterTurn(ctx, now);
}

// 독박 뒤 청소: 떨어진 짐 + 방금 떨군 짐을 치우고, 판이 자리 잡을 때까지 기다린다
function startClean(ctx, now) {
  const S = ctx.state;
  for (const id of new Set([...S.fallen, S.pieceId])) removeBody(ctx.sim, id);
  wake(ctx.sim);
  Object.assign(S, { phase: 'clean', cleanAt: now, fallen: [], cleaned: 0 });
  ctx.simAt = now;
  ctx.stillAt = 0;
  snapshot(ctx);
  return true;
}

function tickClean(ctx, now) {
  const S = ctx.state;
  const sim = ctx.sim;
  const trail = stepPhysics(ctx, now);
  // 치우는 중에 또 떨어진 건 누구 탓도 아니다: 바로 퐁당
  for (const id of lavaHits(sim)) if (id !== 'plank') removeBody(sim, id);
  snapshot(ctx, trail);
  const age = now - S.cleanAt;
  const calm = settled(ctx, now, [...sim.bodies.values()]);
  if (age < 600 || (!calm && age < 4000)) return true;
  // 판이 아직 용암에 닿아 있거나 닿기 직전이면 낮은 쪽 끝 짐부터 치운다 (다음 사람이 이미 죽은 판을 받지 않게)
  if ((plankOnLava(sim) || Math.abs(sim.plank.getAngle()) > CLEAN_TO) && sim.bodies.size && S.cleaned < 12) {
    const low = sim.plank.getAngle() > 0 ? -1 : 1; // 각도 +면 왼쪽이 내려감
    const [id, body] = [...sim.bodies].sort(([, p], [, q]) => low * q.getPosition().x - low * p.getPosition().x)[0];
    fx(S, now, { k: 'poof', x: r3(body.getPosition().x), y: r3(body.getPosition().y) });
    removeBody(sim, id);
    wake(sim);
    S.cleaned++;
    S.cleanAt = now;
    ctx.stillAt = 0;
    snapshot(ctx);
    return true;
  }
  freeze(sim);
  snapshot(ctx);
  return afterTurn(ctx, now);
}

function afterTurn(ctx, now) {
  const S = ctx.state;
  Object.assign(S, { pieceId: null, fallen: [], fail: null });
  // 카드가 남았으면(독박 나서 유령이어도) 고민할 시간, 아니면 결과만 잠깐
  if (canUseCard({ ...S, phase: 'decide' }, S.turn)) {
    S.phase = 'decide';
    S.phaseEndsAt = now + DECIDE_TIME;
  } else {
    S.phase = 'result';
    S.phaseEndsAt = now + RESULT_TIME;
  }
  return true;
}

function finish(ctx) {
  const S = ctx.state;
  const placement = [...S.alive, ...[...(S.outOrder || [])].reverse()];
  for (const p of S.roster || ctx.roster) if (!placement.includes(p.id)) placement.push(p.id);
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  if (placement[0]) add(placement[0], '⚖️ 균형의 신');
  const best = obj => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])[0] || [];
  const [killer, kills] = best(S.kills);
  if (kills >= 1) add(killer, `😈 악마의 선택 (${kills}킬)`);
  const [hero, saves] = best(S.miracles);
  if (saves >= 1) add(hero, `🪄 기적의 복구${saves > 1 ? ` ×${saves}` : ''}`);
  Object.assign(S, {
    placement,
    standings: Object.fromEntries(placement.map((id, i) => [id, placement.length - i])),
    titles,
    next: null,
    phase: 'final',
    over: true,
  });
  return true;
}

/* ───────── 화면 ───────── */

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
}

export function objGroup(k) {
  return svg('g', { class: `po-obj po-${k}` }, kindOf(k).art.map(([tag, attrs]) => svg(tag, attrs)));
}

// 보급 상자 낙하산: 상자 위에 (상자가 돌아도 낙하산은 똑바로)
export function chuteGroup() {
  return svg('g', { class: 'ss-chute' },
    svg('path', { class: 'ss-canopy', d: 'M -0.75 1.05 Q -0.75 1.6 0 1.6 Q 0.75 1.6 0.75 1.05 Q 0.38 1.18 0 1.05 Q -0.38 1.18 -0.75 1.05 Z' }),
    svg('path', { class: 'ss-canopy-seam', d: 'M -0.3 1.1 Q -0.25 1.5 0 1.6 M 0.3 1.1 Q 0.25 1.5 0 1.6' }),
    ...[[-0.75, -0.45], [0, 0], [0.75, 0.45]].map(([x1, x2]) => svg('line', { class: 'ss-cord', x1, y1: 1.05, x2, y2: 0.35 })));
}

export function objIcon(k) {
  const e = extent(k, 0);
  const pad = 0.12;
  const w = e.hi[0] - e.lo[0] + pad * 2;
  const ht = e.hi[1] - e.lo[1] + pad * 2;
  return svg('svg', { viewBox: `${e.lo[0] - pad} ${-e.hi[1] - pad} ${w} ${ht}`, class: 'tw-icon' },
    svg('g', { transform: 'scale(1,-1)' }, objGroup(k)));
}

// 스프링 지그재그: 용암 위 (x, 0) → 판 밑 점
function springPoints(x, t) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  const tx = x * c + THICK * s;
  const ty = PIVOT_H + x * s - THICK * c;
  const n = 9;
  const pts = [[x, 0]];
  for (let i = 1; i < n; i++) {
    const f = i / n;
    pts.push([x + (tx - x) * f + (i % 2 ? 0.14 : -0.14), ty * f]);
  }
  pts.push([tx, ty]);
  return pts.map(([px, py]) => `${px.toFixed(3)},${py.toFixed(3)}`).join(' ');
}

export default {
  id: 'seesaw',
  title: '독박 시소',
  emoji: '⚖️',
  tag: '우정파괴',
  color: '#d9480f',
  desc: '용암 위 시소에 돌아가며 짐을 떨궈요. 짐은 🎰 룰렛! 무거운 쪽으로 기울어요. 짐이 떨어지거나 판 끝이 용암에 닿으면 독박',
  minPlayers: 2,
  maxPlayers: 8,

  setup(ctx, prev) {
    ensurePlanck();
    return {
      phase: 'intro',
      phaseEndsAt: ctx.now() + (prev ? AGAIN_INTRO : INTRO_TIME),
      again: !!prev,
      alive: ctx.roster.map(p => p.id),
      cards: Object.fromEntries(ctx.roster.map(p => [p.id, DEVIL_CARDS])),
      tilt: 0,
      top: PIVOT_H + HUB,
      turnsPlayed: 0,
      lap: 0,
      fallen: [],
    };
  },

  onInput(ctx, { pid, type, data }) {
    const S = ctx.state;
    const now = ctx.now();
    if (type === 'aim' && S.phase === 'aim' && pid === S.turn) {
      S.aim = { x: clampX(Number(data.x) || 0), a: snapA(Number(data.a) || 0) };
      return true;
    }
    if (type === 'drop' && S.phase === 'aim' && pid === S.turn && ctx.sim) return drop(ctx, now, data);
    if (type === 'devil' && Number.isInteger(data.i)) return useCard(ctx, pid, data.i, now);
    if (type === 'pass' && S.phase === 'decide' && pid === S.turn) return startTurn(ctx, now);
    return false;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    if (!planck) {
      ensurePlanck();
      return false; // 엔진 받는 중 (인트로 동안 충분히 받아진다)
    }
    if (!ctx.sim) {
      ctx.sim = makeSim(S);
      ctx.simAt = now;
    }
    switch (S.phase) {
      case 'intro': {
        if (now < S.phaseEndsAt) return false;
        S.next = { id: newBag(S, null), kind: 'random', lap: S.lap, at: now };
        return startTurn(ctx, now);
      }
      case 'spin':
        if (now < S.spinEnd) return false;
        S.phase = 'aim';
        S.phaseEndsAt = now + aimTime(S.turnLap);
        return true;
      case 'aim':
        if (now < S.phaseEndsAt && ctx.isOnline(S.turn)) return false;
        return drop(ctx, now, S.aim); // 시간 끝: 지금 조준한 자리에 그대로
      case 'fall':
        return stepFall(ctx, now);
      case 'clean':
        return tickClean(ctx, now);
      case 'decide':
        if (now < S.phaseEndsAt && ctx.isOnline(S.turn)) return false;
        return startTurn(ctx, now);
      case 'result':
        return now >= S.phaseEndsAt && startTurn(ctx, now);
      default:
        return false;
    }
  },

  // 봇: 판에 걸린 무게를 상쇄하는 자리를 노린다 (사람처럼 ±0.5m 빗나감, 가운데 축은 피함). 납작한 방향으로 눕혀서.
  // 악마 카드는 판이 많이 기울었을수록·막판일수록·죽었을 때 잘 쓴다.
  bot(ctx, id, mem) {
    const S = ctx.state;
    const now = ctx.now();
    if (canUseCard(S, id)) {
      const key = `${S.turnsPlayed}:${S.turn}`;
      if (mem.cardKey !== key) {
        mem.cardKey = key;
        const chance = 0.25 + Math.min(0.3, deg(Math.abs(S.tilt || 0)) * 0.04) + (S.alive.length <= 2 ? 0.3 : 0) + (S.alive.includes(id) ? 0 : 0.4);
        mem.useCard = Math.random() < chance;
        mem.cardAt = now + 2000 + Math.random() * 5000;
        mem.passAt = 0;
      }
      if (mem.useCard && (now >= mem.cardAt || S.phase === 'decide')) {
        mem.useCard = false;
        return { type: 'devil', data: { i: Math.floor(Math.random() * DEVILS.length) }, say: Math.random() < 0.5 };
      }
      if (S.phase === 'decide' && !mem.useCard) {
        mem.passAt ||= now + 800 + Math.random() * 1200;
        return now >= mem.passAt ? { type: 'pass' } : null;
      }
    }
    if (S.phase === 'aim' && S.turn === id) {
      const key = `${S.turnsPlayed}`;
      if (mem.key !== key) {
        const k = S.piece;
        const torque = (S.bodies || []).reduce((t, b) => t + massOf(b.k) * (b.x + comOf(b.k, b.a)[0]), 0);
        // 무게중심을 둘 자리 (사람처럼 ±0.5m 빗나감). 가벼운 건 끝까지 안 가져간다
        const reach = massOf(k) * KG < 10 ? 2 : 3.5;
        let x = Math.max(-reach, Math.min(reach, -torque / massOf(k))) + (Math.random() - 0.5);
        const height = a => extent(k, a).hi[1] - extent(k, a).lo[1];
        let a = height(Math.PI / 2) < height(0) - 0.05 ? r3(Math.PI / 2) : 0;
        if (k === 'barbell') x = Math.max(-0.3, Math.min(0.3, x * 0.2)); // 원판 사이에 가운데 축을 끼운다
        else if (Math.abs(x) < HUB + 0.35) x = (x < 0 ? -1 : 1) * (HUB + 0.35 + Math.random() * 0.5);
        if (k === 'roly' || k === 'cone' || k === 'barbell') a = 0;  // 세워서
        if (k === 'cart') a = r3(Math.PI);                            // 바퀴를 위로
        if (k === 'hammer') a = x > 0 ? r3(Math.PI) : 0;              // 쇠머리를 안쪽으로
        if (k === 'anchor') a = r3(x > 0 ? -Math.PI / 2 : Math.PI / 2); // 크라운(무거운 쪽)을 안쪽으로 눕혀서
        Object.assign(mem, {
          key, x: S.aim?.x || 0, tx: clampX(x - comOf(k, a)[0]), ta: a,
          dropAt: now + 1800 + Math.random() * 3000, sent: 0,
        });
      }
      if (now >= mem.dropAt) return { type: 'drop', data: { x: mem.tx, a: mem.ta }, say: Math.random() < 0.1 };
      if (now - mem.sent > 150) {
        mem.sent = now;
        mem.x += Math.sign(mem.tx - mem.x) * Math.min(0.4, Math.abs(mem.tx - mem.x));
        return { type: 'aim', data: { x: mem.x, a: mem.ta } };
      }
    }
    return null;
  },

  mount(root, api) {
    const me = api.me;
    const top = h('div', { class: 'ss-top' });
    // 기울기 바늘: 낮은 쪽으로 움직이고, 양끝(빨강) = 판 끝이 용암에 닿는 기울기
    const needle = h('b');
    const tiltText = h('span', {}, '0°');
    const meter = h('div', { class: 'ss-tilt' }, '⚖️', h('div', { class: 'ss-meter' }, needle), tiltText);
    const springs = [-SPRING_X, SPRING_X].map(() => svg('polyline', { class: 'ss-spring' }));
    const plankG = svg('g', { class: 'ss-plank' },
      svg('rect', { class: 'ss-board', x: -HALF, y: -THICK, width: HALF * 2, height: THICK * 2, rx: 0.03 }),
      svg('circle', { class: 'ss-hub', r: HUB }),
      ...[-1, 1].map(s => svg('rect', { class: 'ss-lip', x: s * (HALF - 0.06) - 0.06, y: THICK, width: 0.12, height: LIP * 2, rx: 0.02 })));
    const bodiesG = svg('g');
    const chutesG = svg('g');
    const labelsG = svg('g');
    const guide = svg('line', { class: 'ss-guide', x1: 0, y1: 0, x2: 0, y2: 0 });
    const previewPiece = svg('g');
    const previewLabel = svg('text', { class: 'ss-kg', transform: 'scale(1,-1)' });
    const previewChute = chuteGroup();
    const previewG = svg('g', { class: 'ss-preview' }, guide, previewChute, previewPiece, previewLabel);
    const popG = svg('g');
    let wave = 'M -22 0';
    for (let i = 0; i < 22; i++) wave += ' q 0.5 0.14 1 0 q 0.5 -0.14 1 0';
    const world = svg('g', { transform: 'scale(1,-1)' },
      svg('rect', { class: 'ss-lava', x: -22, y: -3, width: 44, height: 3 }),
      svg('path', { class: 'ss-lava-top', d: `${wave} L 22 -0.25 L -22 -0.25 Z` }),
      ...springs,
      svg('polygon', { class: 'ss-pivot', points: `-0.55,0 0.55,0 0,${PIVOT_H - 0.12}` }),
      plankG, bodiesG, chutesG, labelsG, previewG, popG);
    const stage = svg('svg', { class: 'ss-svg', preserveAspectRatio: 'xMidYMax meet' }, world);
    const fxBox = h('div', { class: 'ss-fx' });
    const nextBox = h('div', { class: 'tw-next', hidden: true });
    const panel = h('div', { class: 'ss-panel' });
    const box = h('div', { class: 'ss-box' }, top, h('div', { class: 'ss-stage' }, stage, nextBox, fxBox), panel);
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'ss' }, box, side));
    document.activeElement?.blur?.();

    let S = null;
    const shown = new Map(); // id → { el, label, keys, t }
    const plankIt = { keys: [{ x: 0, y: 0, a: 0 }, { x: 0, y: 0, a: 0 }], t: 0 };
    let camTop = 5;
    let panelKey = '';
    let nextKey = '';
    let topKey = '';
    let sideKey = '';
    let reelTimer = 0;
    let seenFail = null;
    let seenCard = null;
    let seenFx = null;
    let seenLap = null;
    // 내 차례 조준: 내 화면에서 바로 움직이고 방장에게는 가끔 알려 준다
    const aim = { x: 0, a: 0, turnKey: '', dropped: false, sentAt: 0, sent: '', last: 0 };
    const held = { left: false, right: false };
    const who = id => S.roster.find(p => p.id === id) || { id, name: '?' };
    const myTurn = () => S?.phase === 'aim' && S.turn === me;
    const devilOf = k => DEVILS.find(d => d.k === k);
    const label = (k, devil) => `${devil ? `😈 ${devilOf(k)?.tag || ''} ` : ''}${kindOf(k).name}`;
    const nextLabel = () => (S.next?.kind !== 'devil' ? '❓ 랜덤' : S.next.high ? '😈 ⬆️ 꼭대기에서 (짐은 랜덤)' : label(S.next.piece, true));
    // 악마 카드 그림: 짐이면 짐 그림, 꼭대기 카드면 떨구는 높이
    const devilIcon = d => (d.high ? h('span', { class: 'ss-high-icon' }, `${DROP_MAX}m`) : objIcon(d.k));

    function onKey(e) {
      if (isTyping(e) || !S) return;
      const down = e.type === 'keydown';
      const c = e.code;
      // 악마 카드: 내 차례 동안 숫자키 1~6, 다 놓은 뒤 고민 중엔 스페이스 = 안 씀
      if (down && !e.repeat && canUseCard(S, me)) {
        const d = digitOf(e);
        if (d >= 1 && d <= DEVILS.length) {
          e.preventDefault();
          api.send('devil', { i: d - 1 });
          return;
        }
        if (c === 'Space' && S.phase === 'decide') {
          e.preventDefault();
          api.send('pass');
          return;
        }
      }
      if (c === 'ArrowLeft' || c === 'KeyA' || c === 'ArrowRight' || c === 'KeyD') {
        if (!myTurn()) return;
        const left = c === 'ArrowLeft' || c === 'KeyA';
        e.preventDefault();
        held[left ? 'left' : 'right'] = down;
        // 톡 치면 조금(미세 조정), 꾹 누르면 계속 이동
        if (down && !e.repeat && !aim.dropped) {
          aim.x = clampX(aim.x + (left ? -0.2 : 0.2));
          sendAim();
        }
        return;
      }
      if (!down || !myTurn()) return;
      if (c === 'ArrowUp' || c === 'KeyW' || c === 'ArrowDown' || c === 'KeyS') {
        e.preventDefault();
        aim.a = snapA(aim.a + (c === 'ArrowUp' || c === 'KeyW' ? 1 : -1) * (Math.PI / 2));
        sendAim();
      } else if (c === 'Space' && !e.repeat && !aim.dropped) {
        e.preventDefault();
        aim.dropped = true;
        api.send('drop', { x: aim.x, a: aim.a });
        renderPanel();
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    function sendAim() {
      const key = `${aim.x.toFixed(2)}:${aim.a.toFixed(3)}`;
      if (key === aim.sent) return;
      aim.sent = key;
      aim.sentAt = performance.now();
      api.send('aim', { x: aim.x, a: aim.a });
    }

    function syncBodies() {
      const now = performance.now();
      const live = new Set();
      for (const b of S.bodies || []) {
        live.add(b.id);
        const it = shown.get(b.id);
        // 낙하산은 처음 닿는 순간 접힌다
        it?.chute?.classList.toggle('folded', !b.v);
        if (!it) {
          const el = svg('g', { class: 'ss-item' }, objGroup(b.k));
          const lb = svg('text', { class: 'ss-kg' }, kgText(b.k));
          const chute = kindOf(b.k).chute ? chuteGroup() : null;
          chute?.classList.toggle('folded', !b.v);
          bodiesG.append(el);
          labelsG.append(lb);
          if (chute) chutesG.append(chute);
          shown.set(b.id, { el, label: lb, chute, k: b.k, keys: [b, b], t: now });
          continue;
        }
        const last = it.keys[it.keys.length - 1];
        if (last.x === b.x && last.y === b.y && last.a === b.a) continue;
        // 지금 그리던 자리 → 방장이 보낸 중간 자리들 → 새 자리를 차례로 따라간다
        it.keys = [current(it, now), ...(b.p || []).map(([x, y, a]) => ({ x, y, a })), b];
        it.t = now;
      }
      for (const [id, it] of shown) {
        if (live.has(id)) continue;
        it.el.remove();
        it.label.remove();
        it.chute?.remove();
        shown.delete(id);
      }
      const fallen = new Set(S.fallen || []);
      for (const [id, it] of shown) it.el.classList.toggle('burning', fallen.has(id));
      const lastA = plankIt.keys[plankIt.keys.length - 1].a;
      if (lastA !== S.tilt) {
        plankIt.keys = [current(plankIt, now), ...(S.tiltP || []).map(a => ({ x: 0, y: 0, a })), { x: 0, y: 0, a: S.tilt || 0 }];
        plankIt.t = now;
      }
    }

    function current(it, now) {
      const { keys } = it;
      const k = Math.min(1, (now - it.t) / 110) * (keys.length - 1);
      const i = Math.min(keys.length - 2, Math.floor(k));
      const f = k - i;
      const p = keys[i];
      const q = keys[i + 1];
      let da = q.a - p.a;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, a: p.a + da * f };
    }

    function paint() {
      if (!S) return;
      const now = performance.now();
      if (myTurn() && !aim.dropped) {
        const dt = Math.min(0.05, (now - (aim.last || now)) / 1000);
        const dir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
        if (dir) aim.x = clampX(aim.x + dir * MOVE_SPEED * dt);
        if (now - aim.sentAt > 120) sendAim();
      }
      aim.last = now;
      const t = current(plankIt, now).a;
      plankG.setAttribute('transform', `translate(0 ${PIVOT_H}) rotate(${deg(t)})`);
      springs.forEach((el, i) => el.setAttribute('points', springPoints(i ? SPRING_X : -SPRING_X, t)));
      const f = Math.max(-1, Math.min(1, t / LIMIT));
      needle.style.left = `${50 - f * 50}%`;
      tiltText.textContent = `${deg(Math.abs(t)).toFixed(1)}°`;
      meter.classList.toggle('hot', Math.abs(f) > 0.7);
      for (const it of shown.values()) {
        const p = current(it, now);
        it.el.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${deg(p.a)})`);
        // 무게표는 무게중심에 (오함마는 쇠머리 쪽)
        const [cx, cy] = comOf(it.k, p.a);
        it.label.setAttribute('transform', `translate(${p.x + cx} ${p.y + cy}) scale(1,-1)`);
        it.chute?.setAttribute('transform', `translate(${p.x} ${p.y})`);
      }
      // 조준 중인 짐 미리보기 (떨어질 높이 그대로, 점선은 똑바로 아래로)
      let previewTop = 0;
      if (S.phase === 'aim' && S.piece) {
        const p = myTurn() ? aim : S.aim || { x: 0, a: 0 };
        const y = spawnY(S, S.piece, p.x, p.a);
        if (previewG.dataset.key !== `${S.turnsPlayed}:${S.piece}`) {
          previewG.dataset.key = `${S.turnsPlayed}:${S.piece}`;
          previewPiece.replaceChildren(objGroup(S.piece));
          previewLabel.textContent = kgText(S.piece);
        }
        previewG.style.display = '';
        previewG.setAttribute('transform', `translate(${p.x} ${y})`);
        guide.setAttribute('y2', -y);
        previewPiece.setAttribute('transform', `rotate(${deg(p.a)})`);
        const [cx, cy] = comOf(S.piece, p.a);
        previewLabel.setAttribute('transform', `translate(${cx} ${cy}) scale(1,-1)`);
        const chute = !!kindOf(S.piece).chute;
        previewChute.style.display = chute ? '' : 'none';
        previewTop = y + (chute ? 1.6 : extent(S.piece, p.a).hi[1]);
      } else {
        previewG.style.display = 'none';
      }
      // 카메라: 판이 다 보이게, 짐이 높이 쌓이면 위로
      const want = Math.max(5, (S.top || 0) + 1.5, previewTop + 0.6);
      camTop += (want - camTop) * 0.08;
      const half = Math.max(6, camTop * 1.1);
      stage.setAttribute('viewBox', `${-half} ${-camTop} ${half * 2} ${camTop + 0.9}`);
    }

    let raf = requestAnimationFrame(function loop() {
      paint();
      raf = requestAnimationFrame(loop);
    });

    function flash(text, cls = '') {
      const el = h('div', { class: `ss-flash ${cls}` }, text);
      fxBox.append(el);
      setTimeout(() => el.remove(), 1800);
    }
    function shake() {
      box.classList.remove('shaking');
      void box.offsetWidth;
      box.classList.add('shaking');
      setTimeout(() => box.classList.remove('shaking'), 500);
    }
    function burst(x, y, text) {
      const el = svg('text', { class: 'ss-burst', transform: `translate(${x} ${y}) scale(1,-1)` }, text);
      popG.append(el);
      setTimeout(() => el.remove(), 700);
    }

    function checkEvents() {
      if (seenLap !== null && S.turnLap > seenLap && S.turnLap > 1) flash(`🎲 ${S.turnLap}바퀴! 순서 다시 섞음`);
      seenLap = S.turnLap || 0;
      const fails = S.fails || [];
      const cards = S.cardUses || [];
      const list = S.fx || [];
      if (seenFail === null) {
        seenFail = Math.max(0, ...fails.map(x => x.at));
        seenCard = Math.max(0, ...cards.map(x => x.at));
        seenFx = Math.max(0, ...list.map(e => e.n));
        return;
      }
      for (const e of list) {
        if (e.n <= seenFx) continue;
        seenFx = e.n;
        if (e.k === 'crash') {
          flash(e.plank ? '🌋 판 끝이 용암에 닿았다!' : '🌋 용암 퐁당!', 'bad');
          burst(e.x, 0.3, '🔥');
          shake();
        } else if (e.k === 'miracle') {
          flash('🪄 기적의 복구!');
        } else if (e.k === 'poof') {
          burst(e.x, e.y, '💨');
        } else if (e.k === 'gift') {
          flash(`🎁 ${who(e.id).name} 악마 카드 +1!`);
        }
      }
      for (const f of fails) {
        if (f.at <= seenFail) continue;
        seenFail = f.at;
        flash(`💥 ${who(f.id).name} 독박!`, 'bad');
      }
      for (const u of cards) {
        if (u.at <= seenCard) continue;
        seenCard = u.at;
        flash(`😈 ${who(u.by).name}의 ${u.high ? '⬆️ 꼭대기에서' : '바꿔치기'} → ${who(u.to).name}`, 'bad');
        shake();
      }
    }

    // NEXT: 다음 사람. 짐은 '?' (차례 때 룰렛) — 악마 카드로 정해졌으면 그 짐이 빨갛게 보인다
    function renderNext() {
      const n = S.next;
      const show = !!n && ['spin', 'aim', 'fall', 'clean', 'decide', 'result'].includes(S.phase);
      nextBox.hidden = !show;
      if (!show) return;
      const key = `${n.id}:${n.at}:${n.kind}`;
      if (key === nextKey) return;
      nextKey = key;
      const devil = n.kind === 'devil';
      nextBox.classList.toggle('devil', devil);
      nextBox.replaceChildren(...[
        h('div', { class: 'tw-next-label' }, n.id === me ? 'NEXT · 나!' : 'NEXT'),
        h('div', { class: 'name-chip' }, avatar(who(n.id)), who(n.id).name),
        devil && !n.high ? h('div', { class: 'tw-next-reel' }, objIcon(n.piece)) : h('div', { class: 'tw-mystery' }, devil ? '⬆️' : '?'),
        h('div', { class: 'tw-next-piece' }, !devil ? '🎰 랜덤' : n.high ? '😈 꼭대기에서 · 짐은 🎰' : `${label(n.piece, true)} ${kgText(n.piece)}`),
        devil ? h('div', { class: 'tw-next-by' }, `😈 ${josa(who(n.by).name, '이', '가')} 정함`) : null,
      ].filter(Boolean));
    }

    // 차례 시작: 룰렛이 촤라락 돌다가 멈춘다 (악마 카드로 정해졌으면 바로 공개)
    function runReel(reel, name) {
      clearTimeout(reelTimer);
      const final = S.piece;
      const end = S.spinEnd;
      const rare = S.rare;
      const total = SPIN_TIME + (rare ? RARE_SPIN : 0);
      const land = () => {
        reel.replaceChildren(objIcon(final));
        reel.classList.add('land');
        reel.classList.toggle('rare', !!rare);
        name.textContent = `${rare ? '✨ ' : ''}${label(final, S.spinKind === 'devil')} ${kgText(final)}!`;
        if (rare && api.now() - end < 500) flash('✨ 레어!', 'rare');
      };
      if (S.spinKind === 'devil') return land();
      const step = () => {
        const left = end - api.now();
        if (left <= 0) return land();
        reel.replaceChildren(objIcon(pick(ROULETTE).k));
        const k = Math.min(1, Math.max(0, 1 - left / total));
        reelTimer = setTimeout(step, 45 + 240 * k * k);
      };
      step();
    }

    function renderTop() {
      const timer = S.phase === 'aim' ? [S.phaseEndsAt, aimTime(S.turnLap)] : S.phase === 'decide' ? [S.phaseEndsAt, DECIDE_TIME] : null;
      const key = JSON.stringify([S.turnLap, (S.bodies || []).length, S.phase === 'spin', timer]);
      if (key === topKey) return;
      topKey = key;
      top.replaceChildren(...[
        h('span', {}, S.turnLap ? `${S.turnLap}바퀴` : '곧 시작'),
        h('span', {}, `짐 ${(S.bodies || []).length}개`),
        meter,
        S.phase === 'spin' ? h('span', {}, '🎰 룰렛!') : null,
        timer ? countdown(timer[0], timer[1]) : null,
      ].filter(Boolean));
    }

    // 악마 카드 버튼들 (작게: 내 차례 중, 크게: 다 놓고 고민할 때)
    function devilButtons(big) {
      return DEVILS.map((d, i) => h('button', {
        class: big ? 'tw-option devil' : 'tw-devil-btn', tabindex: '-1',
        onClick: () => api.send('devil', { i }),
      }, h('kbd', { class: big ? 'num' : '' }, String(i + 1)), devilIcon(d), h('b', {}, d.high ? d.tag : `${d.tag} ${kindOf(d.k).name}`),
      big ? h('em', {}, d.high ? `짐은 랜덤 · ${DROP_MAX}m에서 쿵` : kgText(d.k)) : null));
    }

    function devilStrip() {
      if (!canUseCard(S, me)) return null;
      return h('div', { class: 'tw-devil' },
        h('b', {}, `😈 악마 카드: ${who(S.next.id).name}의 다음 짐(?)을 내가 정하기`),
        devilButtons(false),
        h('span', { class: 'muted small' }, `지금 안 써도 짐이 멈춘 뒤 ${DECIDE_TIME / 1000}초 더 고민할 수 있어요`));
    }

    function panelView() {
      if (S.phase === 'intro') {
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, '⚖️ 독박 시소'),
          S.again ? null : h('ul', { class: 'rules big' },
            h('li', {}, '돌아가며 용암 위 시소에 짐을 떨궈요. 짐은 🎰 룰렛으로 랜덤 (무게도 보여요)'),
            h('li', {}, '무거운 쪽으로 기울어요. 반대쪽에 올려서 균형을 맞추세요'),
            h('li', {}, '짐이 용암에 떨어지거나 판 끝이 용암에 닿으면 독박!'),
            h('li', {}, '가운데 둥근 축 위에 놓으면 한쪽으로 굴러가요'),
            h('li', {}, `😈 악마 카드 ${DEVIL_CARDS}장: 내 차례 동안 숫자키 1~6으로 다음 사람 짐을 금고·볼링공·얼음·돌침대·닻 중 하나로, 또는 ⬆️ 꼭대기에서 떨구게 (그걸로 죽으면 내 킬)`),
            h('li', {}, '✨ 가끔 레어 짐: 🪂 보급 상자(낙하산) · 🎁 악마의 선물(놓고 살면 카드 +1)'),
            h('li', {}, '← → 위치 · ↑ ↓ 돌리기 · 스페이스 떨구기')),
          countdown(S.phaseEndsAt, S.again ? AGAIN_INTRO : INTRO_TIME));
      }
      if (S.phase === 'final') {
        return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, `👑 ${who(S.placement?.[0]).name} 균형의 신!`), podium(S.roster, S.standings, me));
      }
      const from = S.chooser ? `${who(S.chooser).name}의 😈 ${S.high ? '⬆️ 꼭대기에서 · 🎰 ' : ''}` : '🎰 ';
      const piece = `${kindOf(S.piece).name} ${kgText(S.piece)}`;
      if (S.phase === 'spin') {
        const reel = h('div', { class: `tw-reel${S.spinKind === 'devil' ? ' devil' : ''}` });
        const name = h('div', { class: 'tw-reel-name' });
        queueMicrotask(() => runReel(reel, name));
        const whose = S.turn === me ? '내' : `${who(S.turn).name}의`;
        return h('div', { class: 'bt-act' },
          h('div', { class: `bt-act-title${S.spinKind === 'devil' ? ' hot' : ''}` },
            S.spinKind === 'devil' ? `😈 ${josa(who(S.chooser).name, '이', '가')} 정한 ${whose} 짐!`
              : S.high ? `😈 ${who(S.chooser).name}의 ⬆️ 꼭대기에서! ${whose} 짐은…` : `🎰 ${whose} 짐은…`),
          reel, name, S.turn === me ? devilStrip() : null);
      }
      if (S.phase === 'aim') {
        if (S.turn === me) {
          if (aim.dropped) return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, '떨궜다! 🙏'), devilStrip());
          return h('div', { class: 'bt-act' },
            h('div', { class: 'bt-act-title hot' }, `내 차례! ${from}${piece}`),
            h('p', {}, '← → 위치 · ↑ ↓ 돌리기 · 스페이스 떨구기'),
            devilStrip());
        }
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, `${who(S.turn).name} 차례`),
          h('p', {}, `${from}${piece} 놓는 중…`),
          S.next?.id === me ? h('p', { class: 'muted' }, S.next.kind === 'devil' ? `😰 다음은 나… ${nextLabel()} 확정` : '😰 다음은 나! 내 짐은 ?') : null);
      }
      if (S.phase === 'fall') {
        return h('div', { class: 'bt-act' }, h('div', { class: 'bt-act-title' }, S.fail ? '🌋 으아아…' : '버텨라… 😬'), S.turn === me ? devilStrip() : null);
      }
      if (S.phase === 'clean') {
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, `💥 ${who(S.turn).name} 독박!`),
          h('p', {}, '🌋 떨어진 짐은 용암으로 퐁당…'),
          S.turn === me ? devilStrip() : null);
      }
      if (S.phase === 'decide') {
        const next = who(S.next.id);
        if (S.turn === me) {
          return h('div', { class: 'bt-act' },
            h('div', { class: 'bt-act-title hot' }, `😈 ${next.name}한테 악마 카드 쓸래?`),
            h('p', {}, `안 쓰면 ${next.name}의 짐은 🎰 랜덤(?) · 남은 카드 ${S.cards?.[me] || 0}장`),
            h('div', { class: 'tw-options ss-devils' }, devilButtons(true)),
            h('p', { class: 'muted' }, '숫자키 1~6 = 이걸로 · 스페이스 = 안 씀'));
        }
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, `😈 ${josa(who(S.turn).name, '이', '가')} 악마 카드 고민 중…`),
          h('p', {}, S.next.id === me ? '😰 다음은 나… 제발 쓰지 마' : `다음: ${next.name}`));
      }
      if (S.phase === 'result') {
        const r = S.lastResult;
        return h('div', { class: 'bt-act' },
          h('div', { class: 'bt-act-title' }, r && !r.ok ? `💥 ${who(r.id).name} 독박! (${r.why})` : '✅ 버텼다!'),
          h('p', {}, `다음: ${who(S.next.id).name} · ${nextLabel()}`));
      }
      return h('div');
    }

    function renderPanel() {
      const key = [S.phase, S.turnsPlayed, S.turn, S.spinEnd, aim.dropped, S.next?.kind, S.cards?.[me], !!S.fail].join('|');
      if (key === panelKey) return;
      panelKey = key;
      clearTimeout(reelTimer);
      panel.replaceChildren(panelView());
    }

    function renderSide() {
      // 떨어지는 동안엔 상태가 초당 10번 오니, 순서·탈락·카드가 바뀔 때만 다시 그린다 (얼굴 그림이 무거움)
      const key = JSON.stringify([S.lap, S.alive, S.turn, S.next?.id, S.bag, S.bagPos, S.cards, S.outOrder, S.dead]);
      if (key === sideKey) return;
      sideKey = key;
      const deadList = (S.outOrder || []).map(id => {
        const by = S.dead?.[id];
        return h('li', {}, h('b', {}, who(id).name), by && by !== '-' ? ` ← ${who(by).name}의 😈` : ' 🌋 용암');
      });
      const bag = (S.bag || []).map((id, i) => {
        const dead = !S.alive.includes(id);
        const cls = dead ? 'dead' : id === S.turn ? 'now' : id === S.next?.id ? 'next' : i < (S.bagPos ?? 0) ? 'done' : '';
        return h('li', { class: cls }, avatar(who(id)), h('span', {}, who(id).name),
          (S.cards?.[id] || 0) > 0 ? h('i', { class: 'tw-card', title: '악마 카드 남음' }, '😈') : null,
          cls === 'now' ? h('em', {}, '차례') : cls === 'next' ? h('em', {}, '다음') : cls === 'done' ? h('em', {}, '✓') : null);
      });
      side.replaceChildren(...[
        h('h3', {}, S.lap ? `${S.lap}바퀴 순서 · 생존 ${S.alive.length}명` : `생존 ${S.alive.length}명`),
        bag.length
          ? h('ol', { class: 'tw-bag' }, bag)
          : h('div', { class: 'tc-alive' }, S.alive.map(id => h('span', { class: 'tc-alive-chip' }, avatar(who(id)), who(id).name))),
        deadList.length ? h('h3', {}, '독박 기록') : null,
        deadList.length ? h('ul', { class: 'rules' }, deadList) : null,
        h('h3', {}, '조작'),
        h('ul', { class: 'rules' },
          h('li', {}, '← → (A D) 위치 · 톡 치면 미세 조정'),
          h('li', {}, '↑ ↓ (W S) 90° 돌리기'),
          h('li', {}, '스페이스 떨구기'),
          h('li', {}, '😈 악마 카드: 내 차례 동안 숫자키 1~6'),
          h('li', {}, '다 놓고 고민할 땐 스페이스 = 안 씀')),
      ].filter(Boolean));
    }

    return {
      update({ state }) {
        S = state;
        const turnKey = `${S.turnsPlayed}:${S.turn}`;
        if (aim.turnKey !== turnKey) {
          // 조준은 방장이 정한 시작 자리(가운데에서 살짝 옆)에서
          Object.assign(aim, { turnKey, x: S.aim?.x || 0, a: 0, dropped: false, sent: '' });
          held.left = held.right = false;
          // 순서가 바퀴마다 섞여서 헷갈리니, 내 차례가 오면 작게 알려 준다
          if (S.turn === me && S.phase === 'spin' && S.alive?.includes(me)) flash('👉 내 차례!', 'mine');
        }
        syncBodies();
        checkEvents();
        renderTop();
        renderNext();
        renderPanel();
        renderSide();
      },
      unmount() {
        cancelAnimationFrame(raf);
        clearTimeout(reelTimer);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
      },
    };
  },
};
