const express = require("express");
const router = express.Router();
const pool = require("./db");
const { syncAndAutomate } = require("./syncService");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

function toCamelCase(str) {
  if (!str) return "";
  return str
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => {
      return index === 0 ? word.toLowerCase() : word.toUpperCase();
    })
    .replace(/\s+/g, "");
}

// ROTA PARA O CRON JOB DA VERCEL
router.get("/cron", async (req, res) => {
  try {
    await syncAndAutomate();
    res.status(200).send("Cron job executado.");
  } catch (error) {
    console.error("Erro no Cron Job:", error);
    res.status(500).send("Erro ao executar o Cron Job.");
  }
});

// ROTAS PÚBLICAS
router.post("/cadastro", async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha)
      return res
        .status(400)
        .json({ message: "Todos os campos são obrigatórios." });
    const { rows: usuariosExistentes } = await pool.query(
      "SELECT id FROM Usuarios WHERE email = $1",
      [email]
    );
    if (usuariosExistentes.length > 0)
      return res.status(409).json({ message: "Este e-mail já está em uso." });
    const salt = await bcrypt.genSalt(10);
    const senha_hash = await bcrypt.hash(senha, salt);
    const { rows } = await pool.query(
      "INSERT INTO Usuarios (nome, email, senha_hash) VALUES ($1, $2, $3) RETURNING id",
      [nome, email, senha_hash]
    );
    res.status(201).json({
      message: "Usuário cadastrado com sucesso!",
      usuarioId: rows[0].id,
    });
  } catch (error) {
    console.error("Erro na rota /cadastro:", error);
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
    const { rows: usuarios } = await pool.query(
      "SELECT * FROM Usuarios WHERE email = $1",
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
    console.error("Erro na rota /login:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

// MIDDLEWARE DE AUTENTICAÇÃO
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

// ROTAS PROTEGIDAS
router.get("/sistemas", async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { rows: sistemas } = await pool.query(
      "SELECT id, nome_sistema, cultura_id_atual FROM Sistemas_Irrigacao WHERE usuario_id = $1",
      [usuario_id]
    );
    res.json(sistemas);
  } catch (error) {
    console.error("Erro na rota GET /sistemas:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

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
    const { rows } = await pool.query(
      "INSERT INTO Sistemas_Irrigacao (usuario_id, nome_sistema, thingspeak_channel_id, thingspeak_read_apikey, cultura_id_atual) VALUES ($1, $2, $3, $4, $5) RETURNING id",
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
      sistemaId: rows[0].id,
    });
  } catch (error) {
    console.error("Erro na rota POST /sistemas:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

router.get("/sistemas/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const usuario_id = req.usuario.id;
    const {
      rows: [sistema],
    } = await pool.query(
      "SELECT id, nome_sistema, thingspeak_channel_id, thingspeak_read_apikey FROM Sistemas_Irrigacao WHERE id = $1 AND usuario_id = $2",
      [id, usuario_id]
    );
    if (!sistema)
      return res.status(404).json({
        message: "Sistema não encontrado ou não pertence a este usuário.",
      });
    res.json(sistema);
  } catch (error) {
    console.error("Erro na rota GET /sistemas/:id:", error);
    res.status(500).json({ message: "Erro ao buscar detalhes do sistema." });
  }
});

router.put("/sistemas/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nome_sistema, thingspeak_channel_id, thingspeak_read_apikey } =
      req.body;
    const usuario_id = req.usuario.id;
    const { rowCount } = await pool.query(
      "UPDATE Sistemas_Irrigacao SET nome_sistema = $1, thingspeak_channel_id = $2, thingspeak_read_apikey = $3 WHERE id = $4 AND usuario_id = $5",
      [
        nome_sistema,
        thingspeak_channel_id,
        thingspeak_read_apikey,
        id,
        usuario_id,
      ]
    );
    if (rowCount === 0)
      return res.status(404).json({
        message: "Sistema não encontrado ou não pertence a este usuário.",
      });
    res.status(200).json({ message: "Sistema atualizado com sucesso!" });
  } catch (error) {
    console.error("Erro ao atualizar sistema:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

router.delete("/sistemas/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const usuario_id = req.usuario.id;
    const { rowCount } = await pool.query(
      "DELETE FROM Sistemas_Irrigacao WHERE id = $1 AND usuario_id = $2",
      [id, usuario_id]
    );
    if (rowCount === 0)
      return res.status(404).json({
        message: "Sistema não encontrado ou não pertence a este usuário.",
      });
    res.status(200).json({ message: "Sistema excluído com sucesso!" });
  } catch (error) {
    console.error("Erro ao excluir sistema:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

router.get("/culturas", async (req, res) => {
  try {
    const { rows: culturas } = await pool.query(
      "SELECT id, nome FROM Culturas ORDER BY nome ASC"
    );
    res.json(culturas);
  } catch (error) {
    console.error("Erro na rota /culturas:", error);
    res.status(500).json({ message: "Erro ao buscar culturas." });
  }
});

router.put("/sistemas/:sistemaId/cultura", async (req, res) => {
  try {
    const { sistemaId } = req.params;
    const { cultura_id } = req.body;
    const usuario_id = req.usuario.id;
    const { rowCount } = await pool.query(
      "UPDATE Sistemas_Irrigacao SET cultura_id_atual = $1 WHERE id = $2 AND usuario_id = $3",
      [cultura_id, sistemaId, usuario_id]
    );
    if (rowCount === 0)
      return res.status(404).json({
        message: "Sistema não encontrado ou não pertence a este usuário.",
      });
    res
      .status(200)
      .json({ message: "Cultura do sistema atualizada com sucesso!" });
  } catch (error) {
    console.error("Erro na rota PUT /sistemas/:sistemaId/cultura:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

router.get("/comando/:sistemaId", async (req, res) => {
  try {
    const { sistemaId } = req.params;
    const {
      rows: [sistema],
    } = await pool.query(
      "SELECT comando_irrigacao FROM Sistemas_Irrigacao WHERE id = $1",
      [sistemaId]
    );
    if (sistema) {
      res.json({ comando: sistema.comando_irrigacao });
      if (sistema.comando_irrigacao === "LIGAR") {
        await pool.query(
          "UPDATE Sistemas_Irrigacao SET comando_irrigacao = 'DESLIGAR' WHERE id = $1",
          [sistemaId]
        );
      }
    } else {
      res.status(404).json({ message: "Sistema não encontrado." });
    }
  } catch (error) {
    console.error("Erro na rota /comando/:sistemaId:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

router.post("/sistemas/:sistemaId/comando", async (req, res) => {
  try {
    const { sistemaId } = req.params;
    const { comando } = req.body;
    const usuario_id = req.usuario.id;
    const { rowCount } = await pool.query(
      "UPDATE Sistemas_Irrigacao SET comando_irrigacao = $1 WHERE id = $2 AND usuario_id = $3",
      [comando, sistemaId, usuario_id]
    );
    if (rowCount === 0)
      return res.status(404).json({ message: "Sistema não encontrado." });
    await pool.query(
      "INSERT INTO Eventos_Irrigacao (sistema_id, acao, motivo) VALUES ($1, $2, $3)",
      [sistemaId, `${comando}_MANUAL`, "Acionamento via dashboard"]
    );
    res
      .status(200)
      .json({ message: `Comando ${comando} enviado com sucesso.` });
  } catch (error) {
    console.error("Erro na rota POST /sistemas/:sistemaId/comando:", error);
    res.status(500).json({ message: "Erro ao enviar comando manual." });
  }
});

router.get("/sistemas/:sistemaId/dados-atuais", async (req, res) => {
  try {
    const { sistemaId } = req.params;
    const usuario_id = req.usuario.id;
    const {
      rows: [sistema],
    } = await pool.query(
      "SELECT id, comando_irrigacao FROM Sistemas_Irrigacao WHERE id = $1 AND usuario_id = $2",
      [sistemaId, usuario_id]
    );
    if (!sistema)
      return res.status(404).json({ message: "Sistema não encontrado." });

    const sql = `SELECT mt.tipo_leitura, l.valor FROM Leituras l JOIN Mapeamento_ThingSpeak mt ON l.mapeamento_id = mt.id WHERE (l.mapeamento_id, l."timestamp") IN (SELECT mapeamento_id, MAX("timestamp") FROM Leituras GROUP BY mapeamento_id) AND mt.sistema_id = $1;`;
    const { rows } = await pool.query(sql, [sistemaId]);
    const dadosFormatados = rows.reduce((acc, { tipo_leitura, valor }) => {
      const key = toCamelCase(tipo_leitura);
      acc[key] = { valor };
      return acc;
    }, {});
    dadosFormatados.statusBomba = sistema.comando_irrigacao;

    const {
      rows: [ultimoET],
    } = await pool.query(
      "SELECT valor_et_calculado FROM Calculos_ET WHERE sistema_id = $1 ORDER BY timestamp_calculo DESC LIMIT 1",
      [sistemaId]
    );
    if (ultimoET) {
      dadosFormatados.evapotranspiracao = {
        valor: ultimoET.valor_et_calculado,
      };
    }
    res.json(dadosFormatados);
  } catch (error) {
    console.error("Erro na rota /dados-atuais:", error);
    res.status(500).json({ message: "Erro ao buscar dados atuais." });
  }
});

router.get("/sistemas/:sistemaId/eventos", async (req, res) => {
  try {
    const { sistemaId } = req.params;
    const usuario_id = req.usuario.id;
    const { rowCount } = await pool.query(
      "SELECT id FROM Sistemas_Irrigacao WHERE id = $1 AND usuario_id = $2",
      [sistemaId, usuario_id]
    );
    if (rowCount === 0)
      return res.status(404).json({ message: "Sistema não encontrado." });
    const { rows: eventos } = await pool.query(
      'SELECT * FROM Eventos_Irrigacao WHERE sistema_id = $1 ORDER BY "timestamp" DESC LIMIT 10',
      [sistemaId]
    );
    res.json(eventos);
  } catch (error) {
    console.error("Erro na rota /eventos:", error);
    res.status(500).json({ message: "Erro ao buscar eventos." });
  }
});

router.get("/sistemas/:sistemaId/dados-historicos", async (req, res) => {
  try {
    const { sistemaId } = req.params;
    const usuario_id = req.usuario.id;
    const { rowCount } = await pool.query(
      "SELECT id FROM Sistemas_Irrigacao WHERE id = $1 AND usuario_id = $2",
      [sistemaId, usuario_id]
    );
    if (rowCount === 0)
      return res.status(404).json({ message: "Sistema não encontrado." });

    const sql = `SELECT mt.tipo_leitura, l.valor, l."timestamp" FROM Leituras l JOIN Mapeamento_ThingSpeak mt ON l.mapeamento_id = mt.id WHERE mt.sistema_id = $1 AND l."timestamp" >= NOW() - INTERVAL '1 DAY' ORDER BY l."timestamp" ASC;`;
    const { rows: leituras } = await pool.query(sql, [sistemaId]);
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
        const key = toCamelCase(leitura.tipo_leitura);
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
