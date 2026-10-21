// 새 게임을 만들면 여기에 추가하세요. 게임 모듈 형식은 README.md 참고.
import timer from './timer.js';
import bomb from './bomb.js';
import tower from './tower.js';
import reaction from './reaction.js';
import liar from './liar.js';
import bumper from './bumper.js';
import pullout from './pullout.js';
import seesaw from './seesaw.js';

export const GAMES = [timer, bomb, tower, pullout, seesaw, bumper, reaction, liar];

export const COMING = [];

export const CATEGORIES = [
  { id: 'all', label: '전체', emoji: '🎮' },
  { id: '타이밍', label: '타이밍', emoji: '⏱️' },
  { id: '우정파괴', label: '우정파괴', emoji: '💥' },
  { id: '심리', label: '심리전', emoji: '🕵️' },
  { id: '액션', label: '액션', emoji: '🚗' },
];

// 태그 → 카드 아래 알약 색
export const TAG_COLORS = { 타이밍: 'blue', 우정파괴: 'orange', 심리: 'purple', 액션: 'green' };

export const getGame = id => GAMES.find(g => g.id === id) || GAMES[0];
