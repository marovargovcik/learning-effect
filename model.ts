import { Option as O } from "effect";

type PRInfo = {
  readonly title: string;
  readonly url: string;
  readonly repo: string;
  readonly author: string;
  readonly body: O.Option<string>;
  readonly diff: string;
  readonly status: "open" | "merged";
};

type SummarizedPR = {
  readonly title: string;
  readonly url: string;
  readonly repo: string;
  readonly author: string;
  readonly summary: string;
  readonly status: "open" | "merged";
};

export { type PRInfo, type SummarizedPR };
