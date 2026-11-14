// 투기장: 차례 없이 모두 동시에 싸우는 난투. 규칙은 arena-core.js, 화면은 arena-view.js
import { setup, onInput, tick, bot } from './arena-core.js';
import mount from './arena-view.js';

export * from './arena-core.js';

export default {
  id: 'arena',
  title: '투기장',
  emoji: '🏟️',
  tag: '우정파괴',
  color: '#b13e53',
  desc: '몰래 한 명을 겨눠 무기를 장전하고, 한꺼번에 공개! 남은 기력으로 막아요. 먼저 누른 사람이 먼저 때리고, 유물로 강해지고, 쓰러뜨리면 뺏어요',
  minPlayers: 2,
  maxPlayers: 8,
  tickMs: 50, // 단계 마감·결과가 제때 나오게 자주 본다 (보내는 건 바뀔 때만)
  setup,
  onInput,
  tick,
  bot,
  mount,
};
