import { Data, Effect as F, Layer } from "effect";
import { ensureDir as denoEnsureDir } from "@std/fs";

class FileSystemError extends Data.TaggedError("FileSystemError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

class FileSystem extends F.Tag("pr-summary/FileSystem")<
  FileSystem,
  {
    readonly readTextFile: (path: string) => F.Effect<string, FileSystemError>;
    readonly writeTextFile: (
      path: string,
      contents: string,
    ) => F.Effect<void, FileSystemError>;
    readonly ensureDir: (path: string) => F.Effect<void, FileSystemError>;
    readonly cwd: F.Effect<string>;
  }
>() {
  static readonly live = Layer.succeed(FileSystem, {
    readTextFile: (path) =>
      F.tryPromise({
        try: () => Deno.readTextFile(path),
        catch: (cause) => new FileSystemError({ path, cause }),
      }),
    writeTextFile: (path, contents) =>
      F.tryPromise({
        try: () => Deno.writeTextFile(path, contents),
        catch: (cause) => new FileSystemError({ path, cause }),
      }),
    ensureDir: (path) =>
      F.tryPromise({
        try: () => denoEnsureDir(path),
        catch: (cause) => new FileSystemError({ path, cause }),
      }),
    cwd: F.sync(() => Deno.cwd()),
  });
}

export { FileSystem, FileSystemError };
