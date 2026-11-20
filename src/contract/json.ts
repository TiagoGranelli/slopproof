export type Json = null | boolean | number | string | ReadonlyArray<Json> | { readonly [key: string]: Json }
