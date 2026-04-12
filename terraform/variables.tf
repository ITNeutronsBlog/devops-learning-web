# ──────────────────────────────────────
# General
# ──────────────────────────────────────
variable "project" {
  description = "Project name for resource naming"
  type        = string
  default     = "devops-learning"
}

variable "aws_region" {
  description = "AWS region for DR server"
  type        = string
  default     = "ap-south-1" # Mumbai
}

# ──────────────────────────────────────
# Network
# ──────────────────────────────────────
variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "allowed_ssh_cidrs" {
  description = "CIDR blocks allowed to SSH (your IP)"
  type        = list(string)
}

variable "primary_server_ip" {
  description = "Public IP of your primary production server"
  type        = string
}

# ──────────────────────────────────────
# Compute
# ──────────────────────────────────────
variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.small"
}

variable "key_pair_name" {
  description = "Name of existing EC2 key pair for SSH"
  type        = string
}

variable "pg_volume_size" {
  description = "Size of PostgreSQL data EBS volume (GB)"
  type        = number
  default     = 20
}

# ──────────────────────────────────────
# Application Secrets
# Pass via: export TF_VAR_postgres_password="..."
# ──────────────────────────────────────
variable "postgres_password" {
  description = "PostgreSQL superuser password"
  type        = string
  sensitive   = true
}

variable "replication_password" {
  description = "PostgreSQL replication user password"
  type        = string
  sensitive   = true
}

variable "r2_account_id" {
  type      = string
  sensitive = true
}

variable "r2_access_key_id" {
  type      = string
  sensitive = true
}

variable "r2_secret_access_key" {
  type      = string
  sensitive = true
}

variable "r2_bucket_name" {
  type    = string
  default = "devops-videos"
}

variable "r2_public_url" {
  type = string
}

variable "ghcr_token" {
  description = "GitHub PAT with read:packages scope to pull GHCR images"
  type        = string
  sensitive   = true
}

variable "alert_email" {
  description = "Email for DR alerts"
  type        = string
  default     = ""
}
