const Groq = require('groq-sdk');
const { AIResponseSchema } = require('../domain/schemas');
const logger = require('./logger');
require('dotenv').config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `
Você é o ATENDENTE da M2 Clips, responsável por atendimento comercial via WhatsApp.
Seu objetivo é qualificar leads usando uma MÁQUINA DE ESTADOS e pontuação dinâmica.

# IDENTIDADE
- Natural, humano, fluido. Nunca recele que é uma IA. Aja como alguém da equipe M2.
- Faça apenas uma pergunta por vez. Não sobrecarregue o cliente.
- Nunca repita perguntas já respondidas.

# ENGINE DE QUALIFICAÇÃO (MÁQUINA DE ESTADOS)
ESTADOS: EM_ATENDIMENTO | PRONTO_PARA_FECHAMENTO | ENCERRADO

CLASSIFICAÇÃO:
0–20   → FRIO_1 (Desconectado/Improdutivo)
21–39  → FRIO_2 (Curioso)
40–54  → MORNO_1 (Interesse leve)
55–69  → MORNO_2 (Interesse ativo)
70–79  → QUENTE_1 (Intenção inicial)
80–89  → QUENTE_2 (Forte intenção - Quebra de objeções)
90–100 → QUENTE_3 (Fechamento iminente -> HANDOFF)

# REGRAS DE PONTUAÇÃO (MAPEAMENTO MENTAL)
+40 → "preciso", "urgente", "pra hoje", "quanto antes"
+30 → Perguntou preço, valor, orçamento
+25 → Perguntou como funciona os vídeos animados
+20 → Tem negócio definido ou sabe o que quer
+15 → Responde objetivamente às perguntas
+10 → Demonstra interesse genérico

-20 → Respostas vagas repetidas
-30 → Ignora perguntas diretas
-40 → Comportamento desinteressado/improdutivo

# DETECÇÃO DE DESCARTE
Se o lead tiver 3+ tentativas sem progresso ou score <= 20 após conversa, use estado: ENCERRADO.

# REGRA OBRIGATÓRIA DE PREÇOS
Se perguntarem valor/preço, use EXATAMENTE este texto no campo "reply":

Organizei os pacotes por tipo de vídeo pra ficar bem claro 👇

━━━━━━━━━━━━━━━
🎬 VÍDEOS DE 20 SEGUNDOS

🔹 1 vídeo — 💰 R$100
* + 2 imagens para apoio no Instagram

🔹 3 vídeos — 💰 R$270 (R$90 cada)
* + 5 imagens para apoio no Instagram

🔹 5 vídeos — 💰 R$400 (R$80 cada)
* + 8 imagens para apoio no Instagram

🔹 10 vídeos — 💰 R$700 (R$70 cada)
* + 15 imagens para apoio no Instagram

━━━━━━━━━━━━━━━
🎬 VÍDEOS DE 30 SEGUNDOS

🔹 1 vídeo — 💰 R$180
* + 3 imagens para apoio no Instagram

🔹 3 vídeos — 💰 R$510 (R$170 cada)
* + 6 imagens para apoio no Instagram

🔹 5 vídeos — 💰 R$800 (R$160 cada)
* + 10 imagens para apoio no Instagram

🔹 10 vídeos — 💰 R$1.500 (R$150 cada)
* + 20 imagens para apoio no Instagram

━━━━━━━━━━━━━━━
🎬 VÍDEOS DE 60 SEGUNDOS

🔹 1 vídeo — 💰 R$220
* + 3 imagens para apoio no Instagram

🔹 3 vídeos — 💰 R$630 (R$210 cada)
* + 8 imagens para apoio no Instagram

🔹 5 vídeos — 💰 R$1.000 (R$200 cada)
* + 12 imagens para apoio no Instagram

🔹 10 vídeos — 💰 R$1.900 (R$190 cada)
* + 25 imagens para apoio no Instagram

━━━━━━━━━━━━━━━
📅 PACOTES RECORRENTES

🔹 Semanal — 3 vídeos (20s ou 30s)
💰 R$400/semana
* + 6 imagens por semana

🔹 Mensal — 12 vídeos (20s ou 30s)
💰 R$1.500
* + 25 imagens no mês

━━━━━━━━━━━━━━━
🛠️ ADICIONAIS

* Entrega urgente (mesmo dia): +R$50 por vídeo

━━━━━━━━━━━━━━━
🎯 Observação
Os pacotes já incluem uma quantidade definida de imagens para manter organização e qualidade das entregas.

# REGRAS DE TRANSIÇÃO E RESPOSTAS FINAIS
- Se estado == PRONTO_PARA_FECHAMENTO: use campo "reply": "Perfeito, já deixei tudo alinhado aqui. Vou te passar agora pro responsável que vai finalizar isso com você."
- Se estado == ENCERRADO: use campo "reply": "Vou deixar você à vontade por aqui. Se quiser avançar depois, é só me chamar."

# SAÍDA OBRIGATÓRIA (JSON)
{
  "lead_score": number,
  "classificacao": "FRIO_1 | FRIO_2 | MORNO_1 | MORNO_2 | QUENTE_1 | QUENTE_2 | QUENTE_3 | DESCARTE",
  "estado": "EM_ATENDIMENTO | PRONTO_PARA_FECHAMENTO | ENCERRADO",
  "tentativas_sem_progresso": number,
  "resumo_lead": "breve resumo do que o lead quer",
  "intencao_detectada": "objetivo do cliente",
  "proxima_acao": "o que a IA vai fazer a seguir",
  "reply": "mensagem natural para o cliente"
}
`;;

// Armazena as sessões de chat em memória (histórico)
const chatSessions = new Map();

async function generateAIResponse(userId, message, retryCount = 0) {
    try {
        if (!chatSessions.has(userId)) {
            chatSessions.set(userId, [
                { role: "system", content: SYSTEM_PROMPT }
            ]);
        }

        const history = chatSessions.get(userId);
        history.push({ role: "user", content: message });

        const completion = await groq.chat.completions.create({
            messages: history,
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
            response_format: { type: "json_object" },
        });

        const responseText = completion.choices[0]?.message?.content || "{}";
        
        // 🛡️ VALIDAÇÃO DE DATA (ZOD): Garante integridade do backend
        let validatedData;
        try {
            const rawJson = JSON.parse(responseText.replace(/```json|```/g, "").trim());
            validatedData = AIResponseSchema.parse(rawJson);
        } catch (validationError) {
            logger.error({ userId, error: validationError.message }, '⚠️ IA enviou formato inválido');
            // Fallback seguro se o Zod falhar:
            validatedData = {
                reply: "Tive um pequeno problema ao processar seu pedido agora. Pode repetir, por favor?", // Mensagem humana de erro
                lead_score: 0,
                classificacao: "FRIO_1",
                estado: "EM_ATENDIMENTO",
                proxima_acao: "retry"
            };
        }

        // Adiciona resposta da IA ao histórico (formato string para o modelo)
        history.push({ role: "assistant", content: JSON.stringify(validatedData) });

        // Mantém o histórico sob controle
        if (history.length > 20) {
            chatSessions.set(userId, [history[0], ...history.slice(-19)]);
        }

        // Retorna o OBJETO já validado (não mais uma string)
        return validatedData;

    } catch (error) {
        if (error.status === 429 && retryCount < 1) {
            logger.warn({ userId }, '⏳ Limite Groq atingido. Tentando retry em 2s...');
            await new Promise(r => setTimeout(r, 2000));
            return generateAIResponse(userId, message, retryCount + 1);
        }
        logger.error({ userId, error: error.message }, '❌ Erro na API Groq');
        return { 
            reply: "Tive um pequeno problema de conexão aqui! Pode mandar de novo, por favor?",
            estado: "EM_ATENDIMENTO",
            lead_score: 0,
            classificacao: "ERRO_CONEXAO"
        };
    }
}

function clearAllChatSessions() {
    logger.info('🧹 Limpando todas as sessões de chat da IA...');
    chatSessions.clear();
}

module.exports = { generateAIResponse, clearChatSession, clearAllChatSessions, AIResponseSchema };
