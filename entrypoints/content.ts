/**
 * FRESH CONTENT SCRIPT
 * Version 3.0.0 - Complete Rewrite
 * 
 * This script handles:
 * 1. Pre-loading ALL variant media at initial page load
 * 2. Instant variant switching with pre-cached data
 * 3. Strict separation of official product media vs customer review media
 * 4. Auto-selection of current variant on load
 */

import {
    scrapeAllVariantsWithMedia,
    scrapeVariantsQuick,
    getVariantMedia,
    scrapeCurrentGalleryVideos,
    VariantItem
} from '../utils/variantScraper';

// ============================================
// TYPES
// ============================================

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
    variants: VariantItem[];
    description: string;
    activeImage: string;
    productImages: string[];
    variantImages?: Record<string, string[]>;
    variantImagesByAsin?: Record<string, string[]>;
    reviewImages: string[];
    videos: string[];
    reviewVideos: string[];
    listingProducts: ProductItem[];
}

// ============================================
// CONTENT SCRIPT DEFINITION
// ============================================

export default defineContentScript({
    matches: [
        '*://*.amazon.com/*',
        '*://*.amazon.co.uk/*',
        '*://*.amazon.de/*',
        '*://*.amazon.co.jp/*',
        '*://*.amazon.in/*',
    ],
    main() {
        console.log('AMZImage Content Script v3.0 Loaded');

        // ============================================
        // STATE
        // ============================================
        let lastUrl = window.location.href;
        let lastAsin = '';
        let productReviewAsin = '';
        let cachedVariants: VariantItem[] = [];
        let isLoadingVariants = false;
        let prefetchedReviewImages: string[] = [];
        let prefetchedReviewVideos: string[] = [];
        let prefetchedAsin = '';

        // Debounce timer for notifications
        let refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;

        // ============================================
        // UTILITY FUNCTIONS
        // ============================================

        function getCurrentAsin(): string {
            // Priority 1: Hidden ASIN input
            const asinInput = document.getElementById('ASIN') as HTMLInputElement;
            if (asinInput?.value) return asinInput.value;

            // Priority 2: Selected swatch
            const selectedSwatch = document.querySelector(
                'li.swatchSelect[data-asin], li.swatchSelect[data-defaultasin], ' +
                'li[aria-selected="true"][data-asin], li.selected[data-asin]'
            );
            if (selectedSwatch) {
                const asin = selectedSwatch.getAttribute('data-asin') ||
                    selectedSwatch.getAttribute('data-defaultasin');
                if (asin) return asin;
            }

            // Priority 3: URL
            const match = window.location.pathname.match(/\/dp\/([A-Z0-9]{10})/i);
            if (match) return match[1];

            return '';
        }

        function getProductReviewAsin(): string {
            // 1. Try to get specific review ASIN from the link if it exists (for aggregated reviews)
            const reviewLink = document.querySelector('[data-hook="see-all-reviews-link-foot"]');
            if (reviewLink) {
                const href = reviewLink.getAttribute('href');
                const match = href?.match(/\/product-reviews\/([A-Z0-9]{10})/);
                if (match) {
                    productReviewAsin = match[1];
                    return match[1];
                }
            }

            // 2. Try generic review link if data-hook is missing (common on JP/DE)
            const anyReviewLink = document.querySelector('a[href*="/product-reviews/"]');
            if (anyReviewLink) {
                const href = anyReviewLink.getAttribute('href');
                const match = href?.match(/\/product-reviews\/([A-Z0-9]{10})/);
                if (match) {
                    productReviewAsin = match[1];
                    return match[1];
                }
            }

            // 3. Fallback to current
            if (productReviewAsin) return productReviewAsin;
            const current = getCurrentAsin();
            if (current) {
                productReviewAsin = current;
                return current;
            }
            return '';
        }

        function isProductPage(): boolean {
            const url = window.location.pathname;
            return url.includes('/dp/') || url.includes('/gp/product/') || url.includes('/product-reviews/');
        }

        function isListingPage(): boolean {
            const url = window.location.href;
            return url.includes('/s?') ||
                url.includes('/s/') ||
                url.includes('/b/') ||
                url.includes('/b?') ||
                url.includes('/deals') ||
                url.includes('/gp/browse') ||
                url.includes('/gp/bestsellers') ||
                document.querySelector('.s-main-slot') !== null;
        }

        function notifyContentChange(reason: string) {
            if (refreshDebounceTimer) {
                clearTimeout(refreshDebounceTimer);
            }
            refreshDebounceTimer = setTimeout(() => {
                browser.runtime.sendMessage({
                    type: 'CONTENT_CHANGED',
                    reason,
                    url: window.location.href
                }).catch(() => { });
            }, 200);
        }

        function toHighRes(url: string): string {
            if (!url) return '';
            return url
                .replace(/\._[A-Z]{2}_[A-Za-z0-9,_]+_\./, '.')
                .replace(/\._AC_.*_\./, '.')
                .replace(/\._[A-Z]{2,4}[0-9]+_/, '');
        }

        function getImageBase(url: string): string {
            const match = url.match(/images\/I\/([A-Za-z0-9]+)/);
            return match ? match[1] : url;
        }

        function getVideoId(url: string): string {
            try {
                return new URL(url).pathname;
            } catch {
                return url.split('?')[0];
            }
        }

        function isValidImage(url: string | null | undefined): boolean {
            if (!url || typeof url !== 'string') return false;
            if (!url.startsWith('http')) return false;
            const lower = url.toLowerCase();
            const excludePatterns = [
                'sprite', 'transparent', 'spacer', 'placeholder', 'loading',
                'spinner', 'grey-pixel', 'data:', 'button', 'icon', 'logo',
                'badge', 'banner', 'promo', 'ad-', 'advertisement', 'arrow'
            ];
            if (excludePatterns.some(p => lower.includes(p))) return false;
            if (!/\.(jpg|jpeg|png|webp|gif)/i.test(lower)) return false;
            return true;
        }

        function isCustomerReviewImage(url: string): boolean {
            const lower = url.toLowerCase();
            return lower.includes('customer') ||
                lower.includes('review') ||
                lower.includes('ugc') ||
                lower.includes('cr-media') ||
                lower.includes('cm_cr');
        }

        function isCustomerReviewVideo(url: string): boolean {
            const lower = url.toLowerCase();
            return lower.includes('customer-review') ||
                lower.includes('customerreview') ||
                lower.includes('review-video') ||
                lower.includes('ugc') ||
                lower.includes('cr-media') ||
                lower.includes('cm_cr') ||
                lower.includes('user-video');
        }

        // ============================================
        // REVIEW MEDIA FETCHING (Separate from Product Gallery)
        // ============================================

        async function fetchAllReviewMedia(asin: string, limit: number = 100, onProgress?: (imgs: string[], vids: string[]) => void): Promise<{ images: string[], videos: string[] }> {
            const allImages: string[] = [];
            const allVideos: string[] = [];
            const seenImages = new Set<string>();
            const seenVideos = new Set<string>();

            const baseUrl = window.location.origin;

            for (let pageNo = 1; pageNo <= Math.ceil(limit / 10); pageNo++) {
                const reviewUrl = `${baseUrl}/product-reviews/${asin}?reviewerType=all_reviews&pageNumber=${pageNo}&filterByStar=all_stars&mediaType=media_reviews_only`;

                try {
                    const response = await fetch(reviewUrl);
                    if (!response.ok) break;

                    const html = await response.text();
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(html, 'text/html');

                    // Extract review images
                    doc.querySelectorAll('[data-hook="review-image-tile"] img, .review-image-tile img, .cr-lightbox-image-thumbnail img').forEach(img => {
                        const src = (img as HTMLImageElement).src || img.getAttribute('data-src') || '';
                        if (src && isValidImage(src)) {
                            const highRes = toHighRes(src);
                            const id = getImageBase(highRes);
                            if (!seenImages.has(id)) {
                                seenImages.add(id);
                                allImages.push(highRes);
                            }
                        }
                    });

                    // Extract review videos from DOM (Enhanced)
                    const videoContainers = doc.querySelectorAll('video, [data-hook="review-video"], .video-block, .cr-video-desktop, [data-hook="review-video-cell"]');
                    videoContainers.forEach(container => {
                        // 1. Direct Video Tag
                        if (container.tagName === 'VIDEO') {
                            const src = (container as HTMLVideoElement).src || container.querySelector('source')?.src;
                            if (src && src.startsWith('http')) {
                                const id = getVideoId(src);
                                if (!seenVideos.has(id)) { seenVideos.add(id); allVideos.push(src); }
                            }
                            return;
                        }

                        // 2. Video tag inside
                        const video = container.querySelector('video');
                        if (video) {
                            const src = video.src || video.querySelector('source')?.src;
                            if (src && src.startsWith('http')) {
                                const id = getVideoId(src);
                                if (!seenVideos.has(id)) { seenVideos.add(id); allVideos.push(src); }
                            }
                        }

                        // 3. Data attributes
                        const dataUrl = container.getAttribute('data-video-url');
                        if (dataUrl && dataUrl.startsWith('http')) {
                            const id = getVideoId(dataUrl);
                            if (!seenVideos.has(id)) { seenVideos.add(id); allVideos.push(dataUrl); }
                        }

                        // 4. Input values
                        const input = container.querySelector('input[type="hidden"][value*=".mp4"]');
                        if (input && (input as HTMLInputElement).value) {
                            const val = (input as HTMLInputElement).value;
                            const id = getVideoId(val);
                            if (!seenVideos.has(id)) { seenVideos.add(id); allVideos.push(val); }
                        }
                    });

                    // Also extract video URLs from script tags in review pages
                    doc.querySelectorAll('script:not([src])').forEach(script => {
                        const content = script.textContent || '';
                        if (content.includes('video') || content.includes('media')) {
                            const videoMatches = content.match(/https?:\/\/[^"'\s,\]\[\}]+\.(mp4|m3u8|webm)[^"'\s,\]\[\}]*/gi);
                            if (videoMatches) {
                                videoMatches.forEach(vUrl => {
                                    const cleanUrl = vUrl.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                    // Check if it's a customer review video
                                    const lowerUrl = cleanUrl.toLowerCase();
                                    if (lowerUrl.includes('customer') || lowerUrl.includes('review') ||
                                        lowerUrl.includes('ugc') || lowerUrl.includes('cm_cr') ||
                                        lowerUrl.includes('cr-media')) {
                                        const id = getVideoId(cleanUrl);
                                        if (!seenVideos.has(id)) {
                                            seenVideos.add(id);
                                            allVideos.push(cleanUrl);
                                        }
                                    }
                                });
                            }
                        }
                    });

                    // Check for more pages
                    const hasNext = doc.querySelector('.a-pagination .a-last:not(.a-disabled)') !== null;
                    if (onProgress) {
                        onProgress([...allImages], [...allVideos]);
                    }
                    if (!hasNext) break;

                } catch (e) {
                    console.warn('Review fetch error:', e);
                    break;
                }
            }

            return { images: allImages, videos: allVideos };
        }

        async function prefetchReviewMedia() {
            const asin = getProductReviewAsin();
            if (!asin || !isProductPage()) return;
            if (asin === prefetchedAsin) return;

            console.log('AMZImage: Prefetching review media for', asin);
            prefetchedAsin = asin;

            try {
                // Pass incremental callback to update UI as we find images
                const extra = await fetchAllReviewMedia(asin, 100, (imgs, vids) => {
                    if (imgs.length > prefetchedReviewImages.length || vids.length > prefetchedReviewVideos.length) {
                        prefetchedReviewImages = imgs;
                        prefetchedReviewVideos = vids;
                        notifyContentChange('prefetch_update');
                    }
                });

                // Final update
                prefetchedReviewImages = extra.images;
                prefetchedReviewVideos = extra.videos;

                console.log('AMZImage: Prefetch complete -', prefetchedReviewImages.length, 'images,', prefetchedReviewVideos.length, 'videos');

                if (prefetchedReviewImages.length > 0 || prefetchedReviewVideos.length > 0) {
                    notifyContentChange('prefetch_complete');
                }
            } catch (e) {
                console.warn('AMZImage: Prefetch error', e);
            }
        }

        // ============================================
        // LISTING PAGE SCRAPER
        // ============================================

        function scrapeListingProducts(): ProductItem[] {
            const products: ProductItem[] = [];
            const seenAsins = new Set<string>();

            // Comprehensive selectors for different Amazon listing layouts
            const productCardSelectors = [
                '.s-main-slot .s-result-item[data-asin]:not([data-asin=""])',
                '.s-search-results .s-result-item[data-asin]:not([data-asin=""])',
                '[data-component-type="s-search-result"][data-asin]:not([data-asin=""])',
                '.sg-col-inner [data-asin]:not([data-asin=""])',
                '[data-asin]:not([data-asin=""]):not(.AdHolder)',
                '.s-result-item[data-asin]'
            ];

            let productCards: NodeListOf<HTMLElement> | null = null;

            // Try each selector until we find products
            for (const selector of productCardSelectors) {
                const cards = document.querySelectorAll<HTMLElement>(selector);
                if (cards.length > 0) {
                    productCards = cards;
                    break;
                }
            }

            if (!productCards || productCards.length === 0) {
                // Final fallback: any element with data-asin
                productCards = document.querySelectorAll<HTMLElement>('[data-asin]:not([data-asin=""])');
            }

            productCards.forEach((card) => {
                const asin = card.getAttribute('data-asin') || '';
                if (!asin || seenAsins.has(asin)) return;

                // Skip sponsored/ad content
                if (card.querySelector('.s-sponsored-label-info-icon, .s-sponsored-list-header, [data-component-type="sp-sponsored-result"]')) return;
                if (card.classList.contains('AdHolder')) return;
                if (card.closest('.AdHolder')) return;

                // Multiple image selectors for different layouts
                const imgSelectors = [
                    'img.s-image',
                    'img[data-image-latency]',
                    '.s-product-image-container img',
                    '.s-image-square-aspect img',
                    '.a-dynamic-image',
                    '.s-image-overlay-grey img',
                    'img[src*="/images/I/"]',
                    'img[data-src*="/images/I/"]'
                ];

                let img: HTMLImageElement | null = null;
                for (const imgSel of imgSelectors) {
                    img = card.querySelector<HTMLImageElement>(imgSel);
                    if (img && (img.src || img.getAttribute('data-src'))) break;
                }

                let imageUrl = '';

                // Strategy 1: data-a-dynamic-image (highest res options)
                const dynamicImgData = img?.getAttribute('data-a-dynamic-image');
                if (dynamicImgData) {
                    try {
                        const dynamicImages = JSON.parse(dynamicImgData);
                        const urls = Object.keys(dynamicImages);
                        if (urls.length > 0) {
                            imageUrl = urls.sort((a, b) => {
                                const dimsA = dynamicImages[a] || [0, 0];
                                const dimsB = dynamicImages[b] || [0, 0];
                                const [w1, h1] = dimsA;
                                const [w2, h2] = dimsB;
                                return (w2 * h2) - (w1 * h1);
                            })[0];
                        }
                    } catch { }
                }

                // Strategy 2: srcset
                if (!imageUrl && img?.srcset) {
                    const candidates = img.srcset.split(',').map(s => {
                        const parts = s.trim().split(' ');
                        return { url: parts[0], size: parts[1] ? parseFloat(parts[1]) : 1 };
                    });
                    const best = candidates.sort((a, b) => b.size - a.size)[0];
                    if (best && best.url) imageUrl = best.url;
                }

                // Strategy 3: Direct src or data-src
                if (!imageUrl) {
                    imageUrl = img?.src || img?.getAttribute('data-src') || '';
                }

                // Upgrade to high-res
                if (imageUrl) {
                    imageUrl = toHighRes(imageUrl);
                }

                // Title extraction with multiple selectors
                const titleSelectors = [
                    'h2 a span',
                    'h2 span.a-text-normal',
                    '.a-size-base-plus.a-color-base.a-text-normal',
                    '.a-size-medium.a-color-base.a-text-normal',
                    '[data-cy="title-recipe"] a span',
                    '.s-line-clamp-2 span',
                    'h2 .a-link-normal span'
                ];

                let title = '';
                for (const titleSel of titleSelectors) {
                    const titleEl = card.querySelector<HTMLElement>(titleSel);
                    if (titleEl?.textContent?.trim()) {
                        title = titleEl.textContent.trim();
                        break;
                    }
                }

                // Price
                const priceEl = card.querySelector<HTMLElement>('.a-price .a-offscreen, .a-price-whole');
                let price = priceEl?.textContent?.trim() || '';
                if (price.length > 20 || !/[0-9]/.test(price)) price = '';

                // Rating
                const ratingEl = card.querySelector<HTMLElement>('.a-icon-star-small .a-icon-alt, .a-icon-star .a-icon-alt');
                const rating = ratingEl?.textContent?.trim() || '';

                // Only add if we have valid image and title
                if (imageUrl && imageUrl.startsWith('http') && title) {
                    seenAsins.add(asin);
                    products.push({
                        asin,
                        title: title.substring(0, 80) + (title.length > 80 ? '...' : ''),
                        image: imageUrl,
                        price,
                        rating
                    });
                }
            });

            console.log(`AMZImage: Scraped ${products.length} products from listing page`);
            return products;
        }

        // ============================================
        // VARIANT MEDIA LOADING (Pre-load All at Start)
        // ============================================

        async function loadAllVariantMedia(): Promise<VariantItem[]> {
            if (isLoadingVariants) {
                // Wait for existing load to complete
                while (isLoadingVariants) {
                    await new Promise(r => setTimeout(r, 100));
                }
                return cachedVariants;
            }

            isLoadingVariants = true;
            console.log('AMZImage: Loading ALL variant media...');

            try {
                const variants = await scrapeAllVariantsWithMedia();
                cachedVariants = variants;

                console.log(`AMZImage: Loaded media for ${variants.length} variants`);
                variants.forEach(v => {
                    console.log(`  - ${v.name} (${v.asin}): ${v.images.length} images, ${v.videos.length} videos`);
                });

                notifyContentChange('variants_loaded');
                return variants;
            } catch (e) {
                console.error('AMZImage: Failed to load variant media:', e);
                return [];
            } finally {
                isLoadingVariants = false;
            }
        }

        // ============================================
        // MAIN SCRAPE FUNCTION
        // ============================================

        async function scrapeProductData(triggerScroll: boolean = false): Promise<ProductData> {
            const onProductPage = isProductPage();
            const onListingPage = isListingPage();
            const pageType = onProductPage ? 'product' : 'listing';

            const productImages: string[] = [];
            const reviewImages: string[] = [];
            const videos: string[] = [];
            const reviewVideos: string[] = [];
            const listingProducts: ProductItem[] = [];
            const variantImagesMap: Record<string, string[]> = {};
            const variantImagesByAsin: Record<string, string[]> = {};

            // Include prefetched review media
            if (prefetchedReviewImages.length > 0) {
                reviewImages.push(...prefetchedReviewImages);
            }
            if (prefetchedReviewVideos.length > 0) {
                reviewVideos.push(...prefetchedReviewVideos);
            }

            // Get base product info
            const asin = getProductReviewAsin();

            let title = '';
            if (onProductPage) {
                const titleElement = document.querySelector('#productTitle, #title');
                title = titleElement?.textContent?.trim() || '';
            } else {
                const searchQuery = new URLSearchParams(window.location.search).get('k');
                if (searchQuery) {
                    title = `Search: "${searchQuery}"`;
                } else {
                    title = 'Product Listing';
                }
            }

            let variant = '';
            if (onProductPage) {
                const variantElement = document.querySelector('#variation_color_name .selection, #variation_size_name .selection');
                variant = variantElement?.textContent?.trim() || '';
            }

            let description = '';
            if (onProductPage) {
                const descElement = document.querySelector('#productDescription p, #feature-bullets');
                description = descElement?.textContent?.trim().substring(0, 300) || '';
            } else {
                description = `Products found on this page`;
            }

            // Handle listing pages
            if (onListingPage && !onProductPage) {
                const products = scrapeListingProducts();
                listingProducts.push(...products);
                products.forEach(p => {
                    if (p.image && !productImages.includes(p.image)) {
                        productImages.push(p.image);
                    }
                });
            }

            // ============================================
            // PRODUCT PAGE: VARIANT MEDIA HANDLING
            // ============================================
            let variants: VariantItem[] = [];

            if (onProductPage) {
                // Use cached variants if available, otherwise load fresh
                if (cachedVariants.length > 0) {
                    variants = cachedVariants;
                } else if (triggerScroll) {
                    // Initial load: fetch all variant media
                    variants = await loadAllVariantMedia();
                } else {
                    // Quick load: get basic variant info, mark as loading
                    variants = scrapeVariantsQuick();
                    // Trigger async load in background
                    loadAllVariantMedia().then(loaded => {
                        cachedVariants = loaded;
                        notifyContentChange('variants_loaded');
                    });
                }

                // Update current ASIN's selected state
                const activeAsinForVariant = getCurrentAsin();
                variants = variants.map(v => ({
                    ...v,
                    selected: v.asin === activeAsinForVariant
                }));

                // Build variant maps and populate main gallery from selected variant
                const selectedVariant = variants.find(v => v.selected);

                variants.forEach(v => {
                    if (v.images && v.images.length > 0) {
                        variantImagesMap[v.name] = v.images;
                        variantImagesByAsin[v.asin] = v.images;
                    }
                    if (v.selected && v.images) {
                        v.images.forEach(img => {
                            if (!productImages.includes(img)) {
                                productImages.push(img);
                            }
                        });
                    }
                    if (v.selected && v.videos) {
                        v.videos.forEach(vid => {
                            if (!videos.includes(vid)) {
                                videos.push(vid);
                            }
                        });
                    }
                });

                // FALLBACK: Ensure current page videos are captured even if variant mapping failed
                if (videos.length === 0) {
                    const directVideos = scrapeCurrentGalleryVideos();
                    if (directVideos.length > 0) {
                        console.log('AMZImage: Recovered', directVideos.length, 'videos from direct scrape');
                        directVideos.forEach(v => {
                            if (!videos.includes(v)) videos.push(v);
                        });
                    }
                }

                // ============================================
                // REVIEW MEDIA EXTRACTION (Customer Content Only)
                // COMPREHENSIVE: All original extraction strategies
                // Runs every time to ensure review media is always available
                // ============================================
                {
                    const seenReviewBases = new Set<string>(reviewImages.map(i => getImageBase(i)));
                    const seenReviewVideoIds = new Set<string>(reviewVideos.map(v => getVideoId(v)));

                    // Helper to add unique review image
                    function addUniqueReviewImage(url: string, contextContent: string = ''): boolean {
                        if (!url || !isValidImage(url)) return false;

                        // Exclude promotional content
                        const promoPatterns = ['sponsored', 'advertisement', 'similar brands', 'compare with similar'];
                        const lowerContext = contextContent.toLowerCase();
                        if (promoPatterns.some(p => lowerContext.includes(p))) return false;

                        const highRes = toHighRes(url);
                        const id = getImageBase(highRes);
                        if (!seenReviewBases.has(id)) {
                            seenReviewBases.add(id);
                            reviewImages.push(highRes);
                            return true;
                        }
                        return false;
                    }

                    // Helper to add unique review video
                    function addReviewVideo(url: string): boolean {
                        if (!url || !url.startsWith('http')) return false;
                        const cleanUrl = url.replace(/\\u002F/g, '/').replace(/\\/g, '');
                        const id = getVideoId(cleanUrl);
                        if (!seenReviewVideoIds.has(id)) {
                            seenReviewVideoIds.add(id);
                            reviewVideos.push(cleanUrl);
                            return true;
                        }
                        return false;
                    }

                    // Helper to check if video is review context
                    function isReviewVideoContext(content: string, url: string): boolean {
                        const lowerUrl = url.toLowerCase();
                        const reviewUrlPatterns = [
                            'customer-review', 'customerreview', 'customer_review',
                            'review-video', 'reviewvideo', 'review_video',
                            'ugc-video', 'ugcvideo', 'ugc_video', 'ugc',
                            'user-review', 'userreview', 'user_review',
                            'user-video', 'uservideo', 'user_video',
                            'cm_cr', 'crwidget', 'cr-media', 'crmedia', 'cr_media',
                            'customer-media', 'customermedia'
                        ];
                        return reviewUrlPatterns.some(p => lowerUrl.includes(p));
                    }

                    const imageScripts = document.querySelectorAll('script:not([src])');

                    // ==========================================
                    // PRIMARY: Extract review images from ALL embedded script data
                    // ==========================================
                    imageScripts.forEach(script => {
                        const content = script.textContent || '';
                        if (!content || content.length < 50) return;

                        const lowerContent = content.toLowerCase();

                        // Pattern 1: customerImages structure
                        const customerImagesMatch = content.match(/"customerImages"\s*:\s*\[(.*?)\]/gs);
                        if (customerImagesMatch) {
                            customerImagesMatch.forEach(match => {
                                const urls = match.match(/https:\/\/[^"'\s,\]\[]+\.(jpg|jpeg|png|webp)[^"'\s,\]\[]*/gi);
                                if (urls) {
                                    urls.forEach(url => {
                                        url = url.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                        addUniqueReviewImage(url);
                                    });
                                }
                            });
                        }

                        // Pattern 2: reviewImages structure
                        const reviewImagesMatch = content.match(/"reviewImages"\s*:\s*\[(.*?)\]/gs);
                        if (reviewImagesMatch) {
                            reviewImagesMatch.forEach(match => {
                                const urls = match.match(/https:\/\/[^"'\s,\]\[]+\.(jpg|jpeg|png|webp)[^"'\s,\]\[]*/gi);
                                if (urls) {
                                    urls.forEach(url => {
                                        url = url.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                        addUniqueReviewImage(url);
                                    });
                                }
                            });
                        }

                        // Pattern 3: customerMediaGallery structure
                        const mediaGalleryMatch = content.match(/"customerMediaGallery"\s*:\s*\{([\s\S]*?)\}/g);
                        if (mediaGalleryMatch) {
                            mediaGalleryMatch.forEach(match => {
                                const urls = match.match(/https:\/\/[^"'\s,\]\[\}]+\.(jpg|jpeg|png|webp)[^"'\s,\]\[\}]*/gi);
                                if (urls) {
                                    urls.forEach(url => {
                                        url = url.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                        addUniqueReviewImage(url);
                                    });
                                }
                            });
                        }

                        // Pattern 4: mediaCustomerReviews structure
                        const mediaReviewsMatch = content.match(/"mediaCustomerReviews"\s*:\s*\[(.*?)\]/gs);
                        if (mediaReviewsMatch) {
                            mediaReviewsMatch.forEach(match => {
                                const urls = match.match(/https:\/\/[^"'\s,\]\[]+\.(jpg|jpeg|png|webp)[^"'\s,\]\[]*/gi);
                                if (urls) {
                                    urls.forEach(url => {
                                        url = url.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                        addUniqueReviewImage(url);
                                    });
                                }
                            });
                        }

                        // Pattern 5: CM_CR / widget-based review image data
                        if (lowerContent.includes('cm_cr') || lowerContent.includes('cr-media')) {
                            const crImageUrls = content.match(/https:\/\/[^"'\s,\]\[]+(?:cm_cr|cr-media|customer)[^"'\s,\]\[]*\.(jpg|jpeg|png|webp)[^"'\s,\]\[]*/gi);
                            if (crImageUrls) {
                                crImageUrls.forEach(url => {
                                    url = url.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                    addUniqueReviewImage(url);
                                });
                            }
                        }

                        // Pattern 6: crwidget / cr-widget based
                        if (lowerContent.includes('crwidget') || lowerContent.includes('cr-widget')) {
                            const widgetImageUrls = content.match(/"(?:imageUrl|mediaUrl|thumbnailUrl|largeImageUrl)"\s*:\s*"(https:\/\/[^"]+)"/gi);
                            if (widgetImageUrls) {
                                widgetImageUrls.forEach(match => {
                                    const urlMatch = match.match(/"(https:\/\/[^"]+)"/);
                                    if (urlMatch && urlMatch[1]) {
                                        const url = urlMatch[1].replace(/\\u002F/g, '/').replace(/\\/g, '');
                                        if (url.match(/\.(jpg|jpeg|png|webp)/i)) {
                                            addUniqueReviewImage(url);
                                        }
                                    }
                                });
                            }
                        }

                        // Pattern 7: Review object structures with images array
                        const reviewObjectMatches = content.match(/\{[^{}]*"reviewId"[^{}]*"images"\s*:\s*\[[^\]]*\][^{}]*\}/g);
                        if (reviewObjectMatches) {
                            reviewObjectMatches.forEach(reviewObj => {
                                const urls = reviewObj.match(/https:\/\/[^"'\s,\]\[\}]+\.(jpg|jpeg|png|webp)[^"'\s,\]\[\}]*/gi);
                                if (urls) {
                                    urls.forEach(url => {
                                        url = url.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                        addUniqueReviewImage(url);
                                    });
                                }
                            });
                        }

                        // Pattern 8: ReviewImageGalleryData
                        const reviewGalleryMatch = content.match(/ReviewImageGalleryData\s*:\s*([\[\{][\s\S]*?[\]\}])/i);
                        if (reviewGalleryMatch) {
                            try {
                                const galleryData = JSON.parse(reviewGalleryMatch[1].replace(/'/g, '"'));
                                const items = Array.isArray(galleryData) ? galleryData : [galleryData];
                                items.forEach((item: any) => {
                                    const url = item.hiResUrl || item.largeUrl || item.url || '';
                                    if (url) addUniqueReviewImage(url);
                                });
                            } catch { }
                        }

                        // Pattern 9: cr-media-gallery-popover-data
                        const popoverMatch = content.match(/"cr-media-gallery-popover-data"\s*:\s*(\{[\s\S]*?\})\s*,/);
                        if (popoverMatch) {
                            try {
                                const popoverData = JSON.parse(popoverMatch[1].replace(/'/g, '"'));
                                if (popoverData.mediaList && Array.isArray(popoverData.mediaList)) {
                                    popoverData.mediaList.forEach((item: any) => {
                                        if (item.image) {
                                            const url = item.image.hiRes || item.image.large || item.image.url || '';
                                            if (url) addUniqueReviewImage(url);
                                        }
                                        if (item.video) {
                                            const videoUrl = item.video.url || item.video.progressiveUrl || '';
                                            if (videoUrl) addReviewVideo(videoUrl);
                                        }
                                    });
                                }
                            } catch { }
                        }

                        // Pattern 10: window.reviewMediaReel
                        const reelMatch = content.match(/window\.reviewMediaReel\s*=\s*([\[\{][\s\S]*?[\]\}]);/);
                        if (reelMatch) {
                            try {
                                const reelData = JSON.parse(reelMatch[1].replace(/'/g, '"'));
                                const items = Array.isArray(reelData) ? reelData : [reelData];
                                items.forEach((item: any) => {
                                    const url = item.hiResUrl || item.url || '';
                                    if (url) addUniqueReviewImage(url);
                                    if (item.videoUrl) addReviewVideo(item.videoUrl);
                                });
                            } catch { }
                        }

                        // Pattern 11: Designated "Customer review videos" section (Lower page gallery)
                        // This section often loads videos via specific containers not caught by generic video searches
                        const videoReviewSection = document.querySelectorAll('.cr-video-desktop, .video-card-container, [data-hook="review-video-cell"]');
                        videoReviewSection.forEach(container => {
                            // Option A: Direct video element
                            const video = container.querySelector('video');
                            if (video) {
                                const src = video.src || video.querySelector('source')?.src;
                                if (src) addReviewVideo(src);
                            }

                            // Option B: Data attributes on container
                            const dataUrl = container.getAttribute('data-video-url');
                            if (dataUrl) addReviewVideo(dataUrl);

                            // Option C: Hidden inputs or meta tags in this container
                            const inputs = container.querySelectorAll('input[type="hidden"][value*=".mp4"], input[type="hidden"][value*=".m3u8"]');
                            inputs.forEach(input => {
                                if (input instanceof HTMLInputElement && input.value) addReviewVideo(input.value);
                            });
                        });


                        // ==========================================
                        // VIDEO EXTRACTION - Review Videos
                        // ==========================================
                        if (lowerContent.includes('video') || lowerContent.includes('media')) {
                            const videoMatches = content.match(/https?:\/\/[^"'\s,\]\[\}]+\.(mp4|m3u8|mpd|webm)[^"'\s,\]\[\}]*/gi);
                            if (videoMatches) {
                                videoMatches.forEach(vUrl => {
                                    const cleanUrl = vUrl.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                    if (isReviewVideoContext(content, cleanUrl)) {
                                        addReviewVideo(cleanUrl);
                                    }
                                });
                            }
                        }
                    });

                    // ==========================================
                    // SECONDARY: DOM-based review image extraction
                    // ==========================================
                    const reviewImageSelectors = [
                        '[data-hook="review-image-tile"]',
                        '.review-image-tile',
                        '.review-image-thumbnail',
                        '.cr-media-gallery .cr-lightbox-image-thumbnail',
                        '#cm_cr-review_list img[data-src]',
                        '.review-image-container img',
                        '.cr-media-card-container img'
                    ];

                    document.querySelectorAll(reviewImageSelectors.join(', ')).forEach((el) => {
                        const img = el.tagName === 'IMG' ? (el as HTMLImageElement) : el.querySelector('img');
                        if (img) {
                            const val = img.src || img.getAttribute('data-src') || '';
                            if (val) addUniqueReviewImage(val, el.parentElement?.textContent || '');
                        } else if (el.tagName === 'DIV' || el.tagName === 'A') {
                            const style = window.getComputedStyle(el);
                            const bg = style.backgroundImage;
                            if (bg && bg.startsWith('url(')) {
                                const url = bg.replace(/^url\(['"]?/, '').replace(/['"]?\)$/, '');
                                addUniqueReviewImage(url);
                            }
                        }
                    });

                    // ==========================================
                    // TERTIARY: Extract from review image lightbox/modal data
                    // ==========================================
                    const lightboxData = document.querySelector('[data-a-modal-state]');
                    if (lightboxData) {
                        const modalContent = lightboxData.getAttribute('data-a-modal-state') || '';
                        if (modalContent.includes('review') || modalContent.includes('customer')) {
                            const urls = modalContent.match(/https:\/\/[^"'\s,\]\[\}]+\.(jpg|jpeg|png|webp)[^"'\s,\]\[\}]*/gi);
                            if (urls) {
                                urls.forEach(url => {
                                    url = url.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                    addUniqueReviewImage(url);
                                });
                            }
                        }
                    }

                    console.log(`AMZImage: Found ${reviewImages.length} review images, ${reviewVideos.length} review videos`);
                }
            }

            // Active image
            let activeImage = '';
            const landingImage = document.querySelector('#landingImage') as HTMLImageElement;
            if (landingImage?.src) {
                activeImage = toHighRes(landingImage.src);
            }

            return {
                pageType,
                asin,
                title: title.substring(0, 120),
                variant,
                variants,
                description,
                activeImage,
                productImages: [...new Set(productImages)],
                variantImages: variantImagesMap,
                variantImagesByAsin,
                reviewImages: [...new Set(reviewImages)],
                videos: [...new Set(videos)],
                reviewVideos: [...new Set(reviewVideos)],
                listingProducts
            };
        }

        // ============================================
        // PREVIEW MODAL
        // ============================================

        let previewState = {
            urls: [] as string[],
            currentIndex: 0,
            type: 'image' as 'image' | 'video',
            zoom: 1,
            overlay: null as HTMLElement | null
        };

        function closeIntegratedPreview() {
            if (previewState.overlay) {
                previewState.overlay.remove();
                previewState.overlay = null;
                document.removeEventListener('keydown', handlePreviewKeyDown);
                document.body.style.overflow = '';
            }
        }

        function handlePreviewKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') closeIntegratedPreview();
            if (e.key === 'ArrowLeft') navigateIntegratedPreview('prev');
            if (e.key === 'ArrowRight') navigateIntegratedPreview('next');
            if (e.key === '+' || e.key === '=') adjustIntegratedZoom(0.25);
            if (e.key === '-') adjustIntegratedZoom(-0.25);
        }

        function adjustIntegratedZoom(delta: number) {
            if (previewState.type === 'video') return;
            const newZoom = Math.max(1, Math.min(3, previewState.zoom + delta));
            if (newZoom !== previewState.zoom) {
                previewState.zoom = newZoom;
                const img = document.querySelector('#amz-preview-container img') as HTMLImageElement;
                if (img) {
                    img.style.transform = `scale(${previewState.zoom})`;
                    img.style.cursor = previewState.zoom > 1 ? 'zoom-out' : 'zoom-in';
                }
                const zoomDisplay = document.getElementById('amz-zoom-level');
                if (zoomDisplay) zoomDisplay.textContent = `${Math.round(previewState.zoom * 100)}%`;
            }
        }

        function navigateIntegratedPreview(direction: 'prev' | 'next') {
            if (previewState.urls.length <= 1) return;
            previewState.zoom = 1;
            if (direction === 'prev') {
                previewState.currentIndex = (previewState.currentIndex - 1 + previewState.urls.length) % previewState.urls.length;
            } else {
                previewState.currentIndex = (previewState.currentIndex + 1) % previewState.urls.length;
            }
            renderIntegratedPreview();
        }

        function renderIntegratedPreview() {
            if (!previewState.overlay) return;
            const url = previewState.urls[previewState.currentIndex];
            const isVideoExt = url.toLowerCase().match(/\.(mp4|webm|ogg|m3u8|mpd)($|\?)/);
            const isImageExt = url.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif|bmp|tiff)($|\?)/);
            const isVideo = isVideoExt || (!isImageExt && previewState.type === 'video');
            const count = `${previewState.currentIndex + 1} / ${previewState.urls.length}`;
            const ACCENT = '#7B7FF2';
            const ACCENT_DARK = '#666AD1';

            previewState.overlay.innerHTML = `
                <div id="amz-overlay-bg" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.92); z-index:2147483647; display:flex; align-items:center; justify-content:center; flex-direction:column; font-family: Inter, -apple-system, system-ui, sans-serif; backdrop-filter: blur(8px);">
                    <button id="amz-preview-close" style="position:absolute; top:20px; right:20px; border:none; background:rgba(255,255,255,0.1); width:44px; height:44px; border-radius:50%; color:white; cursor:pointer; font-size:24px; display:flex; align-items:center; justify-content:center; transition:background 0.2s; z-index:10;">&times;</button>
                    
                    ${previewState.urls.length > 1 ? `
                        <button id="amz-preview-prev" style="position:absolute; left:20px; top:50%; transform:translateY(-50%); border:none; background:rgba(255,255,255,0.08); width:56px; height:56px; border-radius:50%; color:white; cursor:pointer; font-size:28px; transition:all 0.2s; display:flex; align-items:center; justify-content:center; z-index:10;">&#10094;</button>
                        <button id="amz-preview-next" style="position:absolute; right:20px; top:50%; transform:translateY(-50%); border:none; background:rgba(255,255,255,0.08); width:56px; height:56px; border-radius:50%; color:white; cursor:pointer; font-size:28px; transition:all 0.2s; display:flex; align-items:center; justify-content:center; z-index:10;">&#10095;</button>
                    ` : ''}
                    
                    <div style="position:absolute; top:25px; left:50%; transform:translateX(-50%); color:white; background:rgba(255,255,255,0.1); padding:7px 18px; border-radius:30px; font-size:13px; font-weight:600; letter-spacing:0.5px; z-index:10; display:flex; align-items:center; gap:15px;">
                        <span>${count}</span>
                        ${!isVideo ? `
                            <div style="width:1px; height:12px; background:rgba(255,255,255,0.2);"></div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <button id="amz-zoom-out" style="background:none; border:none; color:white; cursor:pointer; padding:0 5px; font-size:18px; font-weight:bold; line-height:1;">-</button>
                                <span id="amz-zoom-level" style="min-width:40px; text-align:center;">100%</span>
                                <button id="amz-zoom-in" style="background:none; border:none; color:white; cursor:pointer; padding:0 5px; font-size:18px; font-weight:bold; line-height:1;">+</button>
                            </div>
                        ` : ''}
                    </div>
                    
                    <div id="amz-preview-container" style="max-width:92%; max-height:82%; display:flex; align-items:center; justify-content:center; animation: amzFadeIn 0.3s ease-out; overflow:hidden; border-radius:12px;">
                        ${isVideo ?
                    `<video src="${url}" controls autoPlay muted loop style="max-width:100%; max-height:84vh; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.7); outline:none; transition: transform 0.3s cubic-bezier(0.2, 0, 0.2, 1);"></video>` :
                    `<img src="${url}" style="max-width:100%; max-height:84vh; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.7); object-fit:contain; cursor: zoom-in; transition: transform 0.3s cubic-bezier(0.2, 0, 0.2, 1); transform: scale(1);">`
                }
                    </div>
                    
                    <button id="amz-preview-download" style="position:absolute; bottom:35px; left:50%; transform:translateX(-50%); background:linear-gradient(135deg, ${ACCENT_DARK} 0%, ${ACCENT} 100%); border:none; padding:12px 28px; border-radius:35px; color:white; font-weight:700; font-size:14px; cursor:pointer; box-shadow:0 8px 25px rgba(123, 127, 242, 0.4); display:flex; align-items:center; gap:10px; transition:all 0.3s; z-index:10;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Download Media
                    </button>

                    <style>
                        @keyframes amzFadeIn { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
                        #amz-preview-close:hover { background: rgba(255,255,255,0.2) !important; transform: scale(1.1); }
                        #amz-preview-prev:hover, #amz-preview-next:hover { background: rgba(255,255,255,0.2) !important; transform: translateY(-50%) scale(1.1); }
                        #amz-preview-download:hover { transform: translateX(-50%) scale(1.05); box-shadow: 0 10px 30px rgba(123, 127, 242, 0.5); }
                    </style>
                </div>
            `;

            document.getElementById('amz-overlay-bg')?.addEventListener('click', (e) => {
                if (e.target === e.currentTarget) closeIntegratedPreview();
            });

            document.getElementById('amz-preview-close')?.addEventListener('click', closeIntegratedPreview);
            document.getElementById('amz-preview-prev')?.addEventListener('click', (e) => { e.stopPropagation(); navigateIntegratedPreview('prev'); });
            document.getElementById('amz-preview-next')?.addEventListener('click', (e) => { e.stopPropagation(); navigateIntegratedPreview('next'); });

            document.getElementById('amz-zoom-in')?.addEventListener('click', (e) => { e.stopPropagation(); adjustIntegratedZoom(0.25); });
            document.getElementById('amz-zoom-out')?.addEventListener('click', (e) => { e.stopPropagation(); adjustIntegratedZoom(-0.25); });

            document.querySelector('#amz-preview-container img')?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (previewState.zoom > 1) previewState.zoom = 1;
                else previewState.zoom = 2;
                adjustIntegratedZoom(0);
            });

            document.getElementById('amz-overlay-bg')?.addEventListener('wheel', (e) => {
                if (previewState.type === 'video') return;
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.25 : 0.25;
                adjustIntegratedZoom(delta);
            }, { passive: false });

            document.getElementById('amz-preview-download')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const downloadUrl = previewState.urls[previewState.currentIndex];
                browser.runtime.sendMessage({
                    type: 'DOWNLOAD_SINGLE',
                    url: downloadUrl,
                    mediaType: isVideo ? 'video' : 'image'
                });
            });
        }

        function showIntegratedPreview(url: string, type: 'image' | 'video', urls: string[]) {
            previewState.urls = urls;
            previewState.currentIndex = Math.max(0, urls.indexOf(url));
            previewState.type = type;
            previewState.zoom = 1;

            if (!previewState.overlay) {
                previewState.overlay = document.createElement('div');
                previewState.overlay.id = 'amz-image-preview-overlay';
                previewState.overlay.style.all = 'initial';
                document.body.appendChild(previewState.overlay);
                document.addEventListener('keydown', handlePreviewKeyDown);
                document.body.style.overflow = 'hidden';
            }
            renderIntegratedPreview();
        }

        // ============================================
        // NAVIGATION LISTENER
        // ============================================

        function startNavigationListener() {
            setInterval(() => {
                const currentUrl = window.location.href;
                const currentAsin = getCurrentAsin();

                if (currentUrl !== lastUrl) {
                    lastUrl = currentUrl;

                    if (currentAsin && currentAsin !== lastAsin) {
                        console.log('AMZImage: Navigation detected', { from: lastAsin, to: currentAsin });
                        lastAsin = currentAsin;
                        productReviewAsin = currentAsin;

                        // Clear caches for new product
                        cachedVariants = [];
                        prefetchedAsin = '';
                        prefetchedReviewImages = [];
                        prefetchedReviewVideos = [];

                        notifyContentChange('product_changed');
                        prefetchReviewMedia();
                    }
                }
            }, 1000);
        }

        // ============================================
        // MUTATION OBSERVER
        // ============================================

        function setupVariantObserver() {
            const observeTargets = [
                '#imageBlock', '#altImages', '#twister', '#landingImage', '#ASIN'
            ];

            const observer = new MutationObserver((mutations) => {
                const currentAsin = getCurrentAsin();

                for (const mutation of mutations) {
                    // ASIN changed
                    if (mutation.type === 'attributes' && mutation.attributeName === 'value' &&
                        (mutation.target as HTMLElement).id === 'ASIN') {
                        const newAsin = (mutation.target as HTMLInputElement).value;
                        if (newAsin && newAsin !== lastAsin) {
                            lastAsin = newAsin;

                            // Update selected state in cached variants
                            if (cachedVariants.length > 0) {
                                cachedVariants = cachedVariants.map(v => ({
                                    ...v,
                                    selected: v.asin === newAsin
                                }));
                                notifyContentChange('variant_selected');
                            }
                        }
                    }
                }
            });

            observeTargets.forEach(selector => {
                const element = document.querySelector(selector);
                if (element) {
                    observer.observe(element, {
                        attributes: true,
                        childList: true,
                        subtree: true,
                        attributeFilter: ['src', 'value', 'class']
                    });
                }
            });

            lastAsin = getCurrentAsin();
        }

        // ============================================
        // MESSAGE LISTENER
        // ============================================

        browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if (message.type === 'GET_FULL_DATA') {
                scrapeProductData(message.triggerScroll).then(sendResponse).catch(e => {
                    console.error('Async scrape error:', e);
                    sendResponse(null);
                });
                return true;
            }

            if (message.type === 'GET_IMAGES') {
                scrapeProductData().then(data => {
                    const allImages = [...data.productImages, ...data.reviewImages];
                    if (data.pageType === 'listing') {
                        data.listingProducts.forEach(p => {
                            if (p.image && !allImages.includes(p.image)) allImages.push(p.image);
                        });
                    }
                    sendResponse({ images: allImages });
                });
                return true;
            }

            if (message.type === 'SHOW_PREVIEW') {
                showIntegratedPreview(message.url, message.mediaType, message.urls);
                sendResponse({ success: true });
            }

            if (message.type === 'GET_VARIANT_MEDIA') {
                const asin = message.asin;
                getVariantMedia(asin).then(media => {
                    sendResponse({ images: media.images, videos: media.videos });
                });
                return true;
            }

            if (message.type === 'SELECT_VARIANT') {
                try {
                    const asin = message.asin;
                    const selectors = [
                        `li[data-defaultasin="${asin}"]`,
                        `li[data-asin="${asin}"]`,
                        `div[data-asin="${asin}"]`,
                        `[data-defaultasin="${asin}"]`
                    ];

                    let target: HTMLElement | null = null;
                    for (const sel of selectors) {
                        target = document.querySelector<HTMLElement>(sel);
                        if (target) break;
                    }

                    if (target) {
                        const wrapper = target.closest('li, div.a-button-toggle');
                        if (wrapper) {
                            const link = wrapper.querySelector('a, button, input');
                            if (link) (link as HTMLElement).click();
                            else target.click();
                        } else {
                            target.click();
                        }
                        sendResponse({ success: true });
                    } else {
                        window.location.href = `/dp/${asin}`;
                        sendResponse({ success: true });
                    }
                } catch (e) {
                    console.error("Error selecting variant", e);
                    sendResponse({ success: false });
                }
            }

            if (message.type === 'FORCE_ENRICH_ALL') {
                loadAllVariantMedia().then(() => {
                    sendResponse({ status: 'complete' });
                    notifyContentChange('variants_loaded');
                });
                return true;
            }

            return false;
        });

        // ============================================
        // INITIALIZATION
        // ============================================

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(setupVariantObserver, 100);
                prefetchReviewMedia(); // Immediate trigger
                if (isProductPage()) {
                    loadAllVariantMedia(); // Immediate
                }
            });
        } else {
            setTimeout(setupVariantObserver, 100);
            prefetchReviewMedia(); // Immediate trigger
            if (isProductPage()) {
                loadAllVariantMedia(); // Immediate
            }
        }

        startNavigationListener();
    }
});