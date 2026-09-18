"use client";

import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { SalesSwitch, type SalesViewId } from "./SalesSwitch";

function viewFromPathname(pathname: string): SalesViewId {
  if (pathname.startsWith("/dashboard/sales/pipeline")) return "pipeline";
  if (pathname.startsWith("/dashboard/sales/follow-ups")) return "follow-ups";
  return "leads";
}

/**
 * The one shared "Sales" header for all three merged views (Leads /
 * Sales Pipeline / Follow-ups) — rendered exactly once here, not
 * repeated per view the way Build's own two views each render their
 * own `<PageHeader title="Build">` independently. Each view keeps its
 * own contextual metrics/toolbar/primary action beneath this (unchanged
 * from what each already had), so "one header" doesn't mean "one
 * toolbar" — only the title+switch are literally shared.
 *
 * Header/tab placement, spacing, and the tab strip itself deliberately
 * mirror the Clients workspace (`dashboard/clients/page.tsx`): a
 * title-only `PageHeader` (no actions slot used for the switch), then
 * the tab strip as its own full-width row directly below with `mt-4`,
 * then content at `mt-6` — not the switch living inside the header's
 * `actions` slot, which would constrain it to the title column instead
 * of spanning the page like Clients' own tab strip does.
 *
 * `usePathname()` (not `useSearchParams()`) is enough to know which
 * view is active, so this layout needs no Suspense boundary of its
 * own — each child page keeps whatever Suspense wrapper it already had
 * for its own `useSearchParams()` usage.
 */
export default function SalesLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = viewFromPathname(pathname);

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="Sales" />
      <SalesSwitch active={active} className="mt-4" />
      <div className="mt-6">{children}</div>
    </div>
  );
}
