import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildMarkdown } from "./markdown.ts";

Deno.test("buildMarkdown splits open vs merged, uses provided date", () => {
  const now = new Date("2026-04-18T10:00:00Z");
  const md = buildMarkdown(
    [
      {
        title: "Open thing",
        url: "https://x/1",
        repo: "famly/app",
        author: "a",
        summary: "does open",
        status: "open",
      },
      {
        title: "Merged thing",
        url: "https://x/2",
        repo: "famly/app",
        author: "b",
        summary: "did merged",
        status: "merged",
      },
    ],
    "billing",
    48,
    now,
  );

  assertStringIncludes(md, "# PR Summary — billing (2026-04-18)");
  assertStringIncludes(md, "## Open PRs");
  assertStringIncludes(md, "[Open thing](https://x/1)");
  assertStringIncludes(md, "## Recently Merged PRs (last 48h)");
  assertStringIncludes(md, "[Merged thing](https://x/2)");
});

Deno.test("buildMarkdown says 'No relevant PRs found.' for empty sections", () => {
  const md = buildMarkdown([], "demo", 24, new Date("2026-04-18T10:00:00Z"));
  const matches = md.match(/No relevant PRs found\./g) ?? [];

  assertEquals(matches.length, 2);
});
