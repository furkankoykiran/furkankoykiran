#!/usr/bin/env node

/**
 * Blog Posts Updater
 * Fetches recent blog posts from Jekyll RSS feed and updates README.md
 */

const https = require('https');
const fs = require('fs');

const BLOG_URL = 'https://blog.furkankoykiran.com.tr';
const RSS_FEED = `${BLOG_URL}/feed.xml`;
const README_PATH = './README.md';
const MAX_POSTS = 3;

// Parse RSS feed and extract blog posts
function parseRSSFeed(xml) {
    const items = [];

    // Match <item> tags and their content
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < MAX_POSTS) {
        const itemContent = match[1];

        // Extract title
        const titleMatch = itemContent.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
        const title = titleMatch ? titleMatch[1] : itemContent.match(/<title>(.*?)<\/title>/)?.[1] || 'Untitled';

        // Extract link
        const linkMatch = itemContent.match(/<link>(.*?)<\/link>/);
        const link = linkMatch ? linkMatch[1] : '';

        // Extract pubDate
        const dateMatch = itemContent.match(/<pubDate>(.*?)<\/pubDate>/);
        const pubDate = dateMatch ? new Date(dateMatch[1]) : new Date();

        // Extract description/excerpt
        const descMatch = itemContent.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/);
        let description = descMatch ? descMatch[1] : '';
        // Strip HTML tags from description
        description = description.replace(/<[^>]*>/g, '').trim();

        items.push({
            title,
            link,
            pubDate,
            description: description.substring(0, 100) + (description.length > 100 ? '...' : '')
        });
    }

    return items;
}

// Fetch RSS feed
function fetchRSSFeed(url) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Blog-Posts-Updater',
                'Accept': 'application/rss+xml, application/xml, text/xml'
            }
        };

        const req = https.get(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: Failed to fetch RSS feed`));
                }
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

// Format date for display
function formatDate(date) {
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Generate blog posts section
function generateBlogSection(posts) {
    if (!posts || posts.length === 0) {
        return `<table>
<tr>
<td><sub>📝 Check my blog at <a href="${BLOG_URL}">furkankoykiran.github.io</a></sub></td>
</tr>
</table>`;
    }

    let section = '<table>\n';

    posts.forEach(post => {
        const timeAgo = formatDate(post.pubDate);
        section += `<tr>
<td><a href="${post.link}"><strong>${post.title}</strong></a></td>
<td align="right"><sub>${timeAgo}</sub></td>
</tr>\n`;
    });

    section += `</table>
<p align="right"><sub><a href="${BLOG_URL}">View all posts →</a></sub></p>`;

    return section;
}

// Update README.md with blog posts
async function updateReadme() {
    console.log(`Fetching RSS feed from ${RSS_FEED}...`);

    try {
        const rssContent = await fetchRSSFeed(RSS_FEED);
        console.log('RSS feed fetched successfully');

        const posts = parseRSSFeed(rssContent);
        console.log(`Found ${posts.length} recent posts`);

        const readmeContent = fs.readFileSync(README_PATH, 'utf8');
        const blogSection = generateBlogSection(posts);
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

        const updatedContent = readmeContent.replace(
            /<!-- BLOG-POST-LIST:START -->[\s\S]*?<!-- BLOG-POST-LIST:END -->/,
            `<!-- BLOG-POST-LIST:START -->\n${blogSection}\n<!-- BLOG-POST-LIST:END -->`
        );

        if (readmeContent !== updatedContent) {
            fs.writeFileSync(README_PATH, updatedContent, 'utf8');
            console.log('README.md updated with blog posts!');
        } else {
            console.log('No changes to README.md');
        }
    } catch (error) {
        console.error('Error:', error.message);

        // On error, write a fallback message
        const readmeContent = fs.readFileSync(README_PATH, 'utf8');
        const fallbackSection = `<table>
<tr>
<td><sub><a href="${BLOG_URL}">📝 Visit my blog</a> | Latest posts temporarily unavailable</sub></td>
</tr>
</table>`;

        const updatedContent = readmeContent.replace(
            /<!-- BLOG-POST-LIST:START -->[\s\S]*?<!-- BLOG-POST-LIST:END -->/,
            `<!-- BLOG-POST-LIST:START -->\n${fallbackSection}\n<!-- BLOG-POST-LIST:END -->`
        );

        if (readmeContent !== updatedContent) {
            fs.writeFileSync(README_PATH, updatedContent, 'utf8');
            console.log('README.md updated with fallback message');
        }
    }
}

// Run
updateReadme();
