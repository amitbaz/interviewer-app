# PRD Gap Analysis

This document records the gaps between the current implementation and the approved POC PRD. It is an implementation audit, not a replacement for the PRD.

## P0 gaps

### Adaptive interview planning

The app does not yet choose questions using previous sessions, competency relevance, confidence, recency, weakness, or a difficulty fit. The deterministic fallback follows a fixed sequence, and the live-model prompt does not receive competency scores or prior-session history. This leaves the POC unable to demonstrate that a subsequent interview is materially better targeted.

Relevant PRD: sections 20–21, 49, and 50.

### Career-grounded interviewing

The live interviewer receives the role, seniority, and expertise, but not the factual CV details, career narrative, cover-letter context, or reusable stories. It therefore cannot reliably probe the candidate's real projects and achievements.

Relevant PRD: sections 7, 14, 16, and 17.

### Competency knowledge graph

Each competency currently has only a name, score, and focus. Missing fields include relevance, expected level, estimated level, confidence, last practiced, question count, average/recent score, strengths, and weaknesses.

Relevant PRD: section 9.

### Conversational interview structure and feedback

- No explicit 5–8-question plan, category mix, difficulty tracking, or natural session completion.
- No robust mechanism to avoid repeating mastered areas.
- Results do not offer expandable per-question feedback with the question, answer, missing points, better structure, and a tailored improved answer.
- Individual evaluations do not capture the full set of relevant dimensions: correctness, depth, clarity, structure, practical experience, trade-offs, communication, confidence, and relevance.

Relevant PRD: sections 13–15 and 22–24.

### Readiness and progress insights

Readiness is currently a simple average of seeded competency scores, so it is non-zero before the user has completed an interview. It does not weight competency relevance or confidence. The Progress screen also lacks recent-improvement trends and recurring-weakness coaching.

Relevant PRD: sections 26–27 and 50.

### Hands-on exercise generation and adaptation

The app currently provides one static product-search exercise. It does not generate or select different exercises using professional background, seniority, market patterns, preferences, or prior performance. Future hands-on sessions do not become more targeted based on identified weaknesses.

Relevant PRD: sections 30.1, 30.3, 30.17, 30.20–30.24, and 51.

### Hands-on workspace and evaluation depth

- The workspace has no executable preview, console, test runner, API mock, or code-validation feedback.
- Evaluation relies primarily on regex checks against the latest saved code, not execution or a deeper review of implementation correctness.
- The result omits distinct problem-solving, performance, time-management, debugging, and seniority scores.
- There is no complete interviewer-style review covering strong signals, weak signals, observation, and a next-round recommendation.

Relevant PRD: sections 30.4–30.5 and 30.9–30.12.

### Privacy and source-document controls

- The user cannot delete uploaded/source documents or reset all locally stored profile and interview data.
- The UI does not clearly state that career documents are used to personalize preparation.
- A cover letter can be pasted but not uploaded, although the POC screen requirements call for optional cover-letter upload.

Relevant PRD: sections 7.2, 46, and 48.

### Profile completeness

The Profile area lacks a generated professional-scope view, career direction (current role, target role, seniority, location), and preparation preferences (stack, focus areas, format, market, and hands-on session types).

Relevant PRD: sections 36–38.

### AI provider boundary

Gemini requests are embedded directly in the coaching and transcription code. The PRD calls for a provider abstraction so model vendors can be changed without changing interview business logic.

Relevant PRD: section 41.

## P1 gaps

- Personal story bank derived from career history.
- Dedicated self-presentation coaching.
- Focused practice categories, rather than only mixed interview and hands-on choices.
- Current-web research and cached interview intelligence.
- Market-grounded exercise generation, source confidence, freshness, and a “Why this exercise?” explanation.
- Explicit interviewer hint flow with recorded hint level.
- Richer transcript editing and competency explanations.

Relevant PRD: sections 16–17, 28–34, and 30.7, 30.13–30.16.

## Recommended implementation order

1. Build the competency and interview-planning model, then pass career context and prior performance into the interviewer.
2. Add per-question feedback, meaningful readiness, and progress trends.
3. Improve hands-on execution and evaluation, then make exercises adapt to performance.
4. Add document deletion/reset and complete the Profile settings.
5. Add research/market intelligence, story coaching, focused practice, and interviewer hints.

## Out of scope for the POC

Authentication, multi-user isolation, public deployment, job-description overlays, richer cloud IDE infrastructure, and other P2 items remain deliberately out of scope.

Relevant PRD: section 49.
