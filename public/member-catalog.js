export function embeddedVideo(url, type) {
  try {
    const u = new URL(url), host = u.hostname.replace(/^(www\.|m\.)/, '');
    if (!['youtube.com','youtu.be'].includes(host)) return '';
    const list = u.searchParams.get('list');
    if (type === 'playlist' && list) return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(list)}`;
    const id = host === 'youtu.be' ? u.pathname.slice(1).split('/')[0] : u.searchParams.get('v') || u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
    return /^[\w-]{11}$/.test(id || '') ? `https://www.youtube.com/embed/${id}` : '';
  } catch { return ''; }
}
export function selectMaterials(catalog, view, tagId, search = '') {
  const query = search.trim().toLowerCase();
  return catalog.materials.filter(m => (view === 'all' || (view === 'additional' && m.additionalTopics) || m.tags.some(t => t.taxonomy === view && t.id === tagId)) &&
    (!query || [m.title,m.presenter,...m.tags.map(t=>t.name)].join(' ').toLowerCase().includes(query)))
    .sort((a,b) => a.position-b.position || a.title.localeCompare(b.title, undefined, {numeric:true}));
}
export function initializeMemberCatalog({ api, esc }) {
  const root = document.querySelector('#memberCatalog');
  if (root.dataset.initialized) return;
  root.dataset.initialized = 'true';
  const $ = s => root.querySelector(s);
  let catalog, view = '', tagId = '';
  const results = $('#memberResults'), status = $('#memberCatalogStatus');
  const guide = () => `<div class="browse-guide"><h2>Where would you like to start?</h2><dl><dt>ACGME Competencies</dt><dd>Choose a core competency to find related learning materials.</dd><dt>ACGME Survey Areas</dt><dd>Choose a survey area to explore related educational resources.</dd><dt>Browse by Topic</dt><dd>Explore familiar subject areas such as Faculty Development, OB/GYN, and Well-Being.</dd><dt>Additional Topics</dt><dd>Explore materials confirmed to cover topics outside both ACGME groups.</dd><dt>All Materials</dt><dd>See the complete library, including materials whose categories are still being reviewed.</dd></dl><p>Select a material's title to expand its details and watch available videos here.</p></div>`;
  function row(m) {
    return `<details class="material-row" data-material="${esc(m.id)}"><summary><span><strong>${esc(m.title)}</strong>${m.presenter || m.itemDate ? `<small>${esc([m.presenter,m.itemDate].filter(Boolean).join(' · '))}</small>` : ''}<span class="material-tags">${m.tags.map(t=>`<span>${esc(t.name)}</span>`).join('')}</span></span><span class="material-expand" aria-hidden="true">+</span></summary><div class="material-body">${m.description ? `<p>${esc(m.description)}</p>` : ''}${m.meta ? `<p>${esc(m.meta)}</p>` : ''}<div class="material-player"></div></div></details>`;
  }
  function render() {
    const ready = view === 'all' || view === 'additional' || Boolean(tagId);
    $('#memberSearchBar').hidden = !ready;
    if (!view) { results.innerHTML = guide(); status.textContent = ''; return; }
    if (!ready) { results.innerHTML = '<div class="browse-guide"><h2>Choose a category above</h2><p>The related materials will appear here.</p></div>'; status.textContent = ''; return; }
    const materials = selectMaterials(catalog,view,tagId,$('#memberSearch').value);
    const label = view === 'all' ? 'All Materials' : view === 'additional' ? 'Additional Topics' : catalog.tags.find(t=>t.id===tagId)?.name;
    status.textContent = `${materials.length} ${materials.length===1?'material':'materials'} found`;
    let html = `<h2 class="results-heading">${esc(label)}</h2>`;
    if (!materials.length) html += `<div class="browse-guide"><p>${$('#memberSearch').value ? 'No matches. Try a different title or presenter.' : 'No materials are available in this section yet. Choose All Materials to explore the library.'}</p></div>`;
    const rendered = new Set();
    for (const m of materials) {
      const series = catalog.series.find(s=>s.id===m.seriesId);
      if (!series) { html+=row(m); continue; }
      if (rendered.has(series.id)) continue;
      rendered.add(series.id);
      const sessions = materials.filter(x=>x.seriesId===series.id).sort((a,b)=>a.sessionPosition-b.sessionPosition || a.title.localeCompare(b.title));
      html+=`<section class="material-series"><h3>${esc(series.title)}</h3>${series.description?`<p>${esc(series.description)}</p>`:''}${sessions.map(row).join('')}</section>`;
    }
    results.innerHTML = html;
  }
  function choose(next) {
    if (!catalog) return;
    view=next; tagId=''; $('#memberSearch').value='';
    root.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
    const tags=catalog.tags.filter(t=>t.taxonomy===view);
    $('#memberCategories').hidden=!['competency','survey','topic'].includes(view);
    $('#memberCategories').innerHTML=tags.map(t=>`<button type="button" data-tag="${esc(t.id)}" aria-pressed="false">${esc(t.name)}</button>`).join('');
    render();
  }
  root.addEventListener('click',e=>{
    const main=e.target.closest('[data-view]'); if(main) choose(main.dataset.view);
    const category=e.target.closest('[data-tag]'); if(category){tagId=category.dataset.tag;$('#memberSearch').value='';root.querySelectorAll('[data-tag]').forEach(b=>b.setAttribute('aria-pressed',String(b===category)));render();}
    if(e.target.closest('[data-retry]')) load();
  });
  results.addEventListener('toggle',e=>{
    const details=e.target;
    if(!details.matches('.material-row'))return;
    const player=details.querySelector('.material-player');
    if(!details.open){player.replaceChildren();return;}
    results.querySelectorAll('.material-row[open]').forEach(other=>{if(other!==details){other.open=false;other.querySelector('.material-player').replaceChildren();}});
    const m=catalog.materials.find(m=>m.id===details.dataset.material);
    const embed=m.embedEnabled&&embeddedVideo(m.url,m.type);
    if(embed){const frame=document.createElement('iframe');frame.referrerPolicy='strict-origin-when-cross-origin';frame.src=embed;frame.title=m.title;frame.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';frame.allowFullscreen=true;player.classList.add('has-video');player.replaceChildren(frame);}
    else {player.classList.remove('has-video');player.innerHTML=`<a class="material-link" href="${esc(m.url)}" target="_blank" rel="noopener">${m.type==='course'?'View program or registration':'Open material'} <span aria-hidden="true">↗</span></a>`;}
  },true);
  $('#memberSearch').addEventListener('input',render);
  $('#memberGuideButton').addEventListener('click',()=>choose(''));
  async function load(){status.textContent='Loading materials…';try{catalog=await api('/api/catalog');choose('');}catch(error){status.textContent=error.message;results.innerHTML='<button type="button" data-retry>Try again</button>';}}
  load();
}
