import ReactDOM from 'react-dom/client';
import { createElement } from 'react';
import PanelApp from '../components/PanelApp';

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

        let panelVisible = false;
        let panelRoot: ReactDOM.Root | null = null;

        // Inject the side panel
        injectPanel();

        // Listen for messages from background script
        browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

            if (message.type === 'TOGGLE_PANEL') {
                togglePanel();
            }

            return false;
        });

        function injectPanel() {
            if (document.getElementById('amzimage-panel-container')) {
                return;
            }

            // Create container
            const container = document.createElement('div');
            container.id = 'amzimage-panel-container';
            container.style.cssText = `
                position: fixed;
                top: 0;
                right: 0;
                width: 420px;
                height: 100vh;
                z-index: 2147483647;
                transform: translateX(100%);
                transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: -4px 0 24px rgba(0, 0, 0, 0.08);
                background: #fafbfc;
                overflow: hidden;
            `;

            // Create shadow root for style isolation
            const shadow = container.attachShadow({ mode: 'open' });

            // Create React mount point
            const mountPoint = document.createElement('div');
            mountPoint.style.cssText = 'width: 100%; height: 100%;';
            shadow.appendChild(mountPoint);

            document.body.appendChild(container);

            // Mount React app
            panelRoot = ReactDOM.createRoot(mountPoint);
            renderPanel();

            console.log('AMZImage panel injected');
        }

        function renderPanel() {
            if (!panelRoot) return;

            panelRoot.render(
                createElement(PanelApp, {
                    onClose: togglePanel,
                    scrapeProductData: scrapeProductData,
                    downloadZip: async (urls: string[], filename: string) => {
                        try {
                            // Request ZIP data from background script
                            const response = await browser.runtime.sendMessage({
                                type: 'DOWNLOAD_ZIP',
                                urls,
                                filename
                            });

                            if (response && response.success && response.base64) {
                                // Create blob URL in UI context (content script has access to URL.createObjectURL)
                                const byteCharacters = atob(response.base64);
                                const byteNumbers = new Array(byteCharacters.length);
                                for (let i = 0; i < byteCharacters.length; i++) {
                                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                                }
                                const byteArray = new Uint8Array(byteNumbers);
                                const blob = new Blob([byteArray], { type: 'application/zip' });

                                // Create download link and trigger download
                                const blobUrl = URL.createObjectURL(blob);
                                const link = document.createElement('a');
                                link.href = blobUrl;
                                link.download = response.filename || `${filename}.zip`;
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);

                                // Cleanup
                                setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
                            } else {
                                throw new Error(response?.error || 'Failed to create ZIP');
                            }
                        } catch (error) {
                            console.error('Download failed:', error);
                            alert('Download failed. Please try again.');
                        }
                    }
                })
            );
        }


        function togglePanel() {
            const container = document.getElementById('amzimage-panel-container');
            if (container) {
                panelVisible = !panelVisible;
                container.style.transform = panelVisible ? 'translateX(0)' : 'translateX(100%)';
                console.log('Panel toggled:', panelVisible);

                // Re-render to refresh data when opening
                if (panelVisible) {
                    renderPanel();
                }
            }
        }

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
            const videos: string[] = [];
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

            // Product page specific scraping
            if (onProductPage) {
                // 1. Main Product Image
                const mainImg = document.querySelector<HTMLImageElement>(
                    '#landingImage, #imgBlkFront, #main-image, #ebooksImgBlkFront'
                );
                if (mainImg?.src) {
                    const highResSrc = mainImg.src.replace(/\._AC_.*_\./, '.');
                    if (!productImages.includes(highResSrc)) productImages.push(highResSrc);
                }

                // 2. High-Res from data-a-dynamic-image
                if (mainImg?.getAttribute('data-a-dynamic-image')) {
                    try {
                        const dynamicImages = JSON.parse(mainImg.getAttribute('data-a-dynamic-image') || '{}');
                        Object.keys(dynamicImages).forEach(url => {
                            const highRes = url.replace(/\._AC_.*_\./, '.');
                            if (!productImages.includes(highRes)) productImages.push(highRes);
                        });
                    } catch (e) {
                        console.error('Failed to parse dynamic images', e);
                    }
                }

                // 3. Carousel / Thumbnails (Product Images)
                const thumbnails = document.querySelectorAll<HTMLImageElement>(
                    '#altImages img, .av-image-carousel img, #imageBlock_feature_div img'
                );
                thumbnails.forEach((img) => {
                    let src = img.src;
                    // Skip video thumbnails
                    if (img.closest('.videoThumbnail') || src.includes('play-button')) return;
                    src = src.replace(/\._AC_.*_\./, '.').replace(/\._S.*_\./, '.');
                    if (src && src.startsWith('http') && !productImages.includes(src)) {
                        productImages.push(src);
                    }
                });

                // 4. Variant Images
                const variantImgs = document.querySelectorAll<HTMLImageElement>('.twister-hover-images img, #variation_color_name img');
                variantImgs.forEach((img) => {
                    let src = img.src.replace(/\._AC_.*_\./, '.').replace(/\._S.*_\./, '.');
                    if (src && src.startsWith('http') && !productImages.includes(src)) {
                        productImages.push(src);
                    }
                });

                // 5. Review Images
                const reviewImgElements = document.querySelectorAll<HTMLImageElement>(
                    '.review-image-tile, .cr-lightbox-image-thumbnail img, [data-hook="cr-media-gallery"] img'
                );
                reviewImgElements.forEach((img) => {
                    let src = img.src.replace(/\._S.*_\./, '.').replace(/\._AC_.*_\./, '.');
                    if (src && src.startsWith('http') && !reviewImages.includes(src)) {
                        reviewImages.push(src);
                    }
                });

                // 6. Videos - multiple sources
                const videoElements = document.querySelectorAll<HTMLElement>(
                    '.videoThumbnail, [data-video-url], .vse-video-thumbnail, .a-section.videoThumbnail'
                );
                videoElements.forEach((el) => {
                    const videoUrl = el.getAttribute('data-video-url') ||
                        el.querySelector('[data-video-url]')?.getAttribute('data-video-url');
                    if (videoUrl && !videos.includes(videoUrl)) {
                        videos.push(videoUrl);
                    }
                });

                // From page scripts (embedded videos)
                const scripts = document.querySelectorAll('script');
                scripts.forEach(script => {
                    const content = script.textContent || '';
                    // Look for mp4 URLs
                    const videoMatches = content.match(/"url":"(https:\/\/[^"]+\.mp4[^"]*)"/g);
                    if (videoMatches) {
                        videoMatches.forEach(match => {
                            const url = match.replace(/"url":"/, '').replace(/"$/, '');
                            if (!videos.includes(url)) videos.push(url);
                        });
                    }
                    // Look for video IDs
                    const videoIdMatches = content.match(/"videoId":"([^"]+)"/g);
                    if (videoIdMatches) {
                        videoIdMatches.forEach(match => {
                            const id = match.replace(/"videoId":"/, '').replace(/"$/, '');
                            const videoUrl = `https://www.amazon.com/vdp/id/${id}`;
                            if (!videos.includes(videoUrl)) videos.push(videoUrl);
                        });
                    }
                });
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
                listingProducts
            };
        }
    },
});
