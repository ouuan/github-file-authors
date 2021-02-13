const assert = require('assert').strict;
const { describe, it } = require('mocha');
const path = require('path');
const {
  readCache, writeCache, getAuthors, cacheFor,
} = require('..');

const token = process.env.GITHUB_TOKEN;
const repo = 'ouuan/github-file-authors-test';

const realCache = {
  ouuan: ['ouuansteve@gmail.com', 'ouuan'],
  sshwy: ['jy.cat@qq.com', 'sshwy'],
  mgt: ['mgt@oi-wiki.org', 'Enter-tainer'],
};

const fakeCache = {
  nauuo: ['ouuansteve@gmail.com', 'nauuo'],
  hwy: ['jy.cat@qq.com', 'hwy'],
};

function p(...filePath) {
  return path.resolve(__dirname, 'github-file-authors-test', ...filePath);
}

describe('getAuthor', () => {
  it('test/test1 follow without cache', async () => {
    const authors = await getAuthors({ repo, filePath: p('test', 'test1'), token });
    assert.deepEqual(authors, ['ouuan', 'sshwy']);
  });
  it('test/test1 no-follow without cache', async () => {
    const cache = await cacheFor({ repo, token });
    assert.deepEqual(cache, new Map());
    const authors = await getAuthors({
      repo, filePath: p('test', 'test1'), follow: false, cache,
    });
    assert.deepEqual(authors, ['sshwy']);
  });
  it('test/test1 follow with fake cache', async () => {
    const authors = await getAuthors({
      repo, filePath: p('test', 'test1'), cache: new Map([fakeCache.nauuo]),
    });
    assert.deepEqual(authors, ['nauuo', 'sshwy']);
  });
  it('test/test1 no-follow with fake cache', async () => {
    const authors = await getAuthors({
      repo, filePath: p('test', 'test1'), follow: false, cache: new Map([fakeCache.hwy]),
    });
    assert.deepEqual(authors, ['hwy']);
  });
  it('test2/ouuan follow with updated cache', async () => {
    const cache = await cacheFor({ repo, paths: [p()] });
    assert.deepEqual(cache, new Map(Object.values(realCache)));
    const authors = await getAuthors({
      repo, filePath: p('test2', 'ouuan'), cache,
    });
    assert.deepEqual(authors, ['Enter-tainer', 'ouuan']);
  });
  it('test2/ouuan no-follow with updated cache', async () => {
    const cache = await cacheFor({ repo, paths: [p('test2/ouuan'), p('test/test4')] });
    assert.deepEqual(cache, new Map([realCache.mgt, realCache.ouuan]));
    const authors = await getAuthors({
      repo, filePath: p('test2', 'ouuan'), follow: false, cache,
    });
    assert.deepEqual(authors, ['Enter-tainer', 'ouuan']);
  });
  it('read cache.json', async () => {
    const cache = await readCache(path.resolve(__dirname, 'cache.json'));
    const authors = await getAuthors({
      repo, filePath: p('test/test2'), token, cache,
    });
    assert.deepEqual(authors, ['nauuo', 'sshwy']);
    assert.deepEqual(cache, new Map([fakeCache.nauuo, realCache.sshwy]));
  });
  it('read/write cache', async () => {
    const cache = new Map([realCache.mgt]);
    const cachePath = path.resolve(__dirname, 'tmp.json');
    await writeCache(cache, cachePath);
    const writtenAndReadCache = await readCache(cachePath);
    assert.deepEqual(writtenAndReadCache, cache);
  });
  it('Relative path', async () => {
    const authors = await getAuthors({ repo, filePath: path.relative(process.cwd(), p('test', 'test1')), token });
    assert.deepEqual(authors, ['ouuan', 'sshwy']);
  });
  it('On error', async () => {
    let called = false;
    await cacheFor({
      repo,
      paths: [p()],
      onerror: (sha, email, error) => {
        called = true;
        assert.equal(sha, '8ab92719f812b4761fc9758cbe520fe9824da1cf');
        assert.equal(email, 'this-user@doesnt-exist.com');
        assert.equal(error.toString(), '.author.login not found in the API response');
      },
    });
    assert(called);
  });
});
