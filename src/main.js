import "./style.css";
import { InferenceSource } from "firebase/ai";

import { redactContractText } from "./redactor.js";
import {
  SAMPLE_CONTRACTS,
  SAMPLE_SCANNED_CLAUSE_TEXT,
  createSampleClauseImageDataUrl,
} from "./samples.js";
import {
  initFirebaseServices,
  checkOnDeviceAvailability,
  downloadOnDeviceModel,
  loadRemoteRubrics,
  runContractAudit,
  saveAuditSummaryToFirestore,
  fetchAuditHistoryFromFirestore,
  saveStoredConfig,
  clearStoredConfig,
  getEffectiveFirebaseConfig,
} from "./firebase-hybrid.js";

const el = (id) => document.getElementById(id);

const dom = {
  btnOpenConfig: el("btn-open-config"),
  btnLoadHistory: el("btn-load-history"),
  badgeNanoStatus: el("badge-nano-status"),
  btnDownloadNano: el("btn-download-nano"),
  nanoProgress: el("nano-progress"),
  selectInferenceMode: el("select-inference-mode"),
  badgeAppCheck: el("badge-appcheck"),
  badgeExecSource: el("badge-exec-source"),
  metricLatency: el("metric-latency"),
  badgePiiExposure: el("badge-pii-exposure"),
  btnSampleImage: el("btn-sample-image"),
  inputImageFile: el("input-image-file"),
  imagePreviewBox: el("image-preview-box"),
  imagePreviewEl: el("image-preview-el"),
  imagePreviewName: el("image-preview-name"),
  btnClearImage: el("btn-clear-image"),
  tabRaw: el("tab-raw"),
  tabRedacted: el("tab-redacted"),
  redactionSummary: el("redaction-summary"),
  contractInput: el("contract-input"),
  redactedPreview: el("redacted-preview"),
  chkRedactPii: el("chk-redact-pii"),
  entityChips: el("entity-chips"),
  btnRunAudit: el("btn-run-audit"),
  btnRunOnDevice: el("btn-run-ondevice"),
  remoteConfigBadge: el("remote-config-badge"),
  btnSaveFirestore: el("btn-save-firestore"),
  btnExportMd: el("btn-export-md"),
  statusBanner: el("status-banner"),
  emptyState: el("empty-state"),
  resultsContainer: el("results-container"),
  resultScore: el("result-score"),
  resultLevel: el("result-level"),
  resultSourceTag: el("result-source-tag"),
  resultSummary: el("result-summary"),
  clausesList: el("clauses-list"),
  missingList: el("missing-list"),
  firestoreStatus: el("firestore-status"),
  firestoreLogList: el("firestore-log-list"),
  configDialog: el("config-dialog"),
  configForm: el("config-form"),
  btnCloseConfig: el("btn-close-config"),
  btnClearConfig: el("btn-clear-config"),
  cfgApiKey: el("cfg-apiKey"),
  cfgAuthDomain: el("cfg-authDomain"),
  cfgProjectId: el("cfg-projectId"),
  cfgAppId: el("cfg-appId"),
  cfgRecaptchaKey: el("cfg-recaptchaKey"),
  cfgDebugAppCheck: el("cfg-debugAppCheck"),
};

const state = {
  services: null,
  rubrics: {
    cloudModel: "gemini-3.5-flash-lite",
    rubricNote: "",
    source: "default",
  },
  activeTab: "raw",
  attachedImageDataUrl: "",
  attachedImageName: "",
  lastResult: null,
  isRunning: false,
};

function riskLevelToPillClass(level) {
  switch (level) {
    case "LOW":
      return "pill-low";
    case "MODERATE":
      return "pill-medium";
    case "HIGH":
      return "pill-high";
    case "CRITICAL":
      return "pill-critical";
    default:
      return "pill-neutral";
  }
}

function setStatusBanner(type, message) {
  if (!message) {
    dom.statusBanner.className = "status-banner hidden";
    dom.statusBanner.textContent = "";
    return;
  }
  dom.statusBanner.className = `status-banner ${type}`;
  dom.statusBanner.textContent = message;
}

function updateRedactionPreview() {
  const raw = dom.contractInput.value || "";
  const shieldEnabled = dom.chkRedactPii.checked;
  const redaction = redactContractText(raw);

  dom.redactedPreview.textContent = redaction.redactedText;

  if (!raw.trim()) {
    dom.redactionSummary.textContent = "0 entities masked";
  } else if (!shieldEnabled) {
    dom.redactionSummary.textContent = `${redaction.stats.totalMasked} detected (shield disabled for inference)`;
  } else {
    dom.redactionSummary.textContent = `${redaction.stats.totalMasked} masked (${redaction.stats.uniqueEntities} unique)`;
  }

  dom.entityChips.innerHTML = "";
  const previewEntities = redaction.entities.slice(0, 18);
  for (const ent of previewEntities) {
    const chip = document.createElement("span");
    chip.className = "entity-chip";
    chip.textContent = `${ent.placeholder} · ${ent.type}`;
    chip.title = `Masked ${ent.type} entity`;
    dom.entityChips.appendChild(chip);
  }
  if (redaction.entities.length > 18) {
    const more = document.createElement("span");
    more.className = "entity-chip";
    more.textContent = `+${redaction.entities.length - 18} more`;
    dom.entityChips.appendChild(more);
  }

  if (!state.lastResult) {
    dom.badgePiiExposure.textContent = shieldEnabled
      ? `0 B (Armed · ${redaction.stats.uniqueEntities})`
      : "Shield Off";
    dom.badgePiiExposure.className = shieldEnabled
      ? "pill pill-safe"
      : "pill pill-warn";
  }
}

function setEditorTab(tab) {
  state.activeTab = tab;
  const showRaw = tab === "raw";
  dom.tabRaw.classList.toggle("active", showRaw);
  dom.tabRedacted.classList.toggle("active", !showRaw);
  dom.contractInput.classList.toggle("hidden", !showRaw);
  dom.redactedPreview.classList.toggle("hidden", showRaw);
}

function setAttachedImage(dataUrl, fileName) {
  state.attachedImageDataUrl = dataUrl || "";
  state.attachedImageName = fileName || "";
  if (state.attachedImageDataUrl) {
    dom.imagePreviewEl.src = state.attachedImageDataUrl;
    dom.imagePreviewName.textContent = state.attachedImageName;
    dom.imagePreviewBox.classList.remove("hidden");
  } else {
    dom.imagePreviewEl.removeAttribute("src");
    dom.imagePreviewName.textContent = "";
    dom.imagePreviewBox.classList.add("hidden");
  }
}

function renderAuditResult(result) {
  const { audit, telemetry } = result;
  dom.emptyState.classList.add("hidden");
  dom.resultsContainer.classList.remove("hidden");

  dom.resultScore.textContent = String(audit.overallRiskScore);
  dom.resultLevel.textContent = audit.riskLevel;
  dom.resultLevel.className = `pill ${riskLevelToPillClass(audit.riskLevel)}`;

  const executedOnDevice =
    telemetry.inferenceSource === InferenceSource.ON_DEVICE;
  dom.resultSourceTag.textContent = executedOnDevice
    ? `Executed On-Device · Gemini Nano (${telemetry.latencyMs} ms)`
    : `Executed In-Cloud · ${telemetry.cloudModel} (${telemetry.latencyMs} ms)`;
  dom.resultSourceTag.className = executedOnDevice
    ? "pill pill-safe"
    : "pill pill-info";

  dom.resultSummary.textContent = audit.executiveSummary;

  dom.badgeExecSource.textContent = executedOnDevice
    ? "On-Device (Nano)"
    : "In-Cloud (Gemini)";
  dom.badgeExecSource.className = executedOnDevice
    ? "pill pill-safe"
    : "pill pill-info";

  dom.metricLatency.textContent = `${telemetry.latencyMs} ms`;

  dom.badgePiiExposure.textContent = `${telemetry.rawPiiBytesSent} B`;
  dom.badgePiiExposure.className =
    telemetry.rawPiiBytesSent === 0 ? "pill pill-safe" : "pill pill-critical";

  dom.clausesList.innerHTML = "";
  if (audit.clauses.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted-note";
    empty.textContent = "No high-risk clauses flagged under the current rubric.";
    dom.clausesList.appendChild(empty);
  } else {
    for (const clause of audit.clauses) {
      const card = document.createElement("article");
      card.className = "clause-card";

      const header = document.createElement("div");
      header.className = "clause-header";

      const title = document.createElement("span");
      title.className = "clause-title";
      title.textContent = clause.title;

      const badges = document.createElement("div");
      badges.className = "clause-badges";

      const catPill = document.createElement("span");
      catPill.className = "pill pill-neutral";
      catPill.textContent = clause.category;

      const sevPill = document.createElement("span");
      sevPill.className = `pill ${riskLevelToPillClass(clause.severity)}`;
      sevPill.textContent = clause.severity;

      badges.appendChild(catPill);
      badges.appendChild(sevPill);
      header.appendChild(title);
      header.appendChild(badges);
      card.appendChild(header);

      if (clause.excerpt) {
        const excerpt = document.createElement("blockquote");
        excerpt.className = "clause-excerpt";
        excerpt.textContent = clause.excerpt;
        card.appendChild(excerpt);
      }

      const finding = document.createElement("p");
      finding.className = "clause-finding";
      finding.textContent = clause.finding;
      card.appendChild(finding);

      if (clause.recommendedRedline) {
        const redlineBox = document.createElement("div");
        redlineBox.className = "redline-box";

        const redlineHeader = document.createElement("div");
        redlineHeader.className = "redline-header";

        const redlineLabel = document.createElement("span");
        redlineLabel.textContent = "Suggested Safer Redline";

        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "btn btn-secondary btn-xs";
        copyBtn.textContent = "Copy Redline";
        copyBtn.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(clause.recommendedRedline);
            copyBtn.textContent = "Copied!";
            setTimeout(() => {
              copyBtn.textContent = "Copy Redline";
            }, 1500);
          } catch {
            copyBtn.textContent = "Copy Failed";
          }
        });

        redlineHeader.appendChild(redlineLabel);
        redlineHeader.appendChild(copyBtn);

        const redlineText = document.createElement("p");
        redlineText.className = "redline-text";
        redlineText.textContent = clause.recommendedRedline;

        redlineBox.appendChild(redlineHeader);
        redlineBox.appendChild(redlineText);
        card.appendChild(redlineBox);
      }

      dom.clausesList.appendChild(card);
    }
  }

  dom.missingList.innerHTML = "";
  if (audit.missingProtections.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No missing standard protections reported.";
    dom.missingList.appendChild(li);
  } else {
    for (const item of audit.missingProtections) {
      const li = document.createElement("li");
      li.textContent = item;
      dom.missingList.appendChild(li);
    }
  }

  dom.btnExportMd.disabled = false;
  dom.btnSaveFirestore.disabled = false;
}

function renderHistoryList(items) {
  dom.firestoreLogList.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "muted-note";
    empty.textContent = "No compliance telemetry entries recorded yet.";
    dom.firestoreLogList.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "log-row";

    const left = document.createElement("span");
    left.textContent = `${item.riskLevel} (${item.overallRiskScore}/100) · ${item.clauseCount} clauses · ${item.totalMasked} masked`;

    const right = document.createElement("span");
    const stamp = item.createdAtIso
      ? new Date(item.createdAtIso).toLocaleTimeString()
      : "pending";
    right.textContent = `${item.inferenceSource} · ${item.latencyMs} ms · ${stamp}`;

    row.appendChild(left);
    row.appendChild(right);
    dom.firestoreLogList.appendChild(row);
  }
}

async function refreshEnvironmentStatus() {
  state.services = await initFirebaseServices();

  if (state.services.configured) {
    dom.badgeAppCheck.textContent = `App Check: ${state.services.appCheckStatus}`;
    dom.badgeAppCheck.className =
      state.services.appCheckStatus === "error"
        ? "pill pill-warn"
        : "pill pill-safe";
    dom.firestoreStatus.textContent = "Connected (redacted metadata only)";
  } else {
    dom.badgeAppCheck.textContent = "Not Configured";
    dom.badgeAppCheck.className = "pill pill-neutral";
    dom.firestoreStatus.textContent = "Configure Firebase in header to enable";
  }

  state.rubrics = await loadRemoteRubrics(state.services.remoteConfig);
  dom.remoteConfigBadge.textContent = `Cloud fallback: ${state.rubrics.cloudModel} (${state.rubrics.source})`;

  const nano = await checkOnDeviceAvailability();
  dom.btnDownloadNano.classList.add("hidden");

  if (nano.status === "available") {
    dom.badgeNanoStatus.textContent = nano.multimodalReady
      ? "Ready (Text + Image)"
      : "Ready (Text)";
    dom.badgeNanoStatus.className = "pill pill-safe";
  } else if (nano.status === "downloadable" || nano.status === "downloading") {
    dom.badgeNanoStatus.textContent =
      nano.status === "downloading" ? "Downloading…" : "Downloadable";
    dom.badgeNanoStatus.className = "pill pill-warn";
    dom.btnDownloadNano.classList.remove("hidden");
  } else {
    dom.badgeNanoStatus.textContent = "Unavailable (Cloud Ready)";
    dom.badgeNanoStatus.className = "pill pill-neutral";
  }

  if (state.services.db) {
    try {
      const history = await fetchAuditHistoryFromFirestore(state.services.db);
      renderHistoryList(history);
    } catch {
      dom.firestoreStatus.textContent = "Firestore read unavailable";
    }
  }
}

async function executeAudit(modeOverride = null) {
  if (state.isRunning) return;

  const selectedMode = modeOverride || dom.selectInferenceMode.value;
  if (modeOverride) {
    dom.selectInferenceMode.value = modeOverride;
  }

  state.isRunning = true;
  dom.btnRunAudit.disabled = true;
  dom.btnRunOnDevice.disabled = true;

  setStatusBanner(
    "info",
    selectedMode === "ONLY_ON_DEVICE"
      ? "Running strictly on-device Gemini Nano audit (0 bytes leaving browser)..."
      : `Running hybrid contract audit (${selectedMode})...`
  );

  try {
    const result = await runContractAudit({
      text: dom.contractInput.value,
      imageDataUrl: state.attachedImageDataUrl,
      mode: selectedMode,
      redactBeforeCloud: dom.chkRedactPii.checked,
      cloudModel: state.rubrics.cloudModel,
      rubricNote: state.rubrics.rubricNote,
      ai: state.services?.ai || null,
    });

    state.lastResult = result;
    renderAuditResult(result);

    const onDevice =
      result.telemetry.inferenceSource === InferenceSource.ON_DEVICE;
    setStatusBanner(
      "success",
      onDevice
        ? `Audit complete on-device in ${result.telemetry.latencyMs} ms. Raw PII transmitted: 0 B.`
        : `Audit complete via ${result.telemetry.cloudModel} in ${result.telemetry.latencyMs} ms (${result.telemetry.totalMasked} sensitive entities masked before cloud call).`
    );
  } catch (err) {
    setStatusBanner(
      "error",
      err?.message || "Audit failed. Verify Chrome AI flags or Firebase Config."
    );
  } finally {
    state.isRunning = false;
    dom.btnRunAudit.disabled = false;
    dom.btnRunOnDevice.disabled = false;
  }
}

function exportAuditMarkdown() {
  if (!state.lastResult) return;
  const { audit, telemetry } = state.lastResult;

  const lines = [
    "# ClauseGuard Contract Risk Audit",
    "",
    `- **Overall Risk Score:** ${audit.overallRiskScore}/100 (${audit.riskLevel})`,
    `- **Execution Source:** ${telemetry.inferenceSource} (${telemetry.cloudModel})`,
    `- **Inference Latency:** ${telemetry.latencyMs} ms`,
    `- **Masked Sensitive Entities:** ${telemetry.totalMasked}`,
    `- **Raw PII Sent to Cloud:** ${telemetry.rawPiiBytesSent} B`,
    "",
    "## Executive Summary",
    audit.executiveSummary,
    "",
    "## Flagged Clauses",
  ];

  for (const clause of audit.clauses) {
    lines.push(
      `### ${clause.title} [${clause.severity} · ${clause.category}]`,
      ""
    );
    if (clause.excerpt) lines.push(`> ${clause.excerpt}`, "");
    lines.push(clause.finding, "");
    if (clause.recommendedRedline) {
      lines.push("**Recommended Safer Redline:**", "", clause.recommendedRedline, "");
    }
  }

  lines.push("## Missing Standard Protections");
  for (const missing of audit.missingProtections) {
    lines.push(`- ${missing}`);
  }

  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "clauseguard-audit-report.md";
  anchor.click();
  URL.revokeObjectURL(url);
}

function openConfigModal() {
  const cfg = getEffectiveFirebaseConfig();
  dom.cfgApiKey.value = cfg.apiKey || "";
  dom.cfgAuthDomain.value = cfg.authDomain || "";
  dom.cfgProjectId.value = cfg.projectId || "";
  dom.cfgAppId.value = cfg.appId || "";
  dom.cfgRecaptchaKey.value = cfg.recaptchaSiteKey || "";
  dom.cfgDebugAppCheck.value = cfg.debugAppCheck ? "true" : "false";
  dom.configDialog.showModal();
}

function bindEvents() {
  document.querySelectorAll("[data-sample]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sample = SAMPLE_CONTRACTS.find((s) => s.id === btn.dataset.sample);
      if (!sample) return;
      dom.contractInput.value = sample.text;
      updateRedactionPreview();
      setStatusBanner("info", `Loaded sample contract: ${sample.label}`);
    });
  });

  dom.btnSampleImage.addEventListener("click", () => {
    const dataUrl = createSampleClauseImageDataUrl();
    if (!dataUrl) {
      setStatusBanner("error", "Canvas image generation is unavailable.");
      return;
    }
    setAttachedImage(dataUrl, "scanned-indemnity-clause.png");
    if (!dom.contractInput.value.trim()) {
      dom.contractInput.value = SAMPLE_SCANNED_CLAUSE_TEXT;
      updateRedactionPreview();
    }
    setStatusBanner("info", "Attached synthetic scanned clause PNG for multimodal audit.");
  });

  dom.inputImageFile.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAttachedImage(reader.result, file.name);
        setStatusBanner("info", `Attached clause image: ${file.name}`);
      }
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  });

  dom.btnClearImage.addEventListener("click", () => {
    setAttachedImage("", "");
  });

  dom.tabRaw.addEventListener("click", () => setEditorTab("raw"));
  dom.tabRedacted.addEventListener("click", () => {
    updateRedactionPreview();
    setEditorTab("redacted");
  });

  dom.contractInput.addEventListener("input", updateRedactionPreview);
  dom.chkRedactPii.addEventListener("change", updateRedactionPreview);

  dom.btnRunAudit.addEventListener("click", () => executeAudit(null));
  dom.btnRunOnDevice.addEventListener("click", () =>
    executeAudit("ONLY_ON_DEVICE")
  );
  dom.btnExportMd.addEventListener("click", exportAuditMarkdown);

  dom.btnDownloadNano.addEventListener("click", async () => {
    dom.nanoProgress.classList.remove("hidden");
    dom.nanoProgress.textContent = "0%";
    try {
      await downloadOnDeviceModel({
        ai: state.services?.ai || null,
        cloudModel: state.rubrics.cloudModel,
        onProgress: (loaded) => {
          dom.nanoProgress.textContent = `${Math.round(loaded * 100)}%`;
        },
      });
      await refreshEnvironmentStatus();
    } catch (err) {
      setStatusBanner("error", err?.message || "Failed to download Gemini Nano.");
    } finally {
      dom.nanoProgress.classList.add("hidden");
    }
  });

  dom.btnSaveFirestore.addEventListener("click", async () => {
    if (!state.lastResult) return;
    if (!state.services?.db) {
      setStatusBanner("error", "Configure Firebase credentials first to save Firestore logs.");
      return;
    }
    try {
      dom.btnSaveFirestore.disabled = true;
      await saveAuditSummaryToFirestore(state.services.db, {
        overallRiskScore: state.lastResult.audit.overallRiskScore,
        riskLevel: state.lastResult.audit.riskLevel,
        clauseCount: state.lastResult.audit.clauses.length,
        inferenceSource: state.lastResult.telemetry.inferenceSource,
        mode: state.lastResult.telemetry.mode,
        latencyMs: state.lastResult.telemetry.latencyMs,
        totalMasked: state.lastResult.telemetry.totalMasked,
        rawPiiBytesSent: state.lastResult.telemetry.rawPiiBytesSent,
        cloudModel: state.lastResult.telemetry.cloudModel,
      });
      const history = await fetchAuditHistoryFromFirestore(state.services.db);
      renderHistoryList(history);
      setStatusBanner("success", "Saved PII-free audit telemetry to Cloud Firestore.");
    } catch (err) {
      setStatusBanner("error", err?.message || "Failed to save audit log to Firestore.");
    } finally {
      dom.btnSaveFirestore.disabled = false;
    }
  });

  dom.btnLoadHistory.addEventListener("click", async () => {
    if (!state.services?.db) {
      setStatusBanner("info", "Configure Firebase credentials in the header to read Firestore logs.");
      return;
    }
    try {
      const history = await fetchAuditHistoryFromFirestore(state.services.db);
      renderHistoryList(history);
      setStatusBanner("info", `Loaded ${history.length} Firestore audit records.`);
    } catch (err) {
      setStatusBanner("error", err?.message || "Could not load Firestore audit logs.");
    }
  });

  dom.btnOpenConfig.addEventListener("click", openConfigModal);
  dom.btnCloseConfig.addEventListener("click", () => dom.configDialog.close());

  dom.configForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveStoredConfig({
      apiKey: dom.cfgApiKey.value,
      authDomain: dom.cfgAuthDomain.value,
      projectId: dom.cfgProjectId.value,
      appId: dom.cfgAppId.value,
      recaptchaSiteKey: dom.cfgRecaptchaKey.value,
      debugAppCheck: dom.cfgDebugAppCheck.value === "true",
    });
    dom.configDialog.close();
    await refreshEnvironmentStatus();
    setStatusBanner("success", "Firebase runtime configuration saved and initialized.");
  });

  dom.btnClearConfig.addEventListener("click", async () => {
    clearStoredConfig();
    dom.configDialog.close();
    await refreshEnvironmentStatus();
    setStatusBanner("info", "Cleared localStorage Firebase override.");
  });
}

async function init() {
  bindEvents();
  dom.contractInput.value = SAMPLE_CONTRACTS[0].text;
  updateRedactionPreview();
  await refreshEnvironmentStatus();
}

init();
