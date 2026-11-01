# P007 焦证仪 FocusWitness — 许可证与第三方开源声明

## 1. 第一方代码许可证 (Primary Codebase License)

P007 焦证仪 FocusWitness 的所有第一方手写源代码、脚本、构建配置、测试用例与技术文档均采用 **MIT License**。完整文本详见仓库根目录的 [`LICENSE`](../LICENSE)。

```text
MIT License
Copyright (c) 2026 FocusWitness
```

---

## 2. 依赖审计基准与核对方法 (Audit & Authority)

- 本许可证声明对照 `03_source/package-lock.json` 与 `package.json` 中的全部依赖图谱进行全面审查。
- `package-lock.json` 作为版本与依赖的权威来源，锁定各包的精确版本与哈希。
- 本项目严禁引入未经许可的专有代码或 GPL 等强传染性开源库。经全图谱扫描，依赖树内包含 124 个包/模块项，许可证类型统计如下：

| 许可证类型 | 模块数 | 性质与合规性说明 |
|---|---|---|
| **MIT** | 100 | 宽松开源许可证，完全兼容第一方 MIT 授权。 |
| **Apache-2.0** | 4 | 宽松开源许可证（如 TypeScript），包含专利授权条款，兼容 MIT。 |
| **MPL-2.0** | 12 | 弱互惠许可证（主要为 lightningcss 及其平台二进制包），文件级隔离，构建工具链依赖，不污染打包产物。 |
| **ISC** | 6 | 极简宽松开源许可证，法律效力等同于 2-Clause BSD，完全兼容 MIT。 |
| **BSD-3-Clause** | 1 | 宽松开源许可证，兼容 MIT。 |
| **CC-BY-4.0** | 1 | 知识共享署名许可（caniuse-lite 浏览器兼容性数据表），仅供构建时查表。 |
| **GPL / AGPL** | **0** | **零 GPL / AGPL 传染性代码**。 |

---

## 3. 直接依赖清单 (Direct Dependencies)

下表列出 `03_source/package.json` 中声明的所有直接生产依赖与开发依赖：

| 依赖名称 (Package) | 声明版本 | 锁定版本 (Lockfile) | 许可证 (SPDX) | 依赖类型 | 用途与分发边界 |
|---|---|---|---|---|---|
| `react` | `19.3.1` | `19.3.1` | MIT | 生产依赖 | UI 界面状态响应与组件渲染 |
| `react-dom` | `19.3.1` | `19.3.1` | MIT | 生产依赖 | 浏览器 DOM 挂载与客户端事件绑定 |
| `@types/node` | `24.19.2` | `24.19.2` | MIT | 开发依赖 | Node.js 24 LTS 类型定义 |
| `@types/react` | `19.3.0` | `19.3.0` | MIT | 开发依赖 | React 19 TypeScript 类型定义 |
| `@types/react-dom` | `19.3.0` | `19.3.0` | MIT | 开发依赖 | React DOM TypeScript 类型定义 |
| `@vitejs/plugin-react` | `5.2.0` | `5.2.0` | MIT | 开发依赖 | Vite React 快速刷新与 JSX 转换插件 |
| `typescript` | `5.9.3` | `5.9.3` | Apache-2.0 | 开发依赖 | 静态类型系统检查与代码转译 |
| `vite` | `8.3.5` | `8.3.5` | MIT | 开发依赖 | 本地开发服务器与生产打包构建工具 |
| `vitest` | `4.1.12` | `4.1.12` | MIT | 开发依赖 | 单元测试、数学 Oracle 与回归测试套件 |

---

## 4. 算法与数学实现独立性说明 (Independent Implementation)

1. **核心算法独立自研**：
   - 二维 Radix-2 Cooley-Tukey 快速傅里叶变换（`src/math/fft.ts`）由第一方独立编写，含位反转置换与蝶形运算，无外部 FFTW 或第三方数学库依赖。
   - 圆形光瞳掩模与 Zernike 多项式计算（`src/math/zernike.ts`）基于标准正交多项式解析公式直接离散实现。
   - Fraunhofer 标量相干远场传播正向模型（`src/math/psf.ts`）基于物理光学基元运算自研。
   - 雅可比有限差分、高斯-牛顿信息矩阵构造与阻尼 Levenberg-Marquardt 优化器（`src/math/jacobian.ts`、`src/math/optimizer.ts`）均为第一方手写实现，初值固定、无随机数发生器、无全局隐式状态。
   - 3×3 线性代数求解器（带列主元消元法）与 3×3 实对称矩阵 Jacobi 特征值分解（`src/math/linear3.ts`、`src/math/identifiable.ts`）无任何 LAPACK 或第三方库绑定。

2. **外部参考代码隔离**：
   - 研发过程中调研的外部相位多样性开源参考（如 IDL 相位多样性脚本、Phase-Recovery 项目等）仅作为科学方法和理论背景对比，未复制其任何源代码、测试数据集或界面代码。
   - 项目中所有 Golden 测试夹具（`tests/fixtures/golden-mixed.json`）均通过本项目自研的独立高精度参考 Oracle（`tests/oracle/naiveDft.test.ts`）解析校验生成。

---

## 5. 发布与分发边界声明 (Distribution Boundaries)

1. **静态分发包 (`07_release/dist-release.zip`)**：
   - 仅包含经 Vite 编译优化后的单页应用静态资产（HTML/CSS/JS）、Node 原生极简本地服务脚本（`tools/serve.mjs`）以及运行说明文档。
   - **完全不含** `node_modules` 目录及任何第三方源码树；运行时仅需 Node.js 24 原生内建模块（`node:http`、`node:fs`、`node:path`、`node:url`），无网络依赖，无二次分发许可纠纷。

2. **源码分发包 (`07_release/source-release.zip`)**：
   - 包含第一方手写源码、配置文件、测试套件、构建工具脚本及完整的 `package-lock.json`。
   - 使用者解压后通过 `npm ci` 从官方公共源干净拉取依赖树，依赖的许可证以各官方分发包自带许可证为准。
