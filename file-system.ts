import { Data, Effect as F, Layer } from "effect";
import { ensureDir as denoEnsureDir } from "@std/fs";

class FileWriteError extends Data.TaggedError("FileWriteError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

class FileSystem extends F.Tag("pr-summary/FileSystem")<
  FileSystem,
  {
    readonly readTextFile: (path: string) => F.Effect<string, FileWriteError>;
    readonly writeTextFile: (
      path: string,
      contents: string,
    ) => F.Effect<void, FileWriteError>;
    readonly ensureDir: (path: string) => F.Effect<void, FileWriteError>;
  }
>() {
  static readonly live = Layer.succeed(FileSystem, {
    readTextFile: (path) =>
      F.tryPromise({
        try: () => Deno.readTextFile(path),
        catch: (cause) => new FileWriteError({ path, cause }),
      }),
    writeTextFile: (path, contents) =>
      F.tryPromise({
        try: () => Deno.writeTextFile(path, contents),
        catch: (cause) => new FileWriteError({ path, cause }),
      }),
    ensureDir: (path) =>
      F.tryPromise({
        try: () => denoEnsureDir(path),
        catch: (cause) => new FileWriteError({ path, cause }),
      }),
  });
}

export { FileSystem, FileWriteError };
