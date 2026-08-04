const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const api = async (url, options = {}) => {
  const r = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    }),
    b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error || "Please try again.");
  return b;
};

let dashboard = null;
let selectedProgramSlug = "";
let selectedResourceId = "";

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toLocaleDateString();
  const fallback = new Date(String(value).replace(" ", "T") + "Z");
  return Number.isNaN(fallback.getTime()) ? "-" : fallback.toLocaleDateString();
}

async function withLoading(button, label, task) {
  const original = button.textContent;
  button.disabled = true;
  button.classList.add("is-loading");
  button.textContent = label;
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.classList.remove("is-loading");
    button.textContent = original;
  }
}

function formObject(form) {
  const data = Object.fromEntries(new FormData(form));
  form.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    data[input.name] = input.checked;
  });
  return data;
}

function badge(s) {
  const source = String(s || "local");
  const isConstantContact = source.startsWith("constant_contact");
  return `<span class="status-pill ${isConstantContact ? "cc" : "off"}">${esc(source.replaceAll("_", " "))}</span>`;
}

function sectionLabel(section) {
  return {
    upcoming: "Upcoming programs",
    current: "Current & previous academic year",
    archives: "Archive",
  }[section] || section;
}

function flattenResources(program) {
  return ["upcoming", "current", "archives"].flatMap((section) =>
    (program?.[section] || []).map((resource) => ({ ...resource, section })),
  );
}

function renderHeroEvents(events) {
  $("#heroEventRows").innerHTML =
    events
      .map(
        (x) =>
          `<article class="sync-item"><div>${x.backgroundImage ? `<img src="${esc(x.backgroundImage)}" alt="">` : ""}<strong>${esc(x.title)}</strong><small>${esc(x.description)}</small></div><a href="${esc(x.ctaUrl)}" target="_blank" rel="noopener">${esc(x.ctaLabel || "Open")}</a></article>`,
      )
      .join("") ||
    '<div class="empty-admin">No virtual programs were found on SEMCME.org.</div>';
}

function renderMembers(members) {
  $("#memberRows").innerHTML =
    members
      .map(
        (x) =>
          `<tr><td><strong>${esc([x.first_name, x.last_name].filter(Boolean).join(" ") || x.email)}</strong><small>${esc(x.email)}</small></td><td>${esc(x.institution || "-")}</td><td>${badge(x.cc_status)}</td><td>${esc(formatDate(x.created_at || x.updated_at || x.last_cc_sync_at))}</td></tr>`,
      )
      .join("") || '<tr><td colspan="4">No members synced yet.</td></tr>';
}

function fillProgramForm(program) {
  const form = $("#programForm");
  form.slug.value = program?.slug || "";
  form.slug.readOnly = Boolean(program?.slug);
  form.name.value = program?.name || "";
  form.short.value = program?.short || "";
  form.position.value = program?.position ?? "";
  form.description.value = program?.description || "";
  form.enabled.checked = program?.enabled !== false;
}

function fillResourceForm(resource = null) {
  const form = $("#resourceForm");
  selectedResourceId = resource?.id || "";
  form.id.value = resource?.id || "";
  form.section.value = resource?.section || "current";
  form.type.value = resource?.type || "recording";
  form.title.value = resource?.title || "";
  form.url.value = resource?.url || "";
  form.groupName.value = resource?.group || "";
  form.presenter.value = resource?.presenter || "";
  form.itemDate.value = resource?.date || "";
  form.meta.value = resource?.meta || "";
  form.position.value = resource?.position ?? "";
  form.embedEnabled.checked = resource?.embed !== false;
}

function renderProgramSelect(programs) {
  $("#programEditorSelect").innerHTML = programs
    .map((program) => `<option value="${esc(program.slug)}">${esc(program.name)}</option>`)
    .join("");
  if (!selectedProgramSlug || !programs.some((p) => p.slug === selectedProgramSlug)) {
    selectedProgramSlug = programs[0]?.slug || "";
  }
  $("#programEditorSelect").value = selectedProgramSlug;
}

function renderContent(programs) {
  renderProgramSelect(programs);
  const program = programs.find((p) => p.slug === selectedProgramSlug) || programs[0] || null;
  fillProgramForm(program);
  const resources = flattenResources(program);
  if (!selectedResourceId || !resources.some((r) => r.id === selectedResourceId)) fillResourceForm(null);

  $("#contentRows").innerHTML = ["upcoming", "current", "archives"]
    .map((section) => {
      const items = resources.filter((resource) => resource.section === section);
      return `<section class="content-group">
        <div class="content-group-head"><h3>${sectionLabel(section)}</h3><span>${items.length} ${items.length === 1 ? "item" : "items"}</span></div>
        ${
          items.length
            ? `<div class="content-table">${items
                .map(
                  (resource) =>
                    `<button type="button" data-resource-id="${esc(resource.id)}" class="${resource.id === selectedResourceId ? "active" : ""}">
                      <span class="resource-type">${esc(resource.type || "resource")}</span>
                      <strong>${esc(resource.title)}</strong>
                      <small>${esc([resource.group, resource.presenter, resource.date, resource.meta].filter(Boolean).join(" · ") || resource.url)}</small>
                      ${resource.embed === false ? '<em>Link-only</em>' : ""}
                    </button>`,
                )
                .join("")}</div>`
            : '<div class="empty-admin">No items in this section.</div>'
        }
      </section>`;
    })
    .join("");
}

function renderSupport(support) {
  $("#supportRows").innerHTML =
    (support || [])
      .map(
        (x) =>
          `<tr><td><strong>${esc(x.name)}</strong><small>${esc(x.email)}</small></td><td>${esc(x.topic)}</td><td>${esc(x.message)}</td><td>${esc(formatDate(x.created_at))}</td></tr>`,
      )
      .join("") || '<tr><td colspan="4">No support requests yet.</td></tr>';
}

async function load() {
  try {
    const d = await api("/api/admin/dashboard");
    dashboard = d;
    $("#adminLogin").classList.add("hidden");
    $("#dashboard").classList.remove("hidden");
    renderHeroEvents(d.heroEvents || []);
    renderMembers(d.members || []);
    renderContent(d.libraryPrograms || []);
    renderSupport(d.support || []);
    $("#ccStatus").textContent = d.constantContactConfigured
      ? "Constant Contact Virtual Members list lookup is configured."
      : "Constant Contact lookup is not configured yet. Add the Virtual Members contact list credentials to enable sync.";
    const resourceCount = (d.libraryPrograms || []).reduce((sum, program) => sum + flattenResources(program).length, 0);
    $("#stats").innerHTML =
      `<div class="stat"><strong>${(d.libraryPrograms || []).length}</strong><span>program areas</span></div><div class="stat"><strong>${resourceCount}</strong><span>library items</span></div><div class="stat"><strong>${(d.members || []).length}</strong><span>members in database</span></div><div class="stat"><strong>${(d.support || []).filter((x) => x.status === "new").length}</strong><span>new questions</span></div>`;
  } catch {}
}

$("#adminLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const p = e.currentTarget.querySelector(".form-status");
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify(formObject(e.currentTarget)),
    });
    await load();
  } catch (x) {
    p.textContent = x.message;
  }
});

$("#programEditorSelect").addEventListener("change", async (e) => {
  selectedProgramSlug = e.currentTarget.value;
  selectedResourceId = "";
  renderContent(dashboard?.libraryPrograms || []);
});

$("#newProgram").addEventListener("click", () => {
  selectedProgramSlug = "";
  fillProgramForm(null);
  fillResourceForm(null);
  $("#programEditorSelect").value = "";
  $("#programForm").slug.focus();
});

$("#programForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.submitter || e.currentTarget.querySelector("button[type='submit']");
  const status = $("#contentStatus");
  status.textContent = "Saving program...";
  try {
    const result = await withLoading(button, "Saving...", () =>
      api("/api/admin/library/program", {
        method: "POST",
        body: JSON.stringify(formObject(e.currentTarget)),
      }),
    );
    selectedProgramSlug = result.slug;
    selectedResourceId = "";
    status.textContent = "Program saved.";
    status.classList.add("success");
    await load();
  } catch (x) {
    status.textContent = x.message;
    status.classList.remove("success");
  }
});

$("#deleteProgram").addEventListener("click", async () => {
  const button = $("#deleteProgram");
  const slug = $("#programForm").slug.value;
  if (!slug || !confirm("Delete this program area and all of its library items?")) return;
  const status = $("#contentStatus");
  status.textContent = "Deleting program...";
  try {
    await withLoading(button, "Deleting...", () =>
      api(`/api/admin/library/program?slug=${encodeURIComponent(slug)}`, { method: "DELETE" }),
    );
    selectedProgramSlug = "";
    selectedResourceId = "";
    status.textContent = "Program deleted.";
    status.classList.add("success");
    await load();
  } catch (x) {
    status.textContent = x.message;
    status.classList.remove("success");
  }
});

$("#newResource").addEventListener("click", () => fillResourceForm(null));

$("#resourceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.submitter || e.currentTarget.querySelector("button[type='submit']");
  const status = $("#contentStatus");
  const payload = { ...formObject(e.currentTarget), programSlug: $("#programForm").slug.value || selectedProgramSlug };
  status.textContent = "Saving item...";
  try {
    const result = await withLoading(button, "Saving...", () =>
      api("/api/admin/library/resource", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
    selectedResourceId = result.id;
    status.textContent = "Library item saved.";
    status.classList.add("success");
    await load();
  } catch (x) {
    status.textContent = x.message;
    status.classList.remove("success");
  }
});

$("#deleteResource").addEventListener("click", async () => {
  const button = $("#deleteResource");
  const id = $("#resourceForm").id.value;
  if (!id || !confirm("Delete this library item?")) return;
  const status = $("#contentStatus");
  status.textContent = "Deleting item...";
  try {
    await withLoading(button, "Deleting...", () =>
      api(`/api/admin/library/resource?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
    );
    selectedResourceId = "";
    status.textContent = "Library item deleted.";
    status.classList.add("success");
    await load();
  } catch (x) {
    status.textContent = x.message;
    status.classList.remove("success");
  }
});

$("#contentRows").addEventListener("click", (e) => {
  const button = e.target.closest("[data-resource-id]");
  if (!button) return;
  const id = button.dataset.resourceId;
  const program = (dashboard?.libraryPrograms || []).find((p) => p.slug === selectedProgramSlug);
  const resource = flattenResources(program).find((item) => item.id === id);
  if (!resource) return;
  fillResourceForm(resource);
  renderContent(dashboard?.libraryPrograms || []);
});

$("#syncEvents").addEventListener("click", async (e) => {
  const panel = e.currentTarget.closest(".admin-panel"),
    status = panel.querySelector(".form-status");
  status.textContent = "Refreshing SEMCME.org programs...";
  try {
    const d = await withLoading(e.currentTarget, "Refreshing...", () =>
      api("/api/admin/sync-virtual-events", { method: "POST" }),
    );
    status.textContent = `Found ${d.count} virtual programs.`;
    status.classList.add("success");
    await load();
  } catch (x) {
    status.textContent = x.message;
    status.classList.remove("success");
  }
});

$("#syncMembers").addEventListener("click", async (e) => {
  const button = e.currentTarget;
  const status = $("#contentStatus");
  status.textContent = "Syncing members...";
  try {
    const d = await withLoading(button, "Syncing...", () =>
      api("/api/admin/sync-members", { method: "POST" }),
    );
    status.textContent = d.configured
      ? `Synced ${d.synced} members from Constant Contact${d.checked !== undefined ? ` (${d.checked} checked)` : ""}.`
      : "Constant Contact Virtual Members list lookup is not configured yet.";
    status.classList.add("success");
    await load();
  } catch (x) {
    status.textContent = x.message;
    status.classList.remove("success");
  }
});

$("#refresh").addEventListener("click", (e) => withLoading(e.currentTarget, "Refreshing...", load));
await load();
