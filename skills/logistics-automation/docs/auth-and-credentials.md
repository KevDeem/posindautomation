# Authentication and Credential Management (UI-Only with Playwright)

## Core Principles

1. **Zero Secret Hardcoding**: Passwords, usernames, tokens, and browser session artifacts must never be committed to source code or stored in documentation.
2. **UI-Exclusive Authentication**: All authentication occurs directly in the web browser through Playwright (e.g. entering credentials into login forms, submitting, and waiting for authenticated state). No direct API token or HTTP request headers are used.
3. **Strict Environment and Account Boundaries**: Every session must explicitly resolve to a validated environment and account. Silent switching between environments or accounts is prohibited.
4. **Explicit User Clarification**: If a user request does not unambiguously designate an environment or account, the automation must pause and prompt the user for clarification before launching browser sessions.

---

## Credential Reference Architecture

Credentials are referenced indirectly via variable names defined in `config/environments.json`:

| Login Method | Required Credential References | UI Authentication Handler |
| :--- | :--- | :--- |
| `standard-ui-form` | `usernameVar`, `passwordVar` | Playwright fills username/password inputs, clicks submit, and awaits navigation |
| `sso-ui-redirect` | `usernameVar`, `passwordVar` | Playwright handles SSO redirect, enters credentials on IdP form, and waits for return callback |
| `manual-interactive-login` | (None / User-driven) | Playwright opens browser headed, user completes login/MFA, session state saved |

---

## Browser Session Persistence

To minimize redundant UI logins while preserving security:
1. **Playwright `storageState`**:
   - Authenticated browser context storage (cookies, local storage) can be saved to an untracked local directory (e.g. `.sessions/<env>_<account>.json`).
   - `.sessions/` is strictly added to `.gitignore` and never committed.
2. **Session Validity Check**:
   - Before launching a workflow, Playwright loads the saved `storageState`.
   - Navigates to a lightweight authenticated page (e.g. dashboard).
   - If redirected to `/login` or session expired indicator appears, Playwright invalidates the cached session and executes the UI login flow.
   - If UI login fails, the process stops with an explicit failure report; never retries across other environments.

---

## Environment Resolution Flow

```text
User Request
    │
    ▼
Check explicit env tag / parameter
    ├── Found & matches registry? ──► Verify requested account
    └── Missing or ambiguous?     ──► Prompt user to select environment
                                             │
    ┌────────────────────────────────────────┘
    ▼
Load Environment Config
    ├── Validate applicationUrl format
    ├── Verify target workflow is in `supportedWorkflows`
    └── Verify target account exists under `accounts`
             │
             ▼
Resolve UI Credentials from Runtime Environment
    ├── Check process environment variables for mapped names
    ├── Missing variable? ──► Fail early with configuration error
    └── Available?        ──► Bind credentials to Playwright browser context
```

---

## Safe Execution Guardrails

1. **Pre-flight URL Validation**:
   - Verify that all browser navigations match the designated environment `applicationUrl`.
   - Never navigate to external or third-party URLs unless explicitly configured for SSO.
2. **DOM Locator Integrity**:
   - Prefer semantic and accessible locators (`page.getByRole()`, `page.getByLabel()`, `page.getByPlaceholder()`).
   - Avoid brittle absolute XPath or nth-child selectors.
3. **Sanitized Logs**:
   - Passwords and secret values entered into UI forms must never be logged in test traces, stdout, or markdown artifacts.
