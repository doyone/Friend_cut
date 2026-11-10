// 독박 룰렛 도트 그림 (pxl). 화면에서는 전부 3배로 키워서 쓴다 (도트 한 칸 = 3px).
// 다시 굽기 (pxl 스킬): node ~/.claude/skills/pxl-pixel-art/bin/pxl.js build art/roulette.px.js --out img/roulette --no-preview
use("sweetie16")
pal({
  k: 0, p: 1, r: 2, o: 3, y: 4, l: 5, g: 6, t: 7, n: 8, b: 9, B: 10, c: 11, w: 12, s: 13, m: 14, d: 15,
  W: "#a0623a", D: "#6b3f2a", Y: "#c8963e", // 나무 · 놋쇠 그늘
  U: "#c47c48", V: "#45261c",               // 나무 밝은 쪽 · 제일 어두운 쪽
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

// ───────── 총: 정면
// 좌우 쌍대: 시커먼 구멍 둘이 나를 본다 (누가 나를 쏘면 결과가 나오기 전까지 이게 1배 → 2배 → 3배로 다가온다)
sprite("gun_front", { w: 61, h: 36, outline: "k" },
  // 아래 앞손잡이 (나무, 체커링)
  ellipse(30, 27, 30, 8, "V"), ellipse(30, 26, 29, 7, "D"), ellipse(30, 24, 28, 5, "W"), hline(6, 21, 49, "U"),
  ...[10, 16, 22, 28, 34, 40, 46, 52].map((x) => px(x, 27, "V")),
  // 두 총열 사이 리브
  rect(26, 4, 9, 22, "m"), vline(26, 4, 22, "s"), vline(34, 4, 22, "d"),
  // 총열 둘: 쇠 테두리 → 어두운 턱 → 시커먼 구멍 (빛은 왼쪽 위에서)
  ...[17, 43].flatMap((cx) => [
    circ(cx, 15, 12, "m"), ring(cx, 15, 12, "d"),
    circ(cx, 15, 9, "d"), circ(cx, 15, 8, "k"), ring(cx, 15, 6, "n"), ring(cx, 15, 3, "n"),
    line(cx - 10, 12, cx - 5, 6, "s"), px(cx - 9, 9, "w"), px(cx - 7, 7, "w"), line(cx + 6, 22, cx + 9, 18, "d"),
  ]),
  // 리브 위 금빛 가늠쇠
  circ(30, 2, 2, "y"), px(29, 1, "w"),
)

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
