import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import PanelApp from '../../components/PanelApp';
import '../../components/App.css';

// Ensure styles are injected for full height
const style = document.createElement('style');
style.textContent = `
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    background: #F6F7FB;
  }
  #root {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
`;
document.head.appendChild(style);

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

const root = createRoot(container);

// Scrape product data from content script
const scrapeData = async () => {
    try {
        const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab?.id) throw new Error('No active tab');

        const response = await browser.tabs.sendMessage(tab.id, { type: 'GET_FULL_DATA' });
        if (!response) throw new Error('No data received');
        return response;
    } catch (e) {
        console.error('Data scraping error:', e);
        throw e;
    }
};

// Download ZIP of files
const downloadZip = async (urls: string[], filename: string) => {
    try {
        const response = await browser.runtime.sendMessage({
            type: 'DOWNLOAD_ZIP',
            urls,
            filename
        });

        if (response?.success && response?.base64) {
            const byteCharacters = atob(response.base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'application/zip' });
            const blobUrl = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = response.filename || `${filename}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        } else {
            throw new Error(response?.error || 'Failed to create ZIP');
        }
    } catch (e) {
        console.error('Download failed:', e);
        throw e;
    }
};

// Show preview on the Amazon page (integrated preview overlay)
const showPreview = async (url: string, mediaType: 'image' | 'video', allUrls: string[]) => {
    try {
        const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab?.id) throw new Error('No active tab');

        await browser.tabs.sendMessage(tab.id, {
            type: 'SHOW_PREVIEW',
            url,
            mediaType,
            urls: allUrls
        });
    } catch (e) {
        console.error('Preview error:', e);
    }
};

// Select a variant on the Amazon page
const selectVariant = async (asin: string) => {
    try {
        const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab?.id) throw new Error('No active tab');

        const response = await browser.tabs.sendMessage(tab.id, {
            type: 'SELECT_VARIANT',
            asin
        });

        return response?.success || false;
    } catch (e) {
        console.error('Variant selection error:', e);
        return false;
    }
};

root.render(
    <StrictMode>
        <PanelApp
            onClose={() => console.log('Close requested')}
            scrapeProductData={scrapeData}
            downloadZip={downloadZip}
            showPreview={showPreview}
            selectVariant={selectVariant}
        />
    </StrictMode>
);
