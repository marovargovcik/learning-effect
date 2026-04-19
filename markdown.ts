import type { SummarizedPR } from "./model.ts";

const renderPRSection = (prs: readonly SummarizedPR[]): string => {
  if (prs.length === 0) return "No relevant PRs found.\n";
  return prs
    .map(
      (pr) =>
        `### [${pr.title}](${pr.url})\n**Repo:** ${pr.repo} | **Author:** ${pr.author}\n${pr.summary}\n`,
    )
    .join("\n");
};

const buildMarkdown = (
  prs: readonly SummarizedPR[],
  configName: string,
  lookbackHours: number,
  now: Date,
): string => {
  const date = now.toISOString().split("T")[0];

  const open: SummarizedPR[] = [];
  const merged: SummarizedPR[] = [];

  for (const pr of prs) {
    (pr.status === "open" ? open : merged).push(pr);
  }

  return [
    `# PR Summary — ${configName} (${date})`,
    "",
    "## Open PRs",
    "",
    renderPRSection(open),
    "---",
    "",
    `## Recently Merged PRs (last ${lookbackHours}h)`,
    "",
    renderPRSection(merged),
  ].join("\n");
};

export { buildMarkdown };
