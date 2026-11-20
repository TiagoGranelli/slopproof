import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { ServiceUnavailable } from './errors.ts'

const Health = Schema.Struct({ status: Schema.Literal('ok') }).annotate({ identifier: 'Health' })

export class System extends HttpApiGroup.make('system')
  .add(
    HttpApiEndpoint.get('health', '/health', { success: Health }),
    HttpApiEndpoint.get('ready', '/ready', { success: Health, error: ServiceUnavailable }),
  )
  .prefix('/api') {}
