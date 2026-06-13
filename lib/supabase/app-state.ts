import type { RealtimeChannel } from '@supabase/supabase-js'
import type { AppSettings, AppState } from '../types'
import { getSupabaseClient } from './client'

const syncTeamStorageKey = 'flag-football-coach:supabase-team-id'

export interface SupabaseMembership {
  teamId: string
  role: 'head_coach' | 'assistant_coach'
  canAddNotes: boolean
  canAdvanceDrive: boolean
}

interface TeamMemberRow {
  team_id: string
  role: SupabaseMembership['role']
  can_add_notes: boolean
  can_advance_drive: boolean
}

interface SnapshotRow {
  team_id: string
  state: AppState
  updated_by: string | null
  updated_at: string
}

interface InviteMembershipRow {
  team_id: string
  role: SupabaseMembership['role']
  can_add_notes: boolean
  can_advance_drive: boolean
}

export function appSettingsFromMembership(membership: SupabaseMembership, fallback: AppSettings): AppSettings {
  return {
    ...fallback,
    role: membership.role === 'head_coach' ? 'head' : 'assistant',
    assistantCanAddNotes: membership.canAddNotes,
    assistantCanAdvanceDrive: membership.canAdvanceDrive
  }
}

export function normalizeAppStateForSupabase(state: AppState): AppState {
  return {
    ...state,
    appSettings: {
      ...state.appSettings,
      role: 'head'
    }
  }
}

export function readStoredSupabaseTeamId() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage.getItem(syncTeamStorageKey)
}

function storeSupabaseTeamId(teamId: string) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(syncTeamStorageKey, teamId)
  }
}

function clearStoredSupabaseTeamId() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(syncTeamStorageKey)
  }
}

function membershipFromRow(row: TeamMemberRow): SupabaseMembership {
  return {
    teamId: row.team_id,
    role: row.role,
    canAddNotes: row.can_add_notes,
    canAdvanceDrive: row.can_advance_drive
  }
}

async function getMembershipForTeam(teamId: string, userId: string) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('team_members')
    .select('team_id, role, can_add_notes, can_advance_drive')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle<TeamMemberRow>()

  if (error) {
    clearStoredSupabaseTeamId()
    return null
  }

  return data ? membershipFromRow(data) : null
}

async function getFirstMembership(userId: string) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('team_members')
    .select('team_id, role, can_add_notes, can_advance_drive')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle<TeamMemberRow>()

  if (error || !data) {
    return null
  }

  return membershipFromRow(data)
}

async function createTeamMembership(seedState: AppState) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('create_team_with_member', {
    team_name: seedState.team.name,
    team_season: seedState.team.season,
    team_age_group: seedState.team.ageGroup
  })

  if (error || typeof data !== 'string') {
    throw error || new Error('Unable to create Supabase team')
  }

  const membership: SupabaseMembership = {
    teamId: data,
    role: 'head_coach',
    canAddNotes: true,
    canAdvanceDrive: true
  }

  storeSupabaseTeamId(membership.teamId)
  return membership
}

export async function ensureSupabaseMembership(seedState: AppState, userId: string): Promise<SupabaseMembership> {
  const storedTeamId = readStoredSupabaseTeamId()
  if (storedTeamId) {
    const storedMembership = await getMembershipForTeam(storedTeamId, userId)
    if (storedMembership) {
      return storedMembership
    }
  }

  const existingMembership = await getFirstMembership(userId)
  if (existingMembership) {
    storeSupabaseTeamId(existingMembership.teamId)
    return existingMembership
  }

  return createTeamMembership(seedState)
}

export async function loadSupabaseState(teamId: string) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('app_state_snapshots')
    .select('team_id, state, updated_by, updated_at')
    .eq('team_id', teamId)
    .maybeSingle<SnapshotRow>()

  if (error) {
    throw error
  }

  return data
}

export async function saveSupabaseState(teamId: string, state: AppState, userId: string) {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('app_state_snapshots').upsert({
    team_id: teamId,
    state: normalizeAppStateForSupabase(state),
    updated_by: userId,
    updated_at: new Date().toISOString()
  })

  if (error) {
    throw error
  }
}

export async function createSupabaseAssistantInvite(
  teamId: string,
  email: string,
  canAddNotes: boolean,
  canAdvanceDrive: boolean
) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('create_team_invite', {
    target_team_id: teamId,
    invite_email: email,
    invite_can_add_notes: canAddNotes,
    invite_can_advance_drive: canAdvanceDrive
  })

  if (error || typeof data !== 'string') {
    throw error || new Error('Unable to create invite')
  }

  return data
}

export async function acceptSupabaseAssistantInvite(token: string) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('accept_team_invite', {
    invite_token: token
  })

  if (error || !Array.isArray(data) || data.length === 0) {
    throw error || new Error('Invite not found or expired')
  }

  const row = data[0] as InviteMembershipRow
  const membership = membershipFromRow(row)
  storeSupabaseTeamId(membership.teamId)
  return membership
}

export function subscribeToSupabaseState(
  teamId: string,
  onState: (row: SnapshotRow) => void
): RealtimeChannel {
  const supabase = getSupabaseClient()

  return supabase
    .channel(`app-state-${teamId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'app_state_snapshots',
        filter: `team_id=eq.${teamId}`
      },
      (payload) => {
        if (payload.new && 'state' in payload.new) {
          onState(payload.new as SnapshotRow)
        }
      }
    )
    .subscribe()
}
