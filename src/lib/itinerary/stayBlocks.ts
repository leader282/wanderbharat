import type { ItineraryDay } from "@/types/domain";

export interface StayBlock {
  nodeId: string;
  nodeName: string;
  startDay: number;
  endDay: number;
  nights: number;
  days: ItineraryDay[];
}

export function deriveStayBlocks(days: ItineraryDay[]): StayBlock[] {
  if (days.length === 0) return [];

  const orderedDays = [...days].sort((left, right) => left.day_index - right.day_index);
  const blocks: StayBlock[] = [];

  for (const day of orderedDays) {
    const current = blocks[blocks.length - 1];
    if (current && current.nodeId === day.base_node_id) {
      current.endDay = day.day_index;
      current.days.push(day);
      current.nights = current.days.length;
      continue;
    }

    blocks.push({
      nodeId: day.base_node_id,
      nodeName: day.base_node_name,
      startDay: day.day_index,
      endDay: day.day_index,
      nights: 1,
      days: [day],
    });
  }

  return blocks.filter((block) => block.nights > 0);
}

export function totalStayNights(blocks: StayBlock[]): number {
  return blocks.reduce((sum, block) => sum + block.nights, 0);
}
