"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  api,
  ApiError,
  type AiProvidersStatus,
  type AiProviderStatus,
  type CalendarConnection,
  type Me,
  type Role,
  type User,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { TabBar } from "@/components/ui/Tabs";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/ToastProvider";
import { FONT_LABELS, useTheme, type FontChoice, type ThemeMode } from "@/components/ui/ThemeProvider";

const THEME_OPTIONS: { mode: ThemeMode; label: string }[] = [
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
  { mode: "system", label: "System" },
];

const FONT_OPTIONS = Object.keys(FONT_LABELS) as FontChoice[];

type SectionId = "account" | "workspace" | "appearance" | "integrations" | "ai";

const SECTIONS: { id: SectionId; label: string; description: string }[] = [
  { id: "account", label: "Account", description: "Your profile and sign-in session." },
  { id: "workspace", label: "Workspace", description: "Workspace name and who has access." },
  { id: "appearance", label: "Appearance", description: "Theme and font, saved to this browser." },
  { id: "integrations", label: "Integrations", description: "Calendar and other connected services." },
  { id: "ai", label: "AI & Automation", description: "Status of the AI providers this workspace uses." },
];

function isSectionId(v: string | null): v is SectionId {
  return v !== null && SECTIONS.some((s) => s.id === v);
}

/** Label/value row for read-only fields — e.g. profile details nobody can edit yet. */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="truncate font-medium text-fg">{value}</span>
    </div>
  );
}

// useSearchParams() needs a Suspense-boundary ancestor for Next's static
// generation (see dashboard/layout.tsx and dashboard/leads/page.tsx for
// the same pattern) — it also lets the active section and the OAuth
// calendar-redirect status live in the URL, so both are shareable/
// back-button-safe instead of one-time snapshots read at mount.
function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showToast = useToast();
  const { theme, setTheme, font, setFont } = useTheme();

  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<User[] | null>(null);

  const [calendarConnection, setCalendarConnection] = useState<CalendarConnection | null | undefined>(undefined);
  const [disconnecting, setDisconnecting] = useState(false);
  const calendarStatus = searchParams.get("calendar"); // "connected" | "error" | null, set by the OAuth redirect

  const [aiStatus, setAiStatus] = useState<AiProvidersStatus | null | undefined>(undefined);
  const [aiChecking, setAiChecking] = useState(false);

  const [workspaceName, setWorkspaceName] = useState("");
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [showAddUser, setShowAddUser] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [savingUser, setSavingUser] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);

  const sectionParam = searchParams.get("section");
  // A calendar-connect redirect always lands back on this page with
  // ?calendar=..., but not necessarily ?section=integrations — send the
  // user straight to the section that explains what just happened.
  const section: SectionId = isSectionId(sectionParam) ? sectionParam : calendarStatus ? "integrations" : "account";
  const activeSection = SECTIONS.find((s) => s.id === section)!;

  function load() {
    api
      .me()
      .then((m) => {
        setMe(m);
        setWorkspaceName(m.workspace_name);
      })
      .catch(() => {});
    api.listUsers().then(setUsers).catch(() => {});
    api.getGoogleCalendarStatus().then(setCalendarConnection).catch(() => setCalendarConnection(null));
    api.getAiProvidersStatus().then(setAiStatus).catch(() => setAiStatus(null));
  }

  useEffect(load, []);

  async function handleRecheckAi() {
    setAiChecking(true);
    try {
      setAiStatus(await api.getAiProvidersStatus(true));
    } catch {
      setAiStatus(null);
    } finally {
      setAiChecking(false);
    }
  }

  async function handleDisconnectCalendar() {
    setDisconnecting(true);
    try {
      await api.disconnectGoogleCalendar();
      setCalendarConnection(null);
      showToast("Google Calendar disconnected.");
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleLogout() {
    await api.logout();
    router.push("/login");
  }

  async function handleRenameWorkspace(e: React.FormEvent) {
    e.preventDefault();
    setSavingWorkspace(true);
    setWorkspaceError(null);
    try {
      await api.updateWorkspace(workspaceName);
      showToast("Workspace renamed.");
      load();
    } catch (err) {
      setWorkspaceError(err instanceof ApiError ? err.message : "Couldn't rename workspace.");
    } finally {
      setSavingWorkspace(false);
    }
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setSavingUser(true);
    setUserError(null);
    try {
      await api.createUser({ name, email, password, role });
      showToast(`${name} added to the workspace.`);
      setName("");
      setEmail("");
      setPassword("");
      setRole("member");
      setShowAddUser(false);
      load();
    } catch (err) {
      setUserError(err instanceof ApiError ? err.message : "Couldn't add teammate.");
    } finally {
      setSavingUser(false);
    }
  }

  async function handleRoleChange(userId: string, newRole: Role) {
    await api.updateUserRole(userId, { role: newRole });
    load();
  }

  const isAdmin = me?.role === "admin";

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="Settings" description="Manage your account, workspace, and integrations." />

      {/* Section switcher — a horizontal tab strip below `lg`, a vertical
          list beside the content above it. Both read/write the same
          `?section=` query param so the active section is shareable and
          survives the back button, instead of living only in local state. */}
      <div className="mt-6 lg:hidden">
        <TabBar
          tabs={SECTIONS.map((s) => ({ id: s.id, label: s.label }))}
          active={section}
          onChange={(id) => router.push(`/dashboard/settings?section=${id}`)}
        />
      </div>

      <div className="mt-6 flex flex-col gap-8 lg:flex-row lg:items-start">
        <nav aria-label="Settings sections" className="hidden w-52 shrink-0 lg:block">
          <ul className="space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/dashboard/settings?section=${s.id}`}
                  aria-current={section === s.id ? "page" : undefined}
                  className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                    section === s.id
                      ? "bg-surface-subtle font-medium text-fg"
                      : "text-fg-muted hover:bg-surface-hover hover:text-fg"
                  }`}
                >
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 max-w-2xl flex-1">
          <div>
            <h2 className="text-base font-semibold text-fg">{activeSection.label}</h2>
            <p className="mt-0.5 text-sm text-fg-muted">{activeSection.description}</p>
          </div>

          <div className="mt-4 space-y-4">
            {section === "account" && (
              <>
                <div className="card p-4">
                  <h3 className="section-title">Profile</h3>
                  <div className="mt-2 divide-y divide-border">
                    <InfoRow label="Name" value={me?.name ?? "—"} />
                    <InfoRow label="Email" value={me?.email ?? "—"} />
                    <InfoRow label="Role" value={<span className="capitalize">{me?.role ?? "—"}</span>} />
                  </div>
                  <p className="mt-3 text-xs text-fg-muted">
                    Editing your own name or password isn&apos;t built yet — ask an admin to add or update
                    accounts from Workspace settings.
                  </p>
                </div>

                <div className="card p-4">
                  <h3 className="section-title">Session</h3>
                  <p className="mt-1 text-xs text-fg-muted">Sign out of WebTool on this device.</p>
                  <button onClick={handleLogout} className="btn btn-secondary mt-3">
                    Sign out
                  </button>
                </div>
              </>
            )}

            {section === "workspace" && (
              <>
                <div className="card p-4">
                  <h3 className="section-title">Workspace name</h3>
                  {isAdmin ? (
                    <form onSubmit={handleRenameWorkspace} className="mt-3">
                      <label htmlFor="workspace-name" className="field-label">
                        Name
                      </label>
                      <div className="mt-1.5 flex gap-2">
                        <input
                          id="workspace-name"
                          value={workspaceName}
                          onChange={(e) => setWorkspaceName(e.target.value)}
                          className="input flex-1"
                        />
                        <button type="submit" disabled={savingWorkspace} className="btn btn-primary shrink-0">
                          {savingWorkspace ? "Saving…" : "Save"}
                        </button>
                      </div>
                      {workspaceError && <p className="text-error mt-2">{workspaceError}</p>}
                    </form>
                  ) : (
                    <p className="mt-2 text-sm text-fg">{me?.workspace_name ?? "—"}</p>
                  )}
                  <p className="mt-3 text-xs text-fg-muted">
                    Everyone in this workspace shares the same leads, clients, projects, and tasks — see
                    docs/01_REQUIREMENTS.md &quot;Multi-user &amp; workspace&quot;.
                  </p>
                </div>

                <div className="card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="section-title">People</h3>
                    {isAdmin && (
                      <button onClick={() => setShowAddUser(true)} className="btn btn-primary btn-sm">
                        Add teammate
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-fg-muted">
                    {isAdmin
                      ? "This is an internal tool for a small team — an admin creates each teammate's account here. There's no public sign-up. A Member can do everything except manage people and workspace settings."
                      : "Each person signs in with their own account. Only an admin can add or change teammates."}
                  </p>

                  <div className="mt-4">
                    {users === null ? (
                      <TableSkeleton rows={3} cols={3} />
                    ) : (
                      <div className="table-shell">
                        <table className="table">
                          <thead>
                            <tr>
                              <th className="px-3 py-2">Name</th>
                              <th className="px-3 py-2">Email</th>
                              <th className="px-3 py-2">Role</th>
                            </tr>
                          </thead>
                          <tbody>
                            {users.map((user) => (
                              <tr key={user.id}>
                                <td className="px-3 py-2 font-medium text-fg">{user.name}</td>
                                <td className="px-3 py-2 text-fg-muted">{user.email}</td>
                                <td className="px-3 py-2">
                                  {isAdmin ? (
                                    <select
                                      aria-label={`Role for ${user.name}`}
                                      value={user.role}
                                      onChange={(e) => handleRoleChange(user.id, e.target.value as Role)}
                                      className="rounded-md border border-border-strong bg-surface px-2 py-1 text-sm"
                                    >
                                      <option value="member">Member</option>
                                      <option value="admin">Admin</option>
                                    </select>
                                  ) : (
                                    <span className="capitalize text-fg-muted">{user.role}</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {section === "appearance" && (
              <div className="card p-4">
                <h3 className="section-title">Theme &amp; font</h3>
                <p className="mt-1 text-xs text-fg-muted">
                  Saved to this browser and applied every time you sign in here.
                </p>

                <div className="mt-4">
                  <p className="field-label">Theme</p>
                  <div className="mt-1.5 flex gap-2">
                    {THEME_OPTIONS.map((opt) => (
                      <button
                        key={opt.mode}
                        type="button"
                        onClick={() => setTheme(opt.mode)}
                        aria-pressed={theme === opt.mode}
                        className={`flex-1 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm ${
                          theme === opt.mode
                            ? "border-accent bg-accent text-accent-fg"
                            : "border-border-strong text-fg hover:bg-surface-hover"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4">
                  <label htmlFor="font-select" className="field-label">
                    Font
                  </label>
                  <select
                    id="font-select"
                    value={font}
                    onChange={(e) => setFont(e.target.value as FontChoice)}
                    className="input mt-1.5"
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {FONT_LABELS[f]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {section === "integrations" && (
              <div className="card p-4">
                <h3 className="section-title">Google Calendar</h3>
                <p className="mt-1 text-xs text-fg-muted">
                  Connect your Google Calendar so booked meetings you&apos;re assigned to appear on it
                  automatically. No invite emails are sent — this only creates a private event on your own
                  calendar.
                </p>

                {calendarStatus === "connected" && (
                  <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
                    Google Calendar connected.
                  </p>
                )}
                {calendarStatus === "error" && (
                  <p className="text-error mt-3">Couldn&apos;t connect Google Calendar — please try again.</p>
                )}

                {calendarConnection === undefined && <p className="mt-3 text-sm text-fg-muted">Loading…</p>}

                {calendarConnection === null && (
                  <a href={api.googleCalendarConnectUrl()} className="btn btn-primary mt-3 inline-flex">
                    Connect Google Calendar
                  </a>
                )}

                {calendarConnection && (
                  <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                    <div>
                      <p className="text-fg">Connected as {calendarConnection.google_email ?? "unknown"}</p>
                      <p className="text-xs text-fg-muted">
                        Since {new Date(calendarConnection.connected_at).toLocaleDateString()}
                      </p>
                    </div>
                    <button onClick={handleDisconnectCalendar} disabled={disconnecting} className="btn btn-secondary shrink-0">
                      {disconnecting ? "Disconnecting…" : "Disconnect"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {section === "ai" && (
              <div className="card p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="section-title">AI providers</h3>
                  <button
                    onClick={handleRecheckAi}
                    disabled={aiChecking}
                    className="text-xs text-fg-muted underline hover:text-fg disabled:opacity-50"
                  >
                    {aiChecking ? "Checking…" : "Run live check"}
                  </button>
                </div>
                <p className="mt-1 text-xs text-fg-muted">
                  Routine AI (summaries, scoring, drafts) runs on the local model; creative and
                  website-generation work runs on the premium model.
                </p>

                {aiStatus === undefined && <p className="mt-3 text-sm text-fg-muted">Loading…</p>}
                {aiStatus === null && <p className="mt-3 text-sm text-error">Couldn&apos;t load AI provider status.</p>}
                {aiStatus && (
                  <div className="mt-3 space-y-3">
                    <ProviderRow label="Local AI" name="Ollama" status={aiStatus.local} />
                    <ProviderRow label="Premium AI" name="Anthropic" status={aiStatus.premium} />
                    {aiStatus.probed && <p className="text-xs text-fg-muted">Live check run just now.</p>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showAddUser && isAdmin && (
        <div className="modal-overlay" role="presentation" onClick={() => setShowAddUser(false)}>
          <div
            className="modal-panel max-w-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-teammate-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="add-teammate-title" className="section-title">
              Add teammate
            </h2>
            <p className="mt-1 text-xs text-fg-muted">
              Share the password with them securely — password changes and resets aren&apos;t built yet, so
              pick one you&apos;re both happy to keep.
            </p>
            <form onSubmit={handleAddUser} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="new-user-name" className="field-label">
                  Name
                </label>
                <input
                  id="new-user-name"
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input mt-1.5"
                />
              </div>
              <div>
                <label htmlFor="new-user-email" className="field-label">
                  Email
                </label>
                <input
                  id="new-user-email"
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input mt-1.5"
                />
              </div>
              <div>
                <label htmlFor="new-user-password" className="field-label">
                  Password
                </label>
                <input
                  id="new-user-password"
                  required
                  type="password"
                  minLength={12}
                  placeholder="Min 12 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input mt-1.5"
                />
              </div>
              <div>
                <label htmlFor="new-user-role" className="field-label">
                  Role
                </label>
                <select
                  id="new-user-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="input mt-1.5"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {userError && <p className="text-error sm:col-span-2">{userError}</p>}
              <div className="flex justify-end gap-2 sm:col-span-2">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowAddUser(false);
                    setUserError(null);
                  }}
                >
                  Cancel
                </button>
                <button type="submit" disabled={savingUser} className="btn btn-primary">
                  {savingUser ? "Adding…" : "Add teammate"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-4 sm:p-6" />}>
      <SettingsPageInner />
    </Suspense>
  );
}

function ProviderRow({
  label,
  name,
  status,
}: {
  label: string;
  name: string;
  status: AiProviderStatus;
}) {
  const badge = status.ok
    ? { text: status.detail === "Connected" ? "Connected" : "Configured", cls: "text-emerald-700 dark:text-emerald-400" }
    : status.configured
      ? { text: "Unavailable", cls: "text-amber-700 dark:text-amber-400" }
      : { text: "Not configured", cls: "text-fg-muted" };

  return (
    <div className="border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg">
          <span className="text-xs uppercase tracking-wide text-fg-muted">{label}</span>{" "}
          {name}
        </p>
        <span className={`text-sm font-medium ${badge.cls}`}>{badge.text}</span>
      </div>
      {status.model && (
        <p className="mt-0.5 text-xs text-fg-muted">Model: {status.model}</p>
      )}
      {!status.ok && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{status.detail}</p>
      )}
    </div>
  );
}
