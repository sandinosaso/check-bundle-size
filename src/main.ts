/* eslint-disable no-console */
import * as core from '@actions/core'
import * as github from '@actions/github'

import {prPackages, sizeCheck, isMonorepo, commitFiles} from './utils'
const context = github.context

const run = async (): Promise<void> => {
  console.log(`Running check ...`)
  console.log(`Context:`, context)
  const myToken = core.getInput('github_token')

  const octokit = github.getOctokit(myToken)

  try {
    if (isMonorepo()) {
      console.log('We are in a monorepo')
      const changedFiles = await commitFiles(octokit, context)
      const pkgs = prPackages(changedFiles)

      await Promise.all(
        pkgs.map(async (pkg: string) => sizeCheck(core, octokit, context, pkg))
      )
    } else {
      console.log('We are not in a monorepo')
      await sizeCheck(core, octokit, context, process.cwd())
    }
  } catch (err) {
    core.setFailed(err)
  }
}

console.log('Going to call run now')
run()
