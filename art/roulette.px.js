// 독박 룰렛 도트 그림 (pxl). 화면에서는 전부 3배로 키워서 쓴다 (도트 한 칸 = 3px).
// 다시 굽기: node <pxl>/bin/pxl.js build art/roulette.px.js --out img/roulette --no-preview
use("sweetie16")
pal({
  k: 0, p: 1, r: 2, o: 3, y: 4, l: 5, g: 6, t: 7, n: 8, b: 9, B: 10, c: 11, w: 12, s: 13, m: 14, d: 15,
  W: "#a0623a", D: "#6b3f2a", Y: "#c8963e", // 나무 · 놋쇠 그늘
})
ramps("kdmsw", "kproy", "kDWy", "kYy", "knbBc", "ktgl")

// ───────── 총: 옆모습 (오른쪽을 본다. 화면에서 좌우로만 뒤집는다)
sprite("gun", { w: 46, h: 15, outline: "k" },
  // 개머리판
  poly([0, 5, 8, 3, 14, 3, 14, 10, 9, 10, 0, 14], "W"),
  poly([0, 10, 9, 7, 14, 8, 14, 10, 9, 10, 0, 14], "D"),
  line(1, 6, 8, 4, "y"),
  // 몸통
  rect(14, 2, 7, 8, "m"), hline(14, 2, 7, "s"), rect(14, 8, 7, 2, "d"), px(16, 5, "s"), px(18, 5, "d"),
  // 총열 두 개
  rect(21, 2, 25, 3, "m"), hline(21, 2, 25, "s"), hline(21, 4, 25, "d"),
  rect(21, 5, 25, 3, "m"), hline(21, 5, 25, "s"), hline(21, 7, 25, "d"),
  rect(44, 2, 2, 6, "s"), vline(45, 2, 6, "w"), px(41, 1, "y"),
  // 앞손잡이
  rect(23, 8, 12, 3, "W"), hline(23, 10, 12, "D"), hline(23, 8, 12, "y"),
  // 방아쇠울 · 방아쇠
  hline(15, 13, 5, "d"), vline(19, 10, 3, "d"), vline(15, 10, 3, "d"), px(17, 10, "s"), px(17, 11, "s"),
)

// ───────── 총: 정면 (나를 겨눴을 때 옆모습 총 자리에 이게 뜬다)
sprite("gun_front", { w: 62, h: 34, outline: "k" },
  // 뒤로 멀어지는 몸통, 그 앞에 앞손잡이
  ellipse(31, 19, 26, 12, "d"),
  rect(10, 24, 42, 9, "W"), rect(10, 30, 42, 3, "D"), hline(11, 24, 40, "y"),
  // 총열 두 개: 쇠 테두리 안에 시커먼 구멍
  ...[19, 43].flatMap((cx) => [
    circ(cx, 15, 12, "m"), ring(cx, 15, 12, "d"),
    circ(cx, 15, 8, "k"), ring(cx, 15, 9, "d"), ring(cx, 15, 5, "n"),
    line(cx - 9, 10, cx - 4, 5, "s"), px(cx - 8, 8, "w"), px(cx - 6, 6, "w"),
  ]),
  rect(29, 10, 5, 11, "m"), vline(29, 10, 11, "s"), vline(33, 10, 11, "d"),
  // 가늠쇠
  circ(31, 3, 2, "y"), px(30, 2, "w"),
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
