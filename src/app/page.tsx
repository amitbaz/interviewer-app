"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ResultsFeedbackCards } from "@/app/results-feedback-cards";
import type { EvidenceItem, HandsOnExercise, InterviewSession, Profile, ProgressSnapshot } from "@/lib/types";
import { progressViewModel } from "@/app/progress-view-model";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { MAX_CV_PDF_BYTES } from "@/lib/upload-limits";

type View = "home" | "onboarding" | "profile-review" | "interview" | "results" | "progress" | "profile" | "practice";
type InterviewMode = "conversation" | "hands-on";
type AuthState = "loading" | "signed-out" | "signed-in";
const nav: View[] = ["home", "practice", "progress", "profile"];
function startViewTransition(update: () => void) {
  const documentWithTransition = document as Document & { startViewTransition?: (callback: () => void) => void };
  if (documentWithTransition.startViewTransition) {
    documentWithTransition.startViewTransition(update);
    return;
  }
  update();
}

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) } });
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error ?? "Something went wrong.", response.status);
  return body as T;
}

type CoachData = {
  profile: Profile | null;
  demoMode: boolean;
  sessions: InterviewSession[];
  progress: ProgressSnapshot;
};

async function loadCoachData(): Promise<CoachData> {
  const [profileResult, sessionsResult] = await Promise.all([
    api<{ profile: Profile | null; demoMode: boolean }>("/api/profile"),
    api<{ sessions: InterviewSession[]; progress: ProgressSnapshot }>("/api/interview"),
  ]);

  return {
    profile: profileResult.profile,
    demoMode: profileResult.demoMode,
    sessions: sessionsResult.sessions,
    progress: sessionsResult.progress,
  };
}

function progressTrendLabel(trend: ProgressSnapshot["trend"]): string | null {
  switch (trend) {
    case "baseline":
      return "Baseline established";
    case "improving":
      return "Improving";
    case "stable":
      return "Stable";
    case "declining":
      return "Needs attention";
    default:
      return null;
  }
}

function progressTrendDescription(trend: ProgressSnapshot["trend"]): string {
  switch (trend) {
    case "baseline":
      return "Your first completed session sets the starting point for future comparisons.";
    case "improving":
      return "Your latest sessions are trending upward against your earlier practice history.";
    case "stable":
      return "Your recent sessions are holding steady, which makes focused practice the next lever.";
    case "declining":
      return "Recent sessions dipped below your earlier baseline, so revisit the recurring weak spots next.";
    default:
      return "Complete a few sessions to unlock a clearer progress trend.";
  }
}

function profileReadinessCopy(readiness: Profile["readiness"]): string | null {
  if (!readiness) return null;
  return readiness.ready
    ? "Grounded profile ready for personalized interviews."
    : `Profile evidence gate still needs ${readiness.missing.join(", ")}.`;
}

function evidenceLabel(item: EvidenceItem): string {
  const label = item.projectOrEmployer?.trim()
    || item.ownership?.trim()
    || item.outcome?.trim()
    || item.sourceExcerpt.trim();
  return label.replace(/\s+/g, " ").slice(0, 96);
}

function evidenceSummary(item: EvidenceItem): string {
  const summary = [
    item.projectOrEmployer?.trim(),
    item.ownership?.trim(),
    item.outcome?.trim(),
  ].filter((value): value is string => Boolean(value));

  return summary.length > 0 ? summary.join(" · ") : evidenceLabel(item);
}

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
  const [view, setView] = useState<View>("onboarding");
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [coachDataLoading, setCoachDataLoading] = useState(true);
  const [cvText, setCvText] = useState("");
  const [cvPdf, setCvPdf] = useState<File | null>(null);
  const [coverLetter, setCoverLetter] = useState("");
  const [draftRole, setDraftRole] = useState("");
  const [draftSeniority, setDraftSeniority] = useState("");
  const [draftNarrative, setDraftNarrative] = useState("");
  const [draftExpertise, setDraftExpertise] = useState("");
  const [answer, setAnswer] = useState("");
  const [code, setCode] = useState("");
  const [checkpointNote, setCheckpointNote] = useState("");
  const [demoMode, setDemoMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("authError") === "signin"
    ? "Google sign-in did not complete. Please try again."
    : "");
  const [isRecording, setIsRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingChunks = useRef<BlobPart[]>([]);
  const supabase = useRef<ReturnType<typeof createBrowserSupabaseClient> | null>(null);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      const client = createBrowserSupabaseClient();
      supabase.current = client;
      return client.auth.getUser();
    }).then(({ data, error: authError }) => {
        if (!active) return;
        if (authError) setError("Could not confirm your sign-in. Please try again.");
        setAuthState(data.user ? "signed-in" : "signed-out");
    }).catch((caught) => {
      if (active) {
        setError(caught instanceof Error ? caught.message : "Could not confirm your sign-in. Please try again.");
        setAuthState("signed-out");
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (authState !== "signed-in") return;
    let active = true;
    loadCoachData().then((coachData) => {
      if (!active) return;
      setProfile(coachData.profile);
      setDemoMode(coachData.demoMode);
      setSessions(coachData.sessions);
      setProgress(coachData.progress);
      setView(coachData.profile ? "home" : "onboarding");
      setCoachDataLoading(false);
    }).catch((caught) => {
      if (!active) return;
      if (caught instanceof ApiError && caught.status === 401) {
        setProfile(null); setProgress(null); setSession(null); setSessions([]); setView("onboarding"); setAuthState("signed-out"); setCoachDataLoading(false);
        return;
      }
      setError(caught instanceof Error ? caught.message : "Could not open your coach data.");
      setCoachDataLoading(false);
    });
    return () => { active = false; };
  }, [authState]);

  const { hasEvidence, readiness, weakest } = progressViewModel(progress);
  const complete = sessions.find((item) => item.status === "complete");
  const handsOn = session?.kind === "hands-on";
  const exercise = handsOn ? session?.exercise as HandsOnExercise : null;
  const sessionSummary = session ? String(session.resultSummary.summary ?? "Complete a few questions to receive personalized feedback.") : "";
  const answeredQuestions = session?.questions.filter((question) => question.answer).length ?? 0;
  const progressTrend = progress?.trend ?? null;
  const progressTrendName = progressTrendLabel(progressTrend);
  const latestScore = progress?.latestScore ?? null;
  const strongest = progress?.strongest ?? null;
  const recurringWeaknesses = progress?.recurringWeaknesses ?? [];
  const progressHasBaseline = progressTrend === "baseline";
  const progressHasRecurringWeaknesses = recurringWeaknesses.length > 0;
  const profileReadinessNote = profileReadinessCopy(profile?.readiness);
  const groundedInterviewBlocked = profile?.readiness?.ready === false;

  function navigate(next: View) {
    startViewTransition(() => setView(next));
  }

  function persistSession(updated: InterviewSession) {
    setSession(updated);
    setSessions((items) => items.some((item) => item.id === updated.id) ? items.map((item) => item.id === updated.id ? updated : item) : [updated, ...items]);
  }
  function handleRequestError(caught: unknown, fallback: string) {
    if (caught instanceof ApiError && caught.status === 401) {
      setProfile(null); setProgress(null); setSession(null); setSessions([]); setView("onboarding"); setAuthState("signed-out");
      return;
    }
    setError(caught instanceof Error ? caught.message : fallback);
  }
  function beginProfileReview(nextProfile: Profile) {
    setProfile(nextProfile);
    setDraftRole(nextProfile.role ?? "");
    setDraftSeniority(nextProfile.seniority ?? "");
    setDraftNarrative(nextProfile.narrative ?? "");
    setDraftExpertise(nextProfile.expertise.join(", "));
    navigate("profile-review");
  }
  async function createProfile(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      let result: { profile: Profile; demoMode: boolean };
      if (cvPdf) {
        if (cvPdf.size > MAX_CV_PDF_BYTES) {
          throw new Error("Keep CV PDFs under 4 MB so the upload fits Vercel's request limit.");
        }
        const formData = new FormData();
        formData.append("cv", cvPdf);
        formData.append("coverLetter", coverLetter);
        const response = await fetch("/api/profile", { method: "POST", body: formData });
        const body = await response.json() as { profile: Profile; demoMode: boolean; error?: string };
        if (!response.ok) throw new ApiError(body.error ?? "Could not create profile.", response.status);
        result = body;
      } else {
        result = await api<{ profile: Profile; demoMode: boolean }>("/api/profile", { method: "POST", body: JSON.stringify({ cvText, coverLetter }) });
      }
      setDemoMode(result.demoMode); beginProfileReview(result.profile);
    } catch (caught) { handleRequestError(caught, "Could not create profile."); } finally { setBusy(false); }
  }
  async function confirmProfile(event: FormEvent) {
    event.preventDefault(); if (!profile) return; setBusy(true); setError("");
    try {
      const expertise = draftExpertise.split(",").map((item) => item.trim()).filter(Boolean);
      const result = await api<{ profile: Profile; demoMode: boolean }>("/api/profile", { method: "PUT", body: JSON.stringify({ profile: { role: draftRole, seniority: draftSeniority, narrative: draftNarrative, expertise } }) });
      setProfile(result.profile); setDemoMode(result.demoMode); navigate("home");
    } catch (caught) { handleRequestError(caught, "Could not save profile."); } finally { setBusy(false); }
  }
  async function startInterview(mode: InterviewMode = "conversation") {
    setBusy(true); setError("");
    try {
      const result = await api<{ session: InterviewSession }>("/api/interview", { method: "POST", body: JSON.stringify({ action: "start", mode }) });
      persistSession(result.session); setAnswer(""); setCheckpointNote(""); setCode((result.session.exercise as Partial<HandsOnExercise>).starterCode ?? ""); navigate("interview");
    } catch (caught) { handleRequestError(caught, "Could not start interview."); } finally { setBusy(false); }
  }
  async function sendAnswer(event: FormEvent) {
    event.preventDefault(); if (!session || !answer.trim()) return; setBusy(true); setError("");
    try {
      const result = await api<{ session: InterviewSession; profile?: Profile }>("/api/interview", { method: "POST", body: JSON.stringify({ action: "respond", sessionId: session.id, answer }) });
      setAnswer(""); persistSession(result.session);
      if (result.session.status === "complete" && result.profile) {
        const coachData = await loadCoachData();
        setProfile(coachData.profile ?? result.profile);
        setDemoMode(coachData.demoMode);
        setSessions(coachData.sessions);
        setProgress(coachData.progress);
        navigate("results");
      }
    } catch (caught) { handleRequestError(caught, "Could not send answer."); } finally { setBusy(false); }
  }
  async function toggleRecording() {
    if (recorder.current?.state === "recording") {
      recorder.current.stop();
      setIsRecording(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice recording is not available in this browser. Type your answer instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const nextRecorder = new MediaRecorder(stream);
      recordingChunks.current = [];
      nextRecorder.ondataavailable = (event) => { if (event.data.size) recordingChunks.current.push(event.data); };
      nextRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audio = new Blob(recordingChunks.current, { type: nextRecorder.mimeType || "audio/webm" });
        if (!audio.size) return;
        setBusy(true); setError("");
        try {
          const formData = new FormData();
          formData.append("audio", audio, "interview-answer.webm");
          const response = await fetch("/api/transcribe", { method: "POST", body: formData });
          const body = await response.json();
          if (!response.ok) throw new ApiError(body.error ?? "Could not transcribe recording.", response.status);
          setAnswer((current) => current ? `${current}\n${body.transcript}` : body.transcript);
        } catch (caught) { handleRequestError(caught, "Could not transcribe recording."); }
        finally { setBusy(false); recorder.current = null; setIsRecording(false); }
      };
      recorder.current = nextRecorder;
      nextRecorder.start();
      setIsRecording(true);
    } catch { setError("Microphone access was not granted. Type your answer instead."); }
  }
  async function saveCheckpoint(event: FormEvent) {
    event.preventDefault(); if (!session || !code.trim() || !checkpointNote.trim()) return; setBusy(true); setError("");
    try {
      const result = await api<{ session: InterviewSession }>("/api/interview", { method: "POST", body: JSON.stringify({ action: "checkpoint", sessionId: session.id, code, note: checkpointNote }) });
      setCheckpointNote(""); persistSession(result.session);
    } catch (caught) { handleRequestError(caught, "Could not save checkpoint."); } finally { setBusy(false); }
  }
  async function finishInterview() {
    if (!session) return; setBusy(true); setError("");
    try {
      const result = await api<{ session: InterviewSession; profile: Profile }>("/api/interview", { method: "POST", body: JSON.stringify({ action: "complete", sessionId: session.id }) });
      persistSession(result.session);
      const coachData = await loadCoachData();
      setProfile(coachData.profile ?? result.profile);
      setDemoMode(coachData.demoMode);
      setSessions(coachData.sessions);
      setProgress(coachData.progress);
      navigate("results");
    } catch (caught) { handleRequestError(caught, "Could not finish interview."); } finally { setBusy(false); }
  }
  async function signInWithGoogle() {
    if (!supabase.current) {
      setError("Sign-in is not available. Refresh the page and try again.");
      return;
    }
    setBusy(true); setError("");
    try {
      const { error: authError } = await supabase.current.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (authError) throw authError;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start Google sign-in.");
    } finally { setBusy(false); }
  }
  async function signOut() {
    if (!supabase.current) return;
    setBusy(true); setError("");
    try {
      const { error: authError } = await supabase.current.auth.signOut();
      if (authError) throw authError;
      setProfile(null); setProgress(null); setSession(null); setSessions([]); setAnswer(""); setCode(""); setCheckpointNote(""); setView("onboarding"); setAuthState("signed-out");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign out.");
    } finally { setBusy(false); }
  }

  const renderConversationMessage = (message: InterviewSession["messages"][number]) => {
    const questionId = message.id.split(":")[0];
    const conversationQuestion = session?.questions.find((item) => item.id === questionId) ?? null;
    const blueprintQuestion = session?.blueprint?.questions.find((item) => item.id === questionId) ?? null;
    const groundedEvidence = blueprintQuestion
      ? blueprintQuestion.evidenceIds
        .map((id) => profile?.evidence?.find((item) => item.id === id) ?? null)
        .filter((item): item is EvidenceItem => item !== null)
      : [];

    return (
      <div
        key={message.id}
        className={`max-w-2xl rounded-2xl p-5 leading-7 ${message.role === "interviewer" ? "border border-[var(--line)] bg-[var(--paper)]" : "ml-auto bg-[#dff0d4]"}`}
      >
        <p className="mb-2 text-xs font-semibold uppercase tracking-[.14em] text-[var(--ink-muted)]">
          {message.role === "interviewer" ? "Interviewer" : "You"}
        </p>
        {message.role === "interviewer" && blueprintQuestion && (
          <div className="mb-3 rounded-2xl border border-[#d9e2d2] bg-[#eef3e7] px-4 py-3 text-sm leading-6 text-[#38502e]">
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-[#537053]">Question objective</p>
            <p className="mt-1">{blueprintQuestion.objective}</p>
            <p className="mt-2 text-xs leading-5 text-[#537053]">
              Grounded in {groundedEvidence.length ? groundedEvidence.map(evidenceLabel).join(" · ") : `${blueprintQuestion.evidenceIds.length} source evidence item${blueprintQuestion.evidenceIds.length === 1 ? "" : "s"}`}
              {blueprintQuestion.expectedSignals.length ? ` · Expected signals: ${blueprintQuestion.expectedSignals.join(", ")}` : ""}
            </p>
          </div>
        )}
        {message.role === "interviewer" && conversationQuestion && !blueprintQuestion && (
          <p className="mb-3 text-xs font-semibold uppercase tracking-[.12em] text-[var(--ink-muted)]">Grounded question</p>
        )}
        {message.content}
      </div>
    );
  };

  if (authState === "loading" || (authState === "signed-in" && coachDataLoading)) {
    return <main className="grid min-h-screen place-items-center bg-[var(--background)] px-5 text-sm text-[var(--ink-muted)]">Checking your sign-in…</main>;
  }

  if (authState === "signed-out") {
    return <main className="min-h-screen bg-[var(--background)] px-5 py-5 text-[var(--foreground)]"><section className="mx-auto flex min-h-screen max-w-md items-center"><div className="w-full rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-7 shadow-[0_12px_32px_rgba(27,42,34,.06)]"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--pine)] text-lg text-[var(--lime)]">R</div><p className="mt-6 text-sm font-semibold uppercase tracking-[.18em] text-[#5d7567]">Relay interview coach</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.04em]">Practice with your own career context.</h1><p className="mt-4 leading-7 text-[var(--ink-muted)]">Sign in to create a private coaching profile and keep your interview evidence separate from every other account.</p>{error && <div role="alert" className="mt-5 rounded-xl border border-[#e7b9b0] bg-[#fff0ed] px-4 py-3 text-sm text-[#8e3226]">{error}</div>}<button onClick={signInWithGoogle} disabled={busy} className="mt-7 w-full rounded-full bg-[var(--pine)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Connecting…" : "Continue with Google"}</button></div></section></main>;
  }

  return <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]"><div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-5 md:px-8">
    <header className="mb-8 flex items-center justify-between gap-4"><button onClick={() => profile && navigate("home")} className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--pine)] text-lg text-[var(--lime)]">R</span><span className="text-lg font-semibold">relay</span></button><div className="flex items-center gap-3"><span className={`hidden rounded-full border px-3 py-1 text-xs sm:inline ${demoMode ? "border-[#c9d3bf] bg-[#edf5d1] text-[#38502e]" : "border-[#bad7d0] bg-[#e4f5f0] text-[#24564b]"}`}>{demoMode ? "Demo coach · add GEMINI_API_KEY for live AI" : "Gemini AI configured"}</span><button onClick={signOut} disabled={busy} className="rounded-full border border-[var(--line)] px-3 py-2 text-sm font-semibold disabled:opacity-50">Sign out</button></div></header>
    {error && <div role="alert" className="mb-5 rounded-xl border border-[#e7b9b0] bg-[#fff0ed] px-4 py-3 text-sm text-[#8e3226]">{error}</div>}
    {view === "onboarding" && <section className="mx-auto w-full max-w-3xl py-6 md:py-14"><p className="mb-4 text-sm font-semibold uppercase tracking-[.18em] text-[#5d7567]">Your personal interview coach</p><h1 className="max-w-2xl text-4xl font-semibold tracking-[-.04em] md:text-6xl">Make your next interview feel familiar.</h1><p className="mt-5 max-w-xl text-lg leading-8 text-[var(--ink-muted)]">Start with the facts of your career. Relay turns them into focused practice, not a generic question bank.</p><form onSubmit={createProfile} className="mt-10 space-y-5 rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-5 shadow-[0_12px_32px_rgba(27,42,34,.06)] md:p-8"><label className="block text-sm font-semibold">Upload your CV <span className="font-normal text-[var(--ink-muted)]">(PDF, optional)</span><input accept="application/pdf" type="file" onChange={(event) => setCvPdf(event.target.files?.[0] ?? null)} className="mt-2 block w-full rounded-xl border border-[var(--line)] bg-white p-3 text-sm" />{cvPdf && <span className="mt-2 block text-xs font-normal text-[#38502e]">{cvPdf.name} will be read with Gemini.</span>}</label><label className="block text-sm font-semibold">Paste your CV or LinkedIn-style summary <span className="font-normal text-[var(--ink-muted)]">{cvPdf ? "(optional when a PDF is selected)" : ""}</span><textarea required={!cvPdf} value={cvText} onChange={(event) => setCvText(event.target.value)} placeholder="Senior Frontend Engineer · React · TypeScript · achievements…" className="mt-2 min-h-52 w-full rounded-2xl border border-[var(--line)] bg-white p-4 text-sm leading-6 outline-none focus:border-[var(--pine)]" /></label><label className="block text-sm font-semibold">Career narrative <span className="font-normal text-[var(--ink-muted)]">(optional)</span><textarea value={coverLetter} onChange={(event) => setCoverLetter(event.target.value)} placeholder="What kind of role are you moving toward?" className="mt-2 min-h-28 w-full rounded-2xl border border-[var(--line)] bg-white p-4 text-sm leading-6 outline-none focus:border-[var(--pine)]" /></label><button disabled={busy} className="rounded-full bg-[var(--pine)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? cvPdf ? "Reading CV…" : "Building profile…" : "Create my profile"}</button></form></section>}
    {profile && view === "profile-review" && <section className="mx-auto w-full max-w-3xl py-6 md:py-14"><p className="text-sm font-semibold uppercase tracking-[.18em] text-[#5d7567]">Profile review</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.04em]">Make the coach accurate.</h1><p className="mt-4 max-w-2xl leading-7 text-[var(--ink-muted)]">Relay will use this profile to choose questions and practice focus. Correct anything that is off before you begin.</p><form onSubmit={confirmProfile} className="mt-8 space-y-5 rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-5 md:p-8"><div className="grid gap-5 md:grid-cols-2"><label className="block text-sm font-semibold">Role<input required value={draftRole} onChange={(event) => setDraftRole(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-3 text-sm outline-none focus:border-[var(--pine)]" /></label><label className="block text-sm font-semibold">Seniority<input required value={draftSeniority} onChange={(event) => setDraftSeniority(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-3 text-sm outline-none focus:border-[var(--pine)]" /></label></div><label className="block text-sm font-semibold">Professional narrative<textarea required value={draftNarrative} onChange={(event) => setDraftNarrative(event.target.value)} className="mt-2 min-h-32 w-full rounded-xl border border-[var(--line)] bg-white p-3 text-sm leading-6 outline-none focus:border-[var(--pine)]" /></label><label className="block text-sm font-semibold">Primary expertise <span className="font-normal text-[var(--ink-muted)]">(comma separated)</span><textarea required value={draftExpertise} onChange={(event) => setDraftExpertise(event.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-[var(--line)] bg-white p-3 text-sm leading-6 outline-none focus:border-[var(--pine)]" /></label><div className="flex flex-wrap gap-3"><button disabled={busy} className="rounded-full bg-[var(--pine)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Confirm profile"}</button><button type="button" onClick={() => { setCvText(profile.source.cvText); setCoverLetter(profile.source.coverLetter); navigate("onboarding"); }} className="rounded-full border border-[var(--line)] px-5 py-3 text-sm font-semibold">Edit source text</button></div></form></section>}
    {profile && view !== "onboarding" && view !== "profile-review" && <div className="flex flex-1 flex-col gap-7 md:flex-row"><aside className="order-2 flex shrink-0 gap-1 overflow-auto rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-2 md:order-1 md:w-44 md:flex-col md:self-start">{nav.map((item) => <button key={item} onClick={() => navigate(item)} className={`rounded-xl px-3 py-2.5 text-left text-sm capitalize ${view === item ? "bg-[var(--pine)] text-white" : "text-[var(--ink-muted)] hover:bg-[#eef0ea]"}`}>{item}</button>)}</aside><section className="order-1 min-w-0 flex-1 md:order-2">
      {view === "home" && <><p className="text-sm text-[var(--ink-muted)]">Welcome back</p><h1 className="mt-1 text-4xl font-semibold tracking-[-.04em]">Ready when you are.</h1><div className="mt-7 grid gap-5 lg:grid-cols-[1.25fr_.75fr]"><article className="rounded-3xl bg-[var(--pine)] p-6 text-white md:p-8"><p className="text-sm text-[#c8d7cf]">Interview readiness</p>{hasEvidence && readiness !== null ? <strong className="mt-2 block text-6xl tracking-[-.06em]">{readiness}<span className="ml-2 text-2xl text-[#c8d7cf]">/ 100</span></strong> : <h2 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Not enough data yet</h2>}<p className="mt-5 max-w-md leading-6 text-[#dbe7df]">{hasEvidence ? "A coaching signal based on your completed practice—not a hiring prediction." : "Your first mixed interview establishes a baseline across technical, architecture, and communication skills."}</p>{profileReadinessNote && <p className="mt-4 max-w-md text-sm leading-6 text-[#dbe7df]">{profileReadinessNote}</p>}{groundedInterviewBlocked && <p className="mt-4 max-w-md text-sm leading-6 text-[#dbe7df]">Add the missing source detail in your profile before Relay starts a grounded interview.</p>}<div className="mt-7 flex flex-wrap gap-3"><button onClick={() => startInterview()} disabled={busy || groundedInterviewBlocked} className="rounded-full bg-[var(--lime)] px-5 py-3 text-sm font-semibold text-[#18281f] disabled:opacity-50">{busy ? "Preparing…" : "Start interview"}</button><button onClick={() => startInterview("hands-on")} disabled={busy} className="rounded-full border border-[#8da79c] px-5 py-3 text-sm font-semibold text-white">Hands-on interview</button></div></article>{hasEvidence && weakest ? <article className="rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-6"><p className="text-sm font-semibold text-[var(--ink-muted)]">Recommended focus</p><h2 className="mt-3 text-2xl font-semibold">{weakest.name}</h2><p className="mt-3 leading-6 text-[var(--ink-muted)]">{weakest.weaknesses[0] ?? "Practice this area to strengthen your next interview."}</p><button onClick={() => navigate("practice")} className="mt-6 text-sm font-semibold text-[var(--pine)]">Practice this →</button></article> : <article className="rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-6"><p className="text-sm font-semibold text-[var(--ink-muted)]">What happens next</p><h2 className="mt-3 text-2xl font-semibold">Build your baseline.</h2><p className="mt-3 leading-6 text-[var(--ink-muted)]">Answer the five-question backbone and any useful follow-ups, then Relay can make a grounded recommendation.</p></article>}</div><article className="mt-7 rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-6"><p className="text-sm font-semibold text-[var(--ink-muted)]">Your last session</p><h2 className="mt-1 text-xl font-semibold">{complete && complete.overallScore !== null ? `${complete.overallScore}/10 overall signal` : "No completed interviews yet"}</h2><p className="mt-4 leading-6 text-[var(--ink-muted)]">{complete?.resultSummary.summary ? String(complete.resultSummary.summary) : "Your first mixed interview establishes a starting point across technical, architecture, and communication skills."}</p></article></>}
      {view === "interview" && session && !handsOn && <><div className="flex items-start justify-between gap-4"><div><p className="text-sm text-[var(--ink-muted)]">Mixed interview · {answeredQuestions} of {session.questions.length} answered</p><h1 className="mt-1 text-3xl font-semibold tracking-[-.04em]">Stay in the conversation.</h1></div><button onClick={finishInterview} disabled={busy || answeredQuestions < 5} className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold disabled:opacity-40">Finish</button></div>{session.blueprint?.status === "limited-grounding" && <article className="mt-6 rounded-3xl border border-[#e4c9a0] bg-[#fff6eb] p-5 text-[#8e5e20]"><p className="text-sm font-semibold uppercase tracking-[.14em]">Limited grounding</p><p className="mt-2 leading-6">{session.blueprint.fallbackReason ?? "This session used a constrained fallback blueprint, so the questions are broader than the source evidence would normally allow."}</p></article>}<div className="mt-6 space-y-4">{session.messages.map((message) => renderConversationMessage(message))}</div><form onSubmit={sendAnswer} className="sticky bottom-3 mt-5 rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-3 shadow-[0_10px_30px_rgba(25,41,33,.1)]"><textarea value={answer} onChange={(event) => setAnswer(event.target.value)} disabled={busy} placeholder="Answer as if you were in the room…" className="min-h-28 w-full resize-none bg-transparent p-3 text-sm leading-6 outline-none" /><div className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-2 pt-3"><button type="button" onClick={toggleRecording} disabled={busy} className={`rounded-full px-3 py-2 text-xs font-semibold ${isRecording ? "bg-[#fff0ed] text-[#8e3226]" : "bg-[#eef3e7] text-[#38502e]"}`}>{isRecording ? "■ Stop & transcribe" : "● Record answer"}</button><span className="text-xs text-[var(--ink-muted)]">Edit the transcript before sending.</span><button disabled={busy || !answer.trim()} className="rounded-full bg-[var(--pine)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? "Thinking…" : "Send answer"}</button></div></form></>}
      {view === "interview" && session && handsOn && <><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-[var(--ink-muted)]">Hands-on technical interview · React + TypeScript · {exercise?.durationMinutes} minutes</p><h1 className="mt-1 text-3xl font-semibold tracking-[-.04em]">Build, narrate, adapt.</h1></div><button onClick={finishInterview} disabled={busy || !session.checkpoints.length} className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold disabled:opacity-40">Finish &amp; review</button></div><div className="mt-6 grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><aside className="rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-6"><p className="text-sm font-semibold text-[var(--ink-muted)]">Your brief</p><h2 className="mt-2 text-2xl font-semibold">{exercise?.title}</h2><p className="mt-4 leading-7 text-[var(--ink-muted)]">{exercise?.briefing}</p><h3 className="mt-6 text-sm font-semibold uppercase tracking-[.12em] text-[var(--ink-muted)]">Requirements</h3><ul className="mt-3 space-y-3 text-sm leading-6 text-[var(--ink-muted)]">{exercise?.requirements.map((requirement) => <li key={requirement} className="flex gap-2"><span className="text-[var(--pine)]">•</span>{requirement}</li>)}</ul><p className="mt-6 rounded-xl bg-[#eef3e7] p-3 text-sm leading-6 text-[#38502e]">Think aloud at each checkpoint. The interviewer can challenge your approach, but will not write the solution for you.</p></aside><div><label className="block text-sm font-semibold">Workspace<textarea aria-label="TypeScript code workspace" spellCheck={false} value={code} onChange={(event) => setCode(event.target.value)} disabled={busy} className="mt-2 min-h-[31rem] w-full resize-y rounded-2xl border border-[#1d332b] bg-[#13241e] p-5 font-mono text-sm leading-6 text-[#e7f2e6] outline-none focus:border-[var(--lime)]" /></label><form onSubmit={saveCheckpoint} className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4"><label className="block text-sm font-semibold">What are you doing and why?<textarea value={checkpointNote} onChange={(event) => setCheckpointNote(event.target.value)} disabled={busy} placeholder="For example: I am cancelling in-flight searches and will add keyboard state next…" className="mt-2 min-h-24 w-full resize-none rounded-xl border border-[var(--line)] bg-white p-3 text-sm leading-6 outline-none focus:border-[var(--pine)]" /></label><div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs text-[var(--ink-muted)]">{session.checkpoints.length} checkpoint{session.checkpoints.length === 1 ? "" : "s"} saved</span><button disabled={busy || !code.trim() || !checkpointNote.trim()} className="rounded-full bg-[var(--pine)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? "Interviewer is reviewing…" : "Save checkpoint"}</button></div></form></div></div><div className="mt-6 space-y-3">{session.messages.map((message) => <article key={message.id} className={`max-w-3xl rounded-2xl p-4 text-sm leading-6 ${message.role === "interviewer" ? "border border-[var(--line)] bg-[var(--paper)]" : "bg-[#dff0d4]"}`}><p className="mb-1 text-xs font-semibold uppercase tracking-[.14em] text-[var(--ink-muted)]">{message.role === "interviewer" ? "Interviewer" : "Your checkpoint"}</p>{message.content}</article>)}</div></>}
      {view === "results" && session && <><p className="text-sm text-[var(--ink-muted)]">{handsOn ? "Hands-on interview complete" : "Interview complete"}</p><h1 className="mt-1 text-4xl font-semibold tracking-[-.04em]">{handsOn ? "A realistic technical signal." : "A useful baseline."}</h1>{session.blueprint?.status === "limited-grounding" && <article className="mt-7 rounded-3xl border border-[#e4c9a0] bg-[#fff6eb] p-5 text-[#8e5e20]"><p className="text-sm font-semibold uppercase tracking-[.14em]">Limited grounding</p><p className="mt-2 leading-6">{session.blueprint.fallbackReason ?? "This session used a constrained fallback blueprint, so the feedback may be broader than a fully grounded session."}</p></article>}<article className="mt-7 rounded-3xl bg-[var(--pine)] p-7 text-white"><p className="text-sm text-[#c8d7cf]">Overall coaching signal</p><strong className="mt-2 block text-6xl tracking-[-.06em]">{session.overallScore}<span className="ml-2 text-2xl text-[#c8d7cf]">/ 10</span></strong><p className="mt-5 max-w-2xl leading-7 text-[#dbe7df]">{sessionSummary}</p></article><ResultsFeedbackCards session={session} evidence={profile?.evidence} /><button onClick={() => startInterview(handsOn ? "hands-on" : "conversation")} disabled={busy} className="mt-7 rounded-full bg-[var(--pine)] px-5 py-3 text-sm font-semibold text-white">Start another {handsOn ? "hands-on interview" : "interview"}</button></>}
      {view === "progress" && <><p className="text-sm text-[var(--ink-muted)]">Progress</p><h1 className="mt-1 text-4xl font-semibold tracking-[-.04em]">Practice with a memory.</h1>{profileReadinessNote && <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--ink-muted)]">{profileReadinessNote}</p>}{hasEvidence && readiness !== null ? <div className="mt-7 grid gap-6 xl:grid-cols-[.8fr_1.2fr]"><div className="space-y-6"><article className="rounded-3xl bg-[#e7efd9] p-6"><p className="text-sm text-[#537053]">Interview readiness</p><strong className="mt-2 block text-6xl tracking-[-.06em]">{readiness}<span className="ml-2 text-2xl text-[#537053]">/ 100</span></strong><p className="mt-4 text-sm leading-6 text-[#537053]">A coaching signal based on your completed practice, not a hiring prediction.</p></article><article className="rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-6"><p className="text-sm font-semibold text-[var(--ink-muted)]">{progressHasBaseline ? "Baseline" : "Recent signal"}</p><h2 className="mt-2 text-2xl font-semibold">{progressTrendName ?? "Recent sessions"}</h2><p className="mt-3 text-sm text-[var(--ink-muted)]">{progressTrendDescription(progressTrend)}</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><div className="rounded-2xl bg-[#f3f5ef] p-4"><p className="text-xs font-semibold uppercase tracking-[.12em] text-[var(--ink-muted)]">Latest score</p><p className="mt-2 text-3xl font-semibold">{latestScore === null ? "Not available yet" : `${latestScore}/10`}</p></div><div className="rounded-2xl bg-[#f3f5ef] p-4"><p className="text-xs font-semibold uppercase tracking-[.12em] text-[var(--ink-muted)]">Trend</p><p className="mt-2 text-3xl font-semibold">{progressTrendName ?? "Building"}</p></div></div></article></div><div className="space-y-6"><div className="grid gap-6 lg:grid-cols-2"><article className="rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-6"><p className="text-sm font-semibold text-[var(--ink-muted)]">Strongest competency</p><h2 className="mt-2 text-2xl font-semibold">{strongest?.name ?? "Still emerging"}</h2><p className="mt-3 leading-6 text-[var(--ink-muted)]">{strongest?.strengths[0] ?? "Complete more sessions to identify your steadiest interview strength."}</p></article><article className="rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-6"><p className="text-sm font-semibold text-[var(--ink-muted)]">Recommended focus</p><h2 className="mt-2 text-2xl font-semibold">{weakest?.name ?? "Choose a fresh practice area"}</h2><p className="mt-3 leading-6 text-[var(--ink-muted)]">{weakest?.weaknesses[0] ?? "Relay will surface the next coaching target once enough evidence accumulates."}</p></article></div><article className="rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[var(--ink-muted)]">Recurring weaknesses</p><h2 className="mt-2 text-2xl font-semibold">{progressHasRecurringWeaknesses ? "Patterns worth practicing" : "No repeated pattern yet"}</h2></div>{progress?.recentScores.length ? <p className="rounded-full bg-[#eef3e7] px-3 py-1 text-xs font-semibold text-[#38502e]">{progress.recentScores.length} scored session{progress.recentScores.length === 1 ? "" : "s"}</p> : null}</div>{progressHasRecurringWeaknesses ? <ul className="mt-4 space-y-3 text-sm leading-6 text-[var(--ink-muted)]">{recurringWeaknesses.map((weakness) => <li key={weakness} className="rounded-2xl bg-[#f3f5ef] px-4 py-3">{weakness}</li>)}</ul> : <p className="mt-4 leading-6 text-[var(--ink-muted)]">Keep practicing across a few sessions and Relay will highlight the coaching themes that repeat.</p>}</article><article className="rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-6"><h2 className="font-semibold">Competencies</h2><div className="mt-5 space-y-4">{profile.competencies.map((item) => <div key={item.id}><div className="mb-2 flex justify-between text-sm"><span>{item.name}</span><span className="text-[var(--ink-muted)]">{item.averageScore === null ? "Not assessed" : `${item.averageScore}/10`}</span></div>{item.averageScore !== null && <div className="h-2 overflow-hidden rounded-full bg-[#e6e9e1]"><div className="h-full rounded-full bg-[var(--pine)]" style={{ width: `${item.averageScore * 10}%` }} /></div>}</div>)}</div></article></div></div> : <article className="mt-7 rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-6"><h2 className="text-2xl font-semibold">Not enough data yet</h2><p className="mt-3 max-w-xl leading-6 text-[var(--ink-muted)]">Finish your first mixed interview to establish a baseline before Relay shows readiness or competency scores.</p></article>}<p className="mt-7 text-sm text-[var(--ink-muted)]">{sessions.filter((item) => item.status === "complete").length} completed interviews saved to your account, including {sessions.filter((item) => item.status === "complete" && item.kind === "hands-on").length} hands-on sessions.</p></>}
      {view === "profile" && <><p className="text-sm text-[var(--ink-muted)]">Professional profile</p><h1 className="mt-1 text-4xl font-semibold tracking-[-.04em]">{profile.role}</h1><p className="mt-2 text-lg text-[var(--ink-muted)]">{profile.seniority} · personal coaching profile</p>{profileReadinessNote && <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">{profileReadinessNote}</p>}<article className="mt-7 rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-6"><h2 className="font-semibold">Professional narrative</h2><p className="mt-3 max-w-2xl leading-7 text-[var(--ink-muted)]">{profile.narrative}</p><h2 className="mt-7 font-semibold">Primary expertise</h2><div className="mt-3 flex flex-wrap gap-2">{profile.expertise.map((item) => <span key={item} className="rounded-full bg-[#edf0e8] px-3 py-1.5 text-sm">{item}</span>)}</div>{profile.evidence?.length ? <div className="mt-7 border-t border-[var(--line)] pt-7"><h2 className="text-2xl font-semibold">Grounded evidence</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">Relay will only plan and critique against source-backed details shown here.</p><div className="mt-5 space-y-4">{profile.evidence.map((item) => <article key={item.id} className="rounded-2xl border border-[var(--line)] bg-[#f8f7f2] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{item.projectOrEmployer ?? item.ownership ?? "Source-backed experience"}</h3><p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{item.sourceExcerpt}</p></div><span className="rounded-full bg-[#eef3e7] px-3 py-1 text-xs font-semibold text-[#38502e]">{Math.round(item.confidence * 100)}% extraction confidence</span></div><p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">{evidenceSummary(item)}</p>{item.technologies.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{item.technologies.map((technology) => <span key={technology} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#38502e]">{technology}</span>)}</div>}</article>)}</div></div> : null}<button onClick={() => beginProfileReview(profile)} className="mt-8 rounded-full border border-[var(--pine)] px-4 py-2 text-sm font-semibold text-[var(--pine)]">Review and edit profile</button><button onClick={() => { setCvText(profile.source.cvText); setCoverLetter(profile.source.coverLetter); navigate("onboarding"); }} className="mt-3 block text-sm font-semibold text-[var(--ink-muted)]">Replace source information</button></article></>}
      {view === "practice" && <><p className="text-sm text-[var(--ink-muted)]">Practice</p><h1 className="mt-1 text-4xl font-semibold tracking-[-.04em]">Choose deliberate practice.</h1><div className="mt-7 grid gap-5 md:grid-cols-2"><article className="rounded-3xl bg-[var(--pine)] p-6 text-white"><p className="text-sm text-[#c8d7cf]">Recommended</p><h2 className="mt-2 text-2xl font-semibold">Mixed senior interview</h2><p className="mt-3 leading-6 text-[#dbe7df]">Experience, technical decisions, system design, and communication.</p><button onClick={() => startInterview()} disabled={busy} className="mt-6 rounded-full bg-[var(--lime)] px-4 py-2 text-sm font-semibold text-[#18281f]">Start now</button></article><article className="rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-6"><p className="text-sm text-[var(--ink-muted)]">60-minute simulation</p><h2 className="mt-2 text-2xl font-semibold">Hands-on interview</h2><p className="mt-3 leading-6 text-[var(--ink-muted)]">An accessible React + TypeScript product search. Save checkpoints, explain decisions, then receive interviewer-style feedback.</p><button onClick={() => startInterview("hands-on")} disabled={busy} className="mt-6 rounded-full border border-[var(--pine)] px-4 py-2 text-sm font-semibold text-[var(--pine)]">Start hands-on</button></article></div></>}
      {view === "practice" && <><p className="text-sm text-[var(--ink-muted)]">Practice</p><h1 className="mt-1 text-4xl font-semibold tracking-[-.04em]">Choose deliberate practice.</h1><div className="mt-7 grid gap-5 md:grid-cols-2"><article className="rounded-3xl bg-[var(--pine)] p-6 text-white"><p className="text-sm text-[#c8d7cf]">Recommended</p><h2 className="mt-2 text-2xl font-semibold">Mixed senior interview</h2><p className="mt-3 leading-6 text-[#dbe7df]">Experience, technical decisions, system design, and communication.</p>{groundedInterviewBlocked && <p className="mt-4 text-sm leading-6 text-[#dbe7df]">Add the missing source detail in your profile before Relay starts a grounded interview.</p>}<button onClick={() => startInterview()} disabled={busy || groundedInterviewBlocked} className="mt-6 rounded-full bg-[var(--lime)] px-4 py-2 text-sm font-semibold text-[#18281f] disabled:opacity-50">Start now</button></article><article className="rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-6"><p className="text-sm text-[var(--ink-muted)]">60-minute simulation</p><h2 className="mt-2 text-2xl font-semibold">Hands-on interview</h2><p className="mt-3 leading-6 text-[var(--ink-muted)]">An accessible React + TypeScript product search. Save checkpoints, explain decisions, then receive interviewer-style feedback.</p><button onClick={() => startInterview("hands-on")} disabled={busy} className="mt-6 rounded-full border border-[var(--pine)] px-4 py-2 text-sm font-semibold text-[var(--pine)]">Start hands-on</button></article></div></>}
    </section></div>}
  </div></main>;
}
