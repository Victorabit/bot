const logger = require('./logger');

/**
 * Monitora o uso de memória e força a limpeza (Garbage Collection) 
 * ou reinicia o processo se necessário.
 */
class MemoryMonitor {
    constructor(options = {}) {
        this.interval = options.interval || 300000; // 5 minutos padrão
        this.gcThreshold = options.gcThreshold || 700 * 1024 * 1024; // 700MB
        this.restartThreshold = options.restartThreshold || 900 * 1024 * 1024; // 900MB
        this.timer = null;
    }

    start() {
        logger.info('🧠 Monitor de Memória iniciado.');
        this.check();
        this.timer = setInterval(() => this.check(), this.interval);
    }

    check() {
        const mem = process.memoryUsage();
        const rssMB = Math.round(mem.rss / 1024 / 1024);
        const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);

        logger.debug(`📊 Memória: RSS: ${rssMB}MB | Heap: ${heapUsedMB}MB`);

        // Verifica se o Garbage Collection está exposto
        if (mem.rss > this.gcThreshold) {
            if (global.gc) {
                logger.warn('🧹 Memória alta (>700MB). Forçando Garbage Collection...');
                global.gc();
            } else {
                logger.warn('⚠️ Memória alta, mas --expose-gc não está ativo.');
            }
        }

        // Verifica se atingiu o limite crítico de reinicialização
        if (mem.rss > this.restartThreshold) {
            logger.fatal('🚨 LIMITE CRÍTICO DE MEMÓRIA ATINGIDO (>900MB).');
            logger.fatal('Encerrando processo para reinicialização automática...');
            
            // Dá tempo para o logger registrar e encerra
            setTimeout(() => {
                process.exit(1); // Square Cloud deve reiniciar com AUTORESTART=true
            }, 1000);
        }
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
    }
}

module.exports = new MemoryMonitor();
