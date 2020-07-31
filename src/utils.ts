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

import {
  Endpoints,
  OctokitResponse,
  ReposGetCommitResponseData
} from '@octokit/types'

type listCommitFileParameters = Endpoints['GET /repos/:owner/:repo/commits/:ref']['parameters']

/**
 * Get files for a PR
 *
 * @param {Github} octokit Octokit package
 * @param {Context} context Context object
 * @return {string[]} Returns the list of files names
 */
const commitFiles = async (octokit: any, context: any): Promise<string[]> => {
  try {
    const listCommitFilesConfig: listCommitFileParameters = {
      owner: context.payload?.repository?.owner?.login,
      repo: context.payload?.repository?.name,
      ref: context.sha
    }

    const commit: OctokitResponse<ReposGetCommitResponseData> = await octokit.repos.getCommit(
      listCommitFilesConfig
    )

    console.log(
      'Getting this commit files octokit.pulls.listFiles, listCommitFiles, commit:',
      listCommitFilesConfig,
      commit
    )
    return commit.data.files.map((f: any) => f.filename)
  } catch (error) {
    console.error('commitFiles error:', error)
    throw error
  }
}
/**
 * Get files for a PR
 *
 * @param {Github} octokit Octokit package
 * @param {Context} context Context object
 * @return {string[]} Returns the list of files names
 */
const prFiles = async (octokit: any, context: any): Promise<string[]> => {
  try {
    const lprConfig = {
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      commit_sha: context.sha,
      mediaType: {
        previews: ['groot']
      }
    }
    const pr = await octokit.repos.listPullRequestsAssociatedWithCommit(
      lprConfig
    )

    console.log(
      'Getting this pr files listPullRequestsAssociatedWithCommit, lprConfig, result:',
      lprConfig,
      pr
    )

    if (pr.data.length === 0) {
      throw new Error(`No PRs associated with commit ${context.payload.sha}`)
    }

    const listPrFilesConfig = {
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      pull_number: context.payload.pull_request.id
    }

    const pullRequestFiles = await octokit.pulls.listFiles(listPrFilesConfig)

    console.log(
      'Getting this pr files octokit.pulls.listFiles, listPrFilesConfig, pullRequestFiles:',
      listPrFilesConfig,
      pullRequestFiles
    )
    return pullRequestFiles.data.map((f: any) => f.filename)
  } catch (error) {
    console.error('prFiles error:', error)
    throw error
  }
}

const getPackagesNamesFromChangedFiles = (files: string[]): string[] => {
  const packagesNames: string[] = []
  for (const file of files) {
    if (file.startsWith('packages')) {
      const pkgName = file.split('/')[1]
      console.log(`prPackages file starts with packages pkgName:`, pkgName)
      if (!packagesNames.includes(pkgName)) {
        packagesNames.push(pkgName)
      }
    }
  }

  console.log('prPackages files, result', files, packagesNames)
  return packagesNames
}

/* eslint-disable @typescript-eslint/no-unused-vars */
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

const fileSize = async (filePath: string): Promise<number> => {
  return new Promise((resolve, reject) => {
    let size = 0
    const pipe = fs.createReadStream(filePath)
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
  baseDir: string,
  pathToStatsFile: string
): Promise<{
  checkFailed: boolean
  summary: string
}> => {
  try {
    const statsFileJson: string = fs
      .readFileSync(path.join(baseDir, pathToStatsFile))
      .toString()
    const stats = JSON.parse(statsFileJson)
    console.log(
      'getBundleSizeDiff going to calculate gsize for, stats.outputPath, stats.assets[0]:',
      stats.outputPath,
      stats.assets[0]
    )

    let checkFailed = false
    const resultsSummary = await Promise.all(
      stats.assets.map(async (asset: {name: string; size: number}) => {
        console.log('Going to calculate gzipSize for file:', asset.name)
        const currentSize = await fileSize(
          path.join(stats.outputPath, asset.name)
        )
        const maxsize = 1000 // bytes(config.bundlesize.maxSize)
        const diff = currentSize - maxsize

        let summary = ''
        if (diff > 0) {
          checkFailed = true
          summary = `${bytes(currentSize)} (▲${bytes(diff)} / ${bytes(
            maxsize
          )})`
        } else {
          summary = `${bytes(currentSize)} (▼${bytes(diff)} / ${bytes(
            maxsize
          )})`
        }

        return summary
      })
    )

    const summary = resultsSummary.join('\n')

    console.log(
      'Use http://webpack.github.io/analyse/ to load "./dist/stats.json".'
    )
    // console.log(`Check previous sizes in https://bundlephobia.com/result?p=${pkg.name}@${pkg.version}`)

    return {checkFailed, summary}
  } catch (error) {
    console.error('getBundleSizeDiff error:', error)
    throw error
  }
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
  const statsFilePath = core.getInput('stats_file_path')
  const pkgName = baseDir.split('/').pop()
  const checkName = isMonorepo(baseDir)
    ? `Check Bundle Size for package: ${pkgName}`
    : 'Check Bundle Size'

  console.log('sizeCheck with, pkgName, checkName:', pkgName, checkName)

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

    const testcommand = await execa('ls', ['-lash'], {
      cwd: baseDir,
      localDir: '.',
      preferLocal: true,
      env: {CI: 'true'}
    })
    console.log('Ls command for test:', testcommand.stdout)

    const {checkFailed, summary} = await getBundleSizeDiff(
      baseDir,
      statsFilePath
    )

    const checkupdate = await octokit.checks.update({
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      check_run_id: check.data.id,
      status: 'completed',
      conclusion: checkFailed ? 'failure' : 'success',
      output: {
        title: checkFailed ? 'Error' : 'Success',
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

const isMonorepo = (baseDir: string): boolean => {
  return fs.existsSync(path.join(baseDir, 'packages'))
}

export {
  prFiles,
  commitFiles,
  getPackagesNamesFromChangedFiles,
  sizeCheck,
  isMonorepo
}
