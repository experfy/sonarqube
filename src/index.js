const { getInput, info} = require('@actions/core')
const { context, getOctokit } = require('@actions/github')
const core = require('@actions/core')
const exec = require('@actions/exec')
const axios = require('axios').default

const RESULTS_PER_REQUEST = 50

const sonarQubeConfig = (repo) =>  ({
	projectKey: getInput('projectKey') ? getInput('projectKey') : `${repo.owner}-${repo.repo}`,
	projectName: getInput('projectName') ? getInput('projectName') : `${repo.owner}-${repo.repo}`,
	projectBaseDir: getInput('projectBaseDir'),
	host: getInput('host'),
	token: getInput('token')
})

const sonarQubeCommand = (sonarqubeConfig) =>
	`sonar-scanner -Dsonar.projectKey=${sonarqubeConfig.projectKey} -Dsonar.projectName=${sonarqubeConfig.projectName} -Dsonar.sources=. -Dsonar.projectBaseDir=${sonarqubeConfig.projectBaseDir} -Dsonar.login=${sonarqubeConfig.token} -Dsonar.host.url=${sonarqubeConfig.host}`

const projectIssues = async (sonarqubeConfig, pageSize, page, result = []) => {
  const tokenBase64 = Buffer.from(sonarqubeConfig.token + ':').toString('base64')

  try {
    const response = await axios.get(`${sonarqubeConfig.host}/api/issues/search?componentKeys=${sonarqubeConfig.projectKey}&sinceLeakPeriod=true&statuses=OPEN&severities=BLOCKER,CRITICAL,MAJOR&ps=${pageSize}&p=${page}`,
      {
        headers: {
          Authorization: `Basic ${tokenBase64}`
        }
      }
    )
    if (response.status !== 200 || !response.data) {
      return result
    }

    const {
      data: { issues },
    } = response

    result.push(issues)

    if (pageSize * page >= response.data.paging.total) {
      return result
    }

    return await projectIssues(sonarqubeConfig, pageSize, page + 1, result)
  } catch(err) {
    throw new Error('Error getting project issues from SonarQube. Please make sure you provided the host and token inputs.')
  }
}

const componentToPath = (component) => {
  if (!component.includes(':')) return component

  const [, path] = component.split(':')
  return path
}

const getAnnotationLevel = (severity) => {
  switch(severity) {
    case 'BLOCKER':
      return 'failure'
    case 'CRITICAL':
      return 'failure'
    case 'MAJOR':
      return 'failure'
    case 'MINOR':
      return 'warning'
    case 'INFO':
      return 'notice'
    default:
      return 'notice'
  }
}

const issuesToAnnotations = (issues) => {
  return issues.map(issue => {
    return {
      path: componentToPath(issue.component),
      start_line: issue.textRange ? issue.textRange.startLine : 1,
      end_line: issue.textRange ? issue.textRange.endLine : 1,
      annotation_level: getAnnotationLevel(issue.severity),
      message: issue.message
    }
  })
}

const createGithubCheck = async (octokit, repo, detailsURL) => {
	info('Creating check')
  const pullRequest = context.payload.pull_request
	const ref = pullRequest ? pullRequest.head.sha : context.sha

  try {
    const {
      data: { id: checkRunId },
    } = await octokit.checks.create({
      ...repo,
      name: 'SonarQube Automated Review',
      head_sha: ref,
      status: 'completed',
      conclusion: 'neutral',
      details_url: detailsURL,
      output: {
        title: 'SonarQube',
        summary: 'Analysis summary.',
      },
    })

		return checkRunId
  } catch(error) {
    throw new Error(error)
  }
}

const updateGithubCheck = async (octokit, repo, checkRunId, annotations) => {
  info('Updating check')
  try {
    await octokit.checks.update({
      ...repo,
      check_run_id: checkRunId,
      status: 'completed',
      conclusion: 'neutral',
      output: {
        title: 'SonarQube',
        summary: 'Updated Analysis summary.',
        annotations,
      },
    })
  } catch (error) {
    throw new Error(error)
  } finally {
    if (annotations && annotations.length) core.setFailed('High severity issues found. Please correct them.')
  }
}


async function run () {
	const repo = context.repo
	const config = sonarQubeConfig(repo)

	const scannerCommand = sonarQubeCommand(config)
	await exec.exec(scannerCommand)

	await new Promise(r => setTimeout(r, 5000))

	const issues = await projectIssues(config, RESULTS_PER_REQUEST, 1)

	const octokit = getOctokit(getInput('githubToken'))

	const detailsURL = `${config.host}/dashboard?id=${config.projectKey}`

	const checkRunId = await createGithubCheck(octokit, repo, detailsURL)

  issues.map(async (batch) => {
    const annotations = issuesToAnnotations(batch)

    await updateGithubCheck(
      octokit,
      repo,
      checkRunId,
      annotations
    )
  })
}

run()
