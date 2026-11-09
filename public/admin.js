import { initializeCatalogAdmin } from './admin-catalog.js';

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
let confirmResolver = null;
let adminLoadingCount = 0;
const pageParams = new URLSearchParams(window.location.search);

function setAdminPageLoading(active) {
  adminLoadingCount = Math.max(0, adminLoadingCount + (active ? 1 : -1));
  document.body.classList.toggle("is-loading", adminLoadingCount > 0);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toLocaleDateString();
  const fallback = new Date(String(value).replace(" ", "T") + "Z");
  return Number.isNaN(fallback.getTime()) ? "-" : fallback.toLocaleDateString();
}

function formatExportDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function csvCell(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename, rows) {
  const blob = new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportMembers() {
  const members = dashboard?.members || [];
  const rows = [
    ["Name", "Email", "Institution", "Source", "Date created", "Last login"],
    ...members.map((member) => [
      member.name || "",
      member.email || "",
      member.institution || "",
      member.cc_status || member.source || "",
      formatExportDate(member.created_at),
      formatExportDate(member.last_login_at),
    ]),
  ];
  downloadCsv("virtual-membership-members.csv", rows);
  $("#memberSyncStatus").textContent = `Exported ${members.length} member${members.length === 1 ? "" : "s"}.`;
  $("#memberSyncStatus").classList.add("success");
}

async function withLoading(button, label, task) {
  const original = button.textContent;
  setAdminPageLoading(true);
  button.disabled = true;
  button.classList.add("is-loading");
  button.textContent = label;
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.classList.remove("is-loading");
    button.textContent = original;
    setAdminPageLoading(false);
  }
}

function confirmAction({ title, message, actionLabel = "Confirm", danger = false }) {
  const overlay = $("#confirmOverlay");
  const accept = $("#confirmAccept");
  const cancel = $("#confirmCancel");
  $("#confirmTitle").textContent = title;
  $("#confirmMessage").textContent = message;
  accept.textContent = actionLabel;
  accept.className = danger ? "danger-button" : "primary-button";
  overlay.classList.remove("hidden");
  accept.focus();
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function closeConfirm(result = false) {
  if (!confirmResolver) return;
  $("#confirmOverlay").classList.add("hidden");
  const resolve = confirmResolver;
  confirmResolver = null;
  resolve(result);
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

function renderHeroEvents(events) {
  const placements = dashboard?.heroPlacements || [];
  $("#heroEventRows").innerHTML =
    events
      .map(
        (x) => {
          const placement = placements.find(p => p.event_key === x.eventKey);
          const location = placement?.suppressed ? 'Removed from materials' : placement?.material_id ? (placement.enabled ? 'In the member library' : 'Hidden from members') : 'Not yet imported';
          return `<article class="sync-item"><div>${x.backgroundImage ? `<img src="${esc(x.backgroundImage)}" alt="">` : ''}<strong>${esc(x.title)}</strong><small>${esc(x.description)}</small><p>${esc(location)}${placement?.manual ? ' - Admin managed' : ''}</p>${placement?.material_id && !placement.suppressed ? `<button type="button" class="outline-button" data-hero-material="${esc(placement.material_id)}">Edit material</button>` : ''}</div><a href="${esc(x.ctaUrl)}" target="_blank" rel="noopener">${esc(x.ctaLabel || 'Open')}</a></article>`;
        },
      )
      .join("") ||
    '<div class="empty-admin">No virtual programs were found on SEMCME.org.</div>';
  const status = document.querySelector('#syncEvents').closest('.admin-panel').querySelector('.form-status');
  status.textContent = dashboard.heroSyncError || (dashboard.heroSyncedAt ? `Last successful sync: ${new Date(dashboard.heroSyncedAt).toLocaleString()}. Scheduled daily; Refresh programs runs immediately.` : 'Awaiting first sync.');
}

function renderMembers(members) {
  $("#memberRows").innerHTML =
    members
      .map(
        (x) =>
          `<tr><td><strong>${esc([x.first_name, x.last_name].filter(Boolean).join(" ") || x.email)}</strong><small>${esc(x.email)}</small></td><td>${esc(x.institution || "-")}</td><td>${badge(x.cc_status)}</td><td>${esc(formatDate(x.created_at))}</td><td>${esc(formatDate(x.last_login_at))}</td></tr>`,
      )
      .join("") || '<tr><td colspan="5">No members synced yet.</td></tr>';
}

function renderInstitutionSegments(names = []) {
  $("#institutionSegmentList").innerHTML =
    names
      .map((name) => {
        const canRemove = !["semcme", "non-semcme"].includes(String(name).toLowerCase());
        return `<span class="segment-pill">${esc(name)}${
          canRemove
            ? `<button type="button" aria-label="Remove ${esc(name)}" data-segment-name="${esc(name)}">&times;</button>`
            : ""
        }</span>`;
      })
      .join("") || '<span class="segment-empty">No institution segments configured.</span>';
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

const catalogAdmin = initializeCatalogAdmin({ api, esc, confirmAction, withLoading });

async function load() {
  try {
    const d = await api("/api/admin/dashboard");
    dashboard = d;
    $("#adminLogin").classList.add("hidden");
    $("#dashboard").classList.remove("hidden");
    renderHeroEvents(d.heroEvents || []);
    renderMembers(d.members || []);
    renderInstitutionSegments(d.virtualInstitutionSegments || []);
    renderSupport(d.support || []);
    await catalogAdmin.load();
    const resourceCount = d.catalogStats?.materials || 0;
    $("#stats").innerHTML =
      `<div class="stat"><strong>${d.catalogStats?.visible || 0}</strong><span>visible materials</span></div><div class="stat"><strong>${resourceCount}</strong><span>library items</span></div><div class="stat"><strong>${(d.members || []).length}</strong><span>members in database</span></div><div class="stat"><strong>${(d.support || []).filter((x) => x.status === "new").length}</strong><span>new questions</span></div>`;
    if (pageParams.get("cc") === "failed") {
      $("#memberSyncStatus").textContent = "Constant Contact reconnect failed. Check that the callback URL is saved in the Constant Contact app.";
      $("#memberSyncStatus").classList.remove("success");
    }
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

$('#heroEventRows').addEventListener('click', async e => {
  const button=e.target.closest('[data-hero-material]');
  if(button) await catalogAdmin.openMaterial(button.dataset.heroMaterial);
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
  const status = $("#memberSyncStatus");
  status.textContent = "Syncing members...";
  try {
    const d = await withLoading(button, "Syncing...", () =>
      api("/api/admin/sync-members", { method: "POST" }),
    );
    status.textContent = d.configured
      ? `Synced ${d.synced} members from Constant Contact. Checked ${d.institutionSegments || 0} institution ${Number(d.institutionSegments || 0) === 1 ? "segment" : "segments"} and updated ${d.institutionSynced || 0} institution ${Number(d.institutionSynced || 0) === 1 ? "value" : "values"}.`
      : "Constant Contact Virtual Members list lookup is not configured yet.";
    status.classList.add("success");
    await load();
  } catch (x) {
    status.textContent = x.message;
    status.classList.remove("success");
  }
});

$("#exportMembers").addEventListener("click", (e) => {
  withLoading(e.currentTarget, "Exporting...", async () => exportMembers()).catch((x) => {
    $("#memberSyncStatus").textContent = x.message;
    $("#memberSyncStatus").classList.remove("success");
  });
});

$("#institutionSegmentForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const button = e.submitter || form.querySelector("button[type='submit']");
  const status = $("#institutionSegmentStatus");
  const name = form.name.value.trim();
  status.textContent = "Saving institution...";
  try {
    const d = await withLoading(button, "Saving...", () =>
      api("/api/admin/institution-segments", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    );
    form.reset();
    renderInstitutionSegments(d.virtualInstitutionSegments || []);
    status.textContent = "Institution added to the segment checker.";
    status.classList.add("success");
    await load();
  } catch (x) {
    status.textContent = x.message;
    status.classList.remove("success");
  }
});

$("#institutionSegmentList").addEventListener("click", async (e) => {
  const button = e.target.closest("[data-segment-name]");
  if (!button) return;
  const name = button.dataset.segmentName;
  const status = $("#institutionSegmentStatus");
  status.textContent = "Removing institution...";
  try {
    const d = await withLoading(button, "Removing...", () =>
      api(`/api/admin/institution-segments?name=${encodeURIComponent(name)}`, { method: "DELETE" }),
    );
    renderInstitutionSegments(d.virtualInstitutionSegments || []);
    status.textContent = "Institution removed from the segment checker.";
    status.classList.add("success");
    await load();
  } catch (x) {
    status.textContent = x.message;
    status.classList.remove("success");
  }
});

$("#refresh").addEventListener("click", (e) => withLoading(e.currentTarget, "Refreshing...", load));
$("#adminLogout").addEventListener("click", async (e) => {
  await withLoading(e.currentTarget, "Signing out...", () =>
    api("/api/admin/logout", { method: "POST" }),
  );
  dashboard = null;
  catalogAdmin.reset();
  $("#dashboard").classList.add("hidden");
  $("#adminLogin").classList.remove("hidden");
});
$("#confirmCancel").addEventListener("click", () => closeConfirm(false));
$("#confirmAccept").addEventListener("click", () => closeConfirm(true));
$("#confirmOverlay").addEventListener("click", (e) => {
  if (e.target.id === "confirmOverlay") closeConfirm(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeConfirm(false);
});
await load();
