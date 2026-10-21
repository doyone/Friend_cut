# 친구컷 ✂️ — 우정파괴 미니게임 모음

친구 4~8명이 각자 노트북으로 같이 하는 웹 미니게임 모음이에요.
설치 없이 **링크만 공유**하면 되고, 서버를 직접 만들 필요도 없어요.

| 게임 | 인원 | 설명 |
|---|---|---|
| ⏱️ 초세기 서바이벌 | 2~8명 | 1~12초 랜덤 목표를 속으로 세고 스페이스. 꼴찌부터 공개, 아래쪽은 한 번에 탈락 |
| 💣 폭탄 돌리기 | 3~8명 | 방향키 콤보를 쳐야 폭탄을 넘길 수 있음. 누구한테 던질지는 숫자키로 |
| 🧱 독박 타워 | 2~8명 | 물리 블록 쌓기. 블록은 🎰 룰렛, 한 판에 한 번 😈 악마 카드로 다음 사람 저주. 떨어뜨리면 탈락 |
| ⚡ 반응속도 대결 | 2~8명 | 초록불이 뜨면 먼저 스페이스. 미리 누르면 감점, 2라운드부터 가짜 신호 등장 |
| 🕵️ 라이어 게임 | 3~8명 | 한 명만 제시어를 몰라요. 한 줄 힌트를 글로 쓰고 투표 (말 안 해도 됨) |

기획과 앞으로 만들 게임은 [기획서.md](기획서.md)에 있어요.

### 조작 (마우스 거의 안 씀)

- **Enter**: 어디서든 채팅 · **Esc**: 채팅 닫기 · 채팅창이 비어 있을 때 **숫자키 1~6**: 빠른 도발
- 로비: **← → / 숫자키**로 게임 고르기, **스페이스**로 시작(방장) 또는 투표(참가자)
- 결과 화면: **R** 한 판 더, **L** 다른 게임(방장) · 1등은 **숫자키**로 꼴찌 얼굴에 붙일 스티커 선택

구조: **GitHub Pages**(게임 파일 무료 호스팅) + **Firebase Realtime Database**(실시간 통신, 무료 플랜)

---

## 1. 내 컴퓨터에서 먼저 해보기 (로컬 테스트 모드)

`js/config.js`가 비어 있으면(`null`) 로컬 테스트 모드로 돌아가요.
**같은 컴퓨터의 브라우저 탭끼리만** 연결되고, 탭 하나가 플레이어 한 명이에요.

```bash
python serve.py
```

브라우저에서 `http://localhost:8123` 를 열어 보세요.
(`python -m http.server`도 되지만, 브라우저가 옛날 파일을 기억해서 코드를 고쳐도 새로고침에 안 바뀔 때가 있어요. `serve.py`는 그걸 막아 줘요.)
`index.html`을 더블클릭해서 열면 동작하지 않아요(자바스크립트 모듈 때문에 서버가 필요).

### 혼자 테스트하기 (🤖 봇)

1. 닉네임 쓰고 Enter → 방이 만들어져요
2. 로비에서 **B**를 누를 때마다 봇이 한 명씩 들어와요 (**Shift+B** 빼기, 사이드바의 ✕로도 빼기)
3. 게임 고르고 **스페이스**로 시작 → 봇들이 알아서 플레이·도발·스티커까지 해요

봇은 방장 노트북이 대신 움직여요. 친구가 모자랄 때 실제 게임에서도 쓸 수 있어요.
여러 명 시점을 직접 보고 싶으면 탭을 여러 개 열면 돼요 (탭 하나 = 한 명, 닫은 탭은 90초 안에 자동으로 빠져요).

## 2. Firebase 연결하기 (친구들이랑 진짜로 하기)

1. https://console.firebase.google.com 에서 구글 계정으로 로그인 → **프로젝트 만들기**
   (이름은 아무거나, Google 애널리틱스는 꺼도 돼요)
2. 왼쪽 메뉴 **빌드 → Realtime Database → 데이터베이스 만들기**
   - 위치: **싱가포르 (asia-southeast1)**: 한국에서 제일 가까워요
   - **잠금 모드로 시작** 선택
3. **규칙** 탭에 이 폴더의 `database.rules.json` 내용을 붙여넣고 **게시**
4. 톱니바퀴 → **프로젝트 설정 → 내 앱 → 웹(`</>`) 아이콘**으로 앱 등록
   → 화면에 나오는 `firebaseConfig = { ... }` 값을 `js/config.js`에 붙여넣기
   - `databaseURL`이 꼭 있어야 해요. 없으면 Realtime Database 화면 위쪽의 주소(`https://...firebasedatabase.app`)를 직접 넣어 주세요
5. 다시 열었을 때 노란 "로컬 테스트 모드" 안내가 사라지면 성공

무료 플랜(Spark): 동시 접속 100명, 저장 1GB, 다운로드 월 10GB까지예요. 한 반이 쓰기엔 충분해요.

> `apiKey`는 비밀번호가 아니라 공개돼도 되는 값이에요. 대신 규칙상 링크를 아는 사람은 누구나 방을 만들고 쓸 수 있으니, 친구끼리만 쓰는 용도로 생각하세요.
> Firebase 설정이 있어도 주소 끝에 `?local`을 붙이면 로컬 테스트 모드로 열려요.

## 3. GitHub Pages에 올리기

1. GitHub에서 새 저장소(**Public**) 만들기, 예: `friendcut`
2. 이 폴더의 파일을 올리기 (웹에서 **Add file → Upload files**로 끌어다 놓아도 돼요. `.claude` 폴더는 안 올려도 됨)
3. 저장소 **Settings → Pages** → Source: **Deploy from a branch**, Branch: **main / (root)** → Save
4. 1~2분 뒤 `https://내아이디.github.io/friendcut/` 로 접속
5. 방 만들기 → **초대 링크 복사** → 단톡방에 공유 (링크에 방 코드가 들어 있어요)

## 학교에서 미리 확인할 것

- 학교 와이파이에서 `github.io` 와 `firebasedatabase.app` 이 열리는지 한 번 접속해 보세요.
  막혀 있으면 Netlify / Cloudflare Pages 같은 다른 무료 호스팅으로 옮기면 돼요.
- 방장 노트북이 게임 규칙을 돌려요. 방장이 나가거나 와이파이가 끊기면 가장 먼저 들어온 사람이 자동으로 방장을 이어받고, 게임도 그대로 이어져요.
- 새로고침해도 같은 사람으로 다시 들어와요(탭을 닫으면 새 사람).

---

## 폴더 구조

```
index.html
css/style.css
js/
  config.js        ← Firebase 설정 붙여넣는 곳
  main.js          홈 · 로비 · 게임 화면 전환
  room.js          방 만들기/입장, 방장 이어받기
  host.js          방장 컴퓨터에서 게임 규칙을 돌리는 엔진
  ui.js            점수판, 타이머 같은 공통 화면 조각
  util.js
  net/             통신 (firebase.js = 실제, local.js = 탭끼리 테스트용)
  games/
    index.js       ← 게임 목록. 새 게임은 여기에 추가
    reaction.js    반응속도 대결
    liar.js        라이어 게임
database.rules.json  Firebase 보안 규칙
```

## 새 게임 만들기

`js/games/` 에 파일을 하나 만들고 `games/index.js`의 `GAMES`에 추가하면 로비에 나타나요.
**방장 컴퓨터가 규칙(setup / onInput / tick)을 돌리고**, 모두가 그 결과(state)를 받아서 화면(mount)을 그리는 구조예요.

```js
export default {
  id: 'mygame', title: '내 게임', emoji: '🎯', tag: '우정파괴', // 태그: 우정파괴 | 협동 | 보드
  desc: '로비 카드에 나오는 설명',
  minPlayers: 2, maxPlayers: 8,

  // 방장만 실행. 처음 state를 돌려준다.
  // ctx.roster: 참가자 [{id, name, color}], ctx.now(): 서버 시각
  // ctx.secret: 방장만 아는 값(정답 등), ctx.setPrivate(id, data): 그 사람에게만 보이는 값
  // prev: '한 판 더'를 눌렀을 때 이전 판의 { state, secret } (점수 이어가기용)
  setup(ctx, prev) { return { phase: 'play', scores: {} }; },

  // 누군가 api.send(type, data)를 하면 방장에게 도착. 바뀐 게 있으면 true
  // ctx.announce(글): 채팅에 시스템 메시지 · ctx.kill(죽인 사람, 죽은 사람, '설명'): 킬로그+원수 기록
  // ctx.nameOf(id): 이름
  onInput(ctx, { pid, type, data }) { return false; },

  // 0.1초마다 방장에게서 실행. 마감 시간 체크 등. 바뀐 게 있으면 true
  tick(ctx) { return false; },

  // (선택) 봇: 0.1초마다 봇마다 불린다. 할 행동을 { type, data } 로 돌려주면 그 봇이 보낸 입력처럼 처리돼요.
  // say: true 를 붙이면 빠른 도발 중 하나를 채팅에 날려요. mem은 봇마다 따로 쓰는 메모장.
  bot(ctx, botId, mem) { return null; },

  // 모든 사람 화면. state가 바뀔 때마다 update가 불린다
  // api.me: 내 id, api.now(): 서버 시각, api.send(type, data): 방장에게 입력 보내기
  mount(el, api) {
    return { update({ state, priv }) {}, unmount() {} };
  },
};
```

규칙 몇 가지:

- 게임이 끝나면 `state.over = true` → 결과 화면이 떠요. 순위는 `state.standings`(클수록 1등, 없으면 `state.scores`)로 매기고, 오늘 점수 지급·꼴찌 스티커는 공통으로 처리돼요.
- 칭호는 `state.titles = { [id]: ['⚡ 번개손'] }` 처럼 넣으면 결과 화면에 나와요. 꼴찌에게는 '🤡 이번 판 호구'가 자동으로 붙어요.
- 조작은 키보드로: `Enter`는 채팅 전용이니 쓰지 말고, 글자 키는 `e.code`로 판정하세요. 고르기 화면은 `ui.js`의 `keyNav(버튼들)`을 쓰면 방향키·스페이스·숫자키가 한 번에 돼요.
- 타이머는 `setTimeout` 대신 **`state`에 마감 시각(`ctx.now() + 30000`)을 적어 두고 `tick`에서 확인**하세요. 그래야 방장이 바뀌어도 이어져요. 화면의 남은 시간 막대는 `ui.js`의 `countdown(마감시각, 전체ms)`.
- Firebase는 빈 배열·빈 객체·`null`을 저장하지 않아요. 읽을 때는 `state.taps || {}` 처럼 비어 있을 수 있다고 생각하고 쓰세요.
- 사람마다 숨겨야 하는 정보(라이어 여부 등)는 `ctx.setPrivate`, 아무에게도 보이면 안 되는 정답은 `ctx.secret`에 두세요.
