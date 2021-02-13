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
  if (onerror === 'undefined') return defaultOnError;
  if (typeof onerror === 'function') return onerror;
  return () => {};
}

function createSetApiPromiseQueue(configs) {
  const { repo, token = process.env.GITHUB_TOKEN, onerror } = configs;
  checkRepo(repo);
  const errorCallback = getErrorCallback(onerror);
  const promiseForEmail = new Map();
  return {
    setApiPromiseQueue: async.queue(async ({
      email, sha,
    }) => {
      if (!promiseForEmail.has(email)) {
        promiseForEmail.set(email, axios.get(`https://api.github.com/repos/${repo}/commits/${sha}`, {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            ...(typeof token === 'string' && { Authorization: `token ${token}` }),
          },
        }).catch((error) => errorCallback(sha, email, error)));
      }
    }),
    promiseForEmail,
  };
}

/**
 * @callback OnErrorCallback
 * @param {string} [sha] - The sha of the commit which caused the error.
 * @param {string} [email] - The email of the author to the commit which caused the error.
 * @param {any} [error] - The error.
 */

async function getAuthorsWithSetApiPromiseQueue(configs, setApiPromiseQueue, promiseForEmail) {
  const {
    filePath,
    cache = new Map(),
    follow = true,
    concurrency = 64,
    onerror,
    git = 'git',
  } = configs;
  const errorCallback = getErrorCallback(onerror);
  const absPath = path.resolve(filePath);
  const fileStat = await fs.lstat(absPath);
  const { stdout } = await exec(`${git} log ${follow ? '--follow' : '--no-follow'} --pretty='%H %aE' ${absPath}`, {
    cwd: fileStat.isDirectory() ? absPath : path.dirname(absPath),
  });
  const authors = new Set();
  const queue = async.queue(async (line) => {
    const parts = line.split(' ');
    if (parts.length !== 2) return;
    const [sha, email] = parts;
    if (cache.has(email)) {
      authors.add(cache.get(email));
      return;
    }
    await setApiPromiseQueue.push({ email, sha });
    const response = await promiseForEmail.get(email);
    if (!response) return;
    const login = response.data?.author?.login;
    if (typeof login === 'string') {
      cache.set(email, login);
      authors.add(login);
    } else errorCallback(sha, email, '.author.login not found in the API response');
  }, concurrency);
  await Promise.all(stdout.split('\n').map((line) => queue.push(line)));
  return Array.from(authors);
}

/**
 * Get the authors of a specific path in the given GitHub repository.
 * @param {Object} configs
 * @param {string} configs.repo - The GitHub repository, in the "owner/name" format.
 * @param {string} configs.filePath - The path that you want to know its authors.
 * It's a normal file path (either absolute or relative to pwd), NOT relative to the repository.
 * @param {string|null=} [configs.token=process.env.GITHUB_TOKEN] - A GitHub Personal Access Token,
 * or null if you don't want to use tokens.
 * @param {Map<string, string>=} [configs.cache=new Map()] - The cache. The emails of the authors of
 * [filePath] will be added in the cache.
 * @param {boolean=} [configs.follow=true] - Whether to use the "--follow" option of "git log" or
 * not. i.e. Continue listing the history of a file beyond renames.
 * WARNING: In order to make this option work, the [filePath] should be a file, not a directory.
 * @param {number=} [configs.concurrency=64] - Maximum number of tasks at the same time.
 * @param {OnErrorCallback=} [configs.onerror=console.error(...)]
 * The callback function when error happens.
 * @param {string=} [configs.git='git'] - The command (path to the binary file) for Git.
 * @returns {Promise<string[]>} The authors of the file.
 * @async
 * @date 2021-02-13
 */
async function getAuthors(configs) {
  const { setApiPromiseQueue, promiseForEmail } = createSetApiPromiseQueue(configs);
  return getAuthorsWithSetApiPromiseQueue(configs, setApiPromiseQueue, promiseForEmail);
}

/**
 * Get the cache prepared for the files in the given paths and their subdirectories.
 * @param {Object} configs
 * @param {string} configs.repo - The GitHub repository, in the "owner/name" format.
 * @param {(string[])=} [configs.paths=[]] - The paths containing the files for which you want to
 * get the cache.
 * @param {string|null=} [configs.token=process.env.GITHUB_TOKEN] - A GitHub Personal Access Token,
 * or null if you don't want to use tokens.
 * @param {boolean=} [configs.follow=true] - Whether to use the "--follow" option of "git log" or
 * not. i.e. Continue listing the history of a file beyond renames.
 * WARNING: In order to make this option work, you need to list ALL files in [paths], not only the
 * directories containing the files.
 * @param {number=} [configs.concurrency=64] - Maximum number of tasks at the same time.
 * @param {OnErrorCallback=} [configs.onerror=console.error(...)]
 * The callback function when error happens.
 * @param {string=} [configs.git='git'] - The command (path to the binary file) for Git.
 * @returns {Promise<Map<string, string>>} The cache prepared for the given paths.
 * @async
 * @date 2021-02-13
 */
async function cacheFor(configs) {
  const { paths = [] } = configs;
  assert(Array.isArray(paths));
  const { setApiPromiseQueue, promiseForEmail } = createSetApiPromiseQueue(configs);
  const cache = new Map();
  await Promise.all(paths.map((filePath) => getAuthorsWithSetApiPromiseQueue(
    { ...configs, filePath, cache },
    setApiPromiseQueue,
    promiseForEmail,
  )));
  return cache;
}

module.exports = {
  readCache,
  writeCache,
  getAuthors,
  cacheFor,
};
