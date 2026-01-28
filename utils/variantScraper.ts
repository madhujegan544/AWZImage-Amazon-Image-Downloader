export interface VariantItem {
    name: string;
    asin: string;
    image?: string;
    images?: string[];
    videos?: string[]; // Added videos
    selected: boolean;
    available: boolean;
    isLoading?: boolean;
}

interface ColorImageEntry {
    hiRes?: string;
    large?: string;
    main?: string | Record<string, string>;
}

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

function getImageCoreId(url: string): string {
    const match = url.match(/images\/I\/([A-Za-z0-9]+)/);
    return match ? match[1] : url.split('?')[0];
}

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

function maximizeImageQuality(url: string): string {
    if (!url) return '';
    // Remove specific amazon resolution patterns like _SS40_, _SX100_, etc.
    return url.replace(/\._[A-Z]{2,4}[0-9]+_/, '');
}

/* ============================
   🔧 FIX START (NEW, SAFE)
   ============================ */
function hydrateAllVariantImages(
    asinToImages: Record<string, string[]>,
    allAsins: Set<string>,
    globalCache: Record<string, string[]>
) {
    allAsins.forEach(asin => {
        if (asinToImages[asin] && asinToImages[asin].length >= 5) return;

        if (globalCache[asin] && globalCache[asin].length > 0) {
            asinToImages[asin] = [...globalCache[asin]];
            return;
        }

        if (!asinToImages[asin]) {
            asinToImages[asin] = [];
        }
    });
}
/* ============================
   🔧 FIX END
   ============================ */

export function scrapeVariants(isHovering: boolean = false): VariantItem[] {
    const variants: VariantItem[] = [];

    // FIX: Restrict script search to the main product container to avoid picking up 
    // stale scripts from previous pages (if Amazon didn't fully clear the DOM).
    // Using #dp (Desktop Product) or #ppd (Product Page Detail) is safer than scanning the whole document.
    const scraperRoot = document.getElementById('dp') || document.getElementById('ppd') || document.body;
    const scripts = scraperRoot.querySelectorAll('script:not([src])');

    let colorToAsin: Record<string, string> = {};
    let colorImages: Record<string, string[]> = {};
    let dimensionValues: Record<string, string[]> = {};
    let asinToImages: Record<string, string[]> = {};

    let currentAsin =
        (document.getElementById('ASIN') as HTMLInputElement)?.value || '';

    const selectedSwatch = document.querySelector(
        'li.swatchSelect, li.selected, li[aria-selected="true"]'
    );
    if (selectedSwatch) {
        const swatchAsin =
            selectedSwatch.getAttribute('data-asin') ||
            selectedSwatch.getAttribute('data-defaultasin');
        if (swatchAsin) currentAsin = swatchAsin;
    }

    // GLOBAL CACHE
    // @ts-ignore
    if (!window._amzImageCache) window._amzImageCache = {};
    // @ts-ignore
    const globalCache = window._amzImageCache as Record<string, string[]>;

    /* ========= SCRIPT PARSING (UNCHANGED) ========= */
    scripts.forEach(script => {
        const content = script.textContent || '';
        if (content.length < 100) return;

        if (content.includes('colorToAsin') && !Object.keys(colorToAsin).length) {
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

        if (
            (content.includes('colorImages') ||
                content.includes('initialColorImages')) &&
            !Object.keys(colorImages).length
        ) {
            const match = content.match(
                /(colorImages|initialColorImages)\s*[:=]\s*(\{[\s\S]*?\})/
            );
            if (match) {
                const parsed = safeParseJSON<Record<string, ColorImageEntry[]>>(
                    match[2]
                );
                if (parsed) {
                    Object.entries(parsed).forEach(([k, v]) => {
                        const urls: string[] = [];
                        const seen = new Set<string>();
                        v.forEach(e => {
                            const url = extractImageUrl(e);
                            if (url) {
                                const core = getImageCoreId(url);
                                if (!seen.has(core)) {
                                    seen.add(core);
                                    urls.push(url);
                                }
                            }
                        });
                        if (urls.length) colorImages[k] = urls;
                    });
                }
            }
        }

        if (content.includes('dimensionValuesDisplayData')) {
            const asinPattern = /"([A-Z0-9]{10})"\s*:\s*\[(.*?)\]/g;
            let m;
            while ((m = asinPattern.exec(content))) {
                dimensionValues[m[1]] = m[2]
                    .split(',')
                    .map(v => v.replace(/"/g, '').trim());
            }
        }

        if (content.includes('ImageBlockATF') && currentAsin) {
            const hiResMatches = content.match(
                /"hiRes"\s*:\s*"(https:\/\/[^"]+)"/g
            );
            if (hiResMatches) {
                asinToImages[currentAsin] = asinToImages[currentAsin] || [];
                hiResMatches.forEach(m => {
                    const url = m.match(/"(https:\/\/[^"]+)"/)?.[1];
                    if (url) asinToImages[currentAsin].push(url);
                });
            }
        }
    });

    /* ========= MAP COLOR → ASIN ========= */
    Object.entries(colorToAsin).forEach(([color, asin]) => {
        if (colorImages[color]) {
            asinToImages[asin] = colorImages[color];
        }
    });

    /* ========= CACHE MERGE ========= */
    Object.entries(asinToImages).forEach(([asin, imgs]) => {
        if (imgs.length) globalCache[asin] = imgs;
    });

    Object.entries(globalCache).forEach(([asin, imgs]) => {
        if (!asinToImages[asin]) asinToImages[asin] = imgs;
    });

    /* ============================
       🔧 FIX APPLICATION (NEW)
       ============================ */

    // Scrape DOM swatches for thumbnails - TARGETED SELECTOR
    const domThumbnails: Record<string, string> = {};

    // START FIX: Restrict search to variation containers only
    // This prevents picking up "Recommended Products" or "Frequently bought together" items 
    // which also have data-asin attributes.
    const variationContainer = document.querySelector(
        '#twister, #twisterContainer, #softlinesTwister, #tmmSwatches, [id^="variation_"], #icebreaker-variations'
    );

    if (variationContainer) {
        // Look for any element with data-asin (li, span, div, input, etc) INSIDE the container
        variationContainer.querySelectorAll('[data-asin], [data-defaultasin]').forEach(el => {
            const asin = el.getAttribute('data-asin') || el.getAttribute('data-defaultasin');
            if (!asin) return;

            // Strategy: Look for img inside, or if the element itself is an img
            let img = el.querySelector('img');
            if (!img && el.tagName === 'IMG') img = el as HTMLImageElement;

            // Sometimes the image is in a sibling or parent label (handling specific layouts)
            if (!img && el.tagName === 'INPUT') {
                const id = el.getAttribute('id');
                if (id) {
                    const label = document.querySelector(`label[for="${id}"]`);
                    if (label) img = label.querySelector('img');
                }
            }

            if (asin && img && img.src) {
                domThumbnails[asin] = maximizeImageQuality(img.src);
            }
        });
    }
    // END FIX

    const allVariantAsins = new Set([
        ...Object.keys(dimensionValues),
        ...Object.values(colorToAsin),
        // FIX: Do NOT include globalCache keys here. 
        // Cache should only be a data source for images, not a source of truth for *existence* of variants.
        // This prevents variants from previously visited products (persisted in SPA navigation) 
        // from showing up on the current product page.
        ...Object.keys(domThumbnails)
    ]);

    hydrateAllVariantImages(asinToImages, allVariantAsins, globalCache);

    /* ========= BUILD VARIANTS ========= */
    // If dimensionValues is empty (some pages don't use it), try built from all known ASINs (derived from Page/DOM only)
    const asinsToBuild = Object.keys(dimensionValues).length > 0
        ? Object.keys(dimensionValues)
        : Array.from(allVariantAsins);

    asinsToBuild.forEach((asin) => {
        // Name resolution
        let name = "Variant " + asin;
        if (dimensionValues[asin]) {
            name = dimensionValues[asin].join(' + ');
        } else {
            // Try to reverse lookup name from colorToAsin if possible or leave generic
            const color = Object.keys(colorToAsin).find(key => colorToAsin[key] === asin);
            if (color) name = color;
        }

        let images = asinToImages[asin] || [];
        const thumbnail = domThumbnails[asin];

        // If we have no gallery images but we DO have a thumbnail, 
        // add the thumbnail to the images list so it's downloadable and counts as 1.
        if (images.length === 0 && thumbnail) {
            images = [thumbnail];
        }

        // Use full image gallery first, then DOM thumbnail
        // Ensure we prioritize high-res if available in images[0]
        let mainImage = images.length > 0 ? images[0] : thumbnail;

        variants.push({
            asin,
            name: name,
            image: mainImage,
            images,
            selected: asin === currentAsin,
            available: true
        });
    });

    // Fallback: If no variants found (singleton product), ensure we return the current product
    if (variants.length === 0 && currentAsin) {
        // Try to find the main image
        const mainImg = document.querySelector('#landingImage') as HTMLImageElement;
        const mainUrl = mainImg ? maximizeImageQuality(mainImg.src) : '';

        // Check if we have images from scripts even if we didn't build variants
        const scriptImages = asinToImages[currentAsin] || [];

        variants.push({
            asin: currentAsin,
            name: "Product",
            image: mainUrl || (scriptImages.length > 0 ? scriptImages[0] : ''),
            images: scriptImages.length > 0 ? scriptImages : (mainUrl ? [mainUrl] : []),
            selected: true,
            available: true
        });
    }

    return variants;
}
