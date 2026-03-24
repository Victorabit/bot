const { startBot } = require('./src/application/bot.js');
const { startCronJob } = require('./src/infrastructure/cron.js');
const { initStorage } = require('./src/infrastructure/storage.js');
const logger = require('./src/infrastructure/logger');
require('dotenv').config();

const fs = require('fs');
const path = require('path');

async function main() {
    logger.info('🚀 Iniciando Sistema M2-Bot...');

    // 0. Limpa cache defeituoso do WhatsApp Web (Impede o erro 'Execution context was destroyed')
    const cachePath = path.join(__dirname, '.wwebjs_cache');
    if (fs.existsSync(cachePath)) {
        fs.rmSync(cachePath, { recursive: true, force: true });
        logger.info('🧹 Cache do Chrome limpo com sucesso.');
    }

    // 1. Inicializa dependências de armazenamento
    await initStorage();

    // 2. Inicia o relógio do Google Sheets (3 AM)
    startCronJob();

    // 3. Conecta o WhatsApp Web
    const client = await startBot();

    // 4. Tratamento de encerramento limpo (Evita erro de 'browser already running')
    const shutdown = async () => {
        logger.info('🛑 Encerrando sistema de forma segura...');
        if (client) await client.destroy();
        logger.info('✅ Bot desconectado. Finalizando processo.');
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch(err => {
    logger.fatal({ error: err.message }, '❌ Erro fatal no sistema');
});
