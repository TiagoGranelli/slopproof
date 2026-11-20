import { createContext } from 'react'

export const ServerIssues = createContext<Readonly<Record<string, string>>>({})
