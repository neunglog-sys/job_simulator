/** 한국어 조사(助詞) — 앞 글자 받침에 따라 형태가 갈린다.
 *
 * 이름·직무명 같은 동적 값에 조사를 문자열로 박아두면 절반은 틀린다
 * ("조도윤와 대화하기", "개발자을 상징하는"). 값을 받아 맞는 쪽을 고르게 한다.
 *
 * 판정은 마지막 **한글 음절**의 종성으로 한다. 한글이 아닌 문자로 끝나면
 * (영문·숫자·기호) 받침을 알 수 없으므로 받침 없음으로 본다 — 조사 없이
 * 읽히는 편이 틀린 조사보다 덜 어색하다.
 */

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const JONGSEONG_COUNT = 28;

/** 마지막 한글 음절에 받침이 있는가. 한글로 끝나지 않으면 null(판정 불가). */
export function hasFinalConsonant(word: string): boolean | null {
  for (let i = word.length - 1; i >= 0; i -= 1) {
    const code = word.charCodeAt(i);
    if (code >= HANGUL_START && code <= HANGUL_END) {
      return (code - HANGUL_START) % JONGSEONG_COUNT !== 0;
    }
  }
  return null;
}

/** 받침 유무로 조사를 고른다. 판정 불가면 받침 없는 쪽(뒤 인자)을 쓴다. */
function pick(word: string, withFinal: string, withoutFinal: string): string {
  return hasFinalConsonant(word) === true ? withFinal : withoutFinal;
}

/** "조도윤과" / "오건우와" */
export function withGwa(word: string): string {
  return `${word}${pick(word, "과", "와")}`;
}

/** "개발자를" / "직무 행성을" */
export function withEul(word: string): string {
  return `${word}${pick(word, "을", "를")}`;
}

/** "내 정보는" / "1:1 직무 상담은" */
export function withNeun(word: string): string {
  return `${word}${pick(word, "은", "는")}`;
}

/** "이력서가" / "포트폴리오가" */
export function withGa(word: string): string {
  return `${word}${pick(word, "이", "가")}`;
}
