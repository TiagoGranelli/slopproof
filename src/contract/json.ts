/** A value JSON.parse can return, and JSON.stringify writes back unchanged. */
export type Json = null | boolean | number | string | ReadonlyArray<Json> | { readonly [key: string]: Json }
