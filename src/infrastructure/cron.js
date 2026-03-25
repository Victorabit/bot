const cron = require('node-cron');
const { getDailyLeads, clearLeads } = require('./storage');
const { exportLeadsToSheet } = require('./sheets');
const { clearHandedOver } = require('../application/bot');
const { clearAllChatSessions } = require('./ai');
const logger = require('./logger');
require('dotenv').config();
function startCronJob() {
    // Agenda para todos os dias às 03:00 (Fuso horário local do servidor)
    cron.schedule('0 3 * * *', async () => {
        logger.info('⏰ [CRON] Iniciando exportação diária de leads...');
        try {
            const leads = await getDailyLeads();
            
            if (leads.length === 0) {
                logger.debug('⏰ [CRON] Nenhum lead novo captado hoje.');
                return;
            }

            if (process.env.GOOGLE_SPREADSHEET_ID) {
                const count = await exportLeadsToSheet(leads);
                logger.info({ count }, '⏰ [CRON] Sucesso! Leads exportados para o Google Planilhas.');
            } else {
                logger.info('⏰ [CRON] Google Sheets não configurado. Pulando exportação.');
            }
            
            // Após exportar (ou pular), limpa os leads locais para o dia seguinte
            await clearLeads();
            clearHandedOver();
            clearAllChatSessions();
            logger.info('⏰ [CRON] Lista local de leads, handoff e sessões de IA limpos.');
            
        } catch (error) {
            logger.error({ error: error.message }, '⏰ [CRON] Falha na rotina diária.');
        }
    });

    logger.info('📅 Rotina Cron ativada: Agendado para as 03:00 AM todos os dias.');
}

module.exports = { startCronJob };
