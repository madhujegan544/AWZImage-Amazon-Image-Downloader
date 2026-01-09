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
export function scrapeVariants(): VariantItem[] {
    const variants: VariantItem[] = [];
    const scripts = document.querySelectorAll('script:not([src])');

    // Data structures to populate
    let colorToAsin: Record<string, string> = {};           // ColorName -> ASIN
    let colorImages: Record<string, string[]> = {};         // ColorName -> [URLs]
    let dimensionValues: Record<string, string[]> = {};     // ASIN -> [Values]
    let asinToImages: Record<string, string[]> = {};        // ASIN -> [URLs] (final mapping)

    // Current product ASIN
    const currentAsin = (document.getElementById('ASIN') as HTMLInputElement)?.value || '';

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
                                entries.forEach(entry => {
                                    const url = extractImageUrl(entry);
                                    if (url && !url.includes('transparent-pixel') && !urls.includes(url)) {
                                        urls.push(url);
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
                            const urlRegex = /["']?(hiRes|large|main)["']?\s*:\s*["'](https?:\/\/[^"']+)["']/g;
                            let urlMatch;
                            while ((urlMatch = urlRegex.exec(block)) !== null) {
                                if (urlMatch[2] && !urlMatch[2].includes('transparent-pixel')) urls.push(urlMatch[2]);
                            }
                            if (urls.length > 0) colorImages[colorName] = [...new Set(urls)]; // Deduplicate
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
    if (Object.keys(asinToImages).length === 0 && Object.keys(dimensionValues).length > 0 && Object.keys(colorImages).length > 0) {
        const colorKeys = Object.keys(colorImages);
        console.log('AMZImage DEBUG: Fallback matching - colorKeys:', colorKeys);

        Object.entries(dimensionValues).forEach(([asin, values]) => {
            // Try each value as a potential color name
            for (const val of values) {
                // Exact match
                if (colorImages[val]) {
                    asinToImages[asin] = colorImages[val];
                    break;
                }

                // Case-insensitive match
                const lowerVal = val.toLowerCase();
                const matchedKey = colorKeys.find(k => k.toLowerCase() === lowerVal);
                if (matchedKey) {
                    asinToImages[asin] = colorImages[matchedKey];
                    break;
                }

                // Partial match: check if colorKey contains value or value contains colorKey
                const partialMatch = colorKeys.find(k => {
                    const lowerK = k.toLowerCase();
                    return lowerK.includes(lowerVal) || lowerVal.includes(lowerK);
                });
                if (partialMatch) {
                    asinToImages[asin] = colorImages[partialMatch];
                    break;
                }
            }
        });
        console.log('AMZImage DEBUG: asinToImages via fallback:', Object.keys(asinToImages).length);
    }

    // Fallback: Check if colorImages uses ASINs as keys directly
    const allAsins = new Set([...Object.values(colorToAsin), ...Object.keys(dimensionValues)]);
    allAsins.forEach(asin => {
        if (!asinToImages[asin] && colorImages[asin]) {
            asinToImages[asin] = colorImages[asin];
        }
    });

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

            if (domItem) {
                const isUnavailable = domItem.classList.contains('swatchUnavailable') ||
                    domItem.classList.contains('unavailable') ||
                    domItem.querySelector('.a-button-unavailable') !== null;
                if (isUnavailable) available = false;
            }

            // PRIORITIZE MAIN PRODUCT IMAGE: Use first gallery image as thumbnail
            if (images.length > 0) {
                thumbnail = images[0];
            } else if (domItem) {
                // Fallback to swatch image if no gallery images found
                const img = domItem.querySelector('img');
                if (img) thumbnail = img.getAttribute('src') || '';
            }

            variants.push({
                asin,
                name,
                image: thumbnail,
                images,
                selected: asin === currentAsin,
                available: available && name.length > 0
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

            variants.push({
                asin,
                name,
                image: img?.src || '',
                images: asinToImages[asin] || [],
                selected: isSelected,
                available: !isUnavailable
            });
        });
    }

    console.log(`AMZImage: Scraped ${variants.length} variants`);
    return variants;
}
