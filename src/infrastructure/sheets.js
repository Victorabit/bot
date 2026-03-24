const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const logger = require('./logger');
require('dotenv').config();

// Inicializa a autenticação com o Google
async function getSheet() {
    // Valida variáveis de ambiente
    if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_SPREADSHEET_ID) {
        throw new Error("Credenciais do Google ausentes no arquivo .env");
    }

    const serviceAccountAuth = new JWT({
        email: process.env.GOOGLE_CLIENT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Corrige quebras de linha da chave
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
        ],
    });

    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SPREADSHEET_ID, serviceAccountAuth);
    await doc.loadInfo(); 
    return doc;
}

// Salva os leads do dia na primeira aba da planilha
async function exportLeadsToSheet(leads) {
    if (!leads || leads.length === 0) return 0;
    
    try {
        const doc = await getSheet();
        const sheet = doc.sheetsByIndex[0]; // Pega a primeira aba

        // Garante que o cabeçalho existe (Nao falha se ja existir)
        try {
            await sheet.setHeaderRow(['Data/Hora', 'Nome', 'Telefone']);
        } catch { /* Já existe o cabeçalho */ }

        // Mapeia os dados para o formato do Google Sheets
        const rows = leads.map(lead => ({
            'Data/Hora': new Date(lead.timestamp).toLocaleString('pt-BR'),
            'Nome': lead.name,
            'Telefone': lead.phone
        }));

        await sheet.addRows(rows);
        return rows.length;
    } catch (error) {
        logger.error({ error: error.message }, 'Erro ao exportar para o Google Sheets');
        throw error;
    }
}

module.exports = { exportLeadsToSheet };
