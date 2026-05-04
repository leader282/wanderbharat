import Link from "next/link";
import { notFound } from "next/navigation";

import ItineraryBudgetPanel from "@/components/ItineraryBudgetPanel";
import ItineraryMap from "@/components/ItineraryMap";
import DayTimeline from "@/components/itinerary/DayTimeline";
import { ArrowLeftIcon } from "@/components/itinerary/icons";
import ItineraryFootnote from "@/components/itinerary/ItineraryFootnote";
import ItineraryHero from "@/components/itinerary/ItineraryHero";
import ItineraryNotices from "@/components/itinerary/ItineraryNotices";
import ItinerarySectionNav, {
  type ItineraryNavSection,
} from "@/components/itinerary/ItinerarySectionNav";
import PageSection from "@/components/itinerary/PageSection";
import StaysOverview from "@/components/itinerary/StaysOverview";
import TripProgressRibbon from "@/components/itinerary/TripProgressRibbon";
import TripStatsGrid from "@/components/itinerary/TripStatsGrid";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessItinerary } from "@/lib/itinerary/itineraryAccess";
import {
  buildProgressStops,
  buildStayByDayIndex,
  buildStayEntries,
  deriveItineraryStats,
  prepareDayPlan,
} from "@/lib/itinerary/pageModel";
import { getAccommodations } from "@/lib/repositories/accommodationRepository";
import { getItinerary } from "@/lib/repositories/itineraryRepository";
import { getItineraryMapData } from "@/lib/services/itineraryMapService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAV_SECTIONS: ItineraryNavSection[] = [
  { id: "overview", label: "Overview" },
  { id: "timeline", label: "Timeline" },
  { id: "stays", label: "Stays" },
  { id: "budget", label: "Budget" },
  { id: "map", label: "Map" },
];

export default async function ItineraryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const itinerary = await getItinerary(id);
  if (!itinerary) notFound();
  const currentUser = await getCurrentUser();
  if (
    !canAccessItinerary({
      itineraryUserId: itinerary.user_id,
      requesterUserId: currentUser?.uid,
    })
  ) {
    notFound();
  }

  const stayAccommodationIds = itinerary.stays
    .map((stay) => stay.accommodationId)
    .filter((accId): accId is string => Boolean(accId));
  const accommodationsPromise = getAccommodations(stayAccommodationIds);
  const mapDataPromise = getItineraryMapData(itinerary, {
    getAccommodations: async () => accommodationsPromise,
  });
  const [accommodations, mapData] = await Promise.all([
    accommodationsPromise,
    mapDataPromise,
  ]);

  const stats = deriveItineraryStats(itinerary);
  const stayEntries = buildStayEntries(itinerary, accommodations);
  const stayByDayIndex = buildStayByDayIndex(stayEntries);
  const preparedDays = prepareDayPlan({
    itinerary,
    stayByDayIndex,
    startTime: itinerary.preferences.preferred_start_time,
  });
  const progressStops = buildProgressStops({
    itinerary,
    stays: itinerary.stays,
  });
  const currency = itinerary.preferences.budget.currency ?? "INR";
  const dayOptions = itinerary.day_plan.map((day) => ({
    day_index: day.day_index,
    label: `Day ${day.day_index + 1}`,
  }));

  return (
    <section className="mt-8 md:mt-10">
      <Link
        href="/plan"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink-700)] transition-colors hover:text-[var(--color-ink-900)] hover:-translate-x-px"
      >
        <ArrowLeftIcon size={14} />
        Back to planner
      </Link>

      <ItineraryHero itinerary={itinerary} stats={stats} />

      <ItineraryNotices warnings={itinerary.warnings} />

      <ItinerarySectionNav sections={NAV_SECTIONS} />

      <PageSection id="overview">
        <div className="mb-6">
          <p className="eyebrow">At a glance</p>
          <h2 className="mt-3 text-2xl md:text-3xl font-bold tracking-tight text-[var(--color-ink-900)]">
            The shape of your trip
          </h2>
          <p className="mt-2 max-w-2xl text-[var(--color-ink-500)]">
            The numbers that define this journey, and the stops it flows
            through.
          </p>
        </div>
        <TripStatsGrid itinerary={itinerary} stats={stats} />
        <div className="mt-6">
          <TripProgressRibbon
            key={progressStops
              .map((stop) => `${stop.id}:${stop.dayIndices.join(",")}`)
              .join("|")}
            stops={progressStops}
          />
        </div>
      </PageSection>

      <PageSection id="timeline">
        <DayTimeline
          key={preparedDays
            .map((prepared) => String(prepared.day.day_index))
            .join(",")}
          preparedDays={preparedDays}
          currency={currency}
          startTime={itinerary.preferences.preferred_start_time}
          attractionLineItems={
            itinerary.budget_breakdown?.line_items.filter(
              (lineItem) => lineItem.kind === "attraction",
            ) ?? []
          }
        />
      </PageSection>

      <PageSection id="stays">
        <StaysOverview entries={stayEntries} currency={currency} />
      </PageSection>

      <PageSection id="budget">
        <ItineraryBudgetPanel
          itineraryId={itinerary.id}
          estimatedCost={itinerary.estimated_cost}
          requestedBudget={itinerary.preferences.budget}
          travellers={itinerary.preferences.travellers}
          tripDays={itinerary.days}
          breakdown={itinerary.budget_breakdown}
        />
      </PageSection>

      <PageSection id="map">
        <div>
          <p className="eyebrow">Map</p>
          <h2 className="mt-3 text-2xl md:text-3xl font-bold tracking-tight text-[var(--color-ink-900)]">
            Your route on the map
          </h2>
          <p className="mt-2 max-w-2xl text-[var(--color-ink-500)]">
            Travel legs, city stops, stays, and the things to do each day — all
            in one view.
          </p>
          <div className="mt-5">
            <ItineraryMap data={mapData} dayOptions={dayOptions} />
          </div>
        </div>
      </PageSection>

      <ItineraryFootnote />
    </section>
  );
}
