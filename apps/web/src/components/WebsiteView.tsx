"use client";

import { useState } from "react";
import { api, type QualityIssue, type Website, type WebsiteSection } from "@/lib/api";

const SEVERITY_CLASSES: Record<QualityIssue["severity"], string> = {
  high: "bg-red-100 text-red-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-surface-subtle text-fg-muted",
};

function SectionSummary({ section }: { section: WebsiteSection }) {
  const { config } = section;
  const heading = typeof config.heading === "string" ? config.heading : null;
  const subheading = typeof config.subheading === "string" ? config.subheading : null;
  const listFields = ["services", "testimonials", "items", "images", "tiers", "members", "projects", "logos", "stats"];
  const listField = listFields.find((f) => Array.isArray(config[f]));

  return (
    <div className="text-sm text-fg-muted">
      {heading && <p className="font-medium text-fg">{heading}</p>}
      {subheading && <p className="mt-1 text-fg-muted">{subheading}</p>}
      {listField && (
        <p className="mt-1 text-fg-muted">
          {(config[listField] as unknown[]).length} {listField}
        </p>
      )}
      {!heading && !listField && <p className="text-fg-subtle italic">No preview available — see raw config.</p>}
    </div>
  );
}

function SectionCard({
  websiteId,
  section,
  onChange,
}: {
  websiteId: string;
  section: WebsiteSection;
  onChange: (website: Website) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => JSON.stringify(section.config, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setBusy(true);
    setError(null);
    try {
      onChange(await api.updateWebsiteSection(websiteId, section.id, { approved: !section.approved }));
    } catch {
      setError("Couldn't update approval.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerate() {
    setBusy(true);
    setError(null);
    try {
      onChange(await api.regenerateWebsiteSection(websiteId, section.id));
    } catch {
      setError("Couldn't regenerate this section — its source content may no longer be available.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit() {
    setBusy(true);
    setError(null);
    try {
      const parsed = JSON.parse(draft);
      const website = await api.updateWebsiteSection(websiteId, section.id, { config: parsed });
      onChange(website);
      setEditing(false);
    } catch (e) {
      setError(e instanceof SyntaxError ? "That isn't valid JSON." : "Couldn't save this edit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-surface-subtle px-2 py-0.5 text-xs font-medium text-fg-muted">{section.type}</span>
          {section.approved && (
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Approved</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => setEditing((v) => !v)} disabled={busy} className="text-fg-muted hover:underline">
            {editing ? "Cancel" : "Edit"}
          </button>
          <button onClick={handleRegenerate} disabled={busy} className="text-fg-muted hover:underline disabled:opacity-50">
            Regenerate
          </button>
          <button
            onClick={handleApprove}
            disabled={busy}
            className="rounded border border-border-strong px-2 py-1 font-medium text-fg-muted hover:bg-surface-subtle disabled:opacity-50"
          >
            {section.approved ? "Unapprove" : "Approve"}
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-2">
        {editing ? (
          <div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={10}
              className="w-full rounded-md border border-border-strong p-2 font-mono text-xs"
            />
            <button
              onClick={handleSaveEdit}
              disabled={busy}
              className="mt-2 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        ) : (
          <SectionSummary section={section} />
        )}
      </div>
    </div>
  );
}

export function WebsiteView({ website, onChange }: { website: Website; onChange: (w: Website) => void }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            website.anti_slop_passed ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
          }`}
        >
          Quality score {website.anti_slop_score}/100{website.anti_slop_passed ? " — passed" : ""}
        </span>
        {website.flagged_for_review && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Flagged for review</span>
        )}
      </div>

      {website.sources_note && <p className="mt-2 text-xs text-fg-muted">{website.sources_note}</p>}

      {website.missing_information.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">Missing information — not invented, needs real content</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-amber-800">
            {website.missing_information.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {website.anti_slop_issues.length > 0 && (
        <div className="mt-3 rounded-md border border-border p-3">
          <p className="text-sm font-medium text-fg">Quality issues</p>
          <ul className="mt-2 space-y-1.5">
            {website.anti_slop_issues.map((issue, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_CLASSES[issue.severity]}`}>
                  {issue.severity}
                </span>
                <span className="text-fg-muted">
                  {issue.message}
                  {issue.location && <span className="text-fg-subtle"> — {issue.location}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 space-y-2">
        <h3 className="text-sm font-semibold text-fg">Navigation</h3>
        <SectionCard websiteId={website.id} section={website.navigation} onChange={onChange} />
      </div>

      {website.pages.map((page) => (
        <div key={page.sitemap_page_id} className="mt-6">
          <h3 className="text-sm font-semibold text-fg">
            {page.name} <span className="font-normal text-fg-subtle">/{page.slug}</span>
          </h3>
          <div className="mt-2 space-y-2">
            {page.sections.map((section) => (
              <SectionCard key={section.id} websiteId={website.id} section={section} onChange={onChange} />
            ))}
            {page.sections.length === 0 && <p className="text-sm text-fg-subtle">No sections generated for this page.</p>}
          </div>
        </div>
      ))}

      <div className="mt-6 space-y-2">
        <h3 className="text-sm font-semibold text-fg">Footer</h3>
        <SectionCard websiteId={website.id} section={website.footer} onChange={onChange} />
      </div>
    </div>
  );
}
