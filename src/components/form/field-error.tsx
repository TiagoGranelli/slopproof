export function FieldError(props: { id: string; message: string | undefined }) {
  if (!props.message) {
    return null
  }
  return (
    <p className="text-sm text-destructive" id={props.id} role="alert">
      {props.message}
    </p>
  )
}
