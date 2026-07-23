import { useEffect, useState } from "react";
import { fetchPolicyCard, type PolicyCard } from "./api";

// 카드와 '더 알아보기' 모달이 같은 결과를 보여줘야 하고(본문에 없는 제도가 목록에 뜨면 안 된다),
// 조회가 정부 API + 문구 생성이라 비싸다. 그래서 요청을 모듈 단위로 한 번만 띄우고 공유한다.
let inflight: Promise<PolicyCard> | null = null;

function loadOnce(): Promise<PolicyCard> {
  if (!inflight) {
    // 실패는 캐시하지 않는다 — 다음 화면 진입에서 다시 시도할 수 있게.
    inflight = fetchPolicyCard().catch((error) => {
      inflight = null;
      throw error;
    });
  }
  return inflight;
}

/** 조건에 맞는 제도 카드. 아직 로딩 중이거나 실패하면 null (호출부는 기본 문구를 쓴다). */
export function usePolicyCard(): PolicyCard | null {
  const [card, setCard] = useState<PolicyCard | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadOnce()
      .then((res) => {
        if (!cancelled) setCard(res);
      })
      .catch(() => undefined); // 카드가 안 뜰 뿐, 상담 흐름은 막지 않는다
    return () => {
      cancelled = true;
    };
  }, []);

  return card?.available ? card : null;
}
