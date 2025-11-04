
-- Add screenshots column to scm_knowledge table
ALTER TABLE scm_knowledge 
ADD COLUMN IF NOT EXISTS screenshots text[] DEFAULT '{}';

-- Update existing entries with screenshots
UPDATE scm_knowledge 
SET screenshots = ARRAY[
  '/documents/issues/screenshots/issue-01-new-item-error.png',
  '/documents/issues/screenshots/issue-01-item-facilities.png'
]
WHERE scn_code = 'ISSUE-01';

UPDATE scm_knowledge 
SET screenshots = ARRAY[
  '/documents/issues/screenshots/issue-02-ocl-error.png',
  '/documents/issues/screenshots/issue-02-consolidation-locations.png'
]
WHERE scn_code = 'ISSUE-02';

UPDATE scm_knowledge 
SET screenshots = ARRAY[
  '/documents/issues/screenshots/issue-03-quantity-error.png',
  '/documents/issues/screenshots/issue-03-item-facilities.jpg'
]
WHERE scn_code = 'ISSUE-03';
