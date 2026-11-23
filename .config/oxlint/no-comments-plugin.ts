interface CommentLocation {
  readonly end: { readonly column: number; readonly line: number }
  readonly start: { readonly column: number; readonly line: number }
}

interface SourceComment {
  readonly loc: CommentLocation
  readonly type: 'Block' | 'Line' | 'Shebang'
  readonly value: string
}

interface RuleContext {
  readonly report: (descriptor: { readonly loc: CommentLocation; readonly message: string }) => void
  readonly sourceCode: {
    readonly getAllComments: () => ReadonlyArray<SourceComment>
    readonly lines: ReadonlyArray<string>
  }
}

interface NoCommentsRule {
  readonly create: (context: RuleContext) => { readonly Program: () => void }
  readonly meta: {
    readonly docs: { readonly description: string }
    readonly type: 'problem'
  }
}

interface RepoPlugin {
  readonly meta: { readonly name: string }
  readonly rules: { readonly 'no-comments': NoCommentsRule }
}

const DIRECTIVE_LINE =
  /^\s*(?:(?:oxlint|eslint)-disable(?:-next-line|-line)?\b|fallow-ignore-(?:next-line|file)\b|@ts-expect-error\b|@effect-diagnostics\b|v8 ignore\b|oxfmt-ignore\b|\/\s*<reference\b)/
const NEXT_LINE_DIRECTIVE =
  /^\s*(?:(?:oxlint|eslint)-disable-next-line\b|fallow-ignore-next-line\b|@ts-expect-error\b|@effect-diagnostics\b|v8 ignore\b|oxfmt-ignore\b)/
const DIRECTIVE_BLOCK =
  /^\s*(?:(?:oxlint|eslint)-disable\b|v8 ignore\b|@vite-ignore\b)|@effect-(?:expect-leaking|diagnostics)\b/

const MESSAGE =
  'Comments drift out of sync with code and mislead agents (ADR 0019). Express intent through clear names, types, tests, or an ADR; only machine-checked tool directives (oxlint-disable-next-line, fallow-ignore-next-line, @ts-expect-error, @effect-expect-leaking, @effect-diagnostics) and the one-line reason directly above each directive are allowed.'

const isDirective = (comment: SourceComment): boolean => {
  if (comment.type === 'Shebang') {
    return true
  }
  return comment.type === 'Line' ? DIRECTIVE_LINE.test(comment.value) : DIRECTIVE_BLOCK.test(comment.value)
}

const isNextLineDirective = (comment: SourceComment | undefined): comment is SourceComment =>
  comment !== undefined && isDirective(comment) && NEXT_LINE_DIRECTIVE.test(comment.value)

const isStandaloneLine = (comment: SourceComment, lines: ReadonlyArray<string>): boolean => {
  const line = lines[comment.loc.start.line - 1] ?? ''
  return line.slice(0, comment.loc.start.column).trim().length === 0
}

const isReasonForNextDirective = (
  comment: SourceComment,
  next: SourceComment | undefined,
  lines: ReadonlyArray<string>,
): boolean =>
  comment.type === 'Line' &&
  !isDirective(comment) &&
  comment.value.trim().length > 0 &&
  isStandaloneLine(comment, lines) &&
  isNextLineDirective(next) &&
  comment.loc.end.line + 1 === next.loc.start.line

const isAllowedComment = (
  comment: SourceComment,
  adjacent: { next: SourceComment | undefined; previous: SourceComment | undefined },
  lines: ReadonlyArray<string>,
): boolean => {
  if (isNextLineDirective(comment)) {
    return adjacent.previous !== undefined && isReasonForNextDirective(adjacent.previous, comment, lines)
  }
  return isDirective(comment) || isReasonForNextDirective(comment, adjacent.next, lines)
}

export const noCommentsRule: NoCommentsRule = {
  create(context) {
    return {
      Program() {
        const comments = context.sourceCode.getAllComments()
        const { lines } = context.sourceCode
        for (const [index, comment] of comments.entries()) {
          const adjacent = { next: comments[index + 1], previous: comments[index - 1] }
          if (!isAllowedComment(comment, adjacent, lines)) {
            context.report({ loc: comment.loc, message: MESSAGE })
          }
        }
      },
    }
  },
  meta: {
    docs: {
      description: 'Disallow comments except machine-checked tool directives and their one-line reasons.',
    },
    type: 'problem',
  },
}

const noCommentsPlugin: RepoPlugin = {
  meta: { name: 'repo' },
  rules: {
    'no-comments': noCommentsRule,
  },
}

export default noCommentsPlugin
