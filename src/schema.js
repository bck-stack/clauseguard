import { Schema } from "firebase/ai";

export const RISK_LEVELS = ["LOW", "MODERATE", "HIGH", "CRITICAL"];

export const CLAUSE_CATEGORIES = [
  "LIABILITY",
  "INDEMNITY",
  "IP",
  "TERMINATION",
  "AUTO_RENEWAL",
  "CONFIDENTIALITY",
  "PRIVACY",
  "PAYMENT",
  "JURISDICTION",
  "OTHER",
];

/**
 * Shared structured-output schema for both Gemini Developer API cloud inference
 * (`responseSchema`) and Chrome Gemini Nano on-device execution (`responseConstraint`).
 */
export const contractAuditSchema = Schema.object({
  properties: {
    overallRiskScore: Schema.number(),
    riskLevel: Schema.enumString({ enum: RISK_LEVELS }),
    executiveSummary: Schema.string(),
    clauses: Schema.array({
      items: Schema.object({
        properties: {
          title: Schema.string(),
          category: Schema.enumString({ enum: CLAUSE_CATEGORIES }),
          severity: Schema.enumString({ enum: RISK_LEVELS }),
          excerpt: Schema.string(),
          finding: Schema.string(),
          recommendedRedline: Schema.string(),
        },
      }),
    }),
    missingProtections: Schema.array({
      items: Schema.string(),
    }),
  },
});

/**
 * Plain JSON Schema representation compatible with Chrome Prompt API `responseConstraint`.
 */
export const contractAuditJsonSchema = contractAuditSchema.toJSON();

/**
 * Builds a deterministic single-turn legal contract audit prompt.
 * Designed to fit within Gemini Nano's compact on-device context window while
 * preserving `[TYPE_N]` PII placeholders for downstream local rehydration.
 *
 * @param {string} contractText
 * @param {string} [rubricNote]
 * @param {boolean} [hasImage]
 * @returns {string}
 */
// Small on-device models sometimes return list items as enum-like tokens with stray brackets ("[AUTO_RENEWAL").
// Balanced placeholders such as [PARTY_1] are left alone; they are restored to real names later.
export function cleanProtection(item) {
  let t = String(item ?? "").trim();
  if (/^\[[^\]]*$/.test(t)) t = t.slice(1);
  if (/^[^[]*\]$/.test(t)) t = t.slice(0, -1);
  t = t.replace(/^["'`]+|["'`]+$/g, "").trim();
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(t) || (/^[A-Z]{4,}$/.test(t))) {
    t = t.toLowerCase().replace(/_/g, " ");
    t = t.charAt(0).toUpperCase() + t.slice(1);
  }
  return t;
}

export function buildAuditPrompt(contractText, rubricNote = "", hasImage = false) {
  const parts = [
    "You are ClauseGuard, an adversarial commercial contract reviewer.",
    "Analyze the provided agreement and identify unfair, one-sided, hidden, or legally risky provisions.",
    "Return ONLY valid JSON matching the requested schema.",
    "",
    "Scoring guide:",
    "- 0-24 LOW: balanced commercial terms with standard mutual protections.",
    "- 25-49 MODERATE: negotiable asymmetries or missing standard caps.",
    "- 50-74 HIGH: uncapped liability, unilateral termination, or broad IP capture.",
    "- 75-100 CRITICAL: existential risk, unlimited indemnification, or deceptive lock-in.",
    "",
    "Rules:",
    "- Preserve any bracketed redaction tokens such as [EMAIL_1], [PARTY_1], [AMOUNT_1], [ID_1], [ADDRESS_1], [PHONE_1], or [PERSON_1] verbatim.",
    "- Quote concise verbatim phrases in `excerpt` and give actionable replacement language in `recommendedRedline`.",
  ];

  if (rubricNote && rubricNote.trim()) {
    parts.push("", `Priority rubric (${rubricNote.trim()})`);
  }

  if (hasImage) {
    parts.push(
      "",
      "An attached image shows a photographed or scanned contract clause. Read all visible text inside the image carefully and include it alongside any pasted text below."
    );
  }

  if (contractText && contractText.trim()) {
    parts.push("", "CONTRACT TEXT:", contractText.trim());
  }

  return parts.join("\n");
}

/**
 * Parses model text output into a normalized audit payload.
 * Handles markdown code fences gracefully if returned by any fallback model.
 *
 * @param {string | object} rawOutput
 */
export function normalizeAuditPayload(rawOutput) {
  let parsed = rawOutput;
  if (typeof rawOutput === "string") {
    const cleaned = rawOutput
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");
    parsed = JSON.parse(cleaned);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model response did not produce a structured JSON object.");
  }

  const rawScore = Number(parsed.overallRiskScore);
  const overallRiskScore = Number.isFinite(rawScore)
    ? Math.max(0, Math.min(100, Math.round(rawScore)))
    : 0;

  const riskLevel = RISK_LEVELS.includes(parsed.riskLevel)
    ? parsed.riskLevel
    : deriveRiskLevel(overallRiskScore);

  const clauses = Array.isArray(parsed.clauses)
    ? parsed.clauses.map((c) => ({
        title: String(c?.title ?? "Untitled Clause"),
        category: CLAUSE_CATEGORIES.includes(c?.category) ? c.category : "OTHER",
        severity: RISK_LEVELS.includes(c?.severity) ? c.severity : "MODERATE",
        excerpt: String(c?.excerpt ?? ""),
        finding: String(c?.finding ?? ""),
        recommendedRedline: String(c?.recommendedRedline ?? ""),
      }))
    : [];

  const missingProtections = Array.isArray(parsed.missingProtections)
    ? parsed.missingProtections.map(cleanProtection).filter(Boolean)
    : [];

  return {
    overallRiskScore,
    riskLevel,
    executiveSummary: String(parsed.executiveSummary ?? "No summary returned."),
    clauses,
    missingProtections,
  };
}

function deriveRiskLevel(score) {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MODERATE";
  return "LOW";
}
