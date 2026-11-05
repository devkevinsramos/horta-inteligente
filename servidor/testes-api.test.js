/* Testes de ponta a ponta das rotas HTTP usando dispositivo simulado no Node.
   NAO comprovam conexao real ESP32/Wokwi => essa prova deve ser feita no navegador. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarServidor } = require('./server');
const DEVICE_TOKEN = 'token-dispositivo-testes-fatec-aleatorio';
const CONTROL_TOKEN = 'token-controle-testes-fatec-diferente';

function telemetria(sobrescrever = {}) {
  return {
    tipo: 'telemetria', dispositivo: 'horta-esp32-01', tempo_ms: 10000,
    adc: 1550, umidade: 38, leitura_valida: true, modo: 'automatico',
    irrigando: true, bloqueio_tempo: false, falha_teste: false,
    ...sobrescrever
  };
}

test('Protocolo HTTP e painel web - 27 assercoes', async t => {
  const servidor = criarServidor({ deviceToken: DEVICE_TOKEN, controlToken: CONTROL_TOKEN });
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  t.after(() => new Promise(resolve => servidor.close(resolve)));

  async function pedido(rota, { metodo = 'GET', body, device = false, control = false, tokenErrado = false } = {}) {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (device) headers['x-device-token'] = tokenErrado ? 'errado' : DEVICE_TOKEN;
    if (control) headers['x-control-token'] = tokenErrado ? 'errado' : CONTROL_TOKEN;
    const res = await fetch(base + rota, { method: metodo, headers, body: body && JSON.stringify(body) });
    const tipo = res.headers.get('content-type') || '';
    const json = tipo.includes('application/json') ? await res.json() : await res.text();
    return { status: res.status, body: json };
  }
  const health = await pedido('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);

  const pagina = await pedido('/');
  assert.equal(pagina.status, 200);
  assert.match(pagina.body, /Horta Inteligente/);
  const css = await pedido('/style.css');
  assert.equal(css.status, 200);

  const inicial = await pedido('/api/status');
  assert.equal(inicial.body.conectado, false);
  assert.equal(inicial.body.telemetria, null);

  const offline = await pedido('/api/commands', { metodo: 'POST', body: { comando: 'LIGAR' }, control: true });
  assert.equal(offline.status, 409);
  const naoAutorizado = await pedido('/api/device/telemetry', { metodo: 'POST', body: telemetria() });
  assert.equal(naoAutorizado.status, 401);
  const invalido = await pedido('/api/device/telemetry', { metodo: 'POST', body: telemetria({ umidade: 999 }), device: true });
  assert.equal(invalido.status, 400);
  const enviado = await pedido('/api/device/telemetry', { metodo: 'POST', body: telemetria(), device: true });
  assert.equal(enviado.status, 200);

  const vivo = await pedido('/api/status');
  assert.equal(vivo.body.conectado, true);
  assert.equal(vivo.body.telemetria.umidade, 38);
  const semToken = await pedido('/api/commands', { metodo: 'POST', body: { comando: 'MANUAL' }, control: true, tokenErrado: true });
  assert.equal(semToken.status, 401);
  const desconhecido = await pedido('/api/commands', { metodo: 'POST', body: { comando: 'INJETAR' }, control: true });
  assert.equal(desconhecido.status, 400);
  const criado = await pedido('/api/commands', { metodo: 'POST', body: { comando: 'MANUAL' }, control: true });
  assert.equal(criado.status, 202);
  assert.equal(criado.body.situacao, 'pendente');
  const buscado = await pedido('/api/device/next-command', { device: true });
  assert.equal(buscado.body.comando, 'MANUAL');
  const ackErrado = await pedido('/api/device/ack', { metodo: 'POST', body: { id: 999, resultado: 'aceito' }, device: true });
  assert.equal(ackErrado.status, 409);
  const ack = await pedido('/api/device/ack', { metodo: 'POST', body: { id: criado.body.id, resultado: 'aceito' }, device: true });
  assert.equal(ack.status, 200);
  const fila = await pedido('/api/device/next-command', { device: true });
  assert.equal(fila.body.comando, null);
  const confirmado = await pedido('/api/status');
  assert.equal(confirmado.body.ultimoComando.situacao, 'reconhecido');
  const evento = await pedido('/api/device/telemetry', { metodo: 'POST', body: telemetria({ tempo_ms: 11000, modo: 'manual', irrigando: false, bloqueio_tempo: true }), device: true });
  assert.equal(evento.status, 200);
  const hist = await pedido('/api/historico');
  assert.ok(hist.body.eventos.some(x => x.descricao.includes('Bloqueio')));
  assert.ok(hist.body.eventos.some(x => x.descricao.includes('Irrigacao desligada')));

  // Testa desconexao sem esperar 8 segundos reais.
  const originalNow = Date.now;
  Date.now = () => originalNow() + 15000;
  try {
    const vencido = await pedido('/api/status');
    assert.equal(vencido.body.conectado, false);
    const recusa = await pedido('/api/commands', { metodo: 'POST', body: { comando: 'LIGAR' }, control: true });
    assert.equal(recusa.status, 409);
  } finally { Date.now = originalNow; }
});
