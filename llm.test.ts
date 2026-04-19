import { Option as O } from "effect";
import { assertStringIncludes } from "@std/assert";
import { __test_buildPrompt } from "./llm.ts";
import { examplePR } from "./test-helpers.ts";

Deno.test("buildPrompt drops to '(no description)' when body is None", () => {
  const out = __test_buildPrompt({ ...examplePR, body: O.none() }, "CTX");
  assertStringIncludes(out, "Description: (no description)");
  assertStringIncludes(out, "Project context:\nCTX");
});
