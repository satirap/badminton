# ก๊วนอยากตี ต้องได้ตี — payment app

Static site on GitHub Pages (`main` branch → https://satirap.github.io/badminton/). Data in Firestore project `badminton-642a3`
(`payment_sessions`, `pool_state/singleton`, `shuttle_stock/singleton`). The repo is PUBLIC — never commit data or secrets.

## Every change (mandatory)
1. Bump the version (patch = fix, minor = feature, major = breaking) and run `python3 tools/stamp_version.py <x.y.z>`
   — it writes `VERSION`, `APP_VERSION`/`APP_BUILD` and the footer badge in `payment.html`.
2. Add a `## <version> — <YYYY-MM-DD>` entry to `CHANGELOG.md` (short Thai bullets).
3. After deploy, verify the live page shows the new version (`curl` the page and grep `APP_VERSION`).
4. End the reply with the version + build, e.g. "ตอนนี้เป็น v5.3.0 · build 2026-10-14 17:13".

## Data safety
- Back up all three collections to `backups/<timestamp>/` (gitignored) before any change that can touch data; verify counts.
- Test on a copy with every Firestore write stubbed; never test against live writes.
- Never delete live data yourself — let the admin use the app's 🗑 buttons; field-level updates only.

## Deploy
Work on `feature/court-hours-v2`, commit, cherry-pick to `main`, push both over HTTPS
(`git push https://github.com/satirap/badminton.git main:main`), then check the live file hash matches.
