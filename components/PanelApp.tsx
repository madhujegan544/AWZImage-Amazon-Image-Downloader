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
    images?: string[]; // Added: full gallery
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
    variantImages?: Record<string, string[]>;
    reviewImages: string[];
    productVideos?: string[];
    reviewVideos?: string[];
    videos?: string[];
    variants: ProductVariant[];
    listingProducts: ListingProduct[];
    pageType: 'product' | 'listing';
    activeImage?: string;
    variantImagesByAsin?: Record<string, string[]>;
}

interface MediaItem {
    url: string;
    type: 'image' | 'video';
    source: 'product' | 'review';
    category: 'productImage' | 'reviewImage' | 'productVideo' | 'reviewVideo';
}

interface PanelAppProps {
    onClose?: () => void;
    scrapeProductData: (triggerScroll?: boolean) => Promise<ProductData | null>;
    downloadZip: (items: (string | { url: string; filename: string })[], filename: string) => Promise<void>;
    showPreview?: (url: string, mediaType: 'image' | 'video', allUrls: string[]) => void;
    selectVariant?: (asin: string) => Promise<boolean>;
}

type ViewState = 'welcome' | 'login' | 'main';
type MainTab = 'product' | 'review';
type SubTab = 'images' | 'videos';

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

const INITIAL_ITEMS_COUNT = 6;

// ============================================
// Utility Functions
// ============================================
const truncateText = (text: string, maxLength: number): string => {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
};

/**
 * Extracts the core Amazon Image ID for robust deduplication.
 * UNIFIED PATTERN: Only captures alphanumeric characters (the core ID).
 * This matches content.ts and variantScraper.ts for consistent deduplication.
 */
const getImageId = (url: string): string => {
    try {
        let decoded = url;
        try { decoded = decodeURIComponent(url); } catch { /* ignore */ }
        const cleaned = decoded.split('?')[0];

        // Capture only alphanumeric characters (stops at first non-alphanumeric)
        const match = cleaned.match(/images\/I\/([A-Za-z0-9]+)/);
        if (match) return match[1];

        const filenameMatch = cleaned.match(/\/([A-Za-z0-9]{8,})/);
        if (filenameMatch) return filenameMatch[1];

        return cleaned;
    } catch { return url; }
};

/**
 * Deduplicates a list of image URLs based on their core Amazon Image ID.
 */
const dedupeUrls = (urls: string[]): string[] => {
    if (!urls) return [];
    const seen = new Set<string>();
    const unique: string[] = [];

    urls.forEach(url => {
        if (!url) return;
        const id = getImageId(url);
        if (!seen.has(id)) {
            seen.add(id);
            unique.push(url);
        }
    });

    return unique;
};

/**
 * Resolves the full image list for a specific variant using tiered matching.
 */
const resolveVariantImages = (variant: { asin: string, name: string }, data: ProductData): string[] => {
    let images: string[] = [];

    // PRIORITY 1: Match by ASIN
    if (data.variantImagesByAsin?.[variant.asin]) {
        images = data.variantImagesByAsin[variant.asin];
    }
    // PRIORITY 2: Match by exact Name
    else if (data.variantImages?.[variant.name]) {
        images = data.variantImages[variant.name];
    }
    // PRIORITY 3: Loose name matching
    else if (data.variantImages) {
        const cleanName = variant.name.replace(/^Select\s+/, '').trim();
        const matchingKey = Object.keys(data.variantImages).find(k =>
            k === cleanName || k === variant.name ||
            k.toLowerCase().includes(cleanName.toLowerCase()) ||
            cleanName.toLowerCase().includes(k.toLowerCase())
        );
        if (matchingKey) images = data.variantImages[matchingKey];
    }

    return dedupeUrls(images);
};

/**
 * Enriches all variant cards in the product data with their accurate image sets.
 * This happens in the background to ensure each card is a self-contained source of truth.
 */
const enrichProductData = (data: ProductData | null): ProductData | null => {
    if (!data || !data.variants) return data;

    const enrichedVariants = data.variants.map(v => {
        const images = resolveVariantImages(v, data);
        return {
            ...v,
            images: images.length > 0 ? images : dedupeUrls(v.images || []),
            // Update thumbnail if we found a better gallery
            image: images[0] || v.image
        };
    });

    return {
        ...data,
        productImages: dedupeUrls(data.productImages || []),
        variants: enrichedVariants
    };
};

const getMediaItems = (data: ProductData | null, overrideAsin?: string | null): MediaItem[] => {
    if (!data) return [];

    const items: MediaItem[] = [];
    const seenIds = new Set<string>();

    // Helper to add item with deduplication
    const addItem = (url: string, type: 'image' | 'video', source: 'product' | 'review', category: MediaItem['category']) => {
        const id = type === 'image' ? getImageId(url) : url.split('?')[0];
        if (!seenIds.has(id)) {
            seenIds.add(id);
            items.push({ url, type, source, category });
        }
    };

    // Determine which product images to show
    let displayImages: string[] = [];

    // PRIORITY 0: Check override ASIN first (user clicked in panel)
    let selectedVariant = overrideAsin
        ? data.variants?.find(v => v.asin === overrideAsin)
        : data.variants?.find(v => v.selected);

    // Fallback if override variant not found (shouldn't happen if valid ASIN)
    if (!selectedVariant) {
        selectedVariant = data.variants?.find(v => v.selected);
    }

    const hasVariants = data.variants && data.variants.length > 0;

    if (selectedVariant) {
        // PRIORITY 1: Use images stored directly in the selected variant (enriched by enrichProductData)
        if (selectedVariant.images && selectedVariant.images.length > 0) {
            displayImages = selectedVariant.images;
        }
        // PRIORITY 2: Lookup by ASIN in variantImagesByAsin
        else if (selectedVariant.asin && data.variantImagesByAsin &&
            data.variantImagesByAsin[selectedVariant.asin] &&
            data.variantImagesByAsin[selectedVariant.asin].length > 0) {
            displayImages = data.variantImagesByAsin[selectedVariant.asin];
        }
        // PRIORITY 3: Lookup by name in variantImages
        else if (data.variantImages) {
            const cleanName = selectedVariant.name?.replace(/^Select\s+/, '').trim();
            const matchingKey = Object.keys(data.variantImages).find(k =>
                k === selectedVariant.name ||
                k === cleanName ||
                k.toLowerCase().includes(cleanName?.toLowerCase() || '') ||
                cleanName?.toLowerCase().includes(k.toLowerCase())
            );
            if (matchingKey && data.variantImages[matchingKey]?.length > 0) {
                displayImages = data.variantImages[matchingKey];
            }
        }
    }

    // FALLBACK: If no variant is selected OR no variant images found
    if (displayImages.length === 0) {
        if (!hasVariants) {
            // No variants exist at all - safe to use productImages
            displayImages = data.productImages || [];
        } else if (selectedVariant) {
            // There ARE variants but we couldn't find images for the selected one
            // ONLY use the variant's thumbnail - NEVER fall back to productImages
            // as it may contain images from other variants
            if (selectedVariant.image) {
                displayImages = [selectedVariant.image];
            }
            // If no thumbnail either, display will be empty (better than showing wrong images)
        }
        // If no variant selected but variants exist, show nothing (user should select one)
    }

    // Dedupe the display images
    displayImages = dedupeUrls(displayImages);

    displayImages.forEach(url => {
        addItem(url, 'image', 'product', 'productImage');
    });

    (data.productVideos || data.videos || []).forEach(url => {
        addItem(url, 'video', 'product', 'productVideo');
    });

    (data.reviewImages || []).forEach(url => {
        addItem(url, 'image', 'review', 'reviewImage');
    });

    (data.reviewVideos || []).forEach(url => {
        addItem(url, 'video', 'review', 'reviewVideo');
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
    const [previewUrl, setPreviewUrl] = useState<string | null>(null); // Added for preview

    // Selection State
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [isSelectionMode, setIsSelectionMode] = useState(false);

    // UI State
    const [searchTerm, setSearchTerm] = useState('');
    const [activeSearchTerm, setActiveSearchTerm] = useState('');
    const [variantDropdownOpen, setVariantDropdownOpen] = useState(false);
    const [mainTab, setMainTab] = useState<MainTab>('product');
    const [subTab, setSubTab] = useState<SubTab>('images');
    const [showAllItems, setShowAllItems] = useState(false);
    const [selectingVariant, setSelectingVariant] = useState(false);
    const [variantStartIndex, setVariantStartIndex] = useState(0);
    const [selectedVariantAsin, setSelectedVariantAsin] = useState<string | null>(null);

    // Derived state
    // Use selectedVariantAsin to override default selection logic
    const allMediaItems = useMemo(() => getMediaItems(productData, selectedVariantAsin), [productData, selectedVariantAsin]);
    const isProductPage = productData?.pageType === 'product';
    const isListingPage = productData?.pageType === 'listing';

    // Filtered media items based on current active tab
    const filteredMediaItems = useMemo(() => {
        if (isListingPage) return allMediaItems;

        if (mainTab === 'product') {
            if (subTab === 'images') {
                return allMediaItems.filter(i => i.category === 'productImage');
            } else {
                return allMediaItems.filter(i => i.category === 'productVideo');
            }
        } else if (mainTab === 'review') {
            // "if the user is on the Reviews page, only review images and videos should be downloaded"
            // For the Review tab, we filter based on subTab for DISPLAY, 
            // but the download function will handle the "both" requirement.
            if (subTab === 'images') {
                return allMediaItems.filter(i => i.category === 'reviewImage');
            } else {
                return allMediaItems.filter(i => i.category === 'reviewVideo');
            }
        }
        return allMediaItems;
    }, [allMediaItems, mainTab, subTab, isListingPage]);

    // URLs for preview navigation (based on current tab selection)
    const getPreviewUrls = (item: MediaItem): string[] => {
        // Filter based on current mainTab and subTab
        let currentItems: typeof allMediaItems = [];
        if (mainTab === 'product' && subTab === 'images') {
            currentItems = allMediaItems.filter(i => i.category === 'productImage');
        } else if (mainTab === 'product' && subTab === 'videos') {
            currentItems = allMediaItems.filter(i => i.category === 'productVideo');
        } else if (mainTab === 'review' && subTab === 'images') {
            currentItems = allMediaItems.filter(i => i.category === 'reviewImage');
        } else if (mainTab === 'review' && subTab === 'videos') {
            currentItems = allMediaItems.filter(i => i.category === 'reviewVideo');
        }
        // Filter by same media type (image/video) and return URLs
        return currentItems.filter(i => i.type === item.type).map(i => i.url);
    };

    // Category counts
    const categoryCounts = useMemo(() => ({
        all: allMediaItems.length,
        productImages: allMediaItems.filter(i => i.category === 'productImage').length,
        productVideos: allMediaItems.filter(i => i.category === 'productVideo').length,
        reviewImages: allMediaItems.filter(i => i.category === 'reviewImage').length,
        reviewVideos: allMediaItems.filter(i => i.category === 'reviewVideo').length,
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

    // All variants - no longer filtering by availability
    // Users should have access to all variants for media browsing/download
    const allVariants = productData?.variants || [];
    const selectedVariantData = allVariants.find(v => v.selected);

    // ============================================
    // Data Loading
    // ============================================
    const loadData = useCallback(async (triggerScroll: boolean = false) => {
        setLoading(true);
        setError(null);
        try {
            const rawData = await scrapeProductData(triggerScroll);
            if (rawData) {
                // Enrich all variant cards with their specific images in background
                const enrichedData = enrichProductData(rawData);
                setProductData(enrichedData);

                if (enrichedData?.activeImage) {
                    setPreviewUrl(enrichedData.activeImage);
                }
            } else {
                setError('No product data found on this page');
            }
        } catch (err) {
            setError('Failed to load product data');
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [scrapeProductData]);

    useEffect(() => {
        // Initial load with scrolling
        loadData(true);
    }, [loadData]);

    // Fast auto-refresh to detect product changes (every 1.5 seconds)
    // Shows loader when navigating to a new product
    useEffect(() => {
        // Don't poll if downloading or switching variants
        if (downloading || selectingVariant) {
            return;
        }

        // Store reference to current ASIN for change detection
        const currentAsin = productData?.asin;

        const fastPollInterval = setInterval(async () => {
            try {
                // Poll WITHOUT triggering scroll
                const newData = await scrapeProductData(false);
                if (newData) {
                    // Enrich new data consistently
                    const enrichedNewData = enrichProductData(newData);

                    // Detect if product changed (different ASIN or page type)
                    const productChanged = currentAsin && (
                        enrichedNewData?.asin !== currentAsin ||
                        enrichedNewData?.pageType !== productData?.pageType
                    );

                    if (productChanged) {
                        // Product changed - show loader and reset state
                        setLoading(true);
                        setSelectedItems(new Set());
                        setIsSelectionMode(false);
                        setShowAllItems(false);
                        setSelectedVariantAsin(null);

                        // Brief delay to show loading state
                        setTimeout(() => {
                            setProductData(enrichedNewData);
                            setLoading(false);
                        }, 300);
                    } else {
                        // Same product - silently update data (for variant changes, etc.)
                        setProductData(enrichedNewData);
                    }
                }
            } catch (err: any) {
                // Ignore expected errors during polling (tab closed, refreshing, etc.)
                const msg = err?.message || '';
                const isExpected = msg.includes('No active tab') ||
                    msg.includes('Could not establish connection') ||
                    msg.includes('Receiving end does not exist');
                if (!isExpected) {
                    console.error('Auto-refresh failed:', err);
                }
            }
        }, 1500); // Fast polling every 1.5 seconds

        return () => clearInterval(fastPollInterval);
    }, [downloading, selectingVariant, productData?.asin, productData?.pageType, scrapeProductData]);

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

        setSelectedVariantAsin(asin); // Set for immediate persistent highlighting
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
                        const newData = await scrapeProductData(false); // Poll WITHOUT triggering scroll
                        if (newData) {
                            // Check if variant actually changed
                            const newVariant = newData.variants?.find(v => v.selected);
                            if (newVariant?.asin === asin || attempts >= maxAttempts) {
                                setProductData(enrichProductData(newData));
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

        let items: (string | { url: string; filename: string })[] = [];
        let categoryLabel = `${mainTab}-${subTab}`;

        // Check if we have variants with images to download
        const hasVariantsWithImages = isProductPage &&
            mainTab === 'product' &&
            subTab === 'images' &&
            productData.variantImages &&
            Object.keys(productData.variantImages).length > 0 &&
            Object.values(productData.variantImages).some(urls => urls && urls.length > 0);

        // If downloading product images (page-specific), structure it by variants
        if (hasVariantsWithImages) {
            // Iterate through ALL enriched variants to get their full image sets
            productData.variants.forEach(variant => {
                const vUrls = variant.images || [];
                if (vUrls.length === 0) return;

                const safeName = variant.name.replace(/[^a-zA-Z0-9_-]/g, '_');
                vUrls.forEach((url, i) => {
                    let ext = 'jpg';
                    if (url.includes('.png')) ext = 'png';
                    if (url.includes('.webp')) ext = 'webp';
                    items.push({
                        url,
                        filename: `Variant_${safeName}/image_${i + 1}.${ext}`
                    });
                });
            });
        }
        // Review Section - Sub-tab aware
        else if (mainTab === 'review') {
            categoryLabel = `review-${subTab}`;
            // Filter by source 'review' AND the specific type based on subTab
            const targetType = subTab === 'images' ? 'image' : 'video';
            const reviewItems = allMediaItems.filter(i => i.source === 'review' && i.type === targetType);

            reviewItems.forEach((item, i) => {
                let ext = targetType === 'video' ? 'mp4' : 'jpg';
                const parts = item.url.split('.');
                if (parts.length > 1) {
                    const e = parts[parts.length - 1].split('?')[0];
                    const validExts = targetType === 'video' ? ['mp4', 'webm', 'mov'] : ['jpg', 'jpeg', 'png', 'webp'];
                    if (validExts.includes(e.toLowerCase())) ext = e;
                }

                items.push({
                    url: item.url,
                    filename: `Reviews/${subTab}/${item.type}_${i + 1}.${ext}`
                });
            });
        }
        // Videos page (Product Videos)
        else if (mainTab === 'product' && subTab === 'videos') {
            categoryLabel = 'product-videos';
            filteredMediaItems.forEach((item, i) => {
                let ext = 'mp4';
                const parts = item.url.split('.');
                if (parts.length > 1) {
                    const e = parts[parts.length - 1].split('?')[0];
                    if (['mp4', 'webm', 'mov', 'avi'].includes(e)) ext = e;
                }
                items.push({
                    url: item.url,
                    filename: `Videos/product_video_${i + 1}.${ext}`
                });
            });
        }
        // Listing pages or empty variants fallback
        else {
            items = isProductPage
                ? filteredMediaItems.map(item => item.url)
                : filteredListingProducts.map(p => p.image);
        }

        if (items.length === 0) return;

        setDownloading(true);
        setDownloadSuccess(false);
        try {
            const filename = `pixora-${productData.asin || 'media'}-${categoryLabel}-${Date.now()}`;
            await downloadZip(items, filename);
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
        if (allVariants.length === 0) return;

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
        // Reset selection state
        setSelectedItems(new Set());
        setIsSelectionMode(false);

        // Reset search state
        setSearchTerm('');
        setActiveSearchTerm('');

        // Reset category/tab state to initial values
        setMainTab('product');
        setSubTab('images');
        setShowAllItems(false);

        // Reset variant state completely
        setSelectedVariantAsin(null);
        setVariantDropdownOpen(false);
        setSelectingVariant(false);
        setVariantStartIndex(0);

        // Reload data
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

    // Two-Level Category Navigation
    const renderCategoryTabs = () => {
        const productTotal = categoryCounts.productImages + categoryCounts.productVideos;
        const reviewTotal = categoryCounts.reviewImages + categoryCounts.reviewVideos;

        return (
            <div style={{
                background: COLORS.surface,
                borderBottom: `1px solid ${COLORS.borderLight}`,
                padding: '0'
            }}>
                {/* Main Tabs: Product / Review */}
                <div style={{
                    display: 'flex',
                    background: '#fff',
                    padding: '0 10px'
                }}>
                    {[
                        { key: 'product' as MainTab, label: 'Product', count: productTotal },
                        { key: 'review' as MainTab, label: 'Review', count: reviewTotal },
                    ].map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => {
                                setMainTab(tab.key);
                                setSubTab('images');
                                setShowAllItems(false);
                            }}
                            disabled={tab.count === 0}
                            style={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                padding: '16px 8px',
                                border: 'none',
                                borderBottom: mainTab === tab.key ? `2px solid ${COLORS.primary}` : '2px solid transparent',
                                background: 'transparent',
                                color: mainTab === tab.key ? COLORS.primary : '#64748B',
                                fontSize: '15px',
                                fontWeight: 700,
                                cursor: tab.count === 0 ? 'not-allowed' : 'pointer',
                                opacity: tab.count === 0 ? 0.4 : 1,
                                transition: 'all 0.2s ease',
                            }}
                        >
                            {tab.label}
                            <span style={{
                                background: mainTab === tab.key ? COLORS.primary : '#E2E8F0',
                                color: mainTab === tab.key ? '#fff' : '#64748B',
                                padding: '2px 8px',
                                borderRadius: '10px',
                                fontSize: '11px',
                                fontWeight: 700
                            }}>
                                {tab.count}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Sub Tabs: Images / Videos */}
                <div style={{
                    display: 'flex',
                    gap: '12px',
                    padding: '12px 14px',
                    background: '#F8FAFC'
                }}>
                    {[
                        {
                            key: 'images' as SubTab,
                            label: 'Images',
                            count: mainTab === 'product' ? categoryCounts.productImages : categoryCounts.reviewImages,
                            icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z'
                        },
                        {
                            key: 'videos' as SubTab,
                            label: 'Videos',
                            count: mainTab === 'product' ? categoryCounts.productVideos : categoryCounts.reviewVideos,
                            icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z'
                        },
                    ].map(sub => (
                        <button
                            key={sub.key}
                            onClick={() => {
                                setSubTab(sub.key);
                                setShowAllItems(false);
                            }}
                            disabled={sub.count === 0}
                            style={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                padding: '12px 14px',
                                borderRadius: '12px',
                                border: 'none',
                                background: subTab === sub.key ? '#FFFFFF' : 'transparent',
                                color: subTab === sub.key ? '#1E293B' : '#64748B',
                                fontSize: '14px',
                                fontWeight: 600,
                                cursor: sub.count === 0 ? 'not-allowed' : 'pointer',
                                opacity: sub.count === 0 ? 0.4 : 1,
                                transition: 'all 0.2s ease',
                                boxShadow: subTab === sub.key ? '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)' : 'none'
                            }}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d={sub.icon} />
                            </svg>
                            {sub.label}
                            <span style={{
                                background: subTab === sub.key ? COLORS.primary : '#E2E8F0',
                                color: subTab === sub.key ? '#fff' : '#64748B',
                                padding: '1px 7px',
                                borderRadius: '8px',
                                fontSize: '11px',
                                fontWeight: 700,
                                marginLeft: '2px'
                            }}>
                                {sub.count}
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        );
    };

    // Variant List (Grouped Cards)
    const renderVariantList = () => {
        // Show ALL variants (including unavailable ones for browsing)
        const allVariants = productData?.variants || [];
        if (allVariants.length === 0) return null;

        return (
            <div style={{ marginBottom: '16px' }}>
                {/* Section Header */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '10px',
                    position: 'sticky',
                    top: '-14px', // Offset for container padding
                    zIndex: 20,
                    background: COLORS.background,
                    padding: '8px 0',
                    margin: '0 -14px 10px -14px',
                    paddingLeft: '14px',
                    paddingRight: '14px',
                    borderBottom: `1px solid ${COLORS.borderLight}`
                }}>
                    <span style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: COLORS.textMuted,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                    }}>
                        Product Variants ({allVariants.length})
                    </span>
                </div>

                {/* Variant Cards */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                    gap: '10px'
                }}>
                    {allVariants.map((variant, index) => {
                        const isCurrent = selectedVariantAsin ? variant.asin === selectedVariantAsin : variant.selected;
                        const isUnavailable = !variant.available;

                        // Get thumbnail - try variant image, then variantImagesByAsin, then default
                        let thumbnail = variant.image || '';
                        if (!thumbnail && productData?.variantImagesByAsin?.[variant.asin]?.[0]) {
                            thumbnail = productData.variantImagesByAsin[variant.asin][0];
                        }

                        // Use pre-enriched images from the variant data
                        const displayImages = variant.images || [];
                        const imageCount = displayImages.length;

                        // GUARANTEE 2 preview images: duplicate if only 1 exists
                        let previewImages: string[] = [];
                        if (imageCount >= 2) {
                            previewImages = displayImages.slice(0, 2);
                        } else if (imageCount === 1) {
                            // Duplicate single image to fill both slots
                            previewImages = [displayImages[0], displayImages[0]];
                        } else if (imageCount === 0 && thumbnail) {
                            // Absolute fallback to card thumbnail
                            previewImages = [thumbnail, thumbnail];
                        }

                        const remainingCount = imageCount > 2 ? imageCount - 2 : 0;

                        return (
                            <div
                                key={variant.asin}
                                onClick={() => {
                                    // Allow clicking ALL variants (including unavailable) to view/download media
                                    if (!isCurrent && !selectingVariant) {
                                        handleVariantSelect(variant.asin, variant.name);
                                    }
                                }}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '8px',
                                    padding: '12px',
                                    borderRadius: '10px',
                                    background: isCurrent ? COLORS.primarySoft : COLORS.surface,
                                    border: isCurrent ? `2px solid ${COLORS.primary}` : `1px solid ${COLORS.border}`,
                                    cursor: selectingVariant ? 'wait' : isCurrent ? 'default' : 'pointer',
                                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                                }}
                                className={!isCurrent ? 'variant-option-hover' : ''}
                            >
                                {/* Info */}
                                <div style={{ width: '100%' }}>
                                    {/* ASIN and Selected Badge */}
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'flex-start',
                                        marginBottom: '6px'
                                    }}>
                                        <div style={{
                                            fontSize: '10px',
                                            fontWeight: 600,
                                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                                            color: isCurrent ? COLORS.primary : COLORS.textMuted,
                                            opacity: 0.8,
                                            letterSpacing: '0.2px'
                                        }}>
                                            {variant.asin}
                                        </div>
                                    </div>

                                    {/* Variant Name - Bold and prominent */}
                                    <div style={{
                                        fontSize: '14px',
                                        fontWeight: 700,
                                        color: COLORS.text,
                                        lineHeight: '1.25',
                                        marginBottom: '10px',
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden',
                                        height: '35px'
                                    }}>
                                        {variant.name}
                                    </div>
                                </div>

                                {/* Gallery Preview (up to 2 images + counter) - ALWAYS SHOW */}
                                <div style={{ position: 'relative', marginTop: 'auto', width: '100%' }}>
                                    <div
                                        style={{
                                            display: 'flex',
                                            overflowX: 'auto',
                                            gap: '6px',
                                            paddingBottom: '4px',
                                            scrollBehavior: 'smooth',
                                            scrollbarWidth: 'none', // Firefox
                                            msOverflowStyle: 'none' // IE/Edge
                                        }}
                                        className="no-scrollbar"
                                    >
                                        {/* Render ALL images in scrollable list */}
                                        {displayImages.length > 0 ? (
                                            displayImages.map((img, idx) => (
                                                <div key={idx} style={{
                                                    flex: '0 0 33%', // Shows ~3 items (approx)
                                                    aspectRatio: '1',
                                                    borderRadius: '8px',
                                                    background: `url(${img}) center/contain no-repeat`,
                                                    backgroundColor: '#fafafa',
                                                    border: `1px solid rgba(0,0,0,0.06)`,
                                                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)',
                                                    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                                                    cursor: 'zoom-in'
                                                }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (showPreview) showPreview(img, 'image', displayImages);
                                                    }}
                                                    className="variant-thumb"
                                                />
                                            ))
                                        ) : (
                                            /* No images - show placeholder */
                                            <div style={{
                                                width: '100%',
                                                height: '60px', // Approx height of thumbs
                                                borderRadius: '8px',
                                                background: COLORS.backgroundSecondary,
                                                border: `1px dashed rgba(0,0,0,0.1)`,
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
                                    </div>

                                    {/* Image Count Label - NEW */}
                                    <div style={{
                                        marginTop: '8px',
                                        fontSize: '10px',
                                        fontWeight: 600,
                                        color: COLORS.textMuted,
                                        textAlign: 'right'
                                    }}>
                                        {imageCount} Image{imageCount !== 1 ? 's' : ''} Available
                                    </div>

                                    {/* Download Button Overlay */}
                                    {imageCount > 0 && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                // Prevent download if still loading variant data
                                                if (selectingVariant) return;

                                                // Use the variant's own enriched images (background fetched)
                                                const imagesToDownload = variant.images || [];

                                                if (imagesToDownload.length > 0) {
                                                    const filename = `pixora-${productData?.asin || 'product'}-${variant.name.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}`;
                                                    downloadZip(imagesToDownload, filename);
                                                }
                                            }}
                                            onMouseEnter={async () => {
                                                // On hover, select this variant to load all its images
                                                if (!isCurrent && !selectingVariant && !isUnavailable) {
                                                    handleVariantSelect(variant.asin, variant.name);
                                                }
                                            }}
                                            disabled={selectingVariant}
                                            className="variant-download-btn"
                                            style={{
                                                position: 'absolute',
                                                bottom: '22px', // Moved up slightly to accommodate label
                                                right: '6px',
                                                width: '24px',
                                                height: '24px',
                                                borderRadius: '6px',
                                                background: selectingVariant ? COLORS.backgroundSecondary : '#fff',
                                                border: `1px solid ${COLORS.border}`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                cursor: selectingVariant ? 'wait' : 'pointer',
                                                boxShadow: COLORS.shadowSm,
                                                color: selectingVariant ? COLORS.textMuted : COLORS.text,
                                                transition: 'all 0.2s ease',
                                                opacity: selectingVariant ? 0.7 : 1
                                            }}
                                            title={selectingVariant ? 'Loading variant...' : `Download ${imageCount} image${imageCount > 1 ? 's' : ''}`}
                                        >
                                            {selectingVariant ? (
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }}>
                                                    <path d="M21 12a9 9 0 11-6.219-8.56" />
                                                </svg>
                                            ) : (
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                    <polyline points="7 10 12 15 17 10" />
                                                    <line x1="12" y1="15" x2="12" y2="3" />
                                                </svg>
                                            )}
                                        </button>
                                    )}

                                </div>
                            </div>
                        );
                    })}
                </div>
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

                {/* Badges - Glassmorphic */}
                <div style={{ position: 'absolute', top: '6px', left: '6px', display: 'flex', gap: '4px', pointerEvents: 'none' }}>
                    {isVideo && (
                        <span style={{
                            background: 'rgba(0, 0, 0, 0.45)',
                            backdropFilter: 'blur(6px)',
                            WebkitBackdropFilter: 'blur(6px)',
                            color: '#fff',
                            fontSize: '8px',
                            fontWeight: 800,
                            padding: '3px 6px',
                            borderRadius: '5px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                        }}>
                            <svg width="6" height="6" viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                            VID
                        </span>
                    )}
                </div>

                {/* Selection Checkbox - Circular Premium */}
                <div
                    onClick={(e) => toggleSelection(item.url, e)}
                    style={{
                        position: 'absolute',
                        top: '6px',
                        right: '6px',
                        width: '22px',
                        height: '22px',
                        borderRadius: '50%',
                        background: isSelected ? COLORS.primary : 'rgba(255,255,255,0.75)',
                        backdropFilter: 'blur(4px)',
                        WebkitBackdropFilter: 'blur(4px)',
                        border: isSelected ? 'none' : `1.5px solid rgba(0,0,0,0.1)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: isSelected ? `0 4px 10px ${COLORS.primaryGlow}` : COLORS.shadowSm,
                        transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                        transform: isSelected ? 'scale(1.1)' : 'scale(1)',
                        cursor: 'pointer',
                        zIndex: 10
                    }}
                >
                    {isSelected && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
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
                        Download
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
                    className="listing-image"
                >
                    <img
                        src={product.image}
                        alt={product.title}
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '6px' }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />

                    {/* Selection Checkbox */}
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
                            cursor: 'pointer',
                            zIndex: 10
                        }}
                    >
                        {isSelected && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        )}
                    </div>

                    {/* Hover Overlay with Preview & Download */}
                    <div
                        className="listing-hover-overlay"
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
                                downloadSingle(product.image);
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
                        >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            Download
                        </button>
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
            {/* HEADER - Glassmorphic with gradient shadow */}
            <header style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                background: 'rgba(255, 255, 255, 0.92)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                borderBottom: `1px solid rgba(0,0,0,0.05)`,
                boxShadow: '0 4px 20px -4px rgba(0, 0, 0, 0.08)',
                flexShrink: 0,
                position: 'sticky',
                top: 0,
                zIndex: 100
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                        width: '34px',
                        height: '34px',
                        borderRadius: '10px',
                        background: `linear-gradient(135deg, ${COLORS.primary} 0%, #3B82F6 50%, #60A5FA 100%)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 4px 12px -2px rgba(37, 99, 235, 0.4)',
                        transition: 'transform 0.3s ease, box-shadow 0.3s ease'
                    }} className="header-logo">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                    </div>
                    <div>
                        <h1 style={{
                            fontSize: '16px',
                            fontWeight: 800,
                            background: 'linear-gradient(135deg, #1E40AF 0%, #2563EB 50%, #3B82F6 100%)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            backgroundClip: 'text',
                            lineHeight: 1.1,
                            letterSpacing: '-0.3px'
                        }}>Pixora</h1>
                        <p style={{ fontSize: '9px', color: COLORS.textMuted, fontWeight: 500, letterSpacing: '0.2px' }}>Amazon Media</p>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                        onClick={handleRefresh}
                        disabled={loading}
                        className="refresh-btn"
                        style={{
                            width: '34px',
                            height: '34px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: COLORS.surface,
                            borderRadius: '10px',
                            color: loading ? COLORS.primary : COLORS.textSecondary,
                            border: `1px solid ${COLORS.border}`,
                            cursor: loading ? 'not-allowed' : 'pointer',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
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
                            placeholder="Search by product name or ASIN..."
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

            {/* TOP DOWNLOAD BAR - Prominent position */}
            {!loading && hasContent && (
                <div style={{
                    padding: '10px 14px',
                    background: COLORS.surface,
                    borderBottom: `1px solid ${COLORS.borderLight}`,
                    flexShrink: 0
                }}>
                    {isSelectionMode ? (
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                onClick={clearSelection}
                                style={{
                                    flex: 1, padding: '10px', background: COLORS.background,
                                    border: `1px solid ${COLORS.border}`, borderRadius: '8px',
                                    fontSize: '13px', fontWeight: 600, color: COLORS.text, cursor: 'pointer'
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={downloadSelected}
                                disabled={selectedCount === 0 || downloading}
                                style={{
                                    flex: 2, padding: '10px',
                                    background: downloadSuccess ? COLORS.success : COLORS.primary,
                                    border: 'none', borderRadius: '8px',
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
                                ) : downloadSuccess ? '✓ Done' : (
                                    <>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                            <polyline points="7 10 12 15 17 10" />
                                            <line x1="12" y1="15" x2="12" y2="3" />
                                        </svg>
                                        {selectedCount === displayCount ? 'Download All' : `Download ${selectedCount} images`}
                                    </>
                                )}
                            </button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: '8px' }}>
                            {/* Select All Button Removed */}

                            <button
                                onClick={downloadAll}
                                disabled={downloading}
                                className="download-main-btn"
                                style={{
                                    flex: 1,
                                    padding: '14px 20px',
                                    background: downloadSuccess
                                        ? `linear-gradient(135deg, ${COLORS.success} 0%, #059669 100%)`
                                        : 'linear-gradient(135deg, #2563EB 0%, #3B82F6 50%, #60A5FA 100%)',
                                    border: 'none',
                                    borderRadius: '14px',
                                    fontSize: '15px',
                                    fontWeight: 700,
                                    color: '#fff',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '10px',
                                    boxShadow: downloadSuccess
                                        ? '0 8px 24px -6px rgba(16, 185, 129, 0.5)'
                                        : '0 8px 24px -6px rgba(37, 99, 235, 0.5)',
                                    cursor: downloading ? 'not-allowed' : 'pointer',
                                    transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                    transform: downloading ? 'scale(0.98)' : 'scale(1)',
                                    letterSpacing: '0.3px'
                                }}
                            >
                                {downloading ? (
                                    <>
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }}>
                                            <path d="M23 4v6h-6M1 20v-6h6" />
                                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                                        </svg>
                                        <span style={{ opacity: 0.9 }}>Downloading...</span>
                                    </>
                                ) : downloadSuccess ? (
                                    <>
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                        Downloaded!
                                    </>
                                ) : (
                                    <>
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                            <polyline points="7 10 12 15 17 10" />
                                            <line x1="12" y1="15" x2="12" y2="3" />
                                        </svg>
                                        Download All
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* CONTENT - Reorganized based on two-level navigation */}
            <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {loading ? renderLoading() : !hasContent ? renderEmpty() : (
                    <>
                        {/* MEDIA GRID SECTION */}
                        {isProductPage && (
                            <div style={{
                                padding: '14px',
                                borderBottom: `1px solid ${COLORS.borderLight}`,
                                background: COLORS.surface,
                                // When expanded, allow shrinking to fit and handle scrolling
                                flexShrink: showAllItems ? 1 : 0,
                                overflowY: 'auto',
                                // Max height of ~3 rows when expanded to keep variant list visible
                                maxHeight: showAllItems ? '350px' : 'none',
                                transition: 'all 0.3s ease-in-out',
                                position: 'relative'
                            }}>
                                <div style={{
                                    transition: 'opacity 0.4s ease-in-out',
                                    opacity: selectingVariant ? 0.5 : 1,
                                    filter: selectingVariant ? 'grayscale(0.5)' : 'none'
                                }}>
                                    {/* Get current items based on mainTab and subTab */}
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(3, 1fr)',
                                        gap: '8px'
                                    }}>
                                        {filteredMediaItems.slice(0, showAllItems ? undefined : INITIAL_ITEMS_COUNT).map((item, index) => renderMediaItem(item, index))}
                                    </div>

                                    {/* Show More Button */}
                                    {filteredMediaItems.length > INITIAL_ITEMS_COUNT && !showAllItems && (
                                        <button
                                            onClick={() => setShowAllItems(true)}
                                            style={{
                                                width: '100%',
                                                marginTop: '12px',
                                                padding: '10px',
                                                background: COLORS.background,
                                                border: `1px solid ${COLORS.border}`,
                                                borderRadius: '8px',
                                                fontSize: '12px',
                                                fontWeight: 600,
                                                color: COLORS.primary,
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: '6px'
                                            }}
                                        >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <polyline points="6 9 12 15 18 9" />
                                            </svg>
                                            Show {filteredMediaItems.length - INITIAL_ITEMS_COUNT} More
                                        </button>
                                    )}

                                    {/* Show Less Button */}
                                    {showAllItems && filteredMediaItems.length > INITIAL_ITEMS_COUNT && (
                                        <button
                                            onClick={() => setShowAllItems(false)}
                                            style={{
                                                width: '100%',
                                                marginTop: '12px',
                                                padding: '10px',
                                                background: COLORS.background,
                                                border: `1px solid ${COLORS.border}`,
                                                borderRadius: '8px',
                                                fontSize: '12px',
                                                fontWeight: 600,
                                                color: COLORS.primary,
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: '6px'
                                            }}
                                        >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <polyline points="18 15 12 9 6 15" />
                                            </svg>
                                            Show Less
                                        </button>
                                    )}


                                    {/* Empty state for current selection */}
                                    {filteredMediaItems.length === 0 && (
                                        <div style={{
                                            padding: '40px 20px',
                                            textAlign: 'center',
                                            color: COLORS.textMuted
                                        }}>
                                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.4, marginBottom: '12px' }}>
                                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                                <circle cx="8.5" cy="8.5" r="1.5" />
                                                <polyline points="21 15 16 10 5 21" />
                                            </svg>
                                            <p style={{ fontSize: '13px', fontWeight: 500 }}>
                                                No {mainTab} {subTab} found
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* SCROLLABLE VARIANTS SECTION - Only for Product Images */}
                        {isProductPage && mainTab === 'product' && subTab === 'images' && allVariants.length > 0 && (
                            <>
                                {/* Visual separator */}
                                <div style={{
                                    height: '8px',
                                    background: `linear-gradient(to bottom, ${COLORS.surface}, ${COLORS.background})`,
                                    borderTop: `1px solid ${COLORS.borderLight}`,
                                    flexShrink: 0
                                }} />
                                <div
                                    className="scroll-container"
                                    style={{
                                        flex: 1,
                                        overflowY: 'auto',
                                        padding: '14px',
                                        background: COLORS.background
                                    }}
                                >
                                    {renderVariantList()}
                                </div>
                            </>
                        )}

                        {/* Listing Grid */}
                        {isListingPage && (
                            <div style={{ flex: 1, overflowY: 'auto', padding: '14px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                                    {filteredListingProducts.map((product, index) => renderListingProduct(product, index))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </main>

            <style>{`
                /* Header enhancements */
                .header-logo:hover { transform: scale(1.05) rotate(-3deg); box-shadow: 0 6px 16px -2px rgba(37, 99, 235, 0.5); }
                .refresh-btn:hover:not(:disabled) { background: ${COLORS.primarySoft} !important; border-color: ${COLORS.primary} !important; color: ${COLORS.primary} !important; transform: scale(1.05); }
                .refresh-btn:active:not(:disabled) { transform: scale(0.95); }
                
                /* Media grid with fade-in animation */
                .media-item { 
                    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease, opacity 0.4s ease !important;
                    animation: fadeInScale 0.4s ease-out backwards;
                }
                .media-item:nth-child(1) { animation-delay: 0.02s; }
                .media-item:nth-child(2) { animation-delay: 0.04s; }
                .media-item:nth-child(3) { animation-delay: 0.06s; }
                .media-item:nth-child(4) { animation-delay: 0.08s; }
                .media-item:nth-child(5) { animation-delay: 0.1s; }
                .media-item:nth-child(6) { animation-delay: 0.12s; }
                .media-item:nth-child(7) { animation-delay: 0.14s; }
                .media-item:nth-child(8) { animation-delay: 0.16s; }
                .media-item:nth-child(9) { animation-delay: 0.18s; }
                .media-item:hover .media-hover-overlay { opacity: 1 !important; }
                .media-item:hover { 
                    transform: translateY(-4px) scale(1.02); 
                    box-shadow: 0 12px 24px -10px rgba(0,0,0,0.28) !important;
                    z-index: 5;
                }
                
                /* Tab transitions */
                .tab-indicator { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
                
                /* Listing products */
                .listing-image:hover .listing-hover-overlay { opacity: 1 !important; }
                .listing-product { transition: transform 0.3s ease, box-shadow 0.3s ease; }
                .listing-product:hover { transform: translateY(-4px); box-shadow: 0 12px 24px -8px rgba(0,0,0,0.15); }
                
                /* Variant cards */
                .variant-option-hover:hover { 
                    background: ${COLORS.primarySoft} !important; 
                    border-color: ${COLORS.primary} !important; 
                    transform: translateY(-3px); 
                    box-shadow: 0 8px 20px -4px rgba(37, 99, 235, 0.25); 
                }
                .variant-download-btn:hover { background: ${COLORS.primary} !important; color: #fff !important; transform: translateY(-1px) scale(1.05); }
                .variant-thumb:hover { transform: scale(1.1); box-shadow: 0 4px 12px rgba(0,0,0,0.12) !important; }
                
                /* Scrollbar styling */
                .variant-scroll::-webkit-scrollbar { height: 4px; }
                .variant-scroll::-webkit-scrollbar-track { background: transparent; }
                .variant-scroll::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 4px; }
                .scroll-container::-webkit-scrollbar { width: 4px; }
                .scroll-container::-webkit-scrollbar-track { background: transparent; }
                .scroll-container::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 4px; }
                
                /* Download button */
                .download-main-btn { position: relative; overflow: hidden; }
                .download-main-btn::after { 
                    content: ''; 
                    position: absolute; 
                    inset: 0; 
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
                    transform: translateX(-100%);
                }
                .download-main-btn:hover:not(:disabled)::after { animation: shimmer 1.5s infinite; }
                .download-main-btn:hover:not(:disabled) { transform: translateY(-2px) scale(1.01) !important; box-shadow: 0 14px 32px -8px rgba(37, 99, 235, 0.55) !important; }
                .download-main-btn:active:not(:disabled) { transform: translateY(0) scale(0.98) !important; }
                
                /* Checkbox bounce on selection */
                .checkbox-bounce { animation: checkBounce 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
                
                /* Scroll fade indicators */
                .scroll-fade-top { 
                    position: relative;
                }
                .scroll-fade-top::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    height: 20px;
                    background: linear-gradient(to bottom, ${COLORS.background}, transparent);
                    pointer-events: none;
                    z-index: 10;
                    opacity: 0;
                    transition: opacity 0.3s ease;
                }
                .scroll-fade-top.scrolled::before { opacity: 1; }
                
                /* Animations */
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                @keyframes fadeInSlide { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes fadeInScale { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
                @keyframes progressSlide { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }
                @keyframes checkBounce { 0% { transform: scale(0.8); } 50% { transform: scale(1.2); } 100% { transform: scale(1.1); } }
                @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
                @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
            `}</style>
        </div >
    );
}

export default PanelApp;