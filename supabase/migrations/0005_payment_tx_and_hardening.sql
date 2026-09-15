-- 0005 : durcissement P0-P1 —
--   1. RPC transactionnelle paiement + reçu (server-side balance_after, plafond).
--   2. Correction de la politique profiles_select_own (les profils admin ne sont
--      plus visibles par n'importe quel user).
--   3. Garde-fou serveur pour la validation d'une feuille de notes (fin du
--      contrôle uniquement côté client).
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. create_payment_with_receipt : encaisse et émet le reçu dans une seule
--    transaction. SECURITY DEFINER encre la garde de rôle côté serveur
--    (org_admin / directeur / comptable, ou plateforme) et interdit un montant
--    supérieur au solde restant. Le reçu hérite son numéro du trigger 0004.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_payment_with_receipt(
  p_school_id uuid,
  p_academic_year_id uuid,
  p_student_id uuid,
  p_fee_category_id uuid,
  p_amount numeric,
  p_paid_on date,
  p_method public.payment_method,
  p_reference text,
  p_motif text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_enrollment_id uuid;
  v_amount_due numeric;
  v_amount_paid numeric;
  v_new_paid numeric;
  v_balance_after numeric;
  v_paid_on date;
  v_payment_id uuid;
  v_receipt_number text;
  v_profile_id uuid;
BEGIN
  IF NOT (
    private.is_platform_admin()
    OR private.user_has_school_role(p_school_id, ARRAY['org_admin'::public.app_role, 'directeur'::public.app_role, 'comptable'::public.app_role])
  ) THEN
    RAISE EXCEPTION 'Action non autorisée pour votre rôle (réservé à la caisse / direction).';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Le montant doit être supérieur à zéro.';
  END IF;

  SELECT id, amount_due, amount_paid
    INTO v_enrollment_id, v_amount_due, v_amount_paid
    FROM public.enrollments
   WHERE school_id = p_school_id
     AND academic_year_id = p_academic_year_id
     AND student_id = p_student_id
     AND status = 'validee'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_enrollment_id IS NULL THEN
    RAISE EXCEPTION 'Élève introuvable dans l’année scolaire courante.';
  END IF;

  v_amount_due := coalesce(v_amount_due, 0);
  v_amount_paid := coalesce(v_amount_paid, 0);

  IF p_amount > v_amount_due - v_amount_paid THEN
    RAISE EXCEPTION 'montant_superieur_solde';
  END IF;

  v_paid_on := coalesce(p_paid_on, CURRENT_DATE);

  INSERT INTO public.payments (
    school_id, academic_year_id, student_id, enrollment_id,
    fee_category_id, amount, paid_on, method, reference, motif, recorded_by
  )
  VALUES (
    p_school_id, p_academic_year_id, p_student_id, v_enrollment_id,
    p_fee_category_id, p_amount, v_paid_on,
    coalesce(p_method, 'Espèces'::public.payment_method),
    nullif(p_reference, ''), nullif(p_motif, ''),
    public.current_profile_id()
  )
  RETURNING id INTO v_payment_id;

  v_new_paid := v_amount_paid + p_amount;
  v_balance_after := greatest(0, v_amount_due - v_new_paid);

  INSERT INTO public.receipts (school_id, payment_id, balance_after)
  VALUES (p_school_id, v_payment_id, v_balance_after)
  RETURNING receipt_number INTO v_receipt_number;

  RETURN json_build_object(
    'payment_id', v_payment_id,
    'receipt_number', v_receipt_number,
    'balance_after', v_balance_after
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_payment_with_receipt(
  uuid, uuid, uuid, uuid, numeric, date, public.payment_method, text, text
) TO authenticated;

-- Plafond d'acompte : un versement ne peut pas dépasser le solde. Le message
-- "montant_superieur_solde" est surfaçé en français côté client.
-- ---------------------------------------------------------------------------
-- 2. profiles_select_own : un user ne doit lire que SON profil (ou le profil
--    complet d'un admin s'il EST admin plateforme). Retire l'exposition
--    globale de tous les profils "is_platform_admin = true".
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;

CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (is_platform_admin = true AND private.is_platform_admin())
  );

-- La copie "grants TO public" interdit le ciblage précis de is_platform_admin ;
-- on la restreint aux membres authentifiés.
DROP POLICY IF EXISTS profiles_select_school_admin ON public.profiles;

CREATE POLICY profiles_select_school_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (is_school_admin_of_profile(id));

-- ---------------------------------------------------------------------------
-- 3. Garde-fou serveur de validation des notes : seul un utilisateur qui gère
--    l'évaluation (enseignant affecté, direction, plateforme) peut passer une
--    évaluation de 'saisie' à 'validee'. Fin du simple `.update` client.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.valider_feuille_notes(
  p_assessment_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_school_id uuid;
BEGIN
  IF NOT private.user_can_manage_assessment(p_assessment_id) THEN
    RAISE EXCEPTION 'Action non autorisée pour votre rôle (réservé à l’enseignant de la classe ou à la direction).';
  END IF;

  SELECT school_id INTO v_school_id
    FROM public.assessments
   WHERE id = p_assessment_id;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Évaluation introuvable.';
  END IF;

  UPDATE public.assessments
     SET status = 'validee', updated_at = now()
   WHERE id = p_assessment_id
     AND status IN ('planifiee', 'saisie');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Impossible de valider : l’évaluation a déjà été validée ou clôturée.';
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.valider_feuille_notes(uuid) TO authenticated;

COMMIT;