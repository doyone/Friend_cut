// 독박빼기 잡동사니: 물리 모양(parts, 단위 m) + 그림(art, 같은 좌표, 위가 +y). 몸통 기준점은 0,0.
// parts: { box: [반폭, 반높이], at: [x, y] } | { circle: 반지름, at } | { poly: [[x, y], ...] }
// art: [태그, 속성] 목록. 선 색·굵기는 CSS(.po-obj)가 기본으로 칠한다.
export const KINDS = {
  fridge: {
    name: '냉장고', density: 2.6, friction: 0.5,
    parts: [{ box: [0.45, 0.85] }],
    art: [
      ['rect', { x: -0.45, y: -0.85, width: 0.9, height: 1.7, rx: 0.07, fill: '#eef2f3' }],
      ['line', { x1: -0.45, y1: 0.3, x2: 0.45, y2: 0.3 }],
      ['rect', { x: 0.27, y: 0.42, width: 0.07, height: 0.28, rx: 0.03, fill: '#95a5a6' }],
      ['rect', { x: 0.27, y: -0.2, width: 0.07, height: 0.36, rx: 0.03, fill: '#95a5a6' }],
    ],
  },
  sofa: {
    name: '소파', density: 0.9, friction: 0.9,
    parts: [{ box: [1.2, 0.22] }, { box: [0.15, 0.26], at: [-1.05, 0.48] }, { box: [0.15, 0.26], at: [1.05, 0.48] }],
    art: [
      ['rect', { x: -1.2, y: -0.22, width: 2.4, height: 0.44, rx: 0.08, fill: '#c0392b' }],
      ['rect', { x: -1.2, y: 0.22, width: 0.3, height: 0.52, rx: 0.08, fill: '#a93226' }],
      ['rect', { x: 0.9, y: 0.22, width: 0.3, height: 0.52, rx: 0.08, fill: '#a93226' }],
      ['line', { x1: 0, y1: -0.05, x2: 0, y2: 0.22 }],
      ['line', { x1: -0.9, y1: 0.05, x2: 0.9, y2: 0.05 }],
    ],
  },
  chair: {
    name: '의자', density: 1.3, friction: 0.7,
    parts: [
      { box: [0.45, 0.07] }, { box: [0.07, 0.5], at: [-0.38, 0.55] },
      { box: [0.06, 0.25], at: [0.38, -0.32] }, { box: [0.06, 0.25], at: [-0.38, -0.32] },
    ],
    art: [
      ['rect', { x: -0.45, y: -0.07, width: 0.9, height: 0.14, rx: 0.03, fill: '#c8872f' }],
      ['rect', { x: -0.45, y: 0.05, width: 0.14, height: 1.0, rx: 0.04, fill: '#a86a1f' }],
      ['rect', { x: 0.32, y: -0.57, width: 0.12, height: 0.5, fill: '#a86a1f' }],
      ['rect', { x: -0.44, y: -0.57, width: 0.12, height: 0.5, fill: '#a86a1f' }],
      ['line', { x1: -0.42, y1: 0.75, x2: -0.34, y2: 0.75 }],
    ],
  },
  bowling: {
    name: '볼링공', density: 8, friction: 0.3, rolling: 3,
    parts: [{ circle: 0.27 }],
    art: [
      ['circle', { r: 0.27, fill: '#273c75' }],
      ['circle', { cx: -0.07, cy: 0.1, r: 0.045, fill: '#111' }],
      ['circle', { cx: 0.07, cy: 0.1, r: 0.045, fill: '#111' }],
      ['circle', { cx: 0, cy: -0.02, r: 0.05, fill: '#111' }],
      ['circle', { cx: 0.12, cy: -0.13, r: 0.05, fill: '#fff', opacity: 0.35, stroke: 'none' }],
    ],
  },
  box: {
    name: '상자', density: 0.4, friction: 0.8,
    parts: [{ box: [0.4, 0.3] }],
    art: [
      ['rect', { x: -0.4, y: -0.3, width: 0.8, height: 0.6, rx: 0.03, fill: '#d4a373' }],
      ['rect', { x: -0.07, y: -0.3, width: 0.14, height: 0.6, fill: '#e9c46a', stroke: 'none' }],
      ['line', { x1: -0.4, y1: 0.18, x2: 0.4, y2: 0.18 }],
    ],
  },
  tv: {
    name: 'TV', density: 1.1, friction: 0.6,
    parts: [{ box: [0.6, 0.36], at: [0, 0.08] }, { box: [0.22, 0.06], at: [0, -0.34] }],
    art: [
      ['rect', { x: -0.6, y: -0.28, width: 1.2, height: 0.72, rx: 0.05, fill: '#2d3436' }],
      ['rect', { x: -0.52, y: -0.2, width: 1.04, height: 0.56, fill: '#3b5b8a', stroke: 'none' }],
      ['line', { x1: -0.4, y1: 0.25, x2: -0.15, y2: 0.0, stroke: '#9ec5fe', 'stroke-width': 0.04 }],
      ['rect', { x: -0.22, y: -0.4, width: 0.44, height: 0.12, rx: 0.03, fill: '#636e72' }],
    ],
  },
  tire: {
    name: '타이어', density: 1.1, friction: 1.0, rolling: 2,
    parts: [{ circle: 0.42 }],
    art: [
      ['circle', { r: 0.42, fill: '#2d3436' }],
      ['circle', { r: 0.36, fill: 'none', stroke: '#636e72', 'stroke-width': 0.05, 'stroke-dasharray': '0.08 0.07' }],
      ['circle', { r: 0.22, fill: '#b2bec3' }],
      ['circle', { r: 0.07, fill: '#636e72' }],
    ],
  },
  shelf: {
    name: '책장', density: 1.0, friction: 0.7,
    parts: [{ box: [0.35, 0.75] }],
    art: [
      ['rect', { x: -0.35, y: -0.75, width: 0.7, height: 1.5, rx: 0.03, fill: '#a0522d' }],
      ['line', { x1: -0.35, y1: -0.25, x2: 0.35, y2: -0.25 }],
      ['line', { x1: -0.35, y1: 0.25, x2: 0.35, y2: 0.25 }],
      ['rect', { x: -0.27, y: 0.27, width: 0.1, height: 0.38, fill: '#e74c3c', stroke: 'none' }],
      ['rect', { x: -0.15, y: 0.27, width: 0.08, height: 0.33, fill: '#f1c40f', stroke: 'none' }],
      ['rect', { x: 0.0, y: -0.23, width: 0.1, height: 0.4, fill: '#3498db', stroke: 'none' }],
      ['rect', { x: 0.12, y: -0.23, width: 0.09, height: 0.36, fill: '#2ecc71', stroke: 'none' }],
      ['rect', { x: -0.26, y: -0.73, width: 0.12, height: 0.42, fill: '#9b59b6', stroke: 'none' }],
    ],
  },
  micro: {
    name: '전자레인지', density: 2.0, friction: 0.6,
    parts: [{ box: [0.38, 0.24] }],
    art: [
      ['rect', { x: -0.38, y: -0.24, width: 0.76, height: 0.48, rx: 0.04, fill: '#dfe6e9' }],
      ['rect', { x: -0.32, y: -0.17, width: 0.44, height: 0.34, rx: 0.03, fill: '#2d3436' }],
      ['circle', { cx: 0.25, cy: 0.08, r: 0.04, fill: '#636e72' }],
      ['circle', { cx: 0.25, cy: -0.08, r: 0.04, fill: '#636e72' }],
    ],
  },
  drum: {
    name: '드럼통', density: 1.6, friction: 0.6,
    parts: [{ box: [0.35, 0.5] }],
    art: [
      ['rect', { x: -0.35, y: -0.5, width: 0.7, height: 1.0, rx: 0.06, fill: '#2980b9' }],
      ['line', { x1: -0.35, y1: -0.18, x2: 0.35, y2: -0.18, stroke: '#1f6391' }],
      ['line', { x1: -0.35, y1: 0.18, x2: 0.35, y2: 0.18, stroke: '#1f6391' }],
      ['rect', { x: 0.1, y: 0.42, width: 0.14, height: 0.06, fill: '#1f6391', stroke: 'none' }],
    ],
  },
  // 다리(층 위에 가로로 걸치는 긴 것): 아래층(3개 나란히, 약 2.4m)을 다 덮게 2.5m
  mattress: {
    name: '매트리스', density: 0.6, friction: 1.0,
    parts: [{ box: [1.25, 0.13] }],
    art: [
      ['rect', { x: -1.25, y: -0.13, width: 2.5, height: 0.26, rx: 0.1, fill: '#f5f6fa' }],
      ['line', { x1: -1.15, y1: 0, x2: 1.15, y2: 0, stroke: '#74b9ff', 'stroke-dasharray': '0.12 0.08' }],
    ],
  },
  ladder: {
    name: '사다리', density: 1.0, friction: 0.7,
    parts: [{ box: [1.25, 0.08] }],
    art: [
      ['rect', { x: -1.25, y: 0.03, width: 2.5, height: 0.05, fill: '#bdc3c7' }],
      ['rect', { x: -1.25, y: -0.08, width: 2.5, height: 0.05, fill: '#bdc3c7' }],
      ...[-1.05, -0.65, -0.25, 0.15, 0.55, 0.95].map(x => ['rect', { x, y: -0.05, width: 0.06, height: 0.1, fill: '#95a5a6', stroke: 'none' }]),
    ],
  },
  door: {
    name: '문짝', density: 1.2, friction: 0.7,
    parts: [{ box: [1.25, 0.09] }],
    art: [
      ['rect', { x: -1.25, y: -0.09, width: 2.5, height: 0.18, rx: 0.03, fill: '#c9874b' }],
      ['line', { x1: -0.4, y1: -0.09, x2: -0.4, y2: 0.09 }],
      ['line', { x1: 0.4, y1: -0.09, x2: 0.4, y2: 0.09 }],
      ['circle', { cx: 1.05, cy: 0, r: 0.045, fill: '#f1c40f' }],
    ],
  },
  pot: {
    name: '화분', density: 1.6, friction: 0.7,
    parts: [{ poly: [[-0.28, -0.32], [0.28, -0.32], [0.36, 0.22], [-0.36, 0.22]] }],
    art: [
      ['ellipse', { cx: -0.12, cy: 0.42, rx: 0.12, ry: 0.22, fill: '#27ae60', transform: 'rotate(20 -0.12 0.42)' }],
      ['ellipse', { cx: 0.13, cy: 0.45, rx: 0.12, ry: 0.24, fill: '#2ecc71', transform: 'rotate(-20 0.13 0.45)' }],
      ['polygon', { points: '-0.28,-0.32 0.28,-0.32 0.36,0.22 -0.36,0.22', fill: '#e17055' }],
      ['rect', { x: -0.38, y: 0.14, width: 0.76, height: 0.1, rx: 0.02, fill: '#d35400' }],
    ],
  },
};
