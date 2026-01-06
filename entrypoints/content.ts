

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

        // Track last known main image to detect variant changes
        let lastMainImageSrc = '';
        let lastAsin = '';
        let refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;

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

        // Get current ASIN from URL
        function getCurrentAsin(): string {
            const match = window.location.pathname.match(/\/dp\/([A-Z0-9]{10})/i) ||
                window.location.pathname.match(/\/gp\/product\/([A-Z0-9]{10})/i);
            return match ? match[1] : '';
        }

        // Watch for variant/image changes using MutationObserver
        function setupVariantObserver() {
            // Elements to watch for changes
            const observeTargets = [
                '#imageBlock',           // Main image area
                '#altImages',            // Thumbnail carousel
                '#twister',              // Variant selector (color, size, etc.)
                '#landingImage',         // Main product image
                '#imgTagWrapperId',      // Image wrapper
                '#variation_color_name', // Color variant selector
                '#variation_size_name',  // Size variant selector  
                '#variation_style_name', // Style variant selector
            ];

            const observer = new MutationObserver((mutations) => {
                let shouldNotify = false;
                let reason = 'dom_change';

                for (const mutation of mutations) {
                    // Check for main image source change
                    if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
                        const target = mutation.target as HTMLImageElement;
                        if (target.id === 'landingImage' || target.closest('#landingImage')) {
                            const newSrc = target.src;
                            if (newSrc && newSrc !== lastMainImageSrc && !newSrc.includes('data:')) {
                                lastMainImageSrc = newSrc;
                                shouldNotify = true;
                                reason = 'variant_image_changed';
                            }
                        }
                    }

                    // Check for data-a-dynamic-image attribute change (high-res images)
                    if (mutation.type === 'attributes' && mutation.attributeName === 'data-a-dynamic-image') {
                        shouldNotify = true;
                        reason = 'dynamic_image_updated';
                    }

                    // Check for class changes (variant selection changes)
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        const target = mutation.target as HTMLElement;
                        // Check if this is a variant swatch selection
                        if (target.closest('#twister') ||
                            target.closest('[id*="variation_"]') ||
                            target.classList.contains('swatchSelect') ||
                            target.classList.contains('selected')) {
                            shouldNotify = true;
                            reason = 'variant_selection_changed';
                        }
                    }

                    // Check for new image nodes added
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        mutation.addedNodes.forEach((node) => {
                            if (node instanceof HTMLElement) {
                                if (node.tagName === 'IMG' || node.querySelector('img')) {
                                    shouldNotify = true;
                                    reason = 'new_images_loaded';
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

        // Initialize observer when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(setupVariantObserver, 500);
            });
        } else {
            setTimeout(setupVariantObserver, 500);
        }

        // Listen for messages from background script
        browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if (message.type === 'GET_FULL_DATA') {
                try {
                    const data = scrapeProductData();
                    sendResponse(data);
                } catch (error) {
                    console.error('Error scraping data:', error);
                    sendResponse(null);
                }
            }

            if (message.type === 'GET_IMAGES') {
                try {
                    const data = scrapeProductData();
                    const allImages = [...data.productImages, ...data.reviewImages];
                    // For listing pages, include all product images
                    if (data.pageType === 'listing') {
                        data.listingProducts.forEach(p => {
                            if (p.image && !allImages.includes(p.image)) {
                                allImages.push(p.image);
                            }
                        });
                    }
                    sendResponse({ images: allImages });
                } catch (error) {
                    console.error('Error scraping images:', error);
                    sendResponse({ images: [] });
                }
            }

            return false; // synchronous response unless we returned true, but here sendResponse is called synchronously? 
            // Actually in WXT/Mozilla sendResponse can be used if we simply return valid value or Promise.
            // But here we use sendResponse directly.
            // If we want async, we return true.
            // But scrapeProductData is sync.
        });



        function isProductPage(): boolean {
            const url = window.location.pathname;
            return url.includes('/dp/') || url.includes('/gp/product/');
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
                const priceEl = card.querySelector<HTMLElement>(
                    '.a-price .a-offscreen, ' +
                    '.a-price-whole, ' +
                    '.a-color-base.a-text-normal, ' +
                    '[data-cy="price-recipe"] .a-offscreen'
                );
                const price = priceEl?.textContent?.trim() || '';

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
            return products;
        }

        function scrapeProductData(): ProductData {
            const productImages: string[] = [];
            const reviewImages: string[] = [];
            const videos: string[] = [];          // Product videos
            const reviewVideos: string[] = [];    // Customer review videos
            const listingProducts: ProductItem[] = [];

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
            let asin = '';
            const urlMatch = window.location.pathname.match(/\/dp\/([A-Z0-9]{10})/i) ||
                window.location.pathname.match(/\/gp\/product\/([A-Z0-9]{10})/i);
            if (urlMatch) {
                asin = urlMatch[1];
            } else {
                const asinElement = document.querySelector('[data-asin]');
                if (asinElement) {
                    asin = asinElement.getAttribute('data-asin') || '';
                }
            }

            // Extract product title
            let title = '';
            if (onProductPage) {
                const titleElement = document.querySelector('#productTitle, #title');
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

            // Helper: Filter out unwanted UI/placeholder images
            // Helper: Filter out unwanted UI/placeholder images
            function isValidImage(url: string | null | undefined): boolean {
                if (!url || !url.startsWith('http')) return false;

                const lowerUrl = url.toLowerCase();

                // Exclude SVGs (usually icons/logos)
                if (lowerUrl.includes('.svg')) return false;

                const unwantedKeywords = [
                    'sprite', 'transparent', 'pixel', 'placeholder', 'loader', 'loading',
                    'icon', 'logo', 'button', 'overlay', 'zoom', 'magnifier', 'plus', 'minus',
                    'caret', 'arrow', 'chevron', 'star', 'rating', 'badge', 'play-button',
                    'reviews-image-gallery-loading', 'nav-sprite', 'details-gallery-view',
                    'x-locale', 'maximize', 'minimize', 'remove', 'close', 'delete',
                    'spin', '360_icon', '360-icon', 'view_full', 'cursor', 'selector',
                    'play-icon', 'video-icon', 'images/g/', 'common',
                    'zoom-in', 'zoom-out', 'flyout', 'ui-element', 'widget'
                ];

                if (unwantedKeywords.some(kw => lowerUrl.includes(kw))) return false;

                // Exclude user profile avatars in reviews
                if (lowerUrl.includes('profile') || lowerUrl.includes('avatar')) return false;

                return true;
            }

            // Product page specific scraping
            if (onProductPage) {
                // Use a Set to track unique base image identifiers
                const seenImageBases = new Set<string>();

                // Helper to extract unique image base (removes size modifiers but keeps unique identifiers)
                function getImageBase(url: string): string {
                    // Extract the core image identifier (everything before the size modifiers)
                    // Amazon URLs: https://m.media-amazon.com/images/I/[IMAGE_ID]._AC_SX679_.jpg
                    const match = url.match(/images\/I\/([A-Za-z0-9\-_+%]+)/);
                    return match ? match[1] : url;
                }

                // Helper to get high-res version of image
                function toHighRes(url: string): string {
                    if (!url) return '';
                    // Remove all size/transform modifiers to get the original
                    return url
                        .replace(/\._[A-Z]{2}_[A-Za-z0-9,_]+_\./, '.')
                        .replace(/\._AC_.*_\./, '.')
                        .replace(/\._S[A-Z0-9]+_\./, '.')
                        .replace(/\._U[A-Z0-9]+_\./, '.')
                        .replace(/\._CR[0-9,]+_\./, '.')
                        .replace(/\._X[A-Z0-9]+_\./, '.');
                }

                // Helper to add image if unique
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

                // 1. Extract images from Amazon's colorImages/imageGalleryData JSON in page scripts
                // This is the most reliable source with all product images in correct order
                const imageScripts = document.querySelectorAll('script:not([src])');
                let foundColorImages = false;

                imageScripts.forEach(script => {
                    const content = script.textContent || '';
                    if (!content || content.length < 100) return;

                    // Primary method: Look for colorImages data structure
                    // This contains ALL images for the currently selected variant in order
                    // Format: 'colorImages': { 'initial': [{hiRes: "...", large: "...", ...}, ...] }
                    if (!foundColorImages) {
                        // Try to find the full colorImages structure
                        const colorImagesFullMatch = content.match(/'colorImages'\s*:\s*(\{[\s\S]*?\})\s*,\s*'colorToAsin'/);
                        if (colorImagesFullMatch) {
                            try {
                                // Replace single quotes with double quotes for JSON parsing
                                let jsonStr = colorImagesFullMatch[1]
                                    .replace(/'/g, '"')
                                    .replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

                                const colorImages = JSON.parse(jsonStr);

                                // 'initial' contains images for currently selected variant
                                if (colorImages.initial && Array.isArray(colorImages.initial)) {
                                    foundColorImages = true;
                                    colorImages.initial.forEach((imgData: any, index: number) => {
                                        // Prioritize hiRes, then large, then main
                                        const imgUrl = imgData.hiRes || imgData.large ||
                                            (imgData.main && typeof imgData.main === 'object' ? Object.values(imgData.main)[0] : imgData.main) || '';
                                        if (imgUrl && typeof imgUrl === 'string') {
                                            addUniqueImage(imgUrl);
                                        }
                                    });
                                }
                            } catch (e) {
                                // Try simpler parsing
                            }
                        }
                    }

                    // Fallback: Try simpler colorImages pattern
                    if (!foundColorImages) {
                        const simpleMatch = content.match(/'colorImages'\s*:\s*\{\s*'initial'\s*:\s*(\[[^\]]+\])/);
                        if (simpleMatch) {
                            try {
                                const jsonStr = simpleMatch[1].replace(/'/g, '"');
                                const initialImages = JSON.parse(jsonStr);
                                if (Array.isArray(initialImages)) {
                                    foundColorImages = true;
                                    initialImages.forEach((imgData: any) => {
                                        const imgUrl = imgData.hiRes || imgData.large || '';
                                        if (imgUrl) addUniqueImage(imgUrl);
                                    });
                                }
                            } catch (e) { }
                        }
                    }

                    // Also try imageGalleryData pattern for additional images
                    const galleryMatch = content.match(/imageGalleryData\s*:\s*(\[[\s\S]*?\])/);
                    if (galleryMatch) {
                        try {
                            const galleryData = JSON.parse(galleryMatch[1]);
                            galleryData.forEach((item: any) => {
                                const imgUrl = item.mainUrl || item.hiRes || item.large || '';
                                if (imgUrl) addUniqueImage(imgUrl);
                            });
                        } catch (e) { }
                    }

                    // Extract individual hiRes URLs from P.when data blocks
                    const hiResMatches = content.match(/"hiRes"\s*:\s*"(https:\/\/[^"]+)"/g);
                    if (hiResMatches) {
                        hiResMatches.forEach(match => {
                            const urlMatch = match.match(/"(https:\/\/[^"]+)"/);
                            if (urlMatch && urlMatch[1]) {
                                addUniqueImage(urlMatch[1]);
                            }
                        });
                    }
                });

                // 2. Extract from data-a-dynamic-image attribute on main image
                const mainImg = document.querySelector<HTMLImageElement>(
                    '#landingImage, #imgBlkFront, #main-image, #ebooksImgBlkFront'
                );
                if (mainImg) {
                    // Add main image src
                    if (mainImg.src) {
                        addUniqueImage(mainImg.src);
                    }

                    // Parse data-a-dynamic-image JSON for high-res versions
                    const dynamicImageData = mainImg.getAttribute('data-a-dynamic-image');
                    if (dynamicImageData) {
                        try {
                            const dynamicImages = JSON.parse(dynamicImageData);
                            // URLs are keys, [width, height] are values
                            // Sort by size (largest first) and add unique ones
                            const urls = Object.keys(dynamicImages);
                            const sorted = urls.sort((a, b) => {
                                const [w1, h1] = dynamicImages[a] || [0, 0];
                                const [w2, h2] = dynamicImages[b] || [0, 0];
                                return (w2 * h2) - (w1 * h1);
                            });
                            // Get the largest (first after sort)
                            if (sorted.length > 0) {
                                addUniqueImage(sorted[0]);
                            }
                        } catch (e) {
                            console.error('Failed to parse dynamic images', e);
                        }
                    }
                }

                // 3. Extract from altImages thumbnails using their data attributes
                const thumbItems = document.querySelectorAll('#altImages .a-spacing-small.item, #altImages li.a-declarative');
                thumbItems.forEach((item) => {
                    // Skip video thumbnails
                    if (item.classList.contains('videoThumbnail') || item.querySelector('.videoThumbnail')) return;

                    const img = item.querySelector<HTMLImageElement>('img');
                    if (!img) return;

                    // Try to get hiRes URL from various data attributes
                    let hiResUrl = '';

                    // Check data-old-hires attribute
                    hiResUrl = img.getAttribute('data-old-hires') || '';

                    // Check parent's data for image URL
                    if (!hiResUrl) {
                        const parentData = item.getAttribute('data-csa-c-element-type');
                        if (parentData === 'video') return; // Skip video
                    }

                    // Convert thumbnail to hiRes
                    if (!hiResUrl && img.src) {
                        // Thumbnails typically use patterns like _US40_, _SS40_, _AC_US40_
                        hiResUrl = toHighRes(img.src);
                    }

                    if (hiResUrl) {
                        addUniqueImage(hiResUrl);
                    }
                });

                // 4. Extract from image block wrapper spans (newer Amazon layout)
                const imageWrappers = document.querySelectorAll('#imageBlock_feature_div [data-action="main-image-click"]');
                imageWrappers.forEach((wrapper) => {
                    const img = wrapper.querySelector<HTMLImageElement>('img');
                    if (img?.src) {
                        addUniqueImage(img.src);
                    }
                });

                // 5. Variant/Swatch Images (different colors/styles)
                const variantElements = document.querySelectorAll(
                    '#variation_color_name li img, #variation_style_name li img, ' +
                    '.swatchAvailable img, .imgSwatch img, [data-dp-url] img'
                );
                variantElements.forEach((img: Element) => {
                    const imgEl = img as HTMLImageElement;
                    if (imgEl.src) {
                        addUniqueImage(imgEl.src);
                    }
                });

                console.log(`AMZImage: Found ${productImages.length} unique product images`);

                // ==========================================
                // REVIEW IMAGES - Extract from embedded JSON data (no scroll required)
                // ==========================================
                const seenReviewBases = new Set<string>();

                function addUniqueReviewImage(url: string): boolean {
                    if (!url || !isValidImage(url)) return false;
                    const highRes = toHighRes(url);
                    const base = getImageBase(highRes);
                    if (base && !seenReviewBases.has(base)) {
                        seenReviewBases.add(base);
                        reviewImages.push(highRes);
                        return true;
                    }
                    return false;
                }

                // 1. Extract review images from embedded script data
                imageScripts.forEach(script => {
                    const content = script.textContent || '';

                    // Pattern 1: Look for customer review media gallery data
                    // Usually in format: "mediaCustomerReviews":[{...}] or "customerImages":[...]
                    const reviewMediaPatterns = [
                        /"customerImages"\s*:\s*\[([\s\S]*?)\]/g,
                        /"mediaUrls"\s*:\s*\[([\s\S]*?)\]/g,
                        /"reviewImages"\s*:\s*\[([\s\S]*?)\]/g,
                        /"imageUrls"\s*:\s*\[([\s\S]*?)\]/g,
                    ];

                    reviewMediaPatterns.forEach(pattern => {
                        const matches = content.match(pattern);
                        if (matches) {
                            matches.forEach(match => {
                                // Extract URLs from the array
                                const urlMatches = match.match(/https:\/\/[^"'\s,\]]+/g);
                                if (urlMatches) {
                                    urlMatches.forEach(url => {
                                        // Clean escaped characters
                                        url = url.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                        if (url.includes('images') && !url.includes('.svg')) {
                                            addUniqueReviewImage(url);
                                        }
                                    });
                                }
                            });
                        }
                    });

                    // Pattern 2: Look for individual review image URLs
                    const imgUrlMatterns = content.match(/"(https:\/\/[^"]+images[^"]+\.(jpg|jpeg|png|webp))"/gi);
                    if (imgUrlMatterns) {
                        imgUrlMatterns.forEach(match => {
                            const url = match.replace(/"/g, '').replace(/\\u002F/g, '/').replace(/\\/g, '');
                            // Filter for review-related images (customer content)
                            if (url.includes('customer') ||
                                url.includes('review') ||
                                url.includes('media-amazon') ||
                                url.includes('/I/')) {
                                addUniqueReviewImage(url);
                            }
                        });
                    }
                });

                // 2. DOM fallback for review images (covers visible ones)
                const reviewImgSelectors = [
                    '.review-image-tile',
                    '[data-hook="cr-media-gallery"] img',
                    '.review-image-thumbnail',
                    '[data-hook="review-image-tile"]',
                    '.cr-media-thumbnail img',
                    '#customer-reviews-content img',
                    '.cr-image-container img'
                ];

                document.querySelectorAll<HTMLImageElement>(reviewImgSelectors.join(', '))
                    .forEach((img) => {
                        const src = img.src || img.getAttribute('data-src') || '';
                        if (src && !src.startsWith('data:')) {
                            addUniqueReviewImage(src);
                        }
                    });

                console.log(`AMZImage: Found ${reviewImages.length} review images`);

                // ==========================================
                // VIDEOS - Separate Product Videos and Review Videos
                // ==========================================
                const seenProductVideoIds = new Set<string>();
                const seenReviewVideoIds = new Set<string>();

                function getVideoId(url: string): string {
                    const idMatch = url.match(/\/([^\/]+)\.(mp4|webm|m3u8|mpd)/);
                    return idMatch ? idMatch[1] : url;
                }

                function addProductVideo(url: string): boolean {
                    if (!url || !url.startsWith('http')) return false;
                    const videoId = getVideoId(url);
                    if (!seenProductVideoIds.has(videoId)) {
                        seenProductVideoIds.add(videoId);
                        videos.push(url);
                        return true;
                    }
                    return false;
                }

                function addReviewVideo(url: string): boolean {
                    if (!url || !url.startsWith('http')) return false;
                    const videoId = getVideoId(url);
                    if (!seenReviewVideoIds.has(videoId)) {
                        seenReviewVideoIds.add(videoId);
                        reviewVideos.push(url);
                        return true;
                    }
                    return false;
                }

                // Helper to determine if a video is a review video based on context
                function isReviewVideoContext(content: string, url: string): boolean {
                    const lowerContent = content.toLowerCase();
                    const lowerUrl = url.toLowerCase();

                    // Check URL patterns for review videos
                    if (lowerUrl.includes('review') ||
                        lowerUrl.includes('customer') ||
                        lowerUrl.includes('ugc')) {
                        return true;
                    }

                    // Check context around the URL
                    const urlIndex = content.indexOf(url);
                    if (urlIndex > 0) {
                        const context = content.substring(Math.max(0, urlIndex - 200), urlIndex + 200).toLowerCase();
                        if (context.includes('review') ||
                            context.includes('customer') ||
                            context.includes('usergeneratedcontent') ||
                            context.includes('ugc')) {
                            return true;
                        }
                    }

                    return false;
                }

                // 1. Extract videos from embedded script data (highest priority - available immediately)
                imageScripts.forEach(script => {
                    const content = script.textContent || '';
                    if (!content || content.length < 100) return;

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
                                } else {
                                    addProductVideo(url);
                                }
                            }
                        }
                    });

                    // Pattern 2: Video manifest/config objects - usually product videos
                    const manifestMatch = content.match(/"videos"\s*:\s*\[([\s\S]*?)\]/);
                    if (manifestMatch) {
                        const block = manifestMatch[0];
                        const isReviewBlock = block.toLowerCase().includes('review') || block.toLowerCase().includes('customer');
                        const videoUrls = manifestMatch[1].match(/https:\/\/[^"'\s,\]]+\.(mp4|m3u8|mpd)[^"'\s,\]]*/g);
                        if (videoUrls) {
                            videoUrls.forEach(url => {
                                url = url.replace(/\\u002F/g, '/').replace(/\\/g, '');
                                if (isReviewBlock || isReviewVideoContext(content, url)) {
                                    addReviewVideo(url);
                                } else {
                                    addProductVideo(url);
                                }
                            });
                        }
                    }

                    // Pattern 3: Video data blocks
                    const videoDataMatch = content.match(/"videoData"\s*:\s*{([^}]+)}/g);
                    if (videoDataMatch) {
                        videoDataMatch.forEach(block => {
                            const urlMatch = block.match(/"url"\s*:\s*"([^"]+)"/);
                            if (urlMatch) {
                                let url = urlMatch[1].replace(/\\u002F/g, '/').replace(/\\/g, '');
                                if (isReviewVideoContext(block, url)) {
                                    addReviewVideo(url);
                                } else {
                                    addProductVideo(url);
                                }
                            }
                        });
                    }

                    // Pattern 4: Amazon product video format - typically product videos
                    const avMatches = content.match(/https:\/\/[^"'\s]*?(?:amazon|ssl)[^"'\s]*?\.mp4/g);
                    if (avMatches) {
                        avMatches.forEach(url => addProductVideo(url));
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

                    // Pattern 6: Amazon's videoBlockData - main source for product videos in gallery
                    const videoBlockMatch = content.match(/'videos'\s*:\s*(\[[\s\S]*?\])\s*,/);
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
                                        addProductVideo(url.replace(/\\u002F/g, '/').replace(/\\/g, ''));
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
                                const videoMatch = nearbyContent.match(/"(?:url|videoUrl|progressiveUrl)"\s*:\s*"(https:\/\/[^"]+\.mp4[^"]*)"/);
                                if (videoMatch) {
                                    addProductVideo(videoMatch[1].replace(/\\u002F/g, '/').replace(/\\/g, ''));
                                }
                            }
                        });
                    }
                });

                // 2. DOM fallback for product videos (video thumbnails in product gallery)
                document.querySelectorAll<HTMLElement>('#imageBlock .videoThumbnail, #altImages .videoThumbnail, [data-video-url]')
                    .forEach((el) => {
                        const videoUrl = el.getAttribute('data-video-url') ||
                            el.querySelector('[data-video-url]')?.getAttribute('data-video-url');
                        if (videoUrl && videoUrl.startsWith('http')) {
                            addProductVideo(videoUrl);
                        }
                    });

                // 3. DOM fallback for review videos (videos in customer reviews section)
                document.querySelectorAll<HTMLElement>('#customer-reviews video, .review-video, [data-hook="review-video"]')
                    .forEach((el) => {
                        let videoUrl = '';
                        if (el.tagName.toLowerCase() === 'video') {
                            videoUrl = (el as HTMLVideoElement).src;
                            if (!videoUrl) {
                                const source = el.querySelector('source');
                                if (source) videoUrl = source.src;
                            }
                        } else {
                            videoUrl = el.getAttribute('data-video-url') || '';
                        }
                        if (videoUrl && videoUrl.startsWith('http')) {
                            addReviewVideo(videoUrl);
                        }
                    });

                // 4. Generic video fallback - try to categorize based on location in DOM
                document.querySelectorAll<HTMLVideoElement>('video')
                    .forEach((video) => {
                        const videoUrl = video.src || video.querySelector('source')?.src;
                        if (!videoUrl || !videoUrl.startsWith('http')) return;

                        // Check if video is in review section
                        if (video.closest('#customer-reviews') ||
                            video.closest('[data-hook*="review"]') ||
                            video.closest('.review')) {
                            addReviewVideo(videoUrl);
                        } else {
                            addProductVideo(videoUrl);
                        }
                    });

                console.log(`AMZImage: Found ${videos.length} product videos, ${reviewVideos.length} review videos`);
            }

            return {
                pageType,
                asin,
                title: title.substring(0, 120) + (title.length > 120 ? '...' : ''),
                variant,
                description,
                productImages: [...new Set(productImages)],
                reviewImages: [...new Set(reviewImages)],
                videos: [...new Set(videos)],
                reviewVideos: [...new Set(reviewVideos)],
                listingProducts
            };
        }
    },
});
