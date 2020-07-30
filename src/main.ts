/* eslint-disable no-console */
import * as core from '@actions/core'
import * as github from '@actions/github'

import {prFiles, prPackages, sizeCheck, isMonorepo} from './utils'
const context = github.context

const run = async (): Promise<void> => {
  console.log(`running with context:`, context)
  const myToken = core.getInput('github_token')

  const debug_command: string = core.getInput('debug_command')
  core.debug(`Build command ${debug_command} ...`)

  const octokit = github.getOctokit(myToken)

  try {
    if (isMonorepo()) {
      const changedFiles = await prFiles(octokit, context)
      const pkgs = prPackages(changedFiles)

      await Promise.all(
        pkgs.map(async (pkg: string) => sizeCheck(core, octokit, context, pkg))
      )
    } else {
      await sizeCheck(core, octokit, context, process.cwd())
    }
  } catch (err) {
    core.setFailed(err)
  }
}

console.log('Going to call run now')
run()
