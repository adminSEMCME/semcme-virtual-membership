import assert from 'node:assert/strict';
import { materialReviewState, materialMatchesBrowse } from '../data/library-taxonomy.js';

const pending = { enabled: true, tags: [], competencyReviewed: false, surveyReviewed: false };
assert.equal(materialMatchesBrowse(pending), true);
assert.equal(materialMatchesBrowse(pending, { view: 'additional' }), false);
assert.equal(materialReviewState(pending).needsReview, true);
assert.equal(materialMatchesBrowse({ ...pending, competencyReviewed: true }, { view: 'additional' }), false);
const reviewed = { ...pending, competencyReviewed: true, surveyReviewed: true };
assert.equal(materialMatchesBrowse(reviewed, { view: 'additional' }), true);
const tagged = { ...pending, tags: [
  { id: 'communication', taxonomy: 'competency' },
  { id: 'professionalism', taxonomy: 'competency' },
  { id: 'evaluation', taxonomy: 'survey' },
] };
for (const tag of tagged.tags) {
  assert.equal(materialMatchesBrowse(tagged, { view: tag.taxonomy, tagId: tag.id }), true);
}
assert.equal(materialMatchesBrowse(tagged), true);
assert.equal(materialReviewState(tagged).needsReview, true);
assert.equal(materialMatchesBrowse({ ...tagged, competencyReviewed: true, surveyReviewed: true }, { view: 'additional' }), false);
assert.equal(materialMatchesBrowse(tagged, { view: 'survey', tagId: 'communication' }), false);
assert.equal(materialMatchesBrowse({ ...tagged, enabled: false }), false);
const disabledTag = { ...reviewed, tags: [{ id: 'disabled', taxonomy: 'survey', enabled: false }] };
assert.equal(materialMatchesBrowse(disabledTag, { view: 'additional' }), false);
assert.equal(materialMatchesBrowse(disabledTag, { view: 'survey', tagId: 'disabled' }), false);
console.log('PASS: All Materials, partial review, Additional Topics, multi-category placement, disabled materials and tags.');
