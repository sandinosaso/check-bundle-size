/* eslint-disable no-console */
'use strict'
const path = require('path');
const fs = require('fs-extra');
const bytes = require('bytes');
const { createGzip } = require('zlib');
const artifact = require('@actions/artifact');
const execa = require('execa');
const globby = require('globby');

/**
 * Get files for a PR
 *
 * @param {Github} octokit Octokit package
 * @param {Context} context Context object
 * @return {string[]} Returns the list of files names
 */
const prFiles = async (octokit: any, context: any) => {
  const pr = await octokit.repos.listPullRequestsAssociatedWithCommit({
    owner: context.repo.owner,
    repo: context.repo.repo,
    commit_sha: context.sha
  })

  if (pr.data.length === 0) {
    throw new Error(`no PRs associated with commit ${context.sha}`)
  }

  const prFiles = await octokit.pulls.listFiles({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: pr.data[0].number
  })

  return prFiles.data.map((f: any) => f.filename)
}

const prPackages = (files: string[]) => {
  const baseDir = 'packages'

  const packages: string[] = []
  for (const file of files) {
    if (file.startsWith(baseDir)) {
      const pkgName = file.split('/')[1]
      const pkgPath = path.join(process.cwd(), baseDir, pkgName)
      if (!packages.includes(pkgPath)) {
        packages.push(pkgPath)
      }
    }
  }

  return packages
}

const gzipSize = (path: string): Promise<number> => {
  return new Promise((resolve, reject) => {
    let size = 0
    const pipe = fs.createReadStream(path).pipe(createGzip({ level: 9 }))
    pipe.on('error', reject)
    pipe.on('data', (buf: Buffer) => {
      size += buf.length
    })
    pipe.on('end', () => {
      resolve(size)
    })
  })
}

const getBundleSizeDiff = async (): Promise<void> => {
  const stats = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'dist/stats.json')))
  const gzip = await gzipSize(path.join(stats.outputPath, stats.assets[0].name))
  const maxsize = 100; // bytes(config.bundlesize.maxSize)
  const diff = gzip - maxsize;

  console.log('Use http://webpack.github.io/analyse/ to load "./dist/stats.json".')
  // console.log(`Check previous sizes in https://bundlephobia.com/result?p=${pkg.name}@${pkg.version}`)

  if (diff > 0) {
    throw new Error(`${bytes(gzip)} (▲${bytes(diff)} / ${bytes(maxsize)})`)
  } else {
    console.log(`${bytes(gzip)} (▼${bytes(diff)} / ${bytes(maxsize)})`)
  }
}

/**
 * Bundle Size Check
 *
 * @param {Github} octokit Octokit package
 * @param {Context} context Context object
 * @param {string} baseDir base dir absolute dir
 */
const sizeCheck = async (core: any, octokit: any, context: any, baseDir: string) => {
  let check = null;
  const buildCommand = core.getInput('command_for_building');
  const pkgName = baseDir.split('/').pop();
  const checkName = isMonorepo() ? `size: ${pkgName}` : 'size';

  try {
    check = await octokit.checks.create({
      owner: context.repo.owner,
      repo: context.repo.repo,
      name: checkName,
      head_sha: context.sha,
      status: 'in_progress'
    });

    const out = await execa(buildCommand, ['-a', '-b'], {
      cwd: baseDir,
      localDir: '.',
      preferLocal: true,
      env: { CI: true }
    });
    console.log('Size check for:', pkgName);
    console.log(out.stdout);

    await getBundleSizeDiff();

    const parts = out.stdout.split('\n');
    const title = parts[2];
    await octokit.checks.update(
      {
        owner: context.repo.owner,
        repo: context.repo.repo,
        check_run_id: check.data.id,
        conclusion: 'success',
        output: {
          title: title,
          summary: [parts[0], parts[1]].join('\n')
        }
      }
    );

    await artifact.create().uploadArtifact(
      `${pkgName}-size`,
      await globby(['dist/*'], { cwd: baseDir, absolute: true }),
      baseDir,
      {
        continueOnError: true
      }
    );
  } catch (err) {
    await octokit.checks.update(
      {
        owner: context.repo.owner,
        repo: context.repo.repo,
        check_run_id: check.data.id,
        conclusion: 'failure',
        output: {
          title: err.stderr ? err.stderr : 'Error',
          summary: err.stdout ? err.stdout : err.message
        }
      }
    );
    throw err;
  }
}

const isMonorepo = () => {
  return fs.existsSync(path.join(process.cwd(), 'packages'));
}

export {
  prFiles,
  prPackages,
  sizeCheck,
  isMonorepo
}