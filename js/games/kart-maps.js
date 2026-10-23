// 카트 그랑프리 맵: 한 판 3경기를 서로 다른 맵으로 (좌우 반전도 섞여서 매번 다르게).
// 코스 = 모서리마다 반지름을 준 꺾은선(단위 m, x 오른쪽 · y 아래). 직각 코너·헤어핀을 정확히 그리기 쉽다.
// 갈림길: 보이는 갈래길(장단점이 있는 선택지)과 숨은 지름길(미니맵에 없음, 좁고 위험하지만 성공하면 3~6초 이득).
// 숨은 지름길은 실패하면 지름길 입구 앞 본선에서 다시 출발해서 손해가 더 크다 (하이 리스크 하이 리턴).
import { finish, nearest, pointAt, cacheOpenWalls } from './race-core.js';

const SAMPLE = 1.5;

export const KART_MAPS = {
  // 직각 코너가 이어지는 시내. 숨은 길: U자 골목을 건너뛰는 뒷골목 (좁고, 열린 맨홀과 쓰레기통을 번갈아 피해야 함)
  city: {
    name: '도심 골목', theme: 'city',
    sections: ['출발 대로', '계단 코너', '동쪽 대로', 'U자 골목', '북쪽 대로', '서쪽 대로'],
    widths: [14, 13, 14, 13, 14, 14],
    lakes: [{ x: 40, y: -45, rx: 26, ry: 24, kind: 'grass' }],
    loop: [[60, 0, 0, 0], [160, 0, 12, 1], [160, -50, 9], [220, -50, 9, 2], [220, -140, 10], [130, -140, 8, 3],
      [130, -90, 8], [80, -90, 8], [80, -140, 9, 4], [0, -140, 12, 5], [0, 0, 12]],
    branches: [{
      id: 'alley', name: '뒷골목', hidden: true, look: 'alley', w: 4.4, walls: 'both', surface: 'asphalt',
      path: [[150, -140], [60, -140]],
      holes: [[32, 1], [56, 1]], holeR: 1,
      posts: [[44, -1.2]], postR: 0.42,
    }],
  },
  // 헤어핀 셋이 이어지는 산길. 숨은 길: 둘째 길을 가로질러 셋째 길로 올라가는 빙벽 길 (벽 없음, 빙판, 크레바스 점프)
  mountain: {
    name: '설산 지그재그', theme: 'snow',
    sections: ['출발 직선', '첫 헤어핀', '둘째 헤어핀', '셋째 헤어핀', '능선 내리막', '계곡 직선'],
    widths: [14, 13, 13, 13, 14, 14],
    lakes: [{ x: -45, y: -50, rx: 34, ry: 26, kind: 'ice' }],
    loop: [[0, 0, 0, 0], [80, 0, 9, 1], [80, -34, 9], [20, -34, 9, 2], [20, -68, 9], [80, -68, 9, 3],
      [80, -102, 9, 4], [-110, -102, 14], [-110, 0, 14, 5]],
    branches: [{
      id: 'ledge', name: '빙벽 길', hidden: true, look: 'ice', w: 4, walls: null, fall: true, surface: 'ledge',
      path: [[22, 0], [40, 0, 7], [40, -68, 7], [58, -68]], funnel: [3.2, 7],
      jumps: [{ s0: 64, s1: 70, min: 15 }],
    }],
  },
  // 넓게 휘는 바닷가. 보이는 갈래길: 모래 언덕(짧지만 느림). 숨은 길: 폭포 뒤 동굴 (어둡고 굽은 길, 출구에 파도)
  beach: {
    name: '해변 동굴', theme: 'beach',
    sections: ['해변 직선', '파도 커브', '절벽 해안', '야자수 커브', '모래 언덕'],
    widths: [14, 14, 13, 14, 14],
    // 북쪽·동쪽은 바다 (해안선 = 꺾은선, 바다 쪽을 막는 먼 모서리)
    sea: { shore: [[-400, -163, 0], [163, -163, 30], [163, 400, 0]], far: [[400, 400], [400, -400], [-400, -400]] },
    loop: [[20, 0, 0, 0], [140, 0, 26, 1], [140, -90, 26], [95, -90, 14, 2], [85, -140, 16], [35, -140, 16],
      [25, -90, 14, 3], [-60, -90, 20], [-60, 0, 20, 4]],
    branches: [{
      id: 'cave', name: '폭포 동굴', hidden: true, look: 'cave', dark: true, w: 3.8, walls: 'both', surface: 'asphalt',
      path: [[112, -90], [92, -90, 8], [72, -99, 8], [46, -81, 8], [28, -90, 7], [8, -90]], funnel: [2.8, 6],
      posts: [[44, -1.25], [72, 1.25]], postR: 0.55,
      waves: [{ from: -15, to: -3, period: 5000, dur: 2000 }],
    }, {
      id: 'dune', name: '모래 언덕길', look: 'sand', w: 11, walls: null, fall: true, surface: 'sand',
      path: [[-60, -62], [-60, -50, 12], [-24, -6, 12], [-14, 0]],
    }],
  },
  // 시케인과 좁은 직각이 많은 공사장. 보이는 갈래길: 마지막 코너를 질러가는 창고 철판길(짧지만 미끄럽고, 부스트 발판).
  // 숨은 길: 크레인 구역 가로지르기 (좌우로 흔들리는 쇳덩이 + 판자 점프, 벽 없는 공사 구덩이)
  site: {
    name: '공사장 미로', theme: 'site',
    sections: ['진입로', '시케인', '크레인 구역', '서쪽 직선', '자재 창고'],
    widths: [14, 12, 13, 14, 14],
    lakes: [{ x: 35, y: -55, rx: 24, ry: 16, kind: 'mud' }],
    loop: [[0, 0, 0, 0], [120, 0, 8, 1], [120, -30, 7], [140, -30, 7], [140, -60, 7], [120, -60, 7],
      [120, -110, 9, 2], [75, -110, 8], [75, -150, 8], [25, -150, 8], [25, -110, 8, 3], [-50, -110, 12],
      [-50, 0, 12, 4]],
    branches: [{
      id: 'crane', name: '크레인 길', hidden: true, look: 'plank', w: 3.6, walls: null, fall: true, surface: 'asphalt',
      path: [[90, -110], [12, -110]],
      balls: [{ s: 28, amp: 3.4, period: 2400, r: 1.3 }],
      jumps: [{ s0: 46, s1: 52, min: 16, angle: 0.3 }],
    }, {
      id: 'warehouse', name: '창고 철판길', look: 'steel', w: 9, walls: null, fall: true, surface: 'steel',
      path: [[-50, -66], [-50, -58, 6], [-32, -42, 8], [-32, -14, 8], [-22, 0, 6], [-14, 0]],
      boosts: [26, 46],
    }],
  },
};
export const KART_MAP_KEYS = Object.keys(KART_MAPS);

// 모서리를 둥글린 꺾은선 → SAMPLE 간격 점들. wps = [[x, y, 반지름, 구간?], ...]
function rounded(wps, closed) {
  const n = wps.length;
  const at = i => wps[((i % n) + n) % n];
  const unit = (a, b) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const corners = wps.map((w, i) => {
    const r = w[2] || 0;
    if (!r || (!closed && (i === 0 || i === n - 1))) return { A: [w[0], w[1]], B: [w[0], w[1]] };
    const d1 = unit(at(i - 1), w);
    const d2 = unit(w, at(i + 1));
    const cross = d1[0] * d2[1] - d1[1] * d2[0];
    const th = Math.atan2(Math.abs(cross), d1[0] * d2[0] + d1[1] * d2[1]);
    if (th < 1e-3) return { A: [w[0], w[1]], B: [w[0], w[1]] };
    const t = r * Math.tan(th / 2);
    const A = [w[0] - d1[0] * t, w[1] - d1[1] * t];
    const B = [w[0] + d2[0] * t, w[1] + d2[1] * t];
    const sign = Math.sign(cross);
    const C = [A[0] - d1[1] * r * sign, A[1] + d1[0] * r * sign];
    return { A, B, arc: { C, r, a0: Math.atan2(A[1] - C[1], A[0] - C[0]), sweep: sign * th } };
  });
  const out = [];
  let sec = wps[0][3] ?? 0;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    if (wps[i][3] != null) sec = wps[i][3];
    const a = corners[i].B;
    const c1 = corners[(i + 1) % n];
    const b = c1.A;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.round(len / SAMPLE));
    for (let k = 0; k < steps; k++) out.push({ x: a[0] + ((b[0] - a[0]) * k) / steps, y: a[1] + ((b[1] - a[1]) * k) / steps, sec });
    if (c1.arc) {
      const { C, r, a0, sweep } = c1.arc;
      const m = Math.max(2, Math.round((Math.abs(sweep) * r) / SAMPLE));
      for (let k = 0; k < m; k++) {
        const q = a0 + (sweep * k) / m;
        out.push({ x: C[0] + Math.cos(q) * r, y: C[1] + Math.sin(q) * r, sec });
      }
    }
  }
  if (!closed) {
    const w = wps[n - 1];
    out.push({ x: w[0], y: w[1], sec });
  }
  return out;
}

// 결정적인 난수 (맵 장식이 모두에게 같게)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 점이 다각형 안인지 (짝홀 규칙)
function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

// spec = 'city' | 'city~' (~ = 좌우 반전)
export function buildKartMap(spec) {
  const key = String(spec).replace('~', '');
  const mirror = String(spec).endsWith('~');
  const M = KART_MAPS[key] || KART_MAPS.city;
  const fx = x => (mirror ? -x : x);
  const main = finish(rounded(M.loop.map(([x, y, r, sec]) => [fx(x), y, r, sec]), true), true);
  // 폭은 구간 이음매 앞뒤로 부드럽게
  const halves = main.pts.map(p => M.widths[p.sec] / 2);
  main.pts.forEach((p, i) => {
    let sum = 0;
    for (let k = -5; k <= 5; k++) sum += halves[(i + k + main.n) % main.n];
    // 벽 없음: 길 밖으로 나가면 바로 떨어진다 (넓은 대신)
    Object.assign(p, { half: sum / 11, surface: 'asphalt', layer: 0, walls: null, outer: 1, fall: true });
  });
  const secStart = M.sections.map((_, si) => main.pts.find(p => p.sec === si).s);
  const T = {
    key: spec, name: M.name, theme: M.theme, mirror, sections: M.sections, sprint: true, kart: true,
    main, secStart, cross: { x: -1e6, y: -1e6 },
    jump: { ramp: -100, gap0: -99, gap1: -98 },
    branches: [], jumps: [], boosts: [], oil: [], gates: [], posts: [], holes: [], balls: [], waves: [],
    start: main.len - 5,
  };
  const near = (x, y) => nearest(main, 0, main.n - 1, x, y);
  for (const def of M.branches || []) {
    const raw = rounded(def.path.map(([x, y, r]) => [fx(x), y, r, 0]), false);
    const b = finish(raw.map(q => ({ x: q.x, y: q.y })), false);
    const half = def.w / 2;
    // 깔때기: 양 끝 L m는 반폭 wide까지 넓어진다 (본선에서 꺾어 들어가는 입구가 벽에 막히지 않게)
    const [wide, flen] = def.funnel || [half, 1];
    for (const p of b.pts) {
      const fromEnd = Math.min(p.s, b.len - p.s);
      Object.assign(p, { half: half + (Math.max(half, wide) - half) * Math.max(0, 1 - fromEnd / flen), surface: def.surface, layer: 0, walls: def.walls, outer: 1, fall: !!def.fall, sec: -1 });
    }
    const f = near(b.pts[0].x, b.pts[0].y);
    const t = near(b.pts[b.n - 1].x, b.pts[b.n - 1].y);
    // 본선 노면 밖으로 나온 구간 [s0, s1] (입구 가림막·동굴 지붕을 여기 그리고, 봇은 여기 들어오면 끝까지 간다)
    for (const p of b.pts) p.offMain = main.pts.every(q => Math.hypot(q.x - p.x, q.y - p.y) - q.half > 0.5);
    const out = b.pts.filter(p => p.offMain);
    Object.assign(b, {
      id: def.id, name: def.name, hidden: !!def.hidden, dark: !!def.dark, look: def.look,
      from: f.s, to: t.s, backToMain: true, inner: out.length ? [out[0].s, out[out.length - 1].s] : [0, b.len],
    });
    T.branches.push(b);
    const side = l => (mirror ? -l : l);
    const spot = (s, lat = 0) => {
      const p = pointAt(b, s);
      return { x: p.x - p.ty * side(lat), y: p.y + p.tx * side(lat), tx: p.tx, ty: p.ty };
    };
    for (const [s, lat] of def.posts || []) T.posts.push({ ...spot(s, lat), s, lat: side(lat), r: def.postR || 0.5, path: b.id });
    for (const [s, lat] of def.holes || []) T.holes.push({ ...spot(s, lat), s, lat: side(lat), r: def.holeR || 1, path: b.id });
    for (const j of def.jumps || []) T.jumps.push({ path: b.id, gap0: j.s0, gap1: j.s1, min: j.min, angle: j.angle ?? 0.4 });
    for (const w of def.waves || []) T.waves.push({ path: b.id, s0: b.len + w.from, s1: b.len + w.to, period: w.period, dur: w.dur });
    for (const s of def.boosts || []) T.boosts.push({ path: b.id, s, len: 3.5 });
    for (const o of def.balls || []) {
      const c = spot(o.s);
      T.balls.push({ x: c.x, y: c.y, nx: -c.ty, ny: c.tx, s: o.s, amp: o.amp, period: o.period, r: o.r, path: b.id });
    }
  }
  cacheOpenWalls(T);
  // 바다·호수·공원 (그림 전용)
  T.lakes = (M.lakes || []).map(l => ({ ...l, x: fx(l.x) }));
  if (M.sea) {
    const shore = rounded(M.sea.shore.map(([x, y, r]) => [fx(x), y, r]), false);
    T.sea = { shore, poly: [...shore, ...M.sea.far.map(([x, y]) => ({ x: fx(x), y }))] };
  }
  // 한 판 제한 시간: 느긋하게 달려도(평균 12m/s) 들어올 만큼
  T.maxRace = Math.round((main.len / 12) * 1000 / 5000) * 5000 + 10000;
  // 장식 (그림 전용): 길에서 4m 넘게 떨어진 곳에만
  const R = rng([...key].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7) + (mirror ? 1 : 0));
  const roads = [main, ...T.branches];
  const xs = roads.flatMap(r => r.pts.map(p => p.x));
  const ys = roads.flatMap(r => r.pts.map(p => p.y));
  const box = { x0: Math.min(...xs) - 30, x1: Math.max(...xs) + 30, y0: Math.min(...ys) - 30, y1: Math.max(...ys) + 30 };
  const clear = (x, y, gap) => roads.every(r => {
    for (let i = 0; i < r.n; i += 2) {
      const p = r.pts[i];
      if ((p.x - x) ** 2 + (p.y - y) ** 2 < (p.half + gap) ** 2) return false;
    }
    return true;
  });
  T.deco = [];
  const inLake = (x, y, l, pad) => ((x - l.x) / (l.rx + pad)) ** 2 + ((y - l.y) / (l.ry + pad)) ** 2 < 1;
  for (let k = 0; k < 900 && T.deco.length < 140; k++) {
    const x = box.x0 + R() * (box.x1 - box.x0);
    const y = box.y0 + R() * (box.y1 - box.y0);
    const size = 1.5 + R() * 3.5;
    const v = R();
    if (!clear(x, y, size + 3) || (T.sea && inside(T.sea.poly, x, y))) continue;
    const lake = T.lakes.find(l => inLake(x, y, l, size + 2));
    // 공원 안은 나무, 물·얼음 위엔 아무것도
    if (lake && lake.kind !== 'grass') continue;
    T.deco.push({ x, y, size, v, tree: !!lake && inLake(x, y, lake, -size) });
  }
  T.bounds = box;
  return T;
}
