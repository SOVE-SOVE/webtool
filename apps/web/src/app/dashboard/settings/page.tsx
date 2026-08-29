"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type CalendarConnection, type Me, type Role, type User } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { FONT_LABELS, useTheme, type FontChoice, type ThemeMode } from "@/components/ui/ThemeProvider";

const THEME_OPTIONS: { mode: ThemeMode; label: string }[] = [
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
  { mode: "system", label: "Match system" },
];

const FONT_OPTIONS = Object.keys(FONT_LABELS) as FontChoice[];

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme, font, setFont } = useTheme();
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [calendarConnection, setCalendarConnection] = useState<CalendarConnection | null | undefined>(undefined);
  const [disconnecting, setDisconnecting] = useState(false);
  // Read directly from window.location rather than next/navigation's
  // useSearchParams, which requires a Suspense boundary during static
  // generation — not worth it for reading one param from an OAuth
  // redirect. "connected" | "error" | null.
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);
  useEffect(() => {
    setCalendarStatus(new URLSearchParams(window.location.search).get("calendar"));
  }, []);

  const [workspaceName, setWorkspaceName] = useState("");
  const [savingWorkspace, setSavingWorkspace] = useState(false);

  const [showAddUser, setShowAddUser] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [savingUser, setSavingUser] = useState(false);

  function load() {
    api.me().then((m) => {
      setMe(m);
      setWorkspaceName(m.workspace_name);
    }).catch(() => {});
    api.listUsers().then(setUsers).catch(() => {});
    api.getGoogleCalendarStatus().then(setCalendarConnection).catch(() => setCalendarConnection(null));
  }

  useEffect(load, []);

  async function handleDisconnectCalendar() {
    setDisconnecting(true);
    try {
      await api.disconnectGoogleCalendar();
      setCalendarConnection(null);
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
    setError(null);
    try {
      await api.updateWorkspace(workspaceName);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't rename workspace.");
    } finally {
      setSavingWorkspace(false);
    }
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setSavingUser(true);
    setError(null);
    try {
      await api.createUser({ name, email, password, role });
      setName("");
      setEmail("");
      setPassword("");
      setRole("member");
      setShowAddUser(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add teammate.");
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
    <div className="p-6">
      <PageHeader title="Settings" description="Your account, workspace, teammates, and integrations." />

      <div className="mt-6 max-w-md space-y-4 border border-border p-4">
        <div>
          <p className="text-xs text-fg-muted">Signed in as</p>
          <p className="mt-1 text-sm text-fg">
            {me?.name} ({me?.email}) — {me?.role}
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-surface-subtle"
        >
          Sign out
        </button>
      </div>

      {error && <p className="mt-4 max-w-md text-error">{error}</p>}

      <section className="mt-6 max-w-md border border-border p-4">
        <h2 className="text-sm font-semibold text-fg">Appearance</h2>
        <p className="mt-1 text-xs text-fg-muted">Saved to this browser and applied every time you sign in here.</p>

        <div className="mt-3">
          <p className="field-label">Theme</p>
          <div className="mt-1.5 flex gap-2">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.mode}
                type="button"
                onClick={() => setTheme(opt.mode)}
                aria-pressed={theme === opt.mode}
                className={`flex-1 rounded-md border px-3 py-1.5 text-sm ${
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
          <p className="field-label">Font</p>
          <select
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
      </section>

      <section className="mt-6 max-w-md border border-border p-4">
        <h2 className="text-sm font-semibold text-fg">Calendar</h2>
        <p className="mt-1 text-xs text-fg-muted">
          Connect your Google Calendar so booked meetings you&apos;re assigned to appear on it
          automatically. No invite emails are sent — this only creates a private event on your own
          calendar.
        </p>

        {calendarStatus === "connected" && (
          <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">Google Calendar connected.</p>
        )}
        {calendarStatus === "error" && (
          <p className="mt-2 text-error">
            Couldn&apos;t connect Google Calendar — please try again.
          </p>
        )}

        {calendarConnection === undefined && <p className="mt-3 text-sm text-fg-muted">Loading…</p>}

        {calendarConnection === null && (
          <a
            href={api.googleCalendarConnectUrl()}
            className="mt-3 inline-block btn btn-primary"
          >
            Connect Google Calendar
          </a>
        )}

        {calendarConnection && (
          <div className="mt-3 flex items-center justify-between text-sm">
            <div>
              <p className="text-fg">Connected as {calendarConnection.google_email ?? "unknown"}</p>
              <p className="text-xs text-fg-muted">
                Since {new Date(calendarConnection.connected_at).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={handleDisconnectCalendar}
              disabled={disconnecting}
              className="rounded-md border border-border-strong px-3 py-1.5 text-sm hover:bg-surface-subtle disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        )}
      </section>

      <section className="mt-6 max-w-md border border-border p-4">
        <h2 className="text-sm font-semibold text-fg">Workspace</h2>
        {isAdmin ? (
          <form onSubmit={handleRenameWorkspace} className="mt-3 flex gap-2">
            <input
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              className="flex-1 rounded-md border border-border-strong px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={savingWorkspace}
              className="btn btn-primary"
            >
              {savingWorkspace ? "Saving…" : "Save"}
            </button>
          </form>
        ) : (
          <p className="mt-2 text-sm text-fg-muted">{me?.workspace_name}</p>
        )}
        <p className="mt-2 text-xs text-fg-muted">
          Everyone in this workspace shares the same leads, clients, projects, and tasks — see
          docs/01_REQUIREMENTS.md &quot;Multi-user &amp; workspace&quot;.
        </p>
      </section>

      <section className="mt-6 max-w-2xl border border-border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">People</h2>
          {isAdmin && (
            <button
              onClick={() => setShowAddUser((v) => !v)}
              className="btn btn-primary"
            >
              {showAddUser ? "Cancel" : "Add teammate"}
            </button>
          )}
        </div>

        {showAddUser && isAdmin && (
          <form onSubmit={handleAddUser} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              required
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-border-strong px-3 py-1.5 text-sm"
            />
            <input
              required
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-border-strong px-3 py-1.5 text-sm"
            />
            <input
              required
              type="password"
              placeholder="Temporary password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-border-strong px-3 py-1.5 text-sm"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="rounded-md border border-border-strong px-3 py-1.5 text-sm"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              disabled={savingUser}
              className="col-span-2 btn btn-primary"
            >
              {savingUser ? "Adding…" : "Add teammate"}
            </button>
          </form>
        )}

        {users && (
          <div className="mt-4 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-subtle text-xs uppercase text-fg-muted">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-3 py-2 font-medium text-fg">{user.name}</td>
                  <td className="px-3 py-2 text-fg-muted">{user.email}</td>
                  <td className="px-3 py-2">
                    {isAdmin ? (
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleChange(user.id, e.target.value as Role)}
                        className="rounded-md border border-border-strong px-2 py-1 text-sm"
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    ) : (
                      <span className="text-fg-muted">{user.role}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>
    </div>
  );
}
