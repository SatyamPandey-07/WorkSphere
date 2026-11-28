const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  checkVersionParity,
  main,
  runReleaseCheck,
} = require('./release-check.cjs');

function createPackageDirectory({ packageVersion = '1.2.3', lockVersion } = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worksphere-release-check-'));
  const resolvedLockVersion = lockVersion ?? packageVersion;
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    JSON.stringify({ version: packageVersion }),
  );
  fs.writeFileSync(
    path.join(rootDir, 'package-lock.json'),
    JSON.stringify({
      version: resolvedLockVersion,
      packages: { '': { version: resolvedLockVersion } },
    }),
  );
  return rootDir;
}

function successfulCommand(command) {
  return {
    status: 0,
    stdout: command === 'git' ? '' : '',
    stderr: '',
  };
}

describe('release validation script', () => {
  let temporaryDirectories;

  beforeEach(() => {
    temporaryDirectories = [];
  });

  afterEach(() => {
    for (const directory of temporaryDirectories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  function makePackageDirectory(options) {
    const directory = createPackageDirectory(options);
    temporaryDirectories.push(directory);
    return directory;
  }

  test('prints a successful validation summary', () => {
    const output = { log: jest.fn(), error: jest.fn() };
    const rootDir = makePackageDirectory();
    const report = main({
      argv: ['--dry-run'],
      rootDir,
      runCommand: successfulCommand,
      output,
    });

    expect(report.exitCode).toBe(0);
    expect(output.log.mock.calls.map(([message]) => message).join('\n')).toMatch(
      /Lint\s+\|\s+PASS[\s\S]*Typecheck\s+\|\s+PASS[\s\S]*Build\s+\|\s+PASS[\s\S]*package\.json version parity\s+\|\s+PASS/,
    );
  });

  test.each(['npm', 'tsc', 'next'])(
    'reports a failed %s validation and returns a failing exit status',
    (failedCommand) => {
      const rootDir = makePackageDirectory();
      const report = runReleaseCheck({
        rootDir,
        dryRun: true,
        runCommand: (command) =>
          command === failedCommand
            ? { status: 1, stdout: '', stderr: `${failedCommand} failed` }
            : successfulCommand(command),
      });

      const failedName =
        failedCommand === 'npm'
          ? 'Lint'
          : failedCommand === 'tsc'
            ? 'Typecheck'
            : 'Build';
      expect(report.results.find(({ name }) => name === failedName)).toMatchObject({
        passed: false,
        detail: `${failedCommand} failed`,
      });
      expect(report.exitCode).toBe(1);
    },
  );

  test('passes version parity when package and lockfile root versions match', () => {
    const rootDir = makePackageDirectory();
    expect(checkVersionParity(rootDir)).toMatchObject({ passed: true });
  });

  test('fails version parity with an actionable lockfile update instruction', () => {
    const rootDir = makePackageDirectory({
      packageVersion: '1.2.3',
      lockVersion: '1.2.2',
    });

    expect(checkVersionParity(rootDir)).toMatchObject({
      passed: false,
      detail: expect.stringContaining('Update package-lock.json from package.json.'),
    });
  });

  test('dry-run announces tag safety and does not invoke Git or alter existing tags', () => {
    const output = { log: jest.fn(), error: jest.fn() };
    const rootDir = makePackageDirectory();
    const tagDirectory = path.join(rootDir, '.git', 'refs', 'tags');
    fs.mkdirSync(tagDirectory, { recursive: true });
    fs.writeFileSync(path.join(tagDirectory, 'v1.2.3'), 'existing tag ref');
    const tagBefore = fs.readFileSync(path.join(tagDirectory, 'v1.2.3'), 'utf8');
    const invokedCommands = [];

    const report = main({
      argv: ['--dry-run'],
      rootDir,
      output,
      runCommand: (command, args, cwd) => {
        invokedCommands.push([command, args, cwd]);
        return successfulCommand(command);
      },
    });

    expect(report.exitCode).toBe(0);
    expect(output.log.mock.calls[0][0]).toMatch(/DRY RUN/);
    expect(invokedCommands.map(([command]) => command)).toEqual([
      'npm',
      'tsc',
      'next',
    ]);
    expect(fs.readFileSync(path.join(tagDirectory, 'v1.2.3'), 'utf8')).toBe(
      tagBefore,
    );
  });

  test('returns a nonzero process status when a validation fails', () => {
    const output = { log: jest.fn(), error: jest.fn() };
    const rootDir = makePackageDirectory();
    const report = main({
      argv: ['--dry-run'],
      rootDir,
      output,
      runCommand: (command) =>
        command === 'tsc'
          ? { status: 2, stdout: '', stderr: 'type error' }
          : successfulCommand(command),
    });

    expect(report.exitCode).toBe(1);
  });
});
