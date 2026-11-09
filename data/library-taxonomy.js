// Shared browsing rules for the catalog API and admin review workflow.
// Tags passed here include all assigned tags, even if a category is disabled.
export function materialReviewState(material) {
  const tags = Array.isArray(material.tags) ? material.tags : [];
  const competencyReviewed = material.competencyReviewed === true;
  const surveyReviewed = material.surveyReviewed === true;
  return {
    needsReview: !competencyReviewed || !surveyReviewed,
    additionalTopics: competencyReviewed && surveyReviewed && !tags.some(t => t.taxonomy !== 'topic'),
  };
}

export function materialMatchesBrowse(material, { view = 'all', tagId = '' } = {}) {
  if (material.enabled === false) return false;
  if (view === 'all') return true;
  if (view === 'additional') return materialReviewState(material).additionalTopics;
  if (!['competency','survey','topic'].includes(view)) return false;
  return (material.tags || []).some(tag => tag.enabled !== false && tag.taxonomy === view && tag.id === tagId);
}

export function memberCatalog(catalog) {
  return {
    tags: catalog.tags.filter(t => t.enabled).map(({ id, taxonomy, name, description }) => ({ id, taxonomy, name, description })),
    series: catalog.series.map(({ id, title, description, position }) => ({ id, title, description, position })),
    materials: catalog.materials.filter(m => m.enabled).map(m => ({
      id: m.id, title: m.title, url: m.url, type: m.type, presenter: m.presenter,
      itemDate: m.itemDate, description: m.description, meta: m.meta, embedEnabled: m.embedEnabled,
      seriesId: m.seriesId, sessionPosition: m.sessionPosition, position: m.position,
      additionalTopics: materialReviewState(m).additionalTopics,
      tags: m.tags.filter(t => t.enabled).map(({id,taxonomy,name}) => ({id,taxonomy,name})),
    })),
  };
}
