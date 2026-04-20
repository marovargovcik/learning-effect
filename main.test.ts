import {
  Effect as F,
  Layer,
  Option as O,
  pipe,
  Ref,
  TestClock,
  TestContext,
} from "effect";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { Github } from "./github.ts";
import { LLM, LLMError } from "./llm.ts";
import type { PRInfo, SummarizedPR } from "./model.ts";
import { program } from "./main.ts";
import { examplePR, runTest, setupInMemoryFileSystem } from "./test-helpers.ts";

const mergedPR: PRInfo = {
  title: "Wire subsidy hook",
  url: "https://github.com/famly/app/pull/2",
  repo: "famly/app",
  author: "octocat",
  body: O.none(),
  diff: "diff --git a/... \n+hook",
  status: "merged",
};

type FakeGithubOpts = {
  readonly open?: Record<string, readonly PRInfo[]>;
  readonly merged?: Record<string, readonly PRInfo[]>;
};

const FakeGithub = (opts: FakeGithubOpts) =>
  Layer.succeed(Github, {
    listOpenPRs: (repo, user) =>
      F.succeed(opts.open?.[`${repo}|${user}`] ?? []),
    listMergedPRs: (repo, user, _cutoff) =>
      F.succeed(opts.merged?.[`${repo}|${user}`] ?? []),
  });

type FakeLLMOpts = {
  readonly isRelevant: (pr: PRInfo) => boolean;
};

const FakeLLM = ({ isRelevant }: FakeLLMOpts) =>
  Layer.succeed(LLM, {
    summarize: (pr, _projectContext) =>
      F.succeed(
        isRelevant(pr)
          ? O.some<SummarizedPR>({
            title: pr.title,
            url: pr.url,
            repo: pr.repo,
            author: pr.author,
            summary: `summary of ${pr.title}`,
            status: pr.status,
          })
          : O.none(),
      ),
  });

Deno.test("program: fetches, filters, summarizes, writes markdown", async () => {
  const configJson = JSON.stringify({
    users: ["octocat"],
    repos: ["famly/app"],
    projectContext: "billing",
    lookbackHours: 48,
  });

  const openPR: PRInfo = { ...examplePR, title: "relevant billing PR" };
  const openIrrelevant: PRInfo = {
    ...examplePR,
    title: "unrelated thing",
    url: "https://x/u",
  };

  const { InMemoryFileSystem, ref: fsRef } = await setupInMemoryFileSystem({
    "/config.json": configJson,
  });

  const AppTest = Layer.mergeAll(
    InMemoryFileSystem,
    FakeGithub({
      open: { "famly/app|octocat": [openPR, openIrrelevant] },
      merged: { "famly/app|octocat": [mergedPR] },
    }),
    FakeLLM({
      isRelevant: (pr) =>
        pr.title.toLowerCase().includes("billing") || pr.status === "merged",
    }),
  );

  await runTest(
    pipe(
      F.gen(function* () {
        yield* TestClock.setTime(new Date("2026-04-18T10:00:00Z").getTime());
        return yield* program("/config.json");
      }),
      F.provide(AppTest),
      F.provide(TestContext.TestContext),
    ),
  );

  const fsState = await F.runPromise(Ref.get(fsRef));
  const outputs = [...fsState.entries()].filter(([p]) =>
    p.endsWith("config.md")
  );

  assertEquals(outputs.length, 1);

  const [, md] = outputs[0];

  assertStringIncludes(md, "# PR Summary — config (2026-04-18)");
  assertStringIncludes(md, "[relevant billing PR]");
  assertStringIncludes(md, "[Wire subsidy hook]");

  const lowerMd = md.toLowerCase();

  if (lowerMd.includes("unrelated thing")) {
    throw new Error("irrelevant PR leaked into markdown output");
  }
});

Deno.test("program: tolerates per-PR LLM failures", async () => {
  const configJson = JSON.stringify({
    users: ["octocat"],
    repos: ["famly/app"],
    projectContext: "billing",
    lookbackHours: 48,
  });

  const { InMemoryFileSystem, ref: fsRef } = await setupInMemoryFileSystem({
    "/c.json": configJson,
  });

  const FlakyLLM = Layer.succeed(LLM, {
    summarize: (pr, _projectContext) =>
      pr.title === "bad one"
        ? F.fail(new LLMError({ prTitle: pr.title, cause: "boom" }))
        : F.succeed(O.some<SummarizedPR>({
          title: pr.title,
          url: pr.url,
          repo: pr.repo,
          author: pr.author,
          summary: "ok",
          status: pr.status,
        })),
  });

  const AppTest = Layer.mergeAll(
    InMemoryFileSystem,
    FakeGithub({
      open: {
        "famly/app|octocat": [
          { ...examplePR, title: "bad one", url: "https://x/bad" },
          { ...examplePR, title: "good one", url: "https://x/good" },
        ],
      },
    }),
    FlakyLLM,
  );

  await runTest(
    pipe(
      program("/c.json"),
      F.provide(AppTest),
      F.provide(TestContext.TestContext),
    ),
  );

  const fsState = await F.runPromise(Ref.get(fsRef));
  const outputs = [...fsState.entries()].filter(([p]) => p.endsWith("c.md"));
  const [, md] = outputs[0];

  assertStringIncludes(md, "[good one]");

  if (md.includes("[bad one]")) {
    throw new Error("expected failing PR to be dropped from output");
  }
});
