import { useEffect, type RefObject } from "react";

export function useAutoHideScrollbar(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
) {
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    let hideTimer: ReturnType<typeof window.setTimeout> | undefined;
    const onScroll = () => {
      element.classList.add("is-scrolling");
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        element.classList.remove("is-scrolling");
      }, 1200);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      window.clearTimeout(hideTimer);
      element.classList.remove("is-scrolling");
    };
  }, [ref, enabled]);
}
