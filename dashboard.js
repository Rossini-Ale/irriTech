// Aguarda o carregamento completo da página (DOM) antes de executar o script
document.addEventListener("DOMContentLoaded", () => {
  // --- 1. VERIFICAÇÃO DE AUTENTICAÇÃO E CONFIGURAÇÕES GLOBAIS ---
  const token = localStorage.getItem("authToken");
  if (!token) {
    // Se não houver token, o usuário não está logado. Redireciona para a página de login.
    window.location.href = "login.html";
    return; // Para a execução do script para evitar erros
  }

  const API_URL = "http://localhost:3000"; // URL base da sua API
  const sistemaIdAtual = 2; // Simplificação para o TCC, representando o sistema em uso

  // --- 2. SELETORES DE ELEMENTOS DO DOM ---
  // Mapeia os elementos do HTML para variáveis JavaScript para fácil acesso
  const valorUmidadeSoloEl = document.getElementById("valorUmidadeSolo");
  const valorTemperaturaArEl = document.getElementById("valorTemperaturaAr");
  const valorUmidadeArEl = document.getElementById("valorUmidadeAr");
  const statusBombaEl = document.getElementById("statusBomba");
  const cardStatusBombaEl = document.getElementById("cardStatusBomba");
  const tabelaEventosEl = document.getElementById("tabelaEventos");
  const valorETEl = document.getElementById("valorET");
  const ctx = document.getElementById("graficoHistorico").getContext("2d");
  let graficoHistorico; // Variável para a instância do gráfico

  // Elementos do Modal "Adicionar Sistema"
  const btnAbrirModalSistema = document.getElementById("btnAbrirModalSistema");
  const modalAdicionarSistemaEl = document.getElementById(
    "modalAdicionarSistema"
  );
  const formAdicionarSistema = document.getElementById("formAdicionarSistema");
  const modalSistema = new bootstrap.Modal(modalAdicionarSistemaEl);
  const selectCulturaNoModal = document.getElementById("cultura_sistema");

  // --- 3. FUNÇÕES DE CARREGAMENTO DE DADOS (API) ---

  // Função genérica para buscar dados (evita repetição de código)
  async function fetchData(endpoint) {
    const response = await fetch(`${API_URL}${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(
        `Falha na requisição para ${endpoint}: ${response.statusText}`
      );
    }
    return response.json();
  }

  // Função genérica para enviar dados (POST/PUT, etc.)
  async function postData(endpoint, body, method = "POST") {
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(
        `Falha na requisição para ${endpoint}: ${response.statusText}`
      );
    }
    return response.json();
  }

  // Busca os dados mais recentes para preencher os cards de status
  // Arquivo: dashboard.js

  // Arquivo: dashboard.js

  async function carregarDadosAtuais() {
    try {
      const dados = await fetchData(
        `/api/sistemas/${sistemaIdAtual}/dados-atuais`
      );
      console.log("DADOS RECEBIDOS PELA API NO FRONTEND:", dados);

      // Verifica e atualiza a Umidade do Solo
      if (dados.umidadeDoSolo && dados.umidadeDoSolo.valor) {
        valorUmidadeSoloEl.textContent = `${parseFloat(
          dados.umidadeDoSolo.valor
        ).toFixed(1)} %`;
      } else {
        valorUmidadeSoloEl.textContent = "-- %";
      }

      // Verifica e atualiza a Temperatura do Ar
      if (dados.temperaturaDoAr && dados.temperaturaDoAr.valor) {
        valorTemperaturaArEl.textContent = `${parseFloat(
          dados.temperaturaDoAr.valor
        ).toFixed(1)} °C`;
      } else {
        valorTemperaturaArEl.textContent = "-- °C";
      }
      // --- NOVA PARTE: Atualiza o card de ET ---
      if (dados.evapotranspiracao && dados.evapotranspiracao.valor) {
        valorETEl.textContent = `${parseFloat(
          dados.evapotranspiracao.valor
        ).toFixed(2)}`;
      } else {
        valorETEl.textContent = "--";
      }

      // Verifica e atualiza a Umidade do Ar
      if (dados.umidadeDoAr && dados.umidadeDoAr.valor) {
        valorUmidadeArEl.textContent = `${parseFloat(
          dados.umidadeDoAr.valor
        ).toFixed(1)} %`;
      } else {
        valorUmidadeArEl.textContent = "-- %";
      }

      // Atualiza o Status da Bomba
      cardStatusBombaEl.classList.remove("status-ligada", "status-desligada");
      if (dados.statusBomba === "LIGAR") {
        statusBombaEl.textContent = "Ligada";
        cardStatusBombaEl.classList.add("status-ligada");
      } else {
        statusBombaEl.textContent = "Desligada";
        cardStatusBombaEl.classList.add("status-desligada");
      }
    } catch (error) {
      console.error("Erro ao carregar dados atuais:", error);
    }
  }

  // Busca os dados históricos das últimas 24h e desenha o gráfico com Chart.js
  async function desenharGraficoHistorico() {
    try {
      const dados = await fetchData(
        `/api/sistemas/${sistemaIdAtual}/dados-historicos`
      );
      const labels = dados.map((d) =>
        new Date(d.timestamp).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
      const umidadeData = dados.map((d) => d.UmidadeDoSolo);
      const temperaturaData = dados.map((d) => d.TemperaturaDoAr);

      if (graficoHistorico) graficoHistorico.destroy();

      graficoHistorico = new Chart(ctx, {
        type: "line",
        data: {
          labels: labels,
          datasets: [
            {
              label: "Umidade do Solo (%)",
              data: umidadeData,
              borderColor: "rgba(54, 162, 235, 1)",
              yAxisID: "y",
              tension: 0.1,
            },
            {
              label: "Temperatura do Ar (°C)",
              data: temperaturaData,
              borderColor: "rgba(255, 99, 132, 1)",
              yAxisID: "y1",
              tension: 0.1,
            },
          ],
        },
        options: {
          responsive: true,
          scales: {
            y: {
              position: "left",
              title: { display: true, text: "Umidade (%)" },
            },
            y1: {
              position: "right",
              title: { display: true, text: "Temperatura (°C)" },
              grid: { drawOnChartArea: false },
            },
          },
        },
      });
    } catch (error) {
      console.error("Erro ao desenhar gráfico:", error);
    }
  }

  // Carrega a tabela com o log de eventos de irrigação
  async function carregarHistoricoEventos() {
    try {
      const eventos = await fetchData(
        `/api/sistemas/${sistemaIdAtual}/eventos`
      );
      tabelaEventosEl.innerHTML = "";
      eventos.slice(0, 10).forEach((evento) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${new Date(evento.timestamp).toLocaleString(
          "pt-BR"
        )}</td><td>${evento.acao}</td><td>${evento.motivo || "N/A"}</td>`;
        tabelaEventosEl.appendChild(tr);
      });
    } catch (error) {
      console.error("Erro ao carregar eventos:", error);
    }
  }

  // Carrega a lista de culturas para o dropdown DENTRO DO MODAL
  async function carregarCulturasNoModal() {
    try {
      const culturas = await fetchData("/api/culturas");
      selectCulturaNoModal.innerHTML = `<option value="">Selecione uma cultura (opcional)</option>`;
      culturas.forEach((cultura) => {
        const option = document.createElement("option");
        option.value = cultura.id;
        option.textContent = cultura.nome;
        selectCulturaNoModal.appendChild(option);
      });
    } catch (error) {
      console.error("Erro ao carregar culturas:", error);
      selectCulturaNoModal.innerHTML = `<option value="">Erro ao carregar</option>`;
    }
  }

  // --- 4. FUNÇÕES DE AÇÃO E CONTROLE ---

  function logout() {
    localStorage.removeItem("authToken");
    window.location.href = "login.html";
  }

  // --- 5. EVENT LISTENERS (Ouvintes de Ações do Usuário) ---

  document
    .getElementById("ligarBombaBtn")
    .addEventListener("click", () =>
      postData(`/api/sistemas/${sistemaIdAtual}/comando`, { comando: "LIGAR" })
    );
  document.getElementById("desligarBombaBtn").addEventListener("click", () =>
    postData(`/api/sistemas/${sistemaIdAtual}/comando`, {
      comando: "DESLIGAR",
    })
  );
  document.getElementById("logoutButton").addEventListener("click", logout);

  // Abre o modal para adicionar um novo sistema e carrega as culturas no dropdown
  btnAbrirModalSistema.addEventListener("click", () => {
    carregarCulturasNoModal();
    modalSistema.show();
  });

  // Envia os dados do formulário de novo sistema para a API
  formAdicionarSistema.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = {
      nome_sistema: document.getElementById("nome_sistema").value,
      thingspeak_channel_id: document.getElementById("channel_id").value,
      thingspeak_read_apikey: document.getElementById("read_api_key").value,
      cultura_id_atual: selectCulturaNoModal.value,
    };
    try {
      const result = await postData("/api/sistemas", body);
      alert(result.message);
      formAdicionarSistema.reset();
      modalSistema.hide();
    } catch (error) {
      alert(
        "Não foi possível cadastrar o sistema. Verifique os dados e tente novamente."
      );
      console.error("Erro ao adicionar sistema:", error);
    }
  });

  // --- 6. INICIALIZAÇÃO E ATUALIZAÇÃO AUTOMÁTICA ---

  function carregarTudo() {
    carregarDadosAtuais();
    desenharGraficoHistorico();
    carregarHistoricoEventos();
  }

  carregarTudo(); // Executa ao carregar a página
  setInterval(carregarDadosAtuais, 15000); // Atualiza os cards de status a cada 15 segundos
});
