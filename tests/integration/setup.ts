import { inject } from 'vitest'

Object.assign(process.env, inject('servers').env)
