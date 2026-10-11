'use client'

import { createContext, useContext } from 'react'
import { DEFAULT_POSITIONS } from '@/lib/playbook'
import type { PlaybookPosition } from '@/lib/types'

/**
 * The players of the playbook on screen. Everything that draws a play reads
 * them from here, so a five-player playbook shows five circles everywhere.
 */
export const PositionsContext = createContext<PlaybookPosition[]>(DEFAULT_POSITIONS)

export function usePositions() {
  return useContext(PositionsContext)
}
