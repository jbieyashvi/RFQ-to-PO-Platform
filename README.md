# Nexus RFQ — RFQ-to-PO Management Platform

A polished, responsive, high-fidelity **frontend prototype** for managing the workflow
from sales quotation to customer PO verification and sales-order creation. Data is
organised office-wise, and every quotation is tagged to a Sales Office.

> This is a **functional frontend prototype**. A real backend, email integration, AI
> classification, ERP integration and authentication server are intentionally out of scope.
> All data lives in local React state and resets on full page reload.

## Tech stack

- **React 18 + TypeScript**
- **Vite** (dev server & build)
- **React Router v6** (routing)
- **Tailwind CSS v3** (styling)
- **lucide-react** (icons)

## Getting started

```bash
npm install
npm run dev      # start dev server at http://localhost:5173
npm run build    # type-check + production build to /dist
npm run preview  # preview the production build
```

## Deployment

The same source deploys to two hosts. The Vite `base` path is chosen automatically
at build time (see `vite.config.ts`):

- **GitHub Pages** (project page) — served from `/RFQ-to-PO-Platform/`. This is the
  default and is published by the `Deploy to GitHub Pages` workflow
  (`.github/workflows/deploy.yml`) on every push to `main`. SPA deep links / refreshes
  are handled by `public/404.html` + the restore script in `index.html`.
- **Vercel** — served from the domain root `/`. Vercel sets `VERCEL=1` during its build,
  which switches the base to `/`.

### Deploying to Vercel

1. Import the repository at [vercel.com/new](https://vercel.com/new).
2. Vercel auto-detects Vite — no manual settings needed. `vercel.json` already pins the
   build command (`npm run build`), output directory (`dist`), and the SPA rewrite that
   serves `index.html` for every route (`/login`, `/dashboard`, `/inbox`, `/profile`,
   `/settings`, `/quotations/*`, `/sales-orders/*`, `/masters/*`, …) so direct hits and
   refreshes on any deep link work instead of 404ing.
3. Click **Deploy**. Nothing else to configure — the `VERCEL` env var is provided by the
   platform, so the root base path is applied automatically.

Both deployments are independent; adding Vercel does not affect the existing GitHub Pages
URL.

## Roles & permissions

The signed-in user's **role** (shown as read-only text in the account menu) drives which
sidebar modules are visible and which Add / Edit / Delete / Download actions appear:

- **Super Admin** — all offices & modules
- **Office Admin** — single office, most actions
- **Sales User** — limited, view/edit only

Permissions are fully configurable **module-wise × action-wise** (View, Create, Edit,
Delete, Download) from *Sales Office Master → open an office → edit a user → Permission Matrix*.
The role/permission engine is unchanged — the earlier demo role-preview switcher and the
global office selector were removed from the top header; the Dashboard now filters per
section instead.

## Information architecture

- **Dashboard** — Pipeline Funnel, Conversion Funnel, Action Required and Overdue Tasks, each with its own Branch / date filters
- **Master** — Item, Party, Sales Office (+ users & permissions), HSN, T&C
- **Sales Quotations** — Quotes Pending to be Sent, Quotes Needing Revision, List of Quotations
- **Sales Orders** — PO vs Quote Verification, List of Sales Orders, SO Revision, Create SO Manually

## Key interactions

- Filters, search, sort, pagination, applied-filter chips and “clear filters” on every list
- CSV export reflects only the **currently filtered** records
- Quotation status / stage / review-date editing from the detail drawer
- PO vs Quote comparison with clear mismatch highlighting
- Multi-section manual SO builder with live totals, validation, preview & draft/download
- Toasts, confirmation dialogs, loading skeletons and empty states throughout

## Project structure

```
src/
  components/ui/     reusable UI library (DataTable, Drawer, Modal, PermissionMatrix, …)
  components/        composite drawers (QuotationDetails, SalesOrderDetails, RequirePermission)
  context/           AppContext — mock data store, permissions, role preview, toasts
  data/              realistic Indian mock data (offices, users, masters, quotations, SOs)
  layout/            AppShell, Sidebar, Header, PageHeader/breadcrumbs, nav config
  lib/               formatting (INR/date/CSV), permission helpers, labels, hooks
  pages/             one file per route
  types/             shared TypeScript models
```
