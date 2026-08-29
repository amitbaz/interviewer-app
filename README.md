# Relay — AI Interview Coach

A personal, single-user interview-practice POC for experienced frontend engineers.

## What works now

- CV PDF upload or professional-summary paste → generated, editable professional profile
- Local SQLite persistence (no account or login)
- Responsive Home, Profile, Practice, Progress, Interview, and Results screens
- Conversational interview sessions with saved messages, feedback, and follow-ups
- Hands-on React + TypeScript interview with persisted code checkpoints, interviewer prompts, and technical feedback
- Gradual competency updates after completed conversational and hands-on sessions
- Browser voice recording → Gemini transcription → editable interview answer
- Deterministic demo coach when no API key is configured
- Gemini API provider when `GEMINI_API_KEY` is configured

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

To use live Gemini responses, create `.env.local`:

```bash
GEMINI_API_KEY=your_key_here
# Optional; defaults to gemini-3.6-flash
GEMINI_MODEL=gemini-3.6-flash
```

Create the key in Google AI Studio. Gemini's free tier is rate-limited and Google states that free-tier content may be used to improve its products, so do not use it with sensitive career data. Keep `.env.local` private. Local profile and interview data is stored in `data/interview-coach.db`, which is ignored by Git.

## Verify

```bash
npm run lint
npx next build --webpack
```

The Webpack verification build is used because Turbopack's CSS worker cannot bind a required local port in this environment.

## Next slices

- PDF upload/text extraction and editable profile confirmation
- Voice recording and transcription
- Executable preview and automated test runner for the hands-on workspace
