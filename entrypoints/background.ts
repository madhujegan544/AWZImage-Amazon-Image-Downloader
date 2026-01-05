import JSZip from 'jszip';

export default defineBackground(() => {
  console.log('AMZImage Background Loaded', { id: browser.runtime.id });

  // Handle extension icon click to toggle panel
  browser.action.onClicked.addListener(async (tab) => {
    if (tab.id) {
      try {
        await browser.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' });
      } catch (error) {
        console.error('Failed to toggle panel:', error);
      }
    }
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
