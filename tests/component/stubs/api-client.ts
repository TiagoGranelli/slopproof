import { client } from '#/sdk/client.gen.ts'

client.setConfig({ baseUrl: window.location.origin, credentials: 'same-origin' })

export const apiClient = () => client
