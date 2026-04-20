import { Clock, Data, Effect as F, Layer, Option as O, pipe } from "effect";
import { basename, join } from "@std/path";
import { type Config, loadConfig } from "./config.ts";
import type { PRInfo, SummarizedPR } from "./model.ts";
import { cutoffDate, deduplicatePRs, Github } from "./github.ts";
import { LLM } from "./llm.ts";
import { FileSystem } from "./file-system.ts";
import { buildMarkdown } from "./markdown.ts";

class MissingArgError extends Data.TaggedError("MissingArgError")<{
  readonly message: string;
}> {}

const fetchAllPRs = (
  config: Config,
  cutoffDate: string,
): F.Effect<readonly PRInfo[], never, Github> =>
  F.gen(function* () {
    const github = yield* Github;
    const pairs = config.repos.flatMap((repo) =>
      config.users.map((user) => ({ repo, user }))
    );

    const perPair = yield* F.forEach(
      pairs,
      ({ repo, user }) =>
        F.gen(function* () {
          yield* F.logInfo(`fetching PRs`, { repo, user });

          const open = yield* pipe(
            github.listOpenPRs(repo, user),
            F.catchAll((e) =>
              pipe(
                F.logWarning("listOpenPRs failed — skipping", e),
                F.as<readonly PRInfo[]>([]),
              )
            ),
          );

          const merged = yield* pipe(
            github.listMergedPRs(repo, user, cutoffDate),
            F.catchAll((e) =>
              pipe(
                F.logWarning("listMergedPRs failed — skipping", e),
                F.as<readonly PRInfo[]>([]),
              )
            ),
          );

          return [...open, ...merged];
        }),
      { concurrency: 3 },
    );

    return deduplicatePRs(perPair.flat());
  });

const summarizePRs = (
  prs: readonly PRInfo[],
  projectContext: string,
): F.Effect<readonly SummarizedPR[], never, LLM> =>
  F.gen(function* () {
    const llm = yield* LLM;

    const results = yield* F.forEach(
      prs,
      (pr) =>
        pipe(
          F.logInfo(`summarizing`, { title: pr.title }),
          F.zipRight(llm.summarize(pr, projectContext)),
          F.tap((result) =>
            O.isNone(result)
              ? F.logInfo(`skipped (not relevant)`, { title: pr.title })
              : F.void
          ),
          F.catchAll((e) =>
            pipe(
              F.logWarning("LLM call failed — skipping PR", e, {
                title: pr.title,
              }),
              F.as(O.none<SummarizedPR>()),
            )
          ),
        ),
      { concurrency: 3 },
    );

    return results.flatMap(O.toArray);
  });

const writeOutput = (
  summarized: readonly SummarizedPR[],
  configName: string,
  lookbackHours: number,
) =>
  F.gen(function* () {
    const fs = yield* FileSystem;
    const now = new Date(yield* Clock.currentTimeMillis);
    const md = buildMarkdown(summarized, configName, lookbackHours, now);

    const cwd = yield* fs.cwd;
    const outputDir = join(cwd, "artifacts");
    yield* fs.ensureDir(outputDir);

    const outputPath = join(outputDir, `${configName}.md`);

    yield* fs.writeTextFile(outputPath, md);
    yield* F.logInfo(`output written`, { path: outputPath });

    return outputPath;
  });

const program = (configPath: string) =>
  F.gen(function* () {
    const config = yield* loadConfig(configPath);
    const configName = basename(configPath, ".json");

    yield* F.logInfo("starting", {
      configName,
      users: config.users,
      repos: config.repos,
      lookbackHours: config.lookbackHours,
    });

    const cutoff = yield* cutoffDate(config.lookbackHours);

    const prs = yield* fetchAllPRs(config, cutoff);
    yield* F.logInfo(`found ${prs.length} unique PRs`);

    const summarized = yield* summarizePRs(prs, config.projectContext);
    yield* F.logInfo(`${summarized.length} relevant PRs`);

    return yield* writeOutput(summarized, configName, config.lookbackHours);
  });

if (import.meta.main) {
  const bootstrap = pipe(
    F.fromNullable(Deno.args[0]),
    F.mapError(() =>
      new MissingArgError({
        message: "Usage: deno run pr-summary/main.ts <config-path>",
      })
    ),
    F.flatMap(program),
  );

  const AppLive = Layer.mergeAll(
    FileSystem.live,
    Github.live,
    LLM.live,
  );

  F.runPromise(pipe(bootstrap, F.provide(AppLive))).catch((err) => {
    console.error("Fatal:", err);
    Deno.exit(1);
  });
}

export { program };
