const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { saveLead } = require('../infrastructure/storage');
const { generateAIResponse, clearChatSession } = require('../infrastructure/ai');
const logger = require('../infrastructure/logger');
require('dotenv').config();

const handoffManager = require('../infrastructure/handoff');

// Instância única do cliente para evitar vazamento de memória e múltiplas respostas
let activeClient = null;
let watchdogTimer = null;

// Maps para gerenciar o buffer de mensagens (multi-bolhas)
const messageBuffers = new Map();
const bufferTimeouts = new Map();

async function startBot() {
    if (activeClient) {
        logger.info('🛑 Finalizando instância anterior antes de reiniciar...');
        try {
            await activeClient.destroy();
        } catch (e) {
            logger.error('⚠️ Erro ao destruir cliente antigo');
        }
    }

    logger.info('🚀 Inicializando WhatsApp Bot (whatsapp-web.js)...');

    activeClient = new Client({
        authStrategy: new LocalAuth({ dataPath: './auth_session' }),
        puppeteer: {
            headless: true,
            handleSIGINT: false, 
            protocolTimeout: 60000,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=site-per-process',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-extensions',
                '--disable-default-apps',
                '--mute-audio',
                '--no-default-browser-check',
                '--js-flags="--max-old-space-size=128"', 
                '--disable-renderer-backgrounding',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disk-cache-size=0',
                '--media-cache-size=0',
                '--disk-cache-dir=/dev/null',
                '--disable-software-rasterizer',
                '--disable-ipc-flooding-protection',
                '--disable-push-api-background-mode'
            ]
        }
    });

    const client = activeClient;

    // Lifecycle hooks para depuração e estabilidade
    client.on('loading_screen', (percent, message) => {
        logger.info({ percent, message }, '⏳ Carregando WhatsApp Web...');
    });

    client.on('authenticated', () => {
        logger.info('🔐 Autenticado com sucesso!');
    });

    client.on('auth_failure', (msg) => {
        logger.error({ msg }, '❌ Falha na autenticação!');
    });

    // Exibe o QR Code no terminal
    client.on('qr', (qr) => {
        logger.info({ qr }, '📲 QR Code recebido! Gerando imagem no terminal...');
        qrcode.generate(qr, { small: true });
    });

    // Confirmação de conexão
    client.on('ready', () => {
        logger.info('✅ Bot conectado e pronto para receber mensagens 24/7!');
    });

    // Reconexão automática em caso de desconexão
    client.on('disconnected', async (reason) => {
        logger.warn({ reason }, '⚠️ Bot desconectado');

        if (reason === 'LOGOUT' || reason === 'NAVIGATION') {
            console.log('🗑️  Sessão encerrada. Limpando dados de autenticação...');
            const fs = require('fs').promises;
            try {
                await fs.rm('./auth_session', { recursive: true, force: true });
                console.log('✅ Sessão limpa. Reiniciando e gerando novo QR Code...\n');
            } catch { /* pasta já não existe */ }
        }

        logger.info('⏳ Tentando reconectar em 10 segundos...');
        setTimeout(() => startBot(), 10000);
    });

    // Escuta novas mensagens
    client.on('message', async (msg) => {
        // Filtros básicos
        if (msg.timestamp < (Date.now() / 1000) - 60) return;
        if (msg.from.endsWith('@g.us') || msg.from === 'status@broadcast' || msg.from.endsWith('@newsletter')) return;
        if (msg.fromMe) return;

        const phone = msg.from.replace('@c.us', '');

        // 🛡️ FILTRO DE HANDOFF & MÍDIA
        if (handoffManager.has(phone)) return;

        if (msg.hasMedia || msg.type === 'audio' || msg.type === 'ptt' || msg.type === 'image' || msg.type === 'video') {
            logger.info({ phone }, '⚠️ Mídia/Áudio recebido. Parando responder.');
            handoffManager.add(phone);
            return;
        }

        // Proteção contra chamadas que travam (timeout de 10s para contatos)
        const contactPromise = msg.getContact();
        const contact = await Promise.race([
            contactPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout ao buscar contato')), 10000))
        ]).catch(err => {
            logger.error({ phone, error: err.message }, '⚠️ Falha ao obter contato');
            return { pushname: 'Desconhecido', isMyContact: false };
        });

        const pushName = contact.pushname || contact.name || 'Desconhecido';

        // 📝 SISTEMA DE BUFFER (MULTI-BOLHAS)
        if (!messageBuffers.has(phone)) {
            messageBuffers.set(phone, []);
        }
        messageBuffers.get(phone).push(msg.body);

        // Reinicia o cronômetro de 5 segundos a cada nova mensagem
        if (bufferTimeouts.has(phone)) {
            clearTimeout(bufferTimeouts.get(phone));
        }

        // Mostra que está digitando imediatamente
        const chat = await msg.getChat();
        chat.sendStateTyping();

        const timeout = setTimeout(async () => {
            const bubbles = messageBuffers.get(phone);
            const fullMessage = bubbles.join('\n');
            
            // Limpa o buffer para este usuário
            messageBuffers.delete(phone);
            bufferTimeouts.delete(phone);

            await processFinalMessage(client, msg, phone, pushName, fullMessage);
        }, 5000);

        bufferTimeouts.set(phone, timeout);
    });

    startWatchdog();

    client.initialize();
    return client;
}

/**
 * Processa a mensagem final (após o buffer) e envia para a IA
 */
async function processFinalMessage(client, msg, phone, pushName, fullMessage) {
    console.log(`📩 Processando combo de mensagens de: ${pushName} (${phone})`);
    
    try {
        await saveLead(phone, pushName);
    } catch (err) {
        logger.error({ phone, error: err.message }, '⚠️ Erro ao salvar no Supabase');
    }

    logger.info({ phone, pushName }, '🤖 Gerando resposta para o combo de mensagens');
    
    try {
        const chat = await msg.getChat();
        await chat.sendStateTyping();

        const data = await generateAIResponse(phone, fullMessage);
        const messageToClient = data.reply || "Como posso te ajudar?";
        
        // Simulação de tempo de digitação humana
        await chat.sendStateTyping();
        const pauseTime = Math.min(Math.max(messageToClient.length * 20, 2000), 5000);
        await new Promise(r => setTimeout(r, pauseTime));

        await msg.reply(messageToClient);
        logger.info({ phone, class: data.classificacao, score: data.lead_score }, '✅ Resposta IA enviada');

        if (data.estado === 'PRONTO_PARA_FECHAMENTO') {
             logger.warn({ phone, class: data.classificacao }, '🔥 LEAD QUENTE: Pronto para fechamento');
             handoffManager.add(phone);
        } else if (data.estado === 'ENCERRADO') {
             logger.info({ phone }, '🧊 LEAD ENCERRADO');
             handoffManager.add(phone);
             clearChatSession(phone);
        }
    } catch (err) {
        logger.error({ phone, error: err.message }, '❌ Erro ao processar resposta final');
    }
}

function clearHandedOver() {
    logger.info('🧹 Limpando lista de atendimento humano (Handoff)...');
    handoffManager.clear();
}

/**
 * Inicia vigia do navegador para garantir que o Chrome não travou
 */
function startWatchdog() {
    if (watchdogTimer) clearInterval(watchdogTimer);
    
    // Testa o navegador a cada 30 minutos
    watchdogTimer = setInterval(async () => {
        if (!activeClient) return;
        
        try {
            logger.debug('🐕 Handoff Watchdog: Verificando saúde do navegador...');
            if (global.gc) global.gc(); // Limpa memória do Node periodicamente
            await activeClient.getWWebVersion();
        } catch (error) {
            logger.fatal('🚨 NAVEGADOR NÃO RESPONDE! Reiniciando bot para recuperação...');
            startBot();
        }
    }, 1800000);
}

async function shutdownBot() {
    if (activeClient) {
        logger.info('🛑 Encerrando instância ativa do bot...');
        await activeClient.destroy();
    }
}

module.exports = { startBot, clearHandedOver, shutdownBot };
