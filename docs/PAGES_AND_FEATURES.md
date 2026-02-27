# Sieger 管理控制台 · 页面功能手册

> 本文档说明每个页面的功能，以及功能与页面的对照关系。

---

## 目录

1. [整体布局](#整体布局)
2. [页面详解](#页面详解)
   - [Dashboard — 账单总览](#dashboard--账单总览)
   - [Invoices — 发票管理](#invoices--发票管理)
   - [Invoice Detail — 发票详情](#invoice-detail--发票详情)
   - [Customers — 客户管理](#customers--客户管理)
   - [Customer Detail — 客户详情](#customer-detail--客户详情)
   - [Invoice Runs — 发票批次运行](#invoice-runs--发票批次运行)
   - [Invoice Run Detail — 批次详情](#invoice-run-detail--批次详情)
   - [Billing Accounts — 账单账户](#billing-accounts--账单账户)
   - [Projects — 项目管理](#projects--项目管理)
   - [Product Groups — 产品分组](#product-groups--产品分组)
   - [Pricing Lists — 定价规则](#pricing-lists--定价规则)
   - [Credits — 信用额度](#credits--信用额度)
   - [Special Rules — 特殊计费规则](#special-rules--特殊计费规则)
   - [Raw Cost Imports — 原始费用导入](#raw-cost-imports--原始费用导入)
   - [Users — 用户管理](#users--用户管理)
   - [Audit Logs — 审计日志](#audit-logs--审计日志)
   - [Settings — 账户设置](#settings--账户设置)
3. [核心业务流程](#核心业务流程)
4. [功能 → 页面速查](#功能--页面速查)
5. [页面 → 功能速查](#页面--功能速查)
6. [各角色权限对照](#各角色权限对照)

---

## 整体布局

登录后进入控制台，左侧为**导航栏**，分为两个区域：

- **主功能**（所有人可见）：Dashboard、Invoices
- **管理功能**（需要管理员权限）：Customers、Billing Accounts、Projects、Product Groups、Pricing Lists、Credits、Special Rules、Invoice Runs

右上角可切换语言（中文/英文）和深色/浅色主题。

---

## 页面详解

---

### Dashboard — 账单总览

**路径** `/dashboard`

进来第一眼看到的页面，给你一个全局视角。

**顶部筛选栏**
- 选择日期范围（起止月份）
- 筛选云服务商（GCP / AWS / Azure / OpenAI / Custom）
- 筛选特定客户

**四大 KPI 卡片**（根据筛选条件实时变化）
- 总账单金额
- 发票总数
- 活跃客户数
- 平均发票金额

**图表区域**
- **趋势折线图** — 逐月收入走势，看增长和波动
- **服务商分布饼图** — 各云服务商费用占比
- **产品分组柱状图** — 哪类产品花钱最多（计算/存储/网络等）
- **客户排名表** — Top 10 客户消费排行

**底部小组件**（管理员可见）
- 最近数据导入记录
- 最近发票运行记录
- 系统告警提示

> **使用场景**：每月出账后，财务先看这里确认整体数字是否正常，再去 Invoices 处理具体发票。

---

### Invoices — 发票管理

**路径** `/invoices`

所有发票的汇总列表，日常财务操作的核心页面。

**顶部筛选栏**
- 日期范围
- 发票状态（草稿 / 已开具 / 已付款）
- 是否锁定
- 指定客户

**统计卡片**（随筛选变化）
- 发票总数 / 草稿数 / 已开具数 / 已付款数

**发票表格**，每行显示：

| 列 | 说明 |
|----|------|
| 发票号 | 点击进详情 |
| 客户名 + 外部 ID | |
| 账期月份 | |
| 状态 + 是否锁定 | |
| 金额 | |
| 开具日期 | |
| 操作 | 查看 / 导出（仅锁定后） |

---

### Invoice Detail — 发票详情

**路径** `/invoices/[id]`

单张发票的完整信息页，在这里完成锁定和导出操作。

**页面顶部**
- 发票号、状态徽标、是否锁定
- 客户名称 + 账期月份
- 操作按钮区：

| 按钮 | 出现条件 |
|------|---------|
| 锁定发票 | 未锁定时 |
| 导出 CSV | 已锁定后 |
| 导出 Excel | 已锁定后 |
| 导出 PDF | 已锁定后 |

**金额摘要**（6 个卡片）
- 列表价 → 折扣金额 → 分级折扣 → 信用抵扣 → 小计 → 税额 → **总金额**

**两栏信息区**
- 左：发票号、账期、货币、开具日期、到期日、锁定信息
- 右：客户名、外部 ID、货币、系统 ID

**费用明细表**
- 按 SKU 或产品分组展示每一行：描述 / 数量 / 单价 / 金额

> **标准流程**：Invoice Run 生成发票（草稿）→ 财务核对明细 → 确认无误后**锁定** → 按需**导出**发给客户

---

### Customers — 客户管理

**路径** `/admin/customers`

管理所有企业客户的核心数据。

**列表页**显示：客户名、货币、账期天数、联系邮箱、状态（活跃/暂停/终止）

**创建/编辑客户弹窗**

| 字段 | 说明 |
|------|------|
| 名称 | 企业名称（必填） |
| 外部 ID | 你系统内的客户编号，如 `GCP-CUST-001` |
| 货币 | USD / EUR / GBP / JPY |
| 账期天数 | 1–180 天，默认 30 天 |
| 联系邮箱 | 主要联系人邮箱 |
| 状态 | 仅编辑时可改：活跃 / 暂停 / 终止 |

---

### Customer Detail — 客户详情

**路径** `/admin/customers/[id]`

一个客户的所有配置都在这里，通过标签页导航。

**顶部**：客户名 + 状态 + 外部 ID + "编辑客户"按钮

**标签页导航（4 个标签）**

#### 标签 1：Projects（项目）
- 列出该客户绑定的所有 GCP 项目
- 可绑定新项目 / 解绑已有项目
- 支持设置绑定的起止日期（一个项目同一时间只能属于一个客户）

#### 标签 2：Pricing（定价）
- 列出该客户的定价规则列表
- 点进去可管理具体折扣规则（见 Pricing Lists 页面）

#### 标签 3：Credits（信用额度）
- 查看该客户的信用额度余额和使用情况

#### 标签 4：Invoices（发票）
- 仅显示该客户的所有历史发票

---

### Invoice Runs — 发票批次运行

**路径** `/admin/invoice-runs`

出账操作的控制室，每次批量生成发票都在这里发起。

**列表页**，每行显示：

| 列 | 说明 |
|----|------|
| 账期月份 | |
| 服务商 | |
| 状态 | 排队中 / 运行中 / 成功 / 失败（颜色区分） |
| 生成发票数 + 总金额 | |
| 创建时间 | |
| 操作 | 执行（排队中）/ 查看错误 / 详情 |

**创建 Invoice Run 弹窗**
- 账期月份（必填，格式 `YYYY-MM`）
- 服务商（可选，不选 = 所有）
- 创建后状态为"排队中"，需手动点**执行**

---

### Invoice Run Detail — 批次详情

**路径** `/admin/invoice-runs/[id]`

一次出账运行的完整执行结果。

**顶部**：状态图标 + 账期 + 状态徽标 + 创建人和时间

**4 个摘要卡片**：生成发票数 / 总金额 / 客户数 / 费用行数

**运行详情**：开始/结束时间 / 耗时 / 项目数 / 来源 Key / 配置快照 ID

**多货币明细**：按货币分别显示金额

**本次生成的发票列表**：发票号（可点击）/ 客户名 / 状态 / 金额 / 查看按钮

---

### Billing Accounts — 账单账户

**路径** `/admin/billing-accounts`

管理 GCP 账单账户，是项目的上级节点。

**列表页**显示：账单账户名称 + ID / 旗下项目数 / 状态（活跃/暂停）

**创建弹窗**

| 字段 | 说明 |
|------|------|
| Billing Account ID | GCP 侧的账单账户 ID |
| 名称 | 自定义备注名（可选） |

---

### Projects — 项目管理

**路径** `/admin/projects`

管理 GCP 项目，连接账单账户与客户的桥梁。

**列表页**显示：项目名 + Project ID / 所属账单账户 / 绑定的客户 / 状态

**创建/编辑弹窗**

| 字段 | 说明 |
|------|------|
| Project ID | GCP 项目 ID（创建后不可修改） |
| 项目名 | 可选备注名 |
| 状态 | 仅编辑时可改 |

---

### Product Groups — 产品分组

**路径** `/admin/sku-groups` · 详情 `/admin/sku-groups/[id]`

把 GCP 的细碎 SKU 归类成有意义的产品组，方便定价和报表展示。

**列表页**显示：分组代码（如 `COMPUTE`）/ 名称 / SKU 数量 / 关联定价规则数

**创建分组弹窗**

| 字段 | 说明 |
|------|------|
| 分组代码 | 大写字母，如 `COMPUTE`、`STORAGE` |
| 显示名称 | 如"计算资源" |
| 描述 | 可选 |

**分组详情页**
- 已添加的 SKU 列表（ID / 名称 / 所属服务 / 单位 / 删除）
- **添加 SKU 弹窗**：输入关键词搜索 → 勾选 → 批量添加

---

### Pricing Lists — 定价规则

**路径** `/admin/pricing-lists` · 详情 `/admin/pricing-lists/[id]`

给每个客户配置专属折扣方案。

**列表页**显示：定价列表名 + 所属客户 / 规则数量 / 状态（活跃/停用）

**创建弹窗**：选择客户 + 列表名称

**定价列表详情页**，规则表格显示：

| 列 | 说明 |
|----|------|
| SKU 分组 | 适用的产品组，或"全部 SKU" |
| 折扣 % | 如 10% = 九折（客户实付原价 × 90%） |
| 优先级 | 数字越小越优先 |
| 生效期间 | 起止日期，或"始终有效" |

**添加规则弹窗**

| 字段 | 说明 |
|------|------|
| SKU 分组 | 选择产品组，或"全部 SKU" |
| 折扣百分比 | 0–100，如填 `15` = 八五折 |
| 生效起止日期 | 可选，不填则始终有效 |
| 优先级 | 数字越小越先匹配 |

> **计算示例**：原始费用 $100，折扣 15% → 客户实付 $85

---

### Credits — 信用额度

**路径** `/admin/credits`

给客户发放抵扣金，出账时自动抵扣。

**列表页**显示：客户名 / 类型 / 总额 / 剩余额（绿色=有余额）/ 有效期 / 状态

**添加信用额度弹窗**

| 字段 | 说明 |
|------|------|
| 客户 | 受益客户（必填） |
| 类型 | 促销 / 合同 / 善意 / 退款 |
| 金额 | 信用额度金额（必填） |
| 描述 | 备注，如"Q1 促销活动" |
| 有效期 | 起止日期（必填） |

> **自动应用规则**：出账时按有效期从早到晚依次消耗，`allowCarryOver=false` 的额度不跨月结转。

---

### Special Rules — 特殊计费规则

**路径** `/admin/special-rules`

处理不符合标准定价逻辑的场景，**优先于**定价规则执行。

**列表页**显示：规则名 / 所属客户 / 类型 / 优先级 / 生效日期 / 状态

**规则类型说明**

| 类型 | 使用场景 |
|------|---------|
| `EXCLUDE_SKU` | 某 SKU 费用不计入发票（如赠送的资源） |
| `EXCLUDE_SKU_GROUP` | 整个产品组免费 |
| `OVERRIDE_COST` | 覆盖费用倍率，`0` = 完全免费，`0.5` = 半价 |
| `MOVE_TO_CUSTOMER` | 将某项目的费用转移给另一个客户 |

**创建/编辑弹窗**

| 字段 | 说明 |
|------|------|
| 名称 | 规则名称 |
| 客户 | 适用客户，空 = 全局生效 |
| 规则类型 | 见上表 |
| 优先级 | 数字越小越先执行 |
| 生效起止日期 | 起止日期，终止日期可为空 |
| 匹配条件 | 可组合：SKU / SKU分组 / 服务 / 项目 / 账单账户 |

---

### Raw Cost Imports — 原始费用导入

**路径** `/admin/raw-cost-imports`

查看历史数据导入记录（只读，实际导入通过 API 完成）。

**顶部摘要卡片**：总批次数 / 总数据行数 / 总费用金额

**筛选**：按月份 / 来源筛选

**导入记录表格**

| 列 | 说明 |
|----|------|
| 导入时间 | |
| 账期月 | |
| 来源 | 数据来源标识 |
| 行数 | 导入的费用记录数 |
| 费用 | 该批次总费用 |
| 状态 | 完成 / 失败 / 处理中 |
| 导入人 | 操作用户 |
| 校验和 | SHA-256，用于幂等性验证 |

---

### Users — 用户管理

**路径** `/admin/users` · 详情 `/admin/users/[id]`

管理能登录本系统的用户账号。

**列表页**显示：邮箱 + 姓名 / 角色 / 状态 / 最后登录时间

**创建用户弹窗**（三步式）
1. **基本信息**：姓名 + 邮箱 + 密码
2. **角色**：选择角色（下方显示该角色的权限说明）
3. **客户权限**（可选）：选择该用户能访问哪些客户

**用户详情页**

| 卡片 | 内容 |
|------|------|
| 角色卡片 | 当前角色列表 + 编辑角色按钮 |
| 活动统计 | 最后登录 / 审计日志数 / Invoice Run 数 / 创建时间 |
| 客户范围 | 用户能访问的客户列表 + 添加/删除范围 |

**顶部操作按钮**：重置密码 / 停用账号 / 启用账号

---

### Audit Logs — 审计日志

**路径** `/admin/audit-logs`

查看所有操作历史，满足合规要求。

**筛选栏**：操作类型 / 操作资源 / 时间范围起止日期

**日志表格**

| 列 | 说明 |
|----|------|
| 时间 | 操作时间戳 |
| 操作类型 | 创建/更新/删除/登录/导出等，颜色区分 |
| 资源 | 操作的数据对象 |
| 操作人 | 姓名 + 邮箱 |
| 目标 ID | 被操作记录的 ID |
| 详情按钮 | 弹出完整信息 |

**详情弹窗**：时间 + 操作 + 资源 + 操作人 + IP + **修改前数据（JSON）** + **修改后数据（JSON）**

> 所有修改、登录、导出操作均有记录。密码字段自动脱敏。

---

### Settings — 账户设置

**路径** `/settings`

个人账户管理，只能查看和修改自己的信息。

**个人信息卡片**：姓名 / 邮箱（只读）/ 已分配的角色

**修改密码卡片**：当前密码 → 新密码 → 确认新密码 → 提交

---

## 核心业务流程

### 流程一：新增客户并完成首次出账

```
1. Billing Accounts  ── 录入 GCP 账单账户
2. Projects          ── 录入 GCP 项目，关联到账单账户
3. Customers         ── 创建客户
   └── Customer Detail / Projects 标签  ── 绑定项目到客户
4. Product Groups    ── 创建产品分组（如"计算"、"存储"）
                        搜索并添加相关 SKU
5. Pricing Lists     ── 为客户创建定价列表
                        添加折扣规则（如计算资源 8.5 折）
6. Credits（可选）   ── 为客户添加信用额度
7. Special Rules（可选）── 配置特殊计费规则
8. Raw Cost          ── 通过 API 导入该月原始费用数据
9. Invoice Runs      ── 创建 Invoice Run（选择账期月份）→ 执行
10. Invoice Run Detail ── 查看执行结果，确认发票数量和金额
11. Invoices         ── 找到对应发票，核对明细
                        确认无误 → 锁定 → 导出 PDF/Excel → 发给客户
```

### 流程二：月度例行出账

```
1. Dashboard     ── 看上月数据是否正常
2. 导入数据       ── 通过 API 导入当月费用数据
3. Invoice Runs  ── 创建本月 Invoice Run → 执行
4. Invoices      ── 筛选本月发票，批量检查
5. Invoice Detail── 逐张锁定 → 导出
```

### 流程三：给客户调整折扣

```
Customers → 进客户详情 → Pricing 标签
→ 打开现有定价列表 → 编辑或添加规则
→ 下次 Invoice Run 时自动生效
```

### 流程四：新增员工账号

```
Users → Create User
→ 填姓名邮箱密码
→ 选角色（finance = 只能出账；viewer = 只读；admin = 全管）
→ 可选：限制只能看特定客户（添加 Customer Scope）
```

### 流程五：客户对账 / 审计质询

```
Audit Logs  ── 按时间/操作类型筛选
            ── 点"详情"查看修改前后的完整数据
Invoice Detail ── 查看发票锁定时间 + 操作人
```

---

## 功能 → 页面速查

| 我想要… | 去哪里 | 路径 |
|---------|--------|------|
| 看整体账单数字和趋势 | Dashboard | `/dashboard` |
| 查某张发票的明细 | Invoices → 点发票号 | `/invoices` → `/invoices/[id]` |
| 锁定发票 | 发票详情页 → 锁定按钮 | `/invoices/[id]` |
| 导出发票（PDF/Excel/CSV） | 发票详情页 → 导出按钮（锁定后才出现） | `/invoices/[id]` |
| 创建客户 | Customers → Create Customer | `/admin/customers` |
| 编辑客户信息 | Customers → 编辑按钮 | `/admin/customers` |
| 给客户绑定 GCP 项目 | 客户详情 → Projects 标签 | `/admin/customers/[id]` |
| 给客户配置折扣 | 客户详情 → Pricing 标签 或 Pricing Lists | `/admin/customers/[id]` 或 `/admin/pricing-lists` |
| 查客户有多少信用余额 | 客户详情 → Credits 标签 | `/admin/customers/[id]` |
| 看某客户所有历史发票 | 客户详情 → Invoices 标签 | `/admin/customers/[id]` |
| 录入 GCP 账单账户 | Billing Accounts → 创建 | `/admin/billing-accounts` |
| 录入 GCP 项目 | Projects → 创建 | `/admin/projects` |
| 把 SKU 归类成产品组 | Product Groups → 分组详情 → 添加 SKU | `/admin/sku-groups/[id]` |
| 新建产品分组 | Product Groups → Create | `/admin/sku-groups` |
| 给客户设置折扣规则 | Pricing Lists → 进入列表 → Add Rule | `/admin/pricing-lists/[id]` |
| 新建一份定价列表 | Pricing Lists → Create | `/admin/pricing-lists` |
| 给客户发放信用额度 | Credits → Add Credit | `/admin/credits` |
| 设置特殊计费规则（免费/转移/覆盖价格） | Special Rules → Add Rule | `/admin/special-rules` |
| 发起一次月度出账 | Invoice Runs → New Invoice Run → 执行 | `/admin/invoice-runs` |
| 查看出账执行结果 | Invoice Runs → 点击记录 | `/admin/invoice-runs/[id]` |
| 查看出账生成了哪些发票 | Invoice Runs 详情 → 底部发票列表 | `/admin/invoice-runs/[id]` |
| 查看原始费用导入历史 | Raw Cost Imports | `/admin/raw-cost-imports` |
| 创建系统用户 | Users → Create User | `/admin/users` |
| 给用户分配角色 | 用户详情 → Roles 卡片 → Edit | `/admin/users/[id]` |
| 限制用户只能看某些客户 | 用户详情 → Customer Scopes → Add Scope | `/admin/users/[id]` |
| 重置某用户的密码 | 用户详情 → Reset Password | `/admin/users/[id]` |
| 停用某用户账号 | 用户详情 → Deactivate 按钮 | `/admin/users/[id]` |
| 查看谁改了什么数据 | Audit Logs | `/admin/audit-logs` |
| 查看某次操作修改前后的对比 | Audit Logs → 点 Details | `/admin/audit-logs` |
| 修改自己的密码 | Settings | `/settings` |
| 查看自己的角色和权限 | Settings | `/settings` |

---

## 页面 → 功能速查

| 页面 | 路径 | 能做的事 |
|------|------|---------|
| **Dashboard** | `/dashboard` | 查 KPI、看趋势图、看服务商分布、看产品排名、看客户排名、筛选日期/服务商/客户 |
| **Invoices** | `/invoices` | 列出所有发票、按状态/客户/日期/锁定状态筛选、跳转发票详情、直接导出已锁定发票 |
| **Invoice Detail** | `/invoices/[id]` | 查发票完整明细、锁定发票、导出 PDF/Excel/CSV |
| **Customers** | `/admin/customers` | 创建客户、编辑客户基本信息、查看状态、跳转客户详情 |
| **Customer Detail** | `/admin/customers/[id]` | 编辑客户、查看/绑定/解绑项目、查看/管理定价、查看信用余额、查看该客户所有发票 |
| **Invoice Runs** | `/admin/invoice-runs` | 创建出账批次、执行排队中的批次、查看所有批次状态和结果 |
| **Invoice Run Detail** | `/admin/invoice-runs/[id]` | 执行批次、查看执行统计（金额/发票数/耗时）、查看本次生成的所有发票、查看错误详情 |
| **Billing Accounts** | `/admin/billing-accounts` | 创建/查看 GCP 账单账户、查看每个账户下的项目数量 |
| **Projects** | `/admin/projects` | 创建/编辑 GCP 项目、查看项目绑定了哪个客户 |
| **Product Groups** | `/admin/sku-groups` | 创建产品分组、查看分组内 SKU 数量 |
| **Product Group Detail** | `/admin/sku-groups/[id]` | 搜索并添加 SKU 到分组、从分组移除 SKU |
| **Pricing Lists** | `/admin/pricing-lists` | 创建定价列表并关联客户、激活/停用定价列表、删除定价列表 |
| **Pricing List Detail** | `/admin/pricing-lists/[id]` | 添加折扣规则（产品组 + 折扣率 + 生效期）、删除规则 |
| **Credits** | `/admin/credits` | 给客户添加信用额度（促销/合同/弹性）、查看所有客户信用余额和有效期 |
| **Special Rules** | `/admin/special-rules` | 创建特殊计费规则（排除/覆盖/转移费用）、编辑规则、停用规则 |
| **Raw Cost Imports** | `/admin/raw-cost-imports` | 查看所有历史导入记录（只读）、按月份/来源筛选、查看每批导入状态 |
| **Users** | `/admin/users` | 创建用户（含角色和初始客户权限）、查看用户列表 |
| **User Detail** | `/admin/users/[id]` | 编辑角色、添加/移除客户访问范围、重置密码、停用/启用账号 |
| **Audit Logs** | `/admin/audit-logs` | 按操作类型/资源/时间查操作历史、查看修改前后的数据对比 |
| **Settings** | `/settings` | 查看自己的角色信息、修改登录密码 |

---

## 各角色权限对照

| 页面 / 操作 | Super Admin | Admin | Finance | Viewer |
|-------------|:-----------:|:-----:|:-------:|:------:|
| Dashboard（含客户排名和小组件） | ✓ | ✓ | ✓ | 简化版 |
| 查看发票列表和详情 | ✓ | ✓ | ✓ | ✓ |
| 锁定发票 | ✓ | — | ✓ | — |
| 导出发票 | ✓ | ✓ | ✓ | — |
| 管理客户（增改） | ✓ | ✓ | — | — |
| 查看客户 | ✓ | ✓ | ✓ | ✓ |
| 管理账单账户和项目（增改） | ✓ | ✓ | — | — |
| 查看账单账户和项目 | ✓ | ✓ | ✓ | ✓ |
| 管理定价规则 | ✓ | ✓ | — | — |
| 管理信用额度 | ✓ | ✓ | ✓ | — |
| 查看信用额度 | ✓ | ✓ | ✓ | ✓ |
| 管理特殊规则 | ✓ | ✓ | — | — |
| 创建 / 执行 Invoice Run | ✓ | ✓ | ✓ | — |
| 查看 Invoice Run | ✓ | ✓ | ✓ | ✓ |
| 查看原始费用导入 | ✓ | ✓ | ✓ | ✓ |
| 导入原始费用数据 | ✓ | ✓ | ✓ | — |
| 管理用户 | ✓ | 只读 | — | — |
| 查看审计日志 | ✓ | ✓ | ✓ | — |
| 修改自己密码 | ✓ | ✓ | ✓ | ✓ |
