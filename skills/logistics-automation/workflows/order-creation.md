# Order Creation Workflow Specification (UI-Only with Playwright)

## Overview

Automates order creation exclusively through the application's web interface using Playwright. Accepts natural language requests, validates mandatory parameters, authenticates via the browser login form or saved session, navigates application menus, populates inputs and select fields, submits the form, and verifies created orders through UI confirmation screens and tables.

**No API endpoints or API-based submissions are used.**

---

### Parameter Specification & Dynamic Reuse Model

The order creation engine is **specification-driven**. Previous orders do not hardcode the workflow; instead, previous valid values are stored in `.sessions/previous_order_spec.json` and serve as a reusable baseline.

### Global Order Policy: Non-Contract Ordering Only (Temporary Global Policy)
- **Always Non-Contract**: Always select **Order Without Contract / Non-Contract** when creating an order.
- **No Contract Selection**: Do not attempt to select or search for a contract.
- **No Contract-Based Ordering**: Do not use Contract-based ordering for now, even if contracts are available.
- **Service Catalog Progression**: Continue directly with applicable Service Catalog selection after entering Non-Contract details.
- **Policy Scope**: Applies to all order creation workflows (Domestic and International) until explicitly changed.

### Granular Reuse & Overwrite Principles
1. **Explicit Precedence**: Explicitly provided values in user prompts always take precedence over remembered values.
2. **Location Independence**: Changing Pickup does not alter Drop-off; changing Drop-off does not alter Pickup.
3. **Independent PICs**: Pickup PIC and Drop-off PIC can be updated, reused, or generated independently.
4. **No Transaction Reuse**: Transactional IDs (`ORCA...`, `SOCB...`, VA numbers) are never reused.
5. **No Blind Catalog Reuse**: Service Catalogs are re-evaluated dynamically through the UI.

### Specification Fields
| Field Name | Type | UI Interaction | Handling Policy |
| :--- | :--- | :--- | :--- |\
| `environment` | `string` | Target environment identifier | Prompt user if missing or ambiguous |\
| `account` | `string` | Account identifier within environment | Defaults to `defaultAccount` if omitted |\
| `orderType` | `string` | `domestic` or `international` | Defaults to domestic or previous selection |\
| `transportationMode`| `string`| Mode button (`SEMUA`, `Land`, etc.) | Reused from baseline unless specified |\
| `pickup` | `LocationSpec` | Door/Port, Province, City, District, Address | Independent; changed without affecting dropoff |\
| `pickup.pic` | `PICSpec` | Name, Company, Address, Email, Phone | Explicitly provided, reused, or synthetically generated |\
| `dropoff` | `LocationSpec` | Door/Port, Province, City, District, Address | Independent; changed without affecting pickup |\
| `dropoff.pic` | `PICSpec` | Name, Company, Address, Email, Phone | Explicitly provided, reused, or synthetically generated |\
| `scheduledDate` | `ISO Date` | Set date picker or date input field | Reused from baseline unless specified |\
| `cargo` | `CargoSpec` | Commodity, Item Name, Weight, Dimensions, Packaging | Reused from baseline unless specified |\

---

## Browser Visibility Modes

1. **Setup & Inspection Mode**: Always launches in **headed Chromium** (default). Never headlessly by default.
2. **Repeatable Execution Mode**: Defaults to **headed Chromium** with visible slowMo delay (100–150ms). Keeps the browser window open long enough to observe form filling, catalog selection, and final confirmation.
3. **Opt-in Headless Mode**: Executed headlessly **only** when explicitly requested by user (e.g. *"Run this order headlessly"*). Never silently switch to headless mode.

---

## Workflow Execution Stages (Playwright UI)

### Stage 1: Request Interpretation & Granular Specification Resolution
1. Parse user prompt for explicitly specified order fields (route, cargo, schedule, PICs).
2. Invoke `resolveSpecification(inputSpec, options)` from `skills/logistics-automation/tools/order_specification.js`:
   - Tag explicitly supplied fields as `[Provided]`.
   - Preserve unspecified fields from the baseline as `[Reused]`.
   - If requested or missing without previous profile, generate realistic Indonesian PIC contacts tagged as `[Generated Synthetic]` (using `@example.com` domains).
3. If mandatory fields (`city`, `scheduledDate`, `weightKg`, etc.) are missing and have no baseline:
   - Pause execution and ask user specifically for those missing fields.

### Stage 2: Pre-Submission Specification Review
1. Render formatted specification review table highlighting the origin status of each field:
   - `[Provided]`
   - `[Reused]`
   - `[Generated Synthetic]`
   - `[UI Default]`
2. Display total cost, selected route, and cargo summary.
3. Require user confirmation before submitting the transaction in OMS.

### Stage 3: Browser Initialization & Session Verification
1. Launch Playwright browser instance:
   - **Default: Headed Chromium** (`headless: false`, `slowMo: 100`).
   - If headless explicitly requested: `headless: true`.
2. Check for existing valid browser `storageState` in `.sessions/`.
3. If unauthenticated, execute login via accessible form locators and save session.

### Stage 4: Navigation to Order Creation Form
1. Use semantic navigation:
   - Click navigation menu link (`page.getByRole("link", { name: /orders|pesanan/i })` or direct page URL `/domestic-shipping`).
   - Await form initialization and modal visibility.

### Stage 5: Form Interaction & Submission
1. **Origin & Destination**:
   - Fill and save Pickup Point (Type, Province, City, District, Subdistrict, PIC).
   - Fill and save Drop-off Point (Type, Province, City, District, Subdistrict, PIC).
2. **Date & Schedule**:
   - Set pickup date and time in Ant Design calendar picker.
3. **Cargo & Package Details**:
   - Select product characteristics, add commodity, item name, weight, dimensions, and packaging type.
4. **Service Catalog Availability & Selection**:
   - Search and select applicable Service Catalog in the UI based on order specification.
   - **MANDATORY STOP RULE**: If no applicable Service Catalog exists:
     - Stop immediately.
     - **NEVER** automatically redirect to Inquiry.
     - **NEVER** silently switch to a different order type (e.g. non-contract, quotation, inquiry).
     - Explain why catalog is unavailable based on UI messages/state.
     - Ask user to revise order specification.
     - Wait for user revised specification before proceeding.
5. **Form Submission**:
   - Upon user confirmation, submit the form (`page.getByRole("button", { name: /simpan|submit|buat pesanan/i })`).
   - Save updated valid specification to `.sessions/previous_order_spec.json` as the new baseline for future orders.

### Stage 5: UI Verification & Order Confirmation
1. Verify creation exclusively through UI elements:
   - Wait for success alert/toast (`page.getByRole("alert")` or success banner).
   - Verify transition to Order Summary / Order Confirmation screen (`Ringkasan Pesanan`).
2. Extract generated identifiers directly from the DOM:
   - Read Order ID (`ID Pesanan`) and Shipment ID (`ID Shipment`) from confirmation card.
   - Read total order amount (`Total Biaya`).

### Stage 6: Payment Method Selection & Dedicated VA Extraction
1. **Navigate to Payment**:
   - Click payment progression button in the UI (`page.getByRole("button", { name: /proses pembayaran/i })`).
2. **Select Payment Channel**:
   - Select available payment channel: **Pospay** (`page.locator("div, label").filter({ hasText: /pospay/i })`).
   - Click `Simpan Metode Pembayaran` to advance to the dedicated payment instructions screen.
3. **Dedicated Virtual Account (VA) Number Extraction**:
   - Extract the actual generated **Virtual Account (VA) number** displayed on the payment instructions screen.
   - **CRITICAL RULE**: The VA is a distinct payment identifier.
     - **NEVER** use the Order ID (`ORCA...`), Shipment ID (`SOCB...`), or internal transaction identifier as the VA number.
     - Validate that the VA is extracted exclusively from the dedicated payment instructions / VA section.
   - Extract the exact required payment amount from the payment instructions.
   - Capture a screenshot of the payment page with the visible VA number.

### Stage 7: Sandbox Payment Execution & OMS Verification
1. **Open Payment Sandbox**:
   - Open `https://pospay-sandbox.vercel.app` in the browser.
2. **Configure Sandbox**:
   - Set the Endpoint input to the configured staging API URL (e.g. `https://sr-pos-oms-api.nisims.web.id/api/v1`) via the sandbox UI.
3. **Execute Payment**:
   - Enter the extracted dedicated VA number into the `VA Number` input field.
   - Enter the exact required amount into the `Value` input field.
   - Click `Pay Now` through the sandbox UI.
   - Capture screenshot and verify the response message/banner (`Success` or error status).
4. **Verify in OMS**:
   - Return to the OMS application tab/page.
   - Refresh or navigate to the order / transaction status view.
   - Verify that the order payment status reflects the completed payment.
   - Capture screenshot of the updated status.

### Stage 8: Error Handling & Form Failure Recovery
- **No Service Catalog Found**: Halt immediately, do not proceed to inquiry or alternative flows, report exact route and specification to user for revision.
- **Validation Errors**: If the UI flags invalid fields (e.g. invalid location or weight limit exceeded), inspect the validation message text and report it explicitly to the user.
- **Submission Timeouts**: If the submit button displays a loading spinner that times out, inspect the current page state; do not blindly double-click submit to prevent duplicate orders.
- **No API Fallback**: When errors occur in the UI, report the error state from the DOM without attempting background API calls.
