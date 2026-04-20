import {
  Clock,
  Config,
  Data,
  Effect as F,
  Layer,
  Option as O,
  pipe,
  Redacted,
} from "effect";
import { Octokit } from "octokit";
import type { PRInfo } from "./model.ts";

class GithubError extends Data.TaggedError("GithubError")<{
  readonly op: string;
  readonly cause: unknown;
}> {}

class Github extends F.Tag("pr-summary/Github")<
  Github,
  {
    readonly listOpenPRs: (
      repo: string,
      user: string,
    ) => F.Effect<readonly PRInfo[], GithubError>;
    readonly listMergedPRs: (
      repo: string,
      user: string,
      cutoffDate: string,
    ) => F.Effect<readonly PRInfo[], GithubError>;
  }
>() {
  static readonly live = Layer.effect(
    Github,
    F.gen(function* () {
      const token = yield* githubToken;
      const octokit = makeClient(Redacted.value(token));

      return {
        listOpenPRs: listOpenPRs(octokit),
        listMergedPRs: listMergedPRs(octokit),
      };
    }),
  );
}

const MAX_DIFF_LINES = 1500;

const truncateDiff = (diff: string): string => {
  const lines = diff.split("\n");

  return lines.length > MAX_DIFF_LINES
    ? lines.slice(0, MAX_DIFF_LINES).join("\n") +
      `\n\n... truncated (${lines.length} total lines)`
    : diff;
};

const deduplicatePRs = (
  prs: readonly PRInfo[],
): readonly PRInfo[] => {
  const seen = new Set<string>();
  const out: PRInfo[] = [];

  for (const pr of prs) {
    if (!seen.has(pr.url)) {
      seen.add(pr.url);
      out.push(pr);
    }
  }

  return out;
};

const cutoffDate = (
  lookbackHours: number,
): F.Effect<string> =>
  pipe(
    Clock.currentTimeMillis,
    F.map((now) =>
      new Date(now - lookbackHours * 60 * 60 * 1000).toISOString()
    ),
  );

const githubToken = Config.redacted("FAMLYDEV_GITHUB_TOKEN");

const makeClient = (token: string): Octokit => new Octokit({ auth: token });

const fetchDiff = (
  octokit: Octokit,
  owner: string,
  repoName: string,
  pullNumber: number,
): F.Effect<string, GithubError> =>
  F.tryPromise({
    try: async () => {
      const { data } = await octokit.rest.pulls.get({
        owner,
        repo: repoName,
        pull_number: pullNumber,
        mediaType: { format: "diff" },
      });
      // With mediaType: "diff", octokit's response body is a string even
      // though the type says otherwise.
      return truncateDiff(data as unknown as string);
    },
    catch: (cause) =>
      new GithubError({
        op: `fetchDiff(${owner}/${repoName}#${pullNumber})`,
        cause,
      }),
  });

const listOpenPRs =
  (octokit: Octokit) =>
  (repo: string, user: string): F.Effect<readonly PRInfo[], GithubError> =>
    F.gen(function* () {
      const [owner, repoName] = repo.split("/");

      const pulls = yield* F.tryPromise({
        try: async () => {
          const { data } = await octokit.rest.pulls.list({
            owner,
            repo: repoName,
            state: "open",
            // 100 is GitHub's hard per_page cap and covers our workload
            // (small author set × short lookback). No paginate() needed.
            per_page: 100,
          });

          return data;
        },
        catch: (cause) =>
          new GithubError({ op: `listOpenPRs(${repo})`, cause }),
      });

      const mine = pulls.filter(
        (pr) => pr.user?.login.toLowerCase() === user.toLowerCase(),
      );

      return yield* F.forEach(
        mine,
        (pr) =>
          pipe(
            fetchDiff(octokit, owner, repoName, pr.number),
            F.map((diff): PRInfo => ({
              title: pr.title,
              url: pr.html_url,
              repo,
              author: pr.user?.login ?? user,
              body: O.fromNullable(pr.body),
              diff,
              status: "open",
            })),
          ),
        { concurrency: 5 },
      );
    });

const listMergedPRs = (octokit: Octokit) =>
(
  repo: string,
  user: string,
  cutoffDate: string,
): F.Effect<readonly PRInfo[], GithubError> =>
  F.gen(function* () {
    const [owner, repoName] = repo.split("/");

    const pulls = yield* F.tryPromise({
      try: async () => {
        const { data } = await octokit.rest.pulls.list({
          owner,
          repo: repoName,
          state: "closed",
          sort: "updated",
          direction: "desc",
          // 100 is GitHub's hard per_page cap and covers our workload
          // (small author set × short lookback). No paginate() needed.
          per_page: 100,
        });

        return data;
      },
      catch: (cause) =>
        new GithubError({ op: `listMergedPRs(${repo})`, cause }),
    });

    const merged = pulls.filter(
      (pr) =>
        pr.merged_at !== null &&
        pr.merged_at >= cutoffDate &&
        pr.user?.login.toLowerCase() === user.toLowerCase(),
    );

    return yield* F.forEach(
      merged,
      (pr) =>
        pipe(
          fetchDiff(octokit, owner, repoName, pr.number),
          F.map((diff): PRInfo => ({
            title: pr.title,
            url: pr.html_url,
            repo,
            author: pr.user?.login ?? user,
            body: O.fromNullable(pr.body),
            diff,
            status: "merged",
          })),
        ),
      { concurrency: 5 },
    );
  });

export {
  cutoffDate,
  deduplicatePRs,
  Github,
  GithubError,
  truncateDiff as __test_truncateDiff,
};
