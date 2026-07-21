importScripts("lib/core.js");

const JOB_RECORDS_KEY = "appleCareersJobRecords";
const JOB_LOGS_KEY = "appleCareersDetailedJobLogs";
const SCAN_STATUS_KEY = "appleCareersScanStatus";
const PAGE_SETTLE_DELAY_MS = 1500;
const TAB_LOAD_TIMEOUT_MS = 25000;

const processedUrls = new Set();
const processedJobIds = new Set();
const storedIdentifiersAtScanStart = new Set();
const visitedListPages = new Set();
const ownedWorkflowTabIds = new Set();

let scanState = createIdleState();
let storedJobRecordsAtScanStart = {};

const scanStateReady = chrome.storage.local.get(SCAN_STATUS_KEY).then((stored) => {
  const savedState = stored[SCAN_STATUS_KEY];

  if (!savedState || typeof savedState !== "object") {
    return;
  }

  scanState = {
    ...createIdleState(),
    ...savedState,
    running: false,
    currentJob: savedState.running ? null : savedState.currentJob,
    phase: savedState.running ? "Stopped (extension restarted)" : savedState.phase
  };
});

async function saveScanState() {
  await chrome.storage.local.set({
    [SCAN_STATUS_KEY]: scanState
  });
}

async function updateScanState(updates) {
  scanState = {
    ...scanState,
    ...updates
  };

  await saveScanState();
}

function rememberRecent(record) {
  scanState.recent = [
    {
      jobId: record.jobId,
      site: record.site || null,
      siteLabel: record.siteLabel || getSiteLabel(record.site || record.url),
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
    compactFailure({
      ...failure,
      failedAt: new Date().toISOString()
    }),
    ...scanState.failures
  ].slice(0, 5);
}

function rememberError(error) {
  scanState.errors = [
    compactError({
      ...error,
      happenedAt: new Date().toISOString()
    }),
    ...scanState.errors
  ].slice(0, 50);
}

function rememberSkippedUnqualified(entry) {
  scanState.skippedUnqualified = [
    {
      jobId: entry.jobId || null,
      site: entry.site || getSiteConfig(entry.url)?.id || null,
      siteLabel: entry.siteLabel || getSiteLabel(entry.site || entry.url),
      title: truncateText(entry.title, 220),
      url: entry.url,
      reason: truncateText(entry.reason, 300),
      skippedAt: new Date().toISOString()
    },
    ...scanState.skippedUnqualified
  ].slice(0, 8);
}

async function recordAppliedCheckpoint(jobContext) {
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
  await saveScanState();
}

async function saveJobRecord(job, status) {
  const stored = await chrome.storage.local.get(JOB_RECORDS_KEY);
  const records = stored[JOB_RECORDS_KEY] || {};
  const key = job.jobId || job.url;
  const record = compactJobRecord(job, status);

  records[key] = record;
  const compactedRecords = Object.fromEntries(
    Object.entries(records)
      .map(([recordKey, storedRecord]) => [
        recordKey,
        compactJobRecord(storedRecord, storedRecord.status || "unknown")
      ])
      .sort(([, left], [, right]) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .slice(0, MAX_STORED_JOB_RECORDS)
  );

  try {
    await chrome.storage.local.set({
      [JOB_RECORDS_KEY]: compactedRecords
    });
  } catch (error) {
    if (!isStorageQuotaError(error)) {
      throw error;
    }

    const prunedRecords = Object.fromEntries(Object.entries(compactedRecords).slice(0, 30));
    await chrome.storage.local.set({
      [JOB_RECORDS_KEY]: prunedRecords
    });
  }

  rememberRecent(record);
}

async function compactStoredJobRecords() {
  const stored = await chrome.storage.local.get(JOB_RECORDS_KEY);
  const records = stored[JOB_RECORDS_KEY] || {};
  const compactedRecords = Object.fromEntries(
    Object.entries(records)
      .map(([recordKey, storedRecord]) => [
        recordKey,
        compactJobRecord(storedRecord, storedRecord.status || "unknown")
      ])
      .sort(([, left], [, right]) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .slice(0, MAX_STORED_JOB_RECORDS)
  );

  try {
    await chrome.storage.local.set({
      [JOB_RECORDS_KEY]: compactedRecords
    });
  } catch (error) {
    if (!isStorageQuotaError(error)) {
      throw error;
    }

    await chrome.storage.local.set({
      [JOB_RECORDS_KEY]: {}
    });
  }
}

async function loadStoredJobIdentifiers() {
  const stored = await chrome.storage.local.get(JOB_RECORDS_KEY);
  const records = stored[JOB_RECORDS_KEY] || {};
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

async function hydrateProcessedFromStorage() {
  const stored = await loadStoredJobIdentifiers();

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

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForTabComplete(tabId, timeoutMs = TAB_LOAD_TIMEOUT_MS) {
  const tab = await chrome.tabs.get(tabId);

  if (tab.status === "complete") {
    return tab;
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for tab to load."));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo, updatedTab) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }

      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(updatedTab);
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function getOpenTabIds() {
  const tabs = await chrome.tabs.query({});
  return new Set(tabs.map((tab) => tab.id).filter((id) => id !== undefined));
}

async function closeOwnedWorkflowTabs(options = {}) {
  const preserveTabIds = new Set((options.preserveTabIds || []).filter((id) => id !== undefined && id !== null));
  const tabIds = Array.from(ownedWorkflowTabIds).filter((tabId) => !preserveTabIds.has(tabId));

  for (const tabId of tabIds) {
    await chrome.tabs.remove(tabId).catch(() => {});
    ownedWorkflowTabIds.delete(tabId);
  }
}

async function closeInactiveApplicationTabs(siteConfig, options = {}) {
  const preserveTabIds = new Set((options.preserveTabIds || []).filter((id) => id !== undefined && id !== null));

  if (!siteConfig?.isApplicationUrl) {
    return;
  }

  const tabs = await chrome.tabs.query({});
  const staleTabs = tabs.filter((tab) => {
    const parsedUrl = parseUrl(tab.url);
    return (
      tab.id !== undefined &&
      !tab.active &&
      !preserveTabIds.has(tab.id) &&
      parsedUrl &&
      siteConfig.isSupportedUrl(parsedUrl) &&
      siteConfig.isApplicationUrl(parsedUrl)
    );
  });

  for (const tab of staleTabs) {
    await chrome.tabs.remove(tab.id).catch(() => {});
    ownedWorkflowTabIds.delete(tab.id);
  }
}

function tabMatchesApplication(tab, siteConfig, jobId) {
  const parsedUrl = parseUrl(tab?.url);

  if (!parsedUrl || !siteConfig?.isSupportedUrl(parsedUrl)) {
    return false;
  }

  if (siteConfig.isApplicationUrl?.(parsedUrl)) {
    return !jobId || parsedUrl.href.includes(jobId);
  }

  return false;
}

async function waitForApplicationTab(previousTabIds, siteConfig, jobId, timeoutMs = 8000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const tabs = await chrome.tabs.query({});
    const applicationTab = tabs.find(
      (tab) => !previousTabIds.has(tab.id) && tabMatchesApplication(tab, siteConfig, jobId)
    );

    if (applicationTab?.id) {
      await waitForTabComplete(applicationTab.id).catch(() => {});
      ownedWorkflowTabIds.add(applicationTab.id);
      return applicationTab;
    }

    await delay(300);
  }

  return null;
}

async function sendMessageWithFallback(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (_error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });

    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function collectLinksFromListTab() {
  const response = await sendMessageWithFallback(scanState.listTabId, {
    type: "APPLE_CAREERS_COLLECT_JOB_LINKS"
  });

  if (!response?.ok) {
    throw new Error("Could not collect job links from the list tab.");
  }

  return response.data;
}

async function advanceListPage() {
  const response = await sendMessageWithFallback(scanState.listTabId, {
    type: "APPLE_CAREERS_GO_TO_NEXT_PAGE"
  });

  if (!response?.ok) {
    return false;
  }

  if (response.action === "navigate") {
    await waitForTabComplete(scanState.listTabId);
  }

  await delay(PAGE_SETTLE_DELAY_MS * 2);

  return true;
}

async function scanJobLink(link) {
  let detailTab;
  const siteConfig = SITE_CONFIGS[link.site] || getSiteConfig(link.url);
  const site = siteConfig?.id || link.site || "unknown";
  const siteLabel = siteConfig?.label || link.siteLabel || getSiteLabel(link.url);

  try {
    await closeOwnedWorkflowTabs();
    if (scanState.userProfile?.scanMode === "auto_apply" && scanState.userProfile?.autoApplyConsent) {
      await closeInactiveApplicationTabs(siteConfig, {
        preserveTabIds: [scanState.listTabId]
      });
    }

    if (link.alreadyAppliedFromList) {
      await saveJobRecord(
        {
          site,
          siteLabel,
          jobId: link.jobId,
          title: link.title,
          url: link.url,
          decision: "Already submitted",
          reason: "List page shows this role has already been applied/submitted.",
          alreadySubmitted: true
        },
        "submitted"
      );
      incrementStatsForStatus(scanState.stats, "submitted");
      scanState.scanned += 1;
      await saveScanState();
      return;
    }

    const titleHardSkipReason = getHardSkipTitleReason(link.title);
    if (titleHardSkipReason) {
      await saveJobRecord(
        {
          site,
          siteLabel,
          jobId: link.jobId,
          title: link.title,
          url: link.url,
          decision: "Likely skip",
          reason: titleHardSkipReason
        },
        "likely_skip"
      );
      incrementStatsForStatus(scanState.stats, "likely_skip");
      scanState.scanned += 1;
      await saveScanState();
      return;
    }

    await updateScanState({
      phase: "Scanning job detail",
      currentJob: link,
      lastError: null
    });

    detailTab = await chrome.tabs.create({
      url: link.url,
      active: false
    });

    await waitForTabComplete(detailTab.id);
    await delay(PAGE_SETTLE_DELAY_MS);

    const response = await sendMessageWithFallback(detailTab.id, {
      type: "APPLE_CAREERS_EXTRACT_JOB",
      userYearsOfExperience: scanState.userProfile?.userYearsOfExperience,
      noMatchKeywords: scanState.userProfile?.noMatchKeywords
    });

    if (!response?.ok) {
      throw new Error("Could not extract the job detail page.");
    }

    let job = await applyLlmMatch(response.data, scanState.userProfile, { onError: rememberError });
    job = {
      ...job,
      site: job.site || site,
      siteLabel: job.siteLabel || siteLabel
    };
    job = applyRequiredYoeHardSkip(job, scanState.userProfile);
    const status = job.alreadySubmitted ? "submitted" : statusFromDecision(job.decision);
    let finalStatus = status;
    let applicationResult = null;
    let failureReason = null;
    let alreadyCheckpointed = false;

    if (shouldAutoApply(status, job, scanState.userProfile)) {
      await updateScanState({
        phase: "Auto-applying",
        currentJob: {
          ...link,
          decision: job.decision
        }
      });

      const workflowResponse = await runApplicationWorkflow(detailTab, {
        stopIfScanStopped: true,
        jobContext: {
          jobId: job.jobId,
          site: job.site,
          siteLabel: job.siteLabel,
          title: job.title,
          url: job.url
        }
      });
      applicationResult = workflowResponse.data || null;

      if (workflowResponse.ok && workflowResponse.data?.submitted) {
        finalStatus = "applied";
        alreadyCheckpointed = Boolean(workflowResponse.data?.checkpointed);

        if (!alreadyCheckpointed) {
          scanState.lastApplied = {
            jobId: job.jobId,
            site: job.site,
            siteLabel: job.siteLabel,
            title: job.title,
            url: job.url,
            appliedAt: new Date().toISOString()
          };
        }
      } else if (workflowResponse.ok && workflowResponse.data?.alreadySubmitted) {
        finalStatus = "submitted";
        job.errorType = workflowResponse.data.errorType || null;
      } else if (workflowResponse.ok && workflowResponse.data?.pausedForReview) {
        finalStatus = "needs_review";
        job.errorType = workflowResponse.data.errorType || "open_text_review_required";
        rememberError({
          type: job.errorType,
          errorType: job.errorType,
          jobId: job.jobId,
          site: job.site,
          siteLabel: job.siteLabel,
          title: job.title,
          url: workflowResponse.data.url || job.url,
          status: finalStatus,
          message: workflowResponse.data.summary,
          workflow: applicationResult,
          lastAttempt: applicationResult?.attempts?.at(-1) || null
        });
      } else {
        finalStatus = `${status}_apply_failed`;
        failureReason = workflowResponse.error || "Auto-apply workflow did not finish.";
        const errorType = classifyWorkflowError(failureReason, applicationResult);
        scanState.stats.errors += 1;
        scanState.lastError = failureReason;
        rememberError({
          type: errorType,
          errorType,
          jobId: job.jobId,
          site: job.site,
          siteLabel: job.siteLabel,
          title: job.title,
          url: job.url || link.url,
          status: finalStatus,
          message: failureReason,
          workflow: applicationResult,
          lastAttempt: applicationResult?.attempts?.at(-1) || null
        });
        rememberFailure({
          jobId: job.jobId,
          site: job.site,
          siteLabel: job.siteLabel,
          title: job.title,
          url: job.url,
          decision: job.decision,
          resumeMatch: job.resumeMatch,
          status: finalStatus,
          reason: failureReason,
          workflow: applicationResult
        });
        job.errorType = errorType;
      }
    }

    await saveJobRecord(
      {
        ...job,
        applicationResult,
        failureReason,
        errorType: job.errorType || null
      },
      finalStatus
    );
    if (!alreadyCheckpointed) {
      incrementStatsForStatus(scanState.stats, finalStatus);
    }

    scanState.scanned += 1;
    await saveScanState();
  } catch (error) {
    const message = error?.message || "Could not scan a job detail page.";
    scanState.stats.errors += 1;
    scanState.lastError = message;
    rememberError({
      type: "scan_job_failed",
      errorType: "scan_job_failed",
      jobId: link.jobId || "unknown",
      site,
      siteLabel,
      title: link.title,
      url: link.url || detailTab?.url || null,
      status: "error",
      message
    });
    await saveScanState();
  } finally {
    await closeOwnedWorkflowTabs();

    if (detailTab?.id) {
      await chrome.tabs.remove(detailTab.id).catch(() => {});
      ownedWorkflowTabIds.delete(detailTab.id);
    }

    scanState.currentJob = null;
    await saveScanState();
  }
}

async function scanCurrentApplicationPage(link) {
  const siteConfig = SITE_CONFIGS[link.site] || getSiteConfig(link.url);
  const site = siteConfig?.id || link.site || "unknown";
  const siteLabel = siteConfig?.label || link.siteLabel || getSiteLabel(link.url);
  let job = {
    site,
    siteLabel,
    jobId: link.jobId,
    title: link.title,
    url: link.url,
    decision: "Review",
    reason: "Started from the current job/application page.",
    matchSource: "current_page"
  };
  let finalStatus = "review";
  let applicationResult = null;
  let failureReason = null;
  let alreadyCheckpointed = false;

  try {
    await updateScanState({
      phase: "Running current application page",
      currentJob: link,
      lastError: null
    });

    const response = await sendMessageWithFallback(scanState.listTabId, {
      type: "APPLE_CAREERS_EXTRACT_JOB",
      userYearsOfExperience: scanState.userProfile?.userYearsOfExperience,
      noMatchKeywords: scanState.userProfile?.noMatchKeywords
    }).catch(() => null);

    if (response?.ok) {
      job = {
        ...response.data,
        site: response.data.site || site,
        siteLabel: response.data.siteLabel || siteLabel,
        decision: response.data.decision || "Review",
        reason: response.data.reason || "Started from the current job/application page.",
        matchSource: response.data.matchSource || "current_page"
      };
    }

    if (scanState.userProfile?.scanMode !== "auto_apply" || !scanState.userProfile?.autoApplyConsent) {
      await saveJobRecord(job, finalStatus);
      incrementStatsForStatus(scanState.stats, finalStatus);
      scanState.scanned += 1;
      await saveScanState();
      return;
    }

    const workflowResponse = await runApplicationWorkflow(
      { id: scanState.listTabId },
      {
        closeOnDone: false,
        stopIfScanStopped: true,
        jobContext: {
          jobId: job.jobId,
          site: job.site,
          siteLabel: job.siteLabel,
          title: job.title,
          url: job.url
        }
      }
    );
    applicationResult = workflowResponse.data || null;

    if (workflowResponse.ok && workflowResponse.data?.submitted) {
      finalStatus = "applied";
      alreadyCheckpointed = Boolean(workflowResponse.data?.checkpointed);

      if (!alreadyCheckpointed) {
        scanState.lastApplied = {
          jobId: job.jobId,
          site: job.site,
          siteLabel: job.siteLabel,
          title: job.title,
          url: job.url,
          appliedAt: new Date().toISOString()
        };
      }
    } else if (workflowResponse.ok && workflowResponse.data?.alreadySubmitted) {
      finalStatus = "submitted";
      job.errorType = workflowResponse.data.errorType || null;
    } else if (workflowResponse.ok && workflowResponse.data?.pausedForReview) {
      finalStatus = "needs_review";
      job.errorType = workflowResponse.data.errorType || "open_text_review_required";
      rememberError({
        type: job.errorType,
        errorType: job.errorType,
        jobId: job.jobId,
        site: job.site,
        siteLabel: job.siteLabel,
        title: job.title,
        url: workflowResponse.data.url || job.url,
        status: finalStatus,
        message: workflowResponse.data.summary,
        workflow: applicationResult,
        lastAttempt: applicationResult?.attempts?.at(-1) || null
      });
    } else {
      finalStatus = "review_apply_failed";
      failureReason = workflowResponse.error || "Current application page workflow did not finish.";
      const errorType = classifyWorkflowError(failureReason, applicationResult);
      scanState.stats.errors += 1;
      scanState.lastError = failureReason;
      rememberError({
        type: errorType,
        errorType,
        jobId: job.jobId,
        site: job.site,
        siteLabel: job.siteLabel,
        title: job.title,
        url: job.url,
        status: finalStatus,
        message: failureReason,
        workflow: applicationResult,
        lastAttempt: applicationResult?.attempts?.at(-1) || null
      });
      job.errorType = errorType;
    }

    await saveJobRecord(
      {
        ...job,
        applicationResult,
        failureReason,
        errorType: job.errorType || null
      },
      finalStatus
    );
    if (!alreadyCheckpointed) {
      incrementStatsForStatus(scanState.stats, finalStatus);
    }
    scanState.scanned += 1;
    await saveScanState();
  } catch (error) {
    const message = error?.message || "Could not run workflow on the current application page.";
    scanState.stats.errors += 1;
    scanState.lastError = message;
    rememberError({
      type: "current_page_scan_failed",
      errorType: "current_page_scan_failed",
      jobId: job.jobId || link.jobId || "unknown",
      site,
      siteLabel,
      title: job.title || link.title,
      url: job.url || link.url,
      status: "error",
      message,
      workflow: applicationResult,
      lastAttempt: applicationResult?.attempts?.at(-1) || null
    });
    await saveScanState();
  } finally {
    scanState.currentJob = null;
    await saveScanState();
  }
}

async function runScanLoop() {
  try {
    while (scanState.running) {
      await updateScanState({
        phase: "Collecting job links"
      });

      const collection = await collectLinksFromListTab();
      const newLinks = [];
      let skippedStored = 0;
      let skippedUnqualified = 0;

      for (const link of collection.links) {
        if (isLinkProcessed(link)) {
          if (wasStoredBeforeScan(link)) {
            skippedStored += 1;

            const priorRecord = getStoredJobRecord(link);
            if (isUnqualifiedRecord(priorRecord)) {
              skippedUnqualified += 1;
              rememberSkippedUnqualified({
                jobId: link.jobId || priorRecord.jobId,
                site: link.site || priorRecord.site,
                siteLabel: link.siteLabel || priorRecord.siteLabel,
                title: link.title || priorRecord.title,
                url: link.url || priorRecord.url,
                reason: priorRecord.reason || priorRecord.failureReason
              });
            }
          }
          continue;
        }

        newLinks.push(link);
      }

      scanState.stats.skippedStored += skippedStored;
      scanState.stats.skippedUnqualified += skippedUnqualified;
      const hasAlreadyVisitedListPage = visitedListPages.has(collection.url);

      scanState.listPageUrl = collection.url;
      scanState.site = collection.site || scanState.site;
      scanState.siteLabel = collection.siteLabel || scanState.siteLabel;
      scanState.pageCount = collection.currentPage || scanState.pageCount;
      scanState.currentPageStats = collection.listStats || null;
      scanState.queued = newLinks.length;
      await saveScanState();

      if (newLinks.length === 0 && collection.currentJob) {
        await scanCurrentApplicationPage(collection.currentJob);
        await updateScanState({
          running: false,
          phase: "Complete",
          queued: 0,
          currentJob: null,
          completedAt: new Date().toISOString()
        });
        break;
      }

      if (newLinks.length === 0 && hasAlreadyVisitedListPage) {
        await updateScanState({
          running: false,
          phase: "Complete",
          queued: 0,
          currentJob: null,
          completedAt: new Date().toISOString()
        });
        break;
      }

      for (const link of newLinks) {
        if (!scanState.running) {
          break;
        }

        markLinkProcessed(link);
        scanState.queued = Math.max(0, scanState.queued - 1);
        await scanJobLink(link);
      }

      visitedListPages.add(collection.url);

      if (!scanState.running) {
        break;
      }

      if (!collection.hasNextPage) {
        await updateScanState({
          running: false,
          phase: "Complete",
          queued: 0,
          currentJob: null,
          completedAt: new Date().toISOString()
        });
        break;
      }

      await updateScanState({
        phase:
          newLinks.length === 0
            ? `Skipping page ${scanState.pageCount} (already scanned)`
            : "Advancing to next page",
        queued: 0
      });

      const advanced = await advanceListPage();

      if (!advanced) {
        await updateScanState({
          running: false,
          phase: "Complete",
          lastError: "Reached the end of the job list.",
          completedAt: new Date().toISOString()
        });
        break;
      }
    }
  } catch (error) {
    const message = error?.message || "The scan stopped unexpectedly.";
    await updateScanState({
      running: false,
      phase: "Stopped with error",
      lastError: message,
      completedAt: new Date().toISOString()
    });
    rememberError({
      type: "scan_loop_failed",
      errorType: "scan_loop_failed",
      site: scanState.site,
      siteLabel: scanState.siteLabel,
      status: "error",
      message
    });
    await saveScanState();
  }

  await closeOwnedWorkflowTabs();
}

async function startScan(tab, userProfile) {
  if (scanState.running) {
    return {
      ok: false,
      error: "A scan is already running."
    };
  }

  const siteConfig = getSiteConfig(tab?.url);

  if (!tab?.id || !siteConfig) {
    return {
      ok: false,
      error: "Open an Apple, TikTok, or ByteDance careers list page before starting a scan."
    };
  }

  const normalizedProfile = normalizeUserProfile(userProfile);

  await closeOwnedWorkflowTabs();
  await compactStoredJobRecords();

  processedUrls.clear();
  processedJobIds.clear();
  storedIdentifiersAtScanStart.clear();
  visitedListPages.clear();
  await hydrateProcessedFromStorage();
  scanState = {
    ...createIdleState(),
    running: true,
    phase: "Starting scan",
    listTabId: tab.id,
    listPageUrl: tab.url,
    site: siteConfig.id,
    siteLabel: siteConfig.label,
    pageCount: 1,
    userProfile: normalizedProfile
  };

  await saveScanState();
  runScanLoop();

  return {
    ok: true,
    status: scanState
  };
}

async function stopScan() {
  await closeOwnedWorkflowTabs();

  await updateScanState({
    running: false,
    phase: "Stopped",
    currentJob: null,
    completedAt: new Date().toISOString()
  });

  return {
    ok: true,
    status: scanState
  };
}

async function clearHistory() {
  if (scanState.running) {
    return {
      ok: false,
      error: "Stop the scan before clearing history."
    };
  }

  const userProfile = scanState.userProfile;
  processedUrls.clear();
  processedJobIds.clear();
  storedIdentifiersAtScanStart.clear();
  storedJobRecordsAtScanStart = {};
  visitedListPages.clear();
  scanState = {
    ...createIdleState(),
    userProfile
  };

  await chrome.storage.local.remove([JOB_RECORDS_KEY, JOB_LOGS_KEY]);
  await saveScanState();

  return {
    ok: true,
    status: scanState
  };
}

async function runApplicationWorkflow(tab, options = {}) {
  const closeOnDone = options.closeOnDone !== false;
  const stopIfScanStopped = Boolean(options.stopIfScanStopped);
  const jobContext = options.jobContext || null;
  const originalWorkflowTabId = tab?.id;
  let workflowTabId = tab?.id;

  if (!workflowTabId) {
    return {
      ok: false,
      error: "No job tab was available for the application workflow."
    };
  }

  const liveTab = await chrome.tabs.get(workflowTabId).catch(() => null);

  const siteConfig = getSiteConfig(liveTab?.url);
  const jobId = liveTab?.url ? getJobIdFromUrl(liveTab.url) : null;

  if (!siteConfig) {
    return {
      ok: false,
      error: `Expected an Apple, TikTok, or ByteDance careers job/application tab, but the current tab URL is ${liveTab?.url || "unknown"}.`
    };
  }

  const steps = [];
  const attempts = [];
  const cleanupWorkflowTabs = async () => {
    if (!closeOnDone) {
      return;
    }

    await closeOwnedWorkflowTabs({
      preserveTabIds: [originalWorkflowTabId]
    });
  };

  try {
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      if (stopIfScanStopped && !scanState.running) {
        return {
          ok: false,
          error: "Scan stopped.",
          data: {
            submitted: false,
            errorType: "stopped_by_user",
            attempts,
            steps,
            summary: "Scan was stopped; leaving the current application step as-is."
          }
        };
      }

      await waitForTabComplete(workflowTabId).catch(() => {});
      await delay(PAGE_SETTLE_DELAY_MS);

      const previousTabIds = await getOpenTabIds();
      const response = await sendMessageWithFallback(workflowTabId, {
        type: "APPLE_CAREERS_RUN_APPLICATION_WORKFLOW_STEP"
      });

      if (!response?.ok) {
        throw new Error(response?.error || "The application workflow step failed.");
      }

      attempts.push({
        attempt,
        url: response.data.url,
        title: response.data.title,
        heading: response.data.heading,
        summary: response.data.summary,
        errorType: response.data.errorType || null,
        visibleActions: response.data.visibleActions || []
      });

      steps.push(
        ...response.data.steps.map((step) => ({
          ...step,
          attempt
        }))
      );

      const openedApplication =
        response.data.clicked &&
        response.data.steps.some(
          (step) => step.step === "Open application flow" && step.status === "clicked"
        );

      if (openedApplication) {
        const applicationTab = await waitForApplicationTab(previousTabIds, siteConfig, jobId);
        if (applicationTab?.id) {
          workflowTabId = applicationTab.id;
          attempts.push({
            attempt,
            url: applicationTab.url,
            title: applicationTab.title,
            heading: "",
            summary: "Detected newly opened application tab.",
            visibleActions: []
          });
        }
      }

      if (response.data.done) {
        const isFreshSubmission = !response.data.alreadySubmitted;

        if (isFreshSubmission && jobContext) {
          await recordAppliedCheckpoint(jobContext);
        }

        await delay(2500);
        if (closeOnDone) {
          await chrome.tabs.remove(workflowTabId).catch(() => {});
          ownedWorkflowTabIds.delete(workflowTabId);
        }

        if (response.data.alreadySubmitted) {
          return {
            ok: true,
            data: {
              submitted: false,
              alreadySubmitted: true,
              errorType: response.data.errorType || "already_applied",
              attempts,
              steps,
              summary: closeOnDone
                ? "Job was already submitted and the job tab was closed."
                : "Job was already submitted."
            }
          };
        }

        return {
          ok: true,
          data: {
            submitted: true,
            checkpointed: isFreshSubmission && Boolean(jobContext),
            attempts,
            steps,
            summary: closeOnDone ? "Application submitted and the job tab was closed." : "Application submitted."
          }
        };
      }

      if (response.data.pausedForReview) {
        // Leave the tab open (skip cleanupWorkflowTabs) so the user can see the drafted answer
        // live and submit it themselves -- unlike every other exit path here, this is not a failure.
        return {
          ok: true,
          data: {
            submitted: false,
            pausedForReview: true,
            errorType: response.data.errorType || "open_text_review_required",
            url: response.data.url,
            attempts,
            steps,
            summary: response.data.summary
          }
        };
      }

      if (!response.data.clicked) {
        await cleanupWorkflowTabs();
        return {
          ok: false,
          error: response.data.summary || "The workflow could not find the next action.",
          data: {
            submitted: false,
            errorType: response.data.errorType || classifyWorkflowError(response.data.summary, { attempts, steps }),
            summary: response.data.summary,
            attempts,
            steps
          }
        };
      }
    }

    await cleanupWorkflowTabs();
    return {
      ok: false,
      error: "The workflow hit the maximum number of steps before submission.",
      data: {
        submitted: false,
        errorType: "workflow_timeout",
        summary: "The workflow hit the maximum number of steps before submission.",
        attempts,
        steps
      }
    };
  } catch (error) {
    await cleanupWorkflowTabs();
    throw error;
  }
}

const RECOGNIZED_MESSAGE_TYPES = new Set([
  "APPLE_CAREERS_START_SCAN",
  "APPLE_CAREERS_STOP_SCAN",
  "APPLE_CAREERS_CLEAR_HISTORY",
  "APPLE_CAREERS_GET_SCAN_STATUS",
  "APPLE_CAREERS_RUN_APPLICATION_WORKFLOW",
  "APPLE_CAREERS_GENERATE_ANSWER"
]);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!RECOGNIZED_MESSAGE_TYPES.has(message?.type)) {
    return false;
  }

  scanStateReady.then(async () => {
    try {
      if (message.type === "APPLE_CAREERS_START_SCAN") {
        sendResponse(await startScan(message.tab, message.userProfile));
      } else if (message.type === "APPLE_CAREERS_STOP_SCAN") {
        sendResponse(await stopScan());
      } else if (message.type === "APPLE_CAREERS_CLEAR_HISTORY") {
        sendResponse(await clearHistory());
      } else if (message.type === "APPLE_CAREERS_GET_SCAN_STATUS") {
        sendResponse({
          ok: true,
          status: scanState
        });
      } else if (message.type === "APPLE_CAREERS_RUN_APPLICATION_WORKFLOW") {
        sendResponse(await runApplicationWorkflow(message.tab));
      } else if (message.type === "APPLE_CAREERS_GENERATE_ANSWER") {
        const stored = await chrome.storage.local.get(JOB_RECORDS_KEY);
        const job = (stored[JOB_RECORDS_KEY] || {})[message.jobId] || null;
        sendResponse(
          await generateFreeTextAnswer({
            questionText: message.questionText,
            job,
            userProfile: scanState.userProfile
          })
        );
      }
    } catch (error) {
      sendResponse({
        ok: false,
        error: error?.message || "The request failed."
      });
    }
  });

  return true;
});
