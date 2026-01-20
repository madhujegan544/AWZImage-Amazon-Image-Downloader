

import { scrapeVariants, VariantItem } from '../utils/variantScraper';

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
    activeImage: string; // Added field
    productImages: string[];
    variantImages?: Record<string, string[]>; // Images for each variant (Name -> Images)
    variantImagesByAsin?: Record<string, string[]>; // Images for each variant (ASIN -> Images)
    reviewImages: string[];
    videos: string[];        // Product videos (from manufacturer/seller)
    reviewVideos: string[];  // Customer review videos
    // For listing pages
    listingProducts: ProductItem[];
}

export default defineContentScript({
    matches: [
        '*://*.amazon.com/*',
        '*://*.amazon.co.uk/*',
        '*://*.amazon.de/*',
        '*://*.amazon.co.jp/*',
        '*://*.amazon.in/*',
    ],
    main() {
        console.log('AMZImage Content Script Loaded');

        let lastMainImageSrc = '';
        let lastAsin = '';
        let lastUrl = window.location.href;
        let refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
        let navigationCheckInterval: ReturnType<typeof setInterval> | null = null;
        let isHoveringVariant = false; // Moved to global scope for scraper access

        // Poll for URL/ASIN changes (handle SPA navigation)
        function startNavigationListener() {
            if (navigationCheckInterval) clearInterval(navigationCheckInterval);

            navigationCheckInterval = setInterval(() => {
                const currentUrl = window.location.href;
                const currentAsin = getCurrentAsin();

                // Check if we navigated to a new page/product
                if (currentUrl !== lastUrl) {
                    lastUrl = currentUrl;

                    // If ASIN changed, it's definitely a new product
                    if (currentAsin && currentAsin !== lastAsin) {
                        console.log('AMZImage: Navigation detected', { from: lastAsin, to: currentAsin });
                        lastAsin = currentAsin;
                        lastMainImageSrc = ''; // Reset so we detect new images
                        notifyContentChange('product_changed');
                    }
                }
            }, 1000);
        }

        startNavigationListener();

        // Integrated Website-Wide Preview Modal State
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
                // Also remove the body blur if any
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
            previewState.zoom = 1; // Reset zoom on navigation
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
            const isVideo = url.toLowerCase().match(/\.(mp4|webm|ogg|m3u8|mpd)($|\?)/) || previewState.type === 'video';
            const count = `${previewState.currentIndex + 1} / ${previewState.urls.length}`;
            const ACCENT = '#7B7FF2';
            const ACCENT_DARK = '#666AD1';

            previewState.overlay.innerHTML = `
                <div id="amz-overlay-bg" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.92); z-index:2147483647; display:flex; align-items:center; justify-content:center; flex-direction:column; font-family: Inter, -apple-system, system-ui, sans-serif; backdrop-filter: blur(8px);">
                    <!-- Close Button -->
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
                        #amz-preview-close:hover, #amz-preview-prev:hover, #amz-preview-next:hover { background: rgba(255,255,255,0.2) !important; transform:${previewState.urls.length > 1 ? 'translateY(-50%)' : ''} scale(1.05); }
                        #amz-preview-download:hover { transform: translateX(-50%) scale(1.05); box-shadow: 0 10px 30px rgba(123, 127, 242, 0.5); }
                        #amz-preview-download:active { transform: translateX(-50%) scale(0.98); }
                    </style>
                </div>
            `;

            // Close when clicking background
            document.getElementById('amz-overlay-bg')?.addEventListener('click', (e) => {
                if (e.target === e.currentTarget) closeIntegratedPreview();
            });

            document.getElementById('amz-preview-close')?.addEventListener('click', closeIntegratedPreview);
            document.getElementById('amz-preview-prev')?.addEventListener('click', (e) => { e.stopPropagation(); navigateIntegratedPreview('prev'); });
            document.getElementById('amz-preview-next')?.addEventListener('click', (e) => { e.stopPropagation(); navigateIntegratedPreview('next'); });

            document.getElementById('amz-zoom-in')?.addEventListener('click', (e) => { e.stopPropagation(); adjustIntegratedZoom(0.25); });
            document.getElementById('amz-zoom-out')?.addEventListener('click', (e) => { e.stopPropagation(); adjustIntegratedZoom(-0.25); });

            // Toggle zoom on image click
            document.querySelector('#amz-preview-container img')?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (previewState.zoom > 1) previewState.zoom = 1;
                else previewState.zoom = 2;
                adjustIntegratedZoom(0); // Trigger update
            });

            // Mouse wheel zoom
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

            if (!previewState.overlay) {
                previewState.overlay = document.createElement('div');
                previewState.overlay.id = 'amz-image-preview-overlay';
                previewState.overlay.style.all = 'initial'; // Reset styles for this container
                document.body.appendChild(previewState.overlay);
                document.addEventListener('keydown', handlePreviewKeyDown);
                document.body.style.overflow = 'hidden'; // Prevent scrolling background
            }
            renderIntegratedPreview();
        }

        // Helper to notify panel of content changes
        function notifyContentChange(reason: string) {
            if (refreshDebounceTimer) {
                clearTimeout(refreshDebounceTimer);
            }
            refreshDebounceTimer = setTimeout(() => {
                browser.runtime.sendMessage({
                    type: 'CONTENT_CHANGED',
                    reason,
                    url: window.location.href
                }).catch(() => {
                    // Ignore if panel not open
                });
            }, 300); // Debounce to avoid rapid-fire updates
        }

        // Get current ASIN from URL or hidden input (most reliable)
        function getCurrentAsin(): string {
            // Priority 1: Hidden ASIN input (source of truth for selected variant)
            const asinInput = (document.getElementById('ASIN') || document.getElementById('asin')) as HTMLInputElement;
            if (asinInput && asinInput.value) return asinInput.value;

            // Priority 2: URL path
            const match = window.location.pathname.match(/\/dp\/([A-Z0-9]{10})/i) ||
                window.location.pathname.match(/\/gp\/product\/([A-Z0-9]{10})/i) ||
                window.location.pathname.match(/\/product-reviews\/([A-Z0-9]{10})/i);

            if (match) return match[1];

            // Priority 3: Data attribute on body or main container
            const bodyAsin = document.body.getAttribute('data-asin');
            if (bodyAsin) return bodyAsin;

            return '';
        }

        // Watch for variant/image changes using MutationObserver
        function setupVariantObserver() {
            // Track mouse interactions on twister/variants
            const twister = document.querySelector('#twister, #variation_color_name, #variation_size_name, #variation_style_name');
            if (twister) {
                twister.addEventListener('mouseover', (e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest('li[data-asin], .swatchAvailable, .imgSwatch')) {
                        isHoveringVariant = true;
                    }
                }, { passive: true });
                twister.addEventListener('mouseout', (e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest('li[data-asin], .swatchAvailable, .imgSwatch')) {
                        isHoveringVariant = false;
                    }
                }, { passive: true });
            }

            // Elements to watch for changes
            const observeTargets = [
                '#imageBlock', '#altImages', '#twister', '#landingImage', '#ASIN',
                '#customer-reviews', '#customerReviews', '#cm_cr-review_list', '.cr-media-gallery',
                '[data-hook="review-image-tile"]', '.review-video-container'
            ];

            const observer = new MutationObserver((mutations) => {
                let shouldNotify = false;
                let reason = 'dom_change';

                // Check ASIN first as it's the strongest indicator
                const currentAsin = getCurrentAsin();
                if (currentAsin && currentAsin !== lastAsin) {
                    console.log('AMZImage: ASIN changed from', lastAsin, 'to', currentAsin);
                    lastAsin = currentAsin;
                    lastMainImageSrc = ''; // Force image refresh detection for the new ASIN
                    shouldNotify = true;
                    reason = 'asin_changed';
                }

                for (const mutation of mutations) {
                    if (shouldNotify) break; // Already decided to notify

                    // Check for main image source change (Landing Image)
                    if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
                        const target = mutation.target as HTMLImageElement;
                        if (target.id === 'landingImage' || target.closest('#landingImage')) {
                            const newSrc = target.src;
                            if (newSrc && newSrc !== lastMainImageSrc && !newSrc.includes('data:')) {
                                // CRITICAL: Ignore image changes if we are hovering (preview mode)
                                // OR if the ASIN hasn't changed (standard thumbnail click)
                                // Unless the ASIN actually changed, we don't want to re-scrape everything on hover.
                                if (!isHoveringVariant && currentAsin === lastAsin) {
                                    // This might be a manual thumbnail click within the same variant
                                    lastMainImageSrc = newSrc;
                                    shouldNotify = true;
                                    reason = 'image_selection_changed';
                                } else if (currentAsin !== lastAsin) {
                                    // Fallback for when ASIN change wasn't detected yet
                                    lastAsin = currentAsin;
                                    lastMainImageSrc = newSrc;
                                    shouldNotify = true;
                                    reason = 'variant_image_changed';
                                }
                            }
                        }
                    }

                    // Check for value change on hidden ASIN input
                    if (mutation.type === 'attributes' && mutation.attributeName === 'value' && (mutation.target as HTMLElement).id === 'ASIN') {
                        const newAsin = (mutation.target as HTMLInputElement).value;
                        if (newAsin && newAsin !== lastAsin) {
                            lastAsin = newAsin;
                            shouldNotify = true;
                            reason = 'asin_input_changed';
                        }
                    }

                    // Check for class changes (permanent variant selection changes)
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        const target = mutation.target as HTMLElement;
                        // Only trigger if it's a permanent selection class, not a hover class
                        if (target.classList.contains('swatchSelect') ||
                            target.classList.contains('selected') ||
                            target.getAttribute('aria-selected') === 'true' ||
                            target.getAttribute('aria-checked') === 'true') {

                            // Verify it's in a variant container
                            if (target.closest('#twister') || target.closest('[id*="variation_"]')) {
                                shouldNotify = true;
                                reason = 'variant_permanently_selected';
                            }
                        }
                    }

                    // Check for new image nodes added (lazy loading review images, etc.)
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        mutation.addedNodes.forEach((node) => {
                            if (node instanceof HTMLElement) {
                                // Only notify for new review/gallery images, not variant previews
                                if (!node.closest('#twister') && (node.tagName === 'IMG' || node.querySelector('img'))) {
                                    shouldNotify = true;
                                    reason = 'new_media_loaded';
                                }
                            }
                        });
                    }
                }

                if (shouldNotify) {
                    notifyContentChange(reason);
                }
            });

            // Start observing each target
            observeTargets.forEach(selector => {
                const element = document.querySelector(selector);
                if (element) {
                    observer.observe(element, {
                        attributes: true,
                        childList: true,
                        subtree: true,
                        attributeFilter: ['src', 'data-a-dynamic-image', 'data-src', 'class', 'aria-checked']
                    });
                }
            });

            // Also observe the document body for major layout changes
            observer.observe(document.body, {
                childList: true,
                subtree: false
            });

            // Store initial main image
            const mainImg = document.querySelector<HTMLImageElement>('#landingImage');
            if (mainImg?.src) {
                lastMainImageSrc = mainImg.src;
            }
            lastAsin = getCurrentAsin();

            console.log('AMZImage: Variant observer initialized');
        }

        // Prefetch cache for review media
        let prefetchedReviewImages: string[] = [];
        let prefetchedReviewVideos: string[] = [];
        let prefetchedAsin = '';

        // Preemptively fetch review media as soon as page loads
        async function prefetchReviewMedia() {
            const asin = getCurrentAsin();
            if (!asin || !isProductPage()) return;
            if (asin === prefetchedAsin) return; // Already fetched for this ASIN

            console.log('AMZImage: Prefetching review media for', asin);
            prefetchedAsin = asin;

            try {
                // Fetch silently via API (no scrolling)

                // Then fetch additional pages via API
                const extra = await fetchAllReviewMedia(asin, 100);
                prefetchedReviewImages = extra.images;
                prefetchedReviewVideos = extra.videos;

                console.log('AMZImage: Prefetch complete -', prefetchedReviewImages.length, 'images,', prefetchedReviewVideos.length, 'videos');

                // Notify panel that new data is available
                if (prefetchedReviewImages.length > 0 || prefetchedReviewVideos.length > 0) {
                    notifyContentChange('prefetch_complete');
                }
            } catch (e) {
                console.warn('AMZImage: Prefetch error', e);
            }
        }

        // Initialize observer when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(setupVariantObserver, 500);
                // Start prefetching review media immediately
                setTimeout(prefetchReviewMedia, 1000);
            });
        } else {
            setTimeout(setupVariantObserver, 500);
            // Start prefetching review media immediately
            setTimeout(prefetchReviewMedia, 1000);
        }

        // Listen for messages from background script and sidepanel
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
                }).catch(e => {
                    sendResponse({ images: [] });
                });
                return true;
            }

            if (message.type === 'SHOW_PREVIEW') {
                showIntegratedPreview(message.url, message.mediaType, message.urls);
                sendResponse({ success: true });
            }

            if (message.type === 'SELECT_VARIANT') {
                try {
                    const asin = message.asin;
                    // Try multiple selectors to find the variant on page (including unavailable ones)
                    const selectors = [
                        `li[data-defaultasin="${asin}"]`,
                        `li[data-asin="${asin}"]`,
                        `div[data-asin="${asin}"]`,
                        `span[data-asin="${asin}"] .a-button-input`,
                        // Additional selectors for unavailable/out-of-stock variants
                        `li[data-defaultasin="${asin}"].swatchUnavailable`,
                        `li[data-asin="${asin}"].swatchUnavailable`,
                        `[data-defaultasin="${asin}"]`,
                        `[id*="${asin}"]`
                    ];

                    let target: HTMLElement | null = null;
                    for (const sel of selectors) {
                        target = document.querySelector<HTMLElement>(sel);
                        if (target) break;
                    }

                    if (target) {
                        // If it's an input inside a label/button
                        if (target.tagName !== 'BUTTON' && target.tagName !== 'A') {
                            const wrapper = target.closest('li, div.a-button-toggle');
                            if (wrapper) {
                                // Check for nested link or button
                                const link = wrapper.querySelector('a, button, input');
                                if (link) (link as HTMLElement).click();
                                else target.click();
                            } else {
                                target.click();
                            }
                        } else {
                            target.click();
                        }
                        sendResponse({ success: true });
                    } else {
                        // Fallback: Navigate directly to the product page for this ASIN
                        // This handles out-of-stock variants that aren't clickable
                        console.warn('Variant element not found for ASIN, navigating to product page:', asin);
                        window.location.href = `/dp/${asin}`;
                        sendResponse({ success: true });
                    }
                } catch (e) {
                    console.error("Error selecting variant", e);
                    sendResponse({ success: false });
                }
            }

            return false;
        });



        function isProductPage(): boolean {
            const url = window.location.pathname;
            return url.includes('/dp/') || url.includes('/gp/product/') || url.includes('/product-reviews/');
        }

        function isListingPage(): boolean {
            const url = window.location.href;
            // Search results, category pages, deals pages
            return url.includes('/s?') ||
                url.includes('/s/') ||
                url.includes('/b/') ||
                url.includes('/b?') ||
                url.includes('/deals') ||
                url.includes('/gp/browse') ||
                url.includes('/gp/bestsellers') ||
                document.querySelector('.s-main-slot') !== null;
        }

        function scrapeListingProducts(): ProductItem[] {
            const products: ProductItem[] = [];
            const seenAsins = new Set<string>();

            // Select all product cards in search results - expanded selectors for various layouts
            const productCards = document.querySelectorAll<HTMLElement>(
                '[data-asin]:not([data-asin=""]), ' +
                '.s-result-item[data-asin], ' +
                '.a-section.octopus-pc-item, ' +
                '.deal-card, ' +
                '.gridItem, ' +
                '[data-component-type="s-search-result"], ' +
                '.sg-col-inner .a-section'
            );

            productCards.forEach((card) => {
                const asin = card.getAttribute('data-asin') || '';

                // Skip empty ASINs, ads, or already processed items
                if (!asin || seenAsins.has(asin)) return;

                // Skip ad placements
                if (card.querySelector('.s-sponsored-label-info-icon') ||
                    card.classList.contains('AdHolder')) return;

                // Get product image - try multiple selectors
                let img = card.querySelector<HTMLImageElement>(
                    'img.s-image, ' +
                    'img[data-image-latency], ' +
                    '.s-product-image-container img, ' +
                    '.s-image-optimized-rendering img, ' +
                    '.a-dynamic-image, ' +
                    'img[data-a-dynamic-image]'
                );

                let imageUrl = '';

                // 1. Try data-a-dynamic-image (highest quality)
                const dynamicImgData = img?.getAttribute('data-a-dynamic-image');
                if (dynamicImgData) {
                    try {
                        const dynamicImages = JSON.parse(dynamicImgData);
                        const urls = Object.keys(dynamicImages);
                        if (urls.length > 0) {
                            // Sort by size (width * height) descending
                            imageUrl = urls.sort((a, b) => {
                                const [w1, h1] = dynamicImages[a];
                                const [w2, h2] = dynamicImages[b];
                                return (w2 * h2) - (w1 * h1);
                            })[0];
                        }
                    } catch (e) {
                        // Ignore
                    }
                }

                // 2. Try srcset (get largest)
                if (!imageUrl && img?.srcset) {
                    const candidates = img.srcset.split(',').map(s => {
                        const parts = s.trim().split(' ');
                        return { url: parts[0], size: parts[1] ? parseFloat(parts[1]) : 1 };
                    });
                    const best = candidates.sort((a, b) => b.size - a.size)[0];
                    if (best) imageUrl = best.url;
                }

                // 3. Fallback to src or data-src
                if (!imageUrl) {
                    imageUrl = img?.src || img?.getAttribute('data-src') || img?.getAttribute('data-image-source') || '';
                }

                // 4. Handle placeholders
                if (imageUrl && (imageUrl.includes('grey-pixel') || imageUrl.includes('transparent') || imageUrl.startsWith('data:'))) {
                    imageUrl = img?.getAttribute('data-src') || img?.getAttribute('data-image-source') || '';
                }

                // 5. Clean URL (remove size constraints to get full resolution)
                if (imageUrl && imageUrl.startsWith('http')) {
                    // Remove ._AC_..._. pattern
                    imageUrl = imageUrl.replace(/\._AC_[a-zA-Z0-9]+_\./, '.');
                    // Remove ._S..._. pattern (like _SX300_, _SY400_)
                    imageUrl = imageUrl.replace(/\._[a-zA-Z]+[0-9]+_\./, '.');
                }

                // Get product title - try multiple selectors
                const titleEl = card.querySelector<HTMLElement>(
                    'h2 a span, ' +
                    'h2 span.a-text-normal, ' +
                    '.a-size-base-plus.a-color-base.a-text-normal, ' +
                    '.a-link-normal .a-text-normal, ' +
                    '[data-cy="title-recipe"] span'
                );
                const title = titleEl?.textContent?.trim() || '';

                // Get price - try multiple selectors
                // Removed generic .a-color-base.a-text-normal which was capturing titles
                const priceEl = card.querySelector<HTMLElement>(
                    '.a-price .a-offscreen, ' +
                    '.a-price-whole, ' +
                    '[data-cy="price-recipe"] .a-offscreen'
                );
                let price = priceEl?.textContent?.trim() || '';

                // Validate price: must be short and contain numbers
                if (price.length > 20 || !/[0-9]/.test(price)) {
                    price = '';
                }

                // Get rating
                const ratingEl = card.querySelector<HTMLElement>(
                    '.a-icon-star-small .a-icon-alt, ' +
                    '.a-icon-star .a-icon-alt, ' +
                    '[data-cy="reviews-ratings-slot"] .a-icon-alt'
                );
                const rating = ratingEl?.textContent?.trim() || '';

                // Only add if we have valid data
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

            console.log(`AMZImage: Found ${products.length} products on listing page`);
            console.log(`AMZImage: Found ${products.length} products on listing page`);
            return products;
        }

        // scrapeVariants is now imported from utils/variantScraper.ts

        // =========================================================================
        // MEDIA NORMALIZATION & VALIDATION HELPERS
        // =========================================================================

        function getImageBase(url: string): string {
            // UNIFIED PATTERN: Only capture alphanumeric characters (the core ID)
            // This matches variantScraper.ts and PanelApp.tsx for consistent deduplication
            const match = url.match(/images\/I\/([A-Za-z0-9]+)/);
            return match ? match[1] : url;
        }

        function toHighRes(url: string): string {
            if (!url) return '';
            return url
                .replace(/\._[A-Z]{2}_[A-Za-z0-9,_]+_\./, '.')
                .replace(/\._AC_.*_\./, '.')
                .replace(/\._S[A-Z0-9]+_\./, '.')
                .replace(/\._U[A-Z0-9]+_\./, '.')
                .replace(/\._CR[0-9,]+_\./, '.')
                .replace(/\._X[A-Z0-9]+_\./, '.');
        }

        function isValidImage(url: string | null | undefined): boolean {
            if (!url || !url.startsWith('http')) return false;
            const lowerUrl = url.toLowerCase();
            if (lowerUrl.includes('.svg')) return false;

            const unwantedKeywords = [
                'sprite', 'transparent', 'pixel', 'placeholder', 'loader', 'loading',
                'icon', 'logo', 'button', 'overlay', 'zoom', 'magnifier', 'plus', 'minus',
                'caret', 'arrow', 'chevron', 'star', 'rating', 'badge', 'play-button',
                'reviews-image-gallery-loading', 'nav-sprite', 'details-gallery-view',
                'x-locale', 'maximize', 'minimize', 'remove', 'close', 'delete',
                'spin', '360_icon', '360-icon', 'view_full', 'cursor', 'selector',
                'play-icon', 'video-icon', 'images/g/', 'common',
                'zoom-in', 'zoom-out', 'flyout', 'ui-element'
            ];

            if (unwantedKeywords.some(kw => lowerUrl.includes(kw))) return false;
            if (lowerUrl.includes('profile') || lowerUrl.includes('avatar')) return false;
            return true;
        }

        function isCustomerReviewImage(url: string, contextElement?: Element | null): boolean {
            const lowerUrl = url.toLowerCase();
            const customerUrlPatterns = [
                'customer-images', 'customerimages', 'customer_images', 'customer-image',
                'customerimage', 'customer_image', 'usermedia', 'user-media', 'user_media',
                'user-content', 'usercontent', 'user_content', 'ugc', 'review-image',
                'reviewimage', 'review_image', 'cm_cr', 'crwidget', 'cr-media'
            ];

            if (customerUrlPatterns.some(pattern => lowerUrl.includes(pattern))) return true;

            if (contextElement) {
                const reviewContainers = [
                    '#customer-reviews', '#customerReviews', '#cm_cr-review_list',
                    '[data-hook*="review"]', '.review', '.cr-widget', '.cr-media-gallery',
                    '[data-hook="cr-media-gallery"]', '.review-image-container',
                    '[data-hook="review-image-tile"]', '[id*="review-image-gallery"]',
                    '[class*="review-media-gallery"]', '.cr-media-gallery'
                ];
                if (reviewContainers.some(selector => contextElement.closest(selector))) return true;
            }

            if (lowerUrl.includes('/images/i/') && (lowerUrl.includes('._cr') || lowerUrl.includes('cr_'))) return true;
            return false;
        }

        function isPromotionalContent(content: string, url: string): boolean {
            const lowerContent = content.toLowerCase();
            const lowerUrl = url.toLowerCase();
            const patterns = [
                'similar brands', 'similarbrand', 'competitor', 'compare-with', 'other-brands',
                'related-brand', 'sponsored', 'advertisement', 'adplaceholder', 'ad-holder',
                'sp_detail', 'brand-video', 'brand-story', 'brand-snapshot', 'from-the-brand',
                'explore-brand', 'aplus-module', 'enhanced-brand', 'third-party', 'external-video',
                'similarities', 'comparison-widget', 'also-viewed', 'frequently-bought',
                'shoppable-video', 'influencer', 'amazon-influence', 'curated', 'bought-together'
            ];
            return patterns.some(p => lowerContent.includes(p) || lowerUrl.includes(p));
        }

        function isOfficialProductVideo(content: string, url: string): boolean {
            if (isPromotionalContent(content, url)) return false;
            const lowerUrl = url.toLowerCase();
            const exclude = ['brand', 'sponsor', 'advertisement', 'promo', 'similar', 'compare', 'thirdparty', 'external'];
            if (exclude.some(p => lowerUrl.includes(p))) return false;

            const official = [
                'product-video', 'product_video', 'main-video', 'gallery-video', 'detail-video',
                'dp-video', 'landing-video', 'primary-video', 'image-block', 'alt-images',
                'iv-main', 'color-images', 'vse-video'
            ];

            const urlIndex = content.indexOf(url);
            if (urlIndex >= 0) {
                const context = content.substring(Math.max(0, urlIndex - 600), Math.min(content.length, urlIndex + 600)).toLowerCase();
                if (official.some(p => context.includes(p))) return true;
                const suspicious = ['brand', 'story', 'similar', 'compare', 'related', 'also', 'other', 'sponsor', 'ad'];
                if (suspicious.some(p => context.includes(p))) return false;
            }
            return lowerUrl.includes('product-video') || lowerUrl.includes('official-video');
        }

        function getVideoId(url: string): string {
            try {
                return new URL(url).pathname;
            } catch (e) {
                return url.split('?')[0];
            }
        }

        function isReviewVideoContext(content: string, url: string): boolean {
            if (isPromotionalContent(content, url)) return false;
            const lowerContent = content.toLowerCase();
            const reviewPatterns = [
                'customer-review', 'customerreview', 'review-video', 'ugc', 'usermedia',
                'cr-media', 'crwidget', 'review media', 'customer images', 'perfect',
                'shade', 'quality', 'texture', 'scent', 'size', 'purchase', 'reviewer'
            ];
            if (reviewPatterns.some(p => lowerContent.includes(p))) {
                const productPatterns = ['product-video', 'image-block', 'alt-images', 'color-images', 'iv-main'];
                if (!productPatterns.some(p => lowerContent.includes(p))) return true;
            }
            return false;
        }

        // =========================================================================

        /**
         * Previously performed page scrolling to trigger lazy loading.
         * Now a no-op; we rely on fetchAllReviewMedia for silent API-based fetching.
         */
        async function triggerReviewMediaLoad() {
            // No scrolling - keeps user experience smooth
            // Review media is fetched silently via fetchAllReviewMedia
        }

        async function fetchAllReviewMedia(asin: string, limit: number = 100): Promise<{ images: string[], videos: string[] }> {
            const allImages: string[] = [];
            const allVideos: string[] = [];
            const seenImages = new Set<string>();
            const seenVideos = new Set<string>();

            // Concurrent Fetching: Process pages in blocks for speed
            const CHUNK_SIZE = 5;
            for (let chunkStart = 1; chunkStart <= limit; chunkStart += CHUNK_SIZE) {
                const chunkEnd = Math.min(chunkStart + CHUNK_SIZE - 1, limit);
                const promises = [];

                for (let page = chunkStart; page <= chunkEnd; page++) {
                    promises.push((async (p) => {
                        try {
                            const url = `https://${window.location.hostname}/product-reviews/${asin}/?reviewerType=all_reviews&mediaType=media_reviews_only&pageNumber=${p}`;
                            const response = await fetch(url);
                            if (!response.ok) return false;
                            const html = await response.text();
                            const parser = new DOMParser();
                            const doc = parser.parseFromString(html, 'text/html');

                            const tiles = doc.querySelectorAll([
                                '.review-image-tile img',
                                '.review-image-thumbnail img',
                                '[data-hook="review-image-tile"] img',
                                '.cr-media-card img',
                                '.cr-media-thumbnail img',
                                '.a-carousel-card img'
                            ].join(', '));

                            if (tiles.length === 0 && p === 1) {
                                // Fallback for alternative layouts
                                const bodyImgs = doc.querySelectorAll('.review-image img, .review-data img');
                                bodyImgs.forEach(img => {
                                    const src = (img as HTMLImageElement).src || img.getAttribute('data-src');
                                    if (src && isValidImage(src)) {
                                        const hi = toHighRes(src);
                                        const b = getImageBase(hi);
                                        if (!seenImages.has(b)) {
                                            seenImages.add(b);
                                            allImages.push(hi);
                                        }
                                    }
                                });
                            }

                            tiles.forEach(img => {
                                const src = (img as HTMLImageElement).src || img.getAttribute('data-src');
                                if (src && src.startsWith('http') && !src.includes('avatar') && !src.includes('sprite')) {
                                    const hi = toHighRes(src);
                                    const b = getImageBase(hi);
                                    if (!seenImages.has(b)) {
                                        seenImages.add(b);
                                        allImages.push(hi);
                                    }
                                }
                            });

                            // Parse JSON attributes in the fetched doc
                            const jsonEls = doc.querySelectorAll('[data-a-carousel-options], [data-a-modal-state], [data-a-video-data]');
                            jsonEls.forEach(el => {
                                const content = el.getAttribute('data-a-carousel-options') ||
                                    el.getAttribute('data-a-modal-state') ||
                                    el.getAttribute('data-a-video-data') || '';

                                // Scan for videos (Stricter Review filtering)
                                const vMatch = content.match(/https?:\/\/[^\"\'\s,\]]+\.(mp4|m3u8|mpd|webm)[^\"\'\s,\]]*/gi);
                                if (vMatch) {
                                    vMatch.forEach(vUrl => {
                                        const clean = vUrl.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                        // Ensure it's a review video
                                        if ((clean.includes('customer') || clean.includes('review') || clean.includes('cr-media'))
                                            && !clean.includes('vss_public') && !clean.includes('aplus')) {
                                            const vid = clean.split('?')[0];
                                            if (!seenVideos.has(vid)) {
                                                seenVideos.add(vid);
                                                allVideos.push(clean);
                                            }
                                        }
                                    });
                                }

                                // Scan for images
                                const iMatch = content.match(/https?:\/\/[^\"\'\s,\]]+\.(jpg|jpeg|png|webp)[^\"\'\s,\]]*/gi);
                                if (iMatch) {
                                    iMatch.forEach(iUrl => {
                                        if (iUrl.includes('/images/I/') && !iUrl.includes('avatar') && !iUrl.includes('sprite')) {
                                            const hi = toHighRes(iUrl.replace(/\\u002F/g, '/').replace(/\\/g, ''));
                                            const b = getImageBase(hi);
                                            if (!seenImages.has(b) && isValidImage(hi)) {
                                                seenImages.add(b);
                                                allImages.push(hi);
                                            }
                                        }
                                    });
                                }
                            });

                            // Video detection in scripts
                            const scripts = doc.querySelectorAll('script:not([src])');
                            scripts.forEach(s => {
                                const c = s.textContent || '';
                                if (c.length < 50) return;

                                const vMatch = c.match(/https?:\/\/[^\"\'\s,\]\[\}]+\.(mp4|m3u8|mpd|webm)[^\"\'\s,\]\[\}]*/gi);
                                if (vMatch) {
                                    vMatch.forEach(vUrl => {
                                        const clean = vUrl.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                        if ((clean.includes('customer') || clean.includes('review') || clean.includes('cr-media'))
                                            && !clean.includes('vss_public') && !clean.includes('aplus')) {
                                            const vid = clean.split('?')[0];
                                            if (!seenVideos.has(vid)) {
                                                seenVideos.add(vid);
                                                allVideos.push(clean);
                                            }
                                        }
                                    });
                                }
                            });

                            return tiles.length > 0 || doc.querySelector('.a-pagination .a-last:not(.a-disabled)') !== null;
                        } catch (e) {
                            return false;
                        }
                    })(page));
                }

                const results = await Promise.all(promises);
                if (results.every(r => r === false)) break;
            }

            return { images: allImages, videos: allVideos };
        }

        // State to track if we've already performed the auto-scroll for the current ASIN
        let hasAutoScrolled = false;
        let lastScrapedAsin = '';
        let lastFetchedReviewAsin = '';

        async function scrapeProductData(triggerScroll: boolean = false): Promise<ProductData> {
            const productImages: string[] = [];
            const variantImagesMap: Record<string, string[]> = {};
            const variantImagesByAsin: Record<string, string[]> = {};
            const reviewImages: string[] = [];
            const videos: string[] = [];          // Product videos
            const reviewVideos: string[] = [];    // Customer review videos
            const listingProducts: ProductItem[] = [];

            // Immediately include any prefetched review media
            if (prefetchedReviewImages.length > 0) {
                reviewImages.push(...prefetchedReviewImages);
            }
            if (prefetchedReviewVideos.length > 0) {
                reviewVideos.push(...prefetchedReviewVideos);
            }

            // Detect page type
            const onProductPage = isProductPage();
            const onListingPage = isListingPage();
            const pageType = onProductPage ? 'product' : 'listing';

            // For listing pages, scrape all product images
            if (onListingPage && !onProductPage) {
                const products = scrapeListingProducts();
                listingProducts.push(...products);

                // Add all product images to productImages array
                products.forEach(p => {
                    if (p.image && !productImages.includes(p.image)) {
                        productImages.push(p.image);
                    }
                });
            }

            // Extract ASIN from URL or page (for product pages)
            let asin = getCurrentAsin();
            if (!asin) {
                const asinElement = document.querySelector('[data-asin]');
                if (asinElement) {
                    asin = asinElement.getAttribute('data-asin') || '';
                }
            }

            // Extract product title
            let title = '';
            if (onProductPage) {
                const titleElement = document.querySelector('#productTitle, #title, #cm_cr-product_info .a-text-ellipsis a');
                if (titleElement) {
                    title = titleElement.textContent?.trim() || '';
                }
            } else {
                // For listing pages, use search query or page title
                const searchQuery = new URLSearchParams(window.location.search).get('k');
                if (searchQuery) {
                    title = `Search: "${searchQuery}"`;
                } else {
                    const pageTitleEl = document.querySelector<HTMLElement>('#search .a-color-state, .a-carousel-heading');
                    title = pageTitleEl?.textContent?.trim() || 'Product Listing';
                }
            }

            // Extract variant/color info (product pages only)
            let variant = '';
            if (onProductPage) {
                const variantElement = document.querySelector('#variation_color_name .selection, #variation_size_name .selection, .twisterTextDiv.text');
                if (variantElement) {
                    variant = variantElement.textContent?.trim() || '';
                }
            }

            // 5. Scrape variants
            let variants: VariantItem[] = [];
            let scrapedVariantImages: Record<string, string[]> = {};
            let scrapedVariantImagesByAsin: Record<string, string[]> = {};

            if (onProductPage) {
                // scrapeVariants returns VariantItem[] directly
                const scrapedVariants = scrapeVariants(isHoveringVariant);
                variants = scrapedVariants;

                // Reconstruct maps from the variants array
                variants.forEach(v => {
                    if (v.images && v.images.length > 0) {
                        scrapedVariantImagesByAsin[v.asin] = v.images;
                    }
                });
            }

            // SYNC LOGIC: If we are on a specific variant page, update that variant's images 
            // with the full high-res gallery we just scraped from the main page.
            // Note: uniqueProductImages is populated later, so this sync logic needs to be moved
            // or `productImages` should be used as the source.
            // For now, we'll use `productImages` as the source for the sync.
            // This block will be executed after `productImages` is populated.

            // Extract product description (product pages only)
            let description = '';
            if (onProductPage) {
                const descElement = document.querySelector('#productDescription p, #feature-bullets, #productDescription_feature_div');
                if (descElement) {
                    description = descElement.textContent?.trim().substring(0, 300) || '';
                    if (description.length === 300) description += '...';
                }
            } else {
                description = `${listingProducts.length} products found on this page`;
            }

            // Product page specific scraping
            if (onProductPage) {
                const seenImageBases = new Set<string>();
                const seenReviewBases = new Set<string>();

                function addUniqueReviewImage(url: string, contextContent: string = ''): boolean {
                    if (!url || !isValidImage(url)) return false;

                    // STRICT: Exclude if URL or nearby context suggests promotional/unrelated content
                    if (isPromotionalContent(contextContent, url)) return false;

                    const highRes = toHighRes(url);
                    const base = getImageBase(highRes);
                    if (base && !seenReviewBases.has(base)) {
                        seenReviewBases.add(base);
                        reviewImages.push(highRes);
                        return true;
                    }
                    return false;
                }

                function addUniqueImage(url: string): boolean {
                    if (!url || !isValidImage(url)) return false;
                    const highRes = toHighRes(url);
                    const base = getImageBase(highRes);
                    if (base && !seenImageBases.has(base)) {
                        seenImageBases.add(base);
                        productImages.push(highRes);
                        return true;
                    }
                    return false;
                }

                // 1. Extract images from Scraped Variants (Source of Truth)
                // Instead of re-parsing colorImages here, we use the robust data from scrapeVariants()
                // which has already fused ASINs, Names, and Images.
                let foundVariantImages = false;

                if (variants.length > 0) {
                    variants.forEach(v => {
                        if (v.images && v.images.length > 0) {
                            // Populate maps for Panel usage
                            if (v.name) variantImagesMap[v.name] = v.images;
                            if (v.asin) variantImagesByAsin[v.asin] = v.images;

                            // If this is the active/selected variant, add its images to the main gallery
                            if (v.selected) {
                                v.images.forEach(url => addUniqueImage(url));
                                foundVariantImages = true;
                            }
                        }
                    });

                    // If no variant is explicitly selected (rare), but we have variants, 
                    // try to add images from the first available one to ensure WE SHOW SOMETHING.
                    if (!foundVariantImages && variants.some(v => v.available && v.images && v.images.length > 0)) {
                        const firstSafe = variants.find(v => v.available && v.images && v.images.length > 0);
                        if (firstSafe && firstSafe.images) {
                            firstSafe.images.forEach(url => addUniqueImage(url));
                            foundVariantImages = true;
                        }
                    }
                }

                if (foundVariantImages) {
                    console.log(`AMZImage: Populated main gallery from selected variant (${productImages.length} images).`);
                }

                // Discovery Enrichment: DISABLED to prevent variant image bleed
                // The scrapeVariants() function now handles ALL product image extraction
                // from the colorImages JSON, which provides accurate per-variant data.
                // DO NOT add fallback DOM scraping here as it causes contamination
                // from preview images, thumbnails, and other variants.

                // 5. Variant/Swatch Images - EXCLUDED to prevent bleed-over
                // We only want images mapping to the selected variant, not the option icons themselves


                // 6. Support for imageGalleryData / ImageBlockATF meta (Now handled by scrapeVariants)
                // We no longer scan globally here as it causes bleed-over.
                // Images from these scripts are now accurately mapped to ASINs in variantScraper.ts.

                console.log(`AMZImage: Found ${productImages.length} unique product images`);

                // ==========================================
                // REVIEW IMAGES - Comprehensive extraction from embedded JSON data
                // No scrolling required - all data available on page load
                // ==========================================

                const imageScripts = document.querySelectorAll('script:not([src])');
                // REVIEW IMAGES - Comprehensive extraction from embedded JSON data
                // No scrolling required - all data available on page load
                // ==========================================

                // 1. PRIMARY: Extract review images from ALL embedded script data
                // Amazon embeds review media data in multiple script tags on page load
                imageScripts.forEach(script => {
                    const content = script.textContent || '';
                    if (!content || content.length < 50) return;

                    const lowerContent = content.toLowerCase();

                    // =====================================================
                    // PATTERN GROUP 1: Review-specific data structures
                    // These are the most reliable sources for review images
                    // =====================================================

                    // Pattern 1a: Customer images array in review data
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

                    // Pattern 1b: Review images array
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

                    // Pattern 1c: Customer media gallery data
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

                    // Pattern 1d: Media customer reviews
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

                    // =====================================================
                    // PATTERN GROUP 2: CM_CR (Customer Review) data blocks
                    // Amazon's primary customer review data structure
                    // =====================================================

                    // Pattern 2a: CM_CR image URLs
                    if (lowerContent.includes('cm_cr') || lowerContent.includes('cr-media')) {
                        const crImageUrls = content.match(/https:\/\/[^"'\s,\]\[]+(?:cm_cr|cr-media|customer)[^"'\s,\]\[]*\.(jpg|jpeg|png|webp)[^"'\s,\]\[]*/gi);
                        if (crImageUrls) {
                            crImageUrls.forEach(url => {
                                url = url.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                addUniqueReviewImage(url);
                            });
                        }
                    }

                    // Pattern 2b: CR widget data
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

                    // =====================================================
                    // PATTERN GROUP 3: Review block data with images
                    // =====================================================

                    // Pattern 3a: Individual review objects with images property
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

                    // Pattern 3c: Waffle/Titan widget data (modern Amazon review gallery)
                    const waffleMatch = content.match(/"waffleConfig"\s*:\s*\{([\s\S]*?)\}/g);
                    if (waffleMatch) {
                        waffleMatch.forEach(match => {
                            const urls = match.match(/https:\/\/[^"'\s,\]\[\}]+\.(jpg|jpeg|png|webp)[^"'\s,\]\[\}]*/gi);
                            if (urls) {
                                urls.forEach(url => {
                                    url = url.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                    addUniqueReviewImage(url);
                                });
                            }
                        });
                    }

                    // Pattern 3d: Review Image Gallery Data
                    const reviewGalleryMatch = content.match(/ReviewImageGalleryData\s*:\s*(\[[\s\S]*?\])/i);
                    if (reviewGalleryMatch) {
                        try {
                            const galleryData = JSON.parse(reviewGalleryMatch[1].replace(/'/g, '"'));
                            galleryData.forEach((item: any) => {
                                const url = item.hiResUrl || item.largeUrl || item.url || '';
                                if (url) addUniqueReviewImage(url);
                            });
                        } catch (e) { }
                    }

                    // Pattern 3e: Review Media Gallery Popover Data (Most comprehensive source)
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
                        } catch (e) { }
                    }

                    // Pattern 3f: Review Images Reel/Carousel Data
                    const reelMatch = content.match(/window\.reviewMediaReel\s*=\s*(\[[\s\S]*?\]);/);
                    if (reelMatch) {
                        try {
                            const reelData = JSON.parse(reelMatch[1].replace(/'/g, '"'));
                            reelData.forEach((item: any) => {
                                const url = item.hiResUrl || item.url || '';
                                if (url) addUniqueReviewImage(url);
                                if (item.videoUrl) addReviewVideo(item.videoUrl);
                            });
                        } catch (e) { }
                    }

                    // =====================================================
                    // PATTERN GROUP 4: Image URLs with review context markers
                    // Fallback patterns for edge cases
                    // =====================================================

                    // Only if this script contains review-related content
                    if (lowerContent.includes('review') || lowerContent.includes('customer')) {
                        // Pattern 4a: Image URLs near review context
                        const allImageUrls = content.match(/"(https:\/\/[^"]+\.(jpg|jpeg|png|webp))"(?=[^"]*(?:review|customer|rating))/gi);
                        if (allImageUrls) {
                            allImageUrls.forEach(match => {
                                const urlMatch = match.match(/"(https:\/\/[^"]+)"/);
                                if (urlMatch && urlMatch[1]) {
                                    const url = urlMatch[1].replace(/\\u002F/g, '/').replace(/\\/g, '');
                                    // Additional check - must look like customer content
                                    if (isCustomerReviewImage(url, null)) {
                                        addUniqueReviewImage(url);
                                    }
                                }
                            });
                        }
                    }
                });

                // 2. Extract from visible review tiles in DOM
                const reviewImageSelectors = [
                    '[data-hook="review-image-tile"]',
                    '.review-image-tile',
                    '.review-image-thumbnail',
                    '.cr-media-gallery .cr-lightbox-image-thumbnail',
                    '#cm_cr-review_list img[data-src]',
                    '.review-image-container img',
                    '.cr-media-card-container img'
                ];

                document.querySelectorAll(reviewImageSelectors.join(', '))
                    .forEach((el) => {
                        const img = el.tagName === 'IMG' ? (el as HTMLImageElement) : el.querySelector('img');
                        if (img) {
                            const val = img.src || img.getAttribute('data-src') || '';
                            if (val) addUniqueReviewImage(val, el.parentElement?.textContent || '');
                        } else if (el.tagName === 'DIV' || el.tagName === 'A') {
                            const style = window.getComputedStyle(el);
                            const bg = style.backgroundImage;
                            if (bg && bg.startsWith('url(')) {
                                const msg = bg.replace(/^url\(['"]?/, '').replace(/['"]?\)$/, '');
                                addUniqueReviewImage(msg);
                            }
                        }
                    });

                // 3. TERTIARY: Extract from review image lightbox/modal data
                // This captures images that might be shown in expanded/modal views
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

                console.log(`AMZImage: Found ${reviewImages.length} review images`);

                // ==========================================
                // VIDEO EXTRACTION - Product & Reviews
                // ==========================================
                const seenAllVideoIds = new Set<string>();

                function getVideoId(url: string): string {
                    try {
                        const parsed = new URL(url);
                        // Use path and filename but ignore query params for uniqueness
                        return parsed.pathname;
                    } catch (e) {
                        return url.split('?')[0];
                    }
                }

                function addProductVideo(url: string): boolean {
                    if (!url || !url.startsWith('http')) return false;
                    const videoId = getVideoId(url);
                    // Prevent duplicate and overlap with review videos
                    if (!seenAllVideoIds.has(videoId)) {
                        seenAllVideoIds.add(videoId);
                        videos.push(url);
                        return true;
                    }
                    return false;
                }

                function addReviewVideo(url: string): boolean {
                    if (!url || !url.startsWith('http')) return false;
                    const videoId = getVideoId(url);
                    // Prevent duplicate and overlap with official videos
                    if (!seenAllVideoIds.has(videoId)) {
                        seenAllVideoIds.add(videoId);
                        reviewVideos.push(url);
                        return true;
                    }
                    return false;
                }

                // Helper to determine if a video is a customer review video based on context
                // COMPREHENSIVE: Capture ALL customer review videos reliably
                function isReviewVideoContext(content: string, url: string): boolean {
                    const lowerContent = content.toLowerCase();
                    const lowerUrl = url.toLowerCase();

                    // First, exclude if it's promotional/competitor content
                    if (isPromotionalContent(content, url)) {
                        return false;
                    }

                    // COMPREHENSIVE URL patterns that indicate customer review videos
                    const reviewUrlPatterns = [
                        'customer-review',
                        'customerreview',
                        'customer_review',
                        'review-video',
                        'reviewvideo',
                        'review_video',
                        'ugc-video',
                        'ugcvideo',
                        'ugc_video',
                        'ugc',
                        'user-review',
                        'userreview',
                        'user_review',
                        'user-video',
                        'uservideo',
                        'user_video',
                        'cm_cr',
                        'crwidget',
                        'cr-media',
                        'crmedia',
                        'cr_media',
                        'customer-media',
                        'customermedia'
                    ];

                    if (reviewUrlPatterns.some(pattern => lowerUrl.includes(pattern))) {
                        return true;
                    }

                    // Check context around the URL for review markers
                    const urlIndex = content.indexOf(url);
                    if (urlIndex > 0) {
                        const context = content.substring(
                            Math.max(0, urlIndex - 600),
                            Math.min(content.length, urlIndex + 600)
                        ).toLowerCase();

                        // Context patterns that indicate customer review video
                        const reviewContextPatterns = [
                            'customerreview',
                            'customer-review',
                            'customer_review',
                            'reviewvideo',
                            'review-video',
                            'review_video',
                            'usergeneratedcontent',
                            'user-generated-content',
                            'user_generated_content',
                            'ugcvideo',
                            'ugc-video',
                            'ugc_video',
                            'cm_cr-review',
                            'cm_cr_review',
                            'crwidget',
                            'cr-widget',
                            'cr-media',
                            'customerimages',
                            'customer-images',
                            'reviewmedia',
                            'review-media',
                            'perfect',
                            'shade',
                            'quality',
                            'texture',
                            'scent',
                            'size',
                            'fit',
                            'color',
                            'verified',
                            'purchase',
                            'reviewer',
                            'stars',
                            '"mediatype":"video"',
                            '"type":"review"',
                            '"reviewid"'
                        ];

                        const hasReviewContext = reviewContextPatterns.some(pattern => context.includes(pattern));

                        // MUST NOT have product/gallery video context
                        const productVideoContextPatterns = [
                            'productvideo',
                            'product-video',
                            'product_video',
                            'galleryvideo',
                            'gallery-video',
                            'gallery_video',
                            'mainvideo',
                            'main-video',
                            'main_video',
                            'imageblock',
                            'image-block',
                            'altimages',
                            'alt-images',
                            'colorimages',
                            'color-images',
                            'ivmain',
                            'iv-main'
                        ];

                        const hasProductVideoContext = productVideoContextPatterns.some(pattern => context.includes(pattern));

                        // Return true if we have review context and NO product video context
                        if (hasReviewContext && !hasProductVideoContext) {
                            return true;
                        }
                    }

                    return false;
                }

                // 1. Broad-Spectrum Scanner: SCAN ALL SCRIPTS ONCE FOR MEDIA (Aggressive Discovery)
                imageScripts.forEach(script => {
                    const scriptContent = script.textContent || '';
                    if (scriptContent.length < 50) return;

                    const lowerScript = scriptContent.toLowerCase();
                    if (lowerScript.includes('video') || lowerScript.includes('image') ||
                        lowerScript.includes('media') || lowerScript.includes('gallery')) {

                        // Look for any MP4, m3u8, mpd, or webm URLs
                        const vMatch = scriptContent.match(/https?:\/\/[^"'\s,\]\[\}]+\.(mp4|m3u8|mpd|webm)[^"'\s,\]\[\}]*/gi);
                        if (vMatch) {
                            vMatch.forEach(vUrl => {
                                const cleanUrl = vUrl.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                if (!isPromotionalContent(scriptContent, cleanUrl)) {
                                    if (isReviewVideoContext(scriptContent, cleanUrl)) addReviewVideo(cleanUrl);
                                    else if (isOfficialProductVideo(scriptContent, cleanUrl)) addProductVideo(cleanUrl);
                                }
                            });
                        }

                        // Look for high-res images in JSON arrays
                        const iMatch = scriptContent.match(/https?:\/\/[^"'\s,\]\[\}]+\.(jpg|jpeg|png|webp)[^"'\s,\]\[\}]*/gi);
                        if (iMatch) {
                            iMatch.forEach(iUrl => {
                                if (iUrl.includes('/images/I/') && !iUrl.includes('avatar') && !iUrl.includes('sprite')) {
                                    const hi = toHighRes(iUrl.replace(/\\u002F/g, '/').replace(/\\/g, ''));
                                    if (isValidImage(hi)) {
                                        if (isCustomerReviewImage(hi, script)) addUniqueReviewImage(hi, scriptContent);
                                        else addUniqueImage(hi);
                                    }
                                }
                            });
                        }
                    }
                });

                // 2. Specific Pattern Extraction
                imageScripts.forEach(script => {
                    const content = script.textContent || '';
                    if (!content || content.length < 100) return;

                    const lowerContent = content.toLowerCase();
                    if (lowerContent.includes('similar brands on amazon') ||
                        lowerContent.includes('similarbrand') ||
                        lowerContent.includes('sponsored-brand')) {
                        // Still check for review videos in these blocks, but skip product videos
                        const reviewOnlyPatterns = /"(?:customerReview|reviewVideo|ugcVideo|reviewVideoUrl)[^"]*"\s*:\s*"(https:\/\/[^"]+\.mp4[^"]*)"/gi;
                        let reviewMatch;
                        while ((reviewMatch = reviewOnlyPatterns.exec(content)) !== null) {
                            addReviewVideo(reviewMatch[1].replace(/\\u002F/g, '/').replace(/\\/g, ''));
                        }
                        return;
                    }

                    // Pattern 1: Direct MP4 URLs in various formats
                    const mp4Patterns = [
                        /"url"\s*:\s*"(https:\/\/[^"]+\.mp4[^"]*)"/g,
                        /"videoUrl"\s*:\s*"(https:\/\/[^"]+)"/g,
                        /"progressiveUrl"\s*:\s*"(https:\/\/[^"]+)"/g,
                        /"hlsUrl"\s*:\s*"(https:\/\/[^"]+\.m3u8[^"]*)"/g,
                        /"dashUrl"\s*:\s*"(https:\/\/[^"]+\.mpd[^"]*)"/g,
                    ];

                    mp4Patterns.forEach(pattern => {
                        let match;
                        while ((match = pattern.exec(content)) !== null) {
                            let url = match[1];
                            // Clean escaped characters
                            url = url.replace(/\\u002F/g, '/').replace(/\\\\/g, '/').replace(/\\/g, '');
                            if (url.includes('.mp4') || url.includes('.m3u8') || url.includes('.mpd')) {
                                // Categorize as review or product video
                                if (isReviewVideoContext(content, url)) {
                                    addReviewVideo(url);
                                } else if (isOfficialProductVideo(content, url)) {
                                    // Only add if it's an official product video (not promotional)
                                    addProductVideo(url);
                                }
                            }
                        }
                    });

                    // Pattern 2: Video manifest/config objects
                    const manifestMatch = content.match(/"videos"\s*:\s*\[([\s\S]*?)\]/);
                    if (manifestMatch) {
                        const block = manifestMatch[0];
                        const lowerBlock = block.toLowerCase();

                        // Skip if this is a promotional/similar brands video block
                        if (isPromotionalContent(block, '')) {
                            return;
                        }

                        const isReviewBlock = lowerBlock.includes('customerreview') ||
                            lowerBlock.includes('customer-review') ||
                            lowerBlock.includes('reviewvideo');
                        const videoUrls = manifestMatch[1].match(/https:\/\/[^"'\s,\]]+\.(mp4|m3u8|mpd)[^"'\s,\]]*/g);
                        if (videoUrls) {
                            videoUrls.forEach(url => {
                                url = url.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                if (isReviewBlock || isReviewVideoContext(content, url)) {
                                    addReviewVideo(url);
                                } else if (isOfficialProductVideo(block, url)) {
                                    addProductVideo(url);
                                }
                            });
                        }
                    }

                    // Pattern 3: Video data blocks
                    const videoDataMatch = content.match(/"videoData"\s*:\s*{([^}]+)}/g);
                    if (videoDataMatch) {
                        videoDataMatch.forEach(block => {
                            // Skip promotional video blocks
                            if (isPromotionalContent(block, '')) {
                                return;
                            }

                            const urlMatch = block.match(/"url"\s*:\s*"([^"]+)"/);
                            if (urlMatch) {
                                let url = urlMatch[1].replace(/\\u002F/g, '/').replace(/\\/g, '');
                                if (isReviewVideoContext(block, url)) {
                                    addReviewVideo(url);
                                } else if (isOfficialProductVideo(block, url)) {
                                    addProductVideo(url);
                                }
                            }
                        });
                    }

                    // Pattern 3b: Amazon VSE Video Data - Enhanced multi-video support
                    const vsePatterns = [
                        /"vseVideoData"\s*:\s*(\[[\s\S]*?\])(?:\s*,|\s*\})/,
                        /"vseVideoList"\s*:\s*(\[[\s\S]*?\])(?:\s*,|\s*\})/,
                        /"vseVideoItems"\s*:\s*(\[[\s\S]*?\])(?:\s*,|\s*\})/,
                        /"videoList"\s*:\s*(\[[\s\S]*?\])(?:\s*,|\s*\})/
                    ];

                    vsePatterns.forEach(regex => {
                        const vMatch = content.match(regex);
                        if (vMatch) {
                            try {
                                const videoBlock = vMatch[1];
                                // Improved regex to handle escaped slashes and more formats
                                const videoUrls = videoBlock.match(/https?:\/\/[^"'\s,\]]+\.(mp4|m3u8|mpd|webm)[^"'\s,\]]*/gi);
                                if (videoUrls) {
                                    videoUrls.forEach(vUrl => {
                                        const cleanUrl = vUrl.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                        const urlIndex = videoBlock.indexOf(vUrl);
                                        const vContext = videoBlock.substring(Math.max(0, urlIndex - 400), Math.min(videoBlock.length, urlIndex + 400)).toLowerCase();

                                        if (!isPromotionalContent(vContext, cleanUrl)) {
                                            // Categorize accurately
                                            if (isReviewVideoContext(vContext, cleanUrl)) {
                                                addReviewVideo(cleanUrl);
                                            } else {
                                                addProductVideo(cleanUrl);
                                            }
                                        }
                                    });
                                }
                            } catch (e) { }
                        }
                    });

                    // Pattern 4: Unified global video scanner - captures and categorizes every video match
                    const globalVideoMatches = content.match(/https?:\/\/[^"'\s]*?(?:amazon|ssl|media-amazon)[^"'\s]*?\.(mp4|m3u8|mpd|webm)[^"'\s]*/gi);
                    if (globalVideoMatches) {
                        globalVideoMatches.forEach(vUrl => {
                            const cleanUrl = vUrl.replace(/\\u002F/g, '/').replace(/\\/g, '');
                            const urlIndex = content.indexOf(vUrl);
                            const vContext = content.substring(Math.max(0, urlIndex - 400), Math.min(content.length, urlIndex + 400)).toLowerCase();

                            if (!isPromotionalContent(vContext, cleanUrl)) {
                                if (isReviewVideoContext(vContext, cleanUrl)) {
                                    addReviewVideo(cleanUrl);
                                } else if (isOfficialProductVideo(content, cleanUrl)) {
                                    addProductVideo(cleanUrl);
                                }
                            }
                        });
                    }

                    // Pattern 5: Review-specific video data
                    const reviewVideoMatches = content.match(/"reviewVideo[^"]*"\s*:\s*"(https:\/\/[^"]+)"/gi);
                    if (reviewVideoMatches) {
                        reviewVideoMatches.forEach(match => {
                            const urlMatch = match.match(/"(https:\/\/[^"]+)"/);
                            if (urlMatch) {
                                addReviewVideo(urlMatch[1].replace(/\\u002F/g, '/').replace(/\\/g, ''));
                            }
                        });
                    }

                    // Pattern 5b: Additional customer video manifest patterns
                    const customerVideoMatch = content.match(/"customerVideoManifest"\s*:\s*\{([\s\S]*?)\}/g);
                    if (customerVideoMatch) {
                        customerVideoMatch.forEach(match => {
                            const urls = match.match(/https:\/\/[^"'\s,\]\[\}]+\.(mp4|m3u8|mpd)[^"'\s,\]\[\}]*/gi);
                            if (urls) {
                                urls.forEach(url => {
                                    url = url.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                    addReviewVideo(url);
                                });
                            }
                        });
                    }

                    // Pattern 5c: Modern Review Video Data
                    const reviewVideoDataMatch = content.match(/ReviewVideoGalleryData\s*:\s*(\[[\s\S]*?\])/i);
                    if (reviewVideoDataMatch) {
                        try {
                            const galleryData = JSON.parse(reviewVideoDataMatch[1].replace(/'/g, '"'));
                            galleryData.forEach((item: any) => {
                                const url = item.videoUrl || item.url || '';
                                if (url) addReviewVideo(url);
                            });
                        } catch (e) { }
                    }

                    // Pattern 6: Amazon's videoBlockData - main source for product videos in gallery
                    // Relaxed keywords to ensure we don't miss isolated video blocks
                    if (lowerContent.includes('video') || lowerContent.includes('media') || lowerContent.includes('vse')) {

                        const videoBlockMatch = content.match(/(?:'videos'|"videos")\s*:\s*(\[[\s\S]*?\])(?:\s*,|\s*\})/);
                        if (videoBlockMatch) {
                            try {
                                const videoArrayStr = videoBlockMatch[1].replace(/'/g, '"');
                                const videoArray = JSON.parse(videoArrayStr);
                                if (Array.isArray(videoArray)) {
                                    videoArray.forEach((videoItem: any) => {
                                        // Extract all video URL formats
                                        const url = videoItem.url || videoItem.videoUrl ||
                                            videoItem.progressiveUrl || videoItem.hlsUrl || '';
                                        if (url) {
                                            const cleanUrl = url.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                            // Double-check it's not promotional
                                            if (!isPromotionalContent(JSON.stringify(videoItem), cleanUrl)) {
                                                // Also look into variants array for higher-res or alternative formats
                                                if (videoItem.variants && Array.isArray(videoItem.variants)) {
                                                    videoItem.variants.forEach((variant: any) => {
                                                        const vUrl = variant.url || variant.videoUrl || '';
                                                        if (vUrl) addProductVideo(vUrl.replace(/\\u002F/g, '/').replace(/\\/g, ''));
                                                    });
                                                }
                                                addProductVideo(cleanUrl);
                                            }
                                        }
                                    });
                                }
                            } catch (e) { }
                        }

                        // Pattern 7: SlateManifest contains video playback data
                        const slateMatch = content.match(/"slateUrl"\s*:\s*"(https:\/\/[^"]+)"/g);
                        if (slateMatch) {
                            slateMatch.forEach(match => {
                                const urlMatch = match.match(/"(https:\/\/[^"]+)"/);
                                if (urlMatch) {
                                    // Slate URLs are video thumbnails, find corresponding video
                                    const slateUrl = urlMatch[1];
                                    // Look for video URL near the slate URL
                                    const nearbyContent = content.substring(
                                        Math.max(0, content.indexOf(slateUrl) - 500),
                                        content.indexOf(slateUrl) + 500
                                    );

                                    // Only extract if not in promotional context
                                    if (!isPromotionalContent(nearbyContent, slateUrl)) {
                                        const videoMatch = nearbyContent.match(/"(?:url|videoUrl|progressiveUrl)"\s*:\s*"(https:\/\/[^"]+\.mp4[^"]*)"/);
                                        if (videoMatch) {
                                            addProductVideo(videoMatch[1].replace(/\\u002F/g, '/').replace(/\\/g, ''));
                                        }
                                    }
                                }
                            });
                        }
                    }
                });

                // 2. DOM fallback for product videos (video thumbnails in product gallery)
                // STRICT: Only from main product image gallery, exclude promotional sections
                document.querySelectorAll<HTMLElement>('#imageBlock .videoThumbnail, #altImages .videoThumbnail, #main-image-container [data-video-url], .vse-video-item')
                    .forEach((el) => {
                        // Skip if in a promotional or "similar brands" section
                        if (el.closest('[data-component-type*="brand"]') ||
                            el.closest('[class*="similar-brand"]') ||
                            el.closest('[class*="sponsored"]') ||
                            el.closest('#similarities_feature_div') ||
                            el.closest('#sp_detail') ||
                            el.closest('.aplus-module')) {
                            return;
                        }

                        const videoUrl = el.getAttribute('data-video-url') ||
                            el.querySelector('[data-video-url]')?.getAttribute('data-video-url') ||
                            el.getAttribute('data-vse-video-url') ||
                            el.getAttribute('data-vse-video-progressive-url') ||
                            el.closest('.vse-video-item')?.getAttribute('data-video-url');

                        if (videoUrl && videoUrl.startsWith('http')) {
                            addProductVideo(videoUrl);
                        } else {
                            // Support for encoded video JSON in thumbnails
                            const videoData = el.getAttribute('data-a-video-data') ||
                                el.querySelector('[data-a-video-data]')?.getAttribute('data-a-video-data');
                            if (videoData) {
                                try {
                                    const parsed = JSON.parse(videoData);
                                    const url = parsed.url || parsed.videoUrl || (parsed.sources && parsed.sources[0]?.url);
                                    if (url && url.startsWith('http')) addProductVideo(url);
                                } catch (e) { }
                            }
                        }
                    });

                // 3. DOM fallback for review videos - STRICT: Only from customer reviews section
                const reviewVideoSelectors = [
                    '#customer-reviews video',
                    '#cm_cr-review_list video',
                    '.cr-widget-FocalReviews video',
                    '[data-hook="review-video"]',
                    '[data-hook="review-body"] video',
                    '.review-video-container video',
                    '#customer-reviews [data-video-url]',
                    '#cm_cr-review_list [data-video-url]',
                    '.cr-media-gallery [data-video-url]',
                    '.cr-media-gallery [data-a-video-data]',
                    '.review-image-tile[data-video-url]'
                ];

                document.querySelectorAll<HTMLElement>(reviewVideoSelectors.join(', '))
                    .forEach((el) => {
                        let videoUrl = '';
                        if (el.tagName.toLowerCase() === 'video') {
                            videoUrl = (el as HTMLVideoElement).src;
                            if (!videoUrl) {
                                const source = el.querySelector('source');
                                if (source) videoUrl = source.src;
                            }
                        } else {
                            // Check for data-video-url or encoded video JSON
                            videoUrl = el.getAttribute('data-video-url') || el.getAttribute('data-reorder-video-url') || '';

                            // If it's a JSON block (common in review gallery)
                            const videoData = el.getAttribute('data-a-video-data');
                            if (videoData) {
                                try {
                                    const parsed = JSON.parse(videoData);
                                    const url = parsed.url || parsed.videoUrl || (parsed.sources && parsed.sources[0]?.url);
                                    if (url) videoUrl = url;
                                } catch (e) { }
                            }
                        }
                        if (videoUrl && videoUrl.startsWith('http')) {
                            addReviewVideo(videoUrl);
                        }
                    });

                // 4. Generic video fallback - STRICT categorization based on DOM location
                document.querySelectorAll<HTMLVideoElement>('video')
                    .forEach((video) => {
                        const videoUrl = video.src || video.querySelector('source')?.src;
                        if (!videoUrl || !videoUrl.startsWith('http')) return;

                        // Skip videos in promotional/similar brands sections
                        if (video.closest('[data-component-type*="brand"]') ||
                            video.closest('[class*="similar-brand"]') ||
                            video.closest('[class*="sponsored"]') ||
                            video.closest('#similarities_feature_div') ||
                            video.closest('#sp_detail') ||
                            video.closest('.aplus-module') ||
                            video.closest('[id*="brand"]')) {
                            return;
                        }

                        // Check if video is strictly in review section
                        if (video.closest('#customer-reviews') ||
                            video.closest('#cm_cr-review_list') ||
                            video.closest('[data-hook*="review"]') ||
                            video.closest('.review')) {
                            addReviewVideo(videoUrl);
                        } else if (video.closest('#imageBlock') || video.closest('#altImages')) {
                            // Only add as product video if in main product gallery
                            addProductVideo(videoUrl);
                        }
                        // Otherwise, don't add - ambiguous source
                    });

                // Reset scroll state if ASIN changed
                if (asin && asin !== lastScrapedAsin) {
                    lastScrapedAsin = asin;
                    hasAutoScrolled = false;
                }

                // No longer trigger scroll - data is fetched via silent API

                // Background fetch across ALL pages (limit increased significantly)
                // runs ONCE per ASIN change, regardless of triggerScroll
                if (onProductPage && asin && asin !== lastFetchedReviewAsin) {
                    lastFetchedReviewAsin = asin;
                    const extra = await fetchAllReviewMedia(asin, 100);
                    let hasNewMedia = false;
                    if (extra.images.length > 0) {
                        extra.images.forEach(img => {
                            const hi = toHighRes(img);
                            const b = getImageBase(hi);
                            if (!seenReviewBases.has(b)) {
                                seenReviewBases.add(b);
                                reviewImages.push(hi);
                                hasNewMedia = true;
                            }
                        });
                    }
                    if (extra.videos.length > 0) {
                        reviewVideos.push(...extra.videos);
                        hasNewMedia = true;
                    }

                    // Notify panel that new review media was loaded
                    if (hasNewMedia) {
                        notifyContentChange('review_media_loaded');
                    }
                }

                // Capture from any open modals or gallery state JSON
                const modalState = document.querySelector('[data-a-modal-state]')?.getAttribute('data-a-modal-state');
                if (modalState && (modalState.includes('review') || modalState.includes('customer'))) {
                    const urls = modalState.match(/https:\/\/[^"'\s,\]\[\}]+\.(jpg|jpeg|png|webp)[^"'\s,\]\[\}]*/gi);
                    if (urls) {
                        urls.forEach(url => {
                            const hi = toHighRes(url.replace(/\\u002F/g, '/').replace(/\\/g, ''));
                            // Add to reviewImages if not already present
                            const b = getImageBase(hi);
                            if (!seenReviewBases.has(b)) {
                                seenReviewBases.add(b);
                                reviewImages.push(hi);
                            }
                        });
                    }
                }
            }

            console.log(`AMZImage: Final counts - ${reviewImages.length} review imgs, ${reviewVideos.length} review vids`);

            // Capture active image (main displayed image)
            let activeImage = '';
            const landingImage = document.querySelector('#landingImage') as HTMLImageElement;
            if (landingImage && landingImage.src) {
                activeImage = landingImage.src;
                if (activeImage.startsWith('http')) {
                    activeImage = activeImage.replace(/\._AC_[a-zA-Z0-9]+_\./, '.');
                    activeImage = activeImage.replace(/\._[a-zA-Z]+[0-9]+_\./, '.');
                }
            }

            const uniqueProductImages = [...new Set(productImages)];
            if (activeImage) {
                const hi = toHighRes(activeImage);
                const idx = uniqueProductImages.indexOf(hi);
                if (idx > -1) uniqueProductImages.splice(idx, 1);
                uniqueProductImages.unshift(hi);
            }

            // SYNC: Update current variant with fully scraped gallery from main page
            if (asin && variants.length > 0 && uniqueProductImages.length > 1) {
                const currentVariant = variants.find(v => v.asin === asin);
                if (currentVariant) {
                    // Update if main gallery has more images or if variant has few
                    if (!currentVariant.images || uniqueProductImages.length > currentVariant.images.length) {
                        currentVariant.images = [...uniqueProductImages];
                        // Keep map in sync
                        scrapedVariantImagesByAsin[asin] = [...uniqueProductImages];
                    }
                }
            }

            // Final return for product pages
            if (onProductPage) {
                return {
                    pageType, asin, title: title.substring(0, 120),
                    variant, variants, description, activeImage,
                    productImages: uniqueProductImages,
                    variantImages: variantImagesMap,
                    variantImagesByAsin: variantImagesByAsin,
                    reviewImages: [...new Set(reviewImages)],
                    videos: [...new Set(videos)],
                    reviewVideos: [...new Set(reviewVideos)],
                    listingProducts
                };
            }

            // Fallback return for non-product/listing pages
            return {
                pageType, asin, title: title.substring(0, 120),
                variant, variants, description: description, activeImage: '',
                productImages: [...new Set(productImages)],
                variantImages: variantImagesMap,
                variantImagesByAsin: variantImagesByAsin,
                reviewImages: [...new Set(reviewImages)],
                videos: [...new Set(videos)],
                reviewVideos: [...new Set(reviewVideos)],
                listingProducts
            };
        }
    }
});