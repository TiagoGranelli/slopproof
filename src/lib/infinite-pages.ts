export const firstPage = {}

export const nextPage = (page: { readonly nextCursor: string | null }): string | null => page.nextCursor
