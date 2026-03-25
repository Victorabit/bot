const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const HANDOFF_FILE = path.join(process.cwd(), 'handoff_persistence.json');

/**
 * Gerencia a persistência da lista de handoff (atendimento humano).
 * Garante que o bot lembre quem está sob atendimento humano mesmo após reiniciar.
 */
class HandoffManager {
    constructor() {
        this.handedOver = new Set();
        this.load();
    }

    /**
     * Carrega a lista do arquivo JSON
     */
    load() {
        try {
            if (fs.existsSync(HANDOFF_FILE)) {
                const data = fs.readFileSync(HANDOFF_FILE, 'utf8');
                const list = JSON.parse(data);
                if (Array.isArray(list)) {
                    this.handedOver = new Set(list);
                    logger.info({ count: this.handedOver.size }, '📦 Lista de Handoff carregada do armazenamento persistente.');
                }
            }
        } catch (error) {
            logger.error({ error: error.message }, '⚠️ Erro ao carregar persistência de handoff');
            this.handedOver = new Set();
        }
    }

    /**
     * Salva a lista atual no arquivo JSON
     */
    save() {
        try {
            const data = JSON.stringify(Array.from(this.handedOver));
            fs.writeFileSync(HANDOFF_FILE, data, 'utf8');
        } catch (error) {
            logger.error({ error: error.message }, '⚠️ Erro ao salvar persistência de handoff');
        }
    }

    /**
     * Adiciona um número à lista de handoff
     */
    add(phone) {
        if (!this.handedOver.has(phone)) {
            this.handedOver.add(phone);
            this.save();
            logger.debug({ phone }, '👤 Contato adicionado ao Handoff (Persistente)');
        }
    }

    /**
     * Verifica se um número está em handoff
     */
    has(phone) {
        return this.handedOver.has(phone);
    }

    /**
     * Remove um número da lista
     */
    remove(phone) {
        if (this.handedOver.delete(phone)) {
            this.save();
            logger.debug({ phone }, '👤 Contato removido do Handoff (Persistente)');
        }
    }

    /**
     * Limpa toda a lista
     */
    clear() {
        this.handedOver.clear();
        this.save();
        logger.info('🧹 Lista de Handoff persistente limpa.');
    }
}

module.exports = new HandoffManager();
