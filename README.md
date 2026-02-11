# Health QA Pipeline

Automated pipeline for academic research on ChatGPT's health information quality.

## What it does

1. Pulls pending health questions from Supabase
2. Sends each to ChatGPT (gpt-4o-2024-08-06, temperature 0)
3. Appends "Please include evidence-based sources with URLs in your response." to each question
4. Scores response readability (Flesch-Kincaid Grade Level + Flesch Reading Ease)
5. Extracts source URLs from the response
6. Writes results to Supabase + Google Sheets (one row per source URL)
7. Separately classifies each source's organization type by fetching HTML

## Endpoints

- `GET /api/analyze` — Processes one pending question per call
- `GET /api/classify-sources` — Classifies 5 unclassified source URLs per call

## Organization Type Categories (9)

1. Government
2. Academic/Research
3. Peer-Reviewed Journal
4. Professional Association
5. Commercial/Industry
6. News/Media
7. Hospital/Health System
8. Encyclopedia
9. Other/Unclassified

## Setup

### Environment Variables (Vercel Dashboard)

```
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
GOOGLE_SHEET_ID=your-spreadsheet-id
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

### Google Sheets Setup

1. Create a Google Cloud service account
2. Enable the Google Sheets API
3. Share your Google Sheet with the service account email
4. Copy the full service account JSON into the env var

### Deploy

1. Push to GitHub
2. Connect repo to Vercel
3. Add environment variables
4. Endpoints are live at `https://your-project.vercel.app/api/analyze`
