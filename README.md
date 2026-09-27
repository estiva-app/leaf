# Leaf

An Estiva app, made with `create-estiva-app` from `@estiva-app/ui`. It starts
with the package's sidebar frame, one theme (`light`), sign-in with Estiva ID,
and every UI Guardrails gate on, at zero.

## Run it

```sh
npm install
npm run dev
```

With no settings it runs **anonymous**: no sign-in is offered, and nothing reaches
the real Estiva ID. To sign in, copy `.env.example` to `.env.local` and fill it in.
The app must first be registered with that Estiva ID as its own app.

## The relay

Leaf is connected to the relay, the workspace, from its first commit, as
whoever signed in. `src/relay/client.ts` holds the tab's one connection: ask it
for `relayClient()`, and never open a socket of your own. The home page shows the
connection's state.

With `VITE_RELAY_URL` empty it runs alone and opens no connection. The relay
also needs sign-in, so with a relay and no sign-in there is no connection either.

Three packages come with it: `@estiva-app/protocol` (the wire: events, ids,
signing, the relay clients), `@estiva-app/platform` (the one connection a tab
holds) and `@estiva-app/interop` (showing another app's objects, from the
manifest that app publishes).

## What you fill in

1. `.env.local`: Estiva ID and the relay (see `.env.example`).
2. `KINDS` in `src/relay/client.ts`: the event kinds Leaf reads. Until then
   it is connected and reads nothing.
3. The product: its pages, and the fold that turns what arrives on the
   connection into the app's state.

Before Leaf can sign in on the real Estiva ID it has to be registered there
as its own app, with:

- its exact redirect address
- every event kind it will sign, **including 22242**, the relay's sign-in handshake
- the relay's address, allowed for that handshake. Estiva ID signs a handshake
  only for a relay both the app and the deployment allow.

Anything left out fails at the very last step: every screen looks right, and
nothing arrives.

## The checks

| command | what |
|---|---|
| `npm run typecheck` | TypeScript, the app and its settings files |
| `npm run lint` | everything: TypeScript's and React's rules, the token contract, the gate |
| `npm run lint:rules` | the gate alone, and `.gates-count.json` |
| `npm test` | the tests |
| `npm run build` | the build |
| `npm run gates:status` | which gates are on, read from the code |
| `npm run ui:find <words>` | what the package and this app already have for it |
| `npm run registry:check` | every part says what it is for |
| `npx estiva-gates ci` | every step of CI's job `gate`: the gate, its count committed, the tokens, the catalogue, the hook |
| `npm run storybook` | the stories |

The gates are the package's, imported rather than copied, so a rule written later
arrives with an ordinary version bump. A Claude session started in this folder is
stopped before it writes code the gate refuses (`.claude/settings.json`).

## Once it is on GitHub

Require the check `gate` before anything merges into `main`: a ruleset on `main`
(Settings → Rules → Rulesets) with "Require status checks to pass", the check
`gate`, and no one allowed to bypass it. Until then `npm run gates:status` shows
UIG-6 as not done.
