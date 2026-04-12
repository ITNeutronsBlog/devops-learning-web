# ════════════════════════════════════════════════
# DATA SOURCES
# ════════════════════════════════════════════════

data "aws_availability_zones" "available" {
  state = "available"
}

# Latest Ubuntu 22.04 AMI
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ════════════════════════════════════════════════
# NETWORKING — VPC + Public Subnet + IGW
# ════════════════════════════════════════════════

resource "aws_vpc" "dr" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "${var.project}-dr-vpc" }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.dr.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 1)
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true

  tags = { Name = "${var.project}-dr-public-subnet" }
}

resource "aws_internet_gateway" "dr" {
  vpc_id = aws_vpc.dr.id
  tags   = { Name = "${var.project}-dr-igw" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.dr.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.dr.id
  }

  tags = { Name = "${var.project}-dr-public-rt" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# ════════════════════════════════════════════════
# SECURITY GROUP — Firewall rules for DR server
# ════════════════════════════════════════════════

resource "aws_security_group" "dr" {
  name_prefix = "${var.project}-dr-"
  vpc_id      = aws_vpc.dr.id
  description = "DR server: SSH + HTTP + HTTPS + PG replication"

  # SSH from your IP only
  ingress {
    description = "SSH from management IPs"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.allowed_ssh_cidrs
  }

  # HTTP (Nginx)
  ingress {
    description = "HTTP from anywhere"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTPS
  ingress {
    description = "HTTPS from anywhere"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # App direct access (for health checks)
  ingress {
    description = "App port from anywhere"
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # PostgreSQL replication from primary server only
  ingress {
    description = "PostgreSQL replication from primary"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["${var.primary_server_ip}/32"]
  }

  # All outbound traffic
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-dr-sg" }

  lifecycle {
    create_before_destroy = true
  }
}

# ════════════════════════════════════════════════
# IAM — Instance profile for S3 backup access
# ════════════════════════════════════════════════

resource "aws_iam_role" "dr" {
  name = "${var.project}-dr-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

# S3 access for pgBackRest
resource "aws_iam_role_policy" "s3_access" {
  name = "${var.project}-s3-backup-access"
  role = aws_iam_role.dr.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
      Resource = [aws_s3_bucket.backups.arn, "${aws_s3_bucket.backups.arn}/*"]
    }]
  })
}

# SSM Session Manager (SSH alternative)
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.dr.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# CloudWatch agent
resource "aws_iam_role_policy_attachment" "cloudwatch" {
  role       = aws_iam_role.dr.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

resource "aws_iam_instance_profile" "dr" {
  name = "${var.project}-dr-profile"
  role = aws_iam_role.dr.name
}

# ════════════════════════════════════════════════
# S3 — Backup bucket for pgBackRest
# ════════════════════════════════════════════════

resource "aws_s3_bucket" "backups" {
  bucket = "${var.project}-pg-backups"

  tags = {
    Name    = "${var.project}-pg-backups"
    Purpose = "PostgreSQL WAL archives and base backups"
  }
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "wal-cleanup"
    status = "Enabled"
    filter { prefix = "archive/" }
    transition { days = 30; storage_class = "GLACIER" }
    expiration { days = 90 }
  }

  rule {
    id     = "backup-cleanup"
    status = "Enabled"
    filter { prefix = "backup/" }
    transition { days = 14; storage_class = "STANDARD_IA" }
    transition { days = 60; storage_class = "GLACIER" }
    expiration { days = 180 }
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ════════════════════════════════════════════════
# EBS — Dedicated PostgreSQL data volume
# ════════════════════════════════════════════════

resource "aws_ebs_volume" "pg_data" {
  availability_zone = data.aws_availability_zones.available.names[0]
  size              = var.pg_volume_size
  type              = "gp3"
  iops              = 3000
  throughput        = 125
  encrypted         = true

  tags = {
    Name   = "${var.project}-pg-data"
    Backup = "true"
  }
}

# ════════════════════════════════════════════════
# EC2 — DR Server
# ════════════════════════════════════════════════

resource "aws_instance" "dr" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.dr.id]
  iam_instance_profile   = aws_iam_instance_profile.dr.name
  key_name               = var.key_pair_name

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 30
    encrypted             = true
    delete_on_termination = true
  }

  user_data = templatefile("${path.module}/user_data.sh", {
    project              = var.project
    postgres_password    = var.postgres_password
    replication_password = var.replication_password
    primary_server_ip    = var.primary_server_ip
    r2_account_id        = var.r2_account_id
    r2_access_key_id     = var.r2_access_key_id
    r2_secret_access_key = var.r2_secret_access_key
    r2_bucket_name       = var.r2_bucket_name
    r2_public_url        = var.r2_public_url
    s3_backup_bucket     = aws_s3_bucket.backups.id
    aws_region           = var.aws_region
    ghcr_token           = var.ghcr_token
  })

  tags = {
    Name = "${var.project}-dr-server"
    Role = "disaster-recovery"
  }

  lifecycle {
    ignore_changes = [ami, user_data]
  }
}

resource "aws_volume_attachment" "pg_data" {
  device_name = "/dev/xvdf"
  volume_id   = aws_ebs_volume.pg_data.id
  instance_id = aws_instance.dr.id
}

# ════════════════════════════════════════════════
# ELASTIC IP — Fixed public IP for DR server
# ════════════════════════════════════════════════

resource "aws_eip" "dr" {
  instance = aws_instance.dr.id
  domain   = "vpc"

  tags = { Name = "${var.project}-dr-eip" }
}
