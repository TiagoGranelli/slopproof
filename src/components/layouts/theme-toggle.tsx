import { useState, useSyncExternalStore } from 'react'
import { readThemeChoice, saveThemeChoice, type ThemeChoice } from '#/lib/theme.ts'

const CHOICES: ReadonlyArray<{ label: string; value: ThemeChoice }> = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
]

const segment =
  'relative rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground has-checked:bg-background has-checked:text-foreground has-checked:shadow-xs forced-colors:has-checked:bg-system-highlight forced-colors:has-checked:text-system-highlight-text forced-colors:has-checked:forced-color-adjust-none'

const noChanges = () => () => {}
const onServer = (): ThemeChoice => 'system'

export function ThemeToggle() {
  const stored = useSyncExternalStore(noChanges, readThemeChoice, onServer)
  const [picked, setPicked] = useState<ThemeChoice>()
  const choice = picked ?? stored
  return (
    <fieldset className="flex items-center gap-2">
      <legend className="float-left">Theme</legend>
      <div className="flex rounded-lg bg-muted p-0.5">
        {CHOICES.map(({ label, value }) => (
          <label className={segment} key={value}>
            <input
              checked={choice === value}
              className="absolute inset-0 cursor-pointer appearance-none rounded-md"
              name="theme"
              onChange={() => {
                saveThemeChoice(value)
                setPicked(value)
              }}
              type="radio"
              value={value}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
