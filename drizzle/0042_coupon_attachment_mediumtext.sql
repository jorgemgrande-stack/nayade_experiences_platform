-- Ampliar attachmentUrl a MEDIUMTEXT para poder almacenar base64 sin S3
ALTER TABLE `coupon_redemptions` MODIFY `attachmentUrl` MEDIUMTEXT;
