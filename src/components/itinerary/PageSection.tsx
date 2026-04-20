import { ITINERARY_SECTION_SCROLL_MARGIN_PX } from "@/components/itinerary/scroll";

export default function PageSection({
  id,
  children,
  className = "",
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      style={{ scrollMarginTop: `${ITINERARY_SECTION_SCROLL_MARGIN_PX}px` }}
      className={`mt-12 md:mt-16 ${className}`.trim()}
    >
      {children}
    </section>
  );
}
