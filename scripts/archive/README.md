# Archived local-mock helpers

Demo/prod runs **real VulnHunter** via `scripts/run-real-vh.sh` + gitignored `.env.vh`.

- `seed-demo.mjs` — moved from `scripts/`; service copy requires `ALLOW_SEED_DEMO=1`
- Prefer not to re-seed mock projects into the demo DB
