import { makeFilter } from 'effect/Schema'

export const isFreeOfNul = makeFilter<string>((value) => !value.includes('\u0000'), {
  expected: 'a string without U+0000',
  message: 'Remove the invisible NUL character (U+0000) from the text.',
  toJsonSchema: () => ({ pattern: String.raw`^[^\u0000]*$` }),
})
