/**
 * PIXORA - Premium Amazon Media Downloader
 * Main Panel Application Component
 * Version 2.2.0 - With Preview & Variant Selection
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { browser } from 'wxt/browser';
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
    videos?: string[]; // Added: variant videos
    available: boolean;
    selected: boolean;
    isLoading?: boolean;
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
    primary: '#4F46E5',
    primaryHover: '#4338CA',
    primarySoft: '#EEF2FF',
    primaryGlow: 'rgba(79, 70, 229, 0.1)',
    surface: '#FFFFFF',
    background: '#F8FAFC',
    backgroundSecondary: '#F1F5F9',
    text: '#1E293B',
    textSecondary: '#475569',
    textMuted: '#94A3B8',
    textInverse: '#FFFFFF',
    border: '#E2E8F0',
    borderLight: '#F1F5F9',
    success: '#10B981',
    successSoft: '#ECFDF5',
    warning: '#F59E0B',
    warningSoft: '#FFFBEB',
    danger: '#EF4444',
    shadowSm: '0 1px 2px 0 rgba(0, 0, 0, 0.03)',
    shadowMd: '0 4px 6px -1px rgba(0, 0, 0, 0.06), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
    shadowLg: '0 10px 15px -3px rgba(0, 0, 0, 0.04), 0 4px 6px -2px rgba(0, 0, 0, 0.02)',
    shadowPrimary: '0 4px 14px 0 rgba(79, 70, 229, 0.1)',
    accent: '#6366F1',
};

const INITIAL_ITEMS_COUNT = 9;

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
            // Only use variant-specific videos
            videos: v.videos || [],
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

    // Determine which product images and videos to show
    let displayImages: string[] = [];
    let displayVideos: string[] = [];

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

        // VIDEO RESOLUTION: Use variant-specific videos when available
        // This is critical - we must use the selectedVariant's videos, NOT the default product videos
        if (selectedVariant.videos && selectedVariant.videos.length > 0) {
            displayVideos = selectedVariant.videos;
        } else {
            // If the variant has no specific videos, keep it empty to prevent "bleed-over" from other variants
            displayVideos = [];
        }
    }

    // FALLBACK: Strict enforcement for variants
    if (displayImages.length === 0) {
        if (!hasVariants) {
            // No variants exist (standard single product) - use official product images
            displayImages = data.productImages || [];
        } else if (selectedVariant) {
            // Variant is selected but no full gallery found yet - ONLY use high-res thumbnail
            // Never fall back to global productImages as they may belong to other variants
            if (selectedVariant.image) {
                displayImages = [selectedVariant.image];
            }
        }
        // If variants exist but none selected, display remains empty until selection
    }

    // FALLBACK: If no variant is selected, use default product videos
    if (displayVideos.length === 0 && !hasVariants) {
        displayVideos = data.productVideos || data.videos || [];
    }

    // Dedupe the display images
    displayImages = dedupeUrls(displayImages);

    displayImages.forEach(url => {
        addItem(url, 'image', 'product', 'productImage');
    });

    // Use the variant-specific videos (displayVideos) instead of always using data.productVideos/data.videos
    displayVideos.forEach(url => {
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
    const [downloadingAsin, setDownloadingAsin] = useState<string | null>(null); // Track active download by ASIN
    const [downloadSuccess, setDownloadSuccess] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null); // Added for preview

    // Selection State
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

    // Page Context State
    const [isAmazonPage, setIsAmazonPage] = useState(true);
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
    // Per-ASIN cache for variant images - preserves correct images for ALL variants across selections
    const [variantImagesCache, setVariantImagesCache] = useState<Record<string, string[]>>({});
    // Per-ASIN cache for variant videos - preserves correct videos for ALL variants across selections
    const [variantVideosCache, setVariantVideosCache] = useState<Record<string, string[]>>({});
    // Separate sub-tab state for the review section (images/videos)
    const [reviewSubTab, setReviewSubTab] = useState<'images' | 'videos'>('images');
    // Persistent Reviews State - Stores review media from the FIRST load of the product
    const [persistentReviews, setPersistentReviews] = useState<MediaItem[]>([]);
    const [isFetchingReviews, setIsFetchingReviews] = useState(false);
    // Split View State
    const [showAllReviewImages, setShowAllReviewImages] = useState(false);
    const [showAllReviewVideos, setShowAllReviewVideos] = useState(false);


    // Derived state
    // Use selectedVariantAsin to override default selection logic
    // When variantImagesCache/variantVideosCache has media for the selected variant, prioritize it over freshly scraped data
    const allMediaItems = useMemo(() => {
        const cachedImages = selectedVariantAsin ? variantImagesCache[selectedVariantAsin] : null;
        const cachedVideos = selectedVariantAsin ? variantVideosCache[selectedVariantAsin] : null;

        let baseItems: MediaItem[];

        // If we have cached images OR videos for the selected variant, use a modified data object
        if (selectedVariantAsin && (cachedImages || cachedVideos) && productData) {
            // Create a modified version of productData with the cached media
            const modifiedData = {
                ...productData,
                variants: productData.variants?.map(v =>
                    v.asin === selectedVariantAsin
                        ? {
                            ...v,
                            images: cachedImages || v.images,
                            videos: cachedVideos || v.videos,
                            selected: true
                        }
                        : { ...v, selected: false }
                )
            };
            baseItems = getMediaItems(modifiedData, selectedVariantAsin);
        } else {
            baseItems = getMediaItems(productData, selectedVariantAsin);
        }

        // CRITICAL: Merge persistentReviews into the media items
        // This ensures prefetched review media (both images AND videos) are displayed on initial load
        if (persistentReviews.length > 0) {
            const existingUrls = new Set(baseItems.map(item => item.url));
            const additionalReviews = persistentReviews.filter(item => !existingUrls.has(item.url));
            baseItems = [...baseItems, ...additionalReviews];
        }

        return baseItems;
    }, [productData, selectedVariantAsin, variantImagesCache, variantVideosCache, persistentReviews]);
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

    // URLs for preview navigation (based on item category)
    const getPreviewUrls = (item: MediaItem): string[] => {
        // Fix: Use the item's OWN category to determine the preview context.
        let currentItems: MediaItem[] = [];

        if (item.category === 'productImage') {
            currentItems = allMediaItems.filter(i => i.category === 'productImage');
        } else if (item.category === 'productVideo') {
            currentItems = allMediaItems.filter(i => i.category === 'productVideo');
        } else if (item.category === 'reviewImage') {
            // Use persistentReviews if available to ensure we have the full set
            currentItems = persistentReviews.length > 0
                ? persistentReviews.filter(i => i.category === 'reviewImage')
                : allMediaItems.filter(i => i.category === 'reviewImage');
        } else if (item.category === 'reviewVideo') {
            currentItems = persistentReviews.length > 0
                ? persistentReviews.filter(i => i.category === 'reviewVideo')
                : allMediaItems.filter(i => i.category === 'reviewVideo');
        } else {
            return filteredMediaItems.map(i => i.url);
        }

        // Ensure the clicked item is included if not found (edge case)
        const urls = currentItems.filter(i => i.type === item.type).map(i => i.url);
        if (!urls.includes(item.url)) {
            urls.unshift(item.url);
        }
        return urls;
    };

    // Media Item
    const renderMediaItem = (item: MediaItem, index: number) => {
        const isSelected = selectedItems.has(item.url);
        const isVideo = item.type === 'video';

        return (
            <div
                key={`${item.url}-${index}`}
                onClick={() => handlePreview(item)}
                title="Click to preview"
                style={{
                    position: 'relative',
                    aspectRatio: '1',
                    borderRadius: '8px', // Match standard
                    overflow: 'hidden',
                    background: COLORS.backgroundSecondary,
                    cursor: 'pointer',
                    border: `1px solid ${isSelected ? COLORS.primary : COLORS.borderLight}`,
                    boxShadow: isSelected ? COLORS.shadowPrimary : '0 1px 2px rgba(0,0,0,0.05)',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxSizing: 'border-box'
                }}
                className="media-item"
            >
                {isVideo ? (
                    <video src={item.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
                ) : (
                    <img src={item.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                )}

                {/* Badges - Icon Overlay for Video Only */}
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: 5 }}>
                    {isVideo && (
                        <div style={{
                            width: '32px', height: '32px',
                            background: 'rgba(0, 0, 0, 0.4)',
                            backdropFilter: 'blur(2px)',
                            borderRadius: '50%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                        }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="none">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                        </div>
                    )}
                </div>

                {/* Selection Checkbox - Consistent with Listing Page */}
                <div
                    onClick={(e) => toggleSelection(item.url, e)}
                    style={{
                        position: 'absolute', top: '8px', right: '8px', width: '24px', height: '24px',
                        borderRadius: '6px',
                        background: isSelected ? COLORS.primary : 'rgba(255,255,255,0.9)',
                        border: isSelected ? 'none' : '1px solid rgba(0,0,0,0.15)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: isSelected ? '0 2px 4px rgba(0,0,0,0.1)' : '0 1px 2px rgba(0,0,0,0.05)',
                        zIndex: 10, transition: 'all 0.2s',
                        cursor: 'pointer'
                    }}
                >
                    {isSelected && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" className="checkbox-bounce">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    )}
                </div>

                {/* Hover Overlay - Simplified Download Button */}
                <div
                    className="media-hover-overlay"
                    style={{
                        position: 'absolute', inset: 0,
                        background: 'rgba(0,0,0,0.02)', // Very subtle overlay
                        opacity: 0, transition: 'opacity 0.2s ease',
                        display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
                        padding: '8px', pointerEvents: 'none'
                    }}
                >
                    <button
                        onClick={(e) => { e.stopPropagation(); downloadSingle(item.url); }}
                        title="Download"
                        style={{
                            width: '24px', height: '24px', // Smaller
                            background: 'rgba(255,255,255,0.95)',
                            backdropFilter: 'blur(4px)',
                            borderRadius: '6px',
                            color: COLORS.text, border: 'none',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            pointerEvents: 'auto',
                            transition: 'all 0.2s',
                            opacity: 0.9
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.opacity = '1'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.opacity = '0.9'; }}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                    </button>
                </div>
            </div>
        );
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

    const isReviewSplitView = useMemo(() => {
        // Triggers split view if we have BOTH types of media AND a reasonable amount of content (>= 10 items total)
        // This ensures users don't have to scroll past 50 images to find 1 video
        const hasBothTypes = categoryCounts.reviewImages > 0 && categoryCounts.reviewVideos > 0;
        const totalCount = categoryCounts.reviewImages + categoryCounts.reviewVideos;
        return hasBothTypes && totalCount >= 10;
    }, [categoryCounts]);

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
    // Ref to track current data for comparison in callbacks without dependency cycles
    const productDataRef = useRef<ProductData | null>(null);
    // Cache for review media keyed by ASIN to persist across navigation
    const reviewCacheRef = useRef<Record<string, MediaItem[]>>({});
    // Flag to track if we've loaded reviews from storage
    const reviewStorageLoadedRef = useRef(false);

    // Load cached reviews from browser.storage on initial mount
    useEffect(() => {
        if (reviewStorageLoadedRef.current) return;
        reviewStorageLoadedRef.current = true;

        browser.storage.local.get('reviewCache').then((result) => {
            if (result.reviewCache && typeof result.reviewCache === 'object') {
                reviewCacheRef.current = result.reviewCache as Record<string, MediaItem[]>;
                // If we have a current ASIN, restore its reviews immediately
                const currentAsin = productDataRef.current?.asin;
                if (currentAsin && reviewCacheRef.current[currentAsin]) {
                    setPersistentReviews(reviewCacheRef.current[currentAsin]);
                }
            }
        }).catch(() => {/* ignore storage errors */ });
    }, []);

    useEffect(() => {
        productDataRef.current = productData;
    }, [productData]);

    const loadData = useCallback(async (triggerScroll: boolean = false) => {
        // Only show full loading spinner for initial load or manual scroll refresh
        // Background updates (triggerScroll=false) should be silent
        if (triggerScroll) {
            setLoading(true);
        }

        setError(null);
        try {
            const rawData = await scrapeProductData(triggerScroll);
            if (rawData) {
                // Enrich all variant cards with their specific images in background
                const enrichedData = enrichProductData(rawData);

                // CACHE ALL VARIANTS ON INITIAL LOAD
                // This ensures all variants preserve their media and don't need refresh on selection
                if (enrichedData?.variants && enrichedData.variants.length > 0) {
                    const newImageCache: Record<string, string[]> = {};
                    const newVideoCache: Record<string, string[]> = {};

                    enrichedData.variants.forEach(variant => {
                        // Cache images if we have them (or preserve empty state)
                        if (variant.images) {
                            newImageCache[variant.asin] = [...variant.images];
                        }
                        // Cache videos if we have them (including empty arrays to prevent bleed-over)
                        if (variant.videos) {
                            newVideoCache[variant.asin] = [...variant.videos];
                        }
                    });

                    // Merge with existing cache (preserve user selections)
                    setVariantImagesCache(prev => ({ ...newImageCache, ...prev }));
                    setVariantVideosCache(prev => ({ ...newVideoCache, ...prev }));
                }

                // CHECK: Should we ignore this update? (Background updates only)
                if (!triggerScroll && productDataRef.current) {
                    const currentData = productDataRef.current;
                    const newAsin = enrichedData?.asin;
                    const oldAsin = currentData.asin;

                    const oldVariants = currentData.variants || [];
                    const newVariants = enrichedData?.variants || [];

                    const isVariantSwitch =
                        oldVariants.some(v => v.asin === newAsin) ||
                        newVariants.some(v => v.asin === oldAsin);

                    const isDifferentAsin = oldAsin !== newAsin;

                    if (isDifferentAsin && isVariantSwitch) {
                        // Ignore website variant switch to keep panel stable
                        if (triggerScroll) setLoading(false);
                        return;
                    }
                }
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
            if (triggerScroll) {
                setLoading(false);
            }
        }
    }, [scrapeProductData]);

    // Reliable Persistent Reviews population with Caching by ASIN
    // Triggers whenever productData updates (via load or poll)
    // IMPORTANT: This now ACCUMULATES review media for the product across
    // all variant loads, instead of replacing it per-variant. The result is
    // a COMMON review section shared by every variant.
    useEffect(() => {
        if (!productData?.asin) return;
        const currentAsin = productData.asin;

        // 1. Extract fresh reviews from current payload
        const freshReviews: MediaItem[] = [];
        const freshAdded = new Set<string>();

        (productData.reviewImages || []).forEach(url => {
            if (url && !freshAdded.has(url)) {
                freshReviews.push({ url, type: 'image', source: 'review', category: 'reviewImage' });
                freshAdded.add(url);
            }
        });
        (productData.reviewVideos || []).forEach(url => {
            if (url && !freshAdded.has(url)) {
                freshReviews.push({ url, type: 'video', source: 'review', category: 'reviewVideo' });
                freshAdded.add(url);
            }
        });

        // 2. Merge fresh data into cache to build a product-wide union
        const existing = reviewCacheRef.current[currentAsin] || [];
        const existingUrls = new Set(existing.map(i => i.url));

        const merged: MediaItem[] = [...existing];
        freshReviews.forEach(item => {
            if (!existingUrls.has(item.url)) {
                existingUrls.add(item.url);
                merged.push(item);
            }
        });

        reviewCacheRef.current[currentAsin] = merged;

        // Persist to browser.storage for cross-session persistence
        browser.storage.local.set({ reviewCache: reviewCacheRef.current }).catch(() => {/* ignore */ });

        // 3. Expose the merged, product-wide review media as persistent state
        setPersistentReviews(merged);
    }, [productData]);


    // Track hydrated ASINs to prevent infinite re-fetching
    const hydratedAsinsRef = useRef<Set<string>>(new Set());

    // Background Gallery Hydration: Silently fetch full data for variants with incomplete galleries
    useEffect(() => {
        if (!productData?.variants) return;

        // Reset hydration tracking if product changes
        if (productData.asin && !hydratedAsinsRef.current.has('INIT_' + productData.asin)) {
            hydratedAsinsRef.current = new Set();
            hydratedAsinsRef.current.add('INIT_' + productData.asin);
        }

        const hydrateIncompleteVariants = async () => {
            // HYDRATION STRATEGY: Fetch ALL variants to guarantee 100% complete data.
            // We only skip:
            // 1. Variants we have already hydrated in this session
            // 2. The currently selected variant, BUT ONLY IF it already has a "good" amount of data.
            const incompleteVariants = productData.variants.filter(v => {
                // Skip if already hydrated
                if (hydratedAsinsRef.current.has(v.asin)) return false;

                // Special check for current product:
                // If it's the current product, we usually trust the DOM scrape.
                // BUT, if the DOM scrape yielded poor results (<= 3 images), we force a background fetch
                // to see if the raw HTML source has more data (often better for Bundles).
                if (v.asin === productData.asin) {
                    const currentCount = v.images?.length || 0;
                    if (currentCount > 3) return false; // Trust 4+ images
                    // If <= 3, allow hydration (fall through to true)
                }

                // Otherwise, ALWAYS fetch to ensure we have the full 8-10 image gallery
                return true;
            });

            if (incompleteVariants.length === 0) return;

            // Process sequentially to avoid flooding the browser/network
            for (const variant of incompleteVariants) {
                if (hydratedAsinsRef.current.has(variant.asin)) continue;
                hydratedAsinsRef.current.add(variant.asin); // Mark as in-progress

                try {
                    // console.log(`Hydrating gallery for variant: ${variant.asin}`);
                    const response = await browser.runtime.sendMessage({
                        type: 'FETCH_VARIANT_GALLERY',
                        asin: variant.asin
                    });

                    if (response && (response.images?.length > 0 || response.videos?.length > 0)) {
                        // Always update if we got valid data back
                        // console.log(`Hydration success for ${variant.asin}: ${response.images.length} images`);

                        // Update caches trigger re-render of variant cards
                        if (response.images?.length > 0) {
                            setVariantImagesCache(prev => ({
                                ...prev,
                                [variant.asin]: dedupeUrls(response.images)
                            }));
                        }
                        // Always update videos, even if empty, to ensure we don't bleed over main product videos
                        // But only if the response actually contained a videos array (even empty)
                        if (response.videos !== undefined) {
                            setVariantVideosCache(prev => ({
                                ...prev,
                                [variant.asin]: response.videos
                            }));
                        }
                    }
                } catch (e) {
                    console.error(`Hydration failed for ${variant.asin}`, e);
                }

                // Small delay between requests to be polite to Amazon
                await new Promise(r => setTimeout(r, 1000));
            }
        };

        // Run hydration with a small initial delay to let the main UI settle
        const timer = setTimeout(hydrateIncompleteVariants, 2000);
        return () => clearTimeout(timer);

    }, [productData?.variants, variantImagesCache]); // Re-check if cache updates or variants change


    useEffect(() => {
        // Initial load with scrolling
        loadData(true);
    }, [loadData]);

    // Fast auto-refresh to detect product changes (every 1.5 seconds)
    // Shows loader when navigating to a new product
    useEffect(() => {
        // Don't poll if switching variants (but ALLOW polling during download)
        if (selectingVariant) {
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
                    const isVariantSwitch = productData?.variants?.some(v => v.asin === enrichedNewData?.asin);

                    const productChanged = currentAsin && (
                        (enrichedNewData?.asin !== currentAsin && !isVariantSwitch) ||
                        enrichedNewData?.pageType !== productData?.pageType
                    );

                    if (productChanged) {
                        // Product changed - show loader and reset state
                        setLoading(true);
                        setSelectedItems(new Set());
                        setIsSelectionMode(false);
                        setShowAllItems(false);
                        setShowAllReviewImages(false);
                        setShowAllReviewVideos(false);
                        setSelectedVariantAsin(null);
                        setVariantImagesCache({}); // Clear cached images for new product
                        setVariantVideosCache({}); // Clear cached videos for new product
                        // DO NOT clear persistentReviews - reviews persist across variant changes
                        // Reviews will be updated when new product data loads from reviewCacheRef

                        // Brief delay to show loading state
                        setTimeout(() => {
                            setProductData(enrichedNewData);
                            setLoading(false);
                        }, 300);
                    } else {
                        // Same product - silently update data...
                        // UNLESS it's a variant switch on the website, which we want to ignore (keep panel state stable)
                        if (currentAsin && enrichedNewData?.asin !== currentAsin && isVariantSwitch) {
                            // User requested: "clicking a variant on website does not make any of the function in the panel"
                            // So we explicitly IGNORE this update to keep the panel locked to the previous variant.
                        } else {
                            // Same product update
                            // STRICT MODE: Preserve ALL variants from cache to prevent any re-enrichment
                            if (enrichedNewData && enrichedNewData.variants) {
                                const existingVariants = productDataRef.current?.variants || [];

                                // Preserve all variants from cache or existing state
                                enrichedNewData.variants = enrichedNewData.variants.map(v => {
                                    const cachedImages = variantImagesCache[v.asin];
                                    const cachedVideos = variantVideosCache[v.asin];
                                    const existingVariant = existingVariants.find(ev => ev.asin === v.asin);

                                    // Use cached data first, then existing, then scraped
                                    // Use '??' to allow empty arrays to be used
                                    return {
                                        ...v,
                                        images: cachedImages ?? existingVariant?.images ?? v.images,
                                        image: cachedImages ? cachedImages[0] : (existingVariant?.image ?? v.image),
                                        videos: cachedVideos ?? existingVariant?.videos ?? v.videos,
                                        selected: v.asin === selectedVariantAsin || v.selected
                                    };
                                });

                                // If there's a selected variant, sync main product media
                                if (selectedVariantAsin) {
                                    const selectedVariant = enrichedNewData.variants.find(v => v.asin === selectedVariantAsin);
                                    if (selectedVariant) {
                                        if (selectedVariant.images && selectedVariant.images.length > 0) {
                                            enrichedNewData.productImages = [...selectedVariant.images];
                                        }
                                        if (selectedVariant.videos && selectedVariant.videos.length > 0) {
                                            enrichedNewData.videos = [...selectedVariant.videos];
                                        }
                                    }
                                }
                            }
                            setProductData(enrichedNewData);
                        }
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
    }, [selectingVariant, productData?.asin, productData?.pageType, scrapeProductData, selectedVariantAsin, variantImagesCache, variantVideosCache]); // Added cache deps

    // Check for Amazon Page Context
    useEffect(() => {
        const checkPageContext = async () => {
            try {
                // Get active tab in current window
                let tabs = await browser.tabs.query({ active: true, currentWindow: true });
                if (tabs.length === 0) {
                    tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
                }

                if (tabs.length > 0 && tabs[0].url) {
                    const url = tabs[0].url.toLowerCase();
                    const isValid = url.includes('.amazon.') || url.includes('/dp/') || url.includes('gp/product');
                    setIsAmazonPage(isValid);

                    // Force refresh if we are on a valid page but have no data
                    if (isValid && !productData && !loading) {
                        loadData(true);
                    }
                }
            } catch (e) {
                console.error('Context check failed:', e);
            }
        };

        checkPageContext();

        // Listen for tab updates to re-verify context
        const handleTabUpdate = (tabId: number, changeInfo: any, tab: any) => {
            if (tab.active && changeInfo.status === 'complete') {
                checkPageContext();
            }
        };

        const handleTabActivated = () => {
            checkPageContext();
        };

        browser.tabs.onUpdated.addListener(handleTabUpdate);
        browser.tabs.onActivated.addListener(handleTabActivated);

        return () => {
            browser.tabs.onUpdated.removeListener(handleTabUpdate);
            browser.tabs.onActivated.removeListener(handleTabActivated);
        };
    }, [productData, loading, loadData]);

    // Listener for content changes (immediate updates)
    useEffect(() => {
        const handleMessage = (message: any) => {
            if (message.type === 'CONTENT_CHANGED' || message.type === 'active_image_changed') {
                if (message.reason === 'prefetch_update') {
                    setIsFetchingReviews(true);
                } else if (message.reason === 'prefetch_complete') {
                    setIsFetchingReviews(false);
                } else if (message.reason === 'product_changed') {
                    setIsFetchingReviews(true);
                    loadData(true);
                    return;
                }
                loadData(false);
            }
        };

        // Add listener
        browser.runtime.onMessage.addListener(handleMessage);

        // Cleanup
        return () => {
            browser.runtime.onMessage.removeListener(handleMessage);
        };
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
    const handleVariantSelect = async (asin: string, variantName: string, variantImages?: string[], variantVideos?: string[]) => {
        if (!selectVariant || selectingVariant) return;

        // Auto-preview logic: Show the main image (or video if no images) immediately
        if (showPreview) {
            const hasImages = variantImages && variantImages.length > 0;
            const hasVideos = variantVideos && variantVideos.length > 0;

            if (hasImages || hasVideos) {
                // Construct the full context: Images first, then Videos (Standard Gallery Order)
                const allUrls = [...(variantImages || []), ...(variantVideos || [])];

                // Show the first item (Image #1 or Video #1)
                const targetUrl = allUrls[0];
                const targetType = hasImages ? 'image' : 'video';

                showPreview(targetUrl, targetType, allUrls);
            }
        }

        setSelectedVariantAsin(asin);
        setSelectingVariant(true);
        setVariantDropdownOpen(false);

        try {
            // Trigger the selection on the page, but DO NOT update/poll for new data
            await selectVariant(asin);
        } catch (err) {
            console.error('Variant selection failed', err);
        } finally {
            setSelectingVariant(false);
        }
    };

    // ============================================
    // Download Functions
    // ============================================
    const downloadAll = async () => {
        if (!productData) return;

        const currentAsin = productData.asin;
        setDownloadingAsin(currentAsin);
        setDownloadSuccess(false);

        let finalData: ProductData | null = productData;

        // Force enrich data if on product images tab to ensure high-qual images
        if (isProductPage && mainTab === 'product' && subTab === 'images') {
            try {
                await new Promise<void>(resolve => {
                    browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
                        const tabId = tabs[0]?.id;
                        if (tabId) browser.tabs.sendMessage(tabId, { type: 'FORCE_ENRICH_ALL' }).then(() => resolve());
                        else resolve();
                    });
                });
                const refreshed = await scrapeProductData(false);
                if (refreshed) {
                    finalData = enrichProductData(refreshed);
                    // Only update UI if we are still on the same page
                    if (finalData?.asin === productDataRef.current?.asin) {
                        setProductData(finalData);
                    }
                }
            } catch (e) { }
        }

        let items: (string | { url: string; filename: string })[] = [];
        let categoryLabel = `${mainTab}-${subTab}`;

        // PRIORITY: If user has manually selected items, download ONLY those
        if (selectedItems.size > 0) {
            items = Array.from(selectedItems);
            categoryLabel = `selected-${selectedItems.size}`;
        } else {
            // Determines if we should create a structured ZIP with folders for each variant
            const shouldGroupVariants = isProductPage && mainTab === 'product' && subTab === 'images' && finalData?.variants;

            if (shouldGroupVariants && finalData) {
                finalData.variants!.forEach(variant => {
                    const vImages = variant.images || [];
                    const vVideos = variant.videos || [];
                    if (vImages.length === 0 && vVideos.length === 0) return;

                    const safeName = variant.name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');

                    vImages.forEach((url, i) => {
                        let ext = 'jpg';
                        const parts = url.split('.');
                        if (parts.length > 1) {
                            const potentialExt = parts[parts.length - 1].split('?')[0].toLowerCase();
                            if (['png', 'webp', 'jpeg', 'gif'].includes(potentialExt)) {
                                ext = potentialExt;
                            }
                        }
                        items.push({ url, filename: `Variant_${safeName}/images/image_${i + 1}.${ext}` });
                    });

                    vVideos.forEach((url, i) => {
                        let ext = 'mp4';
                        const parts = url.split('.');
                        if (parts.length > 1) {
                            const potentialExt = parts[parts.length - 1].split('?')[0].toLowerCase();
                            if (['webm', 'm3u8', 'mov'].includes(potentialExt)) {
                                ext = potentialExt;
                            }
                        }
                        items.push({ url, filename: `Variant_${safeName}/videos/video_${i + 1}.${ext}` });
                    });
                });
            } else if (mainTab === 'review') {
                const targetType = subTab === 'images' ? 'image' : 'video';
                allMediaItems.filter(i => i.source === 'review' && i.type === targetType).forEach((item, i) => {
                    let ext = targetType === 'video' ? 'mp4' : 'jpg';
                    if (targetType === 'video') {
                        // specific video extension check
                        const parts = item.url.split('.');
                        if (parts.length > 1) {
                            const potentialExt = parts[parts.length - 1].split('?')[0].toLowerCase();
                            if (['webm', 'm3u8', 'mov'].includes(potentialExt)) ext = potentialExt;
                        }
                    }
                    items.push({ url: item.url, filename: `Reviews/${subTab}/${item.type}_${i + 1}.${ext}` });
                });
            } else {
                if (!isProductPage) {
                    items = filteredListingProducts.map(p => p.image);
                } else {
                    items = filteredMediaItems.map(i => i.url);
                }
            }
        }

        if (items.length === 0) { setDownloadingAsin(null); return; }

        try {
            const baseFilename = `pixora-${productData.asin || 'media'}-${categoryLabel}-${Date.now()}`;

            // CHUNKING LOGIC: Group into batches to avoid browser/memory crashes
            // Limit: ~80 files OR ~230MB estimated (25MB per video, 1MB per image)
            const batches: (string | { url: string; filename: string })[][] = [];
            let currentBatch: (string | { url: string; filename: string })[] = [];
            let currentBatchCount = 0;
            let currentBatchSizeEst = 0;

            const MAX_FILES_PER_ZIP = 80;
            const MAX_MB_PER_ZIP = 230;

            items.forEach((item) => {
                const url = typeof item === 'string' ? item : item.url;
                const isVideo = /\.(mp4|webm|m3u8|mov|avi)(\?|$)/i.test(url);
                const estSize = isVideo ? 25 : 1; // Estimated MB

                if (currentBatchCount + 1 > MAX_FILES_PER_ZIP || currentBatchSizeEst + estSize > MAX_MB_PER_ZIP) {
                    if (currentBatch.length > 0) {
                        batches.push(currentBatch);
                        currentBatch = [];
                        currentBatchCount = 0;
                        currentBatchSizeEst = 0;
                    }
                }

                currentBatch.push(item);
                currentBatchCount += 1;
                currentBatchSizeEst += estSize;
            });

            if (currentBatch.length > 0) {
                batches.push(currentBatch);
            }

            // Process batches sequentially to respect sequential memory use
            for (let i = 0; i < batches.length; i++) {
                const batchItems = batches[i];
                const batchSuffix = batches.length > 1 ? `-batch${i + 1}` : '';
                const finalFilename = `${baseFilename}${batchSuffix}`;

                // Download individual ZIP batch
                await downloadZip(batchItems, finalFilename);
            }

            if (currentAsin === productDataRef.current?.asin) {
                setDownloadSuccess(true);
                setSelectedItems(new Set());
                setIsSelectionMode(false);
                setTimeout(() => setDownloadSuccess(false), 3000);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setDownloadingAsin(null);
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

    const handleRefresh = async () => {
        // SMART SYNC: If a variant is selected, perform a fast "Repair & Sync"
        if (isProductPage && selectedVariantAsin) {
            try {
                // Use a non-blocking scrape (no 'loading' state for seamless experience)
                const rawData = await scrapeProductData(false);
                if (rawData) {
                    const enrichedData = enrichProductData(rawData);

                    if (enrichedData) {
                        const officialVariant = enrichedData.variants?.find(v => v.asin === selectedVariantAsin);

                        if (officialVariant) {
                            const newImages = officialVariant.images || [];

                            // 1. Precise Cache Sync (Authority Fix) - IMAGES ONLY
                            setVariantImagesCache(prev => ({ ...prev, [selectedVariantAsin]: [...newImages] }));

                            // 2. Immediate UI Patch (No Delay) - IMAGES ONLY
                            setProductData(prev => {
                                if (!prev || !prev.variants) return prev;
                                const updatedVariants = prev.variants.map(v =>
                                    v.asin === selectedVariantAsin
                                        ? { ...v, images: [...newImages] }
                                        : v
                                );

                                return {
                                    ...prev,
                                    variants: updatedVariants,
                                    // If this is the active selected variant, sync main gallery images
                                    productImages: (selectedVariantAsin === prev.asin) ? [...newImages] : prev.productImages
                                };
                            });

                            // Smart Refresh is done - no need for full reset/load
                            return;
                        }
                    }
                }
            } catch (err) {
                console.warn('Smart sync failed, falling back to full refresh:', err);
            }
        }

        // Standard Full Refresh (If no variant selected or smart sync failed)
        setSelectedItems(new Set());
        setIsSelectionMode(false);
        setSearchTerm('');
        setActiveSearchTerm('');
        setMainTab('product');
        setSubTab('images');
        setShowAllItems(false);
        setShowAllReviewImages(false);
        setShowAllReviewVideos(false);

        // Reset variant state if needed
        if (!selectedVariantAsin) {
            setVariantImagesCache({});
            setVariantVideosCache({});
        }

        setPersistentReviews([]);
        setVariantDropdownOpen(false);
        setSelectingVariant(false);
        setVariantStartIndex(0);

        loadData(true);
    };

    // ============================================
    // render functions
    // ============================================



    // Listing Product Item
    const renderListingProduct = (product: ListingProduct, index: number) => {
        const isSelected = selectedItems.has(product.image);

        return (
            <div
                key={`${product.asin}-${index}`}
                style={{
                    background: COLORS.surface,
                    borderRadius: '8px', // Match Variant Card
                    overflow: 'hidden',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    border: `1px solid ${isSelected ? COLORS.primary : COLORS.borderLight}`, // Match uniform border style
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    display: 'flex',
                    flexDirection: 'column',
                    boxSizing: 'border-box'
                }}
                className="listing-product"
            >
                <div
                    onClick={() => handlePreview({ url: product.image, type: 'image', source: 'product', category: 'productImage' })}
                    title="Click to preview"
                    style={{
                        aspectRatio: '1',
                        position: 'relative',
                        background: COLORS.backgroundSecondary,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        borderBottom: `1px solid ${COLORS.borderLight}`
                    }}
                >
                    <img src={product.image} style={{ width: '90%', height: '90%', objectFit: 'contain', transition: 'transform 0.4s cubic-bezier(0.165, 0.84, 0.44, 1)' }} className="listing-img" loading="lazy" />

                    <div
                        onClick={(e) => toggleSelection(product.image, e)}
                        style={{
                            position: 'absolute', top: '8px', right: '8px', width: '24px', height: '24px',
                            borderRadius: '6px',
                            background: isSelected ? COLORS.primary : 'rgba(255,255,255,0.9)',
                            border: isSelected ? 'none' : '1px solid rgba(0,0,0,0.15)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: isSelected ? '0 2px 4px rgba(0,0,0,0.1)' : '0 1px 2px rgba(0,0,0,0.05)',
                            zIndex: 5, transition: 'all 0.2s',
                            cursor: 'pointer'
                        }}
                    >
                        {isSelected && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                    </div>
                </div>

                <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                    <div style={{ flex: 1 }}>
                        <h4 style={{
                            fontSize: '13.5px',
                            fontWeight: 700,
                            color: COLORS.text,
                            margin: 0,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            lineHeight: '1.4',
                            letterSpacing: '-0.1px'
                        }}>
                            {product.title}
                        </h4>
                        <div style={{
                            fontSize: '10px',
                            color: COLORS.textSecondary,
                            fontWeight: 600,
                            marginTop: '4px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            opacity: 0.6
                        }}>
                            ASIN: {product.asin}
                        </div>
                    </div>

                    <div style={{ marginTop: '2px' }}>
                        <button
                            onClick={(e) => { e.stopPropagation(); downloadSingle(product.image); }}
                            style={{
                                width: '100%',
                                background: COLORS.primarySoft,
                                borderRadius: '8px',
                                border: 'none',
                                color: COLORS.primary,
                                padding: '7px 0',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px',
                                fontSize: '11px',
                                fontWeight: 800,
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.background = COLORS.primary;
                                e.currentTarget.style.color = '#fff';
                                e.currentTarget.style.transform = 'translateY(-1px)';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = COLORS.primarySoft;
                                e.currentTarget.style.color = COLORS.primary;
                                e.currentTarget.style.transform = 'translateY(0)';
                            }}
                            title="Download Image"
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                            Download
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const renderInvalidPage = () => {
        return (
            <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '32px',
                textAlign: 'center',
                color: COLORS.textSecondary,
                height: '100%',
                background: COLORS.background
            }}>
                <div style={{
                    width: '64px', height: '64px',
                    borderRadius: '50%',
                    background: COLORS.primarySoft,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: '20px',
                    color: COLORS.primary
                }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                </div>
                <h3 style={{ fontSize: '18px', fontWeight: 600, color: COLORS.text, margin: '0 0 8px 0' }}>Amazon Pages Only</h3>
                <p style={{ fontSize: '14px', lineHeight: '1.5', maxWidth: '280px', margin: '0 auto' }}>
                    This extension works only on Amazon product pages. Visit an Amazon product to use it.
                </p>
                <div style={{ marginTop: '24px' }}>
                    <a href="https://www.amazon.com" target="_blank" rel="noopener noreferrer"
                        style={{
                            display: 'inline-block',
                            padding: '10px 20px',
                            background: COLORS.primary,
                            color: '#fff',
                            borderRadius: '8px',
                            textDecoration: 'none',
                            fontSize: '14px',
                            fontWeight: 600,
                            boxShadow: COLORS.shadowPrimary
                        }}>
                        Go to Amazon
                    </a>
                </div>
            </div>
        );
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
    // Empty State
    const renderEmpty = () => {
        const isOnGenericAmazon = isAmazonPage && (!productData || (productData.pageType !== 'product' && productData.pageType !== 'listing') || !hasContent);

        return (
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
                    borderRadius: '24px',
                    background: COLORS.primarySoft,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '24px',
                    color: COLORS.primary
                }}>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                </div>

                <h3 style={{ fontSize: '18px', fontWeight: 700, color: COLORS.text, marginBottom: '10px', letterSpacing: '0.4px' }}>
                    {isOnGenericAmazon ? 'Visit a Product Page' : 'No Media Found'}
                </h3>

                <p style={{ fontSize: '14px', color: COLORS.textSecondary, lineHeight: 1.6, maxWidth: '280px', marginBottom: '32px' }}>
                    {isOnGenericAmazon
                        ? 'Open any product or search results and we\'ll automatically extract all images and videos for you.'
                        : (error || 'We couldn\'t find any images or videos on this specific page. Try refreshing the page or visiting another product.')}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <button
                        onClick={handleRefresh}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            minWidth: '160px',
                            padding: '10px 24px',
                            background: 'transparent',
                            border: `1.5px solid ${COLORS.primary}`,
                            borderRadius: '10px',
                            fontSize: '13.5px',
                            fontWeight: 700,
                            color: COLORS.primary,
                            boxShadow: 'none',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            letterSpacing: '0.2px'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = COLORS.primaryGlow;
                            e.currentTarget.style.transform = 'translateY(-1px)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.transform = 'translateY(0)';
                        }}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M23 4v6h-6M1 20v-6h6" />
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                        Refresh Page
                    </button>

                    {isOnGenericAmazon && (
                        <a
                            href="https://www.amazon.com/s?k=bestsellers"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                                fontSize: '13px',
                                fontWeight: 600,
                                color: COLORS.primary,
                                textDecoration: 'none',
                                padding: '8px 16px',
                                opacity: 0.9,
                                transition: 'opacity 0.2s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                            onMouseLeave={e => e.currentTarget.style.opacity = '0.9'}
                        >
                            Search for Products →
                        </a>
                    )}
                </div>
            </div>
        );
    };



    // Category Tabs (Main Navigation) - LAYER 1
    const renderMainTabs = () => {
        if (!isProductPage) return null;

        const tabs = [
            { id: 'product', label: 'Product Variants', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
            { id: 'review', label: 'Review Media', icon: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z' }
        ];

        return (
            <div style={{
                display: 'flex',
                background: COLORS.surface,
                padding: '0 16px', // Standardized padding
                borderBottom: `1px solid ${COLORS.border}`,
                gap: '24px', // More breathing room
                flexShrink: 0,
                zIndex: 30,
                height: '46px' // Slightly more compact
            }}>
                {tabs.map((tab) => {
                    const isActive = mainTab === tab.id;
                    const count = tab.id === 'review'
                        ? persistentReviews.length
                        : (allVariants.length || (isProductPage ? 1 : 0));

                    return (
                        <div
                            key={tab.id}
                            onClick={() => {
                                setMainTab(tab.id as MainTab);
                                if (tab.id === 'product') setSubTab('images');
                            }}
                            style={{
                                flex: 1, // Distribute space equally
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center', // Center content within the tab
                                gap: '8px',
                                color: isActive ? COLORS.primary : COLORS.textMuted, // Reduced inactive contrast
                                cursor: 'pointer',
                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                position: 'relative',
                                flexShrink: 0,
                                whiteSpace: 'nowrap',
                                height: '100%',
                                opacity: isActive ? 1 : 0.8
                            }}
                        >
                            {/* Active Indicator (Absolute to prevent layout shift) */}
                            {isActive && (
                                <div style={{
                                    position: 'absolute',
                                    bottom: 0,
                                    left: 0,
                                    width: '100%',
                                    height: '3px',
                                    background: COLORS.primary,
                                    borderTopLeftRadius: '3px',
                                    borderTopRightRadius: '3px'
                                }} />
                            )}
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isActive ? "3" : "1.8"} style={{ opacity: isActive ? 1 : 0.6 }}>
                                <path d={tab.icon} />
                            </svg>
                            <span style={{
                                fontSize: isActive ? '13px' : '12px',
                                fontWeight: isActive ? 700 : 500,
                            }}>
                                {tab.label}
                            </span>
                            {count > 0 && (
                                <span style={{
                                    fontSize: '10px',
                                    background: isActive ? COLORS.primarySoft : COLORS.backgroundSecondary,
                                    color: isActive ? COLORS.primary : COLORS.textSecondary,
                                    minWidth: '20px',
                                    height: '18px',
                                    padding: '0 6px',
                                    borderRadius: '10px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: isActive ? 800 : 600,
                                    marginLeft: '4px',
                                    opacity: isActive ? 1 : 0.7
                                }}>
                                    {count}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };

    // Action Bar (Secondary Header with Stats & Download) - LAYER 2 (Context + Actions)
    const renderActionBar = () => {
        // Now rendered for both Product and Listing pages
        if (!isProductPage && !isListingPage) return null;

        const isVariantView = mainTab === 'product' && subTab === 'images';

        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: (isVariantView || mainTab === 'review' || isListingPage) ? 'space-between' : 'flex-end',
                padding: '0 16px',
                height: '40px', // More compact context row
                background: COLORS.background,
                borderBottom: `1px solid ${COLORS.borderLight}`, // Subtler divider
                flexShrink: 0,
                zIndex: 40
            }}>
                {/* Left Side: Subtler Stats (Demoted counts) */}
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    {(isVariantView || mainTab === 'review') && isProductPage && (
                        <div style={{ fontSize: '12.5px', fontWeight: 500, color: COLORS.textMuted, display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <span>Images</span>
                                <span style={{ color: COLORS.textSecondary, fontWeight: 700 }}>
                                    {mainTab === 'review' ? categoryCounts.reviewImages : allVariants.reduce((acc, v) => acc + (v.images?.length || 0), 0)}
                                </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <span>Videos</span>
                                <span style={{ color: COLORS.textSecondary, fontWeight: 700 }}>
                                    {mainTab === 'review' ? categoryCounts.reviewVideos : allVariants.reduce((acc, v) => acc + (v.videos?.length || 0), 0)}
                                </span>
                            </div>
                        </div>
                    )}
                    {isListingPage && (
                        <div style={{
                            fontSize: '14px',
                            fontWeight: 700,
                            color: COLORS.primary,
                        }}>
                            Listed Products: {filteredListingProducts.length}
                        </div>
                    )}
                </div>

                {/* Right Side: Primary Download All Action */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <button
                        onClick={downloadAll}
                        disabled={!!downloadingAsin && downloadingAsin === productData?.asin}
                        className="download-main-btn"
                        style={{
                            height: '28px', // Fixed height for perfect centering
                            padding: '0 12px', // Horizontal padding only
                            minWidth: '120px',
                            background: COLORS.primarySoft,
                            color: COLORS.primary,
                            borderRadius: '8px', // Slightly larger radius for larger button
                            fontSize: '13px',
                            fontWeight: 700,
                            border: `1.2px solid ${COLORS.primary}`,
                            cursor: (downloadingAsin === productData?.asin) ? 'wait' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                            opacity: (downloadingAsin === productData?.asin) ? 0.7 : 1,
                            boxShadow: 'none' // Reduced noise
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.background = COLORS.primary;
                            e.currentTarget.style.color = '#FFFFFF';
                            e.currentTarget.style.transform = 'translateY(-1px)';
                            e.currentTarget.style.boxShadow = '0 4px 10px rgba(79, 70, 229, 0.15)';
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = COLORS.primarySoft;
                            e.currentTarget.style.color = COLORS.primary;
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = 'none';
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {downloadingAsin === productData?.asin ? (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 1.5s linear infinite' }}>
                                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                </svg>
                            ) : (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                            )}
                            <span style={{ whiteSpace: 'nowrap' }}>
                                {selectedItems.size > 0 ? `Download (${selectedItems.size})` : 'Download All'}
                            </span>
                        </div>
                    </button>

                    {/* Background Progress Pill */}
                    {downloadingAsin && downloadingAsin !== productData?.asin && (
                        <div style={{
                            position: 'absolute',
                            top: '100%',
                            right: 0,
                            marginTop: '8px',
                            padding: '6px 14px',
                            background: COLORS.surface,
                            borderRadius: '20px',
                            border: `1px solid ${COLORS.borderLight}`,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                            zIndex: 100,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            animation: 'fadeInSlide 0.3s ease-out',
                            whiteSpace: 'nowrap'
                        }}>
                            <div style={{ width: '12px', height: '12px', border: `2px solid ${COLORS.primary}`, borderRadius: '50%', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }}></div>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.textSecondary }}>Completing previous download...</span>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderReviewMedia = () => {
        const reviewImages = allMediaItems.filter(i => i.category === 'reviewImage');
        const reviewVideos = allMediaItems.filter(i => i.category === 'reviewVideo');

        if (reviewImages.length === 0 && reviewVideos.length === 0) return renderEmpty();

        // Helper to render grid with potential overlay on last item (9th item)
        const renderGridWithOverlay = (totalItems: MediaItem[], showAll: boolean, onShowAll: () => void, limit: number = 9) => {
            // const limit = 9; // Replaced by parameter
            const shouldOverlay = !showAll && totalItems.length > limit;
            // Always render up to 'limit' items if collapsed.
            // If overlay needed: render limit items, but the last one (index limit-1) gets the overlay.
            const displayItems = showAll ? totalItems : totalItems.slice(0, limit);

            return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '4px' }}>
                    {displayItems.map((item, index) => {
                        const isLastItem = index === limit - 1;
                        if (shouldOverlay && isLastItem) {
                            const hiddenCount = totalItems.length - (limit - 1);

                            return (
                                <div
                                    key={`overlay-${item.url}-${index}`}
                                    style={{ position: 'relative', cursor: 'pointer', borderRadius: '12px', overflow: 'hidden' }}
                                    onClick={(e) => { e.stopPropagation(); onShowAll(); }}
                                >
                                    {renderMediaItem(item, index)}
                                    <div style={{
                                        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                                        background: 'rgba(0,0,0,0.6)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: '#fff', fontSize: '14px', fontWeight: 700,
                                        backdropFilter: 'blur(2px)',
                                        zIndex: 10
                                    }}>
                                        +{hiddenCount}
                                    </div>
                                </div>
                            );
                        }
                        return renderMediaItem(item, index);
                    })}
                </div>
            );
        };

        // SPLIT VIEW LAYOUT (Large content)
        if (isReviewSplitView) {
            return (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    overflow: 'hidden',
                    gap: '0' // No gap, using padding/borders
                }}>
                    {/* TOP HALF: Images */}
                    <div style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0,
                        overflowY: 'auto',
                        paddingBottom: '16px'
                    }}>
                        <div style={{
                            fontSize: '11px', fontWeight: 700, letterSpacing: '0.6px',
                            textTransform: 'uppercase', color: COLORS.textSecondary,
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '4px 0 12px 0', // Sticky header padding
                            position: 'sticky', top: 0, background: COLORS.background, zIndex: 10
                        }}>
                            <span>Customer Images</span>
                            <span style={{
                                background: COLORS.primaryGlow, color: COLORS.primary,
                                padding: '1px 8px', borderRadius: '12px',
                                fontSize: '10px', fontWeight: 800
                            }}>{reviewImages.length}</span>
                        </div>

                        {renderGridWithOverlay(reviewImages, showAllReviewImages, () => setShowAllReviewImages(true), 9)}

                        {showAllReviewImages && (
                            <button
                                onClick={() => setShowAllReviewImages(false)}
                                style={{
                                    marginTop: '16px', width: '100%', padding: '10px',
                                    background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                                    borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                                    color: COLORS.primary, cursor: 'pointer', display: 'flex',
                                    alignItems: 'center', justifyContent: 'center', gap: '6px'
                                }}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"></polyline></svg>
                                Show Less
                            </button>
                        )}

                        {showAllReviewImages && <div style={{ height: '20px' }}></div>}
                    </div>

                    {/* DIVIDER */}
                    <div style={{
                        height: '1px',
                        background: COLORS.borderLight,
                        margin: '0 -16px', // Bleed to edges
                        flexShrink: 0
                    }}></div>

                    {/* BOTTOM HALF: Videos */}
                    <div style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0,
                        overflowY: 'auto',
                        paddingTop: '16px',
                        paddingBottom: '20px' // Extra bottom padding
                    }}>
                        <div style={{
                            fontSize: '11px', fontWeight: 700, letterSpacing: '0.6px',
                            textTransform: 'uppercase', color: COLORS.textSecondary,
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '0 0 12px 0',
                            position: 'sticky', top: 0, background: COLORS.background, zIndex: 10
                        }}>
                            <span>Customer Videos</span>
                            <span style={{
                                background: COLORS.primaryGlow, color: COLORS.primary,
                                padding: '1px 8px', borderRadius: '12px',
                                fontSize: '10px', fontWeight: 800
                            }}>{reviewVideos.length}</span>
                        </div>

                        {renderGridWithOverlay(reviewVideos, showAllReviewVideos, () => setShowAllReviewVideos(true), 6)}

                        {showAllReviewVideos && (
                            <button
                                onClick={() => setShowAllReviewVideos(false)}
                                style={{
                                    marginTop: '16px', width: '100%', padding: '10px',
                                    background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                                    borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                                    color: COLORS.primary, cursor: 'pointer', display: 'flex',
                                    alignItems: 'center', justifyContent: 'center', gap: '6px'
                                }}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"></polyline></svg>
                                Show Less
                            </button>
                        )}

                        {showAllReviewVideos && <div style={{ height: '20px' }}></div>}
                    </div>
                </div>
            );
        }

        // STANDARD LAYOUT (Small content or Mixed small/large)
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {isFetchingReviews && (
                    <div style={{
                        marginTop: '-12px',
                        marginBottom: '4px',
                        padding: '10px 14px',
                        background: COLORS.primarySoft,
                        borderRadius: '12px',
                        border: `1px solid ${COLORS.primary}15`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        animation: 'fadeInSlide 0.5s cubic-bezier(0.16, 1, 0.3, 1)'
                    }}>
                        <div className="status-dot-pulse" style={{ width: '8px', height: '8px', borderRadius: '50%', background: COLORS.primary }}></div>
                        <span style={{ fontSize: '12.5px', fontWeight: 600, color: COLORS.primary, letterSpacing: '-0.1px' }}>
                            Discovering more media from reviews...
                        </span>
                        <div style={{ flex: 1 }}></div>
                        <div className="loading-dots" style={{ display: 'flex', gap: '4px' }}>
                            <div className="dot" style={{ width: '4px', height: '4px', background: COLORS.primary, borderRadius: '50%', opacity: 0.6 }}></div>
                            <div className="dot" style={{ width: '4px', height: '4px', background: COLORS.primary, borderRadius: '50%', opacity: 0.6 }}></div>
                            <div className="dot" style={{ width: '4px', height: '4px', background: COLORS.primary, borderRadius: '50%', opacity: 0.6 }}></div>
                        </div>
                    </div>
                )}
                {reviewImages.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            letterSpacing: '0.6px',
                            textTransform: 'uppercase',
                            color: COLORS.textSecondary,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '4px 0',
                            borderLeft: `3px solid ${COLORS.primary}`, // Subtle side accent
                            paddingLeft: '10px'
                        }}>
                            <span>Customer Images</span>
                            <span style={{
                                background: COLORS.primaryGlow,
                                color: COLORS.primary,
                                padding: '1px 8px',
                                borderRadius: '12px',
                                fontSize: '10px',
                                fontWeight: 800
                            }}>
                                {reviewImages.length}
                            </span>
                        </div>
                        {renderGridWithOverlay(reviewImages, showAllItems, () => setShowAllItems(true), 9)}

                        {reviewVideos.length > 0 && (
                            <div style={{ height: '1px', background: COLORS.borderLight, marginTop: '20px', marginBottom: '-4px', opacity: 0.6 }}></div>
                        )}
                    </div>
                )}

                {reviewVideos.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            letterSpacing: '0.6px',
                            textTransform: 'uppercase',
                            color: COLORS.textSecondary,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '4px 0',
                            borderLeft: `3px solid ${COLORS.primary}`, // Subtle side accent
                            paddingLeft: '10px',
                            marginTop: '4px'
                        }}>
                            <span>Customer Videos</span>
                            <span style={{
                                background: COLORS.primaryGlow,
                                color: COLORS.primary,
                                padding: '1px 8px',
                                borderRadius: '12px',
                                fontSize: '10px',
                                fontWeight: 800
                            }}>
                                {reviewVideos.length}
                            </span>
                        </div>
                        {renderGridWithOverlay(reviewVideos, showAllItems, () => setShowAllItems(true), 6)}
                    </div>
                )}

                {/* Show Less button for Standard View */}
                {showAllItems && (
                    <button
                        onClick={() => setShowAllItems(false)}
                        style={{
                            width: '100%', padding: '10px',
                            background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                            borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                            color: COLORS.primary, cursor: 'pointer', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', gap: '6px'
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"></polyline></svg>
                        Show Less
                    </button>
                )}
            </div>
        );
    };

    // Variant List - CONTENT GRID ONLY
    const renderVariantList = () => {
        let baseVariants = productData?.variants || [];

        // If no variants found, treat the current product as the single available "variant"
        if (baseVariants.length === 0 && productData) {
            baseVariants = [{
                asin: productData.asin,
                name: productData.title,
                image: productData.productImages?.[0] || '', // Use first image as thumb
                available: true,
                selected: true,
                images: productData.productImages || [],
                videos: productData.videos || []
            }];
        }

        const allVariants = baseVariants.map(v => {
            const cachedImages = variantImagesCache[v.asin];
            const cachedVideos = variantVideosCache[v.asin];

            let updatedVariant = { ...v };
            if (cachedImages) {
                updatedVariant.images = cachedImages;
                if (cachedImages.length > 0) {
                    updatedVariant.image = cachedImages[0];
                }
            }
            if (cachedVideos) {
                updatedVariant.videos = cachedVideos;
            }
            return updatedVariant;
        });

        if (allVariants.length === 0) return null;

        return (
            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr',
                gap: '8px', // Reduced gap for tighter rhythm
                width: '100%',
                boxSizing: 'border-box'
            }}>
                {allVariants.map((variant) => {
                    // Fix: Check manual selection first, then fallback to data selection
                    const isCurrent = selectedVariantAsin
                        ? selectedVariantAsin === variant.asin
                        : variant.selected;

                    const imageCount = variant.images?.length || 0;
                    const videoCount = variant.videos?.length || 0;
                    const totalCount = imageCount + videoCount;

                    return (
                        <div
                            key={variant.asin}
                            onClick={() => !selectingVariant && handleVariantSelect(variant.asin, variant.name, variant.images, variant.videos)}
                            className="variant-card"
                            title="Click to preview variant"
                            style={{
                                background: isCurrent
                                    ? '#EFF6FF'
                                    : COLORS.surface,
                                borderRadius: '12px',
                                border: isCurrent ? `2px solid ${COLORS.primary}` : '1.5px solid #E2E8F0',
                                padding: '10px 12px', // Slightly more compact
                                cursor: selectingVariant ? 'wait' : 'pointer',
                                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                boxShadow: isCurrent
                                    ? `0 0 0 4px ${COLORS.primaryGlow}, 0 10px 20px -8px rgba(79, 70, 229, 0.2)`
                                    : '0 1px 2px rgba(0,0,0,0.02)',
                                position: 'relative',
                                overflow: 'visible',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px',
                                boxSizing: 'border-box',
                                transform: selectingVariant && isCurrent ? 'scale(0.98)' : 'scale(1)',
                                opacity: selectingVariant && !isCurrent ? 0.6 : 1
                            }}
                            onMouseEnter={(e) => {
                                if (!selectingVariant && !isCurrent) {
                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                    e.currentTarget.style.boxShadow = '0 4px 10px rgba(0,0,0,0.06)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isCurrent) {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.02)';
                                }
                            }}
                        >
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <div style={{
                                    width: '56px', height: '56px', borderRadius: '8px', // Shrunk from 64px
                                    background: `url(${variant.image}) center/contain no-repeat`,
                                    backgroundColor: COLORS.backgroundSecondary, flexShrink: 0,
                                    border: `1px solid ${COLORS.borderLight}`
                                }} />

                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <h4 style={{
                                                fontSize: '14px', // Slightly larger / dominant
                                                fontWeight: 600, // Reduced from 800
                                                color: '#475569', // Softer Slate 600 (was Slate 700)
                                                margin: 0, display: '-webkit-box', WebkitLineClamp: 2,
                                                WebkitBoxOrient: 'vertical', overflow: 'hidden',
                                                lineHeight: '1.3',
                                                textTransform: 'capitalize',
                                                letterSpacing: '0px' // Removed tight spacing
                                            }}>{variant.name.replace(/^\\\s*/, '').toLowerCase()}</h4>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                                <span style={{
                                                    fontSize: '9.5px', // More prominent
                                                    // fontSize: '10.5px', // Keep font size
                                                    color: COLORS.textMuted, // Much lighter (was textSecondary)
                                                    fontWeight: 500, // Reduced from 700
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.4px'
                                                }}>ASIN: {variant.asin}</span>
                                            </div>
                                        </div>
                                        {isCurrent && (
                                            <div style={{
                                                background: COLORS.primary,
                                                color: '#fff',
                                                fontSize: '9px',
                                                fontWeight: 800,
                                                padding: '2px 8px',
                                                borderRadius: '20px',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.4px',
                                                boxShadow: '0 2px 4px rgba(79, 70, 229, 0.2)'
                                            }}>Active</div>
                                        )}
                                    </div>

                                    {/* Inline Media Strip (Normalized thumbnails) */}
                                    <div style={{ display: 'flex', gap: '5px', marginTop: '8px' }}>
                                        {(() => {
                                            const images = variant.images || [];
                                            const videos = variant.videos || [];
                                            const allMedia = [...images.map(u => ({ type: 'img', url: u })), ...videos.map(u => ({ type: 'vid', url: u }))];
                                            const allUrls = [...images, ...videos];

                                            const MAX_VISIBLE = 6; // More visible items since they are smaller
                                            const hasMore = allMedia.length > MAX_VISIBLE;
                                            const displayItems = hasMore ? allMedia.slice(0, MAX_VISIBLE - 1) : allMedia;
                                            const remaining = allMedia.length - displayItems.length;

                                            return (
                                                <>
                                                    {displayItems.map((item, idx) => (
                                                        <div key={`${item.type}-${idx}`}
                                                            className="variant-thumb"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (showPreview) showPreview(item.url, item.type === 'img' ? 'image' : 'video', allUrls);
                                                            }}
                                                            style={{
                                                                width: '32px', height: '32px', // Shrunk from 36px
                                                                borderRadius: '6px',
                                                                background: item.type === 'img'
                                                                    ? `url(${item.url}) center/cover no-repeat`
                                                                    : '#1F2937',
                                                                backgroundColor: COLORS.backgroundSecondary,
                                                                border: `1px solid ${COLORS.borderLight}`,
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                position: 'relative'
                                                            }}
                                                            title={item.type === 'img' ? 'View Image' : 'Play Video'}
                                                        >
                                                            {item.type === 'vid' && (
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="none" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}>
                                                                    <path d="M8 5v14l11-7z" />
                                                                </svg>
                                                            )}
                                                        </div>
                                                    ))}
                                                    {remaining > 0 && (
                                                        <div
                                                            className="variant-show-more"
                                                            title={`View ${remaining} more items`}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const target = allMedia[displayItems.length];
                                                                if (target && showPreview) showPreview(target.url, target.type === 'img' ? 'image' : 'video', allUrls);
                                                            }}
                                                            style={{
                                                                width: '32px', height: '32px',
                                                                borderRadius: '6px',
                                                                background: '#E2E8F0',
                                                                border: `1px solid ${COLORS.borderLight}`,
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                color: '#475569',
                                                                fontSize: '10px',
                                                                fontWeight: 700
                                                            }}>
                                                            +{remaining}
                                                        </div>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </div>
                                </div>
                            </div>

                            <div style={{ marginTop: '4px', paddingTop: '8px', borderTop: `1px solid ${isCurrent ? '#DBEAFE' : COLORS.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                {/* Combined Media Text */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11.5px', fontWeight: 700, color: COLORS.accent }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                                        <span>Images</span>
                                        <span style={{
                                            background: isCurrent ? COLORS.primary : COLORS.backgroundSecondary,
                                            color: isCurrent ? '#fff' : COLORS.text, // Stronger text
                                            minWidth: '20px',
                                            height: '20px',
                                            borderRadius: '10px',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontWeight: 800,
                                            fontSize: '10px',
                                            marginLeft: '2px'
                                        }}>{imageCount}</span>
                                    </div>
                                    {videoCount > 0 && (
                                        <>
                                            <span style={{ color: COLORS.border, opacity: 0.6 }}>|</span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: COLORS.accent }}>
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
                                                <span>Videos</span>
                                                <span style={{
                                                    background: isCurrent ? COLORS.primary : COLORS.backgroundSecondary,
                                                    color: isCurrent ? '#fff' : COLORS.text, // Stronger text
                                                    minWidth: '20px',
                                                    height: '20px',
                                                    borderRadius: '10px',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    fontWeight: 800,
                                                    fontSize: '10px',
                                                    marginLeft: '2px'
                                                }}>{videoCount}</span>
                                            </div>
                                        </>
                                    )}
                                </div>

                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const allMedia = [...(variant.images || []), ...(variant.videos || [])];
                                        if (allMedia.length > 0) downloadZip(allMedia, `pixora-${variant.asin}`);
                                    }}
                                    disabled={selectingVariant}
                                    title={`Download media for ${variant.name}`}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        background: isCurrent ? COLORS.primary : '#F9FAFB', // Subtle tint
                                        border: isCurrent ? 'none' : '1px solid #CBD5E1', // Higher contrast
                                        padding: '5px 10px',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        color: isCurrent ? '#fff' : COLORS.text,
                                        transition: 'all 0.2s',
                                        height: '26px',
                                        boxShadow: isCurrent ? COLORS.shadowPrimary : 'none'
                                    }}
                                    onMouseEnter={e => {
                                        if (!selectingVariant && !isCurrent) {
                                            e.currentTarget.style.borderColor = COLORS.primary;
                                            e.currentTarget.style.color = COLORS.primary;
                                            e.currentTarget.style.background = `${COLORS.primary}08`;
                                        }
                                    }}
                                    onMouseLeave={e => {
                                        if (!isCurrent) {
                                            e.currentTarget.style.background = 'transparent';
                                            e.currentTarget.style.borderColor = COLORS.borderLight;
                                            e.currentTarget.style.color = COLORS.text;
                                        }
                                    }}
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                    Download
                                </button>
                            </div>
                        </div>
                    );
                })
                }
            </div >
        );
    };



    // Check if we have content
    // For product pages, also consider variants as valid content (variant cards are the main UI)
    // Also prevent empty state during variant selection transitions
    const hasVariants = productData?.variants && productData.variants.length > 0;
    const hasContent = isProductPage
        ? (allMediaItems.length > 0 || hasVariants || selectingVariant)
        : filteredListingProducts.length > 0;
    const displayCount = isProductPage ? totalCount : filteredListingProducts.length;

    // ============================================
    // Main Render
    // ============================================

    // TEMPORARY: Hide the Product Media section as requested, but keep download functionality
    const SHOW_PRODUCT_MEDIA_SECTION = false;

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
            {/* GLOBAL HEADER: Utilities Only */}
            <div style={{
                height: '34px', // More compact
                padding: '0 16px',
                background: COLORS.surface,
                borderBottom: `1px solid ${COLORS.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
                zIndex: 50
            }}>
                {/* Left: Utility Links - Quieter */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    {/* Contact */}
                    <a
                        href="https://www.thinksolv.com/contact"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: '12px', fontWeight: 500, color: COLORS.textSecondary, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.2s' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = COLORS.primary; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = COLORS.textSecondary; }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                            <polyline points="22,6 12,13 2,6"></polyline>
                        </svg>
                        Contact
                    </a>

                    <div style={{ width: '1px', height: '14px', background: COLORS.border }}></div>

                    {/* Help Docs */}
                    <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); }}
                        style={{ fontSize: '12px', fontWeight: 500, color: COLORS.textSecondary, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.2s', cursor: 'pointer' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = COLORS.primary; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = COLORS.textSecondary; }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                            <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                        Help Docs
                    </a>
                </div>

                {/* Right: Refresh Button */}
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{ width: '1px', height: '16px', background: COLORS.borderLight, marginRight: '12px' }}></div>
                    <button
                        onClick={handleRefresh}
                        disabled={loading}
                        className="refresh-btn"
                        style={{
                            width: '28px',
                            height: '28px',
                            padding: 0,
                            background: 'transparent',
                            border: 'none',
                            color: COLORS.text,
                            cursor: loading ? 'wait' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s',
                            borderRadius: '8px',
                            opacity: 0.8
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = COLORS.backgroundSecondary;
                            e.currentTarget.style.color = COLORS.primary;
                            e.currentTarget.style.opacity = '1';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = COLORS.text;
                            e.currentTarget.style.opacity = '0.8';
                        }}
                        title="Refresh Data"
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: loading ? 'spin 1.5s linear infinite' : 'none' }}>
                            <path d="M23 4v6h-6M1 20v-6h6" />
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* HEADER removed for Listing Pages as requested to merge with search bar */}

            {/* SEARCH BAR (Listing Pages) - ONLY IF CONTENT EXISTS */}
            {
                !loading && isListingPage && hasContent && (
                    <div style={{ padding: '8px 10px', background: COLORS.surface, borderBottom: `1px solid ${COLORS.borderLight}`, display: 'flex', alignItems: 'center' }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                            <input
                                type="text"
                                placeholder="Search products by name or ASIN..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && setActiveSearchTerm(searchTerm)}
                                style={{
                                    width: '100%',
                                    padding: '10px 68px 10px 14px',
                                    background: COLORS.background,
                                    border: `1.5px solid ${COLORS.border}`,
                                    borderRadius: '12px',
                                    fontSize: '13px',
                                    fontWeight: 500,
                                    color: COLORS.text,
                                    outline: 'none',
                                    fontFamily: 'inherit',
                                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                    boxShadow: 'none'
                                }}
                                onFocus={(e) => {
                                    e.currentTarget.style.borderColor = COLORS.primary;
                                    e.currentTarget.style.boxShadow = `0 0 0 3px ${COLORS.primaryGlow}`;
                                    e.currentTarget.style.background = COLORS.surface;
                                }}
                                onBlur={(e) => {
                                    e.currentTarget.style.borderColor = COLORS.border;
                                    e.currentTarget.style.boxShadow = 'none';
                                    e.currentTarget.style.background = COLORS.background;
                                }}
                            />
                            {searchTerm && (
                                <button
                                    onClick={() => { setSearchTerm(''); setActiveSearchTerm(''); }}
                                    style={{
                                        position: 'absolute', right: '40px', top: '50%', transform: 'translateY(-50%)',
                                        background: COLORS.backgroundSecondary, border: 'none',
                                        color: COLORS.textSecondary, cursor: 'pointer',
                                        padding: '4px', width: '22px', height: '22px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        borderRadius: '50%', transition: 'all 0.2s',
                                        zIndex: 5
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = COLORS.border; e.currentTarget.style.color = COLORS.text; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = COLORS.backgroundSecondary; e.currentTarget.style.color = COLORS.textSecondary; }}
                                    title="Clear search"
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            )}
                            <button
                                onClick={() => setActiveSearchTerm(searchTerm)}
                                style={{
                                    position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                                    background: COLORS.primaryGlow, border: 'none',
                                    color: COLORS.primary, cursor: 'pointer', padding: '7px',
                                    borderRadius: '10px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    transition: 'all 0.2s',
                                    zIndex: 6
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = COLORS.primary; e.currentTarget.style.color = '#fff'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = COLORS.primaryGlow; e.currentTarget.style.color = COLORS.primary; }}
                                title="Search"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                                </svg>
                            </button>
                        </div>
                    </div>
                )
            }

            {isAmazonPage && renderMainTabs()}
            <main style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                position: 'relative'
            }}>
                {!isAmazonPage ? renderInvalidPage() : (loading && !selectingVariant && !hasVariants) ? renderLoading() : !hasContent ? renderEmpty() : (
                    <>
                        {renderActionBar()}
                        <div className="scroll-container" style={{
                            flex: 1,
                            overflowY: (isProductPage && mainTab === 'review' && isReviewSplitView) ? 'hidden' : 'auto',
                            background: COLORS.background,
                            display: 'flex',
                            flexDirection: 'column',
                            padding: (isProductPage && mainTab === 'review' && isReviewSplitView) ? '12px 16px 0 16px' : '12px 16px 60px 16px', // No bottom padding for split view (scrollbar reset)
                            boxSizing: 'border-box'
                        }}>
                            {/* Product Variants List */}
                            {/* Product Variants List with Top Download Action */}
                            {isProductPage && mainTab === 'product' && subTab === 'images' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {renderVariantList()}
                                </div>
                            )}

                            {/* Review Media (Images first, then videos) */}
                            {isProductPage && mainTab === 'review' && (
                                renderReviewMedia()
                            )}

                            {/* Product Videos ONLY (Product tab, Videos subtab) */}
                            {isProductPage && mainTab === 'product' && subTab === 'videos' && (
                                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                                        {displayedItems.map((item, index) => renderMediaItem(item, index))}
                                    </div>

                                    {hasMoreItems && !showAllItems && (
                                        <button
                                            onClick={() => setShowAllItems(true)}
                                            style={{
                                                width: '100%', padding: '10px',
                                                background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                                                borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                                                color: COLORS.primary, cursor: 'pointer', display: 'flex',
                                                alignItems: 'center', justifyContent: 'center', gap: '6px'
                                            }}
                                        >
                                            Show More ({hiddenCount})
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Listing Page Content */}
                            {isListingPage && (
                                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                                        {filteredListingProducts.map((product, index) => renderListingProduct(product, index))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </main>

            <style>{`
                /* Header enhancements - Subtle */
                .refresh-btn:hover:not(:disabled) { background: ${COLORS.backgroundSecondary} !important; color: ${COLORS.text} !important; }
                .refresh-btn:active:not(:disabled) { transform: scale(0.96); }
                
                /* Media grid with fade-in animation */
                .media-item { 
                    transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.4s ease !important;
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
                    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.02) !important;
                    z-index: 5;
                }
                
                /* Listing products */
                .listing-product { 
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); 
                }
                .listing-product:hover { 
                    transform: translateY(-4px);
                    box-shadow: 0 12px 24px -10px rgba(0, 0, 0, 0.15) !important;
                    border-color: ${COLORS.primarySoft} !important;
                }
                .listing-product:hover .listing-img {
                    transform: scale(1.1);
                }
                
                /* Variant cards */
                .variant-option-hover:hover { 
                    box-shadow: ${COLORS.shadowMd} !important;
                    background: ${COLORS.surface} !important;
                    z-index: 5;
                }
                .variant-download-btn:hover { background: ${COLORS.primary} !important; color: #fff !important; transform: scale(1.05); }
                .variant-thumb:hover { transform: scale(1.02); box-shadow: 0 4px 6px rgba(0,0,0,0.05) !important; }
                
                /* Global Scrollbar Branding */
                ::-webkit-scrollbar { width: 6px; height: 6px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 10px; border: 2px solid transparent; background-clip: content-box; }
                ::-webkit-scrollbar-thumb:hover { background: ${COLORS.primarySoft}; }
                ::-webkit-scrollbar-thumb:active { background: ${COLORS.border}; }

                /* Status Dot Pulse */
                .status-dot-pulse {
                    box-shadow: 0 0 0 0 ${COLORS.primary}30;
                    animation: statusPulse 2s infinite;
                }
                
                /* Loading Dots Animation */
                .loading-dots .dot { animation: dotBounce 1.4s infinite ease-in-out both; }
                .loading-dots .dot:nth-child(1) { animation-delay: -0.32s; }
                .loading-dots .dot:nth-child(2) { animation-delay: -0.16s; }
                
                /* Animations */
                @keyframes statusPulse { 0% { transform: scale(0.95); box-shadow: 0 0 0 0 ${COLORS.primary}00; } 70% { transform: scale(1); box-shadow: 0 0 0 6px ${COLORS.primary}00; } 100% { transform: scale(0.95); box-shadow: 0 0 0 0 ${COLORS.primary}00; } }
                @keyframes dotBounce { 0%, 80%, 100% { transform: scale(0); opacity: 0.3; } 40% { transform: scale(1.0); opacity: 1; } }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                @keyframes fadeInSlide { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes fadeInScale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
                @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
                @keyframes checkBounce { 0% { transform: scale(0.8); } 50% { transform: scale(1.2); } 100% { transform: scale(1.0); } }
            `}</style>
        </div >
    );
}

export default PanelApp;
