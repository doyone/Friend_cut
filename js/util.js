export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// 채팅창·힌트 칸처럼 글자를 치는 중이면 게임 단축키는 무시해야 한다.
export const isTyping = e => !!e.target?.closest?.('input, textarea, select, [contenteditable="true"]');

// 받침에 맞는 조사: josa('지우', '이', '가') → '지우가', josa('하윤', '이', '가') → '하윤이'
export function josa(word, withBatchim, without) {
  const w = String(word);
  const code = w.charCodeAt(w.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${w}${withBatchim}(${without})`;
  return w + (code % 28 ? withBatchim : without);
}

// 키보드 숫자키 → 1~9 (아니면 0)
export function digitOf(e) {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
  return m ? Number(m[1]) : 0;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 첫 글자는 항상 영문이라 Firebase가 숫자 키로 오해해 배열로 바꾸는 일이 없다.
const LETTERS = 'abcdefghijkmnpqrstuvwxyz';
const ALNUM = LETTERS + '23456789';
export function randId(n = 10) {
  let s = pick(LETTERS);
  while (s.length < n) s += pick(ALNUM);
  return s;
}

function makeStore(getStorage) {
  return {
    get(key, fallback = null) {
      try {
        const v = getStorage().getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try { getStorage().setItem(key, JSON.stringify(value)); } catch { /* 저장 불가 환경은 무시 */ }
    },
  };
}
export const store = makeStore(() => localStorage);
export const session = makeStore(() => sessionStorage);

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}
