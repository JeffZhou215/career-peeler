// JSON-file persistence for the CLI, replacing chrome.storage.local. Deliberately a separate,
// standalone history from the extension's chrome.storage (per user's explicit choice) -- simplest
// to reason about, no cross-process sync. Mirrors background.js's scanState/job-record shapes via
// lib/core.js so both surfaces produce structurally identical data, just stored differently.
const fs = require("fs");
const path = require("path");
const os = require("os");
const core = require("../lib/core.js");

function defaultDataDir() {
  return process.env.CAREER_PEELER_DATA_DIR || path.join(os.homedir(), ".career-peeler");
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

function writeJsonFileAtomic(filePath, data) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
}

function createStore(dataDir = defaultDataDir()) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, "browser-profile"), { recursive: true });

  const paths = {
    scanState: path.join(dataDir, "scan-state.json"),
    jobRecords: path.join(dataDir, "job-records.json"),
    profile: path.join(dataDir, "profile.json"),
    browserProfile: path.join(dataDir, "browser-profile")
  };

  let scanState = readJsonFile(paths.scanState, core.createIdleState());
  const processedUrls = new Set();
  const processedJobIds = new Set();
  const storedIdentifiersAtScanStart = new Set();
  const visitedListPages = new Set();
  let storedJobRecordsAtScanStart = {};

  function saveScanState() {
    writeJsonFileAtomic(paths.scanState, scanState);
  }

  function updateScanState(updates) {
    scanState = { ...scanState, ...updates };
    saveScanState();
  }

  function getProfile() {
    return core.normalizeUserProfile(readJsonFile(paths.profile, {}));
  }

  function saveProfile(profile) {
    const normalized = core.normalizeUserProfile(profile);
    writeJsonFileAtomic(paths.profile, normalized);
    return normalized;
  }

  function getJobRecords() {
    return readJsonFile(paths.jobRecords, {});
  }

  function getJobRecord(jobId) {
    if (!jobId) {
      return null;
    }
    return getJobRecords()[jobId] || null;
  }

  function compactAndWriteRecords(records) {
    const compactedRecords = Object.fromEntries(
      Object.entries(records)
        .map(([recordKey, storedRecord]) => [
          recordKey,
          core.compactJobRecord(storedRecord, storedRecord.status || "unknown")
        ])
        .sort(([, left], [, right]) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
        .slice(0, core.MAX_STORED_JOB_RECORDS)
    );
    writeJsonFileAtomic(paths.jobRecords, compactedRecords);
    return compactedRecords;
  }

  function rememberRecent(record) {
    scanState.recent = [
      {
        jobId: record.jobId,
        site: record.site || null,
        siteLabel: record.siteLabel || core.getSiteLabel(record.site || record.url),
        title: record.title,
        status: record.status,
        decision: record.decision,
        url: record.url,
        matchSource: record.matchSource || "local",
        llmMatch: record.llmMatch || null,
        failureReason: record.failureReason || null
      },
      ...scanState.recent
    ].slice(0, 8);
  }

  function rememberFailure(failure) {
    scanState.failures = [
      core.compactFailure({ ...failure, failedAt: new Date().toISOString() }),
      ...scanState.failures
    ].slice(0, 5);
  }

  function rememberError(error) {
    scanState.errors = [
      core.compactError({ ...error, happenedAt: new Date().toISOString() }),
      ...scanState.errors
    ].slice(0, 50);
  }

  function rememberSkippedUnqualified(entry) {
    scanState.skippedUnqualified = [
      {
        jobId: entry.jobId || null,
        site: entry.site || core.getSiteConfig(entry.url)?.id || null,
        siteLabel: entry.siteLabel || core.getSiteLabel(entry.site || entry.url),
        title: core.truncateText(entry.title, 220),
        url: entry.url,
        reason: core.truncateText(entry.reason, 300),
        skippedAt: new Date().toISOString()
      },
      ...scanState.skippedUnqualified
    ].slice(0, 8);
  }

  function recordAppliedCheckpoint(jobContext) {
    if (!jobContext) {
      return;
    }

    scanState.lastApplied = {
      jobId: jobContext.jobId,
      site: jobContext.site,
      siteLabel: jobContext.siteLabel,
      title: jobContext.title,
      url: jobContext.url,
      appliedAt: new Date().toISOString()
    };
    scanState.stats.applied += 1;
    saveScanState();
  }

  function saveJobRecord(job, status) {
    const records = getJobRecords();
    const key = job.jobId || job.url;
    records[key] = core.compactJobRecord(job, status);
    compactAndWriteRecords(records);
    rememberRecent(records[key]);
  }

  function compactStoredJobRecords() {
    compactAndWriteRecords(getJobRecords());
  }

  function loadStoredJobIdentifiers() {
    const records = getJobRecords();
    const urls = new Set();
    const jobIds = new Set();

    for (const [key, record] of Object.entries(records)) {
      if (record?.url) {
        urls.add(record.url);
      }

      if (record?.jobId) {
        jobIds.add(record.jobId);
      } else if (key && !/^https?:\/\//i.test(key)) {
        jobIds.add(key);
      }
    }

    return { urls, jobIds, records };
  }

  function isLinkProcessed(link) {
    return processedUrls.has(link.url) || (link.jobId ? processedJobIds.has(link.jobId) : false);
  }

  function markLinkProcessed(link) {
    processedUrls.add(link.url);

    if (link.jobId) {
      processedJobIds.add(link.jobId);
    }
  }

  function wasStoredBeforeScan(link) {
    return storedIdentifiersAtScanStart.has(link.url) || (link.jobId ? storedIdentifiersAtScanStart.has(link.jobId) : false);
  }

  function getStoredJobRecord(link) {
    if (link.jobId && storedJobRecordsAtScanStart[link.jobId]) {
      return storedJobRecordsAtScanStart[link.jobId];
    }

    if (link.url && storedJobRecordsAtScanStart[link.url]) {
      return storedJobRecordsAtScanStart[link.url];
    }

    return null;
  }

  function isUnqualifiedRecord(record) {
    return record?.decision === "Likely skip" || record?.status === "likely_skip";
  }

  function hydrateProcessedFromStorage() {
    const stored = loadStoredJobIdentifiers();

    storedIdentifiersAtScanStart.clear();
    storedJobRecordsAtScanStart = stored.records || {};

    for (const url of stored.urls) {
      processedUrls.add(url);
      storedIdentifiersAtScanStart.add(url);
    }

    for (const jobId of stored.jobIds) {
      processedJobIds.add(jobId);
      storedIdentifiersAtScanStart.add(jobId);
    }

    return stored;
  }

  function resetProcessedTracking() {
    processedUrls.clear();
    processedJobIds.clear();
    storedIdentifiersAtScanStart.clear();
    visitedListPages.clear();
  }

  function clearHistory() {
    if (scanState.running) {
      return { ok: false, error: "Stop the scan before clearing history." };
    }

    const profile = scanState.userProfile;
    resetProcessedTracking();
    storedJobRecordsAtScanStart = {};
    scanState = { ...core.createIdleState(), userProfile: profile };

    fs.rmSync(paths.jobRecords, { force: true });
    saveScanState();

    return { ok: true, status: scanState };
  }

  return {
    paths,
    saveScanState,
    updateScanState,
    getProfile,
    saveProfile,
    getJobRecords,
    getJobRecord,
    rememberRecent,
    rememberFailure,
    rememberError,
    rememberSkippedUnqualified,
    recordAppliedCheckpoint,
    saveJobRecord,
    compactStoredJobRecords,
    loadStoredJobIdentifiers,
    isLinkProcessed,
    markLinkProcessed,
    wasStoredBeforeScan,
    getStoredJobRecord,
    isUnqualifiedRecord,
    hydrateProcessedFromStorage,
    resetProcessedTracking,
    clearHistory,
    visitedListPages,
    set scanState(value) {
      scanState = value;
    },
    get scanState() {
      return scanState;
    }
  };
}

module.exports = { createStore, defaultDataDir };
