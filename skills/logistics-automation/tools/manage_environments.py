#!/usr/bin/env python3
"""
CLI helper for guided onboarding of staging environments in Logistics Automation (UI-Only).
Provides interactive prompts or non-interactive argument parsing to add/update
environments in `config/environments.json` without requiring direct JSON editing.
"""

import argparse
import json
import os
import sys

CONFIG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config")
CONFIG_PATH = os.path.join(CONFIG_DIR, "environments.json")
TEMPLATE_PATH = os.path.join(CONFIG_DIR, "environments.template.json")


def load_config():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    if os.path.exists(TEMPLATE_PATH):
        with open(TEMPLATE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return {"$schema": data.get("$schema", ""), "environments": {}}
    return {"$schema": "http://json-schema.org/draft-07/schema#", "environments": {}}


def save_config(config_data):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config_data, f, indent=2)
    print(f"[OK] Configuration updated successfully: {CONFIG_PATH}")


def add_environment(
    env_name,
    app_url,
    account_id,
    login_method,
    login_url,
    credential_var_prefix,
    supported_workflows,
    description="",
):
    config = load_config()
    envs = config.setdefault("environments", {})

    if login_method in ("standard-ui-form", "sso-ui-redirect"):
        cred_ref = {
            "type": "env",
            "usernameVar": f"{credential_var_prefix}_USERNAME",
            "passwordVar": f"{credential_var_prefix}_PASSWORD",
        }
    else:
        cred_ref = {
            "type": "env",
            "customVar": credential_var_prefix,
        }

    workflows = [w.strip() for w in supported_workflows.split(",") if w.strip()]
    if not workflows:
        workflows = ["order-creation", "service-catalog-creation"]

    env_entry = {
        "name": env_name,
        "description": description or f"Staging web environment for {env_name}",
        "applicationUrl": app_url,
        "defaultAccount": account_id,
        "accounts": {
            account_id: {
                "accountId": account_id,
                "displayName": f"Account {account_id}",
                "loginMethod": login_method,
                "loginUrl": login_url or "/login",
                "credentialRef": cred_ref,
                "roles": ["order_creator", "catalog_manager"],
            }
        },
        "supportedWorkflows": workflows,
        "environmentSpecificConfig": {
            "browser": {
                "headless": True,
                "slowMo": 0,
                "viewport": {"width": 1280, "height": 800},
                "navigationTimeoutMs": 30000,
                "actionTimeoutMs": 10000,
            },
            "sessionPersistence": {
                "enabled": True,
                "storageStateDir": ".sessions",
            },
            "flags": {
                "strictRouteValidation": True,
            },
        },
    }

    envs[env_name] = env_entry
    save_config(config)
    print(f"\n[Environment Onboarded (UI-Only)]:")
    print(f" - Environment Name: {env_name}")
    print(f" - Application URL: {app_url}")
    print(f" - Account: {account_id}")
    print(f" - Login Method: {login_method} ({login_url or '/login'})")
    print(f" - Credential Var(s): {cred_ref}")
    print(f" - Supported Workflows: {', '.join(workflows)}")


def interactive_wizard():
    print("=== Logistics Automation: Environment Onboarding Wizard (UI-Only) ===")
    print("Note: All automation runs via Playwright in the browser. Do not provide actual secrets here.\n")

    env_name = input("1. Environment Name (e.g., staging-posind-core): ").strip()
    if not env_name:
        print("[Error] Environment name cannot be empty.")
        sys.exit(1)

    app_url = input("2. Application Web URL (e.g., https://staging-app.example.internal): ").strip()
    if not app_url:
        print("[Error] Application URL cannot be empty.")
        sys.exit(1)

    account_id = input("3. Application Account Identifier (e.g., ops-admin): ").strip() or "default-account"

    print("\nSelect UI Login Method:")
    print("  [1] standard-ui-form (Standard Username & Password Form)")
    print("  [2] sso-ui-redirect (Single Sign-On web redirect flow)")
    print("  [3] manual-interactive-login (Headed browser session for MFA/manual authentication)")
    method_choice = input("Choice [1-3] (default: 1): ").strip() or "1"
    method_map = {
        "1": "standard-ui-form",
        "2": "sso-ui-redirect",
        "3": "manual-interactive-login",
    }
    login_method = method_map.get(method_choice, "standard-ui-form")

    login_url = input("4. Login Path / Relative URL (default: /login): ").strip() or "/login"

    cred_prefix = input(f"5. Credential Env Var Prefix (e.g., POSIND_{env_name.upper().replace('-', '_')}): ").strip()
    if not cred_prefix:
        cred_prefix = f"POSIND_{env_name.upper().replace('-', '_')}"

    print("\nSupported Workflows (comma-separated):")
    print("  Options: order-creation, service-catalog-creation")
    workflows = input("Workflows (default: order-creation,service-catalog-creation): ").strip() or "order-creation,service-catalog-creation"

    desc = input("6. Optional description: ").strip()

    add_environment(
        env_name=env_name,
        app_url=app_url,
        account_id=account_id,
        login_method=login_method,
        login_url=login_url,
        credential_var_prefix=cred_prefix,
        supported_workflows=workflows,
        description=desc,
    )


def main():
    parser = argparse.ArgumentParser(description="Manage Logistics Automation environments (UI-Only with Playwright)")
    parser.add_argument("--interactive", action="store_true", help="Launch interactive onboarding wizard")
    parser.add_argument("--add", action="store_true", help="Add or update an environment via flags")
    parser.add_argument("--env-name", help="Name of the environment")
    parser.add_argument("--app-url", help="Web application URL")
    parser.add_argument("--account-id", help="Account or user identifier")
    parser.add_argument(
        "--login-method",
        choices=["standard-ui-form", "sso-ui-redirect", "manual-interactive-login"],
        default="standard-ui-form",
        help="UI Login method",
    )
    parser.add_argument("--login-url", default="/login", help="Relative login URL or path")
    parser.add_argument("--cred-var", help="Environment variable prefix for username/password")
    parser.add_argument(
        "--workflows",
        default="order-creation,service-catalog-creation",
        help="Comma-separated supported workflows",
    )
    parser.add_argument("--description", default="", help="Description")
    parser.add_argument("--list", action="store_true", help="List registered environments")

    args = parser.parse_args()

    if args.list:
        config = load_config()
        envs = config.get("environments", {})
        if not envs:
            print("No environments registered yet in config/environments.json.")
        else:
            print(f"Registered UI environments ({len(envs)}):")
            for k, v in envs.items():
                print(f" - {k}: App={v.get('applicationUrl')} | Workflows={v.get('supportedWorkflows')}")
        return

    if args.interactive:
        interactive_wizard()
        return

    if args.add:
        if not (args.env_name and args.app_url and args.account_id and args.cred_var):
            print("[Error] Missing required arguments for --add. Required: --env-name, --app-url, --account-id, --cred-var")
            sys.exit(1)
        add_environment(
            env_name=args.env_name,
            app_url=args.app_url,
            account_id=args.account_id,
            login_method=args.login_method,
            login_url=args.login_url,
            credential_var_prefix=args.cred_var,
            supported_workflows=args.workflows,
            description=args.description,
        )
        return

    parser.print_help()


if __name__ == "__main__":
    main()
