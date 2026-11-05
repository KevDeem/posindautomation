# Authentication and Credential Management

## Core Principles

1. **Zero Secret Hardcoding**: Passwords, API keys, tokens, client secrets, and session cookies must never be committed to source code or stored in documentation.
2. **Strict Environment and Account Boundaries**: Every operation must explicitly resolve to a validated environment and account. Silent switching between environments or accounts is prohibited.
3. **Explicit User Clarification**: If a user request does not unambiguously designate an environment or account, the automation must pause and prompt the user for clarification before executing any network requests.

---

## Credential Reference Architecture

Credentials are referenced indirectly via variable names defined in `config/environments.json` (or environment-specific configs):

| Authentication Method | Required Credential References | Execution Handler |
| :--- | :--- | :--- |
| `bearer-token` | `tokenVar` (e.g., `POSIND_STAGING_TOKEN`) | Injected as `Authorization: Bearer <token>` in API calls |
| `oauth2-client-credentials` | `clientIdVar`, `clientSecretVar` | Exchanged via OAuth token endpoint, cached in memory |
| `browser-session` | `usernameVar`, `passwordVar` | Automated login flow via Playwright session manager |
| `api-key` | `apiKeyVar`, optional `headerName` | Injected into designated HTTP request header |

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
    ├── Validate applicationUrl and apiUrl format
    ├── Verify target workflow is in `supportedWorkflows`
    └── Verify target account exists under `accounts`
             │
             ▼
Resolve Credentials from Local Runtime Environment
    ├── Check process environment variables for mapped names
    ├── Missing variable? ──► Fail early with clear configuration error
    └── Available?        ──► Bind credentials to ephemeral workflow context
```

---

## Safe Execution Guardrails

1. **Pre-flight Environment Validation**:
   - Verify that the target host matches the designated environment base URL.
   - Forbid localhost fallback unless explicitly defined as a local mock target.

2. **Session and Token Lifecycle**:
   - In-memory lifecycle only. No persistent unencrypted token storage on disk.
   - On HTTP 401/403 or session invalidation, reject immediately without retrying on other accounts or environments.

3. **Confirmation and Logging**:
   - Audit logs output the target environment name, application URL, and account identifier.
   - Secret values must be sanitized and replaced with `***REDACTED***` in all debug and trace outputs.
