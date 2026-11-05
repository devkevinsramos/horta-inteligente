# Arquitetura — Horta Inteligente (Etapas 1, 2 e painel inicial)

## Fluxo implementado no codigo

```text
Potenciometro no Wokwi (representacao de umidade)
       |
       v
ESP32 GPIO34 -> leitura ADC 0..4095 -> porcentagem 0..100
       |
       v
Regras de irrigacao locais (automatico/manual, 40%/70%, 30 s, falha)
       |
       +--> GPIO26 -> rele (COM/NO) -> resistor -> LED (bomba simulada)
       |
       +--> Monitor Serial: telemetria e eventos JSON
       |
       +--> WiFi Wokwi-GUEST -> servidor HTTPS publico
                                  | POST /api/device/telemetry
                                  | GET /api/device/next-command
                                  | POST /api/device/ack
                                  v
                      Node.js HTTP + estado em memoria
                                  ^
                                  | GET /api/status
                                  | GET /api/historico
                                  | POST /api/commands
                                  |
                          Interface HTML/CSS/JS
```

**Importante:** o desenho representa os caminhos programados. A transmissao **real** do ESP32 no Wokwi ao servidor remoto ainda deve ser testada por uma pessoa apos a hospedagem e configuracao do token.

## Protocolo

- `POST /api/device/telemetry`: ESP32 envia estado JSON; exige `x-device-token`; resposta `{ "ok": true }`.
- `GET /api/device/next-command`: ESP32 consulta o proximo comando; exige `x-device-token`; resposta `{ "id": 1, "comando": "MANUAL" }` ou `{ "id": 0, "comando": null }`.
- `POST /api/device/ack`: ESP32 avisa se aceitou/rejeitou o comando; exige `x-device-token` e corpo `{ "id": 1, "resultado": "aceito" }`.
- `GET /api/status`: painel consulta estado do ESP32, hora de recepcao e status online/offline.
- `GET /api/historico`: lista ultimos 100 eventos em memoria.
- `POST /api/commands`: painel pede `AUTO`, `MANUAL`, `LIGAR`, `DESLIGAR`, `RESET`, `FALHA` ou `NORMAL`; exige `x-control-token` e corpo `{ "comando": "LIGAR" }`.
- `GET /api/health`: confirma se o servidor esta respondendo (nao confirma ESP32 conectado).

O servidor nao liga o rele diretamente. Ele aguarda que **o ESP32 consulte e decida localmente** se pode executar o comando. Ao receber o ACK, o servidor marca o comando como reconhecido ou rejeitado. `202` significa **enfileirado**, nao executado.

## Seguranca e perda de comunicacao

- A irrigacao automatica independe de WiFi e de pagina web.
- O ESP32 nao executa comando repetido com o mesmo ID enquanto roda.
- A fila descarta comandos nao confirmados apos 20 segundos.
- A interface recusa criar comandos quando a ultima telemetria tem mais de 8 segundos.
- O painel oculta umidade/estado atual quando o dispositivo esta offline, preservando apenas a data da ultima recepcao.
- Tokens diferentes sao exigidos para ESP32 e controle no navegador. Tokens reais ficam em `.env` no servidor. No Wokwi online, `config.h` pode ficar visivel em projetos publicos: use credencial temporaria, nao publique projetos configurados com tokens reais duradouros.
- **Limite de seguranca do prototipo:** o firmware usa `WiFiClientSecure.setInsecure()` para HTTPS no Wokwi de demonstracao; isso desabilita a verificacao de certificados e NAO deve ser mantido para producao com dados sensiveis. Para uso real, configurar certificado CA verificado (`setCACert`).
- Requisicoes de rede bloqueantes e tempo de resposta de hospedagem gratuita podem atrasar alguns segundos o ciclo do firmware; limite temporal continua checado na iteracao seguinte. Nao e um controlador de seguranca industrial.

## Armazenamento

O servidor usa memoria RAM, sem banco de dados: ao reiniciar, apaga estado, fila e historico. Isso e intencional para o prototipo e deve ser informado na apresentacao.

## Simulacao versus hardware real

O potenciometro e uma fonte de sinal analogico, nao sensor real. A falha pode ser simulada com `FALHA` pelo Monitor Serial ou pelo painel. O LED representa uma carga acionada pelo relé; nenhuma bomba ou agua e monitorada.
