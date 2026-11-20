export interface TokenSearch {
  token?: string
}

export const tokenFromSearch = (search: { readonly token?: unknown }): TokenSearch =>
  typeof search.token === 'string' && search.token ? { token: search.token } : {}
