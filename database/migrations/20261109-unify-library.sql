-- Consolidate subject categories and featured-program imports in the new catalog.
BEGIN;
ALTER TABLE public.vm_library_tags DROP CONSTRAINT IF EXISTS vm_library_tags_taxonomy_check;
ALTER TABLE public.vm_library_tags ADD CONSTRAINT vm_library_tags_taxonomy_check CHECK(taxonomy IN ('competency','survey','topic'));
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM public.vm_settings WHERE key='catalog-topics-v1') THEN
INSERT INTO public.vm_library_tags(id,taxonomy,slug,name,description,position,enabled)
SELECT 'topic-'||slug,'topic',slug,name,description,position,enabled FROM public.vm_library_programs
ON CONFLICT DO NOTHING;
INSERT INTO public.vm_library_material_tags(material_id,tag_id)
SELECT DISTINCT s.material_id,t.id FROM public.vm_library_material_sources s
JOIN public.vm_library_resources r ON r.id=s.resource_id
JOIN public.vm_library_tags t ON t.taxonomy='topic' AND t.slug=r.program_slug
ON CONFLICT DO NOTHING;
INSERT INTO public.vm_settings(key,value) VALUES('catalog-topics-v1','applied');
END IF; END $$;
CREATE TABLE IF NOT EXISTS public.vm_library_event_imports (
 event_key text PRIMARY KEY,
 material_id text REFERENCES public.vm_library_materials(id) ON DELETE SET NULL,
 manual boolean NOT NULL DEFAULT false,
 suppressed boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true
);
INSERT INTO public.vm_library_event_imports(event_key,material_id,manual,suppressed,active)
SELECT DISTINCT ON(i.event_key) i.event_key,s.material_id,true,i.suppressed<>0,i.active<>0
FROM public.vm_imported_programs i
LEFT JOIN public.vm_library_material_sources s ON s.resource_id=i.resource_id
ORDER BY i.event_key,s.material_id
ON CONFLICT DO NOTHING;
ALTER TABLE public.vm_library_event_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vm_library_event_imports FROM PUBLIC,anon,authenticated;
COMMIT;
SELECT count(*) AS subject_categories FROM public.vm_library_tags WHERE taxonomy='topic';
