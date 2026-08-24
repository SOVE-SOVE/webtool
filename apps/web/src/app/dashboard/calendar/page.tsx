"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  MEETING_TYPES,
  type CalendarEvent,
  type DueReminder,
  type Lead,
  type Meeting,
  type MeetingStatus,
  type MeetingType,
  type Project,
  type User,
} from "@/lib/api";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  sales_call: "Sales call",
  client_check_in: "Client check-in",
  other: "Other",
};

const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  scheduled: "Scheduled",
  held: "Held",
  cancelled: "Cancelled",
  no_show: "No-show",
};

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Full weeks (Sun-start) covering the given month, so days from the
// adjacent month that share a row still get their events fetched/shown.
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

const inputClass = "w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm";

export default function CalendarPage() {
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [meetingType, setMeetingType] = useState<MeetingType | "">("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState("30");
  const [parentType, setParentType] = useState<"lead" | "project">("lead");
  const [parentId, setParentId] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [meetingError, setMeetingError] = useState<string | null>(null);
  const [meetingBusy, setMeetingBusy] = useState(false);

  const [dueReminders, setDueReminders] = useState<DueReminder[]>([]);

  const days = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  function load() {
    const start = days[0];
    const end = days[days.length - 1];
    api
      .listCalendarEvents(toDateKey(start), toDateKey(end))
      .then(setEvents)
      .catch(() => setError("Couldn't load the calendar."));
  }

  function loadDueReminders() {
    api.listDueReminders().then(setDueReminders).catch(() => {});
  }

  useEffect(load, [cursor]);
  useEffect(() => {
    api.listLeads().then(setLeads).catch(() => {});
    api.listProjects().then(setProjects).catch(() => {});
    api.listUsers().then(setUsers).catch(() => {});
    loadDueReminders();
  }, []);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events ?? []) {
      const key = toDateKey(new Date(event.at));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(event);
    }
    return map;
  }, [events]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!parentId || !date) return;
    setSaving(true);
    setFormError(null);
    try {
      const scheduled_at = new Date(`${date}T${time || "00:00"}`).toISOString();
      await api.createMeeting({
        title,
        meeting_type: meetingType || undefined,
        scheduled_at,
        duration_minutes: Number(duration) || 30,
        notes: notes || undefined,
        assigned_user_id: assignedUserId || undefined,
        ...(parentType === "lead" ? { lead_id: parentId } : { project_id: parentId }),
      });
      setTitle("");
      setMeetingType("");
      setDate("");
      setTime("10:00");
      setDuration("30");
      setParentId("");
      setAssignedUserId("");
      setNotes("");
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Couldn't schedule the meeting.");
    } finally {
      setSaving(false);
    }
  }

  async function openMeeting(id: string) {
    setMeetingError(null);
    try {
      setSelectedMeeting(await api.getMeeting(id));
    } catch {
      setMeetingError("Couldn't load that meeting.");
    }
  }

  async function handleStatusChange(status: MeetingStatus) {
    if (!selectedMeeting) return;
    setMeetingBusy(true);
    setMeetingError(null);
    try {
      const updated = await api.updateMeeting(selectedMeeting.id, { status });
      setSelectedMeeting(updated);
      load();
    } catch {
      setMeetingError("Couldn't update that meeting.");
    } finally {
      setMeetingBusy(false);
    }
  }

  async function handleSaveOutcome(outcome: string) {
    if (!selectedMeeting) return;
    const updated = await api.updateMeeting(selectedMeeting.id, { outcome: outcome || null });
    setSelectedMeeting(updated);
  }

  async function handleSaveNotes(value: string) {
    if (!selectedMeeting) return;
    const updated = await api.updateMeeting(selectedMeeting.id, { notes: value || null });
    setSelectedMeeting(updated);
  }

  async function handleGenerateBrief() {
    if (!selectedMeeting) return;
    setMeetingBusy(true);
    setMeetingError(null);
    try {
      const updated = await api.generateMeetingBrief(selectedMeeting.id);
      setSelectedMeeting(updated);
    } catch (err) {
      setMeetingError(err instanceof ApiError ? err.message : "Couldn't generate a meeting brief.");
    } finally {
      setMeetingBusy(false);
    }
  }

  async function handleAddAttendee(email: string, name: string) {
    if (!selectedMeeting) return;
    try {
      const updated = await api.addMeetingAttendee(selectedMeeting.id, {
        email,
        name: name || undefined,
      });
      setSelectedMeeting(updated);
    } catch (err) {
      setMeetingError(err instanceof ApiError ? err.message : "Couldn't add that attendee.");
    }
  }

  async function handleRemoveAttendee(attendeeId: string) {
    if (!selectedMeeting) return;
    try {
      const updated = await api.removeMeetingAttendee(selectedMeeting.id, attendeeId);
      setSelectedMeeting(updated);
    } catch {
      setMeetingError("Couldn't remove that attendee.");
    }
  }

  async function handleAddReminder(remindAt: string, note: string) {
    if (!selectedMeeting || !remindAt) return;
    try {
      const updated = await api.addMeetingReminder(selectedMeeting.id, {
        remind_at: new Date(remindAt).toISOString(),
        note: note || undefined,
      });
      setSelectedMeeting(updated);
      loadDueReminders();
    } catch (err) {
      setMeetingError(err instanceof ApiError ? err.message : "Couldn't add that reminder.");
    }
  }

  async function handleRemoveReminder(reminderId: string) {
    if (!selectedMeeting) return;
    try {
      const updated = await api.removeMeetingReminder(selectedMeeting.id, reminderId);
      setSelectedMeeting(updated);
      loadDueReminders();
    } catch {
      setMeetingError("Couldn't remove that reminder.");
    }
  }

  async function handleAcknowledgeReminder(meetingId: string, reminderId: string) {
    try {
      const updated = await api.acknowledgeMeetingReminder(meetingId, reminderId);
      if (selectedMeeting?.id === meetingId) setSelectedMeeting(updated);
      loadDueReminders();
    } catch {
      setMeetingError("Couldn't dismiss that reminder.");
    }
  }

  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const todayKey = toDateKey(today);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Calendar</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          {showForm ? "Cancel" : "Schedule meeting"}
        </button>
      </div>

      {dueReminders.length > 0 && (
        <div className="mt-4 max-w-2xl space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            Reminders due ({dueReminders.length})
          </p>
          {dueReminders.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 text-sm">
              <button
                onClick={() => openMeeting(r.meeting_id)}
                className="truncate text-left text-amber-900 hover:underline"
                title={r.note ?? undefined}
              >
                {r.meeting_title} — {r.meeting_context} ({new Date(r.meeting_scheduled_at).toLocaleString()})
                {r.note ? `: ${r.note}` : ""}
              </button>
              <button
                onClick={() => handleAcknowledgeReminder(r.meeting_id, r.id)}
                className="shrink-0 rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100"
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 max-w-2xl space-y-3 border border-neutral-200 p-4">
          <input
            required
            placeholder="Meeting title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
          />
          <div className="flex gap-3">
            <input
              required
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
            />
            <input
              required
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={inputClass}
            />
            <select value={duration} onChange={(e) => setDuration(e.target.value)} className={inputClass}>
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="45">45 min</option>
              <option value="60">60 min</option>
            </select>
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={parentType === "lead"}
                onChange={() => {
                  setParentType("lead");
                  setParentId("");
                }}
              />
              Sales call (lead)
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={parentType === "project"}
                onChange={() => {
                  setParentType("project");
                  setParentId("");
                }}
              />
              Client check-in (project)
            </label>
          </div>
          <select
            required
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className={inputClass}
          >
            <option value="">{parentType === "lead" ? "Select a lead…" : "Select a project…"}</option>
            {(parentType === "lead" ? leads : projects).map((item) => (
              <option key={item.id} value={item.id}>
                {parentType === "lead" ? (item as Lead).business_name : (item as Project).name}
              </option>
            ))}
          </select>
          <div className="flex gap-3">
            <select
              value={meetingType}
              onChange={(e) => setMeetingType(e.target.value as MeetingType)}
              className={inputClass}
            >
              <option value="">Type: default for {parentType === "lead" ? "sales call" : "check-in"}</option>
              {MEETING_TYPES.map((t) => (
                <option key={t} value={t}>
                  {MEETING_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <select
              value={assignedUserId}
              onChange={(e) => setAssignedUserId(e.target.value)}
              className={inputClass}
            >
              <option value="">Assigned: same as {parentType}</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </div>
          <textarea
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={inputClass}
          />
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save meeting"}
          </button>
        </form>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
          className="rounded-md border border-neutral-300 px-2.5 py-1 text-sm hover:bg-neutral-50"
        >
          ← Prev
        </button>
        <span className="text-sm font-medium text-neutral-900">{monthLabel}</span>
        <button
          onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
          className="rounded-md border border-neutral-300 px-2.5 py-1 text-sm hover:bg-neutral-50"
        >
          Next →
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 border-l border-t border-neutral-200 text-xs">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="border-b border-r border-neutral-200 bg-neutral-50 px-2 py-1 font-medium text-neutral-500">
            {label}
          </div>
        ))}
        {days.map((day) => {
          const key = toDateKey(day);
          const inMonth = day.getMonth() === cursor.getMonth();
          const dayEvents = eventsByDay.get(key) ?? [];
          return (
            <div
              key={key}
              className={`min-h-[6rem] border-b border-r border-neutral-200 px-1.5 py-1 align-top ${
                inMonth ? "bg-white" : "bg-neutral-50"
              }`}
            >
              <div
                className={`text-[11px] ${
                  key === todayKey
                    ? "font-semibold text-neutral-900"
                    : inMonth
                      ? "text-neutral-500"
                      : "text-neutral-300"
                }`}
              >
                {day.getDate()}
              </div>
              <div className="mt-1 space-y-0.5">
                {dayEvents.map((event) =>
                  event.kind === "meeting" ? (
                    <button
                      key={`${event.kind}-${event.id}`}
                      onClick={() => openMeeting(event.id)}
                      title={event.detail}
                      className={`block w-full truncate rounded px-1 py-0.5 text-left text-[11px] hover:opacity-80 ${
                        event.done ? "bg-neutral-200 text-neutral-500 line-through" : "bg-blue-100 text-blue-900"
                      }`}
                    >
                      {new Date(event.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}{" "}
                      {event.title}
                    </button>
                  ) : (
                    <Link
                      key={`${event.kind}-${event.id}`}
                      href={event.href}
                      title={event.detail}
                      className="block truncate rounded bg-amber-100 px-1 py-0.5 text-[11px] text-amber-900 hover:opacity-80"
                    >
                      ✓ {event.title}
                    </Link>
                  ),
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedMeeting && (
        <section className="mt-6 max-w-2xl border border-neutral-200 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">{selectedMeeting.title}</h2>
            <button onClick={() => setSelectedMeeting(null)} className="text-xs text-neutral-500 hover:underline">
              Close
            </button>
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            {selectedMeeting.context} · {MEETING_TYPE_LABELS[selectedMeeting.meeting_type]} ·{" "}
            {new Date(selectedMeeting.scheduled_at).toLocaleString()} ({selectedMeeting.duration_minutes} min)
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <span className="rounded bg-neutral-100 px-2 py-0.5 text-neutral-700">
              {MEETING_STATUS_LABELS[selectedMeeting.status]}
            </span>
            {selectedMeeting.assigned_user_name && <span>Assigned to {selectedMeeting.assigned_user_name}</span>}
            {selectedMeeting.synced_to_calendar && <span className="text-emerald-700">Synced to calendar</span>}
          </p>
          {meetingError && <p className="mt-2 text-sm text-red-600">{meetingError}</p>}

          <div className="mt-3 grid grid-cols-2 gap-4">
            {field(
              "Notes",
              <textarea
                defaultValue={selectedMeeting.notes ?? ""}
                onBlur={(e) => handleSaveNotes(e.target.value)}
                rows={3}
                className={inputClass}
              />,
            )}
            {field(
              "Outcome",
              <input
                defaultValue={selectedMeeting.outcome ?? ""}
                onBlur={(e) => handleSaveOutcome(e.target.value)}
                placeholder="e.g. Proceeding to proposal"
                className={inputClass}
              />,
            )}
          </div>

          <div className="mt-4 flex gap-2">
            {selectedMeeting.status === "scheduled" && (
              <>
                <button
                  onClick={() => handleStatusChange("held")}
                  disabled={meetingBusy}
                  className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                >
                  Mark held
                </button>
                <button
                  onClick={() => handleStatusChange("no_show")}
                  disabled={meetingBusy}
                  className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                >
                  Mark no-show
                </button>
                <button
                  onClick={() => handleStatusChange("cancelled")}
                  disabled={meetingBusy}
                  className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Cancel meeting
                </button>
              </>
            )}
            {selectedMeeting.lead_id && (
              <button
                onClick={handleGenerateBrief}
                disabled={meetingBusy}
                className="ml-auto rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
              >
                {meetingBusy ? "Generating…" : selectedMeeting.brief ? "Regenerate brief" : "Generate brief"}
              </button>
            )}
          </div>

          <AttendeesPanel
            attendees={selectedMeeting.attendees}
            onAdd={handleAddAttendee}
            onRemove={handleRemoveAttendee}
          />
          <RemindersPanel
            reminders={selectedMeeting.reminders}
            onAdd={handleAddReminder}
            onRemove={handleRemoveReminder}
          />

          {selectedMeeting.brief && <MeetingBriefPanel brief={selectedMeeting.brief} />}
        </section>
      )}
    </div>
  );
}

function AttendeesPanel({
  attendees,
  onAdd,
  onRemove,
}: {
  attendees: Meeting["attendees"];
  onAdd: (email: string, name: string) => void;
  onRemove: (attendeeId: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  return (
    <div className="mt-5 border-t border-neutral-200 pt-4">
      <h3 className="text-sm font-semibold text-neutral-900">Attendees</h3>
      {attendees.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {attendees.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-sm text-neutral-700">
              <span className="truncate">
                {a.name ? `${a.name} <${a.email}>` : a.email}
                {a.is_organizer && <span className="ml-1 text-xs text-neutral-400">(organizer)</span>}
              </span>
              <button
                onClick={() => onRemove(a.id)}
                className="shrink-0 text-xs text-neutral-400 hover:text-red-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-neutral-400">No attendees added yet.</p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!email) return;
          onAdd(email, name);
          setEmail("");
          setName("");
        }}
        className="mt-2 flex gap-2"
      >
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${inputClass} flex-1`}
        />
        <input
          placeholder="Name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${inputClass} flex-1`}
        />
        <button
          type="submit"
          className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50"
        >
          Add
        </button>
      </form>
    </div>
  );
}

function RemindersPanel({
  reminders,
  onAdd,
  onRemove,
}: {
  reminders: Meeting["reminders"];
  onAdd: (remindAt: string, note: string) => void;
  onRemove: (reminderId: string) => void;
}) {
  const [remindAt, setRemindAt] = useState("");
  const [note, setNote] = useState("");

  return (
    <div className="mt-5 border-t border-neutral-200 pt-4">
      <h3 className="text-sm font-semibold text-neutral-900">Reminders</h3>
      <p className="mt-0.5 text-xs text-neutral-400">
        Shown here (and in the banner above) once due — this app has no email/push delivery.
      </p>
      {reminders.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {reminders.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 text-sm text-neutral-700">
              <span className="truncate">
                {new Date(r.remind_at).toLocaleString()}
                {r.note ? ` — ${r.note}` : ""}
                {r.acknowledged_at && <span className="ml-1 text-xs text-neutral-400">(dismissed)</span>}
              </span>
              <button
                onClick={() => onRemove(r.id)}
                className="shrink-0 text-xs text-neutral-400 hover:text-red-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-neutral-400">No reminders set.</p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!remindAt) return;
          onAdd(remindAt, note);
          setRemindAt("");
          setNote("");
        }}
        className="mt-2 flex gap-2"
      >
        <input
          type="datetime-local"
          required
          value={remindAt}
          onChange={(e) => setRemindAt(e.target.value)}
          className={`${inputClass} flex-1`}
        />
        <input
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={`${inputClass} flex-1`}
        />
        <button
          type="submit"
          className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50"
        >
          Add
        </button>
      </form>
    </div>
  );
}

function briefList(label: string, items: string[], empty: string) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      {items.length > 0 ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-neutral-700">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-neutral-400">{empty}</p>
      )}
    </div>
  );
}

function MeetingBriefPanel({ brief }: { brief: NonNullable<Meeting["brief"]> }) {
  return (
    <div className="mt-5 border-t border-neutral-200 pt-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-neutral-900">Meeting brief</h3>
        {brief.flagged_for_review && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Flagged for review</span>
        )}
      </div>
      {brief.review_notes && <p className="mt-1 text-xs text-neutral-500">{brief.review_notes}</p>}

      <div className="mt-3 space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-900">Business</p>
          <p className="mt-1 text-sm text-neutral-700">
            {brief.business_name}
            {brief.business_industry ? ` · ${brief.business_industry}` : ""}
            {brief.business_location ? ` · ${brief.business_location}` : ""}
          </p>
          {brief.business_website && (
            <p className="text-sm text-neutral-500">
              <a href={brief.business_website} target="_blank" rel="noreferrer" className="hover:underline">
                {brief.business_website}
              </a>
            </p>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-900">Website</p>
          <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {briefList("Strengths", brief.website_strengths, "None on record")}
            {briefList("Weaknesses", brief.website_weaknesses, "None on record")}
            {briefList("Opportunities", brief.website_opportunities, "None on record")}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-900">Sales</p>
          <p className="mt-1 text-sm text-neutral-700">
            Lead score: {brief.lead_score !== null ? brief.lead_score : "not scored"}
          </p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {briefList("Previous interactions", brief.previous_interactions, "None on record")}
            {briefList("Outreach history", brief.outreach_history, "None on record")}
            {briefList("Objections", brief.objections, "None on record")}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-900">Discovery</p>
          <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {briefList("Questions to ask", brief.questions_to_ask, "Not generated")}
            {briefList("Likely requirements", brief.likely_requirements, "Not generated")}
          </div>
          <p className="mt-2 text-sm text-neutral-700">
            <span className="text-xs uppercase tracking-wide text-neutral-500">Possible package: </span>
            {brief.possible_package}
          </p>
          <p className="text-sm text-neutral-700">
            <span className="text-xs uppercase tracking-wide text-neutral-500">Suggested pricing range: </span>
            {brief.suggested_pricing_range}
          </p>
        </div>
      </div>
    </div>
  );
}

function field(label: string, value: React.ReactNode) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}
