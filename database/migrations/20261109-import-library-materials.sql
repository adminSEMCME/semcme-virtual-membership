-- Copy existing VM materials into the new catalog. Original library stays intact.
-- Reads current database contents, including individual videos saved in playlists.
-- No category assignments or completed reviews are inferred. Safe to rerun:
-- existing catalog edits, tags, review decisions and series are preserved.
BEGIN;
LOCK TABLE public.vm_library_resources, public.vm_library_programs IN SHARE MODE;

CREATE TEMP TABLE vm_import_candidates ON COMMIT DROP AS
SELECT r.id AS resource_id, r.title AS source_title, r.program_slug, r.section,
       r.title, r.url, r.type, coalesce(r.presenter,'') AS presenter,
       coalesce(r.item_date,'') AS item_date, coalesce(r.meta,'') AS meta,
       r.embed_enabled, p.enabled, r.position, 0::bigint AS child_position
FROM public.vm_library_resources r
JOIN public.vm_library_programs p ON p.slug=r.program_slug
WHERE jsonb_array_length(coalesce(nullif(r.videos_json,''),'[]')::jsonb)=0
UNION ALL
SELECT r.id, r.title, r.program_slug, r.section,
       v.item->>'title', v.item->>'url', 'recording',
       coalesce(v.item->>'presenter',''), coalesce(v.item->>'date',''), '',
       r.embed_enabled, p.enabled, r.position, v.ordinality
FROM public.vm_library_resources r
JOIN public.vm_library_programs p ON p.slug=r.program_slug
CROSS JOIN LATERAL jsonb_array_elements(coalesce(nullif(r.videos_json,''),'[]')::jsonb)
  WITH ORDINALITY AS v(item,ordinality);

-- Fail visibly instead of silently omitting malformed materials.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM vm_import_candidates WHERE title IS NULL OR trim(title)=''
    OR url IS NULL OR url !~ '^https?://' OR type NOT IN ('recording','playlist','course','resource')) THEN
    RAISE EXCEPTION 'A source material has an invalid title, URL, or type. No import was committed.';
  END IF;
END $$;

ALTER TABLE vm_import_candidates ADD COLUMN identity_key text;
UPDATE vm_import_candidates SET url=split_part(trim(url),'#',1);
UPDATE vm_import_candidates SET identity_key = CASE
  WHEN url ~ '^https?://(www\.|m\.)?youtu\.be/[A-Za-z0-9_-]{11}([/?]|$)'
    THEN 'youtube:' || substring(url FROM '^https?://(?:www\.|m\.)?youtu\.be/([A-Za-z0-9_-]{11})')
  WHEN url ~ '^https?://(www\.|m\.)?youtube\.com/' AND url ~ '[?&]v=[A-Za-z0-9_-]{11}(&|$)'
    THEN 'youtube:' || substring(url FROM '[?&]v=([A-Za-z0-9_-]{11})(?:&|$)')
  WHEN url ~ '^https?://(www\.|m\.)?youtube\.com/(embed|shorts|live)/[A-Za-z0-9_-]{11}([/?]|$)'
    THEN 'youtube:' || substring(url FROM '^https?://(?:www\.|m\.)?youtube\.com/(?:embed|shorts|live)/([A-Za-z0-9_-]{11})')
  WHEN url ~ '^https?://(www\.|m\.)?(youtube\.com|youtu\.be)/' AND url ~ '[?&]list=[^&]+'
    THEN 'playlist:' || substring(url FROM '[?&]list=([^&]+)')
  ELSE 'url:' || encode(sha256(convert_to(url,'UTF8')),'hex') END;

-- Prefer standalone entries with presenter/date details over archive duplicates.
INSERT INTO public.vm_library_materials
  (id,identity_key,title,url,type,presenter,item_date,meta,embed_enabled,enabled,position)
SELECT 'import-' || md5(identity_key), identity_key, title,url,type,presenter,item_date,meta,embed_enabled,
  EXISTS (SELECT 1 FROM vm_import_candidates other WHERE other.identity_key=chosen.identity_key AND other.enabled),position
FROM (
  SELECT DISTINCT ON (identity_key) * FROM vm_import_candidates
  ORDER BY identity_key, (child_position=0) DESC,
    (length(presenter)+length(item_date)) DESC, program_slug, section, position, child_position, resource_id
) chosen
ON CONFLICT (identity_key) DO NOTHING;

INSERT INTO public.vm_library_material_sources (material_id,resource_id,source_title,position)
SELECT m.id,c.resource_id,
       string_agg(DISTINCT c.source_title || CASE WHEN c.child_position>0 THEN ' / ' || c.title ELSE '' END, ' | '),
       min(CASE WHEN c.child_position>0 THEN c.child_position ELSE c.position END)::integer
FROM vm_import_candidates c JOIN public.vm_library_materials m USING(identity_key)
GROUP BY m.id,c.resource_id
ON CONFLICT (material_id,resource_id) DO NOTHING;

-- Verify that every source placement has been represented before committing.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM vm_import_candidates c WHERE NOT EXISTS (
    SELECT 1 FROM public.vm_library_materials m
    JOIN public.vm_library_material_sources s ON s.material_id=m.id
    WHERE m.identity_key=c.identity_key AND s.resource_id=c.resource_id
  )) THEN RAISE EXCEPTION 'Import coverage check failed. No import was committed.'; END IF;
END $$;

SELECT (SELECT count(*) FROM public.vm_library_resources) AS original_library_entries,
       count(*) AS material_listings,
       count(DISTINCT identity_key) AS unique_imported_materials,
       count(*)-count(DISTINCT identity_key) AS repeated_listings_combined
FROM vm_import_candidates;
COMMIT;
