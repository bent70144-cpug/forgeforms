// Shared kernel: Result — explicit error channel across module boundaries (spec §3).
//
// "Services return Result<T, AppError> (no thrown errors across module
// boundaries except for programmer errors)."

import type { AppError } from "./errors.js";

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };

/** Result of a service call. `E` defaults to `AppError` per the module contract. */
export type Result<T, E = AppError> = Ok<T> | Err<E>;

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}

/** Unwrap or throw. Use only at edges where a throw is a programmer error. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw r.error;
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

export function map<T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r;
}

export function mapErr<T, E, F>(r: Result<T, E>, f: (error: E) => F): Result<T, F> {
  return r.ok ? r : err(f(r.error));
}

/** Monadic bind — short-circuits on the first Err. */
export function andThen<T, U, E>(r: Result<T, E>, f: (value: T) => Result<U, E>): Result<U, E> {
  return r.ok ? f(r.value) : r;
}

/**
 * Bridge the throwing world into the Result world. Catches a synchronous
 * throw and converts it to `err(...)`. Use at boundaries (JSON.parse,
 * crypto, third-party libs), not around service calls.
 */
export function attempt<T, E>(f: () => T, onError: (cause: unknown) => E): Result<T, E> {
  try {
    return ok(f());
  } catch (cause) {
    return err(onError(cause));
  }
}
