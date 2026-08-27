"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type CalendarConnection, type Me, type Role, type User } from "@/lib/api";

export default function SettingsPage() {
  const router = useRouter();
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
    // window.location is only available post-hydration, so this can't be
    // a lazy useState initializer (that also runs during SSR) — an effect
    // is the correct tool here, not the derived-state case this rule
    // targets.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    api
      .me()
      .then((m) => {
        setMe(m);
        setWorkspaceName(m.workspace_name);
      })
      .catch(() => setError("Couldn't load your account. Try refreshing the page."));
    api.listUsers().then(setUsers).catch(() => setError("Couldn't load teammates."));
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
    try {
      await api.updateUserRole(userId, { role: newRole });
      setError(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't change that teammate's role.");
    }
  }

  const isAdmin = me?.role === "admin";

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-neutral-900">Settings</h1>

      <div className="mt-6 max-w-md space-y-4 border border-neutral-200 p-4">
        <div>
          <p className="text-xs text-neutral-500">Signed in as</p>
          <p className="mt-1 text-sm text-neutral-900">
            {me?.name} ({me?.email}) — {me?.role}
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Sign out
        </button>
      </div>

      {error && <p className="mt-4 max-w-md text-sm text-red-600">{error}</p>}

      <section className="mt-6 max-w-md border border-neutral-200 p-4">
        <h2 className="text-sm font-semibold text-neutral-900">Calendar</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Connect your Google Calendar so booked meetings you&apos;re assigned to appear on it
          automatically. No invite emails are sent — this only creates a private event on your own
          calendar.
        </p>

        {calendarStatus === "connected" && (
          <p className="mt-2 text-sm text-emerald-700">Google Calendar connected.</p>
        )}
        {calendarStatus === "error" && (
          <p className="mt-2 text-sm text-red-600">
            Couldn&apos;t connect Google Calendar — please try again.
          </p>
        )}

        {calendarConnection === undefined && <p className="mt-3 text-sm text-neutral-500">Loading…</p>}

        {calendarConnection === null && (
          <a
            href={api.googleCalendarConnectUrl()}
            className="mt-3 inline-block rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Connect Google Calendar
          </a>
        )}

        {calendarConnection && (
          <div className="mt-3 flex items-center justify-between text-sm">
            <div>
              <p className="text-neutral-900">Connected as {calendarConnection.google_email ?? "unknown"}</p>
              <p className="text-xs text-neutral-500">
                Since {new Date(calendarConnection.connected_at).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={handleDisconnectCalendar}
              disabled={disconnecting}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        )}
      </section>

      <section className="mt-6 max-w-md border border-neutral-200 p-4">
        <h2 className="text-sm font-semibold text-neutral-900">Workspace</h2>
        {isAdmin ? (
          <form onSubmit={handleRenameWorkspace} className="mt-3 flex gap-2">
            <input
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={savingWorkspace}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {savingWorkspace ? "Saving…" : "Save"}
            </button>
          </form>
        ) : (
          <p className="mt-2 text-sm text-neutral-700">{me?.workspace_name}</p>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          Everyone in this workspace shares the same leads, clients, projects, and tasks — see
          docs/01_REQUIREMENTS.md &quot;Multi-user &amp; workspace&quot;.
        </p>
      </section>

      <section className="mt-6 max-w-2xl border border-neutral-200 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">People</h2>
          {isAdmin && (
            <button
              onClick={() => setShowAddUser((v) => !v)}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
            >
              {showAddUser ? "Cancel" : "Add teammate"}
            </button>
          )}
        </div>

        {showAddUser && isAdmin && (
          <form onSubmit={handleAddUser} className="mt-3 grid grid-cols-2 gap-3">
            <input
              required
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            />
            <input
              required
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            />
            <input
              required
              type="password"
              placeholder="Temporary password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              disabled={savingUser}
              className="col-span-2 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {savingUser ? "Adding…" : "Add teammate"}
            </button>
          </form>
        )}

        {users && (
          <table className="mt-4 w-full border border-neutral-200 text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-3 py-2 font-medium text-neutral-900">{user.name}</td>
                  <td className="px-3 py-2 text-neutral-600">{user.email}</td>
                  <td className="px-3 py-2">
                    {isAdmin ? (
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleChange(user.id, e.target.value as Role)}
                        className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    ) : (
                      <span className="text-neutral-600">{user.role}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
