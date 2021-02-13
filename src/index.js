/**
* @license
* Copyright 2021 Yufan You
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/

const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const assert = require('assert').strict;
const path = require('path');
const fs = require('fs').promises;
const async = require('async');
const axios = require('axios').default;

/**
 * Read from a cache file.
 * @param {string} cachePath - The path to the cache file.
 * @returns {Promise<Map<string, string>>} The cache.
 * @async
 * @date 2021-02-13
 */
async function readCache(cachePath) {
  if (!cachePath) throw Error('The cache path is empty.');
  const file = await fs.readFile(cachePath);
  return new Map(JSON.parse(file.toString()));
}

/**
 * Write cache to a cache file.
 * @param {Map<string, string>} cache - The cache.
 * @param {string} cachePath - The path to the cache file.
 * @async
 * @date 2021-02-13
 */
async function writeCache(cache, cachePath) {
  if (!cachePath) throw Error('The cache path is empty.');
  const json = JSON.stringify([...cache]);
  await fs.writeFile(cachePath, json);
}

function checkRepo(repo) {
  assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo), `Invalid repository name: ${repo}`);
}

function defaultOnError(sha, email, error) {
  // eslint-disable-next-line no-console
  console.error(`Failed to get the author of ${sha} with the email <${email}>: ${error}`);
}

function getErrorCallback(onerror) {
  if (onerror === undefined) return defaultOnError;
  if (typeof onerror === 'function') return onerror;
  return () => {};
}

function createQueue(configs) {
  const {
    repo,
    token = process.env.GITHUB_TOKEN,
    apiConcurrency = 64,
    gitConcurrency = 32,
    git = 'git',
    follow = true,
    onerror,
  } = configs;
  checkRepo(repo);
  const errorCallback = getErrorCallback(onerror);
  const promiseForEmail = new Map();
  const apiRequestQueue = async.queue(
    async ({ email, sha }) => {
      const response = await axios.get(`https://api.github.com/repos/${repo}/commits/${sha}`, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          ...(typeof token === 'string' && { Authorization: `token ${token}` }),
        },
      })
      // .then((res) => { console.log(email); return res; })
        .catch((error) => errorCallback(sha, email, error));
      if (!response) return null;
      const login = response.data?.author?.login;
      if (typeof login !== 'string') errorCallback(sha, email, '.author.login not found in the API response');
      return login;
    },
    apiConcurrency,
  );
  const setApiPromiseQueue = async.queue(async ({ email, sha }) => {
    if (!promiseForEmail.has(email)) {
      promiseForEmail.set(email, apiRequestQueue.push({ email, sha }));
    }
    return promiseForEmail.get(email);
  });
  const gitQueue = async.queue(async (filePath) => {
    const absPath = path.resolve(filePath);
    const cwd = (await fs.lstat(absPath)).isDirectory() ? absPath : path.dirname(absPath);
    const { stdout } = await exec(`${git} log ${follow ? '--follow' : '--no-follow'} --pretty='%H %aE' ${absPath}`, {
      cwd,
    });
    return stdout;
  }, gitConcurrency);
  return {
    gitQueue,
    setApiPromiseQueue,
  };
}

async function getAuthorsWithQueue({
  configs, filePath, setApiPromiseQueue, gitQueue,
}) {
  const { cache = new Map() } = configs;
  const stdout = await gitQueue.push(filePath);
  const authors = new Set();
  await Promise.all(stdout.split('\n').map(async (line) => {
    const parts = line.split(' ');
    if (parts.length !== 2) return;
    const [sha, email] = parts;
    if (cache.has(email)) {
      authors.add(cache.get(email));
      return;
    }
    const login = await (await setApiPromiseQueue.push({ email, sha }));
    if (typeof login === 'string') {
      cache.set(email, login);
      authors.add(login);
    }
  }));
  return Array.from(authors).sort();
}

/**
 * @callback OnErrorCallback
 * @param {string} [sha] - The sha of the commit which caused the error.
 * @param {string} [email] - The email of the author to the commit which caused the error.
 * @param {any} [error] - The error.
 */

/**
 * Get the GitHub usernames of the authors to the given paths.
 * @param {Object} configs
 * @param {string} configs.repo - The GitHub repository, in the "owner/name" format.
 * @param {string | string[] =} [configs.paths=[]] - The paths containing the files for which you
 * want to get the authors.
* @param {Map<string, string>=} [configs.cache=new Map()] - The cache. The emails of the authors of
 * [filePath] will be added in the cache.
 * @param {string|null=} [configs.token=process.env.GITHUB_TOKEN] - A GitHub Personal Access Token,
 * or null if you don't want to use tokens.
 * @param {boolean=} [configs.follow=true] - Whether to use the "--follow" option of "git log" or
 * not. i.e. Continue listing the history of a file beyond renames.
 * WARNING: In order to make this option work, you need to list ALL files in [paths], not only the
 * directories containing the files.
 * @param {number=} [configs.apiConcurrency=64] - Maximum number of API requests at the same time.
 * @param {number=} [configs.gitConcurrency=32] - Maximum number of Git processes at the same time.
 * @param {OnErrorCallback=} [configs.onerror=console.error(...)]
 * The callback function when error happens.
 * @param {string=} [configs.git='git'] - The command (path to the binary file) for Git.
 * @returns {Promise<string[][]>} An array of the authors to each file.
 * @async
 * @date 2021-02-14
 */
async function getAuthors(configs) {
  const paths = [].concat(configs.paths);
  const queues = createQueue(configs);
  return Promise.all(paths.map((filePath) => getAuthorsWithQueue({
    configs,
    filePath,
    ...queues,
  })));
}

/**
 * Get an empty cache
 * @returns {Map<string, string>} An empty cache
 * @date 2021-02-14
 */
function newCache() {
  return new Map();
}

module.exports = {
  readCache,
  writeCache,
  getAuthors,
  newCache,
};
