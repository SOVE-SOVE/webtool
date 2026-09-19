"use client";

import Link from "next/link";
import { useState } from "react";
import type { Business, Client, Project } from "@/lib/api";
import { ClientStatusBadge } from "@/components/ClientStatusBadge";
import { ProjectStatusBadge } from "@/components/ProjectStatusBadge";
import type { ClientTone } from "@/lib/clients";

function ProjectPickerMenu({ projects }: { projects: Project[] }) {
  const [open, setOpen] = useState(false);
  const sorted = [...projects].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="btn btn-primary btn-sm">
        Open Project ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="menu-panel absolute right-0 z-20 mt-1 w-64 rounded-md border border-border bg-surface py-1 shadow-lg">
            {sorted.map((project) => (
              <Link
                key={project.id}
                href={`/dashboard/projects/${project.id}`}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-surface-hover"
                onClick={() => setOpen(false)}
              >
                <span className="truncate text-fg">{project.name}</span>
                <ProjectStatusBadge project={project} className="shrink-0" />
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SecondaryActionMenu({ onEdit }: { onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        className="rounded-md border border-border-strong px-2 py-1.5 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          {/* Edit only — Client/Business has no archive concept anywhere in
              this codebase (no archived_at column, no archive endpoint),
              unlike Lead. Not fabricated here. */}
          <div className="menu-panel absolute right-0 z-20 mt-1 w-36 rounded-md border border-border bg-surface py-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
              className="block w-full px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover"
            >
              Edit
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Sticky header — offsets copied from Planning's detail page (top-12
 * clears the app's mobile fixed top bar, lg:top-11 clears the desktop
 * sticky strip, z-20 sits below both so it tucks under rather than
 * over). One primary action, never repeated elsewhere on the page.
 *
 * Unlike Planning, this uses plain `px-4 sm:px-6` — no negative-margin
 * bleed + inner `mx-auto max-w-5xl` recenter. That pattern only works
 * when (a) an ancestor already applies matching padding for the bleed
 * to cancel against, and (b) the rest of the page is also constrained
 * to the same max-width, so the recentered header lines up with the
 * content below it. Neither holds here — the Client page's tab content
 * has no max-width constraint — so copying it verbatim caused the
 * header to overflow the viewport (bled past an ancestor with no
 * padding to cancel) and sit in a visibly different, narrower column
 * than the tab bar/content beneath it. Plain matching padding, no
 * bleed, keeps the header's content column identical to the content
 * column below it at every width.
 */
export function ClientHeader({
  business,
  clientProjects,
  tone,
  clientsReturnUrl,
  startingIntake,
  onStartIntake,
  onEditClick,
}: {
  business: Business;
  clientRecord: Client;
  clientProjects: Project[];
  tone: ClientTone;
  clientsReturnUrl: string;
  startingIntake: boolean;
  onStartIntake: () => void;
  onEditClick: () => void;
}) {
  return (
    <header className="sticky top-12 z-20 border-b border-border bg-surface px-4 py-4 sm:px-6 lg:top-11">
      <Link href={clientsReturnUrl} className="text-sm text-fg-muted hover:underline">
        ← Clients
      </Link>

      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {/* No flex-wrap here: a flex-wrap parent lets a nowrap child
              (truncate implies white-space:nowrap) sit at its full
              intrinsic width forever, since the browser wraps the
              *sibling* (the badge) instead of ever shrinking the title
              — truncate's overflow:hidden never gets a chance to fire.
              min-w-0 on both the row and the h1 gives the title a real
              shrink target so it truncates properly and the badge stays
              pinned beside it on one line, at any business-name length. */}
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight text-fg sm:text-2xl">
              {business.name}
            </h1>
            <ClientStatusBadge tone={tone} className="shrink-0" />
          </div>
          {/* Business.email/phone stand in for "main contact" — there is
              no named-contact-person field exposed anywhere in the API
              (a Contact model exists on the backend but has no routes). */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
            {business.email && (
              <a href={`mailto:${business.email}`} className="hover:text-fg hover:underline">
                {business.email}
              </a>
            )}
            {business.phone && (
              <a href={`tel:${business.phone}`} className="hover:text-fg hover:underline">
                {business.phone}
              </a>
            )}
            {!business.email && !business.phone && <span className="text-fg-subtle">No contact details on file</span>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {clientProjects.length === 0 ? (
            <button type="button" onClick={onStartIntake} disabled={startingIntake} className="btn btn-primary btn-sm">
              {startingIntake ? "Starting…" : "Start intake"}
            </button>
          ) : clientProjects.length === 1 ? (
            <Link href={`/dashboard/projects/${clientProjects[0].id}`} className="btn btn-primary btn-sm">
              Open Project
            </Link>
          ) : (
            <ProjectPickerMenu projects={clientProjects} />
          )}
          <SecondaryActionMenu onEdit={onEditClick} />
        </div>
      </div>
    </header>
  );
}
