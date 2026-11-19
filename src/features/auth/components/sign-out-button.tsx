import { useNavigate } from '@tanstack/react-router'
import { Button } from '#/components/ui/button.tsx'
import { useSignOut } from '#/features/auth/api/sign-out.ts'

/**
 * The header's Sign out. On success the visitor lands on `/` with a "You are signed out." flash (src/lib/flash.ts);
 * the cache is already cleared by then. A failure is an alert on a line of its own. While pending the button is
 * only `aria-disabled` and ignores presses: a disabled button loses focus, and a keyboard user would be left on
 * <body> if signing out fails (the same holds for every pending button).
 */
export function SignOutButton() {
  const navigate = useNavigate()
  const signOut = useSignOut({
    mutationConfig: { onSuccess: () => navigate({ state: { flash: 'signed-out' }, to: '/' }) },
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
