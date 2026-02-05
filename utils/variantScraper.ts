/**
 * FRESH VARIANT MEDIA SCRAPER
 * Version 3.0.0 - Complete Rewrite
 * 
 * This scraper extracts ONLY official product gallery media for each variant:
 * - Images: From the official Images gallery section
 * - Videos: From the "Videos for this product" section (official merchant videos only)
 * 
 * STRICTLY EXCLUDES:
 * - Customer-uploaded images and videos
 * - Review media
 * - Brand story / A+ content videos
 * - Related/recommended product media
 */

export interface VariantItem {
    asin: string;
    name: string;
    image: string;           // Thumbnail/swatch image
    images: string[];        // Official gallery images
    videos: string[];        // Official product videos
    selected: boolean;
    available: boolean;
    isLoading?: boolean;
}

interface VariantMediaMap {
    images: string[];
    videos: string[];
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Extracts the core Amazon image ID for deduplication
 */
function getImageCoreId(url: string): string {
    const match = url.match(/\/I\/([A-Za-z0-9\-+%]+)/);
    if (match) return match[1].split('.')[0];
    const parts = url.split('/');
    const filename = parts[parts.length - 1] || url;
    return filename.split('.')[0];
}

/**
 * Extracts video ID from URL for deduplication
 */
function getVideoCoreId(url: string): string {
    try {
        const parsed = new URL(url);
        return parsed.pathname;
    } catch {
        return url.split('?')[0];
    }
}

/**
 * Converts any Amazon image URL to maximum quality (removes size constraints)
 */
function toHighResImage(url: string): string {
    if (!url) return '';
    return url
        .replace(/\._[A-Z]{2,4}[0-9]+_/, '')      // _SS40_, _SX100_, etc.
        .replace(/\._AC_[A-Za-z0-9,_]+_\./, '.')  // _AC_SL1500_
        .replace(/\._[A-Z]+[0-9]+_\./, '.');      // _SY300_, _SX200_
}

/**
 * Validates if a URL is a proper Amazon product image (not placeholder/icon)
 */
function isValidProductImage(url: string): boolean {
    if (!url || !url.startsWith('http')) return false;
    const lower = url.toLowerCase();

    // Exclude non-product images
    const excludePatterns = [
        'sprite', 'play-icon', 'video-icon', 'grey-pixel', 'transparent',
        'loading', 'placeholder', 'spinner', 'arrow', 'button', 'icon',
        'badge', 'logo', 'banner', 'promo', 'ad-', 'advertisement'
    ];

    if (excludePatterns.some(p => lower.includes(p))) return false;

    // Must be an image file
    if (!lower.includes('/images/') && !lower.includes('/i/')) return false;

    return true;
}

/**
 * Validates if a URL is an official product video (not customer/brand story)
 */
function isOfficialProductVideo(url: string): boolean {
    if (!url || !url.startsWith('http')) return false;
    const lower = url.toLowerCase();

    // Must be a video format
    if (!lower.includes('.mp4') && !lower.includes('.m3u8') && !lower.includes('.webm')) {
        return false;
    }

    // STRICT exclusions for non-official videos
    const excludePatterns = [
        'brand-story', 'brand_story', 'brandstory',
        'aplus', 'a-plus', 'a_plus', 'a-content',
        'customer-review', 'customerreview', 'review-video', 'reviewvideo',
        'ugc', 'usermedia', 'user-media',
        'cr-media', 'crmedia', 'crwidget', 'customer-media',
        'sponsored', 'advertisement', 'promo',
        'similar', 'compare', 'related', 'recommended',
        'influencer', 'third-party', 'thirdparty', 'external'
    ];

    if (excludePatterns.some(p => lower.includes(p))) return false;

    return true;
}

/**
 * Safely parse JSON with error handling
 */
function safeParseJSON<T>(jsonStr: string): T | null {
    try {
        const cleaned = jsonStr
            .replace(/'/g, '"')
            .replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) =>
                String.fromCharCode(parseInt(hex, 16))
            );
        return JSON.parse(cleaned);
    } catch {
        return null;
    }
}

// ============================================
// CORE SCRAPING FUNCTIONS
// ============================================

/**
 * Gets the currently selected ASIN from the page
 */
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

/**
 * Scrapes official gallery images for the CURRENT variant from the DOM
 */
function scrapeCurrentGalleryImages(): string[] {
    const images: string[] = [];
    const seenIds = new Set<string>();

    const addImage = (url: string) => {
        if (!isValidProductImage(url)) return;
        const highRes = toHighResImage(url);
        const id = getImageCoreId(highRes);
        if (!seenIds.has(id)) {
            seenIds.add(id);
            images.push(highRes);
        }
    };

    // Strategy 1: imageGalleryData (Most complete - contains ALL gallery images)
    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of Array.from(scripts)) {
        const content = script.textContent || '';
        if (content.includes('imageGalleryData')) {
            const match = content.match(/imageGalleryData\s*:\s*(\[[^\]]+\])/);
            if (match) {
                try {
                    const data = JSON.parse(match[1]);
                    data.forEach((item: any) => {
                        if (item.mediaType === 'image' && item.url) {
                            addImage(item.url);
                        }
                    });
                } catch { }
            }
        }
    }

    // Strategy 2: Alt Images thumbnails (Visible in gallery)
    document.querySelectorAll('#altImages ul li.item img').forEach(img => {
        addImage((img as HTMLImageElement).src);
    });

    // Strategy 3: Main landing image
    const mainImg = document.querySelector('#landingImage, #imgTagWrapperId img') as HTMLImageElement;
    if (mainImg?.src) addImage(mainImg.src);

    // Strategy 4: data-a-dynamic-image attribute (High-res candidates)
    const dynamicContainers = document.querySelectorAll(
        '#main-image-container, #landingImage, #imgTagWrapperId, .imgTagWrapper, #imageBlock'
    );
    dynamicContainers.forEach(container => {
        const data = container.getAttribute('data-a-dynamic-image');
        if (data) {
            try {
                const parsed = JSON.parse(data);
                Object.keys(parsed).forEach(url => addImage(url));
            } catch { }
        }
    });

    return images;
}

/**
 * Scrapes official product videos from "Videos for this product" section
 */
function scrapeCurrentGalleryVideos(): string[] {
    const videos: string[] = [];
    const seenIds = new Set<string>();

    const addVideo = (url: string) => {
        if (!isOfficialProductVideo(url)) return;
        const cleanUrl = url.replace(/\\u002F/g, '/').replace(/\\/g, '').replace(/"/g, '');
        const id = getVideoCoreId(cleanUrl);
        if (!seenIds.has(id)) {
            seenIds.add(id);
            videos.push(cleanUrl);
        }
    };

    const scripts = document.querySelectorAll('script:not([src])');

    // Strategy 1: imageGalleryData (Contains video entries)
    for (const script of Array.from(scripts)) {
        const content = script.textContent || '';
        if (content.includes('imageGalleryData')) {
            const match = content.match(/imageGalleryData\s*:\s*(\[[^\]]+\])/);
            if (match) {
                try {
                    const data = JSON.parse(match[1]);
                    data.forEach((item: any) => {
                        if (item.mediaType === 'video' && item.url) {
                            addVideo(item.url);
                        }
                    });
                } catch { }
            }
        }
    }

    // Strategy 2: Official gallery script blocks (ImageBlockATF, colorImages)
    for (const script of Array.from(scripts)) {
        const content = script.textContent || '';
        if (content.includes('ImageBlockATF') || content.includes('colorImages') || content.includes('altImages')) {
            const videoMatches = content.match(/https?:\/\/[^"'\s]*?\.(mp4|m3u8|webm)[^"'\s]*/gi);
            if (videoMatches) {
                videoMatches.forEach(url => addVideo(url));
            }
        }
    }

    // Strategy 3: VSE Video Data (Amazon's video player)
    for (const script of Array.from(scripts)) {
        const content = script.textContent || '';
        const vsePatterns = [
            /"vseVideoData"\s*:\s*(\[[^\]]*\])/,
            /"videoList"\s*:\s*(\[[^\]]*\])/
        ];

        for (const pattern of vsePatterns) {
            const match = content.match(pattern);
            if (match) {
                const block = match[1].toLowerCase();
                // Skip if this is brand/customer content
                if (block.includes('brandstory') || block.includes('customer') || block.includes('review')) {
                    continue;
                }
                const urls = match[1].match(/https?:\/\/[^"'\s,\]]+\.(mp4|m3u8|webm)[^"'\s,\]]*/gi);
                if (urls) {
                    urls.forEach(url => addVideo(url));
                }
            }
        }
    }

    return videos;
}

/**
 * Extracts all variant ASINs and their basic info from the page
 */
function extractAllVariantInfo(): Map<string, { name: string; thumbnail: string; available: boolean }> {
    const variants = new Map<string, { name: string; thumbnail: string; available: boolean }>();

    // Strategy 1: dimensionValuesDisplayData (Most reliable for all variants)
    const scripts = document.querySelectorAll('script:not([src])');
    const dimensionValues: Record<string, string[]> = {};

    for (const script of Array.from(scripts)) {
        const content = script.textContent || '';
        if (content.includes('dimensionValuesDisplayData')) {
            const asinPattern = /"([A-Z0-9]{10})"\s*:\s*\[(.*?)\]/g;
            let m;
            while ((m = asinPattern.exec(content))) {
                dimensionValues[m[1]] = m[2]
                    .split(',')
                    .map(v => v.replace(/"/g, '').trim())
                    .filter(v => v);
            }
        }
    }

    // Strategy 2: colorToAsin mapping
    const colorToAsin: Record<string, string> = {};
    for (const script of Array.from(scripts)) {
        const content = script.textContent || '';
        if (content.includes('colorToAsin')) {
            const match = content.match(/colorToAsin["']?\s*:\s*(\{[^}]+\})/);
            if (match) {
                const parsed = safeParseJSON<Record<string, any>>(match[1]);
                if (parsed) {
                    Object.entries(parsed).forEach(([k, v]) => {
                        colorToAsin[k] = typeof v === 'string' ? v : v.asin;
                    });
                }
            }
        }
    }

    // Strategy 3: DOM swatch elements
    const swatchContainer = document.querySelector(
        '#twister, #twisterContainer, #softlinesTwister, #tmmSwatches, [id^="variation_"]'
    );

    if (swatchContainer) {
        swatchContainer.querySelectorAll('[data-asin], [data-defaultasin]').forEach(el => {
            const asin = el.getAttribute('data-asin') || el.getAttribute('data-defaultasin');
            if (!asin) return;

            let thumbnail = '';
            const img = el.querySelector('img') as HTMLImageElement;
            if (img?.src) {
                thumbnail = toHighResImage(img.src);
            }

            const isUnavailable = el.classList.contains('swatchUnavailable') ||
                el.classList.contains('unavailable');

            // Get name from dimension values or color mapping
            let name = dimensionValues[asin]?.join(' + ') || '';
            if (!name) {
                const colorName = Object.keys(colorToAsin).find(k => colorToAsin[k] === asin);
                if (colorName) name = colorName;
            }
            if (!name) name = `Variant ${asin}`;

            variants.set(asin, {
                name,
                thumbnail,
                available: !isUnavailable
            });
        });
    }

    // Add variants from dimensionValues that weren't in DOM
    Object.entries(dimensionValues).forEach(([asin, values]) => {
        if (!variants.has(asin)) {
            variants.set(asin, {
                name: values.join(' + ') || `Variant ${asin}`,
                thumbnail: '',
                available: true
            });
        }
    });

    return variants;
}

/**
 * Fetches official gallery media for a specific variant ASIN via HTTP
 */
async function fetchVariantMedia(asin: string): Promise<VariantMediaMap> {
    const result: VariantMediaMap = { images: [], videos: [] };
    const seenImageIds = new Set<string>();
    const seenVideoIds = new Set<string>();

    try {
        const response = await fetch(`/dp/${asin}?psc=1`);
        if (!response.ok) return result;

        const html = await response.text();

        // ========== EXTRACT IMAGES ==========

        // Strategy A: imageGalleryData (Best source)
        const galleryMatch = html.match(/imageGalleryData\s*:\s*(\[[^\]]+\])/);
        if (galleryMatch) {
            try {
                const data = JSON.parse(galleryMatch[1]);
                data.forEach((item: any) => {
                    if (item.mediaType === 'image' && item.url) {
                        const highRes = toHighResImage(item.url);
                        const id = getImageCoreId(highRes);
                        if (isValidProductImage(highRes) && !seenImageIds.has(id)) {
                            seenImageIds.add(id);
                            result.images.push(highRes);
                        }
                    }
                });
            } catch { }
        }

        // Strategy B: ImageBlockATF hiRes
        if (result.images.length === 0) {
            const scriptMatch = html.match(/<script[^>]*>[\s\S]*?ImageBlockATF[\s\S]*?<\/script>/gi);
            if (scriptMatch) {
                scriptMatch.forEach(block => {
                    const hiResMatches = block.match(/"hiRes"\s*:\s*"(https:\/\/[^"]+)"/g);
                    if (hiResMatches) {
                        hiResMatches.forEach(m => {
                            const urlMatch = m.match(/"(https:\/\/[^"]+)"/);
                            if (urlMatch) {
                                const url = toHighResImage(urlMatch[1]);
                                const id = getImageCoreId(url);
                                if (isValidProductImage(url) && !seenImageIds.has(id)) {
                                    seenImageIds.add(id);
                                    result.images.push(url);
                                }
                            }
                        });
                    }
                });
            }
        }

        // Strategy C: colorImages data
        if (result.images.length === 0) {
            const colorMatch = html.match(/'colorImages'\s*:\s*(\{[\s\S]*?\})\s*,/);
            if (colorMatch) {
                const hiResMatches = colorMatch[1].match(/"hiRes"\s*:\s*"(https:\/\/[^"]+)"/g);
                if (hiResMatches) {
                    hiResMatches.forEach(m => {
                        const urlMatch = m.match(/"(https:\/\/[^"]+)"/);
                        if (urlMatch) {
                            const url = toHighResImage(urlMatch[1]);
                            const id = getImageCoreId(url);
                            if (isValidProductImage(url) && !seenImageIds.has(id)) {
                                seenImageIds.add(id);
                                result.images.push(url);
                            }
                        }
                    });
                }
            }
        }

        // Strategy D: data-a-dynamic-image
        if (result.images.length === 0) {
            const dynamicMatch = html.match(/data-a-dynamic-image\s*=\s*"([^"]+)"/);
            if (dynamicMatch) {
                try {
                    const decoded = dynamicMatch[1].replace(/&quot;/g, '"').replace(/&#34;/g, '"');
                    const parsed = JSON.parse(decoded);
                    Object.keys(parsed).forEach(url => {
                        const highRes = toHighResImage(url);
                        const id = getImageCoreId(highRes);
                        if (isValidProductImage(highRes) && !seenImageIds.has(id)) {
                            seenImageIds.add(id);
                            result.images.push(highRes);
                        }
                    });
                } catch { }
            }
        }

        // ========== EXTRACT VIDEOS ==========

        // Strategy A: imageGalleryData videos
        if (galleryMatch) {
            try {
                const data = JSON.parse(galleryMatch[1]);
                data.forEach((item: any) => {
                    if (item.mediaType === 'video' && item.url) {
                        const url = item.url.replace(/\\u002F/g, '/').replace(/\\/g, '');
                        const id = getVideoCoreId(url);
                        if (isOfficialProductVideo(url) && !seenVideoIds.has(id)) {
                            seenVideoIds.add(id);
                            result.videos.push(url);
                        }
                    }
                });
            } catch { }
        }

        // Strategy B: Gallery script video URLs
        const galleryScriptMatch = html.match(/<script[^>]*>[\s\S]*?(?:ImageBlockATF|altImages|colorImages)[\s\S]*?<\/script>/gi);
        if (galleryScriptMatch) {
            galleryScriptMatch.forEach(block => {
                const videoUrls = block.match(/https?:\/\/[^"'\s]*?\.(mp4|m3u8|webm)[^"'\s]*/gi);
                if (videoUrls) {
                    videoUrls.forEach(url => {
                        const cleanUrl = url.replace(/\\u002F/g, '/').replace(/\\/g, '').replace(/"/g, '');
                        const id = getVideoCoreId(cleanUrl);
                        if (isOfficialProductVideo(cleanUrl) && !seenVideoIds.has(id)) {
                            seenVideoIds.add(id);
                            result.videos.push(cleanUrl);
                        }
                    });
                }
            });
        }

        // Strategy C: VSE Video Data
        const vsePatterns = [
            /"vseVideoData"\s*:\s*(\[[^\]]*\])/,
            /"videoList"\s*:\s*(\[[^\]]*\])/
        ];

        for (const pattern of vsePatterns) {
            const match = html.match(pattern);
            if (match) {
                const block = match[1].toLowerCase();
                if (block.includes('brandstory') || block.includes('customer') || block.includes('review')) {
                    continue;
                }
                const urls = match[1].match(/https?:\/\/[^"'\s,\]]+\.(mp4|m3u8|webm)[^"'\s,\]]*/gi);
                if (urls) {
                    urls.forEach(url => {
                        const cleanUrl = url.replace(/\\u002F/g, '/').replace(/\\/g, '');
                        const id = getVideoCoreId(cleanUrl);
                        if (isOfficialProductVideo(cleanUrl) && !seenVideoIds.has(id)) {
                            seenVideoIds.add(id);
                            result.videos.push(cleanUrl);
                        }
                    });
                }
            }
        }

    } catch (e) {
        console.warn(`Failed to fetch media for ${asin}:`, e);
    }

    return result;
}

// ============================================
// MAIN EXPORT FUNCTIONS
// ============================================

/**
 * Scrapes all variant information and their media.
 * This is the primary entry point for the content script.
 * 
 * @returns Promise<VariantItem[]> - Complete list of variants with their media
 */
export async function scrapeAllVariantsWithMedia(): Promise<VariantItem[]> {
    const currentAsin = getCurrentAsin();
    const variantInfo = extractAllVariantInfo();

    // If no variants found, create a single entry for the current product
    if (variantInfo.size === 0 && currentAsin) {
        const currentImages = scrapeCurrentGalleryImages();
        const currentVideos = scrapeCurrentGalleryVideos();
        const mainImg = document.querySelector('#landingImage') as HTMLImageElement;

        return [{
            asin: currentAsin,
            name: 'Product',
            image: mainImg?.src ? toHighResImage(mainImg.src) : (currentImages[0] || ''),
            images: currentImages,
            videos: currentVideos,
            selected: true,
            available: true,
            isLoading: false
        }];
    }

    // Fetch media for all variants in parallel (fast loading)
    const allAsins = Array.from(variantInfo.keys());
    const mediaPromises = allAsins.map(asin =>
        asin === currentAsin
            ? Promise.resolve({
                images: scrapeCurrentGalleryImages(),
                videos: scrapeCurrentGalleryVideos()
            })
            : fetchVariantMedia(asin)
    );

    const mediaResults = await Promise.all(mediaPromises);

    // Build final variant list
    const variants: VariantItem[] = allAsins.map((asin, index) => {
        const info = variantInfo.get(asin)!;
        const media = mediaResults[index];

        return {
            asin,
            name: info.name,
            image: info.thumbnail || media.images[0] || '',
            images: media.images,
            videos: media.videos,
            selected: asin === currentAsin,
            available: info.available,
            isLoading: false
        };
    });

    return variants;
}

/**
 * Quick synchronous scrape of basic variant info (for immediate UI render)
 * Does NOT include full media - use scrapeAllVariantsWithMedia for complete data
 */
export function scrapeVariantsQuick(): VariantItem[] {
    const currentAsin = getCurrentAsin();
    const variantInfo = extractAllVariantInfo();

    if (variantInfo.size === 0 && currentAsin) {
        const mainImg = document.querySelector('#landingImage') as HTMLImageElement;
        return [{
            asin: currentAsin,
            name: 'Product',
            image: mainImg?.src ? toHighResImage(mainImg.src) : '',
            images: [],
            videos: [],
            selected: true,
            available: true,
            isLoading: true
        }];
    }

    return Array.from(variantInfo.entries()).map(([asin, info]) => ({
        asin,
        name: info.name,
        image: info.thumbnail,
        images: [],
        videos: [],
        selected: asin === currentAsin,
        available: info.available,
        isLoading: true
    }));
}

/**
 * Gets media for a specific variant by ASIN
 * Uses DOM if it's the current variant, otherwise fetches via HTTP
 */
export async function getVariantMedia(asin: string): Promise<VariantMediaMap> {
    const currentAsin = getCurrentAsin();

    if (asin === currentAsin) {
        return {
            images: scrapeCurrentGalleryImages(),
            videos: scrapeCurrentGalleryVideos()
        };
    }

    return fetchVariantMedia(asin);
}

// Legacy export for backward compatibility
export function scrapeVariants(): VariantItem[] {
    return scrapeVariantsQuick();
}
