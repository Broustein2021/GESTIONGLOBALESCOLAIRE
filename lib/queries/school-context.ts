import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export type SchoolContext = {
  schoolId: string
  academicYearId: string
}

/**
 * Résout l'école active et l'année scolaire courante de l'utilisateur
 * connecté, côté serveur. Réutilisable par tous les adapters de données
 * réelles (classes, élèves, enseignants, finances, notes...).
 *
 * Retourne null si l'utilisateur n'a pas d'établissement actif
 * (redirection /onboarding déjà gérée par le proxy.ts).
 */
export async function getCurrentSchoolContext(): Promise<SchoolContext | null> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!profile) return null

  const { data: membership } = await supabase
    .from('school_members')
    .select('school_id')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!membership) return null

  const { data: schoolYears } = await supabase
    .from('academic_years')
    .select('id')
    .eq('school_id', membership.school_id)
    .order('starts_on', { ascending: false })

  const yearIds = (schoolYears ?? []).map((y) => y.id)
  const cookieStore = await cookies()
  const cookieYear = cookieStore.get('gs_annee')?.value ?? null

  let academicYearId: string | null = null
  if (cookieYear && yearIds.includes(cookieYear)) {
    academicYearId = cookieYear
  } else {
    const { data: currentYear } = await supabase
      .from('academic_years')
      .select('id')
      .eq('school_id', membership.school_id)
      .eq('is_current', true)
      .maybeSingle()
    academicYearId = currentYear?.id ?? yearIds[0] ?? null
  }

  if (!academicYearId) return null

  return { schoolId: membership.school_id, academicYearId }
}

/**
 * Rôle de l'utilisateur dans son établissement actif (pour gate les actions
 * réservées à la direction : modifier un élève, une classe, etc.).
 * Retourne null si aucun établissement actif.
 */
export async function getCurrentUserRole(): Promise<string | null> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!profile) return null

  const { data: membership } = await supabase
    .from('school_members')
    .select('role')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return membership?.role ?? null
}
