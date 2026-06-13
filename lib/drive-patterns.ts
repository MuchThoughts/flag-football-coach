import type { Drive } from './types'

export function applySourceAssignmentsToRepeats(drives: Drive[], sourceDriveId: string) {
  const sourceDrive = drives.find((drive) => drive.id === sourceDriveId)
  if (!sourceDrive) {
    return drives
  }

  return drives.map((drive) => {
    if (drive.sourceDriveId !== sourceDrive.id || drive.isCustomized || drive.status === 'completed') {
      return drive
    }

    return {
      ...drive,
      assignments: { ...sourceDrive.assignments }
    }
  })
}

export function resetRepeatedDriveFromSource(drives: Drive[], repeatedDriveId: string) {
  const repeatedDrive = drives.find((drive) => drive.id === repeatedDriveId)
  if (!repeatedDrive?.sourceDriveId || repeatedDrive.status === 'completed') {
    return drives
  }

  const sourceDrive = drives.find((drive) => drive.id === repeatedDrive.sourceDriveId)
  if (!sourceDrive) {
    return drives
  }

  return drives.map((drive) =>
    drive.id === repeatedDrive.id
      ? {
          ...drive,
          assignments: { ...sourceDrive.assignments },
          isCustomized: false
        }
      : drive
  )
}

export function getLinkedRepeatCount(drives: Drive[], sourceDriveId: string) {
  return drives.filter((drive) => drive.sourceDriveId === sourceDriveId).length
}
