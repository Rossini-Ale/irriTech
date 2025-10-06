document.addEventListener("DOMContentLoaded", () => {
  // --- 1. VERIFICAÇÃO DE AUTENTICAÇÃO E CONFIGURAÇÕES ---
  const token = localStorage.getItem("authToken");
  if (!token) {
    window.location.href = "login.html";
    return;
  }

  const API_URL = "http://localhost:3000";

  let sistemaIdAtivo = null;
  let listaDeSistemas = [];

  // --- 2. SELETORES DE ELEMENTOS DO DOM ---
  const gerenciamentoSistemasEl = document.getElementById(
    "gerenciamentoSistemas"
  );
  const seletorSistemasEl = document.getElementById("seletorSistemas");
  const dashboardContentEl = document.getElementById("dashboard-content");
  const emptyStateEl = document.getElementById("empty-state");
  const nomeSistemaAtivoDisplayEl = document.getElementById(
    "nomeSistemaAtivoDisplay"
  );
  const btnAdicionarPrimeiroSistema = document.getElementById(
    "btnAdicionarPrimeiroSistema"
  );
  const btnAbrirModalSistema = document.getElementById("btnAbrirModalSistema");
  const btnEditarSistema = document.getElementById("btnEditarSistema");
  const btnExcluirSistema = document.getElementById("btnExcluirSistema");
  const logoutButton = document.getElementById("logoutButton");

  const valorUmidadeSoloEl = document.getElementById("valorUmidadeSolo");
  const valorTemperaturaArEl = document.getElementById("valorTemperaturaAr");
  const valorUmidadeArEl = document.getElementById("valorUmidadeAr");
  const valorETEl = document.getElementById("valorET");
  const statusBombaEl = document.getElementById("statusBomba");
  const cardStatusBombaEl = document.getElementById("cardStatusBomba");
  const tabelaEventosEl = document.getElementById("tabelaEventos");
  const ctx = document.getElementById("graficoHistorico").getContext("2d");
  let graficoHistorico;

  const modalAdicionarSistemaEl = document.getElementById(
    "modalAdicionarSistema"
  );
  const formAdicionarSistema = document.getElementById("formAdicionarSistema");
  const modalSistema = new bootstrap.Modal(modalAdicionarSistemaEl);
  const selectCulturaNoModal = document.getElementById("cultura_sistema");

  // --- 3. FUNÇÕES AUXILIARES DE API ---
  async function fetchData(endpoint) {
    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) logout();
        throw new Error(`Falha na requisição: ${response.statusText}`);
      }
      return response.json();
    } catch (error) {
      console.error(`Erro em fetchData para ${endpoint}:`, error);
      return null;
    }
  }

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
      if (response.status === 401 || response.status === 403) logout();
      const errorData = await response.json();
      throw new Error(
        errorData.message || `Falha na requisição: ${response.statusText}`
      );
    }
    return response.json();
  }

  // --- 4. FUNÇÕES PRINCIPAIS DO DASHBOARD ---

  async function inicializarDashboard() {
    try {
      listaDeSistemas = (await fetchData("/api/sistemas")) || [];
      if (listaDeSistemas.length > 0) {
        gerenciamentoSistemasEl.classList.remove("d-none");
        dashboardContentEl.classList.remove("d-none");
        emptyStateEl.classList.add("d-none");

        popularSeletorDeSistemas();

        sistemaIdAtivo = listaDeSistemas[0].id;
        seletorSistemasEl.value = sistemaIdAtivo;

        carregarDashboardParaSistema(sistemaIdAtivo);
      } else {
        gerenciamentoSistemasEl.classList.add("d-none");
        dashboardContentEl.classList.add("d-none");
        emptyStateEl.classList.remove("d-none");
      }
    } catch (error) {
      console.error("Erro fatal ao inicializar dashboard:", error);
    }
  }

  function popularSeletorDeSistemas() {
    seletorSistemasEl.innerHTML = "";
    listaDeSistemas.forEach((sistema) => {
      const option = document.createElement("option");
      option.value = sistema.id;
      option.textContent = sistema.nome_sistema;
      seletorSistemasEl.appendChild(option);
    });
  }

  function carregarDashboardParaSistema(sistemaId) {
    if (!sistemaId) return;
    const sistemaAtivo = listaDeSistemas.find((s) => s.id == sistemaId);
    if (sistemaAtivo) {
      nomeSistemaAtivoDisplayEl.textContent = `Exibindo dados para: ${sistemaAtivo.nome_sistema}`;
    }
    carregarDadosAtuais(sistemaId);
    desenharGraficoHistorico(sistemaId); // <-- A chamada está aqui
    carregarHistoricoEventos(sistemaId);
  }

  // --- 5. FUNÇÕES DE CARREGAMENTO DE DADOS ---
  async function carregarDadosAtuais(sistemaId) {
    try {
      const dados = await fetchData(`/api/sistemas/${sistemaId}/dados-atuais`);
      if (!dados) return;
      valorUmidadeSoloEl.textContent = `${
        dados.umidadeDoSolo
          ? parseFloat(dados.umidadeDoSolo.valor).toFixed(1)
          : "--"
      } %`;
      valorTemperaturaArEl.textContent = `${
        dados.temperaturaDoAr
          ? parseFloat(dados.temperaturaDoAr.valor).toFixed(1)
          : "--"
      } °C`;
      valorUmidadeArEl.textContent = `${
        dados.umidadeDoAr
          ? parseFloat(dados.umidadeDoAr.valor).toFixed(1)
          : "--"
      } %`;
      valorETEl.textContent = `${
        dados.evapotranspiracao
          ? parseFloat(dados.evapotranspiracao.valor).toFixed(2)
          : "--"
      }`;
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

  // A DEFINIÇÃO DA FUNÇÃO ESTÁ AQUI
  async function desenharGraficoHistorico(sistemaId) {
    try {
      const dados = await fetchData(
        `/api/sistemas/${sistemaId}/dados-historicos`
      );
      if (!dados) return;
      const labels = dados.map((d) =>
        new Date(d.timestamp).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
      const umidadeData = dados.map((d) => d.umidadeDoSolo);
      const temperaturaData = dados.map((d) => d.temperaturaDoAr);

      if (graficoHistorico) graficoHistorico.destroy();

      graficoHistorico = new Chart(ctx, {
        type: "line",
        data: {
          labels,
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

  async function carregarHistoricoEventos(sistemaId) {
    try {
      const eventos = await fetchData(`/api/sistemas/${sistemaId}/eventos`);
      if (!eventos) return;
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

  async function carregarCulturasNoModal() {
    /* ...código da função... */
  }

  // --- 6. FUNÇÕES DE AÇÃO E CONTROLE ---
  function logout() {
    localStorage.removeItem("authToken");
    window.location.href = "login.html";
  }

  // --- 7. EVENT LISTENERS ---
  logoutButton.addEventListener("click", logout);
  // ... (todos os outros event listeners)

  // --- 8. INICIALIZAÇÃO ---
  inicializarDashboard();
});
