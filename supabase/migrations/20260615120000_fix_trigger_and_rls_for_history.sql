-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Fix trigger soft-fail + ensure History page RLS read access
-- ─────────────────────────────────────────────────────────────────────────────
-- PROBLEM 1: The BEFORE INSERT trigger 'sync_analysis_log_to_normalized_tables'
-- raised an exception if employee_id could not be resolved to a profile UUID.
-- This blocked EVERY analysis_logs insert from the save-analysis-log edge fn.
-- FIX: Change RAISE EXCEPTION to a soft-fail (NULL worker_id) so inserts succeed.
--
-- PROBLEM 2: The History page is not protected by ProtectedRoute, but anon
-- users should still be able to read logs. Ensure the SELECT policy covers anon.
-- ─────────────────────────────────────────────────────────────────────────────

-- Fix the BEFORE INSERT trigger to not raise exceptions
CREATE OR REPLACE FUNCTION public.sync_analysis_log_to_normalized_tables()
RETURNS TRIGGER AS $$
DECLARE
    v_office_id UUID;
    v_area_id UUID;
    v_worker_id UUID;
    v_score_before INT;
    v_score_after INT;
    v_lm_score INT;
    v_before_scores JSONB;
    v_after_scores JSONB;
BEGIN
    -- ── 1. Resolve Office & Area ───────────────────────────────────────────────
    IF new.office_name IS NOT NULL THEN
        -- Find or create office
        BEGIN
            INSERT INTO public.offices (name, city, country)
            VALUES (new.office_name, 'Chennai', 'India')
            ON CONFLICT (name, city) DO UPDATE SET name = excluded.name
            RETURNING id INTO v_office_id;
        EXCEPTION WHEN OTHERS THEN
            SELECT id INTO v_office_id FROM public.offices
            WHERE name = new.office_name LIMIT 1;
        END;

        -- Find or create area (department)
        IF new.department IS NOT NULL AND v_office_id IS NOT NULL THEN
            SELECT id INTO v_area_id FROM public.areas
            WHERE office_id = v_office_id AND name = new.department;

            IF v_area_id IS NULL THEN
                BEGIN
                    INSERT INTO public.areas (office_id, name)
                    VALUES (v_office_id, new.department)
                    RETURNING id INTO v_area_id;
                EXCEPTION WHEN OTHERS THEN
                    NULL;
                END;
            END IF;
        END IF;
    END IF;

    -- Update area_id on new analysis_log row
    new.area_id := v_area_id;

    -- ── 2. Resolve Profile/Worker (SOFT FAIL — never block the insert) ─────────
    BEGIN
        -- First try: employee_id is a UUID pointing to profiles.id
        v_worker_id := new.employee_id::UUID;
        SELECT id INTO v_worker_id FROM public.profiles WHERE id = v_worker_id;
    EXCEPTION WHEN OTHERS THEN
        v_worker_id := NULL;
    END;

    IF v_worker_id IS NULL THEN
        -- Second try: employee_code field
        SELECT id INTO v_worker_id FROM public.profiles
        WHERE employee_code = new.employee_id LIMIT 1;
    END IF;

    IF v_worker_id IS NULL THEN
        -- Third try: email match
        SELECT id INTO v_worker_id FROM public.profiles
        WHERE email = new.employee_id LIMIT 1;
    END IF;

    IF v_worker_id IS NULL THEN
        -- Fourth try: name match
        SELECT id INTO v_worker_id FROM public.profiles
        WHERE (first_name || ' ' || last_name) ILIKE new.employee_name LIMIT 1;
    END IF;

    -- Soft-fail: if still NULL, continue with worker_id = NULL (no exception!)
    new.worker_id := v_worker_id;

    -- ── 3. Parse scores from analysis_result JSONB ──────────────────────────────
    IF new.analysis_result IS NOT NULL THEN
        v_before_scores := new.analysis_result->'beforeScores';
        v_after_scores := new.analysis_result->'afterScores';

        BEGIN
            v_lm_score := (new.analysis_result->>'leanMaintenanceScore')::INT;
        EXCEPTION WHEN OTHERS THEN
            v_lm_score := NULL;
        END;

        IF v_before_scores IS NOT NULL THEN
            BEGIN
                v_score_before := (
                    coalesce((v_before_scores->>'sort')::INT, 0) +
                    coalesce((v_before_scores->>'setInOrder')::INT, 0) +
                    coalesce((v_before_scores->>'shine')::INT, 0) +
                    coalesce((v_before_scores->>'standardize')::INT, 0) +
                    coalesce((v_before_scores->>'sustain')::INT, 0)
                ) / 5;
            EXCEPTION WHEN OTHERS THEN
                v_score_before := NULL;
            END;
        END IF;

        IF v_after_scores IS NOT NULL THEN
            BEGIN
                v_score_after := (
                    coalesce((v_after_scores->>'sort')::INT, 0) +
                    coalesce((v_after_scores->>'setInOrder')::INT, 0) +
                    coalesce((v_after_scores->>'shine')::INT, 0) +
                    coalesce((v_after_scores->>'standardize')::INT, 0) +
                    coalesce((v_after_scores->>'sustain')::INT, 0)
                ) / 5;
            EXCEPTION WHEN OTHERS THEN
                v_score_after := NULL;
            END;
        END IF;

        new.overall_score_before := coalesce(v_score_before, 0);
        new.overall_score_after := coalesce(v_score_after, 0);
        new.lean_maintenance_score := coalesce(v_lm_score, 0);
    END IF;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-create trigger (REPLACE on trigger itself; function already replaced above)
DROP TRIGGER IF EXISTS before_analysis_log_insert ON public.analysis_logs;
CREATE TRIGGER before_analysis_log_insert
    BEFORE INSERT ON public.analysis_logs
    FOR EACH ROW EXECUTE FUNCTION public.sync_analysis_log_to_normalized_tables();

-- ── RLS: Ensure anon users can read analysis_logs (for History page) ─────────
-- The existing "Anyone can read analysis logs" policy uses USING (true) but
-- is not explicitly set TO anon+authenticated. Add an explicit anon grant.
DROP POLICY IF EXISTS "Anon can read analysis logs" ON public.analysis_logs;
CREATE POLICY "Anon can read analysis logs"
ON public.analysis_logs
FOR SELECT
TO anon
USING (true);

-- Also ensure authenticated users can read
DROP POLICY IF EXISTS "Authenticated can read analysis logs" ON public.analysis_logs;
CREATE POLICY "Authenticated can read analysis logs"
ON public.analysis_logs
FOR SELECT
TO authenticated
USING (true);
