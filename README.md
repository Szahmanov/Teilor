# Tailor — Autonomous Career Application Manager

**By StaGove.** An autonomous AI recruiter that manages every job application from the moment you
find a job until you receive an offer. Each job becomes a living, on-device project the agent keeps
scoring, tailoring, and improving (ATS + recruiter simulation, tailored CV, tone-matched cover
letter, resume-health report, interview prep, roadmap, and odds).

## How the key is handled (important)

The Groq key is kept **secret on the host** (a `GROQ_API_KEY` environment variable on Netlify or
Render) and is **never shipped to the browser**. A tiny proxy reads it and forwards requests to Groq.

- The front-end (`app.js`) calls `/api/groq` — a relative path on your own site.
- On **Netlify**, that path is served by `netlify/functions/groq.js`.
- On **Render**, it's served by `server.js`.

End users don't enter anything — it just works. (A user *may* optionally paste their own free Groq
key in **Settings** to use their own limit instead of the site's; it stays in their browser.)

> Note: because the key is shared by everyone using the site, all usage runs through your one Groq
> account and its free limit (~30 req/min, 14,400 req/day, per organisation). Fine for a demo and
> light real use; heavy traffic would need a paid Groq tier. That is the trade-off of a single
> server-side key vs. the optional bring-your-own-key path.

---

## Files

```
index.html  styles.css  app.js                  <- the app (static front-end)
manifest.webmanifest  sw.js                      <- PWA
icon-*.png  apple-touch-icon.png  favicon-48.png <- icons
netlify/functions/groq.js  netlify.toml          <- Netlify proxy + config
server.js  package.json                          <- Render proxy (Node/Express)
README.md
```

Netlify ignores `server.js`/`package.json`; Render ignores the Netlify files. The front-end calls
`/api/groq` on both, so the same code works either way.

---

## Deploy on Netlify (recommended — keeps the key secret)

1. Push all files to a GitHub repo (already done).
2. In Netlify: **Add new site -> Import an existing project -> GitHub ->** pick your repo.
3. Build settings: **Build command** empty, **Publish directory** `.` (Netlify reads `netlify.toml`
   automatically).
4. **Site configuration -> Environment variables -> Add a variable:**
   - Key: `GROQ_API_KEY`
   - Value: your Groq key from https://console.groq.com/keys (starts with `gsk_`)
5. **Deploys -> Trigger deploy** (so the function picks up the variable).
6. Open the site, press **New application**, paste a posting + CV, run. No key prompt — the function
   supplies it. Your address looks like `tailor-stagove.netlify.app`.

## Deploy on Render (alternative)

1. Render: **New -> Web Service -> connect the repo.**
2. **Build command:** `npm install` ; **Start command:** `npm start`.
3. **Environment -> Add Environment Variable:** `GROQ_API_KEY` = your `gsk_...` key.
4. Create. Render gives a `...onrender.com` URL.

> **GitHub Pages won't work for this** — Pages serves static files only and can't run the proxy or
> read a secret env var, so the key couldn't stay hidden. Use Netlify or Render. (The site would
> still load on Pages, but every run would fail with no key.)

---

## StaGove delivery-directory entry

- **Name:** Tailor — Autonomous Career Application Manager
- **Domain:** Careers / Job applications (candidate side)
- **What it solves:** Manages every job application end to end — ATS & recruiter simulation, tailored
  CV and tone-matched cover letter, resume-health report, interview prep, improvement roadmap, and
  interview/offer odds — tracked from found to offer, improving on each re-run.
- **Link / access:** deploy to Netlify or Render with a secret `GROQ_API_KEY` env var (above).
- **Delivered:** v2 — 25.06.2026.
- **Not a duplicate of:** Roster (employer-side recruiting), Worth (salary), Atelier (fashion tech
  packs), ScholarMatch (scholarships). Tailor is the only agent on either directory working the
  candidate's side of hiring.
- **Where is the agentic, intelligent nature — and why it can't be done without an AI:** It runs
  extract -> ATS/recruiter simulation -> diagnose -> draft -> self-audit -> revise loops, scoring its
  own CV and letter 0-100 and rewriting until they pass an 85/100 gate, with a fabrication check that
  forces a rewrite if any claim isn't supported by the real CV. It then tracks the application across
  versions and reports what improved. Judging fit, simulating an ATS and a recruiter, reframing
  free-text experience without lying, and grading its own output are semantic judgments no template
  or spreadsheet can make.
- **Disclaimer:** A drafting and analysis tool, not a guarantee of an interview or offer. All
  probabilities are AI estimates from the provided text. The user must read every line and confirm
  it reflects the truth about their experience.

---

*Built for the StaGove autonomous-agents initiative. Runs on free, open-weight models via Groq.*
