import { h, pick, shuffle } from '../util.js';
import { avatar, countdown, keyNav, nameTag, scoreboard } from '../ui.js';
import { isTyping } from '../util.js';

const REVEAL_TIME = 20000;
const HINT_TIME = 40000;
const VOTE_TIME = 45000;
const GUESS_TIME = 30000;

const WORDS = {
  음식: ['피자', '떡볶이', '김치찌개', '치킨', '라면', '초밥', '햄버거', '삼겹살', '짜장면', '비빔밥', '순대', '김밥', '마라탕', '돈가스', '냉면', '샌드위치'],
  동물: ['기린', '펭귄', '코끼리', '고양이', '강아지', '호랑이', '판다', '원숭이', '돌고래', '상어', '거북이', '다람쥐', '캥거루', '부엉이', '하마', '낙타'],
  장소: ['도서관', '병원', '놀이공원', '편의점', '찜질방', '공항', '수영장', '영화관', '노래방', 'PC방', '경찰서', '지하철역', '캠핑장', '박물관', '해수욕장', '헬스장'],
  직업: ['소방관', '의사', '요리사', '유튜버', '선생님', '경찰관', '우주비행사', '택배기사', '프로게이머', '미용사', '변호사', '파일럿', '농부', '마술사', '아이돌', '기자'],
  학교: ['급식', '체육복', '매점', '출석부', '사물함', '시험지', '졸업식', '교무실', '수행평가', '수학여행', '칠판', '쉬는시간', '방과후', '운동장', '보건실', '체육대회'],
  스포츠: ['축구', '농구', '야구', '배드민턴', '탁구', '수영', '볼링', '태권도', '스키', '배구', '골프', '테니스', '마라톤', '피구', '줄넘기', '클라이밍'],
  물건: ['우산', '휴대폰', '이어폰', '지갑', '냉장고', '칫솔', '거울', '베개', '리모컨', '선풍기', '가위', '시계', '안경', '운동화', '노트북', '텀블러'],
  과일: ['수박', '딸기', '바나나', '망고', '포도', '사과', '귤', '복숭아', '파인애플', '체리', '키위', '감', '레몬', '블루베리', '멜론', '배'],
};

// 봇 힌트: 어떤 제시어에도 대충 말이 되는 애매한 말들
const BOT_HINTS = ['자주 봤어요', '이거 좋아함', '누구나 알 듯', '생각보다 흔해요', '어릴 때 기억남', '요즘도 많이 봄',
  '돈 좀 듦', '친구랑 같이', '가끔 생각남', '호불호 갈림', '한국 사람이면 앎', '말하기 애매하네'];

const currentPid = S => S.order[S.turn % S.order.length];
const hintRound = S => Math.floor(S.turn / S.order.length) + 1;
const count = o => Object.keys(o || {}).length;
const squash = s => String(s).replace(/\s+/g, '').toLowerCase();

function addHint(ctx, pid, text, auto = false) {
  const S = ctx.state;
  let t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 40) || '…';
  const word = ctx.secret.word;
  // 제시어를 그대로 말해버리면 가린다 (한 글자 단어는 다른 말에 섞이기 쉬워서 제외)
  if (!auto && word.length >= 2 && squash(t).includes(squash(word))) {
    t = '🚫 제시어를 말해서 가려졌어요';
    auto = true;
  }
  S.hints = [...(S.hints || []), { pid, text: t, r: hintRound(S), ...(auto ? { auto: true } : {}) }];
}

function advance(S, now) {
  S.turn += 1;
  if (S.turn >= S.order.length * S.hintRounds) {
    S.phase = 'vote';
    S.votes = null;
    S.phaseEndsAt = now + VOTE_TIME;
  } else {
    S.phaseEndsAt = now + HINT_TIME;
  }
}

function finish(ctx, winner, reason) {
  const S = ctx.state;
  const { liar, word } = ctx.secret;
  const deltas = {};
  if (winner === 'citizens') {
    for (const p of S.roster) if (p.id !== liar) deltas[p.id] = 1;
  } else {
    deltas[liar] = S.accused === liar ? 2 : 3;
  }
  S.scores = S.scores || {};
  for (const [id, d] of Object.entries(deltas)) S.scores[id] = (S.scores[id] || 0) + d;
  S.result = { liar, word, winner, reason, guess: S.liarGuess };
  S.deltas = deltas;
  // 결과 화면 순위는 이번 판 기준: 이긴 쪽이 1등, 진 쪽은 공동 꼴찌(= 다 같이 스티커)
  S.standings = Object.fromEntries(S.roster.map(p => [p.id, deltas[p.id] || 0]));
  const titles = {};
  const add = (id, t) => (titles[id] ||= []).push(t);
  if (winner === 'citizens') {
    add(liar, '🤥 들킨 라이어');
    for (const [voter, target] of Object.entries(S.votes || {})) if (target === liar) add(voter, '🔍 명탐정');
  } else {
    add(liar, S.accused === liar ? '🧠 역전의 라이어' : '😎 뻔뻔왕');
    if (S.accused && S.accused !== liar) add(S.accused, '😇 억울한 시민');
  }
  S.titles = titles;
  ctx.announce(`🕵️ 라이어는 ${ctx.nameOf(liar)}! 제시어는 "${word}"`);
  S.phase = 'end';
  S.over = true;
  return true;
}

function tally(ctx, now) {
  const S = ctx.state;
  const counts = {};
  for (const t of Object.values(S.votes || {})) counts[t] = (counts[t] || 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  const top = Object.keys(counts).filter(id => counts[id] === max);
  if (max === 0) return finish(ctx, 'liar', '아무도 투표하지 않았어요');
  if (top.length > 1) return finish(ctx, 'liar', '표가 갈려서 라이어를 잡지 못했어요');
  S.accused = top[0];
  if (top[0] !== ctx.secret.liar) return finish(ctx, 'liar', '엉뚱한 사람을 지목했어요');
  S.phase = 'liarGuess';
  S.phaseEndsAt = now + GUESS_TIME;
  return true;
}

export default {
  id: 'liar',
  title: '라이어 게임',
  emoji: '🕵️',
  tag: '심리',
  color: '#ff6b5b',
  desc: '한 명만 제시어를 몰라요. 돌아가며 한 줄 힌트를 쓰고 라이어를 찾아내세요. 투표 전에 채팅으로 몰아가기 가능.',
  minPlayers: 3,
  maxPlayers: 8,

  setup(ctx, prev) {
    const { roster } = ctx;
    const scores = {};
    for (const p of roster) scores[p.id] = prev?.state?.scores?.[p.id] || 0;
    const used = prev?.secret?.used || [];
    const category = pick(Object.keys(WORDS));
    const fresh = WORDS[category].filter(w => !used.includes(w));
    const word = pick(fresh.length ? fresh : WORDS[category]);
    const liar = pick(roster).id;
    ctx.secret = { liar, word, used: [...used, word].slice(-60) };
    for (const p of roster) {
      ctx.setPrivate(p.id, p.id === liar ? { liar: true, category } : { liar: false, category, word });
    }
    return {
      phase: 'reveal',
      category,
      order: shuffle(roster.map(p => p.id)),
      hintRounds: roster.length <= 5 ? 2 : 1,
      turn: 0,
      phaseEndsAt: ctx.now() + REVEAL_TIME,
      scores,
      gameNo: (prev?.state?.gameNo || 0) + 1,
    };
  },

  onInput(ctx, { pid, type, data }) {
    const S = ctx.state;
    if (!S.roster.some(p => p.id === pid)) return false;
    if (type === 'ready' && S.phase === 'reveal' && !S.ready?.[pid]) {
      S.ready = { ...(S.ready || {}), [pid]: true };
      return true;
    }
    if (type === 'hint' && S.phase === 'hint' && currentPid(S) === pid) {
      addHint(ctx, pid, data.text);
      advance(S, ctx.now());
      return true;
    }
    if (type === 'vote' && S.phase === 'vote' && !S.votes?.[pid]
        && data.target !== pid && S.roster.some(p => p.id === data.target)) {
      S.votes = { ...(S.votes || {}), [pid]: data.target };
      return true;
    }
    if (type === 'guess' && S.phase === 'liarGuess' && pid === ctx.secret.liar) {
      S.liarGuess = String(data.word || '');
      const ok = S.liarGuess === ctx.secret.word;
      return finish(ctx, ok ? 'liar' : 'citizens', ok ? '라이어가 제시어를 맞혀서 역전승!' : '라이어가 제시어를 틀렸어요');
    }
    return false;
  },

  tick(ctx) {
    const S = ctx.state;
    const now = ctx.now();
    const online = S.roster.filter(p => ctx.isOnline(p.id)).map(p => p.id);
    switch (S.phase) {
      case 'reveal':
        if (now < S.phaseEndsAt && !online.every(id => S.ready?.[id])) return false;
        S.phase = 'hint';
        S.turn = 0;
        S.phaseEndsAt = now + HINT_TIME;
        return true;
      case 'hint': {
        const cur = currentPid(S);
        const away = !ctx.isOnline(cur);
        if (now < S.phaseEndsAt && !away) return false;
        addHint(ctx, cur, away ? '💤 (자리 비움)' : '⏰ (시간 초과)', true);
        advance(S, now);
        return true;
      }
      case 'vote':
        if (now < S.phaseEndsAt && !online.every(id => S.votes?.[id])) return false;
        return tally(ctx, now);
      case 'liarGuess':
        if (now < S.phaseEndsAt && ctx.isOnline(ctx.secret.liar)) return false;
        return finish(ctx, 'citizens', '라이어가 제시어를 맞히지 못했어요');
      default:
        return false;
    }
  },

  // 봇: 바로 확인, 2~5초 고민하다 애매한 힌트, 투표는 반쯤 감으로 (시민 봇은 라이어를 조금 더 잘 찍음)
  bot(ctx, id, mem) {
    const S = ctx.state;
    const now = ctx.now();
    if (S.phase === 'reveal') return !S.ready?.[id] && Math.random() < 0.1 ? { type: 'ready' } : null;
    if (S.phase === 'hint' && currentPid(S) === id) {
      if (mem.turn !== S.turn) {
        mem.turn = S.turn;
        mem.at = now + 2000 + Math.random() * 3000;
      }
      return now >= mem.at ? { type: 'hint', data: { text: pick(BOT_HINTS) } } : null;
    }
    if (S.phase === 'vote' && !S.votes?.[id] && Math.random() < 0.05) {
      const liar = ctx.secret.liar;
      const others = S.roster.filter(p => p.id !== id).map(p => p.id);
      return { type: 'vote', data: { target: id !== liar && Math.random() < 0.4 ? liar : pick(others) } };
    }
    if (S.phase === 'liarGuess' && ctx.secret.liar === id) {
      mem.guessAt ||= now + 3000;
      if (now < mem.guessAt) return null;
      return { type: 'guess', data: { word: Math.random() < 0.35 ? ctx.secret.word : pick(WORDS[S.category]) } };
    }
    return null;
  },

  mount(root, api) {
    const me = api.me;
    const card = h('div', { class: 'lr-card' });
    const main = h('section', { class: 'lr-main panel' });
    const side = h('aside', { class: 'side' });
    root.append(h('div', { class: 'lr' }, h('div', { class: 'lr-left' }, card, main), side));
    card.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') card.classList.toggle('peek'); });
    // 마우스 없이: Shift를 누르고 있는 동안만 내 카드가 보인다. 스페이스는 '확인했어요'.
    const onKeyDown = e => {
      if (isTyping(e)) return;
      if (e.key === 'Shift') card.classList.add('peek');
      if (e.code === 'Space' && !e.repeat && S?.phase === 'reveal' && isPlayer && !S.ready?.[me]) {
        e.preventDefault();
        api.send('ready');
      }
    };
    const onKeyUp = e => { if (e.key === 'Shift') card.classList.remove('peek'); };
    const onBlur = () => card.classList.remove('peek');
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    let nav = null; // 투표/추측 버튼 키보드 조작

    let S = null;
    let P = null;
    let isPlayer = false;
    let mainKey = '';
    let cardKey = '';
    const who = id => S.roster.find(p => p.id === id);

    function renderCard() {
      const key = JSON.stringify(P) + S.category;
      if (key === cardKey) return;
      cardKey = key;
      if (!P) {
        card.classList.add('open');
        card.replaceChildren(h('div', { class: 'lr-card-body' },
          h('small', {}, '관전 중'), h('b', { class: 'display' }, S.category), h('small', {}, '이번 판 카테고리')));
        return;
      }
      card.classList.remove('open');
      card.replaceChildren(
        h('div', { class: 'lr-card-hint' }, h('span', {}, '👀 ', h('kbd', {}, 'Shift'), '를 누르고 있으면 내 카드가 보여요')),
        h('div', { class: 'lr-card-body' }, P.liar
          ? [h('small', {}, `카테고리: ${P.category}`), h('b', { class: 'display liar' }, '당신은 라이어 🕵️'), h('small', {}, '제시어를 아는 척 하세요!')]
          : [h('small', {}, `카테고리: ${P.category}`), h('b', { class: 'display' }, P.word), h('small', {}, '라이어에게 들키지 않게 돌려서 설명하세요')]));
    }

    function keyOf() {
      switch (S.phase) {
        case 'reveal': return `reveal:${!!S.ready?.[me]}:${count(S.ready)}`;
        case 'hint': return `hint:${S.turn}`;
        case 'vote': return `vote:${S.votes?.[me] || ''}:${count(S.votes)}`;
        default: return S.phase;
      }
    }

    function revealStage() {
      return h('div', { class: 'stage' },
        h('h2', { class: 'display' }, '카드를 몰래 확인하세요'),
        h('p', { class: 'muted' }, 'Shift를 꾹 누르고 있으면 위 카드가 보여요. 옆 친구한테 들키지 않게!'),
        !isPlayer ? null : S.ready?.[me]
          ? h('div', { class: 'pill ok' }, '확인 완료 ✓')
          : h('button', { class: 'btn primary big narrow', tabindex: '-1', onClick: e => { e.currentTarget.disabled = true; api.send('ready'); } },
            '확인했어요 ✋', h('kbd', {}, 'Space')),
        h('p', { class: 'muted small' }, `${count(S.ready)} / ${S.roster.length}명 확인`),
        countdown(S.phaseEndsAt, REVEAL_TIME));
    }

    function hintStage() {
      const cur = currentPid(S);
      const pos = S.turn % S.order.length;
      const order = h('ol', { class: 'turn-order' }, S.order.map((id, i) =>
        h('li', { class: i === pos ? 'now' : i < pos ? 'past' : '' }, avatar(who(id)), who(id)?.name)));
      const head = h('p', { class: 'muted small' }, `힌트 ${hintRound(S)} / ${S.hintRounds}바퀴 · 카테고리 ${S.category}`);
      if (cur !== me) {
        return h('div', { class: 'stage' }, head,
          h('h2', { class: 'display who' }, avatar(who(cur), 'lg'), `${who(cur)?.name} 차례`),
          h('p', { class: 'muted' }, '힌트를 쓰는 중…'),
          order, countdown(S.phaseEndsAt, HINT_TIME));
      }
      const input = h('input', {
        class: 'input', maxlength: 40, autocomplete: 'off',
        placeholder: P?.liar ? '눈치껏 그럴듯하게…' : '제시어를 직접 말하면 안 돼요!',
      });
      const btn = h('button', { class: 'btn primary' }, '보내기');
      const submit = () => {
        const text = input.value.trim();
        if (!text) return input.focus();
        input.disabled = true;
        btn.disabled = true;
        api.send('hint', { text });
      };
      btn.addEventListener('click', submit);
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) submit(); });
      setTimeout(() => input.focus(), 30);
      return h('div', { class: 'stage' }, head,
        h('h2', { class: 'display' }, '내 차례! ✍️'),
        h('p', {}, P?.liar ? '라이어인 걸 들키지 않게 한 줄로 아무 말이나…' : '제시어를 한 줄로 돌려서 설명하세요'),
        h('div', { class: 'row' }, input, btn),
        order, countdown(S.phaseEndsAt, HINT_TIME));
    }

    function voteStage() {
      const tail = [h('p', { class: 'muted small' }, `${count(S.votes)} / ${S.roster.length}명 투표`), countdown(S.phaseEndsAt, VOTE_TIME)];
      if (!isPlayer) return h('div', { class: 'stage' }, h('h2', { class: 'display' }, '투표 중…'), ...tail);
      const mine = S.votes?.[me];
      if (mine) {
        return h('div', { class: 'stage' },
          h('h2', { class: 'display' }, '투표 완료'),
          h('p', {}, nameTag(who(mine), me), ' 님을 지목했어요'), ...tail);
      }
      const btns = S.roster.filter(p => p.id !== me).map(p => h('button', {
        class: 'vote-btn',
        tabindex: '-1',
        onClick: () => { btns.forEach(b => { b.disabled = true; }); api.send('vote', { target: p.id }); },
      }, avatar(p, 'lg'), h('span', {}, p.name)));
      nav = keyNav(btns);
      return h('div', { class: 'stage' },
        h('h2', { class: 'display' }, '라이어는 누구? 🔍'),
        h('p', { class: 'muted' }, '숫자키로 바로 지목 (또는 ← → 고르고 스페이스). 한 번 고르면 못 바꿔요!'),
        h('div', { class: 'vote-grid' }, btns), ...tail);
    }

    function guessStage() {
      const liar = who(S.accused);
      if (P?.liar) {
        const btns = [...WORDS[S.category]].sort((a, b) => a.localeCompare(b, 'ko')).map(w => h('button', {
          class: 'btn',
          tabindex: '-1',
          onClick: () => { btns.forEach(b => { b.disabled = true; }); api.send('guess', { word: w }); },
        }, w));
        nav = keyNav(btns, { numbers: false });
        return h('div', { class: 'stage' },
          h('h2', { class: 'display' }, '들켰다! 😱'),
          h('p', {}, '제시어를 맞히면 역전승! 방향키로 고르고 스페이스'),
          h('div', { class: 'word-grid' }, btns),
          countdown(S.phaseEndsAt, GUESS_TIME));
      }
      return h('div', { class: 'stage' },
        h('h2', { class: 'display who' }, avatar(liar, 'lg'), `라이어는 ${liar?.name}!`),
        h('p', { class: 'muted' }, '마지막 기회: 라이어가 제시어를 맞히는 중…'),
        countdown(S.phaseEndsAt, GUESS_TIME));
    }

    function endStage() {
      const R = S.result;
      const votes = S.votes || {};
      const rows = S.roster
        .map(p => ({ p, voters: Object.keys(votes).filter(v => votes[v] === p.id) }))
        .filter(r => r.voters.length)
        .sort((a, b) => b.voters.length - a.voters.length);
      return h('div', { class: `stage end ${R.winner}` },
        h('div', { class: 'banner display' }, R.winner === 'citizens' ? '시민 승리! 🎉' : '라이어 승리! 🕵️'),
        h('p', { class: 'reason' }, R.reason),
        h('div', { class: 'reveal-row' },
          h('div', {}, h('small', {}, '라이어'), nameTag(who(R.liar), me)),
          h('div', {}, h('small', {}, '제시어'), h('b', { class: 'display' }, R.word))),
        R.guess ? h('p', {}, `라이어의 추측: ${R.guess} ${R.guess === R.word ? '⭕' : '❌'}`) : null,
        rows.length ? h('ul', { class: 'tally' }, rows.map(r => h('li', { class: r.p.id === R.liar ? 'liar' : '' },
          nameTag(r.p, me),
          h('span', { class: 'voters' }, r.voters.map(v => avatar(who(v)))),
          h('b', {}, `${r.voters.length}표`)))) : null);
    }

    function renderSide() {
      const items = [];
      let lastR = 0;
      for (const x of S.hints || []) {
        if (S.hintRounds > 1 && x.r !== lastR) {
          lastR = x.r;
          items.push(h('li', { class: 'divider' }, `${x.r}바퀴`));
        }
        items.push(h('li', { class: x.auto ? 'auto' : '' },
          avatar(who(x.pid)),
          h('div', {}, h('small', {}, who(x.pid)?.name || '?'), h('span', {}, x.text))));
      }
      side.replaceChildren(
        h('h3', {}, `힌트 · ${S.category}`),
        items.length ? h('ol', { class: 'hint-log' }, items) : h('p', { class: 'muted small' }, '아직 힌트가 없어요'),
        h('h3', {}, S.gameNo > 1 ? `점수 (${S.gameNo}판째)` : '점수'),
        scoreboard(S.roster, S.scores, me, S.phase === 'end' ? S.deltas : null));
    }

    const stages = { reveal: revealStage, hint: hintStage, vote: voteStage, liarGuess: guessStage, end: endStage };

    return {
      update({ state, priv }) {
        S = state;
        P = priv;
        isPlayer = S.roster.some(p => p.id === me);
        renderCard();
        const key = keyOf();
        if (key !== mainKey) {
          mainKey = key;
          nav?.destroy();
          nav = null;
          main.replaceChildren(stages[S.phase]?.() || '');
        }
        renderSide();
      },
      unmount() {
        nav?.destroy();
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
      },
    };
  },
};
