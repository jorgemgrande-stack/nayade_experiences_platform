-- Reversión de 0016_user_devices: se pierde el registro de dispositivos (el siguiente inicio de sesión de cada usuario
-- vuelve a registrarse sin aviso). Antes, desplegar el código anterior al registro de dispositivos.
DROP TABLE IF EXISTS user_devices;
