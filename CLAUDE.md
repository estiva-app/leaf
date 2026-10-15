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

## Tests: house rules

Read these before writing or changing a test (agent or person). `/land`'s code
reviewer checks every new test in a PR against them (PEE-50, UNI-4).

- **Test what a person or the relay sees**: the rendered text, the enabled
  control, the event that goes on the wire, the row a reader gets back. Not how
  the code arrives there.
- **No tests of** constants, CSS class names, re-exports, type shapes, or
  debugging instruments (a `console.log` or a probe hook). They pass on a broken
  feature and fail on a harmless rename.
- **Fake timers, never real sleeps.** `vi.useFakeTimers()` and advance the clock;
  no `setTimeout` waits, no `sleep(…)`. Real waits fail under load and hide
  races.
- **Test writes at the wire.** A send, edit, delete or membership change is
  asserted on the signed event that would reach the relay (kind, tags, content,
  signer), not on a mocked helper being called.
- **A new test must fail on the bug it is for.** Run it on the code before your
  change: it must fail on an assertion, not on a missing import or a timeout.
  `/land` runs the same check (`old-code-check.mjs`) and, on a PR touching read
  state, access, membership or the wire, plants bugs in the changed lines
  (`plant-check.mjs`); a planted bug no test catches means a test is missing.
- **Mocking a module the code relies on is a decision.** If a test mocks a module
  (for example Ship mocks `./nip44`), something else must cover that module's own
  contract.
- **A test says what it guards**: its name states the behaviour and the case, so
  a red run reads as a real bug.
