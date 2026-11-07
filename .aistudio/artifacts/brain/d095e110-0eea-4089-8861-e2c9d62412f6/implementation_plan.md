# LedgerMatch — Intelligent Invoice & Payment Reconciliation Platform

LedgerMatch is an intelligent, privacy-first financial operations workspace engineered to reconcile sales invoices against payment transactions entirely in the browser. Operating strictly on the client device with native File API, IndexedDB, and integer-minor-unit (paise) precision, it automates four-tier deterministic matching, multi-payment allocations, duplicate detection, discrepancy resolution, and audit reporting.

> [!IMPORTANT]
> **Confirmed User Decisions & Strategic Parameters**
> - **Primary Currency & Format**: Indian Rupee (`INR`, ₹), using integer minor units (paise: 1 INR = 100 paise) to eliminate IEEE-754 floating point drift, formatted with Indian numbering (Lakhs/Crores) and multi-currency parsing safety.
> - **Default Reconciliation Date Tolerance**: 30-day extended window for Level 3 fuzzy matching, with an interactive slider in workspace settings allowing real-time tuning (1–90 days).
> - **Built-in Demo Scenario**: Realistic B2B wholesale, logistics, and corporate services dataset with exact matches, partial multi-tranche payments, customer name variants, overdue invoices, duplicate transaction entries, and an overpayment anomaly.
> - **Local Client-Side Architecture**: Zero external APIs or server uploads. All processing happens locally in the browser utilizing IndexedDB and Web Workers/modular ES scripts.

---

## 1. Overview & Core Concept

Businesses often struggle with fragmented payment gateways, bank transfers, credit notes, and ERP invoices. Manual reconciliation in spreadsheets leads to missed partial payments, duplicate deductions, and accounting audit failures. 

LedgerMatch provides an institutional-grade, privacy-compliant reconciliation engine that:
1. Ingests raw CSV invoices and bank/gateway payments through an interactive column-mapping wizard with state-machine parsing.
2. Executes a deterministic 4-level matching algorithm (Exact Reference, Exact Customer + Amount, Fuzzy Customer + Date + Amount Tolerance, Manual Review Queue).
3. Supports granular payment splitting and partial payment allocation chains.
4. Detects duplicates (exact and heuristic) with non-destructive exclusion/restoration audit trails.
5. Surfaces financial discrepancies (overpayments, rate drift, date mismatches) with root-cause explanations.
6. Exports formal reconciliation reports (CSV, JSON, print-ready PDF/HTML) with full formula-injection safeguards.

---

## 2. User Experience & Visual Design

Following the **SaaS & Dashboard Guidelines** and **Universal Frontend Design Constitution**:
- **Design Aesthetic**: Premium fintech dark navy / charcoal canvas (`#0b0f17`, `#111827`) paired with crisp slate cards (`#1f2937`), subtle hairline borders (`#374151`), and high-intent electric violet (`#6366f1`) and cyan (`#06b6d4`) accents. Light theme uses crisp porcelain (`#f8fafc`), clean surface cards (`#ffffff`), and slate borders (`#e2e8f0`).
- **Typography**: Clean display sans typography for headers (`Plus Jakarta Sans`), readable body copy (`DM Sans` / `Public Sans`), and monospace tabular figures (`JetBrains Mono` / `tabular-nums`) for all amounts, transaction IDs, and dates.
- **Orderly Navigation**: Fixed 260px sidebar with all 12 operational views, clear active indicators, and keyboard-accessible switching.
- **Top Bar Contract**: Minimalist header displaying the LedgerMatch wordmark, active session selector dropdown, quick "Import Data" and "Run Reconciliation" triggers, and theme toggle.
- **Zero-Pill & Data Density**: Metadata rendered with clean typographic separators (`·`). Compact, readable data tables (38px row height) with sticky headers, numeric right-alignment, and status badges with high WCAG AA contrast.
- **Interactive Two-Panel Reconciliation Workspace**:
  - Left panel: Unmatched / partially matched invoices with outstanding balances.
  - Right panel: Unmatched payments with remaining unallocated balances.
  - Center inspector: Dynamic delta calculator (Amount diff, date diff, customer name Levenshtein similarity), allocation split input, confidence level indicators, and single-click match/reject triggers.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  LedgerMatch  │  Session: FY26-Q3 Corporate Reconciliation ▼  │  [ Import ] [ Reconcile ]  │
├───────────────┬────────────────────────────────────────────────────────────────────────┤
│ 1. Overview   │  RECONCILIATION WORKSPACE (Two-Panel Interactive Allocation)          │
│ 2. Import CSV │ ┌───────────────────────────┬──────────────┬─────────────────────────┐ │
│ 3. Workspace  │ │ Invoices (Left Panel)     │ Match Engine │ Payments (Right Panel)  │ │
│ 4. Matched    │ │ INV-1001 · Acme Corp      │ ◄──────────► │ TXN-9001 · Acme Stores  │ │
│ 5. Partial    │ │ Total: ₹50,000 | Rem: ₹20k│ Diff: ₹0     │ Amount: ₹20,000         │ │
│ 6. Unmatched  │ │ Due: 2026-10-15 (Overdue) │ Date: +4d    │ Date: 2026-10-19        │ │
│ 7. Unmatched P│ │                           │ Conf: HIGH   │                         │ │
│ 8. Duplicates │ ├───────────────────────────┴──────────────┴─────────────────────────┤ │
│ 9. Review     │ │ Allocation Controls: [ Allocate ₹20,000 ]  [ Reject Suggestion ]   │ │
│ 10. Reports   │ └────────────────────────────────────────────────────────────────────┘ │
│ 11. History   │ KPI Metrics: ₹12.4L Invoiced · ₹10.2L Received · ₹2.2L Outstanding     │
│ 12. Settings  └────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Key Product Decisions & Trade-Offs

1. **Vanilla JavaScript & Native Browser APIs**:
   - *Chosen Approach*: Pure ES modules, Native File API, IndexedDB (`IDBDatabase`), and Canvas/SVG rendering. No React, Next.js, or heavyweight runtime dependencies.
   - *Why*: Strict user prompt compliance, lightning-fast boot time, lightweight bundle footprint, zero network latency, and total local isolation of sensitive financial data.
2. **Integer Minor Unit Representation (Paise)**:
   - *Chosen Approach*: All currency amounts are converted to integer minor units (paise) upon import (`100.50 INR` $\rightarrow$ `10050` BigInt/integer). All additions, subtractions, and allocations occur strictly in integers.
   - *Why*: Prevents floating-point rounding errors (`0.1 + 0.2 !== 0.3`) which corrupt accounting ledgers. Multi-currency values preserve their distinct ISO currency codes and can never be merged.
3. **Four-Tier Deterministic Matching Engine**:
   - *Level 1 (Exact Reference)*: `payment.reference_id === invoice.invoice_id` with currency check.
   - *Level 2 (Exact Customer + Amount)*: Normalized alphanumeric customer string match + exact outstanding amount match + within date tolerance window.
   - *Level 3 (Fuzzy Customer + Date + Amount Tolerance)*: Levenshtein distance on company names ($\ge 80\%$) + amount within configurable tolerance.
   - *Level 4 (Manual Review Queue)*: Ambiguous cases (multiple invoices matching the same amount, or partial references) sent to the manual reconciliation workspace.
   - *Why*: Avoids reckless automated matching that would cause false positives in general ledgers.
4. **Non-Destructive Allocation & Audit Ledger**:
   - *Chosen Approach*: Payments are never mutated; allocations are modeled as relational bridge records (`allocation_id`, `invoice_id`, `payment_id`, `allocated_amount_paise`, `timestamp`, `session_id`).
   - *Why*: Allows payments to be split across multiple invoices, partial payments to accumulate, allocations to be undone seamlessly, and an immutable audit trail to be preserved.
5. **CSV Injection Defense**:
   - *Chosen Approach*: On export, all string values starting with `=`, `+`, `-`, `@`, `\t`, or `\r` are prepended with an apostrophe `'` to prevent spreadsheet formula execution exploits.

---

## 4. Technical Architecture & File Strategy

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              index.html                                 │
│  ┌─────────────────────────┐  ┌──────────────────────────────────────┐  │
│  │    Sidebar Navigation   │  │    Top Bar & Active Session Bar      │  │
│  │    (12 Views Swapper)   │  ├──────────────────────────────────────┤  │
│  └─────────────────────────┘  │    Main View Container (#view-root)  │  │
│                               └──────────────────────────────────────┘  │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           ▼                                                   ▼
┌─────────────────────────┐                         ┌─────────────────────┐
│  State & Storage Layer  │                         │   Execution Engines │
│  - data-store.js (IDB)  │                         │   - csv-parser.js   │
│  - audit-log.js         │                         │   - money-utils.js  │
│  - import-manager.js    │                         │   - matching-engine │
│  - column-mapper.js     │                         │   - allocation-eng  │
└──────────┬──────────────┘                         │   - duplicate-det   │
           │                                        │   - discrepancy-eng │
           ▼                                        └──────────┬──────────┘
┌──────────────────────────────────────────────────────────────▼──────────┐
│                   UI & Analytics Presentation Layer                     │
│  - ui.js (DOM renderer, modals, toast, view controllers)               │
│  - analytics.js (native SVG/Canvas charts: completion, trends, bars)   │
│  - report-generator.js (print-ready preview, CSV & JSON generators)     │
│  - app.js (Application bootstrap, global router, event wiring)          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Module Specifications

- `index.html`: Shell layout, modern CSS styling, semantic markup for 12 views, accessible modal containers, and script imports.
- `css/style.css`: High-end SaaS fintech theme (light/dark variables, responsive layout grids, tabular data styles, toast notifications, split panels).
- `js/money-utils.js`: Minor-unit arithmetic, Lakhs/Crores and International formatting, currency safety checks, precision validators.
- `js/csv-parser.js`: Full state-machine parser handling RFC 4180 quotes, multiline fields, commas in quotes, BOM stripping, delimiter sniffing (`,`, `;`, `\t`, `|`).
- `js/column-mapper.js`: Interactive column mapping wizard with auto-detection heuristics and validation error reporting.
- `js/data-store.js`: IndexedDB wrapper storing sessions, invoices, payments, allocations, duplicates, audit events, and user settings.
- `js/matching-engine.js`: Multi-level deterministic matching algorithm with transparent reasoning explanations and confidence scoring.
- `js/allocation-engine.js`: Payment linking, multi-invoice splitting, balance tracking, and allocation rollback mechanics.
- `js/duplicate-detector.js`: Heuristic and exact duplicate identification for invoices and payments with exclusion/restoration capability.
- `js/discrepancy-engine.js`: Root-cause exception detector (amount, date, currency, customer mismatch, unallocated amounts, overpayments).
- `js/reconciliation.js`: High-level orchestrator connecting datasets, running matching passes, and updating session state.
- `js/analytics.js`: Pure native SVG/Canvas charting (reconciliation donut, status breakdown, aging analysis, customer exposure bar charts).
- `js/audit-log.js`: Event logging mechanism tracking every user decision with timestamp and diffs.
- `js/report-generator.js`: Comprehensive reconciliation statement generator with CSV, JSON, and print-to-PDF styles.
- `js/csv-exporter.js`: Safe CSV builder with RFC 4180 quoting and spreadsheet formula injection defense.
- `js/ui.js`: DOM controller, view navigation, modal manager, toast dispatcher, and two-panel workspace interaction handlers.
- `js/app.js`: Main controller initializing IndexedDB, loading active session, handling demo data, and binding application-wide events.
- `sample-data/demo-invoices.csv` & `demo-payments.csv`: Fully loaded B2B sample business data covering every matching edge case.
- `tests/core-tests.js`: In-browser test runner testing CSV parsing, matching levels, money math, duplicates, and allocations.
- `README.md`: Clear setup and architecture documentation including Windows 11 and VS Code Live Server instructions.

---

## 5. Verification Plan

1. **Automated Unit Tests**:
   - Execute in-browser test suite (`tests/core-tests.js`) covering RFC 4180 CSV edge cases, paise currency arithmetic, Levenshtein distance, duplicate groupings, and allocation bounds.
2. **End-to-End User Verification**:
   - **Demo Ingestion**: Click "Load Demo Reconciliation" and verify all 12 views render populated live data.
   - **Matching Accuracy**: Verify Level 1 exact matches, Level 2 customer+amount matches, Level 3 date/amount tolerance matches, and Level 4 manual queue.
   - **Allocation & Splitting**: In the Workspace, allocate ₹20,000 of a ₹50,000 payment to an invoice, verify remaining balances update immediately on both sides without page reload.
   - **Duplicate Handling**: Review detected duplicate transactions, exclude a suspected duplicate, verify KPI updates, and test restoration.
   - **CSV Import Flow**: Upload custom CSV files with non-standard column names, verify the Column Mapping Wizard detects headers and displays a live preview.
   - **Session Backup & Restore**: Export session as JSON, clear database, restore session from file, verify identical state.
   - **Dual Theme**: Toggle between Dark and Light mode, verifying high-contrast legibility and color tokens.
   - **Build & Compilation**: Run `compile_applet` and `lint_applet` to confirm zero syntax or bundling errors.
