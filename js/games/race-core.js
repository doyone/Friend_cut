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
  turnFade: 0.32,       // 빠를수록 덜 꺾인다: 12m/s부터 줄어 최고 속도에선 turnRate의 68%
  turnFadeFrom: 12,
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
// 일반 핸들의 최대 회전 속도(rad/s). 고속에서 키를 톡 쳐도 확 틀어져 벽 없는 길 밖으로 날아가지 않게 줄이고,
// 드리프트는 그대로 둬서 급커브는 드리프트로 돈다
export function kartTurnRate(speed, drifting = false) {
  if (drifting) return KART.driftTurnRate;
  const fade = Math.max(0, Math.min(1, (speed - KART.turnFadeFrom) / (KART.max - KART.turnFadeFrom)));
  return KART.turnRate * (1 - KART.turnFade * fade);
}

export const SURF = {
  asphalt: { max: 1, grip: 2.2, drag: 1, kart: true },
  // 카트 맵 노면: 카트 조작 그대로, 최고 속도(max)·접지(kgrip) 배율만 다르다
  sand: { kart: true, max: 0.72, kgrip: 0.8 },   // 모래: 느림
  steel: { kart: true, max: 1, kgrip: 0.45 },    // 철판: 미끄러움
  ledge: { kart: true, max: 0.9, kgrip: 0.35 },  // 빙벽 길: 아주 미끄러움
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
export function finish(pts, closed) {
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
  const SCALE = sprint ? 0.34 : 0.4;
  // 카트는 긴 추월 직선과 완만한 S자로 펼친다. 왼쪽 U자는 안쪽 지름길과 분리할 만큼 깊게 돈다.
  const sections = sprint ? SECTIONS.map(sec => sec.key === 'split'
    ? { ...sec, pieces: [['C', 160, -30, 60, -30, 50, 130]] }
    : sec.key === 'wave'
      ? { ...sec, pieces: [['C', 530, 300, 520, 270, 490, 272], ['C', 473, 273, 466, 288, 450, 280]] }
      : sec) : SECTIONS;
  const kartWidths = [24, 22, 20, 18, 22, 20, 18, 24];
  // 가운데 선: 구간마다 촘촘히 점을 찍는다
  const raw = [];
  let cur = ORIGIN;
  sections.forEach((sec, si) => {
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
    const sec = sections[p.sec];
    p.half = sprint ? kartWidths[p.sec] / 2 : sec.w / 2;
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
  const bA = secStart[split] + splitLen * (sprint ? 0.08 : 0.1);
  const bB = secStart[split] + splitLen * (sprint ? 0.92 : 0.9);
  const pa = at(bA);
  const pb = at(bB);
  const braw = [];
  const blen = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  const bsteps = sprint ? Math.max(2, Math.ceil(blen / (SAMPLE / 2))) : Math.round(blen / SAMPLE);
  const handle = Math.min(14, blen * 0.24);
  for (let k = 0; k <= bsteps; k++) {
    const t = k / bsteps;
    // 양 끝 10m는 깔때기처럼 넓다가(큰길 폭) 가운데는 3.5m: 들어가고 나올 때 사이 물에 빠지지 않게
    const fromEnd = Math.min(t, 1 - t) * blen;
    const narrow = sprint ? 4.5 : 1.75;
    const half = narrow + ((sprint ? pa.half : SECTIONS[split].w / 2) - narrow) * Math.max(0, 1 - fromEnd / (sprint ? 14 : 10));
    const [x, y] = sprint ? bez([pa.x, pa.y], [pa.x + pa.tx * handle, pa.y + pa.ty * handle],
      [pb.x - pb.tx * handle, pb.y - pb.ty * handle], [pb.x, pb.y], t)
      : [pa.x + (pb.x - pa.x) * t, pa.y + (pb.y - pa.y) * t];
    braw.push({ x, y, sec: split, half, surface: sprint ? 'asphalt' : 'ice', layer: 0, walls: sprint ? 'both' : null, outer: 1 });
  }
  const branch = finish(braw, false);
  branch.id = 'branch';
  branch.from = bA;
  branch.to = bB;
  if (sprint) {
    branch.label = '인코스 지름길';
    branch.saving = bB - bA - branch.len;
    branch.junctions = [{ s: bA, ...pa }, { s: bB, ...pb }];
    // 다른 길에 겹쳐 있는 경계는 난간을 열어 하나의 연결된 도로로 취급한다.
    for (const p of main.pts) {
      p.openWalls = [];
      if (p.s < bA - 18 || p.s > bB + 18 || p.layer) continue;
      for (const side of [-1, 1]) {
        const x = p.x - p.ty * p.half * side, y = p.y + p.tx * p.half * side;
        const q = nearest(branch, 0, branch.n - 1, x, y);
        if (q && !pastOpenPathEnd(branch, q.s, x, y) && Math.sqrt(q.d2) <= q.p.half + 0.2) p.openWalls.push(side);
      }
    }
    for (const p of branch.pts) {
      p.openWalls = [];
      const j = pointAt(main, bA + (bB - bA) * p.s / branch.len).i;
      for (const side of [-1, 1]) {
        const q = nearest(main, j - 40, j + 40, p.x - p.ty * p.half * side, p.y + p.tx * p.half * side);
        if (q && !q.p.layer && Math.sqrt(q.d2) <= q.p.half + 0.2) p.openWalls.push(side);
      }
    }
  }
  // 장치들 (거리 = 가운데 선 위치)
  const jumpAt = secStart[1] + 8;
  const boosts = [secStart[0] + 16, secStart[7] + (main.len - secStart[7]) * 0.35];
  const wave = at(secStart[3] + (secStart[4] - secStart[3]) * 0.5);
  const gates = [0.35, 0.72].map((f, i) => {
    const p = at(secStart[6] + (secStart[7] - secStart[6]) * f);
    return { x: p.x, y: p.y, len: SECTIONS[6].w / 2 - 0.35, w: i ? -2.4 : 2.0 };
  });
  return {
    main, branch, branches: [branch], secStart, cross, sprint,
    jump: sprint ? { ramp: -100, gap0: -99, gap1: -98 } : { ramp: jumpAt, gap0: jumpAt + 5, gap1: jumpAt + 12 },
    boosts: sprint ? [] : boosts.map(s => ({ s, len: 3.5 })),
    oil: sprint ? [] : [{ x: wave.x - wave.ty * 1.2, y: wave.y + wave.tx * 1.2, r: 1.8 }],
    gates: sprint ? [] : gates,
    start: main.len - 5, // 결승선 5m 앞에서 다 같이 출발
  };
}

// 갈림길: 예전 트랙은 T.branch 하나, 카트 맵은 T.branches 여러 개 (보이는 갈래길·숨은 지름길)
export const branchesOf = T => T.branches || (T.branch ? [T.branch] : []);
export const roadOf = (T, path) => (path === 'main' ? T.main : branchesOf(T).find(b => b.id === path));
// 갈림길 위 거리를 본선 거리로 (순위·체크포인트용)
export const msOnMain = (b, s) => b.from + ((b.to - b.from) * s) / b.len;

// 렌더와 물리가 같은 이음새를 연다. side: 진행 방향 오른쪽 +1, 왼쪽 -1.
export function roadWallOpen(T, path, p, side) {
  if (!T.sprint) return false;
  if (p.openWalls) return p.openWalls.includes(side);
  // 렌더가 구간 사이를 잘게 나눈 점은 캐시 대신 실제 다른 도로와의 겹침을 구한다.
  // 물리가 쓰는 원본 점은 위의 캐시만 읽으므로 매 걸음의 검색량은 늘지 않는다.
  const x = p.x - p.ty * p.half * side;
  const y = p.y + p.tx * p.half * side;
  if (path === 'main') {
    if (p.layer) return false;
    return branchesOf(T).some(b => {
      if (p.s < b.from - 18 || p.s > b.to + 18) return false;
      const q = nearest(b, 0, b.n - 1, x, y);
      return !!q && !pastOpenPathEnd(b, q.s, x, y) && Math.sqrt(q.d2) <= q.p.half + 0.2;
    });
  }
  const b = roadOf(T, path);
  const j = pointAt(T.main, msOnMain(b, p.s)).i;
  const q = nearest(T.main, j - 40, j + 40, x, y);
  return !!q && !q.p.layer && Math.sqrt(q.d2) <= q.p.half + 0.2;
}

// 본선·갈림길 점마다 열린 난간 쪽을 미리 구해 둔다 (물리가 매 걸음 다시 찾지 않게)
export function cacheOpenWalls(T) {
  for (const p of T.main.pts) p.openWalls = null;
  for (const b of branchesOf(T)) for (const p of b.pts) p.openWalls = null;
  const open = (path, p) => [-1, 1].filter(side => roadWallOpen(T, path, p, side));
  for (const p of T.main.pts) p.openWalls = open('main', p);
  for (const b of branchesOf(T)) for (const p of b.pts) p.openWalls = open(b.id, p);
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
export function nearest(path, i0, i1, x, y) {
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

// 열린 길의 끝은 반원으로 늘리지 않고, 그림의 평평한 끝면과 같은 접선으로 자른다.
export function pastOpenPathEnd(path, s, x, y) {
  const first = path.pts[0], last = path.pts[path.n - 1];
  return s <= 0.1 && (x - first.x) * first.tx + (y - first.y) * first.ty < 0
    || s >= path.len - 0.1 && (x - last.x) * last.tx + (y - last.y) * last.ty > 0;
}

// 지금 어디를 달리는지: 지금 자리 근처만 본다 (8자 교차·갈림길). cur = { path: 'main' | 'branch', seg }
export function locate(T, cur, x, y, wide = false) {
  const W = wide ? T.main.n : WINDOW;
  const cands = [];
  const cb = cur.path && cur.path !== 'main' ? roadOf(T, cur.path) : null;
  if (cb) {
    const b = nearest(cb, cur.seg - W, cur.seg + W, x, y);
    if (b) cands.push({ path: cb.id, ...b });
    if (T.sprint || cur.seg > cb.n - W) {
      const j = pointAt(T.main, T.sprint && b ? msOnMain(cb, b.s) : cb.to).i;
      const m = nearest(T.main, j - W, j + W, x, y);
      if (m) cands.push({ path: 'main', ...m });
    }
  } else {
    const m = nearest(T.main, cur.seg - W, cur.seg + W, x, y);
    if (m) cands.push({ path: 'main', ...m });
    for (const br of branchesOf(T)) {
      const j = pointAt(T.main, br.from).i;
      const dj = Math.abs(((cur.seg - j + T.main.n / 2) % T.main.n + T.main.n) % T.main.n - T.main.n / 2);
      if (T.sprint ? m && !m.p.layer && m.s > br.from - 18 && m.s < br.to + 18 : dj < W) {
        const b = nearest(br, 0, T.sprint ? br.n : W, x, y);
        if (b) cands.push({ path: br.id, ...b });
      }
    }
  }
  // 길 안에 들어 있는 쪽 우선, 둘 다 안이면 가운데 선이 가까운 쪽(다리 선을 따라가면 일찍 다리 위가 됨), 아니면 가까운 쪽.
  // 다리 끝을 지나친 건 안에 든 게 아님 (거리로 판단)
  if (T.sprint) {
    for (let i = cands.length - 1; i >= 0; i--) {
      const c = cands[i];
      if (c.path === 'main') continue;
      // 지름길 끝 너머에는 지름길의 가상 연장선 대신 합류 본선의 벽을 사용한다.
      if (pastOpenPathEnd(roadOf(T, c.path), c.s, x, y)) cands.splice(i, 1);
    }
  }
  const inside = c => Math.sqrt(c.d2) <= c.p.half;
  cands.sort((a, b) => (inside(b) - inside(a)) || a.d2 - b.d2);
  const c = cands[0];
  if (!c) return null;
  // 갈림길 다리 위치를 큰 길 거리로 바꿔서 순위·바퀴 계산에 쓴다
  const ms = c.path === 'main' ? c.s : msOnMain(roadOf(T, c.path), c.s);
  return { path: c.path, seg: c.i, s: c.s, ms, lat: c.lat, d: Math.sqrt(c.d2), p: c.p };
}

// 물에 빠지면 다시 설 자리: 조금 뒤 가운데 선 (점프대면 도움닫기할 만큼 더 뒤)
export function respawnPose(T, fall) {
  const fb = fall.path && fall.path !== 'main' ? roadOf(T, fall.path) : null;
  // 좁은 다리 초입에서 빠졌으면 큰길로 돌려보낸다 (다리 입구에 멈춰 서면 또 빠지기 쉽다).
  // 카트 맵의 숨은 지름길에서 떨어지면 언제나 입구 앞 본선으로 (실패 = 손해)
  if (fb && !fb.backToMain && fall.s >= 15) {
    const p = pointAt(fb, fall.s - 8);
    return { x: p.x, y: p.y, path: fb.id, seg: p.i, tx: p.tx, ty: p.ty };
  }
  let s = fb ? fb.from - 10 : fall.s - 10;
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
  if (here.path === 'branch' && !T.sprint) {
    car.vx += -here.p.ty * PHYS.wind * dt;
    car.vy += here.p.tx * PHYS.wind * dt;
  }
  const prevMs = car.ms;
  const prevPath = car.path;
  const prevS = car.s;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  const at = locate(T, car, car.x, car.y);
  if (!at) return splash(car, here, t, ev);
  Object.assign(car, { path: at.path, seg: at.seg, s: at.s, ms: at.ms, lat: at.lat });
  // 카트 맵 점프(갈림길 위 틈): 빠르고 똑바르면 날아서 건너고, 아니면 틈으로 떨어진다
  for (const j of T.jumps || []) {
    if (at.path !== j.path || prevPath !== j.path || !crossed(prevS, at.s, j.gap0)) continue;
    const fwd = car.vx * at.p.tx + car.vy * at.p.ty;
    const straight = car.hx * at.p.tx + car.hy * at.p.ty >= Math.cos(j.angle ?? 0.4);
    if (fwd < j.min || !straight) return splash(car, at, t, ev);
    car.air = t + ((j.gap1 - j.gap0 + 2) / fwd) * 1000;
    ev.push('jump');
    return ev;
  }
  for (const j of T.jumps || []) if (at.path === j.path && at.s > j.gap0 && at.s < j.gap1) return splash(car, at, t, ev);
  // 카트 맵 구멍(열린 맨홀): 차 가운데가 들어가면 빠진다
  for (const h of T.holes || []) if (at.path === h.path && (car.x - h.x) ** 2 + (car.y - h.y) ** 2 < h.r * h.r) return splash(car, at, t, ev);
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
    const wall = kartWallBlocked(T, at, side);
    if (!wall) {
      if (!T.sprint) return splash(car, at, t, ev);
      // 카트 맵의 낭떠러지 길(벽 없음): 차 가운데가 길 밖으로 나가고 다른 길 위도 아니면 떨어진다
      if (at.p.fall && Math.abs(at.lat) > at.p.half + 0.3 && !roadWallOpen(T, at.path, at.p, side)) return splash(car, at, t, ev);
      return ev;
    }
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
  // 부스트 발판 (본선은 큰 길 거리, 갈림길은 그 길 위 거리)
  for (const b of T.boosts) {
    const path = b.path || 'main';
    if (at.path !== path) continue;
    const [p0, p1] = path === 'main' ? [prevMs, at.ms] : prevPath === path ? [prevS, at.s] : [-1, -1];
    if (!crossed(p0, p1, b.s) || Math.abs(at.lat) >= 3) continue;
    if (T.sprint) car.boostLeft = Math.max(car.boostLeft || 0, 1);
    else {
      const fwd = car.vx * at.p.tx + car.vy * at.p.ty;
      if (fwd < PHYS.boost) {
        car.vx += at.p.tx * (PHYS.boost - fwd);
        car.vy += at.p.ty * (PHYS.boost - fwd);
      }
    }
    ev.push('boost');
  }
  for (const o of T.oil) if ((car.x - o.x) ** 2 + (car.y - o.y) ** 2 < o.r * o.r) car.oil = t + 800;
  for (const g of T.gates) {
    if (!gateHit(g, car, t)) continue;
    ev.push('gate');
    if (T.sprint) Object.assign(car, { impactLeft: KART.impactTime * 2, boostLeft: 0, charge: 0 });
  }
  // 크레인 쇳덩이: 스치기만 해도 옆으로 크게 튕겨 나간다. 벽 없는 판자 길에선 그대로 떨어진다
  for (const o of T.balls || []) {
    const b = ballAt(o, t);
    const dx = car.x - b.x;
    const dy = car.y - b.y;
    const d = Math.hypot(dx, dy);
    const minD = o.r + KART.radius * 0.85;
    if (d >= minD || d === 0) continue;
    const nx = dx / d;
    const ny = dy / d;
    car.x += nx * (minD - d);
    car.y += ny * (minD - d);
    ev.push('gate');
    if (at.p.fall) return splash(car, at, t, ev);
    if (car.vx * nx + car.vy * ny < 6) {
      car.vx = car.vx * 0.5 + nx * 9;
      car.vy = car.vy * 0.5 + ny * 9;
      Object.assign(car, { impactLeft: KART.impactTime * 3, boostLeft: 0, charge: 0 });
    }
  }
  // 카트 맵 장애물(쓰레기통·라바콘): 부딪히면 튕기고 확 느려진다
  for (const o of T.posts || []) {
    const dx = car.x - o.x;
    const dy = car.y - o.y;
    const d = Math.hypot(dx, dy);
    const minD = o.r + KART.radius * 0.85;
    if (d >= minD || d === 0) continue;
    const nx = dx / d;
    const ny = dy / d;
    car.x += nx * (minD - d);
    car.y += ny * (minD - d);
    const vn = car.vx * nx + car.vy * ny;
    if (vn < 0) {
      car.vx = (car.vx - nx * vn * 1.6) * 0.55;
      car.vy = (car.vy - ny * vn * 1.6) * 0.55;
      Object.assign(car, { impactLeft: KART.impactTime * 2, boostLeft: 0, charge: 0 });
      ev.push('wall');
    }
  }
  // 카트 맵 파도: 정해진 박자로 덮치는 구간. 덮칠 때 그 안에 있으면 빙글 돌고 반쯤 느려진다 (파도 하나에 한 번)
  for (const w of T.waves || []) {
    if (at.path !== w.path || at.s < w.s0 || at.s > w.s1) continue;
    const k = Math.floor(t / w.period);
    if (t - k * w.period >= w.dur || car.waveAt === k) continue;
    car.waveAt = k;
    car.vx *= 0.5;
    car.vy *= 0.5;
    car.yawRate = (car.yawRate || 0) + (Math.random() < 0.5 ? -7 : 7);
    Object.assign(car, { impactLeft: KART.impactTime * 3, boostLeft: 0, charge: 0 });
    ev.push('wave');
  }
  return ev;
}

// 조작·타이어·마찰 (길과 상관없는 부분). surf = 노면
export function drive(car, input, surf, dt) {
  if (surf.kart) return driveKart(car, input, dt, surf);
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

function driveKart(car, input, dt, surf = SURF.asphalt) {
  const fast = surf.max ?? 1;
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
  const turnLimit = forwardSpeed < 0 ? 1.8 : kartTurnRate(before, drifting);
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
    const baseGrip = (drifting ? KART.driftGrip : KART.grip) * (surf.kgrip ?? 1);
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
    : boosted ? KART.boost * fast : Math.min(KART.boost * fast, Math.max(KART.max * fast, before - 20 * dt));
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

function kartWallBlocked(T, at, side) {
  const wall = at.p.walls === 'both' || (at.p.walls === 'outer' && side === at.p.outer);
  // locate는 연결된 두 도로 중 안쪽 노면을 우선한다. 둘 다 벗어난 뒤에도 열린 난간의 연장선을
  // 따라 계속 빠져나가지 않도록 개방은 실제 도로 합집합 안에 있을 때만 유효하다.
  return wall && (!roadWallOpen(T, at.path, at.p, side) || at.d > at.p.half + 0.02);
}

function keepKartOnRoad(T, car) {
  let at = locate(T, car, car.x, car.y);
  if (!at) return;
  const side = Math.sign(at.lat);
  const wall = kartWallBlocked(T, at, side);
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

// 크레인 쇳덩이: 길을 가로질러 좌우로 흔들린다 (시각만으로 정해져서 모두에게 같다). 위치와 속도(m/s)
export function ballAt(o, t) {
  const w = (Math.PI * 2) / o.period;
  const off = o.amp * Math.sin(w * t);
  const v = o.amp * w * 1000 * Math.cos(w * t);
  return { x: o.x + o.nx * off, y: o.y + o.ny * off, vx: o.nx * v, vy: o.ny * v, off };
}

// 앞으로 d m 간 곳의 가운데 선 점. routes = 이번에 탈 갈림길 id들 (지름길로 가기로 했으면 다리 쪽으로)
function ahead(T, car, d, routes) {
  // 이 근처에서 탈 갈림길
  const route = (routes || []).map(id => roadOf(T, id)).find(b => b && car.ms > b.from - 40 && car.ms < b.to - 3);
  // 갈림길 노면이 겹치는 입구에서 locate가 branch를 잠깐 골라도 본선 선호 봇의 목표는 본선에 둔다.
  if (T.sprint && !route) return pointAt(T.main, car.ms + d);
  const cb = car.path !== 'main' ? roadOf(T, car.path) : null;
  if (cb) {
    const s = car.s + d;
    return s <= cb.len ? pointAt(cb, s) : pointAt(T.main, cb.to + (s - cb.len));
  }
  const ms = car.ms + d;
  // 지름길로 가기로 했으면: 입구 전부터 다리 끝까지 다리 선을 따라간다 (큰길 위에 있어도 다리 쪽 거리로 바꿔서)
  if (route && ms > route.from) {
    const { from, to, len } = route;
    const s = car.ms < from ? ms - from : ((car.ms - from) / (to - from)) * len + d;
    return s <= len ? pointAt(route, s) : pointAt(T.main, to + (s - len));
  }
  return pointAt(T.main, ms);
}
const routesOf = mem => mem.routes || (mem.short ? ['branch'] : []);

// 봇: 앞쪽 가운데 선을 노려서 8방향으로 민다. 급커브 앞에선 브레이크. skill 0.85~1, mem.short = 이번엔 지름길
export function botInput(T, car, mem, skill, t) {
  if (T.sprint) return kartBotInput(T, car, mem, skill, t);
  // 다리 입구를 한참 지나 큰길에 있으면(물에서 다시 섰을 때 등) 이번 바퀴는 눈길로
  if (mem.short && car.path === 'main' && car.ms > T.branch.from + 8 && car.ms < T.branch.to) mem.short = false;
  const sp = Math.hypot(car.vx, car.vy);
  const look = 4 + sp * 0.45;
  const tgt = ahead(T, car, look, routesOf(mem));
  const far = ahead(T, car, look + 14, routesOf(mem));
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

function kartBotInput(T, car, mem, skill, t) {
  if (!mem.kartReady) {
    // 출발 줄·실력에서 재현 가능한 선호 라인을 만든다. 모든 봇이 한 줄로 달리지 않는다.
    const p = pointAt(T.main, T.start);
    const lateral = (car.x - p.x) * -p.ty + (car.y - p.y) * p.tx;
    const choice = Math.abs(Math.round(lateral * 10) + Math.round(skill * 1000));
    if (T.branches?.[0]?.id === 'branch' || !T.branches) {
      if (!mem.short) mem.short = choice % 3 !== 0;
    } else if (!mem.routes) {
      // 카트 맵: 보이는 갈래길은 반반, 숨은 지름길은 가끔 (실력이 좋을수록 자주)
      mem.routes = T.branches.filter((b, i) => (choice * 7 + i * 13) % 100 < (b.hidden ? 30 * skill : 50)).map(b => b.id);
      // 숨은 길을 겁 없이 밟는 봇 (자주 떨어진다)
      mem.bold ??= (choice * 3) % 5 < 2;
    }
    if (!Number.isFinite(mem.lane)) mem.lane = (choice % 5 - 2) * 1.25;
    mem.kartReady = true;
  }
  // 갈림길에서 떨어졌으면 이번 경기엔 다시 안 간다
  if (car.sp && car.fall?.path && car.fall.path !== 'main' && mem.routes) mem.routes = mem.routes.filter(id => id !== car.fall.path);
  // 입구를 한참 지나 본선에 있으면(놓쳤거나 떨어져서 다시 섰으면) 그 갈림길은 포기.
  // 이미 들어선 갈림길은 본선을 가로지르는 순간 잠깐 본선으로 잡혀도 계속 간다
  if (car.path !== 'main') (mem.on ||= {})[car.path] = true;
  // 갈림길을 빠져나와 본선에서 그 구간을 지났으면 다음 바퀴엔 처음부터 다시
  for (const id in mem.on || {}) {
    const b = roadOf(T, id);
    if (car.path === 'main' && b && !(car.ms > b.from - 5 && car.ms < b.to)) delete mem.on[id];
  }
  // 정하지 않은 갈림길이라도 본선 노면을 벗어날 만큼 들어와 버렸으면 그 길로 끝까지 간다 (돌아 나올 수 없다)
  const into = !car.sp && car.path !== 'main' && mem.routes && !mem.routes.includes(car.path) ? roadOf(T, car.path) : null;
  if (into?.pts[car.seg]?.offMain) mem.routes.push(into.id);
  for (const id of routesOf(mem)) {
    const b = roadOf(T, id);
    if (!b || car.path !== 'main' || mem.on?.[id] || car.ms <= b.from + 20 || car.ms >= b.to - 12) continue;
    if (mem.routes) mem.routes = mem.routes.filter(x => x !== id);
    else mem.short = false;
  }
  const speed = Math.hypot(car.vx, car.vy);
  // 벽·장애물에 막혀 1초 넘게 못 가면: 그 갈림길은 포기하고 0.8초 후진
  if (!car.sp && !car.air && speed < 1.5 && !mem.wait) mem.slow = (mem.slow || 0) + 1;
  else mem.slow = 0;
  if (mem.slow > 60) {
    mem.slow = 0;
    mem.backing = 48;
    mem.backSteer = -Math.sign(mem.lastSteer || 1);
    if (mem.routes && car.path !== 'main') mem.routes = mem.routes.filter(id => id !== car.path);
  }
  if (mem.backing > 0) {
    mem.backing--;
    return { throttle: 0, steer: mem.backSteer, brake: true, drift: false };
  }
  // 좁은 숨은 길에선 가까이 보고 가운데로 세게 되돌린다 (벽 없는 빙판에서 바깥으로 흘러 떨어지지 않게)
  const tight = car.path !== 'main' && roadOf(T, car.path)?.hidden;
  const look = tight ? 3 + speed * 0.35 : 5 + speed * 0.55;
  const routes = routesOf(mem);
  const target = ahead(T, car, look, routes);
  const far = ahead(T, car, look + 12, routes);
  const split = car.path !== 'main' || routes.some(id => {
    const b = roadOf(T, id);
    return b && car.ms > b.from - 22 && car.ms < b.to;
  });
  let lane = Math.max(-target.half + 2.2, Math.min(target.half - 2.2, mem.lane * (split ? 0.55 : 1)));
  // 좁은 길의 장애물(쓰레기통·바위·맨홀)은 반대쪽으로 비켜 간다
  const post = car.path === 'main' ? null : [...(T.posts || []), ...(T.holes || [])]
    .filter(o => o.path === car.path && o.s > car.s - 0.5 && o.s < car.s + look + 4)
    .sort((a, b) => a.s - b.s)[0];
  if (post) {
    const room = target.half - KART.radius;
    const clear = post.r + (T.holes?.includes(post) ? 0.15 : KART.radius * 0.85);
    lane = post.lat > 0 ? (-room + post.lat - clear) / 2 : (room + post.lat + clear) / 2;
  }
  // 점프대 앞: 가운데로 곧게, 넘을 만큼 빠르게
  const jump = car.path !== 'main' && (T.jumps || []).find(j => j.path === car.path && j.gap0 > car.s && j.gap0 < car.s + 35);
  if (jump) lane = 0;
  if (tight) lane -= (car.lat || 0) * 0.8;
  target.x -= target.ty * lane;
  target.y += target.tx * lane;
  const dx = target.x - car.x;
  const dy = target.y - car.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const angle = Math.atan2(car.hx * dy - car.hy * dx, car.hx * dx + car.hy * dy);
  // 좁은 숨은 길에선 이미 코너 안에 들어와 있어도 알아채게: 지금 자리의 길 방향 → 목표까지 꺾이는 각도 본다
  const turn = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.tx * b.tx + a.ty * b.ty)));
  const bend = Math.max(turn(target, far), tight ? turn(ahead(T, car, 0, routes), target) : 0);
  // 미끄러운 노면·좁은 갈림길에선 조심해서 (카트 맵의 빙판·철판·숨은 길)
  const here = car.path === 'main' ? null : roadOf(T, car.path);
  const grip = SURF[here?.pts[0]?.surface]?.kgrip ?? 1;
  // mem.bold = 숨은 길을 겁 없이 밟는 봇 (자주 떨어진다)
  const careful = mem.bold && here?.hidden ? 1 : here?.hidden ? (0.55 + 0.45 * Math.min(1, grip)) * 0.8 : 0.85 + 0.15 * Math.min(1, grip);
  // 고속에선 핸들이 덜 꺾이니(kartTurnRate) 급커브 앞에선 그만큼 더 줄인다
  let limit = KART.max * skill * careful * (bend > 1 ? 0.46 : bend > 0.6 ? 0.62 : bend > 0.3 ? 0.82 : 1);
  if (jump) limit = Math.max(limit, jump.min + 3);
  // 크레인 쇳덩이: 조심하는 봇은 지나갈 즈음 쇳덩이가 길 위에 올 것 같으면 앞에서 기다린다
  const ball = t != null && !mem.bold && car.path !== 'main' && (T.balls || []).find(o => o.path === car.path && o.s > car.s && o.s < car.s + 14);
  mem.wait = false;
  if (ball) {
    const reach = KART.radius * 0.85 + ball.r + 0.3;
    const gap = ball.s - car.s;
    const eta = (Math.sqrt(speed * speed + 40 * gap) - speed) / 20; // 밟으면 거기까지 걸리는 시간 (가속 약 20m/s²)
    const pass = reach / Math.max(speed, 10);
    for (let k = -pass; k <= pass && !mem.wait; k += 0.04) mem.wait = Math.abs(ballAt(ball, t + (eta + k) * 1000).off - (car.lat || 0)) < reach;
    if (mem.wait) limit = Math.min(limit, ball.s - car.s > 7 ? 5 : 0);
  }
  // 부스트 중엔 곧은 길이면 브레이크로 깎아 먹지 않는다
  const brake = (speed > limit + 1 && !(car.boostLeft > 0 && bend < 0.3)) || Math.abs(angle) > 1.0 && speed > 12;
  const drift = !brake && !jump && bend > 0.16 && Math.abs(angle) < 0.7 && speed > 12 && (car.charge || 0) < 1.25;
  const yawLimit = kartTurnRate(speed, drift) * Math.min(1, speed / 8);
  const desiredYaw = 2 * Math.max(3, speed) * Math.sin(angle) / distance;
  const steer = Math.max(-1, Math.min(1, desiredYaw / Math.max(0.5, yawLimit)));
  mem.lastSteer = steer;
  return { throttle: brake ? 0 : 1, steer, brake,
    drift };
}
