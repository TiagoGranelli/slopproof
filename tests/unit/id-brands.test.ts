import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { UserId } from '#/contract/ids.ts'
import type { PostId } from '#/contract/ids.ts'
import { post } from '#/server/db/schema/posts.ts'

describe('id brands', () => {
  it('refuse a user id where a post id is expected, in a value and in a query', () => {
    const author = UserId.make('user-1')
    // The assignment would mix a user ID with a post ID.
    // @ts-expect-error a user's id is not a post's id: the mix-up the brands exist to refuse
    const mixedUp: PostId = author
    // The query compares the post column with a user ID.
    // @ts-expect-error the same mix-up in a WHERE clause: post.id compared with a user's id
    const condition = eq(post.id, author)
    expect(mixedUp).toBe('user-1')
    expect(condition).toBeDefined()
  })

  it('accept a plain string only through the brand', () => {
    // A plain string must go through the UserId constructor.
    // @ts-expect-error a string that did not go through UserId.make or a decoded schema
    const unbranded: UserId = 'user-1'
    expect(UserId.make(unbranded)).toBe('user-1')
  })
})
