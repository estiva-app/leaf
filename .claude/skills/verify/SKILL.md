---
name: verify
description: Use to prove a Leaf change works in the running app — the smoke test's Leaf part, against a local build or production.
---

# Verifying Leaf changes at the running app

"It looks right" is not a result. Say what you checked, as whom, and what the page showed.

## The smoke test's Leaf part

The smoke test ([estiva-app/smoke](https://github.com/estiva-app/smoke), checked out beside this repository as
`../smoke`) walks the core flows on production as two test accounts of its own. Leaf takes part in flows 1, 2, 3, 4,
6, 9 and 10; its section of `../smoke/CORE-FLOWS.md` says what a person sees in each. `/land` runs every flow after
each deploy.

Against a local build, served at leaf.estiva.app to the test's browser only, so sign-in and the relay behave as on
production while everyone else keeps the live app (the settings are the deploy workflow's):

```bash
VITE_ESTIVA_ID_ORIGIN=https://id.estiva.app VITE_ESTIVA_ID_CLIENT_ID=estiva-leaf \
  VITE_RELAY_URL=https://estiva.estiva.app npm run build
cd ../smoke && npm ci && node run.mjs --flow 1,2,3,4,6,9,10 --serve leaf=$OLDPWD/dist
```

Against production, drop `--serve`. It exits 0 when every step passed or is known, 1 on a failed step (its screenshot
is in `out/<time>/`), 2 when it could not run. A change to how a core flow looks or works changes its step in the
smoke repository in the same work (`../smoke/README.md`).

## Looking at a page yourself

`node ../smoke/explore.mjs <1|2> leaf <path> [--wait ms] [--click label] [--js expr] [--shot file]` opens a Leaf page
as Smoke Test 1 or 2 on production. What a ticket checks beyond the core flows is its own Done when; never leave test
data on the production relay that you do not delete again.
