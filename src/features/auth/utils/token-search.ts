/** The search params of a page opened from an email link. */
export interface TokenSearch {
  token?: string
}

/** The link's token, when the URL has a non-empty one; anything else in the URL is ignored. */
export const tokenFromSearch = (search: { readonly token?: unknown }): TokenSearch =>
  typeof search.token === 'string' && search.token ? { token: search.token } : {}
