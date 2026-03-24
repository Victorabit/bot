const { generateAIResponse } = require('./src/infrastructure/ai');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function main() {
    console.log('====================================');
    console.log('🗣️ TESTANDO: ATENDENTE DA M2 CLIPS');
    console.log('====================================');
    console.log('Digite sua mensagem abaixo para conversar.');
    console.log('Pode simular ser um cliente interessado em vídeos.');
    console.log('(Digite "sair" para encerrar)\n');

    const userId = 'teste-terminal';

    const ask = () => {
        rl.question('👤 Você: ', async (input) => {
            if (input.toLowerCase() === 'sair') {
                rl.close();
                return;
            }

            console.log('🤖 Atendente digitando...');
            try {
                // generateAIResponse agora retorna um objeto validado pelo Zod
                const data = await generateAIResponse(userId, input);
                
                const messageToClient = data.reply || "...";
                
                console.log('\n🤖 ATENDENTE:');
                console.log(messageToClient);
                console.log(`\n📊 [DIAGNÓSTICO] Classe: ${data.classificacao} | Estado: ${data.estado} | Score: ${data.lead_score}`);
                console.log(`🎯 [PRÓXIMA AÇÃO] ${data.proxima_acao || 'Nenhuma'}`);
                console.log('------------------------------------');
            } catch (err) {
                console.error('❌ Erro:', err.message);
            }
            ask();
        });
    };

    ask();
}

main();
