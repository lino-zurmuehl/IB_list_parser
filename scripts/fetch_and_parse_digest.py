#!/usr/bin/env python3
import email
import hashlib
import imaplib
import json
import os
import re
from html import unescape
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from email.header import decode_header, make_header
from email.policy import default
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "jobs.json"
MAX_ITEM_AGE_DAYS = int(os.environ.get("MAX_ITEM_AGE_DAYS", "28"))
DEADLINE_GRACE_DAYS = int(os.environ.get("DEADLINE_GRACE_DAYS", "5"))

JOB_REGEX_PATTERNS = [
    re.compile(r"\bjob\b", re.IGNORECASE),
    re.compile(r"\bvacanc(?:y|ies)\b", re.IGNORECASE),
    re.compile(r"\bopening\b", re.IGNORECASE),
    re.compile(r"\bassistant professor\b", re.IGNORECASE),
    re.compile(r"\bprofessur\b", re.IGNORECASE),
    re.compile(r"\bstelle\b", re.IGNORECASE),
    re.compile(r"\bstellenausschreibung\b", re.IGNORECASE),
    re.compile(r"\bhilfskraft\b", re.IGNORECASE),
    re.compile(r"\bpraktikum\b", re.IGNORECASE),
    re.compile(r"\binternship\b", re.IGNORECASE),
    re.compile(r"\bbewerbung\b", re.IGNORECASE),
    re.compile(r"\bbewerbungsfrist\b", re.IGNORECASE),
    re.compile(r"\bapply\b", re.IGNORECASE),
    re.compile(r"\bpostdoc\b", re.IGNORECASE),
    re.compile(r"\bphd\b", re.IGNORECASE),
    re.compile(r"\bdoktorand(?:en|in)?stelle\b", re.IGNORECASE),
]

DEADLINE_PATTERNS = [
    re.compile(r"apply by\s+([^\n\r.!?]+)", re.IGNORECASE),
    re.compile(r"bewerbungsfrist\s*[:\-]?\s*([^\n\r.!?]+)", re.IGNORECASE),
    re.compile(r"bis zum\s+([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{2,4})", re.IGNORECASE),
]

PROFILE_DS_KEYWORDS = [
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
]

PROFILE_POLICY_KEYWORDS = [
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
]

ISOLATED_ABBREVIATIONS = {"ml", "ai", "ki", "r"}

ENGLISH_MONTHS = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sep": 9,
    "sept": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}


def decode_mime(value: str) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def normalize_to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def parse_mail_date(date_text: str):
    if not date_text:
        return None
    try:
        dt = parsedate_to_datetime(date_text)
    except Exception:
        return None
    if not isinstance(dt, datetime):
        return None
    return normalize_to_utc(dt)


def parse_iso_datetime(value: str):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    return normalize_to_utc(dt)


def parse_deadline_date(text: str, fallback_year: int = None):
    if not text:
        return None

    numeric = re.search(r"\b([0-3]?\d)[./-]([0-1]?\d)[./-](\d{2,4})\b", text)
    if numeric:
        day = int(numeric.group(1))
        month = int(numeric.group(2))
        year = int(numeric.group(3))
        if year < 100:
            year += 2000
        try:
            return datetime(year, month, day, tzinfo=timezone.utc).date()
        except ValueError:
            return None

    english = re.search(
        r"\b([0-3]?\d)(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\b|\b([A-Za-z]+)\s+([0-3]?\d)(?:st|nd|rd|th)?[,]?\s+(\d{4})\b",
        text,
        flags=re.IGNORECASE,
    )
    if english:
        if english.group(1) and english.group(2) and english.group(3):
            day = int(english.group(1))
            month_name = english.group(2).lower()
            year = int(english.group(3))
        else:
            month_name = english.group(4).lower()
            day = int(english.group(5))
            year = int(english.group(6))
        month = ENGLISH_MONTHS.get(month_name)
        if month:
            try:
                return datetime(year, month, day, tzinfo=timezone.utc).date()
            except ValueError:
                return None

    month_day = re.search(r"\b([0-3]?\d)[./-]([0-1]?\d)\b", text)
    if month_day and fallback_year:
        day = int(month_day.group(1))
        month = int(month_day.group(2))
        try:
            return datetime(fallback_year, month, day, tzinfo=timezone.utc).date()
        except ValueError:
            return None

    return None


def decode_text_part(part: email.message.Message) -> str:
    try:
        content = part.get_content()
        if isinstance(content, str):
            return content
        if isinstance(content, bytes):
            charset = part.get_content_charset() or "utf-8"
            return content.decode(charset, errors="replace")
    except Exception:
        pass

    payload = part.get_payload(decode=True)
    if payload is None:
        raw_payload = part.get_payload()
        return raw_payload if isinstance(raw_payload, str) else ""

    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except Exception:
        return payload.decode("utf-8", errors="replace")


def extract_text_body(msg: email.message.Message) -> str:
    if msg.is_multipart():
        html_body = ""
        plain_body = ""
        for part in msg.walk():
            if part.is_multipart():
                continue
            ctype = part.get_content_type()
            disp = (part.get("Content-Disposition") or "").lower()
            if "attachment" in disp:
                continue
            if ctype not in {"text/plain", "text/html"}:
                continue
            decoded = decode_text_part(part).strip()
            if not decoded:
                continue
            if ctype == "text/html" and not html_body:
                html_body = decoded
            elif ctype == "text/plain" and not plain_body:
                plain_body = decoded
        return html_body or plain_body

    return decode_text_part(msg)


def split_messages(raw_text: str):
    normalized = raw_text.replace("\r", "")
    chunks = re.split(r"\n(?=\s*Message:\s+\d+\n)", normalized)
    filtered = [c for c in chunks if re.search(r"^\s*Message:\s+\d+", c, re.MULTILINE)]
    return filtered if filtered else [normalized]


def html_to_text(raw_html: str) -> str:
    text = raw_html
    text = re.sub(r"(?is)<(script|style)\b.*?>.*?</\1>", " ", text)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</(p|div|li|tr|h[1-6])>", "\n", text)
    text = re.sub(r"(?i)<li\b[^>]*>", "- ", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = unescape(text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_header(block: str, name: str) -> str:
    lines = block.replace("\r", "").split("\n")
    header_re = re.compile(rf"^\s*{re.escape(name)}:\s*(.*)$", re.IGNORECASE)
    any_header_re = re.compile(r"^\s*[A-Za-z][A-Za-z-]*:\s*")

    for idx, line in enumerate(lines):
        match = header_re.match(line)
        if not match:
            continue

        value_parts = [match.group(1).strip()] if match.group(1).strip() else []
        j = idx + 1
        while j < len(lines):
            nxt = lines[j]
            stripped = nxt.strip()
            if not stripped:
                j += 1
                continue
            if any_header_re.match(stripped):
                break
            if nxt.startswith((" ", "\t")):
                value_parts.append(stripped)
                j += 1
                continue
            break

        return re.sub(r"\s+", " ", " ".join(value_parts)).strip()

    return ""


def extract_body(block: str) -> str:
    lines = block.replace("\r", "").split("\n")
    header_re = re.compile(r"^\s*[A-Za-z][A-Za-z-]*:\s*")

    idx = 0
    seen_header = False
    while idx < len(lines):
        line = lines[idx]
        stripped = line.strip()
        if not stripped:
            idx += 1
            continue
        if header_re.match(stripped):
            seen_header = True
            idx += 1
            continue
        if line.startswith((" ", "\t")) and seen_header:
            idx += 1
            continue
        break

    body = "\n".join(lines[idx:]).strip()
    if not body:
        body = block.strip()
    return body


def clean_subject(subject: str) -> str:
    decoded = decode_mime(subject)
    cleaned = re.sub(r"^\[ib-liste\]\s*", "", decoded, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", cleaned).strip()


def infer_deadline(text: str) -> str:
    for pattern in DEADLINE_PATTERNS:
        m = pattern.search(text)
        if m and m.group(1):
            return m.group(1).strip()

    contextual = re.search(
        r"(?:deadline|application deadline|apply by|bewerbungsfrist|bewerbungsschluss|frist|bis zum)\s*[:\-]?\s*([^\n\r.!?]{0,80})",
        text,
        flags=re.IGNORECASE,
    )
    if contextual and contextual.group(1):
        return contextual.group(1).strip()

    return "Not found"


def infer_type(text: str, is_job_post: bool = False) -> str:
    if not is_job_post:
        return "N/A"
    lower = text.lower()
    if "assistant professor" in lower:
        return "Assistant Professor"
    if "postdoc" in lower:
        return "Postdoc"
    if "phd" in lower:
        return "PhD"
    if "professur" in lower:
        return "Professorship"
    if "praktikum" in lower or "internship" in lower:
        return "Internship"
    if "hilfskraft" in lower:
        return "Student Assistant"
    if "stelle" in lower or re.search(r"\bjob\b", text, flags=re.IGNORECASE):
        return "Position"
    return "N/A"


def infer_org(subject: str, body: str) -> str:
    combined = f"{subject}\n{body}"
    uni = re.search(r"(?:University|Universit[aä]t|Institut|Institute)\s+[^,\n.]*", combined, re.IGNORECASE)
    if uni:
        return uni.group(0).strip()
    comma_subject = re.search(r",\s*([^,]+)$", subject)
    if comma_subject:
        return comma_subject.group(1).strip()
    return "Unknown"


def is_job(text: str) -> bool:
    return any(pattern.search(text) for pattern in JOB_REGEX_PATTERNS)


def classify_ds_policy_fit(text: str):
    lower = text.lower()
    ds_hits = [k for k in PROFILE_DS_KEYWORDS if keyword_matches(lower, k)]
    policy_hits = [k for k in PROFILE_POLICY_KEYWORDS if keyword_matches(lower, k)]
    score = len(ds_hits) + len(policy_hits)
    is_match = len(ds_hits) >= 1 and len(policy_hits) >= 1 and score >= 2
    return {
        "isDsPolicyFit": is_match,
        "dsPolicyScore": score,
        "dsPolicyMatchedKeywords": (ds_hits + policy_hits)[:10],
    }


def keyword_matches(lower_text: str, keyword: str) -> bool:
    k = keyword.strip().lower()
    if not k:
        return False
    if k in ISOLATED_ABBREVIATIONS:
        return bool(re.search(rf"\b{re.escape(k)}\b", lower_text, flags=re.IGNORECASE))
    return k in lower_text


def parse_digest_text(raw_text: str):
    if re.search(r"(?i)<html|<br\s*/?>|<div\b|<body\b", raw_text):
        raw_text = html_to_text(raw_text)
    items = []
    for idx, block in enumerate(split_messages(raw_text), start=1):
        subject = extract_header(block, "Subject") or f"Message {idx}"
        sender = extract_header(block, "From") or "Unknown"
        date = extract_header(block, "Date") or "Unknown"
        body = extract_body(block)
        text = f"{subject}\n{body}"
        links = list(dict.fromkeys(re.findall(r"https?://[^\s)>]+", body)))
        fit = classify_ds_policy_fit(text)
        is_job_post = is_job(text)
        parsed_mail_dt = parse_mail_date(date)
        deadline_text = infer_deadline(text)
        deadline_date = parse_deadline_date(
            deadline_text if deadline_text != "Not found" else "",
            fallback_year=(parsed_mail_dt.year if parsed_mail_dt else None),
        )

        item = {
            "subject": clean_subject(subject),
            "from": sender,
            "date": date,
            "dateUtc": (parsed_mail_dt.isoformat() if parsed_mail_dt else None),
            "organization": infer_org(subject, body),
            "positionType": infer_type(text, is_job_post),
            "deadline": deadline_text,
            "deadlineDate": (deadline_date.isoformat() if deadline_date else None),
            "links": links,
            "snippet": body.strip(),
            "isJob": is_job_post,
            "isDsPolicyFit": fit["isDsPolicyFit"],
            "dsPolicyScore": fit["dsPolicyScore"],
            "dsPolicyMatchedKeywords": fit["dsPolicyMatchedKeywords"],
        }
        fingerprint_source = f"{item['subject']}|{item['from']}|{item['date']}|{(links[0] if links else '')}"
        item["id"] = hashlib.sha1(fingerprint_source.encode("utf-8", errors="ignore")).hexdigest()[:16]
        items.append(item)

    return items


def load_existing():
    if not DATA_FILE.exists():
        return {"generated_at": None, "source": "imap", "items": []}
    return json.loads(DATA_FILE.read_text(encoding="utf-8"))


def save_payload(payload):
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fetch_messages():
    host = os.environ["IMAP_HOST"]
    port = int(os.environ.get("IMAP_PORT", "993"))
    user = os.environ["IMAP_USER"].strip()
    password = os.environ["IMAP_PASS"]
    folder = os.environ.get("IMAP_FOLDER", "INBOX").strip()
    sender_filter = os.environ.get("SENDER_FILTER", "").strip()
    subject_filter = os.environ.get("SUBJECT_FILTER", "ib-liste").strip()

    conn = imaplib.IMAP4_SSL(host, port)
    conn.login(user, password)
    status, folder_info = conn.select(f'"{folder}"')
    if status != "OK":
        conn.logout()
        raise RuntimeError(f"Could not select IMAP folder: {folder!r}")

    total_in_folder = folder_info[0].decode("utf-8", errors="ignore") if folder_info and folder_info[0] else "0"
    print(f"imap_selected_folder={folder}")
    print(f"imap_total_messages_in_folder={total_in_folder}")

    # Try strict server-side filters first, then progressively relax.
    search_attempts = []
    strict_criteria = ["UNSEEN"]
    if sender_filter:
        strict_criteria.extend(["FROM", f'"{sender_filter}"'])
    if subject_filter:
        strict_criteria.extend(["SUBJECT", f'"{subject_filter}"'])
    search_attempts.append(("strict", strict_criteria))
    if sender_filter or subject_filter:
        search_attempts.append(("unseen_only", ["UNSEEN"]))
    search_attempts.append(("all", ["ALL"]))

    ids = []
    for label, criteria in search_attempts:
        status, data = conn.search(None, *criteria)
        if status != "OK":
            continue
        found = data[0].split() if data and data[0] else []
        print(f"imap_search_{label}_count={len(found)}")
        if found:
            ids = found
            break

    results = []

    for msg_id in ids:
        status, fetched = conn.fetch(msg_id, "(BODY.PEEK[])")
        if status != "OK" or not fetched:
            continue

        raw_bytes = fetched[0][1]
        msg = email.message_from_bytes(raw_bytes, policy=default)
        subject = decode_mime(msg.get("Subject", ""))
        sender = decode_mime(msg.get("From", ""))
        date = decode_mime(msg.get("Date", ""))
        body = extract_text_body(msg)

        if subject_filter and subject_filter.lower() not in subject.lower():
            continue
        if sender_filter and sender_filter.lower() not in sender.lower():
            continue

        results.append(
            {
                "mail_subject": subject,
                "mail_from": sender,
                "mail_date": date,
                "body": body,
            }
        )

    conn.logout()
    return results


def main():
    existing = load_existing()
    existing_items = existing.get("items", [])
    known_ids = {item.get("id") for item in existing_items if item.get("id")}

    mails = fetch_messages()
    new_items = []

    for mail in mails:
        parsed = parse_digest_text(mail["body"])
        for item in parsed:
            if item["id"] in known_ids:
                continue
            known_ids.add(item["id"])
            new_items.append(item)

    def item_date_for_sort(item):
        dt = parse_iso_datetime(item.get("dateUtc", "")) or parse_mail_date(item.get("date", ""))
        return dt or datetime.min.replace(tzinfo=timezone.utc)

    merged = sorted(existing_items + new_items, key=item_date_for_sort, reverse=True)
    for item in merged:
        text = "\n".join(
            [
                item.get("subject", ""),
                item.get("snippet", ""),
                item.get("organization", ""),
                item.get("positionType", ""),
            ]
        )
        item["isJob"] = is_job(text)
        item["positionType"] = infer_type(text, bool(item.get("isJob")))
        if "isDsPolicyFit" not in item or "dsPolicyScore" not in item:
            fit = classify_ds_policy_fit(text)
            item["isDsPolicyFit"] = fit["isDsPolicyFit"]
            item["dsPolicyScore"] = fit["dsPolicyScore"]
            item["dsPolicyMatchedKeywords"] = fit["dsPolicyMatchedKeywords"]
        if not item.get("dateUtc"):
            parsed_mail_dt = parse_mail_date(item.get("date", ""))
            item["dateUtc"] = parsed_mail_dt.isoformat() if parsed_mail_dt else None
        if not item.get("deadlineDate") and item.get("deadline") and item.get("deadline") != "Not found":
            parsed_mail_dt = parse_mail_date(item.get("date", ""))
            deadline_date = parse_deadline_date(
                item.get("deadline", ""),
                fallback_year=(parsed_mail_dt.year if parsed_mail_dt else None),
            )
            item["deadlineDate"] = deadline_date.isoformat() if deadline_date else None

    now_utc = datetime.now(timezone.utc)
    min_date_utc = now_utc - timedelta(days=MAX_ITEM_AGE_DAYS)
    latest_allowed_deadline = (now_utc - timedelta(days=DEADLINE_GRACE_DAYS)).date()
    pruned = []
    removed_by_age = 0
    removed_by_deadline = 0
    for item in merged:
        item_dt = parse_iso_datetime(item.get("dateUtc", "")) or parse_mail_date(item.get("date", ""))
        if item_dt and item_dt < min_date_utc:
            removed_by_age += 1
            continue
        deadline_date = None
        deadline_raw = item.get("deadlineDate")
        if isinstance(deadline_raw, str) and deadline_raw:
            try:
                deadline_date = datetime.fromisoformat(deadline_raw).date()
            except ValueError:
                deadline_date = None
        if deadline_date and deadline_date < latest_allowed_deadline:
            removed_by_deadline += 1
            continue
        pruned.append(item)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "imap",
        "items": pruned[:500],
        "stats": {
            "new_items": len(new_items),
            "total_items": len(pruned[:500]),
            "processed_messages": len(mails),
            "removed_old_items": removed_by_age,
            "removed_past_deadline_items": removed_by_deadline,
        },
    }

    save_payload(payload)
    print(f"processed_messages={len(mails)}")
    print(f"new_items={len(new_items)}")
    print(f"total_items={payload['stats']['total_items']}")


if __name__ == "__main__":
    main()
