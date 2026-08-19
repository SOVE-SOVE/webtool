"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  api,
  PROJECT_STAGES,
  type CreativeDirectionBrief,
  type Project,
  type ProjectStage,
  type User,
} from "@/lib/api";
import { CreativeDirectionView } from "@/components/CreativeDirectionView";

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [project, setProject] = useState<Project | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [briefs, setBriefs] = useState<CreativeDirectionBrief[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [targetAudience, setTargetAudience] = useState("");
  const [businessGoals, setBusinessGoals] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");

  function loadBriefs() {
    api
      .listCreativeDirections(projectId)
      .then((list) => {
        setBriefs(list);
        if (list.length > 0) setExpandedId(list[0].id);
      })
      .catch(() => {});
  }

  useEffect(() => {
    api
      .getProject(projectId)
      .then(setProject)
      .catch(() => setError("Couldn't load this project."));
    api.listUsers().then(setUsers).catch(() => {});
    loadBriefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleStageChange(stage: ProjectStage) {
    const updated = await api.updateProject(projectId, { stage });
    setProject(updated);
  }

  async function handleAssigneeChange(assigneeId: string) {
    const updated = await api.updateProject(projectId, { assigned_user_id: assigneeId || null });
    setProject(updated);
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setGenerating(true);
    setGenerateError(null);
    try {
      const brief = await api.generateCreativeDirection(projectId, {
        target_audience: targetAudience || undefined,
        business_goals: businessGoals || undefined,
        additional_notes: additionalNotes || undefined,
      });
      setBriefs((prev) => [brief, ...(prev ?? [])]);
      setExpandedId(brief.id);
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

  function handleBriefUpdated(updated: CreativeDirectionBrief) {
    setBriefs((prev) => (prev ? prev.map((b) => (b.id === updated.id ? updated : b)) : prev));
  }

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!project) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link href="/dashboard/projects" className="text-sm text-neutral-500 hover:underline">
        ← Back to projects
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">{project.name}</h1>
          <p className="text-sm text-neutral-500">{project.client_business_name}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-neutral-500">Stage</span>
          <select
            value={project.stage}
            onChange={(e) => handleStageChange(e.target.value as ProjectStage)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
          >
            {PROJECT_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {stage.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-neutral-500">Assigned to</span>
          <select
            value={project.assigned_user_id ?? ""}
            onChange={(e) => handleAssigneeChange(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
          >
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">Creative direction</h2>
            <p className="text-xs text-neutral-500">
              The creative concept, visual direction, and brand direction for this project — review and edit
              before design/build work starts.
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
              Optional — anything typed in here is used as confirmed client context. Left blank, the direction
              will lean on the business record and mark the gap as an assumption to confirm later.
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
            Pulling together the business record, website audit, and prior research — this can take up to a
            minute.
          </p>
        )}
        {generateError && <p className="mt-2 text-sm text-red-600">{generateError}</p>}

        <ul className="mt-3 divide-y divide-neutral-200 border border-neutral-200">
          {briefs && briefs.length === 0 && !generating && (
            <li className="px-3 py-3 text-sm text-neutral-500">No creative direction generated yet.</li>
          )}
          {briefs?.map((brief) => {
            const expanded = expandedId === brief.id;
            return (
              <li key={brief.id} className="px-3 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setExpandedId(expanded ? null : brief.id)}
                    className="text-left text-neutral-900 hover:underline"
                  >
                    {expanded ? "▾" : "▸"} Creative direction — {new Date(brief.generated_at).toLocaleString()}
                  </button>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        brief.status === "approved"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-neutral-100 text-neutral-700"
                      }`}
                    >
                      {brief.status}
                    </span>
                    {brief.flagged_for_review && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                        Flagged for review
                      </span>
                    )}
                  </div>
                </div>
                {expanded && (
                  <div className="mt-3">
                    <CreativeDirectionView brief={brief} onChange={handleBriefUpdated} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
