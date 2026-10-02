import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './harness.mjs';

const { parse, checkComplete } = await import('../src/shell/parse.js');

test('parser: quotes, operators, redirections', () => {
    const list = parse(`echo "a b" 'c $X' d\\ e && ls -la | grep x > out.txt 2>&1; pwd`);
    assert.equal(list.length, 3);
    assert.equal(list[0].op, '&&');
    assert.equal(list[1].pipeline.cmds.length, 2);
    const grep = list[1].pipeline.cmds[1];
    assert.equal(grep.redirects.length, 2);
    assert.equal(grep.redirects[1].dup, '1');
});

test('parser: incomplete input is detected', () => {
    assert.equal(checkComplete('git commit -m "hello').complete, false);
    assert.equal(checkComplete('ls |').complete, false);
    assert.equal(checkComplete('ls &&').complete, false);
    assert.equal(checkComplete('echo ok').complete, true);
});

test('echo, variables, quoting and $?', async () => {
    const { run } = await makeEnv();
    assert.equal((await run('echo hello   world')).out, 'hello world\n');
    assert.equal((await run('echo "hello   world"')).out, 'hello   world\n');
    assert.equal((await run("X=5; echo $X '$X' \"$X\"")).out, '5 $X 5\n');
    assert.equal((await run('false; echo $?')).out, '1\n');
    assert.equal((await run('echo $HOME')).out, '/home/student\n');
    assert.equal((await run('echo ~/a')).out, '/home/student/a\n');
    assert.equal((await run('echo -n hi; echo !')).out, 'hi!\n');
    assert.equal((await run('echo $(echo inner) x')).out, 'inner x\n');
});

test('&&, || and ; chaining', async () => {
    const { run } = await makeEnv();
    assert.equal((await run('true && echo yes || echo no')).out, 'yes\n');
    assert.equal((await run('false && echo yes || echo no')).out, 'no\n');
    assert.equal((await run('false; echo after')).out, 'after\n');
});

test('files: mkdir, touch, ls, cd, pwd, rm', async () => {
    const { run } = await makeEnv();
    await run('mkdir -p projekt/src/{css,js}');
    await run('touch projekt/README.md projekt/src/js/app.js');
    assert.equal((await run('ls projekt')).out, 'README.md  src\n');
    assert.equal((await run('ls projekt/src')).out, 'css  js\n');
    await run('cd projekt/src');
    assert.equal((await run('pwd')).out, '/home/student/projekt/src\n');
    assert.equal((await run('cd ..; pwd')).out, '/home/student/projekt\n');
    assert.equal((await run('cd -')).out, '/home/student/projekt/src\n');
    const r = await run('mkdir ../src');
    assert.equal(r.out, "mkdir: cannot create directory ‘../src’: File exists\n");
    assert.equal(r.status, 1);
    const rm = await run('rm js');
    assert.equal(rm.out, "rm: cannot remove 'js': Is a directory\n");
    await run('rm -r js');
    assert.equal((await run('ls')).out, 'css\n');
    assert.equal((await run('ls nope')).status, 2);
});

test('redirection, append, cat, pipes, wc, grep', async () => {
    const { run, read } = await makeEnv();
    await run('echo Brot > liste.txt');
    await run('echo Butter >> liste.txt');
    await run('echo Brezel >> liste.txt');
    assert.equal(await read('liste.txt'), 'Brot\nButter\nBrezel\n');
    assert.equal((await run('cat liste.txt | grep Br')).out, 'Brot\nBrezel\n');
    assert.equal((await run('grep -c Br liste.txt')).out, '2\n');
    assert.equal((await run('wc -l liste.txt')).out, '3 liste.txt\n');
    assert.equal((await run('cat liste.txt | wc -l')).out, '3\n');
    assert.equal((await run('sort liste.txt | head -n 1')).out, 'Brezel\n');
    assert.equal((await run('grep "a|B" liste.txt')).status, 1, 'BRE: | is literal');
    assert.equal((await run('grep -E "^(Brot|Butter)$" liste.txt')).out, 'Brot\nButter\n');
    assert.equal((await run('ls nope 2> err.txt; cat err.txt')).out, "ls: cannot access 'nope': No such file or directory\n");
    assert.equal((await run('cat nope 2>&1 | wc -l')).out, '1\n');
});

test('cp, mv, globbing', async () => {
    const { run } = await makeEnv();
    await run('touch a.txt b.txt c.md');
    assert.equal((await run('echo *.txt')).out, 'a.txt b.txt\n');
    assert.equal((await run('echo *.none')).out, '*.none\n');
    await run('mkdir docs && mv *.txt docs/');
    assert.equal((await run('ls docs')).out, 'a.txt  b.txt\n');
    await run('cp c.md docs/');
    assert.equal((await run('ls docs')).out, 'a.txt  b.txt  c.md\n');
    assert.equal((await run('cp docs x')).out, "cp: -r not specified; omitting directory 'docs'\n");
    await run('cp -r docs backup');
    assert.equal((await run('ls backup')).out, 'a.txt  b.txt  c.md\n');
});

test('unknown commands, permissions, help', async () => {
    const { run } = await makeEnv();
    const r = await run('gti status');
    assert.equal(r.status, 127);
    assert.equal(r.out, 'gti: command not found\n');
    assert.match((await run('touch /etc/x')).out, /Permission denied/);
    assert.equal((await run('rm -rf /home/student')).status, 1);
    assert.match((await run('help')).out, /ls/);
});

test('tr, cut, uniq, seq, printf, find, tree', async () => {
    const { run } = await makeEnv();
    assert.equal((await run('echo hallo | tr a-z A-Z')).out, 'HALLO\n');
    assert.equal((await run("echo 'a,b,c' | cut -d , -f 2")).out, 'b\n');
    assert.equal((await run('printf "%s-%s\\n" a b')).out, 'a-b\n');
    assert.equal((await run('seq 3')).out, '1\n2\n3\n');
    await run('mkdir -p d/e && touch d/x.html d/e/y.html d/z.css');
    assert.equal((await run('find d -name "*.html"')).out, 'd/e/y.html\nd/x.html\n');
    assert.equal((await run('tree d')).out, 'd\n├── e\n│   └── y.html\n├── x.html\n└── z.css\n\n1 directory, 3 files\n');
    assert.equal((await run('printf "b\\na\\nb\\n" | sort | uniq -c')).out, '      1 a\n      2 b\n');
});
