"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  api,
  PROJECT_STAGES,
  type ActivityItem,
  type Brief,
  type Project,
  type ProjectStage,
  type User,
} from "@/lib/api";
import { BriefEditor } from "@/components/BriefEditor";

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [project, setProject] = useState<Project | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.getProject(projectId).then(setProject).catch(() => setError("Couldn't load this project."));
    api.getBrief(projectId).then(setBrief).catch(() => {});
    api.listUsers().then(setUsers).catch(() => {});
    api
      .listActivity({ entity_type: "project", entity_id: projectId })
      .then(setActivity)
      .catch(() => {});
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
