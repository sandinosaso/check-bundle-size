/* eslint-disable no-console */
import * as core from '@actions/core'
import * as github from '@actions/github'

import {
  getPackagesNamesFromChangedFiles,
  sizeCheck,
  isMonorepo,
  commitFiles
} from './utils'
const context = github.context

const run = async (): Promise<void> => {
  const myToken = core.getInput('github_token')

  const octokit = github.getOctokit(myToken)

  const baseDir = process.cwd()
  console.log(`Running check in baseDir: ${baseDir}...`)
  try {
    if (isMonorepo()) {
      console.log('We are in a monorepo')
      const changedFiles = await commitFiles(octokit, context)
      const pkgsNames = getPackagesNamesFromChangedFiles(changedFiles)

      await Promise.all(
        pkgsNames.map(async (pkgName: string) => {
          console.log('Going to calculate sizeCheck for package:', pkgName)
          sizeCheck(core, octokit, context, `${baseDir}/packages/${pkgName}`)
        })
      )
    } else {
      console.log('We are not in a monorepo')
      await sizeCheck(core, octokit, context, baseDir)
    }
  } catch (err) {
    core.setFailed(err)
  }
}

console.log('Going to call run now')
run()
