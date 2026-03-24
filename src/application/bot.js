const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { saveLead } = require('../infrastructure/storage');
const { generateAIResponse, clearChatSession } = require('../infrastructure/ai');
const logger = require('../infrastructure/logger');
require('dotenv').config();

// Conjunto para rastrear clientes já repassados para atendimento humano
const handedOver = new Set();

async function startBot() {
    logger.info('🚀 Inicializando WhatsApp Bot (whatsapp-web.js)...');

    const client = new Client({
        authStrategy: new LocalAuth({ dataPath: './auth_session' }),
        puppeteer: {
            headless: true,
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
                '--single-process'
            ]
        }
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

        // Se foi um logout explícito, limpa a sessão salva para gerar novo QR
        if (reason === 'LOGOUT' || reason === 'NAVIGATION') {
            console.log('🗑️  Sessão encerrada. Limpando dados de autenticação...');
            const fs = require('fs').promises;
            try {
                await fs.rm('./auth_session', { recursive: true, force: true });
                console.log('✅ Sessão limpa. Reiniciando e gerando novo QR Code...\n');
            } catch { /* pasta já não existe */ }
        } else {
            console.log('⏳ Tentando reconectar em 5 segundos...');
        }

        setTimeout(() => startBot(), 5000);
    });

    // Escuta novas mensagens
    client.on('message', async (msg) => {
        // Ignora mensagens recebidas enquanto o bot estava desligado (mais de 60 segundos atrás) para evitar sobrecarregar a cota gratuita do Google
        if (msg.timestamp < (Date.now() / 1000) - 60) {
            logger.debug({ msgId: msg.id._serialized }, '⏳ Ignorando mensagem antiga');
            return;
        }

        // Ignora mensagens de grupos, status e newsletters
        if (msg.from.endsWith('@g.us') || msg.from === 'status@broadcast' || msg.from.endsWith('@newsletter')) return;
        // Ignora mensagens enviadas por nós mesmos
        if (msg.fromMe) return;

        const phone = msg.from.replace('@c.us', '');
        const contact = await msg.getContact();
        const pushName = contact.pushname || contact.name || 'Desconhecido';

        // 🛡️ FILTRO DE AGENDA: Ignora contatos já salvos no celular
        if (contact.isMyContact) {
            logger.debug({ phone, pushName }, '👤 Contato na agenda. Ignorando.');
            return;
        }

        // 🛡️ SE MANDAR ÁUDIO OU IMAGEM, O BOT PARA DE RESPONDER (Handoff silencioso)
        if (msg.hasMedia || msg.type === 'audio' || msg.type === 'ptt' || msg.type === 'image' || msg.type === 'video') {
            logger.info({ phone }, '⚠️ Mídia/Áudio recebido. Parando responder.');
            handedOver.add(phone);
            return;
        }

        console.log(`📩 Nova mensagem de: ${pushName} (${phone})`);

        if (handedOver.has(phone)) {
            console.log(`💁 Atendimento humano atuando para ${phone}. Ignorando IA.`);
            return;
        }

        try {
            // Tenta salvar o lead (a função cuida de verificar se já existe hoje)
            await saveLead(phone, pushName);
        } catch (err) {
            logger.error({ phone, error: err.message }, '⚠️ Erro ao salvar no Supabase');
        }

        logger.info({ phone, pushName }, '🤖 Processando resposta IA');
        
        // Simula "digitando..."
        const chat = await msg.getChat();
        await chat.sendStateTyping();

        // Gera a resposta com a inteligência da Groq (que agora retorna um objeto validado pelo Zod)
        const data = await generateAIResponse(phone, msg.body);
        
        const messageToClient = data.reply || "Como posso te ajudar?";
        
        // Simula tempo de digitação humana
        await chat.sendStateTyping();
        const pauseTime = Math.min(Math.max(messageToClient.length * 20, 2000), 5000);
        await new Promise(r => setTimeout(r, pauseTime));

        await msg.reply(messageToClient);
        logger.info({ phone, class: data.classificacao, score: data.lead_score }, '✅ Resposta IA enviada');

        // Verifica transições de estado para Handoff ou Encerramento
        if (data.estado === 'PRONTO_PARA_FECHAMENTO') {
             logger.warn({ phone, class: data.classificacao }, '🔥 LEAD QUENTE: Pronto para fechamento');
             handedOver.add(phone); // Muta o bot para este cliente
        } else if (data.estado === 'ENCERRADO') {
             logger.info({ phone }, '🧊 LEAD ENCERRADO');
             handedOver.add(phone);
             clearChatSession(phone);
        }
    });

    client.initialize();
    return client;
}

module.exports = { startBot };
