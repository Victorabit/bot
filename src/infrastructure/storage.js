const { createClient } = require('@supabase/supabase-js');
const logger = require('./logger');
require('dotenv').config();

let supabase = null;

// Inicializa o cliente Supabase (só uma vez)
function getSupabase() {
    if (!supabase) {
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
            throw new Error('Credenciais do Supabase ausentes no arquivo .env');
        }
        supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    }
    return supabase;
}

// Retorna true se for o primeiro contato do dia, false se já existe
async function saveLead(phone, name) {
    const db = getSupabase();
    const today = new Date().toISOString().split('T')[0]; // ex: "2026-03-24"

    // Verifica se já mandou mensagem hoje (filtra por telefone + data de hoje)
    const { data: existing } = await db
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .gte('created_at', `${today}T00:00:00.000Z`)
        .lte('created_at', `${today}T23:59:59.999Z`)
        .single();

    if (existing) return false; // Já respondido hoje

    // Insere o novo lead
    const { error } = await db.from('leads').insert({
        phone,
        name: name || 'Desconhecido',
    });

    if (error) {
        logger.error({ phone, error: error.message }, 'Erro ao salvar lead no Supabase');
        return false;
    }

    return true; // Primeiro contato — respondeu
}

// Pega todos os leads captados hoje
async function getDailyLeads() {
    const db = getSupabase();
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await db
        .from('leads')
        .select('*')
        .gte('created_at', `${today}T00:00:00.000Z`)
        .lte('created_at', `${today}T23:59:59.999Z`)
        .order('created_at', { ascending: true });

    if (error) {
        logger.error({ error: error.message }, 'Erro ao buscar leads do Supabase');
        return [];
    }

    return data || [];
}

// Inicializa storage (compatibilidade com index.js — Supabase não precisa criar arquivo)
async function initStorage() {
    logger.info('💾 Armazenamento: usando Supabase (banco online).');
}

// No Supabase, não limpamos os leads (eles ficam lá para histórico), 
// apenas retornamos sucesso para o cron não travar.
async function clearLeads() {
    return true; 
}

module.exports = { initStorage, saveLead, getDailyLeads, clearLeads };
