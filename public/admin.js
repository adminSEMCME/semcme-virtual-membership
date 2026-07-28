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
function badge(s) {
  return `<span class="status-pill ${s === "constant_contact" ? "" : "off"}">${esc(String(s || "local").replaceAll("_", " "))}</span>`;
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
          `<tr><td><strong>${esc([x.first_name, x.last_name].filter(Boolean).join(" ") || x.email)}</strong><small>${esc(x.email)}</small></td><td>${esc(x.institution || "—")}</td><td>${badge(x.cc_status)}</td><td>${esc(new Date(x.created_at + "Z").toLocaleDateString())}</td></tr>`,
      )
      .join("") || '<tr><td colspan="4">No members synced yet.</td></tr>';
}
async function load() {
  try {
    const d = await api("/api/admin/dashboard");
    $("#adminLogin").classList.add("hidden");
    $("#dashboard").classList.remove("hidden");
    renderHeroEvents(d.heroEvents || []);
    renderMembers(d.members || []);
    $("#ccStatus").textContent = d.constantContactConfigured
      ? "Constant Contact Virtual Members list lookup is configured."
      : "Constant Contact lookup is not configured yet. Add the Virtual Members contact list credentials to enable sync.";
    $("#stats").innerHTML =
      `<div class="stat"><strong>${(d.heroEvents || []).length}</strong><span>virtual hero programs</span></div><div class="stat"><strong>${(d.members || []).length}</strong><span>members in database</span></div><div class="stat"><strong>${(d.support || []).filter((x) => x.status === "new").length}</strong><span>new questions</span></div>`;
    $("#supportRows").innerHTML =
      (d.support || [])
        .map(
          (x) =>
            `<tr><td><strong>${esc(x.name)}</strong><small>${esc(x.email)}</small></td><td>${esc(x.topic)}</td><td>${esc(x.message)}</td><td>${esc(new Date(x.created_at + "Z").toLocaleDateString())}</td></tr>`,
        )
        .join("") || '<tr><td colspan="4">No support requests yet.</td></tr>';
  } catch {}
}
$("#adminLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const p = e.currentTarget.querySelector(".form-status");
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
    });
    await load();
  } catch (x) {
    p.textContent = x.message;
  }
});
$("#syncEvents").addEventListener("click", async (e) => {
  const panel = e.currentTarget.closest(".admin-panel"),
    status = panel.querySelector(".form-status");
  status.textContent = "Refreshing SEMCME.org programs…";
  try {
    const d = await api("/api/admin/sync-virtual-events", { method: "POST" });
    status.textContent = `Found ${d.count} virtual programs.`;
    status.classList.add("success");
    await load();
  } catch (x) {
    status.textContent = x.message;
    status.classList.remove("success");
  }
});
$("#syncMembers").addEventListener("click", async (e) => {
  const panel = e.currentTarget.closest(".admin-panel"),
    status = panel.querySelector(".sync-note");
  status.textContent = "Syncing Virtual Members contact list…";
  try {
    const d = await api("/api/admin/sync-members", { method: "POST" });
    status.textContent = d.configured
      ? `Synced ${d.synced} members from Constant Contact.`
      : "Constant Contact Virtual Members list lookup is not configured yet.";
    await load();
  } catch (x) {
    status.textContent = x.message;
  }
});
$("#refresh").addEventListener("click", load);
await load();
