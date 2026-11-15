// 독박 원정대 도트 그림 (pxl). 화면에서는 정수배로 키워서 쓴다 (사람 · 적 2배, 마왕 3배, 아이콘 1~2배).
// 다시 굽기 (pxl 스킬): node ~/.claude/skills/pxl-pixel-art/bin/pxl.js build art/raid.px.js --out <임시 폴더>
//   → <임시 폴더>/sprites/*.png 만 img/raid/sprites/ 로 옮긴다 (scenes/contact.png 는 한눈에 보는 확인용).
//   크기가 16×16(테두리 포함)이 아닌 그림은 raid-view.js 의 SIZE 표에도 적는다.
// 분위기: 횃불 아래 지하 묘지. 어둡고 낡은 쇠와 뼈. 귀엽게 그리지 않는다.
use("sweetie16")
pal({
  k: 0, p: 1, r: 2, o: 3, y: 4, l: 5, g: 6, t: 7, n: 8, b: 9, B: 10, c: 11, w: 12, s: 13, m: 14, d: 15,
  W: "#a0623a", D: "#6b3f2a", Y: "#c8963e",   // 나무 · 가죽 · 놋쇠
  f: "#e0a078", h: "#a8664a",                 // 살갗
  U: "#d9c9a3", V: "#9e8f72",                 // 뼈
  G: "#7d9a64", H: "#4f6447",                 // 썩은 살 (망자)
  F: "#a86a6a", E: "#6a3442",                 // 생살 (골렘)
  L: "#3d2147",                               // 마왕의 망토
  A: "#2e3142", a: "#40445a", Z: "#22242f",   // 묘지 돌
  q: "#2c2233", j: "#6a5374", J: "#4b3a52",   // 어둠 (망토 · 마왕)
  x: "#7a2433", X: "#551826",                 // 마른 피
})
ramps("kdmsw", "kproy", "kDWY", "VU", "HG", "EF", "ZAa", "qJj", "Xxr", "hf")

/* ═════════ 원정대 (18×24) ═════════ */

sprite("h_guard", { w: 18, h: 24, outline: "k" }, (c) => {
  c.rect(7, 18, 2, 5, "m"); c.rect(11, 18, 2, 5, "m");        // 다리
  c.rect(6, 22, 3, 2, "d"); c.rect(11, 22, 3, 2, "d");        // 장화
  c.rect(6, 9, 8, 10, "n"); c.rect(8, 9, 4, 10, "b");          // 겉옷
  c.hline(6, 15, 8, "D"); c.px(10, 15, "Y");                   // 허리띠
  c.rect(12, 8, 4, 3, "s"); c.hline(12, 8, 4, "w");            // 오른 어깨
  c.rect(7, 1, 6, 7, "s"); c.hline(7, 1, 6, "w"); c.vline(12, 2, 6, "m"); // 투구
  c.hline(8, 4, 4, "k"); c.px(9, 6, "m"); c.px(11, 6, "m");    // 눈구멍 · 숨구멍
  c.px(10, 0, "r"); c.px(9, 0, "r");                           // 깃
  c.rect(14, 11, 2, 4, "s");                                   // 오른팔
  c.vline(16, 1, 12, "w"); c.vline(17, 2, 11, "s");            // 칼날
  c.hline(14, 13, 4, "Y"); c.rect(16, 14, 1, 3, "D");          // 코등이 · 손잡이
  c.rect(0, 8, 7, 11, "m"); c.poly([0, 19, 6, 19, 3, 23], "m"); // 큰 방패
  c.rect(1, 9, 5, 9, "s"); c.poly([1, 18, 5, 18, 3, 21], "s");
  c.vline(3, 10, 10, "Y"); c.hline(1, 13, 5, "Y");             // 방패 문장
})

sprite("h_berserk", { w: 18, h: 24, outline: "k" }, (c) => {
  c.line(15, 23, 12, 3, "D", 2);                               // 도끼 자루 (등 뒤)
  c.poly([11, 1, 17, 0, 17, 7, 11, 5], "s"); c.vline(17, 0, 8, "w"); c.px(12, 3, "m"); // 도끼날
  c.rect(7, 19, 2, 4, "h"); c.rect(11, 19, 2, 4, "h");        // 다리
  c.rect(6, 22, 3, 2, "D"); c.rect(11, 22, 3, 2, "D");
  c.rect(6, 15, 8, 5, "D"); c.px(7, 17, "W"); c.px(10, 16, "W"); c.px(12, 18, "W"); // 털 바지
  c.rect(6, 8, 8, 8, "f"); c.vline(13, 8, 8, "h"); c.hline(8, 12, 3, "h"); // 맨몸
  c.line(7, 9, 10, 13, "x");                                   // 흉터
  c.hline(6, 15, 8, "D"); c.px(9, 15, "Y");
  c.rect(4, 9, 2, 6, "f"); c.rect(4, 15, 2, 1, "h");          // 왼팔
  c.rect(14, 7, 2, 5, "f");                                    // 오른팔 (자루를 쥔다)
  c.rect(7, 2, 6, 6, "f"); c.vline(12, 2, 6, "h");             // 얼굴
  c.px(8, 4, "k"); c.px(11, 4, "k");
  c.rect(7, 6, 6, 2, "r"); c.px(9, 7, "o");                    // 수염
  c.hline(6, 1, 8, "m"); c.hline(6, 2, 8, "s");                // 투구 테
  c.line(6, 1, 4, -1, "U"); c.line(13, 1, 15, -1, "U");        // 뿔
  c.px(5, 0, "U"); c.px(14, 0, "U");
})

sprite("h_gunner", { w: 18, h: 24, outline: "k" }, (c) => {
  c.rect(7, 20, 2, 3, "d"); c.rect(10, 20, 2, 3, "d");
  c.rect(6, 22, 3, 2, "q"); c.rect(10, 22, 3, 2, "q");
  c.rect(5, 9, 9, 12, "D"); c.rect(6, 10, 2, 11, "W"); c.vline(13, 9, 12, "q"); // 외투
  c.rect(6, 7, 7, 2, "r"); c.px(12, 9, "r"); c.px(12, 10, "r"); // 목도리
  c.rect(7, 3, 5, 4, "f"); c.vline(11, 3, 4, "h"); c.px(8, 5, "k"); c.px(10, 5, "k"); c.hline(8, 6, 3, "h");
  c.hline(3, 3, 13, "D"); c.rect(6, 0, 7, 3, "D"); c.hline(6, 2, 7, "x"); // 챙 넓은 모자
  c.line(1, 21, 17, 7, "m", 2); c.line(2, 21, 17, 8, "s");    // 장총
  c.rect(0, 19, 4, 3, "W"); c.px(1, 20, "D");                  // 개머리
  c.px(17, 6, "s");
  c.rect(5, 15, 2, 2, "f"); c.rect(11, 11, 2, 2, "f");        // 손
})

sprite("h_priest", { w: 18, h: 24, outline: "k" }, (c) => {
  c.vline(15, 3, 21, "D");                                     // 지팡이
  c.vline(15, 0, 4, "y"); c.hline(14, 1, 3, "y"); c.px(15, 1, "w");
  c.poly([5, 8, 13, 8, 15, 23, 3, 23], "w");                   // 겉옷
  c.poly([10, 8, 13, 8, 15, 23, 11, 23], "s");
  c.vline(9, 9, 14, "Y"); c.hline(3, 23, 13, "Y");             // 금실
  c.ellipse(9, 5, 4, 4, "s"); c.ellipse(9, 4, 4, 3, "w");      // 두건
  c.ellipse(9, 6, 2, 2, "h"); c.px(8, 6, "k"); c.px(10, 6, "k"); // 그늘진 얼굴
  c.rect(4, 12, 6, 5, "r"); c.hline(4, 12, 6, "w"); c.vline(9, 12, 5, "x"); // 성서
  c.vline(6, 13, 3, "y"); c.hline(5, 14, 3, "y");
  c.rect(13, 10, 2, 2, "f");                                   // 손
  glow("y", { r: 3, strength: 0.45 })
})

/* ═════════ 적 ═════════ */

sprite("f_ghoul", { w: 16, h: 22, outline: "k" }, (c) => {
  c.line(11, 14, 13, 18, "H", 2); c.line(13, 18, 12, 21, "H", 2); c.hline(10, 21, 3, "H"); // 뒷다리
  c.line(9, 14, 7, 18, "G", 2); c.line(7, 18, 8, 21, "G", 2); c.hline(6, 21, 3, "G");      // 앞다리
  c.poly([5, 7, 9, 4, 13, 6, 14, 10, 13, 15, 8, 15, 6, 11], "G");  // 굽은 몸
  c.line(9, 4, 14, 9, "H"); c.line(14, 9, 13, 14, "H");            // 등뼈 그늘
  c.hline(7, 9, 5, "H"); c.hline(7, 11, 5, "H"); c.hline(8, 13, 4, "H"); // 갈비
  c.poly([7, 13, 14, 13, 15, 17, 12, 15, 10, 17, 7, 16], "q");    // 누더기
  c.line(10, 8, 9, 13, "H"); c.line(9, 13, 6, 16, "H");            // 뒷팔
  c.ellipse(4, 6, 3, 3, "G"); c.rect(2, 8, 4, 2, "H");            // 앞으로 뺀 머리 · 벌린 턱
  c.px(3, 5, "y"); c.px(5, 5, "y");                                // 눈
  c.px(2, 8, "U"); c.px(4, 8, "U"); c.px(3, 9, "U");               // 이빨
  c.line(6, 8, 3, 13, "G"); c.line(3, 13, 2, 18, "G");             // 땅까지 늘어진 앞팔
  c.hline(1, 19, 3, "U");                                          // 손톱
  glow("y", { r: 2, strength: 0.4 })
})

sprite("f_golem", { w: 32, h: 28, outline: "k" }, (c) => {
  c.rect(9, 23, 5, 5, "E"); c.rect(18, 23, 5, 5, "E");        // 다리
  c.ellipse(16, 14, 12, 10, "F");                              // 살덩이
  c.ellipse(16, 19, 10, 5, "E");
  c.ellipse(11, 10, 3, 2, "E"); c.ellipse(22, 15, 3, 3, "E");  // 덧댄 살
  for (let i = 0; i < 6; i++) c.px(8 + i * 2, 6 + (i % 2), "X"); // 꿰맨 자국
  for (let i = 0; i < 5; i++) c.px(20 + (i % 2), 9 + i * 2, "X");
  c.ellipse(16, 3, 4, 3, "F"); c.hline(13, 5, 6, "X");        // 머리 · 입
  c.px(14, 3, "y"); c.px(18, 2, "r");                          // 짝짝이 눈
  c.ellipse(3, 16, 3, 7, "F"); c.ellipse(3, 23, 3, 3, "E");    // 왼팔 · 주먹
  c.ellipse(28, 16, 3, 7, "F"); c.ellipse(28, 23, 3, 3, "E");
  c.px(5, 12, "x"); c.px(27, 18, "x"); c.px(13, 20, "x");      // 피
})

sprite("f_keeper", { w: 26, h: 32, outline: "k" }, (c) => {
  c.line(20, 8, 23, 27, "W", 2);                               // 삽 자루
  c.poly([20, 26, 25, 26, 25, 31, 20, 31], "m"); c.vline(25, 26, 6, "s"); // 삽날
  c.poly([8, 10, 18, 10, 21, 31, 5, 31], "J");                 // 긴 외투
  c.poly([13, 10, 18, 10, 21, 31, 14, 31], "q");
  c.vline(13, 11, 20, "q");
  c.ellipse(13, 7, 3, 3, "U"); c.px(12, 7, "y"); c.px(14, 7, "y"); c.hline(12, 9, 3, "V"); // 창백한 얼굴
  c.hline(7, 4, 13, "q"); c.rect(10, 0, 7, 4, "q"); c.hline(10, 3, 7, "x"); // 모자
  c.line(8, 13, 5, 17, "J");                                   // 왼팔
  c.rect(3, 18, 4, 5, "Y"); c.rect(4, 19, 2, 3, "y"); c.px(4, 17, "Y"); // 등불
  c.rect(18, 13, 2, 2, "U");                                   // 오른손
  glow("y", { r: 4, strength: 0.45 })
})

sprite("f_tomb", { w: 12, h: 14, outline: "k" }, (c) => {
  c.rect(1, 4, 10, 9, "a"); c.ellipse(6, 4, 5, 3, "a");       // 비석
  c.vline(10, 3, 10, "A"); c.vline(6, 5, 5, "A"); c.hline(4, 7, 5, "A"); // 그늘 · 새긴 십자
  c.line(2, 10, 4, 12, "Z");                                   // 금
  c.hline(0, 13, 12, "D"); c.px(2, 12, "H"); c.px(9, 12, "G"); // 흙 · 이끼
})

sprite("f_skel", { w: 14, h: 18, outline: "k" }, (c) => {
  c.line(11, 10, 13, 1, "o"); c.px(13, 0, "o"); c.px(10, 11, "D"); // 녹슨 칼
  c.ellipse(6, 3, 3, 3, "U"); c.px(5, 3, "k"); c.px(7, 3, "k"); c.hline(5, 6, 3, "V"); // 해골
  c.vline(6, 7, 6, "U");                                       // 등뼈
  c.hline(4, 8, 5, "U"); c.hline(4, 10, 5, "U"); c.hline(5, 13, 3, "V"); // 갈비 · 골반
  c.line(4, 8, 2, 12, "U"); c.line(8, 8, 10, 10, "U");          // 팔
  c.line(5, 14, 4, 17, "U"); c.line(7, 14, 8, 17, "U");         // 다리
})

/* ═════════ 마왕 (32×34): 머리 자리는 비워 두고, 화면에서 그 친구 얼굴을 얹는다 ═════════ */

function lord(c, kind) {
  c.poly([4, 12, 28, 12, 31, 33, 1, 33], "L");                 // 망토
  c.poly([10, 12, 22, 12, 24, 33, 8, 33], "p");                // 옷
  c.vline(16, 13, 20, "r"); c.hline(8, 32, 17, "r");           // 붉은 단
  c.ellipse(16, 7, 6, 6, "L");                                 // 두건
  c.ellipse(16, 8, 4, 4, "k");                                 // 얼굴 자리 (화면에서 그 친구 얼굴을 얹는다)
  c.poly([6, 7, 11, 11, 21, 11, 26, 7, 24, 13, 8, 13], "x");   // 높은 깃
  c.poly([2, 13, 8, 10, 7, 16], "V"); c.poly([30, 13, 24, 10, 25, 16], "V"); // 어깨 뼈 가시
  c.line(11, 3, 8, 0, "U"); c.line(21, 3, 24, 0, "U");         // 뿔
  if (kind === "guard") {
    c.rect(0, 15, 10, 13, "J"); c.poly([0, 28, 10, 28, 5, 33], "J"); // 검은 큰 방패
    c.rect(1, 16, 8, 11, "q"); c.ellipse(5, 21, 2, 2, "U"); c.px(4, 21, "k"); c.px(6, 21, "k");
  }
  if (kind === "berserk") {
    c.line(28, 6, 25, 33, "D", 2);                             // 피 묻은 도끼
    c.poly([26, 2, 31, 0, 31, 12, 26, 10], "m"); c.vline(31, 0, 12, "s");
    c.px(29, 9, "x"); c.px(30, 11, "x"); c.px(28, 6, "x");
  }
  if (kind === "gunner") {
    c.line(1, 30, 31, 12, "q", 2); c.line(2, 30, 31, 13, "m"); // 검은 장총
    c.rect(0, 28, 4, 4, "D"); c.px(31, 11, "o"); c.px(30, 10, "y");
  }
  if (kind === "priest") {
    c.vline(28, 7, 26, "D");                                   // 지팡이 · 향로
    c.ellipse(28, 5, 2, 2, "Y"); c.px(28, 5, "l");
    for (const [x, y] of [[26, 2], [29, 1], [31, 3], [27, 0]]) c.px(x, y, "l");
    c.px(30, 0, "g"); c.px(25, 1, "g");
  }
  if (kind === "king") {                                       // 이름 없는 왕: 해골 얼굴 · 왕관
    c.ellipse(16, 6, 5, 5, "U"); c.rect(13, 5, 2, 2, "k"); c.rect(18, 5, 2, 2, "k"); c.px(16, 8, "V");
    c.hline(14, 10, 5, "V");
    c.rect(11, 0, 11, 2, "Y"); for (const x of [11, 14, 16, 18, 21]) c.px(x, -1, "y"); c.px(16, 0, "r");
  }
}
for (const kind of ["guard", "berserk", "gunner", "priest", "king"]) {
  sprite(`b_${kind}`, { w: 32, h: 34, outline: "k" }, (c) => lord(c, kind), ...(kind === "priest" ? [glow("l", { r: 3, strength: 0.4 })] : []))
}

/* ═════════ 기술 종류 아이콘 (14×14) ═════════ */

const icon = (name, ...items) => sprite(name, { w: 14, h: 14, outline: "k" }, ...items)
icon("k_blade", `
  ............ws
  ...........wss
  ..........wsm.
  .........wsm..
  ........wsm...
  .......wsm....
  ......wsm.....
  .....wsm......
  ..Y.wsm.......
  ...Ysm........
  ...DYY........
  ..DWD..Y......
  .DWD..........
  .DD...........`)
icon("k_axe", `
  ..s........s..
  .sws..DD..sws.
  .swss.DW.ssws.
  .swsssDWsssws.
  .swss.DW.ssws.
  .sws..DW..sws.
  ..s...DW...s..
  ......DW......
  ......DW......
  ......DW......
  ......DW......
  ......DW......
  ......DD......`)
icon("k_gun", `
  ..............
  ..............
  .mmmmmmmmmmm..
  .msssssssssm..
  .mmmmmmmmmmm..
  .......mmDD...
  .......mDDW...
  ......mDWW....
  ......DWW.....
  .....DWW......
  .....DD.......`)
icon("k_aim", ring(7, 7, 5, "r"), hline(0, 7, 4, "r"), hline(10, 7, 4, "r"), vline(7, 0, 4, "r"), vline(7, 10, 4, "r"), px(7, 7, "y"))
icon("k_boom", poly([7, 0, 9, 4, 13, 2, 11, 6, 14, 8, 10, 9, 11, 13, 7, 10, 3, 13, 4, 9, 0, 8, 3, 6, 1, 2, 5, 4], "o"),
  poly([7, 3, 8, 6, 11, 6, 9, 8, 10, 11, 7, 9, 4, 11, 5, 8, 3, 6, 6, 6], "y"), px(7, 7, "w"))
icon("k_shield", rect(1, 1, 12, 7, "m"), poly([1, 8, 12, 8, 7, 13, 6, 13], "m"), rect(2, 2, 10, 6, "s"), poly([2, 8, 11, 8, 7, 12, 6, 12], "s"),
  vline(6, 2, 10, "Y"), vline(7, 2, 10, "Y"), hline(2, 5, 10, "Y"))
icon("k_thorn", `
  .w....ww....w.
  ..wmmmmmmmmw..
  ..mssssssssm..
  wwmsssmmsssmww
  ..msssmmsssm..
  ..mssmmmmssm..
  ..mssmmmmssm..
  ..msssmmsssm..
  wwmsssmmsssmww
  ...mssssssm...
  ....mssssm....
  .....mssm.....
  ......mm......
  ......ww......`)
icon("k_heal", rect(5, 1, 4, 12, "g"), rect(1, 5, 12, 4, "g"), rect(6, 2, 2, 10, "l"), rect(2, 6, 10, 2, "l"), px(6, 2, "w"))
icon("k_revive", ring(7, 3, 3, "y"), vline(7, 6, 8, "y"), hline(3, 8, 9, "y"), px(7, 3, "o"))
icon("k_break", rect(1, 1, 12, 5, "m"), rect(2, 2, 10, 3, "s"), hline(2, 2, 10, "w"), vline(6, 6, 8, "D"), vline(7, 6, 8, "W"))
icon("k_aoe", ring(7, 7, 6, "s"), rect(0, 0, 7, 7, "_"), ring(7, 7, 3, "w"), rect(7, 7, 7, 7, "_"), px(7, 7, "y"),
  poly([13, 7, 10, 5, 10, 9], "s"), poly([1, 7, 4, 5, 4, 9], "w"))
icon("k_buff", poly([7, 0, 13, 6, 9, 6, 9, 13, 5, 13, 5, 6, 1, 6], "l"), poly([7, 0, 13, 6, 9, 6, 9, 13, 7, 13], "g"))
icon("k_bleed", poly([7, 0, 11, 7, 3, 7], "r"), ellipse(7, 9, 4, 4, "r"), px(5, 8, "o"), px(5, 9, "o"), ellipse(8, 10, 2, 2, "x"))
icon("k_cost", circ(4, 4, 3, "r"), circ(9, 4, 3, "r"), poly([1, 5, 12, 5, 7, 12, 6, 12], "r"), line(7, 2, 5, 6, "k"), line(5, 6, 8, 9, "k"), px(3, 3, "o"))
icon("k_dark", ellipse(7, 7, 6, 4, "p"), ellipse(7, 7, 2, 3, "r"), vline(7, 5, 5, "k"), px(4, 6, "j"))
icon("k_debuff", poly([7, 13, 13, 7, 9, 7, 9, 0, 5, 0, 5, 7, 1, 7], "r"), poly([7, 13, 13, 7, 9, 7, 9, 0, 7, 0], "x"))
icon("k_smite", poly([5, 0, 8, 0, 10, 10, 3, 10], "y"), poly([6, 0, 7, 0, 8, 10, 5, 10], "w"),     // 내리꽂는 빛 (성직자의 공격)
  ellipse(6, 11, 6, 2, "o"), ellipse(6, 11, 4, 1, "y"), px(1, 3, "y"), px(11, 5, "y"), px(0, 8, "o"), px(12, 1, "o"))
icon("k_ammo", `
  ..............
  ..............
  ...s...s...s..
  ..sws.sws.sws.
  ..sss.sss.sss.
  ..YyY.YyY.YyY.
  ..YyY.YyY.YyY.
  ..YyY.YyY.YyY.
  ..YyY.YyY.YyY.
  ..YyY.YyY.YyY.
  ..DDD.DDD.DDD.`)
icon("k_energy",poly([7, 0, 12, 6, 7, 13, 2, 6], "y"), poly([7, 0, 12, 6, 7, 13], "o"), poly([7, 2, 9, 6, 7, 10, 5, 6], "w"))

/* ═════════ 예고 아이콘 (14×14) ═════════ */

icon("i_warn", poly([7, 0, 13, 13, 1, 13], "o"), poly([7, 3, 11, 12, 3, 12], "y"), vline(7, 5, 4, "k"), px(7, 11, "k"))
icon("i_coffin", poly([4, 0, 10, 0, 12, 4, 10, 13, 4, 13, 2, 4], "D"), poly([5, 1, 9, 1, 11, 4, 9, 12, 5, 12, 3, 4], "W"), vline(7, 3, 6, "Y"), hline(5, 5, 5, "Y"))
icon("i_skull", ellipse(7, 6, 6, 5, "U"), rect(4, 9, 7, 4, "U"), rect(3, 5, 3, 3, "k"), rect(8, 5, 3, 3, "k"), px(7, 8, "V"), px(5, 12, "V"), px(7, 12, "V"), px(9, 12, "V"))
icon("i_q", text(3, 1, "?", "y", { scale: 2 }))

/* ═════════ 작은 표시 ═════════ */

sprite("s_en", { outline: "k" }, `
  .yy.
  ywyy
  yyyo
  .yo.`)
sprite("s_dark", { base: "s_en", swap: { y: "j", w: "l", o: "p" } })
sprite("s_block", { outline: "k" }, `
  ssssss
  swmmws
  smmmms
  smmmms
  .smms.
  ..ss..`)
sprite("s_heart", { outline: "k" }, `
  .rr.rr.
  rorrrrr
  rrrrrrr
  .rrrrr.
  ..rrr..
  ...r...`)
sprite("s_ammo", { outline: "k" }, `
  .y.
  yyy
  yoy
  YYY
  YDY
  YYY`)
sprite("s_faith", { outline: "k" }, `
  .y..
  .yo.
  yoyo
  .yy.
  .ww.
  .ws.
  .ws.`)
sprite("s_corrupt", { outline: "k" }, `
  ..p..
  .ppp.
  ppjpp
  prppp
  pprpp
  .ppp.`)
sprite("s_vuln", { outline: "k" }, `
  sss.sss
  sss.sss
  ss.osss
  .s.sss.
  .ssos..
  ..sss..`)
sprite("s_weak", { outline: "k" }, `
  ....ws
  ...wss
  ..m...
  .Y....
  DWY...
  DD....`)
sprite("s_stun", { outline: "k" }, `
  ..y..
  .yyy.
  yywyy
  .yyy.
  .y.y.`)
sprite("s_bleed", { outline: "k" }, `
  ..r..
  .rrr.
  rrorr
  rrrrr
  .rrr.`)
sprite("s_ward", { w: 7, h: 7, outline: "k" }, ring(3, 3, 3, "y"), ring(3, 3, 2, "o"))

/* ═════════ 바닥 · 벽 ═════════ */

sprite("floor", { w: 32, h: 32 }, (c) => {
  c.rect(0, 0, 32, 32, "A");
  for (let r = 0; r < 4; r++) {                                // 판석: 8칸 높이 줄, 줄눈은 한 줄 걸러 어긋나게
    c.hline(0, r * 8 + 7, 32, "Z");
    for (let x = (r % 2) * 8; x < 32; x += 16) c.vline(x, r * 8, 7, "Z");
    for (let x = (r % 2) * 8 + 2; x < 32; x += 16) c.hline(x, r * 8, 4, "a"); // 돌 윗모서리
  }
  c.line(21, 1, 24, 5, "Z"); c.px(24, 6, "Z");                 // 깨진 판석 하나
})
sprite("wall", { w: 64, h: 26 }, (c) => {
  c.rect(0, 0, 64, 26, "A");
  for (let r = 0; r < 4; r++) {
    c.hline(0, r * 6 + 5, 64, "Z");
    for (let x = (r % 2) * 6; x < 64; x += 12) c.vline(x, r * 6, 5, "Z");
    for (let x = (r % 2) * 6 + 2; x < 64; x += 12) c.hline(x, r * 6, 4, "a");
  }
  c.rect(26, 6, 12, 13, "Z"); c.rect(27, 7, 10, 12, "q");      // 벽감
  c.ellipse(31, 15, 2, 2, "U"); c.px(30, 15, "k"); c.px(32, 15, "k"); // 해골
  c.rect(35, 13, 1, 5, "w"); c.px(35, 12, "y"); c.px(35, 11, "o"); // 초
  c.vline(12, 6, 9, "Z"); c.vline(50, 12, 7, "Z");             // 물자국
  glow("y", { r: 4, strength: 0.5 })
})

/* ═════════ 확인용: 한눈에 (img 폴더로는 안 옮긴다) ═════════ */

const SHOW = [
  ["h_guard", 4, 4], ["h_berserk", 28, 4], ["h_gunner", 52, 4], ["h_priest", 76, 4],
  ["f_ghoul", 104, 8], ["f_skel", 128, 10], ["f_tomb", 148, 14], ["f_golem", 166, 2], ["f_keeper", 204, 0],
  ["b_guard", 4, 36], ["b_berserk", 42, 36], ["b_gunner", 80, 36], ["b_priest", 118, 36], ["b_king", 156, 36],
]
const ICONS = ["k_blade", "k_axe", "k_gun", "k_aim", "k_boom", "k_shield", "k_thorn", "k_heal", "k_revive", "k_break", "k_aoe", "k_buff", "k_bleed",
  "k_cost", "k_dark", "k_debuff", "k_energy", "k_smite", "k_ammo", "i_warn", "i_coffin", "i_skull", "i_q"]
const SMALL = ["s_en", "s_dark", "s_block", "s_heart", "s_ammo", "s_faith", "s_corrupt", "s_vuln", "s_weak", "s_stun", "s_bleed", "s_ward"]
scene("contact", { w: 240, h: 128, bg: "d" },
  layer("bg", stamp("floor", 196, 40), stamp("wall", 176, 96)),
  layer("units", ...SHOW.map(([n, x, y]) => stamp(n, x, y))),
  layer("icons", ...ICONS.map((n, i) => stamp(n, 2 + (i % 12) * 16, 74 + Math.floor(i / 12) * 17))),
  layer("small", ...SMALL.map((n, i) => stamp(n, 2 + i * 12, 110))))
