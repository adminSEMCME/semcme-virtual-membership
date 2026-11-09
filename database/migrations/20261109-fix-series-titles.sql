-- Correct punctuation damaged when the initial series titles were generated.
-- Only replaces the exact original damaged titles; preserves admin-renamed titles.
BEGIN;
UPDATE public.vm_library_series AS series
SET title=fix.correct_title,updated_at=CURRENT_TIMESTAMP
FROM (VALUES
  ('series-fd-series-1','Faculty Development ? Series 1','Faculty Development - Series 1'),
  ('series-fd-series-2','Faculty Development ? Series 2','Faculty Development - Series 2'),
  ('series-fd-series-3','Faculty Development ? Series 3','Faculty Development - Series 3'),
  ('series-fd-2021-2022-1','2021?2022 Faculty Development ? Series 1','2021-2022 Faculty Development - Series 1'),
  ('series-fd-2021-2022-2','2021?2022 Faculty Development ? Series 2','2021-2022 Faculty Development - Series 2'),
  ('series-reflective-writing-2022-2023','2022?2023 Reflective Writing','2022-2023 Reflective Writing'),
  ('series-snippet-development-2022-2023','2022?2023 Snippet Development','2022-2023 Snippet Development'),
  ('series-p4p-fall-2021','Preparing for Practice ? Fall 2021','Preparing for Practice - Fall 2021'),
  ('series-p4p-fall-2023','Preparing for Practice ? Fall 2023','Preparing for Practice - Fall 2023'),
  ('series-p4p-fall-2024','Preparing for Practice ? Fall 2024','Preparing for Practice - Fall 2024'),
  ('series-p4p-2025','Preparing for Practice ? 2025','Preparing for Practice - 2025'),
  ('series-home-buying','Physician?s Guide to Home Buying','Physician''s Guide to Home Buying')
) AS fix(id,old_title,correct_title)
WHERE series.id=fix.id AND series.title=fix.old_title;
COMMIT;
SELECT id,title FROM public.vm_library_series ORDER BY title;
