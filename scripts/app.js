// ASMR Video Collection Manager
// A client-side app to manage ASMR video bookmarks with tags and filtering

// ============================================
// Configuration
// ============================================
const STORAGE_KEY = 'asmrVideoCollection';
const PATREON_SESSION_KEY = 'asmrPatreonSession';
const THUMBNAIL_CACHE_KEY = 'asmrThumbnailCache';
const DB_NAME = 'ASMRVideoCollectionDB';
const DB_VERSION = 1;
const STORE_NAME = 'videos';
const SUGGESTED_TAGS = ['barbering', 'massage', 'haircut', 'relaxing', 'scalp', 'whispering', 'tapping', 'brushing', 'cutting', 'shaving', 'face', 'head', 'neck', 'shoulders', 'hot-towel', 'straight-razor', 'scissors', 'clipper', 'beard', 'mustache'];

// ============================================
// Thumbnail Cache
// ============================================
function getThumbnailCache() {
    try {
        const cached = localStorage.getItem(THUMBNAIL_CACHE_KEY);
        return cached ? JSON.parse(cached) : {};
    } catch {
        return {};
    }
}

function saveThumbnailCache(cache) {
    try {
        localStorage.setItem(THUMBNAIL_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.error('Failed to save thumbnail cache:', e);
    }
}

function getCachedThumbnail(url) {
    const cache = getThumbnailCache();
    return cache[url] || null;
}

function cacheThumbnail(url, thumbnailUrl) {
    if (!url || !thumbnailUrl) return;
    const cache = getThumbnailCache();
    cache[url] = thumbnailUrl;
    saveThumbnailCache(cache);
}

function removeCachedThumbnail(url) {
    const cache = getThumbnailCache();
    delete cache[url];
    saveThumbnailCache(cache);
}

// ============================================
// Thumbnail Image Cache (IndexedDB)
// ============================================
const THUMBNAIL_IMAGE_DB_NAME = 'ASMRThumbnailImageCache';
const THUMBNAIL_IMAGE_STORE = 'images';
const THUMBNAIL_IMAGE_VERSION = 1;

class ThumbnailImageCache {
    constructor() {
        this.db = null;
        this.initialized = false;
        this.initPromise = this.init();
    }
    
    async init() {
        if (this.initialized) return;
        
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(THUMBNAIL_IMAGE_DB_NAME, THUMBNAIL_IMAGE_VERSION);
            
            request.onerror = (event) => {
                console.error('Thumbnail image cache error:', event.target.error);
                this.initialized = true;
                reject(event.target.error);
            };
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                this.initialized = true;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(THUMBNAIL_IMAGE_STORE)) {
                    const store = db.createObjectStore(THUMBNAIL_IMAGE_STORE, { keyPath: 'url' });
                    store.createIndex('url', 'url', { unique: true });
                }
            };
        });
    }
    
    async get(url) {
        try {
            await this.initPromise;
        } catch {
            // If initialization failed, return null
            return null;
        }
        
        return new Promise((resolve) => {
            try {
                const transaction = this.db.transaction([THUMBNAIL_IMAGE_STORE], 'readonly');
                const store = transaction.objectStore(THUMBNAIL_IMAGE_STORE);
                const request = store.get(url);
                
                request.onsuccess = () => {
                    resolve(request.result ? request.result.data : null);
                };
                
                request.onerror = () => {
                    resolve(null);
                };
            } catch {
                resolve(null);
            }
        });
    }
    
    async set(url, data) {
        try {
            await this.initPromise;
        } catch {
            // If initialization failed, silently fail
            return;
        }
        
        return new Promise((resolve) => {
            try {
                const transaction = this.db.transaction([THUMBNAIL_IMAGE_STORE], 'readwrite');
                const store = transaction.objectStore(THUMBNAIL_IMAGE_STORE);
                
                const item = { url, data, timestamp: Date.now() };
                const request = store.put(item);
                
                request.onsuccess = () => resolve();
                request.onerror = () => resolve(); // Don't reject on errors
            } catch {
                resolve();
            }
        });
    }
    
    async delete(url) {
        await this.initPromise;
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction([THUMBNAIL_IMAGE_STORE], 'readwrite');
            const store = transaction.objectStore(THUMBNAIL_IMAGE_STORE);
            const request = store.delete(url);
            
            request.onsuccess = () => resolve();
            request.onerror = () => resolve(); // Don't fail on delete errors
        });
    }
    
    async clear() {
        await this.initPromise;
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction([THUMBNAIL_IMAGE_STORE], 'readwrite');
            const store = transaction.objectStore(THUMBNAIL_IMAGE_STORE);
            const request = store.clear();
            
            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
        });
    }
}

// Global thumbnail image cache instance
const thumbnailImageCache = new ThumbnailImageCache();

// ============================================
// IndexedDB Storage Manager
// ============================================
class IndexedDBStorage {
    constructor(dbName, storeName, version) {
        this.dbName = dbName;
        this.storeName = storeName;
        this.version = version;
        this.db = null;
        this.initialized = false;
        this.pendingOperations = [];
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            const self = this; // Capture this for use in callbacks

            request.onerror = (event) => {
                console.error('IndexedDB error:', event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                self.db = event.target.result;
                self.initialized = true;
                
                // Debug: Log available store names
                console.log('IndexedDB opened. Available stores:', Array.from(self.db.objectStoreNames));
                console.log('Expected store name:', self.storeName);
                
                // Process any pending operations
                self.pendingOperations.forEach(op => op());
                self.pendingOperations = [];
                
                resolve(self.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                console.log('Database upgrade needed. Existing stores:', Array.from(db.objectStoreNames));
                if (!db.objectStoreNames.contains(self.storeName)) {
                    console.log('Creating store:', self.storeName);
                    const store = db.createObjectStore(self.storeName, { keyPath: 'id' });
                    store.createIndex('url', 'url', { unique: false });
                    store.createIndex('title', 'title', { unique: false });
                    store.createIndex('tags', 'tags', { unique: false, multiEntry: true });
                    store.createIndex('addedDate', 'addedDate', { unique: false });
                    store.createIndex('publishDate', 'publishDate', { unique: false });
                    store.createIndex('source', 'source', { unique: false });
                }
                
                // Check for old "undefined" store (from bug in previous version)
                if (db.objectStoreNames.contains('undefined') && !db.objectStoreNames.contains(self.storeName)) {
                    console.log('Found old "undefined" store, will use fallback in getAll()');
                }
            };
        });
    }

    async getAll() {
        if (!this.initialized) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            let storeName = this.storeName;
            
            // Debug: Log what we're trying
            console.log('getAll() - Available stores:', Array.from(this.db.objectStoreNames));
            console.log('getAll() - Looking for store:', storeName);
            
            // Check if the store exists, if not try "undefined" store (from previous bug)
            if (!this.db.objectStoreNames.contains(storeName)) {
                if (this.db.objectStoreNames.contains('undefined')) {
                    storeName = 'undefined';
                    console.log('Using fallback store name: "undefined"');
                } else {
                    console.error('Store not found! Available:', Array.from(this.db.objectStoreNames));
                }
            }
            
            console.log('getAll() - Using store:', storeName);
            
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => {
                console.log('getAll() - Retrieved', request.result.length, 'videos');
                resolve(request.result);
            };
            request.onerror = (event) => {
                console.error('Error reading from store:', storeName, event.target.error);
                reject(event.target.error);
            };
        });
    }

    async getById(id) {
        if (!this.initialized) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            let storeName = this.storeName;
            if (!this.db.objectStoreNames.contains(storeName) && 
                this.db.objectStoreNames.contains('undefined')) {
                storeName = 'undefined';
            }
            
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async add(video) {
        if (!this.initialized) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            let storeName = this.storeName;
            if (!this.db.objectStoreNames.contains(storeName) && 
                this.db.objectStoreNames.contains('undefined')) {
                storeName = 'undefined';
            }
            
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.add(video);

            request.onsuccess = () => resolve(video);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async update(video) {
        if (!this.initialized) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            let storeName = this.storeName;
            if (!this.db.objectStoreNames.contains(storeName) && 
                this.db.objectStoreNames.contains('undefined')) {
                storeName = 'undefined';
            }
            
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(video);

            request.onsuccess = () => resolve(video);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async delete(id) {
        if (!this.initialized) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            let storeName = this.storeName;
            if (!this.db.objectStoreNames.contains(storeName) && 
                this.db.objectStoreNames.contains('undefined')) {
                storeName = 'undefined';
            }
            
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(id);

            request.onsuccess = () => resolve(true);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async clear() {
        if (!this.initialized) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            let storeName = this.storeName;
            if (!this.db.objectStoreNames.contains(storeName) && 
                this.db.objectStoreNames.contains('undefined')) {
                storeName = 'undefined';
            }
            
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve(true);
            request.onerror = (event) => {
                console.error('Clear error:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    async getAllTags() {
        const videos = await this.getAll();
        const tagCount = {};
        videos.forEach(video => {
            (video.tags || []).forEach(tag => {
                tagCount[tag] = (tagCount[tag] || 0) + 1;
            });
        });
        return tagCount;
    }
}

// ============================================
// Server API Client (for file-based persistence)
// ============================================
class ServerAPI {
    constructor() {
        this.baseUrl = window.location.protocol === 'file:' ? null : '';
    }

    async isAvailable() {
        // Check if server is running
        if (window.location.protocol === 'file:') return false;
        try {
            const response = await fetch('/api/ping', { cache: 'no-store' });
            return response.ok;
        } catch {
            return false;
        }
    }

    async syncToServer(videos) {
        if (window.location.protocol === 'file:') return false;
        try {
            const response = await fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videos })
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async loadFromServer() {
        if (window.location.protocol === 'file:') return null;
        try {
            const response = await fetch('/api/load', { cache: 'no-store' });
            if (response.ok) {
                return await response.json();
            }
            return null;
        } catch {
            return null;
        }
    }
}

// ============================================
// Video Database Model
// ============================================
class VideoDatabase {
    constructor() {
        this.videos = [];
        this.db = new IndexedDBStorage(DB_NAME, STORE_NAME, DB_VERSION);
        this.server = new ServerAPI();
        this.load();
    }

    async load() {
        try {
            console.log('VideoDatabase.load() - Starting load');
            
            // Try IndexedDB first
            this.videos = await this.db.getAll();
            console.log('VideoDatabase.load() - IndexedDB returned', this.videos.length, 'videos');
            
            // If IndexedDB is empty, try localStorage fallback
            if (this.videos.length === 0) {
                console.log('VideoDatabase.load() - IndexedDB empty, checking localStorage');
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved) {
                    console.log('VideoDatabase.load() - Found data in localStorage');
                    const parsed = JSON.parse(saved);
                    // Migrate from localStorage to IndexedDB
                    for (const video of parsed) {
                        await this.db.add({
                            id: video.id || this.generateId(),
                            url: video.url || '',
                            title: video.title || 'Untitled',
                            tags: Array.isArray(video.tags) ? video.tags : [],
                            notes: video.notes || '',
                            addedDate: video.addedDate || new Date().toISOString(),
                            publishDate: video.publishDate || null,
                            thumbnail: video.thumbnail || null,
                            favicon: video.favicon || null,
                            source: video.source || this.extractSource(video.url || '')
                        });
                    }
                    this.videos = parsed;
                    // Clear localStorage after migration
                    localStorage.removeItem(STORAGE_KEY);
                    console.log('VideoDatabase.load() - Migrated', parsed.length, 'videos from localStorage');
                } else {
                    console.log('VideoDatabase.load() - No data in localStorage');
                }
            }
            
            // Try to load from server if available
            const serverData = await this.server.loadFromServer();
            if (serverData && serverData.videos && serverData.videos.length > 0) {
                console.log('VideoDatabase.load() - Loading from server');
                // Merge server data (prefer server as source of truth)
                this.videos = serverData.videos;
                for (const video of this.videos) {
                    await this.db.add(video);
                }
            }
            
            console.log('VideoDatabase.load() - Final videos count:', this.videos.length);
            return this.videos;
        } catch (e) {
            console.error('Error loading data:', e);
            // Fallback: try localStorage
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                try {
                    this.videos = JSON.parse(saved);
                } catch {
                    this.videos = [];
                }
            } else {
                this.videos = [];
            }
        }
    }

    async save() {
        // Clear and re-add all to IndexedDB
        await this.db.clear();
        for (const video of this.videos) {
            await this.db.add(video);
        }
        
        // Also save to localStorage as fallback
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.videos));
        
        // Sync to server if available
        await this.server.syncToServer(this.videos);
    }

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    extractSource(url) {
        try {
            const domain = new URL(url).hostname;
            if (domain.includes('youtube.com') || domain.includes('youtu.be')) return 'youtube';
            if (domain.includes('vimeo.com')) return 'vimeo';
            if (domain.includes('rumble.com')) return 'rumble';
            if (domain.includes('odysee.com')) return 'odysee';
            if (domain.includes('reedtv.com')) return 'reedtv';
            if (domain.includes('yandex.ru') || domain.includes('yandex.com') || domain.includes('yadi.sk')) return 'yandex';
            if (domain.includes('mediadelivery.net') || domain.includes('b-cdn.net')) return 'bunny';
            return 'other';
        } catch {
            return 'unknown';
        }
    }

    // CRUD Operations (async to support IndexedDB)
    async add(video) {
        // Check for duplicate URL
        const existing = this.getByUrl(video.url);
        if (existing) {
            throw new Error(`Duplicate video: A video with this URL already exists (${existing.title})`);
        }
        
        const newVideo = {
            id: this.generateId(),
            url: video.url,
            title: video.title,
            tags: Array.isArray(video.tags) ? video.tags : [video.tags].filter(Boolean),
            notes: video.notes || '',
            addedDate: new Date().toISOString(),
            publishDate: video.publishDate || null,
            thumbnail: video.thumbnail || null,
            favicon: video.favicon || null,
            source: video.source || this.extractSource(video.url)
        };
        this.videos.push(newVideo);
        await this.save();
        return newVideo;
    }

    async update(id, updates) {
        const index = this.videos.findIndex(v => v.id === id);
        if (index !== -1) {
            this.videos[index] = { ...this.videos[index], ...updates };
            await this.save();
            return this.videos[index];
        }
        return null;
    }

    async delete(id) {
        this.videos = this.videos.filter(v => v.id !== id);
        await this.save();
    }

    getAll() {
        return [...this.videos];
    }

    getById(id) {
        return this.videos.find(v => v.id === id);
    }

    getByUrl(url) {
        if (!url) return null;
        return this.videos.find(v => v.url === url);
    }

    // Utility methods
    getAllTags() {
        const tagCount = {};
        this.videos.forEach(video => {
            (video.tags || []).forEach(tag => {
                tagCount[tag] = (tagCount[tag] || 0) + 1;
            });
        });
        return tagCount;
    }

    search(query, filters = {}) {
        let results = this.videos;

        // Text search
        if (query) {
            const q = query.toLowerCase();
            results = results.filter(v => 
                v.title.toLowerCase().includes(q) ||
                v.notes.toLowerCase().includes(q) ||
                v.url.toLowerCase().includes(q) ||
                v.tags.some(t => t.toLowerCase().includes(q))
            );
        }

        // Tag filter
        if (filters.tags && filters.tags.length > 0) {
            results = results.filter(v => 
                filters.tags.some(tag => v.tags.includes(tag))
            );
        }

        // Date added filter
        if (filters.dateAdded) {
            const now = new Date();
            const addedDates = results.map(v => new Date(v.addedDate));

            switch (filters.dateAdded) {
                case 'today':
                    results = results.filter((_, i) => 
                        addedDates[i].toDateString() === now.toDateString()
                    );
                    break;
                case 'week':
                    results = results.filter((_, i) => 
                        addedDates[i] >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
                    );
                    break;
                case 'month':
                    results = results.filter((_, i) => 
                        addedDates[i] >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
                    );
                    break;
                case '3months':
                    results = results.filter((_, i) => 
                        addedDates[i] >= new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
                    );
                    break;
                case 'year':
                    results = results.filter((_, i) => 
                        addedDates[i] >= new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
                    );
                    break;
            }
        }

        // Publish date sort
        if (filters.publishDate) {
            results.sort((a, b) => {
                const aDate = a.publishDate ? new Date(a.publishDate).getTime() : 0;
                const bDate = b.publishDate ? new Date(b.publishDate).getTime() : 0;
                if (filters.publishDate === 'recent') {
                    return bDate - aDate;
                } else {
                    return aDate - bDate;
                }
            });
        }

        // Default sort: most recently added first
        results.sort((a, b) => new Date(b.addedDate) - new Date(a.addedDate));

        return results;
    }

    export() {
        return JSON.stringify(this.videos, null, 2);
    }

    async import(data) {
        try {
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) {
                this.videos = parsed.map(video => ({
                    id: video.id || this.generateId(),
                    url: video.url || '',
                    title: video.title || 'Untitled',
                    tags: Array.isArray(video.tags) ? video.tags : [],
                    notes: video.notes || '',
                    addedDate: video.addedDate || new Date().toISOString(),
                    publishDate: video.publishDate || null,
                    thumbnail: video.thumbnail || null,
                    favicon: video.favicon || null,
                    source: video.source || this.extractSource(video.url || '')
                }));
                await this.save();
                return true;
            }
        } catch (e) {
            console.error('Import error:', e);
        }
        return false;
    }
}

// ============================================
// Thumbnail & Metadata Fetchers
// ============================================
const MetadataFetcher = {
    // Extract video ID from YouTube URLs
    getYouTubeId(url) {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    },

    // Get YouTube thumbnail URL
    getYouTubeThumbnail(videoId, quality = 'mq') {
        const qualities = {
            hq: 'maxresdefault.jpg',
            mq: 'mqdefault.jpg',
            sd: 'sddefault.jpg',
            hq720: 'hq720.jpg',
            hqdefault: 'hqdefault.jpg'
        };
        return `https://img.youtube.com/vi/${videoId}/${qualities[quality] || qualities.mq}`;
    },

    // Get Vimeo thumbnail URL
    async getVimeoThumbnail(url) {
        try {
            // Extract video ID, removing any query parameters or hash
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            const videoId = pathParts[pathParts.length - 1].split('?')[0].split('#')[0];
            
            console.log('getVimeoThumbnail: trying API for videoId:', videoId);
            const response = await fetch(`https://vimeo.com/api/v2/video/${videoId}.json`, {
                cache: 'no-store'
            });
            const data = await response.json();
            if (data[0]?.thumbnail_large) {
                console.log('getVimeoThumbnail: using thumbnail_large');
                return data[0].thumbnail_large;
            }
            if (data[0]?.thumbnail_medium) {
                console.log('getVimeoThumbnail: using thumbnail_medium');
                return data[0].thumbnail_medium;
            }
        } catch (e) {
            console.log('getVimeoThumbnail: API failed, using fallback', e.message);
            // Fall through to fallback
        }
        // Fallback: try standard Vimeo thumbnail URL patterns
        try {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            let videoId = pathParts[pathParts.length - 1].split('?')[0].split('#')[0];
            
            // If the video ID contains a hash (private video), use the CDN URL
            // Vimeo CDN will serve appropriate thumbnail automatically
            // Pattern: https://i.vimeocdn.com/video/{videoId}?mw=1500&mh=844&q=70
            // Using query parameters for consistent sizing
            const cdnUrl = `https://i.vimeocdn.com/video/${videoId}?mw=640&mh=360&q=80`;
            console.log('getVimeoThumbnail: fallback CDN URL:', cdnUrl);
            return cdnUrl;
        } catch {
            console.log('getVimeoThumbnail: fallback failed, returning null');
            return null;
        }
    },

    // Get favicon from URL
    getFaviconUrl(url) {
        try {
            const domain = new URL(url).hostname;
            return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
        } catch {
            return null;
        }
    },

    // Get YouTube video info (title, publish date)
    async getYouTubeInfo(videoId) {
        try {
            // Use YouTube oEmbed API
            const response = await fetch(
                `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
                { cache: 'no-store' }
            );
            const data = await response.json();
            return {
                title: data.title || null,
                publishDate: null // oEmbed doesn't provide publish date
            };
        } catch {
            return { title: null, publishDate: null };
        }
    },

    // Get Vimeo video info
    async getVimeoInfo(url) {
        try {
            const videoId = url.split('/').pop();
            const response = await fetch(`https://vimeo.com/api/v2/video/${videoId}.json`, {
                cache: 'no-store'
            });
            const data = await response.json();
            return {
                title: data[0]?.title || null,
                publishDate: data[0]?.upload_date || null
            };
        } catch {
            return { title: null, publishDate: null };
        }
    },

    // Main method to fetch all metadata
    async fetchMetadata(url) {
        const result = {
            thumbnail: null,
            title: null,
            publishDate: null,
            favicon: this.getFaviconUrl(url),
            source: this.extractSource(url)
        };

        try {
            const domain = new URL(url).hostname;

            // YouTube
            if (domain.includes('youtube.com') || domain.includes('youtu.be')) {
                const videoId = this.getYouTubeId(url);
                if (videoId) {
                    result.thumbnail = this.getYouTubeThumbnail(videoId, 'hq');
                    const info = await this.getYouTubeInfo(videoId);
                    result.title = info.title;
                    // Try to get publish date from YouTube Data API if available
                    // For now, we'll use the added date as fallback
                }
            }
            // Vimeo
            else if (domain.includes('vimeo.com')) {
                result.thumbnail = await this.getVimeoThumbnail(url);
                const info = await this.getVimeoInfo(url);
                result.title = info.title;
                result.publishDate = info.publishDate;
            }
            // ReedTV
            else if (domain.includes('reedtv.com')) {
                result.thumbnail = this.getReedTvThumbnail(url);
                const info = await this.getReedTvInfo(url);
                result.title = info.title || 'ReedTV Video';
                result.publishDate = info.publishDate;
            }
            // Bunny Stream / mediadelivery.net
            else if (domain.includes('mediadelivery.net') || domain.includes('b-cdn.net')) {
                // Try to normalize the URL first
                const normalizedUrl = this.normalizeBunnyUrl(url);
                
                // Try the original URL first, then normalized if different
                let info = await this.getBunnyInfo(url);
                if (!info.thumbnail && normalizedUrl !== url) {
                    info = await this.getBunnyInfo(normalizedUrl);
                }
                
                result.title = info.title || 'Bunny Stream Video';
                result.thumbnail = info.thumbnail || null;
                result.publishDate = info.publishDate;
            }
            // Generic fallback - try to construct thumbnail URL
            else {
                try {
                    const urlObj = new URL(url);
                    const videoId = urlObj.searchParams.get('v') || 
                                   urlObj.pathname.split('/').pop() || 
                                   urlObj.pathname.split('/').slice(-2)[0];
                    
                    // Try common thumbnail patterns
                    const thumbnailPatterns = [
                        `${urlObj.origin}/thumb/${videoId}.jpg`,
                        `${urlObj.origin}/thumbnail/${videoId}.jpg`,
                        `${urlObj.origin}/thumbs/${videoId}.jpg`,
                        `${urlObj.origin}/images/${videoId}.jpg`,
                        `${urlObj.origin}/static/thumbs/${videoId}.jpg`
                    ];
                    
                    // Use the first pattern as a guess
                    result.thumbnail = thumbnailPatterns[0];
                    
                    // Try to fetch OpenGraph data via proxy if running on a server
                    // This allows CORS-free fetching of metadata
                    try {
                        // Check if we're running on a local server (not file://)
                        if (window.location.protocol !== 'file:') {
                            const proxyUrl = `/proxy?url=${encodeURIComponent(url)}`;
                            const proxyResponse = await fetch(proxyUrl, {
                                cache: 'no-store'
                            });
                            const proxyData = await proxyResponse.json();
                            
                            if (proxyData.title) {
                                result.title = proxyData.title;
                            }
                            if (proxyData.thumbnail) {
                                result.thumbnail = proxyData.thumbnail;
                            }
                            if (proxyData.publish_date) {
                                result.publishDate = proxyData.publish_date;
                            }
                            if (proxyData.favicon) {
                                result.favicon = proxyData.favicon;
                            }
                        }
                    } catch (proxyError) {
                        // Proxy not available, fall back to constructed URLs
                        console.log('Proxy not available, using fallback thumbnail patterns');
                    }
                    
                } catch {}
            }

            return result;
        } catch (e) {
            console.error('Error fetching metadata:', e);
            return result;
        }
    },

    extractSource(url) {
        try {
            const domain = new URL(url).hostname;
            if (domain.includes('youtube.com') || domain.includes('youtu.be')) return 'youtube';
            if (domain.includes('vimeo.com')) return 'vimeo';
            if (domain.includes('rumble.com')) return 'rumble';
            if (domain.includes('odysee.com')) return 'odysee';
            if (domain.includes('dailymotion.com')) return 'dailymotion';
            if (domain.includes('reed.tv') || domain.includes('reedtv.com')) return 'reedtv';
            if (domain.includes('yandex.ru') || domain.includes('yandex.com') || domain.includes('yadi.sk')) return 'yandex';
            if (domain.includes('iframe.mediadelivery.net') || domain.includes('player.mediadelivery.net')) return 'mediadelivery';
            if (domain.includes('mediadelivery.net') || domain.includes('b-cdn.net')) return 'bunny';
            if (domain.includes('vids.io') || domain.includes('vidio.io')) return 'vidsio';
            return 'other';
        } catch {
            return 'unknown';
        }
    },

    // Extract video ID from reedtv.com URLs
    getReedTvId(url) {
        try {
            const urlObj = new URL(url);
            // reedtv.com/watch?v=VIDEO_ID
            const videoId = urlObj.searchParams.get('v');
            if (videoId) return videoId;
            // reedtv.com/v/VIDEO_ID
            const pathParts = urlObj.pathname.split('/');
            return pathParts.find(p => p && p !== 'watch' && p !== 'v') || null;
        } catch {
            return null;
        }
    },

    // Get reedtv.com thumbnail URL
    getReedTvThumbnail(url) {
        const videoId = this.getReedTvId(url);
        if (!videoId) return null;
        
        // Try common reedtv.com thumbnail patterns
        // Pattern 1: /thumbs/{video_id}.jpg
        // Pattern 2: /thumbnail/{video_id}.jpg
        // Pattern 3: /images/{video_id}.jpg
        
        // Based on the URL structure, reedtv might use:
        // https://reedtv.com/thumb/{video_id}.jpg
        const patterns = [
            `https://reedtv.com/thumb/${videoId}.jpg`,
            `https://reedtv.com/thumbnail/${videoId}.jpg`,
            `https://reedtv.com/thumbs/${videoId}.jpg`,
            `https://reedtv.com/images/${videoId}.jpg`,
            `https://reedtv.com/static/thumbs/${videoId}.jpg`
        ];
        
        // For now, use the first pattern
        // In a real app, you might need to try these or use a proxy
        return patterns[0];
    },

    // Get reedtv.com video info
    async getReedTvInfo(url) {
        try {
            const videoId = this.getReedTvId(url);
            if (!videoId) return { title: null, publishDate: null };
            
            // reedtv.com doesn't have a public API that we know of
            // We could try to scrape the page, but CORS prevents this from static pages
            // For now, we'll try to fetch the page via a CORS proxy
            
            return {
                title: null,
                publishDate: null
            };
        } catch {
            return { title: null, publishDate: null };
        }
    },

    // Normalize Bunny Stream URL to full format
    // Also handles reed.tv URLs by converting them to videodelivery.net
    normalizeBunnyUrl(url) {
        try {
            // Handle reed.tv URLs: convert to videodelivery.net iframe URL
            if (url.includes('reed.tv') || url.includes('reedtv.com')) {
                // Extract video ID from reed.tv URL
                // Pattern: https://reedtv.com/watch?v=VIDEO_ID
                const urlObj = new URL(url);
                const videoId = urlObj.searchParams.get('v') || urlObj.pathname.split('/').pop();
                if (videoId) {
                    return `https://iframe.videodelivery.net/${videoId}`;
                }
                return url;
            }
            
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            
            // If URL is already in format: /play/CHANNEL/VIDEO_ID
            if (pathParts[0] === 'play' && pathParts.length >= 2) {
                return url;
            }
            
            // If URL is in format: /VIDEO_ID (short format)
            if (pathParts.length === 1) {
                // Try to use a common channel ID, or just return as-is
                // For now, we'll try with a placeholder and let the proxy handle it
                // Alternatively, try to fetch the video ID directly
                const videoId = pathParts[0];
                // Try common channel IDs or return the original
                // Some common Bunny Stream patterns:
                // /play/{channel}/{videoId}
                // For now, we'll try to fetch metadata with the original URL
                // and if that fails, we'll try alternative patterns
                return url;
            }
            
            return url;
        } catch {
            return url;
        }
    },

    // Extract video ID from Bunny Stream URLs
    getBunnyId(url) {
        try {
            const parts = url.split('/');
            return parts[parts.length - 1]; // Last part is the video ID
        } catch {
            return null;
        }
    },

    // Get Bunny Stream thumbnail URL
    async getBunnyThumbnail(url) {
        try {
            const info = await this.getBunnyInfo(url);
            return info.thumbnail;
        } catch {
            return null;
        }
    },

    // Get Bunny Stream video info (uses proxy to fetch OpenGraph)
    async getBunnyInfo(url) {
        // Bunny Stream pages have OpenGraph tags, so use proxy
        try {
            if (window.location.protocol !== 'file:') {
                const proxyUrl = `/proxy?url=${encodeURIComponent(url)}`;
                const proxyResponse = await fetch(proxyUrl, { cache: 'no-store' });
                const proxyData = await proxyResponse.json();
                
                // If we got metadata from proxy, use it
                if (proxyData.title || proxyData.thumbnail) {
                    return {
                        title: proxyData.title || null,
                        thumbnail: proxyData.thumbnail || null,
                        publishDate: proxyData.publish_date || null
                    };
                }
                
                // If proxy didn't find metadata, try to construct thumbnail directly
                // Bunny Stream thumbnails follow pattern: https://vz-{hash}.b-cdn.net/{videoId}/thumbnail.jpg
                const videoId = this.getBunnyId(url);
                if (videoId) {
                    // Use the most common CDN host from user's data
                    return {
                        title: 'Bunny Stream Video',
                        thumbnail: `https://vz-29a69fda-a46.b-cdn.net/${videoId}/thumbnail.jpg`,
                        publishDate: null
                    };
                }
            }
            return { title: null, thumbnail: null, publishDate: null };
        } catch {
            return { title: null, thumbnail: null, publishDate: null };
        }
    },

    // ============================================
    // Patreon Integration
    // ============================================

    // Extract post links from Patreon posts page
    extractPostLinks(html) {
        const links = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Find all links that look like post URLs
        const anchors = doc.querySelectorAll('a[href*="/posts/"]');
        for (const anchor of anchors) {
            const href = anchor.getAttribute('href');
            if (href && !href.includes('javascript:') && !href.includes('#')) {
                const fullUrl = href.startsWith('http') ? href : `https://www.patreon.com${href}`;
                if (!links.includes(fullUrl)) {
                    links.push(fullUrl);
                }
            }
        }

        return links;
    },

    // Extract Bunny Stream (mediadelivery.net) URLs from HTML
    extractMediadeliveryUrls(html) {
        const urls = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Find iframes with mediadelivery.net or videodelivery.net
        const iframes = doc.querySelectorAll('iframe[src*="mediadelivery.net"], iframe[src*="videodelivery.net"]');
        for (const iframe of iframes) {
            const src = iframe.getAttribute('src');
            if (src) {
                urls.push(src);
            }
        }

        // Also check for reed.tv and other video platform links in the HTML
        const links = doc.querySelectorAll('a[href*="reed.tv"], a[href*="reedtv.com"]');
        for (const link of links) {
            const href = link.getAttribute('href');
            if (href && !urls.includes(href)) {
                urls.push(href);
            }
        }

        // Also check for video URLs in JSON-LD data
        const videoObjects = this.extractJsonLdVideos(html);
        for (const video of videoObjects) {
            if (video.url && (video.url.includes('mediadelivery.net') || video.url.includes('videodelivery.net'))) {
                urls.push(video.url);
            }
            if (video.embedUrl && (video.embedUrl.includes('mediadelivery.net') || video.embedUrl.includes('videodelivery.net'))) {
                urls.push(video.embedUrl);
            }
        }

        // Also check script tags for reed.tv or videodelivery.net URLs
        const scripts = doc.querySelectorAll('script');
        for (const script of scripts) {
            const text = script.textContent;
            // Extract URLs from script content
            const urlRegex = /https:\/\/[^\s"'<>{}\|\^`\\]*/g;
            const foundUrls = text.match(urlRegex) || [];
            for (const url of foundUrls) {
                if ((url.includes('reed.tv') || url.includes('reedtv.com') || 
                     url.includes('videodelivery.net') || url.includes('mediadelivery.net')) &&
                    !urls.includes(url)) {
                    urls.push(url);
                }
            }
        }

        return urls;
    },

    // Extract video from JSON-LD metadata
    extractJsonLdVideos(html) {
        const videos = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const scriptTags = doc.querySelectorAll('script[type="application/ld+json"]');
        for (const script of scriptTags) {
            try {
                const json = JSON.parse(script.textContent);
                if (json['@type'] === 'VideoObject' || json['@type'] === 'Video') {
                    videos.push(json);
                }
                if (json['@graph']) {
                    for (const item of json['@graph']) {
                        if (item['@type'] === 'VideoObject' || item['@type'] === 'Video') {
                            videos.push(item);
                        }
                    }
                }
            } catch (e) {
                // Invalid JSON, skip
            }
        }

        return videos;
    },

    // Extract post title from Patreon post HTML
    extractPostTitle(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Try different selectors for the title
        let title = doc.querySelector('h1')?.textContent?.trim();
        if (!title) {
            title = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
        }
        if (!title) {
            title = doc.querySelector('title')?.textContent?.trim();
        }

        return title || null;
    },

    // Extract post date from Patreon post HTML
    extractPostDate(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Try different date selectors
        let date = doc.querySelector('time')?.getAttribute('datetime');
        if (!date) {
            date = doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content');
        }
        if (!date) {
            date = doc.querySelector('meta[itemprop="datePublished"]')?.getAttribute('content');
        }

        return date || null;
    },

    // Normalize Bunny Stream URL from embed to play format
    normalizeBunnyUrl(url) {
        try {
            const urlObj = new URL(url);
            let path = urlObj.pathname.replace('/embed/', '/play/');
            path = path.split('?')[0];
            return `${urlObj.protocol}//${urlObj.host}${path}`;
        } catch {
            return url;
        }
    },

    // Fetch a URL with Patreon session cookie via proxy
    async fetchWithPatreonSession(url, sessionId) {
        try {
            const proxyUrl = `/raw-proxy?url=${encodeURIComponent(url)}`;
            const response = await fetch(proxyUrl, {
                cache: 'no-store',
                headers: {
                    'X-Patreon-Session': sessionId
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.text();
        } catch (e) {
            console.error('Fetch error:', e);
            return null;
        }
    },

    // Fetch iframe URLs from a single Patreon post
    async fetchPatreonPostIframe(postUrl, sessionId) {
        const apiUrl = `/api/patreon-post-iframe?url=${encodeURIComponent(postUrl)}`;
        const response = await fetch(apiUrl, {
            cache: 'no-store',
            headers: {
                'X-Patreon-Session': sessionId
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to fetch iframe');
        }

        return data;
    },

    // Extract post title from URL
    extractPostTitleFromUrl(url) {
        try {
            const urlObj = new URL(url);
            const path = urlObj.pathname;
            // Extract the title part from URLs like /AnnaCrystall/posts/title-12345
            const match = path.match(/\/posts\/([^\/]+)-(\d+)/);
            if (match) {
                return match[1].replace(/-/g, ' ');
            }
            return 'Patreon Video';
        } catch (e) {
            return 'Patreon Video';
        }
    },

    // Extract campaign ID from Patreon profile HTML
    extractCampaignId(html) {
        try {
            // Look for campaign ID in API URLs within the HTML
            const campaignMatch = html.match(/campaigns\/(\d+)/);
            if (campaignMatch) {
                return campaignMatch[1];
            }
            
            // Alternative: look for data-campaign-id attribute
            const dataMatch = html.match(/data-campaign[_-]?id["\s:=]+(\d+)/i);
            if (dataMatch) {
                return dataMatch[1];
            }
            
            return null;
        } catch (e) {
            console.error('Error extracting campaign ID:', e);
            return null;
        }
    },

    // Fetch Patreon posts using the API
    async fetchPatreonPostsApi(sessionId, campaignId, maxPosts = 20) {
        try {
            const apiUrl = `https://www.patreon.com/api/campaigns/${campaignId}/posts?fields%5Bpost%5D=title,url,app_url,created&include=user`;
            const html = await this.fetchWithPatreonSession(apiUrl, sessionId);
            
            if (!html) {
                return [];
            }
            
            // Parse the JSON response
            const data = JSON.parse(html);
            const postLinks = [];
            
            if (data && data.data && Array.isArray(data.data)) {
                // Extract post URLs from the API response
                const posts = data.data.filter(item => item.type === 'post');
                posts.slice(0, maxPosts).forEach(post => {
                    if (post.attributes && post.attributes.url) {
                        postLinks.push(post.attributes.url);
                    }
                });
            }
            
            return postLinks;
        } catch (e) {
            console.error('Error fetching Patreon posts via API:', e);
            return [];
        }
    },

    // Main function to fetch Patreon posts and extract video URLs
    async fetchPatreonVideos(sessionId, creatorName, maxPosts = 20) {
        const videos = [];
        const errors = [];

        try {
            // First, get the campaign ID from the creator's profile
            const profileUrl = `https://www.patreon.com/${creatorName}`;
            const profileHtml = await this.fetchWithPatreonSession(profileUrl, sessionId);

            if (!profileHtml) {
                throw new Error('Could not fetch Patreon profile - check your session ID');
            }

            // Extract campaign ID from profile page
            const campaignId = this.extractCampaignId(profileHtml);

            let postLinks = [];
            if (campaignId) {
                // Use Patreon API to get post list
                postLinks = await this.fetchPatreonPostsApi(sessionId, campaignId, maxPosts);
            } else {
                // Fallback: try the old method of extracting from posts page HTML
                const postsUrl = `https://www.patreon.com/${creatorName}/posts`;
                const postsHtml = await this.fetchWithPatreonSession(postsUrl, sessionId);
                if (postsHtml) {
                    postLinks = this.extractPostLinks(postsHtml);
                }
            }

            // Limit the number of posts to fetch
            const limitedPosts = postLinks.slice(0, maxPosts);

            // Fetch each post and extract video URLs
            for (const postLink of limitedPosts) {
                try {
                    // Use the server API to extract iframe URLs from the post
                    const postData = await this.fetchPatreonPostIframe(postLink, sessionId);
                    
                    if (postData && postData.iframes && postData.iframes.length > 0) {
                        const postTitle = postData.title || this.extractPostTitleFromUrl(postLink);
                        const postDate = null; // Not available from iframe endpoint

                        for (let i = 0; i < postData.iframes.length; i++) {
                            const videoUrl = postData.iframes[i];
                            const thumbnailUrl = postData.thumbnails && postData.thumbnails[i] ? postData.thumbnails[i] : null;
                            const normalizedUrl = this.normalizeBunnyUrl(videoUrl);
                            videos.push({
                                url: normalizedUrl,
                                title: postTitle || 'Patreon Video',
                                source: this.extractSource(normalizedUrl),
                                extractedFrom: postLink,
                                postDate: postDate,
                                thumbnail: thumbnailUrl
                            });
                        }
                    }
                } catch (e) {
                    errors.push({ url: postLink, error: e.message });
                }
            }

            return { videos, errors };
        } catch (e) {
            return { videos: [], errors: [{ error: e.message }] };
        }
    }
};

// ============================================
// Application State
// ============================================
let state = {
    db: null,
    filteredVideos: [],
    activeFilters: {
        search: '',
        tags: [],
        dateAdded: 'all',
        publishDate: 'all'
    },
    currentView: 'grid',
    selectedVideo: null,
    initialized: false,
    editingVideoId: null
};

// Initialize the database asynchronously
async function initState() {
    state.db = new VideoDatabase();
    await state.db.load();
    state.filteredVideos = state.db.getAll();
    state.initialized = true;
}

// ============================================
// DOM Elements
// ============================================
const elements = {
    addModal: document.getElementById('addModal'),
    closeModal: document.getElementById('closeModal'),
    cancelAdd: document.getElementById('cancelAdd'),
    addVideoBtn: document.getElementById('addVideoBtn'),
    addVideoForm: document.getElementById('addVideoForm'),
    videoUrl: document.getElementById('videoUrl'),
    videoTitle: document.getElementById('videoTitle'),
    videoTags: document.getElementById('videoTags'),
    videoNotes: document.getElementById('videoNotes'),
    fetchMetadata: document.getElementById('fetchMetadata'),
    searchInput: document.getElementById('searchInput'),
    dateFilter: document.getElementById('dateFilter'),
    publishDateFilter: document.getElementById('publishDateFilter'),
    allTags: document.getElementById('allTags'),
    videoGrid: document.getElementById('videoGrid'),
    totalVideos: document.getElementById('totalVideos'),
    totalTags: document.getElementById('totalTags'),
    loading: document.getElementById('loading'),
    clearFilters: document.getElementById('clearFilters'),
    importBtn: document.getElementById('importBtn'),
    exportBtn: document.getElementById('exportBtn'),
    patreonImportBtn: document.getElementById('patreonImportBtn'),
    patreonModal: document.getElementById('patreonModal'),
    patreonSessionId: document.getElementById('patreonSessionId'),
    patreonCreator: document.getElementById('patreonCreator'),
    patreonMaxPosts: document.getElementById('patreonMaxPosts'),
    patreonPostUrl: document.getElementById('patreonPostUrl'),
    patreonModeSingle: document.getElementById('modeSingle'),
    patreonModeMultiple: document.getElementById('modeMultiple'),
    singlePostFields: document.getElementById('singlePostFields'),
    multiplePostsFields: document.getElementById('multiplePostsFields'),
    closePatreonModal: document.getElementById('closePatreonModal'),
    cancelPatreon: document.getElementById('cancelPatreon'),
    fetchPatreonContent: document.getElementById('fetchPatreonContent'),
    patreonResults: document.getElementById('patreonResults'),
    viewBtns: document.querySelectorAll('.view-btn')
};

// ============================================
// Utility Functions
// ============================================
function proxyThumbnailUrl(url, sessionId = null) {
    // Check URL cache first (maps original URL to proxied URL)
    const cachedUrl = getCachedThumbnail(url);
    if (cachedUrl) {
        return cachedUrl;
    }
    
    try {
        const urlObj = new URL(url);
        
        // For Patreon thumbnails, always use thumb proxy (they require authentication)
        if (urlObj.hostname.includes('patreonusercontent.com')) {
            const proxied = `/thumb?url=${encodeURIComponent(url)}`;
            cacheThumbnail(url, proxied);
            return proxied;
        }
        
        // List of domains that might have CORS issues with thumbnails
        const corsDomains = [
            'vz-', // Bunny CDN
            'b-cdn.net',
            'mediadelivery.net',
            'player.mediadelivery.net',
            'videodelivery.net',
            'iframe.videodelivery.net',
            'vids.io',
            'reedtv.com',
            'i.vimeocdn.com' // Vimeo CDN - proxy for consistent caching
        ];
        
        if (corsDomains.some(d => urlObj.hostname.includes(d))) {
            // Proxy through thumb endpoint (adds CORS headers and caching)
            const proxied = `/thumb?url=${encodeURIComponent(url)}`;
            cacheThumbnail(url, proxied);
            return proxied;
        }
        
        // Cache non-proxied URLs too
        cacheThumbnail(url, url);
        return url;
    } catch {
        return url;
    }
}

// Helper to encode video data for HTML onclick attributes
// Uses unescape(encodeURIComponent(JSON.stringify())) to handle Unicode
// This is the standard way to make btoa work with Unicode in browsers
function encodeVideoDataForHtml(videoData) {
    try {
        const jsonStr = JSON.stringify(videoData);
        // Browser-safe Base64 encoding for Unicode strings
        return btoa(unescape(encodeURIComponent(jsonStr)));
    } catch {
        // Fallback: try without Unicode conversion
        try {
            return btoa(JSON.stringify(videoData));
        } catch {
            // Last fallback: minimal data
            return btoa(JSON.stringify({ 
                url: videoData.url || '', 
                title: videoData.title || 'Untitled' 
            }));
        }
    }
}

// Enhanced version that also caches the actual image data
async function getCachedThumbnailData(url) {
    try {
        // First check if we have it in IndexedDB
        const cachedData = await thumbnailImageCache.get(url).catch(() => null);
        if (cachedData) {
            return `data:${getMimeType(url)};base64,${cachedData}`;
        }
        return null;
    } catch {
        return null;
    }
}

// Store image data in IndexedDB
async function cacheThumbnailData(url, blob) {
    try {
        const reader = new FileReader();
        const promise = new Promise((resolve) => {
            reader.onload = () => {
                const base64 = reader.result.split(',')[1];
                thumbnailImageCache.set(url, base64).then(resolve).catch(resolve);
            };
            reader.onerror = () => resolve();
            reader.readAsDataURL(blob);
        });
        await promise;
    } catch {
        // Silent fail
    }
}

function getMimeType(url) {
    if (url.includes('.jpg') || url.includes('.jpeg')) return 'image/jpeg';
    if (url.includes('.png')) return 'image/png';
    if (url.includes('.gif')) return 'image/gif';
    if (url.includes('.webp')) return 'image/webp';
    return 'image/jpeg';
}

// Fetch and cache a thumbnail image
async function fetchAndCacheThumbnail(url) {
    try {
        // First check if we have it cached
        const cached = await getCachedThumbnailData(url);
        if (cached) {
            return cached;
        }
        
        // Fetch the image
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
            return null;
        }
        
        const blob = await response.blob();
        
        // Cache it (won't block)
        cacheThumbnailData(url, blob).catch(() => {});
        
        // Return as data URL
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}

function showLoading() {
    elements.loading.style.display = 'block';
}

function hideLoading() {
    elements.loading.style.display = 'none';
}

function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

function formatDate(dateString) {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatDateShort(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getSourceIcon(source) {
    const icons = {
        youtube: 'fab fa-youtube',
        vimeo: 'fab fa-vimeo-v',
        rumble: 'fas fa-film',
        odysee: 'fas fa-play-circle',
        dailymotion: 'fas fa-play-circle',
        reedtv: 'fas fa-scissors',
        bunny: 'fas fa-rabbit',
        other: 'fas fa-video',
        unknown: 'fas fa-question-circle'
    };
    return icons[source] || icons.other;
}

function getSourceColor(source) {
    const colors = {
        youtube: '#ff0000',
        vimeo: '#1ab7ea',
        rumble: '#333333',
        odysee: '#ff007a',
        dailymotion: '#00aaff',
        reedtv: '#00ff88',
        bunny: '#ff6b35'
    };
    return colors[source] || '#6c5ce7';
}

// ============================================
// Render Functions
// ============================================
function renderTagCloud() {
    const tagCount = state.db.getAllTags();
    const tags = Object.entries(tagCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    
    elements.allTags.innerHTML = tags.map(([tag, count]) => `
        <span class="tag-filter ${state.activeFilters.tags.includes(tag) ? 'active' : ''}" data-tag="${tag}">
            ${escapeHtml(tag)}
            <span class="count">${count}</span>
        </span>
    `).join('');
    
    // Update total tags count
    elements.totalTags.textContent = tags.length;
    
    // Add click handlers
    document.querySelectorAll('.tag-filter').forEach(tagEl => {
        tagEl.addEventListener('click', async () => {
            const tag = tagEl.dataset.tag;
            const currentTags = state.activeFilters.tags;
            
            if (currentTags.includes(tag)) {
                state.activeFilters.tags = currentTags.filter(t => t !== tag);
            } else {
                state.activeFilters.tags = [...currentTags, tag];
            }
            
            tagEl.classList.toggle('active');
            applyFilters();
        });
    });
}

function renderVideoCard(video, viewMode = 'grid') {
    const sourceIcon = getSourceIcon(video.source);
    const sourceColor = getSourceColor(video.source);
    const addedDate = formatDateShort(video.addedDate);
    const publishDate = video.publishDate ? formatDate(video.publishDate) : '';
    
    // Proxy thumbnail URL if needed for CORS
    const savedSession = localStorage.getItem(PATREON_SESSION_KEY);
    const thumbnailUrl = video.thumbnail ? proxyThumbnailUrl(video.thumbnail, savedSession) : null;
    
    if (viewMode === 'list') {
        return `
            <div class="video-card" data-id="${video.id}">
                <div class="video-thumbnail">
                    ${thumbnailUrl ? `<img src="${escapeHtml(thumbnailUrl)}" alt="${escapeHtml(video.title)}" loading="lazy">` : '<div class="thumbnail-placeholder"><i class="fas fa-image"></i></div>'}
                    ${video.favicon ? `<div class="video-favicon"><img src="${escapeHtml(video.favicon)}" alt="${escapeHtml(video.source)}"></div>` : ''}
                    ${video.publishDate ? `<div class="video-duration">${formatDate(video.publishDate)}</div>` : ''}
                </div>
                <div class="video-info">
                    <h3 class="video-title">${escapeHtml(video.title)}</h3>
                    <div class="video-meta">
                        <span class="video-source"><i class="${sourceIcon}" style="color: ${sourceColor}"></i> ${escapeHtml(video.source)}</span>
                        <span>Added: ${addedDate}</span>
                    </div>
                    ${video.tags.length > 0 ? `
                        <div class="video-tags">
                            ${video.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
                        </div>
                    ` : ''}
                    ${video.notes ? `<p class="video-notes">${escapeHtml(video.notes)}</p>` : ''}
                </div>
                <div class="video-actions">
                    <button class="action-btn" onclick="openVideo('${video.id}')" title="Open">
                        <i class="fas fa-external-link-alt"></i>
                    </button>
                    <button class="action-btn" onclick="editVideo('${video.id}')" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn danger" onclick="deleteVideo('${video.id}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }
    
    // Grid view
    return `
        <div class="video-card" data-id="${video.id}">
            <div class="video-thumbnail">
                ${thumbnailUrl ? `<img src="${escapeHtml(thumbnailUrl)}" alt="${escapeHtml(video.title)}" loading="lazy">` : '<div class="thumbnail-placeholder"><i class="fas fa-image"></i></div>'}
                ${video.favicon ? `<div class="video-favicon"><img src="${escapeHtml(video.favicon)}" alt="${escapeHtml(video.source)}"></div>` : ''}
                ${video.publishDate ? `<div class="video-duration">${formatDate(video.publishDate)}</div>` : ''}
            </div>
            <div class="video-info">
                <h3 class="video-title">${escapeHtml(video.title)}</h3>
                <div class="video-meta">
                    <span class="video-source"><i class="${sourceIcon}" style="color: ${sourceColor}"></i> ${escapeHtml(video.source)}</span>
                    <span>${addedDate}</span>
                </div>
                ${video.tags.length > 0 ? `
                    <div class="video-tags">
                        ${video.tags.slice(0, 3).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
                        ${video.tags.length > 3 ? `<span class="tag">+${video.tags.length - 3}</span>` : ''}
                    </div>
                ` : ''}
            </div>
            <div class="video-actions">
                <button class="action-btn" onclick="openVideo('${video.id}')" title="Open">
                    <i class="fas fa-external-link-alt"></i>
                </button>
                <button class="action-btn" onclick="editVideo('${video.id}')" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="action-btn danger" onclick="deleteVideo('${video.id}')" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}

function renderVideoGrid() {
    const videos = state.filteredVideos;
    
    if (videos.length === 0) {
        elements.videoGrid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-video-slash"></i>
                <h3>No videos found</h3>
                <p>Try adjusting your filters or add a new video</p>
            </div>
        `;
        elements.totalVideos.textContent = videos.length;
        return;
    }
    
    elements.videoGrid.className = `video-grid ${state.currentView === 'list' ? 'list-view' : ''}`;
    elements.videoGrid.innerHTML = videos.map(video => renderVideoCard(video, state.currentView)).join('');
    
    // Update total count
    elements.totalVideos.textContent = videos.length;
}

function applyFilters() {
    state.filteredVideos = state.db.search(
        elements.searchInput.value,
        state.activeFilters
    );
    renderVideoGrid();
}

// ============================================
// Patreon Results Display
// ============================================
async function displayPatreonResults(videos, errors, creatorName = null, sessionId = null) {
    if (videos.length === 0 && errors.length === 0) {
        elements.patreonResults.innerHTML = '<div class="empty">No videos found.</div>';
        return;
    }

    let html = '';

    // Show errors if any
    if (errors.length > 0) {
        html += '<div class="notification warning">Some posts could not be fetched:</div>';
        for (const error of errors) {
            html += `<div class="patreon-video-item"><p class="video-url">${escapeHtml(error.url)}: ${escapeHtml(error.error)}</p></div>`;
        }
    }

    // Show videos
    for (const video of videos) {
        // Try to get thumbnail - first use the one from the video object if available
        let thumbnailUrl = video.thumbnail || null;
        
        // For Vimeo videos, prefer Vimeo's own thumbnail over Patreon's (which may have expired tokens)
        if (video.url.includes('vimeo.com')) {
            try {
                const vimeoThumbnail = await MetadataFetcher.getVimeoThumbnail(video.url);
                if (vimeoThumbnail) {
                    thumbnailUrl = vimeoThumbnail;
                } else {
                    // getVimeoThumbnail returned null, try to extract from Patreon thumbnail
                    // if it's a patreonusercontent.com URL, keep it
                }
            } catch (e) {
                console.error('Error getting Vimeo thumbnail for', video.url, e);
                // Keep the existing thumbnail or null
            }
        } else if (video.url.includes('mediadelivery.net') || video.url.includes('b-cdn.net') || video.url.includes('videodelivery.net')) {
            // For Bunny Stream URLs, prefer Bunny CDN thumbnail over Patreon's (which may have expired tokens)
            // But only use it if it's actually available - Bunny thumbnails often need correct pull zone
            try {
                const bunnyInfo = await MetadataFetcher.getBunnyInfo(video.url);
                if (bunnyInfo.thumbnail) {
                    // Try to verify the thumbnail URL works by checking if it's a Bunny CDN URL
                    // If it's the hardcoded fallback that returns 404, keep the Patreon thumbnail
                    if (bunnyInfo.thumbnail.includes('vz-29a69fda-a46.b-cdn.net')) {
                        // This is the hardcoded fallback which may return 404
                        // Keep the Patreon thumbnail instead
                        console.log('Bunny thumbnail is hardcoded fallback, keeping Patreon thumbnail');
                    } else if (bunnyInfo.thumbnail.startsWith('http')) {
                        thumbnailUrl = bunnyInfo.thumbnail;
                    }
                }
                // If bunnyInfo.thumbnail is null or the hardcoded fallback, keep the Patreon thumbnail
            } catch {
                // Keep the existing thumbnail or null
                console.error('Error getting Bunny thumbnail for', video.url);
            }
        } else if (!thumbnailUrl) {
            // Fallback: try to construct Bunny thumbnail
            try {
                if (video.url.includes('mediadelivery.net') || video.url.includes('b-cdn.net')) {
                    const videoId = MetadataFetcher.getBunnyId ? MetadataFetcher.getBunnyId(video.url) : video.url.split('/').pop().split('?')[0];
                    // Use the most common CDN host from user's data
                    thumbnailUrl = `https://vz-29a69fda-a46.b-cdn.net/${videoId}/thumbnail.jpg`;
                }
            } catch {
                thumbnailUrl = null;
            }
        }

        const proxiedThumbnail = thumbnailUrl ? proxyThumbnailUrl(thumbnailUrl, sessionId) : null;
        
        // Debug: log the thumbnail URL being used
        console.log('Vimeo thumbnail URL:', video.url, '->', thumbnailUrl, '-> proxied:', proxiedThumbnail);
        
        // Add creator tag and thumbnail to video object for import
        const tags = video.tags || [];
        if (creatorName) {
            tags.push(creatorName);
        }
        if (!tags.includes('patreon')) {
            tags.push('patreon');
        }
        
        const videoWithThumbnail = { ...video, thumbnail: thumbnailUrl, tags: tags };

        const encodedData = encodeVideoDataForHtml(videoWithThumbnail);
        html += `
            <div class="patreon-video-item">
                <div class="video-info">
                    ${proxiedThumbnail ? `<img class="video-thumb" src="${proxiedThumbnail}" alt="" onerror="this.style.display='none'" crossOrigin="anonymous">` : ''}
                    <div class="video-details">
                        <div class="video-title">${escapeHtml(video.title)}</div>
                        <div class="video-url">${escapeHtml(video.url)}</div>
                    </div>
                </div>
                <div class="video-actions">
                    <button class="btn btn-primary import-btn" onclick="importPatreonVideo(JSON.parse(atob('${encodedData}')), event)">
                        <i class="fas fa-plus"></i> Import
                    </button>
                </div>
            </div>
        `;
    }

    elements.patreonResults.innerHTML = html;
}

// Display iframes from a single Patreon post
async function displaySinglePostIframes(result, sessionId = null) {
    // Extract creator name from Patreon URL
    // URL format: https://www.patreon.com/creator_name/posts/123456
    let creatorName = null;
    try {
        const urlObj = new URL(result.url);
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        if (pathParts.length >= 2 && pathParts[0] !== 'posts') {
            creatorName = pathParts[0];
        }
    } catch {
        creatorName = null;
    }

    // Create compact header: <title> | <creator> | <found count>
    let headerHtml = `<p class="patreon-post-header">${escapeHtml(result.title || 'Patreon Post')}`;
    if (creatorName) {
        headerHtml += ` | ${escapeHtml(creatorName)}`;
    }
    if (result.iframe_count > 0) {
        headerHtml += ` | ${result.iframe_count} iframe${result.iframe_count > 1 ? 's' : ''}`;
    }
    headerHtml += `</p>`;
    
    let html = headerHtml;

    if (result.iframes.length === 0) {
        html += '<div class="empty">No iframes found in this post.</div>';
        elements.patreonResults.innerHTML = html;
        return;
    }

    for (let i = 0; i < result.iframes.length; i++) {
        const iframeUrl = result.iframes[i];
        let thumbnailUrl = result.thumbnails && result.thumbnails[i] ? result.thumbnails[i] : null;
        
        // Normalize Bunny URL for display and import
        const normalizedUrl = MetadataFetcher.normalizeBunnyUrl ? MetadataFetcher.normalizeBunnyUrl(iframeUrl) : iframeUrl;
        
        // For Vimeo URLs, prefer Vimeo's own thumbnail over Patreon's (which may have expired tokens)
        if (normalizedUrl.includes('vimeo.com')) {
            try {
                const vimeoThumbnail = await MetadataFetcher.getVimeoThumbnail(normalizedUrl);
                if (vimeoThumbnail) {
                    thumbnailUrl = vimeoThumbnail;
                }
            } catch (e) {
                console.error('Error getting Vimeo thumbnail for', normalizedUrl, e);
            }
        } else if (normalizedUrl.includes('mediadelivery.net') || normalizedUrl.includes('b-cdn.net') || normalizedUrl.includes('videodelivery.net')) {
            // For Bunny Stream URLs, prefer Bunny CDN thumbnail over Patreon's (which may have expired tokens)
            // But only use it if it's actually available - Bunny thumbnails often need correct pull zone
            try {
                const bunnyInfo = await MetadataFetcher.getBunnyInfo(normalizedUrl);
                if (bunnyInfo.thumbnail) {
                    // Try to verify the thumbnail URL works by checking if it's a Bunny CDN URL
                    // If it's the hardcoded fallback that returns 404, keep the Patreon thumbnail
                    if (bunnyInfo.thumbnail.includes('vz-29a69fda-a46.b-cdn.net')) {
                        // This is the hardcoded fallback which may return 404
                        // Keep the Patreon thumbnail instead
                        console.log('Bunny thumbnail is hardcoded fallback, keeping Patreon thumbnail');
                    } else if (bunnyInfo.thumbnail.startsWith('http')) {
                        thumbnailUrl = bunnyInfo.thumbnail;
                    }
                }
                // If bunnyInfo.thumbnail is null or the hardcoded fallback, keep the Patreon thumbnail
            } catch {
                // Keep the existing thumbnail (Patreon's) or null
                console.error('Error getting Bunny thumbnail for', normalizedUrl);
            }
        } else if (!thumbnailUrl) {
            try {
                // Try Bunny info for other URLs
                const bunnyInfo = await MetadataFetcher.getBunnyInfo(normalizedUrl);
                if (bunnyInfo.thumbnail) {
                    thumbnailUrl = bunnyInfo.thumbnail;
                } else if (normalizedUrl.includes('mediadelivery.net') || normalizedUrl.includes('b-cdn.net')) {
                    // Fallback: construct from video ID using most common CDN host
                    const videoId = normalizedUrl.split('/').pop().split('?')[0];
                    thumbnailUrl = `https://vz-29a69fda-a46.b-cdn.net/${videoId}/thumbnail.jpg`;
                }
            } catch {
                thumbnailUrl = null;
            }
        }
        
        const proxiedThumbnail = thumbnailUrl ? proxyThumbnailUrl(thumbnailUrl, sessionId) : null;
        
        // Debug: log the thumbnail URL being used
        console.log('Single post thumbnail URL:', normalizedUrl, '->', thumbnailUrl, '-> proxied:', proxiedThumbnail);

        // Create video object for import
        const tags = ['patreon'];
        if (creatorName) {
            tags.push(creatorName);
        }
        
        const videoData = {
            url: normalizedUrl,
            title: result.title || 'Patreon Video',
            tags: tags,
            source: MetadataFetcher.extractSource ? MetadataFetcher.extractSource(normalizedUrl) : 'bunny',
            extractedFrom: result.url,
            thumbnail: thumbnailUrl
        };

        const encodedData = encodeVideoDataForHtml(videoData);
        html += `
            <div class="patreon-video-item">
                <div class="video-info">
                    ${proxiedThumbnail ? `<img class="video-thumb" src="${proxiedThumbnail}" alt="" onerror="this.style.display='none'" crossOrigin="anonymous">` : ''}
                    <div class="video-details">
                        <div class="video-title">Video #${i + 1}</div>
                    </div>
                </div>
                <div class="video-actions">
                    <button class="btn btn-primary import-btn" onclick="importPatreonVideo(JSON.parse(atob('${encodedData}')), event)">
                        <i class="fas fa-plus"></i> Import Video
                    </button>
                </div>
            </div>
        `;
    }

    elements.patreonResults.innerHTML = html;
}

// Import a single Patreon video
async function importPatreonVideo(video, event) {
    try {
        // If event is not passed or is the string "event", use window.event
        if (!event || typeof event === 'string') {
            event = window.event;
        }
        
        // Check if already exists
        const existing = state.db.getByUrl(video.url);
        if (existing) {
            showNotification(`Video already exists: "${existing.title}"`, 'warning');
            return;
        }

        showLoading();

        // Add to database
        // Note: Store original thumbnail URL, proxy will be applied on render
        const originalThumbnail = video.thumbnail || null;
        const savedSession = localStorage.getItem(PATREON_SESSION_KEY);
        if (originalThumbnail) {
            // Pre-cache the thumbnail proxy URL
            proxyThumbnailUrl(originalThumbnail, savedSession);
            
            // Try to cache the actual image data in the background (won't block import)
            if (originalThumbnail.includes('patreonusercontent.com') && savedSession) {
                fetchAndCacheThumbnail(`/thumb?url=${encodeURIComponent(originalThumbnail)}`).catch(() => {});
            } else if (originalThumbnail) {
                fetchAndCacheThumbnail(originalThumbnail).catch(() => {});
            }
        }
        
        await state.db.add({
            url: video.url,
            title: video.title,
            tags: video.tags || ['patreon'],
            notes: video.extractedFrom ? `Imported from Patreon: ${video.extractedFrom}` : 'Imported from Patreon',
            thumbnail: originalThumbnail,
            favicon: null,
            source: video.source || 'bunny',
            publishDate: video.postDate || null,
            addedDate: new Date().toISOString()
        });

        showNotification('Video imported successfully!');
        applyFilters();
        renderTagCloud();
        
        // Remove the imported video from the results
        const videoElement = event ? event.target.closest('.patreon-video-item') : null;
        if (videoElement) {
            videoElement.remove();
        }
        
        if (elements.patreonResults.querySelectorAll('.patreon-video-item').length === 0) {
            elements.patreonResults.innerHTML = '<div class="empty">All videos imported!</div>';
        }
    } catch (e) {
        console.error('Error importing Patreon video:', e);
        showNotification('Error importing video', 'error');
    } finally {
        hideLoading();
    }
}

// ============================================
// Event Listeners
// ============================================
function setupEventListeners() {
    // Modal
    elements.addVideoBtn.addEventListener('click', () => {
        elements.addModal.classList.add('active');
        elements.videoUrl.value = '';
        elements.videoTitle.value = '';
        elements.videoTags.value = '';
        elements.videoNotes.value = '';
        state.editingVideoId = null;
    });
    
    function closeAddModal() {
        elements.addModal.classList.remove('active');
        elements.videoUrl.value = '';
        elements.videoTitle.value = '';
        elements.videoTags.value = '';
        elements.videoNotes.value = '';
        state.editingVideoId = null;
    }
    
    elements.closeModal.addEventListener('click', closeAddModal);
    
    elements.cancelAdd.addEventListener('click', closeAddModal);

    // Close modal on outside click
    elements.addModal.addEventListener('click', (e) => {
        if (e.target === elements.addModal) {
            closeAddModal();
        }
    });

    // Check for duplicate URL in real-time
    elements.videoUrl.addEventListener('blur', async () => {
        const url = elements.videoUrl.value.trim();
        if (!url || !state.db) return;
        
        await state.db.load(); // Ensure data is loaded
        const existing = state.db.getByUrl(url);
        if (existing) {
            showNotification(`Video with this URL already exists: "${existing.title}"`, 'warning');
            elements.videoTitle.value = existing.title || '';
        }
    });

    // Form submission
    elements.addVideoForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const url = elements.videoUrl.value.trim();
        const title = elements.videoTitle.value.trim();
        const tags = elements.videoTags.value
            .split(',')
            .map(t => t.trim().toLowerCase())
            .filter(t => t.length > 0);
        const notes = elements.videoNotes.value.trim();
        
        if (!url) {
            showNotification('Please enter a video URL', 'error');
            return;
        }
        
        if (!title) {
            showNotification('Please enter a title', 'error');
            return;
        }
        
        showLoading();
        
        try {
            let video;
            
            if (state.editingVideoId) {
                // When editing, get the existing video and merge with new values
                const existing = state.db.getById(state.editingVideoId);
                video = {
                    ...existing,
                    url,
                    title,
                    tags,
                    notes
                };
            } else {
                // When adding, fetch metadata
                const metadata = await MetadataFetcher.fetchMetadata(url);
                const originalThumbnail = metadata.thumbnail || null;
                const savedSession = localStorage.getItem(PATREON_SESSION_KEY);
                if (originalThumbnail) {
                    // Pre-cache the thumbnail
                    proxyThumbnailUrl(originalThumbnail, savedSession);
                }
                video = {
                    url,
                    title: metadata.title || title,
                    tags,
                    notes,
                    thumbnail: originalThumbnail,
                    favicon: metadata.favicon,
                    source: metadata.source,
                    publishDate: metadata.publishDate
                };
            }
            
            if (state.editingVideoId) {
                // Update existing video
                await state.db.update(state.editingVideoId, video);
                showNotification('Video updated successfully!');
            } else {
                // Add new video
                await state.db.add(video);
                showNotification('Video added successfully!');
                
                // Reset filters only when adding a new video
                state.activeFilters = {
                    search: '',
                    tags: [],
                    dateAdded: 'all',
                    publishDate: 'all'
                };
                elements.searchInput.value = '';
                elements.dateFilter.value = 'all';
                elements.publishDateFilter.value = 'all';
                
                // Update tag filters
                document.querySelectorAll('.tag-filter').forEach(t => t.classList.remove('active'));
            }
            closeAddModal();
            
            applyFilters();
            renderTagCloud();
        } catch (e) {
            console.error('Error adding video:', e);
            // Show specific error message if available
            const message = e.message && e.message.includes('Duplicate') ? e.message : 'Error adding video';
            showNotification(message, 'error');
        } finally {
            hideLoading();
        }
    });

    // Fetch metadata button
    elements.fetchMetadata.addEventListener('click', async () => {
        const url = elements.videoUrl.value.trim();
        if (!url) {
            showNotification('Please enter a video URL first', 'error');
            return;
        }
        
        showLoading();
        try {
            const metadata = await MetadataFetcher.fetchMetadata(url);
            
            if (metadata.title) {
                elements.videoTitle.value = metadata.title;
            }
            
            // Try to fill in tags based on source
            const source = MetadataFetcher.extractSource(url);
            if (source === 'youtube' && url.includes('barber') || url.includes('haircut')) {
                if (!elements.videoTags.value) {
                    elements.videoTags.value = 'barbering, haircut';
                }
            }
            
            showNotification('Metadata fetched!');
        } catch (e) {
            showNotification('Could not fetch metadata', 'error');
        } finally {
            hideLoading();
        }
    });

    // Search
    elements.searchInput.addEventListener('input', () => {
        state.activeFilters.search = elements.searchInput.value;
        applyFilters();
    });

    // Date filter
    elements.dateFilter.addEventListener('change', () => {
        state.activeFilters.dateAdded = elements.dateFilter.value;
        applyFilters();
    });

    // Publish date filter
    elements.publishDateFilter.addEventListener('change', () => {
        state.activeFilters.publishDate = elements.publishDateFilter.value;
        applyFilters();
    });

    // Clear filters
    elements.clearFilters.addEventListener('click', () => {
        state.activeFilters = {
            search: '',
            tags: [],
            dateAdded: 'all',
            publishDate: 'all'
        };
        elements.searchInput.value = '';
        elements.dateFilter.value = 'all';
        elements.publishDateFilter.value = 'all';
        document.querySelectorAll('.tag-filter').forEach(t => t.classList.remove('active'));
        applyFilters();
    });

    // View toggle
    elements.viewBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.viewBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentView = btn.dataset.view;
            renderVideoGrid();
        });
    });

    // Import
    elements.importBtn.addEventListener('click', async () => {
        const data = prompt('Paste your exported JSON data:');
        if (data) {
            const success = await state.db.import(data);
            if (success) {
                showNotification('Data imported successfully!');
                applyFilters();
                renderTagCloud();
            } else {
                showNotification('Invalid import data', 'error');
            }
        }
    });

    // Export
    elements.exportBtn.addEventListener('click', () => {
        const data = state.db.export();
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `asmr-collection-export-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showNotification('Collection exported!');
    });

    // Tag suggestions
    document.querySelectorAll('.tag-suggestion').forEach(tagEl => {
        tagEl.addEventListener('click', () => {
            const currentTags = elements.videoTags.value
                .split(',')
                .map(t => t.trim().toLowerCase())
                .filter(t => t.length > 0);
            
            const newTag = tagEl.dataset.tag;
            if (!currentTags.includes(newTag)) {
                currentTags.push(newTag);
                elements.videoTags.value = currentTags.join(', ');
            }
        });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            elements.addModal.classList.remove('active');
            elements.patreonModal.classList.remove('active');
        }
    });

    // Patreon Import Modal
    if (elements.patreonImportBtn) {
        elements.patreonImportBtn.addEventListener('click', () => {
            elements.patreonModal.classList.add('active');
            // Load saved session if available
            const savedSession = localStorage.getItem(PATREON_SESSION_KEY);
            elements.patreonSessionId.value = savedSession || '';
            
            // Reset mode-specific fields
            elements.patreonCreator.value = '';
            elements.patreonMaxPosts.value = '20';
            elements.patreonPostUrl.value = '';
            elements.patreonResults.innerHTML = '';
            
            // Ensure single mode is selected by default
            elements.patreonModeSingle.checked = true;
            elements.patreonModeMultiple.checked = false;
            if (elements.singlePostFields) elements.singlePostFields.style.display = 'block';
            if (elements.multiplePostsFields) elements.multiplePostsFields.style.display = 'none';
        });
        
        // Mode toggle handlers
        if (elements.patreonModeSingle) {
            elements.patreonModeSingle.addEventListener('change', () => {
                if (elements.patreonModeSingle.checked) {
                    if (elements.singlePostFields) elements.singlePostFields.style.display = 'block';
                    if (elements.multiplePostsFields) elements.multiplePostsFields.style.display = 'none';
                }
            });
        }
        if (elements.patreonModeMultiple) {
            elements.patreonModeMultiple.addEventListener('change', () => {
                if (elements.patreonModeMultiple.checked) {
                    if (elements.singlePostFields) elements.singlePostFields.style.display = 'none';
                    if (elements.multiplePostsFields) elements.multiplePostsFields.style.display = 'block';
                }
            });
        }
    }

    if (elements.closePatreonModal) {
        elements.closePatreonModal.addEventListener('click', () => {
            elements.patreonModal.classList.remove('active');
        });
    }

    if (elements.cancelPatreon) {
        elements.cancelPatreon.addEventListener('click', () => {
            elements.patreonModal.classList.remove('active');
        });
    }

    // Close Patreon modal on outside click
    if (elements.patreonModal) {
        elements.patreonModal.addEventListener('click', (e) => {
            if (e.target === elements.patreonModal) {
                elements.patreonModal.classList.remove('active');
            }
        });
    }

    // Unified fetch handler for both single and multiple modes
    if (elements.fetchPatreonContent) {
        elements.fetchPatreonContent.addEventListener('click', async () => {
            const sessionId = elements.patreonSessionId.value.trim();
            const isSingleMode = elements.patreonModeSingle && elements.patreonModeSingle.checked;

            if (!sessionId) {
                showNotification('Please enter a Patreon Session ID', 'error');
                return;
            }

            if (isSingleMode) {
                const postUrl = elements.patreonPostUrl.value.trim();

                if (!postUrl) {
                    showNotification('Please enter a Patreon Post URL', 'error');
                    return;
                }

                if (!postUrl.includes('patreon.com')) {
                    showNotification('Please enter a valid Patreon post URL', 'error');
                    return;
                }

                showLoading();
                elements.fetchPatreonContent.disabled = true;
                elements.patreonResults.innerHTML = '<div class="patreon-loading"><div class="spinner"></div><p>Fetching Patreon post...</p></div>';

                try {
                    const result = await MetadataFetcher.fetchPatreonPostIframe(postUrl, sessionId);

                    // Save session to localStorage for future use
                    localStorage.setItem(PATREON_SESSION_KEY, sessionId);
                    // Also set as cookie for thumbnail proxy (30 days)
                    document.cookie = `patreon_session=${sessionId}; path=/; max-age=${60*60*24*30}; SameSite=Lax`;

                    if (result.iframes.length === 0) {
                        elements.patreonResults.innerHTML = '<div class="empty">No iframes found in this post.</div>';
                        showNotification('No iframes found', 'warning');
                    } else {
                        await displaySinglePostIframes(result, sessionId);
                    }
                } catch (e) {
                    console.error('Error fetching single Patreon post:', e);
                    elements.patreonResults.innerHTML = `<div class="empty">Error: ${escapeHtml(e.message)}</div>`;
                    showNotification('Error fetching post', 'error');
                } finally {
                    hideLoading();
                    elements.fetchPatreonContent.disabled = false;
                }
            } else {
                const creatorName = elements.patreonCreator.value.trim();
                const maxPosts = parseInt(elements.patreonMaxPosts.value) || 20;

                if (!creatorName) {
                    showNotification('Please enter a Creator Name', 'error');
                    return;
                }

                showLoading();
                elements.fetchPatreonContent.disabled = true;
                elements.patreonResults.innerHTML = '<div class="patreon-loading"><div class="spinner"></div><p>Fetching Patreon videos...</p></div>';

                try {
                    const result = await MetadataFetcher.fetchPatreonVideos(sessionId, creatorName, maxPosts);

                    // Save session to localStorage for future use
                    localStorage.setItem(PATREON_SESSION_KEY, sessionId);
                    // Also set as cookie for thumbnail proxy (30 days)
                    document.cookie = `patreon_session=${sessionId}; path=/; max-age=${60*60*24*30}; SameSite=Lax`;

                    if (result.videos.length === 0) {
                        elements.patreonResults.innerHTML = '<div id="patreonResults" class="empty">No videos found. Try checking your session ID or creator name.</div>';
                        showNotification('No videos found', 'warning');
                    } else {
                        await displayPatreonResults(result.videos, result.errors, creatorName, sessionId);
                    }
                } catch (e) {
                    console.error('Error fetching Patreon videos:', e);
                    elements.patreonResults.innerHTML = `<div class="empty">Error: ${escapeHtml(e.message)}</div>`;
                    showNotification('Error fetching Patreon videos', 'error');
                } finally {
                    hideLoading();
                    elements.fetchPatreonContent.disabled = false;
                }
            }
        });
    }
}

// ============================================
// Public API for buttons
// ============================================
function openVideo(id) {
    const video = state.db.getById(id);
    if (video && video.url) {
        window.open(video.url, '_blank', 'noopener,noreferrer');
    }
}

function editVideo(id) {
    const video = state.db.getById(id);
    if (video) {
        // Set editing state
        state.editingVideoId = id;
        
        // Open the add modal with pre-filled data
        elements.addModal.classList.add('active');
        elements.videoUrl.value = video.url;
        elements.videoTitle.value = video.title;
        elements.videoTags.value = video.tags.join(', ');
        elements.videoNotes.value = video.notes || '';
        
        showNotification('Edit the fields and save to update');
    }
}

async function deleteVideo(id) {
    if (confirm('Are you sure you want to delete this video?')) {
        const video = state.db.getById(id);
        await state.db.delete(id);
        
        // Clear thumbnail cache for this video
        if (video && video.thumbnail) {
            removeCachedThumbnail(video.thumbnail);
        }
        
        applyFilters();
        renderTagCloud();
        showNotification('Video deleted');
    }
}

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    showLoading();
    
    // Initialize the database first
    await initState();
    
    // Now set up the UI
    setupEventListeners();
    applyFilters();
    renderTagCloud();
    
    // Set initial view
    state.currentView = 'grid';
    elements.viewBtns.forEach(btn => {
        if (btn.dataset.view === state.currentView) {
            btn.classList.add('active');
        }
    });
    
    // Update stats
    elements.totalVideos.textContent = state.filteredVideos.length;
    
    hideLoading();
});
