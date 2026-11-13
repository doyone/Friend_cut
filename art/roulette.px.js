// 독박 룰렛 도트 그림 (pxl). 화면에서는 전부 3배로 키워서 쓴다 (도트 한 칸 = 3px).
// 다시 굽기 (pxl 스킬): node ~/.claude/skills/pxl-pixel-art/bin/pxl.js build art/roulette.px.js --out img/roulette --no-preview
use("sweetie16")
pal({
  k: 0, p: 1, r: 2, o: 3, y: 4, l: 5, g: 6, t: 7, n: 8, b: 9, B: 10, c: 11, w: 12, s: 13, m: 14, d: 15,
  W: "#a0623a", D: "#6b3f2a", Y: "#c8963e", // 나무 · 놋쇠 그늘
  U: "#c47c48", V: "#45261c",               // 나무 밝은 쪽 · 제일 어두운 쪽
  P: "#e46a93",                             // 분홍 (룰렛판 칸 · 독심술 뇌)
})
ramps("kdmsw", "kproy", "kVDWUy", "kYy", "knbBc", "ktgl")

// ───────── 총: 위에서 내려다본 수평 쌍대 산탄총. 테이블에 놓인 채 겨눈 사람 쪽으로 돈다
// 54×10 도트로 오른쪽을 보는 그림을 한 번 그리고, 15도마다 돌린 그림을 굽는다: gun_0(위) … gun_6(오른쪽) … gun_12(아래).
// 왼쪽을 볼 땐 화면에서 좌우로 뒤집는다 (위에서 본 총은 거의 대칭이라 티가 안 나고, 도트도 안 뭉개짐).
// 어느 각도든 총 가운데가 그림 가운데 (GUN_BOX×GUN_BOX, 테두리 1칸 더)
const GUN_W = 54;
const GUN_H = 10;
const GUN_BOX = 58;
const GUN_X = (GUN_BOX - GUN_W) / 2;
const GUN_Y = (GUN_BOX - GUN_H) / 2;

function drawGun(c, X, Y) {
  const p = (x, y, k) => c.px(X + x, Y + y, k);
  const row = (y, a, b, k) => c.hline(X + a, Y + y, b - a + 1, k);
  const col = (x, a, b, k) => c.vline(X + x, Y + a, b - a + 1, k);
  const dots = (k, list) => list.forEach(([x, y]) => p(x, y, k));

  // 개머리판 · 손목 (나무): 위에서 보면 총열만 한 폭(6칸)이고 손목에서 4칸으로 좁아진다. 둥근 막대처럼 위는 밝게, 아래는 어둡게
  const top = x => (x <= 12 ? 2 : 3);
  const bot = x => (x <= 12 ? 7 : 6);
  for (let x = 2; x <= 18; x++) {
    for (let y = top(x); y <= bot(x); y++) {
      const up = y - top(x);
      const dn = bot(x) - y;
      p(x, y, dn === 0 ? "V" : dn === 1 ? "D" : up <= 1 ? "U" : "W");
    }
  }
  row(3, 3, 9, "y");                                   // 위쪽 반짝임
  dots("D", [[4, 5], [5, 5], [6, 5], [8, 4], [9, 4], [10, 5], [11, 4]]); // 나뭇결
  dots("W", [[13, 4], [15, 4], [17, 4]]);              // 손목 체커링
  dots("V", [[14, 5], [16, 5]]);
  col(0, 2, 7, "d"); col(1, 2, 7, "n");                // 고무 패드
  dots("k", [[0, 3], [0, 6]]);

  // 공이치기 둘: 기관부 뒤 양옆으로 튀어나와 뒤로 휜 손잡이 (아래쪽은 그늘)
  p(18, 0, "s"); p(19, 0, "m"); row(1, 19, 20, "m");
  p(18, 9, "d"); p(19, 9, "d"); row(8, 19, 20, "d");

  // 기관부 (쇠, 은빛에 덩굴 조각) · 손목 위 쇠띠 · 윗 레버 (가운데 핀에서 뒤로 비스듬히)
  for (const [y, k] of [[2, "s"], [3, "m"], [4, "m"], [5, "m"], [6, "m"], [7, "d"]]) row(y, 19, 27, k);
  row(4, 15, 18, "m"); row(5, 15, 18, "d"); p(15, 4, "s");
  dots("s", [[20, 3], [21, 4], [20, 5], [21, 6], [26, 3], [27, 4], [26, 6]]);
  dots("w", [[22, 2], [23, 3]]); p(24, 4, "s"); p(25, 4, "d");
  col(28, 2, 7, "d");

  // 총열 둘 (나란히, 빛은 위에서) · 총구 · 두 총열 사이 리브 끝의 금빛 가늠쇠
  for (const [y, k] of [[2, "s"], [3, "m"], [4, "d"], [5, "s"], [6, "m"], [7, "d"]]) row(y, 29, 51, k);
  row(2, 33, 45, "w"); row(5, 35, 41, "w");           // 반짝임
  col(52, 2, 7, "d"); col(53, 2, 7, "s"); p(53, 2, "w"); p(53, 5, "w");
  p(51, 4, "y");

  // 앞손잡이 (나무): 총열 밑에 깔려 양옆으로만 보인다 (체커링) · 앞손잡이 쇠
  row(1, 30, 43, "U"); row(8, 30, 43, "D");
  for (const x of [32, 35, 38, 41]) { p(x, 1, "W"); p(x, 8, "V"); }
  p(29, 1, "m"); p(29, 8, "d");
}

// 도트를 그냥 돌리면 뭉개진다 → RotSprite처럼: Scale2x(EPX)를 세 번 해서 8배로 키운 다음,
// 돌린 그림의 칸마다 가운데 자리를 8배 그림에서 집어 온다
function scale2x(g) {
  const h = g.length;
  const w = g[0].length;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? "." : g[y][x]);
  const out = Array.from({ length: h * 2 }, () => new Array(w * 2));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const P = g[y][x];
      const A = at(x, y - 1);
      const B = at(x + 1, y);
      const C = at(x - 1, y);
      const D = at(x, y + 1);
      out[2 * y][2 * x] = C === A && C !== D && A !== B ? A : P;
      out[2 * y][2 * x + 1] = A === B && A !== C && B !== D ? B : P;
      out[2 * y + 1][2 * x] = D === C && D !== B && C !== A ? C : P;
      out[2 * y + 1][2 * x + 1] = B === D && B !== A && D !== C ? D : P;
    }
  }
  return out;
}

function drawGunAt(c, deg) {
  drawGun(c, GUN_X, GUN_Y);
  const src = [];
  for (let y = 0; y < GUN_H; y++) {
    src.push([]);
    for (let x = 0; x < GUN_W; x++) src[y].push(c.is(GUN_X + x, GUN_Y + y, "*") ? c.key(GUN_X + x, GUN_Y + y) : ".");
  }
  const big = scale2x(scale2x(scale2x(src)));
  c.rect(0, 0, GUN_BOX, GUN_BOX, "_");
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  for (let Y = 0; Y < GUN_BOX; Y++) {
    for (let X = 0; X < GUN_BOX; X++) {
      const u = X + 0.5 - GUN_BOX / 2;
      const v = Y + 0.5 - GUN_BOX / 2;
      const ix = Math.floor((u * cos + v * sin + GUN_W / 2) * 8);
      const iy = Math.floor((-u * sin + v * cos + GUN_H / 2) * 8);
      const k = big[iy]?.[ix];
      if (k && k !== ".") c.px(X, Y, k);
    }
  }
}

sprite("gun_6", { w: GUN_BOX, h: GUN_BOX, outline: "k" }, (c) => drawGun(c, GUN_X, GUN_Y));   // →
sprite("gun_0", { base: "gun_6", rot: 270 });                                                 // ↑
sprite("gun_12", { base: "gun_6", rot: 90 });                                                 // ↓
for (const k of [1, 2, 3, 4, 5, 7, 8, 9, 10, 11]) {
  sprite(`gun_${k}`, { w: GUN_BOX, h: GUN_BOX, outline: "k" }, (c) => drawGunAt(c, -90 + k * 15));
}

// ───────── 총: 나를 겨눈 모습 (원근). 총구 둘은 크게 나를 보고, 총열 · 앞손잡이 · 기관부 · 개머리판은 위로(쏘는 사람 쪽으로) 멀어진다.
// 누가 나를 쏘면 결과가 나오기 전까지 이게 1배 → 2배 → 3배로 다가오고 떨린다. 쏘는 사람이 앉은 쪽에 따라 세 장:
// gun_aim_l(내 왼쪽에서) · gun_aim_c(맞은편에서) · gun_aim_r(내 오른쪽에서). 같은 빛(왼쪽 위)으로 따로 그린다.
// 간단한 3D: 총 축을 따라 부품(상자 · 원통)을 놓고 카메라(원점, +z를 봄)로 원근 투영. 상자는 다각형, 총열 · 총구는 칸마다 시선을 쏴서 칠한다
const AIM_W = 76;
const AIM_H = 56;

const aimedGun = (dir) => (c) => {
  const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const add = (...vs) => vs.reduce((a, b) => a.map((x, i) => x + b[i]));
  const mul = (v, k) => v.map((x) => x * k);

  const fwd = norm([0.42 * dir, 0.3, 1]);        // 총구 → 개머리판: 멀어지며 위로 (dir 쪽으로 비스듬히)
  const side = norm(cross([0, 1, 0], fwd));      // 총의 옆
  const up = norm(cross(fwd, side));             // 총의 위
  const P0 = [-1.05 * dir, -0.62, 4.6];          // 총구 가운데 (카메라 바로 앞, 총몸 반대쪽으로 조금)
  const light = norm([-0.55, 0.8, -0.35]);       // 왼쪽 위 앞에서 오는 빛
  const F = 92;                                  // 원근 세기 (클수록 크게)
  const R = 0.45;                                // 총열 반지름
  const at = (u, s, h) => add(P0, mul(fwd, u), mul(side, s), mul(up, h));
  let ox = 0;
  let oy = 0;
  const proj = (p) => [ox + (F * p[0]) / p[2], oy - (F * p[1]) / p[2]];

  // 부품: 상자 = [u0, u1, s0, s1, [h0, h1] at u0, [h0, h1] at u1, 재질]
  const boxes = [
    [11.5, 17.6, -0.36, 0.36, [-0.55, 0.32], [-1.65, 0.12], "wood"],  // 개머리판 (끝으로 갈수록 처지고 두꺼워짐)
    [9, 11.6, -0.62, 0.62, [-0.78, 0.5], [-0.78, 0.5], "metal"],       // 기관부
    [10.5, 11.3, -0.62, -0.3, [0.5, 0.95], [0.5, 0.82], "metal"],      // 공이치기 (왼쪽)
    [10.5, 11.3, 0.3, 0.62, [0.5, 0.95], [0.5, 0.82], "metal"],        // 공이치기 (오른쪽)
    [1.4, 7.6, -0.62, 0.62, [-0.98, -0.35], [-0.98, -0.35], "wood"],  // 앞손잡이
  ];
  const corners = ([u0, u1, s0, s1, ha, hb]) => {
    const pts = [];
    for (const [u, [lo, hi]] of [[u0, ha], [u1, hb]]) for (const s of [s0, s1]) for (const h of [lo, hi]) pts.push(at(u, s, h));
    return pts; // 번호 = (u쪽 << 2) | (s쪽 << 1) | h쪽
  };
  const barrelRing = (s0, u, r = R, n = 28) => Array.from({ length: n }, (_, k) => {
    const t = (k / n) * Math.PI * 2;
    return at(u, s0 + r * Math.cos(t), r * Math.sin(t));
  });

  // 화면에 맞추기: 다 투영해 보고 가운데로
  const all = [...boxes.flatMap(corners), ...[-0.47, 0.47].flatMap((s) => [...barrelRing(s, 0), ...barrelRing(s, 9)])].map(proj);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  ox = Math.round((AIM_W - (Math.max(...xs) + Math.min(...xs))) / 2);
  oy = Math.round((AIM_H - (Math.max(...ys) + Math.min(...ys))) / 2);

  const shadeOf = (n, mat) => {
    const b = dot(n, light);
    if (mat === "wood") return b > 0.45 ? "U" : b > 0 ? "W" : b > -0.4 ? "D" : "V";
    return b > 0.45 ? "s" : b > 0 ? "m" : b > -0.4 ? "d" : "n";
  };
  const flat = (pts) => pts.flatMap((p) => proj(p).map((v) => Math.round(v * 2) / 2));

  // 상자: 카메라를 보는 면만, 먼 면부터
  function drawBox(b) {
    const P = corners(b);
    const faces = [
      [[0, 2, 3, 1], mul(fwd, -1)], [[4, 5, 7, 6], fwd],
      [[0, 1, 5, 4], mul(side, -1)], [[2, 6, 7, 3], side],
      [[0, 4, 6, 2], mul(up, -1)], [[1, 3, 7, 5], up],
    ];
    faces
      .map(([idx, n]) => ({ idx, n, mid: mul(add(...idx.map((i) => P[i])), 1 / 4) }))
      .filter((f) => dot(f.n, mul(f.mid, -1)) > 0)
      .sort((a, b) => Math.hypot(...b.mid) - Math.hypot(...a.mid))
      .forEach((f) => c.poly(flat(f.idx.map((i) => P[i])), shadeOf(f.n, b[6])));
  }

  // 총열 둘 · 총구: 칸마다 카메라에서 시선을 쏴서, 맞은 곳(총열 겉면 · 끝면 · 구멍 안벽)의 방향으로 음영을 정한다
  const sub = (a, b) => a.map((x, i) => x - b[i]);
  const flatten = (v) => sub(v, mul(fwd, dot(v, fwd)));            // 총 축에 수직인 부분
  function hitCyl(D, A, r, far) {
    const Dp = flatten(D);
    const wp = flatten(mul(A, -1));
    const a = dot(Dp, Dp);
    const b = dot(wp, Dp);
    const disc = b * b - a * (dot(wp, wp) - r * r);
    if (disc < 0) return null;
    const t = (-b + (far ? 1 : -1) * Math.sqrt(disc)) / a;
    if (t <= 0) return null;
    const H = mul(D, t);
    const u = dot(sub(H, A), fwd);
    return { t, u, n: norm(flatten(sub(H, A))) };
  }
  const angleOf = (n) => Math.atan2(dot(n, up), dot(n, side));
  const tb = Math.atan2(dot(light, up), dot(light, side));         // 빛을 정면으로 받는 둘레 방향
  const BORE = 0.74;                                                 // 구멍 반지름 / 총열 반지름
  function barrelPixel(D, s0) {
    const A = at(0, s0, 0);
    const out = hitCyl(D, A, R, false);
    const tf = dot(A, fwd) / dot(D, fwd);                            // 끝면(u = 0) 평면
    const rf = Math.hypot(...flatten(sub(mul(D, tf), A)));
    if (tf > 0 && rf <= R && (!out || out.u < 0 || tf <= out.t)) {   // 끝면이 보인다
      const n = norm(flatten(sub(mul(D, tf), A)));
      if (rf > R * BORE) {                                           // 크라운: 밝은 고리, 오른쪽 아래는 그늘
        const b = dot(n, light);
        return { t: tf, k: b > 0.6 && rf > R * 0.9 ? "w" : b > -0.3 ? "s" : "m" };
      }
      const wall = hitCyl(D, A, R * BORE, true);                     // 구멍 안: 건너편 안벽
      if (!wall || wall.u > 3) return { t: tf, k: "k" };
      const lit = -dot(wall.n, light);                               // 안벽은 안쪽을 본다
      const groove = ((((angleOf(wall.n) - 0.55 * wall.u) / (Math.PI * 2)) * 8) % 1 + 1) % 1 < 0.38; // 강선: 깊이 들어갈수록 비틀린다
      if (wall.u > 1.9 || lit < 0.15) return { t: tf, k: "k" };
      if (groove) return { t: tf, k: lit > 0.55 && wall.u < 0.9 ? "n" : "k" };
      return { t: tf, k: lit > 0.55 && wall.u < 0.9 ? "d" : "n" };
    }
    if (!out || out.u < 0 || out.u > 9) return null;
    const b = dot(out.n, light);
    const shine = Math.abs(angleOf(out.n) - tb) < 0.22 && out.u > 0.4 && out.u < 4.5;
    return { t: out.t, k: shine ? "w" : b > 0.75 ? "s" : b > 0.3 ? "m" : b > -0.25 ? "d" : "n" };
  }

  boxes.forEach(drawBox);                                            // 개머리판 · 기관부 · 공이치기 · 앞손잡이
  for (let Y = 0; Y < AIM_H; Y++) {
    for (let X = 0; X < AIM_W; X++) {
      const D = norm([(X + 0.5 - ox) / F, -(Y + 0.5 - oy) / F, 1]);
      const hits = [-0.47, 0.47].map((s0) => barrelPixel(D, s0)).filter(Boolean).sort((a, b) => a.t - b.t);
      if (hits.length) c.px(X, Y, hits[0].k);
    }
  }
  // 두 총열 사이 위 리브 · 금빛 가늠쇠
  const [rx0, ry0] = proj(at(0.3, 0, R * 0.98));
  const [rx1, ry1] = proj(at(9, 0, R * 0.98));
  c.line(Math.round(rx0), Math.round(ry0), Math.round(rx1), Math.round(ry1), "s");
  const [bx, by] = proj(at(0.35, 0, R + 0.18));
  c.circ(Math.round(bx), Math.round(by), 1, "y");
};

for (const [name, dir] of [["gun_aim_l", -1], ["gun_aim_c", 0], ["gun_aim_r", 1]]) {
  sprite(name, { w: AIM_W, h: AIM_H, outline: "k" }, aimedGun(dir));
}

// ───────── 탄: 실탄(빨강) · 공포탄(파랑) · 아직 모르는 탄(?)
sprite("shell_live", { outline: "k" }, `
  .rrrr.
  rorrrp
  rorrrp
  rorrrp
  rorrrp
  rorrrp
  rorrrp
  rprrrp
  yyyyyY
  ywyyyY
  yyyyYY`)
sprite("shell_blank", { base: "shell_live", swap: { r: "b", o: "B", p: "n" } })
sprite("shell_q", { base: "shell_live", swap: { r: "d", o: "m", p: "k", y: "m", Y: "d", w: "s" } },
  grid(2, 2, `
    .ww.
    w..w
    ..w.
    .w..
    ....
    .w..`))

// ───────── 하트 · 카드 뒷면 · 조준 표시 · 해골 · 눈
sprite("heart", { mx: "c", outline: "k" }, `
  .rr.
  rorr
  rrrr
  rrrr
  .rrr
  ..rr
  ...p`)
sprite("heart_off", { base: "heart", swap: { r: "d", o: "d", p: "d" } })

sprite("cardback", { w: 5, h: 7, outline: "k" },
  rect(0, 0, 5, 7, "p"), box(0, 0, 5, 7, "r"), px(2, 3, "y"), px(2, 2, "o"), px(2, 4, "o"), px(1, 3, "o"), px(3, 3, "o"))

sprite("cross", { w: 15, h: 15, outline: "k" },
  ring(7, 7, 6, "o"), ring(7, 7, 5, "r"),
  vline(7, 0, 4, "w"), vline(7, 11, 4, "w"), hline(0, 7, 4, "w"), hline(11, 7, 4, "w"),
  px(7, 7, "w"))

sprite("skull", { mx: "c", outline: "k" }, `
  .www
  wwww
  wkkw
  wkkw
  wwwk
  .www
  .wkw`)

sprite("eye", { mx: "c", outline: "k" }, `
  ..www
  .wwBB
  wwwBk
  .wwBB
  ..www`)

// ───────── 카드 그림 8종 (14×14 + 테두리 = 16×16)
sprite("c_peek", { w: 14, h: 14, outline: "k" },
  line(8, 8, 12, 12, "D", 3), line(8, 8, 11, 11, "W", 2),
  circ(5, 5, 5, "s"), circ(5, 5, 3, "B"), px(4, 3, "w"), px(3, 4, "w"), px(6, 6, "c"), px(7, 5, "c"), ring(5, 5, 5, "m"))

sprite("c_double", { w: 14, h: 14, outline: "k" },
  text(0, 2, "X2", "y", { scale: 2, shadow: "o" }))

sprite("c_heal", { w: 14, h: 14, outline: "k" },
  line(3, 10, 10, 3, "y", 5), rect(5, 5, 4, 4, "w"), px(6, 6, "s"), px(7, 7, "s"),
  px(2, 10, "Y"), px(3, 11, "Y"), px(10, 2, "Y"), px(11, 3, "Y"), px(3, 9, "Y"), px(10, 4, "Y"))

sprite("c_cuff", { w: 14, h: 14, outline: "k" },
  // 고리 두 개(두께 2칸)와 그 사이 사슬
  circ(3, 9, 3, "s"), circ(3, 9, 1, "_"), circ(10, 9, 3, "s"), circ(10, 9, 1, "_"),
  px(1, 7, "w"), px(2, 6, "w"), px(8, 7, "w"), px(9, 6, "w"), px(5, 11, "m"), px(12, 11, "m"), px(4, 12, "m"), px(11, 12, "m"),
  px(5, 5, "m"), px(6, 4, "s"), px(7, 4, "s"), px(8, 5, "m"), px(6, 3, "m"), px(7, 3, "m"))

sprite("c_steal", { outline: "k" }, `
  ...y.y.y......
  ...y.y.y.y....
  ...y.y.y.y....
  .y.yyyyyyy....
  .yyyyyyyyo....
  ..yyyyyyyo....
  ...yyyyyyo....
  ....yyyyo.....
  ....pppppp....
  ....pprppp....
  ....pppppp....`)

sprite("c_scatter", { w: 14, h: 14, outline: "k" },
  poly([7, 0, 9, 4, 13, 2, 10, 6, 14, 8, 10, 9, 12, 13, 8, 10, 6, 14, 5, 10, 1, 12, 3, 8, 0, 6, 4, 5, 3, 1, 6, 4], "o"),
  poly([7, 3, 8, 5, 10, 5, 9, 7, 11, 8, 9, 9, 9, 11, 7, 9, 6, 11, 5, 9, 3, 9, 5, 7, 4, 5, 6, 5], "y"),
  rect(6, 6, 2, 2, "w"))

sprite("c_shield", { mx: true, outline: "k" }, `
  sssssss
  sBBBBBw
  sBBBBBw
  sBBBBBw
  sBBwwww
  sBBBBBw
  sBBBBBw
  .sBBBBw
  .sbBBBw
  ..sbbBw
  ...sbbb
  ....sbb
  .....sb`)

sprite("c_mirror", { w: 14, h: 14, outline: "k" },
  rect(6, 9, 2, 5, "Y"), vline(6, 9, 5, "y"),
  ellipse(7, 5, 5, 5, "y"), ellipse(7, 5, 4, 4, "c"), ring(7, 5, 5, "Y"),
  line(5, 6, 8, 3, "w"), px(6, 7, "w"), px(9, 4, "B"), px(9, 6, "B"), px(8, 7, "B"))

// ───────── 금빛 하트: 가득을 넘친 칸 (🎰 내 하트 +1)
sprite("heart_gold", { base: "heart", swap: { r: "y", o: "w", p: "Y" } })

// ───────── 🎰 운명 카드 · 룰렛판
// 칸 16개는 FATE_ORDER 순서 (js/games/roulette.js): 시계 방향, 0번 칸이 처음에 맨 위.
// 칸마다 [바깥 색, 안쪽 색, 칸 그림]. 이웃한 칸끼리 색이 겹치지 않게
const TAU = Math.PI * 2;
const SEGS = [
  ["r", "p", "alllive"],  // 전탄 실탄
  ["B", "b", "rotate"],   // 손패 돌리기
  ["Y", "D", "tax"],      // 세금 징수
  ["c", "B", "myaug"],    // 내 증강 바꾸기
  ["U", "W", "morelive"], // 실탄 +2
  ["p", "n", "bleed"],    // 모두 하트 -1
  ["l", "g", "heal"],     // 내 하트 +1
  ["m", "d", "hpswap"],   // 하트 바꾸기
  ["o", "r", "power"],    // 이번 발 피해 +2
  ["n", "d", "newaug"],   // 증강 하나 더
  ["y", "Y", "reveal"],   // 탄 공개
  ["b", "n", "reverse"],  // 방향 반대
  ["P", "r", "again"],    // 한 번 더 돌려
  ["t", "n", "allaug"],   // 모두 증강 바꾸기
  ["s", "m", "swap"],     // 총 교체
  ["g", "t", "gift"],     // 모두 카드 +1
];
// 칸 그림 (작게, 검은 테두리): 판이 돌아도 그림은 똑바로 선 채 칸을 따라간다
const FI = {
  alllive: `
    .w.
    www
    www
    yyy
    yyy`,
  rotate: `
    ...w.
    wwwww
    ...w.
    .w...
    wwwww
    .w...`,
  power: `
    ....www
    .w....w
    www.www
    .w..w..
    ....www`,
  myaug: `
    ..w..
    .www.
    wwwww
    .www.
    .w.w.`,
  bleed: `
    ww.ww
    wwkww
    .wkw.
    ..w..`,
  heal: `
    rr.rr
    rwrrr
    .rrr.
    ..r..`,
  reveal: `
    .www.
    wwkww
    .www.`,
  reverse: `
    .ww..
    w..w.
    w..w.
    w.www
    ...w.`,
  swap: `
    .www.
    wkwkw
    wwkww
    wkwkw
    .www.`,
  allaug: `
    .w...w.
    www.www
    .w...w.`,
  gift: `
    wwww
    wrrw
    wrrw
    wwww`,
  tax: `
    .w.w.
    ..w..
    .www.
    wwwww
    wwwww
    .www.`,
  morelive: `
    .r...r.
    wrr.wrr
    rrr.rrr
    yyy.yyy
    yyy.yyy`,
  hpswap: `
    ..r.r..
    ..rrr..
    ...r...
    .w...w.
    wwwwwww
    .w...w.`,
  newaug: `
    ...w...
    ..www..
    wwwwwww
    ..www..
    ...w...`,
  again: `
    .ww.
    w..w
    ..w.
    .w..
    ....
    .w..`,
};
const fiSize = (k) => {
  const rows = FI[k].trim().split("\n").map((r) => r.trim());
  return [Math.max(...rows.map((r) => r.length)) + 2, rows.length + 2];
};
for (const [k, g] of Object.entries(FI)) sprite(`_fi_${k}`, { outline: "k" }, g);

// 판 그리기: 칸마다 각도로 색을 정한다 (돌린 그림을 다시 찍는 게 아니라 각도마다 새로 칠해서 칸 경계가 안 뭉개진다).
// theta = 시계 방향으로 돌린 각도. 금테(왼쪽 위가 밝게) · 칸 사이 살 · 가운데 축 · 테의 전구 · 칸 그림
function drawWheel(c, theta, o = {}) {
  const { cx = c.w / 2, cy = c.h / 2, R = Math.min(c.w, c.h) / 2, rim = 0, hub = 0, segs = SEGS, spokes = true, icons = false, bulbs = 0 } = o;
  const N = segs.length;
  const seg = TAU / N;
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      if (r > R) continue;
      const lit = r ? (-dx - dy) / (r * Math.SQRT2) : 1;
      if (rim && r > R - rim) { c.px(x, y, lit > 0.25 ? "y" : lit > -0.5 ? "Y" : "D"); continue; }
      if (rim && r > R - rim - 1) { c.px(x, y, "k"); continue; }
      if (hub && r < hub) { c.px(x, y, r < hub * 0.4 ? "k" : lit > 0 ? "y" : "Y"); continue; }
      let a = (Math.atan2(dx, -dy) - theta) % TAU;
      if (a < 0) a += TAU;
      const u = a / seg;
      const i = Math.round(u) % N;
      if (spokes && (0.5 - Math.abs(u - Math.round(u))) * seg * r < 0.5) { c.px(x, y, "k"); continue; }
      const [hi, lo] = segs[i];
      c.px(x, y, lo && r < (R - rim) * 0.42 ? lo : hi);
    }
  }
  for (let j = 0; j < bulbs; j++) { // 테의 전구: 흰 것 · 주황 것 번갈아
    const ang = theta + ((j + 0.5) / bulbs) * TAU;
    const rr = R - rim / 2;
    c.px(Math.floor(cx + rr * Math.sin(ang)), Math.floor(cy - rr * Math.cos(ang)), j % 2 ? "w" : "o");
  }
  if (icons) {
    for (let i = 0; i < N; i++) {
      const ang = theta + i * seg;
      const rr = (R - rim) * 0.72;
      const [w, h] = fiSize(segs[i][2]);
      c.stamp(`_fi_${segs[i][2]}`, Math.round(cx + rr * Math.sin(ang) - w / 2), Math.round(cy - rr * Math.cos(ang) - h / 2));
    }
  }
}

// 룰렛판: 시계 방향 한 바퀴 64장 (16칸 × 4장) → anims/wheel.png 가로 띠. 화면에서 띠를 칸칸이 넘겨 돌린다
anim("wheel", { w: 78, h: 78, frames: 64, fps: 24, outline: "k" }, (c) =>
  drawWheel(c, c.phase * TAU, { R: 39, rim: 3, hub: 6, icons: true, bulbs: 32 }))

// 바늘: 판 위에서 멈춘 칸을 가리킨다
sprite("wheel_pin", { outline: "k" }, `
  yyyyyyyyy
  ywwyyyyYy
  .yyrrryY.
  ..yrrrY..
  ...yrY...
  ....Y....`)

// 운명 카드 그림 (손패) · 자리 옆에 붙는 작은 운명 카드 표시
const MINI = [["r"], ["y"], ["B"], ["l"], ["r"], ["y"], ["B"], ["l"]];
sprite("c_fate", { w: 14, h: 14, outline: "k" },
  (c) => drawWheel(c, TAU / 16, { cx: 7, cy: 8, R: 6, rim: 1, hub: 1.5, segs: MINI }),
  poly([4, 0, 10, 0, 7, 4], "y"), px(6, 0, "w"), px(7, 1, "r"))
sprite("fate_mark", { w: 7, h: 7, outline: "k" },
  (c) => drawWheel(c, TAU / 8, { R: 3.5, hub: 1, segs: [["r"], ["y"], ["B"], ["l"]], spokes: false }))

// ───────── ✨ 증강 그림 19종 (14×14 + 테두리 = 16×16)
// 실버
sprite("a_keen", { w: 14, h: 14, outline: "k" }, `
  ..............
  ..............
  ...mmmmmmmm...
  ..m........m..
  ....wwwwww....
  ..wwwBBBBwww..
  .wwwBnnnnBwww.
  wwwBnnkwnnBwww
  .wwwBnnnnBwww.
  ..wwwBBBBwww..
  ....wwwwww....
  ..............
  ..............
  ..............`)
sprite("a_counter", { w: 14, h: 14, outline: "k" }, `
  ..............
  .....rrrrr....
  ...rrorrrrrr..
  ..rorrrrrrrrr.
  ..rorrrrrrrrr.
  ..rrrrrrrrrrr.
  ..rrrrrrrrrrp.
  ..prrrrrrrrp..
  ...pprrrrpp...
  ....wwwwww....
  ....wwwwww....
  ....ssssss....
  ..............
  ..............`)
sprite("a_pouch", { w: 14, h: 14, outline: "k" }, `
  ..............
  .....DWWD.....
  ......WW......
  .....yYYy.....
  ....WUUWWW....
  ...WUUWWWWW...
  ..WUUWWWWWWD..
  ..WUWWyWWWWD..
  ..WWWyyyWWWD..
  ..WWWWyWWWDD..
  ...WWWWWWDD...
  ....DDDDDD....
  ..............
  ..............`)
sprite("a_revenge", { w: 14, h: 14, outline: "k" }, `
  ..............
  ......yy......
  ......WD......
  ......WD......
  ....yyyyyy....
  .....YYYY.....
  ......ws......
  ......ws......
  ......ws......
  ......ws......
  ......ws......
  .......w......
  .......r......
  .......r......`)
sprite("a_hunter", { w: 14, h: 14, outline: "k" },
  circ(6, 7, 6, "r"), circ(6, 7, 4, "w"), circ(6, 7, 2, "r"), px(6, 7, "w"),
  line(7, 6, 12, 1, "W"), line(11, 0, 13, 2, "o"), px(10, 1, "o"), px(12, 3, "o"))
// 골드
sprite("a_vamp", { w: 14, h: 14, outline: "k" }, `
  ..............
  ......r.......
  ......rr......
  .....rrr......
  .....rrrr.....
  ....rorrrr....
  ...rorrrrrr...
  ...rwrrrrrr...
  ..rorrrrrrrr..
  ..rrrrrrrrrp..
  ..rrrrrrrrrp..
  ...rrrrrrrp...
  ....pppppp....
  ..............`)
sprite("a_quick", { w: 14, h: 14, outline: "k" }, `
  ..............
  .......yyyyw..
  ......yyyyw...
  .....yyyyw....
  ....yyyyw.....
  ...yyyyyyyyy..
  .......yyyy...
  ......yyyy....
  .....yyyy.....
  ....yyy.......
  ...yyY........
  ...yY.........
  ...Y..........
  ..............`)
sprite("a_fire", { w: 14, h: 14, outline: "k" }, `
  ..............
  ......o.......
  .....oo.......
  .....ooo...o..
  ....oooo..oo..
  ...ooyooo.oo..
  ...oyyyooooo..
  ..ooyyyyoooo..
  ..oyyywyyooo..
  ..oyywwwyyoo..
  ..ooywwwyyoo..
  ...ooyyyyoo...
  ....rooooor...
  ..............`)
sprite("a_reflex", { w: 14, h: 14, outline: "k" }, `
  ..............
  ......cc......
  .....cwcc.....
  ....cwcccc....
  ...cwccccBc...
  ..cwccccccBc..
  ..ccccccccBB..
  ...cccccccB...
  ....cccccB....
  .....cccB.....
  ......cB......
  ..............
  ..............
  ..............`)
sprite("a_sniper", { w: 14, h: 14, outline: "k" }, `
  ..............
  .....ssss.....
  ...ss.ll.ss...
  ..s...ll...s..
  ..s........s..
  .s..........s.
  .sll..rr..lls.
  .s..........s.
  ..s........s..
  ..s...ll...s..
  ...ss.ll.ss...
  .....ssss.....
  ..............
  ..............`)
sprite("a_fuse", { w: 14, h: 14, outline: "k" }, `
  ..............
  ..........y...
  .........yoy..
  ........W.y...
  .......W......
  ....ddWd......
  ...dddddd.....
  ..dsdddddd....
  ..dmdddddd....
  ..dddddddd....
  ..dddddddd....
  ...dddddd.....
  ....dddd......
  ..............`)
// 도박사: 운명 카드가 한 장 더 → 겹친 카드 두 장 (뒤 카드는 기울게)
sprite("a_dealer", { w: 14, h: 14, outline: "k" },
  poly([1, 3, 7, 1, 10, 11, 4, 13], "p"), poly([2, 4, 6, 3, 8, 10, 4, 11], "r"),
  rect(5, 1, 8, 12, "y"), rect(6, 2, 6, 10, "Y"), rect(7, 3, 4, 8, "p"),
  px(8, 5, "y"), px(9, 6, "y"), px(8, 7, "y"), px(9, 8, "y"), px(5, 1, "w"), px(6, 1, "w"))
// 프리즘
sprite("a_chain", { w: 14, h: 14, mx: true, outline: "k" }, `
  .......
  ....www
  ...wwww
  ..wwwww
  ..wwwww
  ..wwrrw
  ..wwrrw
  ..wwwww
  ...wwwk
  ....www
  ....wkw
  ....www
  .......
  .......`)
sprite("a_phoenix", { w: 14, h: 14, mx: true, outline: "k" }, `
  .......
  .......
  o......
  oy.....
  oyy.rr.
  .oyrrrr
  .oyrwrr
  ..yrrrr
  ...yrrr
  ....rrr
  .....rr
  ......r
  .......
  .......`)
sprite("a_prophet", { w: 14, h: 14, outline: "k" },
  circ(7, 6, 5, "p"), circ(7, 6, 4, "b"), circ(6, 5, 2, "B"), px(5, 4, "c"), px(5, 3, "w"), px(9, 8, "n"), px(10, 7, "n"),
  rect(3, 11, 8, 3, "Y"), hline(4, 11, 6, "y"))
sprite("a_devil", { w: 14, h: 14, mx: true, outline: "k" }, `
  .......
  .r.....
  .rr....
  ..rrrrr
  ..rrrrr
  .rrrrrr
  .rryyrr
  .rrkyrr
  .rrrrrr
  .rrkrrr
  ..rrkkk
  ...rrrr
  .......
  .......`)
sprite("a_dual", { w: 14, h: 14, outline: "k" }, `
  ..............
  ...oo....oo...
  ..oooo..oooo..
  ..oyoo..oyoo..
  ..yyyy..yyyy..
  ..ywyy..ywyy..
  ..ywyy..ywyy..
  ..yyyy..yyyy..
  ..yyyy..yyyy..
  ..YYYY..YYYY..
  ..YyyY..YyyY..
  ..YYYY..YYYY..
  ..............
  ..............`)

// ───────── ✨ 새 증강 그림 13종 (그림 에이전트 셋이 나눠 그림: 실버 · 골드 · 프리즘)
// 실버
// 탐정: 체크무늬 사냥모자(앞챙은 왼쪽, 뒷챙 끝은 돋보기 뒤로) + 앞에 든 놋쇠 돋보기 (손잡이는 왼쪽 아래로)
sprite("a_sleuth", { w: 14, h: 14, outline: "k" }, `
  ..............
  .....yDDU.....
  ...DyyDDyyD...
  ..yyDDUUDDWW..
  ..yyDDUUDDWW..
  ..DDUUDDUkkk..
  .yDDUUDDkyYYk.
  yUVVVVVkywcBYD
  D......ycBBBBY
  .......YBBBBnY
  .......YBBBnnY
  .......DYBnnY.
  ......WD.YYY..
  .....WD.......`)

// 소매치기: 검은 눈가리개 가면. 비스듬한 눈구멍 사이로 옆을 흘끔 보는 눈, 위쪽 테두리에 빛
sprite("a_thief", { w: 14, h: 14, outline: "k" }, `
  ..............
  ..............
  ..............
  ..ssmm..mmmm..
  .swsmmmmmmmmm.
  msmddddddddddd
  md.kwwddd.kwwd
  mdd.kwdd.kwddd
  .ddddddddddddd
  .ddddd..ddddd.
  ..ddd....ddd..
  ..............
  ..............
  ..............`)

// 아드레날린: 빨간 약이 든 주사기 (오른쪽 위 → 왼쪽 아래), 바늘 끝에 맺힌 핏방울
sprite("a_adren", { w: 14, h: 14, outline: "k" }, `
  ...........ww.
  ............sm
  .......ws..s.m
  ........sss...
  .......wdsm...
  ......woddmm..
  .....worrs.d..
  .....orrs.....
  ....ssrs......
  ....sm........
  ...s..........
  ...r..........
  ..orr.........
  ..rrp.........`)

// 덫: 바닥에 벌려 놓은 쇠 덫. 둥근 테 앞뒤로 뾰족한 이빨, 오른쪽 아래로 사슬
sprite("a_trap", { w: 14, h: 14, outline: "k" }, `
  .....w..w.....
  ..w..s..s..w..
  ..s.wsmwsm.s..
  .wsmsssssswsm.
  .smddddddddmd.
  sskkkkkkkkkkmd
  skwkkwkkwkkwmd
  skskkskkskksmd
  swsmwsmwsmwsmd
  .wssssssssssm.
  ..mmmmmmmmmd..
  ...dddddddd.s.
  ...........m.s
  ............s.`)

// 그림자: 두건을 깊게 쓴 그림자. 얼굴은 어둠 속, 흰 눈만. 아래는 연기처럼 흩어짐
sprite("a_shadow", { w: 14, h: 14, outline: "k" }, `
  ......bn......
  .....bBnn.....
  ....bBnnnn....
  ...bBnnnnnn...
  ..bBnnnnnnnn..
  ..bnnkkkkknn..
  .bnnkkkkkkknn.
  .bnkwwkkkwwkn.
  .bnkkkkkkkkkn.
  .bnnkkkkkkknn.
  .nbnnnkkknnnn.
  nbnnnnnnnnnnnn
  nnnnnnnnnnnnnn
  n.nnn.nnn.nnn.`)
// 골드
sprite("a_poison", { w: 14, h: 14, outline: "k" }, `
  ....swwsm.wl..
  .....sdm..lg..
  .....sdm......
  ....swddm...l.
  ..swddddddm...
  ..wdddddddm...
  .slllllllllg..
  .wlggwwwgggt..
  .wlgwwwwwggt..
  .llgwkwkwggt..
  .lgggwwwggtt..
  ..gggwgwgtt...
  ..ggggggttt...
  ....ttttt.....`)
sprite("a_hook", { w: 14, h: 14, outline: "k" }, `
  ....wwss......
  ..wwssssm.....
  .ws....sm.....
  .ws.....sm....
  .ss.....sm....
  ..sm....sm....
  ...w....wm....
  ........sm....
  .......ysmY...
  .......yYYY...
  ......UUWWDD..
  ......UWWWDD..
  ......UWWWDD..
  .......VVVV...`)
sprite("a_watcher", { w: 14, h: 14, outline: "k" }, `
  ..............
  ............sm
  .....wwwwww.sm
  ....wwwwwwm.sm
  ...wwwwwwmmdsm
  ..wwwwwwmmmdsm
  wwwwwwwmmmm.sm
  .ddddddmmmm.sm
  .ssddsrmmmd.sm
  .sdcndsmmd..sm
  .sdnBdsmd.....
  .ssddssd......
  .mmmmmm.......
  ..............`)
// 프리즘
// 폭발탄: 실탄(빨간 탄피 + 놋쇠 밑동)의 입구에서 터지는 폭발 + 사방으로 튀는 파편
sprite("a_splash", { w: 14, h: 14, outline: "k" }, `
  .y....r.....o.
  ..r..ror...r..
  ...rroyorrr...
  .rrooyyyyoorr.
  rooyyywwyyyoor
  .rroyywwwyyorr
  ..rrooyyyoorr.
  ..rrooooooorr.
  .rr.kprrpk.rr.
  .r..rorrrp..r.
  ....rorrrp....
  ....yyyyyY....
  ....ywyyyY....
  ....yyyyYY....`)

// 룰렛 중독: 빨간 슬롯머신 (금빛 간판 · 7 7 7 창 · 오른쪽 손잡이)
sprite("a_addict", { w: 14, h: 14, outline: "k" }, `
  ............or
  .YyyyyyyyY..rp
  rorrrrrrrrp.s.
  kkkkkkkkkkk.s.
  rrrkrrrkrrr.s.
  wwrkwwrkwwr.s.
  wwrkwwrkwwr.s.
  wrwkwrwkwrw.s.
  wrwkwrwkwrwss.
  kkkkkkkkkkk...
  rorrrrrrrrp...
  rorrrrrrrrp...
  rprrrrrrrpp...
  .pppppppppp...`)

// 찬탈자: 보석 박힌 금관을 비스듬히 꿰뚫은 단검 (손잡이 오른쪽 위, 칼끝 왼쪽 아래)
sprite("a_usurp", { w: 14, h: 14, outline: "k" }, `
  ............or
  ...........Drp
  ........orD...
  .........or...
  ........wsor..
  .......ws.....
  .w....yws..y..
  .yy..yws..yY..
  .yyy.wsY.yyY..
  .yyywsYyyyyY..
  .yywsYyyyyyY..
  .YwsYYrYYlYY..
  .wsYYYYYYYYY..
  ws............`)

// 독심술: 분홍 뇌 (주름 · 아래 그늘 · 뇌줄기) + 반짝임
sprite("a_mind", { w: 14, h: 14, outline: "k" }, `
  ...........w..
  ..........www.
  .w.........w..
  ..............
  ...PP.PPP.PP..
  ..PwPPPrPPPPP.
  .PwPPrrPPPrrPP
  .PPrPPPPrPPPrP
  PrPPPrrPPPrPPP
  PPPrrPPPrrPPrP
  .PrPPPrPPPPrPP
  ..PPrPPrrPPPr.
  ....rrrr.rrr..
  ........pp....`)

// 기절탄: 노란 소용돌이 + 주위를 도는 별 셋
sprite("a_stun", { w: 14, h: 14, outline: "k" }, `
  .y.........y..
  ywy.......yyy.
  .y.......yywyy
  ..........yyy.
  ...wwyyy..y.y.
  ..wyyyyyy.....
  .wyy...yyy....
  yyy.....yyy...
  yy...oo..yo...
  yy..oooo.yo...
  yy....oo....y.
  yyo..ooo...ywy
  .yooooo.....y.
  ..oooo........`)
