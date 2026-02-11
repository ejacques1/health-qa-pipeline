const { createClient } = require("@supabase/supabase-js");
const cheerio = require("cheerio");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ============================================================================
// ORG TYPE DEFINITIONS (9 categories)
// ============================================================================
const KNOWN_DOMAINS = {
  // Government
  "cdc.gov": "Government",
  "nih.gov": "Government",
  "cancer.gov": "Government",
  "fda.gov": "Government",
  "who.int": "Government",
  "hhs.gov": "Government",
  "cms.gov": "Government",
  "clinicaltrials.gov": "Government",
  "medlineplus.gov": "Encyclopedia", // gov-run but functions as encyclopedia
  "ecfr.gov": "Government",

  // Academic/Research
  "harvard.edu": "Academic/Research",
  "stanford.edu": "Academic/Research",
  "mayo.edu": "Academic/Research",
  "ox.ac.uk": "Academic/Research",
  "cambridge.org": "Academic/Research",

  // Peer-Reviewed Journals
  "pubmed.ncbi.nlm.nih.gov": "Peer-Reviewed Journal",
  "thelancet.com": "Peer-Reviewed Journal",
  "jamanetwork.com": "Peer-Reviewed Journal",
  "nejm.org": "Peer-Reviewed Journal",
  "bmj.com": "Peer-Reviewed Journal",
  "nature.com": "Peer-Reviewed Journal",
  "sciencedirect.com": "Peer-Reviewed Journal",
  "springer.com": "Peer-Reviewed Journal",
  "wiley.com": "Peer-Reviewed Journal",
  "plos.org": "Peer-Reviewed Journal",
  "frontiersin.org": "Peer-Reviewed Journal",
  "mdpi.com": "Peer-Reviewed Journal",
  "ncbi.nlm.nih.gov": "Peer-Reviewed Journal",

  // Professional Associations
  "ama-assn.org": "Professional Association",
  "heart.org": "Professional Association",
  "diabetes.org": "Professional Association",
  "aap.org": "Professional Association",
  "asco.org": "Professional Association",
  "nccn.org": "Professional Association",
  "cancer.net": "Professional Association", // ASCO patient site
  "lls.org": "Professional Association",

  // Commercial/Industry
  "webmd.com": "Commercial/Industry",
  "healthline.com": "Commercial/Industry",
  "verywellhealth.com": "Commercial/Industry",
  "drugs.com": "Commercial/Industry",
  "pfizer.com": "Commercial/Industry",
  "merck.com": "Commercial/Industry",
  "medicalnewstoday.com": "Commercial/Industry",
  "everydayhealth.com": "Commercial/Industry",

  // News/Media
  "nytimes.com": "News/Media",
  "cnn.com": "News/Media",
  "reuters.com": "News/Media",
  "bbc.com": "News/Media",
  "washingtonpost.com": "News/Media",
  "theguardian.com": "News/Media",
  "apnews.com": "News/Media",

  // Hospital/Health Systems
  "mayoclinic.org": "Hospital/Health System",
  "clevelandclinic.org": "Hospital/Health System",
  "hopkinsmedicine.org": "Hospital/Health System",
  "mountsinai.org": "Hospital/Health System",
  "uchealth.org": "Hospital/Health System",
  "memorialsloankettering.org": "Hospital/Health System",
  "mskcc.org": "Hospital/Health System",

  // Encyclopedia
  "wikipedia.org": "Encyclopedia",
  "britannica.com": "Encyclopedia",
  "en.wikipedia.org": "Encyclopedia",
};

// ============================================================================
// CLASSIFY BY TLD
// ============================================================================
function classifyByTld(hostname) {
  if (hostname.endsWith(".gov") || hostname.endsWith(".mil")) return "Government";
  if (hostname.endsWith(".edu") || hostname.endsWith(".ac.uk")) return "Academic/Research";
  return null;
}

// ============================================================================
// CLASSIFY BY HTML (meta tags, schema.org, signals)
// ============================================================================
function classifyByHtml($) {
  // Check schema.org JSON-LD
  const jsonLd = $('script[type="application/ld+json"]').text();
  if (jsonLd) {
    try {
      const schema = JSON.parse(jsonLd);
      const type = schema["@type"] || (schema["@graph"] && schema["@graph"][0]?.["@type"]) || "";
      if (/GovernmentOrganization/i.test(type)) return "Government";
      if (/EducationalOrganization|ResearchOrganization/i.test(type)) return "Academic/Research";
      if (/ScholarlyArticle|MedicalScholarlyArticle/i.test(type)) return "Peer-Reviewed Journal";
      if (/Hospital|MedicalClinic/i.test(type)) return "Hospital/Health System";
      if (/NewsArticle|NewsMediaOrganization/i.test(type)) return "News/Media";
    } catch (e) {
      // JSON parse failed, continue
    }
  }

  // Check for journal meta tags
  const citationJournal = $('meta[name="citation_journal_title"]').attr("content");
  const citationDoi = $('meta[name="citation_doi"]').attr("content");
  if (citationJournal || citationDoi) return "Peer-Reviewed Journal";

  // Check og:type for news
  const ogType = $('meta[property="og:type"]').attr("content") || "";
  if (ogType === "article") {
    const section = $('meta[property="article:section"]').attr("content") || "";
    if (section) return "News/Media";
  }

  // Check for hospital signals
  const bodyText = $("body").text().toLowerCase();
  if (
    bodyText.includes("find a doctor") ||
    bodyText.includes("patient portal") ||
    bodyText.includes("make an appointment")
  ) {
    return "Hospital/Health System";
  }

  // Check for encyclopedia signals
  const url = $('link[rel="canonical"]').attr("href") || "";
  if (url.includes("/wiki/") || url.includes("/encyclopedia/")) return "Encyclopedia";

  return null;
}

// ============================================================================
// MAIN CLASSIFY FUNCTION
// ============================================================================
async function classifySource(url) {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");

    // 1. Check known domains (most reliable)
    for (const [domain, orgType] of Object.entries(KNOWN_DOMAINS)) {
      if (hostname === domain || hostname.endsWith("." + domain)) {
        return { org_type: orgType, method: "known_domain", reachable: true };
      }
    }

    // 2. Check TLD
    const tldResult = classifyByTld(hostname);
    if (tldResult) {
      return { org_type: tldResult, method: "tld", reachable: true };
    }

    // 3. Fetch HTML and analyze
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HealthQAPipeline/1.0)",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { org_type: "Other/Unclassified", method: "unreachable", reachable: false };
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const htmlResult = classifyByHtml($);

    if (htmlResult) {
      return { org_type: htmlResult, method: "html_analysis", reachable: true };
    }

    return { org_type: "Other/Unclassified", method: "no_match", reachable: true };
  } catch (err) {
    return { org_type: "Other/Unclassified", method: "error", reachable: false };
  }
}

// ============================================================================
// HANDLER
// ============================================================================
module.exports = async function handler(req, res) {
  try {
    // Get rows that are complete but have no org_type yet
    const { data: rows, error } = await supabase
      .from("health_questions")
      .select("*")
      .eq("status", "complete")
      .or("org_type.is.null,org_type.eq.")
      .not("source_url", "eq", "")
      .limit(5); // Process 5 at a time to stay within timeout

    if (error) {
      return res.status(500).json({ error: "Supabase fetch failed", details: error });
    }

    if (!rows || rows.length === 0) {
      return res.status(200).json({ message: "All sources classified" });
    }

    const results = [];

    for (const row of rows) {
      const classification = await classifySource(row.source_url);

      await supabase
        .from("health_questions")
        .update({ org_type: classification.org_type })
        .eq("id", row.id);

      results.push({
        id: row.id,
        url: row.source_url,
        org_type: classification.org_type,
        method: classification.method,
        reachable: classification.reachable,
      });
    }

    return res.status(200).json({
      classified: results.length,
      results,
    });
  } catch (err) {
    console.error("Classify error:", err);
    return res.status(500).json({ error: err.message });
  }
};
