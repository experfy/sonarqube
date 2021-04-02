const { getInput, info } = require('@actions/core')
const { context, getOctokit } = require('@actions/github')
const exec = require('@actions/exec')
const axios = require('axios').default

const sonarQubeInfo = (repo) =>  ({
	projectKey: getInput('projectKey') ? getInput('projectKey') : `${repo.owner}-${repo.repo}`,
	projectName: getInput('projectName') ? getInput('projectName') : `${repo.owner}-${repo.repo}`,
	projectBaseDir: getInput('projectBaseDir'),
	host: getInput('host'),
	token: getInput('token')
})

const sonarQubeCommand = (sonarqube) =>
	`sonar-scanner -Dsonar.projectKey=${sonarqube.projectKey} -Dsonar.projectName=${sonarqube.projectName} -Dsonar.sources=. -Dsonar.projectBaseDir=${sonarqube.projectBaseDir} -Dsonar.login=${sonarqube.token} -Dsonar.host.url=${sonarqube.host}`
