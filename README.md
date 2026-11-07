# LedgerMatch — Intelligent Invoice & Payment Reconciliation Platform
**Tagline: Every Payment Has Its Invoice.**

LedgerMatch is an intelligent, privacy-first financial operations workspace engineered to reconcile sales invoices against payment transaction records entirely in the browser. Operating strictly on the client device with native File API, IndexedDB, and integer-minor-unit (paise) precision, it automates four-tier deterministic matching, multi-payment allocations, duplicate detection, discrepancy resolution, and audit reporting.

---

## 1. Quick Start & Setup Instructions

LedgerMatch requires **no external database, no server backend, and no external financial APIs**. All data processing, indexing, matching, and calculations run locally on your machine.

### Running with VS Code Live Server (Windows 11 / Mac / Linux)
1. Clone or open the `LedgerMatch` project directory in **Visual Studio Code**.
2. Install the **Live Server** extension (by Ritwick Dey) from the VS Code Marketplace if not already installed.
3. Right-click `index.html` in the file explorer and select **"Open with Live Server"**.
4. The application will launch at `http://127.0.0.1:5500/index.html`.

### Running with Node.js / Vite
```bash
# Install dependencies
npm install

# Run the local development server
npm run dev

# Open browser at http://localhost:3000
```

---

## 2. Core Architecture & Privacy Guarantees

- **Zero Cloud Transmission**: Raw CSV files, transaction values, and customer records never leave your browser. All storage is managed via standard browser **IndexedDB** (`LedgerMatch_DB_v1`).
- **Integer Minor-Unit Math (Paise)**: Financial calculations avoid IEEE-754 floating-point errors (e.g. `0.1 + 0.2 = 0.30000000000000004`). All amounts are represented and calculated as integer minor units (paise for INR: 1 INR = 100 paise).
- **Formula Injection Defense**: When exporting CSV reports, all fields starting with `= `, `+`, `-`, `@`, `\t`, or `\r` are sanitized to prevent spreadsheet macro execution attacks in Microsoft Excel or Google Sheets.

---

## 3. Four-Tier Deterministic Matching Engine

LedgerMatch rejects black-box or non-deterministic AI matching. Every suggested match is strictly rule-based and includes transparent reasoning:

### Level 1 — Exact Reference Match (High Confidence)
- **Rules**:
  - `invoice.invoice_id === payment.reference_id` (or normalized reference match).
  - Exact currency match (`INR === INR`).
- **Confidence**: `HIGH` (Rule-based 100% reference confidence).
- **Audit Explanation**: Displays exact ID alignment, settlement date delta, and whether the payment clears the invoice in full or as a partial tranche.

### Level 2 — Exact Customer + Amount Match (High Confidence)
- **Rules**:
  - Normalized customer and payer names match identically (legal suffixes such as `Pvt Ltd`, `LLC`, `Corp` stripped).
  - Exact outstanding amount (`payment.amount === invoice.remaining_balance`).
  - Same currency.
  - Payment date falls within the configurable date window (default 30 days).
- **Confidence**: `HIGH` (if single candidate) or routed to `Manual Review` (if multiple invoices have the exact same amount for the same customer).

### Level 3 — Customer + Date + Amount Tolerance (Medium Confidence)
- **Rules**:
  - Normalized customer name Levenshtein similarity $\ge 80\%$.
  - Amount within configured tolerance.
  - Same currency.
  - Payment date falls within the tolerance window.
- **Confidence**: `MEDIUM`.

### Level 4 — Manual Review Queue
- Ambiguous records (e.g. 1 payment matches multiple invoices with the same amount, or unrecognized reference numbers) are automatically routed to the Manual Review queue for explicit user decision.

---

## 4. Partial Payments & Payment Allocation

LedgerMatch models payments and invoices as non-destructive entities:
- **Partial Payments**: Multiple payments can be linked to a single invoice. Each allocated tranche reduces the invoice's remaining balance while preserving the audit chain.
- **Payment Splitting**: A large single payment can be split across multiple invoices. The engine enforces an invariant ceiling: total allocated amounts cannot exceed the original transaction value.
- **Dynamic Statuses**:
  - Invoices: `UNPAID`, `PARTIALLY_PAID`, `FULLY_PAID`, `OVERPAID`.
  - Payments: `UNALLOCATED`, `PARTIALLY_ALLOCATED`, `FULLY_ALLOCATED`, `OVER_ALLOCATED`.

---

## 5. Duplicate Detection & Non-Destructive Audit Trail

- Detects identical transaction IDs, duplicate invoice IDs, and heuristic duplicate payments (same amount, same date, and identical or similar payer).
- **Non-Destructive Actions**: Records are never silently deleted. Suspected duplicates can be **Excluded** from the reconciliation pool or **Restored** at any time.
- All actions generate immutable event records with timestamps, before/after diffs, and human-readable descriptions in the Audit History.

---

## 6. Dashboard KPI Summary & Native PDF Reports

LedgerMatch provides executive-grade reporting powered by native browser print rendering (`window.print()`):

### 🖨 Exporting Dashboard KPI Summaries as PDF
1. Navigate to the **Overview Dashboard** (or **Reports** tab).
2. Click the **"🖨 Export KPI Report (PDF)"** button located in the top banner.
3. The browser's native print dialog will launch with an isolated A4 printable document containing:
   - **Formal Executive Header**: Company entity, active session name/ID, generation timestamp, and currency unit specifications.
   - **4-Column Primary KPI Grid**: Total Invoiced, Total Received, Outstanding Balance, and Reconciliation Clearance Rate.
   - **Reconciliation Distribution**: Fully settled invoices, partially paid tranches, completely unpaid invoices, and payment health metrics.
   - **Top Customer Outstanding Balances**: Top debtor accounts ranked by exposure with percentage share calculations.
   - **Critical Accounting Exceptions**: Identified discrepancies (overpayments, partial settlements, unapplied payments) with variance analysis and suggested actions.
   - **Formal Audit Certification Block**: Cryptographic session verification hash and physical auditor/controller signature lines.
4. In the print dialog destination, select **"Save as PDF"** (or choose your physical printer). The CSS `@page { size: A4 portrait; margin: 12mm; }` rule ensures crisp, vectorized, zero-distortion rendering with all navigation and UI elements automatically hidden.

### 📋 Full Audit Statement & CSV Exports
- In the **Reports** view, controllers can also print a complete itemized reconciliation statement covering all individual invoices and payments.
- Filtered CSV exports are available for Matched Invoices, Unmatched Invoices, and Unmatched Payments, sanitized with formula injection protection.

---

## 7. State-Machine CSV Parser & Delimiter Sniffing

LedgerMatch includes a hand-crafted deterministic Finite State Machine (FSM) parser (`js/csv-parser.js`):
- **RFC 4180 Compliance**: Accurately processes fields containing escaped double quotes (`""`), commas, and embedded multiline linebreaks (`\r\n` and `\n`).
- **Delimiter Auto-Detection**: Inspects candidate separators (comma `,`, semicolon `;`, tab `\t`, pipe `|`) across unquoted spans to select the dominant delimiter.
- **BOM & Preamble Stripping**: Removes UTF-8 Byte Order Marks (`\uFEFF`) and skips non-tabular preamble lines automatically.
- **Interactive Column Mapping Wizard**: Maps disparate accounting software headers (Tally, QuickBooks, SAP, Zoho, Stripe) to LedgerMatch canonical schema fields.

---

## 8. Built-in Automated Tests

LedgerMatch includes a self-contained in-browser unit test runner (`tests/core-tests.js`). You can execute the test suite directly from the **Settings & Diagnostics** view or via Node.js CLI:
- RFC 4180 CSV state-machine parser with multiline fields and escaped quotes.
- Paise integer precision and Indian Lakhs/Crores formatting.
- Legal suffix stripping and Levenshtein similarity calculations.
- Multi-tier matching engine assertions.
- Allocation ceilings and partial payment transitions.
- Duplicate detection groupings.
- Formula injection escaping defenses.

To run tests in the command line:
```bash
node -e "import('./tests/core-tests.js').then(m => m.runAllTests(console.log))"
```
