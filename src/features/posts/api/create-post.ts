import { useMutation } from '@tanstack/react-query'
import { postListsChanged } from '#/features/posts/api/posts-cache.ts'
import { myPostsCreateMutation } from '#/sdk/@tanstack/react-query.gen.ts'

type CreatePostConfig = Omit<ReturnType<typeof myPostsCreateMutation>, 'mutationFn'>

export function useCreatePost({ mutationConfig }: { mutationConfig?: CreatePostConfig } = {}) {
  return useMutation({ ...mutationConfig, ...myPostsCreateMutation(), meta: { invalidates: postListsChanged() } })
}
