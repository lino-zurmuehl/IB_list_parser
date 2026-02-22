const inputEl = document.getElementById("digestInput");
const parseBtn = document.getElementById("parseBtn");
const clearBtn = document.getElementById("clearBtn");
const refreshBtn = document.getElementById("refreshBtn");
const jobsOnlyEl = document.getElementById("jobsOnly");
const summaryEl = document.getElementById("summary");
const resultsEl = document.getElementById("results");
const itemTemplate = document.getElementById("itemTemplate");

const JOB_KEYWORDS = [
  "job",
  "vacancy",
  "assistant professor",
  "professor",
  "stelle",
  "stellenausschreibung",
  "hilfskraft",
  "praktikum",
  "internship",
  "bewerbung",
  "bewerbungsfrist",
  "apply",
  "position",
  "postdoc",
  "phd",
];

const DEADLINE_PATTERNS = [
  /apply by\s+([^\n\r.!?]+)/i,
  /bewerbungsfrist\s*[:\-]?\s*([^\n\r.!?]+)/i,
  /bis zum\s+([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{2,4})/i,
];

let activeItems = [];

refreshBtn.addEventListener("click", () => {
  loadFeed();
});

parseBtn.addEventListener("click", () => {
  const raw = inputEl.value.trim();
  if (!raw) {
    renderEmpty("Paste digest text first.");
    summaryEl.textContent = "No digest parsed yet.";
    return;
  }

  const parsed = parseDigest(raw);
  activeItems = parsed.items;
  renderItems(activeItems);
  updateSummary("manual");
});

clearBtn.addEventListener("click", () => {
  if (inputEl) inputEl.value = "";
});

jobsOnlyEl.addEventListener("change", () => {
  renderItems(activeItems);
  updateSummary();
});

async function loadFeed() {
  try {
    summaryEl.textContent = "Loading feed...";
    const res = await fetch(`data/jobs.json?v=${Date.now()}`, { cache: "no-store" });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const payload = await res.json();
    activeItems = Array.isArray(payload.items) ? payload.items : [];

    renderItems(activeItems);

    const stamp = payload.generated_at ? ` Last update: ${payload.generated_at}.` : "";
    updateSummary("feed", stamp);
  } catch (err) {
    activeItems = [];
    renderEmpty("Automated feed unavailable. Use manual parser below.");
    summaryEl.textContent = `Could not load feed (${err.message}).`;
  }
}

function updateSummary(source = "current", suffix = "") {
  const total = activeItems.length;
  const jobs = activeItems.filter((it) => it.isJob).length;
  const shown = jobsOnlyEl.checked ? jobs : total;
  const label = source === "manual" ? "Manual parse" : source === "feed" ? "Auto feed" : "Current view";
  summaryEl.textContent = `${label}: ${total} item(s), ${jobs} job-related, showing ${shown}.${suffix}`;
}

function parseDigest(raw) {
  const chunks = splitMessages(raw);
  const items = chunks.map((chunk, i) => parseMessage(chunk, i + 1));
  return { items };
}

function splitMessages(raw) {
  const normalized = raw.replace(/\r/g, "");
  const fallback = normalized
    .split(/\n(?=Message:\s+\d+\n)/)
    .filter((part) => /^Message:\s+\d+/m.test(part));

  return fallback.length ? fallback : [normalized];
}

function parseMessage(chunk, index) {
  const subject = extractHeader(chunk, "Subject") || `Message ${index}`;
  const from = extractHeader(chunk, "From") || "Unknown";
  const date = extractHeader(chunk, "Date") || "Unknown";
  const body = chunk.split(/\n\n/).slice(1).join("\n\n") || chunk;

  const links = Array.from(new Set(body.match(/https?:\/\/[^\s)>]+/g) || []));
  const text = `${subject}\n${body}`;

  const isJob = isJobRelated(text);
  const organization = inferOrganization(subject, body);
  const deadline = inferDeadline(text);
  const positionType = inferPositionType(text);

  return {
    index,
    subject: cleanSubject(subject),
    from,
    date,
    organization,
    deadline,
    positionType,
    links,
    snippet: body.trim().slice(0, 900),
    isJob,
  };
}

function extractHeader(chunk, headerName) {
  const re = new RegExp(`^${headerName}:\\s*([\\s\\S]*?)(?=\\n[A-Z][A-Za-z-]+:|\\n\\n|$)`, "m");
  const match = chunk.match(re);
  return match ? match[1].replace(/\n\s+/g, " ").trim() : "";
}

function cleanSubject(subject) {
  return subject.replace(/^\[ib-liste\]\s*/i, "").trim();
}

function isJobRelated(text) {
  const lower = text.toLowerCase();
  return JOB_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function inferDeadline(text) {
  for (const pattern of DEADLINE_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return "Not found";
}

function inferPositionType(text) {
  const lower = text.toLowerCase();
  if (lower.includes("assistant professor")) return "Assistant Professor";
  if (lower.includes("postdoc")) return "Postdoc";
  if (lower.includes("phd")) return "PhD";
  if (lower.includes("praktikum") || lower.includes("internship")) return "Internship";
  if (lower.includes("hilfskraft")) return "Student Assistant";
  if (lower.includes("stelle") || lower.includes("position") || lower.includes("job")) return "Position";
  return "N/A";
}

function inferOrganization(subject, body) {
  const combined = `${subject}\n${body}`;

  const uniMatch = combined.match(/(?:University|Universit[aä]t|Institut|Institute)\s+[^,\n.]*/i);
  if (uniMatch) return uniMatch[0].trim();

  const commaSubject = subject.match(/,\s*([^,]+)$/);
  if (commaSubject) return commaSubject[1].trim();

  return "Unknown";
}

function renderItems(items) {
  const visible = jobsOnlyEl.checked ? items.filter((it) => it.isJob) : items;

  if (!visible.length) {
    renderEmpty("No matching items found with current filter.");
    return;
  }

  resultsEl.innerHTML = "";
  for (const item of visible) {
    const node = itemTemplate.content.cloneNode(true);

    const titleEl = node.querySelector(".title");
    const badgeEl = node.querySelector(".badge");
    const metaEl = node.querySelector(".meta");
    const linksEl = node.querySelector(".links");
    const snippetEl = node.querySelector(".snippet");

    titleEl.textContent = item.subject;
    badgeEl.textContent = item.isJob ? "Job" : "Other";
    badgeEl.classList.add(item.isJob ? "job" : "other");

    const fields = [
      ["From", item.from],
      ["Date", item.date],
      ["Organization", item.organization || "Unknown"],
      ["Type", item.positionType || "N/A"],
      ["Deadline", item.deadline || "Not found"],
    ];

    fields.forEach(([k, v]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      metaEl.appendChild(dt);
      metaEl.appendChild(dd);
    });

    if (Array.isArray(item.links) && item.links.length) {
      item.links.slice(0, 4).forEach((url) => {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = "Open link";
        linksEl.appendChild(a);
      });
    }

    snippetEl.textContent = item.snippet || "No body text found.";

    resultsEl.appendChild(node);
  }
}

function renderEmpty(message) {
  resultsEl.innerHTML = `<div class="empty">${message}</div>`;
}

loadFeed();
