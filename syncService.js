const axios = require("axios");
const pool = require("./db");
async function calcularET_Camargo(sistema_id, connection) {
  try {
    const radiacaoSolarMensal = [
      16.0, 15.1, 13.6, 11.7, 10.2, 9.4, 9.8, 11.2, 13.0, 14.8, 15.7, 16.2,
    ];
    const hoje = new Date();
    const mesAtual = hoje.getMonth();
    const Q0 = radiacaoSolarMensal[mesAtual];
    const diasNoMes = new Date(hoje.getFullYear(), mesAtual + 1, 0).getDate();

    const {
      rows: [mapTemperatura],
    } = await connection.query(
      "SELECT id FROM Mapeamento_ThingSpeak WHERE sistema_id = $1 AND tipo_leitura = $2",
      [sistema_id, "Temperatura do Ar"]
    );
    if (!mapTemperatura) return;

    const { rows: leituras } = await connection.query(
      "SELECT valor FROM Leituras WHERE mapeamento_id = $1 AND \"timestamp\" >= NOW() - INTERVAL '1 DAY'",
      [mapTemperatura.id]
    );
    if (leituras.length < 2) return;

    const temps = leituras.map((l) => parseFloat(l.valor));
    const tMed = temps.reduce((a, b) => a + b, 0) / temps.length;
    if (isNaN(tMed)) return;

    const etCalculadoMensal = 0.01 * tMed * Q0 * diasNoMes;
    if (isNaN(etCalculadoMensal)) return;

    const etDiario = etCalculadoMensal / diasNoMes;

    await connection.query("DELETE FROM Calculos_ET WHERE sistema_id = $1", [
      sistema_id,
    ]);
    await connection.query(
      "INSERT INTO Calculos_ET (sistema_id, valor_et_calculado) VALUES ($1, $2)",
      [sistema_id, etDiario]
    );
  } catch (error) {
    console.error(`Erro ao calcular ET para o sistema ${sistema_id}:`, error);
  }
}

async function syncAndAutomate() {
  const connection = await pool.connect();
  try {
    const { rows: sistemas } = await connection.query(
      "SELECT * FROM Sistemas_Irrigacao WHERE thingspeak_channel_id IS NOT NULL AND thingspeak_read_apikey IS NOT NULL"
    );
    if (sistemas.length === 0) {
      connection.release();
      return;
    }

    for (const sistema of sistemas) {
      const url = `https://api.thingspeak.com/channels/${sistema.thingspeak_channel_id}/feeds.json?api_key=${sistema.thingspeak_read_apikey}&results=100`;
      const response = await axios.get(url);
      const feeds = response.data.feeds || [];
      if (feeds.length > 0) {
        const {
          rows: [lastEntry],
        } = await connection.query(
          `SELECT MAX(l."timestamp") as lastTimestamp FROM Leituras l JOIN Mapeamento_ThingSpeak m ON l.mapeamento_id = m.id WHERE m.sistema_id = $1`,
          [sistema.id]
        );
        const lastTimestamp = lastEntry.lasttimestamp || new Date(0);
        const newFeeds = feeds.filter(
          (feed) => new Date(feed.created_at) > new Date(lastTimestamp)
        );

        if (newFeeds.length > 0) {
          const { rows: mapeamentos } = await connection.query(
            "SELECT * FROM Mapeamento_ThingSpeak WHERE sistema_id = $1",
            [sistema.id]
          );
          for (const feed of newFeeds) {
            for (const map of mapeamentos) {
              const fieldValue = feed[`field${map.field_number}`];
              if (fieldValue) {
                const valorNumerico = parseFloat(fieldValue);
                if (!isNaN(valorNumerico)) {
                  await connection.query(
                    'INSERT INTO Leituras (mapeamento_id, valor, "timestamp") VALUES ($1, $2, $3)',
                    [map.id, valorNumerico, new Date(feed.created_at)]
                  );
                }
              }
            }
          }
        }
      }

      await calcularET_Camargo(sistema.id, connection);

      if (!sistema.cultura_id_atual) continue;
      const {
        rows: [parametro],
      } = await connection.query(
        "SELECT valor FROM Parametros_Cultura WHERE cultura_id = $1 AND parametro = $2",
        [sistema.cultura_id_atual, "umidade_minima_gatilho"]
      );
      if (!parametro) continue;

      const umidadeMinima = parseFloat(parametro.valor);
      const {
        rows: [mapUmidade],
      } = await connection.query(
        "SELECT id FROM Mapeamento_ThingSpeak WHERE sistema_id = $1 AND tipo_leitura = $2",
        [sistema.id, "Umidade do Solo"]
      );
      if (!mapUmidade) continue;

      const {
        rows: [ultimaLeitura],
      } = await connection.query(
        'SELECT valor FROM Leituras WHERE mapeamento_id = $1 ORDER BY "timestamp" DESC LIMIT 1',
        [mapUmidade.id]
      );

      if (ultimaLeitura && parseFloat(ultimaLeitura.valor) < umidadeMinima) {
        await connection.query(
          "UPDATE Sistemas_Irrigacao SET comando_irrigacao = 'LIGAR' WHERE id = $1",
          [sistema.id]
        );
        await connection.query(
          "INSERT INTO Eventos_Irrigacao (sistema_id, acao, motivo) VALUES ($1, $2, $3)",
          [
            sistema.id,
            "LIGOU_AUTOMATICO",
            `Umidade (${ultimaLeitura.valor}) abaixo de ${umidadeMinima}%`,
          ]
        );
      } else {
        await connection.query(
          "UPDATE Sistemas_Irrigacao SET comando_irrigacao = 'DESLIGAR' WHERE id = $1",
          [sistema.id]
        );
      }
    }
  } catch (error) {
    console.error("Erro crítico durante a tarefa:", error);
  } finally {
    if (connection) connection.release();
  }
}

module.exports = { syncAndAutomate };
