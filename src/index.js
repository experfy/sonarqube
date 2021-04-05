const { getInput, info } = require('@actions/core')
const { context, getOctokit } = require('@actions/github')
const exec = require('@actions/exec')
const axios = require('axios').default

const RESULTS_PER_REQUEST = 20

const sonarQubeConfig = (repo) =>  ({
	projectKey: getInput('projectKey') ? getInput('projectKey') : `${repo.owner}-${repo.repo}`,
	projectName: getInput('projectName') ? getInput('projectName') : `${repo.owner}-${repo.repo}`,
	projectBaseDir: getInput('projectBaseDir'),
	host: getInput('host'),
	token: getInput('token')
})

const sonarQubeCommand = (sonarqubeConfig) =>
	`sonar-scanner -Dsonar.projectKey=${sonarqubeConfig.projectKey} -Dsonar.projectName=${sonarqubeConfig.projectName} -Dsonar.sources=. -Dsonar.projectBaseDir=${sonarqubeConfig.projectBaseDir} -Dsonar.login=${sonarqubeConfig.token} -Dsonar.host.url=${sonarqubeConfig.host}`

const projectIssues = async (sonarqubeConfig, pageSize, page) => {
  const tokenBase64 = Buffer.from(sonarqubeConfig.token + ':').toString('base64')

  try {
    const response = await axios.get(`${sonarqubeConfig.host}/api/issues/search?componentKeys=${sonarqubeConfig.projectKey}&statuses=OPEN&ps=${pageSize}&p=${page}`,
      {
        headers: {
          Authorization: `Basic ${tokenBase64}`
        }
      }
    )

    const issues = response.data.issues
    if (pageSize * page >= response.data.paging.total) {
      return issues
    }

    return issues.concat(await projectIssues(sonarqubeConfig, pageSize, page + 1))
  } catch(err) {
    throw new Error('Error getting project issues from SonarQube. Please make sure you provided the host and token inputs.')
  }
}

const createGithubCheck = async (octokit, repo) => {
  const pullRequest = context.payload.pull_request

  try {
    await octokit.checks.create({
      ...repo,
      name: 'SonarQube Review',
      head_sha: pullRequest,
      status: 'completed',
      conclusion: 'neutral',
      details_url: '',
      output: {
        title: 'SonarQube',
        summary: '',
        [],
      }
    })
  } catch(error) {
    throw new Error(error)
  }
}

async function run () {
	const repo = context.repo
	const config = sonarQubeConfig(repo)

	const scannerCommand = sonarQubeCommand(config)
	await exec.exec(scannerCommand)

	await new Promise(r => setTimeout(r, 5000))

	const issues = await projectIssues(config, RESULTS_PER_REQUEST, 1)
}

run()
