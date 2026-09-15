'use client'

import { createClient } from '@/lib/supabase/client'

export type CreerEvaluationInput = {
  schoolId: string
  academicYearId: string
  termId: string
  classId: string
  subjectId: string
  teacherId: string | null
  title: string
  type: string
  date: string
  bareme: number
  coefficient: number
}

export type ResultatEvaluation =
  | { ok: true; evaluationId: string }
  | { ok: false; message: string }

export type EleveNote = {
  studentId: string
  nom: string
  prenoms: string
  matricule: string
  note: number | null
  absent: boolean
}

export type SaisieNotesData = {
  evaluation: {
    id: string
    libelle: string
    bareme: number
    coefficient: number
    statut: string
  }
  eleves: EleveNote[]
}

export type ResultatNotes =
  | { ok: true; message: string }
  | { ok: false; message: string }

const RLS =
  /row-level security|violates row level security|permission denied|new row violates/i

function messageErreur(erreur: unknown, contexte: string): string {
  const msg = (erreur as { message?: string } | null)?.message ?? ''
  if (RLS.test(msg)) {
    return `${contexte} : action non autorisée pour votre rôle (réservé aux enseignants et à la direction).`
  }
  return msg ? `${contexte} : ${msg}` : `Échec de l'opération (${contexte.toLowerCase()}).`
}

export async function creerEvaluation(
  input: CreerEvaluationInput,
): Promise<ResultatEvaluation> {
  const supabase = createClient()

  const title = input.title.trim()
  if (!title) return { ok: false, message: 'Le titre est obligatoire.' }
  if (!input.termId || !input.classId || !input.subjectId) {
    return { ok: false, message: 'Veuillez choisir la période, la classe et la matière.' }
  }

  const { data, error } = await supabase
    .from('assessments')
    .insert({
      school_id: input.schoolId,
      academic_year_id: input.academicYearId,
      term_id: input.termId,
      class_id: input.classId,
      subject_id: input.subjectId,
      teacher_id: input.teacherId || null,
      title,
      assessment_type: input.type,
      assessed_on: input.date?.trim() || undefined,
      max_score: input.bareme,
      coefficient: input.coefficient,
      status: 'planifiee',
    })
    .select('id')
    .single()

  if (error || !data) {
    return { ok: false, message: messageErreur(error, 'Création de l’évaluation') }
  }

  return { ok: true, evaluationId: data.id }
}

/**
 * Charge côté client les élèves de la classe et les notes déjà saisies
 * pour une évaluation (lecture RLS autorisée pour l'établissement).
 */
export async function chargerNotes(evaluationId: string): Promise<SaisieNotesData | null> {
  const supabase = createClient()

  const { data: assessment } = await supabase
    .from('assessments')
    .select('id, title, class_id, max_score, coefficient, status')
    .eq('id', evaluationId)
    .maybeSingle()

  if (!assessment || !assessment.class_id) return null

  const [{ data: enrollmentRows }, { data: gradeRows }] = await Promise.all([
    supabase
      .from('enrollments')
      .select('students:student_id ( id, first_name, last_name, matricule )')
      .eq('class_id', assessment.class_id)
      .eq('status', 'validee'),
    supabase
      .from('grades')
      .select('student_id, score, is_absent')
      .eq('assessment_id', evaluationId),
  ])

  const gradesParEleve = new Map<string, { note: number | null; absent: boolean }>()
  for (const g of gradeRows ?? []) {
    gradesParEleve.set(g.student_id, {
      note: g.score === null ? null : Number(g.score),
      absent: g.is_absent ?? false,
    })
  }

  const eleves: EleveNote[] = (enrollmentRows ?? [])
    .map((r) => {
      const s = Array.isArray(r.students) ? r.students[0] : r.students
      if (!s) return null
      const note = gradesParEleve.get(s.id)
      return {
        studentId: s.id,
        nom: s.last_name,
        prenoms: s.first_name,
        matricule: s.matricule,
        note: note?.note ?? null,
        absent: note?.absent ?? false,
      }
    })
    .filter((e): e is EleveNote => e !== null)

  return {
    evaluation: {
      id: assessment.id,
      libelle: assessment.title,
      bareme: Number(assessment.max_score) || 20,
      coefficient: Number(assessment.coefficient) || 1,
      statut: assessment.status,
    },
    eleves,
  }
}

/**
 * Sauvegarde la feuille de notes : écrase les notes existantes de
 * l'évaluation puis met à jour son statut (saisie / validée).
 * `valider` = true → statut "validee" (blocage → verrouillé).
 */
export async function sauvegarderNotes(
  evaluationId: string,
  rows: { studentId: string; note: number | null; absent: boolean }[],
  valider: boolean,
): Promise<ResultatNotes> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, message: 'Votre session a expiré. Reconnectez-vous.' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: assessment } = await supabase
    .from('assessments')
    .select('school_id, max_score')
    .eq('id', evaluationId)
    .maybeSingle()

  if (!assessment) {
    return { ok: false, message: 'Évaluation introuvable.' }
  }

  const { data: existingRows } = await supabase
    .from('grades')
    .select('id, student_id')
    .eq('assessment_id', evaluationId)

  const existingParEleve = new Map<string, string>()
  for (const g of existingRows ?? []) existingParEleve.set(g.student_id, g.id)

  const bareme = Number(assessment.max_score) || 20
  const entrees: { evaluationId: string; studentId: string; note: number | null; absent: boolean }[] = []

  for (const row of rows) {
    if (row.absent) {
      entrees.push({ evaluationId, studentId: row.studentId, note: null, absent: true })
      continue
    }
    if (row.note === null || row.note === undefined) {
      if (existingParEleve.has(row.studentId)) {
        const { error } = await supabase
          .from('grades')
          .delete()
          .eq('id', existingParEleve.get(row.studentId)!)
        if (error) return { ok: false, message: messageErreur(error, 'Suppression d’une note') }
      }
      continue
    }
    const note = Math.max(0, Math.min(bareme, Number(row.note)))
    entrees.push({ evaluationId, studentId: row.studentId, note, absent: false })
  }

  for (const entree of entrees) {
    const existingId = existingParEleve.get(entree.studentId)
    const payload = {
      school_id: assessment.school_id,
      assessment_id: entree.evaluationId,
      student_id: entree.studentId,
      score: entree.note,
      is_absent: entree.absent,
      entered_by: profile?.id ?? null,
    }
    if (existingId) {
      const { error } = await supabase.from('grades').update(payload).eq('id', existingId)
      if (error) return { ok: false, message: messageErreur(error, 'Enregistrement des notes') }
    } else {
      const { error } = await supabase.from('grades').insert(payload)
      if (error) return { ok: false, message: messageErreur(error, 'Enregistrement des notes') }
    }
  }

  if (valider) {
    const { error: errValidation } = await supabase.rpc('valider_feuille_notes', {
      p_assessment_id: evaluationId,
    })
    if (errValidation) {
      return { ok: false, message: messageErreur(errValidation, 'Validation des notes') }
    }
  } else {
    const { error: errStatut } = await supabase
      .from('assessments')
      .update({ status: 'saisie' })
      .eq('id', evaluationId)
    if (errStatut) {
      return { ok: false, message: messageErreur(errStatut, 'Mise à jour du statut') }
    }
  }

  return {
    ok: true,
    message: valider
      ? 'Notes validées et feuille verrouillée.'
      : 'Brouillon enregistré (les notes restent modifiables).',
  }
}