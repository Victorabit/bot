const pino = require('pino');

// Configuração do Logger Profissional
const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: {
        target: 'pino-pretty', // Para deixar o log legível no console do servidor
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
        }
    }
});

module.exports = logger;
