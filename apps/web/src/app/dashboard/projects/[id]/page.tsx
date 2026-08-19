"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  api,
  PROJECT_STAGES,
  type ActivityItem,
  type Brief,
  type CreativeDirectionBrief,
  type Project,
  type ProjectStage,
  type Sitemap,
  type User,
} from "@/lib/api";
import { BriefEditor } from "@/components/BriefEditor";
import { CreativeDirectionView } from "@/components/CreativeDirectionView";
import { SitemapView } from "@/components/SitemapView";

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [project, setProject] = useState<Project | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [briefs, setBriefs] = useState<CreativeDirectionBrief[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [targetAudience, setTargetAudience] = useState("");
  const [businessGoals, setBusinessGoals] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");

  const [sitemaps, setSitemaps] = useState<Sitemap[] | null>(null);
  const [sitemapExpandedId, setSitemapExpandedId] = useState<string | null>(null);
  const [generatingSitemap, setGeneratingSitemap] = useState(false);
  const [generateSitemapError, setGenerateSitemapError] = useState<string | null>(null);
  const [showGenerateSitemapForm, setShowGenerateSitemapForm] = useState(false);
  const [sitemapCreativeDirectionId, setSitemapCreativeDirectionId] = useState("");
  const [sitemapAdditionalNotes, setSitemapAdditionalNotes] = useState("");

  function loadSitemaps() {
    api
      .listSitemaps(projectId)
      .then((list) => {
        setSitemaps(list);
        if (list.length > 0) setSitemapExpandedId(list[0].id);
      })
      .catch(() => {});
  }

  function loadCreativeDirections() {
    api
      .listCreativeDirections(projectId)
      .then((list) => {
        setBriefs(list);
        if (list.length > 0) setExpandedId(list[0].id);
      })
      .catch(() => {});
  }

  function load() {
    api.getProject(projectId).then(setProject).catch(() => setError("Couldn't load this project."));
    api.getBrief(projectId).then(setBrief).catch(() => {});
    api.listUsers().then(setUsers).catch(() => {});
    api
      .listActivity({ entity_type: "project", entity_id: projectId })
      .then(setActivity)
      .catch(() => {});
    loadCreativeDirections();
    loadSitemaps();
  }

  useEffect(load, [projectId]);

  async function handleStageChange(stage: ProjectStage) {
    if (!project) return;
    const updated = await api.updateProject(project.id, { stage });
    setProject(updated);
  }

  async function handleAssigneeChange(assigneeId: string) {
    if (!project) return;
    const updated = await api.updateProject(project.id, { assigned_user_id: assigneeId || null });
    setProject(updated);
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setGenerating(true);
    setGenerateError(null);
    try {
      const generated = await api.generateCreativeDirection(projectId, {
        target_audience: targetAudience || undefined,
        business_goals: businessGoals || undefined,
        additional_notes: additionalNotes || undefined,
      });
      setBriefs((prev) => [generated, ...(prev ?? [])]);
      setExpandedId(generated.id);
      setShowGenerateForm(false);
      setTargetAudience("");
      setBusinessGoals("");
      setAdditionalNotes("");
    } catch {
      setGenerateError("Couldn't generate a creative direction.");
    } finally {
      setGenerating(false);
    }
  }

  function handleCreativeDirectionUpdated(updated: CreativeDirectionBrief) {
    setBriefs((prev) => (prev ? prev.map((b) => (b.id === updated.id ? updated : b)) : prev));
  }

  async function handleGenerateSitemap(e: React.FormEvent) {
    e.preventDefault();
    setGeneratingSitemap(true);
    setGenerateSitemapError(null);
    try {
      const generated = await api.generateSitemap(projectId, {
        creative_direction_id: sitemapCreativeDirectionId || undefined,
        additional_notes: sitemapAdditionalNotes || undefined,
      });
      setSitemaps((prev) => [generated, ...(prev ?? [])]);
      setSitemapExpandedId(generated.id);
      setShowGenerateSitemapForm(false);
      setSitemapCreativeDirectionId("");
      setSitemapAdditionalNotes("");
    } catch {
      setGenerateSitemapError("Couldn't generate a sitemap.");
    } finally {
      setGeneratingSitemap(false);
    }
  }

  function handleSitemapUpdated(updated: Sitemap) {
    setSitemaps((prev) => (prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev));
  }

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!project) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;

  return (
    <div className="p-6">
      <Link href="/dashboard/projects" className="text-sm text-neutral-500 hover:underline">
        ← All projects
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">{project.name}</h1>
          <p className="text-sm text-neutral-500">{project.client_business_name}</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={project.stage}
            onChange={(e) => handleStageChange(e.target.value as ProjectStage)}
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          >
            {PROJECT_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {stage.replace("_", " ")}
              </option>
            ))}
          </select>
          <select
            value={project.assigned_user_id ?? ""}
            onChange={(e) => handleAssigneeChange(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          >
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-900">Project brief</h2>
        <p className="mt-1 text-sm text-neutral-500">
          The structured client intake — this becomes the source of truth for the build. Every field
          saves as you leave it; missing fields are flagged, never guessed at.
        </p>
        <div className="mt-3">
          {brief ? <BriefEditor brief={brief} onChange={setBrief} /> : (
            <p className="text-sm text-neutral-500">Loading brief…</p>
          )}
        </div>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">Creative direction</h2>
            <p className="text-xs text-neutral-500">
              The creative concept, visual direction, and brand direction for this project — review and edit
              before design/build work starts. Uses the brief above when it has answers, and flags what's
              still missing.
            </p>
          </div>
          <button
            onClick={() => setShowGenerateForm((v) => !v)}
            disabled={generating}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
          >
            {showGenerateForm ? "Cancel" : briefs && briefs.length > 0 ? "Regenerate" : "Generate creative direction"}
          </button>
        </div>

        {showGenerateForm && (
          <form onSubmit={handleGenerate} className="mt-3 space-y-3 border border-neutral-200 p-4">
            <p className="text-xs text-neutral-500">
              Optional — overrides the brief above for this generation only. Left blank, target audience and
              business goals are pulled from the project brief when it has them; if the brief doesn't have them
              either, the gap is marked as an assumption to confirm later.
            </p>
            <label className="block text-sm">
              <span className="text-neutral-600">Target audience</span>
              <textarea
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                placeholder="e.g. Homeowners aged 30-60 needing urgent or planned trade work"
              />
            </label>
            <label className="block text-sm">
              <span className="text-neutral-600">Business goals for the new site</span>
              <textarea
                value={businessGoals}
                onChange={(e) => setBusinessGoals(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                placeholder="e.g. More phone enquiries from mobile visitors"
              />
            </label>
            <label className="block text-sm">
              <span className="text-neutral-600">Additional notes</span>
              <textarea
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={generating}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {generating ? "Generating…" : "Generate"}
            </button>
          </form>
        )}
        {generating && (
          <p className="mt-2 text-sm text-neutral-500">
            Pulling together the business record, brief, website audit, and prior research — this can take up
            to a minute.
          </p>
        )}
        {generateError && <p className="mt-2 text-sm text-red-600">{generateError}</p>}

        <ul className="mt-3 divide-y divide-neutral-200 border border-neutral-200">
          {briefs && briefs.length === 0 && !generating && (
            <li className="px-3 py-3 text-sm text-neutral-500">No creative direction generated yet.</li>
          )}
          {briefs?.map((cd) => {
            const expanded = expandedId === cd.id;
            return (
              <li key={cd.id} className="px-3 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setExpandedId(expanded ? null : cd.id)}
                    className="text-left text-neutral-900 hover:underline"
                  >
                    {expanded ? "▾" : "▸"} Creative direction — {new Date(cd.generated_at).toLocaleString()}
                  </button>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        cd.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-700"
                      }`}
                    >
                      {cd.status}
                    </span>
                    {cd.flagged_for_review && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                        Flagged for review
                      </span>
                    )}
                  </div>
                </div>
                {expanded && (
                  <div className="mt-3">
                    <CreativeDirectionView brief={cd} onChange={handleCreativeDirectionUpdated} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">Sitemap</h2>
            <p className="text-xs text-neutral-500">
              The recommended page structure for this site — review, edit, add/remove/reorder pages, then
              approve. The approved sitemap becomes the structural source of truth for website generation.
            </p>
          </div>
          <button
            onClick={() => setShowGenerateSitemapForm((v) => !v)}
            disabled={generatingSitemap}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
          >
            {showGenerateSitemapForm ? "Cancel" : sitemaps && sitemaps.length > 0 ? "Regenerate" : "Generate sitemap"}
          </button>
        </div>

        {showGenerateSitemapForm && (
          <form onSubmit={handleGenerateSitemap} className="mt-3 space-y-3 border border-neutral-200 p-4">
            <p className="text-xs text-neutral-500">
              Uses the project brief and the latest approved creative direction above by default.
            </p>
            <label className="block text-sm">
              <span className="text-neutral-600">Creative direction to use</span>
              <select
                value={sitemapCreativeDirectionId}
                onChange={(e) => setSitemapCreativeDirectionId(e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
              >
                <option value="">Auto (latest approved, or most recent)</option>
                {briefs?.map((cd) => (
                  <option key={cd.id} value={cd.id}>
                    {new Date(cd.generated_at).toLocaleString()} — {cd.status}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-neutral-600">Additional notes</span>
              <textarea
                value={sitemapAdditionalNotes}
                onChange={(e) => setSitemapAdditionalNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={generatingSitemap}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {generatingSitemap ? "Generating…" : "Generate"}
            </button>
          </form>
        )}
        {generatingSitemap && (
          <p className="mt-2 text-sm text-neutral-500">
            Pulling together the brief and creative direction to recommend a page structure — this can take up
            to a minute.
          </p>
        )}
        {generateSitemapError && <p className="mt-2 text-sm text-red-600">{generateSitemapError}</p>}

        <ul className="mt-3 divide-y divide-neutral-200 border border-neutral-200">
          {sitemaps && sitemaps.length === 0 && !generatingSitemap && (
            <li className="px-3 py-3 text-sm text-neutral-500">No sitemap generated yet.</li>
          )}
          {sitemaps?.map((s) => {
            const expanded = sitemapExpandedId === s.id;
            return (
              <li key={s.id} className="px-3 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setSitemapExpandedId(expanded ? null : s.id)}
                    className="text-left text-neutral-900 hover:underline"
                  >
                    {expanded ? "▾" : "▸"} Sitemap — {new Date(s.generated_at).toLocaleString()} ({s.pages.length}{" "}
                    top-level pages)
                  </button>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        s.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-700"
                      }`}
                    >
                      {s.status}
                    </span>
                    {s.flagged_for_review && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                        Flagged for review
                      </span>
                    )}
                  </div>
                </div>
                {expanded && (
                  <div className="mt-3">
                    <SitemapView sitemap={s} onChange={handleSitemapUpdated} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-900">Activity history</h2>
        <ul className="mt-3 divide-y divide-neutral-200 border border-neutral-200">
          {activity && activity.length === 0 && (
            <li className="px-3 py-3 text-sm text-neutral-500">No activity yet.</li>
          )}
          {activity?.map((item) => (
            <li key={item.id} className="px-3 py-2 text-sm">
              <span className="text-neutral-900">{item.summary ?? item.action}</span>
              <span className="ml-2 text-xs text-neutral-500">
                {item.user_name ?? "System"} · {new Date(item.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
