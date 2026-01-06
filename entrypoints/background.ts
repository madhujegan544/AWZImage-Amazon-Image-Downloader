import JSZip from 'jszip';

export default defineBackground(() => {
  console.log('AMZImage Background Loaded', { id: browser.runtime.id });

  // Track last known state per tab for smarter refresh decisions
  const tabStates = new Map<number, { url: string; asin: string | null; timestamp: number }>();

  // Helper to extract ASIN from URL
  function extractAsin(url: string): string | null {
    const match = url.match(/\/dp\/([A-Z0-9]{10})/i) ||
      url.match(/\/gp\/product\/([A-Z0-9]{10})/i);
    return match ? match[1] : null;
  }

  // Configure side panel behavior
  if (browser.sidePanel && browser.sidePanel.setPanelBehavior) {
    browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: unknown) => console.error("AMZImage: Failed to set panel behavior:", error));
  } else {
    // Fallback: If setPanelBehavior is not supported, try manual open on click
    browser.action.onClicked.addListener((tab) => {
      if (tab.windowId && browser.sidePanel && browser.sidePanel.open) {
        browser.sidePanel.open({ windowId: tab.windowId })
          .catch((error: unknown) => console.error("AMZImage: Failed to open panel:", error));
      }
    });
  }

  // Listen for tab updates to trigger automatic refresh on navigation/variant change
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = tab.url || changeInfo.url || '';

    // Only process Amazon pages
    if (!url.includes('amazon.') && !url.includes('amzn.')) {
      return;
    }

    const currentAsin = extractAsin(url);
    const prevState = tabStates.get(tabId);
    const now = Date.now();

    // Determine if we should trigger a refresh
    let shouldRefresh = false;
    let reason = '';

    if (changeInfo.url) {
      // URL changed - check if it's a different product
      if (!prevState || prevState.url !== url) {
        shouldRefresh = true;
        reason = 'url_changed';
      }
      // Check if ASIN changed (navigated to different product)
      if (prevState && currentAsin && prevState.asin !== currentAsin) {
        shouldRefresh = true;
        reason = 'product_changed';
      }
    }

    if (changeInfo.status === 'complete') {
      // Page finished loading - always refresh to catch dynamically loaded content
      shouldRefresh = true;
      reason = reason || 'page_loaded';
    }

    // Update state
    if (shouldRefresh || changeInfo.url) {
      tabStates.set(tabId, {
        url,
        asin: currentAsin,
        timestamp: now
      });
    }

    // Send refresh message to side panel
    if (shouldRefresh) {
      // Small delay for page_loaded to ensure DOM is ready
      const delay = reason === 'page_loaded' ? 300 : 0;

      setTimeout(() => {
        browser.runtime.sendMessage({
          type: 'AUTO_REFRESH',
          tabId,
          status: changeInfo.status,
          reason,
          asin: currentAsin
        }).catch(() => {
          // Ignore errors if side panel is closed or not listening
        });
      }, delay);
    }
  });

  // Clean up state when tab is closed
  browser.tabs.onRemoved.addListener((tabId) => {
    tabStates.delete(tabId);
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'DOWNLOAD_ZIP') {
      // Create ZIP and return base64 data to content script for download
      createZipData(message.urls, message.filename)
        .then((result) => sendResponse(result))
        .catch((err) => {
          console.error(err);
          sendResponse({ success: false, error: err.message });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === 'DOWNLOAD_SINGLE') {
      browser.downloads.download({
        url: message.url,
        filename: message.filename,
      });
      return true;
    }

    if (message.type === 'TRIGGER_DOWNLOAD') {
      // Direct download trigger from content script
      browser.downloads.download({
        url: message.dataUrl,
        filename: message.filename,
      }).then(() => {
        sendResponse({ success: true });
      }).catch((err) => {
        console.error('Download failed:', err);
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
  });
});

// Create ZIP and return base64 data (no blob URL creation here)
async function createZipData(urls: string[], zipName: string): Promise<{ success: boolean; base64?: string; filename?: string; error?: string }> {
  const zip = new JSZip();
  const folder = zip.folder('images');

  let downloadedCount = 0;
  const fetchPromises = urls.map(async (url, index) => {
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) throw new Error(`Failed to fetch ${url}`);
      const blob = await response.blob();

      // Determine file extension
      let extension = 'jpg';
      const urlParts = url.split('.');
      if (urlParts.length > 1) {
        const ext = urlParts.pop()?.split('?')[0]?.toLowerCase();
        if (ext && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm'].includes(ext)) {
          extension = ext;
        }
      }

      // Name based on type
      const isVideo = ['mp4', 'webm'].includes(extension);
      const fileName = isVideo ? `video-${index + 1}.${extension}` : `image-${index + 1}.${extension}`;
      folder?.file(fileName, blob);
      downloadedCount++;
    } catch (e) {
      console.error(`Error fetching ${url}:`, e);
    }
  });

  await Promise.all(fetchPromises);

  if (downloadedCount === 0) {
    return { success: false, error: 'No files could be downloaded' };
  }

  // Generate ZIP as base64 string (avoid blob URL in service worker)
  const base64Content = await zip.generateAsync({ type: 'base64' });

  return {
    success: true,
    base64: base64Content,
    filename: `${zipName}.zip`
  };
}
