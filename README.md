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

## Demonstrating permissions (no login required)

Use the **“Preview: <role>”** selector in the top header to switch between:

- **Super Admin** — all offices & modules
- **Office Admin** — single office, most actions
- **Sales User** — limited, view/edit only

Switching the role instantly changes which sidebar modules are visible and which
Add / Edit / Delete / Download buttons appear. Super Admin also gets a global
**Sales Office** selector; office-scoped roles are pinned to their own office.

Permissions are fully configurable **module-wise × action-wise** (View, Create, Edit,
Delete, Download) from *Sales Office Master → open an office → edit a user → Permission Matrix*.

## Information architecture

- **Dashboard** — KPIs, stage funnel, office performance, reviews, action list
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
