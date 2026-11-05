# Testes e evidencias — 05/11/2026

## Evidencias enviadas pela equipe via Monitor Serial

Link de simulacao existente: https://wokwi.com/projects/479858733827814401

O usuario informou que executou: solo seco, histerese, solo umido, modo manual, seguranca e falha do sensor. Entretanto, os cinco registros de telemetria recebidos permitem confirmar apenas parte dos comportamentos. Nao confundir "executado" com "aprovado".

| Umidade | Modo | Irrigando | Bloqueio | Interpretacao comprovavel |
|---:|---|---|---|---|
| 38% | automatico | false | true | Bloqueio ativo impede religamento em solo seco |
| 56% | automatico | false | true | Nao prova histerese, pois o bloqueio continua ativo |
| 71% | automatico | false | true | Compativel com desligamento a 70%; causa nao isolada |
| 49% | manual | false | true | Comando manual nao poderia ligar com o bloqueio ativo |
| 58% | manual | false | false | Bloqueio desativado; nao comprova acionamento manual |

`FALHA` foi informado como executado, mas nao foi enviado JSON com `leitura_valida: false`, `umidade: null` e `irrigando: false`. Portanto, falta evidencia verificavel dessa etapa.

Para comprovar os comportamentos pendentes, reinicie a simulacao ou use `MANUAL` e `RESET` antes de testar. Realize o teste de histerese em menos de 30 s para evitar timeout; busque registros `irrigando: true` em 30% e 55% e `irrigando: false` em 71%. Para modo manual, use `MANUAL`, `LIGAR` e depois `DESLIGAR` com solo abaixo de 70% e bloqueio inativo. Para falha, envie `FALHA`, verifique `leitura_valida: false` e depois `NORMAL`.

## Verificacoes feitas neste pacote

- 28 verificacoes da logica embarcada executadas com `g++` em ambiente local (mock Arduino): **passaram**. Isso nao recompila todo o firmware ESP32 nem prova Wi-Fi em Wokwi.
- 27 assercoes de rotas HTTP do servidor, realizadas por Node.js com cliente simulando o dispositivo, utilizando `node --test`: **passaram**. Confirmam autenticacao, status, telemetria, comandos, fila, ACK, historico e desconexao logica.
- Analise sintatica do JavaScript do servidor e do painel com `node --check`: **passou**.
- Verificacao de consistencia do `diagram.json`: conexoes entre GPIO34, GPIO26, potenciometro, rele e LED mantidas da Etapa 1.

## Pendencias de teste real

1. Publicar servidor em uma URL HTTPS externa e configurar `config.h` no Wokwi.
2. Compilar o novo `sketch.ino` no Wokwi com biblioteca ArduinoJson.
3. Confirmar mensagem `wifi_conectado` e que `/api/status` mostre `conectado: true` com a MESMA umidade exibida no Serial.
4. Variar o potenciometro e confirmar que o painel muda sem dados inventados.
5. Pressionar MANUAL e depois LIGAR no painel e conferir ACK e `irrigando: true` no Serial (se sem bloqueio).
6. Confirmar RESET e segurança contra `LIGAR` durante bloqueio.
7. Parar a simulacao e confirmar o status offline (apos cerca de 8 s) sem valores antigos aparentando ser atuais.
8. Reiniciar a simulacao: o automatico deve funcionar localmente mesmo se o servidor cair.
9. Fazer capturas de tela e registrar resultados observados, sem usar imagens/leituras ficticias como dados reais.
