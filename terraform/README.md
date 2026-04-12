# DevOps Learning Hub — DR Server (Terraform)

## Overview

This Terraform configuration provisions a **Disaster Recovery server** on AWS (Mumbai `ap-south-1`) for the DevOps Learning Hub application. The DR server mirrors your primary setup with PostgreSQL running in Docker.

## Architecture

| Component | Resource |
|-----------|----------|
| **Network** | VPC + Public Subnet + Internet Gateway |
| **Compute** | EC2 t3.small (Ubuntu 22.04) |
| **Storage** | 30GB root EBS + 20GB PG data EBS + S3 backup bucket |
| **Security** | Security Group, UFW, fail2ban, SSH hardening |
| **IAM** | Instance profile with S3 + SSM + CloudWatch access |

## Prerequisites

1. **AWS Account** with IAM user (programmatic access)
2. **AWS CLI** configured locally: `aws configure`
3. **Terraform** >= 1.5.0: [Install guide](https://developer.hashicorp.com/terraform/install)
4. **EC2 Key Pair** in `ap-south-1` region
5. **GitHub PAT** with `read:packages` scope (for pulling images from GHCR)

## Quick Start

```bash
# 1. Configure
cd terraform/
cp terraform.tfvars.example terraform.tfvars
vim terraform.tfvars  # Fill in your values

# 2. Set secrets via environment
export TF_VAR_postgres_password="your_strong_password"
export TF_VAR_replication_password="your_repl_password"
export TF_VAR_r2_account_id="..."
export TF_VAR_r2_access_key_id="..."
export TF_VAR_r2_secret_access_key="..."
export TF_VAR_ghcr_token="..."

# 3. Deploy
terraform init
terraform plan -out=dr.tfplan
terraform apply dr.tfplan

# 4. Verify
terraform output dr_ssh_command  # Get SSH command
ssh -i ~/.ssh/your-key.pem ubuntu@$(terraform output -raw dr_public_ip)
sudo tail -f /var/log/user-data.log  # Watch bootstrap
```

## Cost (~$18.50/month running, ~$8/month stopped)

Keep the DR instance **stopped** when not in use:

```bash
# Stop (saves ~$13.50/month)
aws ec2 stop-instances --instance-ids $(terraform output -raw dr_instance_id) --region ap-south-1

# Start
aws ec2 start-instances --instance-ids $(terraform output -raw dr_instance_id) --region ap-south-1
```

## DR Operations

| Script | Purpose |
|--------|---------|
| `scripts/dr-failover.sh` | Activate DR site when primary is down |
| `scripts/dr-failback.sh` | Return to primary after recovery |
| `scripts/dr-drill.sh` | Quarterly DR test |

## Destroy

```bash
terraform destroy  # Removes all AWS resources
```
