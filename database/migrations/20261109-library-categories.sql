-- Virtual Membership library preparation. Safe to rerun.
-- Adds the new catalog alongside the existing library. Does not copy, move,
-- delete, classify, or change any existing materials or other website tables.
BEGIN;

CREATE TABLE IF NOT EXISTS public.vm_library_series (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.vm_library_materials (
  id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL UNIQUE CHECK (length(trim(identity_key)) > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  url TEXT NOT NULL CHECK (url ~ '^https?://'),
  type TEXT NOT NULL DEFAULT 'recording'
    CHECK (type IN ('recording', 'playlist', 'course', 'resource')),
  presenter TEXT NOT NULL DEFAULT '',
  item_date TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '',
  embed_enabled BOOLEAN NOT NULL DEFAULT true,
  enabled BOOLEAN NOT NULL DEFAULT true,
  competency_reviewed BOOLEAN NOT NULL DEFAULT false,
  survey_reviewed BOOLEAN NOT NULL DEFAULT false,
  review_notes TEXT NOT NULL DEFAULT '',
  series_id TEXT REFERENCES public.vm_library_series(id) ON DELETE SET NULL,
  session_position INTEGER NOT NULL DEFAULT 0 CHECK (session_position >= 0),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.vm_library_tags (
  id TEXT PRIMARY KEY,
  taxonomy TEXT NOT NULL CHECK (taxonomy IN ('competency', 'survey')),
  slug TEXT NOT NULL CHECK (length(trim(slug)) > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (taxonomy, slug)
);

-- Connections represent approved category assignments. Suggested assignments
-- remain in review notes until an administrator confirms them.
CREATE TABLE IF NOT EXISTS public.vm_library_material_tags (
  material_id TEXT NOT NULL REFERENCES public.vm_library_materials(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES public.vm_library_tags(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (material_id, tag_id)
);

-- Preserve the old program/playlist locations while the catalog is reorganized.
CREATE TABLE IF NOT EXISTS public.vm_library_material_sources (
  material_id TEXT NOT NULL REFERENCES public.vm_library_materials(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES public.vm_library_resources(id) ON DELETE CASCADE,
  source_title TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (material_id, resource_id)
);

CREATE INDEX IF NOT EXISTS vm_library_material_tags_by_tag
  ON public.vm_library_material_tags(tag_id, material_id);
CREATE INDEX IF NOT EXISTS vm_library_material_sources_by_resource
  ON public.vm_library_material_sources(resource_id, material_id);
CREATE INDEX IF NOT EXISTS vm_library_materials_by_series
  ON public.vm_library_materials(series_id, session_position);

INSERT INTO public.vm_library_tags (id, taxonomy, slug, name, position) VALUES
  ('competency-patient-care', 'competency', 'patient-care', 'Patient Care and Procedural Skills', 1),
  ('competency-medical-knowledge', 'competency', 'medical-knowledge', 'Medical Knowledge', 2),
  ('competency-practice-based-learning', 'competency', 'practice-based-learning', 'Practice-Based Learning and Improvement', 3),
  ('competency-communication', 'competency', 'communication', 'Interpersonal and Communication Skills', 4),
  ('competency-professionalism', 'competency', 'professionalism', 'Professionalism', 5),
  ('competency-systems-based-practice', 'competency', 'systems-based-practice', 'Systems-Based Practice', 6),
  ('survey-resources', 'survey', 'resources', 'Resources', 1),
  ('survey-professionalism', 'survey', 'professionalism', 'Professionalism', 2),
  ('survey-patient-safety-teamwork', 'survey', 'patient-safety-teamwork', 'Patient Safety and Teamwork', 3),
  ('survey-faculty-teaching-supervision', 'survey', 'faculty-teaching-supervision', 'Faculty Teaching and Supervision', 4),
  ('survey-evaluation', 'survey', 'evaluation', 'Evaluation', 5),
  ('survey-educational-content', 'survey', 'educational-content', 'Educational Content', 6),
  ('survey-heterogeneous-patient-populations', 'survey', 'heterogeneous-patient-populations', 'Heterogeneous Patient Populations', 7),
  ('survey-clinical-experience-education', 'survey', 'clinical-experience-education', 'Clinical Experience and Education', 8)
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN public.vm_library_materials.identity_key IS
  'Stable deduplication key, for example youtube:<video-id>. A title alone is not an identity.';
COMMENT ON COLUMN public.vm_library_materials.competency_reviewed IS
  'True only after competency mapping review is complete. Can be false while some approved tags exist.';
COMMENT ON COLUMN public.vm_library_materials.survey_reviewed IS
  'True only after survey mapping review is complete. Additional Topics requires both reviews complete and zero tag connections.';
COMMENT ON TABLE public.vm_library_material_sources IS
  'Original library placements retained for traceability; unrelated to ACGME assignments.';

ALTER TABLE public.vm_library_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vm_library_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vm_library_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vm_library_material_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vm_library_material_sources ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.vm_library_series, public.vm_library_materials,
  public.vm_library_tags, public.vm_library_material_tags, public.vm_library_material_sources
  FROM PUBLIC, anon, authenticated;

COMMIT;

-- Expected result: competency = 6, survey = 8 on the first run.
SELECT taxonomy, count(*) AS category_count
FROM public.vm_library_tags
GROUP BY taxonomy
ORDER BY taxonomy;
