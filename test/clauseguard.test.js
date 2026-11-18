import { describe, it, expect, vi } from "vitest";
import { InferenceMode, InferenceSource } from "firebase/ai";

import {
  redactContractText,
  rehydrateRedactedText,
  rehydrateAuditResult,
} from "../src/redactor.js";
import {
  RISK_LEVELS,
  CLAUSE_CATEGORIES,
  contractAuditSchema,
  contractAuditJsonSchema,
  normalizeAuditPayload,
} from "../src/schema.js";
import { runContractAudit } from "../src/firebase-hybrid.js";
import { SAMPLE_CONTRACTS } from "../src/samples.js";

describe("PII Redaction and Rehydration", () => {
  it("masks emails, phones, tax IDs, amounts, addresses, and corporate entities", () => {
    const sample = [
      'This Agreement is entered into by Northwind Systems Inc. ("Vendor")',
      "located at 742 Evergreen Terrace, Austin, TX 78701",
      "and Apex Holdings LLC, EIN 84-2291043.",
      "Notice email: legal@apex-holdings.com or call +1 (415) 555-0192.",
      "Minimum liability floor is $2,500,000. Contact legal@apex-holdings.com again for disputes.",
    ].join(" ");

    const result = redactContractText(sample);

    expect(result.redactedText).not.toContain("Northwind Systems Inc.");
    expect(result.redactedText).not.toContain("Apex Holdings LLC");
    expect(result.redactedText).not.toContain("legal@apex-holdings.com");
    expect(result.redactedText).not.toContain("84-2291043");
    expect(result.redactedText).not.toContain("$2,500,000");
    expect(result.redactedText).not.toContain("(415) 555-0192");
    expect(result.redactedText).not.toContain("742 Evergreen Terrace");

    expect(result.stats.totalMasked).toBeGreaterThanOrEqual(7);

    // Same repeated email maps to identical placeholder
    const emailMatches = result.redactedText.match(/\[EMAIL_\d+\]/g) || [];
    expect(emailMatches.length).toBe(2);
    expect(emailMatches[0]).toBe(emailMatches[1]);

    // Round-trip restores exact source text
    const restored = rehydrateRedactedText(result.redactedText, result.entityMap);
    expect(restored).toBe(sample);
  });

  it("rehydrates structured audit findings locally after cloud inference", () => {
    const entityMap = {
      "[PARTY_1]": "Apex Holdings LLC",
      "[AMOUNT_1]": "$2,500,000",
      "[EMAIL_1]": "legal@apex-holdings.com",
    };

    const rawAudit = {
      overallRiskScore: 82,
      riskLevel: "CRITICAL",
      executiveSummary: "[PARTY_1] imposes an unfair cap of [AMOUNT_1].",
      clauses: [
        {
          title: "Asymmetric Cap for [PARTY_1]",
          category: "LIABILITY",
          severity: "CRITICAL",
          excerpt: "Notice must go to [EMAIL_1] within 24 hours.",
          finding: "[PARTY_1] sets maximum exposure at [AMOUNT_1] only for itself.",
          recommendedRedline: "Cap mutual liability of [PARTY_1] symmetrically at [AMOUNT_1].",
        },
      ],
      missingProtections: ["Mutual termination cure window for [PARTY_1]"],
    };

    const hydrated = rehydrateAuditResult(rawAudit, entityMap);
    expect(hydrated.executiveSummary).toBe(
      "Apex Holdings LLC imposes an unfair cap of $2,500,000."
    );
    expect(hydrated.clauses[0].excerpt).toContain("legal@apex-holdings.com");
    expect(hydrated.clauses[0].recommendedRedline).toContain("Apex Holdings LLC");
    expect(hydrated.missingProtections[0]).toContain("Apex Holdings LLC");
  });

  it("masks entities in all built-in sample contracts", () => {
    for (const sample of SAMPLE_CONTRACTS) {
      const redacted = redactContractText(sample.text);
      expect(redacted.stats.totalMasked).toBeGreaterThan(0);
    }
  });
});

describe("Firebase AI Structured Schema and Normalization", () => {
  it("builds valid Schema and JSON Schema constraint with expected enums", () => {
    expect(contractAuditJsonSchema.type).toBe("object");
    expect(
      contractAuditJsonSchema.properties.riskLevel.enum
    ).toEqual(RISK_LEVELS);
    expect(
      contractAuditJsonSchema.properties.clauses.items.properties.category.enum
    ).toEqual(CLAUSE_CATEGORIES);
  });

  it("parses fenced JSON output and clamps out-of-range risk scores", () => {
    const raw = [
      "```json",
      JSON.stringify({
        overallRiskScore: 145,
        riskLevel: "CRITICAL",
        executiveSummary: "Severe indemnity exposure.",
        clauses: [
          {
            title: "Unlimited Indemnity",
            category: "INDEMNITY",
            severity: "CRITICAL",
            excerpt: "Client indemnifies Vendor without limit.",
            finding: "No liability cap applies.",
            recommendedRedline: "Cap total indemnity at 12 months fees.",
          },
        ],
        missingProtections: ["Data deletion SLA"],
      }),
      "```",
    ].join("\n");

    const parsed = normalizeAuditPayload(raw);
    expect(parsed.overallRiskScore).toBe(100);
    expect(parsed.riskLevel).toBe("CRITICAL");
    expect(parsed.clauses).toHaveLength(1);
    expect(parsed.missingProtections).toEqual(["Data deletion SLA"]);
  });
});

describe("Firebase AI Logic Hybrid Execution", () => {
  it("keeps raw PII off cloud payloads, forwards responseSchema/responseConstraint, and rehydrates output", async () => {
    const captured = {
      modelParams: null,
      parts: null,
    };

    const mockGenerativeModelFn = vi.fn((_aiInstance, params) => {
      captured.modelParams = params;
      return {
        generateContent: vi.fn(async (parts) => {
          captured.parts = parts;
          return {
            response: {
              inferenceSource: InferenceSource.IN_CLOUD,
              text: () =>
                JSON.stringify({
                  overallRiskScore: 76,
                  riskLevel: "CRITICAL",
                  executiveSummary:
                    "Detected unilateral indemnity benefiting [PARTY_1] capped at [AMOUNT_1].",
                  clauses: [
                    {
                      title: "Vendor Indemnity Shield",
                      category: "INDEMNITY",
                      severity: "CRITICAL",
                      excerpt: "Notify [EMAIL_1] before claiming.",
                      finding: "Only [PARTY_1] is protected.",
                      recommendedRedline:
                        "Replace with mutual indemnity up to [AMOUNT_1].",
                    },
                  ],
                  missingProtections: ["Reciprocal limitation of liability"],
                }),
            },
          };
        }),
      };
    });

    const contract =
      "Vendor Meridian Cloud Corp. charges $500,000 penalty via billing@meridian.io.";

    const output = await runContractAudit({
      text: contract,
      mode: "PREFER_ON_DEVICE",
      redactBeforeCloud: true,
      cloudModel: "gemini-3.5-flash-lite",
      ai: { fake: true },
      getGenerativeModelFn: mockGenerativeModelFn,
    });

    // Verify Firebase Hybrid API structure passed to getGenerativeModel
    expect(captured.modelParams.mode).toBe(InferenceMode.PREFER_ON_DEVICE);
    expect(captured.modelParams.inCloudParams.model).toBe("gemini-3.5-flash-lite");
    expect(captured.modelParams.inCloudParams.generationConfig.responseSchema).toBe(
      contractAuditSchema
    );
    expect(captured.modelParams.onDeviceParams.promptOptions.responseConstraint).toEqual(
      contractAuditJsonSchema
    );
    expect(captured.modelParams.onDeviceParams.createOptions.expectedInputs).toEqual([
      { type: "text", languages: ["en"] },
    ]);

    // Verify zero raw secrets entered the generateContent call
    const sentPrompt = String(captured.parts[0]);
    expect(sentPrompt).not.toContain("Meridian Cloud Corp.");
    expect(sentPrompt).not.toContain("$500,000");
    expect(sentPrompt).not.toContain("billing@meridian.io");

    // Verify rehydration restored secrets locally and telemetry recorded 0 B PII leakage
    expect(output.audit.executiveSummary).toContain("Meridian Cloud Corp.");
    expect(output.audit.executiveSummary).toContain("$500,000");
    expect(output.audit.clauses[0].excerpt).toContain("billing@meridian.io");
    expect(output.telemetry.inferenceSource).toBe(InferenceSource.IN_CLOUD);
    expect(output.telemetry.rawPiiBytesSent).toBe(0);
  });

  it("includes inlineData image part and multimodal expectedInputs when PNG is attached", async () => {
    let capturedParams = null;
    let capturedParts = null;

    const fakePng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    const mockModelFn = vi.fn((_ai, params) => {
      capturedParams = params;
      return {
        generateContent: vi.fn(async (parts) => {
          capturedParts = parts;
          return {
            response: {
              inferenceSource: InferenceSource.ON_DEVICE,
              text: () =>
                JSON.stringify({
                  overallRiskScore: 68,
                  riskLevel: "HIGH",
                  executiveSummary: "Scanned clause imposes unlimited liability.",
                  clauses: [],
                  missingProtections: ["Liability cap"],
                }),
            },
          };
        }),
      };
    });

    const output = await runContractAudit({
      text: "",
      imageDataUrl: fakePng,
      mode: "ONLY_ON_DEVICE",
      redactBeforeCloud: false,
      ai: { fake: true },
      getGenerativeModelFn: mockModelFn,
    });

    expect(capturedParams.mode).toBe(InferenceMode.ONLY_ON_DEVICE);
    expect(capturedParams.onDeviceParams.createOptions.expectedInputs).toEqual([
      { type: "text", languages: ["en"] },
      { type: "image" },
    ]);
    expect(capturedParts).toHaveLength(2);
    expect(capturedParts[1]).toEqual({
      inlineData: {
        mimeType: "image/png",
        data: fakePng.split(",")[1],
      },
    });
    expect(output.telemetry.inferenceSource).toBe(InferenceSource.ON_DEVICE);
    expect(output.telemetry.rawPiiBytesSent).toBe(0);
    expect(output.telemetry.cloudPayloadBytes).toBe(0);
  });
});

import { cleanProtection } from "../src/schema.js";
describe("missing protections from a small model", () => {
  it("drops stray brackets and turns enum tokens into words, keeps placeholders and acronyms", () => {
    expect(cleanProtection("[AUTO_RENEWAL")).toBe("Auto renewal");
    expect(cleanProtection("PAYMENT")).toBe("Payment");
    expect(cleanProtection("IP")).toBe("IP");
    expect(cleanProtection("Cure period for [PARTY_1]")).toBe("Cure period for [PARTY_1]");
    expect(cleanProtection('"Liability cap"')).toBe("Liability cap");
    expect(cleanProtection("[Indemnification provisions]")).toBe("Indemnification provisions");
    expect(cleanProtection("[PARTY_1]")).toBe("[PARTY_1]");
  });
});
