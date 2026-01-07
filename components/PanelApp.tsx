import { useState, useEffect } from 'react';
import { browser } from 'wxt/browser';

interface ProductItem {
    asin: string;
    title: string;
    image: string;
    price?: string;
    rating?: string;
}

interface ProductData {
    pageType: 'product' | 'listing';
    asin: string;
    title: string;
    variant: string;
    productImages: string[];
    reviewImages: string[];
    videos: string[];
    reviewVideos: string[];
    listingProducts: ProductItem[];
}

interface PanelAppProps {
    onClose: () => void;
    scrapeProductData: () => Promise<ProductData> | ProductData;
    downloadZip: (urls: string[], filename: string) => Promise<void>;
}

const COLORS = {
    // Backgrounds - cool, soft tones for eye comfort
    bg: '#F6F7FB',
    bgSecondary: '#EFF1F7',
    bgHover: '#E9ECF4',
    bgGradient: 'linear-gradient(180deg, #FFFFFF 0%, #F6F7FB 100%)',
    bgCard: '#FFFFFF',
    bgOverlay: 'rgba(246, 247, 251, 0.98)',

    // Borders - subtle lavender and soft gray
    border: '#E2E4F2',
    borderLight: '#EEF0F8',
    borderFocus: '#7B7FF2',
    borderSubtle: '#DADDFC',

    // Text - professional dark grays for readability
    text: '#2E2F38',
    textSecondary: '#6B6F85',
    textMuted: '#9AA0B5',
    textLight: '#B1B5C4',
    textInverse: '#FFFFFF',

    // Primary accent - Lavender Blue (#7B7FF2)
    accent: '#7B7FF2',
    accentLight: '#E8E9FF',
    accentMedium: '#CACCFF',
    accentDark: '#666AD1',
    accentGradient: 'linear-gradient(135deg, #7B7FF2 0%, #8E92F7 100%)',
    accentGlow: 'rgba(123, 127, 242, 0.12)',

    // Success - soft mint green
    success: '#6BCB77',
    successLight: '#F0FFF1',
    successDark: '#4CAF50',
    successGlow: 'rgba(107, 203, 119, 0.10)',

    // Selection - consistent with lavender accent
    selection: '#7B7FF2',
    selectionLight: '#F3F4FF',
    selectionMedium: '#E2E4F2',
    selectionGlow: 'rgba(123, 127, 242, 0.10)',

    // Base colors
    white: '#FFFFFF',
    black: '#1A1B23',

    // Category Specific (mapped to lavender theme for consistency)
    blue: '#7B7FF2',
    blueLight: '#E8E9FF',
    blueMedium: '#CACCFF',
    blueDark: '#666AD1',
    blueGlow: 'rgba(123, 127, 242, 0.12)',

    purple: '#7B7FF2',
    purpleLight: '#F3F4FF',
    purpleMedium: '#E2E4F2',
    purpleDark: '#666AD1',
    purpleGlow: 'rgba(123, 127, 242, 0.10)',

    // Shadows - extremely subtle
    shadowXs: '0 1px 2px rgba(123, 127, 242, 0.03)',
    shadowSm: '0 2px 4px rgba(123, 127, 242, 0.04), 0 1px 2px rgba(123, 127, 242, 0.02)',
    shadowMd: '0 4px 12px rgba(123, 127, 242, 0.06), 0 2px 4px rgba(123, 127, 242, 0.03)',
    shadowLg: '0 8px 24px rgba(123, 127, 242, 0.08), 0 4px 8px rgba(123, 127, 242, 0.04)',
    shadowXl: '0 16px 48px rgba(123, 127, 242, 0.12), 0 8px 16px rgba(123, 127, 242, 0.06)',
    shadowAccent: '0 4px 16px rgba(123, 127, 242, 0.20), 0 2px 4px rgba(123, 127, 242, 0.10)',
    shadowInset: 'inset 0 1px 2px rgba(123, 127, 242, 0.03)',

    // Overlay
    overlay: 'rgba(46, 47, 56, 0.4)',
    overlayDark: 'rgba(46, 47, 56, 0.8)'
};

/**
 * Shortens and cleans a product title for display
 * Transforms long, messy titles into concise, readable names
 */
const shortenProductTitle = (title: string, maxLength: number = 70): string => {
    if (!title) return '';

    let cleaned = title;

    // Remove technical specs in parentheses/brackets (e.g., "(B07...)", "[6GB RAM]")
    cleaned = cleaned.replace(/\s*[([][^)\]]*[ASIN|B0][^)\]]*[)\]]\s*/gi, ' ');
    cleaned = cleaned.replace(/\s*\([^)]*\)\s*$/g, '');
    cleaned = cleaned.replace(/\s*\[[^\]]*\]\s*/g, ' ');

    // Remove Amazon noise like "Free Delivery", "Prime", etc.
    const platformNoise = [
        /\b(free delivery|prime|deal of the day|limited time deal|sponsored)\b/gi,
        /\b(compatible with|replacement for|perfect for)\b/gi,
    ];
    platformNoise.forEach(pattern => cleaned = cleaned.replace(pattern, ' '));

    // Handle the "LL LEATHER LAND" cases - remove short ALL CAPS prefixes that are acronyms of what follows
    const wordsForAcronym = cleaned.split(/\s+/);
    if (wordsForAcronym.length > 2) {
        const first = wordsForAcronym[0];
        if (first.length <= 3 && first === first.toUpperCase() && /^[A-Z]+$/.test(first)) {
            const nextWords = wordsForAcronym.slice(1, first.length + 1);
            const acronym = nextWords.map(w => w[0]).join('').toUpperCase();
            if (acronym === first) {
                cleaned = wordsForAcronym.slice(1).join(' ');
            }
        }
    }

    // Convert ALL CAPS blocks to Title Case
    cleaned = cleaned.replace(/\b([A-Z]{2,})\b/g, (match) => {
        const lowercaseExceptions = ['AND', 'THE', 'FOR', 'WITH', 'FROM', 'OFF', 'PER'];
        if (lowercaseExceptions.includes(match)) return match.toLowerCase();
        // Keep some acronyms caps (e.g., RAM, LED, 5G, USB, TWS, ANC)
        const keepCaps = ['ASIN', 'LED', 'LCD', 'USB', 'RAM', 'ROM', 'HDD', 'SSD', 'CPU', 'GPU', 'TWS', 'ANC', '5G', '4G'];
        if (keepCaps.includes(match)) return match;
        return match.charAt(0) + match.slice(1).toLowerCase();
    });

    // Remove model/SKU patterns (e.g., SLG-207, ADP-141)
    cleaned = cleaned.replace(/\b[A-Z0-9]{3,}-[A-Z0-9]{3,}\b/gi, ' ');
    cleaned = cleaned.replace(/\b[A-Z]{1,2}_\d{2,}\b/gi, ' ');

    // Remove trailing technical info often preceded by separators
    const separators = ['|', '-', ':', ','];
    separators.forEach(sep => {
        const parts = cleaned.split(sep);
        if (parts.length > 1) {
            // Keep the first few chunks if they seem like part of the name, discard the rest if it looks like specs
            // For now, let's just clean the parts and rejoin or take the most relevant
            cleaned = parts[0];
        }
    });

    // Clean up excessive punctuation and spaces
    cleaned = cleaned.replace(/[-_]{2,}/g, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ');
    cleaned = cleaned.replace(/['"]/g, '');
    cleaned = cleaned.trim();

    // Remove duplicated brand/keywords or simple repeated words (e.g., "Brand Brand")
    const words = cleaned.split(/\s+/);
    const uniqueWords: string[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const lower = word.toLowerCase();

        // Skip if it's the same as the previous word (simple repeat)
        if (i > 0 && lower === words[i - 1].toLowerCase()) continue;

        // Skip if we've seen this word earlier (brand repetition), 
        // but keep common connecting words
        const isCommon = ['and', 'with', 'for', 'the', 'of', 'in', 'to', 'from'].includes(lower);
        if (!seen.has(lower) || isCommon || word.length <= 3) {
            uniqueWords.push(word);
            if (word.length > 3) seen.add(lower);
        }
    }
    cleaned = uniqueWords.join(' ');

    // Final truncation if needed, but try to keep it long enough for meaning
    if (cleaned.length > maxLength) {
        const truncated = cleaned.substring(0, maxLength);
        const lastSpace = truncated.lastIndexOf(' ');
        cleaned = lastSpace > 20 ? truncated.substring(0, lastSpace).trim() : truncated.trim();
        if (cleaned.length < cleaned.length) cleaned += '...';
    }

    return cleaned || title.substring(0, maxLength);
};

function PanelApp({ onClose, scrapeProductData, downloadZip }: PanelAppProps) {
    type ViewState = 'welcome' | 'login' | 'main';
    const [view, setView] = useState<ViewState>('welcome');

    const [productData, setProductData] = useState<ProductData | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [downloading, setDownloading] = useState(false);
    const [expandedSections, setExpandedSections] = useState({
        productImages: true,
        reviewImages: true,
        videos: true,
        reviewVideos: true,
        listingProducts: true
    });
    const [selectionModes, setSelectionModes] = useState<Record<string, boolean>>({});
    const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
    const [searchTerm, setSearchTerm] = useState('');
    const [activeSearchTerm, setActiveSearchTerm] = useState('');

    // Open preview modal - now sends message to content script for website-wide overlay
    const openPreview = async (url: string, type: 'image' | 'video', urls: string[]) => {
        try {
            const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
            if (tab?.id) {
                browser.tabs.sendMessage(tab.id, {
                    type: 'SHOW_PREVIEW',
                    url,
                    mediaType: type,
                    urls
                });
            }
        } catch (e) {
            console.error('Failed to open preview:', e);
        }
    };



    useEffect(() => {
        // Initial load
        loadData();

        // Listen for automatic refresh triggers from background script and content script
        const handleMessage = async (message: any) => {
            // Handle AUTO_REFRESH from background (URL/page changes)
            if (message.type === 'AUTO_REFRESH') {
                try {
                    // Check if this update is for the active tab effectively visible to the user
                    const [activeTab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
                    if (activeTab && activeTab.id === message.tabId) {
                        // Delay depends on the reason for refresh
                        const delay = message.reason === 'page_loaded' ? 500 : 300;
                        setTimeout(() => {
                            loadData();
                        }, delay);
                    }
                } catch (e) {
                    console.error('Auto-refresh check failed:', e);
                }
            }

            // Handle CONTENT_CHANGED from content script (variant changes, dynamic content)
            if (message.type === 'CONTENT_CHANGED') {
                console.log('Content changed detected:', message.reason);
                // Small delay to ensure DOM has fully updated
                setTimeout(() => {
                    loadData();
                }, 400);
            }
        };

        browser.runtime.onMessage.addListener(handleMessage);
        return () => browser.runtime.onMessage.removeListener(handleMessage);
    }, []);

    const loadData = async () => {
        setLoading(true);
        // Reset all gallery states for a fresh product view
        setVisibleCounts({});
        setSelectionModes({});
        setExpandedSections({
            productImages: true,
            reviewImages: true,
            videos: true,
            reviewVideos: true,
            listingProducts: true
        });

        try {
            const result = scrapeProductData();
            const data = result instanceof Promise ? await result : result;
            setProductData(data);
        } catch (error) {
            console.error('Failed to get data:', error);
            setProductData({
                pageType: 'product',
                asin: '',
                title: 'Unable to load product data',
                variant: '',
                productImages: [],
                reviewImages: [],
                videos: [],
                reviewVideos: [],
                listingProducts: []
            });
        } finally {
            setLoading(false);
        }
    };


    const toggleSection = (section: keyof typeof expandedSections) => {
        setExpandedSections(prev => ({
            ...prev,
            [section]: !prev[section]
        }));
    };

    const toggleSelect = (url: string) => {
        const next = new Set(selected);
        if (next.has(url)) next.delete(url);
        else next.add(url);
        setSelected(next);
    };



    const getAllMedia = () => {
        if (!productData) return [];
        const media = [...productData.productImages, ...productData.reviewImages, ...productData.videos, ...productData.reviewVideos];
        // Include listing product images
        if (productData.pageType === 'listing' && productData.listingProducts) {
            productData.listingProducts.forEach(p => {
                if (p.image && !media.includes(p.image)) {
                    media.push(p.image);
                }
            });
        }
        return media;
    };

    if (view === 'welcome') {
        return <Welcome onGetStarted={() => setView('login')} />;
    }

    if (view === 'login') {
        return <Login onLogin={() => setView('main')} />;
    }

    const handleRefresh = () => {
        setSelected(new Set()); // Clear selections
        setSearchTerm('');
        setActiveSearchTerm('');
        loadData();
    };

    const downloadSelected = async () => {
        const urls = Array.from(selected);
        if (urls.length === 0) return;
        setDownloading(true);
        try {
            await downloadZip(urls, `amazon-${productData?.asin || 'images'}-${Date.now()}`);
            // Immediately reset selection and exit mode after successful download
            setSelected(new Set());
            setSelectionModes({});
            setSearchTerm('');
            setActiveSearchTerm('');
        } finally {
            setTimeout(() => setDownloading(false), 2000);
        }
    };

    const downloadAll = async () => {
        const all = getAllMedia();
        if (all.length === 0) return;
        setDownloading(true);
        try {
            await downloadZip(all, `amazon-${productData?.asin || 'all'}-${Date.now()}`);
            // Immediately reset selection and exit mode after successful download
            setSelected(new Set());
            setSelectionModes({});
            setSearchTerm('');
            setActiveSearchTerm('');
        } finally {
            setTimeout(() => setDownloading(false), 2000);
        }
    };

    const handleSingleDownload = async (url: string, type: 'image' | 'video') => {
        const timestamp = Date.now();
        const ext = type === 'video' ? 'mp4' : 'jpg';
        // Try to get extension from URL if possible
        const urlExt = url.split('.').pop()?.split('?')[0];
        const finalExt = urlExt && ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'webm'].includes(urlExt) ? urlExt : ext;

        const filename = `amazon-${type}-${timestamp}.${finalExt}`;

        try {
            await browser.runtime.sendMessage({
                type: 'DOWNLOAD_SINGLE',
                url,
                filename
            });
        } catch (error) {
            console.error('Single download failed:', error);
        }
    };

    const renderMediaGrid = (urls: string[], type: 'image' | 'video', isSelectionActive: boolean, sectionKey: string) => {
        const step = type === 'video' ? 8 : 6;
        const limit = visibleCounts[sectionKey] || step;
        const displayUrls = urls.slice(0, limit);
        const hasMore = urls.length > limit;

        return (
            <div style={{
                display: 'grid',
                gridTemplateColumns: type === 'video' ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
                gap: '8px',
                padding: '14px 16px 16px 16px',
                justifyContent: 'center'
            }}>
                {displayUrls.map((url, i) => {
                    const isLastVisible = hasMore && i === limit - 1;

                    return (
                        <div
                            key={url}
                            onClick={() => {
                                if (isLastVisible) {
                                    setVisibleCounts(prev => ({
                                        ...prev,
                                        [sectionKey]: (prev[sectionKey] || step) + step
                                    }));
                                    return;
                                }
                                if (isSelectionActive) {
                                    toggleSelect(url);
                                } else {
                                    // Open preview when not in selection mode
                                    openPreview(url, type, urls);
                                }
                            }}
                            style={{
                                position: 'relative',
                                aspectRatio: type === 'video' ? '16/9' : '1',
                                borderRadius: '12px',
                                overflow: 'hidden',
                                border: selected.has(url) ? `2px solid ${COLORS.accent}` : `1px solid ${COLORS.border}`,
                                cursor: 'pointer',
                                background: type === 'video' ? '#1a2634' : COLORS.bgSecondary,
                                transition: 'all 0.2s ease, transform 0.15s ease',
                                boxShadow: selected.has(url) ? `0 0 0 3px ${COLORS.accentGlow}` : COLORS.shadowXs
                            }}
                            className="group"
                        >
                            {type === 'video' ? (
                                <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                                    <video
                                        src={url}
                                        muted
                                        loop
                                        playsInline
                                        style={{
                                            width: '100%',
                                            height: '100%',
                                            objectFit: 'contain',
                                            pointerEvents: 'none'
                                        }}
                                    />
                                    <div style={{
                                        position: 'absolute',
                                        top: '50%',
                                        left: '50%',
                                        transform: 'translate(-50%, -50%)',
                                        width: '40px',
                                        height: '40px',
                                        borderRadius: '50%',
                                        background: 'rgba(0,0,0,0.6)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        pointerEvents: 'none'
                                    }}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                                            <polygon points="5 3 19 12 5 21 5 3" />
                                        </svg>
                                    </div>
                                </div>
                            ) : (
                                <img
                                    src={url}
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                        background: COLORS.bgSecondary
                                    }}
                                />
                            )}

                            {isLastVisible && (
                                <div style={{
                                    position: 'absolute',
                                    inset: 0,
                                    background: 'rgba(232, 233, 255, 0.92)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: COLORS.accent,
                                    zIndex: 20,
                                    backdropFilter: 'blur(8px)',
                                    transition: 'all 0.2s ease',
                                    border: `2px dashed ${COLORS.accentMedium}`,
                                    borderRadius: '12px',
                                    boxShadow: `inset 0 0 15px ${COLORS.accentGlow}`
                                }}>
                                    <span style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '0.3px' }}>
                                        +{urls.length - (limit - 1)} More
                                    </span>
                                </div>
                            )}

                            {/* Selection indicator */}
                            {isSelectionActive && !isLastVisible && (
                                <div
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleSelect(url);
                                    }}
                                    style={{
                                        position: 'absolute',
                                        top: '6px',
                                        right: '6px',
                                        width: '24px',
                                        height: '24px',
                                        borderRadius: '50%',
                                        background: selected.has(url) ? COLORS.accent : 'rgba(0,0,0,0.3)',
                                        border: '2px solid white',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        zIndex: 10
                                    }}
                                >
                                    {selected.has(url) && (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                                            <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                    )}
                                </div>
                            )}

                            {/* Download Button */}
                            {!isLastVisible && (
                                <div
                                    className="download-btn"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleSingleDownload(url, type);
                                    }}
                                    title={`Download ${type}`}
                                    style={{
                                        position: 'absolute',
                                        bottom: '8px',
                                        right: '8px',
                                        width: '32px',
                                        height: '32px',
                                        borderRadius: '50%',
                                        background: COLORS.white,
                                        border: `1px solid ${COLORS.borderSubtle}`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        boxShadow: COLORS.shadowMd,
                                        zIndex: 10,
                                        opacity: 0,
                                        transform: 'translateY(4px) scale(0.9)',
                                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.accent} strokeWidth="2.5">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                        <polyline points="7 10 12 15 17 10" />
                                        <line x1="12" y1="15" x2="12" y2="3" />
                                    </svg>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderSection = (
        title: string,
        count: number,
        urls: string[],
        sectionKey: keyof typeof expandedSections,
        iconColor: string,
        iconPath: React.ReactNode,
        type: 'image' | 'video' = 'image'
    ) => {
        if (count === 0) return null;

        const isExpanded = expandedSections[sectionKey];
        const isSelectionMode = selectionModes[sectionKey] || false;

        // Filter URLs based on search term for listing products or other searchable sections
        const filteredUrls = urls.filter(url => {
            if (!searchTerm) return true;
            // If it's a listing product, we might want to search by title or ASIN
            if (sectionKey === 'listingProducts' && productData?.listingProducts) {
                const product = productData.listingProducts.find(p => p.image === url);
                if (product) {
                    return product.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        (product.asin && product.asin.toLowerCase().includes(searchTerm.toLowerCase()));
                }
            }
            return true;
        });

        return (
            <div style={{
                marginBottom: '12px',
                background: COLORS.white,
                borderRadius: '16px',
                border: `1px solid ${COLORS.borderLight}`,
                overflow: 'hidden',
                boxShadow: COLORS.shadowXs,
                transition: 'box-shadow 0.2s ease, transform 0.2s ease'
            }}>
                {/* Section Header */}
                <div
                    onClick={() => toggleSection(sectionKey)}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 18px',
                        cursor: 'pointer',
                        background: COLORS.white,
                        transition: 'background 0.2s ease'
                    }}
                >
                    {(() => {
                        const isSuccess = iconColor === COLORS.success;
                        const theme = {
                            light: isSuccess ? COLORS.successLight : COLORS.purpleLight,
                            medium: isSuccess ? COLORS.successGlow : COLORS.purpleMedium,
                            dark: isSuccess ? COLORS.successDark : COLORS.purpleDark,
                            glow: isSuccess ? COLORS.successGlow : COLORS.purpleGlow,
                            main: iconColor
                        };

                        return (
                            <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                    <div style={{
                                        width: '40px',
                                        height: '40px',
                                        borderRadius: '12px',
                                        background: theme.light,
                                        border: `1px solid ${theme.medium}`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        boxShadow: `0 2px 8px ${theme.glow}`
                                    }}>
                                        {iconPath}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                        <span style={{
                                            fontWeight: 700,
                                            fontSize: '15px',
                                            color: COLORS.text,
                                            letterSpacing: '-0.2px',
                                            lineHeight: '1.2'
                                        }}>
                                            {title}
                                        </span>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <span style={{
                                        background: theme.light,
                                        padding: '4px 10px',
                                        borderRadius: '20px',
                                        fontSize: '11px',
                                        fontWeight: 750,
                                        color: theme.dark,
                                        border: `1px solid ${theme.medium}`,
                                        lineHeight: '1.2',
                                        display: 'flex',
                                        alignItems: 'center'
                                    }}>
                                        {count}
                                    </span>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectionModes(prev => ({
                                                ...prev,
                                                [sectionKey]: !prev[sectionKey]
                                            }));
                                        }}
                                        style={{
                                            background: isSelectionMode ? COLORS.accent : 'transparent',
                                            border: `1px solid ${isSelectionMode ? COLORS.accentDark : COLORS.borderSubtle}`,
                                            padding: '5px 12px',
                                            borderRadius: '20px',
                                            cursor: 'pointer',
                                            color: isSelectionMode ? COLORS.white : COLORS.accent,
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                            boxShadow: isSelectionMode ? `0 2px 8px ${COLORS.accentGlow}` : 'none'
                                        }}
                                    >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                            {isSelectionMode ? <path d="M20 6L9 17l-5-5" /> : <path d="M12 5v14M5 12h14" />}
                                        </svg>
                                        <span>
                                            {isSelectionMode ? 'Done' : 'Select'}
                                        </span>
                                    </button>

                                    <svg
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke={COLORS.textMuted}
                                        strokeWidth="2"
                                        style={{
                                            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                            transition: 'transform 0.2s ease'
                                        }}
                                    >
                                        <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                </div>
                            </>
                        );
                    })()}
                </div>

                {/* Section Content */}
                {isExpanded && renderMediaGrid(filteredUrls, type, isSelectionMode, sectionKey)}
            </div>
        );
    };

    const filteredListingProducts = productData?.listingProducts?.filter(p =>
        !activeSearchTerm ||
        (p.title && p.title.toLowerCase().includes(activeSearchTerm.toLowerCase())) ||
        (p.asin && p.asin.toLowerCase().includes(activeSearchTerm.toLowerCase()))
    ) || [];

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
            background: COLORS.bg,
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            color: COLORS.text,
            overflow: 'hidden',
            fontSize: '14px',
            lineHeight: '1.5',
            WebkitFontSmoothing: 'antialiased'
        }}>
            {/* Header */}
            <header style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 16px',
                background: COLORS.white,
                borderBottom: `1px solid ${COLORS.border}`,
                boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                position: 'relative',
                zIndex: 10
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '10px',
                        background: 'linear-gradient(145deg, #666AD1 0%, #7B7FF2 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 3px 12px rgba(123, 127, 242, 0.2)'
                    }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                            <circle cx="12" cy="13" r="4" />
                        </svg>
                    </div>
                    <div style={{ marginLeft: '-2px' }}>
                        <h1 style={{
                            margin: 0,
                            fontSize: '16px',
                            fontWeight: 800,
                            letterSpacing: '-0.5px',
                            color: COLORS.text,
                            display: 'flex',
                            alignItems: 'center',
                            lineHeight: 1
                        }}>
                            AMZ<span style={{
                                background: COLORS.accentGradient,
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                                marginLeft: '1px'
                            }}>IMAGE</span>
                        </h1>
                        <p style={{
                            margin: '1px 0 0 0',
                            fontSize: '9px',
                            color: COLORS.textMuted,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.4px',
                            lineHeight: 1
                        }}>
                            Media Downloader
                        </p>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={handleRefresh}
                        style={{
                            width: '32px',
                            height: '32px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: loading ? COLORS.accentLight : COLORS.bgSecondary,
                            border: `1px solid ${loading ? COLORS.accentMedium : 'transparent'}`,
                            cursor: loading ? 'default' : 'pointer',
                            borderRadius: '8px',
                            color: loading ? COLORS.accent : COLORS.textSecondary,
                            transition: 'all 0.2s ease',
                            boxShadow: loading ? 'none' : COLORS.shadowSm
                        }}
                        title="Refresh"
                    >
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            style={{
                                animation: loading ? 'spin 1s linear infinite' : 'none'
                            }}
                        >
                            <path d="M23 4v6h-6M1 20v-6h6" />
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                    </button>
                    <button
                        onClick={() => setView('login')}
                        style={{
                            width: '32px',
                            height: '32px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: COLORS.bgSecondary,
                            border: '1px solid transparent',
                            cursor: 'pointer',
                            borderRadius: '8px',
                            color: COLORS.textSecondary,
                            transition: 'all 0.2s ease',
                            boxShadow: COLORS.shadowSm
                        }}
                        title="Sign Out"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                    </button>
                </div>
            </header>

            {/* Search Bar - Only on listing pages */}
            {!loading && productData && productData.pageType === 'listing' && (
                <div style={{
                    padding: '8px 16px 12px',
                    background: COLORS.white,
                    borderBottom: `1px solid ${COLORS.borderLight}`,
                    position: 'relative'
                }}>
                    <div style={{ position: 'relative', width: '100%' }}>
                        <div style={{
                            position: 'absolute',
                            left: '12px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            display: 'flex',
                            alignItems: 'center',
                            pointerEvents: 'none',
                            color: COLORS.textMuted
                        }}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <circle cx="11" cy="11" r="8" />
                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                        </div>
                        <input
                            type="text"
                            placeholder="Find products by name, ASIN or brand..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    setActiveSearchTerm(searchTerm);
                                }
                            }}
                            style={{
                                width: '100%',
                                height: '42px',
                                padding: '0 80px 0 40px',
                                background: 'rgba(123, 127, 242, 0.04)',
                                border: `1.5px solid ${COLORS.border}`,
                                borderRadius: '12px',
                                fontSize: '13px',
                                fontWeight: 600,
                                color: COLORS.text,
                                outline: 'none',
                                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)'
                            }}
                            onFocus={(e) => {
                                e.target.style.borderColor = COLORS.accent;
                                e.target.style.background = COLORS.white;
                                e.target.style.boxShadow = `0 0 0 4px ${COLORS.accentGlow}, inset 0 1px 2px rgba(0,0,0,0.02)`;
                            }}
                            onBlur={(e) => {
                                e.target.style.borderColor = COLORS.border;
                                e.target.style.background = 'rgba(123, 127, 242, 0.04)';
                                e.target.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.02)';
                            }}
                        />

                        <div style={{
                            position: 'absolute',
                            right: '6px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                        }}>
                            {searchTerm && (
                                <button
                                    onClick={() => {
                                        setSearchTerm('');
                                        setActiveSearchTerm('');
                                    }}
                                    title="Clear search"
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        borderRadius: '50%',
                                        width: '24px',
                                        height: '24px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'pointer',
                                        color: COLORS.textMuted,
                                        transition: 'all 0.2s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.color = COLORS.textSecondary;
                                        e.currentTarget.style.background = COLORS.bgSecondary;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.color = COLORS.textMuted;
                                        e.currentTarget.style.background = 'transparent';
                                    }}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            )}

                            <button
                                onClick={() => setActiveSearchTerm(searchTerm)}
                                title="Search"
                                style={{
                                    background: COLORS.accent,
                                    border: 'none',
                                    borderRadius: '8px',
                                    width: '32px',
                                    height: '32px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    color: COLORS.white,
                                    boxShadow: COLORS.shadowSm,
                                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'scale(1.05)';
                                    e.currentTarget.style.boxShadow = COLORS.shadowMd;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'scale(1)';
                                    e.currentTarget.style.boxShadow = COLORS.shadowSm;
                                }}
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M5 12h14" />
                                    <path d="M12 5l7 7-7 7" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Product Info (for product pages) */}
            {productData && !loading && productData.pageType === 'product' && productData.asin && (
                <div style={{
                    padding: '8px 18px',
                    background: COLORS.white,
                    borderBottom: `1px solid ${COLORS.borderLight}`
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <span style={{
                            background: COLORS.accentLight,
                            color: COLORS.accentDark,
                            padding: '2px 8px',
                            borderRadius: '6px',
                            fontSize: '9px',
                            fontWeight: 700,
                            letterSpacing: '0.3px',
                            border: `1px solid ${COLORS.accentMedium}`,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px'
                        }}>
                            <span style={{ opacity: 0.7, fontWeight: 500 }}>ASIN:</span> {productData.asin}
                        </span>
                        {productData.variant && (
                            <span style={{
                                background: COLORS.bgSecondary,
                                color: COLORS.textSecondary,
                                padding: '2px 8px',
                                borderRadius: '6px',
                                fontSize: '9px',
                                fontWeight: 600,
                                border: `1px solid ${COLORS.border}`
                            }}>
                                {productData.variant}
                            </span>
                        )}
                    </div>
                    <p style={{
                        margin: 0,
                        fontSize: '14px',
                        color: COLORS.text,
                        lineHeight: 1.6,
                        fontWeight: 500,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                    }}
                        title={productData.title}
                    >
                        {shortenProductTitle(productData.title, 120)}
                    </p>
                </div>
            )}

            {/* Listing Info (for search/category pages) */}
            {productData && !loading && productData.pageType === 'listing' && (
                <div style={{
                    padding: '14px 20px',
                    background: COLORS.white,
                    borderBottom: `1px solid ${COLORS.borderLight}`
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <span style={{
                            background: COLORS.accent,
                            color: COLORS.white,
                            padding: '4px 12px',
                            borderRadius: '8px',
                            fontSize: '10px',
                            fontWeight: 800,
                            letterSpacing: '0.05em',
                            boxShadow: `0 2px 6px ${COLORS.accentGlow}`
                        }}>
                            ACTIVE LISTING
                        </span>
                        <span style={{
                            background: COLORS.bgSecondary,
                            color: COLORS.textSecondary,
                            padding: '3px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 600
                        }}>
                            {filteredListingProducts.length} products
                        </span>
                    </div>

                </div>
            )}

            {/* Main Content Area - Panel background */}
            <main style={{
                flex: 1,
                overflow: 'auto',
                padding: '8px 12px 16px',
                background: COLORS.bg
            }}>
                {loading ? (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        gap: '20px',
                        color: COLORS.textMuted
                    }}>
                        <div style={{ position: 'relative' }}>
                            <div style={{
                                width: '48px',
                                height: '48px',
                                border: `3px solid ${COLORS.border}`,
                                borderRadius: '50%'
                            }} />
                            <div style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '48px',
                                height: '48px',
                                border: '3px solid transparent',
                                borderTopColor: COLORS.accent,
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite'
                            }} />
                        </div>
                        <p style={{ fontSize: '14px', fontWeight: 500, margin: 0 }}>Scanning page...</p>
                    </div>
                ) : productData ? (
                    <div>
                        {/* Product Detail Sections - Only on product pages */}
                        {productData.pageType === 'product' && (
                            <>
                                {renderSection(
                                    'Product Images',
                                    productData.productImages.length,
                                    productData.productImages,
                                    'productImages',
                                    COLORS.accent,
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.accent} strokeWidth="2">
                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                        <circle cx="8.5" cy="8.5" r="1.5" />
                                        <polyline points="21 15 16 10 5 21" />
                                    </svg>
                                )}

                                {renderSection(
                                    'Product Videos',
                                    productData.videos.length,
                                    productData.videos,
                                    'videos',
                                    COLORS.purple,
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.purple} strokeWidth="2">
                                        <polygon points="23 7 16 12 23 17 23 7" />
                                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                                    </svg>,
                                    'video'
                                )}

                                {renderSection(
                                    'Review Images',
                                    productData.reviewImages.length,
                                    productData.reviewImages,
                                    'reviewImages',
                                    COLORS.success,
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.success} strokeWidth="2">
                                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                    </svg>
                                )}

                                {renderSection(
                                    'Review Videos',
                                    productData.reviewVideos.length,
                                    productData.reviewVideos,
                                    'reviewVideos',
                                    COLORS.success,
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.success} strokeWidth="2">
                                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                        <polygon points="10 8 16 12 10 16 10 8" />
                                    </svg>,
                                    'video'
                                )}
                            </>
                        )}



                        {/* Listing Products Section (for search/category pages) */}
                        {productData.pageType === 'listing' && productData.listingProducts.length > 0 && (
                            <div style={{
                                marginBottom: '8px',
                                background: COLORS.white,
                                borderRadius: '12px',
                                border: `1px solid ${COLORS.borderLight}`,
                                overflow: 'hidden'
                            }}>
                                <div
                                    onClick={() => toggleSection('listingProducts')}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '12px 16px',
                                        cursor: 'pointer',
                                        background: COLORS.white,
                                        borderBottom: expandedSections.listingProducts ? `1px solid ${COLORS.borderLight}` : 'none'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <div style={{
                                            width: '32px',
                                            height: '32px',
                                            borderRadius: '8px',
                                            background: COLORS.blueLight,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.blue} strokeWidth="2">
                                                <rect x="3" y="3" width="7" height="7" />
                                                <rect x="14" y="3" width="7" height="7" />
                                                <rect x="14" y="14" width="7" height="7" />
                                                <rect x="3" y="14" width="7" height="7" />
                                            </svg>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                            <span style={{ fontWeight: 700, fontSize: '14px', color: COLORS.text }}>Listed Products</span>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <span style={{
                                            background: COLORS.accentLight,
                                            padding: '4px 10px',
                                            borderRadius: '20px',
                                            fontSize: '11px',
                                            fontWeight: 800,
                                            color: COLORS.accentDark,
                                            border: `1px solid ${COLORS.accentMedium}`,
                                            lineHeight: '1.2',
                                            display: 'flex',
                                            alignItems: 'center'
                                        }}>
                                            {filteredListingProducts.length}
                                        </span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectionModes(prev => ({
                                                    ...prev,
                                                    listingProducts: !prev.listingProducts
                                                }));
                                            }}
                                            style={{
                                                background: selectionModes.listingProducts ? COLORS.purpleLight : 'transparent',
                                                border: `1px solid ${selectionModes.listingProducts ? COLORS.purpleMedium : 'transparent'}`,
                                                padding: '4px 8px',
                                                borderRadius: '6px',
                                                cursor: 'pointer',
                                                color: selectionModes.listingProducts ? COLORS.purple : COLORS.accent,
                                                fontSize: '12px',
                                                fontWeight: 600,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                transition: 'all 0.2s ease'
                                            }}
                                        >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                {selectionModes.listingProducts ? <path d="M20 6L9 17l-5-5" /> : <path d="M12 5v14M5 12h14" />}
                                            </svg>
                                            <span>
                                                {selectionModes.listingProducts ? 'Done' : 'Select'}
                                            </span>
                                        </button>

                                        <svg
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke={COLORS.textMuted}
                                            strokeWidth="2"
                                            style={{
                                                transform: expandedSections.listingProducts ? 'rotate(180deg)' : 'rotate(0deg)',
                                                transition: 'transform 0.2s ease'
                                            }}
                                        >
                                            <polyline points="6 9 12 15 18 9" />
                                        </svg>
                                    </div>
                                </div>
                                {expandedSections.listingProducts && (
                                    <div style={{ padding: '8px 16px 16px' }}>
                                        {filteredListingProducts.map((product, index) => (
                                            <div
                                                key={product.asin || index}
                                                onClick={() => {
                                                    if (selectionModes.listingProducts) {
                                                        toggleSelect(product.image);
                                                    } else {
                                                        openPreview(product.image, 'image', filteredListingProducts.map(p => p.image));
                                                    }
                                                }}
                                                style={{
                                                    display: 'flex',
                                                    gap: '10px',
                                                    padding: '6px 8px',
                                                    marginBottom: '4px',
                                                    background: selected.has(product.image) ? `${COLORS.accentGlow}33` : COLORS.white,
                                                    borderRadius: '10px',
                                                    cursor: 'pointer',
                                                    border: `1.5px solid ${selected.has(product.image) ? COLORS.accent : COLORS.borderLight}`,
                                                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                                    boxShadow: selected.has(product.image) ? COLORS.shadowAccent : '0 2px 4px rgba(0,0,0,0.02)',
                                                    position: 'relative',
                                                    overflow: 'hidden'
                                                }}
                                            >
                                                {/* Selection Overlay for entire card */}
                                                {selected.has(product.image) && (
                                                    <div style={{
                                                        position: 'absolute',
                                                        left: 0,
                                                        top: 0,
                                                        bottom: 0,
                                                        width: '4px',
                                                        background: COLORS.accent
                                                    }} />
                                                )}
                                                <div
                                                    className="group"
                                                    style={{
                                                        width: '64px',
                                                        height: '64px',
                                                        borderRadius: '8px',
                                                        overflow: 'hidden',
                                                        background: COLORS.white,
                                                        border: `1px solid ${COLORS.borderLight}`,
                                                        flexShrink: 0,
                                                        position: 'relative'
                                                    }}>
                                                    <img
                                                        src={product.image}
                                                        alt={product.title}
                                                        style={{
                                                            width: '100%',
                                                            height: '100%',
                                                            objectFit: 'contain'
                                                        }}
                                                    />
                                                    <div
                                                        className="opacity-0 group-hover:opacity-100"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleSingleDownload(product.image, 'image');
                                                        }}
                                                        style={{
                                                            position: 'absolute',
                                                            inset: 0,
                                                            background: 'rgba(0,0,0,0.1)',
                                                            display: 'flex',
                                                            alignItems: 'flex-end',
                                                            justifyContent: 'flex-end',
                                                            padding: '4px',
                                                            transition: 'opacity 0.2s ease',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        <div style={{
                                                            width: '24px',
                                                            height: '24px',
                                                            borderRadius: '50%',
                                                            background: COLORS.white,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                                        }}>
                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={COLORS.accent} strokeWidth="2.5">
                                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                                <polyline points="7 10 12 15 17 10" />
                                                                <line x1="12" y1="15" x2="12" y2="3" />
                                                            </svg>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <p style={{
                                                        margin: 0,
                                                        fontSize: '14px',
                                                        fontWeight: 700,
                                                        color: COLORS.text,
                                                        lineHeight: 1.35,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        display: '-webkit-box',
                                                        WebkitLineClamp: 2,
                                                        WebkitBoxOrient: 'vertical',
                                                        marginBottom: '6px',
                                                        letterSpacing: '-0.1px'
                                                    }}
                                                        title={product.title}
                                                    >
                                                        {shortenProductTitle(product.title, 85)}
                                                    </p>
                                                    <div style={{
                                                        display: 'flex',
                                                        gap: '8px',
                                                        alignItems: 'center',
                                                        flexWrap: 'wrap',
                                                        width: '100%'
                                                    }}>
                                                        {product.asin && (
                                                            <span style={{
                                                                fontSize: '10px',
                                                                fontWeight: 500,
                                                                color: COLORS.textMuted
                                                            }}>
                                                                {product.asin}
                                                            </span>
                                                        )}
                                                        {product.price && (
                                                            <span style={{
                                                                fontSize: '11px',
                                                                fontWeight: 600,
                                                                color: COLORS.accent
                                                            }}>
                                                                {product.price}
                                                            </span>
                                                        )}
                                                        {product.rating && (
                                                            <span style={{
                                                                fontSize: '10px',
                                                                fontWeight: 600,
                                                                color: COLORS.success,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '2px',
                                                                marginLeft: 'auto'
                                                            }}>
                                                                ⭐ {product.rating.split(' ')[0]}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                {selectionModes.listingProducts && (
                                                    <div style={{
                                                        width: '24px',
                                                        height: '24px',
                                                        borderRadius: '50%',
                                                        background: selected.has(product.image) ? COLORS.accent : COLORS.bgSecondary,
                                                        border: `2px solid ${selected.has(product.image) ? COLORS.accentDark : COLORS.border}`,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        flexShrink: 0,
                                                        marginTop: '2px',
                                                        boxShadow: selected.has(product.image) ? `0 0 10px ${COLORS.accentGlow}` : 'none',
                                                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                                                    }}>
                                                        {selected.has(product.image) && (
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4">
                                                                <polyline points="20 6 9 17 4 12" />
                                                            </svg>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}


                        {/* Description Section */}


                        {/* Empty state */}
                        {productData.productImages.length === 0 &&
                            productData.reviewImages.length === 0 &&
                            productData.videos.length === 0 &&
                            productData.listingProducts.length === 0 && (
                                <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    height: '250px',
                                    gap: '16px',
                                    textAlign: 'center',
                                    padding: '32px',
                                    background: COLORS.white,
                                    borderRadius: '12px',
                                    border: `1px solid ${COLORS.borderLight}`
                                }}>
                                    <div style={{
                                        width: '64px',
                                        height: '64px',
                                        borderRadius: '16px',
                                        background: COLORS.bgSecondary,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}>
                                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={COLORS.textMuted} strokeWidth="1.5">
                                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                                            <circle cx="12" cy="13" r="4" />
                                        </svg>
                                    </div>
                                    <div>
                                        <p style={{ margin: 0, fontWeight: 600, color: COLORS.textSecondary, fontSize: '15px' }}>No media found</p>
                                        <p style={{ margin: '6px 0 0', fontSize: '13px', color: COLORS.textMuted }}>
                                            Navigate to an Amazon product or search page
                                        </p>
                                    </div>
                                    <button
                                        onClick={handleRefresh}
                                        style={{
                                            marginTop: '8px',
                                            padding: '10px 20px',
                                            background: COLORS.accent,
                                            color: COLORS.white,
                                            border: 'none',
                                            borderRadius: '8px',
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Refresh
                                    </button>
                                </div>
                            )}
                    </div>
                ) : null}
            </main>

            {/* Footer */}
            {productData && getAllMedia().length > 0 && (
                <footer style={{
                    padding: '18px 22px 22px 22px',
                    background: COLORS.white,
                    borderTop: `1px solid ${COLORS.borderLight}`,
                    boxShadow: '0 -10px 30px rgba(0, 0, 0, 0.04)',
                    position: 'relative',
                    zIndex: 100
                }}>
                    {(Object.values(selectionModes).some(Boolean) || selected.size > 0) && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginBottom: '12px',
                            fontSize: '12px',
                            color: COLORS.textSecondary,
                            fontWeight: 600,
                            letterSpacing: '0.2px',
                            background: COLORS.bgSecondary,
                            padding: '6px 12px',
                            borderRadius: '8px',
                            width: 'fit-content',
                            margin: '0 auto 14px auto'
                        }}>
                            <span>
                                {selected.size} / {getAllMedia().length} selected
                                <span style={{ color: COLORS.textMuted, marginLeft: '6px', fontWeight: 500 }}>
                                    ({productData.pageType === 'listing'
                                        ? `${filteredListingProducts.length} Products`
                                        : `${productData.productImages.length + productData.reviewImages.length} Images`
                                    })
                                </span>
                            </span>
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
                        <button
                            onClick={downloadSelected}
                            disabled={selected.size === 0 || downloading}
                            title={selected.size === 0 ? "Select items above to create a ZIP" : ""}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                padding: '12px',
                                background: 'transparent',
                                border: `2px solid ${selected.size > 0 ? COLORS.accent : COLORS.borderSubtle}`,
                                borderRadius: '10px',
                                cursor: selected.size === 0 || downloading ? 'not-allowed' : 'pointer',
                                fontWeight: 700,
                                fontSize: '13px',
                                color: selected.size > 0 ? COLORS.accent : COLORS.textLight,
                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                boxShadow: selected.size > 0 ? COLORS.shadowXs : 'none',
                                flex: 1
                            }}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                            </svg>
                            <span style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                            }}>
                                ZIP {selected.size > 0 ? `(${selected.size})` : 'Selected'}
                            </span>
                        </button>
                        <button
                            onClick={downloadAll}
                            disabled={downloading}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                padding: '12px',
                                background: COLORS.accentGradient,
                                border: 'none',
                                borderRadius: '10px',
                                cursor: downloading ? 'not-allowed' : 'pointer',
                                fontWeight: 700,
                                fontSize: '13px',
                                color: COLORS.white,
                                boxShadow: COLORS.shadowAccent,
                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                transform: downloading ? 'none' : 'translateY(0)',
                                flex: 1.2
                            }}
                        >
                            {downloading ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }}>
                                    <path d="M23 4v6h-6M1 20v-6h6" />
                                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                                </svg>
                            ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                            )}
                            {downloading ? 'Processing...' : 'Download All'}
                        </button>
                    </div>
                </footer>
            )}



            <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        html, body {
          font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        button {
          font-family: inherit;
          outline: none;
        }
        button:focus-visible {
          box-shadow: 0 0 0 2px ${COLORS.accentLight}, 0 0 0 4px ${COLORS.accent};
        }
        button:hover:not(:disabled) {
          filter: brightness(0.98);
        }
        button:active:not(:disabled) {
          transform: scale(0.98);
        }
        img {
          user-select: none;
          -webkit-user-drag: none;
        }
        ::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: ${COLORS.borderFocus};
          border-radius: 10px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: ${COLORS.textLight};
        }
        ::selection {
          background: ${COLORS.accentLight};
          color: ${COLORS.accentDark};
        }
        .group:hover {
          transform: translateY(-2px);
          box-shadow: ${COLORS.shadowMd} !important;
        }
        .group:hover .download-btn {
          opacity: 1 !important;
          transform: translateY(0) scale(1) !important;
        }
        .download-btn:hover {
          background: ${COLORS.bg} !important;
          transform: scale(1.1) !important;
        }
      `}</style>
        </div>
    );

}

export default PanelApp;
