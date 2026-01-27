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
const scrapeData = async (triggerScroll: boolean = false) => {
    try {
        // Robust tab finding
        let tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0 || !tabs[0].id) {
            tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
        }

        let tab = tabs.find(t => t.url && (t.url.includes('.amazon.') || t.url.includes('/dp/')));
        if (!tab) {
            const amazonTabs = await browser.tabs.query({ url: "*://*.amazon.*/*" });
            tab = amazonTabs.find(t => t.active) || amazonTabs[0];
        }

        if (!tab?.id) throw new Error('No active tab');

        const response = await browser.tabs.sendMessage(tab.id, {
            type: 'GET_FULL_DATA',
            triggerScroll
        });
        if (!response) throw new Error('No data received');
        return response;
    } catch (e: any) {
        // Don't log expected errors when polling (tab closed, refreshing, etc.)
        const msg = e?.message || '';
        const isExpected = msg.includes('No active tab') ||
            msg.includes('Could not establish connection') ||
            msg.includes('Receiving end does not exist');
        if (!isExpected) {
            console.error('Data scraping error:', e);
        }
        throw e;
    }
};

// Download ZIP of files
const downloadZip = async (items: (string | { url: string; filename: string })[], filename: string) => {
    try {
        const response = await browser.runtime.sendMessage({
            type: 'DOWNLOAD_ZIP',
            urls: items,
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
        // Robust tab finding
        let tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0 || !tabs[0].id) {
            tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
        }

        let tab = tabs.find(t => t.url && (t.url.includes('.amazon.') || t.url.includes('/dp/')));
        if (!tab) {
            const amazonTabs = await browser.tabs.query({ url: "*://*.amazon.*/*" });
            tab = amazonTabs.find(t => t.active) || amazonTabs[0];
        }

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
        // Robust tab finding:
        // 1. Try active tab in current window (standard)
        // 2. Try active tab in ANY window (last focused)
        // 3. Fallback: Find ANY Amazon tab
        let tabs = await browser.tabs.query({ active: true, currentWindow: true });

        if (tabs.length === 0 || !tabs[0].id) {
            tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
        }

        // Filter for Amazon tabs if we have multiple or unsure
        let targetTab = tabs.find(t => t.url && (t.url.includes('.amazon.') || t.url.includes('/dp/')));

        // Final fallback: just get ANY amazon tab
        if (!targetTab) {
            const amazonTabs = await browser.tabs.query({ url: "*://*.amazon.*/*" });
            targetTab = amazonTabs.find(t => t.active) || amazonTabs[0];
        }

        if (!targetTab?.id) throw new Error('No active Amazon tab found');

        const response = await browser.tabs.sendMessage(targetTab.id, {
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
