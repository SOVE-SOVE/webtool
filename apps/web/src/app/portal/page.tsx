"use client";

import { useEffect, useState } from "react";
import { portalApi, PortalApiError, type PortalProject } from "@/lib/portalApi";

const COMING_SOON_SECTIONS = [
  {
    title: "Website Previews",
    description: "Review draft pages as they're built and leave sign-off once they're ready.",
  },
  {
    title: "Submit Information",
    description: "Fill in the details your project needs — business details, copy, and more.",
  },
  {
    title: "Upload Assets",
    description: "Share logos, photos, and other files directly with your project team.",
  },
  {
    title: "Feedback",
    description: "Leave notes on any part of your project for your team to act on.",
  },
  {
    title: "Milestone Approvals",
    description: "Approve each stage of the project as it's completed.",
  },
];

function ProjectCard({ project }: { project: PortalProject }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">{project.name}</h3>
          {project.package && <p className="mt-0.5 text-xs text-neutral-500">{project.package} package</p>}
        </div>
        <span className="shrink-0 rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white">
          {project.stage_label}
        </span>
      </div>
      {project.deadline && (
        <p className="mt-3 text-xs text-neutral-500">Target completion: {project.deadline}</p>
      )}
    </div>
  );
}

export default function PortalHomePage() {
  const [projects, setProjects] = useState<PortalProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    portalApi
      .listProjects()
      .then(setProjects)
      .catch((err) => {
        setError(err instanceof PortalApiError ? err.message : "Couldn't load your project.");
      });
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-8">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">Your Project</h1>
        <p className="mt-1 text-sm text-neutral-500">Current status of your website project.</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {projects === null && !error && <p className="text-sm text-neutral-500">Loading…</p>}

      {projects !== null && projects.length === 0 && (
        <p className="text-sm text-neutral-500">No project has been set up for your account yet.</p>
      )}

      {projects !== null && projects.length > 0 && (
        <div className="space-y-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-neutral-900">Coming soon</h2>
        <p className="mt-1 text-xs text-neutral-500">
          These parts of the portal aren&apos;t wired up yet — this is the foundation they&apos;ll build on.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {COMING_SOON_SECTIONS.map((section) => (
            <div
              key={section.title}
              className="rounded-lg border border-dashed border-neutral-300 p-4 opacity-60"
            >
              <h3 className="text-sm font-semibold text-neutral-700">{section.title}</h3>
              <p className="mt-1 text-xs text-neutral-500">{section.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
