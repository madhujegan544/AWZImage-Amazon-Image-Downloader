/**
 * variantScraper.ts
 * =================
 * Robust utility for scraping Amazon product variants and their associated images.
 * This module uses multiple data sources from Amazon's page structure to reliably
 * map each product variant (ASIN) to its full image gallery.
 *
 * Data sources used (in order of priority):
 * 1. colorToAsin: Direct mapping { ColorName -> ASIN }
 * 2. colorImages: Image galleries { ColorName -> [ImageObjects] }
 * 3. dimensionValuesDisplayData: Combined names { ASIN -> ["Size", "Color"] }
 * 4. DOM Fallback: Visible swatch elements
 */

export interface VariantItem {
    name: string;
    asin: string;
    image?: string;          // Thumbnail for card display
    images?: string[];       // Full gallery for download
    selected: boolean;
    available: boolean;
}

interface ColorImageEntry {
    hiRes?: string;
    large?: string;
    main?: string | Record<string, string>;
}

/**
 * Extracts high-resolution image URL from an image entry object.
 */
function extractImageUrl(entry: ColorImageEntry): string {
    if (entry.hiRes) return entry.hiRes;
    if (entry.large) return entry.large;
    if (typeof entry.main === 'string') return entry.main;
    if (typeof entry.main === 'object' && entry.main) {
        const values = Object.values(entry.main);
        if (values.length > 0) return values[0];
    }
    return '';
}

/**
 * Extracts the core alphanumeric image ID for deduplication.
 * Only captures the alphanumeric portion before any size/format suffixes.
 */
function getImageCoreId(url: string): string {
    // Match only alphanumeric characters (stops at first hyphen, underscore, or dot after initial ID)
    const match = url.match(/images\/I\/([A-Za-z0-9]+)/);
    return match ? match[1] : url.split('?')[0];
}

/**
 * Safely parses JSON with error handling and common cleanup.
 */
function safeParseJSON<T>(jsonStr: string): T | null {
    try {
        // Clean up common issues
        const cleaned = jsonStr
            .replace(/'/g, '"')
            .replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        return JSON.parse(cleaned);
    } catch {
        return null;
    }
}

/**
 * Scrapes the currently visible image gallery from the DOM.
 * This is a fallback/supplement to JSON parsing that guarantees
 * we capture all images for the currently displayed product.
 */
function scrapeCurrentDOMGallery(): string[] {
    const images: string[] = [];
    const seenBases = new Set<string>();

    // Helper to get image base for deduplication (uses same pattern as getImageCoreId)
    const getBase = (url: string): string => {
        const match = url.match(/images\/I\/([A-Za-z0-9]+)/);
        return match ? match[1] : url;
    };

    // Helper to convert to high-res
    const toHighRes = (url: string): string => {
        if (!url) return '';
        return url
            .replace(/\._[A-Z]{2}_[A-Za-z0-9,_]+_\./, '.')
            .replace(/\._AC_.*_\./, '.')
            .replace(/\._S[A-Z0-9]+_\./, '.')
            .replace(/\._U[A-Z0-9]+_\./, '.')
            .replace(/\._CR[0-9,]+_\./, '.')
            .replace(/\._X[A-Z0-9]+_\./, '.');
    };

    // Helper to validate image URL
    const isValid = (url: string | null | undefined): boolean => {
        if (!url || !url.startsWith('http')) return false;
        const lower = url.toLowerCase();
        if (lower.includes('.svg') || lower.includes('sprite') || lower.includes('transparent') ||
            lower.includes('pixel') || lower.includes('placeholder') || lower.includes('icon') ||
            lower.includes('logo') || lower.includes('play-button') || lower.includes('zoom') ||
            lower.includes('review') || lower.includes('customer') || lower.includes('user-media')) {
            return false;
        }
        return true;
    };

    // 1. Primary: #altImages thumbnails (most reliable)
    const altImages = document.querySelectorAll('#altImages img, #imageBlock img, .regularAltImageViewLayout img');
    altImages.forEach(img => {
        // Try data-a-dynamic-image first (contains all resolutions)
        const dynamicData = img.getAttribute('data-a-dynamic-image');
        if (dynamicData) {
            try {
                const parsed = JSON.parse(dynamicData);
                const urls = Object.keys(parsed);
                // Get the largest resolution
                if (urls.length > 0) {
                    const best = urls.sort((a, b) => {
                        const [w1, h1] = parsed[a];
                        const [w2, h2] = parsed[b];
                        return (w2 * h2) - (w1 * h1);
                    })[0];
                    if (isValid(best)) {
                        const base = getBase(best);
                        if (!seenBases.has(base)) {
                            seenBases.add(base);
                            images.push(best);
                        }
                    }
                }
            } catch (e) { /* ignore */ }
        }

        // Fallback: use src directly
        const src = (img as HTMLImageElement).src;
        if (isValid(src)) {
            const hiRes = toHighRes(src);
            const base = getBase(hiRes);
            if (!seenBases.has(base)) {
                seenBases.add(base);
                images.push(hiRes);
            }
        }
    });

    // 2. Landing image (main product image)
    const landingImg = document.querySelector('#landingImage, #imgBlkFront') as HTMLImageElement | null;
    if (landingImg) {
        const dynamicData = landingImg.getAttribute('data-a-dynamic-image');
        if (dynamicData) {
            try {
                const parsed = JSON.parse(dynamicData);
                const urls = Object.keys(parsed);
                if (urls.length > 0) {
                    const best = urls.sort((a, b) => {
                        const [w1, h1] = parsed[a];
                        const [w2, h2] = parsed[b];
                        return (w2 * h2) - (w1 * h1);
                    })[0];
                    if (isValid(best)) {
                        const base = getBase(best);
                        if (!seenBases.has(base)) {
                            seenBases.add(base);
                            images.unshift(best); // Add as first image
                        }
                    }
                }
            } catch (e) { /* ignore */ }
        }

        if (landingImg.src && isValid(landingImg.src)) {
            const hiRes = toHighRes(landingImg.src);
            const base = getBase(hiRes);
            if (!seenBases.has(base)) {
                seenBases.add(base);
                images.unshift(hiRes);
            }
        }
    }

    // 3. Image gallery data from scripts and lazy-loaders
    // RESTRICTED SCOPE: We must be very careful not to grab review images or ads.
    const galleryItems = document.querySelectorAll('[data-a-image-source], .imageThumbnail, .lazy, [data-lazy-src], [data-src]');

    // Selectors for elements we definitively do NOT want
    const excludedContainers = [
        '#customer-reviews',
        '#reviews-medley-footer',
        '#aplus',
        '.aplus-v2',
        '#service-capabilities',
        '.askDetailPageWidget',
        '#similarities_feature_div',
        '#sponsoredProducts',
        '.ad-holder',
        '.review-image-tile',
        '#vse-related-videos',
        '.cr-media-gallery',
        '[data-hook="review-image-tile"]'
    ];

    galleryItems.forEach(item => {
        // STRICT FILTER: If the item is inside any excluded container, skip it immediately
        if (excludedContainers.some(selector => item.closest(selector))) {
            return;
        }

        // Additional safeguard: verify it's likely within a product image-related area
        // if it doesn't have an obvious "gallery" attribute
        const isExplicitGalleryItem = item.hasAttribute('data-a-image-source') || item.classList.contains('imageThumbnail');
        if (!isExplicitGalleryItem) {
            // If it's just a generic lazy loaded image, ensure it is in a likely product container
            const productContainers = ['#imageBlock', '#altImages', '#main-image-container', '.regularAltImageViewLayout'];
            if (!productContainers.some(selector => item.closest(selector))) {
                // If not in a known product container, be safe and skip
                return;
            }
        }

        const src = item.getAttribute('data-a-image-source') ||
            item.getAttribute('data-lazy-src') ||
            item.getAttribute('data-src') ||
            (item.tagName === 'IMG' ? (item as HTMLImageElement).src : '');

        // Final URL validation
        if (isValid(src) && !src.includes('review') && !src.includes('customer')) {
            const hiRes = toHighRes(src!);
            const base = getBase(hiRes);
            if (!seenBases.has(base)) {
                seenBases.add(base);
                images.push(hiRes);
            }
        }
    });

    console.log('AMZImage DEBUG: DOM gallery scraped:', images.length, 'images');
    return images;
}

/**
 * Finds and extracts a JSON object from script content by key name.
 * Handles various quote styles and nested structures.
 */
function extractJSONObject(content: string, keyName: string): string | null {
    // Pattern matches: "key": {...}, 'key': {...}, key: {...}
    const patterns = [
        new RegExp(`["']?${keyName}["']?\\s*:\\s*({[\\s\\S]*?})(?=,\\s*["']?[a-zA-Z]|\\s*}\\s*;|\\s*$)`, 'm'),
        new RegExp(`["']?${keyName}["']?\\s*:\\s*({[^}]+})`, 'm'),
    ];

    for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }
    return null;
}

/**
 * Main variant scraping function.
 * Extracts all product variants with their images from the current Amazon page.
 */
export function scrapeVariants(isHovering: boolean = false): VariantItem[] {
    const variants: VariantItem[] = [];
    const scripts = document.querySelectorAll('script:not([src])');

    // Data structures to populate
    let colorToAsin: Record<string, string> = {};           // ColorName -> ASIN
    let colorImages: Record<string, string[]> = {};         // ColorName -> [URLs]
    let dimensionValues: Record<string, string[]> = {};     // ASIN -> [Values]
    let asinToImages: Record<string, string[]> = {};        // ASIN -> [URLs] (final mapping)

    // Current product ASIN
    // Current product ASIN
    // Priority: 1. Visually selected swatch (most accurate for OOS/AJAX), 2. Hidden Input
    let currentAsin = (document.getElementById('ASIN') as HTMLInputElement)?.value || '';

    const selectedSwatch = document.querySelector('li.swatchSelect, li.selected, li[aria-selected="true"], .swatchAvailable.selected, .swatchUnavailable.selected');
    if (selectedSwatch) {
        const swatchAsin = selectedSwatch.getAttribute('data-asin') || selectedSwatch.getAttribute('data-defaultasin');
        if (swatchAsin && swatchAsin !== currentAsin) {
            currentAsin = swatchAsin;
        }
    }

    // =========================================================================
    // GLOBAL CACHE: Persist images across re-scrapes
    // =========================================================================
    // @ts-ignore
    if (!window._amzImageCache) window._amzImageCache = {};
    // @ts-ignore
    const globalCache = window._amzImageCache as Record<string, string[]>;

    // =========================================================================
    // STEP 1: Parse all data sources from script tags
    // =========================================================================
    scripts.forEach(script => {
        const content = script.textContent || '';
        if (content.length < 100) return;

        // --- Parse colorToAsin ---
        if (content.includes('colorToAsin') && Object.keys(colorToAsin).length === 0) {
            try {
                // More robust pattern that captures the full object
                const ctaMatch = content.match(/["']?colorToAsin["']?\s*:\s*(\{[^}]+\})/);
                if (ctaMatch && ctaMatch[1]) {
                    const parsed = safeParseJSON<Record<string, string | { asin: string }>>(ctaMatch[1]);
                    if (parsed) {
                        Object.entries(parsed).forEach(([colorName, value]) => {
                            if (typeof value === 'string') {
                                colorToAsin[colorName] = value;
                            } else if (value && typeof value === 'object' && 'asin' in value) {
                                colorToAsin[colorName] = value.asin;
                            }
                        });
                        console.log('AMZImage DEBUG: colorToAsin found:', Object.keys(colorToAsin).length, 'entries');
                    }
                }
            } catch (e) { console.warn('AMZImage: colorToAsin parse error', e); }
        }

        // --- Parse colorImages (ROBUST STRATEGY) ---
        if ((content.includes('colorImages') || content.includes('initialColorImages')) && Object.keys(colorImages).length === 0) {
            try {
                // 1. Try to extract the full colorImages object first (Most Reliable)
                // Matches: colorImages = { ... } OR "colorImages" : { ... }
                const objectMatch = content.match(/(?:["']?colorImages["']?|initialColorImages)\s*[:=]\s*({[\s\S]*?})(?:;|,|\n|$)/);

                if (objectMatch && objectMatch[1]) {
                    const jsonStr = objectMatch[1];
                    const parsed = safeParseJSON<Record<string, ColorImageEntry[]>>(jsonStr);

                    if (parsed) {
                        Object.entries(parsed).forEach(([key, entries]) => {
                            if (Array.isArray(entries)) {
                                const urls: string[] = [];
                                const seenCoreIds = new Set<string>();
                                entries.forEach(entry => {
                                    const url = extractImageUrl(entry);
                                    if (url && !url.includes('transparent-pixel')) {
                                        const coreId = getImageCoreId(url);
                                        if (!seenCoreIds.has(coreId)) {
                                            seenCoreIds.add(coreId);
                                            urls.push(url);
                                        }
                                    }
                                });
                                if (urls.length > 0) colorImages[key] = urls;
                            }
                        });
                        console.log('AMZImage DEBUG: colorImages parsed via JSON:', Object.keys(colorImages).length);
                    }
                }

                // 2. Fallback: Block regex parsing (Backwards compatibility for malformed/unparseable JSON)
                if (Object.keys(colorImages).length === 0) {
                    // Pattern: "ColorName" : [{...}, {...}]
                    const allBlocks = content.match(/["']([^"']+)["']\s*:\s*\[\s*\{[^[\]]*\}\s*(?:,\s*\{[^[\]]*\}\s*)*\]/g);
                    if (allBlocks) {
                        allBlocks.forEach(block => {
                            const nameMatch = block.match(/^["']([^"']+)["']/);
                            if (!nameMatch) return;
                            const colorName = nameMatch[1].trim();
                            if (['colorToAsin', 'dimensionValuesDisplayData', 'asinToDimensionIndexMap'].includes(colorName)) return;

                            const urls: string[] = [];
                            const seenCoreIds = new Set<string>();
                            const urlRegex = /["']?(hiRes|large|main)["']?\s*:\s*["'](https?:\/\/[^"']+)["']/g;
                            let urlMatch;
                            while ((urlMatch = urlRegex.exec(block)) !== null) {
                                if (urlMatch[2] && !urlMatch[2].includes('transparent-pixel')) {
                                    const coreId = getImageCoreId(urlMatch[2]);
                                    if (!seenCoreIds.has(coreId)) {
                                        seenCoreIds.add(coreId);
                                        urls.push(urlMatch[2]);
                                    }
                                }
                            }
                            if (urls.length > 0) colorImages[colorName] = urls;
                        });
                        console.log('AMZImage DEBUG: colorImages parsed via Regex:', Object.keys(colorImages).length);
                    }
                }
            } catch (e) { console.warn('AMZImage: colorImages parse error', e); }
        }

        // --- Parse dimensionValuesDisplayData ---
        if (content.includes('dimensionValuesDisplayData') && Object.keys(dimensionValues).length === 0) {
            try {
                const asinPattern = /"([A-Z0-9]{10})"\s*:\s*\[(.*?)\]/g;
                let asinMatch;
                while ((asinMatch = asinPattern.exec(content)) !== null) {
                    const asin = asinMatch[1];
                    const valuesStr = asinMatch[2];
                    const values = valuesStr.split(',').map(v => v.trim().replace(/^"|"$/g, '').trim()).filter(v => v);
                    if (values.length > 0) {
                        dimensionValues[asin] = values;
                    }
                }
                console.log('AMZImage DEBUG: dimensionValues found:', Object.keys(dimensionValues).length, 'ASINs');
            } catch (e) { console.warn('AMZImage: dimensionValues parse error', e); }
        }

        // --- Parse imageGalleryData (Modern extraction strategy) ---
        if (content.includes('imageGalleryData')) {
            try {
                // Try to extract the full imageGalleryData object
                const igdMatch = content.match(/["']?imageGalleryData["']?\s*[:=]\s*(\[[\s\S]*?\]|\{[\s\S]*?\})(?:\s*;|\s*,|\s*\n|$)/);
                if (igdMatch && igdMatch[1]) {
                    const parsed = safeParseJSON<any>(igdMatch[1]);
                    if (parsed) {
                        if (Array.isArray(parsed)) {
                            // Format 1: [{asin: "...", mainImages: [...]}]
                            parsed.forEach(item => {
                                if (item.asin) {
                                    const urls: string[] = [];
                                    const combined = [...(item.mainImages || []), ...(item.altImages || [])];
                                    combined.forEach(img => {
                                        const url = typeof img === 'string' ? img : (img.hiRes || img.large || img.url);
                                        if (url && !url.includes('transparent-pixel')) urls.push(url);
                                    });
                                    if (urls.length > 0) {
                                        asinToImages[item.asin] = [...(asinToImages[item.asin] || []), ...urls];
                                    }
                                }
                            });
                        } else {
                            // Format 2: {"ASIN": [...]}
                            Object.entries(parsed).forEach(([asin, data]: [string, any]) => {
                                if (asin.match(/^[A-Z0-9]{10}$/) && Array.isArray(data)) {
                                    const urls = data.map(img => typeof img === 'string' ? img : (img.hiRes || img.large || img.url)).filter(u => u);
                                    asinToImages[asin] = [...(asinToImages[asin] || []), ...urls];
                                }
                            });
                        }
                    }
                }
            } catch (e) { }
        }

        // --- Parse ImageBlockATF (Main gallery config) ---
        // Amazon's ImageBlockATF contains the complete gallery for the selected variant
        // Structure: P.when('A').register("ImageBlockATF", function(A){ var data = {...}; return data; });
        // The data contains: { 'colorImages': { 'initial': [...all images...] }, ... }
        if (content.includes('ImageBlockATF')) {
            try {
                const currentAsin = document.querySelector<HTMLInputElement>('#ASIN, #asin')?.value;
                if (!currentAsin) {
                    console.log('AMZImage DEBUG: ImageBlockATF found but no current ASIN');
                }

                // Strategy 1: Extract colorImages.initial directly from the data block
                // Pattern: 'colorImages': { 'initial': [{...}, {...}] }
                const colorImagesInitialMatch = content.match(/['"]?colorImages['"]?\s*:\s*\{\s*['"]?initial['"]?\s*:\s*(\[[^\]]*(?:\{[^}]*\}[^\]]*)*\])/);
                if (colorImagesInitialMatch && colorImagesInitialMatch[1] && currentAsin) {
                    try {
                        // The extracted string may be complex, try direct JSON parse
                        const imagesArrayStr = colorImagesInitialMatch[1];
                        const parsed = safeParseJSON<any[]>(imagesArrayStr);

                        if (parsed && Array.isArray(parsed)) {
                            const urls: string[] = [];
                            const seenCoreIds = new Set<string>();

                            parsed.forEach((img: any) => {
                                // Extract hiRes (highest quality), falling back to large, then main object's first value
                                let url = img.hiRes || img.large;
                                if (!url && img.main) {
                                    if (typeof img.main === 'string') {
                                        url = img.main;
                                    } else if (typeof img.main === 'object') {
                                        // main is an object like {"url1": [w,h], "url2": [w,h]}, get highest res
                                        const mainUrls = Object.keys(img.main);
                                        if (mainUrls.length > 0) {
                                            // Sort by resolution (width*height) and pick largest
                                            url = mainUrls.sort((a, b) => {
                                                const [w1, h1] = img.main[a] || [0, 0];
                                                const [w2, h2] = img.main[b] || [0, 0];
                                                return (w2 * h2) - (w1 * h1);
                                            })[0];
                                        }
                                    }
                                }

                                if (url && !url.includes('transparent-pixel')) {
                                    const coreId = getImageCoreId(url);
                                    if (!seenCoreIds.has(coreId)) {
                                        seenCoreIds.add(coreId);
                                        urls.push(url);
                                    }
                                }
                            });

                            if (urls.length > 0) {
                                asinToImages[currentAsin] = [...(asinToImages[currentAsin] || []), ...urls];
                                console.log(`AMZImage DEBUG: ImageBlockATF colorImages.initial parsed: ${urls.length} images for ASIN ${currentAsin}`);
                            }
                        }
                    } catch (e) {
                        console.warn('AMZImage DEBUG: Failed to parse colorImages.initial JSON', e);
                    }
                }

                // Strategy 2: Extract all hiRes URLs from ImageBlockATF data block as fallback
                // This catches any images that might be in different structures
                if (currentAsin && (!asinToImages[currentAsin] || asinToImages[currentAsin].length === 0)) {
                    const hiResUrls = content.match(/"hiRes"\s*:\s*"(https:\/\/[^"]+)"/g);
                    if (hiResUrls && currentAsin) {
                        const urls: string[] = [];
                        const seenCoreIds = new Set<string>();

                        hiResUrls.forEach(match => {
                            const urlMatch = match.match(/"hiRes"\s*:\s*"(https:\/\/[^"]+)"/);
                            if (urlMatch && urlMatch[1]) {
                                const url = urlMatch[1];
                                if (!url.includes('transparent-pixel')) {
                                    const coreId = getImageCoreId(url);
                                    if (!seenCoreIds.has(coreId)) {
                                        seenCoreIds.add(coreId);
                                        urls.push(url);
                                    }
                                }
                            }
                        });

                        if (urls.length > 0) {
                            asinToImages[currentAsin] = [...(asinToImages[currentAsin] || []), ...urls];
                            console.log(`AMZImage DEBUG: ImageBlockATF hiRes fallback: ${urls.length} images for ASIN ${currentAsin}`);
                        }
                    }
                }

                // Strategy 3: Legacy pattern - extract from parsed.initial array (kept for backwards compatibility)
                const atfMatch = content.match(/['"]?ImageBlockATF['"]?\s*[:=]\s*(\{[\s\S]*?\})(?:\s*;|\s*,|\s*\n|$)/);
                if (atfMatch && atfMatch[1]) {
                    const parsed = safeParseJSON<any>(atfMatch[1]);
                    if (parsed && currentAsin && parsed.initial && Array.isArray(parsed.initial)) {
                        const urls = parsed.initial.map((img: any) => img.hiRes || img.large || img.main).filter((u: string) => u && typeof u === 'string');
                        if (urls.length > 0 && (!asinToImages[currentAsin] || asinToImages[currentAsin].length === 0)) {
                            asinToImages[currentAsin] = [...(asinToImages[currentAsin] || []), ...urls];
                            console.log(`AMZImage DEBUG: ImageBlockATF legacy pattern: ${urls.length} images`);
                        }
                    }
                }
            } catch (e) {
                console.warn('AMZImage DEBUG: ImageBlockATF parsing error', e);
            }
        }
    });

    // =========================================================================
    // STEP 2: Build ASIN -> Images mapping using colorToAsin
    // =========================================================================
    if (Object.keys(colorToAsin).length > 0 && Object.keys(colorImages).length > 0) {
        Object.entries(colorToAsin).forEach(([colorName, asin]) => {
            if (colorImages[colorName]) {
                asinToImages[asin] = colorImages[colorName];
            }
        });
        console.log('AMZImage DEBUG: asinToImages via colorToAsin:', Object.keys(asinToImages).length);
    }

    // Fallback: If colorToAsin didn't work, try matching dimensionValues to colorImages
    if (Object.keys(asinToImages).length < Object.keys(dimensionValues).length && Object.keys(colorImages).length > 0) {
        const colorKeys = Object.keys(colorImages);
        console.log('AMZImage DEBUG: Enhanced matching - colorKeys:', colorKeys.length, 'ASINs:', Object.keys(dimensionValues).length);

        Object.entries(dimensionValues).forEach(([asin, values]) => {
            // Skip if already have images for this ASIN
            if (asinToImages[asin] && asinToImages[asin].length > 0) return;

            // Try each value as a potential color name
            for (const val of values) {
                if (asinToImages[asin] && asinToImages[asin].length > 0) break;

                // Strategy 1: Exact match
                if (colorImages[val]) {
                    asinToImages[asin] = colorImages[val];
                    break;
                }

                const lowerVal = val.toLowerCase().trim();

                // Strategy 2: Case-insensitive exact match
                const exactMatch = colorKeys.find(k => k.toLowerCase().trim() === lowerVal);
                if (exactMatch) {
                    asinToImages[asin] = colorImages[exactMatch];
                    break;
                }

                // Strategy 3: One contains the other (both directions)
                const containsMatch = colorKeys.find(k => {
                    const lowerK = k.toLowerCase().trim();
                    return lowerK.includes(lowerVal) || lowerVal.includes(lowerK);
                });
                if (containsMatch) {
                    asinToImages[asin] = colorImages[containsMatch];
                    break;
                }

                // Strategy 4: Word-based matching (any significant word matches)
                const valWords = lowerVal.split(/[\s\-_+]+/).filter(w => w.length > 2);
                if (valWords.length > 0) {
                    const wordMatch = colorKeys.find(k => {
                        const kWords = k.toLowerCase().split(/[\s\-_+]+/).filter(w => w.length > 2);
                        return valWords.some(vw => kWords.some(kw => kw.includes(vw) || vw.includes(kw)));
                    });
                    if (wordMatch) {
                        asinToImages[asin] = colorImages[wordMatch];
                        break;
                    }
                }

                // Strategy 5: First word match (for names like "Red - Large" matching "Red")
                const firstWord = lowerVal.split(/[\s\-_+]/)[0];
                if (firstWord && firstWord.length > 2) {
                    const firstWordMatch = colorKeys.find(k => {
                        const kFirst = k.toLowerCase().split(/[\s\-_+]/)[0];
                        return kFirst === firstWord || kFirst.includes(firstWord) || firstWord.includes(kFirst);
                    });
                    if (firstWordMatch) {
                        asinToImages[asin] = colorImages[firstWordMatch];
                        break;
                    }
                }
            }
        });
        console.log('AMZImage DEBUG: asinToImages after enhanced matching:', Object.keys(asinToImages).length);
    }

    // Fallback: Check if colorImages uses ASINs as keys directly
    const allAsins = new Set([...Object.values(colorToAsin), ...Object.keys(dimensionValues)]);
    allAsins.forEach(asin => {
        if (!asinToImages[asin] && colorImages[asin]) {
            asinToImages[asin] = colorImages[asin];
        }
    });

    // --- Parse additional script patterns (e.g. jQuery.parseJSON) ---
    scripts.forEach(script => {
        const content = script.textContent || '';
        if (content.length < 100) return;

        // Pattern for scripts using jQuery.parseJSON for image data
        if (content.includes('jQuery.parseJSON')) {
            const jsonParams = content.match(/jQuery\.parseJSON\(['"](\{.*?\})['"]\)/g);
            if (jsonParams) {
                jsonParams.forEach(param => {
                    const match = param.match(/\{.*\}/);
                    if (match) {
                        const parsed = safeParseJSON<any>(match[0]);
                        if (parsed) {
                            // Some blocks contain a single ASIN's data
                            const asin = parsed.asin || (parsed.product && parsed.product.asin);
                            const images: string[] = [];

                            // Check common keys for image arrays
                            const potentialImageArrays = [
                                parsed.images, parsed.mainImages, parsed.altImages,
                                parsed.colorImages, parsed.initial, parsed.imagesData
                            ];

                            potentialImageArrays.forEach(arr => {
                                if (Array.isArray(arr)) {
                                    arr.forEach(img => {
                                        const url = typeof img === 'string' ? img : (img.hiRes || img.large || img.url || img.main);
                                        if (url && typeof url === 'string' && !url.includes('transparent-pixel')) {
                                            images.push(url);
                                        }
                                    });
                                }
                            });

                            if (asin && asin.match(/^[A-Z0-9]{10}$/) && images.length > 0) {
                                asinToImages[asin] = [...new Set([...(asinToImages[asin] || []), ...images])];
                            }
                        }
                    }
                });
            }
        }
    });

    console.log('AMZImage DEBUG: Total images resolved (with extra scripts):', Object.keys(asinToImages).length);

    // =========================================================================
    // UPDATE CACHE & MERGE
    // =========================================================================
    // 1. Update cache with NEW found images
    Object.entries(asinToImages).forEach(([asin, imgs]) => {
        if (imgs && imgs.length > 0) {
            globalCache[asin] = imgs;
        }
    });

    // 2. Merge EVERYTHING from cache into current map (prefer new data)
    // This ensures that if we miss data on this scrape, we have the old data
    Object.entries(globalCache).forEach(([asin, cachedImgs]) => {
        if (!asinToImages[asin]) {
            asinToImages[asin] = cachedImgs;
        }
    });

    console.log('AMZImage DEBUG: Total images resolved (with cache):', Object.keys(asinToImages).length);

    // =========================================================================
    // STEP 2.5: DOM GALLERY FALLBACK - Only when JSON extraction was insufficient
    // =========================================================================
    // We ONLY use DOM scraping as a fallback when JSON parsing failed or was incomplete.
    // This prevents duplicates: JSON sources like ImageBlockATF/colorImages already contain
    // ALL images (visible + lazy-loaded). DOM scraping would just re-add the visible ones.

    const jsonGalleryForCurrentAsin = asinToImages[currentAsin] || [];
    const jsonProvidedSufficientGallery = jsonGalleryForCurrentAsin.length >= 5;

    if (!jsonProvidedSufficientGallery && currentAsin) {
        // JSON extraction was insufficient - use DOM as fallback
        const domGalleryImages = scrapeCurrentDOMGallery();

        if (domGalleryImages.length > 0) {
            const existing = asinToImages[currentAsin] || [];
            const existingBases = new Set(existing.map(url => getImageCoreId(url)));

            // Check if the DOM rail actually belongs to currentAsin
            const firstDomBase = getImageCoreId(domGalleryImages[0]);
            const isBelongingToCurrent = !isHovering || existingBases.size === 0 || existingBases.has(firstDomBase);

            if (isBelongingToCurrent) {
                const merged = [...existing];
                let addedCount = 0;

                domGalleryImages.forEach(url => {
                    const base = getImageCoreId(url);
                    if (!existingBases.has(base)) {
                        merged.push(url);
                        existingBases.add(base);
                        addedCount++;
                    }
                });

                if (addedCount > 0 || existing.length === 0) {
                    asinToImages[currentAsin] = merged;
                    globalCache[currentAsin] = merged;
                    console.log(`AMZImage DEBUG: Current ASIN enriched via DOM fallback (+${addedCount}):`, currentAsin, 'total:', merged.length);
                }
            }
        }
    } else if (currentAsin) {
        console.log(`AMZImage DEBUG: Skipping DOM scrape - JSON provided ${jsonGalleryForCurrentAsin.length} images for ${currentAsin}`);
    }

    // =========================================================================
    // STEP 3: Build variant list
    // =========================================================================
    const processedAsins = new Set<string>();

    // Primary: Use dimensionValues as source of truth for variant list
    if (Object.keys(dimensionValues).length > 0) {
        Object.entries(dimensionValues).forEach(([asin, values]) => {
            if (processedAsins.has(asin)) return;
            processedAsins.add(asin);

            const name = values.join(' + ');
            const images = asinToImages[asin] || [];

            // DOM lookup for formatted name and availability
            const domItem = document.querySelector(`li[data-defaultasin="${asin}"], li[data-asin="${asin}"]`);
            let thumbnail = '';
            let available = true;
            let domImages: string[] = [];

            if (domItem) {
                const isUnavailable = domItem.classList.contains('swatchUnavailable') ||
                    domItem.classList.contains('unavailable') ||
                    domItem.querySelector('.a-button-unavailable') !== null;
                if (isUnavailable) available = false;

                // Try to extract images from DOM swatch
                const img = domItem.querySelector('img');
                if (img) {
                    // Strategy 1: data-a-dynamic-image (contains all image sizes)
                    const dynamicData = img.getAttribute('data-a-dynamic-image');
                    if (dynamicData) {
                        try {
                            const parsed = JSON.parse(dynamicData);
                            const urls = Object.keys(parsed);
                            if (urls.length > 0) {
                                // Get highest resolution version
                                const best = urls.sort((a, b) => {
                                    const [w1, h1] = parsed[a];
                                    const [w2, h2] = parsed[b];
                                    return (w2 * h2) - (w1 * h1);
                                })[0];
                                if (best && !best.includes('transparent-pixel')) {
                                    domImages.push(best);
                                }
                            }
                        } catch (e) { /* ignore */ }
                    }

                    // Strategy 2: Convert swatch src to high-res
                    const src = img.getAttribute('src');
                    if (src && !src.includes('transparent-pixel') && !src.includes('placeholder')) {
                        const hiRes = src
                            .replace(/\._[A-Z]{2}_[A-Za-z0-9,_]+_\./, '.')
                            .replace(/\._AC_.*_\./, '.')
                            .replace(/\._S[A-Z0-9]+_\./, '.')
                            .replace(/\._U[A-Z0-9]+_\./, '.');
                        if (!domImages.includes(hiRes)) {
                            domImages.push(hiRes);
                        }
                    }
                }

                // Strategy 3: Look for data-dp-url which might contain image info
                const dpUrl = domItem.getAttribute('data-dp-url');
                if (dpUrl && dpUrl.includes('/dp/')) {
                    // This contains the product page URL, could be used for future API calls
                }
            }

            // Merge images: prefer asinToImages
            // CRITICAL FIX: Do NOT merge DOM swatch images if we already have a gallery.
            // The swatch is often a duplicate or low-quality crop that adds an unwanted "extra" image.
            // Only use domImages (swatches) if we found NOTHING else.
            let finalImages = [...images];
            if (finalImages.length === 0 && domImages.length > 0) {
                const seenBases = new Set();
                domImages.forEach(url => {
                    const base = url.match(/images\/I\/([A-Za-z0-9]+)/);
                    const baseKey = base ? base[1] : url;
                    if (!seenBases.has(baseKey)) {
                        finalImages.push(url);
                        seenBases.add(baseKey);
                    }
                });
            }

            // PRIORITIZE MAIN PRODUCT IMAGE: Use first gallery image as thumbnail
            if (finalImages.length > 0) {
                thumbnail = finalImages[0];
            } else if (domItem) {
                // Final fallback to swatch image
                const img = domItem.querySelector('img');
                if (img) thumbnail = img.getAttribute('src') || '';
            }

            // Always include variants regardless of availability
            // Users should be able to view and download media even for unavailable variants
            variants.push({
                asin,
                name,
                image: thumbnail,
                images: finalImages,
                selected: asin === currentAsin,
                available: name.length > 0 // Mark as available if we have a valid name
            });
        });
    }

    // =========================================================================
    // STEP 4: Fallback to DOM scraping if no JSON data found
    // =========================================================================
    if (variants.length === 0) {
        const container = document.querySelector('#twister_feature_div, #twister') || document.body;
        const items = container.querySelectorAll<HTMLElement>('li[data-defaultasin], li[data-asin]');

        items.forEach(item => {
            const asin = item.getAttribute('data-defaultasin') || item.getAttribute('data-asin');
            if (!asin || processedAsins.has(asin)) return;
            processedAsins.add(asin);

            const isSelected = item.classList.contains('swatchSelect') ||
                item.querySelector('.swatchSelect') !== null ||
                item.classList.contains('a-active');

            const isUnavailable = item.classList.contains('swatchUnavailable') ||
                item.classList.contains('unavailable') ||
                item.querySelector('.a-button-unavailable') !== null;

            // Get name from img alt or button text
            let name = '';
            const img = item.querySelector('img');
            if (img) {
                name = img.getAttribute('alt') || img.getAttribute('title') || '';
            }
            if (!name) {
                const textButton = item.querySelector('.a-button-text');
                if (textButton) {
                    name = textButton.textContent || '';
                } else {
                    name = item.innerText || item.textContent || '';
                }
            }
            name = name.trim().replace(/^Select\s+/, '');

            if (!name) return;

            // Include all variants regardless of availability status
            variants.push({
                asin,
                name,
                image: img?.src || '',
                images: asinToImages[asin] || [],
                selected: isSelected,
                available: true // Always mark as available for user access
            });
        });
    }

    console.log(`AMZImage: Scraped ${variants.length} variants`);
    return variants;
}