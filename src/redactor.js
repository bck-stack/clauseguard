const COMPANY_REGEX =
  /\b(?!(?:This|That|Between|With|From|For|By|And|Or|Upon)\b)([A-Z][A-Za-z0-9&'.,-]*(?:\s+[A-Z][A-Za-z0-9&'.,-]*){0,5}\s+(?:Inc\.?|LLC|L\.L\.C\.|Ltd\.?|Limited|Corp\.?|Corporation|LP|LLP|GmbH|PLC|Pte\.?\s*Ltd\.?|Co\.?))(?=$|[\s.,;:)!?"'])/g;

const ADDRESS_REGEX =
  /\b\d{1,6}\s+[A-Z][A-Za-z0-9.'-]+(?:\s+[A-Z][A-Za-z0-9.'-]+){0,4}\s+(?:Street|St\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Way|Parkway|Pkwy\.?|Plaza|Court|Ct\.?|Terrace|Ter\.?|Place|Pl\.?|Circle|Cir\.?|Trail|Trl\.?|Square|Sq\.?|Highway|Hwy\.?)(?:,\s*(?:Suite|Ste\.?|Unit|Floor|Fl\.?)\s*[A-Za-z0-9-]+)?(?:,\s*[A-Za-z\s.-]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?)?\b/g;

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

const ID_REGEX =
  /\b(?:[A-Z]{2}\d{2}[A-Z0-9]{10,30}|(?:EIN|TIN|Tax\s*ID|SSN|Account\s*(?:No\.?|Number|#)|Routing\s*(?:No\.?|Number|#))[:#\s-]*[A-Z0-9-]{5,24}|\d{2}-\d{7}|\d{3}-\d{2}-\d{4})\b/gi;

const PHONE_REGEX =
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\b\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/g;

const AMOUNT_REGEX =
  /(?:(?:USD|EUR|GBP|CAD|AUD|CHF)\s*)?[$€£]\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?(?:\s*(?:million|billion|M|K|USD|EUR|GBP))?\b|\b\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s*(?:USD|EUR|GBP|dollars|euros)\b/g;

const SIGNATORY_REGEX =
  /(?<=\b(?:Attention|Attn|By|Name|Contact)\s*:\s*)([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z'-]+)\b/g;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectMatches(text, regex, type, priority, spans) {
  const re = new RegExp(regex.source, regex.flags);
  let match;
  while ((match = re.exec(text)) !== null) {
    const raw = match[1] && regex === SIGNATORY_REGEX ? match[1] : match[0];
    const start =
      match[1] && regex === SIGNATORY_REGEX
        ? match.index + match[0].indexOf(match[1])
        : match.index;
    const end = start + raw.length;
    if (!raw.trim()) continue;
    spans.push({ start, end, raw, type, priority });
  }
}

/**
 * Deterministically redacts commercial PII and counterparty identifiers from a contract.
 * Longer and more specific spans take precedence, and identical strings reuse the same token.
 */
export function redactContractText(text) {
  const source = typeof text === "string" ? text : "";
  const rawBytes = new TextEncoder().encode(source).length;

  if (!source) {
    return {
      redactedText: "",
      entities: [],
      entityMap: {},
      stats: {
        totalMasked: 0,
        uniqueEntities: 0,
        byType: {},
        rawBytes: 0,
        redactedBytes: 0,
      },
    };
  }

  const candidateSpans = [];
  collectMatches(source, EMAIL_REGEX, "EMAIL", 10, candidateSpans);
  collectMatches(source, ADDRESS_REGEX, "ADDRESS", 9, candidateSpans);
  collectMatches(source, ID_REGEX, "ID", 8, candidateSpans);
  collectMatches(source, COMPANY_REGEX, "PARTY", 7, candidateSpans);
  collectMatches(source, PHONE_REGEX, "PHONE", 6, candidateSpans);
  collectMatches(source, AMOUNT_REGEX, "AMOUNT", 5, candidateSpans);
  collectMatches(source, SIGNATORY_REGEX, "PERSON", 4, candidateSpans);

  // Also capture repeated bare versions of detected company names (e.g. without trailing punctuation)
  const partyValues = [
    ...new Set(
      candidateSpans
        .filter((s) => s.type === "PARTY")
        .map((s) => s.raw.trim()),
    ),
  ];
  for (const company of partyValues) {
    const stripped = company.replace(/[.,]+$/, "");
    if (stripped.length >= 4 && stripped !== company) {
      const re = new RegExp(`\\b${escapeRegExp(stripped)}\\b`, "g");
      collectMatches(source, re, "PARTY", 6, candidateSpans);
    }
  }

  // Resolve overlaps: higher priority first, then longer span, then earlier index.
  candidateSpans.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.raw.length !== a.raw.length) return b.raw.length - a.raw.length;
    return a.start - b.start;
  });

  const accepted = [];
  for (const span of candidateSpans) {
    const overlaps = accepted.some(
      (existing) => span.start < existing.end && span.end > existing.start,
    );
    if (!overlaps) {
      accepted.push(span);
    }
  }

  // Assign deterministic placeholders in reading order.
  accepted.sort((a, b) => a.start - b.start);

  const counters = {};
  const valueToPlaceholder = new Map();
  const entities = [];
  const entityMap = {};
  const byType = {};

  let cursor = 0;
  let output = "";

  for (const span of accepted) {
    const normalizedKey = `${span.type}::${span.raw.trim()}`;
    let placeholder = valueToPlaceholder.get(normalizedKey);
    if (!placeholder) {
      counters[span.type] = (counters[span.type] || 0) + 1;
      placeholder = `[${span.type}_${counters[span.type]}]`;
      valueToPlaceholder.set(normalizedKey, placeholder);
      entities.push({
        placeholder,
        original: span.raw,
        type: span.type,
      });
      entityMap[placeholder] = span.raw;
    }

    byType[span.type] = (byType[span.type] || 0) + 1;
    output += source.slice(cursor, span.start) + placeholder;
    cursor = span.end;
  }

  output += source.slice(cursor);
  const redactedBytes = new TextEncoder().encode(output).length;

  return {
    redactedText: output,
    entities,
    entityMap,
    stats: {
      totalMasked: accepted.length,
      uniqueEntities: entities.length,
      byType,
      rawBytes,
      redactedBytes,
    },
  };
}

/**
 * Restores masked placeholders (e.g. [PARTY_1], [AMOUNT_1]) back to original values locally.
 */
export function rehydrateRedactedText(text, entitiesOrMap) {
  if (typeof text !== "string" || !text) return text || "";

  let pairs = [];
  if (Array.isArray(entitiesOrMap)) {
    pairs = entitiesOrMap.map((item) => [item.placeholder, item.original]);
  } else if (entitiesOrMap && typeof entitiesOrMap === "object") {
    pairs = Object.entries(entitiesOrMap);
  }

  if (pairs.length === 0) return text;

  let restored = text;
  // Replace longer placeholder keys first (e.g., [PARTY_10] before [PARTY_1]).
  pairs.sort((a, b) => b[0].length - a[0].length);
  for (const [placeholder, original] of pairs) {
    if (!placeholder) continue;
    restored = restored.split(placeholder).join(original);
  }
  return restored;
}

/**
 * Recursively rehydrates all string fields of a parsed contract audit object locally.
 */
export function rehydrateAuditResult(auditResult, entitiesOrMap) {
  if (!auditResult || typeof auditResult !== "object") return auditResult;

  return {
    ...auditResult,
    executiveSummary: rehydrateRedactedText(
      auditResult.executiveSummary || "",
      entitiesOrMap,
    ),
    clauses: Array.isArray(auditResult.clauses)
      ? auditResult.clauses.map((clause) => ({
          ...clause,
          title: rehydrateRedactedText(clause.title || "", entitiesOrMap),
          excerpt: rehydrateRedactedText(clause.excerpt || "", entitiesOrMap),
          finding: rehydrateRedactedText(clause.finding || "", entitiesOrMap),
          recommendedRedline: rehydrateRedactedText(
            clause.recommendedRedline || "",
            entitiesOrMap,
          ),
        }))
      : [],
    missingProtections: Array.isArray(auditResult.missingProtections)
      ? auditResult.missingProtections.map((item) =>
          rehydrateRedactedText(item, entitiesOrMap),
        )
      : [],
  };
}
