# Sieger Billing Console 使用指南

## 目录

- [快速开始](#快速开始)
- [环境配置](#环境配置)
- [开发命令](#开发命令)
- [功能模块](#功能模块)
- [国际化](#国际化)
- [主题切换](#主题切换)
- [技术架构](#技术架构)

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 到 `.env.local`，配置以下必要变量：

```env
# 数据库连接 (Neon Serverless PostgreSQL)
DATABASE_URL="postgresql://user:password@host/database?sslmode=require"

# JWT 密钥 (生产环境请使用强随机字符串)
JWT_SECRET="your-secure-jwt-secret-key"
JWT_EXPIRES_IN="8h"
```

### 3. 初始化数据库

```bash
# 生成 Prisma 客户端
npm run db:generate

# 运行数据库迁移
npm run db:migrate

# 初始化种子数据（创建管理员账号、角色、权限）
npm run db:seed
```

### 4. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000

### 5. 登录系统

**默认管理员账号：**
- 邮箱: `admin@sieger.cloud`
- 密码: `admin123`

---

## 环境配置

### 必需环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `DATABASE_URL` | Neon PostgreSQL 连接字符串 | `postgresql://...` |
| `JWT_SECRET` | JWT 签名密钥 | 随机字符串 |
| `JWT_EXPIRES_IN` | Token 过期时间 | `8h`, `1d` |

### 可选环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NODE_ENV` | 运行环境 | `development` |

---

## 开发命令

### 应用命令

```bash
npm run dev          # 启动开发服务器 (端口 3000)
npm run build        # 生产环境构建
npm run start        # 启动生产服务器
npm run lint         # 运行 ESLint 检查
```

### 数据库命令

```bash
npm run db:generate      # 生成 Prisma 客户端
npm run db:migrate       # 创建并应用迁移 (开发环境)
npm run db:migrate:prod  # 应用迁移 (生产环境)
npm run db:seed          # 初始化种子数据
npm run db:studio        # 打开 Prisma Studio (数据库可视化)
npm run db:reset         # 重置数据库 (警告: 删除所有数据)
```

---

## 功能模块

### 主导航

| 模块 | 路径 | 说明 |
|------|------|------|
| 仪表盘 | `/dashboard` | 系统概览、统计图表 |
| 发票 | `/invoices` | 发票列表、查看详情 |
| 设置 | `/settings` | 用户设置 |

### 管理中心 (需管理员权限)

| 模块 | 路径 | 说明 |
|------|------|------|
| 客户管理 | `/admin/customers` | 客户 CRUD、项目绑定 |
| 账单账户 | `/admin/billing-accounts` | GCP 账单账户管理 |
| 项目 | `/admin/projects` | GCP 项目管理 |
| 产品组 | `/admin/sku-groups` | SKU 分组管理 |
| 定价列表 | `/admin/pricing-lists` | 客户定价规则 |
| 信用额度 | `/admin/credits` | 客户信用额度管理 |
| 特殊规则 | `/admin/special-rules` | 计费特殊规则 |
| 发票批次 | `/admin/invoice-runs` | 批量生成发票 |
| 付款记录 | `/admin/payments` | 付款记录管理 |
| 成本导入 | `/admin/raw-cost-imports` | 原始成本数据导入 |
| 对账 | `/admin/reconciliation` | 成本对账 |
| 用户管理 | `/admin/users` | 用户 CRUD、角色分配 |
| 审计日志 | `/admin/audit-logs` | 系统操作日志 |

---

## 国际化

系统支持中英文切换。

### 切换语言

1. 点击页面右上角的 **地球图标** (🌐)
2. 选择目标语言：
   - **English** - 英文
   - **中文** - 简体中文

语言偏好会保存在浏览器 Cookie 中，下次访问自动应用。

### 翻译文件位置

```
messages/
├── en.json    # 英文翻译
└── zh.json    # 中文翻译
```

### 添加新翻译

1. 在 `messages/en.json` 和 `messages/zh.json` 中添加对应的翻译键值对
2. 在组件中使用：

```tsx
import { useTranslations } from 'next-intl';

function MyComponent() {
  const t = useTranslations();
  return <h1>{t('common.appName')}</h1>;
}
```

---

## 主题切换

系统支持亮色/暗色主题切换。

### 切换主题

1. 点击页面右上角的 **太阳/月亮图标**
2. 主题选项：
   - **Light** - 亮色主题
   - **Dark** - 暗色主题
   - **System** - 跟随系统设置

### 设计风格

- 现代中性色调（黑白灰）
- 无蓝色调，避免 AI 风格
- 简洁的几何设计元素

---

## 技术架构

### 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Next.js 14 (App Router) |
| 语言 | TypeScript (严格模式) |
| 数据库 | Neon Serverless PostgreSQL |
| ORM | Prisma 7 |
| 认证 | 自建 JWT + bcrypt |
| UI | Tailwind CSS + shadcn/ui |
| 国际化 | next-intl |
| 主题 | next-themes |
| 图表 | ECharts |

### 目录结构

```
src/
├── app/                    # Next.js App Router
│   ├── (auth)/            # 认证相关页面 (登录)
│   ├── (console)/         # 控制台页面 (需登录)
│   ├── api/               # REST API 路由
│   ├── layout.tsx         # 根布局
│   └── page.tsx           # 首页 (重定向到 dashboard)
├── components/            # React 组件
│   ├── layout/           # 布局组件 (Sidebar, Header)
│   ├── ui/               # UI 组件 (shadcn)
│   ├── language-switcher.tsx
│   └── theme-toggle.tsx
├── contexts/              # React Context
├── i18n/                  # 国际化配置
├── lib/                   # 工具库
│   ├── auth/             # 认证相关
│   ├── db/               # 数据库客户端
│   ├── middleware/       # API 中间件
│   └── utils/            # 通用工具
└── messages/              # 翻译文件 (en.json, zh.json)
```

### 授权模型

系统采用三层授权：

1. **认证 (Authentication)**: JWT Token 验证
2. **权限 (Permissions)**: 基于资源:操作 (如 `customers:create`)
3. **范围 (Scopes)**: 数据隔离 (CUSTOMER, BILLING, PROJECT)

### 角色层级

| 角色 | 说明 |
|------|------|
| `super_admin` | 超级管理员，跳过所有范围限制 |
| `admin` | 管理员，在分配范围内管理 |
| `finance` | 财务，发票和账单操作 |
| `viewer` | 只读，查看权限 |

---

## API 接口

### 认证

```bash
# 登录获取 Token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@sieger.cloud", "password": "admin123"}'

# 返回示例
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": { "id": "...", "email": "...", "roles": ["super_admin"] }
  }
}
```

### 使用 Token 访问 API

```bash
curl http://localhost:3000/api/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 主要 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 用户登录 |
| GET | `/api/me` | 获取当前用户信息 |
| GET | `/api/customers` | 获取客户列表 |
| POST | `/api/customers` | 创建客户 |
| GET | `/api/invoices` | 获取发票列表 |
| GET | `/api/invoice-runs` | 获取发票批次列表 |
| POST | `/api/invoice-runs` | 创建发票批次 |

---

## 常见问题

### Q: 如何修改默认管理员密码？

登录后访问 `/settings`，或通过 API：

```bash
curl -X POST http://localhost:3000/api/me/change-password \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword": "admin123", "newPassword": "your-new-password"}'
```

### Q: 如何创建新用户？

1. 登录管理员账号
2. 访问 `/admin/users`
3. 点击"创建用户"按钮
4. 填写用户信息并分配角色

### Q: 数据库连接失败？

1. 检查 `DATABASE_URL` 环境变量是否正确
2. 确保 Neon 数据库服务正常运行
3. 运行 `npm run db:generate` 重新生成 Prisma 客户端

### Q: 如何重置数据库？

```bash
# 警告：这会删除所有数据！
npm run db:reset
npm run db:seed
```

---

## 联系与支持

如有问题，请联系系统管理员。
