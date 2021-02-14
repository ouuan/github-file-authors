const assert = require('assert').strict;
const { describe, it } = require('mocha');
const path = require('path');
const {
  readCache, writeCache, getAuthors, newCache,
} = require('..');

const token = process.env.GITHUB_TOKEN;
const repo = 'ouuan/github-file-authors-test';

const realCache = {
  ouuan: ['ouuansteve@gmail.com', 'ouuan'],
  sshwy: ['jy.cat@qq.com', 'sshwy'],
  mgt: ['mgt@oi-wiki.org', 'Enter-tainer'],
  qwq: ['2333333333333333333333+qwq@users.noreply.github.com', 'qwq'],
};

const fakeCache = {
  nauuo: ['ouuansteve@gmail.com', 'nauuo'],
  hwy: ['jy.cat@qq.com', 'hwy'],
};

function p(...paths) {
  return path.resolve(__dirname, 'github-file-authors-test', ...paths);
}

describe('getAuthor', () => {
  it('test/test1 follow without cache', async () => {
    const authors = await getAuthors({ repo, paths: p('test', 'test1'), token });
    assert.deepEqual(authors, [['ouuan', 'sshwy']]);
  });
  it('test/test1 no-follow without cache', async () => {
    const authors = await getAuthors({
      repo, paths: [p('test', 'test1')], token, follow: false,
    });
    assert.deepEqual(authors, [['sshwy']]);
  });
  it('test/test1 follow with fake cache', async () => {
    const authors = await getAuthors({
      repo, paths: [p('test', 'test1')], token, cache: new Map([fakeCache.nauuo]),
    });
    assert.deepEqual(authors, [['nauuo', 'sshwy']]);
  });
  it('test/test1 no-follow with fake cache', async () => {
    const authors = await getAuthors({
      repo, paths: p('test', 'test1'), token, follow: false, cache: new Map([fakeCache.hwy]),
    });
    assert.deepEqual(authors, [['hwy']]);
  });
  it('test2/ouuan follow with updated cache', async () => {
    const cache = newCache();
    await getAuthors({ repo, paths: p(), cache });
    assert.deepEqual(cache, new Map(Object.values(realCache)));
    const authors = await getAuthors({
      repo, paths: p('test2', 'ouuan'), cache,
    });
    assert.deepEqual(authors, [['Enter-tainer', 'ouuan']]);
  });
  it('test2/ouuan no-follow with updated cache', async () => {
    const cache = newCache();
    await getAuthors({ repo, cache, paths: [p('test2/ouuan'), p('test/test4')] });
    assert.deepEqual(cache, new Map([realCache.mgt, realCache.ouuan]));
    const authors = await getAuthors({
      repo, paths: [p('test2', 'ouuan')], follow: false, cache,
    });
    assert.deepEqual(authors, [['Enter-tainer', 'ouuan']]);
  });
  it('test/test1 and test2/ouuan', async () => {
    const authors = await getAuthors({
      repo, paths: [p('test', 'test1'), p('test2', 'ouuan'), p('test', 'test1'), p('test', 'test1')], token, follow: false,
    });
    assert.deepEqual(authors, [['sshwy'], ['Enter-tainer', 'ouuan'], ['sshwy'], ['sshwy']]);
  });
  it('read cache.json', async () => {
    const cache = await readCache(path.resolve(__dirname, 'cache.json'));
    const authors = await getAuthors({
      repo, paths: p('test/test2'), token, cache,
    });
    assert.deepEqual(authors, [['nauuo', 'sshwy']]);
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
    const authors = await getAuthors({ repo, paths: path.relative(process.cwd(), p('test', 'test1')), token });
    assert.deepEqual(authors, [['ouuan', 'sshwy']]);
  });
  it('Check users.noreply.github.com', async () => {
    const authors = await getAuthors({
      repo, paths: p('test', 'users.noreply.github.com'), token, follow: false,
    });
    assert.deepEqual(authors, [['qwq']]);
  });
  it('Don\'t check users.noreply.github.com', async () => {
    let called = false;
    await getAuthors({
      repo,
      paths: p('test', 'users.noreply.github.com'),
      token,
      usersNoreply: false,
      onerror: (sha, email, error) => {
        called = true;
        assert.equal(sha, '401283999de6878de1ed79be20a932849cf40f40');
        assert.equal(email, '2333333333333333333333+qwq@users.noreply.github.com');
        assert.equal(error.toString(), '.author.login not found in the API response');
      },
    });
    assert(called);
  });
});
