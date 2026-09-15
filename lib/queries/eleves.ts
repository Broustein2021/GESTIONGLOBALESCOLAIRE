import { createClient } from '@/lib/supabase/server'
import { getCurrentSchoolContext } from '@/lib/queries/school-context'
import { getMoyennesParEleve } from '@/lib/queries/grades-helper'
import type { StatutPaiement } from '@/lib/data'

export type Eleve = {
  id: string
  nom: string
  prenoms: string
  matricule: string
  sexe: 'M' | 'F'
  nationalite: string
  classeNom: string | null
  classeId: string | null
  niveau: string | null
  moyenne: number
  statutPaiement: StatutPaiement
  statut: 'inscrit' | 'nouveau' | 'archive' | 'radie' | 'transfere'
}

/**
 * Remplace l'import `eleves` de lib/data.ts. Liste les élèves réellement
 * inscrits (enrollment validée) pour l'école et l'année scolaire courante.
 */
export async function getEleves(): Promise<Eleve[]> {
  const ctx = await getCurrentSchoolContext()
  if (!ctx) return []

  const supabase = await createClient()

  const { data: rows, error } = await supabase
    .from('enrollments')
    .select(
      `
      payment_status,
      level_label,
      class_id,
      students:student_id ( id, first_name, last_name, matricule, gender, nationality, status ),
      classes:class_id ( name )
    `,
    )
    .eq('school_id', ctx.schoolId)
    .eq('academic_year_id', ctx.academicYearId)
    .eq('status', 'validee')

  if (error || !rows) {
    console.error('[getEleves] erreur Supabase :', error)
    return []
  }

  const studentIds = (rows as unknown as Array<{
    students: { id: string } | Array<{ id: string }> | null
  }>)
    .map((r) => (Array.isArray(r.students) ? r.students[0]?.id : r.students?.id))
    .filter((id): id is string => Boolean(id))

  const moyennes = await getMoyennesParEleve(supabase, ctx.schoolId, studentIds)

  return rows
    .map((r) => {
      const s = Array.isArray(r.students) ? r.students[0] : r.students
      const c = Array.isArray(r.classes) ? r.classes[0] : r.classes
      if (!s) return null
      return {
        id: s.id,
        nom: s.last_name,
        prenoms: s.first_name,
        matricule: s.matricule,
        sexe: s.gender,
        nationalite: s.nationality ?? '—',
        classeNom: c?.name ?? null,
        classeId: r.class_id ?? null,
        niveau: r.level_label,
        moyenne: moyennes.get(s.id) ?? 0,
        statutPaiement: r.payment_status,
        statut: s.status,
      } satisfies Eleve
    })
    .filter((e): e is Eleve => e !== null && e.statut !== 'archive')
}

export type EleveGuardian = {
  id: string
  nom: string
  prenoms: string
  lien: string
  profession: string | null
  telephone: string | null
  principal: boolean
}

export type ElevePaiement = {
  id: string
  recu: string | null
  date: string
  motif: string | null
  mode: string
  montant: number
}

export type EleveNote = {
  id: string
  matiere: string
  evaluation: string
  date: string | null
  note: number | null
  bareme: number
  coefficient: number
}

export type EleveDetail = {
  id: string
  schoolId: string
  nom: string
  prenoms: string
  matricule: string
  sexe: 'M' | 'F'
  nationalite: string
  dateNaissance: string | null
  lieuNaissance: string | null
  telephone: string | null
  adresse: string | null
  statut: string
  classeNom: string | null
  classeId: string | null
  niveau: string | null
  dateInscription: string | null
  montantDu: number
  montantPaye: number
  statutPaiement: StatutPaiement
  moyenne: number
  guardians: EleveGuardian[]
  paiements: ElevePaiement[]
  notes: EleveNote[]
}

/**
 * Fiche complète d'un élève (page /eleves/[id]).
 * Retourne null si l'élève n'existe pas ou n'appartient pas à l'école
 * de l'utilisateur connecté (RLS + scope explicite).
 */
export async function getEleveDetail(studentId: string): Promise<EleveDetail | null> {
  const ctx = await getCurrentSchoolContext()
  if (!ctx) return null

  const supabase = await createClient()

  const { data: student, error: studentError } = await supabase
    .from('students')
    .select(
      'id, first_name, last_name, matricule, gender, nationality, birth_date, birth_place, phone, address, status',
    )
    .eq('id', studentId)
    .eq('school_id', ctx.schoolId)
    .maybeSingle()

  if (studentError || !student) return null

  const [{ data: enrollment }, { data: guardianRows }, { data: paymentRows }, { data: gradeRows }] =
    await Promise.all([
      supabase
        .from('enrollments')
        .select('amount_due, amount_paid, payment_status, enrolled_on, level_label, class_id, classes:class_id ( name )')
        .eq('student_id', studentId)
        .eq('school_id', ctx.schoolId)
        .eq('academic_year_id', ctx.academicYearId)
        .eq('status', 'validee')
        .maybeSingle(),
      supabase
        .from('student_guardians')
        .select('relation, is_primary, guardians:guardian_id ( id, first_name, last_name, phone, profession )')
        .eq('student_id', studentId)
        .eq('school_id', ctx.schoolId),
      supabase
        .from('payments')
        .select('id, paid_on, motif, method, amount, receipts ( receipt_number )')
        .eq('student_id', studentId)
        .eq('school_id', ctx.schoolId)
        .order('paid_on', { ascending: false }),
      supabase
        .from('grades')
        .select(
          `
          id, score,
          assessments:assessment_id (
            title, max_score, coefficient, assessed_on,
            subjects:subject_id ( name )
          )
        `,
        )
        .eq('student_id', studentId)
        .eq('school_id', ctx.schoolId)
        .order('created_at', { ascending: false }),
    ])

  const classe = enrollment ? (Array.isArray(enrollment.classes) ? enrollment.classes[0] : enrollment.classes) : null

  const guardians: EleveGuardian[] = (guardianRows ?? []).map((r) => {
    const g = Array.isArray(r.guardians) ? r.guardians[0] : r.guardians
    return {
      id: g?.id ?? '',
      nom: g?.last_name ?? '',
      prenoms: g?.first_name ?? '',
      lien: r.relation,
      profession: g?.profession ?? null,
      telephone: g?.phone ?? null,
      principal: r.is_primary,
    }
  })

  const paiements: ElevePaiement[] = (paymentRows ?? []).map((p) => {
    const receipt = Array.isArray(p.receipts) ? p.receipts[0] : p.receipts
    return {
      id: p.id,
      recu: receipt?.receipt_number ?? null,
      date: p.paid_on,
      motif: p.motif,
      mode: p.method,
      montant: Number(p.amount),
    }
  })

  const notes: EleveNote[] = (gradeRows ?? []).map((g) => {
    const a = Array.isArray(g.assessments) ? g.assessments[0] : g.assessments
    const subject = a ? (Array.isArray(a.subjects) ? a.subjects[0] : a.subjects) : null
    return {
      id: g.id,
      matiere: subject?.name ?? '—',
      evaluation: a?.title ?? '—',
      date: a?.assessed_on ?? null,
      note: g.score === null ? null : Number(g.score),
      bareme: a ? Number(a.max_score) : 20,
      coefficient: a ? Number(a.coefficient) : 1,
    }
  })

  const noteesUniquement = notes.filter((n) => n.note !== null)
  const totalCoef = noteesUniquement.reduce((s, n) => s + n.coefficient, 0)
  const moyenne =
    totalCoef > 0
      ? noteesUniquement.reduce((s, n) => {
          const bareme = n.bareme || 20
          return s + ((n.note! / bareme) * 20 * n.coefficient)
        }, 0) / totalCoef
      : 0

  return {
    id: student.id,
    schoolId: ctx.schoolId,
    nom: student.last_name,
    prenoms: student.first_name,
    matricule: student.matricule,
    sexe: student.gender,
    nationalite: student.nationality ?? '—',
    dateNaissance: student.birth_date,
    lieuNaissance: student.birth_place,
    telephone: student.phone,
    adresse: student.address,
    statut: student.status,
    classeNom: classe?.name ?? null,
    classeId: enrollment?.class_id ?? null,
    niveau: enrollment?.level_label ?? null,
    dateInscription: enrollment?.enrolled_on ?? null,
    montantDu: enrollment ? Number(enrollment.amount_due) : 0,
    montantPaye: enrollment ? Number(enrollment.amount_paid) : 0,
    statutPaiement: enrollment?.payment_status ?? 'a_jour',
    moyenne,
    guardians,
    paiements,
    notes,
  }
}
