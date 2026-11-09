-- Group clearly numbered sessions. Existing categories and review status stay unchanged.
-- Refuses to replace a different series assignment. Safe to rerun.
BEGIN;
DO $groups$
DECLARE g jsonb; v record; material_id text; existing_series text;
BEGIN
 FOR g IN SELECT value FROM jsonb_array_elements($payload$[{"id": "series-fd-series-1", "title": "Faculty Development - Series 1", "videos": ["RW3R90R0hsQ", "pHE_1h8khqU", "a1gWtUav47o", "lsHy8-YGQmw"]}, {"id": "series-fd-series-2", "title": "Faculty Development - Series 2", "videos": ["iXvhHpwBWuQ", "tJudcHlPC-A", "VfXGLo7ZapM"]}, {"id": "series-fd-series-3", "title": "Faculty Development - Series 3", "videos": ["H2BygIRPdeo", "8QhLGJ2Ow14", "SAVDQe64ZvI", "5hvxzk-EfnI", "ANUNOHD7H50", "HaJMJraOEbg"]}, {"id": "series-fd-2021-2022-1", "title": "2021-2022 Faculty Development - Series 1", "videos": ["MtpDGMXudSo", "xffxAmOsizM", "DNwiI1fylrU"]}, {"id": "series-fd-2021-2022-2", "title": "2021-2022 Faculty Development - Series 2", "videos": ["dfqX95JhKvA", "5gZ1T5Xty3w"]}, {"id": "series-reflective-writing-2022-2023", "title": "2022-2023 Reflective Writing", "videos": ["-BcmiFzoi8s", "C_ZqqzH1JRM", "PnnHfUX9lFc"]}, {"id": "series-snippet-development-2022-2023", "title": "2022-2023 Snippet Development", "videos": ["wIlwNM5OCJE", "WPawyAKOt5k"]}, {"id": "series-coaching-in-gme", "title": "Coaching in GME", "videos": ["tAL9LP_xMLU", "RfnJSJeY1IQ", "zo3r0v1fTdI"]}, {"id": "series-p4p-fall-2021", "title": "Preparing for Practice - Fall 2021", "videos": ["HKx6fDL7haU", "TuIyom9jwis"]}, {"id": "series-p4p-fall-2023", "title": "Preparing for Practice - Fall 2023", "videos": ["srfe6vxPd3M", "AMJn4xo7zFs"]}, {"id": "series-p4p-fall-2024", "title": "Preparing for Practice - Fall 2024", "videos": ["LNH0F1Ofug0", "WWm0o8Nu6f4"]}, {"id": "series-p4p-2025", "title": "Preparing for Practice - 2025", "videos": ["FNuA7hZQetE", "drfV5pbHorc"]}, {"id": "series-finding-fulfillment", "title": "Finding Fulfillment Despite It All", "videos": ["bVSZLUGnP2g", "EwyMRpW83rQ"]}, {"id": "series-home-buying", "title": "Physician's Guide to Home Buying", "videos": ["qEAfADzdt_I", "qElG83GovBw"]}, {"id": "series-pediatric-2022", "title": "2022 Pediatric Lunch & Learn", "videos": ["ZEXpq6CevwA", "dEiefvfF9OA", "h3wZrsk9yTc", "4pPJ0T-zDDY"]}]$payload$::jsonb) LOOP
  INSERT INTO public.vm_library_series(id,title) VALUES(g->>'id',g->>'title') ON CONFLICT(id) DO NOTHING;
  FOR v IN SELECT value,ordinality FROM jsonb_array_elements_text(g->'videos') WITH ORDINALITY LOOP
   SELECT id,series_id INTO material_id,existing_series FROM public.vm_library_materials WHERE identity_key='youtube:'||v.value FOR UPDATE;
   IF material_id IS NULL THEN RAISE EXCEPTION 'Missing session %. Nothing committed.',v.value; END IF;
   IF existing_series IS NOT NULL AND existing_series<>g->>'id' THEN
    RAISE EXCEPTION 'Session % already belongs to a different series. Nothing committed.',v.value;
   END IF;
   UPDATE public.vm_library_materials SET series_id=g->>'id',session_position=v.ordinality,updated_at=CURRENT_TIMESTAMP
   WHERE id=material_id AND series_id IS NULL;
  END LOOP;
 END LOOP;
END $groups$;
COMMIT;
SELECT count(DISTINCT series_id) AS series_groups,count(*) AS grouped_materials
FROM public.vm_library_materials WHERE series_id IS NOT NULL;
