"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ITINERARY_OBSERVER_THRESHOLDS,
  ITINERARY_SECTION_OBSERVER_ROOT_MARGIN,
  ITINERARY_SECTION_SCROLL_MARGIN_PX,
  lockScrollSpy,
  revealInHorizontalScroller,
} from "./scroll";

export interface ItineraryNavSection {
  id: string;
  label: string;
}

/**
 * Sticky quick-nav pills for the itinerary page. Uses IntersectionObserver
 * to reflect the currently visible section so users always know where they
 * are. Horizontally scrollable on mobile; centered on desktop.
 */
export default function ItinerarySectionNav({
  sections,
}: {
  sections: ItineraryNavSection[];
}) {
  const [activeId, setActiveId] = useState<string | null>(
    sections[0]?.id ?? null,
  );
  const activeBtnRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const activeIdRef = useRef<string | null>(activeId);
  const scrollSpyLockUntilRef = useRef(0);

  const updateActiveId = useCallback((nextId: string) => {
    if (nextId === activeIdRef.current) return;
    activeIdRef.current = nextId;
    setActiveId(nextId);
  }, []);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    const syncFromHash = () => {
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      if (sections.some((section) => section.id === hash)) {
        updateActiveId(hash);
      }
    };

    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [sections, updateActiveId]);

  useEffect(() => {
    const ids = sections.map((s) => s.id);
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (elements.length === 0) return;

    const visible = new Map<string, { top: number; ratio: number }>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.set(entry.target.id, {
              top: entry.boundingClientRect.top,
              ratio: entry.intersectionRatio,
            });
          } else {
            visible.delete(entry.target.id);
          }
        }
        if (visible.size === 0) return;
        if (performance.now() < scrollSpyLockUntilRef.current) return;

        const visibleSections = sections
          .map((section) => {
            const entry = visible.get(section.id);
            return entry ? { id: section.id, ...entry } : null;
          })
          .filter(
            (entry): entry is { id: string; top: number; ratio: number } =>
              Boolean(entry),
          );
        if (visibleSections.length === 0) return;

        const activationLine = ITINERARY_SECTION_SCROLL_MARGIN_PX + 12;
        const activeSection =
          visibleSections
            .filter((entry) => entry.top <= activationLine)
            .at(-1) ??
          [...visibleSections].sort((left, right) => {
            const topDistance =
              Math.abs(left.top - activationLine) -
              Math.abs(right.top - activationLine);
            if (topDistance !== 0) return topDistance;
            return right.ratio - left.ratio;
          })[0];

        if (activeSection) {
          updateActiveId(activeSection.id);
        }
      },
      {
        // Bias the trigger line toward the upper portion of the viewport so
        // the nav updates as a section's top nears the header, not only
        // when its center crosses.
        rootMargin: ITINERARY_SECTION_OBSERVER_ROOT_MARGIN,
        threshold: ITINERARY_OBSERVER_THRESHOLDS,
      },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections, updateActiveId]);

  useEffect(() => {
    if (!activeId) return;
    const btn = activeBtnRefs.current[activeId];
    if (!btn) return;
    revealInHorizontalScroller(btn);
  }, [activeId]);

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    const target = document.getElementById(id);
    if (!target) {
      event.preventDefault();
      return;
    }
    lockScrollSpy(scrollSpyLockUntilRef);
    updateActiveId(id);
  }

  return (
    <nav
      aria-label="Itinerary sections"
      className="sticky top-[62px] z-30 -mx-5 sm:-mx-6 mt-8 border-y border-[var(--hairline)] bg-[rgba(250,248,243,0.82)] backdrop-blur-md supports-[backdrop-filter]:bg-[rgba(250,248,243,0.7)]"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="relative itinerary-strip-shell">
          <ul
            role="list"
            className="itinerary-horizontal-strip flex gap-1 overflow-x-auto py-2.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {sections.map((section) => {
              const active = section.id === activeId;
              return (
                <li key={section.id} className="shrink-0">
                  <a
                    ref={(el) => {
                      activeBtnRefs.current[section.id] = el;
                    }}
                    href={`#${section.id}`}
                    onClick={(event) => handleClick(event, section.id)}
                    aria-current={active ? "location" : undefined}
                    data-active={active}
                    className="nav-pill"
                  >
                    {section.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}
