# How to Run AMZImage Downloader

Follow these steps to load and test your new Chrome extension.

### 1. Ensure the Development Server is Running
Open your terminal in `d:\extension` and run:
`npm run dev`

This command will:
- Watch for file changes.
- Build the extension into the `.output/chrome-mv3` folder.

### 2. Manually Load into Chrome
1. Open Google Chrome.
2. Navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the folder: `d:\extension\.output\chrome-mv3`.

### 3. Test on Amazon
1. Navigate to any Amazon product page (e.g., [Amazon Product Page](https://www.amazon.com/dp/B08L5TNJHG)).
2. Click the **Extensions** icon (puzzle piece) and pin **AMZImage**.
3. Click the **AMZImage** icon to open the popup.
4. Watch the premium animations as it scrapes the page!
5. Select images and click **ZIP Selection** or **Download All**.

### 4. Troubleshooting
- **No Images Found**: Ensure the page has fully loaded before opening the popup.
- **Port Conflicts**: If `npm run dev` fails, close any existing terminal processes first.
