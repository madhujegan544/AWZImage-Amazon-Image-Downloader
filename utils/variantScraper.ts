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
    // Robust extraction of Amazon Image ID (handles _, -, +, %)
    const match = url.match(/\/I\/([A-Za-z0-9\-+%]+)/);
    if (match) return match[1].split('.')[0]; // Ensure we strip extension if caught

    // Fallback: Try to just get the filename without extension
    const parts = url.split('/');
    const filename = parts[parts.length - 1] || url;
    return filename.split('.')[0];
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
   🔧 HELPERS
   ============================ */
function hydrateAllVariantImages(
    asinToImages: Record<string, string[]>,
    allAsins: Set<string>,
    globalCache: Record<string, string[]>
) {
    allAsins.forEach(asin => {
        const cached = globalCache[asin];
        if (cached && cached.length > 0) {
            if (!asinToImages[asin]) {
                asinToImages[asin] = [...cached];
            } else {
                // Merge cached images to ensure we have the most complete set
                const existing = asinToImages[asin];
                const existingSet = new Set(existing);
                cached.forEach(url => {
                    if (!existingSet.has(url)) {
                        existing.push(url);
                        existingSet.add(url);
                    }
                });
            }
        }

        if (!asinToImages[asin]) {
            asinToImages[asin] = [];
        }
    });
}

function hydrateAllVariantVideos(
    variants: VariantItem[],
    videoCache: Record<string, string[]>
) {
    variants.forEach(variant => {
        // If we don't have videos, or cache has MORE/DIFFERENT videos, merge/update
        if (!variant.videos || variant.videos.length === 0) {
            if (videoCache[variant.asin] && videoCache[variant.asin].length > 0) {
                variant.videos = [...videoCache[variant.asin]];
            }
        }
    });
}

/* ============================
   🎥 NEW: OFFICIAL VIDEO SCRAPER
   ============================ */
function scrapeOfficialVideos(root: HTMLElement): string[] {
    const videos: string[] = [];
    const seen = new Set<string>();

    // 1. Parse 'imageGalleryData' (Common in modern layouts)
    // This strictly contains the "Product Variant Gallery" media
    const scripts = root.querySelectorAll('script:not([src])');
    scripts.forEach(script => {
        const content = script.textContent || '';
        if (content.includes('imageGalleryData')) {
            const galleryMatch = content.match(/imageGalleryData\s*:\s*(\[[\s\S]*?\])/);
            if (galleryMatch) {
                try {
                    const gallery = safeParseJSON<any[]>(galleryMatch[1]);
                    if (Array.isArray(gallery)) {
                        gallery.forEach(item => {
                            if (item.mediaType === 'video' && item.url) {
                                if (!seen.has(item.url)) {
                                    seen.add(item.url);
                                    videos.push(item.url);
                                }
                            }
                        });
                    }
                } catch {
                    // Fallback regex if dict parsing fails
                    const videoUrls = content.match(/"url"\s*:\s*"(https:\/\/[^"]+\.(?:mp4|m3u8)[^"]*)"/g);
                    if (videoUrls) {
                        videoUrls.forEach(match => {
                            const url = match.match(/"(https:\/\/[^"]+)"/)?.[1];
                            if (url && !seen.has(url)) {
                                seen.add(url);
                                videos.push(url);
                            }
                        });
                    }
                }
            }
        }

        // 2. REMOVED: Loose "videos" grep. 
        // We strictly rely on imageGalleryData and DOM to prevent pollution from other datasets.
    });

    // 3. Look for DOM Video Elements (Fresh Scrape)
    // Strictly search within the product gallery container
    const galleryContainer = root.querySelector('#imageBlock, #altImages, #main-image-container');
    if (galleryContainer) {
        galleryContainer.querySelectorAll('video, .video-container source').forEach(el => {
            const v = el as HTMLMediaElement | HTMLSourceElement;
            const src = v.src;

            // STRICT VALIDATION:
            // 1. Must be HTTP/HTTPS (no blobs, no data URIs)
            // 2. Must look like a video file (mp4, m3u8, webm)
            if (src && src.startsWith('http')) {
                const lower = src.toLowerCase();
                if (lower.includes('.mp4') || lower.includes('.m3u8') || lower.includes('.webm')) {
                    if (!seen.has(src)) {
                        seen.add(src);
                        videos.push(src);
                    }
                }
            }
        });
    }

    return videos;
}

/* ============================
   📸 NEW: ACTIVE GALLERY SCRAPER
   ============================ */
function scrapeActiveVariantGallery(root: HTMLElement): string[] {
    const images: string[] = [];
    const seen = new Set<string>();

    const addImage = (url: string) => {
        if (!url) return;
        const highRes = maximizeImageQuality(url);
        // Exclude specific patterns like placeholders
        if (highRes.includes('sprite') || highRes.includes('play-icon') || highRes.includes('video-icon')) return;

        const core = getImageCoreId(highRes);
        if (!seen.has(core)) {
            seen.add(core);
            images.push(highRes);
        }
    };

    // 1. Priority: Modern 'imageGalleryData' script
    // This often contains the FULL list of images (12+) even if the DOM only renders 7-8 thumbnails.
    const scripts = root.querySelectorAll('script:not([src])');
    for (const script of Array.from(scripts)) {
        if (script.textContent?.includes('imageGalleryData')) {
            const match = script.textContent.match(/imageGalleryData\s*:\s*(\[[\s\S]*?\])/);
            if (match) {
                try {
                    const data = JSON.parse(match[1]);
                    data.forEach((item: any) => {
                        // We primarily want images here. Videos are handled separately but added for completeness if scraping everything.
                        if (item.mediaType === 'image' && item.url) addImage(item.url);
                    });
                } catch { }
            }
        }
    }

    // 2. Supplement: Standard Alt Images (Visible Thumbnails)
    // If script didn't yield anything or is missing, these are our best bet.
    // Even if script worked, checking these ensures we don't miss anything actually displayed.
    const altImages = root.querySelectorAll('#altImages ul li.item img');
    altImages.forEach(img => addImage((img as HTMLImageElement).src));

    // 3. Supplement: Main Image
    const mainImg = root.querySelector('#landingImage, #imgTagWrapperId img') as HTMLImageElement;
    if (mainImg) addImage(mainImg.src);

    // 4. Supplement: Dynamic Image Data (Hidden High-Res Candidates)
    // This attribute often contains the FULL set of images for the active variant, even if not all are rendered as thumbnails.
    const dynamicContainers = root.querySelectorAll('#main-image-container, #landingImage, #imgTagWrapperId, .imgTagWrapper, #imageBlock');
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
    let asinToVideos: Record<string, string[]> = {}; // New: Store videos map

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

    // @ts-ignore
    if (!window._amzVideoCache) window._amzVideoCache = {};
    // @ts-ignore
    const globalVideoCache = window._amzVideoCache as Record<string, string[]>;

    // @ts-ignore
    if (!window._amzFullGalleryCache) window._amzFullGalleryCache = {};
    // @ts-ignore
    const fullGalleryCache = window._amzFullGalleryCache as Record<string, string[]>;

    /* ========= SCRIPT PARSING (With Updates) ========= */
    scripts.forEach(script => {
        const content = script.textContent || '';
        if (content.length < 100) return;

        // NEW: Global search for imageGalleryData (The "Gold Standard" for the active ASIN)
        // This script usually contains the FULL list of images (12+), unlike colorImages which is truncated.
        if (content.includes('imageGalleryData') && currentAsin) {
            const galleryMatch = content.match(/imageGalleryData\s*:\s*(\[[\s\S]*?\])/);
            if (galleryMatch) {
                try {
                    const gallery = safeParseJSON<any[]>(galleryMatch[1]);
                    if (Array.isArray(gallery)) {
                        const fullGalleryImages: string[] = [];
                        const seen = new Set<string>();
                        gallery.forEach(item => {
                            if (item.mediaType === 'image' && item.url) {
                                const highRes = maximizeImageQuality(item.url);
                                const core = getImageCoreId(highRes);
                                if (!seen.has(core)) {
                                    seen.add(core);
                                    fullGalleryImages.push(highRes);
                                }
                            }
                        });

                        // If we found a substantial gallery, this is likely the authoritative source for the current ASIN.
                        // We store it immediately. This overwrites potentially truncated 'colorImages' data for this ASIN.
                        if (fullGalleryImages.length > 0) {
                            asinToImages[currentAsin] = fullGalleryImages;
                            // PERSIST: Lock this high-quality data into the full gallery cache
                            fullGalleryCache[currentAsin] = fullGalleryImages;
                        }
                    }
                } catch { }
            }
        }

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

        if (
            (content.includes('colorImages') ||
                content.includes('initialColorImages'))
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
                            const url = maximizeImageQuality(extractImageUrl(e));
                            if (url) {
                                const core = getImageCoreId(url);
                                if (!seen.has(core)) {
                                    seen.add(core);
                                    urls.push(url);
                                }
                            }
                        });
                        if (urls.length) {
                            if (colorImages[k]) {
                                // Merge if already exists to capture data from multiple script blocks
                                // (Rare but possible if Amazon splits data)
                                const existing = colorImages[k];
                                const existingSet = new Set(existing); // Check full URL
                                urls.forEach(u => {
                                    if (!existingSet.has(u)) {
                                        existing.push(u);
                                        existingSet.add(u);
                                    }
                                });
                            } else {
                                colorImages[k] = urls;
                            }
                        }
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

        // REMOVED: ImageBlockATF scraping.
        // This script block is static and often persists from the initial page load even after AJAX variant switches.
        // Using it causes the "initial variant" images to be assigned to the "current active variant" 
        // incorrectly, leading to cache poisoning/bleed-over.
        // We now rely strictly on 'imageGalleryData', 'colorImages', and the live DOM which are more reliable.
    });

    /* ========= MAP COLOR → ASIN ========= */
    Object.entries(colorToAsin).forEach(([color, asin]) => {
        if (colorImages[color]) {
            const incoming = colorImages[color];
            if (asinToImages[asin]) {
                const existingSet = new Set(asinToImages[asin]);
                incoming.forEach(url => {
                    if (!existingSet.has(url)) {
                        asinToImages[asin].push(url);
                        existingSet.add(url);
                    }
                });
            } else {
                asinToImages[asin] = incoming;
            }
        }

        if (asinToImages[asin] && !colorImages[color]) {
            colorImages[color] = asinToImages[asin];
        }
    });

    /* ========= 🌟 FRESH VARIANT-LEVEL SCRAPE (Official Gallery) ========= */
    if (currentAsin) {
        // 1. Fresh Image Scrape (DOM)
        const freshImages = scrapeActiveVariantGallery(scraperRoot as HTMLElement);

        // VALIDATION: Prevent race condition where DOM images are from previous variant
        // We check if the fresh images have any overlap with the script/data images we know belong to this ASIN.
        const knownScriptImages = asinToImages[currentAsin] || [];
        let isFreshDataValid = true;

        if (knownScriptImages.length > 0 && freshImages.length > 0) {
            const scriptIds = new Set(knownScriptImages.map(u => getImageCoreId(u)));
            const freshIds = freshImages.map(u => getImageCoreId(u));

            // Check for at least ONE matching image between script data and visual DOM
            const hasOverlap = freshIds.some(id => scriptIds.has(id));

            if (!hasOverlap) {
                // If NO overlap, the DOM is likely lagging behind the ASIN switch.
                // We should NOT use these images as they likely belong to the previous variant.
                isFreshDataValid = false;
            }
        } else if (knownScriptImages.length === 0 && freshImages.length > 0) {
            // CRITICAL: If we have NO script data for the current ASIN, we must be paranoid.
            // Check if these fresh images belong to ANY OTHER known variant. 
            // If they match another variant's set strictly, they are likely STALE DOM artefacts (Lag).
            const freshIds = freshImages.map(u => getImageCoreId(u));
            const freshMainId = freshIds[0];

            for (const otherAsin of Object.keys(asinToImages)) {
                if (otherAsin === currentAsin) continue;
                const otherImages = asinToImages[otherAsin];
                if (otherImages && otherImages.length > 0) {
                    const otherIds = new Set(otherImages.map(u => getImageCoreId(u)));

                    // HEURISTIC 1: If the Main Image (first one) matches an existing variant's main image, it's stale.
                    if (otherIds.has(freshMainId)) {
                        isFreshDataValid = false;
                        break;
                    }

                    // HEURISTIC 2: If ALL fresh images are contained in another variant's set
                    const allMatch = freshIds.every(id => otherIds.has(id));
                    if (allMatch) {
                        isFreshDataValid = false;
                        break;
                    }
                }
            }
        }

        if (isFreshDataValid) {
            if (freshImages.length > 0) {
                // If we already have more images (e.g. from global imageGalleryData), don't degrade to a smaller set
                // MERGE instead of overwrite
                if (asinToImages[currentAsin]) {
                    const existing = asinToImages[currentAsin];
                    // If fresh has MORE, or distinct images, we want them.
                    // If existing has MORE (e.g. 12 vs 8), we definitely want to keep existing.
                    const existingSet = new Set(existing);
                    freshImages.forEach(url => {
                        if (!existingSet.has(url)) {
                            existing.push(url);
                            existingSet.add(url);
                        }
                    });
                    // asinToImages[currentAsin] is already updated via push
                } else {
                    asinToImages[currentAsin] = freshImages;
                }
            }

            // 2. Fresh Video Scrape (Official) - Only if images are valid
            const freshVideos = scrapeOfficialVideos(scraperRoot as HTMLElement);
            if (freshVideos.length > 0) {
                asinToVideos[currentAsin] = freshVideos;
                // Merge active videos into cache instead of overwriting to prevent data loss on brief DOM glitches
                if (!globalVideoCache[currentAsin]) {
                    globalVideoCache[currentAsin] = freshVideos;
                } else {
                    const existingSet = new Set(globalVideoCache[currentAsin]);
                    freshVideos.forEach(v => {
                        if (!existingSet.has(v)) {
                            globalVideoCache[currentAsin].push(v);
                            existingSet.add(v);
                        }
                    });
                }
            }
        }
    }

    /* ========= CACHE MERGE ========= */
    Object.entries(asinToImages).forEach(([asin, imgs]) => {
        if (imgs.length) globalCache[asin] = imgs;
    });

    Object.entries(globalCache).forEach(([asin, imgs]) => {
        if (!asinToImages[asin]) asinToImages[asin] = imgs;
    });

    /* ========= SCRAPE DOM THUMBNAILS (Existence Check) ========= */
    const domThumbnails: Record<string, string> = {};
    const variationContainer = document.querySelector(
        '#twister, #twisterContainer, #softlinesTwister, #tmmSwatches, [id^="variation_"], #icebreaker-variations'
    );

    if (variationContainer) {
        variationContainer.querySelectorAll('[data-asin], [data-defaultasin]').forEach(el => {
            const asin = el.getAttribute('data-asin') || el.getAttribute('data-defaultasin');
            if (!asin) return;
            let img = el.querySelector('img');
            if (!img && el.tagName === 'IMG') img = el as HTMLImageElement;
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

    const allVariantAsins = new Set([
        ...Object.keys(dimensionValues),
        ...Object.values(colorToAsin),
        ...Object.keys(domThumbnails) // Only use present thumbnails
    ]);

    // RESTORE FROM FULL GALLERY CACHE:
    // We merge the authoritative data into our current set. 
    // This ensures we get the "Gold Standard" high-res links, but we ALSO keep any valid extra images
    // possibly found by the dynamic DOM scrape that might be missing from the static script data.
    Object.keys(fullGalleryCache).forEach(asin => {
        if (allVariantAsins.has(asin)) {
            const cached = fullGalleryCache[asin];
            // If cache exists, merge it in.
            if (cached && cached.length > 0) {
                if (!asinToImages[asin]) {
                    asinToImages[asin] = [...cached];
                } else {
                    const existing = asinToImages[asin];
                    const existingSet = new Set(existing);
                    cached.forEach(url => {
                        if (!existingSet.has(url)) {
                            existing.push(url);
                            existingSet.add(url);
                        }
                    });
                }
            }
        }
    });

    hydrateAllVariantImages(asinToImages, allVariantAsins, globalCache);

    /* ========= BUILD VARIANTS ========= */
    const asinsToBuild = Object.keys(dimensionValues).length > 0
        ? Object.keys(dimensionValues)
        : Array.from(allVariantAsins);

    asinsToBuild.forEach((asin) => {
        let name = "Variant " + asin;
        if (dimensionValues[asin]) {
            name = dimensionValues[asin].join(' + ');
        } else {
            const color = Object.keys(colorToAsin).find(key => colorToAsin[key] === asin);
            if (color) name = color;
        }

        let images = asinToImages[asin] || [];
        const thumbnail = domThumbnails[asin];

        if (images.length === 0 && thumbnail) {
            images = [thumbnail];
        }

        let mainImage = images.length > 0 ? images[0] : thumbnail;

        // Resolve Videos
        let videos = asinToVideos[asin] || [];
        // If not found in fresh scrape, try cache
        if (videos.length === 0 && globalVideoCache[asin]) {
            videos = globalVideoCache[asin];
        }

        variants.push({
            asin,
            name: name,
            image: mainImage,
            images: images,
            videos: videos, // Attached Videos!
            selected: asin === currentAsin,
            available: true
        });
    });

    // Fallback Singleton
    if (variants.length === 0 && currentAsin) {
        const mainImg = document.querySelector('#landingImage') as HTMLImageElement;
        const mainUrl = mainImg ? maximizeImageQuality(mainImg.src) : '';
        const scriptImages = asinToImages[currentAsin] || [];
        const scriptVideos = asinToVideos[currentAsin] || globalVideoCache[currentAsin] || [];

        variants.push({
            asin: currentAsin,
            name: "Product",
            image: mainUrl || (scriptImages.length > 0 ? scriptImages[0] : ''),
            images: scriptImages.length > 0 ? scriptImages : (mainUrl ? [mainUrl] : []),
            videos: scriptVideos,
            selected: true,
            available: true
        });
    }

    // Don't need hydration for videos anymore as we did it inline, but keeping safety check
    hydrateAllVariantVideos(variants, globalVideoCache);

    // CLEANUP: Detect and purge cache collisions to prevent future poisoning
    // If multiple ASINs map to the EXACT same image set in the cache, it's likely a poisoning error.
    const reverseMap: Record<string, string[]> = {};
    Object.keys(globalCache).forEach(asin => {
        if (!globalCache[asin] || globalCache[asin].length === 0) return;
        const signature = globalCache[asin].map(u => getImageCoreId(u)).sort().join('|');
        if (reverseMap[signature]) {
            // Collision detected! 
            // Only keeping the one that matches our currently reliable sources (like colorToAsin or currentAsin)
            // If unknown, we might have to purge both or keep the one that matches dimension data.
            // For safety, if we find the current active ASIN in a collision, we trust the CURRENT scrape and purge the others.
            reverseMap[signature].push(asin);
        } else {
            reverseMap[signature] = [asin];
        }
    });

    Object.values(reverseMap).forEach(asins => {
        if (asins.length > 1) {
            // We have multiple ASINs having identical image sets. This is wrong 99% of the time for this product.
            // We keep the one that matches the current authoritative scrape (if any) and nuke the rest.
            const validAsin = asins.find(a => asinToImages[a] && asinToImages[a].length > 0);
            asins.forEach(a => {
                if (a !== validAsin) {
                    delete globalCache[a]; // Purge bad cache
                }
            });
        }
    });

    return variants;
}
