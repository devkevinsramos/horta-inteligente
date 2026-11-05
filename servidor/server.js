/*
  Horta Inteligente — servidor Node.js sem dependencias externas.
  Escolha deliberada: substituir Express para simplificar a entrega e permitir
  executar imediatamente no Windows com Node 20+. As rotas permanecem HTTP/JSON.
  Dados reais chegam somente do ESP32; nunca sao geradas medidas artificiais.
*/
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

function carregarEnv(arquivo = path.join(__dirname, '.env')) {
  if (!fs.existsSync(arquivo)) return;
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const texto = linha.trim();
    if (!texto || texto.startsWith('#')) continue;
    const indice = texto.indexOf('=');
    if (indice <= 0) continue;
    const chave = texto.slice(0, indice).trim();
    let valor = texto.slice(indice + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) valor = valor.slice(1, -1);
    if (/^[A-Z_][A-Z_0-9]*$/.test(chave) && process.env[chave] == null) process.env[chave] = valor;
  }
}

const DISPOSITIVO = 'horta-esp32-01';
const OFFLINE_MS = 8000;
const COMANDO_TTL_MS = 20000;
const COMANDOS = new Set(['AUTO', 'MANUAL', 'LIGAR', 'DESLIGAR', 'RESET', 'FALHA', 'NORMAL']);
const MIMES = { '/': 'text/html; charset=utf-8', '/index.html': 'text/html; charset=utf-8', '/style.css': 'text/css; charset=utf-8', '/script.js': 'application/javascript; charset=utf-8' };

function autenticar(recebido, esperado) {
  if (typeof recebido !== 'string' || !esperado || !recebido || recebido.length > 256) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function responder(res, status, objeto) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(objeto));
}
function jsonBody(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.setEncoding('utf8');
    req.on('data', bloco => {
      dados += bloco;
      if (Buffer.byteLength(dados, 'utf8') > 8192) { reject({ status: 413, erro: 'JSON muito grande' }); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(dados)); }
      catch { reject({ status: 400, erro: 'JSON invalido' }); }
    });
    req.on('error', reject);
  });
}

function criarServidor({ deviceToken = process.env.DEVICE_TOKEN, controlToken = process.env.CONTROL_TOKEN } = {}) {
  if (!deviceToken || !controlToken || deviceToken === controlToken || deviceToken.includes('SUBSTITUA') || controlToken.includes('SUBSTITUA')) {
    throw new Error('Configure DEVICE_TOKEN e CONTROL_TOKEN diferentes no arquivo servidor/.env ou ambiente.');
  }

  let telemetria = null;
  let recebidaEm = 0;
  let fila = [];
  let idProximo = 1;
  let ultimoComando = null;
  let historico = [];
  function registrar(tipo, descricao, id) {
    historico.unshift({ data: new Date().toISOString(), tipo, descricao, ...(id ? { id } : {}) });
    if (historico.length > 100) historico = historico.slice(0, 100);
  }
  function online() { return Boolean(recebidaEm && Date.now() - recebidaEm < OFFLINE_MS); }
  function descartarExpirados() {
    const agora = Date.now();
    const perdidos = fila.filter(x => agora - x.criadoEm > COMANDO_TTL_MS);
    fila = fila.filter(x => agora - x.criadoEm <= COMANDO_TTL_MS);
    for (const x of perdidos) {
      registrar('alerta', `Comando ${x.comando} expirou sem confirmacao`, x.id);
      ultimoComando = { id: x.id, comando: x.comando, situacao: 'expirado' };
    }
  }
  function telemetriaValida(t) {
    return t && !Array.isArray(t) && t.tipo === 'telemetria' && t.dispositivo === DISPOSITIVO &&
      Number.isInteger(t.tempo_ms) && t.tempo_ms >= 0 &&
      Number.isInteger(t.adc) && t.adc >= 0 && t.adc <= 4095 &&
      typeof t.leitura_valida === 'boolean' &&
      (t.leitura_valida ? Number.isInteger(t.umidade) && t.umidade >= 0 && t.umidade <= 100 : t.umidade === null) &&
      ['manual','automatico'].includes(t.modo) &&
      ['irrigando','bloqueio_tempo','falha_teste'].every(k => typeof t[k] === 'boolean');
  }

  return http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const metodo = req.method;
      if (metodo === 'GET' && Object.hasOwn(MIMES, pathname)) {
        const arquivo = path.join(__dirname, '..', 'interface', pathname === '/' ? 'index.html' : pathname.slice(1));
        try {
          const conteudo = fs.readFileSync(arquivo);
          res.writeHead(200, { 'Content-Type': MIMES[pathname], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          res.end(conteudo);
        } catch { responder(res, 404, { erro: 'Pagina nao encontrada' }); }
        return;
      }
      if (metodo === 'GET' && pathname === '/api/health') return responder(res, 200, { ok: true, servidor: 'horta-inteligente' });
      if (metodo === 'GET' && pathname === '/api/status') {
        descartarExpirados();
        return responder(res, 200, { dispositivo: DISPOSITIVO, conectado: online(), ultimaAtualizacao: recebidaEm ? new Date(recebidaEm).toISOString() : null, telemetria, comandosPendentes: fila.length, ultimoComando });
      }
      if (metodo === 'GET' && pathname === '/api/historico') return responder(res, 200, { eventos: historico });

      if (pathname.startsWith('/api/device/')) {
        if (!autenticar(req.headers['x-device-token'], deviceToken)) return responder(res, 401, { erro: 'Dispositivo nao autorizado' });
      }
      if (metodo === 'POST' && pathname === '/api/device/telemetry') {
        const t = await jsonBody(req);
        if (!telemetriaValida(t)) return responder(res, 400, { erro: 'Telemetria invalida' });
        const antiga = telemetria;
        telemetria = { tipo: 'telemetria', dispositivo: DISPOSITIVO, tempo_ms: t.tempo_ms, adc: t.adc, umidade: t.umidade, leitura_valida: t.leitura_valida, modo: t.modo, irrigando: t.irrigando, bloqueio_tempo: t.bloqueio_tempo, falha_teste: t.falha_teste };
        recebidaEm = Date.now();
        if (!antiga) registrar('sistema', 'Primeira telemetria recebida do ESP32');
        else {
          if (antiga.irrigando !== t.irrigando) registrar('irrigacao', t.irrigando ? 'Irrigacao ligada' : 'Irrigacao desligada');
          if (antiga.modo !== t.modo) registrar('modo', `Modo alterado para ${t.modo}`);
          if (!antiga.bloqueio_tempo && t.bloqueio_tempo) registrar('alerta', 'Bloqueio por tempo maximo ativado');
          if (antiga.leitura_valida && !t.leitura_valida) registrar('alerta', 'Falha de leitura do sensor (pode ser simulada)');
          if (!antiga.leitura_valida && t.leitura_valida) registrar('sistema', 'Leitura do sensor normalizada');
        }
        return responder(res, 200, { ok: true });
      }
      if (metodo === 'POST' && pathname === '/api/commands') {
        if (!autenticar(req.headers['x-control-token'], controlToken)) return responder(res, 401, { erro: 'Token de controle incorreto' });
        const body = await jsonBody(req);
        if (typeof body?.comando !== 'string' || !COMANDOS.has(body.comando)) return responder(res, 400, { erro: 'Comando nao permitido' });
        descartarExpirados();
        if (!online()) return responder(res, 409, { erro: 'ESP32 offline; comando nao enviado' });
        if (fila.length >= 12) return responder(res, 429, { erro: 'Fila cheia' });
        const item = { id: idProximo++, comando: body.comando, criadoEm: Date.now() };
        fila.push(item);
        ultimoComando = { id: item.id, comando: item.comando, situacao: 'pendente' };
        registrar('comando', `Comando ${item.comando} solicitado pelo painel`, item.id);
        return responder(res, 202, { id: item.id, comando: item.comando, situacao: 'pendente', aviso: 'Aguardando confirmacao do ESP32' });
      }
      if (metodo === 'GET' && pathname === '/api/device/next-command') {
        descartarExpirados();
        return responder(res, 200, fila.length ? { id: fila[0].id, comando: fila[0].comando } : { id: 0, comando: null });
      }
      if (metodo === 'POST' && pathname === '/api/device/ack') {
        const body = await jsonBody(req);
        descartarExpirados();
        if (!Number.isInteger(body?.id) || body.id < 1 || !['aceito', 'rejeitado'].includes(body.resultado)) return responder(res, 400, { erro: 'Confirmacao invalida' });
        if (!fila.length || fila[0].id !== body.id) return responder(res, 409, { erro: 'Comando desconhecido ou expirado' });
        const item = fila.shift();
        ultimoComando = { id: item.id, comando: item.comando, situacao: body.resultado === 'aceito' ? 'reconhecido' : 'rejeitado' };
        registrar('confirmacao', `ESP32 ${body.resultado === 'aceito' ? 'aceitou' : 'rejeitou'} o comando ${item.comando}`, item.id);
        return responder(res, 200, { ok: true });
      }
      return responder(res, 404, { erro: 'Rota nao encontrada' });
    } catch (erro) {
      if (!res.headersSent && !res.writableEnded) responder(res, erro.status || 500, { erro: erro.erro || 'Erro interno' });
    }
  });
}

if (require.main === module) {
  carregarEnv();
  try {
    const servidor = criarServidor();
    const porta = Number(process.env.PORT || 3000);
    servidor.listen(porta, '0.0.0.0', () => console.log(`Horta Inteligente: http://localhost:${porta}`));
  } catch (erro) {
    console.error(erro.message);
    process.exitCode = 1;
  }
}
module.exports = { criarServidor, carregarEnv };
