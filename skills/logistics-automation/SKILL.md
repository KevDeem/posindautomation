---
name: logistics-automation
description: 'Reusable skill for automated logistics operations in POSIND environments exclusively through Playwright web browser automation. Interprets natural language requests to create orders and service catalogs via the web UI, manages environments and credentials, interacts with web forms, and verifies created records in the UI.'
---

# Logistics Automation Skill (UI-Only with Playwright)

## Overview

The Logistics Automation skill coordinates natural language dispatch for logistics operations performed **exclusively through web browser UI automation using Playwright**.

**No API endpoints or direct API calls are used for transactional operations (order creation, confirmation, VA retrieval, or payment execution).** All operations occur through the browser interface.

---
## Reusable Order Execution Architecture

The execution engine is fully decoupled from individual routes, dates, order quantities, or transaction identifiers:

```text
Natural Language Instruction
         │
         ▼
[Specification Resolver] (order_specification.js)
  - Granular inheritance & field origin tagging
  - Independent PICs & location-change child resets
  - Policy enforcement: Non-Contract Only
         │
         ▼
[Specification Review & User Confirmation]
         │
         ├─────────────────────────────────────────┐
         ▼                                         ▼
[General Order Engine] (order_executor.js)    [Generic Batch Executor] (batch_executor.js)
  - executeOrder(spec, options)                 - executeBatch(batchInput, options)
  - Dynamic Domestic / Intl Dispatch            - Accepts array, count N, or multi-groups
  - Real-time catalog discovery                 - Sequential execution & retry loop (from start)
  - Halts if catalog missing (no inquiry)       - Per-order tracking & independent errors
         │                                         │
         └────────────────────┬────────────────────┘
                              ▼
                [Reusable Payment Engine] (payment_executor.js)
                  - executeOrderPayment(page, context, orderResult)
                  - Dedicated VA extraction from payment page (never Order/Shipment ID)
                  - Dynamic amount extraction from UI summary (no hardcoded costs)
                  - Playwright simulation in Payment Sandbox UI
                  - Status verification in OMS (/my/order -> 'Dibayar')
```

---
## Core Capabilities

1. **Natural Language Request Dispatch**:
   - Classifies intent (`single-order`, `batch-order`, `service-catalog-creation`).
   - Resolves dynamic runtime specifications without generating new code files.
2. **Generic Batch Execution**:
   - `executeBatch({ specification, count: 5 })` or `executeBatch({ groups: [...] })`.
   - Never creates transaction-specific JavaScript scripts for orders or batches.
   - Independent error tracking and configurable retry-from-start per transaction.
3. **Dynamic Specification Resolution & Granular Reuse**:
   - Manages previous order specifications in `.sessions/previous_order_spec.json`.
   - Reuses past values on a granular, field-by-field basis without hardcoding.
   - Independent Pickup and Drop-off locations and PICs (`pic_manager.js`).
   - Resets child location details (districts/subdistricts) when parent city changes.
   - Displays pre-submission review tables tagging field origins (`[Provided]`, `[Reused]`, `[Generated Synthetic]`, `[UI Default]`).
4. **Decoupled Payment Execution**:
   - Extracts dedicated Virtual Account (VA) from the UI instructions screen.
   - Extracts dynamic order amount from the UI.
   - Executes payment exclusively through the Payment Sandbox web UI.
   - Verifies updated status directly in OMS.
5. **Non-Contract Ordering Policy (Temporary Global Policy)**:
   - Always select **Order Without Contract / Non-Contract**.
   - Never search, select, or input contracts.
   - If no applicable Service Catalog exists, halts immediately without redirecting to Inquiry.
6. **Headed Visual Execution by Default**:
   - Setup, inspection, and manual review default to headed Chromium.
   - Headless execution is opt-in upon request (`run it headless`).

---
## Tools & Directory Structure

```text
skills/logistics-automation/
├── SKILL.md                                 # Skill definition & architecture documentation
├── bot/                                     # Standalone interactive CLI ordering bot
│   ├── README.md                           # Bot user guide & CLI documentation
│   ├── cli.js                              # CLI executable entry point (`npm run order`)
│   ├── config.js                           # Bot runtime & environment configuration
│   ├── history_manager.js                  # Persistent execution log & credential sanitizer
│   ├── nl_parser.js                        # Natural language instruction parser
│   └── order_bot.js                        # Interactive CLI workflow & menu manager
├── config/
│   ├── environments.json                   # Active environment configurations
│   └── environments.template.json          # Template environment registry
├── docs/
│   ├── auth-and-credentials.md             # UI auth and session management rules
│   ├── oms-international-order-ui.md       # International UI structure reference
│   └── order-specification-template.md     # Natural language order specification guide
└── tools/
    ├── batch_executor.js                   # Generic batch executor (sequential, retries)
    ├── browser_manager.js                  # Playwright lifecycle (headed default)
    ├── inspect_ui.js                       # Non-destructive UI inspector
    ├── manage_environments.py              # Environment onboarding CLI tool
    ├── order_executor.js                   # General order execution engine (Domestic & Intl)
    ├── order_specification.js              # Dynamic specification resolution engine
    ├── payment_executor.js                 # Decoupled payment & sandbox UI engine
    ├── pic_manager.js                      # Synthetic realistic Indonesian PIC generator
    ├── smoke_test.js                       # Playwright infrastructure smoke test
    ├── test_bot.js                         # Bot CLI unit tests & parser validation
    ├── test_engine.js                      # Reusable engine & batch verification test suite
    └── test_specification.js               # Specification inheritance unit tests
```

---
## Natural Language Dispatch Examples

### 1. Single Domestic Order
```markdown
User: "Create a domestic order from Tebet, Jakarta Selatan to Gubeng, Surabaya on 19 November 2026 at 10:00."
Agent:
1. Resolves specification using `resolveSpecification()`.
2. Displays formatted specification review table with field origins.
3. Asks user for confirmation before submission.
4. Calls `executeOrder(spec, { headless })`.
5. Calls `executeOrderPayment()` to pay via Payment Sandbox UI.
6. Reports Order ID, VA number, payment status, and verification.
```

### 2. Batch Domestic Orders (Quantity N or Multiple Groups)
```markdown
User: "Create 5 domestic orders from Tebet to Gubeng at 08:00, and 6 orders from Kesambi to Adiwerna at 10:00 on 1 Dec 2026. Run it headless."
Agent:
1. Constructs runtime specification groups (Group A count 5, Group B count 6).
2. Displays consolidated review table for the batch.
3. Obtains confirmation before submitting real transactions.
4. Calls `executeBatch({ groups: [...] }, { headless: true, autoPay: true, maxRetries: 2 })`.
5. Does NOT generate any new script.
6. Reports breakdown of succeeded and failed orders with independent IDs and VAs.
```

### 3. Partial Update with Previous Value Reuse
```markdown
User: "Create another domestic order, but change drop-off to Bandung and generate a new drop-off PIC. Keep everything else."
Agent:
1. Reuses pickup, cargo, and schedule from `.sessions/previous_order_spec.json`.
2. Updates dropoff city to Bandung and resets child district fields.
3. Synthesizes a new PIC profile via `pic_manager.js`.
4. Shows review table tagging reused vs generated fields.
5. Executes order upon confirmation.
```

---
## Standalone Ordering Bot CLI (`npm run order`)

The repository includes an interactive terminal bot that operates independently of PandaCode or external AI harnesses:

```bash
# Launch interactive bot
npm run order

# Run headless
HEADLESS=true npm run order
```

### Key Bot Features
- **7-Option Interactive Menu**: Domestic, International, Batch, and Payment Simulation workflows.
- **Natural Language Parsing**: Direct conversion of freeform instructions to structured specifications.
- **Pre-Submission Review & Edit Gate**: Displays explicit field origin tags with edit and abort controls.
- **Sanitized Execution History**: Persists order IDs, airway bills, and payment states in `.execution-history/` while automatically scrubbing session credentials and secrets.

