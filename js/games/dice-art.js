// 주사위 합 도트 그림: 파일 없이 그 자리에서 캔버스에 찍는다.
// 이 컴퓨터엔 pxl(그림 굽는 도구)이 없어서, 독박 룰렛 art/roulette.px.js 와 같은 색(sweetie16) · 같은 글자로 코드에서 찍는다.
// 그림은 전부 1배(도트 한 칸 = 1px)로 만들어 dataURL로 두고, 화면에서 PX(3)배로 키워 쓴다 (image-rendering: pixelated).
//
// 쓰는 법:
//   sprite(name)                 → { url, w, h }   (w · h는 도트 수)
//   img(name, cls, scale)        → <img>
//   dieFace(die, value, state)   → { url, w, h }   die: d6 · x6 · d10 · d20, state: idle · max · min · crack · ghost
//   dieTumble(die, frame)        → { url, w, h }   구르는 그림 4장 (frame 0~3)
//   fighter(weapon, pose, side)  → { url, w, h }   weapon: sw · hm · tw · gb, pose: idle · ready · strike · hurt · down · win,
//                                                  side: a(빨강) · b(파랑). 오른쪽을 본다 (오른쪽 사람은 화면에서 좌우로 뒤집는다)
//   shard(die, i)                → { url, w, h }   깨진 조각 (i 0~5)
//   이름 있는 그림: moon · roof · city · lantern0~2 · coin · coin_s · pile1~8 · flame0~3 · cloud · ember · spark · crowd0~3
export const PX = 3;

export const PAL = {
  k: '#1a1c2c', p: '#5d275d', r: '#b13e53', o: '#ef7d57', y: '#ffcd75', l: '#a7f070', g: '#38b764', t: '#257179',
  n: '#29366f', b: '#3b5dc9', B: '#41a6f6', c: '#73eff7', w: '#f4f4f4', s: '#94b0c2', m: '#566c86', d: '#333c57',
  // 더 쓰는 색 (룰렛 그림과 같은 나무 · 놋쇠 + 밤하늘)
  W: '#a0623a', D: '#6b3f2a', U: '#c47c48', V: '#45261c', Y: '#c8963e',
  R: '#73263a', // 짙은 빨강 (폭발 주사위 그늘)
  K: '#0f1020', // 밤 (실루엣 안쪽)
  M: '#fff1c4', // 달
  N: '#1d2244', // 먼 지붕
};

class Pix {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.g = new Array(w * h).fill(null);
  }
  px(x, y, k) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.g[y * this.w + x] = k;
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.g[y * this.w + x];
  }
  rect(x, y, w, h, k) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, k);
  }
  hline(x, y, w, k) { this.rect(x, y, w, 1, k); }
  vline(x, y, h, k) { this.rect(x, y, 1, h, k); }
  disc(cx, cy, r, k) {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) this.px(x, y, k);
      }
    }
  }
  // 다각형 채우기 (칸 가운데 기준)
  poly(pts, k) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const yc = y + 0.5;
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % pts.length];
        if ((y0 <= yc && y1 > yc) || (y1 <= yc && y0 > yc)) xs.push(x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.ceil(xs[i] - 0.5); x <= Math.floor(xs[i + 1] - 0.5); x++) this.px(x, y, k);
      }
    }
  }
  line(x0, y0, x1, y1, k, t = 1) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      if (t <= 1) this.px(x, y, k);
      else this.disc(x, y, t / 2, k);
    }
  }
  // 그린 것 둘레에 한 칸 테두리 (pxl의 outline처럼)
  outline(k, diag = false) {
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].concat(diag ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : []);
    const add = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        if (nb.some(([dx, dy]) => { const v = this.get(x + dx, y + dy); return v && v !== k; })) add.push([x, y]);
      }
    }
    for (const [x, y] of add) this.px(x, y, k);
  }
  // 빛이 오는 쪽(dx) 가장자리를 밝게
  rim(fromColors, k, dx = 1, dy = 0) {
    const set = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const v = this.get(x, y);
        if (!v || !fromColors.includes(v)) continue;
        const nv = this.get(x + dx, y + dy);
        if (!nv) set.push([x, y]);
      }
    }
    for (const [x, y] of set) this.px(x, y, k);
  }
  recolor(map) {
    this.g = this.g.map(v => (v && map[v] !== undefined ? map[v] : v));
  }
  toURL() {
    const cv = document.createElement('canvas');
    cv.width = this.w;
    cv.height = this.h;
    const ctx = cv.getContext('2d');
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const v = this.g[y * this.w + x];
        if (!v) continue;
        ctx.fillStyle = PAL[v] || v;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return cv.toDataURL('image/png');
  }
}

const cache = new Map();
function make(key, w, h, draw) {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = new Pix(w, h);
  draw(c);
  const out = { url: c.toURL(), w, h };
  cache.set(key, out);
  return out;
}

export function img(name, cls = '', scale = PX) {
  const s = sprite(name);
  const el = document.createElement('img');
  el.className = `dz-spr ${cls}`.trim();
  el.src = s.url;
  el.alt = '';
  el.draggable = false;
  el.width = s.w * scale;
  el.height = s.h * scale;
  return el;
}

// ───────── 숫자 (5×7 도트)
const DIG = {
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
};
function digitsW(str) { return str.length * 6 - 1; }
function digits(c, str, x, y, k, shadow = null) {
  for (let i = 0; i < str.length; i++) {
    const rows = DIG[str[i]];
    if (!rows) continue;
    for (let j = 0; j < 7; j++) {
      for (let q = 0; q < 5; q++) {
        if (rows[j][q] !== '#') continue;
        if (shadow) c.px(x + i * 6 + q, y + j + 1, shadow);
      }
    }
    for (let j = 0; j < 7; j++) for (let q = 0; q < 5; q++) if (rows[j][q] === '#') c.px(x + i * 6 + q, y + j, k);
  }
}

// ───────── 주사위
// 몸통 크기 (테두리 · 번쩍임 둘레 2칸씩 더해서 그림 크기)
const LOOK = {
  d6: { bw: 17, bh: 17, body: 'w', light: 'w', shade: 's', deep: 'm', pip: 'k', ink: 'k' },
  x6: { bw: 17, bh: 17, body: 'r', light: 'o', shade: 'R', deep: 'p', pip: 'y', ink: 'k' },
  d10: { bw: 19, bh: 21, body: 'b', light: 'B', shade: 'n', deep: 'n', digit: 'w', dshadow: 'n', ink: 'k' },
  d20: { bw: 23, bh: 23, body: 'Y', light: 'y', shade: 'D', deep: 'V', digit: 'k', dshadow: null, ink: 'k' },
};
const PAD = 2;
export const DIE_SIZE = Object.fromEntries(Object.entries(LOOK).map(([k, L]) => [k, [L.bw + PAD * 2, L.bh + PAD * 2]]));

const PIPS = {
  1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function shapeOf(die, ox, oy, rot = 0) {
  const L = LOOK[die];
  const cx = ox + L.bw / 2;
  const cy = oy + L.bh / 2;
  let pts;
  if (die === 'd6' || die === 'x6') {
    const w = L.bw;
    const h = L.bh;
    pts = [[ox + 2, oy], [ox + w - 2, oy], [ox + w, oy + 2], [ox + w, oy + h - 2], [ox + w - 2, oy + h], [ox + 2, oy + h], [ox, oy + h - 2], [ox, oy + 2]];
  } else if (die === 'd10') {
    pts = [[cx, oy], [ox + L.bw, oy + L.bh * 0.46], [cx, oy + L.bh], [ox, oy + L.bh * 0.46]];
  } else {
    pts = [[cx, oy], [ox + L.bw, oy + L.bh * 0.26], [ox + L.bw, oy + L.bh * 0.74], [cx, oy + L.bh], [ox, oy + L.bh * 0.74], [ox, oy + L.bh * 0.26]];
  }
  if (!rot) return pts;
  const a = (rot * Math.PI) / 180;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  return pts.map(([x, y]) => [cx + (x - cx) * cs - (y - cy) * sn, cy + (x - cx) * sn + (y - cy) * cs]);
}

function drawDieBody(c, die, L, ox, oy, st) {
  const body = st === 'min' ? 'm' : L.body;
  const light = st === 'min' ? 's' : st === 'max' ? 'w' : L.light;
  const shade = st === 'min' ? 'd' : L.shade;
  const pts = shapeOf(die, ox, oy);
  c.poly(pts, body);
  if (die === 'd6' || die === 'x6') {
    // 위 · 왼쪽 밝게, 아래 · 오른쪽 그늘
    c.hline(ox + 2, oy + 1, L.bw - 4, light);
    c.vline(ox + 1, oy + 2, L.bh - 4, light);
    c.hline(ox + 2, oy + L.bh - 2, L.bw - 4, shade);
    c.vline(ox + L.bw - 2, oy + 2, L.bh - 4, shade);
    c.hline(ox + 3, oy + L.bh - 1, L.bw - 6, shade);
  } else if (die === 'd10') {
    const cx = ox + L.bw / 2;
    // 왼쪽 위 면은 밝게, 오른쪽 아래 면은 그늘 (연(鳶) 모양)
    c.poly([[cx, oy + 1], [cx, oy + L.bh * 0.46], [ox + 2, oy + L.bh * 0.46]], light);
    c.poly([[cx + 0.5, oy + L.bh * 0.5], [ox + L.bw - 2, oy + L.bh * 0.5], [cx + 0.5, oy + L.bh - 1.5]], shade);
    c.poly([[cx - 0.5, oy + L.bh * 0.5], [ox + 2.5, oy + L.bh * 0.5], [cx - 0.5, oy + L.bh - 1.5]], body);
  } else {
    const cx = ox + L.bw / 2;
    // 가운데 세모 면이 숫자 자리, 둘레 면은 그늘
    c.poly(shapeOf(die, ox, oy), shade);
    c.poly([[cx, oy + 2], [ox + L.bw - 2.5, oy + L.bh * 0.72], [ox + 2.5, oy + L.bh * 0.72]], body);
    c.poly([[cx, oy + 2], [cx + 2.5, oy + 6.5], [cx - 2.5, oy + 6.5]], light);
    c.hline(ox + 4, oy + Math.round(L.bh * 0.72), L.bw - 8, light);
  }
}

function drawFaceMark(c, die, L, ox, oy, v, st) {
  if (die === 'd6' || die === 'x6') {
    const pip = st === 'min' ? 'd' : st === 'max' && die === 'd6' ? 'r' : L.pip;
    for (const [i, j] of PIPS[Math.max(1, Math.min(6, v))]) c.rect(ox + 3 + i * 4, oy + 3 + j * 4, 3, 3, pip);
    return;
  }
  const s = String(v);
  const tw = digitsW(s);
  const x = Math.round(ox + (L.bw - tw) / 2);
  const y = die === 'd10' ? Math.round(oy + L.bh * 0.46 - 4) : Math.round(oy + L.bh * 0.5 - 3);
  const k = st === 'min' ? 's' : st === 'max' ? (die === 'd20' ? 'k' : 'y') : L.digit;
  digits(c, s, x, y, k, st === 'min' ? null : L.dshadow);
}

export function dieFace(die, value = 1, state = 'idle') {
  const L = LOOK[die];
  const [W, H] = DIE_SIZE[die];
  return make(`die:${die}:${value}:${state}`, W, H, c => {
    const ox = PAD;
    const oy = PAD;
    if (state === 'ghost') {
      // 깨진 자리: 테두리만 남은 빈칸
      c.poly(shapeOf(die, ox, oy), 'K');
      c.outline('d');
      const m = Math.min(L.bw, L.bh);
      c.line(ox + m * 0.3, oy + m * 0.3, ox + L.bw - m * 0.3, oy + L.bh - m * 0.3, 'd', 2);
      c.line(ox + L.bw - m * 0.3, oy + m * 0.3, ox + m * 0.3, oy + L.bh - m * 0.3, 'd', 2);
      return;
    }
    drawDieBody(c, die, L, ox, oy, state);
    drawFaceMark(c, die, L, ox, oy, value, state);
    if (state === 'crack') {
      // 금: 왼쪽 위에서 오른쪽 아래로 꺾이며 내려간다
      const pts = [[0.2, 0.05], [0.42, 0.32], [0.33, 0.48], [0.6, 0.7], [0.52, 0.82], [0.78, 1]];
      for (let i = 0; i + 1 < pts.length; i++) {
        c.line(ox + pts[i][0] * L.bw, oy + pts[i][1] * L.bh, ox + pts[i + 1][0] * L.bw, oy + pts[i + 1][1] * L.bh, 'k');
      }
      c.line(ox + 0.42 * L.bw, oy + 0.32 * L.bh, ox + 0.7 * L.bw, oy + 0.22 * L.bh, 'k');
    }
    c.outline(L.ink);
    if (state === 'max') {
      c.outline('y');
      for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]) c.px(x, y, 'w');
    }
  });
}

export function dieTumble(die, frame = 0) {
  const L = LOOK[die];
  const [W, H] = DIE_SIZE[die];
  const rot = [22, 45, 68, 12][frame % 4];
  return make(`tumble:${die}:${frame % 4}`, W, H, c => {
    const pts = shapeOf(die, PAD, PAD, rot);
    c.poly(pts, L.body);
    // 흐릿한 면 자국 (구르는 동안 눈은 안 읽힌다)
    const cx = PAD + L.bw / 2;
    const cy = PAD + L.bh / 2;
    const a = (rot * Math.PI) / 180;
    for (let i = 0; i < 3; i++) {
      const r = 3 + i * 2;
      c.px(cx + Math.cos(a + i * 2.1) * r, cy + Math.sin(a + i * 2.1) * r, die === 'd6' ? 'k' : die === 'x6' ? 'y' : L.light);
    }
    c.line(cx - Math.cos(a) * 5, cy - Math.sin(a) * 5, cx + Math.cos(a) * 5, cy + Math.sin(a) * 5, L.shade);
    c.outline(L.ink);
  });
}

export function shard(die, i = 0) {
  const L = LOOK[die];
  const shapes = [
    [[0, 0], [4, 1], [2, 4]], [[0, 1], [3, 0], [5, 3], [1, 4]], [[1, 0], [3, 2], [0, 3]],
    [[0, 0], [5, 0], [3, 2]], [[0, 2], [2, 0], [4, 2], [2, 3]], [[0, 0], [2, 1], [3, 4], [0, 3]],
  ];
  const pts = shapes[i % shapes.length];
  return make(`shard:${die}:${i % shapes.length}`, 8, 7, c => {
    c.poly(pts.map(([x, y]) => [x + 1.5, y + 1.5]), L.body);
    c.px(2, 2, L.light);
    c.outline(L.ink);
  });
}

// ───────── 두 사람 (삿갓 쓴 실루엣, 달빛이 앞쪽 가장자리에)
// 그림 상자는 무기가 안 잘리게 넉넉히 (오른쪽 · 위에 여유). 화면은 FIGHTER.footX · ground 를 발밑으로 맞춘다
const OX = 6;
const OY = 14;
const FW = 72;
const FH = 68;
const G0 = 52;
const GROUND = G0 + OY;
export const FIGHTER = { w: FW, h: FH, footX: 20 + OX, ground: GROUND };
const POSES = {
  idle: { head: [21, 13], sh: [21, 19], hip: [20, 31], kF: [25, 41], fF: [28, G0], kB: [16, 41], fB: [12, G0], eF: [25, 25], hF: [28, 29], eB: [17, 25], hB: [16, 30], wpn: [0.62, 0.78] },
  ready: { head: [21, 14], sh: [21, 20], hip: [20, 32], kF: [26, 42], fF: [30, G0], kB: [15, 42], fB: [10, G0], eF: [25, 17], hF: [28, 12], eB: [16, 26], hB: [14, 31], wpn: [-0.55, -0.83] },
  strike: { head: [29, 15], sh: [28, 21], hip: [23, 32], kF: [32, 41], fF: [38, G0], kB: [16, 42], fB: [7, G0], eF: [34, 21], hF: [40, 21], eB: [21, 26], hB: [18, 29], wpn: [1, -0.04] },
  hurt: { head: [16, 15], sh: [18, 21], hip: [19, 32], kF: [23, 41], fF: [25, G0], kB: [15, 42], fB: [11, G0], eF: [22, 26], hF: [25, 31], eB: [13, 24], hB: [9, 20], wpn: [0.35, 0.94] },
  down: { head: [24, 27], sh: [22, 32], hip: [18, 41], kF: [26, 46], fF: [31, G0], kB: [17, G0 - 1], fB: [10, G0], eF: [26, 38], hF: [29, 43], eB: [17, 37], hB: [15, 43], wpn: [0.25, 0.97] },
  win: { head: [21, 13], sh: [21, 19], hip: [20, 31], kF: [25, 41], fF: [28, G0], kB: [16, 41], fB: [12, G0], eF: [24, 12], hF: [26, 5], eB: [17, 25], hB: [15, 30], wpn: [0.08, -1] },
};
for (const P of Object.values(POSES)) {
  for (const [k, v] of Object.entries(P)) if (k !== 'wpn') P[k] = [v[0] + OX, v[1] + OY];
}
const SIDE = { a: { sash: 'r', hi: 'o' }, b: { sash: 'B', hi: 'c' } };

function drawWeapon(c, w, P, side) {
  const [hx, hy] = P.hF;
  const [dx, dy] = P.wpn;
  const n = Math.hypot(dx, dy) || 1;
  const ux = dx / n;
  const uy = dy / n;
  const px = -uy; // 날 옆 방향
  const py = ux;
  if (w === 'sw') {
    c.line(hx - ux * 3, hy - uy * 3, hx, hy, 'D', 2);                    // 손잡이
    c.line(hx + px * 2.5, hy + py * 2.5, hx - px * 2.5, hy - py * 2.5, 'y', 1); // 코등이
    c.line(hx + ux, hy + uy, hx + ux * 19, hy + uy * 19, 's', 2);         // 날
    c.line(hx + ux * 2 + px * 0.6, hy + uy * 2 + py * 0.6, hx + ux * 18 + px * 0.6, hy + uy * 18 + py * 0.6, 'w', 1);
  } else if (w === 'hm') {
    c.line(hx - ux * 3, hy - uy * 3, hx + ux * 14, hy + uy * 14, 'D', 2); // 자루
    const ex = hx + ux * 15;
    const ey = hy + uy * 15;
    c.line(ex + px * 4, ey + py * 4, ex - px * 4, ey - py * 4, 'm', 7);   // 쇠머리
    c.line(ex + px * 4 + ux, ey + py * 4 + uy, ex - px * 4 + ux, ey - py * 4 + uy, 'd', 2);
    c.line(ex + px * 3 - ux * 2, ey + py * 3 - uy * 2, ex - px * 3 - ux * 2, ey - py * 3 - uy * 2, 's', 1);
  } else if (w === 'tw') {
    const blade = (x, y, ax, ay, len) => {
      c.line(x - ax * 2, y - ay * 2, x, y, 'D', 2);
      c.line(x, y, x + ax * len, y + ay * len, 's', 2);
      c.line(x + ax, y + ay, x + ax * (len - 1), y + ay * (len - 1), 'w', 1);
    };
    blade(hx, hy, ux, uy, 9);
    const [bx, by] = P.hB;
    blade(bx, by, 0.8, -0.6, 7);
  } else {
    // 노름꾼: 부채 (손에서 부챗살이 펴진다)
    const a0 = Math.atan2(uy, ux);
    const pts = [[hx, hy]];
    for (let i = 0; i <= 6; i++) {
      const a = a0 - 0.95 + (i / 6) * 1.9;
      pts.push([hx + Math.cos(a) * 10, hy + Math.sin(a) * 10]);
    }
    c.poly(pts, 'w');
    for (let i = 0; i <= 6; i += 2) {
      const a = a0 - 0.95 + (i / 6) * 1.9;
      c.line(hx, hy, hx + Math.cos(a) * 9.5, hy + Math.sin(a) * 9.5, 'D', 1);
    }
    c.line(hx + Math.cos(a0 - 0.95) * 10, hy + Math.sin(a0 - 0.95) * 10, hx + Math.cos(a0 + 0.95) * 10, hy + Math.sin(a0 + 0.95) * 10, side.sash, 1);
    // 다른 손엔 주사위 주머니
    const [bx, by] = P.hB;
    c.disc(bx, by + 2, 2.6, 'W');
    c.px(bx, by - 0.5, 'y');
  }
}

export function fighter(w, pose = 'idle', sideKey = 'a') {
  const P = POSES[pose] || POSES.idle;
  const side = SIDE[sideKey] || SIDE.a;
  return make(`fighter:${w}:${pose}:${sideKey}`, FW, FH, c => {
    const body = 'K';
    // 뒷다리 · 뒷팔 (조금 더 어둡게)
    c.line(P.hip[0] - 1, P.hip[1], P.kB[0], P.kB[1], body, 3);
    c.line(P.kB[0], P.kB[1], P.fB[0], P.fB[1], body, 3);
    c.hline(P.fB[0] - 2, GROUND, 4, body);
    c.line(P.sh[0] - 1, P.sh[1], P.eB[0], P.eB[1], body, 2.5);
    c.line(P.eB[0], P.eB[1], P.hB[0], P.hB[1], body, 2.5);
    // 도포 자락: 어깨에서 무릎까지 퍼진다
    const [sx, sy] = P.sh;
    const [hx, hy] = P.hip;
    c.poly([[sx - 4, sy], [sx + 3, sy], [hx + 4, hy - 2], [hx + 7, hy + 8], [hx + 1, hy + 10], [hx - 8, hy + 9], [hx - 5, hy - 2]], body);
    // 앞다리
    c.line(hx + 1, hy, P.kF[0], P.kF[1], body, 3);
    c.line(P.kF[0], P.kF[1], P.fF[0], P.fF[1], body, 3);
    c.hline(P.fF[0] - 1, GROUND, 5, body);
    // 허리띠 · 목도리 (편 색)
    c.line(hx - 4, hy - 1, hx + 4, hy - 1, side.sash, 2);
    const tail = [[sx - 2, sy - 1], [sx - 8, sy + 1], [sx - 13, sy - 1], [sx - 17, sy + 2]];
    for (let i = 0; i + 1 < tail.length; i++) c.line(tail[i][0], tail[i][1], tail[i + 1][0], tail[i + 1][1], side.sash, 2);
    c.px(sx - 8, sy, side.hi);
    // 머리 · 삿갓
    const [kx, ky] = P.head;
    c.disc(kx, ky, 3.6, body);
    c.poly([[kx - 9, ky - 1.5], [kx + 9, ky - 1.5], [kx + 1, ky - 7.5]], 'D');
    c.hline(kx - 8, ky - 2, 17, 'V');
    c.line(kx - 4, ky - 3.5, kx + 1, ky - 6.5, 'Y', 1);
    // 앞팔 · 무기
    c.line(sx + 1, sy, P.eF[0], P.eF[1], body, 2.5);
    c.line(P.eF[0], P.eF[1], P.hF[0], P.hF[1], body, 2.5);
    drawWeapon(c, w, P, side);
    // 달빛: 앞쪽(오른쪽) 가장자리, 눈빛 하나
    c.rim([body], 'm', 1, 0);
    c.rim([body], 'd', 0, -1);
    c.px(kx + 2, ky + 0.5, pose === 'down' ? 'm' : 'w');
    c.outline('k');
  });
}

// ───────── 배경 · 작은 그림
const NAMED = {
  moon: [72, 72, c => {
    c.disc(36, 36, 35, 'y');
    c.disc(35, 35, 33.5, 'M');
    for (const [x, y, r] of [[24, 26, 6], [46, 22, 4], [44, 46, 7.5], [27, 50, 3.5], [54, 36, 3], [16, 40, 2.5]]) {
      c.disc(x, y, r, 'y');
      c.disc(x - 0.8, y - 0.8, r - 1.4, 'M');
      c.disc(x + 0.6, y + 0.8, Math.max(1, r - 2.6), 'y');
    }
  }],
  roof: [48, 24, c => {
    // 용마루 (발 딛는 곳) + 그 아래로 흘러내리는 기와 줄 + 끝의 둥근 막새
    c.rect(0, 0, 48, 2, 's');
    c.rect(0, 2, 48, 2, 'm');
    c.rect(0, 4, 48, 1, 'k');
    c.rect(0, 5, 48, 15, 'K');
    for (let x = 0; x < 48; x += 6) {
      c.rect(x + 1, 5, 4, 15, 'd');
      c.vline(x + 1, 5, 15, 'm');
      for (let y = 8; y < 20; y += 4) c.hline(x + 1, y, 4, 'k');
    }
    for (let x = 3; x < 48; x += 6) {
      c.disc(x, 20.5, 2.6, 'm');
      c.px(x - 0.5, 20, 'd');
    }
  }],
  city: [96, 30, c => {
    const roofAt = (x0, w, y0, h) => {
      c.rect(x0 + 3, y0, w - 6, 30 - y0, 'N');
      c.poly([[x0 - 2, y0 + 1], [x0 + 2, y0 - 2], [x0 + w / 2, y0 - h], [x0 + w - 2, y0 - 2], [x0 + w + 2, y0 + 1], [x0 + w / 2, y0 - 1]], 'K');
      c.hline(x0 + 1, y0 - 1, w - 2, 'd');
    };
    roofAt(2, 26, 14, 5);
    roofAt(34, 20, 18, 4);
    roofAt(60, 30, 11, 6);
    for (const [x, y] of [[10, 20], [16, 22], [40, 23], [68, 16], [74, 19], [82, 17]]) c.rect(x, y, 2, 2, 'y');
  }],
  coin: [9, 9, c => {
    c.disc(4.5, 4.5, 4.3, 'Y');
    c.disc(4.2, 4.2, 3.3, 'y');
    c.rect(3, 3, 3, 3, null);
    c.outline('k');
  }],
  coin_s: [7, 7, c => {
    c.disc(3.5, 3.5, 3.3, 'Y');
    c.disc(3.2, 3.2, 2.4, 'y');
    c.rect(3, 3, 1, 1, null);
    c.outline('k');
  }],
  ember: [7, 7, c => {
    c.disc(3.5, 3.5, 3.2, 'r');
    c.disc(3.5, 3.5, 2.2, 'o');
    c.rect(3, 3, 1, 1, 'y');
  }],
  spark: [5, 5, c => {
    c.hline(0, 2, 5, 'y');
    c.vline(2, 0, 5, 'y');
    c.px(2, 2, 'w');
  }],
  cloud: [17, 11, c => {
    c.disc(5, 6, 3.6, 'm');
    c.disc(9, 4.5, 4.2, 'm');
    c.disc(12.5, 6.5, 3.2, 'm');
    c.rect(4, 6, 10, 3, 'm');
    c.disc(9, 4, 3, 's');
    c.rect(3, 8, 12, 1, 'd');
    c.outline('k');
    c.px(6, 10, 'B');
    c.px(11, 10, 'B');
  }],
};
for (let i = 0; i < 3; i++) {
  NAMED[`lantern${i}`] = [11, 17, c => {
    c.rect(4, 0, 3, 2, 'D');
    c.rect(3, 2, 5, 1, 'Y');
    c.poly([[2, 3], [9, 3], [10.5, 7], [9, 12], [2, 12], [0.5, 7]], 'r');
    c.poly([[3.5, 4], [7.5, 4], [8.5, 7.5], [7.5, 11], [3.5, 11], [2.5, 7.5]], ['o', 'y', 'o'][i]);
    if (i === 1) c.rect(5, 6, 1, 3, 'w');
    for (const y of [5, 8, 11]) c.hline(1, y, 9, 'R');
    c.rect(3, 12, 5, 1, 'Y');
    c.vline(5, 13, 3, 'y');
    c.outline('k');
  }];
}
for (let i = 0; i < 4; i++) {
  NAMED[`flame${i}`] = [9, 13, c => {
    const sway = [0, 1, 0, -1][i];
    c.poly([[1, 12], [8, 12], [8, 7], [5 + sway, 0], [3 + sway, 4], [1, 6]], 'r');
    c.poly([[2, 12], [7, 12], [7, 8], [5 + sway, 3], [3, 7]], 'o');
    c.poly([[3, 12], [6, 12], [6, 9], [4.5 + sway * 0.5, 6]], 'y');
    c.rect(4, 10, 2, 2, 'w');
  }];
}
for (let n = 1; n <= 8; n++) {
  NAMED[`pile${n}`] = [15, 4 + n * 2 + 2, c => {
    const H = 4 + n * 2 + 2;
    for (let i = 0; i < n; i++) {
      const y = H - 5 - i * 2 - (i % 2 ? 0 : 0);
      const x = 1 + ((i * 7) % 3) - 1;
      c.poly([[x + 1, y], [x + 12, y], [x + 13, y + 1.5], [x + 12, y + 3], [x + 1, y + 3], [x, y + 1.5]], 'Y');
      c.hline(x + 2, y, 10, 'y');
      c.hline(x + 1, y + 2, 12, 'D');
    }
    c.outline('k');
  }];
}
for (let i = 0; i < 4; i++) {
  NAMED[`crowd${i}`] = [15, 14, c => {
    c.poly([[1, 14], [2, 9], [13, 9], [14, 14]], 'd');      // 어깨
    c.disc(7.5, 6.5, 3.4, 'd');                              // 머리
    if (i === 0) c.poly([[0, 5.5], [15, 5.5], [8, 0.5]], 'D'); // 삿갓
    if (i === 1) { c.rect(2, 3, 11, 1, 'k'); c.rect(5, 0, 5, 3, 'k'); } // 갓
    if (i === 2) c.disc(7.5, 2.2, 1.6, 'd');                  // 상투
    if (i === 3) c.hline(4, 5, 7, 'r');                       // 머리띠
    c.rim(['d'], 'm', 0, -1);
    c.outline('k');
  }];
}

export function sprite(name) {
  const def = NAMED[name];
  if (!def) throw new Error(`dice-art: 없는 그림 ${name}`);
  const [w, h, draw] = def;
  return make(`named:${name}`, w, h, draw);
}

export const SPRITES = Object.keys(NAMED);
export const POSE_KEYS = Object.keys(POSES);
