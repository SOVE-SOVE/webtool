"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type Website, type WebsiteSummary } from "@/lib/api";
import { WebsiteView } from "@/components/WebsiteView";

export default function ProjectWebsitePage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [versions, setVersions] = useState<WebsiteSummary[] | null>(null);
  const [website, setWebsite] = useState<Website | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  function loadVersions(selectId?: string) {
    api
      .listWebsites(projectId)
      .then((list) => {
        setVersions(list);
        const target = selectId ?? list[0]?.id;
        if (target) {
          api.getWebsite(target).then(setWebsite).catch(() => {});
        } else {
          setWebsite(null);
        }
      })
      .catch(() => setLoadError("Couldn't load this project's websites."));
  }

  useEffect(() => loadVersions(), [projectId]);

  async function handleGenerate(forceRegenerateAll: boolean) {
    setGenerating(true);
    setGenerateError(null);
    try {
      const generated = await api.generateWebsite(projectId, { force_regenerate_all: forceRegenerateAll });
      setWebsite(generated);
      loadVersions(generated.id);
    } catch {
      setGenerateError(
        "Couldn't generate a website — make sure this project has an approved sitemap with pages first.",
      );
    } finally {
      setGenerating(false);
    }
  }

  function handleSelectVersion(id: string) {
    api.getWebsite(id).then(setWebsite).catch(() => {});
  }

  // Approving/editing a section mutates the current version in place
  // (no new row), but regenerating a section always creates a new one
  // — refresh the version list too so a just-created version shows up
  // and stays selected, instead of the dropdown quietly going stale.
  function handleWebsiteChange(updated: Website) {
    setWebsite(updated);
    api
      .listWebsites(projectId)
      .then(setVersions)
      .catch(() => {});
  }

  if (loadError) return <div className="p-6 text-sm text-red-600">{loadError}</div>;
  if (versions === null) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link href={`/dashboard/projects/${projectId}`} className="text-sm text-neutral-500 hover:underline">
        ← Back to project
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Website</h1>
        <div className="flex items-center gap-2">
          {website && (
            <button
              onClick={() => handleGenerate(true)}
              disabled={generating}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
              title="Rebuild every section from scratch, discarding approvals and edits"
            >
              Regenerate all
            </button>
          )}
          <button
            onClick={() => handleGenerate(false)}
            disabled={generating}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {generating ? "Generating…" : website ? "Regenerate" : "Generate website"}
          </button>
        </div>
      </div>

      {generateError && <p className="mt-2 text-sm text-red-600">{generateError}</p>}

      {versions.length > 0 && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          <span className="text-neutral-500">Version:</span>
          <select
            value={website?.id ?? ""}
            onChange={(e) => handleSelectVersion(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {new Date(v.generated_at).toLocaleString()}
                {v.anti_slop_score !== null ? ` — score ${v.anti_slop_score}` : ""}
                {v.generated_by_user_name ? ` — ${v.generated_by_user_name}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {!website && (
        <p className="mt-6 text-sm text-neutral-500">
          No website generated yet. This needs an approved sitemap with pages first.
        </p>
      )}

      {website && (
        <div className="mt-6">
          <WebsiteView website={website} onChange={handleWebsiteChange} />
        </div>
      )}
    </div>
  );
}
