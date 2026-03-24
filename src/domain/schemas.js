const { z } = require('zod');

// Schema de Validação para garantir que a IA nunca quebre o bot
// Fica na camada de DOMAIN pois representa as regras de negócio puras
const AIResponseSchema = z.object({
  lead_score: z.number().min(0).max(100),
  classificacao: z.string(),
  estado: z.enum(['EM_ATENDIMENTO', 'PRONTO_PARA_FECHAMENTO', 'ENCERRADO']),
  tentativas_sem_progresso: z.number().optional().default(0),
  resumo_lead: z.string().optional().default(''),
  intencao_detectada: z.string().optional().default(''),
  proxima_acao: z.string().optional().default(''),
  reply: z.string().min(1, "O campo reply não pode vir vazio.")
});

module.exports = { AIResponseSchema };
