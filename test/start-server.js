/**
 * Minimal server starter for testing.
 * Usage: node test/start-server.js
 * Env vars: CWM_PASSWORD, PORT
 */
const path = require('path');
const { startServer } = require(path.join(__dirname, '..', 'src', 'web', 'server'));

const port = parseInt(process.env.PORT || '3458', 10);
const host = '0.0.0.0';

const server = startServer(port, host);
process.stdout.write('Server listening on ' + host + ':' + port + '\n');

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
