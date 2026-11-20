import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from 'effect/http-api'
import { UserId } from './ids.ts'
import { Authentication } from './middleware.ts'

const User = Schema.Struct({
  id: UserId,
  name: Schema.String,
  email: Schema.String,
}).annotate({ identifier: 'User', description: 'The signed-in user, without credentials or session data.' })

export class Me extends HttpApiGroup.make('me')
  .add(HttpApiEndpoint.get('get', '/me', { success: User }))
  .middleware(Authentication)
  .prefix('/api')
  .annotateMerge(OpenApi.annotations({ title: 'Me', description: 'The signed-in user.' })) {}
