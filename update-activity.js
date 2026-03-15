#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

const USERNAME = 'furkankoykiran';
const README_PATH = path.join(__dirname, 'README.md');
const ACTIVITY_START = '<!-- ACTIVITY_START -->';
const ACTIVITY_END = '<!-- ACTIVITY_END -->';

// Helper function to safely get repo URL
function getRepoUrl(repoName) {
  return `https://github.com/${repoName}`;
}

// Helper function to capitalize first letter
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Fetch GitHub events for the user
function fetchGitHubEvents() {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'Node.js',
      'Accept': 'application/vnd.github+json'
    };

    // Add authorization if GITHUB_TOKEN is available
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const options = {
      hostname: 'api.github.com',
      path: `/users/${USERNAME}/events/public?per_page=100`,
      method: 'GET',
      headers: headers
    };

    https.get(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Failed to parse GitHub API response: ${error.message}`));
          }
        } else if (res.statusCode === 403) {
          console.warn('GitHub API rate limit reached. Skipping update.');
          resolve([]); // Return empty array instead of failing
        } else {
          reject(new Error(`GitHub API returned status ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Format event to a readable string
function formatEvent(event) {
  const date = new Date(event.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });

  const repo = event.repo.name;
  const repoUrl = getRepoUrl(repo);

  switch (event.type) {
    case 'PushEvent':
      const commitCount = event.payload.commits?.length || 0;
      // Skip events with zero commits (empty pushes)
      if (commitCount === 0) {
        return null;
      }
      const branch = event.payload.ref?.replace('refs/heads/', '') || 'branch';
      return `- **${date}** - Pushed ${commitCount} commit${commitCount !== 1 ? 's' : ''} to \`${branch}\` in [${repo}](${repoUrl})`;

    case 'PullRequestEvent': {
      const action = event.payload.action || 'updated';
      const pr = event.payload.pull_request || {};
      const prNumber = pr.number || '?';
      const prTitle = pr.title || `PR #${prNumber}`;
      const prUrl = pr.html_url || `${repoUrl}/pull/${prNumber}`;
      return `- **${date}** - ${capitalize(action)} PR [#${prNumber}](${prUrl}) in [${repo}](${repoUrl}): ${prTitle}`;
    }

    case 'IssuesEvent': {
      const issueAction = event.payload.action || 'updated';
      const issue = event.payload.issue || {};
      const issueNumber = issue.number || '?';
      const issueTitle = issue.title || `Issue #${issueNumber}`;
      const issueUrl = issue.html_url || `${repoUrl}/issues/${issueNumber}`;
      return `- **${date}** - ${capitalize(issueAction)} issue [#${issueNumber}](${issueUrl}) in [${repo}](${repoUrl}): ${issueTitle}`;
    }

    case 'IssueCommentEvent': {
      const comment = event.payload.comment || {};
      const issue = event.payload.issue || {};
      const commentIssueNumber = issue.number || '?';
      const commentUrl = comment.html_url || `${repoUrl}/issues/${commentIssueNumber}`;
      return `- **${date}** - Commented on issue [#${commentIssueNumber}](${commentUrl}) in [${repo}](${repoUrl})`;
    }

    case 'PullRequestReviewEvent': {
      const review = event.payload.review || {};
      const reviewPr = event.payload.pull_request || {};
      const reviewPrNumber = reviewPr.number || '?';
      const reviewUrl = review.html_url || `${repoUrl}/pull/${reviewPrNumber}`;
      return `- **${date}** - Reviewed PR [#${reviewPrNumber}](${reviewUrl}) in [${repo}](${repoUrl})`;
    }

    case 'PullRequestReviewCommentEvent': {
      const prComment = event.payload.comment || {};
      const prCommentPr = event.payload.pull_request || {};
      const commentPrNumber = prCommentPr.number || '?';
      const prCommentUrl = prComment.html_url || `${repoUrl}/pull/${commentPrNumber}`;
      return `- **${date}** - Commented on PR [#${commentPrNumber}](${prCommentUrl}) in [${repo}](${repoUrl})`;
    }

    case 'CreateEvent': {
      const refType = event.payload.ref_type || 'repository';
      const ref = event.payload.ref || '';
      return `- **${date}** - Created ${refType}${ref ? ` \`${ref}\`` : ''} in [${repo}](${repoUrl})`;
    }

    case 'ForkEvent':
      return `- **${date}** - Forked [${repo}](${repoUrl})`;

    case 'WatchEvent':
      return `- **${date}** - Starred [${repo}](${repoUrl})`;

    case 'ReleaseEvent': {
      const release = event.payload.release || {};
      const releaseName = release.name || release.tag_name || 'Release';
      const releaseUrl = release.html_url || `${repoUrl}/releases`;
      return `- **${date}** - Published release [${releaseName}](${releaseUrl}) in [${repo}](${repoUrl})`;
    }

    default:
      return null;
  }
}

// Generate activity content
function generateActivityContent(events) {
  if (events.length === 0) {
    return null; // No activity to report
  }

  // Format events and filter out nulls
  const formattedEvents = events
    .map(formatEvent)
    .filter(event => event !== null);

  if (formattedEvents.length === 0) {
    return null;
  }

  // Limit to 20 most recent events
  const limitedEvents = formattedEvents.slice(0, 20);

  return `${ACTIVITY_START}\n<!-- This section is automatically updated daily with recent GitHub activity -->\n\n${limitedEvents.join('\n')}\n\n${ACTIVITY_END}`;
}

// Fetch blog posts from RSS feed
function fetchBlogPosts() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'blog.furkankoykiran.com.tr',
      path: '/feed.xml',
      method: 'GET',
      headers: {
        'User-Agent': 'Node.js'
      }
    };

    https.get(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            // Parse RSS items using regex
            const items = [];
            const itemRegex = /<item>([\s\S]*?)<\/item>/g;
            let match;
            let count = 0;

            while ((match = itemRegex.exec(data)) !== null && count < 5) {
              const itemContent = match[1];
              const titleMatch = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/s.exec(itemContent);
              const linkMatch = /<link>(.*?)<\/link>/.exec(itemContent);
              const pubDateMatch = /<pubDate>(.*?)<\/pubDate>/.exec(itemContent);

              if (titleMatch && linkMatch) {
                const title = titleMatch[2] || titleMatch[1];
                const link = linkMatch[1];
                const pubDate = pubDateMatch ? new Date(pubDateMatch[1]).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric'
                }) : '';

                items.push({ title, link, pubDate });
                count++;
              }
            }
            resolve(items);
          } catch (error) {
            reject(new Error(`Failed to parse blog feed: ${error.message}`));
          }
        } else {
          reject(new Error(`Blog feed returned status ${res.statusCode}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Format blog posts as markdown
function formatBlogPosts(posts) {
  if (!posts || posts.length === 0) {
    return '<!-- No blog posts found -->';
  }
  return posts.map(post =>
    `- [${post.title}](${post.link}) ${post.pubDate ? `(${post.pubDate})` : ''}`
  ).join('\n');
}

// Get empty activity section content
function getEmptyActivitySection() {
  return `${ACTIVITY_START}\n<!-- This section is automatically updated daily with recent GitHub activity -->\n${ACTIVITY_END}`;
}

// Update README file with both activity and blog sections
function updateReadmeSections(activityContent, blogContent) {
  const readme = fs.readFileSync(README_PATH, 'utf8');
  let updatedReadme = readme;

  // Update activity section
  const activityStartIndex = readme.indexOf(ACTIVITY_START);
  const activityEndIndex = readme.indexOf(ACTIVITY_END);

  if (activityStartIndex === -1 || activityEndIndex === -1) {
    console.error('Activity markers not found in README.md');
    process.exit(1);
  }

  const activitySection = activityContent || getEmptyActivitySection();
  updatedReadme =
    updatedReadme.substring(0, activityStartIndex) +
    activitySection +
    updatedReadme.substring(activityEndIndex + ACTIVITY_END.length);

  // Update blog section
  const blogStart = '<!-- BLOG_START -->';
  const blogEnd = '<!-- BLOG_END -->';
  const blogStartIndex = updatedReadme.indexOf(blogStart);
  const blogEndIndex = updatedReadme.indexOf(blogEnd);

  if (blogStartIndex !== -1 && blogEndIndex !== -1) {
    updatedReadme =
      updatedReadme.substring(0, blogStartIndex) +
      blogContent +
      updatedReadme.substring(blogEndIndex + blogEnd.length);
  } else {
    console.warn('Blog markers not found in README.md - skipping blog section update');
  }

  // Check if content actually changed
  if (readme === updatedReadme) {
    console.log('No changes needed to README.md');
    return false;
  }

  fs.writeFileSync(README_PATH, updatedReadme, 'utf8');
  console.log('README.md updated successfully!');
  return true;
}

// Main function
async function main() {
  try {
    console.log('Fetching GitHub events...');
    const events = await fetchGitHubEvents();

    console.log(`Found ${events.length} total events`);

    // Generate activity content
    const activityContent = generateActivityContent(events);

    // Fetch blog posts
    let blogContent = '<!-- BLOG_START -->\n<!-- This section is automatically updated with recent blog posts from personal blog -->\n<!-- BLOG_END -->';
    try {
      console.log('Fetching blog posts...');
      const posts = await fetchBlogPosts();
      if (posts.length > 0) {
        console.log(`Found ${posts.length} blog posts`);
        const formattedPosts = formatBlogPosts(posts);
        blogContent = `<!-- BLOG_START -->\n<!-- This section is automatically updated with recent blog posts from personal blog -->\n\n${formattedPosts}\n\n<!-- BLOG_END -->`;
      } else {
        console.log('No blog posts found');
      }
    } catch (blogError) {
      console.warn('Failed to fetch blog posts:', blogError.message);
    }

    // Update README
    const updated = updateReadmeSections(activityContent, blogContent);

    if (updated) {
      console.log('Sections updated successfully');
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
