import { describe, expect, it } from "vitest";
import {
  followUpBusinessLabel,
  isFollowUpQueueEmpty,
  scheduledFollowUpCount,
} from "./followUps";
import type { FollowUp, FollowUpBuckets, FollowUpCandidate } from "./api";

function followUp(id: string): FollowUp {
  return {
    id,
    lead_id: `lead-${id}`,
    business_name: `Business ${id}`,
    channel: "email",
    due_date: "2026-09-01",
    suggested_next_action: "Send a check-in email",
    status: "pending",
    previous_outreach: null,
    generated_by_user_name: null,
    generated_at: "2026-08-30T00:00:00Z",
    resolved_by_user_name: null,
    resolved_at: null,
  };
}

function buckets(overdue = 0, dueToday = 0, upcoming = 0): FollowUpBuckets {
  return {
    overdue: Array.from({ length: overdue }, (_, i) => followUp(`o${i}`)),
    due_today: Array.from({ length: dueToday }, (_, i) => followUp(`d${i}`)),
    upcoming: Array.from({ length: upcoming }, (_, i) => followUp(`u${i}`)),
  };
}

const candidate: FollowUpCandidate = {
  lead_id: "lead-c",
  business_name: "Quiet Co",
  lead_status: "contacted",
  reason: "No contact in 14 days",
  suggested_channel: "email",
  days_quiet: 14,
};

describe("scheduledFollowUpCount", () => {
  it("is 0 for null or all-empty buckets", () => {
    expect(scheduledFollowUpCount(null)).toBe(0);
    expect(scheduledFollowUpCount(buckets())).toBe(0);
  });
  it("sums the three buckets", () => {
    expect(scheduledFollowUpCount(buckets(2, 1, 3))).toBe(6);
  });
});

describe("isFollowUpQueueEmpty", () => {
  it("is empty when buckets are null/empty and there are no candidates", () => {
    expect(isFollowUpQueueEmpty(null, [])).toBe(true);
    expect(isFollowUpQueueEmpty(buckets(), [])).toBe(true);
  });
  it("is not empty with a scheduled follow-up in any bucket", () => {
    expect(isFollowUpQueueEmpty(buckets(1, 0, 0), [])).toBe(false);
    expect(isFollowUpQueueEmpty(buckets(0, 0, 1), [])).toBe(false);
  });
  it("is not empty when only a candidate exists", () => {
    expect(isFollowUpQueueEmpty(buckets(), [candidate])).toBe(false);
  });
});

describe("followUpBusinessLabel", () => {
  it("returns the trimmed business name when present", () => {
    expect(followUpBusinessLabel({ business_name: "  Acme Plumbing  " })).toBe("Acme Plumbing");
  });
  it("falls back to a placeholder for blank / missing names", () => {
    expect(followUpBusinessLabel({ business_name: "" })).toBe("Unnamed business");
    expect(followUpBusinessLabel({ business_name: "   " })).toBe("Unnamed business");
    expect(followUpBusinessLabel({ business_name: null })).toBe("Unnamed business");
    expect(followUpBusinessLabel({})).toBe("Unnamed business");
  });
});
