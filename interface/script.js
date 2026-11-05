/* Painel original: consome apenas respostas reais da API local. */
'use strict';
const $ = id => document.getElementById(id);
const botoes = [...document.querySelectorAll('button[data-comando]')];
let disponivel = false;
let atualizando = false;

async function obterJson(url, configuracao = {}) {
  const resposta = await fetch(url, { cache: 'no-store', ...configuracao });
  const dados = await resposta.json();
  if (!resposta.ok) throw new Error(dados.erro || 'Falha na requisicao');
  return dados;
}
function texto(id, valor) { $(id).textContent = String(valor); }
function tituloUmidade(v) { return v < 40 ? 'Solo seco' : v >= 70 ? 'Solo úmido' : 'Faixa intermediária'; }
function mostrarHistorico(eventos) {
  const lista = $('lista-historico');
  lista.replaceChildren();
  if (!eventos.length) {
    const li = document.createElement('li');
    li.className = 'sem-eventos';
    li.textContent = 'Aguardando eventos do ESP32.';
    lista.append(li);
    return;
  }
  for (const evento of eventos.slice(0, 25)) {
    const li = document.createElement('li');
    const tipo = document.createElement('span');tipo.className = 'item-tipo';tipo.textContent = evento.tipo;
    const desc = document.createElement('p');desc.textContent = evento.descricao;
    const quando = document.createElement('time');quando.textContent = new Date(evento.data).toLocaleString('pt-BR');
    li.append(tipo, desc, quando);
    lista.append(li);
  }
}
function renderizarStatus(dados) {
  const t = dados.telemetria;
  disponivel = Boolean(dados.conectado);
  $('conexao').className = `conexao ${disponivel ? 'online' : 'offline'}`;
  texto('conexao', disponivel ? '● ESP32 conectado' : '● ESP32 desconectado');
  texto('texto-conexao', disponivel ? 'Conectado' : 'Desconectado');
  texto('ultima-atualizacao', dados.ultimaAtualizacao ? new Date(dados.ultimaAtualizacao).toLocaleString('pt-BR') : 'Nunca');
  texto('pendentes', `Comandos pendentes: ${dados.comandosPendentes}`);
  const ultimo = dados.ultimoComando;
  texto('ultimo-comando', ultimo ? `Último comando: ${ultimo.comando} — ${ultimo.situacao}` : 'Último comando: nenhum');
  const atual = disponivel && t;
  const umidadeOk = atual && t.leitura_valida;
  texto('umidade', umidadeOk ? t.umidade : '--');
  texto('estado-solo', !disponivel ? 'Sem leitura atual' : !t?.leitura_valida ? 'Sensor inválido' : tituloUmidade(t.umidade));
  texto('adc', atual ? `ADC: ${t.adc}` : 'ADC atual: --');
  $('barra').style.width = umidadeOk ? `${t.umidade}%` : '0%';
  $('barra-externa').setAttribute('aria-valuenow', umidadeOk ? String(t.umidade) : '0');
  texto('irrigacao', atual ? (t.irrigando ? 'Ligada' : 'Desligada') : 'Indisponível');
  $('irrigacao').className = `estado-grande ${!atual ? 'indisponivel' : t.irrigando ? 'ligada' : 'desligada'}`;
  texto('modo', atual ? `Modo: ${t.modo === 'automatico' ? 'Automático' : 'Manual'}` : 'Modo: --');
  texto('bloqueio', atual ? `Bloqueio por tempo: ${t.bloqueio_tempo ? 'ATIVO' : 'inativo'}` : 'Bloqueio: sem dado atual');
  texto('leitura-status', atual ? `Leitura: ${t.leitura_valida ? 'válida' : 'INVÁLIDA'}${t.falha_teste ? ' (falha simulada)' : ''}` : 'Leitura do sensor: --');
  botoes.forEach(botao => { botao.disabled = !disponivel; });
  const aviso = $('alerta');
  if (!disponivel) {
    aviso.className = 'alerta erro';
    aviso.textContent = dados.ultimaAtualizacao ? 'ESP32 offline. Os valores antigos foram ocultados; a data da última recepção continua visível.' : 'Aguardando telemetria real do ESP32. Nenhuma leitura fictícia será exibida.';
  } else if (!t.leitura_valida || t.bloqueio_tempo) {
    aviso.className = 'alerta';
    aviso.textContent = t.bloqueio_tempo ? 'Bloqueio de segurança ativo: somente após verificar as condições utilize REARMAR.' : 'Falha de leitura: ESP32 deve manter a irrigação desligada.';
  } else {
    aviso.className = 'alerta sucesso';
    aviso.textContent = 'Dados recebidos do ESP32. Controle local de irrigação funcionando de forma independente do painel.';
  }
}
async function atualizar() {
  if (atualizando) return;
  atualizando = true;
  try {
    const [status, historico] = await Promise.all([obterJson('/api/status'), obterJson('/api/historico')]);
    renderizarStatus(status);
    mostrarHistorico(historico.eventos || []);
  } catch (erro) {
    disponivel = false;
    renderizarStatus({ conectado: false, ultimaAtualizacao: null, telemetria: null, comandosPendentes: 0, ultimoComando: null });
    $('alerta').textContent = `Falha ao consultar o servidor: ${erro.message}`;
  } finally { atualizando = false; }
}
for (const botao of botoes) {
  botao.addEventListener('click', async () => {
    const comando = botao.dataset.comando;
    const token = $('token').value.trim();
    if (!token) { texto('resposta-comando', 'Informe o token de controle para enviar comandos.'); $('token').focus(); return; }
    if (!disponivel) { texto('resposta-comando', 'ESP32 offline. Comando nao enviado.'); return; }
    botoes.forEach(b => b.disabled = true);
    try {
      const resposta = await obterJson('/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-control-token': token }, body: JSON.stringify({ comando }) });
      texto('resposta-comando', `${comando} solicitado (#${resposta.id}). Aguardando confirmacao do ESP32.`);
      await atualizar();
    } catch (erro) { texto('resposta-comando', `Comando não enviado: ${erro.message}`); }
    finally { botoes.forEach(b => b.disabled = !disponivel); }
  });
}
atualizar();
setInterval(atualizar, 2000);
