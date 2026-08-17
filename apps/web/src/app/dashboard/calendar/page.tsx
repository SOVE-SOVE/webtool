"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  type CalendarEvent,
  type Lead,
  type Meeting,
  type Project,
} from "@/lib/api";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [parentType, setParentType] = useState<"lead" | "project">("lead");
  const [parentId, setParentId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [meetingError, setMeetingError] = useState<string | null>(null);
  const [meetingBusy, setMeetingBusy] = useState(false);

  const days = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  function load() {
    const start = days[0];
    const end = days[days.length - 1];
    api
      .listCalendarEvents(toDateKey(start), toDateKey(end))
      .then(setEvents)
      .catch(() => setError("Couldn't load the calendar."));
  }

  useEffect(load, [cursor]);
  useEffect(() => {
    api.listLeads().then(setLeads).catch(() => {});
    api.listProjects().then(setProjects).catch(() => {});
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
        scheduled_at,
        notes: notes || undefined,
        ...(parentType === "lead" ? { lead_id: parentId } : { project_id: parentId }),
      });
      setTitle("");
      setDate("");
      setTime("10:00");
      setParentId("");
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

  async function handleMarkHeld() {
    if (!selectedMeeting) return;
    setMeetingBusy(true);
    try {
      const updated = await api.updateMeeting(selectedMeeting.id, { held_at: new Date().toISOString() });
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

  async function handleDeleteMeeting() {
    if (!selectedMeeting) return;
    setMeetingBusy(true);
    try {
      await api.deleteMeeting(selectedMeeting.id);
      setSelectedMeeting(null);
      load();
    } catch {
      setMeetingError("Couldn't cancel that meeting.");
    } finally {
      setMeetingBusy(false);
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
            {selectedMeeting.context} · {new Date(selectedMeeting.scheduled_at).toLocaleString()}
            {selectedMeeting.held_at && ` · Held ${new Date(selectedMeeting.held_at).toLocaleDateString()}`}
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
            {!selectedMeeting.held_at && (
              <button
                onClick={handleMarkHeld}
                disabled={meetingBusy}
                className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
              >
                Mark held
              </button>
            )}
            <button
              onClick={handleDeleteMeeting}
              disabled={meetingBusy}
              className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Cancel meeting
            </button>
          </div>
        </section>
      )}
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
