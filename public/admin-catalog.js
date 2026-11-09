export function initializeCatalogAdmin({ api, esc, confirmAction, withLoading }) {
  const $ = selector => document.querySelector(selector);
  const controls = $('#catalogControls');
  const status = $('#catalogStatus');
  const forms = { material: $('#catalogMaterialForm'), tag: $('#catalogTagForm'), series: $('#catalogSeriesForm') };
  const collections = { material: 'materials', tag: 'tags', series: 'series' };
  const labels = { material: 'material', tag: 'category', series: 'series' };
  let state = null;
  let busy = false;
  let generation = 0;
  const field = (form, name) => form.elements.namedItem(name);
  const selectedId = kind => field(forms[kind], 'id').value;
  const dirty = () => Object.values(forms).some(form => form.dataset.dirty === 'true');
  function message(value, success = false) {
    status.textContent = value;
    status.classList.toggle('success', success);
  }
  async function discard() {
    if (!dirty()) return true;
    return confirmAction({ title: 'Discard unsaved changes?', message: 'Your unsaved library edits will be replaced. Save them first if you want to keep them.', actionLabel: 'Discard changes', danger: true });
  }
  function materialPayload() {
    const form = forms.material;
    const data = new FormData(form);
    const payload = Object.fromEntries(data);
    payload.tagIds = data.getAll('tagIds');
    for (const key of ['enabled', 'embedEnabled', 'competencyReviewed', 'surveyReviewed']) payload[key] = field(form, key).checked;
    return payload;
  }
  function placement() {
    const data = materialPayload();
    let result;
    if (!data.enabled) result = 'This material is hidden from the updated member library.';
    else if (data.tagIds.length) result = `Will appear in All Materials and ${data.tagIds.length} selected ${data.tagIds.length === 1 ? 'category' : 'categories'} (when those categories are visible).`;
    else if (data.competencyReviewed && data.surveyReviewed) result = 'Both reviews are complete with no category connections: will appear in Additional Topics and All Materials.';
    else result = 'Mapping still needs review: will appear in All Materials only, not Additional Topics.';
    if (data.tagIds.length && (!data.competencyReviewed || !data.surveyReviewed)) result += ' Some mapping still needs review.';
    $('#catalogPlacement').textContent = result;
  }
  function tagChoices(material) {
    const selected = new Set((material?.tags || []).map(tag => tag.id));
    for (const [taxonomy, selector] of [['competency', '#catalogCompetencyTags'], ['survey', '#catalogSurveyTags']]) {
      $(selector).innerHTML = state.tags.filter(tag => tag.taxonomy === taxonomy).map(tag =>
        `<label><input type="checkbox" name="tagIds" value="${esc(tag.id)}" ${selected.has(tag.id) ? 'checked' : ''} /><span>${esc(tag.name)}${tag.enabled ? '' : ' (hidden category)'}</span></label>`).join('') || '<p>No categories in this group yet.</p>';
    }
  }
  function fill(kind, item = null) {
    const form = forms[kind];
    form.reset();
    if (kind === 'material') {
      field(form, 'seriesId').innerHTML = '<option value="">No series</option>' + state.series.map(series => `<option value="${esc(series.id)}">${esc(series.title)}</option>`).join('');
      tagChoices(item);
    }
    for (const element of form.elements) {
      if (!element.name || element.name === 'tagIds') continue;
      if (element.type === 'checkbox') element.checked = item ? item[element.name] === true : ['enabled', 'embedEnabled'].includes(element.name);
      else if (element.tagName !== 'BUTTON') element.value = item?.[element.name] ?? ({ type: 'recording', taxonomy: 'competency', position: '0', sessionPosition: '0' }[element.name] || '');
    }
    const suffix = kind === 'material' ? 'Material' : kind === 'tag' ? 'Tag' : 'Series';
    $('#catalog' + suffix + 'Heading').textContent = item ? `Edit ${labels[kind]}` : `Add ${kind === 'tag' ? 'a category' : kind === 'series' ? 'a series' : 'a material'}`;
    $('#catalogDelete' + suffix).hidden = !item;
    if (kind === 'tag') field(form, 'taxonomy').disabled = Boolean(item);
    if (kind === 'material') {
      $('#catalogSources').textContent = item?.sources?.length ? 'Original locations: ' + item.sources.map(source => [source.program, source.section, source.title].filter(Boolean).join(' / ')).join('; ') : '';
      placement();
    }
    form.dataset.dirty = 'false';
  }
  function renderLists() {
    const search = $('#catalogSearch').value.trim().toLowerCase();
    const filter = $('#catalogFilter').value;
    const materials = state.materials.filter(material => {
      if (filter === 'pending' && !material.needsReview) return false;
      if (filter === 'additional' && !material.additionalTopics) return false;
      if (filter === 'hidden' && material.enabled) return false;
      return [material.title, material.presenter, ...material.tags.map(tag => tag.name)].join(' ').toLowerCase().includes(search);
    });
    $('#catalogCount').textContent = `${materials.length} of ${state.materials.length} materials`;
    $('#catalogMaterialRows').innerHTML = materials.map(material => `<button type="button" data-catalog-kind="material" data-id="${esc(material.id)}" aria-current="${selectedId('material') === material.id}"><strong>${esc(material.title)}</strong><small>${esc([material.presenter, material.itemDate].filter(Boolean).join(' · '))}</small><small>${esc(material.tags.map(tag => tag.name).join(' · ') || (material.additionalTopics ? 'Additional Topics' : 'No categories assigned'))}</small><small>${material.enabled ? '' : 'Hidden · '}${material.needsReview ? 'Needs review' : 'Review complete'}</small></button>`).join('') || `<p>${state.materials.length ? 'No materials match these filters.' : 'No materials have been added to the new library yet. Add one here, or bring in the existing videos during the next preparation step.'}</p>`;
    $('#catalogTagRows').innerHTML = state.tags.map(tag => `<button type="button" data-catalog-kind="tag" data-id="${esc(tag.id)}" aria-current="${selectedId('tag') === tag.id}"><strong>${esc(tag.name)}</strong><small>${tag.taxonomy === 'competency' ? 'ACGME Competency' : 'ACGME Survey Area'} · ${state.materials.filter(material => material.tags.some(assigned => assigned.id === tag.id)).length} materials${tag.enabled ? '' : ' · Hidden'}</small></button>`).join('') || '<p>No categories yet.</p>';
    $('#catalogSeriesRows').innerHTML = state.series.map(series => `<button type="button" data-catalog-kind="series" data-id="${esc(series.id)}" aria-current="${selectedId('series') === series.id}"><strong>${esc(series.title)}</strong><small>${state.materials.filter(material => material.seriesId === series.id).length} materials</small></button>`).join('') || '<p>No series yet. Create a series to group related sessions.</p>';
  }
  async function refresh(selection = {}) {
    const requestGeneration = generation;
    const next = await api('/api/admin/catalog');
    if (requestGeneration !== generation) return;
    const ids = Object.fromEntries(Object.keys(forms).map(kind => [kind, selection[kind] ?? selectedId(kind)]));
    state = next;
    controls.hidden = false;
    for (const kind of Object.keys(forms)) fill(kind, state[collections[kind]].find(item => item.id === ids[kind]) || null);
    renderLists();
  }
  async function mutate(kind, method, payload, button) {
    if (busy) return;
    busy = true;
    controls.inert = true;
    $('#catalogRefresh').disabled = true;
    message(method === 'DELETE' ? 'Deleting...' : 'Saving...');
    let saved = false;
    try {
      const result = await withLoading(button, method === 'DELETE' ? 'Deleting...' : 'Saving...', () => api('/api/admin/catalog/' + kind, { method, body: JSON.stringify(payload) }));
      saved = true;
      await refresh({ [kind]: method === 'DELETE' ? '' : result.id });
      message(method === 'DELETE' ? `${labels[kind]} deleted.` : `${labels[kind]} saved.`, true);
    } catch (error) {
      message(saved ? 'Your change was saved, but the list could not refresh. Use Refresh library before editing again.' : error.message);
    } finally {
      busy = false;
      controls.inert = false;
      $('#catalogRefresh').disabled = false;
      status.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
  for (const [kind, form] of Object.entries(forms)) {
    form.addEventListener('input', () => { form.dataset.dirty = 'true'; if (kind === 'material') placement(); });
    form.addEventListener('change', () => { form.dataset.dirty = 'true'; if (kind === 'material') placement(); });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      const button = event.submitter || form.querySelector('[type="submit"]');
      const payload = kind === 'material' ? materialPayload() : Object.fromEntries(new FormData(form));
      if (kind === 'tag') { payload.enabled = field(form, 'enabled').checked; payload.taxonomy = field(form, 'taxonomy').value; }
      // Capture values now, before the asynchronous confirmation clears currentTarget.
      const ok = await confirmAction({ title: `Save ${labels[kind]}?`, message: 'Save these changes in the updated library workspace?', actionLabel: 'Save changes' });
      if (ok) await mutate(kind, 'POST', payload, button);
    });
    const suffix = kind === 'material' ? 'Material' : kind === 'tag' ? 'Tag' : 'Series';
    $('#catalogNew' + suffix).addEventListener('click', async () => {
      if (busy || !await discard()) return;
      for (const other of Object.keys(forms)) fill(other, state[collections[other]].find(item => item.id === selectedId(other)) || null);
      fill(kind);
      renderLists();
      field(form, kind === 'tag' ? 'name' : 'title').focus();
    });
    $('#catalogDelete' + suffix).addEventListener('click', async event => {
      const button = event.currentTarget;
      const payload = { id: selectedId(kind), updatedAt: field(form, 'updatedAt').value };
      if (busy || !payload.id) return;
      const description = kind === 'material' ? 'This deletes the material and its category connections from the new library workspace. The original program library is unchanged.' : kind === 'series' ? 'This removes the series grouping. Its materials and tags are kept.' : 'This deletes an unused category. Categories assigned to materials must be unassigned first.';
      const ok = await confirmAction({ title: `Delete ${labels[kind]}?`, message: description, actionLabel: 'Delete', danger: true });
      if (ok) await mutate(kind, 'DELETE', payload, button);
    });
  }
  controls.addEventListener('click', async event => {
    const button = event.target.closest('[data-catalog-kind]');
    if (!button || busy) return;
    const kind = button.dataset.catalogKind;
    const item = state[collections[kind]].find(item => item.id === button.dataset.id);
    if (!item || !await discard()) return;
    for (const other of Object.keys(forms)) fill(other, state[collections[other]].find(item => item.id === selectedId(other)) || null);
    fill(kind, item);
    renderLists();
    forms[kind].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  $('#catalogSearch').addEventListener('input', () => { if (state) renderLists(); });
  $('#catalogFilter').addEventListener('change', () => { if (state) renderLists(); });
  const tabs = [...document.querySelectorAll('[data-catalog-tab]')];
  function selectTab(button) {
    for (const tab of tabs) {
      const active = tab === button;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      $('#' + tab.dataset.catalogTab).hidden = !active;
    }
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectTab(tabs[index]); tabs[index].focus();
    });
  }
  $('#catalogRefresh').addEventListener('click', async event => {
    const button = event.currentTarget;
    if (busy || !await discard()) return;
    busy = true;
    controls.inert = true;
    try { await withLoading(button, 'Refreshing...', refresh); message('Library refreshed.', true); }
    catch (error) { message(error.message); }
    finally { busy = false; controls.inert = false; }
  });
  window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
  return {
    async load() {
      if (state) return;
      try { await refresh(); message(''); }
      catch (error) { message(error.message); }
    },
    reset() { generation++; state = null; controls.hidden = true; for (const form of Object.values(forms)) { form.reset(); form.dataset.dirty = 'false'; } message(''); },
  };
}
