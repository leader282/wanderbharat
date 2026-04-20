const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export const ITINERARY_SECTION_SCROLL_MARGIN_PX = 132;
export const ITINERARY_DAY_SCROLL_MARGIN_PX = 168;
export const ITINERARY_SCROLL_SPY_LOCK_MS = 420;
export const ITINERARY_OBSERVER_THRESHOLDS = [0, 0.2, 0.5, 0.82];
export const ITINERARY_SECTION_OBSERVER_ROOT_MARGIN = `-${ITINERARY_SECTION_SCROLL_MARGIN_PX}px 0px -52% 0px`;
export const ITINERARY_DAY_OBSERVER_ROOT_MARGIN = `-${ITINERARY_DAY_SCROLL_MARGIN_PX}px 0px -48% 0px`;

export function prefersReducedMotion(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }

  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function getSafeScrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

export function getScrollSpyLockDuration(): number {
  return prefersReducedMotion() ? 0 : ITINERARY_SCROLL_SPY_LOCK_MS;
}

export function lockScrollSpy(lockRef: { current: number }): void {
  if (typeof window === "undefined") {
    lockRef.current = 0;
    return;
  }

  lockRef.current = window.performance.now() + getScrollSpyLockDuration();
}

export function revealInHorizontalScroller(target: HTMLElement): void {
  const scroller = target.closest(".itinerary-horizontal-strip");
  if (!(scroller instanceof HTMLElement)) return;

  const scrollerRect = scroller.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const targetCenter =
    scroller.scrollLeft +
    (targetRect.left - scrollerRect.left) +
    targetRect.width / 2;
  const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  const nextScrollLeft = Math.min(
    maxScrollLeft,
    Math.max(0, targetCenter - scroller.clientWidth / 2),
  );

  // Avoid scrollIntoView here: the trip ribbon sits above the timeline, and
  // vertical page scrolling can jump the reader back upward while the active
  // day/stop changes.
  scroller.scrollTo({
    behavior: "auto",
    left: nextScrollLeft,
  });
}
