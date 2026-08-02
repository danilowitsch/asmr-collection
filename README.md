# ASMR Video Collection

A **client-side web application** for managing your ASMR video bookmarks. Organize, tag, and filter your collection of ASMR videos from YouTube, Vimeo, and other platforms.

Perfect for collecting barbering ASMR, massage videos, haircuts, and more!

## Features

- **Video Database** - Store video URLs, titles, tags, and notes in your browser's local storage
- **Thumbnail Previews** - Automatically fetches thumbnails from YouTube and Vimeo
- **Favicon Display** - Shows the website's favicon for each video
- **Tag System** - Add multiple tags to each video (barbering, massage, haircut, relaxing, etc.)
- **Smart Filtering**
  - Filter by tags (click on any tag to filter)
  - Filter by date added (today, last week, last month, etc.)
  - Sort by publish date (most recent or oldest first)
  - Text search across titles, notes, URLs, and tags
- **View Modes** - Grid or list view for your preference
- **Import/Export** - Backup your collection or move it between browsers
- **Source Detection** - Automatically detects YouTube, Vimeo, Rumble, Odysee, and more
- **Responsive Design** - Works on desktop, tablet, and mobile

## Quick Start

### Option 1: Open Directly
Simply open `index.html` in your web browser. No server required! 
*Note: Metadata fetching (thumbnails, titles) will be limited due to CORS restrictions.*

### Option 2: Local Server (Recommended for Full Features)
For **full metadata fetching** (thumbnails from any site including reedtv.com), use the included proxy server:

**With the included Python server (best option):**
```bash
# First install dependencies (one time)
pip install flask flask-cors beautifulsoup4 requests

# Then run the server
python3 server.py
# Then open http://localhost:8000 in your browser
```

**Simple Python HTTP server (limited metadata):**
```bash
python -m http.server 8000
# Then open http://localhost:8000 in your browser
```

**Node.js (with http-server):**
```bash
npx http-server
# Then open http://localhost:8080 in your browser
```

## Usage

### Adding a Video

1. Click the **"Add Video"** button
2. Enter the video URL (YouTube, Vimeo, etc.)
3. Click **"Fetch Info"** to automatically fill in the title and other metadata
4. Add tags (comma-separated) - suggested tags appear below the input
5. Add any notes you want to remember
6. Click **"Save"**

### Filtering

- **Search** - Type in the search box to find videos by title, URL, notes, or tags
- **Tags** - Click on any tag in the sidebar to filter by that tag. Click again to remove the filter.
- **Date Added** - Filter by when you added the video to your collection
- **Publish Date** - Sort by the video's publish date (most recent or oldest first)
- **Clear Filters** - Remove all active filters at once

### View Modes

- **Grid View** - Thumbnail cards in a responsive grid
- **List View** - Detailed list with more information visible

Toggle between views using the buttons in the toolbar.

### Managing Videos

- **Open** - Click the external link button to open the video in a new tab
- **Edit** - Click the edit button to update video details (currently creates a new entry)
- **Delete** - Click the trash button to remove a video from your collection

### Import/Export

- **Export** - Download your entire collection as a JSON file for backup
- **Import** - Load a previously exported collection from a JSON file

### Patreon Integration

To import videos from Patreon (including Bunny Stream videos):

1. You need to use the **local server** (`python3 server.py`) for Patreon integration to work
2. Get your **Patreon Session ID**:
   - Log in to Patreon in your browser
   - Open Developer Tools (F12 or right-click → Inspect)
   - Go to Application tab → Cookies
   - Copy the value of the `session_id` cookie
3. Click the **"Import from Patreon"** button in the toolbar
4. Enter your Patreon Session ID
5. Enter the creator's name (e.g., `massagevids`)
6. Select how many posts to fetch
7. Click **"Fetch Videos"**
8. Browse the results and click **"Import"** on individual videos

The app will automatically:
- Extract Bunny Stream (mediadelivery.net) video URLs from Patreon posts
- Convert embed URLs to playable URLs
- Import videos with the post title as the video title
- Tag them with "patreon" for easy filtering

**Note:** The session ID gives access to your Patreon account. Keep it private and don't share it.

## Project Structure

```
asmr-collection/
├── index.html          # Main application page
├── README.md           # This documentation
├── server.py          # Proxy server for metadata fetching (required for Patreon, reedtv, etc.)
├── asmr_data.json     # Server-side data storage (optional)
├── scripts/
│   └── app.js          # Application logic and database
└── styles/
    └── style.css       # Dark theme styling
```

## Data Storage

All data is stored in your browser's **localStorage**. This means:

- Your collection persists between browser sessions
- Data is **not** sent to any server
- Your collection is private to your browser
- You can export your data for backup or to share between browsers

## Supported Platforms

- **YouTube** - Full thumbnail and metadata support
- **Vimeo** - Thumbnail and metadata support
- **Bunny Stream** (mediadelivery.net, b-cdn.net) - Thumbnail and metadata support
- **ReedTV** - Full support with proxy server
- **Rumble** - Basic support
- **Odysee** - Basic support
- **Dailymotion** - Basic support
- **Patreon** (via Bunny Stream) - Import videos from authenticated posts
- **Any URL** - Will store the URL and display favicon

## Suggested Tags

The app includes quick-access tags for common ASMR content:

- barbering
- massage
- haircut
- relaxing
- scalp
- whispering
- tapping
- brushing
- cutting
- shaving
- face
- head
- neck
- shoulders
- hot-towel
- straight-razor
- scissors
- clipper
- beard
- mustache

You can add any custom tags you like!

## Metadata Fetching

The app attempts to automatically fetch:

- **Thumbnail images** from YouTube and Vimeo
- **Video title** from the platform
- **Publish date** (when available)
- **Favicon** from the video's domain

For YouTube, thumbnails are fetched directly from YouTube's CDN. For other platforms, basic metadata may be limited due to CORS restrictions.

## Customization

### Adding Custom Tags

Just type any tag in the tags input field when adding a video. The app will track all tags you use.

### Changing the Theme

Edit the CSS variables in `styles/style.css`:

```css
:root {
    --primary: #6c5ce7;      /* Main purple color */
    --primary-dark: #5649c0;
    --bg: #1a1a2e;           /* Dark background */
    --bg-card: #16213e;       /* Card background */
    /* ... */
}
```

### Adding New Suggested Tags

Edit the `SUGGESTED_TAGS` array in `scripts/app.js`:

```javascript
const SUGGESTED_TAGS = ['barbering', 'massage', ...];
```

## Tips

1. **Use descriptive titles** - Makes it easier to find videos later
2. **Add multiple tags** - More tags = better filtering (e.g., "barbering, haircut, straight-razor")
3. **Use the notes field** - Add timestamps for your favorite parts, or any other details
4. **Export regularly** - Backup your collection to avoid losing data
5. **Fetch metadata** - Always click "Fetch Info" to get thumbnails and titles automatically

## Troubleshooting

- **Thumbnails not loading?** - Some platforms have CORS restrictions. Try using a local server.
- **Metadata not fetching?** - The platform may not support CORS requests from static pages.
- **Data not saving?** - Check if your browser has localStorage enabled.
- **Import not working?** - Make sure you're pasting valid JSON from an export.

## Browser Support

- Chrome (recommended)
- Firefox
- Safari
- Edge
- Mobile browsers (with limitations on metadata fetching)

## Privacy

All data is stored **locally in your browser**. No data is sent to any external servers (except for fetching metadata from video platforms when you explicitly add a video).

## License

This project is free to use for personal purposes. Feel free to customize it for your own ASMR video collection!
