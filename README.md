# ClauseGuard

A contract review tool for the browser. Paste a contract (or attach a photo of a clause) and it lists risky clauses with a
suggested redline for each. It runs on Chrome's built-in Gemini Nano when available, and falls back to cloud Gemini through
Firebase AI Logic when it is not. Before anything goes to the cloud, names, amounts, addresses and IDs are replaced with
placeholders in the browser, and put back into the results afterwards.

Built for the Firebase #BuildHybridAI 2026 hackathon.

## How it works

```text
contract text or clause image
  -> src/redactor.js        masks names, emails, addresses, amounts, phone numbers, tax/bank IDs ([PARTY_1], [AMOUNT_1], ...);
                            the originals stay in browser memory
  -> src/firebase-hybrid.js firebase/ai with one of the InferenceMode values:
                              ONLY_ON_DEVICE    Gemini Nano in Chrome, nothing leaves the machine
                              PREFER_ON_DEVICE  Nano first, cloud if Nano is not available
                              PREFER_IN_CLOUD   cloud Gemini (GoogleAIBackend, App Check), redacted text only
                              ONLY_IN_CLOUD
  -> src/redactor.js        puts the real names and amounts back into findings and redlines
  -> Firestore              stores score, risk level, clause counts and which side ran (no contract text)
```

The cloud model defaults to `gemini-3.5-flash-lite` and can be changed with the Remote Config key `fallback_cloud_model`.
Both paths are asked for the same JSON shape (`src/schema.js`): `responseSchema` for the cloud call, `responseConstraint` for
the on-device call. The top bar shows `LanguageModel.availability()`, the model download progress, and for each run
`inferenceSource` (`ON_DEVICE` or `IN_CLOUD`), the time taken and a counter of raw personal data sent out.

Four sample contracts with deliberate problems are included: a mutual NDA, a SaaS MSA, an independent contractor agreement
and a commercial lease.

## Running it

Needs Node.js 20+. Gemini Nano needs desktop Chrome 139 or later; without it the cloud path still works once Firebase is set up.

```bash
npm install
npm test
npm run dev
```

### Gemini Nano in Chrome (optional)
1. Enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and restart Chrome.
2. In the DevTools console, `await LanguageModel.availability()`. If it says `downloadable`, press Download Model in the app's top bar.

### Firebase
1. Create a project (the free Spark plan is enough) and turn on AI Logic with the Gemini Developer API.
2. Turn on App Check and enforce it for AI Logic: a reCAPTCHA Enterprise (Fraud Defense) site key for a hosted build, or the debug provider on localhost
   (switch on debug mode in the app's Firebase Config dialog or in `.env`, then add the printed token under App Check → Manage
   debug tokens; do not commit it).
3. Turn on Firestore and, if you want the overrides, Remote Config (`fallback_cloud_model`, `risk_rubric_note`).
4. Copy `.env.example` to `.env` and fill in the web app config, or enter it in the app's Firebase Config dialog (kept in
   `localStorage`).

`npm run build` produces the static site in `dist/` for Firebase Hosting.

## License

Apache License 2.0, see [LICENSE](LICENSE).
