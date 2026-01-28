/**
 * PIXORA - Premium Amazon Media Downloader
 * Main Panel Application Component
 * Version 2.2.0 - With Preview & Variant Selection
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
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
    shadowSm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    shadowMd: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    shadowLg: '0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.02)',
    shadowPrimary: '0 4px 14px 0 rgba(79, 70, 229, 0.15)',
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
            // Only use videos scraped specifically for this variant
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
    // Per-ASIN cache for variant images - preserves correct images for ALL variants across selections
    const [variantImagesCache, setVariantImagesCache] = useState<Record<string, string[]>>({});
    // Review section is collapsed by default - moved away from top per user request
    const [reviewSectionExpanded, setReviewSectionExpanded] = useState(false);
    // Separate sub-tab state for the review section (images/videos)
    const [reviewSubTab, setReviewSubTab] = useState<'images' | 'videos'>('images');
    // Product Media section toggle - Defaults to FALSE (Hidden) as requested ("temporarily hide")
    const [productMediaExpanded, setProductMediaExpanded] = useState(false); // Default hidden


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
                        setVariantImagesCache({}); // Clear cached images for new product

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
                                // Enforce images
                                let imgsToEnforce = variantImagesCache[asin] || variantImages;
                                if (enrichedData && imgsToEnforce && imgsToEnforce.length > 0) {
                                    if (enrichedData.variants) {
                                        enrichedData.variants = enrichedData.variants.map(v =>
                                            v.asin === asin ? { ...v, images: imgsToEnforce, image: imgsToEnforce![0] || v.image } : v
                                        );
                                    }
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

        setDownloading(true);
        setDownloadSuccess(false);

        let finalData: ProductData | null = productData;

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
                    setProductData(finalData);
                }
            } catch (e) { }
        }

        let items: (string | { url: string; filename: string })[] = [];
        let categoryLabel = `${mainTab}-${subTab}`;

        const shouldGroupVariants = isProductPage && mainTab === 'product' && subTab === 'images' && finalData?.variants;

        if (shouldGroupVariants && finalData) {
            finalData.variants!.forEach(variant => {
                const vImages = variant.images || [];
                const vVideos = variant.videos || [];
                if (vImages.length === 0 && vVideos.length === 0) return;

                const safeName = variant.name.replace(/[^a-zA-Z0-9_-]/g, '_');
                vImages.forEach((url, i) => {
                    let ext = url.includes('.png') ? 'png' : url.includes('.webp') ? 'webp' : 'jpg';
                    items.push({ url, filename: `Variant_${safeName}/images/image_${i + 1}.${ext}` });
                });
                vVideos.forEach((url, i) => {
                    let ext = url.includes('.webm') ? 'webm' : url.includes('.m3u8') ? 'm3u8' : 'mp4';
                    items.push({ url, filename: `Variant_${safeName}/videos/video_${i + 1}.${ext}` });
                });
            });
        } else if (mainTab === 'review') {
            const targetType = subTab === 'images' ? 'image' : 'video';
            allMediaItems.filter(i => i.source === 'review' && i.type === targetType).forEach((item, i) => {
                let ext = targetType === 'video' ? 'mp4' : 'jpg';
                items.push({ url: item.url, filename: `Reviews/${subTab}/${item.type}_${i + 1}.${ext}` });
            });
        } else {
            items = isProductPage ? filteredMediaItems.map(i => i.url) : filteredListingProducts.map(p => p.image);
        }

        if (items.length === 0) { setDownloading(false); return; }

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
        setVariantImagesCache({}); // Clear cached images on refresh
        setVariantDropdownOpen(false);
        setSelectingVariant(false);
        setVariantStartIndex(0);

        // Reload data
        loadData();
    };

    // ============================================
    // render functions
    // ============================================

    // Media Item
    const renderMediaItem = (item: MediaItem, index: number) => {
        const isSelected = selectedItems.has(item.url);
        const isVideo = item.type === 'video';

        return (
            <div
                key={`${item.url}-${index}`}
                onClick={() => handlePreview(item)}
                style={{
                    position: 'relative',
                    aspectRatio: '1',
                    borderRadius: '16px',
                    overflow: 'hidden',
                    background: COLORS.backgroundSecondary,
                    cursor: 'pointer',
                    border: `2px solid ${isSelected ? COLORS.primary : 'transparent'}`,
                    boxShadow: isSelected ? COLORS.shadowPrimary : COLORS.shadowSm,
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxSizing: 'border-box'
                }}
                className="media-item"
            >
                {isVideo ? (
                    <video src={item.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
                ) : (
                    <img src={item.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                )}

                {/* Badges */}
                <div style={{ position: 'absolute', top: '8px', left: '8px', display: 'flex', gap: '4px', pointerEvents: 'none' }}>
                    {isVideo && (
                        <span style={{
                            background: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                            color: '#fff', fontSize: '9px', fontWeight: 800, padding: '3px 8px', borderRadius: '6px'
                        }}>VIDEO</span>
                    )}
                </div>

                {/* Selection Checkbox */}
                <div
                    onClick={(e) => toggleSelection(item.url, e)}
                    style={{
                        position: 'absolute', top: '8px', right: '8px', width: '24px', height: '24px',
                        borderRadius: '50%', background: isSelected ? COLORS.primary : 'rgba(255,255,255,0.8)',
                        backdropFilter: 'blur(4px)', border: isSelected ? 'none' : `1.5px solid rgba(0,0,0,0.1)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: isSelected ? COLORS.shadowMd : COLORS.shadowSm, transition: 'all 0.2s',
                        zIndex: 10
                    }}
                >
                    {isSelected && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    )}
                </div>

                {/* Hover Overlay */}
                <div
                    className="media-hover-overlay"
                    style={{
                        position: 'absolute', inset: 0,
                        background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.2) 50%, transparent 100%)',
                        opacity: 0, transition: 'opacity 0.2s ease', display: 'flex',
                        flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end',
                        padding: '12px', gap: '8px'
                    }}
                >
                    <button
                        onClick={(e) => { e.stopPropagation(); downloadSingle(item.url); }}
                        style={{
                            padding: '6px 12px', background: '#fff', borderRadius: '8px',
                            fontSize: '11px', fontWeight: 700, color: COLORS.text, border: 'none',
                            boxShadow: COLORS.shadowMd, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                        }}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
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
                key={`${product.asin}-${index}`}
                style={{
                    background: COLORS.surface,
                    borderRadius: '20px',
                    overflow: 'hidden',
                    boxShadow: COLORS.shadowSm,
                    border: `2px solid ${isSelected ? COLORS.primary : 'transparent'}`,
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    display: 'flex',
                    flexDirection: 'column',
                    boxSizing: 'border-box'
                }}
                className="listing-product"
            >
                <div
                    onClick={() => handlePreview({ url: product.image, type: 'image', source: 'product', category: 'productImage' })}
                    style={{
                        aspectRatio: '1',
                        position: 'relative',
                        background: COLORS.backgroundSecondary,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden'
                    }}
                >
                    <img src={product.image} style={{ width: '85%', height: '85%', objectFit: 'contain', transition: 'transform 0.3s' }} className="listing-img" loading="lazy" />

                    <div
                        onClick={(e) => toggleSelection(product.image, e)}
                        style={{
                            position: 'absolute', top: '12px', right: '12px', width: '28px', height: '28px',
                            borderRadius: '50%', background: isSelected ? COLORS.primary : 'rgba(255,255,255,0.9)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: COLORS.shadowSm, zIndex: 5, transition: 'all 0.2s'
                        }}
                    >
                        {isSelected && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5"><polyline points="20 6 9 17 4 12" /></svg>}
                    </div>
                </div>

                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                    <h4 style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        color: COLORS.text,
                        margin: 0,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        height: '36px',
                        lineHeight: '1.4'
                    }}>
                        {product.title}
                    </h4>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: '4px' }}>
                        <span style={{
                            fontSize: '10px',
                            fontWeight: 800,
                            color: COLORS.textMuted,
                            background: COLORS.backgroundSecondary,
                            padding: '3px 10px',
                            borderRadius: '20px',
                            letterSpacing: '0.3px'
                        }}>{product.asin}</span>

                        <button
                            onClick={(e) => { e.stopPropagation(); downloadSingle(product.image); }}
                            style={{
                                width: '32px',
                                height: '32px',
                                background: COLORS.primarySoft,
                                borderRadius: '10px',
                                border: 'none',
                                color: COLORS.primary,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.2s'
                            }}
                            className="listing-save-btn"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                        </button>
                    </div>
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

    const renderCategoryTabs = () => {
        const productTotal = categoryCounts.productImages + categoryCounts.productVideos;
        const reviewTotal = categoryCounts.reviewImages + categoryCounts.reviewVideos;

        return (
            <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, paddingBottom: '4px' }}>
                {/* Main Tabs */}
                <div style={{ display: 'flex', background: COLORS.surface, padding: '0 16px', borderBottom: `1px solid ${COLORS.borderLight}` }}>
                    {[
                        { key: 'product' as MainTab, label: 'Product Data', count: productTotal },
                        { key: 'review' as MainTab, label: 'Review Media', count: reviewTotal },
                    ].map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => { setMainTab(tab.key); setSubTab('images'); }}
                            style={{
                                flex: 1, padding: '12px 4px', border: 'none',
                                borderBottom: mainTab === tab.key ? `2.5px solid ${COLORS.primary}` : '2.5px solid transparent',
                                background: 'transparent', color: mainTab === tab.key ? COLORS.primary : COLORS.textSecondary,
                                fontSize: '13px', fontWeight: mainTab === tab.key ? 700 : 500,
                                cursor: 'pointer', transition: 'all 0.2s ease', marginBottom: '-1px'
                            }}
                        >
                            {tab.label}
                            <span style={{
                                marginLeft: '6px', background: mainTab === tab.key ? COLORS.primarySoft : COLORS.backgroundSecondary,
                                color: mainTab === tab.key ? COLORS.primary : COLORS.textMuted,
                                padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600
                            }}>{tab.count}</span>
                        </button>
                    ))}
                </div>

                {/* Sub Tabs */}
                <div style={{ display: 'flex', gap: '8px', padding: '12px 16px 8px 16px' }}>
                    {[
                        { key: 'images' as SubTab, label: 'Images', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
                        { key: 'videos' as SubTab, label: 'Videos', icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
                    ].map(sub => {
                        const count = mainTab === 'product' ? (sub.key === 'images' ? categoryCounts.productImages : categoryCounts.productVideos) : (sub.key === 'images' ? categoryCounts.reviewImages : categoryCounts.reviewVideos);
                        return (
                            <button
                                key={sub.key}
                                onClick={() => setSubTab(sub.key)}
                                style={{
                                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                                    padding: '8px 12px', borderRadius: '10px',
                                    border: `1.5px solid ${subTab === sub.key ? COLORS.primary : COLORS.border}`,
                                    background: subTab === sub.key ? COLORS.primarySoft : COLORS.surface,
                                    color: subTab === sub.key ? COLORS.primary : COLORS.textSecondary,
                                    fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s ease'
                                }}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d={sub.icon} /></svg>
                                {sub.label}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    };

    // Variant List (Grouped Cards)
    // Review Media Quick Bar - Fixed at the top for easy access
    const renderReviewQuickBar = () => {
        const reviewCount = categoryCounts.reviewImages + categoryCounts.reviewVideos;
        if (!isProductPage || reviewCount === 0) return null;

        return (
            <div style={{
                padding: '10px 16px',
                background: COLORS.surface,
                borderTop: `1px solid ${COLORS.borderLight}`,
                boxShadow: '0 -4px 16px -2px rgba(0, 0, 0, 0.08)',
                backdropFilter: 'blur(10px)',
                transition: 'all 0.3s ease-in-out',
                flexShrink: 0,
                zIndex: 50
            }}>
                <div
                    onClick={() => setReviewSectionExpanded(!reviewSectionExpanded)}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: reviewSectionExpanded ? COLORS.primarySoft : COLORS.background,
                        border: `1.2px solid ${reviewSectionExpanded ? COLORS.primary : COLORS.border}`,
                        borderRadius: '10px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={COLORS.primary} strokeWidth="2.5">
                            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                        </svg>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.text }}>Review Media</span>
                        <span style={{
                            fontSize: '10px', fontWeight: 800,
                            color: COLORS.primary,
                            background: COLORS.primarySoft,
                            padding: '1px 6px',
                            borderRadius: '6px'
                        }}>{reviewCount}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const reviewItems = allMediaItems.filter(item => item.source === 'review').map(item => item.url);
                                if (reviewItems.length > 0) {
                                    const filename = `pixora-${productData?.asin || 'item'}-reviews-${Date.now()}`;
                                    downloadZip(reviewItems, filename);
                                }
                            }}
                            style={{
                                padding: '3px 8px', background: COLORS.primary, border: 'none',
                                borderRadius: '5px', fontSize: '10px', fontWeight: 600,
                                color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px'
                            }}
                        >
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            Save All
                        </button>
                        <svg
                            width="14" height="14" viewBox="0 0 24 24" fill="none"
                            stroke={COLORS.textMuted} strokeWidth="2.5"
                            style={{
                                transform: reviewSectionExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                transition: 'transform 0.2s ease'
                            }}
                        >
                            <polyline points="6 9 12 15 18 9" />
                        </svg>
                    </div>
                </div>

                {reviewSectionExpanded && (
                    <div style={{
                        marginTop: '8px', padding: '10px', background: COLORS.backgroundSecondary,
                        borderRadius: '8px', border: `1px solid ${COLORS.borderLight}`
                    }}>
                        <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                            {['images', 'videos'].map((type) => (
                                <button
                                    key={type}
                                    onClick={() => setReviewSubTab(type as 'images' | 'videos')}
                                    style={{
                                        flex: 1, padding: '5px', borderRadius: '5px', border: 'none',
                                        background: reviewSubTab === type ? COLORS.primarySoft : COLORS.surface,
                                        color: reviewSubTab === type ? COLORS.primary : COLORS.textSecondary,
                                        fontSize: '10px', fontWeight: 600, cursor: 'pointer'
                                    }}
                                >
                                    {type.toUpperCase()}
                                </button>
                            ))}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                            {allMediaItems
                                .filter(item => item.source === 'review' && item.type === (reviewSubTab === 'images' ? 'image' : 'video'))
                                .slice(0, 8)
                                .map((item, index) => renderMediaItem(item, index))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // Variant List - CONTENT GRID ONLY
    const renderVariantList = () => {
        const baseVariants = productData?.variants || [];
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
                gap: '16px',
                width: '100%',
                boxSizing: 'border-box'
            }}>
                {allVariants.map((variant) => {
                    const isCurrent = selectedVariantAsin === variant.asin;
                    const imageCount = variant.images?.length || 0;
                    const videoCount = variant.videos?.length || 0;
                    const totalCount = imageCount + videoCount;

                    return (
                        <div
                            key={variant.asin}
                            onClick={() => !selectingVariant && handleVariantSelect(variant.asin, variant.name, variant.images, variant.videos)}
                            className="variant-card"
                            style={{
                                background: COLORS.surface,
                                borderRadius: '12px',
                                border: isCurrent ? `1.5px solid ${COLORS.primary}` : `1px solid ${COLORS.border}`,
                                padding: '12px',
                                cursor: selectingVariant ? 'wait' : 'pointer',
                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                boxShadow: isCurrent ? COLORS.shadowPrimary : '0 1px 3px rgba(0,0,0,0.05)',
                                position: 'relative',
                                overflow: 'hidden',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px',
                                boxSizing: 'border-box'
                            }}
                        >
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <div style={{
                                    width: '80px', height: '80px', borderRadius: '10px',
                                    background: `url(${variant.image}) center/contain no-repeat`,
                                    backgroundColor: COLORS.backgroundSecondary, flexShrink: 0,
                                    border: `1px solid ${COLORS.borderLight}`
                                }} />

                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <h4 style={{
                                                fontSize: '13px', fontWeight: 700, color: '#1a202c',
                                                margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                lineHeight: '1.4'
                                            }}>{variant.name}</h4>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '1px' }}>
                                                <span style={{
                                                    fontSize: '10px',
                                                    color: '#64748b',
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
                                                fontWeight: 900,
                                                padding: '3px 10px',
                                                borderRadius: '30px',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.5px',
                                                boxShadow: '0 4px 8px rgba(79, 70, 229, 0.25)'
                                            }}>Active</div>
                                        )}
                                    </div>

                                    <div style={{ display: 'flex', gap: '5px', marginTop: '8px', overflowX: 'auto', paddingBottom: '2px' }} className="no-scrollbar">
                                        {(() => {
                                            const allItems = [
                                                ...(variant.images || []).map(i => ({ type: 'image', url: i })),
                                                ...(variant.videos || []).map(v => ({ type: 'video', url: v }))
                                            ];
                                            const visibleItems = allItems.slice(0, 5);
                                            const remainingCount = allItems.length - 5;

                                            return (
                                                <>
                                                    {visibleItems.map((item, i) => (
                                                        <div
                                                            key={i}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (showPreview) {
                                                                    const contextUrls = allItems.map(m => m.url);
                                                                    showPreview(item.url, item.type as 'image' | 'video', contextUrls);
                                                                }
                                                            }}
                                                            style={{
                                                                width: '32px',
                                                                height: '32px',
                                                                borderRadius: '6px',
                                                                overflow: 'hidden',
                                                                position: 'relative',
                                                                backgroundColor: COLORS.backgroundSecondary,
                                                                border: `1px solid ${COLORS.borderLight}`,
                                                                flexShrink: 0,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                cursor: 'zoom-in'
                                                            }}>
                                                            {item.type === 'video' ? (
                                                                <>
                                                                    <video src={item.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                                    <div style={{
                                                                        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)',
                                                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                                    }}>
                                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2">
                                                                            <polygon points="5 3 19 12 5 21 5 3" />
                                                                        </svg>
                                                                    </div>
                                                                </>
                                                            ) : (
                                                                <img src={item.url} style={{ width: '100%', height: '100%', objectFit: 'contain' }} loading="lazy" />
                                                            )}
                                                        </div>
                                                    ))}
                                                    {remainingCount > 0 && (
                                                        <div
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (showPreview) {
                                                                    // Show preview starting from the 6th item
                                                                    const contextUrls = allItems.map(m => m.url);
                                                                    showPreview(allItems[5].url, allItems[5].type as 'image' | 'video', contextUrls);
                                                                }
                                                            }}
                                                            style={{
                                                                width: '32px',
                                                                height: '32px',
                                                                borderRadius: '6px',
                                                                backgroundColor: COLORS.surface,
                                                                border: `1px solid ${COLORS.borderLight}`,
                                                                flexShrink: 0,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                cursor: 'pointer',
                                                                fontSize: '10px',
                                                                fontWeight: 700,
                                                                color: COLORS.primary,
                                                                background: COLORS.primarySoft
                                                            }}
                                                        >
                                                            +{remainingCount}
                                                        </div>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </div>
                                </div>
                            </div>

                            <div style={{ marginTop: '0px', paddingTop: '8px', borderTop: `1px solid ${COLORS.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <div style={{ background: COLORS.backgroundSecondary, padding: '3px 10px', borderRadius: '6px' }}>
                                        <span style={{ fontSize: '10px', fontWeight: 700, color: COLORS.textSecondary, letterSpacing: '0.2px' }}>{imageCount} IMG</span>
                                    </div>
                                    {videoCount > 0 && (
                                        <div style={{ background: COLORS.backgroundSecondary, padding: '3px 10px', borderRadius: '6px' }}>
                                            <span style={{ fontSize: '10px', fontWeight: 700, color: COLORS.textSecondary, letterSpacing: '0.2px' }}>{videoCount} VID</span>
                                        </div>
                                    )}
                                </div>

                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const allMedia = [...(variant.images || []), ...(variant.videos || [])];
                                        if (allMedia.length > 0) downloadZip(allMedia, `pixora-${variant.asin}`);
                                    }}
                                    disabled={selectingVariant}
                                    className="variant-download-btn"
                                    style={{
                                        padding: '6px 14px',
                                        borderRadius: '8px',
                                        background: COLORS.surface,
                                        border: `1px solid ${COLORS.border}`,
                                        color: COLORS.text,
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px'
                                    }}
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                    Download
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
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
            {/* HEADER */}
            <header style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px', background: COLORS.surface,
                borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0,
                position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 2px 10px rgba(0,0,0,0.02)'
            }}>


                {isProductPage && allVariants.length > 0 && (
                    <button
                        onClick={() => {
                            // Download ALL variants with folder structure + Consolidated Folders
                            console.log('Download All Clicked');
                            const downloadItems: { url: string; filename: string }[] = [];

                            allVariants.forEach(v => {
                                // 1. Sanitize variant Name for folder usage
                                const safeName = (v.name || v.asin).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
                                const folderName = `Variant_${safeName}`;

                                // 2. Add Images
                                if (v.images && v.images.length > 0) {
                                    v.images.forEach((url, idx) => {
                                        // Extract extension carefully
                                        let ext = 'jpg';
                                        try {
                                            const urlObj = new URL(url);
                                            const parts = urlObj.pathname.split('.');
                                            if (parts.length > 1) ext = parts[parts.length - 1];
                                        } catch (e) { /* fallback */ }

                                        // A. Structured Variant Folder
                                        downloadItems.push({
                                            url,
                                            filename: `${folderName}/images/${idx + 1}.${ext}`
                                        });

                                        // B. Global Consolidated Folder (Accumulate ALL images here)
                                        downloadItems.push({
                                            url,
                                            filename: `images/${safeName}_${idx + 1}.${ext}`
                                        });
                                    });
                                }

                                // 3. Add Videos
                                if (v.videos && v.videos.length > 0) {
                                    v.videos.forEach((url, idx) => {
                                        let ext = 'mp4';
                                        try {
                                            const urlObj = new URL(url);
                                            const parts = urlObj.pathname.split('.');
                                            if (parts.length > 1) ext = parts[parts.length - 1];
                                        } catch (e) { /* fallback */ }

                                        // A. Structured Variant Folder
                                        downloadItems.push({
                                            url,
                                            filename: `${folderName}/videos/${idx + 1}.${ext}`
                                        });

                                        // B. Global Consolidated Folder
                                        downloadItems.push({
                                            url,
                                            filename: `videos/${safeName}_${idx + 1}.${ext}`
                                        });
                                    });
                                }
                            });

                            console.log(`Preparing download for ${downloadItems.length / 2} unique items (duplicated for structure)`);

                            if (downloadItems.length > 0) {
                                downloadZip(downloadItems, `pixora-all-variants-${Date.now()}`);
                            } else {
                                console.warn('No items found for download all variants');
                            }
                        }}
                        style={{
                            padding: '6px 12px',
                            background: COLORS.primarySoft,
                            color: COLORS.primary,
                            borderRadius: '8px',
                            fontSize: '11px',
                            fontWeight: 700,
                            border: 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            transition: 'all 0.2s'
                        }}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                        Download All ({allVariants.length})
                    </button>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        onClick={handleRefresh}
                        style={{
                            width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: COLORS.backgroundSecondary, borderRadius: '10px', color: COLORS.textSecondary,
                            border: 'none', cursor: 'pointer', transition: 'all 0.2s'
                        }}
                        title="Refresh Data"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: loading ? 'spin 1.5s linear infinite' : 'none' }}>
                            <path d="M23 4v6h-6M1 20v-6h6" />
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                    </button>
                </div>
            </header>

            {/* SEARCH BAR (Listing Pages) */}
            {!loading && isListingPage && (
                <div style={{ padding: '10px 12px', background: COLORS.surface, borderBottom: `1px solid ${COLORS.borderLight}` }}>
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

            {/* HEADER ACTION BAR - Product Page (Product Media Section) */}
            {!loading && hasContent && isProductPage && SHOW_PRODUCT_MEDIA_SECTION && (
                <div style={{
                    padding: '12px 16px',
                    background: COLORS.surface,
                    borderBottom: `1px solid ${COLORS.borderLight}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexShrink: 0,
                    zIndex: 30,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                }}>
                    {/* Left: Title Section - Clickable to Toggle */}
                    <div
                        onClick={() => setProductMediaExpanded(!productMediaExpanded)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            minWidth: 'fit-content',
                            cursor: 'pointer',
                            userSelect: 'none',
                            opacity: productMediaExpanded ? 1 : 0.8,
                            padding: '4px',
                            borderRadius: '6px',
                            transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = COLORS.backgroundSecondary; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                        {/* Chevron */}
                        <svg
                            width="16" height="16" viewBox="0 0 24 24" fill="none"
                            stroke={COLORS.textSecondary} strokeWidth="2.5"
                            style={{
                                transform: productMediaExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                transition: 'transform 0.2s ease'
                            }}
                        >
                            <polyline points="6 9 12 15 18 9" />
                        </svg>

                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={COLORS.primary} strokeWidth="2.5">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <polyline points="21 15 16 10 5 21" />
                        </svg>
                        <span style={{
                            fontSize: '14px',
                            fontWeight: 700,
                            color: COLORS.text,
                            letterSpacing: '-0.2px',
                            whiteSpace: 'nowrap'
                        }}>
                            Product Media
                        </span>
                    </div>

                    {/* Right: Controls (Filters + Action) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {/* Filter Pills (Small) */}
                        <div style={{
                            display: 'flex',
                            gap: '4px',
                            background: COLORS.background,
                            padding: '3px',
                            borderRadius: '8px',
                        }}>
                            <button
                                onClick={() => setSubTab('images')}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '4px',
                                    padding: '4px 8px', borderRadius: '6px',
                                    border: 'none',
                                    background: subTab === 'images' ? COLORS.surface : 'transparent',
                                    color: subTab === 'images' ? COLORS.primary : COLORS.textSecondary,
                                    fontSize: '11px', fontWeight: 600,
                                    cursor: 'pointer',
                                    boxShadow: subTab === 'images' ? COLORS.shadowSm : 'none',
                                    transition: 'all 0.2s ease'
                                }}
                                title="Images"
                            >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                    <circle cx="8.5" cy="8.5" r="1.5" />
                                    <polyline points="21 15 16 10 5 21" />
                                </svg>
                                {categoryCounts['productImages']}
                            </button>
                            <button
                                onClick={() => setSubTab('videos')}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '4px',
                                    padding: '4px 8px', borderRadius: '6px',
                                    border: 'none',
                                    background: subTab === 'videos' ? COLORS.surface : 'transparent',
                                    color: subTab === 'videos' ? COLORS.primary : COLORS.textSecondary,
                                    fontSize: '11px', fontWeight: 600,
                                    cursor: 'pointer',
                                    boxShadow: subTab === 'videos' ? COLORS.shadowSm : 'none',
                                    transition: 'all 0.2s ease'
                                }}
                                title="Videos"
                            >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <polygon points="5 3 19 12 5 21 5 3" />
                                </svg>
                                {categoryCounts['productVideos']}
                            </button>
                        </div>

                        {/* Download Action - Icon Only for compactness or Small Text? User said 'same space'. Icon button is safer for space. */}
                        {/* Let's keep Text but smaller padding if space is tight. OR Icon only. */}
                        {/* Screenshot showed broad width. I will try Compact Text Button. */}
                        <button
                            onClick={downloadAll}
                            disabled={downloading}
                            style={{
                                padding: '5px 10px',
                                background: downloading ? COLORS.textMuted : COLORS.primary,
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '11px',
                                fontWeight: 600,
                                color: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                flexShrink: 0,
                                cursor: downloading ? 'not-allowed' : 'pointer',
                                transition: 'all 0.2s ease',
                                boxShadow: downloading ? 'none' : '0 1px 3px rgba(0,0,0,0.1)'
                            }}
                        >
                            {downloading ? (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }}>
                                    <path d="M23 4v6h-6M1 20v-6h6" />
                                </svg>
                            ) : (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                            )}
                            {downloading ? 'Wait' : 'Download'}
                        </button>
                    </div>
                </div>
            )}

            {/* HEADER ACTION BAR - Listing Page (Simple Download) */}
            {!loading && hasContent && isListingPage && (
                <div style={{
                    padding: '12px 14px',
                    background: COLORS.surface,
                    borderBottom: `1px solid ${COLORS.borderLight}`,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: COLORS.textSecondary }}>
                        {/* Simple count for listing */}
                        {filteredListingProducts.length} Products Found
                    </div>

                    <button
                        onClick={downloadAll}
                        disabled={downloading}
                        style={{
                            padding: '8px 16px',
                            background: COLORS.primary,
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '13px',
                            fontWeight: 700,
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            boxShadow: COLORS.shadowPrimary,
                            cursor: downloading ? 'not-allowed' : 'pointer',
                        }}
                    >
                        {downloading ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }}>
                                <path d="M23 4v6h-6M1 20v-6h6" />
                            </svg>
                        ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                        )}
                        DOWNLOAD ALL
                    </button>
                </div>
            )}

            {/* CONTENT - Reorganized based on two-level navigation */}
            <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {loading ? renderLoading() : !hasContent ? renderEmpty() : (
                    <>
                        {/* Persistent Variants Header (Only for Product Images Tab) */}
                        {isProductPage && mainTab === 'product' && subTab === 'images' && allVariants.length > 0 && (
                            <div style={{
                                padding: '12px 16px',
                                background: COLORS.surface,
                                borderBottom: `1px solid ${COLORS.borderLight}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                flexShrink: 0,
                                zIndex: 40,
                                boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                            }}>
                                <h3 style={{ fontSize: '14px', fontWeight: 800, color: COLORS.text, margin: 0 }}>Available Variants</h3>
                                <span style={{ fontSize: '11px', color: COLORS.textMuted, fontWeight: 700 }}>{allVariants.length} TOTAL</span>
                            </div>
                        )}

                        <div className="scroll-container" style={{
                            flex: 1,
                            overflowY: 'auto',
                            background: COLORS.background,
                            display: 'flex',
                            flexDirection: 'column',
                            padding: '16px',
                            boxSizing: 'border-box'
                        }}>
                            {/* Product Variants List */}
                            {isProductPage && mainTab === 'product' && subTab === 'images' && renderVariantList()}

                            {/* Standard Media Grid (For other tabs) */}
                            {!(isProductPage && mainTab === 'product' && subTab === 'images') && !isListingPage && (
                                <div style={{ width: '100%' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                                        {displayedItems.map((item, index) => renderMediaItem(item, index))}
                                    </div>

                                    {hasMoreItems && !showAllItems && (
                                        <button
                                            onClick={() => setShowAllItems(true)}
                                            style={{
                                                width: '100%', marginTop: '16px', padding: '10px',
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
                                <div style={{ width: '100%' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                                        {filteredListingProducts.map((product, index) => renderListingProduct(product, index))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {renderReviewQuickBar()}
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
                    transform: translateY(-2px); 
                    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.02) !important;
                    z-index: 5;
                }
                
                /* Listing products */
                .listing-image:hover .listing-hover-overlay { opacity: 1 !important; }
                .listing-product { transition: transform 0.2s ease, box-shadow 0.2s ease; }
                .listing-product:hover { transform: translateY(-2px); box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05); }
                
                /* Variant cards */
                .variant-option-hover:hover { 
                    transform: translateY(-2px) !important;
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
            `}</style>
        </div >
    );
}

export default PanelApp;