/**
 * PIXORA - Premium Amazon Media Downloader
 * Main Panel Application Component
 * Version 2.2.0 - With Preview & Variant Selection
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import './App.css';
import Welcome from './Welcome';
import Login from './Login';

// ============================================
// Types
// ============================================
interface ProductVariant {
    asin: string;
    name: string;
    image?: string;
    available: boolean;
    selected: boolean;
}

interface ListingProduct {
    asin: string;
    title: string;
    image: string;
    price?: string;
    rating?: string;
}

interface ProductData {
    asin: string;
    title: string;
    variant?: string;
    productImages: string[];
    reviewImages: string[];
    productVideos?: string[];
    reviewVideos?: string[];
    videos?: string[];
    variants: ProductVariant[];
    listingProducts: ListingProduct[];
    pageType: 'product' | 'listing';
}

interface MediaItem {
    url: string;
    type: 'image' | 'video';
    source: 'product' | 'review';
    category: 'productImage' | 'reviewImage' | 'productVideo' | 'reviewVideo';
}

interface PanelAppProps {
    onClose?: () => void;
    scrapeProductData: () => Promise<ProductData | null>;
    downloadZip: (urls: string[], filename: string) => Promise<void>;
    showPreview?: (url: string, mediaType: 'image' | 'video', allUrls: string[]) => Promise<void>;
    selectVariant?: (asin: string) => Promise<boolean>;
}

type ViewState = 'welcome' | 'login' | 'main';
type CategoryFilter = 'all' | 'productImages' | 'reviewImages' | 'videos';

// ============================================
// Design Tokens
// ============================================
const COLORS = {
    primary: '#2563EB',
    primaryHover: '#1D4ED8',
    primarySoft: '#EFF6FF',
    primaryGlow: 'rgba(37, 99, 235, 0.15)',

    surface: '#FFFFFF',
    background: '#F8FAFC',
    backgroundSecondary: '#F1F5F9',

    text: '#0F172A',
    textSecondary: '#475569',
    textMuted: '#94A3B8',
    textInverse: '#FFFFFF',

    border: '#E2E8F0',
    borderLight: '#F1F5F9',

    success: '#10B981',
    successSoft: '#ECFDF5',
    warning: '#F59E0B',
    warningSoft: '#FFFBEB',

    shadowSm: '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
    shadowMd: '0 4px 6px -1px rgba(0, 0, 0, 0.07), 0 2px 4px -1px rgba(0, 0, 0, 0.04)',
    shadowLg: '0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -2px rgba(0, 0, 0, 0.04)',
    shadowPrimary: '0 4px 14px rgba(37, 99, 235, 0.25)',
};

const INITIAL_ITEMS_COUNT = 9;

// ============================================
// Utility Functions
// ============================================
const truncateText = (text: string, maxLength: number): string => {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
};

const getMediaItems = (data: ProductData | null): MediaItem[] => {
    if (!data) return [];

    const items: MediaItem[] = [];

    (data.productImages || []).forEach(url => {
        items.push({ url, type: 'image', source: 'product', category: 'productImage' });
    });

    (data.productVideos || data.videos || []).forEach(url => {
        items.push({ url, type: 'video', source: 'product', category: 'productVideo' });
    });

    (data.reviewImages || []).forEach(url => {
        items.push({ url, type: 'image', source: 'review', category: 'reviewImage' });
    });

    (data.reviewVideos || []).forEach(url => {
        items.push({ url, type: 'video', source: 'review', category: 'reviewVideo' });
    });

    return items;
};

// ============================================
// Main Component
// ============================================
function PanelApp({ scrapeProductData, downloadZip, showPreview, selectVariant }: PanelAppProps) {
    // View State
    const [view, setView] = useState<ViewState>('main');

    // Data State
    const [productData, setProductData] = useState<ProductData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [downloading, setDownloading] = useState(false);
    const [downloadSuccess, setDownloadSuccess] = useState(false);

    // Selection State
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [isSelectionMode, setIsSelectionMode] = useState(false);

    // UI State
    const [searchTerm, setSearchTerm] = useState('');
    const [activeSearchTerm, setActiveSearchTerm] = useState('');
    const [variantDropdownOpen, setVariantDropdownOpen] = useState(false);
    const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('productImages');
    const [showAllItems, setShowAllItems] = useState(false);
    const [selectingVariant, setSelectingVariant] = useState(false);

    // Derived state
    const allMediaItems = useMemo(() => getMediaItems(productData), [productData]);
    const isProductPage = productData?.pageType === 'product';
    const isListingPage = productData?.pageType === 'listing';

    // Filtered media items based on category
    const filteredMediaItems = useMemo(() => {
        if (categoryFilter === 'all') return allMediaItems;
        if (categoryFilter === 'productImages') return allMediaItems.filter(i => i.category === 'productImage');
        if (categoryFilter === 'reviewImages') return allMediaItems.filter(i => i.category === 'reviewImage');
        if (categoryFilter === 'videos') return allMediaItems.filter(i => i.category === 'productVideo' || i.category === 'reviewVideo');
        return allMediaItems;
    }, [allMediaItems, categoryFilter]);

    // URLs for preview navigation (same type only)
    const getPreviewUrls = (item: MediaItem): string[] => {
        return filteredMediaItems.filter(i => i.type === item.type).map(i => i.url);
    };

    // Category counts
    const categoryCounts = useMemo(() => ({
        all: allMediaItems.length,
        productImages: allMediaItems.filter(i => i.category === 'productImage').length,
        reviewImages: allMediaItems.filter(i => i.category === 'reviewImage').length,
        videos: allMediaItems.filter(i => i.category === 'productVideo' || i.category === 'reviewVideo').length,
    }), [allMediaItems]);

    // Items to display
    const displayedItems = showAllItems ? filteredMediaItems : filteredMediaItems.slice(0, INITIAL_ITEMS_COUNT);
    const hasMoreItems = filteredMediaItems.length > INITIAL_ITEMS_COUNT;
    const hiddenCount = filteredMediaItems.length - INITIAL_ITEMS_COUNT;

    const totalCount = filteredMediaItems.length;
    const selectedCount = selectedItems.size;

    // Filtered listing products
    const filteredListingProducts = productData?.listingProducts?.filter(p =>
        !activeSearchTerm ||
        p.title?.toLowerCase().includes(activeSearchTerm.toLowerCase()) ||
        p.asin?.toLowerCase().includes(activeSearchTerm.toLowerCase())
    ) || [];

    // Available variants
    const availableVariants = productData?.variants?.filter(v => v.available) || [];
    const selectedVariantData = availableVariants.find(v => v.selected);

    // ============================================
    // Data Loading
    // ============================================
    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        setShowAllItems(false);
        try {
            const data = await scrapeProductData();
            if (data) {
                setProductData(data);
            } else {
                setError('No data found on this page.');
            }
        } catch (err) {
            console.error('Failed to load data:', err);
            setError('Could not connect to the page. Make sure you are on an Amazon product page.');
        } finally {
            setLoading(false);
        }
    }, [scrapeProductData]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = () => setVariantDropdownOpen(false);
        if (variantDropdownOpen) {
            document.addEventListener('click', handleClickOutside);
            return () => document.removeEventListener('click', handleClickOutside);
        }
    }, [variantDropdownOpen]);

    // ============================================
    // Preview Function
    // ============================================
    const handlePreview = (item: MediaItem) => {
        if (showPreview) {
            const urls = getPreviewUrls(item);
            showPreview(item.url, item.type, urls);
        }
    };

    // ============================================
    // Variant Selection
    // ============================================
    const handleVariantSelect = async (asin: string, variantName: string) => {
        if (!selectVariant || selectingVariant) return;

        setSelectingVariant(true);
        setVariantDropdownOpen(false);

        try {
            const success = await selectVariant(asin);

            if (success) {
                // Wait for Amazon page to update, then poll for new data
                // Amazon takes 1-3 seconds to update images after variant click
                let attempts = 0;
                const maxAttempts = 4;

                const pollData = async () => {
                    attempts++;
                    await new Promise(resolve => setTimeout(resolve, 800));

                    try {
                        const newData = await scrapeProductData();
                        if (newData) {
                            // Check if variant actually changed
                            const newVariant = newData.variants?.find(v => v.selected);
                            if (newVariant?.asin === asin || attempts >= maxAttempts) {
                                setProductData(newData);
                                setSelectingVariant(false);
                                return;
                            }
                        }
                    } catch (e) {
                        console.error('Poll error:', e);
                    }

                    if (attempts < maxAttempts) {
                        await pollData();
                    } else {
                        // Final attempt
                        loadData();
                        setSelectingVariant(false);
                    }
                };

                await pollData();
            } else {
                console.warn('Variant selection failed on page');
                setSelectingVariant(false);
            }
        } catch (err) {
            console.error('Failed to select variant:', err);
            setSelectingVariant(false);
        }
    };

    // ============================================
    // Download Functions
    // ============================================
    const downloadAll = async () => {
        if (!productData) return;

        const urls = isProductPage
            ? filteredMediaItems.map(item => item.url)
            : filteredListingProducts.map(p => p.image);

        if (urls.length === 0) return;

        setDownloading(true);
        setDownloadSuccess(false);
        try {
            const categoryLabel = categoryFilter === 'all' ? 'all' : categoryFilter;
            const filename = `pixora-${productData.asin || 'media'}-${categoryLabel}-${Date.now()}`;
            await downloadZip(urls, filename);
            setDownloadSuccess(true);
            setTimeout(() => setDownloadSuccess(false), 3000);
        } catch (err) {
            console.error('Download failed:', err);
        } finally {
            setTimeout(() => setDownloading(false), 500);
        }
    };

    const downloadSelected = async () => {
        if (selectedCount === 0) return;

        setDownloading(true);
        setDownloadSuccess(false);
        try {
            const urls = Array.from(selectedItems);
            const filename = `pixora-selected-${Date.now()}`;
            await downloadZip(urls, filename);
            setDownloadSuccess(true);
            setSelectedItems(new Set());
            setIsSelectionMode(false);
            setTimeout(() => setDownloadSuccess(false), 3000);
        } catch (err) {
            console.error('Download failed:', err);
        } finally {
            setTimeout(() => setDownloading(false), 500);
        }
    };

    const downloadSingle = async (url: string) => {
        try {
            const filename = `pixora-${Date.now()}`;
            await downloadZip([url], filename);
        } catch (err) {
            console.error('Single download failed:', err);
        }
    };

    const downloadAllVariants = async () => {
        if (availableVariants.length === 0) return;

        setDownloading(true);
        setDownloadSuccess(false);
        setVariantDropdownOpen(false);
        try {
            const urls = allMediaItems.map(item => item.url);
            const filename = `pixora-${productData?.asin || 'product'}-all-variants-${Date.now()}`;
            await downloadZip(urls, filename);
            setDownloadSuccess(true);
            setTimeout(() => setDownloadSuccess(false), 3000);
        } catch (err) {
            console.error('Download all variants failed:', err);
        } finally {
            setTimeout(() => setDownloading(false), 500);
        }
    };

    // ============================================
    // Selection Functions
    // ============================================
    const toggleSelection = (url: string, e: React.MouseEvent) => {
        // Only toggle selection on checkbox click or when in selection mode
        e.stopPropagation();

        const newSelected = new Set(selectedItems);
        if (newSelected.has(url)) {
            newSelected.delete(url);
        } else {
            newSelected.add(url);
        }
        setSelectedItems(newSelected);

        if (newSelected.size > 0 && !isSelectionMode) {
            setIsSelectionMode(true);
        }
        if (newSelected.size === 0) {
            setIsSelectionMode(false);
        }
    };

    const clearSelection = () => {
        setSelectedItems(new Set());
        setIsSelectionMode(false);
    };

    const handleRefresh = () => {
        setSelectedItems(new Set());
        setIsSelectionMode(false);
        setSearchTerm('');
        setActiveSearchTerm('');
        setCategoryFilter('productImages');
        setShowAllItems(false);
        loadData();
    };

    // ============================================
    // Welcome/Login Views
    // ============================================
    if (view === 'welcome') {
        return <Welcome onGetStarted={() => setView('login')} />;
    }

    if (view === 'login') {
        return <Login onLogin={() => setView('main')} />;
    }

    // ============================================
    // Render Functions
    // ============================================

    // Loading Skeleton
    const renderLoading = () => (
        <div style={{ display: 'flex', flexDirection: 'column', padding: '20px', gap: '16px' }}>
            <div style={{ background: COLORS.surface, borderRadius: '14px', padding: '16px', boxShadow: COLORS.shadowSm }}>
                <div className="animate-shimmer" style={{ height: '12px', width: '60px', borderRadius: '6px', marginBottom: '8px' }} />
                <div className="animate-shimmer" style={{ height: '16px', width: '100%', borderRadius: '6px', marginBottom: '6px' }} />
                <div className="animate-shimmer" style={{ height: '16px', width: '80%', borderRadius: '6px' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                {[...Array(9)].map((_, i) => (
                    <div key={i} className="animate-shimmer" style={{ aspectRatio: '1', borderRadius: '12px' }} />
                ))}
            </div>
        </div>
    );

    // Empty State
    const renderEmpty = () => (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px 32px',
            textAlign: 'center',
            flex: 1
        }}>
            <div style={{
                width: '80px',
                height: '80px',
                borderRadius: '20px',
                background: COLORS.primarySoft,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px'
            }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={COLORS.primary} strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                </svg>
            </div>

            <h3 style={{ fontSize: '16px', fontWeight: 600, color: COLORS.text, marginBottom: '8px' }}>
                No media found
            </h3>

            <p style={{ fontSize: '13px', color: COLORS.textMuted, lineHeight: 1.5, maxWidth: '240px', marginBottom: '24px' }}>
                {error || 'Make sure you are on an Amazon product page and try refreshing.'}
            </p>

            <button
                onClick={handleRefresh}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 20px',
                    background: COLORS.surface,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '10px',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: COLORS.text,
                    boxShadow: COLORS.shadowSm,
                    cursor: 'pointer'
                }}
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 4v6h-6M1 20v-6h6" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                Refresh
            </button>
        </div>
    );

    // Category Tabs
    const renderCategoryTabs = () => (
        <div style={{
            display: 'flex',
            gap: '6px',
            padding: '12px 16px',
            background: COLORS.surface,
            borderBottom: `1px solid ${COLORS.borderLight}`,
            overflowX: 'auto'
        }}>
            {[
                { key: 'productImages' as CategoryFilter, label: 'Product', count: categoryCounts.productImages },
                { key: 'reviewImages' as CategoryFilter, label: 'Reviews', count: categoryCounts.reviewImages },
                { key: 'videos' as CategoryFilter, label: 'Videos', count: categoryCounts.videos },
            ].map(tab => (
                <button
                    key={tab.key}
                    onClick={() => { setCategoryFilter(tab.key); setShowAllItems(false); }}
                    disabled={tab.count === 0}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: 'none',
                        background: categoryFilter === tab.key ? COLORS.primary : COLORS.background,
                        color: categoryFilter === tab.key ? '#fff' : COLORS.textSecondary,
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: tab.count === 0 ? 'not-allowed' : 'pointer',
                        opacity: tab.count === 0 ? 0.4 : 1,
                        transition: 'all 0.2s ease',
                        whiteSpace: 'nowrap'
                    }}
                >
                    {tab.label}
                    <span style={{
                        background: categoryFilter === tab.key ? 'rgba(255,255,255,0.2)' : COLORS.border,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '10px'
                    }}>
                        {tab.count}
                    </span>
                </button>
            ))}
        </div>
    );

    // Variant Dropdown
    const renderVariantDropdown = () => {
        if (availableVariants.length === 0) return null;

        return (
            <div style={{
                background: selectedVariantData ? COLORS.primarySoft : COLORS.surface,
                borderRadius: '12px',
                marginBottom: '12px',
                boxShadow: COLORS.shadowSm,
                overflow: 'visible',
                position: 'relative',
                border: selectedVariantData ? `2px solid ${COLORS.primary}` : 'none'
            }}>
                {/* Dropdown Trigger */}
                <div
                    onClick={(e) => { e.stopPropagation(); setVariantDropdownOpen(!variantDropdownOpen); }}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px',
                        cursor: selectingVariant ? 'wait' : 'pointer',
                        opacity: selectingVariant ? 0.7 : 1
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {selectedVariantData?.image ? (
                            <div style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: '10px',
                                background: `url(${selectedVariantData.image}) center/cover`,
                                border: `2px solid ${COLORS.primary}`,
                                boxShadow: COLORS.shadowSm
                            }} />
                        ) : (
                            <div style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: '10px',
                                background: COLORS.background,
                                border: `1px solid ${COLORS.border}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.textMuted} strokeWidth="1.5">
                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                    <circle cx="8.5" cy="8.5" r="1.5" />
                                    <polyline points="21 15 16 10 5 21" />
                                </svg>
                            </div>
                        )}
                        <div>
                            <p style={{
                                fontSize: '10px',
                                color: selectingVariant ? COLORS.warning : COLORS.primary,
                                fontWeight: 600,
                                marginBottom: '3px',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                            }}>
                                {selectingVariant ? '⏳ Switching...' : '✓ Selected Variant'}
                            </p>
                            <p style={{
                                fontSize: '16px',
                                fontWeight: 700,
                                color: COLORS.text,
                                lineHeight: 1.2
                            }}>
                                {selectedVariantData?.name || 'Choose a variant'}
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                            fontSize: '11px',
                            color: COLORS.primary,
                            background: COLORS.surface,
                            padding: '5px 10px',
                            borderRadius: '6px',
                            fontWeight: 600
                        }}>
                            {availableVariants.length} options
                        </span>
                        <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke={COLORS.primary}
                            strokeWidth="2.5"
                            style={{
                                transform: variantDropdownOpen ? 'rotate(180deg)' : 'rotate(0)',
                                transition: 'transform 0.2s ease'
                            }}
                        >
                            <polyline points="6 9 12 15 18 9" />
                        </svg>
                    </div>
                </div>

                {/* Dropdown Menu */}
                {variantDropdownOpen && (
                    <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        background: COLORS.surface,
                        borderRadius: '12px',
                        boxShadow: COLORS.shadowLg,
                        zIndex: 100,
                        marginTop: '4px',
                        maxHeight: '280px',
                        overflowY: 'auto',
                        border: `1px solid ${COLORS.border}`
                    }}>
                        {/* Download All Variants Option */}
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                downloadAllVariants();
                            }}
                            style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                padding: '12px 14px',
                                border: 'none',
                                borderBottom: `1px solid ${COLORS.border}`,
                                background: COLORS.primarySoft,
                                cursor: 'pointer',
                                textAlign: 'left'
                            }}
                        >
                            <div style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '8px',
                                background: COLORS.primary,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                            </div>
                            <div>
                                <p style={{ fontSize: '13px', fontWeight: 600, color: COLORS.primary }}>
                                    Download All Variants
                                </p>
                                <p style={{ fontSize: '11px', color: COLORS.textMuted }}>
                                    Get images from all {availableVariants.length} variants
                                </p>
                            </div>
                        </button>

                        {/* Variant Options */}
                        {availableVariants.map(variant => (
                            <div
                                key={variant.asin}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (!variant.selected) {
                                        handleVariantSelect(variant.asin, variant.name);
                                    }
                                }}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    padding: '10px 14px',
                                    cursor: variant.selected ? 'default' : 'pointer',
                                    background: variant.selected ? COLORS.primarySoft : 'transparent',
                                    borderLeft: variant.selected ? `3px solid ${COLORS.primary}` : '3px solid transparent',
                                    transition: 'background 0.2s ease'
                                }}
                            >
                                {variant.image ? (
                                    <div style={{
                                        width: '32px',
                                        height: '32px',
                                        borderRadius: '6px',
                                        background: `url(${variant.image}) center/cover`,
                                        border: `1px solid ${COLORS.border}`
                                    }} />
                                ) : (
                                    <div style={{
                                        width: '32px',
                                        height: '32px',
                                        borderRadius: '6px',
                                        background: COLORS.background,
                                        border: `1px solid ${COLORS.border}`
                                    }} />
                                )}
                                <div style={{ flex: 1 }}>
                                    <p style={{
                                        fontSize: '12px',
                                        fontWeight: variant.selected ? 600 : 500,
                                        color: variant.selected ? COLORS.primary : COLORS.text
                                    }}>
                                        {variant.name}
                                    </p>
                                </div>
                                {variant.selected && (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.primary} strokeWidth="2.5">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    // Media Item
    const renderMediaItem = (item: MediaItem, index: number) => {
        const isSelected = selectedItems.has(item.url);
        const isVideo = item.type === 'video';
        const isReview = item.source === 'review';

        return (
            <div
                key={`${item.url}-${index}`}
                onClick={() => handlePreview(item)}
                style={{
                    position: 'relative',
                    aspectRatio: '1',
                    borderRadius: '10px',
                    overflow: 'hidden',
                    background: COLORS.backgroundSecondary,
                    cursor: 'pointer',
                    border: isSelected ? `2px solid ${COLORS.primary}` : '2px solid transparent',
                    boxShadow: isSelected ? `0 0 0 2px ${COLORS.primaryGlow}` : 'none',
                    transition: 'all 0.2s ease'
                }}
                className="media-item"
            >
                {isVideo ? (
                    <video
                        src={item.url}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        muted
                        playsInline
                    />
                ) : (
                    <img
                        src={item.url}
                        alt=""
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                )}

                {/* Badges */}
                <div style={{ position: 'absolute', top: '4px', left: '4px', display: 'flex', gap: '3px' }}>
                    {isVideo && (
                        <span style={{
                            background: 'rgba(0,0,0,0.75)',
                            color: '#fff',
                            fontSize: '8px',
                            fontWeight: 600,
                            padding: '2px 5px',
                            borderRadius: '3px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '2px'
                        }}>
                            <svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                            VID
                        </span>
                    )}
                    {isReview && (
                        <span style={{
                            background: COLORS.warning,
                            color: '#fff',
                            fontSize: '8px',
                            fontWeight: 600,
                            padding: '2px 5px',
                            borderRadius: '3px'
                        }}>
                            REV
                        </span>
                    )}
                </div>

                {/* Selection Checkbox */}
                <div
                    onClick={(e) => toggleSelection(item.url, e)}
                    style={{
                        position: 'absolute',
                        top: '4px',
                        right: '4px',
                        width: '18px',
                        height: '18px',
                        borderRadius: '5px',
                        background: isSelected ? COLORS.primary : 'rgba(255,255,255,0.9)',
                        border: isSelected ? 'none' : `1.5px solid ${COLORS.border}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: COLORS.shadowSm,
                        transition: 'all 0.15s ease',
                        cursor: 'pointer'
                    }}
                >
                    {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    )}
                </div>

                {/* Hover Overlay with Preview & Download */}
                <div
                    className="media-hover-overlay"
                    style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.2) 50%, transparent 100%)',
                        opacity: 0,
                        transition: 'opacity 0.2s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        padding: '8px',
                        gap: '6px'
                    }}
                >
                    {/* Preview hint */}
                    <span style={{
                        fontSize: '9px',
                        color: 'rgba(255,255,255,0.8)',
                        fontWeight: 500
                    }}>
                        Click to preview
                    </span>

                    {/* Download button */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            downloadSingle(item.url);
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '6px 10px',
                            background: '#fff',
                            borderRadius: '6px',
                            fontSize: '10px',
                            fontWeight: 600,
                            color: COLORS.text,
                            boxShadow: COLORS.shadowMd,
                            cursor: 'pointer',
                            border: 'none'
                        }}
                        className="download-btn"
                    >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Save
                    </button>
                </div>
            </div>
        );
    };

    // Listing Product Item
    const renderListingProduct = (product: ListingProduct, index: number) => {
        const isSelected = selectedItems.has(product.image);

        return (
            <div
                key={product.asin}
                style={{
                    position: 'relative',
                    background: COLORS.surface,
                    borderRadius: '10px',
                    overflow: 'hidden',
                    boxShadow: COLORS.shadowSm,
                    cursor: 'pointer',
                    border: isSelected ? `2px solid ${COLORS.primary}` : '2px solid transparent',
                    transition: 'all 0.2s ease'
                }}
                className="listing-product"
            >
                <div
                    onClick={() => {
                        if (showPreview) {
                            showPreview(product.image, 'image', [product.image]);
                        }
                    }}
                    style={{ aspectRatio: '1', background: COLORS.backgroundSecondary, position: 'relative' }}
                >
                    <img
                        src={product.image}
                        alt={product.title}
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '6px' }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />

                    <div
                        onClick={(e) => toggleSelection(product.image, e)}
                        style={{
                            position: 'absolute',
                            top: '6px',
                            right: '6px',
                            width: '20px',
                            height: '20px',
                            borderRadius: '6px',
                            background: isSelected ? COLORS.primary : 'rgba(255,255,255,0.95)',
                            border: isSelected ? 'none' : `2px solid ${COLORS.border}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: COLORS.shadowSm,
                            cursor: 'pointer'
                        }}
                    >
                        {isSelected && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        )}
                    </div>
                </div>

                <div style={{ padding: '8px' }}>
                    <p style={{
                        fontSize: '11px',
                        fontWeight: 500,
                        color: COLORS.text,
                        lineHeight: 1.3,
                        marginBottom: '4px',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                    }}>
                        {truncateText(product.title, 50)}
                    </p>
                    <span style={{
                        fontSize: '9px',
                        fontWeight: 600,
                        color: COLORS.primary,
                        background: COLORS.primarySoft,
                        padding: '2px 5px',
                        borderRadius: '3px'
                    }}>
                        {product.asin}
                    </span>
                </div>
            </div>
        );
    };

    // Check if we have content
    const hasContent = isProductPage ? allMediaItems.length > 0 : filteredListingProducts.length > 0;
    const displayCount = isProductPage ? totalCount : filteredListingProducts.length;

    // ============================================
    // Main Render
    // ============================================
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
            background: COLORS.background,
            fontFamily: "'Google Sans Flex', 'Google Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
            color: COLORS.text,
            overflow: 'hidden'
        }}>
            {/* HEADER */}
            <header style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                background: COLORS.surface,
                borderBottom: `1px solid ${COLORS.borderLight}`,
                flexShrink: 0
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        background: `linear-gradient(135deg, ${COLORS.primary} 0%, #3B82F6 100%)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: COLORS.shadowPrimary
                    }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                    </div>
                    <div>
                        <h1 style={{ fontSize: '15px', fontWeight: 700, color: COLORS.text, lineHeight: 1.1 }}>Pixora</h1>
                        <p style={{ fontSize: '9px', color: COLORS.textMuted, fontWeight: 500 }}>Amazon Media</p>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {!loading && hasContent && (
                        <span style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '5px 8px',
                            background: COLORS.primarySoft,
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: COLORS.primary
                        }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            </svg>
                            {displayCount}
                        </span>
                    )}
                    <button
                        onClick={handleRefresh}
                        disabled={loading}
                        style={{
                            width: '32px',
                            height: '32px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: COLORS.background,
                            borderRadius: '8px',
                            color: loading ? COLORS.primary : COLORS.textSecondary,
                            border: `1px solid ${COLORS.border}`,
                            cursor: loading ? 'not-allowed' : 'pointer'
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                            style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}>
                            <path d="M23 4v6h-6M1 20v-6h6" />
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                    </button>
                </div>
            </header>

            {/* SEARCH BAR (Listing Pages) */}
            {!loading && isListingPage && (
                <div style={{ padding: '10px 14px', background: COLORS.surface, borderBottom: `1px solid ${COLORS.borderLight}` }}>
                    <div style={{ position: 'relative' }}>
                        <div style={{
                            position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)',
                            pointerEvents: 'none', color: COLORS.textMuted
                        }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                        </div>
                        <input
                            type="text"
                            placeholder="Search..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && setActiveSearchTerm(searchTerm)}
                            style={{
                                width: '100%',
                                padding: '10px 36px 10px 36px',
                                background: COLORS.background,
                                border: `1px solid ${COLORS.border}`,
                                borderRadius: '10px',
                                fontSize: '13px',
                                fontWeight: 500,
                                color: COLORS.text,
                                outline: 'none',
                                fontFamily: 'inherit'
                            }}
                        />
                        {searchTerm && (
                            <button
                                onClick={() => { setSearchTerm(''); setActiveSearchTerm(''); }}
                                style={{
                                    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                                    background: 'none', border: 'none', color: COLORS.textMuted, cursor: 'pointer', padding: '4px'
                                }}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* CATEGORY TABS (Product Pages) */}
            {!loading && isProductPage && hasContent && renderCategoryTabs()}

            {/* CONTENT */}
            <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                {loading ? renderLoading() : !hasContent ? renderEmpty() : (
                    <div style={{ padding: '14px' }}>
                        {/* Variant Dropdown (Product Pages) */}
                        {isProductPage && availableVariants.length > 0 && renderVariantDropdown()}

                        {/* Selection Banner */}
                        {isSelectionMode && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '8px 12px',
                                background: COLORS.primarySoft,
                                borderRadius: '8px',
                                marginBottom: '12px'
                            }}>
                                <span style={{ fontSize: '12px', fontWeight: 600, color: COLORS.primary }}>
                                    {selectedCount} selected
                                </span>
                                <button
                                    onClick={clearSelection}
                                    style={{
                                        fontSize: '11px', fontWeight: 500, color: COLORS.primary,
                                        padding: '4px 8px', borderRadius: '4px', background: 'transparent',
                                        border: 'none', cursor: 'pointer'
                                    }}
                                >
                                    Clear
                                </button>
                            </div>
                        )}

                        {/* Media Grid (Product Pages) */}
                        {isProductPage && (
                            <>
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(3, 1fr)',
                                    gap: '8px'
                                }}>
                                    {displayedItems.map((item, index) => renderMediaItem(item, index))}
                                </div>

                                {/* Show More Button */}
                                {hasMoreItems && !showAllItems && (
                                    <button
                                        onClick={() => setShowAllItems(true)}
                                        style={{
                                            width: '100%',
                                            marginTop: '12px',
                                            padding: '12px',
                                            background: COLORS.surface,
                                            border: `1px solid ${COLORS.border}`,
                                            borderRadius: '10px',
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            color: COLORS.primary,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '6px'
                                        }}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <polyline points="6 9 12 15 18 9" />
                                        </svg>
                                        Show {hiddenCount} More
                                    </button>
                                )}

                                {/* Show Less Button */}
                                {showAllItems && hasMoreItems && (
                                    <button
                                        onClick={() => setShowAllItems(false)}
                                        style={{
                                            width: '100%',
                                            marginTop: '12px',
                                            padding: '10px',
                                            background: 'transparent',
                                            border: 'none',
                                            fontSize: '12px',
                                            fontWeight: 500,
                                            color: COLORS.textMuted,
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Show Less
                                    </button>
                                )}
                            </>
                        )}

                        {/* Listing Grid */}
                        {isListingPage && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                                {filteredListingProducts.map((product, index) => renderListingProduct(product, index))}
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* FOOTER */}
            {!loading && hasContent && (
                <footer style={{
                    padding: '12px 14px',
                    background: COLORS.surface,
                    borderTop: `1px solid ${COLORS.borderLight}`,
                    flexShrink: 0
                }}>
                    {isSelectionMode ? (
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                onClick={clearSelection}
                                style={{
                                    flex: 1, padding: '12px', background: COLORS.background,
                                    border: `1px solid ${COLORS.border}`, borderRadius: '10px',
                                    fontSize: '13px', fontWeight: 600, color: COLORS.text, cursor: 'pointer'
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={downloadSelected}
                                disabled={selectedCount === 0 || downloading}
                                style={{
                                    flex: 2, padding: '12px',
                                    background: downloadSuccess ? COLORS.success : COLORS.primary,
                                    border: 'none', borderRadius: '10px',
                                    fontSize: '13px', fontWeight: 600, color: '#fff',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                                    boxShadow: COLORS.shadowPrimary,
                                    cursor: selectedCount === 0 || downloading ? 'not-allowed' : 'pointer',
                                    opacity: selectedCount === 0 ? 0.6 : 1
                                }}
                            >
                                {downloading ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                                        <path d="M23 4v6h-6M1 20v-6h6" />
                                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                                    </svg>
                                ) : downloadSuccess ? '✓ Done' : `Download ${selectedCount}`}
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={downloadAll}
                            disabled={downloading}
                            style={{
                                width: '100%', padding: '14px',
                                background: downloadSuccess ? COLORS.success : COLORS.primary,
                                border: 'none', borderRadius: '12px',
                                fontSize: '14px', fontWeight: 600, color: '#fff',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                                boxShadow: COLORS.shadowPrimary,
                                cursor: downloading ? 'not-allowed' : 'pointer'
                            }}
                        >
                            {downloading ? (
                                <>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                                        <path d="M23 4v6h-6M1 20v-6h6" />
                                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                                    </svg>
                                    Downloading...
                                </>
                            ) : downloadSuccess ? (
                                <>✓ Downloaded!</>
                            ) : (
                                <>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                        <polyline points="7 10 12 15 17 10" />
                                        <line x1="12" y1="15" x2="12" y2="3" />
                                    </svg>
                                    Download {categoryFilter === 'productImages' ? 'Product' : categoryFilter === 'reviewImages' ? 'Reviews' : 'Videos'} · {displayCount}
                                </>
                            )}
                        </button>
                    )}
                </footer>
            )}

            {/* GLOBAL STYLES */}
            <style>{`
                .media-item:hover .media-hover-overlay { opacity: 1 !important; }
                .media-item:hover { transform: scale(1.02); }
                .listing-product:hover { transform: scale(1.02); box-shadow: ${COLORS.shadowMd}; }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
}

export default PanelApp;
