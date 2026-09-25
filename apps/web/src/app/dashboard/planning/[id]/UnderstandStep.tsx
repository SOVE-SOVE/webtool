"use client";

import Link from "next/link";
import type { Lead, Planning } from "@/lib/api";
import { ROW_STATE_DOT, ROW_STATE_LABEL, computeBusinessInputRows } from "../lib";
import { StepFooter } from "./StepFooter";

type LeadBusinessFields = Pick<Lead, "industry" | "suburb" | "state" | "business_phone" | "business_email">;

const UNDERSTAND_ROW_KEYS = ["business_details", "location", "contact"] as const;

/**
 * Step 1 — "Understand the business". There's no Planning-specific
 * editing surface for a Lead's own business record (industry, location,
 * contact) — that editing capability lives on the Lead page itself — so
 * this step shows what's already confirmed (reusing the same
 * `computeBusinessInputRows` completeness check New Website Plan mode's
 * Overview already used, so "missing" here always means genuinely not
 * on file, never a blank standing in for "no") and links out to where
 * it can actually be edited. Services, target audience, and goals
 * aren't tracked as their own fields anywhere in this app today — said
 * plainly here rather than inventing a field for them.
 */
export function UnderstandStep({
  planning,
  lead,
  onNext,
}: {
  planning: Planning;
  lead: LeadBusinessFields | null;
  onNext: () => void;
}) {
  const rows = computeBusinessInputRows(planning, lead).filter((r) =>
    (UNDERSTAND_ROW_KEYS as readonly string[]).includes(r.key),
  );

  return (
    <div className="content-reveal space-y-5">
      <p className="text-sm text-fg-muted">
        Confirm what this workspace already knows about the business before deciding what to do with its website.
      </p>

      <section>
        <h2 className="section-title">Business details on file</h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          What this workspace already knows about the business — a blank row means it genuinely hasn&apos;t been
          confirmed yet, not that the answer is &ldquo;no&rdquo;.
        </p>
        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-sm text-fg">{row.label}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-fg-muted">
                <span className={`h-1.5 w-1.5 rounded-full ${ROW_STATE_DOT[row.state]}`} aria-hidden="true" />
                {ROW_STATE_LABEL[row.state]}
              </span>
            </li>
          ))}
        </ul>
        <Link
          href={`/dashboard/leads/${planning.lead_id}`}
          className="mt-2 inline-block text-xs font-medium text-fg-muted hover:text-fg hover:underline"
        >
          Edit business details on the lead record →
        </Link>
      </section>

      <section>
        <p className="text-xs text-fg-subtle">
          Services, target audience, and goals aren&apos;t captured as their own fields yet — use Notes (reachable from
          every step) to record anything about them worth keeping.
        </p>
      </section>

      <StepFooter onPrevious={null} onNext={onNext} />
    </div>
  );
}
