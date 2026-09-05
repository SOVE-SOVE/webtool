"use client";

import { useState } from "react";
import { api, ApiError, type InstagramImportResult } from "@/lib/api";

const SAMPLE_CSV = `name,instagram_handle,category,phone,email,address,suburb,state,postcode,country,latitude,longitude,bio,bio_link_url,profile_image_url,follower_count,last_post_date,website_status,website_url,notes
Joe's Plumbing,joesplumbing,Plumbing,0400 111 222,,12 Smith St,Gold Coast,QLD,4217,Australia,-28.0167,153.4,"Your local plumber, 24/7 emergency callouts",https://linktr.ee/joesplumbing,,1500,2026-08-20,link_in_bio_only,,Found via #goldcoastplumber
`;

/**
 * Phase 1 of Instagram Discovery (docs/05_DECISIONS.md) — the only way
 * candidates enter the system today: operator-collected CSV text (typed,
 * pasted, or a file), turned into a discovery search through
 * POST /discovery-searches/instagram-import. No live provider exists yet
 * (Meta has no "search Instagram businesses by location" API) — see that
 * route's docstring.
 */
export function InstagramImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (result: InstagramImportResult) => void;
}) {
  const [queryLabel, setQueryLabel] = useState("");
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InstagramImportResult | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvText(await file.text());
    e.target.value = ""; // allow re-selecting the same file after an edit
  }

  async function handleImport() {
    if (!csvText.trim()) return;
    setImporting(true);
    setError(null);
    try {
      const res = await api.importInstagramCandidates({
        query_label: queryLabel || undefined,
        csv_text: csvText,
      });
      setResult(res);
      onImported(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't import this CSV.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-panel max-w-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="instagram-import-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="instagram-import-title" className="section-title">
          Import Instagram candidates
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Paste businesses you&apos;ve already found on Instagram, or choose a CSV file. There&apos;s no
          automatic Instagram search yet — see the format below for what a row needs.
        </p>

        {!result && (
          <>
            <input
              value={queryLabel}
              onChange={(e) => setQueryLabel(e.target.value)}
              placeholder="Label for this batch (optional)"
              className="input mt-4"
            />
            <div className="mt-3 flex items-center gap-2">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFile}
                className="text-sm text-fg-muted"
                aria-label="Choose a CSV file"
              />
              <span className="text-xs text-fg-subtle">or paste CSV text below</span>
            </div>
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={SAMPLE_CSV}
              rows={10}
              className="input mt-2 font-mono text-xs"
              aria-label="CSV text"
            />
            <details className="mt-2 text-xs text-fg-muted">
              <summary className="cursor-pointer select-none">CSV format</summary>
              <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-surface-subtle p-2">
                {SAMPLE_CSV}
              </pre>
              <p className="mt-1">
                Only <code>name</code> or <code>instagram_handle</code> is required per row — every other column
                is optional. <code>website_status</code> accepts: no_website, link_in_bio_only,
                instagram_shop_only, proper_website, unknown_needs_review (default if left blank or unrecognized).
                Only a row with both <code>latitude</code> and <code>longitude</code> filled in appears on the
                map — there&apos;s no automatic geocoding from an address yet.
              </p>
            </details>
            {error && <p className="text-error mt-2">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={importing || !csvText.trim()}
                onClick={handleImport}
              >
                {importing ? "Importing…" : "Import"}
              </button>
            </div>
          </>
        )}

        {result && (
          <div className="mt-4">
            <p className="text-sm text-fg">
              Added {result.created_count} candidate{result.created_count === 1 ? "" : "s"}
              {result.duplicate_count > 0 && (
                <> · {result.duplicate_count} duplicate{result.duplicate_count === 1 ? "" : "s"} skipped</>
              )}
              {result.truncated && <> · import truncated at the row limit</>}
            </p>
            {result.skipped_rows.length > 0 && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-border p-2 text-xs text-fg-muted">
                {result.skipped_rows.map((row) => (
                  <div key={row.row_number}>
                    Row {row.row_number}: {row.reason}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-5 flex justify-end">
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
