// 독박 원정대: 같이 싸우다가, 제일 타락한 사람이 마지막 보스가 된다. 규칙은 raid-core.js, 화면은 raid-view.js
import { setup, onInput, tick, bot } from './raid-core.js';
import mount from './raid-view.js';

export * from './raid-core.js';

export default {
  id: 'raid',
  title: '독박 원정대',
  emoji: '⚔️',
  tag: '우정파괴',
  color: '#5d275d',
  desc: '예고를 보고 다 같이 막고 때려요. 방을 깰 때마다 기술을 배워 내 덱을 키우는데, 마지막엔 제일 타락한 사람이 마왕이 돼요',
  minPlayers: 2,
  maxPlayers: 8,
  tickMs: 50, // 단계 마감 · 결과가 제때 나오게 자주 본다 (보내는 건 바뀔 때만)
  setup,
  onInput,
  tick,
  bot,
  mount,
};
