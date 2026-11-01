# P007 焦证仪 FocusWitness — 算法原理与数值工程白皮书 (ALGORITHM)

版本：1.0.0  
编制：FocusWitness Release & Algorithm Engineering Team  
基准标准：`01_project_book/PROJECT_BOOK.md` 第 5 节，`02_implementation_plan/IMPLEMENTATION_PLAN.md` 第 3 节

---

## 1. 物理背景与科学问题 (Theoretical Formulation)

### 1.1 相位丢失与像差符号歧义 (Phase Retrieval Dilemma)
在标量衍射光学系统中，探测器（CCD/CMOS）只能记录光波场的强度分布（像平面辐照度），而丢失了光瞳面上光场的相位信息：
$$I(x,y) = |F\{P(u,v)\}|^2$$
对于具有中心对称性或特定偶次/奇次像差组合（如正负像散 $a_{\text{astig0}} \gtrless 0$ 或彗差组合），在单个高斯聚焦面或单一离焦面上，不同符号的像差可能产生高度相似、甚至在离散采样误差内完全同构的衍射光斑。这使得从单幅焦面图像反演波前像差的逆问题严重病态，存在固有的参数符号歧义与局部极小陷阱。

### 1.2 双焦面相位多样性 (Phase Diversity Principle)
相位多样性（Phase Diversity，由 Gonsalves 与 Paxman 奠基）通过在光路中引入已知且恒定的相位差，同时采集两幅或多幅空间不同焦面的像斑：
- **负焦面**：引入已知离焦 $d_- = -0.65\lambda$（对应 Zernike $Z_{20}$ 模式）；
- **正焦面**：引入已知离焦 $d_+ = +0.65\lambda$。

由于已知离焦破除了波前相位的对称性退化，正负像差与已知离焦相干叠加后，分别在两焦面上引起截然相反的斑样形变（一侧加剧变形、另一侧部分补偿），从而在物理机理上彻底消除了像差符号的简并性，显著提升了反演问题的适定性与可辨识度。

---

## 2. 离散空间几何与坐标系定义 (Discrete Geometry)

本项目采用严格固定的离散化网格体系，全流程统一，禁止任意缩放或浮动补零：

1. **计算网格**：
   - 方形采样矩阵尺寸 $N \times N = 64 \times 64$，单平面总像素数 $M = 4096$。
   - 内存采用紧凑一维 `Float64Array` 存储，遵循标准行主序寻址：
     $$\text{index} = y \times N + x, \quad x, y \in [0, 63]$$

2. **光瞳连续归一化坐标**：
   - 光瞳物理中心对齐网格几何中心 $(N/2, N/2) = (32, 32)$。
   - 每个像素的采样中心对应归一化坐标 $(u, v)$：
     $$u = \frac{x + 0.5 - 32}{16}, \quad v = \frac{y + 0.5 - 32}{16}$$
   - 归一化极径平方：$r^2 = u^2 + v^2$。
   - 标量圆形通光孔径掩模 $A(u,v)$：
     $$A(u,v) = \begin{cases} 1.0, & r^2 \le 1.0 \\ 0.0, & r^2 > 1.0 \end{cases}$$
   - 有效光瞳半径 $R = 16\text{ px}$，光瞳孔径外像素强制置零，无中心遮挡。
   - 空间过采样倍率：$S = \frac{N}{2R} = \frac{64}{32} = 2.0$，严格满足 Nyquist 强度频带采样定理。

---

## 3. Zernike 像差多项式与波前定义 (Aberration Basis)

系统考虑 3 个待估计未知像差分量与 1 个已知多样性离焦分量，参数均以波长 **waves** ($\lambda$) 为物理单位：

| 模式标号 | 物理名称 | 解析表达式（连续单位圆盘 $r \le 1$） | 待估状态 | 物理参数界限 |
|---|---|---|---|---|
| $Z_{20}$ | 已知离焦 (Defocus) | $Z_{20}(u,v) = \sqrt{3}(2r^2 - 1)$ | 固定值 $d = \pm 0.65$ | 不参与优化 |
| $Z_{22}$ | $0^\circ$ 像散 (Astigmatism 0°) | $Z_{22}(u,v) = \sqrt{6}(u^2 - v^2)$ | 待估 $a_0 = a_{\text{astig0}}$ | $[-0.15, +0.15]\lambda$ |
| $Z_{31}$ | $x$ 向彗差 (Coma X) | $Z_{31}(u,v) = \sqrt{8}(3r^2 - 2)u$ | 待估 $a_1 = a_{\text{comaX}}$ | $[-0.15, +0.15]\lambda$ |
| $Z_{40}$ | 初级球差 (Spherical) | $Z_{40}(u,v) = \sqrt{5}(6r^4 - 6r^2 + 1)$ | 待估 $a_2 = a_{\text{sph}}$ | $[-0.15, +0.15]\lambda$ |

### 3.1 相位分布与波前光程差
在特定焦面多样性偏置 $d \in \{-0.65, +0.65\}$ 下，光瞳平面的总光学相位分布 $\phi(x,y; \mathbf{a}, d)$ 为：
$$\phi(x,y; \mathbf{a}, d) = 2\pi \cdot \left[ a_0 Z_{22}(u,v) + a_1 Z_{31}(u,v) + a_2 Z_{40}(u,v) + d Z_{20}(u,v) \right] \quad (\text{radians})$$

**可视化约定**：界面波前热图展示的波前光程差 $W(u,v)$ 仅包含未知像差分量：
$$W(u,v) = a_0 Z_{22}(u,v) + a_1 Z_{31}(u,v) + a_2 Z_{40}(u,v) \quad (\text{waves})$$
不叠加已知多样性离焦，以直观对比估计波前与真实波前的吻合度。

---

## 4. 正向物理成像模型 (Forward Numerical Propagation)

正向物理成像模型模拟单色相干点源在 Fraunhofer 远场衍射极限下的点扩散函数 (PSF)：

1. **光瞳复振幅构建**：
   $$P(x,y; \mathbf{a}, d) = A(x,y) \cdot \exp[i \phi(x,y; \mathbf{a}, d)] = A(x,y) \left[ \cos\phi(x,y) + i \sin\phi(x,y) \right]$$

2. **二维相干远场傅里叶变换**：
   利用第一方独立实现的 Radix-2 Cooley-Tukey 2D FFT（行-列级联分解，原位位反转置换）：
   $$F(k_x, k_y) = \text{FFT2}\{P(x,y)\}$$

3. **零频中心对齐与强度转换**：
   $$I_{\text{raw}}(k_x, k_y) = \text{fftshift}\left( |F(k_x, k_y)|^2 \right) = \text{fftshift}\left( \text{Re}(F)^2 + \text{Im}(F)^2 \right)$$
   其中 `fftshift` 对偶数维度 $N=64$ 在行、列方向分别执行 $N/2 = 32$ 像素的周期循环移位，使直流零频置于显示中心 $(32, 32)$。

4. **物理归一化**：
   计算全视场总能量并重归一化：
   $$I_k = \frac{I_{\text{raw}}[k]}{\sum_{j=0}^{M-1} I_{\text{raw}}[j]}, \quad k \in [0, 4095]$$
   保证强度非负且单平面总能量严格守恒为 $1.0$（浮点容差 $\le 10^{-12}$）。

---

## 5. 目标代价函数与残差定义 (Loss & Residuals)

给定无噪声观测强度 $\mathbf{O}_{-0.65}$ 与 $\mathbf{O}_{+0.65}$（由真值 $\mathbf{a}^*$ 生成），对于当前参数向量 $\mathbf{a} \in \mathbb{R}^3$：

1. **逐像素残差向量**：
   $$r_{p, k}(\mathbf{a}) = I_k(\mathbf{a}, d_p) - O_{p, k}, \quad p \in S, \; k \in [0, 4095]$$
   - 单焦模式 (Single-plane)：$S = \{-0.65\}$，残差维数 $K = 4096$；
   - 双焦模式 (Dual-plane)：$S = \{-0.65, +0.65\}$，残差维数 $K = 8192$。

2. **平方和总损失 (Loss)**：
   $$L(\mathbf{a}; S) = \sum_{p \in S} \sum_{k=0}^{4095} \left[ r_{p, k}(\mathbf{a}) \right]^2 = \|\mathbf{r}(\mathbf{a})\|_2^2$$

3. **跨模式可比均方误差 (MSE)**：
   为消除像素总数差异带来的量纲偏差，跨模式对比统一采用单像素均方误差：
   $$\text{MSE}(\mathbf{a}; S) = \frac{L(\mathbf{a}; S)}{4096 \times |S|}$$

---

## 6. Levenberg-Marquardt 非线性阻尼优化求解器 (LM Inverse Solver)

针对非线性最小二乘问题 $\min_{\mathbf{a}} L(\mathbf{a})$，FocusWitness 采用确定性、盒约束的 Levenberg-Marquardt (LM) 迭代算法：

### 6.1 有限差分雅可比矩阵 (Finite Difference Jacobian)
采用对称中心差分计算残差向量关于像差参数的偏导数：
$$J_{k, j}(\mathbf{a}) = \frac{\partial r_k}{\partial a_j} \approx \frac{r_k(\mathbf{a} + h \mathbf{e}_j) - r_k(\mathbf{a} - h \mathbf{e}_j)}{2h}, \quad j \in \{0, 1, 2\}$$
差分步长取 $h = 10^{-4}\text{ waves}$。差分时允许边界外推，真实估计量则硬截断至参数盒内。

### 6.2 阻尼正规方程与主元消元求解
计算高斯-牛顿近似曲率矩阵 $G \in \mathbb{R}^{3 \times 3}$ 与最陡下降梯度向量 $\mathbf{g} \in \mathbb{R}^3$：
$$G = J^T J, \quad \mathbf{g} = J^T \mathbf{r}$$
构造 Levenberg-Marquardt 阻尼线性方程组：
$$\left[ G + \lambda D + 10^{-12} I_3 \right] \boldsymbol{\delta} = -\mathbf{g}$$
其中：
- 对角尺度矩阵 $D_{jj} = \max(G_{jj}, 10^{-12})$，增强各参数尺度的不变性；
- 正则化单位阵系数 $10^{-12}$ 保证数值正定；
- 初始阻尼因子 $\lambda_0 = 10^{-2}$；
- 采用带列主元选择的 3×3 高斯消元法（Gaussian Elimination with Partial Pivoting）精确求解增量 $\boldsymbol{\delta}$。若遇奇异矩阵或非有限数，立即抛出 `NUMERIC_FAILURE` 异常中断，杜绝产生 `NaN`。

### 6.3 步长限制与参数盒约束
- 步长截断：限制单步各分量最大位移 $|\delta_j| \le 0.04\text{ waves}$；
- 参数盒投影：候选点限制在紧致凸集内：
  $$\mathbf{a}_{\text{cand}} = \text{clip}(\mathbf{a} + \boldsymbol{\delta}, -0.15, +0.15)$$

### 6.4 试探步接受与自适应阻尼调节
计算候选点损失 $L_{\text{new}} = L(\mathbf{a}_{\text{cand}})$：
- **接受步**（$L_{\text{new}} < L_{\text{curr}} - 10^{-18}$）：
  $$\mathbf{a} \leftarrow \mathbf{a}_{\text{cand}}, \quad \lambda \leftarrow \max(\lambda \times 0.3, 10^{-7})$$
- **拒绝步**（$L_{\text{new}} \ge L_{\text{curr}} - 10^{-18}$）：
  保持当前参数 $\mathbf{a}$ 不变，增大阻尼转向梯度下降方向：
  $$\lambda \leftarrow \min(\lambda \times 10.0, 10^7)$$

### 6.5 收敛判据与终态状态机
优化过程在每个迭代步检测以下条件：
1. **残差极小收敛 (`converged`)**：$L \le 10^{-14}$；
2. **步长极小收敛 (`converged`)**：最近接受步的最大坐标位移 $\max_j |\delta_j| < 10^{-7}$；
3. **相对改善收敛 (`converged`)**：连续 3 次接受步的相对损失下降比 $\frac{L_{\text{prev}} - L}{L_{\text{prev}}} < 10^{-10}$；
4. **最大迭代步耗尽 (`max_iterations`)**：迭代计数达到硬上限 $60$；
5. **梯度停滞 (`stalled`)**：连续拒绝且 $\lambda$ 达到上限 $10^7$ 仍无下降空间；
6. **主动取消 (`cancelled`)**：响应 Web Worker 中断信号。

---

## 7. 局部可辨识性与信息谱分析 (Local Identifiability & Sensitivity Spectrum)

### 7.1 共同参考点对比法则 (Common Reference Point Principle)
为了消除状态差异引起的伪对比，系统在反演收敛后，以**双焦拟合得到的最终解 $\mathbf{a}_{\text{ref}}$** 作为统一参考点，分别求值单焦与双焦的雅可比矩阵：
$$J_{\text{single}} = J_{-0.65}(\mathbf{a}_{\text{ref}}), \quad J_{\text{dual}} = \begin{bmatrix} J_{-0.65}(\mathbf{a}_{\text{ref}}) \\ J_{+0.65}(\mathbf{a}_{\text{ref}}) \end{bmatrix}$$

### 7.2 高斯-牛顿信息矩阵与单调性定理
构造信息矩阵：
$$G_{\text{single}} = J_{\text{single}}^T J_{\text{single}}, \quad G_{\text{dual}} = J_{\text{dual}}^T J_{\text{dual}} = G_{\text{single}} + J_{+0.65}^T J_{+0.65}$$
因为二次型矩阵 $J_{+0.65}^T J_{+0.65} \succeq 0$ 恒为半正定矩阵，根据 Weyl 特征值单调性定理：
$$G_{\text{dual}} - G_{\text{single}} \succeq 0 \implies \begin{cases} \lambda_{\min}(G_{\text{dual}}) \ge \lambda_{\min}(G_{\text{single}}) \\ \text{Tr}(G_{\text{dual}}) \ge \text{Tr}(G_{\text{single}}) \end{cases}$$
该数学定理严格保证了双焦面引入的物理测量数据在局部一阶敏感度上绝不损失信息。

### 7.3 Jacobi 谱分解与灵敏度奇异值
利用经典的 3×3 对称 Jacobi 旋转迭代算法，求解实对称矩阵的全部特征对：
$$G \mathbf{v}_i = e_i \mathbf{v}_i, \quad e_1 \ge e_2 \ge e_3 \ge 0$$
- 局部主灵敏度（奇异值）：$\sigma_i = \sqrt{e_i}$，反映参数空间沿各主轴方向对光强变动的敏感强度；
- 局部条件数：
  $$\kappa = \frac{\sqrt{e_1}}{\max(\sqrt{e_3}, 10^{-14})}$$
  反映逆问题在局部线性化下的病态程度。双焦模式下条件数大幅下降，表明病态性得到有效抑制。

### 7.4 严格的科学与证据边界警示 (Scientific Evidence Boundary)
> **必须明确声明**：
> 1. 高斯-牛顿信息矩阵的特征值与奇异值谱仅反映在参考点 $\mathbf{a}_{\text{ref}}$ 极小邻域内的局部线性化灵敏度；
> 2. 条件数良好与残差极小属于数值优化收敛标志，**不等于全局唯一解的数学证明**，更不是统计概率置信区间；
> 3. 真实物理反演在大幅度像差（$> 0.2\lambda$）或高噪声环境下仍可能面临非凸局部极小陷阱，严禁将局部可辨识性夸大为无条件全局重构保证。
