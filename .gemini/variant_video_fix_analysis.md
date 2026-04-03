# Variant Video Rendering Issue - Analysis and Fix

## Problem Statement
The user reported that before selecting a variant, the proper video set associated with the variant is shown correctly. However, after selecting a variant, the system improperly renders the default variant's video instead of the selected variant's video.

## Root Cause Analysis

### The Issue
The bug was in the `getMediaItems` function in `PanelApp.tsx`. This function is responsible for collecting all media items (images and videos) to display for the current context.

**Lines 288-290 (Original Code):**
```typescript
(data.productVideos || data.videos || []).forEach(url => {
    addItem(url, 'video', 'product', 'productVideo');
});
```

### Why This Was Wrong
While the function correctly handled **images** by checking the selected variant and using `selectedVariant.images`, it **completely ignored** `selectedVariant.videos` for videos. Instead, it always used `data.productVideos` or `data.videos`, which are the default product videos.

This meant:
- **Before variant selection**: The `enrichProductData` function (lines 193-195) would set fallback videos for the active variant, so videos appeared correct
- **After variant selection**: The `getMediaItems` function would override these with the default product videos

## The Fix

### Changes Made

#### 1. Updated `getMediaItems` Function (Lines 223-306)
Added video resolution logic similar to image resolution:

```typescript
// Determine which product images and videos to show
let displayImages: string[] = [];
let displayVideos: string[] = [];

// ... (same variant selection logic)

if (selectedVariant) {
    // ... (image resolution logic)
    
    // VIDEO RESOLUTION: Use variant-specific videos when available
    // This is critical - we must use the selectedVariant's videos, NOT the default product videos
    if (selectedVariant.videos && selectedVariant.videos.length > 0) {
        displayVideos = selectedVariant.videos;
    } else {
        // Only fall back to product videos if the variant has no specific videos
        displayVideos = data.productVideos || data.videos || [];
    }
}

// ... (fallback logic for products without variants)

// Use the variant-specific videos instead of always using data.productVideos/data.videos
displayVideos.forEach(url => {
    addItem(url, 'video', 'product', 'productVideo');
});
```

#### 2. Added Video Caching (Line 353-354)
Added a cache state for variant videos, similar to the existing image cache:

```typescript
// Per-ASIN cache for variant videos - preserves correct videos for ALL variants across selections
const [variantVideosCache, setVariantVideosCache] = useState<Record<string, string[]>>({});
```

#### 3. Updated `allMediaItems` useMemo (Lines 360-386)
Modified to use both cached images AND videos:

```typescript
const cachedVideos = selectedVariantAsin ? variantVideosCache[selectedVariantAsin] : null;

if (selectedVariantAsin && (cachedImages || cachedVideos) && productData) {
    const modifiedData = {
        ...productData,
        variants: productData.variants?.map(v =>
            v.asin === selectedVariantAsin
                ? { 
                    ...v, 
                    images: cachedImages || v.images, 
                    videos: cachedVideos || v.videos,
                    selected: true 
                  }
                : { ...v, selected: false }
        )
    };
    return getMediaItems(modifiedData, selectedVariantAsin);
}
```

#### 4. Updated `handleVariantSelect` (Lines 917-925)
Now caches videos when a variant is selected:

```typescript
if (variantVideos && variantVideos.length > 0) {
    setVariantVideosCache(prev => ({ ...prev, [asin]: [...variantVideos] }));
}
```

#### 5. Updated Polling Logic (Lines 946-976)
Enforces cached videos during background updates:

```typescript
let vidsToEnforce = variantVideosCache[asin] || variantVideos;

// ... 

// Strict Sync: Ensure main product videos match this variant only
if (enrichedData && enforcedVideos && enforcedVideos.length > 0) {
    enrichedData.videos = [...enforcedVideos];
}
```

#### 6. Updated Background Polling (Lines 770-800)
Enforces cached videos during silent product updates:

```typescript
if (selectedVariantAsin && (variantImagesCache[selectedVariantAsin] || variantVideosCache[selectedVariantAsin])) {
    const enforcedVideos = variantVideosCache[selectedVariantAsin];
    if (enforcedVideos && enforcedVideos.length > 0) {
        enrichedNewData.videos = [...enforcedVideos];
    }
    // ... update variant objects with enforced videos
}
```

#### 7. Updated Cleanup Functions
- `handleRefresh` (Line 1191): Clears `variantVideosCache`
- Product change detection (Line 753): Clears `variantVideosCache`  
- `renderVariantList` (Lines 1668-1680): Uses cached videos when rendering variant cards

## How It Works Now

### Flow:
1. **Initial Load**: Variants are enriched with their specific videos via `enrichProductData`
2. **Variant Selection**: 
   - Videos are cached in `variantVideosCache[asin]`
   - `selectedVariantAsin` is set to track the selection
3. **Rendering**:
   - `allMediaItems` useMemo checks for cached videos
   - `getMediaItems` uses `selectedVariant.videos` instead of default product videos
   - Videos from the correct variant are displayed
4. **Background Updates**:
   - Cached videos are enforced to prevent pollution from background data updates
   - Videos persist correctly across all operations

## Testing Checklist

✅ Before selecting variant: Proper videos shown  
✅ After selecting variant: Correct variant videos shown (not default)  
✅ Switching between variants: Each variant shows its own videos  
✅ Background updates: Videos don't revert to defaults  
✅ Refresh: Clears cache and reloads fresh data  
✅ Product navigation: Cache cleared for new product  

## Summary
The fix ensures that variant-specific videos are treated with the same priority and caching logic as variant-specific images, preventing the default product videos from incorrectly displaying for non-default variants.

## Improved Strategy (v2)

### Key Principle: Upfront Caching
**All variants are cached immediately on first load. When selecting a variant, no other variants are refreshed.**

### Benefits:
1. ✅ **Performance**: No re-enrichment overhead when switching variants
2. ✅ **Data Integrity**: Each variant preserves its original media set
3. ✅ **Predictability**: No unexpected data changes during navigation
4. ✅ **Simplicity**: Cleaner logic with single source of truth (cache)

### Implementation:

#### 1. Upfront Caching on Initial Load
```typescript
// In loadData() after enrichProductData:
if (enrichedData?.variants && enrichedData.variants.length > 0) {
    const newImageCache: Record<string, string[]> = {};
    const newVideoCache: Record<string, string[]> = {};
    
    enrichedData.variants.forEach(variant => {
        if (variant.images && variant.images.length > 0) {
            newImageCache[variant.asin] = [...variant.images];
        }
        if (variant.videos && variant.videos.length > 0) {
            newVideoCache[variant.asin] = [...variant.videos];
        }
    });
    
    // Merge with existing cache (preserve user selections)
    setVariantImagesCache(prev => ({ ...newImageCache, ...prev }));
    setVariantVideosCache(prev => ({ ...newVideoCache, ...prev }));
}
```

#### 2. Preserve Other Variants During Selection
```typescript
// In handleVariantSelect polling:
enrichedData.variants = enrichedData.variants.map(v => {
    if (v.asin === asin) {
        // This is the selected variant - update it
        return { ...v, images: enforcedImages, videos: enforcedVideos, selected: true };
    } else {
        // THIS IS CRITICAL: Preserve from existing state, not from fresh scrape
        const existingVariant = existingVariants.find(ev => ev.asin === v.asin);
        if (existingVariant) {
            return {
                ...existingVariant,
                images: variantImagesCache[v.asin] || existingVariant.images,
                videos: variantVideosCache[v.asin] || existingVariant.videos,
                selected: false
            };
        }
        return { ...v, selected: false };
    }
});
```

#### 3. Preserve All Variants in Background Updates
```typescript
// In background polling:
enrichedNewData.variants = enrichedNewData.variants.map(v => {
    const cachedImages = variantImagesCache[v.asin];
    const cachedVideos = variantVideosCache[v.asin];
    const existingVariant = existingVariants.find(ev => ev.asin === v.asin);
    
    // Use cached data first, then existing, then scraped
    return {
        ...v,
        images: cachedImages || existingVariant?.images || v.images,
        videos: cachedVideos || existingVariant?.videos || v.videos,
        selected: v.asin === selectedVariantAsin || v.selected
    };
});
```

### Complete Flow:

```
┌─────────────────────────────────────────────────────────┐
│ 1. INITIAL PAGE LOAD                                    │
│    - Scrape all variants                                │
│    - Enrich with variant-specific media                 │
│    - Cache ALL variants immediately                     │
│    - No variant is "special" - all are equal            │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ 2. USER SELECTS VARIANT A                               │
│    - Cache Variant A's media (if not already)           │
│    - Click variant on Amazon page                       │
│    - Poll for confirmation                              │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ 3. POLL RESPONSE                                         │
│    - Scrape returns fresh data                          │
│    - For Variant A: Use enforced cache                  │
│    - For Variant B, C, D: Preserve from existing state  │
│    - NO re-enrichment of other variants                 │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ 4. BACKGROUND UPDATES                                    │
│    - Every 1.5s: Scrape for changes                     │
│    - For ALL variants: Use cache → existing → scraped   │
│    - Variants never lose their data                     │
└─────────────────────────────────────────────────────────┘
```

### Cache Priority:
```
1. variantImagesCache[asin] - User selections or initial cache
2. existingVariant.images    - Last known state
3. v.images                  - Fresh scrape (rarely used)
```

This ensures **zero data loss** and **zero unnecessary refreshes**!
