import { Option as O } from "effect";

type PRStatus = "open" | "merged";

type PRInfo = {
  readonly title: string;
  readonly url: string;
  readonly repo: string;
  readonly author: string;
  readonly body: O.Option<string>;
  readonly diff: string;
  readonly status: PRStatus;
};

type SummarizedPR = {
  readonly title: string;
  readonly url: string;
  readonly repo: string;
  readonly author: string;
  readonly summary: string;
  readonly status: PRStatus;
};

export type { PRInfo, PRStatus, SummarizedPR };
