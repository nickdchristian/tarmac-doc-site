---
title: Quickstart & CI/CD
description: Bootstrap a new AWS account, import an existing AWS Organization, or deploy from GitHub Actions.
---

## Brand-New AWS Account

Tarmac runs in the organization's management account. Because the AWS root user cannot call `sts:AssumeRole` into member accounts, you first bootstrap an IAM Identity Center user from AWS CloudShell.

### 1. Prerequisites

1. Sign in as root, turn on MFA, and add a payment method.
2. Enable **IAM Identity Center** in the Region you want to use as your `primary_region` (this also creates the AWS Organization if one does not exist). Pick this Region carefully; moving Identity Center later requires recreating it.

### 2. Initialize & Bootstrap in CloudShell

Tarmac reads `config/` in the current working directory by default (`--config-dir` or `TARMAC_CONFIG_DIR` points it elsewhere).

```bash
pip install tarmac-cli
tarmac init
```

Edit the generated files in `config/`:
- Set `admin_user` in `config/identity.yaml` to your own username and email. (If an external identity provider such as Okta or Entra ID provisions Identity Center over SCIM, set `identity_source: "external"`, remove `breakglass_user` and group `members`, and push `admin_user` and your groups from the IdP first; see [External Identity Provider](/configuration#external-identity-provider-identity_source-external).)
- Give each account in `config/accounts.yaml` a unique email address (plus-addressing such as `aws+prod@example.com` works if your mail provider supports it).

Still signed in as root in CloudShell, validate and bootstrap:

```bash
tarmac validate
tarmac bootstrap
```

`tarmac bootstrap` creates your `admin_user` in Identity Center (or looks up the existing user when `identity_source: "external"`), assigns two permission sets on the management account (`TarmacDeployment` with Tarmac's least-privilege policy, and `ManagementAdministrator` for console access), writes `[profile tarmac]` to `~/.aws/config`, and prints the steps for your first sign-in.

### 3. Sign In & Deploy

Set up credentials for the new Identity Center user before signing in:

1. In the IAM Identity Center console (**Users -> `<admin_user>`**), register an MFA device and generate a one-time password (**Reset password -> Generate a one-time password**).
2. In CloudShell, sign in with `--use-device-code` (normal browser callbacks cannot reach a CloudShell session) and export the profile:

```bash
aws sso login --use-device-code --profile tarmac
export AWS_PROFILE=tarmac
```

3. Run preflight checks, inspect the plan, and deploy:

```bash
tarmac preflight
tarmac plan
tarmac deploy
```

> [!NOTE]
> **CloudShell & Quota Notes:**
> - **CloudShell restarts**: Re-run `export AWS_PROFILE=tarmac` after CloudShell restarts; without it, Tarmac sees root credentials and stops.
> - **Member account quotas**: New AWS accounts often start with a limit of 1 to 4 member accounts, while `tarmac init` declares 7. `tarmac preflight` checks your quota up front. If your quota is lower than your declared accounts, request an increase under **Service Quotas -> AWS Organizations -> Default maximum number of accounts**, or comment out workload accounts in `accounts.yaml` until the increase goes through.

### 4. Using the Terraform State Backend

Phase 5 creates a remote state S3 bucket in the `deployment` account via the `<org>-terraform-backend` stack (the bucket name is in the stack's `BucketName` output). Configure Terraform (1.10+) to use it with native S3 state locking:

```hcl
terraform {
  backend "s3" {
    bucket       = "<BucketName-from-stack-output>"
    key          = "workloads/prod/terraform.tfstate"
    region       = "us-east-2"
    encrypt      = true
    use_lockfile = true
  }
}
```

---

## Importing an Existing Organization

`tarmac import` reads a live AWS Organization (read-only) and writes matching `organization.yaml`, `accounts.yaml`, and `identity.yaml` files, keeping any overwritten file as `<name>.bak`.

```bash
tarmac import --config-dir my-org
cd my-org
tarmac validate
tarmac status --detail
tarmac plan
```

Besides OUs, accounts, SCPs, and Identity Center, `tarmac import` reads active settings so your first `tarmac plan` shows no unexpected changes:
- GuardDuty and Security Hub when delegated to the audit account, plus the Regions they and AWS Config recorders cover.
- Active cost allocation tags in AWS Billing.
- External identity provider SCIM provisioning: when Identity Center contains SCIM-provisioned users or groups, `tarmac import` automatically writes `identity_source: "external"` and omits `breakglass_user`, `additional_users`, and group `members`.
- Settings deployed by Tarmac's own stacks (KMS encryption, log retention, Object Lock, the Terraform DynamoDB lock table, and `baseline_stacks` templates written to `baseline/`).

Anything `tarmac import` cannot read is listed at the end of the run. Check those items before deploying, because leaving an active setting off in YAML turns it off on the next `tarmac deploy`.

Keep in mind:
- **Declare existing accounts with their real emails**: If an account name in `accounts.yaml` matches a live account, its email must match too, or Tarmac stops rather than guess.
- **Unmanaged accounts are left alone**: Accounts in the organization that are not listed in `accounts.yaml` are ignored, except accounts Tarmac created earlier and you later removed from `accounts.yaml` (those move to the `Suspended` OU unless `quarantine_removed_accounts: false`).
- **Never change `organization.name` or `primary_region` after the first deploy**: Stack names and the inventory bucket depend on both. Tarmac records them on the management account and stops if the config no longer matches.
- **Set `baseline.delete_default_vpc: false`** for accounts that already run workloads in the default VPC.
- **Existing organization trails**: Tarmac does not replace an existing non-Tarmac trail; delete the old trail once Tarmac's trail is delivering logs.

---

## Deploying from GitHub Actions

Keep your `config/` directory in a GitHub repository and let merges to `main` deploy automatically over OIDC without storing long-lived AWS keys in GitHub.

### 1. Create the GitHub OIDC Role

Run `tarmac bootstrap` as root or `ManagementAdministrator` with `--github-repo`:

```bash
tarmac bootstrap --github-repo OWNER/REPO   # add --github-branch if not main
```

> [!IMPORTANT]
> Repositories created, renamed, or transferred after **15 July 2026** identify workflow runs by immutable numeric owner and repository IDs. Fetch them with:
> ```bash
> gh api repos/OWNER/REPO --jq '"\(.owner.login)@\(.owner.id)/\(.name)@\(.id)"'
> ```
> Pass that value as `--github-repo OWNER@ID/REPO@ID`. With the wrong form, AWS rejects `sts:AssumeRoleWithWebIdentity`; run `tarmac bootstrap` again with the other form.

This creates the GitHub OIDC provider and the `TarmacGitHubDeployment` role in the management account, trusted only by workflow runs on that branch. Set the `TARMAC_ROLE_ARN` repository variable with the `gh variable set` command printed by `tarmac bootstrap`, and protect the branch so changes require pull request review.

### 2. Add the Workflow

Copy [`examples/github/tarmac.yml`](https://github.com/nickdchristian/tarmac-cli/blob/main/examples/github/tarmac.yml) to `.github/workflows/tarmac.yml` and set `aws-region` to your `primary_region`:

```yaml
name: tarmac

on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: "17 6 * * 1" # weekly drift check

permissions:
  contents: read

env:
  TARMAC: tarmac-cli==0.7.2
  CONFIG_DIR: config

jobs:
  validate:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
        with:
          cache-dependency-glob: .github/workflows/tarmac.yml
      - run: uvx --from "$TARMAC" tarmac validate --config-dir "$CONFIG_DIR"

  deploy:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    concurrency:
      group: tarmac-deploy
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
        with:
          cache-dependency-glob: .github/workflows/tarmac.yml
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.TARMAC_ROLE_ARN }}
          aws-region: us-east-1
          role-duration-seconds: 14400
      - run: uvx --from "$TARMAC" tarmac plan --config-dir "$CONFIG_DIR"
      - run: uvx --from "$TARMAC" tarmac deploy --yes --config-dir "$CONFIG_DIR"

  drift:
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
        with:
          cache-dependency-glob: .github/workflows/tarmac.yml
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.TARMAC_ROLE_ARN }}
          aws-region: us-east-1
      - run: uvx --from "$TARMAC" tarmac status --strict --config-dir "$CONFIG_DIR"
```

- **Pull requests** get no AWS access (anyone who can open a PR can modify the workflow) and only run `tarmac validate`.
- **Merges to `main`** assume `TarmacGitHubDeployment`, run `tarmac plan`, and apply changes with `tarmac deploy --yes`.
- **Scheduled runs** check for drift weekly with `tarmac status --strict`.
- Running `tarmac bootstrap` after upgrading `tarmac-cli` also updates `TarmacGitHubDeployment`'s policy.
- `tarmac destroy --everything` does not delete `TarmacGitHubDeployment` or the OIDC provider; remove them in the IAM console if you stop deploying from GitHub.

---

## Operational Notes

### Confirming SNS Subscriptions

After the first deploy, AWS sends SNS subscription confirmation emails to `contacts.security.email` (for the management account root alert in `us-east-1` and `primary_region`, plus `<org>-security-alerts` in `audit`) and to `notification_emails` (for account budgets). Confirm each email link so alerts can be delivered; `tarmac preflight` warns while subscriptions remain in `PendingConfirmation`.

### Testing Custom SCPs

An overly broad SCP attached to `root` can break workloads or block Tarmac from assuming roles in member accounts:

1. **Keep the `OrganizationAccountAccessRole` exemption**: Tarmac works in member accounts by assuming `OrganizationAccountAccessRole`. Custom deny SCPs (such as the region restriction and security service policies in `examples/policies/scp/`) must exempt `arn:aws:iam::*:role/OrganizationAccountAccessRole`.
2. **Test on `Policy Staging` first**: Attach new SCPs to `targets: ["Policy Staging"]`, test with a staging account in that OU, and only then add `"Workloads"` or `"root"`.

### Upgrading

Tarmac is pre-1.0, so minor releases can change config schemas or add new permissions to `TarmacDeployment`:

```bash
uv tool upgrade tarmac-cli    # or: pip install --upgrade tarmac-cli
tarmac validate
tarmac preflight
```

If `tarmac preflight` warns that `TarmacDeployment` is out of date, run `tarmac bootstrap` again (as root or `ManagementAdministrator`) to update the permission set and `TarmacGitHubDeployment` role policy, then run `tarmac plan`.
