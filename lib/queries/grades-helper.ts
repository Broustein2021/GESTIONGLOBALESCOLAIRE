import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Calcule la moyenne pondérée /20 (score / max_score * 20 * coefficient)
 * de chaque élève d'une liste, à partir des notes réellement saisies.
 * Un élève sans note reçoit 0 (affiché comme "—" côté UI).
 */
export async function getMoyennesParEleve(
  supabase: SupabaseServerClient,
  schoolId: string,
  studentIds: string[],
): Promise<Map<string, number>> {
  const moyennes = new Map<string, number>()
  if (studentIds.length === 0) return moyennes

  const { data: gradeRows } = await supabase
    .from('grades')
    .select('student_id, score, assessments:assessment_id ( coefficient, max_score )')
    .in('student_id', studentIds)
    .eq('school_id', schoolId)
    .not('score', 'is', null)

  const totals = new Map<string, { points: number; coef: number }>()
  for (const g of gradeRows ?? []) {
    const assessment = Array.isArray(g.assessments) ? g.assessments[0] : g.assessments
    const coef = assessment?.coefficient ?? 1
    const max = assessment?.max_score ? Number(assessment.max_score) : 20
    const score20 = max > 0 ? (Number(g.score) / max) * 20 : 0
    const t = totals.get(g.student_id) ?? { points: 0, coef: 0 }
    t.points += score20 * coef
    t.coef += coef
    totals.set(g.student_id, t)
  }
  for (const [studentId, t] of totals) {
    moyennes.set(studentId, t.coef > 0 ? t.points / t.coef : 0)
  }
  return moyennes
}
