import { useLayoutEffect, useState, type RefObject } from "react";
import styles from "../../styles/oneToOneConversation.module.css";

type GlassScrollbarProps = {
  viewportRef: RefObject<HTMLElement | null>;
  className: string;
  refreshKey: string | number;
};

type ScrollMetrics = {
  visible: boolean;
  thumbHeight: number;
  thumbTop: number;
};

const INITIAL_METRICS: ScrollMetrics = {
  visible: false,
  thumbHeight: 100,
  thumbTop: 0,
};

export function GlassScrollbar({
  viewportRef,
  className,
  refreshKey,
}: GlassScrollbarProps) {
  const [metrics, setMetrics] = useState(INITIAL_METRICS);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateMetrics = () => {
      const maximumScroll = viewport.scrollHeight - viewport.clientHeight;
      if (maximumScroll <= 1) {
        setMetrics(INITIAL_METRICS);
        return;
      }

      const thumbHeight = Math.max(10, (viewport.clientHeight / viewport.scrollHeight) * 100);
      const thumbTop = (viewport.scrollTop / maximumScroll) * (100 - thumbHeight);
      setMetrics({ visible: true, thumbHeight, thumbTop });
    };

    updateMetrics();
    const animationFrame = window.requestAnimationFrame(updateMetrics);
    viewport.addEventListener("scroll", updateMetrics, { passive: true });

    const resizeObserver = new ResizeObserver(updateMetrics);
    resizeObserver.observe(viewport);
    if (viewport.firstElementChild) resizeObserver.observe(viewport.firstElementChild);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      viewport.removeEventListener("scroll", updateMetrics);
      resizeObserver.disconnect();
    };
  }, [refreshKey, viewportRef]);

  return (
    <div
      className={`${styles.glassScrollbar} ${className} ${
        metrics.visible ? styles.glassScrollbarVisible : ""
      }`}
      aria-hidden="true"
    >
      <span
        style={{
          height: `${metrics.thumbHeight}%`,
          top: `${metrics.thumbTop}%`,
        }}
      />
    </div>
  );
}
