const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const cssUrl = (s) => String(s ?? "").replace(/["\\\n\r]/g, "");
const api = async (url, options = {}) => {
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = new Error(b.error || "Please try again.");
    error.data = b;
    throw error;
  }
  return b;
};
let library = null,
  activeSlug = "chief-resident";
const heroSyncIntervalMs = 24 * 60 * 60 * 1000;
let activeEvent = 0,
  carouselTimer,
  heroSyncTimer;

function status(form, message, type = "error") {
  const state = type === true ? "success" : type === false ? "error" : type;
  const el = form.querySelector(".form-status");
  el.innerHTML = message;
  el.classList.toggle("success", state === "success");
  el.classList.toggle("error", state === "error");
  el.classList.toggle("loading", state === "loading");
}

function splitSentences(value) {
  return String(value || "")
    .split(/(?<=\.)\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function loginSuccessMessage(message) {
  const detailLines = splitSentences(
    message ||
      "Check your email for a secure Sign-In Link. Please allow up to 3 minutes for the Sign-In Link to arrive before requesting another one.",
  );
  return `<div class="status-card">
    ${detailLines.map((line) => `<span>${esc(line)}</span>`).join("")}
  </div>`;
}

function loginErrorMessage(message, registrationUrl = "") {
  return `<div class="status-card">
    <span>${esc(message)}</span>
    ${
      registrationUrl
        ? `<span><a href="${esc(registrationUrl)}" target="_blank" rel="noopener">Register here</a>, then sign in again.</span>`
        : ""
    }
  </div>`;
}
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget,
    button = form.querySelector("button[type=submit]");
  button.disabled = true;
  status(form, '<div class="status-card"><strong>Checking membership</strong><span>Please wait while we verify your access.</span></div>', "loading");
  try {
    const result = await api("/api/auth/request-link", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    status(
      form,
      result.emailSent
        ? loginSuccessMessage(result.message)
        : `<div class="status-card"><strong>Local sign-in link ready</strong><span>Email delivery is not configured locally.</span><span>This dev Sign-In Link expires in 30 minutes and can only be used once.</span><span><a href="${esc(result.signInUrl)}">Open your dev sign-in link</a></span></div>`,
      "success",
    );
  } catch (x) {
    status(form, loginErrorMessage(x.message, x.data?.registrationUrl), "error");
  } finally {
    button.disabled = false;
  }
});
$("#logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  location.reload();
});

const icon = (type) =>
  ({ recording: "▶", playlist: "▤", course: "✦", resource: "↗" })[type] || "•";

function youtubeEmbedUrl(url, type) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (!["youtube.com", "youtu.be"].includes(host)) return "";

    const list = u.searchParams.get("list");
    if (type === "playlist" && list) {
      return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(list)}`;
    }

    const id = host === "youtu.be" ? u.pathname.slice(1) : u.searchParams.get("v");
    if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    if (list) return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(list)}`;
  } catch {
    return "";
  }
  return "";
}

function resourceCard(r) {
  return `<a class="resource-card" href="${esc(r.url)}" target="_blank" rel="noopener"><span class="resource-icon" aria-hidden="true">${icon(r.type)}</span><span class="resource-copy">${r.group ? `<span class="resource-group">${esc(r.group)}</span>` : ""}<strong>${esc(r.title)}</strong>${r.presenter || r.date || r.meta ? `<small>${esc([r.presenter, r.date, r.meta].filter(Boolean).join(" · "))}</small>` : ""}</span><span class="resource-arrow" aria-hidden="true">→</span></a>`;
}

function playlistPlayer(r) {
  if (r.embed === false) return resourceCard(r);
  return videoResource(r);
}

function videoResource(r) {
  if (r.embed === false) return resourceCard(r);
  const embedUrl = youtubeEmbedUrl(r.url, r.type);
  if (!embedUrl) return resourceCard(r);

  const label = r.type === "playlist" ? "YouTube playlist" : "Recording";
  const isPlaylist = r.type === "playlist";
  return `<article class="video-card ${isPlaylist ? "playlist-card" : ""}">
    <div class="video-frame">
      <iframe src="${esc(embedUrl)}" title="${esc(r.title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
    </div>
    <div class="video-copy">
      <span class="resource-group">${esc(r.group || label)}</span>
      <h3>${esc(r.title)}</h3>
      ${r.presenter || r.date || r.meta ? `<p>${esc([r.presenter, r.date, r.meta].filter(Boolean).join(" · "))}</p>` : ""}
      ${isPlaylist ? `<p>YouTube manages this playlist. New videos added there will appear in the playlist player automatically.</p>` : ""}
      <a href="${esc(r.url)}" target="_blank" rel="noopener">${isPlaylist ? "Open full playlist" : "Open on YouTube"} <span>→</span></a>
    </div>
  </article>`;
}

function resourceCollection(resources, archive = false) {
  const hasVideo = resources.some((r) => r.embed !== false && youtubeEmbedUrl(r.url, r.type));
  const className = hasVideo ? "video-grid" : archive ? "archive-grid" : "resource-list";
  return `<div class="${className}">${resources.map((r) => (hasVideo ? (r.type === "playlist" ? playlistPlayer(r) : videoResource(r)) : resourceCard(r))).join("")}</div>`;
}

function renderProgram(slug, updateHash = true) {
  const p =
    library.programs.find((x) => x.slug === slug) || library.programs[0];
  activeSlug = p.slug;
  $$("#programNav button").forEach((b) =>
    b.setAttribute(
      "aria-current",
      b.dataset.slug === p.slug ? "page" : "false",
    ),
  );
  $("#programSelect").value = p.slug;
  const count = p.current.length + p.archives.length;
  $("#programView").innerHTML =
    `<header class="program-head"><div><span class="mini-kicker">Program area</span><h1>${esc(p.name)}</h1><p>${esc(p.description)}</p></div><span class="count-badge">${count} ${count === 1 ? "resource" : "resources"}</span></header>
    <section class="content-section"><div class="section-title"><h2>Upcoming programs</h2><span>Registration & events</span></div>${p.upcoming?.length ? resourceCollection(p.upcoming) : `<div class="empty-state compact">No upcoming programs posted.</div>`}</section>
    <section class="content-section"><div class="section-title"><h2>Current & previous academic year</h2><span>Recent recordings</span></div>${p.current.length ? resourceCollection(p.current) : `<div class="empty-state compact">No recent recordings posted.</div>`}</section>
    <section class="content-section"><div class="section-title"><h2>Archive</h2><span>Prior academic years</span></div>${p.archives.length ? resourceCollection(p.archives, true) : `<div class="empty-state compact">No archived resources posted.</div>`}</section>`;
  if (updateHash) history.replaceState(null, "", `#${p.slug}`);
}
function renderLibrary() {
  renderEvent(0);
  $("#programNav").innerHTML = library.programs
    .map(
      (p) =>
        `<button data-slug="${esc(p.slug)}"><span>${esc(p.short)}</span>${esc(p.name)}</button>`,
    )
    .join("");
  $("#programSelect").innerHTML = library.programs
    .map((p) => `<option value="${esc(p.slug)}">${esc(p.name)}</option>`)
    .join("");
  $("#programNav").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) renderProgram(b.dataset.slug);
  });
  $("#programSelect").addEventListener("change", (e) =>
    renderProgram(e.target.value),
  );
  renderProgram(location.hash.slice(1) || activeSlug, false);
}
const eventSignature = (events = []) =>
  events
    .map((x) => [x.id, x.title, x.description, x.ctaUrl, x.backgroundImage].join("|"))
    .join("||");
async function syncHeroEvents() {
  if (!library) return;
  try {
    const result = await api("/api/virtual-events");
    if (eventSignature(result.events) === eventSignature(library.events)) return;
    const currentId = library.events?.[activeEvent]?.id;
    library.events = result.events || [];
    const nextIndex = Math.max(
      0,
      library.events.findIndex((event) => event.id === currentId),
    );
    renderEvent(nextIndex);
  } catch {
    /* keep the existing carousel if SEMCME.org is unavailable */
  }
}
function startHeroSync() {
  clearInterval(heroSyncTimer);
  heroSyncTimer = setInterval(syncHeroEvents, heroSyncIntervalMs);
}
function renderEvent(index) {
  const events = library.events?.length
    ? library.events
    : [{ ...library.banner, date: "", time: "", location: "" }];
  activeEvent = (index + events.length) % events.length;
  const b = events[activeEvent];
  const meta = [b.date, b.time, b.location]
    .filter(Boolean)
    .map((x) => `<span>${esc(x)}</span>`)
    .join("");
  $("#featureBanner").style.backgroundImage = b.backgroundImage
    ? `url("${cssUrl(b.backgroundImage)}")`
    : "";
  const details = esc(b.description)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<span>${line}</span>`)
    .join("");
  $("#featureBanner").innerHTML =
    `<div class="feature-inner"><span class="mini-kicker">${esc(b.eyebrow)}</span><h1>${esc(b.title)}</h1>${meta ? `<div class="event-meta">${meta}</div>` : ""}${details ? `<div class="event-details">${details}</div>` : ""}<a href="${esc(b.ctaUrl)}" target="_blank" rel="noopener">${esc(b.ctaLabel)} <span>→</span></a></div>${events.length > 1 ? `<div class="carousel-controls" aria-label="Featured events carousel"><button data-carousel="prev" aria-label="Previous event">←</button><div class="carousel-dots">${events.map((_, i) => `<button class="${i === activeEvent ? "active" : ""}" data-carousel="${i}" aria-label="Show event ${i + 1}"></button>`).join("")}</div><button data-carousel="next" aria-label="Next event">→</button></div>` : ""}`;
  clearInterval(carouselTimer);
  if (
    events.length > 1 &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    carouselTimer = setInterval(() => renderEvent(activeEvent + 1), 7000);
}
$("#featureBanner").addEventListener("click", (e) => {
  const b = e.target.closest("[data-carousel]");
  if (!b) return;
  const action = b.dataset.carousel;
  renderEvent(
    action === "prev"
      ? activeEvent - 1
      : action === "next"
        ? activeEvent + 1
        : Number(action),
  );
});
async function loadLibrary() {
  try {
    library = await api("/api/library");
    $("#welcome").classList.add("hidden");
    $("#library").classList.remove("hidden");
    $("#registerTop").classList.add("hidden");
    $("#logout").classList.remove("hidden");
    $("#supportTop").classList.remove("hidden");
    renderLibrary();
    startHeroSync();
    scrollTo(0, 0);
  } catch {
    /* logged out */
  }
}

async function verifyMagicLink() {
  const params = new URLSearchParams(location.search);
  const token = params.get("token");
  if (!token) return false;
  status($("#loginForm"), "Signing you in…");
  try {
    await api("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    history.replaceState(null, "", location.pathname);
    await loadLibrary();
  } catch (x) {
    history.replaceState(null, "", location.pathname);
    status($("#loginForm"), esc(x.message));
  }
  return true;
}

const dialog = $("#supportDialog");
$$("[data-open-support],#supportTop").forEach((b) =>
  b.addEventListener("click", () => dialog.showModal()),
);
$("#supportForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  status(form, '<div class="status-card"><strong>Sending message</strong><span>Please wait while we send your question.</span></div>', "loading");
  try {
    const r = await api("/api/support", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    form.reset();
    status(
      form,
      r.delivered
        ? '<div class="status-card"><strong>Question sent</strong><span>Your question was sent to SEMCME staff.</span></div>'
        : '<div class="status-card"><strong>Question saved</strong><span>Email routing is not configured in this preview.</span></div>',
      true,
    );
  } catch (x) {
    status(form, loginErrorMessage(x.message));
  }
});

const config = await api("/api/config");
if (config.registrationUrl) $("#registerTop").href = config.registrationUrl;
if (!(await verifyMagicLink()) && config.authenticated) await loadLibrary();
