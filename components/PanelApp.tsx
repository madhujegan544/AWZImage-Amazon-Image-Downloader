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
            // Prefer variant-specific videos, but fallback to page videos for the active variant if missing
            videos: (v.videos && v.videos.length > 0)
                ? v.videos
                : ((v.selected || v.asin === data.asin) ? (data.videos || []) : []),
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
    // Separate sub-tab state for the review section (images/videos)
    const [reviewSubTab, setReviewSubTab] = useState<'images' | 'videos'>('images');
    // Persistent Reviews State - Stores review media from the FIRST load of the product
    const [persistentReviews, setPersistentReviews] = useState<MediaItem[]>([]);


    // Derived state
    // Use selectedVariantAsin to override default selection logic
    // When variantImagesCache has images for the selected variant, prioritize it over freshly scraped data
    const allMediaItems = useMemo(() => {
        const cachedImages = selectedVariantAsin ? variantImagesCache[selectedVariantAsin] : null;
        // If we have cached images for the selected variant, use a modified data object
        if (selectedVariantAsin && cachedImages && cachedImages.length > 0 && productData) {
            // Create a modified version of productData with the cached images
            const modifiedData = {
                ...productData,
                variants: productData.variants?.map(v =>
                    v.asin === selectedVariantAsin
                        ? { ...v, images: cachedImages, selected: true }
                        : { ...v, selected: false }
                )
            };
            return getMediaItems(modifiedData, selectedVariantAsin);
        }
        return getMediaItems(productData, selectedVariantAsin);
    }, [productData, selectedVariantAsin, variantImagesCache]);
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

                {/* Selection Checkbox - Refined */}
                <div
                    onClick={(e) => toggleSelection(item.url, e)}
                    style={{
                        position: 'absolute', top: '8px', right: '8px', width: '24px', height: '24px',
                        borderRadius: '6px', // Match Listing Checkbox
                        background: isSelected ? COLORS.primary : 'rgba(255,255,255,0.9)',
                        border: isSelected ? 'none' : `1px solid rgba(0,0,0,0.15)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: isSelected ? COLORS.shadowMd : '0 1px 2px rgba(0,0,0,0.1)',
                        transition: 'all 0.2s',
                        zIndex: 10,
                        cursor: 'pointer',
                        opacity: isSelected ? 1 : 0.6 // Fade out when not selected for cleaner look
                    }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={e => !isSelected && (e.currentTarget.style.opacity = '0.6')}
                >
                    {isSelected && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
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
                        setSelectedVariantAsin(null);
                        setShowAllItems(false);
                        setSelectedVariantAsin(null);
                        setVariantImagesCache({}); // Clear cached images for new product
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
                            // STRICT MODE: If we have a selected variant and cached images for it,
                            // we MUST enforce those cached images to prevent background pollution.
                            if (selectedVariantAsin && variantImagesCache[selectedVariantAsin]) {
                                const enforcedImages = variantImagesCache[selectedVariantAsin];
                                if (enforcedImages && enforcedImages.length > 0) {
                                    if (enrichedNewData) {
                                        enrichedNewData.productImages = [...enforcedImages];
                                        // Also update the variant object itself within the new data
                                        enrichedNewData.variants = enrichedNewData.variants?.map(v => {
                                            if (v.asin === selectedVariantAsin) {
                                                return { ...v, images: enforcedImages, image: enforcedImages[0] };
                                            }
                                            return v;
                                        }) || [];
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
        return () => clearInterval(fastPollInterval);
    }, [selectingVariant, productData?.asin, productData?.pageType, scrapeProductData]); // Removed downloading from deps

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
            // Listen for variant changes or other scraped content updates
            if (message.type === 'CONTENT_CHANGED' || message.type === 'active_image_changed') {
                // console.log('Received refresh signal:', message.reason);
                loadData(false); // Refresh data without scrolling
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

        if (variantImages && variantImages.length > 0) {
            setVariantImagesCache(prev => ({ ...prev, [asin]: [...variantImages] }));
        }

        setSelectingVariant(true);
        setVariantDropdownOpen(false);

        try {
            const success = await selectVariant(asin);
            if (success) {
                let attempts = 0;
                const maxAttempts = 5;

                const pollData = async () => {
                    attempts++;
                    await new Promise(r => setTimeout(r, 800));
                    try {
                        const newData = await scrapeProductData(false);
                        if (newData) {
                            const enrichedData = enrichProductData(newData);
                            const newVariant = enrichedData?.variants?.find(v => v.selected);

                            if (newVariant?.asin === asin) {
                                // Enforce images AND videos (persist known correct data)
                                let imgsToEnforce = variantImagesCache[asin] || variantImages;
                                let vidsToEnforce = variantVideos;

                                if (enrichedData && enrichedData.variants) {
                                    enrichedData.variants = enrichedData.variants.map(v => {
                                        if (v.asin !== asin) return v;

                                        const enforcedImages = (imgsToEnforce && imgsToEnforce.length > 0) ? imgsToEnforce : v.images;
                                        const enforcedVideos = (vidsToEnforce && vidsToEnforce.length > 0) ? vidsToEnforce : v.videos;

                                        // Strict Sync: Ensure main product images match this variant only
                                        if (enrichedData && enforcedImages && enforcedImages.length > 0) {
                                            enrichedData.productImages = [...enforcedImages];
                                        }

                                        return {
                                            ...v,
                                            images: enforcedImages,
                                            image: (enforcedImages && enforcedImages.length > 0) ? enforcedImages[0] : v.image,
                                            videos: enforcedVideos
                                        };
                                    });
                                }
                                setProductData(enrichedData);
                                setSelectingVariant(false);
                                return;
                            } else if (attempts >= maxAttempts) {
                                setSelectingVariant(false);
                                return;
                            }
                            await pollData();
                        }
                    } catch (e) {
                        if (attempts < maxAttempts) await pollData();
                        else setSelectingVariant(false);
                    }
                };
                await pollData();
            } else {
                setSelectingVariant(false);
            }
        } catch (err) {
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
            items = isProductPage ? filteredMediaItems.map(i => i.url) : filteredListingProducts.map(p => p.image);
        }

        if (items.length === 0) { setDownloadingAsin(null); return; }

        try {
            const finalFilename = `pixora-${productData.asin || 'media'}-${categoryLabel}-${Date.now()}`;
            // Download ZIP
            await downloadZip(items, finalFilename);
            if (currentAsin === productDataRef.current?.asin) {
                setDownloadSuccess(true);
                setTimeout(() => setDownloadSuccess(false), 3000);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setDownloadingAsin(null);
        }
    };

    const downloadSelected = async () => {
        if (selectedCount === 0) return;

        if (productData?.asin) setDownloadingAsin(productData.asin);
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
            setTimeout(() => setDownloadingAsin(null), 500);
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
        setVariantImagesCache({}); // Clear cached images on refresh
        setPersistentReviews([]); // Clear persistent reviews on refresh
        setVariantDropdownOpen(false);
        setSelectingVariant(false);
        setVariantStartIndex(0);

        // Reload data WITH loading state (force scroll/visual feedback)
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
                    <img src={product.image} style={{ width: '90%', height: '90%', objectFit: 'contain', transition: 'transform 0.3s' }} className="listing-img" loading="lazy" />

                    <div
                        onClick={(e) => toggleSelection(product.image, e)}
                        style={{
                            position: 'absolute', top: '8px', right: '8px', width: '24px', height: '24px',
                            borderRadius: '6px', // Standard radius
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

                <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                    <h4 style={{
                        fontSize: '14px', // Match Variant Title
                        fontWeight: 700,
                        color: COLORS.text,
                        margin: 0,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        height: 'auto',
                        lineHeight: '1.4'
                    }}>
                        {product.title}
                    </h4>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: '4px' }}>
                        <span style={{
                            fontSize: '10px', // Match Variant ASIN
                            color: COLORS.textMuted,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.3px',
                            background: 'transparent',
                            padding: 0
                        }}>ASIN: {product.asin}</span>

                        <button
                            onClick={(e) => { e.stopPropagation(); downloadSingle(product.image); }}
                            style={{
                                width: '28px',
                                height: '28px',
                                background: 'transparent',
                                borderRadius: '6px',
                                border: `1px solid ${COLORS.borderLight}`,
                                color: COLORS.textSecondary,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = COLORS.primary; e.currentTarget.style.color = COLORS.primary; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = COLORS.borderLight; e.currentTarget.style.color = COLORS.textSecondary; }}
                            title="Download Image"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
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



    // Category Tabs (Main Navigation)
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
                padding: '0 12px',
                borderBottom: `1px solid ${COLORS.border}`,
                gap: '8px',
                flexShrink: 0,
                zIndex: 30,
                flexWrap: 'nowrap',
                overflowX: 'auto',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
                height: '44px' // Consistent height
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
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '0 12px',
                                borderBottom: `3px solid ${isActive ? COLORS.primary : 'transparent'}`,
                                color: isActive ? COLORS.primary : COLORS.textSecondary,
                                cursor: 'pointer',
                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                position: 'relative',
                                flexShrink: 0,
                                whiteSpace: 'nowrap',
                                height: '100%'
                            }}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isActive ? "2.8" : "2.2"}>
                                <path d={tab.icon} />
                            </svg>
                            <span style={{
                                fontSize: '13.5px',
                                fontWeight: isActive ? 700 : 500,
                                letterSpacing: '-0.1px',
                                opacity: isActive ? 1 : 0.8
                            }}>
                                {tab.label}
                            </span>
                            {count > 0 && (
                                <span style={{
                                    fontSize: '10px',
                                    background: isActive ? COLORS.primary : COLORS.backgroundSecondary,
                                    color: isActive ? '#fff' : COLORS.textSecondary,
                                    minWidth: '18px',
                                    height: '18px',
                                    borderRadius: '9px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 700,
                                    marginLeft: '2px'
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

    // Action Bar (Secondary Header with Stats/Toggles & Download All)
    const renderActionBar = () => {
        if (!isProductPage) return null;

        const isVariantView = mainTab === 'product' && subTab === 'images';

        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 16px',
                height: '42px',
                background: COLORS.backgroundSecondary, // Softer background
                borderBottom: `1px solid ${COLORS.border}`,
                flexShrink: 0,
                zIndex: 40
            }}>
                {/* Left Side: Stats or Toggles */}
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    {isVariantView ? (
                        <div style={{ fontSize: '12px', fontWeight: 600, color: COLORS.textSecondary, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                                <span>{allVariants.reduce((acc, v) => acc + (v.images?.length || 0), 0)} Images</span>
                            </div>
                            <span style={{ color: COLORS.borderLight, fontSize: '10px' }}>|</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                                <span>{allVariants.reduce((acc, v) => acc + (v.videos?.length || 0), 0)} Videos</span>
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: '4px', background: COLORS.backgroundSecondary, padding: '3px', borderRadius: '8px' }}>
                            {[
                                { id: 'images', label: 'Images' },
                                { id: 'videos', label: 'Videos' }
                            ].map((t) => {
                                const isReview = (mainTab as string) === 'review';
                                const counts = isReview
                                    ? [categoryCounts.reviewImages, categoryCounts.reviewVideos]
                                    : [categoryCounts.productImages, categoryCounts.productVideos];
                                const count = t.id === 'images' ? counts[0] : counts[1];

                                return (
                                    <button
                                        key={t.id}
                                        onClick={() => setSubTab(t.id as SubTab)}
                                        style={{
                                            padding: '4px 10px',
                                            borderRadius: '6px',
                                            border: 'none',
                                            background: subTab === t.id ? COLORS.surface : 'transparent',
                                            color: subTab === t.id ? COLORS.primary : COLORS.textSecondary,
                                            fontSize: '11.5px',
                                            fontWeight: 700,
                                            cursor: 'pointer',
                                            boxShadow: subTab === t.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                                            transition: 'all 0.15s ease'
                                        }}
                                    >
                                        {t.label} <span style={{ opacity: 0.5, fontSize: '10px', marginLeft: '2px' }}>({count})</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Right Side: Primary Download All Action */}
                <button
                    onClick={downloadAll}
                    disabled={!!downloadingAsin && downloadingAsin === productData?.asin}
                    className="download-main-btn"
                    style={{
                        padding: '6px 14px',
                        background: COLORS.primary,
                        color: '#fff',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontWeight: 700,
                        border: 'none',
                        cursor: (downloadingAsin === productData?.asin) ? 'wait' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                        opacity: (downloadingAsin === productData?.asin) ? 0.85 : 1,
                        boxShadow: '0 4px 12px rgba(79, 70, 229, 0.2)',
                    }}
                >
                    {downloadingAsin === productData?.asin ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 1.5s linear infinite' }}>
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                    ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                    )}
                    <span style={{ whiteSpace: 'nowrap' }}>{downloadingAsin === productData?.asin ? 'Processing...' : 'Download All'}</span>
                </button>
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
            if (cachedImages && cachedImages.length > 0) {
                return { ...v, images: cachedImages, image: cachedImages[0] || v.image };
            }
            return v;
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
                                borderRadius: '8px',
                                border: isCurrent ? `2px solid ${COLORS.primary}` : '1px solid #CBD5E1', // Stronger border
                                padding: '10px',
                                cursor: selectingVariant ? 'wait' : 'pointer',
                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                boxShadow: isCurrent
                                    ? '0 6px 16px -2px rgba(99, 102, 241, 0.25), 0 4px 6px -1px rgba(99, 102, 241, 0.1)'
                                    : '0 1px 3px rgba(0,0,0,0.1)', // Restored shadow
                                position: 'relative',
                                overflow: 'hidden',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px', // Reduced gap
                                boxSizing: 'border-box',
                                transform: selectingVariant && isCurrent ? 'scale(0.99)' : 'scale(1)',
                                opacity: selectingVariant && !isCurrent ? 0.7 : 1
                            }}
                            onMouseEnter={(e) => {
                                if (!selectingVariant && !isCurrent) {
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isCurrent) {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
                                }
                            }}
                        >
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                <div style={{
                                    width: '64px', height: '64px', borderRadius: '8px',
                                    background: `url(${variant.image}) center/contain no-repeat`,
                                    backgroundColor: COLORS.backgroundSecondary, flexShrink: 0,
                                    border: `1px solid ${COLORS.borderLight}`
                                }} />

                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <h4 style={{
                                                fontSize: '14px', fontWeight: 700, color: COLORS.text,
                                                margin: 0, display: '-webkit-box', WebkitLineClamp: 2,
                                                WebkitBoxOrient: 'vertical', overflow: 'hidden',
                                                lineHeight: '1.4',
                                                textTransform: 'capitalize'
                                            }}>{variant.name.toLowerCase()}</h4>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                                                <span style={{
                                                    fontSize: '10px',
                                                    color: COLORS.textMuted,
                                                    fontWeight: 600,
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.3px'
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

                                    {/* Inline Media Strip (Max 5 items) */}
                                    <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                                        {(() => {
                                            const images = variant.images || [];
                                            const videos = variant.videos || [];
                                            const allMedia = [...images.map(u => ({ type: 'img', url: u })), ...videos.map(u => ({ type: 'vid', url: u }))];
                                            const allUrls = [...images, ...videos];

                                            const MAX_VISIBLE = 5; // Adjusted for larger 36px thumbnails
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
                                                                width: '36px', height: '36px',
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
                                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="none" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}>
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
                                                                width: '36px', height: '36px',
                                                                borderRadius: '6px',
                                                                background: '#E2E8F0', // Stronger contrast
                                                                border: `1px solid ${COLORS.borderLight}`,
                                                                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.06)', // Inner shadow
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                color: '#475569',
                                                                fontSize: '11px',
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
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', fontWeight: 600, color: COLORS.accent }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                                        <span>{imageCount} Images</span>
                                    </div>
                                    {videoCount > 0 && (
                                        <>
                                            <span style={{ color: COLORS.border }}>|</span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: COLORS.accent }}>
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
                                                <span>{videoCount} Video{videoCount !== 1 ? 's' : ''}</span>
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
    const hasContent = isProductPage ? allMediaItems.length > 0 : filteredListingProducts.length > 0;
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
                height: '34px',
                padding: '0 12px',
                background: COLORS.backgroundSecondary,
                borderBottom: `1px solid ${COLORS.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
                zIndex: 50
            }}>
                {/* Left: Utility Links */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {/* Settings */}
                    <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); }}
                        style={{ fontSize: '11.5px', fontWeight: 600, color: COLORS.textSecondary, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.2s', cursor: 'pointer' }}
                        onMouseEnter={(e) => e.currentTarget.style.color = COLORS.primary}
                        onMouseLeave={(e) => e.currentTarget.style.color = COLORS.textSecondary}
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <circle cx="12" cy="12" r="3"></circle>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                        </svg>
                        Settings
                    </a>

                    <span style={{ color: COLORS.text, fontSize: '12px', opacity: 0.4 }}>|</span>

                    {/* Contact */}
                    <a
                        href="https://www.thinksolv.com/contact"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: '11.5px', fontWeight: 600, color: COLORS.textSecondary, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.2s' }}
                        onMouseEnter={(e) => e.currentTarget.style.color = COLORS.primary}
                        onMouseLeave={(e) => e.currentTarget.style.color = COLORS.textSecondary}
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                            <polyline points="22,6 12,13 2,6"></polyline>
                        </svg>
                        Contact
                    </a>

                    <span style={{ color: COLORS.text, fontSize: '12px', opacity: 0.4 }}>|</span>

                    {/* Help Docs */}
                    <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); }}
                        style={{ fontSize: '11.5px', fontWeight: 600, color: COLORS.textSecondary, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.2s', cursor: 'pointer' }}
                        onMouseEnter={(e) => e.currentTarget.style.color = COLORS.primary}
                        onMouseLeave={(e) => e.currentTarget.style.color = COLORS.textSecondary}
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                            <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                        Help Docs
                    </a>
                </div>

                {/* Right: Refresh Button */}
                <button
                    onClick={handleRefresh}
                    disabled={loading}
                    className="refresh-btn"
                    style={{
                        width: '26px',
                        height: '26px',
                        padding: 0,
                        background: 'transparent',
                        border: 'none',
                        color: COLORS.textSecondary,
                        cursor: loading ? 'wait' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s',
                        borderRadius: '50%'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = COLORS.border;
                        e.currentTarget.style.color = COLORS.text;
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = COLORS.textSecondary;
                    }}
                    title="Refresh Data"
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ animation: loading ? 'spin 1.5s linear infinite' : 'none' }}>
                        <path d="M23 4v6h-6M1 20v-6h6" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                </button>
            </div>

            {/* HEADER removed for Listing Pages as requested to merge with search bar */}

            {/* SEARCH BAR (Listing Pages) */}
            {
                !loading && isListingPage && (
                    <div style={{ padding: '6px 12px', background: COLORS.surface, borderBottom: `1px solid ${COLORS.borderLight}`, display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                            <input
                                type="text"
                                placeholder="Search by name or ASIN..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && setActiveSearchTerm(searchTerm)}
                                style={{
                                    width: '100%',
                                    padding: '6px 60px 6px 12px',
                                    background: COLORS.background,
                                    border: `1px solid ${COLORS.border}`,
                                    borderRadius: '8px',
                                    fontSize: '12px',
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
                                        position: 'absolute', right: '36px', top: '50%', transform: 'translateY(-50%)',
                                        background: 'none', border: 'none', color: COLORS.textMuted, cursor: 'pointer', padding: '4px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}
                                    title="Clear search"
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            )}
                            <button
                                onClick={() => setActiveSearchTerm(searchTerm)}
                                style={{
                                    position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)',
                                    background: COLORS.primarySoft, border: 'none',
                                    color: COLORS.primary, cursor: 'pointer', padding: '5px',
                                    borderRadius: '6px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    transition: 'all 0.2s'
                                }}
                                title="Search"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                                </svg>
                            </button>
                        </div>

                        <button
                            onClick={handleRefresh}
                            style={{
                                width: '34px', height: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: COLORS.backgroundSecondary, borderRadius: '8px', color: COLORS.textSecondary,
                                border: `1px solid ${COLORS.border}`, cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0
                            }}
                            title="Refresh Data"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: loading ? 'spin 1.5s linear infinite' : 'none' }}>
                                <path d="M23 4v6h-6M1 20v-6h6" />
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                            </svg>
                        </button>
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
                {!isAmazonPage ? renderInvalidPage() : loading ? renderLoading() : !hasContent ? renderEmpty() : (
                    <>
                        {renderActionBar()}
                        {/* Global Download Status Bar (Non-blocking) */}
                        {downloadingAsin && downloadingAsin !== productData?.asin && (
                            <div style={{
                                position: 'absolute',
                                bottom: '16px',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                background: COLORS.surface,
                                border: `1px solid ${COLORS.border}`,
                                padding: '8px 16px',
                                borderRadius: '20px',
                                fontSize: '12px',
                                fontWeight: 500,
                                color: COLORS.text,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                zIndex: 100,
                                boxShadow: COLORS.shadowLg,
                                animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                                pointerEvents: 'none' // Click-through
                            }}>
                                <div style={{ width: '14px', height: '14px', border: `2px solid ${COLORS.primary}`, borderRadius: '50%', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }}></div>
                                <span>Finishing background download...</span>
                            </div>
                        )}
                        <div className="scroll-container" style={{
                            flex: 1,
                            overflowY: 'auto',
                            background: COLORS.background,
                            display: 'flex',
                            flexDirection: 'column',
                            padding: '12px 12px 60px 12px', // Extra bottom padding for floating toast
                            boxSizing: 'border-box'
                        }}>
                            {/* Product Variants List */}
                            {/* Product Variants List with Top Download Action */}
                            {isProductPage && mainTab === 'product' && subTab === 'images' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {renderVariantList()}
                                </div>
                            )}

                            {/* Standard Media Grid (For Review Media or Product Videos) */}
                            {isProductPage && (mainTab === 'review' || subTab === 'videos') && (
                                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
                                    {/* Listing Actions */}
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                                        <div style={{ fontSize: '13px', fontWeight: 600, color: COLORS.text }}>
                                            {filteredListingProducts.length} Products Found
                                        </div>
                                        <button
                                            onClick={downloadAll}
                                            disabled={!!downloadingAsin}
                                            style={{
                                                padding: '6px 14px',
                                                background: COLORS.primary,
                                                color: '#fff',
                                                borderRadius: '8px',
                                                fontSize: '12px',
                                                fontWeight: 700,
                                                border: 'none',
                                                cursor: downloadingAsin ? 'wait' : 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                opacity: downloadingAsin ? 0.7 : 1,
                                                boxShadow: COLORS.shadowPrimary
                                            }}
                                        >
                                            {downloadingAsin ? (
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 1.5s linear infinite' }}>
                                                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                                </svg>
                                            ) : (
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                            )}
                                            <span>Download All</span>
                                        </button>
                                    </div>

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
                .listing-image:hover .listing-hover-overlay { opacity: 1 !important; }
                .listing-product { transition: transform 0.2s ease, box-shadow 0.2s ease; }
                .listing-product:hover { 
                    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05); 
                }
                
                /* Variant cards */
                .variant-option-hover:hover { 
                    box-shadow: ${COLORS.shadowMd} !important;
                    background: ${COLORS.surface} !important;
                    z-index: 5;
                }
                .variant-download-btn:hover { background: ${COLORS.primary} !important; color: #fff !important; transform: scale(1.05); }
                .variant-thumb:hover { transform: scale(1.02); box-shadow: 0 4px 6px rgba(0,0,0,0.05) !important; }
                
                /* Scrollbar styling */
                .variant-scroll::-webkit-scrollbar { height: 4px; }
                .variant-scroll::-webkit-scrollbar-track { background: transparent; }
                .variant-scroll::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 4px; }
                .scroll-container::-webkit-scrollbar { width: 4px; }
                .scroll-container::-webkit-scrollbar-track { background: transparent; }
                .scroll-container::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 4px; }
                
                /* Download button - Shimmer effect only */
                .download-main-btn { position: relative; overflow: hidden; }
                .download-main-btn::after { 
                    content: ''; 
                    position: absolute; 
                    inset: 0; 
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
                    transform: translateX(-100%);
                }
                .download-main-btn:hover:not(:disabled)::after { animation: shimmer 1.5s infinite; }
                .download-main-btn:hover:not(:disabled) { transform: translateY(-1px) !important; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25) !important; }
                .download-main-btn:active:not(:disabled) { transform: translateY(0) scale(0.98) !important; }
                
                /* Checkbox bounce on selection */
                .checkbox-bounce { animation: checkBounce 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
                
                /* Animations */
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                @keyframes fadeInSlide { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes fadeInScale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
                @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
                @keyframes checkBounce { 0% { transform: scale(0.8); } 50% { transform: scale(1.1); } 100% { transform: scale(1.0); } }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
                @keyframes slideDown { from { transform: translateY(-100%); } to { transform: translateY(0); } }
                @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
            `}</style>
        </div >
    );
}

export default PanelApp;
