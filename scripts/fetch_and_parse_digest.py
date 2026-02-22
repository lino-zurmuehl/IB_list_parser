#!/usr/bin/env python3
import email
import hashlib
import imaplib
import json
import os
import re
from datetime import datetime, timezone
from email.header import decode_header, make_header
from email.policy import default
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "jobs.json"

JOB_KEYWORDS = [
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
]

DEADLINE_PATTERNS = [
    re.compile(r"apply by\s+([^\n\r.!?]+)", re.IGNORECASE),
    re.compile(r"bewerbungsfrist\s*[:\-]?\s*([^\n\r.!?]+)", re.IGNORECASE),
    re.compile(r"bis zum\s+([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{2,4})", re.IGNORECASE),
]


def decode_mime(value: str) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def extract_text_body(msg: email.message.Message) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = (part.get("Content-Disposition") or "").lower()
            if ctype == "text/plain" and "attachment" not in disp:
                payload = part.get_payload(decode=True)
                if payload is None:
                    continue
                charset = part.get_content_charset() or "utf-8"
                try:
                    return payload.decode(charset, errors="replace")
                except Exception:
                    return payload.decode("utf-8", errors="replace")
        return ""

    payload = msg.get_payload(decode=True)
    if payload is None:
        return ""
    charset = msg.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except Exception:
        return payload.decode("utf-8", errors="replace")


def split_messages(raw_text: str):
    normalized = raw_text.replace("\r", "")
    chunks = re.split(r"\n(?=Message:\s+\d+\n)", normalized)
    filtered = [c for c in chunks if re.search(r"^Message:\s+\d+", c, re.MULTILINE)]
    return filtered if filtered else [normalized]


def extract_header(block: str, name: str) -> str:
    pattern = re.compile(rf"^{re.escape(name)}:\s*([\s\S]*?)(?=\n[A-Z][A-Za-z-]+:|\n\n|$)", re.MULTILINE)
    m = pattern.search(block)
    if not m:
        return ""
    return re.sub(r"\n\s+", " ", m.group(1)).strip()


def clean_subject(subject: str) -> str:
    return re.sub(r"^\[ib-liste\]\s*", "", subject, flags=re.IGNORECASE).strip()


def infer_deadline(text: str) -> str:
    for pattern in DEADLINE_PATTERNS:
        m = pattern.search(text)
        if m and m.group(1):
            return m.group(1).strip()
    return "Not found"


def infer_type(text: str) -> str:
    lower = text.lower()
    if "assistant professor" in lower:
        return "Assistant Professor"
    if "postdoc" in lower:
        return "Postdoc"
    if "phd" in lower:
        return "PhD"
    if "praktikum" in lower or "internship" in lower:
        return "Internship"
    if "hilfskraft" in lower:
        return "Student Assistant"
    if "stelle" in lower or "position" in lower or "job" in lower:
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
    lower = text.lower()
    return any(k in lower for k in JOB_KEYWORDS)


def parse_digest_text(raw_text: str):
    items = []
    for idx, block in enumerate(split_messages(raw_text), start=1):
        subject = extract_header(block, "Subject") or f"Message {idx}"
        sender = extract_header(block, "From") or "Unknown"
        date = extract_header(block, "Date") or "Unknown"
        body = "\n\n".join(block.split("\n\n")[1:]) if "\n\n" in block else block
        text = f"{subject}\n{body}"
        links = list(dict.fromkeys(re.findall(r"https?://[^\s)>]+", body)))

        item = {
            "subject": clean_subject(subject),
            "from": sender,
            "date": date,
            "organization": infer_org(subject, body),
            "positionType": infer_type(text),
            "deadline": infer_deadline(text),
            "links": links,
            "snippet": body.strip()[:900],
            "isJob": is_job(text),
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
    user = os.environ["IMAP_USER"]
    password = os.environ["IMAP_PASS"]
    folder = os.environ.get("IMAP_FOLDER", "INBOX")
    sender_filter = os.environ.get("SENDER_FILTER", "")
    subject_filter = os.environ.get("SUBJECT_FILTER", "ib-liste")

    conn = imaplib.IMAP4_SSL(host, port)
    conn.login(user, password)
    conn.select(folder)

    criteria = ["UNSEEN"]
    if sender_filter:
        criteria.extend(["FROM", f'"{sender_filter}"'])
    if subject_filter:
        criteria.extend(["SUBJECT", f'"{subject_filter}"'])

    status, data = conn.search(None, *criteria)
    if status != "OK":
        conn.logout()
        return []

    ids = data[0].split()
    results = []

    for msg_id in ids:
        status, fetched = conn.fetch(msg_id, "(RFC822)")
        if status != "OK" or not fetched:
            continue

        raw_bytes = fetched[0][1]
        msg = email.message_from_bytes(raw_bytes, policy=default)
        subject = decode_mime(msg.get("Subject", ""))
        sender = decode_mime(msg.get("From", ""))
        date = decode_mime(msg.get("Date", ""))
        body = extract_text_body(msg)

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

    merged = sorted(existing_items + new_items, key=lambda x: x.get("date", ""), reverse=True)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "imap",
        "items": merged[:500],
        "stats": {
            "new_items": len(new_items),
            "total_items": len(merged[:500]),
            "processed_messages": len(mails),
        },
    }

    save_payload(payload)
    print(f"processed_messages={len(mails)}")
    print(f"new_items={len(new_items)}")
    print(f"total_items={payload['stats']['total_items']}")


if __name__ == "__main__":
    main()
