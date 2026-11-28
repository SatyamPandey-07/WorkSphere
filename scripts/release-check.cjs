#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VALIDATIONS = [
  { name: 'Lint', command: 'npm', args: ['run', 'lint'] },
  { name: 'Typecheck', command: 'tsc', args: ['--noEmit'] },
  { name: 'Build', command: 'next', args: ['build', '--webpack'] },
];

function executeCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 8 * 1024 * 1024,
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  };
}

function checkVersionParity(rootDir) {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'),
    );
    const packageLock = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'),
    );
    const packageVersion = packageJson.version;
    const lockVersion = packageLock.version;
    const rootLockVersion = packageLock.packages?.['']?.version;

    if (typeof packageVersion !== 'string' || packageVersion.length === 0) {
      return { passed: false, detail: 'package.json has no valid version.' };
    }

    const mismatches = [];
    if (lockVersion !== packageVersion) {
      mismatches.push(
        `package-lock.json version "${lockVersion}" does not match package.json version "${packageVersion}"`,
      );
    }
    if (rootLockVersion !== packageVersion) {
      mismatches.push(
        `package-lock.json packages[""].version "${rootLockVersion}" does not match package.json version "${packageVersion}"`,
      );
    }

    return mismatches.length === 0
      ? { passed: true, detail: `All root package versions match (${packageVersion}).` }
      : {
          passed: false,
          detail: `${mismatches.join('; ')}. Update package-lock.json from package.json.`,
        };
  } catch (error) {
    return {
      passed: false,
      detail: `Unable to read package version metadata: ${error.message}`,
    };
  }
}

function failureDetail(result) {
  if (result.error) {
    return result.error.message;
  }

  const output = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const concise = output.slice(-8).join(' | ').slice(-1200);
  return concise || `Command exited with status ${result.status ?? 'unknown'}.`;
}

function formatSummary(results) {
  const validationWidth = Math.max(
    'Validation'.length,
    ...results.map(({ name }) => name.length),
  );
  const resultWidth = 'Result'.length;
  const border = `+${'-'.repeat(validationWidth + 2)}+${'-'.repeat(resultWidth + 2)}+`;
  const row = (validation, result) =>
    `| ${validation.padEnd(validationWidth)} | ${result.padEnd(resultWidth)} |`;

  return [
    border,
    row('Validation', 'Result'),
    border,
    ...results.map(({ name, passed }) => row(name, passed ? 'PASS' : 'FAIL')),
    border,
  ].join('\n');
}

function runReleaseCheck({
  rootDir,
  dryRun = false,
  runCommand = executeCommand,
}) {
  let cleanTreeFailure;
  if (!dryRun) {
    const gitResult = runCommand('git', ['status', '--porcelain'], rootDir);
    if (gitResult.error || gitResult.status !== 0) {
      cleanTreeFailure = `Unable to verify working tree: ${failureDetail(gitResult)}`;
    } else if (gitResult.stdout.trim()) {
      cleanTreeFailure =
        'Release check requires a clean working tree. Commit, stash, or discard changes before retrying.';
    }
  }

  const results = VALIDATIONS.map(({ name, command, args }) => {
    const result = runCommand(command, args, rootDir);
    return {
      name,
      passed: !result.error && result.status === 0,
      detail:
        result.error || result.status !== 0 ? failureDetail(result) : undefined,
    };
  });

  const parity = checkVersionParity(rootDir);
  results.push({
    name: 'package.json version parity',
    passed: parity.passed,
    detail: parity.passed ? undefined : parity.detail,
  });

  return {
    results,
    cleanTreeFailure,
    exitCode:
      cleanTreeFailure || results.some(({ passed }) => !passed) ? 1 : 0,
  };
}

function main({
  argv = process.argv.slice(2),
  rootDir = path.resolve(__dirname, '..'),
  runCommand = executeCommand,
  output = console,
} = {}) {
  const unknownArguments = argv.filter((argument) => argument !== '--dry-run');
  if (unknownArguments.length > 0) {
    output.error(`Unknown argument: ${unknownArguments.join(' ')}`);
    return { exitCode: 2, results: [] };
  }

  const dryRun = argv.includes('--dry-run');
  if (dryRun) {
    output.log('DRY RUN: running release validations; Git tags will not be created, modified, or pushed.');
  }

  const report = runReleaseCheck({ rootDir, dryRun, runCommand });
  if (report.cleanTreeFailure) {
    output.error(report.cleanTreeFailure);
  }
  output.log(formatSummary(report.results));
  for (const result of report.results) {
    if (!result.passed && result.detail) {
      output.error(`${result.name}: ${result.detail}`);
    }
  }

  return report;
}

if (require.main === module) {
  process.exitCode = main().exitCode;
}

module.exports = {
  checkVersionParity,
  formatSummary,
  main,
  runReleaseCheck,
};
