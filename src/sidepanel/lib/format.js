export function isSupportedCareersUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return (
      parsedUrl.origin === "https://jobs.apple.com" ||
      (parsedUrl.origin === "https://www.apple.com" && /^\/careers(?:\/|$)/i.test(parsedUrl.pathname)) ||
      ["careers.tiktok.com", "lifeattiktok.com", "jobs.bytedance.com", "careers.bytedance.com"].includes(
        parsedUrl.hostname
      )
    );
  } catch (_error) {
    return false;
  }
}

export function cleanJobTitle(title) {
  return (title || "Untitled job")
    .replace(/\s+-\s+Jobs\s+-\s+Careers at Apple\.?$/i, "")
    .replace(/\s+-\s+Careers at Apple\.?$/i, "")
    .replace(/\s*[>›»]\s*$/u, "")
    .trim();
}

export function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return "";
  }

  const elapsedMs = Date.now() - new Date(timestamp).getTime();
  const elapsedSeconds = Math.max(0, Math.round(elapsedMs / 1000));

  if (elapsedSeconds < 60) {
    return "just now";
  }

  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} ago`;
  }

  const elapsedHours = Math.round(elapsedMinutes / 60);
  return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"} ago`;
}

export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab;
}

export async function sendMessageWithFallback(tabId, message) {
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
