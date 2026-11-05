# POSIND Logistics Automation (UI-Only with Playwright)

Reusable Logistics Automation skill and workflow engine for PandaCode, enabling natural-language creation of orders, batch orders, and service catalogs across staging environments **exclusively via web browser automation using Playwright**.

**No API endpoints or API-based requests are used for any part of these workflows.**

---

## Architecture Overview

```text
POSIND Automation
├── README.md
└── skills/
    ├── system/
    │   └── run-workflow/                   # Workflow orchestration skill
    └── logistics-automation/
        ├── SKILL.md                        # Skill definition & intent dispatcher
        ├── config/
        │   └── environments.template.json  # Environment registry template (UI-only)
        ├── docs/
        │   └── auth-and-credentials.md    # UI auth & browser session rules
        ├── tools/
        │   └── manage_environments.py      # Guided environment onboarding CLI
        └── workflows/
            ├── order-creation.md          # UI Order creation specification
            └── service-catalog-creation.md # UI Service catalog specification
```

---

## Getting Started

### 1. Configure Environments
Onboard environments interactively or via CLI without editing raw JSON:
```bash
python3 skills/logistics-automation/tools/manage_environments.py --interactive
```
Or register an environment via CLI flags:
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
Or manually copy and edit the template configuration file if preferred:
```bash
cp skills/logistics-automation/config/environments.template.json skills/logistics-automation/config/environments.json
```

> [!IMPORTANT]
> Never put passwords, usernames, or session tokens into `environments.json`. Only reference the local environment variable names where secrets will be stored.

### 2. Set Up UI Credentials
Export the referenced username and password environment variables locally:
```bash
export POSIND_STAGING_USERNAME="your-username"
export POSIND_STAGING_PASSWORD="your-password"
```

### 3. Inspecting the Web Application
Inspect any configured environment or URL without submitting forms:
```bash
# Inspect a registered staging environment:
node skills/logistics-automation/tools/inspect_ui.js --env "staging-posind-core"

# Inspect with manual interactive login in a visible browser:
node skills/logistics-automation/tools/inspect_ui.js --env "staging-posind-core" --manual-login

# Inspect an arbitrary URL:
node skills/logistics-automation/tools/inspect_ui.js --url "https://staging-app.example.internal"
```
Inspection results, element inventories (buttons, inputs, selects), and full-page screenshots are saved to `.artifacts/inspection/`.

### 4. Running Browser Smoke Tests
Verify Playwright, Chromium, and session persistence anytime:
```bash
npm run smoke-test
```

### 5. Usage Examples
Once configured, PandaCode dispatches requests to the Logistics Automation skill:

- **Create a Single Order via UI**:
  > *"Create an order from Benda to Turikale on November 19 in staging-posind-core."*
- **Create Batch Orders via UI**:
  > *"Create 5 orders using these routes and schedules in staging-posind-core."*
- **Create Service Catalog via UI**:
  > *"Create a service catalog from Tanjung Priok to Makassar in staging-posind-core."*

---

## Environment Safety & UI Execution Rules

1. **Strictly UI-Only Execution**: All operations must execute through browser interactions (form filling, selecting dropdowns, clicking buttons, inspecting confirmation cards and tables). No API fallback.
2. **No Silent Environment Switching**: All requests must map explicitly to a registered environment.
3. **Ambiguity Prevention**: If an environment or account is omitted or ambiguous, PandaCode stops and asks you to select the target environment before opening a browser session.
4. **UI Verification**: Every workflow verifies that the entity was created on screen and extracts the created ID, tracking or route code, and status directly from DOM elements.
