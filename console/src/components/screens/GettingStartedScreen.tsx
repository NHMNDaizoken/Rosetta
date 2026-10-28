// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import React from "react";
import {
  BookOpen,
  CheckCircle2,
  Database,
  ExternalLink,
  FolderArchive,
  GitBranch,
  KeyRound,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { useI18n } from "../../locales/i18n";
import { BRAND } from "../../constants/brand";
import { PageHeader } from "../layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../common/Card";
import { Badge } from "../common/Badge";
import { CodeBlock } from "../common/CodeBlock";

const COPY = {
  en: {
    title: "Getting Started",
    subtitle:
      "Integrate a backend application with the implemented Foundation APIs. The example never runs in a browser with service-account credentials.",
    badge: "Foundation APIs",
    startTitle: "1. Start the local stack",
    startDesc:
      "Requires Node.js 24, Docker Engine with Linux containers and Docker Compose v2.20+. npm run setup creates an ignored .env with local fixture credentials.",
    enrollTitle: "2. Enroll an application",
    enrollDesc:
      "Application registration is implemented, but enrollment is operator-run. A trusted operator must create the principal, enrollment and provider binding before an application can call v2 resources.",
    enrollLink: "Read the enrollment contract",
    runTitle: "3. Run the executable example",
    runDesc:
      "Use an enrolled backend and a second enrolled application as the grantee. Keep both secrets out of screenshots, commits and browser code.",
    runNote:
      "The example calls the public Gateway only. It proves identity, private record create/read, private object upload/download, a technical workflow, an expiring read share and a denied cross-app read before the share.",
    provesTitle: "What the example proves",
    proves: [
      "Client-credentials authentication against the local OIDC provider",
      "Verified tenant and roles from GET /v1/identity",
      "Application-private record and object ownership under /v2",
      "Idempotent workflow start and completion",
      "Explicit read sharing and a denied request from another application",
    ],
    errorsTitle: "Common failures",
    errors: [
      "401/403: token missing, client disabled, or the application is pending/suspended.",
      "403 verified_client_required: the OIDC client is not an enrolled backend.",
      "404 on a shared resource: the share expired, was revoked, or targets another tenant.",
      "409 on workflow start: the idempotency key was reused with different input.",
      "503: a configured provider is not ready; check /ready before retrying writes.",
    ],
    linksTitle: "Read next",
    links: [
      ["Product status", "/blob/main/docs/PRODUCT.md"],
      ["Developer and extension guide", "/blob/main/docs/DEVELOPING.md"],
      ["Application registration", "/blob/main/docs/APPLICATION_REGISTRATION.md"],
      ["Resource authorization", "/blob/main/docs/RESOURCE_AUTHORIZATION.md"],
      ["Foundation API contract", "/blob/main/docs/CORE_API.md"],
    ],
  },
  vi: {
    title: "Bắt đầu tích hợp",
    subtitle:
      "Tích hợp backend ứng dụng với các Foundation API đã triển khai. Ví dụ không bao giờ chạy service-account credential trong trình duyệt.",
    badge: "Foundation APIs",
    startTitle: "1. Khởi động stack local",
    startDesc:
      "Cần Node.js 24, Docker Engine với Linux container và Docker Compose v2.20+. npm run setup tạo .env (đã ignore) với credential fixture local.",
    enrollTitle: "2. Đăng ký ứng dụng",
    enrollDesc:
      "Application registration đã triển khai nhưng enrollment do operator thực hiện. Operator tin cậy phải tạo principal, enrollment và provider binding trước khi ứng dụng gọi được tài nguyên v2.",
    enrollLink: "Đọc hợp đồng enrollment",
    runTitle: "3. Chạy ví dụ thực thi",
    runDesc:
      "Dùng một backend đã enrollment và một ứng dụng thứ hai làm grantee. Không đưa secret vào ảnh chụp, commit hay mã trình duyệt.",
    runNote:
      "Ví dụ chỉ gọi Gateway công khai. Nó chứng minh identity, tạo/đọc record riêng, upload/download object riêng, workflow kỹ thuật, share read có hạn và một yêu cầu bị từ chối từ ứng dụng khác trước khi share.",
    provesTitle: "Ví dụ chứng minh điều gì",
    proves: [
      "Xác thực client-credentials với OIDC provider local",
      "Tenant và roles đã xác minh từ GET /v1/identity",
      "Quyền sở hữu record và object riêng của ứng dụng dưới /v2",
      "Bắt đầu và hoàn tất workflow idempotent",
      "Chia sẻ read tường minh và yêu cầu bị từ chối từ ứng dụng khác",
    ],
    errorsTitle: "Lỗi thường gặp",
    errors: [
      "401/403: thiếu token, client bị tắt, hoặc ứng dụng pending/suspended.",
      "403 verified_client_required: OIDC client chưa được enrollment làm backend.",
      "404 trên tài nguyên đã share: share hết hạn, bị thu hồi hoặc khác tenant.",
      "409 khi start workflow: idempotency key bị dùng lại với input khác.",
      "503: provider chưa sẵn sàng; kiểm tra /ready trước khi thử lại thao tác ghi.",
    ],
    linksTitle: "Đọc tiếp",
    links: [
      ["Trạng thái sản phẩm", "/blob/main/docs/PRODUCT.md"],
      ["Hướng dẫn developer & mở rộng", "/blob/main/docs/DEVELOPING.md"],
      ["Đăng ký ứng dụng", "/blob/main/docs/APPLICATION_REGISTRATION.md"],
      ["Phân quyền tài nguyên", "/blob/main/docs/RESOURCE_AUTHORIZATION.md"],
      ["Hợp đồng Foundation API", "/blob/main/docs/CORE_API.md"],
    ],
  },
};

const START_COMMANDS = `git clone https://github.com/NHMNDaizoken/Rosetta.git
cd Rosetta
npm run setup
docker compose up --build --detach --wait --wait-timeout 240
npm run healthcheck`;

const EXAMPLE_COMMANDS = `ROSETTA_APP_CLIENT_ID=<enrolled-backend-client>
ROSETTA_APP_CLIENT_SECRET=<backend-secret>
ROSETTA_GRANTEE_APP_ID=<second-enrolled-app-uuid>

# Optional: prove denied before share and allowed after share
ROSETTA_GRANTEE_CLIENT_ID=<grantee-client>
ROSETTA_GRANTEE_CLIENT_SECRET=<grantee-secret>

node --env-file=.env examples/foundation-http.mjs`;

export const GettingStartedScreen: React.FC = () => {
  const { language } = useI18n();
  const copy = COPY[language];

  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.title}
        subtitle={copy.subtitle}
        badges={<Badge variant="teal">{copy.badge}</Badge>}
      />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-rosetta-blue dark:text-sky-400" />
            <CardTitle>{copy.startTitle}</CardTitle>
          </div>
          <CardDescription>{copy.startDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock code={START_COMMANDS} language="bash" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <CardTitle>{copy.enrollTitle}</CardTitle>
          </div>
          <CardDescription>{copy.enrollDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          <a
            href={`${BRAND.githubUrl}/blob/main/docs/APPLICATION_REGISTRATION.md`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-rosetta-blue dark:text-sky-400 hover:underline"
          >
            {copy.enrollLink}
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            <CardTitle>{copy.runTitle}</CardTitle>
          </div>
          <CardDescription>{copy.runDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CodeBlock code={EXAMPLE_COMMANDS} language="bash" />
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {copy.runNote}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-rosetta-blue dark:text-sky-400" />
              <CardTitle>{copy.provesTitle}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300">
              {copy.proves.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-teal-600 dark:text-teal-400" />
                  <span className="leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              <CardTitle>{copy.errorsTitle}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
              {copy.errors.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <FolderArchive className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-400" />
                  <span className="leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <CardTitle>{copy.linksTitle}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {copy.links.map(([label, path]) => (
              <a
                key={path}
                href={`${BRAND.githubUrl}${path}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded border border-slate-200 dark:border-[#223E50] px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:border-rosetta-blue dark:hover:border-sky-500 hover:text-rosetta-blue dark:hover:text-sky-400"
              >
                {label}
                <ExternalLink className="w-3 h-3" />
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
