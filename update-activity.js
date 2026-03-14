#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

const USERNAME = 'furkankoykiran';
const README_PATH = path.join(__dirname, 'README.md');
const ACTIVITY_START = '<!-- ACTIVITY_START -->';
const ACTIVITY_END = '<!-- ACTIVITY_END -->';
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

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

// Filter events from the last 48 hours
function filterRecentEvents(events) {
  const fortyEightHoursAgo = new Date(Date.now() - FORTY_EIGHT_HOURS_MS);
  return events.filter(event => {
    const eventDate = new Date(event.created_at);
    return eventDate >= fortyEightHoursAgo;
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
      const prTitle = pr.title || 'Untitled PR';
      const prUrl = pr.html_url || `${repoUrl}/pull/${prNumber}`;
      return `- **${date}** - ${capitalize(action)} PR [#${prNumber}](${prUrl}) in [${repo}](${repoUrl}): ${prTitle}`;
    }

    case 'IssuesEvent': {
      const issueAction = event.payload.action || 'updated';
      const issue = event.payload.issue || {};
      const issueNumber = issue.number || '?';
      const issueTitle = issue.title || 'Untitled Issue';
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
  const recentEvents = filterRecentEvents(events);

  if (recentEvents.length === 0) {
    return null; // No activity to report
  }

  // Format events and filter out nulls
  const formattedEvents = recentEvents
    .map(formatEvent)
    .filter(event => event !== null);

  if (formattedEvents.length === 0) {
    return null;
  }

  // Limit to 10 most recent events
  const limitedEvents = formattedEvents.slice(0, 10);

  return `${ACTIVITY_START}\n<!-- This section is automatically updated daily with recent GitHub activity -->\n\n${limitedEvents.join('\n')}\n\n${ACTIVITY_END}`;
}

// Get empty activity section content
function getEmptySection() {
  return `${ACTIVITY_START}\n<!-- This section is automatically updated daily with recent GitHub activity -->\n${ACTIVITY_END}`;
}

// Update README file
function updateReadme(activityContent) {
  const readme = fs.readFileSync(README_PATH, 'utf8');

  // Find the activity section
  const startIndex = readme.indexOf(ACTIVITY_START);
  const endIndex = readme.indexOf(ACTIVITY_END);

  if (startIndex === -1 || endIndex === -1) {
    console.error('Activity markers not found in README.md');
    process.exit(1);
  }

  // If no activity, check if section is already empty
  if (!activityContent) {
    const currentSection = readme.substring(startIndex, endIndex + ACTIVITY_END.length);
    const emptySection = getEmptySection();

    if (currentSection.trim() === emptySection.trim()) {
      console.log('No recent activity and section already empty. No changes needed.');
      return false;
    }

    activityContent = emptySection;
  }

  // Replace the content between markers
  const updatedReadme =
    readme.substring(0, startIndex) +
    activityContent +
    readme.substring(endIndex + ACTIVITY_END.length);

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

    const activityContent = generateActivityContent(events);

    if (!activityContent) {
      console.log('No meaningful activity in the last 48 hours');
      // Still update to clear the section if it has old content
      const readme = fs.readFileSync(README_PATH, 'utf8');
      const startIndex = readme.indexOf(ACTIVITY_START);
      const endIndex = readme.indexOf(ACTIVITY_END);

      if (startIndex !== -1 && endIndex !== -1) {
        const currentContent = readme.substring(startIndex, endIndex + ACTIVITY_END.length);
        const emptyContent = getEmptySection();

        if (currentContent !== emptyContent) {
          updateReadme(null);
        }
      }
      return;
    }

    const updated = updateReadme(activityContent);

    if (updated) {
      console.log('Activity section updated with recent events');
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
