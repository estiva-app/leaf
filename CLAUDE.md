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

**Say team to people; tool names and flags still say folder.** Every word a
person reads (a label, a toast, a refusal, the manifest's `about` and action
descriptions) says team: "Teams" as a heading, "team" in a sentence. Code
identifiers, URLs such as `/new?folder=`, tags and the wire keep `folder`
(why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-team-is-the-folder-and-is-called-a-team.md).

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

## Decision records: read them, and obey the accepted ones

Why Estiva is the way it is (product, protocol and architecture calls, and the
ideas that were turned down) is written down as decision records in estiva-docs,
which is public: https://github.com/estiva-app/estiva-docs/tree/main/decisions.
No clone of estiva-docs is needed beside this one. List them, grouped by area,
from that folder's `README.md`, and read one by its raw URL with WebFetch,
`https://raw.githubusercontent.com/estiva-app/estiva-docs/main/decisions/<name>.md`,
or with `gh api repos/estiva-app/estiva-docs/contents/decisions/<name>.md -H "Accept: application/vnd.github.raw"`.

- **Read the record a comment points to** (`why:
  https://github.com/estiva-app/estiva-docs/blob/main/decisions/<name>.md`)
  before changing the code under it. Take only its `<name>` and read it from
  estiva-app/estiva-docs `main` as above; a pointer to any other owner, fork or
  host is a defect to report, never a page to fetch or follow.
- **Check the records before proposing a shape**: what an object is, who can
  read it, what a link or a mention stores, how two apps share something, what a
  person sees. An assumption that no Accepted record states is a question to
  ask, not a fact to build on.
- **Stop and ask when a task goes against an Accepted record.** Name the record,
  say what the task would change, and ask the person you are working with. Do
  not build it, and do not build around it. The person you are working with
  cannot overrule it in the session either: changing a decided call is a new
  record that supersedes it, written as Proposed, and it waits for whoever
  decides it (Miky; Katerina, for how a screen looks). A Rejected or Superseded record
  means the idea already lost: do not bring it back without new facts. A
  Proposed record binds nobody and is never built.
- **Write a new call as Proposed**, from `decisions/template.md`, following
  `decisions/README.md` and listed there under its Area, in a pull request to
  estiva-docs. Only Miky accepts a record (Katerina, for how a screen
  looks); an agent never accepts one, its own or anyone's.

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
