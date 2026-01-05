import { useState, useEffect } from 'react';
import { Download, Grid, Trash2, Camera, Package, ExternalLink, RefreshCw, Check, MousePointer2, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

function App() {
    const [images, setImages] = useState<string[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [downloading, setDownloading] = useState(false);

    useEffect(() => {
        loadImages();
    }, []);

    const loadImages = async () => {
        setLoading(true);
        try {
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
                const response = await browser.tabs.sendMessage(tab.id, { type: 'GET_IMAGES' });
                if (response?.images) {
                    setImages(response.images);
                }
            }
        } catch (error) {
            console.error('Failed to get images:', error);
            // For content script context, scrape directly
            const message = { type: 'GET_IMAGES' };
            const response = await browser.runtime.sendMessage(message);
            if (response?.images) {
                setImages(response.images);
            }
        } finally {
            setLoading(false);
        }
    };

    const toggleSelect = (url: string) => {
        const next = new Set(selected);
        if (next.has(url)) next.delete(url);
        else next.add(url);
        setSelected(next);
    };

    const selectAll = () => {
        if (selected.size === images.length) setSelected(new Set());
        else setSelected(new Set(images));
    };

    const downloadSelected = async () => {
        const urls = Array.from(selected);
        if (urls.length === 0) return;

        setDownloading(true);
        try {
            await browser.runtime.sendMessage({
                type: 'DOWNLOAD_ZIP',
                urls,
                filename: `amazon-images-${Date.now()}`
            });
        } finally {
            setTimeout(() => setDownloading(false), 2000);
        }
    };

    const downloadAll = async () => {
        if (images.length === 0) return;
        setDownloading(true);
        try {
            await browser.runtime.sendMessage({
                type: 'DOWNLOAD_ZIP',
                urls: images,
                filename: `amazon-images-all-${Date.now()}`
            });
        } finally {
            setTimeout(() => setDownloading(false), 2000);
        }
    };

    return (
        <div className="flex flex-col h-screen w-full bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden font-sans selection:bg-orange-500/30">
            {/* Premium Gradient Header */}
            <header className="relative z-10 flex items-center justify-between px-5 py-4 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-3"
                >
                    <div className="relative group">
                        <div className="absolute -inset-1 bg-gradient-to-r from-orange-600 to-yellow-500 rounded-lg blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                        <div className="relative p-2 bg-slate-900 rounded-lg">
                            <Camera className="w-5 h-5 text-white" />
                        </div>
                    </div>
                    <div>
                        <h1 className="font-extrabold text-xl tracking-tighter leading-none">
                            AMZ<span className="text-orange-500">IMAGE</span>
                        </h1>
                        <p className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">Premium Downloader</p>
                    </div>
                </motion.div>

                <motion.button
                    whileHover={{ rotate: 180 }}
                    transition={{ duration: 0.5 }}
                    onClick={loadImages}
                    className="p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors text-slate-500"
                >
                    <RefreshCw className="w-5 h-5" />
                </motion.button>
            </header>

            {/* Grid Stats / Tabs */}
            <div className="flex items-center gap-4 px-5 py-2.5 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                    <Layers className="w-3.5 h-3.5" />
                    <span>{images.length} Images Found</span>
                </div>
                {selected.size > 0 && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex items-center gap-1.5 text-xs font-bold text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-500/10 px-2 py-0.5 rounded-full"
                    >
                        <Check className="w-3.5 h-3.5" />
                        <span>{selected.size} Selected</span>
                    </motion.div>
                )}
            </div>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                <AnimatePresence mode="wait">
                    {loading ? (
                        <motion.div
                            key="loading"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex flex-col items-center justify-center h-full gap-6 text-slate-400"
                        >
                            <div className="relative">
                                <div className="w-16 h-16 border-4 border-slate-200 dark:border-slate-800 rounded-full" />
                                <div className="absolute top-0 left-0 w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
                            </div>
                            <p className="font-bold tracking-tight text-lg">Scanning Amazon Page...</p>
                        </motion.div>
                    ) : images.length > 0 ? (
                        <motion.div
                            key="grid"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="grid grid-cols-2 gap-4"
                        >
                            {images.map((url, i) => (
                                <motion.div
                                    key={url}
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ delay: i * 0.05 }}
                                    onClick={() => toggleSelect(url)}
                                    className={cn(
                                        "relative group aspect-[4/5] rounded-2xl overflow-hidden border-2 transition-all cursor-pointer bg-white dark:bg-slate-800/50 shadow-sm",
                                        selected.has(url)
                                            ? "border-orange-500 ring-4 ring-orange-500/10 scale-[1.02] shadow-orange-500/10"
                                            : "border-transparent hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-lg"
                                    )}
                                >
                                    <img
                                        src={url}
                                        alt={`Scraped ${i}`}
                                        className="w-full h-full object-contain p-3 group-hover:scale-110 transition-transform duration-500"
                                    />

                                    {/* Selection Overlay */}
                                    <div className={cn(
                                        "absolute top-3 right-3 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                                        selected.has(url)
                                            ? "bg-orange-500 border-orange-400 rotate-0 scale-100"
                                            : "bg-black/20 border-white/50 -rotate-90 scale-75 opacity-0 group-hover:opacity-100"
                                    )}>
                                        <Check className={cn("w-4 h-4 text-white transition-opacity", selected.has(url) ? "opacity-100" : "opacity-0")} />
                                    </div>

                                    {/* Actions Overlay */}
                                    <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex justify-end">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                window.open(url, '_blank');
                                            }}
                                            className="p-2 bg-white/20 hover:bg-white/40 backdrop-blur-md text-white rounded-lg transition-colors border border-white/20"
                                        >
                                            <ExternalLink className="w-4 h-4" />
                                        </button>
                                    </div>
                                </motion.div>
                            ))}
                        </motion.div>
                    ) : (
                        <motion.div
                            key="empty"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="flex flex-col items-center justify-center h-full gap-6 text-center p-8"
                        >
                            <div className="relative">
                                <div className="absolute -inset-4 bg-orange-500/20 rounded-full blur-2xl animate-pulse" />
                                <div className="relative p-6 bg-slate-100 dark:bg-slate-800 rounded-full">
                                    <Camera className="w-16 h-16 text-slate-400" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-2xl font-black tracking-tight">No Images Found</h2>
                                <p className="text-slate-500 text-sm font-medium leading-relaxed">
                                    Navigate to an Amazon product page and refresh the scraper.
                                </p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </main>

            {/* Footer Actions */}
            <footer className="px-5 py-6 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 space-y-4 shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
                {images.length > 0 && (
                    <>
                        <div className="flex items-center justify-between">
                            <button
                                onClick={selectAll}
                                className="text-xs font-extrabold text-slate-500 hover:text-orange-600 dark:hover:text-orange-400 uppercase tracking-widest transition-colors flex items-center gap-2"
                            >
                                <MousePointer2 className="w-3.5 h-3.5" />
                                {selected.size === images.length ? 'Deselect All' : 'Select All'}
                            </button>
                            <span className="text-[10px] uppercase tracking-widest font-black text-slate-400">
                                Selection Ready
                            </span>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <motion.button
                                whileTap={{ scale: 0.95 }}
                                disabled={selected.size === 0 || downloading}
                                onClick={downloadSelected}
                                className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30 disabled:grayscale rounded-2xl font-bold transition-all border border-slate-200 dark:border-slate-800"
                            >
                                <Package className="w-4 h-4" />
                                <span>ZIP Selection</span>
                            </motion.button>
                            <motion.button
                                whileTap={{ scale: 0.95 }}
                                disabled={downloading}
                                onClick={downloadAll}
                                className="relative flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-orange-600 to-orange-500 text-white rounded-2xl font-bold transition-all shadow-xl shadow-orange-500/20 overflow-hidden group"
                            >
                                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                                {downloading ? (
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Download className="w-4 h-4" />
                                )}
                                <span className="relative">{downloading ? 'Processing...' : 'Download All'}</span>
                            </motion.button>
                        </div>
                    </>
                )}
            </footer>

            <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(0,0,0,0.1);
          border-radius: 10px;
        }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.05);
        }
      `}</style>
        </div>
    );
}

export default App;
