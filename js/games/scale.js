// 피의 저울: 내 생물을 제물로 바쳐 더 센 놈을 놓고, 양옆 이웃과 각각 저울을 다툰다. 규칙은 scale-core.js, 화면은 scale-view.js
import { setup, onInput, tick, bot } from './scale-core.js';
import mount from './scale-view.js';

export * from './scale-core.js';

export default {
  id: 'scale',
  title: '피의 저울',
  emoji: '🕯️',
  tag: '우정파괴',
  color: '#7a2433',
  desc: '내 생물을 제물로 바쳐 더 센 놈을 놓고, 양옆 이웃과 각각 저울을 다퉈요. 선공은 먼저 놓고 먼저 치고, 후공은 보고 놓아요. 저울이 다 기울면 촛불이 꺼져요',
  minPlayers: 2,
  maxPlayers: 8,
  tickMs: 50, // 단계 마감이 제때 넘어가게 자주 본다 (보내는 건 바뀔 때만)
  setup,
  onInput,
  tick,
  bot,
  mount,
};
