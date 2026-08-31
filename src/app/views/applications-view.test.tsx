import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";
import type { Opportunity, OpportunityEvent } from "@/lib/types";
import { ApplicationsView } from "@/app/views/applications-view";

type ApplicationsViewMocks = {
  onCreate: Mock;
  onUpdate: Mock;
  onTransition: Mock;
  onScheduleInterview: Mock;
  onAddNote: Mock;
};

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    userId: "user-1",
    company: "Northwind",
    role: "Staff Engineer",
    status: "considering",
    location: "Remote",
    remote: true,
    jobUrl: null,
    jobDescription: "Own the checkout platform end to end.",
    sourceLabel: null,
    sourceSystem: null,
    sourceExternalId: null,
    matchScore: null,
    strengths: [],
    gaps: [],
    notes: null,
    appliedAt: null,
    nextInterviewAt: null,
    createdAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    ...overrides,
  };
}

function opportunityEvent(overrides: Partial<OpportunityEvent> = {}): OpportunityEvent {
  return {
    id: "event-1",
    userId: "user-1",
    opportunityId: "opp-1",
    eventType: "note",
    fromStatus: null,
    toStatus: null,
    occurredAt: "2026-09-01T09:00:00.000Z",
    note: "Recruiter confirmed the loop.",
    metadata: {},
    createdAt: "2026-09-01T09:00:00.000Z",
    ...overrides,
  };
}

function renderApplications(opportunities: Opportunity[], overrides: Partial<ApplicationsViewMocks> = {}) {
  const defaults: ApplicationsViewMocks = {
    onCreate: vi.fn().mockResolvedValue(opportunity()),
    onUpdate: vi.fn().mockResolvedValue(opportunity()),
    onTransition: vi.fn().mockResolvedValue(opportunity()),
    onScheduleInterview: vi.fn().mockResolvedValue(opportunity()),
    onAddNote: vi.fn().mockResolvedValue(opportunityEvent()),
  };
  const effective = { ...defaults, ...overrides };
  const view = render(<ApplicationsView opportunities={opportunities} busy={false} {...effective} />);
  return {
    ...effective,
    rerenderWithOpportunities: (next: Opportunity[]) =>
      view.rerender(<ApplicationsView opportunities={next} busy={false} {...effective} />),
  };
}

describe("ApplicationsView", () => {
  it("creates a new opportunity in considering status by default", async () => {
    const { onCreate } = renderApplications([]);

    fireEvent.click(screen.getByRole("button", { name: "Add application" }));
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Globex" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Principal Engineer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save application" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({ company: "Globex", role: "Principal Engineer" });
    expect(onCreate.mock.calls[0][0].initialStatus).toBeUndefined();
  });

  it("creates an already-applied opportunity when the applicant marks it so", async () => {
    const { onCreate } = renderApplications([]);

    fireEvent.click(screen.getByRole("button", { name: "Add application" }));
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Globex" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Principal Engineer" } });
    fireEvent.click(screen.getByLabelText("I've already applied"));
    fireEvent.click(screen.getByRole("button", { name: "Save application" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({ company: "Globex", role: "Principal Engineer", initialStatus: "applied" });
  });

  it("edits an opportunity's details from the detail panel", async () => {
    const { onUpdate } = renderApplications([opportunity()]);

    fireEvent.click(screen.getByRole("button", { name: /Northwind.*Staff Engineer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Senior Staff Engineer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate).toHaveBeenCalledWith("opp-1", expect.objectContaining({ role: "Senior Staff Engineer" }));
  });

  it("keeps the job description out of the list and only in the detail panel", () => {
    renderApplications([opportunity({ jobDescription: "Own the checkout platform end to end." })]);

    expect(screen.queryByText("Own the checkout platform end to end.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Northwind.*Staff Engineer/ }));

    expect(screen.getByText("Own the checkout platform end to end.")).toBeInTheDocument();
  });

  it("transitions an opportunity to the next lifecycle status", async () => {
    const { onTransition } = renderApplications([opportunity({ status: "considering" })]);

    fireEvent.click(screen.getByRole("button", { name: /Northwind.*Staff Engineer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Mark as applied" }));

    await waitFor(() => expect(onTransition).toHaveBeenCalledTimes(1));
    expect(onTransition).toHaveBeenCalledWith("opp-1", "applied", expect.anything());
  });

  it("makes terminal actions explicit distinct controls", async () => {
    const { onTransition } = renderApplications([opportunity({ status: "interviewing" })]);

    fireEvent.click(screen.getByRole("button", { name: /Northwind.*Staff Engineer/ }));
    expect(screen.getByRole("button", { name: "Mark as offer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as rejected" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mark as offer" }));
    await waitFor(() => expect(onTransition).toHaveBeenCalledWith("opp-1", "offer", expect.anything()));
  });

  it("schedules an interview and shows nextInterviewAt distinctly from any note's occurredAt", async () => {
    const scheduled = opportunity({ status: "interviewing", nextInterviewAt: "2026-09-10T14:00:00.000Z" });
    const { onScheduleInterview, rerenderWithOpportunities } = renderApplications([opportunity({ status: "interviewing" })], {
      onScheduleInterview: vi.fn().mockResolvedValue(scheduled),
    });

    fireEvent.click(screen.getByRole("button", { name: /Northwind.*Staff Engineer/ }));
    fireEvent.change(screen.getByLabelText("Interview date and time"), { target: { value: "2026-09-10T14:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule interview" }));

    await waitFor(() => expect(onScheduleInterview).toHaveBeenCalledTimes(1));
    const [, interviewAt] = onScheduleInterview.mock.calls[0];
    expect(new Date(interviewAt).toISOString()).toBe(new Date("2026-09-10T14:00").toISOString());

    // The view is prop-driven: the shell re-renders with the server's updated
    // opportunity once the mutation resolves -- this mirrors that refresh.
    rerenderWithOpportunities([scheduled]);
    expect(await screen.findByText(/Next interview/)).toBeInTheDocument();
  });

  it("adds a note that appears in the timeline with its own recorded time, separate from the next interview date", async () => {
    const withInterview = opportunity({ nextInterviewAt: "2026-09-10T14:00:00.000Z" });
    const { onAddNote } = renderApplications([withInterview], {
      onAddNote: vi.fn().mockResolvedValue(opportunityEvent({ note: "Recruiter confirmed the loop.", occurredAt: "2026-09-01T09:00:00.000Z" })),
    });

    fireEvent.click(screen.getByRole("button", { name: /Northwind.*Staff Engineer/ }));
    fireEvent.change(screen.getByLabelText("Add a note"), { target: { value: "Recruiter confirmed the loop." } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() => expect(onAddNote).toHaveBeenCalledWith("opp-1", "Recruiter confirmed the loop."));

    const timeline = screen.getByRole("region", { name: "Timeline" });
    expect(within(timeline).getByText("Recruiter confirmed the loop.")).toBeInTheDocument();
    // The interview date itself is shown as a distinct fact, not as when the note was recorded.
    expect(within(timeline).getByText(/Next interview/)).toBeInTheDocument();
  });

  it("filters the list to active applications by default and shows terminal ones only on request", () => {
    renderApplications([
      opportunity({ id: "opp-active", company: "Northwind", status: "interviewing" }),
      opportunity({ id: "opp-terminal", company: "Acme", status: "rejected" }),
    ]);

    expect(screen.getByText("Northwind")).toBeInTheDocument();
    expect(screen.queryByText("Acme")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));

    expect(screen.queryByText("Northwind")).not.toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });

  it("shows an honest empty state when there are no applications in the active filter", () => {
    renderApplications([]);

    expect(screen.getByText(/no applications/i)).toBeInTheDocument();
  });
});
