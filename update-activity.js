#!/usr/bin/env node
/**
 * Refreshes the generated sections of the profile README.
 *
 * Each section lives between `<!-- NAME_START -->` and `<!-- NAME_END -->`:
 *   ACTIVITY       recent public GitHub events
 *   BLOG           latest posts from the blog feeds
 *   FEATURED       curated projects with live language and star count
 *   CONTRIBUTIONS  merged pull requests to other public projects
 *
 * A section whose source fails keeps its previous content. Requires Node 18+
 * (global fetch). GITHUB_TOKEN is needed for the GraphQL sections.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const USERNAME = process.env.GITHUB_REPOSITORY_OWNER || 'furkankoykiran';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const README_PATH = path.join(__dirname, 'README.md');
const TIME_ZONE = 'Europe/Istanbul';
const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = `${USERNAME}-profile-readme`;

const PORTFOLIO_URL = 'https://furkankoykiran.com.tr';
const BLOG_URL = 'https://blog.furkankoykiran.com.tr';

/**
 * Feeds in order of preference; the first one that yields posts is used. Every
 * post exists in both languages, so the English feed alone is complete.
 */
const BLOG_FEEDS = ['/en/feed.xml', '/feed.xml'];
const BLOG_POST_COUNT = 5;

const ACTIVITY_COUNT = 20;

/** Merged PRs count only for public repositories with at least this many stars. */
const CONTRIB_MIN_STARS = 100;
const CONTRIB_MAX_REPOS = 8;
const CONTRIB_PRS_PER_REPO = 2;

/** Featured projects. `slug` is the portfolio page; language and stars are read live. */
const FEATURED = [
  { repo: 'DevTo-MCP', slug: 'devto-mcp', blurb: 'MCP server for the DEV Community (Forem) API: articles, comments, tags and reading lists. Published on npm.' },
  { repo: 'freqtrade-mcp', slug: 'freqtrade-mcp', blurb: 'Lets AI agents query and control a Freqtrade trading bot through its REST API.' },
  { repo: 'OmniWire-MCP', slug: 'omniwire-mcp', blurb: 'Fault-tolerant news MCP server that normalises RSS, Atom, JSON and HTML feeds behind circuit breakers.' },
  { repo: '.claude', slug: 'claude', label: 'claude-code-toolkit', blurb: 'One-command, reproducible Claude Code setup; every skill is pinned to a reviewed commit.' },
  { repo: 'awesome-trending-repos', slug: 'awesome-trending-repos', blurb: 'Daily curated list of trending GitHub repositories with a live dashboard, run entirely on GitHub Actions.' },
  { repo: 'Quorum', slug: 'quorum', blurb: 'Multi-agent trading committee: agents debate and vote on every trade, with Shapley-based profit attribution.' },
  { repo: 'telegram-wallet-p2p-sdk', slug: 'telegram-wallet-p2p-sdk', blurb: 'Python, Node.js and MCP clients for the Telegram Wallet P2P market: listings, best prices and spread analytics.' },
  { repo: 'ai-face-detector', slug: 'ai-face-detector', blurb: 'MobileNetV2 transfer-learning model that tells AI-generated faces from real ones, served with FastAPI.' },
  { repo: 'EarthquakeSim', slug: 'earthquakesim', blurb: 'Browser-based 3D earthquake emergency training simulator with aftershocks, scoring and CSV reports.' },
];

/**
 * Names that must never appear on the profile, stored as SHA-256 of the
 * lower-cased name plus its length so this public file does not spell them out.
 */
const BLOCKED = [
  { len: 8, sha256: '4dadda0846ca8491009320c19b5a3469bcd2b9822d7749ab7580b7c54336299d' },
  { len: 7, sha256: 'd0602b4f193e8cf55e584817cdcf2c7a6ba6a77f93c78ac29647e53bb436a001' },
  { len: 8, sha256: '6a0332bd9c518579989d3d5569d44dfe12cc753793823cd8ab6abcc10c5aa5c0' },
  { len: 8, sha256: 'e53600ce8fc296f5bb505ed4c32447a411ad5aef05f75abfe0ac9da8ab24726f' },
  { len: 8, sha256: '4f80d5aa8e7d7223c6ef051eb9aa50c5672c6c488f015d81fde7e7eff35c18b5' },
  { len: 9, sha256: 'eadd4c57780af1c3b6d83f94e3f53b33c757f8c54303436417b28bc912521b04' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * True when any of the given texts contains a blocked name (case-insensitive).
 * @param {...unknown} texts
 * @returns {boolean}
 */
function isBlocked(...texts) {
  for (const text of texts) {
    if (!text) continue;
    const lower = String(text).toLowerCase();
    for (const { len, sha256 } of BLOCKED) {
      for (let i = 0; i + len <= lower.length; i++) {
        const digest = crypto.createHash('sha256').update(lower.slice(i, i + len)).digest('hex');
        if (digest === sha256) return true;
      }
    }
  }
  return false;
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/** "Oct 23", or "Oct 23, 2026" with `withYear`, in TIME_ZONE so every run agrees. */
function formatDate(value, withYear = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: TIME_ZONE, ...(withYear && { year: 'numeric' }),
  });
}

function formatStars(count) {
  return count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(count);
}

/** "fix(mcp): split header value (#12)" -> "Split header value" */
function cleanPrTitle(title) {
  return capitalize(title
    .replace(/^\s*[\w-]+(\([^)]*\))?!?:\s*/, '')
    .replace(/\s*\((issue\s*)?#\d+\)\s*$/i, '')
    .replace(/[[\]]/g, ''));
}

/**
 * fetch() with a timeout that throws on any non-2xx status.
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
async function request(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, ...init.headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return res;
}

/** Headers for the GitHub API; authenticated when a token is available. */
function githubHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    ...(GITHUB_TOKEN && { Authorization: `Bearer ${GITHUB_TOKEN}` }),
  };
}

/**
 * Runs a GitHub GraphQL query.
 * @param {string} query
 * @param {Record<string, unknown>} [variables]
 * @returns {Promise<any>} the `data` object
 */
async function graphql(query, variables = {}) {
  if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not set');
  const res = await request('https://api.github.com/graphql', {
    method: 'POST',
    headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(`GraphQL: ${JSON.stringify(body.errors).slice(0, 300)}`);
  return body.data;
}

// ---------------------------------------------------------------------------
// Recent activity
// ---------------------------------------------------------------------------

/**
 * Formats one public event as a Markdown list item, or null to skip it.
 * The events API no longer includes commits or PR titles, so lines stay short.
 * @param {any} event
 * @returns {string | null}
 */
function formatEvent(event) {
  const date = formatDate(event.created_at);
  const repo = event.repo.name;
  const repoLink = `[${repo}](https://github.com/${repo})`;
  const payload = event.payload || {};

  switch (event.type) {
    case 'PushEvent':
      return `- **${date}** - Pushed to ${repoLink}`;

    case 'PullRequestEvent': {
      const pr = payload.pull_request || {};
      const number = payload.number || pr.number;
      if (!number) return null;
      const action = payload.action === 'closed' && pr.merged ? 'merged' : payload.action || 'updated';
      const url = pr.html_url || `https://github.com/${repo}/pull/${number}`;
      const title = pr.title ? `: ${pr.title}` : '';
      return `- **${date}** - ${capitalize(action)} PR [#${number}](${url}) in ${repoLink}${title}`;
    }

    case 'IssuesEvent': {
      const issue = payload.issue || {};
      if (!issue.number) return null;
      const url = issue.html_url || `https://github.com/${repo}/issues/${issue.number}`;
      const title = issue.title ? `: ${issue.title}` : '';
      return `- **${date}** - ${capitalize(payload.action || 'updated')} issue [#${issue.number}](${url}) in ${repoLink}${title}`;
    }

    case 'IssueCommentEvent': {
      const issue = payload.issue || {};
      if (!issue.number) return null;
      const kind = issue.pull_request ? 'PR' : 'issue';
      const url = (payload.comment && payload.comment.html_url) || issue.html_url;
      return `- **${date}** - Commented on ${kind} [#${issue.number}](${url}) in ${repoLink}`;
    }

    case 'PullRequestReviewEvent': {
      const pr = payload.pull_request || {};
      if (!pr.number) return null;
      const url = (payload.review && payload.review.html_url) || `https://github.com/${repo}/pull/${pr.number}`;
      return `- **${date}** - Reviewed PR [#${pr.number}](${url}) in ${repoLink}`;
    }

    case 'CreateEvent':
      // Branch and tag creation is noise; only new repositories are listed.
      return payload.ref_type === 'repository' ? `- **${date}** - Created repository ${repoLink}` : null;

    case 'ForkEvent':
      return `- **${date}** - Forked ${repoLink}`;

    case 'WatchEvent':
      return `- **${date}** - Starred ${repoLink}`;

    case 'ReleaseEvent': {
      const release = payload.release || {};
      const name = release.name || release.tag_name || 'a release';
      const url = release.html_url || `https://github.com/${repo}/releases`;
      return `- **${date}** - Published release [${name}](${url}) in ${repoLink}`;
    }

    default:
      return null;
  }
}

/**
 * Builds the activity list from the user's public events.
 * Private events and events on the profile repository itself (the daily README
 * commit) are skipped; identical lines on the same day (repeated pushes) are collapsed.
 * @returns {Promise<string>}
 */
async function buildActivity() {
  const res = await request(`https://api.github.com/users/${USERNAME}/events/public?per_page=100`, {
    headers: githubHeaders(),
  });
  const events = await res.json();
  const profileRepo = `${USERNAME}/${USERNAME}`.toLowerCase();

  const lines = [...new Set(events
    // A personal token also returns events from private repositories; drop them.
    .filter((event) => event.public && event.repo && event.repo.name.toLowerCase() !== profileRepo)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .filter((event) => !isBlocked(event.repo.name))
    .map(formatEvent)
    .filter((line) => line && !isBlocked(line)))]
    .slice(0, ACTIVITY_COUNT);

  if (lines.length === 0) throw new Error('no public events to show');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Blog posts
// ---------------------------------------------------------------------------

/** Decodes CDATA and the XML entities a feed title or link can carry. */
function decodeXml(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Parses an Atom or RSS 2.0 feed into posts.
 * @param {string} xml
 * @returns {{ title: string, link: string, time: number }[]}
 */
function parseFeed(xml) {
  const tag = (block, name) => {
    const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(block);
    return m ? decodeXml(m[1]) : '';
  };
  const blocks = (name) => [...xml.matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1]);

  const atom = blocks('entry').map((entry) => {
    // Prefer rel="alternate"; a link without rel is also an alternate link.
    const links = [...entry.matchAll(/<link\b([^>]*)\/?>/g)].map((m) => m[1]);
    const alternate = links.find((attrs) => /rel=["']alternate["']/.test(attrs))
      || links.find((attrs) => !/rel=/.test(attrs));
    const href = alternate && /href=["']([^"']+)["']/.exec(alternate);
    return { title: tag(entry, 'title'), link: href ? decodeXml(href[1]) : '', date: tag(entry, 'published') || tag(entry, 'updated') };
  });
  const rss = atom.length ? [] : blocks('item').map((item) => ({
    title: tag(item, 'title'), link: tag(item, 'link'), date: tag(item, 'pubDate'),
  }));

  return [...atom, ...rss]
    .filter((post) => post.title && post.link)
    .map(({ title, link, date }) => ({ title, link, time: new Date(date).getTime() || 0 }));
}

/**
 * Builds the latest-posts list from the first feed in BLOG_FEEDS that can be
 * read and has posts.
 * @returns {Promise<string>}
 */
async function buildBlog() {
  let posts = [];
  for (const feed of BLOG_FEEDS) {
    try {
      const res = await request(`${BLOG_URL}${feed}`);
      posts = parseFeed(await res.text()).filter((post) => !isBlocked(post.title, post.link));
    } catch (err) {
      console.warn(`  skipped feed: ${err.message}`);
    }
    if (posts.length) break;
  }
  if (posts.length === 0) throw new Error('no blog posts could be read');
  return posts.sort((a, b) => b.time - a.time).slice(0, BLOG_POST_COUNT).map((post) => {
    const date = post.time ? ` (${formatDate(post.time, true)})` : '';
    return `- [${post.title}](${post.link})${date}`;
  }).join('\n');
}

// ---------------------------------------------------------------------------
// Featured projects and contributions (GraphQL)
// ---------------------------------------------------------------------------

/**
 * Builds the featured-projects list with live language and star count.
 * Private or missing repositories are left out.
 * @returns {Promise<string>}
 */
async function buildFeatured() {
  const fields = 'url isPrivate stargazerCount primaryLanguage { name }';
  const query = `{ ${FEATURED.map((project, i) =>
    `r${i}: repository(owner: "${USERNAME}", name: "${project.repo}") { ${fields} }`).join(' ')} }`;
  const data = await graphql(query);

  const lines = FEATURED.map((project, i) => {
    const repo = data[`r${i}`];
    if (!repo || repo.isPrivate || isBlocked(project.repo, project.blurb)) return null;
    const meta = [
      repo.primaryLanguage && repo.primaryLanguage.name,
      repo.stargazerCount ? `★ ${formatStars(repo.stargazerCount)}` : null,
    ].filter(Boolean).join(' · ');
    const details = `${PORTFOLIO_URL}/en/projects/${project.slug}/`;
    return `- **[${project.label || project.repo}](${repo.url})**${meta ? ` (${meta})` : ''}: ${project.blurb} [Details →](${details})`;
  }).filter(Boolean);

  if (lines.length === 0) throw new Error('no featured repository resolved');
  return lines.join('\n');
}

const MERGED_PRS_QUERY = `query($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { title url mergedAt
      repository { nameWithOwner url isPrivate stargazerCount description owner { login } } } }
  }
}`;

/**
 * Builds the contributions list: merged PRs to other people's public projects,
 * grouped by repository and ordered by the repository's stars.
 * @returns {Promise<string>}
 */
async function buildContributions() {
  const q = `author:${USERNAME} is:pr is:merged is:public -user:${USERNAME}`;
  const prs = [];
  let cursor = null;
  do {
    const { search } = await graphql(MERGED_PRS_QUERY, { q, cursor });
    prs.push(...search.nodes.filter(Boolean));
    cursor = search.pageInfo.hasNextPage ? search.pageInfo.endCursor : null;
  } while (cursor);

  const qualifying = prs.filter(({ repository: repo, title }) => !repo.isPrivate
    && repo.owner.login.toLowerCase() !== USERNAME.toLowerCase()
    && repo.stargazerCount >= CONTRIB_MIN_STARS
    && !isBlocked(repo.nameWithOwner, title, repo.description))
    .sort((a, b) => new Date(b.mergedAt) - new Date(a.mergedAt));
  if (qualifying.length === 0) throw new Error('no qualifying merged pull requests');

  const byRepo = new Map();
  for (const pr of qualifying) {
    const key = pr.repository.nameWithOwner;
    if (!byRepo.has(key)) byRepo.set(key, { repo: pr.repository, prs: [] });
    byRepo.get(key).prs.push(pr);
  }
  const groups = [...byRepo.values()].sort((a, b) => b.repo.stargazerCount - a.repo.stargazerCount);

  const lines = groups.slice(0, CONTRIB_MAX_REPOS).map(({ repo, prs: list }) => {
    const links = list.slice(0, CONTRIB_PRS_PER_REPO).map((pr) => `[${cleanPrTitle(pr.title)}](${pr.url})`).join(' · ');
    const more = list.length > CONTRIB_PRS_PER_REPO ? ` · +${list.length - CONTRIB_PRS_PER_REPO} more` : '';
    return `- **[${repo.nameWithOwner}](${repo.url})** ★ ${formatStars(repo.stargazerCount)}: ${links}${more}`;
  });
  lines.push('', `**${qualifying.length} merged pull requests across ${groups.length} open-source projects.** `
    + `Full list: [furkankoykiran.com.tr/en/contributions](${PORTFOLIO_URL}/en/contributions/)`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// README update
// ---------------------------------------------------------------------------

/**
 * Replaces the text between `<!-- NAME_START -->` and `<!-- NAME_END -->`.
 * Returns the README unchanged when the markers are missing.
 * @param {string} readme
 * @param {string} name
 * @param {string} body
 * @returns {string}
 */
function replaceSection(readme, name, body) {
  const start = `<!-- ${name}_START -->`;
  const end = `<!-- ${name}_END -->`;
  const i = readme.indexOf(start);
  const j = readme.indexOf(end);
  if (i === -1 || j < i) {
    console.warn(`${name}: markers not found in README.md, skipped`);
    return readme;
  }
  return `${readme.slice(0, i)}${start}\n${body}\n${end}${readme.slice(j + end.length)}`;
}

const SECTIONS = [
  ['ACTIVITY', buildActivity],
  ['BLOG', buildBlog],
  ['FEATURED', buildFeatured],
  ['CONTRIBUTIONS', buildContributions],
];

async function main() {
  const original = fs.readFileSync(README_PATH, 'utf8');
  let readme = original;

  for (const [name, build] of SECTIONS) {
    try {
      readme = replaceSection(readme, name, await build());
      console.log(`${name}: updated`);
    } catch (err) {
      console.warn(`${name}: kept previous content (${err.message})`);
    }
  }

  if (isBlocked(readme)) {
    console.error('README would contain a blocked name; nothing written.');
    process.exitCode = 1;
    return;
  }
  if (readme === original) {
    console.log('README.md is already up to date.');
    return;
  }
  fs.writeFileSync(README_PATH, readme, 'utf8');
  console.log('README.md written.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { formatEvent, parseFeed, isBlocked, replaceSection };
