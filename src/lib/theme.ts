export type ThemeChoice = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'theme'

export const THEME_SCRIPT = `try{var t=localStorage.getItem('${STORAGE_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

const persistThemeChoice = (choice: ThemeChoice): boolean => {
  try {
    if (choice === 'system') {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, choice)
    }
    return true
  } catch {
    return false
  }
}

export function saveThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement
  persistThemeChoice(choice)
  if (choice === 'system') {
    delete root.dataset.theme
  } else {
    root.dataset.theme = choice
  }
}
