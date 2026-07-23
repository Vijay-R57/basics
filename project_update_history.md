# ARCOLAB 5S Insight - Project Update History & Phase Record

This document provides a chronological record of development phases, key updates, and architecture evolution for the ARCOLAB 5S Insight application.

---

## 📈 Summary of Development Phases

```mermaid
timeline
    title ARCOLAB 5S Insight Evolution
    2026-03-12 : Phase 1: Core CV Integration & Pipeline Setup
               : - Initial application foundation & UI pages
               : - Supabase Storage integration & Edge functions
               : - Basic CV engine scoring & mock pipelines
    2026-03-14 : Phase 2: Mobile-First Geotagging & Camera Workflow
               : - Built live mediaDevices viewfinder
               : - GeoTag details: GPS coordinates, Office, Zone
               : - Database schema migrations for metadata persistence
    2026-04-14 : Phase 3: Deployment & Routing Optimization
               : - Added Vercel wildcard SPA routing rules
    2026-05-29 : Phase 4: Production Calibration & Hardening
               : - Added Before/After Comparisons, Progress Tracking
               : - Calibrated metrics & removed false-positive obstructions
               : - Added Production DB architecture & resolved Employee login 500 errors
    2026-07-19 : Phase 5: Prompt Refinement & Rating Documentation
               : - Integrated strict Uncertainty Contract rules in prompt
               : - Created detailed rating definitions and scoring maps
    2026-07-23 : Phase 6: The Main Golden Pipeline & Supabase Architecture
               : - Mapped Main GOLDENPIPELINE Architecture
               : - 20-Question Vision Perception & Interactive Questionnaire Trigger Flow
               : - Supabase SSR, Edge Functions & Idempotent Master Database Schema
               : - Fail-Safe Authentication & Facility Check-In Flow
```

---

## 📂 Detailed Phase Chronology

### 🔹 Phase 1: CV Engine Integration & Pipeline Setup (March 12, 2026)
* **Goal**: Establish the primary workspace foundation and hook up initial API contracts.
* **Commit Reference**: `a598416`
* **Key Achievements & Deliverables**:
  * **Application Core**: Configured React, TypeScript, Vite, TailwindCSS, and shadcn/ui boilerplate.
  * **User Interfaces**: Created landing page, 5S Analysis capture dashboard, History logs viewer, Lean Maintenance info pages, and User Profiles.
  * **Serverless Backend**: Programmed initial Deno-based Supabase Edge Functions:
    * `analyze-5s`: Interfaces with the computer vision engine.
    * `employee-login`: Resolves staff IDs and handles sessions.
    * `save-analysis-log`: Stores raw scoring outputs into the database.
  * **Database Architecture**: Implemented base SQL schemas establishing storage buckets, users, and audit log structures.

---

### 🔹 Phase 2: Mobile-First Geotagging & Camera Viewfinder (March 14 - 16, 2026)
* **Goal**: Enable direct field captures from mobile cameras, gathering precise metadata (GPS coordinates, offices, and zones) to ensure audit accountability.
* **Commit References**: `2d1ed01`, `391a464`, `fbd24d9`, `7fed725`, `6738d65`
* **Key Achievements & Deliverables**:
  * **Interactive Camera**: Rebuilt the `ImageUploader` component with an active camera viewfinder via `navigator.mediaDevices.getUserMedia`.
  * **Metadata Collection**:
    * Structured a **GeoTag Details** card capturing exact latitude/longitude coordinates, employee ID, designated office location, specific zone, and timestamps.
    * Added a floating overlay to quickly download captured frames locally.
  * **Database Schema Extension**: Added migration `20260314001935_add_geotag_columns.sql` adding `latitude`, `longitude`, `office_id`, `zone`, and `employee_id` attributes to persistent logs.
  * **Resilience Fixes**:
    * Fixed mobile Chrome failure points in non-HTTPS (insecure context) scenarios by providing graceful image file upload fallbacks.
    * Decoupled GPS loading using background worker execution to prevent camera feed freezes.
    * Added guest credential testing profile `ARC102`.

---

### 🔹 Phase 3: Deployment Routing Optimization (April 14, 2026)
* **Goal**: Resolve hydration and client routing issues post-deployment.
* **Commit Reference**: `5d17d07`
* **Key Achievements & Deliverables**:
  * **Vercel Config**: Created `vercel.json` rewrite profiles and a fallback `/public/_redirects` rule to direct all sub-paths back to the client-side SPA router, preventing hard `404 Not Found` responses on page refresh.

---

### 🔹 Phase 4: Production Hardening & Advanced Metrics Calibration (May 29, 2026)
* **Goal**: Deliver precise score calibrations, rich UX features, and fix enterprise auth schema bottlenecks.
* **Commit References**: `d9c531e`, `7c5c83a`, `cf4dbe1`
* **Key Achievements & Deliverables**:
  * **UX Upgrade**: Added advanced feedback modules:
    * `BeforeAfterComparison`: Visual slider contrasting the audited space against baseline standard workspace conditions.
    * `AnalysisProgress`: Informative loader showing steps (Uploading image, Performing CV check, Validating compliance, Saving results).
    * `ScoreExplanationCard`: Breaks down 5S scores (Sort, Set in Order, Shine, Standardize, Sustain) with dynamic contextual advice.
  * **CV Calibrations**: Fine-tuned scoring thresholds to eliminate false-positive obstruction detections, improving precision.
  * **Database Architecture Migration**: Executed `20260521210500_production_database_architecture.sql` to optimize office mappings and scale table relationships for production.
  * **Critical Bug Fixes**:
    * Resolved an **HTTP 500 error** in the `employee-login` edge function originating from a schema mismatch during table queries.
    * Standardized the API communication hook `useAnalysisPipeline` to handle state transitions smoothly.
    * Created `deterministic.test.ts` to ensure consistent execution.

---

### 🔹 Phase 5: Prompt Refinement & Rating Documentation (July 19, 2026)
* **Goal**: Establish strict Uncertainty Contract behavior in the Gemini prompt and compile comprehensive rating and scoring logic documentation.
* **Commit Reference**: `7b12f5c`
* **Key Achievements & Deliverables**:
  * **Prompt Refinement (Uncertainty Contract)**: Programmed strict average rating fallback rules when visual evidence is insufficient, preventing descriptive variance or overrides.
  * **Rating Definitions**: Created [rating_definitions.md](file:///c:/Users/Vijay%20Ramesh/5S/basics/rating_definitions.md) documenting VERY_GOOD, GOOD, AVERAGE, BAD, and VERY_BAD ratings, compliance answer mappings, and evidence consistency controls.
  * **Scoring Mapping**: Created [scoring_mapping.md](file:///c:/Users/Vijay%20Ramesh/5S/basics/scoring_mapping.md) documenting scoring conversions, pillar score calculations, overall score formulas, and grade/color thresholds.

---

### 🌟 Phase 6: The Main GOLDENPIPELINE Integration (July 23, 2026)
* **Goal**: Map and establish `GOLDENPIPELINE` as the authoritative main production baseline for 5S Audit Analysis, interactive questionnaire triggers, Supabase SSR, Edge Functions, and database schema idempotency.
* **Branch Reference**: `GOLDENPIPELINE` (`6089343`)
* **Key Achievements & Deliverables**:
  * **Golden Pipeline Perception & Validation Engine**:
    * Programmed the **20 authoritative 5S audit questions** across **SORT**, **SET IN ORDER**, **SHINE**, **STANDARDIZE**, and **SUSTAIN**.
    * Enforced the **Visibility Decision Gate** and **Standardized Uncertainty Contract** (`rating: "AVERAGE"`, `confidence: 30`, `reason: "Cannot be determined from the provided image."`).
    * Application-owned mathematical scoring formula ($0-80$ max score, $0-100\%$ percentage, grade labels) completely decoupled from LLM output.
  * **Interactive Questionnaire Trigger Flow**:
    * Integrated interactive user assessment for undefined visual reason questions (`Cannot be determined...`).
    * Renders `👤 User Assessed` visual indicators in the pillar audit breakdown cards when confirmed by the auditor.
  * **Supabase SSR & Edge Functions**:
    * Integrated `@supabase/ssr` with browser client helpers ([frontend/src/utils/supabase/client.ts](file:///c:/Users/Vijay%20Ramesh/5S/basics/frontend/src/utils/supabase/client.ts)).
    * Deployed Deno Edge Functions `analyze-5s`, `employee-login`, and `save-analysis-log` to live Supabase project `fmvrphwhyjgavikgwzus`.
  * **Idempotent Master Database Architecture**:
    * Enhanced [database/setup-database.sql](file:///c:/Users/Vijay%20Ramesh/5S/basics/database/setup-database.sql) with `CREATE TABLE IF NOT EXISTS` and `DROP POLICY IF EXISTS` across all 11 core tables and `5s-images` storage bucket.
    * Seeded default user `ARC100` with password `ARCOLAB100` (`admin` role).
  * **Fail-Safe Authentication & Facility Check-In**:
    * Refined [Login.tsx](file:///c:/Users/Vijay%20Ramesh/5S/basics/frontend/src/pages/Login.tsx) to handle unseeded authentication states quietly and seamlessly transition into active sessions.
    * Configured facility cards in [OfficeSelection.tsx](file:///c:/Users/Vijay%20Ramesh/5S/basics/frontend/src/pages/OfficeSelection.tsx) (*Bengaluru Corporate Office, Mumbai Manufacturing Hub, Hyderabad R&D Center, Chennai Operations Site*).
