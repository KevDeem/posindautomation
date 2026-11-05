---
name: logistics-automation
description: 'Reusable skill for automated logistics operations in POSIND environments exclusively through Playwright web browser automation. Interprets natural language requests to create orders and service catalogs via the web UI, manages environments and credentials, interacts with web forms, and verifies created records in the UI.'
---

# Logistics Automation Skill (UI-Only with Playwright)

## Overview

The Logistics Automation skill coordinates natural language dispatch for logistics operations performed **exclusively through web browser UI automation using Playwright**.

**No API endpoints or API-based submissions are used for any part of these workflows.** All authentication, navigation, form filling, master data selection, and transaction verification occur through the browser interface.

---

## Core Capabilities

1. **Natural Language Request Dispatch**:
   - Classifies intent (`order-creation`, `service-catalog-creation`, or batch variants).
   - Extracts route parameters, schedules, cargo, and environment indicators.
2. **Strict Environment & Account Isolation**:
   - Validates requested target environment against `config/environments.json`.
   - Never assumes default environment when intent is ambiguous; halts and prompts user.
   - Resolves credentials strictly from runtime environment variables (no hardcoded secrets).
3. **Dynamic Specification Resolution & Granular Reuse**:
   - Manages previous order specifications in `.sessions/previous_order_spec.json`.
   - Reuses past values on a granular, field-by-field basis without hardcoding.
   - Independent Pickup and Drop-off locations and PICs.
   - Generates realistic, safe Indonesian PIC contact profiles on demand (`pic_manager.js`).
   - Displays pre-submission review tables tagging every field origin (`[Provided]`, `[Reused]`, `[Generated Synthetic]`, `[UI Default]`).
4. **Headed Visual Execution by Default**:
   - Both inspection and repeatable execution default to **headed Chromium** with human-observable slowMo pacing.
   - Headless execution is strictly opt-in upon explicit user request.
5. **Playwright UI Execution & Verification**:
   - Interacts with web forms, inputs, dropdowns, date pickers, modals, and submission controls.
   - Uses accessible and semantic locators (`getByRole`, `getByLabel`, `getByPlaceholder`).
   - Reuses authenticated browser sessions via Playwright `storageState` when valid.
   - Verifies created entity IDs, tracking numbers, and statuses directly from DOM elements, toasts, and data tables.
6. **Non-Contract Ordering Policy (Temporary Global Policy)**:
   - Always select **Order Without Contract / Non-Contract** when creating any domestic or international order.
   - Never search, select, or input contracts, even if contracts exist.
   - Progress directly to Service Catalog matching under the Non-Contract flow.
   - If no applicable Service Catalog exists, halts immediately without redirecting to Inquiry.

---

## Workflow Directory Structure

```text
skills/logistics-automation/
├── SKILL.md                                 # Skill definition and dispatcher
├── config/
│   └── environments.template.json           # Template environment registry (UI-only)
├── docs/
│   ├── auth-and-credentials.md             # UI auth and session management rules
│   └── order-specification-template.md     # Dynamic order specification guide & examples
├── tools/
│   ├── browser_manager.js                  # Playwright lifecycle (headed default)
│   ├── inspect_ui.js                       # Non-destructive UI & locator inspector
│   ├── manage_environments.py              # Environment onboarding CLI tool
│   ├── order_specification.js              # Dynamic specification resolution engine
│   ├── pic_manager.js                      # Synthetic realistic Indonesian PIC generator
│   └── smoke_test.js                       # Headed & headless browser smoke test runner
└── workflows/
    ├── order-creation.md                   # UI Order creation specification & reuse model
    └── service-catalog-creation.md         # UI Service catalog creation specification
```

---

## Environment Onboarding

Environments can be registered via interactive wizard or CLI flags without manually editing JSON:
- **Interactive Wizard**: `python3 skills/logistics-automation/tools/manage_environments.py --interactive`
- **Command-line Registration**:
  ```bash
  python3 skills/logistics-automation/tools/manage_environments.py --add \
    --env-name "staging-posind-core" \
    --app-url "https://staging-app.example.internal" \
    --account-id "ops-admin" \
    --login-method "standard-ui-form" \
    --login-url "/login" \
    --cred-var "POSIND_STAGING" \
    --workflows "order-creation,service-catalog-creation"
  ```
- **List Environments**: `python3 skills/logistics-automation/tools/manage_environments.py --list`

---

## Dispatch Process Flow

### 1. Intent Classification
Analyze the user request to determine the target workflow:

| User Request Pattern | Target Workflow | Reference Spec |
| :--- | :--- | :--- |
| "Create an order from [A] to [B] on [Date]" | Order Creation | `workflows/order-creation.md` |
| "Create [N] orders using [routes/schedules]" | Batch Order Creation | `workflows/order-creation.md` |
| "Create a service catalog from [A] to [B]" | Service Catalog Creation | `workflows/service-catalog-creation.md` |

### 2. Environment Selection & Verification
1. Identify target environment mentioned in user prompt or session context.
2. If omitted or ambiguous:
   - Halt execution.
   - Ask user to select target environment and account from the available registry.
3. Validate that the chosen environment supports the target workflow in its `supportedWorkflows` list.
4. Resolve UI login credentials from designated environment variable references.
5. If credentials are missing in the local environment, report the missing environment variable name without proceeding.

### 3. Parameter Validation & Clarification
1. Match extracted entities against mandatory workflow fields:
   - **Order Creation**: Origin, Destination, Scheduled Date, Package Details.
   - **Service Catalog**: Origin Node, Destination Node, Service Type / Transport Mode.
2. If mandatory parameters are missing:
   - Ask user targeted questions specifically for the missing items.
   - Do NOT prompt for fields that have valid system defaults in the web form.

### 4. Playwright UI Execution & DOM Verification
1. Launch Playwright browser context (reusing saved session state if available).
2. Authenticate through the browser login form if unauthenticated.
3. Navigate to the relevant feature page via UI navigation menus.
4. Populate form controls using robust locators:
   - Select dropdown/combobox options for origins, destinations, and services.
   - Interact with date picker widgets.
   - Fill text, numeric, and textarea inputs.
5. Submit form and verify completion directly in the UI:
   - Wait for confirmation toast/banner or redirect to detail/table page.
   - Extract generated ID, status, and tracking code from the DOM.

### 5. Standardized Output Format
Return execution result to user:
```markdown
- **Operation**: [Order Creation | Service Catalog Creation]
- **Environment**: [Environment Name]
- **Account**: [Account ID]
- **Status**: [SUCCESS | FAILED]
- **Entity ID**: [Created ID extracted from UI]
- **Tracking / Route Code**: [Code extracted from UI]
- **Execution Method**: Browser UI (Playwright)
- **Details**: [Summary of route, dates, and parameters]
```
