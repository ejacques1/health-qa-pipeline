const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");
const { google } = require("googleapis");

// ============================================================================
// ENV VARS (set these in Vercel dashboard → Settings → Environment Variables)
// ============================================================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// Locked model version for reproducibility
const OPENAI_MODEL = "openai/gpt-5.2";

// ============================================================================
// READABILITY: Flesch-Kincaid (pure math, no AI)
// ============================================================================
function countSyllables(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!word || word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
  word = word.replace(/^y/, "");
  const matches = word.match(/[aeiouy]{1,2}/g);
  return matches ? matches.length : 1;
}

function analyzeReadability(text) {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/).filter((w) => w.replace(/[^a-z]/gi, "").length > 0);
  const sentenceCount = sentences.length || 1;
  const wordCount = words.length || 1;
  const syllableCount = words.reduce((sum, w) => sum + countSyllables(w), 0);

  const fleschKincaidGrade =
    0.39 * (wordCount / sentenceCount) +
    11.8 * (syllableCount / wordCount) -
    15.59;

  const fleschReadingEase =
    206.835 -
    1.015 * (wordCount / sentenceCount) -
    84.6 * (syllableCount / wordCount);

  return {
    flesch_kincaid_grade: Math.round(fleschKincaidGrade * 10) / 10,
    flesch_reading_ease: Math.round(fleschReadingEase * 10) / 10,
  };
}

// ============================================================================
// EXTRACT URLs from ChatGPT response
// ============================================================================
function extractUrls(text) {
  const urlRegex = /https?:\/\/[^\s\)>\]"']+/g;
  const matches = text.match(urlRegex) || [];
  // Clean trailing punctuation and deduplicate
  const cleaned = matches.map((url) => url.replace(/[.,;:!?)]+$/, ""));
  return [...new Set(cleaned)];
}

// ============================================================================
// GOOGLE SHEETS: Write a row
// ============================================================================
async function appendToSheet(rowData) {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Sheet1!A:J",
      valueInputOption: "RAW",
      requestBody: {
        values: [rowData],
      },
    });
  } catch (err) {
    console.error("Google Sheets error:", err.message);
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================
module.exports = async function handler(req, res) {
  try {
    // 1. Get next pending question from Supabase
    const { data: questions, error: fetchError } = await supabase
      .from("health_questions")
      .select("*")
      .eq("status", "pending")
      .limit(1);

    if (fetchError) {
      return res.status(500).json({ error: "Supabase fetch failed", details: fetchError });
    }

    if (!questions || questions.length === 0) {
      return res.status(200).json({ message: "All questions processed" });
    }

    const question = questions[0];

    // 2. Send to ChatGPT
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0, // Reproducibility
      messages: [
        {
          role: "user",
          content: `${question.question} Please include evidence-based sources with URLs in your response.`,
        },
      ],
    });

    const responseText = completion.choices[0].message.content;

    // 3. Score readability (strip URLs so they don't inflate grade level)
    const cleanedText = responseText.replace(/https?:\/\/[^\s\)>\]"']+/g, "");
    const readability = analyzeReadability(cleanedText);

    // 4. Extract source URLs
    const urls = extractUrls(responseText);
    const timestamp = new Date().toISOString();

    // 5. Write to Supabase + Google Sheets (one row per source URL)
    if (urls.length === 0) {
      // No URLs found — write one row with empty source_url
      await supabase
        .from("health_questions")
        .update({
          chatgpt_response: responseText,
          flesch_kincaid_grade: String(readability.flesch_kincaid_grade),
          flesch_reading_ease: String(readability.flesch_reading_ease),
          source_url: "",
          status: "complete",
          processed_at: timestamp,
        })
        .eq("id", question.id);

      await appendToSheet([
        question.id,
        question.category,
        question.question,
        responseText,
        readability.flesch_kincaid_grade,
        readability.flesch_reading_ease,
        "",
        "",
        "complete",
        timestamp,
      ]);
    } else {
      // Multiple URLs — update original row with first URL, insert new rows for the rest
      // Update the original row
      await supabase
        .from("health_questions")
        .update({
          chatgpt_response: responseText,
          flesch_kincaid_grade: String(readability.flesch_kincaid_grade),
          flesch_reading_ease: String(readability.flesch_reading_ease),
          source_url: urls[0],
          status: "complete",
          processed_at: timestamp,
        })
        .eq("id", question.id);

      await appendToSheet([
        question.id,
        question.category,
        question.question,
        responseText,
        readability.flesch_kincaid_grade,
        readability.flesch_reading_ease,
        urls[0],
        "",
        "complete",
        timestamp,
      ]);

      // Insert additional rows for remaining URLs
      for (let i = 1; i < urls.length; i++) {
        const newId = `${question.id}_src${i + 1}`;

        await supabase.from("health_questions").insert({
          id: newId,
          category: question.category,
          question: question.question,
          chatgpt_response: responseText,
          flesch_kincaid_grade: String(readability.flesch_kincaid_grade),
          flesch_reading_ease: String(readability.flesch_reading_ease),
          source_url: urls[i],
          org_type: "",
          status: "complete",
          processed_at: timestamp,
        });

        await appendToSheet([
          newId,
          question.category,
          question.question,
          responseText,
          readability.flesch_kincaid_grade,
          readability.flesch_reading_ease,
          urls[i],
          "",
          "complete",
          timestamp,
        ]);
      }
    }

    // 6. Return result
    return res.status(200).json({
      processed: question.id,
      category: question.category,
      readability,
      sources_found: urls.length,
      urls,
    });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: err.message });
  }
};
