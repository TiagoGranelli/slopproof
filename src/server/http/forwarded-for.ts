import '@tanstack/react-start/server-only'

export const forwardedFor = (
  received: string | null,
  peer: string | undefined,
  trustsProxies: boolean,
): string | undefined => {
  if (!peer) {
    return undefined
  }
  const chain = trustsProxies ? received?.trim() : undefined
  return chain ? `${chain}, ${peer}` : peer
}
