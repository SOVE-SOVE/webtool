import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyAfter, notifyTodayDataChanged, subscribeTodayDataChanged, subscribeToOtherTabs } from "./todaySync";

// The vitest environment is node (no DOM), so `window` is a bare
// EventTarget — all todaySync needs from it is add/remove/dispatchEvent.
let target: EventTarget;
let added = 0;
let removed = 0;

beforeEach(() => {
  target = new EventTarget();
  added = 0;
  removed = 0;
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  target.addEventListener = ((...a: Parameters<typeof add>) => {
    added++;
    add(...a);
  }) as typeof add;
  target.removeEventListener = ((...a: Parameters<typeof remove>) => {
    removed++;
    remove(...a);
  }) as typeof remove;
  vi.stubGlobal("window", target);
});

afterEach(() => vi.unstubAllGlobals());

describe("todaySync", () => {
  it("delivers a notification to every mounted subscriber", () => {
    const tasks = vi.fn();
    const calendar = vi.fn();
    const overview = vi.fn();
    subscribeTodayDataChanged(tasks);
    subscribeTodayDataChanged(calendar);
    subscribeTodayDataChanged(overview);
    notifyTodayDataChanged();
    expect([tasks, calendar, overview].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("stops delivering to a subscriber once it unsubscribes, and leaves the others alone", () => {
    const gone = vi.fn();
    const kept = vi.fn();
    const unsubscribe = subscribeTodayDataChanged(gone);
    subscribeTodayDataChanged(kept);
    unsubscribe();
    notifyTodayDataChanged();
    expect(gone).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).toBe(1);
  });

  it("repeated subscribe/unsubscribe cycles (tab switching) leave no listeners behind", () => {
    const listener = vi.fn();
    for (let i = 0; i < 25; i++) subscribeTodayDataChanged(listener)();
    expect(added).toBe(25);
    expect(removed).toBe(25);
    notifyTodayDataChanged();
    expect(listener).not.toHaveBeenCalled();
  });

  it("a tab ignores its own announcement but reloads for every other tab's", () => {
    const tasksReload = vi.fn();
    const calendarReload = vi.fn();
    const overviewReload = vi.fn();
    subscribeToOtherTabs("tasks", tasksReload);
    subscribeToOtherTabs("calendar", calendarReload);
    subscribeToOtherTabs("overview", overviewReload);
    notifyTodayDataChanged("tasks");
    expect([tasksReload, calendarReload, overviewReload].map((f) => f.mock.calls.length)).toEqual([0, 1, 1]);
    notifyTodayDataChanged("calendar");
    expect([tasksReload, calendarReload, overviewReload].map((f) => f.mock.calls.length)).toEqual([1, 1, 2]);
  });

  it("an unattributed announcement reloads every tab", () => {
    const reloads = (["overview", "tasks", "calendar"] as const).map((t) => {
      const fn = vi.fn();
      subscribeToOtherTabs(t, fn);
      return fn;
    });
    notifyTodayDataChanged();
    expect(reloads.map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("reloading is not itself an announcement — no ping-pong between tabs", () => {
    const reload = vi.fn();
    subscribeToOtherTabs("calendar", reload);
    const dispatched = vi.spyOn(target, "dispatchEvent");
    notifyTodayDataChanged("tasks");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(dispatched).toHaveBeenCalledTimes(1);
  });

  it("subscribeToOtherTabs unsubscribes cleanly", () => {
    const reload = vi.fn();
    subscribeToOtherTabs("calendar", reload)();
    notifyTodayDataChanged("tasks");
    expect(reload).not.toHaveBeenCalled();
    expect(added).toBe(removed);
  });

  it("notifyAfter announces a successful mutation, after it resolves, and returns its result", async () => {
    const listener = vi.fn();
    subscribeTodayDataChanged(listener);
    let resolve!: (v: string) => void;
    const pending = notifyAfter(new Promise<string>((r) => (resolve = r)));
    expect(listener).not.toHaveBeenCalled();
    resolve("saved");
    await expect(pending).resolves.toBe("saved");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifyAfter attributes the change to the tab that made it", async () => {
    const seen: (string | undefined)[] = [];
    subscribeTodayDataChanged((source) => seen.push(source));
    await notifyAfter(Promise.resolve(1), "tasks");
    expect(seen).toEqual(["tasks"]);
  });

  it("notifyAfter stays silent and rethrows when the mutation fails", async () => {
    const listener = vi.fn();
    subscribeTodayDataChanged(listener);
    await expect(notifyAfter(Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(listener).not.toHaveBeenCalled();
  });

  it("is a safe no-op with no window (server render)", () => {
    vi.unstubAllGlobals();
    expect(() => notifyTodayDataChanged()).not.toThrow();
  });
});
