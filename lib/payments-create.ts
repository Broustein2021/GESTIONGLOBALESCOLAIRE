'use client'

import { createClient } from '@/lib/supabase/client'

export type CreerPaiementInput = {
  schoolId: string
  academicYearId: string
  studentId: string
  feeCategoryId: string | null
  amount: number
  date: string
  method: string
  reference?: string
  motif?: string
}

export type PaiementEnregistre = {
  paymentId: string
  numeroRecu: string
  studentId: string
  eleveNom: string
  matricule: string
  classeNom: string | null
  montant: number
  date: string
  mode: string
  motif: string | null
  reference: string | null
  enregistrePar: string | null
  soldeRestant: number
}

export type ResultatPaiement =
  | { ok: true; paiement: PaiementEnregistre }
  | { ok: false; message: string }

const RLS =
  /row-level security|violates row level security|permission denied|new row violates/i

function messageErreur(erreur: unknown, contexte: string): string {
  const raw = (erreur as { message?: string } | null)?.message ?? ''
  const msg = /montant_superieur_solde/.test(raw)
    ? 'Le montant ne peut pas dépasser le solde restant.'
    : raw
  if (RLS.test(msg)) {
    return `${contexte} : action non autorisée pour votre rôle (les paiements sont réservés à la caisse / direction).`
  }
  return msg ? `${contexte} : ${msg}` : `Échec de l'enregistrement (${contexte.toLowerCase()}).`
}

/**
 * Enregistre un encaissement + émet le reçu dans une seule transaction
 * côté serveur (RPC SECURITY DEFINER) : le montant est plafonné au solde
 * et le rôle est vérifié côté base. `recorded_by` est résolu par la RPC.
 */
export async function enregistrerPaiement(
  input: CreerPaiementInput,
): Promise<ResultatPaiement> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, message: 'Votre session a expiré. Reconnectez-vous.' }
  }

  // Situation réelle de l'élève (montant dû / déjà payé) pour le libellé du reçu
  const { data: enrollment } = await supabase
    .from('enrollments')
    .select(
      'amount_due, amount_paid, students:student_id ( id, first_name, last_name, matricule ), classes:class_id ( name )',
    )
    .eq('school_id', input.schoolId)
    .eq('academic_year_id', input.academicYearId)
    .eq('student_id', input.studentId)
    .eq('status', 'validee')
    .maybeSingle()

  if (!enrollment) {
    return { ok: false, message: 'Élève introuvable dans l’année scolaire courante.' }
  }

  const student = Array.isArray(enrollment.students) ? enrollment.students[0] : enrollment.students
  const classe = Array.isArray(enrollment.classes) ? enrollment.classes[0] : enrollment.classes

  const { data: result, error } = await supabase.rpc('create_payment_with_receipt', {
    p_school_id: input.schoolId,
    p_academic_year_id: input.academicYearId,
    p_student_id: input.studentId,
    p_fee_category_id: input.feeCategoryId ?? null,
    p_amount: input.amount,
    p_paid_on: input.date?.trim() || null,
    p_method: input.method,
    p_reference: input.reference?.trim() || null,
    p_motif: input.motif?.trim() || null,
  })

  if (error || !result?.payment_id) {
    return { ok: false, message: messageErreur(error ?? new Error('Réponse vide'), 'Enregistrement du paiement') }
  }

  const paymentId = result.payment_id as string
  const numeroRecu = (result.receipt_number as string) ?? '—'
  const soldeRestant = Number(result.balance_after) || 0

  return {
    ok: true,
    paiement: {
      paymentId,
      numeroRecu,
      studentId: input.studentId,
      eleveNom: `${student?.last_name ?? ''} ${student?.first_name ?? ''}`.trim(),
      matricule: student?.matricule ?? '',
      classeNom: classe?.name ?? null,
      montant: input.amount,
      date: input.date,
      mode: input.method,
      motif: input.motif?.trim() || null,
      reference: input.reference?.trim() || null,
      enregistrePar: 'Vous',
      soldeRestant,
    },
  }
}