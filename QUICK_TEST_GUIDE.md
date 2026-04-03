# 🚀 Quick Start: Testing Global Amazon Support

## ✅ Status: Extension Built Successfully!

Your extension is now configured and built with support for **all 22 Amazon country marketplaces**.

---

## 🔧 Step 1: Load Extension in Browser

1. **Open Chrome or Edge**

2. **Navigate to Extensions Page**:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`

3. **Enable Developer Mode** (toggle in top-right corner)

4. **Load the Extension**:
   - Click "Load unpacked"
   - Navigate to: `C:\Users\madhu\OneDrive\Documents\GitHub\AWZImage-Amazon-Image-Downloader\.output\chrome-mv3-dev`
   - Click "Select Folder"

5. **Verify Extension Loaded**:
   - ✅ You should see "Pixora - Amazon Media Downloader" in the extensions list
   - ✅ Extension icon appears in your browser toolbar

---

## 🌍 Step 2: Test on Multiple Countries

### Quick Test (5 minutes):

Test these 3 countries for a quick verification:

| Country | Test URL | What to Check |
|---------|----------|---------------|
| 🇺🇸 **USA** | [Amazon.com Product](https://www.amazon.com/dp/B0D1XD1ZV3) | Extension loads, images detected |
| 🇫🇷 **France** | [Amazon.fr Product](https://www.amazon.fr/dp/B0D1XD1ZV3) | Extension works on new domain |
| 🇨🇦 **Canada** | [Amazon.ca Product](https://www.amazon.ca/dp/B0CXVB8WNK) | Extension works on new domain |

### For Each Test:

1. **Visit the URL** in your browser
2. **Open DevTools** (Press `F12`)
3. **Check Console tab** for: `AMZImage Content Script v3.0 Loaded`
4. **Click Extension Icon** to open side panel
5. **Verify**:
   - ✅ Product images appear
   - ✅ Videos appear (if product has videos)
   - ✅ Review media loads
   - ✅ Download buttons work

---

## 📊 Expected Results

### ✅ Success Indicators:

**In Browser Console:**
```
AMZImage Content Script v3.0 Loaded
AMZImage: Loading ALL variant media...
AMZImage: Loaded media for X variants
AMZImage: Prefetching review media for [ASIN]
```

**In Extension UI:**
- Product images displayed in grid
- Video thumbnails visible
- Download All button active
- Review media section populated

### ❌ If Extension Doesn't Load:

1. **Reload the extension**:
   - Go to `chrome://extensions/`
   - Click the refresh icon on Pixora extension

2. **Hard refresh the Amazon page**:
   - Press `Ctrl + Shift + R` (Windows)
   - Press `Cmd + Shift + R` (Mac)

3. **Check manifest**: Ensure the domain is listed in the manifest.json

---

## 🔍 Verification Checklist

- [ ] Extension installed in browser
- [ ] Extension icon visible in toolbar
- [ ] Tested amazon.com (USA) ✅
- [ ] Tested amazon.fr (France) ✅
- [ ] Tested amazon.ca (Canada) ✅
- [ ] Console shows "AMZImage" logs on all domains
- [ ] Side panel opens on all domains
- [ ] Images download successfully

---

## 📝 Domain List (All Supported)

Your extension now works on these domains:

```
✅ amazon.com         (USA)
✅ amazon.ca          (Canada)
✅ amazon.com.mx      (Mexico)
✅ amazon.co.uk       (UK)
✅ amazon.de          (Germany)
✅ amazon.fr          (France)  ⭐ NEW
✅ amazon.it          (Italy)   ⭐ NEW
✅ amazon.es          (Spain)   ⭐ NEW
✅ amazon.nl          (Netherlands) ⭐ NEW
✅ amazon.se          (Sweden)  ⭐ NEW
✅ amazon.pl          (Poland)  ⭐ NEW
✅ amazon.com.tr      (Turkey)  ⭐ NEW
✅ amazon.com.be      (Belgium) ⭐ NEW
✅ amazon.co.jp       (Japan)
✅ amazon.in          (India)
✅ amazon.cn          (China)   ⭐ NEW
✅ amazon.sg          (Singapore) ⭐ NEW
✅ amazon.com.au      (Australia) ⭐ NEW
✅ amazon.ae          (UAE)     ⭐ NEW
✅ amazon.sa          (Saudi Arabia) ⭐ NEW
✅ amazon.eg          (Egypt)   ⭐ NEW
✅ amazon.com.br      (Brazil)  ⭐ NEW
```

---

## 🎯 Next Steps

1. ✅ **Test the extension** using the quick test URLs above
2. 📸 **Take screenshots** of working extension on different countries
3. 📝 **Report any issues** you find
4. 🚀 **Build production version** when ready: `npm run build`

---

## 🐛 Troubleshooting

### Issue: "Extension not loading on amazon.fr"
**Solution**: Check that you loaded the extension from `.output/chrome-mv3-dev` folder

### Issue: "Permission denied" errors
**Solution**: The manifest already includes all permissions. Reload the extension.

### Issue: "No console logs showing"
**Solution**: 
1. Make sure DevTools is open BEFORE loading the page
2. Try hard refresh (Ctrl+Shift+R)
3. Check extension is enabled in `chrome://extensions/`

---

## 📚 Additional Resources

- **Full Testing Checklist**: See `TESTING_CHECKLIST.md`
- **Supported Countries**: See `SUPPORTED_COUNTRIES.md`
- **Build Guide**: See `RUN_GUIDE.md`

---

**Ready to Test?** 🚀  
Start with amazon.com, then try amazon.fr and amazon.ca!

The extension is fully configured and built - just load it in your browser and visit any Amazon country website!
