# Health QA Pipeline

Automated research pipeline for a study examining the readability and source credibility of ChatGPT-generated health information about lymphoma and clinical trials.

## Study Overview

100 health questions were developed across three clinical categories:
- **Hodgkin Lymphoma** (30 questions, H1–H30)
- **Non-Hodgkin Lymphoma** (30 questions, N1–N30)
- **Clinical Trials** (40 questions, T1–T40)

Each question was submitted to ChatGPT (GPT-5.2) with the instruction: *"Please include evidence-based sources with URLs in your response."*

## How It Works

### Phase 1 — Data Collection & Readability Scoring
1. Retrieves a pending health question from the database (Supabase, PostgreSQL)
2. Submits it to ChatGPT (GPT-5.2, temperature set to zero for reproducibility)
3. Calculates Flesch-Kincaid Grade Level and Flesch Reading Ease on the response text (URLs removed before scoring to prevent artificially inflated grade levels)
4. Extracts all source URLs cited in the response
5. Saves the full response, readability scores, and source URLs to Supabase and Google Sheets (one row per source URL)

### Phase 2 — Source Organization Classification
A Google Apps Script classifies each cited URL into one of nine organization types through three stages:
1. **Known domain lookup** — checks the URL against ~80 known health websites
2. **Web address analysis** — checks the URL ending (.gov = Government, .edu = Academic)
3. **Webpage analysis** — visits the page and examines behind-the-scenes code for clues about the organization type

All automated classifications were manually reviewed.

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

## Endpoint

- `GET /api/analyze` — Processes one pending question per call

All 100 questions have been processed. The endpoint is live at `https://health-qa-pipeline.vercel.app/api/analyze`

## Tech Stack
- **Node.js** — Application code (written with Claude, Anthropic)
- **Vercel** — Hosts and runs the pipeline
- **Supabase (PostgreSQL)** — Database for questions and results
- **OpenRouter API** — Routes requests to OpenAI's GPT-5.2
- **Google Sheets API** — Stores results for review
- **Google Apps Script** — Automates source organization classification

## Setup

### Environment Variables (Vercel Dashboard)
```
OPENROUTER_API_KEY=sk-...
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
4. All 100 questions have been processed. The endpoint at https://health-qa-pipeline.vercel.app/api/analyze was used during data collection and is no longer actively processing.
