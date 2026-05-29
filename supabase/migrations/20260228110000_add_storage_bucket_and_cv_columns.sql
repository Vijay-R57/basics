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
CREATE POLICY "Service role can upload 5s images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = '5s-images');

-- Policy: Service role / edge functions can read/download images
CREATE POLICY "Service role can read 5s images"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = '5s-images');

-- Policy: Anyone can read if they have the signed URL (for display in frontend)
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
