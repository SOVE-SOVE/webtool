import type { Project } from "@/lib/api";
import { projectStatusLabel, projectTone, type ProjectTone } from "@/lib/projects";

// Five tones, not twelve stage colours — "visually obvious, not excessive".
const TONE_CLASS: Record<ProjectTone, string> = {
  planning: "bg-surface-subtle text-fg-muted",
  building: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  review: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  live: "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
};

export function ProjectStatusBadge({
  project,
  className = "",
}: {
  project: Pick<Project, "stage" | "delivered_at">;
  className?: string;
}) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASS[projectTone(project)]} ${className}`}
    >
      {projectStatusLabel(project)}
    </span>
  );
}
