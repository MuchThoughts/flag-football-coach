'use client'

import { createContext, useContext } from 'react'
import { DEFAULT_POSITIONS } from '@/lib/playbook'
import type { PersonnelPackage, PlaybookPosition } from '@/lib/types'

/**
 * The personnel packages of the playbook on screen. Everything that draws a
 * formation asks for its package here, so a five-player package shows five
 * circles with that package's labels everywhere.
 */
export const PackagesContext = createContext<PersonnelPackage[]>([
  { id: 'package-base', name: 'Base', positions: DEFAULT_POSITIONS }
])

export function usePackages() {
  return useContext(PackagesContext)
}

/** The players of one package; a formation naming no package that exists gets the first. */
export function usePositions(packageId?: string): PlaybookPosition[] {
  const packages = useContext(PackagesContext)
  return (packages.find((item) => item.id === packageId) || packages[0])?.positions || DEFAULT_POSITIONS
}
