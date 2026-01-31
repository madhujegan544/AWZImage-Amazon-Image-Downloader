
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
};

// ============================================
// Utility Functions
// ============================================
const truncateText = (text: string, maxLength: number): string => {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
};

const getImageId = (url: string): string => {
    try {
        let decoded = url;
        try { decoded = decodeURIComponent(url); } catch { /* ignore */ }
        const cleaned = decoded.split('?')[0];
        const match = cleaned.match(/images\/I\/([A-Za-z0-9]+)/);
        if (match) return match[1];
        const filenameMatch = cleaned.match(/\/([A-Za-z0-9]{8,})/);
        if (filenameMatch) return filenameMatch[1];
        return cleaned;
    } catch { return url; }
};

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

const resolveVariantImages = (variant: { asin: string, name: string }, data: ProductData): string[] => {
    let images: string[] = [];
    if (data.variantImagesByAsin?.[variant.asin]) {
        images = data.variantImagesByAsin[variant.asin];
    } else if (data.variantImages?.[variant.name]) {
        images = data.variantImages[variant.name];
    } else if (data.variantImages) {
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

const getMediaItems = (data: ProductData | null, overrideAsin?: string | null): MediaItem[] => {
    if (!data) return [];
    const items: MediaItem[] = [];
    const seenIds = new Set<string>();

    const addItem = (url: string, type: 'image' | 'video', source: 'product' | 'review', category: MediaItem['category']) => {
        const id = type === 'image' ? getImageId(url) : url.split('?')[0];
        if (!seenIds.has(id)) {
            seenIds.add(id);
            items.push({ url, type, source, category });
        }
    };

    let displayImages: string[] = [];
    let selectedVariant = overrideAsin
        ? data.variants?.find(v => v.asin === overrideAsin)
        : data.variants?.find(v => v.selected);

    if (!selectedVariant) selectedVariant = data.variants?.find(v => v.selected);
    const hasVariants = data.variants && data.variants.length > 0;

    if (selectedVariant) {
        if (selectedVariant.images && selectedVariant.images.length > 0) {
            displayImages = selectedVariant.images;
        } else if (selectedVariant.asin && data.variantImagesByAsin && data.variantImagesByAsin[selectedVariant.asin]) {
            displayImages = data.variantImagesByAsin[selectedVariant.asin];
        } else if (data.variantImages) {
            const cleanName = selectedVariant.name?.replace(/^Select\s+/, '').trim();
            const matchingKey = Object.keys(data.variantImages).find(k =>
                k === selectedVariant.name || k === cleanName ||
                k.toLowerCase().includes(cleanName?.toLowerCase() || '') ||
                cleanName?.toLowerCase().includes(k.toLowerCase())
            );
            if (matchingKey) displayImages = data.variantImages[matchingKey];
        }
    }

    if (displayImages.length === 0) {
        if (!hasVariants) {
            displayImages = data.productImages || [];
        } else if (selectedVariant?.image) {
            displayImages = [selectedVariant.image];
        }
    }

    dedupeUrls(displayImages).forEach(url => addItem(url, 'image', 'product', 'productImage'));

    let displayVideos = data.productVideos || data.videos || [];
    if (selectedVariant && selectedVariant.videos && selectedVariant.videos.length > 0) {
        displayVideos = selectedVariant.videos;
    }
    displayVideos.forEach(url => addItem(url, 'video', 'product', 'productVideo'));
    (data.reviewImages || []).forEach(url => addItem(url, 'image', 'review', 'reviewImage'));
    (data.reviewVideos || []).forEach(url => addItem(url, 'video', 'review', 'reviewVideo'));

    return items;
};

// ============================================
// Main Component
// ============================================
function PanelApp({ scrapeProductData, downloadZip, showPreview, selectVariant }: PanelAppProps) {
    const [view, setView] = useState<ViewState>('main');
    const [productData, setProductData] = useState<ProductData | null>(null);
    const [loading, setLoading] = useState(true);
    const [downloading, setDownloading] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [searchTerm, setSearchTerm] = useState('');
    const [activeSearchTerm, setActiveSearchTerm] = useState('');
    const [mainTab, setMainTab] = useState<MainTab>('product');
    const [subTab, setSubTab] = useState<SubTab>('images');
    const [selectingVariant, setSelectingVariant] = useState(false);
    const [selectedVariantAsin, setSelectedVariantAsin] = useState<string | null>(null);
    const [variantImagesCache, setVariantImagesCache] = useState<Record<string, string[]>>({});
    const [variantVideosCache, setVariantVideosCache] = useState<Record<string, string[]>>({});
    const [reviewSectionExpanded, setReviewSectionExpanded] = useState(false);
    const [reviewSubTab, setReviewSubTab] = useState<'images' | 'videos'>('images');
    const [persistentReviews, setPersistentReviews] = useState<MediaItem[]>([]);

    const allMediaItems = useMemo(() => {
        const cachedImages = selectedVariantAsin ? variantImagesCache[selectedVariantAsin] : null;
        const cachedVideos = selectedVariantAsin ? variantVideosCache[selectedVariantAsin] : null;

        if (selectedVariantAsin && ((cachedImages && cachedImages.length > 0) || (cachedVideos && cachedVideos.length > 0)) && productData) {
            const modifiedData = {
                ...productData,
                variants: productData.variants?.map(v =>
                    v.asin === selectedVariantAsin
                        ? {
                            ...v,
                            images: (cachedImages && cachedImages.length > 0 ? cachedImages : v.images),
                            videos: (cachedVideos && cachedVideos.length > 0 ? cachedVideos : v.videos),
                            selected: true
                        }
                        : { ...v, selected: false }
                )
            };
            return getMediaItems(modifiedData, selectedVariantAsin);
        }
        return getMediaItems(productData, selectedVariantAsin);
    }, [productData, selectedVariantAsin, variantImagesCache, variantVideosCache]);

    const isProductPage = productData?.pageType === 'product';
    const isListingPage = productData?.pageType === 'listing';

    // Create baseVariants for list rendering
    const allVariants = useMemo(() => {
        let baseVariants = productData?.variants || [];
        if (baseVariants.length === 0 && productData) {
            baseVariants = [{
                asin: productData.asin,
                name: productData.title,
                image: productData.productImages?.[0] || '',
                available: true,
                selected: true,
                images: productData.productImages || [],
                videos: productData.videos || []
            }];
        }
        return baseVariants.map(v => {
            const cachedImages = variantImagesCache[v.asin];
            const cachedVideos = variantVideosCache[v.asin];

            let updated = { ...v };

            if (cachedImages && cachedImages.length > 0) {
                updated.images = cachedImages;
                updated.image = cachedImages[0] || v.image;
            }

            if (cachedVideos && cachedVideos.length > 0) {
                updated.videos = cachedVideos;
            }

            return updated;
        });
    }, [productData, variantImagesCache, variantVideosCache]);

    const filteredMediaItems = useMemo(() => {
        if (isListingPage) return allMediaItems;
        if (mainTab === 'product') {
            return subTab === 'images' ?
                allMediaItems.filter(i => i.category === 'productImage') :
                allMediaItems.filter(i => i.category === 'productVideo');
        } else if (mainTab === 'review') {
            return subTab === 'images' ?
                allMediaItems.filter(i => i.category === 'reviewImage') :
                allMediaItems.filter(i => i.category === 'reviewVideo');
        }
        return allMediaItems;
    }, [allMediaItems, mainTab, subTab, isListingPage]);

    // Data Scraping Effect
    useEffect(() => {
        let isMounted = true;

        const load = async () => {
            setLoading(true);
            try {
                const data = await scrapeProductData(true);
                if (isMounted && data) {
                    setProductData(data);

                    // Initialize cache
                    const initialCache: Record<string, string[]> = {};
                    if (data.variantImagesByAsin) Object.assign(initialCache, data.variantImagesByAsin);

                    data.variants?.forEach(v => {
                        const imgs = resolveVariantImages(v, data);
                        if (imgs.length > 0) initialCache[v.asin] = imgs;
                    });
                    setVariantImagesCache(prev => ({ ...prev, ...initialCache }));

                    // Populate persistent reviews
                    if (data.reviewImages?.length || data.reviewVideos?.length) {
                        const reviews: MediaItem[] = [];
                        data.reviewImages?.forEach(url => reviews.push({ url, type: 'image', source: 'review', category: 'reviewImage' }));
                        data.reviewVideos?.forEach(url => reviews.push({ url, type: 'video', source: 'review', category: 'reviewVideo' }));
                        const dedupedReviews = reviews.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i);
                        setPersistentReviews(dedupedReviews);
                    }
                }
            } catch (e) {
                console.error("Failed to load data", e);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        load();

        // Polling
        const interval = setInterval(async () => {
            if (!downloading && !selectingVariant) {
                const data = await scrapeProductData(false);
                if (isMounted && data) {
                    setProductData(prev => {
                        // Keep current selection state if same ASIN
                        if (prev && prev.asin === data.asin) return { ...data, variants: prev.variants }; // Simplified update
                        return data;
                    });
                }
            }
        }, 2000);

        return () => { isMounted = false; clearInterval(interval); };
    }, [scrapeProductData, downloading, selectingVariant]);

    // Cache Persistence Effect - Automatically capture videos/images from active variants
    useEffect(() => {
        if (!productData?.variants) return;

        setVariantVideosCache(prev => {
            const next = { ...prev };
            let hasChanges = false;

            productData.variants.forEach(v => {
                if (v.videos && v.videos.length > 0) {
                    // Only update if we have MORE videos or different ones
                    const prevVids = next[v.asin] || [];
                    if (v.videos.length > prevVids.length || !prevVids.every((val, i) => val === v.videos![i])) {
                        next[v.asin] = v.videos;
                        hasChanges = true;
                    }
                }
            });

            return hasChanges ? next : prev;
        });
    }, [productData]);

    // Handlers
    const handleVariantSelect = async (asin: string, name: string, images?: string[], videos?: string[]) => {
        if (!selectVariant) return;
        setSelectingVariant(true);
        setSelectedVariantAsin(asin);

        if (images && images.length > 0) {
            setVariantImagesCache(prev => ({ ...prev, [asin]: images }));
        }

        if (videos && videos.length > 0) {
            setVariantVideosCache(prev => ({ ...prev, [asin]: videos }));
        }

        try {
            await selectVariant(asin);
            const data = await scrapeProductData(true);
            if (data) setProductData(data);
        } finally {
            setSelectingVariant(false);
        }
    };

    const handlePreview = (item: MediaItem) => {
        if (!showPreview) return;
        const contextUrls = filteredMediaItems.map(i => i.url);
        showPreview(item.url, item.type, contextUrls);
    };

    const toggleSelection = (url: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const newSet = new Set(selectedItems);
        if (newSet.has(url)) newSet.delete(url);
        else newSet.add(url);
        setSelectedItems(newSet);
    };

    const downloadSingle = async (url: string) => {
        await downloadZip([url], 'image-download');
    };

    const downloadAll = async () => {
        setDownloading(true);
        try {
            const allDownloads = allMediaItems.map(i => i.url);
            await downloadZip(allDownloads, `all-media-${productData?.asin || 'download'}`);
        } finally {
            setDownloading(false);
        }
    };

    const downloadSelected = async () => {
        setDownloading(true);
        try {
            await downloadZip(Array.from(selectedItems), 'selected-media');
            setSelectedItems(new Set());
        } finally {
            setDownloading(false);
        }
    };

    const handleRefresh = async () => {
        setLoading(true);
        await scrapeProductData(true).then(d => d && setProductData(d)).finally(() => setLoading(false));
    };

    const renderMediaItem = (item: MediaItem, index: number) => {
        const isSelected = selectedItems.has(item.url);
        const isVideo = item.type === 'video';

        return (
            <div
                key={`${item.url}-${index}`}
                onClick={() => handlePreview(item)}
                title="Click to preview"
                className="media-item"
                style={{
                    position: 'relative',
                    aspectRatio: '1',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    background: COLORS.backgroundSecondary,
                    cursor: 'pointer',
                    border: `2px solid ${isSelected ? COLORS.primary : 'transparent'}`,
                    boxShadow: isSelected ? COLORS.shadowPrimary : '0 1px 3px rgba(0,0,0,0.05)',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxSizing: 'border-box'
                }}
            >
                {isVideo ? (
                    <video src={item.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                    <img src={item.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                )}
                {isVideo && <div style={{ position: 'absolute', top: 5, left: 5, background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: 9, padding: '2px 4px', borderRadius: 4 }}>VIDEO</div>}
                <div
                    onClick={(e) => toggleSelection(item.url, e)}
                    style={{
                        position: 'absolute', top: 8, right: 8, width: 20, height: 20,
                        borderRadius: '50%', background: isSelected ? COLORS.primary : 'rgba(255,255,255,0.8)',
                        border: isSelected ? 'none' : '1px solid #ccc',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                >
                    {isSelected && <div style={{ width: 8, height: 8, background: 'white', borderRadius: '50%' }} />}
                </div>
            </div>
        );
    };

    const renderListingProduct = (product: ListingProduct, index: number) => (
        <div key={index} className="listing-product" style={{ padding: 10, border: `1px solid ${COLORS.border}`, borderRadius: 8, display: 'flex', gap: 10 }}>
            <img src={product.image} style={{ width: 60, height: 60, objectFit: 'contain' }} />
            <div>
                <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{product.title}</div>
                <div style={{ fontSize: 10, color: COLORS.textSecondary }}>{product.asin}</div>
            </div>
        </div>
    );

    // Variant List Render
    const renderVariantList = () => {
        if (allVariants.length === 0) return null;

        return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px', width: '100%', paddingBottom: '20px' }}>
                {allVariants.map((variant) => {
                    const isCurrent = selectedVariantAsin ? selectedVariantAsin === variant.asin : variant.selected;
                    const imageCount = variant.images?.length || 0;
                    const videoCount = variant.videos?.length || 0;

                    return (
                        <div
                            key={variant.asin}
                            onClick={() => !selectingVariant && handleVariantSelect(variant.asin, variant.name, variant.images, variant.videos)}
                            className="variant-card"
                            style={{
                                background: COLORS.surface,
                                borderRadius: '12px',
                                border: isCurrent ? `1.5px solid ${COLORS.primary}` : `1px solid ${COLORS.borderLight}`,
                                padding: '10px',
                                cursor: selectingVariant ? 'wait' : 'pointer',
                                transition: 'all 0.2s',
                                boxShadow: isCurrent ? COLORS.shadowPrimary : '0 1px 3px rgba(0,0,0,0.05)',
                                display: 'flex', flexDirection: 'column', gap: '8px'
                            }}
                        >
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <div style={{
                                    width: '72px', height: '72px', borderRadius: '8px',
                                    background: `url(${variant.image}) center/contain no-repeat`,
                                    backgroundColor: COLORS.backgroundSecondary, flexShrink: 0,
                                    border: `1px solid ${COLORS.borderLight}`
                                }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <h4 style={{ fontSize: '13px', fontWeight: 600, margin: 0, lineHeight: 1.3 }}>{variant.name}</h4>
                                    <span style={{ fontSize: '9px', color: COLORS.textMuted, fontWeight: 600 }}>ASIN: {variant.asin}</span>
                                    {isCurrent && <span style={{ marginLeft: 6, background: COLORS.primary, color: 'white', fontSize: 9, padding: '1px 5px', borderRadius: 4 }}>ACTIVE</span>}

                                    <div style={{ display: 'flex', gap: '5px', marginTop: '8px', overflowX: 'auto' }} className="no-scrollbar">
                                        {(() => {
                                            const allItems = [
                                                ...(variant.images || []).map(i => ({ type: 'image', url: i })),
                                                ...(variant.videos || []).map(v => ({ type: 'video', url: v }))
                                            ];
                                            return allItems.slice(0, 5).map((item, i) => (
                                                <div key={i} style={{ width: 32, height: 32, borderRadius: 6, overflow: 'hidden', flexShrink: 0, border: `1px solid ${COLORS.borderLight}` }}>
                                                    {item.type === 'video' ? <video src={item.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={item.url} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
                                                </div>
                                            ));
                                        })()}
                                    </div>
                                </div>
                            </div>
                            <div style={{ paddingTop: '8px', borderTop: `1px solid ${COLORS.borderLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <span style={{ background: '#F1F5F9', color: '#64748B', padding: '4px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 700 }}>
                                        {imageCount} IMG
                                    </span>
                                    {videoCount > 0 && (
                                        <span style={{ background: '#F1F5F9', color: '#64748B', padding: '4px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 700 }}>
                                            {videoCount} VID
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const allMedia = [...(variant.images || []), ...(variant.videos || [])];
                                        if (allMedia.length > 0) downloadZip(allMedia, `pixora-${variant.asin}-media`);
                                    }}
                                    disabled={selectingVariant}
                                    style={{
                                        padding: '5px 12px',
                                        background: 'white',
                                        border: `1px solid ${COLORS.border}`,
                                        borderRadius: 6,
                                        fontSize: 11,
                                        fontWeight: 600,
                                        color: COLORS.textSecondary,
                                        cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', gap: 4
                                    }}
                                >
                                    <span style={{ fontSize: 14 }}>📥</span> Download
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderReviewDrawer = () => {
        const reviewCount = persistentReviews.length;
        if (!isProductPage) return null;
        if (!reviewSectionExpanded) return null;

        return (
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 100, display: 'flex', flexDirection: 'column' }}>
                <div onClick={() => setReviewSectionExpanded(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)', zIndex: 1 }} />
                <div style={{ position: 'relative', zIndex: 2, background: COLORS.surface, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, boxShadow: COLORS.shadowLg, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${COLORS.borderLight}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div>
                                <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Review Media</h3>
                                <div style={{ fontSize: 11, color: COLORS.textMuted }}>{reviewCount} items found</div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => {
                                const items = persistentReviews.map(i => i.url);
                                if (items.length) downloadZip(items, `reviews-${productData?.asin}`);
                            }} style={{ padding: '6px 12px', background: COLORS.primary, color: 'white', border: 'none', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>Download All</button>
                            <button onClick={() => setReviewSectionExpanded(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>✕</button>
                        </div>
                    </div>

                    <div style={{ padding: 16, overflowY: 'auto', background: COLORS.background }}>
                        <div style={{ display: 'flex', padding: 3, background: '#E2E8F0', borderRadius: 8, marginBottom: 16, width: 'fit-content' }}>
                            {['images', 'videos'].map((type) => (
                                <button key={type} onClick={() => setReviewSubTab(type as 'images' | 'videos')} style={{ padding: '4px 12px', border: 'none', background: reviewSubTab === type ? 'white' : 'transparent', borderRadius: 6, fontSize: 11, fontWeight: reviewSubTab === type ? 700 : 500, cursor: 'pointer' }}>
                                    {type.charAt(0).toUpperCase() + type.slice(1)}
                                </button>
                            ))}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                            {persistentReviews.filter(i => i.type === (reviewSubTab === 'images' ? 'image' : 'video')).map((item, index) => renderMediaItem(item, index))}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderEmpty = () => (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 32px', textAlign: 'center', flex: 1 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No media found</h3>
            <button onClick={handleRefresh} style={{ padding: '8px 16px', background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, cursor: 'pointer' }}>Refresh</button>
        </div>
    );

    // Main Render
    if (view === 'welcome') return <Welcome onGetStarted={() => setView('login')} />;
    if (view === 'login') return <Login onLogin={() => setView('main')} />;

    const hasContent = isProductPage ? allMediaItems.length > 0 : productData?.listingProducts?.length && productData.listingProducts.length > 0;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', background: COLORS.background, fontFamily: 'system-ui, sans-serif', color: COLORS.text, overflow: 'hidden' }}>
            {/* SEARCH BAR (Listing Page) */}
            {!loading && isListingPage && (
                <div style={{ padding: '8px 12px', background: COLORS.surface, borderBottom: `1px solid ${COLORS.borderLight}` }}>
                    <input type="text" placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ width: '100%', padding: '8px', border: `1px solid ${COLORS.border}`, borderRadius: 8 }} />
                </div>
            )}

            <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
                {loading ? <div style={{ padding: 20 }}>Loading...</div> : !hasContent ? renderEmpty() : (
                    <>
                        {/* Top Action Bar */}
                        {isProductPage && mainTab === 'product' && subTab === 'images' && allVariants.length > 0 && (
                            <div style={{ padding: '12px 12px 4px 12px', background: COLORS.surface, display: 'flex', flexDirection: 'column', gap: 12, zIndex: 40, borderBottom: `1px solid ${COLORS.borderLight}` }}>
                                <div style={{ display: 'flex', gap: 10 }}>
                                    {persistentReviews.length > 0 && (
                                        <button
                                            onClick={() => setReviewSectionExpanded(true)}
                                            style={{
                                                flex: 1,
                                                padding: '8px 4px',
                                                borderRadius: 8,
                                                background: 'white',
                                                color: COLORS.primary,
                                                border: `1px solid ${COLORS.primary}`,
                                                fontSize: 12,
                                                fontWeight: 700,
                                                cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                                            }}
                                        >
                                            <span>💬 Review Media</span>
                                            <span style={{ background: COLORS.primary, color: 'white', borderRadius: 10, padding: '1px 6px', fontSize: 10 }}>{persistentReviews.length}</span>
                                        </button>
                                    )}
                                    <button
                                        onClick={downloadAll}
                                        disabled={downloading}
                                        style={{
                                            flex: 1,
                                            padding: '8px 12px',
                                            background: COLORS.primary,
                                            color: 'white',
                                            borderRadius: 8,
                                            fontSize: 12,
                                            fontWeight: 700,
                                            border: 'none',
                                            cursor: 'pointer',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                                        }}
                                    >
                                        <span>📥 Download All</span>
                                        <span style={{ background: 'rgba(255,255,255,0.2)', color: 'white', borderRadius: 10, padding: '1px 6px', fontSize: 10 }}>{allMediaItems.length}</span>
                                    </button>
                                </div>
                                <h3 style={{ fontSize: 14, fontWeight: 800, margin: 0, paddingBottom: 4 }}>Available Variants</h3>
                            </div>
                        )}

                        {renderReviewDrawer()}

                        <div className="scroll-container" style={{ flex: 1, overflowY: 'auto', background: COLORS.background, padding: 12 }}>
                            {isProductPage && mainTab === 'product' && subTab === 'images' && renderVariantList()}
                            {!(isProductPage && mainTab === 'product' && subTab === 'images') && !isListingPage && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                                    {filteredMediaItems.map((item, index) => renderMediaItem(item, index))}
                                </div>
                            )}
                            {isListingPage && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                                    {productData?.listingProducts?.map((product, index) => renderListingProduct(product, index))}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </main>

            <style>{`
                .no-scrollbar::-webkit-scrollbar { display: none; }
                .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            `}</style>
        </div>
    );
}

export default PanelApp;