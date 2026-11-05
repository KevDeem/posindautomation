# POSIND Standalone Ordering Bot

Interactive, terminal-driven CLI ordering bot for POSIND Logistics Automation. Enables direct order creation, batch execution, and payment simulation without requiring PandaCode or an AI agent harness.

---

## 1. Prerequisites & Installation

- **Node.js**: v18.x or higher
- **Playwright**: Chromium browser installed

```bash
# Install dependencies
npm install

# Install Playwright browser binaries if not already installed
npx playwright install chromium
```

---

## 2. Session Authentication

The bot relies on a stored Playwright session cookie to interact with the POSIND OMS web UI.

Ensure an active session file exists in `.sessions/`:
```bash
# Verify session health
node skills/logistics-automation/tools/smoke_test.js

# If expired or missing, run interactive login:
node skills/logistics-automation/tools/interactive_login.js
```

---

## 3. Launching the Bot

Start the interactive CLI:

```bash
npm run order
```

### Environment Overrides

```bash
# Run in headless mode (default is headed visual execution)
HEADLESS=true npm run order

# Enable debug logs
LOG_LEVEL=debug npm run order

# Custom session path
SESSION_PATH=.sessions/custom_session.json npm run order
```

---

## 4. Main Menu Options

```text
============================================================
           POSIND LOGISTICS AUTOMATION BOT
============================================================
  1. Create Domestic Order
  2. Create International Order
  3. Create Multiple Orders (Batch)
  4. Create Order and Simulate Payment
  5. Create Multiple Orders and Simulate Payment
  6. View Previous Execution Results
  7. Exit
============================================================
```

---

## 5. Usage & Natural Language Examples

When prompted, you can enter natural language instructions or structured fields:

### Single Domestic Order
> "Create a domestic order from Tebet, Jakarta Selatan to Gubeng, Surabaya on 1 December 2026 at 08:00"

### International Order
> "Create an international air cargo order from Tangerang to Orchard Singapore, pickup 25 November 2026 at 03:30"

### Batch Orders
> "Create 5 domestic orders from Tebet Jakarta Selatan to Gubeng Surabaya, scheduled for 1 December 2026 at 08:00"

### Order with Payment Simulation
Choose Option 4 or 5. The engine will:
1. Complete order submission in OMS.
2. Extract the dedicated Virtual Account (VA) from the UI payment instructions.
3. Extract the dynamic total amount from the UI summary.
4. Open the Payment Sandbox UI and simulate the bank transfer.
5. Re-check the OMS order list (`/my/order`) and verify status transitions to `Dibayar`.

---

## 6. Specification Review Gate

Before any browser automation begins, the bot resolves your request, applies granular inheritance from previous orders, generates synthetic Indonesian PIC information (if unspecified), and displays a pre-submission review table:

```text
================================================================================
                    ORDER SPECIFICATION REVIEW
================================================================================
Field                     Value                                    Origin
--------------------------------------------------------------------------------
Shipment Type             Domestic                                 [Provided]
Cargo Category            Dokumen                                  [UI Default]
Pickup City               Jakarta Selatan                          [Provided]
Pickup District           Tebet                                    [Provided]
Dropoff City              Surabaya                                 [Provided]
Dropoff District          Gubeng                                   [Provided]
Pickup Date               2026-12-01 08:00                         [Provided]
Pickup PIC Name           Budi Santoso                             [Generated Synthetic]
Pickup PIC Phone          08123456789                              [Generated Synthetic]
Dropoff PIC Name          Siti Rahayu                              [Generated Synthetic]
Dropoff PIC Phone         08219876543                              [Generated Synthetic]
Policy                    Non-Contract Only                        [UI Default]
================================================================================
```

You will be prompted:
`Proceed with submission? (y/N/edit):`
- **y**: Proceed to UI execution.
- **edit**: Manually update any field before proceeding.
- **N**: Cancel execution safely without placing any order.

---

## 7. Execution History

All execution attempts, order IDs, airway bills, VA numbers, and payment verification statuses are recorded in `.execution-history/history.json`.

- Sensitive session credentials, cookies, and tokens are automatically sanitized before writing to disk.
- View history anytime via **Option 6** in the CLI menu.

---

## 8. Troubleshooting

| Issue | Cause | Resolution |
| :--- | :--- | :--- |
| `Session expired or invalid` | Expired OMS authentication cookie | Run `node skills/logistics-automation/tools/interactive_login.js` |
| `No applicable Service Catalog found` | Route has no Non-Contract catalog | Bot enforces Non-Contract policy and halts. Do not redirect to Inquiry. |
| `Calendar month selector timeout` | Ant Design localized month abbreviation | Automated engine maps Indonesian abbreviations (`Des`, `Mei`, `Agt`, `Okt`). |
| `Browser closes unexpectedly` | Missing dependencies or crash | Run with `HEADLESS=false` to visually inspect error state. |
