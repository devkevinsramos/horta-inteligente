# Horta Inteligente — ESP32, Wokwi e painel web

Projeto final — Internet das Coisas e Aplicações, FATEC Itaquera. Tema: Agricultura Inteligente.

**Estado da entrega de 05/11/2026:** circuito e lógica da Etapa 1 executados no Wokwi pelo grupo; servidor HTTP e painel web da Etapa 2/3 inicial implementados e testados localmente por simulação HTTP; conexão real Wokwi ↔ servidor externo ↔ interface **ainda nao comprovada**. Não declare a integração como concluída antes do teste ao vivo.

Simulacao ja publicada pela equipe: https://wokwi.com/projects/479858733827814401

## Estrutura

```text
horta-inteligente/
├── wokwi/
│   ├── sketch.ino       # ESP32 com automacao local e cliente HTTP/JSON
│   ├── diagram.json     # Circuito: ESP32, potenciometro, rele, resistor, LED
│   ├── config.h         # URL e token, placeholders obrigatorios
│   └── libraries.txt    # ArduinoJson
├── servidor/
│   ├── server.js        # HTTP/JSON sem dependencias externas
│   ├── package.json     # Scripts npm
│   ├── .env.example     # Exemplo de configuracao
│   ├── .gitignore
│   └── testes-api.test.js
├── interface/
│   ├── index.html
│   ├── style.css
│   └── script.js
├── testes/
│   ├── testes.cpp
│   └── Arduino.h        # mock para testes locais, nunca usado no Wokwi
└── documentacao/
    ├── artigo-referencia.md
    ├── arquitetura.md
    └── testes.md
```

## 1. Testar a interface e o servidor no Windows

1. Instale Node.js 20 ou superior, abra o VS Code e extraia este ZIP.
2. Abra **Terminal → Novo Terminal** no VS Code, e selecione PowerShell.
3. Navegue para a pasta `servidor` do ZIP (ajuste o caminho se estiver em outra pasta):

```powershell
cd .\horta-inteligente\servidor
Copy-Item .env.example .env
```

4. Abra `servidor/.env` e substitua as duas strings `SUBSTITUA...` por **tokens diferentes e longos**. Para gerar um token aleatorio, execute o comando abaixo duas vezes no terminal, copiando um resultado para cada variavel:

```powershell
node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
```

5. Ainda na pasta `servidor`, execute:

```powershell
npm start
```

6. Abra **http://localhost:3000** no navegador. O painel comecara **offline**, pois o ESP32 ainda nao transmitiu dados. Isso e correto. O servidor local nao e automaticamente acessivel pelo Wokwi online.

**Por que sem Express?** Embora Express fosse a preferencia inicial, foi usado o modulo HTTP nativo do Node para dispensar `npm install` e reduzir pontos de falha antes da apresentacao. As rotas HTTP/JSON sao as mesmas de uma API Express simples. Nao precisamos de React ou banco de dados nesta etapa.

## 2. Publicar servidor HTTPS para acesso pelo Wokwi online

O ESP32 simulado pelo site Wokwi usa Wi-Fi `Wokwi-GUEST`, que oferece acesso HTTP/HTTPS a servidores na internet. Ele **nao acessa `localhost:3000` do seu Windows**. Precisamos primeiro hospedar o servidor em uma URL publica HTTPS.

Exemplo de deploy no [Render](https://render.com/):

1. Crie um repositorio GitHub com o conteudo da pasta `horta-inteligente` na raiz do repositorio, incluindo `servidor/` e `interface/`.
2. No Render, selecione **New → Web Service**, conecte o repositorio e escolha a instancia disponivel adequada (plano gratuito se oferecido).
3. **Root Directory:** `servidor`. **Build Command:** `npm install` (nenhuma dependencia externa). **Start Command:** `npm start`.
4. Crie duas variaveis de ambiente em **Environment**: `DEVICE_TOKEN` e `CONTROL_TOKEN`, iguais as do arquivo local `.env`. **Nao envie `.env` para o GitHub.**
5. Acesse a URL HTTPS disponibilizada pelo Render e acrescente `/api/health`. Deve responder `{"ok":true,"servidor":"horta-inteligente"}`.
6. Acesse a URL principal para ver o painel (ainda offline ate receber o ESP32).

**Limite do plano gratuito:** o Render pode hibernar o servico depois de 15 min sem trafego e demorar a retornar. Os dados e historico guardados em memoria se perdem quando o processo reinicia. Por isso, na apresentacao, ligue e confira o servidor antes da demonstracao.

## 3. Atualizar o projeto existente no Wokwi

Projeto da equipe: https://wokwi.com/projects/479858733827814401

1. Entre na sua conta Wokwi e abra o projeto.
2. Faça uma copia/versao de seguranca do codigo atual.
3. Substitua o conteudo da aba `sketch.ino` pelo arquivo deste ZIP em `wokwi/sketch.ino`.
4. Mantenha o `diagram.json` fornecido; nao precisa alterar os fios. Para seguranca, confira se o relé tem `"transistor":"pnp"`.
5. Crie (se nao existir) o arquivo `libraries.txt` e insira **ArduinoJson** exatamente como o arquivo do ZIP.
6. Crie o arquivo **`config.h`**, copie o modelo do ZIP e substitua:

```cpp
constexpr char URL_SERVIDOR[] = "https://SEU-SERVIDOR.onrender.com";
constexpr char TOKEN_DISPOSITIVO[] = "SUBSTITUA_POR_DEVICE_TOKEN";
```

Pela URL HTTPS real **sem `/` final** e pelo token `DEVICE_TOKEN` configurado no Render. Salve o projeto.

7. Inicie o Wokwi, abra o Serial Monitor. O esperado e `wifi_conectado` e a ausencia de erros repetidos de HTTP. Em alguns segundos, a pagina do painel deve mostrar `ESP32 conectado`, com leitura recebida realmente do ESP32.
8. No painel, informe `CONTROL_TOKEN` no campo apropriado. Gire o potenciometro do Wokwi e confira os dados. Envie `MANUAL` e depois `LIGAR`, desde que esteja abaixo de 70%, com bloqueio inativo. Observe o Serial: comando aceito, irrigacao ligada, ACK reconhecido. Se o bloqueio estiver ativo, envie `MANUAL` e `RESET` antes de `LIGAR`.

**ATENCAO A CREDENCIAIS PUBLICAS:** `config.h` nao deve levar token real duradouro a um projeto Wokwi publico. Qualquer pessoa que veja o codigo pode copiar essa chave. Use uma chave TEMPORARIA para a demonstracao, salve copia de seguranca e **troque o token apos apresentar**. O token de controle fica somente no servidor e no campo digitado pelo usuario; nunca no codigo HTML.

## 4. Como o codigo toma decisoes

- `GPIO34`: leitura analogica do potenciometro (NAO e sensor de umidade real).
- `GPIO26`: saida para relé Wokwi no modo `pnp`; `HIGH` ativa COM→NO, alimentando resistor e LED.
- Umidade simulada: `0..4095` do ADC transformados em `0..100%`, sem calibracao agronomica.
- No modo automatico, liga se `< 40%`; mantem estado entre 40 e 69%; desliga com `>= 70%`.
- No modo manual, `LIGAR` só e aceito sem bloqueio, com leitura valida e abaixo de 70%; `DESLIGAR` tem prioridade e fixa modo manual.
- Irrigando ha 30 s continuos, desliga e trava até `RESET`. Para demonstrar histerese, nao espere 30 s entre os testes.
- `FALHA` injeta uma leitura invalida artificial (NAO comprova detecção real de fio rompido). `NORMAL` restaura.
- Durante falhas de rede, o ESP32 continua decidindo pelo sensor e pelas protecoes locais.

### Comandos disponiveis

`AUTO`, `MANUAL`, `LIGAR`, `DESLIGAR`, `RESET`, `FALHA`, `NORMAL`, `STATUS` (o ultimo, apenas no Monitor Serial).

### Endpoints do servidor

- `GET /api/health`: saude do servidor (nao significa ESP32 online).
- `GET /api/status`: status atual / ultima recepcao / online-offline.
- `GET /api/historico`: historico basico (maximo 100 eventos em memoria).
- `POST /api/commands`: comando solicitado no painel, exige token de controle.
- `POST /api/device/telemetry`: recepcao do ESP32, exige token de dispositivo.
- `GET /api/device/next-command`: entrega comando pendente ao ESP32, exige token.
- `POST /api/device/ack`: confirmacao/rejeicao recebida do ESP32, exige token.

`202 Accepted` ao criar um comando significa que ele foi **enfileirado**, nao que ja ligou o rele. O painel exibe quando o ESP32 reconhece/rejeita o comando. Os comandos expiram em 20 s; o status e considerado offline 8 s apos a ultima telemetria.

## 5. Testes locais

No terminal VS Code, dentro de `servidor`, execute:

```powershell
npm test
```

Foram executadas 27 assercoes de HTTP com dispositivo falso em Node.js; todas passaram. O resultado nao comprova conectividade real com o Wokwi.

Os testes em C++ da logica da Etapa 1 foram executados com `g++` e mantiveram 28 verificacoes aprovadas apos as alteracoes de rede. Os detalhes e as pendencias estao em `documentacao/testes.md`.

## 6. Limitacoes importantes

- Firmware com `WiFiClientSecure.setInsecure()` no Wokwi: criptografia HTTPS sem verificacao de certificado. **Somente para demonstracao academica; nao para producao**. Para uso real, instalar certificado CA e usar `setCACert`.
- Requisicoes HTTP podem atrasar uma iteracao de verificacao do temporizador de seguranca. Isso e um prototipo, nao um dispositivo de seguranca industrial.
- Dados e historico do servidor ficam em memoria e sao perdidos se o processo reiniciar.
- O sistema **nao mede economia de agua, vazao ou umidade real do solo**. O LED representa irrigacao; nao existe bomba fisica.
- Os testes de rede reais e a recompilacao do firmware no Wokwi **precisam ser executados e registrados**.
- Projeto academico: houve atraso no prazo de aprovacao do artigo e revisao/entrega previa de slides, conforme regras do professor.

Artigo-base: [BRITO et al., 2024](https://doi.org/10.30681/rbegdr.v2i1.12628). Fundamentos, arquitetura e observacoes de conformidade constam em `documentacao/`.
