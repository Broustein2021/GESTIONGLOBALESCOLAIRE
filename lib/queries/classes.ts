import { createClient } from '@/lib/supabase/server'
import { getCurrentSchoolContext } from '@/lib/queries/school-context'
import { getMoyennesParEleve } from '@/lib/queries/grades-helper'

export type Classe = {
  id: string
  nom: string
  niveau: string
  cycle: 'Primaire' | 'Collège' | 'Lycée'
  effectif: number
  capacite: number
  profPrincipalId: string | null
  profPrincipalNom: string | null
  salle: string
}

export const cycles = ['Primaire', 'Collège', 'Lycée'] as const

/**
 * Remplace l'import `classes` de lib/data.ts par des données réelles,
 * scopées sur l'école et l'année scolaire courante de l'utilisateur.
 * Même forme de sortie que le mock -> aucun changement dans les
 * composants qui consomment `nom`, `niveau`, `effectif`, etc.
 */
export async function getClasses(): Promise<Classe[]> {
  const ctx = await getCurrentSchoolContext()
  if (!ctx) return []

  const supabase = await createClient()

  const { data: rows, error } = await supabase
    .from('classes')
    .select(
      `
      id,
      name,
      level_label,
      cycle,
      capacity,
      room,
      levels ( sequence_no ),
      teachers:head_teacher_id ( id, first_name, last_name )
    `,
    )
    .eq('school_id', ctx.schoolId)
    .eq('academic_year_id', ctx.academicYearId)

  if (error || !rows) {
    console.error('[getClasses] erreur Supabase :', error)
    return []
  }

  // Effectif réel = nombre d'inscriptions validées par classe, sur l'année en cours
  const { data: enrollmentCounts } = await supabase
    .from('enrollments')
    .select('class_id')
    .eq('school_id', ctx.schoolId)
    .eq('academic_year_id', ctx.academicYearId)
    .eq('status', 'validee')

  const effectifParClasse = new Map<string, number>()
  for (const e of enrollmentCounts ?? []) {
    if (!e.class_id) continue
    effectifParClasse.set(e.class_id, (effectifParClasse.get(e.class_id) ?? 0) + 1)
  }

  const classes: Classe[] = rows.map((row) => {
    const prof = Array.isArray(row.teachers) ? row.teachers[0] : row.teachers
    return {
      id: row.id,
      nom: row.name,
      niveau: row.level_label,
      cycle: row.cycle,
      effectif: effectifParClasse.get(row.id) ?? 0,
      capacite: row.capacity,
      profPrincipalId: prof?.id ?? null,
      profPrincipalNom: prof ? `${prof.first_name} ${prof.last_name}` : null,
      salle: row.room ?? '—',
    }
  })

  // Tri par niveau (ordre pédagogique réel via levels.sequence_no)
  const seqParClasse = new Map<string, number>()
  rows.forEach((row) => {
    const level = Array.isArray(row.levels) ? row.levels[0] : row.levels
    seqParClasse.set(row.id, level?.sequence_no ?? 999)
  })
  classes.sort((a, b) => (seqParClasse.get(a.id) ?? 999) - (seqParClasse.get(b.id) ?? 999))

  return classes
}

/** Liste des niveaux réellement présents, dans l'ordre pédagogique. */
export function getNiveaux(classes: Classe[]): string[] {
  return Array.from(new Set(classes.map((c) => c.niveau)))
}

export type ClasseEleve = {
  id: string
  nom: string
  prenoms: string
  matricule: string
  moyenne: number
  statutPaiement: 'a_jour' | 'partiel' | 'retard'
}

export type ClasseMatiere = {
  id: string
  nom: string
  code: string
  coefficient: number
  enseignants: string
}

export type ClasseEvaluation = {
  id: string
  libelle: string
  matiereNom: string
  date: string
  bareme: number
}

export type ClassDetail = {
  id: string
  nom: string
  niveau: string
  cycle: 'Primaire' | 'Collège' | 'Lycée'
  effectif: number
  capacite: number
  salle: string
  profPrincipalNom: string | null
  eleves: ClasseEleve[]
  matieres: ClasseMatiere[]
  evaluations: ClasseEvaluation[]
}

/**
 * Fiche complète d'une classe (page /classes/[id]).
 * Retourne null si la classe n'existe pas ou n'appartient pas à
 * l'école/l'année scolaire courante de l'utilisateur (RLS + scope).
 */
export async function getClassDetail(classId: string): Promise<ClassDetail | null> {
  const ctx = await getCurrentSchoolContext()
  if (!ctx) return null

  const supabase = await createClient()

  const { data: classe, error: classeError } = await supabase
    .from('classes')
    .select(
      `
      id, name, level_label, cycle, capacity, room,
      teachers:head_teacher_id ( id, first_name, last_name )
    `,
    )
    .eq('id', classId)
    .eq('school_id', ctx.schoolId)
    .eq('academic_year_id', ctx.academicYearId)
    .maybeSingle()

  if (classeError || !classe) return null

  const prof = Array.isArray(classe.teachers) ? classe.teachers[0] : classe.teachers

  // Élèves inscrits dans cette classe, avec leur statut de paiement réel
  const { data: enrollmentRows } = await supabase
    .from('enrollments')
    .select(
      `
      payment_status,
      students:student_id ( id, first_name, last_name, matricule )
    `,
    )
    .eq('class_id', classId)
    .eq('academic_year_id', ctx.academicYearId)
    .eq('status', 'validee')

  const studentIds = ((enrollmentRows ?? []) as unknown as Array<{
      students: { id: string } | Array<{ id: string }> | null
    }>)
    .map((r) => (Array.isArray(r.students) ? r.students[0]?.id : r.students?.id))
    .filter((id): id is string => Boolean(id))

  // Moyenne pondérée /20 par élève
  const moyennesParEleve = studentIds.length > 0
    ? await getMoyennesParEleve(supabase, ctx.schoolId, studentIds)
    : new Map<string, number>()

  const eleves: ClasseEleve[] = (enrollmentRows ?? []).map((r) => {
    const s = Array.isArray(r.students) ? r.students[0] : r.students
    return {
      id: s?.id ?? '',
      nom: s?.last_name ?? '',
      prenoms: s?.first_name ?? '',
      matricule: s?.matricule ?? '',
      moyenne: moyennesParEleve.get(s?.id ?? '') ?? 0,
      statutPaiement: r.payment_status,
    }
  })

  // Matières du cycle + enseignants réellement affectés à CETTE classe
  const { data: subjectRows } = await supabase
    .from('subjects')
    .select('id, name, code, coefficient')
    .eq('school_id', ctx.schoolId)
    .eq('cycle', classe.cycle)
    .eq('is_active', true)

  const { data: assignmentRows } = await supabase
    .from('teacher_assignments')
    .select('subject_id, teachers:teacher_id ( first_name, last_name )')
    .eq('class_id', classId)
    .eq('academic_year_id', ctx.academicYearId)

  const enseignantsParMatiere = new Map<string, string[]>()
  for (const a of assignmentRows ?? []) {
    const t = Array.isArray(a.teachers) ? a.teachers[0] : a.teachers
    if (!t) continue
    const noms = enseignantsParMatiere.get(a.subject_id) ?? []
    noms.push(`${t.first_name} ${t.last_name}`)
    enseignantsParMatiere.set(a.subject_id, noms)
  }

  const matieres: ClasseMatiere[] = (subjectRows ?? []).map((m) => ({
    id: m.id,
    nom: m.name,
    code: m.code,
    coefficient: Number(m.coefficient),
    enseignants: (enseignantsParMatiere.get(m.id) ?? []).join(', ') || 'Non affecté',
  }))

  // Évaluations de la classe
  const { data: assessmentRows } = await supabase
    .from('assessments')
    .select('id, title, assessed_on, max_score, subjects:subject_id ( name )')
    .eq('class_id', classId)
    .eq('academic_year_id', ctx.academicYearId)
    .order('assessed_on', { ascending: false })

  const evaluations: ClasseEvaluation[] = (assessmentRows ?? []).map((ev) => {
    const subject = Array.isArray(ev.subjects) ? ev.subjects[0] : ev.subjects
    return {
      id: ev.id,
      libelle: ev.title,
      matiereNom: subject?.name ?? '—',
      date: ev.assessed_on ?? '',
      bareme: Number(ev.max_score),
    }
  })

  const effectif = eleves.length

  return {
    id: classe.id,
    nom: classe.name,
    niveau: classe.level_label,
    cycle: classe.cycle,
    effectif,
    capacite: classe.capacity,
    salle: classe.room ?? '—',
    profPrincipalNom: prof ? `${prof.first_name} ${prof.last_name}` : null,
    eleves,
    matieres,
    evaluations,
  }
}
