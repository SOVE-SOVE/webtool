import type { Project } from "@/lib/api";
import { projectStatusLabel, projectTone, type ProjectTone } from "@/lib/projects";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

// Same tone mapping as before this wrapped the shared Badge primitive —
// see docs/11_UI_REDESIGN_PLAN.md §4.
const TONE_MAP: Record<ProjectTone, BadgeTone> = {
  planning: "muted",
  building: "info",
  review: "warning",
  live: "highlight",
  done: "success",
};

export function ProjectStatusBadge({
  project,
  className = "",
}: {
  project: Pick<Project, "stage" | "delivered_at">;
  className?: string;
}) {
  return (
    <Badge tone={TONE_MAP[projectTone(project)]} className={className}>
      {projectStatusLabel(project)}
    </Badge>
  );
}
