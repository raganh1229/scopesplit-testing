---
description: Safe machine-switch checklist — run before starting work after switching between Windows desktop and MacBook Air
---

## Pre-flight: switching machines

Run these steps in order every time you pick up work on a new machine.

### 1. Pull latest code
```
git pull origin dev
```
If you were on `main` last session, also pull that:
```
git pull origin main
```

### 2. Check for merge conflicts
```
git status
```
If any conflicts exist, resolve them before proceeding.

### 3. Install any new dependencies
```
npm install
```
Run this from `estimatch-app/`. Safe to run even if nothing changed.

### 4. Verify TypeScript compiles cleanly
// turbo
```
npx tsc --noEmit --project tsconfig.json
```
If errors appear, do NOT start a session — fix them first.

### 5. Confirm dev server starts
```
npm run dev
```
Wait for `✓ Ready` in the output. Then kill it (Ctrl+C) — this just confirms the build works.

### 6. Check which branch you are on
```
git branch
```
You should be on `dev` for active work. Only merge to `main` after a clean accuracy run.

---

## End of session: before switching machines

Run these before closing the laptop.

### 1. Commit everything (even WIP)
```
git add -A
git commit -m "wip: <brief description of what you were doing>"
git push origin dev
```

### 2. Note your stopping point
Leave a one-line comment in the file you were working in, or write a brief note here so Cascade on the other machine has context.

---

## Merging dev → main (after a clean run)

Only do this after a successful accuracy run (item accuracy ≥ 85%, no pipeline errors).

```
git checkout main
git merge dev
git push origin main
git checkout dev
```

---

## .env.local reminder

`.env.local` is **never committed to git** (it's in `.gitignore`). You must manually keep copies on both machines in sync. If you add a new env variable on one machine, add it to the other before switching.

Key variables to keep in sync:
- `ANTHROPIC_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
- `VOYAGE_API_KEY`
- `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`
- `DATABASE_URL`
- Any Stripe/Clerk/Resend keys
