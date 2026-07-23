-- =============================================================================
-- MIGRATION: 20260216050654_4efefbc0-ac68-4286-a6a3-1f061cdd2480.sql
-- =============================================================================


-- Create analysis_logs table to track all analyses
CREATE TABLE IF NOT EXISTS public.analysis_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  department TEXT NOT NULL,
  analysis_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  before_image TEXT,
  after_image TEXT,
  analysis_result JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.analysis_logs ENABLE ROW LEVEL SECURITY;

-- Allow edge functions (service role) to insert
DROP POLICY IF EXISTS "Service role can manage analysis_logs" ON public.analysis_logs;
DROP POLICY IF EXISTS "Service role can manage analysis_logs" ON public.analysis_logs;
CREATE POLICY "Service role can manage analysis_logs"
ON public.analysis_logs
FOR ALL
USING (true)
WITH CHECK (true);


-- =============================================================================
-- MIGRATION: 20260216050800_fd360ef2-c0a0-40c3-83d5-1f1709d72904.sql
-- =============================================================================


-- Drop the overly permissive policy
DROP POLICY "Service role can manage analysis_logs" ON public.analysis_logs;

-- Only allow reading via anon (for display), inserts only via service role (edge functions)
DROP POLICY IF EXISTS "Anyone can read analysis logs" ON public.analysis_logs;
CREATE POLICY "Anyone can read analysis logs"
ON public.analysis_logs
FOR SELECT
USING (true);

-- No INSERT/UPDATE/DELETE for anon - edge functions use service_role which bypasses RLS


-- =============================================================================
-- MIGRATION: 20260228110000_add_storage_bucket_and_cv_columns.sql
-- =============================================================================

-- Migration: Add Supabase Storage bucket for 5S workplace images
-- This implements the "Data Flywheel" — every uploaded image is
-- preserved in object storage so it can later be used to train
-- the custom YOLO model (Phase 2).

-- Create the storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  '5s-images',
  '5s-images',
  false,                              -- private bucket (not publicly accessible)
  10485760,                           -- 10 MB limit per file
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Policy: Authenticated users (via service role / edge functions) can upload
DROP POLICY IF EXISTS "Service role can upload 5s images" ON storage.objects;
DROP POLICY IF EXISTS "Service role can upload 5s images" ON storage.objects;
CREATE POLICY "Service role can upload 5s images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = '5s-images');

-- Policy: Service role / edge functions can read/download images
DROP POLICY IF EXISTS "Service role can read 5s images" ON storage.objects;
DROP POLICY IF EXISTS "Service role can read 5s images" ON storage.objects;
CREATE POLICY "Service role can read 5s images"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = '5s-images');

-- Policy: Anyone can read if they have the signed URL (for display in frontend)
DROP POLICY IF EXISTS "Anon can read 5s images by signed URL" ON storage.objects;
DROP POLICY IF EXISTS "Anon can read 5s images by signed URL" ON storage.objects;
CREATE POLICY "Anon can read 5s images by signed URL"
ON storage.objects
FOR SELECT
TO anon
USING (bucket_id = '5s-images');

-- Also add a storage_path column to analysis_logs so we can
-- track WHERE each image was stored in the bucket.
ALTER TABLE public.analysis_logs
  ADD COLUMN IF NOT EXISTS before_image_path TEXT,
  ADD COLUMN IF NOT EXISTS after_image_path  TEXT;

-- Add a scoring_method column so we can track which pipeline
-- generated each result (CV Engine vs Gemini fallback).
ALTER TABLE public.analysis_logs
  ADD COLUMN IF NOT EXISTS scoring_method TEXT DEFAULT 'CV Engine',
  ADD COLUMN IF NOT EXISTS cv_metrics     JSONB;


-- =============================================================================
-- MIGRATION: 20260314001935_add_geotag_columns.sql
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Add geotag / geo-audit columns to analysis_logs
-- ─────────────────────────────────────────────────────────────────────────────
-- These columns store the GPS coordinates and timestamps captured by the
-- browser Geolocation API when the employee uses "Take Photo with Geotag".
-- They form the geo-audit trail required for 5S compliance reporting.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.analysis_logs
  -- Office name (from session at time of analysis)
  ADD COLUMN IF NOT EXISTS office_name          TEXT,

  -- GPS coordinates for the BEFORE image capture
  ADD COLUMN IF NOT EXISTS before_latitude      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS before_longitude     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS before_captured_at   TIMESTAMP WITH TIME ZONE,

  -- GPS coordinates for the AFTER image capture
  ADD COLUMN IF NOT EXISTS after_latitude       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS after_longitude      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS after_captured_at    TIMESTAMP WITH TIME ZONE,

  -- Timestamp when "Run 5S Analysis" was triggered
  ADD COLUMN IF NOT EXISTS captured_at          TIMESTAMP WITH TIME ZONE;

-- Index on office for per-office history queries
CREATE INDEX IF NOT EXISTS idx_analysis_logs_office_name
  ON public.analysis_logs (office_name);

-- Index on before_captured_at for time-range audit queries
CREATE INDEX IF NOT EXISTS idx_analysis_logs_before_captured_at
  ON public.analysis_logs (before_captured_at);

-- Useful comment on the table for documentation
COMMENT ON COLUMN public.analysis_logs.office_name        IS 'Office selected by employee at login time';
COMMENT ON COLUMN public.analysis_logs.before_latitude    IS 'GPS latitude recorded at Before image capture';
COMMENT ON COLUMN public.analysis_logs.before_longitude   IS 'GPS longitude recorded at Before image capture';
COMMENT ON COLUMN public.analysis_logs.before_captured_at IS 'Timestamp of Before image GPS capture';
COMMENT ON COLUMN public.analysis_logs.after_latitude     IS 'GPS latitude recorded at After image capture';
COMMENT ON COLUMN public.analysis_logs.after_longitude    IS 'GPS longitude recorded at After image capture';
COMMENT ON COLUMN public.analysis_logs.after_captured_at  IS 'Timestamp of After image GPS capture';
COMMENT ON COLUMN public.analysis_logs.captured_at        IS 'Timestamp when Run 5S Analysis was triggered';


-- =============================================================================
-- MIGRATION: 20260521210500_production_database_architecture.sql
-- =============================================================================

-- Start Transaction
BEGIN;

-- 1. Create Enums and Custom Types (idempotent check)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE public.user_role AS ENUM ('worker', 'supervisor', 'admin');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'five_s_pillar') THEN
        CREATE TYPE public.five_s_pillar AS ENUM ('sort', 'set_in_order', 'shine', 'standardize', 'sustain');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recommendation_category') THEN
        CREATE TYPE public.recommendation_category AS ENUM ('general', 'safety', 'lean_maintenance', 'root_cause');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recommendation_status') THEN
        CREATE TYPE public.recommendation_status AS ENUM ('pending', 'implemented', 'discarded');
    END IF;
END$$;

-- 2. Offices Table
CREATE TABLE IF NOT EXISTS public.offices (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    country TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT unique_office_name UNIQUE (name, city)
);

-- 3. Areas (Departments / Workstations) Table
CREATE TABLE IF NOT EXISTS public.areas (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    office_id UUID NOT NULL REFERENCES public.offices(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 4. User Profiles Table (Linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    email TEXT NOT NULL UNIQUE,
    role public.user_role NOT NULL DEFAULT 'worker',
    employee_code TEXT UNIQUE,
    office_id UUID REFERENCES public.offices(id) ON DELETE SET NULL,
    failed_attempts INT DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Ensure profiles has all columns if it already existed
ALTER TABLE public.profiles 
    ADD COLUMN IF NOT EXISTS employee_code TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS office_id UUID REFERENCES public.offices(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS failed_attempts INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE;

-- Create index on employee_code for rapid login queries
CREATE INDEX IF NOT EXISTS idx_profiles_employee_code ON public.profiles(employee_code);

-- Trigger to automatically sync auth.users with public.profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, first_name, last_name, role, employee_code, office_id)
    VALUES (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'first_name', ''),
        coalesce(new.raw_user_meta_data->>'last_name', ''),
        coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'worker'),
        coalesce(new.raw_user_meta_data->>'employee_code', ''),
        (new.raw_user_meta_data->>'office_id')::UUID
    )
    ON CONFLICT (id) DO UPDATE SET
        email = excluded.email,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        role = excluded.role,
        employee_code = excluded.employee_code,
        office_id = COALESCE(excluded.office_id, public.profiles.office_id);
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-backfill profile table for existing users in auth.users
INSERT INTO public.profiles (id, email, first_name, last_name, role, employee_code, office_id)
SELECT 
    id, 
    email, 
    coalesce(raw_user_meta_data->>'first_name', ''), 
    coalesce(raw_user_meta_data->>'last_name', ''), 
    coalesce((raw_user_meta_data->>'role')::public.user_role, 'worker'),
    coalesce(raw_user_meta_data->>'employee_code', ''),
    (raw_user_meta_data->>'office_id')::UUID
FROM auth.users
ON CONFLICT (id) DO UPDATE SET
    email = excluded.email,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    role = excluded.role,
    employee_code = excluded.employee_code,
    office_id = COALESCE(excluded.office_id, public.profiles.office_id);

-- 5. Extend Existing public.analysis_logs Table for normalization
ALTER TABLE public.analysis_logs
    ADD COLUMN IF NOT EXISTS worker_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS area_id UUID REFERENCES public.areas(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS overall_score_before INT CONSTRAINT valid_score_before CHECK (overall_score_before BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS overall_score_after INT CONSTRAINT valid_score_after CHECK (overall_score_after BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS lean_maintenance_score INT CONSTRAINT valid_lm_score CHECK (lean_maintenance_score BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS upload_status TEXT DEFAULT 'uploaded',
    ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS upload_error TEXT NULL;

-- 6. Pillar Scores Table (Detailed 5S Pillar Breakdowns)
CREATE TABLE IF NOT EXISTS public.pillar_scores (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    analysis_log_id UUID NOT NULL REFERENCES public.analysis_logs(id) ON DELETE CASCADE,
    pillar public.five_s_pillar NOT NULL,
    score_before INT NOT NULL CONSTRAINT valid_p_score_b CHECK (score_before BETWEEN 0 AND 100),
    score_after INT NOT NULL CONSTRAINT valid_p_score_a CHECK (score_after BETWEEN 0 AND 100),
    explanation_before TEXT NOT NULL,
    explanation_after TEXT NOT NULL,
    CONSTRAINT unique_analysis_pillar UNIQUE (analysis_log_id, pillar)
);

-- 7. Recommendations Table
CREATE TABLE IF NOT EXISTS public.recommendations (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    analysis_log_id UUID NOT NULL REFERENCES public.analysis_logs(id) ON DELETE CASCADE,
    category public.recommendation_category NOT NULL DEFAULT 'general',
    description TEXT NOT NULL,
    status public.recommendation_status NOT NULL DEFAULT 'pending',
    assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    due_date DATE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 8. Raw CV Metrics Table (Granular computer-vision readings)
CREATE TABLE IF NOT EXISTS public.cv_metrics (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    analysis_log_id UUID NOT NULL REFERENCES public.analysis_logs(id) ON DELETE CASCADE,
    state TEXT NOT NULL CONSTRAINT valid_state CHECK (state IN ('before', 'after')),
    clutter_count INT NOT NULL DEFAULT 0,
    clutter_density NUMERIC(6, 4) NOT NULL,
    obstruction_ratio NUMERIC(6, 4) NOT NULL,
    unused_material_presence NUMERIC(6, 4) NOT NULL,
    alignment_score NUMERIC(6, 4) NOT NULL,
    spacing_consistency NUMERIC(6, 4) NOT NULL,
    edge_alignment NUMERIC(6, 4) NOT NULL,
    organization_symmetry NUMERIC(6, 4) NOT NULL,
    brightness_consistency NUMERIC(6, 4) NOT NULL,
    dirt_proxy_count INT NOT NULL DEFAULT 0,
    texture_irregularity NUMERIC(6, 4) NOT NULL,
    edge_cleanliness NUMERIC(6, 4) NOT NULL,
    visual_consistency NUMERIC(6, 4) NOT NULL,
    color_uniformity NUMERIC(6, 4) NOT NULL,
    workplace_std_dev NUMERIC(6, 4) NOT NULL,
    CONSTRAINT unique_log_state UNIQUE (analysis_log_id, state)
);

-- 9. Supervisor Reviews Table
CREATE TABLE IF NOT EXISTS public.supervisor_reviews (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    analysis_log_id UUID NOT NULL REFERENCES public.analysis_logs(id) ON DELETE CASCADE UNIQUE,
    supervisor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    rating INT NOT NULL CONSTRAINT valid_rating CHECK (rating BETWEEN 1 AND 5),
    notes TEXT,
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 10. Master Flywheel Trigger for Data Normalization
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
        INSERT INTO public.offices (name, city, country)
        VALUES (new.office_name, 'Chennai', 'India')
        ON CONFLICT (name, city) DO UPDATE SET name = excluded.name
        RETURNING id INTO v_office_id;
        
        -- Find or create area (department)
        IF new.department IS NOT NULL THEN
            SELECT id INTO v_area_id FROM public.areas 
            WHERE office_id = v_office_id AND name = new.department;
            
            IF v_area_id IS NULL THEN
                INSERT INTO public.areas (office_id, name)
                VALUES (v_office_id, new.department)
                RETURNING id INTO v_area_id;
            END IF;
        END IF;
    END IF;

    -- Update area_id on new analysis_log row
    new.area_id := v_area_id;

    -- ── 2. Resolve Profile/Worker ──────────────────────────────────────────────
    BEGIN
        v_worker_id := new.employee_id::UUID;
        SELECT id INTO v_worker_id FROM public.profiles WHERE id = v_worker_id;
    EXCEPTION WHEN others THEN
        -- employee_id is a custom string or email, look up by employee_code first
        SELECT id INTO v_worker_id FROM public.profiles WHERE employee_code = new.employee_id;
        
        IF v_worker_id IS NULL THEN
            -- Look up by email
            SELECT id INTO v_worker_id FROM public.profiles WHERE email = new.employee_id;
        END IF;
        
        IF v_worker_id IS NULL THEN
            -- Look up by name
            SELECT id INTO v_worker_id FROM public.profiles 
            WHERE (first_name || ' ' || last_name) ILIKE new.employee_name LIMIT 1;
        END IF;
    END;

    IF v_worker_id IS NULL THEN
        RAISE EXCEPTION 'Unable to resolve employee profile for employee_id: %', new.employee_id;
    END IF;

    new.worker_id := v_worker_id;

    -- ── 3. Parse scores from analysis_result JSONB ──────────────────────────────
    IF new.analysis_result IS NOT NULL THEN
        v_before_scores := new.analysis_result->'beforeScores';
        v_after_scores := new.analysis_result->'afterScores';
        v_lm_score := (new.analysis_result->>'leanMaintenanceScore')::INT;

        IF v_before_scores IS NOT NULL THEN
            v_score_before := (
                coalesce((v_before_scores->>'sort')::INT, 0) + 
                coalesce((v_before_scores->>'setInOrder')::INT, 0) + 
                coalesce((v_before_scores->>'shine')::INT, 0) + 
                coalesce((v_before_scores->>'standardize')::INT, 0) + 
                coalesce((v_before_scores->>'sustain')::INT, 0)
            ) / 5;
        END IF;

        IF v_after_scores IS NOT NULL THEN
            v_score_after := (
                coalesce((v_after_scores->>'sort')::INT, 0) + 
                coalesce((v_after_scores->>'setInOrder')::INT, 0) + 
                coalesce((v_after_scores->>'shine')::INT, 0) + 
                coalesce((v_after_scores->>'standardize')::INT, 0) + 
                coalesce((v_after_scores->>'sustain')::INT, 0)
            ) / 5;
        END IF;

        new.overall_score_before := coalesce(v_score_before, 0);
        new.overall_score_after := coalesce(v_score_after, 0);
        new.lean_maintenance_score := coalesce(v_lm_score, 0);
    END IF;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER before_analysis_log_insert
    BEFORE INSERT ON public.analysis_logs
    FOR EACH ROW EXECUTE FUNCTION public.sync_analysis_log_to_normalized_tables();


-- 11. AFTER TRIGGER for deep scores, recommendations & raw CV metrics syncing
CREATE OR REPLACE FUNCTION public.sync_analysis_log_related_data()
RETURNS TRIGGER AS $$
DECLARE
    v_before_scores JSONB;
    v_after_scores JSONB;
    v_before_explanations JSONB;
    v_after_explanations JSONB;
    v_recs TEXT[];
    v_safety_recs TEXT[];
    v_root_causes TEXT[];
    v_rec_desc TEXT;
    v_cv_before JSONB;
    v_cv_after JSONB;
BEGIN
    IF new.analysis_result IS NOT NULL THEN
        v_before_scores := new.analysis_result->'beforeScores';
        v_after_scores := new.analysis_result->'afterScores';
        v_before_explanations := new.analysis_result->'beforeExplanations';
        v_after_explanations := new.analysis_result->'afterExplanations';

        -- Sync detailed Pillar Scores
        IF v_before_scores IS NOT NULL AND v_after_scores IS NOT NULL THEN
            -- Sort
            INSERT INTO public.pillar_scores (analysis_log_id, pillar, score_before, score_after, explanation_before, explanation_after)
            VALUES (new.id, 'sort', coalesce((v_before_scores->>'sort')::INT, 0), coalesce((v_after_scores->>'sort')::INT, 0), coalesce(v_before_explanations->>'sort', ''), coalesce(v_after_explanations->>'sort', ''))
            ON CONFLICT (analysis_log_id, pillar) DO NOTHING;
            
            -- Set In Order
            INSERT INTO public.pillar_scores (analysis_log_id, pillar, score_before, score_after, explanation_before, explanation_after)
            VALUES (new.id, 'set_in_order', coalesce((v_before_scores->>'setInOrder')::INT, 0), coalesce((v_after_scores->>'setInOrder')::INT, 0), coalesce(v_before_explanations->>'setInOrder', ''), coalesce(v_after_explanations->>'setInOrder', ''))
            ON CONFLICT (analysis_log_id, pillar) DO NOTHING;

            -- Shine
            INSERT INTO public.pillar_scores (analysis_log_id, pillar, score_before, score_after, explanation_before, explanation_after)
            VALUES (new.id, 'shine', coalesce((v_before_scores->>'shine')::INT, 0), coalesce((v_after_scores->>'shine')::INT, 0), coalesce(v_before_explanations->>'shine', ''), coalesce(v_after_explanations->>'shine', ''))
            ON CONFLICT (analysis_log_id, pillar) DO NOTHING;

            -- Standardize
            INSERT INTO public.pillar_scores (analysis_log_id, pillar, score_before, score_after, explanation_before, explanation_after)
            VALUES (new.id, 'standardize', coalesce((v_before_scores->>'standardize')::INT, 0), coalesce((v_after_scores->>'standardize')::INT, 0), coalesce(v_before_explanations->>'standardize', ''), coalesce(v_after_explanations->>'standardize', ''))
            ON CONFLICT (analysis_log_id, pillar) DO NOTHING;

            -- Sustain
            INSERT INTO public.pillar_scores (analysis_log_id, pillar, score_before, score_after, explanation_before, explanation_after)
            VALUES (new.id, 'sustain', coalesce((v_before_scores->>'sustain')::INT, 0), coalesce((v_after_scores->>'sustain')::INT, 0), coalesce(v_before_explanations->>'sustain', ''), coalesce(v_after_explanations->>'sustain', ''))
            ON CONFLICT (analysis_log_id, pillar) DO NOTHING;
        END IF;

        -- Sync Action Recommendations (parsed from JSONB array into discrete rows)
        IF new.analysis_result ? 'recommendations' THEN
            BEGIN
                SELECT array_agg(val) INTO v_recs FROM jsonb_array_elements_text(new.analysis_result->'recommendations') AS val;
                IF v_recs IS NOT NULL THEN
                    FOREACH v_rec_desc IN ARRAY v_recs LOOP
                        INSERT INTO public.recommendations (analysis_log_id, category, description, status, due_date)
                        VALUES (new.id, 'general', v_rec_desc, 'pending', (CURRENT_DATE + INTERVAL '7 days')::DATE);
                    END LOOP;
                END IF;
            EXCEPTION WHEN OTHERS THEN
                NULL; -- Guard against formatting issues
            END;
        END IF;

        -- Sync Safety Recommendations
        IF new.analysis_result ? 'safetyRecommendations' THEN
            BEGIN
                SELECT array_agg(val) INTO v_safety_recs FROM jsonb_array_elements_text(new.analysis_result->'safetyRecommendations') AS val;
                IF v_safety_recs IS NOT NULL THEN
                    FOREACH v_rec_desc IN ARRAY v_safety_recs LOOP
                        INSERT INTO public.recommendations (analysis_log_id, category, description, status, due_date)
                        VALUES (new.id, 'safety', v_rec_desc, 'pending', (CURRENT_DATE + INTERVAL '3 days')::DATE);
                    END LOOP;
                END IF;
            EXCEPTION WHEN OTHERS THEN
                NULL;
            END;
        END IF;

        -- Sync Root Cause Observations
        IF new.analysis_result ? 'rootCauseObservations' THEN
            BEGIN
                SELECT array_agg(val) INTO v_root_causes FROM jsonb_array_elements_text(new.analysis_result->'rootCauseObservations') AS val;
                IF v_root_causes IS NOT NULL THEN
                    FOREACH v_rec_desc IN ARRAY v_root_causes LOOP
                        INSERT INTO public.recommendations (analysis_log_id, category, description, status, due_date)
                        VALUES (new.id, 'root_cause', v_rec_desc, 'pending', (CURRENT_DATE + INTERVAL '14 days')::DATE);
                    END LOOP;
                END IF;
            EXCEPTION WHEN OTHERS THEN
                NULL;
            END;
        END IF;
    END IF;

    -- Sync Granular Computer Vision Metrics (CV Metrics)
    IF new.cv_metrics IS NOT NULL THEN
        v_cv_before := new.cv_metrics->'before_metrics';
        v_cv_after := new.cv_metrics->'after_metrics';

        IF v_cv_before IS NULL THEN v_cv_before := new.cv_metrics->'beforeMetrics'; END IF;
        IF v_cv_after IS NULL THEN v_cv_after := new.cv_metrics->'afterMetrics'; END IF;

        IF v_cv_before IS NOT NULL THEN
            INSERT INTO public.cv_metrics (
                analysis_log_id, state, clutter_count, clutter_density, obstruction_ratio, 
                unused_material_presence, alignment_score, spacing_consistency, edge_alignment, 
                organization_symmetry, brightness_consistency, dirt_proxy_count, texture_irregularity, 
                edge_cleanliness, visual_consistency, color_uniformity, workplace_std_dev
            )
            VALUES (
                new.id, 'before',
                coalesce((v_cv_before->>'clutter_count')::INT, (v_cv_before->>'clutterCount')::INT, 0),
                coalesce((v_cv_before->>'clutter_density')::NUMERIC, (v_cv_before->>'clutterDensity')::NUMERIC, 0.0),
                coalesce((v_cv_before->>'obstruction_ratio')::NUMERIC, (v_cv_before->>'obstructionRatio')::NUMERIC, 0.0),
                coalesce((v_cv_before->>'unused_material_presence')::NUMERIC, (v_cv_before->>'unusedMaterialPresence')::NUMERIC, 0.0),
                coalesce((v_cv_before->>'alignment_score')::NUMERIC, (v_cv_before->>'alignmentScore')::NUMERIC, 0.0),
                coalesce((v_cv_before->>'spacing_consistency')::NUMERIC, (v_cv_before->>'spacingConsistency')::NUMERIC, 0.0),
                coalesce((v_cv_before->>'edge_alignment')::NUMERIC, (v_cv_before->>'edgeAlignment')::NUMERIC, 0.0),
                coalesce((v_cv_before->>'organization_symmetry')::NUMERIC, (v_cv_before->>'organizationSymmetry')::NUMERIC, 0.0),
                coalesce((v_cv_before->>'brightness_consistency')::NUMERIC, (v_cv_before->>'brightnessConsistency')::NUMERIC, 0.0),
                coalesce((v_cv_before->>'dirt_proxy_count')::INT, (v_cv_before->>'dirtProxyCount')::INT, 0),
                coalesce((v_cv_before->>'texture_irregularity')::NUMERIC, (v_cv_before->>'textureIrregularity')::NUMERIC, 0.0),
                coalesce((v_cv_before->>'edge_cleanliness')::NUMERIC, (v_cv_before->>'edgeCleanliness')::NUMERIC, 0.0),
                coalesce((v_cv_before->>'visual_consistency')::NUMERIC, (v_cv_before->>'visualConsistency')::NUMERIC, 0.0),
                coalesce((v_cv_before->>'color_uniformity')::NUMERIC, (v_cv_before->>'colorUniformity')::NUMERIC, 0.0),
                coalesce((v_cv_before->>'workplace_std_dev')::NUMERIC, (v_cv_before->>'workplaceStdDev')::NUMERIC, 0.0)
            )
            ON CONFLICT (analysis_log_id, state) DO NOTHING;
        END IF;

        IF v_cv_after IS NOT NULL THEN
            INSERT INTO public.cv_metrics (
                analysis_log_id, state, clutter_count, clutter_density, obstruction_ratio, 
                unused_material_presence, alignment_score, spacing_consistency, edge_alignment, 
                organization_symmetry, brightness_consistency, dirt_proxy_count, texture_irregularity, 
                edge_cleanliness, visual_consistency, color_uniformity, workplace_std_dev
            )
            VALUES (
                new.id, 'after',
                coalesce((v_cv_after->>'clutter_count')::INT, (v_cv_after->>'clutterCount')::INT, 0),
                coalesce((v_cv_after->>'clutter_density')::NUMERIC, (v_cv_after->>'clutterDensity')::NUMERIC, 0.0),
                coalesce((v_cv_after->>'obstruction_ratio')::NUMERIC, (v_cv_after->>'obstructionRatio')::NUMERIC, 0.0),
                coalesce((v_cv_after->>'unused_material_presence')::NUMERIC, (v_cv_after->>'unusedMaterialPresence')::NUMERIC, 0.0),
                coalesce((v_cv_after->>'alignment_score')::NUMERIC, (v_cv_after->>'alignmentScore')::NUMERIC, 0.0),
                coalesce((v_cv_after->>'spacing_consistency')::NUMERIC, (v_cv_after->>'spacingConsistency')::NUMERIC, 0.0),
                coalesce((v_cv_after->>'edge_alignment')::NUMERIC, (v_cv_after->>'edgeAlignment')::NUMERIC, 0.0),
                coalesce((v_cv_after->>'organization_symmetry')::NUMERIC, (v_cv_after->>'organizationSymmetry')::NUMERIC, 0.0),
                coalesce((v_cv_after->>'brightness_consistency')::NUMERIC, (v_cv_after->>'brightnessConsistency')::NUMERIC, 0.0),
                coalesce((v_cv_after->>'dirt_proxy_count')::INT, (v_cv_after->>'dirtProxyCount')::INT, 0),
                coalesce((v_cv_after->>'texture_irregularity')::NUMERIC, (v_cv_after->>'textureIrregularity')::NUMERIC, 0.0),
                coalesce((v_cv_after->>'edge_cleanliness')::NUMERIC, (v_cv_after->>'edgeCleanliness')::NUMERIC, 0.0),
                coalesce((v_cv_after->>'visual_consistency')::NUMERIC, (v_cv_after->>'visualConsistency')::NUMERIC, 0.0),
                coalesce((v_cv_after->>'color_uniformity')::NUMERIC, (v_cv_after->>'colorUniformity')::NUMERIC, 0.0),
                coalesce((v_cv_after->>'workplace_std_dev')::NUMERIC, (v_cv_after->>'workplaceStdDev')::NUMERIC, 0.0)
            )
            ON CONFLICT (analysis_log_id, state) DO NOTHING;
        END IF;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER after_analysis_log_insert
    AFTER INSERT ON public.analysis_logs
    FOR EACH ROW EXECUTE FUNCTION public.sync_analysis_log_related_data();


-- 12. Create Optimized Indices for queries
CREATE INDEX IF NOT EXISTS idx_areas_office_id ON public.areas(office_id);
CREATE INDEX IF NOT EXISTS idx_analysis_logs_worker_id ON public.analysis_logs(worker_id);
CREATE INDEX IF NOT EXISTS idx_analysis_logs_area_id ON public.analysis_logs(area_id);
CREATE INDEX IF NOT EXISTS idx_pillar_scores_analysis_log_id ON public.pillar_scores(analysis_log_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_analysis_log_id ON public.recommendations(analysis_log_id);
CREATE INDEX IF NOT EXISTS idx_cv_metrics_analysis_log_id ON public.cv_metrics(analysis_log_id);
CREATE INDEX IF NOT EXISTS idx_supervisor_reviews_analysis_log_id ON public.supervisor_reviews(analysis_log_id);

-- Composite index for rolling historical trend queries
CREATE INDEX IF NOT EXISTS idx_analysis_logs_area_date ON public.analysis_logs(area_id, analysis_date DESC);

-- Partial index for active/overdue safety recommendation tracking
CREATE INDEX IF NOT EXISTS idx_active_safety_recs ON public.recommendations(assigned_to, due_date) 
WHERE status = 'pending' AND category = 'safety';


-- 13. Enable RLS and setup policies
ALTER TABLE public.offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pillar_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cv_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_reviews ENABLE ROW LEVEL SECURITY;

-- Dynamic role helper function
CREATE OR REPLACE FUNCTION public.get_current_role()
RETURNS public.user_role AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- Profiles policies
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile"
ON public.profiles FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Supervisors/Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Supervisors/Admins can view all profiles" ON public.profiles;
CREATE POLICY "Supervisors/Admins can view all profiles"
ON public.profiles FOR SELECT USING (public.get_current_role() IN ('supervisor', 'admin'));

-- Offices select policy (restricted to authenticated users only)
DROP POLICY IF EXISTS "Anyone can select offices" ON public.offices;
DROP POLICY IF EXISTS "Anyone can select offices" ON public.offices;
CREATE POLICY "Anyone can select offices"
ON public.offices FOR SELECT TO authenticated USING (true);

-- Recommendations policies
DROP POLICY IF EXISTS "Users can view recommendations assigned to them or their logs" ON public.recommendations;
DROP POLICY IF EXISTS "Users can view recommendations assigned to them or their logs" ON public.recommendations;
CREATE POLICY "Users can view recommendations assigned to them or their logs"
ON public.recommendations FOR SELECT USING (
    assigned_to = auth.uid() OR 
    EXISTS (
        SELECT 1 FROM public.analysis_logs 
        WHERE id = analysis_log_id AND worker_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Supervisors and Admins can manage all recommendations" ON public.recommendations;
DROP POLICY IF EXISTS "Supervisors and Admins can manage all recommendations" ON public.recommendations;
CREATE POLICY "Supervisors and Admins can manage all recommendations"
ON public.recommendations FOR ALL USING (public.get_current_role() IN ('supervisor', 'admin'));

COMMIT;


-- =============================================================================
-- MIGRATION: 20260615120000_fix_trigger_and_rls_for_history.sql
-- =============================================================================

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
DROP POLICY IF EXISTS "Anon can read analysis logs" ON public.analysis_logs;
CREATE POLICY "Anon can read analysis logs"
ON public.analysis_logs
FOR SELECT
TO anon
USING (true);

-- Also ensure authenticated users can read
DROP POLICY IF EXISTS "Authenticated can read analysis logs" ON public.analysis_logs;
DROP POLICY IF EXISTS "Authenticated can read analysis logs" ON public.analysis_logs;
CREATE POLICY "Authenticated can read analysis logs"
ON public.analysis_logs
FOR SELECT
TO authenticated
USING (true);


-- =============================================================================
-- MIGRATION: 20260616000000_role_based_history_rls.sql
-- =============================================================================

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
DROP POLICY IF EXISTS "Supervisors and Admins can read all analysis logs" ON public.analysis_logs;
CREATE POLICY "Supervisors and Admins can read all analysis logs"
ON public.analysis_logs
FOR SELECT
TO authenticated
USING (
  public.get_current_role() IN ('supervisor', 'admin')
);

-- 3. Workers can only read their own records
--    Match by worker_id UUID (if resolved by trigger) OR by employee_code string
DROP POLICY IF EXISTS "Workers can read own analysis logs" ON public.analysis_logs;
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


-- =============================================================================
-- MIGRATION: 20260627000000_phase1_audit_checklist.sql
-- =============================================================================

-- ============================================================
-- Phase 1: Industrial 5S Audit Checklist Module
-- Migration: 20260627000000_phase1_audit_checklist.sql
-- Apply via Supabase SQL Editor
--
-- NOTE: This migration is self-contained. Foreign key references
-- to profiles / areas / analysis_logs are stored as plain UUID
-- columns so the Audit module works even before the main app
-- schema is applied to this Supabase project.
-- ============================================================

BEGIN;

-- ── ENUMS ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_pillar') THEN
    CREATE TYPE public.audit_pillar AS ENUM (
      'SORT',
      'SET_IN_ORDER',
      'SHINE',
      'STANDARDIZE',
      'SUSTAIN'
    );
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_status') THEN
    CREATE TYPE public.audit_status AS ENUM (
      'DRAFT',
      'IN_PROGRESS',
      'UNDER_REVIEW',
      'COMPLETED',
      'ARCHIVED'
    );
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_status') THEN
    CREATE TYPE public.template_status AS ENUM (
      'ACTIVE',
      'DEPRECATED',
      'ARCHIVED'
    );
  END IF;
END$$;

-- ── TABLE: audit_templates ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_templates (
    id            UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name          TEXT          NOT NULL,
    description   TEXT,
    version       TEXT          NOT NULL DEFAULT '1.0',
    status        public.template_status NOT NULL DEFAULT 'ACTIVE',
    is_default    BOOLEAN       NOT NULL DEFAULT false,
    -- created_by references auth.users UUID (no FK so this works standalone)
    created_by    UUID,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_templates_status
    ON public.audit_templates(status);
CREATE INDEX IF NOT EXISTS idx_audit_templates_is_default
    ON public.audit_templates(is_default) WHERE is_default = true;

-- ── TABLE: audit_checklist_items ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_checklist_items (
    id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    template_id    UUID        NOT NULL REFERENCES public.audit_templates(id) ON DELETE CASCADE,
    pillar         public.audit_pillar NOT NULL,
    question_text  TEXT        NOT NULL,
    description    TEXT,
    max_points     INT         NOT NULL DEFAULT 4
                               CONSTRAINT valid_max_points CHECK (max_points IN (1,2,3,4,5)),
    weight         NUMERIC(4,2) NOT NULL DEFAULT 1.00,
    display_order  INT         NOT NULL DEFAULT 0,
    is_mandatory   BOOLEAN     NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checklist_items_template_id
    ON public.audit_checklist_items(template_id);
CREATE INDEX IF NOT EXISTS idx_checklist_items_pillar
    ON public.audit_checklist_items(template_id, pillar);

-- ── TABLE: audit_sessions ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_sessions (
    id                UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    -- audit_number is auto-generated via trigger; stored for report printing
    audit_number      TEXT,
    template_id       UUID          NOT NULL REFERENCES public.audit_templates(id),
    -- Snapshots — survive template edits / org restructuring
    template_name     TEXT          NOT NULL,
    template_version  TEXT          NOT NULL,
    -- auditor_id = auth.users UUID (plain UUID, no FK to keep standalone)
    auditor_id        UUID          NOT NULL,
    auditor_name      TEXT          NOT NULL,
    -- area_id / analysis_log_id are optional references (no FK enforcement here)
    area_id           UUID,
    area_name         TEXT,
    department_name   TEXT,
    plant_name        TEXT,
    analysis_log_id   UUID,
    audit_date        DATE          NOT NULL DEFAULT CURRENT_DATE,
    status            public.audit_status NOT NULL DEFAULT 'DRAFT',
    total_score       NUMERIC(8,2)  NOT NULL DEFAULT 0,
    max_score         NUMERIC(8,2)  NOT NULL DEFAULT 0,
    percentage        NUMERIC(5,2)  GENERATED ALWAYS AS (
                          CASE WHEN max_score > 0
                               THEN ROUND((total_score / max_score) * 100, 2)
                               ELSE 0 END
                      ) STORED,
    notes             TEXT,
    completed_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_sessions_auditor_id
    ON public.audit_sessions(auditor_id);
CREATE INDEX IF NOT EXISTS idx_audit_sessions_status
    ON public.audit_sessions(status);
CREATE INDEX IF NOT EXISTS idx_audit_sessions_audit_date
    ON public.audit_sessions(audit_date DESC);
CREATE INDEX IF NOT EXISTS idx_audit_sessions_template_id
    ON public.audit_sessions(template_id);

-- ── TABLE: audit_session_items (immutable checklist snapshot per session) ─────

CREATE TABLE IF NOT EXISTS public.audit_session_items (
    id                          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    audit_session_id            UUID        NOT NULL
                                            REFERENCES public.audit_sessions(id) ON DELETE CASCADE,
    -- original_checklist_item_id for traceability; nullable if item was deleted
    original_checklist_item_id  UUID
                                REFERENCES public.audit_checklist_items(id) ON DELETE SET NULL,
    pillar                      public.audit_pillar NOT NULL,
    question_text               TEXT        NOT NULL,
    description                 TEXT,
    max_points                  INT         NOT NULL DEFAULT 4,
    weight                      NUMERIC(4,2) NOT NULL DEFAULT 1.00,
    display_order               INT         NOT NULL DEFAULT 0,
    is_mandatory                BOOLEAN     NOT NULL DEFAULT true,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_items_session_id
    ON public.audit_session_items(audit_session_id);
CREATE INDEX IF NOT EXISTS idx_session_items_pillar
    ON public.audit_session_items(audit_session_id, pillar);

-- ── TABLE: audit_item_responses ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_item_responses (
    id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    audit_session_id     UUID        NOT NULL
                                     REFERENCES public.audit_sessions(id) ON DELETE CASCADE,
    session_item_id      UUID        NOT NULL
                                     REFERENCES public.audit_session_items(id) ON DELETE CASCADE,
    -- Phase 1: manual_score → final_score
    -- Phase 2: ai_score + reviewer override → final_score
    manual_score         INT         CONSTRAINT valid_manual_score CHECK (manual_score BETWEEN 0 AND 5),
    ai_score             NUMERIC(4,2),          -- Phase 2: AI-generated score
    final_score          NUMERIC(4,2),          -- computed by trigger (Phase 1 = manual_score)
    confidence           NUMERIC(4,2),          -- Phase 2: AI confidence 0–1
    ai_reason            TEXT,                  -- Phase 2: AI explanation
    reviewer_comment     TEXT,                  -- Phase 2+: supervisor override note
    notes                TEXT,                  -- auditor observation
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_response_per_item UNIQUE (audit_session_id, session_item_id)
);

CREATE INDEX IF NOT EXISTS idx_responses_session_id
    ON public.audit_item_responses(audit_session_id);
CREATE INDEX IF NOT EXISTS idx_responses_session_item
    ON public.audit_item_responses(session_item_id);

-- ── TRIGGER: Phase 1 — final_score = manual_score ────────────────────────────

CREATE OR REPLACE FUNCTION public.set_response_final_score()
RETURNS TRIGGER AS $$
BEGIN
    NEW.final_score := COALESCE(NEW.manual_score, 0);
    NEW.updated_at  := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_response_final_score ON public.audit_item_responses;
CREATE TRIGGER trg_response_final_score
    BEFORE INSERT OR UPDATE ON public.audit_item_responses
    FOR EACH ROW EXECUTE FUNCTION public.set_response_final_score();

-- ── TRIGGER: recalculate session score after each response upsert ─────────────

CREATE OR REPLACE FUNCTION public.recalculate_session_score()
RETURNS TRIGGER AS $$
DECLARE
    v_session_id UUID;
    v_total      NUMERIC(8,2);
    v_max        NUMERIC(8,2);
BEGIN
    v_session_id := COALESCE(NEW.audit_session_id, OLD.audit_session_id);

    SELECT
        COALESCE(SUM(r.final_score * si.weight), 0),
        COALESCE(SUM(si.max_points * si.weight), 0)
    INTO v_total, v_max
    FROM public.audit_session_items si
    LEFT JOIN public.audit_item_responses r
        ON r.session_item_id = si.id
       AND r.audit_session_id = si.audit_session_id
    WHERE si.audit_session_id = v_session_id;

    UPDATE public.audit_sessions
    SET total_score = v_total,
        max_score   = v_max,
        updated_at  = now()
    WHERE id = v_session_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_recalculate_session_score ON public.audit_item_responses;
CREATE TRIGGER trg_recalculate_session_score
    AFTER INSERT OR UPDATE OR DELETE ON public.audit_item_responses
    FOR EACH ROW EXECUTE FUNCTION public.recalculate_session_score();

-- ── TRIGGER: updated_at ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_templates_updated_at ON public.audit_templates;
CREATE TRIGGER trg_templates_updated_at
    BEFORE UPDATE ON public.audit_templates
    FOR EACH ROW EXECUTE FUNCTION public.audit_touch_updated_at();

DROP TRIGGER IF EXISTS trg_sessions_updated_at ON public.audit_sessions;
CREATE TRIGGER trg_sessions_updated_at
    BEFORE UPDATE ON public.audit_sessions
    FOR EACH ROW EXECUTE FUNCTION public.audit_touch_updated_at();

-- ── TRIGGER: snapshot checklist items on new session ─────────────────────────

CREATE OR REPLACE FUNCTION public.snapshot_checklist_items()
RETURNS TRIGGER AS $$
BEGIN
    -- Copy every item from the template into audit_session_items
    INSERT INTO public.audit_session_items (
        audit_session_id,
        original_checklist_item_id,
        pillar,
        question_text,
        description,
        max_points,
        weight,
        display_order,
        is_mandatory
    )
    SELECT
        NEW.id,
        id,
        pillar,
        question_text,
        description,
        max_points,
        weight,
        display_order,
        is_mandatory
    FROM public.audit_checklist_items
    WHERE template_id = NEW.template_id
    ORDER BY pillar, display_order;

    -- Initialise max_score from the template immediately
    UPDATE public.audit_sessions
    SET max_score  = (
            SELECT COALESCE(SUM(max_points * weight), 0)
            FROM public.audit_checklist_items
            WHERE template_id = NEW.template_id
        ),
        updated_at = now()
    WHERE id = NEW.id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_snapshot_checklist_items ON public.audit_sessions;
CREATE TRIGGER trg_snapshot_checklist_items
    AFTER INSERT ON public.audit_sessions
    FOR EACH ROW EXECUTE FUNCTION public.snapshot_checklist_items();

-- ── TRIGGER: set_audit_session_number ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_audit_session_number()
RETURNS TRIGGER AS $$
BEGIN
    NEW.audit_number := 'AUD-' || TO_CHAR(COALESCE(NEW.created_at, now()), 'YYYYMMDD') || '-' || UPPER(SUBSTR(NEW.id::TEXT, 1, 6));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_audit_session_number ON public.audit_sessions;
CREATE TRIGGER trg_set_audit_session_number
    BEFORE INSERT ON public.audit_sessions
    FOR EACH ROW EXECUTE FUNCTION public.set_audit_session_number();

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.audit_templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_session_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_item_responses  ENABLE ROW LEVEL SECURITY;

-- Templates: all authenticated users can read
DROP POLICY IF EXISTS "Authenticated can read templates" ON public.audit_templates;
DROP POLICY IF EXISTS "Authenticated can read templates" ON public.audit_templates;
CREATE POLICY "Authenticated can read templates"
    ON public.audit_templates FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can manage templates" ON public.audit_templates;
DROP POLICY IF EXISTS "Authenticated can manage templates" ON public.audit_templates;
CREATE POLICY "Authenticated can manage templates"
    ON public.audit_templates FOR ALL TO authenticated USING (true);

-- Checklist items: all authenticated users can read
DROP POLICY IF EXISTS "Authenticated can read checklist items" ON public.audit_checklist_items;
DROP POLICY IF EXISTS "Authenticated can read checklist items" ON public.audit_checklist_items;
CREATE POLICY "Authenticated can read checklist items"
    ON public.audit_checklist_items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can manage checklist items" ON public.audit_checklist_items;
DROP POLICY IF EXISTS "Authenticated can manage checklist items" ON public.audit_checklist_items;
CREATE POLICY "Authenticated can manage checklist items"
    ON public.audit_checklist_items FOR ALL TO authenticated USING (true);

-- Sessions: users see their own (auditor_id = their auth.uid())
DROP POLICY IF EXISTS "Users can view own sessions" ON public.audit_sessions;
DROP POLICY IF EXISTS "Users can view own sessions" ON public.audit_sessions;
CREATE POLICY "Users can view own sessions"
    ON public.audit_sessions FOR SELECT TO authenticated
    USING (auditor_id = auth.uid());

DROP POLICY IF EXISTS "Users can create sessions" ON public.audit_sessions;
DROP POLICY IF EXISTS "Users can create sessions" ON public.audit_sessions;
CREATE POLICY "Users can create sessions"
    ON public.audit_sessions FOR INSERT TO authenticated
    WITH CHECK (auditor_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own sessions" ON public.audit_sessions;
DROP POLICY IF EXISTS "Users can update own sessions" ON public.audit_sessions;
CREATE POLICY "Users can update own sessions"
    ON public.audit_sessions FOR UPDATE TO authenticated
    USING (auditor_id = auth.uid());

-- Session items: follow session visibility
DROP POLICY IF EXISTS "Session items follow session" ON public.audit_session_items;
DROP POLICY IF EXISTS "Session items follow session" ON public.audit_session_items;
CREATE POLICY "Session items follow session"
    ON public.audit_session_items FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.audit_sessions s
            WHERE s.id = audit_session_id AND s.auditor_id = auth.uid()
        )
    );

-- Responses: follow session visibility
DROP POLICY IF EXISTS "Responses select" ON public.audit_item_responses;
DROP POLICY IF EXISTS "Responses select" ON public.audit_item_responses;
CREATE POLICY "Responses select"
    ON public.audit_item_responses FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.audit_sessions s
            WHERE s.id = audit_session_id AND s.auditor_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Responses insert" ON public.audit_item_responses;
DROP POLICY IF EXISTS "Responses insert" ON public.audit_item_responses;
CREATE POLICY "Responses insert"
    ON public.audit_item_responses FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.audit_sessions s
            WHERE s.id = audit_session_id AND s.auditor_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Responses update" ON public.audit_item_responses;
DROP POLICY IF EXISTS "Responses update" ON public.audit_item_responses;
CREATE POLICY "Responses update"
    ON public.audit_item_responses FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.audit_sessions s
            WHERE s.id = audit_session_id AND s.auditor_id = auth.uid()
        )
    );

-- ── SEED: Default Template ────────────────────────────────────────────────────

DO $$
DECLARE
    v_template_id UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.audit_templates WHERE is_default = true) THEN

        INSERT INTO public.audit_templates (name, description, version, status, is_default)
        VALUES (
            'Industrial Standard 5S Audit',
            'Comprehensive 5S audit template based on industry best practices. Contains 25 standard checklist items across all five 5S pillars.',
            '1.0',
            'ACTIVE',
            true
        )
        RETURNING id INTO v_template_id;

        -- ── SORT ──────────────────────────────────────────────────────────
        INSERT INTO public.audit_checklist_items
            (template_id, pillar, question_text, description, max_points, weight, display_order)
        VALUES
        (v_template_id, 'SORT', 'Are unnecessary items removed from the work area?',
         'Check for tools, materials, or equipment not needed for current work.', 4, 1.00, 1),
        (v_template_id, 'SORT', 'Is there a clear red-tag system for unneeded items?',
         'Verify red-tag or similar disposal tagging process is in place.', 4, 1.00, 2),
        (v_template_id, 'SORT', 'Are aisles and walkways free from obstructions?',
         'All emergency and operational pathways must be unobstructed.', 4, 1.20, 3),
        (v_template_id, 'SORT', 'Are only required quantities of materials present at the station?',
         'Excess inventory should not accumulate at workstations.', 4, 1.00, 4),
        (v_template_id, 'SORT', 'Are expired or defective items segregated and labeled?',
         'Non-conforming materials must be visually identified and quarantined.', 4, 1.10, 5);

        -- ── SET IN ORDER ──────────────────────────────────────────────────
        INSERT INTO public.audit_checklist_items
            (template_id, pillar, question_text, description, max_points, weight, display_order)
        VALUES
        (v_template_id, 'SET_IN_ORDER', 'Does every item have a designated, labeled storage location?',
         'Shadow boards, floor markings, or labels must be present.', 4, 1.00, 1),
        (v_template_id, 'SET_IN_ORDER', 'Are tools and equipment stored at the point of use?',
         'Frequently used tools must be closest to the operator.', 4, 1.00, 2),
        (v_template_id, 'SET_IN_ORDER', 'Are storage locations clearly marked with visual indicators?',
         'Color-coding, signage, and floor tape are in good condition.', 4, 1.00, 3),
        (v_template_id, 'SET_IN_ORDER', 'Is there a visual system to identify when items are missing?',
         'Silhouettes, labels, or quantity indicators must be present.', 4, 1.00, 4),
        (v_template_id, 'SET_IN_ORDER', 'Are items returned to their designated location after use?',
         'Items must not be found outside their designated area.', 4, 1.10, 5);

        -- ── SHINE ─────────────────────────────────────────────────────────
        INSERT INTO public.audit_checklist_items
            (template_id, pillar, question_text, description, max_points, weight, display_order)
        VALUES
        (v_template_id, 'SHINE', 'Is the work area floor clean and free of debris, oil, or water?',
         'No spills, dirt, or obstacles on floor surfaces.', 4, 1.20, 1),
        (v_template_id, 'SHINE', 'Are machines and equipment surfaces clean and properly maintained?',
         'Equipment must be wiped down regularly with no visible grime.', 4, 1.00, 2),
        (v_template_id, 'SHINE', 'Are cleaning schedules posted and being followed?',
         'Cleaning log or schedule must be visible and up to date.', 4, 1.00, 3),
        (v_template_id, 'SHINE', 'Are cleaning tools and supplies properly stored and available?',
         'Mops, brooms, and supplies are in designated locations.', 4, 1.00, 4),
        (v_template_id, 'SHINE', 'Are waste bins available, labeled, and emptied regularly?',
         'Bins must not be overflowing and must be correctly labeled.', 4, 1.00, 5);

        -- ── STANDARDIZE ───────────────────────────────────────────────────
        INSERT INTO public.audit_checklist_items
            (template_id, pillar, question_text, description, max_points, weight, display_order)
        VALUES
        (v_template_id, 'STANDARDIZE', 'Are 5S standards documented and visible at the workstation?',
         'Visual standard sheets, work instructions, or SOPs must be posted.', 4, 1.00, 1),
        (v_template_id, 'STANDARDIZE', 'Is color-coding consistently applied across all areas?',
         'Consistent color scheme for safety, zones, and storage categories.', 4, 1.00, 2),
        (v_template_id, 'STANDARDIZE', 'Are workstation layouts uniform and consistent across shifts?',
         'Layouts must not change between shift handovers.', 4, 1.00, 3),
        (v_template_id, 'STANDARDIZE', 'Are visual controls (andon, kanban, status boards) maintained?',
         'All visual management tools are up to date and functional.', 4, 1.10, 4),
        (v_template_id, 'STANDARDIZE', 'Are safety markings and hazard identifications clearly visible?',
         'All safety labels, floor markings, and warning signs are intact.', 4, 1.20, 5);

        -- ── SUSTAIN ───────────────────────────────────────────────────────
        INSERT INTO public.audit_checklist_items
            (template_id, pillar, question_text, description, max_points, weight, display_order)
        VALUES
        (v_template_id, 'SUSTAIN', 'Is a regular 5S audit schedule established and followed?',
         'Audit calendar or schedule must be visible and adhered to.', 4, 1.00, 1),
        (v_template_id, 'SUSTAIN', 'Are 5S results communicated and displayed on team boards?',
         'Audit scores and trends must be visible to all team members.', 4, 1.00, 2),
        (v_template_id, 'SUSTAIN', 'Are employees trained and aware of 5S responsibilities?',
         'Workers should be able to explain their 5S duties.', 4, 1.00, 3),
        (v_template_id, 'SUSTAIN', 'Are corrective actions from previous audits closed out?',
         'Prior audit findings must have documented closure evidence.', 4, 1.20, 4),
        (v_template_id, 'SUSTAIN', 'Is management actively involved in supporting 5S activities?',
         'Leadership gemba walks, recognition, or support is documented.', 4, 1.10, 5);

    END IF;
END$$;

COMMIT;


-- =============================================================================
-- MIGRATION: 20260629000000_phase2_ai_scoring.sql
-- =============================================================================

-- ============================================================
-- Phase 2: AI-Driven Audit Scoring Architecture
-- Migration: 20260629000000_phase2_ai_scoring.sql
--
-- Refinements applied:
--  1. Rich answer states (audit_answer_state enum)
--  2. Evidence stored per response
--  3. Confidence is metadata only (no scoring)
--  4. Severity levels on questions
--  5. Flexible critical rule engine (audit_critical_rules)
--  6. Template immutability (BEFORE UPDATE trigger)
--  7. Prompt versioning (audit_prompt_versions)
--  8. Remove DB scoring triggers → move to TypeScript ScoringService
--  9. Explainability via score_breakdown JSONB
-- 10. Provider-independent image gen (config only)
-- ============================================================

BEGIN;

-- ── ENUM: audit_answer_state ─────────────────────────────────────────────────
-- Replaces boolean answer. NOT_VISIBLE/NOT_APPLICABLE excluded from scoring.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_answer_state') THEN
    CREATE TYPE public.audit_answer_state AS ENUM (
      'YES',             -- clearly compliant   → full points
      'NO',              -- clearly non-compliant → 0 points
      'PARTIAL',         -- partially compliant  → 50% of max_points
      'NOT_VISIBLE',     -- element not visible in image → excluded from denominator
      'NOT_APPLICABLE'   -- question not relevant to this area → excluded entirely
    );
  END IF;
END$$;

-- ── ENUM: audit_severity ─────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_severity') THEN
    CREATE TYPE public.audit_severity AS ENUM (
      'CRITICAL',  -- can cap pillar score; drives highest priority recommendations
      'MAJOR',     -- significant issue; high priority recommendations
      'MINOR'      -- minor issue; standard recommendations
    );
  END IF;
END$$;

-- ── EXTEND: audit_checklist_items ────────────────────────────────────────────
-- Add severity and a stable question_id for AI prompt reference

ALTER TABLE public.audit_checklist_items
  ADD COLUMN IF NOT EXISTS severity   public.audit_severity NOT NULL DEFAULT 'MINOR',
  ADD COLUMN IF NOT EXISTS question_id TEXT;  -- e.g. 'SORT_001' — set by trigger below

-- Generate question_id from pillar + display_order for existing rows
UPDATE public.audit_checklist_items
SET question_id = UPPER(REPLACE(pillar::TEXT, '_', '')) || '_' || LPAD(display_order::TEXT, 3, '0')
WHERE question_id IS NULL;

-- Trigger to auto-generate question_id on insert if not provided
CREATE OR REPLACE FUNCTION public.set_checklist_question_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.question_id IS NULL OR NEW.question_id = '' THEN
    NEW.question_id := UPPER(REPLACE(NEW.pillar::TEXT, '_', '')) || '_' ||
                       LPAD(NEW.display_order::TEXT, 3, '0') || '_' ||
                       UPPER(SUBSTR(NEW.id::TEXT, 1, 4));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_checklist_question_id ON public.audit_checklist_items;
CREATE TRIGGER trg_set_checklist_question_id
  BEFORE INSERT ON public.audit_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.set_checklist_question_id();

-- ── EXTEND: audit_session_items ──────────────────────────────────────────────
-- Snapshot must also carry severity and question_id

ALTER TABLE public.audit_session_items
  ADD COLUMN IF NOT EXISTS severity    public.audit_severity NOT NULL DEFAULT 'MINOR',
  ADD COLUMN IF NOT EXISTS question_id TEXT;

-- ── EXTEND: audit_item_responses ─────────────────────────────────────────────
-- Replace ai_score (numeric) with ai_answer (enum) + evidence TEXT.
-- manual_score integer is KEPT for Phase 1 manual audits.
-- Confidence is stored as metadata only — never used in scoring.

-- Drop ai_score column (replaced by ai_answer enum)
ALTER TABLE public.audit_item_responses
  DROP COLUMN IF EXISTS ai_score;

ALTER TABLE public.audit_item_responses
  ADD COLUMN IF NOT EXISTS ai_answer    public.audit_answer_state,
  ADD COLUMN IF NOT EXISTS evidence     TEXT,        -- AI observation supporting the answer
  ADD COLUMN IF NOT EXISTS ai_question_id TEXT;      -- links to audit_checklist_items.question_id

-- ── REMOVE: Database scoring triggers ────────────────────────────────────────
-- Score calculation moves to TypeScript ScoringService (Refinement #8).
-- The DB only stores data; it never computes scores.

DROP TRIGGER IF EXISTS trg_response_final_score      ON public.audit_item_responses;
DROP TRIGGER IF EXISTS trg_recalculate_session_score ON public.audit_item_responses;
DROP FUNCTION IF EXISTS public.set_response_final_score();
DROP FUNCTION IF EXISTS public.recalculate_session_score();

-- Keep final_score column for backward compat with manual audit Phase 1 reads.
-- ScoringService writes the computed value here after calculation.

-- ── EXTEND: audit_session_items snapshot — carry severity ────────────────────
-- Update existing snapshot trigger to also copy severity + question_id

CREATE OR REPLACE FUNCTION public.snapshot_checklist_items()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.audit_session_items (
        audit_session_id,
        original_checklist_item_id,
        pillar,
        question_text,
        description,
        max_points,
        weight,
        display_order,
        is_mandatory,
        severity,
        question_id
    )
    SELECT
        NEW.id,
        id,
        pillar,
        question_text,
        description,
        max_points,
        weight,
        display_order,
        is_mandatory,
        severity,
        question_id
    FROM public.audit_checklist_items
    WHERE template_id = NEW.template_id
    ORDER BY pillar, display_order;

    -- Initialise max_score from the template (ScoringService will recalculate)
    UPDATE public.audit_sessions
    SET max_score  = (
            SELECT COALESCE(SUM(max_points * weight), 0)
            FROM public.audit_checklist_items
            WHERE template_id = NEW.template_id
        ),
        updated_at = now()
    WHERE id = NEW.id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── EXTEND: audit_sessions ───────────────────────────────────────────────────
-- Add AI pipeline metadata and explainability storage

ALTER TABLE public.audit_sessions
  ADD COLUMN IF NOT EXISTS score_breakdown        JSONB,          -- PillarScoreResult[] from ScoringService
  ADD COLUMN IF NOT EXISTS generated_after_image_url TEXT,        -- URL of AI-generated "After" image
  ADD COLUMN IF NOT EXISTS improvement_prompt     TEXT,           -- Prompt used to generate after image
  ADD COLUMN IF NOT EXISTS prompt_version_id      UUID,           -- FK → audit_prompt_versions.id
  ADD COLUMN IF NOT EXISTS vision_model_used      TEXT,           -- e.g. 'gemini-1.5-pro-vision'
  ADD COLUMN IF NOT EXISTS prompt_schema_version  TEXT,           -- e.g. '2.0'
  ADD COLUMN IF NOT EXISTS before_image_url       TEXT,           -- stored image URL (before)
  ADD COLUMN IF NOT EXISTS analysis_mode          TEXT NOT NULL DEFAULT 'MANUAL';
                                                                  -- 'MANUAL' | 'AI_ASSISTED' | 'FULL_AI'

-- ── TABLE: audit_prompt_versions ─────────────────────────────────────────────
-- Stores versioned AI prompts. Every session FKs to the exact prompt used.

CREATE TABLE IF NOT EXISTS public.audit_prompt_versions (
  id              UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prompt_type     TEXT          NOT NULL,  -- 'VISION_AUDIT' | 'RECOMMENDATIONS' | 'IMAGE_PROMPT' | 'AFTER_VALIDATION'
  version         TEXT          NOT NULL DEFAULT '1.0',
  vision_model    TEXT          NOT NULL DEFAULT 'gemini-1.5-pro',
  temperature     NUMERIC(3,2)  NOT NULL DEFAULT 0.10,
  schema_version  TEXT          NOT NULL DEFAULT '1.0',
  prompt_text     TEXT          NOT NULL,
  is_active       BOOLEAN       NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT unique_active_prompt_type UNIQUE (prompt_type, version)
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_type_active
  ON public.audit_prompt_versions(prompt_type, is_active) WHERE is_active = true;

-- Add FK constraint (deferred to avoid ordering issues)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_sessions_prompt_version'
  ) THEN
    ALTER TABLE public.audit_sessions
      ADD CONSTRAINT fk_sessions_prompt_version
      FOREIGN KEY (prompt_version_id) REFERENCES public.audit_prompt_versions(id) ON DELETE SET NULL;
  END IF;
END$$;


-- ── TABLE: audit_critical_rules ──────────────────────────────────────────────
-- Flexible rule engine for score caps. Stored in DB — zero code changes needed.

CREATE TABLE IF NOT EXISTS public.audit_critical_rules (
  id                  UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id         UUID          REFERENCES public.audit_templates(id) ON DELETE CASCADE,
  checklist_item_id   UUID          REFERENCES public.audit_checklist_items(id) ON DELETE CASCADE,
  pillar              public.audit_pillar NOT NULL,
  trigger_answer      public.audit_answer_state NOT NULL DEFAULT 'NO',
  -- score_cap: maximum percentage (0–100) allowed for the pillar when rule triggers
  score_cap           NUMERIC(5,2)  NOT NULL,
  description         TEXT,
  is_active           BOOLEAN       NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT valid_score_cap CHECK (score_cap >= 0 AND score_cap <= 100)
);

CREATE INDEX IF NOT EXISTS idx_critical_rules_template_id
  ON public.audit_critical_rules(template_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_critical_rules_item_id
  ON public.audit_critical_rules(checklist_item_id);

-- ── TABLE: audit_recommendations ─────────────────────────────────────────────
-- AI-generated recommendations stored per session

CREATE TABLE IF NOT EXISTS public.audit_recommendations (
  id               UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_session_id UUID          NOT NULL REFERENCES public.audit_sessions(id) ON DELETE CASCADE,
  pillar           public.audit_pillar NOT NULL,
  severity         public.audit_severity NOT NULL DEFAULT 'MINOR',
  priority         INT           NOT NULL DEFAULT 3,  -- 1=highest, 5=lowest
  title            TEXT          NOT NULL,
  description      TEXT          NOT NULL,
  root_cause       TEXT,
  corrective_action TEXT,
  linked_question_id TEXT,       -- references audit_checklist_items.question_id
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recommendations_session_id
  ON public.audit_recommendations(audit_session_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_severity
  ON public.audit_recommendations(audit_session_id, severity, priority);

-- ── RLS: New tables ───────────────────────────────────────────────────────────

ALTER TABLE public.audit_prompt_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_critical_rules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_recommendations  ENABLE ROW LEVEL SECURITY;

-- Prompt versions: read-only for all authenticated
DROP POLICY IF EXISTS "Read prompt versions" ON public.audit_prompt_versions;
DROP POLICY IF EXISTS "Read prompt versions" ON public.audit_prompt_versions;
CREATE POLICY "Read prompt versions"
  ON public.audit_prompt_versions FOR SELECT TO authenticated USING (true);

-- Critical rules: read-only for all authenticated
DROP POLICY IF EXISTS "Read critical rules" ON public.audit_critical_rules;
DROP POLICY IF EXISTS "Read critical rules" ON public.audit_critical_rules;
CREATE POLICY "Read critical rules"
  ON public.audit_critical_rules FOR SELECT TO authenticated USING (true);

-- Recommendations: follow session ownership
DROP POLICY IF EXISTS "Read own recommendations" ON public.audit_recommendations;
DROP POLICY IF EXISTS "Read own recommendations" ON public.audit_recommendations;
CREATE POLICY "Read own recommendations"
  ON public.audit_recommendations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.audit_sessions s
      WHERE s.id = audit_session_id AND s.auditor_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Insert own recommendations" ON public.audit_recommendations;
DROP POLICY IF EXISTS "Insert own recommendations" ON public.audit_recommendations;
CREATE POLICY "Insert own recommendations"
  ON public.audit_recommendations FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.audit_sessions s
      WHERE s.id = audit_session_id AND s.auditor_id = auth.uid()
    )
  );

-- ── TRIGGER: Template Immutability (Refinement #6) ───────────────────────────
-- Active templates cannot be structurally modified. Only status changes allowed.

CREATE OR REPLACE FUNCTION public.enforce_template_immutability()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow status changes (ACTIVE → DEPRECATED/ARCHIVED) and updated_at
  IF OLD.status = 'ACTIVE' AND (
    NEW.name            IS DISTINCT FROM OLD.name    OR
    NEW.description     IS DISTINCT FROM OLD.description OR
    NEW.version         IS DISTINCT FROM OLD.version OR
    NEW.is_default      IS DISTINCT FROM OLD.is_default
  ) THEN
    RAISE EXCEPTION
      'ARCOLAB-IMMUTABLE: Active audit template "%" (id: %) cannot be modified. '
      'Create a new template version instead.',
      OLD.name, OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_template_immutability ON public.audit_templates;
CREATE TRIGGER trg_template_immutability
  BEFORE UPDATE ON public.audit_templates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_template_immutability();

-- ── SEED: Default AI Prompt Versions ─────────────────────────────────────────

DO $$
BEGIN
  -- Vision Audit Prompt v1.0
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_prompt_versions
    WHERE prompt_type = 'VISION_AUDIT' AND version = '1.0'
  ) THEN
    INSERT INTO public.audit_prompt_versions
      (prompt_type, version, vision_model, temperature, schema_version, prompt_text, is_active)
    VALUES (
      'VISION_AUDIT',
      '1.0',
      'gemini-1.5-pro',
      0.10,
      '2.0',
      'You are a certified industrial 5S workplace auditor. Analyze the provided workplace image and answer ONLY the questions listed below for the {PILLAR} pillar. You must respond with a valid JSON array only — no markdown, no prose, no scores, no percentages. For each question, provide: question_id (string), answer (one of: YES/NO/PARTIAL/NOT_VISIBLE/NOT_APPLICABLE), confidence (number 0.0-1.0), evidence (one concise observation sentence describing exactly what you see that justifies your answer). Use NOT_VISIBLE if the relevant area/object is outside the camera frame or obscured. Use NOT_APPLICABLE if the question clearly does not apply to this type of workspace. Never assign numeric scores. Never calculate percentages. You are only observing and answering.',
      true
    );
  END IF;

  -- Recommendations Prompt v1.0
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_prompt_versions
    WHERE prompt_type = 'RECOMMENDATIONS' AND version = '1.0'
  ) THEN
    INSERT INTO public.audit_prompt_versions
      (prompt_type, version, vision_model, temperature, schema_version, prompt_text, is_active)
    VALUES (
      'RECOMMENDATIONS',
      '1.0',
      'gemini-1.5-pro',
      0.30,
      '2.0',
      'You are a 5S continuous improvement consultant. Based on the following audit findings (list of failed/partial checklist items with their evidence), generate actionable improvement recommendations. Respond with a valid JSON array only. Each item must have: pillar (string), severity (CRITICAL/MAJOR/MINOR), priority (integer 1-5, 1=highest), title (short action title), description (detailed description), root_cause (why this issue likely exists), corrective_action (specific steps to fix it), linked_question_id (the question_id this addresses). Never assign scores. Focus only on observations and corrective actions.',
      true
    );
  END IF;

  -- Image Prompt Generator v1.0
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_prompt_versions
    WHERE prompt_type = 'IMAGE_PROMPT' AND version = '1.0'
  ) THEN
    INSERT INTO public.audit_prompt_versions
      (prompt_type, version, vision_model, temperature, schema_version, prompt_text, is_active)
    VALUES (
      'IMAGE_PROMPT',
      '1.0',
      'gemini-1.5-pro',
      0.40,
      '2.0',
      'You are an industrial workplace design expert. Based on the 5S audit findings below, write a detailed image generation prompt describing an idealized, fully 5S-compliant version of the same workspace. The prompt should describe: organized tools in labeled shadow boards, clean floors, clear walkway markings, proper storage systems, visual management boards, and zero clutter. The generated image should look realistic and photographable, like a professional industrial photograph. Output only the image generation prompt text — nothing else.',
      true
    );
  END IF;
END$$;

-- ── SEED: Critical Rules for default template ─────────────────────────────────

DO $$
DECLARE
  v_template_id  UUID;
  v_item_id      UUID;
BEGIN
  -- Get default template
  SELECT id INTO v_template_id FROM public.audit_templates WHERE is_default = true LIMIT 1;

  IF v_template_id IS NOT NULL THEN
    -- Rule: Blocked aisles/walkways → cap SET_IN_ORDER at 50%
    SELECT id INTO v_item_id
    FROM public.audit_checklist_items
    WHERE template_id = v_template_id
      AND pillar = 'SORT'
      AND question_text ILIKE '%aisles%walkways%'
    LIMIT 1;

    IF v_item_id IS NOT NULL THEN
      UPDATE public.audit_checklist_items SET severity = 'CRITICAL' WHERE id = v_item_id;
      INSERT INTO public.audit_critical_rules
        (template_id, checklist_item_id, pillar, trigger_answer, score_cap, description)
      VALUES
        (v_template_id, v_item_id, 'SET_IN_ORDER', 'NO', 50.00,
         'Blocked aisles are a safety hazard. Set-in-Order score capped at 50% until resolved.')
      ON CONFLICT DO NOTHING;
    END IF;

    -- Rule: Cleaning schedules not posted → cap SHINE at 60%
    SELECT id INTO v_item_id
    FROM public.audit_checklist_items
    WHERE template_id = v_template_id
      AND pillar = 'SHINE'
      AND question_text ILIKE '%cleaning schedule%'
    LIMIT 1;

    IF v_item_id IS NOT NULL THEN
      UPDATE public.audit_checklist_items SET severity = 'MAJOR' WHERE id = v_item_id;
    END IF;

    -- Rule: Safety markings not visible → cap STANDARDIZE at 40%
    SELECT id INTO v_item_id
    FROM public.audit_checklist_items
    WHERE template_id = v_template_id
      AND pillar = 'STANDARDIZE'
      AND question_text ILIKE '%safety marking%'
    LIMIT 1;

    IF v_item_id IS NOT NULL THEN
      UPDATE public.audit_checklist_items SET severity = 'CRITICAL' WHERE id = v_item_id;
      INSERT INTO public.audit_critical_rules
        (template_id, checklist_item_id, pillar, trigger_answer, score_cap, description)
      VALUES
        (v_template_id, v_item_id, 'STANDARDIZE', 'NO', 40.00,
         'Missing safety markings are a compliance violation. Standardize score capped at 40%.')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END$$;

COMMIT;


-- =============================================================================
-- MIGRATION: 20260629100000_phase2a_hardening.sql
-- =============================================================================

-- ============================================================
-- Phase 2A: Production Hardening & Analytics Readiness
-- Migration: 20260629100000_phase2a_hardening.sql
-- ============================================================

BEGIN;

-- ── 1. EXTEND SCHEMA ─────────────────────────────────────────────────────────

-- Template Hierarchy
ALTER TABLE public.audit_templates
  ADD COLUMN IF NOT EXISTS industry       TEXT,
  ADD COLUMN IF NOT EXISTS department     TEXT,
  ADD COLUMN IF NOT EXISTS workspace_type TEXT;

-- Question Categories
ALTER TABLE public.audit_checklist_items
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'General';

ALTER TABLE public.audit_session_items
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'General';

-- Workspace Context, Confidence and Analytics Report
ALTER TABLE public.audit_sessions
  ADD COLUMN IF NOT EXISTS industry               TEXT,
  ADD COLUMN IF NOT EXISTS department             TEXT,
  ADD COLUMN IF NOT EXISTS workspace_type         TEXT,
  ADD COLUMN IF NOT EXISTS expected_equipment     TEXT,
  ADD COLUMN IF NOT EXISTS expected_safety_assets TEXT,
  ADD COLUMN IF NOT EXISTS audit_confidence       NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS explainability_report  JSONB;

-- Audit Reasoning Metadata
ALTER TABLE public.audit_item_responses
  ADD COLUMN IF NOT EXISTS reasoning   TEXT,
  ADD COLUMN IF NOT EXISTS observation TEXT;

-- ── 2. UPDATE SNAPSHOT TRIGGER ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.snapshot_checklist_items()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.audit_session_items (
        audit_session_id,
        original_checklist_item_id,
        pillar,
        question_text,
        description,
        max_points,
        weight,
        display_order,
        is_mandatory,
        severity,
        question_id,
        category
    )
    SELECT
        NEW.id,
        id,
        pillar,
        question_text,
        description,
        max_points,
        weight,
        display_order,
        is_mandatory,
        severity,
        question_id,
        category
    FROM public.audit_checklist_items
    WHERE template_id = NEW.template_id
    ORDER BY pillar, display_order;

    -- Initialise max_score from the template
    UPDATE public.audit_sessions
    SET max_score  = (
            SELECT COALESCE(SUM(max_points * weight), 0)
            FROM public.audit_checklist_items
            WHERE template_id = NEW.template_id
        ),
        updated_at = now()
    WHERE id = NEW.id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 3. SEED HIERARCHICAL TEMPLATES ───────────────────────────────────────────

-- Helper function to seed questions easily
CREATE OR REPLACE FUNCTION public.seed_audit_question(
  p_template_id UUID,
  p_pillar public.audit_pillar,
  p_category TEXT,
  p_q_id TEXT,
  p_text TEXT,
  p_desc TEXT,
  p_order INT,
  p_severity public.audit_severity DEFAULT 'MINOR'
) RETURNS VOID AS $$
BEGIN
  INSERT INTO public.audit_checklist_items (
    template_id, pillar, category, question_id, question_text, description, max_points, weight, display_order, severity, is_mandatory
  ) VALUES (
    p_template_id, p_pillar, p_category, p_q_id, p_text, p_desc, 4, 1.00, p_order, p_severity, true
  );
END;
$$ LANGUAGE plpgsql;

-- Seed Templates DO block
DO $$
DECLARE
  v_assembly_id UUID;
  v_cnc_id      UUID;
  v_wh_id       UUID;
  v_office_id   UUID;
  v_lab_id      UUID;
  v_maint_id    UUID;
BEGIN
  -- Clear any existing seeded hierarchical templates to prevent duplicate violations on rerun
  DELETE FROM public.audit_templates WHERE industry IN ('Manufacturing', 'Warehouse', 'Office', 'Laboratory', 'Maintenance');

  -- ── TEMPLATE 1: Manufacturing Assembly Line ─────────────────────────────────
  INSERT INTO public.audit_templates (name, description, version, status, is_default, industry, department, workspace_type)
  VALUES (
    'Manufacturing Assembly Line Template',
    'Specialized 5S audit checklist tailored for manual and semi-automated assembly line areas.',
    '1.0', 'ACTIVE', false, 'Manufacturing', 'Assembly', 'Assembly Line'
  ) RETURNING id INTO v_assembly_id;

  -- SORT
  PERFORM public.seed_audit_question(v_assembly_id, 'SORT', 'Clutter', 'ASM_SRT_01', 'Are raw materials and assembly components sorted with clear boundary separation?', 'Check for unneeded clutter on assembly workstations.', 1);
  PERFORM public.seed_audit_question(v_assembly_id, 'SORT', 'Waste', 'ASM_SRT_02', 'Are empty bins, packing boxes, and protective plastics removed from assembly tables?', 'Prevent packing waste from taking up active workbench space.', 2);
  PERFORM public.seed_audit_question(v_assembly_id, 'SORT', 'Inventory', 'ASM_SRT_03', 'Is inventory at the assembly station limited to the current production shift requirements?', 'Excess parts should not restrict movement.', 3, 'MAJOR');
  PERFORM public.seed_audit_question(v_assembly_id, 'SORT', 'Obstructions', 'ASM_SRT_04', 'Are pedestrian walkways and assembly line pathways completely free of obstructions?', 'Ensure zero safety hazards along pathways.', 4, 'CRITICAL');
  PERFORM public.seed_audit_question(v_assembly_id, 'SORT', 'Waste', 'ASM_SRT_05', 'Are scrap metal, cut wires, or rejected materials segregated and put in designated scrap bins?', 'Ensure immediate disposal of raw waste.', 5);

  -- SET IN ORDER
  PERFORM public.seed_audit_question(v_assembly_id, 'SET_IN_ORDER', 'Tool Organization', 'ASM_ORD_01', 'Are hand tools, torque wrenches, and jigs stored in labeled shadow boards?', 'Check for tool outlines and labels.', 1, 'MAJOR');
  PERFORM public.seed_audit_question(v_assembly_id, 'SET_IN_ORDER', 'Labels', 'ASM_ORD_02', 'Are all parts bins clearly labeled with component codes and barcodes?', 'Visual check for barcode readability and correct labeling.', 2);
  PERFORM public.seed_audit_question(v_assembly_id, 'SET_IN_ORDER', 'Floor Markings', 'ASM_ORD_03', 'Are floor lanes for assembly carts, AGVs, and workers clearly marked with lines?', 'Check tape condition and lane continuity.', 3);
  PERFORM public.seed_audit_question(v_assembly_id, 'SET_IN_ORDER', 'Storage', 'ASM_ORD_04', 'Are workstations, cabinets, and storage shelves labeled with their contents?', 'Verify shelf layouts match labels.', 4);
  PERFORM public.seed_audit_question(v_assembly_id, 'SET_IN_ORDER', 'Tool Organization', 'ASM_ORD_05', 'Is there a dedicated layout spot for pneumatic lines and electrical cables?', 'Keep cables off floors and benches to prevent tripping.', 5);

  -- SHINE
  PERFORM public.seed_audit_question(v_assembly_id, 'SHINE', 'Cleanliness', 'ASM_SHN_01', 'Is the workstation bench surface clean and free of dust, grease, or liquids?', 'Wipe test for residue.', 1);
  PERFORM public.seed_audit_question(v_assembly_id, 'SHINE', 'Cleanliness', 'ASM_SHN_02', 'Is the assembly line floor clean and free of oil drips or water puddles?', 'No slip hazards.', 2, 'CRITICAL');
  PERFORM public.seed_audit_question(v_assembly_id, 'SHINE', 'Waste Disposal', 'ASM_SHN_03', 'Are recycling, waste, and hazard containers labeled and not overflowing?', 'Verify waste disposal protocol is followed.', 3);
  PERFORM public.seed_audit_question(v_assembly_id, 'SHINE', 'Dust', 'ASM_SHN_04', 'Are ventilation ducts and light fixtures clean and free of thick dust accumulation?', 'Ensure workspace air quality.', 4);
  PERFORM public.seed_audit_question(v_assembly_id, 'SHINE', 'Cleanliness', 'ASM_SHN_05', 'Are cleaning tools (brooms, microfibers) clean and stored in their proper rack?', 'Do not leave dirty cleaning items on the floor.', 5);

  -- STANDARDIZE
  PERFORM public.seed_audit_question(v_assembly_id, 'STANDARDIZE', 'Documented Standards', 'ASM_STD_01', 'Are 5S visual standards (Before/After sheets) posted nearby?', 'Look for visual management boards.', 1);
  PERFORM public.seed_audit_question(v_assembly_id, 'STANDARDIZE', 'Visual Indicators', 'ASM_STD_02', 'Are kanban cards and progress boards fully updated?', 'Verify visual metrics are current.', 2);
  PERFORM public.seed_audit_question(v_assembly_id, 'STANDARDIZE', 'Uniformity', 'ASM_STD_03', 'Are standard workstations laid out identically across the assembly bay?', 'Ensure setup uniformity.', 3);
  PERFORM public.seed_audit_question(v_assembly_id, 'STANDARDIZE', 'Safety Markings', 'ASM_STD_04', 'Are safety zones around high-voltage or hot equipment clearly demarcated?', 'Check safety lines and labels.', 4, 'CRITICAL');
  PERFORM public.seed_audit_question(v_assembly_id, 'STANDARDIZE', 'Documented Standards', 'ASM_STD_05', 'Are standard work instructions (SOPs) present and readable at each station?', 'SOPs must be in sight.', 5);

  -- SUSTAIN
  PERFORM public.seed_audit_question(v_assembly_id, 'SUSTAIN', 'Schedule Adherence', 'ASM_SST_01', 'Is the daily 5S cleaning log signed off by the shift supervisor?', 'Verify the logs.', 1);
  PERFORM public.seed_audit_question(v_assembly_id, 'SUSTAIN', 'Communication', 'ASM_SST_02', 'Are the latest 5S audit scores displayed on the team bulletin board?', 'Ensure public score board communication.', 2);
  PERFORM public.seed_audit_question(v_assembly_id, 'SUSTAIN', 'Employee Awareness', 'ASM_SST_03', 'Do operators demonstrate awareness of standard 5S practices in discussions?', 'Evaluate verbal compliance.', 3);
  PERFORM public.seed_audit_question(v_assembly_id, 'SUSTAIN', 'Correction Closure', 'ASM_SST_04', 'Are prior corrective action issues resolved and documented on the tracking sheet?', 'Check action logs.', 4, 'MAJOR');
  PERFORM public.seed_audit_question(v_assembly_id, 'SUSTAIN', 'Schedule Adherence', 'ASM_SST_05', 'Is there evidence of active leader involvement in 5S check walks?', 'Verify leadership sign-off.', 5);


  -- ── TEMPLATE 2: Warehouse Storage Racks ─────────────────────────────────────
  INSERT INTO public.audit_templates (name, description, version, status, is_default, industry, department, workspace_type)
  VALUES (
    'Warehouse Storage Rack Area Template',
    'Specialized 5S checklist tailored for storage racking, pallet zones, and forklift pathways.',
    '1.0', 'ACTIVE', false, 'Warehouse', 'Logistics', 'Storage Rack Area'
  ) RETURNING id INTO v_wh_id;

  -- SORT
  PERFORM public.seed_audit_question(v_wh_id, 'SORT', 'Clutter', 'WH_SRT_01', 'Are broken pallets, loose shrink wrap, and scrap bands disposed of?', 'Remove hazardous packing clutter.', 1, 'CRITICAL');
  PERFORM public.seed_audit_question(v_wh_id, 'SORT', 'Waste', 'WH_SRT_02', 'Are unneeded packaging materials, boxes, and cardboard collected and flattened?', 'Clear packaging waste.', 2);
  PERFORM public.seed_audit_question(v_wh_id, 'SORT', 'Inventory', 'WH_SRT_03', 'Are there any dead stock or unidentified pallets sitting in active walkways?', 'Pathways must be clear.', 3, 'MAJOR');
  PERFORM public.seed_audit_question(v_wh_id, 'SORT', 'Obstructions', 'WH_SRT_04', 'Are fire doors, extinguishers, and electrical panels fully clear of pallets?', 'Strict safety access check.', 4, 'CRITICAL');
  PERFORM public.seed_audit_question(v_wh_id, 'SORT', 'Waste', 'WH_SRT_05', 'Are damaged inventory items quarantined and moved to the designated repair zone?', 'Damaged items must be isolated.', 5);

  -- SET IN ORDER
  PERFORM public.seed_audit_question(v_wh_id, 'SET_IN_ORDER', 'Storage', 'WH_ORD_01', 'Are all storage racks labeled with shelf coordinates and maximum load capacities?', 'Ensure rack label visibility.', 1, 'MAJOR');
  PERFORM public.seed_audit_question(v_wh_id, 'SET_IN_ORDER', 'Floor Markings', 'WH_ORD_02', 'Are pallet parking zones and staging areas clearly marked on the floor?', 'Pallet boundaries must be painted.', 2);
  PERFORM public.seed_audit_question(v_wh_id, 'SET_IN_ORDER', 'Labels', 'WH_ORD_03', 'Are warehouse aisles, safety exits, and walkways marked with yellow/black floor tape?', 'Aisle visibility check.', 3, 'CRITICAL');
  PERFORM public.seed_audit_question(v_wh_id, 'SET_IN_ORDER', 'Storage', 'WH_ORD_04', 'Are picking locations labeled correctly and match inventory stock records?', 'Inventory location accuracy.', 4);
  PERFORM public.seed_audit_question(v_wh_id, 'SET_IN_ORDER', 'Tool Organization', 'WH_ORD_05', 'Are shipping tools, packing tape guns, and scanning devices stored in designated slots?', 'Audit tool storage boards.', 5);

  -- SHINE
  PERFORM public.seed_audit_question(v_wh_id, 'SHINE', 'Cleanliness', 'WH_SHN_01', 'Are storage rack shelves clean and free of dust, loose cardboard, or spilled liquids?', 'Rack cleanliness check.', 1);
  PERFORM public.seed_audit_question(v_wh_id, 'SHINE', 'Cleanliness', 'WH_SHN_02', 'Are floors clean and free of forklift tire marks, oil spills, or water?', 'Floor cleaning check.', 2, 'CRITICAL');
  PERFORM public.seed_audit_question(v_wh_id, 'SHINE', 'Dust', 'WH_SHN_03', 'Are high-level racking structures, columns, and walls free of cobwebs and dust?', 'Dust check.', 3);
  PERFORM public.seed_audit_question(v_wh_id, 'SHINE', 'Waste Disposal', 'WH_SHN_04', 'Are waste, plastic wrap, and cardboard bins placed correctly and emptied before overload?', 'Bin check.', 4);
  PERFORM public.seed_audit_question(v_wh_id, 'SHINE', 'Cleanliness', 'WH_SHN_05', 'Are spill response kits fully stocked, accessible, and clean?', 'Verify emergency equipment.', 5, 'MAJOR');

  -- STANDARDIZE
  PERFORM public.seed_audit_question(v_wh_id, 'STANDARDIZE', 'Safety Markings', 'WH_STD_01', 'Are load height limit lines visible on storage racks?', 'Racks must have maximum height lines.', 1);
  PERFORM public.seed_audit_question(v_wh_id, 'STANDARDIZE', 'Documented Standards', 'WH_STD_02', 'Are 5S warehouse map, layout rules, and standards posted at the aisle entry?', 'Check visual map boards.', 2);
  PERFORM public.seed_audit_question(v_wh_id, 'STANDARDIZE', 'Visual Indicators', 'WH_STD_03', 'Are safety signs (wear vests, speed limit, forklift traffic) clearly posted?', 'Warehouse safety postings.', 3, 'CRITICAL');
  PERFORM public.seed_audit_question(v_wh_id, 'STANDARDIZE', 'Uniformity', 'WH_STD_04', 'Is warehouse color coding for bins (cardboard vs plastic wrap) followed uniformly?', 'Uniform bins audit.', 4);
  PERFORM public.seed_audit_question(v_wh_id, 'STANDARDIZE', 'Safety Markings', 'WH_STD_05', 'Are rack columns fitted with yellow safety corner protectors?', 'Verify protector integrity.', 5);

  -- SUSTAIN
  PERFORM public.seed_audit_question(v_wh_id, 'SUSTAIN', 'Schedule Adherence', 'WH_SST_01', 'Are daily aisle checks completed and signed off?', 'Aisle logs signoff.', 1);
  PERFORM public.seed_audit_question(v_wh_id, 'SUSTAIN', 'Communication', 'WH_SST_02', 'Are weekly warehouse 5S metrics published and shared?', 'Ensure board metrics updates.', 2);
  PERFORM public.seed_audit_question(v_wh_id, 'SUSTAIN', 'Employee Awareness', 'WH_SST_03', 'Are pickers and forklift drivers wearing correct PPE (vests, steel toes)?', 'PPE safety check.', 3, 'CRITICAL');
  PERFORM public.seed_audit_question(v_wh_id, 'SUSTAIN', 'Correction Closure', 'WH_SST_04', 'Are previous audit issues resolved?', 'Action tracker check.', 4);
  PERFORM public.seed_audit_question(v_wh_id, 'SUSTAIN', 'Schedule Adherence', 'WH_SST_05', 'Is there management verification of 5S compliance?', 'Verify leadership signature.', 5);


  -- ── TEMPLATE 3: Office Desk Area ────────────────────────────────────────────
  INSERT INTO public.audit_templates (name, description, version, status, is_default, industry, department, workspace_type)
  VALUES (
    'Office Desk Workspace Template',
    'Specialized 5S audit checklist tailored for office desks, shared cabins, and printer zones.',
    '1.0', 'ACTIVE', false, 'Office', 'Administration', 'Office Desk Area'
  ) RETURNING id INTO v_office_id;

  -- SORT
  PERFORM public.seed_audit_question(v_office_id, 'SORT', 'Clutter', 'OFC_SRT_01', 'Are unnecessary papers, sticky notes, and old documents shredded or archived?', 'Desk paper clutter.', 1);
  PERFORM public.seed_audit_question(v_office_id, 'SORT', 'Waste', 'OFC_SRT_02', 'Are empty bottles, lunch wraps, and cardboard clutter cleared from the desk?', 'Remove desk waste.', 2);
  PERFORM public.seed_audit_question(v_office_id, 'SORT', 'Inventory', 'OFC_SRT_03', 'Are old, broken office supplies (pens, staplers) discarded?', 'Discard supply clutter.', 3);
  PERFORM public.seed_audit_question(v_office_id, 'SORT', 'Obstructions', 'OFC_SRT_04', 'Are walkways, doorways, and corridors clear of file boxes or surplus chairs?', 'Corridor check.', 4, 'MAJOR');
  PERFORM public.seed_audit_question(v_office_id, 'SORT', 'Waste', 'OFC_SRT_05', 'Are files and digital data stored correctly on the cloud/drives instead of desk files?', 'Reduce storage footprint.', 5);

  -- SET IN ORDER
  PERFORM public.seed_audit_question(v_office_id, 'SET_IN_ORDER', 'Storage', 'OFC_ORD_01', 'Are documents stored in labeled files and binders in the cabinets?', 'Cabinet filing organization.', 1);
  PERFORM public.seed_audit_question(v_office_id, 'SET_IN_ORDER', 'Storage', 'OFC_ORD_02', 'Are desk drawers labeled and divided for specific office supplies?', 'Drawer audit.', 2);
  PERFORM public.seed_audit_question(v_office_id, 'SET_IN_ORDER', 'Labels', 'OFC_ORD_03', 'Are shared equipment (printers, shredders, laminators) clearly marked with visual instructions?', 'Equipment labeling.', 3);
  PERFORM public.seed_audit_question(v_office_id, 'SET_IN_ORDER', 'Storage', 'OFC_ORD_04', 'Are computer monitors, keyboards, and phones clean and aligned?', 'Desk layout uniformity.', 4);
  PERFORM public.seed_audit_question(v_office_id, 'SET_IN_ORDER', 'Tool Organization', 'OFC_ORD_05', 'Are power cords and computer cables organized with ties and kept out of walkways?', 'Cable tidiness.', 5, 'MAJOR');

  -- SHINE
  PERFORM public.seed_audit_question(v_office_id, 'SHINE', 'Cleanliness', 'OFC_SHN_01', 'Are desk surfaces wiped clean and free of dust, coffee stains, or crumbs?', 'Wipe check.', 1);
  PERFORM public.seed_audit_question(v_office_id, 'SHINE', 'Cleanliness', 'OFC_SHN_02', 'Is the office carpet clean and free of visible dirt or stains?', 'Carpet check.', 2);
  PERFORM public.seed_audit_question(v_office_id, 'SHINE', 'Dust', 'OFC_SHN_03', 'Are computer vents, screens, and printer trays free of dust?', 'Screen dust check.', 3);
  PERFORM public.seed_audit_question(v_office_id, 'SHINE', 'Waste Disposal', 'OFC_SHN_04', 'Are trash and paper shredder bins emptied regularly and not overflowing?', 'Bin check.', 4);
  PERFORM public.seed_audit_question(v_office_id, 'SHINE', 'Cleanliness', 'OFC_SHN_05', 'Are keyboards and mice clean and periodically sanitized?', 'Sanitation audit.', 5);

  -- STANDARDIZE
  PERFORM public.seed_audit_question(v_office_id, 'STANDARDIZE', 'Documented Standards', 'OFC_STD_01', 'Are office desk 5S guidelines visible or shared digitally?', 'Verify guideline visibility.', 1);
  PERFORM public.seed_audit_question(v_office_id, 'STANDARDIZE', 'Visual Indicators', 'OFC_STD_02', 'Are shared binders color-coded and clearly labeled to identify missing binders easily?', 'Binder color check.', 2);
  PERFORM public.seed_audit_question(v_office_id, 'STANDARDIZE', 'Uniformity', 'OFC_STD_03', 'Is the standard Clean Desk policy followed at the end of shifts?', 'Clean desk rule adherence.', 3);
  PERFORM public.seed_audit_question(v_office_id, 'STANDARDIZE', 'Safety Markings', 'OFC_STD_04', 'Are electrical wall plates and safety markers around heaters in good condition?', 'Safety markings.', 4);
  PERFORM public.seed_audit_question(v_office_id, 'STANDARDIZE', 'Documented Standards', 'OFC_STD_05', 'Is there a digital file naming standard followed for archiving project documents?', 'Digital standard.', 5);

  -- SUSTAIN
  PERFORM public.seed_audit_question(v_office_id, 'SUSTAIN', 'Schedule Adherence', 'OFC_SST_01', 'Are monthly desk self-audits performed and tracked?', 'Self-audit check.', 1);
  PERFORM public.seed_audit_question(v_office_id, 'SUSTAIN', 'Communication', 'OFC_SST_02', 'Are office 5S results reviewed and communicated during departmental meetings?', 'Verify board metrics.', 2);
  PERFORM public.seed_audit_question(v_office_id, 'SUSTAIN', 'Employee Awareness', 'OFC_SST_03', 'Do office employees demonstrate awareness of desk standard practices?', 'Verify awareness.', 3);
  PERFORM public.seed_audit_question(v_office_id, 'SUSTAIN', 'Correction Closure', 'OFC_SST_04', 'Are previous desk issues closed out?', 'Action log check.', 4);
  PERFORM public.seed_audit_question(v_office_id, 'SUSTAIN', 'Schedule Adherence', 'OFC_SST_05', 'Is there evidence of active leader involvement in office audits?', 'Leadership signature.', 5);


  -- ── TEMPLATE 4: Laboratory Area ─────────────────────────────────────────────
  INSERT INTO public.audit_templates (name, description, version, status, is_default, industry, department, workspace_type)
  VALUES (
    'Chemical Lab Template',
    'Specialized 5S audit checklist tailored for chemical, biological, or QC laboratories.',
    '1.0', 'ACTIVE', false, 'Laboratory', 'R&D', 'Chemical Lab'
  ) RETURNING id INTO v_lab_id;

  -- SORT
  PERFORM public.seed_audit_question(v_lab_id, 'SORT', 'Clutter', 'LAB_SRT_01', 'Are expired chemical reagents, old slides, and samples disposed of?', 'Lab clutter check.', 1, 'MAJOR');
  PERFORM public.seed_audit_question(v_lab_id, 'SORT', 'Waste', 'LAB_SRT_02', 'Are used pipettes, gloves, and paper towels disposed of immediately?', 'Biological waste check.', 2, 'CRITICAL');
  PERFORM public.seed_audit_question(v_lab_id, 'SORT', 'Inventory', 'LAB_SRT_03', 'Are chemical bottles at workbenches limited to active testing quantities?', 'Bench chemical volume check.', 3);
  PERFORM public.seed_audit_question(v_lab_id, 'SORT', 'Obstructions', 'LAB_SRT_04', 'Are emergency eye-wash stations and safety showers free of equipment/boxes?', 'Extremely critical safety check.', 4, 'CRITICAL');
  PERFORM public.seed_audit_question(v_lab_id, 'SORT', 'Waste', 'LAB_SRT_05', 'Are hazardous materials quarantined and stored in correct cabinets?', 'Hazard containment audit.', 5, 'CRITICAL');

  -- SET IN ORDER
  PERFORM public.seed_audit_question(v_lab_id, 'SET_IN_ORDER', 'Storage', 'LAB_ORD_01', 'Are chemical reagent bottles stored alphabetically or by hazard group in labeled racks?', 'Chemical shelf ordering.', 1, 'MAJOR');
  PERFORM public.seed_audit_question(v_lab_id, 'SET_IN_ORDER', 'Labels', 'LAB_ORD_02', 'Are hazardous chemicals stored in color-coded safety cabinets?', 'Cabinet color markers.', 2, 'CRITICAL');
  PERFORM public.seed_audit_question(v_lab_id, 'SET_IN_ORDER', 'Storage', 'LAB_ORD_03', 'Are lab glassware and tools stored in designated racks or shadow boxes?', 'Glassware storage.', 3);
  PERFORM public.seed_audit_question(v_lab_id, 'SET_IN_ORDER', 'Labels', 'LAB_ORD_04', 'Are sample containers labeled with contents, researcher name, and date?', 'Reagent labels.', 4);
  PERFORM public.seed_audit_question(v_lab_id, 'SET_IN_ORDER', 'Tool Organization', 'LAB_ORD_05', 'Are analytical balances, hot plates, and equipment stored at designated points of use?', 'Equipment point of use.', 5);

  -- SHINE
  PERFORM public.seed_audit_question(v_lab_id, 'SHINE', 'Cleanliness', 'LAB_SHN_01', 'Are lab bench surfaces wiped clean and sanitized regularly?', 'Bench check.', 1);
  PERFORM public.seed_audit_question(v_lab_id, 'SHINE', 'Cleanliness', 'LAB_SHN_02', 'Are fume hoods clean and free of visible spills, stains, or corrosion?', 'Hood cleaning check.', 2, 'CRITICAL');
  PERFORM public.seed_audit_question(v_lab_id, 'SHINE', 'Waste Disposal', 'LAB_SHN_03', 'Are hazardous waste streams segregated into correct labeled containers?', 'Chemical waste sorting.', 3, 'CRITICAL');
  PERFORM public.seed_audit_question(v_lab_id, 'SHINE', 'Dust', 'LAB_SHN_04', 'Are balance scales and microscope lenses free of dust and residue?', 'Balance scale dust.', 4);
  PERFORM public.seed_audit_question(v_lab_id, 'SHINE', 'Cleanliness', 'LAB_SHN_05', 'Are spill response kits stocked, accessible, and clean?', 'Verify lab safety kits.', 5, 'MAJOR');

  -- STANDARDIZE
  PERFORM public.seed_audit_question(v_lab_id, 'STANDARDIZE', 'Documented Standards', 'LAB_STD_01', 'Are standard lab cleaning and safety standards visible?', 'Visual SOP check.', 1);
  PERFORM public.seed_audit_question(v_lab_id, 'STANDARDIZE', 'Safety Markings', 'LAB_STD_02', 'Are biohazard signs and hazard labels visible on storage cabinets?', 'Cabinet hazard labels.', 2, 'CRITICAL');
  PERFORM public.seed_audit_question(v_lab_id, 'STANDARDIZE', 'Visual Indicators', 'LAB_STD_03', 'Are gas cylinder lines color-coded and pressure status indicators operational?', 'Pressure indicators check.', 3, 'CRITICAL');
  PERFORM public.seed_audit_question(v_lab_id, 'STANDARDIZE', 'Safety Markings', 'LAB_STD_04', 'Are safety zones and evacuation paths clearly marked on floors?', 'Floor markings audit.', 4, 'CRITICAL');
  PERFORM public.seed_audit_question(v_lab_id, 'STANDARDIZE', 'Documented Standards', 'LAB_STD_05', 'Are SDS (Safety Data Sheets) binders updated and accessible?', 'SDS binder check.', 5);

  -- SUSTAIN
  PERFORM public.seed_audit_question(v_lab_id, 'SUSTAIN', 'Schedule Adherence', 'LAB_SST_01', 'Are weekly lab safety audits logged and signed off?', 'Safety log signoff.', 1);
  PERFORM public.seed_audit_question(v_lab_id, 'SUSTAIN', 'Communication', 'LAB_SST_02', 'Are lab audit results shared with team members?', 'Metrics updates board.', 2);
  PERFORM public.seed_audit_question(v_lab_id, 'SUSTAIN', 'Employee Awareness', 'LAB_SST_03', 'Are lab technicians wearing proper PPE (coat, goggles, gloves)?', 'PPE audit.', 3, 'CRITICAL');
  PERFORM public.seed_audit_question(v_lab_id, 'SUSTAIN', 'Correction Closure', 'LAB_SST_04', 'Are previous lab corrective actions closed out?', 'Action tracker check.', 4);
  PERFORM public.seed_audit_question(v_lab_id, 'SUSTAIN', 'Schedule Adherence', 'LAB_SST_05', 'Is there management verification of 5S compliance?', 'Verify leadership signature.', 5);


  -- ── TEMPLATE 5: Maintenance Workshop ────────────────────────────────────────
  INSERT INTO public.audit_templates (name, description, version, status, is_default, industry, department, workspace_type)
  VALUES (
    'Workshop Template',
    'Specialized 5S audit checklist tailored for facilities maintenance and tooling workshops.',
    '1.0', 'ACTIVE', false, 'Maintenance', 'Facilities', 'Workshop'
  ) RETURNING id INTO v_maint_id;

  -- SORT
  PERFORM public.seed_audit_question(v_maint_id, 'SORT', 'Clutter', 'MNT_SRT_01', 'Are broken parts, replaced motors, and scrap scrap metal disposed of?', 'Scrap clutter check.', 1);
  PERFORM public.seed_audit_question(v_maint_id, 'SORT', 'Waste', 'MNT_SRT_02', 'Are empty oil bottles, rags, and protective plastics cleared from work benches?', 'Remove workbench waste.', 2);
  PERFORM public.seed_audit_question(v_maint_id, 'SORT', 'Inventory', 'MNT_SRT_03', 'Are raw metals, spare fasteners, and parts limited to shift requirements?', 'Material pile check.', 3);
  PERFORM public.seed_audit_question(v_maint_id, 'SORT', 'Obstructions', 'MNT_SRT_04', 'Are emergency exits and high-voltage panels free of obstructions?', 'Strict panel access check.', 4, 'CRITICAL');
  PERFORM public.seed_audit_question(v_maint_id, 'SORT', 'Waste', 'MNT_SRT_05', 'Are damaged tools segregated and sent to repair or red-tag area?', 'Broken tools audit.', 5, 'MAJOR');

  -- SET IN ORDER
  PERFORM public.seed_audit_question(v_maint_id, 'SET_IN_ORDER', 'Tool Organization', 'MNT_ORD_01', 'Are maintenance tools organized in designated shadow boards or racks?', 'Tool outlines visibility check.', 1, 'MAJOR');
  PERFORM public.seed_audit_question(v_maint_id, 'SET_IN_ORDER', 'Labels', 'MNT_ORD_02', 'Are storage shelves and toolboxes clearly labeled with content codes?', 'Shelves label check.', 2);
  PERFORM public.seed_audit_question(v_maint_id, 'SET_IN_ORDER', 'Floor Markings', 'MNT_ORD_03', 'Are aisles, safety exits, and walkways marked with yellow/black floor tape?', 'Aisle visibility check.', 3, 'CRITICAL');
  PERFORM public.seed_audit_question(v_maint_id, 'SET_IN_ORDER', 'Storage', 'MNT_ORD_04', 'Are items returned to their designated location after use?', 'Audit items return.', 4);
  PERFORM public.seed_audit_question(v_maint_id, 'SET_IN_ORDER', 'Tool Organization', 'MNT_ORD_05', 'Are heavy equipment and welding carts parked inside designated yellow boundaries?', 'Cart boundaries painted.', 5);

  -- SHINE
  PERFORM public.seed_audit_question(v_maint_id, 'SHINE', 'Cleanliness', 'MNT_SHN_01', 'Are machine workshop workbench surfaces clean and free of oil, coolant, or grease?', 'Bench cleaning check.', 1);
  PERFORM public.seed_audit_question(v_maint_id, 'SHINE', 'Cleanliness', 'MNT_SHN_02', 'Are floors clean and free of oil leaks, puddles, or metal chips?', 'Slip and trip hazards check.', 2, 'CRITICAL');
  PERFORM public.seed_audit_question(v_maint_id, 'SHINE', 'Dust', 'MNT_SHN_03', 'Are workshop tool racks, columns, and walls free of cobwebs and thick dust?', 'Dust check.', 3);
  PERFORM public.seed_audit_question(v_maint_id, 'SHINE', 'Waste Disposal', 'MNT_SHN_04', 'Are oily rags placed inside dedicated closed metal bins?', 'Spontaneous combustion prevention.', 4, 'CRITICAL');
  PERFORM public.seed_audit_question(v_maint_id, 'SHINE', 'Cleanliness', 'MNT_SHN_05', 'Are spill response kits stocked, accessible, and clean?', 'Verify safety response kits.', 5, 'MAJOR');

  -- STANDARDIZE
  PERFORM public.seed_audit_question(v_maint_id, 'STANDARDIZE', 'Documented Standards', 'MNT_STD_01', 'Are 5S workshop guidelines posted nearby?', 'Look for visual management boards.', 1);
  PERFORM public.seed_audit_question(v_maint_id, 'STANDARDIZE', 'Visual Indicators', 'MNT_STD_02', 'Are tool boards colored to distinguish standard metrics vs imperial sockets?', 'Socket color indicators.', 2);
  PERFORM public.seed_audit_question(v_maint_id, 'STANDARDIZE', 'Uniformity', 'MNT_STD_03', 'Are standard workstation setups laid out identically?', 'Setup uniformity.', 3);
  PERFORM public.seed_audit_question(v_maint_id, 'STANDARDIZE', 'Safety Markings', 'MNT_STD_04', 'Are safety zones around welding tables and grinders demarcated?', 'Safety lines audit.', 4, 'CRITICAL');
  PERFORM public.seed_audit_question(v_maint_id, 'STANDARDIZE', 'Safety Markings', 'MNT_STD_05', 'Are rack columns fitted with safety protectors?', 'Verify protector integrity.', 5);

  -- SUSTAIN
  PERFORM public.seed_audit_question(v_maint_id, 'SUSTAIN', 'Schedule Adherence', 'MNT_SST_01', 'Are daily workshop checks completed and signed off?', 'Logs signoff check.', 1);
  PERFORM public.seed_audit_question(v_maint_id, 'SUSTAIN', 'Communication', 'MNT_SST_02', 'Are weekly workshop 5S metrics published and shared?', 'Metrics updates board.', 2);
  PERFORM public.seed_audit_question(v_maint_id, 'SUSTAIN', 'Employee Awareness', 'MNT_SST_03', 'Do workshop workers wear steel toes, safety glasses, and ear plugs?', 'PPE audit.', 3, 'CRITICAL');
  PERFORM public.seed_audit_question(v_maint_id, 'SUSTAIN', 'Correction Closure', 'MNT_SST_04', 'Are previous workshop corrective actions closed out?', 'Action tracker check.', 4);
  PERFORM public.seed_audit_question(v_maint_id, 'SUSTAIN', 'Schedule Adherence', 'MNT_SST_05', 'Is there management verification of 5S compliance?', 'Verify leadership signature.', 5);

END$$;

-- Drop temporary helper function
DROP FUNCTION IF EXISTS public.seed_audit_question(UUID, public.audit_pillar, TEXT, TEXT, TEXT, TEXT, INT, public.audit_severity);

COMMIT;


-- =============================================================================
-- MIGRATION: 20260701000000_phase2a1_custom_rules.sql
-- =============================================================================

-- ============================================================
-- Phase 2A.1: Custom Rules Table
-- Migration: 20260701000000_phase2a1_custom_rules.sql
-- ============================================================
-- Adds the audit_custom_rules table for Tier 2 of the hybrid Rule Engine.
-- Organisation-specific compliance rules that load at runtime without
-- requiring a function redeployment.
-- ============================================================

BEGIN;

-- ── 1. Create audit_custom_rules table ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_custom_rules (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope: which template these rules apply to
  template_id     UUID        NOT NULL
                  REFERENCES  public.audit_templates(id) ON DELETE CASCADE,

  -- Unique rule identifier (stable, never change after production deploy)
  rule_id         TEXT        NOT NULL,

  -- Optional pillar filter (NULL = applies to all pillars)
  pillar          public.audit_pillar,

  -- Optional category filter (NULL = applies to all categories)
  category        TEXT,

  -- JSON-serialised condition descriptor.
  -- Supported types: has_hazard | has_obstruction | cleanliness | floor_markings |
  --                  labels_visible | storage_present | no_detected_objects |
  --                  safety_equipment_absent | non_compliant_count_gte
  -- Example: { "type": "cleanliness", "value": "DIRTY" }
  condition_json  JSONB       NOT NULL,

  -- The deterministic answer this rule produces when condition is met
  answer          TEXT        NOT NULL
                  CHECK (answer IN ('YES','NO','PARTIAL','NOT_VISIBLE','NOT_APPLICABLE')),

  -- Confidence level for this rule's answer (0.00–1.00)
  confidence      NUMERIC(3,2) NOT NULL DEFAULT 0.95
                  CHECK (confidence BETWEEN 0 AND 1),

  -- Human-readable explanation stored in audit trace
  rationale       TEXT,

  -- Enable/disable without deleting
  is_active       BOOLEAN     NOT NULL DEFAULT true,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Indexes ────────────────────────────────────────────────────────────────

-- Fast lookup per template (called on every audit)
CREATE INDEX IF NOT EXISTS idx_custom_rules_template_active
  ON public.audit_custom_rules (template_id, is_active)
  WHERE is_active = true;

-- Optional filter by pillar
CREATE INDEX IF NOT EXISTS idx_custom_rules_template_pillar
  ON public.audit_custom_rules (template_id, pillar)
  WHERE is_active = true;

-- ── 3. Row-Level Security ─────────────────────────────────────────────────────

ALTER TABLE public.audit_custom_rules ENABLE ROW LEVEL SECURITY;

-- Edge functions (service role) can manage all rules
DROP POLICY IF EXISTS "Service role can manage custom rules" ON public.audit_custom_rules;
CREATE POLICY "Service role can manage custom rules"
  ON public.audit_custom_rules
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read active rules
DROP POLICY IF EXISTS "Authenticated users can read custom rules" ON public.audit_custom_rules;
CREATE POLICY "Authenticated users can read custom rules"
  ON public.audit_custom_rules
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- ── 4. Updated_at trigger ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_custom_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_custom_rules_updated_at
  BEFORE UPDATE ON public.audit_custom_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_custom_rules_updated_at();

COMMIT;


-- =============================================================================
-- MIGRATION: 20260701000001_phase2a1_reliability_level.sql
-- =============================================================================

-- ============================================================
-- Phase 2A.1: Reliability Level Column
-- Migration: 20260701000001_phase2a1_reliability_level.sql
-- ============================================================
-- Adds the audit_reliability_level column to audit_sessions.
-- This stores the output of ReliabilityClassifier (EXCELLENT → REJECTED).
-- The value is INFORMATIONAL ONLY — it never modifies the audit score.
-- ============================================================

BEGIN;

-- ── 1. Add reliability level column to audit_sessions ────────────────────────

ALTER TABLE public.audit_sessions
  ADD COLUMN IF NOT EXISTS audit_reliability_level TEXT
  CHECK (audit_reliability_level IN ('EXCELLENT', 'HIGH', 'MEDIUM', 'LOW', 'REJECTED'));

COMMENT ON COLUMN public.audit_sessions.audit_reliability_level IS
  'Reliability classification assigned by ReliabilityClassifier after each audit. '
  'INFORMATIONAL ONLY — never used in score calculations. '
  'Values: EXCELLENT | HIGH | MEDIUM | LOW | REJECTED. '
  'REJECTED means the audit was flagged but is still saved and scored normally. '
  'Phase 2A.1 — set by analyze-5s edge function.';

-- ── 2. Index for analytics and reliability-based filtering ───────────────────

CREATE INDEX IF NOT EXISTS idx_audit_sessions_reliability_level
  ON public.audit_sessions (audit_reliability_level)
  WHERE audit_reliability_level IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_sessions_reliability_confidence
  ON public.audit_sessions (audit_reliability_level, audit_confidence DESC)
  WHERE audit_reliability_level IS NOT NULL;

-- ── 3. Update existing sessions to 'MEDIUM' as a safe default ────────────────
-- New sessions will have this set correctly by the function.
-- Historical sessions that predate 2A.1 get a neutral default.

UPDATE public.audit_sessions
SET audit_reliability_level = 'MEDIUM'
WHERE audit_reliability_level IS NULL
  AND status = 'COMPLETED';

COMMIT;


-- =============================================================================
-- MIGRATION: 20260702000000_phase2a3_version_metadata.sql
-- =============================================================================

-- ============================================================
-- Phase 2A.3: Engine Version Metadata Columns
-- Migration: 20260702000000_phase2a3_version_metadata.sql
-- ============================================================
-- Adds version metadata columns to audit_sessions to record exact sub-module
-- versions used for every audit, supporting long-term reproducibility.
-- ============================================================

BEGIN;

ALTER TABLE public.audit_sessions
  ADD COLUMN IF NOT EXISTS engine_version                TEXT DEFAULT '2A.3',
  ADD COLUMN IF NOT EXISTS observation_schema_version    TEXT DEFAULT '2.0',
  ADD COLUMN IF NOT EXISTS scoring_engine_version        TEXT DEFAULT '2A.1',
  ADD COLUMN IF NOT EXISTS rule_engine_version           TEXT DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS recommendation_engine_version  TEXT DEFAULT '2A.1';

COMMENT ON COLUMN public.audit_sessions.engine_version IS 'Overall engine orchestration version';
COMMENT ON COLUMN public.audit_sessions.observation_schema_version IS 'Observation schema structure version';
COMMENT ON COLUMN public.audit_sessions.scoring_engine_version IS 'Scoring logic module version';
COMMENT ON COLUMN public.audit_sessions.rule_engine_version IS 'Rule engine logic version';
COMMENT ON COLUMN public.audit_sessions.recommendation_engine_version IS 'Recommendation logic module version';

COMMIT;


-- =============================================================================
-- MIGRATION: 20260702000001_phase2a3_analytics.sql
-- =============================================================================

-- ============================================================
-- Phase 2A.3: Analytics Infrastructure
-- Migration: 20260702000001_phase2a3_analytics.sql
-- ============================================================
-- Adds indexes to optimize common analytics queries and 2 minimum reporting views.
-- ============================================================

BEGIN;

-- ── 1. Create Analytics Indexes ──────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sessions_industry_date
  ON public.audit_sessions (industry, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_dept_date
  ON public.audit_sessions (department, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_confidence
  ON public.audit_sessions (audit_confidence DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_reliability
  ON public.audit_sessions (audit_reliability_level);

CREATE INDEX IF NOT EXISTS idx_responses_session_answer
  ON public.audit_item_responses (audit_session_id, ai_answer);

CREATE INDEX IF NOT EXISTS idx_responses_question
  ON public.audit_item_responses (ai_question_id);

CREATE INDEX IF NOT EXISTS idx_recommendations_session_priority
  ON public.audit_recommendations (audit_session_id, priority ASC);

CREATE INDEX IF NOT EXISTS idx_recommendations_pillar_severity
  ON public.audit_recommendations (pillar, severity);

-- ── 2. Create Minimum Required Views (Exactly 2 views) ───────────────────────

-- View 1: Session summary view (avoids repeated complex JSON parsing in queries)
CREATE OR REPLACE VIEW public.v_audit_session_summary AS
SELECT
  s.id,
  s.status,
  s.created_at,
  s.industry,
  s.department,
  s.workspace_type,
  s.audit_confidence,
  s.audit_reliability_level,
  s.engine_version,
  (s.score_breakdown->>'overall_percentage')::NUMERIC AS overall_percentage,
  (s.score_breakdown->>'grade')::TEXT               AS grade
FROM public.audit_sessions s;

-- View 2: Question failure rates (to support "most failed questions" analytics)
CREATE OR REPLACE VIEW public.v_question_failure_rates AS
SELECT
  r.ai_question_id,
  COUNT(*)                                            AS total_responses,
  COUNT(*) FILTER (WHERE r.ai_answer = 'NO')          AS failed_count,
  COUNT(*) FILTER (WHERE r.ai_answer = 'PARTIAL')     AS partial_count,
  ROUND(
    COUNT(*) FILTER (WHERE r.ai_answer = 'NO')::NUMERIC
    / NULLIF(COUNT(*), 0) * 100, 1
  )                                                   AS failure_rate_pct
FROM public.audit_item_responses r
GROUP BY r.ai_question_id;

COMMIT;


-- =============================================================================
-- SEED DATA: Offices
-- =============================================================================

INSERT INTO public.offices (name, city, country) VALUES 
('Softgel Healthcare Private Limited', 'Chennai', 'India'),
('Solara Active Pharma Sciences Limited', 'Chennai', 'India'),
('Strides Pharma', 'Chennai', 'India')
ON CONFLICT (name, city) DO NOTHING;

-- =============================================================================
-- SEED DATA: Auth Users & Identities
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- User 1: ARC100 (Worker)
DO $$
DECLARE
  new_user_id UUID := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'arc100@arcolab.com') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_super_admin
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      new_user_id,
      'authenticated',
      'authenticated',
      'arc100@arcolab.com',
      crypt('ARCOLAB100', gen_salt('bf', 10)),
      now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      '{"first_name": "Shankar", "last_name": "R", "role": "worker", "employee_code": "ARC100"}'::jsonb,
      now(), now(), false
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      new_user_id,
      ('{"sub": "' || new_user_id || '", "email": "arc100@arcolab.com", "role": "worker", "first_name": "Shankar", "last_name": "R", "employee_code": "ARC100", "email_verified": true, "phone_verified": false}')::jsonb,
      'email',
      'arc100@arcolab.com',
      now(), now(), now()
    );
  END IF;
END $$;

-- User 2: ARC101 (Supervisor)
DO $$
DECLARE
  new_user_id UUID := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'arc101@arcolab.com') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_super_admin
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      new_user_id,
      'authenticated',
      'authenticated',
      'arc101@arcolab.com',
      crypt('ARCOLAB101', gen_salt('bf', 10)),
      now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      '{"first_name": "Naveen", "last_name": "SV", "role": "supervisor", "employee_code": "ARC101"}'::jsonb,
      now(), now(), false
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      new_user_id,
      ('{"sub": "' || new_user_id || '", "email": "arc101@arcolab.com", "role": "supervisor", "first_name": "Naveen", "last_name": "SV", "employee_code": "ARC101", "email_verified": true, "phone_verified": false}')::jsonb,
      'email',
      'arc101@arcolab.com',
      now(), now(), now()
    );
  END IF;
END $$;

-- User 3: ARC102 (Worker)
DO $$
DECLARE
  new_user_id UUID := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'arc102@arcolab.com') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_super_admin
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      new_user_id,
      'authenticated',
      'authenticated',
      'arc102@arcolab.com',
      crypt('ARCOLAB102', gen_salt('bf', 10)),
      now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      '{"first_name": "Guest", "last_name": "User", "role": "worker", "employee_code": "ARC102"}'::jsonb,
      now(), now(), false
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      new_user_id,
      ('{"sub": "' || new_user_id || '", "email": "arc102@arcolab.com", "role": "worker", "first_name": "Guest", "last_name": "User", "employee_code": "ARC102", "email_verified": true, "phone_verified": false}')::jsonb,
      'email',
      'arc102@arcolab.com',
      now(), now(), now()
    );
  END IF;
END $$;

-- User 4: ARC100 (Admin / Auditor)
DO $$
DECLARE
  new_user_id UUID := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'arc100@arcolab.com') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_super_admin
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      new_user_id,
      'authenticated',
      'authenticated',
      'arc100@arcolab.com',
      crypt('ARCOLAB100', gen_salt('bf', 10)),
      now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      '{"first_name": "Vijay", "last_name": "Ramesh", "role": "admin", "employee_code": "ARC100"}'::jsonb,
      now(), now(), false
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      new_user_id,
      ('{"sub": "' || new_user_id || '", "email": "arc100@arcolab.com", "role": "admin", "first_name": "Vijay", "last_name": "Ramesh", "employee_code": "ARC100", "email_verified": true, "phone_verified": false}')::jsonb,
      'email',
      'arc100@arcolab.com',
      now(), now(), now()
    );
  END IF;
END $$;
