# PR Summary

A small Deno + Effect-TS program that fetches pull requests authored by a
configured set of users across a configured set of Github repos, asks an LLM
whether each PR is relevant to a project description, and writes a markdown
digest of the relevant ones to `artifacts/<config-name>.md`.

This repo is a didactic Effect-TS playground — it is intentionally small, and
the code is organised to be read top-to-bottom. This README is a map of where
to look.

## What the program does

Given a config file like:

```json
{
  "users": ["octocat"],
  "repos": ["famly/app"],
  "projectContext": "Billing rewrite: subsidies, invoicing, accruals.",
  "lookbackHours": 48
}
```

…running `deno run main.ts path/to/config.json` will:

1. Read and validate the config.
2. For every `(repo, user)` pair, fetch open PRs and recently merged PRs from
   Github.
3. Deduplicate and fetch the diff for each PR.
4. Ask an LLM whether each PR is relevant to `projectContext`, keeping only
   those that are, with a short summary.
5. Write a grouped `# Open PRs` / `# Recently Merged PRs` markdown file to
   `artifacts/`.

## Architecture

The program is built around three ideas from Effect-TS:

**Tagged services.** Every side-effecting capability — the filesystem, Github,
the LLM — is declared as a `F.Tag` with a bare name (`FileSystem`, `Github`,
`LLM`). The tag is an interface plus an identity; the real implementation
lives in a static `.live` layer, and tests swap in fake layers with the same
shape. There is no `Algebra` / `Interpreter` / `Store` cruft — the tag *is*
the service.

**Tagged errors.** Each failure mode is a `Data.TaggedError` subclass with a
narrow payload (`FileSystemError`, `ConfigReadError`, `ConfigParseError`,
`GithubError`, `LLMError`). Effects carry their error type in their signature,
so the pipeline is typed end-to-end — you can see exactly what can fail where.

**Layers wire it together.** `main.ts` composes the `.live` layers into an
`AppLive` at the bottom of the file and provides it once to the whole
pipeline. Tests compose test layers (`InMemoryFileSystem`, `FakeGithub`,
`FakeLLM`) the same way.

The body of the program is written with `F.gen` generators for readability,
and smaller steps are chained with top-level `pipe(..., F.map, F.flatMap,
F.catchAll)`. `Effect` is aliased to `F` and `Option` to `O` throughout.

Pure helpers (`truncateDiff`, `deduplicatePRs`, `buildMarkdown`,
`buildPrompt`, `renderPRSection`) are pulled out of the effectful code so
they can be unit-tested without any layers. Where they need to stay private
to a module but be covered by a test, they are re-exported under a
`__test_`-prefixed alias (e.g. `truncateDiff as __test_truncateDiff`).

## Where to look

Read in roughly this order — each file is small.

### `model.ts`
The data contract. Two types: `PRInfo` (what we get out of Github, with an
`O.Option<string>` body to be explicit about nullable descriptions) and
`SummarizedPR` (what the LLM turns it into — same shape minus `body`/`diff`,
plus a `summary`).

### `file-system.ts`
The smallest service — a thin wrapper over `Deno.readTextFile`,
`Deno.writeTextFile`, `@std/fs`'s `ensureDir`, and `Deno.cwd`. A good first
example of the `F.Tag` + static `.live` pattern used throughout the codebase.

### `config.ts`
Uses `Schema.parseJson(ConfigSchema)` to both parse JSON and validate the
shape in one shot. Notice `RepoSlug` (a `Schema.pattern`-refined string) and
`Schema.positive()` on `lookbackHours` — bad configs fail fast with a typed
`ConfigParseError` instead of blowing up deep in the Github client. `loadConfig`
depends on `FileSystem`, which shows how services compose.

### `github.ts`
The Github service plus three pure helpers worth knowing:

- `truncateDiff` — caps diffs at 1500 lines so we don't blow the LLM's
  context window on one runaway PR.
- `deduplicatePRs` — keeps the first occurrence of each PR URL; we may see
  the same PR twice if a repo-user pair matches multiple filters.
- `cutoffDate` — returns a full ISO-8601 timestamp (via `Clock`, so
  `TestClock` can pin it) that is lexicographically compared against
  `merged_at` in `listMergedPRs`.

`listOpenPRs` and `listMergedPRs` are deliberately not DRY'd up — they
differ in state/filter logic and the small duplication is cheaper than an
abstraction. Both fetch a page of PRs, filter by author client-side, then
`F.forEach(..., { concurrency: 5 })` the diff fetches.

### `llm.ts`
Wraps a single OpenAI chat completion. The prompt is built by the pure
`buildPrompt` helper. The response is decoded defensively: a missing/empty
completion is logged and treated as not-relevant; a literal `NOT_RELEVANT`
becomes `O.none`; anything else becomes `O.some(SummarizedPR)`. Keeping the
"is this relevant?" signal in an `Option` means the pipeline doesn't need a
separate filter step downstream.

### `markdown.ts`
Pure rendering. `buildMarkdown` splits the input into open vs merged,
renders each section (with a "No relevant PRs found." fallback for empty
sections), and joins the pieces. Takes `now: Date` as a parameter rather
than reading the clock itself — the caller in `main.ts` sources the date
from `Clock.currentTimeMillis`, so tests stay deterministic.

### `main.ts`
The orchestration. Read the named functions in order:

1. `fetchAllPRs` — flat-maps `repos × users`, fetches open + merged PRs per
   pair with `concurrency: 3`, `F.catchAll`-logs any failed call so one bad
   repo doesn't sink the whole run, then dedupes.
2. `summarizePRs` — runs LLM calls with `concurrency: 3`, same
   log-and-skip treatment per PR, and flattens `Option`s away at the end.
3. `writeOutput` — builds the path, ensures the dir, writes the file, logs
   the path.
4. `program` — the top-level generator that ties all three together.

The `if (import.meta.main)` block at the bottom is the process entry
point: parse `Deno.args[0]` into a `MissingArgError` if absent, provide
`AppLive`, run.

### Tests
Tests live next to the code (`*.test.ts`) and lean on two patterns:

- **Pure tests** — `markdown.test.ts`, `llm.test.ts`, and parts of
  `github.test.ts` just call the helpers directly with plain data.
- **Program-level tests** — `main.test.ts` builds an `AppTest` layer out of
  `InMemoryFileSystem` + `FakeGithub` + `FakeLLM`, advances `TestClock` to
  a known time, runs `program`, and inspects the written file via a `Ref`
  hanging off the in-memory FS.

`test-helpers.ts` centralises the in-memory filesystem and an `examplePR`
fixture so individual test files stay short.
