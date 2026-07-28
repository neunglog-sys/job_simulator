import { Fragment, type ReactNode } from "react";

/** 굵게(**…**, *…*)를 <strong>으로 바꿔 반환. 마크다운 전체가 아니라 이 표기만 다룬다. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // 짝이 맞는 별표만 강조로 본다 — 짝이 없으면 원문 그대로 남아 별표가 사라지지 않는다.
  const pattern = /\*\*(?=\S)([\s\S]*?\S)\*\*|\*(?=\S)([^*\n]*?\S)\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(<strong key={`${keyPrefix}-b${match.index}`}>{match[1] ?? match[2]}</strong>);
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * 상담 말풍선용 경량 텍스트 렌더러.
 *
 * 상담 프롬프트는 미해결 대응 형식에서 **굵은 라벨**과 번호·불릿 목록을 의도적으로 쓴다
 * (data/prompts/avatar/system.md). 예전엔 content를 그대로 출력해 별표가 화면에 그대로
 * 보였다 — 마크다운 라이브러리를 새로 들이는 대신 실제로 쓰이는 표기(굵게·줄바꿈·불릿)만
 * 처리한다. HTML 문자열을 만들지 않으므로(dangerouslySetInnerHTML 미사용) 주입 위험이 없다.
 */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, index) => {
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        const body = bullet ? bullet[1] : line;
        return (
          <Fragment key={index}>
            {index > 0 ? <br /> : null}
            {bullet ? "· " : null}
            {renderInline(body, String(index))}
          </Fragment>
        );
      })}
    </>
  );
}
