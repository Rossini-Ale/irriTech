const axios = require("axios");
const cron = require("node-cron");
const pool = require("../config/db");

// --- FUNÇÃO DE CÁLCULO DE EVAPOTRANSPIRAÇÃO ---
// Arquivo: services/syncService.js

async function calcularET(sistema_id, connection) {
  try {
    console.log(`  -> Calculando ET para o sistema ID: ${sistema_id}`);

    const [[mapTemperatura]] = await connection.query(
      "SELECT id FROM Mapeamento_ThingSpeak WHERE sistema_id = ? AND tipo_leitura = ?",
      [sistema_id, "Temperatura do Ar"]
    );
    if (!mapTemperatura) {
      console.log(
        "     - Mapeamento de temperatura não encontrado. Cálculo pulado."
      );
      return;
    }

    const [leituras] = await connection.query(
      "SELECT valor FROM Leituras WHERE mapeamento_id = ? AND timestamp >= NOW() - INTERVAL 1 DAY",
      [mapTemperatura.id]
    );
    if (leituras.length < 2) {
      console.log(
        "     - Dados de temperatura insuficientes (< 24h). Cálculo pulado."
      );
      return;
    }

    const temps = leituras.map((l) => parseFloat(l.valor));
    const tMax = Math.max(...temps);
    const tMin = Math.min(...temps);
    const tMed = temps.reduce((a, b) => a + b, 0) / temps.length;

    if (isNaN(tMed)) {
      // <-- Verificação de segurança adicionada
      console.log(
        "     - Erro no cálculo da temperatura média. Cálculo pulado."
      );
      return;
    }

    const kRs = 0.16;
    const etCalculado = 0.0135 * kRs * (tMed + 17.8);

    if (isNaN(etCalculado)) {
      // <-- Verificação de segurança adicionada
      console.log(
        "     - Erro no cálculo final da ET. Inserção no banco pulada."
      );
      return;
    }

    console.log(
      `     - TMax: ${tMax.toFixed(2)}, TMin: ${tMin.toFixed(
        2
      )}, TMed: ${tMed.toFixed(2)} -> ET Calculado: ${etCalculado.toFixed(
        2
      )} mm/dia`
    );

    await connection.query(
      "INSERT INTO Calculos_ET (sistema_id, valor_et_calculado) VALUES (?, ?)",
      [sistema_id, etCalculado]
    );
  } catch (error) {
    console.error(
      `     - Erro ao calcular ET para o sistema ${sistema_id}:`,
      error
    );
  }
}

// --- FUNÇÃO PRINCIPAL DE SINCRONIZAÇÃO E AUTOMAÇÃO (VERSÃO ÚNICA E CORRETA) ---
async function syncAndAutomate() {
  console.log(
    `[${new Date().toLocaleString(
      "pt-BR"
    )}] Iniciando tarefa de automação e sincronização...`
  );
  const connection = await pool.getConnection();
  try {
    const [sistemas] = await connection.query(
      "SELECT * FROM Sistemas_Irrigacao WHERE thingspeak_channel_id IS NOT NULL AND thingspeak_read_apikey IS NOT NULL"
    );
    if (sistemas.length === 0) {
      console.log("Nenhum sistema configurado para sincronizar.");
      connection.release();
      return;
    }

    for (const sistema of sistemas) {
      console.log(
        `--- Processando sistema: "${sistema.nome_sistema}" (ID: ${sistema.id}) ---`
      );

      // 1. SINCRONIZAÇÃO DE DADOS
      const url = `https://api.thingspeak.com/channels/${sistema.thingspeak_channel_id}/feeds.json?api_key=${sistema.thingspeak_read_apikey}&results=100`;
      const response = await axios.get(url);
      const feeds = response.data.feeds || [];
      if (feeds.length > 0) {
        const [lastEntries] = await connection.query(
          `SELECT MAX(l.timestamp) as lastTimestamp FROM Leituras l JOIN Mapeamento_ThingSpeak m ON l.mapeamento_id = m.id WHERE m.sistema_id = ?`,
          [sistema.id]
        );
        const lastTimestamp = lastEntries[0].lastTimestamp || new Date(0);
        const newFeeds = feeds.filter(
          (feed) => new Date(feed.created_at) > new Date(lastTimestamp)
        );

        if (newFeeds.length > 0) {
          const [mapeamentos] = await connection.query(
            "SELECT * FROM Mapeamento_ThingSpeak WHERE sistema_id = ?",
            [sistema.id]
          );
          for (const feed of newFeeds) {
            for (const map of mapeamentos) {
              const fieldValue = feed[`field${map.field_number}`];
              if (fieldValue) {
                await connection.query(
                  "INSERT INTO Leituras (mapeamento_id, valor, timestamp) VALUES (?, ?, ?)",
                  [map.id, parseFloat(fieldValue), new Date(feed.created_at)]
                );
              }
            }
          }
          console.log(`  -> ${newFeeds.length} novas leituras salvas.`);
        } else {
          console.log(`  -> Dados do ThingSpeak já estão sincronizados.`);
        }
      }

      // 2. CÁLCULO DE EVAPOTRANSPIRAÇÃO
      await calcularET(sistema.id, connection);

      // 3. LÓGICA DE AUTOMAÇÃO
      if (!sistema.cultura_id_atual) {
        console.log(`  -> Automação pulada: Nenhuma cultura selecionada.`);
        continue;
      }
      // ... (resto do código da lógica de automação) ...
    }
  } catch (error) {
    console.error("Erro crítico durante a tarefa:", error);
  } finally {
    if (connection) connection.release();
    console.log("Tarefa de sincronização e automação finalizada.");
  }
}

// --- FUNÇÃO PARA INICIAR O AGENDADOR ---
function startSyncSchedule() {
  cron.schedule("*/5 * * * *", syncAndAutomate);
  console.log(
    "Agendador de automação e sincronização iniciado. Tarefa rodará a cada 5 minutos."
  );
  syncAndAutomate();
}

module.exports = { startSyncSchedule };
