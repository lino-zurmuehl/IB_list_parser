const inputEl = document.getElementById("digestInput");
const parseBtn = document.getElementById("parseBtn");
const clearBtn = document.getElementById("clearBtn");
const refreshBtn = document.getElementById("refreshBtn");
const jobsOnlyEl = document.getElementById("jobsOnly");
const dsPolicyOnlyEl = document.getElementById("dsPolicyOnly");
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

const PROFILE_DS_KEYWORDS = [
  "data science",
  "data scientist",
  "datenwissenschaft",
  "datenwissenschaftler",
  "datenanalyse",
  "datenanalyst",
  "datengetrieben",
  "datenbasiert",
  "datenkompetenz",
  "datenmanagement",
  "datenmodellierung",
  "datenvisualisierung",
  "datenbank",
  "business intelligence",
  "kuenstliche intelligenz",
  "künstliche intelligenz",
  "maschinelles lernen",
  "prädiktiv",
  "praediktiv",
  "prognosemodell",
  "text mining",
  "zeitreihenanalyse",
  "wirkungsanalyse",
  "evaluationsmethoden",
  "statistik",
  "statistische analyse",
  "quantitative methoden",
  "quantitative analyse",
  "paneldaten",
  "mikrodaten",
  "forschungsdaten",
  "survey daten",
  "umfragedaten",
  "machine learning",
  "ml",
  "ai",
  "artificial intelligence",
  "nlp",
  "natural language processing",
  "deep learning",
  "statistics",
  "statistical",
  "causal inference",
  "econometrics",
  "python",
  "r ",
  "sql",
  "pandas",
  "scikit",
  "analytics",
  "data analysis",
  "computational",
  "quantitative",
  "visualization",
  "gis",
  "big data",
];

const PROFILE_POLICY_KEYWORDS = [
  "public policy",
  "policy",
  "politikberatung",
  "politikfeldanalyse",
  "politikanalyse",
  "politikforschung",
  "oeffentliche politik",
  "öffentliche politik",
  "verwaltung",
  "oeffentliche verwaltung",
  "öffentliche verwaltung",
  "politik",
  "regierung",
  "ministerium",
  "bundestag",
  "bundesregierung",
  "laender",
  "länder",
  "kommunalpolitik",
  "eu",
  "europaeische union",
  "europäische union",
  "entwicklungspolitik",
  "sicherheitspolitik",
  "friedenspolitik",
  "klimapolitik",
  "migrationspolitik",
  "arbeitsmarktpolitik",
  "sozialpolitik",
  "bildungspolitik",
  "gesundheitspolitik",
  "regulierungspolitik",
  "verordnung",
  "gesetzgebung",
  "verwaltungswissenschaft",
  "politikwissenschaft",
  "sozialwissenschaft",
  "wirkungsorientierung",
  "evidenzbasiert",
  "evidenzbasierte politik",
  "folgenabschaetzung",
  "folgenabschätzung",
  "monitoring",
  "evaluation",
  "thinktank",
  "stiftung",
  "governance",
  "regulation",
  "regulatory",
  "government",
  "ministry",
  "parliament",
  "think tank",
  "international relations",
  "global political economy",
  "development",
  "public administration",
  "impact evaluation",
  "evidence-based",
  "social science",
  "political science",
  "public sector",
  "european union",
  "eu policy",
  "united nations",
  "peace",
  "security policy",
  "climate policy",
  "migration policy",
];

const ISOLATED_ABBREVIATIONS = new Set(["ml", "ai", "ki", "r"]);

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
  activeItems = normalizeItems(parsed.items);
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
dsPolicyOnlyEl.addEventListener("change", () => {
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
    activeItems = normalizeItems(Array.isArray(payload.items) ? payload.items : []);

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
  const profileFit = activeItems.filter((it) => it.isDsPolicyFit).length;
  const shown = applyFilters(activeItems).length;
  const label = source === "manual" ? "Manual parse" : source === "feed" ? "Auto feed" : "Current view";
  summaryEl.textContent = `${label}: ${total} item(s), ${jobs} job-related, ${profileFit} DS+Policy fit, showing ${shown}.${suffix}`;
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
  const fit = classifyDsPolicyFit(text);
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
    isDsPolicyFit: fit.isMatch,
    dsPolicyScore: fit.score,
    dsPolicyMatchedKeywords: fit.keywords,
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
  const visible = applyFilters(items);

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
      ["DS+Policy Fit", item.isDsPolicyFit ? `Yes (${item.dsPolicyScore || 0})` : "No"],
      [
        "Matched Terms",
        Array.isArray(item.dsPolicyMatchedKeywords) && item.dsPolicyMatchedKeywords.length
          ? item.dsPolicyMatchedKeywords.join(", ")
          : "None",
      ],
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

function normalizeItems(items) {
  return items.map((item) => {
    const text = [
      item.subject || "",
      item.snippet || "",
      item.organization || "",
      item.positionType || "",
    ].join("\n");

    const fit = classifyDsPolicyFit(text);
    return {
      ...item,
      isJob: Boolean(item.isJob ?? isJobRelated(text)),
      isDsPolicyFit: Boolean(item.isDsPolicyFit ?? fit.isMatch),
      dsPolicyScore: Number(item.dsPolicyScore ?? fit.score),
      dsPolicyMatchedKeywords: Array.isArray(item.dsPolicyMatchedKeywords) ? item.dsPolicyMatchedKeywords : fit.keywords,
    };
  });
}

function applyFilters(items) {
  return items.filter((it) => {
    if (jobsOnlyEl.checked && !it.isJob) return false;
    if (dsPolicyOnlyEl.checked && !it.isDsPolicyFit) return false;
    return true;
  });
}

function classifyDsPolicyFit(text) {
  const lower = text.toLowerCase();
  const dsHits = PROFILE_DS_KEYWORDS.filter((k) => keywordMatches(lower, k));
  const policyHits = PROFILE_POLICY_KEYWORDS.filter((k) => keywordMatches(lower, k));
  const score = dsHits.length + policyHits.length;
  const isMatch = dsHits.length >= 1 && policyHits.length >= 1 && score >= 2;

  return {
    isMatch,
    score,
    keywords: [...dsHits, ...policyHits].slice(0, 10),
  };
}

function keywordMatches(lowerText, keyword) {
  const k = keyword.trim().toLowerCase();
  if (!k) return false;
  if (ISOLATED_ABBREVIATIONS.has(k)) {
    return new RegExp(`\\b${escapeRegex(k)}\\b`, "i").test(lowerText);
  }
  return lowerText.includes(k);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

loadFeed();
