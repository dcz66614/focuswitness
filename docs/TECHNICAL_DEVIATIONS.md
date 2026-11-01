# P007 FocusWitness — 技术设计偏差登记簿 (TECHNICAL_DEVIATIONS.md)

**项目编号：** P007  
**项目名称：** FocusWitness 焦证仪 (双焦面像差反演与局部可辨识性实验室)  
**登记任务：** `TASK-P007-QA-R1` (第 1 轮修复后独立 QA 重验)  
**依据来源：** GPT 终审第 1 轮审查意见项 `N002` (non-blocking) 与项目规划约定  
**当前状态：** 已登记、受控、非阻断 (Non-blocking)  

---

## 1. 偏差条目总览

| 偏差编号 | 偏差类别 | 影响级别 | 涉及模块 | 登记日期 | 解决优先级 |
|---|---|---|---|---|---|
| **DEV-P007-N002** | 架构设计偏差 (主线程计算调用) | 低 (非阻断) | `src/App.tsx`, `src/ui/EvidencePanel.tsx` | 2026-11-01 | 后续架构重构优先复用 Worker ANALYZE |

---

## 2. DEV-P007-N002 详细说明

### 2.1 规划约定与基线要求
在项目规格 `PROJECT_BOOK.md`（第 2.2 节、第 9 节）及 `IMPLEMENTATION_PLAN.md`（第 2.2 节）中约定：
1. **单一计算入口：** 核心数值计算、正向造像模拟、雅可比矩阵求值、LM 反演拟合及奇异值分解等大计算过程，应收敛至唯一的 Web Worker (`src/worker/compute.worker.ts`) 执行，保持主线程纯净负责 UI 状态分发与 Canvas 渲染。
2. **单一并发 Worker：** 严格限定一个 Dedicated Web Worker，不创建第二 Worker，避免线程竞态与内存争用。

### 2.2 实际实现与偏差现状
在当前前端代码实现中：
1. **主线程直接调用与精确模块归属：**
   - `src/App.tsx`：直接导入并同步调用了 `src/math/psf.ts` 中的 `forwardPsf`（用于重投影 PSF 计算）、`src/math/zernike.ts` 中的 `wavefront`（用于波前相位图展开），以及 `src/math/identifiable.ts` 中的 `analyzeLocal`（用于状态更新时的局部可辨识性评估）；
   - `src/ui/EvidencePanel.tsx`：仅导入并同步调用了 `src/math/identifiable.ts` 中的 `analyzeLocal`（当未直接传入外部预算好的 analysisResult 时，在估算完成时计算单/双焦信息矩阵、奇异值与增益比），未直接导入 `forwardPsf` 或 `wavefront`。
2. **现象描述：** 
   - 界面在挂载与更新估算参数时，直接在主 UI 线程计算了重投影 PSF、残差矩阵及局部可辨识性信息谱奇异值；
   - 偏离了“所有大计算过程唯一通过 Worker 异步消息驱动”的原规划设想。

### 2.3 影响评估 (Impact Assessment)
1. **性能与耗时实测：**
   - 64×64 标量 Fraunhofer PSF 单次正向造像（含 2D Radix-2 FFT）在主线程耗时约为 0.2~0.5 ms；
   - `analyzeLocal` 评估函数需在参考点 $a_{\text{ref}}$ 分别计算单焦与双焦有限差分雅可比（单焦 1 次基线 + 3×2 次扰动 = 7 次 64×64 PSF；双焦 2 次基线 + 3×4 次扰动 = 14 次 64×64 PSF，共计 21 次 PSF 正向造像），并执行两次 3×3 Gram 矩阵乘积与 Jacobi 对称特征值分解，在 Linux VM 环境实测耗时约为 4~8 ms（总 UI 处理周期 6~12 ms）；
   - 耗时仍低于单帧 16.6 ms 渲染预算，未引发主线程卡顿、掉帧或用户交互迟滞；
   - 作为对比，60 步完整 LM 盲解反演迭代已严格隔离在专用 Web Worker (`src/worker/compute.worker.ts`) 线程中异步执行，Linux VM 实机耗时中位数为 2.25 秒（规格上限 10 秒），完全满足性能基线要求。
2. **多线程安全性：**
   - 现有系统**未创建**第二个 Web Worker，完全符合“单一 Worker”的上限硬约束；
   - 主线程无竞态、无死锁隐患。
3. **算法准确度：**
   - 主线程调用的数学函数与 Worker 内部执行的数学模块完全复用相同的 `src/math/**` 纯函数，单/双焦奇异值计算结果与测试套件 100% 一致。

### 2.4 后续整改与演化路径
1. **现有资产就绪：**
   - 消息协议类型定义在 `src/domain/types.ts`（包含 `WorkerRequest`、`WorkerResponse`、`AnalyzeRequest`、`AnalyzeResponse` 等），`src/worker/compute.worker.ts` 中已完备实现了 `ANALYZE` 协议分支（接收 `runId`、`observations`、`reference`，并在 Worker 线程执行 `analyzeLocal`，返回特征值、奇异值谱及单双焦比较结果）；
   - `src/worker/client.ts` 已完备实现了 `analyzeLocal(observations, reference, runId)` 方法。
2. **整改建议：**
   - 在后续版本维护中，将 `EvidencePanel` 的分析请求调整为通过 `effectiveWorkerClient.analyzeLocal()` 异步触发，主线程仅消费 Promise 结果，实现 Worker 作为唯一大计算入口的完全收敛。
