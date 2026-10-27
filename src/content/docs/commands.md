---
title: Commands & Teardown
description: CLI command reference, preflight checks, structured run logs, and teardown options for Tarmac CLI.
---

## Global Options

Global flags are placed **before** the subcommand:

```bash
tarmac [--profile/-p PROFILE] [--verbose/-v] [--debug/-d] [--log-file PATH] <command>
```

| Flag | Description |
| :--- | :--- |
| `--profile`, `-p` | AWS CLI profile name (sets `AWS_PROFILE` for the run). |
| `--verbose`, `-v` | Print every recorded action (`INFO`) to the terminal as it happens. |
| `--debug`, `-d` | Enable debug logging and full tracebacks. |
| `--log-file PATH` | Append a JSON-lines record of actions, outcomes, and errors to `PATH` (or set `TARMAC_LOG_FILE`). |
| `--version`, `-V` | Show the installed `tarmac-cli` version and exit. |

---

## Commands

| Command | Description |
| :--- | :--- |
| `tarmac init` | Write starter `organization.yaml`, `accounts.yaml`, and `identity.yaml` files. |
| `tarmac validate` | Validate YAML schemas, cross-file references, and SCP files offline. |
| `tarmac bootstrap` | Run once as root: create your Identity Center login, management permission sets, and `tarmac` CLI profile. |
| `tarmac preflight` | Check that the management account is ready for deployment. |
| `tarmac plan` | Show what `deploy` would change using read-only AWS calls (alias for `deploy --dry-run`). |
| `tarmac deploy` | Apply the configuration across all 6 phases (or a single phase with `--phase N`). |
| `tarmac status` | Compare live AWS state against your config (`--detail` lists every difference). |
| `tarmac import` | Generate config files from an existing AWS Organization (read-only). |
| `tarmac destroy` | Tear down resources deployed by Tarmac. |
| `tarmac info` | Show current AWS caller identity, Organization status, and Identity Center details. |
| `tarmac account list` | List member accounts in the organization with their status and OU. |
| `tarmac account suspend NAME` | Move an account to the `Suspended` OU (`--close` also closes it). |
| `tarmac logs FILE` | Summarize runs recorded with `--log-file` and inspect individual actions. |
| `tarmac inventory` | Show what Tarmac has recorded creating in the management account inventory bucket. |

---

## Command Details

### `tarmac init`

```bash
tarmac init [--config-dir/-c PATH] [--force/-f] [--with-templates]
```

- `--config-dir`, `-c`: Directory to write configuration files to (default: `config`).
- `--force`, `-f`: Overwrite existing configuration files.
- `--with-templates`: Copy Tarmac's bundled CloudFormation templates and SCP JSON files into your project so you can customize and version them.

### `tarmac validate`

```bash
tarmac validate [--config-dir/-c PATH] [--json]
```

Validates YAML syntax, strict Pydantic schemas (rejecting unknown keys), cross-references across all three files, and warns if sample placeholder values from `tarmac init` are still present.

### `tarmac bootstrap`

```bash
tarmac bootstrap [--config-dir/-c PATH] [--github-repo OWNER/REPO] [--github-branch main]
```

- Creates `admin_user` from `identity.yaml` (or looks up the existing user when `identity_source: "external"`) and grants `TarmacDeployment` (least-privilege policy) and `ManagementAdministrator` (`AdministratorAccess`) on the management account.
- Appends `[sso-session tarmac]` and `[profile tarmac]` to `~/.aws/config`.
- `--github-repo`: Provisions the GitHub OIDC provider and `TarmacGitHubDeployment` IAM role trusted by workflow runs on `--github-branch` (use `OWNER@ID/REPO@ID` for repositories created, renamed, or transferred after 15 July 2026).
- Re-running `tarmac bootstrap` after upgrading `tarmac-cli` updates the `TarmacDeployment` and `TarmacGitHubDeployment` policies in place.

### `tarmac preflight`

```bash
tarmac preflight [--config-dir/-c PATH] [--region/-r REGION] [--strict] [--json]
```

Audits the management account before deployment:
- Verifies non-root caller identity, Root MFA, absence of local IAM users, and whether the `TarmacDeployment` permission set policy matches the current release.
- Checks AWS Organizations (`ALL` feature set), alternate contacts, IAM Identity Center status, Cost Explorer, and active cost allocation tags.
- Checks account creation and SCP quotas, sample placeholder values from `tarmac init`, conflicting organization trails, existing Tarmac stacks deployed under a different `organization.name`, and pending SNS alert subscriptions.
- `--strict`: Exit with code `1` on warnings as well as failures.

### `tarmac plan` & `tarmac deploy`

```bash
tarmac plan [--phase 1..6] [--account/-a NAME] [--config-dir/-c PATH] [--region/-r REGION] [--tag/-t Key=Value] [--json]

tarmac deploy \
  [--phase 1..6] \
  [--account/-a NAME] \
  [--config-dir/-c PATH] \
  [--region/-r REGION] \
  [--dry-run] \
  [--yes/-y] \
  [--skip-preflight] \
  [--adopt-existing] \
  [--tag/-t Key=Value] \
  [--json]
```

- `tarmac plan` is identical to `tarmac deploy --dry-run`: it inspects live AWS resources read-only and prints every addition, change, and removal (removals are listed first).
- `--phase 1..6`: Run or plan a single phase (`1` organization, `2` organizational-units, `3` cloudtrail, `4` accounts, `5` hardening, `6` identity).
- `--account`, `-a NAME`: With `--phase 4`, provision, tag, and baseline only the specified account (repeatable). Useful when onboarding a single new account without running the full pipeline:
  ```bash
  tarmac plan --phase 4 --account payments-prod
  tarmac deploy --phase 4 --account payments-prod
  ```
- `--adopt-existing`: Take over existing SCPs and budgets with the same name that Tarmac did not create (by default, Tarmac stops rather than overwriting them).
- `--tag`, `-t Key=Value`: Apply additional tags to resources deployed in this run (repeatable).

### `tarmac status`

```bash
tarmac status [--config-dir/-c PATH] [--region/-r REGION] [--detail] [--strict] [--json]
```

- `--detail`: Inspect every declared component for drift and list live OUs and cost anomaly monitors.
- `--strict`: Exit with code `1` if any drift is detected (implies `--detail`).

### `tarmac import`

```bash
tarmac import [--config-dir/-c PATH] [--region/-r REGION] [--name ORG_NAME] [--no-identity]
```

Reads a live AWS Organization without changing anything in AWS, writes matching YAML files to `--config-dir` (saving overwritten files as `<name>.bak`), and exports any existing `baseline_stacks` templates to `baseline/`.

### `tarmac account`

```bash
tarmac account list [--config-dir/-c PATH] [--region/-r REGION] [--active] [--suspended] [--json]
tarmac account suspend <NAME_OR_ID> [--config-dir/-c PATH] [--region/-r REGION] [--close] [--dry-run] [--yes/-y]
```

- `tarmac account suspend NAME`: Moves the account into the `Suspended` OU and tags it as quarantined.
- `--close`: Also calls AWS Organizations `close_account` (permanent after 90 days). Note that AWS permanently reserves a closed account's root email address, so a closed account's email can never be reused for a new account.

---

## Teardown (`tarmac destroy`)

```bash
tarmac destroy \
  [--phase 2..6] \
  [--config-dir/-c PATH] \
  [--region/-r REGION] \
  [--dry-run] \
  [--yes/-y] \
  [--force] \
  [--preserve-backend] \
  [--disable-security-services] \
  [--everything] \
  [--inventory-from-log PATH] \
  [--json]
```

`tarmac destroy` removes the CloudFormation stacks, S3 buckets, budgets, SCPs, organization trail, and permission sets that Tarmac deployed, so `tarmac deploy` can rebuild them cleanly.

- **Production lock**: Refuses to tear down an organization tagged as production (`Environment: Production`, `prod`, or `prd`) unless `--force` is passed.
- **What default `destroy` keeps**: The AWS Organization, OUs, member accounts, GuardDuty/Security Hub/Config delegation, IAM Identity Center users and groups, trusted service access, and cost allocation tags.
- `--preserve-backend`: Keep the Terraform state bucket and lock table in the `deployment` account.
- `--disable-security-services`: Also turn off the GuardDuty, Security Hub, and AWS Config setup Tarmac created (permanently deletes their finding history).
- `--everything`: Full reset using the management account inventory bucket (or `--inventory-from-log PATH`). Also removes empty OUs, Identity Center users and groups, and organization settings that Tarmac created, plus the `tarmac bootstrap` permission sets (except the one you are currently signed in with), and finally the inventory bucket itself.
- **Why member accounts are never closed by `destroy`**: AWS permanently locks a closed account's root email address and enforces strict rate limits on account closures. Even with `--everything`, member accounts are kept so they can be reused on a later `tarmac deploy` (use `tarmac account suspend NAME --close` to close an individual account explicitly).

---

## Run Logs (`tarmac logs`)

Pass `--log-file run.jsonl` (or set `TARMAC_LOG_FILE`) before any command to record structured JSONL audit events, then query them with `tarmac logs`:

```bash
tarmac -v --log-file run.jsonl deploy
tarmac logs run.jsonl                         # list all recorded runs in the file
tarmac logs run.jsonl --run latest            # inspect what the latest run changed
tarmac logs run.jsonl --outcome failed        # filter to failed actions only
```
