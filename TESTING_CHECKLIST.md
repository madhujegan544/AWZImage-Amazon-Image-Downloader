# 🧪 Pixora Extension - Global Testing Checklist

## Pre-Testing Setup

- [ ] Build the extension: `npm run dev` or `npm run build`
- [ ] Load extension in Chrome/Edge (`chrome://extensions/` → Developer mode → Load unpacked → `.output/chrome-mv3`)
- [ ] Verify extension icon appears in browser toolbar
- [ ] Open DevTools Console (F12) to monitor extension logs

---

## 🌍 Test Cases by Country

### 🇺🇸 Test 1: United States (amazon.com)
**Product URL**: https://www.amazon.com/dp/B0D1XD1ZV3

**Checklist:**
- [ ] Page loads successfully
- [ ] Console shows: `AMZImage Content Script v3.0 Loaded`
- [ ] Extension side panel opens when clicking extension icon
- [ ] Product images are detected and displayed
- [ ] Product videos are detected (if available)
- [ ] Review media section shows customer images
- [ ] Download All button works
- [ ] ZIP file downloads with correct product name

**Expected Result**: ✅ Full functionality

---

### 🇨🇦 Test 2: Canada (amazon.ca)
**Product URL**: https://www.amazon.ca/dp/B0CXVB8WNK

**Checklist:**
- [ ] Page loads successfully
- [ ] Console shows: `AMZImage Content Script v3.0 Loaded`
- [ ] Extension side panel opens
- [ ] Product images are detected
- [ ] Canadian pricing displays correctly in extension
- [ ] Download functionality works
- [ ] ZIP file name includes ASIN

**Expected Result**: ✅ Full functionality

---

### 🇬🇧 Test 3: United Kingdom (amazon.co.uk)
**Product URL**: https://www.amazon.co.uk/dp/B0CXVB8WNK

**Checklist:**
- [ ] Page loads successfully
- [ ] Console shows: `AMZImage Content Script v3.0 Loaded`
- [ ] Extension detects UK-specific layout
- [ ] Product images load in high resolution
- [ ] Product variants display correctly
- [ ] Download All works

**Expected Result**: ✅ Full functionality

---

### 🇫🇷 Test 4: France (amazon.fr)
**Product URL**: https://www.amazon.fr/dp/B0D1XD1ZV3

**Checklist:**
- [ ] Page loads successfully
- [ ] Console shows: `AMZImage Content Script v3.0 Loaded`
- [ ] French language interface doesn't break extension
- [ ] Extension side panel displays correctly
- [ ] Images scrape correctly
- [ ] Download works with French product names

**Expected Result**: ✅ Full functionality

---

### 🇩🇪 Test 5: Germany (amazon.de)
**Product URL**: https://www.amazon.de/dp/B0D1XD1ZV3

**Checklist:**
- [ ] Page loads successfully
- [ ] Console shows: `AMZImage Content Script v3.0 Loaded`
- [ ] German characters in product titles handled correctly
- [ ] Extension UI renders properly
- [ ] All download features work

**Expected Result**: ✅ Full functionality

---

### 🇦🇺 Test 6: Australia (amazon.com.au)
**Product URL**: https://www.amazon.com.au/dp/B0CXVB8WNK

**Checklist:**
- [ ] Page loads successfully
- [ ] Console shows: `AMZImage Content Script v3.0 Loaded`
- [ ] Extension activates on Australian domain
- [ ] Product images detected
- [ ] Download functionality works

**Expected Result**: ✅ Full functionality

---

### 🇯🇵 Test 7: Japan (amazon.co.jp)
**Product URL**: https://www.amazon.co.jp/dp/B0CXVB8WNK

**Checklist:**
- [ ] Page loads successfully
- [ ] Console shows: `AMZImage Content Script v3.0 Loaded`
- [ ] Japanese characters don't break extension
- [ ] Images load correctly
- [ ] Download works with Japanese product names

**Expected Result**: ✅ Full functionality

---

### 🇮🇳 Test 8: India (amazon.in)
**Product URL**: https://www.amazon.in/dp/B0CXVB8WNK

**Checklist:**
- [ ] Page loads successfully
- [ ] Console shows: `AMZImage Content Script v3.0 Loaded`
- [ ] Extension works on Indian marketplace
- [ ] Rupee pricing displays (if shown)
- [ ] All features functional

**Expected Result**: ✅ Full functionality

---

### 🇸🇬 Test 9: Singapore (amazon.sg)
**Product URL**: https://www.amazon.sg/

**Checklist:**
- [ ] Page loads successfully
- [ ] Console shows: `AMZImage Content Script v3.0 Loaded`
- [ ] Extension activates on Singapore domain
- [ ] Find any product and test image detection
- [ ] Download functionality works

**Expected Result**: ✅ Full functionality

---

### 🇦🇪 Test 10: UAE (amazon.ae)
**Product URL**: https://www.amazon.ae/

**Checklist:**
- [ ] Page loads successfully
- [ ] Console shows: `AMZImage Content Script v3.0 Loaded`
- [ ] Extension works on Middle East marketplace
- [ ] Arabic product names handled correctly (if present)
- [ ] Download works

**Expected Result**: ✅ Full functionality

---

## 🔍 What to Check in Console

When testing each country, open DevTools (F12) and look for these console messages:

```
✅ AMZImage Content Script v3.0 Loaded
✅ AMZImage: Loading ALL variant media...
✅ AMZImage: Loaded media for X variants
✅ AMZImage: Prefetching review media for [ASIN]
```

**Error Messages to Watch For:**
- ❌ Refused to execute inline script (CSP issue)
- ❌ Failed to fetch
- ❌ Extension context invalidated
- ❌ Cannot access [domain]

---

## 🐛 Common Issues & Solutions

### Issue 1: Extension doesn't load on page
**Solution**: Check that the domain is in the `matches` array in `content.ts`

### Issue 2: Permission denied errors
**Solution**: Verify `host_permissions` in `wxt.config.ts` includes the domain

### Issue 3: Console shows no AMZImage logs
**Solution**: 
1. Reload the extension in `chrome://extensions/`
2. Hard refresh the Amazon page (Ctrl+Shift+R)
3. Check if extension is enabled

### Issue 4: Extension works on .com but not other countries
**Solution**: Rebuild the extension with `npm run build` and reload in browser

---

## 📊 Testing Summary Template

After testing, fill this out:

| Country | Domain | Loaded? | Images? | Videos? | Download? | Notes |
|---------|--------|---------|---------|---------|-----------|-------|
| 🇺🇸 USA | amazon.com | ⬜ | ⬜ | ⬜ | ⬜ | |
| 🇨🇦 Canada | amazon.ca | ⬜ | ⬜ | ⬜ | ⬜ | |
| 🇬🇧 UK | amazon.co.uk | ⬜ | ⬜ | ⬜ | ⬜ | |
| 🇫🇷 France | amazon.fr | ⬜ | ⬜ | ⬜ | ⬜ | |
| 🇩🇪 Germany | amazon.de | ⬜ | ⬜ | ⬜ | ⬜ | |
| 🇦🇺 Australia | amazon.com.au | ⬜ | ⬜ | ⬜ | ⬜ | |
| 🇯🇵 Japan | amazon.co.jp | ⬜ | ⬜ | ⬜ | ⬜ | |
| 🇮🇳 India | amazon.in | ⬜ | ⬜ | ⬜ | ⬜ | |
| 🇸🇬 Singapore | amazon.sg | ⬜ | ⬜ | ⬜ | ⬜ | |
| 🇦🇪 UAE | amazon.ae | ⬜ | ⬜ | ⬜ | ⬜ | |

---

## ✅ Success Criteria

The extension is working correctly if:
1. ✅ Console shows "AMZImage Content Script v3.0 Loaded" on every domain
2. ✅ Side panel opens on every domain
3. ✅ Product images are detected on every domain
4. ✅ Download functionality works on every domain
5. ✅ No console errors related to permissions or domain access

---

## 📝 Quick Test Script

For each Amazon domain, paste this in the console after the page loads:

```javascript
// Quick test to verify extension is loaded
console.log('Testing Pixora Extension...');
console.log('Domain:', window.location.hostname);
console.log('Extension active:', document.querySelector('[data-pixora]') !== null || performance.getEntriesByType('resource').some(r => r.name.includes('chrome-extension')));
console.log('Product ASIN:', document.getElementById('ASIN')?.value || 'Not found');
```

---

**Last Updated**: February 7, 2026  
**Version**: 2.0.0  
**Countries to Test**: 10+ recommended
