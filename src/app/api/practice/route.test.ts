import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  loadPracticeOverview: vi.fn(),
  startRecommendedPractice: vi.fn(),
  startManualPractice: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/practice-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/practice-service")>("@/lib/practice-service");
  return {
    PracticeServiceError: actual.PracticeServiceError,
    loadPracticeOverview: mocks.loadPracticeOverview,
    startRecommendedPractice: mocks.startRecommendedPractice,
    startManualPractice: mocks.startManualPractice,
  };
});

import { GET, POST } from "@/app/api/practice/route";
import { PracticeServiceError } from "@/lib/practice-service";
import { RepositoryError } from "@/lib/repositories/profile";

const recommendation = {
  format: "role_prep",
  primaryFocus: "Prepare for the Acme interview",
  secondaryFocus: null,
  rationale: "Your interview is in two days.",
  estimatedMinutes: 18,
  successCriteria: ["Answer role-specific questions grounded in the job description."],
  primaryOpportunityId: "opp-1",
  supportingOpportunityIds: [],
  signals: [{ kind: "upcoming_interview", label: "upcoming interview", detail: "Acme · in 2 days" }],
};

const started = {
  plan: { id: "plan-1", status: "started" },
  session: { id: "session-1", practicePlanId: "plan-1" },
};

function post(body: unknown) {
  return POST(new Request("http://localhost/api/practice", { method: "POST", body: JSON.stringify(body) }));
}

describe("GET /api/practice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ supabase: { client: true }, user: { id: "user-1" } });
  });

  it("returns the recomputed recommendation with the caller's plans", async () => {
    mocks.loadPracticeOverview.mockResolvedValue({ recommendation, plans: [{ id: "plan-1" }] });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ recommendation, plans: [{ id: "plan-1" }] });
    expect(mocks.loadPracticeOverview).toHaveBeenCalledWith(expect.anything(), "user-1", expect.any(Date));
  });

  it("returns 401 without loading practice data when authentication is absent", async () => {
    mocks.requireUser.mockRejectedValue(new Error("UNAUTHENTICATED"));

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in to continue." });
    expect(mocks.loadPracticeOverview).not.toHaveBeenCalled();
  });
});

describe("POST /api/practice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ supabase: { client: true }, user: { id: "user-1" } });
    mocks.startRecommendedPractice.mockResolvedValue(started);
    mocks.startManualPractice.mockResolvedValue(started);
  });

  it("returns 401 before reading a request body when authentication is absent", async () => {
    mocks.requireUser.mockRejectedValue(new Error("UNAUTHENTICATED"));
    const json = vi.fn();

    const response = await POST({ json } as unknown as Request);

    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
  });

  it("starts recommended practice from server-side inputs only", async () => {
    const response = await post({
      action: "start_recommended",
      recommendation: { format: "hands_on", primaryFocus: "Whatever the browser wants" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(started);
    expect(mocks.startRecommendedPractice).toHaveBeenCalledWith(expect.anything(), "user-1", expect.any(Date));
    expect(mocks.startRecommendedPractice).toHaveBeenCalledOnce();
    expect(mocks.startRecommendedPractice.mock.calls[0]).toHaveLength(3);
  });

  it("forwards only the validated manual practice fields", async () => {
    const response = await post({
      action: "start_manual",
      format: "targeted_drill",
      primaryFocus: "Architecture decision framing",
      estimatedMinutes: 12,
      primaryOpportunityId: null,
      status: "completed",
      priorityScore: 99,
    });

    expect(response.status).toBe(200);
    expect(mocks.startManualPractice).toHaveBeenCalledWith(expect.anything(), "user-1", {
      format: "targeted_drill",
      primaryFocus: "Architecture decision framing",
      secondaryFocus: null,
      estimatedMinutes: 12,
      successCriteria: [],
      primaryOpportunityId: null,
    });
  });

  it("rejects an unknown action", async () => {
    const response = await post({ action: "start_whatever" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unknown action." });
    expect(mocks.startRecommendedPractice).not.toHaveBeenCalled();
    expect(mocks.startManualPractice).not.toHaveBeenCalled();
  });

  it("rejects a body that is not a JSON object", async () => {
    const response = await POST(new Request("http://localhost/api/practice", { method: "POST", body: "not json" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A valid practice request is required." });
  });

  it("returns 400 with the service's user-safe message for an invalid manual request", async () => {
    mocks.startManualPractice.mockRejectedValue(
      new PracticeServiceError("Describe what you want to practise.", "INVALID_PRACTICE_REQUEST"),
    );

    const response = await post({ action: "start_manual", format: "targeted_drill", primaryFocus: " " });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Describe what you want to practise." });
  });

  it("returns 404 when the chosen opportunity is not owned by the caller", async () => {
    mocks.startManualPractice.mockRejectedValue(
      new PracticeServiceError("That opportunity was not found.", "OPPORTUNITY_NOT_FOUND"),
    );

    const response = await post({
      action: "start_manual",
      format: "role_prep",
      primaryFocus: "Role prep",
      primaryOpportunityId: "opp-other",
    });

    expect(response.status).toBe(404);
  });

  it("returns 409 when the practice plan is no longer startable", async () => {
    mocks.startRecommendedPractice.mockRejectedValue(
      new RepositoryError("Could not start the planned practice session.", "22023"),
    );

    const response = await post({ action: "start_recommended" });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Could not start the planned practice session." });
  });

  it("logs the underlying failure while keeping the public error generic", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.startRecommendedPractice.mockRejectedValue(new Error("gemini exploded"));

    const response = await post({ action: "start_recommended" });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Could not complete your practice request." });
    expect(consoleError).toHaveBeenCalledWith("[api/practice] request failed", expect.objectContaining({
      message: "gemini exploded",
    }));
    consoleError.mockRestore();
  });
});
