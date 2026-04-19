# Effect-TS Cheat Sheet

> For the developer fluent in `cats-effect`, `fs2`, `cats`, `fp-ts`, and
> `io-ts`. This is a reference, not a tutorial — FP basics are assumed.
>
> Verified against `effect@3.21.1`. Run examples with `deno run main.ts` in this
> project.

## How to read this sheet

- **Every Effect combinator is dual** — `Effect.map(effect, f)` and
  `pipe(effect, Effect.map(f))` both work. Pick the style that reads best. See
  [§12 Function.dual](#125-functiondual--the-ubiquitous-effect-pattern).
- **The three type parameters** `Effect<A, E, R>` mean: success value, typed
  error, required services. Providing a service _subtracts_ it from `R`; once
  `R = never`, the effect is runnable.
- **Typed errors (`E`) ≠ defects ≠ interruption.** `catchAll` / `catchTag` only
  see typed errors. See [§1.7](#17-defects-vs-failures-vs-interruption).
- **The big mental shift from cats-effect**: stop threading services through
  `Kleisli` or tagless type-class constraints. Put them on `R`, write `Layer`s
  that produce them, let type inference wire the graph. `Effect.provide` is your
  `Kleisli.run`.

## Table of contents

1. [Core: `Effect<A, E, R>`](#1-core-effectaer)
2. [Constructors](#2-constructors)
3. [Running effects](#3-running-effects)
4. [Combinators](#4-combinators)
5. [Error handling](#5-error-handling)
6. [`Cause` and `Exit`](#6-cause-and-exit)
7. [`Effect.gen` in depth](#7-effectgen-in-depth)
8. [Fibers and structured concurrency](#8-fibers-and-structured-concurrency)
9. [Interruption](#9-interruption)
10. [Parallel/sequential combinators](#10-parallelsequential-combinators)
11. [Timing](#11-timing)
12. [Coordination primitives (`Deferred`, `Ref`, `Semaphore`, ...)](#12-coordination-primitives)
13. [`Queue`](#13-queue)
14. [`PubSub`](#14-pubsub)
15. [Scopes and resources](#15-scopes-and-resources)
16. [STM (Software Transactional Memory)](#16-stm)
17. [Services and `Context`](#17-services-and-context)
18. [`Layer`](#18-layer)
19. [`Config`](#19-config)
20. [Logging](#20-logging)
21. [Metrics](#21-metrics)
22. [Tracing](#22-tracing)
23. [Testing (`TestClock`, `@effect/vitest`)](#23-testing)
24. [`Runtime` and `ManagedRuntime`](#24-runtime-and-managedruntime)
25. [Built-in services: `Clock` & `Random`](#25-clock--random)
26. [`Schedule`](#26-schedule)
27. [`Cron`](#27-cron)
28. [`Stream`](#28-stream)
29. [`Schema`](#29-schema)
30. [`Option`](#30-option)
31. [`Either`](#31-either)
32. [Immutable collections (`Chunk`, `HashMap`, ...)](#32-immutable-collections)
33. [`Data` module (structural equality, ADTs)](#33-data-module)
34. [`Match` module (pattern matching)](#34-match-module)
35. [Numeric / string / predicate utilities](#35-numeric--string--predicate-utilities)
36. [`pipe`, `flow`, `Function.dual`](#36-pipe-flow-functiondual)
37. [`Duration`](#37-duration)
38. [`Brand` (nominal & refined types)](#38-brand)
39. [Master cats-effect / fp-ts ↔ Effect table](#39-master-cats-effect--fp-ts--effect-table)
40. [Gotchas](#40-gotchas)

---

## 1. Core: `Effect<A, E, R>`

`Effect<A, E, R>` is a **lazy, immutable description** of a computation. Nothing
runs until it's handed to a runtime (`Effect.runPromise`, `Effect.runSync`,
etc.). It is the ZIO-style three-parameter effect.

| Param | Name             | Meaning                                        | `never` means                                                       |
| ----- | ---------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| `A`   | **Success**      | Value produced if it completes normally.       | Runs forever / can't succeed.                                       |
| `E`   | **Error**        | _Typed, expected, recoverable_ failures.       | Cannot fail with a tracked error (can still die or be interrupted). |
| `R`   | **Requirements** | Services (via `Context.Tag`) the effect needs. | No dependencies; ready to run.                                      |

### 1.1 cats-effect / fp-ts analogs

| Effect-TS                 | cats-effect                                                         | fp-ts                       |
| ------------------------- | ------------------------------------------------------------------- | --------------------------- |
| `Effect<A, never, never>` | `IO[A]`                                                             | `Task<A>`                   |
| `Effect<A, E, never>`     | `EitherT[IO, E, A]`                                                 | `TaskEither<E, A>`          |
| `Effect<A, E, R>`         | `Kleisli[IO, R, A]` stacked with `EitherT`, or ZIO's `ZIO[R, E, A]` | `ReaderTaskEither<R, E, A>` |

### 1.2 Type utilities

```ts
type S = Effect.Effect.Success<typeof program>; // A
type F = Effect.Effect.Error<typeof program>; // E
type C = Effect.Effect.Context<typeof program>; // R
```

---

## 2. Constructors

All live under the `Effect` namespace.

### `Effect.succeed`

Lifts a pure value. Cannot fail, no deps. ≈ `IO.pure`, `TE.right`.

```ts
const one: Effect.Effect<number> = Effect.succeed(1);
```

### `Effect.fail`

Lifts a value into the **typed error channel** (recoverable). ≈
`MonadError#raiseError` on `EitherT[IO, E, *]`.

```ts
class NotFound extends Data.TaggedError("NotFound")<{ id: string }> {}
const boom = Effect.fail(new NotFound({ id: "x" }));
```

### `Effect.sync`

Wraps a **non-throwing** synchronous thunk. Any thrown exception becomes a
**defect**, not a failure. ≈ `IO.delay` for _total_ thunks.

```ts
const now = Effect.sync(() => Date.now());
```

### `Effect.try`

Wraps a synchronous thunk that **might throw**, catching exceptions into `E`. ≈
`E.tryCatch` lifted to `TE`.

```ts
const parse = (s: string) =>
  Effect.try({
    try: () => JSON.parse(s) as unknown,
    catch: (u) => new Error(`bad json: ${String(u)}`),
  });
```

### `Effect.promise`

Wraps a `Promise`-returning thunk **guaranteed not to reject**. Rejections
become defects. ≈ `IO.fromFuture` trusting non-failure.

```ts
const waitMs = (ms: number) =>
  Effect.promise<void>(() => new Promise((res) => setTimeout(res, ms)));
```

### `Effect.tryPromise`

Wraps a `Promise`-returning thunk **that might reject**. Gets an `AbortSignal`
hooked to fiber interruption — use it. ≈
`TE.tryCatch(() => fetch(...), toError)`.

```ts
const getUser = (id: string) =>
  Effect.tryPromise({
    try: (signal) => fetch(`/users/${id}`, { signal }).then((r) => r.json()),
    catch: (u) => new Error(`fetch failed: ${String(u)}`),
  });
```

### `Effect.async`

Bridges **callback-style APIs**. Call `resume` exactly once; optionally return a
cleanup `Effect` for interruption. ≈ `IO.async`.

```ts
const readFile = (path: string) =>
  Effect.async<Buffer, NodeJS.ErrnoException>((resume) => {
    fs.readFile(
      path,
      (err, data) =>
        err ? resume(Effect.fail(err)) : resume(Effect.succeed(data)),
    );
  });
```

### `Effect.suspend`

Defers construction of an Effect until run-time. Useful for recursion without
stack overflow and lazy state reads. ≈ `IO.defer`.

```ts
const ones: Effect.Effect<number> = Effect.suspend(() => ones);
```

### `Effect.void` / `Effect.never` / `Effect.die` / `Effect.dieMessage` / `Effect.failCause`

```ts
Effect.void; // Effect<void> — IO.unit
Effect.never; // suspends forever — IO.never
Effect.die(new Error("bug")); // unrecoverable defect (NOT in E channel)
Effect.dieMessage("unreachable");
Effect.failCause(cause); // re-raise a prebuilt Cause<E>
```

Defects don't appear in the `E` channel. They represent bugs. `Effect.die` is
ZIO's `ZIO.die`; there's no clean cats-effect analog.

### `Effect.gen`

Generator-based monadic syntax — Effect's `for`-comprehension / `do`-notation.
See [§7](#7-effectgen-in-depth).

```ts
const program = Effect.gen(function* () {
  const a = yield* Effect.succeed(1);
  const b = yield* Effect.succeed(2);
  return a + b;
});
```

---

## 3. Running effects

| Need                             | Use                                        |
| -------------------------------- | ------------------------------------------ |
| Top-level `await`                | `Effect.runPromise(effect)`                |
| Top-level with structured errors | `Effect.runPromiseExit(effect)`            |
| Sync hot path                    | `Effect.runSync(effect)`                   |
| Sync, don't throw                | `Effect.runSyncExit(effect)`               |
| Background / long-lived          | `Effect.runFork(effect)` returns a `Fiber` |
| Node-style callback sink         | `Effect.runCallback(effect, { onExit })`   |

### `Effect.runSync` / `Effect.runSyncExit`

Runs a **purely synchronous** Effect. `runSync` throws `FiberFailure` on
failure, throws `AsyncFiberException` if the effect turned out async.
`runSyncExit` returns `Exit<A, E>` instead.

```ts
const n: number = Effect.runSync(Effect.succeed(1));
const exit: Exit.Exit<number, MyErr> = Effect.runSyncExit(program);
```

≈ `IO.unsafeRunSync()` on a `SyncIO`.

### `Effect.runPromise` / `Effect.runPromiseExit`

```ts
const result = await Effect.runPromise(program);
const exit = await Effect.runPromiseExit(program); // always resolves, never rejects
```

Options: `{ signal?: AbortSignal }` — abort the fiber from outside. ≈
`IO#unsafeToFuture()` via `Dispatcher`.

### `Effect.runFork`

The low-level primitive. Spawns a `RuntimeFiber`, returns it immediately.

```ts
const fiber = Effect.runFork(longRunning);
setTimeout(() => Effect.runFork(Fiber.interrupt(fiber)), 1000);
```

### `Effect.runCallback`

```ts
const cancel = Effect.runCallback(program, {
  onExit: (exit) => {
    if (Exit.isSuccess(exit)) console.log(exit.value);
    else console.error(Cause.pretty(exit.cause));
  },
});
```

---

## 4. Combinators

### `Effect.map` / `Effect.flatMap`

```ts
Effect.succeed(1).pipe(Effect.map((n) => n + 1)); // functor
Effect.succeed(1).pipe(Effect.flatMap((n) => Effect.succeed(n + 1))); // bind
```

### `Effect.andThen`

Polymorphic successor — accepts a **value, thunk, Promise, Effect, Option, or
Either**. The Swiss army chain. No exact cats-effect analog.

```ts
Effect.succeed(1).pipe(
  Effect.andThen((n) => n + 1), // value
  Effect.andThen((n) => Promise.resolve(n)), // promise
  Effect.andThen((n) => Effect.succeed(n)), // effect
);
```

### `Effect.tap` / `Effect.tapError` / `Effect.tapBoth`

Peek without consuming. ≈ `IO#flatTap` / `IO#onError` / `guaranteeCase`.

```ts
program.pipe(
  Effect.tap((n) => Console.log(`got ${n}`)),
  Effect.tapError((e) => Console.error(`oops: ${e}`)),
  Effect.tapBoth({
    onSuccess: (a) => Console.log(`ok: ${a}`),
    onFailure: (e) => Console.error(`ko: ${e}`),
  }),
);
```

### `Effect.zip` / `Effect.zipLeft` / `Effect.zipRight` / `Effect.zipWith`

Sequentially run two effects; variants pick/combine the results. Add
`{ concurrent: true }` for parallel.

```ts
Effect.zip(a, b); // [A, B]
Effect.zip(a, b, { concurrent: true }); // parallel
Effect.zipLeft(a, side); // A  (like `<*`)
Effect.zipRight(side, a); // A  (like `*>`)
Effect.zipWith(a, b, (x, y) => x * y); // mapN(_*_)
```

### `Effect.as` / `Effect.asVoid` / `Effect.flip`

```ts
Effect.succeed(1).pipe(Effect.as("done")); // Effect<"done">
Effect.succeed(1).pipe(Effect.asVoid); // Effect<void>
Effect.flip(Effect.fail(err) as Effect<number, E>); // swap A ↔ E
```

### `Effect.forEach` / `Effect.all`

The `traverse`/`sequence` pair. Same concurrency options on both.

```ts
// traverse
Effect.forEach([1, 2, 3], (n) => Effect.succeed(n * 2));
Effect.forEach(urls, fetchOne, { concurrency: 10 }); // like parTraverseN(10)
Effect.forEach(items, process, { concurrency: 5, discard: true });

// sequence — tuple in, tuple out
Effect.all([Effect.succeed(1), Effect.succeed("a")]); // Effect<[number, string]>

// sequence — struct in, struct out
Effect.all({ n: Effect.succeed(1), s: Effect.succeed("a") });

// Options: concurrency, mode ("default" | "either" | "validate"), batching, discard
Effect.all(tasks, { concurrency: "unbounded", mode: "either" });
```

- `mode: "either"` — don't short-circuit; collect per-element `Either`s.
- `mode: "validate"` — return `Effect<A[], Option<E>[], R>` (validation-style
  accumulating error).

---

## 5. Error handling

Effect tracks **expected errors** in the `E` channel. All handlers below narrow
or eliminate `E`.

### Typed errors with `Data.TaggedError`

Preferred pattern — gives you a discriminated union and a class in one line.

```ts
import { Data } from "effect"

class NotFound  extends Data.TaggedError("NotFound")<{ id: string }> {}
class Forbidden extends Data.TaggedError("Forbidden")<{ user: string }> {}

const load = (id: string): Effect.Effect<User, NotFound | Forbidden> => ...
```

### `catchAll` / `catchAllCause`

```ts
// typed errors only (not defects, not interruption)
load(id).pipe(Effect.catchAll((_e) => Effect.succeed(defaultUser)));

// everything: failures, defects, interrupts
program.pipe(
  Effect.catchAllCause((cause) =>
    Console.error(Cause.pretty(cause)).pipe(Effect.as("fallback"))
  ),
);
```

### `catchTag` / `catchTags` / `catchIf`

```ts
load(id).pipe(
  Effect.catchTag("NotFound", (e) => Effect.succeed(`missing ${e.id}`)),
); // Effect<User | string, Forbidden>

load(id).pipe(
  Effect.catchTags({
    NotFound: (e) => Effect.succeed(`missing ${e.id}`),
    Forbidden: (_) => Effect.succeed("denied"),
  }),
);

load(id).pipe(
  Effect.catchIf(
    (e): e is NotFound => e._tag === "NotFound",
    (e) => Effect.succeed(`missing ${e.id}`),
  ),
);
```

### `mapError` / `orElse` / `orDie` / `orElseFail`

```ts
load(id).pipe(Effect.mapError((e) => new Error(e._tag))); // ≈ adaptError
load(id).pipe(Effect.orElse(() => Effect.succeed(defaultUser)));
load(id).pipe(Effect.orDie); // typed fail → defect (E = never)
load(id).pipe(Effect.orElseFail(() => new NotFound({ id })));
```

### `either` / `exit` / `option`

Surface the error on the success side.

```ts
const e: Effect.Effect<Either<User, NotFound | Forbidden>> = Effect.either(
  load(id),
); // ≈ io.attempt
const x: Effect.Effect<Exit<User, NotFound | Forbidden>> = Effect.exit(
  load(id),
); // includes defects & interrupt
const o: Effect.Effect<Option<User>> = Effect.option(load(id));
```

---

## 6. `Cause` and `Exit`

### `Cause<E>`

A **tree** describing everything that went wrong when an effect failed. Richer
than `E`: also carries defects, interruptions, and parallel/sequential
combinations. ZIO's `Cause`; cats-effect has no direct analog (`Outcome` is the
closest).

| Constructor                     | Meaning                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `Cause.empty`                   | No failure.                                                             |
| `Cause.fail(e)`                 | Typed/expected failure of type `E`.                                     |
| `Cause.die(defect)`             | Unexpected defect.                                                      |
| `Cause.interrupt(fiberId)`      | Fiber was interrupted.                                                  |
| `Cause.sequential(left, right)` | Two causes one after the other (e.g. main failure + finalizer failure). |
| `Cause.parallel(left, right)`   | Two causes from concurrent fibers.                                      |

Key operations:

```ts
Cause.isFailType(cause); // is it a Cause.Fail?
Cause.isDie(cause);
Cause.isInterruptedOnly(c);
Cause.failures(cause); // Chunk<E>
Cause.defects(cause); // Chunk<unknown>
Cause.failureOption(cause); // Option<E>
Cause.pretty(cause); // string
Cause.squash(cause); // unknown — a single best-effort value
Cause.match(cause, { // exhaustive pattern match
  onEmpty,
  onFail,
  onDie,
  onInterrupt,
  onSequential,
  onParallel,
});
```

### `Exit<A, E>`

The **result** of running an Effect — a sealed two-case ADT. Think
`Either<Cause<E>, A>` with extras.

```ts
Exit.succeed(1);
Exit.fail(err); // Cause.fail
Exit.die(err); // Cause.die
Exit.failCause(cause);
Exit.isSuccess(exit) / Exit.isFailure(exit);
Exit.match(exit, { onSuccess, onFailure });
```

≈ cats-effect `Outcome[F, E, A]`, but `Exit` folds cancellation and defects into
`Cause`.

### 1.7 Defects vs failures vs interruption

Effect models three distinct error kinds at runtime (via `Cause`), with only
**one** of them in the static `E` type.

| Kind                    | In `E`? | Source                                | How to produce                                 | How to handle                                           |
| ----------------------- | ------- | ------------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| **Failure** (expected)  | Yes     | Domain errors                         | `Effect.fail`, `try`/`tryPromise` `catch`      | `catchAll`, `catchTag`, `either`, `mapError`            |
| **Defect** (unexpected) | No      | Bugs, `throw` inside `sync`/`promise` | `Effect.die`, uncaught throws                  | `catchAllCause` + inspect `Cause.defects`               |
| **Interruption**        | No      | Fiber cancelled                       | `Fiber.interrupt`, `Effect.interrupt`, timeout | Usually propagate; `onInterrupt`/`ensuring` for cleanup |

```ts
const totalHandler = risky.pipe(
  Effect.catchAllCause((cause) => {
    if (Cause.isInterruptedOnly(cause)) return Effect.interrupt;
    if (Cause.isDie(cause)) return Effect.die(Cause.squash(cause));
    return Effect.succeed("recovered");
  }),
);
```

ZIO invented this split. Effect inherits it directly.

---

## 7. `Effect.gen` in depth

```ts
const program = Effect.gen(function* () {
  const a = yield* Effect.succeed(1);
  const b = yield* Effect.succeed(2);
  return a + b;
});
// Effect<number, never, never>
```

- `yield*` **unwraps** an Effect, binding its success value.
- `return` becomes the success value of the whole generator.
- `E` is the union of all yielded effects' errors; `R` is the union of their
  requirements.

### Short-circuiting

The generator halts at the first failed `yield*`. Later statements never run.

```ts
const program = Effect.gen(function* () {
  const a = yield* Effect.succeed(1);
  const b = yield* Effect.fail(new Error("boom")); // short-circuit
  console.log("never printed");
  return a + b;
});
```

### Control flow

Native JS flow works — `if`, `for`, `while`, early `return`:

```ts
Effect.gen(function* () {
  const users = yield* fetchUsers;
  const results: User[] = [];
  for (const u of users) {
    if (u.disabled) continue;
    const enriched = yield* enrich(u); // sequential!
    results.push(enriched);
  }
  return results;
});
```

> A `for` loop with `yield*` is **sequential**. For concurrency, use
> `Effect.forEach(users, enrich, { concurrency: 10 })`.

### Yielding `Option` / `Either` / `Exit`

These implement the Effect interface:

```ts
Effect.gen(function* () {
  const x = yield* Either.right(1); // succeeds with 1
  const y = yield* Option.some(2); // succeeds with 2
  const z = yield* Option.none<number>(); // fails with NoSuchElementException
  return x + y + z;
});
```

### `this` binding

```ts
class Service {
  fetch() {
    return Effect.gen(this, function* () {
      return yield* this.load();
    });
  }
}
```

### vs cats-effect `for`

```scala
// cats-effect
for { a <- IO.pure(1); b <- IO.pure(2) } yield a + b
```

```ts
// Effect-TS
Effect.gen(function* () {
  const a = yield* Effect.succeed(1);
  const b = yield* Effect.succeed(2);
  return a + b;
});
```

Same short-circuit on error, same sequential binding, same "last expression is
the value". JS generators require `yield*` instead of `<-`.

---

## 8. Fibers and structured concurrency

Every `Effect` you run creates a fiber, and forked fibers form a tree. A parent
fiber cannot exit until its (non-daemon) children have terminated — **structured
concurrency by default**.

### `Effect.fork`

Forks onto a new fiber attached to the **current fiber's scope**. When the
parent terminates, children are interrupted.

```ts
const fiber = yield * Effect.fork(Effect.sleep("1 second").pipe(Effect.as(42)));
const result = yield * Fiber.join(fiber); // 42
```

> cats-effect gotcha: `IO#start` is **not** the same — cats-effect fibers are
> NOT auto-cancelled by parents. `Effect.fork` is `start` + auto-supervision.

### `Effect.forkDaemon`

Attached to the **global scope** — survives past the parent. This is the escape
hatch from structured concurrency. cats-effect's plain `IO#start` behaves like
this.

```ts
yield * Effect.forkDaemon(heartbeat);
```

### `Effect.forkScoped`

Attached to the nearest `Scope` in the environment — interrupted when that scope
closes. Perfect for "fiber tied to a resource's lifetime". ≈
`Supervisor[IO].supervise(io)`.

```ts
yield * Effect.forkScoped(Effect.forever(logHeartbeat));
// interrupted when the surrounding Effect.scoped ends
```

### `Effect.forkIn(scope)`

Forks into a specific `Scope` you supply.

### `Fiber.join` / `Fiber.await` / `Fiber.interrupt`

```ts
Fiber.join(fiber); // Effect<A, E>  — re-raises failures (≈ joinWithNever)
Fiber.await(fiber); // Effect<Exit<A, E>>  — returns Exit (≈ cats join)
Fiber.interrupt(fiber); // Effect<Exit<A, E>>  — waits for finalizers
Fiber.interruptFork(fib); // fire-and-forget
```

Structured concurrency summary:

- Failure of any awaited child propagates.
- Parent interruption cascades to children automatically.
- Finalizers always run on interruption.

---

## 9. Interruption

Effect uses **asynchronous interruption**: fibers poll for interruption at safe
points.

### `Effect.interrupt`

Immediately interrupts the current fiber. ≈ `IO.canceled`.

```ts
if (!ok) yield * Effect.interrupt;
```

### `Effect.uninterruptibleMask` — the correct escape hatch

Directly mirrors cats-effect's `IO.uncancelable(poll => ...)`.

```ts
const safe = Effect.uninterruptibleMask((restore) =>
  Effect.gen(function* () {
    const res = yield* acquire; // uninterruptible
    const a = yield* restore(useRes(res)); // interruptible
    yield* release(res); // uninterruptible
    return a;
  })
);
```

`Effect.uninterruptible(effect)` without the mask is usually wrong — prefer
`uninterruptibleMask`.

### `Effect.onInterrupt` / `Effect.onExit` / `Effect.ensuring`

```ts
task.pipe(Effect.onInterrupt((fiberIds) => Console.log("interrupted"))); // ≈ onCancel
task.pipe(Effect.onExit((exit) => Console.log("finished", exit))); // ≈ guaranteeCase
task.pipe(Effect.ensuring(finalizer)); // ≈ guarantee
```

`Effect.disconnect(effect)` — runs the effect on a separate disconnected fiber,
so `Effect.timeout` can return immediately even for uninterruptible operations.

---

## 10. Parallel/sequential combinators

Covered above under `Effect.all` / `Effect.forEach`. Racing:

### `Effect.race`

Runs two effects in parallel; first **successful** result wins, loser is
interrupted. Failures wait for the other side. Returns `A | B`, already
flattened (not `Either` like cats `IO.race`).

```ts
Effect.race(
  fastNetworkCall,
  Effect.sleep("5 seconds").pipe(Effect.as("fallback")),
);
```

### `Effect.raceAll`

N-way race: first success wins, others interrupted.

### `Effect.raceFirst`

Returns whichever **completes first**, success or failure.

### `Effect.raceWith`

Low-level with full callbacks on either side. ≈ `IO.racePair`.

### `Effect.withConcurrency(n)`

Sets the "inherit" concurrency for the enclosing scope. Pair with
`concurrency: "inherit"`.

---

## 11. Timing

```ts
yield * Effect.sleep("500 millis"); // or Duration.seconds(2), or number ms
yield * Effect.sleep(Duration.seconds(2));

const later = Effect.log("fired").pipe(Effect.delay("1 second"));

Effect.timeout(httpCall, "3 seconds"); // fails with TimeoutException

// For uninterruptible operations, disconnect so timeout returns immediately:
Effect.timeout(uninterruptibleJob, "1 second").pipe(Effect.disconnect);

// Variants:
Effect.timeoutOption(d); // Option<A> instead of failing
Effect.timeoutFail({ duration, onTimeout: () => error });
Effect.timeoutFailCause({ duration, onTimeout });
Effect.timeoutTo({ duration, onSuccess, onTimeout });

const [elapsed, result] = yield * Effect.timed(work); // : [Duration, A]
```

---

## 12. Coordination primitives

### 12.1 `Deferred`

A write-once cell. ≈ `cats.effect.Deferred[F, A]`, but with a typed error
channel.

```ts
const d = yield * Deferred.make<string, never>();
yield * Effect.fork(Deferred.succeed(d, "ready"));
const value = yield * Deferred.await(d);
```

All ops: `Deferred.make<A, E>()`, `succeed`, `fail`, `done`,
`complete(d, effect)`, `await`, `poll`, `isDone`, `interrupt`. Completion
returns `boolean` — `true` if this call set it.

### 12.2 `Effect.makeSemaphore`

Permit-based concurrency limiter. Safe under interruption. ≈ `Semaphore[IO](n)`.

```ts
const sem = yield * Effect.makeSemaphore(3);
const limited = (n: number) =>
  sem.withPermits(1)(
    Effect.log(`running ${n}`).pipe(Effect.delay("200 millis")),
  );
yield * Effect.all([1, 2, 3, 4, 5].map(limited), { concurrency: "unbounded" });
```

API: `sem.withPermits(n)(effect)`, `sem.withPermitsIfAvailable(n)(effect)`
(returns `Option<A>`), `sem.take(n)`, `sem.release(n)`, `sem.available`.

### 12.3 `Ref`

Atomic mutable cell. All ops effectful. Safe across fibers via CAS — **no
effectful updates** (use `SynchronizedRef`). ≈ `cats.effect.Ref[F, A]`.

```ts
const ref = yield * Ref.make(0);
yield *
  Effect.forEach(
    Array.from({ length: 100 }, (_, i) => i),
    () => Ref.update(ref, (n) => n + 1),
    { concurrency: "unbounded" },
  );
return yield * Ref.get(ref); // 100
```

Ops: `make`, `get`, `set`, `update`, `updateAndGet`, `getAndSet`,
`getAndUpdate`, `modify(r, (a) => [b, a'])`.

### 12.4 `SynchronizedRef`

`Ref` with `updateEffect` — update function returns an `Effect`. Updates
serialized (mutex, not CAS). ≈ cats-effect 3.5+ `AtomicCell[IO, A]`.

```ts
yield *
  SynchronizedRef.updateEffect(
    state,
    (xs) => fetchNext().pipe(Effect.map((x) => [...xs, x])),
  );
```

### 12.5 `SubscriptionRef`

A `SynchronizedRef` whose current-and-future values are observable via a
`Stream`. **Direct fs2 `SignallingRef` analog**.

```ts
const ref = yield * SubscriptionRef.make(0);
const seen = yield * ref.changes.pipe(Stream.take(3), Stream.runCollect);
// Always starts with current value
```

---

## 13. `Queue`

A `Queue<A>` is a multi-producer/multi-consumer async channel. Each item goes to
**exactly one** taker. ≈ `cats.effect.std.Queue[IO, A]`.

```ts
const bounded = yield * Queue.bounded<number>(100); // back-pressure when full
const unbounded = yield * Queue.unbounded<number>();
const dropping = yield * Queue.dropping<number>(100); // drop NEW items when full
const sliding = yield * Queue.sliding<number>(100); // drop OLD items when full

yield * Queue.offer(q, 1); // Effect<boolean>
yield * Queue.offerAll(q, [1, 2, 3]);
const x = yield * Queue.take(q); // suspends if empty
const xs = yield * Queue.takeAll(q); // Chunk<A> — never suspends
const xs2 = yield * Queue.takeN(q, 10); // suspends until exactly 10
const xs3 = yield * Queue.takeUpTo(q, 10);
const mb = yield * Queue.poll(q); // Option<A> — non-blocking
yield * Queue.shutdown(q);
yield * Queue.awaitShutdown(q);
```

Narrowed interfaces: `Enqueue<A>` (write-only), `Dequeue<A>` (read-only).

---

## 14. `PubSub`

A `PubSub<A>` is a broadcast channel — every published message goes to **every
active subscriber**. ≈ fs2 `Topic[F, A]`.

```ts
const hub = yield * PubSub.bounded<string>(16);

// Subscribe returns a scoped Dequeue<A>
const program = Effect.scoped(Effect.gen(function* () {
  const sub = yield* PubSub.subscribe(hub);
  const msg = yield* Queue.take(sub); // use Queue API on subscriptions
}));

yield * PubSub.publish(hub, "msg");
yield * PubSub.publishAll(hub, ["a", "b"]);
```

Also: `PubSub.unbounded/dropping/sliding`.

---

## 15. Scopes and resources

`Scope` is the first-class resource-lifetime container. An `Effect<A, E, Scope>`
is a **scoped effect** — it requires a `Scope` to run, and will register
finalizers into it.

### `Effect.acquireRelease`

≈ `Resource.make(acquire)(release)`.

```ts
const file = Effect.acquireRelease(
  Effect.sync(() => openFile("data.txt")),
  (handle, exit) => Effect.sync(() => handle.close()),
);
// Effect<Handle, never, Scope>

const program = Effect.scoped(Effect.gen(function* () {
  const f = yield* file;
  return yield* readAll(f);
}));
```

`acquire` is made uninterruptible automatically; `release` runs with the final
`Exit`.

### `Effect.acquireUseRelease`

Inline acquire/use/release, no surrounding `Scope` needed. ≈
`Resource.make(...).use(...)` or `IO.bracket`.

```ts
Effect.acquireUseRelease(
  openConnection,
  (conn) => runQuery(conn, "SELECT 1"),
  (conn, exit) => Effect.sync(() => conn.close()),
);
```

### `Effect.addFinalizer` / `Effect.scoped`

```ts
Effect.gen(function* () {
  yield* Effect.addFinalizer((exit) =>
    Console.log(`closing, exit=${exit._tag}`)
  );
  yield* Effect.addFinalizer(() => Console.log("second"));
  // Finalizers run LIFO
}).pipe(Effect.scoped);
```

`Effect.scoped(eff)` discharges the `Scope` requirement. This is Effect's
`.use(...)`.

**Type-safety**: you can't `Effect.runPromise` anything with `Scope` in its `R`
channel — forgetting to close is a type error.

### Manual scopes

```ts
const scope = yield * Scope.make();
yield * Scope.addFinalizer(scope, Console.log("cleanup"));
yield * Scope.close(scope, Exit.void);
```

---

## 16. STM

`STM<A, E, R>` is a transactional effect. Operations on transactional refs
compose atomically; if any `TRef` it read changed concurrently, the transaction
retries automatically. ≈ `cats-stm` / ZIO STM.

### `STM.commit`

Turns an `STM<A, E, R>` into an `Effect<A, E, R>` by committing atomically.

```ts
const transfer = (from: TRef<number>, to: TRef<number>, amt: number) =>
  STM.gen(function* () {
    const balance = yield* TRef.get(from);
    if (balance < amt) yield* STM.fail("insufficient funds");
    yield* TRef.update(from, (b) => b - amt);
    yield* TRef.update(to, (b) => b + amt);
  });

Effect.runPromise(STM.commit(transfer(a, b, 50)));
```

> There is **no `Effect.atomically`** in current Effect — the single entry point
> is `STM.commit`. Older docs/blog posts show `Effect.atomically` as an alias;
> it was removed.

### Primitives

```ts
// TRef — transactional Ref (like cats-stm TVar)
TRef.make(a): STM<TRef<A>>; TRef.get, .set, .update, .modify

// TQueue — take retries the transaction if empty (magic of STM)
TQueue.bounded(n); TQueue.unbounded(); .offer, .take, .peek, .size

// TPubSub
TPubSub.bounded(n); .publish, .subscribe

// TSemaphore — acquire retries if no permit available
TSemaphore.make(n); TSemaphore.withPermit(sem)(stm)
```

### Composition

```ts
STM.orElse(TQueue.take(q1), () => TQueue.take(q2)); // try left, fall back
STM.gen(function* () {
  const n = yield* TRef.get(counter);
  yield* STM.check(n > 0); // retries until n > 0
  yield* TRef.update(counter, (x) => x - 1);
});
```

Key combinators: `STM.succeed`, `.fail`, `.flatMap`, `.map`, `.catchAll`,
`.orElse`, `.check`, `.retry`, `.all`, `.forEach`.

---

## 17. Services and `Context`

Effect's DI model is the biggest conceptual departure from cats-effect. Instead
of threading services via tagless-final or `Reader[F, R, *]`, Effect carries a
**type-level set of required services** in the third type parameter:

```
Effect<Success, Error, Requirements>
      ≈ Kleisli[IO, R, Either[E, A]]   // rough cats-effect analog
      ≈ ZIO[R, E, A]                   // exact ZIO analog
```

`R` is a **union** of service tags. `Effect.runPromise` requires `R = never`.

### 17.1 `Context.Tag` (class-based, modern form)

```ts
import { Context, Effect } from "effect";

class Random extends Context.Tag("@app/Random")<
  Random, // self-reference (identity)
  { readonly next: Effect.Effect<number> } // shape
>() {}

const program = Effect.gen(function* () {
  const random = yield* Random;
  return yield* random.next;
});
// program: Effect.Effect<number, never, Random>
```

The string `"@app/Random"` is the tag's identity — choose a namespaced unique
string.

### 17.2 `Effect.Service` (batteries-included, preferred)

Bundles tag + shape + default `Layer` in one declaration.

```ts
class Random extends Effect.Service<Random>()("@app/Random", {
  effect: Effect.sync(() => ({
    next: Effect.sync(() => Math.random()),
  })),
}) {}

// Random            is the Tag / type
// Random.Default    is a Layer<Random>  (auto-generated)

const program = Random.use((r) => r.next);
const runnable = program.pipe(Effect.provide(Random.Default));
```

Second-arg keys:

- `succeed: shape` — eager sync
- `sync: () => shape` — lazy sync
- `effect: Effect<shape, E, R>` — effectful
- `scoped: Effect<shape, E, R | Scope>` — resource-bearing
- `accessors: true` — auto-generate static method accessors
- `dependencies: [OtherService.Default, ...]` — auto-wire deps

### 17.3 Accessing services

```ts
// (a) yield* inside Effect.gen
const p1 = Effect.gen(function* () {
  const r = yield* Random;
  return yield* r.next;
});

// (b) Effect.serviceFunctions — auto-lifts pure methods
const RandomFns = Effect.serviceFunctions(Random);

// (c) accessors: true on Effect.Service
class Logger extends Effect.Service<Logger>()("@app/Logger", {
  succeed: { info: (msg: string) => Effect.sync(() => console.log(msg)) },
  accessors: true,
}) {}
// Logger.info("hi") : Effect.Effect<void, never, Logger>
```

### 17.4 `Context` primitives

Rarely used outside of tests:

```ts
const ctx1 = Context.make(Random, { next: Effect.succeed(0.5) });
const ctx2 = Context.add(ctx1, Logger, { info: () => Effect.void });
const ctx3 = Context.merge(ctx1, ctx2); // right wins on conflicts
const r = Context.get(ctx3, Random);

Effect.runPromise(program.pipe(Effect.provide(ctx3)));
```

### 17.5 How `R` tracks requirements

`R` is a **union** of required tags. Providing a service _subtracts_ it via
`Exclude`:

```ts
const ab: Effect.Effect<number, never, Random | Logger> = ...
const provided: Effect.Effect<number, never, Logger> =
  ab.pipe(Effect.provideService(Random, { next: Effect.succeed(0.5) }))
```

Once `R = never`, the effect is runnable. This is ZIO's `ZIO[R, E, A]` with
`provide`/`provideLayer` semantics.

---

## 18. `Layer`

A `Layer<ROut, E, RIn>` is a **recipe that, given `RIn` services, produces
`ROut` services, possibly failing with `E`**.

Key differences from cats-effect `Resource`:

1. Layers are **typed by what they produce**.
2. They **memoize** by default inside a single `provide`.
3. Composition is **automatic by type**.

### 18.1 Constructors

```ts
// Ready-made value — no deps, no errors
Layer.succeed(Random, { next: Effect.sync(() => Math.random()) });

// Build with an Effect (can read services, can fail)
Layer.effect(
  Logger,
  Effect.gen(function* () {
    const cfg = yield* Config;
    return {
      info: (m: string) => Effect.sync(() => console.log(cfg.prefix, m)),
    };
  }),
); // Layer<Logger, never, Config>

// Scoped — resource with acquire/release
Layer.scoped(
  Db,
  Effect.acquireRelease(
    Effect.promise(() => openDb()),
    (conn) => Effect.promise(() => conn.close()),
  ),
);

// Pure synchronous construction (lazy)
Layer.sync(Counter, () => ({ value: 0 }));

// From a function over another service
Layer.function(Greeter, Logger, (logger) => ({
  greet: (name: string) => logger.info(`hi ${name}`),
}));
```

### 18.2 Composition: `merge`, `provide`, `provideMerge`

```
merge        : [A]  [B]                  →  Layer<A | B, ..., R>         (side by side)
provide      : [Config]─►[Logger]         →  Layer<Logger, ..., never>    (hides Config)
provideMerge : [Config]─►[Logger]         →  Layer<Logger | Config, ...>  (exposes both)
```

```ts
const CoreLive = Layer.merge(LoggerLive, MetricsLive);

const AppLogger = LoggerLive.pipe(Layer.provide(ConfigLive));
// Layer<Logger, never, never>

const LoggerAndConfig = LoggerLive.pipe(Layer.provideMerge(ConfigLive));
// Layer<Logger | Config, never, never>
```

Scala analog: `ZLayer >>>` is `provide`, `++` is `merge`, `>+>` is
`provideMerge`.

### 18.3 Memoization

Within a single `Effect.provide`, each layer is built **once** and its service
shared.

```ts
// Two independent provides → Random built TWICE
Effect.gen(function* () {
  const a = yield* Effect.provide(useRandom, RandomLive);
  const b = yield* Effect.provide(useRandom, RandomLive);
});

// Shared — Random built ONCE
Effect.all([useRandom, useRandom]).pipe(Effect.provide(RandomLive));
```

Opt out with `Layer.fresh(layer)`.

### 18.4 Providing layers to effects

```ts
Effect.provide(program, layer)                         // pipeable too
Effect.provideService(program, Random, { next: ... })  // single value
Effect.provide(program, [ConfigLive, LoggerLive, DbLive])  // array — merged L→R
```

### 18.5 Realistic wiring

```ts
class Config extends Effect.Service<Config>()("@app/Config", {
  sync: () => ({ dbUrl: process.env.DB_URL!, logLevel: "info" as const }),
}) {}

class Db extends Effect.Service<Db>()("@app/Db", {
  scoped: Effect.gen(function* () {
    const cfg = yield* Config;
    const conn = yield* Effect.acquireRelease(
      Effect.promise(() => connect(cfg.dbUrl)),
      (c) => Effect.promise(() => c.close()),
    );
    return { query: (sql: string) => Effect.promise(() => conn.query(sql)) };
  }),
  dependencies: [Config.Default], // auto-wires Config
}) {}

const main = Effect.gen(function* () {
  const db = yield* Db;
  return yield* db.query("SELECT 1");
});

Effect.runPromise(main.pipe(Effect.provide(Db.Default), Effect.scoped));
```

---

## 19. `Config`

Effect's ciris/ZIO-Config equivalent. Declarative, validated, composable.

### Primitives

```ts
Config.string("HOST");
Config.number("PORT");
Config.boolean("DEBUG");
Config.redacted("API_KEY"); // modern replacement for Config.secret
Config.integer("COUNT");
Config.date("SINCE");
Config.duration("TIMEOUT");
Config.logLevel("LOG_LEVEL");
Config.literal("dev", "prod")("ENV");
Config.array(Config.number(), "PORTS");
Config.hashMap(Config.string(), "TAGS");
```

### Combinators

```ts
// Product
const DbConfig = Config.all({
  host: Config.string("DB_HOST"),
  port: Config.number("DB_PORT"),
});

// Alternatives
Config.orElse(Config.number("PORT"), () => Config.number("HTTP_PORT"));

// Defaults
Config.withDefault(Config.string("LOG_LEVEL"), "info");

// Nested (prefixes keys)
Config.nested(DbConfig, "DB");

// Transform
Config.map(Config.string("NAME"), (s) => s.toUpperCase());
```

### `ConfigProvider`

```ts
const envProvider = ConfigProvider.fromEnv();
const mapProvider = ConfigProvider.fromMap(new Map([["HOST", "localhost"]]));

// Swap provider for part of a program:
program.pipe(Effect.withConfigProvider(mapProvider));

// Or as a Layer:
Layer.setConfigProvider(mapProvider);
```

Custom providers implement the `ConfigProvider` interface (one `load` method).
Useful for Consul, Vault, AWS Parameter Store, etc.

---

## 20. Logging

### Emitting logs

```ts
Effect.log("default is Info");
Effect.logTrace("very noisy");
Effect.logDebug("debug info");
Effect.logInfo("hello", { id: 123 }, someObject); // variadic
Effect.logWarning("uh oh");
Effect.logError("broken");
Effect.logFatal("catastrophic");
```

### Min level

```ts
program.pipe(Logger.withMinimumLogLevel(LogLevel.Debug));
const MinLevelLive = Logger.minimumLogLevel(LogLevel.Debug);
```

Levels: `All < Trace < Debug < Info < Warning < Error < Fatal < None`.

### Custom loggers

```ts
const jsonLogger = Logger.make(
  ({ logLevel, message, date, annotations, spans }) => {
    console.log(
      JSON.stringify({
        time: date.toISOString(),
        level: logLevel.label,
        message,
      }),
    );
  },
);

const AppLoggerLive = Logger.replace(Logger.defaultLogger, jsonLogger);
const Tee = Logger.add(jsonLogger); // adds alongside
```

Prebuilt layers: `Logger.pretty`, `Logger.json`, `Logger.logfmtLogger`,
`Logger.structuredLogger`.

### Annotations and spans

```ts
Effect.logInfo("step 1").pipe(
  Effect.annotateLogs("userId", "u_42"),
  Effect.annotateLogs({ requestId: "r_7", region: "eu-west-1" }),
);

// Spans produce timing info in log output
Effect.logInfo("done").pipe(
  Effect.withLogSpan("database-query"), // includes "database-query=12ms"
);
```

---

## 21. Metrics

```ts
const requestCount = Metric.counter("http_requests_total");
const connPoolSize = Metric.gauge("db_conn_pool_size");
const latency = Metric.histogram(
  "http_latency_ms",
  MetricBoundaries.exponential({ start: 1, factor: 2, count: 10 }),
);
const requestSize = Metric.summary({
  name: "request_size_bytes",
  maxAge: "1 minute",
  maxSize: 1000,
  error: 0.01,
  quantiles: [0.5, 0.95, 0.99],
});
const statusCodes = Metric.frequency("http_status_codes");
```

### Attaching to effects

```ts
// Track duration automatically
fetchUser("u_1").pipe(Metric.trackDuration(latency));

// Manual
yield * Metric.increment(requestCount);
yield * Metric.set(connPoolSize, 12);
yield * Metric.update(requestSize, 2048);

// Tags
requestCount.pipe(Metric.tagged("route", "/users"));
```

Export via `@effect/opentelemetry`'s `MetricExporter` layers (Prometheus /
OTLP). cats-effect has no first-class metrics; you'd use `prometheus4cats` or
`otel4s`.

---

## 22. Tracing

First-class, built-in distributed tracing.

```ts
const fetchUser = (id: string) =>
  Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan("user.id", id);
    yield* Effect.annotateCurrentSpan({ "http.method": "GET" });
    return { id, name: "Jane" };
  }).pipe(
    Effect.withSpan("fetchUser", { attributes: { component: "user-service" } }),
  );
```

`Effect.withSpan` automatically: starts at entry, ends at exit, records
duration, captures success/failure, attaches errors as span events, nests under
enclosing span.

### OpenTelemetry integration

```ts
import { NodeSdk } from "@effect/opentelemetry";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

const NodeSdkLive = NodeSdk.layer(() => ({
  resource: { serviceName: "my-service" },
  spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter()),
}));

Effect.runPromise(program.pipe(Effect.provide(NodeSdkLive)));
```

cats-effect analog: `otel4s` — `Tracer[F].span("x").use(_ => ...)`.

---

## 23. Testing

### `TestClock` — virtual time

```ts
const program = Effect.gen(function* () {
  const fiber = yield* Effect.sleep("1 hour").pipe(
    Effect.andThen(Effect.succeed("done")),
    Effect.fork,
  );
  yield* TestClock.adjust("1 hour"); // virtual time jump
  return yield* Fiber.join(fiber); // "done" immediately
});

Effect.runPromise(program.pipe(Effect.provide(TestContext.TestContext)));
```

APIs: `TestClock.adjust(duration)`, `TestClock.setTime(instant)`,
`TestClock.sleep(duration)`. ≈ cats-effect `TestControl.executeEmbed`.

### `TestRandom`

```ts
yield * TestRandom.feedInts(1, 2, 3);
const a = yield * Random.nextInt; // 1
```

`feedBooleans`, `feedDoubles`, `feedInts`, `feedChunks`.

### `@effect/vitest`

```ts
import { it, expect } from "@effect/vitest"

it.effect("sleeps with virtual time", () =>
  Effect.gen(function* () {
    const fiber = yield* Effect.fork(Effect.sleep("1 day").pipe(Effect.as(42)))
    yield* TestClock.adjust("1 day")
    const result = yield* Fiber.join(fiber)
    expect(result).toBe(42)
  })
)

it.live("uses real services", () => ...)
it.scoped("acquires and releases a resource", () => ...)
it.flakyTest("retries on failure", () => ...)
```

### Mocking via Layer

Mocks are just swapped layers — no mocking library needed.

```ts
const FakeUserRepo = Layer.succeed(UserRepo, {
  findById: (id) => Effect.succeed({ id, name: "Test User" }),
});

it.effect("fetchUser", () =>
  fetchUser("u_1").pipe(
    Effect.provide(FakeUserRepo),
    Effect.map((u) => expect(u.name).toBe("Test User")),
  ));
```

---

## 24. `Runtime` and `ManagedRuntime`

An Effect is a **description**; a `Runtime` executes it. Most users call
`Effect.runPromise` and never think about it. Custom `Runtime` matters when:

- Integrating with a framework (React, Express, Fastify) that calls back into
  Effect repeatedly — you want layers built **once**.
- You need a specific `FiberRefs`/executor configuration.

### `ManagedRuntime` — pre-build layers once

```ts
const AppLayer = Layer.mergeAll(ConfigLive, LoggerLive, DbLive);
const runtime = ManagedRuntime.make(AppLayer);

// Use many times — layers built once:
async function handler(req: Request) {
  return runtime.runPromise(handleRequest(req));
}

// On shutdown, release scoped resources:
await runtime.dispose();
```

The correct way to bridge Effect into a long-running host (HTTP server, Lambda,
React root). ≈ cats-effect `Dispatcher[F]`.

### Raw `Runtime`

```ts
const runtime = await Effect.runPromise(
  Layer.toRuntime(AppLayer).pipe(Effect.scoped),
);
Runtime.runPromise(runtime)(someEffect);
```

`Runtime` ≈ cats-effect `IORuntime`. `ManagedRuntime` is more like `Dispatcher`
— a long-lived bridge.

---

## 25. Clock & Random

Effect provides `Clock` and `Random` as built-in services that are **always in
context** (they don't appear in the `R` parameter).

```ts
// Clock
const now: number = yield * Clock.currentTimeMillis;
const nowNs: bigint = yield * Clock.currentTimeNanos;
yield * Clock.sleep(Duration.seconds(1));
Effect.sleep("500 millis"); // sugar

// Random
yield * Random.next; // [0, 1)
yield * Random.nextBoolean;
yield * Random.nextInt;
yield * Random.nextIntBetween(1, 100);
yield * Random.shuffle(collection);
yield * Random.choice(nonEmpty);
```

Under test, `TestClock` and `TestRandom` replace these. ≈ cats-effect `Clock[F]`
/ `cats.effect.std.Random[F]`.

---

## 26. `Schedule`

A `Schedule<Out, In, R>` is a description of a recurrence pattern. Schedules are
pure values — you _apply_ them with `Effect.retry`, `Effect.repeat`, or
`Effect.schedule`.

- cats-effect analog: `cats-retry`'s `RetryPolicy`. Effect's `Schedule` is
  strictly more general (can also describe `repeat`, carries an `Out` type).
- ZIO analog: `zio.Schedule[R, In, Out]` (direct port).

### Built-in schedules

```ts
Schedule.forever; // count each recurrence, never stop
Schedule.once; // one more time after initial
Schedule.recurs(n); // at most n recurrences
Schedule.spaced("200 millis"); // fixed gap AFTER each completion (drifts)
Schedule.fixed("1 second"); // fixed wall-clock interval
Schedule.exponential("100 millis"); // 100, 200, 400, 800, ...
Schedule.exponential("100 millis", 1.5); // custom factor
Schedule.fibonacci("10 millis"); // 10, 10, 20, 30, 50, 80, ...
Schedule.identity<A>(); // echo each input as output
Schedule.elapsed; // output = total time since start
Schedule.upTo("30 seconds"); // until elapsed > duration
```

### Combinators

```ts
Schedule.addDelay(schedule, (out) => Duration)       // extra delay per tick
Schedule.intersect(a, b)                             // both continue, longer delay
Schedule.union(a, b)                                 // either continues, shorter delay
Schedule.andThen(a, b)                               // run a, then switch to b
Schedule.jittered(schedule)                          // randomize delays (thundering-herd)
Schedule.whileInput(schedule, (in) => boolean)       // stop based on input
Schedule.whileOutput(schedule, (out) => boolean)     // stop based on output
Schedule.compose(a, b)                               // a's output → b's input
Schedule.tapInput(schedule, (in) => Effect)
Schedule.tapOutput(schedule, (out) => Effect)
```

### Applying

```ts
// Retry on failure; schedule's In = E
task.pipe(
  Effect.retry(
    Schedule.exponential("100 millis").pipe(
      Schedule.intersect(Schedule.recurs(5)),
      Schedule.jittered,
    ),
  ),
);

// Shorthands (no Schedule needed):
task.pipe(Effect.retry({ times: 3 }));
task.pipe(Effect.retry({ while: (e) => e.message === "transient" }));
task.pipe(Effect.retry({ until: (e) => e.message === "fatal" }));

// Fallback when exhausted:
task.pipe(
  Effect.retryOrElse(
    Schedule.recurs(3),
    (err, _) => Console.error(`giving up: ${err}`).pipe(Effect.as("fallback")),
  ),
);

// Repeat on success; schedule's In = A
Effect.log("poll").pipe(Effect.repeat(Schedule.spaced("1 second")));
poll.pipe(Effect.repeat({
  schedule: Schedule.spaced("500 millis"),
  until: (s) => s === "ready",
}));

// Schedule — no initial immediate execution, fires on each tick
Effect.log("tick").pipe(Effect.schedule(Schedule.fixed("1 minute")));
```

> Note: `Effect.repeat(e, Schedule.once)` runs `e` **twice** (initial + one
> repeat).

---

## 27. `Cron`

```ts
import { Cron, DateTime, Either, Schedule } from "effect";

// Safe parse → Either<CronParseError, Cron>
const maybe = Cron.parse("0 0 4 8-14 * *");

// Throws on invalid expression (with tz)
const cron = Cron.unsafeParse("0 0 4 8-14 * *", "UTC");

// Programmatic
Cron.make({
  seconds: [0],
  minutes: [0],
  hours: [4],
  days: [8, 9, 10, 11, 12, 13, 14],
  months: [],
  weekdays: [],
  tz: DateTime.zoneUnsafeMakeNamed("Europe/Copenhagen"),
});

Cron.match(cron, new Date());
Cron.next(cron, new Date());
const iter = Cron.sequence(cron, new Date()); // Iterator<Date>

// As Schedule
const every15m = Cron.unsafeParse("0 */15 * * * *", "UTC");
Effect.log("poll").pipe(Effect.schedule(Schedule.cron(every15m)));
```

≈ `fs2-cron` for cats-effect.

---

## 28. `Stream`

`Stream<A, E, R>` ≈ `fs2.Stream[F, A]` where `F` is fixed to Effect. Built on
`Channel` — a more general primitive (≈ fs2 `Pull`).

### fs2 mapping

| fs2                               | Effect                                |
| --------------------------------- | ------------------------------------- |
| `Stream.emits`                    | `Stream.make`, `Stream.fromIterable`  |
| `Stream.eval`                     | `Stream.fromEffect`                   |
| `Stream.repeatEval`               | `Stream.repeatEffect`                 |
| `.map`/`.evalMap`                 | `Stream.map` / `Stream.mapEffect`     |
| `.filter` / `.take` / `.drop`     | `Stream.filter/take/drop`             |
| `.takeWhile`                      | `Stream.takeWhile`                    |
| `.chunks` / `.chunkN(n)`          | `Stream.chunks` / `Stream.grouped(n)` |
| `.flatMap`                        | `Stream.flatMap`                      |
| `.merge` / `.zip` / `.interleave` | `Stream.merge/zip/interleave`         |
| `.groupAdjacentBy`                | `Stream.groupByKey`                   |
| `.metered` / `.throttle`          | `Stream.throttle`                     |
| `.debounce`                       | `Stream.debounce`                     |
| `.compile.drain`                  | `Stream.runDrain`                     |
| `.compile.toList/toVector`        | `Stream.runCollect`                   |
| `.compile.fold`                   | `Stream.runFold`                      |
| `fs2.Pull`                        | `Channel`                             |

### Construction

```ts
Stream.make(1, 2, 3); // variadic
Stream.fromIterable([1, 2, 3]);
Stream.fromEffect(Random.nextInt); // one-shot
Stream.fromQueue(q, { maxChunkSize: 64 });
Stream.fromPubSub(hub);
Stream.fromAsyncIterable(iter, (e) => new Error(String(e)));
Stream.iterate(1, (n) => n + 1); // infinite
Stream.range(1, 5); // inclusive
Stream.repeatEffect(Random.nextInt); // infinite
Stream.repeatEffectWithSchedule(effect, schedule);
```

### Transformation

```ts
Stream.range(1, 3).pipe(Stream.map((n) => n * 2)); // [2,4,6]

// Parallel mapEffect
Stream.fromIterable(urls).pipe(
  Stream.mapEffect((u) => HttpClient.get(u), { concurrency: 8 }),
);

// { unordered: true } to skip ordering

Stream.filter((n) => n % 2 === 0);
Stream.take(5);
Stream.drop(3);
Stream.takeWhile((n) => n < 5);
Stream.chunks; // surfaces Chunk<A> boundaries
Stream.grouped(10); // repartition
Stream.flatMap((page) => fetchPageStream(page), { concurrency: 3 });
Stream.merge(clicks, keypresses);
Stream.zip(a, b); // pairwise
Stream.interleave(a, b); // strict alternation

// Group by key
Stream.groupByKey((s) => s[0]).pipe(
  GroupBy.evaluate((key, sub) => sub.pipe(Stream.map((w) => `${key}:${w}`))),
);
```

### Time-based

```ts
Stream.throttle(s, {
  cost: () => 1,
  duration: "1 second",
  units: 10,
  strategy: "shape", // or "enforce" (drop) / "throttle"
});
Stream.debounce("300 millis");
Stream.schedule(Schedule.spaced("500 millis")); // delay each emission
```

### Running / Sinks

```ts
Stream.runCollect(s); // Chunk<A> — unbounded = memory footgun
Stream.runDrain(s); // effects only (the usual "just run it")
Stream.runForEach(s, (n) => Console.log(n));
Stream.runFold(s, 0, (acc, n) => acc + n);

// General: apply a Sink
Stream.run(s, Sink.sum);
Stream.run(s, Sink.collectAll<number>());
Stream.run(s, Sink.head<number>()); // Option<A>
Stream.run(s, Sink.last<number>());
Stream.run(s, Sink.fold(0, (n) => n <= 100, (n, x: number) => n + x)); // early-terminating
Stream.run(s, Sink.forEach((n) => Console.log(n)));
```

---

## 29. `Schema`

`Schema<Type, Encoded = Type, R = never>` — bidirectional codec. Think **io-ts
`Type<A, O, I>` with Decoder+Encoder in one**, plus first-class async
validators, services, and derivations.

### io-ts / Zod mapping

| Purpose                   | io-ts                         | Zod                    | Effect Schema                           |
| ------------------------- | ----------------------------- | ---------------------- | --------------------------------------- |
| String / Number / Boolean | `t.string` / `t.number` / ... | `z.string()` / ...     | `Schema.String` / `Schema.Number` / ... |
| Literal                   | `t.literal("a")`              | `z.literal("a")`       | `Schema.Literal("a")`                   |
| Object                    | `t.type({...})`               | `z.object({...})`      | `Schema.Struct({...})`                  |
| Array                     | `t.array(T)`                  | `z.array(T)`           | `Schema.Array(T)`                       |
| Tuple                     | `t.tuple([A, B])`             | `z.tuple([A, B])`      | `Schema.Tuple(A, B)`                    |
| Union                     | `t.union([A, B])`             | `z.union([A, B])`      | `Schema.Union(A, B)`                    |
| Refinement                | `t.refinement`                | `.refine`              | `Schema.filter`                         |
| Transform (bidir)         | custom `Type`                 | `.transform` (one-way) | `Schema.transform` / `transformOrFail`  |
| Decode → Either           | `T.decode(u)`                 | `T.safeParse(u)`       | `Schema.decodeUnknownEither(T)(u)`      |
| Decode → throw            | `ThrowReporter`               | `T.parse(u)`           | `Schema.decodeUnknownSync(T)(u)`        |
| Brand                     | `t.brand`                     | `.brand<"X">()`        | `Schema.brand("X")`                     |
| JSON Schema derivation    | `io-ts-to-json-schema`        | `zod-to-json-schema`   | `JSONSchema.make`                       |

### 29.1 Primitives

```ts
Schema.String;
Schema.Number; // use Schema.finite to reject NaN/Infinity
Schema.Boolean;
Schema.Literal("open", "closed", "archived");
Schema.Date; // expects Date instance; use DateFromString for ISO
Schema.Unknown; // safe passthrough
Schema.Any;
Schema.Null / Schema.Undefined;
Schema.BigInt;
```

### 29.2 Combinators

```ts
Schema.Array(Schema.String); // readonly string[]
Schema.Tuple(Schema.Number, Schema.Number); // [number, number]
Schema.Tuple([Schema.String], Schema.Number); // [string, ...number[]]

Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  email: Schema.optional(Schema.String),
  pronouns: Schema.optional(Schema.String, { exact: true }),
  role: Schema.optional(Schema.Literal("user", "admin"), {
    default: () => "user" as const,
  }),
});

Schema.Record({ key: Schema.String, value: Schema.String });
Schema.Union(Schema.String, Schema.Number);
Schema.NullOr(S) / Schema.UndefinedOr(S) / Schema.NullishOr(S);
Schema.partial(User); // all props optional
Schema.extend(Base, Timestamped); // merge structs
User.pipe(Schema.pick("id", "name"));
User.pipe(Schema.omit("password"));
```

### 29.3 Refinements

```ts
Schema.Number.pipe(
  Schema.filter((n) => n % 2 === 0 || "must be even"), // string = error msg
);
Schema.Number.pipe(Schema.int(), Schema.between(0, 150));
Schema.String.pipe(Schema.minLength(3), Schema.maxLength(30));
Schema.String.pipe(Schema.pattern(/^[a-z][a-z0-9-]*$/));
Schema.Number.pipe(Schema.positive(), Schema.nonNegative());
```

### 29.4 Transformations (bidirectional)

```ts
// Total — both directions can't fail
const TrimmedString = Schema.transform(
  Schema.String,
  Schema.String,
  { decode: (s) => s.trim(), encode: (s) => s },
);

// Partial — returns ParseResult.succeed / .fail (can be effectful)
const Int = Schema.transformOrFail(
  Schema.String,
  Schema.Number,
  {
    decode: (s, _, ast) => {
      const n = Number(s);
      return Number.isInteger(n)
        ? ParseResult.succeed(n)
        : ParseResult.fail(new ParseResult.Type(ast, s, "not an integer"));
    },
    encode: (n) => ParseResult.succeed(String(n)),
  },
);

// Built-ins
Schema.NumberFromString; // "42" <-> 42
Schema.DateFromString; // ISO <-> Date
Schema.Trim / Schema.Lowercase / Schema.Uppercase;
Schema.parseJson; // string <-> parsed JSON
Schema.StringFromBase64;
Schema.BigIntFromString;
Schema.URL / Schema.UUID;
```

### 29.5 Brands

```ts
const UserId = Schema.String.pipe(Schema.brand("UserId"));
type UserId = Schema.Schema.Type<typeof UserId>; // string & Brand<"UserId">
const id = UserId.make("u_abc123"); // validated + branded

// Reuse an existing effect/Brand
const OrderIdBrand = Brand.nominal<OrderId>();
const OrderIdSchema = Schema.String.pipe(Schema.fromBrand(OrderIdBrand));
```

### 29.6 Decoding/encoding — 4 flavors per direction

```ts
// unknown → Type
Schema.decodeUnknown(S); // (u: unknown) => Effect<A, ParseError, R>
Schema.decodeUnknownSync(S); // throws on fail
Schema.decodeUnknownPromise(S);
Schema.decodeUnknownEither(S); // Either<A, ParseError>

// Encoded → Type (input already typed)
Schema.decode(S) / decodeSync(S);

// Type → Encoded
Schema.encode(S) / encodeSync(S) / encodeEither(S);
```

Options:
`{ errors: "all" | "first", onExcessProperty: "ignore" | "error" | "preserve", propertyOrder }`.

### 29.7 Class-based schemas

One declaration → runtime class + schema + type + validating constructor +
`Equal`/`Hash` + pattern-matchable `_tag`.

```ts
class Person extends Schema.Class<Person>("Person")({
  id: Schema.Number,
  name: Schema.NonEmptyString,
  email: Schema.optional(Schema.String),
}) {
  greet() {
    return `Hi, ${this.name}`;
  }
}

const p = new Person({ id: 1, name: "Ada" }); // validates
Schema.decodeUnknownSync(Person)(json); // also constructs instance
```

```ts
// Tagged — auto _tag, perfect for discriminated unions
class AddTodo extends Schema.TaggedClass<AddTodo>("AddTodo")(
  "AddTodo",
  { text: Schema.String },
) {}
class RemoveTodo extends Schema.TaggedClass<RemoveTodo>("RemoveTodo")(
  "RemoveTodo",
  { id: Schema.Number },
) {}
const Action = Schema.Union(AddTodo, RemoveTodo);

// Error — TaggedClass that extends Error, yieldable in Effect.gen
class NotFound extends Schema.TaggedError<NotFound>("NotFound")(
  "NotFound",
  { resource: Schema.String, id: Schema.String },
) {}

const findUser = (id: string) =>
  Effect.gen(function* () {
    const row = yield* db.get(id);
    if (!row) return yield* new NotFound({ resource: "user", id });
    return row;
  });

findUser("42").pipe(
  Effect.catchTag(
    "NotFound",
    (e) => Effect.logWarning(`${e.resource}:${e.id} missing`),
  ),
);
```

### 29.8 Derivations

The headline feature io-ts/Zod only have partially.

```ts
// Fast-check arbitraries
import { Arbitrary, FastCheck } from "effect";
const arb = Arbitrary.make(Person);
FastCheck.sample(arb, 3);

// JSON Schema
import { JSONSchema } from "effect";
const doc = JSONSchema.make(User);
JSONSchema.make(User, { target: "jsonSchema2020-12" });
JSONSchema.make(User, { target: "openApi3.1" });

// Equivalence
const eqPoint = Schema.equivalence(Point);
eqPoint({ x: 1, y: 2 }, { x: 1, y: 2 }); // true

// Custom via annotations
const Name = Schema.NonEmptyString.annotations({
  arbitrary: () => (fc) => fc.constantFrom("Alice", "Bob"),
  equivalence: () => (a, b) => a.toLowerCase() === b.toLowerCase(),
});
```

---

## 30. `Option`

Same ADT as fp-ts `Option` / Scala `Option`.

> Gotcha: `Option.none` is a **function** — always call `Option.none()`.

### Constructors

```ts
Option.some(1);
Option.none();
Option.fromNullable(x); // undefined/null → None
Option.fromIterable([1, 2, 3]); // first element, or None
Option.liftPredicate((n: number) => n > 0); // predicate → smart ctor
Option.liftThrowable(JSON.parse); // throws → None
```

### Destructors

```ts
pipe(
  Option.some(42),
  Option.match({
    onNone: () => "empty",
    onSome: (n) => `value: ${n}`,
  }),
);

Option.getOrElse(opt, () => 0);
Option.getOrNull(opt);
Option.getOrUndefined(opt);
Option.getOrThrow(opt); // or getOrThrowWith for custom
```

### Combinators

```ts
pipe(Option.some(1), Option.map((n) => n + 1));
pipe(Option.some([1, 2]), Option.flatMap(head)); // ≈ chain
pipe(Option.some(3), Option.filter((n) => n > 5)); // None
Option.zip(Option.some("a"), Option.some(1)); // Some(["a", 1])
Option.zipWith(Option.some(2), Option.some(3), (a, b) => a + b);
pipe(Option.none(), Option.orElse(() => Option.some(42)));
Option.all([Option.some(1), Option.some(2)]); // Some([1, 2])
Option.all({ a: Option.some(1), b: Option.some("x") }); // Some({...})
```

### Guards

```ts
if (Option.isSome(x)) { x.value /* number */ }
if (Option.isNone(x)) { ... }
```

---

## 31. `Either`

> **Parameter order in Effect is `Either<Right, Left>` / `Either<A, E>`** —
> right-first! Matches `Effect<A, E, R>`; **opposite of fp-ts** `Either<E, A>`.

### Constructors

```ts
Either.right(42);
Either.left("boom");
Either.fromNullable(null, () => "was null");
Either.try({
  try: () => JSON.parse("..."),
  catch: (e) => new Error(String(e)),
});
Either.liftPredicate((n: number) => n > 0, (n) => `${n} is not positive`);
```

### Destructors

```ts
pipe(
  Either.right(1),
  Either.match({
    onLeft: (e) => `err: ${e}`,
    onRight: (a) => `ok: ${a}`,
  }),
);

Either.getOrElse(eitherVal, (e) => e.length);
Either.getOrThrow(eitherVal);
Either.merge(eitherVal); // A | E
```

### Combinators

```ts
Either.map(e, (n) => n + 1);
Either.mapLeft(e, (err) => new Error(err));
Either.mapBoth(e, { onLeft: (e) => e.length, onRight: (n) => n * 2 });
Either.flatMap(e, (n) => n > 0 ? Either.right(n) : Either.left("neg"));
Either.all([Either.right(1), Either.right(2)]); // Right([1, 2])
Either.all({ a: Either.right(1), b: Either.left("x") }); // Left("x")
Either.zipWith(Either.right("a"), Either.right(1), (s, n) => s + n);
```

### Interop with Effect

`Either<A, E>` **is** an `Effect<A, E, never>` — yield it in `Effect.gen`, pass
it to `Effect.all`, etc. No conversion needed.

```ts
Effect.gen(function* () {
  const x = yield* Either.right(1); // 1
  const y = yield* Either.left("boom"); // fails the Effect with "boom"
  return x + y;
});
```

---

## 32. Immutable collections

### `Chunk<A>` — persistent indexed sequence

≈ fs2 `Chunk` / Scala `Vector`. Optimized for repeated append/prepend/concat.
For one-shot ops, prefer plain `ReadonlyArray`.

```ts
Chunk.empty<number>();
Chunk.of(1); // singleton (not variadic!)
Chunk.make(1, 2, 3); // variadic
Chunk.fromIterable([1, 2, 3]); // clones
Chunk.unsafeFromArray([1, 2, 3]); // no-clone — caller promises immutability

pipe(Chunk.make(1, 2), Chunk.append(3));
pipe(Chunk.make(2, 3), Chunk.prepend(1));
pipe(Chunk.make(1, 2), Chunk.appendAll(Chunk.make(3, 4))); // no Chunk.concat!
pipe(Chunk.make(1, 2, 3, 4), Chunk.take(2));
pipe(Chunk.make(1, 2, 3), Chunk.map((n) => n * 2));
pipe(Chunk.make(1, 2, 3), Chunk.reduce(0, (acc, n) => acc + n));
Chunk.toReadonlyArray(Chunk.make(1, 2, 3));
```

### `HashMap<K, V>` — persistent HAMT

For structural key equality, wrap keys in `Data.struct`/`Data.tuple` or use
primitives. Plain object keys use reference equality.

```ts
HashMap.empty<string, number>();
HashMap.make(["a", 1], ["b", 2]);
HashMap.fromIterable([["a", 1], ["b", 2]]);

HashMap.set(m, "b", 2);
HashMap.get(m, "a"); // Option<V> — NOT V | undefined
HashMap.has(m, "a");
HashMap.remove(m, "a");
HashMap.modify(m, "a", (n) => n + 10); // no-op if missing
HashMap.union(m1, m2);
HashMap.map(m, (v, k) => v * 2);
HashMap.filter(m, (v) => v > 0);
HashMap.reduce(m, 0, (acc, v) => acc + v);
HashMap.size(m);
Array.from(HashMap.keys(m));
```

### `HashSet<A>`

```ts
HashSet.empty<number>();
HashSet.make(1, 2, 3);
HashSet.fromIterable([1, 2, 2, 3]); // dedupes

HashSet.add(s, 4);
HashSet.remove(s, 1);
HashSet.has(s, 2);
HashSet.union(s1, s2);
HashSet.intersection(s1, s2);
HashSet.difference(s1, s2);
HashSet.filter(s, (n) => n > 0);
HashSet.map(s, (n) => n * 2);
```

### `SortedMap` / `SortedSet`

Red-black tree backed. For ordered iteration / range queries.

```ts
const m = SortedMap.empty<string, number>(Order.string);
SortedMap.set(m, "b", 2);

const s = SortedSet.empty(Order.number);
SortedSet.add(s, 3);
SortedSet.add(s, 1);
```

### `List<A>` (cons list)

Linked list, O(1) prepend. Prefer `Chunk`/`ReadonlyArray` for general use.

```ts
const xs = List.make(1, 2, 3);
List.prepend(xs, 0);
List.head(xs); // Option<A>
List.tail(xs); // Option<List<A>>
```

### Mutable siblings

`MutableHashMap`, `MutableHashSet`, `MutableList` — local-scope performance
optimizations. Don't play with `Equal`; compare by reference.

```ts
const m = MutableHashMap.empty<string, number>();
MutableHashMap.set(m, "a", 1); // mutates in place
```

---

## 33. `Data` module

Plain JS objects compare by reference. `Data.*` attaches `Equal`/`Hash` symbols
so they compare structurally — required for `HashMap`/`HashSet` keys,
memoization, test assertions.

### Basic constructors

```ts
Equal.equals(
  Data.struct({ name: "Alice", age: 30 }),
  Data.struct({ name: "Alice", age: 30 }),
); // true — but SHALLOW: nested objects need their own Data.struct

Data.tuple(1, "x");
Data.array([1, 2, 3]);

// Smart constructor for an interface
const Person = Data.case<{ name: string; age: number }>();
const p1 = Person({ name: "Alice", age: 30 });

// Class version (for methods/getters)
class Point extends Data.Class<{ x: number; y: number }> {
  get magnitude() {
    return Math.hypot(this.x, this.y);
  }
}
```

### `Data.TaggedClass` — one branch of an ADT

```ts
class NetworkError extends Data.TaggedClass("NetworkError")<{
  readonly url: string;
}> {}
const e = new NetworkError({ url: "/x" });
e._tag; // "NetworkError"
```

The standard way to declare **typed errors** for Effect.

### `Data.TaggedEnum` — Scala sealed trait, Effect-style

The idiomatic way to model sum types / ADTs.

```ts
type RemoteData = Data.TaggedEnum<{
  Loading: {};
  Success: { readonly data: string };
  Failure: { readonly reason: string };
}>;

const { $is, $match, Loading, Success, Failure } = Data.taggedEnum<
  RemoteData
>();

const r: RemoteData = Success({ data: "ok" });

// Exhaustive match
const label = $match({
  Loading: () => "…",
  Success: ({ data }) => `got ${data}`,
  Failure: ({ reason }) => `bad: ${reason}`,
})(r);

// Type-guard
$is("Success")(r); // narrows to Success branch
```

Generic (polymorphic) ADTs:

```ts
type Maybe<A> = Data.TaggedEnum<{ Nothing: {}; Just: { readonly value: A } }>;
interface MaybeDef extends Data.TaggedEnum.WithGenerics<1> {
  readonly taggedEnum: Maybe<this["A"]>;
}
const { Nothing, Just, $match } = Data.taggedEnum<MaybeDef>();
```

### `Equal` / `Hash`

```ts
Equal.equals(1, 1); // true
Equal.equals([1, 2], [1, 2]); // false — plain arrays
Equal.equals(Data.array([1, 2]), Data.array([1, 2])); // true
Hash.hash(Data.struct({ a: 1 })); // consistent with Equal
```

Any class can implement `Equal.Equal` + `Hash.Hash` directly via the symbol
methods.

---

## 34. `Match` module

Type-safe pattern matching with exhaustiveness checking. ≈ Scala `match` /
ts-pattern.

### Type matcher (reusable)

```ts
const describe = Match.type<string | number>().pipe(
  Match.when(Match.number, (n) => `num ${n}`),
  Match.when(Match.string, (s) => `str ${s}`),
  Match.exhaustive,
);
describe(1); // "num 1"
describe("hi"); // "str hi"
```

### Value matcher (one-shot)

```ts
Match.value(user).pipe(
  Match.when({ name: "John" }, (u) => `John is ${u.age}`),
  Match.orElse(() => "someone else"),
);
```

### Patterns

- Literals: `"a"`, `1`, `true`
- Type guards: `Match.string`, `Match.number`, `Match.boolean`, `Match.any`,
  `Match.defined`, ...
- Partial objects with nested patterns or predicate fns
- Predicates: `(a) => a is B` / `(a) => boolean`

```ts
Match.type<{ age: number }>().pipe(
  Match.when({ age: (n) => n >= 18 }, () => "adult"),
  Match.when({ age: 17 }, () => "almost there"),
  Match.orElse(() => "kid"),
);
```

### `Match.tag` / `Match.tags` — for discriminated unions

```ts
const run = Match.type<Event>().pipe(
  Match.tag("fetch", "success", () => "OK"),
  Match.tag("error", (e) => `Err ${e.error.message}`),
  Match.exhaustive,
);
```

### `Match.discriminator` — custom discriminator field

```ts
Match.type<Shape>().pipe(
  Match.discriminator("kind")("circle", (c) => Math.PI * c.r ** 2),
  Match.discriminator("kind")("square", (s) => s.side ** 2),
  Match.exhaustive,
);
```

### `Match.not` / `Match.withReturnType` / `Match.orElse`

```ts
Match.type<string | number>().pipe(
  Match.not("skip", () => "handled"),
  Match.orElse(() => "skipped"),
);

Match.type<string | number>().pipe(
  Match.withReturnType<string>(), // pin return type up front
  Match.when(Match.number, (n) => n.toString()),
  Match.when(Match.string, (s) => s),
  Match.exhaustive,
);
```

---

## 35. Numeric / string / predicate utilities

Small "prelude" modules: value-level functions + typeclass instances.

```ts
import {
  Boolean as Bool,
  Equivalence,
  Number as Num,
  Order,
  Predicate as P,
  String as Str,
} from "effect";

// Number
Num.sum(2, 3);
Num.multiply(2, 3);
Num.sign(-5);
Num.clamp(15, { minimum: 0, maximum: 10 }); // 10
Num.Order;
Num.Equivalence;

// String
Str.toUpperCase("hi");
Str.isEmpty("");
Str.split(",")("a,b,c");
Str.replace("foo", "bar")("foobar");
Str.Order; // case-sensitive lexicographic

// Boolean
Bool.and(true, false);
Bool.not(true);
Bool.match(true, { onFalse: () => "no", onTrue: () => "yes" });

// Predicate / Refinement
const isPositive = (n: number) => n > 0;
const isEven = (n: number) => n % 2 === 0;
P.and(isPositive, isEven)(4);
P.or(isPositive, isEven)(-4);
P.not(isPositive)(-1);
P.isString("x");
P.isRecord({ a: 1 });
P.isNullable(null);

// Order — cats Order
Order.number(3, 5); // -1
const byLen = Order.mapInput(Order.number, (s: string) => s.length);
const byLower = Order.mapInput(Order.string, (s: string) => s.toLowerCase());
const combined = Order.combine(byLen, byLower);
Order.reverse(Order.number); // descending

// Equivalence — cats Eq (weaker than Equal; no Hash requirement)
const eqCI = Equivalence.mapInput(
  Equivalence.string,
  (s: string) => s.toLowerCase(),
);
eqCI("Hi", "hi"); // true
const eqPerson = Equivalence.struct({
  name: Equivalence.string,
  age: Equivalence.number,
});
```

---

## 36. `pipe`, `flow`, `Function.dual`

```ts
import { flow, identity, pipe } from "effect";
import * as F from "effect/Function";

pipe(5, (n) => n + 1, (n) => n * 2); // 12

const greet = flow(
  (name: string) => name.trim(),
  (s) => s.toUpperCase(),
  (s) => `Hello, ${s}!`,
);

F.identity(5);
F.constant(42)();
F.constTrue();
F.constFalse();
F.constVoid();
F.tupled((a: number, b: number) => a + b)([1, 2]); // 3
```

### `Function.dual` — the ubiquitous Effect pattern

**Every combinator in Effect is dual** — works both data-first
(`Effect.map(effect, f)`) and data-last (`pipe(effect, Effect.map(f))`). `dual`
is the helper that implements it.

```ts
import { dual, pipe } from "effect/Function";

// Arity form: "my function takes 2 args in data-first form"
const sum: {
  (self: number, that: number): number; // data-first
  (that: number): (self: number) => number; // data-last
} = dual(2, (self: number, that: number) => self + that);

sum(2, 3); // 5  data-first
pipe(2, sum(3)); // 5  data-last
```

Predicate form (when arg count can't disambiguate):

```ts
const replace = dual<
  (regex: RegExp, rep: string) => (self: string) => string,
  (self: string, regex: RegExp, rep: string) => string
>(
  (args) => typeof args[0] === "string",
  (self, regex, rep) => self.replace(regex, rep),
);
```

No fp-ts automatic equivalent (fp-ts maintains separate `*_` data-first vs
default data-last functions).

---

## 37. `Duration`

```ts
Duration.millis(100);
Duration.seconds(2);
Duration.minutes(5);
Duration.hours(1);
Duration.days(1);
Duration.weeks(1);
Duration.infinity;
Duration.zero;

// Parse
Duration.decode(1000); // 1s  (number = millis)
Duration.decode("5 minutes");
Duration.decode("100 millis");
Duration.decode(1_000_000n); // 1ms (bigint = nanos)

// Arithmetic
Duration.sum(Duration.seconds(30), Duration.minutes(1));
Duration.times(Duration.seconds(30), 2);
Duration.subtract(Duration.minutes(5), Duration.seconds(30));

// Comparison
Duration.lessThan(d1, d2);
Duration.greaterThanOrEqualTo(d1, d2);
Duration.equals(Duration.seconds(1), Duration.millis(1000)); // true

// Extract / format
Duration.toMillis(Duration.seconds(30)); // 30000
Duration.toNanos(Duration.millis(1)); // Option.some(1_000_000n)
Duration.unsafeToNanos(Duration.seconds(1)); // 1_000_000_000n (throws on infinity)
Duration.format(Duration.millis(1001)); // "1s 1ms"
```

Used by `Effect.timeout`, `Effect.sleep`, `Schedule.spaced`, etc. ≈
`scala.concurrent.duration.FiniteDuration`.

---

## 38. `Brand`

Solves TypeScript's structural typing for domain primitives.

### Nominal (zero-cost)

```ts
type UserId = number & Brand.Brand<"UserId">;
const UserId = Brand.nominal<UserId>();

const u: UserId = UserId(123);
// const bad: UserId = 123    // type error
```

### Refined (runtime-validated)

```ts
type Int = number & Brand.Brand<"Int">;
const Int = Brand.refined<Int>(
  (n) => Number.isInteger(n),
  (n) => Brand.error(`Expected ${n} to be an integer`),
);

Int(3); // 3 typed as Int
// Int(3.14)       // throws BrandErrors
Int.either(3.14); // Either.left(BrandErrors)
Int.option(3.14); // None
Int.is(3); // type guard
```

### Composing refinements

```ts
type Positive = number & Brand.Brand<"Positive">;
const Positive = Brand.refined<Positive>(
  (n) => n > 0,
  (n) => Brand.error(`Expected ${n} to be positive`),
);

type PositiveInt = number & Brand.Brand<"Int"> & Brand.Brand<"Positive">;
const PositiveInt = Brand.all(Int, Positive);
```

≈ Scala opaque types / refined / io-ts branded types.

---

## 39. Master cats-effect / fp-ts ↔ Effect table

### Core + errors

| cats-effect / fp-ts                            | Effect-TS                                         |
| ---------------------------------------------- | ------------------------------------------------- |
| `IO[A]`                                        | `Effect<A>` (`Effect<A, never, never>`)           |
| `EitherT[IO, E, A]` / fp-ts `TaskEither`       | `Effect<A, E>` (`Effect<A, E, never>`)            |
| `Kleisli[IO, R, A]` / fp-ts `ReaderTaskEither` | `Effect<A, E, R>`                                 |
| `IO.pure` / `TE.right`                         | `Effect.succeed`                                  |
| `IO.delay` (total)                             | `Effect.sync`                                     |
| `IO.delay` (throwing) / `TE.tryCatch`          | `Effect.try`                                      |
| `IO.fromFuture` / `TE.tryCatch` for Promise    | `Effect.tryPromise`                               |
| `IO.async`                                     | `Effect.async`                                    |
| `IO.defer`                                     | `Effect.suspend`                                  |
| `IO.unit`                                      | `Effect.void`                                     |
| `IO.never`                                     | `Effect.never`                                    |
| `IO.canceled`                                  | `Effect.interrupt`                                |
| — (no clean analog)                            | `Effect.die` (ZIO `ZIO.die`)                      |
| `for { ... } yield`                            | `Effect.gen(function* () { ... })`                |
| `io.map`, `io.flatMap`                         | `Effect.map`, `Effect.flatMap`                    |
| `io.flatTap`                                   | `Effect.tap`                                      |
| `io.onError`                                   | `Effect.tapError`                                 |
| `io.handleErrorWith`                           | `Effect.catchAll`                                 |
| — (`attempt` sees Throwable)                   | `Effect.catchAllCause` (sees defects + interrupt) |
| —                                              | `Effect.catchTag`, `Effect.catchTags`             |
| `io.adaptError` / `TE.mapLeft`                 | `Effect.mapError`                                 |
| `io.orElse(other)` / `TE.alt`                  | `Effect.orElse`                                   |
| `io.attempt`                                   | `Effect.either`                                   |
| — (no direct)                                  | `Effect.exit` (Outcome-with-Cause version)        |
| `io.attempt.map(_.toOption)`                   | `Effect.option`                                   |
| `io.unsafeRunSync()` / `unsafeToFuture`        | `Effect.runSync` / `Effect.runPromise`            |
| `SyncIO.attempt.unsafeRunSync`                 | `Effect.runSyncExit`                              |
| `Outcome[F, E, A]`                             | `Exit<A, E>` + `Cause<E>`                         |
| —                                              | `Cause` tree (ZIO `Cause`)                        |

### Concurrency

| cats-effect                                      | Effect                                                  |
| ------------------------------------------------ | ------------------------------------------------------- |
| `io.start`                                       | `Effect.forkDaemon` (cats) / `Effect.fork` (structured) |
| `Supervisor.supervise(io)`                       | `Effect.forkScoped`                                     |
| `fiber.joinWithNever`                            | `Fiber.join`                                            |
| `fiber.join` (Outcome)                           | `Fiber.await` (Exit)                                    |
| `fiber.cancel`                                   | `Fiber.interrupt`                                       |
| `IO.race(a, b): IO[Either[A, B]]`                | `Effect.race(a, b): Effect<A\|B>`                       |
| `IO.racePair`                                    | `Effect.raceWith`                                       |
| `IO.uncancelable(poll => ...)`                   | `Effect.uninterruptibleMask(restore => ...)`            |
| `io.onCancel(fin)`                               | `Effect.onInterrupt(fin)`                               |
| `io.guarantee(fin)` / `guaranteeCase`            | `Effect.ensuring(fin)` / `Effect.onExit`                |
| `io.timeout(d)`                                  | `Effect.timeout(d)`                                     |
| `IO.sleep(d)` / `io.delayBy(d)`                  | `Effect.sleep(d)` / `Effect.delay(d)(io)`               |
| `io.timed`                                       | `Effect.timed(io)`                                      |
| `list.parTraverseN(n)(f)`                        | `Effect.forEach(list, f, { concurrency: n })`           |
| `list.parSequenceN(n)`                           | `Effect.all(effects, { concurrency: n })`               |
| `(a, b).parMapN(f)`                              | `Effect.zipWith(a, b, f, { concurrent: true })`         |
| `Deferred[IO, A]`                                | `Deferred<A, E>`                                        |
| `Ref[IO, A]`                                     | `Ref<A>`                                                |
| `AtomicCell[IO, A]` / `Mutex + Ref`              | `SynchronizedRef<A>`                                    |
| fs2 `SignallingRef[IO, A]`                       | `SubscriptionRef<A>` (`.changes: Stream<A>`)            |
| `Semaphore[IO](n)`                               | `Effect.makeSemaphore(n)` (`.withPermits`)              |
| `Queue[IO, A]` (bounded/dropping/circularBuffer) | `Queue.bounded/unbounded/dropping/sliding`              |
| fs2 `Topic[IO, A]`                               | `PubSub.bounded/unbounded/dropping/sliding`             |
| `Resource[IO, A]` / `Resource.make`              | `Effect.acquireRelease` (+ `Scope` in `R`)              |
| `resource.use(f)`                                | `Effect.scoped(effect)`                                 |
| `IO.bracket(acq)(use)(rel)`                      | `Effect.acquireUseRelease(acq, use, rel)`               |
| `cats-stm` / ZIO STM                             | `STM`, `TRef`, `TQueue`, `TPubSub`, `TSemaphore`        |
| `STM[IO, A].commit`                              | `STM.commit(stm)` / `STM.commit(stm)`                   |
| `IOLocal[A]`                                     | `FiberRef<A>` (`.locally`, `.get`, `.set`)              |

### DI / observability / runtime

| Scala / cats-effect ecosystem          | Effect                                             |
| -------------------------------------- | -------------------------------------------------- |
| Tagless final / `Kleisli` + `Reader`   | `Context.Tag` + `R` channel                        |
| ZIO `ZLayer` / cats-effect `Resource`  | `Layer<ROut, E, RIn>`                              |
| `Layer.succeed` / ZLayer `succeed`     | `Layer.succeed`                                    |
| `Resource.eval` / `ZLayer.fromZIO`     | `Layer.effect`                                     |
| `Resource.make` / `ZLayer.scoped`      | `Layer.scoped`                                     |
| ZLayer `>>>` / `++` / `>+>`            | `Layer.provide` / `merge` / `provideMerge`         |
| ciris `ConfigValue[F, A]` / ZIO Config | `Config<A>`                                        |
| log4cats `LoggerFactory[F]`            | `Logger` service + `Effect.log*`                   |
| `prometheus4cats` / `otel4s Metrics`   | `Metric.counter/gauge/histogram/summary/frequency` |
| `otel4s Tracer[F].span("x").use(...)`  | `Effect.withSpan("x")`                             |
| cats-effect `TestControl.executeEmbed` | `TestClock.adjust` + `TestContext`                 |
| `IORuntime`                            | `Runtime`                                          |
| `Dispatcher[F]`                        | `ManagedRuntime`                                   |
| `cats.effect.std.Random[F]`            | `Random` service                                   |
| `Clock[F]`                             | `Clock` service                                    |

### Streams / Schedule / Schema

| ecosystem                                         | Effect                                        |
| ------------------------------------------------- | --------------------------------------------- |
| fs2 `Stream[F, A]`                                | `Stream<A, E, R>`                             |
| fs2 `.compile.drain`                              | `Stream.runDrain`                             |
| fs2 `.compile.toList/toVector`                    | `Stream.runCollect`                           |
| fs2 `.evalMap` / `.parEvalMap`                    | `Stream.mapEffect(..., { concurrency })`      |
| fs2 `Pull[F, O, R]`                               | `Channel`                                     |
| `cats-retry` `RetryPolicy`                        | `Schedule` (and more — also describes repeat) |
| `cats-retry` `constantDelay`/`exponentialBackoff` | `Schedule.spaced`/`.exponential`              |
| `cats-retry` `p1 && p2` / `p1 \|\| p2`            | `Schedule.intersect` / `.union`               |
| `cats-retry` `fullJitter`                         | `Schedule.jittered`                           |
| `fs2-cron`                                        | `Cron` + `Schedule.cron`                      |
| io-ts `Type<A, O, I>`                             | `Schema<Type, Encoded, R>`                    |
| io-ts `t.string`/`t.number`                       | `Schema.String`/`Schema.Number`               |
| io-ts `t.type({...})`                             | `Schema.Struct({...})`                        |
| io-ts `t.refinement`                              | `Schema.filter`                               |
| io-ts custom `Type` with validate/encode          | `Schema.transform` / `Schema.transformOrFail` |
| io-ts `t.brand`                                   | `Schema.brand("X")`                           |
| `io-ts-to-json-schema`                            | `JSONSchema.make`                             |
| `io-ts-fuzzer`                                    | `Arbitrary.make`                              |

### Data types / utilities

| Scala / fp-ts                               | Effect                                            |
| ------------------------------------------- | ------------------------------------------------- |
| fp-ts `Option` / Scala `Option`             | `Option` (but `none` is a function!)              |
| fp-ts `Either<E, A>` / Scala `Either[E, A]` | `Either<A, E>` — **right-first**                  |
| fs2 `Chunk` / Scala `Vector`/`Chain`        | `Chunk`                                           |
| Scala immutable `Map` / `Set`               | `HashMap` / `HashSet`                             |
| Scala `TreeMap` / `TreeSet`                 | `SortedMap` / `SortedSet`                         |
| Scala `List`                                | `List` (cons)                                     |
| Scala `case class`                          | `Data.struct` / `Data.case` / `Data.Class`        |
| One branch of a Scala `sealed trait`        | `Data.TaggedClass`                                |
| Full Scala `sealed trait` + `case class`s   | `Data.TaggedEnum`                                 |
| Scala `match`, ts-pattern                   | `Match`                                           |
| fp-ts `pipe` / `flow`                       | `pipe` / `flow` (identical)                       |
| Scala opaque types / io-ts `t.brand`        | `Brand.nominal`                                   |
| refined types (eu.timepit.refined)          | `Brand.refined`                                   |
| `scala.concurrent.duration.FiniteDuration`  | `Duration`                                        |
| cats `Order` / `Eq`                         | `Order` / `Equivalence` + stronger `Equal`/`Hash` |
| (no automatic analog)                       | `Function.dual` (every Effect combinator)         |

---

## 40. Gotchas

- `Option.none` is a **function** — always call `Option.none()`.
- `Either<A, E>` — **right-first** parameter order, opposite of fp-ts
  `Either<E, A>`.
- `Either` is a subtype of `Effect` — you rarely need `Effect.fromEither`.
- Plain arrays/objects do **not** compare structurally — wrap with `Data.*` for
  use as `HashMap` keys or with `Equal.equals`.
- `Chunk` is only faster than arrays when you're doing **repeated**
  concatenation; otherwise it adds overhead.
- `HashMap.get` returns `Option<V>`, not `V | undefined`.
- `Chunk.of` is singleton (takes one arg); the variadic form is `Chunk.make`.
  Concatenation is `Chunk.appendAll`, not `Chunk.concat`.
- `Effect.fork` is **not** `IO#start`. It's `start` + auto-supervision. For
  cats-effect `start` semantics, use `Effect.forkDaemon`.
- `Effect.race(a, b)` returns `A | B`, not `Either[A, B]` like cats.
- `Effect.uninterruptible` without `Mask` is almost always wrong — prefer
  `Effect.uninterruptibleMask(restore => ...)`.
- `Effect.catchAll` catches only typed `E` — not defects, not interruption. Use
  `catchAllCause` to see everything.
- `Effect.repeat(e, Schedule.once)` runs `e` **twice** (initial + one repeat).
- No `Resource` type — scoped effects carry `Scope` in the `R` channel. The type
  system forces you to call `Effect.scoped` before running.
- `Match.exhaustive` is your best friend — prefer it to `orElse` when the input
  is a closed union.
- A `for` loop with `yield*` inside `Effect.gen` is **sequential**. For
  concurrency, use `Effect.forEach(..., { concurrency })`.
- STM is first-class and integrated — no separate library.
  `TQueue`/`TPubSub`/`TSemaphore` ship out of the box.
- When building layers for tests, just swap them — there's no mocking library
  needed. This is one of the biggest wins over cats-effect-style testing.
- `Config.secret` is legacy — use `Config.redacted` in new code.
