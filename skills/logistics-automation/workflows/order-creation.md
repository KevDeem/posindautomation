# Order Creation Workflow Specification (UI-Only with Playwright)

## Overview

Automates order creation exclusively through the application's web interface using Playwright. Accepts natural language requests, validates mandatory parameters, authenticates via the browser login form or saved session, navigates application menus, populates inputs and select fields, submits the form, and verifies created orders through UI confirmation screens and tables.

**No direct API calls are used for transactional operations.** All order creation, confirmation, dedicated VA extraction, payment simulation, and status verification occur via Playwright browser interaction.

---

### Reusable Engine Architecture

Order creation is executed via consolidated general tools rather than individual transaction scripts:
- **Specification Engine**: `skills/logistics-automation/tools/order_specification.js`
- **General Order Executor**: `skills/logistics-automation/tools/order_executor.js` (`executeOrder(spec, options)`)
- **Generic Batch Executor**: `skills/logistics-automation/tools/batch_executor.js` (`executeBatch(batchInput, options)`)
- **Decoupled Payment Engine**: `skills/logistics-automation/tools/payment_executor.js` (`executeOrderPayment(page, context, orderResult)`)

---

### Global Order Policy: Non-Contract Ordering Only (Temporary Global Policy)
- **Always Non-Contract**: Always select **Order Without Contract / Non-Contract** when creating an order.
- **No Contract Selection**: Do not attempt to select or search for a contract.
- **No Contract-Based Ordering**: Do not use Contract-based ordering for now, even if contracts are available.
- **Service Catalog Progression**: Continue directly with applicable Service Catalog selection after entering Non-Contract details.
- **Policy Scope**: Applies to all order creation workflows (Domestic and International) until explicitly changed.

---

### Granular Reuse & Overwrite Principles
1. **Explicit Precedence**: Explicitly provided values in user prompts always take precedence over remembered values.
2. **Location Independence**: Changing Pickup does not alter Drop-off; changing Drop-off does not alter Pickup.
3. **Child Field Reset**: Changing a parent city/location resets child fields (district/subdistrict/postalCode) to prevent incompatible preservation.
4. **Independent PICs**: Pickup PIC and Drop-off PIC can be updated, reused, or generated independently.
5. **No Transaction Reuse**: Transactional IDs (`ORCA...`, `SOCB...`, VA numbers) and amounts are never reused.
6. **No Blind Catalog Reuse**: Service Catalogs are re-evaluated dynamically through the UI.
7. **Immediate Stop Rule**: If no applicable Service Catalog exists, halt immediately without redirecting to Inquiry or Contract flows.

---

## Workflow Execution Stages (Playwright UI)

### Stage 1: Request Interpretation & Runtime Specification Resolution
1. Parse user prompt for explicitly specified order fields (route, cargo, schedule, PICs, quantity).
2. For single orders: invoke `resolveSpecification(inputSpec, options)`.
3. For batch orders: invoke `normalizeBatchInput(batchInput)`.
4. Tag explicitly supplied fields as `[Provided]`, baseline values as `[Reused]`, synthetic contacts as `[Generated Synthetic]`.

### Stage 2: Pre-Submission Specification Review
1. Render formatted specification review table highlighting field values and origins.
2. Display route, scheduled date/time, cargo summary, and batch quantities.
3. **MANDATORY**: Require explicit user confirmation before submitting transactions in OMS.

### Stage 3: Execution via General Order Engine
1. Launch Playwright browser instance (`headless: false` by default; `headless: true` when opt-in requested).
2. For single orders: call `executeOrder(spec, { headless })`.
3. For batch orders: call `executeBatch(batchInput, { headless, autoPay, maxRetries })`.
4. Execute full UI form filling:
   - Origin & Destination (Province, City, District, Subdistrict, PIC)
   - Calendar date picker & time
   - Cargo manifest & packaging linkage
   - Service Catalog selection based on actual UI cards
   - Final confirmation in OMS
5. Dynamically extract Order ID, Shipment ID, and Total Cost from DOM elements.

### Stage 4: Payment Method Selection & Dedicated VA Extraction
1. Advance to payment via UI button `Proses Pembayaran`.
2. Select payment channel `Pospay` and save payment method.
3. Extract dedicated **Virtual Account (VA)** number from payment instructions.
   - **CRITICAL RULE**: Never use Order ID or Shipment ID as the VA number.
   - Validate that VA is distinct from `ORCA...` and `SOCB...`.
4. Dynamically extract the exact payment amount from the payment page. Never hardcode costs.

### Stage 5: Sandbox Payment Simulation & OMS Status Verification
1. Open Payment Sandbox UI at `https://pospay-sandbox.vercel.app`.
2. Configure Endpoint (`https://sr-pos-oms-api.nisims.web.id/api/v1`).
3. Enter extracted VA number and dynamic amount.
4. Click `Pay Now` through the sandbox UI and verify response status (`SUCCESS`).
5. Navigate to OMS `/my/order` and verify order status reflects `Dibayar`.

### Stage 6: Batch Error Handling & Retries
- Sequential execution across batch items.
- Configurable `maxRetries` per transaction (default: 2 attempts, retries from start).
- Independent error isolation: failure of one order does not prevent remaining orders from executing.
- Summary report detailing succeeded vs failed orders with independent transaction identifiers.
