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
 * Extracts the core Amazon image ID for deduplication.
 * Normalizes URL-encoded characters (e.g., %2B -> +) for consistent matching.
 */
function getImageCoreId(url: string): string {
    let decoded = url;
    try { decoded = decodeURIComponent(url); } catch { /* ignore */ }
    const match = decoded.match(/\/I\/([A-Za-z0-9\-+%]+)/);
    if (match) return match[1].split('.')[0];
    const parts = decoded.split('/');
    const filename = parts[parts.length - 1] || decoded;
    return filename.split('.')[0];
}

/**
 * Extracts a balanced JSON array from text, starting from a key.
 * Correctly handles nested brackets unlike regex-based extraction.
 * @param text - The text to search in
 * @param key - The key before the array (e.g., 'imageGalleryData', 'initial')
 * @returns The extracted JSON array string, or null if not found
 */
function extractBalancedArray(text: string, key: string): string | null {
    // Find the key, then the opening bracket
    const keyPattern = new RegExp(key + '\\s*:\\s*\\[');
    const keyMatch = keyPattern.exec(text);
    if (!keyMatch) return null;

    const startIdx = keyMatch.index + keyMatch[0].length - 1; // Position of opening [
    let depth = 0;

    for (let i = startIdx; i < text.length && i < startIdx + 500000; i++) {
        const ch = text[i];
        if (ch === '[') depth++;
        else if (ch === ']') {
            depth--;
            if (depth === 0) {
                return text.substring(startIdx, i + 1);
            }
        }
        // Skip over string content to avoid false bracket matches
        if (ch === '"') {
            i++;
            while (i < text.length && text[i] !== '"') {
                if (text[i] === '\\') i++; // Skip escaped chars
                i++;
            }
        }
    }
    return null;
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

/**
 * Removes technical noise from product/variant names like scales (1:24, 1/18, 1.24)
 * and technical prefixes that don't add meaningful info for the user.
 */
export function cleanTechnicalNoise(name: string): string {
    if (!name) return name;

    // Generic placeholder words to strip if they are the ONLY name or clearly noise
    const genericWords = ['product', 'default', 'item', 'option', 'variant', 'selection', 'none', 'n/a', 'empty'];
    const lower = name.toLowerCase().trim();
    if (genericWords.includes(lower)) return '';

    // Use a multi-pass approach to catch nested or complex technical prefixes
    let previous = '';
    let cleaned = name;

    for (let i = 0; i < 3; i++) { // Max 3 passes to avoid infinite loops
        previous = cleaned;
        cleaned = cleaned
            // 1. Remove ratio/scale patterns like "1:24", "1/24", "1:18", "1.24"
            .replace(/\b\d+[:/.]\d+(\s*(Scale|Ratio))?\b/gi, ' ')
            // 2. Remove common scale identifiers if they appear alone
            .replace(/\b\d+\s*(Scale|Ratio)\b/gi, ' ')
            // 3. Remove leading/trailing non-word noise
            .replace(/^[-\s:|./*+]{1,3}/, '')
            .replace(/[-\s:|./*+]{1,3}$/, '')
            // 4. Remove multiple spaces and trim
            .replace(/\s+/g, ' ')
            .trim();

        if (cleaned === previous) break;
    }

    return cleaned;
}

/**
 * Formats a variant name by prioritizing specific attributes and using a proper separator.
 * Detects and replaces generic names with meaningful attributes.
 */
export function formatVariantName(rawValues: string[], dimensionLabels: string[]): string {
    if (!rawValues || rawValues.length === 0) return '';

    // priority: color -> storage/capacity -> size -> model
    const genericWords = ['product', 'default', 'item', 'option', 'variant', 'selection', 'none', 'n/a', 'empty', 'style', 'color', 'size'];

    const attributeMap: Record<string, string> = {};

    // Attempt to map values to their labels if labels are provided
    rawValues.forEach((val, i) => {
        const label = (dimensionLabels[i] || `attr_${i}`).toLowerCase();
        attributeMap[label] = val.trim();
    });

    const isGenericValue = (val: string) => !val || genericWords.includes(val.toLowerCase().trim());

    // Priority extraction
    const parts: string[] = [];

    // 1. Color
    const colorKey = Object.keys(attributeMap).find(k => k.includes('color'));
    if (colorKey && attributeMap[colorKey] && !isGenericValue(attributeMap[colorKey])) {
        const val = cleanTechnicalNoise(attributeMap[colorKey]);
        if (val) parts.push(val);
    }

    // 2. Storage / Capacity
    const storageKey = Object.keys(attributeMap).find(k => k.includes('storage') || k.includes('capacity') || k.includes('memory'));
    if (storageKey && attributeMap[storageKey] && !isGenericValue(attributeMap[storageKey])) {
        const val = cleanTechnicalNoise(attributeMap[storageKey]);
        if (val && !parts.includes(val)) parts.push(val);
    }

    // 3. Size
    const sizeKey = Object.keys(attributeMap).find(k => k.includes('size') || k.includes('dimension'));
    if (sizeKey && attributeMap[sizeKey] && !isGenericValue(attributeMap[sizeKey])) {
        const val = cleanTechnicalNoise(attributeMap[sizeKey]);
        if (val && !parts.includes(val)) parts.push(val);
    }

    // 4. Model / Style
    const modelKey = Object.keys(attributeMap).find(k => k.includes('model') || k.includes('style'));
    if (modelKey && attributeMap[modelKey] && !isGenericValue(attributeMap[modelKey])) {
        const val = cleanTechnicalNoise(attributeMap[modelKey]);
        if (val && !parts.includes(val)) parts.push(val);
    }

    // 5. Fallback for any other meaningful attribute that wasn't covered but isn't generic
    Object.keys(attributeMap).forEach(k => {
        const val = attributeMap[k];
        if (val && !isGenericValue(val)) {
            const cleaned = cleanTechnicalNoise(val);
            if (cleaned && !parts.some(p => p.toLowerCase() === cleaned.toLowerCase())) {
                parts.push(cleaned);
            }
        }
    });

    if (parts.length > 0) {
        return parts.join(' / ');
    }

    // Final fallback: if everything was generic or filtered out, use the original values but clean them
    const cleanValues = rawValues
        .map(v => cleanTechnicalNoise(v))
        .filter(v => v && !isGenericValue(v));

    if (cleanValues.length > 0) return cleanValues.join(' / ');

    return '';
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
export function scrapeCurrentGalleryImages(): string[] {
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
    // Uses bracket-aware extraction to handle nested arrays
    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of Array.from(scripts)) {
        const content = script.textContent || '';
        if (content.includes('imageGalleryData')) {
            const arrayStr = extractBalancedArray(content, 'imageGalleryData');
            if (arrayStr) {
                try {
                    const data = JSON.parse(arrayStr);
                    data.forEach((item: any) => {
                        if (item.mediaType === 'image' && item.url) {
                            addImage(item.url);
                        }
                    });
                } catch { }
            }
        }
    }

    // Strategy 2: colorImages (Scoped to Current ASIN)
    // Only if Strategy 1 found nothing
    if (images.length === 0) {
        const currentAsin = getCurrentAsin();
        for (const script of Array.from(scripts)) {
            const content = script.textContent || '';
            if (content.includes('colorImages') || content.includes('ImageBlockATF')) {
                // Try ASIN-keyed first, then 'initial'
                const keys = [`"${currentAsin}"`, `'${currentAsin}'`, '"initial"', "'initial'"];
                for (const key of keys) {
                    const arrayStr = extractBalancedArray(content, key);
                    if (arrayStr) {
                        try {
                            const data = JSON.parse(arrayStr);
                            data.forEach((item: any) => {
                                const url = item.hiRes || item.large || item.mainUrl;
                                if (url && typeof url === 'string') addImage(url);
                            });
                        } catch {
                            // Fallback: regex extraction from the block
                            const hiResMatches = arrayStr.match(/["']hiRes["']\s*:\s*["'](https:\/\/[^"']+)["']/g);
                            if (hiResMatches) {
                                hiResMatches.forEach(m => {
                                    const urlMatch = m.match(/["'](https:\/\/[^"']+)["']/);
                                    if (urlMatch) addImage(urlMatch[1]);
                                });
                            }
                        }
                        if (images.length > 0) break;
                    }
                }
                if (images.length > 0) break;
            }
        }
    }

    // Strategy 3: DOM fallback (Only if JSON strategies found nothing)
    if (images.length === 0) {
        // Alt Images thumbnails (skip video thumbnails)
        document.querySelectorAll('#altImages ul li.item img').forEach(el => {
            const img = el as HTMLImageElement;
            const parentLi = img.closest('li');
            if (parentLi) {
                // Skip video thumbnails
                const isVideoThumb = parentLi.classList.contains('videoThumbnail') ||
                    parentLi.querySelector('.vse-video-thumbnail-flyover, input[type="hidden"]') !== null;
                if (isVideoThumb) return;
            }
            addImage(img.src);
        });

        // Main landing image
        const mainImg = document.querySelector('#landingImage, #imgTagWrapperId img') as HTMLImageElement;
        if (mainImg?.src) addImage(mainImg.src);

        // data-a-dynamic-image (targeted containers)
        document.querySelectorAll(
            '#main-image-container, #landingImage, #imgTagWrapperId, .imgTagWrapper, #imageBlock'
        ).forEach(container => {
            const data = container.getAttribute('data-a-dynamic-image');
            if (data) {
                try {
                    const parsed = JSON.parse(data);
                    Object.keys(parsed).forEach(url => addImage(url));
                } catch { }
            }
        });
    }

    return images;
}

/**
 * Scrapes official product videos from "Videos for this product" section
 */
export function scrapeCurrentGalleryVideos(): string[] {
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
    let foundGalleryData = false;

    // Strategy 1: imageGalleryData (Authoritative - Contains video entries)
    for (const script of Array.from(scripts)) {
        const content = script.textContent || '';
        if (content.includes('imageGalleryData')) {
            const arrayStr = extractBalancedArray(content, 'imageGalleryData');
            if (arrayStr) {
                foundGalleryData = true;
                try {
                    const data = JSON.parse(arrayStr);
                    data.forEach((item: any) => {
                        if (item.mediaType === 'video' && item.url) {
                            addVideo(item.url);
                        }
                    });
                } catch { }
            }
        }
    }

    // Only fall back to other strategies if imageGalleryData was NOT found
    if (!foundGalleryData) {
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
    }

    return videos;
}

/**
 * Extracts all variant ASINs and their basic info from the page
 */
export function extractAllVariantInfo(): Map<string, { name: string; thumbnail: string; available: boolean }> {
    const variants = new Map<string, { name: string; thumbnail: string; available: boolean }>();

    // Strategy 1: dimensionValuesDisplayData (Most reliable for all variants)
    const scripts = document.querySelectorAll('script:not([src])');
    const dimensionValues: Record<string, string[]> = {};
    let dimensionLabels: string[] = [];

    for (const script of Array.from(scripts)) {
        const content = script.textContent || '';

        // 1a. Extract Labels (Priority)
        if (content.includes('variationDisplayLabels') || content.includes('dimensions')) {
            const labelsMatch = content.match(/variationDisplayLabels\s*:\s*(\[.*?\])/) ||
                content.match(/dimensions\s*:\s*(\[.*?\])/);
            if (labelsMatch) {
                try {
                    // Manual parse if JSON.parse fails due to single quotes
                    const raw = labelsMatch[1].replace(/'/g, '"');
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) dimensionLabels = parsed;
                } catch {
                    // Regex fallback for labels
                    const labels = labelsMatch[1].match(/"([^"]+)"|'([^']+)'/g);
                    if (labels) dimensionLabels = labels.map(l => l.replace(/["']/g, ''));
                }
            }
        }

        // 1b. Extract Values
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
            let name = '';
            const values = dimensionValues[asin];

            if (values && values.length > 0) {
                name = formatVariantName(values, dimensionLabels);
            }

            if (!name) {
                const colorValue = Object.keys(colorToAsin).find(k => colorToAsin[k] === asin);
                if (colorValue) name = formatVariantName([colorValue], ['color']);
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
            const name = formatVariantName(values, dimensionLabels) || `Variant ${asin}`;
            variants.set(asin, {
                name,
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
        // STRICT PRIORITY CASCADE: Use the FIRST strategy that yields results.
        // This prevents cross-source duplicates.

        // Strategy A: imageGalleryData (Most authoritative)
        // Uses bracket-aware extraction to handle nested arrays like dimensions: [100, 200]
        const galleryArrayStr = extractBalancedArray(html, 'imageGalleryData');
        if (galleryArrayStr) {
            try {
                const data = JSON.parse(galleryArrayStr);
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

        // Strategy B: colorImages "initial" or ASIN-keyed (Only if A found nothing)
        if (result.images.length === 0) {
            const keys = [`"${asin}"`, `'${asin}'`, '"initial"', "'initial'"];
            for (const key of keys) {
                const arrayStr = extractBalancedArray(html, key);
                if (arrayStr) {
                    try {
                        const data = JSON.parse(arrayStr);
                        data.forEach((item: any) => {
                            const url = item.hiRes || item.large || item.mainUrl;
                            if (url && typeof url === 'string') {
                                const highRes = toHighResImage(url);
                                const id = getImageCoreId(highRes);
                                if (isValidProductImage(highRes) && !seenImageIds.has(id)) {
                                    seenImageIds.add(id);
                                    result.images.push(highRes);
                                }
                            }
                        });
                    } catch {
                        // Fallback: regex extraction from the balanced block
                        const hiResMatches = arrayStr.match(/["']hiRes["']\s*:\s*["'](https:\/\/[^"']+)["']/g);
                        if (hiResMatches) {
                            hiResMatches.forEach(m => {
                                const urlMatch = m.match(/["'](https:\/\/[^"']+)["']/);
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
                    if (result.images.length > 0) break; // Found data, stop
                }
            }
        }

        // Strategy C: DOM Parser (Only if JSON strategies found nothing)
        if (result.images.length === 0) {
            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                // Alt Images thumbnails (skip video thumbnails)
                doc.querySelectorAll('#altImages ul li img, #altImages .a-list-item img').forEach(el => {
                    const img = el as HTMLImageElement;
                    const parentLi = img.closest('li');
                    if (parentLi) {
                        // Skip video thumbnails
                        const isVideoThumb = parentLi.classList.contains('videoThumbnail') ||
                            parentLi.querySelector('.vse-video-thumbnail-flyover, input[type="hidden"]') !== null;
                        if (isVideoThumb) return;
                    }
                    const src = img.getAttribute('src') || img.getAttribute('data-src');
                    if (src) {
                        const url = toHighResImage(src);
                        const id = getImageCoreId(url);
                        if (isValidProductImage(url) && !seenImageIds.has(id)) {
                            seenImageIds.add(id);
                            result.images.push(url);
                        }
                    }
                });

                // Main Landing Image
                if (result.images.length === 0) {
                    const landing = doc.querySelector('#landingImage, #imgTagWrapperId img');
                    if (landing) {
                        const src = landing.getAttribute('src') || landing.getAttribute('data-src');
                        if (src) {
                            const url = toHighResImage(src);
                            const id = getImageCoreId(url);
                            if (isValidProductImage(url) && !seenImageIds.has(id)) {
                                seenImageIds.add(id);
                                result.images.push(url);
                            }
                        }
                    }
                }
            } catch { }
        }

        // ========== EXTRACT VIDEOS ==========
        // STRICT PRIORITY CASCADE: If imageGalleryData exists, it is the SOLE authority
        // for what's in the official gallery (both images AND videos). 
        // Only fall back to other strategies if imageGalleryData was absent.

        // Strategy A: imageGalleryData videos (Authoritative)
        if (galleryArrayStr) {
            try {
                const data = JSON.parse(galleryArrayStr);
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
            // DO NOT fall through — galleryData is authoritative, even if 0 videos found
        } else {
            // Only use fallback strategies when imageGalleryData is absent

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
        const titleEl = document.querySelector('#productTitle');
        let name = cleanTechnicalNoise(titleEl?.textContent?.trim() || 'Product');
        if (!name || name.toLowerCase() === 'product') name = 'Default Option';

        return [{
            asin: currentAsin,
            name,
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
