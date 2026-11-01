// tools/check-archive.mjs — P007 FocusWitness 发布包与源码审查包校验脚本
// 运行：npm run verify:archive  （即 node tools/check-archive.mjs）
//
// 校验范围：
// 1. 07_release/ 下 dist-release.zip、source-release.zip、SHA256SUMS.txt 齐全且哈希自洽；
// 2. 静态包结构合法，不含 node_modules / 源码 / .env / 凭证；
// 3. 静态包解压可起服务，HTTP 200，MIME 正确，防目录穿越生效；
// 4. 源码包结构完整，解压后经 npm ci && npm run build 可干净复现 dist/index.html；
// 5. 08_review/REVIEW_INDEX.md 与 REVIEW_PACK_XX.md 逐文件哈希与源码包 100% 精确一致；
// 6. 临时目录全部置于工作区磁盘，避免 /tmp (512MB tmpfs) 溢出。

import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 解析目录位置：兼顾从 03_source 运行或从项目根目录运行
const cwd = process.cwd();
const SOURCE_ROOT = existsSync(path.join(cwd, 'package.json'))
  ? cwd
  : path.resolve(__dirname, '..');

const PROJECT_ROOT = existsSync(path.join(cwd, '07_release'))
  ? cwd
  : path.resolve(SOURCE_ROOT, '..');

const RELEASE_DIR = path.join(PROJECT_ROOT, '07_release');
const REVIEW_DIR = path.join(PROJECT_ROOT, '08_review');
const TMP_BASE = process.env.TMPDIR || path.join(SOURCE_ROOT, '.tmp-release');

const failures = [];

function check(ok, message) {
  const symbol = ok ? '✓ ok  ' : '✗ FAIL';
  console.log(`${symbol} ${message}`);
  if (!ok) {
    failures.push(message);
  }
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

// CRC-32 (IEEE 802.3)
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// 读取 stored ZIP
function readZip(zipPath) {
  const buf = readFileSync(zipPath);
  if (buf.length < 22 || buf.readUInt32LE(buf.length - 22) !== 0x06054b50) {
    throw new Error(`${zipPath} 不是合法的 ZIP 文件（缺少有效 EOCD 记录）`);
  }

  const count = buf.readUInt16LE(buf.length - 12);
  const cdSize = buf.readUInt32LE(buf.length - 10);
  const cdStart = buf.readUInt32LE(buf.length - 6);

  if (cdStart + cdSize > buf.length - 22) {
    throw new Error('ZIP 中央目录边界越界');
  }

  const entries = new Map();
  let p = cdStart;

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error(`第 ${i} 个中央目录记录签名错误`);
    }

    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    if (method !== 0) {
      throw new Error(`不支持的压缩方式 ${method}（本发布仅使用 stored 方式）`);
    }

    if (buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`文件 ${name} 的本地头签名错误`);
    }

    const lhNameLen = buf.readUInt16LE(localOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);

    if (crc32(data) !== crc) {
      throw new Error(`CRC32 校验失败：${name}`);
    }

    entries.set(name, Buffer.from(data));
    p += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

// 解压 entry 集合到指定目录
function extractEntries(entries, targetDir) {
  for (const [relPath, data] of entries) {
    const fullPath = path.resolve(targetDir, relPath);
    if (!fullPath.startsWith(targetDir + path.sep) && fullPath !== targetDir) {
      throw new Error(`非法路径穿越条目：${relPath}`);
    }
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, data);
  }
}

// 简易 HTTP 请求辅助函数
function fetchHttp(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: requestPath,
        method: 'GET',
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// 静态包服务冒烟测试
async function smokeTestStatic(distExtractDir) {
  const port = 4195;
  const serveScript = path.join(distExtractDir, 'serve.mjs');
  if (!existsSync(serveScript)) {
    check(false, `dist-release 缺少启动脚本：${serveScript}`);
    return;
  }

  const child = spawn(process.execPath, [serveScript], {
    cwd: distExtractDir,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    let home = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 150));
      try {
        home = await fetchHttp(port, '/');
        if (home && home.status === 200) break;
      } catch {
        // 等待服务监听就绪
      }
    }

    check(!!home && home.status === 200, `静态包 serve 根路径 HTTP 200（实际状态：${home?.status ?? '未启动'}）`);
    const homeHtml = home ? home.body.toString('utf8') : '';
    check(
      homeHtml.includes('FocusWitness') || homeHtml.includes('焦证仪'),
      '静态包首页包含 FocusWitness 标题'
    );

    // 检查 assets 内的 JS MIME
    const assetsDir = path.join(distExtractDir, 'dist', 'assets');
    if (existsSync(assetsDir)) {
      const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
      if (jsFiles.length > 0) {
        const jsRes = await fetchHttp(port, `/assets/${jsFiles[0]}`);
        const ctype = String(jsRes.headers['content-type'] || '');
        check(
          jsRes.status === 200 && ctype.includes('javascript'),
          `静态包 JS 文件 MIME 包含 javascript (实际 ${ctype})`
        );
      } else {
        check(false, 'dist/assets 下无 JS 文件');
      }
    } else {
      check(false, 'dist/assets 目录不存在');
    }

    // 目录穿越安全防护测试
    const traversal = await fetchHttp(port, '/%2e%2e/package.json');
    check(
      traversal.status === 404,
      `目录穿越请求 /%2e%2e/package.json 返回 404（实际状态：${traversal.status}）`
    );
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function main() {
  console.log('=== [check-archive] 开始执行发布包与审查包全面校验 ===\n');

  // 1. 产物存在性检查
  const distZip = path.join(RELEASE_DIR, 'dist-release.zip');
  const sourceZip = path.join(RELEASE_DIR, 'source-release.zip');
  const sumsTxt = path.join(RELEASE_DIR, 'SHA256SUMS.txt');
  const reviewIndex = path.join(REVIEW_DIR, 'REVIEW_INDEX.md');
  const pack1 = path.join(REVIEW_DIR, 'REVIEW_PACK_01.md');
  const pack2 = path.join(REVIEW_DIR, 'REVIEW_PACK_02.md');
  const pack3 = path.join(REVIEW_DIR, 'REVIEW_PACK_03.md');
  const pack4 = path.join(REVIEW_DIR, 'REVIEW_PACK_04.md');

  for (const [desc, file] of [
    ['07_release/dist-release.zip', distZip],
    ['07_release/source-release.zip', sourceZip],
    ['07_release/SHA256SUMS.txt', sumsTxt],
    ['08_review/REVIEW_INDEX.md', reviewIndex],
    ['08_review/REVIEW_PACK_01.md', pack1],
    ['08_review/REVIEW_PACK_02.md', pack2],
    ['08_review/REVIEW_PACK_03.md', pack3],
    ['08_review/REVIEW_PACK_04.md', pack4],
  ]) {
    check(existsSync(file), `产物文件存在：${desc}`);
  }

  if (failures.length > 0) {
    console.error('\n[check-archive] 关键产物缺失，中止校验。');
    process.exit(1);
  }

  // 2. 哈希一致性校验
  console.log('\n--- 2. SHA256SUMS 校验 ---');
  const actualDistSha = sha256(readFileSync(distZip));
  const actualSourceSha = sha256(readFileSync(sourceZip));
  const sumsContent = readFileSync(sumsTxt, 'utf8');

  check(
    sumsContent.includes(`${actualDistSha}  07_release/dist-release.zip`),
    `SHA256SUMS.txt 包含 dist-release.zip 正确哈希 (${actualDistSha})`
  );
  check(
    sumsContent.includes(`${actualSourceSha}  07_release/source-release.zip`),
    `SHA256SUMS.txt 包含 source-release.zip 正确哈希 (${actualSourceSha})`
  );

  // 3. 静态包结构与冒烟运行校验
  console.log('\n--- 3. 静态分发包 dist-release.zip 校验 ---');
  const distEntries = readZip(distZip);
  check(distEntries.has('dist/index.html'), '静态包含 dist/index.html');
  check(distEntries.has('serve.mjs'), '静态包含 serve.mjs');
  check(distEntries.has('tools/serve.mjs'), '静态包含 tools/serve.mjs');
  check(distEntries.has('README.md'), '静态包含 README.md');
  check(distEntries.has('LICENSE'), '静态包含 LICENSE');
  check(distEntries.has('docs/ALGORITHM.md'), '静态包含 docs/ALGORITHM.md');
  check(distEntries.has('docs/LICENSES.md'), '静态包含 docs/LICENSES.md');

  const distEntryKeys = [...distEntries.keys()];
  const distHasNodeModules = distEntryKeys.some((k) => k.includes('node_modules'));
  const distHasSecrets = distEntryKeys.some((k) => /(^|\/)\.env$|token|credential|secret/i.test(k));
  check(!distHasNodeModules, '静态包严格不含 node_modules');
  check(!distHasSecrets, '静态包严格不含 .env / 凭据文件');

  // 解压并启动冒烟
  mkdirSync(TMP_BASE, { recursive: true });
  const distSmokeDir = mkdtempSync(path.join(TMP_BASE, 'dist-smoke-'));
  try {
    extractEntries(distEntries, distSmokeDir);
    await smokeTestStatic(distSmokeDir);
  } finally {
    rmSync(distSmokeDir, { recursive: true, force: true });
  }

  // 4. 源码包结构与还原构建校验
  console.log('\n--- 4. 源码包 source-release.zip 结构与还原构建校验 ---');
  const sourceEntries = readZip(sourceZip);
  const sourceKeys = [...sourceEntries.keys()];

  check(sourceEntries.has('package.json'), '源码包含 package.json');
  check(sourceEntries.has('package-lock.json'), '源码包含 package-lock.json');
  check(sourceEntries.has('tsconfig.json'), '源码包含 tsconfig.json');
  check(sourceEntries.has('vite.config.ts'), '源码包含 vite.config.ts');
  check(sourceEntries.has('src/App.tsx'), '源码包含 src/App.tsx');
  check(sourceEntries.has('src/domain/types.ts'), '源码包含 src/domain/types.ts');
  check(sourceEntries.has('src/math/optimizer.ts'), '源码包含 src/math/optimizer.ts');
  check(sourceEntries.has('tests/math/fft.test.ts'), '源码包含 tests/math/fft.test.ts');
  check(sourceEntries.has('tests/fixtures/golden-mixed.json'), '源码包含 tests/fixtures/golden-mixed.json');

  const sourceHasNodeModules = sourceKeys.some((k) => k.startsWith('node_modules/'));
  const sourceHasDist = sourceKeys.some((k) => k.startsWith('dist/'));
  const sourceHasGit = sourceKeys.some((k) => k.startsWith('.git/'));
  check(!sourceHasNodeModules, '源码包严格不含 node_modules');
  check(!sourceHasDist, '源码包严格不含 dist 编译产物');
  check(!sourceHasGit, '源码包严格不含 .git 目录');

  // 干净重现构建验证
  console.log('[check-archive] 解压源码包至临时工作区并执行 npm ci && npm run build 还原构建...');
  const sourceRestoreDir = mkdtempSync(path.join(TMP_BASE, 'source-restore-'));
  try {
    extractEntries(sourceEntries, sourceRestoreDir);
    check(existsSync(path.join(sourceRestoreDir, 'package.json')), '还原目录存在 package.json');

    // 运行 npm ci
    execFileSync('npm', ['ci'], {
      cwd: sourceRestoreDir,
      stdio: 'pipe',
      timeout: 300000,
    });
    check(true, '源码包还原目录 npm ci 成功执行');

    // 运行 npm run build
    execFileSync('npm', ['run', 'build'], {
      cwd: sourceRestoreDir,
      stdio: 'pipe',
      timeout: 300000,
    });
    const builtIndex = path.join(sourceRestoreDir, 'dist', 'index.html');
    check(existsSync(builtIndex), '源码包还原目录 npm run build 成功生成 dist/index.html');
  } catch (err) {
    const detail = String(err.stdout || '') + String(err.stderr || '') + String(err.message || '');
    check(false, `源码包还原构建失败：${detail.slice(-300)}`);
  } finally {
    rmSync(sourceRestoreDir, { recursive: true, force: true });
  }

  // 5. 审查包 08_review 与源码包一致性核验
  console.log('\n--- 5. 08_review 逐文件审查包核验 ---');
  const reviewIndexContent = readFileSync(reviewIndex, 'utf8');
  check(
    reviewIndexContent.includes(`SOURCE_SHA256: ${actualSourceSha}`),
    'REVIEW_INDEX.md 记录的 SOURCE_SHA256 与实际一致'
  );
  check(
    reviewIndexContent.includes(`DIST_SHA256: ${actualDistSha}`),
    'REVIEW_INDEX.md 记录的 DIST_SHA256 与实际一致'
  );
  const expectedMatch = reviewIndexContent.match(/HANDWRITTEN_SOURCE_FILES_EXPECTED:\s*(\d+)/);
  const coveredMatch = reviewIndexContent.match(/HANDWRITTEN_SOURCE_FILES_COVERED:\s*(\d+)/);
  const expCount = expectedMatch ? parseInt(expectedMatch[1], 10) : 0;
  const covCount = coveredMatch ? parseInt(coveredMatch[1], 10) : -1;
  check(
    expCount > 0 && expCount === covCount,
    `REVIEW_INDEX.md 期望审查文件数与实际覆盖文件数一致 (${expCount}/${covCount})`
  );

  const packFiles = [pack1, pack2, pack3, pack4];
  let totalReviewFiles = 0;
  let allPacksConsistent = true;

  for (const packPath of packFiles) {
    const packText = readFileSync(packPath, 'utf8');
    const regex = /FILE_BEGIN path=([^\s]+) bytes=(\d+) sha256=([0-9a-f]{64})\n([\s\S]*?)\nFILE_END path=\1/g;
    let match;
    let packCount = 0;

    while ((match = regex.exec(packText)) !== null) {
      packCount++;
      totalReviewFiles++;
      const [_, filePath, bytesStr, expectedHash, fileContent] = match;
      const expectedBytes = parseInt(bytesStr, 10);

      const zipFileBuf = sourceEntries.get(filePath);
      if (!zipFileBuf) {
        check(false, `审查包中声明的文件在 source-release.zip 中不存在：${filePath}`);
        allPacksConsistent = false;
        continue;
      }

      const zipFileHash = sha256(zipFileBuf);
      if (zipFileBuf.length !== expectedBytes || zipFileHash !== expectedHash) {
        check(
          false,
          `文件哈希或字节数不一致：${filePath}（包内 ${zipFileBuf.length}B/${zipFileHash}，审查包 ${expectedBytes}B/${expectedHash}）`
        );
        allPacksConsistent = false;
      }

      // 核对纯文本内容
      const zipFileText = zipFileBuf.toString('utf8');
      if (zipFileText !== fileContent) {
        check(false, `文件文本内容与 source-release.zip 不一致：${filePath}`);
        allPacksConsistent = false;
      }
    }

    check(packCount > 0, `${path.basename(packPath)} 包含 ${packCount} 个合规文件块`);
  }

  check(
    allPacksConsistent && totalReviewFiles > 0,
    `审查包内全部 ${totalReviewFiles} 个手写源码/配置/文档文件与 source-release.zip 严格一致`
  );

  // 6. 清理临时基目录
  if (existsSync(TMP_BASE)) {
    rmSync(TMP_BASE, { recursive: true, force: true });
  }

  // 7. 汇总退出
  console.log('\n======================================================');
  if (failures.length > 0) {
    console.error(`[check-archive] FAIL: 发现 ${failures.length} 项校验失败！`);
    for (const f of failures) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  }

  console.log('[check-archive] PASS: 全部 07_release 发布包与 08_review 审查包校验通过！');
  process.exit(0);
}

main().catch((err) => {
  console.error(`[check-archive] 异常失败：${err.stack || err.message}`);
  process.exit(1);
});
