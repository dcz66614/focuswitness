// tools/release.mjs — P007 FocusWitness 发布打包与源码审查包生成器
// 运行：npm run release  （即 node tools/release.mjs）
//
// 规范依据：
// - TASK-P007-T017 / 01_project_book/PROJECT_BOOK.md 第 12 节 / 02_implementation_plan/IMPLEMENTATION_PLAN.md 第 8 节
// - 产物写入项目级 07_release/ 与 08_review/（不在源码树内引入打包大文件）
// - TMPDIR 指向工作区磁盘（如 .tmp-release），避免 /tmp (512MB tmpfs) 溢出。
// - 纯 Node.js 原生标准库实现，零外部 npm 依赖。

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 路径解析：03_source 是源码根目录，其父目录是项目根目录
const SOURCE_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(SOURCE_ROOT, '..');
const RELEASE_DIR = path.join(PROJECT_ROOT, '07_release');
const REVIEW_DIR = path.join(PROJECT_ROOT, '08_review');
const TMP_DIR = process.env.TMPDIR || path.join(SOURCE_ROOT, '.tmp-release');

// 排除规则（符合规格：发布包不含 node_modules、dist、.git、临时目录、证据与日志）
const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.tmp-release',
  'evidence',
  '07_release',
  '08_review',
]);
const EXCLUDED_SUFFIXES = ['.log'];
const SECRET_REGEX = /(^|[^a-z])(token|credential|secret|apikey|api_key)(\.|_|$)/i;

function fail(msg) {
  console.error(`release error: ${msg}`);
  process.exit(1);
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

// CRC-32 (IEEE 802.3) 标准表，供 ZIP 无压缩存储模式使用
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

function dosDateTime(date) {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    (Math.floor(date.getSeconds() / 2) & 0x1f);
  const day =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0xf) << 5) |
    (date.getDate() & 0x1f);
  return { time, day };
}

// 编写标准 stored (无压缩) ZIP 文件
export function writeZip(entries, outPath) {
  const chunks = [];
  const central = [];
  let offset = 0;
  // 固定时间戳或使用稳定日期，确保构建可复现
  const date = new Date('2026-11-01T12:00:00Z');
  const now = dosDateTime(date);

  // 按相对路径升序排序，保证确定性构建
  const sortedEntries = [...entries].sort((a, b) => a.name.localeCompare(b.name));

  for (const { name, data } of sortedEntries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    // 本地文件头 (30 bytes)
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // 签名
    header.writeUInt16LE(20, 4);         // 版本
    header.writeUInt16LE(0x0800, 6);     // UTF-8 文件名标志
    header.writeUInt16LE(0, 8);          // 压缩方式: 0 (stored)
    header.writeUInt16LE(now.time, 10);
    header.writeUInt16LE(now.day, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18); // 压缩后大小
    header.writeUInt32LE(data.length, 22); // 未压缩大小
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);         // 扩展区长度

    chunks.push(header, nameBuf, data);

    // 中央目录文件头 (46 bytes)
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);     // 签名
    cd.writeUInt16LE(20, 4);             // 制作版本
    cd.writeUInt16LE(20, 6);             // 提取所需版本
    cd.writeUInt16LE(0x0800, 8);         // UTF-8
    cd.writeUInt16LE(0, 10);             // 压缩方式: 0
    cd.writeUInt16LE(now.time, 12);
    cd.writeUInt16LE(now.day, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);             // 扩展区长度
    cd.writeUInt16LE(0, 32);             // 文件注释长度
    cd.writeUInt16LE(0, 34);             // 磁盘分卷号
    cd.writeUInt16LE(0, 36);             // 内部文件属性
    cd.writeUInt32LE(0, 38);             // 外部文件属性
    cd.writeUInt32LE(offset, 42);        // 本地头相对偏移

    central.push(cd, nameBuf);
    offset += header.length + nameBuf.length + data.length;
  }

  const cdStart = offset;
  const cdSize = central.reduce((sum, b) => sum + b.length, 0);

  // 中央目录结尾记录 (EOCD, 22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);                     // 磁盘号
  eocd.writeUInt16LE(0, 6);                     // 中央目录开始磁盘号
  eocd.writeUInt16LE(sortedEntries.length, 8);  // 本卷目录数
  eocd.writeUInt16LE(sortedEntries.length, 10); // 总目录数
  eocd.writeUInt32LE(cdSize, 12);               // 中央目录大小
  eocd.writeUInt32LE(cdStart, 16);              // 中央目录偏移
  eocd.writeUInt16LE(0, 20);                    // 注释长度

  writeFileSync(outPath, Buffer.concat([...chunks, ...central, eocd]));
}

// 递归遍历文件
function collectFiles(dir, baseRel = '', out = []) {
  if (!existsSync(dir)) return out;
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = baseRel ? `${baseRel}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.tmp')) continue;
      collectFiles(full, rel, out);
    } else if (entry.isFile()) {
      if (EXCLUDED_SUFFIXES.some((s) => entry.name.endsWith(s))) continue;
      if (SECRET_REGEX.test(entry.name)) continue;
      if (entry.name === '.env') continue;
      out.push({
        rel,
        full,
        size: statSync(full).size,
      });
    }
  }
  return out;
}

// 格式化审查包文件块
function formatFileBlock(relPath, fullPath) {
  const content = readFileSync(fullPath, 'utf8');
  const buf = readFileSync(fullPath);
  const size = buf.length;
  const hash = sha256(buf);
  return `FILE_BEGIN path=${relPath} bytes=${size} sha256=${hash}\n${content}\nFILE_END path=${relPath}\n`;
}

async function main() {
  console.log('[release] 开始执行 P007 FocusWitness 发布打包...');

  // 1. 检查前置依赖
  const distIndex = path.join(SOURCE_ROOT, 'dist', 'index.html');
  if (!existsSync(distIndex)) {
    fail('dist/index.html 不存在：请先运行 npm run build 生成静态产物，再运行 npm run release。');
  }

  const requiredFiles = [
    'README.md',
    'LICENSE',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'vite.config.ts',
    'tools/serve.mjs',
    'tools/check-archive.mjs',
    'docs/ALGORITHM.md',
    'docs/LICENSES.md',
    'docs/USER_GUIDE.md',
    'docs/TESTING.md',
    'docs/VM_VALIDATION.md',
  ];

  for (const req of requiredFiles) {
    if (!existsSync(path.join(SOURCE_ROOT, req))) {
      fail(`缺少发布必需文件：${req}`);
    }
  }

  // 确保目标输出目录存在
  mkdirSync(RELEASE_DIR, { recursive: true });
  mkdirSync(REVIEW_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });

  // 2. 收集静态包 (dist-release.zip) 条目
  console.log('[release] 打包静态分发包 dist-release.zip...');
  const distFiles = collectFiles(path.join(SOURCE_ROOT, 'dist'), 'dist', []);
  const distEntries = [
    ...distFiles.map((f) => ({ name: f.rel, data: readFileSync(f.full) })),
    { name: 'tools/serve.mjs', data: readFileSync(path.join(SOURCE_ROOT, 'tools', 'serve.mjs')) },
    {
      name: 'serve.mjs',
      data: Buffer.from(
        '// serve.mjs — FocusWitness 静态分发包本地启动入口\nimport { createStaticServer } from "./tools/serve.mjs";\nimport path from "node:path";\nimport { existsSync, statSync } from "node:fs";\n\nconst port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4173;\nconst host = "127.0.0.1";\nconst root = path.resolve("dist");\nif (!existsSync(root) || !statSync(root).isDirectory()) {\n  console.error("serve: dist 目录不存在");\n  process.exit(1);\n}\nconst server = createStaticServer(root);\nserver.listen(port, host, () => {\n  console.log(`FocusWitness serving ${root} at http://${host}:${port}/`);\n});\n',
        'utf8'
      ),
    },
    { name: 'README.md', data: readFileSync(path.join(SOURCE_ROOT, 'README.md')) },
    { name: 'LICENSE', data: readFileSync(path.join(SOURCE_ROOT, 'LICENSE')) },
    { name: 'docs/USER_GUIDE.md', data: readFileSync(path.join(SOURCE_ROOT, 'docs', 'USER_GUIDE.md')) },
    { name: 'docs/ALGORITHM.md', data: readFileSync(path.join(SOURCE_ROOT, 'docs', 'ALGORITHM.md')) },
    { name: 'docs/LICENSES.md', data: readFileSync(path.join(SOURCE_ROOT, 'docs', 'LICENSES.md')) },
  ];

  const distZipPath = path.join(RELEASE_DIR, 'dist-release.zip');
  writeZip(distEntries, distZipPath);
  const distZipBuf = readFileSync(distZipPath);
  const distSha256 = sha256(distZipBuf);
  console.log(`[release] dist-release.zip 生成完成：${distEntries.length} 个文件，${distZipBuf.length} 字节，SHA-256=${distSha256}`);

  // 3. 收集源码包 (source-release.zip) 条目
  console.log('[release] 打包完整第一方源码包 source-release.zip...');
  const sourceFiles = collectFiles(SOURCE_ROOT, '', []).filter((f) => {
    // 过滤掉不在源码包的文件
    if (f.rel.startsWith('07_release') || f.rel.startsWith('08_review')) return false;
    if (f.rel.startsWith('.tmp')) return false;
    return true;
  });

  const sourceEntries = sourceFiles.map((f) => ({
    name: f.rel,
    data: readFileSync(f.full),
  }));

  const sourceZipPath = path.join(RELEASE_DIR, 'source-release.zip');
  writeZip(sourceEntries, sourceZipPath);
  const sourceZipBuf = readFileSync(sourceZipPath);
  const sourceSha256 = sha256(sourceZipBuf);
  console.log(`[release] source-release.zip 生成完成：${sourceEntries.length} 个文件，${sourceZipBuf.length} 字节，SHA-256=${sourceSha256}`);

  // 4. 写入 07_release/SHA256SUMS.txt（按字母序）
  const sha256sumsContent = [
    `${distSha256}  07_release/dist-release.zip`,
    `${sourceSha256}  07_release/source-release.zip`,
  ].join('\n') + '\n';
  writeFileSync(path.join(RELEASE_DIR, 'SHA256SUMS.txt'), sha256sumsContent, 'utf8');
  console.log('[release] 07_release/SHA256SUMS.txt 写入完成。');

  // 5. 划分逐文件审查包 (REVIEW_PACK_XX.md)
  console.log('[release] 生成 08_review 审查包...');

  // 分组定义（按 IMPLEMENTATION_PLAN 第 8.2 节规格组织）
  const pack1Files = sourceFiles.filter(
    (f) => f.rel.startsWith('src/domain/') || f.rel.startsWith('src/math/')
  );
  const pack2Files = sourceFiles.filter(
    (f) => f.rel.startsWith('src/worker/') || f.rel.startsWith('src/io/')
  );
  const pack3Files = sourceFiles.filter(
    (f) =>
      f.rel.startsWith('src/ui/') ||
      f.rel === 'src/App.tsx' ||
      f.rel === 'src/main.tsx' ||
      f.rel === 'src/app.css' ||
      f.rel.startsWith('tools/') ||
      f.rel.startsWith('docs/') ||
      f.rel === 'package.json' ||
      f.rel === 'tsconfig.json' ||
      f.rel === 'vite.config.ts' ||
      f.rel === 'index.html' ||
      f.rel === '.gitignore' ||
      f.rel === 'README.md' ||
      f.rel === 'LICENSE'
  );
  const pack4Files = sourceFiles.filter(
    (f) => f.rel.startsWith('tests/') && !f.rel.endsWith('.json')
  );

  const packs = [
    {
      name: 'REVIEW_PACK_01.md',
      title: 'Pack 01: 领域模型与核心数学库 (src/domain, src/math)',
      files: pack1Files,
    },
    {
      name: 'REVIEW_PACK_02.md',
      title: 'Pack 02: Web Worker 异步计算与文件输入输出 (src/worker, src/io)',
      files: pack2Files,
    },
    {
      name: 'REVIEW_PACK_03.md',
      title: 'Pack 03: 用户界面、工具脚本、根配置与技术文档 (src/ui, tools, configs, docs)',
      files: pack3Files,
    },
    {
      name: 'REVIEW_PACK_04.md',
      title: 'Pack 04: 自动化测试套件 (tests/math, oracle, contracts, worker, ui)',
      files: pack4Files,
    },
  ];

  const coveredFileSet = new Set();
  const packMeta = [];

  for (const pack of packs) {
    const lines = [
      `# P007 FocusWitness 源码审查包 — ${pack.title}`,
      `生成时间：${new Date().toISOString()}`,
      `收录文件数：${pack.files.length}`,
      '',
      '---',
      '',
    ];

    for (const f of pack.files) {
      coveredFileSet.add(f.rel);
      lines.push(formatFileBlock(f.rel, f.full));
    }

    const packContent = lines.join('\n');
    const packPath = path.join(REVIEW_DIR, pack.name);
    writeFileSync(packPath, packContent, 'utf8');

    const packBuf = readFileSync(packPath);
    packMeta.push({
      name: pack.name,
      title: pack.title,
      fileCount: pack.files.length,
      bytes: packBuf.length,
      sha256: sha256(packBuf),
    });
    console.log(`[release] ${pack.name} 生成：${pack.files.length} 个文件，${packBuf.length} 字节`);
  }

  // 6. 生成 08_review/REVIEW_INDEX.md
  console.log('[release] 生成 08_review/REVIEW_INDEX.md...');

  // 统计手写源文件数（排除自动生成的 lockfile 和大 JSON fixture）
  const handwrittenFiles = sourceFiles.filter(
    (f) => f.rel !== 'package-lock.json' && f.rel !== 'tests/fixtures/golden-mixed.json'
  );

  // 确定性版本标识符
  const releaseId = `p007-fw-source-sha256-${sourceSha256.slice(0, 16)}`;

  const reviewIndexLines = [
    '# P007 焦证仪 FocusWitness — 终审审查索引 (REVIEW_INDEX)',
    '',
    '```text',
    'PROJECT_ID: P007',
    'SPEC_VERSION: 1.0.0',
    `RELEASE_ID: ${releaseId}`,
    `SOURCE_ZIP: source-release.zip`,
    `SOURCE_SHA256: ${sourceSha256}`,
    `DIST_ZIP: dist-release.zip`,
    `DIST_SHA256: ${distSha256}`,
    `HANDWRITTEN_SOURCE_FILES_EXPECTED: ${handwrittenFiles.length}`,
    `HANDWRITTEN_SOURCE_FILES_COVERED: ${coveredFileSet.size}`,
    'PACKS:',
    ...packMeta.map((p) => `  ${p.name}: ${p.fileCount} files, ${p.bytes} bytes, sha256=${p.sha256}`),
    'TEST_EVIDENCE: evidence/regression.log, evidence/math-audit.md, evidence/acceptance.log, evidence/t014-acceptance.log, evidence/t015-acceptance.log, evidence/t016-acceptance.log',
    'BROWSER_EVIDENCE: evidence/browser/U01_default_mixed_blind.png ~ U09_accessibility_focus.png, evidence/performance.csv, evidence/offline.log',
    'LICENSE_EVIDENCE: docs/LICENSES.md',
    '```',
    '',
    '## 1. 审查包清单与范围对照',
    '',
    '| 审查包文件名 | 文件数 | 字节数 | SHA-256 | 收录范围 |',
    '|---|---|---|---|---|',
    ...packMeta.map(
      (p) =>
        `| \`${p.name}\` | ${p.fileCount} | ${p.bytes} | \`${p.sha256}\` | ${p.title} |`
    ),
    '',
    '---',
    '',
    '## 2. 源码发布包全文件清单与覆盖对照 (Source Release Manifest)',
    '',
    '下表列出 `07_release/source-release.zip` 中包含的全部第一方文件、大小、SHA-256、以及在文本审查包中的覆盖状态：',
    '',
    '| 相对路径 (Path) | 类型 (Type) | 字节数 (Bytes) | SHA-256 | 审查包覆盖 | 备注与例外说明 |',
    '|---|---|---|---|---|---|',
  ];

  for (const f of sourceFiles) {
    const isCovered = coveredFileSet.has(f.rel);
    let note = '全文收录于审查包';
    let type = 'Handwritten Source';

    if (f.rel === 'package-lock.json') {
      type = 'Dependency Lockfile';
      note = '自动生成依赖锁，不放入代码审查包；权威许可证见 docs/LICENSES.md';
    } else if (f.rel === 'tests/fixtures/golden-mixed.json') {
      type = 'Golden Data Fixture';
      note = '大型高精度浮点 Golden 校验数据 (244KB)，在测试中自动比对';
    } else if (f.rel.startsWith('docs/') || f.rel === 'README.md' || f.rel === 'LICENSE') {
      type = 'Documentation';
    } else if (f.rel.startsWith('tools/')) {
      type = 'Build / Tool Script';
    } else if (f.rel.startsWith('tests/')) {
      type = 'Test Suite';
    }

    reviewIndexLines.push(
      `| \`${f.rel}\` | ${type} | ${f.size} | \`${sha256(readFileSync(f.full))}\` | ${isCovered ? 'YES' : 'NO (附说明)'} | ${note} |`
    );
  }

  reviewIndexLines.push(
    '',
    '---',
    '',
    '## 3. 验收与还原指引',
    '',
    '1. **解压验证**：解压 `07_release/source-release.zip` 至独立干净目录；',
    '2. **依赖重现**：运行 `npm ci` 从官方公共源干净拉取依赖树；',
    '3. **代码复验**：运行 `npm run verify`，全部 372 项测试与静态类型检查应全部通过；',
    '4. **哈希比对**：运行 `npm run verify:archive`，核验两 ZIP 与审查包哈希严格自洽。',
    ''
  );

  writeFileSync(path.join(REVIEW_DIR, 'REVIEW_INDEX.md'), reviewIndexLines.join('\n'), 'utf8');
  console.log('[release] 08_review/REVIEW_INDEX.md 写入完成。');

  console.log('[release] 全部发布产物与审查包生成完毕！');
}

main().catch((err) => {
  fail(`未捕获异常：${err.stack || err.message}`);
});
