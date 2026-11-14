import { initializeApp, getApps, deleteApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
} from "firebase/ai";
import {
  getRemoteConfig,
  fetchAndActivate,
  getValue,
} from "firebase/remote-config";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";

import { redactContractText, rehydrateAuditResult } from "./redactor.js";
import {
  contractAuditSchema,
  contractAuditJsonSchema,
  buildAuditPrompt,
  normalizeAuditPayload,
} from "./schema.js";

export const DEFAULT_CLOUD_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_RUBRIC_NOTE =
  "Prioritize uncapped liability, unilateral indemnification, non-reciprocal IP assignment, and silent auto-renewal.";

const CONFIG_STORAGE_KEY = "clauseguard.firebaseConfig.v1";

let cachedSignature = "";
let cachedServices = null;

function utf8ByteLength(str) {
  return new TextEncoder().encode(str || "").length;
}

function readEnvConfig() {
  const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
  return {
    apiKey: env.VITE_FIREBASE_API_KEY || "",
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "",
    projectId: env.VITE_FIREBASE_PROJECT_ID || "",
    appId: env.VITE_FIREBASE_APP_ID || "",
    recaptchaSiteKey: env.VITE_RECAPTCHA_SITE_KEY || "",
    debugAppCheck: String(env.VITE_FIREBASE_APPCHECK_DEBUG || "") === "true",
    cloudModel: env.VITE_GEMINI_CLOUD_MODEL || DEFAULT_CLOUD_MODEL,
  };
}

export function loadStoredConfig() {
  try {
    const raw = globalThis.localStorage?.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveStoredConfig(config) {
  const clean = {
    apiKey: String(config?.apiKey || "").trim(),
    authDomain: String(config?.authDomain || "").trim(),
    projectId: String(config?.projectId || "").trim(),
    appId: String(config?.appId || "").trim(),
    recaptchaSiteKey: String(config?.recaptchaSiteKey || "").trim(),
    debugAppCheck: Boolean(config?.debugAppCheck),
  };
  globalThis.localStorage?.setItem(CONFIG_STORAGE_KEY, JSON.stringify(clean));
  return clean;
}

export function clearStoredConfig() {
  globalThis.localStorage?.removeItem(CONFIG_STORAGE_KEY);
}

export function getEffectiveFirebaseConfig() {
  const envCfg = readEnvConfig();
  const stored = loadStoredConfig();
  if (!stored) return envCfg;
  return {
    ...envCfg,
    apiKey: stored.apiKey || envCfg.apiKey,
    authDomain: stored.authDomain || envCfg.authDomain,
    projectId: stored.projectId || envCfg.projectId,
    appId: stored.appId || envCfg.appId,
    recaptchaSiteKey: stored.recaptchaSiteKey || envCfg.recaptchaSiteKey,
    debugAppCheck:
      typeof stored.debugAppCheck === "boolean"
        ? stored.debugAppCheck
        : envCfg.debugAppCheck,
  };
}

export function isFirebaseConfigured(cfg) {
  return Boolean(cfg?.apiKey && cfg?.projectId && cfg?.appId);
}

/**
 * Initializes Firebase App, App Check, Firebase AI Logic (GoogleAIBackend),
 * Remote Config, and Firestore from Vite env vars or localStorage config.
 */
export async function initFirebaseServices(configOverride = null) {
  const cfg = configOverride
    ? { ...getEffectiveFirebaseConfig(), ...configOverride }
    : getEffectiveFirebaseConfig();

  if (!isFirebaseConfigured(cfg)) {
    cachedSignature = "";
    cachedServices = {
      configured: false,
      config: cfg,
      app: null,
      ai: null,
      remoteConfig: null,
      db: null,
      appCheckStatus: "unconfigured",
    };
    return cachedServices;
  }

  const signature = JSON.stringify({
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain,
    projectId: cfg.projectId,
    appId: cfg.appId,
    recaptchaSiteKey: cfg.recaptchaSiteKey,
    debugAppCheck: cfg.debugAppCheck,
  });

  if (cachedServices && cachedSignature === signature) {
    return cachedServices;
  }

  for (const existing of getApps()) {
    await deleteApp(existing);
  }

  const app = initializeApp({
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain || `${cfg.projectId}.firebaseapp.com`,
    projectId: cfg.projectId,
    appId: cfg.appId,
  });

  let appCheckStatus = "disabled";
  if (cfg.debugAppCheck) {
    globalThis.self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(
          cfg.recaptchaSiteKey || "localhost-debug-provider"
        ),
        isTokenAutoRefreshEnabled: true,
      });
      appCheckStatus = "debug-active";
    } catch {
      appCheckStatus = "debug-flagged";
    }
  } else if (cfg.recaptchaSiteKey) {
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(cfg.recaptchaSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
      appCheckStatus = "recaptcha-v3";
    } catch {
      appCheckStatus = "error";
    }
  }

  const ai = getAI(app, { backend: new GoogleAIBackend() });

  const remoteConfig = getRemoteConfig(app);
  remoteConfig.defaultConfig = {
    fallback_cloud_model: cfg.cloudModel || DEFAULT_CLOUD_MODEL,
    risk_rubric_note: DEFAULT_RUBRIC_NOTE,
  };
  remoteConfig.settings.minimumFetchIntervalMillis = 60_000;

  const db = getFirestore(app);

  cachedSignature = signature;
  cachedServices = {
    configured: true,
    config: cfg,
    app,
    ai,
    remoteConfig,
    db,
    appCheckStatus,
  };
  return cachedServices;
}

/**
 * Inspects Chrome Prompt API availability for Gemini Nano.
 */
export async function checkOnDeviceAvailability(
  languageModelGlobal = globalThis.LanguageModel
) {
  if (!languageModelGlobal || typeof languageModelGlobal.availability !== "function") {
    return {
      supported: false,
      status: "unavailable",
      multimodalReady: false,
      detail: "Chrome LanguageModel API not detected in this browser.",
    };
  }

  try {
    let status = await languageModelGlobal.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }, { type: "image" }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
    let multimodalReady = status !== "unavailable";

    if (status === "unavailable") {
      status = await languageModelGlobal.availability({
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
      });
      multimodalReady = false;
    }

    return {
      supported: status !== "unavailable",
      status,
      multimodalReady,
      detail: multimodalReady
        ? "Text + multimodal image input ready"
        : "Text-only on-device support",
    };
  } catch (err) {
    return {
      supported: false,
      status: "unavailable",
      multimodalReady: false,
      detail: err?.message || "Failed to query LanguageModel.availability().",
    };
  }
}

/**
 * Triggers Gemini Nano download inside Chrome via Firebase AI Logic when configured,
 * or directly via `LanguageModel.create` during local preview.
 */
export async function downloadOnDeviceModel({
  ai = null,
  cloudModel = DEFAULT_CLOUD_MODEL,
  onProgress = () => {},
  languageModelGlobal = globalThis.LanguageModel,
} = {}) {
  if (ai) {
    const model = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams: { model: cloudModel },
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: "text", languages: ["en"] }],
          expectedOutputs: [{ type: "text", languages: ["en"] }],
        },
      },
    });
    await model.initializeDeviceModel((progress) => {
      onProgress(progress);
    });
    return;
  }

  if (!languageModelGlobal || typeof languageModelGlobal.create !== "function") {
    throw new Error(
      "Chrome Prompt API (`window.LanguageModel`) is unavailable. Enable Chrome Prompt API flags first."
    );
  }

  const session = await languageModelGlobal.create({
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        onProgress(event.loaded ?? 0);
      });
    },
  });
  session.destroy?.();
}

export async function loadRemoteRubrics(remoteConfig) {
  const defaults = {
    cloudModel: DEFAULT_CLOUD_MODEL,
    rubricNote: DEFAULT_RUBRIC_NOTE,
    source: "default",
  };
  if (!remoteConfig) return defaults;

  try {
    await fetchAndActivate(remoteConfig);
    const cloudModel =
      getValue(remoteConfig, "fallback_cloud_model").asString() ||
      DEFAULT_CLOUD_MODEL;
    const rubricNote =
      getValue(remoteConfig, "risk_rubric_note").asString() ||
      DEFAULT_RUBRIC_NOTE;
    return { cloudModel, rubricNote, source: "remote-config" };
  } catch {
    return defaults;
  }
}

export function parseDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2],
  };
}

function resolveInferenceMode(modeKey) {
  const resolved = InferenceMode[modeKey];
  if (!resolved) {
    throw new Error(`Unsupported inference mode: ${String(modeKey)}`);
  }
  return resolved;
}

function dataUrlToBlob(dataUrl, mimeType) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const binary = globalThis.atob(parsed.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || parsed.mimeType });
}

async function runDirectChromePrompt({
  promptText,
  imageDataUrl,
  imagePart,
  languageModelGlobal,
}) {
  if (!languageModelGlobal || typeof languageModelGlobal.create !== "function") {
    throw new Error(
      "Chrome Prompt API (`window.LanguageModel`) is unavailable."
    );
  }

  const expectedInputs = imagePart
    ? [{ type: "text", languages: ["en"] }, { type: "image" }]
    : [{ type: "text", languages: ["en"] }];

  const session = await languageModelGlobal.create({
    expectedInputs,
    expectedOutputs: [{ type: "text", languages: ["en"] }],
  });

  try {
    const content = [{ type: "text", value: promptText }];
    if (imagePart) {
      const blob = dataUrlToBlob(imageDataUrl, imagePart.inlineData.mimeType);
      const imageValue =
        typeof globalThis.createImageBitmap === "function" && blob
          ? await globalThis.createImageBitmap(blob)
          : blob;
      content.push({ type: "image", value: imageValue });
    }

    const rawText = await session.prompt([{ role: "user", content }], {
      responseConstraint: contractAuditJsonSchema,
    });
    return {
      rawText,
      inferenceSource: InferenceSource.ON_DEVICE,
    };
  } finally {
    session.destroy?.();
  }
}

/**
 * Runs a hybrid contract audit with pre-inference PII redaction and local
 * entity rehydration.
 */
export async function runContractAudit({
  text = "",
  imageDataUrl = "",
  mode = "PREFER_ON_DEVICE",
  redactBeforeCloud = true,
  cloudModel = DEFAULT_CLOUD_MODEL,
  rubricNote = "",
  ai = null,
  getGenerativeModelFn = getGenerativeModel,
  languageModelGlobal = globalThis.LanguageModel,
} = {}) {
  const parsedImage = parseDataUrl(imageDataUrl);
  const imagePart = parsedImage ? { inlineData: parsedImage } : null;
  const trimmedText = String(text || "").trim();
  if (!trimmedText && !imagePart) {
    throw new Error("Provide contract text or attach a scanned clause image.");
  }

  const resolvedMode = resolveInferenceMode(mode);
  const redaction = redactContractText(text || "");
  const modelInputText = redactBeforeCloud ? redaction.redactedText : text;
  const promptText = buildAuditPrompt(
    modelInputText,
    rubricNote,
    Boolean(imagePart)
  );
  const parts = imagePart ? [promptText, imagePart] : [promptText];

  const expectedInputs = imagePart
    ? [{ type: "text", languages: ["en"] }, { type: "image" }]
    : [{ type: "text", languages: ["en"] }];

  const startedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  let rawText = "";
  let inferenceSource = InferenceSource.IN_CLOUD;

  if (ai) {
    const model = getGenerativeModelFn(ai, {
      mode: resolvedMode,
      inCloudParams: {
        model: cloudModel || DEFAULT_CLOUD_MODEL,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: contractAuditSchema,
        },
      },
      onDeviceParams: {
        createOptions: {
          expectedInputs,
          expectedOutputs: [{ type: "text", languages: ["en"] }],
        },
        promptOptions: {
          responseConstraint: contractAuditJsonSchema,
        },
      },
    });

    const result = await model.generateContent(parts);
    rawText = result.response.text();
    inferenceSource =
      result?.response?.inferenceSource ||
      result?.inferenceSource ||
      (resolvedMode === InferenceMode.ONLY_ON_DEVICE
        ? InferenceSource.ON_DEVICE
        : InferenceSource.IN_CLOUD);
  } else if (
    (resolvedMode === InferenceMode.ONLY_ON_DEVICE ||
      resolvedMode === InferenceMode.PREFER_ON_DEVICE) &&
    languageModelGlobal &&
    typeof languageModelGlobal.create === "function"
  ) {
    const direct = await runDirectChromePrompt({
      promptText,
      imageDataUrl,
      imagePart,
      languageModelGlobal,
    });
    rawText = direct.rawText;
    inferenceSource = direct.inferenceSource;
  } else {
    throw new Error(
      "Firebase is not configured yet and Chrome's on-device Gemini Nano is unavailable. Open Firebase Config to connect Gemini Developer API or run in Chrome with Prompt API enabled."
    );
  }

  const finishedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const latencyMs = Math.max(1, Math.round(finishedAt - startedAt));

  const parsedAudit = normalizeAuditPayload(rawText);
  const finalAudit = redactBeforeCloud
    ? rehydrateAuditResult(parsedAudit, redaction.entityMap)
    : parsedAudit;

  const executedInCloud = inferenceSource === InferenceSource.IN_CLOUD;
  const detectedRawPiiBytes = redaction.entities.reduce(
    (sum, ent) => sum + utf8ByteLength(ent.original),
    0
  );
  const rawPiiBytesSent =
    executedInCloud && !redactBeforeCloud ? detectedRawPiiBytes : 0;

  return {
    audit: finalAudit,
    telemetry: {
      inferenceSource,
      mode,
      latencyMs,
      rawPiiBytesSent,
      cloudPayloadBytes: executedInCloud ? utf8ByteLength(promptText) : 0,
      totalMasked: redaction.stats.totalMasked,
      uniqueEntities: redaction.stats.uniqueEntities,
      byType: redaction.stats.byType,
      cloudModel: executedInCloud
        ? cloudModel || DEFAULT_CLOUD_MODEL
        : "gemini-nano (on-device)",
      redactedBeforeInference: redactBeforeCloud,
    },
    redaction,
  };
}

/**
 * Persists strictly redacted audit telemetry metadata (zero contract text or PII)
 * to Cloud Firestore for compliance logging.
 */
export async function saveAuditSummaryToFirestore(db, record) {
  if (!db) {
    throw new Error("Firestore is not initialized. Connect Firebase Config first.");
  }

  const docRef = await addDoc(collection(db, "audit_logs"), {
    overallRiskScore: Number(record.overallRiskScore) || 0,
    riskLevel: String(record.riskLevel || "MODERATE"),
    clauseCount: Number(record.clauseCount) || 0,
    inferenceSource: String(record.inferenceSource || InferenceSource.IN_CLOUD),
    mode: String(record.mode || "PREFER_ON_DEVICE"),
    latencyMs: Number(record.latencyMs) || 0,
    totalMasked: Number(record.totalMasked) || 0,
    rawPiiBytesSent: Number(record.rawPiiBytesSent) || 0,
    modelLabel: String(record.cloudModel || DEFAULT_CLOUD_MODEL),
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function fetchAuditHistoryFromFirestore(db, maxItems = 12) {
  if (!db) return [];
  const q = query(
    collection(db, "audit_logs"),
    orderBy("createdAt", "desc"),
    limit(maxItems)
  );
  const snap = await getDocs(q);
  return snap.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      overallRiskScore: data.overallRiskScore ?? 0,
      riskLevel: data.riskLevel ?? "MODERATE",
      clauseCount: data.clauseCount ?? 0,
      inferenceSource: data.inferenceSource ?? "unknown",
      mode: data.mode ?? "PREFER_ON_DEVICE",
      latencyMs: data.latencyMs ?? 0,
      totalMasked: data.totalMasked ?? 0,
      rawPiiBytesSent: data.rawPiiBytesSent ?? 0,
      modelLabel: data.modelLabel ?? DEFAULT_CLOUD_MODEL,
      createdAtIso: data.createdAt?.toDate
        ? data.createdAt.toDate().toISOString()
        : null,
    };
  });
}
