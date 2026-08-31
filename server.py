#!/usr/bin/env python3
"""
Simple CORS proxy server for ASMR Video Collection

This server provides:
- Static file serving for the web app
- /proxy endpoint for fetching OpenGraph metadata from any URL
- /api endpoints for saving/loading video data to a JSON file

Usage:
    python3 server.py
    
Then open http://localhost:8000 in your browser to use the app.
"""

from flask import Flask, request, jsonify, send_file, make_response
from flask_cors import CORS
import requests
from urllib.parse import urlparse, parse_qs, unquote
from bs4 import BeautifulSoup
import re
import json
import os
from datetime import datetime, timedelta

# Playwright for handling Cloudflare-protected sites like Patreon
try:
    from playwright.sync_api import sync_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    app.logger.warning("Playwright not available. Patreon scraping may fail with 403 errors.")

app = Flask(__name__)
CORS(app)  # Allow all origins for development

# Configure logging
import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Data file for persistence
DATA_FILE = 'asmr_data.json'


def normalize_bunny_url(url):
    """
    Normalize Bunny Stream (mediadelivery.net) URLs from /embed/ to /play/ format.
    This matches the behavior used when manually adding entries.
    """
    if not url:
        return url
    
    try:
        parsed = urlparse(url)
        if 'mediadelivery.net' in parsed.netloc or 'bunny.net' in parsed.netloc:
            # Replace /embed/ or /embeded/ with /play/ in the path
            path = parsed.path.replace('/embed/', '/play/').replace('/embeded/', '/play/')
            # Remove query parameters
            path = path.split('?')[0]
            return f"{parsed.scheme}://{parsed.netloc}{path}"
        return url
    except:
        return url


def fetch_opengraph_metadata(url):
    """
    Fetch OpenGraph metadata from a URL.
    Returns a dict with metadata fields.
    """
    try:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return {}
        
        headers = {'User-Agent': USER_AGENT}
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        metadata = {}
        
        # Extract OpenGraph tags
        for tag in soup.find_all('meta', attrs={'property': re.compile(r'^og:')}):
            key = tag.get('property', '').replace('og:', '')
            value = tag.get('content', '').strip()
            if value:
                metadata[key] = value
        
        # Extract standard meta tags as fallback
        for tag in soup.find_all('meta', attrs={'name': re.compile(r'^(title|description|thumbnail|image)$', re.I)}):
            key = tag.get('name', '').lower()
            value = tag.get('content', '').strip()
            if value and key not in metadata:
                metadata[key] = value
        
        # Try to get title from <title> tag
        if not metadata.get('title') and soup.title:
            metadata['title'] = soup.title.string
        
        return metadata
    except Exception as e:
        app.logger.warning(f"Failed to fetch OpenGraph metadata for {url}: {e}")
        return {}


def resolve_video_url_from_link(url):
    """
    Resolve a video link to its actual embed/iframe URL.
    Supports reed.tv and other platforms that provide OpenGraph video metadata.
    """
    try:
        # For reed.tv links, fetch OpenGraph to get the actual iframe URL
        if 'reed.tv' in url.lower() or 'reedtv.com' in url.lower():
            metadata = fetch_opengraph_metadata(url)
            # Try og:video, og:video:secure_url, or twitter:player
            for key in ['video', 'video:secure_url', 'twitter:player']:
                if key in metadata:
                    return metadata[key]
            # If no specific video URL, return the original
            return url
        
        # Add support for other platforms here as needed
        # For now, return the URL as-is
        return url
    except Exception as e:
        app.logger.warning(f"Failed to resolve video URL {url}: {e}")
        return url


def fetch_with_playwright(url, headers=None, timeout=30000):
    """
    Fetch a URL using Playwright to handle Cloudflare and other JS challenges.
    This is used for sites like Patreon that block simple requests.
    
    Args:
        url: The URL to fetch
        headers: Optional dict of headers to include
        timeout: Timeout in milliseconds
        
    Returns:
        The page HTML content as a string
    """
    if not PLAYWRIGHT_AVAILABLE:
        app.logger.error("Playwright not available, cannot fetch URL with browser")
        raise RuntimeError("Playwright is required for this request. Install with: pip install playwright && playwright install")
    
    from playwright.sync_api import sync_playwright
    
    try:
        with sync_playwright() as p:
            # Use firefox or chromium - firefox seems to work better with Cloudflare
            browser = p.firefox.launch()
            # browser = p.chromium.launch()
            page = browser.new_page()
            
            # Set user agent
            page.set_extra_http_headers({
                'User-Agent': USER_AGENT,
            })
            
            # Add any custom headers
            if headers:
                for key, value in headers.items():
                    if key.upper() != 'USER-AGENT':
                        page.set_extra_http_headers({key: value})
            
            # Navigate to the page
            page.goto(url, timeout=timeout, wait_until='domcontentloaded')
            
            # Wait for network to be idle (no more than 2 requests for 500ms)
            try:
                page.wait_for_load_state('networkidle', timeout=10000)
            except:
                # If network idle timeout, just wait a bit more
                page.wait_for_timeout(2000)
            
            # Get the page content
            content = page.content()
            browser.close()
            return content
            
    except Exception as e:
        app.logger.error(f"Playwright fetch failed for {url}: {e}")
        raise


# User-Agent to avoid blocking
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'

# Ensure data directory exists
os.makedirs(os.path.dirname(DATA_FILE) if os.path.dirname(DATA_FILE) else '.', exist_ok=True)


def load_data():
    """Load video data from JSON file"""
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            return {'videos': []}
    return {'videos': []}


def save_data(data):
    """Save video data to JSON file"""
    try:
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except:
        return False

@app.route('/')
def serve_index():
    """Serve the main index.html file"""
    return send_file('index.html')


# ============================================
# API Endpoints for Data Persistence
# ============================================

@app.route('/api/ping')
def api_ping():
    """Check if API is available"""
    return jsonify({'status': 'ok', 'message': 'ASMR Video Collection API is running'})


@app.route('/api/save', methods=['POST'])
def api_save():
    """Save video collection data to file"""
    try:
        data = request.get_json()
        if data and 'videos' in data:
            # Add metadata
            data['_savedAt'] = datetime.now().isoformat()
            data['_version'] = '1.0'
            
            if save_data(data):
                return jsonify({'status': 'ok', 'savedAt': data['_savedAt']})
            else:
                return jsonify({'status': 'error', 'message': 'Failed to save data'}), 500
        else:
            return jsonify({'status': 'error', 'message': 'Invalid data format'}), 400
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/load')
def api_load():
    """Load video collection data from file"""
    try:
        data = load_data()
        return jsonify(data)
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/export')
def api_export():
    """Export data as downloadable file"""
    try:
        data = load_data()
        filename = f"asmr-export-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
        response = make_response(json.dumps(data, indent=2, ensure_ascii=False))
        response.headers['Content-Type'] = 'application/json'
        response.headers['Content-Disposition'] = f'attachment; filename={filename}'
        return response
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/raw-proxy')
def raw_proxy():
    """
    Raw proxy endpoint that returns the actual HTML content.
    Useful for parsing pages that require authentication (like Patreon).
    
    Usage: /raw-proxy?url=<encoded_url>
    Optional: X-Patreon-Session header for authenticated Patreon requests
    
    Returns the raw HTML content with CORS headers.
    """
    url = request.args.get('url')
    if not url:
        return jsonify({'error': 'URL parameter is required'}), 400
    
    try:
        # Validate URL
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return jsonify({'error': 'Invalid URL'}), 400
        
        # Build headers
        headers = {'User-Agent': USER_AGENT}
        
        # Pass through X-Patreon-Session if provided, or check for cookie
        patreon_session = request.headers.get('X-Patreon-Session') or request.cookies.get('patreon_session')
        if patreon_session:
            headers['Cookie'] = f'session_id={patreon_session}'
        
        # For Patreon URLs, use Playwright to handle Cloudflare
        if 'patreon.com' in parsed.netloc:
            try:
                content = fetch_with_playwright(url, headers=headers, timeout=30000)
            except RuntimeError as e:
                app.logger.warning(f"Playwright not available for Patreon URL, falling back to requests: {e}")
                response = requests.get(url, headers=headers, timeout=15)
                response.raise_for_status()
                content = response.content if response.ok else response.text
        else:
            # For non-Patreon URLs, use regular requests (faster)
            response = requests.get(url, headers=headers, timeout=15)
            response.raise_for_status()
            content = response.content if response.ok else response.text
        
        # Return raw content with CORS headers
        content_type = 'text/html; charset=utf-8'
        if isinstance(content, str):
            content = content.encode('utf-8')
        html_response = make_response(content)
        html_response.headers['Content-Type'] = content_type
        html_response.headers['Access-Control-Allow-Origin'] = '*'
        html_response.headers['Access-Control-Allow-Methods'] = 'GET'
        html_response.headers['Access-Control-Max-Age'] = '86400'
        return html_response
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/thumb')
def proxy_thumbnail():
    """
    Proxy endpoint to fetch thumbnail images with CORS headers.
    
    Usage: /thumb?url=<encoded_image_url>
    
    Returns the image with proper CORS headers.
    """
    url = request.args.get('url')
    if not url:
        return jsonify({'error': 'URL parameter is required'}), 400
    
    try:
        # Validate URL
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return jsonify({'error': 'Invalid URL'}), 400
        
        # Build headers
        headers = {'User-Agent': USER_AGENT}
        
        # Pass through X-Patreon-Session if provided, or check for cookie
        patreon_session = request.headers.get('X-Patreon-Session') or request.cookies.get('patreon_session')
        app.logger.info(f"Thumb proxy: url={url}")
        app.logger.info(f"Thumb proxy: X-Patreon-Session header: {request.headers.get('X-Patreon-Session')}")
        app.logger.info(f"Thumb proxy: patreon_session cookie: {request.cookies.get('patreon_session')}")
        app.logger.info(f"Thumb proxy: Using session: {patreon_session}")
        if patreon_session:
            headers['Cookie'] = f'session_id={patreon_session}'
        
        # Fetch the image
        app.logger.info(f"Thumb proxy: Fetching {url} with headers {headers}")
        response = requests.get(url, headers=headers, timeout=10, stream=True)
        app.logger.info(f"Thumb proxy: Response status: {response.status_code}")
        response.raise_for_status()
        
        # Return the image with CORS and cache headers
        image_response = make_response(response.content)
        image_response.headers['Content-Type'] = response.headers.get('Content-Type', 'image/jpeg')
        image_response.headers['Access-Control-Allow-Origin'] = '*'
        image_response.headers['Access-Control-Allow-Methods'] = 'GET'
        image_response.headers['Access-Control-Max-Age'] = '86400'
        
        # Cache for 30 days (thumbnails rarely change)
        image_response.headers['Cache-Control'] = 'public, max-age=2592000, immutable'
        image_response.headers['Expires'] = (datetime.now() + timedelta(days=30)).strftime('%a, %d %b %Y %H:%M:%S GMT')
        
        return image_response
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/proxy')
def proxy():
    """
    Proxy endpoint to fetch OpenGraph data from any URL.
    
    Usage: /proxy?url=<encoded_url>
    Optional: X-Patreon-Session header for authenticated Patreon requests
    
    Returns JSON with:
    - title: Video title
    - thumbnail: Thumbnail URL
    - description: Video description
    - publish_date: Publish date if available
    - favicon: Favicon URL
    """
    url = request.args.get('url')
    if not url:
        return jsonify({'error': 'URL parameter is required'}), 400
    
    try:
        # Validate URL
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return jsonify({'error': 'Invalid URL'}), 400
        
        # Build headers - include User-Agent and any custom headers from request
        headers = {'User-Agent': USER_AGENT}
        
        # Pass through X-Patreon-Session if provided
        patreon_session = request.headers.get('X-Patreon-Session')
        if patreon_session:
            headers['Cookie'] = f'session_id={patreon_session}'
        
        # For Patreon URLs, use Playwright to handle Cloudflare
        if 'patreon.com' in parsed.netloc:
            try:
                html_content = fetch_with_playwright(url, headers=headers, timeout=30000)
            except RuntimeError as e:
                app.logger.warning(f"Playwright not available for Patreon URL, falling back to requests: {e}")
                response = requests.get(url, headers=headers, timeout=10)
                response.raise_for_status()
                html_content = response.text
        else:
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            html_content = response.text
        
        # Parse HTML for OpenGraph tags
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Extract OpenGraph data
        og_data = {}
        for tag in soup.find_all('meta', attrs={'property': re.compile(r'^og:')}):
            key = tag.get('property', '').replace('og:', '')
            value = tag.get('content', '')
            og_data[key] = value
        
        # Extract standard meta tags as fallback
        for tag in soup.find_all('meta', attrs={'name': re.compile(r'^(title|description|thumbnail|image)$', re.I)}):
            key = tag.get('name', '').lower()
            value = tag.get('content', '')
            if key not in og_data:
                og_data[key] = value
        
        # Try to get title from <title> tag
        if not og_data.get('title') and soup.title:
            og_data['title'] = soup.title.string
        
        # Build result
        result = {
            'title': og_data.get('title', ''),
            'thumbnail': og_data.get('image') or og_data.get('thumbnail', ''),
            'description': og_data.get('description', ''),
            'publish_date': og_data.get('published_time', ''),
            'favicon': f"https://www.google.com/s2/favicons?domain={parsed.netloc}&sz=64",
            'url': url
        }
        
        # Clean up thumbnail URL if it's relative
        if result['thumbnail'] and not result['thumbnail'].startswith(('http:', 'https:')):
            result['thumbnail'] = f"{parsed.scheme}://{parsed.netloc}{result['thumbnail'] if result['thumbnail'].startswith('/') else '/' + result['thumbnail']}"
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({
            'error': str(e),
            'title': None,
            'thumbnail': None,
            'description': None,
            'publish_date': None,
            'favicon': f"https://www.google.com/s2/favicons?domain={parsed.netloc}&sz=64" if url else None
        }), 500

@app.route('/<path:path>')
def serve_static(path):
    """Serve static files (CSS, JS, images)"""
    return send_file(path)


@app.route('/api/patreon-post-iframe')
def patreon_post_iframe():
    """
    Extract iframe URLs and thumbnails from a single Patreon post.
    Supports direct iframes, JSON-LD VideoObject, OpenGraph video metadata, and external video links (reed.tv, etc.)
    
    Usage: /api/patreon-post-iframe?url=<encoded_post_url>
    Required header: X-Patreon-Session for authenticated access
    
    Returns JSON with iframe URLs and thumbnails found in the post.
    """

    url = request.args.get('url')
    if not url:
        return jsonify({'error': 'URL parameter is required'}), 400
    
    try:
        # Validate URL
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return jsonify({'error': 'Invalid URL'}), 400
        
        if 'patreon.com' not in parsed.netloc:
            return jsonify({'error': 'URL must be a Patreon post URL'}), 400
        
        # Get Patreon session from header
        patreon_session = request.headers.get('X-Patreon-Session')
        if not patreon_session:
            return jsonify({'error': 'X-Patreon-Session header is required'}), 401
        
        # Build headers for Playwright
        headers = {
            'User-Agent': USER_AGENT,
            'Cookie': f'session_id={patreon_session}'
        }
        
        # Fetch the post HTML using Playwright to handle Cloudflare
        try:
            html_content = fetch_with_playwright(url, headers=headers, timeout=30000)
        except RuntimeError as e:
            # Fall back to requests if Playwright is not available
            app.logger.warning(f"Playwright not available, falling back to requests: {e}")
            response = requests.get(url, headers=headers, timeout=15)
            response.raise_for_status()
            html_content = response.text
        
        # Parse HTML for iframe tags
        soup = BeautifulSoup(html_content, 'html.parser')
        iframes = soup.find_all('iframe')
        
        # Extract iframe info (src and poster/thumbnail)
        iframe_info = []
        for iframe in iframes:
            src = iframe.get('src', '')
            if not src or not src.strip():
                continue
            
            # Make relative URLs absolute
            if not src.startswith(('http:', 'https:')):
                src = f"{parsed.scheme}://{parsed.netloc}{src if src.startswith('/') else '/' + src}"
            
            # Extract poster attribute (thumbnail) from iframe
            # Also try data-thumbnail or other common attributes
            poster = (iframe.get('poster', '') or 
                     iframe.get('data-poster', '') or
                     iframe.get('data-thumbnail', '') or
                     '').strip()
            if poster:
                if not poster.startswith(('http:', 'https:')):
                    poster = f"{parsed.scheme}://{parsed.netloc}{poster if poster.startswith('/') else '/' + poster}"
            else:
                # If no poster attribute, try to find an image near this iframe
                # Look for img tags that might be thumbnails
                parent = iframe.parent
                if parent:
                    imgs = parent.find_all('img', src=True)
                    if imgs:
                        poster = imgs[0].get('src', '').strip()
                        if poster and not poster.startswith(('http:', 'https:')):
                            poster = f"{parsed.scheme}://{parsed.netloc}{poster if poster.startswith('/') else '/' + poster}"
                
            # If still no poster, try Embedly or Bunny Stream thumbnail extraction

            if not poster:
                # Try to extract thumbnail from Embedly wrapper URLs first
                if 'embedly.com' in src:

                    # Extract image parameter from Embedly URL
                    # Example: https://cdn.embedly.com/widgets/media.html?src=...&image=https://...jpg
                    image_match = re.search(r'image=([^&]+)', src)
                    if image_match:

                        poster = unquote(image_match.group(1))
                # Try to generate thumbnail for direct Bunny Stream (mediadelivery.net) videos
                elif 'mediadelivery.net' in src:
                    # Extract UUID from Bunny Stream URL
                    # Handles: /embed/546846/379a0e74... /embeded/546846/... or /play/546846/...
                    bunny_match = re.search(r'(?:embed(?:ed)?|play)/\d+/([a-f0-9-]+)', src)
                    if bunny_match:
                        uuid = bunny_match.group(1)
                        poster = f"https://thumbnails.mediadelivery.net/{uuid}.jpg"
            
            if not poster:
                poster = None
            
            # Resolve Embedly wrapper URLs to their inner video URL
            resolved_src = src
            if 'embedly.com' in src:
                # Extract the actual video URL from Embedly src parameter
                src_match = re.search(r'src=([^&]+)', src)
                if src_match:
                    inner_src = unquote(src_match.group(1))
                    # Verify it's a valid video URL before replacing
                    if inner_src and inner_src.startswith('http') and 'mediadelivery.net' in inner_src:
                        resolved_src = inner_src
            
            iframe_info.append({
                'src': resolved_src,
                'poster': poster
            })
        
        # Also extract from JSON-LD
        script_tags = soup.find_all('script', type='application/ld+json')
        patreon_thumbnail = None  # Store Patreon's own thumbnail URL
        for script in script_tags:
            try:
                json_data = json.loads(script.string or script.text)
                if isinstance(json_data, dict):
                    # Extract VideoObject embed URLs
                    if json_data.get('@type') == 'VideoObject':
                        embed_url = json_data.get('embedUrl')
                        thumbnail = json_data.get('thumbnailUrl')
                        if embed_url and embed_url not in [i['src'] for i in iframe_info]:
                            iframe_info.append({'src': embed_url, 'poster': thumbnail})
                    
                    # Also check Article type for Patreon's own thumbnail
                    if json_data.get('@type') == 'Article':
                        # Store Patreon's thumbnail for use with external video links
                        if not patreon_thumbnail:
                            patreon_thumbnail = json_data.get('thumbnailUrl') or json_data.get('image', {}).get('contentUrl')
                    
                    if '@graph' in json_data:
                        for item in json_data['@graph']:
                            if isinstance(item, dict) and item.get('@type') == 'VideoObject':
                                embed_url = item.get('embedUrl')
                                thumbnail = item.get('thumbnailUrl')
                                if embed_url and embed_url not in [i['src'] for i in iframe_info]:
                                    iframe_info.append({'src': embed_url, 'poster': thumbnail})
                            elif isinstance(item, dict) and item.get('@type') == 'Article':
                                if not patreon_thumbnail:
                                    patreon_thumbnail = item.get('thumbnailUrl') or item.get('image', {}).get('contentUrl')
            except (json.JSONDecodeError, AttributeError):
                continue
        
        # Extract video links from external platforms (reed.tv, yandex, etc.)
        # Look for links in <a> tags and script tags that point to known video platforms
        video_platforms = ['reed.tv', 'reedtv.com', 'yandex.ru', 'disk.yandex', 'yadi.sk']
        video_file_extensions = ['.mp4', '.mov', '.mkv', '.avi', '.wmv', '.webm', '.m3u8']
        
        # Also get Patreon's own og:image as fallback
        patreon_og_image = soup.find('meta', attrs={'property': 'og:image'})
        if patreon_og_image and not patreon_thumbnail:
            patreon_thumbnail = patreon_og_image.get('content', '').strip()
        
        # Check all <a> tags for video platform links or video file URLs
        for a_tag in soup.find_all('a', href=True):
            href = a_tag['href']
            if not href or href.startswith('javascript:') or href.startswith('#'):
                continue
                
            # Check if it's a known video platform
            is_video_platform = any(platform in href.lower() for platform in video_platforms)
            # Check if it's a direct video file URL
            is_video_file = any(ext in href.lower() for ext in video_file_extensions)
            # Check if it wraps an image (thumbnail links to video)
            wraps_image = a_tag.find('img') is not None
            
            if is_video_platform or is_video_file or (wraps_image and any(x in href.lower() for x in ['yandex', 'disk', 'video', 'stream', 'cdn'])):
                try:
                    # For platforms like yandex, use the href directly
                    if any(p in href.lower() for p in ['yandex', 'disk.yandex', 'yadi.sk']):
                        video_url = href
                    else:
                        video_url = resolve_video_url_from_link(href)
                    
                    if video_url and video_url not in [i['src'] for i in iframe_info]:
                        # Use Patreon's thumbnail as primary, then fetch from the link, then none
                        og_data = fetch_opengraph_metadata(href)
                        thumbnail = patreon_thumbnail or og_data.get('image') or og_data.get('thumbnail')
                        # If this link wraps an image, use that image as thumbnail
                        if wraps_image and not thumbnail:
                            img = a_tag.find('img')
                            img_src = img.get('src', '')
                            if img_src and img_src.startswith(('http:', 'https:')):
                                thumbnail = img_src
                        iframe_info.append({'src': video_url, 'poster': thumbnail})
                except Exception as e:
                    app.logger.warning(f"Failed to resolve video link {href}: {e}")
                    continue
        
        # Also check all script tags for video URLs (e.g., __NEXT_DATA__)
        for script in soup.find_all('script'):
            try:
                content = script.string or str(script)
                for platform in video_platforms:
                    if platform in content.lower():
                        # Extract all URLs from the script
                        urls = re.findall(r'https?://[^\s"\'<>\\]+', content)
                        for url in urls:
                            if platform in url.lower():
                                try:
                                    video_url = resolve_video_url_from_link(url)
                                    if video_url and video_url not in [i['src'] for i in iframe_info]:
                                        og_data = fetch_opengraph_metadata(url)
                                        thumbnail = patreon_thumbnail or og_data.get('image') or og_data.get('thumbnail')
                                        iframe_info.append({'src': video_url, 'poster': thumbnail})
                                except Exception as e:
                                    app.logger.warning(f"Failed to resolve {platform} URL {url}: {e}")
                                    continue
            except Exception:
                continue
        
        # Also check for OpenGraph video metadata directly in the Patreon post
        og_video = soup.find('meta', attrs={'property': 'og:video'})
        og_video_secure = soup.find('meta', attrs={'property': 'og:video:secure_url'})
        og_video_url = None
        if og_video:
            og_video_url = og_video.get('content', '').strip()
        if og_video_secure and not og_video_url:
            og_video_url = og_video_secure.get('content', '').strip()
        
        if og_video_url and og_video_url not in [i['src'] for i in iframe_info]:
            # Get thumbnail if available
            og_image = soup.find('meta', attrs={'property': 'og:image'})
            thumbnail = og_image.get('content', '').strip() if og_image else None
            iframe_info.append({'src': og_video_url, 'poster': thumbnail})
        
        # Extract post title
        title = soup.find('h1')
        if title:
            title_text = title.get_text().strip()
        else:
            title_tag = soup.find('meta', attrs={'property': 'og:title'})
            title_text = title_tag.get('content', '') if title_tag else ''
        
        # Deduplicate iframes that point to the same video
        # This handles cases where Patreon shows both an Embedly wrapper and direct iframe
        def get_video_key(url):
            """Extract a unique key from a video URL for deduplication."""
            if not url:
                return None
            
            # Decode URL-encoded characters for matching
            decoded_url = url
            try:
                decoded_url = unquote(url)
            except:
                pass
            
            # For mediadelivery.net/bunny.net URLs, extract the UUID
            # Direct URL: https://iframe.mediadelivery.net/play/519966/eef8245b-81f4-4bb5-b9ff-d811f2e616b2
            # Embed URL: https://iframe.mediadelivery.net/embed/519966/eef8245b-81f4-4bb5-b9ff-d811f2e616b2
            match = re.search(r'(?:iframe\.mediadelivery\.net|bunny\.net)/(?:embed(?:ed)?|play)/\d+/([a-f0-9-]+)', decoded_url)
            if match:
                return match.group(1)
            
            # For Embedly URLs, extract from src parameter
            # https://cdn.embedly.com/widgets/media.html?src=https://iframe.mediadelivery.net/embed/519966/UUID
            if 'embedly.com' in decoded_url:
                # Extract src parameter
                src_match = re.search(r'src=([^&]+)', decoded_url)
                if src_match:
                    src_url = unquote(src_match.group(1))
                    # Now extract UUID from the src URL
                    uuid_match = re.search(r'(?:iframe\.mediadelivery\.net|bunny\.net)/(?:embed(?:ed)?|play)/\d+/([a-f0-9-]+)', src_url)
                    if uuid_match:
                        return uuid_match.group(1)
            
            # For other platforms, use the URL itself
            return url.lower()
        
        # Keep only unique videos, preferring direct iframes over embedly wrappers
        seen_keys = {}
        deduped_iframe_info = []
        for info in iframe_info:
            key = get_video_key(info['src'])
            if key:
                # Prefer direct mediadelivery iframes over embedly wrappers
                is_direct = 'embedly.com' not in info['src']
                if key not in seen_keys:
                    seen_keys[key] = info
                    deduped_iframe_info.append(info)
                elif is_direct and 'embedly.com' in seen_keys[key]['src']:
                    # Replace embedly with direct iframe
                    deduped_iframe_info.remove(seen_keys[key])
                    seen_keys[key] = info
                    deduped_iframe_info.append(info)
            elif not key:  # If we can't extract a key, keep it anyway
                deduped_iframe_info.append(info)
        
        # Separate URLs and thumbnails for backwards compatibility
        # Normalize Bunny Stream URLs from /embed/ to /play/ format
        iframe_urls = [normalize_bunny_url(info['src']) for info in deduped_iframe_info]
        thumbnail_urls = [info['poster'] for info in deduped_iframe_info]
        
        return jsonify({
            'success': True,
            'url': url,
            'title': title_text,
            'iframes': iframe_urls,
            'thumbnails': thumbnail_urls,
            'iframe_count': len(deduped_iframe_info)
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'url': url
        }), 500


if __name__ == '__main__':
    print("=" * 60)
    print("ASMR Video Collection - Local Server")
    print("=" * 60)
    print("\nStarting server...")
    print("\n  Open your browser and go to:")
    print("  http://localhost:8000")
    print("\n  The server includes a CORS proxy for fetching")
    print("  thumbnails from any video site (YouTube, reedtv, etc.)")
    print("\n  Press Ctrl+C to stop the server")
    print("=" * 60)
    print()
    
    # Try to install required packages if missing
    try:
        import flask
        import flask_cors
        import bs4
        import requests
    except ImportError as e:
        print(f"Missing required package: {e}")
        print("\nInstalling required packages...")
        import subprocess
        import sys
        subprocess.check_call([sys.executable, "-m", "pip", "install", "flask", "flask-cors", "beautifulsoup4", "requests", "playwright"])
        print("\nInstalling Playwright browsers...")
        from playwright.__main__ import install
        install()
        print("\nPackages installed! Please run the server again.")
        sys.exit(1)
    
    app.run(host='0.0.0.0', port=8000, debug=False)
