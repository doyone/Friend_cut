import { firebaseConfig } from '../config.js';

// 주소 끝에 ?local 을 붙이면 Firebase 설정이 있어도 로컬 모드로 테스트할 수 있다.
export async function connect() {
  const forceLocal = new URLSearchParams(location.search).has('local');
  if (firebaseConfig && !forceLocal) {
    const { createFirebaseNet } = await import('./firebase.js');
    return createFirebaseNet(firebaseConfig);
  }
  const { createLocalNet } = await import('./local.js');
  return createLocalNet();
}
