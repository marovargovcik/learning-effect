import {
  Config,
  Data,
  Effect as F,
  Layer,
  Option as O,
  pipe,
  Redacted,
} from "effect";
import OpenAI from "openai";
import type { PRInfo, SummarizedPR } from "./model.ts";

class LLMError extends Data.TaggedError("LLMError")<{
  readonly prTitle: string;
  readonly cause: unknown;
}> {}

class LLM extends F.Tag("pr-summary/LLM")<
  LLM,
  {
    readonly summarize: (
      pr: PRInfo,
      projectContext: string,
    ) => F.Effect<O.Option<SummarizedPR>, LLMError>;
  }
>() {
  static readonly live = Layer.effect(
    LLM,
    F.gen(function* () {
      const key = yield* openaiKey;
      const openai = new OpenAI({ apiKey: Redacted.value(key) });

      return {
        summarize: (pr, projectContext) =>
          pipe(
            F.tryPromise({
              try: () =>
                openai.chat.completions.create({
                  model: "gpt-4o",
                  messages: [
                    { role: "user", content: buildPrompt(pr, projectContext) },
                  ],
                  max_tokens: 300,
                  temperature: 0.2,
                }),
              catch: (cause) => new LLMError({ prTitle: pr.title, cause }),
            }),
            F.map((response) =>
              pipe(
                O.fromNullable(response.choices[0]?.message?.content?.trim()),
                O.filter((content) => content !== "NOT_RELEVANT"),
                O.map((summary): SummarizedPR => ({
                  title: pr.title,
                  url: pr.url,
                  repo: pr.repo,
                  author: pr.author,
                  summary,
                  status: pr.status,
                })),
              )
            ),
          ),
      };
    }),
  );
}

const openaiKey = Config.redacted("OPENAI_API_KEY");

const buildPrompt = (pr: PRInfo, projectContext: string): string =>
  `You are reviewing pull requests for relevance to a specific project.

Project context:
${projectContext}

Pull Request:
- Title: ${pr.title}
- Repository: ${pr.repo}
- Author: ${pr.author}
- Description: ${O.getOrElse(pr.body, () => "(no description)")}

Diff:
\`\`\`
${pr.diff}
\`\`\`

Instructions:
1. Determine if this PR is relevant to the project described above. Consider the title, description, and code changes.
2. If NOT relevant, respond with exactly: NOT_RELEVANT
3. If relevant, write a concise 2-3 sentence summary of what the code change does. Focus on the functional impact, not listing files changed. Do not include any prefix — just the summary text.`;

export { buildPrompt as __test_buildPrompt, LLM, LLMError };
