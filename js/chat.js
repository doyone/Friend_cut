// 채팅: 로비든 게임 중이든 Enter로 열고, Enter로 보내고, Esc로 닫는다.
// 화면이 다시 그려져도 입력 중인 글자가 날아가지 않도록 화면 밖(body)에 따로 붙어 있다.
import { digitOf, h, isTyping, toast } from './util.js';

// 빠른 도발 (채팅창이 비어 있을 때 숫자키 1~6). 봇도 이걸로 도발한다.
export const TAUNTS = ['아예?', '엄', '줴줴이야', '💀💀💀', '😭 살려줘', '좆밥컷ㅋㅋㅋㅋㅋㅋㅋ'];
const MAX_LEN = 60;
const GAP_MS = 700;      // 도배 방지
const FRESH_MS = 9000;   // 게임 중 왼쪽 아래 로그가 떠 있는 시간
const BUBBLE_MS = 3500;  // 말풍선 시간
const KEEP = 60;         // 방장이 이 개수만 남기고 오래된 메시지를 지운다

const safeColor = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#ecf0f1');

export function createChat() {
  let room = null;
  let mode = 'off';
  let lastSent = 0;
  let seen = null; // null이면 아직 처음 목록을 못 받은 것 (처음 목록엔 말풍선을 안 띄운다)
  const items = new Map();

  const log = h('ol', { class: 'chat-log' });
  const input = h('input', {
    class: 'chat-input', maxlength: MAX_LEN, autocomplete: 'off', spellcheck: 'false',
    placeholder: '메시지 · Enter 보내기 · Esc 닫기',
  });
  const taunts = h('div', { class: 'chat-taunts' }, TAUNTS.map((t, i) => h('button', {
    type: 'button', tabindex: '-1', onClick: () => send(t, true),
  }, h('kbd', {}, String(i + 1)), t)));
  const opener = h('button', { class: 'chat-open', type: 'button', tabindex: '-1', onClick: () => openChat() }, '💬 Enter로 채팅');
  const root = h('div', { class: 'chat off' }, log, opener, h('div', { class: 'chat-form' }, input, taunts));
  const bubbleLayer = h('div', { class: 'bubble-layer' });
  document.body.append(root, bubbleLayer);

  function openChat() {
    if (mode === 'off') return;
    root.classList.add('open');
    input.focus();
    log.scrollTop = log.scrollHeight;
  }

  function closeChat() {
    root.classList.remove('open');
    input.value = '';
    input.blur();
  }

  function send(text, taunt = false) {
    if (!room) return;
    const now = Date.now();
    if (now - lastSent < GAP_MS) {
      toast('천천히! 도배 금지');
      return;
    }
    lastSent = now;
    room.chat(text.slice(0, MAX_LEN), taunt);
    closeChat();
  }

  window.addEventListener('keydown', e => {
    if (mode === 'off') return;
    if (e.target === input) {
      if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중인 Enter는 무시
      if (e.key === 'Escape') {
        e.preventDefault();
        closeChat();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const t = input.value.trim();
        if (t) send(t);
        else closeChat();
      } else if (!input.value && digitOf(e) && digitOf(e) <= TAUNTS.length) {
        // 빈 칸에서 숫자키 → 도발 바로 보내기 (Enter, 3 이면 끝)
        e.preventDefault();
        send(TAUNTS[digitOf(e) - 1], true);
      }
      return;
    }
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || isTyping(e)) return;
    e.preventDefault();
    openChat();
  });

  function line(m) {
    if (m.sys) return h('li', { class: 'sys' }, String(m.text || ''));
    return h('li', { class: m.taunt ? 'taunt' : '' },
      h('b', { style: `color:${safeColor(m.color)}` }, String(m.name || '?')), ' ', String(m.text || ''));
  }

  function update(all) {
    const keys = Object.keys(all).sort();
    const initial = seen === null;
    if (initial) seen = new Set();
    for (const k of keys) {
      if (seen.has(k)) continue;
      seen.add(k);
      const m = all[k] || {};
      const li = line(m);
      items.set(k, li);
      log.append(li);
      if (!initial) {
        li.classList.add('fresh');
        setTimeout(() => li.classList.remove('fresh'), FRESH_MS);
        if (!m.sys && m.pid) bubble(m);
      }
    }
    for (const [k, li] of items) {
      if (k in all) continue;
      li.remove();
      items.delete(k);
      seen.delete(k);
    }
    log.scrollTop = log.scrollHeight;
    if (room && room.snap.meta?.hostId === room.id && keys.length > KEEP + 20) {
      for (const k of keys.slice(0, keys.length - KEEP)) room.net.remove(room.path(`chat/${k}`));
    }
  }

  // 말풍선은 그 사람 얼굴(화면에 보이는 것 중 가장 큰 것) 위를 따라다닌다.
  const live = new Set();
  let raf = 0;

  function anchorOf(pid) {
    let best = null;
    for (const el of document.querySelectorAll('.avatar[data-pid]')) {
      if (el.dataset.pid !== pid || root.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
      if (!best || r.width > best.width) best = r;
    }
    return best;
  }

  function follow(now) {
    for (const b of live) {
      if (now > b.until) {
        b.el.remove();
        live.delete(b);
        continue;
      }
      const a = anchorOf(b.pid);
      b.el.style.visibility = a ? '' : 'hidden';
      if (!a) continue;
      const above = a.top > 70;
      b.el.classList.toggle('below', !above);
      b.el.style.left = `${Math.min(innerWidth - 20, Math.max(20, a.left + a.width / 2))}px`;
      b.el.style.top = `${above ? a.top - 6 : a.bottom + 6}px`;
    }
    raf = live.size ? requestAnimationFrame(follow) : 0;
  }

  function bubble(m) {
    const el = h('div', { class: `bubble${m.taunt ? ' taunt' : ''}` }, String(m.text || ''));
    bubbleLayer.append(el);
    live.add({ el, pid: m.pid, until: performance.now() + BUBBLE_MS });
    if (!raf) raf = requestAnimationFrame(follow);
  }

  return {
    attach(r) {
      room = r;
      seen = null;
      items.clear();
      log.replaceChildren();
      r.onChat = update;
    },
    detach() {
      room = null;
      this.setMode('off');
      seen = null;
      items.clear();
      log.replaceChildren();
    },
    setMode(m) {
      if (m === mode) return;
      mode = m;
      const open = root.classList.contains('open');
      root.className = `chat ${m}${open && m !== 'off' ? ' open' : ''}`;
      if (m === 'off') closeChat();
    },
  };
}
