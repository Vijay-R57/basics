-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Role-based RLS for analysis_logs (History page security)
-- ─────────────────────────────────────────────────────────────────────────────
-- Rules:
--   • Unauthenticated (anon) — NO ACCESS at all
--   • Worker — sees only rows where their employee_code matches employee_id
--             OR where worker_id = their auth.uid()
--   • Supervisor / Admin — sees ALL rows
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Drop all existing read policies on analysis_logs
DROP POLICY IF EXISTS "Anyone can read analysis logs"         ON public.analysis_logs;
DROP POLICY IF EXISTS "Anon can read analysis logs"          ON public.analysis_logs;
DROP POLICY IF EXISTS "Authenticated can read analysis logs" ON public.analysis_logs;

-- 2. Supervisors and Admins can read ALL records
CREATE POLICY "Supervisors and Admins can read all analysis logs"
ON public.analysis_logs
FOR SELECT
TO authenticated
USING (
  public.get_current_role() IN ('supervisor', 'admin')
);

-- 3. Workers can only read their own records
--    Match by worker_id UUID (if resolved by trigger) OR by employee_code string
CREATE POLICY "Workers can read own analysis logs"
ON public.analysis_logs
FOR SELECT
TO authenticated
USING (
  public.get_current_role() = 'worker'
  AND (
    -- Match via the UUID foreign key if trigger resolved it
    worker_id = auth.uid()
    OR
    -- Match via employee_code string (how save-analysis-log stores it)
    employee_id = (
      SELECT employee_code
      FROM public.profiles
      WHERE id = auth.uid()
      LIMIT 1
    )
  )
);

-- 4. Ensure anon users get NO access (belt-and-suspenders)
-- (No policy = no access by default when RLS is enabled)
-- But explicitly revoke just in case:
REVOKE SELECT ON public.analysis_logs FROM anon;

-- 5. Ensure get_current_role() is stable and handles missing profiles gracefully
CREATE OR REPLACE FUNCTION public.get_current_role()
RETURNS public.user_role AS $$
  SELECT COALESCE(
    (SELECT role FROM public.profiles WHERE id = auth.uid()),
    'worker'::public.user_role
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
