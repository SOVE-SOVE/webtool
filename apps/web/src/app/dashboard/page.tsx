"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type DashboardOverview } from "@/lib/api";

const currency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-neutral-200 p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-900">{value}</p>
    </div>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .dashboardOverview()
      .then(setData)
      .catch(() => setError("Couldn't load dashboard data."));
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-neutral-900">Overview</h1>
      <p className="mt-1 text-sm text-neutral-500">
        What needs your attention right now to make money or move a project forward.
      </p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {data && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricTile label="Total leads" value={data.total_leads} />
            <MetricTile label="Qualified leads" value={data.qualified_leads} />
            <MetricTile label="Contacted leads" value={data.contacted_leads} />
            <MetricTile label="Meetings" value={data.meetings} />
            <MetricTile label="Won projects" value={data.won_projects} />
            <MetricTile label="Active projects" value={data.active_projects} />
            <MetricTile label="Revenue (won)" value={currency.format(data.revenue_cents / 100)} />
            <MetricTile label="Tasks needing attention" value={data.tasks_needing_attention} />
          </div>

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-neutral-900">Needs your attention</h2>
            {data.needs_attention.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">Nothing needs attention right now.</p>
            ) : (
              <ul className="mt-2 divide-y divide-neutral-200 border border-neutral-200">
                {data.needs_attention.map((item) => (
                  <li key={`${item.kind}-${item.id}`}>
                    <Link href={item.href} className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50">
                      <span>
                        <span className="text-sm font-medium text-neutral-900">{item.title}</span>
                        <span className="ml-2 text-sm text-neutral-500">{item.detail}</span>
                      </span>
                      <span className="text-xs uppercase text-neutral-400">
                        {item.kind === "task" ? "Task" : "Stale lead"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
