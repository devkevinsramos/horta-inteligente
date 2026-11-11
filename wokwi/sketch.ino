/*
  HORTA INTELIGENTE - Etapas 1 e 2 (ESP32 + Wokwi + HTTP)
  FATEC Itaquera | Internet das Coisas e Aplicacoes

  ATENCAO:
  - O potenciometro SIMULA a leitura de umidade; nao mede solo real.
  - O LED passa pelos contatos NO/COM do rele e representa uma bomba.
  - O rele Wokwi usa transistor="pnp": HIGH ativa COM->NO.
  - Rede Wokwi-GUEST; ESP32 envia telemetria e consulta comandos via HTTPS.
  - O sistema automatico continua funcionando sem servidor.
  - O token e a URL devem ser configurados no arquivo config.h.
  - TLS setInsecure usado APENAS nesta demonstracao no Wokwi; sem verificacao do certificado.
  - Os limites 40% e 70%, e o limite de 30 s, sao valores demonstrativos.
*/

#include <Arduino.h>
#include <string.h>
#include <ctype.h>

#if defined(ARDUINO_ARCH_ESP32)
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_timer.h>
#include "config.h"
#endif

// ---------- Portas e parametros ----------
constexpr uint8_t PINO_UMIDADE = 34;       // Entrada analogica ADC1 (GPIO34)
constexpr uint8_t PINO_RELE = 26;          // Saida digital (GPIO26)
constexpr int ADC_MAXIMO = 4095;          // Leitura ADC de 12 bits
constexpr int LIMITE_LIGAR = 40;          // Liga se umidade < 40%
constexpr int LIMITE_DESLIGAR = 70;       // Desliga se umidade >= 70%
constexpr unsigned long TEMPO_MAXIMO_MS = 30000UL; // 30 segundos: protecao contra acionamento continuo
constexpr unsigned long LEITURA_INTERVALO_MS = 250UL;
constexpr unsigned long TELEMETRIA_INTERVALO_MS = 1500UL;

// ---------- Estado do dispositivo ----------
enum class ModoOperacao { AUTOMATICO, MANUAL };

ModoOperacao modo = ModoOperacao::AUTOMATICO;
bool irrigando = false;
bool solicitacaoManual = false;
bool bloqueioPorTempo = false;
bool falhaSensorSimulada = false;  // Injetada APENAS para demonstracao no Serial
bool leituraValida = false;
const char* ultimoMotivoParada = "nao_iniciada";
int leituraAdc = 0;
int umidadePercentual = -1;
unsigned long inicioIrrigacaoMs = 0;
unsigned long ultimaLeituraMs = 0;
unsigned long ultimaTelemetriaMs = 0;
char bufferComando[32] = {0};
size_t tamanhoComando = 0;

// A rede nao pode modificar a logica de seguranca local.
#if defined(ARDUINO_ARCH_ESP32)
constexpr unsigned long INTERVALO_REDE_MS = 2500UL;
constexpr unsigned long INTERVALO_WIFI_MS = 10000UL;
unsigned long ultimoEnvioRedeMs = 0;
unsigned long ultimaTentativaWifiMs = 0;
unsigned long ultimoComandoProcessadoId = 0;
bool ultimoComandoAceito = false;
bool wifiAnteriormenteConectado = false;
// Timer independente das requisicoes HTTPS: o rele desliga fisicamente
// em 30 s mesmo quando o loop estiver bloqueado aguardando a rede.
esp_timer_handle_t temporizadorCorte = nullptr;
volatile bool cortePorTempoAssincrono = false;
void desligarReleNoLimite(void*) {
  digitalWrite(PINO_RELE, LOW);
  cortePorTempoAssincrono = true;
}
#endif

const char* nomeModo() {
  return modo == ModoOperacao::AUTOMATICO ? "automatico" : "manual";
}

void registrarEvento(const char* evento) {
  Serial.print("{\"tipo\":\"evento\",\"tempo_ms\":");
  Serial.print(millis());
  Serial.print(",\"evento\":\"");
  Serial.print(evento);
  Serial.println("\"}");
}

// Comanda fisicamente a porta GPIO do rele.
// No diagrama, o atributo transistor="pnp" torna HIGH = COM ligado a NO.
void definirIrrigacao(bool ligar, const char* motivo) {
  if (irrigando == ligar) return;

  digitalWrite(PINO_RELE, ligar ? HIGH : LOW);
  irrigando = ligar;
  if (ligar) {
    inicioIrrigacaoMs = millis();
#if defined(ARDUINO_ARCH_ESP32)
    cortePorTempoAssincrono = false;
    if (temporizadorCorte) esp_timer_start_once(temporizadorCorte, TEMPO_MAXIMO_MS * 1000ULL);
#endif
  } else {
#if defined(ARDUINO_ARCH_ESP32)
    if (temporizadorCorte) esp_timer_stop(temporizadorCorte);
#endif
    ultimoMotivoParada = motivo;
  }
  registrarEvento(motivo);
}

// Leitura representada pela posicao do potenciometro: 0..4095 -> 0..100%.
// A variavel de falha e uma injecao de teste, NAO deteccao de fio rompido.
void atualizarSensor() {
  leituraAdc = analogRead(PINO_UMIDADE);
  leituraValida = !falhaSensorSimulada &&
                  leituraAdc >= 0 && leituraAdc <= ADC_MAXIMO;

  if (!leituraValida) {
    umidadePercentual = -1;
    return;
  }

  // Arredondamento por inteiro para nao depender de bibliotecas externas.
  umidadePercentual = (leituraAdc * 100L + ADC_MAXIMO / 2) / ADC_MAXIMO;
}

// Mantem irrigacao local, independente de interface web ou internet.
void aplicarRegras() {
#if defined(ARDUINO_ARCH_ESP32)
  if (cortePorTempoAssincrono) {
    cortePorTempoAssincrono = false;
    bloqueioPorTempo = true;
    solicitacaoManual = false;
    definirIrrigacao(false, "tempo_maximo_atingido");
    registrarEvento("irrigacao_bloqueada_ate_RESET");
    return;
  }
#endif
  if (!leituraValida) {
    solicitacaoManual = false;
    definirIrrigacao(false, "sensor_invalido");
    return;
  }

  // Protecao de tempo vale em TODOS os modos.
  if (irrigando && (millis() - inicioIrrigacaoMs >= TEMPO_MAXIMO_MS)) {
    bloqueioPorTempo = true;
    solicitacaoManual = false;
    definirIrrigacao(false, "tempo_maximo_atingido");
    registrarEvento("irrigacao_bloqueada_ate_RESET");
    return;
  }

  if (bloqueioPorTempo) {
    solicitacaoManual = false;
    definirIrrigacao(false, "bloqueio_de_seguranca");
    return;
  }

  // Protecao de excesso de umidade tambem vale em modo MANUAL.
  if (umidadePercentual >= LIMITE_DESLIGAR) {
    solicitacaoManual = false;
    definirIrrigacao(false, "umidade_atingiu_70_porcento");
    return;
  }

  if (modo == ModoOperacao::AUTOMATICO) {
    if (!irrigando && umidadePercentual < LIMITE_LIGAR) {
      definirIrrigacao(true, "solo_seco_abaixo_de_40_porcento");
    }
    // Histerese: entre 40% e 69%, PRESERVA estado anterior.
  } else {
    if (solicitacaoManual) {
      definirIrrigacao(true, "ligacao_manual");
    } else {
      definirIrrigacao(false, "desligamento_manual");
    }
  }
}

// Formato JSON definido agora para facilitar a futura integracao HTTP.
// Esta funcao envia somente ao Monitor Serial na Etapa 1.
void emitirTelemetria() {
  Serial.print("{\"tipo\":\"telemetria\",\"dispositivo\":\"horta-esp32-01\",\"tempo_ms\":");
  Serial.print(millis());
  Serial.print(",\"adc\":");
  Serial.print(leituraAdc);
  Serial.print(",\"umidade\":");
  if (leituraValida) Serial.print(umidadePercentual);
  else Serial.print("null");
  Serial.print(",\"leitura_valida\":");
  Serial.print(leituraValida ? "true" : "false");
  Serial.print(",\"modo\":\"");
  Serial.print(nomeModo());
  Serial.print("\",\"irrigando\":");
  Serial.print(irrigando ? "true" : "false");
  Serial.print(",\"bloqueio_tempo\":");
  Serial.print(bloqueioPorTempo ? "true" : "false");
  Serial.print(",\"falha_teste\":");
  Serial.print(falhaSensorSimulada ? "true" : "false");
  Serial.print(",\"tempo_maximo_ms\":");
  Serial.print(TEMPO_MAXIMO_MS);
  Serial.print(",\"tempo_restante_ms\":");
  Serial.print(irrigando ? (TEMPO_MAXIMO_MS > millis() - inicioIrrigacaoMs ? TEMPO_MAXIMO_MS - (millis() - inicioIrrigacaoMs) : 0) : 0);
  Serial.print(",\"motivo_parada\":\"");
  Serial.print(ultimoMotivoParada);
  Serial.println("\"}");
}

// Ponto de entrada dos comandos. A mesma rotina sera utilizada na Etapa 2
// para comandos recebidos do servidor, apos implementar comunicacao HTTP.
bool aplicarComando(const char* comando) {
  bool aceito = true;
  if (strcmp(comando, "AUTO") == 0) {
    definirIrrigacao(false, "troca_para_automatico");
    modo = ModoOperacao::AUTOMATICO;
    solicitacaoManual = false;
    registrarEvento("modo_automatico");
  } else if (strcmp(comando, "MANUAL") == 0) {
    definirIrrigacao(false, "troca_para_manual");
    modo = ModoOperacao::MANUAL;
    solicitacaoManual = false;
    registrarEvento("modo_manual");
  } else if (strcmp(comando, "LIGAR") == 0) {
    // Acionamento em um unico clique: LIGAR seleciona MANUAL e solicita
    // irrigacao somente quando as protecoes locais permitem.
    if (!leituraValida || bloqueioPorTempo ||
        umidadePercentual >= LIMITE_DESLIGAR) {
      registrarEvento("comando_ligar_rejeitado_seguranca");
      aceito = false;
    } else {
      modo = ModoOperacao::MANUAL;
      solicitacaoManual = true;
      registrarEvento("comando_ligar_manual_aceito");
    }
  } else if (strcmp(comando, "DESLIGAR") == 0) {
    // Parada humana sempre tem prioridade. Sai do automatico para
    // impedir religacao instantanea se o solo continuar seco.
    modo = ModoOperacao::MANUAL;
    solicitacaoManual = false;
    definirIrrigacao(false, "parada_solicitada_pelo_usuario");
    registrarEvento("parada_manual_modo_manual");
  } else if (strcmp(comando, "RESET") == 0) {
    if (!leituraValida) {
      registrarEvento("reset_rejeitado_sensor_invalido");
      aceito = false;
    } else {
      bloqueioPorTempo = false;
      solicitacaoManual = false;
      registrarEvento("bloqueio_de_tempo_rearmado");
    }
  } else if (strcmp(comando, "FALHA") == 0) {
    falhaSensorSimulada = true;
    atualizarSensor();
    registrarEvento("falha_sensor_INJETADA_para_teste");
  } else if (strcmp(comando, "NORMAL") == 0) {
    falhaSensorSimulada = false;
    atualizarSensor();
    registrarEvento("falha_de_teste_removida");
  } else if (strcmp(comando, "STATUS") == 0) {
    // STATUS envia telemetria ao final desta rotina.
  } else {
    registrarEvento("comando_desconhecido");
    aceito = false;
  }

  aplicarRegras();
  emitirTelemetria();
  return aceito;
}

// Recepcao nao bloqueante dos comandos enviados pelo Monitor Serial.
void lerComandosSeriais() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r' || c == '\n') {
      if (tamanhoComando > 0) {
        bufferComando[tamanhoComando] = '\0';
        aplicarComando(bufferComando);
        tamanhoComando = 0;
      }
    } else if (tamanhoComando < sizeof(bufferComando) - 1) {
      bufferComando[tamanhoComando++] = (char)toupper((unsigned char)c);
    } else {
      tamanhoComando = 0;
      registrarEvento("comando_muito_longo");
    }
  }
}

#if defined(ARDUINO_ARCH_ESP32)
// Endpoints HTTPS com JSON. O endereco final DEVE estar publicado na internet.
bool redeConfigurada() {
  return strncmp(URL_SERVIDOR, "https://", 8) == 0 &&
         strstr(URL_SERVIDOR, "SEU-SERVIDOR") == nullptr &&
         TOKEN_DISPOSITIVO[0] != '\0' &&
         strstr(TOKEN_DISPOSITIVO, "SUBSTITUA") == nullptr;
}

String urlEndpoint(const char* rota) {
  String url(URL_SERVIDOR);
  if (url.endsWith("/")) url.remove(url.length() - 1);
  return url + rota;
}

// Construcao JSON sem dependencia extra de serializacao da telemetria.
String gerarTelemetriaJson() {
  String mensagem;
  mensagem.reserve(260);
  mensagem += "{\"tipo\":\"telemetria\",\"dispositivo\":\"horta-esp32-01\",\"tempo_ms\":";
  mensagem += String(millis());
  mensagem += ",\"adc\":";
  mensagem += String(leituraAdc);
  mensagem += ",\"umidade\":";
  mensagem += leituraValida ? String(umidadePercentual) : String("null");
  mensagem += ",\"leitura_valida\":";
  mensagem += leituraValida ? "true" : "false";
  mensagem += ",\"modo\":\"";
  mensagem += nomeModo();
  mensagem += "\",\"irrigando\":";
  mensagem += irrigando ? "true" : "false";
  mensagem += ",\"bloqueio_tempo\":";
  mensagem += bloqueioPorTempo ? "true" : "false";
  mensagem += ",\"falha_teste\":";
  mensagem += falhaSensorSimulada ? "true" : "false";
  mensagem += ",\"tempo_maximo_ms\":";
  mensagem += String(TEMPO_MAXIMO_MS);
  mensagem += ",\"tempo_restante_ms\":";
  mensagem += String(irrigando ? (TEMPO_MAXIMO_MS > millis() - inicioIrrigacaoMs ? TEMPO_MAXIMO_MS - (millis() - inicioIrrigacaoMs) : 0) : 0);
  mensagem += ",\"motivo_parada\":\"";
  mensagem += ultimoMotivoParada;
  mensagem += "\"}";
  return mensagem;
}

// Em ambiente de demonstracao usa HTTPS sem validacao de certificado.
// Em um projeto de producao trocar por validacao CA com setCACert.
int postarJson(const char* rota, const String& corpo) {
  WiFiClientSecure cliente;
  cliente.setInsecure();
  HTTPClient http;
  http.setTimeout(7000);
  if (!http.begin(cliente, urlEndpoint(rota))) return -1;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", TOKEN_DISPOSITIVO);
  int codigo = http.POST(corpo);
  http.end();
  return codigo;
}

bool enviarTelemetriaServidor() {
  const int codigo = postarJson("/api/device/telemetry", gerarTelemetriaJson());
  if (codigo != 200) {
    Serial.printf("{\"tipo\":\"rede\",\"acao\":\"telemetria\",\"http\":%d}\n", codigo);
    return false;
  }
  return true;
}

void consultarComandoServidor() {
  WiFiClientSecure cliente;
  cliente.setInsecure();
  HTTPClient http;
  http.setTimeout(7000);
  if (!http.begin(cliente, urlEndpoint("/api/device/next-command"))) return;
  http.addHeader("x-device-token", TOKEN_DISPOSITIVO);
  int codigo = http.GET();
  String corpo = codigo == 200 ? http.getString() : "";
  http.end();
  if (codigo != 200) {
    Serial.printf("{\"tipo\":\"rede\",\"acao\":\"consulta_comando\",\"http\":%d}\n", codigo);
    return;
  }
  JsonDocument json;
  if (deserializeJson(json, corpo)) {
    registrarEvento("resposta_comando_json_invalido");
    return;
  }
  unsigned long id = json["id"].as<unsigned long>();
  const char* recebido = json["comando"].as<const char*>();
  if (!id || !recebido) return;
  if (strlen(recebido) > 30) { registrarEvento("comando_servidor_excessivo"); return; }

  // Se o ACK nao chegou ao servidor, nao repetir a acao no dispositivo.
  if (id != ultimoComandoProcessadoId) {
    ultimoComandoAceito = aplicarComando(recebido);
    ultimoComandoProcessadoId = id;
  }
  const String ack = String("{\"id\":") + String(id) +
    String(",\"resultado\":\"") + (ultimoComandoAceito ? "aceito" : "rejeitado") + "\"}";
  const int respostaAck = postarJson("/api/device/ack", ack);
  if (respostaAck != 200) {
    Serial.printf("{\"tipo\":\"rede\",\"acao\":\"ack\",\"http\":%d}\n", respostaAck);
  }
  // Mesmo se o ACK falhar, a telemetria permite ao servidor confirmar
  // o estado aplicado, evitando que a fila trave indefinidamente.
  enviarTelemetriaServidor();
}

void gerenciarRede() {
  if (!redeConfigurada()) return;
  const unsigned long agora = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (wifiAnteriormenteConectado) {
      registrarEvento("wifi_desconectado_controle_local_ativo");
      wifiAnteriormenteConectado = false;
    }
    if (!ultimaTentativaWifiMs || agora - ultimaTentativaWifiMs >= INTERVALO_WIFI_MS) {
      ultimaTentativaWifiMs = agora;
      WiFi.begin("Wokwi-GUEST", "", 6);
    }
    return;
  }
  if (!wifiAnteriormenteConectado) {
    wifiAnteriormenteConectado = true;
    registrarEvento("wifi_conectado");
  }
  if (agora - ultimoEnvioRedeMs >= INTERVALO_REDE_MS) {
    ultimoEnvioRedeMs = agora;
    enviarTelemetriaServidor();
    consultarComandoServidor();
  }
}
#endif

void setup() {
  // PRIMEIRA acao: assegurar relé desligado.
  pinMode(PINO_RELE, OUTPUT);
  digitalWrite(PINO_RELE, LOW);
  pinMode(PINO_UMIDADE, INPUT);
  Serial.begin(115200);
  analogReadResolution(12);

  modo = ModoOperacao::AUTOMATICO;
  irrigando = false;
  solicitacaoManual = false;
  bloqueioPorTempo = false;
  falhaSensorSimulada = false;
  ultimoMotivoParada = "nao_iniciada";
  tamanhoComando = 0;
  ultimaLeituraMs = millis();
  ultimaTelemetriaMs = millis();
  atualizarSensor();
#if defined(ARDUINO_ARCH_ESP32)
  esp_timer_create_args_t dadosTimer = {};
  dadosTimer.callback = &desligarReleNoLimite;
  dadosTimer.dispatch_method = ESP_TIMER_TASK;
  dadosTimer.name = "corte_irrigacao";
  if (esp_timer_create(&dadosTimer, &temporizadorCorte) != ESP_OK) {
    registrarEvento("erro_timer_fisico");
  }
#endif

  registrarEvento("inicializacao_segura");
  registrarEvento("comandos_AUTO_MANUAL_LIGAR_DESLIGAR_RESET_FALHA_NORMAL_STATUS");
  aplicarRegras();
  emitirTelemetria();
#if defined(ARDUINO_ARCH_ESP32)
  if (!redeConfigurada()) registrarEvento("rede_nao_configurada_edite_config_h");
  else WiFi.mode(WIFI_STA);
#endif
}

void loop() {
  unsigned long agora = millis();

  if (agora - ultimaLeituraMs >= LEITURA_INTERVALO_MS) {
    ultimaLeituraMs = agora;
    atualizarSensor();
  }

  lerComandosSeriais();
  aplicarRegras();

  if (agora - ultimaTelemetriaMs >= TELEMETRIA_INTERVALO_MS) {
    ultimaTelemetriaMs = agora;
    emitirTelemetria();
  }
#if defined(ARDUINO_ARCH_ESP32)
  gerenciarRede();
#endif
}
