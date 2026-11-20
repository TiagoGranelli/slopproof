import { cn } from '#/lib/utils.ts'

export const isTooLong = (value: string, max: number) => value.trim().length > max

export function CharacterCount(props: { id: string; max: number; value: string }) {
  const tooLong = isTooLong(props.value, props.max)
  return (
    <span className={cn('text-sm tabular-nums', tooLong ? 'text-destructive' : 'text-muted-foreground')} id={props.id}>
      {props.value.trim().length}/{props.max}
      <span className="sr-only"> characters. </span>
      <span aria-live="polite" className="sr-only">
        {tooLong ? `Over the ${props.max}-character limit.` : ''}
      </span>
    </span>
  )
}
