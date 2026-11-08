// 세어라의 그림: 동그랗고 큰 눈에 볼터치가 있는 색칠 동물 12종과 풀밭 배경 (직접 그린 SVG).
// 전부 오른쪽을 보고 서 있고(viewBox 120×100, 땅은 y=92쯤), 왼쪽으로 갈 땐 화면에서 뒤집는다.
// 선 색·굵기는 <svg>에서 물려받고, 선이 없어야 하는 곳만 stroke="none". 걷기·깡총·뒤뚱은 style.css의 cn-* 애니메이션.

const LINE = '#5b4537';
const EYE = '#2f2730';
const BLUSH = '#ff8fa3';

const path = (d, fill = 'none', extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`;
const flat = (d, fill) => path(d, fill, 'stroke="none"');
const oval = (cx, cy, rx, ry, fill, extra = '') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra}/>`;
const spot = (cx, cy, rx, ry, fill) => oval(cx, cy, rx, ry, fill, 'stroke="none"');
const thin = (d, color = LINE, w = 1.8) => path(d, 'none', `stroke="${color}" stroke-width="${w}"`);
// 꼬리·코처럼 굵은 관: 외곽선 색 굵은 선 위에 몸 색 선을 겹친다
const tube = (d, fill, w) => thin(d, LINE, w + 4.6) + thin(d, fill, w);

// 다리 하나: 엉덩이(x,y)에서 내려오는 짧고 둥근 막대. a/b 박자로 번갈아 흔들린다
const leg = (x, y, len, w, fill, ph) =>
  `<g class="lg ${ph}" style="transform-origin:${x}px ${y}px"><rect x="${x - w / 2}" y="${y}" width="${w}" height="${len}" rx="${Math.min(w / 2, 5)}" fill="${fill}"/></g>`;
// 네 발 [뒤-먼, 뒤-가까운, 앞-먼, 앞-가까운]: 먼 쪽 다리는 조금 어두운 색
const legs = (xs, y, len, w, near, far) =>
  leg(xs[0], y, len, w, far, 'b') + leg(xs[2], y, len, w, far, 'a') + leg(xs[1], y, len, w, near, 'a') + leg(xs[3], y, len, w, near, 'b');

const eye = (x, y, s = 1) => spot(x, y, 3.6 * s, 4.5 * s, EYE) + `<circle cx="${x + 1.2 * s}" cy="${y - 1.8 * s}" r="${1.5 * s}" fill="#fff" stroke="none"/>`;
const eyes = (x1, x2, y, s = 1) => eye(x1, y, s) + eye(x2, y, s);
const blush = (x, y, r = 4.6) => oval(x, y, r, r * 0.62, BLUSH, 'stroke="none" opacity=".6"');
const blushes = (x1, x2, y, r) => blush(x1, y, r) + blush(x2, y, r);
// ω 입
const smile = (x, y, w = 6.5) => thin(`M${x - w / 2} ${y}q${w / 4} ${w * 0.5} ${w / 2} 0q${w / 4} ${w * 0.5} ${w / 2} 0`);
const shadow = (cx = 56, rx = 36) => spot(cx, 94, rx, 4.4, '#2e5a1f').replace('/>', ' opacity=".18"/>');

// 사자 갈기: 뭉게뭉게 둥근 테두리
function scallop(cx, cy, r, n, fill) {
  const at = i => {
    const a = (i / n) * Math.PI * 2;
    return `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  };
  const bump = (2 * r * Math.sin(Math.PI / n) * 0.62).toFixed(1);
  let d = `M${at(0)}`;
  for (let i = 1; i <= n; i++) d += `A${bump} ${bump} 0 0 1 ${at(i)}`;
  return path(`${d}Z`, fill);
}

const ART = {
  giraffe() {
    const Y = '#f9cf57', F = '#e6b644', B = '#c17f36', H = '#fbeec8';
    return shadow(50, 34) +
      tube('M24 56Q15 60 15 70', Y, 2.6) + oval(15, 74, 3.8, 5.4, B) +
      legs([29, 39, 55, 65], 62, 30, 8, Y, F) +
      oval(46, 58, 25, 15, Y) +
      path('M58 50Q66 38 72 22L90 28Q86 48 72 68Z', Y) + spot(64, 58, 10, 10, Y) +
      spot(36, 54, 5, 4, B) + spot(48, 49, 4.4, 3.4, B) + spot(47, 63, 5, 3.6, B) + spot(60, 60, 4.2, 3.6, B) + spot(70, 49, 3.6, 3.2, B) + spot(77, 36, 3.2, 3, B) +
      thin('M80 14L79 6') + thin('M95 14L97 6') + oval(79, 5, 2.8, 2.8, B) + oval(97.5, 5, 2.8, 2.8, B) +
      `<ellipse cx="69" cy="17" rx="7.5" ry="3.8" fill="${Y}" transform="rotate(18 69 17)"/><ellipse cx="106" cy="17" rx="7.5" ry="3.8" fill="${Y}" transform="rotate(-18 106 17)"/>` +
      oval(87.5, 23, 18, 14.5, Y) +
      spot(87.5, 30.5, 11, 6.6, H) + spot(84, 29, 1, 1.3, LINE) + spot(91, 29, 1, 1.3, LINE) +
      eyes(79, 96, 20, 0.86) + blushes(73, 102, 28, 3.4) + smile(87.5, 32.5, 5.5);
  },
  elephant() {
    const E = '#9dbcdb', F = '#83a5c8', P = '#ffc4d0';
    return shadow(56, 40) +
      tube('M24 62Q13 66 13 76', E, 2.8) +
      legs([31, 43, 58, 70], 72, 20, 12, E, F) +
      oval(50, 62, 29, 22, E) +
      path('M100 24Q119 19 119 42Q117 59 101 54Z', E) + flat('M104 29Q115 26 115 42Q114 53 103 50Z', P) +
      oval(86, 42, 24, 22, E) +
      path('M72 26Q49 14 45 37Q45 61 71 57Z', E) + flat('M68 32Q53 23 51 38Q51 54 67 51Z', P) +
      tube('M90 52Q106 54 110 68Q112 79 104 83', E, 9) + spot(89, 50, 7.5, 6.5, E) +
      thin('M108 66l-6 2', F, 1.8) + thin('M111 73l-7 0', F, 1.8) +
      eyes(77, 99, 40) + blushes(71, 104, 49, 4);
  },
  deer() {
    const B = '#c88c58', F = '#a9713f', W = '#fff2e0', A = '#8c5f38', P = '#ffc4d0';
    return shadow(50, 34) +
      oval(23, 53, 6.5, 5.5, W) +
      legs([32, 42, 58, 68], 67, 25, 7, B, F) +
      oval(47, 60, 25, 16, B) +
      path('M58 58Q68 46 72 38L96 44Q90 58 76 68Z', B) + spot(64, 61, 10, 10, B) +
      spot(35, 54, 3, 2.4, W) + spot(45, 50, 3.2, 2.5, W) + spot(55, 54, 3, 2.4, W) + spot(40, 62, 2.6, 2, W) + spot(50, 62, 2.6, 2, W) +
      thin('M76 26Q73 13 64 9', A, 4) + thin('M72.5 16Q75 10 79 6', A, 4) + thin('M98 26Q101 13 110 9', A, 4) + thin('M101.5 16Q99 10 95 6', A, 4) +
      path('M70 31Q58 24 55 32Q59 41 72 38Z', B) + flat('M67 32Q60 29 59 33Q62 37 68 36Z', P) +
      path('M104 31Q116 24 119 32Q115 41 102 38Z', B) + flat('M107 32Q114 29 115 33Q112 37 106 36Z', P) +
      oval(87, 39, 20.5, 17.5, B) +
      spot(87, 47.5, 10.5, 7.2, W) + spot(87, 44, 3.2, 2.3, '#3a2c2c') +
      eyes(78, 96, 35, 0.92) + blushes(72, 102, 44, 3.6) + smile(87, 48.5, 5.5);
  },
  rabbit() {
    const W = '#fff6ec', P = '#ffc1cf', F = '#f1dfcd';
    return shadow(56, 32) + '<g class="hop">' +
      oval(25, 66, 8.5, 8.5, '#ffffff') +
      oval(36, 85, 13.5, 7, F) + oval(66, 87, 9.5, 5.6, F) +
      oval(47, 67, 25, 19, W) + oval(48, 86, 13.5, 6.6, W) + oval(74, 87, 9.5, 5.6, W) +
      path('M66 36C58 12 63 3 70 3C78 4 80 22 78 36Z', W) + flat('M70 32C65 16 67.5 9 70.5 9C74 10 75 22 74 32Z', P) +
      path('M90 36C90 22 93 4 100 3C108 3 111 14 102 36Z', W) + flat('M94.5 32C95 22 97 10 100 9C104 9 105 18 98 32Z', P) +
      oval(84, 51, 24.5, 20.5, W) +
      eyes(75, 94, 49) + blushes(68, 100, 58, 4.2) +
      flat('M81.8 54.5h5.4l-2.7 3.2Z', '#ff8fa3') + smile(84.5, 58.4, 6.5) + '</g>';
  },
  penguin() {
    const N = '#41518a', W = '#fdfdf6', O = '#ffa43f';
    return shadow(60, 32) + '<g class="wad" style="transform-origin:60px 92px">' +
      leg(49, 82, 10, 10, O, 'a') + leg(71, 82, 10, 10, O, 'b') +
      path('M32 46Q19 56 21 72Q30 69 37 58Z', N) + path('M88 46Q101 56 99 72Q90 69 83 58Z', N) +
      path('M60 10C89 10 93 44 91 66C89 87 74 89 60 89C46 89 31 87 29 66C27 44 31 10 60 10Z', N) +
      flat('M60 36C81 36 83 58 81 71C79 83 70 85 60 85C50 85 41 83 39 71C37 58 39 36 60 36Z', W) +
      flat('M60 22C51 14 36 20 38 37C40 46 52 47 60 42C68 47 80 46 82 37C84 20 69 14 60 22Z', W) +
      eyes(49, 71, 31) + blushes(43, 77, 40, 4) +
      path('M53.5 37.5Q60 33.5 66.5 37.5Q60 46 53.5 37.5Z', O) + '</g>';
  },
  turtle() {
    const G = '#4faa63', L = '#86d294', S = '#cdeaa6', F = '#aed486';
    return shadow(56, 42) +
      path('M21 76L8 83L23 85Z', S) +
      legs([30, 41, 66, 77], 76, 15, 12, S, F) +
      path('M14 78Q15 30 54 30Q88 30 94 78Q54 90 14 78Z', G) +
      flat('M40 42L54 36L68 42L70 57L54 64L38 57Z', L) + flat('M23 62L32 47L36 58L34 70L22 73Z', L) + flat('M85 62L76 47L72 58L74 70L86 73Z', L) +
      path('M12 75Q54 88 96 75L96 80Q54 94 12 80Z', S) +
      oval(95, 56, 19, 18, S) +
      eyes(87, 104, 53, 0.95) + blushes(81, 110, 62, 3.4) + smile(95.5, 62.5, 6);
  },
  lion() {
    const Y = '#f8c95a', F = '#e0a93e', M = '#d9802e', H = '#fff2d6';
    return shadow(54, 38) +
      tube('M28 62Q13 66 11 79', Y, 3) + oval(10, 83, 6, 7, M) +
      legs([33, 43, 59, 69], 72, 20, 10, Y, F) +
      oval(50, 64, 27, 18, Y) +
      scallop(86, 43, 26, 14, M) +
      oval(70, 26, 6.6, 6.6, Y) + oval(102, 26, 6.6, 6.6, Y) +
      oval(86, 45, 20, 18, Y) +
      spot(86, 53, 8.6, 5.8, H) + flat('M83 49h6l-3 3.4Z', '#7a4a2a') +
      eyes(78, 94, 43) + blushes(71.5, 100.5, 51, 4) + smile(86, 53.6, 7);
  },
  monkey() {
    const B = '#a8744e', F = '#8a5b3a', C = '#f5dcb9';
    return shadow(54, 34) +
      tube('M28 60Q8 58 8 38Q9 25 20 27Q27 30 23 37', B, 5.4) +
      legs([33, 43, 59, 69], 70, 22, 8.5, B, F) +
      oval(50, 62, 25, 18, B) +
      oval(63, 42, 8, 8.6, B) + spot(63, 42, 4.6, 5.2, C) + oval(111, 42, 8, 8.6, B) + spot(111, 42, 4.6, 5.2, C) +
      oval(87, 40, 24.5, 21.5, B) +
      flat('M87 35Q82 26 73 30Q65 36 69 47Q73 58 87 58Q101 58 105 47Q109 36 101 30Q92 26 87 35Z', C) +
      eyes(78, 96, 40) + spot(85, 48, 1, 1.3, F) + spot(89, 48, 1, 1.3, F) + thin('M79 51Q87 57 95 51') + blushes(72, 102, 49, 4);
  },
  duck() {
    const Y = '#ffdf5c', F = '#f3c33a', O = '#ff9f43';
    return shadow(58, 32) + '<g class="wad" style="transform-origin:60px 92px">' +
      leg(50, 80, 12, 6, O, 'a') + leg(68, 80, 12, 6, O, 'b') +
      path('M28 62Q14 48 12 42Q26 45 38 50Z', Y) +
      oval(56, 64, 32, 23, Y) +
      path('M36 60Q52 50 66 60Q60 77 44 77Q34 70 36 60Z', F) +
      thin('M79 17Q81 8 88 11') +
      oval(80, 37, 23, 21.5, Y) +
      eye(74, 35) + eye(91, 34, 0.92) + blush(68, 44, 4) +
      path('M92 40Q112 37 117 44Q112 52 94 51Q88 45 92 40Z', O) + thin('M94 46Q106 47 115 44', '#d97f2c', 1.6) + '</g>';
  },
  pig() {
    const P = '#ffb4c4', F = '#f291a8', S = '#ff9fb3';
    return shadow(56, 36) +
      thin('M23 56Q11 58 12 50Q14 44 20 47Q24 51 18 53', F, 3.4) +
      legs([33, 43, 59, 69], 74, 18, 10, P, F) +
      oval(50, 62, 29, 21, P) +
      path('M66 28Q58 11 75 16L82 27Z', F) + path('M93 27L100 16Q116 11 108 28Z', F) +
      oval(87, 44, 25.5, 22.5, P) +
      oval(87, 52, 10.5, 7.5, S) + spot(83.5, 52, 1.7, 2.5, '#b9566f') + spot(90.5, 52, 1.7, 2.5, '#b9566f') +
      eyes(76, 98, 40) + blushes(69, 105, 51, 4.4) + smile(87, 62, 6);
  },
  cat() {
    const C = '#c8cdd8', F = '#98a1b3', P = '#ffb9c6';
    return shadow(54, 34) +
      tube('M30 62Q12 58 14 38Q16 28 24 31', C, 6.2) +
      legs([33, 43, 59, 69], 70, 22, 9, C, F) +
      oval(50, 62, 27, 18, C) +
      thin('M43 46q-2 5 0 9', F, 3.2) + thin('M51 45q-2 6 0 10', F, 3.2) + thin('M59 46q-2 5 0 9', F, 3.2) +
      path('M66 31L67 11L83 24Z', C) + flat('M70 27L70.5 17L78 24Z', P) +
      path('M92 24L107 11L108 31Z', C) + flat('M96.5 24L104 17L104.5 27Z', P) +
      oval(87, 42, 25, 21, C) +
      thin('M80 23q1 4 0 7', F, 3) + thin('M87 21.5v7.5', F, 3) + thin('M94 23q-1 4 0 7', F, 3) +
      eyes(78, 97, 41) + flat('M85.8 47.5h4.4l-2.2 2.6Z', '#ff8fa3') + smile(88, 50.6, 7) + blushes(71, 104, 50, 4.2) +
      thin('M58 44l9 1.5M58 51l9-1M109 45.5l9-1.5M109 50l9 1', LINE, 1.5);
  },
  fox() {
    const O = '#f79a4b', F = '#d97a2e', W = '#fff4e4', K = '#3a2c2c';
    return shadow(50, 40) +
      legs([35, 45, 60, 70], 70, 22, 8, O, F) +
      path('M34 56C18 42 4 48 4 62C4 75 20 80 36 70Z', O) + path('M4 62C4 71 10 78 18 77C14 69 14 59 20 49C10 49 4 54 4 62Z', W) +
      oval(52, 62, 26, 17, O) +
      path('M68 30L66 7L85 22Z', O) + flat('M71 26L70 14L80 22Z', K) +
      path('M92 22L111 7L109 30Z', O) + flat('M97 22L107 14L106 26Z', K) +
      path('M62 40Q62 23 87 21Q112 23 112 40Q110 53 96 59L87 64L78 59Q64 53 62 40Z', O) +
      flat('M64 45Q72 50 80 50Q84 54 87 63L78 59Q66 53 64 45Z', W) + flat('M110 45Q102 50 94 50Q90 54 87 63L96 59Q108 53 110 45Z', W) +
      spot(87, 60, 3.6, 2.8, K) +
      eyes(77, 97, 39, 0.92) + blushes(69, 105, 47, 3.6);
  },
};

// id·이름. 앞의 6마리가 '세는 동물' 후보(모양이 확 튀는 동물), 나머지는 섞여 지나가기만 한다
export const ANIMALS = [
  { id: 'giraffe', name: '기린' }, { id: 'elephant', name: '코끼리' }, { id: 'deer', name: '사슴' },
  { id: 'rabbit', name: '토끼' }, { id: 'penguin', name: '펭귄' }, { id: 'turtle', name: '거북이' },
  { id: 'lion', name: '사자' }, { id: 'monkey', name: '원숭이' }, { id: 'duck', name: '오리' },
  { id: 'pig', name: '돼지' }, { id: 'cat', name: '고양이' }, { id: 'fox', name: '여우' },
];

const SVG_OPEN = `<svg class="cn-art" viewBox="0 0 120 100" stroke="${LINE}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`;
const CACHE = {};
export const artSvg = id => (CACHE[id] ||= `${SVG_OPEN}${ART[id]()}</svg>`);

// 꽃과 풀포기: 늘 같은 자리
function flowers(w, y0, y1, n) {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const COLORS = ['#ffffff', '#ffd6e0', '#fff0a8', '#e3d4ff'];
  let deco = '';
  for (let i = 0; i < n; i++) {
    const x = Math.round(rnd() * w);
    const y = Math.round(y0 + rnd() * (y1 - y0));
    if (i % 2) deco += `<path d="M${x - 6} ${y}q2-8 3-1q2-10 4 0q2-7 4 1" fill="none" stroke="#9fd67a" stroke-width="2.4" stroke-linecap="round"/>`;
    else {
      const c = COLORS[i % 8 >> 1];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        deco += `<circle cx="${(x + 4 * Math.cos(a)).toFixed(1)}" cy="${(y + 4 * Math.sin(a)).toFixed(1)}" r="3" fill="${c}"/>`;
      }
      deco += `<circle cx="${x}" cy="${y}" r="2.2" fill="#ffc94d"/>`;
    }
  }
  return deco;
}

// 1라운드 배경: 하늘·해·구름·언덕
function meadow() {
  const deco = flowers(800, 130, 490, 46);
  const cloud = (x, y, s) => `<g fill="#fff" transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="8" rx="40" ry="14"/><ellipse cx="-16" cy="0" rx="17" ry="15"/><ellipse cx="12" cy="-3" rx="21" ry="19"/></g>`;
  return '<svg class="cn-bg" viewBox="0 0 800 500" preserveAspectRatio="xMidYMin slice" aria-hidden="true">' +
    '<rect width="800" height="500" fill="#cdeeff"/><circle cx="78" cy="44" r="30" fill="#ffeaa3"/><circle cx="78" cy="44" r="42" fill="#ffeaa3" opacity=".35"/>' +
    cloud(270, 42, 1) + cloud(590, 34, 0.8) + cloud(720, 66, 0.55) +
    '<path d="M0 104Q120 62 260 96T540 94T800 90V500H0Z" fill="#d9f2ba"/><path d="M0 128Q200 104 400 124T800 118V500H0Z" fill="#c8eca6"/>' +
    deco + '</svg>';
}
export const MEADOW = meadow();
// 2라운드 배경: 화면 끝까지 풀밭만
export const GRASS = `<svg class="cn-bg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="1600" height="900" fill="#cdeeaa"/>${flowers(1600, 10, 890, 110)}</svg>`;
