import * as core from '@actions/core';
import * as github from '@actions/github';
const context = github.context;

import { prFiles, prPackages, sizeCheck, isMonorepo } from './utils';

const run = async () => {
  const myToken = core.getInput('github_token');

  const build_command: string = core.getInput('debug_command')
  core.debug(`Build command ${build_command} ...`);

  const octokit = github.getOctokit(myToken)

  try {
    if (isMonorepo()) {
      const changedFiles = await prFiles(octokit, context);
      const pkgs = prPackages(changedFiles);

      await Promise.all(pkgs.map((pkg: any) => sizeCheck(core, octokit, context, pkg)));
    } else {
      await sizeCheck(core, octokit, context, process.cwd());
    }
  } catch (err) {
    core.setFailed(err);
  }
}

run();