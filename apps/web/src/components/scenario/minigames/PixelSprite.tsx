import { useEffect, useState } from "react";

/**
 * 도트 스프라이트 — public/assets/minigames/<sprite-id>.svg 를 그리고,
 * 파일이 없으면 지금처럼 라벨 칩으로 폴백한다.
 *
 * 스프라이트 파일 규격 (도트 SVG):
 *  - viewBox = 논리 픽셀 그리드(예: "0 0 16 12"), 픽셀 1칸 = 1 유닛 <rect>
 *  - <svg shape-rendering="crispEdges"> — 확대해도 픽셀 경계가 뭉개지지 않음
 *  - 그라데이션·블러 금지, 스프라이트당 색 8개 이하, 굵은 외곽선
 *  - 파일명 = 데이터의 sprite id 그대로(한글 포함) — 새 아트를 넣으면 코드 수정
 *    없이 즉시 반영된다
 */
type PixelSpriteProps = {
  id: string;
  /** 폴백 칩과 alt 에 쓸 사람용 라벨 — 없으면 id */
  label?: string;
  /** 표시 폭(px). 높이는 스프라이트 비율을 따른다 */
  size?: number;
  /** 폴백 칩에 적용할 클래스(기존 라벨 마커 스타일 유지용) */
  fallbackClassName?: string;
  /** 카툰·일러스트 SVG처럼 픽셀 보간이 필요 없는 자산은 부드럽게 렌더한다. */
  smooth?: boolean;
};

export function PixelSprite({ id, label, size = 56, fallbackClassName, smooth = false }: PixelSpriteProps) {
  const [extension, setExtension] = useState<"webp" | "svg">("webp");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setExtension("webp");
    setFailed(false);
  }, [id]);
  if (!id || failed) {
    return <span className={fallbackClassName}>{label ?? id}</span>;
  }
  return (
    <img
      src={`${import.meta.env.BASE_URL}assets/minigames/${encodeURIComponent(id)}.${extension}`}
      alt={label ?? id}
      width={size}
      style={{ imageRendering: smooth || extension === "webp" ? "auto" : "pixelated", height: "auto", display: "block" }}
      draggable={false}
      onError={() => {
        if (extension === "webp") setExtension("svg");
        else setFailed(true);
      }}
    />
  );
}
