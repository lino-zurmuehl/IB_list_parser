const inputEl = document.getElementById("digestInput");
const parseBtn = document.getElementById("parseBtn");
const clearBtn = document.getElementById("clearBtn");
const refreshBtn = document.getElementById("refreshBtn");
const jobsOnlyEl = document.getElementById("jobsOnly");
const dsPolicyOnlyEl = document.getElementById("dsPolicyOnly");
const linkedinOnlyEl = document.getElementById("linkedinOnly");
const summaryEl = document.getElementById("summary");
const resultsEl = document.getElementById("results");
const itemTemplate = document.getElementById("itemTemplate");

const JOB_REGEX_PATTERNS = [
  /\bjob\b/i,
  /\bvacanc(?:y|ies)\b/i,
  /\bopening\b/i,
  /\bassistant professor\b/i,
  /\bprofessur\b/i,
  /\bstelle\b/i,
  /\bstellenausschreibung\b/i,
  /\bhilfskraft\b/i,
  /\bpraktikum\b/i,
  /\binternship\b/i,
  /\bbewerbung\b/i,
  /\bbewerbungsfrist\b/i,
  /\bapply\b/i,
  /\bpostdoc\b/i,
  /\bphd\b/i,
  /\bdoktorand(?:en|in)?stelle\b/i,
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
const NOISE_LINK_SUBSTRINGS = [
  "lists.fu-berlin.de/listinfo/ib-liste",
  "ib-liste@lists.fu-berlin.de",
  "lists.fu-berlin.de/private/ib-liste/attachments/",
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
if (linkedinOnlyEl) {
  linkedinOnlyEl.addEventListener("change", () => {
    renderItems(activeItems);
    updateSummary();
  });
}

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
  const linkedin = activeItems.filter((it) => it.isLinkedInJob).length;
  const shown = applyFilters(activeItems).length;
  const label = source === "manual" ? "Manual parse" : source === "feed" ? "Auto feed" : "Current view";
  summaryEl.textContent = `${label}: ${total} item(s), ${jobs} job-related, ${profileFit} DS+Policy fit, ${linkedin} LinkedIn, showing ${shown}.${suffix}`;
}

function parseDigest(raw) {
  const normalizedInput = looksLikeHtml(raw) ? htmlToText(raw) : raw;
  const chunks = splitMessages(normalizedInput);
  const items = chunks.map((chunk, i) => parseMessage(chunk, i + 1));
  return { items };
}

function splitMessages(raw) {
  const normalized = raw.replace(/\r/g, "");
  const fallback = normalized
    .split(/\n(?=\s*Message:\s+\d+\n)/)
    .filter((part) => /^\s*Message:\s+\d+/m.test(part));

  return fallback.length ? fallback : [normalized];
}

function parseMessage(chunk, index) {
  const subject = extractHeader(chunk, "Subject") || `Message ${index}`;
  const from = extractHeader(chunk, "From") || "Unknown";
  const date = extractHeader(chunk, "Date") || "Unknown";
  const body = extractBody(chunk);

  const links = cleanLinks(body.match(/https?:\/\/[^\s)>]+/g) || []);
  const text = `${subject}\n${body}`;

  const isJob = isJobRelated(text);
  const fit = classifyDsPolicyFit(text);
  const organization = inferOrganization(subject, body);
  const deadline = inferDeadline(text);
  const isLinkedInJob = detectLinkedInItem({
    subject,
    from,
    snippet: body,
  });
  const positionType = inferPositionType(text, isJob || isLinkedInJob);

  return {
    index,
    subject: cleanSubject(subject),
    from,
    date,
    organization,
    deadline,
    positionType,
    links,
    snippet: body.trim(),
    isJob: isJob || isLinkedInJob,
    isLinkedInJob,
    isDsPolicyFit: fit.isMatch,
    dsPolicyScore: fit.score,
    dsPolicyMatchedKeywords: fit.keywords,
  };
}

function extractHeader(chunk, headerName) {
  const lines = chunk.replace(/\r/g, "").split("\n");
  const headerRe = new RegExp(`^\\s*${escapeRegex(headerName)}:\\s*(.*)$`, "i");
  const anyHeaderRe = /^\s*[A-Za-z][A-Za-z-]*:\s*/;

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(headerRe);
    if (!match) continue;

    const parts = [];
    if (match[1] && match[1].trim()) parts.push(match[1].trim());

    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      const stripped = next.trim();
      if (!stripped) {
        j += 1;
        continue;
      }
      if (anyHeaderRe.test(stripped)) break;
      if (/^[ \t]/.test(next)) {
        parts.push(stripped);
        j += 1;
        continue;
      }
      break;
    }

    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  return "";
}

function extractBody(chunk) {
  const lines = chunk.replace(/\r/g, "").split("\n");
  const headerRe = /^\s*[A-Za-z][A-Za-z-]*:\s*/;
  let i = 0;
  let seenHeader = false;

  while (i < lines.length) {
    const line = lines[i];
    const stripped = line.trim();
    if (!stripped) {
      i += 1;
      continue;
    }
    if (headerRe.test(stripped)) {
      seenHeader = true;
      i += 1;
      continue;
    }
    if (/^[ \t]/.test(line) && seenHeader) {
      i += 1;
      continue;
    }
    break;
  }

  const body = lines.slice(i).join("\n").trim();
  return body || chunk;
}

function cleanSubject(subject) {
  return subject.replace(/^\[ib-liste\]\s*/i, "").replace(/\s+/g, " ").trim();
}

function isJobRelated(text) {
  return JOB_REGEX_PATTERNS.some((pattern) => pattern.test(text));
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

function inferPositionType(text, isJob = false) {
  if (!isJob) return "N/A";
  const lower = text.toLowerCase();
  if (lower.includes("assistant professor")) return "Assistant Professor";
  if (lower.includes("postdoc")) return "Postdoc";
  if (lower.includes("phd")) return "PhD";
  if (lower.includes("professur")) return "Professorship";
  if (lower.includes("praktikum") || lower.includes("internship")) return "Internship";
  if (lower.includes("hilfskraft")) return "Student Assistant";
  if (lower.includes("stelle") || /\bjob\b/i.test(text)) return "Position";
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
      ["Source", item.isLinkedInJob ? "LinkedIn" : item.sourceTag || "IMAP"],
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
      item.links.slice(0, 4).forEach((url, idx) => {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        if (item.isLinkedInJob) {
          a.textContent = "Apply on LinkedIn";
        } else {
          a.textContent = buildLinkLabel(item, url, idx);
        }
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

function looksLikeHtml(text) {
  return /<html|<body|<div|<br\s*\/?>/i.test(text);
}

function htmlToText(rawHtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, "text/html");
  doc.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
  const text = (doc.body?.textContent || rawHtml).replace(/\u00a0/g, " ");
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
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
    const isLinkedInJob = Boolean(
      item.isLinkedInJob ??
        detectLinkedInItem({
          subject: item.subject,
          from: item.from,
          snippet: item.snippet,
          sourceTag: item.sourceTag,
          sourceFolder: item.sourceFolder,
        })
    );
    const inferredJob = isJobRelated(text) || isLinkedInJob;
    return {
      ...item,
      links: cleanLinks(item.links),
      isJob: inferredJob,
      isLinkedInJob,
      sourceTag: item.sourceTag || "imap",
      sourceFolder: item.sourceFolder || "",
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
    if (linkedinOnlyEl && linkedinOnlyEl.checked && !it.isLinkedInJob) return false;
    return true;
  });
}

function detectLinkedInItem(item = {}) {
  const subject = String(item.subject || "").toLowerCase();
  const from = String(item.from || "").toLowerCase();
  const snippet = String(item.snippet || "").toLowerCase();
  const sourceTag = String(item.sourceTag || "").toLowerCase();
  const sourceFolder = String(item.sourceFolder || "").toLowerCase();
  if (sourceTag === "linkedin") return true;
  if (sourceFolder.includes("linkedin")) return true;
  if (from.includes("linkedin")) return true;
  if (from.includes("jobalerts-noreply@linkedin.com")) return true;
  if (subject.includes("job alert") || subject.includes("jobbenachrichtigung")) return true;
  return snippet.includes("linkedin") && (snippet.includes("job alert") || snippet.includes("jobbenachrichtigung"));
}

function buildLinkLabel(item, url, index = 0) {
  const fromSnippet = extractLabelFromSnippet(item?.snippet || "", url);
  if (fromSnippet) return fromSnippet;
  const host = hostLabel(url);
  return host || `Open link ${index + 1}`;
}

function extractLabelFromSnippet(snippet, url) {
  if (!snippet || !url) return "";
  const text = String(snippet);
  const variants = uniqueUrlVariants(url);
  let pos = -1;

  for (const candidate of variants) {
    pos = text.indexOf(candidate);
    if (pos !== -1) break;
  }
  if (pos === -1) return "";

  let before = text.slice(Math.max(0, pos - 140), pos).replace(/\s+/g, " ").trim();
  const angleIdx = before.lastIndexOf("<");
  if (angleIdx !== -1) before = before.slice(0, angleIdx).trim();
  before = before.replace(/[\s([{"'`-]+$/g, "").trim();
  if (!before) return "";

  let tail = before.split(/[.;!?]\s+/).pop()?.trim() || before;
  if (tail.length > 48) {
    const projectLike = tail.match(/\b(?:im|in|for)\s+([A-Za-z0-9ÄÖÜäöüß+&/ -]{3,})$/i);
    if (projectLike?.[1]) {
      tail = projectLike[1].trim();
    } else {
      tail = tail.split(/\s+/).slice(-4).join(" ").trim();
    }
  }

  tail = tail.replace(/^[-:|]\s*/, "").replace(/\s+[-:|]\s*$/, "").trim();
  if (!tail) return "";
  if (/^(open link|link|mehr infos?|hier|klicken)$/i.test(tail)) return "";
  return tail;
}

function uniqueUrlVariants(url) {
  const set = new Set();
  const raw = String(url);
  set.add(raw);
  set.add(raw.replace(/&amp;/g, "&"));
  set.add(raw.replace(/&/g, "&amp;"));
  set.add(raw.replace(/[)\].,;:!?]+$/, ""));
  return Array.from(set).filter(Boolean);
}

function hostLabel(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    return host || "";
  } catch (_err) {
    return "";
  }
}

function cleanLinks(links) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(links) ? links : []) {
    if (typeof raw !== "string") continue;
    const url = raw.replace(/&amp;/g, "&").trim();
    if (!url || shouldExcludeLink(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function shouldExcludeLink(url) {
  const u = String(url || "").toLowerCase();
  return NOISE_LINK_SUBSTRINGS.some((noise) => u.includes(noise));
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
