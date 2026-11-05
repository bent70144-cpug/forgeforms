import { describe, expect, it } from "vitest";
import type { Result } from "./result.js";
import { AppError } from "./errors.js";
import {
  andThen,
  attempt,
  err,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  unwrap,
  unwrapOr,
} from "./result.js";

describe("Result", () => {
  it("ok() carries the value; err() carries the error", () => {
    const a = ok(42);
    const b = err(new AppError("NOT_FOUND", "nope"));
    expect(a.ok).toBe(true);
    expect(isOk(a) && a.value).toBe(42);
    expect(b.ok).toBe(false);
    expect(isErr(b) && b.error.code).toBe("NOT_FOUND");
  });

  it("defaults E to AppError in the type (module contract, spec §3)", () => {
    const r: Result<number> = ok(1);
    expect(r.ok).toBe(true);
  });

  it("unwrap returns value or throws the error", () => {
    expect(unwrap(ok("x"))).toBe("x");
    const e = new AppError("VALIDATION", "bad");
    expect(() => unwrap(err(e))).toThrow(e);
  });

  it("unwrapOr falls back on error", () => {
    expect(unwrapOr(ok(1), 0)).toBe(1);
    expect(unwrapOr(err(new AppError("INTERNAL", "boom")), 7)).toBe(7);
  });

  it("map transforms success, keeps error", () => {
    const r = map(ok(2), (n) => n * 10);
    expect(isOk(r) && r.value).toBe(20);
    const e = err(AppError.conflict("clash"));
    const r2 = map(e, (n) => n * 10);
    expect(isErr(r2) && r2.error.code).toBe("CONFLICT");
  });

  it("mapErr transforms error, keeps value", () => {
    const r = mapErr(err(AppError.internal()), () => AppError.forbidden("no"));
    expect(isErr(r) && r.error.code).toBe("FORBIDDEN");
    expect(mapErr(ok(3), () => AppError.internal()).ok).toBe(true);
  });

  it("andThen short-circuits on first error", () => {
    const failing = (n: number): Result<number, AppError> => err(AppError.validation("nope"));
    const doubling = (n: number): Result<number, AppError> => ok(n * 2);

    const good = andThen(andThen(ok(1), doubling), doubling);
    expect(isOk(good) && good.value).toBe(4);

    const bad = andThen(andThen(ok(1), failing), doubling);
    expect(isErr(bad) && bad.error.code).toBe("VALIDATION");
  });

  it("attempt converts a throw into err", () => {
    const good = attempt(() => JSON.parse('{"a":1}'), () => AppError.validation("bad json"));
    expect(isOk(good)).toBe(true);

    const bad = attempt(
      () => JSON.parse("{nope"),
      () => AppError.validation("bad json"),
    );
    expect(isErr(bad) && bad.error.code).toBe("VALIDATION");
  });
});
