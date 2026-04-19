import { Effect as F, pipe } from "effect";
import { assertEquals } from "@std/assert";
import { ConfigParseError, ConfigReadError, loadConfig } from "./config.ts";
import { InMemoryFileSystem, runTest } from "./test-helpers.ts";

Deno.test("loadConfig succeeds on valid JSON, fails typed on bad JSON", async () => {
  const configJson = JSON.stringify({
    users: ["octocat"],
    repos: ["famly/app"],
    projectContext: "context",
    lookbackHours: 24,
  });

  await runTest(
    pipe(
      F.gen(function* () {
        const cfg = yield* loadConfig("/cfg.json");
        assertEquals(cfg.users, ["octocat"]);
        assertEquals(cfg.lookbackHours, 24);
      }),
      F.provide(InMemoryFileSystem({ "/cfg.json": configJson })),
    ),
  );

  const parseExit = await F.runPromiseExit(
    pipe(
      loadConfig("/cfg.json"),
      F.provide(InMemoryFileSystem({ "/cfg.json": "not json" })),
    ),
  );
  assertEquals(parseExit._tag, "Failure");
  const parseErr = (parseExit as { cause: { error: unknown } }).cause.error;
  assertEquals((parseErr as ConfigParseError)._tag, "ConfigParseError");

  const readExit = await F.runPromiseExit(
    pipe(loadConfig("/missing.json"), F.provide(InMemoryFileSystem({}))),
  );
  assertEquals(readExit._tag, "Failure");
  const readErr = (readExit as { cause: { error: unknown } }).cause.error;
  assertEquals((readErr as ConfigReadError)._tag, "ConfigReadError");
});
