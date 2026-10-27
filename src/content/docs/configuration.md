---
title: Configuration
description: Schema and argument reference for organization.yaml, accounts.yaml, and identity.yaml.
---

Tarmac reads three YAML files from `config/` in the current directory (or the path passed via `--config-dir` / `TARMAC_CONFIG_DIR`).

## How Config Loading Works

- **Strict schema validation**: Every configuration block rejects unknown keys (`extra="forbid"`). A typo or a removed setting from an older release fails `tarmac validate` immediately rather than being silently ignored.
- **Cost-bearing features default to off**: Optional features that incur recurring AWS charges (CloudTrail KMS keys, GuardDuty, Security Hub, AWS Config recorders, DynamoDB lock tables) stay off until enabled.
- **Template & policy file resolution**: File paths (`policy_file`, `template_file`, `inline_policy_file`) resolve relative to your project root (the parent of `config/`) first, falling back to Tarmac's bundled files. Running `tarmac init --with-templates` copies the bundled CloudFormation templates and SCP JSON files into your project so you can review and version them.
- **Tag precedence**: Tags merge from lowest to highest priority:
  `System tags (ManagedBy: tarmac)` -> `organization.tags` -> `accounts[].tags` -> CLI `--tag Key=Value`.

---

## `organization.yaml`

Defines organization-wide settings, alternate contacts, root access management, OUs, SCPs, custom StackSet baselines, CloudTrail, security services, and the Terraform state backend.

### Example Usage

```yaml
organization:
  name: "myorg"
  domain: "example.com"
  primary_region: "us-east-2"
  additional_regions: []
  delete_default_vpc: true
  tags:
    Environment: "Production"
    CostCenter: "1040"
    Owner: "CloudPlatform"

contacts:
  billing:
    name: "Billing Team"
    title: "Billing Administrator"
    email: "billing@example.com"
    phone: "+1-555-000-0001"
  operations:
    name: "Operations Team"
    title: "Operations Lead"
    email: "ops@example.com"
    phone: "+1-555-000-0002"
  security:
    name: "Security Team"
    title: "Security Operations"
    email: "security@example.com"
    phone: "+1-555-000-0003"

root_access_management:
  enable_root_credentials_management: true
  enable_root_sessions: true
  delegate_to_audit: true

service_control_policies:
  policies:
    - name: "DenyMemberRootActivity"
      description: "Denies direct root access in member accounts except for authorized temporary root sessions"
      policy_file: "policies/scp/deny-member-root.json"
      targets: ["root"]
    - name: "DenyLeaveOrganization"
      description: "Prevents member accounts from leaving the AWS Organization"
      policy_file: "policies/scp/deny-leave-organization.json"
      targets: ["root"]

ou_structure:
  - name: "Security"
    description: "Security and compliance accounts"
  - name: "Infrastructure"
    description: "Shared infrastructure and networking accounts"
  - name: "Workloads"
    description: "Business workloads"
    children:
      - name: "Prod"
        description: "Production workloads"
      - name: "Test"
        description: "Development, test, and staging environments"
  - name: "Deployments"
    description: "CI/CD and infrastructure-as-code accounts"
  - name: "Sandbox"
    description: "Experimental workloads and developer playgrounds"
  - name: "Policy Staging"
    description: "Accounts for testing SCP changes before broader rollout"
  - name: "Suspended"
    description: "Quarantined or decommissioned accounts"

baseline_stacks:
  - name: "iam-password-policy"
    template_file: "templates/password-policy.yaml"
    target_ous: ["Workloads", "Sandbox"]
    regions: ["us-east-2"]
    parameters:
      MinimumLength: "14"

cloudtrail:
  trail_name: "myorg-organization-trail"
  log_archive_account: "log-archive"
  retention_days: 365
  object_lock:
    mode: "GOVERNANCE"
    retention_days: 365
  enable_kms: false

security_services:
  audit_account: "audit"
  root_alert:
    enabled: true
    all_regions: false
  guardduty:
    enabled: true
    export_findings: true
    features:
      s3_data_events: true
  securityhub:
    enabled: true
    standards:
      - "aws-foundational-security-best-practices"
  config_recorder:
    enabled: true
    recording_frequency: "CONTINUOUS"

terraform_backend:
  account: "deployment"
  dynamodb_table_name: "terraform-state-lock"
  enable_dynamodb: false

cost_allocation_tags:
  - "Environment"
  - "CostCenter"
  - "Owner"
```

### Argument Reference

#### `organization` (Required)

- `name` - (Required, `string`, `2..32` chars) Lowercase alphanumeric prefix (hyphens allowed) used to name CloudFormation stacks and S3 buckets. **Cannot be changed after the first deploy.**
- `domain` - (Required, `string`) Primary organization domain name.
- `primary_region` - (Required, `string`) Primary AWS Region where Tarmac stores its inventory and aggregates organization trails and security services. **Cannot be changed after the first deploy.**
- `additional_regions` - (Optional, `list[string]`, default: `[]`) Additional Regions for multi-region security services (GuardDuty, Security Hub, AWS Config) and preflight quota checks. Dropping a Region suspends GuardDuty and removes Config recorders in that Region.
- `delete_default_vpc` - (Optional, `bool`, default: `true`) Delete default VPCs, subnets, and internet gateways across all enabled Regions in the management account (automatically skips any default VPC that has active network interfaces attached).
- `tags` - (Optional, `map[string, string]`, default: `{}`) Organization-wide tags merged into all member accounts and CloudFormation stacks (overridden by account-level or CLI `--tag` values).

#### `contacts` (Required)

Sets alternate contacts on the management account (Phase 1) and all member accounts (Phase 4).

- `billing` - (Required, block) Billing contact. Supports `name`, `title`, `email`, and `phone` (all required `string`s).
- `operations` - (Required, block) Operations contact. Supports `name`, `title`, `email`, and `phone`.
- `security` - (Required, block) Security contact (also receives management root activity alerts). Supports `name`, `title`, `email`, and `phone`.

#### `root_access_management` (Optional)

Configures AWS Organizations centralized root access management in Phase 1. Combined with the `DenyMemberRootActivity` SCP, this eliminates permanent root passwords on member accounts while preserving audited emergency break-glass access.

- `enable_root_credentials_management` - (Optional, `bool`, default: `true`) Centrally manage and recover member account root credentials without member console login.
- `enable_root_sessions` - (Optional, `bool`, default: `true`) Allow authorized principals to open short-lived, audited break-glass root sessions in member accounts via STS/SSM.
- `delegate_to_audit` - (Optional, `bool`, default: `true`) Register `security_services.audit_account` as the IAM delegated administrator for root credentials and sessions.

#### `service_control_policies` (Optional)

- `policies` - (Optional, `list[block]`, default: `[]`) Service Control Policies to create and attach in Phase 2. Removing a policy detaches and deletes it on the next deploy. Tarmac also includes two optional policies in `examples/policies/scp` (region restriction and security service tampering protection; keep their `OrganizationAccountAccessRole` exemption and test on `Policy Staging` before attaching to `root`). Each item supports:
  - `name` - (Required, `string`) Policy name in AWS Organizations.
  - `description` - (Optional, `string`, default: `""`) Policy description.
  - `policy_file` - (Required, `string`) Path to the policy JSON file relative to your project root, falling back to Tarmac's bundled policies.
  - `targets` - (Optional, `list[string]`, default: `["root"]`) Target OUs or `"root"` for the organization root.

#### `ou_structure` (Optional)

List of Organizational Units created in Phase 2. Each item supports:

- `name` - (Required, `string`) OU name.
- `description` - (Optional, `string`, default: `""`) Purpose note in the config.
- `children` - (Optional, `list[OUDef]`, default: `[]`) Nested child OUs.

#### `baseline_stacks` (Optional)

Deploys custom CloudFormation templates across OUs via service-managed StackSets in Phase 4 (`--phase 4 --account NAME` skips `baseline_stacks` because they target whole OUs). Removing an entry deletes its StackSet and stack instances. Templates cannot use CloudFormation macros or transforms.

- `name` - (Required, `string`) Identifier used to name the StackSet (`<org>-baseline-<name>`).
- `template_file` - (Required, `string`) Path to the CloudFormation template file relative to your project root.
- `target_ous` - (Required, `list[string]`) OU names (including their child OUs) or `["root"]` for all active member accounts. StackSets cannot deploy to the management account.
- `regions` - (Required, `list[string]`) AWS Regions where stack instances are deployed.
- `parameters` - (Optional, `map[string, string]`, default: `{}`) CloudFormation template parameter key-value pairs.

#### `cloudtrail` (Optional)

Configures the log archive bucket and organization CloudTrail trail in Phase 3.

- `trail_name` - (Optional, `string`, default: `"organization-trail"`) Name of the organization trail.
- `log_archive_account` - (Optional, `string | null`, default: `"log-archive"`) Member account name hosting the centralized log buckets.
- `retention_days` - (Optional, `int | null`, `1..36500`, default: `null`) Days to retain CloudTrail logs (and AWS Config history) before S3 lifecycle expiration. Omit to keep logs indefinitely.
- `enable_kms` - (Optional, `bool`, default: `false`) Encrypt CloudTrail logs with a customer-managed KMS key (~$1/month plus request charges), required by CIS and Security Hub `CloudTrail.2`. `false` uses SSE-S3 (`AES256`). Turning it off later keeps the KMS key so older logs remain readable; new logs use SSE-S3.
- `object_lock` - (Optional, block, default: `null`) Enables S3 Object Lock on the CloudTrail log bucket. Off unless set because S3 cannot disable Object Lock once enabled (`tarmac plan` recommends `mode: GOVERNANCE, retention_days: 365` while off). Supports:
  - `mode` - (Required, `"GOVERNANCE" | "COMPLIANCE"`) `GOVERNANCE` can be bypassed with `s3:BypassGovernanceRetention`; `COMPLIANCE` cannot be shortened or deleted by anyone (including root) until retention expires, and blocks teardown from deleting the bucket until the lock expires.
  - `retention_days` - (Required, `int`, `1..36500`) Lock duration in days. Must not exceed `cloudtrail.retention_days` when `retention_days` is set.

#### `security_services` (Optional)

Configures delegated administration and security tooling in Phase 5.

- `audit_account` - (Optional, `string`, default: `"audit"`) Member account registered as delegated administrator for GuardDuty, Security Hub, AWS Config, and root access management.
- `incident_response_webhook_url` - (Optional, `string | null`, default: `null`) `https://` webhook URL subscribed to the audit account's security alerts SNS topic.
- `root_alert` - (Optional, block) Sends an SNS email to `contacts.security.email` when the root user is used in the management account (since SCPs cannot block root in the management account):
  - `enabled` - (Optional, `bool`, default: `true`) Enable the EventBridge rule and SNS topic.
  - `all_regions` - (Optional, `bool`, default: `false`) Watch every declared Region in addition to `us-east-1` (where root sign-in events are recorded) and `primary_region`.
- `guardduty` - (Optional, block) Organization GuardDuty configuration:
  - `enabled` - (Optional, `bool`, default: `false`) Enable GuardDuty across the organization. Turning it back to `false` suspends member detectors (retaining findings).
  - `auto_enable_members` - (Optional, `bool`, default: `true`) Automatically enable GuardDuty for new member accounts.
  - `export_findings` - (Optional, `bool`, default: `false`) Export findings to an S3 bucket in `log-archive` encrypted with KMS so findings outlive GuardDuty's 90-day retention (creates the log-archive KMS key automatically even if `cloudtrail.enable_kms` is `false`).
  - `features` - (Optional, block) Optional paid protection plans (all default to `false` so AWS doesn't enable them automatically on new detectors): `s3_data_events`, `eks_audit_logs`, `malware_protection`, `rds_login_events`, `lambda_network_logs`.
- `securityhub` - (Optional, block) Organization Security Hub configuration:
  - `enabled` - (Optional, `bool`, default: `false`) Enable Security Hub across the organization.
  - `auto_enable_members` - (Optional, `bool`, default: `true`) Automatically enable Security Hub for new accounts.
  - `central_configuration` - (Optional, `bool`, default: `true`) Manage all accounts and Regions from one central policy in `primary_region` (requires `auto_enable_members: true`).
  - `standards` - (Optional, `list[string]`, default: `["aws-foundational-security-best-practices"]`) Standards to enable. Uses the newest version unless pinned with `/v/X.Y.Z` (e.g., `cis-aws-foundations-benchmark/v/5.0.0`).
- `config_recorder` - (Optional, block) Organization-wide AWS Config recorders delivering to `log-archive`:
  - `enabled` - (Optional, `bool`, default: `false`) Enable AWS Config recorders in every account across `primary_region` and `additional_regions`. Required by most Security Hub CSPM controls.
  - `recording_frequency` - (Optional, `"CONTINUOUS" | "DAILY"`, default: `"CONTINUOUS"`) `CONTINUOUS` bills $0.003/item; `DAILY` bills $0.012/item (only cheaper for resources changing more than 4 times/day).
  - `include_global_resources` - (Optional, `bool`, default: `true`) Record global IAM resource types in `primary_region` only.
  - `record_resource_compliance` - (Optional, `bool`, default: `false`) Record `AWS::Config::ResourceCompliance` items. Left off by default to avoid redundant Security Hub CSPM charges.

#### `terraform_backend` (Optional)

Provisions the remote Terraform state stack (`<org>-terraform-backend`) in Phase 5. The generated S3 bucket name is exported in the stack's `BucketName` output.

- `account` - (Optional, `string | null`, default: `"deployment"`) Member account hosting the S3 state bucket.
- `enable_dynamodb` - (Optional, `bool`, default: `false`) Create a DynamoDB lock table. `false` uses native S3 state locking (`use_lockfile = true` in Terraform 1.10+).
- `dynamodb_table_name` - (Optional, `string`, default: `"terraform-state-lock"`) Name of the DynamoDB lock table when `enable_dynamodb: true`.

#### `cost_allocation_tags` (Optional)

- `cost_allocation_tags` - (Optional, `list[string]`, default: `[]`) Tag keys to activate in AWS Billing Cost Allocation Tags. Removing a key deactivates it on the next deploy.

---

## `accounts.yaml`

Defines member accounts, OU placement, tags, and per-account baselines (VPC cleanup, budgets, and cost anomaly monitors) applied in Phase 4.

### Example Usage

```yaml
quarantine_removed_accounts: true

accounts:
  - name: "deployment"
    email: "aws-deployment@example.com"
    ou: "Deployments"
    tags:
      Environment: "Infrastructure"
      ManagedBy: "tarmac"
    baseline:
      delete_default_vpc: true
      budget:
        monthly_limit_usd: 50.0
        alert_threshold_percent: 80.0
        notification_emails: ["finops-alerts@example.com"]

  - name: "log-archive"
    email: "aws-log-archive@example.com"
    ou: "Security"

  - name: "audit"
    email: "aws-audit@example.com"
    ou: "Security"

  - name: "prod-app"
    email: "aws-prod@example.com"
    ou: "Prod"
    tags:
      Environment: "Production"
    baseline:
      delete_default_vpc: true
      budget:
        monthly_limit_usd: 500.0
        alert_threshold_percent: 80.0
        forecast_alert_threshold_percent: 100.0
        notification_emails: ["finops-alerts@example.com"]
      anomaly_detection:
        enabled: true
        threshold_usd: 100.0
        notification_emails: ["finops-alerts@example.com"]
```

### Argument Reference

- `quarantine_removed_accounts` - (Optional, `bool`, default: `true`) Move accounts that Tarmac previously created, but that have been removed from `accounts`, into the `Suspended` OU. Accounts Tarmac never managed are untouched.
- `accounts` - (Required, `list[block]`) Member accounts to create or reconcile. Each item supports:
  - `name` - (Required, `string`, `1..50` chars) Unique account name.
  - `email` - (Required, `string`) Globally unique root email address for the AWS account.
  - `ou` - (Required, `string`) Target OU name declared in `organization.yaml` (for nested OUs like `Prod` under `Workloads`, pass the OU's name `"Prod"`).
  - `tags` - (Optional, `map[string, string]`, default: `{}`) Account-specific tags merged over `organization.tags`.
  - `baseline` - (Optional, block) Per-account baseline controls:
    - `delete_default_vpc` - (Optional, `bool`, default: `true`) Delete default VPCs across all enabled Regions in this account (automatically skips any default VPC with attached network interfaces). Set to `false` when importing existing accounts that use the default VPC.
    - `budget` - (Optional, block, default: `null`) AWS Budget for the account. Omitting or removing this block deletes the budget on the next deploy:
      - `monthly_limit_usd` - (Required, `float`, `> 0`) Monthly spend limit in USD.
      - `alert_threshold_percent` - (Optional, `float`, `0..100`, default: `80.0`) Actual spend percentage that triggers an alert.
      - `forecast_alert_threshold_percent` - (Optional, `float | null`, `0..1000`, default: `100.0`) Forecasted spend percentage that triggers an alert (`null` disables forecast alerts; AWS requires ~5 weeks of usage history before forecast alerts fire).
      - `notification_emails` - (Optional, `list[string]`, `1..10` emails) Alert recipients. Prefer shared team mailboxes so alerts still reach someone when team members change.
      - `incident_response_webhook_url` - (Optional, `string | null`, default: `null`) `https://` webhook URL subscribed to the budget alert SNS topic.
    - `anomaly_detection` - (Optional, block, default: `null`) AWS Cost Anomaly Detection monitor for the account:
      - `enabled` - (Optional, `bool`, default: `true`) Enable the anomaly monitor and subscription.
      - `threshold_usd` - (Optional, `float`, default: `100.0`) Dollar impact threshold to trigger an anomaly alert.
      - `notification_emails` - (Optional, `list[string]`, `1..10` emails) Alert recipients.

---

## `identity.yaml`

Defines IAM Identity Center users, permission sets, groups, and account assignments reconciled in Phase 6. Supports both AWS Identity Center's native directory (`identity_source: "identity_center"`) and external identity providers such as Okta, Entra ID, or Google Workspace provisioning over SCIM (`identity_source: "external"`).

### Example Usage

```yaml
identity_center:
  region: "us-east-1"
  identity_source: "identity_center" # or "external" when an IdP provisions users/groups via SCIM

  admin_user:
    username: "admin"
    email: "admin@example.com"
    first_name: "Admin"
    last_name: "User"

  breakglass_user:
    username: "breakglass"
    email: "breakglass@example.com"
    first_name: "Break"
    last_name: "Glass"

  additional_users: []

  permission_sets:
    - name: "AdministratorAccess"
      description: "Full AWS Administrator access"
      session_duration: "PT4H"
      managed_policies:
        - "arn:aws:iam::aws:policy/AdministratorAccess"

    - name: "SecurityAudit"
      description: "Security and compliance read-only access"
      session_duration: "PT8H"
      managed_policies:
        - "arn:aws:iam::aws:policy/SecurityAudit"
        - "arn:aws:iam::aws:policy/job-function/ViewOnlyAccess"

  groups:
    - name: "AWS-Administrators"
      description: "Cloud Platform Administrators"
      members:
        - "admin"
      assignments:
        - permission_set: "AdministratorAccess"
          accounts: ["all"]

    - name: "AWS-Developers"
      description: "Workload Developers"
      members: []
      assignments:
        - permission_set: "AdministratorAccess"
          accounts: ["dev-app", "stage-app"]
```

### External Identity Provider (`identity_source: "external"`)

When an external identity provider (Okta, Microsoft Entra ID, Google Workspace, etc.) provisions IAM Identity Center over SCIM, set `identity_source: "external"`. Tarmac then manages **only permission sets and declared group account assignments**, leaving users, groups, and group memberships entirely to the IdP:

- **No user or group creation**: Tarmac never creates users or groups and never modifies group memberships.
- **Disallowed fields**: `breakglass_user`, `additional_users`, and `groups[].members` are rejected by schema validation when `identity_source: "external"`. Break-glass access is the AWS root user with MFA (since an IdP user cannot sign in if the IdP itself is unavailable).
- **Pre-provisioned principals**: Push `admin_user` and all declared `groups` from your IdP via SCIM before deploying. Any declared group not yet present in Identity Center shows as `BLOCKED` in `tarmac plan` and halts `tarmac deploy`. Similarly, `tarmac bootstrap` looks up the existing `admin_user` rather than creating one.
- **Safety guardrail**: If Tarmac detects SCIM-provisioned users or groups in Identity Center while `identity_source` is still `"identity_center"`, `tarmac plan` and `tarmac deploy` stop immediately rather than creating local users and groups alongside the IdP's.

```yaml
identity_center:
  region: "us-east-1"
  identity_source: "external"

  admin_user:
    username: "admin@example.com"
    email: "admin@example.com"
    first_name: "Admin"
    last_name: "User"

  permission_sets:
    - name: "AdministratorAccess"
      description: "Full AWS Administrator access"
      session_duration: "PT4H"
      managed_policies:
        - "arn:aws:iam::aws:policy/AdministratorAccess"

  groups:
    - name: "AWS-Administrators"
      description: "Pushed from IdP over SCIM"
      assignments:
        - permission_set: "AdministratorAccess"
          accounts: ["all"]
```

### Argument Reference

#### `identity_center` (Required)

- `region` - (Optional, `string | null`, default: `null`) AWS Region where IAM Identity Center is enabled. Defaults to `organization.primary_region`.
- `identity_source` - (Optional, `"identity_center" | "external"`, default: `"identity_center"`) Where users and groups originate. `"identity_center"` creates and manages declared users, groups, and memberships directly in Identity Center; `"external"` expects an external IdP to provision users and groups over SCIM and restricts Tarmac to managing permission sets and group account assignments.
- `admin_user` - (Required, block) Primary administrator granted management account access by `tarmac bootstrap`. Created by Tarmac when `identity_source: "identity_center"`, or looked up by username when `identity_source: "external"`. Supports `username`, `email`, `first_name`, and `last_name` (all required `string`s).
- `breakglass_user` - (Required when `identity_source: "identity_center"`, forbidden when `"external"`, block) Emergency break-glass user created in Phase 6. Not allowed with `"external"` (where break-glass access is the root user with MFA). Supports `username`, `email`, `first_name`, and `last_name`.
- `additional_users` - (Optional, `list[block]`, default: `[]`, forbidden when `"external"`) Additional Identity Center users. Each item supports `username`, `email`, `first_name`, and `last_name`. Users removed from this list are never deleted from Identity Center.
- `permission_sets` - (Optional, `list[block]`, default: `[]`) Permission sets created in Phase 6. Removing a permission set that Tarmac created deletes it and revokes its assignments across all accounts. Each item supports:
  - `name` - (Required, `string`, `1..32` chars) Permission set name.
  - `description` - (Optional, `string`, default: `""`) Description.
  - `session_duration` - (Optional, `string`, default: `"PT4H"`) ISO 8601 duration between 15 minutes and 12 hours (`PT15M` to `PT12H`).
  - `managed_policies` - (Optional, `list[string]`, default: `[]`) AWS-managed policy ARNs to attach.
  - `inline_policy_file` - (Optional, `string | null`, default: `null`) Path to a custom JSON inline policy file relative to your project root.
- `groups` - (Optional, `list[block]`, default: `[]`) Identity Center groups, memberships, and account assignments. With `identity_source: "external"`, groups must already exist in Identity Center via SCIM and Tarmac reconciles only their `assignments`. Each item supports:
  - `name` - (Required, `string`, `1..128` chars) Group name.
  - `description` - (Optional, `string`, default: `""`) Group description.
  - `members` - (Optional, `list[string]`, default: `[]`, forbidden when `"external"`) Usernames declared in `admin_user`, `breakglass_user`, or `additional_users`.
  - `assignments` - (Optional, `list[block]`, default: `[]`) Account access bindings for the group:
    - `permission_set` - (Required, `string`) Name of a permission set declared in `permission_sets`.
    - `accounts` - (Required, `list[string]`) Account names from `accounts.yaml`, or `["all"]` for every account in `accounts.yaml`.
      > [!NOTE]
      > `accounts: ["all"]` targets every member account in `accounts.yaml`, **never** unmanaged accounts or the management account. Assigning a permission set to the management account requires broad IAM role-creation rights in the management account itself, which `TarmacDeployment` intentionally lacks so a CI runner cannot escalate privileges on the management account. Management account access is granted via `tarmac bootstrap` or by a console administrator.
