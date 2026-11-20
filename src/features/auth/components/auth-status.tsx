import { useId, type ReactNode } from 'react'

const focusOnMount = (element: HTMLOutputElement | null) => {
  element?.focus()
}

export function AuthStatus(props: { children: ReactNode; headingLevel?: 2 | 3; title: string }) {
  const titleId = useId()
  const Heading = props.headingLevel === 3 ? 'h3' : 'h2'
  return (
    <output aria-labelledby={titleId} className="grid gap-1 outline-none" ref={focusOnMount} tabIndex={-1}>
      <Heading className="font-semibold" id={titleId}>
        {props.title}
      </Heading>
      <p>{props.children}</p>
    </output>
  )
}
