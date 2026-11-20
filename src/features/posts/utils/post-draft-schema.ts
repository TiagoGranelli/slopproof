import { lazyFormSchema } from '#/components/form/lazy-schema.ts'

export const postDraftSchema = lazyFormSchema(() => import('./post-draft.ts').then((module) => module.PostDraft))
