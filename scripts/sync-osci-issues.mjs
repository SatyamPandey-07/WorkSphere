/**
 * Bulk triage script:
 * 1. Ensures label "OSCI'26" exists.
 * 2. Fetches all open issues in the repository.
 * 3. Applies "OSCI'26" to every open issue that does not already have it.
 * 4. Removes all assignees from every open issue to make them unassigned.
 *
 * Usage:
 *   GITHUB_TOKEN="ghp_xxx" node scripts/sync-osci-issues.mjs [--dry-run]
 */

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const OWNER = process.env.GITHUB_OWNER || 'SatyamPandey-07';
const REPO = process.env.GITHUB_REPO || 'WorkSphere';
const TARGET_LABEL = "OSCI'26";
const isDryRun = process.argv.includes('--dry-run');

if (!GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN or GH_TOKEN environment variable is required.');
  console.error('Example: GITHUB_TOKEN="ghp_xxx" node scripts/sync-osci-issues.mjs');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'WorkSphere-OSCI-Sync-Script'
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function ensureLabel() {
  const getRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/labels/${encodeURIComponent(TARGET_LABEL)}`, { headers });
  if (getRes.status === 200) {
    console.log(`Label "${TARGET_LABEL}" already exists in ${OWNER}/${REPO}.`);
    return;
  }
  if (getRes.status === 404) {
    console.log(`Creating label "${TARGET_LABEL}"...`);
    if (!isDryRun) {
      const createRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/labels`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: TARGET_LABEL,
          color: '5319e7',
          description: "Open Source Contribution Initiative '26"
        })
      });
      if (!createRes.ok) {
        throw new Error(`Failed to create label: ${createRes.status} ${await createRes.text()}`);
      }
      console.log(`Label "${TARGET_LABEL}" created successfully.`);
    }
  }
}

async function fetchAllOpenIssues() {
  let page = 1;
  let allIssues = [];
  while (true) {
    console.log(`Fetching open issues page ${page}...`);
    const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/issues?state=open&per_page=100&page=${page}`, { headers });
    if (!res.ok) {
      throw new Error(`Failed to fetch issues: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    allIssues = allIssues.concat(data);
    if (data.length < 100) break;
    page++;
  }
  return allIssues.filter(item => !item.pull_request);
}

async function addLabelToIssue(issueNumber) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/issues/${issueNumber}/labels`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels: [TARGET_LABEL] })
  });
  if (!res.ok) {
    throw new Error(`Failed to add label to issue #${issueNumber}: ${res.status} ${await res.text()}`);
  }
}

async function removeAssigneesFromIssue(issueNumber, assignees) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/issues/${issueNumber}/assignees`, {
    method: 'DELETE',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignees })
  });
  if (!res.ok) {
    throw new Error(`Failed to remove assignees from issue #${issueNumber}: ${res.status} ${await res.text()}`);
  }
}

async function run() {
  console.log(`Starting bulk issue sync for ${OWNER}/${REPO} (Dry run: ${isDryRun})...`);
  await ensureLabel();

  const openIssues = await fetchAllOpenIssues();
  console.log(`Found ${openIssues.length} open issues.`);

  let labeledCount = 0;
  let unassignedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < openIssues.length; i++) {
    const issue = openIssues[i];
    const issueNumber = issue.number;
    const hasLabel = issue.labels.some(l => (typeof l === 'string' ? l : l.name) === TARGET_LABEL);
    const assignees = (issue.assignees || []).map(a => a.login);

    console.log(`[${i + 1}/${openIssues.length}] Issue #${issueNumber}: "${issue.title}"`);

    if (!hasLabel) {
      console.log(`  -> Adding label "${TARGET_LABEL}" to #${issueNumber}`);
      if (!isDryRun) {
        try {
          await addLabelToIssue(issueNumber);
          labeledCount++;
        } catch (err) {
          console.error(`  Error: ${err.message}`);
          errorCount++;
        }
      } else {
        labeledCount++;
      }
    } else {
      console.log(`  -> Label already present.`);
    }

    if (assignees.length > 0) {
      console.log(`  -> Removing assignees [${assignees.join(', ')}] from #${issueNumber}`);
      if (!isDryRun) {
        try {
          await removeAssigneesFromIssue(issueNumber, assignees);
          unassignedCount++;
        } catch (err) {
          console.error(`  Error: ${err.message}`);
          errorCount++;
        }
      } else {
        unassignedCount++;
      }
    } else {
      console.log(`  -> Already unassigned.`);
    }

    await sleep(150);
  }

  console.log('\n====================================');
  console.log('Bulk Issue Sync Complete!');
  console.log(`Total open issues processed: ${openIssues.length}`);
  console.log(`Issues labeled with "${TARGET_LABEL}": ${labeledCount}`);
  console.log(`Issues unassigned: ${unassignedCount}`);
  console.log(`Errors encountered: ${errorCount}`);
  console.log('====================================\n');
}

run().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
