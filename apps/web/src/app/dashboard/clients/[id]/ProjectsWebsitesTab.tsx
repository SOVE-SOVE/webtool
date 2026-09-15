"use client";

import type { Project } from "@/lib/api";
import { WebsiteCard } from "@/components/websites/WebsiteCard";

export function ProjectsWebsitesTab({
  clientProjects,
  currency,
  hasActiveProject,
  startingIntake,
  onStartAnotherProject,
}: {
  clientProjects: Project[];
  currency: string;
  hasActiveProject: boolean;
  startingIntake: boolean;
  onStartAnotherProject: () => void;
}) {
  if (clientProjects.length === 0) {
    return <p className="text-sm text-fg-muted">No projects yet — use Start intake above to create one.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {hasActiveProject && (
        <div className="flex justify-end">
          <button
            onClick={onStartAnotherProject}
            disabled={startingIntake}
            className="text-xs text-fg-muted hover:text-fg hover:underline disabled:opacity-50"
          >
            + Start another project
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {clientProjects.map((project) => (
          <WebsiteCard key={project.id} project={project} currency={currency} />
        ))}
      </div>
    </div>
  );
}
