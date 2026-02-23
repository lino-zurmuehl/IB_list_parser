# IB List Parser (Auto Email -> GitHub Pages)

This app now updates automatically:

1. GitHub Action checks your mailbox via IMAP at 08:00 and 20:00 Berlin time.
2. It parses new digest emails and extracts job-related posts.
3. It updates `data/jobs.json` in the repo.
4. GitHub Pages shows the updated jobs feed automatically.
5. In the UI, you can filter by:
   - Job-related items
   - Data Science + Public Policy profile fit

## Files

- Frontend: `index.html`, `styles.css`, `app.js`
- Feed data: `data/jobs.json`
- Automation script: `scripts/fetch_and_parse_digest.py`
- Workflow: `.github/workflows/update_jobs.yml`

## Setup (required)

In your GitHub repo, add these **Actions secrets** under:
`Settings -> Secrets and variables -> Actions -> New repository secret`

- `IMAP_HOST` (example: `imap.gmail.com`)
- `IMAP_PORT` (example: `993`)
- `IMAP_USER` (your email address)
- `IMAP_PASS` (email app password)
- `IMAP_FOLDER` (example: `INBOX`)
- `SENDER_FILTER` (optional, recommended)
- `SUBJECT_FILTER` (optional, default `ib-liste`)

## Gmail note

If using Gmail, use an **App Password** (not your normal password), which requires 2FA enabled.

## Deploy on GitHub Pages

1. Push this repository to GitHub.
2. Enable Pages:
   - `Settings -> Pages`
   - Source: `Deploy from a branch`
   - Branch: `main`, folder `/ (root)`
3. Open:
   - `https://<your-username>.github.io/<repo-name>/`

## Trigger manually

- Go to `Actions -> Update Job Feed -> Run workflow`.

## Security

- Do not commit mailbox credentials to code.
- Keep credentials only in GitHub Actions secrets.

## Limitations

- Updates are not real-time; polling runs at 08:00 and 20:00 Berlin time.
- IMAP provider settings differ across mail services.
- Parsing is heuristic and may need keyword tuning over time.
