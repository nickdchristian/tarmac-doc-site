---
title: Tarmac CLI
description: Python CLI for setting up and maintaining a multi-account AWS Organization from YAML.
---

**Tarmac** (`tarmac-cli`) sets up and maintains a multi-account AWS Organization from three YAML files: [`organization.yaml`](/configuration#organizationyaml), [`accounts.yaml`](/configuration#accountsyaml), and [`identity.yaml`](/configuration#identityyaml).

Edit the YAML, preview changes with `tarmac plan`, and apply them with `tarmac deploy`. Every run is idempotent and safe to repeat.

## Install

Requires Python 3.11 or later (tested on 3.11 through 3.15):

```bash
uv tool install tarmac-cli   # or: pip install tarmac-cli
tarmac --help
```

---

## Architecture

Tarmac provisions the organization-level foundation that has to exist before workload Terraform can run:

- **AWS APIs + CloudFormation**: Tarmac calls AWS Organizations and IAM Identity Center APIs directly for account creation, OU structure, service delegation, and SSO assignments. For stateful resources (log buckets, CloudTrail, KMS keys, SCPs, budgets, and the Terraform backend), it deploys CloudFormation stacks with termination protection enabled on critical stacks.
- **Non-Root Execution**: The AWS root user cannot call `sts:AssumeRole` into member accounts. Tarmac runs under a least-privilege IAM Identity Center permission set (`TarmacDeployment` locally, or `TarmacGitHubDeployment` via GitHub OIDC) and assumes `OrganizationAccountAccessRole` into each member account.
- **Terraform State Backend**: Phase 5 deploys a versioned, locked S3 state bucket in the `deployment` account so workload infrastructure can be managed with standard Terraform configurations from that point forward.

### Account Layout

Following AWS multi-account guidance, the management account holds only what must live there:

- **Management account**: AWS Organizations, SCPs, IAM Identity Center, the CloudTrail stack, the AWS Config StackSet, root activity alerts, and the inventory bucket.
- **`audit` account**: Delegated administrator for CloudTrail, AWS Config, GuardDuty, Security Hub, and IAM root access management.
- **`log-archive` account**: Centralized S3 buckets for CloudTrail logs, AWS Config history, and exported GuardDuty findings.
- **`deployment` account**: S3 state bucket (and optional DynamoDB lock table) for Terraform.

### The 6 Deployment Phases

`tarmac deploy` runs six phases in order. Pass `--phase N` to run a single phase, or `--phase 4 --account NAME` to provision and baseline one account:

| Phase | Name | Scope |
| :--- | :--- | :--- |
| **1** | `organization` | Inventory bucket, organization settings, alternate contacts, trusted services, root access management, cost allocation tags, and management account default VPC cleanup. |
| **2** | `organizational-units` | Organizational units (`Security`, `Infrastructure`, `Workloads`, `Deployments`, `Sandbox`, `Policy Staging`, `Suspended`) and service control policies (SCPs). |
| **3** | `cloudtrail` | Log archive S3 buckets in the `log-archive` account (provisioning the account first if needed) and the organization CloudTrail trail. |
| **4** | `accounts` | Member accounts, tags, alternate contacts, budgets, cost anomaly monitors, default VPC cleanup, and custom CloudFormation StackSets (`baseline_stacks`). |
| **5** | `hardening` | Terraform state backend (`deployment` account), `audit` account delegated administration, AWS Config recorders, GuardDuty, Security Hub, and the management account root activity alert. |
| **6** | `identity` | IAM Identity Center permission sets, users, groups, and account assignments. |

### Stacks & Local Outputs

CloudFormation stacks and StackSets deployed by Tarmac:

| Stack / StackSet Name | Phase | Account | Purpose |
| :--- | :--- | :--- | :--- |
| `<org>-tarmac-inventory` | 1 | Management | S3 bucket tracking OUs, users, groups, and settings created by Tarmac. |
| `<org>-organization-scps` | 2 | Management | Service Control Policies and OU/root attachments. |
| `<org>-log-archive-hardening` | 3 | `log-archive` | Central S3 buckets (CloudTrail, AWS Config, GuardDuty exports, S3 access logs) and optional KMS key. |
| `<org>-organization-cloudtrail` | 3 | Management | Organization-wide CloudTrail trail delivering to `log-archive`. |
| `<account>-monthly-budget` | 4 | Member accounts | Monthly AWS Budget and `<account>-budget-alerts` SNS topic (per account with `baseline.budget`). |
| `<org>-baseline-<name>` | 4 | Management (StackSet) | Custom CloudFormation templates deployed across target OUs (`baseline_stacks`). |
| `<org>-terraform-backend` | 5 | `deployment` | Versioned S3 bucket (and optional DynamoDB lock table) for Terraform state. |
| `<org>-audit-account-hardening` | 5 | `audit` | AWS Config Organization Aggregator, `AuditKmsKey`, `<org>-security-alerts` SNS topic, and EventBridge finding rules. |
| `<org>-config-recorder` | 5 | Management (StackSet + stack) | Optional AWS Config recorders across member accounts (StackSet) and the management account. |
| `<org>-management-root-alert` | 5 | Management (`us-east-1` & `primary_region`) | EventBridge rule and SNS topic alerting on management account root activity. |
| `<org>-sso-permission-sets` | 6 | Management | IAM Identity Center permission sets and policy attachments. |

During **Phase 4**, Tarmac also writes the resolved account catalog locally to `./outputs/`:
- `outputs/accounts.json`: Account inventory (account name, 12-digit `account_id`, email, OU name/ID, status, and tags).
- `outputs/accounts.env`: Shell environment variables (e.g., `export PROD_APP_ACCOUNT_ID="123456789012"`) for scripts or CI pipelines.

---

## Costs

Options that carry recurring AWS charges are off until you enable them in `organization.yaml`. Out of the box, fixed costs are ~$1/month for the audit account KMS key plus S3 storage for CloudTrail logs:

| Component | Default State | AWS Cost |
| :--- | :--- | :--- |
| **AWS Organizations, OUs & SCPs** | Enabled | **$0** |
| **IAM Identity Center** | Enabled | **$0** |
| **Organization CloudTrail (1st management trail)** | Enabled (SSE-S3) | **$0** for the trail; S3 storage (~$0.023/GB-month) |
| **Terraform State Backend (S3 native locking)** | Enabled | S3 storage + requests (no DynamoDB table by default) |
| **Management Root Activity Alert** | Enabled | **$0** (EventBridge management events are free; SNS free tier covers 1,000 emails/mo) |
| **AWS Budgets & Cost Anomaly Monitors** | Configured per account | **$0** (notification-only AWS Budgets and Cost Anomaly Detection monitors are free) |
| **Audit Account KMS Key (`<org>-audit-account-hardening`)** | Enabled when `audit` account exists | **$1.00/month** for the customer-managed KMS key encrypting `<org>-security-alerts` |
| **Log Archive KMS Key (`cloudtrail.enable_kms` or `guardduty.export_findings`)** | Off by default | **$1.00/month** for the customer-managed KMS key + API request charges |
| **AWS Config (`config_recorder.enabled: true`)** | Off by default | **$0.003** per configuration item recorded (`CONTINUOUS`) |
| **GuardDuty (`guardduty.enabled: true`)** | Off by default | 30-day free trial per account, then usage-based (CloudTrail event & VPC flow log volume) |
| **Security Hub (`securityhub.enabled: true`)** | Off by default | 30-day free trial, then **$0.0010** per security check (requires AWS Config) |

---

## Reconciliation & Inventory

AWS Organizations settings, Identity Center memberships, and regional security service configurations do not support AWS resource tags. Instead of relying on a local state file, Phase 1 deploys the `<org>-tarmac-inventory` stack in the management account, which stores a shared S3 record of the OUs, users, groups, and settings Tarmac created.

Because Tarmac tracks what it created versus what already existed, turning a setting off or removing an item from YAML only removes resources Tarmac owns (`tarmac plan` always lists removals first):

- **Removed or disabled resources**: Turning off or removing SCPs, AWS Config recorders, the root activity alert, account budgets, cost anomaly monitors, `baseline_stacks` StackSets, root access management features, or cost allocation tags causes the next `tarmac deploy` to remove or revert them. Log buckets and their existing history are kept.
- **Member accounts**: Accounts removed from `accounts.yaml` that Tarmac previously created are moved to the `Suspended` OU (unless `quarantine_removed_accounts: false`). Unmanaged accounts are left alone.
- **Security services**:
  - Turning off `guardduty` suspends it in member accounts (monitoring and charges stop, existing findings are kept, and re-enabling resumes it).
  - Turning off `securityhub` disables it (AWS deletes findings after 90 days; `tarmac plan` and `deploy` warn before doing so).
  - Dropping a Region from `additional_regions` suspends GuardDuty and removes AWS Config recorders in that Region. Security Hub stays enabled in that Region because AWS central configuration does not allow disabling a single Region's hub. Tarmac only turns off services it recorded setting up, Region by Region.
- **Identity Center**:
  - Groups and permission sets created by Tarmac are deleted when removed from `identity.yaml` (except the bootstrap `TarmacDeployment` and `ManagementAdministrator` permission sets).
  - Groups created by Tarmac (or adopted via `tarmac import`) have undeclared members and account assignments revoked on declared accounts. Pre-existing groups that haven't been imported only receive additions.
  - With an external identity provider (`identity_source: "external"`), Tarmac manages only permission sets and declared group account assignments, never creating users or groups or changing group memberships. If SCIM-provisioned principals are present in Identity Center without `identity_source: "external"`, Tarmac halts `plan` and `deploy` rather than creating conflicting local users or groups.
  - Users are never deleted when removed from `identity.yaml`.
