// 그랑프리의 트랙과 공통 물리. 카트 코스는 방장이 모든 차량을 같은 걸음으로 움직인다.
// 트랙 = 가운데 선(점들) + 구간별 폭·벽·노면. 기획서의 8자 스케치 좌표(px)를 0.4m로 옮겼다.
// 좌표: x 오른쪽, y 아래 (화면과 같음). 옆 위치(lat)는 달리는 방향의 오른쪽이 +.

export const LAPS = 1;
export const CAR_R = 0.7;
const SCALE = 0.4;            // 스케치 1px = 0.4m
const SAMPLE = 1.5;           // 가운데 선 점 간격 (m)
const WINDOW = 24;            // 내 위치를 찾을 때 지금 자리 앞뒤로 볼 점 수 (8자 교차에서 다른 층을 잡지 않게)

// 조작감: 처음부터 세게 민다. 차 몸통은 누른 방향으로 돌고, 타이어는 몸통 옆으로 미끄러지는 걸 줄인다.
// 빠를수록 몸통이 천천히 돌고 타이어 힘에 한계가 있어서 바깥으로 밀린다(언더스티어).
// 너무 급하게 꺾어서 옆으로 크게 미끄러지면 꼬리가 빠져서(드리프트) 몸통이 더 돌아간다(오버스티어)
export const PHYS = {
  thrust: 34,     // 가속 (m/s²) — 범퍼카는 12에서 시작해 3초에 걸쳐 40
  max: 21,        // 최고 속도 (m/s) — 범퍼카 13
  drag: 0.35,     // 얼음 마찰: 손을 떼도 1초에 3할만 줄어든다 (브레이크는 반대 방향)
  grip: 6,        // 몸통 옆으로 미끄러지는 속도가 초당 줄어드는 비율
  gripMax: 50,    // 타이어가 옆으로 버티는 힘의 한계 (m/s²)
  yaw: [11, 5],   // 몸통이 도는 최대 속도 (rad/s): 섰을 때 → 최고 속도일 때
  slipOn: 9,      // 옆으로 이만큼(m/s) 미끄러지면 꼬리가 빠짐
  slipOff: 2.5,   // 이만큼 줄면 다시 붙음
  slide: 0.6,     // 꼬리가 빠진 동안 타이어 힘 배율
  tail: 3.5,      // 꼬리가 빠진 동안 몸통이 더 돌아가는 힘
  boost: 29,      // 부스트 발판 속도
  jumpMin: 12,    // 이보다 느리면 점프대에서 못 건넘
  splash: 1200,   // 물에 빠지면 이만큼 뒤 다시 출발
  wind: 3,        // 좁은 다리 옆바람 (m/s²): 다리 오른쪽으로 민다
};
// 카트 코스 전용. 얼음 코스의 관성과 최고 속도는 PHYS로 그대로 유지한다.
export const KART = {
  max: 28,
  boost: 38,
  thrust: [28, 46],
  thrustTime: 1.5,
  brake: 52,
  reverseMax: 9,
  reverseThrust: 16,
  reverseDelay: 0.2,
  drag: 0.3,
  turnRate: 2.4,
  driftTurnRate: 3,
  turnResponse: 0.045,
  centerResponse: 0.025,
  counterResponse: 0.035,
  grip: 35,
  driftGrip: 5.5,
  driftDrag: 0.12,
  impactGrip: 3,
  impactTime: 0.2,
  radius: 1.05,
  capsuleBack: -0.20,
  capsuleFront: 0.35,
  restitution: 0.3,
};
export const SURF = {
  asphalt: { max: 1, grip: 2.2, drag: 1 },
  ice: { max: 1, grip: 1, drag: 1 },
  snow: { max: 0.8, grip: 1.8, drag: 2 },  // 눈길: 안 미끄럽지만 느림
  oil: { max: 1, grip: 0.15, drag: 0.3 },  // 기름: 거의 안 꺾임
};

// 구간 (달리는 순서). pieces: 스케치 좌표의 직선(L)·베지어(C). walls: 'outer' 바깥쪽만 벽, 'both' 양쪽 벽
export const SECTIONS = [
  { key: 'start', name: '출발 직선', w: 11, pieces: [['L', 340, 190], ['L', 450, 110]] },
  { key: 'jump', name: '빙하 점프', w: 10, pieces: [['C', 520, 60, 620, 60, 630, 130]] },
  { key: 'hairpin', name: '펭귄 헤어핀', w: 10, walls: 'outer', pieces: [['C', 640, 200, 600, 260, 560, 280]] },
  { key: 'wave', name: '물결 S자', w: 7, pieces: [['C', 530, 300, 515, 250, 490, 262], ['C', 470, 272, 472, 300, 450, 280]] },
  { key: 'bridge', name: '8자 고가 다리', w: 9, pieces: [['L', 340, 190], ['L', 230, 110]] },
  { key: 'split', name: '갈림길', w: 10, walls: 'outer', surface: 'snow', pieces: [['C', 160, 60, 60, 60, 50, 130]] },
  { key: 'gates', name: '펭귄 회전문', w: 9, walls: 'both', pieces: [['C', 40, 200, 80, 260, 120, 280]] },
  { key: 'final', name: '마지막 직선', w: 11, pieces: [['C', 150, 300, 180, 300, 200, 290]] },
];
const ORIGIN = [200, 290];
const CROSS = [340, 190];      // 8자가 교차하는 곳: 고가 다리(위층)가 출발 직선(아래층) 위로
const BRIDGE_HALF = 20;        // 교차점 앞뒤 이만큼이 다리 (m)

const bez = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return [0, 1].map(k => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
};

// 점들을 이어 길이·방향·오른쪽 방향을 붙인다
function finish(pts, closed) {
  const n = pts.length;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (i > 0) s += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
    p.s = s;
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    p.tx = (b.x - a.x) / len;
    p.ty = (b.y - a.y) / len;
  }
  const last = pts[n - 1];
  const len = closed ? s + Math.hypot(pts[0].x - last.x, pts[0].y - last.y) : s;
  return { pts, n, len, closed };
}

export function buildTrack(sprint = false) {
  const SCALE = sprint ? 0.28 : 0.4;
  // 가운데 선: 구간마다 촘촘히 점을 찍는다
  const raw = [];
  let cur = ORIGIN;
  SECTIONS.forEach((sec, si) => {
    for (const piece of sec.pieces) {
      const [type, ...c] = piece;
      const end = [c[c.length - 2], c[c.length - 1]];
      const at = type === 'L'
        ? t => [cur[0] + (end[0] - cur[0]) * t, cur[1] + (end[1] - cur[1]) * t]
        : t => bez(cur, [c[0], c[1]], [c[2], c[3]], end, t);
      // 길이를 대충 재서 간격 맞추기
      let approx = 0;
      let prev = at(0);
      for (let k = 1; k <= 20; k++) {
        const q = at(k / 20);
        approx += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
        prev = q;
      }
      const steps = Math.max(2, Math.round((approx * SCALE) / SAMPLE));
      for (let k = 0; k < steps; k++) {
        const [x, y] = at(k / steps);
        raw.push({ x: x * SCALE, y: y * SCALE, sec: si });
      }
      cur = end;
    }
  });
  const main = finish(raw, true);
  // 구간 시작 거리 (체크포인트), 구간 속성
  const secStart = SECTIONS.map((_, si) => main.pts.find(p => p.sec === si).s);
  const cross = { x: CROSS[0] * SCALE, y: CROSS[1] * SCALE };
  const bridgeSec = SECTIONS.findIndex(s => s.key === 'bridge');
  for (const p of main.pts) {
    const sec = SECTIONS[p.sec];
    p.half = sprint && (p.sec === 0 || p.sec === 7) ? 9 : sec.w / 2;
    p.surface = sprint ? 'asphalt' : sec.surface || 'ice';
    p.layer = p.sec === bridgeSec && Math.hypot(p.x - cross.x, p.y - cross.y) < BRIDGE_HALF ? 1 : 0;
    p.walls = sprint || p.layer ? 'both' : sec.walls || null;
  }
  // 폭은 구간 이음매 앞뒤로 부드럽게 (갑자기 좁아지면 턱이 생긴다)
  const halves = main.pts.map(p => p.half);
  main.pts.forEach((p, i) => {
    let sum = 0;
    for (let k = -5; k <= 5; k++) sum += halves[(i + k + main.n) % main.n];
    p.half = sum / 11;
  });
  // 바깥쪽 = 굽는 방향의 반대쪽 (오른쪽 +1 / 왼쪽 -1)
  main.pts.forEach((p, i) => {
    const a = main.pts[(i - 3 + main.n) % main.n];
    const b = main.pts[(i + 3) % main.n];
    const turn = a.tx * b.ty - a.ty * b.tx; // + = 오른쪽으로 굽음
    p.outer = turn > 0 ? -1 : 1;
  });
  const at = s => pointAt(main, s);
  const split = SECTIONS.findIndex(s => s.key === 'split');
  const splitLen = secStart[split + 1] - secStart[split];
  // 갈림길의 좁은 얼음 다리: 눈길(바깥으로 크게 도는 길)의 안쪽을 가로지르는 지름길
  const bA = secStart[split] + splitLen * 0.1;
  const bB = secStart[split] + splitLen * 0.9;
  const pa = at(bA);
  const pb = at(bB);
  const braw = [];
  const blen = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  const bsteps = Math.round(blen / SAMPLE);
  for (let k = 0; k <= bsteps; k++) {
    const t = k / bsteps;
    // 양 끝 10m는 깔때기처럼 넓다가(큰길 폭) 가운데는 3.5m: 들어가고 나올 때 사이 물에 빠지지 않게
    const fromEnd = Math.min(t, 1 - t) * blen;
    const half = 1.75 + (SECTIONS[split].w / 2 - 1.75) * Math.max(0, 1 - fromEnd / 10);
    braw.push({ x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t, sec: split, half, surface: 'ice', layer: 0, walls: null, outer: 1 });
  }
  const branch = finish(braw, false);
  branch.from = bA;
  branch.to = bB;
  // 장치들 (거리 = 가운데 선 위치)
  const jumpAt = secStart[1] + 8;
  const boosts = [secStart[0] + 16, secStart[7] + (main.len - secStart[7]) * 0.35];
  const wave = at(secStart[3] + (secStart[4] - secStart[3]) * 0.5);
  const gates = [0.35, 0.72].map((f, i) => {
    const p = at(secStart[6] + (secStart[7] - secStart[6]) * f);
    return { x: p.x, y: p.y, len: SECTIONS[6].w / 2 - 0.35, w: i ? -2.4 : 2.0 };
  });
  return {
    main, branch, secStart, cross, sprint,
    jump: sprint ? { ramp: -100, gap0: -99, gap1: -98 } : { ramp: jumpAt, gap0: jumpAt + 5, gap1: jumpAt + 12 },
    boosts: sprint ? [] : boosts.map(s => ({ s, len: 3.5 })),
    oil: sprint ? [] : [{ x: wave.x - wave.ty * 1.2, y: wave.y + wave.tx * 1.2, r: 1.8 }],
    gates: sprint ? [] : gates,
    start: main.len - 5, // 결승선 5m 앞에서 다 같이 출발
  };
}

// 거리 s의 가운데 선 점 (사이를 이어서)
export function pointAt(path, s) {
  const { pts, n, len, closed } = path;
  if (closed) s = ((s % len) + len) % len;
  else s = Math.max(0, Math.min(len, s));
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid].s <= s) lo = mid;
    else hi = mid - 1;
  }
  const a = pts[lo];
  const b = pts[closed ? (lo + 1) % n : Math.min(n - 1, lo + 1)];
  const segLen = (closed && lo === n - 1 ? len : b.s) - a.s || 1;
  const t = Math.max(0, Math.min(1, (s - a.s) / segLen));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, tx: a.tx, ty: a.ty, i: lo, s, half: a.half };
}

// 점 i0~i1 구간에서 (x, y)에 가장 가까운 곳
function nearest(path, i0, i1, x, y) {
  const { pts, n, closed } = path;
  let best = null;
  for (let k = i0; k <= i1; k++) {
    let i = k;
    if (closed) i = ((k % n) + n) % n;
    else if (i < 0 || i >= n - 1) continue;
    const a = pts[i];
    const b = pts[closed ? (i + 1) % n : i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const d2 = (x - px) ** 2 + (y - py) ** 2;
    if (!best || d2 < best.d2) best = { i, t, px, py, d2 };
  }
  if (!best) return null;
  const a = pts[best.i];
  const l = Math.hypot(pts[closed ? (best.i + 1) % n : best.i + 1].x - a.x, pts[closed ? (best.i + 1) % n : best.i + 1].y - a.y);
  best.s = a.s + best.t * l;
  // 오른쪽이 + (화면 좌표: 오른쪽 = (-ty, tx))
  best.lat = (x - best.px) * -a.ty + (y - best.py) * a.tx;
  best.p = a;
  return best;
}

// 지금 어디를 달리는지: 지금 자리 근처만 본다 (8자 교차·갈림길). cur = { path: 'main' | 'branch', seg }
export function locate(T, cur, x, y, wide = false) {
  const W = wide ? T.main.n : WINDOW;
  const cands = [];
  if (cur.path === 'branch') {
    const b = nearest(T.branch, cur.seg - W, cur.seg + W, x, y);
    if (b) cands.push({ path: 'branch', ...b });
    if (cur.seg > T.branch.n - W) {
      const j = pointAt(T.main, T.branch.to).i;
      const m = nearest(T.main, j - W, j + W, x, y);
      if (m) cands.push({ path: 'main', ...m });
    }
  } else {
    const m = nearest(T.main, cur.seg - W, cur.seg + W, x, y);
    if (m) cands.push({ path: 'main', ...m });
    const j = pointAt(T.main, T.branch.from).i;
    const dj = Math.abs(((cur.seg - j + T.main.n / 2) % T.main.n + T.main.n) % T.main.n - T.main.n / 2);
    if (!T.sprint && dj < W) {
      const b = nearest(T.branch, 0, W, x, y);
      if (b) cands.push({ path: 'branch', ...b });
    }
  }
  // 길 안에 들어 있는 쪽 우선, 둘 다 안이면 가운데 선이 가까운 쪽(다리 선을 따라가면 일찍 다리 위가 됨), 아니면 가까운 쪽.
  // 다리 끝을 지나친 건 안에 든 게 아님 (거리로 판단)
  const inside = c => Math.sqrt(c.d2) <= c.p.half;
  cands.sort((a, b) => (inside(b) - inside(a)) || a.d2 - b.d2);
  const c = cands[0];
  if (!c) return null;
  // 갈림길 다리 위치를 큰 길 거리로 바꿔서 순위·바퀴 계산에 쓴다
  const ms = c.path === 'branch' ? T.branch.from + ((T.branch.to - T.branch.from) * c.s) / T.branch.len : c.s;
  return { path: c.path, seg: c.i, s: c.s, ms, lat: c.lat, d: Math.sqrt(c.d2), p: c.p };
}

// 물에 빠지면 다시 설 자리: 조금 뒤 가운데 선 (점프대면 도움닫기할 만큼 더 뒤)
export function respawnPose(T, fall) {
  // 좁은 다리 초입에서 빠졌으면 큰길로 돌려보낸다 (다리 입구에 멈춰 서면 또 빠지기 쉽다)
  if (fall.path === 'branch' && fall.s >= 15) {
    const p = pointAt(T.branch, fall.s - 8);
    return { x: p.x, y: p.y, path: 'branch', seg: p.i, tx: p.tx, ty: p.ty };
  }
  let s = fall.path === 'branch' ? T.branch.from - 10 : fall.s - 10;
  if (s > T.jump.ramp - 30 && s < T.jump.gap1 + 5) s = T.jump.ramp - 30;
  const p = pointAt(T.main, s);
  return { x: p.x, y: p.y, path: 'main', seg: p.i, tx: p.tx, ty: p.ty };
}

export function newCar(T) {
  const p = pointAt(T.main, T.start);
  return { x: p.x, y: p.y, vx: 0, vy: 0, path: 'main', seg: p.i, s: T.start, ms: T.start, lat: 0, air: 0, sp: 0, oil: 0, dr: 0, hx: p.tx, hy: p.ty, steerInput: 0, steer: 0, yawRate: 0, reverseHold: 0, driftSide: 0, impactLeft: 0 };
}

// 한 걸음 (dt 초, t 서버 시각 ms). 카트는 { throttle, steer, brake, drift }, 얼음 코스는 { x, y }.
export function stepCar(T, car, input, dt, t) {
  const ev = [];
  if (car.sp) {
    if (t < car.sp) return ev;
    const r = respawnPose(T, car.fall || car);
    Object.assign(car, { x: r.x, y: r.y, vx: 0, vy: 0, path: r.path, seg: r.seg, sp: 0, air: 0, dr: 0, hx: r.tx, hy: r.ty, steerInput: 0, steer: 0, yawRate: 0, reverseHold: 0, driftSide: 0, impactLeft: 0 });
    const at = locate(T, car, car.x, car.y);
    if (at) Object.assign(car, { s: at.s, ms: at.ms, lat: at.lat });
    ev.push('respawn');
    return ev;
  }
  if (car.air) {
    // 공중: 조작·마찰 없이 날아간다
    car.x += car.vx * dt;
    car.y += car.vy * dt;
    if (t >= car.air) {
      car.air = 0;
      const at = locate(T, car, car.x, car.y);
      if (!at || Math.abs(at.lat) > at.p.half || inGap(T, at)) return splash(car, at, t, ev);
      Object.assign(car, { path: at.path, seg: at.seg, s: at.s, ms: at.ms, lat: at.lat });
      ev.push('land');
    }
    return ev;
  }
  const here = locate(T, car, car.x, car.y) || { p: T.main.pts[car.seg] || T.main.pts[0], lat: 0, s: car.s, ms: car.ms, path: car.path, seg: car.seg };
  const beforeBoost = car.boostLeft || 0;
  drive(car, input, SURF[t < car.oil ? 'oil' : here.p.surface] || SURF.ice, dt);
  if ((car.boostLeft || 0) > beforeBoost) ev.push('boost');
  // 좁은 다리 옆바람
  if (here.path === 'branch') {
    car.vx += -here.p.ty * PHYS.wind * dt;
    car.vy += here.p.tx * PHYS.wind * dt;
  }
  const prevMs = car.ms;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  const at = locate(T, car, car.x, car.y);
  if (!at) return splash(car, here, t, ev);
  Object.assign(car, { path: at.path, seg: at.seg, s: at.s, ms: at.ms, lat: at.lat });
  // 점프대: 빠르면 날아서 건너고, 느리면 물웅덩이로
  if (at.path === 'main' && crossed(prevMs, at.ms, T.jump.gap0)) {
    const fwd = car.vx * at.p.tx + car.vy * at.p.ty;
    if (fwd >= PHYS.jumpMin) {
      car.air = t + ((T.jump.gap1 - T.jump.gap0 + 3) / fwd) * 1000;
      ev.push('jump');
      return ev;
    }
  }
  if (inGap(T, at)) return splash(car, at, t, ev);
  // 길 밖: 벽이면 튕기고, 물이면 풍덩
  const over = Math.abs(at.lat) - (at.p.half - (T.sprint ? kartWallSupport(car, at.p, Math.sign(at.lat)) : 0));
  if (over > 0) {
    const side = Math.sign(at.lat);
    const wall = at.p.walls === 'both' || (at.p.walls === 'outer' && side === at.p.outer);
    if (!wall) return splash(car, at, t, ev);
    const nx = -at.p.ty * side;
    const ny = at.p.tx * side;
    car.x -= nx * (over + 0.05);
    car.y -= ny * (over + 0.05);
    const vn = car.vx * nx + car.vy * ny;
    if (vn > 0) {
      car.charge = 0;
      car.boostLeft = 0;
      car.vx -= nx * vn * 1.4;
      car.vy -= ny * vn * 1.4;
      car.vx *= 0.85;
      car.vy *= 0.85;
      if (vn > 3) ev.push('wall');
    }
  }
  // 부스트 발판
  if (at.path === 'main') {
    for (const b of T.boosts) {
      if (crossed(prevMs, at.ms, b.s) && Math.abs(at.lat) < 3) {
        const fwd = car.vx * at.p.tx + car.vy * at.p.ty;
        if (fwd < PHYS.boost) {
          car.vx += at.p.tx * (PHYS.boost - fwd);
          car.vy += at.p.ty * (PHYS.boost - fwd);
        }
        ev.push('boost');
      }
    }
  }
  for (const o of T.oil) if ((car.x - o.x) ** 2 + (car.y - o.y) ** 2 < o.r * o.r) car.oil = t + 800;
  for (const g of T.gates) if (gateHit(g, car, t)) ev.push('gate');
  return ev;
}

// 조작·타이어·마찰 (길과 상관없는 부분). surf = 노면
export function drive(car, input, surf, dt) {
  if (surf === SURF.asphalt) return driveKart(car, input, dt);
  const max = PHYS.max * surf.max;
  let ix = input?.x || 0;
  let iy = input?.y || 0;
  const il = Math.hypot(ix, iy);
  const speed = Math.hypot(car.vx, car.vy);
  const yaw = PHYS.yaw[0] + (PHYS.yaw[1] - PHYS.yaw[0]) * Math.min(1, speed / PHYS.max);
  if (il > 0) {
    ix /= il;
    iy /= il;
    const along = speed > 0 ? (car.vx * ix + car.vy * iy) / speed : 1;
    if (speed > 3 && along < -0.7) {
      // 달리는 반대쪽을 누르면 브레이크 (몸통은 그대로)
      car.vx += ix * PHYS.thrust * dt;
      car.vy += iy * PHYS.thrust * dt;
    } else {
      turn(car, ix, iy, yaw, dt);
      // 몸통 방향으로 민다. 최고 속도를 넘으면 더 못 밀어 준다 (부스트로 빨라진 건 천천히 줄어듦)
      const push = speed >= max && car.vx * car.hx + car.vy * car.hy > 0 ? 0 : PHYS.thrust;
      car.vx += car.hx * push * dt;
      car.vy += car.hy * push * dt;
    }
    // 꼬리가 빠졌으면 몸통이 미끄러지는 반대쪽으로 더 돈다
    if (car.dr && speed > 5) {
      const fwd = (car.vx * car.hx + car.vy * car.hy) / speed;
      const side = (car.vx * car.hy - car.vy * car.hx) / speed; // 몸통이 속도보다 오른쪽(+)으로 돌아가 있음
      if (fwd > 0) rotate(car, Math.sign(side) * PHYS.tail * Math.min(1, (Math.abs(side) * speed) / 10) * dt);
    }
    // 타이어: 몸통 옆으로 미끄러지는 속도를 줄인다. 한 번에 줄일 수 있는 양엔 한계가 있다
    const nx = -car.hy;
    const ny = car.hx;
    const lat = car.vx * nx + car.vy * ny;
    const g = surf.grip * (car.dr ? PHYS.slide : 1);
    const cut = Math.sign(lat) * Math.min(Math.abs(lat) * Math.min(1, PHYS.grip * g * dt), PHYS.gripMax * g * dt);
    car.vx -= nx * cut;
    car.vy -= ny * cut;
    if (Math.abs(lat) > PHYS.slipOn && speed > 6) car.dr = 1;
    else if (Math.abs(lat) < PHYS.slipOff) car.dr = 0;
  } else {
    // 손을 떼면 미끄러지는 대로 몸통이 따라 돈다
    if (speed > 0.5) turn(car, car.vx / speed, car.vy / speed, yaw * 0.5, dt);
    car.dr = 0;
  }
  const drag = PHYS.drag * surf.drag * dt + (Math.hypot(car.vx, car.vy) > max ? 1.2 * dt : 0);
  car.vx *= 1 - Math.min(1, drag);
  car.vy *= 1 - Math.min(1, drag);
}

function driveKart(car, input, dt) {
  const throttle = Math.max(0, Math.min(1, input?.throttle || 0));
  const steering = Math.max(-1, Math.min(1, input?.steer || 0));
  const braking = !!input?.brake;
  const held = !!input?.drift;
  const before = Math.hypot(car.vx, car.vy);
  car.boostLeft = Math.max(0, (car.boostLeft || 0) - dt);
  if (car.driftHeld && !held && (car.charge || 0) >= 0.45 && before > 8 && !braking) {
    car.boostLeft = car.charge >= 1.15 ? 1.35 : 0.65;
  }
  car.driftHeld = held;
  if (!held) car.charge = 0;
  const boosted = car.boostLeft > 0;

  // 아케이드 조작: 입력을 회전 속도로 바로 바꾸고 한 번만 짧게 보간한다.
  // 드리프트는 살짝 꺾어 시작한 뒤 키를 놓아도 완만한 옆미끄럼을 유지한다.
  if (!held || braking || before < 8) car.driftSide = 0;
  else if (Math.abs(steering) > 0.08) car.driftSide = Math.sign(steering);
  const drifting = held && !braking && before > 8 && !!car.driftSide;
  const turnInput = Math.abs(steering) > 0.001 ? steering : drifting ? car.driftSide * 0.18 : 0;
  car.steerInput = steering;
  const forwardSpeed = car.vx * car.hx + car.vy * car.hy;
  const turnLimit = forwardSpeed < 0 ? 1.8 : drifting ? KART.driftTurnRate : KART.turnRate;
  const yaw = turnInput * turnLimit * Math.min(1, before / 8) * (forwardSpeed < 0 ? -1 : 1);
  const response = Math.abs(turnInput) < 0.001 ? KART.centerResponse
    : yaw * (car.yawRate || 0) < 0 ? KART.counterResponse : KART.turnResponse;
  car.yawRate = (car.yawRate || 0) + (yaw - (car.yawRate || 0)) * (1 - Math.exp(-dt / response));
  if (before < 0.1) car.yawRate = 0;
  rotate(car, car.yawRate * dt);
  // 바퀴 각도는 그림에만 사용한다. 물리 회전에 또 다른 지연을 겹치지 않는다.
  car.steer = (car.steer || 0) + (turnInput * (drifting ? 0.5 : 0.35) - (car.steer || 0)) * (1 - Math.exp(-dt / 0.035));

  if (braking) {
    car.throttleTime = 0;
    const wantsReverse = throttle === 0;
    const reverseReady = wantsReverse && (car.reverseHold || 0) >= KART.reverseDelay && (forwardSpeed < 0 || before < 0.15);
    if (!reverseReady) {
      // S는 먼저 제동한다. 정지한 상태를 잠깐 유지한 뒤에만 후진 기어가 걸린다.
      const factor = before > 0 ? Math.max(0, 1 - KART.brake * dt / before) : 0;
      car.vx *= factor;
      car.vy *= factor;
      car.reverseHold = wantsReverse && Math.hypot(car.vx, car.vy) < 0.001
        ? Math.min(KART.reverseDelay, (car.reverseHold || 0) + dt) : 0;
    }
    if (wantsReverse && (car.reverseHold || 0) >= KART.reverseDelay) {
      car.vx -= car.hx * KART.reverseThrust * dt;
      car.vy -= car.hy * KART.reverseThrust * dt;
    }
  } else if (throttle > 0) {
    car.reverseHold = 0;
    if (forwardSpeed < 0) {
      // 후진 중 W를 누르면 완전히 멈추는 걸음을 거친 다음 전진한다.
      car.throttleTime = 0;
      const factor = before > 0 ? Math.max(0, 1 - KART.brake * dt / before) : 0;
      car.vx *= factor;
      car.vy *= factor;
    } else {
      car.throttleTime = Math.min(KART.thrustTime, (car.throttleTime || 0) + dt * throttle);
      const u = car.throttleTime / KART.thrustTime;
      const thrust = boosted ? 62 : KART.thrust[0] + (KART.thrust[1] - KART.thrust[0]) * u * u;
      car.vx += car.hx * thrust * throttle * dt;
      car.vy += car.hy * thrust * throttle * dt;
    }
  } else { car.throttleTime = 0; car.reverseHold = 0; }

  // 속도 크기를 잘라내지 않고 방향을 코 쪽으로 붙인다. 평범한 코너에서 속도를 잃지 않는다.
  // 방금 부딪힌 차는 잠깐 접지 회복을 늦춰 충격으로 밀리는 움직임을 보존한다.
  car.impactLeft = Math.max(0, (car.impactLeft || 0) - dt);
  const moving = Math.hypot(car.vx, car.vy);
  if (moving > 1e-6) {
    const sign = car.vx * car.hx + car.vy * car.hy < 0 ? -1 : 1;
    const desired = Math.atan2(car.hy * sign, car.hx * sign);
    const velocity = Math.atan2(car.vy, car.vx);
    const error = Math.atan2(Math.sin(desired - velocity), Math.cos(desired - velocity));
    const baseGrip = drifting ? KART.driftGrip : KART.grip;
    const recover = 1 - car.impactLeft / KART.impactTime;
    const grip = car.impactLeft > 0 ? KART.impactGrip + (baseGrip - KART.impactGrip) * recover * recover : baseGrip;
    const angle = velocity + error * (1 - Math.exp(-grip * dt));
    car.vx = Math.cos(angle) * moving;
    car.vy = Math.sin(angle) * moving;
  }
  const lat = car.vx * -car.hy + car.vy * car.hx;
  const forward = car.vx * car.hx + car.vy * car.hy;
  car.dr = drifting && Math.abs(lat) > 1.5 ? 1 : 0;
  if (car.dr && forward > before * 0.6) car.charge = Math.min(1.5, (car.charge || 0) + dt);
  else car.charge = Math.max(0, (car.charge || 0) - dt * (braking ? 1 : 0.35));

  const drag = Math.max(0, 1 - (KART.drag + (drifting ? KART.driftDrag : 0)) * dt);
  car.vx *= drag;
  car.vy *= drag;
  // 일정한 최고 속도. 부스트 종료·충돌 직후의 초과 속도는 부드럽게 줄인다.
  const backwards = car.vx * car.hx + car.vy * car.hy < -0.001;
  const limit = backwards ? Math.max(KART.reverseMax, before - 20 * dt)
    : boosted ? KART.boost : Math.min(KART.boost, Math.max(KART.max, before - 20 * dt));
  const speed = Math.hypot(car.vx, car.vy);
  if (speed > limit) {
    car.vx *= limit / speed;
    car.vy *= limit / speed;
  }
}

// 방장이 모든 차량을 같은 걸음으로 움직인 뒤 호출한다.
// entries = [{ id, car, prev?: { x, y, hx, hy } }]. prev를 주면 걸음 사이의 스치는 접촉도 검사한다.
// car를 직접 갱신하고 효과용 { a, b, x, y, strength } 배열을 반환한다.
export function resolveKartContacts(T, entries, dt = 1 / 60) {
  const cars = entries.filter(({ car }) => car && !car.fin && !car.sp && !car.air
    && [car.x, car.y, car.vx, car.vy].every(Number.isFinite));
  const impacts = [];
  const moved = new Set();
  const diameter = KART.radius * 2;
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const ea = cars[i];
        const eb = cars[j];
        const a = ea.car;
        const b = eb.car;
        const travel = pass === 0
          ? (validPose(ea.prev) ? Math.hypot(a.x - ea.prev.x, a.y - ea.prev.y) : 0)
            + (validPose(eb.prev) ? Math.hypot(b.x - eb.prev.x, b.y - eb.prev.y) : 0)
          : 0;
        if (Math.hypot(b.x - a.x, b.y - a.y) > diameter + 2 * KART.capsuleFront + 0.04 + travel) continue;
        let hit = capsuleContact(a, b);
        let remaining = 0;
        if (pass === 0 && !moved.has(ea.id) && !moved.has(eb.id) && (validPose(ea.prev) || validPose(eb.prev))) {
          const swept = sweptKartContact(ea, eb);
          if (swept) {
            const aa = locate(T, a, swept.a.x, swept.a.y);
            const bb = locate(T, b, swept.b.x, swept.b.y);
            if (aa && bb && aa.p.layer === bb.p.layer) {
              a.x = swept.a.x; a.y = swept.a.y;
              b.x = swept.b.x; b.y = swept.b.y;
              hit = swept.hit;
              remaining = Math.max(0, dt) * (1 - swept.u);
            }
          }
        }
        if (hit.dist > diameter + 0.04) continue;
        const aa = locate(T, a, a.x, a.y);
        const bb = locate(T, b, b.x, b.y);
        if (!aa || !bb || aa.p.layer !== bb.p.layer) continue;
        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const rv = Math.hypot(rvx, rvy);
        const nx = hit.dist > 1e-8 ? (hit.bx - hit.ax) / hit.dist : rv > 1e-8 ? -rvx / rv : 1;
        const ny = hit.dist > 1e-8 ? (hit.by - hit.ay) / hit.dist : rv > 1e-8 ? -rvy / rv : 0;
        const correction = Math.max(0, diameter - hit.dist + 0.003) * 0.5;
        a.x -= nx * correction;
        a.y -= ny * correction;
        b.x += nx * correction;
        b.y += ny * correction;
        const closing = rvx * nx + rvy * ny;
        // 이미 멀어지고 있는 접촉에는 반동을 더하지 않는다.
        if (closing < 0) {
          const impulse = -(1 + KART.restitution) * closing * 0.5;
          a.vx -= nx * impulse;
          a.vy -= ny * impulse;
          b.vx += nx * impulse;
          b.vy += ny * impulse;
          if (-closing > 1.5) a.impactLeft = b.impactLeft = KART.impactTime;
          if (pass === 0 && -closing > 1.5) impacts.push({
            a: ea.id, b: eb.id, x: (hit.ax + hit.bx) * 0.5, y: (hit.ay + hit.by) * 0.5, strength: -closing,
          });
        }
        if (remaining > 0) {
          a.x += a.vx * remaining; a.y += a.vy * remaining;
          b.x += b.vx * remaining; b.y += b.vy * remaining;
        }
        moved.add(ea.id); moved.add(eb.id);
        keepKartOnRoad(T, a);
        keepKartOnRoad(T, b);
      }
    }
  }
  return impacts;
}

const validPose = p => p && [p.x, p.y].every(Number.isFinite);

function capsuleEnds(p) {
  const h = Math.hypot(p.hx || 0, p.hy || 0) || 1;
  const hx = Number.isFinite(p.hx) ? p.hx / h : 1;
  const hy = Number.isFinite(p.hy) ? p.hy / h : 0;
  return [
    { x: p.x + hx * KART.capsuleBack, y: p.y + hy * KART.capsuleBack },
    { x: p.x + hx * KART.capsuleFront, y: p.y + hy * KART.capsuleFront },
  ];
}

function capsuleContact(a, b) {
  const [a0, a1] = capsuleEnds(a);
  const [b0, b1] = capsuleEnds(b);
  let best = { dist: Infinity };
  const offer = (ax, ay, bx, by) => {
    const dist = Math.hypot(bx - ax, by - ay);
    if (dist < best.dist) best = { ax, ay, bx, by, dist };
  };
  const endpoint = (p, q0, q1, reverse) => {
    const dx = q1.x - q0.x;
    const dy = q1.y - q0.y;
    const t = Math.max(0, Math.min(1, ((p.x - q0.x) * dx + (p.y - q0.y) * dy) / (dx * dx + dy * dy || 1)));
    const x = q0.x + dx * t;
    const y = q0.y + dy * t;
    if (reverse) offer(x, y, p.x, p.y); else offer(p.x, p.y, x, y);
  };
  endpoint(a0, b0, b1, false); endpoint(a1, b0, b1, false);
  endpoint(b0, a0, a1, true); endpoint(b1, a0, a1, true);
  const ax = a1.x - a0.x;
  const ay = a1.y - a0.y;
  const bx = b1.x - b0.x;
  const by = b1.y - b0.y;
  const cross = ax * by - ay * bx;
  if (Math.abs(cross) > 1e-10) {
    const dx = b0.x - a0.x;
    const dy = b0.y - a0.y;
    const t = (dx * by - dy * bx) / cross;
    const u = (dx * ay - dy * ax) / cross;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) offer(a0.x + ax * t, a0.y + ay * t, a0.x + ax * t, a0.y + ay * t);
  }
  return best;
}

function interpolatePose(a, b, t) {
  const start = Math.atan2(a.hy || 0, a.hx ?? 1);
  const end = Math.atan2(b.hy || 0, b.hx ?? 1);
  const angle = start + Math.atan2(Math.sin(end - start), Math.cos(end - start)) * t;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, hx: Math.cos(angle), hy: Math.sin(angle) };
}

function sweptKartContact(a, b) {
  const pa = validPose(a.prev) ? a.prev : a.car;
  const pb = validPose(b.prev) ? b.prev : b.car;
  // 이미 맞닿은 쌍은 과거로 돌리지 않고 현재 위치에서 푼다.
  const diameter = KART.radius * 2;
  if (capsuleContact(pa, pb).dist <= diameter + 0.003) return null;
  const travel = Math.hypot(a.car.x - pa.x, a.car.y - pa.y) + Math.hypot(b.car.x - pb.x, b.car.y - pb.y);
  const steps = Math.max(1, Math.min(64, Math.ceil((travel + 0.1) / 0.08)));
  let previous = 0;
  for (let k = 1; k <= steps; k++) {
    let u = k / steps;
    let aa = interpolatePose(pa, a.car, u);
    let bb = interpolatePose(pb, b.car, u);
    if (capsuleContact(aa, bb).dist <= diameter + 0.04) {
      let lo = previous;
      let hi = u;
      for (let q = 0; q < 8; q++) {
        const mid = (lo + hi) * 0.5;
        if (capsuleContact(interpolatePose(pa, a.car, mid), interpolatePose(pb, b.car, mid)).dist <= diameter + 0.04) hi = mid;
        else lo = mid;
      }
      u = hi;
      aa = interpolatePose(pa, a.car, u);
      bb = interpolatePose(pb, b.car, u);
      return { a: aa, b: bb, hit: capsuleContact(aa, bb), u };
    }
    previous = u;
  }
  return null;
}

function kartWallSupport(car, p, side) {
  const lateral = (car.hx || 0) * -p.ty * side + (car.hy || 0) * p.tx * side;
  return KART.radius + Math.max(KART.capsuleBack * lateral, KART.capsuleFront * lateral);
}

function keepKartOnRoad(T, car) {
  let at = locate(T, car, car.x, car.y);
  if (!at) return;
  const side = Math.sign(at.lat);
  const wall = at.p.walls === 'both' || (at.p.walls === 'outer' && side === at.p.outer);
  const over = Math.abs(at.lat) - Math.max(0, at.p.half - kartWallSupport(car, at.p, side));
  if (wall && over > 0) {
    const nx = -at.p.ty * side;
    const ny = at.p.tx * side;
    car.x -= nx * over;
    car.y -= ny * over;
    const out = car.vx * nx + car.vy * ny;
    if (out > 0) {
      car.vx -= nx * out;
      car.vy -= ny * out;
    }
    at = locate(T, car, car.x, car.y) || at;
  }
  Object.assign(car, { path: at.path, seg: at.seg, s: at.s, ms: at.ms, lat: at.lat });
}

// 몸통을 a 라디안 돌린다 (화면 기준 시계 방향 +)
function rotate(car, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const hx = car.hx * c - car.hy * s;
  car.hy = car.hx * s + car.hy * c;
  car.hx = hx;
}

// 몸통을 (tx, ty) 쪽으로 돌린다. 많이 틀어져 있을수록 빨리, 최대 yaw rad/s
function turn(car, tx, ty, yaw, dt) {
  const diff = Math.atan2(car.hx * ty - car.hy * tx, car.hx * tx + car.hy * ty);
  rotate(car, Math.max(-yaw, Math.min(yaw, diff * 14)) * dt);
}

const crossed = (a, b, s) => a < s && b >= s && b - a < 20;
const inGap = (T, at) => at.path === 'main' && at.ms > T.jump.gap0 && at.ms < T.jump.gap1;

function splash(car, at, t, ev) {
  car.sp = t + PHYS.splash;
  car.fall = { path: at?.path || car.path, s: at?.s ?? car.s };
  car.vx = 0;
  car.vy = 0;
  car.air = 0;
  ev.push('splash');
  return ev;
}

// 회전문: 가운데를 지나는 막대가 일정한 박자로 돈다 (시각만으로 정해져서 모두에게 같다)
export const gateAngle = (g, t) => ((g.w * t) / 1000) % (Math.PI * 2);

function gateHit(g, car, t) {
  const a = gateAngle(g, t);
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const rx = car.x - g.x;
  const ry = car.y - g.y;
  const along = Math.max(-g.len, Math.min(g.len, rx * ux + ry * uy));
  const px = ux * along;
  const py = uy * along;
  const dx = rx - px;
  const dy = ry - py;
  const d = Math.hypot(dx, dy);
  const minD = CAR_R + 0.18;
  if (d >= minD || d === 0) return false;
  const nx = dx / d;
  const ny = dy / d;
  car.x += nx * (minD - d);
  car.y += ny * (minD - d);
  // 막대 그 자리의 속도 (돌아가는 방향)
  const bvx = -g.w * py;
  const bvy = g.w * px;
  const rel = (car.vx - bvx) * nx + (car.vy - bvy) * ny;
  if (rel < 0) {
    car.vx -= nx * rel * 1.5;
    car.vy -= ny * rel * 1.5;
  }
  return rel < -2;
}

// 앞으로 d m 간 곳의 가운데 선 점 (지름길로 가기로 했으면 다리 쪽으로)
function ahead(T, car, d, short) {
  if (car.path === 'branch') {
    const s = car.s + d;
    return s <= T.branch.len ? pointAt(T.branch, s) : pointAt(T.main, T.branch.to + (s - T.branch.len));
  }
  const ms = car.ms + d;
  // 지름길로 가기로 했으면: 입구 전부터 다리 끝까지 다리 선을 따라간다 (큰길 위에 있어도 다리 쪽 거리로 바꿔서)
  const { from, to, len } = T.branch;
  if (!T.sprint && short && car.ms > from - 40 && car.ms < to - 3 && ms > from) {
    const s = car.ms < from ? ms - from : ((car.ms - from) / (to - from)) * len + d;
    return s <= len ? pointAt(T.branch, s) : pointAt(T.main, to + (s - len));
  }
  return pointAt(T.main, ms);
}

// 봇: 앞쪽 가운데 선을 노려서 8방향으로 민다. 급커브 앞에선 브레이크. skill 0.85~1, mem.short = 이번엔 지름길
export function botInput(T, car, mem, skill) {
  if (T.sprint) return kartBotInput(T, car, skill);
  // 다리 입구를 한참 지나 큰길에 있으면(물에서 다시 섰을 때 등) 이번 바퀴는 눈길로
  if (mem.short && car.path === 'main' && car.ms > T.branch.from + 8 && car.ms < T.branch.to) mem.short = false;
  const sp = Math.hypot(car.vx, car.vy);
  const look = 4 + sp * 0.45;
  const tgt = ahead(T, car, look, mem.short);
  const far = ahead(T, car, look + 14, mem.short);
  let dx = tgt.x - car.x;
  let dy = tgt.y - car.y;
  // 좁은 다리에선 조금 천천히, 바람이 불어오는 쪽(왼쪽)으로 살짝 비켜 겨눈다
  const bridge = car.path === 'branch';
  if (bridge) {
    // 가운데서 벗어난 만큼 세게 되돌린다 (8방향이라 조금 비틀어선 대각선이 안 됨)
    const back = 1.2 + car.lat * 4;
    dx += tgt.ty * back;
    dy -= tgt.tx * back;
  }
  // 앞이 급하게 꺾이면 속도를 줄인다
  const bend = Math.acos(Math.max(-1, Math.min(1, tgt.tx * far.tx + tgt.ty * far.ty)));
  const limit = ((T.sprint ? KART.max : PHYS.max) * skill) * (bend > 1 ? 0.55 : bend > 0.6 ? 0.75 : 1) * (bridge ? 0.85 : 1);
  if (sp > limit && sp > 6) {
    dx = -car.vx / sp + dx * 0.02;
    dy = -car.vy / sp + dy * 0.02;
  }
  // 8방향으로 (사람처럼)
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: Math.round(Math.cos(ang)), y: Math.round(Math.sin(ang)), drift: T.sprint && bend > 0.16 && sp > 10 && (car.charge || 0) < 1.25 };
}

function kartBotInput(T, car, skill) {
  const speed = Math.hypot(car.vx, car.vy);
  const look = 5 + speed * 0.55;
  const target = ahead(T, car, look, false);
  const far = ahead(T, car, look + 12, false);
  const dx = target.x - car.x;
  const dy = target.y - car.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const angle = Math.atan2(car.hx * dy - car.hy * dx, car.hx * dx + car.hy * dy);
  const bend = Math.acos(Math.max(-1, Math.min(1, target.tx * far.tx + target.ty * far.ty)));
  const limit = KART.max * skill * (bend > 1 ? 0.50 : bend > 0.6 ? 0.67 : bend > 0.3 ? 0.85 : 1);
  const brake = speed > limit + 1 || Math.abs(angle) > 1.0 && speed > 12;
  const drift = !brake && bend > 0.16 && Math.abs(angle) < 0.7 && speed > 12 && (car.charge || 0) < 1.25;
  const yawLimit = (drift ? KART.driftTurnRate : KART.turnRate) * Math.min(1, speed / 8);
  const desiredYaw = 2 * Math.max(3, speed) * Math.sin(angle) / distance;
  const steer = Math.max(-1, Math.min(1, desiredYaw / Math.max(0.5, yawLimit)));
  return { throttle: brake ? 0 : 1, steer, brake,
    drift };
}
