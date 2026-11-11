/* Painel HortaLab: usa somente leituras reais da API. Nenhum dado inventado. */
'use strict';
const $ = id => document.getElementById(id);
const nav = [...document.querySelectorAll('[data-page]')];
const comandos = [...document.querySelectorAll('button[data-comando]')];
const titulos = { resumo: 'Visão geral', controle: 'Controle', historico: 'Histórico', sistema: 'Sistema' };
const motivos = {
  nao_iniciada: 'Ainda não iniciada',
  tempo_maximo_atingido: 'Limite de tempo alcançado',
  bloqueio_de_seguranca: 'Bloqueio de segurança',
  umidade_atingiu_70_porcento: 'Solo atingiu 70% de umidade',
  sensor_invalido: 'Falha na leitura do sensor',
  troca_para_automatico: 'Troca para modo automático',
  troca_para_manual: 'Troca para modo manual',
  desligamento_manual: 'Desligamento manual',
  parada_solicitada_pelo_usuario: 'Parada solicitada pelo usuário'
};
let statusAtual = null;
let disponivel = false;
let atualizando = false;
let enviando = false;
let mensagemComando = '';
let ultimoEventoVisto = null;
let comandoAguardadoId = null;
const serie = [];

function texto(id, valor) { const el = $(id); if (el) el.textContent = String(valor); }
function formatarData(iso) { if (!iso) return 'Nunca'; const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString('pt-BR') : 'Indisponível'; }
function solo(umidade) { return umidade < 40 ? 'Solo seco • precisa de água' : umidade >= 70 ? 'Solo úmido • irrigação bloqueada' : 'Umidade intermediária'; }
function modo(t) { return t?.modo === 'automatico' ? 'Automático' : t?.modo === 'manual' ? 'Manual' : '—'; }
function setPage(id) {
  if (!Object.hasOwn(titulos, id)) return;
  document.querySelectorAll('.view').forEach(el => {
    const ativo = el.id === `view-${id}`;
    el.classList.toggle('active', ativo);
    el.hidden = !ativo;
  });
  nav.forEach(el => {
    const ativo = el.dataset.page === id;
    el.classList.toggle('active', ativo);
    if (ativo) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  texto('breadcrumb-page', titulos[id]);
  window.scrollTo({ top: 0, behavior: 'auto' });
}
nav.forEach(button => button.addEventListener('click', () => setPage(button.dataset.page)));
document.querySelectorAll('[data-ir-controle]').forEach(button => button.addEventListener('click', () => setPage('controle')));
document.querySelectorAll('[data-ir-historico]').forEach(button => button.addEventListener('click', () => setPage('historico')));
$('mostrar-token').addEventListener('click', () => {
  const input = $('token');
  input.type = input.type === 'password' ? 'text' : 'password';
  $('mostrar-token').textContent = input.type === 'password' ? 'Mostrar' : 'Ocultar';
});
$('atualizar-resumo').addEventListener('click', () => atualizar());

async function api(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const resposta = await fetch(url, { cache: 'no-store', signal: controller.signal, ...options });
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || `Erro HTTP ${resposta.status}`);
    return dados;
  } catch (erro) {
    if (erro.name === 'AbortError') throw new Error('Servidor demorou para responder. Confira o Render.');
    throw erro;
  } finally { clearTimeout(timeout); }
}
function informar(mensagem, tipo = '') {
  mensagemComando = mensagem;
  const el = $('resposta-comando');
  el.textContent = mensagem;
  el.className = `command-response ${tipo}`;
}
function atualizarDisponibilidade() {
  const t = disponivel ? statusAtual?.telemetria : null;
  comandos.forEach(botao => {
    const acao = botao.dataset.comando;
    const pendente = statusAtual?.comandoPendente;
    // RESET e DESLIGAR sempre podem substituir um comando pendente.
    let bloqueado = !disponivel || enviando || (pendente && !['DESLIGAR', 'RESET'].includes(acao) && pendente.comando !== acao);
    // O firmware rejeita LIGAR em condicoes inseguras: antecipe essa verificacao.
    if (acao === 'LIGAR' && t && (!t.leitura_valida || t.bloqueio_tempo || t.umidade >= 70)) bloqueado = true;
    // Nao permite reset com sensor invalido (o ESP32 tambem nao permite).
    if (acao === 'RESET' && t && (!t.leitura_valida || !t.bloqueio_tempo)) bloqueado = true;
    botao.disabled = bloqueado;
    if (acao === 'LIGAR' && t) {
      botao.title = t.bloqueio_tempo ? 'Rearme o bloqueio antes de ligar' : !t.leitura_valida ? 'Leitura do sensor inválida' : t.umidade >= 70 ? 'Solo úmido: irrigação bloqueada a partir de 70%' : '';
    }
  });
}
function registrarLeitura(t, marca) {
  if (!t?.leitura_valida || !Number.isFinite(t.umidade) || !marca) return;
  if (marca === ultimoEventoVisto) return;
  ultimoEventoVisto = marca;
  serie.push(t.umidade);
  if (serie.length > 80) serie.shift();
  const grafico = $('grafico-linha');
  if (!serie.length) return;
  const pontos = serie.map((v, i) => {
    const x = serie.length === 1 ? 320 : i * 640 / (serie.length - 1);
    return `${x.toFixed(1)},${(180 - v * 1.6).toFixed(1)}`;
  }).join(' ');
  grafico.setAttribute('points', pontos);
  $('grafico-vazio').style.display = serie.length > 1 ? 'none' : 'grid';
  if (serie.length === 1) $('grafico-vazio').textContent = 'Coletando mais leituras para criar o gráfico…';
}
function alerta(classe, mensagem) {
  $('alerta').className = `notice ${classe}`;
  texto('alerta-texto', mensagem);
}
function renderizarStatus(dados) {
  statusAtual = dados;
  disponivel = Boolean(dados?.conectado && dados?.telemetria);
  const t = disponivel ? dados.telemetria : null;
  const val = t && t.leitura_valida && Number.isFinite(t.umidade);
  const nomeModo = modo(t);
  $('status-conexao').className = `status-chip ${disponivel ? 'online' : 'offline'}`;
  texto('status-conexao-texto', disponivel ? 'ESP32 conectado' : 'ESP32 offline');
  texto('dispositivo-resumo', disponivel ? 'Online' : 'Offline');
  texto('ultima-atualizacao-resumo', dados.ultimaAtualizacao ? `Último contato: ${new Date(dados.ultimaAtualizacao).toLocaleTimeString('pt-BR')}` : 'Sem sincronização');
  texto('umidade', val ? t.umidade : '—');
  texto('solo-descricao', val ? solo(t.umidade) : 'Sem leitura atual');
  $('umidade-bar').style.width = val ? `${t.umidade}%` : '0%';
  $('umidade-meter').setAttribute('aria-valuenow', val ? String(t.umidade) : '0');
  texto('irrigacao-resumo', t ? (t.irrigando ? 'Ligada' : 'Desligada') : 'Indisponível');
  texto('irrigacao-subtexto', t ? (t.irrigando ? 'Bomba em funcionamento' : 'Bomba parada') : 'Sem dados do ESP32');
  $('pump-dot').style.color = t?.irrigando ? '#18a16c' : '#97a89d';
  texto('modo-resumo', nomeModo);
  texto('modo-descricao', t?.modo === 'automatico' ? 'Regras de umidade ativas' : t ? 'Operação sob comando' : 'Aguardando conexão');
  texto('controle-modo', `Modo: ${nomeModo}`);
  texto('controle-irrigacao', t ? (t.irrigando ? 'Irrigando agora' : 'Irrigação parada') : 'Aguardando ESP32');
  texto('controle-irrigacao-info', t ? (t.irrigando ? 'Relé acionado pelo ESP32' : 'Relé desativado pelo ESP32') : 'Os comandos precisam ser confirmados pelo dispositivo.');
  for (const acao of ['AUTO', 'MANUAL']) {
    const marcado = Boolean(t && t.modo === (acao === 'AUTO' ? 'automatico' : 'manual'));
    const botao = document.querySelector(`button.mode-option[data-comando="${acao}"]`);
    botao.classList.toggle('selected', marcado);
    texto(`indicador-${acao.toLowerCase()}`, marcado ? '✓ Modo selecionado' : 'Selecionar modo');
  }
  texto('status-sensor', t ? (t.leitura_valida ? 'Leitura válida' : 'Leitura inválida') : 'Sem leitura');
  texto('status-bloqueio', t ? (t.bloqueio_tempo ? 'Ativo • rearme necessário' : 'Inativo') : '—');
  texto('motivo-parada', t && !t.irrigando ? (motivos[t.motivo_parada] || (t.motivo_parada ? t.motivo_parada.replaceAll('_', ' ') : '—')) : '—');
  const maximo = t?.tempo_maximo_ms ?? 30000;
  const restante = t?.irrigando && typeof t.tempo_restante_ms === 'number' ? t.tempo_restante_ms : 0;
  texto('tempo-restante', t?.irrigando ? `${Math.ceil(restante / 1000)} s` : '—');
  texto('tempo-maximo', `${Math.round(maximo / 1000)} s`);
  $('tempo-restante-bar').style.width = t?.irrigando && maximo > 0 ? `${100 * restante / maximo}%` : '0%';
  texto('sistema-conexao', disponivel ? 'Conectado' : 'Desconectado');
  texto('sistema-atualizacao', formatarData(dados.ultimaAtualizacao));
  texto('sistema-adc', t ? t.adc : '—');
  texto('sistema-pendentes', dados.comandosPendentes ?? 0);
  const pendente = dados.comandoPendente;
  if (pendente && !comandoAguardadoId) {
    informar(`Comando ${pendente.comando} aguardando confirmação do ESP32 (até ${pendente.segundosRestantes}s). Você pode Parar ou Rearmar.`, '');
  }
  texto('sistema-comando', dados.ultimoComando?.comando || 'Nenhum');
  texto('sistema-confirmacao', dados.ultimoComando?.situacao || '—');
  texto('sistema-modo', nomeModo);
  texto('sistema-falha', t ? (t.falha_teste ? 'Sim' : 'Não') : '—');
  registrarLeitura(t, dados.ultimaAtualizacao);
  if (comandoAguardadoId && dados.ultimoComando?.id === comandoAguardadoId && dados.ultimoComando.situacao !== 'pendente') {
    const situacao = dados.ultimoComando.situacao;
    informar(situacao === 'reconhecido' ? `${dados.ultimoComando.comando} confirmado pelo ESP32.` : `${dados.ultimoComando.comando}: ${situacao}. Verifique a segurança e a conexão.`, situacao === 'reconhecido' ? 'ok' : 'error');
    comandoAguardadoId = null;
  }
  atualizarDisponibilidade();

  if (!disponivel) {
    alerta('notice-error', dados.ultimaAtualizacao ? `ESP32 desconectado. Último contato: ${formatarData(dados.ultimaAtualizacao)}. Inicie o Wokwi e confira os tokens.` : 'Sem telemetria do ESP32. Inicie a simulação no Wokwi e confirme a conexão com o Render.');
  } else if (!dados.canalControleAtivo) {
    alerta('notice-warning', 'O ESP32 envia telemetria, mas não está consultando comandos. Atualize o sketch.ino no Wokwi, mantenha a simulação ligada e confira o Monitor Serial.');
  } else if (!t.leitura_valida) {
    alerta('notice-error', 'Sensor inválido: o ESP32 mantém a irrigação desligada. Use Restaurar sensor se a falha foi simulada.');
  } else if (t.bloqueio_tempo) {
    alerta('notice-warning', `Irrigação parada pelo limite de ${Math.round(maximo / 1000)} segundos. Para continuar, verifique a segurança e clique em Rearmar proteção.`);
  } else if (t.umidade >= 70) {
    alerta('notice-warning', 'Solo com umidade igual ou maior que 70%. O ESP32 impede o acionamento para evitar excesso de irrigação.');
  } else {
    alerta('notice-success', 'Comunicação ativa. O controle está disponível e as proteções do ESP32 permanecem habilitadas.');
  }
}
function criarEvento(evento) {
  const row = document.createElement('div');
  row.className = `event-row ${evento.tipo === 'alerta' ? 'alerta' : ''}`;
  const glyph = document.createElement('span'); glyph.className = 'event-glyph';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', evento.tipo === 'alerta' ? '#ic-info' : '#ic-activity'); svg.append(use); glyph.append(svg);
  const conteudo = document.createElement('div');
  const titulo = document.createElement('p'); titulo.className = 'event-name'; titulo.textContent = evento.tipo === 'alerta' ? 'Alerta' : evento.tipo === 'comando' ? 'Comando' : evento.tipo === 'irrigacao' ? 'Irrigação' : evento.tipo === 'confirmacao' ? 'Confirmação' : 'Sistema';
  const descricao = document.createElement('p'); descricao.textContent = evento.descricao;
  const data = document.createElement('time'); data.textContent = formatarData(evento.data);
  conteudo.append(titulo, descricao, data); row.append(glyph, conteudo);
  return row;
}
function renderizarEventos(eventos) {
  const recentes = $('atividade-recente'); const todos = $('lista-historico');
  recentes.replaceChildren(); todos.replaceChildren();
  if (!eventos?.length) {
    for (const lista of [recentes, todos]) {
      const el = document.createElement('p'); el.className = 'empty-text'; el.textContent = 'Nenhum evento registrado.'; lista.append(el);
    }
    return;
  }
  for (const evento of eventos.slice(0, 4)) recentes.append(criarEvento(evento));
  for (const evento of eventos.slice(0, 100)) todos.append(criarEvento(evento));
}
async function atualizar() {
  if (atualizando) return;
  atualizando = true;
  try {
    const [s, h] = await Promise.all([api('/api/status'), api('/api/historico')]);
    renderizarStatus(s);
    renderizarEventos(h.eventos || []);
  } catch (erro) {
    renderizarStatus({ conectado: false, telemetria: null, ultimaAtualizacao: statusAtual?.ultimaAtualizacao, comandosPendentes: 0, ultimoComando: statusAtual?.ultimoComando });
    alerta('notice-error', `Não foi possível consultar a API: ${erro.message}`);
  } finally { atualizando = false; }
}
async function enviar(comando) {
  const token = $('token').value.trim();
  if (!token) { informar('Digite o CONTROL_TOKEN na seção Autorização antes de enviar.', 'error'); $('token').focus(); return; }
  if (!disponivel) { informar('ESP32 offline: nenhum comando foi enviado.', 'error'); return; }
  if (enviando) return;
  enviando = true;
  atualizarDisponibilidade();
  informar(`Enviando ${comando}…`);
  try {
    const resposta = await api('/api/commands', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-control-token': token },
      body: JSON.stringify({ comando })
    });
    comandoAguardadoId = resposta.id;
    informar(`${comando} enviado (#${resposta.id}). Aguardando confirmação do ESP32…`);
    // O ACK pode chegar alguns segundos após o HTTP 202.
    await atualizar();
  } catch (erro) {
    informar(`Não foi possível executar ${comando}: ${erro.message}`, 'error');
  } finally { enviando = false; atualizarDisponibilidade(); }
}
comandos.forEach(button => button.addEventListener('click', () => enviar(button.dataset.comando)));
function atualizarHora() {
  texto('hora-atual', new Date().toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }));
}
atualizarHora();
atualizar();
setInterval(() => { atualizarHora(); atualizar(); }, 2500);
