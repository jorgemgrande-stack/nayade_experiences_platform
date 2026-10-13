// Las pruebas simulan el driver de MySQL; el pool compartido del registro (dbRegistry) solo
// exige que exista una cadena de conexión para crearse. Nunca se usa para conectar.
process.env.DATABASE_URL ||= "mysql://test:test@127.0.0.1:3306/test";
