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

const ConfigSchema = Schema.Struct({
  users: Schema.Array(Schema.String),
  repos: Schema.Array(Schema.String),
  projectContext: Schema.String,
  lookbackHours: Schema.Number,
});

type Config = Schema.Schema.Type<typeof ConfigSchema>;

const loadConfig = (
  path: string,
): F.Effect<Config, ConfigReadError | ConfigParseError, FileSystem> =>
  F.gen(function* () {
    const fs = yield* FileSystem;

    const text = yield* pipe(
      fs.readTextFile(path),
      F.mapError((e) => new ConfigReadError({ path, cause: e.cause })),
    );

    return yield* pipe(
      Schema.decodeUnknown(Schema.parseJson(ConfigSchema))(text),
      F.mapError((cause) => new ConfigParseError({ path, cause })),
    );
  });

export {
  type Config,
  ConfigParseError,
  ConfigReadError,
  ConfigSchema,
  loadConfig,
};
