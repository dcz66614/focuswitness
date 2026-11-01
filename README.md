# P007 焦证仪 FocusWitness

> **双焦面像差反演与局部可辨识性实验室**  
> Dual-Plane Phase-Diversity Wavefront Aberration Inversion & Local Identifiability Laboratory

[![Node Version](https://img.shields.io/badge/Node.js-24%20LTS-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.3.1-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8.3.5-646cff.svg)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1.12-yellow.svg)](https://vitest.dev/)
[![Offline First](https://img.shields.io/badge/Network-100%25%20Offline-success.svg)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-brightgreen.svg)](LICENSE)

---

## 1. 项目简介与科学定位

**P007 焦证仪 (FocusWitness)** 是一套用于光学远场衍射波前传感、双焦面像差反演以及局部可辨识性分析的交互式桌面实验室。

在单焦面光学强度探测中，由于强度测量丢失了光瞳场的相位信息，许多像差组合（如正负像散、彗差）会产生极度相似甚至不可分辨的焦面光斑；通过引入已知且恒定的双焦面多样性（Phase Diversity Defocus，固定离焦值 $d = \pm 0.65\lambda$），系统能够有效破除像差符号歧义，显著提升反演逆问题的局部可辨识性。

### 核心物理与数值规格
- **离散采样**：$64 \times 64$ 规则采样网格（单平面 4096 像素），行主序存储。
- **光瞳孔径**：中心坐标 $(32, 32)$，孔径半径 $R = 16\text{ px}$（无中心遮挡标量圆形光瞳）。
- **多样性离焦**：负焦面 $d = -0.65\lambda$（$Z_{20}$ 离焦多项式），正焦面 $d = +0.65\lambda$。
- **待估计像差**：
  1. $a_{\text{astig0}}$：$0^\circ$ 像散（Zernike 模式 $Z_{22} = \sqrt{6}(u^2 - v^2)$），取值范围 $[-0.15, +0.15]\lambda$。
  2. $a_{\text{comaX}}$：$x$ 向彗差（Zernike 模式 $Z_{31} = \sqrt{8}(3r^2 - 2)u$），取值范围 $[-0.15, +0.15]\lambda$。
  3. $a_{\text{sph}}$：初级球差（Zernike 模式 $Z_{40} = \sqrt{5}(6r^4 - 6r^2 + 1)$），取值范围 $[-0.15, +0.15]\lambda$。
- **正向传播模型**：光瞳复振幅 $\rightarrow$ 第一方独立 2D Radix-2 FFT $\rightarrow$ 强度计算 $\rightarrow$ `fftshift` 零频对齐 $\rightarrow$ 能量守恒归一化。
- **反演求解器**：基于中心差分雅可比矩阵的阻尼 Levenberg-Marquardt (LM) 求解器，初值固定为 $[0, 0, 0]$，盒约束截断，上限 60 步。
- **局部信息谱分析**：在反演终点统一参考点求值高斯-牛顿信息矩阵 $G = J^T J$，给出局部灵敏度特征值与奇异值谱，严格标明科学边界。

---

## 2. 界面蓝图与核心功能

FocusWitness 采用专为宽屏设计的 3 列桌面工作台布局（支持窄屏自适应垂直堆叠）：

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ FocusWitness  焦证仪       预设选择    [造像] [盲解] [取消] [导入] [导出]    当前运行状态 │
├──────────────────────┬──────────────────────────────────────────┬───────────────────────┤
│ 左：光瞳/实验配置    │ 中：证据矩阵（相同分辨率与色标）         │ 右：反演与可信度       │
│ 像散/彗差/球差滑杆   │ 观测焦面(-0.65) 观测焦面(+0.65)        │ 模式 单焦/双焦         │
│ 真值显示开关         │ 重投影(-0.65)   重投影(+0.65)          │ 估计系数、数值残差     │
│ 波前彩色图           │ 残差(-0.65)     残差(+0.65)            │ LM 轨迹与阻尼          │
│ 3种 Z 模式图例       │ 光强对数显示/线性显示、放大倍率       │ 局部信息谱比较         │
├──────────────────────┴──────────────────────────────────────────┴───────────────────────┤
│ 底：物理简化说明、JSON/PNG 导出与可复核数据、无障碍文字替代复制                        │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **左侧栏（光瞳与实验配置）**：像差滑杆控制（像散、彗差、球差）、5 种典型预设（理想、纯像散、纯彗差、纯球差、混合像差）、真实波前 $W(u,v)$ 彩色热图（Viridis 配色）与 PV/RMS 统计。
2. **中央栏（证据矩阵）**：6 幅焦面视图并置（观测焦面、重投影焦面、残差焦面），相同几何分辨率与一致对比度，残差采用双极发散色标（蓝-白-红），支持对数标度 $\log_{10}(I + 10^{-8})$ 与物理线性标度切换。
3. **右侧栏（反演与局部信息谱）**：反演模式选择（单焦/双焦）、LM 轨迹折线图与迭代历史、迭代回放控制器、以及基于共同参考点的高斯-牛顿信息矩阵特征值/奇异值谱对比分析。
4. **底栏（复核与导出）**：实验案例 JSON 导出/导入、复合证据 PNG 全景快照导出、屏幕阅读器文本替代一键复制。

---

## 3. 快速上手与运行命令

### 环境要求
- **操作系统**：Linux / macOS / Windows
- **运行时**：Node.js 24 LTS 或更高版本
- **包管理器**：npm 10 或更高版本

### 安装与重现
```bash
# 1. 干净安装锁定依赖
npm ci

# 2. 完整验证（类型检查 + 372项测试 + 生产构建）
npm run verify

# 3. 启动开发服务器（支持 HMR）
npm run dev

# 4. 生产静态构建
npm run build

# 5. 本地安全生产预览（仅监听 127.0.0.1:4173，禁止外网与目录穿越）
npm run serve
```

### 发布打包与归档验证
```bash
# 生成发布包（输出到项目级 07_release/）
npm run release

# 验证发布包完整性、静态解包运行与源码干净还原构建
npm run verify:archive
```

---

## 4. 目录结构与模块说明

```text
03_source/
├── src/
│   ├── main.tsx              # 应用入口挂载点
│   ├── App.tsx               # 根组件与状态分发
│   ├── app.css               # 样式定义（深色实验室风格，响应式与高对比度）
│   ├── domain/               # 领域模型、物理常量与参数校验
│   │   ├── constants.ts      # 网格、波长、采样、物理界限常量
│   │   ├── presets.ts        # 5 组官方冻结像差预设
│   │   ├── types.ts          # 强类型数据合同定义
│   │   └── validation.ts     # 运行时参数安全范围校验
│   ├── math/                 # 第一方自研无依赖数学库
│   │   ├── fft.ts            # 2D Radix-2 Cooley-Tukey FFT & fftshift
│   │   ├── zernike.ts        # 圆光瞳掩模与 Zernike 多项式正交基
│   │   ├── psf.ts            # 相干远场衍射正向成像与归一化
│   │   ├── linear3.ts        # 3×3 高斯列主元消元与正规方程求解
│   │   ├── jacobian.ts       # 中心有限差分雅可比与高斯-牛顿曲率矩阵
│   │   ├── optimizer.ts      # 盒约束 Levenberg-Marquardt 非线性阻尼优化器
│   │   └── identifiable.ts   # 共同参考点信息矩阵、Jacobi 特征分解与条件数
│   ├── io/                   # 序列化与文件导出
│   │   ├── caseFile.ts       # JSON 实验案例格式导出与解析导入
│   │   ├── reportFile.ts     # 结构化科学证据 Markdown 导出
│   │   └── exportPng.ts      # 全景证据矩阵复合 Canvas 导出
│   ├── worker/               # Web Worker 异步计算管线
│   │   ├── compute.worker.ts # 独立后台 Worker 运算核心
│   │   └── client.ts         # 主线程 Promise/事件型 Worker 客户端
│   └── ui/                   # React 界面组件
│       ├── Shell.tsx         # 3 栏桌面实验室工作台骨架
│       ├── Controls.tsx      # 左侧栏控制与预设选择
│       ├── WavefrontCanvas.ts# 光瞳波前彩色热图渲染
│       ├── PsfsCanvas.tsx    # 焦面强度分布 Canvas 渲染
│       ├── ResidualCanvas.tsx# 焦面差值残差 Canvas 渲染
│       ├── FitPanel.tsx      # 右侧栏反演进度、轨迹与控制
│       ├── HistoryPlot.tsx   # 优化目标函数与阻尼变化历史图
│       ├── EvidencePanel.tsx # 局部信息谱对比与科学边界提示
│       └── MetricsLegend.tsx # 标尺图例与图例说明
├── tests/                    # 完整自动化测试套件（365 项全绿）
│   ├── math/                 # 数学算法与单调性测试
│   ├── oracle/               # 独立 O(N⁴) 朴素 DFT 与 Golden 证据核对
│   ├── contracts/            # JSON 契约与预设往返测试
│   ├── worker/               # Worker 协议与异步取消测试
│   ├── ui/                   # 界面交互、渲染与无障碍测试
│   └── fixtures/             # 冻结 Golden 真实数据
├── tools/                    # 构建与分发运维工具
│   ├── serve.mjs             # 原生 Node.js 24 静态服务器
│   ├── release.mjs           # 发布包与审查包生成器
│   └── check-archive.mjs     # 发布包结构/还原双向校验器
└── docs/                     # 完备工程技术文档
    ├── ALGORITHM.md          # 详细算法原理与数学推导
    ├── LICENSES.md           # 许可证与第三方开源审计
    ├── USER_GUIDE.md         # 详细用户操作使用手册
    ├── TESTING.md            # 测试架构与证据矩阵报告
    └── VM_VALIDATION.md      # Linux 实机浏览器/性能/离线复核报告
```

---

## 5. 质量保证与测试矩阵

项目具备完备的测试与验证体系，执行 `npm run verify` 时自动触发全部静态检查与自动化测试：
- **静态类型与代码质量**：`tsc --noEmit` 零类型错误。
- **单元与集成测试套件**：15 个测试文件，共 **372 项独立测试**，100% 通过：
  - `tests/math/` (83 tests)：FFT 精度、Parseval 定理、PSF 能量守恒、LM 优化收敛、局部信息单调性。
  - `tests/oracle/` (40 tests)：以 $O(N^4)$ 朴素 DFT 为独立 Oracle 交叉校验 FFT 精度（误差 $< 10^{-13}$），Golden 像素级复核。
  - `tests/contracts/` (61 tests)：输入合法性边界、JSON 案例 5 组预设无损导出与回读往返。
  - `tests/worker/` (16 tests)：协议通信、耗时任务后台执行、用户主动中断取消。
  - `tests/ui/` (170 tests)：界面装配、无障碍键盘导航、Canvas 渲染、历史回放进度条、默认隐藏真值、高对比度证据面板。
  - `src/App.tsx` (2 tests)：应用根级冒烟测试。
- **真实浏览器与离线复核**：
  - 真实 Chromium 无头环境复核通过，生成 9 张无损截图 (`evidence/browser/U01` ~ `U09`)；
  - 100% 离线运行，外发网络请求严格为 0；
  - 运算响应性能优秀（冷启动 0.204s，暖启动中位数 0.084s，远低于 2.0s 预算）。

---

## 6. 文档与参考链接

- [算法原理与物理推导 (docs/ALGORITHM.md)](docs/ALGORITHM.md)
- [用户使用指南 (docs/USER_GUIDE.md)](docs/USER_GUIDE.md)
- [测试工程与质量矩阵 (docs/TESTING.md)](docs/TESTING.md)
- [技术偏差记录说明 (docs/TECHNICAL_DEVIATIONS.md)](docs/TECHNICAL_DEVIATIONS.md)
- [环境实测与浏览器证据 (docs/VM_VALIDATION.md)](docs/VM_VALIDATION.md)
- [第三方许可证声明 (docs/LICENSES.md)](docs/LICENSES.md)

---

## 7. 许可证

本项目第一方源代码与文档采用 [MIT 许可证](LICENSE) 授权。
详细依赖许可审计见 [docs/LICENSES.md](docs/LICENSES.md)。
