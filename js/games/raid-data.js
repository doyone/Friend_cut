// 독박 원정대의 표와 값 (규칙 코드는 raid-core.js, 화면은 raid-view.js)
// 수치는 전부 시험 안 해 본 첫 값이다. 사용자가 해 보고 "좀 낮춰 줘" 하면 여기만 고친다.

/* ───────── 값 ───────── */

export const ENERGY_START = 3;     // 전투를 시작할 때 기력
export const ENERGY_GAIN = 3;      // 턴마다 들어오는 기력
export const ENERGY_MAX = 6;       // 안 쓴 기력은 남는다. 이걸 넘는 건 사라진다
export const DECK = 8;             // 덱은 늘 8장. 배울 때마다 한 장과 바꾼다
export const HAND = 5;             // 턴이 시작할 때 손패가 이만큼 되게 뽑는다
export const DROP_PER_TURN = 1;    // 턴마다 그냥 버릴 수 있는 장수
export const ACT_TIME = 20000;
export const BOSS_FIRST_TIME = 15000; // 최종전 첫 턴: 마왕이 먼저 권능을 고른다
export const BOSS_AHEAD = true;    // 마왕은 원정대가 대응하는 동안 다음 턴 권능을 고른다
export const CLS_TIME = 15000;
export const LEARN_TIME = 15000;
export const START_LEARN_TIME = 10000;
export const MARK_TIME = 12000;
export const WHISPER_TIME = 8000;
export const ENTER_TIME = 2200;
export const CLEAR_TIME = 3500;
export const WHISPER_SHOW = 3500;  // 속삭임 답을 한꺼번에 보여 주는 시간
export const FALL_TIME = 5500;     // 흑화 장면
export const BONUS = { vuln: 0.5, groggy: 0.5, deathMark: 0.3, descent: 0.5, alone: 0.5, ghostCurse: 0.1 };
export const WEAK_MULT = 0.75;
export const KEEN_MULT = 1.3;
export const LEECH = 0.25;
export const SKIP_HEAL = 6;        // 배움을 건너뛰면
export const CLEAR_HEAL = 10;      // 방을 깨면 전원
export const WHISPER_CORRUPT = 2;
export const USE_CORRUPT = 1;
export const KILL_ALLY_CORRUPT = 2;
export const FALL_MIN = 6;         // 이 타락 이상인 1위가 마왕이 된다
export const BAPTISM = 3;          // 지난 판 마왕: 처음 얻는 타락 이만큼은 무효
export const BOSS_HP = [40, 60, 4]; // 40 + 60 × 원정대 수 + 4 × 타락
export const BOSS_DMG_PER_CORRUPT = 0.03;
export const BOSS_ENERGY = 3;      // 어둠도 기력과 같은 규칙 (턴마다 +3, 최대 6)
export const SCAPEGOAT_HEAL = 8;   // 독박: 원정대가 최종전에서 금단을 쓰면 마왕 체력 +8
export const GHOST_BLOCK = 3;
export const BREAK_PER_HERO = { elite: 4, boss: 6 };
export const BLEED_MAX = 12;
export const BOSS_FEW = { 1: 0.5, 2: 0.75 };
export const PRE_THROTTLE = 500;   // 실시간 합계는 이 간격에 한 번만
export const ENRAGE = { mob: 7, elite: 9, boss: 12, add: 3 };
export const ULT_WIND = 2;         // 필살기: 예고한 턴 + 2턴 뒤 적 행동 때 터진다 (끊을 기회 3번)
export const RS_CAP = 9000;        // 결과 장면 전체 길이 상한

/* ───────── 각인 ───────── */

export const MARKS = {
  keen: { name: '날카로움', tip: '주 수치 +30%' },
  light: { name: '가벼움', tip: '비용 -1' },
  echo: { name: '잔상', tip: '쓰고 나면 덱 맨 위로 (다음 턴에 또 온다)' },
  shield: { name: '수호', tip: '쓸 때 나에게 방어 +4' },
  leech: { name: '흡혈', tip: '이 기술로 준 피해의 25% 회복 (공격 기술만)' },
  crush: { name: '파쇄', tip: '차단 +3 (공격 기술만)' },
  swift: { name: '선제', tip: '맨 먼저 들어간다 (공격 기술만)' },
  alone: { name: '홀로', tip: '이번 턴에 낸 기술이 이것 하나뿐이면 효과 +50% (오의엔 못 새김)' },
};

/* ───────── 기술 ─────────
   to: foe 적 하나 · foes 모든 적 · self 나 · ally 나 또는 아군 한 명 · other 다른 아군 한 명 · allies 아군 전원(나 포함)
       others 다른 아군 전원 · down 쓰러진 아군 · none
   spd: first 선제(맨 먼저) · last 후속(맨 나중)
   fx: [효과, 수치…]. 효과마다 처리 단계가 정해져 있다 (raid-core.js 의 PREP · ATK · HEAL)
   ammo: 탄 (숫자 또는 'all') · ult: 오의 · dark: 금단 · aura: 쓰면 그 전투에서 빠진다 */
const card = (cls, tree, name, cost, to, fx, tip, more = {}) => ({ cls, tree, name, cost, to, fx, tip, ...more });

export const CARDS = {
  // 공통 (모든 직업의 배움에 한 장씩 낀다. 숙련도는 안 오른다)
  bandage: card(null, 'common', '붕대', 1, 'self', [['heal', 8]], '내 체력 +8'),
  padded: card(null, 'common', '덧댄 갑옷', 1, 'self', [['block', 8]], '내 방어 8'),
  mallet: card(null, 'common', '쇠망치', 2, 'foe', [['dmg', 8], ['brk', 5]], '피해 8 · 차단 5'),
  whet: card(null, 'common', '숫돌', 0, 'self', [['nextAtk', 5]], '이번 턴 내 다음 공격 +5'),
  warcry: card(null, 'common', '전투 함성', 1, 'allies', [['atkFirst', 2]], '이번 턴 아군 전원의 공격 기술마다 첫 타 +2'),
  horn: card(null, 'common', '뿔피리', 1, 'self', [['taunt'], ['block', 6]], '이번 턴 적의 단일 공격이 나에게 · 방어 6'),
  stim: card(null, 'common', '각성제', 0, 'self', [['energy', 2], ['energyNext', -2]], '이번 턴 기력 +2 · 다음 턴 기력 -2'),
  keg: card(null, 'common', '화약통', 2, 'foes', [['dmgAll', 8], ['hitAllies', 3]], '모든 적 8 · 다른 아군 전원도 3'),

  // 🛡 수호자: 기본기
  slash: card('guard', 'base', '베기', 1, 'foe', [['dmg', 6]], '피해 6'),
  raise: card('guard', 'base', '방패 올리기', 1, 'ally', [['block', 7]], '나 또는 아군 한 명 방어 7'),
  bash: card('guard', 'base', '방패 밀치기', 1, 'foe', [['dmg', 4], ['brk', 3]], '피해 4 · 차단 3'),
  // 철벽
  fortress: card('guard', 'wall', '성채', 2, 'self', [['block', 16]], '방어 16'),
  shieldSlam: card('guard', 'wall', '방패 강타', 1, 'foe', [['dmgFromBlock', 0.5, 12], ['brk', 3]], '내 방어도의 절반만큼 피해 (최대 12) · 차단 3. 방어도는 그대로'),
  hunker: card('guard', 'wall', '웅크리기', 0, 'self', [['block', 4], ['blockIfNoAtk', 6]], '방어 4 · 이번 턴 공격 기술을 안 냈으면 +6'),
  unbreak: card('guard', 'wall', '무너지지 않는 벽', 4, 'self', [['aura', 'wall', 6]], '이번 전투 동안 턴 시작마다 방어 +6', { ult: true, aura: true }),
  // 응징
  intercept: card('guard', 'venge', '가로막기', 1, 'other', [['intercept'], ['blockSelf', 6]], '다른 아군 한 명을 노린 단일 공격을 내가 대신 받는다 · 방어 6'),
  thornShield: card('guard', 'venge', '가시 방패', 1, 'self', [['block', 6], ['thorns', 6]], '방어 6 · 이번 턴 나를 때린 적마다 6'),
  riposte: card('guard', 'venge', '응수', 1, 'foe', [['dmgLastBlocked', 20]], '지난 턴에 내가 막아 낸 피해만큼 피해 (최대 20)'),
  avenge: card('guard', 'venge', '앙갚음', 4, 'self', [['block', 12], ['avenge']], '방어 12 · 이번 턴 내가 막아 낸 피해를 턴 끝에 때린 적들에게 돌려준다', { ult: true }),
  // 지휘
  cheer: card('guard', 'lead', '격려', 1, 'other', [['energyNext', 2]], '다른 아군 한 명: 다음 턴 기력 +2'),
  order: card('guard', 'lead', '표적 지시', 0, 'foe', [['focus', 3]], '적 하나: 이번 턴 그 적을 때리는 아군의 기술마다 첫 타 +3'),
  shieldWall: card('guard', 'lead', '방패 벽', 2, 'others', [['blockFromMine', 0.5]], '다른 아군 전원에게 내 방어도의 절반만큼 방어'),
  banner: card('guard', 'lead', '군기', 4, 'allies', [['aura', 'banner', 2]], '이번 전투 동안 아군 전원 턴 시작마다 방어 +2 · 공격 기술 +1', { ult: true, aura: true }),
  // 금단: 불사의 계약
  undying: card('guard', 'g_dark', '불사', 1, 'self', [['undying']], '이번 턴 내 체력이 1 아래로 안 내려간다', { dark: true }),
  atone: card('guard', 'g_dark', '대속', 2, 'self', [['absorbAll', 0.5]], '이번 턴 다른 아군이 받을 모든 피해(광역 포함)를 내가 대신, 절반으로 받는다', { dark: true }),
  bloodWall: card('guard', 'g_dark', '핏빛 방벽', 0, 'other', [['allyHp', 6], ['blockSelf', 18]], '다른 아군 한 명 체력 -6 → 나 방어 +18', { dark: true }),

  // 🪓 광전사: 기본기
  chop: card('berserk', 'base', '도끼질', 1, 'foe', [['dmg', 7]], '피해 7'),
  cleave: card('berserk', 'base', '내려찍기', 2, 'foe', [['dmg', 11], ['brk', 4]], '피해 11 · 차단 4'),
  grit: card('berserk', 'base', '이 악물기', 1, 'self', [['block', 6]], '방어 6'),
  // 광기
  flesh: card('berserk', 'frenzy', '살을 주고', 1, 'foe', [['hpCost', 4], ['dmg', 14]], '체력 -4 · 피해 14'),
  reckless: card('berserk', 'frenzy', '무모한 돌진', 0, 'foe', [['dmg', 8], ['selfVuln']], '피해 8 · 나는 이번 턴 취약'),
  thirst: card('berserk', 'frenzy', '피의 갈증', 1, 'foe', [['dmg', 6], ['againIfLow']], '피해 6 · 내 체력이 절반 아래면 한 번 더'),
  laststand: card('berserk', 'frenzy', '최후의 발악', 4, 'foe', [['dmg', 12], ['plusLostHp']], '피해 12 + 잃은 체력만큼', { ult: true, spd: 'last' }),
  // 분쇄
  sunder: card('berserk', 'smash', '갑옷 쪼개기', 1, 'foe', [['dmg', 5], ['vuln', 2]], '피해 5 · 취약 2턴', { spd: 'first' }),
  quake: card('berserk', 'smash', '지축 흔들기', 2, 'foe', [['dmg', 8], ['brk', 7]], '피해 8 · 차단 7'),
  shatter: card('berserk', 'smash', '박살', 1, 'foe', [['dmg', 6], ['onKillEnergy', 2]], '피해 6 · 이걸로 잡으면 다음 턴 기력 +2'),
  execute: card('berserk', 'smash', '처형', 5, 'foe', [['dmg', 26], ['x2LowOrGroggy']], '피해 26 · 그로기이거나 체력 30% 아래인 적에게는 2배', { ult: true, spd: 'last' }),
  // 선혈
  rend: card('berserk', 'gore', '찢기', 1, 'foe', [['dmg', 4], ['bleed', 4]], '피해 4 · 출혈 4'),
  tear: card('berserk', 'gore', '상처 벌리기', 1, 'foe', [['dmgFromBleed']], '그 적의 출혈만큼 피해 (출혈은 그대로)', { spd: 'last' }),
  scent: card('berserk', 'gore', '피 냄새', 0, 'self', [['bleedHitPlus', 2]], '이번 턴 출혈 중인 적을 때리는 내 공격 +2'),
  hemorrhage: card('berserk', 'gore', '대출혈', 4, 'foe', [['bleedDouble']], '그 적의 출혈을 2배로, 그리고 그만큼 바로 피해', { ult: true }),
  // 금단: 살육
  bloodstorm: card('berserk', 'b_dark', '피바람', 2, 'foes', [['dmgAll', 14], ['hitAllies', 4]], '모든 적 14 · 다른 아군 전원도 4', { dark: true }),
  devour: card('berserk', 'b_dark', '포식', 1, 'foe', [['dmg', 10], ['lifesteal']], '피해 10 · 준 만큼 회복', { dark: true }),
  allyBlood: card('berserk', 'b_dark', '아군의 피', 0, 'other', [['allyHp', 6], ['nextAtk', 12]], '다른 아군 한 명 체력 -6 → 이번 턴 내 다음 공격 +12', { dark: true }),

  // 🔫 거너: 기본기
  shot: card('gunner', 'base', '사격', 1, 'foe', [['dmg', 8]], '피해 8', { ammo: 1 }),
  burst: card('gunner', 'base', '속사', 1, 'foe', [['dmg', 5, 2]], '피해 5 두 번', { ammo: 2 }),
  cover: card('gunner', 'base', '엄폐', 1, 'self', [['block', 6]], '방어 6'),
  roll: card('gunner', 'base', '구르기', 0, 'self', [['block', 3], ['handNext', 1]], '방어 3 · 다음 턴 손패 1장 더'),
  // 속사
  twinGuns: card('gunner', 'rapid', '쌍권총', 0, 'foe', [['dmg', 4, 2]], '피해 4 두 번', { ammo: 2 }),
  quickLoad: card('gunner', 'rapid', '빠른 장전', 0, 'self', [['ammo', 3]], '탄 +3'),
  barrage: card('gunner', 'rapid', '탄막', 2, 'foes', [['dmgAll', 6]], '모든 적 6', { ammo: 3 }),
  spray: card('gunner', 'rapid', '난사', 4, 'foe', [['dmgPerAmmo', 6]], '남은 탄 전부: 한 발마다 피해 6', { ult: true, spd: 'last', ammo: 'all' }),
  // 저격
  aim: card('gunner', 'snipe', '조준', 1, 'self', [['aim', 3]], '조준 +3 (다음에 쏘는 한 발에 조준 1마다 +4)'),
  holdBreath: card('gunner', 'snipe', '숨 참기', 0, 'self', [['block', 4], ['aimIfNoShot', 2]], '방어 4 · 이번 턴 한 발도 안 쐈으면 조준 +2'),
  spot: card('gunner', 'snipe', '약점 포착', 1, 'foe', [['dmg', 6], ['vuln', 2]], '피해 6 · 취약 2턴', { spd: 'first', ammo: 1 }),
  snipe: card('gunner', 'snipe', '저격', 4, 'foe', [['dmg', 20], ['aimDouble']], '피해 20 · 조준 보너스를 두 배로 받는다', { ult: true, spd: 'last', ammo: 1 }),
  // 폭약
  apRound: card('gunner', 'bomb', '철갑탄', 1, 'self', [['rounds', 'ap', 3]], '다음 3발: 방어 무시 · 발마다 차단 1'),
  fireRound: card('gunner', 'bomb', '소이탄', 1, 'self', [['rounds', 'fire', 3]], '다음 3발: 발마다 출혈 1'),
  grenade: card('gunner', 'bomb', '유탄', 2, 'foes', [['dmgAll', 7], ['brkAll', 2]], '모든 적 7 · 차단 2', { ammo: 2 }),
  dynamite: card('gunner', 'bomb', '폭약통', 5, 'foe', [['dmg', 20], ['splash', 10], ['brk', 6]], '적 하나 20 · 다른 모든 적 10 · 차단 6', { ult: true, ammo: 1 }),
  // 금단: 마탄
  bloodRound: card('gunner', 'n_dark', '피의 탄환', 0, 'self', [['hpCost', 4], ['ammo', 3], ['shotPlus', 2]], '체력 -4 → 탄 +3 · 이번 턴 사격 한 발마다 +2', { dark: true }),
  cursedShot: card('gunner', 'n_dark', '마탄', 1, 'foe', [['dmg', 18], ['pierce'], ['hitLowestAlly', 5]], '피해 18 방어 무시 · 체력이 가장 낮은 다른 아군도 5', { dark: true, ammo: 1 }),
  deathMark: card('gunner', 'n_dark', '죽음의 표적', 1, 'foe', [['deathMark', 0.3]], '적 하나: 이번 턴 그 적이 받는 모든 피해 +30%', { dark: true }),

  // ✚ 사제: 기본기
  mace: card('priest', 'base', '철퇴', 1, 'foe', [['dmg', 6]], '피해 6'),
  lightHeal: card('priest', 'base', '치유의 빛', 1, 'ally', [['heal', 8]], '나 또는 아군 한 명 체력 +8'),
  prayer: card('priest', 'base', '기도', 1, 'ally', [['block', 5], ['faith', 1]], '나 또는 아군 한 명 방어 5 · 신앙 +1'),
  lightBolt: card('priest', 'base', '빛의 화살', 1, 'foe', [['dmg', 5], ['brk', 2]], '피해 5 · 차단 2'),
  // 은총
  greatHeal: card('priest', 'grace', '큰 치유', 2, 'ally', [['heal', 18]], '나 또는 아군 한 명 체력 +18'),
  sanctuary: card('priest', 'grace', '성역', 2, 'allies', [['block', 6]], '아군 전원 방어 6'),
  protect: card('priest', 'grace', '보호의 기도', 1, 'ally', [['regen', 4, 3, 2]], '아군 한 명: 2턴 동안 턴 시작마다 체력 +4 · 방어 3'),
  revive: card('priest', 'grace', '부활', 4, 'down', [['revive']], '쓰러진 아군을 체력 절반으로 일으킨다', { ult: true }),
  // 심판
  lightChain: card('priest', 'judge', '빛의 사슬', 1, 'foe', [['dmg', 5], ['weak', 2], ['brk', 3]], '피해 5 · 약화 2턴 · 차단 3'),
  brand: card('priest', 'judge', '죄의 낙인', 1, 'foe', [['vuln', 2]], '적 하나 취약 2턴. 신앙 2를 쓰면 모든 적에게', { spd: 'first', faithAll: 2 }),
  smite: card('priest', 'judge', '응징의 빛', 1, 'foe', [['dmg', 4], ['healMostHurt', 4]], '피해 4 · 가장 다친 아군 체력 +4'),
  judgment: card('priest', 'judge', '심판', 4, 'foe', [['dmgFaith', 10, 4]], '피해 10 + 신앙 × 4. 신앙을 전부 쓴다', { ult: true, spd: 'last' }),
  // 축복
  blessing: card('priest', 'bless', '축복', 1, 'ally', [['atkPlus', 3]], '아군 한 명: 이번 턴 공격 기술 +3'),
  hymn: card('priest', 'bless', '용기의 성가', 1, 'ally', [['heal', 4], ['energyNext', 1]], '아군 한 명: 체력 +4 · 다음 턴 기력 +1'),
  ward: card('priest', 'bless', '가호', 1, 'ally', [['ward']], '아군 한 명: 다음에 받는 피해 한 번을 절반으로 (쓸 때까지 남음)'),
  descent: card('priest', 'bless', '강림', 5, 'allies', [['teamDmg', 0.5]], '이번 턴 아군 전원이 주는 피해 +50%', { ult: true }),
  // 금단: 피의 성찬
  communion: card('priest', 'p_dark', '성찬', 1, 'allies', [['heal', 7]], '아군 전원 체력 +7', { dark: true }),
  transfer: card('priest', 'p_dark', '생명 전이', 0, 'ally', [['transfer', 8, 16]], '체력이 가장 많은 다른 아군의 체력 8을 빼앗아 지목한 아군에게 16', { dark: true }),
  plague: card('priest', 'p_dark', '역병', 2, 'foes', [['bleedAll', 6], ['bleedAllies', 2]], '모든 적 출혈 6 · 다른 아군 전원 출혈 2', { dark: true }),
};

/* ───────── 계열 ───────── */

export const TREES = {
  wall: { cls: 'guard', name: '철벽', title: '성벽', tip: '방어도를 쌓아 무기로' },
  venge: { cls: 'guard', name: '응징', title: '응징자', tip: '대신 맞고 되갚는다' },
  lead: { cls: 'guard', name: '지휘', title: '기수', tip: '깃발 아래 모은다' },
  g_dark: { cls: 'guard', name: '불사의 계약', dark: true },
  frenzy: { cls: 'berserk', name: '광기', title: '광인', tip: '체력을 태워 더 세게' },
  smash: { cls: 'berserk', name: '분쇄', title: '파쇄자', tip: '끊고, 부수고, 처형한다' },
  gore: { cls: 'berserk', name: '선혈', title: '도살자', tip: '벤 자리를 벌린다' },
  b_dark: { cls: 'berserk', name: '살육', dark: true },
  rapid: { cls: 'gunner', name: '속사', title: '총잡이', tip: '한 턴에 쏟아붓는다' },
  snipe: { cls: 'gunner', name: '저격', title: '명사수', tip: '조준을 쌓아 한 발' },
  bomb: { cls: 'gunner', name: '폭약', title: '폭파병', tip: '특수탄과 폭발' },
  n_dark: { cls: 'gunner', name: '마탄', dark: true },
  grace: { cls: 'priest', name: '은총', title: '치유사', tip: '살린다' },
  judge: { cls: 'priest', name: '심판', title: '심판관', tip: '신앙을 벼락으로' },
  bless: { cls: 'priest', name: '축복', title: '인도자', tip: '남을 세게 만든다' },
  p_dark: { cls: 'priest', name: '피의 성찬', dark: true },
};

// 계열 패시브: 2 = 그 계열 기술 2장(숙련), 4 = 4장(각성). 금단 계열은 2장에서 하나
export const PASSIVES = {
  wall2: '방어를 주는 내 기술 +2', wall4: '굳건함이 절반이 아니라 전부 (최대 30)',
  venge2: '막아 낸 피해 5마다 때린 적에게 차단 +1', venge4: '버티기 쿨다운 1턴',
  lead2: '다른 아군에게 주는 방어 +3', lead4: '턴마다 내가 처음 방어를 준 다른 아군은 다음 턴 기력 +1',
  g_dark2: '전투마다 한 번, 쓰러질 때 체력 절반으로 일어난다',
  frenzy2: '체력이 절반 아래면 턴마다 첫 공격 기술 비용 -1', frenzy4: '전투마다 한 번, 쓰러질 피해를 받아도 체력 1로 버티고 다음 턴 기력 +2',
  smash2: '차단이 붙은 내 기술의 차단 +2', smash4: '내가 마지막 칸을 채워 낸 그로기는 한 턴 더 간다',
  gore2: '내가 서 있는 동안 적의 출혈은 턴 끝에 줄지 않는다', gore4: '적이 출혈로 피해를 받을 때마다 내 체력 +2',
  b_dark2: '내가 적을 잡을 때마다 최대 체력 +4',
  rapid2: '한 턴에 4발 이상 쏘면 그 턴 사격 한 발마다 +1', rapid4: '재장전 기력 0',
  snipe2: '한 발도 안 쏜 턴이 끝나면 조준 +1', snipe4: '맞아도 조준이 안 풀린다',
  bomb2: '특수탄이 한 발 더 간다 (4발)', bomb4: '특수탄을 장전할 때마다 탄 +1',
  n_dark2: '탄창 8발',
  grace2: '넘친 회복은 그 턴의 방어도가 된다', grace4: '내 회복 +30%',
  judge2: '신앙이 5 이상이면 내 공격 기술 +3', judge4: '신앙 최대 15, 전투 시작 때 신앙 3',
  bless2: '내가 강화한 아군이 그 턴에 적을 때리면 신앙 +1 (턴마다 2까지)', bless4: '축복 · 용기의 성가 · 가호의 비용 -1',
  p_dark2: '아군이 쓰러질 때마다 신앙 +4, 내 체력 +10',
};

/* ───────── 직업 ───────── */

export const CLASSES = {
  guard: {
    name: '수호자', icon: '🛡', weapon: '검과 큰 방패', hp: 60,
    res: '굳건함', resTip: '남은 방어도의 절반이 다음 턴으로',
    good: '대신 맞아 주기 · 버티기 · 막은 만큼 필살기 끊기', bad: '딜이 제일 낮다 · 광역은 대신 못 맞는다',
    q: { name: '버티기', cd: 2, cost: 0, to: 'self', fx: [['taunt'], ['block', 8]], tip: '이번 턴 적의 단일 공격을 전부 내가 받는다 · 방어 8 (쿨 2턴)' },
    deck: ['slash', 'slash', 'slash', 'raise', 'raise', 'raise', 'raise', 'bash'],
    trees: ['wall', 'venge', 'lead', 'g_dark'],
  },
  berserk: {
    name: '광전사', icon: '🪓', weapon: '양손 도끼', hp: 52,
    res: '피 끓음', resTip: '잃은 체력 10마다 공격 기술 +2',
    good: '깎일수록 폭딜 · 그로기 처형 · 차단도 준수', bad: '방어 기술이 거의 없다 · 회복받으면 약해진다 · 광역이 없다',
    q: { name: '피의 대가', cd: 1, cost: 0, to: 'self', fx: [['hpCost', 5], ['energy', 1]], tip: '체력 -5 · 이번 턴 기력 +1 (쿨 1턴)' },
    deck: ['chop', 'chop', 'chop', 'chop', 'cleave', 'grit', 'grit', 'grit'],
    trees: ['frenzy', 'smash', 'gore', 'b_dark'],
  },
  gunner: {
    name: '거너', icon: '🔫', weapon: '장총과 권총', hp: 38,
    res: '탄창', resTip: '사격은 탄을 쓴다 (6발, 턴이 바뀌어도 남는다). 조준 1마다 다음 한 발 +4',
    good: '한 대상 화력 최고 · 탄창을 비우는 턴의 폭딜', bad: '장전하는 턴은 빈다 · 몸이 약하다 · 맞으면 조준이 풀린다 · 차단이 약하다',
    q: { name: '재장전', cd: 0, cost: 1, to: 'self', fx: [['reload']], tip: '탄창을 가득 (기력 1)' },
    deck: ['shot', 'shot', 'shot', 'shot', 'burst', 'cover', 'cover', 'roll'],
    trees: ['rapid', 'snipe', 'bomb', 'n_dark'],
  },
  priest: {
    name: '사제', icon: '✚', weapon: '성서와 철퇴', hp: 40,
    res: '신앙', resTip: '회복시킨 체력 6마다 +1 (최대 10, 전투가 끝나면 절반)',
    good: '유일한 본격 회복 · 해제 · 부활. 쌓인 신앙을 폭딜로, 또는 남을 세게', bad: '초반 딜이 제일 낮다 · 아무도 안 다치면 신앙이 안 쌓인다 · 몸이 약하다',
    q: { name: '구원', cd: 2, cost: 0, to: 'ally', fx: [['heal', 12], ['cleanse']], tip: '아군 한 명 체력 +12 · 상태이상 해제 (쿨 2턴)' },
    deck: ['mace', 'mace', 'mace', 'lightHeal', 'lightHeal', 'lightHeal', 'prayer', 'lightBolt'],
    trees: ['grace', 'judge', 'bless', 'p_dark'],
  },
};
export const CLASS_KEYS = Object.keys(CLASSES);
export const AMMO = { base: 6, dark: 8 };
export const FAITH = { per: 6, max: 10, maxAwake: 15, start: 3 };

/* ───────── 적 ───────── */

export const ROOMS = [
  { k: 'ghouls', name: '굶주린 망자 떼', tier: 'mob', tip: '숫자로 밀어붙인다. 잡으면 그 망자의 공격은 안 나온다' },
  { k: 'golem', name: '살점 골렘', tier: 'elite', tip: '3턴마다 내려찍기. 끊으면 그로기' },
  { k: 'keeper', name: '무덤지기', tier: 'boss', tip: '묘비를 세우고, 생매장을 준비한다' },
];
export const FOES = {
  ghoul: { name: '굶주린 망자', hp: 22, hit: 6 },
  golem: { name: '살점 골렘', per: 60 },
  keeper: { name: '무덤지기', per: 100 },
  tomb: { name: '묘비', hp: 12, grow: 3 },
  skel: { name: '해골 병사', hp: 10, hit: 5 },
  boss: { name: '마왕' },
};
export const GHOULS = { mult: 1.5, max: 8, pool: 33 }; // 망자 수 = 인원 × 1.5 (최대 8), 체력 합 = 33 × 인원
// 적의 필살기 (예고된 턴 + 2턴 뒤에 터진다. 그 전에 차단 게이지를 채우면 그로기)
export const ULTS = {
  slam: { name: '내려찍기', v: 24, tip: '예고된 사람에게 24 (대신 막아 줄 수 있다)' },
  bury: { name: '생매장', v: 20, stun: true, tip: '전원 20 + 기절 (체력이 깎인 사람만)' },
  doom: { name: '종말', v: 32, tip: '전원 32' },
};

/* ───────── 마왕의 권능 ─────────
   aim: 지목 (원정대 3명당 한 명씩 더 맞는다) · prep: 결과의 맨 처음에 · all: 전원 */
export const POWERS = {
  smite: { name: '강타', cost: 1, aim: true, v: 16, tip: '지목한 한 명에게 16' },
  double: { name: '연격', cost: 1, aim: true, v: 9, rand: 1, tip: '지목한 한 명과 무작위 한 명에게 9씩' },
  sweep: { name: '휩쓸기', cost: 2, all: true, v: 7, tip: '전원 7' },
  curse: { name: '저주', cost: 1, aim: true, tip: '지목한 한 명 약화 + 취약 2턴' },
  drain: { name: '영혼 약탈', cost: 2, aim: true, v: 10, steal: true, tip: '지목한 한 명에게 10, 준 만큼 회복' },
  armor: { name: '어둠의 갑옷', cost: 1, prep: true, tip: '이번 턴 받는 피해 절반' },
  veil: { name: '어둠의 장막', cost: 0, veil: true, tip: '같이 낸 다른 권능 한 장의 예고를 ?로 가린다 (V)' },
  doom: { name: '종말', cost: 4, doom: true, v: 32, tip: '2턴 준비, 못 끊으면 전원 32. 끊기면 마왕 그로기' },
  rampart: { cls: 'guard', name: '성벽', cost: 1, prep: true, tip: '방어 + 원정대 수 × 6' },
  shieldBreak: { cls: 'guard', name: '방패 분쇄', cost: 2, aim: true, tip: '지목한 한 명에게 내 방어도만큼 피해' },
  jail: { cls: 'guard', name: '가두기', cost: 1, aim: true, prep: true, tip: '지목한 한 명이 이번 턴 주는 방어 · 회복은 자기에게만 간다' },
  spikes: { cls: 'guard', name: '가시', cost: 1, prep: true, tip: '이번 턴 나를 때린 사람마다 5' },
  butcher: { cls: 'berserk', name: '도륙', cost: 2, aim: true, v: 22, tip: '지목 22' },
  rampage: { cls: 'berserk', name: '광란', cost: 1, v: 6, hits: 3, tip: '무작위로 6 세 번' },
  roar: { cls: 'berserk', name: '피의 포효', cost: 1, prep: true, tip: '전원 이번 턴 취약' },
  feast: { cls: 'berserk', name: '포식', cost: 2, aim: true, v: 12, steal: true, tip: '지목 12, 준 만큼 회복' },
  markShot: { cls: 'gunner', name: '표적 지정', cost: 1, aim: true, v: 30, later: true, tip: '한 명에게 표식, 다음 턴 그 사람에게 30' },
  rapidFire: { cls: 'gunner', name: '속사', cost: 1, aim: true, v: 5, times: 4, tip: '지목 5 네 번' },
  legShot: { cls: 'gunner', name: '다리 쏘기', cost: 1, aim: true, v: 8, sap: 1, tip: '지목 8 + 다음 턴 기력 -1' },
  ricochet: { cls: 'gunner', name: '도탄', cost: 2, aim: true, v: 12, others: 6, tip: '지목 12, 다른 두 명에게 6' },
  plagueB: { cls: 'priest', name: '역병', cost: 1, all: true, bleed: 3, tip: '전원 출혈 3' },
  raise: { cls: 'priest', name: '죽은 자 일으키기', cost: 2, summon: 2, tip: '해골 병사 둘 (체력 10, 매 턴 아무나 5)' },
  siphon: { cls: 'priest', name: '생명 흡수', cost: 2, aim: true, v: 10, steal: true, tip: '지목 10, 준 만큼 회복' },
  falseBless: { cls: 'priest', name: '거짓 축복', cost: 1, aim: true, prep: true, tip: '지목한 한 명이 이번 턴 받는 회복이 전부 피해가 된다' },
};
export const POWER_DECK = {
  common: ['smite', 'smite', 'double', 'double', 'sweep', 'curse', 'drain', 'armor', 'veil', 'doom'],
  guard: ['rampart', 'shieldBreak', 'jail', 'spikes'],
  berserk: ['butcher', 'rampage', 'roar', 'feast'],
  gunner: ['markShot', 'rapidFire', 'legShot', 'ricochet'],
  priest: ['plagueB', 'raise', 'siphon', 'falseBless'],
};
export const BOSSES = {
  guard: { name: '무너지지 않는 성', passive: '턴 시작마다 방어 + 원정대 수 × 4, 절반은 다음 턴으로', answer: '방어도가 쌓이기 전에 몰아치기 · 방어 무시' },
  berserk: { name: '피에 미친 것', passive: '잃은 체력 20%마다 피해 +10%', answer: '후반이 위험하다 → 그로기에 한꺼번에' },
  gunner: { name: '마탄의 사수', passive: '지목 공격은 방어도의 절반을 무시', answer: '표식 찍힌 사람을 다 같이 막아 준다' },
  priest: { name: '역병의 성자', passive: '턴 끝마다 체력 + 원정대 수 × 2', answer: '오래 끌면 진다 → 출혈 해제 · 해골 정리 · 폭딜' },
  king: { name: '이름 없는 왕', passive: '없음 (공통 권능만)', answer: '종말만 끊으면 된다' },
};

/* ───────── 칭호 ───────── */

export const TITLE_NAMES = {
  slayer: '👑 마왕 토벌', reign: '😈 마왕 강림', wall: '🛡️ 철벽', life: '✚ 생명줄', meter: '⚔️ 딜 미터기',
  thief: '🗡️ 막타 도둑', awake: '🎓 각성', dirty: '🩸 손이 검다', clean: '🕊️ 깨끗한 손',
};
