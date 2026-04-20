import { Effect as F, pipe, TestClock, TestContext } from "effect";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { __test_truncateDiff, cutoffDate, deduplicatePRs } from "./github.ts";
import { examplePR, runTest } from "./test-helpers.ts";

Deno.test("deduplicatePRs keeps first occurrence, preserves order", () => {
  const a = { ...examplePR, url: "https://a" };
  const b = { ...examplePR, url: "https://b", title: "b" };
  const a2 = { ...examplePR, url: "https://a", title: "a-dup" };
  const result = deduplicatePRs([a, b, a2]);

  assertEquals(result.map((p) => p.title), ["Add billing column", "b"]);
});

Deno.test("truncateDiff is a no-op under the line limit", () => {
  const small = "line1\nline2\nline3";
  assertEquals(__test_truncateDiff(small), small);
});

Deno.test("truncateDiff cuts + annotates when over the line limit", () => {
  const big = Array.from({ length: 2000 }, (_, i) => `line${i}`).join("\n");
  const out = __test_truncateDiff(big);

  assertStringIncludes(out, "... truncated (2000 total lines)");

  const kept = out.split("\n").filter((l) => l.startsWith("line"));
  assertEquals(kept.length, 1500);
});

Deno.test("cutoffDate uses current time minus lookback", async () => {
  await runTest(
    pipe(
      F.gen(function* () {
        yield* TestClock.setTime(new Date("2026-04-18T10:00:00Z").getTime());
        const cutoff = yield* cutoffDate(48);
        assertEquals(cutoff, "2026-04-16T10:00:00.000Z");
      }),
      F.provide(TestContext.TestContext),
    ),
  );
});
