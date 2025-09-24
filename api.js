const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// --- ROTAS PÚBLICAS (NÃO PRECISAM DE AUTENTICAÇÃO) ---
router.post("/cadastro", async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha)
      return res
        .status(400)
        .json({ message: "Todos os campos são obrigatórios." });
    const [usuariosExistentes] = await pool.query(
      "SELECT id FROM Usuarios WHERE email = ?",
      [email]
    );
    if (usuariosExistentes.length > 0)
      return res.status(409).json({ message: "Este e-mail já está em uso." });
    const salt = await bcrypt.genSalt(10);
    const senha_hash = await bcrypt.hash(senha, salt);
    const [result] = await pool.query(
      "INSERT INTO Usuarios (nome, email, senha_hash) VALUES (?, ?, ?)",
      [nome, email, senha_hash]
    );
    res.status(201).json({
      message: "Usuário cadastrado com sucesso!",
      usuarioId: result.insertId,
    });
  } catch (error) {
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha)
      return res
        .status(400)
        .json({ message: "E-mail e senha são obrigatórios." });
    const [usuarios] = await pool.query(
      "SELECT * FROM Usuarios WHERE email = ?",
      [email]
    );
    if (usuarios.length === 0)
      return res.status(401).json({ message: "E-mail ou senha incorretos." });
    const usuario = usuarios[0];
    const senhaCorresponde = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaCorresponde)
      return res.status(401).json({ message: "E-mail ou senha incorretos." });
    const token = jwt.sign(
      { id: usuario.id, email: usuario.email },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );
    res.status(200).json({ message: "Login bem-sucedido!", token });
  } catch (error) {
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
const verificarToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, process.env.JWT_SECRET, (err, usuario) => {
    if (err) return res.sendStatus(403);
    req.usuario = usuario;
    next();
  });
};
router.use(verificarToken);

// --- ROTAS PROTEGIDAS ---
router.post("/sistemas", async (req, res) => {
  try {
    const {
      nome_sistema,
      thingspeak_channel_id,
      thingspeak_read_apikey,
      cultura_id_atual,
    } = req.body;
    const usuario_id = req.usuario.id;
    if (!nome_sistema || !thingspeak_channel_id || !thingspeak_read_apikey)
      return res
        .status(400)
        .json({ message: "Todos os campos são obrigatórios." });
    const [result] = await pool.query(
      "INSERT INTO Sistemas_Irrigacao (usuario_id, nome_sistema, thingspeak_channel_id, thingspeak_read_apikey, cultura_id_atual) VALUES (?, ?, ?, ?, ?)",
      [
        usuario_id,
        nome_sistema,
        thingspeak_channel_id,
        thingspeak_read_apikey,
        cultura_id_atual || null,
      ]
    );
    res.status(201).json({
      message: "Sistema de irrigação cadastrado com sucesso!",
      sistemaId: result.insertId,
    });
  } catch (error) {
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

router.get("/culturas", async (req, res) => {
  try {
    const [culturas] = await pool.query(
      "SELECT id, nome FROM Culturas ORDER BY nome ASC"
    );
    res.json(culturas);
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar culturas." });
  }
});

router.put("/sistemas/:sistemaId/cultura", async (req, res) => {
  try {
    const { sistemaId } = req.params;
    const { cultura_id } = req.body;
    await pool.query(
      "UPDATE Sistemas_Irrigacao SET cultura_id_atual = ? WHERE id = ?",
      [cultura_id, sistemaId]
    );
    res
      .status(200)
      .json({ message: "Cultura do sistema atualizada com sucesso!" });
  } catch (error) {
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

router.get("/comando/:sistemaId", async (req, res) => {
  try {
    const { sistemaId } = req.params;
    const [[sistema]] = await pool.query(
      "SELECT comando_irrigacao FROM Sistemas_Irrigacao WHERE id = ?",
      [sistemaId]
    );
    if (sistema) {
      res.json({ comando: sistema.comando_irrigacao });
      if (sistema.comando_irrigacao === "LIGAR") {
        await pool.query(
          "UPDATE Sistemas_Irrigacao SET comando_irrigacao = 'DESLIGAR' WHERE id = ?",
          [sistemaId]
        );
      }
    } else {
      res.status(404).json({ message: "Sistema não encontrado." });
    }
  } catch (error) {
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

router.post("/sistemas/:sistemaId/comando", async (req, res) => {
  try {
    const { sistemaId } = req.params;
    const { comando } = req.body; // 'LIGAR' ou 'DESLIGAR'
    await pool.query(
      "UPDATE Sistemas_Irrigacao SET comando_irrigacao = ? WHERE id = ?",
      [comando, sistemaId]
    );
    await pool.query(
      "INSERT INTO Eventos_Irrigacao (sistema_id, acao, motivo) VALUES (?, ?, ?)",
      [sistemaId, `${comando}_MANUAL`, "Acionamento via dashboard"]
    );
    res
      .status(200)
      .json({ message: `Comando ${comando} enviado com sucesso.` });
  } catch (error) {
    res.status(500).json({ message: "Erro ao enviar comando manual." });
  }
});

// Arquivo: routes/api.js

// Função auxiliar para converter strings para o formato camelCase correto
// Ex: "Temperatura do Ar" -> "temperaturaDoAr"
function toCamelCase(str) {
  return str
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => {
      return index === 0 ? word.toLowerCase() : word.toUpperCase();
    })
    .replace(/\s+/g, "");
}

// Arquivo: routes/api.js

// Função auxiliar para converter strings para o formato camelCase correto
// Ex: "Temperatura do Ar" -> "temperaturaDoAr"
function toCamelCase(str) {
  return str
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => {
      return index === 0 ? word.toLowerCase() : word.toUpperCase();
    })
    .replace(/\s+/g, "");
}

// Rota para buscar os DADOS ATUAIS para o dashboard (VERSÃO CORRIGIDA)
router.get("/sistemas/:sistemaId/dados-atuais", async (req, res) => {
  try {
    const { sistemaId } = req.params;

    const sql = `
            SELECT mt.tipo_leitura, l.valor
            FROM Leituras l
            JOIN Mapeamento_ThingSpeak mt ON l.mapeamento_id = mt.id
            WHERE (l.mapeamento_id, l.timestamp) IN (
                SELECT mapeamento_id, MAX(timestamp)
                FROM Leituras
                GROUP BY mapeamento_id
            ) AND mt.sistema_id = ?;
        `;
    const [rows] = await pool.query(sql, [sistemaId]);

    const dadosFormatados = rows.reduce((acc, { tipo_leitura, valor }) => {
      // Usa a nova função para garantir a formatação correta
      const key = toCamelCase(tipo_leitura);
      acc[key] = { valor };
      return acc;
    }, {});

    const [[sistema]] = await pool.query(
      "SELECT comando_irrigacao FROM Sistemas_Irrigacao WHERE id = ?",
      [sistemaId]
    );
    dadosFormatados.statusBomba = sistema.comando_irrigacao;
    // --- NOVA PARTE: Adiciona o último cálculo de ET ---
    const [[ultimoET]] = await pool.query(
      "SELECT valor_et_calculado FROM Calculos_ET WHERE sistema_id = ? ORDER BY timestamp_calculo DESC LIMIT 1",
      [sistemaId]
    );

    if (ultimoET) {
      dadosFormatados.evapotranspiracao = {
        valor: ultimoET.valor_et_calculado,
      };
    }
    // --- FIM DA NOVA PARTE ---

    console.log(
      "--> API está enviando estes dados para o frontend:",
      dadosFormatados
    );
    res.json(dadosFormatados);

    // ... (fim da rota)
  } catch (error) {
    console.error("Erro na rota /dados-atuais:", error);
    res.status(500).json({ message: "Erro ao buscar dados atuais." });
  }
});

router.get("/sistemas/:sistemaId/eventos", async (req, res) => {
  try {
    const { sistemaId } = req.params;
    const [eventos] = await pool.query(
      "SELECT * FROM Eventos_Irrigacao WHERE sistema_id = ? ORDER BY timestamp DESC LIMIT 10",
      [sistemaId]
    );
    res.json(eventos);
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar eventos." });
  }
});
// Arquivo: routes/api.js

// Rota para o dashboard buscar os DADOS HISTÓRICOS para o gráfico
router.get("/sistemas/:sistemaId/dados-historicos", async (req, res) => {
  try {
    const { sistemaId } = req.params;

    // Query que busca as leituras das últimas 24 horas para um sistema específico
    const sql = `
            SELECT mt.tipo_leitura, l.valor, l.timestamp 
            FROM Leituras l 
            JOIN Mapeamento_ThingSpeak mt ON l.mapeamento_id = mt.id 
            WHERE mt.sistema_id = ? AND l.timestamp >= NOW() - INTERVAL 1 DAY 
            ORDER BY l.timestamp ASC;
        `;
    const [leituras] = await pool.query(sql, [sistemaId]);

    // O Chart.js precisa dos dados formatados. Vamos prepará-los.
    const dadosFormatados = [];
    const timestamps = [
      ...new Set(leituras.map((l) => l.timestamp.toISOString())),
    ];

    timestamps.forEach((ts) => {
      const point = { timestamp: ts };
      const leiturasNessePonto = leituras.filter(
        (l) => l.timestamp.toISOString() === ts
      );

      leiturasNessePonto.forEach((leitura) => {
        const key =
          leitura.tipo_leitura.charAt(0).toUpperCase() +
          leitura.tipo_leitura.slice(1).replace(/\s+/g, "");
        point[key] = leitura.valor;
      });
      dadosFormatados.push(point);
    });

    res.json(dadosFormatados);
  } catch (error) {
    console.error("Erro na rota /dados-historicos:", error);
    res.status(500).json({ message: "Erro ao buscar dados históricos." });
  }
});
module.exports = router;
