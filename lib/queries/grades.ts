import { createClient } from '@/lib/supabase/server'
import { getCurrentSchoolContext } from '@/lib/queries/school-context'
import { getClasses } from '@/lib/queries/classes'
import { getEnseignantsData } from '@/lib/queries/enseignants'
import type { EtablissementInfo } from '@/lib/queries/finances'
import {
  appreciationNote,
  statutEvaluationLabel,
  typesEvaluation,
  type StatutEvaluation,
} from '@/lib/grades-meta'

export type { StatutEvaluation }
export { appreciationNote, statutEvaluationLabel, typesEvaluation }

export type Evaluation = {
  id: string
  libelle: string
  type: string
  classeId: string | null
  classeNom: string | null
  matiereId: string | null
  matiereNom: string | null
  enseignantNom: string | null
  periode: string | null
  date: string | null
  bareme: number
  coefficient: number
  statut: StatutEvaluation
}

export type TermeOption = {
  id: string
  label: string
  sequenceNo: number
  estCourant: boolean
}

export type MatiereRef = { id: string; nom: string; code: string; coefficient: number }

export type EnseignantRef = { id: string; nom: string; prenoms: string }

export type EvaluationOptions = {
  schoolId: string
  academicYearId: string
  anneeLabel: string
  classes: { id: string; nom: string; cycle: string }[]
  matieres: MatiereRef[]
  enseignants: EnseignantRef[]
  termes: TermeOption[]
  etablissement: EtablissementInfo
}

function premierAttribut<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? v[0] ?? null : v
}

/**
 * Données de référence du module Notes / Évaluations / Bulletins :
 * classes, matières, enseignants, périodes (trimestres) réelles.
 */
export async function getEvaluationOptions(): Promise<EvaluationOptions | null> {
  const ctx = await getCurrentSchoolContext()
  if (!ctx) return null

  const supabase = await createClient()
  const classes = await getClasses()
  const { enseignants } = await getEnseignantsData()

  const { data: subjectRows } = await supabase
    .from('subjects')
    .select('id, code, name, coefficient')
    .eq('school_id', ctx.schoolId)
    .eq('is_active', true)
    .order('name', { ascending: true })

  const { data: termRows } = await supabase
    .from('terms')
    .select('id, label, sequence_no, is_current')
    .eq('school_id', ctx.schoolId)
    .eq('academic_year_id', ctx.academicYearId)
    .order('sequence_no', { ascending: true })

  const { data: schoolRow } = await supabase
    .from('schools')
    .select('name, address, city, commune, phone, email')
    .eq('id', ctx.schoolId)
    .maybeSingle()

  const { data: orgRows } = await supabase
    .from('schools')
    .select('organizations:organization_id ( name )')
    .eq('id', ctx.schoolId)
    .maybeSingle()

  const { data: yearRow } = await supabase
    .from('academic_years')
    .select('label')
    .eq('school_id', ctx.schoolId)
    .eq('id', ctx.academicYearId)
    .maybeSingle()

  const organisation = (() => {
    const o = Array.isArray(orgRows?.organizations)
      ? orgRows?.organizations[0]
      : orgRows?.organizations
    return o?.name ?? ''
  })()

  return {
    schoolId: ctx.schoolId,
    academicYearId: ctx.academicYearId,
    anneeLabel: yearRow?.label ?? '',
    classes: classes.map((c) => ({ id: c.id, nom: c.nom, cycle: c.cycle })),
    matieres: (subjectRows ?? []).map((s) => ({
      id: s.id,
      nom: s.name,
      code: s.code,
      coefficient: Number(s.coefficient) || 1,
    })),
    enseignants: enseignants.map((t) => ({ id: t.id, nom: t.nom, prenoms: t.prenoms })),
    termes: (termRows ?? []).map((t) => ({
      id: t.id,
      label: t.label,
      sequenceNo: t.sequence_no ?? 0,
      estCourant: t.is_current ?? false,
    })),
    etablissement: {
      organisation,
      nom: schoolRow?.name ?? '',
      commune: schoolRow?.commune ?? '',
      ville: schoolRow?.city ?? '',
      telephone: schoolRow?.phone ?? '',
      email: schoolRow?.email ?? '',
    },
  }
}

/** Évaluations réelles de l'année scolaire courante. */
export async function getEvaluations(): Promise<Evaluation[]> {
  const ctx = await getCurrentSchoolContext()
  if (!ctx) return []

  const supabase = await createClient()

  const { data: rows } = await supabase
    .from('assessments')
    .select(
      `
      id, title, assessment_type, assessed_on, max_score, coefficient, status,
      classes:class_id ( id, name ),
      subjects:subject_id ( id, name ),
      teachers:teacher_id ( first_name, last_name ),
      terms:term_id ( label )
    `,
    )
    .eq('school_id', ctx.schoolId)
    .eq('academic_year_id', ctx.academicYearId)
    .order('assessed_on', { ascending: false })

  return (rows ?? []).map((r) => {
    const classe = premierAttribut(r.classes)
    const subject = premierAttribut(r.subjects)
    const teacher = premierAttribut(r.teachers)
    const term = premierAttribut(r.terms)
    return {
      id: r.id,
      libelle: r.title,
      type: r.assessment_type,
      classeId: classe?.id ?? null,
      classeNom: classe?.name ?? null,
      matiereId: subject?.id ?? null,
      matiereNom: subject?.name ?? null,
      enseignantNom: teacher ? `${teacher.first_name} ${teacher.last_name}` : null,
      periode: term?.label ?? null,
      date: r.assessed_on,
      bareme: Number(r.max_score) || 20,
      coefficient: Number(r.coefficient) || 1,
      statut: r.status,
    }
  })
}

export type EleveNoteInscription = {
  studentId: string
  nom: string
  prenoms: string
  matricule: string
  note: number | null
  absent: boolean
}

export type SaisieData = {
  evaluation: {
    id: string
    libelle: string
    classeNom: string | null
    matiereNom: string | null
    enseignantNom: string | null
    date: string | null
    bareme: number
    coefficient: number
    statut: StatutEvaluation
  }
  eleves: EleveNoteInscription[]
}

/**
 * Élèves de la classe + notes déjà saisies pour une évaluation donnée.
 * Retourne null si l'évaluation n'appartient pas à l'école / l'année.
 */
export async function getSaisieData(evaluationId: string): Promise<SaisieData | null> {
  const ctx = await getCurrentSchoolContext()
  if (!ctx) return null

  const supabase = await createClient()

  const { data: assessment } = await supabase
    .from('assessments')
    .select(
      `
      id, title, assessed_on, max_score, coefficient, status,
      class_id,
      classes:class_id ( name ),
      subjects:subject_id ( name ),
      teachers:teacher_id ( first_name, last_name )
    `,
    )
    .eq('id', evaluationId)
    .eq('school_id', ctx.schoolId)
    .eq('academic_year_id', ctx.academicYearId)
    .maybeSingle()

  if (!assessment) return null

  const classe = premierAttribut(assessment.classes)
  const subject = premierAttribut(assessment.subjects)
  const teacher = premierAttribut(assessment.teachers)

  const { data: enrollmentRows } = await supabase
    .from('enrollments')
    .select('students:student_id ( id, first_name, last_name, matricule )')
    .eq('school_id', ctx.schoolId)
    .eq('academic_year_id', ctx.academicYearId)
    .eq('class_id', assessment.class_id)
    .eq('status', 'validee')

  const { data: gradeRows } = await supabase
    .from('grades')
    .select('student_id, score, is_absent')
    .eq('school_id', ctx.schoolId)
    .eq('assessment_id', evaluationId)

  const gradesParEleve = new Map<string, { note: number | null; absent: boolean }>()
  for (const g of gradeRows ?? []) {
    gradesParEleve.set(g.student_id, {
      note: g.score === null ? null : Number(g.score),
      absent: g.is_absent ?? false,
    })
  }

  const eleves: EleveNoteInscription[] = (enrollmentRows ?? [])
    .map((r) => {
      const s = premierAttribut(r.students)
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
    .filter((e): e is EleveNoteInscription => e !== null)

  return {
    evaluation: {
      id: assessment.id,
      libelle: assessment.title,
      classeNom: classe?.name ?? null,
      matiereNom: subject?.name ?? null,
      enseignantNom: teacher ? `${teacher.first_name} ${teacher.last_name}` : null,
      date: assessment.assessed_on,
      bareme: Number(assessment.max_score) || 20,
      coefficient: Number(assessment.coefficient) || 1,
      statut: assessment.status,
    },
    eleves,
  }
}

export type BulletinLigne = {
  matiere: string
  note: number
  coefficient: number
  points: number
  appreciation: string
  enseignant: string | null
}

export type BulletinData = {
  eleve: { nom: string; prenoms: string; matricule: string }
  classeNom: string | null
  periodeLabel: string | null
  lignes: BulletinLigne[]
  totalCoef: number
  totalPoints: number
  moyenneGenerale: number
  appreciationGenerale: string
  rang: number
  effectif: number
  montantDu: number
  montantPaye: number
  etablissement: EtablissementInfo
}

export type BulletinRow = {
  studentId: string
  nom: string
  prenoms: string
  matricule: string
  moyenne: number
  rang: number
  bulletin: BulletinData | null
}

/**
 * Bulletins réels d'une classe pour une période : moyennes pondérées par
 * matière et générale (notes ramenées sur 20), rangs, effectif.
 */
export async function getBulletins(
  classId: string,
  termId: string | null,
  etablissement: EtablissementInfo,
): Promise<{ rows: BulletinRow[]; periodeLabel: string | null }> {
  const ctx = await getCurrentSchoolContext()
  if (!ctx) return { rows: [], periodeLabel: null }

  const supabase = await createClient()

  const [{ data: termRow }, { data: enrollmentRows }, { data: assessmentRows }, { data: gradeRows }] =
    await Promise.all([
      termId
        ? supabase
            .from('terms')
            .select('label')
            .eq('school_id', ctx.schoolId)
            .eq('id', termId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('enrollments')
        .select(
          `
          amount_due, amount_paid,
          classes:class_id ( name ),
          students:student_id ( id, first_name, last_name, matricule )
        `,
        )
        .eq('school_id', ctx.schoolId)
        .eq('academic_year_id', ctx.academicYearId)
        .eq('class_id', classId)
        .eq('status', 'validee'),
      supabase
        .from('assessments')
        .select('id, subject_id, teacher_id, max_score, coefficient')
        .eq('school_id', ctx.schoolId)
        .eq('academic_year_id', ctx.academicYearId)
        .eq('class_id', classId)
        .eq('term_id', termId ?? '')
        .in('status', ['validee']),
      supabase
        .from('grades')
        .select('assessment_id, student_id, score, assessments:assessment_id ( coefficient, max_score )')
        .eq('school_id', ctx.schoolId),
    ])

  const periodesValidees = assessmentRows?.length ?? 0
  if (periodesValidees === 0) return { rows: [], periodeLabel: termRow?.label ?? null }

  const assessmentIds = new Set(assessmentRows!.map((a) => a.id))

  const sujetParAssessment = new Map<string, string>()
  const enseignantParAssessment = new Map<string, string | null>()
  for (const a of assessmentRows ?? []) {
    sujetParAssessment.set(a.id, a.subject_id)
    enseignantParAssessment.set(a.id, a.teacher_id ?? null)
  }

  // Notes de la classe, filtrées sur les évaluations de la période
  const scores: { assessmentId: string; studentId: string; score20: number; coef: number }[] = []
  for (const g of gradeRows ?? []) {
    if (!assessmentIds.has(g.assessment_id)) continue
    if (g.score === null) continue
    const assessment = premierAttribut(g.assessments)
    const coef = Number(assessment?.coefficient) || 1
    const max = Number(assessment?.max_score) || 20
    scores.push({
      assessmentId: g.assessment_id,
      studentId: g.student_id,
      score20: max > 0 ? (Number(g.score) / max) * 20 : 0,
      coef,
    })
  }

  const students = (enrollmentRows ?? [])
    .map((r) => {
      const s = premierAttribut(r.students)
      const c = premierAttribut(r.classes)
      return {
        id: s?.id ?? '',
        nom: s?.last_name ?? '',
        prenoms: s?.first_name ?? '',
        matricule: s?.matricule ?? '',
        classeNom: c?.name ?? null,
        montantDu: Number(r.amount_due) || 0,
        montantPaye: Number(r.amount_paid) || 0,
      }
    })
    .filter((s) => s.id !== '')

  const moyennes = new Map<string, number>()
  for (const stu of students) {
    const notes = scores.filter((s) => s.studentId === stu.id)
    const totalCoef = notes.reduce((s, n) => s + n.coef, 0)
    moyennes.set(
      stu.id,
      totalCoef > 0 ? notes.reduce((s, n) => s + n.score20 * n.coef, 0) / totalCoef : 0,
    )
  }

  const parClassement = [...students].sort(
    (a, b) => (moyennes.get(b.id) ?? 0) - (moyennes.get(a.id) ?? 0),
  )
  const rang = new Map<string, number>()
  parClassement.forEach((s, i) => rang.set(s.id, i + 1))

  const effectif = students.length

  // Noms des matières utilisées (une seule requête)
  const sujetsUtilises = new Set<string>()
  for (const a of assessmentRows ?? []) {
    if (a.subject_id) sujetsUtilises.add(a.subject_id)
  }
  const nomParMatiere = new Map<string, string>()
  if (sujetsUtilises.size > 0) {
    const { data: matiereRows } = await supabase
      .from('subjects')
      .select('id, name')
      .eq('school_id', ctx.schoolId)
      .in('id', Array.from(sujetsUtilises))
    for (const m of matiereRows ?? []) nomParMatiere.set(m.id, m.name)
  }

  // Noms des enseignants utilisés (une seule requête)
  const enseignantsUtilises = new Set<string>()
  for (const a of assessmentRows ?? []) {
    if (a.teacher_id) enseignantsUtilises.add(a.teacher_id)
  }
  const nomParEnseignant = new Map<string, string>()
  if (enseignantsUtilises.size > 0) {
    const { data: enseignantRows } = await supabase
      .from('teachers')
      .select('id, first_name, last_name')
      .eq('school_id', ctx.schoolId)
      .in('id', Array.from(enseignantsUtilises))
    for (const t of enseignantRows ?? []) {
      nomParEnseignant.set(
        t.id,
        [t.first_name, t.last_name].filter(Boolean).join(' ').trim() ||
          '—',
      )
    }
  }

  // Bulletins détaillés (par matière), calculés en mémoire
  const results: BulletinRow[] = students.map((stu) => {
    const moyenne = moyennes.get(stu.id) ?? 0

    const parMatiere = new Map<
      string,
      { points20: number; coef: number; enseignant: string | null }
    >()
    for (const s of scores) {
      if (s.studentId !== stu.id) continue
      const sujetId = sujetParAssessment.get(s.assessmentId)
      if (!sujetId) continue
      const acc = parMatiere.get(sujetId) ?? { points20: 0, coef: 0, enseignant: null }
      acc.points20 += s.score20 * s.coef
      acc.coef += s.coef
      acc.enseignant = acc.enseignant ?? enseignantParAssessment.get(s.assessmentId) ?? null
      parMatiere.set(sujetId, acc)
    }

    const lignes: BulletinLigne[] = Array.from(parMatiere.entries())
      .map(([sujetId, acc]) => {
        const note = acc.coef > 0 ? acc.points20 / acc.coef : 0
        return {
          matiere: nomParMatiere.get(sujetId) ?? '—',
          note,
          coefficient: acc.coef,
          points: note * acc.coef,
          appreciation: appreciationNote(note),
          enseignant: nomParEnseignant.get(acc.enseignant ?? '') ?? '—',
        }
      })
      .filter((l) => l.matiere !== '—')

    const totalCoef = lignes.reduce((s, l) => s + l.coefficient, 0)
    const totalPoints = lignes.reduce((s, l) => s + l.points, 0)

    const bulletin: BulletinData = {
      eleve: { nom: stu.nom, prenoms: stu.prenoms, matricule: stu.matricule },
      classeNom: stu.classeNom,
      periodeLabel: termRow?.label ?? null,
      lignes,
      totalCoef,
      totalPoints,
      moyenneGenerale: moyenne,
      appreciationGenerale: appreciationNote(moyenne),
      rang: rang.get(stu.id) ?? effectif,
      effectif,
      montantDu: stu.montantDu,
      montantPaye: stu.montantPaye,
      etablissement,
    }

    return {
      studentId: stu.id,
      nom: stu.nom,
      prenoms: stu.prenoms,
      matricule: stu.matricule,
      moyenne,
      rang: rang.get(stu.id) ?? effectif,
      bulletin,
    }
  })

  return { rows: results, periodeLabel: termRow?.label ?? null }
}