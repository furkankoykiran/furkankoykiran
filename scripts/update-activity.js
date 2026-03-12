#!/usr/bin/env node

/**
 * GitHub Activity Updater
 * Fetches recent GitHub events and updates README.md with activity table
 */

const https = require('https');

const USERNAME = 'furkankoykiran';
const README_PATH = './README.md';
const README_ENCODING = 'utf8';

// GitHub API configuration
const API_HOST = 'api.github.com';
const EVENTS_PATH = `/users/${USERNAME}/events/public`;

// Date formatting
function formatDate(date) {
    const now = new Date();
    const diff = now - date;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Parse repo name from repo URL
function parseRepoName(repoUrl) {
    const match = repoUrl.match(/repos\/(.+)$/);
    return match ? match[1].split('/')[1] : 'unknown';
}

// Get emoji for event type
function getEventEmoji(type) {
    const emojis = {
        'PushEvent': '📝',
        'CreateEvent': '🆕',
        'DeleteEvent': '🗑️',
        'WatchEvent': '⭐',
        'ForkEvent': '🔱',
        'IssuesEvent': '🐛',
        'IssueCommentEvent': '💬',
        'PullRequestEvent': '🔄',
        'PullRequestReviewEvent': '👀',
        'ReleaseEvent': '🎉',
        'MemberEvent': '👥'
    };
    return emojis[type] || '📌';
}

// Format event description
function formatEvent(event) {
    const type = event.type;
    const repo = event.repo.name;
    const repoName = repo.split('/')[1];

    switch (type) {
        case 'PushEvent':
            const commits = event.payload?.commits?.length || 0;
            return `Pushed ${commits} commit${commits > 1 ? 's' : ''} to`;
        case 'CreateEvent':
            const refType = event.payload?.ref_type || 'branch';
            return `Created ${refType} in`;
        case 'DeleteEvent':
            return `Deleted branch in`;
        case 'WatchEvent':
            return `Starred`;
        case 'ForkEvent':
            return `Forked`;
        case 'IssuesEvent':
            const action = event.payload?.action || 'opened';
            return `${action.charAt(0).toUpperCase() + action.slice(1)} issue in`;
        case 'IssueCommentEvent':
            return `Commented on issue in`;
        case 'PullRequestEvent':
            const prAction = event.payload?.action || 'opened';
            const prNumber = event.payload?.pull_request?.number || '';
            return `${prAction.charAt(0).toUpperCase() + prAction.slice(1)} PR #${prNumber} in`;
        case 'PullRequestReviewEvent':
            return `Reviewed PR in`;
        case 'ReleaseEvent':
            const tagName = event.payload?.release?.tag_name || '';
            return `Released ${tagName} in`;
        default:
            return `Activity in`;
    }
}

// Fetch GitHub events
function fetchEvents() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: API_HOST,
            path: EVENTS_PATH,
            method: 'GET',
            headers: {
                'User-Agent': 'GitHub-Activity-Updater',
                'Accept': 'application/vnd.github.v3+json'
            }
        };

        // Add auth token if available
        if (process.env.GITHUB_TOKEN) {
            options.headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
        }

        const req = https.get(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${e.message}`));
                    }
                } else if (res.statusCode === 403 || res.statusCode === 429) {
                    // Rate limited - return empty array
                    console.warn('Rate limited, returning empty activity');
                    resolve([]);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

// Generate activity table
function generateActivityTable(events) {
    if (!events || events.length === 0) {
        return `<table>
<tr>
<td><sub>🔄 No recent activity</sub></td>
</tr>
</table>`;
    }

    // Filter events from last 7 days and limit to 10
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentEvents = events
        .filter(e => new Date(e.created_at) > oneWeekAgo)
        .slice(0, 10);

    if (recentEvents.length === 0) {
        return `<table>
<tr>
<td><sub>🔄 No activity in the past week</sub></td>
</tr>
</table>`;
    }

    let table = '<table>\n';

    recentEvents.forEach(event => {
        const emoji = getEventEmoji(event.type);
        const description = formatEvent(event);
        const repo = event.repo.name;
        const repoUrl = `https://github.com/${repo}`;
        const time = formatDate(new Date(event.created_at));

        table += `<tr>
<td>${emoji} ${description} <a href="${repoUrl}">${repo.split('/')[1]}</a></td>
<td align="right"><sub>${time}</sub></td>
</tr>\n`;
    });

    table += '</table>';

    return table;
}

// Update README.md
async function updateReadme() {
    const fs = require('fs');

    console.log(`Fetching events for ${USERNAME}...`);

    try {
        const events = await fetchEvents();
        console.log(`Fetched ${events.length} events`);

        const readmeContent = fs.readFileSync(README_PATH, README_ENCODING);
        const activityTable = generateActivityTable(events);
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

        const updatedContent = readmeContent.replace(
            /<!-- ACTIVITY_START -->[\s\S]*<!-- ACTIVITY_END -->/,
            `<!-- ACTIVITY_START -->\n${activityTable}\n\n<sub>Last updated: ${timestamp}</sub>\n<!-- ACTIVITY_END -->`
        );

        if (readmeContent !== updatedContent) {
            fs.writeFileSync(README_PATH, updatedContent, README_ENCODING);
            console.log('README.md updated successfully!');
        } else {
            console.log('No changes to README.md');
        }
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

// Run
updateReadme();
