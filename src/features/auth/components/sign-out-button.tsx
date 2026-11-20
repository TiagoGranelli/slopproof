import { useNavigate } from '@tanstack/react-router'
import { Button } from '#/components/ui/button.tsx'
import { useSignOut } from '#/features/auth/api/sign-out.ts'

export function SignOutButton() {
  const navigate = useNavigate()
  const signOut = useSignOut({
    mutationConfig: {
      onSuccess: () => {
        document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true })
        return navigate({ state: { flash: 'signed-out' }, to: '/' })
      },
    },
  })
  return (
    <>
      <Button
        aria-busy={signOut.isPending}
        aria-disabled={signOut.isPending || undefined}
        onClick={() => {
          if (!signOut.isPending) {
            signOut.mutate()
          }
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        Sign out
      </Button>
      {signOut.isError ? (
        <p className="basis-full text-right text-sm text-destructive" role="alert">
          Could not sign out. Check your connection and try again.
        </p>
      ) : null}
    </>
  )
}
