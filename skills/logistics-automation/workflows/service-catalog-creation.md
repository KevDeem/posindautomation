# Service Catalog Creation Workflow Specification (UI-Only with Playwright)

## Overview

Automates creation of logistics service catalogs, routes, and tariff definitions exclusively through the application's web interface using Playwright. Accepts natural language requests, validates origin/destination nodes and transport mode, navigates catalog management pages, enters form fields, handles modal dialogs, submits through the browser, and verifies active catalog records in the UI table.

**No API endpoints or API-based submissions are used.**

---

## Parameter Specification

### Mandatory Fields
| Field Name | Type | UI Interaction | Prompt Trigger |
| :--- | :--- | :--- | :--- |
| `environment` | `string` | Target environment identifier | Prompt user if missing or ambiguous |
| `account` | `string` | Account with catalog management permissions | Defaults to `defaultAccount` if omitted |
| `originNode` | `string` | Select Origin port, terminal, or hub from dropdown | Prompt user if missing |
| `destinationNode` | `string` | Select Destination port, terminal, or hub from dropdown | Prompt user if missing |
| `serviceType` | `string` | Select transport mode (e.g., Sea Freight, Road Feeder, Air) | Prompt user if not clear |
| `effectiveDate` | `ISO Date` | Set effective date via date picker | Defaults to current date if omitted |

### Optional / Defaulted Fields
| Field Name | Type | Default Value | UI Behavior |
| :--- | :--- | :--- | :--- |
| `transitTimeDays` | `number` | System route standard | Enter value into SLA/transit days input |
| `baseRate` | `number` | Standard tariff tier | Enter pricing in tariff table / input |
| `status` | `string` | Active | Select status toggle or dropdown (`Active` / `Draft`) |
| `currency` | `string` | IDR | Default currency dropdown selection |

---

## Workflow Execution Stages (Playwright UI)

### Stage 1: Request Interpretation & Extraction
1. Extract route endpoints:
   - Origin (e.g. "Tanjung Priok")
   - Destination (e.g. "Makassar")
2. Determine or clarify transport mode:
   - Sea/Maritime for port-to-port routes.
   - Ground/Trucking for land routes.
   - Air for airport pairs.
   - If ambiguous, prompt user to confirm service type.
3. Validate mandatory fields; query user only for missing mandatory values.

### Stage 2: Browser Initialization & Session Verification
1. Launch Playwright browser instance with configured viewport and timeout settings.
2. Check for existing valid browser `storageState` in `.sessions/`.
3. If unauthenticated, navigate to login page, fill credentials, submit, and save `storageState`.

### Stage 3: Navigation to Service Catalog Console
1. Navigate via UI menus:
   - Click navigation link for Service Catalog / Route Management (`page.getByRole("link", { name: /service catalog|katalog layanan|rute/i })`).
2. Verify catalog listing screen is visible (`page.getByRole("table")` or catalog header).
3. Check table search to confirm route does not already exist (prevent duplicate routes).
4. Click creation button (`page.getByRole("button", { name: /add catalog|tambah katalog|new route/i })`).

### Stage 4: Form & Modal Interaction
1. **Origin & Destination Selection**:
   - Open origin node selector/combobox, filter and choose designated origin hub.
   - Open destination node selector/combobox, filter and choose designated destination hub.
2. **Service Type & Schedule**:
   - Select transport mode / service type radio button or select item.
   - Set effective start date using the UI datepicker.
3. **Rates & SLA**:
   - Fill transit duration and base tariff inputs if applicable.
4. **Pre-Submission Check**:
   - Ensure form indicates valid state (no required field highlights).
5. **Form Submission**:
   - Click save or publish button (`page.getByRole("button", { name: /save|publish|simpan/i })`).
   - Confirm in any confirmation dialog modal if prompted.

### Stage 5: UI Verification & Response Extraction
1. Verify creation exclusively through UI elements:
   - Wait for success notification / toast banner.
   - Wait for catalog listing table or details page to refresh.
2. Verify the newly created row in the catalog table:
   - Locate table row containing origin and destination.
   - Extract Catalog ID, Route Code, and Status from table cells.
3. Capture a screenshot artifact if required for visual verification.

### Stage 6: Error Handling & Form Failure Recovery
- **Duplicate Route Alert**: If the UI warns that an active catalog already exists for this route, cancel form submission and report the warning to the user.
- **Permission Denied**: If catalog creation controls are disabled or missing due to insufficient account roles, report the missing UI permission.
- **No API Fallback**: Always stay in the UI; report any DOM errors or failed interactions directly.
