import { Data, Effect as F, pipe, Schema } from "effect";
import { FileSystem } from "./file-system.ts";

class ConfigReadError extends Data.TaggedError("ConfigReadError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

class ConfigParseError extends Data.TaggedError("ConfigParseError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

const RepoSlug = Schema.String.pipe(
  Schema.pattern(/^[^/\s]+\/[^/\s]+$/, {
    message: () => "repo must be in 'owner/name' format",
  }),
);

const ConfigSchema = Schema.Struct({
  users: Schema.Array(Schema.String),
  repos: Schema.Array(RepoSlug),
  projectContext: Schema.String,
  lookbackHours: Schema.Number.pipe(Schema.positive()),
});

type Config = Schema.Schema.Type<typeof ConfigSchema>;

const loadConfig = (
  path: string,
): F.Effect<Config, ConfigReadError | ConfigParseError, FileSystem> =>
  F.gen(function* () {
    const fs = yield* FileSystem;

    const text = yield* pipe(
      fs.readTextFile(path),
      F.mapError((e) => new ConfigReadError({ path, cause: e })),
    );

    return yield* pipe(
      Schema.decodeUnknown(Schema.parseJson(ConfigSchema))(text),
      F.mapError((cause) => new ConfigParseError({ path, cause })),
    );
  });

export { type Config, ConfigParseError, ConfigReadError, loadConfig };
