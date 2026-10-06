/**
 * Exhaustive matching with no runtime beyond a property lookup.
 *
 * The guarantee that matters: adding a variant to a union makes every `match`
 * over it fail to COMPILE until the new case is handled. There is no `default`
 * — a catch-all silently absorbs future variants, which is the bug these
 * functions exist to prevent.
 */

export type Cases<T extends { readonly _tag: string }, R> = {
  readonly [K in T["_tag"]]: (value: Extract<T, { readonly _tag: K }>) => R;
};

/** Exhaustive match on the `_tag` discriminant. */
export const match = <T extends { readonly _tag: string }, R>(value: T, cases: Cases<T, R>): R => {
  const handler = cases[value._tag as T["_tag"]] as ((v: T) => R) | undefined;
  if (handler === undefined) return noCase("_tag", value._tag, Object.keys(cases));
  return handler(value);
};

export type CasesBy<Key extends string, T extends { readonly [K in Key]: string }, R> = {
  readonly [V in T[Key]]: (value: Extract<T, { readonly [K in Key]: V }>) => R;
};

/** Exhaustive match on a custom discriminant key (e.g. `kind`, `type`, `status`). */
export const matchBy = <Key extends string, T extends { readonly [K in Key]: string }, R>(
  key: Key,
  value: T,
  cases: CasesBy<Key, T, R>,
): R => {
  const handler = cases[value[key] as T[Key]] as ((v: T) => R) | undefined;
  if (handler === undefined) return noCase(key, value[key], Object.keys(cases));
  return handler(value);
};

/**
 * A value reached `match` with a tag the type says it cannot have. The types were lied to
 * at a boundary (data that was not decoded), so this is a defect with a clear message, not
 * a `TypeError: cases[value._tag] is not a function` three frames away.
 */
const noCase = (key: string, tag: unknown, known: ReadonlyArray<string>): never => {
  throw new Error(`[two-track] match: no case for ${key} ${JSON.stringify(tag)} (cases: ${known.join(", ")}) — the value did not come through a decoder`);
};

/**
 * The one sanctioned defect. Place it in the `default` of a `switch` over a
 * union so the compiler proves the switch is exhaustive: if a variant is
 * unhandled, `x` is not `never` and the call does not type-check.
 * It throws because reaching it at runtime means a value lied about its type,
 * which is a bug at a boundary, not an expected error.
 */
export const assertNever = (x: never, context = "unreachable"): never => {
  throw new Error(`[two-track] assertNever reached (${context}): ${JSON.stringify(x)}`);
};
