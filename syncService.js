const axios = require("axios");
const cron = require("node-cron");
const pool = require("../config/db");

// --- FUNÇÃO DE CÁLCULO DE EVAPOTRANSPIRAÇÃO (MÉTODO DE CAMARGO) ---
async function calcularET_Camargo(sistema_id, connection) {
  try {
    console.log(
      `  -> Calculando ET (Camargo) para o sistema ID: ${sistema_id}`
    );

    // Tabela de radiação solar extraterrestre (Q₀) média mensal para latitude ~22°S (ex: São Paulo/Rio)
    // Valores em mm/dia. Janeiro = índice 0.
    const radiacaoSolarMensal = [
      16.0, 15.1, 13.6, 11.7, 10.2, 9.4, 9.8, 11.2, 13.0, 14.8, 15.7, 16.2,
    ];

    const hoje = new Date();
    const mesAtual = hoje.getMonth(); // 0 para Janeiro, 1 para Fevereiro, etc.
    const Q0 = radiacaoSolarMensal[mesAtual];

    // Fator de dias no mês
    const diasNoMes = new Date(hoje.getFullYear(), mesAtual + 1, 0).getDate();

    // 1. Buscar o ID do mapeamento do sensor de temperatura
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

    // 2. Buscar as leituras de temperatura das últimas 24 horas
    const [leituras] = await connection.query(
      "SELECT valor FROM Leituras WHERE mapeamento_id = ? AND timestamp >= NOW() - INTERVAL 1 DAY",
      [mapTemperatura.id]
    );
    if (leituras.length === 0) {
      console.log("     - Dados de temperatura insuficientes. Cálculo pulado.");
      return;
    }

    // 3. Calcular a Temperatura Média
    const temps = leituras.map((l) => parseFloat(l.valor));
    const tMed = temps.reduce((a, b) => a + b, 0) / temps.length;

    if (isNaN(tMed)) {
      console.log(
        "     - Erro no cálculo da temperatura média. Cálculo pulado."
      );
      return;
    }

    // 4. Aplicar a fórmula de Camargo: ET (mm/mês) = 0.01 * Tmed * Q₀ * F
    const etCalculadoMensal = 0.01 * tMed * Q0 * diasNoMes;

    if (isNaN(etCalculadoMensal)) {
      console.log(
        "     - Erro no cálculo final da ET. Inserção no banco pulada."
      );
      return;
    }

    // 5. Converter o resultado para mm/dia para manter o padrão do sistema
    const etDiario = etCalculadoMensal / diasNoMes;
    console.log(
      `     - TMed: ${tMed.toFixed(
        2
      )}°C, Q₀: ${Q0}, F: ${diasNoMes} -> ET Diário Estimado: ${etDiario.toFixed(
        2
      )} mm/dia`
    );

    // 6. Salvar o resultado diário no banco de dados (deleta o antigo e insere o novo)
    await connection.query("DELETE FROM Calculos_ET WHERE sistema_id = ?", [
      sistema_id,
    ]);
    await connection.query(
      "INSERT INTO Calculos_ET (sistema_id, valor_et_calculado) VALUES (?, ?)",
      [sistema_id, etDiario]
    );
  } catch (error) {
    console.error(
      `     - Erro ao calcular ET (Camargo) para o sistema ${sistema_id}:`,
      error
    );
  }
}

// --- FUNÇÃO PRINCIPAL DE SINCRONIZAÇÃO E AUTOMAÇÃO ---
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
                const valorNumerico = parseFloat(fieldValue);
                if (!isNaN(valorNumerico)) {
                  await connection.query(
                    "INSERT INTO Leituras (mapeamento_id, valor, timestamp) VALUES (?, ?, ?)",
                    [map.id, valorNumerico, new Date(feed.created_at)]
                  );
                }
              }
            }
          }
          console.log(`  -> ${newFeeds.length} novas leituras salvas.`);
        } else {
          console.log(`  -> Dados do ThingSpeak já estão sincronizados.`);
        }
      }

      // 2. CÁLCULO DE EVAPOTRANSPIRAÇÃO (CHAMANDO A NOVA FUNÇÃO)
      await calcularET_Camargo(sistema.id, connection);

      // 3. LÓGICA DE AUTOMAÇÃO
      if (!sistema.cultura_id_atual) {
        console.log(`  -> Automação pulada: Nenhuma cultura selecionada.`);
        continue;
      }
      // ... (o restante do seu código da lógica de automação para ligar/desligar a bomba) ...
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
