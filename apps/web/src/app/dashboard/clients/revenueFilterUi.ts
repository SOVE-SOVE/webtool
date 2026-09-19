import type { ReactNode } from "react";
import type { FilterChip } from "@/components/ui/FilterChips";

/**
 * What each Revenue sub-view (Payments / Upcoming / Hosting) hands the
 * parent's command bar: the fields for the shared Filters popover, and
 * the removable chips for whichever of them are currently set. The
 * parent owns the layout, the search box and Clear all.
 */
export type RevenueFilterUi = { panel: ReactNode; chips: FilterChip[] };
