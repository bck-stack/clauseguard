# ClauseGuard

**Zero-Egress On-Device Contract Risk Auditor & Hybrid Cloud Redline Assistant**

Built for **Firebase `#BuildHybridAI` 2026** using **Firebase AI Logic Hybrid Inference (`firebase/ai`)**, **Chrome Gemini Nano (Prompt API)**, **Firebase App Check**, **Firebase Remote Config**, and **Cloud Firestore**.

## Why Hybrid Inference Matters for Legal Contracts

Standard cloud-only AI contract reviewers force users to paste confidential counterparty names, pricing, addresses, tax IDs, and IBANs straight into remote LLM endpoints. Meanwhile, local-only models are unavailable on unsupported browsers or hit context limits on multi-page agreements.

ClauseGuard solves both halves in a single `firebase/ai` pipeline:

1. **Local Privacy Shield + On-Device First (`InferenceMode.ONLY_ON_DEVICE` / `PREFER_ON_DEVICE`):**
   - When Gemini Nano is available in desktop Chrome (v139+), ClauseGuard audits contracts and photographed clause exhibits (JPEG/PNG multimodal input) directly on-device with **0 bytes of contract text sent to any server**.
   - Before any cloud fallback runs, a deterministic client-side redactor (`src/redactor.js`) masks counterparty names (`[PARTY_1]`), emails (`[EMAIL_1]`), street addresses (`[ADDRESS_1]`), monetary amounts (`[AMOUNT_1]`), phone numbers (`[PHONE_1]`), and tax/bank IDs (`[ID_1]`).
2. **Seamless Cloud Fallback + Local Rehydration:**
   - If the browser lacks Gemini Nano or the user selects `PREFER_IN_CLOUD` for deeper multi-clause redline drafting, `firebase/ai` automatically falls back to Gemini (`gemini-3.5-flash-lite` or Remote Config override) using **only the redacted contract text**.
   - Returned findings and suggested redlines are rehydrated locally in the browser back to the real party names and amounts.

## Architecture

```text
Contract Text / Clause Image (PNG/JPEG)
  │
  ├─► Local PII Shield (src/redactor.js)
  │     ├─ Keeps raw PII in browser memory only
  │     └─ Produces redacted payload ([PARTY_1], [AMOUNT_1], ...)
  │
  ├─► Firebase AI Logic Hybrid SDK (src/firebase-hybrid.js)
  │     ├─ InferenceMode.ONLY_ON_DEVICE  ──► Chrome Gemini Nano 4 (0 bytes egress)
  │     ├─ InferenceMode.PREFER_ON_DEVICE ──► Nano first, cloud fallback if unavailable
  │     └─ InferenceMode.PREFER_IN_CLOUD ──► Cloud Gemini via GoogleAIBackend + App Check
  │
  ├─► Local Rehydration (src/redactor.js)
  │     └─ Restores [PARTY_1], [AMOUNT_1] in findings & redline drafts locally
  │
  └─► Firebase Platform Services
        ├─ App Check (reCAPTCHA v3 / Debug Token enforced for AI Logic)
        ├─ Remote Config (dynamic risk rubric & fallback model name)
        └─ Cloud Firestore (stores PII-free audit metadata & telemetry only)
```

## Features

- **Live Hybrid Inference Telemetry Bar:** Inspect Chrome `LanguageModel.availability()`, trigger on-device model downloads with progress tracking, switch between all four `InferenceMode` values, and verify the exact execution source (`result.response.inferenceSource` -> `ON_DEVICE` vs `IN_CLOUD`), latency, and raw PII bytes sent.
- **Multimodal Clause Auditing:** Attach a photographed or scanned contract clause (PNG/JPEG) or generate the built-in scanned exhibit image to test multimodal on-device/hybrid analysis.
- **Structured JSON Output (`Schema`):** Uses `firebase/ai` `Schema` helpers (`inCloudParams.generationConfig.responseSchema` and `onDeviceParams.promptOptions.responseConstraint`) so both local and cloud responses follow the same typed JSON contract.
- **Four Trap-Laden Sample Contracts:** Mutual NDA, SaaS MSA, Independent Contractor Agreement, and Commercial Lease.
- **PII-Free Firestore Audit Log:** Persists only overall score, risk level, clause counts, and inference source without ever storing contract text or sensitive entities.

## Local Setup & Judging Verification

### 1. Prerequisites
- Node.js 20+
- Desktop Google Chrome **v139+** for on-device Gemini Nano inference (optional — cloud fallback works in any modern browser once Firebase is configured).

### 2. Enable On-Device Gemini Nano in Chrome (Optional for Local Execution)
1. Open `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and set it to **Enabled**, then restart Chrome.
2. Open DevTools Console and check `await LanguageModel.availability()`. If it returns `downloadable`, click **Download Model** in ClauseGuard's top telemetry bar.

### 3. Configure Firebase
1. Create a project in the Firebase Console on the free Spark plan.
2. Enable **Firebase AI Logic** (`AI Logic` -> Get Started -> Gemini Developer API).
3. Enable **Firebase App Check** and enforce it on Firebase AI Logic:
   - Register a **reCAPTCHA v3** site key for production hosting, or use the **Debug Provider** for localhost testing.
   - To use a debug token locally, enable debug mode in ClauseGuard's **Firebase Config** modal (or `.env`) and add the logged UUID in *Firebase Console -> App Check -> Apps -> Manage debug tokens*. Never commit debug tokens to git.
4. Enable **Cloud Firestore** and **Firebase Remote Config** (optional Remote Config keys: `fallback_cloud_model`, `risk_rubric_note`).
5. Copy `.env.example` to `.env` and fill in your Firebase Web App credentials, or click **Firebase Config** directly in the app header to save settings in `localStorage`.

### 4. Run & Test

```bash
npm install
npm test
npm run dev
```

To build for production or deploy to Firebase Hosting:

```bash
npm run build
```

## License

Licensed under the [Apache License 2.0](LICENSE).
