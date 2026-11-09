import { initializeMemberCatalog } from './member-catalog.js';
import { prepareMagicLink } from './magic-link.js';
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
const heroSyncIntervalMs = 60 * 1000;
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
        : `<div class="status-card"><strong>Local sign-in link ready</strong><span>Email delivery is not configured locally.</span><span>This dev Sign-In Link expires in 15 minutes and can only be used once.</span><span><a href="${esc(result.signInUrl)}">Open your dev sign-in link</a></span></div>`,
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

function renderLibrary() {
  renderEvent(0);
  initializeMemberCatalog({ api, esc });
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
  return prepareMagicLink({
    token,
    button: $('#continueSignIn'),
    requestNew: $('#requestNewSignIn'),
    clearUrl: () => history.replaceState(null, '', location.pathname),
    showConfirmation: () => { $('#loginForm').classList.add('hidden'); $('#confirmSignIn').classList.remove('hidden'); },
    showLogin: () => { $('#confirmSignIn').classList.add('hidden'); $('#loginForm').classList.remove('hidden'); $('#loginForm input[name="email"]').focus(); },
    showStatus: (message, type) => status($('#confirmSignIn'), esc(message), type),
    verify: token => api("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
    signedIn: loadLibrary,
  });
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
