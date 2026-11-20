import { HttpApi, OpenApi } from 'effect/http-api'
import { APP_NAME } from '#/config/app.ts'
import { Me } from './me.ts'
import { MyPosts, PublicPosts } from './posts.ts'
import { System } from './system.ts'

export class Api extends HttpApi.make('api')
  .add(System)
  .add(Me)
  .add(PublicPosts)
  .add(MyPosts)
  .annotateMerge(
    OpenApi.annotations({
      title: `${APP_NAME} API`,
      version: '0.1.0',
      description:
        'Every POST, PATCH and DELETE must come from the app itself: `Sec-Fetch-Site: same-origin`, or an ' +
        '`Origin` (or `Referer`) equal to the app origin. Any other answers `403` with a plain-text body before ' +
        'the operation runs. An unexpected failure (a bug, or the database unreachable) answers `500` with an ' +
        'empty body. Neither carries a tagged error: treat both as a generic failure.',
    }),
  ) {}
