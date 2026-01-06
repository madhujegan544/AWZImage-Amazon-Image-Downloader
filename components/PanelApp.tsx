import { useState, useEffect } from 'react';

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
    description: string;
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
    bg: '#fafbfc',
    bgSecondary: '#f4f6f8',
    bgHover: '#eef1f4',
    border: '#e8ecf0',
    borderLight: '#f0f3f6',
    text: '#2d3748',
    textSecondary: '#64748b',
    textMuted: '#94a3b8',
    accent: '#f97316',
    accentLight: '#fff7ed',
    accentDark: '#ea580c',
    success: '#10b981',
    successLight: '#ecfdf5',
    purple: '#8b5cf6',
    purpleLight: '#f5f3ff',
    blue: '#3b82f6',
    blueLight: '#eff6ff',
    white: '#ffffff'
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
        reviewImages: false,
        videos: false,
        reviewVideos: false,
        description: false,
        listingProducts: true
    });
    const [selectionModes, setSelectionModes] = useState<Record<string, boolean>>({});

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
                description: '',
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

    const selectAllInCategory = (urls: string[]) => {
        const allSelected = urls.every(url => selected.has(url));
        const next = new Set(selected);
        if (allSelected) {
            urls.forEach(url => next.delete(url));
        } else {
            urls.forEach(url => next.add(url));
        }
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

    const renderMediaGrid = (urls: string[], type: 'image' | 'video', isSelectionActive: boolean) => (
        <div style={{
            display: 'grid',
            gridTemplateColumns: type === 'video' ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
            gap: '10px',
            padding: '14px 16px'
        }}>
            {urls.map((url, i) => (
                <div
                    key={url}
                    onClick={() => type !== 'video' && isSelectionActive && toggleSelect(url)}
                    style={{
                        position: 'relative',
                        aspectRatio: type === 'video' ? '16/9' : '1',
                        borderRadius: '10px',
                        overflow: 'hidden',
                        border: selected.has(url) ? `2px solid ${COLORS.accent}` : `1px solid ${COLORS.border}`,
                        cursor: type === 'video' ? 'default' : (isSelectionActive ? 'pointer' : 'default'),
                        background: type === 'video' ? '#000' : COLORS.white,
                        transition: 'all 0.15s ease',
                        boxShadow: selected.has(url) ? `0 0 0 3px ${COLORS.accentLight}` : '0 1px 3px rgba(0,0,0,0.04)'
                    }}
                    className="group"
                >
                    {type === 'video' ? (
                        <video
                            src={url}
                            autoPlay
                            muted
                            loop
                            playsInline
                            controls
                            preload="metadata"
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'contain'
                            }}
                        />
                    ) : (
                        <img
                            src={url}
                            alt={`${type} ${i + 1}`}
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'contain',
                                padding: '6px',
                                background: COLORS.white
                            }}
                        />
                    )}

                    {/* Selection indicator - Only show if selection is active */}
                    {isSelectionActive && (
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
                                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                                cursor: 'pointer',
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
                    <div
                        onClick={(e) => {
                            e.stopPropagation();
                            handleSingleDownload(url, type);
                        }}
                        style={{
                            position: 'absolute',
                            bottom: '6px',
                            right: '6px',
                            width: '28px',
                            height: '28px',
                            borderRadius: '50%',
                            background: COLORS.white,
                            border: `1px solid ${COLORS.border}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                            cursor: 'pointer',
                            zIndex: 10,
                            opacity: 0.9,
                            transition: 'all 0.2s ease'
                        }}
                        title="Download"
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'scale(1.1)';
                            e.currentTarget.style.opacity = '1';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'scale(1)';
                            e.currentTarget.style.opacity = '0.9';
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={COLORS.text} strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                    </div>
                </div>
            ))}
        </div>
    );

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
        const allSelected = urls.every(url => selected.has(url));
        const isSelectionMode = selectionModes[sectionKey] || false;

        return (
            <div style={{
                marginBottom: '8px',
                background: COLORS.white,
                borderRadius: '12px',
                border: `1px solid ${COLORS.borderLight}`,
                overflow: 'hidden'
            }}>
                {/* Section Header */}
                <div
                    onClick={() => toggleSection(sectionKey)}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 16px',
                        cursor: 'pointer',
                        background: COLORS.white,
                        transition: 'background 0.15s ease'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '8px',
                            background: iconColor === COLORS.accent ? COLORS.accentLight :
                                iconColor === COLORS.success ? COLORS.successLight : COLORS.purpleLight,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            {iconPath}
                        </div>
                        <div>
                            <span style={{ fontWeight: 600, fontSize: '15px', color: COLORS.text }}>{title}</span>
                            <span style={{
                                marginLeft: '8px',
                                background: COLORS.bgSecondary,
                                padding: '2px 8px',
                                borderRadius: '10px',
                                fontSize: '12px',
                                fontWeight: 600,
                                color: COLORS.textSecondary
                            }}>
                                {count}
                            </span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setSelectionModes(prev => ({
                                    ...prev,
                                    [sectionKey]: !prev[sectionKey]
                                }));
                            }}
                            style={{
                                padding: '5px 12px',
                                fontSize: '11px',
                                fontWeight: 600,
                                background: isSelectionMode ? COLORS.purpleLight : COLORS.bgSecondary,
                                border: `1px solid ${isSelectionMode ? COLORS.purple : 'transparent'}`,
                                borderRadius: '6px',
                                cursor: 'pointer',
                                color: isSelectionMode ? COLORS.purple : COLORS.textSecondary,
                                transition: 'all 0.15s ease'
                            }}
                        >
                            Select
                        </button>

                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (!isSelectionMode) {
                                    setSelectionModes(prev => ({ ...prev, [sectionKey]: true }));
                                }
                                selectAllInCategory(urls);
                            }}
                            style={{
                                padding: '5px 10px',
                                fontSize: '11px',
                                fontWeight: 600,
                                background: allSelected ? COLORS.accentLight : COLORS.bgSecondary,
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                color: allSelected ? COLORS.accentDark : COLORS.textSecondary,
                                transition: 'all 0.15s ease'
                            }}
                        >
                            {allSelected ? 'Deselect' : 'Select All'}
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
                </div>

                {/* Section Content */}
                {isExpanded && renderMediaGrid(urls, type, isSelectionMode)}
            </div>
        );
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
            background: COLORS.bg,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            color: COLORS.text,
            overflow: 'hidden'
        }}>
            {/* Header */}
            <header style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                background: COLORS.white,
                borderBottom: `1px solid ${COLORS.border}`
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.12)'
                    }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                            <circle cx="12" cy="13" r="4" />
                        </svg>
                    </div>
                    <div>
                        <h1 style={{ margin: 0, fontSize: '17px', fontWeight: 700, letterSpacing: '-0.3px', color: COLORS.text }}>
                            AMZ<span style={{ color: COLORS.accent }}>IMAGE</span>
                        </h1>
                        <p style={{ margin: 0, fontSize: '11px', color: COLORS.textMuted, fontWeight: 500 }}>
                            Image Downloader
                        </p>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                        onClick={handleRefresh}
                        style={{
                            width: '34px',
                            height: '34px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: loading ? COLORS.accentLight : COLORS.bgSecondary,
                            border: 'none',
                            cursor: loading ? 'default' : 'pointer',
                            borderRadius: '8px',
                            color: loading ? COLORS.accent : COLORS.textSecondary,
                            transition: 'all 0.2s ease'
                        }}
                        title="Refresh"
                    >
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
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
                            width: '34px',
                            height: '34px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: COLORS.bgSecondary,
                            border: 'none',
                            cursor: 'pointer',
                            borderRadius: '8px',
                            color: COLORS.textSecondary,
                            transition: 'all 0.15s ease'
                        }}
                        title="Sign Out"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                    </button>
                </div>
            </header>

            {/* Product Info (for product pages) */}
            {productData && !loading && productData.pageType === 'product' && productData.asin && (
                <div style={{
                    padding: '14px 20px',
                    background: COLORS.white,
                    borderBottom: `1px solid ${COLORS.border}`
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <span style={{
                            background: COLORS.accent,
                            color: COLORS.white,
                            padding: '3px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            letterSpacing: '0.3px'
                        }}>
                            {productData.asin}
                        </span>
                        {productData.variant && (
                            <span style={{
                                background: COLORS.bgSecondary,
                                color: COLORS.textSecondary,
                                padding: '3px 10px',
                                borderRadius: '6px',
                                fontSize: '11px',
                                fontWeight: 600
                            }}>
                                {productData.variant}
                            </span>
                        )}
                    </div>
                    <p style={{
                        margin: 0,
                        fontSize: '15px',
                        color: COLORS.text,
                        lineHeight: 1.5,
                        fontWeight: 500
                    }}>
                        {productData.title}
                    </p>
                </div>
            )}

            {/* Listing Info (for search/category pages) */}
            {productData && !loading && productData.pageType === 'listing' && (
                <div style={{
                    padding: '14px 20px',
                    background: COLORS.white,
                    borderBottom: `1px solid ${COLORS.border}`
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <span style={{
                            background: COLORS.blue,
                            color: COLORS.white,
                            padding: '3px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700
                        }}>
                            LISTING PAGE
                        </span>
                        <span style={{
                            background: COLORS.bgSecondary,
                            color: COLORS.textSecondary,
                            padding: '3px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 600
                        }}>
                            {productData.listingProducts.length} products
                        </span>
                    </div>
                    <p style={{
                        margin: 0,
                        fontSize: '13px',
                        color: COLORS.text,
                        lineHeight: 1.5,
                        fontWeight: 500
                    }}>
                        {productData.title}
                    </p>
                </div>
            )}

            {/* Main Content */}
            <main style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
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
                        {/* Product Images Section */}
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

                        {/* Product Videos Section */}
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

                        {/* Review Images Section */}
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

                        {/* Review Videos Section */}
                        {renderSection(
                            'Review Videos',
                            productData.reviewVideos.length,
                            productData.reviewVideos,
                            'reviewVideos',
                            COLORS.blue,
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.blue} strokeWidth="2">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                <polygon points="10 8 16 12 10 16 10 8" />
                            </svg>,
                            'video'
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
                                        padding: '14px 16px',
                                        cursor: 'pointer',
                                        background: COLORS.white
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
                                        <div>
                                            <span style={{ fontWeight: 600, fontSize: '14px', color: COLORS.text }}>Listed Products</span>
                                            <span style={{
                                                marginLeft: '8px',
                                                background: COLORS.bgSecondary,
                                                padding: '2px 8px',
                                                borderRadius: '10px',
                                                fontSize: '12px',
                                                fontWeight: 600,
                                                color: COLORS.textSecondary
                                            }}>
                                                {productData.listingProducts.length}
                                            </span>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const urls = productData.listingProducts.map(p => p.image);
                                                selectAllInCategory(urls);
                                            }}
                                            style={{
                                                padding: '5px 10px',
                                                fontSize: '11px',
                                                fontWeight: 600,
                                                background: productData.listingProducts.every(p => selected.has(p.image)) ? COLORS.accentLight : COLORS.bgSecondary,
                                                border: 'none',
                                                borderRadius: '6px',
                                                cursor: 'pointer',
                                                color: productData.listingProducts.every(p => selected.has(p.image)) ? COLORS.accentDark : COLORS.textSecondary
                                            }}
                                        >
                                            {productData.listingProducts.every(p => selected.has(p.image)) ? 'Deselect' : 'Select All'}
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
                                    <div style={{ padding: '0 16px 16px' }}>
                                        {productData.listingProducts.map((product, index) => (
                                            <div
                                                key={product.asin || index}
                                                onClick={() => toggleSelect(product.image)}
                                                style={{
                                                    display: 'flex',
                                                    gap: '12px',
                                                    padding: '12px',
                                                    marginBottom: '8px',
                                                    background: selected.has(product.image) ? COLORS.accentLight : COLORS.bgSecondary,
                                                    borderRadius: '10px',
                                                    cursor: 'pointer',
                                                    border: selected.has(product.image) ? `2px solid ${COLORS.accent}` : '2px solid transparent',
                                                    transition: 'all 0.15s ease'
                                                }}
                                            >
                                                <div style={{
                                                    width: '60px',
                                                    height: '60px',
                                                    borderRadius: '8px',
                                                    overflow: 'hidden',
                                                    background: COLORS.white,
                                                    flexShrink: 0
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
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <p style={{
                                                        margin: 0,
                                                        fontSize: '12px',
                                                        fontWeight: 500,
                                                        color: COLORS.text,
                                                        lineHeight: 1.4,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        display: '-webkit-box',
                                                        WebkitLineClamp: 2,
                                                        WebkitBoxOrient: 'vertical'
                                                    }}>
                                                        {product.title}
                                                    </p>
                                                    <div style={{
                                                        display: 'flex',
                                                        gap: '8px',
                                                        marginTop: '6px',
                                                        alignItems: 'center'
                                                    }}>
                                                        {product.asin && (
                                                            <span style={{
                                                                fontSize: '10px',
                                                                fontWeight: 600,
                                                                color: COLORS.textMuted,
                                                                background: COLORS.white,
                                                                padding: '2px 6px',
                                                                borderRadius: '4px'
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
                                                                color: COLORS.textSecondary
                                                            }}>
                                                                ⭐ {product.rating.split(' ')[0]}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div style={{
                                                    width: '20px',
                                                    height: '20px',
                                                    borderRadius: '50%',
                                                    background: selected.has(product.image) ? COLORS.accent : COLORS.border,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    flexShrink: 0
                                                }}>
                                                    {selected.has(product.image) && (
                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                                                            <polyline points="20 6 9 17 4 12" />
                                                        </svg>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}


                        {/* Description Section */}
                        {productData.description && (
                            <div style={{
                                marginBottom: '8px',
                                background: COLORS.white,
                                borderRadius: '12px',
                                border: `1px solid ${COLORS.borderLight}`,
                                overflow: 'hidden'
                            }}>
                                <div
                                    onClick={() => toggleSection('description')}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '14px 16px',
                                        cursor: 'pointer',
                                        background: COLORS.white
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <div style={{
                                            width: '32px',
                                            height: '32px',
                                            borderRadius: '8px',
                                            background: COLORS.bgSecondary,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.textSecondary} strokeWidth="2">
                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                                <polyline points="14 2 14 8 20 8" />
                                                <line x1="16" y1="13" x2="8" y2="13" />
                                                <line x1="16" y1="17" x2="8" y2="17" />
                                            </svg>
                                        </div>
                                        <span style={{ fontWeight: 600, fontSize: '14px', color: COLORS.text }}>Description</span>
                                    </div>
                                    <svg
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke={COLORS.textMuted}
                                        strokeWidth="2"
                                        style={{
                                            transform: expandedSections.description ? 'rotate(180deg)' : 'rotate(0deg)',
                                            transition: 'transform 0.2s ease'
                                        }}
                                    >
                                        <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                </div>
                                {expandedSections.description && (
                                    <div style={{
                                        padding: '0 16px 16px',
                                        fontSize: '13px',
                                        lineHeight: 1.6,
                                        color: COLORS.textSecondary
                                    }}>
                                        {productData.description}
                                    </div>
                                )}
                            </div>
                        )}

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
                    padding: '16px 20px',
                    background: COLORS.white,
                    borderTop: `1px solid ${COLORS.border}`
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '14px',
                        fontSize: '13px'
                    }}>
                        <span style={{ color: COLORS.textSecondary }}>
                            <strong style={{ color: COLORS.text }}>{selected.size}</strong> of {getAllMedia().length} selected
                        </span>
                        <span style={{ color: COLORS.textMuted, fontSize: '12px' }}>
                            {productData.pageType === 'listing'
                                ? `${productData.listingProducts.length} products`
                                : `${productData.productImages.length} images • ${productData.reviewImages.length} reviews • ${productData.videos.length + productData.reviewVideos.length} videos`
                            }
                        </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                        <button
                            onClick={downloadSelected}
                            disabled={selected.size === 0 || downloading}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                padding: '12px',
                                background: COLORS.bgSecondary,
                                border: `1px solid ${COLORS.border}`,
                                borderRadius: '10px',
                                cursor: selected.size === 0 || downloading ? 'not-allowed' : 'pointer',
                                fontWeight: 600,
                                fontSize: '13px',
                                color: COLORS.text,
                                opacity: selected.size === 0 || downloading ? 0.5 : 1,
                                transition: 'all 0.15s ease'
                            }}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                            </svg>
                            ZIP Selected
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
                                background: `linear-gradient(135deg, ${COLORS.accentDark} 0%, ${COLORS.accent} 100%)`,
                                border: 'none',
                                borderRadius: '10px',
                                cursor: downloading ? 'not-allowed' : 'pointer',
                                fontWeight: 600,
                                fontSize: '13px',
                                color: COLORS.white,
                                boxShadow: '0 2px 8px rgba(249, 115, 22, 0.25)',
                                transition: 'all 0.15s ease'
                            }}
                        >
                            {downloading ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                                    <path d="M23 4v6h-6M1 20v-6h6" />
                                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                                </svg>
                            ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
        * {
          box-sizing: border-box;
        }
        ::-webkit-scrollbar {
          width: 6px;
        }
        ::-webkit-scrollbar-track {
          background: ${COLORS.bg};
        }
        ::-webkit-scrollbar-thumb {
          background: ${COLORS.border};
          border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: ${COLORS.textMuted};
        }
      `}</style>
        </div>
    );
}

export default PanelApp;
