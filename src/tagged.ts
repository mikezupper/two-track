/**
 * Tagged values — the shape of every domain error and every variant of a union.
 *
 * Convention: the discriminant is `_tag`, the name describes WHAT HAPPENED
 * (`OrderNotFound`, not `DbError`), and the fields carry what a handler needs
 * to react (ids, the offending value, whether it is retriable). Never a bare
 * message string.
 */

export type Tagged<Tag extends string, Fields extends object = Record<never, never>> = {
  readonly _tag: Tag;
} & Readonly<Fields>;

/**
 * Build a constructor for one tag:
 *
 *   const OrderNotFound = tagged("OrderNotFound")<{ orderId: OrderId }>();
 *   type OrderNotFound = ReturnType<typeof OrderNotFound>;
 *   return err(OrderNotFound({ orderId }));
 */
export const tagged =
  <Tag extends string>(tag: Tag) =>
  <Fields extends object = Record<never, never>>() =>
  (fields: Fields): Tagged<Tag, Fields> =>
    ({ _tag: tag, ...fields });

/** Type guard for one tag of a union. */
export const hasTag =
  <Tag extends string>(tag: Tag) =>
  <T extends { readonly _tag: string }>(value: T): value is Extract<T, { readonly _tag: Tag }> =>
    value._tag === tag;

/** The union of tags of a tagged union type. */
export type TagOf<T extends { readonly _tag: string }> = T["_tag"];
