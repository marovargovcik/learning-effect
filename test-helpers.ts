import { Effect as F, Layer, Option as O, pipe, Ref } from "effect";
import { FileSystem, FileWriteError } from "./file-system.ts";
import type { PRInfo } from "./model.ts";

const runTest = <A, E>(eff: F.Effect<A, E, never>): Promise<A> =>
  F.runPromise(eff);

const examplePR: PRInfo = {
  title: "Add billing column",
  url: "https://github.com/famly/app/pull/1",
  repo: "famly/app",
  author: "octocat",
  body: O.some("Adds a new billing column"),
  diff: "diff --git a/... \n+column billing",
  status: "open",
};

const makeInMemoryFileSystem = (initial: Record<string, string> = {}) =>
  F.gen(function* () {
    const ref = yield* Ref.make<Map<string, string>>(
      new Map(Object.entries(initial)),
    );

    const fs: FileSystem["Type"] = {
      readTextFile: (path) =>
        pipe(
          Ref.get(ref),
          F.flatMap((state) => {
            const content = state.get(path);

            return content === undefined
              ? F.fail(new FileWriteError({ path, cause: "not found" }))
              : F.succeed(content);
          }),
        ),
      writeTextFile: (path, contents) =>
        Ref.update(ref, (state) => new Map(state).set(path, contents)),
      ensureDir: (_path) => F.void,
    };
    return { fs, ref };
  });

const InMemoryFileSystem = (initial: Record<string, string> = {}) =>
  Layer.effect(
    FileSystem,
    pipe(makeInMemoryFileSystem(initial), F.map(({ fs }) => fs)),
  );

const setupInMemoryFileSystem = async (
  initial: Record<string, string> = {},
) => {
  const { fs, ref } = await F.runPromise(makeInMemoryFileSystem(initial));
  return { fs: Layer.succeed(FileSystem, fs), ref };
};

export {
  examplePR,
  InMemoryFileSystem,
  makeInMemoryFileSystem,
  runTest,
  setupInMemoryFileSystem,
};
