# Leaf, for Claude Code

Leaf is an Estiva app. Its parts, tokens and gates come from `@estiva-app/ui`.

**Use the package's parts, never a raw element or a hand-built look.** The gate
refuses code that reaches past the package, and each refusal names what to use
instead. What it refuses is the package's to say, and grows with it: the
`estiva-ui` skill lists it. It runs before you write
(the hook in `.claude/settings.json`, for a session started in this folder), in
`npm run lint:rules` and in CI. A session started elsewhere: run
`npm run lint:rules` after changing `src/`, and fix what it reports. Keep something
only with its reason on the line above, `// @estiva-escape(<rule>): <reason>`, never with
`eslint-disable`.

**Tokens only.** Colours, type, corners and shadows come from the package's preset.

**One relay connection per tab.** `relayClient()` in `src/relay/client.ts` is the
connection. Never open a socket and never make a second holder: the relay signs a
connection in once, and caps subscriptions per connection.

**Look before you build.** `npm run ui:find <what it does>` searches the package's
parts and this app's own. Use what it finds.

**Every part says what it is for.** A new part gets a one-line `/** … */` comment
directly above it. `npm run registry:check` and CI's job `gate` refuse a part without one.

**The count starts at zero and stays there** (`.gates-count.json`, `docs/GATES-DEBT.md`).

What each gate is and how it is wired: the package's README,
`node_modules/@estiva-app/ui/README.md`.
