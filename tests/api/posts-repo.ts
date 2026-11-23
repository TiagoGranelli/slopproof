import { Layer } from 'effect'
import { PostId } from '#/contract/ids.ts'
import type { UserId } from '#/contract/ids.ts'
import type { Post } from '#/contract/posts.ts'
import { PostsRepo } from '#/server/posts/repo.ts'
import { memoryQuery } from './memory-db.ts'
import type { RepoOptions } from './memory-db.ts'
import { memoryClock, memoryPage } from './memory-keyset.ts'

type StoredPost = Post & { readonly authorId: UserId; readonly cursorAt: string }

const view = ({ authorName, body, createdAt, id, updatedAt }: StoredPost): Post => ({
  authorName,
  body,
  createdAt,
  id,
  updatedAt,
})

export const memoryPostsRepo = (options: RepoOptions) => {
  const db = memoryQuery(options)
  return Layer.sync(PostsRepo, () => {
    const posts: Array<StoredPost> = []
    const tick = memoryClock(options.clockStepMicros ?? 1_000_000)
    const owned = (authorId: string, id: string) => posts.findIndex((p) => p.id === id && p.authorId === authorId)
    return {
      create: (author, body) =>
        db(() => {
          const now = tick()
          const post: StoredPost = {
            authorId: author.id,
            authorName: author.name,
            body,
            createdAt: now.iso,
            cursorAt: now.key,
            id: PostId.make(crypto.randomUUID()),
            updatedAt: now.iso,
          }
          posts.push(post)
          return view(post)
        }),
      listByAuthor: (author, page) =>
        db(() =>
          memoryPage(
            posts.filter((p) => p.authorId === author.id),
            page,
            view,
          ),
        ),
      listPublic: (page) => db(() => memoryPage(posts, page, view)),
      remove: (author, id) =>
        db(() => {
          const index = owned(author.id, id)
          if (index !== -1) {
            posts.splice(index, 1)
          }
          return index !== -1
        }),
      update: (author, id, body) =>
        db(() => {
          const index = owned(author.id, id)
          if (index === -1) {
            return undefined
          }
          const post = { ...posts[index]!, body, updatedAt: tick().iso }
          posts[index] = post
          return view(post)
        }),
    }
  })
}
