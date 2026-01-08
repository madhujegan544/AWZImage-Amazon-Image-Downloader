# AMZImage → "Pixora" Premium Frontend Redesign

## Executive Summary

A complete frontend overhaul transforming AMZImage into **Pixora** — a premium, intuitive Amazon media downloader that feels effortless to use for anyone, regardless of technical skill.

---

## 1. Brand Identity Refresh

### 1.1 New Name: **Pixora**
- **Why**: Short, memorable, premium-sounding
- **Meaning**: "Pixel" + "Aura" — suggests visual elegance
- **Tagline**: "Amazon Media, Instantly."

### 1.2 Logo Concept
- **Shape**: Rounded square (like app icons) with a subtle download arrow integrated
- **Style**: Modern gradient, clean lines
- **Color**: Primary blue gradient

### 1.3 Color System (Light Theme)

| Token | Value | Usage |
|-------|-------|-------|
| `--primary` | `#2563EB` | Primary actions, active states |
| `--primary-hover` | `#1D4ED8` | Button hovers |
| `--primary-soft` | `#EFF6FF` | Subtle backgrounds, selected states |
| `--surface` | `#FFFFFF` | Cards, panels |
| `--background` | `#F8FAFC` | App background |
| `--text` | `#0F172A` | Primary text |
| `--text-muted` | `#64748B` | Secondary text |
| `--border` | `#E2E8F0` | Dividers, borders |
| `--success` | `#10B981` | Success states |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle elevation |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.08)` | Cards, modals |
| `--radius-sm` | `8px` | Buttons, inputs |
| `--radius-md` | `12px` | Cards |
| `--radius-lg` | `16px` | Panels, modals |

### 1.4 Typography
- **Font**: `Google Sans Flex` (Variable font, premium Google typeface)
- **Import**: `https://fonts.google.com/specimen/Google+Sans+Flex`
- **Fallbacks**: `'Google Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif`
- **Weights**: 400 (body), 500 (labels), 600 (headings), 700 (emphasis)
- **Scale**: 11px (caption) → 13px (body) → 15px (heading) → 18px (title)

**CSS Import**:
```css
@import url('https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@400;500;600;700&display=swap');
```

**Font Stack**:
```css
font-family: 'Google Sans Flex', 'Google Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
```

---

## 2. Layout Architecture (Space Optimized)

### 2.1 Container Dimensions
- **Width**: 380px (fixed, optimal for Chrome extensions)
- **Height**: 100vh (full panel height)
- **Scrolling**: Content area only, header/footer fixed

### 2.2 Structural Zones

```
┌────────────────────────────────────┐
│  HEADER (48px fixed)               │
│  Logo | Product Count | Settings   │
├────────────────────────────────────┤
│                                    │
│  PRODUCT CONTEXT (collapsible)     │
│  Title + ASIN + Variant Selector   │
│                                    │
├────────────────────────────────────┤
│                                    │
│  MEDIA GALLERY (scrollable)        │
│  - Unified grid                    │
│  - Images & Videos together        │
│  - Tap to select                   │
│  - Hover for quick download        │
│                                    │
│                                    │
├────────────────────────────────────┤
│  FOOTER ACTION (56px fixed)        │
│  [ Download All ] Primary Button   │
└────────────────────────────────────┘
```

---

## 3. Interaction Simplification

### 3.1 Download Workflow (Simplified)

**Before (Complex)**:
- Download All button in header
- Select All per section
- Download Selected per section
- Format selection modal
- Individual download buttons on hover

**After (Streamlined)**:

| Action | Trigger | Result |
|--------|---------|--------|
| **Quick Download** | Tap main "Download All" button | ZIP of all media downloads immediately |
| **Single Download** | Hover image → click download icon | Single file downloads (auto format) |
| **Select Mode** | Long-press OR tap item | Enters selection mode, shows selection UI |
| **Download Selected** | Tap "Download Selected" (appears when items selected) | ZIP of selected items |

### 3.2 Selection Mode States

```
IDLE STATE:
- All items show normally
- Hover reveals download icon (individual)
- Footer shows "Download All (X items)"

SELECTION STATE (triggered on first tap):
- Items show checkboxes
- Selected items have blue border
- Footer transforms: "[X] Cancel" + "Download X Selected"
- Tap item again = toggle selection
```

### 3.3 Removed Complexity
- ❌ Format selection modal (auto-detect best format server-side)
- ❌ Section-level "Select All" buttons (unified selection instead)
- ❌ Section-level download buttons (use selection mode)
- ❌ Separate sections for images/videos (unified gallery with badges)
- ❌ Global selection counter in footer (integrated into button)

---

## 4. Component Design Specifications

### 4.1 Header Component

**Requirements**:
- Compact: 48px height max
- Elements: Logo/Name, Total media count, Settings/Refresh buttons

**Visual**:
```
┌─────────────────────────────────────────┐
│ [Logo] Pixora        📷 42    ⟳   ⚙️   │
│         ↑             ↑       ↑    ↑    │
│     Brand Name    Count   Refresh Settings
└─────────────────────────────────────────┘
```

### 4.2 Product Context Card

**Requirements**:
- Collapsible (tap to expand/collapse)
- Shows: Product title (truncated), ASIN badge, Variant pills
- Only shown on product pages, hidden on listing pages

**Visual (Collapsed)**:
```
┌─────────────────────────────────────────┐
│ Graphene 1:32 Scale DieCast... [ASIN] ▼│
└─────────────────────────────────────────┘
```

**Visual (Expanded)**:
```
┌─────────────────────────────────────────┐
│ Graphene 1:32 Scale DieCast Metal      │
│ Pull Back Action Openable Doors...      │
│ ───────────────────────────────────────│
│ [ASIN: B0DFY9YY73]                      │
│ Variant: [⚫ Color1][🔴 Color2][🔵C3].. │
└─────────────────────────────────────────┘
```

### 4.3 Media Gallery Grid

**Requirements**:
- Unified grid (no sections): Images + Videos mixed
- Badge system to differentiate: 📷 Image, 🎬 Video, ⭐ Review
- Lazy loading with skeleton
- 3 columns for images, 2 columns when video present
- Hover state: overlay with download icon
- Selection state: blue border + checkmark

**Visual**:
```
┌─────┐ ┌─────┐ ┌─────┐
│ 📷  │ │ 📷  │ │ 🎬  │
│     │ │     │ │  ▶  │
│   ⬇ │ │   ⬇ │ │   ⬇ │←hover icon
└─────┘ └─────┘ └─────┘
┌─────┐ ┌─────┐ ┌─────┐
│⭐📷 │ │ ✓  │ │⭐📷 │
│     │ │sel │ │     │
└─────┘ └─────┘ └─────┘
    ↑
 Review badge
```

### 4.4 Footer Action Bar

**Idle State**:
```
┌─────────────────────────────────────────┐
│     [ ⬇ Download All · 42 items ]      │
│            (Primary Button)             │
└─────────────────────────────────────────┘
```

**Selection State (X items selected)**:
```
┌─────────────────────────────────────────┐
│  [✕ Clear]    [ ⬇ Download 5 Selected ]│
│   Secondary         Primary             │
└─────────────────────────────────────────┘
```

### 4.5 Empty State

**When no media found**:
```
┌─────────────────────────────────────────┐
│                                         │
│            ┌─────────┐                  │
│            │   📷    │                  │
│            │   ❓    │                  │
│            └─────────┘                  │
│                                         │
│       No media found on this page       │
│                                         │
│    Make sure you're on an Amazon        │
│    product page and try refreshing.     │
│                                         │
│           [ ⟳ Refresh ]                 │
│                                         │
└─────────────────────────────────────────┘
```

### 4.6 Loading State

**Skeleton with pulse animation**:
```
┌─────────────────────────────────────────┐
│ [████████]  ○○○○                 ░ ░    │ ← header skeleton
├─────────────────────────────────────────┤
│ ████████████████████████████           │ ← product context
│ ██████████  [████]                      │
├─────────────────────────────────────────┤
│ ┌─────┐ ┌─────┐ ┌─────┐                │
│ │░░░░░│ │░░░░░│ │░░░░░│                │ ← media grid
│ └─────┘ └─────┘ └─────┘                │
│ ┌─────┐ ┌─────┐ ┌─────┐                │
│ │░░░░░│ │░░░░░│ │░░░░░│                │
│ └─────┘ └─────┘ └─────┘                │
└─────────────────────────────────────────┘
```

---

## 5. Micro-Interactions & Animations

### 5.1 Timing Curves
- **Standard**: `cubic-bezier(0.4, 0, 0.2, 1)` — 200ms
- **Enter**: `cubic-bezier(0, 0, 0.2, 1)` — 250ms
- **Exit**: `cubic-bezier(0.4, 0, 1, 1)` — 150ms

### 5.2 Key Animations

| Element | Trigger | Animation |
|---------|---------|-----------|
| Media item hover | Mouse enter | Scale to 1.02, reveal overlay (150ms) |
| Selection toggle | Tap | Checkmark fade+scale in (200ms) |
| Download button | Click | Button pulse + icon spin (during download) |
| Download complete | Finish | Green flash + checkmark morph (400ms) |
| Section collapse | Tap header | Height animate + rotate chevron (250ms) |
| Loading skeleton | On load | Shimmer animation (1.5s loop) |

---

## 6. Listing Page Specific Design

### 6.1 Layout Adaptation
- Replace Product Context with **Search Bar**
- Grid shows product thumbnails instead of individual images
- Tap product → Opens detail modal OR downloads that product's image

### 6.2 Search Bar
```
┌─────────────────────────────────────────┐
│ 🔍 Search products...           [✕] [→]│
└─────────────────────────────────────────┘
```

---

## 7. Implementation Status

### ✅ Phase 1: Foundation (COMPLETED)
1. ✅ Created new design tokens file (`App.css`)
2. ✅ Set up new color system (primary blue #2563EB)
3. ✅ Implemented Google Sans Flex typography
4. ✅ Created animation keyframes

### ✅ Phase 2: Core Components (COMPLETED)
1. ✅ New Header component with logo and media count
2. ✅ Product Context Card (collapsible)
3. ✅ Unified Media Grid
4. ✅ Media Item with hover/selection states
5. ✅ Footer Action Bar (Download All / Download Selected)

### ✅ Phase 3: Interactions (COMPLETED)
1. ✅ Selection mode logic (tap to select)
2. ✅ Simplified download workflow
3. ✅ Animations and transitions
4. ✅ Loading/Empty states

### ✅ Phase 4: Polish (COMPLETED)
1. ✅ Listing page adaptation with search bar
2. ✅ Listing product cards with hover download
3. ✅ Error handling and states
4. ✅ Download success feedback (green flash)
5. ✅ Variant selector with click navigation
6. ✅ Welcome and Login screen integration

### ✅ Phase 5: Complete (COMPLETED)
1. ✅ All views implemented
2. ✅ Cross-page type support (product + listing)
3. ✅ Smooth animations throughout
4. ✅ Premium visual polish

### ✅ Phase 6: Enhanced Features (COMPLETED)
1. ✅ **Variant Dropdown Selector**
   - Dropdown showing all available variants
   - Visual preview with variant images
   - "Download All Variants" option at top
   - Click variant to switch (navigation ready)
   
2. ✅ **Category Filter Tabs**
   - All | Product | Reviews | Videos
   - Shows count for each category
   - Filters grid to selected category
   - Download button updates based on filter
   
3. ✅ **Optimized Grid Display**
   - Shows first 9 items initially
   - "Show More" button reveals rest
   - "Show Less" to collapse back
   - Reduces cognitive overload

---

## 8. Files to Modify

| File | Changes |
|------|---------|
| `components/PanelApp.tsx` | Complete rewrite with new design |
| `components/App.css` | Replace with new design tokens |
| `components/Welcome.tsx` | Update styling to match new brand |
| `components/Login.tsx` | Update styling to match new brand |
| `assets/` | New logo assets |
| `manifest.json` | Update extension name to "Pixora" |

---

## 9. Success Metrics

Upon completion, the redesign should achieve:

- [ ] **First Impression**: Clean, premium, trustworthy
- [ ] **Time to First Download**: < 3 seconds from opening
- [ ] **Cognitive Load**: Single primary action visible at all times
- [ ] **Space Efficiency**: No wasted pixels, everything purposeful
- [ ] **Delight Factor**: Smooth animations make tool feel "alive"
- [ ] **Universal Usability**: No instructions needed to use

---

## 10. Visual Reference (To Be Generated)

I will create a mockup image showing the new design before implementation begins.

---

**Ready to proceed?** Once you approve this plan, I will:
1. Generate a visual mockup for your review
2. Begin implementation starting with Phase 1

