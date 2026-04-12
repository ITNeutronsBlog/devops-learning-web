output "dr_instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.dr.id
}

output "dr_public_ip" {
  description = "Elastic IP of DR server"
  value       = aws_eip.dr.public_ip
}

output "dr_ssh_command" {
  description = "SSH command to connect"
  value       = "ssh -i ~/.ssh/${var.key_pair_name}.pem ubuntu@${aws_eip.dr.public_ip}"
}

output "s3_backup_bucket" {
  description = "S3 bucket for PostgreSQL backups"
  value       = aws_s3_bucket.backups.id
}

output "security_group_id" {
  value = aws_security_group.dr.id
}

output "vpc_id" {
  value = aws_vpc.dr.id
}

output "aws_region" {
  value = var.aws_region
}
