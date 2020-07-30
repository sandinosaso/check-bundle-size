/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
'use strict'
import path from 'path'
import fs from 'fs-extra'
import bytes from 'bytes'
import {createGzip} from 'zlib'
// import * as artifact from '@actions/artifact'
// import globby from 'globby'
import execa from 'execa'

/**
 * Get files for a PR
 *
 * @param {Github} octokit Octokit package
 * @param {Context} context Context object
 * @return {string[]} Returns the list of files names
 */
const prFiles = async (octokit: any, context: any): Promise<string[]> => {
  const pr = await octokit.repos.listPullRequestsAssociatedWithCommit({
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    commit_sha: context.sha
  })

  console.log(
    'Got pr associated with this commit with context.payload.repository, pr',
    context.payload.repository,
    pr
  )

  if (pr.data.length === 0) {
    throw new Error(`no PRs associated with commit ${context.payload.sha}`)
  }

  const pullRequestFiles = await octokit.pulls.listFiles({
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    pull_number: pr.data[0].number
  })

  return pullRequestFiles.data.map((f: any) => f.filename)
}

const prPackages = (files: string[]): string[] => {
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

const gzipSize = async (filePath: string): Promise<number> => {
  return new Promise((resolve, reject) => {
    let size = 0
    const pipe = fs.createReadStream(filePath).pipe(createGzip({level: 9}))
    pipe.on('error', reject)
    pipe.on('data', (buf: any) => {
      size += buf.length
    })
    pipe.on('end', () => {
      resolve(size)
    })
  })
}

const getBundleSizeDiff = async (
  pathToDistFolder: string
): Promise<{
  diff: number
  summary: string
}> => {
  const statsFileJson: string = fs
    .readFileSync(path.join(process.cwd(), `${pathToDistFolder}/stats.json`))
    .toString()
  const stats = JSON.parse(statsFileJson)
  const gzip = await gzipSize(path.join(stats.outputPath, stats.assets[0]))
  const maxsize = 100 // bytes(config.bundlesize.maxSize)
  const diff = gzip - maxsize

  console.log(
    'Use http://webpack.github.io/analyse/ to load "./dist/stats.json".'
  )
  // console.log(`Check previous sizes in https://bundlephobia.com/result?p=${pkg.name}@${pkg.version}`)

  let summary = ''
  if (diff > 0) {
    summary = `${bytes(gzip)} (▲${bytes(diff)} / ${bytes(maxsize)})`
  } else {
    summary = `${bytes(gzip)} (▼${bytes(diff)} / ${bytes(maxsize)})`
  }

  return {diff, summary}
}

/**
 * Bundle Size Check
 *
 * @param {Github} octokit Octokit package
 * @param {Context} context Context object
 * @param {string} baseDir base dir absolute dir
 */
const sizeCheck = async (
  core: any,
  octokit: any,
  context: any,
  baseDir: string
): Promise<void> => {
  let check = null
  const buildCommand = core.getInput('build_command')
  const pathToDistFolder = core.getInput('dist_folder_path')
  const pkgName = baseDir.split('/').pop()
  const checkName = isMonorepo() ? `size: ${pkgName}` : 'size'

  console.log(
    'sizeCheck with buildCommand, pkgName, checkName:',
    buildCommand,
    pkgName,
    checkName
  )

  try {
    console.log(
      'octokit.checks.create with context.payload.repository, context.sha:',
      context.payload.repository,
      checkName,
      context.sha
    )

    check = await octokit.checks.create({
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      name: checkName,
      head_sha: context.sha,
      status: 'in_progress'
    })

    console.log('octokit.checks.create returned:', check)

    console.log('Going to execut npm run all, baseDir', baseDir)

    const testcommand = await execa('ls', ['-lash', pathToDistFolder], {
      cwd: baseDir,
      localDir: '.',
      preferLocal: true,
      env: {CI: 'true'}
    })
    console.log('Size check test command:', testcommand.stdout)

    const out = await execa(buildCommand, [], {
      cwd: baseDir,
      localDir: '.',
      preferLocal: true,
      env: {CI: 'true'}
    })
    console.log(`build command result (${buildCommand}):`, out.stdout)
    console.log(out.stdout)

    const {diff, summary} = await getBundleSizeDiff(pathToDistFolder)

    // const parts = out.stdout.split('\n')
    // const title = parts[2]
    const checkupdate = await octokit.checks.update({
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      check_run_id: check.data.id,
      conclusion: 'success',
      output: {
        title: diff > 0 ? 'Error' : 'Success',
        summary
      }
    })

    console.log('octokit.checks.update returned:', checkupdate)

    // await artifact
    //   .create()
    //   .uploadArtifact(
    //     `${pkgName}-size`,
    //     await globby(['dist/*'], {cwd: baseDir, absolute: true}),
    //     baseDir,
    //     {
    //       continueOnError: true
    //     }
    //   )
  } catch (err) {
    console.error('sizeCheck error:', err)
    await octokit.checks.update({
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      check_run_id: check.data.id,
      conclusion: 'failure',
      output: {
        title: err.stderr ? err.stderr : 'Error',
        summary: err.stdout ? err.stdout : err.message
      }
    })

    throw err
  }
}

const isMonorepo = (): boolean => {
  return fs.existsSync(path.join(process.cwd(), 'packages'))
}

export {prFiles, prPackages, sizeCheck, isMonorepo}
